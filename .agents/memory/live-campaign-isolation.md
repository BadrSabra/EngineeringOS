---
name: Live campaign isolation
description: Safety boundaries for empirical provider, browser, deployment, and remote-delivery campaigns.
---

Live campaigns are measurement-only: they require explicit opt-in, disposable workspaces and outputs, bounded execution, and redacted operation-keyed receipts. External unavailability is uncertainty, not a quality failure.

**Why:** Provider and side-effect lanes are useful for empirical evidence but must never overwrite release artifacts, mutate production execution paths, or become a required deterministic gate.

**How to apply:** Keep deterministic release checks provider-free. Require each live lane and any deployment or remote-delivery side effect to be independently enabled and reviewable.