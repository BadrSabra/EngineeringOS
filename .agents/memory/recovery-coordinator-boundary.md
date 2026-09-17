---
name: Recovery coordinator boundary
description: Automatic recovery uses separate task and conversational adapters with shared server-owned admission checks.
---

The recovery coordinator may automatically retry or resume durable task executions, and may resume conversational executions only through a separate adapter that preserves the original request envelope, session/evidence scope, operation identity, revision, and cancellation semantics. Ordinary CHAT admits two bounded parser replays and up to three bounded transient provider retries, then terminalizes as incomplete; proof-backed analysis can finish from its retained evidence after its provider budget is exhausted.

**Why:** Task lifecycle execution already owns provider invocation, retry identity, leases, and terminal acceptance. Reusing it for conversational turns would risk losing session/evidence bindings or treating a user-facing retry as a task retry. Parser failures are less likely to improve when repeated, while transient provider outages/rate limits can clear; separate small budgets reduce intervention without creating an unbounded loop. Every bounded conversational turn now reaches a terminal outcome rather than requiring a manual Retry.

**How to apply:** Keep task retries on the task lifecycle. Route the first two CHAT/MODEL_OUTPUT_INVALID or first three CHAT/EXECUTION_PROVIDER_FAILURE retries through the shared chat stream handler via a server-owned response sink; require a valid session, accepted reason/action, matching project revision, and an execution attempt below the failure-specific CHAT budget. When any conversational recovery reaches its bound, refine the existing terminal message/acceptance in place: ordinary CHAT uses `ANALYSIS_INCOMPLETE`/`ABANDON_EXECUTION` without fabricated evidence, while proof-backed analysis uses retained evidence and `REVIEW_INCOMPLETE_EVIDENCE`. Retry claims increment the execution attempt.

Passive clients must not call a token-claiming resume-capability endpoint while the coordinator can recover the same execution. Token issuance belongs to an explicit manual fallback or the server-owned recovery runner.

**Why:** The capability endpoint updates the durable token hash. A polling client that claims it can race the coordinator and invalidate the token the recovery worker is about to use.

**How to apply:** Poll execution status without claiming credentials. Only fetch and persist a resume token after the user explicitly chooses manual Resume, then immediately submit that token through the normal stream handler.