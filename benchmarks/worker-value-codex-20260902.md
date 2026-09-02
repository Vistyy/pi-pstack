# Codex worker value benchmark

## Decision question

This follow-up benchmark compared GPT-5.6 Luna and GPT-5.6 Terra against the inexpensive workers measured in `worker-value-20260902.md`.
It also retried Qwen3.8 Flash while retaining raw provider errors.
The economic comparison treats the recorded Codex cost divided by 12 as an estimated subscription-adjusted cost, as requested by the user.
That divisor is an assumption rather than a provider-confirmed accounting rule.

## Method

Luna, Terra, and Qwen each received the same architecture, diagnosis, and implementation workloads three times.
This produced 27 candidate sessions and three blinded GPT-5.6 Sol judging sessions.
The qualification threshold and deterministic implementation checks were unchanged from the first run.
The run is stored locally under `.work/lantern-field-20260902T232151/`.

## Follow-up evidence

| Model | Mean score | Qualifying runs | Implementation passes | Raw cost per qualifying run | Estimated cost after dividing by 12 |
|---|---:|---:|---:|---:|---:|
| GPT-5.6 Luna | 19.00 | 9/9 | 3/3 | $0.004987 | $0.000416 |
| GPT-5.6 Terra | 18.67 | 9/9 | 3/3 | $0.036217 | $0.003018 |
| Qwen3.8 Flash | Inconclusive | 0/9 | 0/3 | $0 | Not applicable |

Luna scored 19, 19, and 20 on architecture; 17, 18, and 20 on diagnosis; and 19, 20, and 19 on implementation.
Terra scored 18, 19, and 19 on architecture; 20, 20, and 20 on diagnosis; and 19, 18, and 15 on implementation.
Every Luna and Terra implementation passed all deterministic checks.

Qwen failed before inference on all nine attempts.
The retained model error is an HTTP 404 response from the OpenCode endpoint, so the result establishes a routing or provider-catalog failure rather than a model-quality failure.

## Combined economic comparison

| Model | Mean score | Qualifying rate | Cost per qualifying run used for comparison |
|---|---:|---:|---:|
| GPT-5.6 Luna, recorded cost divided by 12 | 19.00 | 100% | $0.000416 |
| GLM-5.3-Flash | 17.78 | 89% | $0.001143 |
| Muse Spark 1.3 | 18.22 | 100% | $0.001647 |
| GPT-5.6 Terra, recorded cost divided by 12 | 18.67 | 100% | $0.003018 |
| DeepSeek V4 Flash | 18.11 | 89% | $0.004935 |

Under the assumed 12-times subscription adjustment, Luna was approximately 64 percent cheaper per qualifying run than GLM and approximately 75 percent cheaper than Muse.
Luna also had the highest aggregate quality and passed every run.
Terra was approximately 83 percent more expensive than Muse after adjustment and did not improve aggregate quality over Luna on these moderate workloads.
Terra remained less expensive than DeepSeek under the same comparison.

## Decision effect

The evidence supports Luna as the default busy-work model when Codex quota is available.
Muse remains valuable for large fan-outs because its separate OpenCode Go allowance preserves the Codex pool and it was faster than Luna in the first benchmark.
GLM remains the least expensive successful OpenCode Go alternative and a useful independent model family.
Terra should be reserved for workloads whose difficulty specifically benefits from it rather than routine work.
Qwen should remain unrouted until its OpenCode endpoint succeeds.

## Limitations

The two candidate rounds used the same fixtures and rubric but separate blinded Sol judging sessions, so small score differences should not be treated as precise model rankings.
The 12-times Codex adjustment is approximate and may not match model-specific subscription weighting or rate limits.
The benchmark contains moderate synthetic tasks rather than long-lived production changes.
The second round's three Sol judgments recorded $0.731495 before any subscription adjustment and were excluded from worker cost comparisons.
