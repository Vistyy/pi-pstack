import {
  type ExtensionUIContext,
  getMarkdownTheme,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import {
  type Component,
  Editor,
  Key,
  type KeybindingsManager,
  Markdown,
  matchesKey,
  SelectList,
  type TUI,
  truncateToWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

export type Question = { id: string; question: string; options: string[] };

export type QuestionAnswer = { id: string; kind: "option" | "other"; value: string };

export type QuestionnaireResult =
  | { status: "answered"; answers: QuestionAnswer[] }
  | { status: "cancelled"; answers: [] };

type QuestionnaireUI = {
  custom(
    factory: (
      tui: TUI,
      theme: Theme,
      keys: KeybindingsManager,
      done: (value: QuestionnaireResult) => void,
    ) => Component,
    options: Parameters<ExtensionUIContext["custom"]>[1],
  ): Promise<QuestionnaireResult>;
};

const cancelled = (): QuestionnaireResult => ({ status: "cancelled", answers: [] });

export async function showQuestionnaire(
  ui: QuestionnaireUI,
  questions: Question[],
  signal: AbortSignal | undefined,
): Promise<QuestionnaireResult> {
  const isAborted = () => signal?.aborted ?? false;

  if (isAborted()) return cancelled();
  let close: (() => void) | undefined;
  const onAbort = () => close?.();
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    const result = await ui.custom(
      (tui, theme, keys, done) => {
        const component = createQuestionnaire(tui, theme, keys, questions, done);
        close = component.cancel;

        if (isAborted()) queueMicrotask(close);

        return component;
      },
      { overlay: true, overlayOptions: { width: "100%", maxHeight: "100%" } },
    );

    return isAborted() ? cancelled() : result;
  } finally {
    signal?.removeEventListener("abort", onAbort);
    close = undefined;
  }
}

function createQuestionnaire(
  tui: TUI,
  theme: Theme,
  keys: KeybindingsManager,
  questions: Question[],
  done: (result: QuestionnaireResult) => void,
) {
  let finished = false;

  const finish = (value: QuestionnaireResult) => {
    if (finished) return;
    finished = true;
    done(value);
  };

  const listTheme = {
    selectedPrefix: (s: string) => theme.fg("accent", s),
    selectedText: (s: string) => theme.fg("accent", s),
    description: (s: string) => theme.fg("muted", s),
    scrollInfo: (s: string) => theme.fg("dim", s),
    noMatch: (s: string) => theme.fg("warning", s),
  };

  const pages = questions.map((question) => ({
    question,
    body: new Markdown(question.question, 0, 0, getMarkdownTheme()),
    list: new SelectList(
      [
        ...question.options.map((label, index) => ({ label, value: String(index) })),
        { label: "Other (write an answer)", value: "other" },
      ],
      Math.min(question.options.length + 1, 5),
      listTheme,
    ),
  }));

  const editor = new Editor(tui, {
    borderColor: (s) => theme.fg("accent", s),
    selectList: listTheme,
  });

  const answers = new Map<string, QuestionAnswer>();
  let page = 0;
  let selected = 0;
  let editing = false;
  let focused = false;
  let bodyOffset = 0;
  let bodyHeight = 1;
  let warning = "";
  let fits = true;
  const refresh = () => tui.requestRender();

  const current = () => {
    const entry = pages[page];

    if (!entry) throw new Error("No active question on the review page.");

    return entry;
  };

  const selectPage = (index: number) => {
    page = index;
    bodyOffset = 0;
    warning = "";

    if (page < pages.length) {
      const { question, list } = current();
      const answer = answers.get(question.id);
      selected =
        answer?.kind === "other"
          ? question.options.length
          : Math.max(0, question.options.indexOf(answer?.value ?? ""));
      list.setSelectedIndex(selected);
    }

    refresh();
  };

  const save = (kind: QuestionAnswer["kind"], value: string) => {
    const { question } = current();
    answers.set(question.id, { id: question.id, kind, value });
    editing = false;
    editor.focused = false;
    selectPage(page + 1);
  };

  editor.disableSubmit = true;

  const answerOther = () => {
    const text = editor.getExpandedText();

    if (!text.trim()) {
      warning = "Other cannot be blank";
      refresh();

      return;
    }

    save("other", text);
  };

  const confirmChoice = () => {
    const { question } = current();

    if (selected === question.options.length) {
      editing = true;
      editor.focused = focused;
      const answer = answers.get(question.id);
      editor.setText(answer?.kind === "other" ? answer.value : "");
    } else {
      const value = question.options[selected];

      if (value === undefined) throw new Error("No selected option.");
      save("option", value);
    }
  };

  const handleChoice = (data: string) => {
    const { question, list } = current();
    const count = question.options.length + 1;

    if (keys.matches(data, "tui.select.up")) selected = (selected + count - 1) % count;

    if (keys.matches(data, "tui.select.down")) selected = (selected + 1) % count;
    list.setSelectedIndex(selected);

    if (keys.matches(data, "tui.select.confirm")) confirmChoice();
    refresh();
  };

  const handleEditing = (data: string) => {
    if (keys.matches(data, "tui.select.cancel")) {
      editing = false;
      editor.focused = false;
      warning = "";
    } else if (keys.matches(data, "tui.input.newLine")) editor.handleInput(data);
    else if (keys.matches(data, "tui.input.submit")) answerOther();
    else editor.handleInput(data);
    refresh();
  };

  const navigate = (data: string) => {
    if (keys.matches(data, "tui.select.cancel")) {
      finish(cancelled());

      return true;
    }

    if (matchesKey(data, Key.pageUp) || matchesKey(data, Key.pageDown)) {
      bodyOffset = Math.max(
        0,
        bodyOffset + (matchesKey(data, Key.pageUp) ? -bodyHeight : bodyHeight),
      );
      refresh();

      return true;
    }

    if (matchesKey(data, Key.left) && page > 0) {
      selectPage(page - 1);

      return true;
    }

    if (matchesKey(data, Key.right) && page < pages.length) {
      selectPage(page + 1);

      return true;
    }

    return false;
  };

  const submit = (data: string) => {
    if (!keys.matches(data, "tui.select.confirm")) return;

    if (answers.size !== questions.length) {
      warning = "Answer every question";
      refresh();

      return;
    }

    const ordered = questions.map((question) => {
      const answer = answers.get(question.id);

      if (!answer) throw new Error("Question is unanswered.");

      return answer;
    });

    finish({ status: "answered", answers: ordered });
  };

  const viewport = (body: string[], budget: number) => {
    const scrolls = body.length > budget;
    bodyHeight = Math.max(1, budget - (scrolls ? 1 : 0));
    bodyOffset = Math.min(bodyOffset, Math.max(0, body.length - bodyHeight));
    const visible = body.slice(bodyOffset, bodyOffset + bodyHeight);

    if (scrolls && budget > 1)
      visible.push(
        theme.fg(
          "dim",
          `Lines ${bodyOffset + 1}-${bodyOffset + visible.length}/${body.length} • PgUp/PgDn`,
        ),
      );

    return visible;
  };

  const review = (width: number) =>
    questions.flatMap((question) => {
      const answer = answers.get(question.id);

      const value = answer
        ? `${answer.kind === "other" ? "Other: " : ""}${answer.value}`
        : "Unanswered";

      return wrapTextWithAnsi(`${question.id}: ${value}`, width);
    });

  const hint = (id: Parameters<typeof keys.getKeys>[0]) => keys.getKeys(id).join("/");

  const help = () => {
    const cancel = hint("tui.select.cancel");

    if (editing)
      return `${hint("tui.input.submit")} save & next • ${cancel} choices • ${hint("tui.input.newLine")} newline`;

    if (page === pages.length)
      return `← questions • ${hint("tui.select.confirm")} Submit • ${cancel} cancel • PgUp/PgDn scroll text`;

    return `${hint("tui.select.up")}/${hint("tui.select.down")} choose • ${hint("tui.select.confirm")} answer & next • ←→ questions • PgUp/PgDn scroll text • ${cancel} cancel`;
  };

  return {
    cancel: () => finish(cancelled()),
    get focused() {
      return focused;
    },
    set focused(value: boolean) {
      focused = value;
      editor.focused = value && editing;
    },
    invalidate() {
      for (const entry of pages) {
        entry.body.invalidate();
        entry.list.invalidate();
      }

      editor.invalidate();
    },
    handleInput(data: string) {
      if (finished) return;

      if (!fits) {
        if (keys.matches(data, "tui.select.cancel")) finish(cancelled());

        return;
      }

      if (editing) {
        handleEditing(data);

        return;
      }

      if (navigate(data)) return;

      if (page === pages.length) submit(data);
      else handleChoice(data);
    },
    render(width: number) {
      const w = Math.max(1, width);
      const isReview = page === pages.length;

      const title = isReview
        ? `Review • ${answers.size}/${questions.length} answered`
        : `Question ${page + 1}/${questions.length}${editing ? " • Other" : ""}`;

      const helpLines = wrapTextWithAnsi(theme.fg("dim", help()), w);
      const budget = Math.max(1, tui.terminal.rows - 1 - helpLines.length - (warning ? 1 : 0));
      const lines = [theme.fg("accent", truncateToWidth(title, w))];

      if (isReview) lines.push(...viewport(review(w), budget));
      else {
        const { body, list } = current();
        const options = editing ? editor.render(w) : list.render(w);
        lines.push(...viewport(body.render(w), Math.max(1, budget - options.length)), ...options);
      }

      if (warning) lines.push(theme.fg("warning", warning));
      lines.push(...helpLines);
      fits = lines.length <= tui.terminal.rows;

      const rendered = fits
        ? lines
        : wrapTextWithAnsi(
            `Enlarge the terminal to answer. ${hint("tui.select.cancel")} cancels.`,
            w,
          ).slice(0, tui.terminal.rows);

      return rendered.map((line) => truncateToWidth(line, w));
    },
  };
}
