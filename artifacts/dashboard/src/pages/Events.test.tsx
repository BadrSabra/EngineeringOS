import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Events from "./Events";
import { eventTypeLabel } from "@/lib/event-copy";

const mocks = vi.hoisted(() => ({
  isLoaded: true,
  user: { id: "user-1" } as { id: string } | null,
}));

vi.mock("@clerk/react", () => ({
  useUser: () => ({ isLoaded: mocks.isLoaded, user: mocks.user }),
}));

vi.mock("@workspace/api-client-react", () => ({
  getListEventsQueryKey: vi.fn((params: unknown) => ["/api/events", params]),
  useListEvents: vi.fn(),
  useListProjects: vi.fn(),
}));

import { getListEventsQueryKey, useListEvents, useListProjects } from "@workspace/api-client-react";

const mockEvents = [
  {
    id: "event-1",
    projectId: "project-alpha",
    type: "ScanCompleted",
    severity: "success",
    message: "Alpha scan completed",
    correlationId: "event-correlation-0123456789abcdef",
    timestamp: new Date("2026-08-22T12:00:00.000Z"),
  },
  {
    id: "event-2",
    projectId: "project-beta",
    type: "TaskFailed",
    severity: "error",
    message: "Beta task failed",
    timestamp: new Date("2026-08-22T11:00:00.000Z"),
  },
];

const refetch = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, "", "/events");
  mocks.isLoaded = true;
  mocks.user = { id: "user-1" };
  vi.mocked(useListProjects).mockReturnValue({
    data: [
      { id: "project-alpha", name: "Alpha" },
      { id: "project-beta", name: "Beta" },
    ],
  } as ReturnType<typeof useListProjects>);
  vi.mocked(useListEvents).mockReturnValue({
    data: { events: mockEvents, total: mockEvents.length },
    isLoading: false,
    isFetching: false,
    isError: false,
    error: null,
    dataUpdatedAt: new Date("2026-08-22T12:01:00.000Z").getTime(),
    refetch,
  } as ReturnType<typeof useListEvents>);
});

