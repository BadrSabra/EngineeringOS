import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  assertSupportedMissionCorrelationReportVersion,
  buildMissionCorrelationReport,
  formatMissionCorrelationSummary,
  parseMissionCorrelationReportOutput,
  SUPPORTED_MISSION_CORRELATION_REPORT_VERSION,
} from "./mission-correlation-report.mjs";

const reportScript = resolve(import.meta.dirname, "mission-correlation-report.mjs");

function representativeCapture(terminalState) {
  const success = terminalState === "COMPLETED";
  return {
    projectId: "project",
    sessionId: "session",
    operationId: "operation",
    workspaceRevision: "abc1234",
    terminalState,
    execution: {
      id: "execution",
      projectId: "project",
      sessionId: "session",
      operationId: "operation",
      status: success ? "completed" : "failed",
    },
    messages: [{ executionId: "execution", role: "assistant" }],
    sseEvents: [{ type: success ? "done" : "error" }],
    checkpoints: [{ sequence: 1 }],
    evidenceCount: success ? 2 : 0,
    validation: success ? [{ status: "passed" }] : [],
    dashboard: {
      executions: [{
        id: "execution",
        projectId: "project",
        executionStatus: success ? "completed" : "failed",
      }],
    },
  };
}

function runReportValidator(capturePath) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [reportScript, capturePath], {
      env: {
        ...process.env,
        MISSION_CORRELATION_REQUIRE_EVIDENCE: "1",
        GROQ_API_KEY: "provider-secret-that-must-not-leak",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (signal || code !== 0) {
        reject(new Error(`Report validator failed with ${signal ?? code}: ${stderr}`));
      } else {
        resolveRun({ stdout, stderr });
      }
    });
  });
}

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

test("validates child-process release output and keeps the emitted summary redacted", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "mission-report-"));
  const forbidden = [
    "secret prompt",
    "source contents",
    "provider-secret-that-must-not-leak",
    "secret model response",
  ];
  try {
    for (const terminalState of ["COMPLETED", "UNAVAILABLE"]) {
      const capture = {
        ...representativeCapture(terminalState),
        prompt: forbidden[0],
        source: forbidden[1],
        response: forbidden[3],
      };
      const capturePath = resolve(directory, `${terminalState}.json`);
      await writeFile(capturePath, `${JSON.stringify(capture)}\n`, "utf8");
      const { stdout, stderr } = await runReportValidator(capturePath);
      const report = parseMissionCorrelationReportOutput(stdout);
      const summary = formatMissionCorrelationSummary(report);

      assert.equal(report.redacted, true);
      assert.equal(
        summary,
        terminalState === "COMPLETED"
          ? "Live mission correlation report: outcome=success terminal=COMPLETED evidence=2 validation=1."
          : "Live mission correlation report: outcome=non-success terminal=UNAVAILABLE evidence=0 validation=0.",
      );
      for (const value of forbidden) {
        const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        assert.doesNotMatch(stdout, new RegExp(escaped));
        assert.doesNotMatch(summary, new RegExp(escaped));
      }
      assert.doesNotMatch(summary, /prompt|source|response|credential|model/i);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects malformed validator stdout before release summary formatting", () => {
  assert.throws(
    () => parseMissionCorrelationReportOutput("{ malformed"),
    /produced invalid JSON/,
  );
  assert.throws(
    () => parseMissionCorrelationReportOutput(JSON.stringify({
      kind: "mission-correlation-report",
      version: SUPPORTED_MISSION_CORRELATION_REPORT_VERSION,
      redacted: false,
    })),
    /not marked redacted/,
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

test("strict live validation requires a matching candidate revision", () => {
  const capture = representativeCapture("COMPLETED");
  assert.throws(
    () => buildMissionCorrelationReport(capture, {
      requireEvidence: true,
      requireCandidateCorrelation: true,
    }),
    /candidateIdentity/,
  );
  assert.throws(
    () => buildMissionCorrelationReport({
      ...capture,
      candidateIdentity: "candidate-1",
      candidateRevision: "different-revision",
    }, {
      requireEvidence: true,
      requireCandidateCorrelation: true,
    }),
    /candidateRevision/,
  );
  const report = buildMissionCorrelationReport({
    ...capture,
    candidateIdentity: "candidate-1",
    candidateRevision: "abc1234",
  }, {
    requireEvidence: true,
    requireCandidateCorrelation: true,
  });
  assert.equal(report.candidateIdentity, "candidate-1");
  assert.equal(report.candidateRevision, "abc1234");
});