---
name: pstack-general-purpose
description: General-purpose PStack assignment.
model: inherit
systemPromptMode: append
inheritProjectContext: true
inheritGlobalContext: false
inheritSkills: false
defaultContext: fresh
allowNestedSubagents: true
subagentOnlyExtensions: ../extensions/index.ts
acceptance: {"level":"none","reason":"PStack owns workflow verification and review"}
---
