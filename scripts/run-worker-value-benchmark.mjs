#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "");
const runRoot = path.join(root, ".work", `lantern-field-${stamp}`);
const seedRoot = path.join(runRoot, "seeds");
const workRoot = path.join(runRoot, "workspaces");
const answerRoot = path.join(runRoot, "answers");
const reviewRoot = path.join(runRoot, "review");

const models = [
  "opencode-go/muse-spark-1.3-contributor",
  "opencode-go/glm-5.3-flash",
  "opencode-go/deepseek-v4-flash",
  "opencode-go/qwen3.8-flash",
];
const labels = ["amber", "birch", "cedar", "dawn", "ember", "fern", "grove", "harbor", "iris", "juniper", "linden", "meadow"];
const repetitions = 3;

const tasks = [
  {
    id: "relay",
    tools: "read,bash",
    prompt: "I am taking ownership of this relay service. Explain how a newly saved retry policy reaches an outbound delivery, including startup, reload, queueing, retries, and metrics. Identify the ownership boundaries and the non-obvious path that can keep using an old retry limit after a successful policy reload. Use these headings: Overview, Runtime flow, Ownership, Stale-policy risk. Cite exact file paths and symbol names. Do not modify files.",
    files: {
      "package.json": `{"name":"relay-service","type":"module","scripts":{"check":"node --test spec/*.spec.js"}}\n`,
      "config/policies.json": `{"revision":1,"routes":{"billing":{"maxAttempts":3},"email":{"maxAttempts":2}}}\n`,
      "src/types.js": `export function policyKey(route) { return String(route).toLowerCase(); }\n`,
      "src/policy-loader.js": `import { readFile } from "node:fs/promises";\nexport async function loadPolicies(file) {\n  const value = JSON.parse(await readFile(file, "utf8"));\n  if (!Number.isSafeInteger(value.revision) || !value.routes) throw new Error("invalid policies");\n  return { revision: value.revision, routes: structuredClone(value.routes) };\n}\n`,
      "src/policy-store.js": `import { watch } from "node:fs";\nimport { loadPolicies } from "./policy-loader.js";\nimport { policyKey } from "./types.js";\nexport class PolicyStore {\n  #current = { revision: 0, routes: {} };\n  #listeners = new Set();\n  #watcher;\n  constructor(file) { this.file = file; }\n  async reload() {\n    const next = await loadPolicies(this.file);\n    if (next.revision <= this.#current.revision) return false;\n    this.#current = next;\n    for (const listener of this.#listeners) listener(next);\n    return true;\n  }\n  retryReader(route) {\n    const snapshot = this.#current;\n    const key = policyKey(route);\n    return () => snapshot.routes[key]?.maxAttempts ?? 1;\n  }\n  subscribe(listener) { this.#listeners.add(listener); return () => this.#listeners.delete(listener); }\n  watch() { this.#watcher = watch(this.file, () => void this.reload()); }\n  close() { this.#watcher?.close(); }\n}\n`,
      "src/queue.js": `export class DeliveryQueue {\n  #items = [];\n  enqueue(item) { this.#items.push(item); }\n  take() { return this.#items.shift(); }\n}\n`,
      "src/transport.js": `export class Transport {\n  constructor(sender) { this.sender = sender; }\n  send(delivery) { return this.sender(delivery); }\n}\n`,
      "src/metrics.js": `export class Metrics {\n  attempts = new Map();\n  record(route) { this.attempts.set(route, (this.attempts.get(route) ?? 0) + 1); }\n}\n`,
      "src/delivery.js": `export function deliveryFactory(store, queue) {\n  const readers = new Map();\n  return function schedule(route, payload) {\n    if (!readers.has(route)) readers.set(route, store.retryReader(route));\n    queue.enqueue({ route, payload, maxAttempts: readers.get(route)() });\n  };\n}\n`,
      "src/worker.js": `export class DeliveryWorker {\n  constructor(queue, transport, metrics) { Object.assign(this, { queue, transport, metrics }); }\n  async runOne() {\n    const item = this.queue.take();\n    if (!item) return false;\n    for (let attempt = 1; attempt <= item.maxAttempts; attempt += 1) {\n      this.metrics.record(item.route);\n      try { await this.transport.send(item); return true; } catch (error) { if (attempt === item.maxAttempts) throw error; }\n    }\n  }\n}\n`,
      "src/app.js": `import { PolicyStore } from "./policy-store.js";\nimport { DeliveryQueue } from "./queue.js";\nimport { Transport } from "./transport.js";\nimport { Metrics } from "./metrics.js";\nimport { deliveryFactory } from "./delivery.js";\nimport { DeliveryWorker } from "./worker.js";\nexport async function startApp(policyFile, sender) {\n  const store = new PolicyStore(policyFile);\n  const queue = new DeliveryQueue();\n  const metrics = new Metrics();\n  await store.reload();\n  store.watch();\n  return { store, metrics, schedule: deliveryFactory(store, queue), worker: new DeliveryWorker(queue, new Transport(sender), metrics) };\n}\n`,
      "spec/startup.spec.js": `import test from "node:test"; import assert from "node:assert/strict"; import { policyKey } from "../src/types.js";\ntest("normalizes policy keys", () => assert.equal(policyKey("Billing"), "billing"));\n`,
    },
    judge: "Score runtime-flow completeness, ownership accuracy, exact citations, identification of deliveryFactory caching retryReader closures over PolicyStore snapshots, and clarity. A correct answer must explain that successful reload replaces PolicyStore state but an existing per-route reader still closes over the old policy object, so later queued deliveries can retain the old maxAttempts.",
  },
  {
    id: "checkout",
    tools: "read,bash",
    prompt: "Checkout totals are correct, but production logs show repeated discount-repository reads for customers whose valid discount is zero. The repository contains a focused reproduction and the relevant service. Diagnose the root cause, rule out the plausible cache-key, expiry, parser, and rounding explanations using source evidence, and propose the smallest justified repair. Use these headings: Symptom, Execution path, Root cause, Minimal repair, Verification. Cite exact files and symbols. Do not modify files.",
    files: {
      "package.json": `{"name":"checkout-service","type":"module","scripts":{"check":"node --test spec/*.spec.js"}}\n`,
      "src/customer.js": `export function customerKey(customer) { return customer.id.trim().toLowerCase(); }\n`,
      "src/discount-parser.js": `export function parseDiscount(row) {\n  const value = Number(row.percent);\n  if (!Number.isFinite(value) || value < 0 || value > 100) throw new Error("invalid discount");\n  return value;\n}\n`,
      "src/discount-cache.js": `export class DiscountCache {\n  #entries = new Map();\n  constructor(clock, ttlMs = 60_000) { Object.assign(this, { clock, ttlMs }); }\n  get(key) {\n    const entry = this.#entries.get(key);\n    if (!entry || entry.expiresAt <= this.clock()) { this.#entries.delete(key); return undefined; }\n    return entry.value;\n  }\n  set(key, value) { this.#entries.set(key, { value, expiresAt: this.clock() + this.ttlMs }); }\n}\n`,
      "src/discount-repository.js": `import { parseDiscount } from "./discount-parser.js";\nexport class DiscountRepository {\n  constructor(database) { this.database = database; }\n  async findPercent(customerId) { return parseDiscount(await this.database.discountFor(customerId)); }\n}\n`,
      "src/discount-service.js": `import { customerKey } from "./customer.js";\nexport class DiscountService {\n  constructor(cache, repository) { Object.assign(this, { cache, repository }); }\n  async percentFor(customer) {\n    const key = customerKey(customer);\n    const cached = this.cache.get(key);\n    if (cached) return cached;\n    const loaded = await this.repository.findPercent(key);\n    this.cache.set(key, loaded);\n    return loaded;\n  }\n}\n`,
      "src/money.js": `export function discountedTotal(cents, percent) { return Math.round(cents * (100 - percent) / 100); }\n`,
      "src/checkout.js": `import { discountedTotal } from "./money.js";\nexport class Checkout {\n  constructor(discounts) { this.discounts = discounts; }\n  async total(customer, cents) { return discountedTotal(cents, await this.discounts.percentFor(customer)); }\n}\n`,
      "fixtures/production.log": `discount_read customer=free-tier percent=0\ndiscount_read customer=free-tier percent=0\ndiscount_read customer=free-tier percent=0\ncheckout_total customer=free-tier cents=2500 total=2500\n`,
      "spec/discount-service.spec.js": `import test from "node:test"; import assert from "node:assert/strict";\nimport { DiscountCache } from "../src/discount-cache.js"; import { DiscountService } from "../src/discount-service.js";\ntest("reuses a valid zero discount", async () => {\n  let reads = 0; const repository = { async findPercent() { reads += 1; return 0; } };\n  const service = new DiscountService(new DiscountCache(() => 100), repository);\n  assert.equal(await service.percentFor({ id: " Free-Tier " }), 0);\n  assert.equal(await service.percentFor({ id: "free-tier" }), 0);\n  assert.equal(reads, 1);\n});\n`,
      "spec/money.spec.js": `import test from "node:test"; import assert from "node:assert/strict"; import { discountedTotal } from "../src/money.js";\ntest("rounds discounted cents", () => assert.equal(discountedTotal(999, 15), 849));\n`,
    },
    judge: "Score evidence-backed diagnosis, elimination of alternatives, minimal repair, verification plan, citations, and concision. The root cause is DiscountService.percentFor using truthiness for the cache hit, so the valid cached number zero is treated as absent. The minimal repair is an explicit undefined check. Key normalization, TTL, parsing, and money rounding are not the cause.",
  },
  {
    id: "archive",
    tools: "read,bash,edit,write",
    prompt: "Add dry-run support to the archive cleanup command. `cleanup <prefix> --dry-run` must report the keys that would be removed without changing the store. Ordinary cleanup must keep its current behavior. Reject unknown options. Keep argument parsing, cleanup policy, persistence, and presentation in their existing modules. Run the repository's check command and leave the working tree with the complete implementation.",
    files: {
      "package.json": `{"name":"archive-cleaner","type":"module","scripts":{"check":"node --test spec/*.spec.js"}}\n`,
      "src/args.js": `export function parseArgs(argv) {\n  const [command, prefix, ...rest] = argv;\n  if (command !== "cleanup" || !prefix || rest.length) throw new Error("usage: cleanup <prefix>");\n  return { command, prefix };\n}\n`,
      "src/store.js": `import { readFile, writeFile } from "node:fs/promises";\nexport class ArchiveStore {\n  constructor(file) { this.file = file; }\n  async entries() { return JSON.parse(await readFile(this.file, "utf8")); }\n  async replace(entries) { await writeFile(this.file, JSON.stringify(entries, null, 2) + "\\n"); }\n}\n`,
      "src/cleanup.js": `export async function cleanup(store, prefix) {\n  const entries = await store.entries();\n  const removed = Object.keys(entries).filter((key) => key.startsWith(prefix));\n  const kept = Object.fromEntries(Object.entries(entries).filter(([key]) => !key.startsWith(prefix)));\n  await store.replace(kept);\n  return removed;\n}\n`,
      "src/render.js": `export function renderRemoved(keys) { return \`Removed \${keys.length}: \${keys.join(", ")}\`; }\n`,
      "src/cli.js": `import { parseArgs } from "./args.js"; import { ArchiveStore } from "./store.js"; import { cleanup } from "./cleanup.js"; import { renderRemoved } from "./render.js";\nexport async function run(argv, file) { const args = parseArgs(argv); return renderRemoved(await cleanup(new ArchiveStore(file), args.prefix)); }\n`,
      "data.json": `{"old/a":{"size":10},"old/b":{"size":20},"keep/c":{"size":30}}\n`,
      "spec/args.spec.js": `import test from "node:test"; import assert from "node:assert/strict"; import { parseArgs } from "../src/args.js";\ntest("parses dry-run", () => assert.deepEqual(parseArgs(["cleanup", "old/", "--dry-run"]), { command: "cleanup", prefix: "old/", dryRun: true }));\ntest("rejects unknown options", () => assert.throws(() => parseArgs(["cleanup", "old/", "--force"]), /usage/));\n`,
      "spec/cleanup.spec.js": `import test from "node:test"; import assert from "node:assert/strict"; import { cleanup } from "../src/cleanup.js";\ntest("dry-run reports keys without writing", async () => { let writes = 0; const store = { async entries() { return { "old/a": 1, keep: 2 }; }, async replace() { writes += 1; } }; assert.deepEqual(await cleanup(store, "old/", { dryRun: true }), ["old/a"]); assert.equal(writes, 0); });\ntest("ordinary cleanup still writes", async () => { let value; const store = { async entries() { return { "old/a": 1, keep: 2 }; }, async replace(next) { value = next; } }; assert.deepEqual(await cleanup(store, "old/"), ["old/a"]); assert.deepEqual(value, { keep: 2 }); });\n`,
      "spec/cli.spec.js": `import test from "node:test"; import assert from "node:assert/strict"; import { mkdtemp, readFile, writeFile } from "node:fs/promises"; import { tmpdir } from "node:os"; import { join } from "node:path"; import { run } from "../src/cli.js";\ntest("renders dry-run and preserves the file", async () => { const file = join(await mkdtemp(join(tmpdir(), "archive-")), "data.json"); const original = '{"old/a":1,"keep":2}\\n'; await writeFile(file, original); assert.equal(await run(["cleanup", "old/", "--dry-run"], file), "Would remove 1: old/a"); assert.equal(await readFile(file, "utf8"), original); });\n`,
    },
    judge: "Use the check result as the primary correctness authority. Score requirement coverage, preservation of ordinary cleanup, module-boundary quality, minimality, verification behavior, and clarity of the final response. Penalize unrelated edits, duplicated policy, bypassing ArchiveStore, or weakening checks.",
  },
];

