import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fauxAssistantMessage, type Usage } from "@earendil-works/pi-ai";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import {
  activityCounts,
  LiveTranscript,
  SavedTranscripts,
  savedTask,
} from "../src/observer-state.js";
import { type TaskRecord, taskRecordType } from "../src/task-record.js";
import { childFixture } from "./child-fixture.js";

const usage: Usage = {
  input: 100,
  output: 20,
  cacheRead: 30,
  cacheWrite: 10,
  reasoning: 12,
  totalTokens: 160,
  cost: { input: 0.125, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.125 },
};

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
  assert.equal(history.read(notStarted).transcript.usage, undefined);
  assert.match(history.read(savedTask(task)).notice, /Transcript unavailable/);
  assert.equal(history.read(savedTask(task)).transcript.usage, undefined);
  assert.equal(existsSync(task.transcript), false);
  session.appendMessage(fauxAssistantMessage("Preserved history"));
  const before = await readFile(task.transcript, "utf8");
  assert.match(
    history.read(savedTask({ ...task, sessionId: "wrong-session" })).notice,
    /identity changed/,
  );
  assert.equal(
    history.read(savedTask({ ...task, sessionId: "wrong-session" })).transcript.usage,
    undefined,
  );
  assert.deepEqual(history.read(savedTask(task)).transcript.usage, {
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    cost: 0,
  });
  assert.equal(await readFile(task.transcript, "utf8"), before);
});

await test("saved usage counts the whole session ledger without rolling up descendants", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "pstack-observer-usage-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const session = SessionManager.create(directory, directory);
  const first = session.appendMessage({ ...fauxAssistantMessage("Initial work"), usage });
  session.appendMessage({ ...fauxAssistantMessage("Abandoned branch"), usage });
  session.branchWithSummary(first, "Branch summary", undefined, false, usage);
  const resumed = session.appendMessage({ role: "user", content: "Resume", timestamp: 1 });
  session.appendMessage({ ...fauxAssistantMessage("Resumed result"), usage });
  session.appendCompaction("Compacted work", resumed, 160, undefined, false, usage);
  session.appendUsage("cache_warm", "fixture", "worker", usage);
  session.appendMessage({
    role: "toolResult",
    toolCallId: "usage-tool",
    toolName: "metered-tool",
    content: [{ type: "text", text: "Tool result" }],
    isError: false,
    timestamp: 2,
    usage,
  });
  const nested = SessionManager.create(directory, directory);
  nested.appendMessage({ ...fauxAssistantMessage("Nested work"), usage });
  session.appendCustomEntry(taskRecordType, {
    ...record(directory, nested),
    owner: session.getSessionId(),
    id: "nested-usage",
  });
  const task = record(directory, session);
  const before = await readFile(task.transcript, "utf8");
  const view = new SavedTranscripts().read(savedTask(task));
  assert.deepEqual(view.transcript.usage, {
    tokens: { input: 700, output: 140, cacheRead: 210, cacheWrite: 70, total: 1120 },
    cost: 0.875,
  });
  assert.equal(view.children.length, 1);
  assert.equal(await readFile(task.transcript, "utf8"), before);
});

await test("live usage matches native session totals and follows entries outside the visible branch", async (t) => {
  const fixture = await childFixture(t);
  const observation = new LiveTranscript(fixture.session, () => {});
  t.after(() => observation.dispose());
  const manager = fixture.session.sessionManager;
  const first = manager.appendMessage({ ...fauxAssistantMessage("Initial result"), usage });
  assert.deepEqual(observation.read().usage, {
    tokens: { input: 100, output: 20, cacheRead: 30, cacheWrite: 10, total: 160 },
    cost: 0.125,
  });
  manager.appendUsage("cache_warm", "fixture", "root", usage);
  manager.branch(first);

  const expected = {
    tokens: { input: 200, output: 40, cacheRead: 60, cacheWrite: 20, total: 320 },
    cost: 0.25,
  };

  assert.deepEqual(observation.read().usage, expected);
  const native = fixture.session.getSessionStats();
  assert.deepEqual({ tokens: native.tokens, cost: native.cost }, expected);
  assert.deepEqual(observation.read().usage, expected);
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
        usage: undefined,
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
