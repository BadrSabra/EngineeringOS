---
name: Reconnect capability race oracle
description: Concurrent resume-capability responses do not reveal database commit order; reconnect tests need a server-owned current-token step.
---

Do not select the last response from a concurrent resume-capability batch as the valid token. Response order is independent from the final committed token hash.

**Why:** A capability rotation storm can return several valid-looking tokens while only the latest committed hash is claimable; stale streams may surface as claim conflicts, non-resumable terminal states, or HTTP 409 depending on timing.

**How to apply:** After a rotation storm, request one fresh server-owned capability, consume it in the winning stream, then replay stale tokens concurrently. Assert one provider call, one terminal attempt/message/acceptance, stable execution/session/operation identity, and exactly one user turn; accept only the bounded stale-token terminal projections.