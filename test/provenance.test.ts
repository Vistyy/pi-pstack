import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lock = JSON.parse(fs.readFileSync(path.join(packageRoot, "integrations.lock.json"), "utf8")) as {
  sources: Array<{
    name: string;
    files: Array<{ destination: string; sha256: string }>;
  }>;
};

function sha256(file: string): string {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

test("official integration resources match their pinned sources", () => {
  for (const source of lock.sources) {
    for (const file of source.files) {
      const relative = file.destination;
      const destination = path.join(packageRoot, relative);
      assert.ok(fs.existsSync(destination), `${source.name} is missing ${relative}`);
      assert.equal(sha256(destination), file.sha256, `${source.name} changed ${relative} outside its source lock`);
    }
  }
});
