import assert from "node:assert/strict";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import {
  contentText,
  type FauxResponseFactory,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  getCurrentTools,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type Context = Parameters<FauxResponseFactory>[0];

const url = "https://raw.githubusercontent.com/microsoft/TypeScript/v5.9.2/LICENSE.txt";

const result = (context: Context, name: string) =>
  context.messages
    .filter((message) => message.role === "toolResult")
    .findLast((message) => message.toolName === name);

const research: FauxResponseFactory = (context, _options, _state, model) => {
  assert.deepEqual(
    getCurrentTools(context.messages)
      .map((tool) => tool.name)
      .sort(),
    ["bash", "pstack_task", "pstack_tasks", "pstack_todo", "read", "web_fetch", "web_search"],
  );

  const fetched = context.messages.filter(
    (message) => message.role === "toolResult" && message.toolName === "web_fetch",
  );

  if (fetched.length === 0)
    return fauxAssistantMessage(
      [
        fauxToolCall("web_search", { query: "Public fixture research" }),
        fauxToolCall("web_fetch", { url, maxChars: 1000 }),
      ],
      { stopReason: "toolUse" },
    );
  const search = result(context, "web_search");
  assert.ok(search !== undefined && !search.isError);
  assert.match(contentText(search.content), /SEARCH_TRANSPORT_PROOF/);
  const first = fetched[0];
  assert.ok(first?.role === "toolResult" && !first.isError);
  assert.match(contentText(first.content), /Apache License/);
  const continuation = /contentRef:"([^"]+)", offset:(\d+)/.exec(contentText(first.content));
  assert.ok(continuation);
  const [, reference, offset] = continuation;
  assert.ok(reference !== undefined && offset !== undefined);

  if (fetched.length === 1)
    return fauxAssistantMessage(
      fauxToolCall("web_fetch", {
        contentRef: reference,
        offset: Number(offset),
        maxChars: 1000,
      }),
      { stopReason: "toolUse" },
    );
  const last = fetched.at(-1);
  assert.ok(last?.role === "toolResult" && !last.isError);
  assert.ok(contentText(last.content).includes(`Characters: ${offset}-`));

  if (model.id === "child") {
    const nested = result(context, "pstack_task");

    if (!nested)
      return fauxAssistantMessage(
        fauxToolCall("pstack_task", {
          prompt: "Research public evidence without writing",
          model: "web-smoke/leaf:off",
          run_in_background: false,
        }),
        { stopReason: "toolUse" },
      );
    assert.equal(nested.isError, false, contentText(nested.content));
    assert.match(contentText(nested.content), /WEB_VERIFIED leaf/);
  }

  return fauxAssistantMessage(`WEB_VERIFIED ${model.id}`);
};

export default function webSmoke(pi: ExtensionAPI) {
  const directory = process.env["PSTACK_WEB_SMOKE_DIR"];
  assert.ok(directory !== undefined && directory !== "");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const target = input instanceof Request ? input.url : String(input);
    const endpoint = new URL(target);

    if (endpoint.origin === "https://api.exa.ai") {
      assert.equal(endpoint.pathname, "/answer");
      appendFileSync(
        join(directory, "network.jsonl"),
        `${JSON.stringify({ mode: "mock-search", url: target })}\n`,
      );

      return Response.json({
        answer: "SEARCH_TRANSPORT_PROOF [1]",
        citations: [{ url: "https://example.com/evidence", title: "Fixture evidence" }],
      });
    }

    assert.equal(target, url, "Unexpected network request");
    appendFileSync(
      join(directory, "network.jsonl"),
      `${JSON.stringify({ mode: "live-fetch", url: target })}\n`,
    );

    return originalFetch(input, init);
  };

  pi.on("session_shutdown", () => {
    globalThis.fetch = originalFetch;
  });

  const provider = fauxProvider({
    provider: "web-smoke",
    models: ["root", "child", "leaf"].map((id) => ({ id, reasoning: false })),
    tokensPerSecond: Infinity,
  });

  const respond: FauxResponseFactory = (...args) => {
    const [context, , , model] = args;

    if (model.id !== "root") return research(...args);
    const child = result(context, "pstack_task");

    if (!child)
      return fauxAssistantMessage(
        fauxToolCall("pstack_task", {
          prompt: "Research public evidence without writing",
          model: "web-smoke/child:off",
          readonly: true,
          run_in_background: false,
        }),
        { stopReason: "toolUse" },
      );
    assert.equal(child.isError, false, contentText(child.content));
    assert.match(contentText(child.content), /WEB_VERIFIED child/);

    return fauxAssistantMessage("WEB_SMOKE_PASSED");
  };

  provider.setResponses(Array.from({ length: 30 }, () => respond));
  pi.registerProvider(provider.provider);
}
