import assert from "node:assert/strict";
import test from "node:test";
import {
  contentText,
  fauxAssistantMessage,
  fauxToolCall,
  getCurrentSystemPrompt,
} from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { Check } from "typebox/value";
import { completionReportPrefix } from "../src/completion-report.js";
import { childFixture, receipt } from "./child-fixture.js";

function reports(f: Awaited<ReturnType<typeof childFixture>>) {
  return f.session.sessionManager
    .getEntries()
    .filter(
      (entry) =>
        entry.type === "message" &&
        entry.message.role === "user" &&
        contentText(entry.message.content).startsWith(completionReportPrefix),
    );
}

const Report = Type.Object({
  id: Type.String(),
  attempt: Type.Integer(),
  status: Type.Union([Type.Literal("completed"), Type.Literal("failed")]),
  report: Type.Union([
    Type.Object({ kind: Type.Literal("full"), text: Type.String() }),
    Type.Object({
      kind: Type.Literal("preview"),
      text: Type.String(),
      omittedBytes: Type.Integer(),
    }),
  ]),
});

function parseReport(text: string) {
  assert.ok(text.startsWith(completionReportPrefix));

  const data: unknown = JSON.parse(text.slice(completionReportPrefix.length));

  assert.ok(Check(Report, data));

  return data;
}

const Completed = Type.Object({
  id: Type.String(),
  outcome: Type.Object({ status: Type.Literal("completed") }),
});

await test("background completion delivers its full report without inspection", {
  timeout: 10000,
}, async (t) => {
  const f = await childFixture(t);
  const release = f.gate();
  f.nested.setResponses([
    async () => {
      await release.promise;

      return fauxAssistantMessage("Private child answer");
    },
  ]);

  const started = await f.call("pstack_task", {
    prompt: "Find the private child answer",
    model: "nested/child:rev1:low",
    run_in_background: true,
  });

  assert.equal(started.isError, false, started.text);
  const child = receipt(started.text);

  assert.equal(child.status, "running");

  f.parent.setResponses([
    (context) => {
      const signal = context.messages.findLast(
        (item) => item.role === "user" && contentText(item.content).includes(child.id),
      );

      assert.ok(signal?.role === "user");
      assert.deepEqual(parseReport(contentText(signal.content)), {
        id: child.id,
        attempt: 1,
        status: "completed",
        report: { kind: "full", text: "Private child answer" },
      });

      return fauxAssistantMessage("Parent resumed after the child finished");
    },
  ]);
  const settled = f.report();
  release.resolve();
  await settled;
  await f.session.waitForIdle();

  assert.equal(reports(f).length, 1);
  const completion = reports(f)[0];
  assert.ok(completion?.type === "message" && completion.message.role === "user");
  assert.deepEqual(parseReport(contentText(completion.message.content)), {
    id: child.id,
    attempt: 1,
    status: "completed",
    report: { kind: "full", text: "Private child answer" },
  });
  const answer = f.session.messages.findLast((message) => message.role === "assistant");
  assert.ok(answer?.role === "assistant");
  assert.equal(contentText(answer.content), "Parent resumed after the child finished");
});

await test("simultaneous idle completions do not race prompt preparation", {
  timeout: 10000,
}, async (t) => {
  const f = await childFixture(t);

  const first = f.gate();
  const second = f.gate();

  f.nested.setResponses([
    async () => {
      await first.promise;

      return fauxAssistantMessage("First private answer");
    },
    async () => {
      await second.promise;

      return fauxAssistantMessage("Second private answer");
    },
  ]);

  const firstStarted = await f.call("pstack_task", {
    prompt: "First task",
    model: "nested/child:rev1:low",
    run_in_background: true,
  });

  const secondStarted = await f.call("pstack_task", {
    prompt: "Second task",
    model: "nested/child:rev1:low",
    run_in_background: true,
  });

  const a = receipt(firstStarted.text);
  const b = receipt(secondStarted.text);

  const completions = f.gate();

  let count = 0;

  const unsubscribe = f.session.subscribe((event) => {
    if (
      event.type === "message_end" &&
      event.message.role === "user" &&
      contentText(event.message.content).startsWith(completionReportPrefix) &&
      ++count === 2
    )
      completions.resolve();
  });

  t.after(unsubscribe);

  const seen = new Set<string>();
  const before = f.parent.state.callCount;
  const userCount = f.session.messages.filter((message) => message.role === "user").length;

  f.parent.setResponses(
    Array.from({ length: 3 }, () => (context) => {
      assert.match(getCurrentSystemPrompt(context.messages), /## PStack role map/);

      const signals = context.messages
        .filter((message) => message.role === "user")
        .map((message) => contentText(message.content));

      for (const id of [a.id, b.id]) if (signals.some((text) => text.includes(id))) seen.add(id);

      return fauxAssistantMessage("Parent handled the completion signals");
    }),
  );

  first.resolve();
  second.resolve();
  await completions.promise;
  const settled = f.report();
  await settled;
  await f.session.waitForIdle();
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });

  assert.equal(reports(f).length, 2);
  assert.equal(
    f.session.messages.filter((message) => message.role === "user").length,
    userCount + 2,
  );
  assert.deepEqual([...seen].sort(), [a.id, b.id].sort());
  assert.ok(f.parent.state.callCount - before <= 2);
  assert.deepEqual(f.errors, []);
});

