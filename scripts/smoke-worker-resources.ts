import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPiArgs } from "../extensions/pstack-workers/herdr.js";
import { discoverInheritedResources, resolveRuntimeSettings } from "../extensions/pstack-workers/resources.js";
import type { AgentIdentity } from "../extensions/pstack-workers/types.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const profilesRoot = path.join(root, ".work", "worker-resource-smoke");
const build = spawnSync(process.execPath, [path.join(root, "scripts", "build-profiles.mjs"), "--output", profilesRoot], {
  cwd: root,
  encoding: "utf8",
});
assert.equal(build.status, 0, build.stderr);

const agentDir = path.join(profilesRoot, "pstack");
const packageRoot = path.join(agentDir, "package-runtime", "node_modules", "@vistyy", "pi-pstack");
const inherited = await discoverInheritedResources({
  cwd: root,
  agentDir,
  projectTrusted: true,
  packageRoot,
});
const coreExtension = path.join(packageRoot, "extensions", "pstack", "index.ts");
const potetoSkill = path.join(packageRoot, "skills", "poteto-mode", "SKILL.md");

assert.deepEqual(inherited.extensions.map((resource) => resource.value), [coreExtension]);
assert.equal(inherited.skills.some((resource) => resource.value === potetoSkill), true);
assert.equal(inherited.skills.some((resource) => resource.aliases.includes("principle-prove-it-works")), true);

const identity: AgentIdentity = {
  name: "poteto-agent",
  description: "Poteto worker",
  sourcePath: path.join(packageRoot, "agents", "poteto-agent.md"),
};
const settings = resolveRuntimeSettings({
  identity,
  defaults: {},
  parent: { provider: "openai-codex", model: "gpt-5.4-mini", thinking: "medium" },
  inherited,
  activeTools: ["read", "bash", "edit", "write", "pstack_todo", "Task", "start_agents"],
});
assert.equal(settings.extensions?.includes(coreExtension), true);
assert.equal(settings.skills?.includes(potetoSkill), true);
assert.equal(settings.tools?.includes("pstack_todo"), true);
assert.equal(settings.tools?.includes("Task"), false);
assert.equal(settings.tools?.includes("start_agents"), false);

const sessionFile = path.join(profilesRoot, "worker-smoke.jsonl");
const args = buildPiArgs({ settings, sessionFile, sessionName: "worker-smoke" });
const rpc = spawnSync("pi", ["--mode", "rpc", ...args], {
  cwd: root,
  encoding: "utf8",
  input: '{"type":"get_commands"}\n',
  env: {
    ...process.env,
    PI_CODING_AGENT_DIR: agentDir,
    PI_SKIP_VERSION_CHECK: "1",
    PI_TELEMETRY: "0",
  },
  timeout: 30_000,
});
assert.equal(rpc.status, 0, rpc.stderr);
const response = rpc.stdout.split("\n").filter(Boolean).map((line) => JSON.parse(line)).find((entry) => entry.command === "get_commands");
assert.equal(response?.success, true);
const commandNames = response.data.commands.map((command: { name: string }) => command.name);
assert.equal(commandNames.includes("skill:poteto-mode"), true);

console.log(JSON.stringify({
  passed: true,
  modelCallsMade: 0,
  coreExtension,
  skillCount: settings.skills?.length ?? 0,
  activeTools: settings.tools,
}, null, 2));
