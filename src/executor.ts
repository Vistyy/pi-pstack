import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { contentText } from "@earendil-works/pi-ai";
import {
  type AgentSession,
  type ExtensionAPI,
  type ExtensionContext,
  type ExtensionEvent,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import { type ConfigureRuntime, createChildSession, selectModel } from "./child-session.js";
import { type CompletionReport, completionReport } from "./completion-report.js";
import { installObserver } from "./observer.js";
import { LiveTranscript, type ObservedTask } from "./observer-state.js";
import {
  type Configuration,
  cancelSavedChildren,
  type Outcome,
  recoveryType,
  resultReceived,
  type TaskRecord,
  type ToolPlan,
  taskRecords,
  taskRecordType,
} from "./task-record.js";

const TaskInput = Type.Object(
  {
    prompt: Type.String({
      minLength: 1,
      description:
        "Complete assignment for a fresh child, or follow-up for a resumed child. Resolve required packaged skill and reference paths to absolute paths; the child works in the project directory, not the skill directory.",
    }),
    subagent_type: Type.Optional(
      Type.Union(
        [
          Type.Literal("generalPurpose"),
          Type.Literal("poteto-agent"),
          Type.Literal("Comment Sicko"),
        ],
        {
          description:
            "Defaults to generalPurpose. Named profiles load their packaged agent instructions; poteto-agent also receives full Poteto mode. Comment Sicko edits comments and requires writable tools.",
        },
      ),
    ),
    model: Type.Optional(
      Type.String({
        description:
          "Exact provider/model:thinking selector. Use the effective selector for the skill's named role. Only when no role or model is prescribed, omit this to inherit the parent's model and thinking.",
      }),
    ),
    readonly: Type.Optional(
      Type.Boolean({
        description:
          "Request investigation without modifying files or external state. Inherits the parent's active tools plus PStack task/todo helpers, minus excludedChildTools and write/edit. Defaults to false unless inherited from a readonly parent; descendants cannot opt out.",
      }),
    ),
    run_in_background: Type.Optional(
      Type.Boolean({
        description:
          "Return an ID immediately and deliver the bounded final report automatically after the child and its nested work finish. Inspect only for progress, debugging, recovery, or oversized detail. Defaults to true for poteto-agent, false otherwise. Foreground calls wait for results and may run in parallel.",
      }),
    ),
    cwd: Type.Optional(
      Type.String({
        description:
          "Existing working directory, relative to the parent's directory or absolute; defaults to the parent's. Prepare any required isolation first: the executor does not create, merge, or remove worktrees.",
      }),
    ),
    resume: Type.Optional(
      Type.String({
        description:
          "ID of an idle owned child to continue. Retains conversation, profile, model, working directory, and read-only configuration; these cannot change on resume. Start a new child for an independent assignment. Cannot steer an active child. Saved children can be explicitly resumed after reopening their owning parent session. Reconcile interrupted tool effects before repeating work.",
      }),
    ),
  },
  { additionalProperties: false },
);

type Request = Static<typeof TaskInput>;

type Status = Outcome["status"] | "cancelling";

type ReportCarrier = {
  busy: (content: string) => void | Promise<void>;
  idle: (content: string) => void | Promise<void>;
};

type PendingReport = {
  identity: Pick<CompletionReport, "id" | "attempt" | "status">;
  content: string;
  current: () => boolean;
  resolve: () => void;
};

type Summary = ReturnType<ChildTask["summary"]>;

const textResult = (value: Summary | Summary[]) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value) }],
  details: {},
});

const message = (content: string) => ({
  customType: "pstack-task-result",
  content,
  display: false,
});

const busyDelivery = { triggerTurn: true, deliverAs: "steer" as const };

const idleDelivery = { deliverAs: "steer" as const };

class TaskScope {
  readonly children = new Map<string, ChildTask>();
  readonly deliveries = new Set<Promise<void>>();
  private readonly pending: PendingReport[] = [];
  private readonly steering: PendingReport[] = [];
  private admitted: PendingReport | undefined;
  private compacting = false;
  active = true;
  deliveryError: Error | undefined;
  private journal: { pi: ExtensionAPI; ctx: ExtensionContext } | undefined;
  private restored = false;
  private recoveryReported = false;
  interrupted = false;
  readonly recovered = new Set<string>();

