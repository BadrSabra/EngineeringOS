/**
 * PR-01 (Durable Jobs): Unit tests for atomic claim / heartbeat / complete / fail
 * lease helpers in job-lease.ts. All tests use the real DB and clean up after
 * themselves — no mocks of DB internals.
 */
import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { db, projectsTable, scanJobsTable, discoverySessionsTable } from "@workspace/db";
import {
  claimScanJob,
  heartbeatScanJob,
  completeScanJob,
  failScanJob,
  claimDiscoverySession,
  heartbeatDiscoverySession,
  releaseDiscoverySessionLease,
  SCAN_LEASE_MS,
  DISCOVERY_LEASE_MS,
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

  afterEach(async () => {
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
      updatedAt: new Date(),
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
      createdAt: new Date(),
      updatedAt: new Date(),
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
