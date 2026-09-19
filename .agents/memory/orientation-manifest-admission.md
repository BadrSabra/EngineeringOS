---
name: Orientation manifest admission
description: Durable guardrails for source-backed project orientation and its retry behavior
---

Each orientation role needs at least one server-observed complete read; supplemental candidates may fail or be skipped without invalidating the role. Planner/model-selected paths still must be preflighted against the server-owned managed root because a syntactically valid relative path can be stale or nonexistent.

**Why:** A missing uncertainty-role source caused an otherwise broad read set to finish with `PARTIAL`, zero accepted claims, and a non-resumable incomplete acceptance. The UI then attempted resume based on the orientation shape even though the server-owned disposition required a new run.

**How to apply:** Validate or replace required-role candidates before durable scope persistence, preserve fail-closed behavior when no valid candidate remains for a role, and make retry UI follow `resumable` plus `nextActionCode` from the acceptance projection. `REVIEW_INCOMPLETE_EVIDENCE` / `START_NEW_RUN` must not call the resume-capability endpoint.