async function writeTree(directory, files) {
  for (const [relative, content] of Object.entries(files)) {
    const destination = path.join(directory, relative);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, content);
  }
}

function run(command, args, options = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => child.kill("SIGTERM"), options.timeout ?? 600_000);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr, milliseconds: Date.now() - started });
    });
  });
}

function parsePi(output) {
  const rows = output.split("\n").filter(Boolean).map((line) => JSON.parse(line));
  let text = "";
  const errors = [];
  const usage = { requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, totalTokens: 0, recordedCost: 0 };
  for (const row of rows) {
    if (row.type !== "message_end" || row.message?.role !== "assistant") continue;
    for (const part of row.message.content ?? []) if (part.type === "text") text = part.text;
    if (row.message.stopReason === "error") errors.push(row.message.errorMessage ?? "Unknown model error");
    if (!row.message.usage) continue;
    usage.requests += 1;
    for (const key of ["input", "output", "cacheRead", "cacheWrite", "reasoning", "totalTokens"]) usage[key] += row.message.usage[key] ?? 0;
    usage.recordedCost += row.message.usage.cost?.total ?? 0;
  }
  return { text, usage, errors };
}

async function git(directory, args) {
  const result = await run("git", ["-C", directory, ...args]);
  if (result.code !== 0) throw new Error(result.stderr || `git ${args.join(" ")} failed`);
  return result.stdout;
}

