import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { userState } = vi.hoisted(() => ({
  userState: { user: { id: "owner-a" } as { id: string } | null, isLoaded: true },
}));
vi.mock("@clerk/react", () => ({ useUser: () => userState }));
vi.mock("wouter", () => ({
  Link: ({ href, children, className, "data-testid": t, "aria-label": ariaLabel }: { href: string; children: React.ReactNode; className?: string; "data-testid"?: string; "aria-label"?: string }) => (
    <a href={href} className={className} data-testid={t} aria-label={ariaLabel}>{children}</a>
  ),
}));
vi.mock("@workspace/api-client-react", () => ({
  getGetDashboardWorkSummaryQueryKey: vi.fn(() => ["/api/dashboard/work-summary"]),
  useGetDashboardWorkSummary: vi.fn(),
}));

import { useGetDashboardWorkSummary } from "@workspace/api-client-react";
import DashboardWorkSummary from "./DashboardWorkSummary";

const item = (over: Record<string, unknown>) => ({
  kind: "task", id: "t1", projectId: "p1", projectName: "متجر الورد", title: "مهمة",
  status: "running", updatedAt: "2026-08-30T12:00:00.000Z", href: "/tasks/t1",
  planBinding: "current_plan", stateBasis: "recorded_only", attempt: null, ...over,
});
const coverage = { partial: false, sectionLimit: 5, sourceLimit: 50, goalsTruncated: false, excludedExecutionCount: 0, totalCountAvailable: false, verification: "not_revalidated" };
const summary = {
  observedAt: "2026-08-30T12:05:00.000Z",
  decisions: [item({ id: "d1", title: "وافق على الخطة", status: "waiting", href: "/missions/d1", kind: "mission" })],
  active: [item({ id: "a1", title: "إصلاح البحث" })],
  recent: [item({ id: "r1", title: "تحسين الدخول", status: "completed", attempt: 2 })],
  coverage,
};
const refetch = vi.fn();
function mockQuery(over: Record<string, unknown>) {
  vi.mocked(useGetDashboardWorkSummary).mockReturnValue({ data: undefined, isLoading: false, error: null, isFetching: false, refetch, ...over } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  userState.user = { id: "owner-a" };
  userState.isLoaded = true;
});

