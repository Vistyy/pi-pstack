import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { fauxAssistantMessage, fauxToolCall, getCurrentSystemPrompt } from "@earendil-works/pi-ai";
import { childFixture, receipt } from "./child-fixture.js";

const instructionMarker = "## PStack role map";

const readMarker = "DELIVERY_READ_CONTINUATION_MARKER";

function assertStableInstructions(prompts: string[]) {
  for (const [index, prompt] of prompts.entries()) {
    assert.ok(
      prompt.includes(instructionMarker),
      `provider request ${index + 1} lost the injected PStack instructions`,
    );
    assert.equal(prompt, prompts[0], `provider request ${index + 1} changed the instructions`);
  }
}

await test("root idle completion keeps system instructions through a builtin read continuation", {
  timeout: 10000,
}, async (t) => {
  const f = await childFixture(t);
  await writeFile(join(f.project, "delivery-read.txt"), readMarker);
  const childStarted = f.gate();
  const childGate = f.gate();
  f.nested.setResponses([
    async () => {
      childStarted.resolve();
      await childGate.promise;

      return fauxAssistantMessage("root child finished");
    },
  ]);

  const prompts: string[] = [];
  f.parent.setResponses([
    (context) => {
      prompts.push(getCurrentSystemPrompt(context.messages));

      return fauxAssistantMessage(
        fauxToolCall("pstack_task", {
          prompt: "background child for root delivery",
          model: "nested/child:rev1:low",
          run_in_background: true,
        }),
        { stopReason: "toolUse" },
      );
    },
    (context) => {
      prompts.push(getCurrentSystemPrompt(context.messages));

      return fauxAssistantMessage("root turn one finished");
    },
  ]);
  await f.session.prompt("fixture request");

  const launched = f.session.messages.findLast(
    (item) => item.role === "toolResult" && item.toolName === "pstack_task",
  );

  assert.ok(launched?.role === "toolResult" && !launched.isError);

  const child = receipt(
    launched.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join(""),
  );

  assert.equal(child.status, "running");
  await childStarted.promise;
  assert.equal(f.session.isIdle, true);

  f.parent.setResponses([
    (context) => {
      prompts.push(getCurrentSystemPrompt(context.messages));

      return fauxAssistantMessage(
        fauxToolCall("read", { path: join(f.project, "delivery-read.txt") }),
        { stopReason: "toolUse" },
      );
    },
    (context) => {
      prompts.push(getCurrentSystemPrompt(context.messages));

      return fauxAssistantMessage("root delivery turn finished");
    },
  ]);
  const settled = f.report();
  childGate.resolve();
  await settled;
  await f.session.waitForIdle();

  assert.equal(f.parent.state.callCount, 4);
  assert.equal(prompts.length, 4);
  assertStableInstructions(prompts);

  const read = f.session.messages.findLast(
    (item) => item.role === "toolResult" && item.toolName === "read",
  );

  assert.ok(read?.role === "toolResult" && !read.isError);
  assert.match(
    read.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join(""),
    new RegExp(readMarker),
  );
  assert.match(JSON.stringify(f.session.messages), /root child finished/);
  const last = f.session.messages.findLast((item) => item.role === "assistant");

  assert.ok(last?.role === "assistant");
  assert.notEqual(last.stopReason, "error");
  assert.notEqual(last.stopReason, "aborted");
  assert.equal(f.errors.length, 0);
});

await test("nested idle completion keeps system instructions through a builtin read continuation", {
  timeout: 10000,
}, async (t) => {
  const f = await childFixture(t);
  await writeFile(join(f.project, "delivery-read.txt"), readMarker);
  const leafStarted = f.gate();
  const leafGate = f.gate();
  f.leaf.setResponses([
    async () => {
      leafStarted.resolve();
      await leafGate.promise;

      return fauxAssistantMessage("leaf completion evidence");
    },
  ]);

  const prompts: string[] = [];
  f.nested.setResponses([
    (context) => {
      prompts.push(getCurrentSystemPrompt(context.messages));

      return fauxAssistantMessage(
        fauxToolCall("pstack_task", {
          prompt: "background leaf for nested delivery",
          model: "leaf/reader:off",
          readonly: true,
          run_in_background: true,
        }),
        { stopReason: "toolUse" },
      );
    },
    (context) => {
      prompts.push(getCurrentSystemPrompt(context.messages));

      return fauxAssistantMessage("nested turn one finished");
    },
  ]);
  f.parent.setResponses([
    fauxAssistantMessage(
      fauxToolCall("pstack_task", {
        prompt: "nested parent assignment",
        model: "nested/child:rev1:low",
        run_in_background: false,
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("root driver finished"),
  ]);
  const rootTurn = f.session.prompt("fixture request");

  await leafStarted.promise;
  await f.nestedSettled;

  f.nested.setResponses([
    (context) => {
      prompts.push(getCurrentSystemPrompt(context.messages));

      return fauxAssistantMessage(
        fauxToolCall("read", { path: join(f.project, "delivery-read.txt") }),
        { stopReason: "toolUse" },
      );
    },
    (context) => {
      prompts.push(getCurrentSystemPrompt(context.messages));

      return fauxAssistantMessage("nested delivery finished");
    },
  ]);
  leafGate.resolve();
  await rootTurn;
  await f.session.waitForIdle();

  assert.equal(f.leaf.state.callCount, 1);
  assert.equal(f.nested.state.callCount, 4);
  assert.equal(prompts.length, 4);
  assertStableInstructions(prompts);

  const finished = f.session.messages.findLast(
    (item) => item.role === "toolResult" && item.toolName === "pstack_task",
  );

  assert.ok(finished?.role === "toolResult" && !finished.isError);

  const summary = receipt(
    finished.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join(""),
  );

  assert.equal(summary.status, "completed");
  const transcript = summary.transcript;

  assert.ok(transcript !== undefined);
  const recorded = await readFile(transcript, "utf8");

  assert.match(recorded, /leaf completion evidence/);
  assert.match(recorded, /nested delivery finished/);
  assert.match(recorded, new RegExp(readMarker));
  assert.equal(f.errors.length, 0);
});
