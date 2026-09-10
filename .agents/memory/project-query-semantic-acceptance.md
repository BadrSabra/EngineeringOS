---
name: Project-query semantic acceptance
description: The acceptance boundary for proof-required project questions
---

For a proof-required `PROJECT_QUERY`, complete retained source reads are necessary but never sufficient for success. The execution must also carry project-query analysis evidence with accepted claims and a verified objective verdict; generic operation evidence must not be used as a fallback. Capability Probe contracts are a separate exception and keep their own gate.

**Why:** A blocked/no-answer analysis once had complete reads and was incorrectly persisted as `PROVEN/SUCCEEDED` because the generic acceptance path treated `source-read:*` references as proof.

**How to apply:** Keep the semantic gate in the durable completion path, and add regression coverage for complete reads with `OBJECTIVE_BLOCKED` plus a positive Capability Probe case.