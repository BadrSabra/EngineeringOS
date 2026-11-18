import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useGetAiExecution, type ProjectWorkspaceSnapshot } from "@workspace/api-client-react";
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
  taskDetails: {} as Record<string, unknown>,
  taskLogs: {} as Record<string, unknown[]>,
  executions: {} as Record<string, unknown>,
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
const initialSnapshot = mocks.snapshot;

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
  useGetTask: (taskId: string) => ({
    data: mocks.taskDetails[taskId],
    isLoading: false,
    isError: false,
    isFetching: false,
  }),
  getGetTaskQueryKey: (taskId: string) => [`/api/tasks/${taskId}`],
  useGetTaskLogs: (taskId: string) => ({
    data: mocks.taskLogs[taskId] ?? [],
    isLoading: false,
    isError: false,
    isFetching: false,
  }),
  getGetTaskLogsQueryKey: (taskId: string) => [`/api/tasks/${taskId}/logs`],
  useGetAiExecution: vi.fn((executionId: string) => ({
    data: mocks.executions[executionId],
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  })),
  getGetAiExecutionQueryKey: (executionId: string) => [
    `/api/ai/executions/${executionId}`,
  ],
}));

vi.mock("wouter", () => ({
  useRoute: () => [true, { projectId: "project-1" }],
  Link: "a",
}));

vi.mock("@/pages/AiChat", () => ({ default: () => null }));

