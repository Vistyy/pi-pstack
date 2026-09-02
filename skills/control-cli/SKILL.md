---
name: control-cli
description: Drive, inspect, and profile an interactive CLI or TUI through Herdr. Use for CLI UX checks, prompt flows, startup regressions, hangs, memory leaks, terminal evidence, or reproducing CLI bugs.
---

# Control CLI through Herdr

Use a repeatable Herdr-managed terminal surface instead of manually poking at the CLI.
Read the official `herdr` skill before issuing Herdr commands.
Reuse the repository's own CLI or PTY harness when it already provides stronger deterministic control.

## Harness loop

1. Identify the command and smallest reproducible workspace.
2. Inspect existing package scripts, end-to-end tests, PTY helpers, and demo harnesses.
3. When no stronger harness exists, create a background Herdr pane in the current workspace and preserve the required working directory.
4. Run the command in that pane without taking user focus.
5. Capture the current terminal output before interacting.
6. Send one action at a time and wait for a concrete screen or output condition.
7. Capture the resulting output and any requested profile artifacts.
8. Close only panes created by this run after their evidence has been retained.

Use `herdr pane run` for ordinary commands, `herdr pane wait-output` for deterministic readiness, `herdr pane read --source recent-unwrapped` for transcripts, and the agent surface only when the pane actually hosts a recognized coding agent.
Use explicit pane IDs returned by Herdr and never infer ownership from focus or sidebar position.

## Verification

Verify state-changing actions from a fresh terminal read or a deterministic external check.
Prefer output patterns and exit status over sleeps.
Record the command, inputs, relevant output, and cleanup result.

## Guardrails

Do not send credentials or destructive commands into a controlled session without the authority already required by the parent workflow.
Do not close panes, tabs, workspaces, or processes not created by this run.
Keep temporary harnesses outside the repository unless the user asks for a reusable checked-in harness.
