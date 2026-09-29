import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import test from "node:test";
import {
  contentText,
  fauxAssistantMessage,
  fauxToolCall,
  getCurrentSystemPrompt,
} from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { Check } from "typebox/value";
import { childFixture, packageRoot, receipt } from "./child-fixture.js";

const Completed = Type.Object({
  id: Type.String(),
  outcome: Type.Object({ status: Type.Literal("completed") }),
});

await test("background completion wakes the parent without a visible result payload", {
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
      assert.deepEqual(JSON.parse(contentText(signal.content)), {
        id: child.id,
        attempt: 1,
        status: "completed",
      });

      return fauxAssistantMessage("Parent resumed after the child finished");
    },
  ]);
  const settled = f.report();
  release.resolve();
  await settled;
  await f.session.waitForIdle();

  const completions = f.session.sessionManager
    .getEntries()
    .filter(
      (entry) => entry.type === "custom_message" && entry.customType === "pstack-task-result",
    );

  assert.equal(completions.length, 1);
  const completion = completions[0];

  assert.ok(completion?.type === "custom_message");
  assert.equal(completion.display, false);
  assert.ok(Check(Type.String(), completion.content));
  const wake: unknown = JSON.parse(completion.content);

  assert.deepEqual(wake, {
    id: child.id,
    attempt: 1,
    status: "completed",
  });
  assert.equal(
    f.session.messages.some(
      (message) =>
        message.role === "user" && contentText(message.content).includes("Private child answer"),
    ),
    false,
  );
  const answer = f.session.messages.findLast((message) => message.role === "assistant");
  assert.ok(answer?.role === "assistant");
  assert.equal(contentText(answer.content), "Parent resumed after the child finished");
});

await test("simultaneous idle completions do not race prompt preparation", {
  timeout: 10000,
}, async (t) => {
  const eventName = `pstack-wake-${randomUUID()}`;
  const previous = process.env["PSTACK_WAKE_GATE_EVENT"];
  process.env["PSTACK_WAKE_GATE_EVENT"] = eventName;
  const started = Promise.withResolvers<void>();
  const releaseInput = Promise.withResolvers<void>();

  const listener = (release: () => void) => {
    started.resolve();
    void releaseInput.promise.then(release);
  };

  process.on(eventName, listener);
  t.after(() => {
    releaseInput.resolve();
    process.off(eventName, listener);

    if (previous === undefined) delete process.env["PSTACK_WAKE_GATE_EVENT"];
    else process.env["PSTACK_WAKE_GATE_EVENT"] = previous;
  });

  const f = await childFixture(t, {
    extensionPaths: [join(packageRoot, "tests/quiet-wake-gate-extension.ts")],
  });

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

  const secondSaved = f.gate();

  const unsubscribe = f.session.subscribe((event) => {
    if (event.type !== "entry_appended" || event.entry.type !== "custom") return;

    if (event.entry.customType !== "pstack-task") return;

    const data: unknown = event.entry.data;

    if (Check(Completed, data) && data.id === b.id) secondSaved.resolve();
  });

  t.after(unsubscribe);
  const seen = new Set<string>();
  const before = f.parent.state.callCount;

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
  await started.promise;
  second.resolve();
  await secondSaved.promise;
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 100);
  });

  const settled = f.report();

  releaseInput.resolve();
  await settled;
  await f.session.waitForIdle();
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });

  const wakes = f.session.sessionManager
    .getEntries()
    .filter(
      (entry) => entry.type === "custom_message" && entry.customType === "pstack-task-result",
    );

  assert.equal(wakes.length, 2);
  assert.deepEqual([...seen].sort(), [a.id, b.id].sort());
  assert.ok(f.parent.state.callCount - before <= 2);
  assert.deepEqual(f.errors, []);
});

await test("failed background attempt wakes with status only and retains its error for inspection", {
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
      assert.deepEqual(JSON.parse(contentText(message.content)), {
        id: child.id,
        attempt: 1,
        status: "failed",
      });
      assert.doesNotMatch(JSON.stringify(context.messages), /Private provider failure/);

      return fauxAssistantMessage("Failed child wake received");
    },
  ]);

  const settled = f.report();
  release.resolve();
  await settled;
  await f.session.waitForIdle();

  const completions = f.session.sessionManager
    .getEntries()
    .filter(
      (entry) => entry.type === "custom_message" && entry.customType === "pstack-task-result",
    );

  assert.equal(completions.length, 1);
  assert.ok(completions[0]?.type === "custom_message");
  assert.equal(completions[0].display, false);
  assert.ok(Check(Type.String(), completions[0].content));
  assert.deepEqual(JSON.parse(completions[0].content), {
    id: child.id,
    attempt: 1,
    status: "failed",
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

  const completions = f.session.sessionManager
    .getEntries()
    .filter(
      (entry) => entry.type === "custom_message" && entry.customType === "pstack-task-result",
    );

  assert.equal(completions.length, 1);
  assert.ok(completions[0]?.type === "custom_message");
  assert.ok(Check(Type.String(), completions[0].content));
  assert.deepEqual(JSON.parse(completions[0].content), {
    id: child.id,
    attempt: 2,
    status: "completed",
  });
  const answer = f.session.messages.findLast((message) => message.role === "assistant");

  assert.ok(answer?.role === "assistant");
  assert.equal(contentText(answer.content), "Resumed attempt wake received");
  assert.doesNotMatch(JSON.stringify(f.session.messages), /Second attempt result/);
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
  assert.equal(
    f.session.sessionManager
      .getEntries()
      .filter(
        (entry) => entry.type === "custom_message" && entry.customType === "pstack-task-result",
      ).length,
    0,
  );
});
