/**
 * Durable scheduler boundary and startup reconciliation for
 * scan/discovery/AI-task jobs.
 *
 * The DB row is the durable queue record and ownership boundary. The
 * process-local JobQueue is only a bounded dispatcher/backpressure mechanism;
 * it may be absent, duplicated by another API instance, or lost on restart.
 * Every runner must therefore perform an atomic DB claim before work and use
 * a worker-scoped lease for heartbeats and terminal ownership fences.
 *
 * This module repairs the gap between durable rows and local dispatch at
 * startup and on a short periodic interval. Re-dispatch is intentionally
 * harmless: duplicate polling may create duplicate local closures, but only
 * the worker that wins the durable claim may execute the job.
 *
 * Treatment per status:
 *
 *   scan_jobs "queued"          → re-enqueue via heavyJobQueue (never started;
 *                                  all params are in the DB row: project_id)
 *   scan_jobs "running"         → retry if retryCount < maxRetries (reset to
 *                                  "queued"), else mark failed; this is bounded
 *                                  replay and not blind concurrent replay
 *   discovery_sessions "pending"    → re-enqueue via heavyJobQueue (never
 *                                  started; rootPath is in the DB row)
 *   discovery_sessions "discovering" → mark error (was in-flight when process
 *                                  died; intermediate state is gone)
 *   tasks "running"             → reset to "verifying" if retryCount < maxRetries
 *                                  (a new execution must be explicitly
 *                                  triggered), else mark failed
 *
 * For re-enqueued queued scan jobs the project stays "scanning" — it is
 * still going to scan. runScanJob handles both the success and failure paths
 * including resetting the project status. For re-enqueued pending discovery
 * sessions whose rootPath no longer exists (e.g. a git clone in /tmp that
 * was cleaned up), runDiscovery fails fast at the "Finding repository" step
 * and marks the session "error" with a clear message.
 *
 * For interrupted AI tasks, resetting to "verifying" makes the task visible
 * and re-triggerable; the old worker is never replayed directly. AI
 * executions have a separate reconciler because checkpoints, attempt
 * identity, cancellation, and external-effect recovery are part of their
 * contract. Unknown-midpoint delivery promotion is reconciled against its
 * durable journal and becomes an explicit conflict/recovery state rather than
 * being blindly replayed.
 *
 * Dispatch rules:
 *   - `enqueueWithId` prevents duplicate closures in one process. It is not a
 *     distributed lock and must not be treated as one.
 *   - `dispatchPersistedPendingJobs` includes fresh rows to close the
 *     DB-commit/local-enqueue crash window.
 *   - `requeueStalePendingJobs` is a scan-specific safety net for rows that
 *     remain queued too long; it does not touch running rows.
 *   - Conditional DB transitions, leases, and terminal worker fences provide
 *     multi-process correctness. Advisory locks are defense in depth for scan
 *     execution, not a replacement for the durable state machine.
 */
import { randomUUID } from "node:crypto";
import {
  db,
  scanJobsTable,
  discoverySessionsTable,
  projectsTable,
  tasksTable,
  taskLogsTable,
  aiApplyJournalTable,
  aiChangeProposalsTable,
  eventsTable,
  durableDispatchStageHealthTable,
  taskExecutionObservationOutboxTable,
} from "@workspace/db";
import { and, eq, gt, inArray, isNull, lt, ne, or, count, min, sql, asc } from "drizzle-orm";
import { invalidateContextCache } from "@workspace/ai-orchestrator";
import { logger } from "./logger.js";
import { heavyJobQueue } from "./job-queue.js";
import { runScanJob, terminalizeFailedScanJob } from "./scan-runner.js";
import { dispatchPendingPluginRuns } from "./plugin-runtime.js";
import { runDiscovery } from "./discovery-runner.js";
import { sweepExpiredUploads } from "./upload-store.js";
import { reconcileAiExecutions } from "./ai-execution-state.js";
import { reconcileInterruptedApplyChanges } from "./apply-change-reconciliation.js";
import { recoverPromotion } from "./delivery-workspace.js";
import { isLiveWorkspaceWriteUncoordinated } from "./live-workspace-apply-policy.js";
import { establishProjectRoot } from "./project-root.js";
import { dispatchProjectBootstrapJobs } from "./project-bootstrap.js";
import { dispatchAutonomousTaskRecoveries } from "./ai-recovery-coordinator.js";
import { databaseNow } from "./job-lease.js";
import {
  dispatchPendingMissionRecipes,
  replayPendingMissionEvents,
  wakeDueMissionGoals,
  wakeReadyMissionGoals,
  wakeRuntimeTransitionMissionGoals,
  wakeApplyChangesMissionGoals,
} from "./mission-runtime.js";
import {
  reconcileApprovedMissionDecisionDispatches,
  reconcileAutomaticMissionReplans,
} from "./mission-auto-replan.js";
import { reconcilePendingMissionPlanOutcomes } from "./mission-strategy-plan-outcome-store.js";
import { reconcilePendingMissionDecisionShadows } from "./mission-strategy-shadow-store.js";
import { resolveMissionDecisionShadowProjectScope } from "./mission-decision-shadow-scope.js";
import { dispatchPendingShadowReplays } from "./shadow-replay.js";
import { dispatchPendingMissionChatHandoffs } from "./mission-chat-handoffs.js";
import { retryPendingRuntimeStartTransitions } from "./agent-state/runtime-start-transition.js";
import { dispatchDeferredAiTaskExecutions } from "../routes/ai/tasks.js";
import { dispatchPendingTaskObservationOutbox } from "./task-observation-outbox.js";

const ORPHANED_RUNNING_MESSAGE =
  "Job was in progress when the server restarted and could not be resumed.";
const MISSION_OUTCOME_RECONCILIATION_INTERVAL_MS = 60_000;
const lastMissionOutcomeReconciliationByScope = new Map<string, number>();
const MISSION_DECISION_SHADOW_RECONCILIATION_INTERVAL_MS = 60_000;
const lastMissionDecisionShadowReconciliationByScope = new Map<string, number>();
let warnedMissionDecisionShadowScopeMissing = false;

async function reconcileMissionPlanOutcomesIfDue(projectId?: string): Promise<number> {
  const scopeKey = projectId ?? "*";
  const now = Date.now();
  const lastRun = lastMissionOutcomeReconciliationByScope.get(scopeKey) ?? 0;
  if (now - lastRun < MISSION_OUTCOME_RECONCILIATION_INTERVAL_MS) return 0;
  lastMissionOutcomeReconciliationByScope.set(scopeKey, now);
  try {
    return await reconcilePendingMissionPlanOutcomes(16, projectId);
  } catch (error) {
    logger.warn(
      { error, projectId, scope: "job-reconciliation" },
      "Mission plan outcome reconciliation failed; the durable DISPATCHED event remains pending",
    );
    return 0;
  }
}

async function reconcileMissionDecisionShadowsIfDue(projectId?: string): Promise<number> {
  const enabled = process.env.MISSION_DECISION_SHADOW_MODE === "1";
  if (!enabled) return 0;
  const configuredProjectId = process.env.MISSION_DECISION_SHADOW_PROJECT_ID;
  const canaryProjectId = resolveMissionDecisionShadowProjectScope({
    enabled,
    configuredProjectId,
  });
  if (!canaryProjectId) {
    if (!warnedMissionDecisionShadowScopeMissing) {
      warnedMissionDecisionShadowScopeMissing = true;
      logger.warn(
        { scope: "job-reconciliation" },
        "Mission decision shadow mode is enabled without a valid single-project allowlist; reconciliation is skipped",
      );
    }
    return 0;
  }
  const scopedProjectId = resolveMissionDecisionShadowProjectScope({
    enabled,
    configuredProjectId: canaryProjectId,
    requestedProjectId: projectId,
  });
  if (!scopedProjectId) return 0;
  const scopeKey = scopedProjectId;
  const now = Date.now();
  const lastRun = lastMissionDecisionShadowReconciliationByScope.get(scopeKey) ?? 0;
  if (now - lastRun < MISSION_DECISION_SHADOW_RECONCILIATION_INTERVAL_MS) return 0;
  lastMissionDecisionShadowReconciliationByScope.set(scopeKey, now);
  try {
    return await reconcilePendingMissionDecisionShadows(16, scopedProjectId);
  } catch (error) {
    logger.warn(
      { error, projectId: scopedProjectId, scope: "job-reconciliation" },
      "Mission decision shadow reconciliation failed; authoritative Mission state is unchanged",
    );
    return 0;
  }
}

/**
 * Legacy delivery journals may complete a recorded promotion only when each
 * target still matches its persisted base bytes. Proof-bound Apply executions
 * are protected and use the separate observation-only reconciler instead.
 * Missing roots, symlinks, and unexpected bytes become visible conflicts.
 */
