import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useGetAiExecution, type ProjectWorkspaceSnapshot } from "@workspace/api-client-react";
import ProjectWorkspace from "./ProjectWorkspace";

const mocks = vi.hoisted(() => ({
  snapshotQuery: {
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  },
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
  taskFetching: {} as Record<string, boolean>,
  taskError: {} as Record<string, boolean>,
  taskLogsFetching: {} as Record<string, boolean>,
  executionFetching: {} as Record<string, boolean>,
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
    ...mocks.snapshotQuery,
  }),
  getGetProjectWorkspaceSnapshotQueryKey: (projectId: string) => [
    "/api/projects",
    projectId,
    "workspace",
  ],
  useGetTask: (taskId: string) => ({
    data: mocks.taskDetails[taskId],
    isLoading: false,
    isError: Boolean(mocks.taskError[taskId]),
    isFetching: Boolean(mocks.taskFetching[taskId]),
  }),
  getGetTaskQueryKey: (taskId: string) => [`/api/tasks/${taskId}`],
  useGetTaskLogs: (taskId: string) => ({
    data: mocks.taskLogs[taskId] ?? [],
    isLoading: false,
    isError: false,
    isFetching: Boolean(mocks.taskLogsFetching[taskId]),
  }),
  getGetTaskLogsQueryKey: (taskId: string) => [`/api/tasks/${taskId}/logs`],
  useGetAiExecution: vi.fn((executionId: string) => ({
    data: mocks.executions[executionId],
    isLoading: false,
    isError: false,
    isFetching: Boolean(mocks.executionFetching[executionId]),
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

vi.mock("@/components/ExecutionProjectionPanel", () => ({
  ExecutionProjectionPanel: (props: Record<string, unknown>) => (
    <div
      data-testid="workspace-execution-projection"
      data-execution-id={String(props.executionId)}
      data-read-only={String(props.readOnly)}
      data-hide-recovery-actions={String(props.hideRecoveryActions)}
    />
  ),
}));

beforeEach(() => {
  mocks.snapshot = initialSnapshot;
  mocks.snapshotQuery.isLoading = false;
  mocks.snapshotQuery.isError = false;
  mocks.snapshotQuery.isFetching = false;
  mocks.snapshotQuery.refetch.mockReset();
  mocks.taskDetails = {};
  mocks.taskLogs = {};
  mocks.executions = {};
  mocks.taskFetching = {};
  mocks.taskError = {};
  mocks.taskLogsFetching = {};
  mocks.executionFetching = {};
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
    expect(screen.getByTestId("link-start-request-from-empty-work"))
      .toHaveAttribute("href", "#workspace-panel-agent");
    expect(screen.getByTestId("link-discuss-work-from-empty-candidate"))
      .toHaveAttribute("href", "#workspace-panel-agent");

    const previewGate = screen.getByTestId("workspace-preview-gate");
    expect(previewGate).toHaveTextContent("لا توجد معاينة تفاعلية مؤهلة بعد");
    expect(previewGate).toHaveTextContent("ليست إثباتًا على جاهزية Preview");
    expect(screen.getByRole("link", { name: "الانتقال إلى إعداد جهاز Linux للمعاينة" }))
      .toHaveAttribute("href", "#workspace-preview-agents");
    expect(document.getElementById("workspace-preview-agents"))
      .toHaveTextContent("الاقتران يثبت هوية الجهاز فقط");
    expect(document.getElementById("workspace-preview-agents"))
      .toHaveAttribute("aria-labelledby", "preview-agent-heading");
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
    expect(screen.queryByTestId("link-start-request-from-empty-work")).not.toBeInTheDocument();
    expect(screen.queryByTestId("link-discuss-work-from-empty-candidate")).not.toBeInTheDocument();
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

  it("keeps the Workspace refresh busy until task-linked execution evidence also settles", async () => {
    const updatedAt = "2026-11-11T12:00:00.000Z";
    const taskDetails = {
      id: "task-refresh-composite",
      projectId: "project-1",
      title: "مهمة مساحة المشروع",
      status: "completed",
      correlationId: "correlation-refresh-composite",
      updatedAt,
    };
    const taskLogs = [{
      id: "log-refresh-composite",
      taskId: "task-refresh-composite",
      correlationId: "correlation-refresh-composite",
      executionId: "execution-task-linked",
      sequence: 5,
      timestamp: updatedAt,
    }];
    mocks.snapshot = {
      ...initialSnapshot,
      work: {
        ...initialSnapshot.work,
        recentTasks: [{
          id: "task-refresh-composite",
          title: "مهمة مساحة المشروع",
          status: "completed",
          verificationDecision: null,
          updatedAt,
        }],
        latestExecution: {
          id: "execution-refresh-composite",
          status: "completed",
          attempt: 2,
          proposalId: "proposal-refresh-composite",
          updatedAt,
        },
      },
    } as unknown as ProjectWorkspaceSnapshot;
    mocks.taskDetails["task-refresh-composite"] = taskDetails;
    mocks.taskLogs["task-refresh-composite"] = taskLogs;
    mocks.executions["execution-task-linked"] = {
      id: "execution-task-linked",
      projectId: "project-1",
      linkedTaskId: "task-refresh-composite",
      correlationId: "correlation-refresh-composite",
      attempt: 2,
    };
    mocks.snapshotQuery.refetch.mockResolvedValue({
      data: mocks.snapshot,
      isError: false,
    } as never);

    let resolveTaskReads!: () => void;
    let resolveExecutionReads!: () => void;
    const pendingTaskReads = new Promise<void>((resolve) => {
      resolveTaskReads = resolve;
    });
    const pendingExecutionReads = new Promise<void>((resolve) => {
      resolveExecutionReads = resolve;
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    queryClient.setQueryData(["/api/tasks/task-refresh-composite"], taskDetails);
    queryClient.setQueryData(["/api/tasks/task-refresh-composite/logs"], taskLogs);
    const invalidate = vi.spyOn(queryClient, "invalidateQueries")
      .mockImplementation((filters) => {
        const firstKey = filters?.queryKey?.[0];
        return typeof firstKey === "string" && firstKey.startsWith("/api/tasks/")
          ? pendingTaskReads
          : pendingExecutionReads;
      });

    render(
      <QueryClientProvider client={queryClient}>
        <ProjectWorkspace />
      </QueryClientProvider>,
    );

    const refreshButton = screen.getByRole("button", { name: "تحديث الحالة" });
    fireEvent.click(refreshButton);

    await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(2));
    expect(mocks.snapshotQuery.refetch).toHaveBeenCalledOnce();
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["/api/tasks/task-refresh-composite"],
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["/api/tasks/task-refresh-composite/logs"],
    });
    expect(refreshButton).toBeDisabled();
    expect(refreshButton).toHaveAttribute("aria-busy", "true");
    expect(refreshButton).toHaveTextContent("جارٍ تحديث الحالة والعمل");

    await act(async () => {
      resolveTaskReads();
      await pendingTaskReads;
    });

    await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(4));
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["/api/ai/executions/execution-refresh-composite"],
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["/api/ai/executions/execution-task-linked"],
    });
    expect(refreshButton).toBeDisabled();
    expect(refreshButton).toHaveAttribute("aria-busy", "true");

    await act(async () => {
      resolveExecutionReads();
      await pendingExecutionReads;
    });

    await waitFor(() => expect(refreshButton).not.toBeDisabled());
    expect(refreshButton).toHaveAttribute("aria-busy", "false");
    expect(refreshButton).toHaveTextContent("تحديث الحالة");
  });

  it("preserves only the last successful project identity and timestamp after a background snapshot read fails", () => {
    mocks.snapshotQuery.isError = true;

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <ProjectWorkspace />
      </QueryClientProvider>,
    );

    const staleState = screen.getByTestId("workspace-stale-snapshot");
    expect(staleState).toHaveAttribute("role", "alert");
    expect(staleState).toHaveTextContent("تعذر تحديث مساحة المشروع");
    expect(staleState).toHaveTextContent("مشروع البث");
    expect(screen.getByTestId("workspace-stale-snapshot-observed-at")).toHaveAttribute(
      "dateTime",
      "2026-11-11T12:00:00.000Z",
    );
    expect(staleState).toHaveTextContent("أخفينا تفاصيل العمل والمساعد وإجراءات التنفيذ");
    expect(screen.queryByTestId("project-workspace")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "محادثة المشروع" })).not.toBeInTheDocument();
    expect(screen.queryByText("النسخة المرشحة")).not.toBeInTheDocument();
    expect(screen.queryByText("حالة التشغيل")).not.toBeInTheDocument();
    expect(eventSource).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "إعادة محاولة قراءة مساحة المشروع" }));
    expect(mocks.snapshotQuery.refetch).toHaveBeenCalledOnce();
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
    mocks.taskLogsFetching["task-accepted"] = true;

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
    expect(screen.getByTestId("workspace-task-task-accepted"))
      .toHaveTextContent("محاولة قبول مسجلة في سجل المهمة.");
    expect(screen.getByTestId("workspace-task-dependencies-task-accepted")).toHaveTextContent("task-upstream");
    expect(screen.getByRole("link", { name: "فتح المهمة المعتمَد عليها: task-upstream" }))
      .toHaveAttribute("href", "/tasks?projectId=project-1&taskId=task-upstream");
    expect(screen.getByRole("link", { name: "فتح تفاصيل المهمة: مهمة مرتبطة بقبول" }))
      .toHaveAttribute("href", "/tasks?projectId=project-1&taskId=task-accepted");
    expect(screen.queryByTestId("link-workspace-task-chat-task-accepted")).not.toBeInTheDocument();
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
      projectId: "project-1",
      linkedTaskId: "task-running",
      correlationId: "correlation-running",
      attempt: 3,
      sessionId: "session/running",
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
    expect(screen.getByTestId("workspace-task-task-running"))
      .toHaveTextContent("محاولة مسجلة من التنفيذ المرتبط بالمهمة.");
    expect(screen.getByTestId("link-workspace-task-chat-task-running"))
      .toHaveAttribute("href", "/ai?projectId=project-1&sessionId=session%2Frunning");
  });

  it("does not expose an execution attempt when its project differs from the Workspace task project", () => {
    const updatedAt = "2026-11-11T12:00:00.000Z";
    mocks.snapshot = {
      ...initialSnapshot,
      work: {
        ...initialSnapshot.work,
        recentTasks: [{
          id: "task-project-boundary",
          title: "مهمة المشروع الحالي",
          status: "running",
          verificationDecision: null,
          updatedAt,
        }],
      },
    } as unknown as ProjectWorkspaceSnapshot;
    mocks.taskDetails["task-project-boundary"] = {
      id: "task-project-boundary",
      projectId: "project-1",
      title: "مهمة المشروع الحالي",
      status: "running",
      correlationId: "correlation-project-boundary",
      updatedAt,
    };
    mocks.taskLogs["task-project-boundary"] = [{
      id: "log-project-boundary",
      taskId: "task-project-boundary",
      correlationId: "correlation-project-boundary",
      executionId: "execution-wrong-project",
      attempt: 9,
      sequence: 10,
      timestamp: updatedAt,
    }];
    mocks.executions["execution-wrong-project"] = {
      id: "execution-wrong-project",
      projectId: "project-2",
      linkedTaskId: "task-project-boundary",
      correlationId: "correlation-project-boundary",
      attempt: 9,
      sessionId: "session-wrong-project",
    };

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <ProjectWorkspace />
      </QueryClientProvider>,
    );

    const attempt = screen.getByTestId("workspace-task-attempt-task-project-boundary");
    expect(attempt).toHaveTextContent("غير متاحة");
    expect(attempt).not.toHaveTextContent("9");
    expect(screen.queryByTestId("link-workspace-task-chat-task-project-boundary"))
      .not.toBeInTheDocument();
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
          status: "completed",
          verificationDecision: "verified",
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
      dependsOn: ["stale-dependency"],
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
    expect(card).toHaveTextContent("مكتمل");
    expect(screen.getByTestId("workspace-task-attempt-task-mismatched")).toHaveTextContent("غير متاحة");
    expect(screen.getByTestId("workspace-task-attempt-task-mismatched")).not.toHaveTextContent("7");
    expect(screen.getByTestId("workspace-task-dependencies-task-mismatched"))
      .toHaveTextContent("غير متاحة في سجل المهمة");
    expect(card).not.toHaveTextContent("stale-dependency");
    expect(card).toHaveTextContent("تغير سجل المهمة منذ آخر لقطة");
  });

  it("fails closed on cached acceptance and dependencies when task detail refresh fails", () => {
    const updatedAt = "2026-11-11T12:00:00.000Z";
    mocks.snapshot = {
      ...initialSnapshot,
      work: {
        ...initialSnapshot.work,
        recentTasks: [{
          id: "task-read-failed",
          title: "تعذر تحديث تفاصيل المهمة",
          status: "completed",
          verificationDecision: "verified",
          updatedAt,
        }],
      },
    } as unknown as ProjectWorkspaceSnapshot;
    mocks.taskDetails["task-read-failed"] = {
      id: "task-read-failed",
      projectId: "project-1",
      title: "تعذر تحديث تفاصيل المهمة",
      status: "completed",
      correlationId: "correlation-cached",
      updatedAt,
      dependsOn: ["cached-dependency"],
      acceptance: { attempt: 4 },
    };
    mocks.taskError["task-read-failed"] = true;

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <ProjectWorkspace />
      </QueryClientProvider>,
    );

    const card = screen.getByTestId("workspace-task-task-read-failed");
    expect(screen.getByTestId("workspace-task-attempt-task-read-failed"))
      .toHaveTextContent("غير متاحة");
    expect(screen.getByTestId("workspace-task-attempt-task-read-failed"))
      .not.toHaveTextContent("4");
    expect(screen.getByTestId("workspace-task-dependencies-task-read-failed"))
      .toHaveTextContent("غير متاحة في سجل المهمة");
    expect(card).not.toHaveTextContent("cached-dependency");
    expect(card).toHaveTextContent("تعذر قراءة سجل المهمة؛ لم نعرض رقم محاولة غير مؤكد.");
  });

  it("does not show an attempt from an execution that belongs to another task", () => {
    const updatedAt = "2026-11-11T12:00:00.000Z";
    mocks.snapshot = {
      ...initialSnapshot,
      work: {
        ...initialSnapshot.work,
        recentTasks: [{
          id: "task-current",
          title: "المهمة الحالية",
          status: "running",
          verificationDecision: null,
          updatedAt,
        }],
      },
    } as unknown as ProjectWorkspaceSnapshot;
    mocks.taskDetails["task-current"] = {
      id: "task-current",
      projectId: "project-1",
      title: "المهمة الحالية",
      status: "running",
      correlationId: "correlation-current",
      updatedAt,
    };
    mocks.taskLogs["task-current"] = [{
      id: "log-other-execution",
      taskId: "task-current",
      correlationId: "correlation-current",
      executionId: "execution-other",
      attempt: 9,
      sequence: 10,
      timestamp: updatedAt,
    }];
    mocks.executions["execution-other"] = {
      id: "execution-other",
      linkedTaskId: "task-other",
      correlationId: "correlation-current",
      attempt: 9,
    };

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <ProjectWorkspace />
      </QueryClientProvider>,
    );

    expect(screen.getByTestId("workspace-task-attempt-task-current")).toHaveTextContent("غير متاحة");
    expect(screen.getByTestId("workspace-task-attempt-task-current"))
      .not.toHaveTextContent("9");
  });

  it("does not request an execution from a TaskLog owned by another task", () => {
    const updatedAt = "2026-11-11T12:00:00.000Z";
    mocks.snapshot = {
      ...initialSnapshot,
      work: {
        ...initialSnapshot.work,
        recentTasks: [{
          id: "task-current",
          title: "المهمة الحالية",
          status: "running",
          verificationDecision: null,
          updatedAt,
        }],
      },
    } as unknown as ProjectWorkspaceSnapshot;
    mocks.taskDetails["task-current"] = {
      id: "task-current",
      projectId: "project-1",
      title: "المهمة الحالية",
      status: "running",
      correlationId: "correlation-current",
      updatedAt,
    };
    mocks.taskLogs["task-current"] = [{
      id: "log-foreign-task",
      taskId: "task-other",
      correlationId: "correlation-current",
      executionId: "execution-from-foreign-log",
      attempt: 17,
      sequence: 11,
      timestamp: updatedAt,
    }];
    // Even a matching downstream execution must not be fetched from a
    // TaskLog whose own task identity is foreign.
    mocks.executions["execution-from-foreign-log"] = {
      id: "execution-from-foreign-log",
      projectId: "project-1",
      linkedTaskId: "task-current",
      correlationId: "correlation-current",
      attempt: 17,
    };

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <ProjectWorkspace />
      </QueryClientProvider>,
    );

    expect(screen.getByTestId("workspace-task-attempt-task-current"))
      .toHaveTextContent("غير متاحة");
    expect(screen.getByTestId("workspace-task-attempt-task-current"))
      .not.toHaveTextContent("17");
    expect(screen.getByTestId("workspace-task-task-current"))
      .toHaveTextContent("سجل التنفيذ لا يطابق المهمة الحالية؛ لم نعرض المحاولة.");
    expect(vi.mocked(useGetAiExecution)).not.toHaveBeenCalledWith(
      "execution-from-foreign-log",
      expect.anything(),
    );
  });

  it("revalidates recent task and log reads when the Workspace stream changes", async () => {
    const updatedAt = "2026-11-11T12:00:00.000Z";
    mocks.snapshot = {
      ...initialSnapshot,
      work: {
        ...initialSnapshot.work,
        recentTasks: [{
          id: "task-refresh",
          title: "مهمة يجب إعادة قراءتها",
          status: "running",
          verificationDecision: null,
          updatedAt,
        }],
      },
    } as unknown as ProjectWorkspaceSnapshot;
    mocks.taskDetails["task-refresh"] = {
      id: "task-refresh",
      projectId: "project-1",
      title: "مهمة يجب إعادة قراءتها",
      status: "running",
      correlationId: "correlation-refresh",
      updatedAt,
    };

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
    act(() => eventSource!.emit("workspace.changed", {
      eventVersion: 1,
      projectId: "project-1",
      eventId: "event-task-refresh",
      snapshotCursor: "cursor-task-refresh",
    }));

    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["/api/tasks/task-refresh"] });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["/api/tasks/task-refresh/logs"] });
    });
  });

  it("does not display cached acceptance while the Task detail is being refreshed", () => {
    const updatedAt = "2026-11-11T12:00:00.000Z";
    mocks.snapshot = {
      ...initialSnapshot,
      work: {
        ...initialSnapshot.work,
        recentTasks: [{
          id: "task-refreshing",
          title: "مهمة يعاد تحميلها",
          status: "completed",
          verificationDecision: "verified",
          updatedAt,
        }],
      },
    } as unknown as ProjectWorkspaceSnapshot;
    mocks.taskDetails["task-refreshing"] = {
      id: "task-refreshing",
      projectId: "project-1",
      title: "مهمة يعاد تحميلها",
      status: "completed",
      correlationId: "correlation-refreshing",
      updatedAt,
      acceptance: { attempt: 4 },
    };
    mocks.taskFetching["task-refreshing"] = true;

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <ProjectWorkspace />
      </QueryClientProvider>,
    );

    expect(screen.getByTestId("workspace-task-attempt-task-refreshing")).toHaveTextContent("غير متاحة");
    expect(screen.getByTestId("workspace-task-attempt-task-refreshing")).not.toHaveTextContent("4");
    expect(screen.getByTestId("workspace-task-task-refreshing"))
      .toHaveTextContent("جارٍ تحديث سجل المهمة؛ أخفينا المحاولة مؤقتاً.");
  });

  it("does not display a cached execution attempt while Task Logs are being refreshed", () => {
    const updatedAt = "2026-11-11T12:00:00.000Z";
    mocks.snapshot = {
      ...initialSnapshot,
      work: {
        ...initialSnapshot.work,
        recentTasks: [{
          id: "task-logs-refreshing",
          title: "سجل التنفيذ قيد التحديث",
          status: "running",
          verificationDecision: null,
          updatedAt,
        }],
      },
    } as unknown as ProjectWorkspaceSnapshot;
    mocks.taskDetails["task-logs-refreshing"] = {
      id: "task-logs-refreshing",
      projectId: "project-1",
      title: "سجل التنفيذ قيد التحديث",
      status: "running",
      correlationId: "correlation-logs-refreshing",
      updatedAt,
    };
    mocks.taskLogs["task-logs-refreshing"] = [{
      id: "log-logs-refreshing",
      taskId: "task-logs-refreshing",
      correlationId: "correlation-logs-refreshing",
      executionId: "execution-logs-refreshing",
      attempt: 5,
      sequence: 4,
      timestamp: updatedAt,
    }];
    mocks.executions["execution-logs-refreshing"] = {
      id: "execution-logs-refreshing",
      linkedTaskId: "task-logs-refreshing",
      correlationId: "correlation-logs-refreshing",
      attempt: 5,
    };
    mocks.taskLogsFetching["task-logs-refreshing"] = true;

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <ProjectWorkspace />
      </QueryClientProvider>,
    );

    expect(screen.getByTestId("workspace-task-attempt-task-logs-refreshing")).toHaveTextContent("غير متاحة");
    expect(screen.getByTestId("workspace-task-attempt-task-logs-refreshing")).not.toHaveTextContent("5");
  });

  it("does not display a Task acceptance attempt without a current execution correlation", () => {
    const updatedAt = "2026-11-11T12:00:00.000Z";
    mocks.snapshot = {
      ...initialSnapshot,
      work: {
        ...initialSnapshot.work,
        recentTasks: [{
          id: "task-without-correlation",
          title: "مهمة بلا رابط تنفيذ حالي",
          status: "completed",
          verificationDecision: "verified",
          updatedAt,
        }],
      },
    } as unknown as ProjectWorkspaceSnapshot;
    mocks.taskDetails["task-without-correlation"] = {
      id: "task-without-correlation",
      projectId: "project-1",
      title: "مهمة بلا رابط تنفيذ حالي",
      status: "completed",
      correlationId: null,
      updatedAt,
      acceptance: { attempt: 8 },
    };

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <ProjectWorkspace />
      </QueryClientProvider>,
    );

    expect(screen.getByTestId("workspace-task-attempt-task-without-correlation"))
      .toHaveTextContent("غير متاحة");
    expect(screen.getByTestId("workspace-task-attempt-task-without-correlation"))
      .not.toHaveTextContent("8");
  });



});



