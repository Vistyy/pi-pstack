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

Upstream `Task` maps to the installed pi-subagents `subagent` tool; there is no separate PStack child runtime. If necessary, call `subagents_enable` and then inspect `subagent` with `action: "list", capabilities: true` to confirm the named profile is executable.

Translate a Task request as follows:

- `prompt` becomes `task`; use the complete filled reference prompt required by the skill, rather than a shorter replacement brief.
- `subagent_type: generalPurpose` becomes `agent: pstack-general-purpose`; with `readonly: true`, use `pstack-reader`.
- `subagent_type: poteto-agent` becomes `agent: pstack-poteto-agent`; with `readonly: true`, use `pstack-poteto-reader`.
- `subagent_type: "Comment Sicko"` becomes `agent: pstack-comment-sicko`. Its upstream comment-review procedure includes scoped edits; it is not a read-only profile.
- `model` is the effective Pi role selector described above.
- `run_in_background` becomes `async`. Use `context: "fresh"` for a new assignment. Use `worktree: true` only where the upstream request requires local worktree isolation; otherwise children share the supplied working directory.
- Set `mission: false`; the backend's mission ledger is not the PStack workflow. The packaged profiles disable backend acceptance gates; this does not remove PStack's own verification and review.

Use a native workflow call for parallel or multi-step delegation, with one independent child per prescribed assignment or panel member. Preserve the skill's model choices, complete reference prompts, dependency barriers, and synthesis ownership. Native grouping changes the transport, not the method. Do not replace the workflow with the backend's built-in scout/worker/reviewer/oracle methodology. Native completion notifications deliver background results. While required results are outstanding, end the turn without presenting a final answer to the task; continue the workflow when the results arrive. Do not poll in a waiting loop. Read the actual results and perform the skill's synthesis/presentation step in the required order.

To continue a specific existing child when the skill calls for it, use the backend's `resume` action with that child's returned run ID and the follow-up message. For an independent assignment or a consolidated fresh brief, launch a new child. Use the backend's status and stop controls for that exact run; do not build another registry or launch a replacement just because an outcome is uncertain.

## Current support boundary

The current baseline covers local setup, Poteto-mode routing, understanding, alternative design, and critique. Cloud agents, Benny, automation, scheduled or overnight execution, and automated delivery are not implemented. A local process or worktree is not a cloud-agent substitute. If a selected route needs an unavailable capability, name the gap and stop at that boundary rather than claiming that route was completed.

Dependencies from outside PStack, including Cursor's `create-skill` and cursor-team-kit’s `deslop`, `control-cli`, and `control-ui`, still require their actual method and capabilities. Do not replace them with a similarly named personal skill or silently skip them. Report an unavailable dependency at the step that needs it.

For `why`, discover the evidence-query tools actually loaded in the session. An unavailable integration is a gap in that evidence category, not permission to narrow the skill to source control or infer historical intent from code. Do not claim that a query was performed when its tool was unavailable.
