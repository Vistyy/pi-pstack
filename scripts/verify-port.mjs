import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const commands = [
  ["node", ["scripts/verify-vendor.mjs"]],
  ["node", ["scripts/report-port.mjs"]],
  ["node", ["scripts/sync-integrations.mjs"]],
  ["pnpm", ["check"]],
  ["node", ["scripts/smoke-profiles.mjs"]],
  ["node", ["--import", "tsx", "scripts/smoke-worker-resources.ts"]],
];

for (const [command, args] of commands) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
