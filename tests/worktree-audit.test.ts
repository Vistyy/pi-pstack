import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";

const audit = path.resolve("content/pstack/skills/poteto-mode/scripts/worktree-audit.mjs");

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

type HistoryContent =
  | string
  | Record<string, string | Record<string, string>>
  | Array<{ type: string; data?: string; arguments?: Record<string, string> }>;

const msg = (role: string, content: HistoryContent) => ({
  type: "message",
  message: { role, content },
});

async function fixture(t: TestContext, prs: unknown[] = []) {
  const root = await mkdtemp(path.join(os.tmpdir(), "pstack-audit-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const repo = path.join(root, "repo"),
    bare = path.join(root, "origin.git");

  const agent = path.join(root, "agent"),
    bin = path.join(root, "bin");

  await Promise.all([mkdir(repo), mkdir(agent), mkdir(bin)]);
  git(root, "init", "--bare", bare);
  git(repo, "init", "-b", "main");
  git(repo, "config", "user.email", "fixture@example.test");
  git(repo, "config", "user.name", "Fixture");
  await writeFile(path.join(repo, "tracked"), "base");
  git(repo, "add", ".");
  git(repo, "commit", "-m", "base");
  git(repo, "remote", "add", "origin", bare);
  git(repo, "push", "-u", "origin", "main");

  const paths: Record<"scratch" | "wip" | "closed" | "open", string> = {
    scratch: "",
    wip: "",
    closed: "",
    open: "",
  };

  for (const branch of ["scratch", "wip", "closed", "open"] as const) {
    paths[branch] = path.join(root, `wt-${branch}`);
    git(repo, "worktree", "add", "-b", branch, paths[branch], "main");
  }

  const gh = path.join(bin, "gh");
  await writeFile(gh, `#!/bin/sh\nprintf '%s' '${JSON.stringify(prs)}'\n`);
  await (await import("node:fs/promises")).chmod(gh, 0o755);

  const env = {
    ...process.env,
    HOME: path.join(root, "home"),
    PI_CODING_AGENT_DIR: agent,
    PI_SESSION_FILE: "",
    PATH: `${bin}:${process.env["PATH"]}`,
  };

  const sessionDir = (cwd: string) =>
    path.join(agent, "sessions", `--${cwd.replace(/^[/\\]+/, "").replace(/[\\/:]/g, "-")}--`);

  const session = async (directory: string, cwd: string, id: string, entries: unknown[]) => {
    await mkdir(directory, { recursive: true });
    await writeFile(
      path.join(directory, `${id}.jsonl`),
      [
        JSON.stringify({ type: "session", id, cwd }),
        ...entries.map((entry) => JSON.stringify(entry)),
      ].join("\n") + "\n",
    );
  };

  const run = (args: string[] = []) =>
    spawnSync(process.execPath, [audit, repo, ...args], { encoding: "utf8", env });

  return { root, repo, paths, sessionDir, session, run, env };
}

function row(output: string, worktree: string) {
  return output
    .split("\n")
    .find((x) => x.endsWith(worktree))
    ?.split("\t");
}

void test("real CLI classifies scratch/WIP, CLOSED unmerged and multiple PR OPEN precedence without mutation", async (t) => {
  const f = await fixture(t, [
    { number: 3, state: "CLOSED", headRefName: "closed" },
    { number: 4, state: "OPEN", headRefName: "open" },
    { number: 5, state: "CLOSED", headRefName: "open" },
  ]);

  await writeFile(path.join(f.paths.scratch, "scratch-file"), "x");
  await writeFile(path.join(f.paths.wip, "tracked"), "changed");
  await writeFile(path.join(f.paths.closed, "closed-only"), "closed");
  git(f.paths.closed, "add", "closed-only");
  git(f.paths.closed, "commit", "-m", "closed unmerged work");

  const before = Object.fromEntries(
    Object.entries(f.paths).map(([k, p]) => [k, git(p, "rev-parse", "HEAD")]),
  );

  const r = f.run();
  assert.equal(r.status, 0, r.stderr);
  assert.equal(row(r.stdout, f.paths.scratch)?.[3], "scratch:1");
  assert.equal(row(r.stdout, f.paths.scratch)?.[7], "safe");
  assert.match(row(r.stdout, f.paths.wip)?.[3] ?? "", /^wip:/);
  assert.equal(row(r.stdout, f.paths.wip)?.[7], "hold-wip");
  assert.equal(row(r.stdout, f.paths.closed)?.[7], "safe");
  assert.equal(row(r.stdout, f.paths.open)?.[7], "hold-open-pr");

  for (const k of ["scratch", "wip", "closed", "open"] as const)
    assert.equal(git(f.paths[k], "rev-parse", "HEAD"), before[k]);
  assert.match(r.stderr, /non-deleting/);
});

void test("history admission, header activity, cross-worktree typed text and exact-current-file boundary", async (t) => {
  const f = await fixture(t),
    target = f.paths.scratch,
    child = f.paths.closed;

  await f.session(f.sessionDir(target), target, "header-activity", []);
  const shared = path.join(f.root, "shared history");
  await f.session(shared, f.repo, "cross-worktree", [
    msg("system", target),
    {
      type: "message",
      message: { role: "user", content: `quoted "${child}" and ${target}-sibling` },
    },
    {
      type: "message",
      message: { role: "assistant", content: [{ type: "toolCall", arguments: { path: target } }] },
    },
    { type: "compaction", summary: `working in ${target}` },
  ]);

  const currentDir = path.join(f.root, "current"),
    current = path.join(currentDir, "current.jsonl");

  await f.session(currentDir, f.repo, "current", [msg("user", `mention ${child}`)]);
  await f.session(currentDir, f.repo, "forbidden-sibling", [msg("user", target)]);
  f.env.PI_SESSION_FILE = current;
  const args = ["--history-scope", JSON.stringify({ cwd: f.repo, directory: shared })];
  const r = f.run(args);
  assert.equal(r.status, 0, r.stderr);
  assert.notEqual(row(r.stdout, target)?.[6], "-");
  assert.equal(row(r.stdout, child)?.[7], "verify-recent-chat");
  assert.match(r.stderr, /cross-worktree/);
  assert.match(r.stderr, /current:\/.*current\.jsonl/);
  assert.doesNotMatch(r.stderr, /forbidden-sibling/);
});

void test("foreign headers do not leak body, malformed admitted history reviews, missing directory alone does not", async (t) => {
  const f = await fixture(t),
    wt = f.paths.scratch,
    dir = f.sessionDir(wt);

  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "foreign.jsonl"),
    `${JSON.stringify({ type: "session", id: "foreign", cwd: f.repo })}\n${"PRIVATE_BODY_MARKER".repeat(30000)}`,
  );
  await writeFile(path.join(dir, "bad.jsonl"), "{not-json}\n");
  const linked = path.join(f.root, "linked.jsonl");
  await writeFile(linked, "private link body\n");
  await (await import("node:fs/promises")).symlink(linked, path.join(dir, "linked.jsonl"));
  const r = f.run();
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stderr, /PRIVATE_BODY_MARKER|not-json/);
  assert.equal(row(r.stdout, wt)?.[7], "review");

  const empty = await fixture(t),
    absent = empty.run();

  assert.equal(absent.status, 0, absent.stderr);
  assert.equal(row(absent.stdout, empty.paths.scratch)?.[7], "safe");
});

