import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const root = fileURLToPath(new URL("..", import.meta.url));
const MODE = "pstack-mode";
const TODO = "pstack-todo";
type Budget = "unlimited" | "large" | "medium" | "small";
type Target = string | string[];
type Config = { version: 1; budget: Budget; roles: Record<string, Target> };
type Role = { name: string; panel: boolean; defaults: Target };
const levels = ["off", "low", "medium", "high", "xhigh", "max"];
const targetLevel: Record<Exclude<Budget, "unlimited">, string> = { large: "xhigh", medium: "high", small: "medium" };

async function resource(path: string): Promise<string> {
  try { return await readFile(join(root, path), "utf8"); }
  catch (error) { throw new Error(`Required pstack resource is missing or unreadable: ${path}`, { cause: error }); }
}
export function parseRoles(skill: string): Role[] {
  const block = skill.match(/```[^\n]*\n([\s\S]*?)\n```/)?.[1];
  if (!block) throw new Error("setup-pstack skill has no fenced role map");
  const lines = block.split("\n");
  const start = lines.findIndex(line => line.trim() === "# budget: unlimited (max)");
  if (start < 0) throw new Error("setup-pstack role map lacks '# budget: unlimited (max)'");
  return lines.slice(start + 1).filter(line => line.includes(":")).map(line => {
    const i = line.indexOf(":");
    const name = line.slice(0, i).trim();
    const values = line.slice(i + 1).split(",").map(v => v.trim()).filter(Boolean);
    if (!name || !values.length) throw new Error(`Invalid source role line: ${line}`);
    const panel = values.length > 1;
    return { name, panel, defaults: panel ? values : values[0] };
  });
}
function entries(ctx: any): any[] { return ctx.sessionManager.getBranch(); }
function restoreMode(ctx: any, defaultMode: boolean): boolean {
  let mode = defaultMode;
  for (const entry of entries(ctx)) if (entry.type === "custom" && entry.customType === MODE && typeof entry.data?.enabled === "boolean") mode = entry.data.enabled;
  return mode;
}
function result(text: string, isError = false) { return { content: [{ type: "text" as const, text }], details: {}, isError }; }
async function readConfig(): Promise<Config | null> {
  try { const data = JSON.parse(await readFile(join(getAgentDir(), "pstack-models.json"), "utf8")); return data?.version === 1 ? data as Config : null; }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; throw e; }
}
async function writeConfig(config: Config): Promise<void> {
  const path = join(getAgentDir(), "pstack-models.json"); await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  try { await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, { flag: "wx", mode: 0o600 }); await rename(temporary, path); }
  catch (e) { const { unlink } = await import("node:fs/promises"); await unlink(temporary).catch(() => {}); throw e; }
}
function models(ctx: any): any[] { return ctx.modelRegistry.getAvailable(); }
function available(ctx: any, target: string): { selector?: string; error?: string } {
  if (target === "inherit-parent" || target === "auto") {
    if (!ctx.model || !ctx.thinkingLevel) return { error: `${target}: parent model or thinking level is unavailable` };
    return { selector: `${ctx.model.provider}/${ctx.model.id}:${ctx.thinkingLevel}` };
  }
  const match = target.match(/^([^/]+)\/([^:]+):([^:]+)$/);
  if (!match) return { error: `Expected exact provider/model:thinking selector: ${target}` };
  const model = models(ctx).find(m => m.provider === match[1] && m.id === match[2]);
  if (!model) return { error: `Unavailable model ${match[1]}/${match[2]}` };
  const supported = getSupportedThinkingLevels(model) as string[];
  if (!supported.includes(match[3])) return { error: `Unsupported thinking level ${match[3]} for ${match[1]}/${match[2]}; supported: ${supported.join(", ") || "none"}` };
  return { selector: target };
}
function roleMap(ctx: any, config: Config | null, roles: Role[]) {
  return Object.fromEntries(roles.map(role => {
    const value = config?.roles[role.name];
    const effective = (Array.isArray(value) ? value : value === undefined ? (role.panel ? role.defaults as string[] : [role.defaults as string]) : [value]).map((s: string) => ({ requested: s, ...available(ctx, s) }));
    return [role.name, role.panel ? effective : effective[0]];
  }));
}
function normalize(target: string, budget: Budget, ctx: any): string | null {
  if (target === "inherit-parent" || target === "auto") return target;
  const parsed = target.match(/^([^/]+)\/([^:]+):([^:]+)$/);
  if (!parsed) return null;
  const model = models(ctx).find(m => m.provider === parsed[1] && m.id === parsed[2]);
  if (!model) return null;
  if (budget === "unlimited") return target;
  const supported = getSupportedThinkingLevels(model) as string[];
  const cap = levels.indexOf(targetLevel[budget]);
  const chosen = levels.slice(1, cap + 1).reverse().find(level => supported.includes(level));
  return chosen ? `${parsed[1]}/${parsed[2]}:${chosen}` : null;
}

