# PStack for Pi

A local Pi baseline built from the actual PStack source, not a rewritten approximation of its workflows.

The pinned source is PStack **0.15.5**, commit `12d587dfb20741cafc376c42c696c5f6e2a64487`. The same pin supplies three unchanged Cursor Team Kit **1.2.0** methods: `deslop`, `control-cli`, and `control-ui`. `upstream.lock.json` records PStack's subtree identity, the toolkit's original subtree identity, and the selected toolkit snapshot identity. The separate Cursor MIT notice ships in `content/pstack/licenses/cursor-team-kit.LICENSE`.

## Scope

The current implementation targets local quality work: setup, role/model configuration, Poteto-mode routing, understanding, alternative design, implementation discipline, critique, verification, PR opening, and requested review/CI follow-up. It registers `setup-pstack`, `poteto-mode`, `how`, `why`, `architect`, `arena`, `interrogate`, `unslop`, `no-comments`, `technical-writing`, `deslop`, `control-cli`, `control-ui`, and the principle leaves. Mode workflows also read their packaged dependencies, including `swarm`, `figure-it-out`, `show-me-your-work`, and `tdd`; a file's presence does not register another slash command.

Orchestrate, both Autopilots, scheduled Autonomous run, automated Shipping, macOS simulator/host-cache cleanup, and the cloud automation pack are removed from the adopted content through explicit path exclusions and patches to retained files. The untouched upstream snapshot retains them for provenance. Local parallel review remains, including the multi-phase plan's ten live lanes, performance checks, independent audit lanes, and operator review gates. Each lane needs adequate local isolation; missing capabilities are gaps, not passes. External evidence integrations must actually be available for their `why` categories. The three toolkit methods are bundled, not replaced with personal skills. Skill authoring uses an explicit Pi-native playbook grounded in the running Pi version's documentation and Anthropic's writing guidance, instead of Cursor's built-in `create-skill`. An unavailable evidence capability is reported at the step that needs it; it does not waive the procedure.

Opening a PR requires publication authority and does not start Babysit. Babysit starts on request, can check once or drive review/CI to merge-ready within a live session, and never merges or arms auto-merge. Its upstream GitHub watcher requires Bun and authenticated `gh`; it installs its locked dependencies on first use. Origin uses the documented Origin CLI path instead. No live forge operation is needed for local development checks.

Git worktree cleanup retains the original safety-gated workflow with a Node audit and bounded Pi session evidence. The audit refreshes `origin/main` and queries GitHub PRs; it never deletes. Its buckets do not grant deletion authority: live/pinned usage and tracked uncommitted edits still gate removal. Stored history is scoped to known worktrees, explicitly authorized custom directories, and the exact current transcript; file mtime is only a recency heuristic. It requires GNU `du` and authenticated `gh`; missing or failed evidence is reported. Simulator, host application state, and unrelated cache cleanup are not included.

No personalization, migration of old Pi-PStack settings, or changes to other installed extensions are included.

PStack owns the workflow, verification, and review. The private executor supplies child sessions and their lifecycle, not workflow decisions or Git automation.

Repository setup, patching, verification, and upstream-update instructions live in [AGENTS.md](AGENTS.md).

## Runtime configuration

