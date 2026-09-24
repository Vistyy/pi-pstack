import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
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
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Check } from "typebox/value";

export const packageRoot = fileURLToPath(new URL("..", import.meta.url));

const agentDirKey = "PI_CODING_AGENT_DIR";

const Receipt = Type.Object({
  id: Type.String(),
  status: Type.String(),
  transcript: Type.Optional(Type.String()),
});

export function receipt(text: string) {
  const value: unknown = JSON.parse(text);
  assert.ok(Check(Receipt, value), text);

  return value;
}

export async function childFixture(t: TestContext, options: { holdStartup?: boolean } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "pstack-lifecycle-"));
  const previous = process.env[agentDirKey];
  process.env[agentDirKey] = dir;
  let session: AgentSession | undefined;
  const releases: Array<() => void> = [];
  const startup = Promise.withResolvers<void>();
  const entered = Promise.withResolvers<void>();
  const eventName = `pstack-test-${randomUUID()}`;
  let childShutdowns = 0;

  const listener = (phase: string, release?: () => void) => {
    if (phase === "start") {
      entered.resolve();

      if (release) void startup.promise.then(release);
    } else if (phase === "shutdown") childShutdowns++;
  };

  process.on(eventName, listener);
  releases.push(startup.resolve);
  t.after(async () => {
    for (const release of releases) release();

    try {
      if (session) {
        await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
        await session.abort();
        session.dispose();
      }
    } finally {
      process.removeListener(eventName, listener);

      if (previous === undefined) delete process.env[agentDirKey];
      else process.env[agentDirKey] = previous;
      await rm(dir, { recursive: true, force: true });
    }
  });
  const project = join(dir, "project");
  await mkdir(project);
  await writeFile(join(project, "AGENTS.md"), "Project-only instruction marker");
  await writeFile(join(dir, "AGENTS.md"), "Global instruction forbidden marker");
  await writeFile(join(dir, "SYSTEM.md"), "Global system forbidden marker");
  await writeFile(join(dir, "APPEND_SYSTEM.md"), "Global append forbidden marker");
  await mkdir(join(dir, "skills/ambient"), { recursive: true });
  await writeFile(
    join(dir, "skills/ambient/SKILL.md"),
    "---\nname: ambient\ndescription: Ambient forbidden skill marker\n---\nAmbient skill body",
  );
  await mkdir(join(dir, "prompts"));
  await writeFile(join(dir, "prompts/ambient-override.md"), "Ambient template forbidden marker");
  const integration = join(dir, "integration.mjs");
  await writeFile(
    integration,
    `
import { appendFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
export default (pi) => {
  pi.on('session_before_tree', () => existsSync(${JSON.stringify(join(dir, "veto-tree"))}) ? {cancel:true} : undefined);
  pi.on('session_start', async (_event, ctx) => {
    if (ctx.model?.provider === 'nested' && existsSync(${JSON.stringify(join(dir, "fail-startup"))})) throw new Error('startup failed');
    if (ctx.model?.provider === 'nested' && ${JSON.stringify(options.holdStartup ?? false)})
      await new Promise((resolve) => process.emit(${JSON.stringify(eventName)}, 'start', resolve));
  });
  pi.on('session_shutdown', (_event, ctx) => {
    if (ctx.model?.provider === 'nested') process.emit(${JSON.stringify(eventName)}, 'shutdown');
  });
  pi.registerTool({ name:'fixture_lookup', label:'Fixture lookup', description:'Observe integration context',
    parameters:{type:'object',properties:{}}, async execute(_id, _args, _signal, _update, ctx) {
      const result = { cwd:ctx.cwd, model:ctx.model?.id, thinking:pi.getThinkingLevel() };
      await appendFile(${JSON.stringify(join(dir, "lookup.jsonl"))}, JSON.stringify(result)+'\\n');
      return {content:[{type:'text',text:JSON.stringify(result)}],details:{}};
    }
  });
};
`,
  );

  const parent = fauxProvider({
    provider: "fixture",
    models: [{ id: "root", reasoning: true }],
    tokensPerSecond: Infinity,
  });

  const nested = fauxProvider({
    provider: "nested",
    models: [{ id: "child:rev1", reasoning: true }],
    tokensPerSecond: Infinity,
  });

  const leaf = fauxProvider({
    provider: "leaf",
    models: [{ id: "reader", reasoning: false }],
    tokensPerSecond: Infinity,
  });

  const runtime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsPath: null,
    modelsStorePath: join(dir, "catalog.json"),
    allowModelNetwork: false,
  });

  for (const provider of [parent, nested, leaf]) runtime.registerNativeProvider(provider.provider);
  await runtime.getAvailable();

  const settings = SettingsManager.inMemory({
    packages: [],
    compaction: { enabled: false, keepRecentTokens: 1, reserveTokens: 1024 },
  });

  const loader = new DefaultResourceLoader({
    cwd: project,
    agentDir: dir,
    settingsManager: settings,
    noExtensions: true,
    noSkills: true,
    additionalExtensionPaths: [join(packageRoot, "extensions/index.ts"), integration],
  });

  await loader.reload();

  const created = await createAgentSession({
    cwd: project,
    agentDir: dir,
    modelRuntime: runtime,
    model: parent.getModel(),
    thinkingLevel: "high",
    resourceLoader: loader,
    settingsManager: settings,
    sessionManager: SessionManager.inMemory(project),
  });

  session = created.session;
  assert.deepEqual(created.extensionsResult.errors, []);
  const errors: string[] = [];
  await session.bindExtensions({
    mode: "rpc",
    onError: (error) => {
      errors.push(error.error);
    },
  });
  const active = session;

  const call = async (name: string, args: ToolCall["arguments"]) => {
    parent.setResponses([
      fauxAssistantMessage(fauxToolCall(name, args), { stopReason: "toolUse" }),
      fauxAssistantMessage("parent turn finished"),
    ]);
    await active.prompt("fixture request");

    const result = active.messages.findLast(
      (item) => item.role === "toolResult" && item.toolName === name,
    );

    assert.ok(result?.role === "toolResult");

    return {
      isError: result.isError,
      text: result.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join(""),
    };
  };

  const gate = () => {
    const barrier = Promise.withResolvers<void>();
    releases.push(barrier.resolve);

    return barrier;
  };

  const report = () => {
    const done = Promise.withResolvers<void>();

    const unsubscribe = active.subscribe((event) => {
      if (event.type === "agent_settled") {
        unsubscribe();
        done.resolve();
      }
    });

    return done.promise;
  };

  return {
    dir,
    project,
    parent,
    nested,
    leaf,
    session: active,
    call,
    gate,
    report,
    errors,
    entered: entered.promise,
    releaseStartup: startup.resolve,
    childShutdowns: () => childShutdowns,
    lookup: () => readFile(join(dir, "lookup.jsonl"), "utf8"),
  };
}
