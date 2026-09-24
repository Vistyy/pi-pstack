import { randomUUID } from "node:crypto";

import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type AgentSession,
  createAgentSession,
  createEventBus,
  DefaultResourceLoader,
  type ExtensionAPI,
  type ExtensionContext,
  getAgentDir,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { resolveTarget } from "./models.js";

const root = fileURLToPath(new URL("..", import.meta.url));

type Profile = "generalPurpose" | "poteto-agent" | "Comment Sicko";

type Status = "running" | "cancelling" | "completed" | "failed" | "cancelled";

type ChildOwner = { depth: number; readonly: boolean; child?: Child };

type Child = {
  id: string;
  profile: Profile;
  selector: string;
  cwd: string;
  readonly: boolean;
  status: Status;
  session: AgentSession;
  transcript: string | undefined;
  output: string | undefined;
  error: string | undefined;
  run?: Promise<void>;
  children: Set<Child>;
};

const textResult = (text: string) => ({ content: [{ type: "text" as const, text }], details: {} });

/** One instance per extension runtime; never shared with a parent session. */
export function installExecutor(
  pi: ExtensionAPI,
  owner?: ChildOwner,
  createRuntime?: (pi: ExtensionAPI, options: { profile: Profile }) => void,
): void {
  const children = new Map<string, Child>();

  const progress = (ctx: ExtensionContext) => {
    if (!ctx.hasUI) return;

    const count = [...children.values()].filter(
      (child) => child.status === "running" || child.status === "cancelling",
    ).length;

    ctx.ui.setStatus("pstack", count === 0 ? undefined : `PStack: ${count} active`);
  };

  let alive = true;
  let branch: string | null = null;

  const stop = async () => {
    alive = false;
    await Promise.all([...children.values()].map(cancel));

    for (const child of children.values()) {
      await child.session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
      child.session.dispose();
    }

    children.clear();
  };

  const cancel = async (child: Child): Promise<void> => {
    if (child.status === "running" || child.status === "cancelling") {
      child.status = "cancelling";
      await Promise.all([...child.children].map(cancel));
      await child.session.abort();
      await child.run;

      if (child.status === "cancelling") child.status = "cancelled";
    }
  };

  pi.on("session_start", (_event, ctx) => {
    alive = true;
    branch = ctx.sessionManager.getLeafId();
  });
  pi.on("session_before_switch", stop);
  pi.on("session_before_fork", stop);
  pi.on("session_tree", async (_event, ctx) => {
    await stop();
    alive = true;
    branch = ctx.sessionManager.getLeafId();
  });
  pi.on("session_shutdown", stop);

  pi.registerTool({
    name: "pstack_tasks",
    label: "PStack tasks",
    description:
      "List this parent's children, inspect an exact child and its transcript/result, or cancel that child and its descendants. Completion reports execution, not acceptance of its work.",
    parameters: Type.Object({
      action: Type.Union([Type.Literal("list"), Type.Literal("inspect"), Type.Literal("cancel")]),
      id: Type.Optional(Type.String()),
    }),
    async execute(_id, params) {
      if (params.action === "list")
        return textResult(JSON.stringify([...children.values()].map(summary)));
      const child = children.get(params.id ?? "");

      if (!child) throw new Error("Unknown owned child ID");

      if (params.action === "cancel") await cancel(child);

      return textResult(JSON.stringify(summary(child)));
    },
  });
  pi.registerTool({
    name: "pstack_task",
    label: "PStack task",
    description:
      "Run or resume a PStack child with its own conversation. Supply the complete assignment and an exact provider/model:thinking selector, or omit model to inherit. Background calls return an ID; completion is delivered automatically. Resume keeps the child's context and configuration.",
    executionMode: "parallel",
    parameters: Type.Object({
      prompt: Type.String(),
      subagent_type: Type.Optional(
        Type.Union([
          Type.Literal("generalPurpose"),
          Type.Literal("poteto-agent"),
          Type.Literal("Comment Sicko"),
        ]),
      ),
      model: Type.Optional(Type.String()),
      readonly: Type.Optional(Type.Boolean()),
      run_in_background: Type.Optional(Type.Boolean()),
      cwd: Type.Optional(Type.String()),
      resume: Type.Optional(Type.String()),
    }),
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Delegation includes creation, resume, ownership and native lifecycle checks.
    async execute(_id, params, signal, _update, ctx) {
      if (!alive) throw new Error("Owner session is closing");

      if (params.model !== undefined && !/^[^/]+\/.+:[^:]+$/.test(params.model))
        throw new Error("Child model must be an exact provider/model:thinking selector");
      let child: Child;

      if (params.resume !== undefined) {
        const existing = children.get(params.resume);

        if (!existing) throw new Error("Unknown owned child ID");

        if (existing.status === "running" || existing.status === "cancelling")
          throw new Error("Child still active");

        if (
          (params.subagent_type !== undefined && params.subagent_type !== existing.profile) ||
          (params.model !== undefined && resolveTarget(params.model, ctx) !== existing.selector) ||
          (params.cwd !== undefined && resolve(ctx.cwd, params.cwd) !== existing.cwd) ||
          (params.readonly !== undefined && params.readonly !== existing.readonly)
        )
          throw new Error("Resume cannot change child configuration");
        child = existing;
      } else {
        if ((owner?.depth ?? 0) >= 2) throw new Error("Maximum PStack delegation depth is two");
        const profile = params.subagent_type ?? "generalPurpose";
        const readonly = (owner?.readonly ?? false) || (params.readonly ?? false);

        if (owner?.readonly === true && params.readonly === false)
          throw new Error("Readonly child cannot escalate");

        if (readonly && profile === "Comment Sicko")
          throw new Error("Comment Sicko requires writable tools");
        const selector = resolveTarget(params.model ?? "inherit-parent", ctx);
        const [provider, rest] = selector.split(/\/(.*)/s);
        const modelId = rest?.replace(/:[^:]+$/, "");

        const model = ctx.modelRegistry
          .getAvailable()
          .find((m) => m.provider === provider && m.id === modelId);

        if (!model) throw new Error(`Unavailable child model ${selector}`);
        const cwd = resolve(ctx.cwd, params.cwd ?? ".");
        const agentDir = getAgentDir();
        const settings = SettingsManager.create(cwd, agentDir);

        const registry = await ModelRuntime.create({
          authPath: join(agentDir, "auth.json"),
          modelsPath: join(agentDir, "models.json"),
          allowModelNetwork: false,
        });

        for (const id of ctx.modelRegistry.getRegisteredProviderIds()) {
          const native = ctx.modelRegistry.getRegisteredNativeProvider(id);
          const config = ctx.modelRegistry.getRegisteredProviderConfig(id);

          if (native) registry.registerNativeProvider(native);
          else if (config) registry.registerProvider(id, config);
        }

        const active = pi.getActiveTools();
        const paths = pi
          .getAllTools()
          .filter((tool) => active.includes(tool.name))
          .flatMap((tool) => (tool.sourceInfo?.path ? [tool.sourceInfo.path] : []))
          .filter(
            (path) =>
              path.startsWith("/") &&
              path !== fileURLToPath(new URL("../extensions/index.ts", import.meta.url)),
          );

        const ownership: ChildOwner = {
          depth: (owner?.depth ?? 0) + 1,
          readonly,
        };
        const loader = new DefaultResourceLoader({
          cwd,
          agentDir,
          settingsManager: settings,
          eventBus: createEventBus(),
          noExtensions: true,
          additionalExtensionPaths: [...new Set(paths)],
          noPromptTemplates: true,
          noThemes: true,
          systemPromptOverride: () => undefined,
          appendSystemPromptOverride: () => [],
          extensionFactories: [
            {
              name: "pstack-child",
              factory: (api) => {
                createRuntime?.(api, { profile });
                installExecutor(api, ownership, createRuntime);
              },
            },
          ],
          skillsOverride: (base) => ({
            ...base,
            skills: base.skills.filter((skill) =>
              skill.filePath.startsWith(join(root, "content/pstack/skills")),
            ),
          }),
          agentsFilesOverride: (base) => ({
            agentsFiles: base.agentsFiles.filter(
              (item) => item.path !== join(agentDir, "AGENTS.md"),
            ),
          }),
        });

        await loader.reload();
        const tools = readonly
          ? ["read", "grep", "find", "ls", "pstack_todo", "pstack_task", "pstack_tasks"]
          : [...new Set([...active, "pstack_task", "pstack_tasks", "pstack_todo"])];

        const created = await createAgentSession({
          cwd,
          agentDir,
          settingsManager: settings,
          resourceLoader: loader,
          modelRuntime: registry,
          model,
          thinkingLevel: selector.slice(
            selector.lastIndexOf(":") + 1,
          ) as AgentSession["thinkingLevel"],
          tools,
          sessionManager: SessionManager.create(cwd),
        });

        if (created.extensionsResult.errors.length) {
          created.session.dispose();
          throw new Error(JSON.stringify(created.extensionsResult.errors));
        }

        await created.session.bindExtensions({ mode: "rpc" });
        child = {
          id: randomUUID(),
          profile,
          selector,
          cwd,
          readonly,
          status: "completed",
          session: created.session,
          transcript: created.session.sessionFile,
          output: undefined,
          error: undefined,
          children: new Set(),
        };
        ownership.child = child;
        children.set(child.id, child);
        owner?.child?.children.add(child);
      }

      child.status = "running";
      progress(ctx);
      child.output = undefined;
      child.error = undefined;
      const origin = branch;

      // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Completion must discriminate native outcomes and descendant settlement.
      const run = async () => {
        try {
          if (child.status === "cancelling" || !alive) throw new Error("Child cancelled");
          await child.session.prompt(params.prompt);
          await Promise.all([...child.children].map((nested) => nested.run ?? Promise.resolve()));
          await child.session.waitForIdle();
          const last = [...child.session.messages].reverse().find((m) => m.role === "assistant");

          if (
            last?.role !== "assistant" ||
            last.stopReason === "error" ||
            last.stopReason === "aborted"
          )
            throw new Error(
              last?.role === "assistant"
                ? (last.errorMessage ?? last.stopReason)
                : "No assistant result",
            );
          child.output = last.content
            .filter((part) => part.type === "text")
            .map((part) => part.text)
            .join("");
          if (child.status === "cancelled" || !alive) {
            child.status = "cancelled";
            return;
          }
          child.status = "completed";
        } catch (error) {
          child.error = String(error);
          child.status = child.status === "cancelling" ? "cancelled" : "failed";
        }

        progress(ctx);
      };

      child.run = run();

      if (params.run_in_background ?? child.profile === "poteto-agent") {
        void child.run.then(() => {
          if (
            alive &&
            branch === origin &&
            signal?.aborted !== true &&
            child.status !== "cancelled"
          )
            pi.sendMessage(
              {
                customType: "pstack-task-result",
                content: JSON.stringify(summary(child)),
                display: true,
              },
              { triggerTurn: true, deliverAs: "followUp" },
            );
        });

        return textResult(
          JSON.stringify({ id: child.id, status: child.status, transcript: child.transcript }),
        );
      }

      const abort = () => {
        void cancel(child);
      };

      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted === true) void cancel(child);

      try {
        await child.run;
      } finally {
        signal?.removeEventListener("abort", abort);
      }

      if (summary(child).status !== "completed")
        throw new Error(child.error ?? `Child ${child.status}`);

      return textResult(JSON.stringify(summary(child)));
    },
  });
}

function summary(child: Child) {
  return {
    id: child.id,
    status: child.status,
    profile: child.profile,
    model: child.selector,
    thinking: child.selector.slice(child.selector.lastIndexOf(":") + 1),
    cwd: child.cwd,
    readonly: child.readonly,
    transcript: child.transcript,
    output: child.output,
    error: child.error,
  };
}
