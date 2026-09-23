---
name: Skill registry Gate 4
description: Gate 4 registration depends on the persisted paired-baseline result, not merely shadow replay validator success.
---

The skill registry must fail closed unless the durable shadow replay receipt contains an identity-bound paired baseline with `status: passed` and `promotionAllowed: true`.

**Why:** A shadow replay can complete with a PROVEN validator result while its paired benchmark remains incomplete. Treating validator success as promotion evidence would bypass the Gate 3 baseline requirement.

**How to apply:** Keep registry scoring server-derived from the stored replay receipt. Tests that cover approval/revocation should assert the real incomplete rejection first, then use an explicitly marked server-owned passing receipt fixture for the lifecycle branch.