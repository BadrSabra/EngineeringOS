---
name: Project-query synthesis references
description: The proof-carrying response boundary for natural-language project-query synthesis.
---

Targeted project-query providers may return natural prose with `claimRefs` and ordered `flowRefs`. These references identify the server-owned claims the prose asserts; they do not create evidence or bypass objective closure. Canonical claim wording remains the compatibility fallback for older prose-only responses.

**Why:** Requiring exact canonical claim text makes Arabic and other natural-language answers fail even when retained source evidence is complete, while trusting provider references alone would weaken proof.

**How to apply:** Validate reference completeness and flow shape against the persisted objective, then pass only accepted claim IDs into server-owned evidence closure. Keep evidence materialization, objective gates, and public projections independent from provider-authored wording.

For bounded no-tools synthesis, persist attempt ID, evidence-manifest ID, contract result, and output hash in the final assistant message trace. The response and terminal bindings repeat the selected attempt/manifest IDs and hash the final response. The existing acceptance row links that same final message to its evidence snapshot; this is sufficient for attempt-to-snapshot association without a second attempt table.

**Why:** Attempt telemetry is emitted before final acceptance creates the snapshot, so a direct snapshot foreign key is unavailable at synthesis time. The final message is already the durable join point for both the bounded trace and acceptance.

**How to apply:** Preserve opaque IDs and hashes through the safe trace projection, then verify `execution.finalMessageId = acceptance.messageId` and follow `acceptance.evidenceSnapshotId`. Add durable schema only if attempts later need independent querying or replay lifecycle beyond the accepted message.