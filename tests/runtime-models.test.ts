import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import {
  contentText,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  getCurrentSystemPrompt,
  InMemoryCredentialStore,
  type ToolCall,
} from "@earendil-works/pi-ai";
import {
  type AgentSession,
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  stripFrontmatter,
} from "@earendil-works/pi-coding-agent";

const root = fileURLToPath(new URL("..", import.meta.url));

const agentDirKey = "PI_CODING_AGENT_DIR";

const judge = "fixture/judge:rev1:high";

function roleChoices() {
  return {
    "feature, refactoring": judge,
    "bug-fix": judge,
    "perf-issue": judge,
    hillclimb: judge,
    "judgment and prose": judge,
    "hardest tasks": judge,
    "how explorer": judge,
    "how explainer": judge,
    "why investigators": judge,
    "why synthesizer": judge,
    "reflect tooling": judge,
    "reflect judgment, divergent, synthesizer": judge,
    "arena runners": [judge, judge],
    "arena cross-judge pool": [judge],
    "swarm workers": judge,
    "architect runners": ["inherit-parent", judge, "auto"],
    "interrogate reviewers": [judge, judge, judge],
  };
}

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "pstack-sdk-test-"));
  const previous = process.env[agentDirKey];
  process.env[agentDirKey] = directory;
  let started: AgentSession | undefined;
  t.after(async () => {
    started?.dispose();

    if (previous === undefined) delete process.env[agentDirKey];
    else process.env[agentDirKey] = previous;
    await rm(directory, { recursive: true, force: true });
  });

  const settingsManager = SettingsManager.inMemory({
    packages: [],
    compaction: { enabled: false, keepRecentTokens: 1000, reserveTokens: 1000 },
  });

  const runtime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsPath: null,
    modelsStorePath: join(directory, "catalog.json"),
    refreshOnCreate: false,
    allowModelNetwork: false,
  });

  const provider = fauxProvider({
    provider: "fixture",
    models: [
      { id: "judge:rev1", reasoning: true },
      { id: "plain", reasoning: false },
    ],
    tokensPerSecond: Number.POSITIVE_INFINITY,
  });

  runtime.registerNativeProvider(provider.provider);
  await runtime.getAvailable("fixture");

  const loader = new DefaultResourceLoader({
    cwd: directory,
    agentDir: directory,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noContextFiles: true,
    noThemes: true,
    noPromptTemplates: true,
    additionalExtensionPaths: [join(root, "extensions/index.ts")],
    additionalSkillPaths: [
      join(root, "content/pstack/skills/poteto-mode"),
      join(root, "content/pstack/skills/setup-pstack"),
    ],
  });

  await loader.reload();
  const sessionManager = SessionManager.inMemory(directory);

  const { session, extensionsResult } = await createAgentSession({
    cwd: directory,
    agentDir: directory,
    modelRuntime: runtime,
    model: provider.getModel(),
    thinkingLevel: "high",
    settingsManager,
    sessionManager,
    resourceLoader: loader,
  });

  started = session;
  const errors: string[] = [];
  await session.bindExtensions({
    mode: "rpc",
    onError: (error) => {
      errors.push(error.error);
    },
  });
  assert.deepEqual(extensionsResult.errors, []);
  assert.ok(session.agent.state.tools.some((tool) => tool.name === "pstack_models"));

  const call = async (name: string, args: ToolCall["arguments"]) => {
    provider.setResponses([
      fauxAssistantMessage(fauxToolCall(name, args), { stopReason: "toolUse" }),
      fauxAssistantMessage("fixture complete"),
    ]);
    await session.prompt("Execute the fixture's tool action.");

    const message = session.messages.findLast(
      (item) => item.role === "toolResult" && item.toolName === name,
    );

    assert.ok(message?.role === "toolResult");

    return {
      isError: message.isError,
      text: message.content.map((part) => (part.type === "text" ? part.text : "")).join("\n"),
    };
  };

  const prompt = async (text: string) => {
    let system = "";
    provider.setResponses([
      (context) => {
        system = getCurrentSystemPrompt(context.messages);

        return fauxAssistantMessage("fixture complete");
      },
    ]);
    await session.prompt(text);

    return system;
  };

  return { directory, session, sessionManager, provider, runtime, errors, call, prompt };
}

