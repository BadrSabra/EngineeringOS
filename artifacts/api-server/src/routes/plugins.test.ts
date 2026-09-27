import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  auditLogsTable,
  db,
  eventsTable,
  projectPluginBindingsTable,
  projectsTable,
} from "@workspace/db";
import {
  authorizeToolInvocation,
  createServerCapabilityRegistry,
  getFullAuthorizedToolManifest,
} from "@workspace/ai-orchestrator";
import app from "../app.js";

const projectIds: string[] = [];

async function insertProject(
  ownerId = "test-user",
  status: "active" | "archived" = "active",
): Promise<string> {
  const id = `plugin-route-project-${randomUUID()}`;
  projectIds.push(id);
  await db.insert(projectsTable).values({
    id,
    ownerId,
    name: "Plugin route project",
    rootPath: `/tmp/${id}`,
    language: "typescript",
    status,
  });
  return id;
}

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
});

describe("Plugin registry", () => {
  it("lists global availability without leaking registry configuration", async () => {
    const res = await request(app).get("/api/plugins");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    const reactPlugin = res.body.find(
      (plugin: { id: string }) => plugin.id === "plugin-react",
    );
    expect(reactPlugin).toMatchObject({
      id: "plugin-react",
      available: true,
    });
    expect(reactPlugin).not.toHaveProperty("enabled");
    expect(reactPlugin).not.toHaveProperty("config");
  });

  it("changes global availability independently of any project", async () => {
    const disabled = await request(app)
      .post("/api/plugins/plugin-react/disable");
    expect(disabled.status).toBe(200);
    expect(disabled.body.available).toBe(false);

    const enabled = await request(app)
      .post("/api/plugins/plugin-react/enable");
    expect(enabled.status).toBe(200);
    expect(enabled.body.available).toBe(true);
  });

  it("returns 404 for a nonexistent plugin", async () => {
    const res = await request(app).post("/api/plugins/does-not-exist/enable");
    expect(res.status).toBe(404);
  });

  it("starts project bindings disabled and activates only the selected project", async () => {
    const projectA = await insertProject();
    const projectB = await insertProject();

    const before = await request(app).get(`/api/projects/${projectA}/plugins`);
    expect(before.status).toBe(200);
    expect(
      before.body.find((plugin: { id: string }) => plugin.id === "plugin-react"),
    ).toMatchObject({
      available: true,
      projectEnabled: false,
      effectiveForProjectScan: false,
    });

    const enabled = await request(app)
      .put(`/api/projects/${projectA}/plugins/plugin-react`)
      .send({ enabled: true });
    expect(enabled.status).toBe(200);
    expect(enabled.body).toMatchObject({
      available: true,
      projectEnabled: true,
      effectiveForProjectScan: true,
    });

    const otherProject = await request(app).get(
      `/api/projects/${projectB}/plugins`,
    );
    expect(otherProject.status).toBe(200);
    expect(
      otherProject.body.find(
        (plugin: { id: string }) => plugin.id === "plugin-react",
      ),
    ).toMatchObject({
      available: true,
      projectEnabled: false,
      effectiveForProjectScan: false,
    });
  });

  it("does not let project plugin activation change capability or tool authorization", async () => {
    const projectId = await insertProject();
    const beforeRegistry = createServerCapabilityRegistry().list();
    const beforeManifest = getFullAuthorizedToolManifest();
    const beforeAuthorization = authorizeToolInvocation({
      toolName: "read_file",
      allowedTools: new Set(["read_file"]),
    });

    const activated = await request(app)
      .put(`/api/projects/${projectId}/plugins/plugin-react`)
      .send({ enabled: true });
    expect(activated.status).toBe(200);

    expect(createServerCapabilityRegistry().list()).toEqual(beforeRegistry);
    expect(getFullAuthorizedToolManifest()).toEqual(beforeManifest);
    expect(
      authorizeToolInvocation({
        toolName: "read_file",
        allowedTools: new Set(["read_file"]),
      }),
    ).toEqual(beforeAuthorization);
  });

  it("rejects untyped configuration and never returns persisted legacy values", async () => {
    const projectId = await insertProject();
    const empty = await request(app)
      .put(`/api/projects/${projectId}/plugins/plugin-react`)
      .send({ enabled: false, configuration: {} });

    expect(empty.status).toBe(400);
    expect(empty.body.code).toBe("PLUGIN_CONFIGURATION_SCHEMA_UNAVAILABLE");

    const unsafe = await request(app)
      .put(`/api/projects/${projectId}/plugins/plugin-react`)
      .send({
        enabled: false,
        configuration: { apiToken: "never-store-this" },
      });

    expect(unsafe.status).toBe(400);
    expect(unsafe.body.code).toBe("PLUGIN_CONFIGURATION_SCHEMA_UNAVAILABLE");

    await db.insert(projectPluginBindingsTable).values({
      id: randomUUID(),
      projectId,
      pluginId: "plugin-react",
      enabled: false,
      configuration: { apiToken: "legacy-secret-must-not-leak" },
    });
    const listed = await request(app).get(
      `/api/projects/${projectId}/plugins`,
    );
    expect(listed.status).toBe(200);
    const reactPlugin = listed.body.find(
      (plugin: { id: string }) => plugin.id === "plugin-react",
    );
    expect(reactPlugin).not.toHaveProperty("configuration");
    expect(JSON.stringify(listed.body)).not.toContain(
      "legacy-secret-must-not-leak",
    );
  });

  it("does not allow activating a globally unavailable plugin", async () => {
    const projectId = await insertProject();
    const response = await request(app)
      .put(`/api/projects/${projectId}/plugins/plugin-performance`)
      .send({ enabled: true });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe("PLUGIN_UNAVAILABLE");
  });

  it("enforces project ownership and archived-project write protection", async () => {
    const privateProject = await insertProject("other-user");
    const read = await request(app).get(
      `/api/projects/${privateProject}/plugins`,
    );
    const write = await request(app)
      .put(`/api/projects/${privateProject}/plugins/plugin-react`)
      .send({ enabled: true });
    expect(read.status).toBe(403);
    expect(write.status).toBe(403);

    const archivedProject = await insertProject("test-user", "archived");
    const archivedWrite = await request(app)
      .put(`/api/projects/${archivedProject}/plugins/plugin-react`)
      .send({ enabled: true });
    expect(archivedWrite.status).toBe(403);
  });
});
