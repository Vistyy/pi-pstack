# PStack for Pi

A local Pi baseline built from the actual PStack source, not a rewritten approximation of its workflows.

The pinned source is PStack **0.15.5**, commit `12d587dfb20741cafc376c42c696c5f6e2a64487`. `upstream.lock.json` records the repository and exact subtree identity.

## Scope

The current implementation targets local quality work: setup, role/model configuration, Poteto-mode routing, understanding, alternative design, implementation discipline, critique, verification, PR opening, and requested review/CI follow-up. It registers `setup-pstack`, `poteto-mode`, `how`, `why`, `architect`, `arena`, `interrogate`, `unslop`, `no-comments`, `technical-writing`, and the principle leaves. Mode workflows also read their packaged dependencies, including `swarm`, `figure-it-out`, `show-me-your-work`, and `tdd`; a file's presence does not register another slash command.

Orchestrate, both Autopilots, scheduled Autonomous run, automated Shipping, Cursor cleanup, and the cloud automation pack are removed from the adopted content through explicit path exclusions and patches to retained files. The untouched upstream snapshot retains them for provenance. Local parallel review remains, including the multi-phase plan's ten live lanes, performance checks, independent audit lanes, and operator review gates. Each lane needs adequate local isolation; missing capabilities are gaps, not passes. External evidence integrations must actually be available for their `why` categories. Cursor and cursor-team-kit dependencies are not replaced with personal skills. An unavailable dependency is reported at the step that needs it; it does not waive the upstream procedure.

Opening a PR requires publication authority and does not start Babysit. Babysit starts on request, can check once or drive review/CI to merge-ready within a live session, and never merges or arms auto-merge. Its upstream GitHub watcher requires Bun and authenticated `gh`; it installs its locked dependencies on first use. Origin uses the documented Origin CLI path instead. No live forge operation is needed for local development checks.

No personalization, migration of old Pi-PStack settings, or changes to other installed extensions are included.

PStack owns the workflow, verification, and review. The private executor supplies child sessions and their lifecycle, not workflow decisions or Git automation.

Repository setup, patching, verification, and upstream-update instructions live in [AGENTS.md](AGENTS.md).

## Runtime configuration

After the dependency setup in [AGENTS.md](AGENTS.md#development-and-verification), load this checkout as a local Pi package. Its manifest loads the PStack extension and packaged skills. For isolated evaluation, put the checkout's absolute path in the isolated agent directory's `settings.json` `packages` array; do not register the extension a second time. No separate subagent package or backend configuration is required.

`/setup-pstack` guides model selection and confirmation. `pstack_models` lists exact available Pi models and supported thinking levels, reads the role map, and saves the confirmed complete map to the current Pi agent directory's `pstack-models.json`.

Real targets use `provider/model:thinking`. Cursor slugs remain source defaults, not automatic executable aliases. Explicit `inherit-parent` and `auto` resolve to the current parent's model and thinking. Panels retain their order, repeated entries, and chosen cardinality. Budget adjustment stays within the selected model's supported reasoning levels; it does not substitute another family.

`/poteto-mode on` and `/poteto-mode off` change branch-local mode state. The current Pi session branch owns that state; there is no separate mode cache to restore. `/poteto-mode <task>` expands the packaged skill in interactive and RPC sessions. For print/JSON execution, use `/skill:poteto-mode <task>` directly. Enabled parent sessions receive the full generated mode on each prompt, including after native compaction.

## Questions

`pstack_question` presents one question at a time in Pi's terminal UI. Each question offers single-choice options and an **Other** multiline editor. Go back to revise answers, then submit the final review. Cancellation or an aborted call discards the questionnaire's answers; only explicit submission returns them to the agent.

Question bodies support Pi's Markdown rendering, including tables and fenced text diagrams. Long bodies can be scrolled; diagrams should fit the terminal width. This is a text UI, not a Mermaid renderer or browser form. Outside the terminal UI, including RPC and private child sessions, the tool reports that UI is unavailable so the caller can ask conversationally instead.

## Child execution

`pstack_task` runs the source `generalPurpose`, `poteto-agent`, and `Comment Sicko` assignments. Each child starts with its own conversation, project `AGENTS.md` context, and selected model/thinking. Ambient system-prompt overrides, prompt templates, and skill catalogs are not inherited. Poteto children receive the full source mode; ordinary children do not inherit the parent's Poteto mode or conversation.

Foreground calls return their results and can run in parallel. Background calls return an ID and deliver completion automatically. A child awaiting its own children remains active until their results and its subsequent response settle. Resuming an eligible ID preserves the child's conversation and configuration. `pstack_tasks` lists, inspects, and cancels owned children; transcripts support inspection without retaining every intermediate tool result in the parent context.

The root can delegate to children, and children to grandchildren; grandchildren cannot delegate further. Read-only assignments restrict tools and preserve that restriction through descendants. They are not operating-system sandboxes. Writable children reload the file-backed extensions supplying the parent's active tools, including configured integrations for workflows such as `why`. Read-only children do not load those integration extensions. The supported main host is normal Pi with file-backed extensions, not arbitrary SDK-embedded applications.

Child sessions run in the parent's process. They share the filesystem and use the supplied working directory. Candidate worktrees or directories must be prepared and managed by the PStack workflow, not by the executor. Cancellation does not undo external effects or edits.

Children belong to the live parent branch. Normal exit, reload, or starting branch navigation cancels active owned work and prevents late results from entering another conversation. Navigation cancellation or an extension veto does not disable subsequent delegation, but does not revive the cancelled children. Extension startup and shutdown hooks are awaited; an uncooperative integration hook can delay teardown in this shared process. Continuation is not a cross-session job-recovery mechanism. Transcripts may remain for inspection, but there is no persistent worker service or crash-recovery guarantee.

## Evidence integrations

`why` can use Pi-native tools, configured MCP integrations, or documented CLIs for its evidence categories. Missing integrations are reported as gaps. No MCP server is required merely to use this package. MCP transport, discovery, and authentication belong to the selected host integration; the child adapter does not implement an MCP client, and extension loading alone does not prove MCP compatibility.
