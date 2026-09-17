---
name: Delivery promotion boundary
description: The conservative boundary between server-owned candidate eligibility and automatic file promotion.
---

The first promotion phase is decision-only. A delivery may be marked `AUTO_PROMOTE_ELIGIBLE` only when its candidate and change-set digests, digest contract, and validation receipts agree, and every changed path is inside the server-owned low-risk surface. Source, configuration, dependency, deployment, credential, and sensitive-path changes remain `REVIEW_REQUIRED` or `BLOCKED`.

**Why:** The existing proposal and candidate lifecycle already owns approval, validation, recovery, and promotion. Granting automatic write authority before a persistent opt-in policy and a server-owned approval scope exists would bypass those safety boundaries.

**How to apply:** Treat the decision as an eligibility projection, not authorization. Any future auto-promotion must add an explicit server-owned policy/consent gate, re-check the immutable candidate, and preserve the current proposal approval and recovery fences.