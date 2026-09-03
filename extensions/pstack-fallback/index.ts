import { spawn, execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { StringEnum, type Message } from "@earendil-works/pi-ai";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { FANOUT_PANEL_ROLE_NAMES, targetsForRole, readConfig as readPstackConfig } from "../pstack/config.js";
import { taskBudgetFromEnvironment } from "../pstack-workers/budget.js";
import { loadConfig } from "../pstack-workers/config.js";
import { composeChildSystemPrompt } from "../pstack-workers/child-prompt.js";
import { buildPiArgs } from "../pstack-workers/herdr.js";
import { assertPotetoBootstrapped, findPotetoSkill, POTETO_IDENTITY, potetoBootstrapPrompt } from "../pstack-workers/poteto-bootstrap.js";
import { discoverInheritedResources, resolveRuntimeSettings } from "../pstack-workers/resources.js";
import type { RuntimeSettings } from "../pstack-workers/types.js";

const execFileAsync = promisify(execFile);
const STATE_ENTRY = "pstack-fallback-workers";
const MAX_OUTPUT_BYTES = 128 * 1024;

type WorkerRecord = {
  name: string;
  identity: string;
  sessionFile: string;
  cwd: string;
  status: "working" | "completed" | "failed";
  lastResult?: string;
  lastError?: string;
  updatedAt: number;
  runtime?: RuntimeSettings;
  worktree?: { path: string; branch: string };
};

function packageRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../..");
}

function identityName(requested: string | undefined): string {
  return requested ?? "general-purpose";
}

function panelLabel(index: number): string {
  let value = index;
  let label = "";
  do {
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);
  return label;
}

function safeName(value: string, sequence: number): string {
  const base = value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 20) || "task";
  return `${base}-${sequence}`.slice(0, 29);
}

function cloneRuntime(runtime: RuntimeSettings): RuntimeSettings {
  return {
    ...runtime,
    tools: runtime.tools ? [...runtime.tools] : undefined,
    extensions: runtime.extensions ? [...runtime.extensions] : undefined,
    skills: runtime.skills ? [...runtime.skills] : undefined,
  };
}

function sameRuntime(left: RuntimeSettings | undefined, right: RuntimeSettings): boolean {
  if (!left) return false;
  return left.provider === right.provider
    && left.model === right.model
    && left.thinking === right.thinking
    && JSON.stringify(left.tools ?? []) === JSON.stringify(right.tools ?? [])
    && JSON.stringify(left.extensions ?? []) === JSON.stringify(right.extensions ?? [])
    && JSON.stringify(left.skills ?? []) === JSON.stringify(right.skills ?? []);
}

async function createWorktree(cwd: string, name: string, base: string): Promise<{ path: string; branch: string }> {
  const { stdout } = await execFileAsync("git", ["-C", cwd, "rev-parse", "--show-toplevel"]);
  const root = stdout.trim();
  if (!root) throw new Error(`Cannot isolate Task ${name} because ${cwd} is not inside a Git checkout.`);
  const branch = `pstack/${name}-${Date.now().toString(36)}`;
  const worktreePath = join(dirname(root), ".pi-pstack-worktrees", `${root.split("/").at(-1)}-${name}-${Date.now().toString(36)}`);
  await mkdir(dirname(worktreePath), { recursive: true });
  await execFileAsync("git", ["-C", root, "worktree", "add", "-b", branch, worktreePath, base]);
  return { path: worktreePath, branch };
}

