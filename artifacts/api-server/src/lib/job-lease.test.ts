/**
 * PR-01 (Durable Jobs): Unit tests for atomic claim / heartbeat / complete / fail
 * lease helpers in job-lease.ts. All tests use the real DB and clean up after
 * themselves — no mocks of DB internals.
 */
import { afterEach, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import {
  db,
  projectsTable,
  scanJobsTable,
  discoverySessionsTable,
  eventsTable,
} from "@workspace/db";
import {
  claimScanJob,
  heartbeatScanJob,
  completeScanJob,
  failScanJob,
  persistScanJobTransaction,
  claimDiscoverySession,
  heartbeatDiscoverySession,
  releaseDiscoverySessionLease,
  SCAN_LEASE_MS,
  DISCOVERY_LEASE_MS,
  ScanJobLeaseLostError,
} from "./job-lease.js";

// ── Helpers ────────────────────────────────────────────────────────────────────

async function insertProject(): Promise<string> {
  const id = randomUUID();
  const now = new Date();
  await db.insert(projectsTable).values({
    id,
    ownerId: "lease-test-user",
    name: `lease-proj-${id.slice(0, 8)}`,
    rootPath: `/tmp/lease-test-${id}`,
    language: "typescript",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

// ── Scan-job lease helpers ─────────────────────────────────────────────────────

describe("scan-job lease helpers", () => {
  const projectCleanup: string[] = [];
  const jobCleanup: string[] = [];
  const eventCleanup: string[] = [];

  afterEach(async () => {
    for (const id of eventCleanup.splice(0)) {
      await db.delete(eventsTable).where(eq(eventsTable.id, id));
    }
    for (const id of jobCleanup.splice(0)) {
      await db.delete(scanJobsTable).where(eq(scanJobsTable.id, id));
    }
    for (const id of projectCleanup.splice(0)) {
      await db.delete(projectsTable).where(eq(projectsTable.id, id));
    }
  });

  async function insertJob(status: "queued" | "running" = "queued"): Promise<string> {
    const projectId = await insertProject();
    projectCleanup.push(projectId);
    const jobId = randomUUID();
    jobCleanup.push(jobId);
    await db.insert(scanJobsTable).values({
      id: jobId,
      projectId,
      status,
      createdAt: new Date(),
    });
    return jobId;
  }

  it("claimScanJob transitions queued → running and sets all lease fields", async () => {
    const jobId = await insertJob();
    const workerId = randomUUID();

    const claimed = await claimScanJob(jobId, workerId, SCAN_LEASE_MS);
    expect(claimed).toBe(true);

    const [row] = await db.select().from(scanJobsTable).where(eq(scanJobsTable.id, jobId));
    expect(row.status).toBe("running");
    expect(row.workerId).toBe(workerId);
    expect(row.leaseUntil).not.toBeNull();
    expect(row.lastHeartbeatAt).not.toBeNull();
    expect(row.startedAt).not.toBeNull();
    // Lease must be in the future
    expect(row.leaseUntil!.getTime()).toBeGreaterThan(Date.now());
  });

  it("claimScanJob returns false when job is not in queued state", async () => {
    const jobId = await insertJob("running");
    const claimed = await claimScanJob(jobId, randomUUID(), SCAN_LEASE_MS);
    expect(claimed).toBe(false);
  });

  it("claimScanJob prevents double-claim — only one concurrent winner", async () => {
    const jobId = await insertJob();
    const [w1, w2] = [randomUUID(), randomUUID()];

    const [c1, c2] = await Promise.all([
      claimScanJob(jobId, w1, SCAN_LEASE_MS),
      claimScanJob(jobId, w2, SCAN_LEASE_MS),
    ]);

    // Exactly one must win — not both, not neither
    expect(c1 || c2).toBe(true);  // at least one wins
    expect(c1 && c2).toBe(false); // at most one wins
  });

  it("does not let a stale worker complete after a recovered worker claims the row", async () => {
    const jobId = await insertJob();
    const staleWorker = randomUUID();
    const currentWorker = randomUUID();

    expect(await claimScanJob(jobId, staleWorker, SCAN_LEASE_MS)).toBe(true);

    // Model reconciliation recovering the expired row and dispatching it
    // again. The next claim is the durable cross-process ownership boundary.
    await db.update(scanJobsTable).set({
      status: "queued",
      workerId: null,
      leaseUntil: null,
      lastHeartbeatAt: null,
    }).where(eq(scanJobsTable.id, jobId));
    expect(await claimScanJob(jobId, currentWorker, SCAN_LEASE_MS)).toBe(true);

    expect(await completeScanJob(jobId, staleWorker, { source: "stale" })).toBe(false);
    expect(await completeScanJob(jobId, currentWorker, { source: "current" })).toBe(true);

    const [row] = await db
      .select({ status: scanJobsTable.status, result: scanJobsTable.result })
      .from(scanJobsTable)
      .where(eq(scanJobsTable.id, jobId));
    expect(row.status).toBe("completed");
    expect(row.result).toEqual({ source: "current" });
  });

  it("heartbeatScanJob extends lease_until forward in time", async () => {
    const jobId = await insertJob();
    const workerId = randomUUID();
    await claimScanJob(jobId, workerId, SCAN_LEASE_MS);

    const [before] = await db
      .select({ leaseUntil: scanJobsTable.leaseUntil })
      .from(scanJobsTable)
      .where(eq(scanJobsTable.id, jobId));

    await new Promise((r) => setTimeout(r, 20)); // ensure time advances
    await heartbeatScanJob(jobId, workerId, SCAN_LEASE_MS);

    const [after] = await db
      .select({ leaseUntil: scanJobsTable.leaseUntil })
      .from(scanJobsTable)
      .where(eq(scanJobsTable.id, jobId));

    expect(after.leaseUntil!.getTime()).toBeGreaterThanOrEqual(before.leaseUntil!.getTime());
  });

  it("heartbeatScanJob is a silent no-op when workerId does not match", async () => {
    const jobId = await insertJob();
    const workerId = randomUUID();
    await claimScanJob(jobId, workerId, SCAN_LEASE_MS);

    const [before] = await db
      .select({ leaseUntil: scanJobsTable.leaseUntil })
      .from(scanJobsTable)
      .where(eq(scanJobsTable.id, jobId));

    // Rogue worker tries to heartbeat — should silently no-op
    await heartbeatScanJob(jobId, randomUUID(), SCAN_LEASE_MS);

    const [after] = await db
      .select({ leaseUntil: scanJobsTable.leaseUntil })
      .from(scanJobsTable)
      .where(eq(scanJobsTable.id, jobId));

    expect(after.leaseUntil!.getTime()).toBe(before.leaseUntil!.getTime());
  });

  it("does not renew, complete, or fail a scan after its lease expires", async () => {
    const jobId = await insertJob();
    const workerId = randomUUID();
    await claimScanJob(jobId, workerId, SCAN_LEASE_MS);
    const expiredAt = new Date(Date.now() - 1_000);
    await db.update(scanJobsTable)
      .set({ leaseUntil: expiredAt })
      .where(eq(scanJobsTable.id, jobId));

    expect(await heartbeatScanJob(jobId, workerId, SCAN_LEASE_MS)).toBe(false);
    expect(await completeScanJob(jobId, workerId, { source: "expired" })).toBe(false);
    expect(await failScanJob(jobId, workerId, "expired worker")).toBe(false);

    const [row] = await db.select().from(scanJobsTable).where(eq(scanJobsTable.id, jobId));
    expect(row.status).toBe("running");
    expect(row.workerId).toBe(workerId);
    expect(row.leaseUntil?.getTime()).toBe(expiredAt.getTime());
    expect(row.result).toBeNull();
    expect(row.error).toBeNull();
  });

  it("rolls back scan effects when reconciliation wins before transactional completion", async () => {
    const jobId = await insertJob();
    const workerId = randomUUID();
    const [job] = await db.select({
      projectId: scanJobsTable.projectId,
    }).from(scanJobsTable).where(eq(scanJobsTable.id, jobId));
    expect(await claimScanJob(jobId, workerId, SCAN_LEASE_MS)).toBe(true);

    let finishPersisting!: () => void;
    let notifyEffectsStaged!: () => void;
    const effectsStaged = new Promise<void>((resolve) => {
      notifyEffectsStaged = resolve;
    });
    const allowFinalFence = new Promise<void>((resolve) => {
      finishPersisting = resolve;
    });
    const staleAttempt = persistScanJobTransaction(jobId, workerId, async (tx) => {
      await tx.insert(eventsTable).values({
        id: randomUUID(),
        type: "ProjectScanned",
        projectId: job.projectId,
        severity: "success",
        message: "must roll back with stale scan",
        correlationId: jobId,
      });
      notifyEffectsStaged();
      await allowFinalFence;
      return { source: "stale" };
    });

    await effectsStaged;
    // Model the durable recovery transition winning after scan effects have
    // been staged but before the same transaction's completion fence.
    await db.update(scanJobsTable).set({
      status: "queued",
      workerId: null,
      leaseUntil: null,
      lastHeartbeatAt: null,
    }).where(eq(scanJobsTable.id, jobId));
    finishPersisting();

    await expect(staleAttempt).rejects.toBeInstanceOf(ScanJobLeaseLostError);

    const [row] = await db.select().from(scanJobsTable).where(eq(scanJobsTable.id, jobId));
    const events = await db.select().from(eventsTable).where(eq(eventsTable.projectId, job.projectId));
    expect(row.status).toBe("queued");
    expect(row.workerId).toBeNull();
    expect(events).toHaveLength(0);
  });

  it("rejects a stale writer running in another process after lease recovery", async () => {
    const jobId = await insertJob();
    const staleWorker = randomUUID();
    const currentWorker = randomUUID();
    const eventId = randomUUID();
    eventCleanup.push(eventId);
    const [job] = await db.select({
      projectId: scanJobsTable.projectId,
    }).from(scanJobsTable).where(eq(scanJobsTable.id, jobId));

    expect(await claimScanJob(jobId, staleWorker, SCAN_LEASE_MS)).toBe(true);

    const jobLeaseModuleUrl = new URL("./job-lease.ts", import.meta.url).href;
    const childSource = [
      `(async () => {`,
      `  const { eventsTable, pool } = await import("@workspace/db");`,
      `  const { persistScanJobTransaction } = await import(${JSON.stringify(jobLeaseModuleUrl)});`,
      `  try {`,
      `    await persistScanJobTransaction(${JSON.stringify(jobId)}, ${JSON.stringify(staleWorker)}, async (tx) => {`,
      `      await tx.insert(eventsTable).values({`,
      `        id: ${JSON.stringify(eventId)},`,
      `        type: "ProjectScanned",`,
      `        projectId: ${JSON.stringify(job.projectId)},`,
      `        severity: "success",`,
      `        message: "stale child must roll back",`,
      `        correlationId: ${JSON.stringify(jobId)},`,
      `      });`,
      `      process.stdout.write("STAGED\\n");`,
      `      await new Promise((resolve) => process.stdin.once("data", () => { process.stdin.destroy(); resolve(); }));`,
      `      return { source: "child-stale" };`,
      `    });`,
      `    process.stdout.write("UNEXPECTED_COMMIT\\n");`,
      `    process.exitCode = 2;`,
      `  } catch (error) {`,
      `    process.stdout.write("REJECTED:" + (error instanceof Error ? error.name : "unknown") + "\\n");`,
      `  } finally {`,
      `    await pool.end();`,
      `  }`,
      `})().catch((error) => { console.error(error); process.exitCode = 1; });`,
    ].join("\n");

    let child: ChildProcess | undefined;
    let childOutput = "";
    try {
      child = spawn(process.execPath, ["--import", "tsx", "-e", childSource], {
        cwd: process.cwd(),
        env: {
          PATH: process.env.PATH,
          NODE_ENV: "test",
          DATABASE_URL: process.env.DATABASE_URL,
        },
        stdio: ["pipe", "pipe", "pipe"],
      });
      child.stdout?.setEncoding("utf8").on("data", (chunk: string) => {
        childOutput = `${childOutput}${chunk}`.slice(-8_000);
      });
      child.stderr?.setEncoding("utf8").on("data", (chunk: string) => {
        childOutput = `${childOutput}${chunk}`.slice(-8_000);
      });

      const stageDeadline = Date.now() + 15_000;
      while (!childOutput.includes("STAGED\n") && Date.now() < stageDeadline) {
        if (child.exitCode !== null || child.signalCode !== null) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(childOutput, "stale worker did not stage its transaction").toContain("STAGED\n");

      await db.update(scanJobsTable).set({
        status: "queued",
        workerId: null,
        leaseUntil: null,
        lastHeartbeatAt: null,
      }).where(eq(scanJobsTable.id, jobId));
      expect(await claimScanJob(jobId, currentWorker, SCAN_LEASE_MS)).toBe(true);
      expect(await completeScanJob(jobId, currentWorker, { source: "recovered-worker" })).toBe(true);

      child.stdin?.write("continue\n");
      const exitDeadline = Date.now() + 15_000;
      while (child.exitCode === null && child.signalCode === null && Date.now() < exitDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(child.exitCode, `stale child did not exit cleanly: ${childOutput}`).toBe(0);
      expect(childOutput).toContain("REJECTED:ScanJobLeaseLostError");

      const [row] = await db.select().from(scanJobsTable).where(eq(scanJobsTable.id, jobId));
      const events = await db.select().from(eventsTable).where(eq(eventsTable.projectId, job.projectId));
      expect(row.status).toBe("completed");
      expect(row.result).toEqual({ source: "recovered-worker" });
      expect(events).toHaveLength(0);
    } finally {
      if (child && child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
        await new Promise<void>((resolve) => child?.once("exit", () => resolve()));
      }
    }
  });

  it("completeScanJob sets status=completed and clears all lease fields", async () => {
    const jobId = await insertJob();
    const workerId = randomUUID();
    await claimScanJob(jobId, workerId, SCAN_LEASE_MS);
    await completeScanJob(jobId, workerId, { summary: "done" });

    const [row] = await db.select().from(scanJobsTable).where(eq(scanJobsTable.id, jobId));
    expect(row.status).toBe("completed");
    expect(row.workerId).toBeNull();
    expect(row.leaseUntil).toBeNull();
    expect(row.lastHeartbeatAt).toBeNull();
    expect(row.finishedAt).not.toBeNull();
  });

  it("failScanJob sets status=failed with error message and clears lease fields", async () => {
    const jobId = await insertJob();
    const workerId = randomUUID();
    await claimScanJob(jobId, workerId, SCAN_LEASE_MS);
    await failScanJob(jobId, workerId, "something went wrong");

    const [row] = await db.select().from(scanJobsTable).where(eq(scanJobsTable.id, jobId));
    expect(row.status).toBe("failed");
    expect(row.error).toBe("something went wrong");
    expect(row.workerId).toBeNull();
    expect(row.leaseUntil).toBeNull();
    expect(row.lastHeartbeatAt).toBeNull();
    expect(row.finishedAt).not.toBeNull();
  });
});

// ── Discovery-session lease helpers ───────────────────────────────────────────

describe("discovery-session lease helpers", () => {
  const sessionCleanup: string[] = [];

  afterEach(async () => {
    for (const id of sessionCleanup.splice(0)) {
      await db.delete(discoverySessionsTable).where(eq(discoverySessionsTable.id, id));
    }
  });

  async function insertSession(status: "pending" | "discovering" = "pending"): Promise<string> {
    const sessionId = randomUUID();
    sessionCleanup.push(sessionId);
    await db.insert(discoverySessionsTable).values({
      id: sessionId,
      ownerId: "lease-test-user",
      rootPath: `/tmp/discovery-${sessionId}`,
      status,
      progress: 0,
    });
    return sessionId;
  }

  it("claimDiscoverySession transitions pending → discovering with workerId and lease", async () => {
    const sessionId = await insertSession();
    const workerId = randomUUID();

    const claimed = await claimDiscoverySession(sessionId, workerId, DISCOVERY_LEASE_MS);
    expect(claimed).toBe(true);

    const [row] = await db
      .select()
      .from(discoverySessionsTable)
      .where(eq(discoverySessionsTable.id, sessionId));
    expect(row.status).toBe("discovering");
    expect(row.workerId).toBe(workerId);
    expect(row.leaseUntil).not.toBeNull();
    expect(row.leaseUntil!.getTime()).toBeGreaterThan(Date.now());
  });

  it("claimDiscoverySession returns false for a non-pending session", async () => {
    const sessionId = await insertSession("discovering");
    const claimed = await claimDiscoverySession(sessionId, randomUUID(), DISCOVERY_LEASE_MS);
    expect(claimed).toBe(false);
  });

  it("claimDiscoverySession prevents double-claim when two workers race", async () => {
    const sessionId = await insertSession();
    const [w1, w2] = [randomUUID(), randomUUID()];

    const [c1, c2] = await Promise.all([
      claimDiscoverySession(sessionId, w1, DISCOVERY_LEASE_MS),
      claimDiscoverySession(sessionId, w2, DISCOVERY_LEASE_MS),
    ]);

    expect(c1 || c2).toBe(true);
    expect(c1 && c2).toBe(false);
  });

  it("heartbeatDiscoverySession no-ops when workerId does not match", async () => {
    const sessionId = await insertSession();
    const workerId = randomUUID();
    await claimDiscoverySession(sessionId, workerId, DISCOVERY_LEASE_MS);

    const [before] = await db
      .select({ leaseUntil: discoverySessionsTable.leaseUntil })
      .from(discoverySessionsTable)
      .where(eq(discoverySessionsTable.id, sessionId));

    await heartbeatDiscoverySession(sessionId, randomUUID(), DISCOVERY_LEASE_MS);

    const [after] = await db
      .select({ leaseUntil: discoverySessionsTable.leaseUntil })
      .from(discoverySessionsTable)
      .where(eq(discoverySessionsTable.id, sessionId));

    expect(after.leaseUntil!.getTime()).toBe(before.leaseUntil!.getTime());
  });

  it("releaseDiscoverySessionLease clears workerId, leaseUntil, lastHeartbeatAt", async () => {
    const sessionId = await insertSession();
    const workerId = randomUUID();
    await claimDiscoverySession(sessionId, workerId, DISCOVERY_LEASE_MS);

    // Verify fields are set
    const [claimed] = await db
      .select()
      .from(discoverySessionsTable)
      .where(eq(discoverySessionsTable.id, sessionId));
    expect(claimed.workerId).not.toBeNull();

    await releaseDiscoverySessionLease(sessionId);

    const [released] = await db
      .select()
      .from(discoverySessionsTable)
      .where(eq(discoverySessionsTable.id, sessionId));
    expect(released.workerId).toBeNull();
    expect(released.leaseUntil).toBeNull();
    expect(released.lastHeartbeatAt).toBeNull();
  });
});
