---
name: Mission decision dispatch batches
description: How to represent multi-root strategy dispatch without treating dispatch identity as execution or acceptance proof.
---

A plan with multiple root Goals needs a durable dispatch manifest binding the exact revision's complete root set, each root's run result, and every resulting Execution ID. A single Execution reference (or the first item returned by a runner) cannot represent the whole plan. Persist the manifest and its `DISPATCHED` event in the same transaction; retries must reproduce the same identity and hash.

The manifest is provenance only. It does not establish that all successor Goals or Tasks completed, nor that their Executions have Canonical Proof. Keep multi-root `EXECUTED` and `ACCEPTED` unavailable until a separate plan-wide outcome contract reloads every required object and derives a truthful aggregate result.

**Why:** Root fan-out makes a singular lifecycle pointer ambiguous; mapping it to one Goal can silently omit unfinished work or falsely promote a partial run to completion.

**How to apply:** Any Mission strategy or replan dispatch that can create more than one root must bind the exact root set. Use separate server-owned aggregation before claiming execution, acceptance, or verification.
