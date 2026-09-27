import assert from "node:assert/strict";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import {
  contentText,
  type FauxResponseFactory,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type ToolCall,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Check } from "typebox/value";

type Context = Parameters<FauxResponseFactory>[0];

const call = (name: string, args: ToolCall["arguments"]) =>
  fauxAssistantMessage(fauxToolCall(name, args), { stopReason: "toolUse" });

const Summary = Type.Object({ id: Type.String(), status: Type.String(), attempt: Type.Integer() });

function resumeResponse(context: Context) {
  const list = context.messages.findLast(
    (message) => message.role === "toolResult" && message.toolName === "pstack_tasks",
  );

  if (!list) return call("pstack_tasks", { action: "list" });

  const result = context.messages.findLast(
    (message) => message.role === "toolResult" && message.toolName === "pstack_task",
  );

  const latest: unknown = JSON.parse(contentText(result?.content ?? "{}"));

  if (Check(Summary, latest) && latest.attempt === 2 && latest.status === "completed")
    return fauxAssistantMessage("Recovered observer work complete.");
  const tasks: unknown = JSON.parse(contentText(list.content));
  assert.ok(Check(Type.Array(Summary), tasks));
  const task = tasks.find((item) => item.status === "interrupted");
  assert.ok(task);

  return call("pstack_task", {
    resume: task.id,
    prompt: "Resume observer children after reconciling prior tool effects.",
    run_in_background: false,
  });
}

function leafResponse(context: Context, directory: string) {
  const results = context.messages.filter((message) => message.role === "toolResult");

  if (!results.some((message) => message.toolName === "read"))
    return call("read", { path: join(directory, "proof.txt") });

  if (!results.some((message) => message.toolName === "bash"))
    return call("bash", {
      command:
        "printf 'TOOL_STREAM_START\\n'; while [ ! -f release ]; do sleep 0.1; done; printf 'TOOL_STREAM_END\\n'",
      timeout: 120,
    });

  const content = Array.from(
    { length: 32 },
    (_unused, index) =>
      `## Live section ${index + 1}\n\nNative streamed output for the read-only observer. Earlier text should stay in place while this response grows.\n`,
  ).join("\n");

  return fauxAssistantMessage(`ASSISTANT_STREAM_START\n\n${content}\nASSISTANT_STREAM_END`);
}

export default function observerFixture(pi: ExtensionAPI) {
  const directory = process.env["PSTACK_OBSERVER_DIR"];
  assert.ok(directory !== undefined && directory !== "");

  const provider = fauxProvider({
    provider: "observer-fixture",
    models: ["root", "coordinator", "leaf", "failure"].map((id) => ({ id, reasoning: false })),
    tokensPerSecond: 120,
  });

  const response: FauxResponseFactory = (context, _options, _state, model) => {
    appendFileSync(join(directory, "requests.jsonl"), `${JSON.stringify({ model: model.id })}\n`);

    const delegated = context.messages.some(
      (message) => message.role === "toolResult" && message.toolName === "pstack_task",
    );

    const resume = context.messages.some(
      (message) =>
        message.role === "user" &&
        /observer-resume|Resume observer children/.test(contentText(message.content)),
    );

    if (resume && ["root", "coordinator"].includes(model.id)) return resumeResponse(context);

    switch (model.id) {
      case "root": {
        const requested = context.messages.some(
          (message) => message.role === "user" && contentText(message.content) === "observer-run",
        );

        if (!requested || delegated) return fauxAssistantMessage("Root received the outcome.");

        return fauxAssistantMessage(
          [
            fauxToolCall("pstack_task", {
              prompt: "Coordinator inspection",
              model: "observer-fixture/coordinator:off",
              readonly: true,
              run_in_background: true,
            }),
            fauxToolCall("pstack_task", {
              prompt: "Failure inspection",
              model: "observer-fixture/failure:off",
              run_in_background: true,
            }),
          ],
          { stopReason: "toolUse" },
        );
      }

      case "coordinator":
        if (!delegated)
          return call("pstack_task", {
            prompt: "Nested transcript inspection",
            model: "observer-fixture/leaf:off",
            run_in_background: true,
          });

        return fauxAssistantMessage("Coordinator waiting or reviewing nested work.");
      case "failure":
        return fauxAssistantMessage("Fixture failure", {
          stopReason: "error",
          errorMessage: "Deliberate observer fixture failure",
        });
      case "leaf":
        return leafResponse(context, directory);
      default:
        throw new Error(`Unexpected fixture model ${model.id}`);
    }
  };

  provider.setResponses(Array.from({ length: 100 }, () => response));
  pi.registerProvider(provider.provider);
  pi.registerTool({
    name: "observer_fixture",
    label: "Observer fixture",
    description: "Retain the fixture's file-backed provider in child sessions",
    parameters: Type.Object({}),
    async execute() {
      return { content: [{ type: "text", text: "fixture" }], details: {} };
    },
  });
  pi.on("session_start", (_event, ctx) => {
    if (ctx.model?.id === "root") ctx.ui.notify("Observer fixture ready", "info");
  });
  pi.registerCommand("observer-fixture-exit", {
    description: "Exit this isolated observer fixture",
    handler: async (_args, ctx) => ctx.shutdown(),
  });
}
