import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import {
  contentText,
  fauxAssistantMessage,
  fauxToolCall,
  getCurrentSystemPrompt,
} from "@earendil-works/pi-ai";
import { childFixture, receipt } from "./child-fixture.js";

const task = { model: "nested/child:rev1:low", prompt: "child assignment" };

await test("child uses exact model/thinking and project context without ambient system or skill catalog", {
  timeout: 10000,
}, async (t) => {
  const f = await childFixture(t);
  let prompt = "";
  let nativeTranscript = "";
  f.nested.setResponses([
    (context, options, _state, model) => {
      assert.equal(model.id, "child:rev1");
      assert.equal(model.provider, "nested");
      assert.equal(options?.reasoning, "low");
      prompt = getCurrentSystemPrompt(context.messages);
      const user = context.messages.findLast((item) => item.role === "user");
      assert.ok(user?.role === "user");
      assert.deepEqual(user.content, [{ type: "text", text: "/ambient-override" }]);

      return fauxAssistantMessage(
        fauxToolCall("bash", { command: "printf '%s' \"$PI_SESSION_FILE\"" }),
        { stopReason: "toolUse" },
      );
    },
    (context) => {
      const response = context.messages.findLast((item) => item.role === "toolResult");
      assert.ok(response?.role === "toolResult" && !response.isError);
      nativeTranscript = response.content
        .filter((item) => item.type === "text")
        .map((item) => item.text)
        .join("");

      return fauxAssistantMessage("isolated child");
    },
  ]);

  const result = await f.call("pstack_task", {
    ...task,
    prompt: "/ambient-override",
    readonly: true,
  });

  assert.equal(result.isError, false, result.text);
  const transcript = receipt(result.text).transcript;
  assert.ok(transcript !== undefined);
  assert.equal(nativeTranscript, transcript);
  assert.doesNotMatch(prompt, /Current Pi (?:transcript|history scope)/);
  assert.match(await readFile(transcript, "utf8"), /isolated child/);
  assert.match(prompt, /Project-only instruction marker/);
  assert.doesNotMatch(prompt, /Global (?:instruction|system|append) forbidden marker/);
  assert.doesNotMatch(prompt, /<available_skills>|Ambient forbidden skill marker/);
  assert.equal(f.childShutdowns(), 0, "readonly child never loads the external integration");
});

await test("unsupported cloud assignment cannot silently execute in a local child", {
  timeout: 10000,
}, async (t) => {
  const f = await childFixture(t);
  f.nested.setResponses([fauxAssistantMessage("executed locally")]);
  const result = await f.call("pstack_task", { ...task, environment: "cloud" });
  assert.equal(result.isError, true, result.text);
  assert.match(result.text, /environment/);
  assert.equal(f.nested.state.callCount, 0);
});

await test("writable child loads and uses the parent's active file-backed integration", {
  timeout: 10000,
}, async (t) => {
  const f = await childFixture(t);
  f.nested.setResponses([
    fauxAssistantMessage(fauxToolCall("fixture_lookup", {}), { stopReason: "toolUse" }),
    (context) => {
      const response = context.messages.findLast((item) => item.role === "toolResult");
      assert.equal(response?.role === "toolResult" && response.isError, false);

      return fauxAssistantMessage("lookup consumed");
    },
  ]);
  const result = await f.call("pstack_task", task);
  assert.equal(result.isError, false, result.text);
  assert.match(await f.lookup(), /child:rev1/);
  assert.match(await f.lookup(), /"thinking":"low"/);
});

await test("shutdown tracks a child still inside extension startup and disposes it without inference", {
  timeout: 10000,
}, async (t) => {
  const f = await childFixture(t, { holdStartup: true });
  const result = await f.call("pstack_task", { ...task, run_in_background: true });
  assert.equal(result.isError, false, result.text);
  const child = receipt(result.text);
  await f.entered;
  let closed = false;

  const closing = f.session.extensionRunner
    .emit({ type: "session_shutdown", reason: "quit" })
    .then(() => {
      closed = true;
    });

  await Promise.resolve();
  assert.equal(closed, false);
  f.releaseStartup();
  await closing;
  assert.equal(f.childShutdowns(), 1);
  assert.equal(f.nested.state.callCount, 0);
  assert.doesNotMatch(
    JSON.stringify(
      f.session.messages.filter((item) => item.role === "custom" || item.role === "user"),
    ),
    new RegExp(child.id),
  );
});