async function reconcileInterruptedDeliveries(
  protectedApplyProposalIds: ReadonlySet<string> = new Set(),
): Promise<number> {
  const proposals = await db
    .select({
      id: aiChangeProposalsTable.id,
      operationId: aiChangeProposalsTable.operationId,
      projectId: aiChangeProposalsTable.projectId,
      lifecycle: aiChangeProposalsTable.lifecycle,
      changes: aiChangeProposalsTable.changes,
      workspaceRoot: aiChangeProposalsTable.workspaceRoot,
    })
    .from(aiChangeProposalsTable)
    .where(or(
      eq(aiChangeProposalsTable.lifecycle, "isolated"),
      eq(aiChangeProposalsTable.lifecycle, "validated"),
    ));
  let recovered = 0;
  for (const proposal of proposals) {
    if (!proposal.operationId) continue;
    // Proof-bound apply executions have their own observation-only recovery
    // path. Never let the legacy promotion journal replay candidate bytes or
    // infer acceptance for those proposals.
    if (protectedApplyProposalIds.has(proposal.id)) continue;
    const journal = await db
      .select({ stage: aiApplyJournalTable.stage, sequence: aiApplyJournalTable.sequence, payload: aiApplyJournalTable.payload })
      .from(aiApplyJournalTable)
      .where(eq(aiApplyJournalTable.operationId, proposal.operationId))
      .orderBy(aiApplyJournalTable.sequence);
    const latest = journal.at(-1)?.stage;
    if (!latest || ["APPLIED", "BLOCKED", "ROLLED_BACK", "ROLLBACK_FAILED", "RECOVERY_REQUIRED"].includes(latest)) {
      continue;
    }
    // Promotion intent is durable before the first live-root replacement.
    // Reconcile only against the persisted proposal bytes and the persisted
    // project root; never resume from an in-memory snapshot.
    if (["PROMOTION_INTENT", "WRITING_STARTED", "WRITTEN", "PROMOTED"].includes(latest)) {
      const [project] = await db
        .select({ rootPath: projectsTable.rootPath })
        .from(projectsTable)
        .where(eq(projectsTable.id, proposal.projectId))
        .limit(1);
      const establishedRoot = project?.rootPath
        ? await establishProjectRoot(project.rootPath)
        : undefined;
      if (!establishedRoot?.ok) {
        logger.warn({
          proposalId: proposal.id,
          rootReason: establishedRoot?.reason ?? "project_root_missing",
        }, "legacy promotion recovery could not establish the persisted project root");
      }
      let recovery: "PROMOTED" | "ROLLED_BACK" | "RECOVERY_REQUIRED" = "RECOVERY_REQUIRED";
      let filesystemRecoverySuppressed = false;
      try {
        const proposalChanges = JSON.parse(proposal.changes) as Array<{
          path: string; newContent: string; originalContent?: string | null;
        }>;
        const intent = [...journal].reverse().find((entry: { stage: string }) => entry.stage === "PROMOTION_INTENT")?.payload;
        const intentFiles = intent && Array.isArray((intent as Record<string, unknown>).files)
          ? (intent as Record<string, unknown>).files
          : undefined;
        const changes = Array.isArray(intentFiles)
          ? intentFiles.reduce<Array<{ path: string; newContent: string; originalContent: string | null }>>((result, entry: unknown) => {
              if (!entry || typeof entry !== "object") return result;
              const file = entry as Record<string, unknown>;
              if (typeof file.path === "string" && typeof file.newContent === "string") {
                result.push({ path: file.path, newContent: file.newContent, originalContent: typeof file.originalContent === "string" ? file.originalContent : null });
              }
              return result;
            }, [])
          : proposalChanges;
        if (establishedRoot?.ok && proposal.operationId && Array.isArray(changes)) {
          if (isLiveWorkspaceWriteUncoordinated()) {
            filesystemRecoverySuppressed = true;
          } else {
            recovery = await recoverPromotion({
              rootPath: establishedRoot.canonicalPath,
              changes,
              operationId: proposal.operationId,
            });
          }
        }
      } catch (error) {
        logger.warn({ error, proposalId: proposal.id }, "delivery promotion recovery could not be evaluated");
      }
      const sequence = (journal.at(-1)?.sequence ?? 0) + 1;
      await db.insert(aiApplyJournalTable).values({
        id: randomUUID(),
        operationId: proposal.operationId,
        attemptId: randomUUID(),
        projectId: proposal.projectId,
        proposalId: proposal.id,
        stage: recovery === "PROMOTED" ? "PROMOTED" : recovery === "ROLLED_BACK" ? "ROLLED_BACK" : "RECOVERY_REQUIRED",
        sequence,
        payload: {
          recoveryDecision: recovery,
          previousStage: latest,
          workspaceRoot: proposal.workspaceRoot,
          reason: filesystemRecoverySuppressed
            ? "shared_workspace_writer_uncoordinated"
            : "process_restart",
          filesystemWriteSuppressed: filesystemRecoverySuppressed,
        },
      });
      if (recovery === "PROMOTED") {
        await db.update(aiChangeProposalsTable).set({
          lifecycle: "conflicted",
          conflictReason: "Promotion completed before validation outcome was recorded; resume validation before delivery can continue.",
        }).where(and(eq(aiChangeProposalsTable.id, proposal.id), inArray(aiChangeProposalsTable.lifecycle, ["isolated", "validated"])));
      } else if (recovery === "ROLLED_BACK") {
        await db.update(aiChangeProposalsTable).set({
          lifecycle: "conflicted",
          conflictReason: "Promotion was interrupted and rolled back; resume validation before retrying.",
        }).where(and(eq(aiChangeProposalsTable.id, proposal.id), inArray(aiChangeProposalsTable.lifecycle, ["isolated", "validated"])));
      } else if (filesystemRecoverySuppressed) {
        await db.update(aiChangeProposalsTable).set({
          lifecycle: "conflicted",
          conflictReason: "Filesystem recovery was not attempted because the shared editor and API do not have a common write coordinator; review the current project state before continuing.",
        }).where(and(eq(aiChangeProposalsTable.id, proposal.id), inArray(aiChangeProposalsTable.lifecycle, ["isolated", "validated"])));
      } else {
        await db.update(aiChangeProposalsTable).set({
          lifecycle: "conflicted",
          conflictReason: "Promotion encountered unexpected live-root bytes; manual review is required before retrying.",
        }).where(and(eq(aiChangeProposalsTable.id, proposal.id), inArray(aiChangeProposalsTable.lifecycle, ["isolated", "validated"])));
      }
      recovered++;
      continue;
    }
    const [updated] = await db.update(aiChangeProposalsTable).set({
      lifecycle: "conflicted",
      conflictReason: "Delivery was interrupted during apply; filesystem state requires review before retry.",
    }).where(and(
      eq(aiChangeProposalsTable.id, proposal.id),
      or(
        eq(aiChangeProposalsTable.lifecycle, "isolated"),
        eq(aiChangeProposalsTable.lifecycle, "validated"),
      ),
    )).returning({ id: aiChangeProposalsTable.id });
    if (!updated) continue;
    await db.insert(aiApplyJournalTable).values({
      id: randomUUID(),
      operationId: proposal.operationId,
      attemptId: randomUUID(),
      projectId: proposal.projectId,
      proposalId: proposal.id,
      stage: "RECOVERY_REQUIRED",
      sequence: (journal.at(-1)?.sequence ?? 0) + 1,
      payload: { previousStage: latest, reason: "process_restart" },
    });
    recovered++;
  }
  return recovered;
}

function eventPayloadRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function matchesGitHubDeliveryReceipt(
  attempt: Record<string, unknown>,
  operationId: string,
  receipt: Record<string, unknown> | undefined,
): boolean {
  if (!receipt) return false;
  const proposalId = attempt.proposalId;
  const commitHash = attempt.commitHash;
  const expectedParentHash = attempt.expectedParentHash;
  const expectedTreeHash = attempt.expectedTreeHash;
  const branch = attempt.branch;
  const remoteUrl = attempt.remoteUrl;
  const marker = `EngineeringOS-Operation: ${operationId}`;
  return typeof proposalId === "string"
    && typeof commitHash === "string"
    && typeof expectedParentHash === "string"
    && typeof expectedTreeHash === "string"
    && typeof branch === "string"
    && typeof remoteUrl === "string"
    && attempt.operationId === operationId
    && attempt.expectedCommitHash === commitHash
    && attempt.operationMarker === marker
    && receipt.proposalId === proposalId
    && receipt.operationId === operationId
    && receipt.commitHash === commitHash
    && receipt.remoteCommitHash === commitHash
    && receipt.remoteParentHash === expectedParentHash
    && receipt.remoteTreeHash === expectedTreeHash
    && receipt.operationMarker === marker
    && receipt.branch === branch
    && receipt.remoteUrl === remoteUrl;
}

/**
 * A verified delivery records its exact attempt identity before making any
 * remote mutation. If startup finds that attempt without a matching terminal
 * receipt, persist the existing recovery-required state; never replay the
 * GitHub request from startup.
 */
