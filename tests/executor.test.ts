import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  contentText,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  getCurrentSystemPrompt,
  InMemoryCredentialStore,
} from "@earendil-works/pi-ai";
import {
  type AgentSession,
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Check } from "typebox/value";
import { completionReportPrefix } from "../src/completion-report.js";

const root = fileURLToPath(new URL("..", import.meta.url));

await test("Pi package registration discovers the bundled companion methods", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "pstack-discovery-"));

  t.after(() => rm(directory, { recursive: true, force: true }));

  const loader = new DefaultResourceLoader({
    cwd: directory,
    agentDir: directory,
    settingsManager: SettingsManager.inMemory({ packages: [root] }),
    noExtensions: true,
    noPromptTemplates: true,
    noThemes: true,
  });

  await loader.reload();
  const result = loader.getSkills();
  assert.deepEqual(result.diagnostics, []);

  for (const name of ["deslop", "control-cli", "control-ui"]) {
    const skill = result.skills.find((item) => item.name === name);
    assert.equal(skill?.filePath, join(root, "content/pstack/skills", name, "SKILL.md"));
  }
});

await test("native child receives a fresh conversation and returns the entire final result", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pstack-child-"));
  const agentDirKey = "PI_CODING_AGENT_DIR";
  const before = process.env[agentDirKey];
  const gates: Array<() => void> = [];
  let ownedSession: AgentSession | undefined;
  process.env[agentDirKey] = dir;
  t.after(async () => {
    for (const release of gates) release();

    try {
      if (ownedSession) {
        await ownedSession.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
        await ownedSession.abort();
        ownedSession.dispose();
      }
    } finally {
      if (before === undefined) delete process.env[agentDirKey];
      else process.env[agentDirKey] = before;
      await rm(dir, { recursive: true, force: true });
    }
  });
  const project = join(dir, "project");
  await mkdir(project);
  await writeFile(join(project, "AGENTS.md"), "Project instruction sentinel");
  const integration = join(dir, "integration.mjs");
  await writeFile(
    integration,
    `import { appendFile, writeFile } from "node:fs/promises";
export default (pi) => {
  pi.on("session_start", async () => { await appendFile(${JSON.stringify(join(dir, "integration-lifecycle"))}, "start\\n"); });
  pi.on("session_shutdown", async () => { await appendFile(${JSON.stringify(join(dir, "integration-lifecycle"))}, "shutdown\\n"); });
  pi.registerTool({ name: "fixture_integration", label: "Fixture integration", description: "Record child cwd", parameters: { type: "object", properties: {} },
    async execute(_id, _params, _signal, _update, ctx) {
      await writeFile(${JSON.stringify(join(dir, "integration-result"))}, ctx.cwd);
      return { content: [{ type: "text", text: ctx.cwd }], details: {} };
    } });
};`,
  );

  const provider = fauxProvider({
    provider: "fixture",
    models: [{ id: "child:rev1", reasoning: true }],
    tokensPerSecond: Infinity,
  });

  const registry = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsPath: null,
    modelsStorePath: join(dir, "catalog.json"),
    allowModelNetwork: false,
  });

  registry.registerNativeProvider(provider.provider);

  const nestedProvider = fauxProvider({
    provider: "nested",
    models: [{ id: "worker", reasoning: false }],
    tokensPerSecond: Infinity,
  });

  const leafProvider = fauxProvider({
    provider: "leaf",
    models: [{ id: "reader", reasoning: false }],
    tokensPerSecond: Infinity,
  });

  registry.registerNativeProvider(nestedProvider.provider);
  registry.registerNativeProvider(leafProvider.provider);
  await registry.getAvailable();
  const settings = SettingsManager.inMemory({ packages: [], compaction: { enabled: false } });

  const loader = new DefaultResourceLoader({
    cwd: project,
    agentDir: dir,
    settingsManager: settings,
    noExtensions: true,
    noSkills: true,
    additionalExtensionPaths: [join(root, "extensions/index.ts"), integration],
  });

  await loader.reload();

  const { session } = await createAgentSession({
    cwd: project,
    agentDir: dir,
    resourceLoader: loader,
    modelRuntime: registry,
    model: provider.getModel(),
    thinkingLevel: "high",
    settingsManager: settings,
    sessionManager: SessionManager.create(project, join(dir, "parent-history")),
  });

  ownedSession = session;
  await session.bindExtensions({ mode: "rpc" });
  let childPrompt = "";
  let childContext = 0;
  provider.setResponses([
    (context) => {
      assert.doesNotMatch(
        getCurrentSystemPrompt(context.messages),
        /Current Pi (?:transcript|history scope)/,
      );
      assert.ok(getCurrentSystemPrompt(context.messages).includes(`<cwd>\n${project}\n</cwd>`));

      return fauxAssistantMessage(
        fauxToolCall("pstack_task", {
          prompt: "Inspect the project",
          model: "fixture/child:rev1:low",
          subagent_type: "generalPurpose",
          readonly: true,
        }),
        { stopReason: "toolUse" },
      );
    },
    (context) => {
      childPrompt = getCurrentSystemPrompt(context.messages);
      childContext = context.messages.filter((message) => message.role === "user").length;

      return fauxAssistantMessage("child evidence");
    },
    fauxAssistantMessage("parent received"),
  ]);
  await session.prompt("Parent secret");

  const result = session.messages.findLast(
    (message) => message.role === "toolResult" && message.toolName === "pstack_task",
  );

  assert.ok(result?.role === "toolResult");
  assert.equal(result.isError, false, JSON.stringify(result.content));

  const payload: unknown = JSON.parse(
    result.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join(""),
  );

  assert.ok(
    Check(
      Type.Object({
        id: Type.String(),
        output: Type.String(),
        model: Type.String(),
        readonly: Type.Boolean(),
        transcript: Type.String(),
      }),
      payload,
    ),
  );
  assert.equal(payload.output, "child evidence");
  assert.equal(payload.model, "fixture/child:rev1:low");
  assert.equal(payload.readonly, true);
  assert.equal(childContext, 1);
  assert.doesNotMatch(childPrompt, /Current Pi (?:transcript|history scope)/);
  assert.ok(childPrompt.includes(`<cwd>\n${project}\n</cwd>`));
  assert.match(childPrompt, /Project instruction sentinel/);
  assert.doesNotMatch(childPrompt, /Parent secret/);
  assert.match(await readFile(payload.transcript, "utf8"), /child evidence/);
  provider.setResponses([
    fauxAssistantMessage(
      fauxToolCall("pstack_task", { prompt: "Use configured integration", readonly: false }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage(fauxToolCall("fixture_integration", {}), { stopReason: "toolUse" }),
    fauxAssistantMessage("integration complete"),
    fauxAssistantMessage("parent done"),
  ]);
  await session.prompt("Check configured integration");
  assert.equal(await readFile(join(dir, "integration-result"), "utf8"), project);
  assert.match(await readFile(join(dir, "integration-lifecycle"), "utf8"), /start/);

  let releaseChild: (() => void) | undefined;

  const childGate = new Promise<void>((resolve) => {
    releaseChild = resolve;
    gates.push(resolve);
  });

  let resolveReceipt: (() => void) | undefined;

  const receipt = new Promise<void>((resolve) => {
    resolveReceipt = resolve;
  });

  const unsubscribe = session.subscribe((event) => {
    if (
      event.type === "message_end" &&
      event.message.role === "assistant" &&
      event.message.content.some((part) => part.type === "text" && part.text === "receipt consumed")
    )
      resolveReceipt?.();
  });

  provider.setResponses([
    fauxAssistantMessage(
      fauxToolCall("pstack_task", { prompt: "Work in background", run_in_background: true }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("parent continued"),
    async () => {
      await childGate;

      return fauxAssistantMessage("background evidence");
    },
    fauxAssistantMessage("receipt consumed"),
  ]);
  await session.prompt("Launch a background child");

  const launched = session.messages.findLast(
    (message) => message.role === "toolResult" && message.toolName === "pstack_task",
  );

  assert.ok(launched?.role === "toolResult");
  assert.match(JSON.stringify(launched.content), /running/);

  const launchedText = launched.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");

  const child: unknown = JSON.parse(launchedText);

  assert.ok(Check(Type.Object({ id: Type.String() }), child));

  releaseChild?.();
  await receipt;
  await session.waitForIdle();
  unsubscribe();

  const wake = session.messages.findLast(
    (message) =>
      message.role === "user" && contentText(message.content).startsWith(completionReportPrefix),
  );

  assert.ok(wake?.role === "user");

  const text = contentText(wake.content);

  assert.deepEqual(JSON.parse(text.slice(completionReportPrefix.length)), {
    id: child.id,
    attempt: 1,
    status: "completed",
    report: { kind: "full", text: "background evidence" },
  });

  provider.setResponses([
    fauxAssistantMessage(fauxToolCall("pstack_tasks", { action: "inspect", id: child.id }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("result inspected"),
  ]);
  await session.prompt("Inspect completed child");

  const inspected = session.messages.findLast(
    (message) => message.role === "toolResult" && message.toolName === "pstack_tasks",
  );

  assert.ok(inspected?.role === "toolResult" && !inspected.isError);
  assert.match(JSON.stringify(inspected.content), /background evidence/);

  provider.setResponses([
    fauxAssistantMessage(
      fauxToolCall("pstack_task", { prompt: "Observe provider failure", run_in_background: false }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("", { stopReason: "error", errorMessage: "fixture provider failed" }),
    fauxAssistantMessage("parent observed failure"),
  ]);
  await session.prompt("Test provider error");

  const failure = session.messages.findLast(
    (message) => message.role === "toolResult" && message.toolName === "pstack_task",
  );

  assert.ok(failure?.role === "toolResult");
  assert.equal(failure.isError, true);
  assert.match(JSON.stringify(failure.content), /fixture provider failed/);

  nestedProvider.setResponses([
    fauxAssistantMessage(
      fauxToolCall("pstack_task", {
        prompt: "Grandchild checks",
        model: "leaf/reader:off",
        readonly: true,
      }),
      { stopReason: "toolUse" },
    ),
    (context) => {
      const returned = context.messages.findLast((message) => message.role === "toolResult");
      assert.ok(returned?.role === "toolResult");
      assert.equal(returned.isError, false, JSON.stringify(returned.content));
      assert.match(JSON.stringify(returned.content), /grandchild evidence/);

      return fauxAssistantMessage("child synthesized evidence");
    },
  ]);
  leafProvider.setResponses([fauxAssistantMessage("grandchild evidence")]);
  provider.setResponses([
    fauxAssistantMessage(
      fauxToolCall("pstack_task", {
        prompt: "Root delegates",
        model: "nested/worker:off",
        readonly: true,
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("root got synthesis"),
  ]);
  await session.prompt("Nested delegation");

  const nested = session.messages.findLast(
    (message) => message.role === "toolResult" && message.toolName === "pstack_task",
  );

  assert.ok(nested?.role === "toolResult");
  assert.equal(nested.isError, false, JSON.stringify(nested.content));
  assert.match(JSON.stringify(nested.content), /child synthesized evidence/);
  assert.equal(leafProvider.state.callCount, 1);
  nestedProvider.setResponses([
    fauxAssistantMessage(fauxToolCall("pstack_task", { prompt: "Escalate", readonly: false }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("escalation rejected"),
  ]);
  provider.setResponses([
    fauxAssistantMessage(
      fauxToolCall("pstack_task", {
        prompt: "Readonly owner",
        model: "nested/worker:off",
        readonly: true,
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("root saw rejection"),
  ]);
  await session.prompt("Enforce readonly ceiling");

  const ceiling = session.messages.findLast(
    (message) => message.role === "toolResult" && message.toolName === "pstack_task",
  );

  assert.ok(ceiling?.role === "toolResult");

  const ceilingText = ceiling.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");

  const ceilingData: unknown = JSON.parse(ceilingText);
  assert.ok(Check(Type.Object({ transcript: Type.String() }), ceilingData));
  assert.match(await readFile(ceilingData.transcript, "utf8"), /Readonly child cannot escalate/);

  let resumedHistory = "";
  provider.setResponses([
    fauxAssistantMessage(
      fauxToolCall("pstack_task", {
        resume: payload.id,
        prompt: "Continue prior task",
        run_in_background: false,
      }),
      { stopReason: "toolUse" },
    ),
    (context) => {
      resumedHistory = JSON.stringify(context.messages);

      return fauxAssistantMessage("continued evidence");
    },
    fauxAssistantMessage("root got continuation"),
  ]);
  await session.prompt("Resume owned child");
  assert.match(resumedHistory, /Inspect the project/);
  assert.match(resumedHistory, /child evidence/);
  assert.doesNotMatch(resumedHistory, /Parent secret/);

  let systemText = "";
  let childMethodsRead = false;
  nestedProvider.setResponses([
    (context) => {
      systemText = getCurrentSystemPrompt(context.messages);

      const injectedSkills = systemText.match(/Packaged PStack skills directory: ([^\n]+)/)?.[1];
      assert.equal(injectedSkills, join(root, "content/pstack/skills"));
      assert.ok(injectedSkills);

      const user = context.messages.findLast((message) => message.role === "user");
      assert.ok(user?.role === "user");
      assert.deepEqual(user.content, [{ type: "text", text: "Poteto assignment" }]);

      return fauxAssistantMessage(
        ["deslop", "control-cli", "control-ui"].map((name) =>
          fauxToolCall("read", { path: join(injectedSkills, name, "SKILL.md") }, { id: name }),
        ),
        { stopReason: "toolUse" },
      );
    },
    (context) => {
      for (const name of ["deslop", "control-cli", "control-ui"]) {
        const result = context.messages.find(
          (message) => message.role === "toolResult" && message.toolCallId === name,
        );

        assert.ok(result?.role === "toolResult", name);
        assert.equal(result.isError, false, name);
        assert.ok(
          result.content.some(
            (part) => part.type === "text" && part.text.includes(`name: ${name}\n`),
          ),
          name,
        );
      }

      childMethodsRead = true;

      return fauxAssistantMessage("poteto result");
    },
  ]);
  provider.setResponses([
    fauxAssistantMessage(
      fauxToolCall("pstack_task", {
        prompt: "Poteto assignment",
        subagent_type: "poteto-agent",
        model: "nested/worker:off",
        run_in_background: false,
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("parent finished Poteto"),
  ]);
  await session.prompt("Delegate Poteto");
  const potetoResult = session.messages.findLast((item) => item.role === "toolResult");
  assert.ok(potetoResult?.role === "toolResult" && !potetoResult.isError);
  assert.ok(
    systemText.includes(
      "# Poteto subagent\n\nYou are operating as poteto-mode's full agent style. The full `poteto-mode` skill, including its inline Principles index, is supplied in your system prompt. Follow it in full before doing any work. Navigate to a leaf `principle-*` skill whenever you apply that principle.",
    ),
  );
  assert.doesNotMatch(systemText, /Poteto assignment/);
  assert.match(systemText, /Packaged PStack skills directory/);
  assert.equal(childMethodsRead, true);

  assert.doesNotMatch(systemText, /Parent secret/);

  let started = 0;
  let bothStarted: (() => void) | undefined;

  const barrier = new Promise<void>((resolve) => {
    bothStarted = resolve;
    gates.push(resolve);
  });

  const simultaneous = async (label: string) => {
    started += 1;

    if (started === 2) bothStarted?.();
    await barrier;

    return fauxAssistantMessage(label);
  };

  nestedProvider.setResponses([() => simultaneous("left result")]);
  leafProvider.setResponses([() => simultaneous("right result")]);
  provider.setResponses([
    fauxAssistantMessage(
      [
        fauxToolCall("pstack_task", { prompt: "left", model: "nested/worker:off" }),
        fauxToolCall("pstack_task", { prompt: "right", model: "leaf/reader:off" }),
      ],
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("parallel parent done"),
  ]);
  await session.prompt("Run both independent children");
  assert.equal(started, 2);

  const siblings = session.messages
    .filter((message) => message.role === "toolResult" && message.toolName === "pstack_task")
    .slice(-2);

  assert.equal(siblings.length, 2);
  assert.match(JSON.stringify(siblings), /left result/);
  assert.match(JSON.stringify(siblings), /right result/);

  let childStarted: (() => void) | undefined;

  const entered = new Promise<void>((resolve) => {
    childStarted = resolve;
  });

  nestedProvider.setResponses([
    async (_context, options) => {
      childStarted?.();
      await new Promise<void>((resolve) => {
        options?.signal?.addEventListener("abort", () => resolve(), { once: true });
      });

      return fauxAssistantMessage("aborted response", { stopReason: "aborted" });
    },
  ]);
  provider.setResponses([
    fauxAssistantMessage(
      fauxToolCall("pstack_task", {
        prompt: "Pending work",
        model: "nested/worker:off",
        run_in_background: true,
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("root left pending work"),
  ]);
  await session.prompt("Start work before shutdown");
  await entered;
  await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
  session.dispose();
  ownedSession = undefined;
  assert.equal(session.isStreaming, false);
  assert.doesNotMatch(JSON.stringify(session.messages), /aborted response/);
  assert.match(await readFile(join(dir, "integration-lifecycle"), "utf8"), /shutdown/);
});
