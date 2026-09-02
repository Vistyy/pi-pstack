import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { StringEnum } from "@earendil-works/pi-ai";
import { getAgentDir, SessionManager, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { ROLE_NAMES, configPath, defaultConfig, readConfig, writeConfig } from "./config.ts";

const MODE_ENTRY = "pstack-mode";
const LOOP_ENTRY = "pstack-loop";
const PSTACK_RUNTIME_PROMPT = `Pi pstack runtime:
- The installed pstack package root is ${packageRoot()}.
- Task runs persistent local Pi workers in Herdr when available and persistent Pi subprocess sessions otherwise. Use isolation: worktree for an isolated Git worktree.
- Model roles use pstack_config or /setup-pstack, and model selectors use provider/model.
- pstack_sessions owns workspace-scoped transcript listing and reads.
- /loop and pstack_loop own persisted autonomous predicates and bounded heartbeats.
- control-cli uses Herdr. control-ui uses chrome-devtools-axi.
- Structured questions use pstack_question or a persisted human gate in non-interactive work.`;

function packageRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
}

function knownExternalWrite(command: string): string | undefined {
  const patterns: Array<[RegExp, string]> = [
    [/\bgit\s+push\b/, "git push"],
    [/\bgh\s+pr\s+(create|edit|merge|close)\b/, "GitHub pull-request mutation"],
    [/\b(terraform|tofu)\s+(apply|destroy)\b/, "infrastructure mutation"],
    [/\bkubectl\s+(apply|delete|rollout)\b/, "Kubernetes mutation"],
    [/\b(vercel|flyctl|railway)\s+(deploy|promote)\b/, "deployment"],
    [/\brm\s+(-[A-Za-z]*r|--recursive)/, "recursive deletion"],
  ];
  return patterns.find(([pattern]) => pattern.test(command))?.[1];
}