async function reconcileInterruptedGitHubDeliveryAttempts(): Promise<number> {
  const attempts = await db
    .select({
      id: eventsTable.id,
      projectId: eventsTable.projectId,
      correlationId: eventsTable.correlationId,
    })
    .from(eventsTable)
    .where(eq(eventsTable.type, "GitPushAttemptStarted"));

  let markedCount = 0;
  for (const candidate of attempts) {
    if (!candidate.correlationId) {
      logger.error(
        { eventId: candidate.id, projectId: candidate.projectId },
        "GitHub delivery attempt has no operation identity; startup cannot reconcile it",
      );
      continue;
    }
    try {
      const created = await db.transaction(async (tx) => {
        const [attemptRow] = await tx
          .select({
            id: eventsTable.id,
            projectId: eventsTable.projectId,
            correlationId: eventsTable.correlationId,
            payload: eventsTable.payload,
          })
          .from(eventsTable)
          .where(and(
            eq(eventsTable.id, candidate.id),
            eq(eventsTable.type, "GitPushAttemptStarted"),
          ))
          .for("update")
          .limit(1);
        if (!attemptRow?.correlationId) return false;

        const operationId = attemptRow.correlationId;
        const attemptPayload = eventPayloadRecord(attemptRow.payload) ?? {};
        const receipts = await tx
          .select({ payload: eventsTable.payload })
          .from(eventsTable)
          .where(and(
            eq(eventsTable.projectId, attemptRow.projectId),
            eq(eventsTable.type, "GitPushed"),
            eq(eventsTable.correlationId, operationId),
          ));
        if (receipts.some((receipt) => matchesGitHubDeliveryReceipt(
          attemptPayload,
          operationId,
          eventPayloadRecord(receipt.payload),
        ))) {
          return false;
        }

        const existingMarkers = await tx
          .select({ payload: eventsTable.payload })
          .from(eventsTable)
          .where(and(
            eq(eventsTable.projectId, attemptRow.projectId),
            eq(eventsTable.type, "GitPushRecoveryRequired"),
            eq(eventsTable.correlationId, operationId),
          ));
        if (existingMarkers.some((marker) =>
          eventPayloadRecord(marker.payload)?.recoveryState !== "RESOLVED"
        )) {
          return false;
        }

        await tx.insert(eventsTable).values({
          id: randomUUID(),
          type: "GitPushRecoveryRequired",
          projectId: attemptRow.projectId,
          severity: "error",
          message: "GitHub delivery has no exact terminal receipt; verify the remote state before retrying.",
          correlationId: operationId,
          payload: {
            ...(typeof attemptPayload.proposalId === "string"
              ? { proposalId: attemptPayload.proposalId }
              : {}),
            operationId,
            ...(typeof attemptPayload.branch === "string" ? { branch: attemptPayload.branch } : {}),
            ...(typeof attemptPayload.remoteUrl === "string" ? { remoteUrl: attemptPayload.remoteUrl } : {}),
            ...(typeof attemptPayload.commitHash === "string" ? { commitHash: attemptPayload.commitHash } : {}),
            ...(typeof attemptPayload.expectedCommitHash === "string"
              ? { expectedCommitHash: attemptPayload.expectedCommitHash }
              : {}),
            ...(typeof attemptPayload.expectedParentHash === "string"
              ? { expectedParentHash: attemptPayload.expectedParentHash }
              : {}),
            ...(typeof attemptPayload.expectedTreeHash === "string"
              ? { expectedTreeHash: attemptPayload.expectedTreeHash }
              : {}),
            ...(typeof attemptPayload.operationMarker === "string"
              ? { operationMarker: attemptPayload.operationMarker }
              : {}),
            attemptEventId: attemptRow.id,
            recoveryState: "REQUIRED",
            recoveryReason: "STARTUP_FOUND_ATTEMPT_WITHOUT_EXACT_RECEIPT",
          },
        }).onConflictDoNothing({
          target: [eventsTable.projectId, eventsTable.correlationId],
          where: sql`${eventsTable.type} = 'GitPushRecoveryRequired' AND ${eventsTable.correlationId} IS NOT NULL`,
        });
        return true;
      });
      if (created) markedCount++;
    } catch (error) {
      logger.error(
        { error, projectId: candidate.projectId, eventId: candidate.id, operationId: candidate.correlationId },
        "failed to persist GitHub delivery recovery state during startup",
      );
    }
  }

  if (markedCount > 0) {
    logger.warn(
      { count: markedCount },
      "startup marked unreceipted verified GitHub deliveries for exact recovery; no remote retries were issued",
    );
  }
  return markedCount;
}


/**
 * Handles scan_jobs left in non-terminal states:
 *   "running" → mark failed (interrupted)
 *   "queued"  → re-enqueue (never started; safe to retry)
 *
 * Returns total number of jobs handled (failed + re-enqueued).
 */
async function reconcileScanJobs(): Promise<number> {
  const abandonedScan = staleScanLeaseCondition();

  // ── 1. Running → failed ───────────────────────────────────────────────────
  // These jobs were actively executing when the process died. We cannot
  // safely determine how far they got, so they are marked failed and the
  // owning project is reset to "active".
  // PR-01: also select retryCount and maxRetries so we can decide whether to
  // retry or permanently fail each interrupted job.
  const running = await db
    .select({
      id: scanJobsTable.id,
      projectId: scanJobsTable.projectId,
      retryCount: scanJobsTable.retryCount,
      maxRetries: scanJobsTable.maxRetries,
    })
    .from(scanJobsTable)
    .where(and(eq(scanJobsTable.status, "running"), abandonedScan));

  let retriedCount = 0;
  let failedCount  = 0;

  for (const job of running) {
    if (job.retryCount < job.maxRetries) {
      // PR-01: Job was mid-flight when the process died. Re-queue it — transient
      // crashes (OOM, SIGKILL) shouldn't permanently fail a scan. Increment
      // retryCount so we eventually give up after maxRetries attempts.
      const [recovered] = await db
        .update(scanJobsTable)
        .set({
          status: "queued",
          retryCount: job.retryCount + 1,
          error: null,
          startedAt: null,
          finishedAt: null,
          // PR-01: clear lease so the recovering worker can claim cleanly
          workerId: null,
          leaseUntil: null,
          lastHeartbeatAt: null,
        })
        .where(and(eq(scanJobsTable.id, job.id), eq(scanJobsTable.status, "running"), abandonedScan))
        .returning({ id: scanJobsTable.id });

      if (!recovered) {
        logger.debug({ jobId: job.id }, "scan recovery lost ownership race");
        continue;
      }
      // PR-D1: use enqueueWithId to prevent double-execution if another
      // process or a concurrent reconciliation path already enqueued this job.
      heavyJobQueue.enqueueWithId(job.id, () => runScanJob(job.id, job.projectId));
      retriedCount++;
    } else {
      // Exceeded maxRetries — atomically fail the job, restore the project,
      // and append the failure event under the same stale-lease fence.
      const recovered = await terminalizeFailedScanJob({
        jobId: job.id,
        projectId: job.projectId,
        error: `${ORPHANED_RUNNING_MESSAGE} (retry limit of ${job.maxRetries} exceeded)`,
        guard: abandonedScan,
      });
      if (!recovered) {
        logger.debug({ jobId: job.id }, "scan failure recovery lost ownership race");
        continue;
      }
      failedCount++;
    }
  }

  if (running.length > 0) {
    const runningIds         = running.map((j) => j.id);
    const runningProjectIds  = [...new Set(running.map((j) => j.projectId))];
    logger.warn(
      {
        count: running.length,
        retried: retriedCount,
        failed: failedCount,
        jobIds: runningIds,
        projectIds: runningProjectIds,
      },
      "reconciled interrupted scan jobs after restart: retried or failed",
    );
  }

  // ── 2. Queued → re-enqueue ────────────────────────────────────────────────
  // These jobs were waiting for a free slot in heavyJobQueue and never
  // started. All parameters needed to run them (project_id) are already in
  // the DB row, so we can safely re-enqueue them as if the route had just
  // been called. The project stays "scanning" — it is still going to scan.
  const queued = await db
    .select({ id: scanJobsTable.id, projectId: scanJobsTable.projectId })
    .from(scanJobsTable)
    .where(eq(scanJobsTable.status, "queued"));

  for (const job of queued) {
    // PR-D1: enqueueWithId deduplicates — skips jobs already added by the
    // running→re-queued path above (retryCount < maxRetries branch).
    heavyJobQueue.enqueueWithId(job.id, () => runScanJob(job.id, job.projectId));
  }

  if (queued.length > 0) {
    const queuedIds = queued.map((j) => j.id);
    logger.info(
      { count: queued.length, jobIds: queuedIds },
      "re-enqueued orphaned queued scan jobs (process restart)",
    );
  }

  return running.length + queued.length;
}

/**
 * Handles discovery_sessions left in non-terminal states:
 *   "discovering" → mark error (was running when process died)
 *   "pending"     → re-enqueue (never started; rootPath is in the DB row)
 *
 * Returns total number of sessions handled (failed + re-enqueued).
 */
