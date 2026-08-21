import test from "node:test";
import assert from "node:assert/strict";
import { buildMissionCorrelationReport } from "./mission-correlation-report.mjs";

test("correlates every mission surface by operation and workspace revision", () => {
  const report = buildMissionCorrelationReport({
    projectId: "project",
    sessionId: "session",
    operationId: "operation",
    workspaceRevision: "abc1234",
    execution: {
      id: "execution",
      projectId: "project",
      sessionId: "session",
      operationId: "operation",
      status: "completed",
      flightState: "COMPLETED",
    },
    messages: [{ executionId: "execution" }],
    sseEvents: [{ type: "done" }],
    checkpoints: [{ sequence: 1 }],
    evidenceCount: 2,
    proposals: [{ id: "proposal" }],
    validation: [{ status: "passed" }],
    events: [{ correlationId: "operation" }],
    dashboard: {
      executions: [{
        id: "execution",
        projectId: "project",
        executionStatus: "completed",
      }],
    },
  });

  assert.equal(report.redacted, true);
  assert.equal(report.workspaceRevision, "abc1234");
  assert.equal(report.outcomeClass, "success");
  assert.ok(Object.values(report.agreement).every(Boolean));
});

test("records provider failover and unavailable runs as non-success terminals", () => {
  const report = buildMissionCorrelationReport({
    projectId: "project",
    sessionId: "session",
    operationId: "operation",
    workspaceRevision: "abc1234",
    terminalState: "UNAVAILABLE",
    execution: {
      id: "execution",
      projectId: "project",
      sessionId: "session",
      operationId: "operation",
      status: "failed",
      flightState: "UNAVAILABLE",
    },
    messages: [{ executionId: "execution" }],
    sseEvents: [{ type: "error", code: "PROVIDER_UNAVAILABLE" }],
    checkpoints: [{ sequence: 1, stage: "failed" }],
    events: [{ correlationId: "operation" }],
    dashboard: { executions: [{ id: "execution", executionStatus: "failed" }] },
  });

  assert.equal(report.outcomeClass, "non-success");
  assert.equal(report.terminalState, "UNAVAILABLE");
});