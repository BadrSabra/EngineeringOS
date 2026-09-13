---
name: Project query retry contract
description: Failed targeted project queries retry as new executions while preserving their server-owned evidence contract.
---

Targeted `PROJECT_QUERY` retries are new auditable executions, not token resumes of the failed execution. Persist the target, required evidence paths, project scope, workspace revision, and verified read-path ledger on the session so a short retry cannot fall through to ordinary `CHAT` or invent a new scope. A provider interruption after reads have started must return to the existing server-owned evidence scheduler before terminalizing; the final durable recovery/evidence state must come from the same terminal classifier used by SSE.

**Why:** A targeted project query is a `BEHAVIOR_QUERY` internally, so treating every behavior query as resumable would revive ordinary questions. A separate target marker preserves the narrow contract without broadening continuation behavior.

**How to apply:** Persist the explicit project target only for evidence-required `PROJECT_QUERY` turns. During the active tool loop, use the existing objective cursor/read-tool recovery with its normal iteration/tool budgets; generic orientation questions have no proof-required objective and must not enter this path. On retry, restore that target before resolving intent, create a fresh execution/operation/message identity, and keep the failed execution and acceptance in history. Natural follow-ups such as “what happens next?” may continue only when this project-query target is present; never add them to the global forensic/task continuation matcher.