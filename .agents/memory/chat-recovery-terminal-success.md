---
name: Chat recovery terminal success
description: Success criteria for the server-side chat recovery runner that invokes an SSE handler internally.
---

An internal chat recovery cannot treat HTTP 2xx as proof of successful execution: the SSE handler can emit a terminal acceptance error and persist a failed execution while the transport status remains 200. After the handler returns, reload the execution and require the expected newly claimed attempt to be durably `completed` before reporting recovery success.

**Why:** The internal response sink discards SSE chunks and only sees the HTTP status. A proof-incomplete PROJECT_QUERY can therefore look successful to the recovery coordinator even though durable acceptance failed.

**How to apply:** Preserve explicit HTTP rejection handling, then verify the durable execution's attempt and terminal status. Keep tests for both failed proof acceptance over HTTP 200 and a genuinely completed recovery.
