---
name: CodeExecution connector boundary
description: Preserve Replit integration connection methods across CodeExecution calls.
---

Create and use integration connection objects inside the same `"use impure"` function. Do not pass a connection object into another impure function: serialization can strip methods such as `proxyFetch`.

**Why:** Passing a connection object across an impure-function boundary caused `proxyFetch is not a function`; using it in the same impure function worked.

**How to apply:** Use one small impure function for `listConnections()` and its related requests, then return only serializable response data.
