import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Dashboard from "./Dashboard";

vi.mock("wouter", () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
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
  taskStatusBreakdown: {},
  projectScores: [],
  recentEvents: [],
  freshnessRevision: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
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

    expect(screen.getByRole("region", { name: "Operator alerts" })).toHaveTextContent(
      "No active provider alerts",
    );
    expect(screen.queryByText("Groq Fast model is unavailable")).not.toBeInTheDocument();
  });
});