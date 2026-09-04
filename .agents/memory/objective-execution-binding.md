---
name: Objective execution binding
description: Durable autonomous completion must be authorized by a bound operation contract and retained proof, not worker or provider completion.
---

Autonomous terminal success requires a server-owned objective, expected behavior, executable acceptance checks, matching workspace revision, in-scope node files, passed nodes, retained evidence, and a PROVEN verdict.

**Why:** Provider responses, leases, and validation callbacks can complete without proving that the requested behavior or bytes were accepted; treating them as success makes reconnects and delivery state misleading.

**How to apply:** Keep legacy records readable, but classify missing or stale contract fields as incomplete/blocked. Preserve ordinary non-proof chat compatibility while gating proof-required executions at the durable completion boundary. A pending approval proposal may finalize as review-ready/PARTIAL only after identity, scope, node, and evidence-reference checks; PROVEN remains exclusive to autonomous terminal success.