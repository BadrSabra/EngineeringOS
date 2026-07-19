import { Router, type Response } from "express";
import { db } from "@workspace/db";
import {
  discoverySessionsTable,
  projectsTable,
  eventsTable,
  metricsTable,
  graphEntitiesTable,
  tasksTable,
  type DiscoveryStep,
} from "@workspace/db";
import {
  StartDiscoveryBody,
  ImportProjectBody,
  GetDiscoverySessionParams,
  GetDiscoverySummaryParams,
} from "@workspace/api-zod";
import { eq, and, lt } from "drizzle-orm";
import { randomUUID } from "crypto";
import { logger } from "../lib/logger.js";
import { recordAudit } from "../lib/audit.js";
import { heavyJobQueue } from "../lib/job-queue.js";
import {
  resolveSource,
  cleanupResolveResult,
  isResolveError,
} from "../lib/discovery-adapters.js";
import { validateRootPath, verifyProjectRoot } from "../lib/path-validation.js";
import { runDiscovery, STEPS } from "../lib/discovery-runner.js";

const router = Router();

// ─── Error helpers ──────────────────────────────────────────────────────────────

/**
 * True if `err` is a Postgres unique-violation (SQLSTATE 23505) on the given
 * constraint name. node-postgres surfaces driver errors with `.code` and
 * `.constraint` fields; drizzle passes them through unchanged.
 */
function isUniqueViolation(err: unknown, constraintName: string): boolean {
  if (typeof err !== "object" || err === null) return false;
  // drizzle-orm wraps the raw node-postgres error in a DrizzleQueryError,
  // putting the original (which carries `.code`/`.constraint`) on `.cause`.
  const pgErr = "cause" in err ? (err as { cause?: unknown }).cause : err;
  return (
    typeof pgErr === "object" &&
    pgErr !== null &&
    (pgErr as { code?: unknown }).code === "23505" &&
    (pgErr as { constraint?: unknown }).constraint === constraintName
  );
}

// ─── (Detection helpers and runDiscovery pipeline are in lib/discovery-runner.ts) ─

// ─── Cleanup old sessions (>24h) ──────────────────────────────────────────────

async function cleanupOldSessions(): Promise<void> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  await db
    .delete(discoverySessionsTable)
    .where(lt(discoverySessionsTable.startedAt, cutoff));
}

// ─── Routes ────────────────────────────────────────────────────────────────────

// ─── Source capabilities registry ─────────────────────────────────────────────

const SOURCE_CAPABILITIES = [
  {
    sourceType: "LOCAL_FOLDER",
    label: "Local Folder",
    description: "Scan a directory already present on this server",
    available: true,
    icon: "folder",
    requiredConfig: ["path"],
  },
  {
    sourceType: "GIT_REPOSITORY",
    label: "Git Repository",
    description: "Clone a remote Git repo and scan the clone",
    available: true,
    icon: "git-branch",
    requiredConfig: ["url"],
    notes: "Public repos work out of the box. For private repos provide credentials.",
  },
  {
    sourceType: "WORKSPACE_PROJECT",
    label: "Existing Project",
    description: "Re-scan an already registered project",
    available: true,
    icon: "layers",
    requiredConfig: ["projectId"],
  },
  {
    sourceType: "ARCHIVE_UPLOAD",
    label: "Zip Archive",
    description: "Upload a .zip or .tar.gz and scan its contents",
    available: false,
    icon: "package",
    requiredConfig: ["uploadId"],
    notes: "Not supported in this deployment — requires server-side file-upload handling. Use GIT_REPOSITORY to scan remote code.",
    hint: "Push your code to a Git repository and use the Git Repository source type instead.",
  },
  {
    sourceType: "REMOTE_FILESYSTEM",
    label: "Remote Filesystem",
    description: "Mount and scan a remote path via SSH/SFTP",
    available: false,
    icon: "cloud",
    requiredConfig: [],
    notes: "Not supported in this deployment — requires server-side SSH/SFTP file access.",
    hint: "Clone the remote repository via Git and use the Git Repository source type instead.",
  },
  {
    sourceType: "DOCKER_VOLUME",
    label: "Docker Volume",
    description: "Access and scan a Docker container volume",
    available: false,
    icon: "container",
    requiredConfig: [],
    notes: "Not supported in this deployment — requires a local Docker daemon.",
    hint: "Clone the container's source repository via Git and use the Git Repository source type instead.",
  },
] as const;

// ─── Source resolver (adapter pattern) ────────────────────────────────────────

// GET /discovery/sources
router.get("/discovery/sources", (_req, res) => {
  return res.json(SOURCE_CAPABILITIES);
});

