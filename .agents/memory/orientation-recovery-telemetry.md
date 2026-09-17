---
name: Orientation recovery telemetry
description: Project-orientation recovery accounting across the local counter, execution ledger, usage events, and acceptance projection
---

For project-orientation turns, a no-tools correction/recovery attempt must be one server-owned operation across the request execution ledger, provider usage contract, trace, and terminal acceptance. A local `recoveryAttemptsUsed` increment alone is not sufficient: it can produce `recoveryAttempt=1` in the terminal decision while the durable execution ledger and usage event still report zero/not-attempted.

**Why:** The latest static-build orientation session retained six complete source reads and reached a complete orientation coverage boundary, but malformed provider output caused `MODEL_OUTPUT_INVALID`. The terminal trace recorded one parse recovery attempt while the execution ledger recorded `recovery: 0` and usage events recorded `recovery_outcome=not_attempted`, making retry and budget behavior difficult to interpret.

**How to apply:** Admit and complete the recovery through the request-owned `ExecutionLedger`, emit usage with contract/recovery outcome, pass the same attempt identity into the terminal projection, and test both successful and failed orientation recovery. Keep complete retained reads reusable, but do not mark acceptance proven unless a valid grounded response is produced.