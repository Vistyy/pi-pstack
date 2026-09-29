import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { join } from "node:path";
import test from "node:test";
import { contentText, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { completionReportPrefix } from "../src/completion-report.js";
import { taskRecords } from "../src/task-record.js";
import { childFixture, packageRoot } from "./child-fixture.js";

await test("failed manual compaction retains the child's report until the host is ready", {
  timeout: 10000,
}, async (t) => {
  const f = await childFixture(t);
  const childRelease = f.gate();
  const compactStarted = f.gate();
  const compactRelease = f.gate();

  f.nested.setResponses([
    async () => {
      await childRelease.promise;

      return fauxAssistantMessage("report after failed compaction");
    },
  ]);

  const launched = await f.call("pstack_task", {
    prompt: "Finish while compaction fails",
    model: "nested/child:rev1:low",
    run_in_background: true,
  });

  assert.equal(launched.isError, false, launched.text);

  f.parent.setResponses([
    async () => {
      compactStarted.resolve();
      await compactRelease.promise;

      return fauxAssistantMessage("", { stopReason: "error", errorMessage: "compaction failed" });
    },
    (context) => {
      const report = context.messages.findLast(
        (message) =>
          message.role === "user" &&
          contentText(message.content).startsWith(completionReportPrefix),
      );

      assert.ok(report?.role === "user");
      assert.match(contentText(report.content), /report after failed compaction/);

      return fauxAssistantMessage("recovered report");
    },
  ]);

  const compacting = f.session.compact();

  await compactStarted.promise;
  const delivered = f.report();

  childRelease.resolve();
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });

  assert.equal(f.session.isCompacting, true);
  compactRelease.resolve();
  await assert.rejects(compacting);
  await delivered;
  await f.session.waitForIdle();

  const reports = f.session.messages.filter(
    (message) =>
      message.role === "user" && contentText(message.content).startsWith(completionReportPrefix),
  );

  assert.equal(reports.length, 1);
  assert.deepEqual(f.errors, []);
});

for (const failure of [false, true]) {
  await test(`automatic compaction ${failure ? "failure" : "success"} retains a concurrent report`, {
    timeout: 10000,
  }, async (t) => {
    const f = await childFixture(t);
    const childRelease = f.gate();
    const compactionStarted = f.gate();
    const compactionRelease = f.gate();

    f.nested.setResponses([
      async () => {
        await childRelease.promise;

        return fauxAssistantMessage("report during automatic compaction");
      },
    ]);

    const launched = await f.call("pstack_task", {
      prompt: "Finish during auto-compaction",
      model: "nested/child:rev1:low",
      run_in_background: true,
    });

    assert.equal(launched.isError, false, launched.text);
    const model = f.session.model;

    assert.ok(model);
    model.contextWindow = 500;
    f.session.setAutoCompactionEnabled(true);

    f.parent.setResponses([
      fauxAssistantMessage("answer that triggers compaction"),
      async () => {
        compactionStarted.resolve();
        await compactionRelease.promise;

        return failure
          ? fauxAssistantMessage("", {
              stopReason: "error",
              errorMessage: "automatic compaction failed",
            })
          : fauxAssistantMessage("fixture automatic summary");
      },
      (context) => {
        f.session.setAutoCompactionEnabled(false);

        const report = context.messages.findLast(
          (message) =>
            message.role === "user" &&
            contentText(message.content).startsWith(completionReportPrefix),
        );

        assert.ok(report?.role === "user");
        assert.match(contentText(report.content), /report during automatic compaction/);

        return fauxAssistantMessage("automatic report received");
      },
    ]);

    const running = f.session.prompt("Start automatic compaction");

    await compactionStarted.promise;

    const delivered = f.gate();

    const unsubscribe = f.session.subscribe((event) => {
      if (
        event.type === "message_end" &&
        (event.message.role === "user" || event.message.role === "custom") &&
        contentText(event.message.content).startsWith(completionReportPrefix)
      )
        delivered.resolve();
    });

    t.after(unsubscribe);

    childRelease.resolve();
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });

    assert.equal(
      f.session.messages.some(
        (message) =>
          message.role === "user" &&
          contentText(message.content).startsWith(completionReportPrefix),
      ),
      false,
    );
    compactionRelease.resolve();
    await running;
    await delivered.promise;
    await f.session.waitForIdle();

    assert.equal(
      f.session.messages.filter(
        (message) =>
          (message.role === "user" || message.role === "custom") &&
          contentText(message.content).startsWith(completionReportPrefix),
      ).length,
      1,
    );
    assert.deepEqual(f.errors, []);
  });
}

await test("a nested parent receives a busy child report without inspection after held tool work", {
  timeout: 10000,
}, async (t) => {
  const f = await childFixture(t, {
    extensionPaths: [join(packageRoot, "tests/report-busy-extension.ts")],
  });

  const leafRelease = f.gate();
  const leafFinished = f.gate();
  const workStarted = f.gate();
  const started = () => workStarted.resolve();

  process.once("pstack-nested-report-work-started", started);
  t.after(() => {
    process.removeListener("pstack-nested-report-work-started", started);
    EventEmitter.prototype.emit.call(process, "pstack-nested-report-work-release");
  });

  f.leaf.setResponses([
    async () => {
      await leafRelease.promise;
      leafFinished.resolve();

      return fauxAssistantMessage("nested leaf final evidence");
    },
  ]);
  f.nested.setResponses([
    fauxAssistantMessage(
      fauxToolCall("pstack_task", {
        prompt: "Produce nested evidence",
        model: "leaf/reader:off",
        run_in_background: true,
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage(fauxToolCall("fixture_hold_report_work", {}), { stopReason: "toolUse" }),
    (context) => {
      const report = context.messages.findLast(
        (message) =>
          message.role === "user" &&
          contentText(message.content).startsWith(completionReportPrefix),
      );

      assert.ok(report?.role === "user");
      assert.match(contentText(report.content), /nested leaf final evidence/);

      return fauxAssistantMessage("nested report received");
    },
  ]);

  let finished = false;

  const running = f
    .call("pstack_task", {
      prompt: "Wait for nested report",
      model: "nested/child:rev1:low",
      run_in_background: false,
    })
    .then((result) => {
      finished = true;

      return result;
    });

  await workStarted.promise;
  leafRelease.resolve();
  await leafFinished.promise;
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 30);
  });

  assert.equal(finished, false);
  EventEmitter.prototype.emit.call(process, "pstack-nested-report-work-release");

  const result = await running;

  assert.equal(result.isError, false, result.text);
  assert.match(result.text, /nested report received/);
  assert.deepEqual(f.errors, []);
});

