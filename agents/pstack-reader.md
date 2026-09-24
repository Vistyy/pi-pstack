---
name: pstack-reader
description: General-purpose PStack assignment with read-only tools.
model: inherit
systemPromptMode: append
inheritProjectContext: true
inheritGlobalContext: false
inheritSkills: false
defaultContext: fresh
allowNestedSubagents: true
subagentOnlyExtensions: ../extensions/index.ts
acceptance: {"level":"none","reason":"PStack owns workflow verification and review"}
tools: read, grep, find, ls, pstack_todo
allowedAgents: pstack-reader, pstack-poteto-reader
---
