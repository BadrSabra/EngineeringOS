---
name: Delivery promotion policy
description: Project-owner consent gates automatic promotion while candidate eligibility remains server-owned and apply-only.
---

Automatic delivery promotion is opt-in per project, recorded as an owner-approved policy, and rechecked immediately before any live promotion. The policy does not authorize arbitrary writes or override candidate integrity, validation, scope, recovery, or cancellation gates.

**Why:** Reducing approval clicks is safe only when consent is durable and the existing guarded apply path remains the sole writer.

**How to apply:** Add new automation behind the existing policy and promotion decision; never let model output, repository text, or a client boolean grant write authority.