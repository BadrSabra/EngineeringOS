---
name: P7.5 measurement continuation
description: Identity and authority boundaries for recovering runtime-start measurements after execution-attempt rotation.
---

A cross-attempt P7.5 continuation must keep the immutable source registration separate from the new read-only measurement identity. Bind both to the same durable execution, Mission, Goal, plan/project/environment revisions; require a later attempt and a new Episode; restrict the observation profile to server-owned `runtime.status`; never replay `runtime.start`.

Continuation receipts are not calibration-v1 results. Keep old unresolved registrations unresolved; only a separately reviewed policy/scope version and evaluator may admit continuation outcomes into a future cohort. A typed receipt alone does not authorize a runtime read or prove a retained observation.

**Why:** Resume rotates attempt and Episode identities. Treating a new attempt's observation as if it belonged to the original action silently crosses ownership and evidence boundaries; silently counting it would also change the calibration protocol after outcomes are visible.

**How to apply:** When wiring the continuation into Mission recovery, append request/result events under the current attempt's lease and Episode, validate the original registration hash and exact scope, retain the direct observer row, and fail closed on cancellation, revision drift, duplicate/conflicting results, or missing proof. Keep calibration eligibility disabled until a versioned evaluator explicitly accepts the new protocol.