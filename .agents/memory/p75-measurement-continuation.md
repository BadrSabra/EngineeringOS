---
name: P7.5 measurement continuation
description: Identity and authority boundaries for recovering runtime-start measurements after execution-attempt rotation.
---

A cross-attempt P7.5 continuation must keep the immutable source registration separate from the new read-only measurement identity. Bind both to the same durable execution, Mission, Goal, plan/project/environment revisions; require a later attempt and a new Episode; restrict the observation profile to server-owned `runtime.status`; never replay `runtime.start`. If a later attempt reuses a persisted result, carry its owning Episode/attempt and close that Episode as well as the recovery Episode.

Continuation receipts are not calibration-v1 results. Keep old unresolved registrations unresolved; only a separately reviewed policy/scope version and evaluator may admit continuation outcomes into a future cohort. A typed receipt alone does not authorize a runtime read or prove a retained observation.

**Why:** Resume rotates attempt and Episode identities. Treating a new attempt's observation as if it belonged to the original action silently crosses ownership and evidence boundaries; leaving the result-owning Episode open also makes durable recovery appear unfinished. Silently counting it would change the calibration protocol after outcomes are visible.

**How to apply:** When wiring the continuation into Mission recovery, append new request/result events under the current attempt's lease and Episode, validate the original registration hash and exact scope, and retain the direct observer row. When reusing an older result, validate its exact durable request/result pair and scope before appending one terminal event to its owner Episode using that Episode's own attempt-local sequence; close it and the current Episode and terminalize the execution in one transaction under the current lease. Fail closed on cancellation, revision drift, duplicate/conflicting results, or missing proof. Keep calibration eligibility disabled until a versioned evaluator explicitly accepts the new protocol.