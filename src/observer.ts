import type {
  ExtensionAPI,
  ExtensionContext,
  Theme,
  ThemeColor,
} from "@earendil-works/pi-coding-agent";
import {
  type Component,
  matchesKey,
  type TUI,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { activityCounts, type ObservedTask, SavedTranscripts } from "./observer-state.js";
import { ObserverTranscript } from "./observer-transcript.js";

type Row = { task: ObservedTask; depth: number; nested: boolean };

type Snapshot = { kind: "tasks"; tasks: ObservedTask[] } | { kind: "error"; message: string };

const title = (task: ObservedTask) => task.title.replace(/\s+/g, " ").trim() || task.id;

const numbers = new Intl.NumberFormat("en-US");

const statusColors = {
  running: "accent",
  waiting: "warning",
  cancelling: "warning",
  completed: "success",
  failed: "error",
  cancelled: "muted",
  interrupted: "warning",
} satisfies Record<ObservedTask["status"], ThemeColor>;

function renderActivityRail(snapshot: Snapshot, theme: Theme, width: number) {
  if (snapshot.kind === "error")
    return [truncateToWidth(theme.fg("error", snapshot.message), width)];
  const counts = activityCounts(snapshot.tasks);

  const activity = `${counts.running} running · ${counts.waiting} waiting`;

  return [
    truncateToWidth(
      `${theme.fg("accent", "Subagents")}  ${activity}  ${theme.fg("muted", "/subagents")}`,
      width,
    ),
  ];
}

class ObserverPanel implements Component {
  private readonly history = new SavedTranscripts();
  private readonly collapsed = new Set<string>();
  private rows: Row[] = [];
  private selected = "";
  private transcriptOnly = false;
  private scroll: number | null = null;
  private top = 0;
  private pageHeight = 10;
  private expanded = true;
  private native: { id: string; view: ObserverTranscript } | undefined;

  constructor(
    private readonly tui: TUI,
    private readonly theme: Theme,
    private readonly snapshot: () => Snapshot,
    private readonly done: () => void,
  ) {}

  private collect(tasks: ObservedTask[], depth = 0) {
    for (const task of tasks) {
      const children =
        depth < 1
          ? task.source.kind === "live"
            ? task.source.children
            : this.history.read(task).children
          : [];

      this.rows.push({ task, depth, nested: children.length > 0 });

      if (!this.collapsed.has(task.id)) this.collect(children, depth + 1);
    }
  }

  private tree(width: number, height: number) {
    const selectedIndex = Math.max(
      0,
      this.rows.findIndex((row) => row.task.id === this.selected),
    );

    const start = Math.max(0, selectedIndex - Math.floor(height / 4) + 1);

    return this.rows.slice(start).flatMap(({ task, depth, nested }) => {
      const branch = nested ? (this.collapsed.has(task.id) ? "+" : "−") : "·";
      const prefix = `${task.id === this.selected ? ">" : " "} ${"  ".repeat(depth)}${branch} `;

      const color = statusColors[task.status];

      return [
        truncateToWidth(
          task.id === this.selected
            ? this.theme.fg("accent", prefix + title(task))
            : prefix + title(task),
          width,
        ),
        truncateToWidth(`  ${this.theme.fg(color, task.status)}`, width),
        truncateToWidth(this.theme.fg("dim", `  ${task.activity.replace(/\s+/g, " ")}`), width),
        "",
      ];
    });
  }

  private transcript(task: ObservedTask | undefined, width: number, height: number) {
    if (!task) return [this.theme.fg("muted", "No subagents to inspect.")];

    if (this.native?.id !== task.id)
      this.native = { id: task.id, view: new ObserverTranscript(this.tui, task.cwd) };
    const view = this.history.read(task);
    const lines = this.native.view.render(view.transcript, width, this.expanded);

    if (view.notice) lines.push(this.theme.fg("warning", view.notice));

    if (lines.length === 0) lines.push(this.theme.fg("muted", task.activity || task.status));
    const total = lines.length;
    const separator = task.model.lastIndexOf(":");
    const usage = view.transcript.usage;

    const summary = [
      `Model ${task.model.slice(0, separator)} · Thinking ${task.model.slice(separator + 1)}`,
      ...(usage
        ? [
            `Tokens in ${numbers.format(usage.tokens.input)} · out ${numbers.format(usage.tokens.output)} · cache read ${numbers.format(usage.tokens.cacheRead)} · write ${numbers.format(usage.tokens.cacheWrite)}`,
            `Own session ${numbers.format(usage.tokens.total)} tokens · Pi estimate $${usage.cost.toFixed(4)}`,
          ]
        : ["Session usage unavailable"]),
    ].flatMap((line) => wrapTextWithAnsi(this.theme.fg("dim", line), width));

    const header = [
      truncateToWidth(this.theme.bold(title(task)), width),
      ...summary,
      truncateToWidth(this.theme.fg("dim", `Task ${task.id}`), width),
    ];

    if (header.length + 2 > height)
      return [this.theme.fg("muted", "Enlarge terminal for task details.")];
    this.pageHeight = height - header.length - 1;
    const max = Math.max(0, lines.length - this.pageHeight);
    this.top = this.scroll === null ? max : Math.min(this.scroll, max);

    return [
      ...header,
      truncateToWidth(
        this.theme.fg(
          "dim",
          `${this.scroll === null ? "Latest output" : "Earlier output"} · Lines ${this.top + 1}-${Math.min(total, this.top + this.pageHeight)} of ${total}`,
        ),
        width,
      ),
      ...lines.slice(this.top, this.top + this.pageHeight),
    ];
  }

  private body(width: number, height: number) {
    const chosen = this.rows.find((row) => row.task.id === this.selected)?.task;

    if (this.transcriptOnly) return this.transcript(chosen, width, height);

    if (width < 76)
      return this.rows.length ? this.tree(width, height) : ["No subagents to inspect."];
    const leftWidth = Math.min(30, Math.floor(width * 0.3));
    const left = this.tree(leftWidth, height);
    const right = this.transcript(chosen, width - leftWidth - 3, height);

    return Array.from({ length: height }, (_unused, index) => {
      const line = left[index] ?? "";

      return `${line}\x1b[0m${" ".repeat(Math.max(0, leftWidth - visibleWidth(line)))} ${this.theme.fg("borderMuted", "│")} ${right[index] ?? ""}`;
    });
  }

  render(width: number) {
    if (width < 12 || this.tui.terminal.rows < 10)
      return [truncateToWidth("Enlarge terminal. Esc closes.", width)];
    this.rows = [];
    const snapshot = this.snapshot();

    if (snapshot.kind === "error")
      return this.frame(width, [
        this.theme.fg("accent", "Subagents"),
        "",
        this.theme.fg("error", snapshot.message),
        "",
        this.theme.fg("muted", "Esc closes the observer."),
      ]);
    this.collect(snapshot.tasks);

    if (!this.rows.some((row) => row.task.id === this.selected))
      this.selected = this.rows[0]?.task.id ?? "";
    const inner = Math.max(1, width - 4);
    const height = Math.max(1, Math.floor(this.tui.terminal.rows * 0.94) - 7);
    const body = this.body(inner, height).slice(0, height);

    while (body.length < height) body.push("");
    const counts = activityCounts(snapshot.tasks);
    const heading = `Subagents    ${counts.running} running · ${counts.waiting} waiting`;

    const content = [
      this.theme.fg("accent", heading),
      this.theme.fg("dim", "Read-only observer · Native Pi transcript"),
      "",
      ...body,
      this.theme.fg("muted", "↑↓ select · ←→ fold · Enter transcript · Esc back/close"),
      this.theme.fg("muted", "PgUp/Dn scroll · Home start · End latest · Ctrl+O tools"),
    ];

    return this.frame(width, content);
  }

  private frame(width: number, content: string[]) {
    const inner = width - 4;

    return [
      this.theme.fg("border", `╭${"─".repeat(width - 2)}╮`),
      ...content.map((line) => {
        const cut = truncateToWidth(line, inner);

        return `${this.theme.fg("border", "│")} ${cut}\x1b[0m${" ".repeat(Math.max(0, inner - visibleWidth(cut)))} ${this.theme.fg("border", "│")}`;
      }),
      this.theme.fg("border", `╰${"─".repeat(width - 2)}╯`),
    ];
  }

  private select(delta: number) {
    const index = this.rows.findIndex((row) => row.task.id === this.selected);
    const target = Math.max(0, Math.min(this.rows.length - 1, index + delta));
    this.selected = this.rows[target]?.task.id ?? this.selected;
    this.scroll = null;
  }

  handleInput(key: string) {
    const actions: [Parameters<typeof matchesKey>[1], () => void][] = [
      [
        "escape",
        () => {
          if (this.transcriptOnly) this.transcriptOnly = false;
          else this.done();
        },
      ],
      ["up", () => this.select(-1)],
      ["down", () => this.select(1)],
      [
        "left",
        () => {
          this.collapsed.add(this.selected);
        },
      ],
      [
        "right",
        () => {
          this.collapsed.delete(this.selected);
        },
      ],
      [
        "enter",
        () => {
          this.transcriptOnly = true;
        },
      ],
      [
        "home",
        () => {
          this.scroll = 0;
        },
      ],
      [
        "end",
        () => {
          this.scroll = null;
        },
      ],
      [
        "pageUp",
        () => {
          this.scroll = Math.max(0, this.top - this.pageHeight);
        },
      ],
      [
        "pageDown",
        () => {
          if (this.scroll !== null) this.scroll = this.top + this.pageHeight;
        },
      ],
      [
        "ctrl+o",
        () => {
          this.expanded = !this.expanded;
        },
      ],
    ];

    actions.find(([binding]) => matchesKey(key, binding))?.[1]();
    this.tui.requestRender();
  }

  invalidate() {
    this.native?.view.invalidate();
  }
  dispose() {
    this.history.clear();
    this.native = undefined;
  }
}

export function installObserver(pi: ExtensionAPI, tasks: () => ObservedTask[]) {
  let context: ExtensionContext | undefined;
  let redraw: (() => void) | undefined;
  let close: (() => void) | undefined;
  let opened = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let previous = "";

  const snapshot = (): Snapshot => {
    try {
      return { kind: "tasks", tasks: tasks() };
    } catch (error) {
      return { kind: "error", message: `Subagents unavailable. ${String(error)}` };
    }
  };

  const refresh = () => {
    if (context?.mode !== "tui" || timer !== undefined) return;
    timer = setTimeout(() => {
      timer = undefined;
      const current = snapshot();

      const counts = current.kind === "tasks" ? activityCounts(current.tasks) : undefined;
      const stamp = JSON.stringify(counts ?? current);

      if (stamp !== previous) {
        previous = stamp;
        const idle = counts !== undefined && counts.running === 0 && counts.waiting === 0;
        context?.ui.setWidget(
          "pstack-subagents",
          idle
            ? undefined
            : (_tui, theme) => ({
                render: (width) => renderActivityRail(current, theme, width),
                invalidate() {},
              }),
        );
      }

      redraw?.();
    }, 33);
    timer.unref();
  };

  const reset = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    close?.();
    context?.ui.setWidget("pstack-subagents", undefined);
    context = undefined;
    previous = "";
  };

  const bind = (ctx: ExtensionContext) => {
    context = ctx;
    refresh();
  };

  pi.on("session_start", (_event, ctx) => bind(ctx));
  pi.on("session_tree", (_event, ctx) => bind(ctx));
  pi.registerCommand("subagents", {
    description: "Inspect live and saved subagents without executing or accepting work",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui") throw new Error("The subagent observer requires Pi's terminal UI.");

      if (opened) return;
      opened = true;
      context = ctx;

      try {
        await ctx.ui.custom<void>(
          (tui, theme, _keys, done) => {
            redraw = () => tui.requestRender();
            close = done;

            return new ObserverPanel(tui, theme, snapshot, done);
          },
          { overlay: true, overlayOptions: { width: "96%", maxHeight: "94%", anchor: "center" } },
        );
      } finally {
        opened = false;
        redraw = undefined;
        close = undefined;
      }
    },
  });

  return { refresh, reset, bind };
}