await test("completion still wakes the parent after its current turn aborts", {
  timeout: 10000,
}, async (t) => {
  const f = await childFixture(t);
  const release = f.gate();

  f.nested.setResponses([
    async () => {
      await release.promise;

      return fauxAssistantMessage("Private answer after abort");
    },
  ]);

  const launched = await f.call("pstack_task", {
    prompt: "Complete while the parent aborts",
    model: "nested/child:rev1:low",
    run_in_background: true,
  });

  assert.equal(launched.isError, false, launched.text);

  const child = receipt(launched.text);
  const finished = f.gate();

  const unsubscribe = f.session.subscribe((event) => {
    if (event.type !== "entry_appended" || event.entry.type !== "custom") return;

    if (event.entry.customType !== "pstack-task") return;

    const data: unknown = event.entry.data;

    if (Check(Completed, data) && data.id === child.id) finished.resolve();
  });

  t.after(unsubscribe);
  f.parent.setResponses([
    async (_context, options) => {
      release.resolve();
      await finished.promise;
      void f.session.abort();
      await new Promise<void>((resolve) => {
        if (options?.signal?.aborted === true) resolve();
        else options?.signal?.addEventListener("abort", () => resolve(), { once: true });
      });

      return fauxAssistantMessage("", { stopReason: "aborted" });
    },
    (context) => {
      const signal = context.messages.findLast(
        (message) => message.role === "user" && contentText(message.content).includes(child.id),
      );

      assert.ok(signal?.role === "user");

      return fauxAssistantMessage("Parent resumed after abort");
    },
  ]);

  await f.session.prompt("Start the parent turn");
  await f.session.waitForIdle();
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 100);
  });

  assert.equal(reports(f).length, 1);
  assert.deepEqual(f.errors, []);
});

await test("failed background attempt delivers its error and retains inspection", {
  timeout: 10000,
}, async (t) => {
  const f = await childFixture(t);
  const release = f.gate();
  f.nested.setResponses([
    async () => {
      await release.promise;

      return fauxAssistantMessage("", {
        stopReason: "error",
        errorMessage: "Private provider failure",
      });
    },
  ]);

  const started = await f.call("pstack_task", {
    prompt: "Fail in the background",
    model: "nested/child:rev1:low",
    run_in_background: true,
  });

  assert.equal(started.isError, false, started.text);
  const child = receipt(started.text);

  f.parent.setResponses([
    (context) => {
      const message = context.messages.findLast(
        (item) => item.role === "user" && contentText(item.content).includes('"status":"failed"'),
      );

      assert.ok(message?.role === "user");
      assert.deepEqual(parseReport(contentText(message.content)), {
        id: child.id,
        attempt: 1,
        status: "failed",
        report: { kind: "full", text: "Error: Private provider failure" },
      });

      return fauxAssistantMessage("Failed child wake received");
    },
  ]);

  const settled = f.report();
  release.resolve();
  await settled;
  await f.session.waitForIdle();

  assert.equal(reports(f).length, 1);
  const completion = reports(f)[0];
  assert.ok(completion?.type === "message" && completion.message.role === "user");
  assert.deepEqual(parseReport(contentText(completion.message.content)), {
    id: child.id,
    attempt: 1,
    status: "failed",
    report: { kind: "full", text: "Error: Private provider failure" },
  });
  const answer = f.session.messages.findLast((message) => message.role === "assistant");

  assert.ok(answer?.role === "assistant");
  assert.equal(contentText(answer.content), "Failed child wake received");

  const inspected = await f.call("pstack_tasks", { action: "inspect", id: child.id });

  assert.equal(inspected.isError, false, inspected.text);
  const detail: unknown = JSON.parse(inspected.text);

  assert.ok(Check(Type.Object({ error: Type.String() }), detail));
  assert.equal(detail.error, "Error: Private provider failure");
  assert.deepEqual(f.errors, []);
});

