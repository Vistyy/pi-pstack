import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import { Check } from "typebox/value";

export const BudgetSchema = Type.Union([
  Type.Literal("unlimited"),
  Type.Literal("large"),
  Type.Literal("medium"),
  Type.Literal("small"),
]);

const TargetSchema = Type.Union([
  Type.String({ minLength: 1 }),
  Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
]);

const ConfigSchema = Type.Object(
  {
    version: Type.Literal(1),
    budget: BudgetSchema,
    roles: Type.Record(Type.String(), TargetSchema),
  },
  { additionalProperties: false },
);

type Budget = Static<typeof BudgetSchema>;

type Target = Static<typeof TargetSchema>;

type Config = Static<typeof ConfigSchema>;

export type Role = { name: string; panel: boolean; defaults: Target };

const levels = ["minimal", "low", "medium", "high", "xhigh", "max"];

const caps = { large: "xhigh", medium: "high", small: "medium" };

export function parseRoles(skill: string): Role[] {
  const block = [...skill.matchAll(/```[^\n]*\n([\s\S]*?)\n```/g)]
    .map((match) => match[1])
    .find((text) => text?.includes("# budget: unlimited (max)") === true);

  if (block === undefined)
    throw new Error("setup-pstack role map lacks '# budget: unlimited (max)' fenced rule");

  const lines = block.split("\n");
  const start = lines.findIndex((line) => line.trim() === "# budget: unlimited (max)");

  const roles = lines
    .slice(start + 1)
    .filter((line) => line.trim() !== "" && !line.startsWith("#"))
    .map((line) => {
      const match = line.match(/^([^:]+):\s*(.+)$/);
      const name = match?.[1];
      const targets = match?.[2];

      if (name === undefined || targets === undefined)
        throw new Error(`Invalid source role line: ${line}`);

      const values = targets.split(",").map((value) => value.trim());
      const first = values[0];

      if (first === undefined || values.includes(""))
        throw new Error(`Invalid source role line: ${line}`);

      return {
        name: name.trim(),
        panel: values.length > 1,
        defaults: values.length > 1 ? values : first,
      };
    });

  if (roles.length !== 17 || new Set(roles.map((role) => role.name)).size !== 17)
    throw new Error("Expected 17 distinct source roles");

  return roles;
}

function requireRoleShapes(selected: Config["roles"], roles: Role[]) {
  const keys = Object.keys(selected);

  if (keys.length !== roles.length || roles.some((role) => !keys.includes(role.name))) {
    throw new Error(
      `Configuration requires exactly these roles: ${roles.map((role) => role.name).join(", ")}`,
    );
  }

  for (const role of roles) {
    if (Array.isArray(selected[role.name]) !== role.panel)
      throw new Error(`Wrong single/panel shape for ${role.name}`);
  }
}

