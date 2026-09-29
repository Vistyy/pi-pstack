import { existsSync } from "node:fs";
import {
  type ExtensionContext,
  type SessionEntry,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import { Check } from "typebox/value";
import { completionReportPrefix } from "./completion-report.js";

export const taskRecordType = "pstack-task";

export const recoveryType = "pstack-recovery";

export const ToolPlan = Type.Object({
  tools: Type.Array(Type.String()),
  paths: Type.Array(Type.String()),
  excluded: Type.Array(Type.String()),
});

export type ToolPlan = Static<typeof ToolPlan>;

const Configuration = Type.Object({
  profile: Type.Union([
    Type.Literal("generalPurpose"),
    Type.Literal("poteto-agent"),
    Type.Literal("Comment Sicko"),
  ]),
  cwd: Type.String(),
  readonly: Type.Boolean(),
  selector: Type.String(),
});

export type Configuration = Static<typeof Configuration>;

const Outcome = Type.Union([
  Type.Object({ status: Type.Literal("running") }),
  Type.Object({ status: Type.Literal("interrupted") }),
  Type.Object({ status: Type.Literal("cancelled") }),
  Type.Object({ status: Type.Literal("completed"), output: Type.String() }),
  Type.Object({ status: Type.Literal("failed"), error: Type.String() }),
]);

export type Outcome = Static<typeof Outcome>;

const TaskRecord = Type.Object({
  version: Type.Literal(1),
  owner: Type.String(),
  id: Type.String(),
  sourceCallId: Type.String(),
  config: Configuration,
  transcript: Type.String(),
  sessionId: Type.Optional(Type.String()),
  plan: Type.Optional(ToolPlan),
  attempt: Type.Integer({ minimum: 1 }),
  prompt: Type.String(),
  assignment: Type.String(),
  outcome: Outcome,
});

export type TaskRecord = Static<typeof TaskRecord>;

export function taskRecords(manager: ExtensionContext["sessionManager"]) {
  const records = new Map<string, TaskRecord>();

  for (const entry of manager.getBranch()) {
    if (entry.type !== "custom" || entry.customType !== taskRecordType) continue;
    const data: unknown = entry.data;

    if (!Check(TaskRecord, data)) throw new Error(`Invalid PStack task record ${entry.id}`);

    if (data.owner === manager.getSessionId()) records.set(data.id, data);
  }

  return records.values();
}

const Report = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    attempt: Type.Integer({ minimum: 1 }),
    status: Type.Union([Type.Literal("completed"), Type.Literal("failed")]),
    report: Type.Union([
      Type.Object(
        { kind: Type.Literal("full"), text: Type.String() },
        { additionalProperties: false },
      ),
      Type.Object(
        {
          kind: Type.Literal("preview"),
          text: Type.String(),
          omittedBytes: Type.Integer({ minimum: 1 }),
        },
        { additionalProperties: false },
      ),
    ]),
  },
  { additionalProperties: false },
);

const Receipt = Type.Object({
  id: Type.String(),
  attempt: Type.Integer(),
  status: Type.Union([Type.Literal("completed"), Type.Literal("failed")]),
});

function receiptText(entry: SessionEntry) {
  const content =
    entry.type === "custom_message" && entry.customType === "pstack-task-result"
      ? entry.content
      : entry.type === "message" &&
          (entry.message.role === "user" || entry.message.role === "toolResult")
        ? entry.message.content
        : undefined;

  return Check(Type.String(), content)
    ? content
    : content
        ?.filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("");
}

export function resultReceived(entries: SessionEntry[], id: string, attempt: number) {
  return entries.some((entry) => {
    const text = receiptText(entry);

    if (text === undefined || text === "") return false;

    if (
      entry.type === "message" &&
      entry.message.role === "toolResult" &&
      entry.message.toolName === "pstack_task" &&
      entry.message.isError &&
      text.includes(`Child ${id} attempt ${attempt} failed:`)
    )
      return true;

    try {
      if (text.startsWith(completionReportPrefix)) {
        const data: unknown = JSON.parse(text.slice(completionReportPrefix.length));

        return Check(Report, data) && data.id === id && data.attempt === attempt;
      }

      if (entry.type !== "custom_message" || entry.customType !== "pstack-task-result")
        return false;
      const data: unknown = JSON.parse(text);

      return Check(Receipt, data) && data.id === id && data.attempt === attempt;
    } catch {
      return false;
    }
  });
}

export function cancelSavedChildren({
  transcript,
  sessionId,
  depth,
}: {
  transcript: string;
  sessionId: string | undefined;
  depth: number;
}) {
  if (!existsSync(transcript) || depth >= 2) return;
  const manager = SessionManager.open(transcript);

  if (sessionId !== undefined && manager.getSessionId() !== sessionId)
    throw new Error(`Saved child transcript identity changed: ${transcript}`);

  for (const record of taskRecords(manager)) {
    if (record.outcome.status !== "running" && record.outcome.status !== "interrupted") continue;
    manager.appendCustomEntry(taskRecordType, { ...record, outcome: { status: "cancelled" } });
    cancelSavedChildren({
      transcript: record.transcript,
      sessionId: record.sessionId,
      depth: depth + 1,
    });
  }
}
