import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import {
  type FauxResponseFactory,
  fauxAssistantMessage,
  fauxToolCall,
  getCurrentSystemPrompt,
  getCurrentTools,
} from "@earendil-works/pi-ai";
import { stripFrontmatter } from "@earendil-works/pi-coding-agent";
import { childFixture, packageRoot, receipt } from "./child-fixture.js";

await test("global child-tool exclusions remove inherited integrations for new children", {
  timeout: 10000,
}, async (t) => {
  const f = await childFixture(t);
  await writeFile(
    join(f.dir, "settings.json"),
    `\uFEFF${JSON.stringify({
      unrelatedSetting: true,
      "pi-pstack": { excludedChildTools: ["fixture_lookup", "fixture_private"] },
    })}`,
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
    fauxAssistantMessage(fauxToolCall("fixture_private", {}), { stopReason: "toolUse" }),
    fauxAssistantMessage(fauxToolCall("fixture_echo", {}), { stopReason: "toolUse" }),
    (context) => {
      const result = context.messages.findLast((message) => message.role === "toolResult");
      assert.ok(result?.role === "toolResult");
      assert.equal(result.toolName, "fixture_echo");
      assert.equal(result.isError, false);

      const lookupResult = context.messages.findLast(
        (message) => message.role === "toolResult" && message.toolName === "fixture_lookup",
      );

      const privateResult = context.messages.findLast(
        (message) => message.role === "toolResult" && message.toolName === "fixture_private",
      );

      assert.ok(lookupResult?.role === "toolResult" && lookupResult.isError);
      assert.ok(privateResult?.role === "toolResult" && privateResult.isError);

      return fauxAssistantMessage("permitted sibling succeeded");
    },
  ]);

  const result = await f.call("pstack_task", {
    prompt: "Try the excluded tool",
    model: "nested/child:rev1:low",
    run_in_background: false,
  });

  assert.equal(result.isError, false, result.text);

  assert.match(result.text, /permitted sibling succeeded/);
  const child = receipt(result.text);
  assert.match(await readFile(join(f.dir, "echo.jsonl"), "utf8"), /called/);

  await assert.rejects(readFile(join(f.dir, "lookup.jsonl"), "utf8"), { code: "ENOENT" });
  await assert.rejects(readFile(join(f.dir, "private-start.jsonl"), "utf8"), { code: "ENOENT" });
  await assert.rejects(readFile(join(f.dir, "private-call.jsonl"), "utf8"), { code: "ENOENT" });

  const parentCall = await f.call("fixture_lookup", {});
  assert.equal(parentCall.isError, false, parentCall.text);
  assert.match(await f.lookup(), /root/);

  await writeFile(
    join(f.dir, "settings.json"),
    JSON.stringify({ "pi-pstack": { excludedChildTools: [] } }),
  );
  f.nested.setResponses([
    fauxAssistantMessage(fauxToolCall("fixture_lookup", {}), { stopReason: "toolUse" }),
    (context) => {
      const denied = context.messages.findLast(
        (message) => message.role === "toolResult" && message.toolName === "fixture_lookup",
      );

      assert.ok(denied?.role === "toolResult" && denied.isError);

      return fauxAssistantMessage("resumed session retained its tool policy");
    },
  ]);

  const resumed = await f.call("pstack_task", {
    resume: child.id,
    prompt: "Try the tool after changing global settings",
    run_in_background: false,
  });

  assert.equal(resumed.isError, false, resumed.text);
  assert.match(resumed.text, /resumed session retained/);

  f.nested.setResponses([
    fauxAssistantMessage(fauxToolCall("fixture_lookup", {}), { stopReason: "toolUse" }),
    fauxAssistantMessage("new session can use the tool"),
  ]);

  const fresh = await f.call("pstack_task", {
    prompt: "Use the now permitted tool",
    model: "nested/child:rev1:low",
    run_in_background: false,
  });

  assert.equal(fresh.isError, false, fresh.text);
  assert.match(await readFile(join(f.dir, "lookup.jsonl"), "utf8"), /child:rev1/);
  assert.equal(await readFile(join(f.dir, "private-start.jsonl"), "utf8"), "started\n");
});

