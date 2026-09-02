import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skillRoot = path.join(root, "skills", "poteto-mode");

function markdownFiles(directory: string): string[] {
  return fs.readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => path.join(entry.parentPath, entry.name));
}

test("ships a Pi-native worker boundary for lifted workflow instructions", () => {
  const workerSource = fs.readFileSync(path.join(root, "extensions/pstack-workers/index.ts"), "utf8");
  assert.match(workerSource, /name: "Task"/);
  assert.match(workerSource, /run_in_background/);
  assert.match(workerSource, /isolation/);
  assert.match(workerSource, /identity/);

  const architecture = fs.readFileSync(path.join(root, "ARCHITECTURE.md"), "utf8");
  assert.match(architecture, /`Task` \| Herdr-owned persistent Pi worker, or persistent Pi subprocess session/);
  assert.match(architecture, /`isolation: "worktree"` \| Worker in an isolated local worktree/);
});

test("active skill prose uses Pi-native mechanisms", () => {
  const files = markdownFiles(path.join(root, "skills"));
  const forbidden = /(?:\.cursor|\bCursor\b|AskQuestion|subagent_type|environment:\s*["`]cloud|\/goal|Bugbot)/i;
  for (const file of files) {
    assert.doesNotMatch(fs.readFileSync(file, "utf8"), forbidden, path.relative(root, file));
  }
});

test("Pi cross-skill instructions point at packaged skill files", () => {
  for (const file of markdownFiles(path.join(root, "skills"))) {
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(/`(\.\.\/[a-z0-9-]+\/SKILL\.md)`/g)) {
      assert.ok(fs.existsSync(path.resolve(path.dirname(file), match[1])), `${path.relative(root, file)} references missing ${match[1]}`);
    }
  }
});

test("worker identities preserve upstream behavior with only Pi host adaptations", () => {
  const upstreamPoteto = fs.readFileSync(path.join(root, "agents/poteto-agent.md"), "utf8");
  const workerPoteto = fs.readFileSync(path.join(root, "extensions/pstack-workers/identities/poteto-agent.md"), "utf8");
  assert.equal(workerPoteto, upstreamPoteto);

  const upstreamComment = fs.readFileSync(path.join(root, "agents/comment-sicko.md"), "utf8");
  const expectedComment = upstreamComment
    .replace("name: Comment Sicko", "name: comment-sicko")
    .replace("I run `/how`, `/why`, or both from the **how** and **why** skills", "I read and follow the loaded **how** skill, **why** skill, or both");
  const workerComment = fs.readFileSync(path.join(root, "extensions/pstack-workers/identities/comment-sicko.md"), "utf8");
  assert.equal(workerComment, expectedComment);
});

test("the runtime package excludes repository-only and unsupported source", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.equal(manifest.files.includes("automations"), false);
  assert.equal(manifest.files.includes("assets"), false);
  assert.equal(manifest.files.includes("docs"), false);
  assert.equal(fs.existsSync(path.join(root, "skills", "make-bot-ui")), false);
});

test("poteto-mode references only packaged playbooks", () => {
  for (const file of markdownFiles(skillRoot)) {
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(/playbooks\/([a-z0-9-]+\.md)/g)) {
      const target = path.join(skillRoot, "playbooks", match[1]);
      assert.ok(fs.existsSync(target), `${path.relative(root, file)} references missing ${match[0]}`);
    }
  }
});

test("packages the complete upstream PR and orchestration workflow set", () => {
  for (const name of ["autopilot-full.md", "autopilot-stack.md", "babysit.md", "shipping.md", "orchestrate.md", "opening-a-pr.md"]) {
    assert.ok(fs.existsSync(path.join(skillRoot, "playbooks", name)), `${name} should be packaged`);
  }
  assert.ok(fs.existsSync(path.join(skillRoot, "scripts/orch/orch.ts")));
  assert.ok(fs.existsSync(path.join(skillRoot, "scripts/watch-pr/cli.ts")));
});
