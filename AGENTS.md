# Maintaining Pi-PStack

Port the pinned PStack methodology to Pi; do not replace its procedures, roles, evidence requirements, or presentation rules with a different workflow. Translate host mechanics where Pi differs. Correct contradictory instructions at their source rather than relying on an injected override to make an active skill usable.

## Source ownership

| Path | Responsibility |
| --- | --- |
| `upstream/pstack/` | Unmodified snapshot identified by `upstream.lock.json`. Never edit it to make a local translation. |
| `patches/*.patch` | Ordered, reviewable Pi translations applied to that snapshot. Author upstream-derived instruction changes here. |
| `content/pstack/` | Generated snapshot plus patches. Never hand-edit it. |
| `instructions/pi-host.md` | Shared Pi tool, delegation, and capability mappings. Edit directly. |
| `src/`, `extensions/` | Pi runtime, model/question/todo helpers, and the private child-session adapter. |
| `scripts/` | Source verification, generation, comparison, and upstream-update preparation. |
| `README.md` | User-facing setup, supported behavior, and limitations. Keep maintainer instructions in `AGENTS.md`. |

To change upstream-derived files, make the intended edits in a scratch copy of the current generated tree, capture the difference as a new ordered patch, and run `pnpm source:generate`. Inspect both the patch and regenerated result. Preserve unrelated generated files and the locked upstream identity. Keep the methodology of retained source playbooks, including MCP examples; adapt host-specific access without inventing capabilities. Excluded cloud, scheduled, automatic-landing, and Cursor-cleanup workflows are deletion patches, including their exclusive scripts and incoming routes. Do not restore them as unsupported instructions in the adopted tree. Preserve local design/review panels and all verification/evidence requirements.

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

After changing patches, regenerate before checking:

```sh
pnpm source:generate
pnpm source:diff
pnpm check
```

`pnpm check` verifies the locked snapshot and patch replay, runs source CLI and real-SDK Faux-provider tests, and applies the shared `@syzom/typescript-quality` checks. Generated and untouched upstream content is excluded from code linting. Source verification needs no upstream Git objects or network connection and checks executable-file and symlink identity as well as text.

Exercise changed runtime promises through supported Pi entry points. Faux-provider tests establish host mechanics, not reliable LLM adherence to the methodology. For instruction changes, inspect what the parent and fresh children actually receive, including referenced files and tool availability; retain tests only for distinct behavioral protection.

Exercise the plan checker through its CLI; protect its ten live lanes, performance boxes, and operator evidence gates. Verify the retained watcher in a disposable copy of its scripts directory so its Bun dependency bootstrap does not add runtime files to the generated tree.

Keep evaluation separate from normal Pi activation. Use an isolated Pi agent directory, load this package once, and do not combine the replacement with the old Pi-PStack or Workgraph runtime. Developing and verifying a candidate does not authorize changing the user's normal configuration or publishing it.

## Updating the upstream pin

Use the source CLI to compare and prepare an update:

```sh
pnpm upstream:check main
pnpm upstream:prepare <full-commit-sha>
```

These commands fetch the requested source and retain evidence under `.work/`. Preparation records source identities, the upstream diff, and replayed patches in a candidate directory; a patch conflict fails with retained evidence. Neither command adopts the candidate or changes the active lock, snapshot, or generated content.

Review the upstream methodology changes and each translation hunk before adopting a prepared candidate. Replace the active snapshot and lock only with an explicitly selected candidate, then regenerate and verify. A clean patch replay proves textual applicability, not semantic fidelity. Never silently advance the pin.