describe("DashboardWorkSummary", () => {
  it("says bounded view, not no work, when empty but partial", () => {
    mockQuery({ data: { ...summary, decisions: [], active: [], recent: [], coverage: { ...coverage, partial: true } } });
    render(<DashboardWorkSummary />);
    expect(screen.getByTestId("text-work-empty-bounded")).toHaveTextContent("ضمن هذا العرض المحدود");
    expect(screen.queryByTestId("link-start-goal-from-empty-summary")).not.toBeInTheDocument();
    expect(screen.getByTestId("link-work-empty-tasks")).toHaveAttribute("href", "/tasks");
    expect(screen.getByTestId("link-work-empty-projects")).toHaveAttribute("href", "/projects");
    expect(screen.queryByTestId("link-work-coverage-tasks")).not.toBeInTheDocument();
  });

  it("links a complete empty summary directly to the goal input", () => {
    mockQuery({ data: { ...summary, decisions: [], active: [], recent: [] } });
    render(<DashboardWorkSummary />);

    expect(screen.getByTestId("status-work-overview-empty")).toHaveTextContent(
      "لا توجد عناصر مسجّلة لعرضها الآن",
    );
    expect(screen.queryByTestId("link-work-empty-tasks")).not.toBeInTheDocument();
    expect(screen.queryByTestId("link-work-coverage-tasks")).not.toBeInTheDocument();
    expect(screen.getByTestId("link-start-goal-from-empty-summary")).toHaveAttribute(
      "href",
      "#home-goal-draft",
    );
  });

  it("maps unknown statuses generically", () => {
    mockQuery({ data: { ...summary, active: [item({ id: "x", status: "approved_magic" })] } });
    render(<DashboardWorkSummary />);
    expect(screen.getByTestId("status-work-item-x")).toHaveTextContent("غير معروفة");
    expect(screen.getByTestId("status-work-item-x")).not.toHaveTextContent("approved");
  });

  it("separates sections and labels completion as recorded, not proof", () => {
    mockQuery({ data: summary });
    render(<DashboardWorkSummary />);
    expect(within(screen.getByTestId("section-featured-work")).getByText("وافق على الخطة")).toBeInTheDocument();
    expect(within(screen.getByTestId("section-work-decisions")).queryByText("وافق على الخطة")).toBeNull();
    expect(within(screen.getByTestId("section-work-active")).getByText("إصلاح البحث")).toBeInTheDocument();
    const recent = screen.getByTestId("section-work-recent");
    expect(within(recent).queryByText("إصلاح البحث")).toBeNull();
    expect(screen.getByTestId("status-work-item-r1")).toHaveTextContent("مسجّلة كمنتهية");
    expect(document.body.textContent).not.toMatch(/تم التحقق|سُلّمت بنجاح|verified/i);
    expect(screen.queryByRole("button", { name: /موافق|تشغيل|أعد المحاولة/ })).toBeNull();
  });

  it("puts the newest review item first and removes only that duplicate from its section", () => {
    mockQuery({
      data: {
        ...summary,
        decisions: [
          item({ id: "d1", title: "راجع نتيجة البحث", status: "waiting", href: "/missions/d1", kind: "mission", updatedAt: "2026-08-30T12:04:00.000Z" }),
          item({ id: "d2", title: "راجع إعدادات المشروع", status: "blocked", href: "/tasks/d2" }),
        ],
        active: [item({ id: "a1", title: "إصلاح البحث", updatedAt: "2026-08-30T12:10:00.000Z" })],
      },
    });
    render(<DashboardWorkSummary />);

    const featured = screen.getByTestId("section-featured-work");
    expect(within(featured).getByText("راجع نتيجة البحث")).toBeInTheDocument();
    expect(within(featured).getByRole("link", { name: "اعرف ما يلزم: راجع نتيجة البحث" })).toHaveAttribute(
      "href",
      "/missions/d1",
    );
    expect(within(screen.getByTestId("section-work-decisions")).queryByText("راجع نتيجة البحث")).toBeNull();
    expect(within(screen.getByTestId("section-work-decisions")).getByText("راجع إعدادات المشروع")).toBeInTheDocument();
    expect(within(screen.getByTestId("section-work-active")).getByText("إصلاح البحث")).toBeInTheDocument();
    expect(featured).toHaveTextContent("ليس تحققًا من الإنجاز");
  });

  it("falls back to current work when nothing needs review", () => {
    mockQuery({
      data: {
        ...summary,
        decisions: [],
        active: [item({ id: "a1", title: "إصلاح البحث", href: "/tasks/a1" })],
      },
    });
    render(<DashboardWorkSummary />);

    const featured = screen.getByTestId("section-featured-work");
    expect(featured).toHaveTextContent("لا يوجد عنصر يحتاج مراجعتك");
    expect(within(featured).getByRole("link", { name: "تابع التقدم: إصلاح البحث" })).toHaveAttribute(
      "href",
      "/tasks/a1",
    );
    expect(within(screen.getByTestId("section-work-active")).queryByText("إصلاح البحث")).toBeNull();
  });

  it("does not turn recent history into a suggested next step", () => {
    mockQuery({ data: { ...summary, decisions: [], active: [] } });
    render(<DashboardWorkSummary />);

    expect(screen.queryByTestId("section-featured-work")).toBeNull();
    expect(within(screen.getByTestId("section-work-recent")).getByText("تحسين الدخول")).toBeInTheDocument();
    expect(screen.getByTestId("status-work-item-r1")).toHaveTextContent("مسجّلة كمنتهية");
  });

  it("links to item href and shows partial coverage without totals", () => {
    mockQuery({ data: { ...summary, coverage: { ...coverage, partial: true, excludedExecutionCount: 3 } } });
    render(<DashboardWorkSummary />);
    expect(screen.getByTestId("link-work-item-mission-d1")).toHaveAttribute("href", "/missions/d1");
    const cov = screen.getByTestId("text-work-coverage");
    expect(cov).toHaveTextContent("عرض جزئي");
    expect(cov).toHaveTextContent("ليس عددًا كليًا");
    expect(cov).toHaveTextContent("3");
    expect(screen.getByTestId("link-work-coverage-tasks")).toHaveAttribute("href", "/tasks");
    expect(screen.getByTestId("link-work-coverage-projects")).toHaveAttribute("href", "/projects");
    expect(screen.queryByTestId("link-work-empty-tasks")).not.toBeInTheDocument();
  });

  it("shows a useful next step for each section while preserving the detail destinations", () => {
    mockQuery({ data: summary });
    render(<DashboardWorkSummary />);

    expect(screen.getByTestId("text-work-item-action-d1")).toHaveTextContent("اعرف ما يلزم");
    expect(screen.getByTestId("link-work-item-mission-d1")).toHaveAccessibleName("اعرف ما يلزم: وافق على الخطة");
    expect(screen.getByTestId("text-work-item-action-a1")).toHaveTextContent("تابع التقدم");
    expect(screen.getByTestId("link-work-item-task-a1")).toHaveAccessibleName("تابع التقدم: إصلاح البحث");
    expect(screen.getByTestId("text-work-item-action-r1")).toHaveTextContent("راجع السجل");
    expect(screen.getByTestId("link-work-item-task-r1")).toHaveAccessibleName("راجع السجل: تحسين الدخول");
    expect(screen.getByTestId("link-work-item-mission-d1")).toHaveAttribute("href", "/missions/d1");
    expect(screen.getByTestId("link-work-item-task-a1")).toHaveAttribute("href", "/tasks/t1");
    expect(screen.getByTestId("link-work-item-task-r1")).toHaveAttribute("href", "/tasks/t1");
    expect(screen.queryByRole("button", { name: /اعرف ما يلزم|تابع التقدم|راجع السجل/ })).toBeNull();
  });

  it("shows an error distinct from empty, and retry only rereads", () => {
    mockQuery({ error: new Error("down") });
    render(<DashboardWorkSummary />);
    expect(screen.getByTestId("status-work-overview-error")).toHaveTextContent("لا يعني أنه لا يوجد عمل");
    expect(screen.queryByTestId("status-work-overview-empty")).toBeNull();
    expect(screen.queryByTestId("link-start-goal-from-empty-summary")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("button-retry-work-overview"));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("replaces old cards when an empty response arrives", () => {
    mockQuery({ data: summary });
    const { rerender } = render(<DashboardWorkSummary />);
    expect(screen.getByText("إصلاح البحث")).toBeInTheDocument();
    mockQuery({ data: { ...summary, decisions: [], active: [], recent: [] } });
    rerender(<DashboardWorkSummary />);
    expect(screen.queryByText("إصلاح البحث")).toBeNull();
    expect(screen.getByTestId("status-work-overview-empty")).toBeInTheDocument();
  });

  it("scopes the query by owner and waits for the user", () => {
    mockQuery({ isLoading: true });
    userState.isLoaded = false;
    userState.user = null;
    const { rerender } = render(<DashboardWorkSummary />);
    let opts = vi.mocked(useGetDashboardWorkSummary).mock.calls.at(-1)![0]!.query!;
    expect(opts.enabled).toBe(false);
    expect(screen.getByTestId("status-work-overview-loading")).toBeInTheDocument();
    userState.isLoaded = true;
    userState.user = { id: "owner-b" };
    rerender(<DashboardWorkSummary />);
    opts = vi.mocked(useGetDashboardWorkSummary).mock.calls.at(-1)![0]!.query!;
    expect(opts.enabled).toBe(true);
    expect(opts.queryKey).toEqual(["/api/dashboard/work-summary", { owner: "owner-b" }]);
    expect(opts.refetchInterval).toBe(30_000);
    expect(opts.staleTime).toBe(30_000);
  });
});
