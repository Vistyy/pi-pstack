import type { Dirent } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  composeKitSnapshot,
  contentDiff,
  copyTree,
  kitSkills,
  readLock,
  replay,
  temporary,
  treeId,
  verifyKitSnapshot,
  verifySnapshot,
} from "./source-files.ts";
import { checkUpstream, prepareUpdate } from "./upstream.ts";

const root = fileURLToPath(new URL("..", import.meta.url));

async function build(staging: string) {
  const content = path.join(staging, "content/pstack");
  await replay(root, path.join(root, "upstream/pstack"), content);
  await composeKitSnapshot(path.join(root, "upstream/cursor-team-kit"), content);
}

async function generate() {
  const lock = await readLock(root);
  await verifySnapshot(root, lock);
  await verifyKitSnapshot(root, lock);
  await temporary("pstack-generate-", async (staging) => {
    await build(staging);

    const target = path.join(root, "content/pstack");
    await rm(target, { recursive: true, force: true });
    await copyTree(path.join(staging, "content/pstack"), target);
  });
  console.log("Generated content/pstack from the pinned source, exclusions, and patches.");
}

async function verify() {
  const lock = await readLock(root);
  await verifySnapshot(root, lock);
  await verifyKitSnapshot(root, lock);
  await temporary("pstack-verify-", async (staging) => {
    await build(staging);

    const actual = await treeId(path.join(root, "content/pstack"));
    const expected = await treeId(path.join(staging, "content/pstack"));

    if (actual !== expected)
      throw new Error(
        "Generated drift in content/pstack; run source:generate. Do not edit generated files.",
      );
  });
  console.log("Source snapshot and generated content verified, without fetching upstream.");
}

async function ownedFiles(directory: string, relative = ""): Promise<string[]> {
  let entries: Dirent[];

  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }

  const files: string[] = [];

  for (const entry of entries) {
    const name = path.join(relative, entry.name);

    if (entry.isDirectory())
      files.push(...(await ownedFiles(path.join(directory, entry.name), name)));
    else files.push(name);
  }

  return files.sort();
}

async function diff() {
  console.log(
    "Pi content adaptations (upstream -> generated; whole-file deletions shown as headers):",
  );
  console.log("Review display only, not a replayable patch.\n");
  console.log(
    (await contentDiff(path.join(root, "upstream/pstack"), path.join(root, "content/pstack"))) ||
      "(none)",
  );
  console.log("\nSelected Cursor Team Kit additions (not unselected toolkit content):");

  for (const skill of kitSkills) console.log(`skills/${skill}`);
  console.log("\nPi-owned implementation files (not upstream translations):");

  for (const directory of ["extensions", "src", "instructions", "scripts"]) {
    for (const file of await ownedFiles(path.join(root, directory), directory)) console.log(file);
  }
}

async function main(command: string, argument: string | undefined) {
  switch (command) {
    case "generate":
      return generate();
    case "verify":
      return verify();
    case "diff":
      return diff();
    case "check-upstream":
      return checkUpstream(root, argument);
    case "prepare-update":
      return prepareUpdate(root, argument);
    default:
      throw new Error(
        "Usage: source.ts generate|verify|diff|check-upstream [ref]|prepare-update <full-sha>",
      );
  }
}

try {
  await main(process.argv[2] ?? "", process.argv[3]);
} catch (error) {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
}
