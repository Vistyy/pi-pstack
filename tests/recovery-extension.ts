import assert from "node:assert/strict";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import {
  type FauxResponseFactory,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  getCurrentSystemPrompt,
  getCurrentTools,
  type ToolCall,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Check } from "typebox/value";

function text(
  message: { content: string | readonly { type: string; text?: string }[] } | undefined,
) {
  return Check(Type.String(), message?.content)
    ? message.content
    : (message?.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("") ?? "");
}

const Summary = Type.Object({
  id: Type.String(),
  status: Type.String(),
  output: Type.Optional(Type.String()),
});

function summary(value: string) {
  const parsed: unknown = JSON.parse(value);
  assert.ok(Check(Summary, parsed));

  return parsed;
}

const call = (name: string, args: ToolCall["arguments"]) =>
  fauxAssistantMessage(fauxToolCall(name, args), { stopReason: "toolUse" });

const rootResponse: FauxResponseFactory = (context) => {
  const input = text(
    context.messages.findLast(
      (message) => message.role === "user" && !text(message).startsWith("PStack recovery."),
    ),
  );

  if (context.messages.at(-1)?.role === "toolResult")
    return fauxAssistantMessage("Root turn finished.");
  const [command = "", id = ""] = input.split(" ");

  switch (command) {
    case "start":
      return call("pstack_task", {
        prompt: "Original assignment ASSIGNMENT-481. Read proof.txt and report it.",
        model: "recovery-fixture/child:off",
        readonly: process.env["PSTACK_RECOVERY_CASE"] === "readonly",
        subagent_type:
          process.env["PSTACK_RECOVERY_CASE"] === "poteto" ? "poteto-agent" : "generalPurpose",
        run_in_background: true,
      });
    case "inventory":
      return call("pstack_tasks", { action: "list" });
    case "inspect":
      return call("pstack_tasks", { action: "inspect", id });
    case "cancel":
      return call("pstack_tasks", { action: "cancel", id });
    case "resume":
      return call("pstack_task", {
        resume: id,
        prompt: "Continue the saved assignment. Reconcile prior work before repeating any tools.",
        run_in_background: false,
      });
    default:
      return fauxAssistantMessage("Root acknowledged.");
  }
};

