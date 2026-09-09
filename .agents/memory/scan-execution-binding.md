---
name: Scan execution binding
description: Durable identity and terminality rules for server-owned project scans.
---

Server-owned project scans are executions, not ordinary chat replies: reserve the durable execution before queueing, keep the user turn non-terminal while the job is queued or running, and let the authoritative scan result finalize both the assistant message and acceptance.

**Why:** A scan that succeeds at queue time can leave history claiming success after a later job failure, and an SSE reconnect can otherwise create a duplicate scan with a different identity.

**How to apply:** Carry one operation identity through the execution request, scan job, SSE frames, history message, and acceptance. On reconnect, replay the terminal result or follow the existing job; never create a second job for an existing execution.