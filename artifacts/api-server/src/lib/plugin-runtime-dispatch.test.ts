import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { eq } from "drizzle-orm";
import {
  auditLogsTable,
  db,
  eventsTable,
  pluginsTable,
  pluginRunsTable,
  pluginDispatchBatchesTable,
  projectPluginBindingsTable,
  projectsTable,
} from "@workspace/db";
import app from "../app.js";
import {
  dispatchOnScanComplete,
  dispatchPendingPluginRuns,
  persistPluginDispatch,
  PLUGIN_HOOKS,
  resolveEffectivePluginIds,
  type ScanCompleteContext,
} from "./plugin-runtime.js";
import { heavyJobQueue } from "./job-queue.js";

const projectIds: string[] = [];
let originalSecurityAvailability: boolean | undefined;

function scanContext(projectId: string): ScanCompleteContext {
  return {
    projectId, scanCorrelationId: randomUUID(), scanCompleteness: "COMPLETE",
    ruleEvaluationComplete: true, rulesEvaluated: 1, language: "typescript", framework: null,
    filesFound: 5, sourceFiles: 5, issuesDetected: 0, tasksCreated: 0,
    entitiesExtracted: 2, relationshipsExtracted: 1, ruleViolations: [], entities: [],
  };
}

async function activatedProject(): Promise<string> {
  const projectId = await insertProject();
  await db.insert(projectPluginBindingsTable).values({
    id: randomUUID(), projectId, pluginId: "plugin-security",
    enabled: true, approvedBy: "test-user",
  });
  return projectId;
}

async function waitUntil(predicate: () => Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("plugin state did not settle");
}