// POST /projects/discover
router.post("/projects/discover", async (req, res) => {
  const body = StartDiscoveryBody.parse(req.body);

  // Resolve source → local filesystem path via the appropriate adapter.
  // userId is threaded through so source types that reference another
  // first-class resource (WORKSPACE_PROJECT) can enforce ownership before
  // ever touching that resource's rootPath — see discovery-adapters.ts.
  const resolved = await resolveSource(body.sourceType, body.sourceConfig, req.userId);
  if (isResolveError(resolved)) {
    return res.status(resolved.status).json({ error: resolved.error, reason: resolved.reason });
  }

  const normalizedPath = resolved.rootPath;

  // Validate rootPath before doing anything — reject dangerous system paths
  // and symlink escapes before enqueueing a job that could OOM the process.
  const pathError = await validateRootPath(normalizedPath);
  if (pathError) {
    // Clean up any temp resources (e.g. a git clone dir) created during resolution.
    cleanupResolveResult(resolved).catch(() => undefined);
    return res.status(400).json({ error: pathError, reason: "invalid_source" });
  }

  // For GIT_REPOSITORY clones (and any source that produces a temp dir), verify
  // the directory contains a recognisable project root before enqueuing a scan.
  // This gives a fast, actionable 422 instead of a scan job that discovers nothing.
  //
  // LOCAL_FOLDER intentionally skips this check: the user is providing a path
  // on the server they are assumed to control, and they may be scanning a project
  // with an unconventional structure. validateRootPath() (above) is the appropriate
  // safety boundary for those paths.
  if (resolved.tempDir) {
    const rootError = await verifyProjectRoot(normalizedPath);
    if (rootError) {
      cleanupResolveResult(resolved).catch(() => undefined);
      return res.status(422).json({ error: rootError, reason: "no_project_root" });
    }
  }

  // Cleanup stale sessions opportunistically
  cleanupOldSessions().catch(() => undefined);

  const id = randomUUID();
  const initialSteps: DiscoveryStep[] = STEPS.map((name) => ({
    name,
    status: "pending",
  }));

  await db.insert(discoverySessionsTable).values({
    id,
    ownerId: req.userId,
    status: "pending",
    rootPath: normalizedPath,
    sourceType: body.sourceType as "LOCAL_FOLDER" | "WORKSPACE_PROJECT" | "GIT_REPOSITORY" | "ARCHIVE_UPLOAD" | "REMOTE_FILESYSTEM" | "DOCKER_VOLUME",
    sourceConfig: body.sourceConfig,
    progress: 0,
    currentStep: STEPS[0],
    steps: initialSteps,
    startedAt: new Date(),
  });

  // Read the session back BEFORE enqueueing the background job so the HTTP
  // response always reflects the just-created "pending" state. Doing the
  // SELECT after enqueue introduces a race: for non-existent LOCAL_FOLDER
  // paths the background job can flip to "error" before the SELECT returns,
  // making the 202 response show status="error" instead of "pending".
  const session = await db
    .select()
    .from(discoverySessionsTable)
    .where(eq(discoverySessionsTable.id, id))
    .limit(1);

  // Bounded, fire-and-forget: shares heavyJobQueue with project scans (see
  // job-queue.ts) so a burst of discovery + scan requests together still
  // can't run unbounded work at once. The try/finally guarantees that any
  // temp directory created by the resolver (e.g. a GIT_REPOSITORY clone) is
  // always deleted after the job finishes — success or failure. Without this,
  // git clone dirs would accumulate in /tmp on every successful discovery.
  heavyJobQueue.enqueue(async () => {
    try {
      await runDiscovery(id, normalizedPath);
    } catch (err) {
      logger.error({ err, sessionId: id }, "Unhandled discovery error");
    } finally {
      await cleanupResolveResult(resolved).catch(() => undefined);
    }
  });

  return res.status(202).json(toSessionResponse(session[0]));
});

/**
 * Loads a discovery session and enforces ownership, writing the appropriate
 * error response (404/403) on failure. Same not-found-vs-forbidden
 * convention as requireProjectAccess: 404 when no such session exists at
 * all, 403 when it exists but belongs to a different user. Every route that
 * reads or mutates a session by id goes through this — a session can
 * contain another repo's file paths, dependency list, and detected risks,
 * so it must never be readable by anyone but the user who started it.
 */
