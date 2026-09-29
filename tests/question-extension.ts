import assert from "node:assert/strict";
import { appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  contentText,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function questionFixture(pi: ExtensionAPI) {
  const key = "PSTACK_QUESTION_DIR";
  const directory = process.env[key];
  assert.ok(directory !== undefined && directory !== "");

  const provider = fauxProvider({
    provider: "question-fixture",
    models: [{ id: "root", reasoning: false }],
    tokensPerSecond: Infinity,
  });

  const mixed = [
    {
      id: "storage",
      question:
        "# Storage\n\n| Choice | Location |\n|---|---|\n| Local | This machine |\n| Remote | Elsewhere |",
      options: ["Local", "Remote"],
    },
    {
      id: "areas",
      question: `# Focus areas\n\n${"Consider the affected user workflow. ".repeat(30)}\n\nEND OF BODY`,
      options: ["Correctness", "UX", "Performance"],
      allow_multiple: true,
    },
  ];

  provider.setResponses(
    Array.from({ length: 20 }, () => (context) => {
      const user = context.messages.findLast((item) => item.role === "user");
      assert.ok(user?.role === "user");
      const request = contentText(user.content);

      if (context.messages.at(-1)?.role === "toolResult")
        return fauxAssistantMessage(`Question fixture complete. ${request}`);
      assert.ok(
        ["questions-mixed", "questions-other", "questions-cancel", "questions-abort"].includes(
          request,
        ),
      );

      const questions =
        request === "questions-other"
          ? [
              {
                id: "custom",
                question: "Choose listed options, add Other, or combine both.",
                options: ["Docs", "Tests"],
                allow_multiple: true,
              },
            ]
          : mixed;

      return fauxAssistantMessage(fauxToolCall("pstack_question", { questions }), {
        stopReason: "toolUse",
      });
    }),
  );
  pi.registerProvider(provider.provider);
  pi.events.on("herdr:blocked", (event) => {
    appendFileSync(join(directory, "blocked.jsonl"), `${JSON.stringify(event)}\n`);
  });
  let timer: ReturnType<typeof setInterval> | undefined;
  pi.on("tool_call", (event, ctx) => {
    if (event.toolName !== "pstack_question") return;
    timer = setInterval(() => {
      if (existsSync(join(directory, "abort"))) ctx.abort();
    }, 20);
    timer.unref();
  });
  pi.on("tool_result", (event) => {
    if (event.toolName !== "pstack_question") return;
    clearInterval(timer);
    appendFileSync(join(directory, "outcomes.jsonl"), `${contentText(event.content)}\n`);
  });
  pi.on("session_shutdown", () => clearInterval(timer));
  pi.registerCommand("question-fixture-exit", {
    description: "Exit the owned question fixture",
    handler: async (_args, ctx) => ctx.shutdown(),
  });
}
