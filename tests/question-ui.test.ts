import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { stripVTControlCharacters } from "node:util";
import { initTheme } from "@earendil-works/pi-coding-agent";
import {
  type Component,
  CURSOR_MARKER,
  getKeybindings,
  ProcessTerminal,
  TuiMainScreen,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { type Question, type QuestionnaireResult, showQuestionnaire } from "../src/question-ui.ts";
import { childFixture } from "./child-fixture.js";

initTheme("dark", false);

const key = {
  enter: "\r",
  up: "\x1b[A",
  down: "\x1b[B",
  left: "\x1b[D",
  right: "\x1b[C",
  escape: "\x1b",
  pageDown: "\x1b[6~",
  pageUp: "\x1b[5~",
};

const questions: Question[] = [
  {
    id: "first",
    question: "| A | B |\n|---|---|\n| x | y |\n\n```text\n+--+\n|  |\n+--+\n```",
    options: ["yes", "no"],
  },
  { id: "second", question: `Long question ${"word ".repeat(160)}END OF BODY`, options: ["one"] },
];

class SizedTerminal extends ProcessTerminal {
  height = 30;
  override get rows() {
    return this.height;
  }
  override write(_data: string): void {}
}

class QuietTui extends TuiMainScreen {
  override requestRender(): void {}
}

async function uiFixture(t: TestContext) {
  const f = await childFixture(t);
  const theme = f.session.extensionRunner.getUIContext().theme;

  return {
    async start(items = questions, controller = new AbortController()) {
      const terminal = new SizedTerminal();
      const tui = new QuietTui(terminal);
      const ready = Promise.withResolvers<Component>();

      const ui: Parameters<typeof showQuestionnaire>[0] = {
        custom(factory) {
          const result = Promise.withResolvers<QuestionnaireResult>();
          const component = factory(tui, theme, getKeybindings(), result.resolve);
          tui.setFocus(component);
          ready.resolve(component);

          return result.promise;
        },
      };

      const result = showQuestionnaire(ui, items, controller.signal);
      const component = await ready.promise;
      t.after(() => controller.abort());

      return {
        result,
        terminal,
        component,
        controller,
        input(...keys: string[]) {
          for (const data of keys) component.handleInput?.(data);
        },
        screen(width = 80) {
          return stripVTControlCharacters(component.render(width).join("\n"));
        },
      };
    },
  };
}

await test("answers remain ordered and require explicit review, including a single question", async (t) => {
  const f = await uiFixture(t);
  const h = await f.start();
  h.input(key.enter, key.enter);
  assert.match(h.screen(), /Review/);
  h.input(key.left, key.left, key.down, key.enter, key.right);
  assert.match(h.screen(), /Review/);
  h.input(key.enter);
  assert.deepEqual(await h.result, {
    status: "answered",
    answers: [
      { id: "first", kind: "option", value: "no" },
      { id: "second", kind: "option", value: "one" },
    ],
  });
  const single = await f.start([{ id: "only", question: "Proceed?", options: ["yes"] }]);
  single.input(key.enter);
  assert.match(single.screen(), /Review/);
  single.input(key.escape);
  assert.deepEqual(await single.result, { status: "cancelled", answers: [] });
});

await test("unanswered questions can be browsed and answered out of order, but not submitted", async (t) => {
  const f = await uiFixture(t);
  const h = await f.start();
  h.input(key.right);
  assert.match(h.screen(), /Question 2\/2/);
  h.input(key.right);
  assert.match(h.screen(), /Review • 0\/2 answered/);
  assert.match(h.screen(), /first: Unanswered/);
  assert.match(h.screen(), /second: Unanswered/);
  h.input(key.enter);
  assert.match(h.screen(), /Answer every question/);
  h.input(key.left, key.enter);
  assert.match(h.screen(), /Review • 1\/2 answered/);
  assert.match(h.screen(), /second: one/);
  h.input(key.enter);
  assert.match(h.screen(), /Answer every question/);
  h.input(key.left, key.left, key.down, key.enter, key.right);
  assert.match(h.screen(), /Review • 2\/2 answered/);
  assert.doesNotMatch(h.screen(), /Unanswered|Answer every question/);
  h.input(key.enter);
  assert.deepEqual(await h.result, {
    status: "answered",
    answers: [
      { id: "first", kind: "option", value: "no" },
      { id: "second", kind: "option", value: "one" },
    ],
  });
});

await test("multiple choices require selection and return option order alongside unchanged single-choice answers", async (t) => {
  const f = await uiFixture(t);

  const h = await f.start([
    {
      id: "many",
      question: "Choose areas",
      options: ["Alpha", "Beta", "Gamma"],
      allow_multiple: true,
    },
    { id: "one", question: "Choose one", options: ["Yes", "No"] },
  ]);

  assert.match(h.screen(), /\[ \] Alpha/);
  h.input(key.enter);
  assert.match(h.screen(), /Select at least one option/);
  h.input(" ", key.right, key.enter, key.enter);
  assert.match(h.screen(), /Review • 1\/2 answered/);
  assert.match(h.screen(), /Answer every question/);
  h.input(key.left, key.left);
  assert.match(h.screen(), /\[ \] Alpha/);
  h.input(key.down, key.down, " ", key.up, key.up, " ", key.enter);
  assert.match(h.screen(), /Question 2\/2/);
  assert.doesNotMatch(h.screen(), /Multiple choices|\[x\]/);
  h.input(key.enter);
  assert.match(h.screen(), /many:\n\s*\[x\] Alpha\n\s*\[x\] Gamma/);
  h.input(key.enter);
  assert.deepEqual(await h.result, {
    status: "answered",
    answers: [
      { id: "many", kind: "options", values: ["Alpha", "Gamma"] },
      { id: "one", kind: "option", value: "Yes" },
    ],
  });
});

await test("multiple answers can be restored, deselected, and revised from review", async (t) => {
  const f = await uiFixture(t);

  const h = await f.start([
    {
      id: "many",
      question: "Choose areas",
      options: ["Alpha", "Beta", "Gamma"],
      allow_multiple: true,
    },
  ]);

  h.input(" ", key.down, key.down, " ", key.enter, key.left);
  assert.match(h.screen(), /\[x\] Alpha/);
  assert.match(h.screen(), /\[x\] Gamma/);
  h.input(" ", key.down, " ", key.down, " ", key.enter);
  assert.match(h.screen(), /\[x\] Beta/);
  assert.doesNotMatch(h.screen(), /Alpha|Gamma/);
  h.input(key.enter);
  assert.deepEqual(await h.result, {
    status: "answered",
    answers: [{ id: "many", kind: "options", values: ["Beta"] }],
  });
});

await test("multiple-choice selections and Other do not leak into the next question", async (t) => {
  const f = await uiFixture(t);

  const h = await f.start([
    { id: "first", question: "First", options: ["A", "B"], allow_multiple: true },
    { id: "second", question: "Second", options: ["X", "Y"], allow_multiple: true },
  ]);

  h.input(" ", key.down, key.down, " ", "first only", key.enter, key.up, key.enter);
  assert.match(h.screen(), /\[ \] X/);
  assert.match(h.screen(), /\[ \] Other/);
  h.input(key.enter);
  assert.match(h.screen(), /Select at least one option/);
  h.input(" ", key.enter, key.enter);
  assert.deepEqual(await h.result, {
    status: "answered",
    answers: [
      { id: "first", kind: "options", values: ["A"], other: "first only" },
      { id: "second", kind: "options", values: ["X"] },
    ],
  });
});

const multipleWithOther: Question[] = [
  { id: "many", question: "Choose areas", options: ["Alpha", "Beta"], allow_multiple: true },
];

await test("Other combines with listed choices, preserves multiline text, and can be revised from review", async (t) => {
  const f = await uiFixture(t);
  const h = await f.start(multipleWithOther);
  h.input(" ", key.down, " ", key.down, " ", key.enter);
  assert.match(h.screen(), /Other cannot be blank/);
  h.input(" custom", "\n", "answer ", key.enter);
  assert.match(h.screen(), /\[x\] Alpha/);
  assert.match(h.screen(), /\[x\] Beta/);
  assert.match(h.screen(), /\[x\] Other \(edit an answer\)/);
  assert.doesNotMatch(h.screen(), /Review|Other cannot be blank/);
  h.input(key.enter, "discarded", key.escape, key.up, key.enter);
  assert.match(h.screen(), /\[x\] Other: {2}custom\nanswer /);
  assert.doesNotMatch(h.screen(), /discarded/);
  h.input(key.left);
  assert.match(h.screen(), /\[x\] Alpha/);
  assert.match(h.screen(), /\[x\] Beta/);
  assert.match(h.screen(), /\[x\] Other/);
  h.input(key.down, key.down, key.enter);
  assert.match(h.screen(), /custom/);
  assert.doesNotMatch(h.screen(), /discarded/);
  h.input("!", key.enter, key.up, key.enter, key.enter);
  assert.deepEqual(await h.result, {
    status: "answered",
    answers: [
      { id: "many", kind: "options", values: ["Alpha", "Beta"], other: " custom\nanswer !" },
    ],
  });
});

await test("Other can be deselected without losing listed choices", async (t) => {
  const f = await uiFixture(t);
  const h = await f.start(multipleWithOther);
  h.input(" ", key.down, key.down, " ", "extra", key.enter, key.up, key.enter, key.left);
  h.input(key.down, key.down, " ");
  assert.match(h.screen(), /\[ \] Other/);
  assert.match(h.screen(), /\[x\] Alpha/);
  h.input(key.up, key.enter);
  assert.doesNotMatch(h.screen(), /Other|extra/);
  h.input(key.enter);
  assert.deepEqual(await h.result, {
    status: "answered",
    answers: [{ id: "many", kind: "options", values: ["Alpha"] }],
  });
});

await test("Other alone is valid in multiple selection, but deselecting it cannot save an empty answer", async (t) => {
  const f = await uiFixture(t);
  const h = await f.start(multipleWithOther);
  h.input(key.down, key.down, " ", "only other", key.enter, key.up, key.enter, key.left);
  assert.match(h.screen(), /\[ \] Alpha/);
  assert.match(h.screen(), /\[x\] Other/);
  h.input(" ", key.up, key.enter);
  assert.match(h.screen(), /Select at least one option/);
  h.input(key.down, " ", "replacement", key.enter, key.up, key.enter, key.enter);
  assert.deepEqual(await h.result, {
    status: "answered",
    answers: [{ id: "many", kind: "other", value: "replacement" }],
  });
});

await test("Other drafts require saving the question; editor escape, questionnaire cancel, and abort discard unsaved input", async (t) => {
  const f = await uiFixture(t);
  const h = await f.start(multipleWithOther);
  h.input(" ", key.down, key.down, " ", "discarded", key.escape);
  assert.match(h.screen(), /\[x\] Alpha/);
  assert.match(h.screen(), /\[ \] Other/);
  h.input(" ", "draft", key.enter, key.right);
  assert.match(h.screen(), /Review • 0\/1 answered/);
  h.input(key.left);
  assert.match(h.screen(), /\[ \] Alpha/);
  assert.match(h.screen(), /\[ \] Other/);
  h.input(key.escape);
  assert.deepEqual(await h.result, { status: "cancelled", answers: [] });

  const cancel = await f.start(multipleWithOther);
  cancel.input(" ", key.down, key.down, " ", "extra", key.enter, key.up, key.enter, key.escape);
  assert.deepEqual(await cancel.result, { status: "cancelled", answers: [] });
  const abort = await f.start(multipleWithOther);
  abort.input(" ", key.down, key.down, " ", "extra", key.enter, key.up, key.enter);
  abort.controller.abort();
  assert.deepEqual(await abort.result, { status: "cancelled", answers: [] });
});

await test("Other preserves multiline text verbatim, receives focus, and can be revised", async (t) => {
  const f = await uiFixture(t);
  const h = await f.start();
  h.screen();
  h.input(key.down, key.down, key.enter);
  assert.ok(h.component.render(80).join("\n").includes(CURSOR_MARKER));
  h.input(" ", "a", " ", "b", "\n", " ", "c", " ", key.enter, key.enter);
  h.input(key.left, key.left, key.enter);
  assert.match(h.screen(), /a b/);
  h.input("!", key.enter, key.right, key.enter);
  assert.deepEqual(await h.result, {
    status: "answered",
    answers: [
      { id: "first", kind: "other", value: " a b\n c !" },
      { id: "second", kind: "option", value: "one" },
    ],
  });
});

await test("blank Other is rejected; Escape returns to choices without saving the draft", async (t) => {
  const f = await uiFixture(t);
  const h = await f.start();
  h.screen();
  h.input(key.down, key.down, key.enter, " ", key.enter);
  assert.match(h.screen(), /Other cannot be blank/);
  h.input(key.escape);
  assert.match(h.screen(), /Other \(write an answer\)/);
  h.input(key.up, key.up, key.enter, key.enter, key.enter);
  assert.deepEqual(await h.result, {
    status: "answered",
    answers: [
      { id: "first", kind: "option", value: "yes" },
      { id: "second", kind: "option", value: "one" },
    ],
  });
});

await test("native Markdown tables and diagrams render; body and review scroll after resize", async (t) => {
  const f = await uiFixture(t);
  const h = await f.start();
  const rich = h.screen();
  assert.match(rich, /A\s+│\s+B/);
  assert.match(rich, /\+--\+/);
  assert.match(rich, / {2}\+--\+[^\n]*\n {2}\| {2}\|[^\n]*\n {2}\+--\+/);
  h.input(key.enter);
  h.terminal.height = 16;
  const narrow = h.component.render(24);
  assert.ok(narrow.every((line) => visibleWidth(line) <= 24));
  assert.ok(narrow.length <= 16);
  assert.doesNotMatch(h.screen(24), /END OF\s+BODY/);

  for (let i = 0; i < 30; i++) {
    h.input(key.pageDown);
    h.screen(24);
  }

  assert.match(h.screen(24), /END OF\s+BODY/);
  h.input(key.pageUp);
  assert.doesNotMatch(h.screen(24), /END OF\s+BODY/);
  h.terminal.height = 40;
  assert.ok(h.component.render(100).every((line) => visibleWidth(line) <= 100));
  h.input(key.escape);
  await h.result;

  const many = await f.start(
    Array.from({ length: 30 }, (_, i) => ({
      id: `q${i}`,
      question: "Choose",
      options: ["chosen"],
    })),
  );

  for (let i = 0; i < 30; i++) many.input(key.enter);
  many.terminal.height = 12;
  assert.ok(many.component.render(40).length <= 12);
  assert.doesNotMatch(many.screen(40), /q29:/);

  for (let i = 0; i < 30; i++) {
    many.input(key.pageDown);
    many.screen(40);
  }

  assert.match(many.screen(40), /q29: chosen/);
  many.input(key.enter);
  assert.equal((await many.result).answers.length, 30);
});

await test("Escape and abort discard partial answers; late input cannot submit", async (t) => {
  const f = await uiFixture(t);
  const cancel = await f.start();
  cancel.input(key.enter, key.escape, key.enter);
  assert.deepEqual(await cancel.result, { status: "cancelled", answers: [] });
  const abort = await f.start();
  abort.input(key.enter);
  abort.controller.abort();
  abort.input(key.enter, key.enter);
  assert.deepEqual(await abort.result, { status: "cancelled", answers: [] });
  assert.deepEqual(
    await showQuestionnaire(
      {
        custom: () => {
          throw new Error("UI must not open");
        },
      },
      questions,
      AbortSignal.abort(),
    ),
    { status: "cancelled", answers: [] },
  );
});
