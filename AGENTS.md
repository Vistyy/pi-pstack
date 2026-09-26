# Maintaining Pi-PStack

Port the pinned PStack methodology to Pi; do not replace its procedures, roles, evidence requirements, or presentation rules with a different workflow. Translate host mechanics where Pi differs. Correct contradictory instructions at their source rather than relying on an injected override to make an active skill usable.

## Source ownership

| Path | Responsibility |
| --- | --- |
| `upstream/pstack/` | Unmodified PStack snapshot identified by `upstream.lock.json`. Never edit it to make a local translation. |
| `upstream/cursor-team-kit/` | Unmodified selected snapshot at the same repository commit: original license, plugin manifest, and the `deslop`, `control-cli`, and `control-ui` directories. |
| `upstream-exclusions.txt` | Exact upstream files or directories omitted from the adopted content, before patch replay. |
| `patches/*.patch` | Ordered, focused Pi translations of retained files. Author upstream-derived instruction changes here. |
| `content/pstack/` | Generated PStack minus exclusions, plus patches, then the unchanged companion skills and their separate license. Never hand-edit it. |
| `instructions/pi-host.md` | Shared packaged-skill access, path resolution, and remaining upstream tool aliases. Edit directly; executor mechanics belong in tool descriptions and schemas. |
| `src/`, `extensions/` | Pi runtime, model/question/todo helpers, and the private child-session adapter. |
| `scripts/` | Source verification, generation, comparison, and upstream-update preparation. |
| `README.md` | User-facing setup, supported behavior, and limitations. Keep maintainer instructions in `AGENTS.md`. |

To modify retained upstream-derived files, edit a scratch copy of the current generated tree and capture the difference with normal `git diff --binary` as a new ordered patch. Keep patches focused on a workflow or concern, then run `pnpm source:generate` and inspect the regenerated result. Preserve unrelated generated files and the locked upstream identity. Companion bodies are not patched: adapt their PStack callers instead. Generation rejects a PStack or patch-created path that collides with a companion destination.

For whole-file or directory removals, edit `upstream-exclusions.txt` instead. Use one normalized slash-separated path relative to `upstream/pstack/` per line, without `.` or `..` segments. Blank lines and full-line `#` comments are allowed; a trailing directory slash is optional. Paths are literal, not glob patterns or negation rules. Directories include all descendants, including future upstream additions. Entries must exist and must not overlap. Missing targets fail generation or update preparation for review rather than silently passing. Symlinked ancestor directories are rejected; excluding a symlink itself removes only that link.

Remove obsolete patch hunks when excluding a previously patched path. Exclusions run before patches, and replay rejects patches that restore an excluded path. Use patches for partial-file removals, such as incoming routes to excluded workflows. Keep the methodology of retained playbooks, including MCP examples; adapt host-specific access without inventing capabilities. Do not restore cloud, scheduled, automatic-landing, or macOS simulator/host-cache cleanup as unsupported instructions in the adopted tree. Git worktree cleanup retains its original policy with Pi/Linux access mechanics; its audit does not grant cleanup authority. Preserve local design/review panels and all verification/evidence requirements.

## Runtime boundary

The supported main host is normal Pi as a coding agent with configured file-backed extensions, not arbitrary applications embedding Pi through its SDK. The adapter uses SDK sessions internally for children; that does not expand the supported main-host contract.

PStack owns the workflow and acceptance decisions. The private executor owns child-session execution and lifetime, using Pi's model loop, tool execution, history, and compaction. It is not a workflow language, agent catalog, Git manager, durable-job service, or operating-system sandbox.

Pi-native tools, documented CLIs, and MCP integrations can provide the same evidence categories through different mechanisms. Reloading an extension does not implement or establish compatibility with MCP. Verify the integrations actually configured for the target deployment; an environment with no MCPs does not require an MCP smoke test. Unavailable external methods must be reported, not silently replaced with personal skills or claimed as supported. Opening a PR and requested Babysit remain supported local workflows; neither grants landing authority.

## Development and verification

Requires Node 24+, pnpm 11, Git, and `tar`. SDK and quality-tool versions are pinned in the package manifest and lockfile.

Before installing, verify that this checkout owns its `node_modules` directory rather than following a symlink into another checkout. Install without enabling dependency build scripts:

```sh
pnpm install --frozen-lockfile --ignore-scripts --config.strict-dep-builds=false
pnpm check
```

After changing exclusions or patches, regenerate before checking:

```sh
pnpm source:generate
pnpm source:diff
pnpm check
```

`pnpm source:diff` is a compact review display: whole-file deletions show headers without the removed contents. Do not use its output as a replayable patch.

`pnpm check` verifies both locked snapshots, exclusions, patch replay, and companion composition, runs source CLI and real-SDK Faux-provider tests, and applies the shared `@syzom/typescript-quality` checks. Generated and untouched upstream content is excluded from code linting. Source verification needs no upstream Git objects or network connection and checks executable-file and symlink identity as well as text.

Exercise changed runtime promises through supported Pi entry points. Faux-provider tests establish host mechanics, not reliable LLM adherence to the methodology. For instruction changes, inspect what the parent and fresh children actually receive, including referenced files and tool availability; retain tests only for distinct behavioral protection.

Exercise the worktree audit only against owned temporary Git repositories and synthetic or native-created fixture sessions, with a controlled forge boundary; never use real user histories or run cleanup to test the audit. Protect scoped header-first admission, original bucket precedence, and evidence-gap reporting through its real CLI.

Exercise the plan checker through its CLI; protect its ten live lanes, performance boxes, and operator evidence gates. Verify the retained watcher in a disposable copy of its scripts directory so its Bun dependency bootstrap does not add runtime files to the generated tree.

Keep evaluation separate from normal Pi activation. Use an isolated Pi agent directory, load this package once, and do not combine the replacement with the old Pi-PStack or Workgraph runtime. Developing and verifying a candidate does not authorize changing the user's normal configuration or publishing it.

## Updating the upstream pin

Use the source CLI to compare and prepare an update:

```sh
pnpm upstream:check main
pnpm upstream:prepare <full-commit-sha>
```

These commands fetch the requested source and retain evidence under `.work/`. Both sources advance together at the requested repository commit. The report separates PStack changes from selected toolkit changes; unrelated toolkit files are not adopted or included in the selected diff. Preparation records both snapshots and their identities, `upstream.diff`, `cursor-team-kit.diff`, and the combined generated content in a candidate directory using the current exclusions and patches. The toolkit's `sourceTree` records the full original subtree; `selectedTree` identifies the smaller retained snapshot used by offline verification. Invalid exclusions or patch conflicts fail with retained evidence. Neither command adopts the candidate or changes the active lock, snapshot, or generated content.

Review the upstream methodology changes, exclusion scope, and each translation hunk before adopting a prepared candidate. Replace both active snapshots and the lock only with an explicitly selected candidate, then regenerate and verify. A clean patch replay proves textual applicability, not semantic fidelity. Never silently advance the pin.