describe("Workspace execution detail identity", () => {
  const summary = {
    id: "execution-identity",
    status: "completed",
    attempt: 4,
    proposalId: "proposal-current",
    baseRevision: "base-revision",
    updatedAt: "2026-11-11T12:00:00.000Z",
  };

  function renderExecutionDetail(detail: Record<string, unknown>) {
    mocks.snapshot = {
      ...initialSnapshot,
      work: {
        ...initialSnapshot.work,
        latestExecution: summary,
      },
    } as unknown as ProjectWorkspaceSnapshot;
    mocks.executions[summary.id] = detail;

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    return render(
      <QueryClientProvider client={queryClient}>
        <ProjectWorkspace />
      </QueryClientProvider>,
    );
  }

  function validDetail() {
    return {
      id: summary.id,
      projectId: "project-1",
      attempt: summary.attempt,
      proposalId: summary.proposalId,
      status: "completed",
      flightState: "COMPLETED",
      evidenceVerdict: "PROVEN",
      resumable: false,
      operationId: "operation-identity",
      projection: { schemaVersion: 2 },
    };
  }

  it("renders the execution projection only when the complete identity tuple matches", () => {
    renderExecutionDetail(validDetail());

    const panel = screen.getByTestId("workspace-execution-projection");
    expect(panel).toHaveAttribute("data-execution-id", summary.id);
    expect(panel).toHaveAttribute("data-read-only", "true");
    expect(panel).toHaveAttribute("data-hide-recovery-actions", "true");
    expect(screen.queryByText(/تعذر مطابقة تفاصيل التنفيذ/)).not.toBeInTheDocument();
  });

  it.each([
    ["project identity is missing", { projectId: undefined }],
    ["project belongs to another project", { projectId: "project-foreign" }],
    ["attempt identity is missing", { attempt: undefined }],
    ["attempt belongs to another attempt", { attempt: 3 }],
    ["proposal identity is missing", { proposalId: undefined }],
    ["proposal belongs to another candidate", { proposalId: "proposal-foreign" }],
    ["proposal is null while a candidate is expected", { proposalId: null }],
    ["execution identity is different", { id: "execution-foreign" }],
  ] as const)("fails closed when %s", (_case, override) => {
    renderExecutionDetail({ ...validDetail(), ...override });

    expect(screen.getByText(
      "تعذر مطابقة تفاصيل التنفيذ مع المشروع أو المحاولة أو المرشح الحالي؛ لن نخلط بين إسقاطات مختلفة.",
    )).toBeInTheDocument();
    expect(screen.queryByTestId("workspace-execution-projection")).not.toBeInTheDocument();
  });

  it("fails closed when the execution projection schema is not version 2", () => {
    renderExecutionDetail({ ...validDetail(), projection: { schemaVersion: 1 } });

    expect(screen.getByText(/تعذر مطابقة تفاصيل التنفيذ/)).toBeInTheDocument();
    expect(screen.queryByTestId("workspace-execution-projection")).not.toBeInTheDocument();
  });
});
