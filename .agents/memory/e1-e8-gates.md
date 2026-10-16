---
name: E1–E8 stage gates
description: Required sequencing for the project's remaining agent-core gaps.
---

Complete the remaining gap sequence in dependency order. The user explicitly closed E2 on 2026-10-11 for the scope defined in the project audit and authorized E3; E3 and E3.2 remain open.

**Why:** Later stages depend on explicit user gate decisions; the 2026-10-11 decision supersedes older audit snapshots that still said E2 was open.

**How to apply:** Continue only within the E3 scope the user authorized. Do not treat focused proof-freshness tests as closure of E3.2; do not run Strategy Replay receipts or start E4 without separate authorization.

When investigating an E2 uncertainty again, resolve one bounded question at a time and distinguish source inspection, DB integration, process-kill/startup recovery, and live/production evidence.

**Why:** The user clarified that the audit goal was to reduce `UNKNOWN`, not to treat missing evidence as proof that every path is broken.

**How to apply:** If E2 is explicitly reopened, reconcile the latest progress log and status report before adding new tests; record what each evidence type proves and leaves untested.

Before reopening an E2 unknown, reconcile the main status report with the chronological progress log; a later entry may already have tested the boundary while summary matrices remain stale.

**Why:** On 2026-10-07, Mission-repair process recovery at three persisted phases was documented in the progress log but still described as untested in the main report.

**How to apply:** Search the relevant test and latest progress entries before selecting the next target. If evidence already exists, verify it if useful and correct the stale report instead of duplicating the test as new coverage.

The E4 Entry Audit passed. The E4.1 Read-Only Sample Source Inventory returned `UNQUALIFIED`: this is `PASS` for the inventory only, while E4.1 stays `OPEN / NOT PASS`. Source qualification, protocol completion, evaluation authorization, and promotion remain separate ordered gates.

**Why:** The user explicitly keeps E3.2 open despite focused fixes and tests; localized reauthorization is not proof of end-to-end crash/replay safety across external side effects.

**How to apply:** Keep manual `/git/push` receipt-only. Do not treat focused replay tests or a Publish as E3.2 closure evidence. Do not treat the E4.1 inventory result as source qualification or authority for E4.2 implementation, runtime changes, collection/calibration, P7.5 activation, or promotion. Require separate explicit gates for source qualification, protocol completion, evaluation authorization, and promotion.

For Apply route crash tests, acceptance insertion and terminal execution update share one transaction. Killing the process while terminalization is blocked rolls back the inserted acceptance; do not describe a durable acceptance-before-terminal window. To isolate the terminal boundary, pause at acceptance insertion, acquire the execution-table lock from a second transaction, then release the acceptance pause so only the terminal update blocks. An earlier execution-table lock can block the request claim instead. Run the HTTP route in app-only child processes, stage the crash states, then use one full API startup to test recovery.

**Why:** The transaction boundary makes acceptance atomic with terminal success, while early table locks can intercept unrelated claim writes and produce a false crash point. A single full startup after staging the cases tests real recovery without mixing startup workers into each route scenario.

**How to apply:** Reuse this sequence for Apply acceptance/terminalization tests and preserve the distinction between local route-case labels and the audit's generic W0–W9 window labels.

For read-only E2 forensic work, do not restart managed API/runtime workflows without explicit authorization. Startup reconciliation and dispatchers can run, and an already-running dashboard may submit an interactive analysis request; even a request rejected by local AI-budget admission can persist a failed acceptance without calling an external provider.

**Why:** Restarting the API during this investigation was followed by a dashboard analysis request that persisted a failed acceptance before provider admission. A health check reporting no queued recovery jobs does not prevent interactive requests or their durable effects.

**How to apply:** Prefer isolated route tests and builds while preserving the forensic boundary. If runtime startup is explicitly authorized, inspect startup behavior first, watch request logs immediately, and stop the workflow if unrelated durable work appears. Do not equate “no provider call” with “no database mutation.”

Use a source-derived measurement ledger for E2, not test totals, `PROVEN` row counts, or a new Runtime catalog. Track source-inventory completeness separately from atomic `surface × invariant` evidence; any `UNKNOWN` source family blocks a global denominator or ratio. Split mixed/partial behavior into separate invariants. `0/4` means zero of the four architectural layers is fully closed, not a progress percentage. Preserve these E2 limits as historical findings; E2 is now explicitly closed, E3 is authorized, and E4 remains behind its existing gates.

**Why:** The user specified that the denominator itself must be evidence-based and that partial behaviors must not receive fractional credit.

**How to apply:** Record source anchors and exact evidence boundaries for each unit; close source families before calculating any total. Preserve the existing stage gates regardless of the number of passing rows.

On 2026-10-11, the user explicitly closed E2 and authorized E3. The earlier E2-only restrictions no longer block E3; E3.2 replay safety remains open, and Strategy Replay receipts must not be rerun.

**Why:** The user selected “close E2 and continue to E3” after the real process-recovery validation passed.

**How to apply:** Treat E2 as closed by explicit user decision, not as proof that every earlier E2 uncertainty is resolved. Continue E3 with proof-freshness work, preserve E3.2 and E4 gates, and do not replay Strategy Replay receipts.