---
name: reflect
description: Spawn three parallel review subagents over the active transcript, surface learnings, and route each to a concrete edit on an existing skill. Use when the user says reflect.
disable-model-invocation: true
---

# Reflect

Mine the current conversation for durable learnings, then route them into skill edits.

## When to invoke

Invoke when the user says "reflect" or "/reflect". Skip when the conversation is trivial, off-topic, or already covered by an existing skill the parent followed correctly. One-offs are not learnings.

## Process

### 1. Locate the active transcript

Read `PI_SESSION_FILE` with `bash` for the exact current transcript path. For an owned child's run, use its `pstack_task` receipt or `pstack_tasks` inspection. Do not search other sessions or projects. Transcripts contain typed JSONL entries; inspect the message entries. If no transcript path is available, write a tight digest of the session and label it as a digest, not transcript evidence.

### 2. Spawn three reviewers in parallel

One message, three `pstack_task` calls, `subagent_type: "generalPurpose"`, with the role's effective `model` selector and `readonly: false`. Use configured integrations for context lookups. Children inherit them subject to exclusions; read-only mode additionally excludes write/edit. Do not write files or modify external state during review.

Resolve each role below through the injected role table or `pstack_models` action `get`. The table's upstream defaults are reference values, not executable selectors. Pass the effective selector including thinking; aliases are already resolved. Missing or rejected selectors require setup or an explicit valid choice, not fallback, omitted models, or dropped reviewers.

| Lens | Role line | Default `model` | Prompt template |
|---|---|---|---|
| Judgment | `reflect judgment, divergent, synthesizer` | `claude-opus-5-5-max` | `references/judgment-reviewer.md` |
| Tooling | `reflect tooling` | `gpt-5.6-sol-max` | `references/tooling-reviewer.md` |
| Divergent | `reflect judgment, divergent, synthesizer` | `claude-opus-5-5-max` | `references/divergent-reviewer.md` |

Pass each template verbatim, substituting the transcript path or digest where marked. Reviewers return findings in the `pstack_task` result.

### 3. Synthesize

One `pstack_task` call, `subagent_type: "generalPurpose"`, with the effective `reflect judgment, divergent, synthesizer` selector and `readonly: false`. The synthesizer's quality check includes spot-verifying citations through available integrations. Report inaccessible sources as gaps, not checked citations. Use `references/synthesizer.md` verbatim, with each reviewer's full output inlined where marked. The synthesizer returns a structured Accepted / Rejected / Backlog list.

### 4. Structural enforcement check

Sanity-check the synthesizer's Accepted list. For any item that would be enforced more reliably by a lint rule, script, metadata flag, or runtime check, move it from Accepted to Backlog. See the **encode-lessons-in-structure** principle skill.

### 5. Apply

Before applying any Accepted edit, present the synthesizer's full Accepted/Rejected/Backlog output to the user and wait for explicit approval. The user picks which subset to apply and may redirect routings. Skill changes affect every future agent in the org. Do not auto-apply.

Backlog items file to whatever devex / backlog tracker your team uses automatically. Only the Accepted list waits for approval.

For each approved Accepted item, follow the Routing field exactly:

- Trivial existing-skill edit (a one-line bullet, a tightened sentence, a stale fact corrected): parent does directly.
- Substantive existing-skill edit (a new section, a new pattern table, more than ~10 lines): follow the [Authoring or modifying a skill playbook](../poteto-mode/playbooks/authoring-a-skill.md).
- `tune description: <skill path>` (the skill exists but didn't trigger when it should have): use the same playbook to correct its discovery metadata and verify the intended visibility in Pi. Distinguish a missing registration or manual-only setting from unclear wording.
- `new skill: <kebab-name>`: follow the same playbook to create and verify it. Do not invent the shape ad hoc.

If your environment ships a SKILL.md validator, run it on every touched skill before declaring done. Skip this step if it doesn't.

### 6. Summarize for the user

Short list, no preamble:

- Edits applied: `<skill path>`. What changed, one line each.
- New skills created: `<skill path>`. One line each (rare).
- Backlog filed to the devex tracker: `<issue title>` (`<tags>`). One line each.
- Dropped: one line per rejected finding + reason from the synthesizer.