  constructor(
    readonly depth: number,
    readonly readonly: boolean,
    readonly carrier: ReportCarrier,
    readonly isStreaming: () => boolean,
    readonly changed: () => void = () => {},
  ) {}

  views(): ObservedTask[] {
    return [...this.children.values()].map((child) => child.view());
  }

  bind(pi: ExtensionAPI, ctx: ExtensionContext) {
    this.journal = { pi, ctx };

    if (this.restored) return;

    for (const record of taskRecords(ctx.sessionManager)) {
      if (this.depth >= 2 || (this.readonly && !record.config.readonly))
        throw new Error("Saved child violates its owner's delegation policy");
      this.children.set(record.id, new ChildTask(this, record.config, record));
      this.recovered.add(record.id);
    }

    this.restored = true;
    this.changed();
  }

  record(data: Omit<TaskRecord, "owner" | "version">) {
    if (!this.journal) throw new Error("Task owner is not initialized");
    this.journal.pi.appendEntry(taskRecordType, {
      ...data,
      version: 1,
      owner: this.journal.ctx.sessionManager.getSessionId(),
    });
    this.changed();
  }

  recovery() {
    if (this.recoveryReported || !this.journal) return;
    const entries = this.journal.ctx.sessionManager.getBranch();

    const tasks = this.children
      .values()
      .filter((child) => this.recovered.has(child.id))
      .filter(
        (child) =>
          child.status === "interrupted" ||
          ((child.status === "completed" || child.status === "failed") &&
            !resultReceived(entries, child.id, child.attempt)),
      )
      .map((child) => ({
        id: child.id,
        status: child.status,
        attempt: child.attempt,
        assignment: child.assignment.slice(0, 160),
      }))
      .toArray();

    this.recoveryReported = true;

    if (tasks.length === 0 && !this.interrupted) return;
    const content = `PStack recovery. No work was restarted. Inspect saved tasks with pstack_tasks; resume only when needed. Interrupted tools may have completed or still be running. Reconcile their actual effects before repeating them. Completed or failed tasks listed here have results not yet received in this branch.\n${JSON.stringify({ interrupted: this.interrupted, tasks })}`;

    if (
      this.journal.ctx.sessionManager
        .buildContextEntries()
        .some((entry) => entry.type === "custom_message" && entry.customType === recoveryType)
    )
      return;

    return { customType: recoveryType, content, display: false };
  }

  check() {
    if (!this.active) throw new Error("Owner session is closing or cancelled");
  }

  require(id: string) {
    const child = this.children.get(id);

    if (!child) throw new Error("Unknown owned child ID");

    return child;
  }

  post(identity: PendingReport["identity"], text: string, current: () => boolean) {
    const delivery = Promise.withResolvers<void>();
    this.deliveries.add(delivery.promise);
    void delivery.promise.then(() => this.deliveries.delete(delivery.promise));

    this.pending.push({
      identity,
      content: completionReport(identity, text),
      current,
      resolve: delivery.resolve,
    });
    this.flush();
  }

  private received(report: PendingReport) {
    return (
      this.journal !== undefined &&
      resultReceived(
        this.journal.ctx.sessionManager.getBranch(),
        report.identity.id,
        report.identity.attempt,
      )
    );
  }

  acceptedSteering(content: string) {
    const index = this.steering.findIndex((report) => report.content === content);

    if (index < 0) return;

    const [report] = this.steering.splice(index, 1);

    report?.resolve();
  }

  settled() {
    const missing = this.steering.splice(0).filter((report) => {
      if (this.received(report)) {
        report.resolve();

        return false;
      }

      return true;
    });

    this.pending.unshift(...missing);
    this.flush();
  }

  acceptedUserMessage(content: string) {
    if (this.admitted === undefined) return;

    const report = this.admitted;

    if (content === report.content || this.received(report)) {
      this.admitted = undefined;
      report.resolve();
    } else {
      this.admitted = undefined;
      this.pending.unshift(report);
    }

    this.flush();
  }

  compact(start: boolean) {
    this.compacting = start;

    if (!start) this.flush();
  }

  private reject(report: PendingReport, error: Error) {
    const index = this.steering.indexOf(report);

    if (index >= 0) this.steering.splice(index, 1);

    if (this.admitted === report) this.admitted = undefined;

    this.deliveryError = error;
    report.resolve();
  }

