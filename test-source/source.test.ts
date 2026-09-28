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

async function treeId(directory: string) {
  const workspace = await mkdtemp(path.join(tmpdir(), "pstack-tree-test-"));

  try {
    const repository = path.join(workspace, "objects.git");
    const init = command(workspace, "git", ["init", "--quiet", "--bare", repository]);
    assert.equal(init.status, 0, init.stderr);

    const add = command(directory, "git", [
      "--git-dir",
      repository,
      "--work-tree",
      directory,
      "-c",
      "core.filemode=true",
      "add",
      "--force",
      "--all",
      "--",
      ".",
    ]);

    assert.equal(add.status, 0, add.stderr);

    const tree = command(directory, "git", [
      "--git-dir",
      repository,
      "--work-tree",
      directory,
      "write-tree",
    ]);

    assert.equal(tree.status, 0, tree.stderr);

    return tree.stdout.trim();
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

async function fixture(t: TestContext) {
  const directory = await mkdtemp(path.join(tmpdir(), "pstack-cli-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const remote = path.join(directory, "remote");
  const root = path.join(directory, "package");
  await put(remote, "pstack/base.txt", "pinned\n");
  await put(remote, "pstack/.cursor-plugin/plugin.json", '{"version":"1.0.0"}\n');
  await put(remote, "pstack/run.sh", "#!/bin/sh\nexit 0\n");
  await put(remote, "pstack/retired/old.txt", "retired implementation v1\n");
  await put(remote, "pstack/omit.txt", "excluded single file\n");
  await put(
    remote,
    "pstack/skills/example/SKILL.md",
    "Heading\nkeep 1\nkeep 2\nkeep 3\nkeep 4\nkeep 5\nkeep 6\nOriginal tail\n",
  );
  await chmod(path.join(remote, "pstack/run.sh"), 0o755);
  await symlink("base.txt", path.join(remote, "pstack/link"));
  await symlink("retired", path.join(remote, "pstack/retired-link"));
  await put(remote, "cursor-team-kit/.cursor-plugin/plugin.json", '{"version":"1.2.0"}\n');
  await put(remote, "cursor-team-kit/LICENSE", "toolkit license\n");

  for (const skill of ["deslop", "control-cli", "control-ui"])
    await put(remote, `cursor-team-kit/skills/${skill}/SKILL.md`, `${skill} source\n`);

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

  const kitTree = git("rev-parse", "HEAD:cursor-team-kit");

  const lock = {
    repository: remote,
    path: "pstack",
    commit,
    tree: git("rev-parse", "HEAD:pstack"),
    version: "1.0.0",
    cursorTeamKit: { sourceTree: kitTree, selectedTree: kitTree, version: "1.2.0" },
  };

  await mkdir(path.join(root, "patches"), { recursive: true });
  await cp(path.join(repo, "scripts"), path.join(root, "scripts"), { recursive: true });
  await cp(path.join(remote, "pstack"), path.join(root, "upstream/pstack"), {
    recursive: true,
    verbatimSymlinks: true,
  });
  await cp(path.join(remote, "cursor-team-kit"), path.join(root, "upstream/cursor-team-kit"), {
    recursive: true,
    verbatimSymlinks: true,
  });
  await put(root, "upstream.lock.json", JSON.stringify(lock));
  await put(root, "upstream-exclusions.txt", "");

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
    [
      "upstream.lock.json",
      "upstream/pstack/base.txt",
      "content/pstack/base.txt",
      "upstream/cursor-team-kit/skills/deslop/SKILL.md",
      "content/pstack/skills/deslop/SKILL.md",
      "content/pstack/licenses/cursor-team-kit.LICENSE",
    ].map((name) => readFile(path.join(root, name), "utf8")),
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

await test("patch refresh maintains net per-file diffs and preserves binary content, whitespace, modes, and symlinks", async (t) => {
  const f = await fixture(t);
  success(f.run("generate"));
  const before = await activeState(f.root);
  const edited = path.join(f.root, "edited");
  await cp(path.join(f.root, "content/pstack"), edited, {
    recursive: true,
    verbatimSymlinks: true,
  });
  await put(edited, "base.txt", "final  \n");
  await put(edited, "skills/first/SKILL.md", "first adaptation\n");
  await put(edited, "skills/é space/SKILL.md", "second adaptation\n");
  await put(edited, "literal[1].txt", "literal filename\n");
  await writeFile(path.join(edited, "binary.bin"), Buffer.from([0, 255, 10, 13, 0]));
  await chmod(path.join(edited, "run.sh"), 0o644);
  await rm(path.join(edited, "link"));
  await symlink("run.sh", path.join(edited, "link"));
  await put(f.root, "patches/001.patch", patch);
  await put(
    f.root,
    "patches/002.patch",
    "--- a/base.txt\n+++ b/base.txt\n@@ -1 +1 @@\n-adapted\n+intermediate\n",
  );
  await rm(f.remote, { recursive: true });
  success(f.run("patches", edited));
  assert.deepEqual(await activeState(f.root), before);
  assert.deepEqual(
    (await readdir(path.join(f.root, "patches"), { recursive: true }))
      .filter((name) => name.endsWith(".patch"))
      .sort(),
    [
      "base.txt.patch",
      "binary.bin.patch",
      "link.patch",
      "literal[1].txt.patch",
      "run.sh.patch",
      "skills/first/SKILL.md.patch",
      "skills/é space/SKILL.md.patch",
    ],
  );
  const basePatch = await readFile(path.join(f.root, "patches/base.txt.patch"), "utf8");
  assert.match(basePatch, /-pinned\n\+final {2}\n/);
  assert.doesNotMatch(basePatch, /adapted|intermediate/);
  const firstPatches = await treeId(path.join(f.root, "patches"));
  success(f.run("patches", edited));
  assert.equal(await treeId(path.join(f.root, "patches")), firstPatches);
  success(f.run("generate"));
  success(f.run("verify"));
  assert.equal(await treeId(path.join(f.root, "content/pstack")), await treeId(edited));
  assert.deepEqual(
    await readFile(path.join(f.root, "content/pstack/binary.bin")),
    Buffer.from([0, 255, 10, 13, 0]),
  );
  assert.equal((await stat(path.join(f.root, "content/pstack/run.sh"))).mode & 0o111, 0);
  assert.equal(await readlink(path.join(f.root, "content/pstack/link")), "run.sh");
  assert.equal(await readFile(path.join(f.root, "upstream/pstack/base.txt"), "utf8"), "pinned\n");
  await put(edited, "base.txt", "later\n");
  success(f.run("patches", edited));
  const updated = await readFile(path.join(f.root, "patches/base.txt.patch"), "utf8");
  assert.match(updated, /-pinned\n\+later/);
  assert.doesNotMatch(updated, /final/);
  await put(edited, "base.txt", "pinned\n");
  await rm(path.join(edited, "literal[1].txt"));
  success(f.run("patches", edited));
  await assert.rejects(readFile(path.join(f.root, "patches/base.txt.patch")), { code: "ENOENT" });
  await assert.rejects(readFile(path.join(f.root, "patches/literal[1].txt.patch")), {
    code: "ENOENT",
  });
  success(f.run("generate"));
  assert.equal(await readFile(path.join(f.root, "content/pstack/base.txt"), "utf8"), "pinned\n");
  await assert.rejects(readFile(path.join(f.root, "content/pstack/literal[1].txt")), {
    code: "ENOENT",
  });
});

await test("refresh removes a maintained patch when its upstream file is explicitly excluded", async (t) => {
  const f = await fixture(t);
  await put(f.root, "patches/base.txt.patch", patch);
  success(f.run("generate"));
  const edited = path.join(f.root, "edited");
  await cp(path.join(f.root, "content/pstack"), edited, {
    recursive: true,
    verbatimSymlinks: true,
  });
  await rm(path.join(edited, "base.txt"));
  await put(f.root, "upstream-exclusions.txt", "base.txt");
  success(f.run("patches", edited));
  assert.deepEqual(await readdir(path.join(f.root, "patches")), []);
  success(f.run("generate"));
  success(f.run("verify"));
  await assert.rejects(readFile(path.join(f.root, "content/pstack/base.txt")), { code: "ENOENT" });
  assert.equal(await readFile(path.join(f.root, "upstream/pstack/base.txt"), "utf8"), "pinned\n");
});

await test("refreshed nested patches preserve unrelated changes when preparing a newer upstream", async (t) => {
  const f = await fixture(t);
  success(f.run("generate"));
  const edited = path.join(f.root, "edited");
  await cp(path.join(f.root, "content/pstack"), edited, {
    recursive: true,
    verbatimSymlinks: true,
  });
  await put(
    edited,
    "skills/example/SKILL.md",
    "Pi heading\nkeep 1\nkeep 2\nkeep 3\nkeep 4\nkeep 5\nkeep 6\nOriginal tail\n",
  );
  success(f.run("patches", edited));
  success(f.run("generate"));
  const before = await activeState(f.root);
  const patches = await treeId(path.join(f.root, "patches"));
  await put(
    f.remote,
    "pstack/skills/example/SKILL.md",
    "Heading\nkeep 1\nkeep 2\nkeep 3\nkeep 4\nkeep 5\nkeep 6\nUpdated upstream tail\n",
  );
  f.git("add", ".");
  f.git("commit", "--quiet", "-m", "unrelated upstream edit");
  success(f.run("prepare-update", f.git("rev-parse", "HEAD")));
  const candidate = await candidateDirectory(f.root);
  assert.equal(
    await readFile(path.join(candidate, "content/pstack/skills/example/SKILL.md"), "utf8"),
    "Pi heading\nkeep 1\nkeep 2\nkeep 3\nkeep 4\nkeep 5\nkeep 6\nUpdated upstream tail\n",
  );
  assert.equal(await treeId(path.join(f.root, "patches")), patches);
  assert.deepEqual(await activeState(f.root), before);
});

await test("patch ownership rejects wrong paths, multiple targets, renames, and whole-file deletions without replacing content", async (t) => {
  const f = await fixture(t);
  success(f.run("generate"));
  const before = await treeId(path.join(f.root, "content/pstack"));

  const cases = [
    ["wrong.txt.patch", patch],
    ["base.txt.patch", `${patch}--- /dev/null\n+++ b/extra.txt\n@@ -0,0 +1 @@\n+extra\n`],
    [
      "renamed.txt.patch",
      "diff --git a/base.txt b/renamed.txt\nsimilarity index 100%\nrename from base.txt\nrename to renamed.txt\n",
    ],
    ["base.txt.patch", "--- a/base.txt\n+++ /dev/null\n@@ -1 +0,0 @@\n-pinned\n"],
  ];

  for (const [name, body] of cases) {
    assert.ok(name !== undefined && body !== undefined);
    await rm(path.join(f.root, "patches"), { recursive: true });
    await put(f.root, `patches/${name}`, body);
    const result = f.run("generate");
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Patch must modify or add only/);
    assert.equal(await treeId(path.join(f.root, "content/pstack")), before);
  }
});

await test("patch discovery rejects symlinks and stray files but supports an empty patch collection", async (t) => {
  const f = await fixture(t);
  success(f.run("generate"));
  const before = await activeState(f.root);
  await put(f.root, "external/base.txt.patch", patch);
  await symlink("../external/base.txt.patch", path.join(f.root, "patches/base.txt.patch"));
  assert.match(f.run("generate").stderr, /Expected a regular .patch file/);
  await rm(path.join(f.root, "patches/base.txt.patch"));
  await symlink("../external", path.join(f.root, "patches/linked"));
  assert.match(f.run("generate").stderr, /Expected a regular .patch file/);
  await rm(path.join(f.root, "patches/linked"));
  await put(f.root, "patches/stray.txt", "not a patch\n");
  assert.match(f.run("generate").stderr, /Expected a regular .patch file/);
  await rm(path.join(f.root, "patches"), { recursive: true });
  await symlink("external", path.join(f.root, "patches"));
  assert.match(f.run("generate").stderr, /patches must be a directory/);
  await rm(path.join(f.root, "patches"));
  success(f.run("generate"));
  success(f.run("verify"));
  success(f.run("patches", path.join(f.root, "content/pstack")));
  assert.deepEqual(await readdir(path.join(f.root, "patches")), []);
  assert.deepEqual(await activeState(f.root), before);
});

await test("invalid edited trees leave patches, generated content, and pinned sources unchanged", async (t) => {
  const f = await fixture(t);
  await put(f.root, "upstream-exclusions.txt", "retired/");
  await put(f.root, "patches/base.txt.patch", patch);
  success(f.run("generate"));
  const before = await activeState(f.root);
  const patches = await treeId(path.join(f.root, "patches"));
  const edited = path.join(f.root, "edited");

  for (const change of [
    "deletion",
    "companion",
    "license",
    "companion addition",
    "excluded path",
  ]) {
    await rm(edited, { recursive: true, force: true });
    await cp(path.join(f.root, "content/pstack"), edited, {
      recursive: true,
      verbatimSymlinks: true,
    });

    if (change === "deletion") await rm(path.join(edited, "base.txt"));

    if (change === "companion") await put(edited, "skills/deslop/SKILL.md", "changed\n");

    if (change === "license") await put(edited, "licenses/cursor-team-kit.LICENSE", "changed\n");

    if (change === "companion addition") await put(edited, "skills/deslop/extra.txt", "extra\n");

    if (change === "excluded path") await put(edited, "retired/restored.txt", "restored\n");
    assert.notEqual(f.run("patches", edited).status, 0, change);
    assert.equal(await treeId(path.join(f.root, "patches")), patches, change);
    assert.deepEqual(await activeState(f.root), before, change);
  }

  assert.notEqual(f.run("patches").status, 0);
  assert.notEqual(f.run("patches", path.join(f.root, "missing")).status, 0);
  assert.equal(await treeId(path.join(f.root, "patches")), patches);
  assert.deepEqual(await activeState(f.root), before);
});

await test("generate and verify work without upstream Git objects, preserve source identity, and detect drift", async (t) => {
  const f = await fixture(t);
  await rm(f.remote, { recursive: true, force: true });
  await put(f.root, "patches/base.txt.patch", patch);
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

await test("companion bytes, snapshot and generated drift, missing inputs, and PStack collisions are guarded", async (t) => {
  const f = await fixture(t);
  success(f.run("generate"));

  for (const name of ["deslop", "control-cli", "control-ui"])
    assert.equal(
      await treeId(path.join(f.root, "content/pstack/skills", name)),
      await treeId(path.join(f.root, "upstream/cursor-team-kit/skills", name)),
    );
  assert.equal(
    await readFile(path.join(f.root, "content/pstack/licenses/cursor-team-kit.LICENSE"), "utf8"),
    "toolkit license\n",
  );

  await put(f.root, "content/pstack/skills/deslop/SKILL.md", "generated drift\n");
  assert.match(f.run("verify").stderr, /Generated drift/);
  success(f.run("generate"));
  await rm(path.join(f.root, "upstream/cursor-team-kit/skills/control-ui"), { recursive: true });
  assert.notEqual(f.run("verify").status, 0);

  await cp(
    path.join(f.remote, "cursor-team-kit/skills/control-ui"),
    path.join(f.root, "upstream/cursor-team-kit/skills/control-ui"),
    { recursive: true },
  );
  await put(
    f.root,
    "patches/skills/deslop/SKILL.md.patch",
    "--- /dev/null\n+++ b/skills/deslop/SKILL.md\n@@ -0,0 +1 @@\n+adapted collision\n",
  );
  assert.match(f.run("generate").stderr, /Companion destination collision/);
});

await test("upstream check and preparation expose changes and new version without changing active files", async (t) => {
  const f = await fixture(t);
  await put(f.root, "patches/base.txt.patch", patch);
  success(f.run("generate"));
  const before = await activeState(f.root);
  await put(f.remote, "pstack/.cursor-plugin/plugin.json", '{"version":"2.0.0"}\n');
  await put(f.remote, "pstack/new.txt", "new upstream evidence\n");
  await put(f.remote, "cursor-team-kit/.cursor-plugin/plugin.json", '{"version":"1.3.0"}\n');
  await put(f.remote, "cursor-team-kit/skills/deslop/SKILL.md", "updated selected method\n");
  await put(f.remote, "cursor-team-kit/README.md", "unselected toolkit change\n");
  f.git("add", ".");
  f.git("commit", "--quiet", "-m", "new source");
  const next = f.git("rev-parse", "HEAD");
  const check = success(f.run("check-upstream"));
  assert.match(check, /new upstream evidence/);
  assert.match(check, /updated selected method/);
  assert.doesNotMatch(check, /unselected toolkit change/);
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
    cursorTeamKit: {
      sourceTree: f.git("rev-parse", `${next}:cursor-team-kit`),
      selectedTree: await treeId(path.join(candidate, "upstream/cursor-team-kit")),
      version: "1.3.0",
    },
  });
  assert.equal(
    await readFile(path.join(candidate, "content/pstack/base.txt"), "utf8"),
    "adapted\n",
  );
  assert.match(
    await readFile(path.join(candidate, "upstream.diff"), "utf8"),
    /new upstream evidence/,
  );
  assert.equal(
    await readFile(path.join(candidate, "upstream/cursor-team-kit/skills/deslop/SKILL.md"), "utf8"),
    "updated selected method\n",
  );
  assert.equal(
    await readFile(path.join(candidate, "content/pstack/skills/deslop/SKILL.md"), "utf8"),
    "updated selected method\n",
  );
  assert.equal(
    await readFile(path.join(candidate, "content/pstack/licenses/cursor-team-kit.LICENSE"), "utf8"),
    "toolkit license\n",
  );
  assert.deepEqual(await activeState(f.root), before);
});

await test("upstream comparison uses pinned selected files and preparation requires skill bodies", async (t) => {
  const f = await fixture(t);
  success(f.run("generate"));
  await put(f.remote, "cursor-team-kit/unselected.txt", "unselected payload\n".repeat(150_000));
  f.git("add", ".");
  f.git("commit", "--quiet", "-m", "unselected toolkit change");
  await put(f.root, "upstream/cursor-team-kit/skills/deslop/SKILL.md", "local drift sentinel\n");
  const before = await activeState(f.root);
  const check = success(f.run("check-upstream"));
  assert.match(check, /"selectedCursorTeamKitChanged": false/);
  assert.doesNotMatch(check, /local drift sentinel|unselected payload/);
  assert.deepEqual(await activeState(f.root), before);

  await put(f.remote, "cursor-team-kit/skills/control-ui/README.md", "not a skill body\n");
  await rm(path.join(f.remote, "cursor-team-kit/skills/control-ui/SKILL.md"));
  f.git("add", ".");
  f.git("commit", "--quiet", "-m", "remove a required skill body");
  const preparation = f.run("prepare-update", f.git("rev-parse", "HEAD"));
  assert.notEqual(preparation.status, 0);
  const failedCandidate = await candidateDirectory(f.root);
  assert.match(await readFile(path.join(failedCandidate, "failure.txt"), "utf8"), /SKILL.md/);
  assert.deepEqual(await activeState(f.root), before);
});

await test("literal exclusions preserve the snapshot and replay across edits to excluded upstream content", async (t) => {
  const f = await fixture(t);
  await put(f.root, "upstream-exclusions.txt", "# local scope\nretired/\nomit.txt\nlink\n\n");
  await put(f.root, "patches/base.txt.patch", patch);
  success(f.run("generate"));
  success(f.run("verify"));
  const expected = [".cursor-plugin", "base.txt", "licenses", "retired-link", "run.sh", "skills"];
  assert.deepEqual((await readdir(path.join(f.root, "content/pstack"))).sort(), expected);
  assert.equal(await readFile(path.join(f.root, "content/pstack/base.txt"), "utf8"), "adapted\n");
  assert.equal(await readlink(path.join(f.root, "upstream/pstack/link")), "base.txt");
  assert.equal(
    await readFile(path.join(f.root, "upstream/pstack/retired/old.txt"), "utf8"),
    "retired implementation v1\n",
  );
  const display = success(f.run("diff"));
  assert.match(display, /deleted file mode/);
  assert.doesNotMatch(display, /retired implementation v1/);
  const before = await activeState(f.root);
  await put(f.remote, "pstack/retired/old.txt", "changed excluded implementation\n");
  await put(f.remote, "pstack/retired/new.txt", "new excluded file\n");
  f.git("add", ".");
  f.git("commit", "--quiet", "-m", "excluded changes");
  success(f.run("prepare-update", f.git("rev-parse", "HEAD")));
  const candidate = await candidateDirectory(f.root);
  assert.deepEqual((await readdir(path.join(candidate, "content/pstack"))).sort(), expected);
  assert.equal(
    await readFile(path.join(candidate, "upstream/pstack/retired/new.txt"), "utf8"),
    "new excluded file\n",
  );
  assert.deepEqual(await activeState(f.root), before);
});

await test("invalid exclusion paths and patch recreation fail before replacing active content", async (t) => {
  const f = await fixture(t);
  success(f.run("generate"));
  const before = await activeState(f.root);

  const cases = [
    ["/", /Invalid path/],
    ["/tmp/elsewhere", /Invalid path/],
    [".", /Invalid path/],
    ["../elsewhere", /Invalid path/],
    ["retired/../base.txt", /Invalid path/],
    ["retired//old.txt", /Invalid path/],
    ["retired\\old.txt", /Invalid path/],
    ["retired/*", /Cannot inspect exclusion/],
    ["missing.txt", /Cannot inspect exclusion/],
    ["retired/\nretired/old.txt", /Overlapping paths/],
    ["retired/old.txt\nretired", /Overlapping paths/],
    ["retired\nretired/", /Overlapping paths/],
    ["retired-link/old.txt", /traverses a symlink/],
  ] as const;

  for (const [entry, message] of cases) {
    await put(f.root, "upstream-exclusions.txt", entry);
    const result = f.run("generate");
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, message);
    assert.deepEqual(await activeState(f.root), before);
  }

  await rm(path.join(f.root, "upstream-exclusions.txt"));
  assert.notEqual(
    f.run("generate").status,
    0,
    "a missing manifest is not an empty exclusion policy",
  );
  await put(f.root, "upstream-exclusions.txt", "retired/");
  await put(
    f.root,
    "patches/retired/restored.txt.patch",
    "--- /dev/null\n+++ b/retired/restored.txt\n@@ -0,0 +1 @@\n+restored\n",
  );
  const restored = f.run("generate");
  assert.notEqual(restored.status, 0);
  assert.match(restored.stderr, /patch restored excluded path retired/);
  assert.deepEqual(await activeState(f.root), before);
  assert.equal(
    await readFile(path.join(f.root, "upstream/pstack/retired/old.txt"), "utf8"),
    "retired implementation v1\n",
  );
});

await test("upstream renaming an excluded path fails preparation with evidence and unchanged active files", async (t) => {
  const f = await fixture(t);
  await put(f.root, "upstream-exclusions.txt", "retired/");
  success(f.run("generate"));
  const before = await activeState(f.root);
  f.git("mv", "pstack/retired", "pstack/renamed");
  f.git("commit", "--quiet", "-m", "renamed excluded path");
  const result = f.run("prepare-update", f.git("rev-parse", "HEAD"));
  assert.notEqual(result.status, 0);
  const candidate = await candidateDirectory(f.root);
  assert.match(
    await readFile(path.join(candidate, "failure.txt"), "utf8"),
    /Cannot inspect exclusion retired/,
  );
  assert.deepEqual(await activeState(f.root), before);
});

await test("patch conflicts fail preparation with retained evidence and leave active files unchanged", async (t) => {
  const f = await fixture(t);
  await put(f.root, "patches/base.txt.patch", patch);
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
    /Cannot replay patches\/base.txt.patch/,
  );
  assert.match(
    await readFile(path.join(candidate, "upstream.diff"), "utf8"),
    /incompatible upstream change/,
  );
  assert.deepEqual(await activeState(f.root), before);
});
