import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Dashboard from "./Dashboard";
import { HOME_GOAL_DRAFT_HANDOFF_KEY } from "../lib/home-goal-handoff";

const { mockSetLocation } = vi.hoisted(() => ({
  mockSetLocation: vi.fn(),
}));

vi.mock("wouter", () => ({
  Link: ({
    href,
    children,
    className,
    "data-testid": dataTestId,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
    "data-testid"?: string;
  }) => (
    <a href={href} className={className} data-testid={dataTestId}>{children}</a>
  ),
  useLocation: () => ["/", mockSetLocation],
}));

vi.mock("@/components/OperatorResilience", () => ({
  RefreshButton: ({ onRefresh, label }: { onRefresh: () => void; label: string }) => (
    <button type="button" aria-label={label} onClick={() => void onRefresh()}>
      Refresh
    </button>
  ),
  RequestError: ({ title }: { title: string }) => <div role="alert">{title}</div>,
}));

vi.mock("@workspace/api-client-react", () => ({
  getGetHealthQueryKey: vi.fn(() => ["/api/healthz"]),
  getListOperatorAlertsQueryKey: vi.fn(() => ["/api/ai/operator-alerts"]),
  useGetDashboard: vi.fn(),
  useGetHealth: vi.fn(),
  useListOperatorAlerts: vi.fn(),
}));

import {
  useGetDashboard,
  useGetHealth,
  useListOperatorAlerts,
} from "@workspace/api-client-react";

const dashboard = {
  completedTaskCount: 1,
  failedTaskCount: 0,
  activeTaskCount: 0,
  projectCount: 1,
  taskStatusBreakdown: {},
  projectScores: [],
  recentEvents: [],
  freshnessRevision: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockSetLocation.mockReset();
  window.sessionStorage.clear();
  vi.mocked(useGetDashboard).mockReturnValue({
    data: dashboard,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    isRefetching: false,
    dataUpdatedAt: Date.now(),
  } as ReturnType<typeof useGetDashboard>);
  vi.mocked(useGetHealth).mockReturnValue({
    data: { aiDiagnosticsRetention: { status: "success", completedAt: new Date() } },
    refetch: vi.fn(),
  } as ReturnType<typeof useGetHealth>);
});

describe("Dashboard goal-first home", () => {
  it("hands the goal to the assistant as an unsent one-time draft", () => {
    vi.mocked(useListOperatorAlerts).mockReturnValue({
      data: { alerts: [] },
      isLoading: false,
      error: null,
      isFetching: false,
      refetch: vi.fn(),
    } as ReturnType<typeof useListOperatorAlerts>);

    render(<Dashboard />);

    fireEvent.change(screen.getByTestId("input-home-goal"), {
      target: { value: "ساعدني أفهم سبب بطء صفحة تسجيل الدخول" },
    });
    fireEvent.click(screen.getByTestId("button-start-goal"));

    expect(window.sessionStorage.getItem(HOME_GOAL_DRAFT_HANDOFF_KEY)).toBe(
      "ساعدني أفهم سبب بطء صفحة تسجيل الدخول",
    );
    expect(mockSetLocation).toHaveBeenCalledWith("/ai");
    expect(screen.getByText(/لن يُرسل النص تلقائيًا/)).toBeInTheDocument();
  });

  it("labels task totals as recorded status rather than proof", () => {
    vi.mocked(useListOperatorAlerts).mockReturnValue({
      data: { alerts: [] },
      isLoading: false,
      error: null,
      isFetching: false,
      refetch: vi.fn(),
    } as ReturnType<typeof useListOperatorAlerts>);

    render(<Dashboard />);

    expect(screen.getByTestId("text-completed-work-home")).toHaveTextContent("1");
    expect(screen.getByText(/تفاصيل القبول والإثبات تبقى ضمن المهمة/)).toBeInTheDocument();
  });
});

