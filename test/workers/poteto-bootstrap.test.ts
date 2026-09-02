import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assertPotetoBootstrapped, findPotetoSkill, potetoBootstrapPrompt } from "../../extensions/pstack-workers/poteto-bootstrap.js";

async function sessionWithCalls(calls: Array<{ name: string; arguments: Record<string, unknown> }>): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "poteto-bootstrap-"));
  const path = join(directory, "session.jsonl");
  const now = new Date().toISOString();
  await writeFile(path, [
    JSON.stringify({ type: "session", version: 3, id: "bootstrap", timestamp: now, cwd: directory }),
    JSON.stringify({ type: "message", id: "00000001", parentId: null, timestamp: now, message: { role: "user", content: "initialize", timestamp: Date.now() } }),
    JSON.stringify({ type: "message", id: "00000002", parentId: "00000001", timestamp: now, message: { role: "assistant", content: calls.map((call, index) => ({ type: "toolCall", id: `call-${index}`, ...call })), provider: "test", model: "test", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "toolUse", timestamp: Date.now() } }),
  ].join("\n") + "\n");
  return path;
}

test("Poteto bootstrap requires the exact skill read and todo initialization", async () => {
  const skill = "/package/skills/poteto-mode/SKILL.md";
  const session = await sessionWithCalls([
    { name: "read", arguments: { path: skill } },
    { name: "pstack_todo", arguments: { action: "set", items: ["Ready"] } },
  ]);
  assert.doesNotThrow(() => assertPotetoBootstrapped(session, skill));
});

test("Poteto bootstrap rejects a worker that skipped its identity contract", async () => {
  const session = await sessionWithCalls([{ name: "read", arguments: { path: "README.md" } }]);
  assert.throws(() => assertPotetoBootstrapped(session, "/package/skills/poteto-mode/SKILL.md"), /full Poteto skill read and pstack_todo initialization/);
});

test("Poteto bootstrap prompt and skill lookup use the packaged resource path", () => {
  const skill = findPotetoSkill(["/package/skills/how/SKILL.md", "/package/skills/poteto-mode/SKILL.md"]);
  assert.equal(skill, "/package/skills/poteto-mode/SKILL.md");
  assert.match(potetoBootstrapPrompt(skill), /pstack_todo/);
  assert.throws(() => findPotetoSkill(["/package/skills/how/SKILL.md"]), /does not include/);
});
