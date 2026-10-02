import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkpointAiExecution: vi.fn(),
  claimAiExecution: vi.fn(),
  completeAiExecution: vi.fn(),
  createAiExecution: vi.fn(),
  createAutonomousOperationContract: vi.fn(),
  failAiExecution: vi.fn(),
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
    mocks.transitionAutonomousOperation.mockImplementation((operation, state) => ({
      ...operation,
      state,
    }));
    mocks.completeAiExecution.mockResolvedValue(true);
  });

  it("records local phase completion without creating canonical proof evidence", async () => {
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

    expect(result.status).toBe("completed");
    expect(mocks.createAiExecution).toHaveBeenCalledWith(expect.objectContaining({
      request: expect.objectContaining({ proofRequired: false }),
    }));

    const completion = mocks.completeAiExecution.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(completion).not.toHaveProperty("evidenceVerdict");
    expect(completion).not.toHaveProperty("proofRequired");
    const operation = completion.operation as {
      state: string;
      nodes: Array<{ id: string; title: string; status: string; evidenceRefs: string[] }>;
    };
    expect(operation).toMatchObject({
      state: "succeeded",
      nodes: [{
        id: "workflow-phase:test:boundary",
        status: "passed",
        evidenceRefs: [],
      }],
    });
    expect(operation.nodes.map((node) => node.title)).not.toContain("Run the test suite");
  });
});