async function reconcileDiscoverySessions(): Promise<number> {
  const now = databaseNow();
  const abandonedDiscovery = or(
    lt(discoverySessionsTable.leaseUntil, databaseNow()),
    isNull(discoverySessionsTable.leaseUntil),
  );

  // ── 1. Discovering → error ────────────────────────────────────────────────
  // These sessions were actively running the discovery pipeline. Their
  // intermediate state (in-memory steps, partial walk results) is gone.
  const discovering = await db
    .select({ id: discoverySessionsTable.id })
    .from(discoverySessionsTable)
    .where(and(eq(discoverySessionsTable.status, "discovering"), abandonedDiscovery));

    for (const session of discovering) {
      const [recovered] = await db
      .update(discoverySessionsTable)
      .set({
        status: "error",
        error: ORPHANED_RUNNING_MESSAGE,
        completedAt: now,
        // PR-01: clear lease so the row no longer appears as "in-flight"
        workerId: null,
        leaseUntil: null,
        lastHeartbeatAt: null,
      })
        .where(and(eq(discoverySessionsTable.id, session.id), eq(discoverySessionsTable.status, "discovering"), abandonedDiscovery))
        .returning({ id: discoverySessionsTable.id });
      if (!recovered) {
        logger.debug({ sessionId: session.id }, "discovery recovery lost ownership race");
        continue;
      }
  }

  if (discovering.length > 0) {
    const discoveringIds = discovering.map((s) => s.id);
    logger.warn(
      { count: discovering.length, sessionIds: discoveringIds },
      "marked interrupted discovery sessions as error (process restart)",
    );
  }

  // ── 2. Pending → re-enqueue ───────────────────────────────────────────────
  // These sessions were created (DB row exists) but were waiting for a free
  // slot in heavyJobQueue and never actually started. rootPath is persisted
  // on the row. runDiscovery will transition the session to "discovering"
  // as its first action, and will fail fast at "Finding repository" if the
  // rootPath no longer exists (e.g. a git-clone temp dir that was cleaned up
  // after a crash), giving the user a clear error message.
  const pending = await db
    .select({ id: discoverySessionsTable.id, rootPath: discoverySessionsTable.rootPath })
    .from(discoverySessionsTable)
    .where(eq(discoverySessionsTable.status, "pending"));

  for (const session of pending) {
    const { id: sessionId, rootPath } = session;
    // PR-D1: use enqueueWithId so a concurrent route handler or a second
    // reconciliation pass cannot enqueue the same session twice.
    heavyJobQueue.enqueueWithId(sessionId, async () => {
      try {
        await runDiscovery(sessionId, rootPath);
      } catch (err) {
        // runDiscovery is documented to never throw — reaching here means
        // it broke that contract. Log with session context so on-call can
        // tell whether this is an isolated failure or a queue degradation.
        logger.error(
          { err, sessionId },
          "discovery runner threw past its own error handling on re-queue",
        );
      }
    });
  }

  if (pending.length > 0) {
    const pendingIds = pending.map((s) => s.id);
    logger.info(
      { count: pending.length, sessionIds: pendingIds },
      "re-enqueued pending discovery sessions (process restart)",
    );
  }

  return discovering.length + pending.length;
}

// ── Stale running-job sweep (PR-02 / audit W-002) ────────────────────────────
//
/**
 * A non-null expired lease is immediately stale. Legacy running rows without
 * a lease are handled the same way by startup and periodic recovery. The
 * runner atomically assigns status and lease, so a running row without a lease
 * cannot represent a valid current worker.
 */
function staleScanLeaseCondition() {
  return or(
    lt(scanJobsTable.leaseUntil, databaseNow()),
    isNull(scanJobsTable.leaseUntil),
  )!;
}

/**
 * PR-D1: Timeout for scan_jobs stuck in "queued" state without transitioning
 * to "running". This catches the rare case where the in-memory closure was
 * dropped without a clean restart (hot-reload, signal race, dev watch mode).
 * Default: 15 minutes. Set STALE_PENDING_TIMEOUT_MS env var to override.
 */
export const STALE_PENDING_TIMEOUT_MS = Number(
  process.env.STALE_PENDING_TIMEOUT_MS ?? 15 * 60 * 1000, // 15 minutes
);

const STALE_JOB_SWEEP_INTERVAL_MS = Number(
  process.env.STALE_JOB_SWEEP_INTERVAL_MS ?? 30 * 60 * 1000, // 30 minutes
);

/**
 * How often each API instance looks for durable work that may have been
 * persisted successfully but whose in-process enqueue was lost (for example
 * during a deploy between the DB commit and queue dispatch).
 *
 * This is intentionally separate from the stale-job sweep: dispatching a
 * queued row is cheap and should recover promptly, while timing out a truly
 * running job needs a much longer safety window.
 */
export const DURABLE_JOB_DISPATCH_INTERVAL_MS = Number(
  process.env.DURABLE_JOB_DISPATCH_INTERVAL_MS ?? 10 * 1000,
);

/**
 * Reconcile scan jobs whose lease expired or whose legacy lease is missing.
 * Retry budgets match startup recovery.
 *
 * Safe to call at any time — uses a server-side timestamp comparison so it
 * does not race with legitimate fast-running jobs.
 */
export async function failStaleRunningJobs(): Promise<number> {
  const staleCondition = staleScanLeaseCondition();

  let staleCount = 0;
  let requeuedCount = 0;
  try {
    const staleJobs = await db
      .select({
        id: scanJobsTable.id,
        projectId: scanJobsTable.projectId,
        retryCount: scanJobsTable.retryCount,
        maxRetries: scanJobsTable.maxRetries,
      })
      .from(scanJobsTable)
      .where(
        and(
          eq(scanJobsTable.status, "running"),
          // PR-01: Two stale conditions:
          //   (a) New rows with a lease: worker stopped heartbeating → lease expired.
          //   (b) Legacy rows without a lease: fall back to startedAt time cutoff.
          staleCondition,
        ),
      );

    if (staleJobs.length === 0) return 0;

    for (const job of staleJobs) {
      if (job.retryCount < job.maxRetries) {
        const [requeued] = await db
          .update(scanJobsTable)
          .set({
            status: "queued",
            retryCount: job.retryCount + 1,
            error: null,
            startedAt: null,
            finishedAt: null,
            workerId: null,
            leaseUntil: null,
            lastHeartbeatAt: null,
          })
          .where(and(
            eq(scanJobsTable.id, job.id),
            eq(scanJobsTable.status, "running"),
            staleCondition,
          ))
          .returning({ id: scanJobsTable.id });
        if (!requeued) continue;
        heavyJobQueue.enqueueWithId(job.id, () => runScanJob(job.id, job.projectId));
        requeuedCount++;
        continue;
      }

      const failed = await terminalizeFailedScanJob({
        jobId: job.id,
        projectId: job.projectId,
        error: "Scan worker lease expired or was missing; retry budget exhausted.",
        guard: staleCondition,
      });
      if (!failed) continue;
      staleCount++;
      logger.warn(
        {
          scope: "job-reconciliation",
          code: "STALE_SCAN_LEASE",
          jobId: job.id,
          projectId: job.projectId,
        },
        "stale scan lease exhausted its retry budget — marked as failed",
      );
    }
    if (requeuedCount > 0) {
      logger.warn(
        { requeued: requeuedCount },
        "stale scan jobs requeued within their retry budget",
      );
    }
  } catch (err) {
    logger.error({ err, scope: "job-reconciliation" }, "failStaleRunningJobs failed");
  }
  return staleCount;
}

/**
 * Discovery has no safe checkpoint between pipeline steps. An abandoned
 * session therefore becomes an explicit error once its lease expires rather
 * than remaining "discovering" forever. The conditional update is the
 * ownership fence: a live worker that heartbeats or finishes concurrently
 * wins and is never clobbered by this sweep.
 */
export async function failStaleDiscoverySessions(): Promise<number> {
  const now = databaseNow();
  const abandonedLease = or(
    isNull(discoverySessionsTable.leaseUntil),
    lt(discoverySessionsTable.leaseUntil, databaseNow()),
  )!;
  let failed = 0;
  try {
    const stale = await db
      .select({ id: discoverySessionsTable.id, rootPath: discoverySessionsTable.rootPath })
      .from(discoverySessionsTable)
      .where(and(
        eq(discoverySessionsTable.status, "discovering"),
        abandonedLease,
      ));
    for (const session of stale) {
      const [updated] = await db.update(discoverySessionsTable).set({
        status: "error",
        error: "Discovery worker lease expired; restart discovery to retry.",
        completedAt: now,
        workerId: null,
        leaseUntil: null,
        lastHeartbeatAt: null,
      }).where(and(
        eq(discoverySessionsTable.id, session.id),
        eq(discoverySessionsTable.status, "discovering"),
        abandonedLease,
      )).returning({ id: discoverySessionsTable.id });
      if (!updated) continue;
      failed++;
      logger.warn({
        scope: "job-reconciliation",
        code: "STALE_DISCOVERY_LEASE",
        sessionId: session.id,
      }, "discovery session lease expired — marked as error");
    }
  } catch (err) {
    logger.error({ err, scope: "job-reconciliation" }, "failStaleDiscoverySessions failed");
  }
  return failed;
}

/**
 * Reconcile abandoned AI task workers while the server remains healthy.
 * Recovery is deliberately non-replaying: the task returns to verifying so
 * a new execution can be explicitly started, preserving cancellation and
 * avoiding duplicate model/tool side effects.
 */
