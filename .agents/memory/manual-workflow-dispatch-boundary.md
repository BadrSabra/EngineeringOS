---
name: Manual workflow dispatch boundary
description: Verify GitHub's default branch and remote commit before dispatching a workflow prepared locally.
---

Before a manual GitHub Actions dispatch, verify the workflow exists on the remote default branch and the selected ref exists remotely. A local Replit commit is not dispatchable merely because its workflow file is present in the workspace.

**Why:** A one-run authorization does not authorize publishing an unrelated local commit stack to the default branch; doing so can turn a test request into a broad repository change.

**How to apply:** Use read-only remote checks first. If the workflow or ref is absent, do not push or merge; ask for a separate publication decision before any remote write.
