export const WORKSPACE_EVENT_CURSOR_MAX_LENGTH = 256;
export const WORKSPACE_EVENT_REPLAY_WINDOW_MS = 5 * 60 * 1_000;
export const WORKSPACE_EVENT_REPLAY_LIMIT = 100;

export type WorkspaceEventCursorRow = {
  id: string;
  timestamp: Date;
  orderTimestamp: string;
};

export type WorkspaceChangedEvent = {
  eventVersion: 1;
  projectId: string;
  entityKind: "project";
  entityId: string;
  eventId: string;
  occurredAt: string;
  snapshotCursor: string;
};

export type WorkspaceResyncReason =
  | "initial"
  | "cursor_invalid"
  | "cursor_expired"
  | "replay_limit"
  | "source_unavailable";

export type WorkspaceResyncEvent = {
  eventVersion: 1;
  projectId: string;
  reason: WorkspaceResyncReason;
  snapshotCursor: string | null;
};

export function encodeWorkspaceEventCursor(eventId: string): string {
  return Buffer.from(eventId, "utf8").toString("base64url");
}

export function decodeWorkspaceEventCursor(cursor: string): string | null {
  if (
    cursor.length === 0
    || cursor.length > WORKSPACE_EVENT_CURSOR_MAX_LENGTH
    || !/^[A-Za-z0-9_-]+$/.test(cursor)
  ) {
    return null;
  }

  const eventId = Buffer.from(cursor, "base64url").toString("utf8");
  if (!eventId || encodeWorkspaceEventCursor(eventId) !== cursor) return null;
  return eventId;
}

export function isWorkspaceEventCursorExpired(
  timestamp: Date,
  now = Date.now(),
): boolean {
  const occurredAt = timestamp.getTime();
  return !Number.isFinite(occurredAt)
    || occurredAt < now - WORKSPACE_EVENT_REPLAY_WINDOW_MS
    || occurredAt > now + 60_000;
}

export function formatWorkspaceSseFrame(
  eventName: "workspace.changed" | "workspace.resync",
  data: WorkspaceChangedEvent | WorkspaceResyncEvent,
  cursor?: string | null,
): string {
  const idLine = cursor === undefined ? "" : `id: ${cursor ?? ""}\n`;
  return `${idLine}event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
}
