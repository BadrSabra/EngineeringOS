/**
 * The actual heavy work of a project scan: file walk, rule matching, graph
 * extraction, and metrics computation. Extracted out of the route handler so
 * it can run out-of-band (see routes/projects.ts) instead of blocking the
 * HTTP response for however long a full project scan takes.
 */
import { db } from "@workspace/db";
import {
  projectsTable,
  scanJobsTable,
  tasksTable,
  eventsTable,
  metricsTable,
  rulesTable,
  graphEntitiesTable,
  graphRelationshipsTable,
} from "@workspace/db";
import { eq, and, or, isNull, inArray } from "drizzle-orm";
import { randomUUID } from "crypto";
import { walkProject, matchRules, extractGraph, computeMetrics, SCANNER_VERSION, type RuleInput } from "@workspace/scanner";
import { invalidateContextCache } from "@workspace/ai-orchestrator";
import { recordAudit } from "./audit.js";
import {
  dispatchOnScanComplete,
  type ExtractedEntity,
  type RuleViolationSummary,
} from "./plugin-runtime.js";
import { logger } from "./logger.js";
import { establishProjectRoot, type EstablishRootFailureReason } from "./project-root.js";
import { tryAdvisoryLock, LockNamespace } from "./advisory-lock.js";
import { heavyJobQueue } from "./job-queue.js";
import { provenanceFromEntity, provenanceFromRelationship, manualProvenance } from "./graph-provenance.js";
import {
  claimScanJob,
  heartbeatScanJob,
  failScanJob,
  persistScanJobTransaction,
  SCAN_LEASE_MS,
  SCAN_HEARTBEAT_INTERVAL_MS,
  ScanJobLeaseLostError,
  type ScanJobTransaction,
} from "./job-lease.js";
import {
  buildRemediationPlan,
  buildRemediationPrompt,
} from "./remediation-plan.js";

// PostgreSQL caps one prepared statement at 65,535 bind parameters. Graph
// rows carry many columns, so large repositories must be inserted in bounded
// batches while remaining inside the scan transaction.
const GRAPH_INSERT_BATCH_SIZE = 500;

/**
 * Thrown by performScan when the persisted project root cannot be
 * re-established (missing, not a directory, unreadable, or unsafe).
 * The scan fails explicitly with a `root_unavailable` outcome; the
 * persisted root_path is never rebound to another directory.
 */
export class ScanRootUnavailableError extends Error {
  readonly outcome = "root_unavailable" as const;
  constructor(
    readonly rootPath: string,
    readonly reason: EstablishRootFailureReason,
    detail: string,
  ) {
    super(`root_unavailable (${reason}): ${detail}`);
    this.name = "ScanRootUnavailableError";
  }
}

export interface ScanJobResult {
  projectId: string;
  scannedAt: string;
  rootPath: string;
  rootExists: boolean;
  filesFound: number;
  sourceFiles: number;
  issuesDetected: number;
  tasksCreated: number;
  entitiesExtracted: number;
  relationshipsExtracted: number;
  summary: string;
  projectRevision: string;
  scanCompleteness: "COMPLETE" | "PARTIAL";
  sourceProvenance: string;
  scanCorrelationId: string;
  scannerVersion: string;
  repositoryManifest: {
    revision: string;
    sourceRoot: string;
    files: Array<{ path: string; size: number; contentHash: string; oversized: boolean }>;
    completeness: "COMPLETE" | "PARTIAL";
    derivedArtifacts: {
      scanner: "COMPLETE" | "PARTIAL";
      graph: "COMPLETE" | "PARTIAL";
      metrics: "COMPLETE" | "PARTIAL";
    };
  };
}

export class ProjectScanLockBusyError extends Error {
  constructor(projectId: string) {
    super(`a scan is already running for project ${projectId}`);
    this.name = "ProjectScanLockBusyError";
  }
}

/**
 * Run a full scan for `projectId` and update the given `jobId`'s row with
 * the outcome. Never throws — failures are recorded on the job row and the
 * project status is always restored, so a bug here can't wedge a project in
 * "scanning" forever or crash the process that enqueued it.
 */
const scanLockRetryAttempts = new Map<string, number>();
const SCAN_LOCK_RETRY_BASE_MS = 1_000;
const SCAN_LOCK_RETRY_MAX_MS = 30_000;