async function readConfig(roles: Role[]) {
  let text: string;

  try {
    text = await readFile(join(getAgentDir(), "pstack-models.json"), "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }

  const data: unknown = JSON.parse(text);

  if (!Check(ConfigSchema, data))
    throw new Error(
      "Invalid pstack-models.json: expected version 1, budget and complete role table",
    );

  requireRoleShapes(data.roles, roles);

  return data;
}

async function writeConfig(config: Config) {
  const file = join(getAgentDir(), "pstack-models.json");
  await mkdir(dirname(file), { recursive: true });
  const temporary = await mkdtemp(join(dirname(file), ".pstack-models-"));
  const candidate = join(temporary, "config.json");

  try {
    await writeFile(candidate, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
    await rename(candidate, file);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

export function availableModels(ctx: ExtensionContext) {
  return ctx.modelRegistry.getAvailable().map((model) => ({
    provider: model.provider,
    id: model.id,
    thinking: getSupportedThinkingLevels(model),
  }));
}

function parentSelector(ctx: ExtensionContext) {
  return ctx.model === undefined
    ? undefined
    : `${ctx.model.provider}/${ctx.model.id}:${ctx.thinkingLevel}`;
}

export function resolveTarget(target: string, ctx: ExtensionContext, budget: Budget = "unlimited") {
  if (target === "inherit-parent" || target === "auto") {
    const parent = parentSelector(ctx);

    if (parent === undefined) throw new Error(`${target}: current parent model is unavailable`);

    return parent;
  }

  const match = target.match(/^([^/]+)\/(.+):([^:]+)$/);
  const provider = match?.[1];
  const id = match?.[2];
  const requestedThinking = match?.[3];

  if (provider === undefined || id === undefined || requestedThinking === undefined)
    throw new Error(`Expected exact provider/model:thinking selector: ${target}`);

  const model = ctx.modelRegistry
    .getAvailable()
    .find((item) => item.provider === provider && item.id === id);

  if (model === undefined) throw new Error(`Unavailable model ${provider}/${id}`);

  if (requestedThinking !== "off" && !levels.includes(requestedThinking))
    throw new Error(`Unknown thinking level ${requestedThinking}`);

  const supported = getSupportedThinkingLevels(model);
  let thinking = requestedThinking;

  if (budget !== "unlimited") {
    const cap = levels.indexOf(caps[budget]);

    const chosen = levels
      .slice(0, cap + 1)
      .reverse()
      .find((level) => supported.some((item) => item === level));

    if (chosen === undefined)
      throw new Error(
        `No supported reasoning level at or below ${caps[budget]} for ${provider}/${id}; choose another target`,
      );
    thinking = chosen;
  }

  if (!supported.some((level) => level === thinking))
    throw new Error(
      `Unsupported thinking level ${thinking} for ${provider}/${id}; supported: ${supported.join(", ")}`,
    );

  return `${provider}/${id}:${thinking}`;
}

function effectiveTarget(target: string, ctx: ExtensionContext) {
  try {
    return { requested: target, selector: resolveTarget(target, ctx) };
  } catch (error) {
    return { requested: target, error: String(error) };
  }
}

function effectiveRoles(config: Config, ctx: ExtensionContext) {
  return Object.fromEntries(
    Object.entries(config.roles).map(
      ([name, value]) =>
        [
          name,
          Array.isArray(value)
            ? value.map((target) => effectiveTarget(target, ctx))
            : effectiveTarget(value, ctx),
        ] as const,
    ),
  );
}

export async function modelState(roles: Role[], ctx: ExtensionContext) {
  const config = await readConfig(roles);

  return {
    config,
    parentSelector: parentSelector(ctx),
    sourceDefaults: Object.fromEntries(roles.map((role) => [role.name, role.defaults] as const)),
    roles: config === null ? null : effectiveRoles(config, ctx),
    error:
      config === null
        ? "Missing configuration; source defaults are not Pi routes. Run /setup-pstack."
        : undefined,
  };
}

export async function saveModels(
  selected: Config["roles"],
  budget: Budget,
  roles: Role[],
  ctx: ExtensionContext,
) {
  requireRoleShapes(selected, roles);
  const applied: Config["roles"] = {};

  for (const [name, value] of Object.entries(selected)) {
    const normalize = (target: string) => {
      const resolved = resolveTarget(target, ctx, budget);

      return target === "inherit-parent" || target === "auto" ? target : resolved;
    };

    applied[name] = Array.isArray(value) ? value.map(normalize) : normalize(value);
  }

  const config: Config = { version: 1, budget, roles: applied };
  await writeConfig(config);

  return { config, roles: effectiveRoles(config, ctx) };
}

export const ModelsInput = Type.Object({
  action: Type.Union([Type.Literal("list"), Type.Literal("get"), Type.Literal("set")]),
  budget: Type.Optional(BudgetSchema),
  roles: Type.Optional(Type.Record(Type.String(), TargetSchema)),
});
