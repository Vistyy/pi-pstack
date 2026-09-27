import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { activityCounts, SavedTranscripts, savedTask } from "../src/observer-state.js";
import { type TaskRecord, taskRecordType } from "../src/task-record.js";

function record(directory: string, session: SessionManager): TaskRecord {
  const transcript = session.getSessionFile();
  assert.ok(transcript !== undefined);

  return {
    version: 1,
    owner: "parent",
    id: "coordinator",
    sourceCallId: "source-call",
    config: {
      profile: "generalPurpose",
      cwd: directory,
      readonly: true,
      selector: "fixture/worker:off",
    },
    transcript,
    sessionId: session.getSessionId(),
    prompt: "Inspect the fixture",
    assignment: "Original fixture assignment",
    attempt: 1,
    outcome: { status: "running" },
  };
}

await test("saved observer history preserves native messages and scoped nesting without writes", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "pstack-observer-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const session = SessionManager.create(directory, directory);
  session.appendMessage({ role: "user", content: "Original instruction", timestamp: 0 });
  const kept = session.appendMessage(fauxAssistantMessage("Native saved result"));
  session.appendCompaction("Native compaction summary", kept, 100);
  const task = record(directory, session);
  session.appendCustomEntry(taskRecordType, {
    ...task,
    id: "nested",
    owner: session.getSessionId(),
    assignment: "Nested assignment",
  });
  session.appendCustomEntry(taskRecordType, { ...task, id: "foreign", owner: "another-session" });
  const before = await readFile(task.transcript, "utf8");
  const view = new SavedTranscripts().read(savedTask(task));
  assert.deepEqual(
    view.transcript.messages.map((message) => message.role),
    ["user", "assistant", "compactionSummary"],
  );
  assert.deepEqual(
    view.children.map((child) => [child.id, child.title, child.status]),
    [["nested", "Nested assignment", "interrupted"]],
  );
  assert.equal(view.notice, "");
  assert.equal(await readFile(task.transcript, "utf8"), before);
});

await test("observer reports missing and mismatched transcripts without creating replacements", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "pstack-observer-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const session = SessionManager.create(directory, directory);
  const task = record(directory, session);
  const history = new SavedTranscripts();
  const notStarted = savedTask(task);
  notStarted.source = { kind: "saved", sessionId: undefined };
  assert.equal(history.read(notStarted).notice, "Transcript not yet created.");
  assert.match(history.read(savedTask(task)).notice, /Transcript unavailable/);
  assert.equal(existsSync(task.transcript), false);
  session.appendMessage(fauxAssistantMessage("Preserved history"));
  const before = await readFile(task.transcript, "utf8");
  assert.match(
    history.read(savedTask({ ...task, sessionId: "wrong-session" })).notice,
    /identity changed/,
  );
  assert.equal(await readFile(task.transcript, "utf8"), before);
});

await test("activity counts omit completed totals and include live nested work", () => {
  const session = SessionManager.inMemory("/fixture");

  const task: TaskRecord = {
    version: 1,
    owner: "parent",
    id: "root",
    sourceCallId: "call",
    attempt: 1,
    config: {
      profile: "generalPurpose",
      cwd: "/fixture",
      readonly: true,
      selector: "fixture/worker:off",
    },
    transcript: "/fixture/saved.jsonl",
    sessionId: session.getSessionId(),
    prompt: "Assignment",
    assignment: "Assignment",
    outcome: { status: "completed", output: "Done" },
  };

  const completed = savedTask(task);

  const waiting = {
    ...completed,
    status: "waiting" as const,
    source: {
      kind: "live" as const,
      read: () => ({
        messages: [],
        streaming: undefined,
        partials: new Map(),
        runningTools: new Map(),
        toolVersion: 0,
      }),
      children: [{ ...completed, id: "leaf", status: "running" as const }],
    },
  };

  assert.deepEqual(activityCounts([completed, waiting, { ...completed, status: "failed" }]), {
    running: 1,
    waiting: 1,
  });
});
