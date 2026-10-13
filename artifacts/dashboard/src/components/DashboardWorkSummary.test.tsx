import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { userState } = vi.hoisted(() => ({
  userState: { user: { id: "owner-a" } as { id: string } | null, isLoaded: true },
}));
vi.mock("@clerk/react", () => ({ useUser: () => userState }));
vi.mock("wouter", () => ({
  Link: ({ href, children, className, "data-testid": t }: { href: string; children: React.ReactNode; className?: string; "data-testid"?: string }) => (
    <a href={href} className={className} data-testid={t}>{children}</a>
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
    expect(within(screen.getByTestId("section-work-decisions")).getByText("وافق على الخطة")).toBeInTheDocument();
    expect(within(screen.getByTestId("section-work-active")).getByText("إصلاح البحث")).toBeInTheDocument();
    const recent = screen.getByTestId("section-work-recent");
    expect(within(recent).queryByText("إصلاح البحث")).toBeNull();
    expect(screen.getByTestId("status-work-item-r1")).toHaveTextContent("مسجّلة كمنتهية");
    expect(document.body.textContent).not.toMatch(/تم التحقق|سُلّمت بنجاح|verified/i);
    expect(screen.queryByRole("button", { name: /موافق|تشغيل|أعد المحاولة/ })).toBeNull();
  });

  it("links to item href and shows partial coverage without totals", () => {
    mockQuery({ data: { ...summary, coverage: { ...coverage, partial: true, excludedExecutionCount: 3 } } });
    render(<DashboardWorkSummary />);
    expect(screen.getByTestId("link-work-item-mission-d1")).toHaveAttribute("href", "/missions/d1");
    const cov = screen.getByTestId("text-work-coverage");
    expect(cov).toHaveTextContent("عرض جزئي");
    expect(cov).toHaveTextContent("ليس عددًا كليًا");
    expect(cov).toHaveTextContent("3");
  });

  it("shows an error distinct from empty, and retry only rereads", () => {
    mockQuery({ error: new Error("down") });
    render(<DashboardWorkSummary />);
    expect(screen.getByTestId("status-work-overview-error")).toHaveTextContent("لا يعني أنه لا يوجد عمل");
    expect(screen.queryByTestId("status-work-overview-empty")).toBeNull();
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
