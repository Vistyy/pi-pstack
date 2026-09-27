import { readFileSync } from "node:fs";
import {
  type AgentSession,
  type AgentSessionEvent,
  parseSessionEntries,
  SessionManager,
  sessionEntryToContextMessages,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import { Check } from "typebox/value";
import { type Outcome, type TaskRecord, taskRecords } from "./task-record.js";

const ToolUpdate = Type.Object({
  content: Type.Array(
    Type.Union([
      Type.Object({ type: Type.Literal("text"), text: Type.String() }),
      Type.Object({ type: Type.Literal("image"), data: Type.String(), mimeType: Type.String() }),
    ]),
  ),
  details: Type.Optional(Type.Unknown()),
});

type Message = AgentSession["messages"][number];

export type Transcript = {
  messages: readonly Message[];
  streaming: Message | undefined;
  partials: ReadonlyMap<string, Static<typeof ToolUpdate>>;
  toolVersion: number;
  runningTools: ReadonlyMap<string, string>;
  definition?: (name: string) => ToolDefinition | undefined;
};

export type ObservedTask = {
  id: string;
  title: string;
  model: string;
  cwd: string;
  transcript: string;
  status: Outcome["status"] | "waiting" | "cancelling";
  activity: string;
  source:
    | { kind: "saved"; sessionId: string | undefined }
    | { kind: "live"; read: () => Transcript; children: ObservedTask[] };
};

export class LiveTranscript {
  private readonly partials = new Map<string, Static<typeof ToolUpdate>>();
  private readonly tools = new Map<string, string>();
  private toolVersion = 0;
  private leaf: string | null | undefined;
  private messages: Message[] = [];
  readonly dispose: () => void;

  constructor(
    private readonly session: AgentSession,
    changed: () => void,
  ) {
    this.dispose = session.subscribe((event) => {
      this.update(event);
      changed();
    });
  }

  private update(event: AgentSessionEvent) {
    if (event.type === "tool_execution_start") {
      this.tools.set(event.toolCallId, event.toolName);
      this.toolVersion++;
    } else if (event.type === "tool_execution_update" && Check(ToolUpdate, event.partialResult)) {
      this.partials.set(event.toolCallId, event.partialResult);
      this.toolVersion++;
    } else if (event.type === "tool_execution_end") {
      this.tools.delete(event.toolCallId);
      this.partials.delete(event.toolCallId);
      this.toolVersion++;
    }
  }

  waitingForChildren() {
    return (
      this.session.isIdle ||
      (this.tools.size > 0 && [...this.tools.values()].every((name) => name === "pstack_task"))
    );
  }

  activity() {
    if (this.tools.size > 0) return `Executing ${[...new Set(this.tools.values())].join(", ")}`;

    return this.session.isIdle ? "Session idle" : "Generating response";
  }

  read(): Transcript {
    const leaf = this.session.sessionManager.getLeafId();

    if (leaf !== this.leaf) {
      this.leaf = leaf;
      this.messages = this.session.sessionManager
        .getBranch()
        .flatMap(sessionEntryToContextMessages);
    }

    return {
      messages: this.messages,
      streaming: this.session.agent.state.streamingMessage,
      partials: this.partials,
      toolVersion: this.toolVersion,
      runningTools: this.tools,
      definition: (name) => this.session.getToolDefinition(name),
    };
  }
}

export function savedTask(record: TaskRecord): ObservedTask {
  const status = record.outcome.status === "running" ? "interrupted" : record.outcome.status;

  return {
    id: record.id,
    title: record.assignment,
    model: record.config.selector,
    cwd: record.config.cwd,
    transcript: record.transcript,
    status,
    activity: record.outcome.status === "failed" ? record.outcome.error : "",
    source: { kind: "saved", sessionId: record.sessionId },
  };
}

type SavedView = { transcript: Transcript; children: ObservedTask[]; notice: string };

export class SavedTranscripts {
  private readonly cache = new Map<string, { stamp: string; sessionId: string; view: SavedView }>();

  clear() {
    this.cache.clear();
  }

  read(task: ObservedTask): SavedView {
    const empty: Transcript = {
      messages: [],
      streaming: undefined,
      partials: new Map(),
      toolVersion: 0,
      runningTools: new Map(),
    };

    if (task.source.kind === "live")
      return { transcript: task.source.read(), children: task.source.children, notice: "" };

    try {
      const stamp = `${task.source.sessionId ?? ""}:${task.status}`;
      let cached = this.cache.get(task.transcript);

      if (cached?.stamp !== stamp) {
        const entries = parseSessionEntries(readFileSync(task.transcript, "utf8"));
        const header = entries[0];

        if (header?.type !== "session") throw new Error("Transcript has no session header");
        const manager = SessionManager.inMemory(task.cwd, { id: header.id }, entries);
        cached = {
          stamp,
          sessionId: manager.getSessionId(),
          view: {
            transcript: {
              ...empty,
              messages: manager.getBranch().flatMap(sessionEntryToContextMessages),
            },
            children: [...taskRecords(manager)].map(savedTask),
            notice: "",
          },
        };
        this.cache.set(task.transcript, cached);
      }

      if (task.source.sessionId !== undefined && cached.sessionId !== task.source.sessionId)
        throw new Error("Saved transcript identity changed");

      return cached.view;
    } catch (error) {
      const notCreated =
        task.source.sessionId === undefined &&
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT";

      return {
        transcript: empty,
        children: [],
        notice: notCreated
          ? "Transcript not yet created."
          : `Transcript unavailable. ${String(error)}`,
      };
    }
  }
}

export function activityCounts(tasks: readonly ObservedTask[]) {
  const counts = { running: 0, waiting: 0, failed: false };

  for (const task of tasks) {
    if (task.status === "running" || task.status === "cancelling") counts.running++;

    if (task.status === "waiting") counts.waiting++;

    if (task.status === "failed") counts.failed = true;

    if (task.source.kind === "live") {
      const nested = activityCounts(task.source.children);
      counts.running += nested.running;
      counts.waiting += nested.waiting;
      counts.failed ||= nested.failed;
    }
  }

  return counts;
}
