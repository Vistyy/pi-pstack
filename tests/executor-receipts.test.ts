import assert from "node:assert/strict";
import test from "node:test";
import { contentText, fauxAssistantMessage } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { Check } from "typebox/value";
import { completionReportPrefix } from "../src/completion-report.js";
import { childFixture } from "./child-fixture.js";

const Receipt = Type.Object({
  id: Type.String(),
  status: Type.String(),
  attempt: Type.Number(),
  model: Type.String(),
  readonly: Type.Boolean(),
  output: Type.Optional(Type.String()),
});

for (const background of [false, true]) {
  await test(`${background ? "background" : "foreground"} receipts omit assignments but preserve complete results and inspection`, {
    timeout: 10000,
  }, async (t) => {
    const f = await childFixture(t);
    const prompt = `ASSIGNMENT-ONLY\n${"Inspect the affected behavior. ".repeat(1000)}`;
    const output = `RESULT-START\n${"complete evidence ".repeat(3000)}\nRESULT-END`;
    const release = f.gate();
    f.nested.setResponses([
      async () => {
        if (background) await release.promise;

        return fauxAssistantMessage(output);
      },
    ]);

    const started = await f.call("pstack_task", {
      prompt,
      model: "nested/child:rev1:low",
      readonly: true,
      run_in_background: background,
    });

    assert.equal(started.isError, false, started.text);
    const launch: unknown = JSON.parse(started.text);
    assert.ok(Check(Receipt, launch));
    assert.equal(launch.model, "nested/child:rev1:low");
    assert.equal(launch.readonly, true);
    assert.equal(launch.attempt, 1);

    for (const key of ["prompt", "sourceCallId", "profile", "thinking", "cwd"])
      assert.equal(Object.hasOwn(launch, key), false);
    let delivered = started.text;

    if (background) {
      assert.equal(launch.status, "running");
      assert.ok(started.text.length < 1024);
      f.parent.setResponses([
        (context) => {
          const message = context.messages.findLast(
            (item) =>
              item.role === "user" && contentText(item.content).includes('"status":"completed"'),
          );

          assert.ok(message?.role === "user");
          delivered = contentText(message.content);

          return fauxAssistantMessage("completion received");
        },
      ]);
      const settled = f.report();
      release.resolve();
      await settled;
      await f.session.waitForIdle();
      const last = f.session.messages.at(-1);
      assert.ok(last?.role === "assistant");
      assert.equal(contentText(last.content), "completion received");
    }

    const completed: unknown = JSON.parse(
      background ? delivered.slice(completionReportPrefix.length) : delivered,
    );

    if (background) {
      assert.ok(delivered.startsWith(completionReportPrefix));
      assert.ok(Buffer.byteLength(delivered) <= 16 * 1024);
      assert.ok(
        Check(
          Type.Object({
            id: Type.String(),
            attempt: Type.Literal(1),
            status: Type.Literal("completed"),
            report: Type.Object({
              kind: Type.Literal("preview"),
              text: Type.String(),
              omittedBytes: Type.Integer({ minimum: 1 }),
            }),
          }),
          completed,
        ),
      );
      assert.equal(completed.id, launch.id);
      assert.ok(output.startsWith(completed.report.text));
      assert.equal(
        completed.report.omittedBytes,
        Buffer.byteLength(output) - Buffer.byteLength(completed.report.text),
      );
    } else {
      assert.ok(Check(Receipt, completed));
      assert.equal(completed.id, launch.id);
      assert.equal(completed.status, "completed");
      assert.equal(completed.output, output);

      for (const key of ["prompt", "sourceCallId", "profile", "thinking", "cwd"])
        assert.equal(Object.hasOwn(completed, key), false);
      assert.ok(delivered.length - output.length < 1024);
    }

    const inspection = await f.call("pstack_tasks", { action: "inspect", id: launch.id });
    assert.equal(inspection.isError, false, inspection.text);
    const detail: unknown = JSON.parse(inspection.text);
    assert.ok(
      Check(
        Type.Object({
          prompt: Type.String(),
          output: Type.String(),
          cwd: Type.String(),
          transcript: Type.String(),
        }),
        detail,
      ),
    );
    assert.equal(detail.prompt, prompt);
    assert.equal(detail.output, output);
    assert.equal(detail.cwd, f.project);
    const listed = await f.call("pstack_tasks", { action: "list" });
    assert.equal(listed.isError, false, listed.text);
    assert.ok(listed.text.includes("ASSIGNMENT-ONLY"));
    assert.ok(listed.text.length < 1024);
    assert.equal(listed.text.includes("RESULT-START"), false);
    assert.deepEqual(f.errors, []);
  });
}