export default function (pi: ExtensionAPI) {
  let potetoMode = process.env.PSTACK_DEFAULT_MODE === "1";
  let todos: string[] = [];
  let loopActive = false;
  let loopDirective = "";
  let loopTimer: ReturnType<typeof setTimeout> | undefined;

  const setPotetoMode = (enabled: boolean) => {
    if (potetoMode === enabled) return;
    potetoMode = enabled;
    pi.appendEntry(MODE_ENTRY, { enabled });
  };

  pi.on("session_start", (_event, ctx) => {
    potetoMode = process.env.PSTACK_DEFAULT_MODE === "1";
    todos = [];
    loopActive = false;
    loopDirective = "";
    if (loopTimer) clearTimeout(loopTimer);
    loopTimer = undefined;
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== "custom") continue;
      if (entry.customType === MODE_ENTRY) potetoMode = Boolean((entry.data as { enabled?: boolean }).enabled);
      if (entry.customType === LOOP_ENTRY) {
        const state = entry.data as { active?: boolean; directive?: string };
        loopActive = Boolean(state.active);
        loopDirective = typeof state.directive === "string" ? state.directive : "";
      }
      if (entry.type === "custom" && entry.customType === "pstack-todo") {
        const items = (entry.data as { items?: unknown }).items;
        if (Array.isArray(items) && items.every((item) => typeof item === "string")) todos = items;
      }
    }
    if (ctx.mode === "tui") ctx.ui.setStatus("pstack-mode", potetoMode ? "pstack: poteto mode" : undefined);
  });

  pi.on("input", (event) => {
    if (/^\/skill:poteto-mode(?:\s|$)/.test(event.text)) setPotetoMode(true);
    return { action: "continue" } as const;
  });

  pi.on("before_agent_start", (event) => {
    const modePrompt = potetoMode
      ? `\n\nPstack Poteto Mode is enabled for this session. Follow its persisted workflow: use pstack_todo for non-trivial work, select and read the matching playbook, delegate through the Task tool when delegation helps, verify real behavior, and name only principles that changed a decision. The full skill is at ${path.join(packageRoot(), "skills/poteto-mode/SKILL.md")}.`
      : "";
    return { systemPrompt: `${event.systemPrompt}\n\n${PSTACK_RUNTIME_PROMPT}${modePrompt}` };
  });

  pi.on("agent_end", () => {
    if (!loopActive || loopTimer) return;
    const configured = Number.parseInt(process.env.PSTACK_LOOP_INTERVAL_MS ?? "60000", 10);
    const delay = Number.isFinite(configured) ? Math.max(1_000, Math.min(configured, 60 * 60 * 1000)) : 60_000;
    loopTimer = setTimeout(() => {
      loopTimer = undefined;
      if (!loopActive) return;
      pi.sendMessage({
        customType: "pstack-loop-heartbeat",
        content: `Pstack loop heartbeat. Re-check this predicate against real state and continue if it is not satisfied: ${loopDirective}`,
        display: true,
      }, { deliverAs: "followUp", triggerTurn: true });
    }, delay);
    loopTimer.unref();
  });

  pi.on("session_shutdown", () => {
    if (loopTimer) clearTimeout(loopTimer);
    loopTimer = undefined;
  });

  pi.registerCommand("loop", {
    description: "Run an autonomous pstack predicate loop with a bounded heartbeat.",
    handler: async (args, ctx) => {
      const directive = args.trim();
      if (/^(off|stop|cancel)$/i.test(directive)) {
        loopActive = false;
        loopDirective = "";
        if (loopTimer) clearTimeout(loopTimer);
        loopTimer = undefined;
        pi.appendEntry(LOOP_ENTRY, { active: false, directive: "" });
        ctx.ui.notify("Pstack loop stopped.", "info");
        return;
      }
      if (!directive) {
        ctx.ui.notify(loopActive ? `Pstack loop active: ${loopDirective}` : "Pstack loop is inactive.", "info");
        return;
      }
      loopActive = true;
      loopDirective = directive;
      pi.appendEntry(LOOP_ENTRY, { active: true, directive });
      pi.sendUserMessage(`Continue autonomously until this predicate is satisfied: ${directive}\nUse pstack_loop action complete only after verifying the predicate against real state. If genuinely blocked, stop the loop and report the durable resume point.`);
    },
  });

  pi.registerTool({
    name: "pstack_loop",
    label: "Pstack Loop",
    description: "Inspect, arm, or complete the active autonomous loop. Complete only after verifying its predicate against real state.",
    parameters: Type.Object({
      action: StringEnum(["status", "arm", "complete"] as const),
      directive: Type.Optional(Type.String()),
    }),
    async execute(_id, params) {
      if (params.action === "arm") {
        if (!params.directive?.trim()) throw new Error("pstack_loop arm requires a directive.");
        loopActive = true;
        loopDirective = params.directive.trim();
      }
      if (params.action === "complete") {
        loopActive = false;
        if (loopTimer) clearTimeout(loopTimer);
        loopTimer = undefined;
      }
      pi.appendEntry(LOOP_ENTRY, { active: loopActive, directive: loopDirective });
      return {
        content: [{ type: "text", text: loopActive ? `Loop active: ${loopDirective}` : "Loop inactive." }],
        details: { active: loopActive, directive: loopDirective },
      };
    },
  });

  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "bash") return;
    const input = event.input as { command?: string };
    const operation = input.command ? knownExternalWrite(input.command) : undefined;
    if (!operation) return;
    if (!ctx.hasUI) return { block: true, reason: `${operation} requires explicit user confirmation; non-interactive Pi cannot request it.` };
    const approved = await ctx.ui.confirm("Confirm external or irreversible action", `Allow ${operation}?\n\n${input.command}`);
    if (!approved) return { block: true, reason: `User declined ${operation}.` };
  });

  pi.registerCommand("poteto-mode", {
    description: "Enable or disable sticky pstack Poteto Mode in interactive sessions. Non-interactive runs use /skill:poteto-mode.",
    handler: async (args, ctx) => {
      if (/^(off|disable|stop)$/i.test(args.trim())) {
        setPotetoMode(false);
        ctx.ui.setStatus("pstack-mode", undefined);
        ctx.ui.notify("Poteto Mode disabled for this session.", "info");
        return;
      }
      setPotetoMode(true);
      ctx.ui.setStatus("pstack-mode", "pstack: poteto mode");
      if (ctx.mode === "print" || ctx.mode === "json") {
        ctx.ui.notify("Use /skill:poteto-mode for non-interactive runs.", "warning");
        return;
      }
      pi.sendUserMessage(`/skill:poteto-mode${args.trim() ? ` ${args.trim()}` : ""}`);
    },
  });

  pi.registerCommand("setup-pstack", {
    description: "Interactively map pstack delegation roles to models available in Pi.",
    handler: async (_args, ctx) => {
      const config = await readConfig();
      const available = (ctx.scopedModels.length ? ctx.scopedModels.map((entry) => entry.model) : ctx.modelRegistry.getAvailable())
        .map((model) => `${model.provider}/${model.id}`);
      const choices = ["inherit-parent", ...new Set(available)];
      if (!ctx.hasUI) {
        await writeConfig(defaultConfig());
        return;
      }
      for (const role of ROLE_NAMES) {
        const current = config.roles[role];
        const selected = await ctx.ui.select(`Model for ${role}`, choices.map((model) => model === current ? `${model} (current)` : model));
        if (!selected) break;
        config.roles[role] = selected.replace(/ \(current\)$/, "");
      }
      await writeConfig(config);
      ctx.ui.notify(`Saved pstack model settings to ${configPath()}.`, "info");
    },
  });

  pi.registerTool({
    name: "pstack_question",
    label: "Pstack Question",
    description: "Ask a structured pstack question through Pi. Use only for genuine user preferences, irreversible choices, or unresolved product decisions.",
    parameters: Type.Object({
      questions: Type.Array(Type.Object({
        header: Type.Optional(Type.String()),
        question: Type.String(),
        options: Type.Array(Type.Object({
          label: Type.String(),
          description: Type.Optional(Type.String()),
        }), { minItems: 1 }),
      }), { minItems: 1 }),
    }),
    async execute(_id, params, _signal, _update, ctx) {
      if (!ctx.hasUI) throw new Error("pstack_question requires an interactive Pi session. Persist this decision as a human gate instead.");
      const answers: Array<{ question: string; answer: string }> = [];
      for (const question of params.questions) {
        const labels = question.options.map((option) => option.description ? `${option.label} - ${option.description}` : option.label);
        const selected = await ctx.ui.select(question.header ?? question.question, labels);
        if (!selected) throw new Error(`The user dismissed ${JSON.stringify(question.question)}.`);
        const index = labels.indexOf(selected);
        answers.push({ question: question.question, answer: question.options[index]?.label ?? selected });
      }
      return { content: [{ type: "text", text: answers.map((answer) => `${answer.question}\n${answer.answer}`).join("\n\n") }], details: { answers } };
    },
  });

  pi.registerTool({
    name: "pstack_todo",
    label: "Pstack Todo",
    description: "Maintain pstack's current task checklist. Use at the start of non-trivial multi-step work, then update it as work advances.",
    parameters: Type.Union([
      Type.Object({ action: Type.Literal("get") }),
      Type.Object({ action: Type.Literal("set"), items: Type.Array(Type.String()) }),
      Type.Object({ action: Type.Literal("add"), item: Type.String() }),
      Type.Object({ action: Type.Literal("complete"), item: Type.String() }),
    ]),
    async execute(_id, params) {
      if (params.action === "set") todos = params.items;
      if (params.action === "add") todos = [...todos, params.item];
      if (params.action === "complete") todos = todos.map((item) => item === params.item ? `[done] ${item}` : item);
      pi.appendEntry("pstack-todo", { items: todos });
      return { content: [{ type: "text", text: todos.length ? todos.map((item, index) => `${index + 1}. ${item}`).join("\n") : "No pstack todo items." }], details: { items: todos } };
    },
  });

  pi.registerTool({
    name: "pstack_sessions",
    label: "Pstack Sessions",
    description: "List or read Pi session files scoped to the current working directory. Never glob unrelated project session directories.",
    parameters: Type.Object({
      action: StringEnum(["list", "read"] as const),
      path: Type.Optional(Type.String({ description: "Exact session path returned by the list action." })),
    }),
    async execute(_id, params, _signal, _update, ctx) {
      const sessions = await SessionManager.list(ctx.cwd);
      const files = sessions.map((session) => session.path);
      if (params.action === "list") {
        return { content: [{ type: "text", text: files.join("\n") || "No saved sessions for this working directory." }], details: { files } };
      }
      if (!params.path || !files.includes(params.path)) throw new Error("pstack_sessions read requires an exact current-workspace path returned by pstack_sessions list.");
      const content = await readFile(params.path);
      const maxBytes = 256 * 1024;
      const truncated = content.length > maxBytes;
      const tail = truncated ? content.subarray(content.length - maxBytes) : content;
      const bounded = `${truncated ? "[Earlier transcript content omitted.]\n" : ""}${tail.toString("utf8")}`;
      return { content: [{ type: "text", text: bounded }], details: { path: params.path, truncated } };
    },
  });

  pi.registerTool({
    name: "pstack_config",
    label: "Pstack Config",
    description: "Read or update pstack's role-to-model configuration. Use list-models before setting a model. inherit-parent makes a subagent use the parent session model.",
    parameters: Type.Object({
      action: StringEnum(["get", "list-models", "set"] as const),
      role: Type.Optional(Type.String()),
      model: Type.Optional(Type.String()),
      models: Type.Optional(Type.Array(Type.String(), { description: "Optional ordered model pool for a parallel review role." })),
    }),
    async execute(_id, params, _signal, _update, ctx) {
      if (params.action === "list-models") {
        const models = (ctx.scopedModels.length ? ctx.scopedModels.map((entry) => entry.model) : ctx.modelRegistry.getAvailable())
          .map((model) => `${model.provider}/${model.id}`);
        return { content: [{ type: "text", text: ["inherit-parent", ...models].join("\n") }], details: { models } };
      }
      const config = await readConfig();
      if (params.action === "set") {
        if (!params.role || (!params.model && !params.models?.length)) throw new Error("pstack_config set requires role plus model or models.");
        if (!(ROLE_NAMES as readonly string[]).includes(params.role)) throw new Error(`Unknown pstack role ${JSON.stringify(params.role)}.`);
        const selected = params.models?.length ? params.models : [params.model!];
        const available = new Set((ctx.scopedModels.length ? ctx.scopedModels.map((entry) => entry.model) : ctx.modelRegistry.getAvailable())
          .map((model) => `${model.provider}/${model.id}`));
        for (const model of selected) {
          if (model !== "inherit-parent" && model !== "auto" && !available.has(model)) {
            throw new Error(`Unavailable pstack model ${JSON.stringify(model)}.`);
          }
        }
        config.roles[params.role] = params.models?.length ? selected : selected[0];
        await writeConfig(config);
      }
      return { content: [{ type: "text", text: JSON.stringify(config, null, 2) }], details: config };
    },
  });

}
