import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceEventStream } from "./use-workspace-event-stream";

class FakeEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  static instances: FakeEventSource[] = [];

  readyState = FakeEventSource.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  closed = false;
  readonly listeners = new Map<string, Array<(event: Event) => void>>();

  constructor(
    readonly url: string,
    readonly options?: EventSourceInit,
  ) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
    if (!listener) return;
    const callback = typeof listener === "function"
      ? listener
      : (event: Event) => listener.handleEvent(event);
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), callback]);
  }

  close(): void {
    this.closed = true;
    this.readyState = FakeEventSource.CLOSED;
  }

  open(): void {
    this.readyState = FakeEventSource.OPEN;
    this.onopen?.(new Event("open"));
  }

  disconnect(): void {
    this.readyState = FakeEventSource.CONNECTING;
    this.onerror?.(new Event("error"));
  }

  emit(type: string, data: unknown): void {
    const event = new MessageEvent(type, { data: JSON.stringify(data) });
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

afterEach(() => {
  FakeEventSource.instances = [];
  vi.unstubAllGlobals();
});

describe("useWorkspaceEventStream", () => {
  it("rehydrates on resync and reconnect, deduplicates event delivery, and closes on unmount", () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    const invalidate = vi.fn();
    const { result, unmount } = renderHook(() => useWorkspaceEventStream({
      projectId: "project-1",
      enabled: true,
      onSnapshotInvalidated: invalidate,
    }));
    const source = FakeEventSource.instances[0]!;

    expect(source.url).toBe("/api/projects/project-1/workspace/events");
    expect(source.options).toEqual({ withCredentials: true });
    expect(result.current).toBe("connecting");

    act(() => source.open());
    expect(result.current).toBe("connected");

    act(() => source.emit("workspace.changed", {
      eventVersion: 1,
      projectId: "project-1",
      eventId: "event-1",
      snapshotCursor: "cursor-1",
    }));
    act(() => source.emit("workspace.changed", {
      eventVersion: 1,
      projectId: "project-1",
      eventId: "event-1",
      snapshotCursor: "cursor-1",
    }));
    expect(invalidate).toHaveBeenCalledTimes(1);

    act(() => source.emit("workspace.resync", {
      eventVersion: 1,
      projectId: "project-1",
      reason: "cursor_expired",
      snapshotCursor: null,
    }));
    expect(invalidate).toHaveBeenCalledTimes(2);

    act(() => source.disconnect());
    expect(result.current).toBe("reconnecting");
    act(() => source.open());
    expect(result.current).toBe("connected");
    expect(invalidate).toHaveBeenCalledTimes(3);

    unmount();
    expect(source.closed).toBe(true);
  });

  it("ignores malformed events and events belonging to another project", () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    const invalidate = vi.fn();
    renderHook(() => useWorkspaceEventStream({
      projectId: "project-1",
      enabled: true,
      onSnapshotInvalidated: invalidate,
    }));
    const source = FakeEventSource.instances[0]!;

    act(() => source.emit("workspace.changed", {
      eventVersion: 1,
      projectId: "project-2",
      eventId: "foreign-event",
      snapshotCursor: "foreign-cursor",
    }));
    act(() => source.emit("workspace.resync", "{malformed"));

    expect(invalidate).not.toHaveBeenCalled();
  });
});