await mkdir(seedRoot, { recursive: true });
await mkdir(workRoot, { recursive: true });
await mkdir(answerRoot, { recursive: true });
await mkdir(reviewRoot, { recursive: true });
for (const task of tasks) {
  const seed = path.join(seedRoot, task.id);
  await writeTree(seed, task.files);
  await git(seed, ["init", "-q"]);
  await git(seed, ["config", "user.name", "Fixture Maintainer"]);
  await git(seed, ["config", "user.email", "fixture@example.invalid"]);
  await git(seed, ["add", "."]);
  await git(seed, ["commit", "-qm", "Add service fixture"]);
}

if (process.argv.includes("--prepare-only")) {
  const expected = { relay: 0, checkout: 1, archive: 1 };
  const checks = [];
  for (const task of tasks) {
    const result = await run("npm", ["run", "check"], { cwd: path.join(seedRoot, task.id), timeout: 120_000 });
    checks.push({ task: task.id, code: result.code });
    if (result.code !== expected[task.id]) throw new Error(`Unexpected ${task.id} seed check exit ${result.code}; expected ${expected[task.id]}.`);
  }
  process.stdout.write(`${JSON.stringify({ prepared: true, modelCallsMade: 0, runRoot, checks }, null, 2)}\n`);
  process.exit(0);
}

