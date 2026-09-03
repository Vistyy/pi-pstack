import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { defaultConfig } from "../../extensions/pstack/config.js";
import { registerTools } from "../../extensions/pstack-workers/index.js";
import type { AgentManager } from "../../extensions/pstack-workers/manager.js";
import { formatBatchCompletion } from "../../extensions/pstack-workers/notifications.js";
import type { ExtensionConfig, OwnedAgentCollection, OwnedAgentRecord } from "../../extensions/pstack-workers/types.js";

type RegisteredTool = {
  name: string;
  description?: string;
  promptGuidelines?: unknown;
  execute: (...args: unknown[]) => Promise<Record<string, unknown>>;
};

function record(overrides: Partial<OwnedAgentRecord> = {}): OwnedAgentRecord {
  return {
    name: "analysis",
    identity: "analysis",
    keepOpen: false,
    status: "closed",
    cwd: "/repo",
    assignment: 1,
    completedAssignment: 1,
    lastTask: "Inspect the relevant source.",
    lastResult: "Inspection complete.",
    updatedAt: 1,
    ...overrides,
  };
}

function collection(result = record()): OwnedAgentCollection {
  return {
    id: "batch-1",
    members: [{ name: result.name, assignment: result.assignment, result }],
    createdAt: 1,
    notified: false,
  };
}

function registeredTools(manager: AgentManager): RegisteredTool[] {
  const tools: RegisteredTool[] = [];
  const pi = {
    registerTool(tool: unknown) {
      tools.push(tool as RegisteredTool);
    },
  } as unknown as ExtensionAPI;
  const config: ExtensionConfig = {
    maxAgents: 1,
    defaults: {},
    identities: [{
      name: "analysis",
      description: "Use for read-only analysis with additional reasoning effort.",
      sourcePath: "/config/agents/analysis.md",
    }, {
      name: "general-purpose",
      description: "General pstack worker.",
      sourcePath: "/package/identities/general-purpose.md",
    }, {
      name: "poteto-agent",
      description: "Persistent Poteto worker.",
      sourcePath: "/package/identities/poteto-agent.md",
    }],
    warnings: [],
  };

  registerTools(pi, config, () => manager, {
    readModelConfig: async () => {
      const modelConfig = defaultConfig();
      for (const role of Object.keys(modelConfig.roles)) {
        const current = modelConfig.roles[role];
        modelConfig.roles[role] = Array.isArray(current)
          ? current.map(() => ({ model: "inherit-parent" }))
          : { model: "inherit-parent" };
      }
      return modelConfig;
    },
  });
  return tools;
}

function tool(tools: RegisteredTool[], name: string): RegisteredTool {
  const found = tools.find((candidate) => candidate.name === name);
  assert.ok(found);
  return found;
}

test("agent tools expose mechanisms without embedding orchestration policy", () => {
  const tools = registeredTools({} as AgentManager);
  const start = tool(tools, "start_agents");
  const send = tool(tools, "send_agents");

  assert.equal("promptGuidelines" in start, false);
  assert.equal("promptGuidelines" in send, false);
  const descriptions = `${String(start.description)}\n${String(send.description)}`;
  assert.doesNotMatch(descriptions, /bounded evidence|parent retains|parent owns|recommendation|verdict|synthesis/i);
});

test("start and send results do not terminate the parent turn", async () => {
  let current = record({ status: "working", completedAssignment: 0 });
  const manager = {
    start: async () => current,
    send: async () => {
      if (current.status !== "working") {
        current = record({ assignment: current.assignment + 1, status: "working", completedAssignment: current.assignment });
      }
      return current;
    },
    getRecords: () => [current],
    batch: (records: OwnedAgentRecord[]) => collection(records[0]),
  } as unknown as AgentManager;
  const tools = registeredTools(manager);
  const signal = new AbortController().signal;

  const started = await tool(tools, "start_agents").execute(
    "start-call",
    { agents: [{ name: "analysis", identity: "analysis", task: "Inspect the relevant source." }] },
    signal,
    undefined,
    { cwd: "/repo" },
  );
  const guided = await tool(tools, "send_agents").execute(
    "send-call",
    { agents: [{ name: "analysis", message: "Check one more detail." }] },
    signal,
  );

  current = record();
  const reassigned = await tool(tools, "send_agents").execute(
    "reassign-call",
    { agents: [{ name: "analysis", message: "Inspect the follow-up." }] },
    signal,
  );

  assert.equal("terminate" in started, false);
  assert.equal("terminate" in guided, false);
  assert.equal("terminate" in reassigned, false);
});

