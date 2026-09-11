---
name: Live revision identity mismatch
description: The live dashboard correlation check currently conflates Git commit identity with the scanner's content-inventory revision.
---

The live dashboard journey can report a false correlation failure even after a complete real scan: the dashboard's workspace revision is a short Git commit hash, while the scanner's project revision is a full digest of the scanned file inventory and contents. A disposable Git worktree and a completed scan therefore do not make those values equal.

**Why:** A controlled OpenRouter run reached provider calls, tool activity, fallback, and a complete scan, but the release report still rejected the candidate solely because it compared these two different revision domains.

**How to apply:** Keep the identities separate in mission reports and validate each against its owning source. If cross-binding is required, include an explicit mapping or shared server-owned operation/revision record rather than rewriting either value.