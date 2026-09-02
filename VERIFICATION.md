# Verification record

This record captures bounded checks performed against pstack `0.14.7` at commit `efa2a531985e0a8084d36ff3cf87233be8a9f34b`.
Generated logs and disposable profiles remain under `.work/` and are not release artifacts.

## Mechanical boundaries

`pnpm check` passed 90 Pi boundary tests, 52 lifted upstream Bun tests, the root TypeScript check, and the upstream watch-pr TypeScript check.
`node scripts/check-upstream.mjs` reported the pinned upstream commit as current.
`node scripts/sync-integrations.mjs` verified all six pinned official files by SHA-256 digest.
`node scripts/report-port.mjs` reported 92 exact files, 55 adapted files, 11 intentional omissions, six official integration files, and 29 Pi-only files.
The omissions are the upstream plugin manifest, the unsupported Grok Bot skill, the vendor-specific automated-review policy, the host-specific worktree audit, and seven unused vendor integration playbooks.
`node scripts/smoke-profiles.mjs` loaded plain, pstack, and current disposable Pi profiles without model calls.
The profile smoke built an npm tarball, installed it into a clean prefix, and loaded its Pi commands.
The tarball contains no bundled Bun binary, `node_modules`, Grok Bot skill, dormant automation source, source guide, or assets.
The system Bun runtime returned `1.3.13`.

## Herdr persistent worker boundary

A disposable pstack parent Pi session ran in unfocused Herdr tab `wRE:t3` and pane `wRE:p7`.
The parent called a background `Task` named `integration-smoke-1` using `openai-codex/gpt-5.6-luna` at medium thinking.
The child returned `CHILD_OK`, its grouped completion woke the parent, and the parent returned `PARENT_OK`.
The parent then used `send_agents` on the settled worker name.
The adapter reopened the preserved child Pi session, the child returned `CHILD_RESUMED`, and the parent returned `PERSISTENCE_OK`.
The disposable parent tab was closed after its transcript was retained at `.work/pstack-e2e-parent.jsonl`.

A separate disposable Git repository exercised `herdr worktree create` with an explicit base, branch, label, and no-focus placement.
The returned workspace, tab, pane, branch, and checkout path matched the metadata consumed by the worker adapter.
The disposable checkout and Herdr surface were removed after inspection.

## Non-Herdr fallback boundary

A clean installed profile was loaded with the Herdr environment removed.
The fallback registered the single `Task` owner and loaded without extension errors.
A foreground Luna Task returned `FALLBACK_CHILD_OK`, and the parent returned `FALLBACK_PARENT_OK`.
The child used a persistent Pi session file under the disposable profile.

## Browser control boundary

The pinned `chrome-devtools-axi` version `0.1.33` connected to a disposable headless Chromium DevTools endpoint.
It opened a data URL and returned an accessibility snapshot containing heading `PSTACK_AXI_OK` and button `Test` with current generation references.
The bridge reported `status: stopped`, and the disposable browser process and profile were removed.

## Harbor boundary

Harbor `0.17.1` loaded the pinned `spersico/pi-harbor-adapter` commit `55826f51ad17d8087c1606d0eaf85aa258b68bf2`.
An install-only Terminal-Bench 2.1 trial completed with Pi `0.84.4`, the generated pstack profile, auth detection, and no model or verifier calls.
The result is under `.work/harbor-install-pstack/`.

The scored three-condition Harbor pilot completed with four Luna sessions and no human intervention.
Plain, current, and pstack each received verifier reward `1.0`.
Pstack used 573,474 total tokens and 218.452 seconds, compared with 98,084 tokens and 104.473 seconds for plain Pi and 126,359 tokens and 93.511 seconds for the current configuration.
The plain agent command reported `NonZeroAgentExitCodeError` after completing the work, but the independent verifier passed the resulting repository.
Pstack exceeded the three-times-token stop threshold without changing a control failure into a pass, so the five-task follow-up was not run.
`BENCHMARK.md` records the complete pilot table and decision.

## Hard-task benchmark boundary

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
