import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { contentText } from "@earendil-works/pi-ai";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import { Check } from "typebox/value";
import { taskRecords, taskRecordType } from "../src/task-record.js";

const root = fileURLToPath(new URL("..", import.meta.url));

const Event = Type.Object({
  type: Type.String(),
  command: Type.Optional(Type.String()),
  success: Type.Optional(Type.Boolean()),
  message: Type.Optional(
    Type.Object({
      role: Type.String(),
      toolName: Type.Optional(Type.String()),
      isError: Type.Optional(Type.Boolean()),
      content: Type.Optional(
        Type.Union([
          Type.String(),
          Type.Array(Type.Object({ type: Type.String(), text: Type.Optional(Type.String()) })),
        ]),
      ),
    }),
  ),
});

const Summary = Type.Object({
  id: Type.String(),
  status: Type.String(),
  transcript: Type.String(),
  attempt: Type.Integer(),
  model: Type.String(),
  readonly: Type.Boolean(),
  profile: Type.Optional(Type.String()),
  output: Type.Optional(Type.String()),
});

const Request = Type.Object({ model: Type.String() });

const pause = (milliseconds: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });

function text(content: string | { type: string; text?: string }[] | undefined) {
  return Check(Type.String(), content)
    ? content
    : (content
        ?.filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("") ?? "");
}

function summary(content: string) {
  const value: unknown = JSON.parse(content);
  assert.ok(Check(Summary, value), content);

  return value;
}

async function cli(
  t: TestContext,
  directory: string,
  phase: string,
  scenario: string,
  sessionFile = join(directory, "parent.jsonl"),
) {
  const process = spawn(
    globalThis.process.execPath,
    [
      join(root, "node_modules/@earendil-works/pi-coding-agent/dist/cli.js"),
      "--offline",
      "--mode",
      "rpc",
      "--session",
      sessionFile,
      "--no-extensions",
      "--no-skills",
      "--no-themes",
      "--no-prompt-templates",
      "--no-context-files",
      "-e",
      join(root, "tests/recovery-extension.ts"),
      "-e",
      join(root, "extensions/index.ts"),
      "--provider",
      "recovery-fixture",
      "--model",
      "root",
      "--thinking",
      "off",
    ],
    {
      cwd: directory,
      env: {
        ...globalThis.process.env,
        PI_CODING_AGENT_DIR: join(directory, "agent"),
        PSTACK_RECOVERY_DIR: directory,
        PSTACK_RECOVERY_PHASE: phase,
        PSTACK_RECOVERY_CASE: scenario,
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );

  const events: Array<Static<typeof Event>> = [];
  let stdout = "";
  let stderr = "";
  let exited = false;

  const exit = new Promise<void>((resolve) => {
    process.on("exit", () => {
      exited = true;
      resolve();
    });
  });

  const kill = async () => {
    if (!exited) process.kill("SIGKILL");
    await exit;
  };

  t.after(kill);
  process.stdin.on("error", () => {});
  process.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();

    while (stdout.includes("\n")) {
      const index = stdout.indexOf("\n");
      const line = stdout.slice(0, index);
      stdout = stdout.slice(index + 1);
      const parsed: unknown = JSON.parse(line);
      assert.ok(Check(Event, parsed));
      events.push(parsed);
    }
  });
  process.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  const wait = async (label: string, predicate: () => boolean) => {
    const deadline = Date.now() + 20_000;

    while (!predicate()) {
      if (exited || Date.now() > deadline) throw new Error(`${phase}: ${label}\n${stderr}`);
      await pause(10);
    }
  };

  const send = (message: string) =>
    process.stdin.write(
      `${JSON.stringify({ type: "prompt", message, streamingBehavior: "followUp" })}\n`,
    );

  const prompt = async (message: string) => {
    const start = events.length;
    send(message);
    await wait(message, () => {
      const received = events.slice(start);

      const input = received.findIndex(
        (event) =>
          event.type === "message_end" &&
          event.message?.role === "user" &&
          text(event.message.content) ===
            (message === "/recovery-extension-input" ? "extension probe" : message),
      );

      return input >= 0 && received.slice(input).some((event) => event.type === "agent_settled");
    });

    return events.slice(start);
  };

  const call = async (message: string) => {
    const received = await prompt(message);

    const response = received.findLast(
      (event) => event.type === "message_end" && event.message?.role === "toolResult",
    )?.message;

    assert.ok(response, JSON.stringify(received));

    return { isError: response.isError, text: text(response.content) };
  };

  const tool = async (message: string) => {
    const response = await call(message);
    assert.equal(response.isError, false, response.text);

    return response.text;
  };

  const stop = async () => {
    send("/recovery-exit");
    await wait("clean exit", () => exited);
    assert.equal(process.exitCode, 0, stderr);
  };

  await wait("ready", () => stderr.includes("RECOVERY ready\n"));

  return {
    events,
    call,
    tool,
    prompt,
    send,
    kill,
    stop,
    mark: (name: string) => wait(name, () => stderr.includes(`RECOVERY ${name}\n`)),
    compact: async () => {
      const start = events.length;
      process.stdin.write(`${JSON.stringify({ type: "compact" })}\n`);
      await wait("compaction", () =>
        events
          .slice(start)
          .some((event) => event.type === "response" && event.command === "compact"),
      );
      assert.equal(
        events
          .slice(start)
          .find((event) => event.type === "response" && event.command === "compact")?.success,
        true,
      );
    },
    reload: async () => {
      const offset = stderr.length;
      send("/recovery-reload");
      await wait("reload", () => stderr.slice(offset).includes("RECOVERY ready\n"));
    },
  };
}

