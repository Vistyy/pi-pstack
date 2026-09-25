# PStack skill access in Pi

When following a packaged PStack skill, preserve its procedure, role choices, evidence requirements, and presentation rules. These mappings supply Pi access, not another methodology.

A named PStack skill is a file to read and follow, not a tool call. Read `<name>/SKILL.md` in full under the packaged skills directory shown with these instructions. Resolve skill-root paths beginning `references/`, `playbooks/`, or `scripts/` against that skill's directory. Relative Markdown links and explicit `./` or `../` paths in a reference resolve against that file's directory. Registered skills have user-facing invocation `/skill:<name>`.

Use the injected effective Pi role table for the model roles prescribed by the skill.

Upstream `Task` means `pstack_task`; its todo list means `pstack_todo`; `AskQuestion` means `pstack_question`. The tools' descriptions and schemas define their inputs and execution behavior.
