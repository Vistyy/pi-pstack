import assert from "node:assert/strict";
import { appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import {
  contentText,
  type FauxResponseFactory,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function modeFixture(pi: ExtensionAPI) {
  const directory = process.env["PSTACK_MODE_DIR"];
  assert.ok(directory !== undefined && directory !== "");

  const provider = fauxProvider({
    provider: "mode-fixture",
    models: [{ id: "root", reasoning: false }],
    tokensPerSecond: Infinity,
  });

  const respond: FauxResponseFactory = (context) => {
    appendFileSync(join(directory, "requests.jsonl"), `${JSON.stringify({ context })}\n`);
    const user = context.messages.findLast((message) => message.role === "user");

    if (
      user?.role === "user" &&
      contentText(user.content) === "hold" &&
      context.messages.at(-1)?.role !== "toolResult"
    )
      return fauxAssistantMessage(fauxToolCall("mode_hold", {}), { stopReason: "toolUse" });

    return fauxAssistantMessage("Mode fixture complete.");
  };

  provider.setResponses(Array.from({ length: 40 }, () => respond));
  pi.registerProvider(provider.provider);
  pi.registerTool({
    name: "mode_hold",
    label: "Hold mode fixture",
    description: "Hold an owned fixture turn until its harness releases it",
    parameters: Type.Object({}),
    async execute(_id, _args, signal) {
      while (!existsSync(join(directory, "release"))) await setTimeout(10, undefined, { signal });

      return { content: [{ type: "text", text: "released" }], details: {} };
    },
  });
  pi.registerCommand("mode-exit", {
    description: "Exit the owned mode fixture",
    handler: async (_args, ctx) => ctx.shutdown(),
  });
}
