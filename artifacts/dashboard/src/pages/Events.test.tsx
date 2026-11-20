import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Events from "./Events";

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
    expect(screen.getByText("عرض 1–2 من 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "الأقدم" })).toBeDisabled();
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
});