await test("native tool loop persists exact model roles, applies budgets, resolves aliases, and reports invalid targets", async (t) => {
  const f = await fixture(t);
  const listed = await f.call("pstack_models", { action: "list" });
  assert.equal(listed.isError, false);
  assert.partialDeepStrictEqual(JSON.parse(listed.text), [
    { provider: "fixture", id: "judge:rev1", thinking: ["low", "medium", "high"] },
  ]);
  const initial = await f.call("pstack_models", { action: "get" });
  assert.equal(initial.isError, false);
  assert.partialDeepStrictEqual(JSON.parse(initial.text), {
    config: null,
    parentSelector: "fixture/judge:rev1:high",
    roles: null,
    sourceDefaults: {
      "arena runners": ["claude-opus-5-5-max", "gpt-5.6-sol-max", "grok-4.7-xhigh-fast"],
    },
  });
  const roles = roleChoices();
  const saved = await f.call("pstack_models", { action: "set", budget: "small", roles });
  assert.equal(saved.isError, false, saved.text);

  const persisted: unknown = JSON.parse(
    await readFile(join(f.directory, "pstack-models.json"), "utf8"),
  );

  assert.partialDeepStrictEqual(persisted, {
    version: 1,
    budget: "small",
    roles: {
      "feature, refactoring": "fixture/judge:rev1:medium",
      "arena runners": ["fixture/judge:rev1:medium", "fixture/judge:rev1:medium"],
      "architect runners": ["inherit-parent", "fixture/judge:rev1:medium", "auto"],
    },
  });
  f.session.setThinkingLevel("low");
  const current = await f.call("pstack_models", { action: "get" });
  assert.match(
    await f.prompt("parent selector inspection"),
    /"parentSelector":"fixture\/judge:rev1:low"/,
  );
  assert.partialDeepStrictEqual(JSON.parse(current.text), {
    parentSelector: "fixture/judge:rev1:low",
    roles: {
      "architect runners": [
        { requested: "inherit-parent", selector: "fixture/judge:rev1:low" },
        { requested: "fixture/judge:rev1:medium", selector: "fixture/judge:rev1:medium" },
        { requested: "auto", selector: "fixture/judge:rev1:low" },
      ],
    },
  });
  const before = await readFile(join(f.directory, "pstack-models.json"), "utf8");

  const wrongShape = await f.call("pstack_models", {
    action: "set",
    budget: "unlimited",
    roles: { ...roles, "arena runners": judge },
  });

  assert.equal(wrongShape.isError, true);
  assert.match(wrongShape.text, /Wrong single\/panel shape/);

  const unavailable = await f.call("pstack_models", {
    action: "set",
    budget: "unlimited",
    roles: { ...roles, "how explorer": "fixture/missing:high" },
  });

  assert.equal(unavailable.isError, true);
  assert.match(unavailable.text, /Unavailable model/);

  const noReasoning = await f.call("pstack_models", {
    action: "set",
    budget: "small",
    roles: { ...roles, "how explorer": "fixture/plain:off" },
  });

  assert.equal(noReasoning.isError, true);
  assert.match(noReasoning.text, /No supported reasoning level/);

  const unknownThinking = await f.call("pstack_models", {
    action: "set",
    budget: "small",
    roles: { ...roles, "how explorer": "fixture/judge:rev1:bananas" },
  });

  assert.equal(unknownThinking.isError, true);
  assert.match(unknownThinking.text, /Unknown thinking level/);
  assert.equal(await readFile(join(f.directory, "pstack-models.json"), "utf8"), before);
  await writeFile(join(f.directory, "pstack-models.json"), "{}");
  const invalid = await f.call("pstack_models", { action: "get" });
  assert.equal(invalid.isError, true);
  assert.match(invalid.text, /Invalid pstack-models.json/);
  assert.match(await f.prompt("Can I run setup?"), /Invalid PStack role configuration/);
  assert.equal(
    (await f.call("pstack_models", { action: "set", budget: "unlimited", roles })).isError,
    false,
  );
});

