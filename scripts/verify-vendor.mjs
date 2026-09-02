import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lock = JSON.parse(readFileSync(path.join(root, "upstream.lock.json"), "utf8"));

function git(args) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function resolve(value) {
  try {
    return git(["rev-parse", value]);
  } catch {
    throw new Error(`Missing Git object for ${value}. Run git fetch upstream-pstack ${lock.commit}.`);
  }
}

const vendorCommit = resolve("refs/heads/vendor/pstack^{commit}");
const vendorTree = resolve(`${vendorCommit}^{tree}`);
const sourceTree = resolve(`${lock.commit}:${lock.path}`);

if (vendorTree !== sourceTree) {
  throw new Error(`vendor/pstack tree ${vendorTree} does not match ${lock.commit}:${lock.path} tree ${sourceTree}.`);
}

const message = git(["show", "-s", "--format=%B", vendorCommit]);
if (!message.includes(`Upstream-Commit: ${lock.commit}`)) {
  throw new Error(`vendor/pstack commit ${vendorCommit} does not record locked upstream commit ${lock.commit}.`);
}

console.log(JSON.stringify({
  vendorRef: "vendor/pstack",
  vendorCommit,
  upstreamCommit: lock.commit,
  tree: vendorTree,
  exact: true,
}, null, 2));
