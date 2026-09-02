#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const profilesRoot = path.join(root, ".work", "smoke-profiles");
const withAuth = process.argv.includes("--with-auth");
const buildArgs = [path.join(root, "scripts", "build-profiles.mjs"), "--output", profilesRoot];
if (withAuth) buildArgs.push("--with-auth");
const build = spawnSync(process.execPath, buildArgs, {
  encoding: "utf8",
});
if (build.status !== 0) {
  process.stderr.write(build.stderr);
  process.exit(build.status ?? 1);
}

const expectations = {
  plain: { potetoMode: false },
  pstack: { potetoMode: true },
  current: { potetoMode: false },
};
const results = {};

for (const [name, expected] of Object.entries(expectations)) {
  const agentDir = path.join(profilesRoot, name);
  const rpc = spawnSync("pi", ["--mode", "rpc", "--no-session"], {
    encoding: "utf8",
    input: '{"type":"get_state"}\n{"type":"get_commands"}\n',
    env: {
      ...process.env,
      PI_CODING_AGENT_DIR: agentDir,
      PI_SKIP_VERSION_CHECK: "1",
      PI_TELEMETRY: "0",
    },
    timeout: 15_000,
  });
  const responses = rpc.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((entry) => entry.type === "response");
  const state = responses.find((entry) => entry.command === "get_state");
  const commands = responses.find((entry) => entry.command === "get_commands");
  const commandNames = (commands?.data?.commands ?? []).map((command) => command.name);
  const hasPotetoMode = commandNames.includes("poteto-mode");
  const errors = [];
  if (rpc.status !== 0) errors.push(`RPC exited ${rpc.status}: ${rpc.stderr.trim()}`);
  if (!state?.success) errors.push("get_state did not succeed.");
  if (!commands?.success) errors.push("get_commands did not succeed.");
  if (hasPotetoMode !== expected.potetoMode) {
    errors.push(`poteto-mode presence was ${hasPotetoMode}; expected ${expected.potetoMode}.`);
  }
  const selectedModel = state?.data?.model ? `${state.data.model.provider}/${state.data.model.id}` : null;
  if (withAuth && selectedModel !== "openai-codex/gpt-5.6-luna") {
    errors.push(`selected model was ${selectedModel}; expected openai-codex/gpt-5.6-luna.`);
  }
  results[name] = {
    passed: errors.length === 0,
    model: selectedModel,
    thinkingLevel: state?.data?.thinkingLevel ?? null,
    commandCount: commandNames.length,
    hasPotetoMode,
    stderr: rpc.stderr.trim(),
    errors,
  };
}

const output = {
  passed: Object.values(results).every((result) => result.passed),
  modelCallsMade: 0,
  authIncluded: withAuth,
  results,
};
const outputPath = path.join(root, ".work", "smoke-report.json");
fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
if (!output.passed) process.exitCode = 1;
