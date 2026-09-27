import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type ContextEvent,
  type ExtensionAPI,
  type ExtensionContext,
  parseSkillBlock,
  stripFrontmatter,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Check } from "typebox/value";
import type { Profile } from "./child-session.js";
import { installExecutor } from "./executor.js";
import { availableModels, ModelsInput, modelState, parseRoles, saveModels } from "./models.js";
import { installQuestionTool } from "./question.js";

const root = fileURLToPath(new URL("..", import.meta.url));

const skillsDir = join(root, "content/pstack/skills");

const modePath = join(skillsDir, "poteto-mode/SKILL.md");

const modeType = "pstack-mode";

const todoType = "pstack-todo";

const ModeEntry = Type.Object({ enabled: Type.Boolean() });

const TodoEntry = Type.Object({ items: Type.Array(Type.String()) });

function branchData(ctx: ExtensionContext, customType: string) {
  const entry = ctx.sessionManager
    .getBranch()
    .findLast((item) => item.type === "custom" && item.customType === customType);

  if (entry?.type !== "custom") return undefined;

  const data: unknown = entry.data;

  return data;
}

function modeEnabled(ctx: ExtensionContext) {
  const data = branchData(ctx, modeType);

  return Check(ModeEntry, data) && data.enabled;
}

function result(text: string) {
  return { content: [{ type: "text" as const, text }], details: {} };
}

async function resources(profile?: Profile) {
  const [mode, host, setup] = await Promise.all([
    readFile(modePath, "utf8"),
    readFile(join(root, "instructions/pi-host.md"), "utf8"),
    readFile(join(skillsDir, "setup-pstack/SKILL.md"), "utf8"),
  ]);

  const identity =
    profile !== undefined && profile !== "generalPurpose"
      ? stripFrontmatter(
          await readFile(
            join(
              root,
              "content/pstack/agents",
              profile === "poteto-agent" ? "poteto-agent.md" : "comment-sicko.md",
            ),
            "utf8",
          ),
        ).trim()
      : "";

  return { mode: stripFrontmatter(mode).trim(), identity, host, roles: parseRoles(setup) };
}

function modeReference(message: ContextEvent["messages"][number], mode: string) {
  if (message.role !== "user") return message;

  const project = (text: string) => {
    const skill = parseSkillBlock(text);

    if (
      skill?.name !== "poteto-mode" ||
      skill.location !== modePath ||
      !skill.content.includes(mode)
    )
      return text;

    return text.replace(mode, "Full Poteto mode instructions are supplied in the system prompt.");
  };

  return {
    ...message,
    content: Array.isArray(message.content)
      ? message.content.map((part) =>
          part.type === "text" ? { ...part, text: project(part.text) } : part,
        )
      : project(message.content),
  };
}

export function createRuntime(pi: ExtensionAPI, options?: { profile: Profile }): void {
  if (options === undefined) installExecutor(pi, createRuntime);
  let loaded: ReturnType<typeof resources> | undefined;
  const source = () => (loaded ??= resources(options?.profile));

  const persistMode = (enabled: boolean, ctx: ExtensionContext) => {
    if (modeEnabled(ctx) !== enabled) pi.appendEntry(modeType, { enabled });

    if (ctx.hasUI) ctx.ui.notify(`Poteto mode ${enabled ? "on" : "off"}`, "info");
  };

  pi.on("input", (event, ctx) => {
    if (event.text === "/skill:poteto-mode" || event.text.startsWith("/skill:poteto-mode "))
      persistMode(true, ctx);

    return { action: "continue" };
  });
  pi.on("before_agent_start", async (event, ctx) => {
    const content = await source();
    let projection: string;

    try {
      const state = await modelState(content.roles, ctx);
      projection = JSON.stringify({
        parentSelector: state.parentSelector,
        roles: state.roles,
        error: state.error,
      });
    } catch (error) {
      projection = `Invalid PStack role configuration: ${String(error)}. Use /setup-pstack to replace it.`;
    }

    const mode =
      options?.profile === "poteto-agent" || (options === undefined && modeEnabled(ctx))
        ? `\n\n${content.mode}`
        : "";

    return {
      systemPrompt: `${event.systemPrompt}\n\n${content.identity}${mode}\n\nPackaged PStack skills directory: ${skillsDir}\n\n${content.host}\n\nCurrent Pi transcript (null means unavailable): ${JSON.stringify(ctx.sessionManager.getSessionFile() ?? null)}\n\nCurrent Pi history scope: ${JSON.stringify({ cwd: ctx.cwd, directory: ctx.sessionManager.getSessionDir() })}\n\n## PStack role map\n${projection}`,
    };
  });
  pi.on("context", async (event, ctx) => {
    const { mode } = await source();

    if (!ctx.getSystemPrompt().includes(mode)) return;

    return { messages: event.messages.map((message) => modeReference(message, mode)) };
  });
  pi.registerCommand("poteto-mode", {
    description: "Enable or disable Poteto mode; optionally start a task",
    handler: async (args, ctx) => {
      const task = args.trim();

      if (task === "" || task === "on" || task === "off") {
        persistMode(task !== "off", ctx);

        return;
      }

      if (ctx.mode === "print" || ctx.mode === "json")
        throw new Error("Use /skill:poteto-mode <task> in print/json mode.");

      persistMode(true, ctx);
      pi.sendUserMessage(`/skill:poteto-mode ${task}`, { expandPromptTemplates: true });
    },
  });
  pi.registerCommand("setup-pstack", {
    description: "Run PStack model setup",
    handler: async (args, ctx) => {
      if (ctx.mode === "print" || ctx.mode === "json")
        throw new Error("Use /skill:setup-pstack in print/json mode.");

      pi.sendUserMessage(`/skill:setup-pstack${args === "" ? "" : ` ${args}`}`, {
        expandPromptTemplates: true,
      });
    },
  });
  pi.registerTool({
    name: "pstack_models",
    label: "PStack models",
    description:
      "List exact available provider/model IDs and thinking levels; get source defaults and effective role mappings; set the confirmed complete role table and budget. Missing or invalid routes require a choice, never an implicit fallback.",
    parameters: ModelsInput,
    async execute(_id, params, _signal, _update, ctx) {
      const { roles } = await source();

      switch (params.action) {
        case "list":
          return result(JSON.stringify(availableModels(ctx)));
        case "get":
          return result(JSON.stringify(await modelState(roles, ctx)));
        case "set": {
          if (params.roles === undefined || params.budget === undefined)
            throw new Error("set requires both roles and budget");

          return result(JSON.stringify(await saveModels(params.roles, params.budget, roles, ctx)));
        }
      }
    },
  });
  pi.registerTool({
    name: "pstack_todo",
    label: "PStack todo",
    description:
      "Get this session branch's todo list, or replace it with the complete supplied items list.",
    parameters: Type.Object({ items: Type.Optional(Type.Array(Type.String())) }),
    async execute(_id, params, _signal, _update, ctx) {
      if (params.items !== undefined) pi.appendEntry(todoType, { items: params.items });

      const data = branchData(ctx, todoType);
      const items = Check(TodoEntry, data) ? data.items : [];

      return result(JSON.stringify(params.items ?? items));
    },
  });
  installQuestionTool(pi);
}
