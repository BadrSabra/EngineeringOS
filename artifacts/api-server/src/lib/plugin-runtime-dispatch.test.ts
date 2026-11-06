import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { eq } from "drizzle-orm";
import {
  auditLogsTable,
  db,
  eventsTable,
  pluginsTable,
  pluginRunsTable,
  projectPluginBindingsTable,
  projectsTable,
} from "@workspace/db";
import app from "../app.js";
import {
  dispatchOnScanComplete,
  resolveEffectivePluginIds,
  type ScanCompleteContext,
} from "./plugin-runtime.js";

const projectIds: string[] = [];
let originalSecurityAvailability: boolean | undefined;

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