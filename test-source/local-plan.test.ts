import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

await test("local plan CLI preserves live, performance, review, and handoff gates", async (t) => {
  const root = path.resolve(import.meta.dirname, "../content/pstack/skills/poteto-mode");
  const source = await readFile(path.join(root, "playbooks/multi-phase-plan.md"), "utf8");
  const template = source.split("````markdown\n")[1]?.split("````")[0];
  assert.ok(template !== undefined, "the playbook supplies its runnable plan template");
  const plan = template.replaceAll("<swarm workers model>", "test/reviewer:high");
  const directory = await mkdtemp(path.join(tmpdir(), "pstack-local-plan-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, "plan.md");

  const check = async (text: string) => {
    await writeFile(file, text);

    return spawnSync(process.execPath, [path.join(root, "scripts/check-plan.mjs"), file], {
      encoding: "utf8",
    });
  };

  const valid = await check(plan);
  assert.equal(valid.status, 0, valid.stderr);
  assert.match(valid.stdout, /1 PR sections, 0 problems/);

  const cases = [
    [plan.replace(/^- \[ \] Lane 10\..*\n/m, ""), /expected 1 to 10/],
    [plan.replace("Lane 10.", "Lane 9."), /expected 1 to 10/],
    [plan.replaceAll("Save `<slug>.png`.", ""), /names no screenshot/],
    [plan.replaceAll("Pass when", "Check whether"), /has no pass predicate/],
    [plan.replace(/^- \[ \] Baseline\..*\n/m, ""), /perf boxes/],
    [plan.replaceAll("video", "clip"), /Review gate lacks "video"/],
    [plan.replaceAll("**Handoff.**", "**Merge.**"), /expected.*Handoff/],
    [
      plan.replace("**Verify, unit.** Tests alone", "**Verify, unit.** Checks alone"),
      /does not open with the rule/,
    ],
  ] as const;

  for (const [input, diagnostic] of cases) {
    const result = await check(input);
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stderr, diagnostic);
  }
});
