---
name: AI budget admission
description: Provider-attempt budget enforcement shared by chat, task, analysis, and recovery paths.
---

Provider-attempt admission must happen before each server-selected provider fallback call, using the existing project budget reservation ledger. Telemetry reconciliation remains responsible for consuming the reservation after the attempt is recorded.

**Why:** A durable budget table and reconciliation hook do not protect the system if admission is only recorded after provider work or is omitted from the central fallback helpers.

**How to apply:** Keep the reservation call in the shared AI route helpers, bind it to the project and unique attempt identity, and preserve the existing typed `AI_BUDGET_EXHAUSTED` response path. Token-limit reservation is a separate follow-up and must not be approximated as attempt counting.