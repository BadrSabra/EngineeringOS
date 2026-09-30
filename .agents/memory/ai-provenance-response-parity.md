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

For cross-provider PROJECT_QUERY synthesis, the accepted synthesis provider—not the provider that performed the tool loop—owns the final response identity. Keep route outcome and `resolvedModel` aligned; if the accepted model is unknown, do not pair the fallback provider with the earlier provider's model ID.

**Why:** A provider may acquire evidence successfully and fail only at synthesis, after which another authorized provider supplies the answer. Reporting the first provider as the answer source misstates provenance.

**How to apply:** Capture accepted synthesis identity in server-owned state and use it for effective-provider telemetry and response projections; use only the model ID reported by the accepted synthesis call.

Delivery projections must remain visible on the persisted assistant message after a successful terminal event clears the active execution panel. The message/history view should render the server-owned stage projection, not derive milestone state from response text or run status.

**Why:** A correct SSE and history payload can still appear to lose delivery state if the UI only renders the temporary active-execution projection; execution completion can precede push or other delivery milestones.

**How to apply:** For delivery turns, compare execution-detail and message-history stage statuses across reconnect and reload, and render the persisted projection read-only when the active execution panel is gone.