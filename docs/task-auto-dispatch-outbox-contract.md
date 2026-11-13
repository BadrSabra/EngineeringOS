# Task Auto-Dispatch Outbox Contract

Issue: [#3 — Close Task auto-dispatch Outbox gaps across the lifecycle](https://github.com/BadrSabra/EngineeringOS/issues/3)

This document records the server-owned Task dispatch contract. The database event is the durable intent; the process-local **heavyJobQueue** is only a wake-up and capacity boundary. It is not a second source of truth or a distributed lock.

## Producers and transaction boundaries

| Producer | Source | Durable write |
|---|---|---|
| Manual Task status transition | **artifacts/api-server/src/routes/tasks.ts**, PATCH **/tasks/:taskId** | Task transition, audit/event, and Task Outbox intent commit in one PostgreSQL transaction. |
| Manual Task execute/verification | **artifacts/api-server/src/routes/tasks.ts**, POST **/tasks/:taskId/execute** | Verification result and eligible Task Outbox intent commit in one PostgreSQL transaction. |
| Mission Goal Task handoff | **artifacts/api-server/src/lib/mission-runtime.ts**, **runMissionGoal** | Mission Task row is locked; Task Outbox intent and **AiGoalDispatchRequested** commit in the same Mission transaction. The post-commit scheduler call wakes the local queue with the exact committed Task generation. |
| Scheduler repair / deferred redispatch | **artifacts/api-server/src/routes/ai/tasks.ts** | **scheduleAiTaskExecution** idempotently verifies/repairs an intent before local enqueue; **dispatchDeferredAiTaskExecutions** reads due durable intents after restart or queue backpressure. |
| Task cancellation / deletion | **artifacts/api-server/src/routes/tasks.ts**, rollback and DELETE handlers | The reserved Outbox row is retired in the same transaction as the transition to cancelled or deletion; the ordinary Task lifecycle/audit events remain. |

There is one logical Outbox identity per Task, keyed by **task-auto-execution-deferred:<taskId>**. The event key is stable; the generation and authorization identity are enforced by the payload and the Task row lock.

## Outbox identity

Every new intent records:

- **projectId** and **taskId** on the event row.
- **userId** in the payload.
- **taskRetryCount** and **taskCorrelationId** for the Task generation.
- The Mission delegation fields when explicitly supplied: **parentExecutionId** and **delegationBudget**.
- **attemptCount**, and when deferred, **lastFailureCode** and **nextAttemptAt**.

A same-generation idempotent write may reuse an existing intent only when event type, project, Task, user, retry count, correlation ID, and any explicitly supplied delegation options match. An older payload with no **taskCorrelationId** is normalized only for the legacy null-correlation case. Replacing an older generation resets the event to Requested, replaces its payload/ownership links, and refreshes its timestamp; the age of the previous generation must not make the new intent look stale.

A dispatch closure carries the generation it read. It must not start against a changed Task generation, and it may clear/defer an intent only when the persisted retry count and correlation ID still match that closure. Mission delegation is taken from the durable intent, not silently reconstructed from a later caller.

## State transitions and closure rules

| State / event type | Meaning | Allowed transition |
|---|---|---|
| **TaskAutoExecutionDispatchRequested** | Durable intent exists and may be dispatched immediately. | Enqueue locally; remain durable until a successful Task/Execution claim or an explicit ineligible/stale-generation cleanup. |
| **TaskAutoExecutionDeferred** | Intent remains durable but must not be attempted before **nextAttemptAt**. | Redispatch only when due. Preserve the reason and increment the attempt count on another pre-claim deferral. |
| Local queue **full** / **duplicate** | Local scheduling outcome, not a durable execution result. | On **full**, retain the intent with a bounded retry time. A duplicate is not a second execution and does not grant ownership. |
| Pre-claim provider/rate-limit/exception conflict | No Execution claim was committed. | Retain the exact intent with a bounded retry time; honor a trusted provider/project retry window when present. |
| Matching Execution already active | The same Task generation and execution owner are already active. Matching includes Task/project/Goal, user, retry attempt, correlation ID, parent Execution, and any explicitly supplied delegation-budget fields. | Retire only the duplicate intent for that exact identity; a foreign owner, older attempt, different Goal, or different delegation binding must not consume the current generation's intent. The existing Execution lease, Acceptance, and recovery lifecycle remain authoritative. |
| Stale or ineligible Task generation | Task is gone, not verifying, or lacks a prompt. | The dispatcher selects these rows through a left join (including Tasks without a runnable prompt) and prunes only the unchanged event snapshot. A Task deletion or rollback also removes its reserved intent transactionally. |
| Generation mismatch | The Task's retry count or correlation ID differs from the persisted payload. | Never dispatch old options into the new generation; defer the exact old snapshot for bounded reconciliation and never let its cleanup delete a replacement intent. |
| Successful Task/Execution claim | One worker now owns the Task and Execution lease. | Consume the matching Outbox intent in the same PostgreSQL transaction, after **claimAiExecution** succeeds and before the Task is changed to running. If a later step or commit fails, the transaction rolls back and the intent remains. |
| Post-claim failure, cancellation, or worker crash | Execution has crossed the claim boundary. | Do not recreate the auto-dispatch intent. Let Execution lease reconciliation, Acceptance, **nextActionCode**, and the existing authorized resume/recovery path decide what happens next. |

The only successful-consumption boundary is the transaction in **executeTaskLifecycle** that has both a locked Task generation and a successfully claimed linked Execution. Before claim, a reused idempotency-key row must also match the Task's Goal and retry attempt, the Task/project/user/correlation identity, and the requested parent Execution and explicitly supplied delegation-budget fields; a reused row with a different identity is an **execution_identity_changed** pre-claim conflict. An early return for Mission admission, Task identity, a future Acceptance **retryAt**, or another pre-claim conflict must not consume the Outbox. The exact-generation delete is in the same transaction as the Execution claim and Task running transition.

## Pre-claim retry policy

| Reason | Stored outcome |
|---|---|
| **LOCAL_QUEUE_FULL** | Deferred with a bounded local retry. |
| **PROJECT_RATE_LIMITED** | Deferred until the trusted project **retryAfterSec** window (or its safe default). |
| **PROVIDER_NOT_CONFIGURED** | Deferred with the longer configuration-wait interval; the Task remains visible in **verifying**. |
| **mission_***, **execution_identity_changed**, **execution_already_claimed**, **invalid_task_transition** | Classified as a Mission/execution gate or owner conflict; no rapid retry loop. A matching active Execution is handled separately as an already-owned generation. |
| Other pre-claim exception | Bounded exponential backoff; keep the exact intent until the Task/Execution identity is rechecked. |

A successful claim is not retried by this dispatcher. Provider failures after claim are represented by the existing Execution and Acceptance records and remain subject to the existing proof, approval, cancellation, lease, and recovery gates.

## Health projection

**getDurableJobHealth** exposes content-free counters:

- **pendingAiTaskDispatches**: Requested intents.
- **deferredAiTaskDispatches**: Deferred intents.
- **staleAiTaskDispatches**: intents whose age exceeds the pending threshold and whose retry time is due (or missing/malformed), plus orphaned intents or intents bound to Tasks that have left **verifying** or no longer have a runnable prompt (these are immediately ineligible and must be pruned). A deliberately future **nextAttemptAt** on an eligible **verifying** Task is not reported as overdue.
- **oldestAiTaskDispatchAt**: oldest timestamp among outstanding Task intents.
- **deferredAiTaskDispatchesByReason**: allow-listed aggregate buckets only; never raw provider payloads, prompts, user IDs, or exception messages.

The sub-projection may become degraded for overdue dispatches or failed recovery stages. The top-level **/healthz** response remains a liveness check.

## Regression coverage

The relevant test coverage is kept at the existing boundaries rather than replacing them with queue mocks:

- Task PATCH and execute route tests verify persisted generation identity and rollback on conflicting dispatch ownership.
- Mission runtime tests verify the Outbox and **AiGoalDispatchRequested** survive a simulated lost local wake.
- AI route tests cover stale retry/correlation generations, delegation/owner identity conflicts, legacy null-correlation normalization, queue capacity, provider/rate-limit pre-claim deferral, already-active Execution ownership, an old queue closure racing a newer Task generation, and stale-snapshot cleanup that must not delete a replacement Outbox row.
- **task-execution-lifecycle.integration.test.ts** also covers future Acceptance retry retention, a reused idempotency-key Execution with a mismatched parent/budget/attempt, and rollback when the final Task claim update fails. The existing two-process deferred-dispatch race remains in place.
- **job-reconciliation.test.ts** distinguishes overdue/due intents from intentionally future-scheduled retries, verifies reason bucketing, and asserts that orphaned intent rows remain visible in health.
- Task route tests verify atomic Outbox retirement on rollback and deletion; AI route tests verify background pruning of pre-existing orphaned and terminal-Task rows.

Required validation on the candidate SHA:

    pnpm run codegen
    pnpm --filter @workspace/api-server run typecheck
    pnpm --filter @workspace/api-server exec vitest run src/routes/ai.test.ts src/routes/tasks.test.ts src/lib/mission-runtime.test.ts src/lib/job-reconciliation.test.ts src/lib/task-execution-lifecycle.integration.test.ts
    pnpm run test:deferred-task-dispatch-concurrency
    pnpm run codegen:check
    pnpm run validate:release

This contract does not authorize merging or deployment. Do not close Issue #3 until these checks pass on the final PR head and the Task/Execution/Acceptance multi-process lifecycle is evidenced on PostgreSQL.
