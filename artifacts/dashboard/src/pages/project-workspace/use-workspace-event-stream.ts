import { useEffect, useRef, useState } from "react";

export type WorkspaceEventStreamStatus =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "offline";

type WorkspaceEventStreamOptions = {
  projectId: string;
  enabled: boolean;
  onSnapshotInvalidated: () => void;
};

type WorkspaceChangedPayload = {
  eventVersion: 1;
  projectId: string;
  eventId: string;
  snapshotCursor: string;
};

function parseChangedPayload(data: string, projectId: string): WorkspaceChangedPayload | null {
  try {
    const value: unknown = JSON.parse(data);
    if (
      !value
      || typeof value !== "object"
      || !("eventVersion" in value)
      || value.eventVersion !== 1
      || !("projectId" in value)
      || value.projectId !== projectId
      || !("eventId" in value)
      || typeof value.eventId !== "string"
      || !("snapshotCursor" in value)
      || typeof value.snapshotCursor !== "string"
    ) {
      return null;
    }
    return value as WorkspaceChangedPayload;
  } catch {
    return null;
  }
}

function isResyncForProject(data: string, projectId: string): boolean {
  try {
    const value: unknown = JSON.parse(data);
    return Boolean(
      value
      && typeof value === "object"
      && "eventVersion" in value
      && value.eventVersion === 1
      && "projectId" in value
      && value.projectId === projectId
      && "reason" in value
      && typeof value.reason === "string",
    );
  } catch {
    return false;
  }
}

export function useWorkspaceEventStream({
  projectId,
  enabled,
  onSnapshotInvalidated,
}: WorkspaceEventStreamOptions): WorkspaceEventStreamStatus {
  const invalidateRef = useRef(onSnapshotInvalidated);
  invalidateRef.current = onSnapshotInvalidated;
  const [status, setStatus] = useState<WorkspaceEventStreamStatus>(
    enabled ? "connecting" : "offline",
  );

  useEffect(() => {
    if (!enabled || !projectId) {
      setStatus("offline");
      return;
    }

    setStatus("connecting");
    let connectedBefore = false;
    let disposed = false;
    const seenEventIds = new Set<string>();
    const url = `/api/projects/${encodeURIComponent(projectId)}/workspace/events`;
    let source: EventSource;
    try {
      source = new EventSource(url, { withCredentials: true });
    } catch {
      setStatus("offline");
      return;
    }

    const rememberEvent = (eventId: string): boolean => {
      if (seenEventIds.has(eventId)) return false;
      seenEventIds.add(eventId);
      if (seenEventIds.size > 256) {
        const oldest = seenEventIds.values().next().value as string | undefined;
        if (oldest) seenEventIds.delete(oldest);
      }
      return true;
    };

    const onChanged = (rawEvent: Event) => {
      const message = rawEvent as MessageEvent<string>;
      const payload = parseChangedPayload(message.data, projectId);
      if (payload && rememberEvent(payload.eventId)) {
        invalidateRef.current();
      }
    };

    const onResync = (rawEvent: Event) => {
      const message = rawEvent as MessageEvent<string>;
      if (isResyncForProject(message.data, projectId)) {
        invalidateRef.current();
      }
    };

    source.addEventListener("workspace.changed", onChanged);
    source.addEventListener("workspace.resync", onResync);
    source.onopen = () => {
      if (disposed) return;
      if (connectedBefore) invalidateRef.current();
      connectedBefore = true;
      setStatus("connected");
    };
    source.onerror = () => {
      if (disposed) return;
      setStatus(source.readyState === EventSource.CLOSED ? "offline" : "reconnecting");
    };

    return () => {
      disposed = true;
      source.close();
    };
  }, [enabled, projectId]);

  return status;
}
