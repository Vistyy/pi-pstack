import { existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import {
  type AgentSession,
  createAgentSession,
  createEventBus,
  DefaultResourceLoader,
  type ExtensionAPI,
  type ExtensionContext,
  type ExtensionFactory,
  getAgentDir,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Check } from "typebox/value";
import { resolveTarget } from "./models.js";
import type { ToolPlan } from "./task-record.js";

export type Profile = "generalPurpose" | "poteto-agent" | "Comment Sicko";

export type ConfigureRuntime = (pi: ExtensionAPI, options: { profile: Profile }) => void;

const ownTools = new Set([
  "pstack_task",
  "pstack_tasks",
  "pstack_todo",
  "pstack_models",
  "pstack_question",
]);

export function selectModel(selector: string | undefined, ctx: ExtensionContext) {
  if (selector === "auto" || selector === "inherit-parent")
    throw new Error("Omit model to inherit, or supply an exact provider/model:thinking selector");
  const selected = resolveTarget(selector ?? "inherit-parent", ctx);
  const separator = selected.lastIndexOf(":");
  const route = selected.slice(0, separator);

  const model = ctx.modelRegistry
    .getAvailable()
    .find((item) => `${item.provider}/${item.id}` === route);

  if (!model) throw new Error(`Unavailable child model ${route}`);

  const thinking = getSupportedThinkingLevels(model).find(
    (level) => level === selected.slice(separator + 1),
  );

  if (thinking === undefined) throw new Error(`Unsupported thinking level in ${selected}`);

  return { selector: selected, model, thinking };
}

export type Selection = ReturnType<typeof selectModel>;

const ChildPolicySettings = Type.Object({
  "pi-pstack": Type.Optional(Type.Unknown()),
});

const ChildPolicyNamespace = Type.Object({
  excludedChildTools: Type.Optional(Type.Unknown()),
});

const ChildPolicyTools = Type.Array(Type.String({ minLength: 1 }));

async function excludedChildTools(agentDir: string) {
  const path = join(agentDir, "settings.json");
  let content: string;

  try {
    content = await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw new Error(`Cannot read global child-tool policy (${path}): ${String(error)}`);
  }

  const global: unknown = JSON.parse(content.replace(/^\uFEFF/, ""));

  if (!Check(ChildPolicySettings, global))
    throw new Error("Invalid global settings: expected an object");

  const namespace = global["pi-pstack"];

  if (namespace === undefined) return [];

  if (!Check(ChildPolicyNamespace, namespace))
    throw new Error("Invalid global pi-pstack settings: expected an object");
  const list = namespace.excludedChildTools;

  if (list === undefined) return [];

  if (!Check(ChildPolicyTools, list))
    throw new Error(
      "Invalid global pi-pstack.excludedChildTools: expected an array of nonempty tool names",
    );

  return list;
}

function toolPlan(pi: ExtensionAPI, excluded: ReadonlySet<string>) {
  const tools = [
    ...new Set([...pi.getActiveTools(), "pstack_task", "pstack_tasks", "pstack_todo"]),
  ].filter((name) => !excluded.has(name));

  const paths = new Set<string>();

  for (const tool of pi.getAllTools()) {
    if (
      !tools.includes(tool.name) ||
      ownTools.has(tool.name) ||
      tool.sourceInfo.source === "builtin"
    )
      continue;

    if (!isAbsolute(tool.sourceInfo.path))
      throw new Error(
        `Cannot recreate child integration ${tool.name}: no file-backed extension (${tool.sourceInfo.path})`,
      );
    paths.add(tool.sourceInfo.path);
  }

  return {
    tools,
    paths: [...paths],
  };
}

type ChildSessionConfig = {
  cwd: string;
  readonly: boolean;
  selection: Selection;
  transcript: string;
  sessionId: string | undefined;
  plan: ToolPlan | undefined;
};

async function openTranscript(
  config: Pick<ChildSessionConfig, "cwd" | "transcript" | "sessionId">,
) {
  if (!existsSync(config.transcript)) {
    if (config.sessionId !== undefined)
      throw new Error(`Saved child transcript is missing: ${config.transcript}`);
    await mkdir(dirname(config.transcript), { recursive: true });
    await writeFile(config.transcript, "", { flag: "wx" });
  }

  const manager = SessionManager.open(config.transcript, undefined, config.cwd);

  if (config.sessionId !== undefined && manager.getSessionId() !== config.sessionId)
    throw new Error(`Saved child transcript identity changed: ${config.transcript}`);

  return manager;
}

export async function createChildSession(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  config: ChildSessionConfig,
  factory: ExtensionFactory,
  lifetime: {
    check: () => void;
    attach: (session: AgentSession) => void;
    plan: (plan: ToolPlan) => void;
  },
) {
  lifetime.check();

  if (!(await stat(config.cwd)).isDirectory()) throw new Error(`Not a directory: ${config.cwd}`);
  lifetime.check();
  const agentDir = getAgentDir();
  const settings = SettingsManager.create(config.cwd, agentDir);

  const excluded = config.plan?.excluded ?? [
    ...new Set([
      ...(await excludedChildTools(agentDir)),
      ...(config.readonly ? ["write", "edit"] : []),
    ]),
  ];

  lifetime.check();
  const plan = config.plan ?? { ...toolPlan(pi, new Set(excluded)), excluded };
  lifetime.plan(plan);

  const modelRuntime = await ModelRuntime.create({
    authPath: join(agentDir, "auth.json"),
    modelsPath: join(agentDir, "models.json"),
    modelsStorePath: join(agentDir, "models-store.json"),
    allowModelNetwork: false,
  });

  lifetime.check();

  for (const provider of ctx.modelRegistry.getRegisteredProviderIds()) {
    const native = ctx.modelRegistry.getRegisteredNativeProvider(provider);
    const registered = ctx.modelRegistry.getRegisteredProviderConfig(provider);

    if (native) modelRuntime.registerNativeProvider(native);
    else if (registered) modelRuntime.registerProvider(provider, registered);
  }

  await modelRuntime.getAvailable();
  lifetime.check();

  const loader = new DefaultResourceLoader({
    cwd: config.cwd,
    agentDir,
    settingsManager: settings,
    eventBus: createEventBus(),
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    additionalExtensionPaths: plan.paths,
    extensionFactories: [{ name: "pstack-child", factory }],
    systemPromptOverride: () => undefined,
    appendSystemPromptOverride: () =>
      config.readonly
        ? [
            "This is a read-only investigation. Do not modify files or external state. Use the available tools only for inspection. Tool availability does not authorize writes. Keep descendants under the same restriction.",
          ]
        : [],
    agentsFilesOverride: (base) => ({
      agentsFiles: base.agentsFiles.filter((file) => file.path !== join(agentDir, "AGENTS.md")),
    }),
  });

  await loader.reload();
  lifetime.check();

  const manager = await openTranscript(config);
  lifetime.check();

  const created = await createAgentSession({
    cwd: config.cwd,
    agentDir,
    settingsManager: settings,
    modelRuntime,
    resourceLoader: loader,
    model: config.selection.model,
    thinkingLevel: config.selection.thinking,
    tools: plan.tools,
    excludeTools: excluded,
    sessionManager: manager,
  });

  lifetime.attach(created.session);
  lifetime.check();

  if (created.extensionsResult.errors.length)
    throw new Error(JSON.stringify(created.extensionsResult.errors));
  const errors: string[] = [];
  await created.session.bindExtensions({
    mode: "rpc",
    onError: (error) => {
      errors.push(error.error);
    },
  });
  lifetime.check();

  if (errors.length) throw new Error(`Child extension startup failed: ${errors.join("; ")}`);
  const available = new Set(created.session.getActiveToolNames());
  const missing = plan.tools.filter((name) => !available.has(name));

  if (missing.length) throw new Error(`Unavailable child tools: ${missing.join(", ")}`);

  return created.session;
}
