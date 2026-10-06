---
name: Skill registry Gate 4
description: Gate 4 registration depends on the persisted paired-baseline result, not merely shadow replay validator success.
---

The skill registry must fail closed at registration and approval unless:

- The durable shadow replay receipt contains an identity-bound paired baseline with `status: passed` and `promotionAllowed: true`.
- Canonical Proof reloaded from current execution, acceptance, and evidence rows accepts both the source candidate and replay, with the acceptance IDs and replay trajectory bound to the receipt.
- Registration and approval independently bind the receipt to the current proposal, change set, candidate workspace bytes, replay execution, and attempt; both recheck current Mission/Goal authorization, active plan revision, and complete dependency proof.
- Approval performs these checks in the same transaction before superseding an existing promoted version or promoting the pending row. Already-promoted approval retries repeat the checks before returning state.

GET and idempotent replay POST may expose the stored receipt as historical metadata, but now return `receiptProofFreshness` after reloading current source and replay proof, scope, and attempt bindings. `STALE` does not remove the receipt or mutate the replay row; both response paths remain presentation only and never authorize a registry decision.

**Why:** A shadow replay can complete with a PROVEN validator result while its paired benchmark remains incomplete. Also, matching receipt and replay-row IDs did not prove that the stored replay acceptance and evidence snapshot belonged to the execution's current attempt; a regression test found registration still returned 201 under that mismatch.

For an already-completed Goal, Missions in `active`, `waiting`, or `completed` remain eligible if the active plan revision still matches. `draft`, `blocked`, `needs_replan`, `failed`, and `cancelled` Missions are not authorized; every dependency must remain completed with current proof. Newly produced registry receipts use contract version 2 and bind replay operation ID, change-set hash, and execution attempt; older receipt shapes fail closed.

**Why:** A shadow replay can complete with a PROVEN validator result while its paired benchmark remains incomplete. Matching receipt and replay-row IDs also did not prove that the replay attempt, candidate bytes, Mission authority, or dependency closure were still current at either decision boundary.

**How to apply:** Keep GET and idempotent replay POST freshness projections aligned, but never use their `CURRENT` marker as proof authority. At registration and every approval, independently reload and validate source-candidate and replay Canonical Proof, match their identities and attempts to the durable receipt, recheck current Mission/Goal/dependency state, and recompute the paired-baseline score before inserting or promoting. Test stale receipt display separately from rejection at both decision boundaries.