await test("mode and todo state follow native branches; full mode and configured roles survive subsequent prompts", async (t) => {
  const f = await fixture(t);

  const body = stripFrontmatter(
    await readFile(join(root, "content/pstack/skills/poteto-mode/SKILL.md"), "utf8"),
  ).trim();

  const off = await f.prompt("ordinary question");
  assert.ok(!off.includes(body));
  const beforeMode = f.sessionManager.getLeafId();
  assert.ok(beforeMode !== null);
  await f.session.prompt("/poteto-mode on");
  assert.ok((await f.prompt("mode task")).includes(body));
  assert.equal(
    (await f.call("pstack_models", { action: "set", budget: "unlimited", roles: roleChoices() }))
      .isError,
    false,
  );
  assert.equal(
    (await f.call("pstack_todo", { items: ["Read the playbook", "Compare the designs"] })).isError,
    false,
  );
  const activeLeaf = f.sessionManager.getLeafId();
  assert.ok(activeLeaf !== null);
  f.sessionManager.branch(beforeMode);
  assert.ok(!(await f.prompt("other branch")).includes(body));
  assert.equal((await f.call("pstack_todo", {})).text, "[]");
  f.sessionManager.branch(activeLeaf);
  assert.ok((await f.prompt("return to branch")).includes(body));
  assert.equal(
    (await f.call("pstack_todo", {})).text,
    '["Read the playbook","Compare the designs"]',
  );
  await f.session.prompt("/poteto-mode off");
  const disabled = await f.prompt("PStack helper with mode off");
  assert.ok(!disabled.includes(body));
  assert.match(disabled, /fixture\/judge:rev1:high/);
  assert.ok((await f.prompt("/skill:poteto-mode direct task")).includes(body));
  const question = await f.call("pstack_question", { question: "Which?", options: ["A", "B"] });
  assert.equal(question.isError, true);
  assert.match(question.text, /ask the user in the conversation/);
  const ui = f.session.extensionRunner.createContext().ui;
  await f.session.bindExtensions({
    mode: "rpc",
    uiContext: {
      ...ui,
      select: async (title, options) => {
        assert.equal(title, "Which?");
        assert.deepEqual(options, ["A", "B"]);

        return "B";
      },
    },
  });
  const selected = await f.call("pstack_question", { question: "Which?", options: ["A", "B"] });
  assert.deepEqual(selected, { isError: false, text: "B" });
  await f.session.bindExtensions({
    mode: "rpc",
    uiContext: { ...ui, select: async () => undefined },
  });
  const dismissed = await f.call("pstack_question", { question: "Which?", options: ["A", "B"] });
  assert.equal(dismissed.isError, true);
  assert.match(dismissed.text, /Question dismissed/);
  f.provider.setResponses([
    fauxAssistantMessage("Fixture summary."),
    fauxAssistantMessage("Fixture turn summary."),
  ]);
  await f.session.compact();
  assert.ok((await f.prompt("after native compaction")).includes(body));
});

await test("print aliases emit native extension errors rather than dropping work silently", async (t) => {
  const f = await fixture(t);
  await f.session.bindExtensions({
    mode: "print",
    onError: (error) => {
      f.errors.push(error.error);
    },
  });
  await f.session.prompt("/poteto-mode do the task");
  await f.session.prompt("/setup-pstack");
  assert.deepEqual(f.errors, [
    "Use /skill:poteto-mode <task> in print/json mode.",
    "Use /skill:setup-pstack in print/json mode.",
  ]);
  assert.equal(f.provider.state.callCount, 0);
});

await test("RPC convenience commands dispatch one expanded native skill turn", async (t) => {
  const f = await fixture(t);

  for (const [command, skill] of [
    ["/setup-pstack", "setup-pstack"],
    ["/poteto-mode investigate fixture", "poteto-mode"],
  ] as const) {
    let userInput = "";
    f.provider.setResponses([
      (context) => {
        const user = context.messages.findLast((message) => message.role === "user");
        assert.ok(user?.role === "user");
        userInput = contentText(user.content);

        return fauxAssistantMessage("fixture complete");
      },
    ]);

    const ended = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        unsubscribe();
        reject(
          new Error(
            `Native alias turn did not complete: ${JSON.stringify({ command, errors: f.errors, calls: f.provider.state.callCount, pending: f.session.pendingMessageCount })}`,
          ),
        );
      }, 3000);

      const unsubscribe = f.session.subscribe((event) => {
        if (event.type !== "agent_settled") return;
        clearTimeout(timeout);
        unsubscribe();
        resolve();
      });
    });

    await f.session.prompt(command);
    await ended;
    assert.ok(userInput.startsWith(`<skill name="${skill}"`));
  }

  assert.equal(f.provider.state.callCount, 2);
  assert.deepEqual(f.errors, []);
});
