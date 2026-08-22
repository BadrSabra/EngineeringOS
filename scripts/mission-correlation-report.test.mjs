import test from "node:test";
import assert from "node:assert/strict";
import {
  assertSupportedMissionCorrelationReportVersion,
  buildMissionCorrelationReport,
  formatMissionCorrelationSummary,
  SUPPORTED_MISSION_CORRELATION_REPORT_VERSION,
} from "./mission-correlation-report.mjs";

test("keeps the mission correlation report version compatible with stored report readers", () => {
  const report = buildMissionCorrelationReport({
    projectId: "project",
    sessionId: "session",
    operationId: "operation",
    workspaceRevision: "abc1234",
    terminalState: "BLOCKED",
    execution: {
      id: "execution",
      projectId: "project",
      sessionId: "session",
      operationId: "operation",
      status: "failed",
    },
    messages: [{ executionId: "execution" }],
    sseEvents: [{ type: "error" }],
    checkpoints: [{ sequence: 1 }],
    dashboard: { executions: [{ id: "execution" }] },
  });

  assert.equal(SUPPORTED_MISSION_CORRELATION_REPORT_VERSION, 1);
  assert.equal(report.version, SUPPORTED_MISSION_CORRELATION_REPORT_VERSION);
  assert.equal(assertSupportedMissionCorrelationReportVersion(report), report);
});

test("formats a redacted release summary with evidence and validation counts", () => {
  assert.equal(
    formatMissionCorrelationSummary({
      terminalState: "COMPLETED",
      outcomeClass: "success",
      counts: { evidence: 2, validation: 3 },
    }),
    "Live mission correlation report: outcome=success terminal=COMPLETED evidence=2 validation=3.",
  );
});

test("labels non-success release terminals without exposing report contents", () => {
  assert.equal(
    formatMissionCorrelationSummary({
      terminalState: "UNAVAILABLE",
      outcomeClass: "non-success",
      counts: { evidence: 0, validation: 0 },
      prompt: "secret prompt",
      response: "secret model response",
    }),
    "Live mission correlation report: outcome=non-success terminal=UNAVAILABLE evidence=0 validation=0.",
  );
});

test("rejects incompatible mission correlation report versions with an upgrade action", () => {
  assert.throws(
    () =>
      assertSupportedMissionCorrelationReportVersion({
        kind: "mission-correlation-report",
        version: SUPPORTED_MISSION_CORRELATION_REPORT_VERSION + 1,
      }),
    {
      message:
        "Unsupported mission correlation report version: expected 1, got 2. " +
        "Update the report reader before changing the producer version.",
    },
  );
});

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

