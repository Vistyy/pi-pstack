import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export const ROLE_NAMES = [
  "feature, refactoring",
  "bug-fix",
  "perf-issue",
  "hillclimb",
  "judgment and prose",
  "hardest tasks",
  "how explorer",
  "how explainer",
  "how critics",
  "why investigators",
  "why synthesizer",
  "reflect tooling",
  "reflect judgment, divergent, synthesizer",
  "arena runners",
  "arena cross-judge pool",
  "swarm workers",
  "architect runners",
  "interrogate reviewers",
] as const;

export type RoleName = (typeof ROLE_NAMES)[number];
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export interface RoleTarget {
  model: string;
  thinking?: ThinkingLevel;
}
export type RoleValue = RoleTarget | RoleTarget[];

export const FANOUT_PANEL_ROLE_NAMES = new Set<RoleName>([
  "how critics",
  "arena runners",
  "architect runners",
  "interrogate reviewers",
]);

export const PANEL_ROLE_NAMES = new Set<RoleName>([
  "how critics",
  "arena runners",
  "arena cross-judge pool",
  "architect runners",
  "interrogate reviewers",
]);

const THINKING_LEVELS = new Set<ThinkingLevel>(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

export interface PstackConfig {
  version: 2;
  roles: Record<string, RoleValue>;
}

export function configPath(): string {
  return path.join(getAgentDir(), "pstack", "models.json");
}

function target(model: string, thinking: ThinkingLevel): RoleTarget {
  return { model, thinking };
}

function creatorPanel(): RoleTarget[] {
  return [
    target("openrouter/anthropic/claude-fable-5.1", "max"),
    target("openai-codex/gpt-5.6-sol", "max"),
    target("opencode-go/grok-4.6", "xhigh"),
    target("openrouter/anthropic/claude-opus-5", "xhigh"),
  ];
}

export function defaultConfig(): PstackConfig {
  const grok = () => target("opencode-go/grok-4.6", "xhigh");
  const fable = () => target("openrouter/anthropic/claude-fable-5.1", "max");
  return {
    version: 2,
    roles: {
      "feature, refactoring": grok(),
      "bug-fix": fable(),
      "perf-issue": fable(),
      "hillclimb": fable(),
      "judgment and prose": fable(),
      "hardest tasks": fable(),
      "how explorer": grok(),
      "how explainer": fable(),
      "how critics": creatorPanel(),
      "why investigators": grok(),
      "why synthesizer": fable(),
      "reflect tooling": target("openai-codex/gpt-5.6-sol", "max"),
      "reflect judgment, divergent, synthesizer": fable(),
      "arena runners": creatorPanel(),
      "arena cross-judge pool": creatorPanel(),
      "swarm workers": grok(),
      "architect runners": creatorPanel(),
      "interrogate reviewers": creatorPanel(),
    },
  };
}

function parseTarget(value: unknown): RoleTarget | undefined {
  if (typeof value === "string" && value.trim()) return { model: value.trim() };
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as { model?: unknown; thinking?: unknown };
  if (typeof candidate.model !== "string" || !candidate.model.trim()) return undefined;
  if (candidate.thinking !== undefined && (typeof candidate.thinking !== "string" || !THINKING_LEVELS.has(candidate.thinking as ThinkingLevel))) {
    return undefined;
  }
  return {
    model: candidate.model.trim(),
    thinking: candidate.thinking as ThinkingLevel | undefined,
  };
}

function parseValue(value: unknown): RoleValue | undefined {
  if (Array.isArray(value)) {
    const targets = value.map(parseTarget);
    return targets.length > 0 && targets.every((target): target is RoleTarget => target !== undefined) ? targets : undefined;
  }
  return parseTarget(value);
}

export function parseConfig(value: unknown): PstackConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Pstack model configuration must be an object.");
  const parsed = value as { version?: unknown; roles?: unknown };
  if (parsed.version !== 2) throw new Error("Pstack model configuration requires version 2.");
  if (!parsed.roles || typeof parsed.roles !== "object" || Array.isArray(parsed.roles)) {
    throw new Error("Pstack model configuration requires a roles object.");
  }
  const roles: Record<string, RoleValue> = { ...defaultConfig().roles };
  for (const [role, roleValue] of Object.entries(parsed.roles)) {
    if (!(ROLE_NAMES as readonly string[]).includes(role)) throw new Error(`Unknown pstack role ${JSON.stringify(role)}.`);
    const accepted = parseValue(roleValue);
    if (!accepted) throw new Error(`Invalid pstack model target for role ${JSON.stringify(role)}.`);
    const panel = PANEL_ROLE_NAMES.has(role as RoleName);
    if (panel !== Array.isArray(accepted)) {
      throw new Error(panel ? `${role} requires a non-empty model panel.` : `${role} requires one model target.`);
    }
    roles[role] = accepted;
  }
  return { version: 2, roles };
}

export async function readConfig(): Promise<PstackConfig> {
  const target = configPath();
  let source: string;
  try {
    source = await fs.readFile(target, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return defaultConfig();
    throw new Error(`Could not read pstack model configuration ${target}: ${(error as Error).message}`);
  }
  try {
    return parseConfig(JSON.parse(source));
  } catch (error) {
    throw new Error(`Invalid pstack model configuration ${target}: ${(error as Error).message}`);
  }
}

export async function writeConfig(config: PstackConfig): Promise<void> {
  const target = configPath();
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}

export function targetsForRole(config: PstackConfig, role: string | undefined): RoleTarget[] {
  if (!role) return [];
  const value = config.roles[role];
  return Array.isArray(value) ? value : value ? [value] : [];
}
