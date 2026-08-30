// b73440176ba7cdb0408a4bb0c51d6419ed6b8df9
var _process$env$DASHBOAR;
import { expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parseClerkSignInTokenResponse, parseClerkUserLookupResponse, parseCreatedClerkUserResponse } from "../src/lib/clerk-handoff";
const DASHBOARD_PATH = "/dashboard/";
const TEST_USER = {
  firstName: "EngineeringOS",
  lastName: "Dashboard Smoke",
  email: (_process$env$DASHBOAR = process.env.DASHBOARD_E2E_EMAIL) !== null && _process$env$DASHBOAR !== void 0 ? _process$env$DASHBOAR : "engineeringos-dashboard-smoke@example.com"
};
const EXECUTION_ID = "e2e-controlled-execution";
const DEFAULT_LIVE_TIMEOUT_MS = 120000;
const LIVE_TEST_TIMEOUT_MARGIN_MS = 5000;
const DEFAULT_READINESS_TIMEOUT_MS = 15000;
const TEST_MODES = new Set(["fixture", "live-provider"]);
const HOSTILE_ORIGIN = "https://attacker.example";
const ORIGIN_DIAGNOSTIC_HEADERS = ["access-control-allow-origin", "access-control-allow-methods", "access-control-allow-headers", "vary"];
const DEFAULT_LIVE_PROMPT = "Perform a bounded forensic audit of this disposable project using read-only tools. " + "Produce at least one accepted evidence item and one validation checkpoint, and do not " + "report COMPLETED unless both are present. Report only verified evidence.";
const LIVE_CAMPAIGN_SCENARIOS = new Set(["provider-outage", "malformed-output", "delivery-success"]);
function liveCampaignScenario() {
  var _process$env$DASHBOAR2;
  const scenario = (_process$env$DASHBOAR2 = process.env.DASHBOARD_E2E_LIVE_SCENARIO) === null || _process$env$DASHBOAR2 === void 0 ? void 0 : _process$env$DASHBOAR2.trim();
  if (process.env.DASHBOARD_E2E_LIVE_CAMPAIGN === "1" && !scenario) {
    throw new Error("Live campaign requires DASHBOARD_E2E_LIVE_SCENARIO=provider-outage, malformed-output, or delivery-success.");
  }
  if (scenario && !LIVE_CAMPAIGN_SCENARIOS.has(scenario)) {
    throw new Error(`Unsupported live campaign scenario: ${scenario}.`);
  }
  return scenario;
}
function livePrompt() {
  var _process$env$DASHBOAR3;
  const scenario = liveCampaignScenario();
  if (scenario === "provider-outage") {
    return "Run a bounded forensic audit and report the OpenRouter rate-limit/provider-exhaustion outage as a failed or incomplete operation. Do not use prior analysis as a current answer; include the current operation and revision.";
  }
  if (scenario === "malformed-output") {
    return "Run a bounded forensic audit and treat malformed provider output as failed or incomplete. Do not claim success, apply, commit, or push without candidate-bound evidence.";
  }
  if (scenario === "delivery-success") {
    return "Please conduct the bounded delivery proof campaign on this disposable project. Exercise apply, commit, and push only when each current operation, project revision, candidate identity, and candidate-bound evidence match. Report every terminal receipt.";
  }
  return (_process$env$DASHBOAR3 = process.env.DASHBOARD_E2E_LIVE_PROMPT) !== null && _process$env$DASHBOAR3 !== void 0 ? _process$env$DASHBOAR3 : DEFAULT_LIVE_PROMPT;
}
function liveTimeoutMs() {
  const configured = Number(process.env.DASHBOARD_E2E_LIVE_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_LIVE_TIMEOUT_MS;
}
function dashboardTestMode() {
  var _process$env$DASHBOAR4;
  return (_process$env$DASHBOAR4 = process.env.DASHBOARD_E2E_TEST_MODE) !== null && _process$env$DASHBOAR4 !== void 0 ? _process$env$DASHBOAR4 : "fixture";
}
function readinessTimeoutMs() {
  const configured = Number(process.env.DASHBOARD_E2E_READINESS_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_READINESS_TIMEOUT_MS;
}
async function writeReadinessReceipt(outcome, checks, reason) {
  const receiptPath = process.env.DASHBOARD_E2E_READINESS_ARTIFACT_PATH;
  if (!receiptPath) return;
  await mkdir(dirname(receiptPath), {
    recursive: true
  });
  await writeFile(receiptPath, `${JSON.stringify({
    outcome,
    ...(reason ? {
      reason
    } : {}),
    checks,
    mode: dashboardTestMode(),
    project: dashboardTestMode() === "live-provider" ? process.env.DASHBOARD_E2E_LIVE_PROJECT_ID : "e2e-project"
  }, null, 2)}\n`, "utf8");
}
function approvedDashboardOrigins() {
  var _process$env$DASHBOAR5;
  const origins = ((_process$env$DASHBOAR5 = process.env.DASHBOARD_E2E_APPROVED_ORIGINS) !== null && _process$env$DASHBOAR5 !== void 0 ? _process$env$DASHBOAR5 : "").split(",").map(origin => origin.trim()).filter(Boolean);
  if (origins.length === 0) {
    throw new Error("DASHBOARD_E2E_APPROVED_ORIGINS must contain every approved dashboard origin.");
  }
  return origins.map(origin => {
    const parsed = new URL(origin);
    if (parsed.origin !== origin || parsed.pathname !== "/" || parsed.search || parsed.hash) {
      throw new Error(`Dashboard journey origin must be a bare origin: ${origin}`);
    }
    return parsed.origin;
  });
}
const dashboardFixture = {
  freshnessRevision: "2026-01-01T00:00:00.000Z",
  projectCount: 1,
  activeTaskCount: 0,
  completedTaskCount: 2,
  failedTaskCount: 0,
  taskStatusBreakdown: {
    pending: 0,
    running: 0
  },
  projectScores: [{
    projectId: "e2e-project",
    projectName: "Smoke Project",
    score: 92,
    trend: "stable"
  }],
  recentEvents: [{
    id: "e2e-event",
    type: "SmokeCheck",
    severity: "success",
    message: "Dashboard API fixture ready",
    timestamp: "2026-01-01T00:00:00.000Z"
  }],
  topRules: []
};
const executionFixture = {
  id: EXECUTION_ID,
  projectId: "e2e-project",
  operationId: "e2e-operation",
  status: "completed",
  flightState: "COMPLETED",
  evidenceVerdict: "PROVEN",
  proofRequired: false,
  resumable: false,
  checkpointVersion: 1,
  projectRevision: "e2e-revision-42",
  checkpoint: {
    stage: "complete",
    detail: "Controlled browser fixture completed."
  },
  objective: {
    objective: "Verify the dashboard browser journey"
  },
  startedAt: "2026-01-01T00:00:00.000Z",
  completedAt: "2026-01-01T00:01:00.000Z",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:01:00.000Z"
};
function jsonResponse(body, status = 200, headers) {
  return {
    status,
    contentType: "application/json",
    ...(headers ? {
      headers
    } : {}),
    body: JSON.stringify(body)
  };
}
async function expectNoHorizontalOverflow(page) {
  const overflow = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    viewport: window.innerWidth
  }));
  expect(overflow.document).toBeLessThanOrEqual(overflow.viewport + 1);
  expect(overflow.body).toBeLessThanOrEqual(overflow.viewport + 1);
}
async function expectDashboardReady(page) {
  await expect(page.getByRole("heading", {
    name: "System Overview"
  })).toBeVisible();
  await expect(page.getByText("SYSTEM ONLINE", {
    exact: true
  })).toBeVisible();
}
async function restartApiForCampaign(page) {
  const controlUrl = process.env.DASHBOARD_E2E_CONTROL_URL;
  if (!controlUrl) throw new Error("Dashboard campaign control URL is missing.");
  const response = await page.request.post(`${controlUrl}/restart-api`, {
    timeout: 15000
  });
  expect(response.status()).toBe(204);
}
async function installApiFixtures(page, overrides) {
  await page.route("**/api/**", async route => {
    var _ref, _overrides$deliveryRe, _overrides$auditExpor2, _overrides$auditExpor3;
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/dashboard(?=\/|$)/, "");
    const arabicAi = overrides === null || overrides === void 0 ? void 0 : overrides.arabicAi;
    const alternateAi = overrides === null || overrides === void 0 ? void 0 : overrides.alternateAi;
    const disconnectAi = overrides === null || overrides === void 0 ? void 0 : overrides.disconnectAi;
    const aiFixtures = [arabicAi, alternateAi, disconnectAi].filter(fixture => Boolean(fixture));
    const hasConfiguredAiFixture = aiFixtures.length > 0 || Boolean((overrides === null || overrides === void 0 ? void 0 : overrides.resumeFailure) || (overrides === null || overrides === void 0 ? void 0 : overrides.interruptedResume));
    if (aiFixtures.length > 0 && path.endsWith("/api/ai/chat/sessions")) {
      const projectId = url.searchParams.get("projectId");
      const projectSessions = aiFixtures.filter(fixture => !fixture.projectId || fixture.projectId === projectId);
      return route.fulfill(jsonResponse(projectSessions.map(fixture => ({
        id: fixture.sessionId,
        title: fixture.question,
        updatedAt: "2026-01-01T00:02:00.000Z"
      }))));
    }
    if (overrides !== null && overrides !== void 0 && overrides.resumeFailure && path.endsWith("/api/ai/chat/stream")) {
      let requestBody = {};
      try {
        requestBody = route.request().postDataJSON();
      } catch {
        // The normal provider-free fallback below handles malformed requests.
      }
      if (requestBody.executionId === overrides.resumeFailure.fixture.executionId) {
        return route.fulfill({
          status: 200,
          contentType: "text/event-stream",
          headers: {
            "Cache-Control": "no-cache"
          },
          body: overrides.resumeFailure.fixture.streamBody
        });
      }
    }
    if (overrides !== null && overrides !== void 0 && overrides.interruptedResume && path.endsWith("/api/ai/chat/stream")) {
      let requestBody = {};
      try {
        requestBody = route.request().postDataJSON();
      } catch {
        // The normal provider-free fallback below handles malformed requests.
      }
      const {
        fixture,
        resumedStreamBody
      } = overrides.interruptedResume;
      if (requestBody.executionId === fixture.executionId) {
        return route.fulfill({
          status: 200,
          contentType: "text/event-stream",
          headers: {
            "Cache-Control": "no-cache"
          },
          body: resumedStreamBody
        });
      }
      if (!requestBody.executionId) {
        return route.fulfill({
          status: 200,
          contentType: "text/event-stream",
          headers: {
            "Cache-Control": "no-cache"
          },
          // Deliberately stop after the durable execution identity. The
          // journey wraps this response in a browser-level stream error.
          body: fixture.streamBody
        });
      }
    }
    let requestedMessage;
    try {
      requestedMessage = route.request().postDataJSON().message;
    } catch {
      // The default provider-unavailable response handles malformed requests.
    }
    const streamFixture = (_ref = disconnectAi !== null && disconnectAi !== void 0 ? disconnectAi : aiFixtures.find(fixture => typeof requestedMessage === "string" && (requestedMessage === fixture.question || requestedMessage.includes(fixture.question)))) !== null && _ref !== void 0 ? _ref : arabicAi;
    if (streamFixture && path.endsWith("/api/ai/chat/stream")) return route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      headers: {
        "Cache-Control": "no-cache"
      },
      body: streamFixture.streamBody
    });
    const messageFixture = aiFixtures.find(fixture => path.endsWith(`/api/ai/chat/${fixture.sessionId}/messages`));
    if (messageFixture) return route.fulfill(jsonResponse([{
      id: `${messageFixture.sessionId}-user-message`,
      sessionId: messageFixture.sessionId,
      role: "user",
      content: messageFixture.question,
      createdAt: "2026-01-01T00:01:00.000Z"
    }, messageFixture.message]));
    if (overrides !== null && overrides !== void 0 && overrides.auditExport && path.endsWith("/api/ai/chat/e2e-audit-session/messages")) {
      var _overrides$auditExpor;
      return route.fulfill(jsonResponse([{
        id: "e2e-audit-user-message",
        sessionId: "e2e-audit-session",
        role: "user",
        content: "Completed audit execution",
        createdAt: "2026-01-01T00:01:00.000Z"
      }, {
        id: "e2e-audit-assistant-message",
        sessionId: "e2e-audit-session",
        role: "assistant",
        content: "Completed audit execution",
        executionId: EXECUTION_ID,
        outcome: (_overrides$auditExpor = overrides.auditExport.messageOutcome) !== null && _overrides$auditExpor !== void 0 ? _overrides$auditExpor : "SUCCEEDED",
        createdAt: "2026-01-01T00:02:00.000Z"
      }]));
    }
    if (path === "/api/dashboard") return route.fulfill(jsonResponse(dashboardFixture));
    if (overrides !== null && overrides !== void 0 && overrides.taskActions) {
      const verificationMatch = path.match(/^\/api\/tasks\/([^/]+)\/verification$/);
      if (verificationMatch && route.request().method() === "POST") {
        var _plan$verificationChe, _plan$verificationSte, _overrides$taskAction, _task$verificationRes, _priorResult$steps, _priorResult$history, _priorResult$history2, _check$kind, _priorResult$history3;
        const [, taskId] = verificationMatch;
        const task = overrides.taskActions.tasks.find(candidate => candidate.id === taskId);
        if (!task) {
          return route.fulfill(jsonResponse({
            error: "Task not found"
          }, 404));
        }
        let body = {};
        try {
          body = route.request().postDataJSON();
        } catch {
          return route.fulfill(jsonResponse({
            error: "Invalid verification request"
          }, 400));
        }
        const plan = task.remediationPlan;
        const checks = (_plan$verificationChe = plan === null || plan === void 0 ? void 0 : plan.verificationChecks) !== null && _plan$verificationChe !== void 0 ? _plan$verificationChe : ((_plan$verificationSte = plan === null || plan === void 0 ? void 0 : plan.verificationSteps) !== null && _plan$verificationSte !== void 0 ? _plan$verificationSte : []).map((guidance, index) => ({
          id: `rule-verification-${index + 1}`,
          kind: "operator_attestation",
          guidance
        }));
        const check = checks.find(candidate => candidate.id === body.checkId);
        if (!check) {
          return route.fulfill(jsonResponse({
            error: "verification_check_not_found",
            reason: "The submitted check is not part of this task's server-owned verification plan."
          }, 400));
        }
        const passed = body.passed === true;
        const evidence = typeof body.evidence === "string" ? body.evidence.trim() : "";
        if (passed && !evidence) {
          return route.fulfill(jsonResponse({
            error: "verification_evidence_required",
            reason: "A passed verification check must include explicit operator evidence."
          }, 400));
        }
        (_overrides$taskAction = overrides.taskActions.verificationRequests) === null || _overrides$taskAction === void 0 || _overrides$taskAction.push({
          taskId,
          checkId: body.checkId,
          passed,
          ...(evidence ? {
            evidence
          } : {})
        });
        const priorResult = (_task$verificationRes = task.verificationResult) !== null && _task$verificationRes !== void 0 ? _task$verificationRes : {};
        const priorSteps = (_priorResult$steps = priorResult.steps) !== null && _priorResult$steps !== void 0 ? _priorResult$steps : [];
        const steps = checks.map(candidate => {
          var _candidate$kind2;
          const prior = priorSteps.find(step => step.id === candidate.id);
          if (candidate.id !== body.checkId) {
            var _candidate$kind;
            return prior !== null && prior !== void 0 ? prior : {
              id: candidate.id,
              name: `Rule verification ${String(candidate.id).replace("rule-verification-", "#")}`,
              kind: (_candidate$kind = candidate.kind) !== null && _candidate$kind !== void 0 ? _candidate$kind : "operator_attestation",
              guidance: candidate.guidance,
              passed: false,
              output: "Not recorded — operator evidence is required"
            };
          }
          return {
            id: candidate.id,
            name: `Rule verification ${String(candidate.id).replace("rule-verification-", "#")}`,
            kind: (_candidate$kind2 = candidate.kind) !== null && _candidate$kind2 !== void 0 ? _candidate$kind2 : "operator_attestation",
            guidance: candidate.guidance,
            passed,
            ...(evidence ? {
              evidence
            } : {}),
            output: passed ? "Operator evidence recorded" : "Operator reported that the check failed"
          };
        });
        const completed = steps.every(step => {
          var _step$evidence;
          return step.passed === true && Boolean(String((_step$evidence = step.evidence) !== null && _step$evidence !== void 0 ? _step$evidence : "").trim());
        });
        task.status = completed ? "completed" : "verifying";
        task.verificationResult = {
          passed: completed,
          decision: completed ? "verified" : "incomplete",
          steps,
          history: [...((_priorResult$history = priorResult.history) !== null && _priorResult$history !== void 0 ? _priorResult$history : []), {
            id: `verification-history-${String(((_priorResult$history2 = priorResult.history) !== null && _priorResult$history2 !== void 0 ? _priorResult$history2 : []).length + 1)}`,
            checkId: check.id,
            name: `Rule verification ${String(check.id).replace("rule-verification-", "#")}`,
            kind: (_check$kind = check.kind) !== null && _check$kind !== void 0 ? _check$kind : "operator_attestation",
            guidance: check.guidance,
            passed,
            ...(evidence ? {
              evidence
            } : {}),
            actor: "e2e-operator",
            recordedAt: `2026-01-01T00:0${((_priorResult$history3 = priorResult.history) !== null && _priorResult$history3 !== void 0 ? _priorResult$history3 : []).length + 2}:00.000Z`
          }]
        };
        if (task.remediationPlan && completed) {
          task.remediationPlan = {
            ...task.remediationPlan,
            status: "verified"
          };
        }
        task.updatedAt = "2026-01-01T00:04:00.000Z";
        if (completed) task.completedAt = task.updatedAt;
        return route.fulfill(jsonResponse(task));
      }
      const actionMatch = path.match(/^\/api\/tasks\/([^/]+)\/(execute|retry)$/);
      if (actionMatch && route.request().method() === "POST") {
        const [, taskId, action] = actionMatch;
        const task = overrides.taskActions.tasks.find(candidate => candidate.id === taskId);
        if (!task) {
          return route.fulfill(jsonResponse({
            error: "Task not found"
          }, 404));
        }
        overrides.taskActions.requests.push(`${action}:${taskId}`);
        if (action === "execute") {
          task.status = "running";
          task.updatedAt = "2026-01-01T00:02:00.000Z";
        } else {
          var _task$retryCount;
          task.status = "queued";
          task.retryCount = Number((_task$retryCount = task.retryCount) !== null && _task$retryCount !== void 0 ? _task$retryCount : 0) + 1;
          task.updatedAt = "2026-01-01T00:02:00.000Z";
        }
        return route.fulfill(jsonResponse(task, 202));
      }
    }
    if (path === "/api/tasks") {
      var _ref2, _overrides$taskAction2, _overrides$taskAction3;
      return route.fulfill(jsonResponse((_ref2 = (_overrides$taskAction2 = overrides === null || overrides === void 0 || (_overrides$taskAction3 = overrides.taskActions) === null || _overrides$taskAction3 === void 0 ? void 0 : _overrides$taskAction3.tasks) !== null && _overrides$taskAction2 !== void 0 ? _overrides$taskAction2 : overrides === null || overrides === void 0 ? void 0 : overrides.recoveryTasks) !== null && _ref2 !== void 0 ? _ref2 : overrides !== null && overrides !== void 0 && overrides.liveTask ? [{
        id: overrides.liveTask.id,
        projectId: overrides.liveTask.projectId,
        title: overrides.liveTask.title,
        description: "A task used to verify live dashboard updates.",
        status: "running",
        priority: "p1",
        relatedFiles: [],
        retryCount: 0,
        maxRetries: 2,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:01.000Z"
      }] : []));
    }
    if (path === "/api/workflows") {
      var _overrides$recoveryWo;
      return route.fulfill(jsonResponse((_overrides$recoveryWo = overrides === null || overrides === void 0 ? void 0 : overrides.recoveryWorkflows) !== null && _overrides$recoveryWo !== void 0 ? _overrides$recoveryWo : []));
    }
    const workflowExecutionsMatch = path.match(/^\/api\/workflows\/([^/]+)\/executions$/);
    if (workflowExecutionsMatch) {
      var _overrides$recoveryWo2, _overrides$recoveryWo3;
      return route.fulfill(jsonResponse((_overrides$recoveryWo2 = overrides === null || overrides === void 0 || (_overrides$recoveryWo3 = overrides.recoveryWorkflowExecutions) === null || _overrides$recoveryWo3 === void 0 ? void 0 : _overrides$recoveryWo3[workflowExecutionsMatch[1]]) !== null && _overrides$recoveryWo2 !== void 0 ? _overrides$recoveryWo2 : []));
    }
    if (overrides !== null && overrides !== void 0 && overrides.auditExport && path === `/api/ai/executions/${EXECUTION_ID}/audit-export`) {
      overrides.auditExport.requests.push(route.request().url());
      if (overrides.auditExport.failFirstPreview && overrides.auditExport.requests.length === 1) {
        return route.fulfill(jsonResponse({
          error: "Temporary preview network failure."
        }, 503));
      }
      return route.fulfill(jsonResponse(overrides.auditExport.body, 200, {
        "Content-Disposition": `attachment; filename="${overrides.auditExport.filename}"`
      }));
    }
    if (overrides !== null && overrides !== void 0 && overrides.archiveUpload && path === "/api/upload/archive") {
      var _route$request$header;
      const contentType = (_route$request$header = route.request().headers()["content-type"]) !== null && _route$request$header !== void 0 ? _route$request$header : "";
      if (!contentType.startsWith("multipart/form-data;")) {
        return route.fulfill(jsonResponse({
          error: "Expected multipart archive upload."
        }, 400));
      }
      const body = route.request().postDataBuffer();
      if (!(body !== null && body !== void 0 && body.includes(Buffer.from("dashboard-journey.zip")))) {
        return route.fulfill(jsonResponse({
          error: "Expected the journey archive payload."
        }, 400));
      }
      return route.fulfill(jsonResponse({
        uploadId: overrides.archiveUpload.uploadId,
        originalName: overrides.archiveUpload.originalName
      }, 201, {
        "access-control-allow-origin": new URL(page.url()).origin,
        "access-control-allow-credentials": "true"
      }));
    }
    if (overrides !== null && overrides !== void 0 && overrides.liveTask && path === "/api/tasks") {
      return route.fulfill(jsonResponse([{
        id: overrides.liveTask.id,
        projectId: overrides.liveTask.projectId,
        title: overrides.liveTask.title,
        description: "A task used to verify live dashboard updates.",
        status: "running",
        phase: "Execution",
        relatedFiles: [],
        retryCount: 0,
        maxRetries: 2,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:01.000Z"
      }]));
    }
    if (overrides !== null && overrides !== void 0 && overrides.liveTask && path === `/api/tasks/${overrides.liveTask.id}/logs`) {
      var _overrides$liveTask$i;
      return route.fulfill(jsonResponse((_overrides$liveTask$i = overrides.liveTask.initialLogs) !== null && _overrides$liveTask$i !== void 0 ? _overrides$liveTask$i : []));
    }
    if (overrides !== null && overrides !== void 0 && overrides.liveTask && path === `/api/tasks/${overrides.liveTask.id}/logs/stream`) {
      const streamRequests = overrides.liveTask.streamRequests;
      streamRequests === null || streamRequests === void 0 || streamRequests.push(route.request().url());
      if (overrides.liveTask.failFirstStream && (streamRequests === null || streamRequests === void 0 ? void 0 : streamRequests.length) === 1 || overrides.liveTask.failStreamAttempts && streamRequests && streamRequests.length <= overrides.liveTask.failStreamAttempts) {
        // Exercise the browser's reconnect path without changing the task
        // lifecycle or synthesizing a successful response for the first try.
        return route.abort("connectionreset");
      }
      return route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        headers: {
          "Cache-Control": "no-cache",
          "access-control-allow-origin": new URL(page.url()).origin,
          "access-control-allow-credentials": "true"
        },
        body: `event: log\ndata: ${JSON.stringify(overrides.liveTask.log)}\n\n`
      });
    }
    if (path === "/api/projects") {
      var _overrides$projects;
      return route.fulfill(jsonResponse((_overrides$projects = overrides === null || overrides === void 0 ? void 0 : overrides.projects) !== null && _overrides$projects !== void 0 ? _overrides$projects : [{
        id: "e2e-project",
        name: "Smoke Project",
        language: "TypeScript",
        framework: "React",
        status: "active",
        rootPath: "/controlled/smoke",
        qualityScore: 92
      }]));
    }
    if (path === "/api/readiness") {
      return route.fulfill(jsonResponse({
        status: "ready",
        checks: {
          api: {
            status: "ready"
          },
          database: {
            status: "ready"
          },
          schema: {
            status: "ready"
          }
        }
      }));
    }
    if (hasConfiguredAiFixture && path === "/api/ai/active-provider") {
      return route.fulfill(jsonResponse({
        provider: "openrouter",
        configured: true
      }));
    }
    if (overrides !== null && overrides !== void 0 && overrides.deliveryRecovery && path === "/api/ai/delivery/recoverable") {
      overrides.deliveryRecovery.requests.push(route.request().url());
      return route.fulfill(jsonResponse({
        operations: overrides.deliveryRecovery.operations
      }));
    }
    if (overrides !== null && overrides !== void 0 && (_overrides$deliveryRe = overrides.deliveryRecovery) !== null && _overrides$deliveryRe !== void 0 && _overrides$deliveryRe.recoveryAction && path === `/api/ai/delivery/${overrides.deliveryRecovery.recoveryAction.proposalId}/${overrides.deliveryRecovery.recoveryAction.action}`) {
      var _overrides$deliveryRe2, _overrides$deliveryRe3;
      (_overrides$deliveryRe2 = overrides.deliveryRecovery.actionRequests) === null || _overrides$deliveryRe2 === void 0 || _overrides$deliveryRe2.push(route.request().url());
      if (overrides.deliveryRecovery.recoveryAction.nextOperations) {
        overrides.deliveryRecovery.operations = overrides.deliveryRecovery.recoveryAction.nextOperations;
      }
      return route.fulfill(jsonResponse(overrides.deliveryRecovery.recoveryAction.response, (_overrides$deliveryRe3 = overrides.deliveryRecovery.recoveryAction.status) !== null && _overrides$deliveryRe3 !== void 0 ? _overrides$deliveryRe3 : 409));
    }
    if (path === "/api/events") {
      var _overrides$events, _url$searchParams$get;
      const events = (_overrides$events = overrides === null || overrides === void 0 ? void 0 : overrides.events) !== null && _overrides$events !== void 0 ? _overrides$events : dashboardFixture.recentEvents;
      const search = (_url$searchParams$get = url.searchParams.get("search")) === null || _url$searchParams$get === void 0 ? void 0 : _url$searchParams$get.toLowerCase();
      const filteredEvents = events.filter(event => {
        const projectId = url.searchParams.get("projectId");
        const severity = url.searchParams.get("severity");
        const correlationId = url.searchParams.get("correlationId");
        return (!projectId || event.projectId === projectId) && (!severity || event.severity === severity) && (!correlationId || event.correlationId === correlationId) && (!search || [event.message, event.type, event.correlationId].filter(value => typeof value === "string").some(value => value.toLowerCase().includes(search)));
      });
      const limit = Number(url.searchParams.get("limit")) || 50;
      const page = Number(url.searchParams.get("page")) || 1;
      return route.fulfill(jsonResponse({
        events: filteredEvents.slice((page - 1) * limit, page * limit),
        total: filteredEvents.length
      }));
    }
    if (overrides !== null && overrides !== void 0 && overrides.resumeFailure && path === `/api/ai/executions/${overrides.resumeFailure.fixture.executionId}`) {
      return route.fulfill(jsonResponse(overrides.resumeFailure.execution));
    }
    if (overrides !== null && overrides !== void 0 && overrides.interruptedResume && path === `/api/ai/executions/${overrides.interruptedResume.fixture.executionId}`) {
      return route.fulfill(jsonResponse(overrides.interruptedResume.execution));
    }
    if (overrides !== null && overrides !== void 0 && overrides.interruptedResume && path === `/api/ai/executions/${overrides.interruptedResume.fixture.executionId}/resume-capability`) {
      return route.fulfill(jsonResponse({
        executionId: overrides.interruptedResume.fixture.executionId,
        resumeToken: overrides.interruptedResume.recoveredToken
      }));
    }
    if (path === `/api/ai/executions/${EXECUTION_ID}`) return route.fulfill(jsonResponse((_overrides$auditExpor2 = overrides === null || overrides === void 0 || (_overrides$auditExpor3 = overrides.auditExport) === null || _overrides$auditExpor3 === void 0 ? void 0 : _overrides$auditExpor3.execution) !== null && _overrides$auditExpor2 !== void 0 ? _overrides$auditExpor2 : executionFixture));
    if (path === "/api/ai/mission-control") return route.fulfill(jsonResponse({
      updatedAt: "2026-01-01T00:01:00.000Z",
      executions: []
    }));

    // AI is deliberately not executed in this smoke journey. This response
    // verifies the user-visible unavailable/empty state without a provider.
    if (path.startsWith("/api/ai/")) return route.fulfill(jsonResponse({
      error: "AI provider not configured"
    }, 428));
    return route.continue();
  });
}
async function installArabicAiFixture(page, options) {
  var _options$sessionId, _options$question;
  const sessionId = (_options$sessionId = options === null || options === void 0 ? void 0 : options.sessionId) !== null && _options$sessionId !== void 0 ? _options$sessionId : "e2e-arabic-ai-session";
  const messageId = "e2e-arabic-ai-message";
  const source = "src/execution-tools.ts";
  const blocked = (options === null || options === void 0 ? void 0 : options.blocked) === true;
  const question = (_options$question = options === null || options === void 0 ? void 0 : options.question) !== null && _options$question !== void 0 ? _options$question : "ماذا يحدث عند انتهاء مهلة provider timeout داخل execution-tools.ts؟";
  const answer = "عند انتهاء مهلة مزود الذكاء الاصطناعي، يعيد المسار تقريرًا جزئيًا من الأدلة التي جُمعت بدل إصدار Finding غير مثبت.";
  const evidence = [{
    source,
    ...(blocked ? {
      excerpt: "provider timeout is handled here",
      supportsClaim: false,
      evidenceClass: "READ_CONFIRMED",
      citationStatus: "BLOCKED",
      citationReason: "MISSING_LITERAL_MATCH"
    } : {
      excerpt: 'return partialFromCollectedEvidence("provider timeout");',
      sourceSpan: {
        startLine: 42,
        endLine: 42
      },
      supportsClaim: true,
      evidenceClass: "BEHAVIOR_PROVEN",
      citationStatus: "ACCEPTED",
      citationReason: "ACCEPTED_SOURCE_SPAN"
    })
  }];
  const toolTrace = [{
    kind: "tool_call",
    tool: "read_file",
    args: {
      path: source
    },
    cached: false,
    prefetched: true
  }, {
    kind: "tool_result",
    tool: "read_file",
    source,
    cached: false,
    prefetched: true
  }, {
    kind: "evidence_integrity",
    code: "EVIDENCE_INTEGRITY_OK",
    consistent: true,
    violations: [],
    evidenceFileCount: 1,
    acceptedEvidenceCount: 1,
    completedReadFiles: [source],
    acceptedEvidenceFiles: [source],
    objectiveType: "PRODUCTION_REACHABILITY",
    requiredEdges: ["client->server", "server->database"],
    provenEdges: ["client->server"],
    completionGateResult: "PARTIALLY_PROVEN",
    finalAnswerType: "PRODUCTION_REACHABILITY_ANSWER"
  }];
  const taskResult = {
    kind: "BEHAVIOR_ANSWER_RESULT",
    answer: {
      answer,
      evidence,
      confidence: 1,
      sourceScope: [source],
      coverage: {
        requestedFields: ["timeout behavior"],
        answeredFields: ["timeout behavior"],
        missingFields: [],
        complete: true
      }
    }
  };
  const message = {
    id: messageId,
    sessionId,
    role: "assistant",
    content: `${answer}\n\n## 6) Final Judgment\nNOT PROVEN`,
    operationMode: "FORENSIC_AUDIT",
    sources: [source],
    toolTrace: JSON.stringify(toolTrace),
    behaviorEvidence: evidence,
    taskResult,
    createdAt: "2026-01-01T00:02:00.000Z"
  };
  const sse = event => `data: ${JSON.stringify(event)}\n\n`;
  const streamBody = [sse({
    type: "session_started",
    sessionId
  }), sse({
    type: "execution_started",
    executionId: "e2e-execution",
    status: "running",
    resumable: true
  }), sse({
    type: "stage",
    stage: "building-context"
  }), sse({
    type: "stage",
    stage: "calling-model"
  }), sse({
    type: "tool_call",
    tool: "read_file",
    args: {
      path: source
    },
    cached: false,
    prefetched: true
  }), sse({
    type: "tool_result",
    tool: "read_file",
    source,
    cached: false,
    prefetched: true
  }), sse({
    type: "evidence_integrity",
    code: "EVIDENCE_INTEGRITY_OK",
    consistent: true,
    violations: [],
    evidenceFileCount: 1,
    acceptedEvidenceCount: 1,
    completedReadFiles: [source],
    acceptedEvidenceFiles: [source],
    objectiveType: "PRODUCTION_REACHABILITY",
    requiredEdges: ["client->server", "server->database"],
    provenEdges: ["client->server"],
    completionGateResult: "PARTIALLY_PROVEN",
    finalAnswerType: "PRODUCTION_REACHABILITY_ANSWER"
  }), sse({
    type: "delta",
    delta: answer
  }), sse({
    type: "done",
    sessionId,
    message,
    sources: [source],
    toolTrace: JSON.stringify(toolTrace),
    behaviorEvidence: evidence,
    taskResult,
    pendingChanges: []
  })].join("");
  return {
    question,
    answer,
    source,
    sessionId,
    projectId: options === null || options === void 0 ? void 0 : options.projectId,
    streamBody,
    message
  };
}
function installToolFailureFixture() {
  const sessionId = "e2e-tool-failure-session";
  const messageId = "e2e-tool-failure-message";
  const source = "src/missing-release-fixture.ts";
  const question = "Which source file is available for the release check?";
  const answer = "ANALYSIS_INCOMPLETE: The required source read did not complete, so no verified result is available.";
  const diagnosticCode = "TOOL_EXECUTION_FAILED";
  const toolTrace = [{
    kind: "tool_call",
    tool: "read_file",
    args: {
      path: source
    },
    cached: false
  }, {
    kind: "tool_result",
    tool: "read_file",
    source,
    resultKind: "failed",
    diagnosticCode,
    resultSummary: "The required source read did not complete."
  }, {
    kind: "done",
    stopReason: "tool_failure",
    iterations: 1,
    maxIterations: 8,
    toolCalls: 1,
    prefetchToolCalls: 0,
    loopToolCalls: 1,
    synthesisStarted: false,
    diagnosticCodes: [diagnosticCode]
  }];
  const message = {
    id: messageId,
    sessionId,
    role: "assistant",
    content: answer,
    toolTrace: JSON.stringify(toolTrace),
    createdAt: "2026-01-01T00:02:00.000Z"
  };
  const sse = event => `data: ${JSON.stringify(event)}\n\n`;
  const streamBody = [sse({
    type: "session_started",
    sessionId
  }), sse({
    type: "execution_started",
    executionId: "e2e-tool-failure-execution",
    status: "running",
    resumable: true
  }), sse({
    type: "tool_call",
    tool: "read_file",
    args: {
      path: source
    },
    cached: false
  }), sse({
    type: "tool_result",
    tool: "read_file",
    source,
    resultKind: "failed",
    diagnosticCode,
    resultSummary: "The required source read did not complete."
  }), sse({
    type: "delta",
    delta: answer
  }), sse({
    type: "done",
    sessionId,
    message,
    toolTrace: JSON.stringify(toolTrace),
    pendingChanges: []
  })].join("");
  return {
    question,
    answer,
    source,
    sessionId,
    streamBody,
    message
  };
}
function installDisconnectedAiFixture() {
  const sessionId = "e2e-disconnected-ai-session";
  const executionId = "e2e-disconnected-ai-execution";
  const question = "What happens when the model disconnects after starting an answer?";
  const answer = "The model started an answer, but the provider disconnected before completion.";
  const diagnosticCode = "EXECUTION_PROVIDER_FAILURE";
  const toolTrace = [{
    kind: "done",
    stopReason: "provider_timeout",
    iterations: 1,
    maxIterations: 8,
    toolCalls: 0,
    prefetchToolCalls: 0,
    loopToolCalls: 0,
    synthesisStarted: false,
    diagnosticCodes: [diagnosticCode],
    diagnosticDetails: ["The provider disconnected after visible response text."]
  }];
  const message = {
    id: "e2e-disconnected-ai-message",
    sessionId,
    role: "assistant",
    content: answer,
    toolTrace: JSON.stringify(toolTrace),
    outcome: "FAILED",
    errorCode: diagnosticCode,
    errorMessage: "The provider disconnected before completion.",
    executionId,
    createdAt: "2026-01-01T00:02:00.000Z"
  };
  const sse = event => `data: ${JSON.stringify(event)}\n\n`;
  const streamBody = [sse({
    type: "session_started",
    sessionId
  }), sse({
    type: "execution_started",
    executionId,
    status: "running",
    resumable: true
  }), sse({
    type: "stage",
    stage: "calling-model"
  }), sse({
    type: "delta",
    delta: answer
  }),
  // The real route emits this after a provider disconnect so the client
  // drops the transient bubble before rendering the persisted result.
  sse({
    type: "stream_reset"
  }), sse({
    type: "done",
    sessionId,
    executionId,
    message,
    pendingChanges: []
  })].join("");
  return {
    question,
    answer,
    source: "provider",
    sessionId,
    executionId,
    streamBody,
    message
  };
}
function installResumedAnalysisFailureFixture() {
  const sessionId = "e2e-resumed-analysis-failure-session";
  const executionId = "e2e-resumed-analysis-failure-execution";
  const resumeToken = "e2e-resumed-analysis-failure-token-opaque";
  const question = "Verify the analysis evidence after reconnect.";
  const answer = "ANALYSIS_INCOMPLETE: The required analysis did not complete, so no verified result is available.";
  const diagnosticCode = "TOOL_UNAVAILABLE";
  const sse = event => `data: ${JSON.stringify(event)}\n\n`;
  const streamBody = [sse({
    type: "session_started",
    sessionId
  }), sse({
    type: "execution_started",
    executionId,
    status: "running",
    resumable: true,
    resumeToken
  }), sse({
    type: "error",
    executionId,
    code: diagnosticCode,
    message: "The required analysis did not complete."
  })].join("");
  const fixture = {
    question,
    answer,
    source: "src/missing-analysis-tool.ts",
    sessionId,
    executionId,
    streamBody,
    message: {
      id: "e2e-resumed-analysis-failure-message",
      sessionId,
      role: "assistant",
      content: answer,
      outcome: "FAILED",
      executionId,
      errorCode: diagnosticCode,
      errorMessage: "The required analysis did not complete.",
      createdAt: "2026-01-01T00:02:00.000Z"
    }
  };
  return {
    fixture,
    execution: {
      id: executionId,
      projectId: "e2e-project",
      operationId: "e2e-resumed-analysis-failure-operation",
      sessionId,
      status: "failed",
      flightState: "FAILED",
      evidenceVerdict: "INCOMPLETE",
      proofRequired: true,
      resumable: true,
      checkpointVersion: 1,
      checkpoint: {
        stage: "tool-execution",
        detail: "The required analysis tool was unavailable."
      },
      objective: {
        objective: question
      },
      error: "The required analysis did not complete.",
      startedAt: "2026-01-01T00:01:00.000Z",
      createdAt: "2026-01-01T00:01:00.000Z",
      updatedAt: "2026-01-01T00:02:00.000Z"
    }
  };
}
function installInterruptedResumeFixture() {
  const sessionId = "e2e-interrupted-resume-session";
  const executionId = "e2e-interrupted-resume-execution";
  const initialToken = "e2e-interrupted-initial-token";
  const recoveredToken = "e2e-interrupted-recovered-token";
  const question = "Continue the interrupted release execution.";
  const partialAnswer = "The release execution started before the browser disconnected.";
  const answer = "The original release execution resumed after capability recovery.";
  const message = {
    id: "e2e-interrupted-resume-message",
    sessionId,
    role: "assistant",
    content: answer,
    executionId,
    outcome: "COMPLETED",
    createdAt: "2026-01-01T00:03:00.000Z"
  };
  const sse = event => `data: ${JSON.stringify(event)}\n\n`;
  const fixture = {
    question,
    answer,
    source: "release-resume",
    sessionId,
    executionId,
    streamBody: [sse({
      type: "session_started",
      sessionId
    }), sse({
      type: "execution_started",
      executionId,
      status: "running",
      resumable: true,
      resumeToken: initialToken
    }), sse({
      type: "stage",
      stage: "calling-model"
    }), sse({
      type: "delta",
      delta: partialAnswer
    })].join(""),
    message
  };
  return {
    fixture,
    initialToken,
    recoveredToken,
    resumedStreamBody: [sse({
      type: "session_started",
      sessionId
    }), sse({
      type: "execution_started",
      executionId,
      status: "running",
      resumable: true,
      resumeToken: recoveredToken
    }), sse({
      type: "stage",
      stage: "resuming-checkpoint"
    }), sse({
      type: "delta",
      delta: answer
    }), sse({
      type: "done",
      sessionId,
      executionId,
      message,
      pendingChanges: []
    })].join(""),
    execution: {
      id: executionId,
      projectId: "e2e-project",
      operationId: "e2e-interrupted-resume-operation",
      sessionId,
      status: "paused",
      flightState: "PAUSED",
      resumable: true,
      checkpointVersion: 1,
      checkpoint: {
        stage: "calling-model",
        detail: "The browser transport disconnected after the execution started."
      },
      objective: {
        objective: question
      },
      startedAt: "2026-01-01T00:01:00.000Z",
      createdAt: "2026-01-01T00:01:00.000Z",
      updatedAt: "2026-01-01T00:02:00.000Z"
    }
  };
}
async function createReleaseSignInUrl(page) {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) {
    throw new Error("CLERK_SECRET_KEY is required for the release-only programmatic Clerk handoff.");
  }
  const headers = {
    Authorization: `Bearer ${secretKey}`,
    "Content-Type": "application/json"
  };
  const userResponse = await page.request.get(`https://api.clerk.com/v1/users?email_address=${encodeURIComponent(TEST_USER.email)}`, {
    headers
  });
  let userId = parseClerkUserLookupResponse(await userResponse.json());
  if (!userId) {
    const createdResponse = await page.request.post("https://api.clerk.com/v1/users", {
      headers,
      data: {
        email_address: [TEST_USER.email],
        first_name: TEST_USER.firstName,
        last_name: TEST_USER.lastName,
        skip_password_checks: true,
        skip_password_requirement: true
      }
    });
    userId = parseCreatedClerkUserResponse(await createdResponse.json());
  }
  if (!userId) {
    throw new Error("The isolated Clerk release user could not be provisioned.");
  }
  const tokenResponse = await page.request.post("https://api.clerk.com/v1/sign_in_tokens", {
    headers,
    data: {
      user_id: userId
    }
  });
  const token = parseClerkSignInTokenResponse(await tokenResponse.json());
  return `${new URL(DASHBOARD_PATH, page.url()).toString()}sign-in?__clerk_ticket=${encodeURIComponent(token)}`;
}
async function programmaticSignIn(page) {
  var _globalThis$signInCle;
  await page.goto(DASHBOARD_PATH);
  await expect(page.getByRole("link", {
    name: "Sign In",
    exact: true
  })).toBeVisible();
  const helper = (_globalThis$signInCle = globalThis.signInClerkUser) !== null && _globalThis$signInCle !== void 0 ? _globalThis$signInCle : globalThis.__ENGINEERINGOS_SIGN_IN_CLERK_USER__;
  if (!helper) {
    if (process.env.RUN_CONTROLLED_RELEASE_VALIDATION !== "1") {
      throw new Error("Clerk browser helper is unavailable. Run this journey in the Replit browser runner, which injects signInClerkUser.");
    }
    await page.goto(await createReleaseSignInUrl(page));
    await expect(page).toHaveURL(new RegExp(`${DASHBOARD_PATH.replaceAll("/", "\\/")}$`));
    await completeReadinessHandshake(page);
    return;
  }
  const signInUrl = await helper({
    ...TEST_USER,
    ttl: 900,
    basePath: DASHBOARD_PATH
  });
  await page.goto(signInUrl);
  await expect(page).toHaveURL(new RegExp(`${DASHBOARD_PATH.replaceAll("/", "\\/")}$`));
  await completeReadinessHandshake(page);
}
async function completeReadinessHandshake(page) {
  const mode = dashboardTestMode();
  if (!TEST_MODES.has(mode)) {
    await writeReadinessReceipt("blocked", {
      mode: {
        status: "blocked",
        reason: "unsupported_test_mode"
      }
    });
    throw new Error(`BLOCKED: unsupported dashboard test mode (${mode}).`);
  }
  if (mode === "live-provider") {
    if (process.env.DASHBOARD_E2E_LIVE_PROVIDER !== "1") {
      await writeReadinessReceipt("blocked", {
        mode: {
          status: "ready"
        },
        provider: {
          status: "blocked",
          reason: "live_provider_not_enabled"
        }
      });
      throw new Error("BLOCKED: live-provider mode requires DASHBOARD_E2E_LIVE_PROVIDER=1.");
    }
    if (process.env.DASHBOARD_E2E_LIVE_DISPOSABLE !== "1") {
      await writeReadinessReceipt("blocked", {
        mode: {
          status: "ready"
        },
        provider: {
          status: "ready"
        },
        disposableProject: {
          status: "blocked",
          reason: "disposable_project_required"
        }
      });
      throw new Error("BLOCKED: live-provider mode requires an explicitly disposable project.");
    }
  }
  const deadline = Date.now() + readinessTimeoutMs();
  let lastStatus = "not attempted";
  const checks = {
    mode: {
      status: "ready"
    },
    provider: {
      status: mode === "live-provider" ? "ready" : "ready",
      ...(mode === "fixture" ? {
        reason: "provider_free_fixture"
      } : {})
    },
    disposableProject: {
      status: mode === "live-provider" ? "ready" : "ready",
      ...(mode === "fixture" ? {
        reason: "browser_fixture_project"
      } : {})
    }
  };
  while (Date.now() < deadline) {
    try {
      var _readinessBody$checks, _readinessBody$checks2, _readinessBody$checks3, _readinessBody$checks4, _readinessBody$checks5;
      await expectDashboardReady(page);
      const readiness = await page.evaluate(async url => {
        const response = await fetch(url, {
          credentials: "include"
        });
        return {
          ok: response.ok,
          body: await response.json().catch(() => ({}))
        };
      }, new URL("/api/readiness", page.url()).toString());
      const readinessBody = readiness.body;
      checks.api = {
        status: readiness.ok ? "ready" : "blocked"
      };
      checks.database = (_readinessBody$checks = (_readinessBody$checks2 = readinessBody.checks) === null || _readinessBody$checks2 === void 0 ? void 0 : _readinessBody$checks2.database) !== null && _readinessBody$checks !== void 0 ? _readinessBody$checks : {
        status: "blocked"
      };
      checks.schema = (_readinessBody$checks3 = (_readinessBody$checks4 = readinessBody.checks) === null || _readinessBody$checks4 === void 0 ? void 0 : _readinessBody$checks4.schema) !== null && _readinessBody$checks3 !== void 0 ? _readinessBody$checks3 : {
        status: "blocked"
      };
      if (readiness.ok && readinessBody.status === "ready" && Object.values((_readinessBody$checks5 = readinessBody.checks) !== null && _readinessBody$checks5 !== void 0 ? _readinessBody$checks5 : {}).every(check => check.status === "ready")) {
        const projectsResult = await page.evaluate(async url => {
          const response = await fetch(url, {
            credentials: "include"
          });
          return {
            ok: response.ok,
            body: await response.json().catch(() => [])
          };
        }, new URL("/api/projects", page.url()).toString());
        const projects = projectsResult.body;
        const expectedProject = mode === "live-provider" ? process.env.DASHBOARD_E2E_LIVE_PROJECT_ID : undefined;
        const fixtureProjectReady = mode === "fixture" ? projects.length > 0 && projects.every(project => Boolean(project.id)) : projects.some(project => project.id === expectedProject);
        if (projectsResult.ok && Array.isArray(projects) && fixtureProjectReady) {
          var _projects$;
          checks.auth = {
            status: "ready"
          };
          checks.fixtureProject = {
            status: "ready",
            project: expectedProject !== null && expectedProject !== void 0 ? expectedProject : (_projects$ = projects[0]) === null || _projects$ === void 0 ? void 0 : _projects$.id
          };
          await writeReadinessReceipt("ready", checks);
          return;
        }
        lastStatus = "fixture project unavailable";
      } else {
        lastStatus = readinessBody.checks && Object.entries(readinessBody.checks).filter(([, check]) => check.status !== "ready").map(([name]) => name).join(", ");
        if (!lastStatus) lastStatus = "readiness blocked";
      }
    } catch {
      lastStatus = "readiness request failed";
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  await writeReadinessReceipt("blocked", checks, lastStatus);
  throw new Error(`BLOCKED: dashboard readiness handshake did not complete (${lastStatus}).`);
}
async function openNavigation(page, label, path) {
  await page.getByRole("link", {
    name: label,
    exact: true
  }).click();
  await expect(page).toHaveURL(new RegExp(`${path.replaceAll("/", "\\/")}$`));
}
function apiUrl(page, path) {
  const apiBaseUrl = process.env.DASHBOARD_E2E_API_BASE_URL;
  return new URL(path, apiBaseUrl ? apiBaseUrl : page.url()).toString();
}
async function liveRequest(page, path, options) {
  var _options$method;
  return page.evaluate(async ({
    url,
    method,
    body,
    timeout
  }) => {
    const response = await fetch(url, {
      method,
      credentials: "include",
      headers: body === undefined ? undefined : {
        "Content-Type": "application/json"
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: timeout ? AbortSignal.timeout(timeout) : undefined
    });
    return {
      status: response.status,
      body: await response.text()
    };
  }, {
    url: apiUrl(page, path),
    method: (_options$method = options === null || options === void 0 ? void 0 : options.method) !== null && _options$method !== void 0 ? _options$method : "GET",
    body: options === null || options === void 0 ? void 0 : options.body,
    timeout: options === null || options === void 0 ? void 0 : options.timeout
  });
}
const recordedOriginDiagnostics = [];
function originDiagnosticPath() {
  return process.env.DASHBOARD_E2E_ORIGIN_DIAGNOSTICS_PATH;
}
function relevantOriginHeaders(headers) {
  return Object.fromEntries(ORIGIN_DIAGNOSTIC_HEADERS.flatMap(name => headers[name] ? [[name, headers[name]]] : []));
}
async function writeOriginDiagnostics() {
  const outputPath = originDiagnosticPath();
  if (!outputPath) return;
  await mkdir(dirname(outputPath), {
    recursive: true
  });
  await writeFile(outputPath, `${JSON.stringify({
    diagnostics: recordedOriginDiagnostics
  }, null, 2)}\n`, "utf8");
}
async function expectOriginCanUseApi(page, origin) {
  const apiBaseUrl = process.env.DASHBOARD_E2E_API_BASE_URL;
  if (!apiBaseUrl) {
    throw new Error("DASHBOARD_E2E_API_BASE_URL is required for origin checks.");
  }
  const healthUrl = new URL("/api/healthz", apiBaseUrl).toString();
  const mutationUrl = new URL("/api/ai/chat", apiBaseUrl).toString();
  const commonHeaders = {
    Origin: origin
  };
  const diagnostics = [];
  const check = async (phase, request, assertion) => {
    try {
      const response = await request();
      diagnostics.push({
        origin,
        phase,
        status: response.status(),
        headers: relevantOriginHeaders(response.headers())
      });
      recordedOriginDiagnostics.push(diagnostics.at(-1));
      await assertion(response);
    } catch (error) {
      const current = diagnostics.at(-1);
      if ((current === null || current === void 0 ? void 0 : current.phase) !== phase) {
        diagnostics.push({
          origin,
          phase
        });
      }
      diagnostics.at(-1).error = "origin check failed";
      await writeOriginDiagnostics();
      throw error;
    }
  };
  await check("GET", () => page.request.get(healthUrl, {
    headers: commonHeaders
  }), async response => {
    expect(response.status(), `${origin} credentialed GET status`).toBe(200);
    expect(response.headers()["access-control-allow-origin"]).toBe(origin);
    expect(response.headers()["access-control-allow-credentials"]).toBe("true");
  });
  await check("preflight", () => page.request.fetch(mutationUrl, {
    method: "OPTIONS",
    headers: {
      ...commonHeaders,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type"
    }
  }), async response => {
    var _response$headers$acc, _response$headers$acc2;
    expect(response.status(), `${origin} mutation preflight status`).toBe(204);
    expect(response.headers()["access-control-allow-origin"]).toBe(origin);
    expect(response.headers()["access-control-allow-credentials"], `${origin} mutation preflight credentials`).toBe("true");
    expect((_response$headers$acc = response.headers()["access-control-allow-methods"]) === null || _response$headers$acc === void 0 ? void 0 : _response$headers$acc.split(",").map(method => method.trim().toUpperCase()), `${origin} mutation preflight methods`).toContain("POST");
    expect((_response$headers$acc2 = response.headers()["access-control-allow-headers"]) === null || _response$headers$acc2 === void 0 ? void 0 : _response$headers$acc2.split(",").map(header => header.trim().toLowerCase()), `${origin} mutation preflight headers`).toContain("content-type");
  });
  await check("mutation", () => page.request.post(mutationUrl, {
    headers: {
      ...commonHeaders,
      "Content-Type": "application/json"
    },
    data: {
      message: "origin contract"
    }
  }), async response => {
    expect(response.status(), `${origin} state-changing request must pass origin protection`).not.toBe(403);
    expect(response.headers()["access-control-allow-origin"]).toBe(origin);
    expect(response.headers()["access-control-allow-credentials"]).toBe("true");
  });
  await writeOriginDiagnostics();
}
async function expectHostileOriginRejected(page) {
  const apiBaseUrl = process.env.DASHBOARD_E2E_API_BASE_URL;
  if (!apiBaseUrl) throw new Error("DASHBOARD_E2E_API_BASE_URL is required for origin checks.");
  const mutationUrl = new URL("/api/ai/chat", apiBaseUrl).toString();
  const uploadUrl = new URL("/api/upload/archive", apiBaseUrl).toString();
  const liveUpdateUrl = new URL("/api/ai/chat/stream", apiBaseUrl).toString();
  const diagnostic = {
    origin: HOSTILE_ORIGIN,
    phase: "rejection"
  };
  recordedOriginDiagnostics.push(diagnostic);
  try {
    const response = await page.request.post(mutationUrl, {
      headers: {
        Origin: HOSTILE_ORIGIN,
        "Content-Type": "application/json"
      },
      data: {
        message: "hostile origin contract"
      }
    });
    diagnostic.status = response.status();
    diagnostic.headers = relevantOriginHeaders(response.headers());
    expect(response.status()).toBe(403);
    expect(response.headers()["access-control-allow-origin"]).toBeUndefined();
    expect(response.headers()["access-control-allow-credentials"]).toBeUndefined();
    const hostileUpload = await page.request.post(uploadUrl, {
      headers: {
        Origin: HOSTILE_ORIGIN
      },
      multipart: {
        archive: {
          name: "hostile-dashboard-journey.zip",
          mimeType: "application/zip",
          buffer: Buffer.from("not an archive")
        }
      }
    });
    expect(hostileUpload.status()).toBe(403);
    expect(hostileUpload.headers()["access-control-allow-origin"]).toBeUndefined();
    const hostileLiveUpdate = await page.request.post(liveUpdateUrl, {
      headers: {
        Origin: HOSTILE_ORIGIN,
        "Content-Type": "application/json"
      },
      data: {}
    });
    expect(hostileLiveUpdate.status()).toBe(403);
    expect(hostileLiveUpdate.headers()["access-control-allow-origin"]).toBeUndefined();
  } catch (error) {
    diagnostic.error = "origin rejection check failed";
    await writeOriginDiagnostics();
    throw error;
  }
  await writeOriginDiagnostics();
}
function parseSse(body) {
  return body.split(/\n\n+/).flatMap(chunk => {
    var _chunk$split$find;
    const data = (_chunk$split$find = chunk.split("\n").find(line => line.startsWith("data: "))) === null || _chunk$split$find === void 0 ? void 0 : _chunk$split$find.slice("data: ".length);
    if (!data) return [];
    try {
      const value = JSON.parse(data);
      return value && typeof value === "object" ? [value] : [];
    } catch {
      return [];
    }
  });
}
async function liveJson(page, path) {
  const response = await liveRequest(page, path);
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Live correlation request failed: ${path} (${response.status})`);
  }
  return JSON.parse(response.body);
}
async function liveArray(page, path) {
  const response = await liveRequest(page, path);
  if (response.status === 404) return [];
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Live correlation request failed: ${path} (${response.status})`);
  }
  const value = JSON.parse(response.body);
  return Array.isArray(value) ? value : [];
}
async function liveOptionalRecord(page, path) {
  const response = await liveRequest(page, path);
  if (response.status === 404) return undefined;
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Live correlation request failed: ${path} (${response.status})`);
  }
  const value = JSON.parse(response.body);
  return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
}
test.describe("EngineeringOS dashboard browser journey", () => {
  test("exports one redacted live-provider mission correlation report", async ({
    page
  }) => {
    var _execution$operationI, _execution$flightStat, _gitLog$commits$0$sho, _gitLog$commits, _gitLog$commits2, _process$env$DASHBOAR6;
    // The Playwright deadline must leave room for the provider-bound request
    // and polling loop to consume their complete configured budget.
    test.setTimeout(liveTimeoutMs() + LIVE_TEST_TIMEOUT_MARGIN_MS);
    test.skip(process.env.DASHBOARD_E2E_LIVE_PROVIDER !== "1", "Live-provider release journey is opt-in.");
    if (process.env.DASHBOARD_E2E_LIVE_DISPOSABLE !== "1") {
      throw new Error("Live-provider journey requires DASHBOARD_E2E_LIVE_DISPOSABLE=1 and a disposable project.");
    }
    const campaignScenario = liveCampaignScenario();
    const projectId = process.env.DASHBOARD_E2E_LIVE_PROJECT_ID;
    if (!projectId) throw new Error("DASHBOARD_E2E_LIVE_PROJECT_ID is required for the live-provider journey.");
    await programmaticSignIn(page);
    const streamResponse = await liveRequest(page, "/api/ai/chat/stream", {
      method: "POST",
      timeout: liveTimeoutMs(),
      body: {
        projectId,
        message: livePrompt(),
        idempotencyKey: `dashboard-live-${Date.now()}`
      }
    });
    if (streamResponse.status < 200 || streamResponse.status >= 300) {
      throw new Error(`Live-provider mission failed to start (${streamResponse.status}).`);
    }
    const sseEvents = parseSse(streamResponse.body);
    const started = sseEvents.find(event => event.type === "execution_started");
    const executionId = typeof (started === null || started === void 0 ? void 0 : started.executionId) === "string" ? started.executionId : undefined;
    if (!executionId) throw new Error("Live-provider stream did not emit execution_started.");
    let execution = {};
    const deadline = Date.now() + liveTimeoutMs();
    while (Date.now() < deadline) {
      execution = await liveJson(page, `/api/ai/executions/${executionId}`);
      if (["completed", "failed", "cancelled"].includes(String(execution.status))) break;
      await new Promise(resolve => setTimeout(resolve, 750));
    }
    if (!["completed", "failed", "cancelled"].includes(String(execution.status))) {
      throw new Error("Live-provider mission did not reach a terminal state within its bound.");
    }
    const sessionId = String(execution.sessionId);
    const messages = await liveArray(page, `/api/ai/chat/${sessionId}/messages`);
    const events = await liveArray(page, `/api/events?projectId=${encodeURIComponent(projectId)}&correlationId=${encodeURIComponent(String((_execution$operationI = execution.operationId) !== null && _execution$operationI !== void 0 ? _execution$operationI : ""))}`);
    const proposal = await liveOptionalRecord(page, `/api/ai/chat/${sessionId}/pending-proposal`);
    const gitLog = await liveJson(page, `/api/projects/${projectId}/git/log`);
    const missionControl = await liveJson(page, "/api/ai/mission-control");
    const dashboardState = await liveJson(page, "/api/dashboard");
    const checkpoint = execution.checkpoint && typeof execution.checkpoint === "object" ? execution.checkpoint : {};
    const recentSteps = Array.isArray(checkpoint.recentSteps) ? checkpoint.recentSteps : [];
    const validation = recentSteps.filter(step => (step === null || step === void 0 ? void 0 : step.kind) === "validation");
    const projectRevision = typeof execution.projectRevision === "string" ? execution.projectRevision : undefined;
    const candidateHash = validation.map(step => {
      var _step$validation$cand, _step$validation;
      return (_step$validation$cand = step === null || step === void 0 || (_step$validation = step.validation) === null || _step$validation === void 0 ? void 0 : _step$validation.candidateHash) !== null && _step$validation$cand !== void 0 ? _step$validation$cand : step === null || step === void 0 ? void 0 : step.candidateHash;
    }).find(value => typeof value === "string" && value.length > 0);
    const candidateIdentity = typeof execution.candidateIdentity === "string" ? execution.candidateIdentity : candidateHash ? `candidate:${candidateHash}` : `read-only:${projectRevision !== null && projectRevision !== void 0 ? projectRevision : "unknown"}`;
    if (!projectRevision) {
      throw new Error("Live-provider mission is missing its project revision.");
    }
    if (process.env.DASHBOARD_E2E_LIVE_CAMPAIGN === "1" && (!candidateIdentity || !projectRevision)) {
      throw new Error("Live campaign requires operation, revision, and candidate correlation.");
    }
    const evidenceCount = recentSteps.reduce((count, step) => count + (Number(step === null || step === void 0 ? void 0 : step.acceptedEvidenceCount) || 0), 0);
    const terminalState = String((_execution$flightStat = execution.flightState) !== null && _execution$flightStat !== void 0 ? _execution$flightStat : execution.status).toUpperCase();
    const successStates = new Set(["COMPLETED", "READY_FOR_REVIEW", "APPLIED", "COMMITTED", "PUSHED"]);
    if (campaignScenario === "delivery-success" && successStates.has(terminalState) && !candidateHash) {
      throw new Error("Delivery-success campaign cannot pass without a candidate-bound validation hash.");
    }
    const deliveryStages = {
      applied: events.some(event => (event === null || event === void 0 ? void 0 : event.type) === "AiChangesApplied"),
      committed: events.some(event => (event === null || event === void 0 ? void 0 : event.type) === "GitCommitCreated"),
      pushed: events.some(event => (event === null || event === void 0 ? void 0 : event.type) === "GitPushed")
    };
    if (campaignScenario === "delivery-success" && successStates.has(terminalState) && !Object.values(deliveryStages).every(Boolean)) {
      throw new Error("Delivery-success campaign cannot pass without operation-correlated apply, commit, and push evidence.");
    }
    if (successStates.has(terminalState) && (evidenceCount < 1 || validation.length < 1)) {
      throw new Error(`Live-provider mission reported ${terminalState} without accepted evidence and validation ` + `(evidence=${evidenceCount}, validation=${validation.length}).`);
    }
    const capture = {
      projectId,
      sessionId,
      operationId: execution.operationId,
      workspaceRevision: (_gitLog$commits$0$sho = (_gitLog$commits = gitLog.commits) === null || _gitLog$commits === void 0 || (_gitLog$commits = _gitLog$commits[0]) === null || _gitLog$commits === void 0 ? void 0 : _gitLog$commits.shortHash) !== null && _gitLog$commits$0$sho !== void 0 ? _gitLog$commits$0$sho : (_gitLog$commits2 = gitLog.commits) === null || _gitLog$commits2 === void 0 || (_gitLog$commits2 = _gitLog$commits2[0]) === null || _gitLog$commits2 === void 0 || (_gitLog$commits2 = _gitLog$commits2.hash) === null || _gitLog$commits2 === void 0 ? void 0 : _gitLog$commits2.slice(0, 12),
      projectRevision,
      candidateIdentity,
      candidateRevision: projectRevision,
      campaignScenario,
      deliveryStages,
      currentOperation: {
        operationId: execution.operationId,
        revision: projectRevision,
        status: execution.status,
        terminalState
      },
      retainedResult: terminalState === "FAILED" || terminalState === "BLOCKED" || terminalState === "INCOMPLETE" ? {
        operationId: execution.operationId,
        revision: projectRevision,
        label: "retained result from the current failed or incomplete operation"
      } : undefined,
      terminalState,
      execution: {
        id: execution.id,
        projectId: execution.projectId,
        sessionId: execution.sessionId,
        operationId: execution.operationId,
        status: execution.status,
        flightState: execution.flightState
      },
      messages: messages.map(({
        id,
        sessionId: messageSession,
        role,
        executionId: messageExecution,
        outcome
      }) => ({
        id,
        sessionId: messageSession,
        role,
        executionId: messageExecution,
        outcome
      })),
      sseEvents: sseEvents.map(({
        type,
        executionId: eventExecution,
        sessionId: eventSession,
        outcome,
        code
      }) => ({
        type,
        executionId: eventExecution,
        sessionId: eventSession,
        outcome,
        code
      })),
      checkpoints: [{
        sequence: checkpoint.sequence,
        stage: checkpoint.stage,
        updatedAt: checkpoint.updatedAt
      }],
      evidenceCount,
      proposals: proposal ? [{
        id: proposal.id,
        revision: proposal.revision,
        status: proposal.status
      }] : [],
      validation: validation.map(step => {
        var _step$validation$stat, _step$validation2, _step$validation$prof, _step$validation3;
        return {
          status: (_step$validation$stat = (_step$validation2 = step.validation) === null || _step$validation2 === void 0 ? void 0 : _step$validation2.status) !== null && _step$validation$stat !== void 0 ? _step$validation$stat : step.status,
          profile: (_step$validation$prof = (_step$validation3 = step.validation) === null || _step$validation3 === void 0 ? void 0 : _step$validation3.profile) !== null && _step$validation$prof !== void 0 ? _step$validation$prof : step.validationProfile
        };
      }),
      events: events.map(({
        type,
        severity,
        correlationId
      }) => ({
        type,
        severity,
        correlationId
      })),
      dashboard: missionControl,
      dashboardState: {
        projectCount: dashboardState.projectCount,
        activeTaskCount: dashboardState.activeTaskCount
      }
    };
    const outputPath = (_process$env$DASHBOAR6 = process.env.DASHBOARD_E2E_LIVE_REPORT_PATH) !== null && _process$env$DASHBOAR6 !== void 0 ? _process$env$DASHBOAR6 : "test-results/dashboard-journey/live-mission-correlation.json";
    await mkdir(dirname(outputPath), {
      recursive: true
    });
    await writeFile(outputPath, `${JSON.stringify(capture, null, 2)}\n`, "utf8");
  });
  test("signs in and traverses the authenticated operational shell", async ({
    page
  }) => {
    await installApiFixtures(page);
    await programmaticSignIn(page);
    for (const origin of approvedDashboardOrigins()) {
      await expectOriginCanUseApi(page, origin);
    }
    await expectHostileOriginRejected(page);
    await expect(page.getByRole("heading", {
      name: "System Overview"
    })).toBeVisible();
    await expect(page.getByText("SYSTEM ONLINE", {
      exact: true
    })).toBeVisible();
    await expect(page.getByText("Smoke Project", {
      exact: true
    }).first()).toBeVisible();
    await expect(page.getByText("Dashboard API fixture ready", {
      exact: true
    })).toBeVisible();
    await openNavigation(page, "Projects", `${DASHBOARD_PATH}projects`);
    await expect(page.getByRole("heading", {
      name: "Projects"
    })).toBeVisible();
    await expect(page.getByText("Smoke Project", {
      exact: true
    })).toBeVisible();
    await openNavigation(page, "Event Stream", `${DASHBOARD_PATH}events`);
    await expect(page.getByRole("heading", {
      name: "Event Stream"
    })).toBeVisible();
    await expect(page.getByText("Dashboard API fixture ready", {
      exact: true
    })).toBeVisible();
    await openNavigation(page, "AI Assistant", `${DASHBOARD_PATH}ai`);
    await expect(page).not.toHaveURL(/sign-in/);
    await expect(page.getByText(/AI provider not configured|No AI key configured|AI Assistant/i).first()).toBeVisible();
    await openNavigation(page, "Mission Control", `${DASHBOARD_PATH}mission-control`);
    await expect(page.getByRole("heading", {
      name: "No durable runs in the ledger"
    })).toBeVisible();
    await page.goto(`${DASHBOARD_PATH}flight-deck?executionId=${EXECUTION_ID}`);
    await expect(page).toHaveURL(new RegExp(`${DASHBOARD_PATH.replaceAll("/", "\\/")}flight-deck\\?executionId=`));
    await expect(page.getByRole("heading", {
      name: "Audit / Chat run"
    })).toBeVisible();
    await expect(page.getByText("Controlled browser fixture completed.", {
      exact: true
    })).toBeVisible();
    await expect(page.getByText("PROVEN", {
      exact: true
    }).first()).toBeVisible();
  });
  test("opens failed task and workflow details with redacted recovery guidance", async ({
    page
  }) => {
    const rawDiagnostic = "provider diagnostic: upstream returned raw response";
    const rawCredential = "sk-e2e-browser-credential-secret";
    const supportReferences = {
      authentication_failed: "support-task-auth-32",
      quota_exhausted: "support-task-quota-32",
      provider_outage: "support-workflow-outage-32"
    };
    const recoveryTasks = [{
      id: "e2e-auth-failed-task",
      projectId: "e2e-project",
      title: "Recover authentication failure",
      description: "The provider authentication test task failed.",
      status: "failed",
      priority: "p1",
      relatedFiles: ["src/provider.ts"],
      retryCount: 1,
      maxRetries: 2,
      agentResponse: JSON.stringify({
        kind: "AI_TASK_EXECUTION_RECEIPT",
        terminalStatus: "FAILED",
        availabilityState: "authentication_failed",
        correlationId: supportReferences.authentication_failed,
        operatorAction: "Replace the provider API key with a valid key, then retry.",
        provider: "openrouter",
        model: "secret-model-name",
        terminalReason: rawDiagnostic,
        operationId: rawCredential
      }),
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:01:00.000Z"
    }, {
      id: "e2e-quota-failed-task",
      projectId: "e2e-project",
      title: "Recover quota exhaustion",
      description: "The provider quota test task failed.",
      status: "failed",
      priority: "p1",
      retryCount: 0,
      maxRetries: 2,
      agentResponse: JSON.stringify({
        kind: "AI_TASK_EXECUTION_RECEIPT",
        terminalStatus: "FAILED",
        availabilityState: "quota_exhausted",
        correlationId: supportReferences.quota_exhausted,
        provider: "openrouter",
        model: "secret-model-name",
        terminalReason: rawDiagnostic,
        operationId: rawCredential
      }),
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:01:00.000Z"
    }];
    const workflowId = "e2e-outage-workflow";
    await installApiFixtures(page, {
      recoveryTasks,
      recoveryWorkflows: [{
        id: workflowId,
        projectId: "e2e-project",
        name: "Recover provider outage",
        description: "A pipeline used to verify outage recovery guidance.",
        status: "failed",
        phases: [{
          name: "build",
          steps: ["compile"]
        }, {
          name: "test",
          steps: ["verify"]
        }],
        currentPhase: "test",
        executionCount: 1,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:01:00.000Z"
      }],
      recoveryWorkflowExecutions: {
        [workflowId]: [{
          id: "e2e-outage-execution",
          workflowId,
          status: "failed",
          currentPhase: "test",
          completedPhases: ["build"],
          startedAt: "2026-01-01T00:00:00.000Z",
          errorMessage: rawDiagnostic,
          recovery: {
            availabilityState: "provider_outage",
            correlationId: supportReferences.provider_outage,
            operatorAction: "Retry in a moment; configure another provider if the issue persists.",
            diagnostic: rawCredential
          }
        }]
      }
    });
    await programmaticSignIn(page);
    await openNavigation(page, "Tasks", `${DASHBOARD_PATH}tasks`);
    await expect(page.getByLabel("Expand task Recover authentication failure")).toBeVisible();
    await page.getByLabel("Expand task Recover authentication failure").click();
    const taskDetails = page.locator("#task-details-e2e-auth-failed-task");
    await expect(taskDetails).toContainText("Provider authentication failed");
    await expect(taskDetails).toContainText("Replace the provider API key with a valid key, then retry.");
    await expect(taskDetails).toContainText(`Support reference: ${supportReferences.authentication_failed}`);
    await page.getByLabel("Expand task Recover quota exhaustion").click();
    await expect(page.getByText("Provider quota is exhausted")).toBeVisible();
    await expect(page.getByText(`Support reference: ${supportReferences.quota_exhausted}`)).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Expand task Recover authentication failure")).toBeVisible();
    await page.getByLabel("Expand task Recover authentication failure").click();
    const reloadedAuthDetails = page.locator("#task-details-e2e-auth-failed-task");
    await expect(reloadedAuthDetails).toContainText("Provider authentication failed");
    await expect(reloadedAuthDetails).toContainText("Replace the provider API key with a valid key, then retry.");
    await expect(reloadedAuthDetails).toContainText(`Support reference: ${supportReferences.authentication_failed}`);
    await page.getByLabel("Expand task Recover quota exhaustion").click();
    await expect(page.getByText("Provider quota is exhausted")).toBeVisible();
    await expect(page.getByText(`Support reference: ${supportReferences.quota_exhausted}`)).toBeVisible();
    const reloadedTaskText = await page.locator("body").innerText();
    expect(reloadedTaskText).not.toContain(rawDiagnostic);
    expect(reloadedTaskText).not.toContain(rawCredential);
    expect(reloadedTaskText).not.toMatch(/secret-model-name|\/home\/runner|\/tmp\//i);
    await openNavigation(page, "Workflows", `${DASHBOARD_PATH}workflows`);
    await expect(page.getByText("Recover provider outage")).toBeVisible();
    await page.getByRole("button", {
      name: "Execution history"
    }).click();
    const execution = page.getByText("failed · no successful completion").locator("..").locator("..");
    await expect(execution).toContainText("The provider is temporarily unavailable");
    await expect(execution).toContainText("Retry in a moment; configure another provider if the issue persists.");
    await expect(execution).toContainText(`Support reference: ${supportReferences.provider_outage}`);
    await page.reload();
    await expect(page.getByText("Recover provider outage")).toBeVisible();
    await page.getByRole("button", {
      name: "Execution history"
    }).click();
    const reloadedExecution = page.getByText("failed · no successful completion").locator("..").locator("..");
    await expect(reloadedExecution).toContainText("The provider is temporarily unavailable");
    await expect(reloadedExecution).toContainText("Retry in a moment; configure another provider if the issue persists.");
    await expect(reloadedExecution).toContainText(`Support reference: ${supportReferences.provider_outage}`);
    const visibleText = await page.locator("body").innerText();
    expect(visibleText).not.toContain(rawDiagnostic);
    expect(visibleText).not.toContain(rawCredential);
    expect(visibleText).not.toMatch(/secret-model-name|\/home\/runner|\/tmp\//i);
    await expectNoHorizontalOverflow(page);
  });
  test("proves remediation plans, review state, and task action transitions", async ({
    page
  }) => {
    const rawPrompt = "INTERNAL_PROMPT_should_never_render";
    const rawDiagnostic = "raw-provider-diagnostic-should-never-render";
    const readyTaskId = "e2e-ready-remediation-task";
    const reviewTaskId = "e2e-review-remediation-task";
    const verificationTaskId = "e2e-verification-remediation-task";
    const remediationTasks = [{
      id: readyTaskId,
      projectId: "e2e-project",
      title: "Execute SQL input sanitization remediation",
      description: "A complete remediation plan is ready for operator execution.",
      status: "pending",
      priority: "p1",
      phase: "Remediation",
      relatedFiles: ["src/auth/input.ts"],
      retryCount: 0,
      maxRetries: 2,
      prompt: rawPrompt,
      agentResponse: JSON.stringify({
        kind: "AI_TASK_EXECUTION_RECEIPT",
        terminalStatus: "RECORDED",
        terminalReason: rawDiagnostic
      }),
      remediationPlan: {
        version: 1,
        ruleId: "e2e-rule-sql-input",
        ruleCode: "SEC-001",
        ruleTitle: "Unsanitized SQL input",
        severity: "high",
        occurrenceCount: 2,
        evidence: [{
          file: "src/auth/input.ts",
          line: 10,
          snippet: "query(userInput)",
          occurrences: 1
        }, {
          file: "src/auth/input.ts",
          line: 18,
          snippet: "query(accountId)",
          occurrences: 1
        }, {
          file: "src/auth/input.ts",
          line: 27,
          snippet: "query(filter)",
          occurrences: 1
        }, {
          file: "src/auth/input.ts",
          line: 31,
          snippet: "query(sort)",
          occurrences: 1
        }, {
          file: "src/auth/input.ts",
          line: 44,
          snippet: "query(limit)",
          occurrences: 1
        }, {
          file: "src/auth/input.ts",
          line: 52,
          snippet: "query(offset)",
          occurrences: 1
        }],
        relatedFiles: ["src/auth/input.ts"],
        fixDescription: "Use the parameterized query helper for every user-controlled value.",
        verificationSteps: ["Run the SQL injection regression test.", "Confirm all user-controlled query values use parameters."],
        source: {
          type: "scan",
          correlationId: "e2e-scan-correlation",
          revision: "remediation-revision-42",
          completeness: "COMPLETE"
        },
        status: "ready"
      },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:01:00.000Z"
    }, {
      id: reviewTaskId,
      projectId: "e2e-project",
      title: "Review incomplete SQL remediation evidence",
      description: "An incomplete plan must stay blocked until an operator reviews it.",
      status: "failed",
      priority: "p1",
      phase: "Remediation",
      relatedFiles: ["src/auth/input.ts"],
      retryCount: 0,
      maxRetries: 2,
      prompt: rawPrompt,
      agentResponse: JSON.stringify({
        kind: "AI_TASK_EXECUTION_RECEIPT",
        terminalStatus: "FAILED",
        terminalReason: rawDiagnostic
      }),
      remediationPlan: {
        version: 1,
        ruleId: "e2e-rule-missing-evidence",
        ruleCode: "SEC-002",
        ruleTitle: "Incomplete evidence review",
        severity: "critical",
        occurrenceCount: 1,
        evidence: [],
        relatedFiles: ["src/auth/input.ts"],
        fixDescription: null,
        verificationSteps: [],
        source: {
          type: "discovery",
          correlationId: "e2e-discovery-correlation",
          revision: null,
          completeness: "PARTIAL"
        },
        status: "needs_review"
      },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:01:00.000Z"
    }, {
      id: verificationTaskId,
      projectId: "e2e-project",
      title: "Verify parameterized SQL remediation",
      description: "An operator must record evidence for every verification check.",
      status: "verifying",
      priority: "p1",
      phase: "Remediation",
      relatedFiles: ["src/auth/input.ts"],
      retryCount: 0,
      maxRetries: 2,
      prompt: rawPrompt,
      remediationPlan: {
        version: 1,
        ruleId: "e2e-rule-verification",
        ruleCode: "SEC-003",
        ruleTitle: "Parameterized SQL remediation",
        severity: "high",
        occurrenceCount: 2,
        evidence: [{
          file: "src/auth/input.ts",
          line: 10,
          snippet: "query(userInput)",
          occurrences: 1
        }],
        relatedFiles: ["src/auth/input.ts"],
        fixDescription: "Use the parameterized query helper for every user-controlled value.",
        verificationSteps: ["Run the SQL injection regression test.", "Confirm all user-controlled query values use parameters."],
        source: {
          type: "scan",
          correlationId: "e2e-verification-correlation",
          revision: "remediation-revision-43",
          completeness: "COMPLETE"
        },
        status: "ready"
      },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:03:00.000Z"
    }];
    const actionRequests = [];
    const verificationRequests = [];
    await installApiFixtures(page, {
      taskActions: {
        tasks: remediationTasks,
        requests: actionRequests,
        verificationRequests
      }
    });
    await programmaticSignIn(page);
    await openNavigation(page, "Tasks", `${DASHBOARD_PATH}tasks`);
    const readyRow = page.getByRole("button", {
      name: /task Execute SQL input sanitization remediation/
    });
    await expect(readyRow).toBeVisible();
    await expect(page.getByTitle("Execute")).toBeVisible();
    await readyRow.click();
    const readyDetails = page.locator(`#task-details-${readyTaskId}`);
    const readyPlan = readyDetails.getByRole("region", {
      name: "Remediation plan"
    });
    await expect(readyPlan).toBeVisible();
    await expect(readyPlan).toContainText("SEC-001");
    await expect(readyPlan).toContainText("Unsanitized SQL input");
    await expect(readyPlan).toContainText("high");
    await expect(readyPlan).toContainText("2 occurrence(s)");
    await expect(readyPlan).toContainText("src/auth/input.ts:10");
    await expect(readyPlan).toContainText("src/auth/input.ts:44");
    await expect(readyPlan).toContainText("+1 more evidence items");
    await expect(readyPlan).not.toContainText("src/auth/input.ts:52");
    await expect(readyPlan).toContainText("Use the parameterized query helper for every user-controlled value.");
    await expect(readyPlan).toContainText("Run the SQL injection regression test.");
    await expect(readyPlan).toContainText("Confirm all user-controlled query values use parameters.");
    await expect(readyPlan).toContainText("Ready to execute");
    await expect(readyPlan).toContainText("Source: scan");
    await expect(readyPlan).toContainText("revision remediation-");
    await expect(readyDetails.getByRole("button", {
      name: "Details"
    })).toBeVisible();
    await page.getByTitle("Execute").click();
    await expect.poll(() => actionRequests.length).toBe(1);
    expect(actionRequests[0]).toBe(`execute:${readyTaskId}`);
    await expect(readyRow).toContainText("running");
    await expect(page.getByTitle("Execute")).toHaveCount(0);
    const reviewRow = page.getByRole("button", {
      name: /task Review incomplete SQL remediation evidence/
    });
    await reviewRow.click();
    const reviewDetails = page.locator(`#task-details-${reviewTaskId}`);
    const reviewPlan = reviewDetails.getByRole("region", {
      name: "Remediation plan"
    });
    await expect(reviewPlan).toBeVisible();
    await expect(reviewPlan).toContainText("SEC-002");
    await expect(reviewPlan).toContainText("Incomplete evidence review");
    await expect(reviewPlan).toContainText("critical");
    await expect(reviewPlan).toContainText("1 occurrence(s)");
    await expect(reviewPlan).toContainText("Needs review");
    await expect(reviewPlan).toContainText("No bounded evidence was retained.");
    await expect(reviewPlan).toContainText("No verification steps supplied.");
    await expect(reviewPlan).toContainText("Source: discovery");
    await expect(reviewPlan).toContainText("revision unavailable");
    await expect(page.getByTitle("Retry")).toBeVisible();
    await page.getByTitle("Retry").click();
    await expect.poll(() => actionRequests.length).toBe(2);
    expect(actionRequests[1]).toBe(`retry:${reviewTaskId}`);
    await expect(reviewRow).toContainText("queued");
    await expect(page.getByTitle("Retry")).toHaveCount(0);
    const verificationRow = page.getByRole("button", {
      name: /task Verify parameterized SQL remediation/
    });
    await verificationRow.click();
    const verificationDetails = page.locator(`#task-details-${verificationTaskId}`);
    const verificationPlan = verificationDetails.getByRole("region", {
      name: "Remediation plan"
    });
    const verificationChecks = verificationDetails.getByRole("region", {
      name: "Operator verification checks"
    });
    await expect(verificationPlan).toContainText("SEC-003");
    await expect(verificationPlan).toContainText("Ready to execute");
    await verificationDetails.getByRole("button", {
      name: "Run and record verification checks"
    }).click();
    await expect(verificationChecks).toBeVisible();
    await expect(verificationChecks).toContainText("Incomplete");
    const firstGuidance = "Run the SQL injection regression test.";
    const secondGuidance = "Confirm all user-controlled query values use parameters.";
    const firstEvidence = verificationChecks.getByLabel(`Evidence for ${firstGuidance}`);
    const secondEvidence = verificationChecks.getByLabel(`Evidence for ${secondGuidance}`);
    const passButtons = verificationChecks.getByRole("button", {
      name: "Record passed"
    });
    const failedButtons = verificationChecks.getByRole("button", {
      name: "Record failed"
    });
    await expect(passButtons.nth(0)).toBeDisabled();
    await firstEvidence.fill("The regression test still fails before the fix.");
    await failedButtons.nth(0).click();
    await expect.poll(() => verificationRequests.length).toBe(1);
    expect(verificationRequests[0]).toMatchObject({
      taskId: verificationTaskId,
      checkId: "rule-verification-1",
      passed: false
    });
    await expect(verificationChecks).toContainText("Incomplete");
    await expect(verificationRow).toContainText("verifying");
    await firstEvidence.fill("The focused regression test passes after the fix.");
    await passButtons.nth(0).click();
    await expect.poll(() => verificationRequests.length).toBe(2);
    expect(verificationRequests[1]).toMatchObject({
      taskId: verificationTaskId,
      checkId: "rule-verification-1",
      passed: true,
      evidence: "The focused regression test passes after the fix."
    });
    await expect(verificationChecks).toContainText("Incomplete");
    await secondEvidence.fill("All user-controlled query values use the parameterized helper.");
    await passButtons.nth(1).click();
    await expect.poll(() => verificationRequests.length).toBe(3);
    expect(verificationRequests[2]).toMatchObject({
      taskId: verificationTaskId,
      checkId: "rule-verification-2",
      passed: true,
      evidence: "All user-controlled query values use the parameterized helper."
    });
    await expect(verificationRow).toContainText("completed");
    await verificationDetails.getByRole("button", {
      name: "Details"
    }).click();
    await expect(verificationPlan).toContainText("Verified");
    await verificationDetails.getByRole("button", {
      name: "Logs"
    }).click();
    await expect(verificationChecks).toContainText("Verified");
    await expect(verificationDetails).toContainText("Task completed and verified by the server.");
    await page.reload();
    const reloadedVerificationRow = page.getByRole("button", {
      name: /task Verify parameterized SQL remediation/
    });
    await expect(reloadedVerificationRow).toContainText("completed");
    await reloadedVerificationRow.click();
    const reloadedDetails = page.locator(`#task-details-${verificationTaskId}`);
    await reloadedDetails.getByRole("button", {
      name: "Logs"
    }).click();
    await expect(reloadedDetails.getByRole("region", {
      name: "Operator verification checks"
    })).toContainText("Verified");
    await expect(reloadedDetails).toContainText("Task completed and verified by the server.");
    const visibleText = await page.locator("body").innerText();
    expect(visibleText).not.toContain(rawPrompt);
    expect(visibleText).not.toContain(rawDiagnostic);
    await expectNoHorizontalOverflow(page);
  });
  test("converges two browser sessions across reload, reconnect, stale results, and API restart", async ({
    browser,
    page
  }) => {
    test.skip(!process.env.DASHBOARD_E2E_CONTROL_URL, "The multi-process convergence campaign runs only under the release runner.");
    test.setTimeout(90000);
    const secondContext = await browser.newContext();
    const secondPage = await secondContext.newPage();
    try {
      await Promise.all([installApiFixtures(page), installApiFixtures(secondPage)]);
      await Promise.all([programmaticSignIn(page), programmaticSignIn(secondPage)]);
      await Promise.all([page.goto(DASHBOARD_PATH), secondPage.goto(`${DASHBOARD_PATH}ai`)]);
      await expectDashboardReady(page);
      await expect(secondPage.locator("textarea").first()).toBeVisible();

      // A response that arrives after a newer request must not replace the
      // visible ready state with stale data. Keep the delay bounded so a
      // hung request cannot make this campaign pass indefinitely.
      const currentDashboardFixture = {
        ...dashboardFixture,
        // The release runner starts against real development data, whose
        // server-owned revision may be newer than the static fixture below.
        // Keep this synthetic "current" response ahead of that watermark so
        // the test exercises stale-response rejection rather than fixture
        // rejection.
        freshnessRevision: "2099-01-01T00:03:00.000Z",
        projectScores: [{
          ...dashboardFixture.projectScores[0],
          projectName: "Concurrent Project",
          score: 97
        }],
        activeTaskCount: 1,
        taskStatusBreakdown: {
          pending: 0,
          running: 1
        }
      };
      let refreshCount = 0;
      let releaseStaleResponse;
      const staleResponseReleased = new Promise(resolve => {
        releaseStaleResponse = resolve;
      });
      await page.route("**/api/dashboard", async route => {
        refreshCount += 1;
        if (refreshCount === 1) return route.fulfill(jsonResponse(currentDashboardFixture));
        await staleResponseReleased;
        return route.fulfill(jsonResponse(dashboardFixture));
      });
      await page.getByRole("button", {
        name: "Refresh status"
      }).click();
      await expect(page.getByText("Concurrent Project", {
        exact: true
      })).toBeVisible();
      await expect(page.getByText("97", {
        exact: true
      })).toBeVisible();
      const staleRefresh = page.getByRole("button", {
        name: "Refresh status"
      }).click();
      await expect.poll(() => refreshCount).toBe(2);
      releaseStaleResponse();
      await staleRefresh;
      await expectDashboardReady(page);
      await expect(page.getByText("Concurrent Project", {
        exact: true
      })).toBeVisible();
      await expect(page.getByText("97", {
        exact: true
      })).toBeVisible();
      await expect(page.getByText("1", {
        exact: true
      }).first()).toBeVisible();

      // Simulate a dropped connection in the second browser and assert the
      // recovery action rendered by the dashboard, then let the next request
      // reconnect normally.
      let reconnectAttempt = 0;
      await secondPage.goto(DASHBOARD_PATH);
      await expectDashboardReady(secondPage);
      await secondPage.route("**/api/dashboard", async route => {
        reconnectAttempt += 1;
        // useGetDashboard retries once; hold both bounded attempts so the
        // rendered error state is observable before the operator retries.
        if (reconnectAttempt <= 2) {
          return route.fulfill(jsonResponse({
            error: "controlled reconnect interruption"
          }, 503));
        }
        return route.continue();
      });
      await secondPage.reload();
      await expect(secondPage.getByRole("heading", {
        name: "Failed to load dashboard"
      })).toBeVisible();
      await expect(secondPage.getByRole("button", {
        name: "Retry Connection"
      })).toBeVisible();
      await secondPage.unroute("**/api/dashboard");
      await secondPage.getByRole("button", {
        name: "Retry Connection"
      }).click();
      await expectDashboardReady(secondPage);
      await restartApiForCampaign(page);
      await Promise.all([page.reload(), secondPage.reload()]);
      await expectDashboardReady(page);
      await expectDashboardReady(secondPage);
      await page.reload();
      await expectDashboardReady(page);
      await expect(page.getByRole("button", {
        name: "Retry Connection"
      })).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
    } finally {
      await secondContext.close();
    }
  });
  test("previews and downloads the completed execution audit without duplicating effects", async ({
    page
  }) => {
    const auditRequests = [];
    const auditBody = {
      format: "engineeringos.execution-audit.v1",
      exportedAt: "2026-01-01T00:02:00.000Z",
      execution: {
        id: EXECUTION_ID,
        projectId: "e2e-project",
        sessionId: "e2e-audit-session",
        operationId: executionFixture.operationId,
        status: "completed",
        terminalState: "completed",
        revision: "e2e-revision-42",
        proof: {
          required: false,
          verdict: "PROVEN"
        }
      },
      timeline: [],
      validations: [{
        status: "passed",
        profile: "release-safe"
      }],
      affectedFiles: ["src/feature.ts"],
      redaction: {
        excluded: ["provider secrets", "raw model output", "private runtime paths"]
      }
    };
    await installApiFixtures(page, {
      auditExport: {
        body: auditBody,
        filename: "server-supplied-audit-name.json",
        requests: auditRequests,
        failFirstPreview: true
      }
    });
    await programmaticSignIn(page);
    await page.evaluate(() => {
      const execution = {
        id: "e2e-controlled-execution",
        projectId: "e2e-project",
        sessionId: "e2e-audit-session",
        message: "Completed audit execution"
      };
      localStorage.setItem("eos_ai_execution_current_e2e-project", "e2e-audit-session");
      localStorage.setItem("eos_ai_execution_e2e-project_e2e-audit-session", JSON.stringify(execution));
    });
    await page.goto(`${DASHBOARD_PATH}ai`);
    const proof = page.getByLabel("Agent execution proof");
    await expect(proof).toBeVisible();
    await expect(proof).toContainText(/completed/i);
    await expect(proof).toContainText("Revision: e2e-revision-42");
    await proof.getByRole("button", {
      name: "Preview audit"
    }).click();
    const preview = page.getByLabel("Redacted audit preview");
    await expect(preview).toBeVisible();
    await expect(preview).toContainText("Audit preview temporarily unavailable");
    await expect(preview).toContainText("same execution and revision");
    await expect(preview.getByRole("button", {
      name: "Retry preview"
    })).toBeVisible();
    expect(auditRequests).toHaveLength(1);
    await preview.getByRole("button", {
      name: "Retry preview"
    }).click();
    await expect(preview).toContainText("provider secrets");
    await expect(preview).toContainText("raw model output");
    await expect(preview).toContainText("private runtime paths");
    await expect(preview).toContainText(EXECUTION_ID);
    await expect(preview).toContainText("e2e-operation");
    await expect(preview).toContainText("e2e-revision-42");
    expect(auditRequests).toHaveLength(2);
    expect(new URL(auditRequests[0]).pathname).toBe(`/api/ai/executions/${EXECUTION_ID}/audit-export`);
    await preview.getByRole("button", {
      name: "Close audit preview"
    }).click();
    await expect(preview).toBeHidden();
    const downloadPromise = page.waitForEvent("download");
    await proof.getByRole("button", {
      name: "Export audit"
    }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("server-supplied-audit-name.json");
    expect(auditRequests).toHaveLength(3);
    await page.reload();
    const reloadedProof = page.getByLabel("Agent execution proof");
    await expect(reloadedProof).toBeVisible();
    await expect(reloadedProof).toContainText(/completed/i);
    await expect(reloadedProof).toContainText("Execution e2e-controlled-execution");
    await expect(reloadedProof).toContainText("Revision: e2e-revision-42");
    await expect(page.getByLabel("Redacted audit preview")).toBeHidden();
    expect(auditRequests).toHaveLength(3);
  });
  test("keeps the cancelled execution audit handoff redacted and terminal", async ({
    page
  }) => {
    const auditRequests = [];
    const cancelledExecution = {
      ...executionFixture,
      status: "cancelled",
      flightState: "CANCELLED",
      checkpoint: {
        stage: "cancelled",
        detail: "Execution cancelled before any changes were applied."
      },
      terminalReason: "cancel_requested",
      completedAt: "2026-01-01T00:01:30.000Z",
      updatedAt: "2026-01-01T00:01:30.000Z"
    };
    const auditBody = {
      format: "engineeringos.execution-audit.v1",
      exportedAt: "2026-01-01T00:02:00.000Z",
      execution: {
        id: EXECUTION_ID,
        projectId: "e2e-project",
        sessionId: "e2e-audit-session",
        operationId: executionFixture.operationId,
        status: "cancelled",
        terminalState: "cancelled",
        revision: "e2e-revision-42",
        proof: {
          required: false,
          verdict: "NOT_RECORDED"
        }
      },
      timeline: [{
        type: "cancelled",
        detail: "Cancellation accepted by the server."
      }],
      validations: [],
      affectedFiles: [],
      redaction: {
        excluded: ["provider secrets", "raw model output", "private runtime paths"]
      }
    };
    await installApiFixtures(page, {
      auditExport: {
        body: auditBody,
        filename: "cancelled-server-audit.json",
        requests: auditRequests,
        execution: cancelledExecution,
        messageOutcome: "CANCELLED",
        failFirstPreview: true
      }
    });
    await programmaticSignIn(page);
    await page.evaluate(() => {
      const execution = {
        id: "e2e-controlled-execution",
        projectId: "e2e-project",
        sessionId: "e2e-audit-session",
        message: "Cancelled audit execution"
      };
      localStorage.setItem("eos_ai_execution_current_e2e-project", "e2e-audit-session");
      localStorage.setItem("eos_ai_execution_e2e-project_e2e-audit-session", JSON.stringify(execution));
    });
    await page.goto(`${DASHBOARD_PATH}ai`);
    const proof = page.getByLabel("Agent execution proof");
    await expect(proof).toBeVisible();
    await expect(proof).toContainText("Cancelled");
    await expect(proof).toContainText("Execution e2e-controlled-execution");
    await expect(proof).toContainText("Revision: e2e-revision-42");
    await expect(proof).toContainText("Terminal reason: cancel_requested");
    await expect(proof.getByRole("button", {
      name: "Cancel"
    })).toHaveCount(0);
    await expect(proof.getByRole("button", {
      name: "Resume"
    })).toHaveCount(0);
    await expect(proof.getByRole("button", {
      name: "Approve & apply"
    })).toHaveCount(0);
    await expect(proof.getByRole("button", {
      name: /commit verified changes/i
    })).toHaveCount(0);
    await expect(proof.getByRole("button", {
      name: /push committed changes/i
    })).toHaveCount(0);
    await proof.getByRole("button", {
      name: "Preview audit"
    }).click();
    const preview = page.getByLabel("Redacted audit preview");
    await expect(preview).toBeVisible();
    await expect(preview).toContainText("Audit preview temporarily unavailable");
    await expect(preview).toContainText("same execution and revision");
    await expect(preview.getByRole("button", {
      name: "Retry preview"
    })).toBeVisible();
    expect(auditRequests).toHaveLength(1);
    await preview.getByRole("button", {
      name: "Retry preview"
    }).click();
    await expect(preview).toContainText("cancelled");
    await expect(preview).toContainText(EXECUTION_ID);
    await expect(preview).toContainText("e2e-operation");
    await expect(preview).toContainText("e2e-revision-42");
    await expect(preview).toContainText("provider secrets");
    await expect(preview).toContainText("raw model output");
    await expect(preview).toContainText("private runtime paths");
    await expect(proof).toContainText("Cancelled");
    await expect(proof).toContainText("Revision: e2e-revision-42");
    await expect(proof).toContainText("Terminal reason: cancel_requested");
    expect(auditRequests).toHaveLength(2);
    await preview.getByRole("button", {
      name: "Close audit preview"
    }).click();
    const downloadPromise = page.waitForEvent("download");
    await proof.getByRole("button", {
      name: "Export audit"
    }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("cancelled-server-audit.json");
    expect(auditRequests).toHaveLength(3);
    await page.reload();
    const reloadedProof = page.getByLabel("Agent execution proof");
    await expect(reloadedProof).toBeVisible();
    await expect(reloadedProof).toContainText("Cancelled");
    await expect(reloadedProof).toContainText("Revision: e2e-revision-42");
    await expect(page.getByLabel("Redacted audit preview")).toBeHidden();
    expect(auditRequests).toHaveLength(3);
  });
  test("uploads an archive and renders a live task update", async ({
    page
  }) => {
    var _process$env$DASHBOAR7;
    const taskId = "e2e-live-task";
    const liveLog = {
      id: "e2e-live-log",
      taskId,
      level: "info",
      message: "Live update received from the server",
      timestamp: "2026-01-01T00:00:02.000Z"
    };
    await installApiFixtures(page, {
      archiveUpload: {
        uploadId: "e2e-upload",
        originalName: "dashboard-journey.zip"
      },
      liveTask: {
        id: taskId,
        title: "Verify live dashboard updates",
        projectId: "e2e-project",
        log: liveLog
      }
    });
    await programmaticSignIn(page);

    // This is a valid, empty ZIP archive. Keeping it inline makes the browser
    // test self-contained while still exercising FormData and multipart bytes.
    const uploadResult = await page.evaluate(async apiBaseUrl => {
      const bytes = Uint8Array.from(atob("UEsFBgAAAAAAAAAAAAAAAAAAAAAAAA=="), character => character.charCodeAt(0));
      const body = new FormData();
      body.append("archive", new Blob([bytes], {
        type: "application/zip"
      }), "dashboard-journey.zip");
      const response = await fetch(new URL("/api/upload/archive", apiBaseUrl).toString(), {
        method: "POST",
        credentials: "include",
        body
      });
      return {
        status: response.status,
        body: await response.json()
      };
    }, (_process$env$DASHBOAR7 = process.env.DASHBOARD_E2E_API_BASE_URL) !== null && _process$env$DASHBOAR7 !== void 0 ? _process$env$DASHBOAR7 : page.url());
    expect(uploadResult.status).toBe(201);
    expect(uploadResult.body).toEqual({
      uploadId: "e2e-upload",
      originalName: "dashboard-journey.zip"
    });
    await openNavigation(page, "Tasks", `${DASHBOARD_PATH}tasks`);
    const taskRow = page.getByLabel("Expand task Verify live dashboard updates");
    await expect(taskRow).toBeVisible();
    await taskRow.click();
    await page.getByRole("button", {
      name: "Logs"
    }).click();
    await expect(page.getByRole("region", {
      name: "Activity"
    })).toContainText("Live update received from the server");
  });
  test("recovers a live task update after a temporary stream failure", async ({
    page
  }) => {
    const taskId = "e2e-reconnecting-live-task";
    const liveLog = {
      id: "e2e-reconnecting-live-log",
      taskId,
      level: "info",
      message: "Authoritative update received after reconnect",
      timestamp: "2026-01-01T00:00:02.000Z",
      metadata: {
        operationId: "e2e-reconnecting-operation",
        checkpointVersion: 3
      }
    };
    const streamRequests = [];
    await installApiFixtures(page, {
      liveTask: {
        id: taskId,
        title: "Recover live task updates",
        projectId: "e2e-project",
        log: liveLog,
        streamRequests,
        failFirstStream: true
      }
    });
    await programmaticSignIn(page);
    await openNavigation(page, "Tasks", `${DASHBOARD_PATH}tasks`);
    const taskRow = page.getByLabel("Expand task Recover live task updates");
    await expect(taskRow).toBeVisible();
    await taskRow.click();
    await page.getByRole("button", {
      name: "Logs"
    }).click();
    const activity = page.getByRole("region", {
      name: "Activity"
    });
    await expect(activity).toContainText(liveLog.message);
    await expect.poll(() => streamRequests.length, {
      message: "the task log stream should reconnect exactly once"
    }).toBe(2);
    expect(streamRequests).toHaveLength(2);
    expect(streamRequests[0]).toBe(streamRequests[1]);
    expect(new URL(streamRequests[1]).pathname).toBe(`/api/tasks/${taskId}/logs/stream`);
    await expect(activity.locator("summary").filter({
      hasText: liveLog.message
    })).toHaveCount(1);
  });
  test("shows an actionable terminal state when live task reconnects are exhausted", async ({
    page
  }) => {
    const taskId = "e2e-exhausted-live-task";
    const operationId = "e2e-exhausted-operation";
    const liveLog = {
      id: "e2e-exhausted-live-log",
      taskId,
      level: "info",
      message: "The only confirmed task update",
      timestamp: "2026-01-01T00:00:02.000Z",
      metadata: {
        operationId
      }
    };
    const streamRequests = [];
    const nonStreamRequests = [];
    page.on("request", request => {
      if (!request.url().includes("/api/tasks/")) return;
      if (!request.url().includes("/logs/stream")) nonStreamRequests.push(request.method());
    });
    await installApiFixtures(page, {
      liveTask: {
        id: taskId,
        title: "Recover exhausted live task updates",
        projectId: "e2e-project",
        log: liveLog,
        initialLogs: [liveLog],
        streamRequests,
        failStreamAttempts: 6
      }
    });
    await programmaticSignIn(page);
    await openNavigation(page, "Tasks", `${DASHBOARD_PATH}tasks`);
    await page.getByLabel("Expand task Recover exhausted live task updates").click();
    await page.getByRole("button", {
      name: "Logs"
    }).click();
    const activity = page.getByRole("region", {
      name: "Activity"
    });
    await expect(activity).toContainText(liveLog.message);
    await expect(page.getByText("Temporary stream failure.", {
      exact: false
    })).toBeVisible();
    await expect.poll(() => streamRequests.length, {
      message: "the task log stream should exhaust its bounded reconnect budget",
      timeout: 35000
    }).toBe(6);
    const exhausted = page.getByRole("alert");
    await expect(exhausted).toContainText("Live task updates could not reconnect");
    await expect(exhausted).toContainText("Reconnect attempts are exhausted");
    await expect(exhausted).toContainText(operationId);
    await expect(exhausted).toContainText("task has not been marked failed");
    await expect(exhausted.getByRole("button", {
      name: "Retry live updates"
    })).toBeVisible();
    await expect(exhausted.getByRole("button", {
      name: "Refresh task logs"
    })).toBeVisible();
    await exhausted.getByRole("button", {
      name: "Retry live updates"
    }).click();
    await expect(activity).toContainText("The only confirmed task update");
    await expect.poll(() => streamRequests.length).toBe(7);
    expect(new Set(streamRequests).size).toBe(1);
    expect(nonStreamRequests).not.toContain("POST");
    await expect(activity.locator("summary").filter({
      hasText: liveLog.message
    })).toHaveCount(1);
  });
  test("pages and reloads the filtered event stream without losing its window", async ({
    page
  }) => {
    const events = Array.from({
      length: 51
    }, (_, index) => ({
      id: `e2e-event-${index}`,
      projectId: "e2e-project",
      type: "AuditEvent",
      severity: index < 2 ? "success" : "info",
      correlationId: index < 2 ? "release-42" : null,
      message: index < 2 ? `Filtered release event ${index}` : `Older event ${index}`,
      timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, 51 - index)).toISOString()
    }));
    const eventRequests = [];
    page.on("request", request => {
      if (new URL(request.url()).pathname.endsWith("/api/events")) eventRequests.push(request.url());
    });
    await installApiFixtures(page, {
      events,
      projects: [{
        id: "e2e-project",
        name: "Smoke Project",
        language: "TypeScript",
        framework: "React",
        status: "active",
        rootPath: "/controlled/smoke",
        qualityScore: 92
      }]
    });
    await programmaticSignIn(page);
    await page.goto(`${DASHBOARD_PATH}events`);
    await expect(page.getByText("Older event 49", {
      exact: true
    })).toBeVisible();
    await expect(page.getByText("Older event 50", {
      exact: true
    })).not.toBeVisible();
    const firstRequest = new URL(eventRequests.at(-1));
    expect(firstRequest.searchParams.get("limit")).toBe("50");
    expect(firstRequest.searchParams.get("page")).toBe("1");
    await Promise.all([page.waitForRequest(request => {
      const url = new URL(request.url());
      return url.pathname.endsWith("/api/events") && url.searchParams.get("page") === "2";
    }), page.getByRole("button", {
      name: "Older"
    }).click()]);
    await expect(page.getByText("Page 2.", {
      exact: false
    })).toBeVisible();
    await expect(page.getByText("Older event 50", {
      exact: true
    })).toBeVisible();
    await expect(page.getByText("Filtered release event 0", {
      exact: true
    })).not.toBeVisible();
    expect(new URL(eventRequests.at(-1)).searchParams.get("page")).toBe("2");
    await page.getByRole("button", {
      name: "Newer"
    }).click();
    await expect(page.getByText("Page 1.", {
      exact: false
    })).toBeVisible();
    await expect(page.getByText("Filtered release event 0", {
      exact: true
    })).toBeVisible();
    await page.getByPlaceholder("Search logs...").fill("Filtered release");
    await page.getByRole("button", {
      name: "Toggle event filters"
    }).click();
    await page.locator("select").nth(1).selectOption("success");
    await expect(page.getByText("Filtered release event 0", {
      exact: true
    })).toBeVisible();
    await expect(page.getByText("Older event 1", {
      exact: true
    })).not.toBeVisible();
    await expect(page).toHaveURL(/search=Filtered\+release/);
    await expect(page).toHaveURL(/severity=success/);
    await page.reload();
    await expect(page.getByText("Filtered release event 0", {
      exact: true
    })).toBeVisible();
    await expect(page.getByText("Older event 1", {
      exact: true
    })).not.toBeVisible();
    await expect(page.getByPlaceholder("Search logs...")).toHaveValue("Filtered release");
    await page.getByRole("button", {
      name: "Toggle event filters"
    }).click();
    await expect(page.locator("select").nth(1)).toHaveValue("success");
    const filteredRequest = new URL(eventRequests.at(-1));
    expect(filteredRequest.searchParams.get("limit")).toBe("50");
    expect(filteredRequest.searchParams.get("page")).toBe("1");
    expect(filteredRequest.searchParams.get("search")).toBe("Filtered release");
    expect(filteredRequest.searchParams.get("severity")).toBe("success");
  });
  test("renders an Arabic source-backed AI answer without internal diagnostics", async ({
    page
  }) => {
    const fixture = await installArabicAiFixture(page);
    await installApiFixtures(page, {
      arabicAi: fixture
    });
    await programmaticSignIn(page);
    await page.goto(`${DASHBOARD_PATH}ai`);
    const composer = page.locator("textarea").first();
    await expect(composer).toBeVisible();
    await composer.fill(fixture.question);
    const sendButton = composer.locator("xpath=..").getByRole("button");
    await expect(sendButton).toBeEnabled();
    const streamResponsePromise = page.waitForResponse(response => response.url().includes("/api/ai/chat/stream"));
    await sendButton.click();
    const streamResponse = await streamResponsePromise;
    expect(streamResponse.status()).toBe(200);
    await expect(page.getByText(fixture.question, {
      exact: true
    }).last()).toBeVisible();
    await expect(page.getByText(fixture.answer, {
      exact: true
    }).last()).toBeVisible();
    await expect(page.getByText("Agent activity", {
      exact: false
    })).toBeVisible();
    await page.locator("summary").filter({
      hasText: "Agent activity"
    }).click();
    await expect(page.getByText("Reading source", {
      exact: false
    })).toBeVisible();
    await expect(page.getByText(fixture.source, {
      exact: true
    }).last()).toBeVisible();
    await expect(page.getByText(/Behavior evidence · 1 excerpt/i).last()).toBeVisible();
    await expect(page.getByText('return partialFromCollectedEvidence("provider timeout");', {
      exact: true
    }).last()).toBeVisible();
    const visibleText = await page.locator("body").innerText();
    expect(visibleText).not.toContain("COMPLETED");
    expect(visibleText).not.toContain("Persisted execution proof");
    expect(visibleText).toContain("NOT PROVEN");
  });
  test("keeps the AI session drawer overlaid on a phone viewport with accepted evidence", async ({
    page
  }) => {
    await page.setViewportSize({
      width: 390,
      height: 844
    });
    const fixture = await installArabicAiFixture(page);
    await installApiFixtures(page, {
      arabicAi: fixture
    });
    await programmaticSignIn(page);
    await page.goto(`${DASHBOARD_PATH}ai`);
    const composer = page.locator("textarea").first();
    await composer.fill(fixture.question);
    await composer.locator("xpath=..").getByRole("button").click();
    await expect(page.getByText(fixture.answer, {
      exact: true
    }).last()).toBeVisible();
    await expect(page.getByText(`${fixture.source}:42`, {
      exact: false
    }).last()).toBeVisible();
    await page.locator("summary").filter({
      hasText: "Agent activity"
    }).last().click();
    await expect(page.locator("body")).toContainText("Reading source");
    await expect(page.locator("body")).toContainText(fixture.source);
    await expect(page.locator("body")).toContainText("Accepted: source span verified.");
    await expectNoHorizontalOverflow(page);
    const visibleText = await page.locator("body").innerText();
    expect(visibleText).not.toMatch(/rawPrompt|systemPrompt|provider diagnostics|source-window|recovery prompt|\/home\/runner/i);
  });
  test("keeps safe citation state across browser back and forward navigation with blocked evidence", async ({
    page
  }) => {
    const accepted = await installArabicAiFixture(page, {
      sessionId: "e2e-history-accepted-session",
      question: "ما هو سلوك مهلة provider عند الرجوع عبر سجل المتصفح؟"
    });
    const blocked = await installArabicAiFixture(page, {
      blocked: true,
      sessionId: "e2e-history-blocked-session",
      question: "ما هو الدليل المحجوب عند الرجوع عبر سجل المتصفح؟"
    });
    await installApiFixtures(page, {
      arabicAi: accepted,
      alternateAi: blocked
    });
    await programmaticSignIn(page);
    await page.goto(`${DASHBOARD_PATH}ai`);
    const composer = page.locator("textarea").first();
    await composer.fill(blocked.question);
    await composer.locator("xpath=..").getByRole("button").click();
    await expect(page.getByText(blocked.answer, {
      exact: true
    }).last()).toBeVisible();
    await page.locator("summary").filter({
      hasText: "Agent activity"
    }).last().click();
    await expect(page.locator("body")).toContainText("Reading source");
    const visibleText = await page.locator("body").innerText();
    expect(visibleText).not.toMatch(/rawPrompt|systemPrompt|provider diagnostics|source-window|recovery prompt|\/home\/runner/i);
  });
  test("keeps safe citation state when switching projects", async ({
    page
  }) => {
    const accepted = await installArabicAiFixture(page, {
      sessionId: "e2e-history-accepted-session",
      question: "ما هو سلوك مهلة provider عند الرجوع عبر سجل المتصفح؟"
    });
    const blocked = await installArabicAiFixture(page, {
      blocked: true,
      sessionId: "e2e-history-blocked-session",
      question: "ما هو الدليل المحجوب عند الرجوع عبر سجل المتصفح؟"
    });
    await installApiFixtures(page, {
      arabicAi: accepted,
      alternateAi: blocked,
      projects: [{
        id: "e2e-project-one",
        name: "Citation Project One",
        language: "TypeScript",
        framework: "React",
        status: "active",
        rootPath: "/controlled/project-one",
        qualityScore: 92
      }, {
        id: "e2e-project-two",
        name: "Citation Project Two",
        language: "TypeScript",
        framework: "React",
        status: "active",
        rootPath: "/controlled/project-two",
        qualityScore: 88
      }]
    });
    await programmaticSignIn(page);
    await page.goto(`${DASHBOARD_PATH}ai`);
    await page.getByRole("button", {
      name: accepted.question,
      exact: true
    }).click();
    await expect(page.getByText(accepted.answer, {
      exact: true
    }).last()).toBeVisible();
    await expect(page.getByText(`${accepted.source}:42`, {
      exact: false
    }).last()).toBeVisible();
    await expect(page.getByText("Accepted: source span verified.", {
      exact: true
    }).last()).toBeVisible();
    await page.getByRole("combobox").selectOption("e2e-project-two");
    await expect(page.getByRole("button", {
      name: blocked.question,
      exact: true
    })).toBeVisible();
    await expect(page.getByText(accepted.answer, {
      exact: true
    })).toHaveCount(0);
    await page.getByRole("button", {
      name: blocked.question,
      exact: true
    }).click();
    await expect(page.getByText("Blocked: no matching source text was found.", {
      exact: true
    }).last()).toBeVisible();
    await expect(page.getByText(`${blocked.source}:42`, {
      exact: false
    })).toHaveCount(0);
    await expect(page.getByText("Accepted: source span verified.", {
      exact: true
    })).toHaveCount(0);
    await page.getByRole("combobox").selectOption("e2e-project-one");
    await page.getByRole("button", {
      name: accepted.question,
      exact: true
    }).click();
    await expect(page.getByText(`${accepted.source}:42`, {
      exact: false
    }).last()).toBeVisible();
    await expect(page.getByText("Accepted: source span verified.", {
      exact: true
    }).last()).toBeVisible();
    await expect(page.getByText("Blocked: no matching source text was found.", {
      exact: true
    })).toHaveCount(0);
    const visibleText = await page.locator("body").innerText();
    expect(visibleText).not.toMatch(/rawPrompt|systemPrompt|provider diagnostics|source-window|recovery prompt|\/home\/runner/i);
  });
  test("keeps safe citation state across repeated navigation", async ({
    page
  }) => {
    const accepted = await installArabicAiFixture(page, {
      sessionId: "e2e-history-accepted-session",
      question: "ما هو سلوك مهلة provider عند الرجوع عبر سجل المتصفح؟"
    });
    const blocked = await installArabicAiFixture(page, {
      blocked: true,
      sessionId: "e2e-history-blocked-session",
      question: "ما هو الدليل المحجوب عند الرجوع عبر سجل المتصفح؟"
    });
    await installApiFixtures(page, {
      arabicAi: accepted,
      alternateAi: blocked
    });
    await programmaticSignIn(page);
    await page.goto(`${DASHBOARD_PATH}ai`);
    const assertAcceptedCitation = async () => {
      await expect(page.getByText(accepted.answer, {
        exact: true
      }).last()).toBeVisible();
      await expect(page.getByText(`${accepted.source}:42`, {
        exact: false
      }).last()).toBeVisible();
      await expect(page.getByText("Accepted: source span verified.", {
        exact: true
      }).last()).toBeVisible();
      await expect(page.getByText("Blocked: no matching source text was found.", {
        exact: true
      })).toHaveCount(0);
    };
    const assertBlockedCitation = async () => {
      await expect(page.getByText("Blocked: no matching source text was found.", {
        exact: true
      }).last()).toBeVisible();
      await expect(page.getByText(`${blocked.source}:42`, {
        exact: false
      })).toHaveCount(0);
      await expect(page.getByText("Accepted: source span verified.", {
        exact: true
      })).toHaveCount(0);
    };
    const assertNoInternalCitationDetails = async () => {
      const visibleText = await page.locator("body").innerText();
      expect(visibleText).not.toMatch(/MISSING_LITERAL_MATCH|rawPrompt|systemPrompt|provider diagnostics|source-window|recovery prompt|\/home\/runner/i);
    };
    await page.getByRole("button", {
      name: accepted.question,
      exact: true
    }).click();
    await assertAcceptedCitation();
    await openNavigation(page, "Projects", `${DASHBOARD_PATH}projects`);
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`${DASHBOARD_PATH.replaceAll("/", "\\/")}ai$`));
    await page.getByRole("button", {
      name: accepted.question,
      exact: true
    }).click();
    await assertAcceptedCitation();
    await assertNoInternalCitationDetails();
    await page.goForward();
    await expect(page).toHaveURL(new RegExp(`${DASHBOARD_PATH.replaceAll("/", "\\/")}projects$`));
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`${DASHBOARD_PATH.replaceAll("/", "\\/")}ai$`));
    await page.getByRole("button", {
      name: accepted.question,
      exact: true
    }).click();
    await assertAcceptedCitation();
    await page.getByRole("button", {
      name: blocked.question,
      exact: true
    }).click();
    await assertBlockedCitation();
    await openNavigation(page, "Event Stream", `${DASHBOARD_PATH}events`);
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`${DASHBOARD_PATH.replaceAll("/", "\\/")}ai$`));
    await page.getByRole("button", {
      name: blocked.question,
      exact: true
    }).click();
    await assertBlockedCitation();
    await assertNoInternalCitationDetails();
    await page.goForward();
    await expect(page).toHaveURL(new RegExp(`${DASHBOARD_PATH.replaceAll("/", "\\/")}events$`));
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`${DASHBOARD_PATH.replaceAll("/", "\\/")}ai$`));
    await page.getByRole("button", {
      name: blocked.question,
      exact: true
    }).click();
    await assertBlockedCitation();
    await assertNoInternalCitationDetails();
  });
  test("keeps only the safe blocked citation reason after chat reload", async ({
    page
  }) => {
    const fixture = installToolFailureFixture();
    await installApiFixtures(page, {
      arabicAi: fixture
    });
    await programmaticSignIn(page);
    await page.goto(`${DASHBOARD_PATH}ai`);
    const composer = page.locator("textarea").first();
    await composer.fill(fixture.question);
    await composer.locator("xpath=..").getByRole("button").click();
    await expect(page.getByText(fixture.answer, {
      exact: true
    }).last()).toBeVisible();
    await expect(page.getByText("required tool did not complete — BLOCKED/INCOMPLETE", {
      exact: false
    }).last()).toBeVisible();
    await page.locator("summary").filter({
      hasText: "Agent activity"
    }).last().click();
    await expect(page.locator("body")).toContainText("Reading source");
    await expect(page.locator("body")).toContainText("src/missing-release-fixture.ts");
    await expect(page.locator("body")).toContainText("Tool failed");
    await expect(page.locator("body")).toContainText("TOOL_EXECUTION_FAILED");
    const visibleText = await page.locator("body").innerText();
    expect(visibleText).not.toContain("COMPLETED");
    expect(visibleText).toContain("Persisted execution proof");
    expect(visibleText).toContain("The required source read did not complete.");
  });
  test("keeps the failed AI session drawer overlaid on a phone viewport", async ({
    page
  }) => {
    await page.setViewportSize({
      width: 390,
      height: 844
    });
    const fixture = installToolFailureFixture();
    await installApiFixtures(page, {
      arabicAi: fixture
    });
    await programmaticSignIn(page);
    await page.goto(`${DASHBOARD_PATH}ai`);
    const composer = page.locator("textarea").first();
    await composer.fill(fixture.question);
    await composer.locator("xpath=..").getByRole("button").click();
    await expect(page.getByText(fixture.answer, {
      exact: true
    }).last()).toBeVisible();
    await expect(page.getByText("required tool did not complete — BLOCKED/INCOMPLETE", {
      exact: false
    }).last()).toBeVisible();
    await page.locator("summary").filter({
      hasText: "Agent activity"
    }).last().click();
    await expect(page.locator("body")).toContainText("Reading source");
    await expect(page.locator("body")).toContainText("src/missing-release-fixture.ts");
    await expect(page.locator("body")).toContainText("Tool failed");
    await expect(page.locator("body")).toContainText("TOOL_EXECUTION_FAILED");
    const visibleText = await page.locator("body").innerText();
    expect(visibleText).not.toMatch(/raw exception|stack trace|\/home\/runner|secret|fixture diagnostic/i);
    await expectNoHorizontalOverflow(page);
  });
  test("preserves one partial answer after a provider disconnect and marks it incomplete", async ({
    page
  }) => {
    const fixture = installDisconnectedAiFixture();
    await installApiFixtures(page, {
      disconnectAi: fixture
    });
    await programmaticSignIn(page);
    await page.goto(`${DASHBOARD_PATH}ai`);
    const composer = page.locator("textarea").first();
    await composer.fill(fixture.question);
    await composer.locator("xpath=..").getByRole("button").click();
    const answer = page.getByText(fixture.answer, {
      exact: true
    });
    await expect(answer.last()).toBeVisible();
    await expect(page.getByText("INCOMPLETE:", {
      exact: false
    })).toBeVisible();
    await expect(page.getByText("provider failure", {
      exact: false
    }).last()).toBeVisible();
    await expect(page.getByText("stopped: provider timeout", {
      exact: false
    }).last()).toBeVisible();
    await expect(page.getByText("The provider disconnected after visible response text.", {
      exact: true
    })).toBeVisible();
    await page.reload();
    await page.getByRole("button", {
      name: fixture.question,
      exact: true
    }).click();
    await expect(page.getByText(fixture.answer, {
      exact: true
    }).last()).toBeVisible();
    await expect(page.getByText("INCOMPLETE:", {
      exact: false
    })).toBeVisible();
    await expect(page.getByText("provider failure", {
      exact: false
    }).last()).toBeVisible();
    await expect(page.getByText("stopped: provider timeout", {
      exact: false
    }).last()).toBeVisible();
    await expect(page.getByText("The provider disconnected after visible response text.", {
      exact: true
    })).toBeVisible();
  });
  test("resumes a failed analysis and keeps the execution incomplete", async ({
    page
  }) => {
    var _await$resumeRequest$;
    const {
      fixture,
      execution
    } = installResumedAnalysisFailureFixture();
    await installApiFixtures(page, {
      arabicAi: fixture,
      resumeFailure: {
        fixture,
        execution
      }
    });
    await programmaticSignIn(page);
    await page.evaluate(({
      sessionId,
      executionId,
      projectId,
      resumeToken,
      message
    }) => {
      localStorage.setItem(`eos_ai_execution_current_${projectId}`, sessionId);
      localStorage.setItem(`eos_ai_execution_${projectId}_${sessionId}`, JSON.stringify({
        id: executionId,
        projectId,
        sessionId,
        resumeToken,
        message
      }));
    }, {
      sessionId: fixture.sessionId,
      executionId: fixture.executionId,
      projectId: "e2e-project",
      resumeToken: "e2e-resumed-analysis-failure-token-opaque",
      message: fixture.question
    });
    await page.goto(`${DASHBOARD_PATH}ai`);
    await expect(page.getByText("A saved AI execution is ready to resume")).toBeVisible();
    const resumeRequest = page.waitForRequest(request => request.url().includes("/api/ai/chat/stream") && request.method() === "POST");
    await page.getByLabel("Agent execution proof").getByRole("button", {
      name: "Resume",
      exact: true
    }).click();
    const requestBody = JSON.parse((_await$resumeRequest$ = (await resumeRequest).postData()) !== null && _await$resumeRequest$ !== void 0 ? _await$resumeRequest$ : "{}");
    expect(requestBody).toEqual(expect.objectContaining({
      projectId: "e2e-project",
      sessionId: fixture.sessionId,
      executionId: fixture.executionId,
      resumeToken: "e2e-resumed-analysis-failure-token-opaque",
      message: fixture.question
    }));
    await expect(page.getByText("Failed to send message", {
      exact: true
    })).toBeVisible();
    await expect(page.getByText("A saved AI execution is ready to resume")).toBeVisible();
    const visibleText = await page.locator("body").innerText();
    expect(visibleText).not.toContain("COMPLETED");
    expect(visibleText).not.toContain("Persisted execution proof");
    expect(visibleText).toContain("The required analysis did not complete.");
  });
  test("recovers a missing token after a real stream abort and resumes one execution", async ({
    page
  }) => {
    var _streamRequests$, _streamRequests$2;
    const recovery = installInterruptedResumeFixture();
    await installApiFixtures(page, {
      interruptedResume: recovery
    });
    await page.addInitScript(() => {
      const nativeFetch = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const url = typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
        const body = typeof (init === null || init === void 0 ? void 0 : init.body) === "string" ? init.body : "";
        if (!url.includes("/api/ai/chat/stream") || body.includes('"executionId"')) {
          return nativeFetch(input, init);
        }
        const response = await nativeFetch(input, init);
        if (!response.body) return response;
        const reader = response.body.getReader();
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          async start(controller) {
            let buffered = "";
            while (true) {
              const {
                done,
                value
              } = await reader.read();
              if (done) {
                if (buffered) controller.enqueue(encoder.encode(buffered));
                controller.close();
                return;
              }
              buffered += new TextDecoder().decode(value, {
                stream: true
              });
              const marker = buffered.indexOf('"type":"execution_started"');
              const frameEnd = marker < 0 ? -1 : buffered.indexOf("\n\n", marker);
              if (frameEnd >= 0) {
                controller.enqueue(encoder.encode(buffered.slice(0, frameEnd + 2)));
                controller.error(new TypeError("network connection reset"));
                return;
              }
            }
          }
        });
        return new Response(stream, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers
        });
      };
    });
    await programmaticSignIn(page);
    await page.goto(`${DASHBOARD_PATH}ai`);
    const streamRequests = [];
    page.on("request", request => {
      if (request.url().includes("/api/ai/chat/stream") && request.method() === "POST") {
        try {
          streamRequests.push(request.postDataJSON());
        } catch {
          // Ignore requests without a JSON body; the assertions below require
          // both journey requests to have a valid request envelope.
        }
      }
    });
    const composer = page.locator("textarea").first();
    await composer.fill(recovery.fixture.question);
    await composer.locator("xpath=..").getByRole("button").click();
    await expect(page.getByText("Execution paused — ready to resume from its durable checkpoint", {
      exact: true
    })).toBeVisible();
    const storageKey = "eos_ai_execution_e2e-project_e2e-interrupted-resume-session";
    const pointerKey = "eos_ai_execution_current_e2e-project";
    await expect.poll(() => page.evaluate(key => localStorage.getItem(key), storageKey)).toContain(recovery.initialToken);
    await page.evaluate(({
      storageKey,
      pointerKey
    }) => {
      var _localStorage$getItem;
      const saved = JSON.parse((_localStorage$getItem = localStorage.getItem(storageKey)) !== null && _localStorage$getItem !== void 0 ? _localStorage$getItem : "{}");
      delete saved.resumeToken;
      localStorage.setItem(storageKey, JSON.stringify(saved));
      localStorage.setItem(pointerKey, "e2e-interrupted-resume-session");
    }, {
      storageKey,
      pointerKey
    });
    await page.reload();
    await expect(page.getByText("A saved AI execution is ready to resume", {
      exact: true
    })).toBeVisible();
    await expect.poll(() => page.evaluate(key => {
      var _localStorage$getItem2;
      const saved = JSON.parse((_localStorage$getItem2 = localStorage.getItem(key)) !== null && _localStorage$getItem2 !== void 0 ? _localStorage$getItem2 : "{}");
      return saved.resumeToken;
    }, storageKey)).toBe(recovery.recoveredToken);
    await page.getByRole("button", {
      name: "Resume",
      exact: true
    }).click();
    await expect(page.getByText(recovery.fixture.answer, {
      exact: true
    })).toBeVisible();
    await expect.poll(() => streamRequests.length).toBe(2);
    expect(streamRequests[0]).toEqual(expect.objectContaining({
      projectId: "e2e-project",
      message: recovery.fixture.question
    }));
    expect((_streamRequests$ = streamRequests[0]) === null || _streamRequests$ === void 0 ? void 0 : _streamRequests$.executionId).toBeUndefined();
    expect((_streamRequests$2 = streamRequests[0]) === null || _streamRequests$2 === void 0 ? void 0 : _streamRequests$2.sessionId).toBeUndefined();
    expect(streamRequests[1]).toEqual(expect.objectContaining({
      projectId: "e2e-project",
      sessionId: recovery.fixture.sessionId,
      executionId: recovery.fixture.executionId,
      resumeToken: recovery.recoveredToken,
      message: recovery.fixture.question
    }));
    expect(streamRequests.map(request => request.executionId).filter(Boolean)).toEqual([recovery.fixture.executionId]);
  });
  test("projects delivery recovery states safely after reload", async ({
    page
  }) => {
    const recovery = {
      requests: [],
      operations: [{
        proposalId: "e2e-recovery-available-proposal",
        operationId: "e2e-recovery-available-operation",
        sessionId: "e2e-recovery-available-session",
        lifecycle: "blocked",
        status: "pending",
        createdAt: "2026-01-01T00:03:00.000Z",
        recoveryState: "recoverable",
        operatorExplanation: "The delivery stopped because validation needs to be run again.",
        nextAction: "Resume validation to re-check the saved changes, or discard this recovery if it is no longer needed.",
        conflictReason: null,
        validationEvidence: [{
          profile: "workspace-typecheck",
          status: "failed"
        }],
        workspaceAvailable: true,
        changeCount: 2
      }, {
        proposalId: "e2e-recovery-missing-proposal",
        operationId: "e2e-recovery-missing-operation",
        sessionId: "e2e-recovery-missing-session",
        lifecycle: "abandoned",
        status: "pending",
        createdAt: "2026-01-01T00:02:00.000Z",
        recoveryState: "missing_workspace",
        operatorExplanation: "The saved delivery workspace is no longer available, so recovery cannot continue.",
        nextAction: "Start a new delivery from the current project rather than retrying this recovery.",
        conflictReason: "Workspace expired after the runner was recycled.",
        validationEvidence: null,
        workspaceAvailable: false,
        changeCount: 1
      }, {
        proposalId: "e2e-recovery-discarded-proposal",
        operationId: "e2e-recovery-discarded-operation",
        sessionId: "e2e-recovery-discarded-session",
        lifecycle: "cancelled",
        status: "rejected",
        createdAt: "2026-01-01T00:01:00.000Z",
        recoveryState: "discarded",
        operatorExplanation: "This delivery recovery was already discarded.",
        nextAction: "No action is required.",
        conflictReason: "Internal diagnostic: should never be rendered",
        validationEvidence: null,
        workspaceAvailable: false,
        changeCount: 3
      }]
    };
    await installApiFixtures(page, {
      deliveryRecovery: recovery
    });
    await programmaticSignIn(page);
    await page.goto(`${DASHBOARD_PATH}ai`);
    const region = page.getByRole("region", {
      name: "Recoverable delivery operations"
    });
    await expect(region).toBeVisible();
    await expect(region.getByText("Recoverable", {
      exact: true
    })).toBeVisible();
    await expect(region.getByText("Workspace unavailable", {
      exact: true
    })).toBeVisible();
    await expect(region.getByText("Already discarded", {
      exact: true
    })).toBeVisible();
    await expect(region.getByText("The saved delivery workspace is no longer available, so recovery cannot continue.", {
      exact: true
    })).toBeVisible();
    await expect(region.getByText("This delivery recovery was already discarded.", {
      exact: true
    })).toBeVisible();
    await expect(region.getByText("Retained reason: Workspace expired after the runner was recycled.", {
      exact: true
    })).toBeVisible();
    const available = region.locator('[data-operation-id="e2e-recovery-available-operation"]');
    const missing = region.locator('[data-operation-id="e2e-recovery-missing-operation"]');
    const discarded = region.locator('[data-operation-id="e2e-recovery-discarded-operation"]');
    await expect(available).toHaveAttribute("data-recovery-state", "recoverable");
    await expect(missing).toHaveAttribute("data-recovery-state", "missing_workspace");
    await expect(discarded).toHaveAttribute("data-recovery-state", "discarded");
    await expect(available.getByRole("button", {
      name: "Resume validation"
    })).toBeEnabled();
    await expect(available.getByRole("button", {
      name: "Discard workspace"
    })).toBeEnabled();
    await expect(missing.getByRole("button", {
      name: "Resume validation"
    })).toBeDisabled();
    await expect(missing.getByRole("button", {
      name: "Discard workspace"
    })).toBeDisabled();
    await expect(discarded.getByRole("button", {
      name: "Resume validation"
    })).toBeDisabled();
    await expect(discarded.getByRole("button", {
      name: "Discard workspace"
    })).toBeDisabled();
    const visibleText = await page.locator("body").innerText();
    expect(visibleText).not.toMatch(/\/home\/runner|\/tmp\/|\/workspace\/|internal diagnostic/i);
    await expectNoHorizontalOverflow(page);
    await page.reload();
    const reloadedRegion = page.getByRole("region", {
      name: "Recoverable delivery operations"
    });
    await expect(reloadedRegion).toBeVisible();
    await expect(reloadedRegion.locator('[data-operation-id="e2e-recovery-missing-operation"]').getByRole("button", {
      name: "Resume validation"
    })).toBeDisabled();
    await expect(reloadedRegion.locator('[data-operation-id="e2e-recovery-discarded-operation"]').getByRole("button", {
      name: "Discard workspace"
    })).toBeDisabled();
    expect(recovery.requests.length).toBeGreaterThanOrEqual(2);
    expect(recovery.requests.every(url => url.includes("projectId=e2e-project"))).toBe(true);
  });
  test("explains when delivery recovery loses a race and refreshes state", async ({
    page
  }) => {
    const recovery = {
      requests: [],
      actionRequests: [],
      operations: [{
        proposalId: "e2e-recovery-race-proposal",
        operationId: "e2e-recovery-race-operation",
        sessionId: "e2e-recovery-race-session",
        lifecycle: "blocked",
        status: "pending",
        createdAt: "2026-01-01T00:04:00.000Z",
        recoveryState: "recoverable",
        operatorExplanation: "The delivery stopped because the retained changes need review before validation can continue.",
        nextAction: "Resume validation to re-check the saved changes, or discard this recovery if it is no longer needed.",
        conflictReason: null,
        validationEvidence: [{
          profile: "workspace-typecheck",
          status: "failed"
        }],
        workspaceAvailable: true,
        changeCount: 1
      }],
      recoveryAction: {
        proposalId: "e2e-recovery-race-proposal",
        action: "resume-validation",
        response: {
          error: "This delivery recovery was already discarded.",
          code: "DELIVERY_ALREADY_DISCARDED",
          lifecycle: "cancelled",
          recoveryState: "discarded",
          nextAction: "No action is required.",
          diagnostic: "Do not render this server detail."
        },
        nextOperations: [{
          proposalId: "e2e-recovery-race-proposal",
          operationId: "e2e-recovery-race-operation",
          sessionId: "e2e-recovery-race-session",
          lifecycle: "cancelled",
          status: "rejected",
          createdAt: "2026-01-01T00:04:00.000Z",
          recoveryState: "discarded",
          operatorExplanation: "This delivery recovery was already discarded.",
          nextAction: "No action is required.",
          conflictReason: null,
          validationEvidence: null,
          workspaceAvailable: false,
          changeCount: 1
        }]
      }
    };
    await installApiFixtures(page, {
      deliveryRecovery: recovery
    });
    await programmaticSignIn(page);
    await page.goto(`${DASHBOARD_PATH}ai`);
    const region = page.getByRole("region", {
      name: "Recoverable delivery operations"
    });
    const operation = region.locator('[data-operation-id="e2e-recovery-race-operation"]');
    await expect(operation.getByRole("button", {
      name: "Resume validation"
    })).toBeEnabled();
    await operation.getByRole("button", {
      name: "Resume validation"
    }).click();
    await expect(page.getByText("Recovery state changed", {
      exact: true
    })).toBeVisible();
    await expect(page.getByText("This recovery was already discarded. The recovery list was refreshed.", {
      exact: true
    })).toBeVisible();
    await expect.poll(() => recovery.requests.length).toBeGreaterThanOrEqual(2);
    await expect(operation).toHaveAttribute("data-recovery-state", "discarded");
    expect(recovery.actionRequests).toHaveLength(1);
    expect(recovery.actionRequests[0]).toContain("/api/ai/delivery/e2e-recovery-race-proposal/resume-validation");
    expect(await region.locator('[data-operation-id="e2e-recovery-race-operation"]').count()).toBe(1);
    const visibleText = await page.locator("body").innerText();
    expect(visibleText).not.toMatch(/Do not render this server detail|\/home\/runner|\/tmp\//i);
    await expectNoHorizontalOverflow(page);
  });
  test("explains when an old recovery link points to a deleted operation", async ({
    page
  }) => {
    const recovery = {
      requests: [],
      actionRequests: [],
      operations: [{
        proposalId: "e2e-recovery-deleted-proposal",
        operationId: "e2e-recovery-deleted-operation",
        sessionId: "e2e-recovery-deleted-session",
        lifecycle: "blocked",
        status: "pending",
        createdAt: "2026-01-01T00:05:00.000Z",
        recoveryState: "recoverable",
        operatorExplanation: "The delivery stopped because the retained changes need review before validation can continue.",
        nextAction: "Resume validation to re-check the saved changes, or discard this recovery if it is no longer needed.",
        conflictReason: null,
        validationEvidence: [{
          profile: "workspace-typecheck",
          status: "failed"
        }],
        workspaceAvailable: true,
        changeCount: 1
      }],
      recoveryAction: {
        proposalId: "e2e-recovery-deleted-proposal",
        action: "resume-validation",
        status: 404,
        response: {
          error: "Delivery operation not found",
          code: "DELIVERY_NOT_FOUND",
          diagnostic: "Do not render this server detail."
        },
        nextOperations: []
      }
    };
    await installApiFixtures(page, {
      deliveryRecovery: recovery
    });
    await programmaticSignIn(page);
    await page.goto(`${DASHBOARD_PATH}ai`);
    const region = page.getByRole("region", {
      name: "Recoverable delivery operations"
    });
    const operation = region.locator('[data-operation-id="e2e-recovery-deleted-operation"]');
    await expect(operation.getByRole("button", {
      name: "Resume validation"
    })).toBeEnabled();
    await operation.getByRole("button", {
      name: "Resume validation"
    }).click();
    await expect(page.getByText("Recovery link expired", {
      exact: true
    })).toBeVisible();
    await expect(page.getByText("This recovery operation no longer exists. The recovery list was refreshed.", {
      exact: true
    })).toBeVisible();
    await expect.poll(() => recovery.requests.length).toBeGreaterThanOrEqual(2);
    await expect.poll(() => region.count()).toBe(0);
    expect(recovery.actionRequests).toHaveLength(1);
    expect(recovery.actionRequests[0]).toContain("/api/ai/delivery/e2e-recovery-deleted-proposal/resume-validation");
    const visibleText = await page.locator("body").innerText();
    expect(visibleText).not.toMatch(/Delivery operation not found|Do not render this server detail|\/home\/runner|\/tmp\//i);
    await expectNoHorizontalOverflow(page);
  });
  test("keeps the resumed AI session drawer overlaid on a phone viewport", async ({
    page
  }) => {
    await page.setViewportSize({
      width: 390,
      height: 844
    });
    const fixture = await installArabicAiFixture(page);
    await installApiFixtures(page, {
      arabicAi: fixture
    });
    await programmaticSignIn(page);
    await page.goto(`${DASHBOARD_PATH}ai`);
    const composer = page.locator("textarea").first();
    await expect(composer).toBeVisible();
    const beforeOpen = await composer.boundingBox();
    expect(beforeOpen === null || beforeOpen === void 0 ? void 0 : beforeOpen.width).toBeGreaterThan(250);
    await page.getByRole("button", {
      name: "Open sessions"
    }).click();
    await expect(page.getByText("Sessions", {
      exact: true
    })).toBeVisible();
    const drawer = page.getByText("Sessions", {
      exact: true
    }).locator("..").locator("..");
    const drawerBox = await drawer.boundingBox();
    expect(drawerBox === null || drawerBox === void 0 ? void 0 : drawerBox.width).toBeLessThanOrEqual(390);
    const duringOpen = await composer.boundingBox();
    expect(duringOpen === null || duringOpen === void 0 ? void 0 : duringOpen.width).toBeGreaterThan(250);
    await page.getByRole("button", {
      name: "Close sidebar"
    }).click();
    await expect(page.getByRole("button", {
      name: "Open sessions"
    })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
  test("renders a user-visible API failure state", async ({
    page
  }) => {
    await installApiFixtures(page);
    await programmaticSignIn(page);
    await page.route("**/api/dashboard", route => route.fulfill(jsonResponse({
      error: "controlled dashboard outage"
    }, 503)));
    await page.reload();
    await expect(page.getByRole("heading", {
      name: "Failed to load dashboard"
    })).toBeVisible();
    await expect(page.getByRole("button", {
      name: "Retry Connection"
    })).toBeVisible();
  });
});
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJleHBlY3QiLCJ0ZXN0IiwibWtkaXIiLCJ3cml0ZUZpbGUiLCJkaXJuYW1lIiwicGFyc2VDbGVya1NpZ25JblRva2VuUmVzcG9uc2UiLCJwYXJzZUNsZXJrVXNlckxvb2t1cFJlc3BvbnNlIiwicGFyc2VDcmVhdGVkQ2xlcmtVc2VyUmVzcG9uc2UiLCJEQVNIQk9BUkRfUEFUSCIsIlRFU1RfVVNFUiIsImZpcnN0TmFtZSIsImxhc3ROYW1lIiwiZW1haWwiLCJfcHJvY2VzcyRlbnYkREFTSEJPQVIiLCJwcm9jZXNzIiwiZW52IiwiREFTSEJPQVJEX0UyRV9FTUFJTCIsIkVYRUNVVElPTl9JRCIsIkRFRkFVTFRfTElWRV9USU1FT1VUX01TIiwiTElWRV9URVNUX1RJTUVPVVRfTUFSR0lOX01TIiwiREVGQVVMVF9SRUFESU5FU1NfVElNRU9VVF9NUyIsIlRFU1RfTU9ERVMiLCJTZXQiLCJIT1NUSUxFX09SSUdJTiIsIk9SSUdJTl9ESUFHTk9TVElDX0hFQURFUlMiLCJERUZBVUxUX0xJVkVfUFJPTVBUIiwiTElWRV9DQU1QQUlHTl9TQ0VOQVJJT1MiLCJsaXZlQ2FtcGFpZ25TY2VuYXJpbyIsIl9wcm9jZXNzJGVudiREQVNIQk9BUjIiLCJzY2VuYXJpbyIsIkRBU0hCT0FSRF9FMkVfTElWRV9TQ0VOQVJJTyIsInRyaW0iLCJEQVNIQk9BUkRfRTJFX0xJVkVfQ0FNUEFJR04iLCJFcnJvciIsImhhcyIsImxpdmVQcm9tcHQiLCJfcHJvY2VzcyRlbnYkREFTSEJPQVIzIiwiREFTSEJPQVJEX0UyRV9MSVZFX1BST01QVCIsImxpdmVUaW1lb3V0TXMiLCJjb25maWd1cmVkIiwiTnVtYmVyIiwiREFTSEJPQVJEX0UyRV9MSVZFX1RJTUVPVVRfTVMiLCJpc0Zpbml0ZSIsImRhc2hib2FyZFRlc3RNb2RlIiwiX3Byb2Nlc3MkZW52JERBU0hCT0FSNCIsIkRBU0hCT0FSRF9FMkVfVEVTVF9NT0RFIiwicmVhZGluZXNzVGltZW91dE1zIiwiREFTSEJPQVJEX0UyRV9SRUFESU5FU1NfVElNRU9VVF9NUyIsIndyaXRlUmVhZGluZXNzUmVjZWlwdCIsIm91dGNvbWUiLCJjaGVja3MiLCJyZWFzb24iLCJyZWNlaXB0UGF0aCIsIkRBU0hCT0FSRF9FMkVfUkVBRElORVNTX0FSVElGQUNUX1BBVEgiLCJyZWN1cnNpdmUiLCJKU09OIiwic3RyaW5naWZ5IiwibW9kZSIsInByb2plY3QiLCJEQVNIQk9BUkRfRTJFX0xJVkVfUFJPSkVDVF9JRCIsImFwcHJvdmVkRGFzaGJvYXJkT3JpZ2lucyIsIl9wcm9jZXNzJGVudiREQVNIQk9BUjUiLCJvcmlnaW5zIiwiREFTSEJPQVJEX0UyRV9BUFBST1ZFRF9PUklHSU5TIiwic3BsaXQiLCJtYXAiLCJvcmlnaW4iLCJmaWx0ZXIiLCJCb29sZWFuIiwibGVuZ3RoIiwicGFyc2VkIiwiVVJMIiwicGF0aG5hbWUiLCJzZWFyY2giLCJoYXNoIiwiZGFzaGJvYXJkRml4dHVyZSIsImZyZXNobmVzc1JldmlzaW9uIiwicHJvamVjdENvdW50IiwiYWN0aXZlVGFza0NvdW50IiwiY29tcGxldGVkVGFza0NvdW50IiwiZmFpbGVkVGFza0NvdW50IiwidGFza1N0YXR1c0JyZWFrZG93biIsInBlbmRpbmciLCJydW5uaW5nIiwicHJvamVjdFNjb3JlcyIsInByb2plY3RJZCIsInByb2plY3ROYW1lIiwic2NvcmUiLCJ0cmVuZCIsInJlY2VudEV2ZW50cyIsImlkIiwidHlwZSIsInNldmVyaXR5IiwibWVzc2FnZSIsInRpbWVzdGFtcCIsInRvcFJ1bGVzIiwiZXhlY3V0aW9uRml4dHVyZSIsIm9wZXJhdGlvbklkIiwic3RhdHVzIiwiZmxpZ2h0U3RhdGUiLCJldmlkZW5jZVZlcmRpY3QiLCJwcm9vZlJlcXVpcmVkIiwicmVzdW1hYmxlIiwiY2hlY2twb2ludFZlcnNpb24iLCJwcm9qZWN0UmV2aXNpb24iLCJjaGVja3BvaW50Iiwic3RhZ2UiLCJkZXRhaWwiLCJvYmplY3RpdmUiLCJzdGFydGVkQXQiLCJjb21wbGV0ZWRBdCIsImNyZWF0ZWRBdCIsInVwZGF0ZWRBdCIsImpzb25SZXNwb25zZSIsImJvZHkiLCJoZWFkZXJzIiwiY29udGVudFR5cGUiLCJleHBlY3ROb0hvcml6b250YWxPdmVyZmxvdyIsInBhZ2UiLCJvdmVyZmxvdyIsImV2YWx1YXRlIiwiZG9jdW1lbnQiLCJkb2N1bWVudEVsZW1lbnQiLCJzY3JvbGxXaWR0aCIsInZpZXdwb3J0Iiwid2luZG93IiwiaW5uZXJXaWR0aCIsInRvQmVMZXNzVGhhbk9yRXF1YWwiLCJleHBlY3REYXNoYm9hcmRSZWFkeSIsImdldEJ5Um9sZSIsIm5hbWUiLCJ0b0JlVmlzaWJsZSIsImdldEJ5VGV4dCIsImV4YWN0IiwicmVzdGFydEFwaUZvckNhbXBhaWduIiwiY29udHJvbFVybCIsIkRBU0hCT0FSRF9FMkVfQ09OVFJPTF9VUkwiLCJyZXNwb25zZSIsInJlcXVlc3QiLCJwb3N0IiwidGltZW91dCIsInRvQmUiLCJpbnN0YWxsQXBpRml4dHVyZXMiLCJvdmVycmlkZXMiLCJyb3V0ZSIsIl9yZWYiLCJfb3ZlcnJpZGVzJGRlbGl2ZXJ5UmUiLCJfb3ZlcnJpZGVzJGF1ZGl0RXhwb3IyIiwiX292ZXJyaWRlcyRhdWRpdEV4cG9yMyIsInVybCIsInBhdGgiLCJyZXBsYWNlIiwiYXJhYmljQWkiLCJhbHRlcm5hdGVBaSIsImRpc2Nvbm5lY3RBaSIsImFpRml4dHVyZXMiLCJmaXh0dXJlIiwiaGFzQ29uZmlndXJlZEFpRml4dHVyZSIsInJlc3VtZUZhaWx1cmUiLCJpbnRlcnJ1cHRlZFJlc3VtZSIsImVuZHNXaXRoIiwic2VhcmNoUGFyYW1zIiwiZ2V0IiwicHJvamVjdFNlc3Npb25zIiwiZnVsZmlsbCIsInNlc3Npb25JZCIsInRpdGxlIiwicXVlc3Rpb24iLCJyZXF1ZXN0Qm9keSIsInBvc3REYXRhSlNPTiIsImV4ZWN1dGlvbklkIiwic3RyZWFtQm9keSIsInJlc3VtZWRTdHJlYW1Cb2R5IiwicmVxdWVzdGVkTWVzc2FnZSIsInN0cmVhbUZpeHR1cmUiLCJmaW5kIiwiaW5jbHVkZXMiLCJtZXNzYWdlRml4dHVyZSIsInJvbGUiLCJjb250ZW50IiwiYXVkaXRFeHBvcnQiLCJfb3ZlcnJpZGVzJGF1ZGl0RXhwb3IiLCJtZXNzYWdlT3V0Y29tZSIsInRhc2tBY3Rpb25zIiwidmVyaWZpY2F0aW9uTWF0Y2giLCJtYXRjaCIsIm1ldGhvZCIsIl9wbGFuJHZlcmlmaWNhdGlvbkNoZSIsIl9wbGFuJHZlcmlmaWNhdGlvblN0ZSIsIl9vdmVycmlkZXMkdGFza0FjdGlvbiIsIl90YXNrJHZlcmlmaWNhdGlvblJlcyIsIl9wcmlvclJlc3VsdCRzdGVwcyIsIl9wcmlvclJlc3VsdCRoaXN0b3J5IiwiX3ByaW9yUmVzdWx0JGhpc3RvcnkyIiwiX2NoZWNrJGtpbmQiLCJfcHJpb3JSZXN1bHQkaGlzdG9yeTMiLCJ0YXNrSWQiLCJ0YXNrIiwidGFza3MiLCJjYW5kaWRhdGUiLCJlcnJvciIsInBsYW4iLCJyZW1lZGlhdGlvblBsYW4iLCJ2ZXJpZmljYXRpb25DaGVja3MiLCJ2ZXJpZmljYXRpb25TdGVwcyIsImd1aWRhbmNlIiwiaW5kZXgiLCJraW5kIiwiY2hlY2siLCJjaGVja0lkIiwicGFzc2VkIiwiZXZpZGVuY2UiLCJ2ZXJpZmljYXRpb25SZXF1ZXN0cyIsInB1c2giLCJwcmlvclJlc3VsdCIsInZlcmlmaWNhdGlvblJlc3VsdCIsInByaW9yU3RlcHMiLCJzdGVwcyIsIl9jYW5kaWRhdGUka2luZDIiLCJwcmlvciIsInN0ZXAiLCJfY2FuZGlkYXRlJGtpbmQiLCJTdHJpbmciLCJvdXRwdXQiLCJjb21wbGV0ZWQiLCJldmVyeSIsIl9zdGVwJGV2aWRlbmNlIiwiZGVjaXNpb24iLCJoaXN0b3J5IiwiYWN0b3IiLCJyZWNvcmRlZEF0IiwiYWN0aW9uTWF0Y2giLCJhY3Rpb24iLCJyZXF1ZXN0cyIsIl90YXNrJHJldHJ5Q291bnQiLCJyZXRyeUNvdW50IiwiX3JlZjIiLCJfb3ZlcnJpZGVzJHRhc2tBY3Rpb24yIiwiX292ZXJyaWRlcyR0YXNrQWN0aW9uMyIsInJlY292ZXJ5VGFza3MiLCJsaXZlVGFzayIsImRlc2NyaXB0aW9uIiwicHJpb3JpdHkiLCJyZWxhdGVkRmlsZXMiLCJtYXhSZXRyaWVzIiwiX292ZXJyaWRlcyRyZWNvdmVyeVdvIiwicmVjb3ZlcnlXb3JrZmxvd3MiLCJ3b3JrZmxvd0V4ZWN1dGlvbnNNYXRjaCIsIl9vdmVycmlkZXMkcmVjb3ZlcnlXbzIiLCJfb3ZlcnJpZGVzJHJlY292ZXJ5V28zIiwicmVjb3ZlcnlXb3JrZmxvd0V4ZWN1dGlvbnMiLCJmYWlsRmlyc3RQcmV2aWV3IiwiZmlsZW5hbWUiLCJhcmNoaXZlVXBsb2FkIiwiX3JvdXRlJHJlcXVlc3QkaGVhZGVyIiwic3RhcnRzV2l0aCIsInBvc3REYXRhQnVmZmVyIiwiQnVmZmVyIiwiZnJvbSIsInVwbG9hZElkIiwib3JpZ2luYWxOYW1lIiwicGhhc2UiLCJfb3ZlcnJpZGVzJGxpdmVUYXNrJGkiLCJpbml0aWFsTG9ncyIsInN0cmVhbVJlcXVlc3RzIiwiZmFpbEZpcnN0U3RyZWFtIiwiZmFpbFN0cmVhbUF0dGVtcHRzIiwiYWJvcnQiLCJsb2ciLCJfb3ZlcnJpZGVzJHByb2plY3RzIiwicHJvamVjdHMiLCJsYW5ndWFnZSIsImZyYW1ld29yayIsInJvb3RQYXRoIiwicXVhbGl0eVNjb3JlIiwiYXBpIiwiZGF0YWJhc2UiLCJzY2hlbWEiLCJwcm92aWRlciIsImRlbGl2ZXJ5UmVjb3ZlcnkiLCJvcGVyYXRpb25zIiwicmVjb3ZlcnlBY3Rpb24iLCJwcm9wb3NhbElkIiwiX292ZXJyaWRlcyRkZWxpdmVyeVJlMiIsIl9vdmVycmlkZXMkZGVsaXZlcnlSZTMiLCJhY3Rpb25SZXF1ZXN0cyIsIm5leHRPcGVyYXRpb25zIiwiX292ZXJyaWRlcyRldmVudHMiLCJfdXJsJHNlYXJjaFBhcmFtcyRnZXQiLCJldmVudHMiLCJ0b0xvd2VyQ2FzZSIsImZpbHRlcmVkRXZlbnRzIiwiZXZlbnQiLCJjb3JyZWxhdGlvbklkIiwidmFsdWUiLCJzb21lIiwibGltaXQiLCJzbGljZSIsInRvdGFsIiwiZXhlY3V0aW9uIiwicmVzdW1lVG9rZW4iLCJyZWNvdmVyZWRUb2tlbiIsImV4ZWN1dGlvbnMiLCJjb250aW51ZSIsImluc3RhbGxBcmFiaWNBaUZpeHR1cmUiLCJvcHRpb25zIiwiX29wdGlvbnMkc2Vzc2lvbklkIiwiX29wdGlvbnMkcXVlc3Rpb24iLCJtZXNzYWdlSWQiLCJzb3VyY2UiLCJibG9ja2VkIiwiYW5zd2VyIiwiZXhjZXJwdCIsInN1cHBvcnRzQ2xhaW0iLCJldmlkZW5jZUNsYXNzIiwiY2l0YXRpb25TdGF0dXMiLCJjaXRhdGlvblJlYXNvbiIsInNvdXJjZVNwYW4iLCJzdGFydExpbmUiLCJlbmRMaW5lIiwidG9vbFRyYWNlIiwidG9vbCIsImFyZ3MiLCJjYWNoZWQiLCJwcmVmZXRjaGVkIiwiY29kZSIsImNvbnNpc3RlbnQiLCJ2aW9sYXRpb25zIiwiZXZpZGVuY2VGaWxlQ291bnQiLCJhY2NlcHRlZEV2aWRlbmNlQ291bnQiLCJjb21wbGV0ZWRSZWFkRmlsZXMiLCJhY2NlcHRlZEV2aWRlbmNlRmlsZXMiLCJvYmplY3RpdmVUeXBlIiwicmVxdWlyZWRFZGdlcyIsInByb3ZlbkVkZ2VzIiwiY29tcGxldGlvbkdhdGVSZXN1bHQiLCJmaW5hbEFuc3dlclR5cGUiLCJ0YXNrUmVzdWx0IiwiY29uZmlkZW5jZSIsInNvdXJjZVNjb3BlIiwiY292ZXJhZ2UiLCJyZXF1ZXN0ZWRGaWVsZHMiLCJhbnN3ZXJlZEZpZWxkcyIsIm1pc3NpbmdGaWVsZHMiLCJjb21wbGV0ZSIsIm9wZXJhdGlvbk1vZGUiLCJzb3VyY2VzIiwiYmVoYXZpb3JFdmlkZW5jZSIsInNzZSIsImRlbHRhIiwicGVuZGluZ0NoYW5nZXMiLCJqb2luIiwiaW5zdGFsbFRvb2xGYWlsdXJlRml4dHVyZSIsImRpYWdub3N0aWNDb2RlIiwicmVzdWx0S2luZCIsInJlc3VsdFN1bW1hcnkiLCJzdG9wUmVhc29uIiwiaXRlcmF0aW9ucyIsIm1heEl0ZXJhdGlvbnMiLCJ0b29sQ2FsbHMiLCJwcmVmZXRjaFRvb2xDYWxscyIsImxvb3BUb29sQ2FsbHMiLCJzeW50aGVzaXNTdGFydGVkIiwiZGlhZ25vc3RpY0NvZGVzIiwiaW5zdGFsbERpc2Nvbm5lY3RlZEFpRml4dHVyZSIsImRpYWdub3N0aWNEZXRhaWxzIiwiZXJyb3JDb2RlIiwiZXJyb3JNZXNzYWdlIiwiaW5zdGFsbFJlc3VtZWRBbmFseXNpc0ZhaWx1cmVGaXh0dXJlIiwiaW5zdGFsbEludGVycnVwdGVkUmVzdW1lRml4dHVyZSIsImluaXRpYWxUb2tlbiIsInBhcnRpYWxBbnN3ZXIiLCJjcmVhdGVSZWxlYXNlU2lnbkluVXJsIiwic2VjcmV0S2V5IiwiQ0xFUktfU0VDUkVUX0tFWSIsIkF1dGhvcml6YXRpb24iLCJ1c2VyUmVzcG9uc2UiLCJlbmNvZGVVUklDb21wb25lbnQiLCJ1c2VySWQiLCJqc29uIiwiY3JlYXRlZFJlc3BvbnNlIiwiZGF0YSIsImVtYWlsX2FkZHJlc3MiLCJmaXJzdF9uYW1lIiwibGFzdF9uYW1lIiwic2tpcF9wYXNzd29yZF9jaGVja3MiLCJza2lwX3Bhc3N3b3JkX3JlcXVpcmVtZW50IiwidG9rZW5SZXNwb25zZSIsInVzZXJfaWQiLCJ0b2tlbiIsInRvU3RyaW5nIiwicHJvZ3JhbW1hdGljU2lnbkluIiwiX2dsb2JhbFRoaXMkc2lnbkluQ2xlIiwiZ290byIsImhlbHBlciIsImdsb2JhbFRoaXMiLCJzaWduSW5DbGVya1VzZXIiLCJfX0VOR0lORUVSSU5HT1NfU0lHTl9JTl9DTEVSS19VU0VSX18iLCJSVU5fQ09OVFJPTExFRF9SRUxFQVNFX1ZBTElEQVRJT04iLCJ0b0hhdmVVUkwiLCJSZWdFeHAiLCJyZXBsYWNlQWxsIiwiY29tcGxldGVSZWFkaW5lc3NIYW5kc2hha2UiLCJzaWduSW5VcmwiLCJ0dGwiLCJiYXNlUGF0aCIsIkRBU0hCT0FSRF9FMkVfTElWRV9QUk9WSURFUiIsIkRBU0hCT0FSRF9FMkVfTElWRV9ESVNQT1NBQkxFIiwiZGlzcG9zYWJsZVByb2plY3QiLCJkZWFkbGluZSIsIkRhdGUiLCJub3ciLCJsYXN0U3RhdHVzIiwiX3JlYWRpbmVzc0JvZHkkY2hlY2tzIiwiX3JlYWRpbmVzc0JvZHkkY2hlY2tzMiIsIl9yZWFkaW5lc3NCb2R5JGNoZWNrczMiLCJfcmVhZGluZXNzQm9keSRjaGVja3M0IiwiX3JlYWRpbmVzc0JvZHkkY2hlY2tzNSIsInJlYWRpbmVzcyIsImZldGNoIiwiY3JlZGVudGlhbHMiLCJvayIsImNhdGNoIiwicmVhZGluZXNzQm9keSIsIk9iamVjdCIsInZhbHVlcyIsInByb2plY3RzUmVzdWx0IiwiZXhwZWN0ZWRQcm9qZWN0IiwidW5kZWZpbmVkIiwiZml4dHVyZVByb2plY3RSZWFkeSIsIkFycmF5IiwiaXNBcnJheSIsIl9wcm9qZWN0cyQiLCJhdXRoIiwiZml4dHVyZVByb2plY3QiLCJlbnRyaWVzIiwiUHJvbWlzZSIsInJlc29sdmUiLCJzZXRUaW1lb3V0Iiwib3Blbk5hdmlnYXRpb24iLCJsYWJlbCIsImNsaWNrIiwiYXBpVXJsIiwiYXBpQmFzZVVybCIsIkRBU0hCT0FSRF9FMkVfQVBJX0JBU0VfVVJMIiwibGl2ZVJlcXVlc3QiLCJfb3B0aW9ucyRtZXRob2QiLCJzaWduYWwiLCJBYm9ydFNpZ25hbCIsInRleHQiLCJyZWNvcmRlZE9yaWdpbkRpYWdub3N0aWNzIiwib3JpZ2luRGlhZ25vc3RpY1BhdGgiLCJEQVNIQk9BUkRfRTJFX09SSUdJTl9ESUFHTk9TVElDU19QQVRIIiwicmVsZXZhbnRPcmlnaW5IZWFkZXJzIiwiZnJvbUVudHJpZXMiLCJmbGF0TWFwIiwid3JpdGVPcmlnaW5EaWFnbm9zdGljcyIsIm91dHB1dFBhdGgiLCJkaWFnbm9zdGljcyIsImV4cGVjdE9yaWdpbkNhblVzZUFwaSIsImhlYWx0aFVybCIsIm11dGF0aW9uVXJsIiwiY29tbW9uSGVhZGVycyIsIk9yaWdpbiIsImFzc2VydGlvbiIsImF0IiwiY3VycmVudCIsIl9yZXNwb25zZSRoZWFkZXJzJGFjYyIsIl9yZXNwb25zZSRoZWFkZXJzJGFjYzIiLCJ0b1VwcGVyQ2FzZSIsInRvQ29udGFpbiIsImhlYWRlciIsIm5vdCIsImV4cGVjdEhvc3RpbGVPcmlnaW5SZWplY3RlZCIsInVwbG9hZFVybCIsImxpdmVVcGRhdGVVcmwiLCJkaWFnbm9zdGljIiwidG9CZVVuZGVmaW5lZCIsImhvc3RpbGVVcGxvYWQiLCJtdWx0aXBhcnQiLCJhcmNoaXZlIiwibWltZVR5cGUiLCJidWZmZXIiLCJob3N0aWxlTGl2ZVVwZGF0ZSIsInBhcnNlU3NlIiwiY2h1bmsiLCJfY2h1bmskc3BsaXQkZmluZCIsImxpbmUiLCJwYXJzZSIsImxpdmVKc29uIiwibGl2ZUFycmF5IiwibGl2ZU9wdGlvbmFsUmVjb3JkIiwiZGVzY3JpYmUiLCJfZXhlY3V0aW9uJG9wZXJhdGlvbkkiLCJfZXhlY3V0aW9uJGZsaWdodFN0YXQiLCJfZ2l0TG9nJGNvbW1pdHMkMCRzaG8iLCJfZ2l0TG9nJGNvbW1pdHMiLCJfZ2l0TG9nJGNvbW1pdHMyIiwiX3Byb2Nlc3MkZW52JERBU0hCT0FSNiIsInNraXAiLCJjYW1wYWlnblNjZW5hcmlvIiwic3RyZWFtUmVzcG9uc2UiLCJpZGVtcG90ZW5jeUtleSIsInNzZUV2ZW50cyIsInN0YXJ0ZWQiLCJtZXNzYWdlcyIsInByb3Bvc2FsIiwiZ2l0TG9nIiwibWlzc2lvbkNvbnRyb2wiLCJkYXNoYm9hcmRTdGF0ZSIsInJlY2VudFN0ZXBzIiwidmFsaWRhdGlvbiIsImNhbmRpZGF0ZUhhc2giLCJfc3RlcCR2YWxpZGF0aW9uJGNhbmQiLCJfc3RlcCR2YWxpZGF0aW9uIiwiY2FuZGlkYXRlSWRlbnRpdHkiLCJldmlkZW5jZUNvdW50IiwicmVkdWNlIiwiY291bnQiLCJ0ZXJtaW5hbFN0YXRlIiwic3VjY2Vzc1N0YXRlcyIsImRlbGl2ZXJ5U3RhZ2VzIiwiYXBwbGllZCIsImNvbW1pdHRlZCIsInB1c2hlZCIsImNhcHR1cmUiLCJ3b3Jrc3BhY2VSZXZpc2lvbiIsImNvbW1pdHMiLCJzaG9ydEhhc2giLCJjYW5kaWRhdGVSZXZpc2lvbiIsImN1cnJlbnRPcGVyYXRpb24iLCJyZXZpc2lvbiIsInJldGFpbmVkUmVzdWx0IiwibWVzc2FnZVNlc3Npb24iLCJtZXNzYWdlRXhlY3V0aW9uIiwiZXZlbnRFeGVjdXRpb24iLCJldmVudFNlc3Npb24iLCJjaGVja3BvaW50cyIsInNlcXVlbmNlIiwicHJvcG9zYWxzIiwiX3N0ZXAkdmFsaWRhdGlvbiRzdGF0IiwiX3N0ZXAkdmFsaWRhdGlvbjIiLCJfc3RlcCR2YWxpZGF0aW9uJHByb2YiLCJfc3RlcCR2YWxpZGF0aW9uMyIsInByb2ZpbGUiLCJ2YWxpZGF0aW9uUHJvZmlsZSIsImRhc2hib2FyZCIsIkRBU0hCT0FSRF9FMkVfTElWRV9SRVBPUlRfUEFUSCIsImZpcnN0IiwicmF3RGlhZ25vc3RpYyIsInJhd0NyZWRlbnRpYWwiLCJzdXBwb3J0UmVmZXJlbmNlcyIsImF1dGhlbnRpY2F0aW9uX2ZhaWxlZCIsInF1b3RhX2V4aGF1c3RlZCIsInByb3ZpZGVyX291dGFnZSIsImFnZW50UmVzcG9uc2UiLCJ0ZXJtaW5hbFN0YXR1cyIsImF2YWlsYWJpbGl0eVN0YXRlIiwib3BlcmF0b3JBY3Rpb24iLCJtb2RlbCIsInRlcm1pbmFsUmVhc29uIiwid29ya2Zsb3dJZCIsInBoYXNlcyIsImN1cnJlbnRQaGFzZSIsImV4ZWN1dGlvbkNvdW50IiwiY29tcGxldGVkUGhhc2VzIiwicmVjb3ZlcnkiLCJnZXRCeUxhYmVsIiwidGFza0RldGFpbHMiLCJsb2NhdG9yIiwidG9Db250YWluVGV4dCIsInJlbG9hZCIsInJlbG9hZGVkQXV0aERldGFpbHMiLCJyZWxvYWRlZFRhc2tUZXh0IiwiaW5uZXJUZXh0IiwidG9NYXRjaCIsInJlbG9hZGVkRXhlY3V0aW9uIiwidmlzaWJsZVRleHQiLCJyYXdQcm9tcHQiLCJyZWFkeVRhc2tJZCIsInJldmlld1Rhc2tJZCIsInZlcmlmaWNhdGlvblRhc2tJZCIsInJlbWVkaWF0aW9uVGFza3MiLCJwcm9tcHQiLCJ2ZXJzaW9uIiwicnVsZUlkIiwicnVsZUNvZGUiLCJydWxlVGl0bGUiLCJvY2N1cnJlbmNlQ291bnQiLCJmaWxlIiwic25pcHBldCIsIm9jY3VycmVuY2VzIiwiZml4RGVzY3JpcHRpb24iLCJjb21wbGV0ZW5lc3MiLCJyZWFkeVJvdyIsImdldEJ5VGl0bGUiLCJyZWFkeURldGFpbHMiLCJyZWFkeVBsYW4iLCJwb2xsIiwidG9IYXZlQ291bnQiLCJyZXZpZXdSb3ciLCJyZXZpZXdEZXRhaWxzIiwicmV2aWV3UGxhbiIsInZlcmlmaWNhdGlvblJvdyIsInZlcmlmaWNhdGlvbkRldGFpbHMiLCJ2ZXJpZmljYXRpb25QbGFuIiwiZmlyc3RHdWlkYW5jZSIsInNlY29uZEd1aWRhbmNlIiwiZmlyc3RFdmlkZW5jZSIsInNlY29uZEV2aWRlbmNlIiwicGFzc0J1dHRvbnMiLCJmYWlsZWRCdXR0b25zIiwibnRoIiwidG9CZURpc2FibGVkIiwiZmlsbCIsInRvTWF0Y2hPYmplY3QiLCJyZWxvYWRlZFZlcmlmaWNhdGlvblJvdyIsInJlbG9hZGVkRGV0YWlscyIsImJyb3dzZXIiLCJzZWNvbmRDb250ZXh0IiwibmV3Q29udGV4dCIsInNlY29uZFBhZ2UiLCJuZXdQYWdlIiwiYWxsIiwiY3VycmVudERhc2hib2FyZEZpeHR1cmUiLCJyZWZyZXNoQ291bnQiLCJyZWxlYXNlU3RhbGVSZXNwb25zZSIsInN0YWxlUmVzcG9uc2VSZWxlYXNlZCIsInN0YWxlUmVmcmVzaCIsInJlY29ubmVjdEF0dGVtcHQiLCJ1bnJvdXRlIiwiY2xvc2UiLCJhdWRpdFJlcXVlc3RzIiwiYXVkaXRCb2R5IiwiZm9ybWF0IiwiZXhwb3J0ZWRBdCIsInByb29mIiwicmVxdWlyZWQiLCJ2ZXJkaWN0IiwidGltZWxpbmUiLCJ2YWxpZGF0aW9ucyIsImFmZmVjdGVkRmlsZXMiLCJyZWRhY3Rpb24iLCJleGNsdWRlZCIsImxvY2FsU3RvcmFnZSIsInNldEl0ZW0iLCJwcmV2aWV3IiwidG9IYXZlTGVuZ3RoIiwidG9CZUhpZGRlbiIsImRvd25sb2FkUHJvbWlzZSIsIndhaXRGb3JFdmVudCIsImRvd25sb2FkIiwic3VnZ2VzdGVkRmlsZW5hbWUiLCJyZWxvYWRlZFByb29mIiwiY2FuY2VsbGVkRXhlY3V0aW9uIiwiX3Byb2Nlc3MkZW52JERBU0hCT0FSNyIsImxpdmVMb2ciLCJsZXZlbCIsInVwbG9hZFJlc3VsdCIsImJ5dGVzIiwiVWludDhBcnJheSIsImF0b2IiLCJjaGFyYWN0ZXIiLCJjaGFyQ29kZUF0IiwiRm9ybURhdGEiLCJhcHBlbmQiLCJCbG9iIiwidG9FcXVhbCIsInRhc2tSb3ciLCJtZXRhZGF0YSIsImFjdGl2aXR5IiwiaGFzVGV4dCIsIm5vblN0cmVhbVJlcXVlc3RzIiwib24iLCJleGhhdXN0ZWQiLCJzaXplIiwiXyIsIlVUQyIsInRvSVNPU3RyaW5nIiwiZXZlbnRSZXF1ZXN0cyIsImZpcnN0UmVxdWVzdCIsIndhaXRGb3JSZXF1ZXN0IiwiZ2V0QnlQbGFjZWhvbGRlciIsInNlbGVjdE9wdGlvbiIsInRvSGF2ZVZhbHVlIiwiZmlsdGVyZWRSZXF1ZXN0IiwiY29tcG9zZXIiLCJzZW5kQnV0dG9uIiwidG9CZUVuYWJsZWQiLCJzdHJlYW1SZXNwb25zZVByb21pc2UiLCJ3YWl0Rm9yUmVzcG9uc2UiLCJsYXN0Iiwic2V0Vmlld3BvcnRTaXplIiwid2lkdGgiLCJoZWlnaHQiLCJhY2NlcHRlZCIsImFzc2VydEFjY2VwdGVkQ2l0YXRpb24iLCJhc3NlcnRCbG9ja2VkQ2l0YXRpb24iLCJhc3NlcnROb0ludGVybmFsQ2l0YXRpb25EZXRhaWxzIiwiZ29CYWNrIiwiZ29Gb3J3YXJkIiwiX2F3YWl0JHJlc3VtZVJlcXVlc3QkIiwicmVzdW1lUmVxdWVzdCIsInBvc3REYXRhIiwib2JqZWN0Q29udGFpbmluZyIsIl9zdHJlYW1SZXF1ZXN0cyQiLCJfc3RyZWFtUmVxdWVzdHMkMiIsImFkZEluaXRTY3JpcHQiLCJuYXRpdmVGZXRjaCIsImJpbmQiLCJpbnB1dCIsImluaXQiLCJSZXF1ZXN0IiwicmVhZGVyIiwiZ2V0UmVhZGVyIiwiZW5jb2RlciIsIlRleHRFbmNvZGVyIiwic3RyZWFtIiwiUmVhZGFibGVTdHJlYW0iLCJzdGFydCIsImNvbnRyb2xsZXIiLCJidWZmZXJlZCIsImRvbmUiLCJyZWFkIiwiZW5xdWV1ZSIsImVuY29kZSIsIlRleHREZWNvZGVyIiwiZGVjb2RlIiwibWFya2VyIiwiaW5kZXhPZiIsImZyYW1lRW5kIiwiVHlwZUVycm9yIiwiUmVzcG9uc2UiLCJzdGF0dXNUZXh0Iiwic3RvcmFnZUtleSIsInBvaW50ZXJLZXkiLCJrZXkiLCJnZXRJdGVtIiwiX2xvY2FsU3RvcmFnZSRnZXRJdGVtIiwic2F2ZWQiLCJfbG9jYWxTdG9yYWdlJGdldEl0ZW0yIiwibGlmZWN5Y2xlIiwicmVjb3ZlcnlTdGF0ZSIsIm9wZXJhdG9yRXhwbGFuYXRpb24iLCJuZXh0QWN0aW9uIiwiY29uZmxpY3RSZWFzb24iLCJ2YWxpZGF0aW9uRXZpZGVuY2UiLCJ3b3Jrc3BhY2VBdmFpbGFibGUiLCJjaGFuZ2VDb3VudCIsInJlZ2lvbiIsImF2YWlsYWJsZSIsIm1pc3NpbmciLCJkaXNjYXJkZWQiLCJ0b0hhdmVBdHRyaWJ1dGUiLCJyZWxvYWRlZFJlZ2lvbiIsInRvQmVHcmVhdGVyVGhhbk9yRXF1YWwiLCJvcGVyYXRpb24iLCJiZWZvcmVPcGVuIiwiYm91bmRpbmdCb3giLCJ0b0JlR3JlYXRlclRoYW4iLCJkcmF3ZXIiLCJkcmF3ZXJCb3giLCJkdXJpbmdPcGVuIl0sInNvdXJjZXMiOlsiZGFzaGJvYXJkLmpvdXJuZXkudHMiXSwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgZXhwZWN0LCB0ZXN0LCB0eXBlIFBhZ2UgfSBmcm9tIFwiQHBsYXl3cmlnaHQvdGVzdFwiO1xuaW1wb3J0IHsgbWtkaXIsIHdyaXRlRmlsZSB9IGZyb20gXCJub2RlOmZzL3Byb21pc2VzXCI7XG5pbXBvcnQgeyBkaXJuYW1lIH0gZnJvbSBcIm5vZGU6cGF0aFwiO1xuaW1wb3J0IHtcbiAgcGFyc2VDbGVya1NpZ25JblRva2VuUmVzcG9uc2UsXG4gIHBhcnNlQ2xlcmtVc2VyTG9va3VwUmVzcG9uc2UsXG4gIHBhcnNlQ3JlYXRlZENsZXJrVXNlclJlc3BvbnNlLFxufSBmcm9tIFwiLi4vc3JjL2xpYi9jbGVyay1oYW5kb2ZmXCI7XG5cbmNvbnN0IERBU0hCT0FSRF9QQVRIID0gXCIvZGFzaGJvYXJkL1wiO1xuY29uc3QgVEVTVF9VU0VSID0ge1xuICBmaXJzdE5hbWU6IFwiRW5naW5lZXJpbmdPU1wiLFxuICBsYXN0TmFtZTogXCJEYXNoYm9hcmQgU21va2VcIixcbiAgZW1haWw6XG4gICAgcHJvY2Vzcy5lbnYuREFTSEJPQVJEX0UyRV9FTUFJTCA/P1xuICAgIFwiZW5naW5lZXJpbmdvcy1kYXNoYm9hcmQtc21va2VAZXhhbXBsZS5jb21cIixcbn07XG5jb25zdCBFWEVDVVRJT05fSUQgPSBcImUyZS1jb250cm9sbGVkLWV4ZWN1dGlvblwiO1xuY29uc3QgREVGQVVMVF9MSVZFX1RJTUVPVVRfTVMgPSAxMjBfMDAwO1xuY29uc3QgTElWRV9URVNUX1RJTUVPVVRfTUFSR0lOX01TID0gNV8wMDA7XG5jb25zdCBERUZBVUxUX1JFQURJTkVTU19USU1FT1VUX01TID0gMTVfMDAwO1xuY29uc3QgVEVTVF9NT0RFUyA9IG5ldyBTZXQoW1wiZml4dHVyZVwiLCBcImxpdmUtcHJvdmlkZXJcIl0pO1xuY29uc3QgSE9TVElMRV9PUklHSU4gPSBcImh0dHBzOi8vYXR0YWNrZXIuZXhhbXBsZVwiO1xuY29uc3QgT1JJR0lOX0RJQUdOT1NUSUNfSEVBREVSUyA9IFtcbiAgXCJhY2Nlc3MtY29udHJvbC1hbGxvdy1vcmlnaW5cIixcbiAgXCJhY2Nlc3MtY29udHJvbC1hbGxvdy1tZXRob2RzXCIsXG4gIFwiYWNjZXNzLWNvbnRyb2wtYWxsb3ctaGVhZGVyc1wiLFxuICBcInZhcnlcIixcbl0gYXMgY29uc3Q7XG5jb25zdCBERUZBVUxUX0xJVkVfUFJPTVBUID1cbiAgXCJQZXJmb3JtIGEgYm91bmRlZCBmb3JlbnNpYyBhdWRpdCBvZiB0aGlzIGRpc3Bvc2FibGUgcHJvamVjdCB1c2luZyByZWFkLW9ubHkgdG9vbHMuIFwiICtcbiAgXCJQcm9kdWNlIGF0IGxlYXN0IG9uZSBhY2NlcHRlZCBldmlkZW5jZSBpdGVtIGFuZCBvbmUgdmFsaWRhdGlvbiBjaGVja3BvaW50LCBhbmQgZG8gbm90IFwiICtcbiAgXCJyZXBvcnQgQ09NUExFVEVEIHVubGVzcyBib3RoIGFyZSBwcmVzZW50LiBSZXBvcnQgb25seSB2ZXJpZmllZCBldmlkZW5jZS5cIjtcbmNvbnN0IExJVkVfQ0FNUEFJR05fU0NFTkFSSU9TID0gbmV3IFNldChbXG4gIFwicHJvdmlkZXItb3V0YWdlXCIsXG4gIFwibWFsZm9ybWVkLW91dHB1dFwiLFxuICBcImRlbGl2ZXJ5LXN1Y2Nlc3NcIixcbl0pO1xuXG5mdW5jdGlvbiBsaXZlQ2FtcGFpZ25TY2VuYXJpbygpOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICBjb25zdCBzY2VuYXJpbyA9IHByb2Nlc3MuZW52LkRBU0hCT0FSRF9FMkVfTElWRV9TQ0VOQVJJTz8udHJpbSgpO1xuICBpZiAocHJvY2Vzcy5lbnYuREFTSEJPQVJEX0UyRV9MSVZFX0NBTVBBSUdOID09PSBcIjFcIiAmJiAhc2NlbmFyaW8pIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICBcIkxpdmUgY2FtcGFpZ24gcmVxdWlyZXMgREFTSEJPQVJEX0UyRV9MSVZFX1NDRU5BUklPPXByb3ZpZGVyLW91dGFnZSwgbWFsZm9ybWVkLW91dHB1dCwgb3IgZGVsaXZlcnktc3VjY2Vzcy5cIixcbiAgICApO1xuICB9XG4gIGlmIChzY2VuYXJpbyAmJiAhTElWRV9DQU1QQUlHTl9TQ0VOQVJJT1MuaGFzKHNjZW5hcmlvKSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgVW5zdXBwb3J0ZWQgbGl2ZSBjYW1wYWlnbiBzY2VuYXJpbzogJHtzY2VuYXJpb30uYCk7XG4gIH1cbiAgcmV0dXJuIHNjZW5hcmlvO1xufVxuXG5mdW5jdGlvbiBsaXZlUHJvbXB0KCk6IHN0cmluZyB7XG4gIGNvbnN0IHNjZW5hcmlvID0gbGl2ZUNhbXBhaWduU2NlbmFyaW8oKTtcbiAgaWYgKHNjZW5hcmlvID09PSBcInByb3ZpZGVyLW91dGFnZVwiKSB7XG4gICAgcmV0dXJuIFwiUnVuIGEgYm91bmRlZCBmb3JlbnNpYyBhdWRpdCBhbmQgcmVwb3J0IHRoZSBPcGVuUm91dGVyIHJhdGUtbGltaXQvcHJvdmlkZXItZXhoYXVzdGlvbiBvdXRhZ2UgYXMgYSBmYWlsZWQgb3IgaW5jb21wbGV0ZSBvcGVyYXRpb24uIERvIG5vdCB1c2UgcHJpb3IgYW5hbHlzaXMgYXMgYSBjdXJyZW50IGFuc3dlcjsgaW5jbHVkZSB0aGUgY3VycmVudCBvcGVyYXRpb24gYW5kIHJldmlzaW9uLlwiO1xuICB9XG4gIGlmIChzY2VuYXJpbyA9PT0gXCJtYWxmb3JtZWQtb3V0cHV0XCIpIHtcbiAgICByZXR1cm4gXCJSdW4gYSBib3VuZGVkIGZvcmVuc2ljIGF1ZGl0IGFuZCB0cmVhdCBtYWxmb3JtZWQgcHJvdmlkZXIgb3V0cHV0IGFzIGZhaWxlZCBvciBpbmNvbXBsZXRlLiBEbyBub3QgY2xhaW0gc3VjY2VzcywgYXBwbHksIGNvbW1pdCwgb3IgcHVzaCB3aXRob3V0IGNhbmRpZGF0ZS1ib3VuZCBldmlkZW5jZS5cIjtcbiAgfVxuICBpZiAoc2NlbmFyaW8gPT09IFwiZGVsaXZlcnktc3VjY2Vzc1wiKSB7XG4gICAgcmV0dXJuIFwiUGxlYXNlIGNvbmR1Y3QgdGhlIGJvdW5kZWQgZGVsaXZlcnkgcHJvb2YgY2FtcGFpZ24gb24gdGhpcyBkaXNwb3NhYmxlIHByb2plY3QuIEV4ZXJjaXNlIGFwcGx5LCBjb21taXQsIGFuZCBwdXNoIG9ubHkgd2hlbiBlYWNoIGN1cnJlbnQgb3BlcmF0aW9uLCBwcm9qZWN0IHJldmlzaW9uLCBjYW5kaWRhdGUgaWRlbnRpdHksIGFuZCBjYW5kaWRhdGUtYm91bmQgZXZpZGVuY2UgbWF0Y2guIFJlcG9ydCBldmVyeSB0ZXJtaW5hbCByZWNlaXB0LlwiO1xuICB9XG4gIHJldHVybiBwcm9jZXNzLmVudi5EQVNIQk9BUkRfRTJFX0xJVkVfUFJPTVBUID8/IERFRkFVTFRfTElWRV9QUk9NUFQ7XG59XG5cbmZ1bmN0aW9uIGxpdmVUaW1lb3V0TXMoKTogbnVtYmVyIHtcbiAgY29uc3QgY29uZmlndXJlZCA9IE51bWJlcihwcm9jZXNzLmVudi5EQVNIQk9BUkRfRTJFX0xJVkVfVElNRU9VVF9NUyk7XG4gIHJldHVybiBOdW1iZXIuaXNGaW5pdGUoY29uZmlndXJlZCkgJiYgY29uZmlndXJlZCA+IDBcbiAgICA/IGNvbmZpZ3VyZWRcbiAgICA6IERFRkFVTFRfTElWRV9USU1FT1VUX01TO1xufVxuXG5mdW5jdGlvbiBkYXNoYm9hcmRUZXN0TW9kZSgpOiBzdHJpbmcge1xuICByZXR1cm4gcHJvY2Vzcy5lbnYuREFTSEJPQVJEX0UyRV9URVNUX01PREUgPz8gXCJmaXh0dXJlXCI7XG59XG5cbmZ1bmN0aW9uIHJlYWRpbmVzc1RpbWVvdXRNcygpOiBudW1iZXIge1xuICBjb25zdCBjb25maWd1cmVkID0gTnVtYmVyKHByb2Nlc3MuZW52LkRBU0hCT0FSRF9FMkVfUkVBRElORVNTX1RJTUVPVVRfTVMpO1xuICByZXR1cm4gTnVtYmVyLmlzRmluaXRlKGNvbmZpZ3VyZWQpICYmIGNvbmZpZ3VyZWQgPiAwXG4gICAgPyBjb25maWd1cmVkXG4gICAgOiBERUZBVUxUX1JFQURJTkVTU19USU1FT1VUX01TO1xufVxuXG5hc3luYyBmdW5jdGlvbiB3cml0ZVJlYWRpbmVzc1JlY2VpcHQoXG4gIG91dGNvbWU6IFwicmVhZHlcIiB8IFwiYmxvY2tlZFwiLFxuICBjaGVja3M6IFJlY29yZDxzdHJpbmcsIHVua25vd24+LFxuICByZWFzb24/OiBzdHJpbmcsXG4pIHtcbiAgY29uc3QgcmVjZWlwdFBhdGggPSBwcm9jZXNzLmVudi5EQVNIQk9BUkRfRTJFX1JFQURJTkVTU19BUlRJRkFDVF9QQVRIO1xuICBpZiAoIXJlY2VpcHRQYXRoKSByZXR1cm47XG4gIGF3YWl0IG1rZGlyKGRpcm5hbWUocmVjZWlwdFBhdGgpLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KTtcbiAgYXdhaXQgd3JpdGVGaWxlKFxuICAgIHJlY2VpcHRQYXRoLFxuICAgIGAke0pTT04uc3RyaW5naWZ5KFxuICAgICAge1xuICAgICAgICBvdXRjb21lLFxuICAgICAgICAuLi4ocmVhc29uID8geyByZWFzb24gfSA6IHt9KSxcbiAgICAgICAgY2hlY2tzLFxuICAgICAgICBtb2RlOiBkYXNoYm9hcmRUZXN0TW9kZSgpLFxuICAgICAgICBwcm9qZWN0OlxuICAgICAgICAgIGRhc2hib2FyZFRlc3RNb2RlKCkgPT09IFwibGl2ZS1wcm92aWRlclwiXG4gICAgICAgICAgICA/IHByb2Nlc3MuZW52LkRBU0hCT0FSRF9FMkVfTElWRV9QUk9KRUNUX0lEXG4gICAgICAgICAgICA6IFwiZTJlLXByb2plY3RcIixcbiAgICAgIH0sXG4gICAgICBudWxsLFxuICAgICAgMixcbiAgICApfVxcbmAsXG4gICAgXCJ1dGY4XCIsXG4gICk7XG59XG5cbmZ1bmN0aW9uIGFwcHJvdmVkRGFzaGJvYXJkT3JpZ2lucygpOiBzdHJpbmdbXSB7XG4gIGNvbnN0IG9yaWdpbnMgPSAocHJvY2Vzcy5lbnYuREFTSEJPQVJEX0UyRV9BUFBST1ZFRF9PUklHSU5TID8/IFwiXCIpXG4gICAgLnNwbGl0KFwiLFwiKVxuICAgIC5tYXAoKG9yaWdpbikgPT4gb3JpZ2luLnRyaW0oKSlcbiAgICAuZmlsdGVyKEJvb2xlYW4pO1xuICBpZiAob3JpZ2lucy5sZW5ndGggPT09IDApIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICBcIkRBU0hCT0FSRF9FMkVfQVBQUk9WRURfT1JJR0lOUyBtdXN0IGNvbnRhaW4gZXZlcnkgYXBwcm92ZWQgZGFzaGJvYXJkIG9yaWdpbi5cIixcbiAgICApO1xuICB9XG4gIHJldHVybiBvcmlnaW5zLm1hcCgob3JpZ2luKSA9PiB7XG4gICAgY29uc3QgcGFyc2VkID0gbmV3IFVSTChvcmlnaW4pO1xuICAgIGlmIChcbiAgICAgIHBhcnNlZC5vcmlnaW4gIT09IG9yaWdpbiB8fFxuICAgICAgcGFyc2VkLnBhdGhuYW1lICE9PSBcIi9cIiB8fFxuICAgICAgcGFyc2VkLnNlYXJjaCB8fFxuICAgICAgcGFyc2VkLmhhc2hcbiAgICApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgYERhc2hib2FyZCBqb3VybmV5IG9yaWdpbiBtdXN0IGJlIGEgYmFyZSBvcmlnaW46ICR7b3JpZ2lufWAsXG4gICAgICApO1xuICAgIH1cbiAgICByZXR1cm4gcGFyc2VkLm9yaWdpbjtcbiAgfSk7XG59XG5cbmNvbnN0IGRhc2hib2FyZEZpeHR1cmUgPSB7XG4gIGZyZXNobmVzc1JldmlzaW9uOiBcIjIwMjYtMDEtMDFUMDA6MDA6MDAuMDAwWlwiLFxuICBwcm9qZWN0Q291bnQ6IDEsXG4gIGFjdGl2ZVRhc2tDb3VudDogMCxcbiAgY29tcGxldGVkVGFza0NvdW50OiAyLFxuICBmYWlsZWRUYXNrQ291bnQ6IDAsXG4gIHRhc2tTdGF0dXNCcmVha2Rvd246IHsgcGVuZGluZzogMCwgcnVubmluZzogMCB9LFxuICBwcm9qZWN0U2NvcmVzOiBbXG4gICAge1xuICAgICAgcHJvamVjdElkOiBcImUyZS1wcm9qZWN0XCIsXG4gICAgICBwcm9qZWN0TmFtZTogXCJTbW9rZSBQcm9qZWN0XCIsXG4gICAgICBzY29yZTogOTIsXG4gICAgICB0cmVuZDogXCJzdGFibGVcIixcbiAgICB9LFxuICBdLFxuICByZWNlbnRFdmVudHM6IFtcbiAgICB7XG4gICAgICBpZDogXCJlMmUtZXZlbnRcIixcbiAgICAgIHR5cGU6IFwiU21va2VDaGVja1wiLFxuICAgICAgc2V2ZXJpdHk6IFwic3VjY2Vzc1wiLFxuICAgICAgbWVzc2FnZTogXCJEYXNoYm9hcmQgQVBJIGZpeHR1cmUgcmVhZHlcIixcbiAgICAgIHRpbWVzdGFtcDogXCIyMDI2LTAxLTAxVDAwOjAwOjAwLjAwMFpcIixcbiAgICB9LFxuICBdLFxuICB0b3BSdWxlczogW10sXG59O1xuXG5jb25zdCBleGVjdXRpb25GaXh0dXJlID0ge1xuICBpZDogRVhFQ1VUSU9OX0lELFxuICBwcm9qZWN0SWQ6IFwiZTJlLXByb2plY3RcIixcbiAgb3BlcmF0aW9uSWQ6IFwiZTJlLW9wZXJhdGlvblwiLFxuICBzdGF0dXM6IFwiY29tcGxldGVkXCIsXG4gIGZsaWdodFN0YXRlOiBcIkNPTVBMRVRFRFwiLFxuICBldmlkZW5jZVZlcmRpY3Q6IFwiUFJPVkVOXCIsXG4gIHByb29mUmVxdWlyZWQ6IGZhbHNlLFxuICByZXN1bWFibGU6IGZhbHNlLFxuICBjaGVja3BvaW50VmVyc2lvbjogMSxcbiAgcHJvamVjdFJldmlzaW9uOiBcImUyZS1yZXZpc2lvbi00MlwiLFxuICBjaGVja3BvaW50OiB7XG4gICAgc3RhZ2U6IFwiY29tcGxldGVcIixcbiAgICBkZXRhaWw6IFwiQ29udHJvbGxlZCBicm93c2VyIGZpeHR1cmUgY29tcGxldGVkLlwiLFxuICB9LFxuICBvYmplY3RpdmU6IHsgb2JqZWN0aXZlOiBcIlZlcmlmeSB0aGUgZGFzaGJvYXJkIGJyb3dzZXIgam91cm5leVwiIH0sXG4gIHN0YXJ0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAwOjAwLjAwMFpcIixcbiAgY29tcGxldGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMTowMC4wMDBaXCIsXG4gIGNyZWF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAwOjAwLjAwMFpcIixcbiAgdXBkYXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDE6MDAuMDAwWlwiLFxufTtcblxuZnVuY3Rpb24ganNvblJlc3BvbnNlKFxuICBib2R5OiB1bmtub3duLFxuICBzdGF0dXMgPSAyMDAsXG4gIGhlYWRlcnM/OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+LFxuKSB7XG4gIHJldHVybiB7XG4gICAgc3RhdHVzLFxuICAgIGNvbnRlbnRUeXBlOiBcImFwcGxpY2F0aW9uL2pzb25cIixcbiAgICAuLi4oaGVhZGVycyA/IHsgaGVhZGVycyB9IDoge30pLFxuICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KGJvZHkpLFxuICB9O1xufVxuXG5hc3luYyBmdW5jdGlvbiBleHBlY3ROb0hvcml6b250YWxPdmVyZmxvdyhwYWdlOiBQYWdlKSB7XG4gIGNvbnN0IG92ZXJmbG93ID0gYXdhaXQgcGFnZS5ldmFsdWF0ZSgoKSA9PiAoe1xuICAgIGRvY3VtZW50OiBkb2N1bWVudC5kb2N1bWVudEVsZW1lbnQuc2Nyb2xsV2lkdGgsXG4gICAgYm9keTogZG9jdW1lbnQuYm9keS5zY3JvbGxXaWR0aCxcbiAgICB2aWV3cG9ydDogd2luZG93LmlubmVyV2lkdGgsXG4gIH0pKTtcbiAgZXhwZWN0KG92ZXJmbG93LmRvY3VtZW50KS50b0JlTGVzc1RoYW5PckVxdWFsKG92ZXJmbG93LnZpZXdwb3J0ICsgMSk7XG4gIGV4cGVjdChvdmVyZmxvdy5ib2R5KS50b0JlTGVzc1RoYW5PckVxdWFsKG92ZXJmbG93LnZpZXdwb3J0ICsgMSk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGV4cGVjdERhc2hib2FyZFJlYWR5KHBhZ2U6IFBhZ2UpIHtcbiAgYXdhaXQgZXhwZWN0KFxuICAgIHBhZ2UuZ2V0QnlSb2xlKFwiaGVhZGluZ1wiLCB7IG5hbWU6IFwiU3lzdGVtIE92ZXJ2aWV3XCIgfSksXG4gICkudG9CZVZpc2libGUoKTtcbiAgYXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlUZXh0KFwiU1lTVEVNIE9OTElORVwiLCB7IGV4YWN0OiB0cnVlIH0pKS50b0JlVmlzaWJsZSgpO1xufVxuXG5hc3luYyBmdW5jdGlvbiByZXN0YXJ0QXBpRm9yQ2FtcGFpZ24ocGFnZTogUGFnZSkge1xuICBjb25zdCBjb250cm9sVXJsID0gcHJvY2Vzcy5lbnYuREFTSEJPQVJEX0UyRV9DT05UUk9MX1VSTDtcbiAgaWYgKCFjb250cm9sVXJsKSB0aHJvdyBuZXcgRXJyb3IoXCJEYXNoYm9hcmQgY2FtcGFpZ24gY29udHJvbCBVUkwgaXMgbWlzc2luZy5cIik7XG4gIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgcGFnZS5yZXF1ZXN0LnBvc3QoYCR7Y29udHJvbFVybH0vcmVzdGFydC1hcGlgLCB7XG4gICAgdGltZW91dDogMTVfMDAwLFxuICB9KTtcbiAgZXhwZWN0KHJlc3BvbnNlLnN0YXR1cygpKS50b0JlKDIwNCk7XG59XG5cbnR5cGUgQXJhYmljQWlGaXh0dXJlID0ge1xuICBxdWVzdGlvbjogc3RyaW5nO1xuICBhbnN3ZXI6IHN0cmluZztcbiAgc291cmNlOiBzdHJpbmc7XG4gIHNlc3Npb25JZDogc3RyaW5nO1xuICBleGVjdXRpb25JZD86IHN0cmluZztcbiAgcHJvamVjdElkPzogc3RyaW5nO1xuICBzdHJlYW1Cb2R5OiBzdHJpbmc7XG4gIG1lc3NhZ2U6IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xufTtcblxuYXN5bmMgZnVuY3Rpb24gaW5zdGFsbEFwaUZpeHR1cmVzKFxuICBwYWdlOiBQYWdlLFxuICBvdmVycmlkZXM/OiB7XG4gICAgYXJhYmljQWk/OiBBcmFiaWNBaUZpeHR1cmU7XG4gICAgYWx0ZXJuYXRlQWk/OiBBcmFiaWNBaUZpeHR1cmU7XG4gICAgZGlzY29ubmVjdEFpPzogQXJhYmljQWlGaXh0dXJlO1xuICAgIHJlc3VtZUZhaWx1cmU/OiB7XG4gICAgICBmaXh0dXJlOiBBcmFiaWNBaUZpeHR1cmU7XG4gICAgICBleGVjdXRpb246IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAgIH07XG4gICAgaW50ZXJydXB0ZWRSZXN1bWU/OiB7XG4gICAgICBmaXh0dXJlOiBBcmFiaWNBaUZpeHR1cmU7XG4gICAgICBleGVjdXRpb246IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAgICAgcmVjb3ZlcmVkVG9rZW46IHN0cmluZztcbiAgICAgIHJlc3VtZWRTdHJlYW1Cb2R5OiBzdHJpbmc7XG4gICAgfTtcbiAgICBkZWxpdmVyeVJlY292ZXJ5Pzoge1xuICAgICAgb3BlcmF0aW9uczogQXJyYXk8UmVjb3JkPHN0cmluZywgdW5rbm93bj4+O1xuICAgICAgcmVxdWVzdHM6IHN0cmluZ1tdO1xuICAgICAgYWN0aW9uUmVxdWVzdHM/OiBzdHJpbmdbXTtcbiAgICAgIHJlY292ZXJ5QWN0aW9uPzoge1xuICAgICAgICBwcm9wb3NhbElkOiBzdHJpbmc7XG4gICAgICAgIGFjdGlvbjogXCJyZXN1bWUtdmFsaWRhdGlvblwiIHwgXCJkaXNjYXJkXCI7XG4gICAgICAgIHJlc3BvbnNlOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgICAgICAgc3RhdHVzPzogbnVtYmVyO1xuICAgICAgICBuZXh0T3BlcmF0aW9ucz86IEFycmF5PFJlY29yZDxzdHJpbmcsIHVua25vd24+PjtcbiAgICAgIH07XG4gICAgfTtcbiAgICBwcm9qZWN0cz86IEFycmF5PFJlY29yZDxzdHJpbmcsIHVua25vd24+PjtcbiAgICBldmVudHM/OiBBcnJheTxSZWNvcmQ8c3RyaW5nLCB1bmtub3duPj47XG4gICAgYXJjaGl2ZVVwbG9hZD86IHtcbiAgICAgIHVwbG9hZElkOiBzdHJpbmc7XG4gICAgICBvcmlnaW5hbE5hbWU6IHN0cmluZztcbiAgICB9O1xuICAgIGF1ZGl0RXhwb3J0Pzoge1xuICAgICAgYm9keTogUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gICAgICBmaWxlbmFtZTogc3RyaW5nO1xuICAgICAgcmVxdWVzdHM6IHN0cmluZ1tdO1xuICAgICAgZXhlY3V0aW9uPzogUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gICAgICBtZXNzYWdlT3V0Y29tZT86IHN0cmluZztcbiAgICAgIGZhaWxGaXJzdFByZXZpZXc/OiBib29sZWFuO1xuICAgIH07XG4gICAgbGl2ZVRhc2s/OiB7XG4gICAgICBpZDogc3RyaW5nO1xuICAgICAgdGl0bGU6IHN0cmluZztcbiAgICAgIHByb2plY3RJZDogc3RyaW5nO1xuICAgICAgbG9nOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgICAgIGluaXRpYWxMb2dzPzogQXJyYXk8UmVjb3JkPHN0cmluZywgdW5rbm93bj4+O1xuICAgICAgc3RyZWFtUmVxdWVzdHM/OiBzdHJpbmdbXTtcbiAgICAgIGZhaWxGaXJzdFN0cmVhbT86IGJvb2xlYW47XG4gICAgICBmYWlsU3RyZWFtQXR0ZW1wdHM/OiBudW1iZXI7XG4gICAgfTtcbiAgICB0YXNrQWN0aW9ucz86IHtcbiAgICAgIHRhc2tzOiBBcnJheTxSZWNvcmQ8c3RyaW5nLCB1bmtub3duPj47XG4gICAgICByZXF1ZXN0czogc3RyaW5nW107XG4gICAgICB2ZXJpZmljYXRpb25SZXF1ZXN0cz86IEFycmF5PFJlY29yZDxzdHJpbmcsIHVua25vd24+PjtcbiAgICB9O1xuICAgIHJlY292ZXJ5VGFza3M/OiBBcnJheTxSZWNvcmQ8c3RyaW5nLCB1bmtub3duPj47XG4gICAgcmVjb3ZlcnlXb3JrZmxvd3M/OiBBcnJheTxSZWNvcmQ8c3RyaW5nLCB1bmtub3duPj47XG4gICAgcmVjb3ZlcnlXb3JrZmxvd0V4ZWN1dGlvbnM/OiBSZWNvcmQ8c3RyaW5nLCBBcnJheTxSZWNvcmQ8c3RyaW5nLCB1bmtub3duPj4+O1xuICB9LFxuKSB7XG4gIGF3YWl0IHBhZ2Uucm91dGUoXCIqKi9hcGkvKipcIiwgYXN5bmMgKHJvdXRlKSA9PiB7XG4gICAgY29uc3QgdXJsID0gbmV3IFVSTChyb3V0ZS5yZXF1ZXN0KCkudXJsKCkpO1xuICAgIGNvbnN0IHBhdGggPSB1cmwucGF0aG5hbWUucmVwbGFjZSgvXlxcL2Rhc2hib2FyZCg/PVxcL3wkKS8sIFwiXCIpO1xuICAgIGNvbnN0IGFyYWJpY0FpID0gb3ZlcnJpZGVzPy5hcmFiaWNBaTtcbiAgICBjb25zdCBhbHRlcm5hdGVBaSA9IG92ZXJyaWRlcz8uYWx0ZXJuYXRlQWk7XG4gICAgY29uc3QgZGlzY29ubmVjdEFpID0gb3ZlcnJpZGVzPy5kaXNjb25uZWN0QWk7XG4gICAgY29uc3QgYWlGaXh0dXJlcyA9IFthcmFiaWNBaSwgYWx0ZXJuYXRlQWksIGRpc2Nvbm5lY3RBaV0uZmlsdGVyKFxuICAgICAgKGZpeHR1cmUpOiBmaXh0dXJlIGlzIEFyYWJpY0FpRml4dHVyZSA9PiBCb29sZWFuKGZpeHR1cmUpLFxuICAgICk7XG4gICAgY29uc3QgaGFzQ29uZmlndXJlZEFpRml4dHVyZSA9XG4gICAgICBhaUZpeHR1cmVzLmxlbmd0aCA+IDAgfHxcbiAgICAgIEJvb2xlYW4ob3ZlcnJpZGVzPy5yZXN1bWVGYWlsdXJlIHx8IG92ZXJyaWRlcz8uaW50ZXJydXB0ZWRSZXN1bWUpO1xuXG4gICAgaWYgKGFpRml4dHVyZXMubGVuZ3RoID4gMCAmJiBwYXRoLmVuZHNXaXRoKFwiL2FwaS9haS9jaGF0L3Nlc3Npb25zXCIpKSB7XG4gICAgICBjb25zdCBwcm9qZWN0SWQgPSB1cmwuc2VhcmNoUGFyYW1zLmdldChcInByb2plY3RJZFwiKTtcbiAgICAgIGNvbnN0IHByb2plY3RTZXNzaW9ucyA9IGFpRml4dHVyZXMuZmlsdGVyKFxuICAgICAgICAoZml4dHVyZSkgPT4gIWZpeHR1cmUucHJvamVjdElkIHx8IGZpeHR1cmUucHJvamVjdElkID09PSBwcm9qZWN0SWQsXG4gICAgICApO1xuICAgICAgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoXG4gICAgICAgIGpzb25SZXNwb25zZShcbiAgICAgICAgICBwcm9qZWN0U2Vzc2lvbnMubWFwKChmaXh0dXJlKSA9PiAoe1xuICAgICAgICAgICAgaWQ6IGZpeHR1cmUuc2Vzc2lvbklkLFxuICAgICAgICAgICAgdGl0bGU6IGZpeHR1cmUucXVlc3Rpb24sXG4gICAgICAgICAgICB1cGRhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMjowMC4wMDBaXCIsXG4gICAgICAgICAgfSkpLFxuICAgICAgICApLFxuICAgICAgKTtcbiAgICB9XG4gICAgaWYgKG92ZXJyaWRlcz8ucmVzdW1lRmFpbHVyZSAmJiBwYXRoLmVuZHNXaXRoKFwiL2FwaS9haS9jaGF0L3N0cmVhbVwiKSkge1xuICAgICAgbGV0IHJlcXVlc3RCb2R5OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiA9IHt9O1xuICAgICAgdHJ5IHtcbiAgICAgICAgcmVxdWVzdEJvZHkgPSByb3V0ZS5yZXF1ZXN0KCkucG9zdERhdGFKU09OKCkgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgLy8gVGhlIG5vcm1hbCBwcm92aWRlci1mcmVlIGZhbGxiYWNrIGJlbG93IGhhbmRsZXMgbWFsZm9ybWVkIHJlcXVlc3RzLlxuICAgICAgfVxuICAgICAgaWYgKFxuICAgICAgICByZXF1ZXN0Qm9keS5leGVjdXRpb25JZCA9PT0gb3ZlcnJpZGVzLnJlc3VtZUZhaWx1cmUuZml4dHVyZS5leGVjdXRpb25JZFxuICAgICAgKSB7XG4gICAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKHtcbiAgICAgICAgICBzdGF0dXM6IDIwMCxcbiAgICAgICAgICBjb250ZW50VHlwZTogXCJ0ZXh0L2V2ZW50LXN0cmVhbVwiLFxuICAgICAgICAgIGhlYWRlcnM6IHsgXCJDYWNoZS1Db250cm9sXCI6IFwibm8tY2FjaGVcIiB9LFxuICAgICAgICAgIGJvZHk6IG92ZXJyaWRlcy5yZXN1bWVGYWlsdXJlLmZpeHR1cmUuc3RyZWFtQm9keSxcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfVxuICAgIGlmIChvdmVycmlkZXM/LmludGVycnVwdGVkUmVzdW1lICYmIHBhdGguZW5kc1dpdGgoXCIvYXBpL2FpL2NoYXQvc3RyZWFtXCIpKSB7XG4gICAgICBsZXQgcmVxdWVzdEJvZHk6IFJlY29yZDxzdHJpbmcsIHVua25vd24+ID0ge307XG4gICAgICB0cnkge1xuICAgICAgICByZXF1ZXN0Qm9keSA9IHJvdXRlLnJlcXVlc3QoKS5wb3N0RGF0YUpTT04oKSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICAvLyBUaGUgbm9ybWFsIHByb3ZpZGVyLWZyZWUgZmFsbGJhY2sgYmVsb3cgaGFuZGxlcyBtYWxmb3JtZWQgcmVxdWVzdHMuXG4gICAgICB9XG4gICAgICBjb25zdCB7IGZpeHR1cmUsIHJlc3VtZWRTdHJlYW1Cb2R5IH0gPSBvdmVycmlkZXMuaW50ZXJydXB0ZWRSZXN1bWU7XG4gICAgICBpZiAocmVxdWVzdEJvZHkuZXhlY3V0aW9uSWQgPT09IGZpeHR1cmUuZXhlY3V0aW9uSWQpIHtcbiAgICAgICAgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoe1xuICAgICAgICAgIHN0YXR1czogMjAwLFxuICAgICAgICAgIGNvbnRlbnRUeXBlOiBcInRleHQvZXZlbnQtc3RyZWFtXCIsXG4gICAgICAgICAgaGVhZGVyczogeyBcIkNhY2hlLUNvbnRyb2xcIjogXCJuby1jYWNoZVwiIH0sXG4gICAgICAgICAgYm9keTogcmVzdW1lZFN0cmVhbUJvZHksXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgICAgaWYgKCFyZXF1ZXN0Qm9keS5leGVjdXRpb25JZCkge1xuICAgICAgICByZXR1cm4gcm91dGUuZnVsZmlsbCh7XG4gICAgICAgICAgc3RhdHVzOiAyMDAsXG4gICAgICAgICAgY29udGVudFR5cGU6IFwidGV4dC9ldmVudC1zdHJlYW1cIixcbiAgICAgICAgICBoZWFkZXJzOiB7IFwiQ2FjaGUtQ29udHJvbFwiOiBcIm5vLWNhY2hlXCIgfSxcbiAgICAgICAgICAvLyBEZWxpYmVyYXRlbHkgc3RvcCBhZnRlciB0aGUgZHVyYWJsZSBleGVjdXRpb24gaWRlbnRpdHkuIFRoZVxuICAgICAgICAgIC8vIGpvdXJuZXkgd3JhcHMgdGhpcyByZXNwb25zZSBpbiBhIGJyb3dzZXItbGV2ZWwgc3RyZWFtIGVycm9yLlxuICAgICAgICAgIGJvZHk6IGZpeHR1cmUuc3RyZWFtQm9keSxcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfVxuICAgIGxldCByZXF1ZXN0ZWRNZXNzYWdlOiBzdHJpbmcgfCB1bmRlZmluZWQ7XG4gICAgdHJ5IHtcbiAgICAgIHJlcXVlc3RlZE1lc3NhZ2UgPSAocm91dGUucmVxdWVzdCgpLnBvc3REYXRhSlNPTigpIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+KVxuICAgICAgICAubWVzc2FnZSBhcyBzdHJpbmcgfCB1bmRlZmluZWQ7XG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBUaGUgZGVmYXVsdCBwcm92aWRlci11bmF2YWlsYWJsZSByZXNwb25zZSBoYW5kbGVzIG1hbGZvcm1lZCByZXF1ZXN0cy5cbiAgICB9XG4gICAgY29uc3Qgc3RyZWFtRml4dHVyZSA9XG4gICAgICBkaXNjb25uZWN0QWkgPz9cbiAgICAgIGFpRml4dHVyZXMuZmluZChcbiAgICAgICAgKGZpeHR1cmUpID0+XG4gICAgICAgICAgdHlwZW9mIHJlcXVlc3RlZE1lc3NhZ2UgPT09IFwic3RyaW5nXCIgJiZcbiAgICAgICAgICAocmVxdWVzdGVkTWVzc2FnZSA9PT0gZml4dHVyZS5xdWVzdGlvbiB8fFxuICAgICAgICAgICAgcmVxdWVzdGVkTWVzc2FnZS5pbmNsdWRlcyhmaXh0dXJlLnF1ZXN0aW9uKSksXG4gICAgICApID8/XG4gICAgICBhcmFiaWNBaTtcbiAgICBpZiAoc3RyZWFtRml4dHVyZSAmJiBwYXRoLmVuZHNXaXRoKFwiL2FwaS9haS9jaGF0L3N0cmVhbVwiKSlcbiAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKHtcbiAgICAgICAgc3RhdHVzOiAyMDAsXG4gICAgICAgIGNvbnRlbnRUeXBlOiBcInRleHQvZXZlbnQtc3RyZWFtXCIsXG4gICAgICAgIGhlYWRlcnM6IHsgXCJDYWNoZS1Db250cm9sXCI6IFwibm8tY2FjaGVcIiB9LFxuICAgICAgICBib2R5OiBzdHJlYW1GaXh0dXJlLnN0cmVhbUJvZHksXG4gICAgICB9KTtcbiAgICBjb25zdCBtZXNzYWdlRml4dHVyZSA9IGFpRml4dHVyZXMuZmluZCgoZml4dHVyZSkgPT5cbiAgICAgIHBhdGguZW5kc1dpdGgoYC9hcGkvYWkvY2hhdC8ke2ZpeHR1cmUuc2Vzc2lvbklkfS9tZXNzYWdlc2ApLFxuICAgICk7XG4gICAgaWYgKG1lc3NhZ2VGaXh0dXJlKVxuICAgICAgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoXG4gICAgICAgIGpzb25SZXNwb25zZShbXG4gICAgICAgICAge1xuICAgICAgICAgICAgaWQ6IGAke21lc3NhZ2VGaXh0dXJlLnNlc3Npb25JZH0tdXNlci1tZXNzYWdlYCxcbiAgICAgICAgICAgIHNlc3Npb25JZDogbWVzc2FnZUZpeHR1cmUuc2Vzc2lvbklkLFxuICAgICAgICAgICAgcm9sZTogXCJ1c2VyXCIsXG4gICAgICAgICAgICBjb250ZW50OiBtZXNzYWdlRml4dHVyZS5xdWVzdGlvbixcbiAgICAgICAgICAgIGNyZWF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAxOjAwLjAwMFpcIixcbiAgICAgICAgICB9LFxuICAgICAgICAgIG1lc3NhZ2VGaXh0dXJlLm1lc3NhZ2UsXG4gICAgICAgIF0pLFxuICAgICAgKTtcbiAgICBpZiAoXG4gICAgICBvdmVycmlkZXM/LmF1ZGl0RXhwb3J0ICYmXG4gICAgICBwYXRoLmVuZHNXaXRoKFwiL2FwaS9haS9jaGF0L2UyZS1hdWRpdC1zZXNzaW9uL21lc3NhZ2VzXCIpXG4gICAgKSB7XG4gICAgICByZXR1cm4gcm91dGUuZnVsZmlsbChcbiAgICAgICAganNvblJlc3BvbnNlKFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBpZDogXCJlMmUtYXVkaXQtdXNlci1tZXNzYWdlXCIsXG4gICAgICAgICAgICBzZXNzaW9uSWQ6IFwiZTJlLWF1ZGl0LXNlc3Npb25cIixcbiAgICAgICAgICAgIHJvbGU6IFwidXNlclwiLFxuICAgICAgICAgICAgY29udGVudDogXCJDb21wbGV0ZWQgYXVkaXQgZXhlY3V0aW9uXCIsXG4gICAgICAgICAgICBjcmVhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMTowMC4wMDBaXCIsXG4gICAgICAgICAgfSxcbiAgICAgICAgICB7XG4gICAgICAgICAgICBpZDogXCJlMmUtYXVkaXQtYXNzaXN0YW50LW1lc3NhZ2VcIixcbiAgICAgICAgICAgIHNlc3Npb25JZDogXCJlMmUtYXVkaXQtc2Vzc2lvblwiLFxuICAgICAgICAgICAgcm9sZTogXCJhc3Npc3RhbnRcIixcbiAgICAgICAgICAgIGNvbnRlbnQ6IFwiQ29tcGxldGVkIGF1ZGl0IGV4ZWN1dGlvblwiLFxuICAgICAgICAgICAgZXhlY3V0aW9uSWQ6IEVYRUNVVElPTl9JRCxcbiAgICAgICAgICAgIG91dGNvbWU6IG92ZXJyaWRlcy5hdWRpdEV4cG9ydC5tZXNzYWdlT3V0Y29tZSA/PyBcIlNVQ0NFRURFRFwiLFxuICAgICAgICAgICAgY3JlYXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDI6MDAuMDAwWlwiLFxuICAgICAgICAgIH0sXG4gICAgICAgIF0pLFxuICAgICAgKTtcbiAgICB9XG5cbiAgICBpZiAocGF0aCA9PT0gXCIvYXBpL2Rhc2hib2FyZFwiKVxuICAgICAgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoanNvblJlc3BvbnNlKGRhc2hib2FyZEZpeHR1cmUpKTtcbiAgICBpZiAob3ZlcnJpZGVzPy50YXNrQWN0aW9ucykge1xuICAgICAgY29uc3QgdmVyaWZpY2F0aW9uTWF0Y2ggPSBwYXRoLm1hdGNoKFxuICAgICAgICAvXlxcL2FwaVxcL3Rhc2tzXFwvKFteL10rKVxcL3ZlcmlmaWNhdGlvbiQvLFxuICAgICAgKTtcbiAgICAgIGlmICh2ZXJpZmljYXRpb25NYXRjaCAmJiByb3V0ZS5yZXF1ZXN0KCkubWV0aG9kKCkgPT09IFwiUE9TVFwiKSB7XG4gICAgICAgIGNvbnN0IFssIHRhc2tJZF0gPSB2ZXJpZmljYXRpb25NYXRjaDtcbiAgICAgICAgY29uc3QgdGFzayA9IG92ZXJyaWRlcy50YXNrQWN0aW9ucy50YXNrcy5maW5kKFxuICAgICAgICAgIChjYW5kaWRhdGUpID0+IGNhbmRpZGF0ZS5pZCA9PT0gdGFza0lkLFxuICAgICAgICApO1xuICAgICAgICBpZiAoIXRhc2spIHtcbiAgICAgICAgICByZXR1cm4gcm91dGUuZnVsZmlsbChqc29uUmVzcG9uc2UoeyBlcnJvcjogXCJUYXNrIG5vdCBmb3VuZFwiIH0sIDQwNCkpO1xuICAgICAgICB9XG5cbiAgICAgICAgbGV0IGJvZHk6IFJlY29yZDxzdHJpbmcsIHVua25vd24+ID0ge307XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgYm9keSA9IHJvdXRlLnJlcXVlc3QoKS5wb3N0RGF0YUpTT04oKSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgICAgICAgfSBjYXRjaCB7XG4gICAgICAgICAgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoXG4gICAgICAgICAgICBqc29uUmVzcG9uc2UoeyBlcnJvcjogXCJJbnZhbGlkIHZlcmlmaWNhdGlvbiByZXF1ZXN0XCIgfSwgNDAwKSxcbiAgICAgICAgICApO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IHBsYW4gPSB0YXNrLnJlbWVkaWF0aW9uUGxhbiBhc1xuICAgICAgICAgIHwge1xuICAgICAgICAgICAgICB2ZXJpZmljYXRpb25DaGVja3M/OiBBcnJheTxSZWNvcmQ8c3RyaW5nLCB1bmtub3duPj47XG4gICAgICAgICAgICAgIHZlcmlmaWNhdGlvblN0ZXBzPzogc3RyaW5nW107XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfCB1bmRlZmluZWQ7XG4gICAgICAgIGNvbnN0IGNoZWNrcyA9XG4gICAgICAgICAgcGxhbj8udmVyaWZpY2F0aW9uQ2hlY2tzID8/XG4gICAgICAgICAgKHBsYW4/LnZlcmlmaWNhdGlvblN0ZXBzID8/IFtdKS5tYXAoKGd1aWRhbmNlLCBpbmRleCkgPT4gKHtcbiAgICAgICAgICAgIGlkOiBgcnVsZS12ZXJpZmljYXRpb24tJHtpbmRleCArIDF9YCxcbiAgICAgICAgICAgIGtpbmQ6IFwib3BlcmF0b3JfYXR0ZXN0YXRpb25cIixcbiAgICAgICAgICAgIGd1aWRhbmNlLFxuICAgICAgICAgIH0pKTtcbiAgICAgICAgY29uc3QgY2hlY2sgPSBjaGVja3MuZmluZCgoY2FuZGlkYXRlKSA9PiBjYW5kaWRhdGUuaWQgPT09IGJvZHkuY2hlY2tJZCk7XG4gICAgICAgIGlmICghY2hlY2spIHtcbiAgICAgICAgICByZXR1cm4gcm91dGUuZnVsZmlsbChcbiAgICAgICAgICAgIGpzb25SZXNwb25zZShcbiAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgIGVycm9yOiBcInZlcmlmaWNhdGlvbl9jaGVja19ub3RfZm91bmRcIixcbiAgICAgICAgICAgICAgICByZWFzb246XG4gICAgICAgICAgICAgICAgICBcIlRoZSBzdWJtaXR0ZWQgY2hlY2sgaXMgbm90IHBhcnQgb2YgdGhpcyB0YXNrJ3Mgc2VydmVyLW93bmVkIHZlcmlmaWNhdGlvbiBwbGFuLlwiLFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICA0MDAsXG4gICAgICAgICAgICApLFxuICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgcGFzc2VkID0gYm9keS5wYXNzZWQgPT09IHRydWU7XG4gICAgICAgIGNvbnN0IGV2aWRlbmNlID1cbiAgICAgICAgICB0eXBlb2YgYm9keS5ldmlkZW5jZSA9PT0gXCJzdHJpbmdcIiA/IGJvZHkuZXZpZGVuY2UudHJpbSgpIDogXCJcIjtcbiAgICAgICAgaWYgKHBhc3NlZCAmJiAhZXZpZGVuY2UpIHtcbiAgICAgICAgICByZXR1cm4gcm91dGUuZnVsZmlsbChcbiAgICAgICAgICAgIGpzb25SZXNwb25zZShcbiAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgIGVycm9yOiBcInZlcmlmaWNhdGlvbl9ldmlkZW5jZV9yZXF1aXJlZFwiLFxuICAgICAgICAgICAgICAgIHJlYXNvbjpcbiAgICAgICAgICAgICAgICAgIFwiQSBwYXNzZWQgdmVyaWZpY2F0aW9uIGNoZWNrIG11c3QgaW5jbHVkZSBleHBsaWNpdCBvcGVyYXRvciBldmlkZW5jZS5cIixcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgNDAwLFxuICAgICAgICAgICAgKSxcbiAgICAgICAgICApO1xuICAgICAgICB9XG5cbiAgICAgICAgb3ZlcnJpZGVzLnRhc2tBY3Rpb25zLnZlcmlmaWNhdGlvblJlcXVlc3RzPy5wdXNoKHtcbiAgICAgICAgICB0YXNrSWQsXG4gICAgICAgICAgY2hlY2tJZDogYm9keS5jaGVja0lkLFxuICAgICAgICAgIHBhc3NlZCxcbiAgICAgICAgICAuLi4oZXZpZGVuY2UgPyB7IGV2aWRlbmNlIH0gOiB7fSksXG4gICAgICAgIH0pO1xuXG4gICAgICAgIGNvbnN0IHByaW9yUmVzdWx0ID0gKHRhc2sudmVyaWZpY2F0aW9uUmVzdWx0ID8/IHt9KSBhcyB7XG4gICAgICAgICAgc3RlcHM/OiBBcnJheTxSZWNvcmQ8c3RyaW5nLCB1bmtub3duPj47XG4gICAgICAgICAgaGlzdG9yeT86IEFycmF5PFJlY29yZDxzdHJpbmcsIHVua25vd24+PjtcbiAgICAgICAgfTtcbiAgICAgICAgY29uc3QgcHJpb3JTdGVwcyA9IHByaW9yUmVzdWx0LnN0ZXBzID8/IFtdO1xuICAgICAgICBjb25zdCBzdGVwcyA9IGNoZWNrcy5tYXAoKGNhbmRpZGF0ZSkgPT4ge1xuICAgICAgICAgIGNvbnN0IHByaW9yID0gcHJpb3JTdGVwcy5maW5kKChzdGVwKSA9PiBzdGVwLmlkID09PSBjYW5kaWRhdGUuaWQpO1xuICAgICAgICAgIGlmIChjYW5kaWRhdGUuaWQgIT09IGJvZHkuY2hlY2tJZCkge1xuICAgICAgICAgICAgcmV0dXJuIChcbiAgICAgICAgICAgICAgcHJpb3IgPz8ge1xuICAgICAgICAgICAgICAgIGlkOiBjYW5kaWRhdGUuaWQsXG4gICAgICAgICAgICAgICAgbmFtZTogYFJ1bGUgdmVyaWZpY2F0aW9uICR7U3RyaW5nKGNhbmRpZGF0ZS5pZCkucmVwbGFjZShcbiAgICAgICAgICAgICAgICAgIFwicnVsZS12ZXJpZmljYXRpb24tXCIsXG4gICAgICAgICAgICAgICAgICBcIiNcIixcbiAgICAgICAgICAgICAgICApfWAsXG4gICAgICAgICAgICAgICAga2luZDogY2FuZGlkYXRlLmtpbmQgPz8gXCJvcGVyYXRvcl9hdHRlc3RhdGlvblwiLFxuICAgICAgICAgICAgICAgIGd1aWRhbmNlOiBjYW5kaWRhdGUuZ3VpZGFuY2UsXG4gICAgICAgICAgICAgICAgcGFzc2VkOiBmYWxzZSxcbiAgICAgICAgICAgICAgICBvdXRwdXQ6IFwiTm90IHJlY29yZGVkIOKAlCBvcGVyYXRvciBldmlkZW5jZSBpcyByZXF1aXJlZFwiLFxuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICApO1xuICAgICAgICAgIH1cbiAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgaWQ6IGNhbmRpZGF0ZS5pZCxcbiAgICAgICAgICAgIG5hbWU6IGBSdWxlIHZlcmlmaWNhdGlvbiAke1N0cmluZyhjYW5kaWRhdGUuaWQpLnJlcGxhY2UoXG4gICAgICAgICAgICAgIFwicnVsZS12ZXJpZmljYXRpb24tXCIsXG4gICAgICAgICAgICAgIFwiI1wiLFxuICAgICAgICAgICAgKX1gLFxuICAgICAgICAgICAga2luZDogY2FuZGlkYXRlLmtpbmQgPz8gXCJvcGVyYXRvcl9hdHRlc3RhdGlvblwiLFxuICAgICAgICAgICAgZ3VpZGFuY2U6IGNhbmRpZGF0ZS5ndWlkYW5jZSxcbiAgICAgICAgICAgIHBhc3NlZCxcbiAgICAgICAgICAgIC4uLihldmlkZW5jZSA/IHsgZXZpZGVuY2UgfSA6IHt9KSxcbiAgICAgICAgICAgIG91dHB1dDogcGFzc2VkXG4gICAgICAgICAgICAgID8gXCJPcGVyYXRvciBldmlkZW5jZSByZWNvcmRlZFwiXG4gICAgICAgICAgICAgIDogXCJPcGVyYXRvciByZXBvcnRlZCB0aGF0IHRoZSBjaGVjayBmYWlsZWRcIixcbiAgICAgICAgICB9O1xuICAgICAgICB9KTtcbiAgICAgICAgY29uc3QgY29tcGxldGVkID0gc3RlcHMuZXZlcnkoXG4gICAgICAgICAgKHN0ZXApID0+IHN0ZXAucGFzc2VkID09PSB0cnVlICYmIEJvb2xlYW4oU3RyaW5nKHN0ZXAuZXZpZGVuY2UgPz8gXCJcIikudHJpbSgpKSxcbiAgICAgICAgKTtcbiAgICAgICAgdGFzay5zdGF0dXMgPSBjb21wbGV0ZWQgPyBcImNvbXBsZXRlZFwiIDogXCJ2ZXJpZnlpbmdcIjtcbiAgICAgICAgdGFzay52ZXJpZmljYXRpb25SZXN1bHQgPSB7XG4gICAgICAgICAgcGFzc2VkOiBjb21wbGV0ZWQsXG4gICAgICAgICAgZGVjaXNpb246IGNvbXBsZXRlZCA/IFwidmVyaWZpZWRcIiA6IFwiaW5jb21wbGV0ZVwiLFxuICAgICAgICAgIHN0ZXBzLFxuICAgICAgICAgIGhpc3Rvcnk6IFtcbiAgICAgICAgICAgIC4uLihwcmlvclJlc3VsdC5oaXN0b3J5ID8/IFtdKSxcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgaWQ6IGB2ZXJpZmljYXRpb24taGlzdG9yeS0ke1N0cmluZyhcbiAgICAgICAgICAgICAgICAocHJpb3JSZXN1bHQuaGlzdG9yeSA/PyBbXSkubGVuZ3RoICsgMSxcbiAgICAgICAgICAgICAgKX1gLFxuICAgICAgICAgICAgICBjaGVja0lkOiBjaGVjay5pZCxcbiAgICAgICAgICAgICAgbmFtZTogYFJ1bGUgdmVyaWZpY2F0aW9uICR7U3RyaW5nKGNoZWNrLmlkKS5yZXBsYWNlKFxuICAgICAgICAgICAgICAgIFwicnVsZS12ZXJpZmljYXRpb24tXCIsXG4gICAgICAgICAgICAgICAgXCIjXCIsXG4gICAgICAgICAgICAgICl9YCxcbiAgICAgICAgICAgICAga2luZDogY2hlY2sua2luZCA/PyBcIm9wZXJhdG9yX2F0dGVzdGF0aW9uXCIsXG4gICAgICAgICAgICAgIGd1aWRhbmNlOiBjaGVjay5ndWlkYW5jZSxcbiAgICAgICAgICAgICAgcGFzc2VkLFxuICAgICAgICAgICAgICAuLi4oZXZpZGVuY2UgPyB7IGV2aWRlbmNlIH0gOiB7fSksXG4gICAgICAgICAgICAgIGFjdG9yOiBcImUyZS1vcGVyYXRvclwiLFxuICAgICAgICAgICAgICByZWNvcmRlZEF0OiBgMjAyNi0wMS0wMVQwMDowJHtcbiAgICAgICAgICAgICAgICAocHJpb3JSZXN1bHQuaGlzdG9yeSA/PyBbXSkubGVuZ3RoICsgMlxuICAgICAgICAgICAgICB9OjAwLjAwMFpgLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICBdLFxuICAgICAgICB9O1xuICAgICAgICBpZiAodGFzay5yZW1lZGlhdGlvblBsYW4gJiYgY29tcGxldGVkKSB7XG4gICAgICAgICAgdGFzay5yZW1lZGlhdGlvblBsYW4gPSB7XG4gICAgICAgICAgICAuLi4odGFzay5yZW1lZGlhdGlvblBsYW4gYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4pLFxuICAgICAgICAgICAgc3RhdHVzOiBcInZlcmlmaWVkXCIsXG4gICAgICAgICAgfTtcbiAgICAgICAgfVxuICAgICAgICB0YXNrLnVwZGF0ZWRBdCA9IFwiMjAyNi0wMS0wMVQwMDowNDowMC4wMDBaXCI7XG4gICAgICAgIGlmIChjb21wbGV0ZWQpIHRhc2suY29tcGxldGVkQXQgPSB0YXNrLnVwZGF0ZWRBdDtcbiAgICAgICAgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoanNvblJlc3BvbnNlKHRhc2spKTtcbiAgICAgIH1cblxuICAgICAgY29uc3QgYWN0aW9uTWF0Y2ggPSBwYXRoLm1hdGNoKC9eXFwvYXBpXFwvdGFza3NcXC8oW14vXSspXFwvKGV4ZWN1dGV8cmV0cnkpJC8pO1xuICAgICAgaWYgKGFjdGlvbk1hdGNoICYmIHJvdXRlLnJlcXVlc3QoKS5tZXRob2QoKSA9PT0gXCJQT1NUXCIpIHtcbiAgICAgICAgY29uc3QgWywgdGFza0lkLCBhY3Rpb25dID0gYWN0aW9uTWF0Y2g7XG4gICAgICAgIGNvbnN0IHRhc2sgPSBvdmVycmlkZXMudGFza0FjdGlvbnMudGFza3MuZmluZChcbiAgICAgICAgICAoY2FuZGlkYXRlKSA9PiBjYW5kaWRhdGUuaWQgPT09IHRhc2tJZCxcbiAgICAgICAgKTtcbiAgICAgICAgaWYgKCF0YXNrKSB7XG4gICAgICAgICAgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoanNvblJlc3BvbnNlKHsgZXJyb3I6IFwiVGFzayBub3QgZm91bmRcIiB9LCA0MDQpKTtcbiAgICAgICAgfVxuXG4gICAgICAgIG92ZXJyaWRlcy50YXNrQWN0aW9ucy5yZXF1ZXN0cy5wdXNoKGAke2FjdGlvbn06JHt0YXNrSWR9YCk7XG4gICAgICAgIGlmIChhY3Rpb24gPT09IFwiZXhlY3V0ZVwiKSB7XG4gICAgICAgICAgdGFzay5zdGF0dXMgPSBcInJ1bm5pbmdcIjtcbiAgICAgICAgICB0YXNrLnVwZGF0ZWRBdCA9IFwiMjAyNi0wMS0wMVQwMDowMjowMC4wMDBaXCI7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGFzay5zdGF0dXMgPSBcInF1ZXVlZFwiO1xuICAgICAgICAgIHRhc2sucmV0cnlDb3VudCA9IE51bWJlcih0YXNrLnJldHJ5Q291bnQgPz8gMCkgKyAxO1xuICAgICAgICAgIHRhc2sudXBkYXRlZEF0ID0gXCIyMDI2LTAxLTAxVDAwOjAyOjAwLjAwMFpcIjtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gcm91dGUuZnVsZmlsbChqc29uUmVzcG9uc2UodGFzaywgMjAyKSk7XG4gICAgICB9XG4gICAgfVxuICAgIGlmIChwYXRoID09PSBcIi9hcGkvdGFza3NcIikge1xuICAgICAgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoXG4gICAgICAgIGpzb25SZXNwb25zZShcbiAgICAgICAgICBvdmVycmlkZXM/LnRhc2tBY3Rpb25zPy50YXNrcyA/P1xuICAgICAgICAgICAgb3ZlcnJpZGVzPy5yZWNvdmVyeVRhc2tzID8/XG4gICAgICAgICAgICAob3ZlcnJpZGVzPy5saXZlVGFza1xuICAgICAgICAgICAgICA/IFtcbiAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgaWQ6IG92ZXJyaWRlcy5saXZlVGFzay5pZCxcbiAgICAgICAgICAgICAgICAgICAgcHJvamVjdElkOiBvdmVycmlkZXMubGl2ZVRhc2sucHJvamVjdElkLFxuICAgICAgICAgICAgICAgICAgICB0aXRsZTogb3ZlcnJpZGVzLmxpdmVUYXNrLnRpdGxlLFxuICAgICAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogXCJBIHRhc2sgdXNlZCB0byB2ZXJpZnkgbGl2ZSBkYXNoYm9hcmQgdXBkYXRlcy5cIixcbiAgICAgICAgICAgICAgICAgICAgc3RhdHVzOiBcInJ1bm5pbmdcIixcbiAgICAgICAgICAgICAgICAgICAgcHJpb3JpdHk6IFwicDFcIixcbiAgICAgICAgICAgICAgICAgICAgcmVsYXRlZEZpbGVzOiBbXSxcbiAgICAgICAgICAgICAgICAgICAgcmV0cnlDb3VudDogMCxcbiAgICAgICAgICAgICAgICAgICAgbWF4UmV0cmllczogMixcbiAgICAgICAgICAgICAgICAgICAgY3JlYXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDA6MDAuMDAwWlwiLFxuICAgICAgICAgICAgICAgICAgICB1cGRhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMDowMS4wMDBaXCIsXG4gICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIF1cbiAgICAgICAgICAgICAgOiBbXSksXG4gICAgICAgICksXG4gICAgICApO1xuICAgIH1cbiAgICBpZiAocGF0aCA9PT0gXCIvYXBpL3dvcmtmbG93c1wiKSB7XG4gICAgICByZXR1cm4gcm91dGUuZnVsZmlsbChcbiAgICAgICAganNvblJlc3BvbnNlKG92ZXJyaWRlcz8ucmVjb3ZlcnlXb3JrZmxvd3MgPz8gW10pLFxuICAgICAgKTtcbiAgICB9XG4gICAgY29uc3Qgd29ya2Zsb3dFeGVjdXRpb25zTWF0Y2ggPSBwYXRoLm1hdGNoKFxuICAgICAgL15cXC9hcGlcXC93b3JrZmxvd3NcXC8oW14vXSspXFwvZXhlY3V0aW9ucyQvLFxuICAgICk7XG4gICAgaWYgKHdvcmtmbG93RXhlY3V0aW9uc01hdGNoKSB7XG4gICAgICByZXR1cm4gcm91dGUuZnVsZmlsbChcbiAgICAgICAganNvblJlc3BvbnNlKFxuICAgICAgICAgIG92ZXJyaWRlcz8ucmVjb3ZlcnlXb3JrZmxvd0V4ZWN1dGlvbnM/Llt3b3JrZmxvd0V4ZWN1dGlvbnNNYXRjaFsxXV0gPz9cbiAgICAgICAgICAgIFtdLFxuICAgICAgICApLFxuICAgICAgKTtcbiAgICB9XG4gICAgaWYgKFxuICAgICAgb3ZlcnJpZGVzPy5hdWRpdEV4cG9ydCAmJlxuICAgICAgcGF0aCA9PT0gYC9hcGkvYWkvZXhlY3V0aW9ucy8ke0VYRUNVVElPTl9JRH0vYXVkaXQtZXhwb3J0YFxuICAgICkge1xuICAgICAgb3ZlcnJpZGVzLmF1ZGl0RXhwb3J0LnJlcXVlc3RzLnB1c2gocm91dGUucmVxdWVzdCgpLnVybCgpKTtcbiAgICAgIGlmIChcbiAgICAgICAgb3ZlcnJpZGVzLmF1ZGl0RXhwb3J0LmZhaWxGaXJzdFByZXZpZXcgJiZcbiAgICAgICAgb3ZlcnJpZGVzLmF1ZGl0RXhwb3J0LnJlcXVlc3RzLmxlbmd0aCA9PT0gMVxuICAgICAgKSB7XG4gICAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKFxuICAgICAgICAgIGpzb25SZXNwb25zZShcbiAgICAgICAgICAgIHsgZXJyb3I6IFwiVGVtcG9yYXJ5IHByZXZpZXcgbmV0d29yayBmYWlsdXJlLlwiIH0sXG4gICAgICAgICAgICA1MDMsXG4gICAgICAgICAgKSxcbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKFxuICAgICAgICBqc29uUmVzcG9uc2Uob3ZlcnJpZGVzLmF1ZGl0RXhwb3J0LmJvZHksIDIwMCwge1xuICAgICAgICAgIFwiQ29udGVudC1EaXNwb3NpdGlvblwiOiBgYXR0YWNobWVudDsgZmlsZW5hbWU9XCIke292ZXJyaWRlcy5hdWRpdEV4cG9ydC5maWxlbmFtZX1cImAsXG4gICAgICAgIH0pLFxuICAgICAgKTtcbiAgICB9XG4gICAgaWYgKG92ZXJyaWRlcz8uYXJjaGl2ZVVwbG9hZCAmJiBwYXRoID09PSBcIi9hcGkvdXBsb2FkL2FyY2hpdmVcIikge1xuICAgICAgY29uc3QgY29udGVudFR5cGUgPSByb3V0ZS5yZXF1ZXN0KCkuaGVhZGVycygpW1wiY29udGVudC10eXBlXCJdID8/IFwiXCI7XG4gICAgICBpZiAoIWNvbnRlbnRUeXBlLnN0YXJ0c1dpdGgoXCJtdWx0aXBhcnQvZm9ybS1kYXRhO1wiKSkge1xuICAgICAgICByZXR1cm4gcm91dGUuZnVsZmlsbChcbiAgICAgICAgICBqc29uUmVzcG9uc2UoeyBlcnJvcjogXCJFeHBlY3RlZCBtdWx0aXBhcnQgYXJjaGl2ZSB1cGxvYWQuXCIgfSwgNDAwKSxcbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IGJvZHkgPSByb3V0ZS5yZXF1ZXN0KCkucG9zdERhdGFCdWZmZXIoKTtcbiAgICAgIGlmICghYm9keT8uaW5jbHVkZXMoQnVmZmVyLmZyb20oXCJkYXNoYm9hcmQtam91cm5leS56aXBcIikpKSB7XG4gICAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKFxuICAgICAgICAgIGpzb25SZXNwb25zZSh7IGVycm9yOiBcIkV4cGVjdGVkIHRoZSBqb3VybmV5IGFyY2hpdmUgcGF5bG9hZC5cIiB9LCA0MDApLFxuICAgICAgICApO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoXG4gICAgICAgIGpzb25SZXNwb25zZShcbiAgICAgICAgICB7XG4gICAgICAgICAgICB1cGxvYWRJZDogb3ZlcnJpZGVzLmFyY2hpdmVVcGxvYWQudXBsb2FkSWQsXG4gICAgICAgICAgICBvcmlnaW5hbE5hbWU6IG92ZXJyaWRlcy5hcmNoaXZlVXBsb2FkLm9yaWdpbmFsTmFtZSxcbiAgICAgICAgICB9LFxuICAgICAgICAgIDIwMSxcbiAgICAgICAgICB7XG4gICAgICAgICAgICBcImFjY2Vzcy1jb250cm9sLWFsbG93LW9yaWdpblwiOiBuZXcgVVJMKHBhZ2UudXJsKCkpLm9yaWdpbixcbiAgICAgICAgICAgIFwiYWNjZXNzLWNvbnRyb2wtYWxsb3ctY3JlZGVudGlhbHNcIjogXCJ0cnVlXCIsXG4gICAgICAgICAgfSxcbiAgICAgICAgKSxcbiAgICAgICk7XG4gICAgfVxuICAgIGlmIChvdmVycmlkZXM/LmxpdmVUYXNrICYmIHBhdGggPT09IFwiL2FwaS90YXNrc1wiKSB7XG4gICAgICByZXR1cm4gcm91dGUuZnVsZmlsbChcbiAgICAgICAganNvblJlc3BvbnNlKFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBpZDogb3ZlcnJpZGVzLmxpdmVUYXNrLmlkLFxuICAgICAgICAgICAgcHJvamVjdElkOiBvdmVycmlkZXMubGl2ZVRhc2sucHJvamVjdElkLFxuICAgICAgICAgICAgdGl0bGU6IG92ZXJyaWRlcy5saXZlVGFzay50aXRsZSxcbiAgICAgICAgICAgIGRlc2NyaXB0aW9uOiBcIkEgdGFzayB1c2VkIHRvIHZlcmlmeSBsaXZlIGRhc2hib2FyZCB1cGRhdGVzLlwiLFxuICAgICAgICAgICAgc3RhdHVzOiBcInJ1bm5pbmdcIixcbiAgICAgICAgICAgIHBoYXNlOiBcIkV4ZWN1dGlvblwiLFxuICAgICAgICAgICAgcmVsYXRlZEZpbGVzOiBbXSxcbiAgICAgICAgICAgIHJldHJ5Q291bnQ6IDAsXG4gICAgICAgICAgICBtYXhSZXRyaWVzOiAyLFxuICAgICAgICAgICAgY3JlYXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDA6MDAuMDAwWlwiLFxuICAgICAgICAgICAgdXBkYXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDA6MDEuMDAwWlwiLFxuICAgICAgICAgIH0sXG4gICAgICAgIF0pLFxuICAgICAgKTtcbiAgICB9XG4gICAgaWYgKFxuICAgICAgb3ZlcnJpZGVzPy5saXZlVGFzayAmJlxuICAgICAgcGF0aCA9PT0gYC9hcGkvdGFza3MvJHtvdmVycmlkZXMubGl2ZVRhc2suaWR9L2xvZ3NgXG4gICAgKSB7XG4gICAgICByZXR1cm4gcm91dGUuZnVsZmlsbChqc29uUmVzcG9uc2Uob3ZlcnJpZGVzLmxpdmVUYXNrLmluaXRpYWxMb2dzID8/IFtdKSk7XG4gICAgfVxuICAgIGlmIChcbiAgICAgIG92ZXJyaWRlcz8ubGl2ZVRhc2sgJiZcbiAgICAgIHBhdGggPT09IGAvYXBpL3Rhc2tzLyR7b3ZlcnJpZGVzLmxpdmVUYXNrLmlkfS9sb2dzL3N0cmVhbWBcbiAgICApIHtcbiAgICAgIGNvbnN0IHN0cmVhbVJlcXVlc3RzID0gb3ZlcnJpZGVzLmxpdmVUYXNrLnN0cmVhbVJlcXVlc3RzO1xuICAgICAgc3RyZWFtUmVxdWVzdHM/LnB1c2gocm91dGUucmVxdWVzdCgpLnVybCgpKTtcbiAgICAgIGlmIChcbiAgICAgICAgKG92ZXJyaWRlcy5saXZlVGFzay5mYWlsRmlyc3RTdHJlYW0gJiYgc3RyZWFtUmVxdWVzdHM/Lmxlbmd0aCA9PT0gMSkgfHxcbiAgICAgICAgKG92ZXJyaWRlcy5saXZlVGFzay5mYWlsU3RyZWFtQXR0ZW1wdHMgJiZcbiAgICAgICAgICBzdHJlYW1SZXF1ZXN0cyAmJlxuICAgICAgICAgIHN0cmVhbVJlcXVlc3RzLmxlbmd0aCA8PSBvdmVycmlkZXMubGl2ZVRhc2suZmFpbFN0cmVhbUF0dGVtcHRzKVxuICAgICAgKSB7XG4gICAgICAgIC8vIEV4ZXJjaXNlIHRoZSBicm93c2VyJ3MgcmVjb25uZWN0IHBhdGggd2l0aG91dCBjaGFuZ2luZyB0aGUgdGFza1xuICAgICAgICAvLyBsaWZlY3ljbGUgb3Igc3ludGhlc2l6aW5nIGEgc3VjY2Vzc2Z1bCByZXNwb25zZSBmb3IgdGhlIGZpcnN0IHRyeS5cbiAgICAgICAgcmV0dXJuIHJvdXRlLmFib3J0KFwiY29ubmVjdGlvbnJlc2V0XCIpO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoe1xuICAgICAgICBzdGF0dXM6IDIwMCxcbiAgICAgICAgY29udGVudFR5cGU6IFwidGV4dC9ldmVudC1zdHJlYW1cIixcbiAgICAgICAgaGVhZGVyczoge1xuICAgICAgICAgIFwiQ2FjaGUtQ29udHJvbFwiOiBcIm5vLWNhY2hlXCIsXG4gICAgICAgICAgXCJhY2Nlc3MtY29udHJvbC1hbGxvdy1vcmlnaW5cIjogbmV3IFVSTChwYWdlLnVybCgpKS5vcmlnaW4sXG4gICAgICAgICAgXCJhY2Nlc3MtY29udHJvbC1hbGxvdy1jcmVkZW50aWFsc1wiOiBcInRydWVcIixcbiAgICAgICAgfSxcbiAgICAgICAgYm9keTogYGV2ZW50OiBsb2dcXG5kYXRhOiAke0pTT04uc3RyaW5naWZ5KG92ZXJyaWRlcy5saXZlVGFzay5sb2cpfVxcblxcbmAsXG4gICAgICB9KTtcbiAgICB9XG4gICAgaWYgKHBhdGggPT09IFwiL2FwaS9wcm9qZWN0c1wiKSB7XG4gICAgICByZXR1cm4gcm91dGUuZnVsZmlsbChcbiAgICAgICAganNvblJlc3BvbnNlKFxuICAgICAgICAgIG92ZXJyaWRlcz8ucHJvamVjdHMgPz8gW1xuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBpZDogXCJlMmUtcHJvamVjdFwiLFxuICAgICAgICAgICAgICBuYW1lOiBcIlNtb2tlIFByb2plY3RcIixcbiAgICAgICAgICAgICAgbGFuZ3VhZ2U6IFwiVHlwZVNjcmlwdFwiLFxuICAgICAgICAgICAgICBmcmFtZXdvcms6IFwiUmVhY3RcIixcbiAgICAgICAgICAgICAgc3RhdHVzOiBcImFjdGl2ZVwiLFxuICAgICAgICAgICAgICByb290UGF0aDogXCIvY29udHJvbGxlZC9zbW9rZVwiLFxuICAgICAgICAgICAgICBxdWFsaXR5U2NvcmU6IDkyLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICBdLFxuICAgICAgICApLFxuICAgICAgKTtcbiAgICB9XG4gICAgaWYgKHBhdGggPT09IFwiL2FwaS9yZWFkaW5lc3NcIikge1xuICAgICAgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoXG4gICAgICAgIGpzb25SZXNwb25zZSh7XG4gICAgICAgICAgc3RhdHVzOiBcInJlYWR5XCIsXG4gICAgICAgICAgY2hlY2tzOiB7XG4gICAgICAgICAgICBhcGk6IHsgc3RhdHVzOiBcInJlYWR5XCIgfSxcbiAgICAgICAgICAgIGRhdGFiYXNlOiB7IHN0YXR1czogXCJyZWFkeVwiIH0sXG4gICAgICAgICAgICBzY2hlbWE6IHsgc3RhdHVzOiBcInJlYWR5XCIgfSxcbiAgICAgICAgICB9LFxuICAgICAgICB9KSxcbiAgICAgICk7XG4gICAgfVxuICAgIGlmIChoYXNDb25maWd1cmVkQWlGaXh0dXJlICYmIHBhdGggPT09IFwiL2FwaS9haS9hY3RpdmUtcHJvdmlkZXJcIikge1xuICAgICAgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoXG4gICAgICAgIGpzb25SZXNwb25zZSh7IHByb3ZpZGVyOiBcIm9wZW5yb3V0ZXJcIiwgY29uZmlndXJlZDogdHJ1ZSB9KSxcbiAgICAgICk7XG4gICAgfVxuICAgIGlmIChcbiAgICAgIG92ZXJyaWRlcz8uZGVsaXZlcnlSZWNvdmVyeSAmJlxuICAgICAgcGF0aCA9PT0gXCIvYXBpL2FpL2RlbGl2ZXJ5L3JlY292ZXJhYmxlXCJcbiAgICApIHtcbiAgICAgIG92ZXJyaWRlcy5kZWxpdmVyeVJlY292ZXJ5LnJlcXVlc3RzLnB1c2gocm91dGUucmVxdWVzdCgpLnVybCgpKTtcbiAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKFxuICAgICAgICBqc29uUmVzcG9uc2UoeyBvcGVyYXRpb25zOiBvdmVycmlkZXMuZGVsaXZlcnlSZWNvdmVyeS5vcGVyYXRpb25zIH0pLFxuICAgICAgKTtcbiAgICB9XG4gICAgaWYgKFxuICAgICAgb3ZlcnJpZGVzPy5kZWxpdmVyeVJlY292ZXJ5Py5yZWNvdmVyeUFjdGlvbiAmJlxuICAgICAgcGF0aCA9PT1cbiAgICAgICAgYC9hcGkvYWkvZGVsaXZlcnkvJHtvdmVycmlkZXMuZGVsaXZlcnlSZWNvdmVyeS5yZWNvdmVyeUFjdGlvbi5wcm9wb3NhbElkfS8ke292ZXJyaWRlcy5kZWxpdmVyeVJlY292ZXJ5LnJlY292ZXJ5QWN0aW9uLmFjdGlvbn1gXG4gICAgKSB7XG4gICAgICBvdmVycmlkZXMuZGVsaXZlcnlSZWNvdmVyeS5hY3Rpb25SZXF1ZXN0cz8ucHVzaChyb3V0ZS5yZXF1ZXN0KCkudXJsKCkpO1xuICAgICAgaWYgKG92ZXJyaWRlcy5kZWxpdmVyeVJlY292ZXJ5LnJlY292ZXJ5QWN0aW9uLm5leHRPcGVyYXRpb25zKSB7XG4gICAgICAgIG92ZXJyaWRlcy5kZWxpdmVyeVJlY292ZXJ5Lm9wZXJhdGlvbnMgPVxuICAgICAgICAgIG92ZXJyaWRlcy5kZWxpdmVyeVJlY292ZXJ5LnJlY292ZXJ5QWN0aW9uLm5leHRPcGVyYXRpb25zO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoXG4gICAgICAgIGpzb25SZXNwb25zZShcbiAgICAgICAgICBvdmVycmlkZXMuZGVsaXZlcnlSZWNvdmVyeS5yZWNvdmVyeUFjdGlvbi5yZXNwb25zZSxcbiAgICAgICAgICBvdmVycmlkZXMuZGVsaXZlcnlSZWNvdmVyeS5yZWNvdmVyeUFjdGlvbi5zdGF0dXMgPz8gNDA5LFxuICAgICAgICApLFxuICAgICAgKTtcbiAgICB9XG4gICAgaWYgKHBhdGggPT09IFwiL2FwaS9ldmVudHNcIikge1xuICAgICAgY29uc3QgZXZlbnRzID0gb3ZlcnJpZGVzPy5ldmVudHMgPz8gZGFzaGJvYXJkRml4dHVyZS5yZWNlbnRFdmVudHM7XG4gICAgICBjb25zdCBzZWFyY2ggPSB1cmwuc2VhcmNoUGFyYW1zLmdldChcInNlYXJjaFwiKT8udG9Mb3dlckNhc2UoKTtcbiAgICAgIGNvbnN0IGZpbHRlcmVkRXZlbnRzID0gZXZlbnRzLmZpbHRlcigoZXZlbnQpID0+IHtcbiAgICAgICAgY29uc3QgcHJvamVjdElkID0gdXJsLnNlYXJjaFBhcmFtcy5nZXQoXCJwcm9qZWN0SWRcIik7XG4gICAgICAgIGNvbnN0IHNldmVyaXR5ID0gdXJsLnNlYXJjaFBhcmFtcy5nZXQoXCJzZXZlcml0eVwiKTtcbiAgICAgICAgY29uc3QgY29ycmVsYXRpb25JZCA9IHVybC5zZWFyY2hQYXJhbXMuZ2V0KFwiY29ycmVsYXRpb25JZFwiKTtcbiAgICAgICAgcmV0dXJuIChcbiAgICAgICAgICAoIXByb2plY3RJZCB8fCBldmVudC5wcm9qZWN0SWQgPT09IHByb2plY3RJZCkgJiZcbiAgICAgICAgICAoIXNldmVyaXR5IHx8IGV2ZW50LnNldmVyaXR5ID09PSBzZXZlcml0eSkgJiZcbiAgICAgICAgICAoIWNvcnJlbGF0aW9uSWQgfHwgZXZlbnQuY29ycmVsYXRpb25JZCA9PT0gY29ycmVsYXRpb25JZCkgJiZcbiAgICAgICAgICAoIXNlYXJjaCB8fFxuICAgICAgICAgICAgW2V2ZW50Lm1lc3NhZ2UsIGV2ZW50LnR5cGUsIGV2ZW50LmNvcnJlbGF0aW9uSWRdXG4gICAgICAgICAgICAgIC5maWx0ZXIoKHZhbHVlKTogdmFsdWUgaXMgc3RyaW5nID0+IHR5cGVvZiB2YWx1ZSA9PT0gXCJzdHJpbmdcIilcbiAgICAgICAgICAgICAgLnNvbWUoKHZhbHVlKSA9PiB2YWx1ZS50b0xvd2VyQ2FzZSgpLmluY2x1ZGVzKHNlYXJjaCkpKVxuICAgICAgICApO1xuICAgICAgfSk7XG4gICAgICBjb25zdCBsaW1pdCA9IE51bWJlcih1cmwuc2VhcmNoUGFyYW1zLmdldChcImxpbWl0XCIpKSB8fCA1MDtcbiAgICAgIGNvbnN0IHBhZ2UgPSBOdW1iZXIodXJsLnNlYXJjaFBhcmFtcy5nZXQoXCJwYWdlXCIpKSB8fCAxO1xuICAgICAgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoXG4gICAgICAgIGpzb25SZXNwb25zZSh7XG4gICAgICAgICAgZXZlbnRzOiBmaWx0ZXJlZEV2ZW50cy5zbGljZSgocGFnZSAtIDEpICogbGltaXQsIHBhZ2UgKiBsaW1pdCksXG4gICAgICAgICAgdG90YWw6IGZpbHRlcmVkRXZlbnRzLmxlbmd0aCxcbiAgICAgICAgfSksXG4gICAgICApO1xuICAgIH1cbiAgICBpZiAoXG4gICAgICBvdmVycmlkZXM/LnJlc3VtZUZhaWx1cmUgJiZcbiAgICAgIHBhdGggPT09XG4gICAgICAgIGAvYXBpL2FpL2V4ZWN1dGlvbnMvJHtvdmVycmlkZXMucmVzdW1lRmFpbHVyZS5maXh0dXJlLmV4ZWN1dGlvbklkfWBcbiAgICApIHtcbiAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKGpzb25SZXNwb25zZShvdmVycmlkZXMucmVzdW1lRmFpbHVyZS5leGVjdXRpb24pKTtcbiAgICB9XG4gICAgaWYgKFxuICAgICAgb3ZlcnJpZGVzPy5pbnRlcnJ1cHRlZFJlc3VtZSAmJlxuICAgICAgcGF0aCA9PT1cbiAgICAgICAgYC9hcGkvYWkvZXhlY3V0aW9ucy8ke292ZXJyaWRlcy5pbnRlcnJ1cHRlZFJlc3VtZS5maXh0dXJlLmV4ZWN1dGlvbklkfWBcbiAgICApIHtcbiAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKGpzb25SZXNwb25zZShvdmVycmlkZXMuaW50ZXJydXB0ZWRSZXN1bWUuZXhlY3V0aW9uKSk7XG4gICAgfVxuICAgIGlmIChcbiAgICAgIG92ZXJyaWRlcz8uaW50ZXJydXB0ZWRSZXN1bWUgJiZcbiAgICAgIHBhdGggPT09XG4gICAgICAgIGAvYXBpL2FpL2V4ZWN1dGlvbnMvJHtvdmVycmlkZXMuaW50ZXJydXB0ZWRSZXN1bWUuZml4dHVyZS5leGVjdXRpb25JZH0vcmVzdW1lLWNhcGFiaWxpdHlgXG4gICAgKSB7XG4gICAgICByZXR1cm4gcm91dGUuZnVsZmlsbChcbiAgICAgICAganNvblJlc3BvbnNlKHtcbiAgICAgICAgICBleGVjdXRpb25JZDogb3ZlcnJpZGVzLmludGVycnVwdGVkUmVzdW1lLmZpeHR1cmUuZXhlY3V0aW9uSWQsXG4gICAgICAgICAgcmVzdW1lVG9rZW46IG92ZXJyaWRlcy5pbnRlcnJ1cHRlZFJlc3VtZS5yZWNvdmVyZWRUb2tlbixcbiAgICAgICAgfSksXG4gICAgICApO1xuICAgIH1cbiAgICBpZiAocGF0aCA9PT0gYC9hcGkvYWkvZXhlY3V0aW9ucy8ke0VYRUNVVElPTl9JRH1gKVxuICAgICAgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoXG4gICAgICAgIGpzb25SZXNwb25zZShvdmVycmlkZXM/LmF1ZGl0RXhwb3J0Py5leGVjdXRpb24gPz8gZXhlY3V0aW9uRml4dHVyZSksXG4gICAgICApO1xuICAgIGlmIChwYXRoID09PSBcIi9hcGkvYWkvbWlzc2lvbi1jb250cm9sXCIpXG4gICAgICByZXR1cm4gcm91dGUuZnVsZmlsbChcbiAgICAgICAganNvblJlc3BvbnNlKHsgdXBkYXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDE6MDAuMDAwWlwiLCBleGVjdXRpb25zOiBbXSB9KSxcbiAgICAgICk7XG5cbiAgICAvLyBBSSBpcyBkZWxpYmVyYXRlbHkgbm90IGV4ZWN1dGVkIGluIHRoaXMgc21va2Ugam91cm5leS4gVGhpcyByZXNwb25zZVxuICAgIC8vIHZlcmlmaWVzIHRoZSB1c2VyLXZpc2libGUgdW5hdmFpbGFibGUvZW1wdHkgc3RhdGUgd2l0aG91dCBhIHByb3ZpZGVyLlxuICAgIGlmIChwYXRoLnN0YXJ0c1dpdGgoXCIvYXBpL2FpL1wiKSlcbiAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKFxuICAgICAgICBqc29uUmVzcG9uc2UoeyBlcnJvcjogXCJBSSBwcm92aWRlciBub3QgY29uZmlndXJlZFwiIH0sIDQyOCksXG4gICAgICApO1xuXG4gICAgcmV0dXJuIHJvdXRlLmNvbnRpbnVlKCk7XG4gIH0pO1xufVxuXG5hc3luYyBmdW5jdGlvbiBpbnN0YWxsQXJhYmljQWlGaXh0dXJlKFxuICBwYWdlOiBQYWdlLFxuICBvcHRpb25zPzoge1xuICAgIGJsb2NrZWQ/OiBib29sZWFuO1xuICAgIHNlc3Npb25JZD86IHN0cmluZztcbiAgICBxdWVzdGlvbj86IHN0cmluZztcbiAgICBwcm9qZWN0SWQ/OiBzdHJpbmc7XG4gIH0sXG4pIHtcbiAgY29uc3Qgc2Vzc2lvbklkID0gb3B0aW9ucz8uc2Vzc2lvbklkID8/IFwiZTJlLWFyYWJpYy1haS1zZXNzaW9uXCI7XG4gIGNvbnN0IG1lc3NhZ2VJZCA9IFwiZTJlLWFyYWJpYy1haS1tZXNzYWdlXCI7XG4gIGNvbnN0IHNvdXJjZSA9IFwic3JjL2V4ZWN1dGlvbi10b29scy50c1wiO1xuICBjb25zdCBibG9ja2VkID0gb3B0aW9ucz8uYmxvY2tlZCA9PT0gdHJ1ZTtcbiAgY29uc3QgcXVlc3Rpb24gPVxuICAgIG9wdGlvbnM/LnF1ZXN0aW9uID8/XG4gICAgXCLZhdin2LDYpyDZitit2K/YqyDYudmG2K8g2KfZhtiq2YfYp9ihINmF2YfZhNipIHByb3ZpZGVyIHRpbWVvdXQg2K/Yp9iu2YQgZXhlY3V0aW9uLXRvb2xzLnRz2J9cIjtcbiAgY29uc3QgYW5zd2VyID1cbiAgICBcIti52YbYryDYp9mG2KrZh9in2KEg2YXZh9mE2Kkg2YXYstmI2K8g2KfZhNiw2YPYp9ihINin2YTYp9i12LfZhtin2LnZitiMINmK2LnZitivINin2YTZhdiz2KfYsSDYqtmC2LHZitix2YvYpyDYrNiy2KbZitmL2Kcg2YXZhiDYp9mE2KPYr9mE2Kkg2KfZhNiq2Yog2KzZj9mF2LnYqiDYqNiv2YQg2KXYtdiv2KfYsSBGaW5kaW5nINi62YrYsSDZhdir2KjYqi5cIjtcbiAgY29uc3QgZXZpZGVuY2UgPSBbXG4gICAge1xuICAgICAgc291cmNlLFxuICAgICAgLi4uKGJsb2NrZWRcbiAgICAgICAgPyB7XG4gICAgICAgICAgICBleGNlcnB0OiBcInByb3ZpZGVyIHRpbWVvdXQgaXMgaGFuZGxlZCBoZXJlXCIsXG4gICAgICAgICAgICBzdXBwb3J0c0NsYWltOiBmYWxzZSxcbiAgICAgICAgICAgIGV2aWRlbmNlQ2xhc3M6IFwiUkVBRF9DT05GSVJNRURcIixcbiAgICAgICAgICAgIGNpdGF0aW9uU3RhdHVzOiBcIkJMT0NLRURcIixcbiAgICAgICAgICAgIGNpdGF0aW9uUmVhc29uOiBcIk1JU1NJTkdfTElURVJBTF9NQVRDSFwiLFxuICAgICAgICAgIH1cbiAgICAgICAgOiB7XG4gICAgICAgICAgICBleGNlcnB0OiAncmV0dXJuIHBhcnRpYWxGcm9tQ29sbGVjdGVkRXZpZGVuY2UoXCJwcm92aWRlciB0aW1lb3V0XCIpOycsXG4gICAgICAgICAgICBzb3VyY2VTcGFuOiB7IHN0YXJ0TGluZTogNDIsIGVuZExpbmU6IDQyIH0sXG4gICAgICAgICAgICBzdXBwb3J0c0NsYWltOiB0cnVlLFxuICAgICAgICAgICAgZXZpZGVuY2VDbGFzczogXCJCRUhBVklPUl9QUk9WRU5cIixcbiAgICAgICAgICAgIGNpdGF0aW9uU3RhdHVzOiBcIkFDQ0VQVEVEXCIsXG4gICAgICAgICAgICBjaXRhdGlvblJlYXNvbjogXCJBQ0NFUFRFRF9TT1VSQ0VfU1BBTlwiLFxuICAgICAgICAgIH0pLFxuICAgIH0sXG4gIF07XG4gIGNvbnN0IHRvb2xUcmFjZSA9IFtcbiAgICB7XG4gICAgICBraW5kOiBcInRvb2xfY2FsbFwiLFxuICAgICAgdG9vbDogXCJyZWFkX2ZpbGVcIixcbiAgICAgIGFyZ3M6IHsgcGF0aDogc291cmNlIH0sXG4gICAgICBjYWNoZWQ6IGZhbHNlLFxuICAgICAgcHJlZmV0Y2hlZDogdHJ1ZSxcbiAgICB9LFxuICAgIHtcbiAgICAgIGtpbmQ6IFwidG9vbF9yZXN1bHRcIixcbiAgICAgIHRvb2w6IFwicmVhZF9maWxlXCIsXG4gICAgICBzb3VyY2UsXG4gICAgICBjYWNoZWQ6IGZhbHNlLFxuICAgICAgcHJlZmV0Y2hlZDogdHJ1ZSxcbiAgICB9LFxuICAgIHtcbiAgICAgIGtpbmQ6IFwiZXZpZGVuY2VfaW50ZWdyaXR5XCIsXG4gICAgICBjb2RlOiBcIkVWSURFTkNFX0lOVEVHUklUWV9PS1wiLFxuICAgICAgY29uc2lzdGVudDogdHJ1ZSxcbiAgICAgIHZpb2xhdGlvbnM6IFtdLFxuICAgICAgZXZpZGVuY2VGaWxlQ291bnQ6IDEsXG4gICAgICBhY2NlcHRlZEV2aWRlbmNlQ291bnQ6IDEsXG4gICAgICBjb21wbGV0ZWRSZWFkRmlsZXM6IFtzb3VyY2VdLFxuICAgICAgYWNjZXB0ZWRFdmlkZW5jZUZpbGVzOiBbc291cmNlXSxcbiAgICAgIG9iamVjdGl2ZVR5cGU6IFwiUFJPRFVDVElPTl9SRUFDSEFCSUxJVFlcIixcbiAgICAgIHJlcXVpcmVkRWRnZXM6IFtcImNsaWVudC0+c2VydmVyXCIsIFwic2VydmVyLT5kYXRhYmFzZVwiXSxcbiAgICAgIHByb3ZlbkVkZ2VzOiBbXCJjbGllbnQtPnNlcnZlclwiXSxcbiAgICAgIGNvbXBsZXRpb25HYXRlUmVzdWx0OiBcIlBBUlRJQUxMWV9QUk9WRU5cIixcbiAgICAgIGZpbmFsQW5zd2VyVHlwZTogXCJQUk9EVUNUSU9OX1JFQUNIQUJJTElUWV9BTlNXRVJcIixcbiAgICB9LFxuICBdO1xuICBjb25zdCB0YXNrUmVzdWx0ID0ge1xuICAgIGtpbmQ6IFwiQkVIQVZJT1JfQU5TV0VSX1JFU1VMVFwiLFxuICAgIGFuc3dlcjoge1xuICAgICAgYW5zd2VyLFxuICAgICAgZXZpZGVuY2UsXG4gICAgICBjb25maWRlbmNlOiAxLFxuICAgICAgc291cmNlU2NvcGU6IFtzb3VyY2VdLFxuICAgICAgY292ZXJhZ2U6IHtcbiAgICAgICAgcmVxdWVzdGVkRmllbGRzOiBbXCJ0aW1lb3V0IGJlaGF2aW9yXCJdLFxuICAgICAgICBhbnN3ZXJlZEZpZWxkczogW1widGltZW91dCBiZWhhdmlvclwiXSxcbiAgICAgICAgbWlzc2luZ0ZpZWxkczogW10sXG4gICAgICAgIGNvbXBsZXRlOiB0cnVlLFxuICAgICAgfSxcbiAgICB9LFxuICB9O1xuICBjb25zdCBtZXNzYWdlID0ge1xuICAgIGlkOiBtZXNzYWdlSWQsXG4gICAgc2Vzc2lvbklkLFxuICAgIHJvbGU6IFwiYXNzaXN0YW50XCIsXG4gICAgY29udGVudDogYCR7YW5zd2VyfVxcblxcbiMjIDYpIEZpbmFsIEp1ZGdtZW50XFxuTk9UIFBST1ZFTmAsXG4gICAgb3BlcmF0aW9uTW9kZTogXCJGT1JFTlNJQ19BVURJVFwiLFxuICAgIHNvdXJjZXM6IFtzb3VyY2VdLFxuICAgIHRvb2xUcmFjZTogSlNPTi5zdHJpbmdpZnkodG9vbFRyYWNlKSxcbiAgICBiZWhhdmlvckV2aWRlbmNlOiBldmlkZW5jZSxcbiAgICB0YXNrUmVzdWx0LFxuICAgIGNyZWF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAyOjAwLjAwMFpcIixcbiAgfTtcbiAgY29uc3Qgc3NlID0gKGV2ZW50OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPikgPT5cbiAgICBgZGF0YTogJHtKU09OLnN0cmluZ2lmeShldmVudCl9XFxuXFxuYDtcbiAgY29uc3Qgc3RyZWFtQm9keSA9IFtcbiAgICBzc2UoeyB0eXBlOiBcInNlc3Npb25fc3RhcnRlZFwiLCBzZXNzaW9uSWQgfSksXG4gICAgc3NlKHtcbiAgICAgIHR5cGU6IFwiZXhlY3V0aW9uX3N0YXJ0ZWRcIixcbiAgICAgIGV4ZWN1dGlvbklkOiBcImUyZS1leGVjdXRpb25cIixcbiAgICAgIHN0YXR1czogXCJydW5uaW5nXCIsXG4gICAgICByZXN1bWFibGU6IHRydWUsXG4gICAgfSksXG4gICAgc3NlKHsgdHlwZTogXCJzdGFnZVwiLCBzdGFnZTogXCJidWlsZGluZy1jb250ZXh0XCIgfSksXG4gICAgc3NlKHsgdHlwZTogXCJzdGFnZVwiLCBzdGFnZTogXCJjYWxsaW5nLW1vZGVsXCIgfSksXG4gICAgc3NlKHtcbiAgICAgIHR5cGU6IFwidG9vbF9jYWxsXCIsXG4gICAgICB0b29sOiBcInJlYWRfZmlsZVwiLFxuICAgICAgYXJnczogeyBwYXRoOiBzb3VyY2UgfSxcbiAgICAgIGNhY2hlZDogZmFsc2UsXG4gICAgICBwcmVmZXRjaGVkOiB0cnVlLFxuICAgIH0pLFxuICAgIHNzZSh7XG4gICAgICB0eXBlOiBcInRvb2xfcmVzdWx0XCIsXG4gICAgICB0b29sOiBcInJlYWRfZmlsZVwiLFxuICAgICAgc291cmNlLFxuICAgICAgY2FjaGVkOiBmYWxzZSxcbiAgICAgIHByZWZldGNoZWQ6IHRydWUsXG4gICAgfSksXG4gICAgc3NlKHtcbiAgICAgIHR5cGU6IFwiZXZpZGVuY2VfaW50ZWdyaXR5XCIsXG4gICAgICBjb2RlOiBcIkVWSURFTkNFX0lOVEVHUklUWV9PS1wiLFxuICAgICAgY29uc2lzdGVudDogdHJ1ZSxcbiAgICAgIHZpb2xhdGlvbnM6IFtdLFxuICAgICAgZXZpZGVuY2VGaWxlQ291bnQ6IDEsXG4gICAgICBhY2NlcHRlZEV2aWRlbmNlQ291bnQ6IDEsXG4gICAgICBjb21wbGV0ZWRSZWFkRmlsZXM6IFtzb3VyY2VdLFxuICAgICAgYWNjZXB0ZWRFdmlkZW5jZUZpbGVzOiBbc291cmNlXSxcbiAgICAgIG9iamVjdGl2ZVR5cGU6IFwiUFJPRFVDVElPTl9SRUFDSEFCSUxJVFlcIixcbiAgICAgIHJlcXVpcmVkRWRnZXM6IFtcImNsaWVudC0+c2VydmVyXCIsIFwic2VydmVyLT5kYXRhYmFzZVwiXSxcbiAgICAgIHByb3ZlbkVkZ2VzOiBbXCJjbGllbnQtPnNlcnZlclwiXSxcbiAgICAgIGNvbXBsZXRpb25HYXRlUmVzdWx0OiBcIlBBUlRJQUxMWV9QUk9WRU5cIixcbiAgICAgIGZpbmFsQW5zd2VyVHlwZTogXCJQUk9EVUNUSU9OX1JFQUNIQUJJTElUWV9BTlNXRVJcIixcbiAgICB9KSxcbiAgICBzc2UoeyB0eXBlOiBcImRlbHRhXCIsIGRlbHRhOiBhbnN3ZXIgfSksXG4gICAgc3NlKHtcbiAgICAgIHR5cGU6IFwiZG9uZVwiLFxuICAgICAgc2Vzc2lvbklkLFxuICAgICAgbWVzc2FnZSxcbiAgICAgIHNvdXJjZXM6IFtzb3VyY2VdLFxuICAgICAgdG9vbFRyYWNlOiBKU09OLnN0cmluZ2lmeSh0b29sVHJhY2UpLFxuICAgICAgYmVoYXZpb3JFdmlkZW5jZTogZXZpZGVuY2UsXG4gICAgICB0YXNrUmVzdWx0LFxuICAgICAgcGVuZGluZ0NoYW5nZXM6IFtdLFxuICAgIH0pLFxuICBdLmpvaW4oXCJcIik7XG5cbiAgcmV0dXJuIHtcbiAgICBxdWVzdGlvbixcbiAgICBhbnN3ZXIsXG4gICAgc291cmNlLFxuICAgIHNlc3Npb25JZCxcbiAgICBwcm9qZWN0SWQ6IG9wdGlvbnM/LnByb2plY3RJZCxcbiAgICBzdHJlYW1Cb2R5LFxuICAgIG1lc3NhZ2UsXG4gIH07XG59XG5cbmZ1bmN0aW9uIGluc3RhbGxUb29sRmFpbHVyZUZpeHR1cmUoKTogQXJhYmljQWlGaXh0dXJlIHtcbiAgY29uc3Qgc2Vzc2lvbklkID0gXCJlMmUtdG9vbC1mYWlsdXJlLXNlc3Npb25cIjtcbiAgY29uc3QgbWVzc2FnZUlkID0gXCJlMmUtdG9vbC1mYWlsdXJlLW1lc3NhZ2VcIjtcbiAgY29uc3Qgc291cmNlID0gXCJzcmMvbWlzc2luZy1yZWxlYXNlLWZpeHR1cmUudHNcIjtcbiAgY29uc3QgcXVlc3Rpb24gPSBcIldoaWNoIHNvdXJjZSBmaWxlIGlzIGF2YWlsYWJsZSBmb3IgdGhlIHJlbGVhc2UgY2hlY2s/XCI7XG4gIGNvbnN0IGFuc3dlciA9XG4gICAgXCJBTkFMWVNJU19JTkNPTVBMRVRFOiBUaGUgcmVxdWlyZWQgc291cmNlIHJlYWQgZGlkIG5vdCBjb21wbGV0ZSwgc28gbm8gdmVyaWZpZWQgcmVzdWx0IGlzIGF2YWlsYWJsZS5cIjtcbiAgY29uc3QgZGlhZ25vc3RpY0NvZGUgPSBcIlRPT0xfRVhFQ1VUSU9OX0ZBSUxFRFwiO1xuICBjb25zdCB0b29sVHJhY2UgPSBbXG4gICAge1xuICAgICAga2luZDogXCJ0b29sX2NhbGxcIixcbiAgICAgIHRvb2w6IFwicmVhZF9maWxlXCIsXG4gICAgICBhcmdzOiB7IHBhdGg6IHNvdXJjZSB9LFxuICAgICAgY2FjaGVkOiBmYWxzZSxcbiAgICB9LFxuICAgIHtcbiAgICAgIGtpbmQ6IFwidG9vbF9yZXN1bHRcIixcbiAgICAgIHRvb2w6IFwicmVhZF9maWxlXCIsXG4gICAgICBzb3VyY2UsXG4gICAgICByZXN1bHRLaW5kOiBcImZhaWxlZFwiLFxuICAgICAgZGlhZ25vc3RpY0NvZGUsXG4gICAgICByZXN1bHRTdW1tYXJ5OiBcIlRoZSByZXF1aXJlZCBzb3VyY2UgcmVhZCBkaWQgbm90IGNvbXBsZXRlLlwiLFxuICAgIH0sXG4gICAge1xuICAgICAga2luZDogXCJkb25lXCIsXG4gICAgICBzdG9wUmVhc29uOiBcInRvb2xfZmFpbHVyZVwiLFxuICAgICAgaXRlcmF0aW9uczogMSxcbiAgICAgIG1heEl0ZXJhdGlvbnM6IDgsXG4gICAgICB0b29sQ2FsbHM6IDEsXG4gICAgICBwcmVmZXRjaFRvb2xDYWxsczogMCxcbiAgICAgIGxvb3BUb29sQ2FsbHM6IDEsXG4gICAgICBzeW50aGVzaXNTdGFydGVkOiBmYWxzZSxcbiAgICAgIGRpYWdub3N0aWNDb2RlczogW2RpYWdub3N0aWNDb2RlXSxcbiAgICB9LFxuICBdO1xuICBjb25zdCBtZXNzYWdlID0ge1xuICAgIGlkOiBtZXNzYWdlSWQsXG4gICAgc2Vzc2lvbklkLFxuICAgIHJvbGU6IFwiYXNzaXN0YW50XCIsXG4gICAgY29udGVudDogYW5zd2VyLFxuICAgIHRvb2xUcmFjZTogSlNPTi5zdHJpbmdpZnkodG9vbFRyYWNlKSxcbiAgICBjcmVhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMjowMC4wMDBaXCIsXG4gIH07XG4gIGNvbnN0IHNzZSA9IChldmVudDogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pID0+XG4gICAgYGRhdGE6ICR7SlNPTi5zdHJpbmdpZnkoZXZlbnQpfVxcblxcbmA7XG4gIGNvbnN0IHN0cmVhbUJvZHkgPSBbXG4gICAgc3NlKHsgdHlwZTogXCJzZXNzaW9uX3N0YXJ0ZWRcIiwgc2Vzc2lvbklkIH0pLFxuICAgIHNzZSh7XG4gICAgICB0eXBlOiBcImV4ZWN1dGlvbl9zdGFydGVkXCIsXG4gICAgICBleGVjdXRpb25JZDogXCJlMmUtdG9vbC1mYWlsdXJlLWV4ZWN1dGlvblwiLFxuICAgICAgc3RhdHVzOiBcInJ1bm5pbmdcIixcbiAgICAgIHJlc3VtYWJsZTogdHJ1ZSxcbiAgICB9KSxcbiAgICBzc2Uoe1xuICAgICAgdHlwZTogXCJ0b29sX2NhbGxcIixcbiAgICAgIHRvb2w6IFwicmVhZF9maWxlXCIsXG4gICAgICBhcmdzOiB7IHBhdGg6IHNvdXJjZSB9LFxuICAgICAgY2FjaGVkOiBmYWxzZSxcbiAgICB9KSxcbiAgICBzc2Uoe1xuICAgICAgdHlwZTogXCJ0b29sX3Jlc3VsdFwiLFxuICAgICAgdG9vbDogXCJyZWFkX2ZpbGVcIixcbiAgICAgIHNvdXJjZSxcbiAgICAgIHJlc3VsdEtpbmQ6IFwiZmFpbGVkXCIsXG4gICAgICBkaWFnbm9zdGljQ29kZSxcbiAgICAgIHJlc3VsdFN1bW1hcnk6IFwiVGhlIHJlcXVpcmVkIHNvdXJjZSByZWFkIGRpZCBub3QgY29tcGxldGUuXCIsXG4gICAgfSksXG4gICAgc3NlKHsgdHlwZTogXCJkZWx0YVwiLCBkZWx0YTogYW5zd2VyIH0pLFxuICAgIHNzZSh7XG4gICAgICB0eXBlOiBcImRvbmVcIixcbiAgICAgIHNlc3Npb25JZCxcbiAgICAgIG1lc3NhZ2UsXG4gICAgICB0b29sVHJhY2U6IEpTT04uc3RyaW5naWZ5KHRvb2xUcmFjZSksXG4gICAgICBwZW5kaW5nQ2hhbmdlczogW10sXG4gICAgfSksXG4gIF0uam9pbihcIlwiKTtcblxuICByZXR1cm4ge1xuICAgIHF1ZXN0aW9uLFxuICAgIGFuc3dlcixcbiAgICBzb3VyY2UsXG4gICAgc2Vzc2lvbklkLFxuICAgIHN0cmVhbUJvZHksXG4gICAgbWVzc2FnZSxcbiAgfTtcbn1cblxuZnVuY3Rpb24gaW5zdGFsbERpc2Nvbm5lY3RlZEFpRml4dHVyZSgpOiBBcmFiaWNBaUZpeHR1cmUge1xuICBjb25zdCBzZXNzaW9uSWQgPSBcImUyZS1kaXNjb25uZWN0ZWQtYWktc2Vzc2lvblwiO1xuICBjb25zdCBleGVjdXRpb25JZCA9IFwiZTJlLWRpc2Nvbm5lY3RlZC1haS1leGVjdXRpb25cIjtcbiAgY29uc3QgcXVlc3Rpb24gPVxuICAgIFwiV2hhdCBoYXBwZW5zIHdoZW4gdGhlIG1vZGVsIGRpc2Nvbm5lY3RzIGFmdGVyIHN0YXJ0aW5nIGFuIGFuc3dlcj9cIjtcbiAgY29uc3QgYW5zd2VyID1cbiAgICBcIlRoZSBtb2RlbCBzdGFydGVkIGFuIGFuc3dlciwgYnV0IHRoZSBwcm92aWRlciBkaXNjb25uZWN0ZWQgYmVmb3JlIGNvbXBsZXRpb24uXCI7XG4gIGNvbnN0IGRpYWdub3N0aWNDb2RlID0gXCJFWEVDVVRJT05fUFJPVklERVJfRkFJTFVSRVwiO1xuICBjb25zdCB0b29sVHJhY2UgPSBbXG4gICAge1xuICAgICAga2luZDogXCJkb25lXCIsXG4gICAgICBzdG9wUmVhc29uOiBcInByb3ZpZGVyX3RpbWVvdXRcIixcbiAgICAgIGl0ZXJhdGlvbnM6IDEsXG4gICAgICBtYXhJdGVyYXRpb25zOiA4LFxuICAgICAgdG9vbENhbGxzOiAwLFxuICAgICAgcHJlZmV0Y2hUb29sQ2FsbHM6IDAsXG4gICAgICBsb29wVG9vbENhbGxzOiAwLFxuICAgICAgc3ludGhlc2lzU3RhcnRlZDogZmFsc2UsXG4gICAgICBkaWFnbm9zdGljQ29kZXM6IFtkaWFnbm9zdGljQ29kZV0sXG4gICAgICBkaWFnbm9zdGljRGV0YWlsczogW1xuICAgICAgICBcIlRoZSBwcm92aWRlciBkaXNjb25uZWN0ZWQgYWZ0ZXIgdmlzaWJsZSByZXNwb25zZSB0ZXh0LlwiLFxuICAgICAgXSxcbiAgICB9LFxuICBdO1xuICBjb25zdCBtZXNzYWdlID0ge1xuICAgIGlkOiBcImUyZS1kaXNjb25uZWN0ZWQtYWktbWVzc2FnZVwiLFxuICAgIHNlc3Npb25JZCxcbiAgICByb2xlOiBcImFzc2lzdGFudFwiLFxuICAgIGNvbnRlbnQ6IGFuc3dlcixcbiAgICB0b29sVHJhY2U6IEpTT04uc3RyaW5naWZ5KHRvb2xUcmFjZSksXG4gICAgb3V0Y29tZTogXCJGQUlMRURcIixcbiAgICBlcnJvckNvZGU6IGRpYWdub3N0aWNDb2RlLFxuICAgIGVycm9yTWVzc2FnZTogXCJUaGUgcHJvdmlkZXIgZGlzY29ubmVjdGVkIGJlZm9yZSBjb21wbGV0aW9uLlwiLFxuICAgIGV4ZWN1dGlvbklkLFxuICAgIGNyZWF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAyOjAwLjAwMFpcIixcbiAgfTtcbiAgY29uc3Qgc3NlID0gKGV2ZW50OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPikgPT5cbiAgICBgZGF0YTogJHtKU09OLnN0cmluZ2lmeShldmVudCl9XFxuXFxuYDtcbiAgY29uc3Qgc3RyZWFtQm9keSA9IFtcbiAgICBzc2UoeyB0eXBlOiBcInNlc3Npb25fc3RhcnRlZFwiLCBzZXNzaW9uSWQgfSksXG4gICAgc3NlKHtcbiAgICAgIHR5cGU6IFwiZXhlY3V0aW9uX3N0YXJ0ZWRcIixcbiAgICAgIGV4ZWN1dGlvbklkLFxuICAgICAgc3RhdHVzOiBcInJ1bm5pbmdcIixcbiAgICAgIHJlc3VtYWJsZTogdHJ1ZSxcbiAgICB9KSxcbiAgICBzc2UoeyB0eXBlOiBcInN0YWdlXCIsIHN0YWdlOiBcImNhbGxpbmctbW9kZWxcIiB9KSxcbiAgICBzc2UoeyB0eXBlOiBcImRlbHRhXCIsIGRlbHRhOiBhbnN3ZXIgfSksXG4gICAgLy8gVGhlIHJlYWwgcm91dGUgZW1pdHMgdGhpcyBhZnRlciBhIHByb3ZpZGVyIGRpc2Nvbm5lY3Qgc28gdGhlIGNsaWVudFxuICAgIC8vIGRyb3BzIHRoZSB0cmFuc2llbnQgYnViYmxlIGJlZm9yZSByZW5kZXJpbmcgdGhlIHBlcnNpc3RlZCByZXN1bHQuXG4gICAgc3NlKHsgdHlwZTogXCJzdHJlYW1fcmVzZXRcIiB9KSxcbiAgICBzc2Uoe1xuICAgICAgdHlwZTogXCJkb25lXCIsXG4gICAgICBzZXNzaW9uSWQsXG4gICAgICBleGVjdXRpb25JZCxcbiAgICAgIG1lc3NhZ2UsXG4gICAgICBwZW5kaW5nQ2hhbmdlczogW10sXG4gICAgfSksXG4gIF0uam9pbihcIlwiKTtcblxuICByZXR1cm4ge1xuICAgIHF1ZXN0aW9uLFxuICAgIGFuc3dlcixcbiAgICBzb3VyY2U6IFwicHJvdmlkZXJcIixcbiAgICBzZXNzaW9uSWQsXG4gICAgZXhlY3V0aW9uSWQsXG4gICAgc3RyZWFtQm9keSxcbiAgICBtZXNzYWdlLFxuICB9O1xufVxuXG5mdW5jdGlvbiBpbnN0YWxsUmVzdW1lZEFuYWx5c2lzRmFpbHVyZUZpeHR1cmUoKSB7XG4gIGNvbnN0IHNlc3Npb25JZCA9IFwiZTJlLXJlc3VtZWQtYW5hbHlzaXMtZmFpbHVyZS1zZXNzaW9uXCI7XG4gIGNvbnN0IGV4ZWN1dGlvbklkID0gXCJlMmUtcmVzdW1lZC1hbmFseXNpcy1mYWlsdXJlLWV4ZWN1dGlvblwiO1xuICBjb25zdCByZXN1bWVUb2tlbiA9IFwiZTJlLXJlc3VtZWQtYW5hbHlzaXMtZmFpbHVyZS10b2tlbi1vcGFxdWVcIjtcbiAgY29uc3QgcXVlc3Rpb24gPSBcIlZlcmlmeSB0aGUgYW5hbHlzaXMgZXZpZGVuY2UgYWZ0ZXIgcmVjb25uZWN0LlwiO1xuICBjb25zdCBhbnN3ZXIgPVxuICAgIFwiQU5BTFlTSVNfSU5DT01QTEVURTogVGhlIHJlcXVpcmVkIGFuYWx5c2lzIGRpZCBub3QgY29tcGxldGUsIHNvIG5vIHZlcmlmaWVkIHJlc3VsdCBpcyBhdmFpbGFibGUuXCI7XG4gIGNvbnN0IGRpYWdub3N0aWNDb2RlID0gXCJUT09MX1VOQVZBSUxBQkxFXCI7XG4gIGNvbnN0IHNzZSA9IChldmVudDogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pID0+XG4gICAgYGRhdGE6ICR7SlNPTi5zdHJpbmdpZnkoZXZlbnQpfVxcblxcbmA7XG4gIGNvbnN0IHN0cmVhbUJvZHkgPSBbXG4gICAgc3NlKHsgdHlwZTogXCJzZXNzaW9uX3N0YXJ0ZWRcIiwgc2Vzc2lvbklkIH0pLFxuICAgIHNzZSh7XG4gICAgICB0eXBlOiBcImV4ZWN1dGlvbl9zdGFydGVkXCIsXG4gICAgICBleGVjdXRpb25JZCxcbiAgICAgIHN0YXR1czogXCJydW5uaW5nXCIsXG4gICAgICByZXN1bWFibGU6IHRydWUsXG4gICAgICByZXN1bWVUb2tlbixcbiAgICB9KSxcbiAgICBzc2Uoe1xuICAgICAgdHlwZTogXCJlcnJvclwiLFxuICAgICAgZXhlY3V0aW9uSWQsXG4gICAgICBjb2RlOiBkaWFnbm9zdGljQ29kZSxcbiAgICAgIG1lc3NhZ2U6IFwiVGhlIHJlcXVpcmVkIGFuYWx5c2lzIGRpZCBub3QgY29tcGxldGUuXCIsXG4gICAgfSksXG4gIF0uam9pbihcIlwiKTtcbiAgY29uc3QgZml4dHVyZTogQXJhYmljQWlGaXh0dXJlID0ge1xuICAgIHF1ZXN0aW9uLFxuICAgIGFuc3dlcixcbiAgICBzb3VyY2U6IFwic3JjL21pc3NpbmctYW5hbHlzaXMtdG9vbC50c1wiLFxuICAgIHNlc3Npb25JZCxcbiAgICBleGVjdXRpb25JZCxcbiAgICBzdHJlYW1Cb2R5LFxuICAgIG1lc3NhZ2U6IHtcbiAgICAgIGlkOiBcImUyZS1yZXN1bWVkLWFuYWx5c2lzLWZhaWx1cmUtbWVzc2FnZVwiLFxuICAgICAgc2Vzc2lvbklkLFxuICAgICAgcm9sZTogXCJhc3Npc3RhbnRcIixcbiAgICAgIGNvbnRlbnQ6IGFuc3dlcixcbiAgICAgIG91dGNvbWU6IFwiRkFJTEVEXCIsXG4gICAgICBleGVjdXRpb25JZCxcbiAgICAgIGVycm9yQ29kZTogZGlhZ25vc3RpY0NvZGUsXG4gICAgICBlcnJvck1lc3NhZ2U6IFwiVGhlIHJlcXVpcmVkIGFuYWx5c2lzIGRpZCBub3QgY29tcGxldGUuXCIsXG4gICAgICBjcmVhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMjowMC4wMDBaXCIsXG4gICAgfSxcbiAgfTtcblxuICByZXR1cm4ge1xuICAgIGZpeHR1cmUsXG4gICAgZXhlY3V0aW9uOiB7XG4gICAgICBpZDogZXhlY3V0aW9uSWQsXG4gICAgICBwcm9qZWN0SWQ6IFwiZTJlLXByb2plY3RcIixcbiAgICAgIG9wZXJhdGlvbklkOiBcImUyZS1yZXN1bWVkLWFuYWx5c2lzLWZhaWx1cmUtb3BlcmF0aW9uXCIsXG4gICAgICBzZXNzaW9uSWQsXG4gICAgICBzdGF0dXM6IFwiZmFpbGVkXCIsXG4gICAgICBmbGlnaHRTdGF0ZTogXCJGQUlMRURcIixcbiAgICAgIGV2aWRlbmNlVmVyZGljdDogXCJJTkNPTVBMRVRFXCIsXG4gICAgICBwcm9vZlJlcXVpcmVkOiB0cnVlLFxuICAgICAgcmVzdW1hYmxlOiB0cnVlLFxuICAgICAgY2hlY2twb2ludFZlcnNpb246IDEsXG4gICAgICBjaGVja3BvaW50OiB7XG4gICAgICAgIHN0YWdlOiBcInRvb2wtZXhlY3V0aW9uXCIsXG4gICAgICAgIGRldGFpbDogXCJUaGUgcmVxdWlyZWQgYW5hbHlzaXMgdG9vbCB3YXMgdW5hdmFpbGFibGUuXCIsXG4gICAgICB9LFxuICAgICAgb2JqZWN0aXZlOiB7IG9iamVjdGl2ZTogcXVlc3Rpb24gfSxcbiAgICAgIGVycm9yOiBcIlRoZSByZXF1aXJlZCBhbmFseXNpcyBkaWQgbm90IGNvbXBsZXRlLlwiLFxuICAgICAgc3RhcnRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDE6MDAuMDAwWlwiLFxuICAgICAgY3JlYXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDE6MDAuMDAwWlwiLFxuICAgICAgdXBkYXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDI6MDAuMDAwWlwiLFxuICAgIH0sXG4gIH07XG59XG5cbmZ1bmN0aW9uIGluc3RhbGxJbnRlcnJ1cHRlZFJlc3VtZUZpeHR1cmUoKSB7XG4gIGNvbnN0IHNlc3Npb25JZCA9IFwiZTJlLWludGVycnVwdGVkLXJlc3VtZS1zZXNzaW9uXCI7XG4gIGNvbnN0IGV4ZWN1dGlvbklkID0gXCJlMmUtaW50ZXJydXB0ZWQtcmVzdW1lLWV4ZWN1dGlvblwiO1xuICBjb25zdCBpbml0aWFsVG9rZW4gPSBcImUyZS1pbnRlcnJ1cHRlZC1pbml0aWFsLXRva2VuXCI7XG4gIGNvbnN0IHJlY292ZXJlZFRva2VuID0gXCJlMmUtaW50ZXJydXB0ZWQtcmVjb3ZlcmVkLXRva2VuXCI7XG4gIGNvbnN0IHF1ZXN0aW9uID0gXCJDb250aW51ZSB0aGUgaW50ZXJydXB0ZWQgcmVsZWFzZSBleGVjdXRpb24uXCI7XG4gIGNvbnN0IHBhcnRpYWxBbnN3ZXIgPVxuICAgIFwiVGhlIHJlbGVhc2UgZXhlY3V0aW9uIHN0YXJ0ZWQgYmVmb3JlIHRoZSBicm93c2VyIGRpc2Nvbm5lY3RlZC5cIjtcbiAgY29uc3QgYW5zd2VyID1cbiAgICBcIlRoZSBvcmlnaW5hbCByZWxlYXNlIGV4ZWN1dGlvbiByZXN1bWVkIGFmdGVyIGNhcGFiaWxpdHkgcmVjb3ZlcnkuXCI7XG4gIGNvbnN0IG1lc3NhZ2UgPSB7XG4gICAgaWQ6IFwiZTJlLWludGVycnVwdGVkLXJlc3VtZS1tZXNzYWdlXCIsXG4gICAgc2Vzc2lvbklkLFxuICAgIHJvbGU6IFwiYXNzaXN0YW50XCIsXG4gICAgY29udGVudDogYW5zd2VyLFxuICAgIGV4ZWN1dGlvbklkLFxuICAgIG91dGNvbWU6IFwiQ09NUExFVEVEXCIsXG4gICAgY3JlYXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDM6MDAuMDAwWlwiLFxuICB9O1xuICBjb25zdCBzc2UgPSAoZXZlbnQ6IFJlY29yZDxzdHJpbmcsIHVua25vd24+KSA9PlxuICAgIGBkYXRhOiAke0pTT04uc3RyaW5naWZ5KGV2ZW50KX1cXG5cXG5gO1xuICBjb25zdCBmaXh0dXJlOiBBcmFiaWNBaUZpeHR1cmUgPSB7XG4gICAgcXVlc3Rpb24sXG4gICAgYW5zd2VyLFxuICAgIHNvdXJjZTogXCJyZWxlYXNlLXJlc3VtZVwiLFxuICAgIHNlc3Npb25JZCxcbiAgICBleGVjdXRpb25JZCxcbiAgICBzdHJlYW1Cb2R5OiBbXG4gICAgICBzc2UoeyB0eXBlOiBcInNlc3Npb25fc3RhcnRlZFwiLCBzZXNzaW9uSWQgfSksXG4gICAgICBzc2Uoe1xuICAgICAgICB0eXBlOiBcImV4ZWN1dGlvbl9zdGFydGVkXCIsXG4gICAgICAgIGV4ZWN1dGlvbklkLFxuICAgICAgICBzdGF0dXM6IFwicnVubmluZ1wiLFxuICAgICAgICByZXN1bWFibGU6IHRydWUsXG4gICAgICAgIHJlc3VtZVRva2VuOiBpbml0aWFsVG9rZW4sXG4gICAgICB9KSxcbiAgICAgIHNzZSh7IHR5cGU6IFwic3RhZ2VcIiwgc3RhZ2U6IFwiY2FsbGluZy1tb2RlbFwiIH0pLFxuICAgICAgc3NlKHsgdHlwZTogXCJkZWx0YVwiLCBkZWx0YTogcGFydGlhbEFuc3dlciB9KSxcbiAgICBdLmpvaW4oXCJcIiksXG4gICAgbWVzc2FnZSxcbiAgfTtcbiAgcmV0dXJuIHtcbiAgICBmaXh0dXJlLFxuICAgIGluaXRpYWxUb2tlbixcbiAgICByZWNvdmVyZWRUb2tlbixcbiAgICByZXN1bWVkU3RyZWFtQm9keTogW1xuICAgICAgc3NlKHsgdHlwZTogXCJzZXNzaW9uX3N0YXJ0ZWRcIiwgc2Vzc2lvbklkIH0pLFxuICAgICAgc3NlKHtcbiAgICAgICAgdHlwZTogXCJleGVjdXRpb25fc3RhcnRlZFwiLFxuICAgICAgICBleGVjdXRpb25JZCxcbiAgICAgICAgc3RhdHVzOiBcInJ1bm5pbmdcIixcbiAgICAgICAgcmVzdW1hYmxlOiB0cnVlLFxuICAgICAgICByZXN1bWVUb2tlbjogcmVjb3ZlcmVkVG9rZW4sXG4gICAgICB9KSxcbiAgICAgIHNzZSh7IHR5cGU6IFwic3RhZ2VcIiwgc3RhZ2U6IFwicmVzdW1pbmctY2hlY2twb2ludFwiIH0pLFxuICAgICAgc3NlKHsgdHlwZTogXCJkZWx0YVwiLCBkZWx0YTogYW5zd2VyIH0pLFxuICAgICAgc3NlKHtcbiAgICAgICAgdHlwZTogXCJkb25lXCIsXG4gICAgICAgIHNlc3Npb25JZCxcbiAgICAgICAgZXhlY3V0aW9uSWQsXG4gICAgICAgIG1lc3NhZ2UsXG4gICAgICAgIHBlbmRpbmdDaGFuZ2VzOiBbXSxcbiAgICAgIH0pLFxuICAgIF0uam9pbihcIlwiKSxcbiAgICBleGVjdXRpb246IHtcbiAgICAgIGlkOiBleGVjdXRpb25JZCxcbiAgICAgIHByb2plY3RJZDogXCJlMmUtcHJvamVjdFwiLFxuICAgICAgb3BlcmF0aW9uSWQ6IFwiZTJlLWludGVycnVwdGVkLXJlc3VtZS1vcGVyYXRpb25cIixcbiAgICAgIHNlc3Npb25JZCxcbiAgICAgIHN0YXR1czogXCJwYXVzZWRcIixcbiAgICAgIGZsaWdodFN0YXRlOiBcIlBBVVNFRFwiLFxuICAgICAgcmVzdW1hYmxlOiB0cnVlLFxuICAgICAgY2hlY2twb2ludFZlcnNpb246IDEsXG4gICAgICBjaGVja3BvaW50OiB7XG4gICAgICAgIHN0YWdlOiBcImNhbGxpbmctbW9kZWxcIixcbiAgICAgICAgZGV0YWlsOlxuICAgICAgICAgIFwiVGhlIGJyb3dzZXIgdHJhbnNwb3J0IGRpc2Nvbm5lY3RlZCBhZnRlciB0aGUgZXhlY3V0aW9uIHN0YXJ0ZWQuXCIsXG4gICAgICB9LFxuICAgICAgb2JqZWN0aXZlOiB7IG9iamVjdGl2ZTogcXVlc3Rpb24gfSxcbiAgICAgIHN0YXJ0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAxOjAwLjAwMFpcIixcbiAgICAgIGNyZWF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAxOjAwLjAwMFpcIixcbiAgICAgIHVwZGF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAyOjAwLjAwMFpcIixcbiAgICB9LFxuICB9O1xufVxuXG5hc3luYyBmdW5jdGlvbiBjcmVhdGVSZWxlYXNlU2lnbkluVXJsKHBhZ2U6IFBhZ2UpIHtcbiAgY29uc3Qgc2VjcmV0S2V5ID0gcHJvY2Vzcy5lbnYuQ0xFUktfU0VDUkVUX0tFWTtcbiAgaWYgKCFzZWNyZXRLZXkpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICBcIkNMRVJLX1NFQ1JFVF9LRVkgaXMgcmVxdWlyZWQgZm9yIHRoZSByZWxlYXNlLW9ubHkgcHJvZ3JhbW1hdGljIENsZXJrIGhhbmRvZmYuXCIsXG4gICAgKTtcbiAgfVxuXG4gIGNvbnN0IGhlYWRlcnMgPSB7XG4gICAgQXV0aG9yaXphdGlvbjogYEJlYXJlciAke3NlY3JldEtleX1gLFxuICAgIFwiQ29udGVudC1UeXBlXCI6IFwiYXBwbGljYXRpb24vanNvblwiLFxuICB9O1xuICBjb25zdCB1c2VyUmVzcG9uc2UgPSBhd2FpdCBwYWdlLnJlcXVlc3QuZ2V0KFxuICAgIGBodHRwczovL2FwaS5jbGVyay5jb20vdjEvdXNlcnM/ZW1haWxfYWRkcmVzcz0ke2VuY29kZVVSSUNvbXBvbmVudChURVNUX1VTRVIuZW1haWwpfWAsXG4gICAgeyBoZWFkZXJzIH0sXG4gICk7XG4gIGxldCB1c2VySWQgPSBwYXJzZUNsZXJrVXNlckxvb2t1cFJlc3BvbnNlKGF3YWl0IHVzZXJSZXNwb25zZS5qc29uKCkpO1xuXG4gIGlmICghdXNlcklkKSB7XG4gICAgY29uc3QgY3JlYXRlZFJlc3BvbnNlID0gYXdhaXQgcGFnZS5yZXF1ZXN0LnBvc3QoXG4gICAgICBcImh0dHBzOi8vYXBpLmNsZXJrLmNvbS92MS91c2Vyc1wiLFxuICAgICAge1xuICAgICAgICBoZWFkZXJzLFxuICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgZW1haWxfYWRkcmVzczogW1RFU1RfVVNFUi5lbWFpbF0sXG4gICAgICAgICAgZmlyc3RfbmFtZTogVEVTVF9VU0VSLmZpcnN0TmFtZSxcbiAgICAgICAgICBsYXN0X25hbWU6IFRFU1RfVVNFUi5sYXN0TmFtZSxcbiAgICAgICAgICBza2lwX3Bhc3N3b3JkX2NoZWNrczogdHJ1ZSxcbiAgICAgICAgICBza2lwX3Bhc3N3b3JkX3JlcXVpcmVtZW50OiB0cnVlLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICApO1xuICAgIHVzZXJJZCA9IHBhcnNlQ3JlYXRlZENsZXJrVXNlclJlc3BvbnNlKGF3YWl0IGNyZWF0ZWRSZXNwb25zZS5qc29uKCkpO1xuICB9XG5cbiAgaWYgKCF1c2VySWQpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICBcIlRoZSBpc29sYXRlZCBDbGVyayByZWxlYXNlIHVzZXIgY291bGQgbm90IGJlIHByb3Zpc2lvbmVkLlwiLFxuICAgICk7XG4gIH1cblxuICBjb25zdCB0b2tlblJlc3BvbnNlID0gYXdhaXQgcGFnZS5yZXF1ZXN0LnBvc3QoXG4gICAgXCJodHRwczovL2FwaS5jbGVyay5jb20vdjEvc2lnbl9pbl90b2tlbnNcIixcbiAgICB7IGhlYWRlcnMsIGRhdGE6IHsgdXNlcl9pZDogdXNlcklkIH0gfSxcbiAgKTtcbiAgY29uc3QgdG9rZW4gPSBwYXJzZUNsZXJrU2lnbkluVG9rZW5SZXNwb25zZShhd2FpdCB0b2tlblJlc3BvbnNlLmpzb24oKSk7XG5cbiAgcmV0dXJuIGAke25ldyBVUkwoREFTSEJPQVJEX1BBVEgsIHBhZ2UudXJsKCkpLnRvU3RyaW5nKCl9c2lnbi1pbj9fX2NsZXJrX3RpY2tldD0ke2VuY29kZVVSSUNvbXBvbmVudCh0b2tlbil9YDtcbn1cblxuYXN5bmMgZnVuY3Rpb24gcHJvZ3JhbW1hdGljU2lnbkluKHBhZ2U6IFBhZ2UpIHtcbiAgYXdhaXQgcGFnZS5nb3RvKERBU0hCT0FSRF9QQVRIKTtcbiAgYXdhaXQgZXhwZWN0KFxuICAgIHBhZ2UuZ2V0QnlSb2xlKFwibGlua1wiLCB7IG5hbWU6IFwiU2lnbiBJblwiLCBleGFjdDogdHJ1ZSB9KSxcbiAgKS50b0JlVmlzaWJsZSgpO1xuXG4gIGNvbnN0IGhlbHBlciA9XG4gICAgZ2xvYmFsVGhpcy5zaWduSW5DbGVya1VzZXIgPz9cbiAgICBnbG9iYWxUaGlzLl9fRU5HSU5FRVJJTkdPU19TSUdOX0lOX0NMRVJLX1VTRVJfXztcbiAgaWYgKCFoZWxwZXIpIHtcbiAgICBpZiAocHJvY2Vzcy5lbnYuUlVOX0NPTlRST0xMRURfUkVMRUFTRV9WQUxJREFUSU9OICE9PSBcIjFcIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICBcIkNsZXJrIGJyb3dzZXIgaGVscGVyIGlzIHVuYXZhaWxhYmxlLiBSdW4gdGhpcyBqb3VybmV5IGluIHRoZSBSZXBsaXQgYnJvd3NlciBydW5uZXIsIHdoaWNoIGluamVjdHMgc2lnbkluQ2xlcmtVc2VyLlwiLFxuICAgICAgKTtcbiAgICB9XG4gICAgYXdhaXQgcGFnZS5nb3RvKGF3YWl0IGNyZWF0ZVJlbGVhc2VTaWduSW5VcmwocGFnZSkpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlKS50b0hhdmVVUkwoXG4gICAgICBuZXcgUmVnRXhwKGAke0RBU0hCT0FSRF9QQVRILnJlcGxhY2VBbGwoXCIvXCIsIFwiXFxcXC9cIil9JGApLFxuICAgICk7XG4gICAgYXdhaXQgY29tcGxldGVSZWFkaW5lc3NIYW5kc2hha2UocGFnZSk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IHNpZ25JblVybCA9IGF3YWl0IGhlbHBlcih7XG4gICAgLi4uVEVTVF9VU0VSLFxuICAgIHR0bDogOTAwLFxuICAgIGJhc2VQYXRoOiBEQVNIQk9BUkRfUEFUSCxcbiAgfSk7XG4gIGF3YWl0IHBhZ2UuZ290byhzaWduSW5VcmwpO1xuICBhd2FpdCBleHBlY3QocGFnZSkudG9IYXZlVVJMKFxuICAgIG5ldyBSZWdFeHAoYCR7REFTSEJPQVJEX1BBVEgucmVwbGFjZUFsbChcIi9cIiwgXCJcXFxcL1wiKX0kYCksXG4gICk7XG4gIGF3YWl0IGNvbXBsZXRlUmVhZGluZXNzSGFuZHNoYWtlKHBhZ2UpO1xufVxuXG5hc3luYyBmdW5jdGlvbiBjb21wbGV0ZVJlYWRpbmVzc0hhbmRzaGFrZShwYWdlOiBQYWdlKTogUHJvbWlzZTx2b2lkPiB7XG4gIGNvbnN0IG1vZGUgPSBkYXNoYm9hcmRUZXN0TW9kZSgpO1xuICBpZiAoIVRFU1RfTU9ERVMuaGFzKG1vZGUpKSB7XG4gICAgYXdhaXQgd3JpdGVSZWFkaW5lc3NSZWNlaXB0KFwiYmxvY2tlZFwiLCB7XG4gICAgICBtb2RlOiB7IHN0YXR1czogXCJibG9ja2VkXCIsIHJlYXNvbjogXCJ1bnN1cHBvcnRlZF90ZXN0X21vZGVcIiB9LFxuICAgIH0pO1xuICAgIHRocm93IG5ldyBFcnJvcihgQkxPQ0tFRDogdW5zdXBwb3J0ZWQgZGFzaGJvYXJkIHRlc3QgbW9kZSAoJHttb2RlfSkuYCk7XG4gIH1cbiAgaWYgKG1vZGUgPT09IFwibGl2ZS1wcm92aWRlclwiKSB7XG4gICAgaWYgKHByb2Nlc3MuZW52LkRBU0hCT0FSRF9FMkVfTElWRV9QUk9WSURFUiAhPT0gXCIxXCIpIHtcbiAgICAgIGF3YWl0IHdyaXRlUmVhZGluZXNzUmVjZWlwdChcImJsb2NrZWRcIiwge1xuICAgICAgICBtb2RlOiB7IHN0YXR1czogXCJyZWFkeVwiIH0sXG4gICAgICAgIHByb3ZpZGVyOiB7IHN0YXR1czogXCJibG9ja2VkXCIsIHJlYXNvbjogXCJsaXZlX3Byb3ZpZGVyX25vdF9lbmFibGVkXCIgfSxcbiAgICAgIH0pO1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICBcIkJMT0NLRUQ6IGxpdmUtcHJvdmlkZXIgbW9kZSByZXF1aXJlcyBEQVNIQk9BUkRfRTJFX0xJVkVfUFJPVklERVI9MS5cIixcbiAgICAgICk7XG4gICAgfVxuICAgIGlmIChwcm9jZXNzLmVudi5EQVNIQk9BUkRfRTJFX0xJVkVfRElTUE9TQUJMRSAhPT0gXCIxXCIpIHtcbiAgICAgIGF3YWl0IHdyaXRlUmVhZGluZXNzUmVjZWlwdChcImJsb2NrZWRcIiwge1xuICAgICAgICBtb2RlOiB7IHN0YXR1czogXCJyZWFkeVwiIH0sXG4gICAgICAgIHByb3ZpZGVyOiB7IHN0YXR1czogXCJyZWFkeVwiIH0sXG4gICAgICAgIGRpc3Bvc2FibGVQcm9qZWN0OiB7XG4gICAgICAgICAgc3RhdHVzOiBcImJsb2NrZWRcIixcbiAgICAgICAgICByZWFzb246IFwiZGlzcG9zYWJsZV9wcm9qZWN0X3JlcXVpcmVkXCIsXG4gICAgICAgIH0sXG4gICAgICB9KTtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgXCJCTE9DS0VEOiBsaXZlLXByb3ZpZGVyIG1vZGUgcmVxdWlyZXMgYW4gZXhwbGljaXRseSBkaXNwb3NhYmxlIHByb2plY3QuXCIsXG4gICAgICApO1xuICAgIH1cbiAgfVxuXG4gIGNvbnN0IGRlYWRsaW5lID0gRGF0ZS5ub3coKSArIHJlYWRpbmVzc1RpbWVvdXRNcygpO1xuICBsZXQgbGFzdFN0YXR1cyA9IFwibm90IGF0dGVtcHRlZFwiO1xuICBjb25zdCBjaGVja3M6IFJlY29yZDxzdHJpbmcsIHVua25vd24+ID0ge1xuICAgIG1vZGU6IHsgc3RhdHVzOiBcInJlYWR5XCIgfSxcbiAgICBwcm92aWRlcjoge1xuICAgICAgc3RhdHVzOiBtb2RlID09PSBcImxpdmUtcHJvdmlkZXJcIiA/IFwicmVhZHlcIiA6IFwicmVhZHlcIixcbiAgICAgIC4uLihtb2RlID09PSBcImZpeHR1cmVcIiA/IHsgcmVhc29uOiBcInByb3ZpZGVyX2ZyZWVfZml4dHVyZVwiIH0gOiB7fSksXG4gICAgfSxcbiAgICBkaXNwb3NhYmxlUHJvamVjdDoge1xuICAgICAgc3RhdHVzOiBtb2RlID09PSBcImxpdmUtcHJvdmlkZXJcIiA/IFwicmVhZHlcIiA6IFwicmVhZHlcIixcbiAgICAgIC4uLihtb2RlID09PSBcImZpeHR1cmVcIiA/IHsgcmVhc29uOiBcImJyb3dzZXJfZml4dHVyZV9wcm9qZWN0XCIgfSA6IHt9KSxcbiAgICB9LFxuICB9O1xuICB3aGlsZSAoRGF0ZS5ub3coKSA8IGRlYWRsaW5lKSB7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IGV4cGVjdERhc2hib2FyZFJlYWR5KHBhZ2UpO1xuICAgICAgY29uc3QgcmVhZGluZXNzID0gYXdhaXQgcGFnZS5ldmFsdWF0ZShhc3luYyAodXJsKSA9PiB7XG4gICAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgZmV0Y2godXJsLCB7IGNyZWRlbnRpYWxzOiBcImluY2x1ZGVcIiB9KTtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBvazogcmVzcG9uc2Uub2ssXG4gICAgICAgICAgYm9keTogKGF3YWl0IHJlc3BvbnNlLmpzb24oKS5jYXRjaCgoKSA9PiAoe30pKSkgYXMge1xuICAgICAgICAgICAgc3RhdHVzPzogc3RyaW5nO1xuICAgICAgICAgICAgY2hlY2tzPzogUmVjb3JkPHN0cmluZywgeyBzdGF0dXM/OiBzdHJpbmcgfT47XG4gICAgICAgICAgfSxcbiAgICAgICAgfTtcbiAgICAgIH0sIG5ldyBVUkwoXCIvYXBpL3JlYWRpbmVzc1wiLCBwYWdlLnVybCgpKS50b1N0cmluZygpKTtcbiAgICAgIGNvbnN0IHJlYWRpbmVzc0JvZHkgPSByZWFkaW5lc3MuYm9keSBhcyB7XG4gICAgICAgIHN0YXR1cz86IHN0cmluZztcbiAgICAgICAgY2hlY2tzPzogUmVjb3JkPHN0cmluZywgeyBzdGF0dXM/OiBzdHJpbmcgfT47XG4gICAgICB9O1xuICAgICAgY2hlY2tzLmFwaSA9IHsgc3RhdHVzOiByZWFkaW5lc3Mub2sgPyBcInJlYWR5XCIgOiBcImJsb2NrZWRcIiB9O1xuICAgICAgY2hlY2tzLmRhdGFiYXNlID0gcmVhZGluZXNzQm9keS5jaGVja3M/LmRhdGFiYXNlID8/IHsgc3RhdHVzOiBcImJsb2NrZWRcIiB9O1xuICAgICAgY2hlY2tzLnNjaGVtYSA9IHJlYWRpbmVzc0JvZHkuY2hlY2tzPy5zY2hlbWEgPz8geyBzdGF0dXM6IFwiYmxvY2tlZFwiIH07XG4gICAgICBpZiAoXG4gICAgICAgIHJlYWRpbmVzcy5vayAmJlxuICAgICAgICByZWFkaW5lc3NCb2R5LnN0YXR1cyA9PT0gXCJyZWFkeVwiICYmXG4gICAgICAgIE9iamVjdC52YWx1ZXMocmVhZGluZXNzQm9keS5jaGVja3MgPz8ge30pLmV2ZXJ5KFxuICAgICAgICAgIChjaGVjaykgPT4gY2hlY2suc3RhdHVzID09PSBcInJlYWR5XCIsXG4gICAgICAgIClcbiAgICAgICkge1xuICAgICAgICBjb25zdCBwcm9qZWN0c1Jlc3VsdCA9IGF3YWl0IHBhZ2UuZXZhbHVhdGUoYXN5bmMgKHVybCkgPT4ge1xuICAgICAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgZmV0Y2godXJsLCB7IGNyZWRlbnRpYWxzOiBcImluY2x1ZGVcIiB9KTtcbiAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgb2s6IHJlc3BvbnNlLm9rLFxuICAgICAgICAgICAgYm9keTogKGF3YWl0IHJlc3BvbnNlLmpzb24oKS5jYXRjaCgoKSA9PiBbXSkpIGFzIEFycmF5PHtcbiAgICAgICAgICAgICAgaWQ/OiBzdHJpbmc7XG4gICAgICAgICAgICB9PixcbiAgICAgICAgICB9O1xuICAgICAgICB9LCBuZXcgVVJMKFwiL2FwaS9wcm9qZWN0c1wiLCBwYWdlLnVybCgpKS50b1N0cmluZygpKTtcbiAgICAgICAgY29uc3QgcHJvamVjdHMgPSBwcm9qZWN0c1Jlc3VsdC5ib2R5O1xuICAgICAgICBjb25zdCBleHBlY3RlZFByb2plY3QgPVxuICAgICAgICAgIG1vZGUgPT09IFwibGl2ZS1wcm92aWRlclwiXG4gICAgICAgICAgICA/IHByb2Nlc3MuZW52LkRBU0hCT0FSRF9FMkVfTElWRV9QUk9KRUNUX0lEXG4gICAgICAgICAgICA6IHVuZGVmaW5lZDtcbiAgICAgICAgY29uc3QgZml4dHVyZVByb2plY3RSZWFkeSA9XG4gICAgICAgICAgbW9kZSA9PT0gXCJmaXh0dXJlXCJcbiAgICAgICAgICAgID8gcHJvamVjdHMubGVuZ3RoID4gMCAmJiBwcm9qZWN0cy5ldmVyeSgocHJvamVjdCkgPT4gQm9vbGVhbihwcm9qZWN0LmlkKSlcbiAgICAgICAgICAgIDogcHJvamVjdHMuc29tZSgocHJvamVjdCkgPT4gcHJvamVjdC5pZCA9PT0gZXhwZWN0ZWRQcm9qZWN0KTtcbiAgICAgICAgaWYgKFxuICAgICAgICAgIHByb2plY3RzUmVzdWx0Lm9rICYmXG4gICAgICAgICAgQXJyYXkuaXNBcnJheShwcm9qZWN0cykgJiZcbiAgICAgICAgICBmaXh0dXJlUHJvamVjdFJlYWR5XG4gICAgICAgICkge1xuICAgICAgICAgIGNoZWNrcy5hdXRoID0geyBzdGF0dXM6IFwicmVhZHlcIiB9O1xuICAgICAgICAgIGNoZWNrcy5maXh0dXJlUHJvamVjdCA9IHtcbiAgICAgICAgICAgIHN0YXR1czogXCJyZWFkeVwiLFxuICAgICAgICAgICAgcHJvamVjdDogZXhwZWN0ZWRQcm9qZWN0ID8/IHByb2plY3RzWzBdPy5pZCxcbiAgICAgICAgICB9O1xuICAgICAgICAgIGF3YWl0IHdyaXRlUmVhZGluZXNzUmVjZWlwdChcInJlYWR5XCIsIGNoZWNrcyk7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGxhc3RTdGF0dXMgPSBcImZpeHR1cmUgcHJvamVjdCB1bmF2YWlsYWJsZVwiO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgbGFzdFN0YXR1cyA9XG4gICAgICAgICAgcmVhZGluZXNzQm9keS5jaGVja3MgJiZcbiAgICAgICAgICBPYmplY3QuZW50cmllcyhyZWFkaW5lc3NCb2R5LmNoZWNrcylcbiAgICAgICAgICAgIC5maWx0ZXIoKFssIGNoZWNrXSkgPT4gY2hlY2suc3RhdHVzICE9PSBcInJlYWR5XCIpXG4gICAgICAgICAgICAubWFwKChbbmFtZV0pID0+IG5hbWUpXG4gICAgICAgICAgICAuam9pbihcIiwgXCIpO1xuICAgICAgICBpZiAoIWxhc3RTdGF0dXMpIGxhc3RTdGF0dXMgPSBcInJlYWRpbmVzcyBibG9ja2VkXCI7XG4gICAgICB9XG4gICAgfSBjYXRjaCB7XG4gICAgICBsYXN0U3RhdHVzID0gXCJyZWFkaW5lc3MgcmVxdWVzdCBmYWlsZWRcIjtcbiAgICB9XG4gICAgYXdhaXQgbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHNldFRpbWVvdXQocmVzb2x2ZSwgMjUwKSk7XG4gIH1cbiAgYXdhaXQgd3JpdGVSZWFkaW5lc3NSZWNlaXB0KFwiYmxvY2tlZFwiLCBjaGVja3MsIGxhc3RTdGF0dXMpO1xuICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgYEJMT0NLRUQ6IGRhc2hib2FyZCByZWFkaW5lc3MgaGFuZHNoYWtlIGRpZCBub3QgY29tcGxldGUgKCR7bGFzdFN0YXR1c30pLmAsXG4gICk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIG9wZW5OYXZpZ2F0aW9uKHBhZ2U6IFBhZ2UsIGxhYmVsOiBzdHJpbmcsIHBhdGg6IHN0cmluZykge1xuICBhd2FpdCBwYWdlLmdldEJ5Um9sZShcImxpbmtcIiwgeyBuYW1lOiBsYWJlbCwgZXhhY3Q6IHRydWUgfSkuY2xpY2soKTtcbiAgYXdhaXQgZXhwZWN0KHBhZ2UpLnRvSGF2ZVVSTChuZXcgUmVnRXhwKGAke3BhdGgucmVwbGFjZUFsbChcIi9cIiwgXCJcXFxcL1wiKX0kYCkpO1xufVxuXG5mdW5jdGlvbiBhcGlVcmwocGFnZTogUGFnZSwgcGF0aDogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgYXBpQmFzZVVybCA9IHByb2Nlc3MuZW52LkRBU0hCT0FSRF9FMkVfQVBJX0JBU0VfVVJMO1xuICByZXR1cm4gbmV3IFVSTChwYXRoLCBhcGlCYXNlVXJsID8gYXBpQmFzZVVybCA6IHBhZ2UudXJsKCkpLnRvU3RyaW5nKCk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGxpdmVSZXF1ZXN0KFxuICBwYWdlOiBQYWdlLFxuICBwYXRoOiBzdHJpbmcsXG4gIG9wdGlvbnM/OiB7IG1ldGhvZD86IHN0cmluZzsgYm9keT86IHVua25vd247IHRpbWVvdXQ/OiBudW1iZXIgfSxcbik6IFByb21pc2U8eyBzdGF0dXM6IG51bWJlcjsgYm9keTogc3RyaW5nIH0+IHtcbiAgcmV0dXJuIHBhZ2UuZXZhbHVhdGUoXG4gICAgYXN5bmMgKHsgdXJsLCBtZXRob2QsIGJvZHksIHRpbWVvdXQgfSkgPT4ge1xuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBmZXRjaCh1cmwsIHtcbiAgICAgICAgbWV0aG9kLFxuICAgICAgICBjcmVkZW50aWFsczogXCJpbmNsdWRlXCIsXG4gICAgICAgIGhlYWRlcnM6XG4gICAgICAgICAgYm9keSA9PT0gdW5kZWZpbmVkXG4gICAgICAgICAgICA/IHVuZGVmaW5lZFxuICAgICAgICAgICAgOiB7IFwiQ29udGVudC1UeXBlXCI6IFwiYXBwbGljYXRpb24vanNvblwiIH0sXG4gICAgICAgIGJvZHk6IGJvZHkgPT09IHVuZGVmaW5lZCA/IHVuZGVmaW5lZCA6IEpTT04uc3RyaW5naWZ5KGJvZHkpLFxuICAgICAgICBzaWduYWw6IHRpbWVvdXQgPyBBYm9ydFNpZ25hbC50aW1lb3V0KHRpbWVvdXQpIDogdW5kZWZpbmVkLFxuICAgICAgfSk7XG4gICAgICByZXR1cm4geyBzdGF0dXM6IHJlc3BvbnNlLnN0YXR1cywgYm9keTogYXdhaXQgcmVzcG9uc2UudGV4dCgpIH07XG4gICAgfSxcbiAgICB7XG4gICAgICB1cmw6IGFwaVVybChwYWdlLCBwYXRoKSxcbiAgICAgIG1ldGhvZDogb3B0aW9ucz8ubWV0aG9kID8/IFwiR0VUXCIsXG4gICAgICBib2R5OiBvcHRpb25zPy5ib2R5LFxuICAgICAgdGltZW91dDogb3B0aW9ucz8udGltZW91dCxcbiAgICB9LFxuICApO1xufVxuXG50eXBlIE9yaWdpbkRpYWdub3N0aWMgPSB7XG4gIG9yaWdpbjogc3RyaW5nO1xuICBwaGFzZTogXCJHRVRcIiB8IFwicHJlZmxpZ2h0XCIgfCBcIm11dGF0aW9uXCIgfCBcInJlamVjdGlvblwiO1xuICBzdGF0dXM/OiBudW1iZXI7XG4gIGhlYWRlcnM/OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+O1xuICBlcnJvcj86IHN0cmluZztcbn07XG5jb25zdCByZWNvcmRlZE9yaWdpbkRpYWdub3N0aWNzOiBPcmlnaW5EaWFnbm9zdGljW10gPSBbXTtcblxuZnVuY3Rpb24gb3JpZ2luRGlhZ25vc3RpY1BhdGgoKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgcmV0dXJuIHByb2Nlc3MuZW52LkRBU0hCT0FSRF9FMkVfT1JJR0lOX0RJQUdOT1NUSUNTX1BBVEg7XG59XG5cbmZ1bmN0aW9uIHJlbGV2YW50T3JpZ2luSGVhZGVycyhcbiAgaGVhZGVyczogUmVjb3JkPHN0cmluZywgc3RyaW5nPixcbik6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4ge1xuICByZXR1cm4gT2JqZWN0LmZyb21FbnRyaWVzKFxuICAgIE9SSUdJTl9ESUFHTk9TVElDX0hFQURFUlMuZmxhdE1hcCgobmFtZSkgPT5cbiAgICAgIGhlYWRlcnNbbmFtZV0gPyBbW25hbWUsIGhlYWRlcnNbbmFtZV1dXSA6IFtdLFxuICAgICksXG4gICk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHdyaXRlT3JpZ2luRGlhZ25vc3RpY3MoKSB7XG4gIGNvbnN0IG91dHB1dFBhdGggPSBvcmlnaW5EaWFnbm9zdGljUGF0aCgpO1xuICBpZiAoIW91dHB1dFBhdGgpIHJldHVybjtcbiAgYXdhaXQgbWtkaXIoZGlybmFtZShvdXRwdXRQYXRoKSwgeyByZWN1cnNpdmU6IHRydWUgfSk7XG4gIGF3YWl0IHdyaXRlRmlsZShcbiAgICBvdXRwdXRQYXRoLFxuICAgIGAke0pTT04uc3RyaW5naWZ5KHsgZGlhZ25vc3RpY3M6IHJlY29yZGVkT3JpZ2luRGlhZ25vc3RpY3MgfSwgbnVsbCwgMil9XFxuYCxcbiAgICBcInV0ZjhcIixcbiAgKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZXhwZWN0T3JpZ2luQ2FuVXNlQXBpKHBhZ2U6IFBhZ2UsIG9yaWdpbjogc3RyaW5nKSB7XG4gIGNvbnN0IGFwaUJhc2VVcmwgPSBwcm9jZXNzLmVudi5EQVNIQk9BUkRfRTJFX0FQSV9CQVNFX1VSTDtcbiAgaWYgKCFhcGlCYXNlVXJsKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgXCJEQVNIQk9BUkRfRTJFX0FQSV9CQVNFX1VSTCBpcyByZXF1aXJlZCBmb3Igb3JpZ2luIGNoZWNrcy5cIixcbiAgICApO1xuICB9XG4gIGNvbnN0IGhlYWx0aFVybCA9IG5ldyBVUkwoXCIvYXBpL2hlYWx0aHpcIiwgYXBpQmFzZVVybCkudG9TdHJpbmcoKTtcbiAgY29uc3QgbXV0YXRpb25VcmwgPSBuZXcgVVJMKFwiL2FwaS9haS9jaGF0XCIsIGFwaUJhc2VVcmwpLnRvU3RyaW5nKCk7XG4gIGNvbnN0IGNvbW1vbkhlYWRlcnMgPSB7IE9yaWdpbjogb3JpZ2luIH07XG5cbiAgY29uc3QgZGlhZ25vc3RpY3M6IE9yaWdpbkRpYWdub3N0aWNbXSA9IFtdO1xuICBjb25zdCBjaGVjayA9IGFzeW5jIChcbiAgICBwaGFzZTogT3JpZ2luRGlhZ25vc3RpY1tcInBoYXNlXCJdLFxuICAgIHJlcXVlc3Q6ICgpID0+IFByb21pc2U8aW1wb3J0KFwiQHBsYXl3cmlnaHQvdGVzdFwiKS5BUElSZXNwb25zZT4sXG4gICAgYXNzZXJ0aW9uOiAoXG4gICAgICByZXNwb25zZTogaW1wb3J0KFwiQHBsYXl3cmlnaHQvdGVzdFwiKS5BUElSZXNwb25zZSxcbiAgICApID0+IFByb21pc2U8dm9pZD4sXG4gICkgPT4ge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHJlcXVlc3QoKTtcbiAgICAgIGRpYWdub3N0aWNzLnB1c2goe1xuICAgICAgICBvcmlnaW4sXG4gICAgICAgIHBoYXNlLFxuICAgICAgICBzdGF0dXM6IHJlc3BvbnNlLnN0YXR1cygpLFxuICAgICAgICBoZWFkZXJzOiByZWxldmFudE9yaWdpbkhlYWRlcnMocmVzcG9uc2UuaGVhZGVycygpKSxcbiAgICAgIH0pO1xuICAgICAgcmVjb3JkZWRPcmlnaW5EaWFnbm9zdGljcy5wdXNoKGRpYWdub3N0aWNzLmF0KC0xKSEpO1xuICAgICAgYXdhaXQgYXNzZXJ0aW9uKHJlc3BvbnNlKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc3QgY3VycmVudCA9IGRpYWdub3N0aWNzLmF0KC0xKTtcbiAgICAgIGlmIChjdXJyZW50Py5waGFzZSAhPT0gcGhhc2UpIHtcbiAgICAgICAgZGlhZ25vc3RpY3MucHVzaCh7IG9yaWdpbiwgcGhhc2UgfSk7XG4gICAgICB9XG4gICAgICBkaWFnbm9zdGljcy5hdCgtMSkhLmVycm9yID0gXCJvcmlnaW4gY2hlY2sgZmFpbGVkXCI7XG4gICAgICBhd2FpdCB3cml0ZU9yaWdpbkRpYWdub3N0aWNzKCk7XG4gICAgICB0aHJvdyBlcnJvcjtcbiAgICB9XG4gIH07XG5cbiAgYXdhaXQgY2hlY2soXG4gICAgXCJHRVRcIixcbiAgICAoKSA9PiBwYWdlLnJlcXVlc3QuZ2V0KGhlYWx0aFVybCwgeyBoZWFkZXJzOiBjb21tb25IZWFkZXJzIH0pLFxuICAgIGFzeW5jIChyZXNwb25zZSkgPT4ge1xuICAgICAgZXhwZWN0KHJlc3BvbnNlLnN0YXR1cygpLCBgJHtvcmlnaW59IGNyZWRlbnRpYWxlZCBHRVQgc3RhdHVzYCkudG9CZSgyMDApO1xuICAgICAgZXhwZWN0KHJlc3BvbnNlLmhlYWRlcnMoKVtcImFjY2Vzcy1jb250cm9sLWFsbG93LW9yaWdpblwiXSkudG9CZShvcmlnaW4pO1xuICAgICAgZXhwZWN0KHJlc3BvbnNlLmhlYWRlcnMoKVtcImFjY2Vzcy1jb250cm9sLWFsbG93LWNyZWRlbnRpYWxzXCJdKS50b0JlKFxuICAgICAgICBcInRydWVcIixcbiAgICAgICk7XG4gICAgfSxcbiAgKTtcbiAgYXdhaXQgY2hlY2soXG4gICAgXCJwcmVmbGlnaHRcIixcbiAgICAoKSA9PlxuICAgICAgcGFnZS5yZXF1ZXN0LmZldGNoKG11dGF0aW9uVXJsLCB7XG4gICAgICAgIG1ldGhvZDogXCJPUFRJT05TXCIsXG4gICAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgICAuLi5jb21tb25IZWFkZXJzLFxuICAgICAgICAgIFwiQWNjZXNzLUNvbnRyb2wtUmVxdWVzdC1NZXRob2RcIjogXCJQT1NUXCIsXG4gICAgICAgICAgXCJBY2Nlc3MtQ29udHJvbC1SZXF1ZXN0LUhlYWRlcnNcIjogXCJjb250ZW50LXR5cGVcIixcbiAgICAgICAgfSxcbiAgICAgIH0pLFxuICAgIGFzeW5jIChyZXNwb25zZSkgPT4ge1xuICAgICAgZXhwZWN0KHJlc3BvbnNlLnN0YXR1cygpLCBgJHtvcmlnaW59IG11dGF0aW9uIHByZWZsaWdodCBzdGF0dXNgKS50b0JlKFxuICAgICAgICAyMDQsXG4gICAgICApO1xuICAgICAgZXhwZWN0KHJlc3BvbnNlLmhlYWRlcnMoKVtcImFjY2Vzcy1jb250cm9sLWFsbG93LW9yaWdpblwiXSkudG9CZShvcmlnaW4pO1xuICAgICAgZXhwZWN0KFxuICAgICAgICByZXNwb25zZS5oZWFkZXJzKClbXCJhY2Nlc3MtY29udHJvbC1hbGxvdy1jcmVkZW50aWFsc1wiXSxcbiAgICAgICAgYCR7b3JpZ2lufSBtdXRhdGlvbiBwcmVmbGlnaHQgY3JlZGVudGlhbHNgLFxuICAgICAgKS50b0JlKFwidHJ1ZVwiKTtcbiAgICAgIGV4cGVjdChcbiAgICAgICAgcmVzcG9uc2VcbiAgICAgICAgICAuaGVhZGVycygpXG4gICAgICAgICAgW1wiYWNjZXNzLWNvbnRyb2wtYWxsb3ctbWV0aG9kc1wiXT8uc3BsaXQoXCIsXCIpXG4gICAgICAgICAgLm1hcCgobWV0aG9kKSA9PiBtZXRob2QudHJpbSgpLnRvVXBwZXJDYXNlKCkpLFxuICAgICAgICBgJHtvcmlnaW59IG11dGF0aW9uIHByZWZsaWdodCBtZXRob2RzYCxcbiAgICAgICkudG9Db250YWluKFwiUE9TVFwiKTtcbiAgICAgIGV4cGVjdChcbiAgICAgICAgcmVzcG9uc2VcbiAgICAgICAgICAuaGVhZGVycygpXG4gICAgICAgICAgW1wiYWNjZXNzLWNvbnRyb2wtYWxsb3ctaGVhZGVyc1wiXT8uc3BsaXQoXCIsXCIpXG4gICAgICAgICAgLm1hcCgoaGVhZGVyKSA9PiBoZWFkZXIudHJpbSgpLnRvTG93ZXJDYXNlKCkpLFxuICAgICAgICBgJHtvcmlnaW59IG11dGF0aW9uIHByZWZsaWdodCBoZWFkZXJzYCxcbiAgICAgICkudG9Db250YWluKFwiY29udGVudC10eXBlXCIpO1xuICAgIH0sXG4gICk7XG4gIGF3YWl0IGNoZWNrKFxuICAgIFwibXV0YXRpb25cIixcbiAgICAoKSA9PlxuICAgICAgcGFnZS5yZXF1ZXN0LnBvc3QobXV0YXRpb25VcmwsIHtcbiAgICAgICAgaGVhZGVyczogeyAuLi5jb21tb25IZWFkZXJzLCBcIkNvbnRlbnQtVHlwZVwiOiBcImFwcGxpY2F0aW9uL2pzb25cIiB9LFxuICAgICAgICBkYXRhOiB7IG1lc3NhZ2U6IFwib3JpZ2luIGNvbnRyYWN0XCIgfSxcbiAgICAgIH0pLFxuICAgIGFzeW5jIChyZXNwb25zZSkgPT4ge1xuICAgICAgZXhwZWN0KFxuICAgICAgICByZXNwb25zZS5zdGF0dXMoKSxcbiAgICAgICAgYCR7b3JpZ2lufSBzdGF0ZS1jaGFuZ2luZyByZXF1ZXN0IG11c3QgcGFzcyBvcmlnaW4gcHJvdGVjdGlvbmAsXG4gICAgICApLm5vdC50b0JlKDQwMyk7XG4gICAgICBleHBlY3QocmVzcG9uc2UuaGVhZGVycygpW1wiYWNjZXNzLWNvbnRyb2wtYWxsb3ctb3JpZ2luXCJdKS50b0JlKG9yaWdpbik7XG4gICAgICBleHBlY3QocmVzcG9uc2UuaGVhZGVycygpW1wiYWNjZXNzLWNvbnRyb2wtYWxsb3ctY3JlZGVudGlhbHNcIl0pLnRvQmUoXG4gICAgICAgIFwidHJ1ZVwiLFxuICAgICAgKTtcbiAgICB9LFxuICApO1xuICBhd2FpdCB3cml0ZU9yaWdpbkRpYWdub3N0aWNzKCk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGV4cGVjdEhvc3RpbGVPcmlnaW5SZWplY3RlZChwYWdlOiBQYWdlKSB7XG4gIGNvbnN0IGFwaUJhc2VVcmwgPSBwcm9jZXNzLmVudi5EQVNIQk9BUkRfRTJFX0FQSV9CQVNFX1VSTDtcbiAgaWYgKCFhcGlCYXNlVXJsKVxuICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgIFwiREFTSEJPQVJEX0UyRV9BUElfQkFTRV9VUkwgaXMgcmVxdWlyZWQgZm9yIG9yaWdpbiBjaGVja3MuXCIsXG4gICAgKTtcbiAgY29uc3QgbXV0YXRpb25VcmwgPSBuZXcgVVJMKFwiL2FwaS9haS9jaGF0XCIsIGFwaUJhc2VVcmwpLnRvU3RyaW5nKCk7XG4gIGNvbnN0IHVwbG9hZFVybCA9IG5ldyBVUkwoXCIvYXBpL3VwbG9hZC9hcmNoaXZlXCIsIGFwaUJhc2VVcmwpLnRvU3RyaW5nKCk7XG4gIGNvbnN0IGxpdmVVcGRhdGVVcmwgPSBuZXcgVVJMKFwiL2FwaS9haS9jaGF0L3N0cmVhbVwiLCBhcGlCYXNlVXJsKS50b1N0cmluZygpO1xuICBjb25zdCBkaWFnbm9zdGljOiBPcmlnaW5EaWFnbm9zdGljID0ge1xuICAgIG9yaWdpbjogSE9TVElMRV9PUklHSU4sXG4gICAgcGhhc2U6IFwicmVqZWN0aW9uXCIsXG4gIH07XG4gIHJlY29yZGVkT3JpZ2luRGlhZ25vc3RpY3MucHVzaChkaWFnbm9zdGljKTtcbiAgdHJ5IHtcbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHBhZ2UucmVxdWVzdC5wb3N0KG11dGF0aW9uVXJsLCB7XG4gICAgICBoZWFkZXJzOiB7XG4gICAgICAgIE9yaWdpbjogSE9TVElMRV9PUklHSU4sXG4gICAgICAgIFwiQ29udGVudC1UeXBlXCI6IFwiYXBwbGljYXRpb24vanNvblwiLFxuICAgICAgfSxcbiAgICAgIGRhdGE6IHsgbWVzc2FnZTogXCJob3N0aWxlIG9yaWdpbiBjb250cmFjdFwiIH0sXG4gICAgfSk7XG4gICAgZGlhZ25vc3RpYy5zdGF0dXMgPSByZXNwb25zZS5zdGF0dXMoKTtcbiAgICBkaWFnbm9zdGljLmhlYWRlcnMgPSByZWxldmFudE9yaWdpbkhlYWRlcnMocmVzcG9uc2UuaGVhZGVycygpKTtcbiAgICBleHBlY3QocmVzcG9uc2Uuc3RhdHVzKCkpLnRvQmUoNDAzKTtcbiAgICBleHBlY3QocmVzcG9uc2UuaGVhZGVycygpW1wiYWNjZXNzLWNvbnRyb2wtYWxsb3ctb3JpZ2luXCJdKS50b0JlVW5kZWZpbmVkKCk7XG4gICAgZXhwZWN0KFxuICAgICAgcmVzcG9uc2UuaGVhZGVycygpW1wiYWNjZXNzLWNvbnRyb2wtYWxsb3ctY3JlZGVudGlhbHNcIl0sXG4gICAgKS50b0JlVW5kZWZpbmVkKCk7XG5cbiAgICBjb25zdCBob3N0aWxlVXBsb2FkID0gYXdhaXQgcGFnZS5yZXF1ZXN0LnBvc3QodXBsb2FkVXJsLCB7XG4gICAgICBoZWFkZXJzOiB7IE9yaWdpbjogSE9TVElMRV9PUklHSU4gfSxcbiAgICAgIG11bHRpcGFydDoge1xuICAgICAgICBhcmNoaXZlOiB7XG4gICAgICAgICAgbmFtZTogXCJob3N0aWxlLWRhc2hib2FyZC1qb3VybmV5LnppcFwiLFxuICAgICAgICAgIG1pbWVUeXBlOiBcImFwcGxpY2F0aW9uL3ppcFwiLFxuICAgICAgICAgIGJ1ZmZlcjogQnVmZmVyLmZyb20oXCJub3QgYW4gYXJjaGl2ZVwiKSxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgfSk7XG4gICAgZXhwZWN0KGhvc3RpbGVVcGxvYWQuc3RhdHVzKCkpLnRvQmUoNDAzKTtcbiAgICBleHBlY3QoXG4gICAgICBob3N0aWxlVXBsb2FkLmhlYWRlcnMoKVtcImFjY2Vzcy1jb250cm9sLWFsbG93LW9yaWdpblwiXSxcbiAgICApLnRvQmVVbmRlZmluZWQoKTtcblxuICAgIGNvbnN0IGhvc3RpbGVMaXZlVXBkYXRlID0gYXdhaXQgcGFnZS5yZXF1ZXN0LnBvc3QobGl2ZVVwZGF0ZVVybCwge1xuICAgICAgaGVhZGVyczoge1xuICAgICAgICBPcmlnaW46IEhPU1RJTEVfT1JJR0lOLFxuICAgICAgICBcIkNvbnRlbnQtVHlwZVwiOiBcImFwcGxpY2F0aW9uL2pzb25cIixcbiAgICAgIH0sXG4gICAgICBkYXRhOiB7fSxcbiAgICB9KTtcbiAgICBleHBlY3QoaG9zdGlsZUxpdmVVcGRhdGUuc3RhdHVzKCkpLnRvQmUoNDAzKTtcbiAgICBleHBlY3QoXG4gICAgICBob3N0aWxlTGl2ZVVwZGF0ZS5oZWFkZXJzKClbXCJhY2Nlc3MtY29udHJvbC1hbGxvdy1vcmlnaW5cIl0sXG4gICAgKS50b0JlVW5kZWZpbmVkKCk7XG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgZGlhZ25vc3RpYy5lcnJvciA9IFwib3JpZ2luIHJlamVjdGlvbiBjaGVjayBmYWlsZWRcIjtcbiAgICBhd2FpdCB3cml0ZU9yaWdpbkRpYWdub3N0aWNzKCk7XG4gICAgdGhyb3cgZXJyb3I7XG4gIH1cbiAgYXdhaXQgd3JpdGVPcmlnaW5EaWFnbm9zdGljcygpO1xufVxuXG5mdW5jdGlvbiBwYXJzZVNzZShib2R5OiBzdHJpbmcpOiBBcnJheTxSZWNvcmQ8c3RyaW5nLCB1bmtub3duPj4ge1xuICByZXR1cm4gYm9keS5zcGxpdCgvXFxuXFxuKy8pLmZsYXRNYXAoKGNodW5rKSA9PiB7XG4gICAgY29uc3QgZGF0YSA9IGNodW5rXG4gICAgICAuc3BsaXQoXCJcXG5cIilcbiAgICAgIC5maW5kKChsaW5lKSA9PiBsaW5lLnN0YXJ0c1dpdGgoXCJkYXRhOiBcIikpXG4gICAgICA/LnNsaWNlKFwiZGF0YTogXCIubGVuZ3RoKTtcbiAgICBpZiAoIWRhdGEpIHJldHVybiBbXTtcbiAgICB0cnkge1xuICAgICAgY29uc3QgdmFsdWUgPSBKU09OLnBhcnNlKGRhdGEpIGFzIHVua25vd247XG4gICAgICByZXR1cm4gdmFsdWUgJiYgdHlwZW9mIHZhbHVlID09PSBcIm9iamVjdFwiXG4gICAgICAgID8gW3ZhbHVlIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+XVxuICAgICAgICA6IFtdO1xuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuIFtdO1xuICAgIH1cbiAgfSk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGxpdmVKc29uKFxuICBwYWdlOiBQYWdlLFxuICBwYXRoOiBzdHJpbmcsXG4pOiBQcm9taXNlPFJlY29yZDxzdHJpbmcsIGFueT4+IHtcbiAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBsaXZlUmVxdWVzdChwYWdlLCBwYXRoKTtcbiAgaWYgKHJlc3BvbnNlLnN0YXR1cyA8IDIwMCB8fCByZXNwb25zZS5zdGF0dXMgPj0gMzAwKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgYExpdmUgY29ycmVsYXRpb24gcmVxdWVzdCBmYWlsZWQ6ICR7cGF0aH0gKCR7cmVzcG9uc2Uuc3RhdHVzfSlgLFxuICAgICk7XG4gIH1cbiAgcmV0dXJuIEpTT04ucGFyc2UocmVzcG9uc2UuYm9keSkgYXMgUmVjb3JkPHN0cmluZywgYW55Pjtcbn1cblxuYXN5bmMgZnVuY3Rpb24gbGl2ZUFycmF5KFxuICBwYWdlOiBQYWdlLFxuICBwYXRoOiBzdHJpbmcsXG4pOiBQcm9taXNlPEFycmF5PFJlY29yZDxzdHJpbmcsIGFueT4+PiB7XG4gIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgbGl2ZVJlcXVlc3QocGFnZSwgcGF0aCk7XG4gIGlmIChyZXNwb25zZS5zdGF0dXMgPT09IDQwNCkgcmV0dXJuIFtdO1xuICBpZiAocmVzcG9uc2Uuc3RhdHVzIDwgMjAwIHx8IHJlc3BvbnNlLnN0YXR1cyA+PSAzMDApIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICBgTGl2ZSBjb3JyZWxhdGlvbiByZXF1ZXN0IGZhaWxlZDogJHtwYXRofSAoJHtyZXNwb25zZS5zdGF0dXN9KWAsXG4gICAgKTtcbiAgfVxuICBjb25zdCB2YWx1ZSA9IEpTT04ucGFyc2UocmVzcG9uc2UuYm9keSk7XG4gIHJldHVybiBBcnJheS5pc0FycmF5KHZhbHVlKSA/IHZhbHVlIDogW107XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGxpdmVPcHRpb25hbFJlY29yZChcbiAgcGFnZTogUGFnZSxcbiAgcGF0aDogc3RyaW5nLFxuKTogUHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBhbnk+IHwgdW5kZWZpbmVkPiB7XG4gIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgbGl2ZVJlcXVlc3QocGFnZSwgcGF0aCk7XG4gIGlmIChyZXNwb25zZS5zdGF0dXMgPT09IDQwNCkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgaWYgKHJlc3BvbnNlLnN0YXR1cyA8IDIwMCB8fCByZXNwb25zZS5zdGF0dXMgPj0gMzAwKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgYExpdmUgY29ycmVsYXRpb24gcmVxdWVzdCBmYWlsZWQ6ICR7cGF0aH0gKCR7cmVzcG9uc2Uuc3RhdHVzfSlgLFxuICAgICk7XG4gIH1cbiAgY29uc3QgdmFsdWUgPSBKU09OLnBhcnNlKHJlc3BvbnNlLmJvZHkpO1xuICByZXR1cm4gdmFsdWUgJiYgdHlwZW9mIHZhbHVlID09PSBcIm9iamVjdFwiICYmICFBcnJheS5pc0FycmF5KHZhbHVlKVxuICAgID8gKHZhbHVlIGFzIFJlY29yZDxzdHJpbmcsIGFueT4pXG4gICAgOiB1bmRlZmluZWQ7XG59XG5cbnRlc3QuZGVzY3JpYmUoXCJFbmdpbmVlcmluZ09TIGRhc2hib2FyZCBicm93c2VyIGpvdXJuZXlcIiwgKCkgPT4ge1xuICB0ZXN0KFwiZXhwb3J0cyBvbmUgcmVkYWN0ZWQgbGl2ZS1wcm92aWRlciBtaXNzaW9uIGNvcnJlbGF0aW9uIHJlcG9ydFwiLCBhc3luYyAoe1xuICAgIHBhZ2UsXG4gIH0pID0+IHtcbiAgICAvLyBUaGUgUGxheXdyaWdodCBkZWFkbGluZSBtdXN0IGxlYXZlIHJvb20gZm9yIHRoZSBwcm92aWRlci1ib3VuZCByZXF1ZXN0XG4gICAgLy8gYW5kIHBvbGxpbmcgbG9vcCB0byBjb25zdW1lIHRoZWlyIGNvbXBsZXRlIGNvbmZpZ3VyZWQgYnVkZ2V0LlxuICAgIHRlc3Quc2V0VGltZW91dChsaXZlVGltZW91dE1zKCkgKyBMSVZFX1RFU1RfVElNRU9VVF9NQVJHSU5fTVMpO1xuICAgIHRlc3Quc2tpcChcbiAgICAgIHByb2Nlc3MuZW52LkRBU0hCT0FSRF9FMkVfTElWRV9QUk9WSURFUiAhPT0gXCIxXCIsXG4gICAgICBcIkxpdmUtcHJvdmlkZXIgcmVsZWFzZSBqb3VybmV5IGlzIG9wdC1pbi5cIixcbiAgICApO1xuICAgIGlmIChwcm9jZXNzLmVudi5EQVNIQk9BUkRfRTJFX0xJVkVfRElTUE9TQUJMRSAhPT0gXCIxXCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgXCJMaXZlLXByb3ZpZGVyIGpvdXJuZXkgcmVxdWlyZXMgREFTSEJPQVJEX0UyRV9MSVZFX0RJU1BPU0FCTEU9MSBhbmQgYSBkaXNwb3NhYmxlIHByb2plY3QuXCIsXG4gICAgICApO1xuICAgIH1cbiAgICBjb25zdCBjYW1wYWlnblNjZW5hcmlvID0gbGl2ZUNhbXBhaWduU2NlbmFyaW8oKTtcbiAgICBjb25zdCBwcm9qZWN0SWQgPSBwcm9jZXNzLmVudi5EQVNIQk9BUkRfRTJFX0xJVkVfUFJPSkVDVF9JRDtcbiAgICBpZiAoIXByb2plY3RJZClcbiAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgXCJEQVNIQk9BUkRfRTJFX0xJVkVfUFJPSkVDVF9JRCBpcyByZXF1aXJlZCBmb3IgdGhlIGxpdmUtcHJvdmlkZXIgam91cm5leS5cIixcbiAgICAgICk7XG5cbiAgICBhd2FpdCBwcm9ncmFtbWF0aWNTaWduSW4ocGFnZSk7XG4gICAgY29uc3Qgc3RyZWFtUmVzcG9uc2UgPSBhd2FpdCBsaXZlUmVxdWVzdChwYWdlLCBcIi9hcGkvYWkvY2hhdC9zdHJlYW1cIiwge1xuICAgICAgbWV0aG9kOiBcIlBPU1RcIixcbiAgICAgIHRpbWVvdXQ6IGxpdmVUaW1lb3V0TXMoKSxcbiAgICAgIGJvZHk6IHtcbiAgICAgICAgcHJvamVjdElkLFxuICAgICAgICAgbWVzc2FnZTogbGl2ZVByb21wdCgpLFxuICAgICAgICBpZGVtcG90ZW5jeUtleTogYGRhc2hib2FyZC1saXZlLSR7RGF0ZS5ub3coKX1gLFxuICAgICAgfSxcbiAgICB9KTtcbiAgICBpZiAoc3RyZWFtUmVzcG9uc2Uuc3RhdHVzIDwgMjAwIHx8IHN0cmVhbVJlc3BvbnNlLnN0YXR1cyA+PSAzMDApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgYExpdmUtcHJvdmlkZXIgbWlzc2lvbiBmYWlsZWQgdG8gc3RhcnQgKCR7c3RyZWFtUmVzcG9uc2Uuc3RhdHVzfSkuYCxcbiAgICAgICk7XG4gICAgfVxuICAgIGNvbnN0IHNzZUV2ZW50cyA9IHBhcnNlU3NlKHN0cmVhbVJlc3BvbnNlLmJvZHkpO1xuICAgIGNvbnN0IHN0YXJ0ZWQgPSBzc2VFdmVudHMuZmluZChcbiAgICAgIChldmVudCkgPT4gZXZlbnQudHlwZSA9PT0gXCJleGVjdXRpb25fc3RhcnRlZFwiLFxuICAgICk7XG4gICAgY29uc3QgZXhlY3V0aW9uSWQgPVxuICAgICAgdHlwZW9mIHN0YXJ0ZWQ/LmV4ZWN1dGlvbklkID09PSBcInN0cmluZ1wiXG4gICAgICAgID8gc3RhcnRlZC5leGVjdXRpb25JZFxuICAgICAgICA6IHVuZGVmaW5lZDtcbiAgICBpZiAoIWV4ZWN1dGlvbklkKVxuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiTGl2ZS1wcm92aWRlciBzdHJlYW0gZGlkIG5vdCBlbWl0IGV4ZWN1dGlvbl9zdGFydGVkLlwiKTtcblxuICAgIGxldCBleGVjdXRpb246IFJlY29yZDxzdHJpbmcsIGFueT4gPSB7fTtcbiAgICBjb25zdCBkZWFkbGluZSA9IERhdGUubm93KCkgKyBsaXZlVGltZW91dE1zKCk7XG4gICAgd2hpbGUgKERhdGUubm93KCkgPCBkZWFkbGluZSkge1xuICAgICAgZXhlY3V0aW9uID0gYXdhaXQgbGl2ZUpzb24ocGFnZSwgYC9hcGkvYWkvZXhlY3V0aW9ucy8ke2V4ZWN1dGlvbklkfWApO1xuICAgICAgaWYgKFxuICAgICAgICBbXCJjb21wbGV0ZWRcIiwgXCJmYWlsZWRcIiwgXCJjYW5jZWxsZWRcIl0uaW5jbHVkZXMoU3RyaW5nKGV4ZWN1dGlvbi5zdGF0dXMpKVxuICAgICAgKVxuICAgICAgICBicmVhaztcbiAgICAgIGF3YWl0IG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiBzZXRUaW1lb3V0KHJlc29sdmUsIDc1MCkpO1xuICAgIH1cbiAgICBpZiAoXG4gICAgICAhW1wiY29tcGxldGVkXCIsIFwiZmFpbGVkXCIsIFwiY2FuY2VsbGVkXCJdLmluY2x1ZGVzKFN0cmluZyhleGVjdXRpb24uc3RhdHVzKSlcbiAgICApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgXCJMaXZlLXByb3ZpZGVyIG1pc3Npb24gZGlkIG5vdCByZWFjaCBhIHRlcm1pbmFsIHN0YXRlIHdpdGhpbiBpdHMgYm91bmQuXCIsXG4gICAgICApO1xuICAgIH1cblxuICAgIGNvbnN0IHNlc3Npb25JZCA9IFN0cmluZyhleGVjdXRpb24uc2Vzc2lvbklkKTtcbiAgICBjb25zdCBtZXNzYWdlcyA9IGF3YWl0IGxpdmVBcnJheShcbiAgICAgIHBhZ2UsXG4gICAgICBgL2FwaS9haS9jaGF0LyR7c2Vzc2lvbklkfS9tZXNzYWdlc2AsXG4gICAgKTtcbiAgICBjb25zdCBldmVudHMgPSBhd2FpdCBsaXZlQXJyYXkoXG4gICAgICBwYWdlLFxuICAgICAgYC9hcGkvZXZlbnRzP3Byb2plY3RJZD0ke2VuY29kZVVSSUNvbXBvbmVudChwcm9qZWN0SWQpfSZjb3JyZWxhdGlvbklkPSR7ZW5jb2RlVVJJQ29tcG9uZW50KFN0cmluZyhleGVjdXRpb24ub3BlcmF0aW9uSWQgPz8gXCJcIikpfWAsXG4gICAgKTtcbiAgICBjb25zdCBwcm9wb3NhbCA9IGF3YWl0IGxpdmVPcHRpb25hbFJlY29yZChcbiAgICAgIHBhZ2UsXG4gICAgICBgL2FwaS9haS9jaGF0LyR7c2Vzc2lvbklkfS9wZW5kaW5nLXByb3Bvc2FsYCxcbiAgICApO1xuICAgIGNvbnN0IGdpdExvZyA9IGF3YWl0IGxpdmVKc29uKHBhZ2UsIGAvYXBpL3Byb2plY3RzLyR7cHJvamVjdElkfS9naXQvbG9nYCk7XG4gICAgY29uc3QgbWlzc2lvbkNvbnRyb2wgPSBhd2FpdCBsaXZlSnNvbihwYWdlLCBcIi9hcGkvYWkvbWlzc2lvbi1jb250cm9sXCIpO1xuICAgIGNvbnN0IGRhc2hib2FyZFN0YXRlID0gYXdhaXQgbGl2ZUpzb24ocGFnZSwgXCIvYXBpL2Rhc2hib2FyZFwiKTtcbiAgICBjb25zdCBjaGVja3BvaW50ID1cbiAgICAgIGV4ZWN1dGlvbi5jaGVja3BvaW50ICYmIHR5cGVvZiBleGVjdXRpb24uY2hlY2twb2ludCA9PT0gXCJvYmplY3RcIlxuICAgICAgICA/IChleGVjdXRpb24uY2hlY2twb2ludCBhcyBSZWNvcmQ8c3RyaW5nLCBhbnk+KVxuICAgICAgICA6IHt9O1xuICAgIGNvbnN0IHJlY2VudFN0ZXBzID0gQXJyYXkuaXNBcnJheShjaGVja3BvaW50LnJlY2VudFN0ZXBzKVxuICAgICAgPyBjaGVja3BvaW50LnJlY2VudFN0ZXBzXG4gICAgICA6IFtdO1xuICAgIGNvbnN0IHZhbGlkYXRpb24gPSByZWNlbnRTdGVwcy5maWx0ZXIoXG4gICAgICAoc3RlcCkgPT4gc3RlcD8ua2luZCA9PT0gXCJ2YWxpZGF0aW9uXCIsXG4gICAgKTtcbiAgICBjb25zdCBwcm9qZWN0UmV2aXNpb24gPVxuICAgICAgdHlwZW9mIGV4ZWN1dGlvbi5wcm9qZWN0UmV2aXNpb24gPT09IFwic3RyaW5nXCJcbiAgICAgICAgPyBleGVjdXRpb24ucHJvamVjdFJldmlzaW9uXG4gICAgICAgIDogdW5kZWZpbmVkO1xuICAgIGNvbnN0IGNhbmRpZGF0ZUhhc2ggPSB2YWxpZGF0aW9uXG4gICAgICAubWFwKChzdGVwKSA9PiBzdGVwPy52YWxpZGF0aW9uPy5jYW5kaWRhdGVIYXNoID8/IHN0ZXA/LmNhbmRpZGF0ZUhhc2gpXG4gICAgICAuZmluZCgodmFsdWUpOiB2YWx1ZSBpcyBzdHJpbmcgPT4gdHlwZW9mIHZhbHVlID09PSBcInN0cmluZ1wiICYmIHZhbHVlLmxlbmd0aCA+IDApO1xuICAgIGNvbnN0IGNhbmRpZGF0ZUlkZW50aXR5ID1cbiAgICAgIHR5cGVvZiBleGVjdXRpb24uY2FuZGlkYXRlSWRlbnRpdHkgPT09IFwic3RyaW5nXCJcbiAgICAgICAgPyBleGVjdXRpb24uY2FuZGlkYXRlSWRlbnRpdHlcbiAgICAgICAgOiBjYW5kaWRhdGVIYXNoXG4gICAgICAgICAgPyBgY2FuZGlkYXRlOiR7Y2FuZGlkYXRlSGFzaH1gXG4gICAgICAgICAgOiBgcmVhZC1vbmx5OiR7cHJvamVjdFJldmlzaW9uID8/IFwidW5rbm93blwifWA7XG4gICAgaWYgKCFwcm9qZWN0UmV2aXNpb24pIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkxpdmUtcHJvdmlkZXIgbWlzc2lvbiBpcyBtaXNzaW5nIGl0cyBwcm9qZWN0IHJldmlzaW9uLlwiKTtcbiAgICB9XG4gICAgaWYgKFxuICAgICAgcHJvY2Vzcy5lbnYuREFTSEJPQVJEX0UyRV9MSVZFX0NBTVBBSUdOID09PSBcIjFcIiAmJlxuICAgICAgKCFjYW5kaWRhdGVJZGVudGl0eSB8fCAhcHJvamVjdFJldmlzaW9uKVxuICAgICkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiTGl2ZSBjYW1wYWlnbiByZXF1aXJlcyBvcGVyYXRpb24sIHJldmlzaW9uLCBhbmQgY2FuZGlkYXRlIGNvcnJlbGF0aW9uLlwiKTtcbiAgICB9XG4gICAgY29uc3QgZXZpZGVuY2VDb3VudCA9IHJlY2VudFN0ZXBzLnJlZHVjZShcbiAgICAgIChjb3VudCwgc3RlcCkgPT4gY291bnQgKyAoTnVtYmVyKHN0ZXA/LmFjY2VwdGVkRXZpZGVuY2VDb3VudCkgfHwgMCksXG4gICAgICAwLFxuICAgICk7XG4gICAgY29uc3QgdGVybWluYWxTdGF0ZSA9IFN0cmluZyhcbiAgICAgIGV4ZWN1dGlvbi5mbGlnaHRTdGF0ZSA/PyBleGVjdXRpb24uc3RhdHVzLFxuICAgICkudG9VcHBlckNhc2UoKTtcbiAgICBjb25zdCBzdWNjZXNzU3RhdGVzID0gbmV3IFNldChbXG4gICAgICBcIkNPTVBMRVRFRFwiLFxuICAgICAgXCJSRUFEWV9GT1JfUkVWSUVXXCIsXG4gICAgICBcIkFQUExJRURcIixcbiAgICAgIFwiQ09NTUlUVEVEXCIsXG4gICAgICBcIlBVU0hFRFwiLFxuICAgIF0pO1xuICAgIGlmIChcbiAgICAgIGNhbXBhaWduU2NlbmFyaW8gPT09IFwiZGVsaXZlcnktc3VjY2Vzc1wiICYmXG4gICAgICBzdWNjZXNzU3RhdGVzLmhhcyh0ZXJtaW5hbFN0YXRlKSAmJlxuICAgICAgIWNhbmRpZGF0ZUhhc2hcbiAgICApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgXCJEZWxpdmVyeS1zdWNjZXNzIGNhbXBhaWduIGNhbm5vdCBwYXNzIHdpdGhvdXQgYSBjYW5kaWRhdGUtYm91bmQgdmFsaWRhdGlvbiBoYXNoLlwiLFxuICAgICAgKTtcbiAgICB9XG4gICAgY29uc3QgZGVsaXZlcnlTdGFnZXMgPSB7XG4gICAgICBhcHBsaWVkOiBldmVudHMuc29tZSgoZXZlbnQpID0+IGV2ZW50Py50eXBlID09PSBcIkFpQ2hhbmdlc0FwcGxpZWRcIiksXG4gICAgICBjb21taXR0ZWQ6IGV2ZW50cy5zb21lKChldmVudCkgPT4gZXZlbnQ/LnR5cGUgPT09IFwiR2l0Q29tbWl0Q3JlYXRlZFwiKSxcbiAgICAgIHB1c2hlZDogZXZlbnRzLnNvbWUoKGV2ZW50KSA9PiBldmVudD8udHlwZSA9PT0gXCJHaXRQdXNoZWRcIiksXG4gICAgfTtcbiAgICBpZiAoXG4gICAgICBjYW1wYWlnblNjZW5hcmlvID09PSBcImRlbGl2ZXJ5LXN1Y2Nlc3NcIiAmJlxuICAgICAgc3VjY2Vzc1N0YXRlcy5oYXModGVybWluYWxTdGF0ZSkgJiZcbiAgICAgICFPYmplY3QudmFsdWVzKGRlbGl2ZXJ5U3RhZ2VzKS5ldmVyeShCb29sZWFuKVxuICAgICkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICBcIkRlbGl2ZXJ5LXN1Y2Nlc3MgY2FtcGFpZ24gY2Fubm90IHBhc3Mgd2l0aG91dCBvcGVyYXRpb24tY29ycmVsYXRlZCBhcHBseSwgY29tbWl0LCBhbmQgcHVzaCBldmlkZW5jZS5cIixcbiAgICAgICk7XG4gICAgfVxuICAgIGlmIChcbiAgICAgIHN1Y2Nlc3NTdGF0ZXMuaGFzKHRlcm1pbmFsU3RhdGUpICYmXG4gICAgICAoZXZpZGVuY2VDb3VudCA8IDEgfHwgdmFsaWRhdGlvbi5sZW5ndGggPCAxKVxuICAgICkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICBgTGl2ZS1wcm92aWRlciBtaXNzaW9uIHJlcG9ydGVkICR7dGVybWluYWxTdGF0ZX0gd2l0aG91dCBhY2NlcHRlZCBldmlkZW5jZSBhbmQgdmFsaWRhdGlvbiBgICtcbiAgICAgICAgICBgKGV2aWRlbmNlPSR7ZXZpZGVuY2VDb3VudH0sIHZhbGlkYXRpb249JHt2YWxpZGF0aW9uLmxlbmd0aH0pLmAsXG4gICAgICApO1xuICAgIH1cbiAgICBjb25zdCBjYXB0dXJlID0ge1xuICAgICAgcHJvamVjdElkLFxuICAgICAgc2Vzc2lvbklkLFxuICAgICAgb3BlcmF0aW9uSWQ6IGV4ZWN1dGlvbi5vcGVyYXRpb25JZCxcbiAgICAgIHdvcmtzcGFjZVJldmlzaW9uOlxuICAgICAgICBnaXRMb2cuY29tbWl0cz8uWzBdPy5zaG9ydEhhc2ggPz9cbiAgICAgICAgZ2l0TG9nLmNvbW1pdHM/LlswXT8uaGFzaD8uc2xpY2UoMCwgMTIpLFxuICAgICAgcHJvamVjdFJldmlzaW9uLFxuICAgICAgY2FuZGlkYXRlSWRlbnRpdHksXG4gICAgICBjYW5kaWRhdGVSZXZpc2lvbjogcHJvamVjdFJldmlzaW9uLFxuICAgICAgY2FtcGFpZ25TY2VuYXJpbyxcbiAgICAgIGRlbGl2ZXJ5U3RhZ2VzLFxuICAgICAgY3VycmVudE9wZXJhdGlvbjoge1xuICAgICAgICBvcGVyYXRpb25JZDogZXhlY3V0aW9uLm9wZXJhdGlvbklkLFxuICAgICAgICByZXZpc2lvbjogcHJvamVjdFJldmlzaW9uLFxuICAgICAgICBzdGF0dXM6IGV4ZWN1dGlvbi5zdGF0dXMsXG4gICAgICAgIHRlcm1pbmFsU3RhdGUsXG4gICAgICB9LFxuICAgICAgcmV0YWluZWRSZXN1bHQ6XG4gICAgICAgIHRlcm1pbmFsU3RhdGUgPT09IFwiRkFJTEVEXCIgfHwgdGVybWluYWxTdGF0ZSA9PT0gXCJCTE9DS0VEXCIgfHwgdGVybWluYWxTdGF0ZSA9PT0gXCJJTkNPTVBMRVRFXCJcbiAgICAgICAgICA/IHtcbiAgICAgICAgICAgICAgb3BlcmF0aW9uSWQ6IGV4ZWN1dGlvbi5vcGVyYXRpb25JZCxcbiAgICAgICAgICAgICAgcmV2aXNpb246IHByb2plY3RSZXZpc2lvbixcbiAgICAgICAgICAgICAgbGFiZWw6IFwicmV0YWluZWQgcmVzdWx0IGZyb20gdGhlIGN1cnJlbnQgZmFpbGVkIG9yIGluY29tcGxldGUgb3BlcmF0aW9uXCIsXG4gICAgICAgICAgICB9XG4gICAgICAgICAgOiB1bmRlZmluZWQsXG4gICAgICB0ZXJtaW5hbFN0YXRlLFxuICAgICAgZXhlY3V0aW9uOiB7XG4gICAgICAgIGlkOiBleGVjdXRpb24uaWQsXG4gICAgICAgIHByb2plY3RJZDogZXhlY3V0aW9uLnByb2plY3RJZCxcbiAgICAgICAgc2Vzc2lvbklkOiBleGVjdXRpb24uc2Vzc2lvbklkLFxuICAgICAgICBvcGVyYXRpb25JZDogZXhlY3V0aW9uLm9wZXJhdGlvbklkLFxuICAgICAgICBzdGF0dXM6IGV4ZWN1dGlvbi5zdGF0dXMsXG4gICAgICAgIGZsaWdodFN0YXRlOiBleGVjdXRpb24uZmxpZ2h0U3RhdGUsXG4gICAgICB9LFxuICAgICAgbWVzc2FnZXM6IG1lc3NhZ2VzLm1hcChcbiAgICAgICAgKHtcbiAgICAgICAgICBpZCxcbiAgICAgICAgICBzZXNzaW9uSWQ6IG1lc3NhZ2VTZXNzaW9uLFxuICAgICAgICAgIHJvbGUsXG4gICAgICAgICAgZXhlY3V0aW9uSWQ6IG1lc3NhZ2VFeGVjdXRpb24sXG4gICAgICAgICAgb3V0Y29tZSxcbiAgICAgICAgfSkgPT4gKHtcbiAgICAgICAgICBpZCxcbiAgICAgICAgICBzZXNzaW9uSWQ6IG1lc3NhZ2VTZXNzaW9uLFxuICAgICAgICAgIHJvbGUsXG4gICAgICAgICAgZXhlY3V0aW9uSWQ6IG1lc3NhZ2VFeGVjdXRpb24sXG4gICAgICAgICAgb3V0Y29tZSxcbiAgICAgICAgfSksXG4gICAgICApLFxuICAgICAgc3NlRXZlbnRzOiBzc2VFdmVudHMubWFwKFxuICAgICAgICAoe1xuICAgICAgICAgIHR5cGUsXG4gICAgICAgICAgZXhlY3V0aW9uSWQ6IGV2ZW50RXhlY3V0aW9uLFxuICAgICAgICAgIHNlc3Npb25JZDogZXZlbnRTZXNzaW9uLFxuICAgICAgICAgIG91dGNvbWUsXG4gICAgICAgICAgY29kZSxcbiAgICAgICAgfSkgPT4gKHtcbiAgICAgICAgICB0eXBlLFxuICAgICAgICAgIGV4ZWN1dGlvbklkOiBldmVudEV4ZWN1dGlvbixcbiAgICAgICAgICBzZXNzaW9uSWQ6IGV2ZW50U2Vzc2lvbixcbiAgICAgICAgICBvdXRjb21lLFxuICAgICAgICAgIGNvZGUsXG4gICAgICAgIH0pLFxuICAgICAgKSxcbiAgICAgIGNoZWNrcG9pbnRzOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBzZXF1ZW5jZTogY2hlY2twb2ludC5zZXF1ZW5jZSxcbiAgICAgICAgICBzdGFnZTogY2hlY2twb2ludC5zdGFnZSxcbiAgICAgICAgICB1cGRhdGVkQXQ6IGNoZWNrcG9pbnQudXBkYXRlZEF0LFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICAgIGV2aWRlbmNlQ291bnQsXG4gICAgICBwcm9wb3NhbHM6IHByb3Bvc2FsXG4gICAgICAgID8gW1xuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBpZDogcHJvcG9zYWwuaWQsXG4gICAgICAgICAgICAgIHJldmlzaW9uOiBwcm9wb3NhbC5yZXZpc2lvbixcbiAgICAgICAgICAgICAgc3RhdHVzOiBwcm9wb3NhbC5zdGF0dXMsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIF1cbiAgICAgICAgOiBbXSxcbiAgICAgIHZhbGlkYXRpb246IHZhbGlkYXRpb24ubWFwKChzdGVwKSA9PiAoe1xuICAgICAgICBzdGF0dXM6IHN0ZXAudmFsaWRhdGlvbj8uc3RhdHVzID8/IHN0ZXAuc3RhdHVzLFxuICAgICAgICBwcm9maWxlOiBzdGVwLnZhbGlkYXRpb24/LnByb2ZpbGUgPz8gc3RlcC52YWxpZGF0aW9uUHJvZmlsZSxcbiAgICAgIH0pKSxcbiAgICAgIGV2ZW50czogZXZlbnRzLm1hcCgoeyB0eXBlLCBzZXZlcml0eSwgY29ycmVsYXRpb25JZCB9KSA9PiAoe1xuICAgICAgICB0eXBlLFxuICAgICAgICBzZXZlcml0eSxcbiAgICAgICAgY29ycmVsYXRpb25JZCxcbiAgICAgIH0pKSxcbiAgICAgIGRhc2hib2FyZDogbWlzc2lvbkNvbnRyb2wsXG4gICAgICBkYXNoYm9hcmRTdGF0ZToge1xuICAgICAgICBwcm9qZWN0Q291bnQ6IGRhc2hib2FyZFN0YXRlLnByb2plY3RDb3VudCxcbiAgICAgICAgYWN0aXZlVGFza0NvdW50OiBkYXNoYm9hcmRTdGF0ZS5hY3RpdmVUYXNrQ291bnQsXG4gICAgICB9LFxuICAgIH07XG4gICAgY29uc3Qgb3V0cHV0UGF0aCA9XG4gICAgICBwcm9jZXNzLmVudi5EQVNIQk9BUkRfRTJFX0xJVkVfUkVQT1JUX1BBVEggPz9cbiAgICAgIFwidGVzdC1yZXN1bHRzL2Rhc2hib2FyZC1qb3VybmV5L2xpdmUtbWlzc2lvbi1jb3JyZWxhdGlvbi5qc29uXCI7XG4gICAgYXdhaXQgbWtkaXIoZGlybmFtZShvdXRwdXRQYXRoKSwgeyByZWN1cnNpdmU6IHRydWUgfSk7XG4gICAgYXdhaXQgd3JpdGVGaWxlKFxuICAgICAgb3V0cHV0UGF0aCxcbiAgICAgIGAke0pTT04uc3RyaW5naWZ5KGNhcHR1cmUsIG51bGwsIDIpfVxcbmAsXG4gICAgICBcInV0ZjhcIixcbiAgICApO1xuICB9KTtcblxuICB0ZXN0KFwic2lnbnMgaW4gYW5kIHRyYXZlcnNlcyB0aGUgYXV0aGVudGljYXRlZCBvcGVyYXRpb25hbCBzaGVsbFwiLCBhc3luYyAoe1xuICAgIHBhZ2UsXG4gIH0pID0+IHtcbiAgICBhd2FpdCBpbnN0YWxsQXBpRml4dHVyZXMocGFnZSk7XG4gICAgYXdhaXQgcHJvZ3JhbW1hdGljU2lnbkluKHBhZ2UpO1xuICAgIGZvciAoY29uc3Qgb3JpZ2luIG9mIGFwcHJvdmVkRGFzaGJvYXJkT3JpZ2lucygpKSB7XG4gICAgICBhd2FpdCBleHBlY3RPcmlnaW5DYW5Vc2VBcGkocGFnZSwgb3JpZ2luKTtcbiAgICB9XG4gICAgYXdhaXQgZXhwZWN0SG9zdGlsZU9yaWdpblJlamVjdGVkKHBhZ2UpO1xuXG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVJvbGUoXCJoZWFkaW5nXCIsIHsgbmFtZTogXCJTeXN0ZW0gT3ZlcnZpZXdcIiB9KSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXCJTWVNURU0gT05MSU5FXCIsIHsgZXhhY3Q6IHRydWUgfSksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiU21va2UgUHJvamVjdFwiLCB7IGV4YWN0OiB0cnVlIH0pLmZpcnN0KCksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiRGFzaGJvYXJkIEFQSSBmaXh0dXJlIHJlYWR5XCIsIHsgZXhhY3Q6IHRydWUgfSksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IG9wZW5OYXZpZ2F0aW9uKHBhZ2UsIFwiUHJvamVjdHNcIiwgYCR7REFTSEJPQVJEX1BBVEh9cHJvamVjdHNgKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5nZXRCeVJvbGUoXCJoZWFkaW5nXCIsIHsgbmFtZTogXCJQcm9qZWN0c1wiIH0pKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiU21va2UgUHJvamVjdFwiLCB7IGV4YWN0OiB0cnVlIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcblxuICAgIGF3YWl0IG9wZW5OYXZpZ2F0aW9uKHBhZ2UsIFwiRXZlbnQgU3RyZWFtXCIsIGAke0RBU0hCT0FSRF9QQVRIfWV2ZW50c2ApO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlSb2xlKFwiaGVhZGluZ1wiLCB7IG5hbWU6IFwiRXZlbnQgU3RyZWFtXCIgfSksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiRGFzaGJvYXJkIEFQSSBmaXh0dXJlIHJlYWR5XCIsIHsgZXhhY3Q6IHRydWUgfSksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuXG4gICAgYXdhaXQgb3Blbk5hdmlnYXRpb24ocGFnZSwgXCJBSSBBc3Npc3RhbnRcIiwgYCR7REFTSEJPQVJEX1BBVEh9YWlgKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZSkubm90LnRvSGF2ZVVSTCgvc2lnbi1pbi8pO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2VcbiAgICAgICAgLmdldEJ5VGV4dChcbiAgICAgICAgICAvQUkgcHJvdmlkZXIgbm90IGNvbmZpZ3VyZWR8Tm8gQUkga2V5IGNvbmZpZ3VyZWR8QUkgQXNzaXN0YW50L2ksXG4gICAgICAgIClcbiAgICAgICAgLmZpcnN0KCksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuXG4gICAgYXdhaXQgb3Blbk5hdmlnYXRpb24oXG4gICAgICBwYWdlLFxuICAgICAgXCJNaXNzaW9uIENvbnRyb2xcIixcbiAgICAgIGAke0RBU0hCT0FSRF9QQVRIfW1pc3Npb24tY29udHJvbGAsXG4gICAgKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5Um9sZShcImhlYWRpbmdcIiwgeyBuYW1lOiBcIk5vIGR1cmFibGUgcnVucyBpbiB0aGUgbGVkZ2VyXCIgfSksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuXG4gICAgYXdhaXQgcGFnZS5nb3RvKGAke0RBU0hCT0FSRF9QQVRIfWZsaWdodC1kZWNrP2V4ZWN1dGlvbklkPSR7RVhFQ1VUSU9OX0lEfWApO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlKS50b0hhdmVVUkwoXG4gICAgICBuZXcgUmVnRXhwKFxuICAgICAgICBgJHtEQVNIQk9BUkRfUEFUSC5yZXBsYWNlQWxsKFwiL1wiLCBcIlxcXFwvXCIpfWZsaWdodC1kZWNrXFxcXD9leGVjdXRpb25JZD1gLFxuICAgICAgKSxcbiAgICApO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlSb2xlKFwiaGVhZGluZ1wiLCB7IG5hbWU6IFwiQXVkaXQgLyBDaGF0IHJ1blwiIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcIkNvbnRyb2xsZWQgYnJvd3NlciBmaXh0dXJlIGNvbXBsZXRlZC5cIiwgeyBleGFjdDogdHJ1ZSB9KSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXCJQUk9WRU5cIiwgeyBleGFjdDogdHJ1ZSB9KS5maXJzdCgpLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgfSk7XG5cbiAgdGVzdChcIm9wZW5zIGZhaWxlZCB0YXNrIGFuZCB3b3JrZmxvdyBkZXRhaWxzIHdpdGggcmVkYWN0ZWQgcmVjb3ZlcnkgZ3VpZGFuY2VcIiwgYXN5bmMgKHtcbiAgICBwYWdlLFxuICB9KSA9PiB7XG4gICAgY29uc3QgcmF3RGlhZ25vc3RpYyA9IFwicHJvdmlkZXIgZGlhZ25vc3RpYzogdXBzdHJlYW0gcmV0dXJuZWQgcmF3IHJlc3BvbnNlXCI7XG4gICAgY29uc3QgcmF3Q3JlZGVudGlhbCA9IFwic2stZTJlLWJyb3dzZXItY3JlZGVudGlhbC1zZWNyZXRcIjtcbiAgICBjb25zdCBzdXBwb3J0UmVmZXJlbmNlcyA9IHtcbiAgICAgIGF1dGhlbnRpY2F0aW9uX2ZhaWxlZDogXCJzdXBwb3J0LXRhc2stYXV0aC0zMlwiLFxuICAgICAgcXVvdGFfZXhoYXVzdGVkOiBcInN1cHBvcnQtdGFzay1xdW90YS0zMlwiLFxuICAgICAgcHJvdmlkZXJfb3V0YWdlOiBcInN1cHBvcnQtd29ya2Zsb3ctb3V0YWdlLTMyXCIsXG4gICAgfTtcbiAgICBjb25zdCByZWNvdmVyeVRhc2tzID0gW1xuICAgICAge1xuICAgICAgICBpZDogXCJlMmUtYXV0aC1mYWlsZWQtdGFza1wiLFxuICAgICAgICBwcm9qZWN0SWQ6IFwiZTJlLXByb2plY3RcIixcbiAgICAgICAgdGl0bGU6IFwiUmVjb3ZlciBhdXRoZW50aWNhdGlvbiBmYWlsdXJlXCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIlRoZSBwcm92aWRlciBhdXRoZW50aWNhdGlvbiB0ZXN0IHRhc2sgZmFpbGVkLlwiLFxuICAgICAgICBzdGF0dXM6IFwiZmFpbGVkXCIsXG4gICAgICAgIHByaW9yaXR5OiBcInAxXCIsXG4gICAgICAgIHJlbGF0ZWRGaWxlczogW1wic3JjL3Byb3ZpZGVyLnRzXCJdLFxuICAgICAgICByZXRyeUNvdW50OiAxLFxuICAgICAgICBtYXhSZXRyaWVzOiAyLFxuICAgICAgICBhZ2VudFJlc3BvbnNlOiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAga2luZDogXCJBSV9UQVNLX0VYRUNVVElPTl9SRUNFSVBUXCIsXG4gICAgICAgICAgdGVybWluYWxTdGF0dXM6IFwiRkFJTEVEXCIsXG4gICAgICAgICAgYXZhaWxhYmlsaXR5U3RhdGU6IFwiYXV0aGVudGljYXRpb25fZmFpbGVkXCIsXG4gICAgICAgICAgY29ycmVsYXRpb25JZDogc3VwcG9ydFJlZmVyZW5jZXMuYXV0aGVudGljYXRpb25fZmFpbGVkLFxuICAgICAgICAgIG9wZXJhdG9yQWN0aW9uOiBcIlJlcGxhY2UgdGhlIHByb3ZpZGVyIEFQSSBrZXkgd2l0aCBhIHZhbGlkIGtleSwgdGhlbiByZXRyeS5cIixcbiAgICAgICAgICBwcm92aWRlcjogXCJvcGVucm91dGVyXCIsXG4gICAgICAgICAgbW9kZWw6IFwic2VjcmV0LW1vZGVsLW5hbWVcIixcbiAgICAgICAgICB0ZXJtaW5hbFJlYXNvbjogcmF3RGlhZ25vc3RpYyxcbiAgICAgICAgICBvcGVyYXRpb25JZDogcmF3Q3JlZGVudGlhbCxcbiAgICAgICAgfSksXG4gICAgICAgIGNyZWF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAwOjAwLjAwMFpcIixcbiAgICAgICAgdXBkYXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDE6MDAuMDAwWlwiLFxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgaWQ6IFwiZTJlLXF1b3RhLWZhaWxlZC10YXNrXCIsXG4gICAgICAgIHByb2plY3RJZDogXCJlMmUtcHJvamVjdFwiLFxuICAgICAgICB0aXRsZTogXCJSZWNvdmVyIHF1b3RhIGV4aGF1c3Rpb25cIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiVGhlIHByb3ZpZGVyIHF1b3RhIHRlc3QgdGFzayBmYWlsZWQuXCIsXG4gICAgICAgIHN0YXR1czogXCJmYWlsZWRcIixcbiAgICAgICAgcHJpb3JpdHk6IFwicDFcIixcbiAgICAgICAgcmV0cnlDb3VudDogMCxcbiAgICAgICAgbWF4UmV0cmllczogMixcbiAgICAgICAgYWdlbnRSZXNwb25zZTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgIGtpbmQ6IFwiQUlfVEFTS19FWEVDVVRJT05fUkVDRUlQVFwiLFxuICAgICAgICAgIHRlcm1pbmFsU3RhdHVzOiBcIkZBSUxFRFwiLFxuICAgICAgICAgIGF2YWlsYWJpbGl0eVN0YXRlOiBcInF1b3RhX2V4aGF1c3RlZFwiLFxuICAgICAgICAgIGNvcnJlbGF0aW9uSWQ6IHN1cHBvcnRSZWZlcmVuY2VzLnF1b3RhX2V4aGF1c3RlZCxcbiAgICAgICAgICBwcm92aWRlcjogXCJvcGVucm91dGVyXCIsXG4gICAgICAgICAgbW9kZWw6IFwic2VjcmV0LW1vZGVsLW5hbWVcIixcbiAgICAgICAgICB0ZXJtaW5hbFJlYXNvbjogcmF3RGlhZ25vc3RpYyxcbiAgICAgICAgICBvcGVyYXRpb25JZDogcmF3Q3JlZGVudGlhbCxcbiAgICAgICAgfSksXG4gICAgICAgIGNyZWF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAwOjAwLjAwMFpcIixcbiAgICAgICAgdXBkYXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDE6MDAuMDAwWlwiLFxuICAgICAgfSxcbiAgICBdO1xuICAgIGNvbnN0IHdvcmtmbG93SWQgPSBcImUyZS1vdXRhZ2Utd29ya2Zsb3dcIjtcbiAgICBhd2FpdCBpbnN0YWxsQXBpRml4dHVyZXMocGFnZSwge1xuICAgICAgcmVjb3ZlcnlUYXNrcyxcbiAgICAgIHJlY292ZXJ5V29ya2Zsb3dzOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBpZDogd29ya2Zsb3dJZCxcbiAgICAgICAgICBwcm9qZWN0SWQ6IFwiZTJlLXByb2plY3RcIixcbiAgICAgICAgICBuYW1lOiBcIlJlY292ZXIgcHJvdmlkZXIgb3V0YWdlXCIsXG4gICAgICAgICAgZGVzY3JpcHRpb246IFwiQSBwaXBlbGluZSB1c2VkIHRvIHZlcmlmeSBvdXRhZ2UgcmVjb3ZlcnkgZ3VpZGFuY2UuXCIsXG4gICAgICAgICAgc3RhdHVzOiBcImZhaWxlZFwiLFxuICAgICAgICAgIHBoYXNlczogW1xuICAgICAgICAgICAgeyBuYW1lOiBcImJ1aWxkXCIsIHN0ZXBzOiBbXCJjb21waWxlXCJdIH0sXG4gICAgICAgICAgICB7IG5hbWU6IFwidGVzdFwiLCBzdGVwczogW1widmVyaWZ5XCJdIH0sXG4gICAgICAgICAgXSxcbiAgICAgICAgICBjdXJyZW50UGhhc2U6IFwidGVzdFwiLFxuICAgICAgICAgIGV4ZWN1dGlvbkNvdW50OiAxLFxuICAgICAgICAgIGNyZWF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAwOjAwLjAwMFpcIixcbiAgICAgICAgICB1cGRhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMTowMC4wMDBaXCIsXG4gICAgICAgIH0sXG4gICAgICBdLFxuICAgICAgcmVjb3ZlcnlXb3JrZmxvd0V4ZWN1dGlvbnM6IHtcbiAgICAgICAgW3dvcmtmbG93SWRdOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgaWQ6IFwiZTJlLW91dGFnZS1leGVjdXRpb25cIixcbiAgICAgICAgICAgIHdvcmtmbG93SWQsXG4gICAgICAgICAgICBzdGF0dXM6IFwiZmFpbGVkXCIsXG4gICAgICAgICAgICBjdXJyZW50UGhhc2U6IFwidGVzdFwiLFxuICAgICAgICAgICAgY29tcGxldGVkUGhhc2VzOiBbXCJidWlsZFwiXSxcbiAgICAgICAgICAgIHN0YXJ0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAwOjAwLjAwMFpcIixcbiAgICAgICAgICAgIGVycm9yTWVzc2FnZTogcmF3RGlhZ25vc3RpYyxcbiAgICAgICAgICAgIHJlY292ZXJ5OiB7XG4gICAgICAgICAgICAgIGF2YWlsYWJpbGl0eVN0YXRlOiBcInByb3ZpZGVyX291dGFnZVwiLFxuICAgICAgICAgICAgICBjb3JyZWxhdGlvbklkOiBzdXBwb3J0UmVmZXJlbmNlcy5wcm92aWRlcl9vdXRhZ2UsXG4gICAgICAgICAgICAgIG9wZXJhdG9yQWN0aW9uOlxuICAgICAgICAgICAgICAgIFwiUmV0cnkgaW4gYSBtb21lbnQ7IGNvbmZpZ3VyZSBhbm90aGVyIHByb3ZpZGVyIGlmIHRoZSBpc3N1ZSBwZXJzaXN0cy5cIixcbiAgICAgICAgICAgICAgZGlhZ25vc3RpYzogcmF3Q3JlZGVudGlhbCxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgXSxcbiAgICAgIH0sXG4gICAgfSk7XG4gICAgYXdhaXQgcHJvZ3JhbW1hdGljU2lnbkluKHBhZ2UpO1xuXG4gICAgYXdhaXQgb3Blbk5hdmlnYXRpb24ocGFnZSwgXCJUYXNrc1wiLCBgJHtEQVNIQk9BUkRfUEFUSH10YXNrc2ApO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlMYWJlbChcIkV4cGFuZCB0YXNrIFJlY292ZXIgYXV0aGVudGljYXRpb24gZmFpbHVyZVwiKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgcGFnZVxuICAgICAgLmdldEJ5TGFiZWwoXCJFeHBhbmQgdGFzayBSZWNvdmVyIGF1dGhlbnRpY2F0aW9uIGZhaWx1cmVcIilcbiAgICAgIC5jbGljaygpO1xuICAgIGNvbnN0IHRhc2tEZXRhaWxzID0gcGFnZS5sb2NhdG9yKFwiI3Rhc2stZGV0YWlscy1lMmUtYXV0aC1mYWlsZWQtdGFza1wiKTtcbiAgICBhd2FpdCBleHBlY3QodGFza0RldGFpbHMpLnRvQ29udGFpblRleHQoXCJQcm92aWRlciBhdXRoZW50aWNhdGlvbiBmYWlsZWRcIik7XG4gICAgYXdhaXQgZXhwZWN0KHRhc2tEZXRhaWxzKS50b0NvbnRhaW5UZXh0KFxuICAgICAgXCJSZXBsYWNlIHRoZSBwcm92aWRlciBBUEkga2V5IHdpdGggYSB2YWxpZCBrZXksIHRoZW4gcmV0cnkuXCIsXG4gICAgKTtcbiAgICBhd2FpdCBleHBlY3QodGFza0RldGFpbHMpLnRvQ29udGFpblRleHQoXG4gICAgICBgU3VwcG9ydCByZWZlcmVuY2U6ICR7c3VwcG9ydFJlZmVyZW5jZXMuYXV0aGVudGljYXRpb25fZmFpbGVkfWAsXG4gICAgKTtcbiAgICBhd2FpdCBwYWdlLmdldEJ5TGFiZWwoXCJFeHBhbmQgdGFzayBSZWNvdmVyIHF1b3RhIGV4aGF1c3Rpb25cIikuY2xpY2soKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5nZXRCeVRleHQoXCJQcm92aWRlciBxdW90YSBpcyBleGhhdXN0ZWRcIikpLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoYFN1cHBvcnQgcmVmZXJlbmNlOiAke3N1cHBvcnRSZWZlcmVuY2VzLnF1b3RhX2V4aGF1c3RlZH1gKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgcGFnZS5yZWxvYWQoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5TGFiZWwoXCJFeHBhbmQgdGFzayBSZWNvdmVyIGF1dGhlbnRpY2F0aW9uIGZhaWx1cmVcIiksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IHBhZ2VcbiAgICAgIC5nZXRCeUxhYmVsKFwiRXhwYW5kIHRhc2sgUmVjb3ZlciBhdXRoZW50aWNhdGlvbiBmYWlsdXJlXCIpXG4gICAgICAuY2xpY2soKTtcbiAgICBjb25zdCByZWxvYWRlZEF1dGhEZXRhaWxzID0gcGFnZS5sb2NhdG9yKFxuICAgICAgXCIjdGFzay1kZXRhaWxzLWUyZS1hdXRoLWZhaWxlZC10YXNrXCIsXG4gICAgKTtcbiAgICBhd2FpdCBleHBlY3QocmVsb2FkZWRBdXRoRGV0YWlscykudG9Db250YWluVGV4dChcbiAgICAgIFwiUHJvdmlkZXIgYXV0aGVudGljYXRpb24gZmFpbGVkXCIsXG4gICAgKTtcbiAgICBhd2FpdCBleHBlY3QocmVsb2FkZWRBdXRoRGV0YWlscykudG9Db250YWluVGV4dChcbiAgICAgIFwiUmVwbGFjZSB0aGUgcHJvdmlkZXIgQVBJIGtleSB3aXRoIGEgdmFsaWQga2V5LCB0aGVuIHJldHJ5LlwiLFxuICAgICk7XG4gICAgYXdhaXQgZXhwZWN0KHJlbG9hZGVkQXV0aERldGFpbHMpLnRvQ29udGFpblRleHQoXG4gICAgICBgU3VwcG9ydCByZWZlcmVuY2U6ICR7c3VwcG9ydFJlZmVyZW5jZXMuYXV0aGVudGljYXRpb25fZmFpbGVkfWAsXG4gICAgKTtcbiAgICBhd2FpdCBwYWdlLmdldEJ5TGFiZWwoXCJFeHBhbmQgdGFzayBSZWNvdmVyIHF1b3RhIGV4aGF1c3Rpb25cIikuY2xpY2soKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5nZXRCeVRleHQoXCJQcm92aWRlciBxdW90YSBpcyBleGhhdXN0ZWRcIikpLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoYFN1cHBvcnQgcmVmZXJlbmNlOiAke3N1cHBvcnRSZWZlcmVuY2VzLnF1b3RhX2V4aGF1c3RlZH1gKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgY29uc3QgcmVsb2FkZWRUYXNrVGV4dCA9IGF3YWl0IHBhZ2UubG9jYXRvcihcImJvZHlcIikuaW5uZXJUZXh0KCk7XG4gICAgZXhwZWN0KHJlbG9hZGVkVGFza1RleHQpLm5vdC50b0NvbnRhaW4ocmF3RGlhZ25vc3RpYyk7XG4gICAgZXhwZWN0KHJlbG9hZGVkVGFza1RleHQpLm5vdC50b0NvbnRhaW4ocmF3Q3JlZGVudGlhbCk7XG4gICAgZXhwZWN0KHJlbG9hZGVkVGFza1RleHQpLm5vdC50b01hdGNoKFxuICAgICAgL3NlY3JldC1tb2RlbC1uYW1lfFxcL2hvbWVcXC9ydW5uZXJ8XFwvdG1wXFwvL2ksXG4gICAgKTtcblxuICAgIGF3YWl0IG9wZW5OYXZpZ2F0aW9uKHBhZ2UsIFwiV29ya2Zsb3dzXCIsIGAke0RBU0hCT0FSRF9QQVRIfXdvcmtmbG93c2ApO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlLmdldEJ5VGV4dChcIlJlY292ZXIgcHJvdmlkZXIgb3V0YWdlXCIpKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJFeGVjdXRpb24gaGlzdG9yeVwiIH0pLmNsaWNrKCk7XG4gICAgY29uc3QgZXhlY3V0aW9uID0gcGFnZVxuICAgICAgLmdldEJ5VGV4dChcImZhaWxlZCDCtyBubyBzdWNjZXNzZnVsIGNvbXBsZXRpb25cIilcbiAgICAgIC5sb2NhdG9yKFwiLi5cIilcbiAgICAgIC5sb2NhdG9yKFwiLi5cIik7XG4gICAgYXdhaXQgZXhwZWN0KGV4ZWN1dGlvbikudG9Db250YWluVGV4dChcbiAgICAgIFwiVGhlIHByb3ZpZGVyIGlzIHRlbXBvcmFyaWx5IHVuYXZhaWxhYmxlXCIsXG4gICAgKTtcbiAgICBhd2FpdCBleHBlY3QoZXhlY3V0aW9uKS50b0NvbnRhaW5UZXh0KFxuICAgICAgXCJSZXRyeSBpbiBhIG1vbWVudDsgY29uZmlndXJlIGFub3RoZXIgcHJvdmlkZXIgaWYgdGhlIGlzc3VlIHBlcnNpc3RzLlwiLFxuICAgICk7XG4gICAgYXdhaXQgZXhwZWN0KGV4ZWN1dGlvbikudG9Db250YWluVGV4dChcbiAgICAgIGBTdXBwb3J0IHJlZmVyZW5jZTogJHtzdXBwb3J0UmVmZXJlbmNlcy5wcm92aWRlcl9vdXRhZ2V9YCxcbiAgICApO1xuICAgIGF3YWl0IHBhZ2UucmVsb2FkKCk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlUZXh0KFwiUmVjb3ZlciBwcm92aWRlciBvdXRhZ2VcIikpLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgcGFnZS5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIkV4ZWN1dGlvbiBoaXN0b3J5XCIgfSkuY2xpY2soKTtcbiAgICBjb25zdCByZWxvYWRlZEV4ZWN1dGlvbiA9IHBhZ2VcbiAgICAgIC5nZXRCeVRleHQoXCJmYWlsZWQgwrcgbm8gc3VjY2Vzc2Z1bCBjb21wbGV0aW9uXCIpXG4gICAgICAubG9jYXRvcihcIi4uXCIpXG4gICAgICAubG9jYXRvcihcIi4uXCIpO1xuICAgIGF3YWl0IGV4cGVjdChyZWxvYWRlZEV4ZWN1dGlvbikudG9Db250YWluVGV4dChcbiAgICAgIFwiVGhlIHByb3ZpZGVyIGlzIHRlbXBvcmFyaWx5IHVuYXZhaWxhYmxlXCIsXG4gICAgKTtcbiAgICBhd2FpdCBleHBlY3QocmVsb2FkZWRFeGVjdXRpb24pLnRvQ29udGFpblRleHQoXG4gICAgICBcIlJldHJ5IGluIGEgbW9tZW50OyBjb25maWd1cmUgYW5vdGhlciBwcm92aWRlciBpZiB0aGUgaXNzdWUgcGVyc2lzdHMuXCIsXG4gICAgKTtcbiAgICBhd2FpdCBleHBlY3QocmVsb2FkZWRFeGVjdXRpb24pLnRvQ29udGFpblRleHQoXG4gICAgICBgU3VwcG9ydCByZWZlcmVuY2U6ICR7c3VwcG9ydFJlZmVyZW5jZXMucHJvdmlkZXJfb3V0YWdlfWAsXG4gICAgKTtcblxuICAgIGNvbnN0IHZpc2libGVUZXh0ID0gYXdhaXQgcGFnZS5sb2NhdG9yKFwiYm9keVwiKS5pbm5lclRleHQoKTtcbiAgICBleHBlY3QodmlzaWJsZVRleHQpLm5vdC50b0NvbnRhaW4ocmF3RGlhZ25vc3RpYyk7XG4gICAgZXhwZWN0KHZpc2libGVUZXh0KS5ub3QudG9Db250YWluKHJhd0NyZWRlbnRpYWwpO1xuICAgIGV4cGVjdCh2aXNpYmxlVGV4dCkubm90LnRvTWF0Y2goXG4gICAgICAvc2VjcmV0LW1vZGVsLW5hbWV8XFwvaG9tZVxcL3J1bm5lcnxcXC90bXBcXC8vaSxcbiAgICApO1xuICAgIGF3YWl0IGV4cGVjdE5vSG9yaXpvbnRhbE92ZXJmbG93KHBhZ2UpO1xuICB9KTtcblxuICB0ZXN0KFwicHJvdmVzIHJlbWVkaWF0aW9uIHBsYW5zLCByZXZpZXcgc3RhdGUsIGFuZCB0YXNrIGFjdGlvbiB0cmFuc2l0aW9uc1wiLCBhc3luYyAoe1xuICAgIHBhZ2UsXG4gIH0pID0+IHtcbiAgICBjb25zdCByYXdQcm9tcHQgPSBcIklOVEVSTkFMX1BST01QVF9zaG91bGRfbmV2ZXJfcmVuZGVyXCI7XG4gICAgY29uc3QgcmF3RGlhZ25vc3RpYyA9IFwicmF3LXByb3ZpZGVyLWRpYWdub3N0aWMtc2hvdWxkLW5ldmVyLXJlbmRlclwiO1xuICAgIGNvbnN0IHJlYWR5VGFza0lkID0gXCJlMmUtcmVhZHktcmVtZWRpYXRpb24tdGFza1wiO1xuICAgIGNvbnN0IHJldmlld1Rhc2tJZCA9IFwiZTJlLXJldmlldy1yZW1lZGlhdGlvbi10YXNrXCI7XG4gICAgY29uc3QgdmVyaWZpY2F0aW9uVGFza0lkID0gXCJlMmUtdmVyaWZpY2F0aW9uLXJlbWVkaWF0aW9uLXRhc2tcIjtcbiAgICBjb25zdCByZW1lZGlhdGlvblRhc2tzID0gW1xuICAgICAge1xuICAgICAgICBpZDogcmVhZHlUYXNrSWQsXG4gICAgICAgIHByb2plY3RJZDogXCJlMmUtcHJvamVjdFwiLFxuICAgICAgICB0aXRsZTogXCJFeGVjdXRlIFNRTCBpbnB1dCBzYW5pdGl6YXRpb24gcmVtZWRpYXRpb25cIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiQSBjb21wbGV0ZSByZW1lZGlhdGlvbiBwbGFuIGlzIHJlYWR5IGZvciBvcGVyYXRvciBleGVjdXRpb24uXCIsXG4gICAgICAgIHN0YXR1czogXCJwZW5kaW5nXCIsXG4gICAgICAgIHByaW9yaXR5OiBcInAxXCIsXG4gICAgICAgIHBoYXNlOiBcIlJlbWVkaWF0aW9uXCIsXG4gICAgICAgIHJlbGF0ZWRGaWxlczogW1wic3JjL2F1dGgvaW5wdXQudHNcIl0sXG4gICAgICAgIHJldHJ5Q291bnQ6IDAsXG4gICAgICAgIG1heFJldHJpZXM6IDIsXG4gICAgICAgIHByb21wdDogcmF3UHJvbXB0LFxuICAgICAgICBhZ2VudFJlc3BvbnNlOiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAga2luZDogXCJBSV9UQVNLX0VYRUNVVElPTl9SRUNFSVBUXCIsXG4gICAgICAgICAgdGVybWluYWxTdGF0dXM6IFwiUkVDT1JERURcIixcbiAgICAgICAgICB0ZXJtaW5hbFJlYXNvbjogcmF3RGlhZ25vc3RpYyxcbiAgICAgICAgfSksXG4gICAgICAgIHJlbWVkaWF0aW9uUGxhbjoge1xuICAgICAgICAgIHZlcnNpb246IDEsXG4gICAgICAgICAgcnVsZUlkOiBcImUyZS1ydWxlLXNxbC1pbnB1dFwiLFxuICAgICAgICAgIHJ1bGVDb2RlOiBcIlNFQy0wMDFcIixcbiAgICAgICAgICBydWxlVGl0bGU6IFwiVW5zYW5pdGl6ZWQgU1FMIGlucHV0XCIsXG4gICAgICAgICAgc2V2ZXJpdHk6IFwiaGlnaFwiLFxuICAgICAgICAgIG9jY3VycmVuY2VDb3VudDogMixcbiAgICAgICAgICBldmlkZW5jZTogW1xuICAgICAgICAgICAgeyBmaWxlOiBcInNyYy9hdXRoL2lucHV0LnRzXCIsIGxpbmU6IDEwLCBzbmlwcGV0OiBcInF1ZXJ5KHVzZXJJbnB1dClcIiwgb2NjdXJyZW5jZXM6IDEgfSxcbiAgICAgICAgICAgIHsgZmlsZTogXCJzcmMvYXV0aC9pbnB1dC50c1wiLCBsaW5lOiAxOCwgc25pcHBldDogXCJxdWVyeShhY2NvdW50SWQpXCIsIG9jY3VycmVuY2VzOiAxIH0sXG4gICAgICAgICAgICB7IGZpbGU6IFwic3JjL2F1dGgvaW5wdXQudHNcIiwgbGluZTogMjcsIHNuaXBwZXQ6IFwicXVlcnkoZmlsdGVyKVwiLCBvY2N1cnJlbmNlczogMSB9LFxuICAgICAgICAgICAgeyBmaWxlOiBcInNyYy9hdXRoL2lucHV0LnRzXCIsIGxpbmU6IDMxLCBzbmlwcGV0OiBcInF1ZXJ5KHNvcnQpXCIsIG9jY3VycmVuY2VzOiAxIH0sXG4gICAgICAgICAgICB7IGZpbGU6IFwic3JjL2F1dGgvaW5wdXQudHNcIiwgbGluZTogNDQsIHNuaXBwZXQ6IFwicXVlcnkobGltaXQpXCIsIG9jY3VycmVuY2VzOiAxIH0sXG4gICAgICAgICAgICB7IGZpbGU6IFwic3JjL2F1dGgvaW5wdXQudHNcIiwgbGluZTogNTIsIHNuaXBwZXQ6IFwicXVlcnkob2Zmc2V0KVwiLCBvY2N1cnJlbmNlczogMSB9LFxuICAgICAgICAgIF0sXG4gICAgICAgICAgcmVsYXRlZEZpbGVzOiBbXCJzcmMvYXV0aC9pbnB1dC50c1wiXSxcbiAgICAgICAgICBmaXhEZXNjcmlwdGlvbjogXCJVc2UgdGhlIHBhcmFtZXRlcml6ZWQgcXVlcnkgaGVscGVyIGZvciBldmVyeSB1c2VyLWNvbnRyb2xsZWQgdmFsdWUuXCIsXG4gICAgICAgICAgdmVyaWZpY2F0aW9uU3RlcHM6IFtcbiAgICAgICAgICAgIFwiUnVuIHRoZSBTUUwgaW5qZWN0aW9uIHJlZ3Jlc3Npb24gdGVzdC5cIixcbiAgICAgICAgICAgIFwiQ29uZmlybSBhbGwgdXNlci1jb250cm9sbGVkIHF1ZXJ5IHZhbHVlcyB1c2UgcGFyYW1ldGVycy5cIixcbiAgICAgICAgICBdLFxuICAgICAgICAgIHNvdXJjZToge1xuICAgICAgICAgICAgdHlwZTogXCJzY2FuXCIsXG4gICAgICAgICAgICBjb3JyZWxhdGlvbklkOiBcImUyZS1zY2FuLWNvcnJlbGF0aW9uXCIsXG4gICAgICAgICAgICByZXZpc2lvbjogXCJyZW1lZGlhdGlvbi1yZXZpc2lvbi00MlwiLFxuICAgICAgICAgICAgY29tcGxldGVuZXNzOiBcIkNPTVBMRVRFXCIsXG4gICAgICAgICAgfSxcbiAgICAgICAgICBzdGF0dXM6IFwicmVhZHlcIixcbiAgICAgICAgfSxcbiAgICAgICAgY3JlYXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDA6MDAuMDAwWlwiLFxuICAgICAgICB1cGRhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMTowMC4wMDBaXCIsXG4gICAgICB9LFxuICAgICAge1xuICAgICAgICBpZDogcmV2aWV3VGFza0lkLFxuICAgICAgICBwcm9qZWN0SWQ6IFwiZTJlLXByb2plY3RcIixcbiAgICAgICAgdGl0bGU6IFwiUmV2aWV3IGluY29tcGxldGUgU1FMIHJlbWVkaWF0aW9uIGV2aWRlbmNlXCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIkFuIGluY29tcGxldGUgcGxhbiBtdXN0IHN0YXkgYmxvY2tlZCB1bnRpbCBhbiBvcGVyYXRvciByZXZpZXdzIGl0LlwiLFxuICAgICAgICBzdGF0dXM6IFwiZmFpbGVkXCIsXG4gICAgICAgIHByaW9yaXR5OiBcInAxXCIsXG4gICAgICAgIHBoYXNlOiBcIlJlbWVkaWF0aW9uXCIsXG4gICAgICAgIHJlbGF0ZWRGaWxlczogW1wic3JjL2F1dGgvaW5wdXQudHNcIl0sXG4gICAgICAgIHJldHJ5Q291bnQ6IDAsXG4gICAgICAgIG1heFJldHJpZXM6IDIsXG4gICAgICAgIHByb21wdDogcmF3UHJvbXB0LFxuICAgICAgICBhZ2VudFJlc3BvbnNlOiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAga2luZDogXCJBSV9UQVNLX0VYRUNVVElPTl9SRUNFSVBUXCIsXG4gICAgICAgICAgdGVybWluYWxTdGF0dXM6IFwiRkFJTEVEXCIsXG4gICAgICAgICAgdGVybWluYWxSZWFzb246IHJhd0RpYWdub3N0aWMsXG4gICAgICAgIH0pLFxuICAgICAgICByZW1lZGlhdGlvblBsYW46IHtcbiAgICAgICAgICB2ZXJzaW9uOiAxLFxuICAgICAgICAgIHJ1bGVJZDogXCJlMmUtcnVsZS1taXNzaW5nLWV2aWRlbmNlXCIsXG4gICAgICAgICAgcnVsZUNvZGU6IFwiU0VDLTAwMlwiLFxuICAgICAgICAgIHJ1bGVUaXRsZTogXCJJbmNvbXBsZXRlIGV2aWRlbmNlIHJldmlld1wiLFxuICAgICAgICAgIHNldmVyaXR5OiBcImNyaXRpY2FsXCIsXG4gICAgICAgICAgb2NjdXJyZW5jZUNvdW50OiAxLFxuICAgICAgICAgIGV2aWRlbmNlOiBbXSxcbiAgICAgICAgICByZWxhdGVkRmlsZXM6IFtcInNyYy9hdXRoL2lucHV0LnRzXCJdLFxuICAgICAgICAgIGZpeERlc2NyaXB0aW9uOiBudWxsLFxuICAgICAgICAgIHZlcmlmaWNhdGlvblN0ZXBzOiBbXSxcbiAgICAgICAgICBzb3VyY2U6IHtcbiAgICAgICAgICAgIHR5cGU6IFwiZGlzY292ZXJ5XCIsXG4gICAgICAgICAgICBjb3JyZWxhdGlvbklkOiBcImUyZS1kaXNjb3ZlcnktY29ycmVsYXRpb25cIixcbiAgICAgICAgICAgIHJldmlzaW9uOiBudWxsLFxuICAgICAgICAgICAgY29tcGxldGVuZXNzOiBcIlBBUlRJQUxcIixcbiAgICAgICAgICB9LFxuICAgICAgICAgIHN0YXR1czogXCJuZWVkc19yZXZpZXdcIixcbiAgICAgICAgfSxcbiAgICAgICAgY3JlYXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDA6MDAuMDAwWlwiLFxuICAgICAgICB1cGRhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMTowMC4wMDBaXCIsXG4gICAgICB9LFxuICAgICAge1xuICAgICAgICBpZDogdmVyaWZpY2F0aW9uVGFza0lkLFxuICAgICAgICBwcm9qZWN0SWQ6IFwiZTJlLXByb2plY3RcIixcbiAgICAgICAgdGl0bGU6IFwiVmVyaWZ5IHBhcmFtZXRlcml6ZWQgU1FMIHJlbWVkaWF0aW9uXCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIkFuIG9wZXJhdG9yIG11c3QgcmVjb3JkIGV2aWRlbmNlIGZvciBldmVyeSB2ZXJpZmljYXRpb24gY2hlY2suXCIsXG4gICAgICAgIHN0YXR1czogXCJ2ZXJpZnlpbmdcIixcbiAgICAgICAgcHJpb3JpdHk6IFwicDFcIixcbiAgICAgICAgcGhhc2U6IFwiUmVtZWRpYXRpb25cIixcbiAgICAgICAgcmVsYXRlZEZpbGVzOiBbXCJzcmMvYXV0aC9pbnB1dC50c1wiXSxcbiAgICAgICAgcmV0cnlDb3VudDogMCxcbiAgICAgICAgbWF4UmV0cmllczogMixcbiAgICAgICAgcHJvbXB0OiByYXdQcm9tcHQsXG4gICAgICAgIHJlbWVkaWF0aW9uUGxhbjoge1xuICAgICAgICAgIHZlcnNpb246IDEsXG4gICAgICAgICAgcnVsZUlkOiBcImUyZS1ydWxlLXZlcmlmaWNhdGlvblwiLFxuICAgICAgICAgIHJ1bGVDb2RlOiBcIlNFQy0wMDNcIixcbiAgICAgICAgICBydWxlVGl0bGU6IFwiUGFyYW1ldGVyaXplZCBTUUwgcmVtZWRpYXRpb25cIixcbiAgICAgICAgICBzZXZlcml0eTogXCJoaWdoXCIsXG4gICAgICAgICAgb2NjdXJyZW5jZUNvdW50OiAyLFxuICAgICAgICAgIGV2aWRlbmNlOiBbXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIGZpbGU6IFwic3JjL2F1dGgvaW5wdXQudHNcIixcbiAgICAgICAgICAgICAgbGluZTogMTAsXG4gICAgICAgICAgICAgIHNuaXBwZXQ6IFwicXVlcnkodXNlcklucHV0KVwiLFxuICAgICAgICAgICAgICBvY2N1cnJlbmNlczogMSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgXSxcbiAgICAgICAgICByZWxhdGVkRmlsZXM6IFtcInNyYy9hdXRoL2lucHV0LnRzXCJdLFxuICAgICAgICAgIGZpeERlc2NyaXB0aW9uOiBcIlVzZSB0aGUgcGFyYW1ldGVyaXplZCBxdWVyeSBoZWxwZXIgZm9yIGV2ZXJ5IHVzZXItY29udHJvbGxlZCB2YWx1ZS5cIixcbiAgICAgICAgICB2ZXJpZmljYXRpb25TdGVwczogW1xuICAgICAgICAgICAgXCJSdW4gdGhlIFNRTCBpbmplY3Rpb24gcmVncmVzc2lvbiB0ZXN0LlwiLFxuICAgICAgICAgICAgXCJDb25maXJtIGFsbCB1c2VyLWNvbnRyb2xsZWQgcXVlcnkgdmFsdWVzIHVzZSBwYXJhbWV0ZXJzLlwiLFxuICAgICAgICAgIF0sXG4gICAgICAgICAgc291cmNlOiB7XG4gICAgICAgICAgICB0eXBlOiBcInNjYW5cIixcbiAgICAgICAgICAgIGNvcnJlbGF0aW9uSWQ6IFwiZTJlLXZlcmlmaWNhdGlvbi1jb3JyZWxhdGlvblwiLFxuICAgICAgICAgICAgcmV2aXNpb246IFwicmVtZWRpYXRpb24tcmV2aXNpb24tNDNcIixcbiAgICAgICAgICAgIGNvbXBsZXRlbmVzczogXCJDT01QTEVURVwiLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgc3RhdHVzOiBcInJlYWR5XCIsXG4gICAgICAgIH0sXG4gICAgICAgIGNyZWF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAwOjAwLjAwMFpcIixcbiAgICAgICAgdXBkYXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDM6MDAuMDAwWlwiLFxuICAgICAgfSxcbiAgICBdO1xuICAgIGNvbnN0IGFjdGlvblJlcXVlc3RzOiBzdHJpbmdbXSA9IFtdO1xuICAgIGNvbnN0IHZlcmlmaWNhdGlvblJlcXVlc3RzOiBBcnJheTxSZWNvcmQ8c3RyaW5nLCB1bmtub3duPj4gPSBbXTtcbiAgICBhd2FpdCBpbnN0YWxsQXBpRml4dHVyZXMocGFnZSwge1xuICAgICAgdGFza0FjdGlvbnM6IHtcbiAgICAgICAgdGFza3M6IHJlbWVkaWF0aW9uVGFza3MsXG4gICAgICAgIHJlcXVlc3RzOiBhY3Rpb25SZXF1ZXN0cyxcbiAgICAgICAgdmVyaWZpY2F0aW9uUmVxdWVzdHMsXG4gICAgICB9LFxuICAgIH0pO1xuICAgIGF3YWl0IHByb2dyYW1tYXRpY1NpZ25JbihwYWdlKTtcbiAgICBhd2FpdCBvcGVuTmF2aWdhdGlvbihwYWdlLCBcIlRhc2tzXCIsIGAke0RBU0hCT0FSRF9QQVRIfXRhc2tzYCk7XG5cbiAgICBjb25zdCByZWFkeVJvdyA9IHBhZ2UuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHtcbiAgICAgIG5hbWU6IC90YXNrIEV4ZWN1dGUgU1FMIGlucHV0IHNhbml0aXphdGlvbiByZW1lZGlhdGlvbi8sXG4gICAgfSk7XG4gICAgYXdhaXQgZXhwZWN0KHJlYWR5Um93KS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlLmdldEJ5VGl0bGUoXCJFeGVjdXRlXCIpKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IHJlYWR5Um93LmNsaWNrKCk7XG5cbiAgICBjb25zdCByZWFkeURldGFpbHMgPSBwYWdlLmxvY2F0b3IoYCN0YXNrLWRldGFpbHMtJHtyZWFkeVRhc2tJZH1gKTtcbiAgICBjb25zdCByZWFkeVBsYW4gPSByZWFkeURldGFpbHMuZ2V0QnlSb2xlKFwicmVnaW9uXCIsIHtcbiAgICAgIG5hbWU6IFwiUmVtZWRpYXRpb24gcGxhblwiLFxuICAgIH0pO1xuICAgIGF3YWl0IGV4cGVjdChyZWFkeVBsYW4pLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KHJlYWR5UGxhbikudG9Db250YWluVGV4dChcIlNFQy0wMDFcIik7XG4gICAgYXdhaXQgZXhwZWN0KHJlYWR5UGxhbikudG9Db250YWluVGV4dChcIlVuc2FuaXRpemVkIFNRTCBpbnB1dFwiKTtcbiAgICBhd2FpdCBleHBlY3QocmVhZHlQbGFuKS50b0NvbnRhaW5UZXh0KFwiaGlnaFwiKTtcbiAgICBhd2FpdCBleHBlY3QocmVhZHlQbGFuKS50b0NvbnRhaW5UZXh0KFwiMiBvY2N1cnJlbmNlKHMpXCIpO1xuICAgIGF3YWl0IGV4cGVjdChyZWFkeVBsYW4pLnRvQ29udGFpblRleHQoXCJzcmMvYXV0aC9pbnB1dC50czoxMFwiKTtcbiAgICBhd2FpdCBleHBlY3QocmVhZHlQbGFuKS50b0NvbnRhaW5UZXh0KFwic3JjL2F1dGgvaW5wdXQudHM6NDRcIik7XG4gICAgYXdhaXQgZXhwZWN0KHJlYWR5UGxhbikudG9Db250YWluVGV4dChcIisxIG1vcmUgZXZpZGVuY2UgaXRlbXNcIik7XG4gICAgYXdhaXQgZXhwZWN0KHJlYWR5UGxhbikubm90LnRvQ29udGFpblRleHQoXCJzcmMvYXV0aC9pbnB1dC50czo1MlwiKTtcbiAgICBhd2FpdCBleHBlY3QocmVhZHlQbGFuKS50b0NvbnRhaW5UZXh0KFxuICAgICAgXCJVc2UgdGhlIHBhcmFtZXRlcml6ZWQgcXVlcnkgaGVscGVyIGZvciBldmVyeSB1c2VyLWNvbnRyb2xsZWQgdmFsdWUuXCIsXG4gICAgKTtcbiAgICBhd2FpdCBleHBlY3QocmVhZHlQbGFuKS50b0NvbnRhaW5UZXh0KFwiUnVuIHRoZSBTUUwgaW5qZWN0aW9uIHJlZ3Jlc3Npb24gdGVzdC5cIik7XG4gICAgYXdhaXQgZXhwZWN0KHJlYWR5UGxhbikudG9Db250YWluVGV4dChcIkNvbmZpcm0gYWxsIHVzZXItY29udHJvbGxlZCBxdWVyeSB2YWx1ZXMgdXNlIHBhcmFtZXRlcnMuXCIpO1xuICAgIGF3YWl0IGV4cGVjdChyZWFkeVBsYW4pLnRvQ29udGFpblRleHQoXCJSZWFkeSB0byBleGVjdXRlXCIpO1xuICAgIGF3YWl0IGV4cGVjdChyZWFkeVBsYW4pLnRvQ29udGFpblRleHQoXCJTb3VyY2U6IHNjYW5cIik7XG4gICAgYXdhaXQgZXhwZWN0KHJlYWR5UGxhbikudG9Db250YWluVGV4dChcInJldmlzaW9uIHJlbWVkaWF0aW9uLVwiKTtcbiAgICBhd2FpdCBleHBlY3QocmVhZHlEZXRhaWxzLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiRGV0YWlsc1wiIH0pKS50b0JlVmlzaWJsZSgpO1xuXG4gICAgYXdhaXQgcGFnZS5nZXRCeVRpdGxlKFwiRXhlY3V0ZVwiKS5jbGljaygpO1xuICAgIGF3YWl0IGV4cGVjdC5wb2xsKCgpID0+IGFjdGlvblJlcXVlc3RzLmxlbmd0aCkudG9CZSgxKTtcbiAgICBleHBlY3QoYWN0aW9uUmVxdWVzdHNbMF0pLnRvQmUoYGV4ZWN1dGU6JHtyZWFkeVRhc2tJZH1gKTtcbiAgICBhd2FpdCBleHBlY3QocmVhZHlSb3cpLnRvQ29udGFpblRleHQoXCJydW5uaW5nXCIpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlLmdldEJ5VGl0bGUoXCJFeGVjdXRlXCIpKS50b0hhdmVDb3VudCgwKTtcblxuICAgIGNvbnN0IHJldmlld1JvdyA9IHBhZ2UuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHtcbiAgICAgIG5hbWU6IC90YXNrIFJldmlldyBpbmNvbXBsZXRlIFNRTCByZW1lZGlhdGlvbiBldmlkZW5jZS8sXG4gICAgfSk7XG4gICAgYXdhaXQgcmV2aWV3Um93LmNsaWNrKCk7XG4gICAgY29uc3QgcmV2aWV3RGV0YWlscyA9IHBhZ2UubG9jYXRvcihgI3Rhc2stZGV0YWlscy0ke3Jldmlld1Rhc2tJZH1gKTtcbiAgICBjb25zdCByZXZpZXdQbGFuID0gcmV2aWV3RGV0YWlscy5nZXRCeVJvbGUoXCJyZWdpb25cIiwge1xuICAgICAgbmFtZTogXCJSZW1lZGlhdGlvbiBwbGFuXCIsXG4gICAgfSk7XG4gICAgYXdhaXQgZXhwZWN0KHJldmlld1BsYW4pLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KHJldmlld1BsYW4pLnRvQ29udGFpblRleHQoXCJTRUMtMDAyXCIpO1xuICAgIGF3YWl0IGV4cGVjdChyZXZpZXdQbGFuKS50b0NvbnRhaW5UZXh0KFwiSW5jb21wbGV0ZSBldmlkZW5jZSByZXZpZXdcIik7XG4gICAgYXdhaXQgZXhwZWN0KHJldmlld1BsYW4pLnRvQ29udGFpblRleHQoXCJjcml0aWNhbFwiKTtcbiAgICBhd2FpdCBleHBlY3QocmV2aWV3UGxhbikudG9Db250YWluVGV4dChcIjEgb2NjdXJyZW5jZShzKVwiKTtcbiAgICBhd2FpdCBleHBlY3QocmV2aWV3UGxhbikudG9Db250YWluVGV4dChcIk5lZWRzIHJldmlld1wiKTtcbiAgICBhd2FpdCBleHBlY3QocmV2aWV3UGxhbikudG9Db250YWluVGV4dChcIk5vIGJvdW5kZWQgZXZpZGVuY2Ugd2FzIHJldGFpbmVkLlwiKTtcbiAgICBhd2FpdCBleHBlY3QocmV2aWV3UGxhbikudG9Db250YWluVGV4dChcIk5vIHZlcmlmaWNhdGlvbiBzdGVwcyBzdXBwbGllZC5cIik7XG4gICAgYXdhaXQgZXhwZWN0KHJldmlld1BsYW4pLnRvQ29udGFpblRleHQoXCJTb3VyY2U6IGRpc2NvdmVyeVwiKTtcbiAgICBhd2FpdCBleHBlY3QocmV2aWV3UGxhbikudG9Db250YWluVGV4dChcInJldmlzaW9uIHVuYXZhaWxhYmxlXCIpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlLmdldEJ5VGl0bGUoXCJSZXRyeVwiKSkudG9CZVZpc2libGUoKTtcblxuICAgIGF3YWl0IHBhZ2UuZ2V0QnlUaXRsZShcIlJldHJ5XCIpLmNsaWNrKCk7XG4gICAgYXdhaXQgZXhwZWN0LnBvbGwoKCkgPT4gYWN0aW9uUmVxdWVzdHMubGVuZ3RoKS50b0JlKDIpO1xuICAgIGV4cGVjdChhY3Rpb25SZXF1ZXN0c1sxXSkudG9CZShgcmV0cnk6JHtyZXZpZXdUYXNrSWR9YCk7XG4gICAgYXdhaXQgZXhwZWN0KHJldmlld1JvdykudG9Db250YWluVGV4dChcInF1ZXVlZFwiKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5nZXRCeVRpdGxlKFwiUmV0cnlcIikpLnRvSGF2ZUNvdW50KDApO1xuXG4gICAgY29uc3QgdmVyaWZpY2F0aW9uUm93ID0gcGFnZS5nZXRCeVJvbGUoXCJidXR0b25cIiwge1xuICAgICAgbmFtZTogL3Rhc2sgVmVyaWZ5IHBhcmFtZXRlcml6ZWQgU1FMIHJlbWVkaWF0aW9uLyxcbiAgICB9KTtcbiAgICBhd2FpdCB2ZXJpZmljYXRpb25Sb3cuY2xpY2soKTtcbiAgICBjb25zdCB2ZXJpZmljYXRpb25EZXRhaWxzID0gcGFnZS5sb2NhdG9yKFxuICAgICAgYCN0YXNrLWRldGFpbHMtJHt2ZXJpZmljYXRpb25UYXNrSWR9YCxcbiAgICApO1xuICAgIGNvbnN0IHZlcmlmaWNhdGlvblBsYW4gPSB2ZXJpZmljYXRpb25EZXRhaWxzLmdldEJ5Um9sZShcInJlZ2lvblwiLCB7XG4gICAgICBuYW1lOiBcIlJlbWVkaWF0aW9uIHBsYW5cIixcbiAgICB9KTtcbiAgICBjb25zdCB2ZXJpZmljYXRpb25DaGVja3MgPSB2ZXJpZmljYXRpb25EZXRhaWxzLmdldEJ5Um9sZShcInJlZ2lvblwiLCB7XG4gICAgICBuYW1lOiBcIk9wZXJhdG9yIHZlcmlmaWNhdGlvbiBjaGVja3NcIixcbiAgICB9KTtcbiAgICBhd2FpdCBleHBlY3QodmVyaWZpY2F0aW9uUGxhbikudG9Db250YWluVGV4dChcIlNFQy0wMDNcIik7XG4gICAgYXdhaXQgZXhwZWN0KHZlcmlmaWNhdGlvblBsYW4pLnRvQ29udGFpblRleHQoXCJSZWFkeSB0byBleGVjdXRlXCIpO1xuICAgIGF3YWl0IHZlcmlmaWNhdGlvbkRldGFpbHNcbiAgICAgIC5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIlJ1biBhbmQgcmVjb3JkIHZlcmlmaWNhdGlvbiBjaGVja3NcIiB9KVxuICAgICAgLmNsaWNrKCk7XG4gICAgYXdhaXQgZXhwZWN0KHZlcmlmaWNhdGlvbkNoZWNrcykudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QodmVyaWZpY2F0aW9uQ2hlY2tzKS50b0NvbnRhaW5UZXh0KFwiSW5jb21wbGV0ZVwiKTtcblxuICAgIGNvbnN0IGZpcnN0R3VpZGFuY2UgPSBcIlJ1biB0aGUgU1FMIGluamVjdGlvbiByZWdyZXNzaW9uIHRlc3QuXCI7XG4gICAgY29uc3Qgc2Vjb25kR3VpZGFuY2UgPVxuICAgICAgXCJDb25maXJtIGFsbCB1c2VyLWNvbnRyb2xsZWQgcXVlcnkgdmFsdWVzIHVzZSBwYXJhbWV0ZXJzLlwiO1xuICAgIGNvbnN0IGZpcnN0RXZpZGVuY2UgPSB2ZXJpZmljYXRpb25DaGVja3MuZ2V0QnlMYWJlbChcbiAgICAgIGBFdmlkZW5jZSBmb3IgJHtmaXJzdEd1aWRhbmNlfWAsXG4gICAgKTtcbiAgICBjb25zdCBzZWNvbmRFdmlkZW5jZSA9IHZlcmlmaWNhdGlvbkNoZWNrcy5nZXRCeUxhYmVsKFxuICAgICAgYEV2aWRlbmNlIGZvciAke3NlY29uZEd1aWRhbmNlfWAsXG4gICAgKTtcbiAgICBjb25zdCBwYXNzQnV0dG9ucyA9IHZlcmlmaWNhdGlvbkNoZWNrcy5nZXRCeVJvbGUoXCJidXR0b25cIiwge1xuICAgICAgbmFtZTogXCJSZWNvcmQgcGFzc2VkXCIsXG4gICAgfSk7XG4gICAgY29uc3QgZmFpbGVkQnV0dG9ucyA9IHZlcmlmaWNhdGlvbkNoZWNrcy5nZXRCeVJvbGUoXCJidXR0b25cIiwge1xuICAgICAgbmFtZTogXCJSZWNvcmQgZmFpbGVkXCIsXG4gICAgfSk7XG4gICAgYXdhaXQgZXhwZWN0KHBhc3NCdXR0b25zLm50aCgwKSkudG9CZURpc2FibGVkKCk7XG4gICAgYXdhaXQgZmlyc3RFdmlkZW5jZS5maWxsKFwiVGhlIHJlZ3Jlc3Npb24gdGVzdCBzdGlsbCBmYWlscyBiZWZvcmUgdGhlIGZpeC5cIik7XG4gICAgYXdhaXQgZmFpbGVkQnV0dG9ucy5udGgoMCkuY2xpY2soKTtcbiAgICBhd2FpdCBleHBlY3QucG9sbCgoKSA9PiB2ZXJpZmljYXRpb25SZXF1ZXN0cy5sZW5ndGgpLnRvQmUoMSk7XG4gICAgZXhwZWN0KHZlcmlmaWNhdGlvblJlcXVlc3RzWzBdKS50b01hdGNoT2JqZWN0KHtcbiAgICAgIHRhc2tJZDogdmVyaWZpY2F0aW9uVGFza0lkLFxuICAgICAgY2hlY2tJZDogXCJydWxlLXZlcmlmaWNhdGlvbi0xXCIsXG4gICAgICBwYXNzZWQ6IGZhbHNlLFxuICAgIH0pO1xuICAgIGF3YWl0IGV4cGVjdCh2ZXJpZmljYXRpb25DaGVja3MpLnRvQ29udGFpblRleHQoXCJJbmNvbXBsZXRlXCIpO1xuICAgIGF3YWl0IGV4cGVjdCh2ZXJpZmljYXRpb25Sb3cpLnRvQ29udGFpblRleHQoXCJ2ZXJpZnlpbmdcIik7XG5cbiAgICBhd2FpdCBmaXJzdEV2aWRlbmNlLmZpbGwoXCJUaGUgZm9jdXNlZCByZWdyZXNzaW9uIHRlc3QgcGFzc2VzIGFmdGVyIHRoZSBmaXguXCIpO1xuICAgIGF3YWl0IHBhc3NCdXR0b25zLm50aCgwKS5jbGljaygpO1xuICAgIGF3YWl0IGV4cGVjdC5wb2xsKCgpID0+IHZlcmlmaWNhdGlvblJlcXVlc3RzLmxlbmd0aCkudG9CZSgyKTtcbiAgICBleHBlY3QodmVyaWZpY2F0aW9uUmVxdWVzdHNbMV0pLnRvTWF0Y2hPYmplY3Qoe1xuICAgICAgdGFza0lkOiB2ZXJpZmljYXRpb25UYXNrSWQsXG4gICAgICBjaGVja0lkOiBcInJ1bGUtdmVyaWZpY2F0aW9uLTFcIixcbiAgICAgIHBhc3NlZDogdHJ1ZSxcbiAgICAgIGV2aWRlbmNlOiBcIlRoZSBmb2N1c2VkIHJlZ3Jlc3Npb24gdGVzdCBwYXNzZXMgYWZ0ZXIgdGhlIGZpeC5cIixcbiAgICB9KTtcbiAgICBhd2FpdCBleHBlY3QodmVyaWZpY2F0aW9uQ2hlY2tzKS50b0NvbnRhaW5UZXh0KFwiSW5jb21wbGV0ZVwiKTtcblxuICAgIGF3YWl0IHNlY29uZEV2aWRlbmNlLmZpbGwoXG4gICAgICBcIkFsbCB1c2VyLWNvbnRyb2xsZWQgcXVlcnkgdmFsdWVzIHVzZSB0aGUgcGFyYW1ldGVyaXplZCBoZWxwZXIuXCIsXG4gICAgKTtcbiAgICBhd2FpdCBwYXNzQnV0dG9ucy5udGgoMSkuY2xpY2soKTtcbiAgICBhd2FpdCBleHBlY3QucG9sbCgoKSA9PiB2ZXJpZmljYXRpb25SZXF1ZXN0cy5sZW5ndGgpLnRvQmUoMyk7XG4gICAgZXhwZWN0KHZlcmlmaWNhdGlvblJlcXVlc3RzWzJdKS50b01hdGNoT2JqZWN0KHtcbiAgICAgIHRhc2tJZDogdmVyaWZpY2F0aW9uVGFza0lkLFxuICAgICAgY2hlY2tJZDogXCJydWxlLXZlcmlmaWNhdGlvbi0yXCIsXG4gICAgICBwYXNzZWQ6IHRydWUsXG4gICAgICBldmlkZW5jZTogXCJBbGwgdXNlci1jb250cm9sbGVkIHF1ZXJ5IHZhbHVlcyB1c2UgdGhlIHBhcmFtZXRlcml6ZWQgaGVscGVyLlwiLFxuICAgIH0pO1xuICAgIGF3YWl0IGV4cGVjdCh2ZXJpZmljYXRpb25Sb3cpLnRvQ29udGFpblRleHQoXCJjb21wbGV0ZWRcIik7XG4gICAgYXdhaXQgdmVyaWZpY2F0aW9uRGV0YWlscy5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIkRldGFpbHNcIiB9KS5jbGljaygpO1xuICAgIGF3YWl0IGV4cGVjdCh2ZXJpZmljYXRpb25QbGFuKS50b0NvbnRhaW5UZXh0KFwiVmVyaWZpZWRcIik7XG4gICAgYXdhaXQgdmVyaWZpY2F0aW9uRGV0YWlscy5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIkxvZ3NcIiB9KS5jbGljaygpO1xuICAgIGF3YWl0IGV4cGVjdCh2ZXJpZmljYXRpb25DaGVja3MpLnRvQ29udGFpblRleHQoXCJWZXJpZmllZFwiKTtcbiAgICBhd2FpdCBleHBlY3QodmVyaWZpY2F0aW9uRGV0YWlscykudG9Db250YWluVGV4dChcbiAgICAgIFwiVGFzayBjb21wbGV0ZWQgYW5kIHZlcmlmaWVkIGJ5IHRoZSBzZXJ2ZXIuXCIsXG4gICAgKTtcblxuICAgIGF3YWl0IHBhZ2UucmVsb2FkKCk7XG4gICAgY29uc3QgcmVsb2FkZWRWZXJpZmljYXRpb25Sb3cgPSBwYWdlLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7XG4gICAgICBuYW1lOiAvdGFzayBWZXJpZnkgcGFyYW1ldGVyaXplZCBTUUwgcmVtZWRpYXRpb24vLFxuICAgIH0pO1xuICAgIGF3YWl0IGV4cGVjdChyZWxvYWRlZFZlcmlmaWNhdGlvblJvdykudG9Db250YWluVGV4dChcImNvbXBsZXRlZFwiKTtcbiAgICBhd2FpdCByZWxvYWRlZFZlcmlmaWNhdGlvblJvdy5jbGljaygpO1xuICAgIGNvbnN0IHJlbG9hZGVkRGV0YWlscyA9IHBhZ2UubG9jYXRvcihcbiAgICAgIGAjdGFzay1kZXRhaWxzLSR7dmVyaWZpY2F0aW9uVGFza0lkfWAsXG4gICAgKTtcbiAgICBhd2FpdCByZWxvYWRlZERldGFpbHMuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJMb2dzXCIgfSkuY2xpY2soKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICByZWxvYWRlZERldGFpbHMuZ2V0QnlSb2xlKFwicmVnaW9uXCIsIHtcbiAgICAgICAgbmFtZTogXCJPcGVyYXRvciB2ZXJpZmljYXRpb24gY2hlY2tzXCIsXG4gICAgICB9KSxcbiAgICApLnRvQ29udGFpblRleHQoXCJWZXJpZmllZFwiKTtcbiAgICBhd2FpdCBleHBlY3QocmVsb2FkZWREZXRhaWxzKS50b0NvbnRhaW5UZXh0KFxuICAgICAgXCJUYXNrIGNvbXBsZXRlZCBhbmQgdmVyaWZpZWQgYnkgdGhlIHNlcnZlci5cIixcbiAgICApO1xuXG4gICAgY29uc3QgdmlzaWJsZVRleHQgPSBhd2FpdCBwYWdlLmxvY2F0b3IoXCJib2R5XCIpLmlubmVyVGV4dCgpO1xuICAgIGV4cGVjdCh2aXNpYmxlVGV4dCkubm90LnRvQ29udGFpbihyYXdQcm9tcHQpO1xuICAgIGV4cGVjdCh2aXNpYmxlVGV4dCkubm90LnRvQ29udGFpbihyYXdEaWFnbm9zdGljKTtcbiAgICBhd2FpdCBleHBlY3ROb0hvcml6b250YWxPdmVyZmxvdyhwYWdlKTtcbiAgfSk7XG5cbiAgdGVzdChcImNvbnZlcmdlcyB0d28gYnJvd3NlciBzZXNzaW9ucyBhY3Jvc3MgcmVsb2FkLCByZWNvbm5lY3QsIHN0YWxlIHJlc3VsdHMsIGFuZCBBUEkgcmVzdGFydFwiLCBhc3luYyAoe1xuICAgIGJyb3dzZXIsXG4gICAgcGFnZSxcbiAgfSkgPT4ge1xuICAgIHRlc3Quc2tpcChcbiAgICAgICFwcm9jZXNzLmVudi5EQVNIQk9BUkRfRTJFX0NPTlRST0xfVVJMLFxuICAgICAgXCJUaGUgbXVsdGktcHJvY2VzcyBjb252ZXJnZW5jZSBjYW1wYWlnbiBydW5zIG9ubHkgdW5kZXIgdGhlIHJlbGVhc2UgcnVubmVyLlwiLFxuICAgICk7XG4gICAgdGVzdC5zZXRUaW1lb3V0KDkwXzAwMCk7XG5cbiAgICBjb25zdCBzZWNvbmRDb250ZXh0ID0gYXdhaXQgYnJvd3Nlci5uZXdDb250ZXh0KCk7XG4gICAgY29uc3Qgc2Vjb25kUGFnZSA9IGF3YWl0IHNlY29uZENvbnRleHQubmV3UGFnZSgpO1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCBQcm9taXNlLmFsbChbaW5zdGFsbEFwaUZpeHR1cmVzKHBhZ2UpLCBpbnN0YWxsQXBpRml4dHVyZXMoc2Vjb25kUGFnZSldKTtcbiAgICAgIGF3YWl0IFByb21pc2UuYWxsKFtwcm9ncmFtbWF0aWNTaWduSW4ocGFnZSksIHByb2dyYW1tYXRpY1NpZ25JbihzZWNvbmRQYWdlKV0pO1xuICAgICAgYXdhaXQgUHJvbWlzZS5hbGwoW1xuICAgICAgICBwYWdlLmdvdG8oREFTSEJPQVJEX1BBVEgpLFxuICAgICAgICBzZWNvbmRQYWdlLmdvdG8oYCR7REFTSEJPQVJEX1BBVEh9YWlgKSxcbiAgICAgIF0pO1xuICAgICAgYXdhaXQgZXhwZWN0RGFzaGJvYXJkUmVhZHkocGFnZSk7XG4gICAgICBhd2FpdCBleHBlY3Qoc2Vjb25kUGFnZS5sb2NhdG9yKFwidGV4dGFyZWFcIikuZmlyc3QoKSkudG9CZVZpc2libGUoKTtcblxuICAgICAgLy8gQSByZXNwb25zZSB0aGF0IGFycml2ZXMgYWZ0ZXIgYSBuZXdlciByZXF1ZXN0IG11c3Qgbm90IHJlcGxhY2UgdGhlXG4gICAgICAvLyB2aXNpYmxlIHJlYWR5IHN0YXRlIHdpdGggc3RhbGUgZGF0YS4gS2VlcCB0aGUgZGVsYXkgYm91bmRlZCBzbyBhXG4gICAgICAvLyBodW5nIHJlcXVlc3QgY2Fubm90IG1ha2UgdGhpcyBjYW1wYWlnbiBwYXNzIGluZGVmaW5pdGVseS5cbiAgICAgIGNvbnN0IGN1cnJlbnREYXNoYm9hcmRGaXh0dXJlID0ge1xuICAgICAgICAuLi5kYXNoYm9hcmRGaXh0dXJlLFxuICAgICAgICAvLyBUaGUgcmVsZWFzZSBydW5uZXIgc3RhcnRzIGFnYWluc3QgcmVhbCBkZXZlbG9wbWVudCBkYXRhLCB3aG9zZVxuICAgICAgICAvLyBzZXJ2ZXItb3duZWQgcmV2aXNpb24gbWF5IGJlIG5ld2VyIHRoYW4gdGhlIHN0YXRpYyBmaXh0dXJlIGJlbG93LlxuICAgICAgICAvLyBLZWVwIHRoaXMgc3ludGhldGljIFwiY3VycmVudFwiIHJlc3BvbnNlIGFoZWFkIG9mIHRoYXQgd2F0ZXJtYXJrIHNvXG4gICAgICAgIC8vIHRoZSB0ZXN0IGV4ZXJjaXNlcyBzdGFsZS1yZXNwb25zZSByZWplY3Rpb24gcmF0aGVyIHRoYW4gZml4dHVyZVxuICAgICAgICAvLyByZWplY3Rpb24uXG4gICAgICAgIGZyZXNobmVzc1JldmlzaW9uOiBcIjIwOTktMDEtMDFUMDA6MDM6MDAuMDAwWlwiLFxuICAgICAgICBwcm9qZWN0U2NvcmVzOiBbeyAuLi5kYXNoYm9hcmRGaXh0dXJlLnByb2plY3RTY29yZXNbMF0sIHByb2plY3ROYW1lOiBcIkNvbmN1cnJlbnQgUHJvamVjdFwiLCBzY29yZTogOTcgfV0sXG4gICAgICAgIGFjdGl2ZVRhc2tDb3VudDogMSxcbiAgICAgICAgdGFza1N0YXR1c0JyZWFrZG93bjogeyBwZW5kaW5nOiAwLCBydW5uaW5nOiAxIH0sXG4gICAgICB9O1xuICAgICAgbGV0IHJlZnJlc2hDb3VudCA9IDA7XG4gICAgICBsZXQgcmVsZWFzZVN0YWxlUmVzcG9uc2UhOiAoKSA9PiB2b2lkO1xuICAgICAgY29uc3Qgc3RhbGVSZXNwb25zZVJlbGVhc2VkID0gbmV3IFByb21pc2U8dm9pZD4oKHJlc29sdmUpID0+IHtcbiAgICAgICAgcmVsZWFzZVN0YWxlUmVzcG9uc2UgPSByZXNvbHZlO1xuICAgICAgfSk7XG4gICAgICBhd2FpdCBwYWdlLnJvdXRlKFwiKiovYXBpL2Rhc2hib2FyZFwiLCBhc3luYyAocm91dGUpID0+IHtcbiAgICAgICAgcmVmcmVzaENvdW50ICs9IDE7XG4gICAgICAgIGlmIChyZWZyZXNoQ291bnQgPT09IDEpIHJldHVybiByb3V0ZS5mdWxmaWxsKGpzb25SZXNwb25zZShjdXJyZW50RGFzaGJvYXJkRml4dHVyZSkpO1xuICAgICAgICBhd2FpdCBzdGFsZVJlc3BvbnNlUmVsZWFzZWQ7XG4gICAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKGpzb25SZXNwb25zZShkYXNoYm9hcmRGaXh0dXJlKSk7XG4gICAgICB9KTtcbiAgICAgIGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJSZWZyZXNoIHN0YXR1c1wiIH0pLmNsaWNrKCk7XG4gICAgICBhd2FpdCBleHBlY3QocGFnZS5nZXRCeVRleHQoXCJDb25jdXJyZW50IFByb2plY3RcIiwgeyBleGFjdDogdHJ1ZSB9KSkudG9CZVZpc2libGUoKTtcbiAgICAgIGF3YWl0IGV4cGVjdChwYWdlLmdldEJ5VGV4dChcIjk3XCIsIHsgZXhhY3Q6IHRydWUgfSkpLnRvQmVWaXNpYmxlKCk7XG4gICAgICBjb25zdCBzdGFsZVJlZnJlc2ggPSBwYWdlLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiUmVmcmVzaCBzdGF0dXNcIiB9KS5jbGljaygpO1xuICAgICAgYXdhaXQgZXhwZWN0LnBvbGwoKCkgPT4gcmVmcmVzaENvdW50KS50b0JlKDIpO1xuICAgICAgcmVsZWFzZVN0YWxlUmVzcG9uc2UoKTtcbiAgICAgIGF3YWl0IHN0YWxlUmVmcmVzaDtcbiAgICAgIGF3YWl0IGV4cGVjdERhc2hib2FyZFJlYWR5KHBhZ2UpO1xuICAgICAgYXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlUZXh0KFwiQ29uY3VycmVudCBQcm9qZWN0XCIsIHsgZXhhY3Q6IHRydWUgfSkpLnRvQmVWaXNpYmxlKCk7XG4gICAgICBhd2FpdCBleHBlY3QocGFnZS5nZXRCeVRleHQoXCI5N1wiLCB7IGV4YWN0OiB0cnVlIH0pKS50b0JlVmlzaWJsZSgpO1xuICAgICAgYXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlUZXh0KFwiMVwiLCB7IGV4YWN0OiB0cnVlIH0pLmZpcnN0KCkpLnRvQmVWaXNpYmxlKCk7XG5cbiAgICAgIC8vIFNpbXVsYXRlIGEgZHJvcHBlZCBjb25uZWN0aW9uIGluIHRoZSBzZWNvbmQgYnJvd3NlciBhbmQgYXNzZXJ0IHRoZVxuICAgICAgLy8gcmVjb3ZlcnkgYWN0aW9uIHJlbmRlcmVkIGJ5IHRoZSBkYXNoYm9hcmQsIHRoZW4gbGV0IHRoZSBuZXh0IHJlcXVlc3RcbiAgICAgIC8vIHJlY29ubmVjdCBub3JtYWxseS5cbiAgICAgIGxldCByZWNvbm5lY3RBdHRlbXB0ID0gMDtcbiAgICAgIGF3YWl0IHNlY29uZFBhZ2UuZ290byhEQVNIQk9BUkRfUEFUSCk7XG4gICAgICBhd2FpdCBleHBlY3REYXNoYm9hcmRSZWFkeShzZWNvbmRQYWdlKTtcbiAgICAgIGF3YWl0IHNlY29uZFBhZ2Uucm91dGUoXCIqKi9hcGkvZGFzaGJvYXJkXCIsIGFzeW5jIChyb3V0ZSkgPT4ge1xuICAgICAgICByZWNvbm5lY3RBdHRlbXB0ICs9IDE7XG4gICAgICAgIC8vIHVzZUdldERhc2hib2FyZCByZXRyaWVzIG9uY2U7IGhvbGQgYm90aCBib3VuZGVkIGF0dGVtcHRzIHNvIHRoZVxuICAgICAgICAvLyByZW5kZXJlZCBlcnJvciBzdGF0ZSBpcyBvYnNlcnZhYmxlIGJlZm9yZSB0aGUgb3BlcmF0b3IgcmV0cmllcy5cbiAgICAgICAgaWYgKHJlY29ubmVjdEF0dGVtcHQgPD0gMikge1xuICAgICAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKFxuICAgICAgICAgICAganNvblJlc3BvbnNlKHsgZXJyb3I6IFwiY29udHJvbGxlZCByZWNvbm5lY3QgaW50ZXJydXB0aW9uXCIgfSwgNTAzKSxcbiAgICAgICAgICApO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiByb3V0ZS5jb250aW51ZSgpO1xuICAgICAgfSk7XG4gICAgICBhd2FpdCBzZWNvbmRQYWdlLnJlbG9hZCgpO1xuICAgICAgYXdhaXQgZXhwZWN0KFxuICAgICAgICBzZWNvbmRQYWdlLmdldEJ5Um9sZShcImhlYWRpbmdcIiwgeyBuYW1lOiBcIkZhaWxlZCB0byBsb2FkIGRhc2hib2FyZFwiIH0pLFxuICAgICAgKS50b0JlVmlzaWJsZSgpO1xuICAgICAgYXdhaXQgZXhwZWN0KFxuICAgICAgICBzZWNvbmRQYWdlLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiUmV0cnkgQ29ubmVjdGlvblwiIH0pLFxuICAgICAgKS50b0JlVmlzaWJsZSgpO1xuICAgICAgYXdhaXQgc2Vjb25kUGFnZS51bnJvdXRlKFwiKiovYXBpL2Rhc2hib2FyZFwiKTtcbiAgICAgIGF3YWl0IHNlY29uZFBhZ2UuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJSZXRyeSBDb25uZWN0aW9uXCIgfSkuY2xpY2soKTtcbiAgICAgIGF3YWl0IGV4cGVjdERhc2hib2FyZFJlYWR5KHNlY29uZFBhZ2UpO1xuXG4gICAgICBhd2FpdCByZXN0YXJ0QXBpRm9yQ2FtcGFpZ24ocGFnZSk7XG4gICAgICBhd2FpdCBQcm9taXNlLmFsbChbcGFnZS5yZWxvYWQoKSwgc2Vjb25kUGFnZS5yZWxvYWQoKV0pO1xuICAgICAgYXdhaXQgZXhwZWN0RGFzaGJvYXJkUmVhZHkocGFnZSk7XG4gICAgICBhd2FpdCBleHBlY3REYXNoYm9hcmRSZWFkeShzZWNvbmRQYWdlKTtcblxuICAgICAgYXdhaXQgcGFnZS5yZWxvYWQoKTtcbiAgICAgIGF3YWl0IGV4cGVjdERhc2hib2FyZFJlYWR5KHBhZ2UpO1xuICAgICAgYXdhaXQgZXhwZWN0KFxuICAgICAgICBwYWdlLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiUmV0cnkgQ29ubmVjdGlvblwiIH0pLFxuICAgICAgKS50b0hhdmVDb3VudCgwKTtcbiAgICAgIGF3YWl0IGV4cGVjdE5vSG9yaXpvbnRhbE92ZXJmbG93KHBhZ2UpO1xuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCBzZWNvbmRDb250ZXh0LmNsb3NlKCk7XG4gICAgfVxuICB9KTtcblxuICB0ZXN0KFwicHJldmlld3MgYW5kIGRvd25sb2FkcyB0aGUgY29tcGxldGVkIGV4ZWN1dGlvbiBhdWRpdCB3aXRob3V0IGR1cGxpY2F0aW5nIGVmZmVjdHNcIiwgYXN5bmMgKHtcbiAgICBwYWdlLFxuICB9KSA9PiB7XG4gICAgY29uc3QgYXVkaXRSZXF1ZXN0czogc3RyaW5nW10gPSBbXTtcbiAgICBjb25zdCBhdWRpdEJvZHkgPSB7XG4gICAgICBmb3JtYXQ6IFwiZW5naW5lZXJpbmdvcy5leGVjdXRpb24tYXVkaXQudjFcIixcbiAgICAgIGV4cG9ydGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMjowMC4wMDBaXCIsXG4gICAgICBleGVjdXRpb246IHtcbiAgICAgICAgaWQ6IEVYRUNVVElPTl9JRCxcbiAgICAgICAgcHJvamVjdElkOiBcImUyZS1wcm9qZWN0XCIsXG4gICAgICAgIHNlc3Npb25JZDogXCJlMmUtYXVkaXQtc2Vzc2lvblwiLFxuICAgICAgICBvcGVyYXRpb25JZDogZXhlY3V0aW9uRml4dHVyZS5vcGVyYXRpb25JZCxcbiAgICAgICAgc3RhdHVzOiBcImNvbXBsZXRlZFwiLFxuICAgICAgICB0ZXJtaW5hbFN0YXRlOiBcImNvbXBsZXRlZFwiLFxuICAgICAgICByZXZpc2lvbjogXCJlMmUtcmV2aXNpb24tNDJcIixcbiAgICAgICAgcHJvb2Y6IHsgcmVxdWlyZWQ6IGZhbHNlLCB2ZXJkaWN0OiBcIlBST1ZFTlwiIH0sXG4gICAgICB9LFxuICAgICAgdGltZWxpbmU6IFtdLFxuICAgICAgdmFsaWRhdGlvbnM6IFt7IHN0YXR1czogXCJwYXNzZWRcIiwgcHJvZmlsZTogXCJyZWxlYXNlLXNhZmVcIiB9XSxcbiAgICAgIGFmZmVjdGVkRmlsZXM6IFtcInNyYy9mZWF0dXJlLnRzXCJdLFxuICAgICAgcmVkYWN0aW9uOiB7XG4gICAgICAgIGV4Y2x1ZGVkOiBbXG4gICAgICAgICAgXCJwcm92aWRlciBzZWNyZXRzXCIsXG4gICAgICAgICAgXCJyYXcgbW9kZWwgb3V0cHV0XCIsXG4gICAgICAgICAgXCJwcml2YXRlIHJ1bnRpbWUgcGF0aHNcIixcbiAgICAgICAgXSxcbiAgICAgIH0sXG4gICAgfTtcbiAgICBhd2FpdCBpbnN0YWxsQXBpRml4dHVyZXMocGFnZSwge1xuICAgICAgYXVkaXRFeHBvcnQ6IHtcbiAgICAgICAgYm9keTogYXVkaXRCb2R5LFxuICAgICAgICBmaWxlbmFtZTogXCJzZXJ2ZXItc3VwcGxpZWQtYXVkaXQtbmFtZS5qc29uXCIsXG4gICAgICAgIHJlcXVlc3RzOiBhdWRpdFJlcXVlc3RzLFxuICAgICAgICBmYWlsRmlyc3RQcmV2aWV3OiB0cnVlLFxuICAgICAgfSxcbiAgICB9KTtcbiAgICBhd2FpdCBwcm9ncmFtbWF0aWNTaWduSW4ocGFnZSk7XG4gICAgYXdhaXQgcGFnZS5ldmFsdWF0ZSgoKSA9PiB7XG4gICAgICBjb25zdCBleGVjdXRpb24gPSB7XG4gICAgICAgIGlkOiBcImUyZS1jb250cm9sbGVkLWV4ZWN1dGlvblwiLFxuICAgICAgICBwcm9qZWN0SWQ6IFwiZTJlLXByb2plY3RcIixcbiAgICAgICAgc2Vzc2lvbklkOiBcImUyZS1hdWRpdC1zZXNzaW9uXCIsXG4gICAgICAgIG1lc3NhZ2U6IFwiQ29tcGxldGVkIGF1ZGl0IGV4ZWN1dGlvblwiLFxuICAgICAgfTtcbiAgICAgIGxvY2FsU3RvcmFnZS5zZXRJdGVtKFxuICAgICAgICBcImVvc19haV9leGVjdXRpb25fY3VycmVudF9lMmUtcHJvamVjdFwiLFxuICAgICAgICBcImUyZS1hdWRpdC1zZXNzaW9uXCIsXG4gICAgICApO1xuICAgICAgbG9jYWxTdG9yYWdlLnNldEl0ZW0oXG4gICAgICAgIFwiZW9zX2FpX2V4ZWN1dGlvbl9lMmUtcHJvamVjdF9lMmUtYXVkaXQtc2Vzc2lvblwiLFxuICAgICAgICBKU09OLnN0cmluZ2lmeShleGVjdXRpb24pLFxuICAgICAgKTtcbiAgICB9KTtcbiAgICBhd2FpdCBwYWdlLmdvdG8oYCR7REFTSEJPQVJEX1BBVEh9YWlgKTtcblxuICAgIGNvbnN0IHByb29mID0gcGFnZS5nZXRCeUxhYmVsKFwiQWdlbnQgZXhlY3V0aW9uIHByb29mXCIpO1xuICAgIGF3YWl0IGV4cGVjdChwcm9vZikudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QocHJvb2YpLnRvQ29udGFpblRleHQoL2NvbXBsZXRlZC9pKTtcbiAgICBhd2FpdCBleHBlY3QocHJvb2YpLnRvQ29udGFpblRleHQoXCJSZXZpc2lvbjogZTJlLXJldmlzaW9uLTQyXCIpO1xuXG4gICAgYXdhaXQgcHJvb2YuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJQcmV2aWV3IGF1ZGl0XCIgfSkuY2xpY2soKTtcbiAgICBjb25zdCBwcmV2aWV3ID0gcGFnZS5nZXRCeUxhYmVsKFwiUmVkYWN0ZWQgYXVkaXQgcHJldmlld1wiKTtcbiAgICBhd2FpdCBleHBlY3QocHJldmlldykudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QocHJldmlldykudG9Db250YWluVGV4dChcIkF1ZGl0IHByZXZpZXcgdGVtcG9yYXJpbHkgdW5hdmFpbGFibGVcIik7XG4gICAgYXdhaXQgZXhwZWN0KHByZXZpZXcpLnRvQ29udGFpblRleHQoXCJzYW1lIGV4ZWN1dGlvbiBhbmQgcmV2aXNpb25cIik7XG4gICAgYXdhaXQgZXhwZWN0KHByZXZpZXcuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJSZXRyeSBwcmV2aWV3XCIgfSkpLnRvQmVWaXNpYmxlKCk7XG4gICAgZXhwZWN0KGF1ZGl0UmVxdWVzdHMpLnRvSGF2ZUxlbmd0aCgxKTtcblxuICAgIGF3YWl0IHByZXZpZXcuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJSZXRyeSBwcmV2aWV3XCIgfSkuY2xpY2soKTtcbiAgICBhd2FpdCBleHBlY3QocHJldmlldykudG9Db250YWluVGV4dChcInByb3ZpZGVyIHNlY3JldHNcIik7XG4gICAgYXdhaXQgZXhwZWN0KHByZXZpZXcpLnRvQ29udGFpblRleHQoXCJyYXcgbW9kZWwgb3V0cHV0XCIpO1xuICAgIGF3YWl0IGV4cGVjdChwcmV2aWV3KS50b0NvbnRhaW5UZXh0KFwicHJpdmF0ZSBydW50aW1lIHBhdGhzXCIpO1xuICAgIGF3YWl0IGV4cGVjdChwcmV2aWV3KS50b0NvbnRhaW5UZXh0KEVYRUNVVElPTl9JRCk7XG4gICAgYXdhaXQgZXhwZWN0KHByZXZpZXcpLnRvQ29udGFpblRleHQoXCJlMmUtb3BlcmF0aW9uXCIpO1xuICAgIGF3YWl0IGV4cGVjdChwcmV2aWV3KS50b0NvbnRhaW5UZXh0KFwiZTJlLXJldmlzaW9uLTQyXCIpO1xuICAgIGV4cGVjdChhdWRpdFJlcXVlc3RzKS50b0hhdmVMZW5ndGgoMik7XG4gICAgZXhwZWN0KG5ldyBVUkwoYXVkaXRSZXF1ZXN0c1swXSkucGF0aG5hbWUpLnRvQmUoXG4gICAgICBgL2FwaS9haS9leGVjdXRpb25zLyR7RVhFQ1VUSU9OX0lEfS9hdWRpdC1leHBvcnRgLFxuICAgICk7XG5cbiAgICBhd2FpdCBwcmV2aWV3LmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiQ2xvc2UgYXVkaXQgcHJldmlld1wiIH0pLmNsaWNrKCk7XG4gICAgYXdhaXQgZXhwZWN0KHByZXZpZXcpLnRvQmVIaWRkZW4oKTtcblxuICAgIGNvbnN0IGRvd25sb2FkUHJvbWlzZSA9IHBhZ2Uud2FpdEZvckV2ZW50KFwiZG93bmxvYWRcIik7XG4gICAgYXdhaXQgcHJvb2YuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJFeHBvcnQgYXVkaXRcIiB9KS5jbGljaygpO1xuICAgIGNvbnN0IGRvd25sb2FkID0gYXdhaXQgZG93bmxvYWRQcm9taXNlO1xuICAgIGV4cGVjdChkb3dubG9hZC5zdWdnZXN0ZWRGaWxlbmFtZSgpKS50b0JlKFwic2VydmVyLXN1cHBsaWVkLWF1ZGl0LW5hbWUuanNvblwiKTtcbiAgICBleHBlY3QoYXVkaXRSZXF1ZXN0cykudG9IYXZlTGVuZ3RoKDMpO1xuXG4gICAgYXdhaXQgcGFnZS5yZWxvYWQoKTtcbiAgICBjb25zdCByZWxvYWRlZFByb29mID0gcGFnZS5nZXRCeUxhYmVsKFwiQWdlbnQgZXhlY3V0aW9uIHByb29mXCIpO1xuICAgIGF3YWl0IGV4cGVjdChyZWxvYWRlZFByb29mKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChyZWxvYWRlZFByb29mKS50b0NvbnRhaW5UZXh0KC9jb21wbGV0ZWQvaSk7XG4gICAgYXdhaXQgZXhwZWN0KHJlbG9hZGVkUHJvb2YpLnRvQ29udGFpblRleHQoXCJFeGVjdXRpb24gZTJlLWNvbnRyb2xsZWQtZXhlY3V0aW9uXCIpO1xuICAgIGF3YWl0IGV4cGVjdChyZWxvYWRlZFByb29mKS50b0NvbnRhaW5UZXh0KFwiUmV2aXNpb246IGUyZS1yZXZpc2lvbi00MlwiKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5TGFiZWwoXCJSZWRhY3RlZCBhdWRpdCBwcmV2aWV3XCIpLFxuICAgICkudG9CZUhpZGRlbigpO1xuICAgIGV4cGVjdChhdWRpdFJlcXVlc3RzKS50b0hhdmVMZW5ndGgoMyk7XG4gIH0pO1xuXG4gIHRlc3QoXCJrZWVwcyB0aGUgY2FuY2VsbGVkIGV4ZWN1dGlvbiBhdWRpdCBoYW5kb2ZmIHJlZGFjdGVkIGFuZCB0ZXJtaW5hbFwiLCBhc3luYyAoe1xuICAgIHBhZ2UsXG4gIH0pID0+IHtcbiAgICBjb25zdCBhdWRpdFJlcXVlc3RzOiBzdHJpbmdbXSA9IFtdO1xuICAgIGNvbnN0IGNhbmNlbGxlZEV4ZWN1dGlvbiA9IHtcbiAgICAgIC4uLmV4ZWN1dGlvbkZpeHR1cmUsXG4gICAgICBzdGF0dXM6IFwiY2FuY2VsbGVkXCIsXG4gICAgICBmbGlnaHRTdGF0ZTogXCJDQU5DRUxMRURcIixcbiAgICAgIGNoZWNrcG9pbnQ6IHtcbiAgICAgICAgc3RhZ2U6IFwiY2FuY2VsbGVkXCIsXG4gICAgICAgIGRldGFpbDogXCJFeGVjdXRpb24gY2FuY2VsbGVkIGJlZm9yZSBhbnkgY2hhbmdlcyB3ZXJlIGFwcGxpZWQuXCIsXG4gICAgICB9LFxuICAgICAgdGVybWluYWxSZWFzb246IFwiY2FuY2VsX3JlcXVlc3RlZFwiLFxuICAgICAgY29tcGxldGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMTozMC4wMDBaXCIsXG4gICAgICB1cGRhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMTozMC4wMDBaXCIsXG4gICAgfTtcbiAgICBjb25zdCBhdWRpdEJvZHkgPSB7XG4gICAgICBmb3JtYXQ6IFwiZW5naW5lZXJpbmdvcy5leGVjdXRpb24tYXVkaXQudjFcIixcbiAgICAgIGV4cG9ydGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMjowMC4wMDBaXCIsXG4gICAgICBleGVjdXRpb246IHtcbiAgICAgICAgaWQ6IEVYRUNVVElPTl9JRCxcbiAgICAgICAgcHJvamVjdElkOiBcImUyZS1wcm9qZWN0XCIsXG4gICAgICAgIHNlc3Npb25JZDogXCJlMmUtYXVkaXQtc2Vzc2lvblwiLFxuICAgICAgICBvcGVyYXRpb25JZDogZXhlY3V0aW9uRml4dHVyZS5vcGVyYXRpb25JZCxcbiAgICAgICAgc3RhdHVzOiBcImNhbmNlbGxlZFwiLFxuICAgICAgICB0ZXJtaW5hbFN0YXRlOiBcImNhbmNlbGxlZFwiLFxuICAgICAgICByZXZpc2lvbjogXCJlMmUtcmV2aXNpb24tNDJcIixcbiAgICAgICAgcHJvb2Y6IHsgcmVxdWlyZWQ6IGZhbHNlLCB2ZXJkaWN0OiBcIk5PVF9SRUNPUkRFRFwiIH0sXG4gICAgICB9LFxuICAgICAgdGltZWxpbmU6IFtcbiAgICAgICAgeyB0eXBlOiBcImNhbmNlbGxlZFwiLCBkZXRhaWw6IFwiQ2FuY2VsbGF0aW9uIGFjY2VwdGVkIGJ5IHRoZSBzZXJ2ZXIuXCIgfSxcbiAgICAgIF0sXG4gICAgICB2YWxpZGF0aW9uczogW10sXG4gICAgICBhZmZlY3RlZEZpbGVzOiBbXSxcbiAgICAgIHJlZGFjdGlvbjoge1xuICAgICAgICBleGNsdWRlZDogW1xuICAgICAgICAgIFwicHJvdmlkZXIgc2VjcmV0c1wiLFxuICAgICAgICAgIFwicmF3IG1vZGVsIG91dHB1dFwiLFxuICAgICAgICAgIFwicHJpdmF0ZSBydW50aW1lIHBhdGhzXCIsXG4gICAgICAgIF0sXG4gICAgICB9LFxuICAgIH07XG4gICAgYXdhaXQgaW5zdGFsbEFwaUZpeHR1cmVzKHBhZ2UsIHtcbiAgICAgIGF1ZGl0RXhwb3J0OiB7XG4gICAgICAgIGJvZHk6IGF1ZGl0Qm9keSxcbiAgICAgICAgZmlsZW5hbWU6IFwiY2FuY2VsbGVkLXNlcnZlci1hdWRpdC5qc29uXCIsXG4gICAgICAgIHJlcXVlc3RzOiBhdWRpdFJlcXVlc3RzLFxuICAgICAgICBleGVjdXRpb246IGNhbmNlbGxlZEV4ZWN1dGlvbixcbiAgICAgICAgbWVzc2FnZU91dGNvbWU6IFwiQ0FOQ0VMTEVEXCIsXG4gICAgICAgIGZhaWxGaXJzdFByZXZpZXc6IHRydWUsXG4gICAgICB9LFxuICAgIH0pO1xuICAgIGF3YWl0IHByb2dyYW1tYXRpY1NpZ25JbihwYWdlKTtcbiAgICBhd2FpdCBwYWdlLmV2YWx1YXRlKCgpID0+IHtcbiAgICAgIGNvbnN0IGV4ZWN1dGlvbiA9IHtcbiAgICAgICAgaWQ6IFwiZTJlLWNvbnRyb2xsZWQtZXhlY3V0aW9uXCIsXG4gICAgICAgIHByb2plY3RJZDogXCJlMmUtcHJvamVjdFwiLFxuICAgICAgICBzZXNzaW9uSWQ6IFwiZTJlLWF1ZGl0LXNlc3Npb25cIixcbiAgICAgICAgbWVzc2FnZTogXCJDYW5jZWxsZWQgYXVkaXQgZXhlY3V0aW9uXCIsXG4gICAgICB9O1xuICAgICAgbG9jYWxTdG9yYWdlLnNldEl0ZW0oXG4gICAgICAgIFwiZW9zX2FpX2V4ZWN1dGlvbl9jdXJyZW50X2UyZS1wcm9qZWN0XCIsXG4gICAgICAgIFwiZTJlLWF1ZGl0LXNlc3Npb25cIixcbiAgICAgICk7XG4gICAgICBsb2NhbFN0b3JhZ2Uuc2V0SXRlbShcbiAgICAgICAgXCJlb3NfYWlfZXhlY3V0aW9uX2UyZS1wcm9qZWN0X2UyZS1hdWRpdC1zZXNzaW9uXCIsXG4gICAgICAgIEpTT04uc3RyaW5naWZ5KGV4ZWN1dGlvbiksXG4gICAgICApO1xuICAgIH0pO1xuICAgIGF3YWl0IHBhZ2UuZ290byhgJHtEQVNIQk9BUkRfUEFUSH1haWApO1xuXG4gICAgY29uc3QgcHJvb2YgPSBwYWdlLmdldEJ5TGFiZWwoXCJBZ2VudCBleGVjdXRpb24gcHJvb2ZcIik7XG4gICAgYXdhaXQgZXhwZWN0KHByb29mKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChwcm9vZikudG9Db250YWluVGV4dChcIkNhbmNlbGxlZFwiKTtcbiAgICBhd2FpdCBleHBlY3QocHJvb2YpLnRvQ29udGFpblRleHQoXCJFeGVjdXRpb24gZTJlLWNvbnRyb2xsZWQtZXhlY3V0aW9uXCIpO1xuICAgIGF3YWl0IGV4cGVjdChwcm9vZikudG9Db250YWluVGV4dChcIlJldmlzaW9uOiBlMmUtcmV2aXNpb24tNDJcIik7XG4gICAgYXdhaXQgZXhwZWN0KHByb29mKS50b0NvbnRhaW5UZXh0KFwiVGVybWluYWwgcmVhc29uOiBjYW5jZWxfcmVxdWVzdGVkXCIpO1xuICAgIGF3YWl0IGV4cGVjdChwcm9vZi5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIkNhbmNlbFwiIH0pKS50b0hhdmVDb3VudCgwKTtcbiAgICBhd2FpdCBleHBlY3QocHJvb2YuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJSZXN1bWVcIiB9KSkudG9IYXZlQ291bnQoMCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcHJvb2YuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJBcHByb3ZlICYgYXBwbHlcIiB9KSxcbiAgICApLnRvSGF2ZUNvdW50KDApO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHByb29mLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IC9jb21taXQgdmVyaWZpZWQgY2hhbmdlcy9pIH0pLFxuICAgICkudG9IYXZlQ291bnQoMCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcHJvb2YuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogL3B1c2ggY29tbWl0dGVkIGNoYW5nZXMvaSB9KSxcbiAgICApLnRvSGF2ZUNvdW50KDApO1xuXG4gICAgYXdhaXQgcHJvb2YuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJQcmV2aWV3IGF1ZGl0XCIgfSkuY2xpY2soKTtcbiAgICBjb25zdCBwcmV2aWV3ID0gcGFnZS5nZXRCeUxhYmVsKFwiUmVkYWN0ZWQgYXVkaXQgcHJldmlld1wiKTtcbiAgICBhd2FpdCBleHBlY3QocHJldmlldykudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QocHJldmlldykudG9Db250YWluVGV4dChcIkF1ZGl0IHByZXZpZXcgdGVtcG9yYXJpbHkgdW5hdmFpbGFibGVcIik7XG4gICAgYXdhaXQgZXhwZWN0KHByZXZpZXcpLnRvQ29udGFpblRleHQoXCJzYW1lIGV4ZWN1dGlvbiBhbmQgcmV2aXNpb25cIik7XG4gICAgYXdhaXQgZXhwZWN0KHByZXZpZXcuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJSZXRyeSBwcmV2aWV3XCIgfSkpLnRvQmVWaXNpYmxlKCk7XG4gICAgZXhwZWN0KGF1ZGl0UmVxdWVzdHMpLnRvSGF2ZUxlbmd0aCgxKTtcblxuICAgIGF3YWl0IHByZXZpZXcuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJSZXRyeSBwcmV2aWV3XCIgfSkuY2xpY2soKTtcbiAgICBhd2FpdCBleHBlY3QocHJldmlldykudG9Db250YWluVGV4dChcImNhbmNlbGxlZFwiKTtcbiAgICBhd2FpdCBleHBlY3QocHJldmlldykudG9Db250YWluVGV4dChFWEVDVVRJT05fSUQpO1xuICAgIGF3YWl0IGV4cGVjdChwcmV2aWV3KS50b0NvbnRhaW5UZXh0KFwiZTJlLW9wZXJhdGlvblwiKTtcbiAgICBhd2FpdCBleHBlY3QocHJldmlldykudG9Db250YWluVGV4dChcImUyZS1yZXZpc2lvbi00MlwiKTtcbiAgICBhd2FpdCBleHBlY3QocHJldmlldykudG9Db250YWluVGV4dChcInByb3ZpZGVyIHNlY3JldHNcIik7XG4gICAgYXdhaXQgZXhwZWN0KHByZXZpZXcpLnRvQ29udGFpblRleHQoXCJyYXcgbW9kZWwgb3V0cHV0XCIpO1xuICAgIGF3YWl0IGV4cGVjdChwcmV2aWV3KS50b0NvbnRhaW5UZXh0KFwicHJpdmF0ZSBydW50aW1lIHBhdGhzXCIpO1xuICAgIGF3YWl0IGV4cGVjdChwcm9vZikudG9Db250YWluVGV4dChcIkNhbmNlbGxlZFwiKTtcbiAgICBhd2FpdCBleHBlY3QocHJvb2YpLnRvQ29udGFpblRleHQoXCJSZXZpc2lvbjogZTJlLXJldmlzaW9uLTQyXCIpO1xuICAgIGF3YWl0IGV4cGVjdChwcm9vZikudG9Db250YWluVGV4dChcIlRlcm1pbmFsIHJlYXNvbjogY2FuY2VsX3JlcXVlc3RlZFwiKTtcbiAgICBleHBlY3QoYXVkaXRSZXF1ZXN0cykudG9IYXZlTGVuZ3RoKDIpO1xuXG4gICAgYXdhaXQgcHJldmlldy5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIkNsb3NlIGF1ZGl0IHByZXZpZXdcIiB9KS5jbGljaygpO1xuICAgIGNvbnN0IGRvd25sb2FkUHJvbWlzZSA9IHBhZ2Uud2FpdEZvckV2ZW50KFwiZG93bmxvYWRcIik7XG4gICAgYXdhaXQgcHJvb2YuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJFeHBvcnQgYXVkaXRcIiB9KS5jbGljaygpO1xuICAgIGNvbnN0IGRvd25sb2FkID0gYXdhaXQgZG93bmxvYWRQcm9taXNlO1xuICAgIGV4cGVjdChkb3dubG9hZC5zdWdnZXN0ZWRGaWxlbmFtZSgpKS50b0JlKFwiY2FuY2VsbGVkLXNlcnZlci1hdWRpdC5qc29uXCIpO1xuICAgIGV4cGVjdChhdWRpdFJlcXVlc3RzKS50b0hhdmVMZW5ndGgoMyk7XG5cbiAgICBhd2FpdCBwYWdlLnJlbG9hZCgpO1xuICAgIGNvbnN0IHJlbG9hZGVkUHJvb2YgPSBwYWdlLmdldEJ5TGFiZWwoXCJBZ2VudCBleGVjdXRpb24gcHJvb2ZcIik7XG4gICAgYXdhaXQgZXhwZWN0KHJlbG9hZGVkUHJvb2YpLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KHJlbG9hZGVkUHJvb2YpLnRvQ29udGFpblRleHQoXCJDYW5jZWxsZWRcIik7XG4gICAgYXdhaXQgZXhwZWN0KHJlbG9hZGVkUHJvb2YpLnRvQ29udGFpblRleHQoXCJSZXZpc2lvbjogZTJlLXJldmlzaW9uLTQyXCIpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlLmdldEJ5TGFiZWwoXCJSZWRhY3RlZCBhdWRpdCBwcmV2aWV3XCIpKS50b0JlSGlkZGVuKCk7XG4gICAgZXhwZWN0KGF1ZGl0UmVxdWVzdHMpLnRvSGF2ZUxlbmd0aCgzKTtcbiAgfSk7XG5cbiAgdGVzdChcInVwbG9hZHMgYW4gYXJjaGl2ZSBhbmQgcmVuZGVycyBhIGxpdmUgdGFzayB1cGRhdGVcIiwgYXN5bmMgKHtcbiAgICBwYWdlLFxuICB9KSA9PiB7XG4gICAgY29uc3QgdGFza0lkID0gXCJlMmUtbGl2ZS10YXNrXCI7XG4gICAgY29uc3QgbGl2ZUxvZyA9IHtcbiAgICAgIGlkOiBcImUyZS1saXZlLWxvZ1wiLFxuICAgICAgdGFza0lkLFxuICAgICAgbGV2ZWw6IFwiaW5mb1wiLFxuICAgICAgbWVzc2FnZTogXCJMaXZlIHVwZGF0ZSByZWNlaXZlZCBmcm9tIHRoZSBzZXJ2ZXJcIixcbiAgICAgIHRpbWVzdGFtcDogXCIyMDI2LTAxLTAxVDAwOjAwOjAyLjAwMFpcIixcbiAgICB9O1xuICAgIGF3YWl0IGluc3RhbGxBcGlGaXh0dXJlcyhwYWdlLCB7XG4gICAgICBhcmNoaXZlVXBsb2FkOiB7XG4gICAgICAgIHVwbG9hZElkOiBcImUyZS11cGxvYWRcIixcbiAgICAgICAgb3JpZ2luYWxOYW1lOiBcImRhc2hib2FyZC1qb3VybmV5LnppcFwiLFxuICAgICAgfSxcbiAgICAgIGxpdmVUYXNrOiB7XG4gICAgICAgIGlkOiB0YXNrSWQsXG4gICAgICAgIHRpdGxlOiBcIlZlcmlmeSBsaXZlIGRhc2hib2FyZCB1cGRhdGVzXCIsXG4gICAgICAgIHByb2plY3RJZDogXCJlMmUtcHJvamVjdFwiLFxuICAgICAgICBsb2c6IGxpdmVMb2csXG4gICAgICB9LFxuICAgIH0pO1xuICAgIGF3YWl0IHByb2dyYW1tYXRpY1NpZ25JbihwYWdlKTtcblxuICAgIC8vIFRoaXMgaXMgYSB2YWxpZCwgZW1wdHkgWklQIGFyY2hpdmUuIEtlZXBpbmcgaXQgaW5saW5lIG1ha2VzIHRoZSBicm93c2VyXG4gICAgLy8gdGVzdCBzZWxmLWNvbnRhaW5lZCB3aGlsZSBzdGlsbCBleGVyY2lzaW5nIEZvcm1EYXRhIGFuZCBtdWx0aXBhcnQgYnl0ZXMuXG4gICAgY29uc3QgdXBsb2FkUmVzdWx0ID0gYXdhaXQgcGFnZS5ldmFsdWF0ZShhc3luYyAoYXBpQmFzZVVybCkgPT4ge1xuICAgICAgY29uc3QgYnl0ZXMgPSBVaW50OEFycmF5LmZyb20oXG4gICAgICAgIGF0b2IoXCJVRXNGQmdBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUE9PVwiKSxcbiAgICAgICAgKGNoYXJhY3RlcikgPT4gY2hhcmFjdGVyLmNoYXJDb2RlQXQoMCksXG4gICAgICApO1xuICAgICAgY29uc3QgYm9keSA9IG5ldyBGb3JtRGF0YSgpO1xuICAgICAgYm9keS5hcHBlbmQoXG4gICAgICAgIFwiYXJjaGl2ZVwiLFxuICAgICAgICBuZXcgQmxvYihbYnl0ZXNdLCB7IHR5cGU6IFwiYXBwbGljYXRpb24vemlwXCIgfSksXG4gICAgICAgIFwiZGFzaGJvYXJkLWpvdXJuZXkuemlwXCIsXG4gICAgICApO1xuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBmZXRjaChcbiAgICAgICAgbmV3IFVSTChcIi9hcGkvdXBsb2FkL2FyY2hpdmVcIiwgYXBpQmFzZVVybCkudG9TdHJpbmcoKSxcbiAgICAgICAgeyBtZXRob2Q6IFwiUE9TVFwiLCBjcmVkZW50aWFsczogXCJpbmNsdWRlXCIsIGJvZHkgfSxcbiAgICAgICk7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBzdGF0dXM6IHJlc3BvbnNlLnN0YXR1cyxcbiAgICAgICAgYm9keTogKGF3YWl0IHJlc3BvbnNlLmpzb24oKSkgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4sXG4gICAgICB9O1xuICAgIH0sIHByb2Nlc3MuZW52LkRBU0hCT0FSRF9FMkVfQVBJX0JBU0VfVVJMID8/IHBhZ2UudXJsKCkpO1xuICAgIGV4cGVjdCh1cGxvYWRSZXN1bHQuc3RhdHVzKS50b0JlKDIwMSk7XG4gICAgZXhwZWN0KHVwbG9hZFJlc3VsdC5ib2R5KS50b0VxdWFsKHtcbiAgICAgIHVwbG9hZElkOiBcImUyZS11cGxvYWRcIixcbiAgICAgIG9yaWdpbmFsTmFtZTogXCJkYXNoYm9hcmQtam91cm5leS56aXBcIixcbiAgICB9KTtcblxuICAgIGF3YWl0IG9wZW5OYXZpZ2F0aW9uKHBhZ2UsIFwiVGFza3NcIiwgYCR7REFTSEJPQVJEX1BBVEh9dGFza3NgKTtcbiAgICBjb25zdCB0YXNrUm93ID0gcGFnZS5nZXRCeUxhYmVsKFxuICAgICAgXCJFeHBhbmQgdGFzayBWZXJpZnkgbGl2ZSBkYXNoYm9hcmQgdXBkYXRlc1wiLFxuICAgICk7XG4gICAgYXdhaXQgZXhwZWN0KHRhc2tSb3cpLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgdGFza1Jvdy5jbGljaygpO1xuICAgIGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJMb2dzXCIgfSkuY2xpY2soKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5nZXRCeVJvbGUoXCJyZWdpb25cIiwgeyBuYW1lOiBcIkFjdGl2aXR5XCIgfSkpLnRvQ29udGFpblRleHQoXG4gICAgICBcIkxpdmUgdXBkYXRlIHJlY2VpdmVkIGZyb20gdGhlIHNlcnZlclwiLFxuICAgICk7XG4gIH0pO1xuXG4gIHRlc3QoXCJyZWNvdmVycyBhIGxpdmUgdGFzayB1cGRhdGUgYWZ0ZXIgYSB0ZW1wb3Jhcnkgc3RyZWFtIGZhaWx1cmVcIiwgYXN5bmMgKHtcbiAgICBwYWdlLFxuICB9KSA9PiB7XG4gICAgY29uc3QgdGFza0lkID0gXCJlMmUtcmVjb25uZWN0aW5nLWxpdmUtdGFza1wiO1xuICAgIGNvbnN0IGxpdmVMb2cgPSB7XG4gICAgICBpZDogXCJlMmUtcmVjb25uZWN0aW5nLWxpdmUtbG9nXCIsXG4gICAgICB0YXNrSWQsXG4gICAgICBsZXZlbDogXCJpbmZvXCIsXG4gICAgICBtZXNzYWdlOiBcIkF1dGhvcml0YXRpdmUgdXBkYXRlIHJlY2VpdmVkIGFmdGVyIHJlY29ubmVjdFwiLFxuICAgICAgdGltZXN0YW1wOiBcIjIwMjYtMDEtMDFUMDA6MDA6MDIuMDAwWlwiLFxuICAgICAgbWV0YWRhdGE6IHtcbiAgICAgICAgb3BlcmF0aW9uSWQ6IFwiZTJlLXJlY29ubmVjdGluZy1vcGVyYXRpb25cIixcbiAgICAgICAgY2hlY2twb2ludFZlcnNpb246IDMsXG4gICAgICB9LFxuICAgIH07XG4gICAgY29uc3Qgc3RyZWFtUmVxdWVzdHM6IHN0cmluZ1tdID0gW107XG4gICAgYXdhaXQgaW5zdGFsbEFwaUZpeHR1cmVzKHBhZ2UsIHtcbiAgICAgIGxpdmVUYXNrOiB7XG4gICAgICAgIGlkOiB0YXNrSWQsXG4gICAgICAgIHRpdGxlOiBcIlJlY292ZXIgbGl2ZSB0YXNrIHVwZGF0ZXNcIixcbiAgICAgICAgcHJvamVjdElkOiBcImUyZS1wcm9qZWN0XCIsXG4gICAgICAgIGxvZzogbGl2ZUxvZyxcbiAgICAgICAgc3RyZWFtUmVxdWVzdHMsXG4gICAgICAgIGZhaWxGaXJzdFN0cmVhbTogdHJ1ZSxcbiAgICAgIH0sXG4gICAgfSk7XG4gICAgYXdhaXQgcHJvZ3JhbW1hdGljU2lnbkluKHBhZ2UpO1xuXG4gICAgYXdhaXQgb3Blbk5hdmlnYXRpb24ocGFnZSwgXCJUYXNrc1wiLCBgJHtEQVNIQk9BUkRfUEFUSH10YXNrc2ApO1xuICAgIGNvbnN0IHRhc2tSb3cgPSBwYWdlLmdldEJ5TGFiZWwoXCJFeHBhbmQgdGFzayBSZWNvdmVyIGxpdmUgdGFzayB1cGRhdGVzXCIpO1xuICAgIGF3YWl0IGV4cGVjdCh0YXNrUm93KS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IHRhc2tSb3cuY2xpY2soKTtcbiAgICBhd2FpdCBwYWdlLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiTG9nc1wiIH0pLmNsaWNrKCk7XG5cbiAgICBjb25zdCBhY3Rpdml0eSA9IHBhZ2UuZ2V0QnlSb2xlKFwicmVnaW9uXCIsIHsgbmFtZTogXCJBY3Rpdml0eVwiIH0pO1xuICAgIGF3YWl0IGV4cGVjdChhY3Rpdml0eSkudG9Db250YWluVGV4dChsaXZlTG9nLm1lc3NhZ2UpO1xuICAgIGF3YWl0IGV4cGVjdFxuICAgICAgLnBvbGwoKCkgPT4gc3RyZWFtUmVxdWVzdHMubGVuZ3RoLCB7XG4gICAgICAgIG1lc3NhZ2U6IFwidGhlIHRhc2sgbG9nIHN0cmVhbSBzaG91bGQgcmVjb25uZWN0IGV4YWN0bHkgb25jZVwiLFxuICAgICAgfSlcbiAgICAgIC50b0JlKDIpO1xuICAgIGV4cGVjdChzdHJlYW1SZXF1ZXN0cykudG9IYXZlTGVuZ3RoKDIpO1xuICAgIGV4cGVjdChzdHJlYW1SZXF1ZXN0c1swXSkudG9CZShzdHJlYW1SZXF1ZXN0c1sxXSk7XG4gICAgZXhwZWN0KG5ldyBVUkwoc3RyZWFtUmVxdWVzdHNbMV0pLnBhdGhuYW1lKS50b0JlKFxuICAgICAgYC9hcGkvdGFza3MvJHt0YXNrSWR9L2xvZ3Mvc3RyZWFtYCxcbiAgICApO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIGFjdGl2aXR5LmxvY2F0b3IoXCJzdW1tYXJ5XCIpLmZpbHRlcih7IGhhc1RleHQ6IGxpdmVMb2cubWVzc2FnZSB9KSxcbiAgICApLnRvSGF2ZUNvdW50KDEpO1xuICB9KTtcblxuICB0ZXN0KFwic2hvd3MgYW4gYWN0aW9uYWJsZSB0ZXJtaW5hbCBzdGF0ZSB3aGVuIGxpdmUgdGFzayByZWNvbm5lY3RzIGFyZSBleGhhdXN0ZWRcIiwgYXN5bmMgKHtcbiAgICBwYWdlLFxuICB9KSA9PiB7XG4gICAgY29uc3QgdGFza0lkID0gXCJlMmUtZXhoYXVzdGVkLWxpdmUtdGFza1wiO1xuICAgIGNvbnN0IG9wZXJhdGlvbklkID0gXCJlMmUtZXhoYXVzdGVkLW9wZXJhdGlvblwiO1xuICAgIGNvbnN0IGxpdmVMb2cgPSB7XG4gICAgICBpZDogXCJlMmUtZXhoYXVzdGVkLWxpdmUtbG9nXCIsXG4gICAgICB0YXNrSWQsXG4gICAgICBsZXZlbDogXCJpbmZvXCIsXG4gICAgICBtZXNzYWdlOiBcIlRoZSBvbmx5IGNvbmZpcm1lZCB0YXNrIHVwZGF0ZVwiLFxuICAgICAgdGltZXN0YW1wOiBcIjIwMjYtMDEtMDFUMDA6MDA6MDIuMDAwWlwiLFxuICAgICAgbWV0YWRhdGE6IHsgb3BlcmF0aW9uSWQgfSxcbiAgICB9O1xuICAgIGNvbnN0IHN0cmVhbVJlcXVlc3RzOiBzdHJpbmdbXSA9IFtdO1xuICAgIGNvbnN0IG5vblN0cmVhbVJlcXVlc3RzOiBzdHJpbmdbXSA9IFtdO1xuICAgIHBhZ2Uub24oXCJyZXF1ZXN0XCIsIChyZXF1ZXN0KSA9PiB7XG4gICAgICBpZiAoIXJlcXVlc3QudXJsKCkuaW5jbHVkZXMoXCIvYXBpL3Rhc2tzL1wiKSkgcmV0dXJuO1xuICAgICAgaWYgKCFyZXF1ZXN0LnVybCgpLmluY2x1ZGVzKFwiL2xvZ3Mvc3RyZWFtXCIpKSBub25TdHJlYW1SZXF1ZXN0cy5wdXNoKHJlcXVlc3QubWV0aG9kKCkpO1xuICAgIH0pO1xuICAgIGF3YWl0IGluc3RhbGxBcGlGaXh0dXJlcyhwYWdlLCB7XG4gICAgICBsaXZlVGFzazoge1xuICAgICAgICBpZDogdGFza0lkLFxuICAgICAgICB0aXRsZTogXCJSZWNvdmVyIGV4aGF1c3RlZCBsaXZlIHRhc2sgdXBkYXRlc1wiLFxuICAgICAgICBwcm9qZWN0SWQ6IFwiZTJlLXByb2plY3RcIixcbiAgICAgICAgbG9nOiBsaXZlTG9nLFxuICAgICAgICBpbml0aWFsTG9nczogW2xpdmVMb2ddLFxuICAgICAgICBzdHJlYW1SZXF1ZXN0cyxcbiAgICAgICAgZmFpbFN0cmVhbUF0dGVtcHRzOiA2LFxuICAgICAgfSxcbiAgICB9KTtcbiAgICBhd2FpdCBwcm9ncmFtbWF0aWNTaWduSW4ocGFnZSk7XG5cbiAgICBhd2FpdCBvcGVuTmF2aWdhdGlvbihwYWdlLCBcIlRhc2tzXCIsIGAke0RBU0hCT0FSRF9QQVRIfXRhc2tzYCk7XG4gICAgYXdhaXQgcGFnZS5nZXRCeUxhYmVsKFwiRXhwYW5kIHRhc2sgUmVjb3ZlciBleGhhdXN0ZWQgbGl2ZSB0YXNrIHVwZGF0ZXNcIikuY2xpY2soKTtcbiAgICBhd2FpdCBwYWdlLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiTG9nc1wiIH0pLmNsaWNrKCk7XG5cbiAgICBjb25zdCBhY3Rpdml0eSA9IHBhZ2UuZ2V0QnlSb2xlKFwicmVnaW9uXCIsIHsgbmFtZTogXCJBY3Rpdml0eVwiIH0pO1xuICAgIGF3YWl0IGV4cGVjdChhY3Rpdml0eSkudG9Db250YWluVGV4dChsaXZlTG9nLm1lc3NhZ2UpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlLmdldEJ5VGV4dChcIlRlbXBvcmFyeSBzdHJlYW0gZmFpbHVyZS5cIiwgeyBleGFjdDogZmFsc2UgfSkpLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0XG4gICAgICAucG9sbCgoKSA9PiBzdHJlYW1SZXF1ZXN0cy5sZW5ndGgsIHtcbiAgICAgICAgbWVzc2FnZTogXCJ0aGUgdGFzayBsb2cgc3RyZWFtIHNob3VsZCBleGhhdXN0IGl0cyBib3VuZGVkIHJlY29ubmVjdCBidWRnZXRcIixcbiAgICAgICAgdGltZW91dDogMzVfMDAwLFxuICAgICAgfSlcbiAgICAgIC50b0JlKDYpO1xuICAgIGNvbnN0IGV4aGF1c3RlZCA9IHBhZ2UuZ2V0QnlSb2xlKFwiYWxlcnRcIik7XG4gICAgYXdhaXQgZXhwZWN0KGV4aGF1c3RlZCkudG9Db250YWluVGV4dChcIkxpdmUgdGFzayB1cGRhdGVzIGNvdWxkIG5vdCByZWNvbm5lY3RcIik7XG4gICAgYXdhaXQgZXhwZWN0KGV4aGF1c3RlZCkudG9Db250YWluVGV4dChcIlJlY29ubmVjdCBhdHRlbXB0cyBhcmUgZXhoYXVzdGVkXCIpO1xuICAgIGF3YWl0IGV4cGVjdChleGhhdXN0ZWQpLnRvQ29udGFpblRleHQob3BlcmF0aW9uSWQpO1xuICAgIGF3YWl0IGV4cGVjdChleGhhdXN0ZWQpLnRvQ29udGFpblRleHQoXCJ0YXNrIGhhcyBub3QgYmVlbiBtYXJrZWQgZmFpbGVkXCIpO1xuICAgIGF3YWl0IGV4cGVjdChleGhhdXN0ZWQuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJSZXRyeSBsaXZlIHVwZGF0ZXNcIiB9KSkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoZXhoYXVzdGVkLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiUmVmcmVzaCB0YXNrIGxvZ3NcIiB9KSkudG9CZVZpc2libGUoKTtcblxuICAgIGF3YWl0IGV4aGF1c3RlZC5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIlJldHJ5IGxpdmUgdXBkYXRlc1wiIH0pLmNsaWNrKCk7XG4gICAgYXdhaXQgZXhwZWN0KGFjdGl2aXR5KS50b0NvbnRhaW5UZXh0KFwiVGhlIG9ubHkgY29uZmlybWVkIHRhc2sgdXBkYXRlXCIpO1xuICAgIGF3YWl0IGV4cGVjdC5wb2xsKCgpID0+IHN0cmVhbVJlcXVlc3RzLmxlbmd0aCkudG9CZSg3KTtcbiAgICBleHBlY3QobmV3IFNldChzdHJlYW1SZXF1ZXN0cykuc2l6ZSkudG9CZSgxKTtcbiAgICBleHBlY3Qobm9uU3RyZWFtUmVxdWVzdHMpLm5vdC50b0NvbnRhaW4oXCJQT1NUXCIpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIGFjdGl2aXR5LmxvY2F0b3IoXCJzdW1tYXJ5XCIpLmZpbHRlcih7IGhhc1RleHQ6IGxpdmVMb2cubWVzc2FnZSB9KSxcbiAgICApLnRvSGF2ZUNvdW50KDEpO1xuICB9KTtcblxuICB0ZXN0KFwicGFnZXMgYW5kIHJlbG9hZHMgdGhlIGZpbHRlcmVkIGV2ZW50IHN0cmVhbSB3aXRob3V0IGxvc2luZyBpdHMgd2luZG93XCIsIGFzeW5jICh7XG4gICAgcGFnZSxcbiAgfSkgPT4ge1xuICAgIGNvbnN0IGV2ZW50cyA9IEFycmF5LmZyb20oeyBsZW5ndGg6IDUxIH0sIChfLCBpbmRleCkgPT4gKHtcbiAgICAgIGlkOiBgZTJlLWV2ZW50LSR7aW5kZXh9YCxcbiAgICAgIHByb2plY3RJZDogXCJlMmUtcHJvamVjdFwiLFxuICAgICAgdHlwZTogXCJBdWRpdEV2ZW50XCIsXG4gICAgICBzZXZlcml0eTogaW5kZXggPCAyID8gXCJzdWNjZXNzXCIgOiBcImluZm9cIixcbiAgICAgIGNvcnJlbGF0aW9uSWQ6IGluZGV4IDwgMiA/IFwicmVsZWFzZS00MlwiIDogbnVsbCxcbiAgICAgIG1lc3NhZ2U6XG4gICAgICAgIGluZGV4IDwgMiA/IGBGaWx0ZXJlZCByZWxlYXNlIGV2ZW50ICR7aW5kZXh9YCA6IGBPbGRlciBldmVudCAke2luZGV4fWAsXG4gICAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKERhdGUuVVRDKDIwMjYsIDAsIDEsIDAsIDAsIDUxIC0gaW5kZXgpKS50b0lTT1N0cmluZygpLFxuICAgIH0pKTtcbiAgICBjb25zdCBldmVudFJlcXVlc3RzOiBzdHJpbmdbXSA9IFtdO1xuICAgIHBhZ2Uub24oXCJyZXF1ZXN0XCIsIChyZXF1ZXN0KSA9PiB7XG4gICAgICBpZiAobmV3IFVSTChyZXF1ZXN0LnVybCgpKS5wYXRobmFtZS5lbmRzV2l0aChcIi9hcGkvZXZlbnRzXCIpKVxuICAgICAgICBldmVudFJlcXVlc3RzLnB1c2gocmVxdWVzdC51cmwoKSk7XG4gICAgfSk7XG4gICAgYXdhaXQgaW5zdGFsbEFwaUZpeHR1cmVzKHBhZ2UsIHtcbiAgICAgIGV2ZW50cyxcbiAgICAgIHByb2plY3RzOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBpZDogXCJlMmUtcHJvamVjdFwiLFxuICAgICAgICAgIG5hbWU6IFwiU21va2UgUHJvamVjdFwiLFxuICAgICAgICAgIGxhbmd1YWdlOiBcIlR5cGVTY3JpcHRcIixcbiAgICAgICAgICBmcmFtZXdvcms6IFwiUmVhY3RcIixcbiAgICAgICAgICBzdGF0dXM6IFwiYWN0aXZlXCIsXG4gICAgICAgICAgcm9vdFBhdGg6IFwiL2NvbnRyb2xsZWQvc21va2VcIixcbiAgICAgICAgICBxdWFsaXR5U2NvcmU6IDkyLFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICB9KTtcbiAgICBhd2FpdCBwcm9ncmFtbWF0aWNTaWduSW4ocGFnZSk7XG4gICAgYXdhaXQgcGFnZS5nb3RvKGAke0RBU0hCT0FSRF9QQVRIfWV2ZW50c2ApO1xuXG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXCJPbGRlciBldmVudCA0OVwiLCB7IGV4YWN0OiB0cnVlIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcIk9sZGVyIGV2ZW50IDUwXCIsIHsgZXhhY3Q6IHRydWUgfSksXG4gICAgKS5ub3QudG9CZVZpc2libGUoKTtcbiAgICBjb25zdCBmaXJzdFJlcXVlc3QgPSBuZXcgVVJMKGV2ZW50UmVxdWVzdHMuYXQoLTEpISk7XG4gICAgZXhwZWN0KGZpcnN0UmVxdWVzdC5zZWFyY2hQYXJhbXMuZ2V0KFwibGltaXRcIikpLnRvQmUoXCI1MFwiKTtcbiAgICBleHBlY3QoZmlyc3RSZXF1ZXN0LnNlYXJjaFBhcmFtcy5nZXQoXCJwYWdlXCIpKS50b0JlKFwiMVwiKTtcblxuICAgIGF3YWl0IFByb21pc2UuYWxsKFtcbiAgICAgIHBhZ2Uud2FpdEZvclJlcXVlc3QoKHJlcXVlc3QpID0+IHtcbiAgICAgICAgY29uc3QgdXJsID0gbmV3IFVSTChyZXF1ZXN0LnVybCgpKTtcbiAgICAgICAgcmV0dXJuIChcbiAgICAgICAgICB1cmwucGF0aG5hbWUuZW5kc1dpdGgoXCIvYXBpL2V2ZW50c1wiKSAmJlxuICAgICAgICAgIHVybC5zZWFyY2hQYXJhbXMuZ2V0KFwicGFnZVwiKSA9PT0gXCIyXCJcbiAgICAgICAgKTtcbiAgICAgIH0pLFxuICAgICAgcGFnZS5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIk9sZGVyXCIgfSkuY2xpY2soKSxcbiAgICBdKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5nZXRCeVRleHQoXCJQYWdlIDIuXCIsIHsgZXhhY3Q6IGZhbHNlIH0pKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiT2xkZXIgZXZlbnQgNTBcIiwgeyBleGFjdDogdHJ1ZSB9KSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXCJGaWx0ZXJlZCByZWxlYXNlIGV2ZW50IDBcIiwgeyBleGFjdDogdHJ1ZSB9KSxcbiAgICApLm5vdC50b0JlVmlzaWJsZSgpO1xuICAgIGV4cGVjdChuZXcgVVJMKGV2ZW50UmVxdWVzdHMuYXQoLTEpISkuc2VhcmNoUGFyYW1zLmdldChcInBhZ2VcIikpLnRvQmUoXCIyXCIpO1xuICAgIGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJOZXdlclwiIH0pLmNsaWNrKCk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlUZXh0KFwiUGFnZSAxLlwiLCB7IGV4YWN0OiBmYWxzZSB9KSkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcIkZpbHRlcmVkIHJlbGVhc2UgZXZlbnQgMFwiLCB7IGV4YWN0OiB0cnVlIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcblxuICAgIGF3YWl0IHBhZ2UuZ2V0QnlQbGFjZWhvbGRlcihcIlNlYXJjaCBsb2dzLi4uXCIpLmZpbGwoXCJGaWx0ZXJlZCByZWxlYXNlXCIpO1xuICAgIGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJUb2dnbGUgZXZlbnQgZmlsdGVyc1wiIH0pLmNsaWNrKCk7XG4gICAgYXdhaXQgcGFnZS5sb2NhdG9yKFwic2VsZWN0XCIpLm50aCgxKS5zZWxlY3RPcHRpb24oXCJzdWNjZXNzXCIpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiRmlsdGVyZWQgcmVsZWFzZSBldmVudCAwXCIsIHsgZXhhY3Q6IHRydWUgfSksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiT2xkZXIgZXZlbnQgMVwiLCB7IGV4YWN0OiB0cnVlIH0pLFxuICAgICkubm90LnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UpLnRvSGF2ZVVSTCgvc2VhcmNoPUZpbHRlcmVkXFwrcmVsZWFzZS8pO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlKS50b0hhdmVVUkwoL3NldmVyaXR5PXN1Y2Nlc3MvKTtcblxuICAgIGF3YWl0IHBhZ2UucmVsb2FkKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXCJGaWx0ZXJlZCByZWxlYXNlIGV2ZW50IDBcIiwgeyBleGFjdDogdHJ1ZSB9KSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXCJPbGRlciBldmVudCAxXCIsIHsgZXhhY3Q6IHRydWUgfSksXG4gICAgKS5ub3QudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5nZXRCeVBsYWNlaG9sZGVyKFwiU2VhcmNoIGxvZ3MuLi5cIikpLnRvSGF2ZVZhbHVlKFxuICAgICAgXCJGaWx0ZXJlZCByZWxlYXNlXCIsXG4gICAgKTtcbiAgICBhd2FpdCBwYWdlLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiVG9nZ2xlIGV2ZW50IGZpbHRlcnNcIiB9KS5jbGljaygpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoXCJzZWxlY3RcIikubnRoKDEpKS50b0hhdmVWYWx1ZShcInN1Y2Nlc3NcIik7XG4gICAgY29uc3QgZmlsdGVyZWRSZXF1ZXN0ID0gbmV3IFVSTChldmVudFJlcXVlc3RzLmF0KC0xKSEpO1xuICAgIGV4cGVjdChmaWx0ZXJlZFJlcXVlc3Quc2VhcmNoUGFyYW1zLmdldChcImxpbWl0XCIpKS50b0JlKFwiNTBcIik7XG4gICAgZXhwZWN0KGZpbHRlcmVkUmVxdWVzdC5zZWFyY2hQYXJhbXMuZ2V0KFwicGFnZVwiKSkudG9CZShcIjFcIik7XG4gICAgZXhwZWN0KGZpbHRlcmVkUmVxdWVzdC5zZWFyY2hQYXJhbXMuZ2V0KFwic2VhcmNoXCIpKS50b0JlKFwiRmlsdGVyZWQgcmVsZWFzZVwiKTtcbiAgICBleHBlY3QoZmlsdGVyZWRSZXF1ZXN0LnNlYXJjaFBhcmFtcy5nZXQoXCJzZXZlcml0eVwiKSkudG9CZShcInN1Y2Nlc3NcIik7XG4gIH0pO1xuXG4gIHRlc3QoXCJyZW5kZXJzIGFuIEFyYWJpYyBzb3VyY2UtYmFja2VkIEFJIGFuc3dlciB3aXRob3V0IGludGVybmFsIGRpYWdub3N0aWNzXCIsIGFzeW5jICh7XG4gICAgcGFnZSxcbiAgfSkgPT4ge1xuICAgIGNvbnN0IGZpeHR1cmUgPSBhd2FpdCBpbnN0YWxsQXJhYmljQWlGaXh0dXJlKHBhZ2UpO1xuICAgIGF3YWl0IGluc3RhbGxBcGlGaXh0dXJlcyhwYWdlLCB7IGFyYWJpY0FpOiBmaXh0dXJlIH0pO1xuICAgIGF3YWl0IHByb2dyYW1tYXRpY1NpZ25JbihwYWdlKTtcbiAgICBhd2FpdCBwYWdlLmdvdG8oYCR7REFTSEJPQVJEX1BBVEh9YWlgKTtcblxuICAgIGNvbnN0IGNvbXBvc2VyID0gcGFnZS5sb2NhdG9yKFwidGV4dGFyZWFcIikuZmlyc3QoKTtcbiAgICBhd2FpdCBleHBlY3QoY29tcG9zZXIpLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgY29tcG9zZXIuZmlsbChmaXh0dXJlLnF1ZXN0aW9uKTtcbiAgICBjb25zdCBzZW5kQnV0dG9uID0gY29tcG9zZXIubG9jYXRvcihcInhwYXRoPS4uXCIpLmdldEJ5Um9sZShcImJ1dHRvblwiKTtcbiAgICBhd2FpdCBleHBlY3Qoc2VuZEJ1dHRvbikudG9CZUVuYWJsZWQoKTtcbiAgICBjb25zdCBzdHJlYW1SZXNwb25zZVByb21pc2UgPSBwYWdlLndhaXRGb3JSZXNwb25zZSgocmVzcG9uc2UpID0+XG4gICAgICByZXNwb25zZS51cmwoKS5pbmNsdWRlcyhcIi9hcGkvYWkvY2hhdC9zdHJlYW1cIiksXG4gICAgKTtcbiAgICBhd2FpdCBzZW5kQnV0dG9uLmNsaWNrKCk7XG4gICAgY29uc3Qgc3RyZWFtUmVzcG9uc2UgPSBhd2FpdCBzdHJlYW1SZXNwb25zZVByb21pc2U7XG4gICAgZXhwZWN0KHN0cmVhbVJlc3BvbnNlLnN0YXR1cygpKS50b0JlKDIwMCk7XG5cbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChmaXh0dXJlLnF1ZXN0aW9uLCB7IGV4YWN0OiB0cnVlIH0pLmxhc3QoKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoZml4dHVyZS5hbnN3ZXIsIHsgZXhhY3Q6IHRydWUgfSkubGFzdCgpLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcIkFnZW50IGFjdGl2aXR5XCIsIHsgZXhhY3Q6IGZhbHNlIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBwYWdlLmxvY2F0b3IoXCJzdW1tYXJ5XCIpLmZpbHRlcih7IGhhc1RleHQ6IFwiQWdlbnQgYWN0aXZpdHlcIiB9KS5jbGljaygpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiUmVhZGluZyBzb3VyY2VcIiwgeyBleGFjdDogZmFsc2UgfSksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KGZpeHR1cmUuc291cmNlLCB7IGV4YWN0OiB0cnVlIH0pLmxhc3QoKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoL0JlaGF2aW9yIGV2aWRlbmNlIMK3IDEgZXhjZXJwdC9pKS5sYXN0KCksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2VcbiAgICAgICAgLmdldEJ5VGV4dCgncmV0dXJuIHBhcnRpYWxGcm9tQ29sbGVjdGVkRXZpZGVuY2UoXCJwcm92aWRlciB0aW1lb3V0XCIpOycsIHtcbiAgICAgICAgICBleGFjdDogdHJ1ZSxcbiAgICAgICAgfSlcbiAgICAgICAgLmxhc3QoKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG5cbiAgICBjb25zdCB2aXNpYmxlVGV4dCA9IGF3YWl0IHBhZ2UubG9jYXRvcihcImJvZHlcIikuaW5uZXJUZXh0KCk7XG4gICAgZXhwZWN0KHZpc2libGVUZXh0KS5ub3QudG9Db250YWluKFwiQ09NUExFVEVEXCIpO1xuICAgIGV4cGVjdCh2aXNpYmxlVGV4dCkubm90LnRvQ29udGFpbihcIlBlcnNpc3RlZCBleGVjdXRpb24gcHJvb2ZcIik7XG4gICAgZXhwZWN0KHZpc2libGVUZXh0KS50b0NvbnRhaW4oXCJOT1QgUFJPVkVOXCIpO1xuICB9KTtcblxuICB0ZXN0KFwia2VlcHMgdGhlIEFJIHNlc3Npb24gZHJhd2VyIG92ZXJsYWlkIG9uIGEgcGhvbmUgdmlld3BvcnQgd2l0aCBhY2NlcHRlZCBldmlkZW5jZVwiLCBhc3luYyAoe1xuICAgIHBhZ2UsXG4gIH0pID0+IHtcbiAgICBhd2FpdCBwYWdlLnNldFZpZXdwb3J0U2l6ZSh7IHdpZHRoOiAzOTAsIGhlaWdodDogODQ0IH0pO1xuICAgIGNvbnN0IGZpeHR1cmUgPSBhd2FpdCBpbnN0YWxsQXJhYmljQWlGaXh0dXJlKHBhZ2UpO1xuICAgIGF3YWl0IGluc3RhbGxBcGlGaXh0dXJlcyhwYWdlLCB7IGFyYWJpY0FpOiBmaXh0dXJlIH0pO1xuICAgIGF3YWl0IHByb2dyYW1tYXRpY1NpZ25JbihwYWdlKTtcbiAgICBhd2FpdCBwYWdlLmdvdG8oYCR7REFTSEJPQVJEX1BBVEh9YWlgKTtcblxuICAgIGNvbnN0IGNvbXBvc2VyID0gcGFnZS5sb2NhdG9yKFwidGV4dGFyZWFcIikuZmlyc3QoKTtcbiAgICBhd2FpdCBjb21wb3Nlci5maWxsKGZpeHR1cmUucXVlc3Rpb24pO1xuICAgIGF3YWl0IGNvbXBvc2VyLmxvY2F0b3IoXCJ4cGF0aD0uLlwiKS5nZXRCeVJvbGUoXCJidXR0b25cIikuY2xpY2soKTtcblxuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KGZpeHR1cmUuYW5zd2VyLCB7IGV4YWN0OiB0cnVlIH0pLmxhc3QoKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZVxuICAgICAgICAuZ2V0QnlUZXh0KGAke2ZpeHR1cmUuc291cmNlfTo0MmAsIHsgZXhhY3Q6IGZhbHNlIH0pXG4gICAgICAgIC5sYXN0KCksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IHBhZ2VcbiAgICAgIC5sb2NhdG9yKFwic3VtbWFyeVwiKVxuICAgICAgLmZpbHRlcih7IGhhc1RleHQ6IFwiQWdlbnQgYWN0aXZpdHlcIiB9KVxuICAgICAgLmxhc3QoKVxuICAgICAgLmNsaWNrKCk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcihcImJvZHlcIikpLnRvQ29udGFpblRleHQoXCJSZWFkaW5nIHNvdXJjZVwiKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKFwiYm9keVwiKSkudG9Db250YWluVGV4dChmaXh0dXJlLnNvdXJjZSk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcihcImJvZHlcIikpLnRvQ29udGFpblRleHQoXG4gICAgICBcIkFjY2VwdGVkOiBzb3VyY2Ugc3BhbiB2ZXJpZmllZC5cIixcbiAgICApO1xuICAgIGF3YWl0IGV4cGVjdE5vSG9yaXpvbnRhbE92ZXJmbG93KHBhZ2UpO1xuXG4gICAgY29uc3QgdmlzaWJsZVRleHQgPSBhd2FpdCBwYWdlLmxvY2F0b3IoXCJib2R5XCIpLmlubmVyVGV4dCgpO1xuICAgIGV4cGVjdCh2aXNpYmxlVGV4dCkubm90LnRvTWF0Y2goXG4gICAgICAvcmF3UHJvbXB0fHN5c3RlbVByb21wdHxwcm92aWRlciBkaWFnbm9zdGljc3xzb3VyY2Utd2luZG93fHJlY292ZXJ5IHByb21wdHxcXC9ob21lXFwvcnVubmVyL2ksXG4gICAgKTtcbiAgfSk7XG5cbiAgdGVzdChcImtlZXBzIHNhZmUgY2l0YXRpb24gc3RhdGUgYWNyb3NzIGJyb3dzZXIgYmFjayBhbmQgZm9yd2FyZCBuYXZpZ2F0aW9uIHdpdGggYmxvY2tlZCBldmlkZW5jZVwiLCBhc3luYyAoe1xuICAgIHBhZ2UsXG4gIH0pID0+IHtcbiAgICBjb25zdCBhY2NlcHRlZCA9IGF3YWl0IGluc3RhbGxBcmFiaWNBaUZpeHR1cmUocGFnZSwge1xuICAgICAgc2Vzc2lvbklkOiBcImUyZS1oaXN0b3J5LWFjY2VwdGVkLXNlc3Npb25cIixcbiAgICAgIHF1ZXN0aW9uOiBcItmF2Kcg2YfZiCDYs9mE2YjZgyDZhdmH2YTYqSBwcm92aWRlciDYudmG2K8g2KfZhNix2KzZiNi5INi52KjYsSDYs9is2YQg2KfZhNmF2KrYtdmB2K3Yn1wiLFxuICAgIH0pO1xuICAgIGNvbnN0IGJsb2NrZWQgPSBhd2FpdCBpbnN0YWxsQXJhYmljQWlGaXh0dXJlKHBhZ2UsIHtcbiAgICAgIGJsb2NrZWQ6IHRydWUsXG4gICAgICBzZXNzaW9uSWQ6IFwiZTJlLWhpc3RvcnktYmxvY2tlZC1zZXNzaW9uXCIsXG4gICAgICBxdWVzdGlvbjogXCLZhdinINmH2Ygg2KfZhNiv2YTZitmEINin2YTZhdit2KzZiNioINi52YbYryDYp9mE2LHYrNmI2Lkg2LnYqNixINiz2KzZhCDYp9mE2YXYqti12YHYrdifXCIsXG4gICAgfSk7XG4gICAgYXdhaXQgaW5zdGFsbEFwaUZpeHR1cmVzKHBhZ2UsIHtcbiAgICAgIGFyYWJpY0FpOiBhY2NlcHRlZCxcbiAgICAgIGFsdGVybmF0ZUFpOiBibG9ja2VkLFxuICAgIH0pO1xuICAgIGF3YWl0IHByb2dyYW1tYXRpY1NpZ25JbihwYWdlKTtcbiAgICBhd2FpdCBwYWdlLmdvdG8oYCR7REFTSEJPQVJEX1BBVEh9YWlgKTtcblxuICAgIGNvbnN0IGNvbXBvc2VyID0gcGFnZS5sb2NhdG9yKFwidGV4dGFyZWFcIikuZmlyc3QoKTtcbiAgICBhd2FpdCBjb21wb3Nlci5maWxsKGJsb2NrZWQucXVlc3Rpb24pO1xuICAgIGF3YWl0IGNvbXBvc2VyLmxvY2F0b3IoXCJ4cGF0aD0uLlwiKS5nZXRCeVJvbGUoXCJidXR0b25cIikuY2xpY2soKTtcblxuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KGJsb2NrZWQuYW5zd2VyLCB7IGV4YWN0OiB0cnVlIH0pLmxhc3QoKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgcGFnZVxuICAgICAgLmxvY2F0b3IoXCJzdW1tYXJ5XCIpXG4gICAgICAuZmlsdGVyKHsgaGFzVGV4dDogXCJBZ2VudCBhY3Rpdml0eVwiIH0pXG4gICAgICAubGFzdCgpXG4gICAgICAuY2xpY2soKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKFwiYm9keVwiKSkudG9Db250YWluVGV4dChcIlJlYWRpbmcgc291cmNlXCIpO1xuICAgIGNvbnN0IHZpc2libGVUZXh0ID0gYXdhaXQgcGFnZS5sb2NhdG9yKFwiYm9keVwiKS5pbm5lclRleHQoKTtcbiAgICBleHBlY3QodmlzaWJsZVRleHQpLm5vdC50b01hdGNoKFxuICAgICAgL3Jhd1Byb21wdHxzeXN0ZW1Qcm9tcHR8cHJvdmlkZXIgZGlhZ25vc3RpY3N8c291cmNlLXdpbmRvd3xyZWNvdmVyeSBwcm9tcHR8XFwvaG9tZVxcL3J1bm5lci9pLFxuICAgICk7XG4gIH0pO1xuXG4gIHRlc3QoXCJrZWVwcyBzYWZlIGNpdGF0aW9uIHN0YXRlIHdoZW4gc3dpdGNoaW5nIHByb2plY3RzXCIsIGFzeW5jICh7XG4gICAgcGFnZSxcbiAgfSkgPT4ge1xuICAgIGNvbnN0IGFjY2VwdGVkID0gYXdhaXQgaW5zdGFsbEFyYWJpY0FpRml4dHVyZShwYWdlLCB7XG4gICAgICBzZXNzaW9uSWQ6IFwiZTJlLWhpc3RvcnktYWNjZXB0ZWQtc2Vzc2lvblwiLFxuICAgICAgcXVlc3Rpb246IFwi2YXYpyDZh9mIINiz2YTZiNmDINmF2YfZhNipIHByb3ZpZGVyINi52YbYryDYp9mE2LHYrNmI2Lkg2LnYqNixINiz2KzZhCDYp9mE2YXYqti12YHYrdifXCIsXG4gICAgfSk7XG4gICAgY29uc3QgYmxvY2tlZCA9IGF3YWl0IGluc3RhbGxBcmFiaWNBaUZpeHR1cmUocGFnZSwge1xuICAgICAgYmxvY2tlZDogdHJ1ZSxcbiAgICAgIHNlc3Npb25JZDogXCJlMmUtaGlzdG9yeS1ibG9ja2VkLXNlc3Npb25cIixcbiAgICAgIHF1ZXN0aW9uOiBcItmF2Kcg2YfZiCDYp9mE2K/ZhNmK2YQg2KfZhNmF2K3YrNmI2Kgg2LnZhtivINin2YTYsdis2YjYuSDYudio2LEg2LPYrNmEINin2YTZhdiq2LXZgdit2J9cIixcbiAgICB9KTtcbiAgICBhd2FpdCBpbnN0YWxsQXBpRml4dHVyZXMocGFnZSwge1xuICAgICAgYXJhYmljQWk6IGFjY2VwdGVkLFxuICAgICAgYWx0ZXJuYXRlQWk6IGJsb2NrZWQsXG4gICAgICBwcm9qZWN0czogW1xuICAgICAgICB7XG4gICAgICAgICAgaWQ6IFwiZTJlLXByb2plY3Qtb25lXCIsXG4gICAgICAgICAgbmFtZTogXCJDaXRhdGlvbiBQcm9qZWN0IE9uZVwiLFxuICAgICAgICAgIGxhbmd1YWdlOiBcIlR5cGVTY3JpcHRcIixcbiAgICAgICAgICBmcmFtZXdvcms6IFwiUmVhY3RcIixcbiAgICAgICAgICBzdGF0dXM6IFwiYWN0aXZlXCIsXG4gICAgICAgICAgcm9vdFBhdGg6IFwiL2NvbnRyb2xsZWQvcHJvamVjdC1vbmVcIixcbiAgICAgICAgICBxdWFsaXR5U2NvcmU6IDkyLFxuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgaWQ6IFwiZTJlLXByb2plY3QtdHdvXCIsXG4gICAgICAgICAgbmFtZTogXCJDaXRhdGlvbiBQcm9qZWN0IFR3b1wiLFxuICAgICAgICAgIGxhbmd1YWdlOiBcIlR5cGVTY3JpcHRcIixcbiAgICAgICAgICBmcmFtZXdvcms6IFwiUmVhY3RcIixcbiAgICAgICAgICBzdGF0dXM6IFwiYWN0aXZlXCIsXG4gICAgICAgICAgcm9vdFBhdGg6IFwiL2NvbnRyb2xsZWQvcHJvamVjdC10d29cIixcbiAgICAgICAgICBxdWFsaXR5U2NvcmU6IDg4LFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICB9KTtcbiAgICBhd2FpdCBwcm9ncmFtbWF0aWNTaWduSW4ocGFnZSk7XG4gICAgYXdhaXQgcGFnZS5nb3RvKGAke0RBU0hCT0FSRF9QQVRIfWFpYCk7XG5cbiAgICBhd2FpdCBwYWdlXG4gICAgICAuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogYWNjZXB0ZWQucXVlc3Rpb24sIGV4YWN0OiB0cnVlIH0pXG4gICAgICAuY2xpY2soKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChhY2NlcHRlZC5hbnN3ZXIsIHsgZXhhY3Q6IHRydWUgfSkubGFzdCgpLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChgJHthY2NlcHRlZC5zb3VyY2V9OjQyYCwgeyBleGFjdDogZmFsc2UgfSkubGFzdCgpLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcIkFjY2VwdGVkOiBzb3VyY2Ugc3BhbiB2ZXJpZmllZC5cIiwgeyBleGFjdDogdHJ1ZSB9KS5sYXN0KCksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuXG4gICAgYXdhaXQgcGFnZS5nZXRCeVJvbGUoXCJjb21ib2JveFwiKS5zZWxlY3RPcHRpb24oXCJlMmUtcHJvamVjdC10d29cIik7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBibG9ja2VkLnF1ZXN0aW9uLCBleGFjdDogdHJ1ZSB9KSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlUZXh0KGFjY2VwdGVkLmFuc3dlciwgeyBleGFjdDogdHJ1ZSB9KSkudG9IYXZlQ291bnQoXG4gICAgICAwLFxuICAgICk7XG4gICAgYXdhaXQgcGFnZVxuICAgICAgLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IGJsb2NrZWQucXVlc3Rpb24sIGV4YWN0OiB0cnVlIH0pXG4gICAgICAuY2xpY2soKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlXG4gICAgICAgIC5nZXRCeVRleHQoXCJCbG9ja2VkOiBubyBtYXRjaGluZyBzb3VyY2UgdGV4dCB3YXMgZm91bmQuXCIsIHtcbiAgICAgICAgICBleGFjdDogdHJ1ZSxcbiAgICAgICAgfSlcbiAgICAgICAgLmxhc3QoKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoYCR7YmxvY2tlZC5zb3VyY2V9OjQyYCwgeyBleGFjdDogZmFsc2UgfSksXG4gICAgKS50b0hhdmVDb3VudCgwKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcIkFjY2VwdGVkOiBzb3VyY2Ugc3BhbiB2ZXJpZmllZC5cIiwgeyBleGFjdDogdHJ1ZSB9KSxcbiAgICApLnRvSGF2ZUNvdW50KDApO1xuXG4gICAgYXdhaXQgcGFnZS5nZXRCeVJvbGUoXCJjb21ib2JveFwiKS5zZWxlY3RPcHRpb24oXCJlMmUtcHJvamVjdC1vbmVcIik7XG4gICAgYXdhaXQgcGFnZVxuICAgICAgLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IGFjY2VwdGVkLnF1ZXN0aW9uLCBleGFjdDogdHJ1ZSB9KVxuICAgICAgLmNsaWNrKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoYCR7YWNjZXB0ZWQuc291cmNlfTo0MmAsIHsgZXhhY3Q6IGZhbHNlIH0pLmxhc3QoKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXCJBY2NlcHRlZDogc291cmNlIHNwYW4gdmVyaWZpZWQuXCIsIHsgZXhhY3Q6IHRydWUgfSkubGFzdCgpLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcIkJsb2NrZWQ6IG5vIG1hdGNoaW5nIHNvdXJjZSB0ZXh0IHdhcyBmb3VuZC5cIiwge1xuICAgICAgICBleGFjdDogdHJ1ZSxcbiAgICAgIH0pLFxuICAgICkudG9IYXZlQ291bnQoMCk7XG5cbiAgICBjb25zdCB2aXNpYmxlVGV4dCA9IGF3YWl0IHBhZ2UubG9jYXRvcihcImJvZHlcIikuaW5uZXJUZXh0KCk7XG4gICAgZXhwZWN0KHZpc2libGVUZXh0KS5ub3QudG9NYXRjaChcbiAgICAgIC9yYXdQcm9tcHR8c3lzdGVtUHJvbXB0fHByb3ZpZGVyIGRpYWdub3N0aWNzfHNvdXJjZS13aW5kb3d8cmVjb3ZlcnkgcHJvbXB0fFxcL2hvbWVcXC9ydW5uZXIvaSxcbiAgICApO1xuICB9KTtcblxuICB0ZXN0KFwia2VlcHMgc2FmZSBjaXRhdGlvbiBzdGF0ZSBhY3Jvc3MgcmVwZWF0ZWQgbmF2aWdhdGlvblwiLCBhc3luYyAoe1xuICAgIHBhZ2UsXG4gIH0pID0+IHtcbiAgICBjb25zdCBhY2NlcHRlZCA9IGF3YWl0IGluc3RhbGxBcmFiaWNBaUZpeHR1cmUocGFnZSwge1xuICAgICAgc2Vzc2lvbklkOiBcImUyZS1oaXN0b3J5LWFjY2VwdGVkLXNlc3Npb25cIixcbiAgICAgIHF1ZXN0aW9uOiBcItmF2Kcg2YfZiCDYs9mE2YjZgyDZhdmH2YTYqSBwcm92aWRlciDYudmG2K8g2KfZhNix2KzZiNi5INi52KjYsSDYs9is2YQg2KfZhNmF2KrYtdmB2K3Yn1wiLFxuICAgIH0pO1xuICAgIGNvbnN0IGJsb2NrZWQgPSBhd2FpdCBpbnN0YWxsQXJhYmljQWlGaXh0dXJlKHBhZ2UsIHtcbiAgICAgIGJsb2NrZWQ6IHRydWUsXG4gICAgICBzZXNzaW9uSWQ6IFwiZTJlLWhpc3RvcnktYmxvY2tlZC1zZXNzaW9uXCIsXG4gICAgICBxdWVzdGlvbjogXCLZhdinINmH2Ygg2KfZhNiv2YTZitmEINin2YTZhdit2KzZiNioINi52YbYryDYp9mE2LHYrNmI2Lkg2LnYqNixINiz2KzZhCDYp9mE2YXYqti12YHYrdifXCIsXG4gICAgfSk7XG4gICAgYXdhaXQgaW5zdGFsbEFwaUZpeHR1cmVzKHBhZ2UsIHtcbiAgICAgIGFyYWJpY0FpOiBhY2NlcHRlZCxcbiAgICAgIGFsdGVybmF0ZUFpOiBibG9ja2VkLFxuICAgIH0pO1xuICAgIGF3YWl0IHByb2dyYW1tYXRpY1NpZ25JbihwYWdlKTtcbiAgICBhd2FpdCBwYWdlLmdvdG8oYCR7REFTSEJPQVJEX1BBVEh9YWlgKTtcblxuICAgIGNvbnN0IGFzc2VydEFjY2VwdGVkQ2l0YXRpb24gPSBhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCBleHBlY3QoXG4gICAgICAgIHBhZ2UuZ2V0QnlUZXh0KGFjY2VwdGVkLmFuc3dlciwgeyBleGFjdDogdHJ1ZSB9KS5sYXN0KCksXG4gICAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgICBhd2FpdCBleHBlY3QoXG4gICAgICAgIHBhZ2UuZ2V0QnlUZXh0KGAke2FjY2VwdGVkLnNvdXJjZX06NDJgLCB7IGV4YWN0OiBmYWxzZSB9KS5sYXN0KCksXG4gICAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgICBhd2FpdCBleHBlY3QoXG4gICAgICAgIHBhZ2VcbiAgICAgICAgICAuZ2V0QnlUZXh0KFwiQWNjZXB0ZWQ6IHNvdXJjZSBzcGFuIHZlcmlmaWVkLlwiLCB7IGV4YWN0OiB0cnVlIH0pXG4gICAgICAgICAgLmxhc3QoKSxcbiAgICAgICkudG9CZVZpc2libGUoKTtcbiAgICAgIGF3YWl0IGV4cGVjdChcbiAgICAgICAgcGFnZS5nZXRCeVRleHQoXCJCbG9ja2VkOiBubyBtYXRjaGluZyBzb3VyY2UgdGV4dCB3YXMgZm91bmQuXCIsIHtcbiAgICAgICAgICBleGFjdDogdHJ1ZSxcbiAgICAgICAgfSksXG4gICAgICApLnRvSGF2ZUNvdW50KDApO1xuICAgIH07XG4gICAgY29uc3QgYXNzZXJ0QmxvY2tlZENpdGF0aW9uID0gYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgZXhwZWN0KFxuICAgICAgICBwYWdlXG4gICAgICAgICAgLmdldEJ5VGV4dChcIkJsb2NrZWQ6IG5vIG1hdGNoaW5nIHNvdXJjZSB0ZXh0IHdhcyBmb3VuZC5cIiwge1xuICAgICAgICAgICAgZXhhY3Q6IHRydWUsXG4gICAgICAgICAgfSlcbiAgICAgICAgICAubGFzdCgpLFxuICAgICAgKS50b0JlVmlzaWJsZSgpO1xuICAgICAgYXdhaXQgZXhwZWN0KFxuICAgICAgICBwYWdlLmdldEJ5VGV4dChgJHtibG9ja2VkLnNvdXJjZX06NDJgLCB7IGV4YWN0OiBmYWxzZSB9KSxcbiAgICAgICkudG9IYXZlQ291bnQoMCk7XG4gICAgICBhd2FpdCBleHBlY3QoXG4gICAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiQWNjZXB0ZWQ6IHNvdXJjZSBzcGFuIHZlcmlmaWVkLlwiLCB7IGV4YWN0OiB0cnVlIH0pLFxuICAgICAgKS50b0hhdmVDb3VudCgwKTtcbiAgICB9O1xuICAgIGNvbnN0IGFzc2VydE5vSW50ZXJuYWxDaXRhdGlvbkRldGFpbHMgPSBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCB2aXNpYmxlVGV4dCA9IGF3YWl0IHBhZ2UubG9jYXRvcihcImJvZHlcIikuaW5uZXJUZXh0KCk7XG4gICAgICBleHBlY3QodmlzaWJsZVRleHQpLm5vdC50b01hdGNoKFxuICAgICAgICAvTUlTU0lOR19MSVRFUkFMX01BVENIfHJhd1Byb21wdHxzeXN0ZW1Qcm9tcHR8cHJvdmlkZXIgZGlhZ25vc3RpY3N8c291cmNlLXdpbmRvd3xyZWNvdmVyeSBwcm9tcHR8XFwvaG9tZVxcL3J1bm5lci9pLFxuICAgICAgKTtcbiAgICB9O1xuXG4gICAgYXdhaXQgcGFnZVxuICAgICAgLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IGFjY2VwdGVkLnF1ZXN0aW9uLCBleGFjdDogdHJ1ZSB9KVxuICAgICAgLmNsaWNrKCk7XG4gICAgYXdhaXQgYXNzZXJ0QWNjZXB0ZWRDaXRhdGlvbigpO1xuXG4gICAgYXdhaXQgb3Blbk5hdmlnYXRpb24ocGFnZSwgXCJQcm9qZWN0c1wiLCBgJHtEQVNIQk9BUkRfUEFUSH1wcm9qZWN0c2ApO1xuICAgIGF3YWl0IHBhZ2UuZ29CYWNrKCk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UpLnRvSGF2ZVVSTChcbiAgICAgIG5ldyBSZWdFeHAoYCR7REFTSEJPQVJEX1BBVEgucmVwbGFjZUFsbChcIi9cIiwgXCJcXFxcL1wiKX1haSRgKSxcbiAgICApO1xuICAgIGF3YWl0IHBhZ2VcbiAgICAgIC5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBhY2NlcHRlZC5xdWVzdGlvbiwgZXhhY3Q6IHRydWUgfSlcbiAgICAgIC5jbGljaygpO1xuICAgIGF3YWl0IGFzc2VydEFjY2VwdGVkQ2l0YXRpb24oKTtcbiAgICBhd2FpdCBhc3NlcnROb0ludGVybmFsQ2l0YXRpb25EZXRhaWxzKCk7XG5cbiAgICBhd2FpdCBwYWdlLmdvRm9yd2FyZCgpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlKS50b0hhdmVVUkwoXG4gICAgICBuZXcgUmVnRXhwKGAke0RBU0hCT0FSRF9QQVRILnJlcGxhY2VBbGwoXCIvXCIsIFwiXFxcXC9cIil9cHJvamVjdHMkYCksXG4gICAgKTtcbiAgICBhd2FpdCBwYWdlLmdvQmFjaygpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlKS50b0hhdmVVUkwoXG4gICAgICBuZXcgUmVnRXhwKGAke0RBU0hCT0FSRF9QQVRILnJlcGxhY2VBbGwoXCIvXCIsIFwiXFxcXC9cIil9YWkkYCksXG4gICAgKTtcbiAgICBhd2FpdCBwYWdlXG4gICAgICAuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogYWNjZXB0ZWQucXVlc3Rpb24sIGV4YWN0OiB0cnVlIH0pXG4gICAgICAuY2xpY2soKTtcbiAgICBhd2FpdCBhc3NlcnRBY2NlcHRlZENpdGF0aW9uKCk7XG5cbiAgICBhd2FpdCBwYWdlXG4gICAgICAuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogYmxvY2tlZC5xdWVzdGlvbiwgZXhhY3Q6IHRydWUgfSlcbiAgICAgIC5jbGljaygpO1xuICAgIGF3YWl0IGFzc2VydEJsb2NrZWRDaXRhdGlvbigpO1xuXG4gICAgYXdhaXQgb3Blbk5hdmlnYXRpb24ocGFnZSwgXCJFdmVudCBTdHJlYW1cIiwgYCR7REFTSEJPQVJEX1BBVEh9ZXZlbnRzYCk7XG4gICAgYXdhaXQgcGFnZS5nb0JhY2soKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZSkudG9IYXZlVVJMKFxuICAgICAgbmV3IFJlZ0V4cChgJHtEQVNIQk9BUkRfUEFUSC5yZXBsYWNlQWxsKFwiL1wiLCBcIlxcXFwvXCIpfWFpJGApLFxuICAgICk7XG4gICAgYXdhaXQgcGFnZVxuICAgICAgLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IGJsb2NrZWQucXVlc3Rpb24sIGV4YWN0OiB0cnVlIH0pXG4gICAgICAuY2xpY2soKTtcbiAgICBhd2FpdCBhc3NlcnRCbG9ja2VkQ2l0YXRpb24oKTtcbiAgICBhd2FpdCBhc3NlcnROb0ludGVybmFsQ2l0YXRpb25EZXRhaWxzKCk7XG5cbiAgICBhd2FpdCBwYWdlLmdvRm9yd2FyZCgpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlKS50b0hhdmVVUkwoXG4gICAgICBuZXcgUmVnRXhwKGAke0RBU0hCT0FSRF9QQVRILnJlcGxhY2VBbGwoXCIvXCIsIFwiXFxcXC9cIil9ZXZlbnRzJGApLFxuICAgICk7XG4gICAgYXdhaXQgcGFnZS5nb0JhY2soKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZSkudG9IYXZlVVJMKFxuICAgICAgbmV3IFJlZ0V4cChgJHtEQVNIQk9BUkRfUEFUSC5yZXBsYWNlQWxsKFwiL1wiLCBcIlxcXFwvXCIpfWFpJGApLFxuICAgICk7XG4gICAgYXdhaXQgcGFnZVxuICAgICAgLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IGJsb2NrZWQucXVlc3Rpb24sIGV4YWN0OiB0cnVlIH0pXG4gICAgICAuY2xpY2soKTtcbiAgICBhd2FpdCBhc3NlcnRCbG9ja2VkQ2l0YXRpb24oKTtcbiAgICBhd2FpdCBhc3NlcnROb0ludGVybmFsQ2l0YXRpb25EZXRhaWxzKCk7XG4gIH0pO1xuXG4gIHRlc3QoXCJrZWVwcyBvbmx5IHRoZSBzYWZlIGJsb2NrZWQgY2l0YXRpb24gcmVhc29uIGFmdGVyIGNoYXQgcmVsb2FkXCIsIGFzeW5jICh7XG4gICAgcGFnZSxcbiAgfSkgPT4ge1xuICAgIGNvbnN0IGZpeHR1cmUgPSBpbnN0YWxsVG9vbEZhaWx1cmVGaXh0dXJlKCk7XG4gICAgYXdhaXQgaW5zdGFsbEFwaUZpeHR1cmVzKHBhZ2UsIHsgYXJhYmljQWk6IGZpeHR1cmUgfSk7XG4gICAgYXdhaXQgcHJvZ3JhbW1hdGljU2lnbkluKHBhZ2UpO1xuICAgIGF3YWl0IHBhZ2UuZ290byhgJHtEQVNIQk9BUkRfUEFUSH1haWApO1xuXG4gICAgY29uc3QgY29tcG9zZXIgPSBwYWdlLmxvY2F0b3IoXCJ0ZXh0YXJlYVwiKS5maXJzdCgpO1xuICAgIGF3YWl0IGNvbXBvc2VyLmZpbGwoZml4dHVyZS5xdWVzdGlvbik7XG4gICAgYXdhaXQgY29tcG9zZXIubG9jYXRvcihcInhwYXRoPS4uXCIpLmdldEJ5Um9sZShcImJ1dHRvblwiKS5jbGljaygpO1xuXG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoZml4dHVyZS5hbnN3ZXIsIHsgZXhhY3Q6IHRydWUgfSkubGFzdCgpLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlXG4gICAgICAgIC5nZXRCeVRleHQoXCJyZXF1aXJlZCB0b29sIGRpZCBub3QgY29tcGxldGUg4oCUIEJMT0NLRUQvSU5DT01QTEVURVwiLCB7XG4gICAgICAgICAgZXhhY3Q6IGZhbHNlLFxuICAgICAgICB9KVxuICAgICAgICAubGFzdCgpLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBwYWdlXG4gICAgICAubG9jYXRvcihcInN1bW1hcnlcIilcbiAgICAgIC5maWx0ZXIoeyBoYXNUZXh0OiBcIkFnZW50IGFjdGl2aXR5XCIgfSlcbiAgICAgIC5sYXN0KClcbiAgICAgIC5jbGljaygpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoXCJib2R5XCIpKS50b0NvbnRhaW5UZXh0KFwiUmVhZGluZyBzb3VyY2VcIik7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcihcImJvZHlcIikpLnRvQ29udGFpblRleHQoXG4gICAgICBcInNyYy9taXNzaW5nLXJlbGVhc2UtZml4dHVyZS50c1wiLFxuICAgICk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcihcImJvZHlcIikpLnRvQ29udGFpblRleHQoXCJUb29sIGZhaWxlZFwiKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKFwiYm9keVwiKSkudG9Db250YWluVGV4dChcIlRPT0xfRVhFQ1VUSU9OX0ZBSUxFRFwiKTtcbiAgICBjb25zdCB2aXNpYmxlVGV4dCA9IGF3YWl0IHBhZ2UubG9jYXRvcihcImJvZHlcIikuaW5uZXJUZXh0KCk7XG4gICAgZXhwZWN0KHZpc2libGVUZXh0KS5ub3QudG9Db250YWluKFwiQ09NUExFVEVEXCIpO1xuICAgIGV4cGVjdCh2aXNpYmxlVGV4dCkudG9Db250YWluKFwiUGVyc2lzdGVkIGV4ZWN1dGlvbiBwcm9vZlwiKTtcbiAgICBleHBlY3QodmlzaWJsZVRleHQpLnRvQ29udGFpbihcIlRoZSByZXF1aXJlZCBzb3VyY2UgcmVhZCBkaWQgbm90IGNvbXBsZXRlLlwiKTtcbiAgfSk7XG5cbiAgdGVzdChcImtlZXBzIHRoZSBmYWlsZWQgQUkgc2Vzc2lvbiBkcmF3ZXIgb3ZlcmxhaWQgb24gYSBwaG9uZSB2aWV3cG9ydFwiLCBhc3luYyAoe1xuICAgIHBhZ2UsXG4gIH0pID0+IHtcbiAgICBhd2FpdCBwYWdlLnNldFZpZXdwb3J0U2l6ZSh7IHdpZHRoOiAzOTAsIGhlaWdodDogODQ0IH0pO1xuICAgIGNvbnN0IGZpeHR1cmUgPSBpbnN0YWxsVG9vbEZhaWx1cmVGaXh0dXJlKCk7XG4gICAgYXdhaXQgaW5zdGFsbEFwaUZpeHR1cmVzKHBhZ2UsIHsgYXJhYmljQWk6IGZpeHR1cmUgfSk7XG4gICAgYXdhaXQgcHJvZ3JhbW1hdGljU2lnbkluKHBhZ2UpO1xuICAgIGF3YWl0IHBhZ2UuZ290byhgJHtEQVNIQk9BUkRfUEFUSH1haWApO1xuXG4gICAgY29uc3QgY29tcG9zZXIgPSBwYWdlLmxvY2F0b3IoXCJ0ZXh0YXJlYVwiKS5maXJzdCgpO1xuICAgIGF3YWl0IGNvbXBvc2VyLmZpbGwoZml4dHVyZS5xdWVzdGlvbik7XG4gICAgYXdhaXQgY29tcG9zZXIubG9jYXRvcihcInhwYXRoPS4uXCIpLmdldEJ5Um9sZShcImJ1dHRvblwiKS5jbGljaygpO1xuXG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoZml4dHVyZS5hbnN3ZXIsIHsgZXhhY3Q6IHRydWUgfSkubGFzdCgpLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlXG4gICAgICAgIC5nZXRCeVRleHQoXCJyZXF1aXJlZCB0b29sIGRpZCBub3QgY29tcGxldGUg4oCUIEJMT0NLRUQvSU5DT01QTEVURVwiLCB7XG4gICAgICAgICAgZXhhY3Q6IGZhbHNlLFxuICAgICAgICB9KVxuICAgICAgICAubGFzdCgpLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBwYWdlXG4gICAgICAubG9jYXRvcihcInN1bW1hcnlcIilcbiAgICAgIC5maWx0ZXIoeyBoYXNUZXh0OiBcIkFnZW50IGFjdGl2aXR5XCIgfSlcbiAgICAgIC5sYXN0KClcbiAgICAgIC5jbGljaygpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoXCJib2R5XCIpKS50b0NvbnRhaW5UZXh0KFwiUmVhZGluZyBzb3VyY2VcIik7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcihcImJvZHlcIikpLnRvQ29udGFpblRleHQoXG4gICAgICBcInNyYy9taXNzaW5nLXJlbGVhc2UtZml4dHVyZS50c1wiLFxuICAgICk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcihcImJvZHlcIikpLnRvQ29udGFpblRleHQoXCJUb29sIGZhaWxlZFwiKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKFwiYm9keVwiKSkudG9Db250YWluVGV4dChcIlRPT0xfRVhFQ1VUSU9OX0ZBSUxFRFwiKTtcbiAgICBjb25zdCB2aXNpYmxlVGV4dCA9IGF3YWl0IHBhZ2UubG9jYXRvcihcImJvZHlcIikuaW5uZXJUZXh0KCk7XG4gICAgZXhwZWN0KHZpc2libGVUZXh0KS5ub3QudG9NYXRjaChcbiAgICAgIC9yYXcgZXhjZXB0aW9ufHN0YWNrIHRyYWNlfFxcL2hvbWVcXC9ydW5uZXJ8c2VjcmV0fGZpeHR1cmUgZGlhZ25vc3RpYy9pLFxuICAgICk7XG5cbiAgICBhd2FpdCBleHBlY3ROb0hvcml6b250YWxPdmVyZmxvdyhwYWdlKTtcbiAgfSk7XG5cbiAgdGVzdChcInByZXNlcnZlcyBvbmUgcGFydGlhbCBhbnN3ZXIgYWZ0ZXIgYSBwcm92aWRlciBkaXNjb25uZWN0IGFuZCBtYXJrcyBpdCBpbmNvbXBsZXRlXCIsIGFzeW5jICh7XG4gICAgcGFnZSxcbiAgfSkgPT4ge1xuICAgIGNvbnN0IGZpeHR1cmUgPSBpbnN0YWxsRGlzY29ubmVjdGVkQWlGaXh0dXJlKCk7XG4gICAgYXdhaXQgaW5zdGFsbEFwaUZpeHR1cmVzKHBhZ2UsIHsgZGlzY29ubmVjdEFpOiBmaXh0dXJlIH0pO1xuICAgIGF3YWl0IHByb2dyYW1tYXRpY1NpZ25JbihwYWdlKTtcbiAgICBhd2FpdCBwYWdlLmdvdG8oYCR7REFTSEJPQVJEX1BBVEh9YWlgKTtcblxuICAgIGNvbnN0IGNvbXBvc2VyID0gcGFnZS5sb2NhdG9yKFwidGV4dGFyZWFcIikuZmlyc3QoKTtcbiAgICBhd2FpdCBjb21wb3Nlci5maWxsKGZpeHR1cmUucXVlc3Rpb24pO1xuICAgIGF3YWl0IGNvbXBvc2VyLmxvY2F0b3IoXCJ4cGF0aD0uLlwiKS5nZXRCeVJvbGUoXCJidXR0b25cIikuY2xpY2soKTtcblxuICAgIGNvbnN0IGFuc3dlciA9IHBhZ2UuZ2V0QnlUZXh0KGZpeHR1cmUuYW5zd2VyLCB7IGV4YWN0OiB0cnVlIH0pO1xuICAgIGF3YWl0IGV4cGVjdChhbnN3ZXIubGFzdCgpKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlLmdldEJ5VGV4dChcIklOQ09NUExFVEU6XCIsIHsgZXhhY3Q6IGZhbHNlIH0pKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwicHJvdmlkZXIgZmFpbHVyZVwiLCB7IGV4YWN0OiBmYWxzZSB9KS5sYXN0KCksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwic3RvcHBlZDogcHJvdmlkZXIgdGltZW91dFwiLCB7IGV4YWN0OiBmYWxzZSB9KS5sYXN0KCksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiVGhlIHByb3ZpZGVyIGRpc2Nvbm5lY3RlZCBhZnRlciB2aXNpYmxlIHJlc3BvbnNlIHRleHQuXCIsIHtcbiAgICAgICAgZXhhY3Q6IHRydWUsXG4gICAgICB9KSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG5cbiAgICBhd2FpdCBwYWdlLnJlbG9hZCgpO1xuICAgIGF3YWl0IHBhZ2VcbiAgICAgIC5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBmaXh0dXJlLnF1ZXN0aW9uLCBleGFjdDogdHJ1ZSB9KVxuICAgICAgLmNsaWNrKCk7XG5cbiAgICBhd2FpdCBleHBlY3QocGFnZS5nZXRCeVRleHQoZml4dHVyZS5hbnN3ZXIsIHsgZXhhY3Q6IHRydWUgfSkubGFzdCgpKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlLmdldEJ5VGV4dChcIklOQ09NUExFVEU6XCIsIHsgZXhhY3Q6IGZhbHNlIH0pKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwicHJvdmlkZXIgZmFpbHVyZVwiLCB7IGV4YWN0OiBmYWxzZSB9KS5sYXN0KCksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwic3RvcHBlZDogcHJvdmlkZXIgdGltZW91dFwiLCB7IGV4YWN0OiBmYWxzZSB9KS5sYXN0KCksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiVGhlIHByb3ZpZGVyIGRpc2Nvbm5lY3RlZCBhZnRlciB2aXNpYmxlIHJlc3BvbnNlIHRleHQuXCIsIHtcbiAgICAgICAgZXhhY3Q6IHRydWUsXG4gICAgICB9KSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gIH0pO1xuXG4gIHRlc3QoXCJyZXN1bWVzIGEgZmFpbGVkIGFuYWx5c2lzIGFuZCBrZWVwcyB0aGUgZXhlY3V0aW9uIGluY29tcGxldGVcIiwgYXN5bmMgKHtcbiAgICBwYWdlLFxuICB9KSA9PiB7XG4gICAgY29uc3QgeyBmaXh0dXJlLCBleGVjdXRpb24gfSA9IGluc3RhbGxSZXN1bWVkQW5hbHlzaXNGYWlsdXJlRml4dHVyZSgpO1xuICAgIGF3YWl0IGluc3RhbGxBcGlGaXh0dXJlcyhwYWdlLCB7XG4gICAgICBhcmFiaWNBaTogZml4dHVyZSxcbiAgICAgIHJlc3VtZUZhaWx1cmU6IHsgZml4dHVyZSwgZXhlY3V0aW9uIH0sXG4gICAgfSk7XG4gICAgYXdhaXQgcHJvZ3JhbW1hdGljU2lnbkluKHBhZ2UpO1xuXG4gICAgYXdhaXQgcGFnZS5ldmFsdWF0ZShcbiAgICAgICh7IHNlc3Npb25JZCwgZXhlY3V0aW9uSWQsIHByb2plY3RJZCwgcmVzdW1lVG9rZW4sIG1lc3NhZ2UgfSkgPT4ge1xuICAgICAgICBsb2NhbFN0b3JhZ2Uuc2V0SXRlbShcbiAgICAgICAgICBgZW9zX2FpX2V4ZWN1dGlvbl9jdXJyZW50XyR7cHJvamVjdElkfWAsXG4gICAgICAgICAgc2Vzc2lvbklkLFxuICAgICAgICApO1xuICAgICAgICBsb2NhbFN0b3JhZ2Uuc2V0SXRlbShcbiAgICAgICAgICBgZW9zX2FpX2V4ZWN1dGlvbl8ke3Byb2plY3RJZH1fJHtzZXNzaW9uSWR9YCxcbiAgICAgICAgICBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAgICBpZDogZXhlY3V0aW9uSWQsXG4gICAgICAgICAgICBwcm9qZWN0SWQsXG4gICAgICAgICAgICBzZXNzaW9uSWQsXG4gICAgICAgICAgICByZXN1bWVUb2tlbixcbiAgICAgICAgICAgIG1lc3NhZ2UsXG4gICAgICAgICAgfSksXG4gICAgICAgICk7XG4gICAgICB9LFxuICAgICAge1xuICAgICAgICBzZXNzaW9uSWQ6IGZpeHR1cmUuc2Vzc2lvbklkLFxuICAgICAgICBleGVjdXRpb25JZDogZml4dHVyZS5leGVjdXRpb25JZCxcbiAgICAgICAgcHJvamVjdElkOiBcImUyZS1wcm9qZWN0XCIsXG4gICAgICAgIHJlc3VtZVRva2VuOiBcImUyZS1yZXN1bWVkLWFuYWx5c2lzLWZhaWx1cmUtdG9rZW4tb3BhcXVlXCIsXG4gICAgICAgIG1lc3NhZ2U6IGZpeHR1cmUucXVlc3Rpb24sXG4gICAgICB9LFxuICAgICk7XG4gICAgYXdhaXQgcGFnZS5nb3RvKGAke0RBU0hCT0FSRF9QQVRIfWFpYCk7XG5cbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcIkEgc2F2ZWQgQUkgZXhlY3V0aW9uIGlzIHJlYWR5IHRvIHJlc3VtZVwiKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgY29uc3QgcmVzdW1lUmVxdWVzdCA9IHBhZ2Uud2FpdEZvclJlcXVlc3QoXG4gICAgICAocmVxdWVzdCkgPT5cbiAgICAgICAgcmVxdWVzdC51cmwoKS5pbmNsdWRlcyhcIi9hcGkvYWkvY2hhdC9zdHJlYW1cIikgJiZcbiAgICAgICAgcmVxdWVzdC5tZXRob2QoKSA9PT0gXCJQT1NUXCIsXG4gICAgKTtcbiAgICBhd2FpdCBwYWdlXG4gICAgICAuZ2V0QnlMYWJlbChcIkFnZW50IGV4ZWN1dGlvbiBwcm9vZlwiKVxuICAgICAgLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiUmVzdW1lXCIsIGV4YWN0OiB0cnVlIH0pXG4gICAgICAuY2xpY2soKTtcbiAgICBjb25zdCByZXF1ZXN0Qm9keSA9IEpTT04ucGFyc2UoXG4gICAgICAoYXdhaXQgcmVzdW1lUmVxdWVzdCkucG9zdERhdGEoKSA/PyBcInt9XCIsXG4gICAgKSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgICBleHBlY3QocmVxdWVzdEJvZHkpLnRvRXF1YWwoXG4gICAgICBleHBlY3Qub2JqZWN0Q29udGFpbmluZyh7XG4gICAgICAgIHByb2plY3RJZDogXCJlMmUtcHJvamVjdFwiLFxuICAgICAgICBzZXNzaW9uSWQ6IGZpeHR1cmUuc2Vzc2lvbklkLFxuICAgICAgICBleGVjdXRpb25JZDogZml4dHVyZS5leGVjdXRpb25JZCxcbiAgICAgICAgcmVzdW1lVG9rZW46IFwiZTJlLXJlc3VtZWQtYW5hbHlzaXMtZmFpbHVyZS10b2tlbi1vcGFxdWVcIixcbiAgICAgICAgbWVzc2FnZTogZml4dHVyZS5xdWVzdGlvbixcbiAgICAgIH0pLFxuICAgICk7XG5cbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcIkZhaWxlZCB0byBzZW5kIG1lc3NhZ2VcIiwgeyBleGFjdDogdHJ1ZSB9KSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXCJBIHNhdmVkIEFJIGV4ZWN1dGlvbiBpcyByZWFkeSB0byByZXN1bWVcIiksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGNvbnN0IHZpc2libGVUZXh0ID0gYXdhaXQgcGFnZS5sb2NhdG9yKFwiYm9keVwiKS5pbm5lclRleHQoKTtcbiAgICBleHBlY3QodmlzaWJsZVRleHQpLm5vdC50b0NvbnRhaW4oXCJDT01QTEVURURcIik7XG4gICAgZXhwZWN0KHZpc2libGVUZXh0KS5ub3QudG9Db250YWluKFwiUGVyc2lzdGVkIGV4ZWN1dGlvbiBwcm9vZlwiKTtcbiAgICBleHBlY3QodmlzaWJsZVRleHQpLnRvQ29udGFpbihcIlRoZSByZXF1aXJlZCBhbmFseXNpcyBkaWQgbm90IGNvbXBsZXRlLlwiKTtcbiAgfSk7XG5cbiAgdGVzdChcInJlY292ZXJzIGEgbWlzc2luZyB0b2tlbiBhZnRlciBhIHJlYWwgc3RyZWFtIGFib3J0IGFuZCByZXN1bWVzIG9uZSBleGVjdXRpb25cIiwgYXN5bmMgKHtcbiAgICBwYWdlLFxuICB9KSA9PiB7XG4gICAgY29uc3QgcmVjb3ZlcnkgPSBpbnN0YWxsSW50ZXJydXB0ZWRSZXN1bWVGaXh0dXJlKCk7XG4gICAgYXdhaXQgaW5zdGFsbEFwaUZpeHR1cmVzKHBhZ2UsIHsgaW50ZXJydXB0ZWRSZXN1bWU6IHJlY292ZXJ5IH0pO1xuICAgIGF3YWl0IHBhZ2UuYWRkSW5pdFNjcmlwdCgoKSA9PiB7XG4gICAgICBjb25zdCBuYXRpdmVGZXRjaCA9IHdpbmRvdy5mZXRjaC5iaW5kKHdpbmRvdyk7XG4gICAgICB3aW5kb3cuZmV0Y2ggPSBhc3luYyAoaW5wdXQsIGluaXQpID0+IHtcbiAgICAgICAgY29uc3QgdXJsID1cbiAgICAgICAgICB0eXBlb2YgaW5wdXQgPT09IFwic3RyaW5nXCJcbiAgICAgICAgICAgID8gaW5wdXRcbiAgICAgICAgICAgIDogaW5wdXQgaW5zdGFuY2VvZiBSZXF1ZXN0XG4gICAgICAgICAgICAgID8gaW5wdXQudXJsXG4gICAgICAgICAgICAgIDogU3RyaW5nKGlucHV0KTtcbiAgICAgICAgY29uc3QgYm9keSA9IHR5cGVvZiBpbml0Py5ib2R5ID09PSBcInN0cmluZ1wiID8gaW5pdC5ib2R5IDogXCJcIjtcbiAgICAgICAgaWYgKFxuICAgICAgICAgICF1cmwuaW5jbHVkZXMoXCIvYXBpL2FpL2NoYXQvc3RyZWFtXCIpIHx8XG4gICAgICAgICAgYm9keS5pbmNsdWRlcygnXCJleGVjdXRpb25JZFwiJylcbiAgICAgICAgKSB7XG4gICAgICAgICAgcmV0dXJuIG5hdGl2ZUZldGNoKGlucHV0LCBpbml0KTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgbmF0aXZlRmV0Y2goaW5wdXQsIGluaXQpO1xuICAgICAgICBpZiAoIXJlc3BvbnNlLmJvZHkpIHJldHVybiByZXNwb25zZTtcbiAgICAgICAgY29uc3QgcmVhZGVyID0gcmVzcG9uc2UuYm9keS5nZXRSZWFkZXIoKTtcbiAgICAgICAgY29uc3QgZW5jb2RlciA9IG5ldyBUZXh0RW5jb2RlcigpO1xuICAgICAgICBjb25zdCBzdHJlYW0gPSBuZXcgUmVhZGFibGVTdHJlYW0oe1xuICAgICAgICAgIGFzeW5jIHN0YXJ0KGNvbnRyb2xsZXIpIHtcbiAgICAgICAgICAgIGxldCBidWZmZXJlZCA9IFwiXCI7XG4gICAgICAgICAgICB3aGlsZSAodHJ1ZSkge1xuICAgICAgICAgICAgICBjb25zdCB7IGRvbmUsIHZhbHVlIH0gPSBhd2FpdCByZWFkZXIucmVhZCgpO1xuICAgICAgICAgICAgICBpZiAoZG9uZSkge1xuICAgICAgICAgICAgICAgIGlmIChidWZmZXJlZCkgY29udHJvbGxlci5lbnF1ZXVlKGVuY29kZXIuZW5jb2RlKGJ1ZmZlcmVkKSk7XG4gICAgICAgICAgICAgICAgY29udHJvbGxlci5jbG9zZSgpO1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICBidWZmZXJlZCArPSBuZXcgVGV4dERlY29kZXIoKS5kZWNvZGUodmFsdWUsIHsgc3RyZWFtOiB0cnVlIH0pO1xuICAgICAgICAgICAgICBjb25zdCBtYXJrZXIgPSBidWZmZXJlZC5pbmRleE9mKCdcInR5cGVcIjpcImV4ZWN1dGlvbl9zdGFydGVkXCInKTtcbiAgICAgICAgICAgICAgY29uc3QgZnJhbWVFbmQgPVxuICAgICAgICAgICAgICAgIG1hcmtlciA8IDAgPyAtMSA6IGJ1ZmZlcmVkLmluZGV4T2YoXCJcXG5cXG5cIiwgbWFya2VyKTtcbiAgICAgICAgICAgICAgaWYgKGZyYW1lRW5kID49IDApIHtcbiAgICAgICAgICAgICAgICBjb250cm9sbGVyLmVucXVldWUoXG4gICAgICAgICAgICAgICAgICBlbmNvZGVyLmVuY29kZShidWZmZXJlZC5zbGljZSgwLCBmcmFtZUVuZCArIDIpKSxcbiAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICAgIGNvbnRyb2xsZXIuZXJyb3IobmV3IFR5cGVFcnJvcihcIm5ldHdvcmsgY29ubmVjdGlvbiByZXNldFwiKSk7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSxcbiAgICAgICAgfSk7XG4gICAgICAgIHJldHVybiBuZXcgUmVzcG9uc2Uoc3RyZWFtLCB7XG4gICAgICAgICAgc3RhdHVzOiByZXNwb25zZS5zdGF0dXMsXG4gICAgICAgICAgc3RhdHVzVGV4dDogcmVzcG9uc2Uuc3RhdHVzVGV4dCxcbiAgICAgICAgICBoZWFkZXJzOiByZXNwb25zZS5oZWFkZXJzLFxuICAgICAgICB9KTtcbiAgICAgIH07XG4gICAgfSk7XG4gICAgYXdhaXQgcHJvZ3JhbW1hdGljU2lnbkluKHBhZ2UpO1xuICAgIGF3YWl0IHBhZ2UuZ290byhgJHtEQVNIQk9BUkRfUEFUSH1haWApO1xuXG4gICAgY29uc3Qgc3RyZWFtUmVxdWVzdHM6IEFycmF5PFJlY29yZDxzdHJpbmcsIHVua25vd24+PiA9IFtdO1xuICAgIHBhZ2Uub24oXCJyZXF1ZXN0XCIsIChyZXF1ZXN0KSA9PiB7XG4gICAgICBpZiAoXG4gICAgICAgIHJlcXVlc3QudXJsKCkuaW5jbHVkZXMoXCIvYXBpL2FpL2NoYXQvc3RyZWFtXCIpICYmXG4gICAgICAgIHJlcXVlc3QubWV0aG9kKCkgPT09IFwiUE9TVFwiXG4gICAgICApIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBzdHJlYW1SZXF1ZXN0cy5wdXNoKFxuICAgICAgICAgICAgcmVxdWVzdC5wb3N0RGF0YUpTT04oKSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPixcbiAgICAgICAgICApO1xuICAgICAgICB9IGNhdGNoIHtcbiAgICAgICAgICAvLyBJZ25vcmUgcmVxdWVzdHMgd2l0aG91dCBhIEpTT04gYm9keTsgdGhlIGFzc2VydGlvbnMgYmVsb3cgcmVxdWlyZVxuICAgICAgICAgIC8vIGJvdGggam91cm5leSByZXF1ZXN0cyB0byBoYXZlIGEgdmFsaWQgcmVxdWVzdCBlbnZlbG9wZS5cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0pO1xuXG4gICAgY29uc3QgY29tcG9zZXIgPSBwYWdlLmxvY2F0b3IoXCJ0ZXh0YXJlYVwiKS5maXJzdCgpO1xuICAgIGF3YWl0IGNvbXBvc2VyLmZpbGwocmVjb3ZlcnkuZml4dHVyZS5xdWVzdGlvbik7XG4gICAgYXdhaXQgY29tcG9zZXIubG9jYXRvcihcInhwYXRoPS4uXCIpLmdldEJ5Um9sZShcImJ1dHRvblwiKS5jbGljaygpO1xuXG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXG4gICAgICAgIFwiRXhlY3V0aW9uIHBhdXNlZCDigJQgcmVhZHkgdG8gcmVzdW1lIGZyb20gaXRzIGR1cmFibGUgY2hlY2twb2ludFwiLFxuICAgICAgICB7XG4gICAgICAgICAgZXhhY3Q6IHRydWUsXG4gICAgICAgIH0sXG4gICAgICApLFxuICAgICkudG9CZVZpc2libGUoKTtcblxuICAgIGNvbnN0IHN0b3JhZ2VLZXkgPVxuICAgICAgXCJlb3NfYWlfZXhlY3V0aW9uX2UyZS1wcm9qZWN0X2UyZS1pbnRlcnJ1cHRlZC1yZXN1bWUtc2Vzc2lvblwiO1xuICAgIGNvbnN0IHBvaW50ZXJLZXkgPSBcImVvc19haV9leGVjdXRpb25fY3VycmVudF9lMmUtcHJvamVjdFwiO1xuICAgIGF3YWl0IGV4cGVjdFxuICAgICAgLnBvbGwoKCkgPT4gcGFnZS5ldmFsdWF0ZSgoa2V5KSA9PiBsb2NhbFN0b3JhZ2UuZ2V0SXRlbShrZXkpLCBzdG9yYWdlS2V5KSlcbiAgICAgIC50b0NvbnRhaW4ocmVjb3ZlcnkuaW5pdGlhbFRva2VuKTtcblxuICAgIGF3YWl0IHBhZ2UuZXZhbHVhdGUoXG4gICAgICAoeyBzdG9yYWdlS2V5LCBwb2ludGVyS2V5IH0pID0+IHtcbiAgICAgICAgY29uc3Qgc2F2ZWQgPSBKU09OLnBhcnNlKGxvY2FsU3RvcmFnZS5nZXRJdGVtKHN0b3JhZ2VLZXkpID8/IFwie31cIik7XG4gICAgICAgIGRlbGV0ZSBzYXZlZC5yZXN1bWVUb2tlbjtcbiAgICAgICAgbG9jYWxTdG9yYWdlLnNldEl0ZW0oc3RvcmFnZUtleSwgSlNPTi5zdHJpbmdpZnkoc2F2ZWQpKTtcbiAgICAgICAgbG9jYWxTdG9yYWdlLnNldEl0ZW0ocG9pbnRlcktleSwgXCJlMmUtaW50ZXJydXB0ZWQtcmVzdW1lLXNlc3Npb25cIik7XG4gICAgICB9LFxuICAgICAgeyBzdG9yYWdlS2V5LCBwb2ludGVyS2V5IH0sXG4gICAgKTtcbiAgICBhd2FpdCBwYWdlLnJlbG9hZCgpO1xuXG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXCJBIHNhdmVkIEFJIGV4ZWN1dGlvbiBpcyByZWFkeSB0byByZXN1bWVcIiwge1xuICAgICAgICBleGFjdDogdHJ1ZSxcbiAgICAgIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3RcbiAgICAgIC5wb2xsKCgpID0+XG4gICAgICAgIHBhZ2UuZXZhbHVhdGUoKGtleSkgPT4ge1xuICAgICAgICAgIGNvbnN0IHNhdmVkID0gSlNPTi5wYXJzZShsb2NhbFN0b3JhZ2UuZ2V0SXRlbShrZXkpID8/IFwie31cIik7XG4gICAgICAgICAgcmV0dXJuIHNhdmVkLnJlc3VtZVRva2VuO1xuICAgICAgICB9LCBzdG9yYWdlS2V5KSxcbiAgICAgIClcbiAgICAgIC50b0JlKHJlY292ZXJ5LnJlY292ZXJlZFRva2VuKTtcblxuICAgIGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJSZXN1bWVcIiwgZXhhY3Q6IHRydWUgfSkuY2xpY2soKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChyZWNvdmVyeS5maXh0dXJlLmFuc3dlciwgeyBleGFjdDogdHJ1ZSB9KSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0LnBvbGwoKCkgPT4gc3RyZWFtUmVxdWVzdHMubGVuZ3RoKS50b0JlKDIpO1xuICAgIGV4cGVjdChzdHJlYW1SZXF1ZXN0c1swXSkudG9FcXVhbChcbiAgICAgIGV4cGVjdC5vYmplY3RDb250YWluaW5nKHtcbiAgICAgICAgcHJvamVjdElkOiBcImUyZS1wcm9qZWN0XCIsXG4gICAgICAgIG1lc3NhZ2U6IHJlY292ZXJ5LmZpeHR1cmUucXVlc3Rpb24sXG4gICAgICB9KSxcbiAgICApO1xuICAgIGV4cGVjdChzdHJlYW1SZXF1ZXN0c1swXT8uZXhlY3V0aW9uSWQpLnRvQmVVbmRlZmluZWQoKTtcbiAgICBleHBlY3Qoc3RyZWFtUmVxdWVzdHNbMF0/LnNlc3Npb25JZCkudG9CZVVuZGVmaW5lZCgpO1xuICAgIGV4cGVjdChzdHJlYW1SZXF1ZXN0c1sxXSkudG9FcXVhbChcbiAgICAgIGV4cGVjdC5vYmplY3RDb250YWluaW5nKHtcbiAgICAgICAgcHJvamVjdElkOiBcImUyZS1wcm9qZWN0XCIsXG4gICAgICAgIHNlc3Npb25JZDogcmVjb3ZlcnkuZml4dHVyZS5zZXNzaW9uSWQsXG4gICAgICAgIGV4ZWN1dGlvbklkOiByZWNvdmVyeS5maXh0dXJlLmV4ZWN1dGlvbklkLFxuICAgICAgICByZXN1bWVUb2tlbjogcmVjb3ZlcnkucmVjb3ZlcmVkVG9rZW4sXG4gICAgICAgIG1lc3NhZ2U6IHJlY292ZXJ5LmZpeHR1cmUucXVlc3Rpb24sXG4gICAgICB9KSxcbiAgICApO1xuICAgIGV4cGVjdChcbiAgICAgIHN0cmVhbVJlcXVlc3RzLm1hcCgocmVxdWVzdCkgPT4gcmVxdWVzdC5leGVjdXRpb25JZCkuZmlsdGVyKEJvb2xlYW4pLFxuICAgICkudG9FcXVhbChbcmVjb3ZlcnkuZml4dHVyZS5leGVjdXRpb25JZF0pO1xuICB9KTtcblxuICB0ZXN0KFwicHJvamVjdHMgZGVsaXZlcnkgcmVjb3Zlcnkgc3RhdGVzIHNhZmVseSBhZnRlciByZWxvYWRcIiwgYXN5bmMgKHtcbiAgICBwYWdlLFxuICB9KSA9PiB7XG4gICAgY29uc3QgcmVjb3ZlcnkgPSB7XG4gICAgICByZXF1ZXN0czogW10gYXMgc3RyaW5nW10sXG4gICAgICBvcGVyYXRpb25zOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBwcm9wb3NhbElkOiBcImUyZS1yZWNvdmVyeS1hdmFpbGFibGUtcHJvcG9zYWxcIixcbiAgICAgICAgICBvcGVyYXRpb25JZDogXCJlMmUtcmVjb3ZlcnktYXZhaWxhYmxlLW9wZXJhdGlvblwiLFxuICAgICAgICAgIHNlc3Npb25JZDogXCJlMmUtcmVjb3ZlcnktYXZhaWxhYmxlLXNlc3Npb25cIixcbiAgICAgICAgICBsaWZlY3ljbGU6IFwiYmxvY2tlZFwiLFxuICAgICAgICAgIHN0YXR1czogXCJwZW5kaW5nXCIsXG4gICAgICAgICAgY3JlYXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDM6MDAuMDAwWlwiLFxuICAgICAgICAgIHJlY292ZXJ5U3RhdGU6IFwicmVjb3ZlcmFibGVcIixcbiAgICAgICAgICBvcGVyYXRvckV4cGxhbmF0aW9uOlxuICAgICAgICAgICAgXCJUaGUgZGVsaXZlcnkgc3RvcHBlZCBiZWNhdXNlIHZhbGlkYXRpb24gbmVlZHMgdG8gYmUgcnVuIGFnYWluLlwiLFxuICAgICAgICAgIG5leHRBY3Rpb246XG4gICAgICAgICAgICBcIlJlc3VtZSB2YWxpZGF0aW9uIHRvIHJlLWNoZWNrIHRoZSBzYXZlZCBjaGFuZ2VzLCBvciBkaXNjYXJkIHRoaXMgcmVjb3ZlcnkgaWYgaXQgaXMgbm8gbG9uZ2VyIG5lZWRlZC5cIixcbiAgICAgICAgICBjb25mbGljdFJlYXNvbjogbnVsbCxcbiAgICAgICAgICB2YWxpZGF0aW9uRXZpZGVuY2U6IFt7IHByb2ZpbGU6IFwid29ya3NwYWNlLXR5cGVjaGVja1wiLCBzdGF0dXM6IFwiZmFpbGVkXCIgfV0sXG4gICAgICAgICAgd29ya3NwYWNlQXZhaWxhYmxlOiB0cnVlLFxuICAgICAgICAgIGNoYW5nZUNvdW50OiAyLFxuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgcHJvcG9zYWxJZDogXCJlMmUtcmVjb3ZlcnktbWlzc2luZy1wcm9wb3NhbFwiLFxuICAgICAgICAgIG9wZXJhdGlvbklkOiBcImUyZS1yZWNvdmVyeS1taXNzaW5nLW9wZXJhdGlvblwiLFxuICAgICAgICAgIHNlc3Npb25JZDogXCJlMmUtcmVjb3ZlcnktbWlzc2luZy1zZXNzaW9uXCIsXG4gICAgICAgICAgbGlmZWN5Y2xlOiBcImFiYW5kb25lZFwiLFxuICAgICAgICAgIHN0YXR1czogXCJwZW5kaW5nXCIsXG4gICAgICAgICAgY3JlYXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDI6MDAuMDAwWlwiLFxuICAgICAgICAgIHJlY292ZXJ5U3RhdGU6IFwibWlzc2luZ193b3Jrc3BhY2VcIixcbiAgICAgICAgICBvcGVyYXRvckV4cGxhbmF0aW9uOlxuICAgICAgICAgICAgXCJUaGUgc2F2ZWQgZGVsaXZlcnkgd29ya3NwYWNlIGlzIG5vIGxvbmdlciBhdmFpbGFibGUsIHNvIHJlY292ZXJ5IGNhbm5vdCBjb250aW51ZS5cIixcbiAgICAgICAgICBuZXh0QWN0aW9uOlxuICAgICAgICAgICAgXCJTdGFydCBhIG5ldyBkZWxpdmVyeSBmcm9tIHRoZSBjdXJyZW50IHByb2plY3QgcmF0aGVyIHRoYW4gcmV0cnlpbmcgdGhpcyByZWNvdmVyeS5cIixcbiAgICAgICAgICBjb25mbGljdFJlYXNvbjogXCJXb3Jrc3BhY2UgZXhwaXJlZCBhZnRlciB0aGUgcnVubmVyIHdhcyByZWN5Y2xlZC5cIixcbiAgICAgICAgICB2YWxpZGF0aW9uRXZpZGVuY2U6IG51bGwsXG4gICAgICAgICAgd29ya3NwYWNlQXZhaWxhYmxlOiBmYWxzZSxcbiAgICAgICAgICBjaGFuZ2VDb3VudDogMSxcbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgIHByb3Bvc2FsSWQ6IFwiZTJlLXJlY292ZXJ5LWRpc2NhcmRlZC1wcm9wb3NhbFwiLFxuICAgICAgICAgIG9wZXJhdGlvbklkOiBcImUyZS1yZWNvdmVyeS1kaXNjYXJkZWQtb3BlcmF0aW9uXCIsXG4gICAgICAgICAgc2Vzc2lvbklkOiBcImUyZS1yZWNvdmVyeS1kaXNjYXJkZWQtc2Vzc2lvblwiLFxuICAgICAgICAgIGxpZmVjeWNsZTogXCJjYW5jZWxsZWRcIixcbiAgICAgICAgICBzdGF0dXM6IFwicmVqZWN0ZWRcIixcbiAgICAgICAgICBjcmVhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMTowMC4wMDBaXCIsXG4gICAgICAgICAgcmVjb3ZlcnlTdGF0ZTogXCJkaXNjYXJkZWRcIixcbiAgICAgICAgICBvcGVyYXRvckV4cGxhbmF0aW9uOiBcIlRoaXMgZGVsaXZlcnkgcmVjb3Zlcnkgd2FzIGFscmVhZHkgZGlzY2FyZGVkLlwiLFxuICAgICAgICAgIG5leHRBY3Rpb246IFwiTm8gYWN0aW9uIGlzIHJlcXVpcmVkLlwiLFxuICAgICAgICAgIGNvbmZsaWN0UmVhc29uOiBcIkludGVybmFsIGRpYWdub3N0aWM6IHNob3VsZCBuZXZlciBiZSByZW5kZXJlZFwiLFxuICAgICAgICAgIHZhbGlkYXRpb25FdmlkZW5jZTogbnVsbCxcbiAgICAgICAgICB3b3Jrc3BhY2VBdmFpbGFibGU6IGZhbHNlLFxuICAgICAgICAgIGNoYW5nZUNvdW50OiAzLFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICB9O1xuICAgIGF3YWl0IGluc3RhbGxBcGlGaXh0dXJlcyhwYWdlLCB7IGRlbGl2ZXJ5UmVjb3Zlcnk6IHJlY292ZXJ5IH0pO1xuICAgIGF3YWl0IHByb2dyYW1tYXRpY1NpZ25JbihwYWdlKTtcbiAgICBhd2FpdCBwYWdlLmdvdG8oYCR7REFTSEJPQVJEX1BBVEh9YWlgKTtcblxuICAgIGNvbnN0IHJlZ2lvbiA9IHBhZ2UuZ2V0QnlSb2xlKFwicmVnaW9uXCIsIHtcbiAgICAgIG5hbWU6IFwiUmVjb3ZlcmFibGUgZGVsaXZlcnkgb3BlcmF0aW9uc1wiLFxuICAgIH0pO1xuICAgIGF3YWl0IGV4cGVjdChyZWdpb24pLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KHJlZ2lvbi5nZXRCeVRleHQoXCJSZWNvdmVyYWJsZVwiLCB7IGV4YWN0OiB0cnVlIH0pKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHJlZ2lvbi5nZXRCeVRleHQoXCJXb3Jrc3BhY2UgdW5hdmFpbGFibGVcIiwgeyBleGFjdDogdHJ1ZSB9KSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcmVnaW9uLmdldEJ5VGV4dChcIkFscmVhZHkgZGlzY2FyZGVkXCIsIHsgZXhhY3Q6IHRydWUgfSksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHJlZ2lvbi5nZXRCeVRleHQoXG4gICAgICAgIFwiVGhlIHNhdmVkIGRlbGl2ZXJ5IHdvcmtzcGFjZSBpcyBubyBsb25nZXIgYXZhaWxhYmxlLCBzbyByZWNvdmVyeSBjYW5ub3QgY29udGludWUuXCIsXG4gICAgICAgIHsgZXhhY3Q6IHRydWUgfSxcbiAgICAgICksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHJlZ2lvbi5nZXRCeVRleHQoXCJUaGlzIGRlbGl2ZXJ5IHJlY292ZXJ5IHdhcyBhbHJlYWR5IGRpc2NhcmRlZC5cIiwge1xuICAgICAgICBleGFjdDogdHJ1ZSxcbiAgICAgIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICByZWdpb24uZ2V0QnlUZXh0KFxuICAgICAgICBcIlJldGFpbmVkIHJlYXNvbjogV29ya3NwYWNlIGV4cGlyZWQgYWZ0ZXIgdGhlIHJ1bm5lciB3YXMgcmVjeWNsZWQuXCIsXG4gICAgICAgIHsgZXhhY3Q6IHRydWUgfSxcbiAgICAgICksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuXG4gICAgY29uc3QgYXZhaWxhYmxlID0gcmVnaW9uLmxvY2F0b3IoXG4gICAgICAnW2RhdGEtb3BlcmF0aW9uLWlkPVwiZTJlLXJlY292ZXJ5LWF2YWlsYWJsZS1vcGVyYXRpb25cIl0nLFxuICAgICk7XG4gICAgY29uc3QgbWlzc2luZyA9IHJlZ2lvbi5sb2NhdG9yKFxuICAgICAgJ1tkYXRhLW9wZXJhdGlvbi1pZD1cImUyZS1yZWNvdmVyeS1taXNzaW5nLW9wZXJhdGlvblwiXScsXG4gICAgKTtcbiAgICBjb25zdCBkaXNjYXJkZWQgPSByZWdpb24ubG9jYXRvcihcbiAgICAgICdbZGF0YS1vcGVyYXRpb24taWQ9XCJlMmUtcmVjb3ZlcnktZGlzY2FyZGVkLW9wZXJhdGlvblwiXScsXG4gICAgKTtcbiAgICBhd2FpdCBleHBlY3QoYXZhaWxhYmxlKS50b0hhdmVBdHRyaWJ1dGUoXG4gICAgICBcImRhdGEtcmVjb3Zlcnktc3RhdGVcIixcbiAgICAgIFwicmVjb3ZlcmFibGVcIixcbiAgICApO1xuICAgIGF3YWl0IGV4cGVjdChtaXNzaW5nKS50b0hhdmVBdHRyaWJ1dGUoXG4gICAgICBcImRhdGEtcmVjb3Zlcnktc3RhdGVcIixcbiAgICAgIFwibWlzc2luZ193b3Jrc3BhY2VcIixcbiAgICApO1xuICAgIGF3YWl0IGV4cGVjdChkaXNjYXJkZWQpLnRvSGF2ZUF0dHJpYnV0ZShcbiAgICAgIFwiZGF0YS1yZWNvdmVyeS1zdGF0ZVwiLFxuICAgICAgXCJkaXNjYXJkZWRcIixcbiAgICApO1xuICAgIGF3YWl0IGV4cGVjdChhdmFpbGFibGUuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJSZXN1bWUgdmFsaWRhdGlvblwiIH0pKS50b0JlRW5hYmxlZCgpO1xuICAgIGF3YWl0IGV4cGVjdChhdmFpbGFibGUuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJEaXNjYXJkIHdvcmtzcGFjZVwiIH0pKS50b0JlRW5hYmxlZCgpO1xuICAgIGF3YWl0IGV4cGVjdChtaXNzaW5nLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiUmVzdW1lIHZhbGlkYXRpb25cIiB9KSkudG9CZURpc2FibGVkKCk7XG4gICAgYXdhaXQgZXhwZWN0KG1pc3NpbmcuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJEaXNjYXJkIHdvcmtzcGFjZVwiIH0pKS50b0JlRGlzYWJsZWQoKTtcbiAgICBhd2FpdCBleHBlY3QoZGlzY2FyZGVkLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiUmVzdW1lIHZhbGlkYXRpb25cIiB9KSkudG9CZURpc2FibGVkKCk7XG4gICAgYXdhaXQgZXhwZWN0KGRpc2NhcmRlZC5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIkRpc2NhcmQgd29ya3NwYWNlXCIgfSkpLnRvQmVEaXNhYmxlZCgpO1xuXG4gICAgY29uc3QgdmlzaWJsZVRleHQgPSBhd2FpdCBwYWdlLmxvY2F0b3IoXCJib2R5XCIpLmlubmVyVGV4dCgpO1xuICAgIGV4cGVjdCh2aXNpYmxlVGV4dCkubm90LnRvTWF0Y2goXG4gICAgICAvXFwvaG9tZVxcL3J1bm5lcnxcXC90bXBcXC98XFwvd29ya3NwYWNlXFwvfGludGVybmFsIGRpYWdub3N0aWMvaSxcbiAgICApO1xuICAgIGF3YWl0IGV4cGVjdE5vSG9yaXpvbnRhbE92ZXJmbG93KHBhZ2UpO1xuXG4gICAgYXdhaXQgcGFnZS5yZWxvYWQoKTtcbiAgICBjb25zdCByZWxvYWRlZFJlZ2lvbiA9IHBhZ2UuZ2V0QnlSb2xlKFwicmVnaW9uXCIsIHtcbiAgICAgIG5hbWU6IFwiUmVjb3ZlcmFibGUgZGVsaXZlcnkgb3BlcmF0aW9uc1wiLFxuICAgIH0pO1xuICAgIGF3YWl0IGV4cGVjdChyZWxvYWRlZFJlZ2lvbikudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICByZWxvYWRlZFJlZ2lvblxuICAgICAgICAubG9jYXRvcignW2RhdGEtb3BlcmF0aW9uLWlkPVwiZTJlLXJlY292ZXJ5LW1pc3Npbmctb3BlcmF0aW9uXCJdJylcbiAgICAgICAgLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiUmVzdW1lIHZhbGlkYXRpb25cIiB9KSxcbiAgICApLnRvQmVEaXNhYmxlZCgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHJlbG9hZGVkUmVnaW9uXG4gICAgICAgIC5sb2NhdG9yKCdbZGF0YS1vcGVyYXRpb24taWQ9XCJlMmUtcmVjb3ZlcnktZGlzY2FyZGVkLW9wZXJhdGlvblwiXScpXG4gICAgICAgIC5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIkRpc2NhcmQgd29ya3NwYWNlXCIgfSksXG4gICAgKS50b0JlRGlzYWJsZWQoKTtcbiAgICBleHBlY3QocmVjb3ZlcnkucmVxdWVzdHMubGVuZ3RoKS50b0JlR3JlYXRlclRoYW5PckVxdWFsKDIpO1xuICAgIGV4cGVjdChyZWNvdmVyeS5yZXF1ZXN0cy5ldmVyeSgodXJsKSA9PiB1cmwuaW5jbHVkZXMoXCJwcm9qZWN0SWQ9ZTJlLXByb2plY3RcIikpKS50b0JlKHRydWUpO1xuICB9KTtcblxuICB0ZXN0KFwiZXhwbGFpbnMgd2hlbiBkZWxpdmVyeSByZWNvdmVyeSBsb3NlcyBhIHJhY2UgYW5kIHJlZnJlc2hlcyBzdGF0ZVwiLCBhc3luYyAoe1xuICAgIHBhZ2UsXG4gIH0pID0+IHtcbiAgICBjb25zdCByZWNvdmVyeSA9IHtcbiAgICAgIHJlcXVlc3RzOiBbXSBhcyBzdHJpbmdbXSxcbiAgICAgIGFjdGlvblJlcXVlc3RzOiBbXSBhcyBzdHJpbmdbXSxcbiAgICAgIG9wZXJhdGlvbnM6IFtcbiAgICAgICAge1xuICAgICAgICAgIHByb3Bvc2FsSWQ6IFwiZTJlLXJlY292ZXJ5LXJhY2UtcHJvcG9zYWxcIixcbiAgICAgICAgICBvcGVyYXRpb25JZDogXCJlMmUtcmVjb3ZlcnktcmFjZS1vcGVyYXRpb25cIixcbiAgICAgICAgICBzZXNzaW9uSWQ6IFwiZTJlLXJlY292ZXJ5LXJhY2Utc2Vzc2lvblwiLFxuICAgICAgICAgIGxpZmVjeWNsZTogXCJibG9ja2VkXCIsXG4gICAgICAgICAgc3RhdHVzOiBcInBlbmRpbmdcIixcbiAgICAgICAgICBjcmVhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowNDowMC4wMDBaXCIsXG4gICAgICAgICAgcmVjb3ZlcnlTdGF0ZTogXCJyZWNvdmVyYWJsZVwiLFxuICAgICAgICAgIG9wZXJhdG9yRXhwbGFuYXRpb246XG4gICAgICAgICAgICBcIlRoZSBkZWxpdmVyeSBzdG9wcGVkIGJlY2F1c2UgdGhlIHJldGFpbmVkIGNoYW5nZXMgbmVlZCByZXZpZXcgYmVmb3JlIHZhbGlkYXRpb24gY2FuIGNvbnRpbnVlLlwiLFxuICAgICAgICAgIG5leHRBY3Rpb246XG4gICAgICAgICAgICBcIlJlc3VtZSB2YWxpZGF0aW9uIHRvIHJlLWNoZWNrIHRoZSBzYXZlZCBjaGFuZ2VzLCBvciBkaXNjYXJkIHRoaXMgcmVjb3ZlcnkgaWYgaXQgaXMgbm8gbG9uZ2VyIG5lZWRlZC5cIixcbiAgICAgICAgICBjb25mbGljdFJlYXNvbjogbnVsbCxcbiAgICAgICAgICB2YWxpZGF0aW9uRXZpZGVuY2U6IFt7IHByb2ZpbGU6IFwid29ya3NwYWNlLXR5cGVjaGVja1wiLCBzdGF0dXM6IFwiZmFpbGVkXCIgfV0sXG4gICAgICAgICAgd29ya3NwYWNlQXZhaWxhYmxlOiB0cnVlLFxuICAgICAgICAgIGNoYW5nZUNvdW50OiAxLFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICAgIHJlY292ZXJ5QWN0aW9uOiB7XG4gICAgICAgIHByb3Bvc2FsSWQ6IFwiZTJlLXJlY292ZXJ5LXJhY2UtcHJvcG9zYWxcIixcbiAgICAgICAgYWN0aW9uOiBcInJlc3VtZS12YWxpZGF0aW9uXCIgYXMgY29uc3QsXG4gICAgICAgIHJlc3BvbnNlOiB7XG4gICAgICAgICAgZXJyb3I6IFwiVGhpcyBkZWxpdmVyeSByZWNvdmVyeSB3YXMgYWxyZWFkeSBkaXNjYXJkZWQuXCIsXG4gICAgICAgICAgY29kZTogXCJERUxJVkVSWV9BTFJFQURZX0RJU0NBUkRFRFwiLFxuICAgICAgICAgIGxpZmVjeWNsZTogXCJjYW5jZWxsZWRcIixcbiAgICAgICAgICByZWNvdmVyeVN0YXRlOiBcImRpc2NhcmRlZFwiLFxuICAgICAgICAgIG5leHRBY3Rpb246IFwiTm8gYWN0aW9uIGlzIHJlcXVpcmVkLlwiLFxuICAgICAgICAgIGRpYWdub3N0aWM6IFwiRG8gbm90IHJlbmRlciB0aGlzIHNlcnZlciBkZXRhaWwuXCIsXG4gICAgICAgIH0sXG4gICAgICAgIG5leHRPcGVyYXRpb25zOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgcHJvcG9zYWxJZDogXCJlMmUtcmVjb3ZlcnktcmFjZS1wcm9wb3NhbFwiLFxuICAgICAgICAgICAgb3BlcmF0aW9uSWQ6IFwiZTJlLXJlY292ZXJ5LXJhY2Utb3BlcmF0aW9uXCIsXG4gICAgICAgICAgICBzZXNzaW9uSWQ6IFwiZTJlLXJlY292ZXJ5LXJhY2Utc2Vzc2lvblwiLFxuICAgICAgICAgICAgbGlmZWN5Y2xlOiBcImNhbmNlbGxlZFwiLFxuICAgICAgICAgICAgc3RhdHVzOiBcInJlamVjdGVkXCIsXG4gICAgICAgICAgICBjcmVhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowNDowMC4wMDBaXCIsXG4gICAgICAgICAgICByZWNvdmVyeVN0YXRlOiBcImRpc2NhcmRlZFwiLFxuICAgICAgICAgICAgb3BlcmF0b3JFeHBsYW5hdGlvbjogXCJUaGlzIGRlbGl2ZXJ5IHJlY292ZXJ5IHdhcyBhbHJlYWR5IGRpc2NhcmRlZC5cIixcbiAgICAgICAgICAgIG5leHRBY3Rpb246IFwiTm8gYWN0aW9uIGlzIHJlcXVpcmVkLlwiLFxuICAgICAgICAgICAgY29uZmxpY3RSZWFzb246IG51bGwsXG4gICAgICAgICAgICB2YWxpZGF0aW9uRXZpZGVuY2U6IG51bGwsXG4gICAgICAgICAgICB3b3Jrc3BhY2VBdmFpbGFibGU6IGZhbHNlLFxuICAgICAgICAgICAgY2hhbmdlQ291bnQ6IDEsXG4gICAgICAgICAgfSxcbiAgICAgICAgXSxcbiAgICAgIH0sXG4gICAgfTtcbiAgICBhd2FpdCBpbnN0YWxsQXBpRml4dHVyZXMocGFnZSwgeyBkZWxpdmVyeVJlY292ZXJ5OiByZWNvdmVyeSB9KTtcbiAgICBhd2FpdCBwcm9ncmFtbWF0aWNTaWduSW4ocGFnZSk7XG4gICAgYXdhaXQgcGFnZS5nb3RvKGAke0RBU0hCT0FSRF9QQVRIfWFpYCk7XG5cbiAgICBjb25zdCByZWdpb24gPSBwYWdlLmdldEJ5Um9sZShcInJlZ2lvblwiLCB7XG4gICAgICBuYW1lOiBcIlJlY292ZXJhYmxlIGRlbGl2ZXJ5IG9wZXJhdGlvbnNcIixcbiAgICB9KTtcbiAgICBjb25zdCBvcGVyYXRpb24gPSByZWdpb24ubG9jYXRvcihcbiAgICAgICdbZGF0YS1vcGVyYXRpb24taWQ9XCJlMmUtcmVjb3ZlcnktcmFjZS1vcGVyYXRpb25cIl0nLFxuICAgICk7XG4gICAgYXdhaXQgZXhwZWN0KG9wZXJhdGlvbi5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIlJlc3VtZSB2YWxpZGF0aW9uXCIgfSkpLnRvQmVFbmFibGVkKCk7XG4gICAgYXdhaXQgb3BlcmF0aW9uLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiUmVzdW1lIHZhbGlkYXRpb25cIiB9KS5jbGljaygpO1xuXG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlUZXh0KFwiUmVjb3Zlcnkgc3RhdGUgY2hhbmdlZFwiLCB7IGV4YWN0OiB0cnVlIH0pKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFxuICAgICAgICBcIlRoaXMgcmVjb3Zlcnkgd2FzIGFscmVhZHkgZGlzY2FyZGVkLiBUaGUgcmVjb3ZlcnkgbGlzdCB3YXMgcmVmcmVzaGVkLlwiLFxuICAgICAgICB7IGV4YWN0OiB0cnVlIH0sXG4gICAgICApLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3RcbiAgICAgIC5wb2xsKCgpID0+IHJlY292ZXJ5LnJlcXVlc3RzLmxlbmd0aClcbiAgICAgIC50b0JlR3JlYXRlclRoYW5PckVxdWFsKDIpO1xuICAgIGF3YWl0IGV4cGVjdChvcGVyYXRpb24pLnRvSGF2ZUF0dHJpYnV0ZShcImRhdGEtcmVjb3Zlcnktc3RhdGVcIiwgXCJkaXNjYXJkZWRcIik7XG4gICAgZXhwZWN0KHJlY292ZXJ5LmFjdGlvblJlcXVlc3RzKS50b0hhdmVMZW5ndGgoMSk7XG4gICAgZXhwZWN0KHJlY292ZXJ5LmFjdGlvblJlcXVlc3RzWzBdKS50b0NvbnRhaW4oXG4gICAgICBcIi9hcGkvYWkvZGVsaXZlcnkvZTJlLXJlY292ZXJ5LXJhY2UtcHJvcG9zYWwvcmVzdW1lLXZhbGlkYXRpb25cIixcbiAgICApO1xuICAgIGV4cGVjdChhd2FpdCByZWdpb24ubG9jYXRvcignW2RhdGEtb3BlcmF0aW9uLWlkPVwiZTJlLXJlY292ZXJ5LXJhY2Utb3BlcmF0aW9uXCJdJykuY291bnQoKSkudG9CZSgxKTtcbiAgICBjb25zdCB2aXNpYmxlVGV4dCA9IGF3YWl0IHBhZ2UubG9jYXRvcihcImJvZHlcIikuaW5uZXJUZXh0KCk7XG4gICAgZXhwZWN0KHZpc2libGVUZXh0KS5ub3QudG9NYXRjaCgvRG8gbm90IHJlbmRlciB0aGlzIHNlcnZlciBkZXRhaWx8XFwvaG9tZVxcL3J1bm5lcnxcXC90bXBcXC8vaSk7XG4gICAgYXdhaXQgZXhwZWN0Tm9Ib3Jpem9udGFsT3ZlcmZsb3cocGFnZSk7XG4gIH0pO1xuXG4gIHRlc3QoXCJleHBsYWlucyB3aGVuIGFuIG9sZCByZWNvdmVyeSBsaW5rIHBvaW50cyB0byBhIGRlbGV0ZWQgb3BlcmF0aW9uXCIsIGFzeW5jICh7XG4gICAgcGFnZSxcbiAgfSkgPT4ge1xuICAgIGNvbnN0IHJlY292ZXJ5ID0ge1xuICAgICAgcmVxdWVzdHM6IFtdIGFzIHN0cmluZ1tdLFxuICAgICAgYWN0aW9uUmVxdWVzdHM6IFtdIGFzIHN0cmluZ1tdLFxuICAgICAgb3BlcmF0aW9uczogW1xuICAgICAgICB7XG4gICAgICAgICAgcHJvcG9zYWxJZDogXCJlMmUtcmVjb3ZlcnktZGVsZXRlZC1wcm9wb3NhbFwiLFxuICAgICAgICAgIG9wZXJhdGlvbklkOiBcImUyZS1yZWNvdmVyeS1kZWxldGVkLW9wZXJhdGlvblwiLFxuICAgICAgICAgIHNlc3Npb25JZDogXCJlMmUtcmVjb3ZlcnktZGVsZXRlZC1zZXNzaW9uXCIsXG4gICAgICAgICAgbGlmZWN5Y2xlOiBcImJsb2NrZWRcIixcbiAgICAgICAgICBzdGF0dXM6IFwicGVuZGluZ1wiLFxuICAgICAgICAgIGNyZWF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjA1OjAwLjAwMFpcIixcbiAgICAgICAgICByZWNvdmVyeVN0YXRlOiBcInJlY292ZXJhYmxlXCIsXG4gICAgICAgICAgb3BlcmF0b3JFeHBsYW5hdGlvbjpcbiAgICAgICAgICAgIFwiVGhlIGRlbGl2ZXJ5IHN0b3BwZWQgYmVjYXVzZSB0aGUgcmV0YWluZWQgY2hhbmdlcyBuZWVkIHJldmlldyBiZWZvcmUgdmFsaWRhdGlvbiBjYW4gY29udGludWUuXCIsXG4gICAgICAgICAgbmV4dEFjdGlvbjpcbiAgICAgICAgICAgIFwiUmVzdW1lIHZhbGlkYXRpb24gdG8gcmUtY2hlY2sgdGhlIHNhdmVkIGNoYW5nZXMsIG9yIGRpc2NhcmQgdGhpcyByZWNvdmVyeSBpZiBpdCBpcyBubyBsb25nZXIgbmVlZGVkLlwiLFxuICAgICAgICAgIGNvbmZsaWN0UmVhc29uOiBudWxsLFxuICAgICAgICAgIHZhbGlkYXRpb25FdmlkZW5jZTogW3sgcHJvZmlsZTogXCJ3b3Jrc3BhY2UtdHlwZWNoZWNrXCIsIHN0YXR1czogXCJmYWlsZWRcIiB9XSxcbiAgICAgICAgICB3b3Jrc3BhY2VBdmFpbGFibGU6IHRydWUsXG4gICAgICAgICAgY2hhbmdlQ291bnQ6IDEsXG4gICAgICAgIH0sXG4gICAgICBdLFxuICAgICAgcmVjb3ZlcnlBY3Rpb246IHtcbiAgICAgICAgcHJvcG9zYWxJZDogXCJlMmUtcmVjb3ZlcnktZGVsZXRlZC1wcm9wb3NhbFwiLFxuICAgICAgICBhY3Rpb246IFwicmVzdW1lLXZhbGlkYXRpb25cIiBhcyBjb25zdCxcbiAgICAgICAgc3RhdHVzOiA0MDQsXG4gICAgICAgIHJlc3BvbnNlOiB7XG4gICAgICAgICAgZXJyb3I6IFwiRGVsaXZlcnkgb3BlcmF0aW9uIG5vdCBmb3VuZFwiLFxuICAgICAgICAgIGNvZGU6IFwiREVMSVZFUllfTk9UX0ZPVU5EXCIsXG4gICAgICAgICAgZGlhZ25vc3RpYzogXCJEbyBub3QgcmVuZGVyIHRoaXMgc2VydmVyIGRldGFpbC5cIixcbiAgICAgICAgfSxcbiAgICAgICAgbmV4dE9wZXJhdGlvbnM6IFtdLFxuICAgICAgfSxcbiAgICB9O1xuICAgIGF3YWl0IGluc3RhbGxBcGlGaXh0dXJlcyhwYWdlLCB7IGRlbGl2ZXJ5UmVjb3Zlcnk6IHJlY292ZXJ5IH0pO1xuICAgIGF3YWl0IHByb2dyYW1tYXRpY1NpZ25JbihwYWdlKTtcbiAgICBhd2FpdCBwYWdlLmdvdG8oYCR7REFTSEJPQVJEX1BBVEh9YWlgKTtcblxuICAgIGNvbnN0IHJlZ2lvbiA9IHBhZ2UuZ2V0QnlSb2xlKFwicmVnaW9uXCIsIHtcbiAgICAgIG5hbWU6IFwiUmVjb3ZlcmFibGUgZGVsaXZlcnkgb3BlcmF0aW9uc1wiLFxuICAgIH0pO1xuICAgIGNvbnN0IG9wZXJhdGlvbiA9IHJlZ2lvbi5sb2NhdG9yKFxuICAgICAgJ1tkYXRhLW9wZXJhdGlvbi1pZD1cImUyZS1yZWNvdmVyeS1kZWxldGVkLW9wZXJhdGlvblwiXScsXG4gICAgKTtcbiAgICBhd2FpdCBleHBlY3Qob3BlcmF0aW9uLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiUmVzdW1lIHZhbGlkYXRpb25cIiB9KSkudG9CZUVuYWJsZWQoKTtcbiAgICBhd2FpdCBvcGVyYXRpb24uZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJSZXN1bWUgdmFsaWRhdGlvblwiIH0pLmNsaWNrKCk7XG5cbiAgICBhd2FpdCBleHBlY3QocGFnZS5nZXRCeVRleHQoXCJSZWNvdmVyeSBsaW5rIGV4cGlyZWRcIiwgeyBleGFjdDogdHJ1ZSB9KSkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcbiAgICAgICAgXCJUaGlzIHJlY292ZXJ5IG9wZXJhdGlvbiBubyBsb25nZXIgZXhpc3RzLiBUaGUgcmVjb3ZlcnkgbGlzdCB3YXMgcmVmcmVzaGVkLlwiLFxuICAgICAgICB7IGV4YWN0OiB0cnVlIH0sXG4gICAgICApLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QucG9sbCgoKSA9PiByZWNvdmVyeS5yZXF1ZXN0cy5sZW5ndGgpLnRvQmVHcmVhdGVyVGhhbk9yRXF1YWwoMik7XG4gICAgYXdhaXQgZXhwZWN0LnBvbGwoKCkgPT4gcmVnaW9uLmNvdW50KCkpLnRvQmUoMCk7XG4gICAgZXhwZWN0KHJlY292ZXJ5LmFjdGlvblJlcXVlc3RzKS50b0hhdmVMZW5ndGgoMSk7XG4gICAgZXhwZWN0KHJlY292ZXJ5LmFjdGlvblJlcXVlc3RzWzBdKS50b0NvbnRhaW4oXG4gICAgICBcIi9hcGkvYWkvZGVsaXZlcnkvZTJlLXJlY292ZXJ5LWRlbGV0ZWQtcHJvcG9zYWwvcmVzdW1lLXZhbGlkYXRpb25cIixcbiAgICApO1xuICAgIGNvbnN0IHZpc2libGVUZXh0ID0gYXdhaXQgcGFnZS5sb2NhdG9yKFwiYm9keVwiKS5pbm5lclRleHQoKTtcbiAgICBleHBlY3QodmlzaWJsZVRleHQpLm5vdC50b01hdGNoKFxuICAgICAgL0RlbGl2ZXJ5IG9wZXJhdGlvbiBub3QgZm91bmR8RG8gbm90IHJlbmRlciB0aGlzIHNlcnZlciBkZXRhaWx8XFwvaG9tZVxcL3J1bm5lcnxcXC90bXBcXC8vaSxcbiAgICApO1xuICAgIGF3YWl0IGV4cGVjdE5vSG9yaXpvbnRhbE92ZXJmbG93KHBhZ2UpO1xuICB9KTtcblxuICB0ZXN0KFwia2VlcHMgdGhlIHJlc3VtZWQgQUkgc2Vzc2lvbiBkcmF3ZXIgb3ZlcmxhaWQgb24gYSBwaG9uZSB2aWV3cG9ydFwiLCBhc3luYyAoe1xuICAgIHBhZ2UsXG4gIH0pID0+IHtcbiAgICBhd2FpdCBwYWdlLnNldFZpZXdwb3J0U2l6ZSh7IHdpZHRoOiAzOTAsIGhlaWdodDogODQ0IH0pO1xuICAgIGNvbnN0IGZpeHR1cmUgPSBhd2FpdCBpbnN0YWxsQXJhYmljQWlGaXh0dXJlKHBhZ2UpO1xuICAgIGF3YWl0IGluc3RhbGxBcGlGaXh0dXJlcyhwYWdlLCB7IGFyYWJpY0FpOiBmaXh0dXJlIH0pO1xuICAgIGF3YWl0IHByb2dyYW1tYXRpY1NpZ25JbihwYWdlKTtcbiAgICBhd2FpdCBwYWdlLmdvdG8oYCR7REFTSEJPQVJEX1BBVEh9YWlgKTtcblxuICAgIGNvbnN0IGNvbXBvc2VyID0gcGFnZS5sb2NhdG9yKFwidGV4dGFyZWFcIikuZmlyc3QoKTtcbiAgICBhd2FpdCBleHBlY3QoY29tcG9zZXIpLnRvQmVWaXNpYmxlKCk7XG4gICAgY29uc3QgYmVmb3JlT3BlbiA9IGF3YWl0IGNvbXBvc2VyLmJvdW5kaW5nQm94KCk7XG4gICAgZXhwZWN0KGJlZm9yZU9wZW4/LndpZHRoKS50b0JlR3JlYXRlclRoYW4oMjUwKTtcblxuICAgIGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJPcGVuIHNlc3Npb25zXCIgfSkuY2xpY2soKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5nZXRCeVRleHQoXCJTZXNzaW9uc1wiLCB7IGV4YWN0OiB0cnVlIH0pKS50b0JlVmlzaWJsZSgpO1xuICAgIGNvbnN0IGRyYXdlciA9IHBhZ2VcbiAgICAgIC5nZXRCeVRleHQoXCJTZXNzaW9uc1wiLCB7IGV4YWN0OiB0cnVlIH0pXG4gICAgICAubG9jYXRvcihcIi4uXCIpXG4gICAgICAubG9jYXRvcihcIi4uXCIpO1xuICAgIGNvbnN0IGRyYXdlckJveCA9IGF3YWl0IGRyYXdlci5ib3VuZGluZ0JveCgpO1xuICAgIGV4cGVjdChkcmF3ZXJCb3g/LndpZHRoKS50b0JlTGVzc1RoYW5PckVxdWFsKDM5MCk7XG4gICAgY29uc3QgZHVyaW5nT3BlbiA9IGF3YWl0IGNvbXBvc2VyLmJvdW5kaW5nQm94KCk7XG4gICAgZXhwZWN0KGR1cmluZ09wZW4/LndpZHRoKS50b0JlR3JlYXRlclRoYW4oMjUwKTtcblxuICAgIGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJDbG9zZSBzaWRlYmFyXCIgfSkuY2xpY2soKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiT3BlbiBzZXNzaW9uc1wiIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3ROb0hvcml6b250YWxPdmVyZmxvdyhwYWdlKTtcbiAgfSk7XG5cbiAgdGVzdChcInJlbmRlcnMgYSB1c2VyLXZpc2libGUgQVBJIGZhaWx1cmUgc3RhdGVcIiwgYXN5bmMgKHsgcGFnZSB9KSA9PiB7XG4gICAgYXdhaXQgaW5zdGFsbEFwaUZpeHR1cmVzKHBhZ2UpO1xuICAgIGF3YWl0IHByb2dyYW1tYXRpY1NpZ25JbihwYWdlKTtcbiAgICBhd2FpdCBwYWdlLnJvdXRlKFwiKiovYXBpL2Rhc2hib2FyZFwiLCAocm91dGUpID0+XG4gICAgICByb3V0ZS5mdWxmaWxsKFxuICAgICAgICBqc29uUmVzcG9uc2UoeyBlcnJvcjogXCJjb250cm9sbGVkIGRhc2hib2FyZCBvdXRhZ2VcIiB9LCA1MDMpLFxuICAgICAgKSxcbiAgICApO1xuICAgIGF3YWl0IHBhZ2UucmVsb2FkKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVJvbGUoXCJoZWFkaW5nXCIsIHsgbmFtZTogXCJGYWlsZWQgdG8gbG9hZCBkYXNoYm9hcmRcIiB9KSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIlJldHJ5IENvbm5l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dkIsTUFBTSxDQUFDeXZCLFNBQVMsYUFBVEEsU0FBUyx1QkFBVEEsU0FBUyxDQUFFcEUsS0FBSyxDQUFDLENBQUN0akIsbUJBQW1CLENBQUMsR0FBRyxDQUFDO0lBQ2pELE1BQU0ybkIsVUFBVSxHQUFHLE1BQU01RSxRQUFRLENBQUN3RSxXQUFXLENBQUMsQ0FBQztJQUMvQ3R2QixNQUFNLENBQUMwdkIsVUFBVSxhQUFWQSxVQUFVLHVCQUFWQSxVQUFVLENBQUVyRSxLQUFLLENBQUMsQ0FBQ2tFLGVBQWUsQ0FBQyxHQUFHLENBQUM7SUFFOUMsTUFBTWpvQixJQUFJLENBQUNXLFNBQVMsQ0FBQyxRQUFRLEVBQUU7TUFBRUMsSUFBSSxFQUFFO0lBQWdCLENBQUMsQ0FBQyxDQUFDdVQsS0FBSyxDQUFDLENBQUM7SUFDakUsTUFBTXpiLE1BQU0sQ0FDVnNILElBQUksQ0FBQ1csU0FBUyxDQUFDLFFBQVEsRUFBRTtNQUFFQyxJQUFJLEVBQUU7SUFBZ0IsQ0FBQyxDQUNwRCxDQUFDLENBQUNDLFdBQVcsQ0FBQyxDQUFDO0lBQ2YsTUFBTWQsMEJBQTBCLENBQUNDLElBQUksQ0FBQztFQUN4QyxDQUFDLENBQUM7RUFFRnJILElBQUksQ0FBQywwQ0FBMEMsRUFBRSxPQUFPO0lBQUVxSDtFQUFLLENBQUMsS0FBSztJQUNuRSxNQUFNd0Isa0JBQWtCLENBQUN4QixJQUFJLENBQUM7SUFDOUIsTUFBTWlSLGtCQUFrQixDQUFDalIsSUFBSSxDQUFDO0lBQzlCLE1BQU1BLElBQUksQ0FBQzBCLEtBQUssQ0FBQyxrQkFBa0IsRUFBR0EsS0FBSyxJQUN6Q0EsS0FBSyxDQUFDb0IsT0FBTyxDQUNYbkQsWUFBWSxDQUFDO01BQUV1RixLQUFLLEVBQUU7SUFBOEIsQ0FBQyxFQUFFLEdBQUcsQ0FDNUQsQ0FDRixDQUFDO0lBQ0QsTUFBTWxGLElBQUksQ0FBQ3FjLE1BQU0sQ0FBQyxDQUFDO0lBQ25CLE1BQU0zakIsTUFBTSxDQUNWc0gsSUFBSSxDQUFDVyxTQUFTLENBQUMsU0FBUyxFQUFFO01BQUVDLElBQUksRUFBRTtJQUEyQixDQUFDLENBQ2hFLENBQUMsQ0FBQ0MsV0FBVyxDQUFDLENBQUM7SUFDZixNQUFNbkksTUFBTSxDQUNWc0gsSUFBSSxDQUFDVyxTQUFTLENBQUMsUUFBUSxFQUFFO01BQUVDLElBQUksRUFBRTtJQUFtQixDQUFDLENBQ3ZELENBQUMsQ0FBQ0MsV0FBVyxDQUFDLENBQUM7RUFDakIsQ0FBQyxDQUFDO0FBQ0osQ0FBQyxDQUFDIiwiaWdub3JlTGlzdCI6W119