#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lock = JSON.parse(fs.readFileSync(path.join(root, "integrations.lock.json"), "utf8"));
const write = process.argv.includes("--write");
const sourceRoot = path.join(root, ".work", "integrations");

function git(args, options = {}) {
  return execFileSync("git", args, { encoding: null, stdio: ["ignore", "pipe", "pipe"], ...options });
}

function hash(content) {
  return createHash("sha256").update(content).digest("hex");
}

function checkout(source) {
  const directory = path.join(sourceRoot, source.name);
  if (!fs.existsSync(path.join(directory, ".git"))) {
    fs.mkdirSync(path.dirname(directory), { recursive: true });
    git(["clone", "--filter=blob:none", "--no-checkout", source.repository, directory]);
  }
  git(["-C", directory, "fetch", "--quiet", "origin", source.commit]);
  return directory;
}

const results = [];
let failed = false;
for (const source of lock.sources) {
  const checkoutDirectory = checkout(source);
  for (const file of source.files) {
    const content = git(["-C", checkoutDirectory, "show", `${source.commit}:${file.source}`]);
    const sourceHash = hash(content);
    if (sourceHash !== file.sha256) {
      throw new Error(`${source.name}:${file.source} has ${sourceHash}; lock expects ${file.sha256}`);
    }

    const destination = path.join(root, file.destination);
    if (write) {
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, content);
    }

    const destinationHash = fs.existsSync(destination) ? hash(fs.readFileSync(destination)) : null;
    const current = destinationHash === file.sha256;
    results.push({ source: source.name, sourcePath: file.source, destination: file.destination, sha256: file.sha256, current });
    if (!current) failed = true;
  }
}

process.stdout.write(`${JSON.stringify({ write, current: !failed, files: results }, null, 2)}\n`);
if (failed) process.exitCode = 1;
