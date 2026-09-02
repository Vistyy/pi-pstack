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
const portMap = JSON.parse(fs.readFileSync(path.join(root, "port-map.json"), "utf8"));
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

function packageFiles() {
  return git(["-C", packageRoot, "ls-files", "--cached", "--others", "--exclude-standard"])
    .split("\n")
    .filter(Boolean);
}

function policyFor(relative) {
  const sourcePath = `${upstream.path}/${relative}`;
  const rule = portMap.rules.find((candidate) => candidate.exact === sourcePath || (candidate.prefix && sourcePath.startsWith(candidate.prefix)));
  return rule ? { classification: rule.classification, action: rule.action } : { classification: "unclassified", action: "Assign an owner before adapting this path." };
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
    rows.push({ path: relative, status: "omitted", upstreamSha256: digest(source), ...policyFor(relative) });
    continue;
  }
  const packaged = fs.readFileSync(destination);
  rows.push({
    path: relative,
    status: source.equals(packaged) ? "exact" : "adapted",
    upstreamSha256: digest(source),
    packageSha256: digest(packaged),
    ...policyFor(relative),
  });
}

for (const relative of packageFiles().sort()) {
  if (upstreamRelative.has(relative)) continue;
  const official = officialDestinations.has(relative);
  rows.push({
    path: relative,
    status: official ? "official-integration" : "pi-only",
    packageSha256: digest(fs.readFileSync(path.join(packageRoot, relative))),
    classification: official ? "official-integration" : "pi-owned",
    action: official ? "Keep byte-identical to integrations.lock.json." : "Review as a Pi-owned addition.",
  });
}

const counts = Object.fromEntries(
  ["exact", "adapted", "omitted", "official-integration", "pi-only"].map((status) => [status, rows.filter((row) => row.status === status).length]),
);
const report = { upstream: { commit: upstream.commit, pluginVersion: upstream.pluginVersion }, counts, files: rows };
const reportPath = path.join(root, ".work", "port-report.json");
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ ...report, files: undefined, reportPath: path.relative(root, reportPath) }, null, 2)}\n`);
const unclassified = rows.filter((row) => row.classification === "unclassified");
if (unclassified.length > 0) {
  process.stderr.write(`Unclassified upstream paths: ${unclassified.map((row) => row.path).join(", ")}\n`);
  process.exitCode = 1;
}
