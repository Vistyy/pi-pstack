import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRoles } from "../src/runtime.js";

test("source role map preserves all labels, scalar/list shape, and panel order", () => {
  const roles = parseRoles(`## Rules\n\n\`\`\`text\n# budget: unlimited (max)\nalpha: p/a:max\npanel: p/a:max, p/b:xhigh, inherit-parent\n\`\`\``);
  assert.deepEqual(roles, [
    { name: "alpha", panel: false, defaults: "p/a:max" },
    { name: "panel", panel: true, defaults: ["p/a:max", "p/b:xhigh", "inherit-parent"] },
  ]);
});

test("source without the budget marker fails clearly", () => {
  assert.throws(() => parseRoles("```\na: p/a:max\n```"), /lacks '# budget: unlimited \(max\)'/);
});
