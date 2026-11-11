import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectWorkspaceSnapshot } from "@workspace/api-client-react";
import ProjectWorkspace from "./ProjectWorkspace";

const mocks = vi.hoisted(() => ({
  snapshot: {
    contractVersion: 1 as const,
    observedAt: "2026-11-11T12:00:00.000Z",
    project: {
      id: "project-1",
      name: "مشروع البث",
      description: null,
      language: "TypeScript",
      framework: "React",
      status: "active" as const,
      updatedAt: "2026-11-11T12:00:00.000Z",
    },
    work: {
      tasksSource: "available" as const,
      recentTasks: [],
      executionSource: "available" as const,
      latestExecution: null,
      candidateSource: "available" as const,
      candidate: null,
    },
    runtime: {
      source: "available" as const,
      status: "stopped" as const,
      runtimeRevision: null,
      startedAt: null,
      stoppedAt: null,
    },
    freshness: { partial: false, warnings: [] },
  } as unknown as ProjectWorkspaceSnapshot,
}));

class FakeEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;

  readyState = FakeEventSource.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  closed = false;
  readonly listeners = new Map<string, Array<(event: Event) => void>>();

  constructor(readonly url: string, readonly options?: EventSourceInit) {}

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

  emit(type: string, data: unknown): void {
    const event = new MessageEvent(type, { data: JSON.stringify(data) });
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

let eventSource: FakeEventSource | null = null;

vi.mock("@workspace/api-client-react", () => ({
  useGetProjectWorkspaceSnapshot: () => ({
    data: mocks.snapshot,
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  }),
  getGetProjectWorkspaceSnapshotQueryKey: (projectId: string) => [
    "/api/projects",
    projectId,
    "workspace",
  ],
}));

vi.mock("wouter", () => ({
  useRoute: () => [true, { projectId: "project-1" }],
  Link: "a",
}));

vi.mock("@/pages/AiChat", () => ({ default: () => null }));

beforeEach(() => {
  eventSource = null;
  vi.stubGlobal("EventSource", class extends FakeEventSource {
    constructor(url: string, options?: EventSourceInit) {
      super(url, options);
      eventSource = this;
    }
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ProjectWorkspace live snapshot refresh", () => {
  it("subscribes read-only, updates connection status, and invalidates only its snapshot", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidate = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue(undefined);

    render(
      <QueryClientProvider client={queryClient}>
        <ProjectWorkspace />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(eventSource).not.toBeNull());
    expect(eventSource?.url).toBe("/api/projects/project-1/workspace/events");
    expect(eventSource?.options).toEqual({ withCredentials: true });
    expect(screen.getByText("جارٍ الاتصال بالتحديثات")).toBeInTheDocument();

    act(() => {
      eventSource!.readyState = FakeEventSource.OPEN;
      eventSource!.onopen?.(new Event("open"));
    });
    expect(screen.getByText("متصل بتحديثات مساحة المشروع")).toBeInTheDocument();

    act(() => eventSource!.emit("workspace.changed", {
      eventVersion: 1,
      projectId: "project-1",
      eventId: "event-1",
      snapshotCursor: "cursor-1",
    }));

    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["/api/projects", "project-1", "workspace"],
    }));
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(screen.getByText("النسخة المرشحة")).toBeInTheDocument();
    expect(screen.getByText("حالة التشغيل")).toBeInTheDocument();
  });
});
