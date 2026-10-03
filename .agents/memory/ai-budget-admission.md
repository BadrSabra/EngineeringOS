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
conservative charge; a missing or partial event does not. Catch reconciliation
and telemetry persistence failures at their boundaries so they cannot enter
provider retry or fallback classification.

The globally unique reservation ID is the durable identity for one physical
provider request across retries and resumed executions. Both reservation and
usage telemetry use that ID; telemetry also retains `executionId` for grouping
the request into its execution generation. Every outbound retry or fallback
must receive a fresh UUID-bearing attempt ID.

**Why:** Correlation, provider, and candidate indexes can repeat after resume,
but a fresh physical-request ID prevents that work from reusing an earlier
reservation. A separate generation column is unnecessary while all transports
preserve this unique reservation-to-telemetry binding.

**How to apply:** Reserve immediately before each outbound provider request,
reconcile the returned usage against the same ID, and persist that ID with
`executionId`. If a transport ever reuses IDs across executions or omits the
reservation ID from telemetry, revisit the schema-level generation binding.