import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type {
  AgentSession,
  ExtensionAPI,
  ExtensionContext,
  ExtensionEvent,
} from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import {
  type ConfigureRuntime,
  createChildSession,
  type Profile,
  type Selection,
  selectModel,
} from "./child-session.js";

const TaskInput = Type.Object({
  prompt: Type.String({ minLength: 1 }),
  subagent_type: Type.Optional(
    Type.Union([
      Type.Literal("generalPurpose"),
      Type.Literal("poteto-agent"),
      Type.Literal("Comment Sicko"),
    ]),
  ),
  model: Type.Optional(Type.String()),
  readonly: Type.Optional(Type.Boolean()),
  run_in_background: Type.Optional(Type.Boolean()),
  cwd: Type.Optional(Type.String()),
  resume: Type.Optional(Type.String()),
});

type Request = Static<typeof TaskInput>;

type Status = "running" | "cancelling" | "completed" | "failed" | "cancelled";

type Configuration = { profile: Profile; cwd: string; readonly: boolean; selection: Selection };

type Notify = (content: string) => Promise<void>;

type Summary = ReturnType<ChildTask["summary"]>;

const textResult = (value: Summary | Summary[]) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value) }],
  details: {},
});

const message = (content: string) => ({ customType: "pstack-task-result", content, display: true });

const delivery = { triggerTurn: true, deliverAs: "followUp" as const };

class TaskScope {
  readonly children = new Map<string, ChildTask>();
  readonly deliveries = new Set<Promise<void>>();
  active = true;
  deliveryError: Error | undefined;

  constructor(
    readonly depth: number,
    readonly readonly: boolean,
    readonly notify: Notify,
  ) {}

  check() {
    if (!this.active) throw new Error("Owner session is closing or cancelled");
  }

  require(id: string) {
    const child = this.children.get(id);

    if (!child) throw new Error("Unknown owned child ID");

    return child;
  }

  post(content: string, current: () => boolean) {
    const pending = Promise.resolve()
      .then(async () => {
        if (this.active && current()) await this.notify(content);
      })
      .catch((error: unknown) => {
        this.deliveryError = new Error(String(error), { cause: error });
      });

    this.deliveries.add(pending);
    void pending.then(() => {
      this.deliveries.delete(pending);
    });
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

  async cancelChildren() {
    this.active = false;
    await Promise.all([...this.children.values()].map((child) => child.cancel()));
    await Promise.all([...this.deliveries]);
  }

  async dispose() {
    await this.cancelChildren();
    await Promise.all([...this.children.values()].map((child) => child.dispose()));
    this.children.clear();
  }
}

class ChildTask {
  readonly id = randomUUID();
  readonly scope: TaskScope;
  status: Status = "completed";
  session: AgentSession | undefined;
  work: Promise<void> = Promise.resolve();
  output: string | undefined;
  error: string | undefined;
  prompt = "";
  private cancelled = false;
  private cancellation: Promise<void> | undefined;
  private turn = Symbol();
  private disposed = false;

  constructor(
    readonly parent: TaskScope,
    readonly config: Configuration,
  ) {
    this.scope = new TaskScope(parent.depth + 1, config.readonly, async (content) => {
      if (!this.session) throw new Error("Child session is not initialized");
      await this.session.sendCustomMessage(message(content), delivery);
    });
  }

  get busy() {
    return this.status === "running" || this.status === "cancelling";
  }

  summary() {
    return {
      id: this.id,
      status: this.status,
      prompt: this.prompt,
      profile: this.config.profile,
      model: this.config.selection.selector,
      thinking: this.config.selection.thinking,
      cwd: this.config.cwd,
      readonly: this.config.readonly,
      transcript: this.session?.sessionFile,
      output: this.output,
      error: this.error,
    };
  }

  private check() {
    this.parent.check();

    if (this.cancelled) throw new Error("Child cancelled");
  }