beforeEach(() => {
  mocks.snapshot = initialSnapshot;
  mocks.taskDetails = {};
  mocks.taskLogs = {};
  mocks.executions = {};
  vi.mocked(useGetAiExecution).mockClear();
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

  it("separates the agent, preview canvas, and work-trust areas without treating Runtime as Preview", () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <ProjectWorkspace />
      </QueryClientProvider>,
    );

    expect(screen.getByRole("navigation", { name: "التنقل بين أقسام مساحة المشروع" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "محادثة المشروع" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "معاينة المشروع" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "العمل والثقة" })).toBeInTheDocument();
    expect(screen.getByText("أحدث 8 مهام من المصدر؛ هذه ليست قائمة شاملة.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "عرض جميع مهام المشروع" }))
      .toHaveAttribute("href", "/tasks?projectId=project-1");

    const previewGate = screen.getByTestId("workspace-preview-gate");
    expect(previewGate).toHaveTextContent("لا توجد معاينة تفاعلية مؤهلة بعد");
    expect(previewGate).toHaveTextContent("ليست إثباتًا على جاهزية Preview");
    expect(screen.getByText("حالة التشغيل")).toBeInTheDocument();
  });

  it("does not render retained task, execution, or candidate data when their sources are unavailable", async () => {
    mocks.snapshot = {
      ...initialSnapshot,
      work: {
        tasksSource: "unavailable",
        recentTasks: [{
          id: "task-stale",
          title: "مهمة قديمة لا يجب عرضها",
          status: "running",
          verificationDecision: null,
          updatedAt: "2026-11-11T11:00:00.000Z",
        }],
        executionSource: "unavailable",
        latestExecution: {
          id: "execution-stale",
          status: "completed",
          attempt: 1,
          proposalId: "proposal-stale",
          baseRevision: "base-stale",
          updatedAt: "2026-11-11T11:00:00.000Z",
        },
        candidateSource: "unavailable",
        candidate: {
          proposalId: "proposal-stale",
          status: "pending",
          lifecycle: "proposed",
          revision: 3,
          approvalRequired: true,
          operationId: "operation-stale",
          baseRevision: "base-stale",
          candidateTreeHash: "tree-stale",
          changeSetHash: "changes-stale",
          createdAt: "2026-11-11T10:00:00.000Z",
        },
      },
    } as unknown as ProjectWorkspaceSnapshot;

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidate = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue(undefined);

    render(
      <QueryClientProvider client={queryClient}>
        <ProjectWorkspace />
      </QueryClientProvider>,
    );

    expect(screen.getByText("مصدر المهام غير متاح الآن؛ لا يمكن تأكيد قائمة العمل.")).toBeInTheDocument();
    expect(screen.getByText("مصدر التنفيذ غير متاح؛ لا يمكن تأكيد حالة تنفيذ حديثة.")).toBeInTheDocument();
    expect(screen.getByText("مصدر المرشح غير متاح؛ لا يمكن تأكيد حالة التغييرات.")).toBeInTheDocument();
    expect(screen.queryByText("مهمة قديمة لا يجب عرضها")).not.toBeInTheDocument();
    expect(screen.queryByText("آخر تنفيذ")).not.toBeInTheDocument();
    expect(screen.queryByText("proposal-stale")).not.toBeInTheDocument();
    expect(screen.queryByText("operation-stale")).not.toBeInTheDocument();
    expect(useGetAiExecution).not.toHaveBeenCalled();

    await waitFor(() => expect(eventSource).not.toBeNull());
    act(() => eventSource!.emit("workspace.changed", {
      eventVersion: 1,
      projectId: "project-1",
      eventId: "event-stale-source",
      snapshotCursor: "cursor-stale-source",
    }));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["/api/projects", "project-1", "workspace"],
    }));
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).not.toHaveBeenCalledWith({
      queryKey: ["/api/ai/executions/execution-stale"],
    });
  });


  it("fails closed when the returned Workspace snapshot belongs to another project", () => {
    mocks.snapshot = {
      ...initialSnapshot,
      project: {
        ...initialSnapshot.project,
        id: "another-project",
        name: "مشروع لا يخص هذا المسار",
      },
    } as unknown as ProjectWorkspaceSnapshot;

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <ProjectWorkspace />
      </QueryClientProvider>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("تعارض هوية المشروع");
    expect(screen.getByText(
      "اللقطة المستلمة لا تخص المشروع المطلوب؛ أخفينا محتواها حتى تصل قراءة بهوية مطابقة.",
    )).toBeInTheDocument();
    expect(screen.queryByText("مشروع لا يخص هذا المسار")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "محادثة المشروع" })).not.toBeInTheDocument();
    expect(eventSource).toBeNull();
  });

  it("does not show a retained Runtime status when the Runtime source is unavailable", () => {
    mocks.snapshot = {
      ...initialSnapshot,
      runtime: {
        ...initialSnapshot.runtime,
        source: "unavailable",
        status: "running",
        runtimeRevision: "runtime-revision-stale",
      },
    } as unknown as ProjectWorkspaceSnapshot;

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <ProjectWorkspace />
      </QueryClientProvider>,
    );

    expect(screen.getByTestId("workspace-runtime-status")).toHaveTextContent("غير متاح");
    expect(screen.getByTestId("workspace-runtime-status")).not.toHaveTextContent("قيد التنفيذ");
    expect(screen.getByText("مصدر التشغيل غير متاح الآن؛ لا يمكن تأكيد الحالة الحالية.")).toBeInTheDocument();
    expect(screen.queryByText("runtime-revision-stale")).not.toBeInTheDocument();
  });

});


