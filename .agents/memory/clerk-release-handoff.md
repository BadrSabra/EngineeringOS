---
name: Clerk release handoff
description: Environment-specific timing behavior for authenticated release browser journeys.
---

The authenticated release browser journey should allow a bounded Clerk handoff window longer than the default Playwright navigation timeout. Under full Firefox suite load, a concurrent two-session handoff exceeded 30 seconds even though token creation succeeded; a 60-second per-session limit passed the final gate. Preserve the concurrent sign-ins required by the convergence contract.

**Why:** The full suite timed out while the second browser remained on the sign-in surface, while the same journey passed in isolation. Serializing the sign-ins would weaken the convergence scenario rather than fix the timing boundary.

**How to apply:** Keep the handoff timeout configurable and bounded; use a per-session 60-second override for concurrent Firefox sessions under full-suite load, and still validate the final dashboard URL plus readiness handshake.

Multi-route authenticated Firefox journeys can also exceed the suite's 45-second Playwright test budget under load, even when the same journey passes in isolation. Give only the affected journey a bounded 60-second test timeout rather than raising the suite-wide limit.

**Why:** A test can reach a late reload assertion after consuming most of the default budget; the resulting timeout can look like missing durable UI evidence even when the fixture and page pass when run alone.

**How to apply:** Keep session handoff and test execution budgets distinct. For a slow authenticated journey, compare isolated and full-suite runs, then raise only that test's timeout to 60 seconds if the failure is load-sensitive.