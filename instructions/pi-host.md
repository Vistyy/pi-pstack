# Pi mechanics for the packaged PStack skills

These mappings replace Cursor-specific host mechanics when following a packaged PStack skill. For model selection, use the effective Pi role table rather than the source's Cursor-rule lookup, slug fallback, or omitted-model alias mechanics. The skill's procedure, references, role choices, evidence requirements, and presentation rules remain authoritative for the workflow. This adapter does not select another methodology.

## Skill and tool names

A named PStack skill is a file to read and follow, not a tool call. For a skill named `<name>`, read `<name>/SKILL.md` in full under the packaged skills directory shown with these instructions. Resolve its relative reference paths against that skill's directory. User-facing invocation is `/skill:<name>`; `/poteto-mode` and `/setup-pstack` are convenience commands.

Use Pi `read`, `grep`, `find`, `ls`, `bash`, `edit`, and `write` for the corresponding upstream file and shell operations. `Glob` maps to `find`. The upstream todo list maps to `pstack_todo`: omit `items` to read it; supply the complete `items` list to replace it. `AskQuestion` maps to `pstack_question`. If interactive questions are unavailable, ask the user in the conversation and wait; do not manufacture an answer.

## Model configuration

`pstack_models` owns the Pi model configuration. `list` reports available exact provider/model IDs and supported thinking levels. `get` reports the upstream defaults, saved choices, effective Pi selectors, and missing capabilities. `set` persists the complete role table and selected budget after the setup skill's confirmation procedure.

Use the effective selector for the role prescribed by the skill, including its `:thinking` suffix. Upstream Cursor model slugs are reference defaults, not executable Pi model IDs. An unresolved role requires setup or an explicit user choice; do not substitute a different model, inherit implicitly, or omit panel members. Explicit `inherit-parent` and `auto` choices resolve to the current parent's model and thinking. Panel order, repeated entries, and the distinction between a fan-out panel and a cross-judge pool are preserved.

If the upstream request and agent supply neither a model role nor an explicit model, preserve the upstream agent's default `inherit` behavior by passing the displayed `parentSelector`, including its thinking suffix. This applies to a direct Comment Sicko invocation without Poteto's role defaults. It is not a fallback for an unresolved named role. If `parentSelector` is absent, resolve the reported configuration or model gap rather than guessing.

## Delegation

Upstream `Task` maps to `pstack_task`. Pass the upstream `subagent_type` unchanged: `generalPurpose`, `poteto-agent`, or `Comment Sicko`. The adapter loads the agent's source instructions; the Poteto profile includes the full source mode. Supply the complete filled reference prompt required by the skill, not a shorter replacement brief. Use the effective Pi selector for `model`.

`readonly` restricts the child's tools and its descendants; it is not an operating-system sandbox. Comment Sicko performs scoped comment edits and requires writable tools. For workflows such as `why` that require integrations, preserve the skill's writable agent mode rather than substituting a read-only investigator.

Launch one independent child per prescribed assignment or panel member. Foreground calls return results and can execute in parallel. `run_in_background: true` returns an ID immediately and delivers the result automatically when the child and its nested work finish. While required results are outstanding, end the turn without presenting a final answer to the task; continue when results arrive. Do not poll in a waiting loop. Read the actual results and preserve the skill's dependency barriers, synthesis ownership, and presentation order. Execution completion is not acceptance of the work.

Children share the working directory unless `cwd` selects another existing directory. Where the skill requires isolated candidate paths or worktrees, prepare them with the normal file or Git tools and pass the appropriate directory. The executor does not create, merge, or remove worktrees.

To continue a specific child, pass its returned ID as `resume` with the follow-up `prompt`. Its conversation, profile, model, and working directory are retained. For an independent assignment or consolidated fresh brief, start a new child. Use `pstack_tasks` to list children, inspect an exact child's status and transcript, or cancel it and its descendants. Cancellation does not undo edits.

Children belong to the live parent branch. Starting branch navigation, reloading, or exiting stops active children; cancelling navigation does not revive them. Retained transcripts are inspection evidence, not durable background jobs. The root and its direct children can delegate; grandchildren cannot launch another level.

## Current support boundary

The current baseline covers local setup, Poteto-mode routing, understanding, alternative design, and critique. Cloud agents, Benny, automation, scheduled or overnight execution, and automated delivery are not implemented. A local process or worktree is not a cloud-agent substitute. If a selected route needs an unavailable capability, name the gap and stop at that boundary rather than claiming that route was completed.

Dependencies from outside PStack, including Cursor's `create-skill` and cursor-team-kit’s `deslop`, `control-cli`, and `control-ui`, still require their actual method and capabilities. Do not replace them with a similarly named personal skill or silently skip them. Report an unavailable dependency at the step that needs it.

For `why`, discover the evidence-query tools actually loaded in the session. An unavailable integration is a gap in that evidence category, not permission to narrow the skill to source control or infer historical intent from code. Do not claim that a query was performed when its tool was unavailable.
