---
name: E1–E8 stage gates
description: Required sequencing for the project's remaining agent-core gaps.
---

Complete the remaining gap sequence in order: E1, then E2 through E8. Do not declare E2 closed or begin E3 until the E2 gate explicitly passes.

**Why:** The project work is intentionally staged, with E2 as a hard dependency for every later stage.

**How to apply:** Keep each stage's findings and validation scoped and recorded. If E2 remains partial, continue only E2 work and do not present E3–E8 as started.

As of 2026-10-05, the owner-reported status is E2 closed for the proof-bound World State materialization invariant, E3 closed, and the E4 Entry Audit passed. The E4.1 Read-Only Sample Source Inventory returned `UNQUALIFIED`: this is `PASS` for the inventory only, while E4.1 stays `OPEN / NOT PASS`. Source qualification, protocol completion, evaluation authorization, and promotion remain separate ordered gates.

**Why:** The user explicitly qualified the E2 boundary and supplied the current E3/E4 gate status, the inventory criteria, and its accepted no-source outcome; durable pending work is not a materialized World State transition, while proof and revision authority remain fail-closed.

**How to apply:** Do not reopen E2 because a pending reservation row exists. Keep manual `/git/push` receipt-only. Do not treat the inventory result as source qualification or as authority for E4.2, implementation, runtime changes, collection/calibration, P7.5 activation, or promotion. Require separate explicit gates for source qualification, protocol completion, evaluation authorization, and promotion.

For Apply route crash tests, acceptance insertion and terminal execution update share one transaction. Killing the process while terminalization is blocked rolls back the inserted acceptance; do not describe a durable acceptance-before-terminal window. To isolate the terminal boundary, pause at acceptance insertion, acquire the execution-table lock from a second transaction, then release the acceptance pause so only the terminal update blocks. An earlier execution-table lock can block the request claim instead. Run the HTTP route in app-only child processes, stage the crash states, then use one full API startup to test recovery.

**Why:** The transaction boundary makes acceptance atomic with terminal success, while early table locks can intercept unrelated claim writes and produce a false crash point. A single full startup after staging the cases tests real recovery without mixing startup workers into each route scenario.

**How to apply:** Reuse this sequence for Apply acceptance/terminalization tests and preserve the distinction between local route-case labels and the audit's generic W0–W9 window labels.