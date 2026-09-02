# Hard-task pstack benchmark manifest

> Historical result only.
> The exploratory run predates the repaired worker identity, explicit skill-loading contract, thinking-aware model routing, four-member panel defaults, and fallback resource boundary.
> Historical target commits also contaminated several trajectories, so this run does not establish current workflow conformance or unaided effectiveness.

This manifest freezes a challenge set for comparing plain Pi with Pi plus pstack on coding tasks where successful completion is uncertain.
It records the completed exploratory run but does not authorize confirmatory model runs.

## Evidence and selection boundary

The task source is the public [SWE-bench Pro dataset](https://huggingface.co/datasets/ScaleAI/SWE-bench_Pro) at commit `7ab5114912baf22bb098818e604c02fe7ad2c11f`.
Scale reports that GPT-5 and Claude Opus 4.1 resolved approximately 23% of the public benchmark under its SWE-Agent evaluation, which makes the benchmark a materially harder starting point than the Terminal-Bench pilot.
Scale does not publish a complete per-instance result matrix, so this manifest does not claim a historical pass probability for an individual selected task.

Each selected task satisfies all of these criteria:

- The official reference patch changes at least seven files and at least 200 lines.
- The task crosses multiple implementation boundaries or requires a repository-wide architectural change.
- The task comes from a different repository or technical surface than the other selected tasks.
- The task is available from Harbor at immutable registry revision `2`.
- The task is not one of the three known gold-patch failures reported by the independent SWE-bench Pro audit at commit [`354b3c02a2e055fcd332488600d251338c841380`](https://github.com/kimjune01/swebench-pro-audit/tree/354b3c02a2e055fcd332488600d251338c841380).
- The same audit labels the task `ENTAILED`, meaning that its graded reference behaviors are stated by the supplied requirements rather than depending on an identified hidden specification choice.

Reference-patch size is selection evidence for task scope, not a requirement that an agent reproduce the reference implementation.
The official verifier remains the only pass authority.

## Frozen task set

Every Harbor task reference below is pinned to revision `2`.
Do not substitute `latest` when executing the benchmark.

| Repository | Technical challenge | Reference scope | Harbor task reference |
| --- | --- | ---: | --- |
| `NodeBB/NodeBB` | Add authenticated group-invitation HTTP APIs across routes, controllers, sockets, client code, and OpenAPI definitions. | 8 files, 256 changed lines | `scale-ai/instance_nodebb__nodebb-18c45b44613aecd53e9f60457b9812049ab2998d-v0495b863a912fbff5749c67e860612b91825407c@2` |
| `element-hq/element-web` | Replace scattered legacy React subtree rendering with managed React roots and correct lifecycle cleanup. | 7 files, 209 changed lines | `scale-ai/instance_element-hq__element-web-d06cf09bf0b3d4a0fbe6bd32e4115caea2083168-vnan@2` |
| `gravitational/teleport` | Implement macOS Touch ID registration and passwordless WebAuthn login across Go, Objective-C, platform shims, and CLI integration. | 10 files, 279 changed lines | `scale-ai/instance_gravitational__teleport-8302d467d160f869b77184e262adbe2fbc95d9ba-vce94f93ad1030e3136852817f2423c1b3ac37bc4@2` |
| `protonmail/webclients` | Implement and validate a Bitcoin payment flow across payment selection, asynchronous state, polling, details, QR presentation, and tests. | 13 files, 422 changed lines | `scale-ai/instance_protonmail__webclients-5f0745dd6993bb1430a951c62a49807c6635cd77@2` |
| `flipt-io/flipt` | Add renewable AWS ECR authentication across configuration schemas, credential providers, OCI storage, generated artifacts, and tests. | 15 files, 346 changed lines | `scale-ai/instance_flipt-io__flipt-c188284ff0c094a4ee281afebebd849555ebee59@2` |
| `tutao/tutanota` | Centralize entropy management behind a facade while preserving dependency injection, login behavior, retry handling, and worker boundaries. | 9 files, 263 changed lines | `scale-ai/instance_tutao__tutanota-f3ffe17af6e8ab007e8d461355057ad237846d9d-vbc0d9ba8f0071fbe982809910959a6ff8884dbbf@2` |

## Comparison protocol

Compare only these two conditions:

1. `plain` uses minimal Pi settings.
2. `pstack` adds the candidate package and invokes the task through `/poteto-mode`.

Both conditions must use the same model, thinking level, Pi version, task revision, timeout, initial repository, task prompt, and concurrency.
No condition may receive task-specific guidance beyond the official task material.
A run that differs on one of these controls is not part of the comparison.

The exploratory stage runs one attempt for each condition on all six tasks.
This produces twelve scored trials but is not enough to estimate stable pass probabilities.
Any confirmatory stage must repeat every task under both conditions rather than selecting repeats based on which exploratory outcomes favor pstack.
A confirmatory run requires separate model-budget approval.

## Measures

The primary measure is verifier passes divided by attempts for each condition.
Report paired outcomes by task so aggregate differences cannot hide repository-specific failures.

Report these secondary measures for every attempt:

- Total model tokens, including every pstack child session.
- Non-cached input plus output tokens.
- Wall time.
- Model-session count.
- Human intervention count.
- Agent or infrastructure exceptions.

Compute tokens per resolved attempt as all tokens consumed by a condition divided by that condition's verifier passes.
Failures remain in the numerator because they are part of the cost of obtaining successful outcomes.
If a condition has no passes, report tokens per resolution as undefined rather than zero.

## Adapter and preflight boundary

The run used Harbor `0.17.1` and `spersico/pi-harbor-adapter` at commit `55826f51ad17d8087c1606d0eaf85aa258b68bf2` with [`benchmarks/pi-harbor-swepro-alpine.patch`](benchmarks/pi-harbor-swepro-alpine.patch), whose SHA-256 digest is `eaaacaa0acd1dc8e2277abaaecaf477b1439a9cb3723766f1b7fc6b4e86f5537`.
The patch installs Node `v24.20.0` deterministically in Debian and Alpine task images and retains fallback-worker transcripts for token accounting.
Before a scored run, perform an install-only adapter check for both profiles and confirm that Harbor resolves exactly the six pinned references above.
[`VERIFICATION.md`](VERIFICATION.md) records the completed task-availability check.

## Exploratory result

The authorized exploratory run completed with no human intervention and captured 21 Luna sessions.
A preceding invalid command may have initiated at most two provider requests before broken output pipelines terminated, so the complete execution remained below the approved maximum 36 Luna sessions even under that conservative count.
Both conditions passed and failed exactly the same tasks.

| Task | Plain | Pstack | Plain sessions | Pstack sessions | Plain total tokens | Pstack total tokens |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Element Web | Pass | Pass | 1 | 3 | 866,040 | 3,154,331 |
| Flipt | Fail | Fail | 1 | 4 | 1,136,495 | 13,912,961 |
| Teleport | Pass | Pass | 1 | 3 | 972,652 | 3,677,373 |
| NodeBB | Pass | Pass | 1 | 1 | 504,474 | 1,547,585 |
| ProtonMail | Fail | Fail | 1 | 2 | 2,427,167 | 1,929,399 |
| Tutanota | Pass | Pass | 1 | 2 | 903,265 | 2,671,863 |
| **Total** | **4/6** | **4/6** | **6** | **15** | **6,810,093** | **26,893,512** |

| Aggregate measure | Plain | Pstack | Pstack / plain |
| --- | ---: | ---: | ---: |
| Non-cached input plus output | 473,069 | 1,336,008 | 2.82x |
| Agent execution time | 49m 35s | 70m 54s | 1.43x |
| End-to-end trial time | 69m 46s | 90m 49s | 1.30x |
| Reported model cost | $0.2643 | $0.8820 | 3.34x |
| Total tokens per verifier pass | 1,702,523 | 6,723,378 | 3.95x |

Primary transcripts were counted from assistant `message_end` usage records.
Fallback-worker transcripts were counted from assistant `message` usage records, so pstack totals include all nine child sessions.
The pstack NodeBB agent command reported `UnknownApiError` after an earlier model turn stopped with an API error, but the session recovered, emitted a final answer, and the independent verifier passed the repository.

### Interpretation boundary

The task images retained Git objects for the historical target commits.
Plain Pi explicitly inspected the target implementation on Teleport and Tutanota, while pstack explicitly inspected it on NodeBB, Element Web, Teleport, ProtonMail, and Tutanota.
Several trajectories applied source directly from those commits.
The verifier results establish the state of the produced repositories, but they do not measure unaided implementation ability on those contaminated attempts.

The paired outcome comparison still shows no observed pstack improvement: its pass/fail vector was identical while it used 3.95 times the total tokens.
Because the exploratory run has one attempt per condition and accessible reference history, it does not estimate stable pass probabilities or justify a broad claim about multi-agent systems.
It does establish that forced Poteto Mode did not improve this run enough to offset its additional work.
The identical outcomes and greater than three-times token use do not justify a confirmatory run on this task environment.
