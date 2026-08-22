#!/usr/bin/env node

import fs from "node:fs/promises";

const TERMINAL_STATES = new Set([
  "COMPLETED",
  "READY_FOR_REVIEW",
  "APPLIED",
  "COMMITTED",
  "PUSHED",
  "BLOCKED",
  "CANCELLED",
  "FAILED",
  "UNAVAILABLE",
]);

export const SUPPORTED_MISSION_CORRELATION_REPORT_VERSION = 1;

function text(value, fallback = undefined) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function requireValue(value, name) {
  const result = text(value);
  if (!result) throw new Error(`Correlation report is missing ${name}.`);
  return result;
}

function same(value, expected, name) {
  if (value !== expected) {
    throw new Error(`Correlation mismatch for ${name}: expected ${expected}, got ${value ?? "missing"}.`);
  }
}

export function assertSupportedMissionCorrelationReportVersion(report) {
  if (report?.version !== SUPPORTED_MISSION_CORRELATION_REPORT_VERSION) {
    throw new Error(
      `Unsupported mission correlation report version: expected ${SUPPORTED_MISSION_CORRELATION_REPORT_VERSION}, ` +
        `got ${report?.version ?? "missing"}. Update the report reader before changing the producer version.`,
    );
  }
  return report;
}

export function buildMissionCorrelationReport(input, options = {}) {
  const execution = input.execution ?? {};
  const operationId = requireValue(
    input.operationId ?? execution.operationId,
    "operationId",
  );
  const workspaceRevision = requireValue(input.workspaceRevision, "workspaceRevision");
  const projectId = requireValue(input.projectId ?? execution.projectId, "projectId");
  const sessionId = requireValue(input.sessionId ?? execution.sessionId, "sessionId");
  const terminalState = requireValue(
    input.terminalState ?? execution.flightState ?? execution.status,
    "terminalState",
  );
  if (!TERMINAL_STATES.has(terminalState)) {
    throw new Error(`Unknown mission terminal state: ${terminalState}.`);
  }

  const messages = Array.isArray(input.messages) ? input.messages : [];
  const events = Array.isArray(input.events) ? input.events : [];
  const checkpoints = Array.isArray(input.checkpoints) ? input.checkpoints : [];
  const proposals = Array.isArray(input.proposals) ? input.proposals : [];
  const validation = Array.isArray(input.validation) ? input.validation : [];
  const dashboard = input.dashboard ?? {};
  const missionExecution = (dashboard.executions ?? []).find(
    (candidate) => candidate?.id === execution.id,
  );

  same(execution.projectId, projectId, "execution.projectId");
  same(execution.sessionId, sessionId, "execution.sessionId");
  if (execution.operationId) same(execution.operationId, operationId, "execution.operationId");
  for (const event of events) {
    if (event.correlationId !== undefined) same(event.correlationId, operationId, "event.correlationId");
  }
  for (const message of messages) {
    if (message.executionId !== undefined && message.executionId !== null) {
      same(message.executionId, execution.id, "message.executionId");
    }
  }
  if (missionExecution) {
    if (missionExecution.projectId !== undefined) same(missionExecution.projectId, projectId, "dashboard.projectId");
    if (missionExecution.executionStatus !== undefined) same(
      missionExecution.executionStatus,
      execution.status,
      "dashboard.executionStatus",
    );
  }
  const coreAgreement = {
    execution: Boolean(execution.id),
    messages: messages.length > 0,
    sse: Array.isArray(input.sseEvents) && input.sseEvents.length > 0,
    checkpoints: checkpoints.length > 0,
    dashboard: Boolean(missionExecution),
  };
  for (const [surface, present] of Object.entries(coreAgreement)) {
    if (!present) throw new Error(`Correlation report is missing the ${surface} surface.`);
  }

  const success = ["COMPLETED", "READY_FOR_REVIEW", "APPLIED", "COMMITTED", "PUSHED"].includes(terminalState);
  const evidenceCount = Number(input.evidenceCount ?? 0);
  if (
    options.requireEvidence === true &&
    success &&
    (!Number.isFinite(evidenceCount) || evidenceCount < 1 || validation.length < 1)
  ) {
    throw new Error(
      `Evidence-backed success is incomplete: evidence=${evidenceCount}, ` +
      `validation=${validation.length}.`,
    );
  }
  return {
    kind: "mission-correlation-report",
    version: SUPPORTED_MISSION_CORRELATION_REPORT_VERSION,
    redacted: true,
    operationId,
    projectId,
    sessionId,
    workspaceRevision,
    terminalState,
    outcomeClass: success ? "success" : "non-success",
    counts: {
      messages: messages.length,
      sseEvents: Array.isArray(input.sseEvents) ? input.sseEvents.length : 0,
      executionCheckpoints: checkpoints.length,
      evidence: evidenceCount,
      proposals: proposals.length,
      validation: validation.length,
      correlatedEvents: events.length,
    },
    agreement: {
      ...coreAgreement,
      evidence: evidenceCount > 0 || !success,
      proposals: proposals.length > 0 || !success,
      validation: validation.length > 0 || !success,
      dashboard: Boolean(missionExecution),
    },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error("Usage: node scripts/mission-correlation-report.mjs <capture.json>");
    process.exit(2);
  }
  try {
    const input = JSON.parse(await fs.readFile(inputPath, "utf8"));
    console.log(
      JSON.stringify(
        buildMissionCorrelationReport(input, {
          requireEvidence: process.env.MISSION_CORRELATION_REQUIRE_EVIDENCE === "1",
        }),
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}