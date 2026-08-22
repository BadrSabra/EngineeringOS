import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Events from "./Events";

vi.mock("@workspace/api-client-react", () => ({
  useListEvents: vi.fn(),
  useListProjects: vi.fn(),
}));

import { useListEvents, useListProjects } from "@workspace/api-client-react";

const mockEvents = [
  {
    id: "event-1",
    projectId: "project-alpha",
    type: "ScanCompleted",
    severity: "success",
    message: "Alpha scan completed",
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
    data: mockEvents,
    isLoading: false,
    isError: false,
    error: null,
    refetch,
  } as ReturnType<typeof useListEvents>);
});

describe("Events", () => {
  it("renders events from the all-project request", () => {
    render(<Events />);

    expect(screen.getByText("Alpha scan completed")).toBeInTheDocument();
    expect(screen.getByText("Beta task failed")).toBeInTheDocument();
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

    expect(screen.getByText(/unable to load events: events service unavailable/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.queryByText("No events recorded.")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("distinguishes a successful empty response from a failed request", () => {
    vi.mocked(useListEvents).mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      error: null,
      refetch,
    } as ReturnType<typeof useListEvents>);

    render(<Events />);

    expect(screen.getByText("No events recorded.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });
});