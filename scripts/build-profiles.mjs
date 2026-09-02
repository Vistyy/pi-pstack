#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pstackRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const agentRoot = process.env.PI_CODING_AGENT_DIR
  ? path.resolve(process.env.PI_CODING_AGENT_DIR)
  : path.join(os.homedir(), ".pi", "agent");
const outputIndex = process.argv.indexOf("--output");
if (outputIndex >= 0 && !process.argv[outputIndex + 1]) throw new Error("--output requires a directory.");
const profilesRoot = outputIndex >= 0
  ? path.resolve(process.argv[outputIndex + 1])
  : path.join(pstackRoot, ".work", "profiles");
const withAuth = process.argv.includes("--with-auth");
const model = "openai-codex/gpt-5.6-luna";
const [provider, modelId] = model.split("/");

const plainSettings = {
  ...(withAuth
    ? {
        defaultProvider: provider,
        defaultModel: modelId,
        defaultThinkingLevel: "medium",
        enabledModels: [model],
      }
    : {}),
  packages: [],
  quietStartup: true,
};

const copiedCurrentResources = [
  "AGENTS.md",
  "SYSTEM.md",
  "APPEND_SYSTEM.md",
  "models.json",
  "keybindings.json",
  "extensions",
  "skills",
  "user-skills",
  "themes",
];

function resetDirectory(directory) {
  fs.rmSync(directory, { recursive: true, force: true });
  fs.mkdirSync(directory, { recursive: true });
}

function copy(source, destination) {
  if (!fs.existsSync(source)) return;
  fs.cpSync(source, destination, {
    recursive: true,
    filter: (entry) => {
      const name = path.basename(entry);
      return name !== ".git" && name !== "node_modules" && name !== "dist";
    },
  });
}

function copyRuntime(source, destination) {
  if (!fs.existsSync(source)) return;
  fs.cpSync(source, destination, { recursive: true });
}

function installPackage(profile) {
  const packDirectory = path.join(profile, ".package-build");
  const prefix = path.join(profile, "package-runtime");
  fs.mkdirSync(packDirectory, { recursive: true });
  const tarball = execFileSync("npm", ["pack", "--pack-destination", packDirectory, "--silent"], {
    cwd: pstackRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim().split("\n").at(-1);
  if (!tarball) throw new Error("npm pack did not return a tarball name.");
  execFileSync("npm", ["install", "--prefix", prefix, "--no-audit", "--no-fund", path.join(packDirectory, tarball)], {
    cwd: pstackRoot,
    stdio: ["ignore", "ignore", "inherit"],
  });
  fs.rmSync(packDirectory, { recursive: true, force: true });
  return "./package-runtime/node_modules/@vistyy/pi-pstack";
}

function writeJson(file, value, mode) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, mode ? { mode } : undefined);
}

function addAuth(profile) {
  if (!withAuth) return;
  const source = path.join(agentRoot, "auth.json");
  if (!fs.existsSync(source)) throw new Error(`Cannot include auth because ${source} does not exist.`);
  copy(source, path.join(profile, "auth.json"));
  fs.chmodSync(path.join(profile, "auth.json"), 0o600);
}

const plain = path.join(profilesRoot, "plain");
resetDirectory(plain);
writeJson(path.join(plain, "settings.json"), plainSettings);
addAuth(plain);

const pstack = path.join(profilesRoot, "pstack");
resetDirectory(pstack);
const installedPstackPackage = installPackage(pstack);
writeJson(path.join(pstack, "settings.json"), {
  ...plainSettings,
  packages: [installedPstackPackage],
});
addAuth(pstack);

const current = path.join(profilesRoot, "current");
resetDirectory(current);
for (const resource of copiedCurrentResources) {
  copy(path.join(agentRoot, resource), path.join(current, resource));
}
const liveSettingsPath = path.join(agentRoot, "settings.json");
const liveSettings = fs.existsSync(liveSettingsPath)
  ? JSON.parse(fs.readFileSync(liveSettingsPath, "utf8"))
  : {};
const currentSettings = { ...liveSettings };
if (withAuth) {
  Object.assign(currentSettings, {
    defaultProvider: provider,
    defaultModel: modelId,
    defaultThinkingLevel: "medium",
    enabledModels: [model],
  });
} else {
  delete currentSettings.defaultProvider;
  delete currentSettings.defaultModel;
  delete currentSettings.enabledModels;
}
writeJson(path.join(current, "settings.json"), currentSettings);
if (Array.isArray(liveSettings.packages) && liveSettings.packages.length > 0) {
  copyRuntime(path.join(agentRoot, "npm"), path.join(current, "npm"));
}
addAuth(current);

writeJson(path.join(profilesRoot, "manifest.json"), {
  generatedAt: new Date().toISOString(),
  model,
  thinkingLevel: "medium",
  authIncluded: withAuth,
  profiles: {
    plain: { agentDir: plain, packages: [] },
    pstack: { agentDir: pstack, packages: [installedPstackPackage] },
    current: { agentDir: current, copiedResources: copiedCurrentResources },
  },
});

process.stdout.write(`${profilesRoot}\n`);
