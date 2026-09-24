---
name: setup-pstack
description: Configure which models PStack uses per role and at what reasoning budget in Pi. Use for /setup-pstack, "configure pstack models", "pstack budget", or changing PStack's model choices.
---

# Setup pstack

Use `pstack_models` to maintain Pi's role configuration. The extension injects its effective role table when following PStack skills; it does not require a Cursor rule file.

## Steps

### 1. Detect available models

Call `pstack_models` with `action: "list"` to enumerate the exact available Pi provider/model IDs and supported thinking levels. Use `provider/model:thinking` for a real target. If no models are detected, ask the user to configure an available provider before assigning roles. Never write an unconfirmed model ID. The aliases `inherit-parent` and `auto` explicitly select the current parent model and thinking.

### 2. Load current state

Call `pstack_models` with `action: "get"`. Start from the source defaults in step 5 when no saved configuration exists, marking each default as needing a confirmed Pi model mapping. Otherwise keep the saved budget and role choices. A saved role absent from step 5, such as `how critics`, is retired; report it and omit it from the new table.

### 3. Budget, map, and confirm

**(a) Ask for a budget.** Prefer `pstack_question` over free text when interactive questions are available. Offer these four options with these exact labels, and name the current saved budget.

- `unlimited — keep max`
- `large — xhigh reasoning`
- `medium — high reasoning`
- `small — medium reasoning`

**(b) Apply it.** Build the working table from the source defaults, and on a re-run keep choices changed by family, list, or alias (`inherit-parent`, `auto`). Confirm an available Pi provider/model for each unmapped Cursor default rather than inventing an equivalent. Pi represents effort separately as the target's `:thinking` suffix. `unlimited` preserves the selected effort. `large`, `medium`, and `small` use `xhigh`, `high`, or `medium`; use the selected model's highest supported reasoning level at or below that target, or mark the role as needing a choice. Do not switch model families to meet a budget. Apply this to every real panel entry; aliases do not change. Build and show the effective table using the supported levels from step 1. `pstack_models set` validates and applies the same budget when saving.

**(c) Show the roles and confirm.** Show every role with its model, marking any provider/model and thinking selection not supported by the detected set as needing a choice. Also list each retired role step 2 dropped. Ask whether to accept as-is or change specific roles, offering the detected models plus `inherit-parent` and `auto` (both explicitly select the parent model and thinking) as the options. Prefer `pstack_question` over free text when interactive questions are available. For panel roles (arena runners, architect runners, interrogate reviewers) the value is a list, and one subagent runs per entry, alias entries included, so the list length sets the count. `arena cross-judge pool` is also a list, but Arena selects one value from it whose model family differs from the parent's when possible. `swarm workers` is the default model for every worker unless a race or comparison assigns another model per arm.

### 4. Validate

Every real target must use an available provider/model and supported thinking level from step 1. `inherit-parent` and `auto` are explicit parent-selection aliases, not substitutes for unresolved roles. If a chosen target cannot resolve, stop and ask again.

### 5. Save the configuration

After confirmation, call `pstack_models` with `action: "set"`, the selected `budget`, and the complete `roles` object. Use the exact role labels below, a string for each single role, and an ordered array for each panel or pool. The tool validates and replaces the configuration idempotently. Report validation failures and obtain a valid choice instead of writing around them.

These upstream role labels and model defaults are retained for comparison and mapping, not as a Pi configuration file, executable selectors, or a list of available Pi routes:

```text
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

Check whether the project has a way to drive the real app for proof (a `verify-*` skill, or an existing harness). If not, offer a project-local verification skill only when the actual `create-verification-skill` workflow and its dependencies are available. That workflow is not a supported entry point in this Pi baseline; report the gap rather than claiming a slash command will resolve or substituting a different authoring method. If available and accepted, read and follow its `SKILL.md`; on no, move on without pushing.
