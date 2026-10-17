---
name: Episode and Execution lock order
description: Prevent row-lock cycles between accepted-proof readers and execution finalization.
---

Any transaction that needs both an Execution and its Episode must lock Execution before Episode. Resolve the Episode's execution identity with an unlocked read, then lock Execution and lock/revalidate the Episode. An Episode-only transaction must not later request the same Execution row.

**Why:** Idempotent acceptance finalization holds Execution before closing an Episode, including an already accepted Episode. A concurrent proof reader that held Episode while waiting for Execution formed a reproducible PostgreSQL deadlock.

**How to apply:** Use the shared pair-locking boundary for proof readers. Keep Mission/Goal-before-Execution ordering where applicable, and keep all later acceptance, evidence, and bundle locks behind the established Execution lock. Validate lock races only against a disposable PostgreSQL cluster.
