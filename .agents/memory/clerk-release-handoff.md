---
name: Clerk release handoff
description: Environment-specific timing behavior for authenticated release browser journeys.
---

The authenticated release browser journey should allow a bounded Clerk handoff window longer than the default Playwright navigation timeout. Under full Firefox suite load, a concurrent two-session handoff exceeded 30 seconds even though token creation succeeded; a 60-second per-session limit passed the final gate. Preserve the concurrent sign-ins required by the convergence contract.

**Why:** The full suite timed out while the second browser remained on the sign-in surface, while the same journey passed in isolation. Serializing the sign-ins would weaken the convergence scenario rather than fix the timing boundary.

**How to apply:** Keep the handoff timeout configurable and bounded; use a per-session 60-second override for concurrent Firefox sessions under full-suite load, and still validate the final dashboard URL plus readiness handshake.