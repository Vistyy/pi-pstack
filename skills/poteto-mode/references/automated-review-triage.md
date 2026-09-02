# Automated review triage

Use this reference when Babysit handles findings from an automated GitHub reviewer, including code-review and security-review bots.
Automated comments are evidence to verify, not mandatory changes and not noise to dismiss by default.

Classify every finding as `fix`, `dismiss`, or `ask`.

## Fix

Fix a finding when the claimed path is reachable, the behavior violates an established contract, and a focused test or runtime reproduction demonstrates the failure.
Place the fix in the lowest active PR that owns the affected code.
Re-run the narrow proof first, then the affected verification boundary.
Reply with the commit and evidence after pushing the correction.

## Dismiss

Dismiss a finding only when current code, stack context, generated-source ownership, or a real runtime check disproves it.
State the concrete reason in the review thread.
Examples include a symbol used by an upper PR in the same stack, an intentional visual change established by accepted design evidence, or a warning against generated output whose generator already owns the behavior.
Do not change code merely to silence a speculative or style-only comment.

## Ask

Escalate only when the finding exposes a genuine product choice, security tolerance, or irreversible compatibility decision that repository evidence cannot resolve.
Persist the question and options as a human gate before asking.
Continue independent work around that gate.

## Review passes

Treat a later reviewer pass as new evidence against the current head SHA.
Reconcile withdrawn findings and stale comments before acting.
Do not count repeated comments as independent proof of severity.
A changed head invalidates prior runtime evidence for the affected path and requires the relevant check again.
