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
| `content/pstack/` | Generated snapshot plus those patches. Do not edit directly. |
| `instructions/pi-host.md` | Tool-name, native delegation, and capability-boundary translations. |
| `agents/` | Generated native backend profiles. Poteto profiles embed the full source mode; Comment Sicko retains its source prompt. |
| `src/`, `extensions/` | Pi callbacks and model, question, and session-todo tools. |
| `scripts/` | Source verification, generation, comparison, update preparation, and profile generation. |

Native `pi-subagents` owns child execution, result notification, continuation, and local worktree isolation. This package has no competing Task runtime, panel engine, or compaction mechanism. Its profiles disable backend acceptance gates because PStack owns the workflow's verification and review. Read-only profiles restrict their tools and descendant profile choices; they are not operating-system sandboxes.

## Development

Requires Node 24+, pnpm 11, Git, and `tar`. SDK and backend versions are pinned in `package.json` and `pnpm-lock.yaml`.

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm source:generate
pnpm check
```

Shared `@syzom/typescript-quality` configuration governs maintained code. Generated and untouched upstream content is excluded from local code linting. The runtime uses the existing Pi callback API rather than introducing a second application runtime.

The source CLI locates its package from its own file, not the caller's working directory. Verification checks the tracked snapshot's Git tree without requiring upstream commit objects or a network connection. It checks generated content and profiles by rebuilding them, including executable-file and symlink identity.

## Upstream changes

```sh
pnpm source:verify
pnpm source:diff
pnpm upstream:check main
pnpm upstream:prepare <full-commit-sha>
```

`source:diff` shows upstream-to-generated adaptations separately from Pi-owned implementation paths. `upstream:check` fetches the requested ref, reports exact identities, and retains the subtree diff under `.work/`.

`upstream:prepare` creates a new candidate directory under `.work/`. It records the new source/version, the old-to-new source diff, replayed patches, and generated profiles. A conflicting patch produces a failure record and a nonzero exit. Neither command changes the active lock, snapshot, or generated content.

Preparation is not adoption. Review the actual upstream method changes and translation hunks, then explicitly replace the active snapshot and lock with the reviewed candidate and regenerate. A clean patch replay proves textual applicability, not semantic fidelity. Never silently advance the pin.

## Runtime configuration

`/setup-pstack` guides model selection and confirmation. `pstack_models` lists exact available Pi models and supported thinking levels, reads the role map, and saves the confirmed complete map to the current Pi agent directory's `pstack-models.json`.

Real targets use `provider/model:thinking`. Cursor slugs remain source defaults, not automatic executable aliases. Explicit `inherit-parent` and `auto` resolve to the current parent's model and thinking. Panels retain their order, repeated entries, and chosen cardinality. Budget adjustment stays within the selected model's supported reasoning levels; it does not substitute another family.

`/poteto-mode on` and `/poteto-mode off` change branch-local mode state. `/poteto-mode <task>` expands the packaged skill in interactive and RPC sessions. For print/JSON execution, use `/skill:poteto-mode <task>` directly. Enabled parent sessions receive the full generated mode on each prompt, including after native compaction.

A normal Pi configuration switch is separate from developing this package. Validate the package in an isolated Pi agent directory first, including native profile discovery, nested delegation, configured model diversity, and result ordering. Do not combine it with the old Pi-PStack or Workgraph runtime while evaluating the replacement.