export async function reconcileStaleAiTasks(): Promise<number> {
  const now = databaseNow();
  const abandonedLease = or(
    isNull(tasksTable.leaseUntil),
    lt(tasksTable.leaseUntil, databaseNow()),
  )!;
  let recovered = 0;
  try {
    const stale = await db.select({
      id: tasksTable.id,
      projectId: tasksTable.projectId,
      retryCount: tasksTable.retryCount,
      maxRetries: tasksTable.maxRetries,
    }).from(tasksTable).where(and(
      eq(tasksTable.status, "running"),
      abandonedLease,
    ));
    for (const task of stale) {
      const exhausted = task.retryCount >= task.maxRetries;
      const [updated] = await db.update(tasksTable).set({
        status: exhausted ? "failed" : "verifying",
        retryCount: exhausted ? task.retryCount : task.retryCount + 1,
        updatedAt: now,
        completedAt: exhausted ? now : null,
        workerId: null,
        leaseUntil: null,
        lastHeartbeatAt: null,
      }).where(and(
        eq(tasksTable.id, task.id),
        eq(tasksTable.status, "running"),
        abandonedLease,
      )).returning({ id: tasksTable.id });
      if (!updated) continue;
      await db.insert(taskLogsTable).values({
        id: randomUUID(),
        taskId: task.id,
        level: exhausted ? "error" : "warn",
        message: exhausted
          ? "Task failed because its worker lease expired and retry limit was reached."
          : "Task returned to verifying because its worker lease expired; re-trigger to execute.",
        correlationId: randomUUID(),
      });
      invalidateContextCache(task.projectId);
      recovered++;
    }
  } catch (err) {
    logger.error({ err, scope: "job-reconciliation" }, "reconcileStaleAiTasks failed");
  }
  return recovered;
}

/**
 * PR-D1: Re-enqueue scan jobs that have been stuck in "queued" state for
 * longer than `STALE_PENDING_TIMEOUT_MS` without progressing to "running".
 *
 * This is a safety net for the rare case where an in-memory closure was
 * dropped without a clean server restart — for example during a hot-reload
 * in development, a signal race, or a bug in the queue drain logic. Under
 * normal operation (clean restarts) startup reconciliation already handles
 * all "queued" rows, so this sweep should find nothing.
 *
 * Uses `enqueueWithId` so jobs already present in the in-memory queue are
 * skipped — no double-execution risk. The advisory lock inside `runScanJob`
 * provides a second safety net if two closures for the same job do race.
 *
 * Returns the number of jobs re-enqueued.
 */
export async function requeueStalePendingJobs(): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_PENDING_TIMEOUT_MS);
  let requeued = 0;

  try {
    const staleQueued = await db
      .select({ id: scanJobsTable.id, projectId: scanJobsTable.projectId })
      .from(scanJobsTable)
      .where(
        and(
          eq(scanJobsTable.status, "queued"),
          lt(scanJobsTable.createdAt, cutoff),
        ),
      );

    if (staleQueued.length === 0) return 0;

    for (const job of staleQueued) {
      // enqueueWithId returns false if the job is already in the in-memory
      // queue — in that case we skip it silently (it will run shortly).
      const added = heavyJobQueue.enqueueWithId(
        job.id,
        () => runScanJob(job.id, job.projectId),
      );
      if (added) {
        requeued++;
        logger.warn(
          {
            scope: "job-reconciliation",
            code: "STALE_PENDING_REQUEUE",
            jobId: job.id,
            projectId: job.projectId,
            cutoff: cutoff.toISOString(),
            timeoutMs: STALE_PENDING_TIMEOUT_MS,
          },
          "scan job stuck in queued — re-enqueued by stale-pending sweep",
        );
      }
    }
  } catch (err) {
    logger.error({ err, scope: "job-reconciliation" }, "requeueStalePendingJobs failed");
  }

  return requeued;
}

/**
 * Dispatch all durable rows that are waiting to start.
 *
 * The database row is the durable queue record; `heavyJobQueue` is only the
 * local concurrency limiter. Every API instance may observe the same row, so
 * the runners' PostgreSQL advisory locks and atomic claims remain the final
 * duplicate-execution guard.
 *
 * Unlike `requeueStalePendingJobs`, this pass intentionally includes fresh
 * rows. It closes the small failure window where the request committed the
 * durable row but the process died before its fire-and-forget enqueue ran.
 */
let durableDispatchRotation = 0;
let durableDispatchInFlight: Promise<number> | null = null;

export type DurableDispatchStage = {
  name: string;
  run: () => Promise<number>;
};

type DurableDispatchStageOutcome = {
  name: string;
  outcome: "passed" | "failed";
  dispatchedCount: number;
  errorCode?: string;
};

function durableDispatchFailureCode(error: unknown): string {
  const candidate = error && typeof error === "object"
    ? (error as { code?: unknown; name?: unknown }).code
      ?? (error as { name?: unknown }).name
    : undefined;
  return typeof candidate === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(candidate)
    ? candidate
    : "DISPATCH_STAGE_FAILED";
}

async function persistDurableDispatchStageOutcome(
  result: DurableDispatchStageOutcome,
): Promise<void> {
  const now = new Date();
  const stage = durableDispatchStageHealthTable;
  const values = {
    stageName: result.name,
    lastOutcome: result.outcome,
    lastRunAt: now,
    lastSuccessAt: result.outcome === "passed" ? now : null,
    lastFailureAt: result.outcome === "failed" ? now : null,
    consecutiveFailures: result.outcome === "failed" ? 1 : 0,
    lastErrorCode: result.outcome === "failed" ? result.errorCode ?? "DISPATCH_STAGE_FAILED" : null,
    lastDispatchedCount: result.dispatchedCount,
    updatedAt: now,
  };
  try {
    await db.insert(stage).values(values).onConflictDoUpdate({
      target: stage.stageName,
      set: {
        lastOutcome: result.outcome,
        lastRunAt: now,
        ...(result.outcome === "passed" ? { lastSuccessAt: now } : {}),
        ...(result.outcome === "failed" ? {
          lastFailureAt: now,
          lastErrorCode: result.errorCode ?? "DISPATCH_STAGE_FAILED",
          consecutiveFailures: sql`${stage.consecutiveFailures} + 1`,
        } : { consecutiveFailures: 0 }),
        lastDispatchedCount: result.dispatchedCount,
        updatedAt: now,
      },
    });
  } catch (error) {
    logger.error(
      { error, dispatcher: result.name, scope: "job-reconciliation" },
      "could not persist durable dispatch stage health",
    );
  }
}

export async function runDurableDispatchStages(
  stages: readonly DurableDispatchStage[],
  startAt = 0,
  onOutcome?: (result: DurableDispatchStageOutcome) => Promise<void>,
): Promise<{ dispatched: number; counts: Record<string, number> }> {
  if (stages.length === 0) return { dispatched: 0, counts: {} };
  const normalizedStart = ((startAt % stages.length) + stages.length) % stages.length;
  const counts: Record<string, number> = {};
  let dispatched = 0;
  for (let offset = 0; offset < stages.length; offset++) {
    const stage = stages[(normalizedStart + offset) % stages.length]!;
    try {
      const count = await stage.run();
      counts[stage.name] = count;
      dispatched += count;
      await onOutcome?.({
        name: stage.name,
        outcome: "passed",
        dispatchedCount: count,
      }).catch((error: unknown) => {
        logger.error(
          { error, dispatcher: stage.name, scope: "job-reconciliation" },
          "durable dispatch outcome callback failed",
        );
      });
    } catch (err) {
      counts[stage.name] = 0;
      logger.error(
        { err, dispatcher: stage.name, scope: "job-reconciliation" },
        "durable job dispatcher stage failed; continuing with other stages",
      );
      await onOutcome?.({
        name: stage.name,
        outcome: "failed",
        dispatchedCount: 0,
        errorCode: durableDispatchFailureCode(err),
      }).catch((outcomeError: unknown) => {
        logger.error(
          { error: outcomeError, dispatcher: stage.name, scope: "job-reconciliation" },
          "durable dispatch failure outcome could not be recorded",
        );
      });
    }
  }
  return { dispatched, counts };
}

export function dispatchPersistedPendingJobs(): Promise<number> {
  if (durableDispatchInFlight) return durableDispatchInFlight;
  const pass = dispatchPersistedPendingJobsOnce();
  let shared: Promise<number>;
  shared = pass.finally(() => {
    if (durableDispatchInFlight === shared) durableDispatchInFlight = null;
  });
  durableDispatchInFlight = shared;
  return shared;
}