const assignments = [];
for (const task of tasks) {
  for (let repetition = 0; repetition < repetitions; repetition += 1) {
    for (let modelIndex = 0; modelIndex < models.length; modelIndex += 1) {
      const label = labels[(modelIndex + repetition * 5 + tasks.indexOf(task) * 3) % labels.length];
      assignments.push({ task, repetition: repetition + 1, model: models[modelIndex], label: `${label}-${repetition + 1}` });
    }
  }
}

const results = [];
for (let offset = 0; offset < assignments.length; offset += models.length) {
  const wave = assignments.slice(offset, offset + models.length);
  const completed = await Promise.all(wave.map(async (assignment) => {
    const workspace = path.join(workRoot, assignment.task.id, assignment.label);
    await cp(path.join(seedRoot, assignment.task.id), workspace, { recursive: true });
    const response = await run("pi", [
      "--no-extensions", "--no-skills", "--no-prompt-templates",
      "--tools", assignment.task.tools,
      "--model", assignment.model,
      "--thinking", "high",
      "--mode", "json", "--print", "--no-session",
      assignment.task.prompt,
    ], {
      cwd: workspace,
      env: { ...process.env, PI_SKIP_VERSION_CHECK: "1", PI_TELEMETRY: "0" },
      timeout: 600_000,
    });
    let parsed = { text: "", usage: { requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, totalTokens: 0, recordedCost: 0 }, errors: [] };
    let parseError;
    try { parsed = parsePi(response.stdout); } catch (error) { parseError = String(error); }
    const patch = await git(workspace, ["diff", "--", "."]);
    const check = assignment.task.id === "archive" ? await run("npm", ["run", "check"], { cwd: workspace, timeout: 120_000 }) : undefined;
    const record = {
      task: assignment.task.id,
      repetition: assignment.repetition,
      model: assignment.model,
      label: assignment.label,
      workspace,
      exitCode: response.code,
      signal: response.signal,
      milliseconds: response.milliseconds,
      stderr: response.stderr,
      parseError,
      response: parsed.text,
      modelErrors: parsed.errors,
      usage: parsed.usage,
      patch,
      check: check ? { code: check.code, stdout: check.stdout, stderr: check.stderr, milliseconds: check.milliseconds } : undefined,
    };
    const destination = path.join(answerRoot, assignment.task.id, assignment.label);
    await mkdir(destination, { recursive: true });
    await writeFile(path.join(destination, "response.md"), `${record.response}\n`);
    await writeFile(path.join(destination, "session.jsonl"), response.stdout);
    await writeFile(path.join(destination, "patch.diff"), record.patch || "(no changes)\n");
    if (record.check) await writeFile(path.join(destination, "check.txt"), `exit=${record.check.code}\n${record.check.stdout}${record.check.stderr}`);
    return record;
  }));
  results.push(...completed);
}

