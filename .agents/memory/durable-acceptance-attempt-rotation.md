---
name: Durable acceptance resume attempt rotation
description: Resume-token issuance and execution-attempt rotation must remain separate so each accepted retry gets one historical acceptance.
---

Advance the execution attempt only when a valid resume token is atomically consumed by a worker claim; issuing or rotating a token alone must not create the next attempt.

**Why:** Recovery endpoints can issue a token before a worker claims it. Incrementing there and again during claim creates skipped or duplicate attempt identities and can make a prior paused acceptance appear current.

**How to apply:** Keep the previous acceptance immutable, validate resumability before issuing the token, and let the successful claim establish the new attempt before any terminal finalization.