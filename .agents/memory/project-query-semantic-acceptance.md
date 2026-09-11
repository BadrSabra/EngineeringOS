---
name: Project-query semantic acceptance
description: The acceptance boundary for proof-required project questions
---

For a proof-required `PROJECT_QUERY`, complete retained source reads are necessary but never sufficient for success. The execution must also carry project-query analysis evidence with accepted claims and a verified objective verdict; generic operation evidence must not be used as a fallback. Capability Probe contracts are a separate exception and keep their own gate.

**Why:** A blocked/no-answer analysis once had complete reads and was incorrectly persisted as `PROVEN/SUCCEEDED` because the generic acceptance path treated `source-read:*` references as proof.

**How to apply:** Keep the semantic gate in the durable completion path, and add regression coverage for complete reads with `OBJECTIVE_BLOCKED` plus a positive Capability Probe case.

Gap-analysis project queries use a server-owned `gap-analysis` target with bounded
source paths and required claims. This keeps generic "what gaps remain?" requests
on the `PROJECT_QUERY` contract without accepting an unscoped answer.

**Why:** Requiring proof without an objective correctly blocked false success, but
left generic gap questions unable to produce a valid successful analysis.

**How to apply:** Preserve the target/objective binding through session state,
SSE, history, and acceptance; broad audit wording must still require explicit
scope rather than silently becoming a targeted gap query.