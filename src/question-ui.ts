import { type ExtensionContext, getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import {
  Editor,
  type Focusable,
  Key,
  type KeyId,
  Markdown,
  matchesKey,
  SelectList,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

export type Question = { id: string; question: string; options: string[] };

export type QuestionAnswer = { id: string; kind: "option" | "other"; value: string };

export type QuestionnaireResult =
  | { status: "answered"; answers: QuestionAnswer[] }
  | { status: "cancelled"; answers: [] };

const cancelled = (): QuestionnaireResult => ({ status: "cancelled", answers: [] });

export async function showQuestionnaire(
  ctx: ExtensionContext,
  questions: Question[],
  signal: AbortSignal | undefined,
): Promise<QuestionnaireResult> {
  if (signal?.aborted) return cancelled();
  let close: (() => void) | undefined;
  const onAbort = () => close?.();
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    const result = await ctx.ui.custom<QuestionnaireResult>((tui, theme, keys, done) => {
      let finished = false;

      const finish = (value: QuestionnaireResult) => {
        if (finished) return;
        finished = true;
        done(value);
      };

      close = () => finish(cancelled());

      if (signal?.aborted) close();

      const answers = new Map<string, QuestionAnswer>();
      let page = 0;
      let editing = false;
      let bodyOffset = 0;
      let bodyHeight = 1;
      let selected = 0;
      let warning = "";
      const bodies = questions.map((q) => new Markdown(q.question, 0, 0, getMarkdownTheme()));

      const listTheme = {
        selectedPrefix: (s: string) => theme.fg("accent", s),
        selectedText: (s: string) => theme.fg("accent", s),
        description: (s: string) => theme.fg("muted", s),
        scrollInfo: (s: string) => theme.fg("dim", s),
        noMatch: (s: string) => theme.fg("warning", s),
      };

      const editor = new Editor(tui, {
        borderColor: (s) => theme.fg("accent", s),
        selectList: listTheme,
      });

      const lists = questions.map(
        (q) =>
          new SelectList(
            [
              ...q.options.map((label, i) => ({ label, value: String(i) })),
              { label: "Other (write an answer)", value: "other" },
            ],
            Math.min(q.options.length + 1, 5),
            listTheme,
          ),
      );

      const refresh = () => tui.requestRender();
      const isKey = (data: string, key: KeyId) => data === key || matchesKey(data, key);

      const selectPage = (index: number) => {
        page = index;
        bodyOffset = 0;

        if (page < questions.length) {
          const answer = answers.get(questions[page].id);
          selected =
            answer?.kind === "other"
              ? questions[page].options.length
              : Math.max(0, questions[page].options.indexOf(answer?.value ?? ""));
          lists[page].setSelectedIndex(selected);
        }
      };

      const next = () => {
        selectPage(Math.min(page + 1, questions.length));
        warning = "";
        refresh();
      };

      const answerOther = (text: string) => {
        if (!text.trim()) {
          warning = "Other cannot be blank";
          refresh();

          return;
        }

        answers.set(questions[page].id, { id: questions[page].id, kind: "other", value: text });
        editing = false;
        editor.focused = false;
        next();
      };

      editor.onSubmit = answerOther;

      const renderReview = (width: number, lines: string[]) => {
        for (const q of questions) {
          const answer = answers.get(q.id);

          const value = answer
            ? `${answer.kind === "other" ? "Other: " : ""}${answer.value}`
            : "Unanswered";

          lines.push(...wrapTextWithAnsi(`${q.id}: ${value}`, width));
        }

        lines.push(
          answers.size === questions.length
            ? "Press Enter to Submit"
            : "Answer every question before submitting",
        );
      };

      const renderQuestion = (width: number, lines: string[]) => {
        const optionLines = editing ? editor.render(width) : lists[page].render(width);
        const available = Math.max(3, tui.terminal.rows - 9);
        bodyHeight = Math.max(1, available - optionLines.length);
        const body = bodies[page].render(width);
        bodyOffset = Math.min(bodyOffset, Math.max(0, body.length - bodyHeight));
        lines.push(...body.slice(bodyOffset, bodyOffset + bodyHeight));

        if (body.length > bodyHeight) {
          lines.push(
            theme.fg(
              "dim",
              `Body ${bodyOffset + 1}-${Math.min(body.length, bodyOffset + bodyHeight)}/${body.length} • PgUp/PgDn`,
            ),
          );
        }

        lines.push("", ...optionLines);

        if (editing) lines.push(theme.fg("muted", "Other answer:"));
      };

      const handleNavigation = (data: string): boolean => {
        const actions: Array<[KeyId, () => boolean]> = [
          [
            Key.escape,
            () => {
              finish(cancelled());

              return true;
            },
          ],
          [
            Key.pageUp,
            () => {
              bodyOffset = Math.max(0, bodyOffset - bodyHeight);
              refresh();

              return true;
            },
          ],
          [
            Key.pageDown,
            () => {
              bodyOffset += bodyHeight;
              refresh();

              return true;
            },
          ],
          [
            Key.left,
            () => {
              if (page === 0) return false;
              selectPage(page - 1);
              refresh();

              return true;
            },
          ],
          [
            Key.right,
            () => {
              if (page >= questions.length || !answers.has(questions[page].id)) return false;
              next();

              return true;
            },
          ],
        ];

        const action = actions.find(([key]) => isKey(data, key));

        return action?.[1]() ?? false;
      };

      const confirmChoice = () => {
        const q = questions[page];

        if (selected === q.options.length) {
          editing = true;
          editor.focused = true;
          editor.setText(
            answers.get(q.id)?.kind === "other" ? (answers.get(q.id)?.value ?? "") : "",
          );

          return;
        }

        answers.set(q.id, { id: q.id, kind: "option", value: q.options[selected] ?? "" });
        next();
      };

      const handleChoice = (data: string) => {
        const count = questions[page].options.length + 1;

        if (keys.matches(data, "tui.select.up")) selected = (selected + count - 1) % count;

        if (keys.matches(data, "tui.select.down")) selected = (selected + 1) % count;

        lists[page].setSelectedIndex(selected);
        if (keys.matches(data, "tui.select.confirm")) confirmChoice();
        refresh();
      };

      const handleEditing = (data: string) => {
        if (isKey(data, Key.escape)) {
          editing = false;
          editor.focused = false;
          warning = "";
        } else editor.handleInput(data);
        refresh();
      };

      const submitReview = (data: string) => {
        if (!keys.matches(data, "tui.select.confirm") || answers.size !== questions.length) return;

        const ordered = questions.reduce<QuestionAnswer[]>((items, q) => {
          const answer = answers.get(q.id);

          if (answer) items.push(answer);

          return items;
        }, []);

        finish({ status: "answered", answers: ordered });
      };

      const component: Focusable & {
        render(width: number): string[];
        invalidate(): void;
        handleInput(data: string): void;
      } = {
        get focused() {
          return editor.focused;
        },
        set focused(value) {
          editor.focused = value && editing;
        },
        invalidate() {
          for (const body of bodies) body.invalidate();

          for (const list of lists) list.invalidate();
          editor.invalidate();
        },
        handleInput(data) {
          if (finished) return;

          if (editing) {
            handleEditing(data);

            return;
          }

          if (handleNavigation(data)) return;

          if (page === questions.length) {
            submitReview(data);

            return;
          }

          handleChoice(data);
        },
        render(width) {
          const w = Math.max(1, width);
          const isReview = page === questions.length;

          const title = isReview
            ? `Review • ${questions.length} questions`
            : `Question ${page + 1}/${questions.length}`;

          const lines = [theme.fg("accent", truncateToWidth(title, w))];

          if (isReview) renderReview(w, lines);
          else renderQuestion(w, lines);

          if (warning) lines.push(theme.fg("warning", warning));

          const help = isReview
            ? "← back/edit • Enter Submit • Esc cancel"
            : editing
              ? "Enter save • Shift+Enter newline • Esc choices"
              : "↑↓ choose • Enter answer • ← back • → next • PgUp/PgDn body • Esc cancel";

          lines.push(...wrapTextWithAnsi(theme.fg("dim", help), w));

          return lines.map((line) =>
            visibleWidth(line) > w ? truncateToWidth(line, w, "") : line,
          );
        },
      };

      return component;
    });

    return signal?.aborted ? cancelled() : result;
  } finally {
    signal?.removeEventListener("abort", onAbort);
    close = undefined;
  }
}
