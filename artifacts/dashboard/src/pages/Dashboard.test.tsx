import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Dashboard from "./Dashboard";
import { readGoalDrafts } from "../lib/home-goal-handoff";
vi.mock('@clerk/react', () => ({ useUser: () => ({ user: { id: 'user-1' } }) }));

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
  getListProjectsQueryKey: vi.fn(() => ["/api/projects"]),
  useGetDashboard: vi.fn(),
  useGetHealth: vi.fn(),
  useListOperatorAlerts: vi.fn(),
  useListProjects: vi.fn(),
  getGetDashboardWorkSummaryQueryKey: vi.fn(() => ["/api/dashboard/work-summary"]),
  useGetDashboardWorkSummary: vi.fn(() => ({ data: undefined, isLoading: true, error: null, isFetching: true, refetch: vi.fn() })),
}));

import {
  useGetDashboard,
  useGetHealth,
  useListOperatorAlerts,
  useListProjects,
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
  vi.mocked(useListProjects).mockReturnValue({
    data: [{ id: 'project-1', name: 'بوابة العملاء', status: 'active', ownerId: 'user-1' }],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  } as ReturnType<typeof useListProjects>);
});

describe("Dashboard goal-first home", () => {
  it("shows a unique project suggestion and requires an explicit scope choice before handoff", () => {
    vi.mocked(useListOperatorAlerts).mockReturnValue({
      data: { alerts: [] },
      isLoading: false,
      error: null,
      isFetching: false,
      refetch: vi.fn(),
    } as ReturnType<typeof useListOperatorAlerts>);

    render(<Dashboard />);

    fireEvent.change(screen.getByTestId("input-home-goal"), {
      target: { value: "ساعدني أفهم سبب بطء صفحة تسجيل الدخول في مشروع بوابة العملاء" },
    });
    fireEvent.click(screen.getByTestId("button-start-goal"));

    expect(mockSetLocation).not.toHaveBeenCalled();
    expect(screen.getByTestId("text-goal-project-suggestion")).toHaveTextContent("بوابة العملاء");
    expect(readGoalDrafts("user-1").drafts).toHaveLength(0);
    fireEvent.click(screen.getByTestId("button-route-goal-suggested-project"));

    const [draft] = readGoalDrafts('user-1').drafts;
    expect(draft.text).toBe("ساعدني أفهم سبب بطء صفحة تسجيل الدخول في مشروع بوابة العملاء");
    expect(draft.sendAttemptedAt).toBeNull();
    expect(draft.projectId).toBe('project-1');
    expect(mockSetLocation).toHaveBeenCalledWith(`/ai?projectId=project-1&goalDraftId=${draft.id}`);
    expect(screen.getByText(/لن يُرسل النص تلقائيًا/)).toBeInTheDocument();
    expect(screen.queryByTestId('panel-goal-destination')).not.toBeInTheDocument();
  });

  it('waits for project names before showing a suggestion and never routes while they load', () => {
    vi.mocked(useListProjects).mockReturnValue({
      data: undefined, isLoading: true, isError: false, refetch: vi.fn(),
    } as ReturnType<typeof useListProjects>);
    const view = render(<Dashboard />);
    fireEvent.change(screen.getByTestId('input-home-goal'), {
      target: { value: 'راجع الأداء في مشروع بوابة العملاء' },
    });
    fireEvent.click(screen.getByTestId('button-start-goal'));

    expect(mockSetLocation).not.toHaveBeenCalled();
    expect(screen.getByTestId('panel-goal-destination')).toHaveTextContent('نحمّل قائمة المشاريع');
    expect(readGoalDrafts('user-1').drafts).toHaveLength(0);

    vi.mocked(useListProjects).mockReturnValue({
      data: [{ id: 'project-1', name: 'بوابة العملاء', status: 'active', ownerId: 'user-1' }],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as ReturnType<typeof useListProjects>);
    view.rerender(<Dashboard />);

    expect(screen.getByTestId('text-goal-project-suggestion')).toHaveTextContent('بوابة العملاء');
    expect(mockSetLocation).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('button-route-goal-suggested-project'));

    const [draft] = readGoalDrafts('user-1').drafts;
    expect(draft.projectId).toBe('project-1');
    expect(mockSetLocation).toHaveBeenCalledWith(`/ai?projectId=project-1&goalDraftId=${draft.id}`);
  });

  it('preserves a zero-project goal only after the user chooses to create a project', () => {
    vi.mocked(useListProjects).mockReturnValue({
      data: [], isLoading: false, isError: false, refetch: vi.fn(),
    } as ReturnType<typeof useListProjects>);
    vi.mocked(useGetDashboard).mockReturnValue({
      data: { ...dashboard, projectCount: 0 }, isLoading: false, error: null, refetch: vi.fn(),
    } as ReturnType<typeof useGetDashboard>);
    render(<Dashboard />);
    fireEvent.change(screen.getByTestId('input-home-goal'), { target: { value: 'أريد تطبيق متابعة العملاء' } });
    fireEvent.click(screen.getByTestId('button-start-goal'));

    expect(mockSetLocation).not.toHaveBeenCalled();
    expect(readGoalDrafts('user-1').drafts).toHaveLength(0);
    fireEvent.click(screen.getByTestId('button-route-goal-project'));

    const [draft] = readGoalDrafts('user-1').drafts;
    expect(mockSetLocation).toHaveBeenCalledWith(`/projects?create=1&goalDraftId=${draft.id}`);
    expect(draft.text).toBe('أريد تطبيق متابعة العملاء');
    expect(draft.projectId).toBeNull();
  });

  it('asks for a destination when no project name is present, then routes an explicit general choice', () => {
    render(<Dashboard />);
    fireEvent.change(screen.getByTestId('input-home-goal'), { target: { value: 'اشرح لي خيارات التخزين المؤقت' } });
    fireEvent.click(screen.getByTestId('button-start-goal'));

    expect(mockSetLocation).not.toHaveBeenCalled();
    expect(screen.getByTestId('panel-goal-destination')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('button-route-goal-general'));

    const [draft] = readGoalDrafts('user-1').drafts;
    expect(draft).toMatchObject({ text: 'اشرح لي خيارات التخزين المؤقت', projectId: null, sendAttemptedAt: null });
    expect(mockSetLocation).toHaveBeenCalledWith(`/general-chat?goalDraftId=${draft.id}`);
  });

  it('does not convert a failed project lookup into a general-chat handoff without an explicit choice', () => {
    vi.mocked(useListProjects).mockReturnValue({
      data: [], isLoading: false, isError: true, refetch: vi.fn(),
    } as ReturnType<typeof useListProjects>);
    render(<Dashboard />);
    fireEvent.change(screen.getByTestId('input-home-goal'), { target: { value: 'افحص مشروعي' } });
    fireEvent.click(screen.getByTestId('button-start-goal'));

    expect(mockSetLocation).not.toHaveBeenCalled();
    expect(screen.getByTestId('panel-goal-destination')).toHaveTextContent('تعذر تحميل قائمة المشاريع');
    expect(screen.queryByTestId('button-route-goal-project')).not.toBeInTheDocument();
    expect(readGoalDrafts('user-1').drafts).toHaveLength(0);

    fireEvent.click(screen.getByTestId('button-route-goal-general'));
    const [draft] = readGoalDrafts('user-1').drafts;
    expect(draft.projectId).toBeNull();
    expect(mockSetLocation).toHaveBeenCalledWith(`/general-chat?goalDraftId=${draft.id}`);
  });

  it('requires an explicit project selection when the goal does not name the only project', () => {
    render(<Dashboard />);
    fireEvent.change(screen.getByTestId('input-home-goal'), { target: { value: 'ساعدني على فهم التخزين المؤقت' } });
    fireEvent.click(screen.getByTestId('button-start-goal'));

    expect(mockSetLocation).not.toHaveBeenCalled();
    expect(screen.getByTestId('panel-goal-destination')).toHaveTextContent('حدد المشروع الذي تريد العمل ضمنه');
    expect(screen.getByTestId('button-route-goal-project')).toBeDisabled();
    expect(readGoalDrafts('user-1').drafts).toHaveLength(0);

    fireEvent.change(screen.getByTestId('select-goal-project'), { target: { value: 'project-1' } });
    fireEvent.click(screen.getByTestId('button-route-goal-project'));

    const [draft] = readGoalDrafts('user-1').drafts;
    expect(draft.projectId).toBe('project-1');
    expect(mockSetLocation).toHaveBeenCalledWith(`/ai?projectId=project-1&goalDraftId=${draft.id}`);
  });

  it('keeps multiple project matches ambiguous until the user selects one exact project', () => {
    vi.mocked(useListProjects).mockReturnValue({
      data: [
        { id: 'project-1', name: 'بوابة العملاء', status: 'active', ownerId: 'user-1' },
        { id: 'project-2', name: 'لوحة الإدارة', status: 'active', ownerId: 'user-1' },
      ],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as ReturnType<typeof useListProjects>);
    render(<Dashboard />);
    fireEvent.change(screen.getByTestId('input-home-goal'), {
      target: { value: 'قارن بوابة العملاء مع لوحة الإدارة' },
    });
    fireEvent.click(screen.getByTestId('button-start-goal'));

    expect(screen.getByTestId('panel-goal-destination')).toHaveTextContent('اختر المشروع المقصود؛ ظهر أكثر من احتمال');
    expect(mockSetLocation).not.toHaveBeenCalled();
    expect(readGoalDrafts('user-1').drafts).toHaveLength(0);

    fireEvent.change(screen.getByTestId('select-goal-project'), { target: { value: 'project-2' } });
    fireEvent.click(screen.getByTestId('button-route-goal-project'));
    const [draft] = readGoalDrafts('user-1').drafts;
    expect(draft.projectId).toBe('project-2');
    expect(mockSetLocation).toHaveBeenCalledWith(`/ai?projectId=project-2&goalDraftId=${draft.id}`);
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

  it("does not show stale counters when the dashboard request fails", () => {
    vi.mocked(useGetDashboard).mockReturnValue({
      data: dashboard,
      isLoading: false,
      error: new Error("Dashboard API unavailable"),
      refetch: vi.fn(),
      isRefetching: false,
      dataUpdatedAt: Date.now(),
    } as ReturnType<typeof useGetDashboard>);

    vi.mocked(useListOperatorAlerts).mockReturnValue({
      data: { alerts: [] },
      isLoading: false,
      error: null,
      isFetching: false,
      refetch: vi.fn(),
    } as ReturnType<typeof useListOperatorAlerts>);

    render(<Dashboard />);

    expect(screen.getByRole("alert")).toHaveTextContent("تعذر تحميل مساحة العمل");
    expect(screen.queryByTestId("section-home-work-summary")).not.toBeInTheDocument();
    expect(screen.queryByTestId("section-home-recent-activity")).not.toBeInTheDocument();
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