function scheduleQueuedScanRetry(jobId: string, projectId: string): void {
  const attempt = (scanLockRetryAttempts.get(jobId) ?? 0) + 1;
  scanLockRetryAttempts.set(jobId, attempt);
  const delayMs = Math.min(
    SCAN_LOCK_RETRY_BASE_MS * 2 ** Math.min(attempt - 1, 10),
    SCAN_LOCK_RETRY_MAX_MS,
  );
  const timer = setTimeout(() => {
    heavyJobQueue.enqueueWithId(jobId, () => runScanJob(jobId, projectId));
  }, delayMs);
  timer.unref?.();
  logger.warn(
    { jobId, projectId, attempt, delayMs },
    "scan-runner: queued scan will retry after lock admission failure",
  );
}

export async function runScanJob(jobId: string, projectId: string): Promise<void> {
  // SR-002: Acquire a PostgreSQL advisory lock keyed on projectId, not jobId.
  // The project is the real resource being mutated — locking on jobId allowed
  // two different jobs targeting the same project to run concurrently and
  // produce conflicting graph/metrics writes. Locking on projectId ensures
  // only one scan of a given project runs at a time across all instances.
  let lock;
  try {
    lock = await tryAdvisoryLock(LockNamespace.SCAN_JOB, projectId);
  } catch (lockErr) {
    // The advisory lock protects different scan jobs that target the same
    // project. If we cannot prove that serialization, leave the durable job
    // queued and retry instead of allowing concurrent project mutations.
    logger.error({ lockErr, jobId, projectId }, "scan-runner: advisory lock acquisition failed; keeping job queued");
    scheduleQueuedScanRetry(jobId, projectId);
    return;
  }

  if (!lock.acquired) {
    logger.warn(
      { jobId, projectId },
      "scan-runner: advisory lock busy — another scan is already running for this project; leaving job queued",
    );
    // Retry after the current owner has had time to release the project lock.
    // The durable row remains queued if this process exits before the timer.
    scheduleQueuedScanRetry(jobId, projectId);
    return;
  }

  // PR-01 (Durable Jobs): claim the job with a workerId + initial lease
  // before starting any work. If the claim returns false, the job is no
  // longer in "queued" state — either another worker already claimed it or
  // reconciliation moved it to a terminal state. Bail out without touching
  // the project row.
  const workerId = randomUUID();
  let claimed = false;
  let scanFinalized = false;
  let heartbeatInterval: NodeJS.Timeout | undefined;
  const scanController = new AbortController();
  try {
    claimed = await claimScanJob(jobId, workerId, SCAN_LEASE_MS);
    if (!claimed) {
      scanLockRetryAttempts.delete(jobId);
      logger.warn(
        { jobId, projectId },
        "scan-runner: could not claim job — not in queued state; skipping",
      );
      return;
    }
    scanLockRetryAttempts.delete(jobId);

    // Loss of the lease cancels expensive work promptly. The authoritative
    // fence remains the completion update in performScan's write transaction.
    heartbeatInterval = setInterval(() => {
      void heartbeatScanJob(jobId, workerId, SCAN_LEASE_MS).then((stillOwned) => {
        if (scanFinalized || stillOwned) return;
        logger.warn({ jobId, workerId }, "scan-runner: lease expired or ownership changed");
        scanController.abort(new ScanJobLeaseLostError(jobId));
      }).catch((hbErr: unknown) => {
        if (scanFinalized) return;
        logger.error({ hbErr, jobId, workerId }, "scan-runner: heartbeat failed; cancelling scan");
        scanController.abort(hbErr);
      });
    }, SCAN_HEARTBEAT_INTERVAL_MS);

    // The scan's effects and completed scan_jobs transition commit together.
    await performScan(projectId, scanController.signal, jobId, { jobId, workerId });
    scanFinalized = true;
  } catch (err) {
    scanFinalized = true;
    const message = err instanceof Error ? err.message : String(err);
    if (!claimed) {
      logger.error({ err, projectId, jobId }, "scan-runner: claim failed; keeping job queued");
      scheduleQueuedScanRetry(jobId, projectId);
      return;
    }
    if (err instanceof ScanJobLeaseLostError) {
      logger.warn({ jobId, workerId }, "scan effects rolled back after lease ownership was lost");
      return;
    }
    logger.error({ err, projectId, jobId }, "scan job failed");
    try {
      if (heartbeatInterval !== undefined) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = undefined;
      }
      const failed = await failScanJob(jobId, workerId, message);
      if (!failed) {
        logger.warn({ jobId, workerId }, "scan failure ignored because the worker no longer owns the job");
        return;
      }
      const failedAt = new Date();
      // Guard with `status = "scanning"` so a newer job that has already
      // taken ownership of this project is not clobbered by this failure path.
      await db
        .update(projectsTable)
        .set({ status: "active", updatedAt: failedAt })
        .where(and(eq(projectsTable.id, projectId), eq(projectsTable.status, "scanning")));

      // D-02: emit a ProjectScanFailed event so the AI context's recentEvents
      // reflects the failure.  Previously only the scan_jobs row was updated;
      // the event log was silent, leaving the AI unaware that a scan attempt
      // had been made and failed.
      await db.insert(eventsTable).values({
        id: randomUUID(),
        type: "ProjectScanFailed",
        projectId,
        severity: "error",
        message: `Scan failed: ${message.slice(0, 200)}`,
        correlationId: jobId,
      });

      // Bust the context cache so the next AI request sees "failed" scan
      // state rather than the stale "running"/"queued" snapshot that was
      // cached while the scan was in progress.
      invalidateContextCache(projectId);
    } catch (cleanupErr) {
      // Even the failure-path writes are wrapped: if the DB is unreachable
      // there is nothing more we can safely do in-process, but we must
      // still not throw out of a fire-and-forget call.
      logger.error({ cleanupErr, projectId, jobId }, "failed to record scan job failure");
    }
  } finally {
    scanFinalized = true;
    // Safety net: ensure heartbeat is cleared even if an unexpected path
    // skips the explicit clearInterval calls above.
    if (heartbeatInterval !== undefined) clearInterval(heartbeatInterval);
    // PR-3: Always release the advisory lock so other instances (or a
    // subsequent reconciliation run) can pick up the job if needed.
    if (lock?.acquired) {
      await lock.release().catch((releaseErr) => {
        logger.warn({ releaseErr, jobId }, "scan-runner: failed to release advisory lock");
      });
    }
  }
}

