#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checkout = path.join(root, ".work", "upstream");
const packageRoot = root;
const upstream = JSON.parse(fs.readFileSync(path.join(root, "upstream.lock.json"), "utf8"));
const integrations = JSON.parse(fs.readFileSync(path.join(root, "integrations.lock.json"), "utf8"));
const officialDestinations = new Set(
  integrations.sources.flatMap((source) => source.files.map((file) => file.destination)),
);

function git(args, options = {}) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options }).trim();
}

function gitBuffer(args) {
  return execFileSync("git", args, { encoding: null, maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
}

function ensureCheckout() {
  if (!fs.existsSync(path.join(checkout, ".git"))) {
    fs.mkdirSync(path.dirname(checkout), { recursive: true });
    git(["clone", "--filter=blob:none", "--no-checkout", upstream.repository, checkout]);
  }
  git(["-C", checkout, "fetch", "--quiet", "origin", upstream.commit]);
}

function digest(content) {
  return createHash("sha256").update(content).digest("hex");
}

function packageFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(packageRoot, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"));
}

ensureCheckout();
const sourcePrefix = `${upstream.path}/`;
const upstreamFiles = git([
  "-C",
  checkout,
  "ls-tree",
  "-r",
  "--name-only",
  upstream.commit,
  "--",
  upstream.path,
])
  .split("\n")
  .filter(Boolean)
  .map((file) => file.slice(sourcePrefix.length));

const rows = [];
const upstreamRelative = new Set(upstreamFiles);
for (const relative of upstreamFiles) {
  const source = gitBuffer(["-C", checkout, "show", `${upstream.commit}:${sourcePrefix}${relative}`]);
  const destination = path.join(packageRoot, relative);
  if (!fs.existsSync(destination)) {
    rows.push({ path: relative, status: "omitted", upstreamSha256: digest(source) });
    continue;
  }
  const packaged = fs.readFileSync(destination);
  rows.push({
    path: relative,
    status: source.equals(packaged) ? "exact" : "adapted",
    upstreamSha256: digest(source),
    packageSha256: digest(packaged),
  });
}

const portMetadata = new Set([
  ".gitignore",
  "ARCHITECTURE.md",
  "BENCHMARK.md",
  "PORTING.md",
  "capabilities.json",
  "integrations.lock.json",
  "port-map.json",
  "upstream.lock.json",
]);
for (const relative of packageFiles(packageRoot).filter((file) =>
  !file.startsWith(".git/") &&
  !file.startsWith(".work/") &&
  !file.split("/").includes("node_modules") &&
  !file.startsWith("scripts/") &&
  !file.startsWith("test/") &&
  !portMetadata.has(file)
).sort()) {
  if (upstreamRelative.has(relative)) continue;
  rows.push({ path: relative, status: officialDestinations.has(relative) ? "official-integration" : "pi-only", packageSha256: digest(fs.readFileSync(path.join(packageRoot, relative))) });
}

const counts = Object.fromEntries(
  ["exact", "adapted", "omitted", "official-integration", "pi-only"].map((status) => [status, rows.filter((row) => row.status === status).length]),
);
const report = { upstream: { commit: upstream.commit, pluginVersion: upstream.pluginVersion }, counts, files: rows };
const reportPath = path.join(root, ".work", "port-report.json");
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ ...report, files: undefined, reportPath: path.relative(root, reportPath) }, null, 2)}\n`);
