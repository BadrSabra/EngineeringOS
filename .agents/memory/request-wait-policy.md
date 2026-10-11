---
name: Request wait policy
description: Product decision on project-wide request caps, provider request timeouts, and retry delays.
---

Disable the project-wide 20-requests-per-minute cap and its calculated wait to the end of the window. Remove locally imposed provider request timeouts and delays before retrying network errors. Keep caller cancellation, bounded retry counts, execution budgets, and positive provider-supplied Retry-After handling; these are separate controls.

**Why:** The user identified these as product/resource policies and explicitly asked to remove them while continuing the E2 evaluation.

**How to apply:** Do not reintroduce project window accounting, local transport deadlines, or network-error backoff without an explicit product decision. Preserve provider-directed cooldowns and execution-safety limits.
