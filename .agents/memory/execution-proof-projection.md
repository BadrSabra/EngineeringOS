---
name: Execution proof projection
description: Accepted execution proof and trajectory metrics use the existing acceptance boundary; raw traces remain non-durable and non-public.
---

The execution-proof contract is a bounded projection of server-owned acceptance state. It may include verdict, evidence completeness, opaque accepted references, binding booleans, and a hashed trajectory summary. It must not include provider payloads, raw tool traces, source bodies, or path-bearing diagnostics.

**Why:** The existing acceptance ledger already owns terminal identity, evidence snapshots, recovery state, and public projections. A second proof store would duplicate authority, while raw trajectory persistence would cross the redaction and durable-evidence boundaries.

**How to apply:** Add proof fields through the existing acceptance/disposition projection and preserve parity across chat, task, benchmark, SSE, and history. Derive metrics from server-owned receipts or terminal metadata; do not treat them as acceptance evidence or skill promotion proof without replay and validation.