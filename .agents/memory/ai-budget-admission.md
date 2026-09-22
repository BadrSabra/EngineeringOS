---
name: AI budget admission
description: Provider-attempt budget enforcement shared by chat, task, analysis, and recovery paths.
---

Provider-attempt admission must happen before each server-selected provider fallback call, using the existing project budget reservation ledger. Each reservation also holds a conservative token estimate; known usage is charged from telemetry, while unknown/partial usage consumes the estimate instead of becoming zero.

**Why:** A durable budget table and reconciliation hook do not protect the system if admission is only recorded after provider work or is omitted from the central fallback helpers. Unknown provider usage must not silently bypass the token limit.

**How to apply:** Keep admission and provider-attempt reconciliation in the shared AI route helpers, bind both to the project and unique provider-attempt identity, and preserve the typed `AI_BUDGET_EXHAUSTED` response path. Keep token accounting separate from attempt counting.