await test("readonly children and descendants inspect with read and bash under an explicit no-write instruction", {
  timeout: 10000,
}, async (t) => {
  const f = await childFixture(t);

  const inspect: FauxResponseFactory = (context) => {
    assert.deepEqual(
      getCurrentTools(context.messages)
        .map((tool) => tool.name)
        .sort(),
      [
        "bash",
        "fixture_echo",
        "fixture_lookup",
        "fixture_private",
        "pstack_models",
        "pstack_question",
        "pstack_task",
        "pstack_tasks",
        "pstack_todo",
        "read",
      ],
    );
    assert.match(getCurrentSystemPrompt(context.messages), /Do not modify files or external state/);
    assert.match(getCurrentSystemPrompt(context.messages), /Bash is not sandboxed/);

    return fauxAssistantMessage(
      [
        fauxToolCall("read", { path: "AGENTS.md" }),
        fauxToolCall("bash", { command: "cat AGENTS.md" }),
        fauxToolCall("fixture_lookup", {}),
        fauxToolCall("write", { path: "AGENTS.md", content: "unexpected write" }),
        fauxToolCall("edit", {
          path: "AGENTS.md",
          oldText: "Project-only instruction marker",
          newText: "unexpected edit",
        }),
      ],
      { stopReason: "toolUse" },
    );
  };

  const verify = (context: Parameters<FauxResponseFactory>[0]) => {
    const integration = context.messages.findLast(
      (message) => message.role === "toolResult" && message.toolName === "fixture_lookup",
    );

    assert.ok(integration?.role === "toolResult" && !integration.isError);
    assert.ok(JSON.stringify(integration.content).includes(f.project));

    for (const name of ["write", "edit"]) {
      const denied = context.messages.findLast(
        (message) => message.role === "toolResult" && message.toolName === name,
      );

      assert.ok(denied?.role === "toolResult" && denied.isError);
    }

    for (const tool of ["read", "bash"]) {
      const result = context.messages.findLast(
        (message) => message.role === "toolResult" && message.toolName === tool,
      );

      assert.ok(result?.role === "toolResult");
      assert.equal(result.isError, false);
      assert.match(JSON.stringify(result.content), /Project-only instruction marker/);
    }
  };

  f.nested.setResponses([
    inspect,
    (context) => {
      verify(context);

      return fauxAssistantMessage(
        fauxToolCall("pstack_task", {
          prompt: "Inspect without writing",
          model: "leaf/reader:off",
          subagent_type: "poteto-agent",
          run_in_background: false,
        }),
        { stopReason: "toolUse" },
      );
    },
    (context) => {
      const result = context.messages.findLast(
        (message) => message.role === "toolResult" && message.toolName === "pstack_task",
      );

      assert.ok(result?.role === "toolResult" && !result.isError);
      assert.match(JSON.stringify(result.content), /leaf inspection verified/);

      return fauxAssistantMessage("both inspections verified");
    },
  ]);
  f.leaf.setResponses([
    inspect,
    (context) => {
      verify(context);

      return fauxAssistantMessage("leaf inspection verified");
    },
  ]);

  const result = await f.call("pstack_task", {
    prompt: "Inspect and delegate without writing",
    model: "nested/child:rev1:low",
    readonly: true,
    run_in_background: false,
  });

  assert.equal(result.isError, false, result.text);
  assert.match(result.text, /both inspections verified/);
  assert.equal(
    await readFile(join(f.project, "AGENTS.md"), "utf8"),
    "Project-only instruction marker",
  );
});

