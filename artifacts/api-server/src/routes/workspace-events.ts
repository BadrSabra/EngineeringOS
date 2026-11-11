import { Router, type IRouter } from "express";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import {
  db,
  eventsTable,
  projectsTable,
} from "@workspace/db";
import { StreamProjectWorkspaceEventsParams } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth.js";
import { requireProjectAccess } from "../middlewares/requireProjectAccess.js";
import { isProjectInLifecycleWorkerScope } from "../lib/worker-scope.js";
import {
  WORKSPACE_EVENT_REPLAY_LIMIT,
  decodeWorkspaceEventCursor,
  encodeWorkspaceEventCursor,
  formatWorkspaceSseFrame,
  isWorkspaceEventCursorExpired,
  type WorkspaceEventCursorRow,
  type WorkspaceResyncReason,
} from "../lib/project-workspace-events.js";

const router: IRouter = Router();
const POLL_INTERVAL_MS = 2_000;
const HEARTBEAT_INTERVAL_MS = 15_000;
const ACCESS_RECHECK_INTERVAL_MS = 30_000;
const MAX_STREAM_DURATION_MS = 4 * 60_000;

router.use(requireAuth);

router.get(
  "/projects/:projectId/workspace/events",
  requireProjectAccess,
  async (req, res): Promise<void> => {
    const params = StreamProjectWorkspaceEventsParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid projectId" });
      return;
    }

    const projectId = params.data.projectId;
    const userId = req.userId;
    const lastEventId = req.get("Last-Event-ID");
    let cursor: WorkspaceEventCursorRow | null = null;
    let initialResyncReason: WorkspaceResyncReason | null = null;
    let initialSourceUnavailable = false;

    if (!lastEventId) {
      initialResyncReason = "initial";
      try {
        cursor = await getLatestProjectEvent(projectId);
      } catch (error) {
        initialSourceUnavailable = true;
        initialResyncReason = "source_unavailable";
        req.log.warn(
          { projectId, errorName: error instanceof Error ? error.name : "UnknownError" },
          "Workspace event stream could not establish its initial cursor",
        );
      }
    } else {
      const eventId = decodeWorkspaceEventCursor(lastEventId);
      if (!eventId) {
        initialResyncReason = "cursor_invalid";
        try {
          cursor = await getLatestProjectEvent(projectId);
        } catch (error) {
          initialSourceUnavailable = true;
          initialResyncReason = "source_unavailable";
          req.log.warn(
            { projectId, errorName: error instanceof Error ? error.name : "UnknownError" },
            "Workspace event stream could not recover an invalid cursor",
          );
        }
      } else {
        try {
          cursor = await getProjectEvent(projectId, eventId);
          if (!cursor) {
            initialResyncReason = "cursor_invalid";
            cursor = await getLatestProjectEvent(projectId);
          } else if (isWorkspaceEventCursorExpired(cursor.timestamp)) {
            initialResyncReason = "cursor_expired";
            cursor = await getLatestProjectEvent(projectId);
          }
        } catch (error) {
          initialSourceUnavailable = true;
          initialResyncReason = "source_unavailable";
          cursor = null;
          req.log.warn(
            { projectId, errorName: error instanceof Error ? error.name : "UnknownError" },
            "Workspace event stream could not validate its cursor",
          );
        }
      }
    }

    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "private, no-store, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    res.write("retry: 3000\n\n");

    let stopped = false;
    let sourceFailureNotified = initialSourceUnavailable;
    let lastAccessCheckAt = Date.now();
    let pollTimer: NodeJS.Timeout | undefined;
    let renewalTimer: NodeJS.Timeout | undefined;

    const clearTimers = () => {
      if (pollTimer) clearTimeout(pollTimer);
      if (renewalTimer) clearTimeout(renewalTimer);
      clearInterval(heartbeatTimer);
    };

    const stopStream = () => {
      if (stopped) return;
      stopped = true;
      clearTimers();
      if (!res.writableEnded) res.end();
    };

    const writeFrame = (frame: string): boolean => {
      if (stopped || res.writableEnded || res.destroyed) return false;
      const accepted = res.write(frame);
      if (!accepted) stopStream();
      return accepted;
    };

    const sendResync = (
      reason: WorkspaceResyncReason,
      nextCursor: WorkspaceEventCursorRow | null = cursor,
    ): boolean => {
      cursor = nextCursor;
      const token = cursor ? encodeWorkspaceEventCursor(cursor.id) : null;
      return writeFrame(formatWorkspaceSseFrame(
        "workspace.resync",
        {
          eventVersion: 1,
          projectId,
          reason,
          snapshotCursor: token,
        },
        token,
      ));
    };

    const heartbeatTimer = setInterval(() => {
      if (!stopped && !res.writableEnded && !res.destroyed) {
        if (!res.write(": keep-alive\n\n")) stopStream();
      }
    }, HEARTBEAT_INTERVAL_MS);
    renewalTimer = setTimeout(stopStream, MAX_STREAM_DURATION_MS);

    res.on("close", () => {
      if (!res.writableEnded) stopStream();
      else clearTimers();
    });
    req.on("aborted", stopStream);

    if (initialResyncReason) {
      sendResync(initialResyncReason, cursor);
    }

    const poll = async (): Promise<void> => {
      if (stopped || res.writableEnded || res.destroyed) return;

      try {
        const now = Date.now();
        if (now - lastAccessCheckAt >= ACCESS_RECHECK_INTERVAL_MS) {
          const accessRows = await db
            .select({ ownerId: projectsTable.ownerId })
            .from(projectsTable)
            .where(eq(projectsTable.id, projectId))
            .limit(1);
          lastAccessCheckAt = now;
          if (
            !accessRows[0]
            || accessRows[0].ownerId !== userId
            || !isProjectInLifecycleWorkerScope(projectId)
          ) {
            stopStream();
            return;
          }
        }

        // PostgreSQL preserves microseconds; JS Date rounds to milliseconds and
        // could make the cursor row compare as newer than itself.
        const afterCursor = cursor
          ? sql`(${eventsTable.timestamp}, ${eventsTable.id}) > (${cursor.orderTimestamp}::timestamp, ${cursor.id})`
          : undefined;
        const rows = await db
          .select({
            id: eventsTable.id,
            timestamp: eventsTable.timestamp,
            orderTimestamp: sql<string>`to_char(${eventsTable.timestamp}, 'YYYY-MM-DD HH24:MI:SS.US')`,
          })
          .from(eventsTable)
          .where(afterCursor
            ? and(eq(eventsTable.projectId, projectId), afterCursor)
            : eq(eventsTable.projectId, projectId))
          .orderBy(asc(eventsTable.timestamp), asc(eventsTable.id))
          .limit(WORKSPACE_EVENT_REPLAY_LIMIT + 1);
        sourceFailureNotified = false;

        if (rows.length > WORKSPACE_EVENT_REPLAY_LIMIT) {
          const latest = await getLatestProjectEvent(projectId);
          sendResync("replay_limit", latest);
        } else {
          for (const row of rows) {
            const snapshotCursor = encodeWorkspaceEventCursor(row.id);
            const accepted = writeFrame(formatWorkspaceSseFrame(
              "workspace.changed",
              {
                eventVersion: 1,
                projectId,
                entityKind: "project",
                entityId: projectId,
                eventId: row.id,
                occurredAt: row.timestamp.toISOString(),
                snapshotCursor,
              },
              snapshotCursor,
            ));
            if (!accepted) return;
            cursor = row;
          }
        }
      } catch (error) {
        req.log.warn(
          { projectId, errorName: error instanceof Error ? error.name : "UnknownError" },
          "Workspace event stream poll failed",
        );
        if (!sourceFailureNotified) {
          sendResync("source_unavailable");
          sourceFailureNotified = true;
        }
      }

      if (!stopped && !res.writableEnded && !res.destroyed) {
        pollTimer = setTimeout(() => void poll(), POLL_INTERVAL_MS);
      }
    };

    if (!stopped) void poll();
  },
);

async function getLatestProjectEvent(projectId: string): Promise<WorkspaceEventCursorRow | null> {
  const rows = await db
    .select({
      id: eventsTable.id,
      timestamp: eventsTable.timestamp,
      orderTimestamp: sql<string>`to_char(${eventsTable.timestamp}, 'YYYY-MM-DD HH24:MI:SS.US')`,
    })
    .from(eventsTable)
    .where(eq(eventsTable.projectId, projectId))
    .orderBy(desc(eventsTable.timestamp), desc(eventsTable.id))
    .limit(1);
  return rows[0] ?? null;
}

async function getProjectEvent(
  projectId: string,
  eventId: string,
): Promise<WorkspaceEventCursorRow | null> {
  const rows = await db
    .select({
      id: eventsTable.id,
      timestamp: eventsTable.timestamp,
      orderTimestamp: sql<string>`to_char(${eventsTable.timestamp}, 'YYYY-MM-DD HH24:MI:SS.US')`,
    })
    .from(eventsTable)
    .where(and(eq(eventsTable.projectId, projectId), eq(eventsTable.id, eventId)))
    .limit(1);
  return rows[0] ?? null;
}

export default router;
