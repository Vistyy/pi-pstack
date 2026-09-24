import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const root = fileURLToPath(new URL("..", import.meta.url));

const skillsDir = join(root, "content/pstack/skills");

const MODE = "pstack-mode";

const TODO = "pstack-todo";

type Budget = "unlimited" | "large" | "medium" | "small";

type Target = string | string[];

type Config = { version: 1; budget: Budget; roles: Record<string, Target> };

type Role = { name: string; panel: boolean; defaults: Target };

const budgets: readonly string[] = ["unlimited", "large", "medium", "small"];

const levels = ["off", "low", "medium", "high", "xhigh", "max"] as const;

const caps: Record<Exclude<Budget, "unlimited">, string> = {
  large: "xhigh",
  medium: "high",
  small: "medium",
};

async function resource(path: string): Promise<string> {
  try {
    return await readFile(join(root, path), "utf8");
  } catch (error) {
    throw new Error(`Required pstack resource is missing or unreadable: ${path}`, { cause: error });
  }
}

export function parseRoles(skill: string): Role[] {
  const block = [...skill.matchAll(/```[^\n]*\n([\s\S]*?)\n```/g)]
    .map((match) => match[1])
    .find((text) => text?.includes("# budget: unlimited (max)"));

  if (!block)
    throw new Error("setup-pstack role map lacks '# budget: unlimited (max)' fenced rule");
  const lines = block.split("\n");
  const start = lines.findIndex((line) => line.trim() === "# budget: unlimited (max)");
  const map = lines.slice(start + 1).filter((line) => line.trim() && !line.startsWith("#"));

  const roles = map.map((line) => {
    const match = line.match(/^([^:]+):\s*(.+)$/);

    if (!match?.[1] || !match[2]) throw new Error(`Invalid source role line: ${line}`);
    const values = match[2].split(",").map((value) => value.trim());

    if (values.some((value) => !value)) throw new Error(`Invalid source role line: ${line}`);

    return {
      name: match[1].trim(),
      panel: values.length > 1,
      defaults: values.length > 1 ? values : (values[0] ?? ""),
    };
  });

  if (roles.length !== 17 || new Set(roles.map((role) => role.name)).size !== 17)
    throw new Error("Expected 17 distinct source roles");

  return roles;
}

function branch(ctx: ExtensionContext) {
  return ctx.sessionManager.getBranch();
}

function restoreMode(ctx: ExtensionContext): boolean {
  let enabled = false;

  for (const entry of branch(ctx))
    if (
      entry.type === "custom" &&
      entry.customType === MODE &&
      record(entry.data) &&
      typeof entry.data["enabled"] === "boolean"
    )
      enabled = entry.data["enabled"];

  return enabled;
}

function result(text: string, isError = false) {
  return { content: [{ type: "text" as const, text }], details: {}, isError };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function budget(value: unknown): value is Budget {
  return typeof value === "string" && budgets.includes(value);
}

function validateRoles(value: unknown, roles: Role[]): value is Record<string, Target> {
  if (
    !record(value) ||
    Object.keys(value).sort().join("\0") !==
      roles
        .map((role) => role.name)
        .sort()
        .join("\0")
  )
    return false;

  return roles.every((role) => {
    const target = value[role.name];

    return role.panel
      ? Array.isArray(target) &&
          target.length > 0 &&
          target.every((item) => typeof item === "string" && item.trim() !== "")
      : typeof target === "string" && target.trim() !== "";
  });
}

async function readConfig(roles: Role[]): Promise<Config | null> {
  let raw: string;

  try {
    raw = await readFile(join(getAgentDir(), "pstack-models.json"), "utf8");
  } catch (error) {
    if (record(error) && error["code"] === "ENOENT") return null;
    throw error;
  }

  let data: unknown;

  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("Invalid pstack-models.json: malformed JSON");
  }

  if (
    !record(data) ||
    Object.keys(data).sort().join() !== "budget,roles,version" ||
    data["version"] !== 1 ||
    !budget(data["budget"]) ||
    !validateRoles(data["roles"], roles)
  )
    throw new Error(
      "Invalid pstack-models.json: expected version 1, budget and complete role table",
    );

  return { version: 1, budget: data["budget"], roles: data["roles"] };
}

