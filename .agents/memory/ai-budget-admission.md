---
name: AI budget admission
description: Provider-attempt budget enforcement shared by chat, task, analysis, and recovery paths.
---

Provider-attempt admission must happen before each server-selected provider fallback call, using the existing project budget reservation ledger. Each reservation also holds a conservative token estimate; known usage is charged from telemetry, while unknown/partial usage consumes the estimate instead of becoming zero.

**Why:** A durable budget table and reconciliation hook do not protect the system if admission is only recorded after provider work or is omitted from the central fallback helpers. Unknown provider usage must not silently bypass the token limit.

**How to apply:** Keep admission and provider-attempt reconciliation in the shared AI route helpers, bind both to the project and unique provider-attempt identity, and preserve the typed `AI_BUDGET_EXHAUSTED` response path. Keep token accounting separate from attempt counting.

Consumed reservations remain the attempt ledger even when best-effort usage
telemetry is missing. Count telemetry-only attempts only when no reservation
matches; count reserved and consumed rows by admission day so an event and its
reservation are never double-counted. Without a durable usage event, retain at
least the conservative token estimate and project usage as unknown.

**Why:** Telemetry persistence intentionally cannot block a successful AI
response. If budget accounting depends on that write, a consumed reservation
can disappear from attempt limits or make token usage look known when it is not.

**How to apply:** Use the reservation's attempt identity and UTC admission day
as the durable accounting key. A durable known usage event replaces its
conservative charge; a missing or partial event does not.

Reservation identity must include the intended budget unit and durable attempt
generation when work can resume. Reusing a matching reservation is only
idempotent for that same admitted attempt; resumed provider work must not reuse
an earlier reservation merely because correlation, provider, and candidate
index are unchanged. Consumed work must remain in daily attempt accounting even
if best-effort usage telemetry could not be persisted.

**Why:** A resumed candidate can otherwise bypass fresh admission, and a
consumed reservation disappears from attempt totals when its telemetry row is
missing. An estimate based on caller payload bytes is not the final provider
prompt and does not pre-admit each physical request made by retries or internal
model fallbacks; later usage events cannot prevent within-candidate overrun.

**How to apply:** Treat each physical outbound provider request as the spend
unit. Caller-payload estimates are only an upstream screening bound; do not
claim per-request enforcement until every transport, including internal
retries and model fallbacks, obtains a unique reservation before network I/O
and reconciles its own known or unknown usage.