async function loadOwnedSession(
  discoveryId: string,
  userId: string,
  res: Response,
): Promise<typeof discoverySessionsTable.$inferSelect | undefined> {
  const rows = await db
    .select()
    .from(discoverySessionsTable)
    .where(eq(discoverySessionsTable.id, discoveryId))
    .limit(1);
  const session = rows[0];
  if (!session) {
    res.status(404).json({ error: "Discovery session not found", reason: "not_found" });
    return undefined;
  }
  if (session.ownerId !== userId) {
    res.status(403).json({ error: "You do not have access to this discovery session", reason: "permission_denied" });
    return undefined;
  }
  return session;
}

// GET /projects/discover/:discoveryId
router.get("/projects/discover/:discoveryId", async (req, res) => {
  const { discoveryId } = GetDiscoverySessionParams.parse(req.params);
  const session = await loadOwnedSession(discoveryId, req.userId, res);
  if (!session) return;
  return res.json(toSessionResponse(session));
});

// GET /projects/discover/:discoveryId/summary
router.get("/projects/discover/:discoveryId/summary", async (req, res) => {
  const { discoveryId } = GetDiscoverySummaryParams.parse(req.params);
  const session = await loadOwnedSession(discoveryId, req.userId, res);
  if (!session) return;
  if (session.status !== "ready" && session.status !== "imported") {
    return res.status(409).json({ error: "Discovery not yet complete", status: session.status, reason: "resolution_failed" });
  }
  const result = session.result;
  if (!result) return res.status(500).json({ error: "Discovery result missing" });
  return res.json({ id: discoveryId, ...result });
});

class SessionAlreadyImportedError extends Error {
  constructor() {
    super("Session already imported by another request");
  }
}