async function writeConfig(config: Config): Promise<void> {
  const path = join(getAgentDir(), "pstack-models.json");
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;

  try {
    await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

function models(ctx: ExtensionContext) {
  return ctx.modelRegistry.getAvailable();
}

function available(ctx: ExtensionContext, target: string): { selector?: string; error?: string } {
  if (target === "inherit-parent" || target === "auto") {
    if (!ctx.model) return { error: `${target}: current parent model is unavailable` };

    return { selector: `${ctx.model.provider}/${ctx.model.id}:${ctx.thinkingLevel}` };
  }

  const match = target.match(/^([^/]+)\/([^:]+):([^:]+)$/);

  if (!match) return { error: `Expected exact provider/model:thinking selector: ${target}` };
  const model = models(ctx).find((item) => item.provider === match[1] && item.id === match[2]);

  if (!model) return { error: `Unavailable model ${match[1]}/${match[2]}` };
  const supported = getSupportedThinkingLevels(model);

  if (!supported.some((level) => level === match[3]))
    return {
      error: `Unsupported thinking level ${match[3]} for ${match[1]}/${match[2]}; supported: ${supported.join(", ") || "none"}`,
    };

  return { selector: target };
}

function roleMap(ctx: ExtensionContext, config: Config | null, roles: Role[]) {
  return Object.fromEntries(
    roles.map((role) => {
      const value = config?.roles[role.name];

      if (value === undefined)
        return [
          role.name,
          {
            error: "Missing config; choose an available Pi selector",
            sourceDefault: role.defaults,
          },
        ];

      const selected = (Array.isArray(value) ? value : [value]).map((requested) => ({
        requested,
        ...available(ctx, requested),
      }));

      return [role.name, role.panel ? selected : selected[0]];
    }),
  );
}

function normalize(target: string, choice: Budget, ctx: ExtensionContext): string | null {
  if (target === "inherit-parent" || target === "auto") return target;
  const parsed = target.match(/^([^/]+)\/([^:]+):([^:]+)$/);

  if (!parsed) return null;
  const model = models(ctx).find((item) => item.provider === parsed[1] && item.id === parsed[2]);

  if (!model) return null;

  if (choice === "unlimited") return target;
  const supported = getSupportedThinkingLevels(model);
  const cap = levels.findIndex((level) => level === caps[choice]);

  const chosen = levels
    .slice(1, cap + 1)
    .reverse()
    .find((level) => supported.some((s) => s === level));

  return chosen ? `${parsed[1]}/${parsed[2]}:${chosen}` : null;
}

function validateSelector(selector: string, choice: Budget, ctx: ExtensionContext): string {
  const normalized = normalize(selector, choice, ctx);

  if (normalized === null)
    throw new Error(
      `No supported reasoning level at or below ${choice} for ${selector}; ask the user to choose a supported selector`,
    );
  const check = available(ctx, normalized);

  if (check.error !== undefined)
    throw new Error(`${check.error}; ask the user to choose an available selector`);

  return normalized;
}

function applyRoles(
  selected: Record<string, Target>,
  choice: Budget,
  roles: Role[],
  ctx: ExtensionContext,
): Record<string, Target> {
  const applied: Record<string, Target> = {};

  for (const role of roles) {
    const value = selected[role.name];

    if (value === undefined) throw new Error(`Missing ${role.name}`);

    const output = (Array.isArray(value) ? value : [value]).map((selector) =>
      validateSelector(selector, choice, ctx),
    );

    applied[role.name] = role.panel ? output : (output[0] ?? "");
  }

  return applied;
}

export function createRuntime(pi: ExtensionAPI): void {
  let mode = false;
  let source: Promise<{ skill: string; host: string; roles: Role[] }> | undefined;

  const resources = () =>
    (source ??= Promise.all([
      resource("content/pstack/skills/poteto-mode/SKILL.md"),
      resource("instructions/pi-host.md"),
      resource("content/pstack/skills/setup-pstack/SKILL.md"),
    ]).then(([skill, host, setup]) => ({ skill, host, roles: parseRoles(setup) })));

  const persistMode = (enabled: boolean, ctx: ExtensionContext) => {
    mode = enabled;
    pi.appendEntry(MODE, { enabled });

    if (ctx.hasUI) ctx.ui.notify(`Poteto mode ${enabled ? "on" : "off"}`, "info");
  };

  const restore = (_event: unknown, ctx: ExtensionContext) => {
    mode = restoreMode(ctx);
  };

  pi.on("session_start", restore);
  pi.on("session_tree", restore);
  pi.on("input", (event, ctx) => {
    if (event.text === "/skill:poteto-mode" || event.text.startsWith("/skill:poteto-mode "))
      persistMode(true, ctx);

    return { action: "continue" };
  });
  pi.on("before_agent_start", async (event, ctx) => {
    const loaded = await resources();
    const config = mode ? await readConfig(loaded.roles) : null;
    const mechanics = `Packaged PStack skills directory: ${skillsDir}\n\n${loaded.host}`;

    return {
      systemPrompt: `${event.systemPrompt}\n\n${mechanics}${mode ? `\n\n## PStack role map\n${JSON.stringify(roleMap(ctx, config, loaded.roles))}\n\n${loaded.skill}` : ""}`,
    };
  });
  pi.registerCommand("poteto-mode", {
    description: "Enable or disable Poteto mode",
    handler: async (args, ctx) => {
      const task = args.trim();

      if (task && task !== "on" && task !== "off" && !ctx.hasUI) {
        console.error("Use /skill:poteto-mode <task> in print/json mode.");

        return;
      }

      if (!task || task === "on") {
        persistMode(true, ctx);

        return;
      }

      if (task === "off") {
        persistMode(false, ctx);

        return;
      }

      persistMode(true, ctx);
      pi.sendUserMessage(`/skill:poteto-mode ${task}`, { expandPromptTemplates: true });
    },
  });
  pi.registerCommand("setup-pstack", {
    description: "Run pstack model setup",
    handler: async (args, ctx) => {
      if (!ctx.hasUI) {
        console.error("Use /skill:setup-pstack in print/json mode.");

        return;
      }

      pi.sendUserMessage(`/skill:setup-pstack${args ? ` ${args}` : ""}`, {
        expandPromptTemplates: true,
      });
    },
  });
  pi.registerTool({
    name: "pstack_models",
    label: "PStack models",
    description:
      "List available models, inspect role mappings, or persist a validated complete role table and budget.",
    parameters: Type.Object({
      action: Type.String(),
      budget: Type.Optional(Type.String()),
      roles: Type.Optional(
        Type.Record(Type.String(), Type.Union([Type.String(), Type.Array(Type.String())])),
      ),
    }),
    async execute(_id, params, _signal, _update, ctx) {
      try {
        const { roles } = await resources();

        if (params.action === "list")
          return result(
            JSON.stringify(
              models(ctx).map((model) => ({
                provider: model.provider,
                id: model.id,
                thinking: getSupportedThinkingLevels(model),
              })),
            ),
          );

        if (params.action === "get") {
          const config = await readConfig(roles);

          return result(
            JSON.stringify({
              config,
              sourceDefaults: Object.fromEntries(roles.map((role) => [role.name, role.defaults])),
              roles: roleMap(ctx, config, roles),
            }),
          );
        }

        if (params.action !== "set") return result("action must be list, get, or set", true);

        if (!budget(params.budget) || !validateRoles(params.roles, roles))
          return result(
            `set requires a valid budget and exactly these roles with correct single/panel shapes: ${roles.map((role) => role.name).join(", ")}`,
            true,
          );
        const applied = applyRoles(params.roles, params.budget, roles, ctx);
        const saved: Config = { version: 1, budget: params.budget, roles: applied };
        await writeConfig(saved);

        return result(JSON.stringify({ config: saved, roles: roleMap(ctx, saved, roles) }));
      } catch (error) {
        return result(String(error), true);
      }
    },
  });
  pi.registerTool({
    name: "pstack_todo",
    label: "PStack todo",
    description: "Get or replace the current session branch's todo list.",
    parameters: Type.Object({ items: Type.Optional(Type.Array(Type.String())) }),
    async execute(_id, params, _signal, _update, ctx) {
      if (params.items !== undefined) pi.appendEntry(TODO, { items: params.items });
      let items: string[] = [];

      for (const entry of branch(ctx))
        if (
          entry.type === "custom" &&
          entry.customType === TODO &&
          record(entry.data) &&
          Array.isArray(entry.data["items"]) &&
          entry.data["items"].every((item) => typeof item === "string")
        )
          items = entry.data["items"];

      return result(JSON.stringify(params.items ?? items));
    },
  });
  pi.registerTool({
    name: "pstack_question",
    label: "PStack question",
    description: "Ask the user to choose one of the supplied options.",
    parameters: Type.Object({ question: Type.String(), options: Type.Array(Type.String()) }),
    async execute(_id, params, _signal, _update, ctx) {
      if (!ctx.hasUI)
        return result("Cannot ask interactively in this mode; ask the user directly.", true);

      if (!params.options.length)
        return result("No options supplied; ask the user directly.", true);
      const answer = await ctx.ui.select(params.question, params.options);

      return answer === undefined
        ? result("Question dismissed; ask the user directly.", true)
        : result(answer);
    },
  });
}
