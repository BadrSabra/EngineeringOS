---
name: Objective claim closure
description: Failure mode after complete bounded evidence collection when project-query claims remain response-bound but the final projection loses closure.
---

For `PROJECT_QUERY_*`, complete server-owned evidence windows are necessary but not sufficient: every required behavioral claim must remain closed through synthesis, language normalization, behavior-evidence materialization, and the final objective gate.

**Why:** A real Arabic embedded-AI run collected complete bounded windows for all declared paths and preserved execution/operation/revision identity, but final acceptance still failed because the response-bound claim projection did not survive to closure.

**How to apply:** When acquisition is complete but acceptance is blocked, inspect per-claim closure after the final response projection before changing evidence scheduling. Server-owned deterministic synthesis may establish the claim text and flow, but it must remain authoritative through later validation and must never be replaced by a generic blocked response.