  start(
    prompt: string,
    background: boolean,
    initialize: () => Promise<AgentSession>,
    progress: () => void,
  ) {
    this.parent.check();

    if (this.busy) throw new Error("Child still active");

    if (this.disposed)
      throw new Error("Child session was disposed after startup failure; start a new child");
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
    progress();
    this.work = this.execute(prompt, initialize).then(() => {
      progress();

      if (background && !this.cancelled) {
        this.parent.post(
          JSON.stringify(this.summary()),
          () => this.turn === turn && !this.cancelled,
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
      await session.prompt(prompt);
      this.readOutput(session);
      await this.scope.settle(session);
      this.check();
      this.readOutput(session);
      this.status = "completed";
    } catch (error) {
      this.error = String(error);
      await Promise.all([this.scope.cancelChildren(), this.session?.abort()]);

      if (!ready && this.session) await this.disposeSession();

      this.status = this.cancelled ? "cancelled" : "failed";
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

  cancel(): Promise<void> {
    if (!this.busy) return Promise.resolve();
    this.cancelled = true;
    this.status = "cancelling";
    this.scope.active = false;
    this.cancellation ??= Promise.resolve().then(async () => {
      await Promise.all([this.scope.cancelChildren(), this.session?.abort()]);
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
      this.session.dispose();
    }
  }

  async dispose() {
    await this.cancel();
    await this.scope.dispose();
    await this.disposeSession();
  }

  initialize(pi: ExtensionAPI, ctx: ExtensionContext, configure: ConfigureRuntime) {
    return createChildSession(
      pi,
      ctx,
      this.config,
      (api) => {
        configure(api, { profile: this.config.profile });
        installExecutor(api, configure, this.scope);
      },
      {
        check: () => this.check(),
        attach: (session) => {
          this.session = session;
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
    selection: selectModel(request.model, ctx),
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
    (request.model !== undefined &&
      selectModel(request.model, ctx).selector !== config.selection.selector);

  if (changed) throw new Error("Resume cannot change child configuration");

  return child;
}

/** Owns one live parent's children; branch replacement retires the entire scope. */
export function installExecutor(
  pi: ExtensionAPI,
  configure: ConfigureRuntime,
  owned?: TaskScope,
): void {
  const fresh = () =>
    new TaskScope(0, false, async (content) => {
      pi.sendMessage(message(content), delivery);
    });

  let scope = owned ?? fresh();
  let shutdown = false;

  const retire = async (_event: ExtensionEvent, ctx: ExtensionContext) => {
    const previous = scope;
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
  pi.on("session_start", () => {
    if (!owned && shutdown) {
      shutdown = false;
      scope = fresh();
    }
  });

  const progress = (owner: TaskScope, ctx: ExtensionContext) => {
    if (!owner.active || !ctx.hasUI) return;
    const count = [...owner.children.values()].filter((child) => child.busy).length;
    ctx.ui.setStatus("pstack", count ? `PStack: ${count} active` : undefined);
  };

  pi.registerTool({
    name: "pstack_tasks",
    label: "PStack tasks",
    description:
      "List this parent's children, inspect an exact child and its transcript/result, or cancel that child and its descendants. Completion reports execution, not acceptance of its work.",
    parameters: Type.Object({
      action: Type.Union([Type.Literal("list"), Type.Literal("inspect"), Type.Literal("cancel")]),
      id: Type.Optional(Type.String()),
    }),
    async execute(_id, params, _signal, _update, ctx) {
      const owner = scope;

      if (params.action === "list")
        return textResult([...owner.children.values()].map((child) => child.summary()));
      const child = owner.require(params.id ?? "");

      if (params.action === "cancel") await child.cancel();
      progress(owner, ctx);

      return textResult(child.summary());
    },
  });
  pi.registerTool({
    name: "pstack_task",
    label: "PStack task",
    executionMode: "parallel",
    description:
      "Run or resume a PStack child with its own conversation. Supply the complete assignment and an exact provider/model:thinking selector, or omit model to inherit. Background calls return an ID; completion is delivered automatically. Resume keeps the child's context and configuration.",
    parameters: TaskInput,
    async execute(_id, request, signal, _update, ctx) {
      signal?.throwIfAborted();
      const owner = scope;
      owner.check();

      const child =
        request.resume !== undefined
          ? resume(owner, request, ctx)
          : new ChildTask(owner, configuration(request, owner, ctx));

      owner.children.set(child.id, child);
      const background = request.run_in_background ?? child.config.profile === "poteto-agent";
      child.start(
        request.prompt,
        background,
        () => child.initialize(pi, ctx, configure),
        () => progress(owner, ctx),
      );

      if (background) return textResult(child.summary());

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
        throw new Error(`Child ${child.id} ${child.status}: ${child.error ?? "cancelled"}`);

      return textResult(child.summary());
    },
  });
}
