import { spawn, execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { StringEnum, type Message } from "@earendil-works/pi-ai";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { modelsForRole, readConfig as readPstackConfig } from "../pstack/config.js";

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
  worktree?: { path: string; branch: string };
};

function packageRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../..");
}

function identityName(requested: string | undefined): string {
  return requested ?? "general-purpose";
}

function safeName(value: string, sequence: number): string {
  const base = value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 20) || "task";
  return `${base}-${sequence}`.slice(0, 29);
}

async function createWorktree(cwd: string, name: string): Promise<{ path: string; branch: string }> {
  const { stdout } = await execFileAsync("git", ["-C", cwd, "rev-parse", "--show-toplevel"]);
  const root = stdout.trim();
  if (!root) throw new Error(`Cannot isolate Task ${name} because ${cwd} is not inside a Git checkout.`);
  const branch = `pstack/${name}-${Date.now().toString(36)}`;
  const worktreePath = join(dirname(root), ".pi-pstack-worktrees", `${root.split("/").at(-1)}-${name}-${Date.now().toString(36)}`);
  await mkdir(dirname(worktreePath), { recursive: true });
  await execFileAsync("git", ["-C", root, "worktree", "add", "-b", branch, worktreePath, "HEAD"]);
  return { path: worktreePath, branch };
}

async function runPi(options: {
  record: WorkerRecord;
  task: string;
  model?: string;
  readonly: boolean;
  signal?: AbortSignal;
}): Promise<string> {
  const promptPath = join(dirname(options.record.sessionFile), `${options.record.name}-prompt.md`);
  const identityPath = join(packageRoot(), "extensions", "pstack-workers", "identities", `${options.record.identity}.md`);
  const identity = await readFile(identityPath, "utf8");
  await writeFile(promptPath, identity, { mode: 0o600 });
  const args = [
    "--mode", "json", "--print", "--no-extensions", "--no-skills", "--no-prompt-templates",
    "--session", options.record.sessionFile,
    "--append-system-prompt", promptPath,
  ];
  if (options.readonly) args.push("--tools", "read,grep,find,ls");
  if (options.model) args.push("--model", options.model);
  args.push(options.task);

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
      readonly: Type.Optional(Type.Boolean()),
      run_in_background: Type.Optional(Type.Boolean()),
      isolation: Type.Optional(StringEnum(["worktree", "current"] as const)),
      cwd: Type.Optional(Type.String()),
    }),
    async execute(_id, params, signal, _update, ctx) {
      const task = params.prompt.trim();
      if (!task) throw new Error("Task requires a non-empty prompt.");
      const identity = identityName(params.identity);
      if (!new Set(["general-purpose", "poteto-agent", "comment-sicko"]).has(identity)) throw new Error(`Unknown Task identity ${JSON.stringify(params.identity)}.`);
      const configuredBudget = Number.parseInt(process.env.PSTACK_CHILD_BUDGET ?? "8", 10);
      const budget = Number.isInteger(configuredBudget) ? Math.max(0, Math.min(configuredBudget, 64)) : 8;
      if (sequence >= budget) throw new Error(`Pstack Task budget ${budget} exhausted for this parent session.`);
      sequence += 1;
      const name = safeName(params.description ?? identity, sequence);
      const parentCwd = params.cwd ?? ctx.cwd;
      const worktree = params.isolation === "worktree" ? await createWorktree(parentCwd, name) : undefined;
      const sessionDir = join(getAgentDir(), "pstack", "fallback-workers");
      await mkdir(sessionDir, { recursive: true });
      const record: WorkerRecord = {
        name,
        identity,
        sessionFile: join(sessionDir, `${name}.jsonl`),
        cwd: worktree?.path ?? parentCwd,
        status: "working",
        updatedAt: Date.now(),
        worktree,
      };
      records.set(name, record);
      persist();
      const roleModels = params.role ? modelsForRole(await readPstackConfig(), params.role) : [];
      const configuredModel = roleModels.length > 0 ? roleModels[(sequence - 1) % roleModels.length] : undefined;
      const selectedModel = params.model ?? configuredModel;
      const requestedModel = selectedModel && !["auto", "inherit-parent"].includes(selectedModel) ? selectedModel : undefined;
      const available = new Set(ctx.modelRegistry.getAvailable().map((model) => `${model.provider}/${model.id}`));
      const model = requestedModel && available.has(requestedModel) ? requestedModel : undefined;
      const run = async () => {
        try {
          record.lastResult = await runPi({ record, task, model, readonly: params.readonly ?? false, signal });
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
          content: [{ type: "text", text: `Started background Task ${name}. Completion will wake the parent.${worktree ? ` Worktree: ${worktree.path} (${worktree.branch}).` : ""}` }],
          details: record,
        };
      }
      const settled = await run();
      if (settled.status === "failed") throw new Error(settled.lastError ?? `Task ${name} failed.`);
      return { content: [{ type: "text", text: settled.lastResult ?? "" }], details: settled };
    },
  });
}