export default function recoveryFixture(pi: ExtensionAPI) {
  const directory = process.env["PSTACK_RECOVERY_DIR"];
  const phase = process.env["PSTACK_RECOVERY_PHASE"];
  const scenario = process.env["PSTACK_RECOVERY_CASE"];
  assert.ok(directory !== undefined);
  const emit = (event: string) => process.stderr.write(`RECOVERY ${event}\n`);

  const wait = (signal: AbortSignal | undefined, event: string) => {
    emit(event);

    return new Promise<never>((_resolve, reject) => {
      if (signal?.aborted === true) reject(new Error("Interrupted fixture"));
      else
        signal?.addEventListener("abort", () => reject(new Error("Interrupted fixture")), {
          once: true,
        });
    });
  };

  const coordinator: FauxResponseFactory = (context, options) => {
    const list = context.messages.findLast(
      (message) => message.role === "toolResult" && message.toolName === "pstack_tasks",
    );

    const delegated = context.messages.findLast(
      (message) => message.role === "toolResult" && message.toolName === "pstack_task",
    );

    if (phase === "initial") {
      if (!delegated)
        return call("pstack_task", {
          prompt: "Original nested assignment LEAF-829. Read proof.txt.",
          model: "recovery-fixture/leaf:off",
          run_in_background: true,
        });

      return wait(options?.signal, "child-waiting");
    }

    if (!list) return call("pstack_tasks", { action: "list" });

    if (delegated && summary(text(delegated)).status === "completed")
      return fauxAssistantMessage(`Coordinator recovered ${summary(text(delegated)).output}`);
    const children: unknown = JSON.parse(text(list));
    assert.ok(Check(Type.Array(Summary), children));
    const child = children[0];
    assert.ok(child);

    return call("pstack_task", {
      resume: child.id,
      prompt: "Resume the saved nested assignment without repeating completed tools.",
      run_in_background: false,
    });
  };

  const worker: FauxResponseFactory = (context, options, _state, model) => {
    if (scenario === "effect") {
      const effect = context.messages.findLast(
        (message) =>
          message.role === "toolResult" &&
          message.toolName === "read" &&
          text(message).includes("applied"),
      );

      if (phase === "initial")
        return call("bash", { command: "printf 'applied\\n' >> effect.txt" });

      if (!effect) return call("read", { path: join(directory, "effect.txt") });
      assert.equal(text(effect).trim(), "applied");
    }

    const proof = context.messages.findLast(
      (message) =>
        message.role === "toolResult" &&
        message.toolName === "read" &&
        text(message).includes("PROOF-7391"),
    );

    if (!proof) return call("read", { path: join(directory, "proof.txt") });

    if (phase === "initial" && !["normal", "pending"].includes(scenario ?? ""))
      return wait(options?.signal, "child-ready");
    assert.ok(
      context.messages.some((message) =>
        text(message).includes(model.id === "leaf" ? "LEAF-829" : "ASSIGNMENT-481"),
      ),
    );

    return fauxAssistantMessage(`Saved proof ${text(proof).trim()}`);
  };

  const provider = fauxProvider({
    provider: "recovery-fixture",
    models:
      scenario === "unavailable" && phase !== "initial"
        ? [{ id: "root", reasoning: false }]
        : [
            { id: "root", reasoning: false },
            { id: "child", reasoning: false },
            { id: "leaf", reasoning: false },
          ],
    tokensPerSecond: Infinity,
  });

  const expectedInstructions = new Map([
    [
      "readonly",
      [
        /Do not modify files or external state/,
        /Use the available tools only for inspection/,
        /Tool availability does not authorize writes/,
        /Keep descendants under the same restriction/,
      ],
    ],
    [
      "poteto",
      [
        /Reopening the owning parent restores saved task IDs without restarting work/,
        /PStack role map/,
      ],
    ],
  ]);

  const respond: FauxResponseFactory = async (...args) => {
    const [context, , , model] = args;
    appendFileSync(
      join(directory, `${phase}.requests.jsonl`),
      `${JSON.stringify({ model: model.id, context, tools: getCurrentTools(context.messages).map((tool) => tool.name) })}\n`,
    );

    if (model.id === "root") return rootResponse(...args);

    for (const pattern of expectedInstructions.get(scenario ?? "") ?? [])
      assert.match(getCurrentSystemPrompt(context.messages), pattern);

    if (scenario === "early" && phase === "initial") return wait(args[1]?.signal, "child-ready");

    if (["nested", "nested-early"].includes(scenario ?? "") && model.id === "child")
      return coordinator(...args);

    return worker(...args);
  };

  provider.setResponses(Array.from({ length: 100 }, () => respond));
  pi.registerProvider(provider.provider);
  pi.registerTool({
    name: "recovery_fixture",
    label: "Recovery fixture",
    description: "Keep the fixture's file-backed integration in the child tool plan",
    parameters: Type.Object({}),
    async execute() {
      return { content: [{ type: "text", text: "fixture integration active" }], details: {} };
    },
  });
  pi.on("session_start", async (_event, ctx) => {
    if (ctx.model?.id === "root") emit("ready");

    if (scenario === "nested-early" && phase === "initial" && ctx.model?.id === "leaf")
      await wait(undefined, "child-ready");
  });
  pi.on("message_start", async (event, ctx) => {
    if (
      phase === "initial" &&
      ctx.model?.id === "root" &&
      event.message.role === "user" &&
      text(event.message).startsWith("PSTACK_CHILD_REPORT_V1\n") &&
      text(event.message).includes('"status":"completed"')
    ) {
      if (scenario === "pending") await wait(undefined, "delivery-pending");
      else emit("normal-delivered");
    }
  });
  pi.on("tool_result", async (event) => {
    if (scenario === "effect" && phase === "initial" && event.toolName === "bash")
      await wait(undefined, "child-ready");
  });
  pi.registerCommand("recovery-reload", {
    description: "Reload the owned fixture through Pi",
    handler: async (_args, ctx) => {
      process.env["PSTACK_RECOVERY_PHASE"] = "reopen";
      await ctx.reload();
    },
  });
  pi.registerCommand("recovery-exit", {
    description: "Exit an owned recovery fixture",
    handler: async (_args, ctx) => ctx.shutdown(),
  });
  pi.registerCommand("recovery-extension-input", {
    description: "Submit extension-origin fixture input",
    handler: async () => pi.sendUserMessage("extension probe"),
  });
}
