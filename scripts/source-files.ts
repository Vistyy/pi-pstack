import { execFileSync } from "node:child_process";
import { cp, lstat, mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export type UpstreamLock = {
  repository: string;
  path: "pstack";
  commit: string;
  tree: string;
  version: string;
  cursorTeamKit: {
    sourceTree: string;
    selectedTree: string;
    version: string;
  };
};

export function git(cwd: string, args: string[]) {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  }).trimEnd();
}

export async function temporary<T>(prefix: string, use: (directory: string) => T | Promise<T>) {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));

  try {
    return await use(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function copyTree(source: string, destination: string) {
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(source, destination, {
    recursive: true,
    dereference: false,
    verbatimSymlinks: true,
  });
}

/* oxlint-disable anti-slop/no-runtime-typeof -- This standalone CLI decodes external JSON at the file boundary without runtime package dependencies. */
export async function readLock(root: string): Promise<UpstreamLock> {
  const lock: unknown = JSON.parse(await readFile(path.join(root, "upstream.lock.json"), "utf8"));

  if (
    typeof lock !== "object" ||
    lock === null ||
    !("repository" in lock) ||
    !("commit" in lock) ||
    !("tree" in lock) ||
    !("path" in lock) ||
    !("version" in lock)
  )
    throw new Error("Invalid upstream.lock.json: missing source identity fields.");

  const { repository, commit, tree, version, path: subtree } = lock;

  if (
    typeof repository !== "string" ||
    repository.trim() === "" ||
    typeof commit !== "string" ||
    !/^[a-f0-9]{40}$/.test(commit) ||
    typeof tree !== "string" ||
    !/^[a-f0-9]{40}$/.test(tree) ||
    typeof version !== "string" ||
    subtree !== "pstack"
  )
    throw new Error("Invalid upstream.lock.json: expected an exact PStack source identity.");

  if (
    !("cursorTeamKit" in lock) ||
    typeof lock.cursorTeamKit !== "object" ||
    lock.cursorTeamKit === null ||
    !("sourceTree" in lock.cursorTeamKit) ||
    !("selectedTree" in lock.cursorTeamKit) ||
    !("version" in lock.cursorTeamKit)
  )
    throw new Error("Invalid upstream.lock.json: missing cursorTeamKit identity.");

  const kit = lock.cursorTeamKit;

  if (
    typeof kit.sourceTree !== "string" ||
    !/^[a-f0-9]{40}$/.test(kit.sourceTree) ||
    typeof kit.selectedTree !== "string" ||
    !/^[a-f0-9]{40}$/.test(kit.selectedTree) ||
    typeof kit.version !== "string"
  )
    throw new Error("Invalid cursorTeamKit identity.");

  return {
    repository,
    commit,
    tree,
    version,
    path: subtree,
    cursorTeamKit: {
      sourceTree: kit.sourceTree,
      selectedTree: kit.selectedTree,
      version: kit.version,
    },
  };
}
/* oxlint-enable anti-slop/no-runtime-typeof */

function writeTree(repository: string, directory: string) {
  const args = [
    "--git-dir",
    repository,
    "--work-tree",
    directory,
    "-c",
    "core.autocrlf=false",
    "-c",
    "core.filemode=true",
  ];

  git(directory, [...args, "add", "--force", "--all", "--", "."]);

  return git(directory, [...args, "write-tree"]);
}

async function treeRepository<T>(use: (repository: string) => T | Promise<T>) {
  return temporary("pstack-tree-", async (workspace) => {
    git(workspace, ["init", "--quiet", "--bare", "objects.git"]);

    return use(path.join(workspace, "objects.git"));
  });
}

export async function treeId(directory: string) {
  return treeRepository((repository) => writeTree(repository, directory));
}

export async function contentDiff(source: string, generated: string) {
  return treeRepository((repository) => {
    const before = writeTree(repository, source);
    const after = writeTree(repository, generated);

    return git(repository, ["diff", "--binary", "--irreversible-delete", before, after]);
  });
}

/* oxlint-disable anti-slop/no-runtime-typeof -- Decode the external plugin manifest at its file boundary. */
export async function pluginVersion(directory: string) {
  const manifest: unknown = JSON.parse(
    await readFile(path.join(directory, ".cursor-plugin/plugin.json"), "utf8"),
  );

  if (
    typeof manifest !== "object" ||
    manifest === null ||
    !("version" in manifest) ||
    typeof manifest.version !== "string" ||
    manifest.version === ""
  ) {
    throw new Error("Upstream plugin manifest has no version.");
  }

  return manifest.version;
}
/* oxlint-enable anti-slop/no-runtime-typeof */

export const kitSkills = ["deslop", "control-cli", "control-ui"] as const;

export async function verifyKitSnapshot(root: string, lock: UpstreamLock) {
  const snapshot = path.join(root, "upstream/cursor-team-kit");
  const manifest = await pluginVersion(snapshot);

  if (manifest !== lock.cursorTeamKit.version)
    throw new Error("Cursor Team Kit manifest version differs from upstream.lock.json.");
  const selectedTree = await treeId(snapshot);

  if (selectedTree !== lock.cursorTeamKit.selectedTree)
    throw new Error("Selected Cursor Team Kit snapshot differs from its locked Git tree.");

  for (const skill of kitSkills) {
    const skillPath = path.join(snapshot, "skills", skill);

    if (!(await lstat(skillPath)).isDirectory())
      throw new Error(`Missing selected skill: ${skill}`);
  }
}

async function copyCompanion(source: string, destination: string) {
  try {
    await lstat(destination);
    throw new Error(`Companion destination collision: ${destination}`);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }

  await copyTree(source, destination);
}

export async function composeKitSnapshot(snapshot: string, target: string) {
  for (const skill of kitSkills) {
    const source = path.join(snapshot, "skills", skill);

    if (!(await lstat(path.join(source, "SKILL.md"))).isFile())
      throw new Error(`Missing selected skill body: ${skill}`);
    await copyCompanion(source, path.join(target, "skills", skill));
  }

  await copyCompanion(
    path.join(snapshot, "LICENSE"),
    path.join(target, "licenses/cursor-team-kit.LICENSE"),
  );
}

export async function verifySnapshot(root: string, lock: UpstreamLock) {
  const snapshot = path.join(root, "upstream/pstack");

  if ((await treeId(snapshot)) !== lock.tree) {
    throw new Error(
      "Upstream snapshot differs from its locked Git tree. Do not edit upstream/pstack.",
    );
  }

  if ((await pluginVersion(snapshot)) !== lock.version) {
    throw new Error("Upstream snapshot version differs from upstream.lock.json.");
  }
}

export async function patchNames(root: string) {
  const entries = await readdir(path.join(root, "patches"));

  return entries.filter((name) => name.endsWith(".patch")).sort();
}

async function excludePaths(root: string, target: string) {
  const manifest = await readFile(path.join(root, "upstream-exclusions.txt"), "utf8");

  const entries = manifest
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));

  const excluded: string[] = [];

  for (const entry of entries) {
    const relative = entry.replace(/\/$/, "");
    const parts = relative.split("/");

    if (
      relative.includes("\\") ||
      parts.some((part) => part === "" || part === "." || part === "..")
    )
      throw new Error(`Invalid path in upstream-exclusions.txt: ${entry}`);

    if (
      excluded.some(
        (other) =>
          relative === other ||
          relative.startsWith(`${other}/`) ||
          other.startsWith(`${relative}/`),
      )
    )
      throw new Error(`Overlapping paths in upstream-exclusions.txt: ${entry}`);

    const destination = path.join(target, relative);
    let current = target;

    for (const part of parts) {
      current = path.join(current, part);

      const info = await lstat(current).catch((error: unknown) => {
        throw new Error(`Cannot inspect exclusion ${entry}: ${String(error)}`, { cause: error });
      });

      if (current !== destination && info.isSymbolicLink())
        throw new Error(`Exclusion traverses a symlink: ${entry}`);
    }

    excluded.push(relative);
  }

  for (const relative of excluded) await rm(path.join(target, relative), { recursive: true });

  return excluded;
}

