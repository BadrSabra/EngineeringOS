---
name: AI provenance response parity
description: Public context provenance must remain identical across live and persisted AI response surfaces.
---

For every terminal AI turn, including failed or interrupted runs, the non-stream JSON envelope and nested message, SSE error/done envelope and nested message, persisted tool trace, and history response must all expose the same server-owned context and response-source provenance projections.

**Why:** A consumer can receive one surface during the live request and another after reconnect or reload; a missing nested field or a different projection makes the dashboard appear to lose context or fallback provenance even when the run was saved correctly. Failures and cancellations are especially likely to bypass the normal success serializer.

**How to apply:** Build each projection once from server-owned state, attach it to every public live message/envelope, append only bounded values to the persisted trace, and parse that trace through the same allowlisted schema for history. Keep absolute citations and provider diagnostics out of every surface.

At the SSE boundary, keep the bounded `PROJECT_QUERY_RESPONSE_SOURCE` diagnostic in the trace as well as the typed result fields; trace-derived projection is the compatibility path used by streamed and persisted surfaces.

**Why:** A route fixture that populated only the typed result fields still omitted fallback provenance from the SSE done message, while the same route correctly projected it once the server-owned trace diagnostic was present.

**How to apply:** When adding or testing a new response-source value, emit the allowlisted source diagnostic before terminal serialization and assert the nested message, envelope, and history projections.