import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AiExecutionProjection, GetAiExecution200 } from "@workspace/api-client-react";
import WorkspaceExecutionDetail from "./WorkspaceExecutionDetail";

const mocks = vi.hoisted(() => ({
  query: {
    data: undefined as unknown,
    isLoading: false,
    isError: false,
    isFetching: false,
    error: undefined as unknown,
    refetch: vi.fn(),
  },
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetAiExecution: vi.fn(() => mocks.query),
}));

const projection = {
  schemaVersion: 2,
  kind: "DELIVERY",
  phase: "COMPLETE",
  objective: "مراجعة تنفيذ مرتبطة بالمشروع",
  progress: {
    percent: 100,
    label: "انتهى سجل التنفيذ",
    currentStep: null,
    completedSteps: 1,
    totalSteps: 1,
  },
  plan: { steps: [], currentStepId: null },
  tools: { totalCalls: 0, activeTool: null, recent: [] },
  workspace: { changedFiles: [], diffStatus: "not_available" },
  verification: { status: "passed", evidenceVerdict: "PROVEN", proofRequired: true },
  approval: { required: false, status: "NOT_REQUIRED", proposalId: null },
  stopped: { reason: null, outcome: "SUCCEEDED" },
  timeline: [],
  allowedActions: ["CANCEL", "APPROVE_CHANGES", "REVIEW_PROOF", "REVIEW_DIFF"],
} as unknown as AiExecutionProjection;

const execution = {
  id: "execution-1",
  correlationId: null,
  projectId: "project-1",
  attempt: 1,
  proposalId: "proposal-1",
  status: "completed",
  flightState: "COMPLETED",
  evidenceVerdict: "PROVEN",
  evidenceStatusProjection: {},
  proofRequired: true,
  checkpoint: {},
  checkpointVersion: 1,
  resumable: false,
  operationEvidence: {},
  executionDiagnostics: {},
  projection,
  worldTransitions: [],
} as unknown as GetAiExecution200;

function renderWorkspaceExecutionDetail() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <WorkspaceExecutionDetail executionId="execution-1" projectId="project-1" attempt={1} proposalId="proposal-1" />
    </QueryClientProvider>,
  );
}

describe("WorkspaceExecutionDetail", () => {
  it("renders the server projection read-only and filters decision or recovery actions", () => {
    mocks.query = {
      data: execution,
      isLoading: false,
      isError: false,
      isFetching: false,
      error: undefined,
      refetch: vi.fn(),
    };

    renderWorkspaceExecutionDetail();

    expect(screen.getByTestId("mission-capsule")).toBeInTheDocument();
    expect(screen.getByText("مراجعة تنفيذ مرتبطة بالمشروع")).toBeInTheDocument();
    expect(screen.getByTestId("toggle-proof")).toBeInTheDocument();
    expect(screen.queryByTestId("button-action-cancel")).not.toBeInTheDocument();
    expect(screen.queryByTestId("button-action-approve_changes")).not.toBeInTheDocument();
  });

  it("rejects an execution projection whose project identity does not match the Workspace", () => {
    mocks.query = {
      data: { ...execution, projectId: "another-project" },
      isLoading: false,
      isError: false,
      isFetching: false,
      error: undefined,
      refetch: vi.fn(),
    };

    renderWorkspaceExecutionDetail();

    expect(screen.getByText(
      "تعذر مطابقة تفاصيل التنفيذ مع المشروع أو المحاولة أو المرشح الحالي؛ لن نخلط بين إسقاطات مختلفة.",
    )).toBeInTheDocument();
    expect(screen.queryByTestId("mission-capsule")).not.toBeInTheDocument();
  });

  it("rejects a different execution attempt even when the execution ID is unchanged", () => {
    mocks.query = {
      data: { ...execution, attempt: 1 },
      isLoading: false,
      isError: false,
      isFetching: false,
      error: undefined,
      refetch: vi.fn(),
    };

    render(
      <WorkspaceExecutionDetail
        executionId="execution-1"
        projectId="project-1"
        attempt={2}
        proposalId="proposal-1"
      />,
    );

    expect(screen.getByText(
      "تعذر مطابقة تفاصيل التنفيذ مع المشروع أو المحاولة أو المرشح الحالي؛ لن نخلط بين إسقاطات مختلفة.",
    )).toBeInTheDocument();
    expect(screen.queryByTestId("mission-capsule")).not.toBeInTheDocument();
  });

  it("shows retry instead of treating an unavailable read as an empty execution", () => {
    const refetch = vi.fn();
    mocks.query = {
      data: undefined,
      isLoading: false,
      isError: true,
      isFetching: false,
      error: Object.assign(new Error("Forbidden"), { status: 403 }),
      refetch,
    };

    renderWorkspaceExecutionDetail();

    expect(screen.getByText("لا تملك صلاحية قراءة تفاصيل هذا التنفيذ.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "إعادة تحميل تفاصيل التنفيذ" })).toBeInTheDocument();
  });
});
