---
name: P7.5 Mission context boundary
description: Limits how calibrated runtime-start results may influence Mission replanning.
---

P7.5 runtime-start outcomes may enter Mission replanning only as bounded historical context after a validated pre-run calibration assessment and a complete, fresh, same-scope result are identity-bound through the Episode registration and result envelopes. They do not update beliefs, grant scope, satisfy acceptance, or select a read operation.

**Why:** P7.5 observation references do not identify a server-owned source path or connect to a claim-acceptance contract. Treating a reference as a read instruction would cross evidence and authorization boundaries.

**How to apply:** Before materializing any adaptive Mission read step, require a server-owned token-to-observation/path mapping that feeds the existing evidence scheduler and acceptance path. Keep runtime-start selection fixed until that contract exists.