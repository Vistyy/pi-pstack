# Three-condition pstack benchmark

> Historical result only.
> This run predates the repaired worker identity, explicit skill-loading contract, thinking-aware model routing, four-member panel defaults, and fallback resource boundary.
> It does not establish current workflow conformance or effectiveness.

This benchmark determines whether the candidate pstack port improves completed coding outcomes enough to justify its additional model work and maintenance.
Terminal-Bench verification is the primary outcome authority.
Wall time, model sessions, tokens, and intervention are secondary costs.

## Controlled conditions

Every condition uses `openai-codex/gpt-5.6-luna`, medium thinking, the same Terminal-Bench task, Pi `0.84.4`, one attempt, and one concurrent Harbor trial.
Repository-owned task instructions remain available in every condition.

The conditions are:

1. `plain` uses minimal Pi settings.
2. `pstack` adds the candidate package and invokes the task through `/poteto-mode`.
3. `current` uses a disposable snapshot of the current Pi instructions, skills, extensions, themes, and packages.

The selected pilot task is `fix-code-vulnerability` from Terminal-Bench 2.1 at digest `sha256:d31348aa16b533a15f013420e4d9726dc529e6086adc7d6d48067d22cc18fe71`.
It requires repository analysis, a security classification, a code fix, an exact report artifact, and verifier tests, so it can exercise pstack's design and verification workflow.

The pstack pilot must set `PSTACK_DEFAULT_MODE=1`, `PSTACK_CHILD_BUDGET=4`, and `PSTACK_MAX_DEPTH=1`.
This activates Poteto Mode without changing the benchmark task text, permits at most four direct child model sessions, and prevents nested fan-out.

## Approval boundary

The install-only Harbor check makes no model calls and may run without model-budget approval.
A scored pilot requires separate approval.

The scored pilot has this maximum model-session budget:

- Plain Pi starts one primary Luna session.
- Current configuration starts one primary Luna session.
- Pstack starts one primary Luna session and at most four child Luna sessions.
- The complete pilot therefore starts at most seven Luna sessions.

A process timeout is not a token limit.
The pilot must report actual session count, token usage, wall time, and grader result from Harbor and Pi logs.

## Build credentialed profiles

Run this only after approving a scored model run:

```bash
node pstack/scripts/build-profiles.mjs --with-auth
```

The generated profiles are ignored by Git.
Mount one generated profile at `/root/.pi/agent` inside each Harbor trial.
Mount it read-only when Pi and the adapter support that boundary.
Otherwise use the disposable generated copy and never mount the live agent directory.

## Harbor adapter

Use `spersico/pi-harbor-adapter` pinned at commit `55826f51ad17d8087c1606d0eaf85aa258b68bf2` with Harbor `0.17.1`.
Pin the container Pi version with `--ak version=0.84.4`.
Capture `pi.jsonl` for session and token accounting.

Use `--include-task-name terminal-bench/fix-code-vulnerability` for all three conditions rather than relying on dataset ordering.

## Decision rule

Treat a Terminal-Bench verifier pass as success and a failure as failure.
Do not replace the verifier result with a prose quality judgment.

Stop after the pilot when any of these conditions holds:

- The pstack profile cannot run the task reliably.
- Pstack fails while either control passes.
- Pstack uses more than three times the model tokens of the better passing control without changing a failure into a pass.
- The result cannot be attributed because the task, model, thinking level, Pi version, or verifier differed between conditions.

If pstack changes a control failure into a pass within the budget, run a five-task follow-up under the same controls.
If the pilot is inconclusive, inspect the captured trajectories before deciding whether another paid run can resolve the uncertainty.

## Pilot result

The scored pilot ran on 2026-09-02 against the pinned task digest, model, thinking level, Pi version, and one-attempt concurrency controls above.
No human intervention occurred during any trial.

| Condition | Verifier reward | Luna sessions | Input | Output | Cache read | Total tokens | Wall time |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Plain | 1.0 | 1 | 22,909 | 935 | 74,240 | 98,084 | 104.473 s |
| Current | 1.0 | 1 | 36,601 | 1,694 | 88,064 | 126,359 | 93.511 s |
| Pstack | 1.0 | 2 | 76,429 | 6,037 | 491,008 | 573,474 | 218.452 s |

Pstack used one primary session and one fallback Task child, so the complete pilot used four of the approved seven-session maximum.
The plain trial's agent command returned `NonZeroAgentExitCodeError` after emitting a successful final response, but Terminal-Bench independently awarded reward `1.0` and its verifier passed the produced repository.
The other two trials had no agent exception.

All three conditions passed, so pstack did not convert a control failure into a pass.
Pstack used 5.85 times the total tokens of the lower-token passing control and 3.46 times its non-cached input plus output tokens.
This triggers the stop rule, so no five-task follow-up is justified by this pilot.
The pilot does not show enough coding-outcome improvement to justify pstack's model overhead on this task.

## Hard-task challenge set

The easy pilot does not determine whether pstack can convert failures into passes on harder, long-horizon repository work.
The separately approved task-selection exercise froze six SWE-bench Pro instances in [`HARD-BENCHMARK.md`](HARD-BENCHMARK.md).
The later authorized exploratory run produced identical 4/6 pass vectors, while pstack used 3.95 times the total model tokens and 1.30 times the end-to-end trial time.
The task images exposed historical target commits, so the result does not measure unaided implementation ability.
`HARD-BENCHMARK.md` records the complete result, accounting method, and interpretation boundary.
