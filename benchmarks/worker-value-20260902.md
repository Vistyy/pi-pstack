# Inexpensive worker value benchmark

## Decision question

This benchmark tested whether GLM-5.3-Flash's low recorded cost on one small architecture task persisted across repeated, moderately larger worker tasks while preserving acceptable quality.
It compared inexpensive worker models rather than possible coordinator models.
GPT-5.6 Sol remained the blinded judge.

## Method

The benchmark used three workloads: architecture tracing across a relay service, diagnosis of a checkout cache defect, and implementation of dry-run behavior in an archive cleanup command.
Each of four models received each workload three times, producing 36 candidate sessions.
One blinded GPT-5.6 Sol session judged all 12 responses for each workload.
A response qualified only when it scored at least 15, had no material factual error, and, for implementation work, passed the deterministic repository checks.
The comparison used recorded cost per qualifying run rather than raw score divided by cost.

The candidate models were `opencode-go/muse-spark-1.3-contributor`, `opencode-go/glm-5.3-flash`, `opencode-go/deepseek-v4-flash`, and `opencode-go/qwen3.8-flash`.
All candidates and judges used high thinking.
The run is stored locally under `.work/lantern-field-20260902T225735/`.

## Aggregate evidence

| Model | Mean score | Qualifying runs | Implementation passes | Average recorded cost | Cost per qualifying run | Average elapsed time |
|---|---:|---:|---:|---:|---:|---:|
| Muse Spark 1.3 | 18.22 | 9/9 | 3/3 | $0.001647 | $0.001647 | 22.5 seconds |
| GLM-5.3-Flash | 17.78 | 8/9 | 3/3 | $0.001016 | $0.001143 | 59.6 seconds |
| DeepSeek V4 Flash | 18.11 | 8/9 | 3/3 | $0.004387 | $0.004935 | 34.8 seconds |
| Qwen3.8 Flash | 0.67 | 0/9 | 0/3 | $0 | Not applicable | 0.9 seconds |

Muse Spark 1.3 was the most reliable candidate, qualified on every run, and had the lowest average elapsed time.
GLM-5.3-Flash had the lowest recorded cost per qualifying run, approximately 31 percent below Muse, but one materially inaccurate architecture explanation failed the qualification rule.
DeepSeek V4 Flash produced similar aggregate quality to Muse but cost approximately three times as much per qualifying run.
Qwen returned empty responses with zero token usage on all nine attempts, indicating a model-route or provider failure rather than evidence about its task capability.

## Workload differences

Muse qualified on all architecture runs with scores of 19, 19, and 19.
GLM scored 19, 17, and 18 on architecture, with the 17 rejected for a material claim that queued delivery objects were immutable.
DeepSeek scored 20, 16, and 18 on architecture, with the 16 rejected for inaccurate ownership and validation claims.

All three functioning models qualified on all diagnosis runs.
Muse scored 18, 20, and 19; GLM scored 18, 17, and 19; and DeepSeek scored 16, 19, and 17.

All three functioning models passed every implementation check.
Muse scored 18, 15, and 17; GLM scored 17, 18, and 17; and DeepSeek scored 20, 18, and 19.
GLM used $0.002970 of recorded cost across its three implementation runs, compared with $0.008543 for Muse and $0.014231 for DeepSeek.

## Conclusion

The hypothesis is supported narrowly: GLM's recorded-cost advantage persisted across these workloads after accounting for failed-quality runs.
The evidence does not establish that GLM is universally the most effective worker.
Muse Spark 1.3 provided better reliability, architecture consistency, and latency, while GLM provided the lowest qualifying cost and concise implementations.

The current evidence supports Muse Spark 1.3 for high-volume exploration and GLM-5.3-Flash as a particularly economical independent implementation or review candidate.
DeepSeek remains useful when its distinct analysis or stronger implementation quality justifies its higher consumption.
Qwen should not be routed until its empty-response failure is diagnosed.

## Limitations

This benchmark contains three fixed workloads and three repetitions, so its estimates remain directional.
Each workload used one Sol judging session, meaning judge variance was not measured.
Recorded cost came from Pi provider usage metadata and was not independently confirmed as the exact subscription allowance debit.
The original harness did not retain raw candidate JSONL, so it cannot recover Qwen's provider error details from this run.
The harness now retains candidate JSONL and model error messages for future runs.
Luna was intentionally excluded because this benchmark did not test coordinator replacement or the user's separate assumption that Luna should handle routine busy work.
