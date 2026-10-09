---
name: Objective execution binding
description: Durable autonomous completion must be authorized by a bound operation contract and retained proof, not worker or provider completion.
---

Autonomous terminal success requires a server-owned objective, expected behavior, executable acceptance checks, matching workspace revision, in-scope node files, passed nodes, retained evidence, and a PROVEN verdict.

**Why:** Provider responses, leases, and validation callbacks can complete without proving that the requested behavior or bytes were accepted; treating them as success makes reconnects and delivery state misleading.

**How to apply:** Keep legacy records readable, but classify missing or stale contract fields as incomplete/blocked. Preserve ordinary non-proof chat compatibility while gating proof-required executions at the durable completion boundary. A pending approval proposal may finalize as review-ready/PARTIAL only after identity, scope, node, and evidence-reference checks; PROVEN remains exclusive to autonomous terminal success.

Project progress should be judged by whether the internal agent can complete a bounded engineering objective, verify its real effect with independent evidence, handle interruption and workspace/world-state drift safely, and choose its next action from the latest durable accepted state—not by the number of tools or tests added.

**Why:** the user identified closed-loop engineering capability as the decisive milestone, rather than expanding the tool or test inventory.

**How to apply:** Prefer one isolated end-to-end objective run that spans execution, independent effect observation, interruption/drift recovery, and a server-owned next decision. Treat provider prose, tool invocation counts, and fixture-only lifecycle as insufficient proof.

For approved Mission repairs, derive the chat turn intent from the persisted objective and mark it as server-owned delivery intent; do not let the internal prompt wrapper reclassify it as a read-only project query. This routing decision does not grant write authority: approval state and the scoped tool manifest remain authoritative.

**Why:** A live run classified the wrapped Mission prompt as PROJECT_QUERY and exposed no tools. Supplying the approved objective's intent routed it to DELIVERY, but the provider still returned an invalid result, so this routing fix alone is not completion proof.

**How to apply:** Apply this only to approved `mission_repair` execution. Keep observation/validation and unapproved repairs on their existing read-only or approval-gated routes, and require canonical proof before completion.