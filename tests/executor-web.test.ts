import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import {
  type FauxResponseFactory,
  fauxAssistantMessage,
  fauxToolCall,
  getCurrentTools,
} from "@earendil-works/pi-ai";
import { childFixture, packageRoot, receipt } from "./child-fixture.js";

type Scenario = { name: string; inactive: string[]; excluded: string[]; allowed: string[] };

const scenarios: Scenario[] = [
  { name: "available", inactive: [], excluded: [], allowed: ["web_search", "web_fetch"] },
  { name: "inactive fetch", inactive: ["web_fetch"], excluded: [], allowed: ["web_search"] },
  { name: "excluded search", inactive: [], excluded: ["web_search"], allowed: ["web_fetch"] },
  { name: "neither selected", inactive: ["web_fetch"], excluded: ["web_search"], allowed: [] },
];

for (const scenario of scenarios) {
  await test(`inspection web tools: ${scenario.name}`, { timeout: 10000 }, async (t) => {
    const f = await childFixture(t, {
      extensionPaths: [join(packageRoot, "tests/web-tools-extension.ts")],
    });

    f.session.setActiveToolsByName(
      f.session.getActiveToolNames().filter((name) => !scenario.inactive.includes(name)),
    );
    await writeFile(
      join(f.dir, "settings.json"),
      JSON.stringify({
        "pi-pstack": { excludedChildTools: [...scenario.excluded, "fixture_web_write"] },
      }),
    );

    const inspect: FauxResponseFactory = (context) => {
      assert.deepEqual(
        getCurrentTools(context.messages)
          .map((tool) => tool.name)
          .sort(),
        [
          "read",
          "bash",
          "fixture_echo",
          "fixture_lookup",
          "fixture_private",
          "pstack_models",
          "pstack_question",
          "pstack_task",
          "pstack_tasks",
          "pstack_todo",
          ...scenario.allowed,
        ].sort(),
      );

      return fauxAssistantMessage(
        [
          fauxToolCall("web_search", { query: "public fixture evidence" }),
          fauxToolCall("web_fetch", { url: "https://example.com/evidence" }),
          fauxToolCall("fixture_web_write", {}),
        ],
        { stopReason: "toolUse" },
      );
    };

    const verify = (context: Parameters<FauxResponseFactory>[0]) => {
      for (const name of ["web_search", "web_fetch", "fixture_web_write"]) {
        const result = context.messages.findLast(
          (message) => message.role === "toolResult" && message.toolName === name,
        );

        assert.ok(result?.role === "toolResult");
        assert.equal(
          result.isError,
          !scenario.allowed.includes(name),
          JSON.stringify(result.content),
        );

        if (scenario.allowed.includes(name)) assert.match(JSON.stringify(result.content), /PROOF:/);
      }
    };

    f.nested.setResponses([
      inspect,
      async (context) => {
        verify(context);
        await writeFile(
          join(f.dir, "settings.json"),
          JSON.stringify({ "pi-pstack": { excludedChildTools: [] } }),
        );

        return fauxAssistantMessage(
          fauxToolCall("pstack_task", {
            prompt: "Inspect public evidence",
            model: "leaf/reader:off",
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
        assert.match(JSON.stringify(result.content), /leaf web verified/);

        return fauxAssistantMessage("parent web verified");
      },
    ]);
    f.leaf.setResponses([
      inspect,
      (context) => {
        verify(context);

        return fauxAssistantMessage("leaf web verified");
      },
    ]);

    const result = await f.call("pstack_task", {
      prompt: "Research without writing",
      model: "nested/child:rev1:low",
      readonly: true,
      run_in_background: false,
    });

    assert.equal(result.isError, false, result.text);
    assert.match(result.text, /parent web verified/);
    f.session.setActiveToolsByName(
      f.session.getActiveToolNames().filter((name) => !["web_search", "web_fetch"].includes(name)),
    );
    f.nested.setResponses([
      inspect,
      (context) => {
        verify(context);

        return fauxAssistantMessage("saved web plan retained");
      },
    ]);

    const resumed = await f.call("pstack_task", {
      resume: receipt(result.text).id,
      prompt: "Recheck public evidence",
      run_in_background: false,
    });

    assert.equal(resumed.isError, false, resumed.text);
    assert.match(resumed.text, /saved web plan retained/);
    await assert.rejects(readFile(join(f.project, "unexpected-web-write")), { code: "ENOENT" });
  });
}