await test("empty child output remains a full report with completed status", {
  timeout: 10000,
}, async (t) => {
  const f = await childFixture(t);
  const release = f.gate();

  f.nested.setResponses([
    async () => {
      await release.promise;

      return fauxAssistantMessage("");
    },
  ]);

  const launched = await f.call("pstack_task", {
    prompt: "Return empty text",
    model: "nested/child:rev1:low",
    run_in_background: true,
  });

  assert.equal(launched.isError, false, launched.text);
  f.parent.setResponses([
    (context) => {
      const report = context.messages.findLast(
        (message) =>
          message.role === "user" &&
          contentText(message.content).startsWith(completionReportPrefix),
      );

      assert.ok(report?.role === "user");
      assert.match(
        contentText(report.content),
        /"status":"completed","report":\{"kind":"full","text":""\}/,
      );

      return fauxAssistantMessage("empty report received");
    },
  ]);

  const delivered = f.report();

  release.resolve();
  await delivered;
  await f.session.waitForIdle();
  assert.deepEqual(f.errors, []);
});

await test("two reports survive a rejected idle startup and arrive once on the next valid turn", {
  timeout: 10000,
}, async (t) => {
  const f = await childFixture(t);
  const release = f.gate();
  const completed = f.gate();
  const rejected = f.gate();

  t.after(f.session.extensionRunner.onError(() => rejected.resolve()));
  t.after(
    f.session.subscribe((event) => {
      if (
        event.type === "entry_appended" &&
        [...taskRecords(f.session.sessionManager)].filter(
          (record) => record.outcome.status === "completed",
        ).length === 2
      )
        completed.resolve();
    }),
  );

  f.nested.setResponses(
    ["FIRST_GUARD_REPORT", "SECOND_GUARD_REPORT"].map((output) => async () => {
      await release.promise;

      return fauxAssistantMessage(output);
    }),
  );

  for (const prompt of ["First report", "Second report"]) {
    const result = await f.call("pstack_task", {
      prompt,
      model: "nested/child:rev1:low",
      run_in_background: true,
    });

    assert.equal(result.isError, false, result.text);
  }

  const before = f.parent.state.callCount;

  f.session.modelRuntime.unregisterProvider("fixture");
  release.resolve();
  await Promise.all([rejected.promise, completed.promise]);
  assert.equal(f.errors.length, 1);
  assert.match(f.errors[0] ?? "", /No API key found for fixture/);
  assert.equal(f.parent.state.callCount, before);

  f.session.modelRuntime.registerNativeProvider(f.parent.provider);
  await f.session.modelRuntime.getAvailable();
  f.parent.setResponses(Array.from({ length: 4 }, () => fauxAssistantMessage("Reports received")));
  await f.session.prompt("Continue after restoring the provider");
  await f.session.waitForIdle();

  const reports = f.session.messages
    .filter((message) => message.role === "user" || message.role === "custom")
    .map((message) => contentText(message.content))
    .filter((text) => text.startsWith(completionReportPrefix));

  assert.equal(reports.length, 2);
  assert.equal(reports.filter((text) => text.includes("FIRST_GUARD_REPORT")).length, 1);
  assert.equal(reports.filter((text) => text.includes("SECOND_GUARD_REPORT")).length, 1);
  assert.equal(f.errors.length, 1);
});

await test("a report rejected by an input preflight remains available at the next parent run", {
  timeout: 10000,
}, async (t) => {
  const f = await childFixture(t, {
    extensionPaths: [join(packageRoot, "tests/report-preflight-extension.ts")],
  });

  const release = f.gate();

  f.nested.setResponses([
    async () => {
      await release.promise;

      return fauxAssistantMessage("recovered after preflight");
    },
  ]);

  const launched = await f.call("pstack_task", {
    prompt: "Finish before a rejected idle wake",
    model: "nested/child:rev1:low",
    run_in_background: true,
  });

  assert.equal(launched.isError, false, launched.text);
  release.resolve();
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });

  assert.equal(
    f.session.messages.filter(
      (message) =>
        message.role === "user" && contentText(message.content).startsWith(completionReportPrefix),
    ).length,
    0,
  );

  f.parent.setResponses([
    (context) => {
      assert.match(JSON.stringify(context.messages), /recovered after preflight/);

      return fauxAssistantMessage("recovered report received");
    },
  ]);

  await f.session.prompt("continue after rejected preflight");
  await f.session.waitForIdle();

  const reports = f.session.messages.filter(
    (message) => message.role === "custom" && message.customType === "pstack-task-result",
  );

  assert.equal(reports.length, 1);
  assert.deepEqual(f.errors, []);
});
