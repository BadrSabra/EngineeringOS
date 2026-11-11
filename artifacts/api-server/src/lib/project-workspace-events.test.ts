import { describe, expect, it } from "vitest";
import {
  WORKSPACE_EVENT_CURSOR_MAX_LENGTH,
  WORKSPACE_EVENT_REPLAY_WINDOW_MS,
  decodeWorkspaceEventCursor,
  encodeWorkspaceEventCursor,
  formatWorkspaceSseFrame,
  isWorkspaceEventCursorExpired,
} from "./project-workspace-events.js";

describe("project workspace event contracts", () => {
  it("round-trips opaque cursors and rejects malformed or oversized values", () => {
    const eventId = "event/with symbols + unicode-مرحبا";
    const cursor = encodeWorkspaceEventCursor(eventId);

    expect(cursor).not.toContain("/");
    expect(decodeWorkspaceEventCursor(cursor)).toBe(eventId);
    expect(decodeWorkspaceEventCursor("%%%")).toBeNull();
    expect(decodeWorkspaceEventCursor("")).toBeNull();
    expect(decodeWorkspaceEventCursor("a".repeat(WORKSPACE_EVENT_CURSOR_MAX_LENGTH + 1))).toBeNull();
  });

  it("treats the replay boundary and unreasonable future cursors as stale", () => {
    const now = Date.parse("2026-11-11T12:00:00.000Z");

    expect(isWorkspaceEventCursorExpired(
      new Date(now - WORKSPACE_EVENT_REPLAY_WINDOW_MS),
      now,
    )).toBe(false);
    expect(isWorkspaceEventCursorExpired(
      new Date(now - WORKSPACE_EVENT_REPLAY_WINDOW_MS - 1),
      now,
    )).toBe(true);
    expect(isWorkspaceEventCursorExpired(new Date(now + 60_001), now)).toBe(true);
  });

  it("frames contain only serialized event data with a single-line cursor", () => {
    const frame = formatWorkspaceSseFrame(
      "workspace.changed",
      {
        eventVersion: 1,
        projectId: "project-1",
        entityKind: "project",
        entityId: "project-1",
        eventId: "event-1",
        occurredAt: "2026-11-11T12:00:00.000Z",
        snapshotCursor: encodeWorkspaceEventCursor("event-1"),
      },
      encodeWorkspaceEventCursor("event-1"),
    );

    expect(frame).toContain("event: workspace.changed\n");
    expect(frame).toContain('data: {"eventVersion":1,"projectId":"project-1"');
    expect(frame.endsWith("\n\n")).toBe(true);
    expect(frame.split("\n").filter((line) => line.startsWith("id: "))).toHaveLength(1);
  });
});
