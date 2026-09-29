import assert from "node:assert/strict";
import test from "node:test";
import type { CustomMessageEntry } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Check } from "typebox/value";
import { completionReport, completionReportPrefix } from "../src/completion-report.js";
import { resultReceived } from "../src/task-record.js";

const identity = { id: "child-7", attempt: 2, status: "completed" } as const;

const Report = Type.Object({
  id: Type.String(),
  attempt: Type.Integer(),
  status: Type.Union([Type.Literal("completed"), Type.Literal("failed")]),
  report: Type.Union([
    Type.Object({ kind: Type.Literal("full"), text: Type.String() }),
    Type.Object({
      kind: Type.Literal("preview"),
      text: Type.String(),
      omittedBytes: Type.Integer(),
    }),
  ]),
});

function parse(text: string) {
  assert.ok(text.startsWith(completionReportPrefix));

  const data: unknown = JSON.parse(text.slice(completionReportPrefix.length));

  assert.ok(Check(Report, data));

  return data;
}

await test("final reports retain empty text and exact attempt identity", () => {
  const report = completionReport(identity, "");

  assert.deepEqual(parse(report), {
    ...identity,
    report: { kind: "full", text: "" },
  });
});

await test("JSON escaping and UTF-8 characters count toward the whole envelope budget", () => {
  const output = `${'😀\\"\n'.repeat(5000)}tail`;
  const encoded = completionReport(identity, output);

  assert.ok(Buffer.byteLength(encoded, "utf8") <= 16 * 1024);

  const parsed = parse(encoded);

  assert.equal(parsed.report.kind, "preview");

  if (parsed.report.kind !== "preview") throw new Error("Expected a preview");

  assert.ok(output.startsWith(parsed.report.text));
  assert.equal(
    parsed.report.omittedBytes,
    Buffer.byteLength(output) - Buffer.byteLength(parsed.report.text),
  );
  assert.ok(parsed.report.omittedBytes > 0);
});

await test("receipt recovery recognizes complete reports but not a near match or another attempt", () => {
  const content = completionReport(identity, "delivered");

  const entry: CustomMessageEntry = {
    type: "custom_message",
    id: "receipt-1",
    parentId: null,
    timestamp: "now",
    customType: "pstack-task-result",
    content,
    display: false,
  };

  assert.equal(resultReceived([entry], identity.id, identity.attempt), true);
  assert.equal(resultReceived([entry], identity.id, 1), false);
  assert.equal(resultReceived([{ ...entry, content: `${content}suffix` }], identity.id, 2), false);
  assert.equal(
    resultReceived(
      [{ ...entry, content: content.replace('"kind":"full"', '"kind":"other"') }],
      identity.id,
      2,
    ),
    false,
  );
});
