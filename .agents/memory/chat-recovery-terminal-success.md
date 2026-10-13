---
name: Chat recovery terminal success
description: Success criteria for the server-side chat recovery runner that invokes an SSE handler internally.
---

An internal chat recovery cannot treat HTTP 2xx as proof of successful execution: the SSE handler can emit a terminal acceptance error and persist a failed execution while the transport status remains 200. After the handler returns, reload the execution and require the expected newly claimed attempt to be durably `completed` before reporting recovery success. For generic project queries, the server may regenerate the objective from the current turn contract rather than persist it in the request; acceptance must use that effective objective.

**Why:** The internal response sink originally discarded SSE chunks and only saw the HTTP status. Separately, the streaming recovery path could derive the correct project-query objective for the model but pass the absent persisted objective into the final evidence gate, producing `NOT_RECORDED` despite complete reads.

**How to apply:** Preserve explicit HTTP rejection handling, use the server-derived effective objective for parse-failure and terminal evidence acceptance, then verify the durable execution's attempt and terminal status. Keep tests for both failed proof acceptance over HTTP 200 and a genuinely completed recovery.
