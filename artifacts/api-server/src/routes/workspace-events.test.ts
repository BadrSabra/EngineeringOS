import { afterEach, describe, expect, it } from "vitest";
import { get as httpGet } from "node:http";
import request from "supertest";
import { eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import app from "../app.js";
import { db, eventsTable, projectsTable } from "@workspace/db";
import { encodeWorkspaceEventCursor } from "../lib/project-workspace-events.js";

const projectIds: string[] = [];

async function insertProject(ownerId = "test-user"): Promise<string> {
  const id = randomUUID();
  const now = new Date();
  await db.insert(projectsTable).values({
    id,
    ownerId,
    name: `workspace-events-${id.slice(0, 8)}`,
    rootPath: `/tmp/workspace-events-${id}`,
    language: "typescript",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  projectIds.push(id);
  return id;
}

async function insertEvent({
  projectId,
  id = randomUUID(),
  timestamp,
  message = "private event message",
}: {
  projectId: string;
  id?: string;
  timestamp: Date;
  message?: string;
}): Promise<string> {
  await db.insert(eventsTable).values({
    id,
    projectId,
    type: "WorkspaceTestEvent",
    severity: "info",
    message,
    payload: { secret: "payload-must-not-leak" },
    timestamp,
  });
  return id;
}

async function readStreamFrames(
  projectId: string,
  headers: Record<string, string> = {},
): Promise<{ contentType: string | undefined; cacheControl: string | undefined; frames: string[] }> {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind a TCP port");

  const controller = new AbortController();
  const response = await fetch(
    `http://127.0.0.1:${address.port}/api/projects/${projectId}/workspace/events`,
    { headers, signal: controller.signal },
  );
  const contentType = response.headers.get("content-type") ?? undefined;
  const cacheControl = response.headers.get("cache-control") ?? undefined;
  const reader = response.body?.getReader();
  if (!reader) throw new Error("SSE response had no readable body");

  const frames: string[] = [];
  let buffer = "";
  try {
    while (frames.length === 0 || !frames.some((frame) => frame.includes("event: workspace.changed"))) {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const read = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error("Timed out waiting for a workspace SSE event")),
            4_000,
          );
        }),
      ]).finally(() => {
        if (timeout) clearTimeout(timeout);
      });
      if (read.done) break;
      buffer += new TextDecoder().decode(read.value, { stream: true });
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() ?? "";
      frames.push(...blocks.filter((block) => block.includes("event: ")));
      if (frames.some((frame) => frame.includes("event: workspace.resync"))) break;
    }
  } finally {
    controller.abort();
    await reader.cancel().catch(() => undefined);
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  return { contentType, cacheControl, frames };
}

afterEach(async () => {
  for (const projectId of projectIds.splice(0)) {
    await db.delete(eventsTable).where(eq(eventsTable.projectId, projectId)).catch(() => undefined);
    await db.delete(projectsTable).where(eq(projectsTable.id, projectId)).catch(() => undefined);
  }
});

