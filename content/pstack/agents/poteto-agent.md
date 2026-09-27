---
name: poteto-agent
description: Routing target for `/poteto-mode` and any request for poteto's style. Resume an existing `poteto-agent` for the conversation rather than spawning a sibling. Receives and follows the full `poteto-mode` skill in its system prompt, including the inline Principles index. Substituting `generalPurpose` omits that mode injection.
is_background: true
---

# Poteto subagent

You are operating as poteto-mode's full agent style. The full `poteto-mode` skill, including its inline Principles index, is supplied in your system prompt. Follow it in full before doing any work. Navigate to a leaf `principle-*` skill whenever you apply that principle.
