#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const work = path.join(root, ".work", "upstream");
const lock = JSON.parse(fs.readFileSync(path.join(root, "upstream.lock.json"), "utf8"));
const map = JSON.parse(fs.readFileSync(path.join(root, "port-map.json"), "utf8"));

function git(args, options = {}) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options }).trim();
}

function ensureCheckout() {
  if (!fs.existsSync(path.join(work, ".git"))) {
    fs.mkdirSync(path.dirname(work), { recursive: true });
    git(["clone", "--filter=blob:none", "--no-checkout", lock.repository, work]);
  }
  git(["-C", work, "fetch", "--quiet", "origin", "main"]);
  git(["-C", work, "fetch", "--quiet", "origin", lock.commit]);
}

function classify(file) {
  for (const rule of map.rules) {
    if (rule.exact === file || (rule.prefix && file.startsWith(rule.prefix))) {
      return {
        classification: rule.classification,
        action: rule.action,
      };
    }
  }
  return {
    classification: "unclassified",
    action: "Stop synchronization and assign an explicit owner before changing the port.",
  };
}

ensureCheckout();
const latestCommit = git(["-C", work, "rev-parse", "origin/main"]);
const manifestText = git(["-C", work, "show", `${latestCommit}:${lock.path}/.cursor-plugin/plugin.json`]);
const latestVersion = JSON.parse(manifestText).version;
const diff = latestCommit === lock.commit
  ? []
  : git(["-C", work, "diff", "--name-status", `${lock.commit}..${latestCommit}`, "--", lock.path])
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [status, ...paths] = line.split("\t");
        const file = paths.at(-1);
        return { status, file, ...classify(file) };
      });

const counts = Object.fromEntries(
  [...new Set(diff.map((entry) => entry.classification))]
    .sort()
    .map((classification) => [classification, diff.filter((entry) => entry.classification === classification).length]),
);
const report = {
  pinned: {
    commit: lock.commit,
    pluginVersion: lock.pluginVersion,
  },
  latest: {
    commit: latestCommit,
    pluginVersion: latestVersion,
  },
  current: latestCommit === lock.commit,
  counts,
  changes: diff,
};
const reportPath = path.join(root, ".work", "upstream-report.json");
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

if (diff.some((entry) => entry.classification === "unclassified")) process.exitCode = 2;