describe("Events", () => {
  it("translates common event codes while preserving unknown types", () => {
    expect(eventTypeLabel("ScanCompleted")).toBe("اكتمل فحص المشروع");
    expect(eventTypeLabel("TaskExecutionFailed")).toBe("تعثر تنفيذ الخطوة");
    expect(eventTypeLabel("ProviderSpecificEvent")).toBe("ProviderSpecificEvent");
  });

  it("wraps search and event actions into a narrow-screen control layout", () => {
    render(<Events />);

    expect(screen.getByTestId("events-controls")).toHaveClass("flex-wrap", "w-full", "min-w-0");
    expect(screen.getByTestId("events-search")).toHaveClass("basis-full", "min-w-0");
    expect(screen.getByPlaceholderText("ابحث في السجلات...")).toHaveClass("w-full", "sm:w-64");
    expect(screen.getByRole("region", { name: /سجل الأحداث؛ مرّر أفقيًا لعرض بقية الأعمدة/i })).toHaveAttribute("tabindex", "0");
  });

  it("polls the event log at a bounded interval only while the page is in the foreground", () => {
    render(<Events />);

    const call = vi.mocked(useListEvents).mock.calls.at(-1);
    expect(call?.[1]).toEqual(expect.objectContaining({
      query: expect.objectContaining({
        queryKey: expect.any(Array),
        refetchInterval: 15_000,
        refetchIntervalInBackground: false,
      }),
    }));
    expect(vi.mocked(getListEventsQueryKey)).toHaveBeenCalledWith(call?.[0]);
  });

  it("renders events from the all-project request", () => {
    render(<Events />);

    expect(screen.getByText("Alpha scan completed")).toBeInTheDocument();
    expect(screen.getByText("Beta task failed")).toBeInTheDocument();
    expect(screen.getByTestId("text-event-type-event-1")).toHaveTextContent("اكتمل فحص المشروع");
    expect(screen.getByTestId("text-event-type-event-1")).toHaveAttribute("title", "ScanCompleted");
    expect(screen.getByTestId("text-event-type-event-2")).toHaveTextContent("تعثر تنفيذ الخطوة");
    expect(screen.getByTestId("text-event-type-event-2")).toHaveAttribute("title", "TaskFailed");
    expect(screen.getByText("عرض 1–2 من 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "الأقدم" })).toBeDisabled();
  });

  it("reveals active filters when opening a shared filtered event view", () => {
    window.history.replaceState(
      {},
      "",
      "/events?projectId=project-alpha&severity=error&type=TaskFailed&correlationId=run-42",
    );

    render(<Events />);

    expect(screen.getByTestId("select-event-severity")).toHaveValue("error");
    expect(screen.getByTestId("input-event-correlation")).toHaveValue("run-42");
    expect(screen.getByTestId("text-event-type-filter")).toHaveTextContent("تعثر تنفيذ الخطوة");
    expect(vi.mocked(useListEvents).mock.calls.at(-1)?.[0]).toEqual({
      limit: 50,
      page: 1,
      projectId: "project-alpha",
      type: "TaskFailed",
      correlationId: "run-42",
      severity: "error",
    });
  });

  it("filters by a clicked event severity and returns to the newest page", () => {
    window.history.replaceState({}, "", "/events?search=Task&page=3");
    render(<Events />);

    fireEvent.click(screen.getByTestId("button-event-severity-event-2"));

    expect(screen.getByTestId("select-event-severity")).toHaveValue("error");
    const latestCall = vi.mocked(useListEvents).mock.calls.at(-1);
    expect(latestCall?.[0]).toEqual({
      limit: 50,
      page: 1,
      severity: "error",
      search: "Task",
    });
    const params = new URLSearchParams(window.location.search);
    expect(params.get("severity")).toBe("error");
    expect(params.get("page")).toBeNull();
    expect(params.get("search")).toBe("Task");
  });

  it("filters by the clicked event type, keeps compatible filters, and can clear the type alone", () => {
    window.history.replaceState({}, "", "/events?severity=error&search=Task&page=3");
    render(<Events />);

    fireEvent.click(screen.getByTestId("button-event-type-filter-event-2"));

    expect(screen.getByTestId("button-event-type-filter-event-2")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("text-event-type-filter")).toHaveTextContent("تعثر تنفيذ الخطوة");
    expect(screen.getByTestId("text-event-type-filter")).toHaveAttribute("title", "TaskFailed");
    expect(vi.mocked(useListEvents).mock.calls.at(-1)?.[0]).toEqual({
      limit: 50,
      page: 1,
      type: "TaskFailed",
      severity: "error",
      search: "Task",
    });
    expect(new URLSearchParams(window.location.search).get("type")).toBe("TaskFailed");
    expect(new URLSearchParams(window.location.search).get("page")).toBeNull();

    fireEvent.click(screen.getByTestId("button-clear-event-type"));

    expect(screen.getByTestId("button-event-type-filter-event-2")).toHaveAttribute("aria-pressed", "false");
    expect(vi.mocked(useListEvents).mock.calls.at(-1)?.[0]).toEqual({
      limit: 50,
      page: 1,
      severity: "error",
      search: "Task",
    });
    expect(new URLSearchParams(window.location.search).get("type")).toBeNull();
    expect(new URLSearchParams(window.location.search).get("search")).toBe("Task");
  });

  it("filters by the clicked project without losing other compatible filters", () => {
    window.history.replaceState(
      {},
      "",
      "/events?correlationId=run-42&severity=error&search=Task&page=3",
    );
    render(<Events />);

    fireEvent.click(screen.getByTestId("button-event-project-filter-event-1"));

    expect(screen.getByTestId("select-event-project")).toHaveValue("project-alpha");
    expect(screen.getByTestId("select-event-severity")).toHaveValue("error");
    expect(screen.getByTestId("input-event-correlation")).toHaveValue("");
    expect(screen.getByRole("textbox", { name: "ابحث في سجل الأحداث" })).toHaveValue("Task");
    expect(screen.getByTestId("link-event-project-event-1")).toHaveAttribute(
      "href",
      "/projects/project-alpha/workspace",
    );
    expect(vi.mocked(useListEvents).mock.calls.at(-1)?.[0]).toEqual({
      limit: 50,
      page: 1,
      projectId: "project-alpha",
      severity: "error",
      search: "Task",
    });
    const params = new URLSearchParams(window.location.search);
    expect(params.get("projectId")).toBe("project-alpha");
    expect(params.get("correlationId")).toBeNull();
    expect(params.get("severity")).toBe("error");
    expect(params.get("search")).toBe("Task");
    expect(params.get("page")).toBeNull();
  });

  it("filters the whole event log by a clicked correlation id in one step", () => {
    window.history.replaceState(
      {},
      "",
      "/events?projectId=project-beta&severity=error&search=Task&page=3",
    );
    render(<Events />);

    fireEvent.click(screen.getByTestId("button-event-correlation-event-1"));

    expect(screen.getByTestId("input-event-correlation")).toHaveValue(
      "event-correlation-0123456789abcdef",
    );
    const latestCall = vi.mocked(useListEvents).mock.calls.at(-1);
    expect(latestCall?.[0]).toEqual({
      limit: 50,
      page: 1,
      correlationId: "event-correlation-0123456789abcdef",
    });
    const params = new URLSearchParams(window.location.search);
    expect(params.get("correlationId")).toBe("event-correlation-0123456789abcdef");
    expect(params.has("projectId")).toBe(false);
    expect(params.has("severity")).toBe(false);
    expect(params.has("search")).toBe(false);
    expect(params.has("page")).toBe(false);
  });

  it("opens a known project's workspace by name and keeps unavailable project ids readable", () => {
    vi.mocked(useListEvents).mockReturnValue({
      data: {
        events: [
          mockEvents[0],
          { ...mockEvents[1], id: "event-orphan", projectId: "deleted-project" },
        ],
        total: 2,
      },
      isLoading: false,
      isFetching: false,
      isError: false,
      error: null,
      dataUpdatedAt: new Date("2026-08-22T12:01:00.000Z").getTime(),
      refetch,
    } as ReturnType<typeof useListEvents>);

    render(<Events />);

    expect(screen.getByTestId("link-event-project-event-1")).toHaveAttribute(
      "href",
      "/projects/project-alpha/workspace",
    );
    expect(screen.getByRole("link", { name: "فتح مساحة المشروع: Alpha" }))
      .toHaveAttribute("title", "project-alpha");
    expect(screen.getByTestId("text-event-project-event-orphan"))
      .toHaveTextContent("deleted-project");
    expect(screen.queryByRole("link", { name: /deleted-project/ })).not.toBeInTheDocument();
  });

  it("opens the event's exact workflow history only when a workflow is linked", () => {
    vi.mocked(useListEvents).mockReturnValue({
      data: {
        events: [
          { ...mockEvents[0], workflowId: "workflow/alpha" },
          mockEvents[1],
        ],
        total: 2,
      },
      isLoading: false,
      isFetching: false,
      isError: false,
      error: null,
      dataUpdatedAt: new Date("2026-08-22T12:01:00.000Z").getTime(),
      refetch,
    } as ReturnType<typeof useListEvents>);

    render(<Events />);

    expect(screen.getByTestId("link-event-workflow-event-1")).toHaveAttribute(
      "href",
      "/workflows?projectId=project-alpha&workflowId=workflow%2Falpha",
    );
    expect(screen.getByRole("link", {
      name: "افتح سجل مسار العمل المرتبط بالحدث ScanCompleted",
    })).toBeInTheDocument();
    expect(screen.queryByTestId("link-event-workflow-event-2")).not.toBeInTheDocument();
  });

  it("opens the event's exact task only when its project is known", () => {
    vi.mocked(useListEvents).mockReturnValue({
      data: {
        events: [
          { ...mockEvents[1], taskId: "task/beta" },
          { ...mockEvents[0], id: "event-without-task" },
          {
            ...mockEvents[0],
            id: "event-orphan-task",
            projectId: "deleted-project",
            taskId: "task/deleted-project",
          },
        ],
        total: 3,
      },
      isLoading: false,
      isFetching: false,
      isError: false,
      error: null,
      dataUpdatedAt: new Date("2026-08-22T12:01:00.000Z").getTime(),
      refetch,
    } as ReturnType<typeof useListEvents>);

    render(<Events />);

    expect(screen.getByTestId("link-event-task-event-2")).toHaveAttribute(
      "href",
      "/tasks?projectId=project-beta&taskId=task%2Fbeta",
    );
    expect(screen.getByRole("link", {
      name: "افتح تفاصيل المهمة المرتبطة: تعثر تنفيذ الخطوة",
    })).toBeInTheDocument();
    expect(screen.queryByTestId("link-event-task-event-without-task")).not.toBeInTheDocument();
    expect(screen.queryByTestId("link-event-task-event-orphan-task")).not.toBeInTheDocument();
  });

  it("offers assistant context only for warning or error events in a known project", () => {
    vi.mocked(useListEvents).mockReturnValue({
      data: {
        events: [
          ...mockEvents,
          { ...mockEvents[1], id: "event-orphan", projectId: "deleted-project" },
        ],
        total: 3,
      },
      isLoading: false,
      isFetching: false,
      isError: false,
      error: null,
      dataUpdatedAt: new Date("2026-08-22T12:01:00.000Z").getTime(),
      refetch,
    } as ReturnType<typeof useListEvents>);

    render(<Events />);

    expect(screen.getByTestId("button-event-goal-handoff-event-2")).toBeInTheDocument();
    expect(screen.queryByTestId("button-event-goal-handoff-event-1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("button-event-goal-handoff-event-orphan")).not.toBeInTheDocument();
  });

  it("labels an in-progress refresh and retains only the last successful read as a snapshot", () => {
    vi.mocked(useListEvents).mockReturnValue({
      data: { events: mockEvents, total: mockEvents.length },
      isLoading: false,
      isFetching: true,
      isError: false,
      error: null,
      dataUpdatedAt: new Date("2026-08-22T12:01:00.000Z").getTime(),
      refetch,
    } as ReturnType<typeof useListEvents>);

    render(<Events />);

    expect(screen.getByRole("status")).toHaveTextContent(
      "يجري تحديث السجل؛ الأحداث المعروضة تمثل آخر قراءة ناجحة.",
    );
    expect(screen.getByText("Alpha scan completed")).toBeInTheDocument();
    expect(screen.queryByText(/لا توجد أحداث مسجلة/)).not.toBeInTheDocument();
  });

  it("shows the time of the last successful read when the event list is settled", () => {
    render(<Events />);

    expect(screen.getByTestId("events-read-status")).toHaveTextContent("آخر قراءة ناجحة:");
    expect(screen.getByTestId("events-read-status").querySelector("time")).toHaveAttribute(
      "dateTime",
      "2026-08-22T12:01:00.000Z",
    );
  });

  it("shows each event's full local date and time with a machine-readable timestamp", () => {
    render(<Events />);

    const eventTime = screen.getByTestId("event-time-event-1");
    const expectedLocalDateTime = new Intl.DateTimeFormat("ar-EG", {
      dateStyle: "medium",
      timeStyle: "medium",
    }).format(mockEvents[0].timestamp);

    expect(screen.getByText("التاريخ والوقت المحلي")).toBeInTheDocument();
    expect(eventTime).toHaveAttribute("dateTime", "2026-08-22T12:00:00.000Z");
    expect(eventTime).toHaveTextContent(expectedLocalDateTime);
  });

  it("keeps malformed event timestamps visible without crashing the event list", () => {
    vi.mocked(useListEvents).mockReturnValue({
      data: {
        events: [{ ...mockEvents[0], id: "event-invalid-time", timestamp: "not-a-timestamp" }],
        total: 1,
      },
      isLoading: false,
      isFetching: false,
      isError: false,
      error: null,
      dataUpdatedAt: new Date("2026-08-22T12:01:00.000Z").getTime(),
      refetch,
    } as unknown as ReturnType<typeof useListEvents>);

    render(<Events />);

    expect(screen.getByText("Alpha scan completed")).toBeInTheDocument();
    expect(screen.getByText("وقت غير صالح")).toBeInTheDocument();
    expect(screen.getByText("عرض 1–1 من 1")).toBeInTheDocument();
  });

  it("keeps the Arabic page RTL and event identifiers LTR", () => {
    const { container } = render(<Events />);

    expect(container.firstElementChild).toHaveAttribute("dir", "rtl");
    expect(screen.getByText("event-correlation-0123456789abcdef", { exact: true }))
      .toHaveAttribute("dir", "ltr");
  });

  it("shows an error and retry action instead of the empty state", () => {
    vi.mocked(useListEvents).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error("Events service unavailable"),
      refetch,
    } as ReturnType<typeof useListEvents>);

    render(<Events />);

    expect(screen.getByText(/تعذّر تحميل الأحداث: events service unavailable/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "حاول مجددًا" })).toBeInTheDocument();
    expect(screen.queryByText("No events recorded.")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "حاول مجددًا" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("distinguishes a successful empty response from a failed request", () => {
    vi.mocked(useListEvents).mockReturnValue({
      data: { events: [], total: 0 },
      isLoading: false,
      isError: false,
      error: null,
      refetch,
    } as ReturnType<typeof useListEvents>);

    render(<Events />);

    expect(screen.getByText("لا توجد أحداث مسجلة.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("clears every active filter from the expanded panel for an empty shared view", () => {
    window.history.replaceState(
      {},
      "",
      "/events?projectId=project-beta&severity=error&type=TaskFailed&correlationId=trace-123&search=missing&page=3",
    );
    vi.mocked(useListEvents).mockReturnValue({
      data: { events: [], total: 0 },
      isLoading: false,
      isFetching: false,
      isError: false,
      error: null,
      dataUpdatedAt: new Date("2026-08-22T12:01:00.000Z").getTime(),
      refetch,
    } as ReturnType<typeof useListEvents>);

    render(<Events />);

    // Shared links intentionally reveal their active filters, so clear them from that panel.
    expect(screen.getByTestId("select-event-severity")).toBeInTheDocument();
    const clearFilters = screen.getByRole("button", { name: "مسح عوامل التصفية" });
    expect(clearFilters).toBeInTheDocument();

    fireEvent.click(clearFilters);

    expect(vi.mocked(useListEvents).mock.calls.at(-1)?.[0]).toEqual({
      limit: 50,
      page: 1,
    });
    expect(new URLSearchParams(window.location.search).size).toBe(0);
  });

  it("clears event search in one click without losing project or severity filters", () => {
    window.history.replaceState(
      {},
      "",
      "/events?projectId=project-beta&severity=error&search=Task&page=3",
    );

    render(<Events />);

    const searchInput = screen.getByRole("textbox", { name: "ابحث في سجل الأحداث" });
    expect(searchInput).toHaveValue("Task");

    fireEvent.click(screen.getByRole("button", { name: "مسح البحث عن الأحداث" }));

    expect(searchInput).toHaveValue("");
    expect(document.activeElement).toBe(searchInput);
    expect(screen.queryByTestId("button-clear-event-search")).not.toBeInTheDocument();
    expect(vi.mocked(useListEvents).mock.calls.at(-1)?.[0]).toEqual({
      limit: 50,
      page: 1,
      projectId: "project-beta",
      severity: "error",
    });

    const params = new URLSearchParams(window.location.search);
    expect(params.get("projectId")).toBe("project-beta");
    expect(params.get("severity")).toBe("error");
    expect(params.has("search")).toBe(false);
    expect(params.has("page")).toBe(false);
  });
});
