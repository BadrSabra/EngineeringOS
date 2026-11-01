---
name: Recovery coordinator boundary
description: Automatic recovery uses separate task and conversational adapters with shared server-owned admission checks.
---

The recovery coordinator may automatically retry or resume durable task executions, and may resume conversational executions only through a separate adapter that preserves the original request envelope, session/evidence scope, operation identity, revision, and cancellation semantics. Ordinary CHAT admits two bounded parser replays and up to three bounded transient provider retries. Proof-required non-CHAT recovery also has a three-attempt cap for every authorized resume/retry action, regardless of the acceptance failure reason; exhaustion finalizes from retained evidence.

**Why:** Task lifecycle execution already owns provider invocation, retry identity, leases, and terminal acceptance. Reusing it for conversational turns would risk losing session/evidence bindings or treating a user-facing retry as a task retry. A reason-code allowlist can miss `EXECUTION_ACCEPTANCE_INCOMPLETE` even while `RESUME_ALLOWED` remains set, causing unbounded provider work. Recovery can also fail with HTTP 200 and a binding/provenance failure code, so status alone cannot decide whether to retry.

**How to apply:** Keep task retries on the task lifecycle. Route conversational recovery through the shared chat stream handler via a server-owned response sink; require a valid session, accepted action, matching project revision, and an execution attempt below its budget. On exhaustion, refine the existing terminal message/acceptance in place: ordinary CHAT uses `ANALYSIS_INCOMPLETE`/`ABANDON_EXECUTION` without fabricated evidence, while proof-backed analysis uses retained evidence and `REVIEW_INCOMPLETE_EVIDENCE`. Durably block automatic recovery on binding/provenance mismatches while preserving the manual next action. Retry claims increment the execution attempt.

Passive clients must not call a token-claiming resume-capability endpoint while the coordinator can recover the same execution. Token issuance belongs to an explicit manual fallback or the server-owned recovery runner.

**Why:** The capability endpoint updates the durable token hash. A polling client that claims it can race the coordinator and invalidate the token the recovery worker is about to use.

**How to apply:** Poll execution status without claiming credentials. Only fetch and persist a resume token after the user explicitly chooses manual Resume, then immediately submit that token through the normal stream handler.

Generic execution recovery endpoints must reject executions linked to a Task. Task-linked resume belongs to the Task lifecycle, which binds the current Task status, project, correlation pointer, and execution claim in one transaction. Generic retry and operator recovery must not rotate credentials or terminalize that execution independently.

**Why:** A generic recovery action can otherwise bypass the Task retry budget and leave Task status or correlation identity inconsistent with its execution.

**How to apply:** Keep Task-linked executions out of generic resume/retry capability and operator recovery routes; only the Task lifecycle may claim them after validating the current Task row. Conversational recovery remains a separate adapter for unlinked executions.

Local cooldown metadata must not override independent provider-limit evidence in a persisted acceptance. A quota failure, provider retry source, or non-local/unknown limit scope takes precedence over a later project cooldown marker; only a purely local limit remains eligible for bounded automatic retry.

**Why:** The coordinator can persist a local project backoff onto an existing failed acceptance. If that replaces the source without clearing the original failure kind or scope, treating the local marker as authoritative can accidentally resume an upstream-quota failure.

**How to apply:** Evaluate provider/quota signals and scope conflicts before local cooldown exemptions. Permit automatic recovery for local source/scope only when no stronger provider or unknown-scope evidence is present; otherwise require explicit manual action.