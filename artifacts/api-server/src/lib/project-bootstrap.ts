import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import {
  db,
  eventsTable,
  projectBootstrapJobsTable,
  projectsTable,
} from "@workspace/db";
import { and, eq, gt, lt, lte, sql } from "drizzle-orm";
import type { ProjectBootstrapJob } from "@workspace/db";
import { heavyJobQueue } from "./job-queue.js";
import { logger } from "./logger.js";
import { recordAuditInTransaction } from "./audit.js";
import { establishProjectRoot } from "./project-root.js";
import {
  managedProjectRootForSession,
  materializeProjectRoot,
  removeManagedProjectRoot,
} from "./project-materialization.js";
import { invalidateContextCache } from "@workspace/ai-orchestrator";

export const PROJECT_BOOTSTRAP_TEMPLATE_VERSION = "react-vite-v1";
export const PROJECT_BOOTSTRAP_MAX_ATTEMPTS = 3;
export const PROJECT_BOOTSTRAP_LEASE_MS = 120_000;
export const PROJECT_BOOTSTRAP_HEARTBEAT_MS = 20_000;
export const PROJECT_BOOTSTRAP_INSTALL_TIMEOUT_MS = 180_000;

const TEMPLATE_DIRECTORY = resolve(
  process.env.WORKSPACE_PATH ?? "/home/runner/workspace",
  "artifacts/api-server/templates",
  PROJECT_BOOTSTRAP_TEMPLATE_VERSION,
);

export class ProjectBootstrapIdempotencyConflict extends Error {
  constructor() {
    super("The idempotency key is already associated with different project details.");
    this.name = "ProjectBootstrapIdempotencyConflict";
  }
}

class ProjectBootstrapFailure extends Error {
  constructor(
    readonly code: string,
    readonly safeMessage: string,
    readonly retryable: boolean,
  ) {
    super(safeMessage);
    this.name = "ProjectBootstrapFailure";
  }
}

class ProjectBootstrapLeaseLost extends Error {
  constructor() {
    super("Project bootstrap worker no longer owns the operation.");
    this.name = "ProjectBootstrapLeaseLost";
  }
}

