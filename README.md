# PStack for Pi

A local Pi baseline built from the actual PStack source, not a rewritten approximation of its workflows.

The pinned source is PStack **0.15.5**, commit `12d587dfb20741cafc376c42c696c5f6e2a64487`. `upstream.lock.json` records the repository and exact subtree identity.

## Scope

The current implementation targets setup, role/model configuration, Poteto-mode routing, understanding, alternative design, and critique. It registers `setup-pstack`, `poteto-mode`, `how`, `why`, `architect`, `arena`, `interrogate`, `unslop`, `no-comments`, `technical-writing`, and the principle leaves. The rest of the source remains available for inspection, not a claim that every route works in Pi.

Cloud agents, Benny, scheduled or overnight automation, and automated delivery are outside this baseline. External evidence integrations must actually be available for their `why` categories. Cursor and cursor-team-kit dependencies are not replaced with personal skills. An unavailable dependency is reported at the step that needs it; it does not waive the upstream procedure.

No personalization or migration of old Pi-PStack settings is included.

## Maintained parts

| Path | Responsibility |
| --- | --- |
| `upstream/pstack/` | Unmodified snapshot of the locked upstream subtree. |
| `patches/*.patch` | Ordered, visible Pi translations. Currently the mode name, its reminder moved from unsupported metadata into the body, and setup storage/model mechanics. |
| `content/pstack/` | Generated snapshot plus those patches, including the source agent instructions. Do not edit directly. |
| `instructions/pi-host.md` | Tool-name, delegation, and capability-boundary translations. |
| `src/`, `extensions/` | Pi callbacks, model/question/session-todo tools, and the private child-session adapter. |
| `scripts/` | Source verification, generation, comparison, and update preparation. |

PStack owns the workflow, verification, and review. The private executor supplies Pi sessions and their lifecycle; it does not add a workflow language, agent catalog, acceptance system, or Git manager. It uses Pi's SDK model loop, tool execution, history, and compaction rather than implementing those facilities again.

## Development

Requires Node 24+, pnpm 11, Git, and `tar`. SDK versions are pinned in `package.json` and `pnpm-lock.yaml`.

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm source:generate
pnpm check
```

Runtime verification uses real Pi sessions and Pi's scripted Faux provider without network model calls. Source CLI tests exercise replay, drift detection, and update preparation. These checks establish host mechanics, not whether an LLM consistently follows the upstream methodology.

Shared `@syzom/typescript-quality` configuration governs maintained code. Generated and untouched upstream content is excluded from local code linting.

The source CLI locates its package from its own file, not the caller's working directory. Verification checks the tracked snapshot's Git tree without requiring upstream commit objects or a network connection. It checks generated content by rebuilding it, including executable-file and symlink identity.

## Upstream changes

```sh
pnpm source:verify
pnpm source:diff
pnpm upstream:check main
pnpm upstream:prepare <full-commit-sha>
```

`source:diff` shows upstream-to-generated adaptations separately from Pi-owned implementation paths. `upstream:check` fetches the requested ref, reports exact identities, and retains the subtree diff under `.work/`.

`upstream:prepare` creates a new candidate directory under `.work/`. It records the new source/version, the old-to-new source diff, and replayed patches. A conflicting patch produces a failure record and a nonzero exit. Neither command changes the active lock, snapshot, or generated content.

Preparation is not adoption. Review the actual upstream method changes and translation hunks, then explicitly replace the active snapshot and lock with the reviewed candidate and regenerate. A clean patch replay proves textual applicability, not semantic fidelity. Never silently advance the pin.

## Runtime configuration

After installing dependencies, load this checkout as a local Pi package. Its manifest loads the PStack extension and packaged skills. For isolated evaluation, put the checkout's absolute path in the isolated agent directory's `settings.json` `packages` array; do not register the extension a second time. No separate subagent package or backend configuration is required.

`/setup-pstack` guides model selection and confirmation. `pstack_models` lists exact available Pi models and supported thinking levels, reads the role map, and saves the confirmed complete map to the current Pi agent directory's `pstack-models.json`.

Real targets use `provider/model:thinking`. Cursor slugs remain source defaults, not automatic executable aliases. Explicit `inherit-parent` and `auto` resolve to the current parent's model and thinking. Panels retain their order, repeated entries, and chosen cardinality. Budget adjustment stays within the selected model's supported reasoning levels; it does not substitute another family.

`/poteto-mode on` and `/poteto-mode off` change branch-local mode state. The current Pi session branch owns that state; there is no separate mode cache to restore. `/poteto-mode <task>` expands the packaged skill in interactive and RPC sessions. For print/JSON execution, use `/skill:poteto-mode <task>` directly. Enabled parent sessions receive the full generated mode on each prompt, including after native compaction.

## Child execution

`pstack_task` runs the source `generalPurpose`, `poteto-agent`, and `Comment Sicko` assignments. Each child starts with its own conversation, project context, and selected model/thinking. Poteto children receive the full source mode; ordinary children do not inherit the parent's Poteto mode or conversation.

Foreground calls return their results and can run in parallel. Background calls return an ID and deliver completion automatically. A child awaiting its own children remains active until their results and its subsequent response settle. Resuming an eligible ID preserves the child's conversation and configuration. `pstack_tasks` lists, inspects, and cancels owned children; transcripts support inspection without retaining every intermediate tool result in the parent context.

The root can delegate to children, and children to grandchildren; grandchildren cannot delegate further. Read-only assignments restrict tools and preserve that restriction through descendants. They are not operating-system sandboxes. Writable children need their actual configured integrations for workflows such as `why`; runtime-only tools are not assumed to be transferable to a new session.

Child sessions run in the parent's process. They share the filesystem and use the supplied working directory. Candidate worktrees or directories must be prepared and managed by the PStack workflow, not by the executor. Cancellation does not undo external effects or edits.

Children belong to the live parent branch. Normal exit, reload, or leaving the branch cancels active owned work and prevents late results from entering another conversation. Continuation is not a cross-session job-recovery mechanism. Transcripts may remain for inspection, but there is no persistent worker service or crash-recovery guarantee.

A normal Pi configuration switch is separate from developing this package. Validate it in an isolated Pi agent directory first, including child instructions, configured integrations and model selection, nested completion ordering, and cancellation. Do not combine it with the old Pi-PStack or Workgraph runtime while evaluating the replacement.