test("Task maps Pi-native fields to one background persistent worker", async () => {
  let started: Record<string, unknown> | undefined;
  let worktreeArgs: unknown[] | undefined;
  const current = record({ name: "bug-fix-1", identity: "general-purpose", status: "working", completedAssignment: 0 });
  const manager = {
    getRecords: () => [],
    createWorktree: async (...args: unknown[]) => {
      worktreeArgs = args;
      return { workspaceId: "worktree-ws", tabId: "worktree-tab", paneId: "worktree-pane", path: "/worktrees/bug-fix", branch: "pstack/bug-fix" };
    },
    start: async (options: Record<string, unknown>) => {
      started = options;
      return current;
    },
    batch: (records: OwnedAgentRecord[]) => collection(records[0]),
  } as unknown as AgentManager;
  const tools = registeredTools(manager);
  const result = await tool(tools, "Task").execute(
    "task-call",
    {
      description: "Bug fix",
      prompt: "Reproduce and fix the defect.",
      identity: "general-purpose",
      model: "openai-codex/gpt-5.6-luna",
      thinking: "high",
      readonly: true,
      run_in_background: true,
      isolation: "worktree",
      base_branch: "release/next",
    },
    new AbortController().signal,
    undefined,
    {
      cwd: "/repo",
      modelRegistry: {
        getAvailable: () => [{ provider: "openai-codex", id: "gpt-5.6-luna" }],
      },
    },
  );

  assert.equal(worktreeArgs?.[0], "/repo");
  assert.equal(worktreeArgs?.[2], "bug-fix-1");
  assert.equal(worktreeArgs?.[3], "release/next");
  assert.deepEqual(started, {
    name: "bug-fix-1",
    identityName: "general-purpose",
    task: "Reproduce and fix the defect.",
    keepOpen: false,
    cwd: "/worktrees/bug-fix",
    placement: {
      workspaceId: "worktree-ws",
      tabId: "worktree-tab",
      paneId: "worktree-pane",
      path: "/worktrees/bug-fix",
      branch: "pstack/bug-fix",
    },
    runtime: {
      provider: "openai-codex",
      model: "gpt-5.6-luna",
      thinking: "high",
      tools: ["read", "grep", "find", "ls", "pstack_todo"],
    },
  });
  assert.match(String((result.content as Array<{ text: string }>)[0].text), /Completion will wake the parent/);
});

test("Task resumes a compatible settled Poteto worker in the same checkout", async () => {
  const reusable = record({
    name: "poteto-agent-1",
    identity: "poteto-agent",
    status: "closed",
    cwd: "/repo",
    runtime: { provider: "openai-codex", model: "gpt-5.6-luna", thinking: "high" },
  });
  const resumed = record({ ...reusable, status: "working", assignment: 2, completedAssignment: 1, lastTask: "Implement the follow-up." });
  let started = false;
  let sent: unknown[] | undefined;
  const manager = {
    getRecords: () => [reusable],
    start: async () => {
      started = true;
      return resumed;
    },
    send: async (...args: unknown[]) => {
      sent = args;
      return resumed;
    },
    waitForSettlement: async () => record({ ...resumed, status: "closed", completedAssignment: 2, lastResult: "REUSED_OK" }),
  } as unknown as AgentManager;
  const result = await tool(registeredTools(manager), "Task").execute(
    "task-call",
    {
      description: "Follow-up",
      prompt: "Implement the follow-up.",
      identity: "poteto-agent",
      model: "openai-codex/gpt-5.6-luna",
      thinking: "high",
      run_in_background: false,
      isolation: "current",
    },
    new AbortController().signal,
    undefined,
    {
      cwd: "/repo",
      modelRegistry: { getAvailable: () => [{ provider: "openai-codex", id: "gpt-5.6-luna" }] },
    },
  );

  assert.equal(started, false);
  assert.equal(sent?.[0], "poteto-agent-1");
  assert.equal(sent?.[1], "Implement the follow-up.");
  assert.equal((result.content as Array<{ text: string }>)[0].text, "REUSED_OK");
});