test("rejects a successful terminal without accepted evidence or validation", () => {
  const capture = {
    projectId: "project",
    sessionId: "session",
    operationId: "operation",
    workspaceRevision: "abc1234",
    terminalState: "COMPLETED",
    execution: {
      id: "execution",
      projectId: "project",
      sessionId: "session",
      operationId: "operation",
      status: "completed",
    },
    messages: [{ executionId: "execution" }],
    sseEvents: [{ type: "done" }],
    checkpoints: [{ sequence: 1 }],
    dashboard: { executions: [{ id: "execution" }] },
  };

  assert.throws(
    () => buildMissionCorrelationReport(capture, { requireEvidence: true }),
    /Evidence-backed success is incomplete: evidence=0, validation=0/,
  );
  assert.throws(
    () => buildMissionCorrelationReport({ ...capture, evidenceCount: 1 }, { requireEvidence: true }),
    /Evidence-backed success is incomplete: evidence=1, validation=0/,
  );
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

test("requires the redacted report identity, terminal, and core surfaces", () => {
  const requiredInputs = [
    ["operationId", { operationId: "" }],
    ["workspaceRevision", { workspaceRevision: "" }],
    ["projectId", { projectId: "" }],
    ["sessionId", { sessionId: "" }],
    ["terminalState", { terminalState: "" }],
  ];

  for (const [name, omission] of requiredInputs) {
    assert.throws(
      () =>
        buildMissionCorrelationReport({
          projectId: "project",
          sessionId: "session",
          operationId: "operation",
          workspaceRevision: "abc1234",
          terminalState: "BLOCKED",
          execution: {
            id: "execution",
            projectId: "project",
            sessionId: "session",
            status: "failed",
          },
          messages: [{ executionId: "execution" }],
          sseEvents: [{ type: "error" }],
          checkpoints: [{ sequence: 1 }],
          dashboard: { executions: [{ id: "execution" }] },
          ...omission,
        }),
      new RegExp(`missing ${name}`),
    );
  }

  assert.throws(
    () =>
      buildMissionCorrelationReport({
        projectId: "project",
        sessionId: "session",
        operationId: "operation",
        workspaceRevision: "abc1234",
        terminalState: "UNKNOWN",
      }),
    /Unknown mission terminal state: UNKNOWN/,
  );
});

test("names the missing core surface instead of accepting an incomplete report", () => {
  const completeCapture = {
    projectId: "project",
    sessionId: "session",
    operationId: "operation",
    workspaceRevision: "abc1234",
    terminalState: "BLOCKED",
    execution: {
      id: "execution",
      projectId: "project",
      sessionId: "session",
      status: "failed",
    },
    messages: [{ executionId: "execution" }],
    sseEvents: [{ type: "error" }],
    checkpoints: [{ sequence: 1 }],
    dashboard: { executions: [{ id: "execution" }] },
  };

  for (const [surface, incompleteCapture] of [
    [
      "execution",
      {
        ...completeCapture,
        execution: { ...completeCapture.execution, id: "" },
        messages: [{ role: "assistant" }],
      },
    ],
    ["messages", { ...completeCapture, messages: [] }],
    ["sse", { ...completeCapture, sseEvents: [] }],
    ["checkpoints", { ...completeCapture, checkpoints: [] }],
    ["dashboard", { ...completeCapture, dashboard: { executions: [] } }],
  ]) {
    assert.throws(
      () => buildMissionCorrelationReport(incompleteCapture),
      new RegExp(`missing the ${surface} surface`),
    );
  }
});

test("keeps every supported terminal explicit and classifies success terminals", () => {
  const terminalStates = [
    ["COMPLETED", "success"],
    ["READY_FOR_REVIEW", "success"],
    ["APPLIED", "success"],
    ["COMMITTED", "success"],
    ["PUSHED", "success"],
    ["BLOCKED", "non-success"],
    ["CANCELLED", "non-success"],
    ["FAILED", "non-success"],
    ["UNAVAILABLE", "non-success"],
  ];

  for (const [terminalState, outcomeClass] of terminalStates) {
    const report = buildMissionCorrelationReport({
      projectId: "project",
      sessionId: "session",
      operationId: "operation",
      workspaceRevision: "abc1234",
      terminalState,
      execution: {
        id: "execution",
        projectId: "project",
        sessionId: "session",
        status: outcomeClass === "success" ? "completed" : "failed",
      },
      messages: [{ executionId: "execution" }],
      sseEvents: [{ type: "done" }],
      checkpoints: [{ sequence: 1 }],
      evidenceCount: outcomeClass === "success" ? 1 : 0,
      validation: outcomeClass === "success" ? [{ status: "passed" }] : [],
      dashboard: { executions: [{ id: "execution" }] },
    });

    assert.equal(report.redacted, true);
    assert.equal(report.outcomeClass, outcomeClass);
    assert.equal(report.terminalState, terminalState);
    assert.deepEqual(
      Object.keys(report).sort(),
      [
        "agreement",
        "counts",
        "kind",
        "operationId",
        "outcomeClass",
        "projectId",
        "redacted",
        "sessionId",
        "terminalState",
        "version",
        "workspaceRevision",
      ].sort(),
    );
  }
});

test("strict live validation rejects success without evidence and validation", () => {
  assert.throws(
    () =>
      buildMissionCorrelationReport(
        {
          projectId: "project",
          sessionId: "session",
          operationId: "operation",
          workspaceRevision: "abc1234",
          terminalState: "COMPLETED",
          execution: {
            id: "execution",
            projectId: "project",
            sessionId: "session",
            operationId: "operation",
            status: "completed",
          },
          messages: [{ executionId: "execution" }],
          sseEvents: [{ type: "done" }],
          checkpoints: [{ sequence: 1 }],
          dashboard: { executions: [{ id: "execution" }] },
        },
        { requireEvidence: true },
      ),
    /Evidence-backed success is incomplete: evidence=0, validation=0/,
  );
});

test("strict live validation accepts completed evidence-backed missions", () => {
  const report = buildMissionCorrelationReport(
    {
      projectId: "project",
      sessionId: "session",
      operationId: "operation",
      workspaceRevision: "abc1234",
      terminalState: "COMPLETED",
      execution: {
        id: "execution",
        projectId: "project",
        sessionId: "session",
        operationId: "operation",
        status: "completed",
      },
      messages: [{ executionId: "execution" }],
      sseEvents: [{ type: "done" }],
      checkpoints: [{ sequence: 1 }],
      evidenceCount: 1,
      validation: [{ status: "passed" }],
      dashboard: { executions: [{ id: "execution" }] },
    },
    { requireEvidence: true },
  );

  assert.equal(report.outcomeClass, "success");
  assert.equal(report.agreement.evidence, true);
  assert.equal(report.agreement.validation, true);
});