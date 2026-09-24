import type { Dirent } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  contentDiff,
  copyTree,
  readLock,
  replay,
  temporary,
  treeId,
  verifySnapshot,
} from "./source-files.ts";
import { checkUpstream, prepareUpdate } from "./upstream.ts";

const root = fileURLToPath(new URL("..", import.meta.url));

async function build(staging: string) {
  const content = path.join(staging, "content/pstack");
  await replay(root, path.join(root, "upstream/pstack"), content);
}

async function generate() {
  await verifySnapshot(root, await readLock(root));
  await temporary("pstack-generate-", async (staging) => {
    await build(staging);

    for (const relative of ["content/pstack"]) {
      const target = path.join(root, relative);
      await rm(target, { recursive: true, force: true });
      await copyTree(path.join(staging, relative), target);
    }
  });
  console.log("Generated content/pstack and agents from the pinned source and patches.");
}

async function verify() {
  await verifySnapshot(root, await readLock(root));
  await temporary("pstack-verify-", async (staging) => {
    await build(staging);

    for (const relative of ["content/pstack"]) {
      const actual = await treeId(path.join(root, relative));
      const expected = await treeId(path.join(staging, relative));

      if (actual !== expected)
        throw new Error(
          `Generated drift in ${relative}; run source:generate. Do not edit generated files.`,
        );
    }
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
  console.log("Pi content adaptations (upstream -> generated):");
  console.log(
    (await contentDiff(path.join(root, "upstream/pstack"), path.join(root, "content/pstack"))) ||
      "(none)",
  );
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
