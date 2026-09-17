---
name: Recovery coordinator boundary
description: Automatic recovery uses separate task and conversational adapters with shared server-owned admission checks.
---

The recovery coordinator may automatically retry or resume durable task executions, and may resume proof-backed conversational executions only through a separate adapter that preserves the original request envelope, session/evidence scope, operation identity, revision, and cancellation semantics. Ordinary CHAT remains excluded except for one server-owned, bounded MODEL_OUTPUT_INVALID replay.

**Why:** Task lifecycle execution already owns provider invocation, retry identity, leases, and terminal acceptance. Reusing it for conversational turns would risk losing session/evidence bindings or treating a user-facing retry as a task retry. A malformed provider response is different: the original user turn is already durable, and one replay can recover it without a second user submission.

**How to apply:** Keep task retries on the task lifecycle. Route proof-backed conversational RESUME_ALLOWED and the initial CHAT/MODEL_OUTPUT_INVALID replay through the shared chat stream handler via a server-owned response sink; require a valid session, accepted reason/action, matching project revision, and attempt-zero parser failure for the CHAT exception. Retry claims increment the execution attempt.

Passive clients must not call a token-claiming resume-capability endpoint while the coordinator can recover the same execution. Token issuance belongs to an explicit manual fallback or the server-owned recovery runner.

**Why:** The capability endpoint updates the durable token hash. A polling client that claims it can race the coordinator and invalidate the token the recovery worker is about to use.

**How to apply:** Poll execution status without claiming credentials. Only fetch and persist a resume token after the user explicitly chooses manual Resume, then immediately submit that token through the normal stream handler.