async function runPi(options: {
  record: WorkerRecord;
  task: string;
  settings: RuntimeSettings;
  instructions?: string;
  signal?: AbortSignal;
}): Promise<string> {
  const promptPath = join(dirname(options.record.sessionFile), `${options.record.name}-prompt.md`);
  if (options.instructions) await writeFile(promptPath, options.instructions, { mode: 0o600 });
  const args = [
    "--mode",
    "json",
    "--print",
    ...buildPiArgs({
      settings: options.settings,
      instructions: options.instructions ? promptPath : undefined,
      sessionFile: options.record.sessionFile,
      sessionName: options.record.name,
    }),
    options.task,
  ];

  return new Promise<string>((resolvePromise, reject) => {
    const child = spawn("pi", args, { cwd: options.record.cwd, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let final = "";
    const abort = () => child.kill("SIGTERM");
    options.signal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      if (Buffer.byteLength(stdout) > MAX_OUTPUT_BYTES) stdout = stdout.slice(-MAX_OUTPUT_BYTES);
      const lines = stdout.split("\n");
      stdout = lines.pop() ?? "";
      for (const line of lines) {
        try {
          const event = JSON.parse(line) as { type?: string; message?: Message };
          if (event.type !== "message_end" || event.message?.role !== "assistant") continue;
          final = event.message.content.flatMap((part) => part.type === "text" ? [part.text] : []).join("\n");
        } catch {
          // Ignore diagnostics that are not JSON events.
        }
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (Buffer.byteLength(stderr) > MAX_OUTPUT_BYTES) stderr = stderr.slice(-MAX_OUTPUT_BYTES);
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      options.signal?.removeEventListener("abort", abort);
      if (code === 0 && final) resolvePromise(final);
      else reject(new Error(stderr.trim() || `Pi worker exited with code ${code ?? "unknown"}${signal ? ` (${signal})` : ""}.`));
    });
  });
}

export default function pstackFallback(pi: ExtensionAPI): void {
  if (process.env.HERDR_ENV === "1" && process.env.HERDR_WORKSPACE_ID) return;

  const records = new Map<string, WorkerRecord>();
  let sequence = 0;
  const roleSequences = new Map<string, number>();
  const persist = () => pi.appendEntry(STATE_ENTRY, { records: [...records.values()] });

  pi.on("session_start", (_event, ctx) => {
    records.clear();
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== "custom" || entry.customType !== STATE_ENTRY) continue;
      const saved = (entry.data as { records?: WorkerRecord[] }).records;
      if (!Array.isArray(saved)) continue;
      for (const record of saved) records.set(record.name, record.status === "working" ? { ...record, status: "failed", lastError: "The parent restarted before it observed worker settlement." } : record);
    }
    sequence = records.size;
  });

  pi.registerTool({
    name: "Task",
    label: "Task",
    description: "Pstack Task fallback for environments without Herdr. It uses persistent Pi session files, local Git worktrees for requested isolation, and parent completion wakes for background work.",
    parameters: Type.Object({
      description: Type.Optional(Type.String()),
      prompt: Type.String(),
      identity: Type.Optional(Type.String()),
      model: Type.Optional(Type.String()),
      role: Type.Optional(Type.String()),
      thinking: Type.Optional(StringEnum(["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const)),
      readonly: Type.Optional(Type.Boolean()),
      run_in_background: Type.Optional(Type.Boolean()),
      isolation: Type.Optional(StringEnum(["worktree", "current"] as const)),
      base_branch: Type.Optional(Type.String()),
      cwd: Type.Optional(Type.String()),
    }),
    async execute(_id, params, signal, _update, ctx) {
      const task = params.prompt.trim();
      if (!task) throw new Error("Task requires a non-empty prompt.");
      const identity = identityName(params.identity);
      const workerConfig = await loadConfig();
      const identityConfig = workerConfig.identities.find((candidate) => candidate.name === identity);
      if (!identityConfig) throw new Error(`Unknown Task identity ${JSON.stringify(params.identity)}.`);
      const roleTargets = params.role ? targetsForRole(await readPstackConfig(), params.role) : [];
      const roleSequence = params.role ? roleSequences.get(params.role) ?? 0 : 0;
      const configuredTarget = roleTargets.length > 0 ? roleTargets[roleSequence % roleTargets.length] : undefined;
      const selectedModel = params.model ?? configuredTarget?.model;
      const requestedModel = selectedModel && !["auto", "inherit-parent"].includes(selectedModel) ? selectedModel : undefined;
      const available = new Set(ctx.modelRegistry.getAvailable().map((model) => `${model.provider}/${model.id}`));
      if (requestedModel && !available.has(requestedModel)) throw new Error(`Unavailable Task model ${JSON.stringify(requestedModel)}.`);
      const model = requestedModel;
      const budget = taskBudgetFromEnvironment();
      if (budget !== undefined && sequence >= budget) throw new Error(`Pstack Task budget ${budget} exhausted for this parent session.`);
      const nextSequence = sequence + 1;
      const name = safeName(params.description ?? identity, nextSequence);
      const parentCwd = params.cwd ?? ctx.cwd;
      const worktree = params.isolation === "worktree" ? await createWorktree(parentCwd, name, params.base_branch ?? "HEAD") : undefined;
      sequence = nextSequence;
      if (params.role) roleSequences.set(params.role, roleSequence + 1);
      const sessionDir = join(getAgentDir(), "pstack", "fallback-workers", ctx.sessionManager.getSessionId());
      await mkdir(sessionDir, { recursive: true });
      const targetCwd = worktree?.path ?? parentCwd;
      let runtime: RuntimeSettings;
      let instructions: string | undefined;
      try {
        const inherited = await discoverInheritedResources({
          cwd: targetCwd,
          agentDir: getAgentDir(),
          projectTrusted: ctx.isProjectTrusted(),
          packageRoot: packageRoot(),
        });
        runtime = resolveRuntimeSettings({
          identity: identityConfig,
          defaults: workerConfig.defaults,
          parent: {
            provider: ctx.model?.provider,
            model: ctx.model?.id,
            thinking: ctx.thinkingLevel,
          },
          inherited,
          activeTools: pi.getActiveTools(),
        });
        if (model) {
          const [provider, modelId] = model.split(/\/(.+)/);
          runtime.provider = provider;
          runtime.model = modelId;
        }
        runtime.thinking = params.thinking ?? configuredTarget?.thinking ?? runtime.thinking;
        if (params.readonly) runtime.tools = ["read", "grep", "find", "ls", "pstack_todo"];
        instructions = composeChildSystemPrompt({
          globalInstructions: workerConfig.instructions,
          identityInstructions: identityConfig.instructions,
        });
      } catch (error) {
        if (worktree) {
          const failed: WorkerRecord = {
            name,
            identity,
            sessionFile: join(sessionDir, `${name}.jsonl`),
            cwd: targetCwd,
            status: "failed",
            lastError: error instanceof Error ? error.message : String(error),
            updatedAt: Date.now(),
            worktree,
          };
          records.set(name, failed);
          persist();
        }
        throw error;
      }
      const reusable = identityConfig.name === POTETO_IDENTITY && !worktree
        ? [...records.values()].find((candidate) => candidate.identity === POTETO_IDENTITY
          && candidate.cwd === targetCwd
          && candidate.status === "completed"
          && sameRuntime(candidate.runtime, runtime))
        : undefined;
      const fresh = !reusable;
      const record: WorkerRecord = reusable ?? {
        name,
        identity,
        sessionFile: join(sessionDir, `${name}.jsonl`),
        cwd: targetCwd,
        status: "working",
        updatedAt: Date.now(),
        runtime: cloneRuntime(runtime),
        worktree,
      };
      record.status = "working";
      record.lastResult = undefined;
      record.lastError = undefined;
      record.updatedAt = Date.now();
      records.set(record.name, record);
      persist();
      const run = async () => {
        try {
          if (fresh && identityConfig.name === POTETO_IDENTITY) {
            const skillPath = findPotetoSkill(runtime.skills);
            await runPi({ record, task: potetoBootstrapPrompt(skillPath), settings: runtime, instructions, signal });
            assertPotetoBootstrapped(record.sessionFile, skillPath);
          }
          record.lastResult = await runPi({ record, task, settings: runtime, instructions, signal });
          record.status = "completed";
        } catch (error) {
          record.lastError = error instanceof Error ? error.message : String(error);
          record.status = "failed";
        }
        record.updatedAt = Date.now();
        persist();
        return record;
      };
      if (params.run_in_background) {
        void run().then((settled) => {
          const result = settled.lastResult ?? settled.lastError ?? "No result.";
          pi.sendMessage({
            customType: "pstack-task-complete",
            content: `Task ${settled.name} ${settled.status}.\n\n${result}`,
            display: true,
          }, { deliverAs: "followUp", triggerTurn: true });
        });
        return {
          content: [{ type: "text", text: `${fresh ? "Started" : "Resumed"} background Task ${record.name}. Completion will wake the parent.${worktree ? ` Worktree: ${worktree.path} (${worktree.branch}).` : ""}` }],
          details: record,
        };
      }
      const settled = await run();
      if (settled.status === "failed") throw new Error(settled.lastError ?? `Task ${name} failed.`);
      return { content: [{ type: "text", text: settled.lastResult ?? "" }], details: settled };
    },
  });

  pi.registerTool({
    name: "pstack_panel",
    label: "Pstack Panel",
    description: "Run every configured member of one pstack fan-out panel exactly once and wait for the complete panel. The runtime owns cardinality, model assignment, concurrent dispatch, and dropout accounting.",
    parameters: Type.Object({
      role: StringEnum([...FANOUT_PANEL_ROLE_NAMES] as [string, ...string[]]),
      prompt: Type.String(),
      identity: Type.Optional(Type.String()),
      readonly: Type.Optional(Type.Boolean()),
      isolation: Type.Optional(StringEnum(["worktree", "current"] as const)),
      base_branch: Type.Optional(Type.String()),
      cwd: Type.Optional(Type.String()),
    }),
    async execute(_id, params, signal, _update, ctx) {
      const config = await readPstackConfig();
      const targets = targetsForRole(config, params.role);
      if (!FANOUT_PANEL_ROLE_NAMES.has(params.role as never) || targets.length === 0) {
        throw new Error(`${params.role} is not a configured fan-out panel role.`);
      }
      const budget = taskBudgetFromEnvironment();
      if (budget !== undefined && sequence + targets.length > budget) {
        throw new Error(`Pstack panel requires ${targets.length} Tasks but only ${Math.max(0, budget - sequence)} remain in this parent session's budget.`);
      }
      const identity = identityName(params.identity);
      const workerConfig = await loadConfig();
      const identityConfig = workerConfig.identities.find((candidate) => candidate.name === identity);
      if (!identityConfig) throw new Error(`Unknown panel identity ${JSON.stringify(params.identity)}.`);
      const available = new Set(ctx.modelRegistry.getAvailable().map((model) => `${model.provider}/${model.id}`));
      for (const target of targets) {
        if (!["auto", "inherit-parent"].includes(target.model) && !available.has(target.model)) {
          throw new Error(`Unavailable panel model ${JSON.stringify(target.model)} for role ${JSON.stringify(params.role)}.`);
        }
      }
      const parentCwd = params.cwd ?? ctx.cwd;
      const sessionDir = join(getAgentDir(), "pstack", "fallback-workers", ctx.sessionManager.getSessionId());
      await mkdir(sessionDir, { recursive: true });
      const settled = await Promise.all(targets.map(async (target, index): Promise<WorkerRecord> => {
        sequence += 1;
        const label = panelLabel(index);
        const name = safeName(`${params.role}-${label}`, sequence);
        const task = params.prompt
          .replaceAll("{{PSTACK_PANEL_INDEX}}", String(index + 1))
          .replaceAll("{{PSTACK_PANEL_LABEL}}", label);
        const record: WorkerRecord = {
          name,
          identity,
          sessionFile: join(sessionDir, `${name}.jsonl`),
          cwd: parentCwd,
          status: "working",
          updatedAt: Date.now(),
        };
        try {
          const worktree = params.isolation === "worktree" ? await createWorktree(parentCwd, name, params.base_branch ?? "HEAD") : undefined;
          record.cwd = worktree?.path ?? parentCwd;
          record.worktree = worktree;
          const inherited = await discoverInheritedResources({
            cwd: record.cwd,
            agentDir: getAgentDir(),
            projectTrusted: ctx.isProjectTrusted(),
            packageRoot: packageRoot(),
          });
          const runtime = resolveRuntimeSettings({
            identity: identityConfig,
            defaults: workerConfig.defaults,
            parent: { provider: ctx.model?.provider, model: ctx.model?.id, thinking: ctx.thinkingLevel },
            inherited,
            activeTools: pi.getActiveTools(),
          });
          if (!["auto", "inherit-parent"].includes(target.model)) {
            const [provider, model] = target.model.split(/\/(.+)/);
            runtime.provider = provider;
            runtime.model = model;
          }
          runtime.thinking = target.thinking ?? runtime.thinking;
          if (params.readonly) runtime.tools = ["read", "grep", "find", "ls", "pstack_todo"];
          record.runtime = cloneRuntime(runtime);
          records.set(name, record);
          persist();
          const instructions = composeChildSystemPrompt({
            globalInstructions: workerConfig.instructions,
            identityInstructions: identityConfig.instructions,
          });
          if (identityConfig.name === POTETO_IDENTITY) {
            const skillPath = findPotetoSkill(runtime.skills);
            await runPi({ record, task: potetoBootstrapPrompt(skillPath), settings: runtime, instructions, signal });
            assertPotetoBootstrapped(record.sessionFile, skillPath);
          }
          record.lastResult = await runPi({ record, task, settings: runtime, instructions, signal });
          record.status = "completed";
        } catch (error) {
          record.lastError = error instanceof Error ? error.message : String(error);
          record.status = "failed";
        }
        record.updatedAt = Date.now();
        records.set(name, record);
        persist();
        return record;
      }));
      const text = settled.map((record, index) => {
        const result = record.lastResult?.trim() || record.lastError?.trim() || `Panel member settled with status ${record.status}.`;
        return `## Panel ${panelLabel(index)}\n\n${result}`;
      }).join("\n\n");
      return { content: [{ type: "text", text }], details: { records: settled } };
    },
  });
}
