---
name: Runtime restart validation
description: API workflow runs compiled output, so source fixes need one workflow restart before live-session conclusions.
---

The running API process serves its compiled bundle; changing orchestrator source does not change an active session until the API workflow is rebuilt and restarted.

**Why:** A live session can reproduce a bug that the source tree already fixes, producing a false negative or an invalid diagnosis when the process start predates the patch.

**How to apply:** Before validating an AI-session fix, compare process/build timing, restart the managed API workflow once after the batch, then run the Arabic journey and inspect durable execution, acceptance, evidence, SSE, history, and Dashboard projections together.

Managed Vite dashboard workflows can report a stale port-in-use failure even when the application code is healthy; restarting the artifact-owned workflow and running the dashboard restart smoke check clears this condition.

**Why:** A previous dashboard start failed only because an old listener occupied the assigned port; the managed restart and isolated replacement-process check both passed afterward.

**How to apply:** Treat a port-only dashboard startup failure as a workflow lifecycle issue first. Restart the exact artifact workflow and verify the replacement listener rather than changing Vite port configuration.

An API workflow marked failed may still have an old server child or listener alive. Workflow status alone does not establish whether the API is serving or which process owns its port.

**Why:** An API startup reported `EADDRINUSE` while a local health request still succeeded; restarting the managed API workflow replaced the stale process and started cleanly.

**How to apply:** For API port conflicts, verify the listener owner and health endpoint before changing code or starting another server. Restart the exact artifact workflow once, then confirm the replacement process and health response.