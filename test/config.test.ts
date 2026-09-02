import assert from "node:assert/strict";
import test from "node:test";
import { defaultConfig, modelsForRole } from "../extensions/pstack/config.ts";

test("default model roles inherit the parent model", () => {
  assert.deepEqual(modelsForRole(defaultConfig(), "swarm workers"), []);
});

test("model roles preserve ordered available-model candidates", () => {
  const config = defaultConfig();
  config.roles["swarm workers"] = [
    "openai-codex/gpt-5.6-luna",
    "inherit-parent",
    "anthropic/claude-sonnet-4-6",
    "auto",
  ];
  assert.deepEqual(modelsForRole(config, "swarm workers"), [
    "openai-codex/gpt-5.6-luna",
    "anthropic/claude-sonnet-4-6",
  ]);
});