export function toProjectBootstrapOperation(job: ProjectBootstrapJob) {
  return {
    id: job.id,
    status: job.status,
    projectId: job.projectId ?? null,
    templateVersion: job.templateVersion,
    errorCode: job.errorCode ?? null,
    errorMessage: job.errorMessage ?? null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

export async function createProjectBootstrapJob(params: {
  ownerId: string;
  idempotencyKey: string;
  name: string;
  description: string;
}): Promise<ProjectBootstrapJob> {
  const now = new Date();
  const jobId = randomUUID();
  const [inserted] = await db
    .insert(projectBootstrapJobsTable)
    .values({
      id: jobId,
      ownerId: params.ownerId,
      idempotencyKey: params.idempotencyKey,
      name: params.name.trim(),
      description: params.description.trim(),
      templateVersion: PROJECT_BOOTSTRAP_TEMPLATE_VERSION,
      status: "queued",
      attempt: 0,
      maxAttempts: PROJECT_BOOTSTRAP_MAX_ATTEMPTS,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({
      target: [
        projectBootstrapJobsTable.ownerId,
        projectBootstrapJobsTable.idempotencyKey,
      ],
    })
    .returning();

  const [job] = inserted
    ? [inserted]
    : await db
        .select()
        .from(projectBootstrapJobsTable)
        .where(
          and(
            eq(projectBootstrapJobsTable.ownerId, params.ownerId),
            eq(
              projectBootstrapJobsTable.idempotencyKey,
              params.idempotencyKey,
            ),
          ),
        )
        .limit(1);
  if (!job) {
    throw new Error("Project bootstrap operation could not be persisted.");
  }
  if (job.name !== params.name.trim() || job.description !== params.description.trim()) {
    throw new ProjectBootstrapIdempotencyConflict();
  }
  if (job.status === "queued") enqueueProjectBootstrapJob(job.id);
  return job;
}

export async function getOwnedProjectBootstrapJob(
  ownerId: string,
  id: string,
): Promise<ProjectBootstrapJob | undefined> {
  const [job] = await db
    .select()
    .from(projectBootstrapJobsTable)
    .where(
      and(
        eq(projectBootstrapJobsTable.ownerId, ownerId),
        eq(projectBootstrapJobsTable.id, id),
      ),
    )
    .limit(1);
  return job;
}

export function enqueueProjectBootstrapJob(id: string): boolean {
  return heavyJobQueue.enqueueWithId(`project-bootstrap:${id}`, async () => {
    try {
      await runProjectBootstrapJob(id);
    } catch (error) {
      logger.error(
        { error, bootstrapId: id },
        "Project bootstrap runner escaped its error boundary",
      );
    }
  });
}

function isOwnedByWorker(job: ProjectBootstrapJob | undefined, workerId: string): boolean {
  return Boolean(
    job?.status === "running"
    && job.workerId === workerId
    && job.leaseUntil
    && job.leaseUntil.getTime() > Date.now(),
  );
}

async function assertWorkerLease(jobId: string, workerId: string): Promise<void> {
  const [job] = await db
    .select()
    .from(projectBootstrapJobsTable)
    .where(
      and(
        eq(projectBootstrapJobsTable.id, jobId),
        eq(projectBootstrapJobsTable.status, "running"),
        eq(projectBootstrapJobsTable.workerId, workerId),
        gt(projectBootstrapJobsTable.leaseUntil, new Date()),
      ),
    )
    .limit(1);
  if (!isOwnedByWorker(job, workerId)) throw new ProjectBootstrapLeaseLost();
}

async function claimProjectBootstrapJob(
  jobId: string,
  workerId: string,
): Promise<ProjectBootstrapJob | undefined> {
  const now = new Date();
  const [job] = await db
    .update(projectBootstrapJobsTable)
    .set({
      status: "running",
      attempt: sql`${projectBootstrapJobsTable.attempt} + 1`,
      workerId,
      leaseUntil: new Date(now.getTime() + PROJECT_BOOTSTRAP_LEASE_MS),
      lastHeartbeatAt: now,
      startedAt: now,
      updatedAt: now,
      errorCode: null,
      errorMessage: null,
    })
    .where(
      and(
        eq(projectBootstrapJobsTable.id, jobId),
        eq(projectBootstrapJobsTable.status, "queued"),
        lt(projectBootstrapJobsTable.attempt, projectBootstrapJobsTable.maxAttempts),
      ),
    )
    .returning();
  return job;
}

async function setWorkingRoot(
  jobId: string,
  workerId: string,
  rootPath: string,
): Promise<void> {
  const [updated] = await db
    .update(projectBootstrapJobsTable)
    .set({
      workingRootPath: rootPath,
      leaseUntil: new Date(Date.now() + PROJECT_BOOTSTRAP_LEASE_MS),
      lastHeartbeatAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(projectBootstrapJobsTable.id, jobId),
        eq(projectBootstrapJobsTable.status, "running"),
        eq(projectBootstrapJobsTable.workerId, workerId),
        gt(projectBootstrapJobsTable.leaseUntil, new Date()),
      ),
    )
    .returning({ id: projectBootstrapJobsTable.id });
  if (!updated) throw new ProjectBootstrapLeaseLost();
}

function bootstrapCommandEnvironment(): NodeJS.ProcessEnv {
  const allowedNames = [
    "PATH",
    "HOME",
    "COREPACK_HOME",
    "NPM_CONFIG_CACHE",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "no_proxy",
  ];
  const env: NodeJS.ProcessEnv = { CI: "1" };
  for (const name of allowedNames) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  if (!env.PATH) env.PATH = "/usr/local/bin:/usr/bin:/bin";
  return env;
}

async function installTemplateDependencies(
  rootPath: string,
  signal: AbortSignal,
): Promise<void> {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn(
      "pnpm",
      [
        "install",
        "--frozen-lockfile",
        "--ignore-workspace",
        "--ignore-scripts",
        "--reporter=append-only",
      ],
      {
        cwd: rootPath,
        env: bootstrapCommandEnvironment(),
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      if (error) rejectPromise(error);
      else resolvePromise();
    };
    const abort = () => {
      child.kill("SIGTERM");
      const forceKill = setTimeout(() => child.kill("SIGKILL"), 4_000);
      forceKill.unref?.();
      finish(new ProjectBootstrapLeaseLost());
    };
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      const forceKill = setTimeout(() => child.kill("SIGKILL"), 4_000);
      forceKill.unref?.();
      finish(new ProjectBootstrapFailure(
        "DEPENDENCY_INSTALL_TIMEOUT",
        "Installing the starter dependencies took too long. Please try again.",
        true,
      ));
    }, PROJECT_BOOTSTRAP_INSTALL_TIMEOUT_MS);
    timeout.unref?.();
    child.stdout?.on("data", () => undefined);
    child.stderr?.on("data", () => undefined);
    child.once("error", () => finish(new ProjectBootstrapFailure(
      "DEPENDENCY_INSTALL_FAILED",
      "The starter dependencies could not be installed. Please try again.",
      true,
    )));
    child.once("close", (code) => {
      if (signal.aborted) {
        finish(new ProjectBootstrapLeaseLost());
      } else if (code === 0) {
        finish();
      } else {
        finish(new ProjectBootstrapFailure(
          "DEPENDENCY_INSTALL_FAILED",
          "The starter dependencies could not be installed. Please try again.",
          true,
        ));
      }
    });
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}

function startHeartbeat(
  jobId: string,
  workerId: string,
  controller: AbortController,
): NodeJS.Timeout {
  let inFlight = false;
  return setInterval(() => {
    if (inFlight || controller.signal.aborted) return;
    inFlight = true;
    const now = new Date();
    void db
      .update(projectBootstrapJobsTable)
      .set({
        leaseUntil: new Date(now.getTime() + PROJECT_BOOTSTRAP_LEASE_MS),
        lastHeartbeatAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(projectBootstrapJobsTable.id, jobId),
          eq(projectBootstrapJobsTable.status, "running"),
          eq(projectBootstrapJobsTable.workerId, workerId),
          gt(projectBootstrapJobsTable.leaseUntil, now),
        ),
      )
      .returning({ id: projectBootstrapJobsTable.id })
      .then(([owned]) => {
        if (!owned) controller.abort();
      })
      .catch((error) => {
        logger.warn(
          { error, bootstrapId: jobId },
          "Project bootstrap heartbeat failed; stopping the worker fail-closed",
        );
        controller.abort();
      })
      .finally(() => {
        inFlight = false;
      });
  }, PROJECT_BOOTSTRAP_HEARTBEAT_MS);
}

async function commitCreatedProject(params: {
  job: ProjectBootstrapJob;
  workerId: string;
  canonicalRootPath: string;
}): Promise<string> {
  const now = new Date();
  const projectId = randomUUID();
  const correlationId = randomUUID();
  await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(projectsTable)
      .values({
        id: projectId,
        ownerId: params.job.ownerId,
        name: params.job.name,
        description: params.job.description || null,
        rootPath: params.canonicalRootPath,
        language: "TypeScript",
        framework: "React/Vite",
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    await tx.insert(eventsTable).values({
      id: randomUUID(),
      type: "ProjectCreated",
      projectId,
      severity: "info",
      message: `Project "${params.job.name}" created from the React/Vite template`,
      correlationId,
    });
    await recordAuditInTransaction(tx, {
      entityType: "project",
      entityId: projectId,
      action: "created",
      projectId,
      actor: params.job.ownerId,
      stateAfter: created,
      correlationId,
    });
    const [completed] = await tx
      .update(projectBootstrapJobsTable)
      .set({
        status: "completed",
        projectId,
        workerId: null,
        leaseUntil: null,
        workingRootPath: null,
        errorCode: null,
        errorMessage: null,
        updatedAt: now,
        finishedAt: now,
      })
      .where(
        and(
          eq(projectBootstrapJobsTable.id, params.job.id),
          eq(projectBootstrapJobsTable.status, "running"),
          eq(projectBootstrapJobsTable.workerId, params.workerId),
          gt(projectBootstrapJobsTable.leaseUntil, now),
        ),
      )
      .returning({ id: projectBootstrapJobsTable.id });
    if (!completed) throw new ProjectBootstrapLeaseLost();
  });
  invalidateContextCache(projectId);
  return projectId;
}

async function finishFailedAttempt(params: {
  job: ProjectBootstrapJob;
  workerId: string;
  error: ProjectBootstrapFailure;
}): Promise<void> {
  const now = new Date();
  const retry = params.error.retryable && params.job.attempt < params.job.maxAttempts;
  await db
    .update(projectBootstrapJobsTable)
    .set({
      status: retry ? "queued" : "failed",
      workerId: null,
      leaseUntil: null,
      workingRootPath: null,
      errorCode: retry ? null : params.error.code,
      errorMessage: retry ? null : params.error.safeMessage,
      updatedAt: now,
      finishedAt: retry ? null : now,
    })
    .where(
      and(
        eq(projectBootstrapJobsTable.id, params.job.id),
        eq(projectBootstrapJobsTable.status, "running"),
        eq(projectBootstrapJobsTable.workerId, params.workerId),
        gt(projectBootstrapJobsTable.leaseUntil, now),
      ),
    );
}

export async function runProjectBootstrapJob(jobId: string): Promise<void> {
  const workerId = randomUUID();
  const job = await claimProjectBootstrapJob(jobId, workerId);
  if (!job) return;

  const attemptRootKey = `${job.id}_attempt_${job.attempt}`;
  const rootPath = managedProjectRootForSession(attemptRootKey);
  const controller = new AbortController();
  const heartbeat = startHeartbeat(job.id, workerId, controller);
  let rootWasMaterialized = false;

  try {
    await setWorkingRoot(job.id, workerId, rootPath);
    await access(TEMPLATE_DIRECTORY);
    await assertWorkerLease(job.id, workerId);
    await materializeProjectRoot(TEMPLATE_DIRECTORY, attemptRootKey, {
      excludeTopLevel: ["node_modules", "dist", "coverage"],
    });
    rootWasMaterialized = true;
    await assertWorkerLease(job.id, workerId);
    await installTemplateDependencies(rootPath, controller.signal);
    await assertWorkerLease(job.id, workerId);

    const rootResult = await establishProjectRoot(rootPath, { requireMarkers: true });
    if (!rootResult.ok) {
      throw new ProjectBootstrapFailure(
        "ROOT_VALIDATION_FAILED",
        "The new project did not pass workspace validation. Please try again.",
        false,
      );
    }
    const projectId = await commitCreatedProject({
      job,
      workerId,
      canonicalRootPath: rootResult.canonicalPath,
    });
    logger.info(
      { bootstrapId: job.id, projectId, attempt: job.attempt },
      "Project bootstrap completed",
    );
  } catch (error) {
    if (rootWasMaterialized || rootPath) {
      await removeManagedProjectRoot(rootPath).catch((cleanupError) => {
        logger.warn(
          { cleanupError, bootstrapId: job.id },
          "Failed to remove the managed root after project bootstrap failure",
        );
      });
    }
    if (error instanceof ProjectBootstrapLeaseLost) return;
    const failure = error instanceof ProjectBootstrapFailure
      ? error
      : new ProjectBootstrapFailure(
          "PROJECT_BOOTSTRAP_FAILED",
          "The project could not be created. Please try again.",
          true,
        );
    logger.error(
      { error, bootstrapId: job.id, attempt: job.attempt, failureCode: failure.code },
      "Project bootstrap attempt failed",
    );
    try {
      await finishFailedAttempt({ job, workerId, error: failure });
    } catch (persistError) {
      logger.error(
        { persistError, bootstrapId: job.id, workerId },
        "Could not persist project bootstrap failure",
      );
    }
  } finally {
    clearInterval(heartbeat);
  }
}

async function reclaimExpiredBootstrapLeases(): Promise<number> {
  const now = new Date();
  const expired = await db
    .select()
    .from(projectBootstrapJobsTable)
    .where(
      and(
        eq(projectBootstrapJobsTable.status, "running"),
        lte(projectBootstrapJobsTable.leaseUntil, now),
      ),
    )
    .limit(100);
  let reclaimed = 0;
  for (const job of expired) {
    const retry = job.attempt < job.maxAttempts;
    const [updated] = await db
      .update(projectBootstrapJobsTable)
      .set({
        status: retry ? "queued" : "failed",
        workerId: null,
        leaseUntil: null,
        workingRootPath: null,
        errorCode: retry ? null : "ATTEMPTS_EXHAUSTED",
        errorMessage: retry
          ? null
          : "The project could not be created after several attempts. Please start again.",
        updatedAt: now,
        finishedAt: retry ? null : now,
      })
      .where(
        and(
          eq(projectBootstrapJobsTable.id, job.id),
          eq(projectBootstrapJobsTable.status, "running"),
          eq(projectBootstrapJobsTable.workerId, job.workerId!),
          lte(projectBootstrapJobsTable.leaseUntil, now),
        ),
      )
      .returning({ id: projectBootstrapJobsTable.id });
    if (updated) {
      reclaimed++;
      if (job.workingRootPath) {
        await removeManagedProjectRoot(job.workingRootPath).catch((error) => {
          logger.warn(
            { error, bootstrapId: job.id },
            "Could not clean an expired project bootstrap root",
          );
        });
      }
    }
  }
  return reclaimed;
}

export async function dispatchProjectBootstrapJobs(): Promise<number> {
  const reclaimed = await reclaimExpiredBootstrapLeases();
  const queued = await db
    .select({ id: projectBootstrapJobsTable.id })
    .from(projectBootstrapJobsTable)
    .where(
      and(
        eq(projectBootstrapJobsTable.status, "queued"),
        lt(projectBootstrapJobsTable.attempt, projectBootstrapJobsTable.maxAttempts),
      ),
    )
    .limit(100);
  let dispatched = reclaimed;
  for (const { id } of queued) {
    if (enqueueProjectBootstrapJob(id)) dispatched++;
  }
  return dispatched;
}
