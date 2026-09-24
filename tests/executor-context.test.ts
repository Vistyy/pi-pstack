import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { fauxAssistantMessage, getCurrentSystemPrompt } from "@earendil-works/pi-ai";
import { stripFrontmatter } from "@earendil-works/pi-coding-agent";
import { childFixture, packageRoot, receipt } from "./child-fixture.js";

for (const profile of ["poteto-agent", "Comment Sicko"] as const) {
  await test(`${profile} source identity remains a system instruction on continuation`, {
    timeout: 10000,
  }, async (t) => {
    const f = await childFixture(t);
    const filename = profile === "poteto-agent" ? "poteto-agent.md" : "comment-sicko.md";

    const identity = stripFrontmatter(
      await readFile(join(packageRoot, "content/pstack/agents", filename), "utf8"),
    ).trim();

    f.nested.setResponses(
      ["initial", "continued"].map((assignment) => (context) => {
        assert.ok(getCurrentSystemPrompt(context.messages).includes(identity));
        const user = context.messages.findLast((item) => item.role === "user");
        assert.ok(user?.role === "user");
        assert.deepEqual(user.content, [{ type: "text", text: assignment }]);

        return fauxAssistantMessage(`finished ${assignment}`);
      }),
    );

    const first = await f.call("pstack_task", {
      subagent_type: profile,
      prompt: "initial",
      model: "nested/child:rev1:low",
      run_in_background: false,
    });

    assert.equal(first.isError, false, first.text);
    const child = receipt(first.text);

    const next = await f.call("pstack_task", {
      resume: child.id,
      prompt: "continued",
      run_in_background: false,
    });

    assert.equal(next.isError, false, next.text);
    assert.match(next.text, /finished continued/);
    assert.equal(f.nested.state.callCount, 2);
  });
}

await test("native parent compaction does not cancel a background child or lose its completion", {
  timeout: 10000,
}, async (t) => {
  const f = await childFixture(t);
  const started = f.gate();
  const barrier = f.gate();
  f.nested.setResponses([
    async () => {
      started.resolve();
      await barrier.promise;

      return fauxAssistantMessage("after compaction evidence");
    },
  ]);

  const launched = await f.call("pstack_task", {
    prompt: "persist through compaction",
    model: "nested/child:rev1:low",
    run_in_background: true,
  });

  assert.equal(launched.isError, false, launched.text);
  const child = receipt(launched.text);
  await started.promise;
  f.parent.setResponses([
    fauxAssistantMessage("fixture conversation summary"),
    fauxAssistantMessage("fixture turn summary"),
  ]);
  await f.session.compact();
  const inspected = await f.call("pstack_tasks", { action: "inspect", id: child.id });
  assert.equal(inspected.isError, false, inspected.text);
  assert.equal(receipt(inspected.text).status, "running");
  f.parent.setResponses([
    (context) => {
      assert.match(JSON.stringify(context.messages), /after compaction evidence/);

      return fauxAssistantMessage("received completion after compaction");
    },
  ]);
  const delivered = f.report();
  barrier.resolve();
  await delivered;
  await f.session.waitForIdle();
  const last = f.session.messages.findLast((item) => item.role === "assistant");
  assert.match(JSON.stringify(last), /received completion after compaction/);
  const completed = await f.call("pstack_tasks", { action: "inspect", id: child.id });
  assert.equal(receipt(completed.text).status, "completed");
});