void test("four days plus fraction is recent; five days is not; explicitly paired outside cwd scopes", async (t) => {
  const f = await fixture(t),
    recent = f.paths.scratch,
    old = f.paths.closed,
    now = Date.now();

  await f.session(f.sessionDir(recent), recent, "fractional-four", []);
  await f.session(f.sessionDir(old), old, "five-days", []);
  const fs = await import("node:fs/promises");

  for (const [p, days] of [
    [path.join(f.sessionDir(recent), "fractional-four.jsonl"), 4.5],
    [path.join(f.sessionDir(old), "five-days.jsonl"), 5],
  ] as const) {
    await fs.utimes(p, (now - days * 86400000) / 1000, (now - days * 86400000) / 1000);
  }

  let r = f.run();
  assert.equal(row(r.stdout, recent)?.[7], "verify-recent-chat");
  assert.equal(row(r.stdout, old)?.[7], "safe");

  const directory = path.join(f.root, "outside history"),
    cwd = path.join(f.root, "not-worktree");

  await f.session(directory, cwd, "explicit-outside", [msg("user", old)]);
  r = f.run(["--history-scope", JSON.stringify({ cwd, directory })]);
  assert.equal(row(r.stdout, old)?.[7], "verify-recent-chat");
  assert.match(r.stderr, /explicit-outside/);
  await writeFile(
    path.join(directory, "unpaired.jsonl"),
    `${JSON.stringify({ type: "session", id: "unpaired", cwd })}\n${JSON.stringify(msg("user", recent))}\n`,
  );
  r = f.run(["--history-scope", JSON.stringify({ cwd: f.repo, directory })]);
  assert.doesNotMatch(r.stderr, /unpaired/);
});

void test("NUL rename status, text-only history and malformed forge response are conservative", async (t) => {
  const f = await fixture(t, [{ number: 8, state: "UNKNOWN", headRefName: "scratch" }]);
  await writeFile(path.join(f.paths.wip, "tracked"), "change");
  git(f.paths.wip, "add", "tracked");
  git(f.paths.wip, "commit", "-m", "tracked change");
  git(f.paths.wip, "mv", "tracked", "renamed");
  await f.session(f.sessionDir(f.paths.scratch), f.repo, "nontext", [
    msg("system", f.paths.scratch),
    msg("user", [{ type: "image", data: f.paths.scratch }]),
  ]);
  const r = f.run();
  assert.equal(r.status, 0, r.stderr);
  assert.equal(row(r.stdout, f.paths.wip)?.[3], "wip:1");
  assert.equal(row(r.stdout, f.paths.scratch)?.[7], "review");
  assert.equal(row(r.stdout, f.paths.scratch)?.[6], "-");
  assert.doesNotMatch(r.stderr, /History evidence .*nontext/);
  const invalid = f.run(["--history-scope", JSON.stringify({ cwd: "", directory: "/tmp" })]);
  assert.notEqual(invalid.status, 0);
});

void test("detached HEAD is valid; failed Git refresh keeps otherwise eligible rows under review", async (t) => {
  const detached = await fixture(t);
  git(detached.paths.scratch, "checkout", "--detach", "HEAD");
  let result = detached.run();
  assert.equal(row(result.stdout, detached.paths.scratch)?.[4], "detached");
  assert.equal(row(result.stdout, detached.paths.scratch)?.[7], "safe");

  const failed = await fixture(t);
  git(failed.repo, "remote", "remove", "origin");
  result = failed.run();
  assert.equal(row(result.stdout, failed.paths.scratch)?.[7], "review");
  assert.match(result.stderr, /Fetch origin main failed/);
});
