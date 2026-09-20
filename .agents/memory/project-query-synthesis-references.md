---
name: Project-query synthesis references
description: The proof-carrying response boundary for natural-language project-query synthesis.
---

Targeted project-query providers may return natural prose with `claimRefs` and ordered `flowRefs`. These references identify the server-owned claims the prose asserts; they do not create evidence or bypass objective closure. Canonical claim wording remains the compatibility fallback for older prose-only responses.

**Why:** Requiring exact canonical claim text makes Arabic and other natural-language answers fail even when retained source evidence is complete, while trusting provider references alone would weaken proof.

**How to apply:** Validate reference completeness and flow shape against the persisted objective, then pass only accepted claim IDs into server-owned evidence closure. Keep evidence materialization, objective gates, and public projections independent from provider-authored wording.