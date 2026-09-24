import assert from "node:assert/strict";
import test from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { childFixture, receipt } from "./child-fixture.js";

const task = { model: "nested/child:rev1:low", prompt: "child assignment" };

async function aborted(signal: AbortSignal | undefined) {
  assert.ok(signal);
  await new Promise<void>((resolve) => {
    if (signal.aborted) resolve();
    else signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

await test("foreground abort during startup prevents inference and leaves a cancelled inspectable child", {
  timeout: 10000,
}, async (t) => {
  const f = await childFixture(t, { holdStartup: true });
  const running = f.call("pstack_task", task);
  await f.entered;
  const closing = f.session.abort();
  f.releaseStartup();
  await closing;
  await running;
  assert.equal(f.nested.state.callCount, 0);
  assert.equal(f.childShutdowns(), 1);
  const children = await f.call("pstack_tasks", { action: "list" });
  assert.equal(children.isError, false, children.text);
  assert.match(children.text, /"status":"cancelled"/);
  assert.doesNotMatch(children.text, /"status":"completed"/);
});

await test("cancellation reaches a running grandchild, suppresses delivery, and permits history-preserving resume", {
  timeout: 10000,
}, async (t) => {
  const f = await childFixture(t);
  const started = f.gate();
  let leafAborted = false;
  f.leaf.setResponses([
    async (_context, options) => {
      started.resolve();
      await aborted(options?.signal);
      leafAborted = true;

      return fauxAssistantMessage("obsolete leaf result");
    },
  ]);
  f.nested.setResponses([
    fauxAssistantMessage(
      fauxToolCall("pstack_task", {
        model: "leaf/reader:off",
        prompt: "long leaf",
        readonly: true,
        run_in_background: true,
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("child waiting for leaf"),
  ]);
  const launched = await f.call("pstack_task", { ...task, run_in_background: true });
  assert.equal(launched.isError, false, launched.text);
  const child = receipt(launched.text);
  await started.promise;
  const cancelled = await f.call("pstack_tasks", { action: "cancel", id: child.id });
  assert.equal(cancelled.isError, false, cancelled.text);
  assert.equal(receipt(cancelled.text).status, "cancelled");
  assert.equal(leafAborted, true);
  assert.doesNotMatch(JSON.stringify(f.session.messages), /obsolete leaf result/);
  f.nested.setResponses([
    (context) => {
      assert.match(JSON.stringify(context.messages), /child assignment/);
      assert.match(JSON.stringify(context.messages), /continue cancelled assignment/);

      return fauxAssistantMessage("resumed after cancellation");
    },
  ]);

  const resumed = await f.call("pstack_task", {
    resume: child.id,
    prompt: "continue cancelled assignment",
  });

  assert.equal(resumed.isError, false, resumed.text);
  assert.equal(receipt(resumed.text).id, child.id);
  assert.match(resumed.text, /resumed after cancellation/);
});

await test("grandchild cannot delegate past the two-level ceiling", {
  timeout: 10000,
}, async (t) => {
  const f = await childFixture(t);
  f.leaf.setResponses([
    fauxAssistantMessage(fauxToolCall("pstack_task", { prompt: "forbidden great-grandchild" }), {
      stopReason: "toolUse",
    }),
    (context) => {
      const result = context.messages.findLast((item) => item.role === "toolResult");
      assert.ok(result?.role === "toolResult" && result.isError);
      assert.match(JSON.stringify(result.content), /Maximum PStack delegation depth/);

      return fauxAssistantMessage("leaf verified depth ceiling");
    },
  ]);
  f.nested.setResponses([
    fauxAssistantMessage(
      fauxToolCall("pstack_task", {
        model: "leaf/reader:off",
        prompt: "permitted grandchild",
        readonly: true,
      }),
      { stopReason: "toolUse" },
    ),
    (context) => {
      const result = context.messages.findLast((item) => item.role === "toolResult");
      assert.ok(result?.role === "toolResult" && !result.isError);
      assert.match(JSON.stringify(result.content), /leaf verified depth ceiling/);

      return fauxAssistantMessage("child consumed depth evidence");
    },
  ]);
  const result = await f.call("pstack_task", task);
  assert.equal(result.isError, false, result.text);
  assert.match(result.text, /child consumed depth evidence/);
  assert.equal(f.leaf.state.callCount, 2);
});
