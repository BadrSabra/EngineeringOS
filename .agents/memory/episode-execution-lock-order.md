---
name: Episode and Execution lock order
description: Prevent row-lock cycles between accepted-proof readers and execution finalization.
---

Any transaction that needs both an Execution and its Episode must lock Execution before Episode. Resolve the Episode's execution identity with an unlocked read, then lock Execution and lock/revalidate the Episode. An Episode-only transaction must not later request the same Execution row. When a transaction also needs a World Transition row, lock Transition before Episode; an unlocked Episode identity read may select the matching transition first, then revalidate Episode under lock.

**Why:** Idempotent acceptance finalization holds Execution before closing an Episode, including an already accepted Episode. A concurrent proof reader that held Episode while waiting for Execution formed a reproducible PostgreSQL deadlock. Separately, an isolated interleaving reproduced `40P01` when Mission dependency proof held Episode before D2 Transition evaluation while the transition claimant held Transition before Episode.

**How to apply:** Use the shared pair-locking boundary for proof readers. Keep Mission/Goal-before-Execution ordering where applicable; keep acceptance and evidence checks behind the Execution lock; and keep Transition-before-Episode where both rows are needed. Validate lock races only against a disposable PostgreSQL cluster. The reproduction establishes this row-lock cycle, not a production incident or a general failure of Apply Changes.