  flush() {
    if (this.compacting || !this.active) return;

    while (this.pending.length > 0) {
      if (this.admitted !== undefined && !this.isStreaming()) return;

      const report = this.pending.shift();

      if (!report) return;

      if (!report.current() || this.received(report)) {
        report.resolve();

        continue;
      }

      try {
        if (this.isStreaming()) {
          this.steering.push(report);
          void Promise.resolve(this.carrier.busy(report.content)).catch((error: unknown) => {
            this.reject(report, new Error(String(error), { cause: error }));
          });
        } else {
          this.admitted = report;
          void Promise.resolve(this.carrier.idle(report.content)).catch((error: unknown) => {
            this.reject(report, new Error(String(error), { cause: error }));
          });
        }
      } catch (error) {
        this.reject(report, new Error(String(error), { cause: error }));
      }
    }
  }

  async settle(session: AgentSession) {
    for (;;) {
      await session.waitForIdle();
      const work = [...this.children.values()].flatMap((child) => (child.busy ? [child.work] : []));
      const pending = [...this.deliveries];

      if (work.length === 0 && pending.length === 0 && session.isIdle) {
        if (this.deliveryError !== undefined) throw this.deliveryError;

        return;
      }

      await Promise.all([...work, ...pending]);
    }
  }

  async cancelChildren(reason: "cancelled" | "interrupted" = "cancelled") {
    this.active = false;

    for (const report of [...this.pending.splice(0), ...this.steering.splice(0)]) report.resolve();
    this.admitted?.resolve();
    this.admitted = undefined;
    await Promise.all([...this.children.values()].map((child) => child.cancel(reason)));
    await Promise.all([...this.deliveries]);
  }

  async dispose() {
    await this.cancelChildren("interrupted");
    await Promise.all([...this.children.values()].map((child) => child.dispose()));
    this.children.clear();
  }
}

class ChildTask {
  readonly id: string;
  readonly transcript: string;
  readonly sourceCallId: string;
  readonly scope: TaskScope;
  status: Status = "interrupted";
  attempt = 0;
  assignment = "";
  private observation: LiveTranscript | undefined;
  private sessionId: string | undefined;
  private plan: ToolPlan | undefined;
  private cancellationOutcome: "cancelled" | "interrupted" = "cancelled";
  session: AgentSession | undefined;
  work: Promise<void> = Promise.resolve();
  output: string | undefined;
  error: string | undefined;
  prompt = "";
  private cancelled = false;
  private inspectedAttempt = 0;
  private cancellation: Promise<void> | undefined;
  private turn = Symbol();
  private disposed = false;

  constructor(
    readonly parent: TaskScope,
    readonly config: Configuration,
    record?: TaskRecord,
    sourceCallId = "",
  ) {
    this.id = record?.id ?? randomUUID();
    const transcript = record?.transcript ?? SessionManager.create(config.cwd).getSessionFile();

    if (transcript === undefined) throw new Error("Child transcript path is unavailable");
    this.transcript = transcript;
    this.sourceCallId = record?.sourceCallId ?? sourceCallId;

    if (record) {
      this.status = record.outcome.status === "running" ? "interrupted" : record.outcome.status;
      this.attempt = record.attempt;
      this.assignment = record.assignment;
      this.prompt = record.prompt;
      this.sessionId = record.sessionId;
      this.plan = record.plan;

      if (record.outcome.status === "completed") this.output = record.outcome.output;

      if (record.outcome.status === "failed") this.error = record.outcome.error;
    }

    this.scope = new TaskScope(
      parent.depth + 1,
      config.readonly,
      {
        busy: (content) => {
          if (!this.session) throw new Error("Child session is not initialized");

          return this.session.sendCustomMessage(message(content), busyDelivery);
        },
        idle: (content) => {
          if (!this.session) throw new Error("Child session is not initialized");

          return this.session.sendUserMessage(content, idleDelivery);
        },
      },
      () => this.session?.isStreaming === true,
      () => parent.changed(),
    );
    this.scope.interrupted = record !== undefined && this.status === "interrupted";
  }

  get busy() {
    return this.status === "running" || this.status === "cancelling";
  }