async function dispatchPersistedPendingJobsOnce(): Promise<number> {
  const pageLimit = 100;
  const stages: DurableDispatchStage[] = [
    {
      name: "scans",
      run: async () => {
        const limit = Math.min(heavyJobQueue.availablePendingCapacity, pageLimit);
        if (limit === 0) return 0;
        const rows = await db
          .select({ id: scanJobsTable.id, projectId: scanJobsTable.projectId })
          .from(scanJobsTable)
          .where(eq(scanJobsTable.status, "queued"))
          .orderBy(asc(scanJobsTable.createdAt), asc(scanJobsTable.id))
          .limit(limit);
        let added = 0;
        for (const job of rows) {
          const result = heavyJobQueue.enqueueWithIdDetailed(
            job.id,
            () => runScanJob(job.id, job.projectId),
          );
          if (result === "full") break;
          if (result === "enqueued") added++;
        }
        return added;
      },
    },
    {
      name: "discoveries",
      run: async () => {
        const limit = Math.min(heavyJobQueue.availablePendingCapacity, pageLimit);
        if (limit === 0) return 0;
        const rows = await db
          .select({ id: discoverySessionsTable.id, rootPath: discoverySessionsTable.rootPath })
          .from(discoverySessionsTable)
          .where(eq(discoverySessionsTable.status, "pending"))
          .orderBy(asc(discoverySessionsTable.startedAt), asc(discoverySessionsTable.id))
          .limit(limit);
        let added = 0;
        for (const session of rows) {
          const result = heavyJobQueue.enqueueWithIdDetailed(session.id, async () => {
            try {
              await runDiscovery(session.id, session.rootPath);
            } catch (err) {
              logger.error(
                { err, sessionId: session.id },
                "discovery runner threw past its own error handling in durable dispatch",
              );
            }
          });
          if (result === "full") break;
          if (result === "enqueued") added++;
        }
        return added;
      },
    },
    { name: "deferred-ai-task-executions", run: () => dispatchDeferredAiTaskExecutions(pageLimit) },
    {
      name: "task-acceptance-observations",
      run: () => dispatchPendingTaskObservationOutbox(pageLimit),
    },
    { name: "task-recovery", run: () => dispatchAutonomousTaskRecoveries() },
    { name: "mission-replans", run: () => reconcileAutomaticMissionReplans() },
    { name: "decision-dispatch", run: () => reconcileApprovedMissionDecisionDispatches() },
    { name: "mission-recipes", run: () => dispatchPendingMissionRecipes() },
    { name: "mission-events", run: () => replayPendingMissionEvents() },
    { name: "shadow-replays", run: () => dispatchPendingShadowReplays() },
    { name: "chat-handoffs", run: () => dispatchPendingMissionChatHandoffs() },
    { name: "project-bootstrap", run: () => dispatchProjectBootstrapJobs() },
    { name: "plugin-runs", run: () => dispatchPendingPluginRuns() },
    { name: "mission-outcomes", run: () => reconcileMissionPlanOutcomesIfDue() },
    { name: "decision-shadows", run: () => reconcileMissionDecisionShadowsIfDue() },
  ];

  const startAt = durableDispatchRotation % stages.length;
  durableDispatchRotation = (startAt + 1) % stages.length;
  const { dispatched, counts } = await runDurableDispatchStages(
    stages,
    startAt,
    persistDurableDispatchStageOutcome,
  );

  if (dispatched > 0) {
    logger.info(
      { dispatched, ...counts },
      "durable job dispatcher: persisted pending work dispatched",
    );
  }
  return dispatched;
}

/** Content-free durable queue health for operators and health checks. */
export async function getDurableJobHealth(): Promise<{
  status: "healthy" | "degraded";
  queuedScanJobs: number;
  pendingDiscoverySessions: number;
  staleQueuedScanJobs: number;
  stalePendingDiscoverySessions: number;
  expiredScanLeases: number;
  expiredDiscoveryLeases: number;
  expiredTaskLeases: number;
  retryExhaustedScanJobs: number;
  retryExhaustedTasks: number;
  pendingAiTaskDispatches: number;
  deferredAiTaskDispatches: number;
  deferredAiTaskDispatchesByReason: Array<{ reasonCode: string; count: number }>;
  staleAiTaskDispatches: number;
  oldestAiTaskDispatchAt: string | null;
  failedDispatchStages: number;
  pendingTaskObservationMaterializations: number;
  staleTaskObservationMaterializations: number;
  expiredTaskObservationLeases: number;
  failedTaskObservationMaterializations: number;
  deadLetteredTaskObservationMaterializations: number;
  dispatchStages: Array<{
    stageName: string;
    lastOutcome: string;
    lastRunAt: string;
    lastSuccessAt: string | null;
    lastFailureAt: string | null;
    consecutiveFailures: number;
    lastErrorCode: string | null;
    lastDispatchedCount: number;
  }>;
}> {
  const now = databaseNow();
  const stalePendingCutoff = sql<Date>`(clock_timestamp() AT TIME ZONE 'UTC') - (${STALE_PENDING_TIMEOUT_MS} * interval '1 millisecond')`;
  try {
    const [
      [queuedScans],
      [pendingDiscoveries],
      [staleQueuedScans],
      [stalePendingDiscoveries],
      [expiredScans],
      [expiredDiscoveries],
      [expiredTasks],
      [exhaustedScans],
      [exhaustedTasks],
      [requestedAiTaskDispatches],
      [deferredAiTaskDispatches],
      deferredAiTaskDispatchReasonRows,
      [staleAiTaskDispatches],
      [oldestAiTaskDispatch],
      [failedStages],
      stageRows,
      [pendingObservationRows],
      [staleObservationRows],
      [expiredObservationLeases],
      [failedObservationRows],
      [deadLetterObservationRows],
    ] = await Promise.all([
      db.select({ value: count() }).from(scanJobsTable).where(eq(scanJobsTable.status, "queued")),
      db.select({ value: count() }).from(discoverySessionsTable).where(eq(discoverySessionsTable.status, "pending")),
      db.select({ value: count() }).from(scanJobsTable).where(and(
        eq(scanJobsTable.status, "queued"),
        lt(scanJobsTable.createdAt, stalePendingCutoff),
      )),
      db.select({ value: count() }).from(discoverySessionsTable).where(and(
        eq(discoverySessionsTable.status, "pending"),
        lt(discoverySessionsTable.startedAt, stalePendingCutoff),
      )),
      db.select({ value: count() }).from(scanJobsTable).where(and(
        eq(scanJobsTable.status, "running"),
        staleScanLeaseCondition(),
      )),
      db.select({ value: count() }).from(discoverySessionsTable).where(and(
        eq(discoverySessionsTable.status, "discovering"),
        or(isNull(discoverySessionsTable.leaseUntil), lt(discoverySessionsTable.leaseUntil, now)),
      )),
      db.select({ value: count() }).from(tasksTable).where(and(
        eq(tasksTable.status, "running"),
        or(isNull(tasksTable.leaseUntil), lt(tasksTable.leaseUntil, now)),
      )),
      db.select({ value: count() }).from(scanJobsTable).where(and(eq(scanJobsTable.status, "failed"), eq(scanJobsTable.retryCount, scanJobsTable.maxRetries))),
      db.select({ value: count() }).from(tasksTable).where(and(eq(tasksTable.status, "failed"), eq(tasksTable.retryCount, tasksTable.maxRetries))),
      db.select({ value: count() }).from(eventsTable)
        .where(eq(eventsTable.type, "TaskAutoExecutionDispatchRequested")),
      db.select({ value: count() }).from(eventsTable)
        .where(eq(eventsTable.type, "TaskAutoExecutionDeferred")),
      db.select({
        reasonCode: sql<string>`CASE
          WHEN left(${eventsTable.payload}->>'lastFailureCode', 8) = 'mission_' THEN 'MISSION_GATE_BLOCKED'
          WHEN ${eventsTable.payload}->>'lastFailureCode' IN ('execution_identity_changed', 'execution_already_claimed', 'invalid_task_transition') THEN 'EXECUTION_IDENTITY_CONFLICT'
          WHEN ${eventsTable.payload}->>'lastFailureCode' = 'LOCAL_QUEUE_FULL' THEN 'LOCAL_QUEUE_FULL'
          WHEN ${eventsTable.payload}->>'lastFailureCode' = 'PROJECT_RATE_LIMITED' THEN 'PROJECT_RATE_LIMITED'
          WHEN ${eventsTable.payload}->>'lastFailureCode' = 'PROVIDER_NOT_CONFIGURED' THEN 'PROVIDER_NOT_CONFIGURED'
          WHEN ${eventsTable.payload}->>'lastFailureCode' = 'TASK_GENERATION_MISMATCH' THEN 'TASK_GENERATION_MISMATCH'
          WHEN ${eventsTable.payload}->>'lastFailureCode' = 'AUTO_EXECUTION_PRECLAIM_FAILED' THEN 'PRECLAIM_FAILURE'
          ELSE 'OTHER'
        END`,
        value: count(),
      }).from(eventsTable)
        .where(eq(eventsTable.type, "TaskAutoExecutionDeferred"))
        .groupBy(sql`CASE
          WHEN left(${eventsTable.payload}->>'lastFailureCode', 8) = 'mission_' THEN 'MISSION_GATE_BLOCKED'
          WHEN ${eventsTable.payload}->>'lastFailureCode' IN ('execution_identity_changed', 'execution_already_claimed', 'invalid_task_transition') THEN 'EXECUTION_IDENTITY_CONFLICT'
          WHEN ${eventsTable.payload}->>'lastFailureCode' = 'LOCAL_QUEUE_FULL' THEN 'LOCAL_QUEUE_FULL'
          WHEN ${eventsTable.payload}->>'lastFailureCode' = 'PROJECT_RATE_LIMITED' THEN 'PROJECT_RATE_LIMITED'
          WHEN ${eventsTable.payload}->>'lastFailureCode' = 'PROVIDER_NOT_CONFIGURED' THEN 'PROVIDER_NOT_CONFIGURED'
          WHEN ${eventsTable.payload}->>'lastFailureCode' = 'TASK_GENERATION_MISMATCH' THEN 'TASK_GENERATION_MISMATCH'
          WHEN ${eventsTable.payload}->>'lastFailureCode' = 'AUTO_EXECUTION_PRECLAIM_FAILED' THEN 'PRECLAIM_FAILURE'
          ELSE 'OTHER'
        END`),
      db.select({ value: count() }).from(eventsTable)
        .leftJoin(tasksTable, eq(eventsTable.taskId, tasksTable.id))
        .where(and(
          inArray(eventsTable.type, [
            "TaskAutoExecutionDispatchRequested",
            "TaskAutoExecutionDeferred",
          ]),
          or(
            // Orphans and Tasks that have left verifying are immediately
            // stale: the dispatcher cannot legitimately execute them.
            isNull(tasksTable.id),
            ne(tasksTable.status, "verifying"),
            and(
              eq(tasksTable.status, "verifying"),
              lt(eventsTable.timestamp, stalePendingCutoff),
              or(
                eq(eventsTable.type, "TaskAutoExecutionDispatchRequested"),
                sql`(
                  ${eventsTable.payload}->>'nextAttemptAt' IS NULL
                  OR ${eventsTable.payload}->>'nextAttemptAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
                  OR ${eventsTable.payload}->>'nextAttemptAt' <= ${now.toISOString()}
                )`,
              ),
            ),
          ),
        )),
      db.select({ value: min(eventsTable.timestamp) }).from(eventsTable)
        .where(inArray(eventsTable.type, [
          "TaskAutoExecutionDispatchRequested",
          "TaskAutoExecutionDeferred",
        ])),
      db.select({ value: count() }).from(durableDispatchStageHealthTable)
        .where(eq(durableDispatchStageHealthTable.lastOutcome, "failed")),
      db.select({
        stageName: durableDispatchStageHealthTable.stageName,
        lastOutcome: durableDispatchStageHealthTable.lastOutcome,
        lastRunAt: durableDispatchStageHealthTable.lastRunAt,
        lastSuccessAt: durableDispatchStageHealthTable.lastSuccessAt,
        lastFailureAt: durableDispatchStageHealthTable.lastFailureAt,
        consecutiveFailures: durableDispatchStageHealthTable.consecutiveFailures,
        lastErrorCode: durableDispatchStageHealthTable.lastErrorCode,
        lastDispatchedCount: durableDispatchStageHealthTable.lastDispatchedCount,
      }).from(durableDispatchStageHealthTable).orderBy(asc(durableDispatchStageHealthTable.stageName)),
      db.select({ value: count() }).from(taskExecutionObservationOutboxTable)
        .where(eq(taskExecutionObservationOutboxTable.status, "pending")),
      db.select({ value: count() }).from(taskExecutionObservationOutboxTable)
        .where(and(
          eq(taskExecutionObservationOutboxTable.status, "pending"),
          lt(taskExecutionObservationOutboxTable.createdAt, stalePendingCutoff),
        )),
      db.select({ value: count() }).from(taskExecutionObservationOutboxTable)
        .where(and(
          eq(taskExecutionObservationOutboxTable.status, "running"),
          or(
            isNull(taskExecutionObservationOutboxTable.leaseUntil),
            lt(taskExecutionObservationOutboxTable.leaseUntil, now),
          ),
        )),
      db.select({ value: count() }).from(taskExecutionObservationOutboxTable)
        .where(and(
          eq(taskExecutionObservationOutboxTable.status, "pending"),
          gt(taskExecutionObservationOutboxTable.attemptCount, 0),
        )),
      db.select({ value: count() }).from(taskExecutionObservationOutboxTable)
        .where(eq(taskExecutionObservationOutboxTable.status, "dead_letter")),
    ]);
    const values = {
      queuedScanJobs: Number(queuedScans.value),
      pendingDiscoverySessions: Number(pendingDiscoveries.value),
      staleQueuedScanJobs: Number(staleQueuedScans.value),
      stalePendingDiscoverySessions: Number(stalePendingDiscoveries.value),
      expiredScanLeases: Number(expiredScans.value),
      expiredDiscoveryLeases: Number(expiredDiscoveries.value),
      expiredTaskLeases: Number(expiredTasks.value),
      retryExhaustedScanJobs: Number(exhaustedScans.value),
      retryExhaustedTasks: Number(exhaustedTasks.value),
      pendingAiTaskDispatches: Number(requestedAiTaskDispatches.value),
      deferredAiTaskDispatches: Number(deferredAiTaskDispatches.value),
      deferredAiTaskDispatchesByReason: deferredAiTaskDispatchReasonRows.map((row) => ({
        reasonCode: row.reasonCode,
        count: Number(row.value),
      })),
      staleAiTaskDispatches: Number(staleAiTaskDispatches.value),
      oldestAiTaskDispatchAt: oldestAiTaskDispatch.value?.toISOString() ?? null,
      failedDispatchStages: Number(failedStages.value),
      pendingTaskObservationMaterializations: Number(pendingObservationRows.value),
      staleTaskObservationMaterializations: Number(staleObservationRows.value),
      expiredTaskObservationLeases: Number(expiredObservationLeases.value),
      failedTaskObservationMaterializations: Number(failedObservationRows.value),
      deadLetteredTaskObservationMaterializations: Number(deadLetterObservationRows.value),
      dispatchStages: stageRows.map((row) => ({
        stageName: row.stageName,
        lastOutcome: row.lastOutcome,
        lastRunAt: row.lastRunAt.toISOString(),
        lastSuccessAt: row.lastSuccessAt?.toISOString() ?? null,
        lastFailureAt: row.lastFailureAt?.toISOString() ?? null,
        consecutiveFailures: row.consecutiveFailures,
        lastErrorCode: row.lastErrorCode,
        lastDispatchedCount: row.lastDispatchedCount,
      })),
    };
    const needsAttention =
      values.staleQueuedScanJobs > 0
      || values.stalePendingDiscoverySessions > 0
      || values.expiredScanLeases + values.expiredDiscoveryLeases + values.expiredTaskLeases > 0
      || values.retryExhaustedScanJobs + values.retryExhaustedTasks > 0
      || values.staleAiTaskDispatches > 0
      || values.failedDispatchStages > 0
      || values.staleTaskObservationMaterializations > 0
      || values.expiredTaskObservationLeases > 0
      || values.failedTaskObservationMaterializations > 0
      || values.deadLetteredTaskObservationMaterializations > 0;
    return { status: needsAttention ? "degraded" : "healthy", ...values };
  } catch (error) {
    logger.error({ error, scope: "job-reconciliation" }, "durable job health query failed");
    return {
      status: "degraded",
      queuedScanJobs: 0,
      pendingDiscoverySessions: 0,
      staleQueuedScanJobs: 0,
      stalePendingDiscoverySessions: 0,
      expiredScanLeases: 0,
      expiredDiscoveryLeases: 0,
      expiredTaskLeases: 0,
      retryExhaustedScanJobs: 0,
      retryExhaustedTasks: 0,
      pendingAiTaskDispatches: 0,
      deferredAiTaskDispatches: 0,
      deferredAiTaskDispatchesByReason: [],
      staleAiTaskDispatches: 0,
      oldestAiTaskDispatchAt: null,
      failedDispatchStages: 0,
      pendingTaskObservationMaterializations: 0,
      staleTaskObservationMaterializations: 0,
      expiredTaskObservationLeases: 0,
      failedTaskObservationMaterializations: 0,
      deadLetteredTaskObservationMaterializations: 0,
      dispatchStages: [],
    };
  }
}

