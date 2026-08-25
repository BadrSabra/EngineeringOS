---
name: Dashboard freshness watermarks
description: Cross-session dashboard snapshots use server-owned revisions to reject delayed older responses.
---

Dashboard summaries need a server-owned monotonic watermark assembled from the authenticated data they contain; request arrival time is not a safe freshness signal after reconnects.

**Why:** A delayed response from an earlier read can arrive after a newer refresh and otherwise roll the operator’s visible readiness and recovery state backward.

**How to apply:** Include the watermark in aggregated responses and keep the newest revision visible at the client boundary; use entity update timestamps for project and task lists.