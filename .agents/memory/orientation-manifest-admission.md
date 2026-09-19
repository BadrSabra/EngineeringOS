---
name: Orientation manifest admission
description: Durable guardrails for source-backed project orientation and its retry behavior
---

Required project-orientation evidence must not admit a planner/model-selected path until it is confirmed to exist under the server-owned managed root. A syntactically valid relative path can still be stale or nonexistent; if it enters a required role, one failed read correctly makes the proof incomplete but can unnecessarily sink the whole orientation.

**Why:** A missing uncertainty-role source caused an otherwise broad read set to finish with `PARTIAL`, zero accepted claims, and a non-resumable incomplete acceptance. The UI then attempted resume based on the orientation shape even though the server-owned disposition required a new run.

**How to apply:** Validate or replace required-role candidates before durable scope persistence, preserve fail-closed behavior when no valid replacement exists, and make retry UI follow `resumable` plus `nextActionCode` from the acceptance projection. `REVIEW_INCOMPLETE_EVIDENCE` / `START_NEW_RUN` must not call the resume-capability endpoint.