// POST /projects/import
router.post("/projects/import", async (req, res) => {
  const body = ImportProjectBody.parse(req.body);

  // Load session — must exist, be owned by the requester, and be in 'ready'
  // state. Ownership is checked before status so a non-owner never learns
  // anything about a session's progress (a 403 either way, not a 409 that
  // would confirm the session is ready to import).
  const session = await loadOwnedSession(body.discoveryId, req.userId, res);
  if (!session) return;
  if (session.status === "imported") {
    return res.status(409).json({ error: "Session already imported", status: session.status, reason: "invalid_source" });
  }
  if (session.status !== "ready") {
    return res.status(409).json({ error: "Discovery not yet complete", status: session.status, reason: "resolution_failed" });
  }

  const result = session.result;
  if (!result) return res.status(500).json({ error: "Discovery result missing" });

  const overrides = body.overrides ?? {};
  const now = new Date();
  const projectId = randomUUID();

  const projectName = overrides.name ?? result.detectedName;
  const projectLanguage = overrides.language ?? result.detectedLanguage;
  const projectFramework = overrides.framework ?? result.detectedFramework ?? undefined;
  const projectDescription = overrides.description ?? undefined;

  // All writes — including the atomic claim — happen inside a single
  // transaction so success/failure is all-or-nothing and the FK from
  // discovery_sessions.imported_project_id -> projects.id is always
  // satisfied (the project row is inserted before the session row that
  // references it, both inside the same transaction).
  let project: typeof projectsTable.$inferSelect;
  try {
    project = await db.transaction(async (tx) => {
      // 1. Project record
      const [inserted] = await tx
        .insert(projectsTable)
        .values({
          id: projectId,
          ownerId: req.userId,
          name: projectName,
          description: projectDescription,
          rootPath: session.rootPath,
          language: projectLanguage,
          framework: projectFramework,
          status: "active",
          qualityScore: result.qualityScore,
          lastScanAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      // 1b. Atomic claim: transition ready → importing using conditional
      // WHERE, now that the referenced project row exists. The row lock
      // taken here means a concurrent request racing on the same session
      // blocks until this transaction commits or rolls back, then sees 0
      // rows affected (session no longer "ready") and fails its own claim.
      const claimed = await tx
        .update(discoverySessionsTable)
        .set({ status: "imported", importedProjectId: projectId })
        .where(
          and(
            eq(discoverySessionsTable.id, body.discoveryId),
            eq(discoverySessionsTable.status, "ready"),
          ),
        )
        .returning({ id: discoverySessionsTable.id });

      if (claimed.length === 0) {
        throw new SessionAlreadyImportedError();
      }

      // 2. Initial metrics
      await tx.insert(metricsTable).values({
        id: randomUUID(),
        projectId,
        timestamp: now,
        overallScore: result.qualityScore,
        securityScore:
          result.ruleViolations.filter(
            (r) => r.severity === "critical" || r.severity === "high",
          ).length === 0
            ? 100
            : 60,
        maintainabilityScore: result.qualityScore,
        reliabilityScore: result.qualityScore,
        performanceScore: result.qualityScore,
        lintIssues: result.ruleViolations.reduce((s, r) => s + r.count, 0),
        buildStatus: "unknown",
      });

      // 3. Graph entity stubs from detected API routes
      // Every stub carries a full provenance record so downstream consumers
      // can always tell these rows came from discovery, not from a full AST scan.
      for (const apiRoute of result.detectedApis.slice(0, 50)) {
        await tx.insert(graphEntitiesTable).values({
          id: randomUUID(),
          projectId,
          type: "api",
          name: apiRoute,
          sourceType: "discovery-import",
          confidence: 0.8,
          provenance: {
            sourceType: "discovery-import",
            method: "api-route-detection",
            extractedAt: now.toISOString(),
            evidence: [{ file: "discovery-session", kind: "heuristic" as const }],
          },
          createdAt: now,
        });
      }

      // 4. Tasks from rule violations (top 20)
      for (const violation of result.ruleViolations.slice(0, 20)) {
        await tx.insert(tasksTable).values({
          id: randomUUID(),
          projectId,
          title: `Fix: ${violation.title}`,
          description: `Rule violation detected during discovery. ${violation.count} occurrence(s) found.`,
          status: "pending",
          priority:
            violation.severity === "critical"
              ? "p0"
              : violation.severity === "high"
              ? "p1"
              : "p2",
          createdAt: now,
          updatedAt: now,
        });
      }

      // 5. ProjectImported event
      await tx.insert(eventsTable).values({
        id: randomUUID(),
        type: "ProjectImported",
        projectId,
        severity: "success",
        message: `Project "${projectName}" imported via autonomous discovery (confidence: ${result.confidenceScore}%)`,
        timestamp: now,
      });

      return inserted;
    });
  } catch (txErr) {
    if (txErr instanceof SessionAlreadyImportedError) {
      // The transaction (including the project insert) rolled back cleanly;
      // the session is untouched and still "ready" or was claimed by the
      // concurrent winner — nothing to revert.
      return res.status(409).json({ error: txErr.message, reason: "invalid_source" });
    }
    // `projects.root_path` has a DB-level UNIQUE constraint (data-integrity
    // hardening: two projects should never point at the same filesystem
    // root). Two concurrent imports of the *same* discovery session race to
    // insert a project row with that session's root_path before either
    // reaches the atomic claim step below — the loser hits this unique
    // violation instead of the claim's conditional-UPDATE check. That's the
    // same "already imported" conflict, just detected one step earlier, so
    // it gets the same 409 treatment rather than surfacing as a raw 500.
    if (isUniqueViolation(txErr, "projects_root_path_unique")) {
      return res.status(409).json({
        error: "A project for this root path already exists (or is being imported concurrently).",
        reason: "invalid_source",
      });
    }
    // Transaction rolled back — session status is already back to its
    // pre-attempt value automatically. No manual revert needed since the
    // claim update itself was part of the rolled-back transaction.
    const message = txErr instanceof Error ? txErr.message : "Import transaction failed";
    logger.error({ txErr, discoveryId: body.discoveryId }, message);
    return res.status(500).json({ error: message, reason: "import_failed" });
  }

  // Best-effort audit: the import transaction has already committed and the
  // project is live, so a failing audit must never suppress the 201 response.
  recordAudit({
    entityType: "discovery_session",
    entityId: body.discoveryId,
    action: "imported",
    projectId,
    actor: req.userId,
    stateBefore: { status: "ready" },
    stateAfter: { status: "imported", importedProjectId: projectId },
    changedFields: { projectId, confidenceScore: result.confidenceScore },
  }).catch((auditErr) =>
    logger.warn({ auditErr, discoveryId: body.discoveryId }, "recordAudit failed after import — audit entry missing but import succeeded"),
  );

  return res.status(201).json(project);
});

// ─── Response helpers ──────────────────────────────────────────────────────────

function toSessionResponse(session: {
  id: string;
  status: string;
  progress: number;
  currentStep: string | null;
  steps: DiscoveryStep[] | null;
  startedAt: Date;
  completedAt: Date | null;
  error: string | null;
  importedProjectId: string | null;
}) {
  return {
    id: session.id,
    status: session.status,
    progress: session.progress,
    currentStep: session.currentStep ?? null,
    steps: session.steps ?? [],
    startedAt: session.startedAt.toISOString(),
    completedAt: session.completedAt?.toISOString() ?? null,
    error: session.error ?? null,
    importedProjectId: session.importedProjectId ?? null,
  };
}

export default router;