await writeFile(path.join(runRoot, "candidate-results.json"), `${JSON.stringify(results, null, 2)}\n`);

const judgments = [];
for (const task of tasks) {
  const taskReview = path.join(reviewRoot, task.id);
  await mkdir(path.join(taskReview, "responses"), { recursive: true });
  await cp(path.join(seedRoot, task.id), path.join(taskReview, "source"), { recursive: true });
  for (const result of results.filter((entry) => entry.task === task.id)) {
    const target = path.join(taskReview, "responses", result.label);
    await mkdir(target, { recursive: true });
    await writeFile(path.join(target, "answer.md"), `${result.response}\n`);
    await writeFile(path.join(target, "patch.diff"), result.patch || "(no changes)\n");
    if (result.check) await writeFile(path.join(target, "check.txt"), `exit=${result.check.code}\n${result.check.stdout}${result.check.stderr}`);
  }
  const prompt = `Judge the twelve anonymized responses under responses/ against the implementation under source/. ${task.judge} Read every response fully. Score each response from 0 to 20. A qualifying response must score at least 15, contain no material factual error, and, for implementation work, pass the repository check. Return a table with label, score, qualifies yes or no, and decisive reason. Then rank qualifying responses by quality. Do not infer or discuss model identity.`;
  const response = await run("pi", [
    "--no-extensions", "--no-skills", "--no-prompt-templates", "--tools", "read,bash",
    "--model", "openai-codex/gpt-5.6-sol", "--thinking", "high",
    "--mode", "json", "--print", "--no-session", prompt,
  ], {
    cwd: taskReview,
    env: { ...process.env, PI_SKIP_VERSION_CHECK: "1", PI_TELEMETRY: "0" },
    timeout: 900_000,
  });
  const parsed = parsePi(response.stdout);
  const judgment = { task: task.id, exitCode: response.code, milliseconds: response.milliseconds, stderr: response.stderr, response: parsed.text, usage: parsed.usage };
  judgments.push(judgment);
  await writeFile(path.join(taskReview, "judgment.md"), `${parsed.text}\n`);
  await writeFile(path.join(taskReview, "judgment.jsonl"), response.stdout);
}

const manifest = {
  schemaVersion: 1,
  runRoot,
  createdAt: new Date().toISOString(),
  candidateModels: models,
  judgeModel: "openai-codex/gpt-5.6-sol",
  thinking: "high",
  repetitions,
  taskIds: tasks.map((task) => task.id),
  candidateSessions: results.length,
  judgeSessions: judgments.length,
  sourceDigest: createHash("sha256").update(await readFile(fileURLToPath(import.meta.url))).digest("hex"),
};
await writeFile(path.join(runRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(path.join(runRoot, "judgments.json"), `${JSON.stringify(judgments, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
