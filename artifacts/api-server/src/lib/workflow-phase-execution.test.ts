import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkpointAiExecution: vi.fn(),
  claimAiExecution: vi.fn(),
  completeAiExecution: vi.fn(),
  createAiExecution: vi.fn(),
  createAutonomousOperationContract: vi.fn(),
  failAiExecution: vi.fn(),
  hasSuccessfulAiExecutionAcceptance: vi.fn(),
  parseAiExecutionCheckpoint: vi.fn(),
  transitionAutonomousOperation: vi.fn(),
}));

vi.mock("./ai-execution-state.js", () => mocks);

import { executeWorkflowPhase } from "./workflow-phase-execution.js";

describe("executeWorkflowPhase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createAiExecution.mockResolvedValue({
      created: true,
      execution: {
        id: "execution-1",
        operationId: "operation-1",
        status: "queued",
        checkpoint: null,
        checkpointVersion: 0,
      },
    });
    mocks.parseAiExecutionCheckpoint.mockReturnValue(null);
    mocks.createAutonomousOperationContract.mockImplementation((input) => ({
      operationId: input.operationId,
      objective: input.objective,
      nodes: input.nodes,
      state: "planned",
      updatedAt: new Date().toISOString(),
    }));
    mocks.claimAiExecution.mockResolvedValue({ id: "execution-1", attempt: 1 });
    mocks.checkpointAiExecution.mockResolvedValue(true);
    mocks.hasSuccessfulAiExecutionAcceptance.mockResolvedValue(false);
    mocks.transitionAutonomousOperation.mockImplementation((operation, state) => ({
      ...operation,
      state,
    }));
    mocks.completeAiExecution.mockResolvedValue(true);
  });

  it("records an empty workflow phase as a no-op without Goal proof projection", async () => {
    const result = await executeWorkflowPhase({
      userId: "user-1",
      projectId: "project-1",
      workflowId: "workflow-1",
      workflowExecutionId: "workflow-execution-1",
      workflowName: "Example",
      phaseName: "test",
      phaseSteps: [],
      revision: "revision-1",
      completedPhaseNames: [],
      goalId: "goal-1",
      isFinalPhase: true,
    });

    expect(result.status).toBe("completed");
    expect(mocks.createAiExecution).toHaveBeenCalledWith(expect.objectContaining({
      request: expect.objectContaining({ proofRequired: false }),
    }));

    const completion = mocks.completeAiExecution.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(completion).not.toHaveProperty("operation");
    expect(completion).not.toHaveProperty("nodeStates");
    expect(completion).not.toHaveProperty("goalProjection");
    expect(completion).not.toHaveProperty("evidenceVerdict");
    expect(completion).not.toHaveProperty("proofRequired");
    expect(mocks.createAutonomousOperationContract).not.toHaveBeenCalled();
    expect(mocks.transitionAutonomousOperation).not.toHaveBeenCalled();
  });

  it("does not report completion or write a stale failure after losing the terminal fence", async () => {
    mocks.completeAiExecution.mockResolvedValue(false);

    const result = await executeWorkflowPhase({
      userId: "user-1",
      projectId: "project-1",
      workflowId: "workflow-1",
      workflowExecutionId: "workflow-execution-1",
      workflowName: "Example",
      phaseName: "test",
      phaseSteps: ["Run the test suite"],
      revision: "revision-1",
      completedPhaseNames: [],
      rootPath: "/tmp",
    });

    expect(result).toMatchObject({
      executionId: "execution-1",
      status: "failed",
    });
    expect(mocks.completeAiExecution).toHaveBeenCalledOnce();
    expect(mocks.failAiExecution).not.toHaveBeenCalled();
  });

  it("records a terminal failure when workflow acceptance throws after local success", async () => {
    mocks.completeAiExecution.mockRejectedValueOnce(new Error("fixture_goal_projection_transaction_failed"));

    const result = await executeWorkflowPhase({
      userId: "user-1",
      projectId: "project-1",
      workflowId: "workflow-1",
      workflowExecutionId: "workflow-execution-1",
      workflowName: "Example",
      phaseName: "prepare",
      phaseSteps: ["Run the declared workflow work"],
      revision: "revision-1",
      completedPhaseNames: [],
      goalId: "goal-1",
      isFinalPhase: false,
    });

    expect(result).toMatchObject({
      executionId: "execution-1",
      status: "failed",
    });
    expect(mocks.failAiExecution).toHaveBeenCalledOnce();
    expect(mocks.failAiExecution).toHaveBeenCalledWith(expect.objectContaining({
      operation: expect.objectContaining({ state: "failed" }),
      goalProjection: expect.objectContaining({
        goalId: "goal-1",
        workflowId: "workflow-1",
        workflowExecutionId: "workflow-execution-1",
        phase: "prepare",
        finalPhase: false,
      }),
    }));
  });

  it("reports committed success when the acceptance response is lost", async () => {
    mocks.completeAiExecution.mockRejectedValueOnce(new Error("fixture_response_lost_after_commit"));
    mocks.hasSuccessfulAiExecutionAcceptance.mockResolvedValueOnce(true);

    const result = await executeWorkflowPhase({
      userId: "user-1",
      projectId: "project-1",
      workflowId: "workflow-1",
      workflowExecutionId: "workflow-execution-1",
      workflowName: "Example",
      phaseName: "prepare",
      phaseSteps: [],
      revision: "revision-1",
      completedPhaseNames: [],
    });

    expect(result).toMatchObject({
      executionId: "execution-1",
      operationId: "operation-1",
      created: true,
      status: "completed",
    });
    expect(mocks.hasSuccessfulAiExecutionAcceptance).toHaveBeenCalledWith({
      executionId: "execution-1",
      attempt: 1,
      operationId: "operation-1",
    });
    expect(mocks.failAiExecution).not.toHaveBeenCalled();
  });
});