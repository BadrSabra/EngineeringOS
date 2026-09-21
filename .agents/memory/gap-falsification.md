---
name: Gap falsification
description: Server-owned counterevidence rules for project gap analysis
---

Gap analysis must treat a provider-reported weakness as a candidate, not a verdict. Before confirming it, run bounded checks for an alternative adapter or recovery path, test counterevidence, and an implementation behind another interface. Search results alone are not evidence; matching source bodies must be read. Missing probes or missing explicit negative source evidence produce `UNPROVEN`. Direct implementation counterevidence produces `CONTRADICTED`; tests without production coverage produce `PARTIALLY_COVERED`.

**Why:** Absence from the first implementation file and provider prose both produced false-positive gap reports when alternative paths were not checked.

**How to apply:** Keep probes derived from the existing project-query objective and allowed scope. Recompute classifications server-side and project them into JSON/SSE/history through the same deterministic synthesis path; never let model text override them.