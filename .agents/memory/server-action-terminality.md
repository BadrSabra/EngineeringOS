---
name: Server-action terminality
description: Server-owned actions must not publish success before their durable job reaches a terminal state.
---

A server-owned chat action may persist the user turn as pending or leave its outcome unset while queued/running; only the terminalizer may publish SUCCEEDED or FAILED after the durable job result is authoritative.

**Why:** The project-scan chat path recorded the user message as SUCCEEDED while the scan was only queued, leaving history able to report success before completion and without the normal execution/acceptance identity.

**How to apply:** Bind the action to one durable execution/job identity, persist a non-terminal checkpoint first, and update the user/assistant/history projections atomically with the terminal outcome. Reconnect must read that same identity.