---
name: Live evaluation inconclusive outcomes
description: Live provider evaluations must separate application contract verdicts from upstream transport or provider failures.
---

Treat a live provider or transport exception as inconclusive unless the application produced a contract result. It does not prove either accepted orientation coverage or the server-owned incomplete projection.

**Why:** Direct orchestrator calls can fail before finalization, while deterministic fixtures prove that the same incomplete source manifest reaches `ANALYSIS_INCOMPLETE` when provider output is available.

**How to apply:** Evaluation receipts should use an explicit inconclusive status for provider/runtime failures and reserve passed/failed for completed application-level checks.