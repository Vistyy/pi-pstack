import assert from "node:assert/strict";
import test from "node:test";
import { defaultConfig, parseConfig, targetsForRole } from "../extensions/pstack/config.ts";

test("defaults preserve the creator's role routing, thinking, and panel fan-out", () => {
  assert.deepEqual(targetsForRole(defaultConfig(), "swarm workers"), [
    { model: "opencode-go/grok-4.6", thinking: "xhigh" },
  ]);
  assert.deepEqual(targetsForRole(defaultConfig(), "architect runners"), [
    { model: "openrouter/anthropic/claude-fable-5.1", thinking: "max" },
    { model: "openai-codex/gpt-5.6-sol", thinking: "max" },
    { model: "opencode-go/grok-4.6", thinking: "xhigh" },
    { model: "openrouter/anthropic/claude-opus-5", thinking: "xhigh" },
  ]);
});

test("model configuration rejects malformed or mistyped role entries instead of selecting defaults", () => {
  assert.throws(() => parseConfig({ version: 2, roles: { "bug-fxi": { model: "inherit-parent" } } }), /Unknown pstack role/);
  assert.throws(() => parseConfig({ version: 2, roles: { "bug-fix": [] } }), /Invalid pstack model target/);
  assert.throws(() => parseConfig({ version: 2, roles: { "arena runners": { model: "inherit-parent" } } }), /requires a non-empty model panel/);
  assert.throws(() => parseConfig({ version: 1, roles: {} }), /requires version 2/);
});

test("model configuration accepts partial valid overrides and preserves other defaults", () => {
  const config = parseConfig({ version: 2, roles: { "bug-fix": { model: "openai-codex/gpt-5.6-luna", thinking: "high" } } });

  assert.deepEqual(config.roles["bug-fix"], { model: "openai-codex/gpt-5.6-luna", thinking: "high" });
  assert.deepEqual(config.roles["swarm workers"], defaultConfig().roles["swarm workers"]);
});

test("model roles preserve ordered selectors and thinking levels", () => {
  const config = defaultConfig();
  config.roles["swarm workers"] = {
    model: "openai-codex/gpt-5.4-mini",
    thinking: "high",
  };
  config.roles["architect runners"] = [
    { model: "openai-codex/gpt-5.6-luna", thinking: "max" },
    { model: "inherit-parent" },
    { model: "anthropic/claude-sonnet-4-6", thinking: "high" },
    { model: "auto" },
  ];
  assert.deepEqual(targetsForRole(config, "swarm workers"), [
    { model: "openai-codex/gpt-5.4-mini", thinking: "high" },
  ]);
  assert.deepEqual(targetsForRole(config, "architect runners"), [
    { model: "openai-codex/gpt-5.6-luna", thinking: "max" },
    { model: "inherit-parent" },
    { model: "anthropic/claude-sonnet-4-6", thinking: "high" },
    { model: "auto" },
  ]);
});