describe("Workspace task cards", () => {
  it("shows the source, task identity, accepted attempt, and a project-preserving detail link", () => {
    const updatedAt = "2026-11-11T12:00:00.000Z";
    mocks.snapshot = {
      ...initialSnapshot,
      work: {
        ...initialSnapshot.work,
        recentTasks: [{
          id: "task-accepted",
          title: "مهمة مرتبطة بقبول",
          status: "completed",
          verificationDecision: "verified",
          updatedAt,
        }],
      },
    } as unknown as ProjectWorkspaceSnapshot;
    mocks.taskDetails["task-accepted"] = {
      id: "task-accepted",
      projectId: "project-1",
      title: "مهمة مرتبطة بقبول",
      status: "completed",
      correlationId: "correlation-accepted",
      updatedAt,
      dependsOn: ["task-upstream"],
      acceptance: { attempt: 2 },
    };

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <ProjectWorkspace />
      </QueryClientProvider>,
    );

    expect(screen.getByTestId("workspace-task-source-task-accepted")).toHaveTextContent("ملخص مهام Workspace");
    expect(screen.getByTestId("workspace-task-id-task-accepted")).toHaveTextContent("task-accepted");
    expect(screen.getByTestId("workspace-task-attempt-task-accepted")).toHaveTextContent("2");
    expect(screen.getByTestId("workspace-task-dependencies-task-accepted")).toHaveTextContent("task-upstream");
    expect(screen.getByRole("link", { name: "فتح المهمة المعتمَد عليها: task-upstream" }))
      .toHaveAttribute("href", "/tasks?projectId=project-1&taskId=task-upstream");
    expect(screen.getByRole("link", { name: "فتح تفاصيل المهمة: مهمة مرتبطة بقبول" }))
      .toHaveAttribute("href", "/tasks?projectId=project-1&taskId=task-accepted");
  });

  it("uses the execution attempt only when the execution is linked to the same task and correlation", () => {
    const updatedAt = "2026-11-11T12:00:00.000Z";
    mocks.snapshot = {
      ...initialSnapshot,
      work: {
        ...initialSnapshot.work,
        recentTasks: [{
          id: "task-running",
          title: "مهمة قيد التنفيذ",
          status: "running",
          verificationDecision: null,
          updatedAt,
        }],
      },
    } as unknown as ProjectWorkspaceSnapshot;
    mocks.taskDetails["task-running"] = {
      id: "task-running",
      projectId: "project-1",
      title: "مهمة قيد التنفيذ",
      status: "running",
      correlationId: "correlation-running",
      updatedAt,
    };
    mocks.taskLogs["task-running"] = [{
      id: "log-running",
      taskId: "task-running",
      correlationId: "correlation-running",
      executionId: "execution-running",
      attempt: 3,
      sequence: 7,
      timestamp: updatedAt,
    }];
    mocks.executions["execution-running"] = {
      id: "execution-running",
      linkedTaskId: "task-running",
      correlationId: "correlation-running",
      attempt: 3,
    };

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <ProjectWorkspace />
      </QueryClientProvider>,
    );

    expect(screen.getByTestId("workspace-task-attempt-task-running")).toHaveTextContent("3");
    expect(screen.getByTestId("workspace-task-attempt-task-running"))
      .toHaveTextContent("محاولة مسجلة من سجل المهمة أو التنفيذ المرتبط.");
  });

  it("does not expose a cached attempt when task identity or updated timestamp differs from the Workspace snapshot", () => {
    const summaryUpdatedAt = "2026-11-11T12:00:00.000Z";
    mocks.snapshot = {
      ...initialSnapshot,
      work: {
        ...initialSnapshot.work,
        recentTasks: [{
          id: "task-mismatched",
          title: "مهمة تغيرت بعد اللقطة",
          status: "running",
          verificationDecision: null,
          updatedAt: summaryUpdatedAt,
        }],
      },
    } as unknown as ProjectWorkspaceSnapshot;
    mocks.taskDetails["task-mismatched"] = {
      id: "task-mismatched",
      projectId: "project-1",
      title: "مهمة تغيرت بعد اللقطة",
      status: "completed",
      correlationId: "correlation-newer",
      updatedAt: "2026-11-11T12:05:00.000Z",
      acceptance: { attempt: 7 },
    };

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <ProjectWorkspace />
      </QueryClientProvider>,
    );

    const card = screen.getByTestId("workspace-task-task-mismatched");
    expect(card).toHaveTextContent("قيد التنفيذ");
    expect(card).not.toHaveTextContent("مكتمل");
    expect(screen.getByTestId("workspace-task-attempt-task-mismatched")).toHaveTextContent("غير متاحة");
    expect(card).toHaveTextContent("تغير سجل المهمة منذ آخر لقطة");
  });
});