await test("readonly children keep inactive parent tools unavailable across resume", {
  timeout: 10000,
}, async (t) => {
  const f = await childFixture(t);
  const active = f.session.getActiveToolNames();
  f.session.setActiveToolsByName(
    active.filter((name) => !["bash", "fixture_private"].includes(name)),
  );

  const inspect: FauxResponseFactory = (context) => {
    assert.deepEqual(
      getCurrentTools(context.messages)
        .map((tool) => tool.name)
        .sort(),
      [
        "fixture_echo",
        "fixture_lookup",
        "pstack_models",
        "pstack_question",
        "pstack_task",
        "pstack_tasks",
        "pstack_todo",
        "read",
      ],
    );

    return fauxAssistantMessage(
      [
        fauxToolCall("read", { path: "AGENTS.md" }),
        fauxToolCall("bash", { command: "pwd" }),
        fauxToolCall("fixture_private", {}),
      ],
      { stopReason: "toolUse" },
    );
  };

  const verify: FauxResponseFactory = (context) => {
    for (const name of ["bash", "fixture_private"]) {
      const denied = context.messages.findLast(
        (message) => message.role === "toolResult" && message.toolName === name,
      );

      assert.ok(denied?.role === "toolResult" && denied.isError);
    }

    const read = context.messages.findLast(
      (message) => message.role === "toolResult" && message.toolName === "read",
    );

    assert.ok(read?.role === "toolResult" && !read.isError);
    assert.match(JSON.stringify(read.content), /Project-only instruction marker/);

    return fauxAssistantMessage("inactive tools stayed absent");
  };

  f.nested.setResponses([inspect, verify]);

  const first = await f.call("pstack_task", {
    prompt: "Inspect available evidence",
    readonly: true,
    model: "nested/child:rev1:low",
    run_in_background: false,
  });

  assert.equal(first.isError, false, first.text);
  assert.match(first.text, /inactive tools stayed absent/);
  f.session.setActiveToolsByName(active);
  f.nested.setResponses([inspect, verify]);

  const resumed = await f.call("pstack_task", {
    resume: receipt(first.text).id,
    prompt: "Recheck available evidence",
    run_in_background: false,
  });

  assert.equal(resumed.isError, false, resumed.text);
  assert.match(resumed.text, /inactive tools stayed absent/);
  await assert.rejects(readFile(join(f.dir, "private-start.jsonl")), { code: "ENOENT" });
});