  view(): ObservedTask {
    const waiting =
      this.status === "running" &&
      this.observation?.waitingForChildren() === true &&
      [...this.scope.children.values()].some((child) => child.busy);

    const observation = this.observation;

    return {
      id: this.id,
      title: this.assignment,
      model: this.config.selector,
      cwd: this.config.cwd,
      transcript: this.transcript,
      status: waiting ? "waiting" : this.status,
      activity: waiting
        ? "Waiting for nested work"
        : (this.error ?? (this.busy ? (observation?.activity() ?? "Starting") : "")),
      source: observation
        ? { kind: "live", read: () => observation.read(), children: this.scope.views() }
        : { kind: "saved", sessionId: this.sessionId },
    };
  }

  private save() {
    const outcome: Outcome =
      this.status === "completed"
        ? { status: "completed", output: this.output ?? "" }
        : this.status === "failed"
          ? { status: "failed", error: this.error ?? "Child failed" }
          : { status: this.status === "cancelling" ? this.cancellationOutcome : this.status };

    const record: Omit<TaskRecord, "owner" | "version"> = {
      id: this.id,
      sourceCallId: this.sourceCallId,
      config: this.config,
      transcript: this.transcript,
      attempt: this.attempt,
      prompt: this.prompt,
      assignment: this.assignment,
      outcome,
    };

    if (this.sessionId !== undefined) record.sessionId = this.sessionId;

    if (this.plan !== undefined) record.plan = this.plan;
    this.parent.record(record);
  }

  summary(view: "list" | "inspect" | "receipt") {
    const summary = {
      id: this.id,
      status: this.status,
      attempt: this.attempt,
      model: this.config.selector,
      readonly: this.config.readonly,
      transcript: this.transcript,
      output: view === "list" ? undefined : this.output,
      error: view === "list" ? this.error?.slice(0, 160) : this.error,
    };

    if (view === "receipt") return summary;

    return {
      ...summary,
      prompt: view === "list" ? this.prompt.slice(0, 160) : this.prompt,
      sourceCallId: this.sourceCallId,
      profile: this.config.profile,
      thinking: this.config.selector.slice(this.config.selector.lastIndexOf(":") + 1),
      cwd: this.config.cwd,
    };
  }

  inspect() {
    const summary = this.summary("inspect");

    if (this.status === "completed" || this.status === "failed")
      this.inspectedAttempt = this.attempt;

    return summary;
  }

  private check() {
    this.parent.check();

    if (this.cancelled) throw new Error("Child cancelled");
  }

  start(prompt: string, background: boolean, initialize: () => Promise<AgentSession>) {
    this.parent.check();

    if (this.busy) throw new Error("Child still active");

    if (this.disposed)
      throw new Error("Child session was disposed after startup failure; start a new child");

    if (this.attempt === 0) this.assignment = prompt;
    this.attempt++;
    this.status = "running";
    this.cancelled = false;
    this.cancellation = undefined;
    this.scope.active = true;
    this.scope.deliveryError = undefined;
    this.output = undefined;
    this.error = undefined;
    this.prompt = prompt;
    const turn = Symbol();
    this.turn = turn;
    this.save();
    this.work = this.execute(prompt, initialize).then(() => {
      this.save();

      if (
        background &&
        !this.cancelled &&
        (this.status === "completed" || this.status === "failed")
      ) {
        const attempt = this.attempt;

        this.parent.post(
          { id: this.id, attempt, status: this.status },
          this.status === "completed" ? (this.output ?? "") : (this.error ?? "Child failed"),
          () => this.turn === turn && !this.cancelled && this.inspectedAttempt !== attempt,
        );
      }
    });
  }

  private async execute(prompt: string, initialize: () => Promise<AgentSession>) {
    let ready = this.session !== undefined;

    try {
      this.check();
      const session = this.session ?? (await initialize());
      ready = true;
      this.check();

      const request =
        prompt === this.assignment || session.messages.some((item) => item.role === "user")
          ? prompt
          : `Original assignment:\n${this.assignment}\n\nCurrent request:\n${prompt}`;

      await session.prompt(request);
      this.readOutput(session);
      await this.scope.settle(session);
      this.check();
      this.readOutput(session);
      this.status = "completed";
    } catch (error) {
      this.error = String(error);
      await Promise.all([
        this.scope.cancelChildren(this.cancelled ? this.cancellationOutcome : "cancelled"),
        this.session?.abort(),
      ]);

      if (!ready && this.session) await this.disposeSession();

      this.status = this.cancelled ? this.cancellationOutcome : "failed";
    }
  }

