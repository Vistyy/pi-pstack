import assert from "node:assert/strict";
import test from "node:test";
import { type ExtensionContext, initTheme } from "@earendil-works/pi-coding-agent";
import { Key, type KeybindingsManager, visibleWidth } from "@earendil-works/pi-tui";
import { type Question, showQuestionnaire } from "../src/question-ui.ts";

initTheme("dark", false);

const questions: Question[] = [
  {
    id: "first",
    question: "| A | B |\n|---|---|\n| x | y |\n\n```text\n+--+\n|  |\n+--+\n```",
    options: ["yes", "no"],
  },
  { id: "second", question: `Long question ${"word ".repeat(160)}`, options: ["one"] },
];

function harness(rows = 30) {
  let component:
    | ReturnType<NonNullable<Parameters<ExtensionContext["ui"]["custom"]>[0]>>
    | undefined;

  const tui = { terminal: { rows }, requestRender() {} };

  const theme = {
    fg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  };

  const keys = {
    matches(data: string, id: string) {
      return (
        (id === "tui.select.up" && data === Key.up) ||
        (id === "tui.select.down" && data === Key.down) ||
        (id === "tui.select.confirm" && (data === Key.enter || data === "\r"))
      );
    },
  } as KeybindingsManager;

  const ctx = {
    ui: {
      custom(
        factory: (tui: never, theme: never, keys: never, done: (value: unknown) => void) => never,
      ) {
        return new Promise((r) => {
          component = factory(tui as never, theme as never, keys as never, r);
        });
      },
    },
  } as unknown as ExtensionContext;

  return {
    component: () => {
      if (!component) throw new Error("UI not created");

      return component;
    },
    start(signal?: AbortSignal) {
      return showQuestionnaire(ctx, questions, signal);
    },
  };
}

const input = (h: ReturnType<typeof harness>, key: string) => h.component().handleInput(key);

test("selects all answers and requires explicit review submission in question order", async () => {
  const h = harness();
  const result = h.start();
  h.component().render(80);
  input(h, Key.enter);
  input(h, Key.enter);
  assert.match(h.component().render(80).join("\n"), /Review/);
  input(h, Key.enter);
  assert.deepEqual(await result, {
    status: "answered",
    answers: [
      { id: "first", kind: "option", value: "yes" },
      { id: "second", kind: "option", value: "one" },
    ],
  });
});

test("retains Other verbatim, supports back-edit and only submits from review", async () => {
  const h = harness();
  const result = h.start();
  h.component().render(80);
  input(h, Key.down);
  input(h, Key.down);
  input(h, Key.enter);
  // Editor owns normal typing; the injected component forwards editor keys.
  input(h, "a");
  input(h, " ");
  input(h, "b");
  input(h, "\n");
  input(h, " ");
  input(h, "c");
  input(h, "\r");
  input(h, Key.enter);
  input(h, Key.left);
  assert.match(h.component().render(80).join("\n"), /Question 2\/2/);
  input(h, Key.left);
  assert.match(h.component().render(80).join("\n"), /Question 1\/2/);
  input(h, Key.enter); // revisit Other
  input(h, "\r"); // retain existing value
  input(h, Key.enter); // review
  input(h, Key.enter); // submit
  const value = await result;
  assert.equal(value.status, "answered");

  if (value.status === "answered") assert.equal(value.answers[0]?.value, "a b\n c");
});

test("Other rejects whitespace and Escape returns to choices without committing", async () => {
  const h = harness();
  const result = h.start();
  h.component().render(80);
  input(h, Key.down);
  input(h, Key.down);
  input(h, Key.enter);
  input(h, " ");
  input(h, "\r");
  assert.match(h.component().render(80).join("\n"), /Other cannot be blank/);
  input(h, Key.escape);
  assert.match(h.component().render(80).join("\n"), /Other \(write an answer\)/);
  input(h, Key.up);
  input(h, Key.up);
  input(h, Key.enter);
  input(h, Key.enter);
  input(h, Key.enter);
  input(h, Key.enter);
  const value = await result;
  assert.equal(value.status, "answered");

  if (value.status === "answered")
    assert.deepEqual(value.answers[0], { id: "first", kind: "option", value: "yes" });
});

test("renders native Markdown, pages long bodies, fits narrow widths, and responds to resize", async () => {
  const h = harness(12);
  h.start();
  const narrow = h.component().render(24);
  assert.ok(narrow.some((line) => line.includes("A") || line.includes("B")));
  assert.ok(narrow.every((line) => visibleWidth(line) <= 24));
  input(h, Key.right);
  const long = h.component().render(40).join("\n");
  assert.match(long, /Body 1-/);
  input(h, Key.pageDown);
  assert.match(h.component().render(40).join("\n"), /Body [2-9]/);
  assert.ok(
    h
      .component()
      .render(100)
      .every((line) => line.length <= 100),
  );
});

test("Escape cancels; abort closes UI and discards partial answers", async () => {
  const cancel = harness();
  const cancelled = cancel.start();
  cancel.component().render(80);
  input(cancel, Key.escape);
  assert.deepEqual(await cancelled, { status: "cancelled", answers: [] });

  const abort = harness();
  const controller = new AbortController();
  const aborted = abort.start(controller.signal);
  abort.component().render(80);
  input(abort, Key.enter);
  controller.abort();
  assert.deepEqual(await aborted, { status: "cancelled", answers: [] });
});