export function createRuntime(pi: ExtensionAPI, defaultMode = false): void {
  let mode = defaultMode;
  let source: Promise<{ skill: string; host: string; roles: Role[] }>;
  const resources = () => source ??= Promise.all([resource("content/pstack/skills/poteto-mode/SKILL.md"), resource("instructions/pi-host.md"), resource("skills/setup-pstack/SKILL.md")]).then(([skill, host, setup]) => ({ skill, host, roles: parseRoles(setup) }));
  const persistMode = (enabled: boolean, ctx: any) => { mode = enabled; pi.appendEntry(MODE, { enabled }); ctx.ui.notify(`Poteto mode ${enabled ? "on" : "off"}`, "info"); };
  const restore = (_event: unknown, ctx: any) => { mode = restoreMode(ctx, defaultMode); };
  pi.on("session_start", restore);
  pi.on("session_tree", restore);
  pi.on("input", async (event: any, ctx: any) => {
    if (event.text === "/skill:poteto-mode" || event.text.startsWith("/skill:poteto-mode ")) { mode = true; pi.appendEntry(MODE, { enabled: true }); return { action: "continue" }; }
    return { action: "continue" };
  });
  pi.on("before_agent_start", async (event: any, ctx: any) => {
    const loaded = await resources();
    const configured = await readConfig();
    const projected = roleMap(ctx, configured, loaded.roles);
    const scoped = `${loaded.host}\n\n## PStack role map (PStack skills only)\n${JSON.stringify(projected)}`;
    return { systemPrompt: `${event.systemPrompt}\n\n${scoped}${mode ? `\n\n${loaded.skill}` : ""}` };
  });
  pi.registerCommand("poteto-mode", { description: "Enable or disable Poteto mode", handler: async (args, ctx) => {
    const task = args.trim();
    if (task && task !== "on" && task !== "off" && ctx.mode !== "tui" && ctx.mode !== "rpc") { console.error("Use /skill:poteto-mode <task> in print/json mode."); return; }
    if (!task || task === "on") { persistMode(true, ctx); return; }
    if (task === "off") { persistMode(false, ctx); return; }
    mode = true; pi.appendEntry(MODE, { enabled: true }); pi.sendUserMessage(`/skill:poteto-mode ${task}`, { expandPromptTemplates: true });
  } });
  pi.registerCommand("setup-pstack", { description: "Run pstack model setup", handler: async (args, ctx) => {
    if (ctx.mode !== "tui" && ctx.mode !== "rpc") { console.error("Use /skill:setup-pstack in print/json mode."); return; }
    pi.sendUserMessage(`/skill:setup-pstack${args ? ` ${args}` : ""}`, { expandPromptTemplates: true });
  } });
  pi.registerTool({ name: "pstack_models", label: "PStack models", description: "List available Pi models, inspect role mappings, or persist a fully validated role table and budget after setup has obtained user choices.", parameters: Type.Object({ action: Type.String(), budget: Type.Optional(Type.String()), roles: Type.Optional(Type.Record(Type.String(), Type.Union([Type.String(), Type.Array(Type.String())]))) }), async execute(_id, params: any, _signal, _update, ctx) {
    try {
      const { roles } = await resources(); const config = await readConfig();
      if (params.action === "list") return result(JSON.stringify(models(ctx).map(m => ({ provider: m.provider, id: m.id, thinking: getSupportedThinkingLevels(m) }))));
      if (params.action === "get") return result(JSON.stringify({ config, sourceDefaults: Object.fromEntries(roles.map(r => [r.name, r.defaults])), roles: roleMap(ctx, config, roles) }));
      if (params.action !== "set") return result("action must be list, get, or set", true);
      if (!params.roles || !["unlimited", "large", "medium", "small"].includes(params.budget)) return result("set requires a complete roles table and valid budget", true);
      const expected = roles.map(r => r.name).sort();
      if (Object.keys(params.roles).sort().join("\0") !== expected.join("\0")) return result(`roles must contain exactly: ${expected.join(", ")}`, true);
      const applied: Record<string, Target> = {};
      for (const role of roles) {
        const value = params.roles[role.name];
        if (role.panel !== Array.isArray(value) || (Array.isArray(value) && !value.length) || (typeof value === "string" && !value.trim())) return result(`Invalid single/panel shape for ${role.name}`, true);
        const input = (Array.isArray(value) ? value : [value]) as string[];
        const output: string[] = [];
        for (const selector of input) {
          const normalized = normalize(selector, params.budget, ctx);
          if (!normalized) return result(`No supported reasoning level at or below ${params.budget} for ${selector}; ask the user to choose a supported selector`, true);
          const check = available(ctx, normalized);
          if (check.error) return result(`${check.error}; ask the user to choose an available selector`, true);
          output.push(normalized);
        }
        applied[role.name] = role.panel ? output : output[0];
      }
      const saved: Config = { version: 1, budget: params.budget, roles: applied }; await writeConfig(saved); return result(JSON.stringify({ config: saved, roles: roleMap(ctx, saved, roles) }));
    } catch (error) { return result(String(error), true); }
  } });
  pi.registerTool({ name: "pstack_todo", label: "PStack todo", description: "Get or replace the current session branch's todo list.", parameters: Type.Object({ items: Type.Optional(Type.Array(Type.String())) }), async execute(_id, params: any, _signal, _update, ctx) {
    if (params.items !== undefined) pi.appendEntry(TODO, { items: params.items });
    let items: string[] = [];
    for (const entry of entries(ctx)) if (entry.type === "custom" && entry.customType === TODO && Array.isArray(entry.data?.items)) items = entry.data.items;
    return result(JSON.stringify(items));
  } });
  pi.registerTool({ name: "pstack_question", label: "PStack question", description: "Ask the user to choose one of the supplied options.", parameters: Type.Object({ question: Type.String(), options: Type.Array(Type.String()) }), async execute(_id, params: any, _signal, _update, ctx) {
    if (!ctx.hasUI) return result("Cannot ask interactively in this mode; ask the user directly.", true);
    if (!params.options.length) return result("No options supplied; ask the user directly.", true);
    const answer = await ctx.ui.select(params.question, params.options);
    return answer === undefined ? result("Question dismissed; ask the user directly.", true) : result(answer);
  } });
}
