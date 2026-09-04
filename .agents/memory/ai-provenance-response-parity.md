---
name: AI provenance response parity
description: Public context provenance must remain identical across live and persisted AI response surfaces.
---

For a completed AI turn, the non-stream JSON envelope and nested message, SSE done envelope and nested message, persisted tool trace, and history response must all expose the same server-owned context provenance projection.

**Why:** A consumer can receive one surface during the live request and another after reconnect or reload; a missing nested field or a different projection makes the dashboard appear to lose context even when the run was saved correctly.

**How to apply:** Build the projection once from the server context, attach it to every public live message/envelope, append the same value to the persisted trace, and parse that trace through the same allowlisted schema for history. Keep absolute citations and provider diagnostics out of every surface.