describe("GET /projects/:projectId/workspace/events", () => {
  it("replays events in stable order and exposes only safe invalidation metadata", async () => {
    const projectId = await insertProject();
    const now = Date.now();
    const baselineId = await insertEvent({
      projectId,
      timestamp: new Date(now - 5_000),
      message: "baseline",
    });
    const olderId = randomUUID();
    const newerId = randomUUID();

    // Deliberately insert the later event first; replay order follows the server
    // timestamp/id tuple, not database insertion timing or the client's clock.
    await insertEvent({
      projectId,
      id: newerId,
      timestamp: new Date(now - 1_000),
      message: "newer secret message",
    });
    await insertEvent({
      projectId,
      id: olderId,
      timestamp: new Date(now - 2_000),
      message: "older secret message",
    });

    const first = await readStreamFrames(projectId, {
      "Last-Event-ID": encodeWorkspaceEventCursor(baselineId),
    });

    expect(first.contentType).toContain("text/event-stream");
    expect(first.cacheControl).toContain("no-store");
    const changedFrames = first.frames.filter((frame) => frame.includes("event: workspace.changed"));
    const payloads = changedFrames.map((frame) => {
      const dataLine = frame.split("\n").find((line) => line.startsWith("data: "));
      return JSON.parse(dataLine!.slice("data: ".length)) as Record<string, unknown>;
    });
    expect(payloads.map((payload) => payload.eventId)).toEqual([olderId, newerId]);
    expect(JSON.stringify(payloads)).not.toContain("secret");
    expect(payloads[0]).toEqual({
      eventVersion: 1,
      projectId,
      entityKind: "project",
      entityId: projectId,
      eventId: olderId,
      occurredAt: new Date(now - 2_000).toISOString(),
      snapshotCursor: encodeWorkspaceEventCursor(olderId),
    });

    const resumed = await readStreamFrames(projectId, {
      "Last-Event-ID": encodeWorkspaceEventCursor(olderId),
    });
    const resumedIds = resumed.frames
      .filter((frame) => frame.includes("event: workspace.changed"))
      .map((frame) => {
        const dataLine = frame.split("\n").find((line) => line.startsWith("data: "));
        return (JSON.parse(dataLine!.slice("data: ".length)) as { eventId: string }).eventId;
      });
    expect(resumedIds).toEqual([newerId]);
  });

  it("does not replay the cursor row when PostgreSQL stores sub-millisecond precision", async () => {
    const projectId = await insertProject();
    const baselineId = "a-cursor";
    const followingId = "z-following";
    const base = new Date(Date.now() - 30_000);
    const seconds = base.toISOString().slice(0, 19).replace("T", " ");
    const milliseconds = String(base.getUTCMilliseconds()).padStart(3, "0");
    const exactTimestamp = `${seconds}.${milliseconds}456`;

    await insertEvent({
      projectId,
      id: baselineId,
      timestamp: base,
      message: "cursor row",
    });
    await insertEvent({
      projectId,
      id: followingId,
      timestamp: base,
      message: "strictly after cursor",
    });
    await db.execute(sql`
      UPDATE "events"
      SET "timestamp" = ${exactTimestamp}::timestamp
      WHERE "project_id" = ${projectId}
        AND "id" IN (${baselineId}, ${followingId})
    `);

    const replay = await readStreamFrames(projectId, {
      "Last-Event-ID": encodeWorkspaceEventCursor(baselineId),
    });
    const replayedIds = replay.frames
      .filter((frame) => frame.includes("event: workspace.changed"))
      .map((frame) => {
        const dataLine = frame.split("\n").find((line) => line.startsWith("data: "));
        return (JSON.parse(dataLine!.slice("data: ".length)) as { eventId: string }).eventId;
      });

    expect(replayedIds).toEqual([followingId]);
  });

  it("keeps replaying events after a slow client applies TCP backpressure", async () => {
    const projectId = await insertProject();
    const baselineTime = Date.now() - 3_000;
    const baselineId = await insertEvent({
      projectId,
      timestamp: new Date(baselineTime),
      message: "replay baseline",
    });
    const expectedIds: string[] = [];
    for (let index = 0; index < 100; index += 1) {
      const eventId = randomUUID();
      expectedIds.push(eventId);
      await insertEvent({
        projectId,
        id: eventId,
        timestamp: new Date(baselineTime + index + 1),
      });
    }

    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Test server did not bind a TCP port");
    }

    try {
      const body = await new Promise<string>((resolve, reject) => {
        let responseBody = "";
        let settled = false;
        let client: ReturnType<typeof httpGet> | undefined;
        const timeout = setTimeout(() => {
          if (settled) return;
          settled = true;
          client?.destroy();
          reject(new Error("Timed out waiting for replay after TCP backpressure"));
        }, 6_000);
        client = httpGet(
          `http://127.0.0.1:${address.port}/api/projects/${projectId}/workspace/events`,
          { headers: { "Last-Event-ID": encodeWorkspaceEventCursor(baselineId) } },
          (response) => {
            response.pause();
            response.setEncoding("utf8");
            response.on("data", (chunk: string) => {
              responseBody += chunk;
              const delivered = responseBody
                .split("\n\n")
                .filter((frame) => frame.includes("event: workspace.changed"))
                .length;
              if (!settled && delivered >= expectedIds.length) {
                settled = true;
                clearTimeout(timeout);
                resolve(responseBody);
                response.destroy();
              }
            });
            // Keep the socket unread long enough for the server response buffer
            // to fill, then let it drain and verify the complete replay arrives.
            response.pause();
            const resumeTimer = setTimeout(() => response.resume(), 250);
            response.on("end", () => {
              if (settled) return;
              settled = true;
              clearTimeout(timeout);
              clearTimeout(resumeTimer);
              reject(new Error("Workspace stream ended before replay completed"));
            });
            response.on("error", (error) => {
              if (settled) return;
              settled = true;
              clearTimeout(timeout);
              clearTimeout(resumeTimer);
              reject(error);
            });
          },
        );
        client.on("error", (error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          reject(error);
        });
      });

      const frames = body
        .split("\n\n")
        .filter((frame) => frame.includes("event: workspace.changed"));
      const replayedIds = frames.map((frame) => {
        const dataLine = frame.split("\n").find((line) => line.startsWith("data: "));
        return (JSON.parse(dataLine!.slice("data: ".length)) as { eventId: string }).eventId;
      });
      expect(replayedIds).toEqual(expectedIds);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("resynchronizes for a foreign project cursor and denies foreign project access", async () => {
    const projectId = await insertProject();
    const foreignProjectId = await insertProject("someone-else");
    const foreignEventId = await insertEvent({
      projectId: foreignProjectId,
      timestamp: new Date(),
    });

    const foreignCursor = await readStreamFrames(projectId, {
      "Last-Event-ID": encodeWorkspaceEventCursor(foreignEventId),
    });
    const resyncFrame = foreignCursor.frames.find((frame) => frame.includes("event: workspace.resync"));
    expect(resyncFrame).toContain('"reason":"cursor_invalid"');
    expect(resyncFrame).not.toContain(foreignEventId);

    const forbidden = await request(app)
      .get(`/api/projects/${foreignProjectId}/workspace/events`);
    expect(forbidden.status).toBe(403);
    expect(forbidden.headers["content-type"]).not.toContain("text/event-stream");
  });

  it("resynchronizes rather than replaying outside the bounded recovery window", async () => {
    const projectId = await insertProject();
    const expiredEventId = await insertEvent({
      projectId,
      timestamp: new Date(Date.now() - 10 * 60_000),
    });

    const result = await readStreamFrames(projectId, {
      "Last-Event-ID": encodeWorkspaceEventCursor(expiredEventId),
    });

    expect(result.frames.join("\n\n")).toContain('"reason":"cursor_expired"');
  });
});
