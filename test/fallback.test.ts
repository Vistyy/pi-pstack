import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import pstackFallback from "../extensions/pstack-fallback/index.js";

type Tool = { name: string };

function registrations(): Tool[] {
  const tools: Tool[] = [];
  const pi = {
    on() {},
    registerTool(tool: Tool) {
      tools.push(tool);
    },
  } as unknown as ExtensionAPI;
  pstackFallback(pi);
  return tools;
}

test("registers the persistent Task fallback outside Herdr", () => {
  const previous = { environment: process.env.HERDR_ENV, workspace: process.env.HERDR_WORKSPACE_ID };
  delete process.env.HERDR_ENV;
  delete process.env.HERDR_WORKSPACE_ID;
  try {
    assert.deepEqual(registrations().map((tool) => tool.name), ["Task"]);
  } finally {
    if (previous.environment === undefined) delete process.env.HERDR_ENV;
    else process.env.HERDR_ENV = previous.environment;
    if (previous.workspace === undefined) delete process.env.HERDR_WORKSPACE_ID;
    else process.env.HERDR_WORKSPACE_ID = previous.workspace;
  }
});

test("leaves Task ownership to the Herdr worker inside a Herdr workspace", () => {
  const previous = { environment: process.env.HERDR_ENV, workspace: process.env.HERDR_WORKSPACE_ID };
  process.env.HERDR_ENV = "1";
  process.env.HERDR_WORKSPACE_ID = "w1";
  try {
    assert.deepEqual(registrations(), []);
  } finally {
    if (previous.environment === undefined) delete process.env.HERDR_ENV;
    else process.env.HERDR_ENV = previous.environment;
    if (previous.workspace === undefined) delete process.env.HERDR_WORKSPACE_ID;
    else process.env.HERDR_WORKSPACE_ID = previous.workspace;
  }
});
