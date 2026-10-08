---
name: E1–E8 stage gates
description: Required sequencing for the project's remaining agent-core gaps.
---

Complete the remaining gap sequence in order: E1, then E2 through E8. Do not declare E2 closed or begin E3 until the E2 gate explicitly passes.

**Why:** The project work is intentionally staged, with E2 as a hard dependency for every later stage.

**How to apply:** Keep each stage's findings and validation scoped and recorded. If E2 remains partial, continue only E2 work and do not present E3–E8 as started.

The audit goal is to reduce `UNKNOWN` by resolving one bounded, testable E2 uncertainty at a time. Distinguish source inspection, DB-level integration, process-kill/startup recovery, and live/production evidence; do not let a narrower result stand in for a broader boundary.

**Why:** The user clarified that the goal is to reduce `UNKNOWN`, not to treat missing evidence as proof that every path is broken.

**How to apply:** Each E2 step should name the exact uncertainty, add the cheapest evidence that can resolve it, and record what remains untested without advancing to E3.

Before reopening an E2 unknown, reconcile the main status report with the chronological progress log; a later entry may already have tested the boundary while summary matrices remain stale.

**Why:** On 2026-10-07, Mission-repair process recovery at three persisted phases was documented in the progress log but still described as untested in the main report.

**How to apply:** Search the relevant test and latest progress entries before selecting the next target. If evidence already exists, verify it if useful and correct the stale report instead of duplicating the test as new coverage.

As of 2026-10-06, the current project audit remains on E2; do not use earlier reported stage statuses or focused fixes as authorization to advance. The E4 Entry Audit passed. The E4.1 Read-Only Sample Source Inventory returned `UNQUALIFIED`: this is `PASS` for the inventory only, while E4.1 stays `OPEN / NOT PASS`. Source qualification, protocol completion, evaluation authorization, and promotion remain separate ordered gates.

**Why:** The user explicitly keeps E3.2 open despite earlier fixes, tests, or Publish. The previously recorded explanation no longer matches the current queued-dispatch code; localized reauthorization is not proof of end-to-end crash/replay safety across external side effects.

**How to apply:** Do not reopen E2 because a pending reservation row exists. Keep manual `/git/push` receipt-only. Do not begin E3 or Learning/Transfer/Generalization until E2 explicitly passes, and do not rerun Strategy Replay receipts. Distinguish queued recipe reauthorization from replaying an uncertain running side effect. Do not treat focused replay tests, the Chat-to-Mission handoff pass, or Publish as closure evidence. Do not treat the inventory result as source qualification or as authority for E4.2, implementation, runtime changes, collection/calibration, P7.5 activation, or promotion. Require separate explicit gates for source qualification, protocol completion, evaluation authorization, and promotion.

For Apply route crash tests, acceptance insertion and terminal execution update share one transaction. Killing the process while terminalization is blocked rolls back the inserted acceptance; do not describe a durable acceptance-before-terminal window. To isolate the terminal boundary, pause at acceptance insertion, acquire the execution-table lock from a second transaction, then release the acceptance pause so only the terminal update blocks. An earlier execution-table lock can block the request claim instead. Run the HTTP route in app-only child processes, stage the crash states, then use one full API startup to test recovery.

**Why:** The transaction boundary makes acceptance atomic with terminal success, while early table locks can intercept unrelated claim writes and produce a false crash point. A single full startup after staging the cases tests real recovery without mixing startup workers into each route scenario.

**How to apply:** Reuse this sequence for Apply acceptance/terminalization tests and preserve the distinction between local route-case labels and the audit's generic W0–W9 window labels.

For read-only E2 forensic work, do not restart managed API/runtime workflows without explicit authorization. Startup reconciliation and dispatchers can run, and an already-running dashboard may submit an interactive analysis request; even a request rejected by local AI-budget admission can persist a failed acceptance without calling an external provider.

**Why:** Restarting the API during this investigation was followed by a dashboard analysis request that persisted a failed acceptance before provider admission. A health check reporting no queued recovery jobs does not prevent interactive requests or their durable effects.

**How to apply:** Prefer isolated route tests and builds while preserving the forensic boundary. If runtime startup is explicitly authorized, inspect startup behavior first, watch request logs immediately, and stop the workflow if unrelated durable work appears. Do not equate “no provider call” with “no database mutation.”

Use a source-derived measurement ledger for E2, not test totals, `PROVEN` row counts, or a new Runtime catalog. Track source-inventory completeness separately from atomic `surface × invariant` evidence; any `UNKNOWN` source family blocks a global denominator or ratio. Split mixed/partial behavior into separate invariants. `0/4` means zero of the four architectural layers is fully closed, not a progress percentage. Keep E3 stopped and E4 behind its existing gates.

**Why:** The user specified that the denominator itself must be evidence-based and that partial behaviors must not receive fractional credit.

**How to apply:** Record source anchors and exact evidence boundaries for each unit; close source families before calculating any total. Preserve the existing stage gates regardless of the number of passing rows.

During the active E2 closeout, do not restart managed workflows, run Strategy Replay, begin E3 or later, or propose follow-up tasks.

**Why:** The user explicitly limited work to E2 and prohibited those actions while E2 remains open.

**How to apply:** Keep code, documentation, and isolated tests scoped to E2. Wait for explicit E2 closure before proposing or starting downstream work.