import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  composeKitSnapshot,
  contentDiff,
  copyTree,
  git,
  kitSkills,
  pluginVersion,
  readLock,
  replay,
  treeId,
  type UpstreamLock,
  unpack,
} from "./source-files.ts";

async function selectedKit(cache: string, commit: string, destination: string) {
  await unpack(cache, `${commit}:cursor-team-kit`, destination, [
    "LICENSE",
    ".cursor-plugin/plugin.json",
    ...kitSkills.map((skill) => `skills/${skill}`),
  ]);
}

async function workspace(root: string, prefix: string) {
  const work = path.join(root, ".work");
  await mkdir(work, { recursive: true });

  return mkdtemp(path.join(work, prefix));
}

async function fetchSource(directory: string, lock: UpstreamLock, ref: string) {
  if (ref === "" || ref.startsWith("-"))
    throw new Error("An upstream ref must not be empty or an option.");
  git(directory, ["init", "--quiet", "--bare", "source.git"]);
  const cache = path.join(directory, "source.git");
  git(cache, ["fetch", "--no-tags", "--depth=1", lock.repository, ref]);
  const commit = git(cache, ["rev-parse", "FETCH_HEAD^{commit}"]);
  git(cache, ["fetch", "--no-tags", "--depth=1", lock.repository, lock.commit]);
  const tree = git(cache, ["rev-parse", `${commit}:${lock.path}`]);
  const kitSourceTree = git(cache, ["rev-parse", `${commit}:cursor-team-kit`]);

  const changes = git(cache, [
    "diff",
    "--binary",
    `${lock.commit}:${lock.path}`,
    `${commit}:${lock.path}`,
  ]);

  const toolkit = path.join(directory, "selected-kit");
  const beforeKit = path.join(directory, "selected-kit-before");
  await selectedKit(cache, commit, toolkit);
  await selectedKit(cache, lock.commit, beforeKit);
  const kitChanges = await contentDiff(beforeKit, toolkit);
  await writeFile(path.join(directory, "upstream.diff"), changes === "" ? "" : `${changes}\n`);
  await writeFile(path.join(directory, "cursor-team-kit.diff"), kitChanges);

  return { cache, commit, tree, kitSourceTree, toolkit, changes, kitChanges };
}

export async function checkUpstream(root: string, ref = "main") {
  const lock = await readLock(root);
  const directory = await workspace(root, "check-");
  const source = await fetchSource(directory, lock, ref);

  const report = {
    pinned: {
      commit: lock.commit,
      tree: lock.tree,
      version: lock.version,
      cursorTeamKit: lock.cursorTeamKit,
    },
    requested: {
      ref,
      commit: source.commit,
      tree: source.tree,
      cursorTeamKitSourceTree: source.kitSourceTree,
    },
    changed: source.tree !== lock.tree,
    selectedCursorTeamKitChanged: source.kitChanges !== "",
    diff: path.join(directory, "upstream.diff"),
    selectedCursorTeamKitDiff: path.join(directory, "cursor-team-kit.diff"),
  };

  await writeFile(path.join(directory, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  console.log(source.changes === "" ? "No PStack subtree changes." : source.changes);
  console.log(`Selected Cursor Team Kit changes:\n${source.kitChanges || "(none)"}`);
}

export async function prepareUpdate(root: string, revision: string | undefined) {
  if (revision === undefined || !/^[a-f0-9]{40}$/.test(revision))
    throw new Error("prepare-update requires a full lowercase commit SHA.");
  const lock = await readLock(root);
  const directory = await workspace(root, `candidate-${revision.slice(0, 12)}-`);

  try {
    const source = await fetchSource(directory, lock, revision);

    if (source.commit !== revision)
      throw new Error("Fetched identity does not match the requested commit.");
    const snapshot = path.join(directory, "upstream/pstack");
    await unpack(source.cache, `${source.commit}:${lock.path}`, snapshot);
    const kitSnapshot = path.join(directory, "upstream/cursor-team-kit");
    await copyTree(source.toolkit, kitSnapshot);

    const candidate = {
      ...lock,
      commit: source.commit,
      tree: source.tree,
      version: await pluginVersion(snapshot),
      cursorTeamKit: {
        sourceTree: source.kitSourceTree,
        selectedTree: await treeId(kitSnapshot),
        version: await pluginVersion(kitSnapshot),
      },
    };

    await writeFile(
      path.join(directory, "upstream.lock.json"),
      `${JSON.stringify(candidate, null, 2)}\n`,
    );
    const generated = path.join(directory, "content/pstack");
    await replay(root, snapshot, generated);
    await composeKitSnapshot(kitSnapshot, generated);
    await writeFile(
      path.join(directory, "result.json"),
      `${JSON.stringify({ status: "prepared", semanticReview: "required" }, null, 2)}\n`,
    );
    console.log(
      `Candidate: ${directory}\nExclusions and patch replay succeeded; semantic review is still required. Active source, lock, and content are unchanged.`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.stack : String(error);
    await writeFile(path.join(directory, "failure.txt"), `${message}\n`);
    throw new Error(
      `Candidate preparation failed. Evidence: ${directory}. Active source, lock, and content are unchanged.`,
      { cause: error },
    );
  }
}
