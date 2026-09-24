import assert from "node:assert/strict";
import { type SpawnSyncReturns, spawnSync } from "node:child_process";
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("..", import.meta.url));

const patch = "--- a/base.txt\n+++ b/base.txt\n@@ -1 +1 @@\n-pinned\n+adapted\n";

async function put(root: string, relative: string, contents: string) {
  const target = path.join(root, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, contents);
}

function command(cwd: string, executable: string, args: string[]) {
  return spawnSync(executable, args, { cwd, encoding: "utf8" });
}

async function fixture(t: TestContext) {
  const directory = await mkdtemp(path.join(tmpdir(), "pstack-cli-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const remote = path.join(directory, "remote");
  const root = path.join(directory, "package");
  await put(remote, "pstack/base.txt", "pinned\n");
  await put(remote, "pstack/.cursor-plugin/plugin.json", '{"version":"1.0.0"}\n');
  await put(
    remote,
    "pstack/agents/poteto-agent.md",
    "---\nname: poteto-agent\n---\nOriginal identity.\n",
  );
  await put(
    remote,
    "pstack/skills/poteto-mode/SKILL.md",
    "---\nname: poteto-mode\n---\nComplete original method.\n",
  );
  await put(
    remote,
    "pstack/agents/comment-sicko.md",
    "---\nname: Comment Sicko\n---\nOriginal comment method.\n",
  );
  await put(remote, "pstack/run.sh", "#!/bin/sh\nexit 0\n");
  await chmod(path.join(remote, "pstack/run.sh"), 0o755);
  await symlink("base.txt", path.join(remote, "pstack/link"));

  const git = (...args: string[]) => {
    const result = command(remote, "git", args);
    assert.equal(result.status, 0, result.stderr);

    return result.stdout.trim();
  };

  git("init", "--quiet", "--initial-branch=main");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "Test");
  git("add", ".");
  git("commit", "--quiet", "-m", "source");
  const commit = git("rev-parse", "HEAD");

  const lock = {
    repository: remote,
    path: "pstack",
    commit,
    tree: git("rev-parse", "HEAD:pstack"),
    version: "1.0.0",
  };

  await mkdir(path.join(root, "patches"), { recursive: true });
  await cp(path.join(repo, "scripts"), path.join(root, "scripts"), { recursive: true });
  await cp(path.join(remote, "pstack"), path.join(root, "upstream/pstack"), {
    recursive: true,
    verbatimSymlinks: true,
  });
  await put(root, "upstream.lock.json", JSON.stringify(lock));

  return {
    root,
    remote,
    git,
    commit,
    run: (...args: string[]) =>
      command(directory, process.execPath, [path.join(root, "scripts/source.ts"), ...args]),
  };
}

function success(result: SpawnSyncReturns<string>) {
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

  return result.stdout;
}

async function activeState(root: string) {
  return Promise.all(
    ["upstream.lock.json", "upstream/pstack/base.txt", "content/pstack/base.txt"].map((name) =>
      readFile(path.join(root, name), "utf8"),
    ),
  );
}

async function candidateDirectory(root: string) {
  const names = await readdir(path.join(root, ".work"));
  const candidates = names.filter((name) => name.startsWith("candidate-"));
  assert.equal(candidates.length, 1);
  const candidate = candidates[0];
  assert.ok(candidate !== undefined);

  return path.join(root, ".work", candidate);
}

await test("generate and verify work without upstream Git objects, preserve source identity, and detect drift", async (t) => {
  const f = await fixture(t);
  await put(f.root, "patches/001.patch", patch);
  success(f.run("generate"));
  success(f.run("verify"));
  assert.equal(await readFile(path.join(f.root, "content/pstack/base.txt"), "utf8"), "adapted\n");
  assert.equal(await readlink(path.join(f.root, "content/pstack/link")), "base.txt");
  assert.equal((await stat(path.join(f.root, "content/pstack/run.sh"))).mode & 0o111, 0o111);
  assert.match(success(f.run("diff")), /-pinned\n\+adapted/);
  await put(f.root, "content/pstack/extra.txt", "drift");
  const drift = f.run("verify");
  assert.notEqual(drift.status, 0);
  assert.match(drift.stderr, /Generated drift/);
  success(f.run("generate"));
  await put(f.root, "upstream/pstack/base.txt", "source drift\n");
  const changedSource = f.run("verify");
  assert.notEqual(changedSource.status, 0);
  assert.match(changedSource.stderr, /snapshot differs/);
});

await test("upstream check and preparation expose changes and new version without changing active files", async (t) => {
  const f = await fixture(t);
  await put(f.root, "patches/001.patch", patch);
  success(f.run("generate"));
  const before = await activeState(f.root);
  await put(f.remote, "pstack/.cursor-plugin/plugin.json", '{"version":"2.0.0"}\n');
  await put(f.remote, "pstack/new.txt", "new upstream evidence\n");
  f.git("add", ".");
  f.git("commit", "--quiet", "-m", "new source");
  const next = f.git("rev-parse", "HEAD");
  assert.match(success(f.run("check-upstream")), /new upstream evidence/);
  success(f.run("prepare-update", next));
  const candidate = await candidateDirectory(f.root);

  const lock: unknown = JSON.parse(
    await readFile(path.join(candidate, "upstream.lock.json"), "utf8"),
  );

  assert.deepEqual(lock, {
    repository: f.remote,
    path: "pstack",
    commit: next,
    tree: f.git("rev-parse", `${next}:pstack`),
    version: "2.0.0",
  });
  assert.equal(
    await readFile(path.join(candidate, "content/pstack/base.txt"), "utf8"),
    "adapted\n",
  );
  assert.match(
    await readFile(path.join(candidate, "upstream.diff"), "utf8"),
    /new upstream evidence/,
  );
  assert.deepEqual(await activeState(f.root), before);
});

await test("patch conflicts fail preparation with retained evidence and leave active files unchanged", async (t) => {
  const f = await fixture(t);
  await put(f.root, "patches/001.patch", patch);
  success(f.run("generate"));
  const before = await activeState(f.root);
  await put(f.remote, "pstack/base.txt", "incompatible upstream change\n");
  f.git("add", ".");
  f.git("commit", "--quiet", "-m", "conflict");
  const result = f.run("prepare-update", f.git("rev-parse", "HEAD"));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Candidate preparation failed/);
  const candidate = await candidateDirectory(f.root);
  assert.match(
    await readFile(path.join(candidate, "failure.txt"), "utf8"),
    /Cannot replay patches\/001.patch/,
  );
  assert.match(
    await readFile(path.join(candidate, "upstream.diff"), "utf8"),
    /incompatible upstream change/,
  );
  assert.deepEqual(await activeState(f.root), before);
});
