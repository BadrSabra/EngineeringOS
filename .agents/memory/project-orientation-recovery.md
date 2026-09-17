---
name: Project orientation recovery
description: The recovery distinction between general project orientation and targeted proof queries.
---

General project-orientation PROJECT_QUERY turns carry a server-owned proof/evidence contract, but a provider failure before the first source read may still resume the same execution. Targeted claim queries remain incomplete until their objective evidence is closed.

**Why:** Orientation has no targeted claim closure to preserve, while targeted project queries must not be accepted or resumed as if provider failure had already produced their required evidence.

**How to apply:** Keep orientation marked proof-bound and resumable through the durable execution contract; do not reuse this exception for embedded-AI, gap-analysis, or other targeted PROJECT_QUERY failures.

Live OpenRouter validation should use an explicit orientation request together with the server-owned resumed intent/state. Tool-calling success alone is insufficient: free models can read the manifest successfully but still emit malformed or behavior-oriented synthesis.

**Why:** A bounded live run demonstrated that the durable manifest and orientation coverage can complete even when a provider's generic synthesis is rejected; an explicit orientation prompt produced an accepted result without changing the recovery contract.

**How to apply:** Treat provider/model acceptance as a separate gate after checking manifest reuse, role coverage, and bounded tool activity.