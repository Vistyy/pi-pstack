# Pi pstack layers

The port keeps upstream pstack intent separate from Pi execution mechanisms and separately sourced integrations.
This separation makes upstream drift, Pi-owned behavior, and third-party updates independently reviewable.

## Layer model

```text
Pinned upstream pstack
        |
        | semantic adaptation only where Cursor owns the mechanism
        v
Pi pstack package
        |
        | invokes separately pinned official skills and local runtime providers
        v
Herdr, chrome-devtools-axi, Pi sessions, worktrees, and background workers
```

### Upstream layer

`upstream.lock.json` identifies the exact pstack commit from which the current port is derived.
The `vendor/pstack` branch is an immutable Git snapshot of that commit's pstack subtree, with the upstream commit and tree IDs recorded in commit trailers.
The checkout under `.work/upstream/` is disposable and must remain byte-identical to that commit.
`port-map.json` classifies upstream paths without changing them.
`check-upstream.mjs` reports changes between the pinned commit and upstream `main`.

Upstream owns workflow intent, playbook sequencing, principles, agent prompts, orchestration formats, PR watcher policy, and reusable scripts.
The port must not redesign those artifacts merely because Cursor and Pi expose different execution APIs.

### Pi adaptation layer

The repository root is the distributable Pi package.
It owns the Pi extension, package metadata, model routing, session lifecycle, local worker execution, worktree placement, completion delivery, approval boundaries, and text that maps Cursor mechanisms to Pi mechanisms.

An adapted upstream file keeps its upstream path relative to `skills/` or `agents/` whenever possible.
A Pi-only file has no upstream counterpart and must name its owner in `capabilities.json` or `integrations.lock.json`.

### Official integration layer

`integrations.lock.json` pins official Herdr, chrome-devtools-axi, and Cursor Team Kit resources by repository, commit, source path, destination, license, and SHA-256 digest.
`sync-integrations.mjs` is the only owner of those vendored files.
Run it without arguments to verify the local copies or with `--write` to reproduce them from their pinned sources.

Vendored integration skills remain byte-identical to their authors' versions.
Pstack-specific instructions belong in a separate adapter skill rather than edits to the official skill.

## Porting rule

Apply the following order to every upstream change:

1. Lift platform-independent behavior unchanged.
2. Replace a Cursor mechanism with the closest Pi or local mechanism at one explicit boundary.
3. Add custom code only when no existing mechanism satisfies that boundary.
4. Record every unsupported or behaviorally different outcome.
5. Verify the changed boundary rather than treating textual similarity as parity.

The intended mechanism mappings are:

| Cursor mechanism | Pi or local mechanism |
| --- | --- |
| `Task` | Herdr-owned persistent Pi worker, or persistent Pi subprocess session when Herdr is unavailable |
| Fixed configured model panel | One `pstack_panel` call that owns cardinality, concurrent dispatch, model assignment, and dropout accounting |
| `isolation: "worktree"` | Worker in an isolated local worktree |
| `/loop` | Completion wake plus a bounded heartbeat |
| Cursor session resume | Persistent Pi session plus repository and process reconciliation |
| `AskQuestion` | Pi UI or a persisted human gate |
| `control-cli` | Herdr-backed terminal control adapter |
| `control-ui` | chrome-devtools-axi-backed browser control adapter |

A compatible settled Poteto worker resumes in the same checkout when its model, thinking level, tools, extensions, and skills still match.
A worktree-isolated Task starts a distinct session because its checkout is a separate ownership boundary.
A worker starts with resource discovery disabled and then receives an explicit allowlist.
The allowlist contains inherited skills, the package's non-delegating core extension, safe external extensions, and `pstack_todo`.
It excludes `Task`, other delegation tools, recursive delegation extensions, and delegation skills so one parent owns the worker graph.

Model routing is a separate boundary from workflow prose.
Each role resolves to one target or an ordered panel of targets, where a target contains a Pi `provider/model` selector and optional thinking level.
Panel entries rotate per role rather than against one global task sequence, and alias entries still count toward panel length.

## Upgrade procedure

1. Run `pnpm upstream:check` and review every changed path.
2. Run `pnpm upstream:import <commit>` to create the exact next snapshot on `vendor/pstack`.
3. Merge that vendor commit and use `pnpm port:diff` to inspect exact copies, adaptations, omissions, and Pi-only files.
4. Update platform-independent upstream files before changing adapters.
5. Adapt only the changed mechanism boundaries.
6. Update `capabilities.json` with implementation, verification, and deviation status.
7. Run `pnpm port:verify` for package, provenance, packed-install, and no-model integration checks.
8. Obtain approval before model-backed comparisons.
9. Update `upstream.lock.json` only after the target commit's supported behavior has been adapted and reviewed.

## Recovery boundary

A Herdr worker persists its Pi session, original assignment, worktree path, branch, lifecycle status, and completion record in the parent session.
The non-Herdr fallback persists the Pi session file, original assignment, worktree path, branch, lifecycle status, and last observed result, but it cannot reattach to a subprocess whose completion raced a parent crash.
After a crash, reopen the session and inspect actual repository and process state before continuing.
Do not repeat an operation whose result is uncertain until its resulting state has been checked.
