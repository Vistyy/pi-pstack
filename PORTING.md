# Porting pstack to Pi

This procedure maintains the installable Pi package in this repository.
It exposes upstream changes without silently converting Cursor behavior into incorrect Pi behavior.

## Ownership model

Upstream owns workflow intent, principles, playbooks, agents, orchestration formats, PR watcher policy, automation source intent, and reusable runtime logic.
The Pi port owns packaging, model routing, worker lifecycle, local placement, persistence, approval policy, and Pi-specific mechanism mappings.
Official integration authors own the vendored Herdr, chrome-devtools-axi, and Cursor Team Kit files pinned in `integrations.lock.json`.

`ARCHITECTURE.md` defines the layer model and mechanism mappings.
`capabilities.json` records implementation, verification, and deviations.
The synchronization scripts own detection, classification, and exact vendoring only.
They must not resolve semantic changes automatically.

## Check upstream

Run:

```bash
node scripts/check-upstream.mjs
node scripts/report-port.mjs
node scripts/sync-integrations.mjs
```

`check-upstream.mjs` fetches `cursor/plugins`, compares the pinned commit with `origin/main`, classifies every changed path through `port-map.json`, and writes `.work/upstream-report.json`.
A changed path classified as `unclassified` is a blocking failure.
`report-port.mjs` compares the package with the pinned upstream commit and reports exact copies, adaptations, omissions, official integrations, and Pi-only files.
`sync-integrations.mjs` verifies that vendored official skills and licenses match their pinned SHA-256 digests.
Use `sync-integrations.mjs --write` only when reproducing those files from their locked commits.

## Review a synchronization

1. Read every `semantic-review` and `runtime-review` change in upstream context.
2. State whether the change affects a supported Pi capability.
3. Lift platform-independent behavior unchanged.
4. Adapt only Cursor-owned mechanisms in this package.
5. Record implementation, verification, and deviation status in `capabilities.json`.
6. Record unsupported path classes in `port-map.json` before omitting them.
7. Keep explicit-approval policy in the Pi-owned layer when upstream autonomy policy changes.
8. Run package checks, provenance checks, port inventory, packed-install checks, and profile smoke tests.
9. Exercise every changed runtime boundary without model calls when possible.
10. Obtain explicit budget approval before a new model-backed benchmark.
11. Update `upstream.lock.json` only after the adapted behavior and retained omissions are reviewed.

## Required adaptation boundaries

A skill that delegates work uses the Pi-native `Task` fields `identity`, `role`, and `isolation`, plus Pi `provider/model` selectors.
A model role inherits the parent model unless the user selected an available override.
A Herdr worker owns its tab, persistent session, completion wake, and local worktree placement.
A non-Herdr worker uses a persistent Pi session file and records the fallback limitation when parent-process reconciliation is uncertain.
A session feature uses the active Pi session or `SessionManager` rather than globbing unrelated transcripts.
An external or irreversible operation requires explicit user confirmation.
An upstream host assumption about placement, background work, resume, tool discovery, structured questions, transcripts, or loops must be translated in each active skill or remain explicitly unsupported.

## Deliberate deviations

Remote worker placement maps to local worktree isolation rather than remote execution.
Benny automations are preserved in the repository as dormant sources but excluded from the npm package because Pi has no equivalent trigger, credential, and automation lifecycle.
The upstream `.cursor-plugin/plugin.json` maps to the root Pi `package.json`.
The unsupported Grok Bot webhook skill is omitted rather than exposed as an active Pi skill.
The upstream guide remains source documentation and can contain host-specific entry points, while `README.md` and active skills are authoritative for Pi behavior.
