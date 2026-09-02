# pi-pstack

`pi-pstack` is a standalone Pi port of pstack `0.14.7`.
One Pi package installs the extension adapters, supported pstack skills, agents, playbooks, scripts, official integration skills, and JavaScript runtime dependencies.

The package preserves upstream pstack content unless Pi needs a different host mechanism.
`vendor/pstack`, `upstream.lock.json`, `integrations.lock.json`, and `scripts/report-port.mjs` make that boundary inspectable.

## Pi runtime

- `Task` starts a persistent Pi worker with `isolation: worktree` or `isolation: current`.
- In a Herdr workspace, workers run in owned background tabs with completion wakes, resumable Pi sessions, and Herdr-owned worktrees.
- Outside Herdr, workers use persistent Pi session files, background completion wakes, and standard local Git worktrees.
- Pi's `/loop` command and the `pstack_loop` tool own bounded autonomous predicates.
- `pstack_question` presents an interactive selection and fails closed to a persisted human gate without a UI.
- `/setup-pstack` and `pstack_config` own model-role selectors, thinking levels, ordered panels, and panel sizes.
- `pstack_sessions` provides workspace-scoped transcript discovery and reads.
- `control-cli` uses the pinned official Herdr skill.
- `control-ui` uses the pinned official chrome-devtools-axi skill.
- The orchestration and PR watcher scripts use the system Bun runtime and package-managed JavaScript dependencies.

The package also exposes the lower-level `start_agents`, `send_agents`, `list_agents`, `interrupt_agent`, and `close_agent` lifecycle tools in Herdr sessions.
These tools preserve child Pi sessions when temporary worker tabs close.

## Install

Install the repository as one Pi package:

```bash
pi install git:github.com/Vistyy/pi-pstack
```

Install a local checkout during development:

```bash
pi install /absolute/path/to/pi-pstack
```

Herdr is optional but recommended for visible persistent worker tabs and workspace-owned worktrees.
Bun is a system prerequisite for the lifted orchestration and PR watcher scripts.
Git is required when a Task requests `isolation: worktree`.
Browser work uses `npx -y chrome-devtools-axi` as directed by the official skill.

Run `/setup-pstack` once to confirm that the creator-equivalent default role map is available or to select replacements.
The default map preserves the upstream model families, reasoning levels, panel order, and four-member review panels through Pi `provider/model` selectors.
Run `/poteto-mode` to enable sticky Poteto Mode for an interactive session.
Run `/loop <verified completion predicate>` for autonomous work that needs a bounded heartbeat, and run `/loop stop` to cancel it.

## Upstream content

The repository retains the upstream guide, assets, and Benny automation sources for provenance and porting review, but the npm package does not ship them as Pi runtime resources.
The unsupported Grok Bot webhook skill is intentionally omitted.
The root README and active skills are authoritative for Pi behavior.

Benny remains source-only because Pi does not provide an equivalent automation trigger, credential, and authorization lifecycle.

## Verification

Run the Pi boundary tests, lifted upstream script tests, and both typecheck boundaries with:

```bash
pnpm install
pnpm check
```

Run the complete provenance, package, integration, packed-profile, and worker-resource verification with:

```bash
pnpm port:verify
```

Inspect the complete Git overlay with `pnpm port:diff -- --name-status`, `pnpm port:diff`, or `pnpm port:difftool`.
`BENCHMARK.md` and `HARD-BENCHMARK.md` retain historical experiments and their interpretation limits.
Those runs predate the repaired worker identity, skill-loading, model-thinking, and panel-routing boundaries, so they are not evidence of current workflow conformance or effectiveness.
`ARCHITECTURE.md`, `PORTING.md`, `THIRD_PARTY_NOTICES.md`, and the lock files document ownership and update policy.
