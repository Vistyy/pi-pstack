import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readLatestAssistantResult } from "../../extensions/pstack-workers/session-result.js";

function assistant(text: string) {
  return JSON.stringify({
    type: "message",
    message: {
      role: "assistant",
      content: [{ type: "text", text }],
      stopReason: "stop",
      timestamp: Date.now(),
    },
  });
}

test("reads only assistant output appended after an assignment boundary", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pstack-session-result-"));
  const path = join(directory, "child.jsonl");
  const prior = `${assistant("FIRST_RESULT")}\n`;
  await writeFile(path, `${prior}${assistant("SECOND_RESULT")}\n`);

  const result = readLatestAssistantResult(path, Buffer.byteLength(prior));

  assert.equal(result.text, "SECOND_RESULT");
  assert.equal(result.failed, false);
});

test("does not reuse an assistant response from before the assignment boundary", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pstack-session-result-"));
  const path = join(directory, "child.jsonl");
  const prior = `${assistant("FIRST_RESULT")}\n`;
  await writeFile(path, prior);

  const result = readLatestAssistantResult(path, Buffer.byteLength(prior));

  assert.equal(result.failed, true);
  assert.equal(result.error, "The child session has no assistant response.");
});