export async function replay(root: string, snapshot: string, target: string) {
  await copyTree(snapshot, target);
  const excluded = await excludePaths(root, target);
  await temporary("pstack-patch-", async (workspace) => {
    git(workspace, ["init", "--quiet", "--bare", "objects.git"]);
    const args = ["--git-dir", path.join(workspace, "objects.git"), "--work-tree", target];

    for (const name of await patchNames(root)) {
      const patch = path.join(root, "patches", name);

      try {
        git(target, [...args, "apply", "--check", patch]);
        git(target, [...args, "apply", patch]);
      } catch (error) {
        throw new Error(
          `Cannot replay patches/${name}; inspect the upstream change rather than skipping the patch.`,
          { cause: error },
        );
      }
    }
  });

  for (const relative of excluded) {
    try {
      await lstat(path.join(target, relative));
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") continue;
      throw error;
    }

    throw new Error(
      `A patch restored excluded path ${relative}; reconcile it with upstream-exclusions.txt.`,
    );
  }
}

export async function unpack(
  cache: string,
  revision: string,
  destination: string,
  paths: string[] = [],
) {
  await mkdir(destination, { recursive: true });

  const archive = execFileSync("git", ["-C", cache, "archive", revision, ...paths], {
    maxBuffer: 128 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });

  execFileSync("tar", ["-xf", "-", "-C", destination], {
    input: archive,
    stdio: ["pipe", "pipe", "pipe"],
  });
}