  private readOutput(session: AgentSession) {
    const last = session.messages.findLast((item) => item.role === "assistant");

    if (last?.role !== "assistant") throw new Error("No assistant result");

    if (last.stopReason === "error" || last.stopReason === "aborted")
      throw new Error(last.errorMessage ?? last.stopReason);
    this.output = last.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("");
  }

  cancel(reason: "cancelled" | "interrupted" = "cancelled"): Promise<void> {
    if (!this.busy) {
      if (reason === "cancelled" && this.status === "interrupted") {
        this.status = "cancelled";
        this.save();
        cancelSavedChildren({
          transcript: this.transcript,
          sessionId: this.sessionId,
          depth: this.scope.depth,
        });
      }

      return Promise.resolve();
    }

    if (this.cancellation) return this.cancellation;
    this.cancelled = true;
    this.cancellationOutcome = reason;
    this.status = "cancelling";
    this.save();
    this.scope.active = false;
    this.cancellation = Promise.resolve().then(async () => {
      await Promise.all([this.scope.cancelChildren(reason), this.session?.abort()]);
      await this.work;
    });

    return this.cancellation;
  }

  private async disposeSession() {
    if (!this.session || this.disposed) return;
    this.disposed = true;

    try {
      await this.session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
    } finally {
      this.observation?.dispose();
      this.session.dispose();
    }
  }

  async dispose() {
    await this.cancel("interrupted");
    await this.work;
    await this.scope.dispose();
    await this.disposeSession();
  }

  initialize(pi: ExtensionAPI, ctx: ExtensionContext, configure: ConfigureRuntime) {
    return createChildSession(
      pi,
      ctx,
      {
        ...this.config,
        selection: selectModel(this.config.selector, ctx),
        transcript: this.transcript,
        sessionId: this.sessionId,
        plan: this.plan,
      },
      (api) => {
        configure(api, { profile: this.config.profile });
        installExecutor(api, configure, this.scope);
      },
      {
        check: () => this.check(),
        attach: (session) => {
          this.session = session;
          this.observation = new LiveTranscript(session, () => this.parent.changed());
          this.sessionId = session.sessionManager.getSessionId();
          this.save();
        },
        plan: (plan) => {
          this.plan = plan;
          this.save();
        },
      },
    );
  }
}

function configuration(request: Request, scope: TaskScope, ctx: ExtensionContext): Configuration {
  if (scope.depth >= 2) throw new Error("Maximum PStack delegation depth is two");

  if (scope.readonly && request.readonly === false)
    throw new Error("Readonly child cannot escalate");
  const profile = request.subagent_type ?? "generalPurpose";
  const readonly = scope.readonly || (request.readonly ?? false);

  if (readonly && profile === "Comment Sicko")
    throw new Error("Comment Sicko requires writable tools");

  return {
    profile,
    readonly,
    cwd: resolve(ctx.cwd, request.cwd ?? "."),
    selector: selectModel(request.model, ctx).selector,
  };
}

function resume(scope: TaskScope, request: Request, ctx: ExtensionContext) {
  const child = scope.require(request.resume ?? "");

  if (child.busy) throw new Error("Child still active");
  const config = child.config;

  const changed =
    (request.subagent_type !== undefined && request.subagent_type !== config.profile) ||
    (request.readonly !== undefined && request.readonly !== config.readonly) ||
    (request.cwd !== undefined && resolve(ctx.cwd, request.cwd) !== config.cwd) ||
    (request.model !== undefined && selectModel(request.model, ctx).selector !== config.selector);

  if (changed) throw new Error("Resume cannot change child configuration");

  return child;
}

