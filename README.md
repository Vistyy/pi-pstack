# PStack for Pi

A local Pi baseline built from the actual PStack source, not a rewritten approximation of its workflows.

The pinned source is PStack **0.15.5**, commit `12d587dfb20741cafc376c42c696c5f6e2a64487`. The same pin supplies three unchanged Cursor Team Kit **1.2.0** methods: `deslop`, `control-cli`, and `control-ui`. `upstream.lock.json` records PStack's subtree identity, the toolkit's original subtree identity, and the selected toolkit snapshot identity. The separate Cursor MIT notice ships in `content/pstack/licenses/cursor-team-kit.LICENSE`.

## Scope

The current implementation targets local quality work: setup, role/model configuration, Poteto-mode routing, understanding, alternative design, implementation discipline, critique, verification, PR opening, and requested review/CI follow-up. It registers `setup-pstack`, `poteto-mode`, `how`, `why`, `architect`, `arena`, `interrogate`, `unslop`, `no-comments`, `technical-writing`, `deslop`, `control-cli`, `control-ui`, and the principle leaves. Mode workflows also read their packaged dependencies, including `swarm`, `figure-it-out`, `show-me-your-work`, and `tdd`; a file's presence does not register another slash command.

Orchestrate, both Autopilots, scheduled Autonomous run, automated Shipping, Cursor cleanup, and the cloud automation pack are removed from the adopted content through explicit path exclusions and patches to retained files. The untouched upstream snapshot retains them for provenance. Local parallel review remains, including the multi-phase plan's ten live lanes, performance checks, independent audit lanes, and operator review gates. Each lane needs adequate local isolation; missing capabilities are gaps, not passes. External evidence integrations must actually be available for their `why` categories. The three toolkit methods are bundled, not replaced with personal skills. Skill authoring uses an explicit Pi-native playbook grounded in the running Pi version's documentation and Anthropic's writing guidance, instead of Cursor's built-in `create-skill`. An unavailable evidence capability is reported at the step that needs it; it does not waive the procedure.

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

`pstack_question` presents one question at a time in Pi's terminal UI. Each question offers single-choice options and an **Other** multiline editor. Outside the Other editor, use ←/→ to browse freely, including unanswered questions; Enter saves an answer and advances. Page Up/Down scrolls text rather than changing questions. The final review marks unanswered questions and requires every answer before submission. Cancellation or an aborted call discards the questionnaire's answers; only explicit submission returns them to the agent.

Question bodies support Pi's Markdown rendering, including tables and fenced text diagrams. Long bodies can be scrolled; diagrams should fit the terminal width. This is a text UI, not a Mermaid renderer or browser form. Outside the terminal UI, including RPC and private child sessions, the tool reports that UI is unavailable so the caller can ask conversationally instead.

## Child execution

`pstack_task` runs the source `generalPurpose`, `poteto-agent`, and `Comment Sicko` assignments. Each child starts with its own conversation, project `AGENTS.md` context, and selected model/thinking. Ambient system-prompt overrides, prompt templates, and skill catalogs are not inherited. Poteto children receive the full source mode; ordinary children do not inherit the parent's Poteto mode or conversation.

Foreground calls return their results and can run in parallel. Background calls return an ID and deliver completion automatically. A child awaiting its own children remains active until their results and its subsequent response settle. Resuming an eligible ID preserves the child's conversation and configuration. `pstack_tasks` lists, inspects, and cancels owned children; transcripts support inspection without retaining every intermediate tool result in the parent context.

The root can delegate to children, and children to grandchildren; grandchildren cannot delegate further. Read-only assignments restrict tools and preserve that restriction through descendants. They are not operating-system sandboxes. Writable children reload the file-backed extensions supplying the parent's active tools, including configured integrations for workflows such as `why`. Read-only children do not load those integration extensions. The supported main host is normal Pi with file-backed extensions, not arbitrary SDK-embedded applications.

Child sessions run in the parent's process. They share the filesystem and use the supplied working directory. Candidate worktrees or directories must be prepared and managed by the PStack workflow, not by the executor. Cancellation does not undo external effects or edits.

Children belong to the live parent branch. Normal exit, reload, or starting branch navigation cancels active owned work and prevents late results from entering another conversation. Navigation cancellation or an extension veto does not disable subsequent delegation, but does not revive the cancelled children. Extension startup and shutdown hooks are awaited; an uncooperative integration hook can delay teardown in this shared process. Continuation is not a cross-session job-recovery mechanism. Transcripts may remain for inspection, but there is no persistent worker service or crash-recovery guarantee.

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
