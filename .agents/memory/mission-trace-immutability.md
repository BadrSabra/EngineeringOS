---
name: Mission Trace immutability
description: Preserve content-addressed pre-dispatch decision traces while validating later lifecycle events.
---

Keep the persisted Decision Trace unchanged after its decision ID has been hashed. The initial Trace may include `PROPOSED`, `EVALUATED`, and `SELECTED`; later approval, plan-application, and dispatch references belong in the durable lifecycle event chain.

**Why:** Adding a persisted dispatch reference to the Trace changes its contents and correctly invalidates the original decision ID. The event table is the authoritative record for lifecycle stages appended after the decision.

**How to apply:** For outcome evaluation or recovery, load the canonical Trace and the complete persisted event chain in one consistent transaction. Verify that the event chain's initial stages match the Trace, then bind later references to the active plan and exact dispatch manifest. Never rewrite the Trace or synthesize a new decision ID to make the chain fit.