After the dependency setup in [AGENTS.md](AGENTS.md#development-and-verification), load this checkout as a local Pi package. Its manifest loads the PStack extension and packaged skills. For isolated evaluation, put the checkout's absolute path in the isolated agent directory's `settings.json` `packages` array; do not register the extension a second time. No separate subagent package or backend configuration is required.

`/setup-pstack` guides model selection and confirmation. `pstack_models` lists exact available Pi models and supported thinking levels, reads the role map, and saves the confirmed complete map to the current Pi agent directory's `pstack-models.json`.

Real targets use `provider/model:thinking`. Cursor slugs remain source defaults, not automatic executable aliases. Explicit `inherit-parent` and `auto` resolve to the current parent's model and thinking. Panels retain their order, repeated entries, and chosen cardinality. Budget adjustment stays within the selected model's supported reasoning levels; it does not substitute another family.

`/poteto-mode on` and `/poteto-mode off` change branch-local mode state. The current Pi session branch owns that state; there is no separate mode cache to restore. `/poteto-mode <task>` expands the packaged skill in interactive and RPC sessions. For print/JSON execution, use `/skill:poteto-mode <task>` directly. Enabled parent sessions receive the full generated mode on each prompt, including after native compaction.

## Questions

`pstack_question` presents one question at a time in Pi's terminal UI. Each question offers single-choice options and an **Other** multiline editor. Outside the Other editor, use ←/→ to browse freely, including unanswered questions; Enter saves an answer and advances. Page Up/Down scrolls text rather than changing questions. The final review marks unanswered questions and requires every answer before submission. Cancellation or an aborted call discards the questionnaire's answers; only explicit submission returns them to the agent.

Question bodies support Pi's Markdown rendering, including tables and fenced text diagrams. Long bodies can be scrolled; diagrams should fit the terminal width. This is a text UI, not a Mermaid renderer or browser form. Outside the terminal UI, including RPC and private child sessions, the tool reports that UI is unavailable so the caller can ask conversationally instead.

## Child execution

`pstack_task` runs the source `generalPurpose`, `poteto-agent`, and `Comment Sicko` assignments. Each child starts with its own conversation, project `AGENTS.md` context, and selected model/thinking. Ambient system-prompt overrides, prompt templates, and skill catalogs are not inherited. Poteto children receive the full source mode; ordinary children do not inherit the parent's Poteto mode or conversation.

Foreground calls return their results and can run in parallel. Background calls return an ID and deliver completion automatically. A child awaiting its own children remains active until their results and its subsequent response settle. Resuming an eligible ID preserves the child's conversation and configuration. `pstack_tasks` returns a compact list, inspects a child's saved result and transcript path, or cancels owned children. Full child transcripts do not enter the parent context unless requested.

The root can delegate to children, and children to grandchildren; grandchildren cannot delegate further. Read-only assignments restrict tools and preserve that restriction through descendants. They are not operating-system sandboxes. Writable children reload the file-backed extensions supplying the parent's active tools, including configured integrations for workflows such as `why`. Read-only children do not load those integration extensions. The supported main host is normal Pi with file-backed extensions, not arbitrary SDK-embedded applications.

Child sessions run in the parent's process. They share the filesystem and use the supplied working directory. Candidate worktrees or directories must be prepared and managed by the PStack workflow, not by the executor. Cancellation does not undo external effects or edits.

Children belong to their owning parent's saved branch. Normal exit, reload, or starting branch navigation interrupts active work and prevents late results from entering another conversation. Navigation cancellation does not restart interrupted children. Extension startup and shutdown hooks are awaited. An uncooperative integration hook can delay teardown.

### Recovery

Reopening the same parent session restores saved task IDs, assignments, configuration, outcomes, and transcript references. It does not start child execution or trigger a parent turn. A different parent session cannot resume these IDs. Tasks created before task-record persistence was available do not gain recovery metadata retroactively.

The next user-initiated turn receives a compact notice of interrupted tasks and unreceived results. Extension-origin turns do not consume the notice. Recovery information already present in the saved model context is not injected again. Normal task execution receives no additional inventory or status turns.

The parent uses `pstack_tasks` to inspect saved results and `pstack_task` with `resume` to continue a saved conversation. Resumption retains the selected model, profile, working directory, and tool plan. An unavailable model or missing initialized transcript causes an error rather than a fallback or a replacement conversation. Explicitly cancelled tasks remain cancelled until an explicit resume request.

Recovery uses native Pi session files, not a database or a persistent worker service. It preserves saved message boundaries, not an execution stack or partial streamed output. A hard crash can leave spawned tool processes running. The parent or resumed child must reconcile actual effects before repeating interrupted work. Power-loss durability and exactly-once external effects are not guaranteed. Recovery assumes one active Pi owner of a parent session. It does not coordinate concurrent processes opening the same parent or child session files.

### Subagent observer

`/subagents` opens a read-only task tree and native Pi transcript in the terminal UI. It shows live children, nested work, and saved history after reopening a parent session. Opening the observer does not start or resume work, send model messages, accept results, or change transcripts. The activity rail shows running and waiting counts only. Failed tasks and their error details remain in the inspector and are delivered normally to the parent, without a persistent failure warning or an acknowledgement mechanism.

Use Up/Down to select a task, Left/Right to fold its children, and Enter for a full-width transcript. Escape returns to the tree or closes the observer. Page Up/Down scroll the transcript, Home goes to its beginning, End follows the latest output, and Ctrl+O toggles tool detail. New output does not move a held viewport. Narrow terminals show the tree first. There are no execution controls or mouse actions in this view.

The observer uses Pi's current theme and native message/tool components. Live tools use their loaded renderers. Saved integrations use generic rendering rather than loading extensions just to inspect history. Images are represented without inline image rendering. Saved transcripts are snapshots for that opening of the inspector, refreshed when reopened or when the task changes state. They are read from their recorded paths and parsed in memory, never opened as executable child sessions.

The repeatable TUI check is `python3 scripts/verify-observer.py`. It requires Python 3 and tmux, uses an isolated Pi profile and scripted provider, and retains captures under `.work/observer-verification/`. It does not change the normal Pi profile or use paid models.

### Investigation tools

`readonly: true` requests investigation without modifying files or external state. New children receive `read`, `bash`, `pstack_task`, `pstack_tasks`, and `pstack_todo`, subject to exclusions. They do not receive `write`, `edit`, `grep`, `find`, `ls`, or integration tools. Search and listing can use non-mutating shell commands.

The child receives an explicit no-write instruction. Bash can still modify state, so `readonly` is not an enforced filesystem boundary or sandbox. Descendants inherit the restriction and cannot opt out. Writable children continue to inherit their parent's active tools, subject to exclusions. Saved tasks retain their original tool plans when resumed, including older inspection tool sets.

### Child tool exclusions

Set `pi-pstack.excludedChildTools` in the global Pi `settings.json` (normally `~/.pi/agent/settings.json`) to keep selected tools out of new child sessions:

```json
{
  "pi-pstack": {
    "excludedChildTools": ["name_session", "start_session", "tuicr_review"]
  }
}
```

Names match exactly; absent tools have no effect. An omitted list means no extra exclusions. Project settings cannot override this list. An invalid global setting or unreadable global configuration prevents child creation rather than silently dropping the exclusions.

Exclusions apply after the child's normal tool selection, including read-only restrictions, and also apply to newly created grandchildren. The parent's tools are unchanged. Changes to the list affect new sessions; running and resumed children keep their original configuration. An inherited integration tool absent from the immediate parent is not restored merely by removing its name from the list.

Pi's native tool filtering excludes these tools from execution as well as from the model's tool catalog. The adapter also skips an inherited extension when none of its active tools remain needed. A mixed extension still loads to supply permitted tools, so its startup hooks still run. This is tool selection, not a sandbox for extensions or shell access.

## Evidence integrations

`why` can use Pi-native tools, configured MCP integrations, or documented CLIs for its evidence categories. Missing integrations are reported as gaps. No MCP server is required merely to use this package. MCP transport, discovery, and authentication belong to the selected host integration; the child adapter does not implement an MCP client, and extension loading alone does not prove MCP compatibility.