async function reopenSession(options: {
  t: TestContext;
  directory: string;
  scenario: string;
  initial: Awaited<ReturnType<typeof cli>>;
  transcript: string;
}) {
  const { t, directory, scenario, initial, transcript } = options;

  if (scenario === "reload") {
    await initial.reload();

    return initial;
  }

  if (scenario === "clean" || scenario === "normal") await initial.stop();
  else await initial.kill();

  if (scenario === "missing") {
    assert.equal(SessionManager.open(transcript).getCwd(), directory);
    await rename(transcript, `${transcript}.saved`);
  }

  return cli(t, directory, "reopen", scenario);
}

function assertReadonlyRequests(directory: string) {
  const ChildRequest = Type.Object({
    model: Type.Literal("child"),
    tools: Type.Array(Type.String()),
  });

  let childRequests = 0;

  for (const line of readFileSync(join(directory, "reopen.requests.jsonl"), "utf8")
    .trim()
    .split("\n")) {
    const request: unknown = JSON.parse(line);

    if (!Check(ChildRequest, request)) continue;
    childRequests++;
    const tools = request.tools;

    for (const excluded of ["grep", "find", "ls", "edit", "write"])
      assert.equal(tools.includes(excluded), false, `Recovered readonly child gained ${excluded}`);
    assert.ok(tools.includes("read"));
    assert.ok(tools.includes("bash"));
    assert.ok(tools.includes("recovery_fixture"));
  }

  assert.ok(childRequests > 0);
}

async function startTask(
  initial: Awaited<ReturnType<typeof cli>>,
  entries: () => ReturnType<SessionManager["getBranch"]>,
  scenario: string,
) {
  if (scenario === "pending") {
    initial.send("start");
    await initial.mark("delivery-pending");

    const result = entries().find(
      (entry) =>
        entry.type === "message" &&
        entry.message.role === "toolResult" &&
        entry.message.toolName === "pstack_task",
    );

    assert.ok(result?.type === "message" && result.message.role === "toolResult");

    return summary(text(result.message.content));
  }

  const created = summary(await initial.tool("start"));

  if (scenario === "normal") {
    await initial.mark("normal-delivered");
    assert.equal(summary(await initial.tool(`inspect ${created.id}`)).status, "completed");
  } else await initial.mark("child-ready");

  return created;
}

async function verifyTaskOutcome({
  scenario,
  inspected,
  reopened,
  created,
  previous,
}: {
  scenario: string;
  inspected: Static<typeof Summary>;
  reopened: Awaited<ReturnType<typeof cli>>;
  created: Static<typeof Summary>;
  previous: string;
}) {
  if (scenario === "normal" || scenario === "pending") {
    assert.equal(inspected.status, "completed");
    assert.equal(inspected.output, "Saved proof PROOF-7391");
    assert.equal(inspected.attempt, 1);

    return;
  }

  if (scenario === "cancelled") {
    assert.equal(inspected.status, "cancelled");

    return;
  }

  assert.equal(inspected.status, "interrupted");

  if (scenario === "compacted") {
    await reopened.compact();

    return;
  }

  if (scenario === "unavailable" || scenario === "missing") {
    const failed = await reopened.call(`resume ${created.id}`);
    assert.equal(failed.isError, true);
    assert.match(
      failed.text,
      scenario === "unavailable"
        ? /Unavailable model recovery-fixture\/child/
        : /Saved child transcript is missing/,
    );

    return;
  }

  const resumed = summary(await reopened.tool(`resume ${created.id}`));
  assert.equal(resumed.id, created.id);
  assert.equal(resumed.status, "completed");
  assert.equal(resumed.attempt, 2);
  assert.equal(resumed.transcript, created.transcript);
  assert.equal(
    resumed.output,
    scenario.startsWith("nested")
      ? "Coordinator recovered Saved proof PROOF-7391"
      : "Saved proof PROOF-7391",
  );
  assert.ok(
    readFileSync(resumed.transcript, "utf8").startsWith(previous),
    "resumption replaced saved history",
  );
}

