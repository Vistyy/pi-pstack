# Verification record

This record captures bounded checks performed against pstack `0.14.7` at commit `efa2a531985e0a8084d36ff3cf87233be8a9f34b`.
Generated logs and disposable profiles remain under `.work/` and are not release artifacts.

## Current no-model boundaries

`pnpm port:verify` verified that `vendor/pstack` has the exact locked upstream tree and the required upstream commit and tree trailers.
It passed 101 Pi boundary tests, 52 lifted upstream Bun tests, the root TypeScript check, and the upstream watch-pr TypeScript check.
It verified all six pinned official files by SHA-256 digest.
The generated port report records 99 exact files, 55 adapted files, four intentional omissions, six official integration files, and 72 Pi-owned files.
The remaining omissions are the upstream plugin manifest, the unsupported Grok Bot skill, the vendor-specific automated-review policy, and the host-specific worktree audit.
The report gives every upstream file a `port-map.json` classification and action, and no upstream file is unclassified.

The packed-profile smoke built an npm tarball, installed it into clean disposable prefixes, and loaded the plain, pstack, and current Pi profiles without model calls.
The tarball contains no bundled Bun binary, `node_modules`, Grok Bot skill, dormant automation source, source guide, or assets.
The packed worker-resource smoke started a Pi RPC session without a prompt and confirmed that the Poteto skill command was registered.
It confirmed that all 48 packaged skills and the core pstack extension crossed the worker boundary while delegation extensions, `Task`, and other delegation tools did not.
It confirmed that `pstack_todo` remained available to the worker.

The live model configuration remains on `inherit-parent` while the OpenAI Codex and OpenCode Go role map is selected.
The configuration preserves four entries for every upstream four-member panel.
The no-model checks establish provenance, packaging, resource visibility, tool ownership, model routing shape, and process startup.
They do not establish that a model follows the complete workflow or that the workflow improves task outcomes.

## Current Luna conformance

The bounded Luna sequence exposed four live-boundary defects before reaching a valid pass.
Pi disabled the upstream `poteto-agent` identity because its frontmatter contained Cursor-only `is_background` metadata.
Herdr's pre-prompt session metadata described the eventual default session path before that file existed, so startup validation had treated provisional metadata as committed state.
A Poteto child could ignore its identity's required skill read and todo initialization when the assignment requested a terse result.
The settlement helper also applied its five-second state-change window to model completion, causing valid longer turns to time out.

The repaired boundary removes only the unsupported identity field, treats the created pane as the pre-prompt identity authority, and reconciles the session path after the first settled turn.
It gives every Poteto worker a separate bootstrap turn and verifies from the child transcript that it read the exact packaged `poteto-mode/SKILL.md` and initialized `pstack_todo` before submitting the assignment.
The settlement helper now gives an observed working turn its complete configured settlement timeout.

The final `openai-codex/gpt-5.6-luna` run passed with one parent and one child session.
The parent read Poteto Mode, initialized its todo list, and issued exactly one foreground readonly Task.
The child transcript records the exact Poteto skill read, `pstack_todo` initialization, the assigned `README.md` read, and the expected marker response.
No files changed and no additional workers started.
The artifacts are under `.work/conformance-luna-20260902-222019/`.

## OpenCode Go read-only calibration

Four anonymized models answered the same organic architecture question against identical copies of a small configuration service.
The prompt required complete runtime flow, ownership boundaries, exact citations, and identification of a closure that retained stale state after a successful reload.
GPT-5.6 Sol judged all four answers in one blinded pass against the source and a five-part rubric.

| Model | Score |
| --- | ---: |
| `opencode-go/deepseek-v4-flash` | 18/20 |
| `opencode-go/glm-5.3-flash` | 17/20 |
| `opencode-go/qwen3.8-flash` | 16/20 |
| `opencode-go/muse-spark-1.2-contributor` | 15/20 |

Independent review agreed with the ranking.
DeepSeek gave the strongest complete flow and stale-state explanation but had inaccurate line citations.
GLM gave the next strongest answer and overstated two ownership boundaries.
Qwen emphasized the revision gate instead of the requested closure risk before mentioning the closure secondarily.
Muse traced the flow and closure correctly but made the most ownership and validation overclaims.
This one synthetic read-only task supports using DeepSeek and GLM as inexpensive review candidates and Muse as a low-risk bulk explorer behind synthesis.
It does not establish code-generation quality, broad task quality, or that Muse Spark 1.3 will retain the same behavior as 1.2.
The artifacts are under `.work/harbor-lantern-20260902-222255/`.