async function waitForPluginRuns(dispatchId: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const runs = await db
      .select({ status: pluginRunsTable.status, errorCode: pluginRunsTable.lastErrorCode })
      .from(pluginRunsTable)
      .where(eq(pluginRunsTable.dispatchId, dispatchId));
    if (runs.length > 0 && runs.every((run) => run.status === "completed")) return;
    if (runs.some((run) => run.status === "failed")) {
      throw new Error(`plugin dispatch failed: ${runs.map((run) => run.errorCode).join(",")}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`plugin dispatch did not complete: ${dispatchId}`);
}

async function insertProject(): Promise<string> {
  const id = `plugin-runtime-project-${randomUUID()}`;
  projectIds.push(id);
  await db.insert(projectsTable).values({
    id,
    ownerId: "test-user",
    name: "Plugin runtime project",
    rootPath: `/tmp/${id}`,
    language: "typescript",
  });
  return id;
}

beforeEach(async () => {
  const seeded = await request(app).get("/api/plugins");
  expect(seeded.status).toBe(200);

  const [securityPlugin] = await db
    .select({ enabled: pluginsTable.enabled })
    .from(pluginsTable)
    .where(eq(pluginsTable.id, "plugin-security"))
    .limit(1);
  if (!securityPlugin) throw new Error("Expected the built-in security plugin");

  originalSecurityAvailability = securityPlugin.enabled;
  await db
    .update(pluginsTable)
    .set({ enabled: true })
    .where(eq(pluginsTable.id, "plugin-security"));
});

afterEach(async () => {
  vi.restoreAllMocks();
  for (const projectId of projectIds.splice(0)) {
    await db
      .delete(eventsTable)
      .where(eq(eventsTable.projectId, projectId))
      .catch(() => undefined);
    await db
      .delete(auditLogsTable)
      .where(eq(auditLogsTable.projectId, projectId))
      .catch(() => undefined);
    await db
      .delete(projectPluginBindingsTable)
      .where(eq(projectPluginBindingsTable.projectId, projectId))
      .catch(() => undefined);
    await db
      .delete(projectsTable)
      .where(eq(projectsTable.id, projectId))
      .catch(() => undefined);
  }

  if (originalSecurityAvailability !== undefined) {
    await db
      .update(pluginsTable)
      .set({ enabled: originalSecurityAvailability })
      .where(eq(pluginsTable.id, "plugin-security"));
  }
  originalSecurityAvailability = undefined;
});

describe("project-scoped plugin scan dispatch", () => {
  it("rolls back plugin intent with the scan transaction", async () => {
    const ctx = scanContext(await activatedProject());
    await expect(db.transaction(async (tx) => {
      await persistPluginDispatch(tx, ctx);
      throw new Error("scan rollback fixture");
    })).rejects.toThrow("scan rollback fixture");
    expect(await db.select().from(pluginDispatchBatchesTable)
      .where(eq(pluginDispatchBatchesTable.id, ctx.scanCorrelationId))).toEqual([]);
  });

  it("keeps repeated dispatch idempotent and correlates exactly one event", async () => {
    const ctx = scanContext(await activatedProject());
    await dispatchOnScanComplete(ctx);
    await waitForPluginRuns(ctx.scanCorrelationId);
    await dispatchOnScanComplete(ctx);
    const runs = await db.select().from(pluginRunsTable)
      .where(eq(pluginRunsTable.dispatchId, ctx.scanCorrelationId));
    const events = await db.select().from(eventsTable)
      .where(eq(eventsTable.correlationId, ctx.scanCorrelationId));
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: "completed", attemptCount: 1 });
    expect(events.map((event) => event.type)).toEqual(["SecurityPluginClear"]);
  });

  it("retries a failed hook from durable state without duplicating its events", async () => {
    const ctx = scanContext(await activatedProject());
    vi.spyOn(PLUGIN_HOOKS["plugin-security"]!, "onScanComplete")
      .mockRejectedValueOnce(new Error("fixture hook failure"));
    await dispatchOnScanComplete(ctx);
    await waitUntil(async () => {
      const [run] = await db.select().from(pluginRunsTable)
        .where(eq(pluginRunsTable.dispatchId, ctx.scanCorrelationId));
      return run?.status === "pending" && run.attemptCount === 1;
    });
    const [retry] = await db.select().from(pluginRunsTable)
      .where(eq(pluginRunsTable.dispatchId, ctx.scanCorrelationId));
    expect(retry!.lastErrorCode).toBe("PLUGIN_HOOK_FAILED");
    expect(retry!.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
    await waitUntil(async () => !heavyJobQueue.has(retry!.id));
    await db.update(pluginRunsTable).set({ nextAttemptAt: new Date(0) })
      .where(eq(pluginRunsTable.id, retry!.id));
    await dispatchPendingPluginRuns({ dispatchId: ctx.scanCorrelationId });
    await waitForPluginRuns(ctx.scanCorrelationId);
    const [completed] = await db.select().from(pluginRunsTable)
      .where(eq(pluginRunsTable.id, retry!.id));
    expect(completed).toMatchObject({ status: "completed", attemptCount: 2, lastErrorCode: null });
    expect(await db.select().from(eventsTable)
      .where(eq(eventsTable.correlationId, ctx.scanCorrelationId))).toHaveLength(1);
  });

  it("discards an expired worker's output and recovers it under a new lease", async () => {
    const ctx = scanContext(await activatedProject());
    const hook = PLUGIN_HOOKS["plugin-security"]!;
    const original = hook.onScanComplete.bind(hook);
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const spy = vi.spyOn(hook, "onScanComplete").mockImplementationOnce(async (input) => {
      await barrier;
      return original(input);
    });
    await dispatchOnScanComplete(ctx);
    await waitUntil(async () => spy.mock.calls.length === 1);
    const [run] = await db.select().from(pluginRunsTable)
      .where(eq(pluginRunsTable.dispatchId, ctx.scanCorrelationId));
    await db.update(pluginRunsTable).set({ leaseUntil: new Date(0) })
      .where(eq(pluginRunsTable.id, run!.id));
    release();
    await waitUntil(async () => !heavyJobQueue.has(run!.id));
    expect(await db.select().from(eventsTable)
      .where(eq(eventsTable.correlationId, ctx.scanCorrelationId))).toHaveLength(0);
    const [stale] = await db.select().from(pluginRunsTable)
      .where(eq(pluginRunsTable.id, run!.id));
    expect(stale).toMatchObject({ status: "running", attemptCount: 1, resultEvents: null });
    await dispatchPendingPluginRuns({ dispatchId: ctx.scanCorrelationId });
    await waitForPluginRuns(ctx.scanCorrelationId);
    const [recovered] = await db.select().from(pluginRunsTable)
      .where(eq(pluginRunsTable.id, run!.id));
    expect(recovered).toMatchObject({ status: "completed", attemptCount: 2 });
    expect(await db.select().from(eventsTable)
      .where(eq(eventsTable.correlationId, ctx.scanCorrelationId))).toHaveLength(1);
  });

  it("terminalizes an expired final attempt instead of retrying forever", async () => {
    const ctx = scanContext(await activatedProject());
    await db.transaction((tx) => persistPluginDispatch(tx, ctx));
    await db.update(pluginRunsTable).set({
      status: "running", attemptCount: 3, workerId: "lost-worker", leaseUntil: new Date(0),
    }).where(eq(pluginRunsTable.dispatchId, ctx.scanCorrelationId));
    expect(await dispatchPendingPluginRuns({ dispatchId: ctx.scanCorrelationId })).toBe(0);
    const [failed] = await db.select().from(pluginRunsTable)
      .where(eq(pluginRunsTable.dispatchId, ctx.scanCorrelationId));
    expect(failed).toMatchObject({ status: "failed", attemptCount: 3, lastErrorCode: "PLUGIN_RUN_ATTEMPTS_EXHAUSTED" });
  });

  it("does not persist a run for an incompatible language", async () => {
    const ctx = { ...scanContext(await activatedProject()), language: "rust" };
    expect(await db.transaction((tx) => persistPluginDispatch(tx, ctx))).toBeNull();
    expect(await resolveEffectivePluginIds(ctx.projectId, ctx.language)).toEqual([]);
  });

  it("dispatches only when project activation and global availability both allow it", async () => {
    const projectA = await insertProject();
    const projectB = await insertProject();
    await db.insert(projectPluginBindingsTable).values({
      id: randomUUID(),
      projectId: projectA,
      pluginId: "plugin-security",
      enabled: true,
      approvedBy: "test-user",
    });

    expect(await resolveEffectivePluginIds(projectA)).toEqual([
      "plugin-security",
    ]);
    expect(await resolveEffectivePluginIds(projectB)).toEqual([]);

    const context = (
      projectId: string,
      scanCorrelationId = randomUUID(),
    ): ScanCompleteContext => ({
      projectId,
      scanCorrelationId,
      scanCompleteness: "COMPLETE",
      ruleEvaluationComplete: true,
      rulesEvaluated: 1,
      language: "typescript",
      filesFound: 10,
      sourceFiles: 8,
      issuesDetected: 0,
      tasksCreated: 0,
      entitiesExtracted: 5,
      relationshipsExtracted: 3,
      ruleViolations: [],
      entities: [],
    });

    const projectAScan = context(projectA);
    const projectBScan = context(projectB);
    await dispatchOnScanComplete(projectAScan);
    await dispatchOnScanComplete(projectBScan);
    await waitForPluginRuns(projectAScan.scanCorrelationId);

    const projectAEvents = await db
      .select({ type: eventsTable.type, correlationId: eventsTable.correlationId })
      .from(eventsTable)
      .where(eq(eventsTable.projectId, projectA));
    const projectBEvents = await db
      .select({ type: eventsTable.type })
      .from(eventsTable)
      .where(eq(eventsTable.projectId, projectB));

    expect(projectAEvents.map((event) => event.type)).toContain(
      "SecurityPluginClear",
    );
    expect(projectAEvents.find((event) => event.type === "SecurityPluginClear")?.correlationId)
      .toBe(projectAScan.scanCorrelationId);
    expect(projectBEvents).toHaveLength(0);

    await db
      .update(pluginsTable)
      .set({ enabled: false })
      .where(eq(pluginsTable.id, "plugin-security"));
    expect(await resolveEffectivePluginIds(projectA)).toEqual([]);

    await db
      .delete(eventsTable)
      .where(eq(eventsTable.projectId, projectA));
    await dispatchOnScanComplete(context(projectA));
    const eventsAfterGlobalDisable = await db
      .select({ id: eventsTable.id })
      .from(eventsTable)
      .where(eq(eventsTable.projectId, projectA));
    expect(eventsAfterGlobalDisable).toHaveLength(0);
  });
});