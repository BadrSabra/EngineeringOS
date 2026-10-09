---
name: Durable acceptance resume attempt rotation
description: Resume-token issuance and execution-attempt rotation must remain separate so each accepted retry gets one historical acceptance.
---

Advance the execution attempt only when a valid resume token is atomically consumed by a worker claim; issuing or rotating a token alone must not create the next attempt.

**Why:** Recovery endpoints can issue a token before a worker claims it. Incrementing there and again during claim creates skipped or duplicate attempt identities; an execution-only acceptance lookup can also mistake an older failed attempt for the current result.

**How to apply:** Keep the previous acceptance immutable, validate resumability before issuing the token, and let the successful claim establish the new attempt before any terminal finalization—including automatic recipe recovery after lease-expired reconciliation, before writing new evidence. When checking recovered proof, match the acceptance to the execution's current attempt; an execution-only query can return an older failed acceptance and misstate the current result.

A successful token claim must replace the stored token hash with an unreleased hash in the same transaction that advances the attempt. Recheck the current-attempt acceptance under that transaction; issuing a fresh token is not a substitute for claim-time authorization.

**Why:** Without consumption, an attempt-0 token can be replayed after attempt 1 loses its lease. Without claim-time acceptance checks, a token issued under an earlier decision can outlive a later ineligible acceptance.

**How to apply:** Test replay after lease expiry and an acceptance change between issuance and claim. A rejected or rolled-back claim must leave the attempt and token hash unchanged.