for (const scenario of [
  "crash",
  "clean",
  "reload",
  "early",
  "nested",
  "nested-early",
  "pending",
  "normal",
  "cancelled",
  "unavailable",
  "missing",
  "readonly",
  "poteto",
  "compacted",
  "effect",
]) {
  await test(`normal Pi CLI restores ${scenario} without automatic work or duplicate recovery context`, {
    timeout: 40_000,
  }, async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "pstack-recovery-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    await mkdir(join(directory, "agent"));
    await writeFile(
      join(directory, "agent/settings.json"),
      JSON.stringify({
        packages: [],
        compaction: { enabled: false, keepRecentTokens: 1, reserveTokens: 1024 },
        retry: { enabled: false },
        cacheWarming: "off",
      }),
    );
    await writeFile(join(directory, "proof.txt"), "PROOF-7391\n");
    const entries = () => SessionManager.open(join(directory, "parent.jsonl")).getBranch();

    const notices = () =>
      entries().filter(
        (entry) => entry.type === "custom_message" && entry.customType === "pstack-recovery",
      );

    const initial = await cli(t, directory, "initial", scenario);
    const created = await startTask(initial, entries, scenario);
    assert.equal(notices().length, 0);

    if (scenario === "cancelled")
      assert.equal(summary(await initial.tool(`cancel ${created.id}`)).status, "cancelled");
    const previous = readFileSync(created.transcript, "utf8");

    const reopened = await reopenSession({
      t,
      directory,
      scenario,
      initial,
      transcript: created.transcript,
    });

    assert.equal(existsSync(join(directory, "reopen.requests.jsonl")), false);
    await reopened.prompt("/recovery-extension-input");
    assert.equal(
      notices().length,
      0,
      "extension-origin input must not consume the recovery handoff",
    );
    const inventory: unknown = JSON.parse(await reopened.tool("inventory"));
    assert.ok(Check(Type.Array(Summary), inventory));
    assert.equal(inventory.length, 1);
    assert.equal(inventory[0]?.id, created.id);
    assert.equal(inventory[0]?.output, undefined, "listing must not replay full results");

    const requests = readFileSync(join(directory, "reopen.requests.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => {
        const request: unknown = JSON.parse(line);
        assert.ok(Check(Request, request));

        return request.model;
      });

    assert.ok(
      requests.every((model) => model === "root"),
      "restoration started a child without explicit resumption",
    );
    const expectedNotices = ["normal", "cancelled"].includes(scenario) ? 0 : 1;
    assert.equal(notices().length, expectedNotices);
    const inspected = summary(await reopened.tool(`inspect ${created.id}`));
    assert.equal(inspected.model, "recovery-fixture/child:off");
    assert.equal(inspected.readonly, scenario === "readonly");
    assert.equal(inspected.profile, scenario === "poteto" ? "poteto-agent" : "generalPurpose");

    if (scenario === "readonly")
      await writeFile(
        join(directory, "agent/settings.json"),
        JSON.stringify({
          packages: [],
          "pi-pstack": { excludedChildTools: ["bash"] },
        }),
      );

    await verifyTaskOutcome({ scenario, inspected, reopened, created, previous });

    if (scenario === "readonly") assertReadonlyRequests(directory);

    if (scenario === "effect")
      assert.equal(readFileSync(join(directory, "effect.txt"), "utf8"), "applied\n");
    await reopened.tool("inventory");
    assert.equal(notices().length, expectedNotices);
    await reopened.stop();
    const again = await cli(t, directory, "again", scenario);
    await again.tool("inventory");
    assert.equal(
      notices().length,
      scenario === "compacted" ? 2 : expectedNotices,
      "recovery handoff must reflect what remains in the saved model context",
    );
    await again.stop();

    if (scenario === "clean") {
      const manager = SessionManager.open(join(directory, "parent.jsonl"));
      const saved = [...taskRecords(manager)].find((record) => record.id === created.id);

      assert.ok(saved);

      const lateId = `${created.id}-late`;

      manager.appendCustomEntry(taskRecordType, {
        ...saved,
        id: lateId,
        transcript: join(directory, "late-child.jsonl"),
        outcome: { status: "interrupted" },
      });

      const later = await cli(t, directory, "later", scenario);
      await later.tool("inventory");
      assert.equal(notices().length, expectedNotices + 1);
      const notice = notices().at(-1);

      assert.ok(notice?.type === "custom_message");
      assert.match(contentText(notice.content), new RegExp(lateId));
      await later.stop();
    }

    if (scenario === "crash") {
      const fork = SessionManager.forkFrom(
        join(directory, "parent.jsonl"),
        directory,
        join(directory, "forks"),
      );

      const forkPath = fork.getSessionFile();
      assert.ok(forkPath !== undefined);
      const foreign = await cli(t, directory, "foreign", scenario, forkPath);
      assert.equal(await foreign.tool("inventory"), "[]");
      const rejected = await foreign.call(`resume ${created.id}`);
      assert.equal(rejected.isError, true);
      assert.match(rejected.text, /Unknown owned child ID/);
      await foreign.stop();
    }
  });
}
