---
name: Clerk release handoff
description: Environment-specific timing behavior for authenticated release browser journeys.
---

The authenticated release browser journey should allow a bounded Clerk handoff window longer than the default Playwright navigation timeout; under the full suite, Clerk can remain on its sign-in surface for several seconds before redirecting to the dashboard.

**Why:** A shorter timeout produced false failures during the complete release journey even though the Clerk sign-in token and final dashboard session were valid.

**How to apply:** Keep the handoff timeout configurable and bounded, and validate the final dashboard URL plus the readiness handshake rather than treating the intermediate sign-in delay as an auth failure.