## Current worker-value calibration

Three repeated moderate workloads compared Muse Spark 1.3, GLM-5.3-Flash, DeepSeek V4 Flash, Qwen3.8 Flash, GPT-5.6 Luna, and GPT-5.6 Terra as individual workers.
The workloads covered architecture tracing, evidence-backed diagnosis, and bounded implementation with deterministic checks.
GPT-5.6 Sol judged anonymized responses against a qualification threshold requiring a score of at least 15, no material factual error, and passing implementation checks when applicable.

Muse Spark 1.3 qualified on all nine runs with an 18.22 mean score, and all three implementations passed.
GLM-5.3-Flash qualified on eight of nine runs with a 17.78 mean score and the lowest recorded OpenCode Go cost per qualifying run.
DeepSeek V4 Flash qualified on eight of nine runs with an 18.11 mean score and materially higher recorded cost.
GPT-5.6 Luna qualified on all nine runs with a 19.00 mean score, and GPT-5.6 Terra qualified on all nine with an 18.67 mean score.
Under the user's approximate assumption that Codex subscription usage provides 12 times the recorded API value, Luna had the lowest estimated cost per qualifying run.
The provider has not confirmed that divisor as its model-specific subscription accounting rule.

Qwen3.8 Flash later failed before inference on nine repeated attempts with an HTTP 404 response from the OpenCode endpoint.
That failure establishes an unavailable route, not model quality.
The reports are `benchmarks/worker-value-20260902.md` and `benchmarks/worker-value-codex-20260902.md`.
The complete local artifacts are under `.work/lantern-field-20260902T225735/` and `.work/lantern-field-20260902T232151/`.

## Current Muse concurrency boundary

Ten independent Muse Spark 1.3 Pi workers performed concurrent multi-turn read-only repository inspections through OpenCode Go.
All ten completed without an HTTP 429 response or process failure.
The workers made 54 provider requests and processed 341,259 total tokens in 7.0 to 25.6 seconds per worker.
This establishes a successful burst of ten concurrent workers, not a sustained throughput limit or equivalence with Meta's direct provider.
The artifacts are under `.work/muse-concurrency-20260902T234142/`.

## Current remaining conformance boundary

The current live conformance run proves one foreground readonly Poteto child under a Luna parent.
It does not yet prove configured multi-model routing, background panel fan-out, grouped completion, worktree execution, synthesis ordering, or the repaired non-Herdr fallback in one current model-backed workflow.
The historical transport runs below establish narrower older mechanisms and must not be combined into a claim of current full-workflow conformance.

## Historical Herdr transport boundary

A disposable pstack parent Pi session ran in unfocused Herdr tab `wRE:t3` and pane `wRE:p7`.
The parent called a background `Task` named `integration-smoke-1` using `openai-codex/gpt-5.6-luna` at medium thinking.
The child returned `CHILD_OK`, its grouped completion woke the parent, and the parent returned `PARENT_OK`.
The parent then used `send_agents` on the settled worker name.
The adapter reopened the preserved child Pi session, the child returned `CHILD_RESUMED`, and the parent returned `PERSISTENCE_OK`.
The disposable parent tab was closed after its transcript was retained at `.work/pstack-e2e-parent.jsonl`.

A separate disposable Git repository exercised `herdr worktree create` with an explicit base, branch, label, and no-focus placement.
The returned workspace, tab, pane, branch, and checkout path matched the metadata consumed by the worker adapter.
The disposable checkout and Herdr surface were removed after inspection.

This transport run predates the repaired worker identity, explicit skill-loading contract, and thinking-aware role routing.
It remains evidence for Herdr persistence and completion delivery, not for current workflow conformance.

## Historical non-Herdr fallback transport boundary

A clean installed profile was loaded with the Herdr environment removed.
The fallback registered the single `Task` owner and loaded without extension errors.
A foreground Luna Task returned `FALLBACK_CHILD_OK`, and the parent returned `FALLBACK_PARENT_OK`.
The child used a persistent Pi session file under the disposable profile.
This transport run predates the repaired fallback resource boundary and does not verify the current fallback prompt or model-routing behavior.

