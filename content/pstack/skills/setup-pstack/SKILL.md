---
name: setup-pstack
description: Configure which models pstack uses per role and at what reasoning budget. Detects your available models and writes an always-applied rule that overrides the skill defaults. Use for /setup-pstack, "configure pstack models", "pstack budget", or changing pstack's model choices.
---

# Setup pstack

Use `pstack_models` to maintain Pi's role configuration. The extension injects its effective role table when following PStack skills; it does not require a Cursor rule file.

## Steps

### 1. Detect available models

Call `pstack_models` with `action: "list"` to enumerate the exact available Pi provider/model IDs and supported thinking levels. Use `provider/model:thinking` for a real target. If no models are detected, ask the user to configure an available provider before assigning roles. Never write an unconfirmed model ID. The aliases `inherit-parent` and `auto` explicitly select the current parent model and thinking.

### 2. Load current state

Call `pstack_models` with `action: "get"`. Start from the source defaults in step 5 when no saved configuration exists, marking each default as needing a confirmed Pi model mapping. Otherwise keep the saved budget and role choices. A saved role absent from step 5, such as `how critics`, is retired; report it and omit it from the new table.

### 3. Budget, map, and confirm

**(a) Ask for a budget.** Prefer AskQuestion over free text. Offer these four options with these exact labels, and name the current budget when the rule records one.

- `unlimited — keep max`
- `large — xhigh reasoning`
- `medium — high reasoning`
- `small — medium reasoning`

**(b) Apply it.** Build the working table from the source defaults, and on a re-run keep choices changed by family, list, or alias (`inherit-parent`, `auto`). Confirm an available Pi provider/model for each unmapped Cursor default rather than inventing an equivalent. Pi represents effort separately as the target's `:thinking` suffix. `unlimited` preserves the selected effort. `large`, `medium`, and `small` use `xhigh`, `high`, or `medium`; use the selected model's highest supported reasoning level at or below that target, or mark the role as needing a choice. Do not switch model families to meet a budget. Apply this to every real panel entry; aliases do not change. Build and show the effective table using the supported levels from step 1. `pstack_models set` validates and applies the same budget when saving.

**(c) Show the roles and confirm.** Show every role with its model, marking any real slug not in the detected set as needing a choice. Also list each line step 2 dropped. Ask whether to accept as-is or change specific roles, offering the detected models plus `inherit-parent` and `auto` (both mean: this role runs on the parent chat model, which is how Auto users stay on Auto) as the options. Prefer AskQuestion over free text. For panel roles (arena runners, architect runners, interrogate reviewers) the value is a list, and one subagent runs per entry, alias entries included, so the list length sets the count. `arena cross-judge pool` is also a list, but Arena selects one value from it whose model family differs from the parent's when possible. `swarm workers` is the default model for every worker unless a race or comparison assigns another model per arm.

### 4. Validate

Every real slug written must be in the detected set. `inherit-parent` and `auto` always pass. If a chosen real slug is not available, stop and ask again.

### 5. Write the rule

After confirmation, call `pstack_models` with `action: "set"`, the selected `budget`, and the complete `roles` object. Use the exact role labels below, a string for each single role, and an ordered array for each panel or pool. The tool validates and replaces the configuration idempotently. Report validation failures and obtain a valid choice instead of writing around them.

This block is the unchanged upstream default table for comparison, not a Pi configuration file or a list of available Pi routes:

```
---
description: pstack per-role model choices (overrides skill defaults)
alwaysApply: true
---
# pstack model configuration. One line per role. Delete a line to fall back to the skill default.
# `inherit-parent` or `auto` as a value: the role runs on the parent chat model (omit Task `model`). Alias entries in a panel list still count toward its fan-out.
# budget: unlimited (max)
feature, refactoring: grok-4.7-xhigh-fast
bug-fix: grok-4.7-xhigh-fast
perf-issue: grok-4.7-xhigh-fast
hillclimb: grok-4.7-xhigh-fast
judgment and prose: claude-opus-5-5-max
hardest tasks: claude-opus-5-5-max
how explorer: grok-4.7-xhigh-fast
how explainer: claude-opus-5-5-max
why investigators: grok-4.7-xhigh-fast
why synthesizer: claude-opus-5-5-max
reflect tooling: gpt-5.6-sol-max
reflect judgment, divergent, synthesizer: claude-opus-5-5-max
arena runners: claude-opus-5-5-max, gpt-5.6-sol-max, grok-4.7-xhigh-fast
arena cross-judge pool: claude-opus-5-5-max, gpt-5.6-sol-max, grok-4.7-xhigh-fast
swarm workers: grok-4.7-xhigh-fast
architect runners: claude-opus-5-5-max, gpt-5.6-sol-max, grok-4.7-xhigh-fast
interrogate reviewers: claude-opus-5-5-max, gpt-5.6-sol-max, grok-4.7-xhigh-fast
```

### 6. Confirm

Report the configuration actually returned by `pstack_models set`, including its budget, model choices, and panel sizes. Pi uses it on subsequent turns and in new sessions. Re-running this skill updates it.

### 7. Offer a verification skill (optional)

Check whether the project has a way to drive the real app for proof (a `verify-*` skill, or an existing harness). If not, offer once: "want a project-local verification skill, so agents can drive the app the way a user does and prove changes work? I can generate one with /create-verification-skill." On yes, invoke `/create-verification-skill` (resolves wherever pstack is installed: workspace, user, or plugin). On no, move on without pushing.