await test("failed startup cleans up and a subsequent child remains usable", {
  timeout: 10000,
}, async (t) => {
  const f = await childFixture(t);
  const failureMarker = join(f.dir, "fail-startup");
  await writeFile(failureMarker, "fail");
  let result = await f.call("pstack_task", task);
  assert.equal(result.isError, true);
  assert.match(result.text, /startup failed/);
  assert.equal(f.childShutdowns(), 1);
  assert.equal(f.nested.state.callCount, 0);
  await rm(failureMarker);
  f.nested.setResponses([fauxAssistantMessage("next child succeeded")]);
  result = await f.call("pstack_task", task);
  assert.equal(result.isError, false, result.text);
  assert.match(result.text, /next child succeeded/);
});

await test("nested background completion waits for follow-up consumption and a second leaf", {
  timeout: 10000,
}, async (t) => {
  const f = await childFixture(t);
  const first = f.gate();
  const second = f.gate();
  const firstStarted = f.gate();
  const secondStarted = f.gate();
  f.leaf.setResponses([
    async () => {
      firstStarted.resolve();
      await first.promise;

      return fauxAssistantMessage("first leaf evidence");
    },
    async () => {
      secondStarted.resolve();
      await second.promise;

      return fauxAssistantMessage("second leaf evidence");
    },
  ]);
  f.nested.setResponses([
    fauxAssistantMessage(
      fauxToolCall("pstack_task", {
        prompt: "first leaf",
        model: "leaf/reader:off",
        readonly: true,
        run_in_background: true,
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("waiting for first leaf"),
    (context) => {
      assert.ok(
        context.messages.some(
          (message) =>
            message.role === "user" &&
            contentText(message.content).includes('"status":"completed"'),
        ),
      );
      assert.doesNotMatch(JSON.stringify(context.messages), /first leaf evidence/);

      return fauxAssistantMessage(
        fauxToolCall("pstack_task", {
          prompt: "second leaf",
          model: "leaf/reader:off",
          readonly: true,
          run_in_background: true,
        }),
        { stopReason: "toolUse" },
      );
    },
    fauxAssistantMessage("waiting for second leaf"),
    (context) => {
      const wakes = context.messages.filter(
        (message) =>
          message.role === "user" && contentText(message.content).includes('"status":"completed"'),
      );

      assert.equal(wakes.length, 2);
      assert.doesNotMatch(JSON.stringify(context.messages), /second leaf evidence/);

      return fauxAssistantMessage("synthesized both leaves");
    },
  ]);
  let finished = false;

  const running = f.call("pstack_task", task).then((value) => {
    finished = true;

    return value;
  });

  await firstStarted.promise;
  first.resolve();
  await secondStarted.promise;
  assert.equal(finished, false);
  second.resolve();
  const result = await running;
  assert.equal(result.isError, false, result.text);
  assert.match(result.text, /synthesized both leaves/);
  assert.equal(f.leaf.state.callCount, 2);
  assert.equal(f.nested.state.callCount, 5);
});

for (const navigation of ["tree", "veto-tree", "reload"] as const) {
  await test(`${navigation} cancels old children, suppresses their result, and permits new delegation`, {
    timeout: 10000,
  }, async (t) => {
    const f = await childFixture(t);
    const started = f.gate();
    f.nested.setResponses([
      async (_context, options) => {
        assert.ok(options?.signal);
        started.resolve();
        await new Promise<void>((resolve) => {
          if (options.signal?.aborted === true) resolve();
          else options.signal?.addEventListener("abort", () => resolve(), { once: true });
        });

        return fauxAssistantMessage("obsolete child output");
      },
    ]);
    const result = await f.call("pstack_task", { ...task, run_in_background: true });
    assert.equal(result.isError, false, result.text);
    await started.promise;

    if (navigation === "reload") await f.session.reload();
    else {
      if (navigation === "veto-tree") await writeFile(join(f.dir, "veto-tree"), "veto");

      const entry = f.session.sessionManager
        .getBranch()
        .find((item) => item.type === "message" && item.message.role === "user");

      assert.ok(entry);
      const navigated = await f.session.navigateTree(entry.id, { summarize: false });
      assert.equal(navigated.cancelled, navigation === "veto-tree");
    }

    assert.equal(f.childShutdowns(), 1);
    assert.doesNotMatch(JSON.stringify(f.session.messages), /obsolete child output/);
    f.nested.setResponses([fauxAssistantMessage("new scope result")]);
    const next = await f.call("pstack_task", task);
    assert.equal(next.isError, false, next.text);
    assert.match(next.text, /new scope result/);
  });
}
