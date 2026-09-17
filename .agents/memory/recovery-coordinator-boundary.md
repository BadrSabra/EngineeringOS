---
name: Recovery coordinator boundary
description: Automatic recovery uses separate task and conversational adapters with shared server-owned admission checks.
---

The recovery coordinator may automatically retry or resume durable task executions, and may resume conversational executions only through a separate adapter that preserves the original request envelope, session/evidence scope, operation identity, revision, and cancellation semantics. Ordinary CHAT admits only two bounded parser replays or transient provider retries.

**Why:** Task lifecycle execution already owns provider invocation, retry identity, leases, and terminal acceptance. Reusing it for conversational turns would risk losing session/evidence bindings or treating a user-facing retry as a task retry. These two CHAT failure types are safe exceptions because the original user turn is durable; a small two-attempt budget improves recovery without creating an unbounded loop.

**How to apply:** Keep task retries on the task lifecycle. Route proof-backed recovery and the first two CHAT/MODEL_OUTPUT_INVALID or CHAT/EXECUTION_PROVIDER_FAILURE retries through the shared chat stream handler via a server-owned response sink; require a valid session, accepted reason/action, matching project revision, and an execution attempt below the ordinary CHAT budget. Retry claims increment the execution attempt.

Passive clients must not call a token-claiming resume-capability endpoint while the coordinator can recover the same execution. Token issuance belongs to an explicit manual fallback or the server-owned recovery runner.

**Why:** The capability endpoint updates the durable token hash. A polling client that claims it can race the coordinator and invalidate the token the recovery worker is about to use.

**How to apply:** Poll execution status without claiming credentials. Only fetch and persist a resume token after the user explicitly chooses manual Resume, then immediately submit that token through the normal stream handler.