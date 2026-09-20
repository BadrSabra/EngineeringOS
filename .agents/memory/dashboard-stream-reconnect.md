---
name: Dashboard stream reconnect
description: The dashboard's transient SSE recovery boundary for durable AI executions.
---

Transient browser stream loss may retry the same server-owned execution, but it must never create a second user turn or infer a successful terminal result. Automatic reconnect and manual Resume are mutually exclusive for each execution.

**Why:** The durable execution can outlive the browser connection, while an unbounded client retry can duplicate work or hide a terminal failure.

**How to apply:** Keep reconnect bounded and keyed to the existing execution identity. Guard both reconnect paths by execution ID, cancel queued automatic work before manual Resume, stop retrying on terminal outcomes, and let server-owned terminal state determine the final UI.

Reconnect requests must preserve the original raw turn message and server-owned binding metadata; a changed continuation can be rejected as `EXECUTION_BINDING_MISMATCH` before terminal-state handling. A transport reset is emitted only after the stream has produced its first delta.

**Why:** Binding validation intentionally runs before the terminal resumability check, and an inactive stream has no partial client bubble to reset.

**How to apply:** Reuse the original request identity during automatic reconnect, and make transport fixtures emit a partial delta before invoking the reset callback.