/**
 * Keep persisted pending work flowing while the server is alive. This
 * complements startup reconciliation and also lets a healthy instance recover
 * work written by another instance that died before local dispatch.
 */
export function startDurableJobDispatcher(): NodeJS.Timeout {
  logger.info(
    { intervalMs: DURABLE_JOB_DISPATCH_INTERVAL_MS },
    "durable job dispatcher scheduled",
  );

  void dispatchPersistedPendingJobs();
  void wakeDueMissionGoals();
  void wakeReadyMissionGoals();
  void wakeRuntimeTransitionMissionGoals();
  void retryTransitionsAndReconcileApplyGoals();
  return setInterval(() => {
    void dispatchPersistedPendingJobs();
    void wakeDueMissionGoals();
    void wakeReadyMissionGoals();
    void wakeRuntimeTransitionMissionGoals();
    void retryTransitionsAndReconcileApplyGoals();
  }, DURABLE_JOB_DISPATCH_INTERVAL_MS);
}

/**
 * Release-test worker that is pinned to one explicitly assigned project.
 * It intentionally avoids the general scan/discovery/runtime/stale-job
 * sweepers; only Mission lifecycle work for this project is dispatched.
 */
export function startScopedMissionLifecycleDispatcher(
  projectId: string,
): NodeJS.Timeout {
  const dispatch = async () => {
    try {
      await dispatchAutonomousTaskRecoveries({ projectId });
      await reconcileAutomaticMissionReplans(16, projectId);
      await reconcileMissionPlanOutcomesIfDue(projectId);
      await reconcileMissionDecisionShadowsIfDue(projectId);
      await dispatchPendingMissionRecipes(32, projectId);
      await replayPendingMissionEvents(32, projectId);
      await dispatchPendingShadowReplays(32, projectId);
      await dispatchPendingMissionChatHandoffs(32, projectId);
      await wakeDueMissionGoals(32, projectId);
      await wakeReadyMissionGoals(32, projectId);
      await wakeRuntimeTransitionMissionGoals(32, projectId);
      await wakeApplyChangesMissionGoals(32, projectId);
    } catch (err) {
      logger.error(
        { err, projectId },
        "scoped lifecycle worker dispatch failed",
      );
    }
  };

  logger.info(
    { projectId, intervalMs: DURABLE_JOB_DISPATCH_INTERVAL_MS },
    "project-scoped lifecycle dispatcher scheduled",
  );
  void dispatch();
  return setInterval(() => void dispatch(), DURABLE_JOB_DISPATCH_INTERVAL_MS);
}

