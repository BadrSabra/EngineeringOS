---
name: Live campaign isolation
description: Safety boundaries for empirical provider, browser, deployment, and remote-delivery campaigns.
---

Live campaigns are measurement-only: they require explicit opt-in, disposable workspaces and outputs, bounded execution, and redacted operation-keyed receipts. External unavailability is uncertainty, not a quality failure.

**Why:** Provider and side-effect lanes are useful for empirical evidence but must never overwrite release artifacts, mutate production execution paths, or become a required deterministic gate.

**How to apply:** Keep deterministic release checks provider-free. Require each live lane and any deployment or remote-delivery side effect to be independently enabled and reviewable.

Disposable source copies must exclude generated validation/project roots and dependency/build caches at every directory depth.

**Why:** Retained validation workspaces can exhaust process, port, or filesystem quotas before a campaign reaches provider execution, making the evidence incomplete.

**How to apply:** Treat generated workspace trees as non-source inputs in every recursive candidate copy; never delete shared evidence just to make a campaign fit.