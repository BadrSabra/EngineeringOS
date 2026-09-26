---
name: Runtime restart validation
description: API workflow runs compiled output, so source fixes need one workflow restart before live-session conclusions.
---

The running API process serves its compiled bundle; changing orchestrator source does not change an active session until the API workflow is rebuilt and restarted.

**Why:** A live session can reproduce a bug that the source tree already fixes, producing a false negative or an invalid diagnosis when the process start predates the patch.

**How to apply:** Before validating an AI-session fix, compare process/build timing, restart the managed API workflow once after the batch, then run the Arabic journey and inspect durable execution, acceptance, evidence, SSE, history, and Dashboard projections together.

An artifact dashboard workflow can report a port-in-use failure while an existing Vite process still serves the preview.

**Why:** A duplicate managed start can fail with `EADDRINUSE` while the original dashboard process remains healthy; stopping that listener without checking can take down the working preview.

**How to apply:** Identify the port owner and probe the artifact preview before restarting. Leave a serving Vite process in place; restart the exact artifact workflow only when replacement is safe, and do not change Vite ports to work around a duplicate.

An API workflow marked failed may still have an old server child or listener alive. Workflow status alone does not establish whether the API is serving or which process owns its port.

**Why:** An API startup reported `EADDRINUSE` while a local health request still succeeded; restarting the managed API workflow replaced the stale process and started cleanly.

**How to apply:** For API port conflicts, verify the listener owner and health endpoint before changing code or starting another server. Restart the exact artifact workflow once, then confirm the replacement process and health response.