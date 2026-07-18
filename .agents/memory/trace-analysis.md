---
name: Trace-by-Trace Analysis
description: Divergences found between Prompt, Runtime, Context, and Events across all 5 AI agent paths.
---

## What was done
Parallel trace explorers read all prompts, schemas, parsing, groq-client, git-tools, context-builder, events schema, and all route call sites.
Full report: docs/ai-orchestrator-trace-analysis.md

## Seven divergences found and fixed

| ID | Where | What |
|----|-------|------|
| D-01 | git-tools.ts `git_diff` | No path bounds check — model-supplied path passed to git with no safePath equivalent. Fixed: `path.resolve` check rejects traversal. |
| D-02 | scan-runner.ts catch | Scan failure wrote `status:"failed"` to scan_jobs but NO eventsTable row — AI context was blind to failed scans. Fixed: `ProjectScanFailed` event emitted. |
| D-03 | routes/tasks.ts PATCH | Manual task edits (status, priority, title) only wrote to audit_log, not eventsTable. Fixed: `TaskUpdated` event emitted for meaningful field changes. |
| D-04 | routes/ai.ts `handleOrchestratorError` | Rate-limit / auth / server errors returned HTTP response with no eventsTable write. Fixed: function accepts `{ projectId, operation }` ctx and fire-and-forgets `AiOrchestratorError` event. |
| D-05 | context-builder.ts event formatting | `taskId`, `workflowId`, `correlationId` dropped from event string — AI saw "TaskCompleted" with no entity ref. Fixed: refs appended as `[task:abc12345 ...]` when non-null. |
| D-06 | task/scan/review agents | G-18 retry included TIMEOUT — base completeRaw already retries TIMEOUT 3×, so agent-level added up to 6 total. Fixed: agent retry covers NON_200 only. |
| D-07 | workflow-orchestrator | Phase `condition` strings evaluated by model from unstructured latestMetrics text — unreliable for numeric thresholds. Accepted/deferred: requires WorkflowPhaseSchema changes + condition evaluator module. |

## Key facts confirmed by trace (not divergences)
- `ChatOutputSchema.pendingChanges` is `z.array(PendingChangeSchema)` — explorer summary was wrong (not "string array").
- `completeRaw` retries: TIMEOUT, NETWORK_ERROR, RATE_LIMITED, SERVER_ERROR (3×). NON_200 is NOT retried by base client.
- AgentContextSchema `.strict()` — all 6 fields required; buildProjectContext always populates all 6 with non-empty fallback strings.
- `git_diff` uses `--` separator (prevents option injection) but had no directory traversal guard before D-01 fix.

## Open architectural observations (not fixed)
- OA-1: Tool dispatch by `startsWith` prefix — registry map would be safer.
- OA-2: Workflow condition evaluation is unstructured text — needs structured condition evaluator.
- OA-3: All agents get identical ProjectContext — per-agent trimming would reduce token use.
- OA-4: apply-changes success not broadcast to other tabs.
