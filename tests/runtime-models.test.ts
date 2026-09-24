import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { parseRoles } from "../src/runtime.js";

void test("source role map retains all 17 role labels and panel order", async () => {
  const source = await readFile(
    new URL("../content/pstack/skills/setup-pstack/SKILL.md", import.meta.url),
    "utf8",
  );
  const roles = parseRoles(source);
  assert.equal(roles.length, 17);
  assert.deepEqual(roles.find((role) => role.name === "arena runners")?.defaults, [
    "claude-opus-5-5-max",
    "gpt-5.6-sol-max",
    "grok-4.7-xhigh-fast",
  ]);
  assert.equal(roles.find((role) => role.name === "feature, refactoring")?.panel, false);
});

void test("source without the budget marker fails clearly", () => {
  assert.throws(() => parseRoles("```\na: p/a:max\n```"), /lacks '# budget: unlimited \(max\)'/);
});
