---
name: Capability parity objectives
description: Durable boundary for comparing project capabilities with an external parity baseline.
---

Capability-parity audits are a profile of the existing project-query gap objective, not a
second objective compiler or execution-capability catalog. The server-owned, versioned
parity baseline is the source for comparison items, statuses, priorities, dependencies,
acceptance criteria, and explicit unknowns; the profile derives claims from it dynamically.

**Why:** The project already has target resolution, compound planning, objective closure, and
capability execution policy. Duplicating those layers would create conflicting routing and
acceptance semantics.

**How to apply:** Reuse the existing gap target, evidence gates, and resumable objective
state. Keep Markdown reports as human-readable evidence context, not a second machine
contract. A `VERIFIED_GAP` needs source evidence, a capability criterion, and an observable
missing or failing outcome. Keep `UNVERIFIED_RISK`, `UNKNOWN`, provider availability, and
intentional product boundaries separate from confirmed gaps.