await test("inspection of a previous attempt does not suppress a resumed attempt's wake", {
  timeout: 10000,
}, async (t) => {
  const f = await childFixture(t);
  const release = f.gate();

  f.nested.setResponses([
    fauxAssistantMessage("First attempt result"),
    async () => {
      await release.promise;

      return fauxAssistantMessage("Second attempt result");
    },
  ]);

  const first = await f.call("pstack_task", {
    prompt: "First attempt",
    model: "nested/child:rev1:low",
    run_in_background: false,
  });

  assert.equal(first.isError, false, first.text);
  const child = receipt(first.text);
  const inspected = await f.call("pstack_tasks", { action: "inspect", id: child.id });

  assert.equal(inspected.isError, false, inspected.text);
  assert.match(inspected.text, /First attempt result/);

  const resumed = await f.call("pstack_task", {
    prompt: "Second attempt",
    resume: child.id,
    run_in_background: true,
  });

  assert.equal(resumed.isError, false, resumed.text);
  f.parent.setResponses([fauxAssistantMessage("Resumed attempt wake received")]);

  const settled = f.report();

  release.resolve();
  await settled;
  await f.session.waitForIdle();

  assert.equal(reports(f).length, 1);
  const completion = reports(f)[0];
  assert.ok(completion?.type === "message" && completion.message.role === "user");
  assert.deepEqual(parseReport(contentText(completion.message.content)), {
    id: child.id,
    attempt: 2,
    status: "completed",
    report: { kind: "full", text: "Second attempt result" },
  });
  const answer = f.session.messages.findLast((message) => message.role === "assistant");

  assert.ok(answer?.role === "assistant");
  assert.equal(contentText(answer.content), "Resumed attempt wake received");
  assert.match(JSON.stringify(f.session.messages), /Second attempt result/);
});

await test("inspection of a completed child prevents its queued completion turn", {
  timeout: 10000,
}, async (t) => {
  const f = await childFixture(t);
  const release = f.gate();
  f.nested.setResponses([
    async () => {
      await release.promise;

      return fauxAssistantMessage("Inspected answer");
    },
  ]);

  const started = await f.call("pstack_task", {
    prompt: "Return the inspected answer",
    model: "nested/child:rev1:low",
    run_in_background: true,
  });

  assert.equal(started.isError, false, started.text);

  const child = receipt(started.text);
  const finished = f.gate();

  const unsubscribe = f.session.subscribe((event) => {
    if (event.type !== "entry_appended" || event.entry.type !== "custom") return;

    if (event.entry.customType !== "pstack-task") return;

    const data: unknown = event.entry.data;

    if (Check(Completed, data) && data.id === child.id) finished.resolve();
  });

  t.after(unsubscribe);

  const before = f.parent.state.callCount;
  f.parent.setResponses([
    async () => {
      release.resolve();
      await finished.promise;

      return fauxAssistantMessage(
        fauxToolCall("pstack_tasks", { action: "inspect", id: child.id }),
        { stopReason: "toolUse" },
      );
    },
    (context) => {
      const result = context.messages.findLast(
        (message) => message.role === "toolResult" && message.toolName === "pstack_tasks",
      );

      assert.ok(result?.role === "toolResult");
      const inspected: unknown = JSON.parse(contentText(result.content));

      assert.ok(Check(Type.Object({ output: Type.String() }), inspected));
      assert.equal(inspected.output, "Inspected answer");

      return fauxAssistantMessage("Parent used the inspected answer");
    },
    fauxAssistantMessage("Unexpected duplicate completion turn"),
  ]);
  await f.session.prompt("Inspect the completed child");
  await f.session.waitForIdle();

  assert.equal(f.parent.state.callCount - before, 2);
  const answer = f.session.messages.findLast((message) => message.role === "assistant");
  assert.ok(answer?.role === "assistant");
  assert.equal(contentText(answer.content), "Parent used the inspected answer");
  assert.equal(reports(f).length, 0);
});