await test("global exclusions also subtract tools from readonly children", {
  timeout: 10000,
}, async (t) => {
  const f = await childFixture(t);
  await writeFile(
    join(f.dir, "settings.json"),
    JSON.stringify({ "pi-pstack": { excludedChildTools: ["read", "bash"] } }),
  );
  f.nested.setResponses([
    fauxAssistantMessage(fauxToolCall("read", { path: join(f.project, "AGENTS.md") }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage(fauxToolCall("bash", { command: "pwd" }), { stopReason: "toolUse" }),
    (context) => {
      const bash = context.messages.findLast(
        (message) => message.role === "toolResult" && message.toolName === "bash",
      );

      assert.ok(bash?.role === "toolResult" && bash.isError);

      const denied = context.messages.findLast(
        (message) => message.role === "toolResult" && message.toolName === "read",
      );

      assert.ok(denied?.role === "toolResult" && denied.isError);

      return fauxAssistantMessage("readonly exclusion applied");
    },
  ]);

  const result = await f.call("pstack_task", {
    prompt: "Try excluded read",
    model: "nested/child:rev1:low",
    readonly: true,
    run_in_background: false,
  });

  assert.equal(result.isError, false, result.text);
  assert.match(result.text, /readonly exclusion applied/);
});

await test("grandchildren inherit exclusions from their immediate parent tools", {
  timeout: 10000,
}, async (t) => {
  const f = await childFixture(t);
  await writeFile(
    join(f.dir, "settings.json"),
    JSON.stringify({ "pi-pstack": { excludedChildTools: ["fixture_lookup"] } }),
  );
  f.nested.setResponses([
    async () => {
      await writeFile(
        join(f.dir, "settings.json"),
        JSON.stringify({ "pi-pstack": { excludedChildTools: [] } }),
      );

      return fauxAssistantMessage(
        fauxToolCall("pstack_task", {
          prompt: "Try inherited exclusion after the global policy changes",
          model: "leaf/reader:off",
          readonly: false,
        }),
        { stopReason: "toolUse" },
      );
    },
    (context) => {
      const returned = context.messages.findLast(
        (message) => message.role === "toolResult" && message.toolName === "pstack_task",
      );

      assert.ok(returned?.role === "toolResult" && !returned.isError);
      assert.match(JSON.stringify(returned.content), /grandchild blocked/);

      return fauxAssistantMessage("grandchild completed");
    },
  ]);
  f.leaf.setResponses([
    fauxAssistantMessage(fauxToolCall("fixture_lookup", {}), { stopReason: "toolUse" }),
    (context) => {
      const denied = context.messages.findLast(
        (message) => message.role === "toolResult" && message.toolName === "fixture_lookup",
      );

      assert.ok(denied?.role === "toolResult" && denied.isError);

      return fauxAssistantMessage("grandchild blocked");
    },
  ]);

  const result = await f.call("pstack_task", {
    prompt: "Delegate to grandchild",
    model: "nested/child:rev1:low",
    run_in_background: false,
  });

  assert.equal(result.isError, false, result.text);
  await assert.rejects(readFile(join(f.dir, "lookup.jsonl"), "utf8"), { code: "ENOENT" });
});

await test("unreadable global policy fails before child effects", { timeout: 10000 }, async (t) => {
  const f = await childFixture(t);
  await mkdir(join(f.dir, "settings.json"));
  f.nested.setResponses([fauxAssistantMessage("should not be requested")]);

  const result = await f.call("pstack_task", {
    prompt: "Reject unreadable global settings",
    model: "nested/child:rev1:low",
    run_in_background: false,
  });

  assert.equal(result.isError, true);
  assert.match(result.text, /Cannot read global child-tool policy/);
  assert.equal(f.nested.state.callCount, 0);
});

for (const [label, settings] of [
  ["malformed JSON", "{"],
  ["empty global settings file", ""],
  ["malformed namespace", JSON.stringify({ "pi-pstack": [] })],
  ["malformed tool list", JSON.stringify({ "pi-pstack": { excludedChildTools: [""] } })],
] as const) {
  await test(`${label} global child-tool policy fails before child effects`, {
    timeout: 10000,
  }, async (t) => {
    const f = await childFixture(t);
    await writeFile(join(f.dir, "settings.json"), settings);
    f.nested.setResponses([fauxAssistantMessage("should not be requested")]);

    const result = await f.call("pstack_task", {
      prompt: "Reject invalid policy",
      model: "nested/child:rev1:low",
      run_in_background: false,
    });

    assert.equal(result.isError, true);
    assert.match(result.text, /global|settings|JSON|excludedChildTools/i);
    assert.equal(f.nested.state.callCount, 0);
  });
}

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

await test("background completion is delivered during manual compaction", {
  timeout: 10000,
}, async (t) => {
  const f = await childFixture(t);
  const childStarted = f.gate();
  const childRelease = f.gate();
  const compactionStarted = f.gate();
  const compactionRelease = f.gate();
  f.nested.setResponses([
    async () => {
      childStarted.resolve();
      await childRelease.promise;

      return fauxAssistantMessage("result produced during compaction");
    },
  ]);

  const launched = await f.call("pstack_task", {
    prompt: "finish while the parent compacts",
    model: "nested/child:rev1:low",
    run_in_background: true,
  });

  assert.equal(launched.isError, false, launched.text);
  await childStarted.promise;
  const received: string[] = [];

  f.parent.setResponses([
    async () => {
      compactionStarted.resolve();
      await compactionRelease.promise;

      return fauxAssistantMessage("fixture compaction summary");
    },
    (context) => {
      received.push(JSON.stringify(context.messages));

      return fauxAssistantMessage("received completion during compaction");
    },
  ]);
  const failed = Promise.withResolvers<never>();

  const unsubscribe = f.session.extensionRunner.onError((error) => {
    failed.reject(new Error(error.error));
  });

  const compacting = f.session.compact();

  try {
    await compactionStarted.promise;
    const delivered = f.report();
    childRelease.resolve();
    await Promise.race([delivered, failed.promise]);
    assert.equal(f.session.isCompacting, true);
    assert.equal(received.length, 1);
    assert.match(received[0] ?? "", /result produced during compaction/);
    assert.deepEqual(f.errors, []);
  } finally {
    unsubscribe();
    compactionRelease.resolve();
    await compacting;
  }

  assert.match(JSON.stringify(f.session.messages), /result produced during compaction/);
});
