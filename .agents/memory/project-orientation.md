---
name: Project orientation responses
description: Durable guidance for user-facing answers to “explain this project” requests.
---

Project-orientation answers must be written as functional explanations rather than code inventories: lead with the product purpose, group the main components by role, describe the primary flow, and finish with only a few relevant indicators.

**Why:** The knowledge graph contains useful navigation evidence but is too technical and too noisy to serve as a project explanation by itself; raw IDs, revisions, scan metadata, and exhaustive entity lists made otherwise successful answers confusing.

**How to apply:** Use a presentation-safe prompt context for orientation turns that removes server-owned metadata while preserving the raw context for forensic and operational prompts. If the available evidence cannot establish the project’s purpose, say so and request targeted source reads instead of inferring from framework or filenames.

Orientation explanations also need a bounded, role-based source manifest covering purpose, components, primary flow, and uncertainty. Accept the explanation only when every role has a complete read; otherwise emit an explicit incomplete result and preserve the missing-role coverage in the execution projection.

**Why:** Graph-selected files and provider prose can produce a plausible inventory without proving how the project works. A role-level complete-read gate prevents that inventory from being presented as a functional explanation.

**How to apply:** Keep role selection in the existing query-planner/prefetch path, derive completion from server-owned read statuses, and carry the bounded coverage record through the trace, history, and execution projection. 

Provider failure after partial orientation reads is still an incomplete orientation
result on every transport. The route must derive source-evidence-required from the
server-owned orientation decision separately from `TurnIntent.requiresEvidence`,
because ordinary orientation intentionally remains a low-risk `PROJECT_QUERY`.

**Why:** SSE already used the orientation execution flag, but the non-streaming
route could otherwise classify the same retained partial reads as a generic provider
failure and lose the orientation acceptance contract.

**How to apply:** Reuse the existing orientation detector/resumable flag in both
routes, feed it into terminal classification and retained-evidence failure
projection, and do not add a citation or provider-prose gate.