## Browser control boundary

The pinned `chrome-devtools-axi` version `0.1.33` connected to a disposable headless Chromium DevTools endpoint.
It opened a data URL and returned an accessibility snapshot containing heading `PSTACK_AXI_OK` and button `Test` with current generation references.
The bridge reported `status: stopped`, and the disposable browser process and profile were removed.

## Historical Harbor boundary

Harbor `0.17.1` loaded the pinned `spersico/pi-harbor-adapter` commit `55826f51ad17d8087c1606d0eaf85aa258b68bf2`.
An install-only Terminal-Bench 2.1 trial completed with Pi `0.84.4`, the generated pstack profile, auth detection, and no model or verifier calls.
The result is under `.work/harbor-install-pstack/`.

The scored three-condition Harbor pilot completed with four Luna sessions and no human intervention.
Plain, current, and pstack each received verifier reward `1.0`.
Pstack used 573,474 total tokens and 218.452 seconds, compared with 98,084 tokens and 104.473 seconds for plain Pi and 126,359 tokens and 93.511 seconds for the current configuration.
The plain agent command reported `NonZeroAgentExitCodeError` after completing the work, but the independent verifier passed the resulting repository.
Pstack exceeded the three-times-token stop threshold without changing a control failure into a pass, so the five-task follow-up was not run.
`BENCHMARK.md` records the complete pilot table and decision.

These Harbor outcomes predate the repaired worker and model-routing boundaries and are not evidence of the current port's workflow conformance or effectiveness.

## Historical hard-task benchmark boundary

Harbor `0.17.1` downloaded each of the six SWE-bench Pro task references frozen in `HARD-BENCHMARK.md` at registry revision `2`.
Each downloaded `task.toml` declared the expected `scale-ai/<instance>` task name and a 3000-second agent and verifier timeout.
The official SWE-bench Pro dataset at commit `7ab5114912baf22bb098818e604c02fe7ad2c11f` contained all six exact instance IDs.
The independent audit at commit `354b3c02a2e055fcd332488600d251338c841380` labeled all six instances `ENTAILED` and did not list them among its three reported gold-patch failures.

The first six-task install check found that the pinned Pi adapter assumed `apt-get`, while the Teleport and ProtonMail images use Alpine Linux.
The reproducible patch at `benchmarks/pi-harbor-swepro-alpine.patch` added deterministic Node `v24.20.0` installation for Debian and Alpine and copied fallback-worker transcripts into Harbor agent logs.
Its SHA-256 digest is `eaaacaa0acd1dc8e2277abaaecaf477b1439a9cb3723766f1b7fc6b4e86f5537`.
After the patch, install-only checks completed for both profiles on all six tasks with no exceptions and no model calls.

An invalid scored command then failed before any captured model response because Pi was unavailable in new shells or `stdbuf` was missing.
Every agent execution ended in less than one second, and inspecting the resulting state established that no valid scored attempt had occurred before retrying.
It remains unknown whether the two broken pipelines that could start Pi initiated provider requests before termination, so budget accounting conservatively allows two additional starts.
The deterministic Node patch removed NVM from every task image and removed the `stdbuf` dependency.
Both complete install-only checks passed again before the valid scored run.

The valid exploratory run completed twelve trials with no human intervention.
Plain Pi and pstack both passed Element Web, Teleport, NodeBB, and Tutanota and both failed Flipt and ProtonMail.
Plain Pi used six sessions and 6,810,093 total tokens.
Pstack used six primary sessions, nine fallback-worker sessions, and 26,893,512 total tokens.
Summed end-to-end trial time was 69m 46s for plain Pi and 90m 49s for pstack.
The pstack NodeBB command reported `UnknownApiError`, but the recovered session emitted a final response and the independent verifier awarded reward `1.0`.
Results and transcripts are under `.work/hard-benchmark-runs/hard-exploratory-v2-{plain,pstack}/`.

Trajectory inspection found that the images retained historical target commits.
Plain Pi inspected target implementations on two tasks, and pstack inspected them on five tasks, with several attempts applying target source directly.
The verifier outcomes establish produced-repository state but do not establish unaided implementation ability.
`HARD-BENCHMARK.md` records the complete accounting and interpretation boundary.
