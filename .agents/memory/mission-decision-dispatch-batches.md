---
name: Mission decision dispatch batches
description: How to represent multi-root strategy dispatch without treating dispatch identity as execution or acceptance proof.
---

A plan with multiple root Goals needs a durable dispatch manifest binding the exact revision's complete root set, each root's run result, and every resulting Execution ID. A single Execution reference (or the first item returned by a runner) cannot represent the whole plan. Persist the manifest and its `DISPATCHED` event in the same transaction; retries must reproduce the same identity and hash.

The manifest is provenance only. It does not establish that all successor Goals or Tasks completed, nor that their Executions have Canonical Proof. Keep multi-root `EXECUTED` and `ACCEPTED` unavailable until a separate plan-wide outcome contract reloads every required object and derives a truthful aggregate result.

For plan-level outcome evaluation, keep the Decision Trace's failed source Goal distinct from successor Goal identities. Aggregate only the exact active-plan Goal/Task/Execution set, with per-attempt Acceptance, effect, Canonical Proof, and final World State evidence. A caller-supplied `continuityVerified` flag is only a projection; the API loader must establish it from a current server-owned World State snapshot. Partial or inconclusive snapshots may be retained under a content hash, but must not advance the lifecycle. Changed evidence creates a new immutable snapshot; it never rewrites an earlier one.

**Why:** Root fan-out makes a singular lifecycle pointer ambiguous; the trace identifies the failed source Goal while the replan creates successor Goals, and a batch covers roots only. A single event per lifecycle stage also cannot safely represent changed evidence by mutating an earlier result.

**How to apply:** Any Mission strategy or replan dispatch that can create more than one root must bind the exact root set. Use a separate plan-wide snapshot keyed by decision and evidence identity; the API store must reload and validate the whole manifest in one transaction before claiming execution, acceptance, or verification.