test("Task does not resume a Poteto worker across a model or worktree boundary", async () => {
  const reusable = record({
    name: "poteto-agent-1",
    identity: "poteto-agent",
    status: "closed",
    cwd: "/repo",
    runtime: { provider: "openai-codex", model: "gpt-5.6-luna", thinking: "high" },
  });
  let sends = 0;
  let starts = 0;
  const manager = {
    getRecords: () => [reusable],
    createWorktree: async () => ({ workspaceId: "ws", tabId: "tab", paneId: "pane", path: "/worktree", branch: "branch" }),
    start: async () => {
      starts += 1;
      return record({ name: `poteto-agent-${starts + 1}`, identity: "poteto-agent", status: "working", completedAssignment: 0 });
    },
    send: async () => {
      sends += 1;
      return reusable;
    },
    batch: (records: OwnedAgentRecord[]) => collection(records[0]),
  } as unknown as AgentManager;
  const taskTool = tool(registeredTools(manager), "Task");
  const context = {
    cwd: "/repo",
    modelRegistry: { getAvailable: () => [
      { provider: "openai-codex", id: "gpt-5.6-luna" },
      { provider: "openai-codex", id: "gpt-5.6-terra" },
    ] },
  };

  await taskTool.execute("model-call", {
    prompt: "Use Terra.", identity: "poteto-agent", model: "openai-codex/gpt-5.6-terra", thinking: "high", run_in_background: true,
  }, new AbortController().signal, undefined, context);
  await taskTool.execute("worktree-call", {
    prompt: "Use a worktree.", identity: "poteto-agent", model: "openai-codex/gpt-5.6-luna", thinking: "high", run_in_background: true, isolation: "worktree",
  }, new AbortController().signal, undefined, context);

  assert.equal(sends, 0);
  assert.equal(starts, 2);
});

test("pstack_panel owns configured cardinality, slot expansion, concurrent dispatch, and collection", async () => {
  const starts: Array<Record<string, unknown>> = [];
  const manager = {
    getRecords: () => [],
    start: async (options: Record<string, unknown>) => {
      starts.push(options);
      return record({
        name: String(options.name),
        identity: String(options.identityName),
        status: "working",
        completedAssignment: 0,
        lastTask: String(options.task),
      });
    },
    waitForSettlement: async (name: string) => record({ name, lastResult: `result from ${name}` }),
  } as unknown as AgentManager;
  const panel = tool(registeredTools(manager), "pstack_panel");
  const result = await panel.execute(
    "panel-call",
    {
      role: "interrogate reviewers",
      prompt: "Review as slot {{PSTACK_PANEL_INDEX}} ({{PSTACK_PANEL_LABEL}}).",
      identity: "general-purpose",
      readonly: true,
    },
    new AbortController().signal,
    undefined,
    { cwd: "/repo", modelRegistry: { getAvailable: () => [] } },
  );

  assert.equal(starts.length, 4);
  assert.deepEqual(starts.map((start) => start.task), [
    "Review as slot 1 (A).",
    "Review as slot 2 (B).",
    "Review as slot 3 (C).",
    "Review as slot 4 (D).",
  ]);
  assert.match((result.content as Array<{ text: string }>)[0].text, /## Panel A/);
  assert.match((result.content as Array<{ text: string }>)[0].text, /## Panel D/);
});

test("Task rejects an unavailable explicit model before starting a worker", async () => {
  let started = false;
  const manager = {
    getRecords: () => [],
    start: async () => {
      started = true;
      return record();
    },
  } as unknown as AgentManager;
  await assert.rejects(
    tool(registeredTools(manager), "Task").execute(
      "task-call",
      { prompt: "Inspect this.", model: "missing/model" },
      new AbortController().signal,
      undefined,
      { cwd: "/repo", modelRegistry: { getAvailable: () => [] } },
    ),
    /Unavailable Task model/,
  );
  assert.equal(started, false);
});

test("Task waits for a foreground worker and returns its final result", async () => {
  const working = record({ name: "analysis-1", identity: "general-purpose", status: "working", completedAssignment: 0 });
  const settled = record({ name: "analysis-1", identity: "general-purpose", status: "closed", lastResult: "FOREGROUND_OK" });
  let batched = false;
  const manager = {
    getRecords: () => [],
    start: async () => working,
    waitForSettlement: async () => settled,
    batch: () => {
      batched = true;
      return collection();
    },
  } as unknown as AgentManager;
  const result = await tool(registeredTools(manager), "Task").execute(
    "task-call",
    { description: "Analysis", prompt: "Return one result.", identity: "general-purpose", run_in_background: false, isolation: "current" },
    new AbortController().signal,
    undefined,
    { cwd: "/repo", modelRegistry: { getAvailable: () => [] } },
  );

  assert.equal((result.content as Array<{ text: string }>)[0].text, "FOREGROUND_OK");
  assert.equal(batched, false);
});

test("a grouped completion report contains lifecycle state without workflow instructions", () => {
  const grouped = formatBatchCompletion(collection(record()));

  assert.equal(grouped, "Owned agent batch batch-1 settled.\n\n## analysis\n\nInspection complete.");
  assert.doesNotMatch(grouped, /integrate|synthesize|continue|delegate|parent/i);
});
