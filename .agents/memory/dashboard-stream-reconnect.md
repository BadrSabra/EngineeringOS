---
name: Dashboard stream reconnect
description: The dashboard's transient SSE recovery boundary for durable AI executions.
---

Transient browser stream loss may retry the same server-owned execution, but it must never create a second user turn or infer a successful terminal result. Automatic reconnect and manual Resume are mutually exclusive for each execution.

**Why:** The durable execution can outlive the browser connection, while an unbounded client retry can duplicate work or hide a terminal failure.

**How to apply:** Keep reconnect bounded and keyed to the existing execution identity. Guard both reconnect paths by execution ID, cancel queued automatic work before manual Resume, stop retrying on terminal outcomes, and let server-owned terminal state determine the final UI.