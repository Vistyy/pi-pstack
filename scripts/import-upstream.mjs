import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lockPath = path.join(root, "upstream.lock.json");
const lock = JSON.parse(readFileSync(lockPath, "utf8"));
const requested = process.argv[2] ?? lock.commit;

if (!/^[0-9a-f]{40}$/.test(requested)) {
  throw new Error("Usage: node scripts/import-upstream.mjs <40-character-upstream-commit>");
}

function git(args, options = {}) {
  const output = execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    stdio: options.inherit ? "inherit" : ["ignore", "pipe", "pipe"],
  });
  return typeof output === "string" ? output.trim() : "";
}

const occupied = git(["worktree", "list", "--porcelain"])
  .split("\n\n")
  .some((entry) => entry.includes("branch refs/heads/vendor/pstack"));
if (occupied) {
  throw new Error("vendor/pstack is checked out in a worktree. Remove that worktree before importing.");
}

const fetchRef = "refs/pstack-import/source";
try {
  git(["fetch", "--no-tags", lock.repository, `+${requested}:${fetchRef}`], { inherit: true });
  const fetched = git(["rev-parse", `${fetchRef}^{commit}`]);
  if (fetched !== requested) {
    throw new Error(`Fetched ${fetched}, expected ${requested}.`);
  }

  const sourceTree = git(["rev-parse", `${requested}:${lock.path}`]);
  const previous = git(["rev-parse", "refs/heads/vendor/pstack^{commit}"]);
  const previousTree = git(["rev-parse", `${previous}^{tree}`]);
  if (sourceTree === previousTree) {
    console.log(`vendor/pstack already contains upstream tree ${sourceTree}.`);
  } else {
    const message = `Import upstream pstack ${requested.slice(0, 12)}\n\nUpstream-Commit: ${requested}\n`;
    const commit = execFileSync("git", ["-C", root, "commit-tree", sourceTree, "-p", previous], {
      encoding: "utf8",
      input: message,
    }).trim();
    git(["update-ref", "refs/heads/vendor/pstack", commit, previous]);

    console.log(JSON.stringify({
      vendorRef: "vendor/pstack",
      previous,
      imported: commit,
      upstreamCommit: requested,
      tree: sourceTree,
      next: [
        "Merge vendor/pstack into main and resolve every conflict.",
        `Update upstream.lock.json commit to ${requested}.`,
        "Run pnpm port:verify.",
      ],
    }, null, 2));
  }
} finally {
  try {
    git(["update-ref", "-d", fetchRef]);
  } catch {}
}