export function installExecutor(
  pi: ExtensionAPI,
  configure: ConfigureRuntime,
  owned?: TaskScope,
): void {
  let context: ExtensionContext | undefined;
  let observer: ReturnType<typeof installObserver> | undefined;

  const fresh = () =>
    new TaskScope(
      0,
      false,
      {
        busy: (content) => pi.sendMessage(message(content), busyDelivery),
        idle: (content) => pi.sendUserMessage(content, idleDelivery),
      },
      () => context?.isIdle() === false,
      () => observer?.refresh(),
    );

  let scope = owned ?? fresh();
  let shutdown = false;
  let userInput = false;

  const retire = async (_event: ExtensionEvent, ctx: ExtensionContext) => {
    const previous = scope;
    observer?.reset();
    await previous.dispose();

    if (!owned && !shutdown) scope = fresh();

    if (ctx.hasUI) ctx.ui.setStatus("pstack", undefined);
  };

  pi.on("session_before_tree", retire);
  pi.on("session_before_switch", retire);
  pi.on("session_before_fork", retire);
  pi.on("session_shutdown", async (event, ctx) => {
    shutdown = true;
    await retire(event, ctx);
  });
  pi.on("session_start", (_event, ctx) => {
    context = ctx;

    if (!owned && shutdown) {
      shutdown = false;
      scope = fresh();
    }

    scope.bind(pi, ctx);
  });
  pi.on("session_tree", (_event, ctx) => scope.bind(pi, ctx));
  pi.on("agent_end", () => scope.flush());
  pi.on("agent_settled", () => scope.settled());
  pi.on("message_start", (event) => {
    if (event.message.role === "user")
      scope.acceptedUserMessage(contentText(event.message.content));
    else if (event.message.role === "custom" && event.message.customType === "pstack-task-result")
      scope.acceptedSteering(contentText(event.message.content));
  });
  pi.on("session_before_compact", () => scope.compact(true));
  pi.on("session_compact", () => {
    setImmediate(() => scope.compact(false));
  });
  pi.on("session_compact_failed", () => {
    setImmediate(() => scope.compact(false));
  });
  pi.on("input", (event) => {
    userInput = event.source !== "extension";
  });
  pi.on("before_agent_start", (_event, ctx) => {
    if (!userInput) return undefined;
    userInput = false;
    observer?.bind(ctx);
    scope.bind(pi, ctx);
    const recovered = scope.recovery();

    return recovered ? { message: recovered } : undefined;
  });

  if (!owned)
    observer = installObserver(pi, () => {
      if (context) scope.bind(pi, context);

      return scope.views();
    });

  pi.registerTool({
    name: "pstack_tasks",
    label: "PStack tasks",
    description:
      "List children, inspect an exact child and its saved result or transcript, or cancel descendants. Background final reports arrive automatically; inspect only for progress, debugging, recovery, or oversized detail. Cancellation does not undo edits. Reopened sessions restore owned tasks without restarting them. Completion reports execution, not acceptance.",
    parameters: Type.Object({
      action: Type.Union([Type.Literal("list"), Type.Literal("inspect"), Type.Literal("cancel")]),
      id: Type.Optional(Type.String()),
    }),
    async execute(_id, params, _signal, _update, ctx) {
      const owner = scope;
      owner.bind(pi, ctx);

      if (params.action === "list")
        return textResult([...owner.children.values()].map((child) => child.summary("list")));
      const child = owner.require(params.id ?? "");

      if (params.action === "cancel") await child.cancel();

      return textResult(params.action === "inspect" ? child.inspect() : child.summary("receipt"));
    },
  });
  pi.registerTool({
    name: "pstack_task",
    label: "PStack task",
    executionMode: "parallel",
    description:
      "Run or resume a PStack child with its own conversation. Children belong to their parent's saved branch. Navigation, reload, or exit interrupts active execution. Reopening restores records only; explicitly resume an interrupted ID after reconciling prior tool effects. Root and direct children can delegate; grandchildren cannot. Background final reports arrive automatically, bounded to 16 KiB; inspect only for progress, debugging, recovery, or oversized detail. While required results are outstanding, continue independent work or yield without a final answer; do not poll.",
    parameters: TaskInput,
    async execute(_id, request, signal, _update, ctx) {
      signal?.throwIfAborted();
      const owner = scope;
      owner.bind(pi, ctx);
      owner.check();

      const child =
        request.resume !== undefined
          ? resume(owner, request, ctx)
          : new ChildTask(owner, configuration(request, owner, ctx), undefined, _id);

      owner.children.set(child.id, child);
      const background = request.run_in_background ?? child.config.profile === "poteto-agent";
      child.start(request.prompt, background, () => child.initialize(pi, ctx, configure));

      if (background) return textResult(child.summary("receipt"));

      const abort = () => {
        void child.cancel();
      };

      signal?.addEventListener("abort", abort, { once: true });

      try {
        if (signal?.aborted === true) await child.cancel();
        await child.work;
      } finally {
        signal?.removeEventListener("abort", abort);
      }

      if (child.status !== "completed")
        throw new Error(
          `Child ${child.id} attempt ${child.attempt} ${child.status}: ${child.error ?? "cancelled"}`,
        );

      return textResult(child.summary("receipt"));
    },
  });
}