export async function performScan(
  projectId: string,
  signal?: AbortSignal,
  scanJobId?: string,
  ownership?: { jobId: string; workerId: string },
): Promise<ScanJobResult> {
  // Durable scan jobs acquire this lock in runScanJob before claiming. Direct
  // callers (for example, an AI analysis tool) must acquire the same
  // project-scoped lock themselves so they cannot bypass scan serialization.
  if (ownership) {
    return performScanCore(projectId, signal, scanJobId, ownership);
  }

  let lock;
  try {
    lock = await tryAdvisoryLock(LockNamespace.SCAN_JOB, projectId);
  } catch {
    throw new Error("project scan lock could not be acquired; scan was not started");
  }
  if (!lock.acquired) throw new ProjectScanLockBusyError(projectId);
  try {
    const [pendingJob] = await db
      .select({ id: scanJobsTable.id })
      .from(scanJobsTable)
      .where(and(
        eq(scanJobsTable.projectId, projectId),
        inArray(scanJobsTable.status, ["queued", "running"]),
      ))
      .limit(1);
    if (pendingJob) throw new ProjectScanLockBusyError(projectId);
    return await performScanCore(projectId, signal, scanJobId);
  } finally {
    await lock.release().catch((releaseErr) => {
      logger.warn({ releaseErr, projectId }, "direct scan: failed to release project lock");
    });
  }
}

