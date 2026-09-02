---
name: control-ui
description: Drive and inspect a real browser, web UI, or Chromium-based application through chrome-devtools-axi. Use for UI verification, screenshots, accessibility snapshots, console or network evidence, performance traces, or reproducing UI bugs.
---

# Control UI through chrome-devtools-axi

Use the official `chrome-devtools-axi` skill as the browser control mechanism.
Read that skill and query the installed CLI help because its command surface is authoritative.
Reuse a repository-native browser harness when it already provides stronger deterministic coverage.

## Interaction loop

1. Launch the application through its documented local command or existing test harness.
2. Open or attach to the correct browser surface through `chrome-devtools-axi`.
3. Capture a fresh accessibility snapshot before acting.
4. Select the target through the current generation's stable reference.
5. Perform one structural action such as click, fill, keypress, navigation, scroll, or resize.
6. Capture a new snapshot, evaluation result, or screenshot.
7. Verify the expected state transition from current evidence.
8. Preserve requested artifacts and clean up processes and temporary profiles created by the run.

Use screenshots for visual claims, accessibility snapshots for structure and interaction, console and network records for runtime failures, and performance tooling for measured regressions.
Do not substitute a unit test or compilation result for a claim about the live UI.

## Guardrails

Use simple fetch tooling instead when no browser behavior is involved.
Do not act through stale element references after navigation or structural changes.
Keep test data local and disposable.
Do not preserve privacy-sensitive screenshots, traces, or heap snapshots unless the user authorized that artifact.
