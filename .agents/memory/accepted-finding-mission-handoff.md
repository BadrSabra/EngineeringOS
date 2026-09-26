---
name: Accepted finding Mission handoff
description: Constraints for converting an accepted generic project query into an optional durable Mission.
---

An accepted finding may seed a Mission only after resolving the persisted assistant message, execution, current-attempt acceptance, Canonical Proof, evidence snapshot, and exact canonical generic PROJECT_QUERY objective from server-owned rows. The accepted claim refs must equal the canonical required-claim set. Preview remains non-persistent; explicit handoff re-resolves the source and requires the reviewed plan hash. Materialized finding text is user-reviewed context, never proof or mutation authority.

**Why:** The `PROJECT_QUERY` intent also covers forensic and broad-audit flows, while provider prose or claim-looking IDs are not acceptance authority. Mission planning may also discard transient prompt context unless the approved finding is carried into the durable objective.

**How to apply:** Reuse the canonical generic-objective validator and existing acceptance/runtime gates. Keep ordinary chat and non-generic project analyses out of this handoff; preserve the existing approval and validation rules for all future Mission changes.