describe("Dashboard operator alerts", () => {
  it("shows a durable Groq drift alert outside provider settings", () => {
    vi.mocked(useListOperatorAlerts).mockReturnValue({
      data: {
        alerts: [{
          id: "alert-1",
          fingerprint: "groq_model_catalog_drift:groq:fast:openai/retired-fast",
          kind: "groq_model_catalog_drift",
          status: "open",
          provider: "groq",
          modelRole: "fast",
          modelId: "openai/retired-fast",
          title: "Groq Fast model is unavailable",
          message: "The configured Groq Fast model (openai/retired-fast) is missing from Groq's live model catalog.",
          remediation: "Update the affected Groq model ID to a current catalog model, then restart the API.",
          occurrenceCount: 2,
          firstSeenAt: "2026-08-30T12:00:00.000Z",
          lastSeenAt: "2026-08-30T12:05:00.000Z",
          resolvedAt: null,
        }],
      },
      isLoading: false,
      error: null,
      isFetching: false,
      refetch: vi.fn(),
    } as ReturnType<typeof useListOperatorAlerts>);

    render(<Dashboard />);
    fireEvent.click(screen.getByTestId("summary-advanced-dashboard"));

    const alerts = screen.getByRole("region", { name: "Operator alerts" });
    expect(within(alerts).getByText("Groq Fast model is unavailable")).toBeInTheDocument();
    expect(within(alerts).getAllByText(/openai\/retired-fast/).length).toBeGreaterThanOrEqual(2);
    expect(within(alerts).getByText(/Update the affected Groq model ID.*restart the API/i)).toBeInTheDocument();
    expect(within(alerts).getByRole("link", { name: "Open provider settings" })).toHaveAttribute("href", "/ai");
  });

  it("keeps the alert card quiet when there are no active alerts", () => {
    vi.mocked(useListOperatorAlerts).mockReturnValue({
      data: { alerts: [] },
      isLoading: false,
      error: null,
      isFetching: false,
      refetch: vi.fn(),
    } as ReturnType<typeof useListOperatorAlerts>);

    render(<Dashboard />);
    fireEvent.click(screen.getByTestId("summary-advanced-dashboard"));

    expect(screen.getByRole("region", { name: "Operator alerts" })).toHaveTextContent(
      "No active provider alerts",
    );
    expect(screen.queryByText("Groq Fast model is unavailable")).not.toBeInTheDocument();
  });

  it("keeps routine retention details collapsed until requested", () => {
    vi.mocked(useListOperatorAlerts).mockReturnValue({
      data: { alerts: [] },
      isLoading: false,
      error: null,
      isFetching: false,
      refetch: vi.fn(),
    } as ReturnType<typeof useListOperatorAlerts>);

    render(<Dashboard />);
    fireEvent.click(screen.getByTestId("summary-advanced-dashboard"));

    const diagnostics = screen.getByTestId("details-ai-diagnostics");
    expect(diagnostics).not.toHaveAttribute("open");
    expect(screen.getByTestId("status-ai-diagnostics")).toHaveTextContent("Healthy");
    expect(screen.getByText(/Last completed/)).not.toBeVisible();

    fireEvent.click(screen.getByTestId("summary-ai-diagnostics"));

    expect(diagnostics).toHaveAttribute("open");
    expect(screen.getByText(/Last completed/)).toBeVisible();
  });

  it("distinguishes a temporary catalog outage from retired-model drift", () => {
    vi.mocked(useListOperatorAlerts).mockReturnValue({
      data: {
        alerts: [{
          id: "alert-2",
          fingerprint: "groq_model_catalog_unavailable:groq:catalog",
          kind: "groq_model_catalog_unavailable",
          status: "open",
          provider: "groq",
          modelRole: "catalog",
          modelId: "catalog",
          title: "Groq model catalog temporarily unavailable",
          message: "Groq's live model catalog could not be checked. Configured defaults have not been marked as retired.",
          remediation: "Retry the catalog check after Groq recovers. Do not change model IDs based on this temporary status.",
          occurrenceCount: 3,
          firstSeenAt: "2026-08-30T12:00:00.000Z",
          lastSeenAt: "2026-08-30T12:05:00.000Z",
          resolvedAt: null,
        }],
      },
      isLoading: false,
      error: null,
      isFetching: false,
      refetch: vi.fn(),
    } as ReturnType<typeof useListOperatorAlerts>);

    render(<Dashboard />);
    fireEvent.click(screen.getByTestId("summary-advanced-dashboard"));

    const alerts = screen.getByRole("region", { name: "Operator alerts" });
    expect(within(alerts).getByText("Temporary outage")).toBeInTheDocument();
    expect(within(alerts).getByText(/have not been marked as retired/i)).toBeInTheDocument();
    expect(within(alerts).getByText("Scope: Groq model catalog")).toBeInTheDocument();
    expect(within(alerts).queryByText("Role: Powerful")).not.toBeInTheDocument();
  });
});