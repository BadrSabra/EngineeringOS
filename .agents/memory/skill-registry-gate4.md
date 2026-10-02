---
name: Skill registry Gate 4
description: Gate 4 registration depends on the persisted paired-baseline result, not merely shadow replay validator success.
---

The skill registry must fail closed at registration and approval unless:

- The durable shadow replay receipt contains an identity-bound paired baseline with `status: passed` and `promotionAllowed: true`.
- Canonical Proof reloaded from current execution, acceptance, and evidence rows accepts both the source candidate and replay, with the acceptance IDs and replay trajectory bound to the receipt.
- Approval performs these checks in the same transaction before superseding an existing promoted version or promoting the pending row.

GET and idempotent replay POST may expose a stored receipt after the replay's current Canonical Proof has become invalid. Treat those responses as presentation only: GET does no proof refresh, and replay POST refreshes the source-candidate proof but may reuse the completed replay receipt. Already-promoted approval retries return stored state without making a new promotion decision.

**Why:** A shadow replay can complete with a PROVEN validator result while its paired benchmark remains incomplete. Also, matching receipt and replay-row IDs did not prove that the stored replay acceptance and evidence snapshot belonged to the execution's current attempt; a regression test found registration still returned 201 under that mismatch.

**How to apply:** At registration and pending approval, reload and validate source-candidate and replay Canonical Proof, then match their acceptance IDs and replay trajectory to the durable receipt. Recompute the paired-baseline score before scoring, inserting, or promoting. Never use GET or idempotent replay POST responses as proof authority. Tests should cover stale-receipt display separately from stale-proof rejection at each decision boundary.