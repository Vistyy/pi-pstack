import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { fauxAssistantMessage, fauxToolCall, getCurrentSystemPrompt } from "@earendil-works/pi-ai";
import { stripFrontmatter } from "@earendil-works/pi-coding-agent";
import { childFixture, packageRoot, receipt } from "./child-fixture.js";

await test("global child-tool exclusions remove inherited integrations for new children", {
  timeout: 10000,
}, async (t) => {
  const f = await childFixture(t);
  await writeFile(
    join(f.dir, "settings.json"),
    JSON.stringify({
      unrelatedSetting: true,
      "pi-pstack": { excludedChildTools: ["fixture_lookup"] },
    }),
  );
  await mkdir(join(f.project, ".pi"));
  await writeFile(
    join(f.project, ".pi/settings.json"),
    JSON.stringify({
      "pi-pstack": { excludedChildTools: [] },
    }),
  );
  f.nested.setResponses([
    fauxAssistantMessage(fauxToolCall("fixture_lookup", {}), { stopReason: "toolUse" }),
    fauxAssistantMessage(fauxToolCall("fixture_echo", {}), { stopReason: "toolUse" }),
    fauxAssistantMessage("tool unavailable"),
  ]);

  const result = await f.call("pstack_task", {
    prompt: "Try the excluded tool",
    model: "nested/child:rev1:low",
    run_in_background: false,
  });

  assert.equal(result.isError, false, result.text);

  assert.doesNotMatch(result.text, /lookup/);
  assert.match(await readFile(join(f.dir, "echo.jsonl"), "utf8"), /called/);

  await assert.rejects(readFile(join(f.dir, "lookup.jsonl"), "utf8"), { code: "ENOENT" });
});

await test("malformed global child-tool policy fails before child model effects", {
  timeout: 10000,
}, async (t) => {
  const f = await childFixture(t);
  await writeFile(
    join(f.dir, "settings.json"),
    JSON.stringify({ "pi-pstack": { excludedChildTools: [""] } }),
  );
  f.nested.setResponses([fauxAssistantMessage("should not be requested")]);

  const result = await f.call("pstack_task", {
    prompt: "Reject invalid policy",
    model: "nested/child:rev1:low",
    run_in_background: false,
  });

  assert.equal(result.isError, true);

  assert.match(result.text, /excludedChildTools/);

  assert.equal(f.nested.state.callCount, 0);
});

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
