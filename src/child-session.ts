import { stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
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
import { resolveTarget } from "./models.js";

export type Profile = "generalPurpose" | "poteto-agent" | "Comment Sicko";

export type ConfigureRuntime = (pi: ExtensionAPI, options: { profile: Profile }) => void;

const ownTools = new Set([
  "pstack_task",
  "pstack_tasks",
  "pstack_todo",
  "pstack_models",
  "pstack_question",
]);

const readerTools = ["read", "grep", "find", "ls", "pstack_todo", "pstack_task", "pstack_tasks"];

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

function toolPlan(pi: ExtensionAPI, readonly: boolean) {
  if (readonly) return { tools: readerTools, paths: [] };
  const active = pi.getActiveTools();
  const paths = new Set<string>();

  for (const tool of pi.getAllTools()) {
    if (
      !active.includes(tool.name) ||
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
    tools: [...new Set([...active, "pstack_task", "pstack_tasks", "pstack_todo"])],
    paths: [...paths],
  };
}

export async function createChildSession(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  config: { cwd: string; readonly: boolean; selection: Selection },
  factory: ExtensionFactory,
  lifetime: { check: () => void; attach: (session: AgentSession) => void },
) {
  lifetime.check();

  if (!(await stat(config.cwd)).isDirectory()) throw new Error(`Not a directory: ${config.cwd}`);
  lifetime.check();
  const agentDir = getAgentDir();
  const plan = toolPlan(pi, config.readonly);
  const settings = SettingsManager.create(config.cwd, agentDir);

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
    appendSystemPromptOverride: () => [],
    agentsFilesOverride: (base) => ({
      agentsFiles: base.agentsFiles.filter((file) => file.path !== join(agentDir, "AGENTS.md")),
    }),
  });

  await loader.reload();
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
    sessionManager: SessionManager.create(config.cwd),
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