async function retryTransitionsAndReconcileApplyGoals(): Promise<void> {
  try {
    await retryPendingRuntimeStartTransitions();
    await wakeApplyChangesMissionGoals();
  } catch (error) {
    logger.warn(
      { error },
      "apply Mission transition reconciliation failed",
    );
  }
}

/**
 * Start the periodic stale-job sweep. Returns the interval handle so the
 * caller can clear it on graceful shutdown if needed.
 *
 * PR-D1: Now runs both `failStaleRunningJobs` (hung running jobs) and
 * `requeueStalePendingJobs` (lost queued closures) on each tick.
 */
export function startStaleJobSweep(): NodeJS.Timeout {
  logger.info(
    {
      intervalMs: STALE_JOB_SWEEP_INTERVAL_MS,
      pendingTimeoutMs: STALE_PENDING_TIMEOUT_MS,
    },
    "stale-job sweep scheduled",
  );
  return setInterval(async () => {
    const [
      failed,
      requeued,
      failedDiscoveries,
      recoveredTasks,
      reconciledAiExecutions,
      expiredUploads,
      wokenGoals,
      wokenDependencyGoals,
    ] = await Promise.all([
      failStaleRunningJobs(),
      requeueStalePendingJobs(),
      failStaleDiscoverySessions(),
      reconcileStaleAiTasks(),
      reconcileAiExecutions({ expiredOnly: true }),
      sweepExpiredUploads(),
      wakeDueMissionGoals(),
      wakeReadyMissionGoals(),
      wakeRuntimeTransitionMissionGoals(),
      retryTransitionsAndReconcileApplyGoals(),
    ]);
    if (failed > 0) {
      logger.warn({ failed }, "stale-job sweep: timed out running scan jobs marked failed");
    }
    if (requeued > 0) {
      logger.warn({ requeued }, "stale-job sweep: stale pending scan jobs re-enqueued");
    }
    if (failedDiscoveries > 0 || recoveredTasks > 0) {
      logger.warn({ failedDiscoveries, recoveredTasks }, "stale-job sweep: abandoned work reconciled");
    }
    if (reconciledAiExecutions > 0) {
      logger.warn(
        { reconciledAiExecutions },
        "stale-job sweep: expired AI execution leases reconciled",
      );
    }
    if (expiredUploads > 0) {
      logger.info({ expiredUploads }, "stale-job sweep: expired upload entries removed");
    }
    if (wokenGoals > 0 || wokenDependencyGoals > 0) {
      logger.info(
        { wokenGoals, wokenDependencyGoals },
        "stale-job sweep: Mission Goals woken",
      );
    }
  }, STALE_JOB_SWEEP_INTERVAL_MS);
}

/**
 * Handles tasks left in "running" state after a process crash.
 *
 * AI task execution (scheduleAiTaskExecution) claims verifying → running,
 * then calls the Groq agent. The inner try/catch rolls back to "verifying"
 * on normal execution failure, but a hard crash (SIGKILL, OOM) bypasses that
 * rollback, leaving the task permanently stuck in "running".
 *
 * Treatment:
 *   "running" + retryCount < maxRetries → reset to "verifying" (re-triggerable)
 *   "running" + retryCount >= maxRetries → mark "failed" (give up)
 *
 * We never auto-re-execute here because:
 *   1. We don't have the userId needed to resolve a Groq API key.
 *   2. The agent may have applied partial changes — the user should review first.
 *
 * Resetting to "verifying" makes the task visible on the dashboard and allows
 * the user or the auto-trigger to re-execute it cleanly.
 */
async function reconcileAiTasks(): Promise<number> {
  const now = databaseNow();
  const abandonedTask = or(
    lt(tasksTable.leaseUntil, databaseNow()),
    isNull(tasksTable.leaseUntil),
  );

  const runningTasks = await db
    .select({
      id: tasksTable.id,
      projectId: tasksTable.projectId,
      title: tasksTable.title,
      retryCount: tasksTable.retryCount,
      maxRetries: tasksTable.maxRetries,
    })
    .from(tasksTable)
    .where(and(eq(tasksTable.status, "running"), abandonedTask));

  if (runningTasks.length === 0) return 0;

  let resetCount = 0;
  let failedCount = 0;

  for (const task of runningTasks) {
    const correlationId = randomUUID();

    if (task.retryCount < task.maxRetries) {
      // Reset to verifying so the task can be re-triggered. The AI call was
      // interrupted mid-flight — we can't resume, but we can let it run again.
      const [resetTask] = await db
        .update(tasksTable)
        .set({
          status: "verifying",
          retryCount: task.retryCount + 1,
          updatedAt: now,
          // PR-01: clear lease so the task can be re-claimed on next execution
          workerId: null,
          leaseUntil: null,
          lastHeartbeatAt: null,
        })
        .where(and(eq(tasksTable.id, task.id), eq(tasksTable.status, "running"), abandonedTask))
        .returning({ id: tasksTable.id });

      if (!resetTask) {
        logger.warn(
          {
            scope: "job-reconciliation",
            code: "AI_TASK_RESET_CONFLICT",
            taskId: task.id,
            projectId: task.projectId,
            correlationId,
          },
          "running AI task changed concurrently during reconciliation; reset skipped",
        );
      }

      if (resetTask) {
        invalidateContextCache(task.projectId);
        await db.insert(taskLogsTable).values({
          id: randomUUID(),
          taskId: task.id,
          level: "warn",
          message: `Task reset to "verifying" after process restart (retry ${task.retryCount + 1}/${task.maxRetries}). Re-trigger to execute.`,
          correlationId,
        });
        resetCount++;
      }
    } else {
      // Exceeded maxRetries — mark permanently failed.
      const [failedTask] = await db
        .update(tasksTable)
        .set({
          status: "failed",
          updatedAt: now,
          completedAt: now,
          // PR-01: clear lease on permanent failure
          workerId: null,
          leaseUntil: null,
          lastHeartbeatAt: null,
        })
        .where(and(eq(tasksTable.id, task.id), eq(tasksTable.status, "running"), abandonedTask))
        .returning({ id: tasksTable.id });

      if (!failedTask) {
        logger.warn(
          {
            scope: "job-reconciliation",
            code: "AI_TASK_FAIL_CONFLICT",
            taskId: task.id,
            projectId: task.projectId,
            correlationId,
          },
          "running AI task changed concurrently during reconciliation; failure write skipped",
        );
      }

      if (failedTask) {
        await db.insert(taskLogsTable).values({
          id: randomUUID(),
          taskId: task.id,
          level: "error",
          message: `Task permanently failed after process restart: retry limit of ${task.maxRetries} exceeded. ${ORPHANED_RUNNING_MESSAGE}`,
          correlationId,
        });
        invalidateContextCache(task.projectId);
        failedCount++;
      }
    }
  }

  logger.warn(
    {
      count: runningTasks.length,
      reset: resetCount,
      failed: failedCount,
      taskIds: runningTasks.map((t) => t.id),
    },
    "reconciled interrupted AI tasks after restart: reset to verifying or failed",
  );

  return runningTasks.length;
}

/**
 * Runs all startup reconciliation passes. Never throws — a reconciliation
 * bug must not prevent the server from starting.
 */
export async function reconcileStuckJobs(): Promise<{
  scanJobs: number;
  discoverySessions: number;
  aiTasks: number;
  aiExecutions: number;
  deliveries: number;
  expiredUploads: number;
}> {
  try {
    const [
      scanJobs,
      discoverySessions,
      aiTasks,
      expiredUploads,
      githubDeliveryRecoveries,
    ] = await Promise.all([
      reconcileScanJobs(),
      reconcileDiscoverySessions(),
      reconcileAiTasks(),
      sweepExpiredUploads(),
      reconcileInterruptedGitHubDeliveryAttempts(),
    ]);
    // Apply reconciliation depends on execution lease reconciliation. Keep
    // both passes ordered so the delivery reconciler cannot race a proof-bound
    // apply and automatically write files from its promotion journal.
    const aiExecutions = await reconcileAiExecutions({ expiredOnly: true });
    const applyRecovery = await reconcileInterruptedApplyChanges();
    const legacyDeliveries = await reconcileInterruptedDeliveries(applyRecovery.protectedProposalIds);
    const deliveries = legacyDeliveries + applyRecovery.reconciled + githubDeliveryRecoveries;
    if (applyRecovery.reconciled > 0) {
      logger.info(
        { applyChanges: applyRecovery.reconciled },
        "startup reconciliation: proof-bound apply states reconciled without filesystem writes",
      );
    }
    if (aiExecutions > 0) {
      logger.info({ aiExecutions }, "startup reconciliation: paused interrupted AI executions");
    }
    if (expiredUploads > 0) {
      logger.info({ expiredUploads }, "startup reconciliation: expired upload entries swept");
    }
    return { scanJobs, discoverySessions, aiTasks, aiExecutions, deliveries, expiredUploads };
  } catch (err) {
    logger.error({ err }, "startup job reconciliation failed");
    return { scanJobs: 0, discoverySessions: 0, aiTasks: 0, aiExecutions: 0, deliveries: 0, expiredUploads: 0 };
  }
}