async function performScanCore(
  projectId: string,
  signal?: AbortSignal,
  scanJobId?: string,
  ownership?: { jobId: string; workerId: string },
): Promise<ScanJobResult> {
  const checkCancelled = (): void => {
    if (signal?.aborted) {
      if (signal.reason instanceof Error) throw signal.reason;
      throw new Error("scan refresh cancelled");
    }
  };
  if (ownership && ownership.jobId !== scanJobId) {
    throw new Error("scan ownership job id does not match scan provenance");
  }
  checkCancelled();
  // One UUID per scan operation — written to audit_logs, events, and metrics
  // so a single `WHERE correlation_id = ?` retrieves the complete trace for
  // this scan without relying on projectId + timestamp proximity.
  const correlationId = randomUUID();

  const [project, projectRules] = await Promise.all([
    db.select().from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1),
    db
      .select()
      .from(rulesTable)
      .where(
        and(
          eq(rulesTable.enabled, true),
          or(isNull(rulesTable.projectId), eq(rulesTable.projectId, projectId)),
        ),
      ),
  ]);
  checkCancelled();
  if (!project[0]) throw new Error(`Project ${projectId} not found`);

  // ── 0. Re-establish the persisted project root before any walk ──────────
  // The persisted root_path is only trustworthy at the moment it is walked.
  // A managed durable root can be deleted, a user directory can disappear,
  // and a legacy /tmp/eos-git-* clone is gone after discovery cleanup. The
  // scan must go through the same canonical boundary as project creation:
  // establishProjectRoot resolves symlinks, enforces the safety policy, and
  // fails with a structured reason instead of walking anything else.
  //
  // Critically, a dead root is NEVER rebound to another directory (the old
  // behaviour silently swapped in /home/runner/workspace, which walked
  // unrelated code and published its findings to the wrong project). The
  // persisted root_path is left untouched so the user can re-import.
  //
  // No allowManagedTempRoot here: the scan runner cannot verify discovery
  // provenance from the projects row alone, and anyone can create a
  // /tmp/eos-git-* directory. A legacy temp root — dead OR alive — therefore
  // fails closed (root_unavailable / root_unsafe) and must be re-imported
  // through discovery, which materializes to a durable workspace root.
  const rootResult = await establishProjectRoot(project[0].rootPath);
  checkCancelled();
  if (!rootResult.ok) {
    throw new ScanRootUnavailableError(project[0].rootPath, rootResult.reason, rootResult.error);
  }
  const effectiveRootPath = rootResult.canonicalPath;

  const now = new Date();

  // ── 1. Walk the project directory ──────────────────────────────────────
  let walkResult;
  try {
    walkResult = await walkProject(effectiveRootPath, signal);
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ScanRootUnavailableError(
      project[0].rootPath,
      "root_unavailable",
      error instanceof Error ? error.message : String(error),
    );
  }
  checkCancelled();
  const { files } = walkResult;

  // ── 2. Match scoped rules against scanned files ─────────────────────────
  const ruleInputs: RuleInput[] = projectRules.map((r) => ({
    id: r.id,
    code: r.code,
    pattern: r.pattern,
    severity: r.severity,
    enabled: r.enabled ?? true,
  }));
  const ruleResults = matchRules(ruleInputs, files);

  // ── 3. Compute quality metrics ──────────────────────────────────────────
  const metrics = computeMetrics(files, ruleResults);

  // ── 4. Extract knowledge graph (outside transaction) ─────────────────────
  // SR-003: extractGraph is pure CPU work with no DB dependency. Running it
  // inside the transaction held a connection (and its associated locks) for
  // the full duration of the AST parse + graph build — often seconds — even
  // though no DB writes were happening. Moving it here shortens the critical
  // section to inserts/updates only, reducing lock contention and connection
  // pool pressure.
  const graph = await extractGraph(files, { signal });
  checkCancelled();
  const graphIncomplete = graph.incomplete === true;
  const capturedEntities: ExtractedEntity[] = graph.entities.map((e) => ({
    type: e.type,
    name: e.name,
    path: e.path,
    isDocumented: e.isDocumented,
  }));

  // ── 5-9. Persist scan effects and job completion atomically ─────────────
  // Tasks, rule hit counts, graph entities/relationships, metrics, project
  // status/score, the scan event, and (for queued work) the terminal scan-job
  // transition commit together. The audit record is deliberately written
  // after commit by recordAudit and is retained/retried through its outbox.
  // If ownership was lost, the terminal update below fails and throws, which
  // rolls back every scan effect in this transaction.

  checkCancelled();
  const persistScanEffects = async (tx: ScanJobTransaction) => {
    checkCancelled();
    const existingTasks = await tx
      .select({
        id: tasksTable.id,
        ruleId: tasksTable.ruleId,
        status: tasksTable.status,
      })
      .from(tasksTable)
      .where(eq(tasksTable.projectId, projectId));
    const activeRuleTasks = new Map(
      existingTasks
        .filter((task) => task.ruleId && ["pending", "queued", "running", "verifying"].includes(task.status))
        .map((task) => [task.ruleId as string, task]),
    );

    const newTaskIds: string[] = [];
    for (const result of ruleResults) {
      if (!result.matched) continue;

      const rule = projectRules.find((r) => r.id === result.ruleId);
      if (!rule) continue;

      const remediationPlan = buildRemediationPlan({
        ruleId: rule.id,
        ruleCode: rule.code,
        ruleTitle: rule.title,
        severity: rule.severity,
        occurrenceCount: result.matchCount,
        matches: result.matches,
        fixDescription: rule.fixDescription,
        verificationSteps: rule.verifySteps ?? [],
        source: {
          type: "scan",
          correlationId,
          revision: walkResult.revision,
          completeness: walkResult.truncated ? "PARTIAL" : "COMPLETE",
        },
      });
      const remediationPrompt = buildRemediationPrompt(remediationPlan);
      const description =
        remediationPlan.fixDescription ??
        `${remediationPlan.occurrenceCount} occurrence(s) detected for ${rule.code}. Review the bounded evidence before execution.`;
      const activeTask = activeRuleTasks.get(rule.id);

      if (activeTask) {
        await tx
          .update(tasksTable)
          .set({
            description,
            relatedFiles: remediationPlan.relatedFiles,
            prompt: remediationPrompt,
            phase: "remediation",
            remediationPlan,
            correlationId,
            updatedAt: now,
          })
          .where(eq(tasksTable.id, activeTask.id));
        continue;
      }

      const taskId = randomUUID();
      await tx.insert(tasksTable).values({
        id: taskId,
        projectId,
        ruleId: rule.id,
        title: `Remediate ${rule.code}: ${rule.title}`,
        description,
        status: "pending",
        priority:
          rule.severity === "critical"
            ? "p0"
            : rule.severity === "high"
              ? "p1"
              : rule.severity === "medium"
                ? "p2"
                : "p3",
        relatedFiles: remediationPlan.relatedFiles,
        prompt: remediationPrompt,
        phase: "remediation",
        remediationPlan,
        createdAt: now,
        updatedAt: now,
        correlationId,
      });
      newTaskIds.push(taskId);

      await tx
        .update(rulesTable)
        .set({ hitCount: (rule.hitCount ?? 0) + result.matchCount, updatedAt: now })
        .where(eq(rulesTable.id, rule.id));
    }

    // ── 5. Persist knowledge graph ────────────────────────────────────────
    // `graph` was extracted outside the transaction (SR-003); here we only
    // do the DB work: dedup against existing entities and insert new rows.
    const existingEntities = await tx
      .select({
        name: graphEntitiesTable.name,
        type: graphEntitiesTable.type,
        id: graphEntitiesTable.id,
        path: graphEntitiesTable.path,
      })
      .from(graphEntitiesTable)
      .where(eq(graphEntitiesTable.projectId, projectId));

  // Primary key: type::path::name — prevents cross-file name collisions.
  // Secondary key: type::name → [ids] — for relationship resolution.
  // Multiple entities can share a name across files; we record all IDs and
  // pick the first stable entry so relationships don't shift on re-scan.
  const entityKeyToId = new Map<string, string>(); // type::path::name → id
  const entityNameToIds = new Map<string, string[]>(); // type::name → [id, …]

  function addToNameIndex(type: string, name: string, id: string): void {
    const key = `${type}::${name}`;
    const existing = entityNameToIds.get(key);
    if (existing) {
      existing.push(id);
    } else {
      entityNameToIds.set(key, [id]);
    }
  }

  for (const e of existingEntities) {
    const pk = `${e.type}::${e.path ?? e.name}::${e.name}`;
    entityKeyToId.set(pk, e.id);
    addToNameIndex(e.type, e.name, e.id);
  }

  // GAP-1 fix: identify stale entities (in DB but absent from current scan output).
  const currentScanKeys = new Set(
    graph.entities.map((e) => `${e.type}::${e.path ?? e.name}::${e.name}`),
  );
  const staleEntityIds = existingEntities
    .filter((e) => !currentScanKeys.has(`${e.type}::${e.path ?? e.name}::${e.name}`))
    .map((e) => e.id);

  // Remove stale entries from in-memory maps so relationship resolution never
  // produces edges pointing at entity IDs that are about to be deleted.
  for (const e of existingEntities) {
    const pk = `${e.type}::${e.path ?? e.name}::${e.name}`;
    if (!currentScanKeys.has(pk)) {
      entityKeyToId.delete(pk);
      const nameKey = `${e.type}::${e.name}`;
      const ids = entityNameToIds.get(nameKey);
      if (ids) {
        const filtered = ids.filter((id) => id !== e.id);
        if (filtered.length > 0) {
          entityNameToIds.set(nameKey, filtered);
        } else {
          entityNameToIds.delete(nameKey);
        }
      }
    }
  }

  // Delete ALL existing relationships for this project before re-inserting.
  // Relationships are fully recomputed each scan; clearing them prevents
  // both duplicates on re-scan and stale edges from renamed/deleted nodes.
  await tx.delete(graphRelationshipsTable).where(
    eq(graphRelationshipsTable.projectId, projectId),
  );

  // Delete stale entities (those no longer present in source code).
  if (staleEntityIds.length > 0) {
    await tx.delete(graphEntitiesTable).where(
      inArray(graphEntitiesTable.id, staleEntityIds),
    );
    logger.info(
      { projectId, staleCount: staleEntityIds.length },
      "scan-runner: pruned stale graph entities",
    );
  }

  // New scans own the surviving graph rows as well as newly inserted rows.
  // Legacy/direct callers may omit scanJobId, in which case provenance remains
  // unchanged rather than inventing a durable job identity.
  if (scanJobId) {
    await tx
      .update(graphEntitiesTable)
      .set({ scanJobId })
      .where(eq(graphEntitiesTable.projectId, projectId));
  }

  const entitiesToInsert = graph.entities.filter(
    (e) => !entityKeyToId.has(`${e.type}::${e.path ?? e.name}::${e.name}`),
  );

  if (entitiesToInsert.length > 0) {
    const entityRows = entitiesToInsert.map((e) => ({
      id: randomUUID(),
      projectId,
      ...(scanJobId ? { scanJobId } : {}),
      type: e.type,
      name: e.name,
      path: e.path,
      metadata: e.metadata ?? {},
      // ── Knowledge Graph 2.0 semantic fields ────────────────────────────
      kind: e.kind,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sourceType: e.sourceType as any,
      isDocumented: e.isDocumented,
      semanticTags: e.semanticTags,
      description: e.description,
      confidence: e.confidence,
      domain: e.domain,
      lifecycle: e.lifecycle,
      // ── Provenance (mergeResult() guarantees this is present) ──────────
      // GAP-2/GAP-3 fix: stamp every entity with the scan session and extractor version.
      provenance: e.provenance
        ? provenanceFromEntity(e.provenance, now, { scanSessionId: correlationId, extractorVersion: SCANNER_VERSION })
        : manualProvenance(e.sourceType ?? "typescript-ast", "ts-compiler-api", now, undefined, { scanSessionId: correlationId, extractorVersion: SCANNER_VERSION }),
      createdAt: now,
    }));
    for (let offset = 0; offset < entityRows.length; offset += GRAPH_INSERT_BATCH_SIZE) {
      await tx
        .insert(graphEntitiesTable)
        .values(entityRows.slice(offset, offset + GRAPH_INSERT_BATCH_SIZE));
    }
    for (const row of entityRows) {
      entityKeyToId.set(`${row.type}::${row.path ?? row.name}::${row.name}`, row.id);
      addToNameIndex(row.type, row.name, row.id);
    }
  }

  // Resolve a relationship endpoint to a DB entity ID.
  // If multiple entities share the same name (cross-file collision),
  // return the first stable entry rather than an arbitrary one.
  const findEntityId = (name: string, endpointPath?: string): string | undefined => {
    if (endpointPath) {
      for (const type of ["file", "function", "class", "module"] as const) {
        const exact = entityKeyToId.get(`${type}::${endpointPath}::${name}`);
        if (exact) return exact;
      }
    }
    for (const type of ["file", "function", "class", "module"] as const) {
      const ids = entityNameToIds.get(`${type}::${name}`);
      if (ids && ids.length > 0) return ids[0];
    }
    return undefined;
  };

  const relRows = graph.relationships
    .map((rel) => {
      const sourceId = findEntityId(rel.sourceName, rel.sourcePath);
      const targetId = findEntityId(rel.targetName, rel.targetPath);
      if (!sourceId || !targetId) return null;
      const evArr = rel.evidence ?? [];
      return {
        id: randomUUID(),
        sourceId,
        targetId,
        projectId, // denormalised for efficient project-level queries (KG 2.0)
        ...(scanJobId ? { scanJobId } : {}),
        relation: rel.relation,
        // ── Knowledge Graph 2.0 semantic fields ─────────────────────────
        relationType: rel.relationType,
        relationSubtype: rel.relationSubtype,
        weight: rel.confidence, // weight mirrors confidence by default
        confidence: rel.confidence,
        isHeuristic: rel.isHeuristic ?? false,
        isRuntimeObserved: rel.isRuntimeObserved ?? false,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        evidenceJson: evArr as any,
        evidenceCount: evArr.length,
        evidenceSummary:
          evArr.length > 0
            ? `${evArr.length} evidence item${evArr.length === 1 ? "" : "s"}`
            : null,
        semanticTags: rel.semanticTags,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        sourceType: rel.sourceType as any,
        // ── Provenance (mergeResult() guarantees this is present) ────────
        // GAP-2/GAP-3 fix: stamp every relationship with the scan session and extractor version.
        provenance: rel.provenance
          ? provenanceFromRelationship(rel.provenance, now, { scanSessionId: correlationId, extractorVersion: SCANNER_VERSION })
          : manualProvenance(rel.sourceType ?? "typescript-ast", "ts-compiler-api", now, undefined, { scanSessionId: correlationId, extractorVersion: SCANNER_VERSION }),
        metadata: {},
        createdAt: now,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (relRows.length > 0) {
    for (let offset = 0; offset < relRows.length; offset += GRAPH_INSERT_BATCH_SIZE) {
      await tx
        .insert(graphRelationshipsTable)
        .values(relRows.slice(offset, offset + GRAPH_INSERT_BATCH_SIZE));
    }
  }

    // ── 6. Insert metrics record ──────────────────────────────────────────
    await tx.insert(metricsTable).values({
      id: randomUUID(),
      projectId,
      timestamp: now,
      overallScore: metrics.overallScore,
      architectureScore: metrics.architectureScore,
      securityScore: metrics.securityScore,
      maintainabilityScore: metrics.maintainabilityScore,
      reliabilityScore: metrics.reliabilityScore,
      performanceScore: metrics.performanceScore,
      structuralTestEstimate: metrics.structuralTestEstimate,
      technicalDebt: metrics.technicalDebt,
      lintIssues: metrics.lintIssues,
      avgFileSizeKb: metrics.avgFileSizeKb,
      codeToTestRatio: metrics.codeToTestRatio,
      correlationId,
    });

    // ── 7. Update project quality score and restore status ─────────────────
    // Guard with `status = "scanning"` so a concurrent newer job that owns
    // the project is not overwritten if, somehow, two jobs run in overlap.
    await tx
      .update(projectsTable)
      .set({
        status: "active",
        qualityScore: metrics.overallScore,
        lastScanAt: now,
        updatedAt: now,
      })
      .where(and(eq(projectsTable.id, projectId), eq(projectsTable.status, "scanning")));

    // ── 8. Emit scan event ───────────────────────────────────────────────
    const issuesDetected = ruleResults.reduce((s, r) => s + r.matchCount, 0);
    await tx.insert(eventsTable).values({
      id: randomUUID(),
      type: "ProjectScanned",
      projectId,
      severity: "success",
      message: `Scan complete: ${walkResult.totalFiles} files, ${issuesDetected} issues detected`,
      payload: {
        filesFound: walkResult.totalFiles,
        sourceFiles: walkResult.sourceFiles,
        issuesDetected,
        tasksCreated: newTaskIds.length,
        rootExists: walkResult.rootExists,
        entitiesExtracted: entitiesToInsert.length,
        relationshipsExtracted: relRows.length,
        qualityScore: metrics.overallScore,
      },
      correlationId,
    });

    checkCancelled();
    const scanResult: ScanJobResult & { _priorQualityScore: number | null } = {
      projectId,
      scannedAt: now.toISOString(),
      rootPath: walkResult.rootPath,
      rootExists: walkResult.rootExists,
      filesFound: walkResult.totalFiles,
      sourceFiles: walkResult.sourceFiles,
      issuesDetected,
      tasksCreated: newTaskIds.length,
      entitiesExtracted: entitiesToInsert.length,
      relationshipsExtracted: relRows.length,
      summary: `Scanned ${walkResult.totalFiles} files. Found ${issuesDetected} issues. Created ${newTaskIds.length} tasks. Quality score: ${metrics.overallScore}/100.`,
      projectRevision: walkResult.revision,
      scanCompleteness: walkResult.truncated || graphIncomplete
        ? "PARTIAL" as const
        : "COMPLETE" as const,
      sourceProvenance: "filesystem-scan",
      scanCorrelationId: correlationId,
      scannerVersion: SCANNER_VERSION,
      repositoryManifest: {
        ...walkResult.revisionManifest,
        derivedArtifacts: {
          scanner: walkResult.truncated ? "PARTIAL" as const : "COMPLETE" as const,
          graph: walkResult.truncated || graphIncomplete ? "PARTIAL" as const : "COMPLETE" as const,
          metrics: walkResult.truncated ? "PARTIAL" as const : "COMPLETE" as const,
        },
      },
      _priorQualityScore: project[0].qualityScore ?? null,
    };

    return scanResult;
  };
  const scanTransaction = ownership
    ? persistScanJobTransaction(ownership.jobId, ownership.workerId, persistScanEffects)
    : db.transaction(persistScanEffects);

  return await scanTransaction.then(async (result) => {
    // Audit is intentionally recorded *after* the transaction commits and
    // outside it (see audit.ts) — it reflects a state change that has
    // already durably happened, and an audit-table outage must not roll
    // back an otherwise-successful scan.
    const { _priorQualityScore, ...scanResult } = result;
    await recordAudit({
      entityType: "project",
      entityId: projectId,
      action: "scanned",
      projectId,
      stateBefore: { qualityScore: _priorQualityScore },
      stateAfter: { qualityScore: metrics.overallScore },
      changedFields: {
        filesFound: scanResult.filesFound,
        tasksCreated: scanResult.tasksCreated,
        entitiesExtracted: scanResult.entitiesExtracted,
        relationshipsExtracted: scanResult.relationshipsExtracted,
      },
      correlationId,
    });

    // Bust the context cache so the very next AI chat turn reflects the
    // completed scan (new metrics, graph entities, scan status = "completed")
    // rather than the pre-scan or mid-scan snapshot that was cached while the
    // job was in progress.  Placed after recordAudit so it only fires when
    // the full transaction has durably committed.
    invalidateContextCache(projectId);

    // Dispatch plugin hooks outside the transaction — same best-effort
    // semantics as recordAudit: a plugin failure must not roll back a
    // successful scan. Errors are logged but swallowed here.
    await dispatchOnScanComplete({
      projectId,
      language: project[0].language,
      framework: project[0].framework ?? null,
      filesFound: scanResult.filesFound,
      sourceFiles: scanResult.sourceFiles,
      issuesDetected: scanResult.issuesDetected,
      tasksCreated: scanResult.tasksCreated,
      entitiesExtracted: scanResult.entitiesExtracted,
      relationshipsExtracted: scanResult.relationshipsExtracted,
      ruleViolations: ruleResults
        .filter((r) => r.matched)
        .map((r): RuleViolationSummary => {
          const rule = projectRules.find((pr) => pr.id === r.ruleId);
          return {
            ruleId: r.ruleId,
            code: rule?.code ?? r.ruleId,
            severity: rule?.severity ?? "medium",
            matchCount: r.matchCount,
          };
        }),
      entities: capturedEntities,
    });

    return scanResult;
  });
}
