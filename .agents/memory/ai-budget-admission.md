---
name: AI budget admission
description: Provider-attempt budget enforcement shared by chat, task, analysis, and recovery paths.
---

Provider-attempt admission must happen before each server-selected provider fallback call, using the existing project budget reservation ledger. Each reservation also holds a conservative token estimate; known usage is charged from telemetry, while unknown/partial usage consumes the estimate instead of becoming zero.

**Why:** A durable budget table and reconciliation hook do not protect the system if admission is only recorded after provider work or is omitted from the central fallback helpers. Unknown provider usage must not silently bypass the token limit.

**How to apply:** Keep admission and provider-attempt reconciliation in the shared AI route helpers, bind both to the project and unique provider-attempt identity, and preserve the typed `AI_BUDGET_EXHAUSTED` response path. Keep token accounting separate from attempt counting.

Reservation identity must include the intended budget unit and durable attempt
generation when work can resume. Reusing a matching reservation is only
idempotent for that same admitted attempt; resumed provider work must not reuse
an earlier reservation merely because correlation, provider, and candidate
index are unchanged. Consumed work must remain in daily attempt accounting even
if best-effort usage telemetry could not be persisted.

**Why:** A resumed candidate can otherwise bypass fresh admission, and a
consumed reservation disappears from attempt totals when its telemetry row is
missing. One outer provider-candidate reservation does not pre-admit each
physical provider request made by tools, retries, or synthesis; later usage
events may count those calls, but cannot prevent within-candidate overrun.

**How to apply:** Choose and document whether limits apply per HTTP invocation,
durable execution attempt, or physical provider request. Bind reservation
identities to that unit, count consumed reservations independently of telemetry
success, and reconcile token usage across every provider call or mark totals
partial/unknown.