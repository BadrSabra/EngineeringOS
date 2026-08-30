// d4435f4c7ba7b852be40ffc86b85b150b3c71708
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
async function expectWithinViewport(locator, viewport, label) {
  const box = await locator.boundingBox();
  expect(box, `${label} should have a layout box`).not.toBeNull();
  expect(box.x, `${label} left edge`).toBeGreaterThanOrEqual(-1);
  expect(box.y, `${label} top edge`).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width, `${label} right edge`).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.y + box.height, `${label} bottom edge`).toBeLessThanOrEqual(viewport.height + 1);
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
    const terminalDone = sseEvents.find(event => event.type === "done");
    const terminalMessage = terminalDone !== null && terminalDone !== void 0 && terminalDone.message && typeof terminalDone.message === "object" && !Array.isArray(terminalDone.message) ? terminalDone.message : undefined;
    if (!terminalDone || (terminalMessage === null || terminalMessage === void 0 ? void 0 : terminalMessage.executionId) !== executionId) {
      throw new Error("Live-provider stream did not emit a terminal done event for its execution.");
    }
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
  test("keeps all provider cards and controls reachable at narrow phone widths", async ({
    page
  }) => {
    const fixture = await installArabicAiFixture(page);
    await installApiFixtures(page, {
      arabicAi: fixture
    });
    await programmaticSignIn(page);
    for (const width of [320, 390]) {
      const viewport = {
        width,
        height: 844
      };
      await page.setViewportSize(viewport);
      await page.goto(`${DASHBOARD_PATH}ai`);
      const composer = page.locator("textarea").first();
      await expect(composer).toBeVisible();
      await expectWithinViewport(composer, viewport, `composer at ${width}px`);
      await page.getByRole("button", {
        name: "Open sessions"
      }).click();
      const drawer = page.getByTestId("sessions-drawer");
      await expect(drawer).toBeVisible();
      await expectWithinViewport(drawer, viewport, `sessions drawer at ${width}px`);
      await expectNoHorizontalOverflow(page);
      const providerCards = drawer.locator(".provider-key-card");
      await expect(providerCards).toHaveCount(4);
      for (const provider of ["OpenRouter", "Gemini", "DeepSeek", "Groq"]) {
        const card = providerCards.filter({
          hasText: `${provider} API Key`
        });
        await expect(card).toHaveCount(1);
        await card.scrollIntoViewIfNeeded();
        await expect(card).toBeVisible();
        const input = card.locator('input[type="password"]');
        const save = card.getByRole("button", {
          name: "Save",
          exact: true
        });
        await expect(input).toBeVisible();
        await expect(save).toBeVisible();
        await input.scrollIntoViewIfNeeded();
        await save.scrollIntoViewIfNeeded();
        await expectWithinViewport(input, viewport, `${provider} key input at ${width}px`);
        await expectWithinViewport(save, viewport, `${provider} Save control at ${width}px`);
      }
      await expectWithinViewport(composer, viewport, `composer with drawer at ${width}px`);
      await expectNoHorizontalOverflow(page);
      await page.getByRole("button", {
        name: "Close sidebar"
      }).click();
      await expect(drawer).toBeHidden();
    }
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJleHBlY3QiLCJ0ZXN0IiwibWtkaXIiLCJ3cml0ZUZpbGUiLCJkaXJuYW1lIiwicGFyc2VDbGVya1NpZ25JblRva2VuUmVzcG9uc2UiLCJwYXJzZUNsZXJrVXNlckxvb2t1cFJlc3BvbnNlIiwicGFyc2VDcmVhdGVkQ2xlcmtVc2VyUmVzcG9uc2UiLCJEQVNIQk9BUkRfUEFUSCIsIlRFU1RfVVNFUiIsImZpcnN0TmFtZSIsImxhc3ROYW1lIiwiZW1haWwiLCJfcHJvY2VzcyRlbnYkREFTSEJPQVIiLCJwcm9jZXNzIiwiZW52IiwiREFTSEJPQVJEX0UyRV9FTUFJTCIsIkVYRUNVVElPTl9JRCIsIkRFRkFVTFRfTElWRV9USU1FT1VUX01TIiwiTElWRV9URVNUX1RJTUVPVVRfTUFSR0lOX01TIiwiREVGQVVMVF9SRUFESU5FU1NfVElNRU9VVF9NUyIsIlRFU1RfTU9ERVMiLCJTZXQiLCJIT1NUSUxFX09SSUdJTiIsIk9SSUdJTl9ESUFHTk9TVElDX0hFQURFUlMiLCJERUZBVUxUX0xJVkVfUFJPTVBUIiwiTElWRV9DQU1QQUlHTl9TQ0VOQVJJT1MiLCJsaXZlQ2FtcGFpZ25TY2VuYXJpbyIsIl9wcm9jZXNzJGVudiREQVNIQk9BUjIiLCJzY2VuYXJpbyIsIkRBU0hCT0FSRF9FMkVfTElWRV9TQ0VOQVJJTyIsInRyaW0iLCJEQVNIQk9BUkRfRTJFX0xJVkVfQ0FNUEFJR04iLCJFcnJvciIsImhhcyIsImxpdmVQcm9tcHQiLCJfcHJvY2VzcyRlbnYkREFTSEJPQVIzIiwiREFTSEJPQVJEX0UyRV9MSVZFX1BST01QVCIsImxpdmVUaW1lb3V0TXMiLCJjb25maWd1cmVkIiwiTnVtYmVyIiwiREFTSEJPQVJEX0UyRV9MSVZFX1RJTUVPVVRfTVMiLCJpc0Zpbml0ZSIsImRhc2hib2FyZFRlc3RNb2RlIiwiX3Byb2Nlc3MkZW52JERBU0hCT0FSNCIsIkRBU0hCT0FSRF9FMkVfVEVTVF9NT0RFIiwicmVhZGluZXNzVGltZW91dE1zIiwiREFTSEJPQVJEX0UyRV9SRUFESU5FU1NfVElNRU9VVF9NUyIsIndyaXRlUmVhZGluZXNzUmVjZWlwdCIsIm91dGNvbWUiLCJjaGVja3MiLCJyZWFzb24iLCJyZWNlaXB0UGF0aCIsIkRBU0hCT0FSRF9FMkVfUkVBRElORVNTX0FSVElGQUNUX1BBVEgiLCJyZWN1cnNpdmUiLCJKU09OIiwic3RyaW5naWZ5IiwibW9kZSIsInByb2plY3QiLCJEQVNIQk9BUkRfRTJFX0xJVkVfUFJPSkVDVF9JRCIsImFwcHJvdmVkRGFzaGJvYXJkT3JpZ2lucyIsIl9wcm9jZXNzJGVudiREQVNIQk9BUjUiLCJvcmlnaW5zIiwiREFTSEJPQVJEX0UyRV9BUFBST1ZFRF9PUklHSU5TIiwic3BsaXQiLCJtYXAiLCJvcmlnaW4iLCJmaWx0ZXIiLCJCb29sZWFuIiwibGVuZ3RoIiwicGFyc2VkIiwiVVJMIiwicGF0aG5hbWUiLCJzZWFyY2giLCJoYXNoIiwiZGFzaGJvYXJkRml4dHVyZSIsImZyZXNobmVzc1JldmlzaW9uIiwicHJvamVjdENvdW50IiwiYWN0aXZlVGFza0NvdW50IiwiY29tcGxldGVkVGFza0NvdW50IiwiZmFpbGVkVGFza0NvdW50IiwidGFza1N0YXR1c0JyZWFrZG93biIsInBlbmRpbmciLCJydW5uaW5nIiwicHJvamVjdFNjb3JlcyIsInByb2plY3RJZCIsInByb2plY3ROYW1lIiwic2NvcmUiLCJ0cmVuZCIsInJlY2VudEV2ZW50cyIsImlkIiwidHlwZSIsInNldmVyaXR5IiwibWVzc2FnZSIsInRpbWVzdGFtcCIsInRvcFJ1bGVzIiwiZXhlY3V0aW9uRml4dHVyZSIsIm9wZXJhdGlvbklkIiwic3RhdHVzIiwiZmxpZ2h0U3RhdGUiLCJldmlkZW5jZVZlcmRpY3QiLCJwcm9vZlJlcXVpcmVkIiwicmVzdW1hYmxlIiwiY2hlY2twb2ludFZlcnNpb24iLCJwcm9qZWN0UmV2aXNpb24iLCJjaGVja3BvaW50Iiwic3RhZ2UiLCJkZXRhaWwiLCJvYmplY3RpdmUiLCJzdGFydGVkQXQiLCJjb21wbGV0ZWRBdCIsImNyZWF0ZWRBdCIsInVwZGF0ZWRBdCIsImpzb25SZXNwb25zZSIsImJvZHkiLCJoZWFkZXJzIiwiY29udGVudFR5cGUiLCJleHBlY3ROb0hvcml6b250YWxPdmVyZmxvdyIsInBhZ2UiLCJvdmVyZmxvdyIsImV2YWx1YXRlIiwiZG9jdW1lbnQiLCJkb2N1bWVudEVsZW1lbnQiLCJzY3JvbGxXaWR0aCIsInZpZXdwb3J0Iiwid2luZG93IiwiaW5uZXJXaWR0aCIsInRvQmVMZXNzVGhhbk9yRXF1YWwiLCJleHBlY3RXaXRoaW5WaWV3cG9ydCIsImxvY2F0b3IiLCJsYWJlbCIsImJveCIsImJvdW5kaW5nQm94Iiwibm90IiwidG9CZU51bGwiLCJ4IiwidG9CZUdyZWF0ZXJUaGFuT3JFcXVhbCIsInkiLCJ3aWR0aCIsImhlaWdodCIsImV4cGVjdERhc2hib2FyZFJlYWR5IiwiZ2V0QnlSb2xlIiwibmFtZSIsInRvQmVWaXNpYmxlIiwiZ2V0QnlUZXh0IiwiZXhhY3QiLCJyZXN0YXJ0QXBpRm9yQ2FtcGFpZ24iLCJjb250cm9sVXJsIiwiREFTSEJPQVJEX0UyRV9DT05UUk9MX1VSTCIsInJlc3BvbnNlIiwicmVxdWVzdCIsInBvc3QiLCJ0aW1lb3V0IiwidG9CZSIsImluc3RhbGxBcGlGaXh0dXJlcyIsIm92ZXJyaWRlcyIsInJvdXRlIiwiX3JlZiIsIl9vdmVycmlkZXMkZGVsaXZlcnlSZSIsIl9vdmVycmlkZXMkYXVkaXRFeHBvcjIiLCJfb3ZlcnJpZGVzJGF1ZGl0RXhwb3IzIiwidXJsIiwicGF0aCIsInJlcGxhY2UiLCJhcmFiaWNBaSIsImFsdGVybmF0ZUFpIiwiZGlzY29ubmVjdEFpIiwiYWlGaXh0dXJlcyIsImZpeHR1cmUiLCJoYXNDb25maWd1cmVkQWlGaXh0dXJlIiwicmVzdW1lRmFpbHVyZSIsImludGVycnVwdGVkUmVzdW1lIiwiZW5kc1dpdGgiLCJzZWFyY2hQYXJhbXMiLCJnZXQiLCJwcm9qZWN0U2Vzc2lvbnMiLCJmdWxmaWxsIiwic2Vzc2lvbklkIiwidGl0bGUiLCJxdWVzdGlvbiIsInJlcXVlc3RCb2R5IiwicG9zdERhdGFKU09OIiwiZXhlY3V0aW9uSWQiLCJzdHJlYW1Cb2R5IiwicmVzdW1lZFN0cmVhbUJvZHkiLCJyZXF1ZXN0ZWRNZXNzYWdlIiwic3RyZWFtRml4dHVyZSIsImZpbmQiLCJpbmNsdWRlcyIsIm1lc3NhZ2VGaXh0dXJlIiwicm9sZSIsImNvbnRlbnQiLCJhdWRpdEV4cG9ydCIsIl9vdmVycmlkZXMkYXVkaXRFeHBvciIsIm1lc3NhZ2VPdXRjb21lIiwidGFza0FjdGlvbnMiLCJ2ZXJpZmljYXRpb25NYXRjaCIsIm1hdGNoIiwibWV0aG9kIiwiX3BsYW4kdmVyaWZpY2F0aW9uQ2hlIiwiX3BsYW4kdmVyaWZpY2F0aW9uU3RlIiwiX292ZXJyaWRlcyR0YXNrQWN0aW9uIiwiX3Rhc2skdmVyaWZpY2F0aW9uUmVzIiwiX3ByaW9yUmVzdWx0JHN0ZXBzIiwiX3ByaW9yUmVzdWx0JGhpc3RvcnkiLCJfcHJpb3JSZXN1bHQkaGlzdG9yeTIiLCJfY2hlY2ska2luZCIsIl9wcmlvclJlc3VsdCRoaXN0b3J5MyIsInRhc2tJZCIsInRhc2siLCJ0YXNrcyIsImNhbmRpZGF0ZSIsImVycm9yIiwicGxhbiIsInJlbWVkaWF0aW9uUGxhbiIsInZlcmlmaWNhdGlvbkNoZWNrcyIsInZlcmlmaWNhdGlvblN0ZXBzIiwiZ3VpZGFuY2UiLCJpbmRleCIsImtpbmQiLCJjaGVjayIsImNoZWNrSWQiLCJwYXNzZWQiLCJldmlkZW5jZSIsInZlcmlmaWNhdGlvblJlcXVlc3RzIiwicHVzaCIsInByaW9yUmVzdWx0IiwidmVyaWZpY2F0aW9uUmVzdWx0IiwicHJpb3JTdGVwcyIsInN0ZXBzIiwiX2NhbmRpZGF0ZSRraW5kMiIsInByaW9yIiwic3RlcCIsIl9jYW5kaWRhdGUka2luZCIsIlN0cmluZyIsIm91dHB1dCIsImNvbXBsZXRlZCIsImV2ZXJ5IiwiX3N0ZXAkZXZpZGVuY2UiLCJkZWNpc2lvbiIsImhpc3RvcnkiLCJhY3RvciIsInJlY29yZGVkQXQiLCJhY3Rpb25NYXRjaCIsImFjdGlvbiIsInJlcXVlc3RzIiwiX3Rhc2skcmV0cnlDb3VudCIsInJldHJ5Q291bnQiLCJfcmVmMiIsIl9vdmVycmlkZXMkdGFza0FjdGlvbjIiLCJfb3ZlcnJpZGVzJHRhc2tBY3Rpb24zIiwicmVjb3ZlcnlUYXNrcyIsImxpdmVUYXNrIiwiZGVzY3JpcHRpb24iLCJwcmlvcml0eSIsInJlbGF0ZWRGaWxlcyIsIm1heFJldHJpZXMiLCJfb3ZlcnJpZGVzJHJlY292ZXJ5V28iLCJyZWNvdmVyeVdvcmtmbG93cyIsIndvcmtmbG93RXhlY3V0aW9uc01hdGNoIiwiX292ZXJyaWRlcyRyZWNvdmVyeVdvMiIsIl9vdmVycmlkZXMkcmVjb3ZlcnlXbzMiLCJyZWNvdmVyeVdvcmtmbG93RXhlY3V0aW9ucyIsImZhaWxGaXJzdFByZXZpZXciLCJmaWxlbmFtZSIsImFyY2hpdmVVcGxvYWQiLCJfcm91dGUkcmVxdWVzdCRoZWFkZXIiLCJzdGFydHNXaXRoIiwicG9zdERhdGFCdWZmZXIiLCJCdWZmZXIiLCJmcm9tIiwidXBsb2FkSWQiLCJvcmlnaW5hbE5hbWUiLCJwaGFzZSIsIl9vdmVycmlkZXMkbGl2ZVRhc2skaSIsImluaXRpYWxMb2dzIiwic3RyZWFtUmVxdWVzdHMiLCJmYWlsRmlyc3RTdHJlYW0iLCJmYWlsU3RyZWFtQXR0ZW1wdHMiLCJhYm9ydCIsImxvZyIsIl9vdmVycmlkZXMkcHJvamVjdHMiLCJwcm9qZWN0cyIsImxhbmd1YWdlIiwiZnJhbWV3b3JrIiwicm9vdFBhdGgiLCJxdWFsaXR5U2NvcmUiLCJhcGkiLCJkYXRhYmFzZSIsInNjaGVtYSIsInByb3ZpZGVyIiwiZGVsaXZlcnlSZWNvdmVyeSIsIm9wZXJhdGlvbnMiLCJyZWNvdmVyeUFjdGlvbiIsInByb3Bvc2FsSWQiLCJfb3ZlcnJpZGVzJGRlbGl2ZXJ5UmUyIiwiX292ZXJyaWRlcyRkZWxpdmVyeVJlMyIsImFjdGlvblJlcXVlc3RzIiwibmV4dE9wZXJhdGlvbnMiLCJfb3ZlcnJpZGVzJGV2ZW50cyIsIl91cmwkc2VhcmNoUGFyYW1zJGdldCIsImV2ZW50cyIsInRvTG93ZXJDYXNlIiwiZmlsdGVyZWRFdmVudHMiLCJldmVudCIsImNvcnJlbGF0aW9uSWQiLCJ2YWx1ZSIsInNvbWUiLCJsaW1pdCIsInNsaWNlIiwidG90YWwiLCJleGVjdXRpb24iLCJyZXN1bWVUb2tlbiIsInJlY292ZXJlZFRva2VuIiwiZXhlY3V0aW9ucyIsImNvbnRpbnVlIiwiaW5zdGFsbEFyYWJpY0FpRml4dHVyZSIsIm9wdGlvbnMiLCJfb3B0aW9ucyRzZXNzaW9uSWQiLCJfb3B0aW9ucyRxdWVzdGlvbiIsIm1lc3NhZ2VJZCIsInNvdXJjZSIsImJsb2NrZWQiLCJhbnN3ZXIiLCJleGNlcnB0Iiwic3VwcG9ydHNDbGFpbSIsImV2aWRlbmNlQ2xhc3MiLCJjaXRhdGlvblN0YXR1cyIsImNpdGF0aW9uUmVhc29uIiwic291cmNlU3BhbiIsInN0YXJ0TGluZSIsImVuZExpbmUiLCJ0b29sVHJhY2UiLCJ0b29sIiwiYXJncyIsImNhY2hlZCIsInByZWZldGNoZWQiLCJjb2RlIiwiY29uc2lzdGVudCIsInZpb2xhdGlvbnMiLCJldmlkZW5jZUZpbGVDb3VudCIsImFjY2VwdGVkRXZpZGVuY2VDb3VudCIsImNvbXBsZXRlZFJlYWRGaWxlcyIsImFjY2VwdGVkRXZpZGVuY2VGaWxlcyIsIm9iamVjdGl2ZVR5cGUiLCJyZXF1aXJlZEVkZ2VzIiwicHJvdmVuRWRnZXMiLCJjb21wbGV0aW9uR2F0ZVJlc3VsdCIsImZpbmFsQW5zd2VyVHlwZSIsInRhc2tSZXN1bHQiLCJjb25maWRlbmNlIiwic291cmNlU2NvcGUiLCJjb3ZlcmFnZSIsInJlcXVlc3RlZEZpZWxkcyIsImFuc3dlcmVkRmllbGRzIiwibWlzc2luZ0ZpZWxkcyIsImNvbXBsZXRlIiwib3BlcmF0aW9uTW9kZSIsInNvdXJjZXMiLCJiZWhhdmlvckV2aWRlbmNlIiwic3NlIiwiZGVsdGEiLCJwZW5kaW5nQ2hhbmdlcyIsImpvaW4iLCJpbnN0YWxsVG9vbEZhaWx1cmVGaXh0dXJlIiwiZGlhZ25vc3RpY0NvZGUiLCJyZXN1bHRLaW5kIiwicmVzdWx0U3VtbWFyeSIsInN0b3BSZWFzb24iLCJpdGVyYXRpb25zIiwibWF4SXRlcmF0aW9ucyIsInRvb2xDYWxscyIsInByZWZldGNoVG9vbENhbGxzIiwibG9vcFRvb2xDYWxscyIsInN5bnRoZXNpc1N0YXJ0ZWQiLCJkaWFnbm9zdGljQ29kZXMiLCJpbnN0YWxsRGlzY29ubmVjdGVkQWlGaXh0dXJlIiwiZGlhZ25vc3RpY0RldGFpbHMiLCJlcnJvckNvZGUiLCJlcnJvck1lc3NhZ2UiLCJpbnN0YWxsUmVzdW1lZEFuYWx5c2lzRmFpbHVyZUZpeHR1cmUiLCJpbnN0YWxsSW50ZXJydXB0ZWRSZXN1bWVGaXh0dXJlIiwiaW5pdGlhbFRva2VuIiwicGFydGlhbEFuc3dlciIsImNyZWF0ZVJlbGVhc2VTaWduSW5VcmwiLCJzZWNyZXRLZXkiLCJDTEVSS19TRUNSRVRfS0VZIiwiQXV0aG9yaXphdGlvbiIsInVzZXJSZXNwb25zZSIsImVuY29kZVVSSUNvbXBvbmVudCIsInVzZXJJZCIsImpzb24iLCJjcmVhdGVkUmVzcG9uc2UiLCJkYXRhIiwiZW1haWxfYWRkcmVzcyIsImZpcnN0X25hbWUiLCJsYXN0X25hbWUiLCJza2lwX3Bhc3N3b3JkX2NoZWNrcyIsInNraXBfcGFzc3dvcmRfcmVxdWlyZW1lbnQiLCJ0b2tlblJlc3BvbnNlIiwidXNlcl9pZCIsInRva2VuIiwidG9TdHJpbmciLCJwcm9ncmFtbWF0aWNTaWduSW4iLCJfZ2xvYmFsVGhpcyRzaWduSW5DbGUiLCJnb3RvIiwiaGVscGVyIiwiZ2xvYmFsVGhpcyIsInNpZ25JbkNsZXJrVXNlciIsIl9fRU5HSU5FRVJJTkdPU19TSUdOX0lOX0NMRVJLX1VTRVJfXyIsIlJVTl9DT05UUk9MTEVEX1JFTEVBU0VfVkFMSURBVElPTiIsInRvSGF2ZVVSTCIsIlJlZ0V4cCIsInJlcGxhY2VBbGwiLCJjb21wbGV0ZVJlYWRpbmVzc0hhbmRzaGFrZSIsInNpZ25JblVybCIsInR0bCIsImJhc2VQYXRoIiwiREFTSEJPQVJEX0UyRV9MSVZFX1BST1ZJREVSIiwiREFTSEJPQVJEX0UyRV9MSVZFX0RJU1BPU0FCTEUiLCJkaXNwb3NhYmxlUHJvamVjdCIsImRlYWRsaW5lIiwiRGF0ZSIsIm5vdyIsImxhc3RTdGF0dXMiLCJfcmVhZGluZXNzQm9keSRjaGVja3MiLCJfcmVhZGluZXNzQm9keSRjaGVja3MyIiwiX3JlYWRpbmVzc0JvZHkkY2hlY2tzMyIsIl9yZWFkaW5lc3NCb2R5JGNoZWNrczQiLCJfcmVhZGluZXNzQm9keSRjaGVja3M1IiwicmVhZGluZXNzIiwiZmV0Y2giLCJjcmVkZW50aWFscyIsIm9rIiwiY2F0Y2giLCJyZWFkaW5lc3NCb2R5IiwiT2JqZWN0IiwidmFsdWVzIiwicHJvamVjdHNSZXN1bHQiLCJleHBlY3RlZFByb2plY3QiLCJ1bmRlZmluZWQiLCJmaXh0dXJlUHJvamVjdFJlYWR5IiwiQXJyYXkiLCJpc0FycmF5IiwiX3Byb2plY3RzJCIsImF1dGgiLCJmaXh0dXJlUHJvamVjdCIsImVudHJpZXMiLCJQcm9taXNlIiwicmVzb2x2ZSIsInNldFRpbWVvdXQiLCJvcGVuTmF2aWdhdGlvbiIsImNsaWNrIiwiYXBpVXJsIiwiYXBpQmFzZVVybCIsIkRBU0hCT0FSRF9FMkVfQVBJX0JBU0VfVVJMIiwibGl2ZVJlcXVlc3QiLCJfb3B0aW9ucyRtZXRob2QiLCJzaWduYWwiLCJBYm9ydFNpZ25hbCIsInRleHQiLCJyZWNvcmRlZE9yaWdpbkRpYWdub3N0aWNzIiwib3JpZ2luRGlhZ25vc3RpY1BhdGgiLCJEQVNIQk9BUkRfRTJFX09SSUdJTl9ESUFHTk9TVElDU19QQVRIIiwicmVsZXZhbnRPcmlnaW5IZWFkZXJzIiwiZnJvbUVudHJpZXMiLCJmbGF0TWFwIiwid3JpdGVPcmlnaW5EaWFnbm9zdGljcyIsIm91dHB1dFBhdGgiLCJkaWFnbm9zdGljcyIsImV4cGVjdE9yaWdpbkNhblVzZUFwaSIsImhlYWx0aFVybCIsIm11dGF0aW9uVXJsIiwiY29tbW9uSGVhZGVycyIsIk9yaWdpbiIsImFzc2VydGlvbiIsImF0IiwiY3VycmVudCIsIl9yZXNwb25zZSRoZWFkZXJzJGFjYyIsIl9yZXNwb25zZSRoZWFkZXJzJGFjYzIiLCJ0b1VwcGVyQ2FzZSIsInRvQ29udGFpbiIsImhlYWRlciIsImV4cGVjdEhvc3RpbGVPcmlnaW5SZWplY3RlZCIsInVwbG9hZFVybCIsImxpdmVVcGRhdGVVcmwiLCJkaWFnbm9zdGljIiwidG9CZVVuZGVmaW5lZCIsImhvc3RpbGVVcGxvYWQiLCJtdWx0aXBhcnQiLCJhcmNoaXZlIiwibWltZVR5cGUiLCJidWZmZXIiLCJob3N0aWxlTGl2ZVVwZGF0ZSIsInBhcnNlU3NlIiwiY2h1bmsiLCJfY2h1bmskc3BsaXQkZmluZCIsImxpbmUiLCJwYXJzZSIsImxpdmVKc29uIiwibGl2ZUFycmF5IiwibGl2ZU9wdGlvbmFsUmVjb3JkIiwiZGVzY3JpYmUiLCJfZXhlY3V0aW9uJG9wZXJhdGlvbkkiLCJfZXhlY3V0aW9uJGZsaWdodFN0YXQiLCJfZ2l0TG9nJGNvbW1pdHMkMCRzaG8iLCJfZ2l0TG9nJGNvbW1pdHMiLCJfZ2l0TG9nJGNvbW1pdHMyIiwiX3Byb2Nlc3MkZW52JERBU0hCT0FSNiIsInNraXAiLCJjYW1wYWlnblNjZW5hcmlvIiwic3RyZWFtUmVzcG9uc2UiLCJpZGVtcG90ZW5jeUtleSIsInNzZUV2ZW50cyIsInN0YXJ0ZWQiLCJ0ZXJtaW5hbERvbmUiLCJ0ZXJtaW5hbE1lc3NhZ2UiLCJtZXNzYWdlcyIsInByb3Bvc2FsIiwiZ2l0TG9nIiwibWlzc2lvbkNvbnRyb2wiLCJkYXNoYm9hcmRTdGF0ZSIsInJlY2VudFN0ZXBzIiwidmFsaWRhdGlvbiIsImNhbmRpZGF0ZUhhc2giLCJfc3RlcCR2YWxpZGF0aW9uJGNhbmQiLCJfc3RlcCR2YWxpZGF0aW9uIiwiY2FuZGlkYXRlSWRlbnRpdHkiLCJldmlkZW5jZUNvdW50IiwicmVkdWNlIiwiY291bnQiLCJ0ZXJtaW5hbFN0YXRlIiwic3VjY2Vzc1N0YXRlcyIsImRlbGl2ZXJ5U3RhZ2VzIiwiYXBwbGllZCIsImNvbW1pdHRlZCIsInB1c2hlZCIsImNhcHR1cmUiLCJ3b3Jrc3BhY2VSZXZpc2lvbiIsImNvbW1pdHMiLCJzaG9ydEhhc2giLCJjYW5kaWRhdGVSZXZpc2lvbiIsImN1cnJlbnRPcGVyYXRpb24iLCJyZXZpc2lvbiIsInJldGFpbmVkUmVzdWx0IiwibWVzc2FnZVNlc3Npb24iLCJtZXNzYWdlRXhlY3V0aW9uIiwiZXZlbnRFeGVjdXRpb24iLCJldmVudFNlc3Npb24iLCJjaGVja3BvaW50cyIsInNlcXVlbmNlIiwicHJvcG9zYWxzIiwiX3N0ZXAkdmFsaWRhdGlvbiRzdGF0IiwiX3N0ZXAkdmFsaWRhdGlvbjIiLCJfc3RlcCR2YWxpZGF0aW9uJHByb2YiLCJfc3RlcCR2YWxpZGF0aW9uMyIsInByb2ZpbGUiLCJ2YWxpZGF0aW9uUHJvZmlsZSIsImRhc2hib2FyZCIsIkRBU0hCT0FSRF9FMkVfTElWRV9SRVBPUlRfUEFUSCIsImZpcnN0IiwicmF3RGlhZ25vc3RpYyIsInJhd0NyZWRlbnRpYWwiLCJzdXBwb3J0UmVmZXJlbmNlcyIsImF1dGhlbnRpY2F0aW9uX2ZhaWxlZCIsInF1b3RhX2V4aGF1c3RlZCIsInByb3ZpZGVyX291dGFnZSIsImFnZW50UmVzcG9uc2UiLCJ0ZXJtaW5hbFN0YXR1cyIsImF2YWlsYWJpbGl0eVN0YXRlIiwib3BlcmF0b3JBY3Rpb24iLCJtb2RlbCIsInRlcm1pbmFsUmVhc29uIiwid29ya2Zsb3dJZCIsInBoYXNlcyIsImN1cnJlbnRQaGFzZSIsImV4ZWN1dGlvbkNvdW50IiwiY29tcGxldGVkUGhhc2VzIiwicmVjb3ZlcnkiLCJnZXRCeUxhYmVsIiwidGFza0RldGFpbHMiLCJ0b0NvbnRhaW5UZXh0IiwicmVsb2FkIiwicmVsb2FkZWRBdXRoRGV0YWlscyIsInJlbG9hZGVkVGFza1RleHQiLCJpbm5lclRleHQiLCJ0b01hdGNoIiwicmVsb2FkZWRFeGVjdXRpb24iLCJ2aXNpYmxlVGV4dCIsInJhd1Byb21wdCIsInJlYWR5VGFza0lkIiwicmV2aWV3VGFza0lkIiwidmVyaWZpY2F0aW9uVGFza0lkIiwicmVtZWRpYXRpb25UYXNrcyIsInByb21wdCIsInZlcnNpb24iLCJydWxlSWQiLCJydWxlQ29kZSIsInJ1bGVUaXRsZSIsIm9jY3VycmVuY2VDb3VudCIsImZpbGUiLCJzbmlwcGV0Iiwib2NjdXJyZW5jZXMiLCJmaXhEZXNjcmlwdGlvbiIsImNvbXBsZXRlbmVzcyIsInJlYWR5Um93IiwiZ2V0QnlUaXRsZSIsInJlYWR5RGV0YWlscyIsInJlYWR5UGxhbiIsInBvbGwiLCJ0b0hhdmVDb3VudCIsInJldmlld1JvdyIsInJldmlld0RldGFpbHMiLCJyZXZpZXdQbGFuIiwidmVyaWZpY2F0aW9uUm93IiwidmVyaWZpY2F0aW9uRGV0YWlscyIsInZlcmlmaWNhdGlvblBsYW4iLCJmaXJzdEd1aWRhbmNlIiwic2Vjb25kR3VpZGFuY2UiLCJmaXJzdEV2aWRlbmNlIiwic2Vjb25kRXZpZGVuY2UiLCJwYXNzQnV0dG9ucyIsImZhaWxlZEJ1dHRvbnMiLCJudGgiLCJ0b0JlRGlzYWJsZWQiLCJmaWxsIiwidG9NYXRjaE9iamVjdCIsInJlbG9hZGVkVmVyaWZpY2F0aW9uUm93IiwicmVsb2FkZWREZXRhaWxzIiwiYnJvd3NlciIsInNlY29uZENvbnRleHQiLCJuZXdDb250ZXh0Iiwic2Vjb25kUGFnZSIsIm5ld1BhZ2UiLCJhbGwiLCJjdXJyZW50RGFzaGJvYXJkRml4dHVyZSIsInJlZnJlc2hDb3VudCIsInJlbGVhc2VTdGFsZVJlc3BvbnNlIiwic3RhbGVSZXNwb25zZVJlbGVhc2VkIiwic3RhbGVSZWZyZXNoIiwicmVjb25uZWN0QXR0ZW1wdCIsInVucm91dGUiLCJjbG9zZSIsImF1ZGl0UmVxdWVzdHMiLCJhdWRpdEJvZHkiLCJmb3JtYXQiLCJleHBvcnRlZEF0IiwicHJvb2YiLCJyZXF1aXJlZCIsInZlcmRpY3QiLCJ0aW1lbGluZSIsInZhbGlkYXRpb25zIiwiYWZmZWN0ZWRGaWxlcyIsInJlZGFjdGlvbiIsImV4Y2x1ZGVkIiwibG9jYWxTdG9yYWdlIiwic2V0SXRlbSIsInByZXZpZXciLCJ0b0hhdmVMZW5ndGgiLCJ0b0JlSGlkZGVuIiwiZG93bmxvYWRQcm9taXNlIiwid2FpdEZvckV2ZW50IiwiZG93bmxvYWQiLCJzdWdnZXN0ZWRGaWxlbmFtZSIsInJlbG9hZGVkUHJvb2YiLCJjYW5jZWxsZWRFeGVjdXRpb24iLCJfcHJvY2VzcyRlbnYkREFTSEJPQVI3IiwibGl2ZUxvZyIsImxldmVsIiwidXBsb2FkUmVzdWx0IiwiYnl0ZXMiLCJVaW50OEFycmF5IiwiYXRvYiIsImNoYXJhY3RlciIsImNoYXJDb2RlQXQiLCJGb3JtRGF0YSIsImFwcGVuZCIsIkJsb2IiLCJ0b0VxdWFsIiwidGFza1JvdyIsIm1ldGFkYXRhIiwiYWN0aXZpdHkiLCJoYXNUZXh0Iiwibm9uU3RyZWFtUmVxdWVzdHMiLCJvbiIsImV4aGF1c3RlZCIsInNpemUiLCJfIiwiVVRDIiwidG9JU09TdHJpbmciLCJldmVudFJlcXVlc3RzIiwiZmlyc3RSZXF1ZXN0Iiwid2FpdEZvclJlcXVlc3QiLCJnZXRCeVBsYWNlaG9sZGVyIiwic2VsZWN0T3B0aW9uIiwidG9IYXZlVmFsdWUiLCJmaWx0ZXJlZFJlcXVlc3QiLCJjb21wb3NlciIsInNlbmRCdXR0b24iLCJ0b0JlRW5hYmxlZCIsInN0cmVhbVJlc3BvbnNlUHJvbWlzZSIsIndhaXRGb3JSZXNwb25zZSIsImxhc3QiLCJzZXRWaWV3cG9ydFNpemUiLCJhY2NlcHRlZCIsImFzc2VydEFjY2VwdGVkQ2l0YXRpb24iLCJhc3NlcnRCbG9ja2VkQ2l0YXRpb24iLCJhc3NlcnROb0ludGVybmFsQ2l0YXRpb25EZXRhaWxzIiwiZ29CYWNrIiwiZ29Gb3J3YXJkIiwiX2F3YWl0JHJlc3VtZVJlcXVlc3QkIiwicmVzdW1lUmVxdWVzdCIsInBvc3REYXRhIiwib2JqZWN0Q29udGFpbmluZyIsIl9zdHJlYW1SZXF1ZXN0cyQiLCJfc3RyZWFtUmVxdWVzdHMkMiIsImFkZEluaXRTY3JpcHQiLCJuYXRpdmVGZXRjaCIsImJpbmQiLCJpbnB1dCIsImluaXQiLCJSZXF1ZXN0IiwicmVhZGVyIiwiZ2V0UmVhZGVyIiwiZW5jb2RlciIsIlRleHRFbmNvZGVyIiwic3RyZWFtIiwiUmVhZGFibGVTdHJlYW0iLCJzdGFydCIsImNvbnRyb2xsZXIiLCJidWZmZXJlZCIsImRvbmUiLCJyZWFkIiwiZW5xdWV1ZSIsImVuY29kZSIsIlRleHREZWNvZGVyIiwiZGVjb2RlIiwibWFya2VyIiwiaW5kZXhPZiIsImZyYW1lRW5kIiwiVHlwZUVycm9yIiwiUmVzcG9uc2UiLCJzdGF0dXNUZXh0Iiwic3RvcmFnZUtleSIsInBvaW50ZXJLZXkiLCJrZXkiLCJnZXRJdGVtIiwiX2xvY2FsU3RvcmFnZSRnZXRJdGVtIiwic2F2ZWQiLCJfbG9jYWxTdG9yYWdlJGdldEl0ZW0yIiwibGlmZWN5Y2xlIiwicmVjb3ZlcnlTdGF0ZSIsIm9wZXJhdG9yRXhwbGFuYXRpb24iLCJuZXh0QWN0aW9uIiwiY29uZmxpY3RSZWFzb24iLCJ2YWxpZGF0aW9uRXZpZGVuY2UiLCJ3b3Jrc3BhY2VBdmFpbGFibGUiLCJjaGFuZ2VDb3VudCIsInJlZ2lvbiIsImF2YWlsYWJsZSIsIm1pc3NpbmciLCJkaXNjYXJkZWQiLCJ0b0hhdmVBdHRyaWJ1dGUiLCJyZWxvYWRlZFJlZ2lvbiIsIm9wZXJhdGlvbiIsImJlZm9yZU9wZW4iLCJ0b0JlR3JlYXRlclRoYW4iLCJkcmF3ZXIiLCJkcmF3ZXJCb3giLCJkdXJpbmdPcGVuIiwiZ2V0QnlUZXN0SWQiLCJwcm92aWRlckNhcmRzIiwiY2FyZCIsInNjcm9sbEludG9WaWV3SWZOZWVkZWQiLCJzYXZlIl0sInNvdXJjZXMiOlsiZGFzaGJvYXJkLmpvdXJuZXkudHMiXSwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgZXhwZWN0LCB0ZXN0LCB0eXBlIExvY2F0b3IsIHR5cGUgUGFnZSB9IGZyb20gXCJAcGxheXdyaWdodC90ZXN0XCI7XG5pbXBvcnQgeyBta2Rpciwgd3JpdGVGaWxlIH0gZnJvbSBcIm5vZGU6ZnMvcHJvbWlzZXNcIjtcbmltcG9ydCB7IGRpcm5hbWUgfSBmcm9tIFwibm9kZTpwYXRoXCI7XG5pbXBvcnQge1xuICBwYXJzZUNsZXJrU2lnbkluVG9rZW5SZXNwb25zZSxcbiAgcGFyc2VDbGVya1VzZXJMb29rdXBSZXNwb25zZSxcbiAgcGFyc2VDcmVhdGVkQ2xlcmtVc2VyUmVzcG9uc2UsXG59IGZyb20gXCIuLi9zcmMvbGliL2NsZXJrLWhhbmRvZmZcIjtcblxuY29uc3QgREFTSEJPQVJEX1BBVEggPSBcIi9kYXNoYm9hcmQvXCI7XG5jb25zdCBURVNUX1VTRVIgPSB7XG4gIGZpcnN0TmFtZTogXCJFbmdpbmVlcmluZ09TXCIsXG4gIGxhc3ROYW1lOiBcIkRhc2hib2FyZCBTbW9rZVwiLFxuICBlbWFpbDpcbiAgICBwcm9jZXNzLmVudi5EQVNIQk9BUkRfRTJFX0VNQUlMID8/XG4gICAgXCJlbmdpbmVlcmluZ29zLWRhc2hib2FyZC1zbW9rZUBleGFtcGxlLmNvbVwiLFxufTtcbmNvbnN0IEVYRUNVVElPTl9JRCA9IFwiZTJlLWNvbnRyb2xsZWQtZXhlY3V0aW9uXCI7XG5jb25zdCBERUZBVUxUX0xJVkVfVElNRU9VVF9NUyA9IDEyMF8wMDA7XG5jb25zdCBMSVZFX1RFU1RfVElNRU9VVF9NQVJHSU5fTVMgPSA1XzAwMDtcbmNvbnN0IERFRkFVTFRfUkVBRElORVNTX1RJTUVPVVRfTVMgPSAxNV8wMDA7XG5jb25zdCBURVNUX01PREVTID0gbmV3IFNldChbXCJmaXh0dXJlXCIsIFwibGl2ZS1wcm92aWRlclwiXSk7XG5jb25zdCBIT1NUSUxFX09SSUdJTiA9IFwiaHR0cHM6Ly9hdHRhY2tlci5leGFtcGxlXCI7XG5jb25zdCBPUklHSU5fRElBR05PU1RJQ19IRUFERVJTID0gW1xuICBcImFjY2Vzcy1jb250cm9sLWFsbG93LW9yaWdpblwiLFxuICBcImFjY2Vzcy1jb250cm9sLWFsbG93LW1ldGhvZHNcIixcbiAgXCJhY2Nlc3MtY29udHJvbC1hbGxvdy1oZWFkZXJzXCIsXG4gIFwidmFyeVwiLFxuXSBhcyBjb25zdDtcbmNvbnN0IERFRkFVTFRfTElWRV9QUk9NUFQgPVxuICBcIlBlcmZvcm0gYSBib3VuZGVkIGZvcmVuc2ljIGF1ZGl0IG9mIHRoaXMgZGlzcG9zYWJsZSBwcm9qZWN0IHVzaW5nIHJlYWQtb25seSB0b29scy4gXCIgK1xuICBcIlByb2R1Y2UgYXQgbGVhc3Qgb25lIGFjY2VwdGVkIGV2aWRlbmNlIGl0ZW0gYW5kIG9uZSB2YWxpZGF0aW9uIGNoZWNrcG9pbnQsIGFuZCBkbyBub3QgXCIgK1xuICBcInJlcG9ydCBDT01QTEVURUQgdW5sZXNzIGJvdGggYXJlIHByZXNlbnQuIFJlcG9ydCBvbmx5IHZlcmlmaWVkIGV2aWRlbmNlLlwiO1xuY29uc3QgTElWRV9DQU1QQUlHTl9TQ0VOQVJJT1MgPSBuZXcgU2V0KFtcbiAgXCJwcm92aWRlci1vdXRhZ2VcIixcbiAgXCJtYWxmb3JtZWQtb3V0cHV0XCIsXG4gIFwiZGVsaXZlcnktc3VjY2Vzc1wiLFxuXSk7XG5cbmZ1bmN0aW9uIGxpdmVDYW1wYWlnblNjZW5hcmlvKCk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gIGNvbnN0IHNjZW5hcmlvID0gcHJvY2Vzcy5lbnYuREFTSEJPQVJEX0UyRV9MSVZFX1NDRU5BUklPPy50cmltKCk7XG4gIGlmIChwcm9jZXNzLmVudi5EQVNIQk9BUkRfRTJFX0xJVkVfQ0FNUEFJR04gPT09IFwiMVwiICYmICFzY2VuYXJpbykge1xuICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgIFwiTGl2ZSBjYW1wYWlnbiByZXF1aXJlcyBEQVNIQk9BUkRfRTJFX0xJVkVfU0NFTkFSSU89cHJvdmlkZXItb3V0YWdlLCBtYWxmb3JtZWQtb3V0cHV0LCBvciBkZWxpdmVyeS1zdWNjZXNzLlwiLFxuICAgICk7XG4gIH1cbiAgaWYgKHNjZW5hcmlvICYmICFMSVZFX0NBTVBBSUdOX1NDRU5BUklPUy5oYXMoc2NlbmFyaW8pKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBVbnN1cHBvcnRlZCBsaXZlIGNhbXBhaWduIHNjZW5hcmlvOiAke3NjZW5hcmlvfS5gKTtcbiAgfVxuICByZXR1cm4gc2NlbmFyaW87XG59XG5cbmZ1bmN0aW9uIGxpdmVQcm9tcHQoKTogc3RyaW5nIHtcbiAgY29uc3Qgc2NlbmFyaW8gPSBsaXZlQ2FtcGFpZ25TY2VuYXJpbygpO1xuICBpZiAoc2NlbmFyaW8gPT09IFwicHJvdmlkZXItb3V0YWdlXCIpIHtcbiAgICByZXR1cm4gXCJSdW4gYSBib3VuZGVkIGZvcmVuc2ljIGF1ZGl0IGFuZCByZXBvcnQgdGhlIE9wZW5Sb3V0ZXIgcmF0ZS1saW1pdC9wcm92aWRlci1leGhhdXN0aW9uIG91dGFnZSBhcyBhIGZhaWxlZCBvciBpbmNvbXBsZXRlIG9wZXJhdGlvbi4gRG8gbm90IHVzZSBwcmlvciBhbmFseXNpcyBhcyBhIGN1cnJlbnQgYW5zd2VyOyBpbmNsdWRlIHRoZSBjdXJyZW50IG9wZXJhdGlvbiBhbmQgcmV2aXNpb24uXCI7XG4gIH1cbiAgaWYgKHNjZW5hcmlvID09PSBcIm1hbGZvcm1lZC1vdXRwdXRcIikge1xuICAgIHJldHVybiBcIlJ1biBhIGJvdW5kZWQgZm9yZW5zaWMgYXVkaXQgYW5kIHRyZWF0IG1hbGZvcm1lZCBwcm92aWRlciBvdXRwdXQgYXMgZmFpbGVkIG9yIGluY29tcGxldGUuIERvIG5vdCBjbGFpbSBzdWNjZXNzLCBhcHBseSwgY29tbWl0LCBvciBwdXNoIHdpdGhvdXQgY2FuZGlkYXRlLWJvdW5kIGV2aWRlbmNlLlwiO1xuICB9XG4gIGlmIChzY2VuYXJpbyA9PT0gXCJkZWxpdmVyeS1zdWNjZXNzXCIpIHtcbiAgICByZXR1cm4gXCJQbGVhc2UgY29uZHVjdCB0aGUgYm91bmRlZCBkZWxpdmVyeSBwcm9vZiBjYW1wYWlnbiBvbiB0aGlzIGRpc3Bvc2FibGUgcHJvamVjdC4gRXhlcmNpc2UgYXBwbHksIGNvbW1pdCwgYW5kIHB1c2ggb25seSB3aGVuIGVhY2ggY3VycmVudCBvcGVyYXRpb24sIHByb2plY3QgcmV2aXNpb24sIGNhbmRpZGF0ZSBpZGVudGl0eSwgYW5kIGNhbmRpZGF0ZS1ib3VuZCBldmlkZW5jZSBtYXRjaC4gUmVwb3J0IGV2ZXJ5IHRlcm1pbmFsIHJlY2VpcHQuXCI7XG4gIH1cbiAgcmV0dXJuIHByb2Nlc3MuZW52LkRBU0hCT0FSRF9FMkVfTElWRV9QUk9NUFQgPz8gREVGQVVMVF9MSVZFX1BST01QVDtcbn1cblxuZnVuY3Rpb24gbGl2ZVRpbWVvdXRNcygpOiBudW1iZXIge1xuICBjb25zdCBjb25maWd1cmVkID0gTnVtYmVyKHByb2Nlc3MuZW52LkRBU0hCT0FSRF9FMkVfTElWRV9USU1FT1VUX01TKTtcbiAgcmV0dXJuIE51bWJlci5pc0Zpbml0ZShjb25maWd1cmVkKSAmJiBjb25maWd1cmVkID4gMFxuICAgID8gY29uZmlndXJlZFxuICAgIDogREVGQVVMVF9MSVZFX1RJTUVPVVRfTVM7XG59XG5cbmZ1bmN0aW9uIGRhc2hib2FyZFRlc3RNb2RlKCk6IHN0cmluZyB7XG4gIHJldHVybiBwcm9jZXNzLmVudi5EQVNIQk9BUkRfRTJFX1RFU1RfTU9ERSA/PyBcImZpeHR1cmVcIjtcbn1cblxuZnVuY3Rpb24gcmVhZGluZXNzVGltZW91dE1zKCk6IG51bWJlciB7XG4gIGNvbnN0IGNvbmZpZ3VyZWQgPSBOdW1iZXIocHJvY2Vzcy5lbnYuREFTSEJPQVJEX0UyRV9SRUFESU5FU1NfVElNRU9VVF9NUyk7XG4gIHJldHVybiBOdW1iZXIuaXNGaW5pdGUoY29uZmlndXJlZCkgJiYgY29uZmlndXJlZCA+IDBcbiAgICA/IGNvbmZpZ3VyZWRcbiAgICA6IERFRkFVTFRfUkVBRElORVNTX1RJTUVPVVRfTVM7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHdyaXRlUmVhZGluZXNzUmVjZWlwdChcbiAgb3V0Y29tZTogXCJyZWFkeVwiIHwgXCJibG9ja2VkXCIsXG4gIGNoZWNrczogUmVjb3JkPHN0cmluZywgdW5rbm93bj4sXG4gIHJlYXNvbj86IHN0cmluZyxcbikge1xuICBjb25zdCByZWNlaXB0UGF0aCA9IHByb2Nlc3MuZW52LkRBU0hCT0FSRF9FMkVfUkVBRElORVNTX0FSVElGQUNUX1BBVEg7XG4gIGlmICghcmVjZWlwdFBhdGgpIHJldHVybjtcbiAgYXdhaXQgbWtkaXIoZGlybmFtZShyZWNlaXB0UGF0aCksIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xuICBhd2FpdCB3cml0ZUZpbGUoXG4gICAgcmVjZWlwdFBhdGgsXG4gICAgYCR7SlNPTi5zdHJpbmdpZnkoXG4gICAgICB7XG4gICAgICAgIG91dGNvbWUsXG4gICAgICAgIC4uLihyZWFzb24gPyB7IHJlYXNvbiB9IDoge30pLFxuICAgICAgICBjaGVja3MsXG4gICAgICAgIG1vZGU6IGRhc2hib2FyZFRlc3RNb2RlKCksXG4gICAgICAgIHByb2plY3Q6XG4gICAgICAgICAgZGFzaGJvYXJkVGVzdE1vZGUoKSA9PT0gXCJsaXZlLXByb3ZpZGVyXCJcbiAgICAgICAgICAgID8gcHJvY2Vzcy5lbnYuREFTSEJPQVJEX0UyRV9MSVZFX1BST0pFQ1RfSURcbiAgICAgICAgICAgIDogXCJlMmUtcHJvamVjdFwiLFxuICAgICAgfSxcbiAgICAgIG51bGwsXG4gICAgICAyLFxuICAgICl9XFxuYCxcbiAgICBcInV0ZjhcIixcbiAgKTtcbn1cblxuZnVuY3Rpb24gYXBwcm92ZWREYXNoYm9hcmRPcmlnaW5zKCk6IHN0cmluZ1tdIHtcbiAgY29uc3Qgb3JpZ2lucyA9IChwcm9jZXNzLmVudi5EQVNIQk9BUkRfRTJFX0FQUFJPVkVEX09SSUdJTlMgPz8gXCJcIilcbiAgICAuc3BsaXQoXCIsXCIpXG4gICAgLm1hcCgob3JpZ2luKSA9PiBvcmlnaW4udHJpbSgpKVxuICAgIC5maWx0ZXIoQm9vbGVhbik7XG4gIGlmIChvcmlnaW5zLmxlbmd0aCA9PT0gMCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgIFwiREFTSEJPQVJEX0UyRV9BUFBST1ZFRF9PUklHSU5TIG11c3QgY29udGFpbiBldmVyeSBhcHByb3ZlZCBkYXNoYm9hcmQgb3JpZ2luLlwiLFxuICAgICk7XG4gIH1cbiAgcmV0dXJuIG9yaWdpbnMubWFwKChvcmlnaW4pID0+IHtcbiAgICBjb25zdCBwYXJzZWQgPSBuZXcgVVJMKG9yaWdpbik7XG4gICAgaWYgKFxuICAgICAgcGFyc2VkLm9yaWdpbiAhPT0gb3JpZ2luIHx8XG4gICAgICBwYXJzZWQucGF0aG5hbWUgIT09IFwiL1wiIHx8XG4gICAgICBwYXJzZWQuc2VhcmNoIHx8XG4gICAgICBwYXJzZWQuaGFzaFxuICAgICkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICBgRGFzaGJvYXJkIGpvdXJuZXkgb3JpZ2luIG11c3QgYmUgYSBiYXJlIG9yaWdpbjogJHtvcmlnaW59YCxcbiAgICAgICk7XG4gICAgfVxuICAgIHJldHVybiBwYXJzZWQub3JpZ2luO1xuICB9KTtcbn1cblxuY29uc3QgZGFzaGJvYXJkRml4dHVyZSA9IHtcbiAgZnJlc2huZXNzUmV2aXNpb246IFwiMjAyNi0wMS0wMVQwMDowMDowMC4wMDBaXCIsXG4gIHByb2plY3RDb3VudDogMSxcbiAgYWN0aXZlVGFza0NvdW50OiAwLFxuICBjb21wbGV0ZWRUYXNrQ291bnQ6IDIsXG4gIGZhaWxlZFRhc2tDb3VudDogMCxcbiAgdGFza1N0YXR1c0JyZWFrZG93bjogeyBwZW5kaW5nOiAwLCBydW5uaW5nOiAwIH0sXG4gIHByb2plY3RTY29yZXM6IFtcbiAgICB7XG4gICAgICBwcm9qZWN0SWQ6IFwiZTJlLXByb2plY3RcIixcbiAgICAgIHByb2plY3ROYW1lOiBcIlNtb2tlIFByb2plY3RcIixcbiAgICAgIHNjb3JlOiA5MixcbiAgICAgIHRyZW5kOiBcInN0YWJsZVwiLFxuICAgIH0sXG4gIF0sXG4gIHJlY2VudEV2ZW50czogW1xuICAgIHtcbiAgICAgIGlkOiBcImUyZS1ldmVudFwiLFxuICAgICAgdHlwZTogXCJTbW9rZUNoZWNrXCIsXG4gICAgICBzZXZlcml0eTogXCJzdWNjZXNzXCIsXG4gICAgICBtZXNzYWdlOiBcIkRhc2hib2FyZCBBUEkgZml4dHVyZSByZWFkeVwiLFxuICAgICAgdGltZXN0YW1wOiBcIjIwMjYtMDEtMDFUMDA6MDA6MDAuMDAwWlwiLFxuICAgIH0sXG4gIF0sXG4gIHRvcFJ1bGVzOiBbXSxcbn07XG5cbmNvbnN0IGV4ZWN1dGlvbkZpeHR1cmUgPSB7XG4gIGlkOiBFWEVDVVRJT05fSUQsXG4gIHByb2plY3RJZDogXCJlMmUtcHJvamVjdFwiLFxuICBvcGVyYXRpb25JZDogXCJlMmUtb3BlcmF0aW9uXCIsXG4gIHN0YXR1czogXCJjb21wbGV0ZWRcIixcbiAgZmxpZ2h0U3RhdGU6IFwiQ09NUExFVEVEXCIsXG4gIGV2aWRlbmNlVmVyZGljdDogXCJQUk9WRU5cIixcbiAgcHJvb2ZSZXF1aXJlZDogZmFsc2UsXG4gIHJlc3VtYWJsZTogZmFsc2UsXG4gIGNoZWNrcG9pbnRWZXJzaW9uOiAxLFxuICBwcm9qZWN0UmV2aXNpb246IFwiZTJlLXJldmlzaW9uLTQyXCIsXG4gIGNoZWNrcG9pbnQ6IHtcbiAgICBzdGFnZTogXCJjb21wbGV0ZVwiLFxuICAgIGRldGFpbDogXCJDb250cm9sbGVkIGJyb3dzZXIgZml4dHVyZSBjb21wbGV0ZWQuXCIsXG4gIH0sXG4gIG9iamVjdGl2ZTogeyBvYmplY3RpdmU6IFwiVmVyaWZ5IHRoZSBkYXNoYm9hcmQgYnJvd3NlciBqb3VybmV5XCIgfSxcbiAgc3RhcnRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDA6MDAuMDAwWlwiLFxuICBjb21wbGV0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAxOjAwLjAwMFpcIixcbiAgY3JlYXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDA6MDAuMDAwWlwiLFxuICB1cGRhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMTowMC4wMDBaXCIsXG59O1xuXG5mdW5jdGlvbiBqc29uUmVzcG9uc2UoXG4gIGJvZHk6IHVua25vd24sXG4gIHN0YXR1cyA9IDIwMCxcbiAgaGVhZGVycz86IFJlY29yZDxzdHJpbmcsIHN0cmluZz4sXG4pIHtcbiAgcmV0dXJuIHtcbiAgICBzdGF0dXMsXG4gICAgY29udGVudFR5cGU6IFwiYXBwbGljYXRpb24vanNvblwiLFxuICAgIC4uLihoZWFkZXJzID8geyBoZWFkZXJzIH0gOiB7fSksXG4gICAgYm9keTogSlNPTi5zdHJpbmdpZnkoYm9keSksXG4gIH07XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGV4cGVjdE5vSG9yaXpvbnRhbE92ZXJmbG93KHBhZ2U6IFBhZ2UpIHtcbiAgY29uc3Qgb3ZlcmZsb3cgPSBhd2FpdCBwYWdlLmV2YWx1YXRlKCgpID0+ICh7XG4gICAgZG9jdW1lbnQ6IGRvY3VtZW50LmRvY3VtZW50RWxlbWVudC5zY3JvbGxXaWR0aCxcbiAgICBib2R5OiBkb2N1bWVudC5ib2R5LnNjcm9sbFdpZHRoLFxuICAgIHZpZXdwb3J0OiB3aW5kb3cuaW5uZXJXaWR0aCxcbiAgfSkpO1xuICBleHBlY3Qob3ZlcmZsb3cuZG9jdW1lbnQpLnRvQmVMZXNzVGhhbk9yRXF1YWwob3ZlcmZsb3cudmlld3BvcnQgKyAxKTtcbiAgZXhwZWN0KG92ZXJmbG93LmJvZHkpLnRvQmVMZXNzVGhhbk9yRXF1YWwob3ZlcmZsb3cudmlld3BvcnQgKyAxKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZXhwZWN0V2l0aGluVmlld3BvcnQoXG4gIGxvY2F0b3I6IExvY2F0b3IsXG4gIHZpZXdwb3J0OiB7IHdpZHRoOiBudW1iZXI7IGhlaWdodDogbnVtYmVyIH0sXG4gIGxhYmVsOiBzdHJpbmcsXG4pIHtcbiAgY29uc3QgYm94ID0gYXdhaXQgbG9jYXRvci5ib3VuZGluZ0JveCgpO1xuICBleHBlY3QoYm94LCBgJHtsYWJlbH0gc2hvdWxkIGhhdmUgYSBsYXlvdXQgYm94YCkubm90LnRvQmVOdWxsKCk7XG4gIGV4cGVjdChib3ghLngsIGAke2xhYmVsfSBsZWZ0IGVkZ2VgKS50b0JlR3JlYXRlclRoYW5PckVxdWFsKC0xKTtcbiAgZXhwZWN0KGJveCEueSwgYCR7bGFiZWx9IHRvcCBlZGdlYCkudG9CZUdyZWF0ZXJUaGFuT3JFcXVhbCgtMSk7XG4gIGV4cGVjdChib3ghLnggKyBib3ghLndpZHRoLCBgJHtsYWJlbH0gcmlnaHQgZWRnZWApLnRvQmVMZXNzVGhhbk9yRXF1YWwoXG4gICAgdmlld3BvcnQud2lkdGggKyAxLFxuICApO1xuICBleHBlY3QoYm94IS55ICsgYm94IS5oZWlnaHQsIGAke2xhYmVsfSBib3R0b20gZWRnZWApLnRvQmVMZXNzVGhhbk9yRXF1YWwoXG4gICAgdmlld3BvcnQuaGVpZ2h0ICsgMSxcbiAgKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZXhwZWN0RGFzaGJvYXJkUmVhZHkocGFnZTogUGFnZSkge1xuICBhd2FpdCBleHBlY3QoXG4gICAgcGFnZS5nZXRCeVJvbGUoXCJoZWFkaW5nXCIsIHsgbmFtZTogXCJTeXN0ZW0gT3ZlcnZpZXdcIiB9KSxcbiAgKS50b0JlVmlzaWJsZSgpO1xuICBhd2FpdCBleHBlY3QocGFnZS5nZXRCeVRleHQoXCJTWVNURU0gT05MSU5FXCIsIHsgZXhhY3Q6IHRydWUgfSkpLnRvQmVWaXNpYmxlKCk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHJlc3RhcnRBcGlGb3JDYW1wYWlnbihwYWdlOiBQYWdlKSB7XG4gIGNvbnN0IGNvbnRyb2xVcmwgPSBwcm9jZXNzLmVudi5EQVNIQk9BUkRfRTJFX0NPTlRST0xfVVJMO1xuICBpZiAoIWNvbnRyb2xVcmwpIHRocm93IG5ldyBFcnJvcihcIkRhc2hib2FyZCBjYW1wYWlnbiBjb250cm9sIFVSTCBpcyBtaXNzaW5nLlwiKTtcbiAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBwYWdlLnJlcXVlc3QucG9zdChgJHtjb250cm9sVXJsfS9yZXN0YXJ0LWFwaWAsIHtcbiAgICB0aW1lb3V0OiAxNV8wMDAsXG4gIH0pO1xuICBleHBlY3QocmVzcG9uc2Uuc3RhdHVzKCkpLnRvQmUoMjA0KTtcbn1cblxudHlwZSBBcmFiaWNBaUZpeHR1cmUgPSB7XG4gIHF1ZXN0aW9uOiBzdHJpbmc7XG4gIGFuc3dlcjogc3RyaW5nO1xuICBzb3VyY2U6IHN0cmluZztcbiAgc2Vzc2lvbklkOiBzdHJpbmc7XG4gIGV4ZWN1dGlvbklkPzogc3RyaW5nO1xuICBwcm9qZWN0SWQ/OiBzdHJpbmc7XG4gIHN0cmVhbUJvZHk6IHN0cmluZztcbiAgbWVzc2FnZTogUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG59O1xuXG5hc3luYyBmdW5jdGlvbiBpbnN0YWxsQXBpRml4dHVyZXMoXG4gIHBhZ2U6IFBhZ2UsXG4gIG92ZXJyaWRlcz86IHtcbiAgICBhcmFiaWNBaT86IEFyYWJpY0FpRml4dHVyZTtcbiAgICBhbHRlcm5hdGVBaT86IEFyYWJpY0FpRml4dHVyZTtcbiAgICBkaXNjb25uZWN0QWk/OiBBcmFiaWNBaUZpeHR1cmU7XG4gICAgcmVzdW1lRmFpbHVyZT86IHtcbiAgICAgIGZpeHR1cmU6IEFyYWJpY0FpRml4dHVyZTtcbiAgICAgIGV4ZWN1dGlvbjogUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gICAgfTtcbiAgICBpbnRlcnJ1cHRlZFJlc3VtZT86IHtcbiAgICAgIGZpeHR1cmU6IEFyYWJpY0FpRml4dHVyZTtcbiAgICAgIGV4ZWN1dGlvbjogUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gICAgICByZWNvdmVyZWRUb2tlbjogc3RyaW5nO1xuICAgICAgcmVzdW1lZFN0cmVhbUJvZHk6IHN0cmluZztcbiAgICB9O1xuICAgIGRlbGl2ZXJ5UmVjb3Zlcnk/OiB7XG4gICAgICBvcGVyYXRpb25zOiBBcnJheTxSZWNvcmQ8c3RyaW5nLCB1bmtub3duPj47XG4gICAgICByZXF1ZXN0czogc3RyaW5nW107XG4gICAgICBhY3Rpb25SZXF1ZXN0cz86IHN0cmluZ1tdO1xuICAgICAgcmVjb3ZlcnlBY3Rpb24/OiB7XG4gICAgICAgIHByb3Bvc2FsSWQ6IHN0cmluZztcbiAgICAgICAgYWN0aW9uOiBcInJlc3VtZS12YWxpZGF0aW9uXCIgfCBcImRpc2NhcmRcIjtcbiAgICAgICAgcmVzcG9uc2U6IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAgICAgICBzdGF0dXM/OiBudW1iZXI7XG4gICAgICAgIG5leHRPcGVyYXRpb25zPzogQXJyYXk8UmVjb3JkPHN0cmluZywgdW5rbm93bj4+O1xuICAgICAgfTtcbiAgICB9O1xuICAgIHByb2plY3RzPzogQXJyYXk8UmVjb3JkPHN0cmluZywgdW5rbm93bj4+O1xuICAgIGV2ZW50cz86IEFycmF5PFJlY29yZDxzdHJpbmcsIHVua25vd24+PjtcbiAgICBhcmNoaXZlVXBsb2FkPzoge1xuICAgICAgdXBsb2FkSWQ6IHN0cmluZztcbiAgICAgIG9yaWdpbmFsTmFtZTogc3RyaW5nO1xuICAgIH07XG4gICAgYXVkaXRFeHBvcnQ/OiB7XG4gICAgICBib2R5OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgICAgIGZpbGVuYW1lOiBzdHJpbmc7XG4gICAgICByZXF1ZXN0czogc3RyaW5nW107XG4gICAgICBleGVjdXRpb24/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgICAgIG1lc3NhZ2VPdXRjb21lPzogc3RyaW5nO1xuICAgICAgZmFpbEZpcnN0UHJldmlldz86IGJvb2xlYW47XG4gICAgfTtcbiAgICBsaXZlVGFzaz86IHtcbiAgICAgIGlkOiBzdHJpbmc7XG4gICAgICB0aXRsZTogc3RyaW5nO1xuICAgICAgcHJvamVjdElkOiBzdHJpbmc7XG4gICAgICBsb2c6IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAgICAgaW5pdGlhbExvZ3M/OiBBcnJheTxSZWNvcmQ8c3RyaW5nLCB1bmtub3duPj47XG4gICAgICBzdHJlYW1SZXF1ZXN0cz86IHN0cmluZ1tdO1xuICAgICAgZmFpbEZpcnN0U3RyZWFtPzogYm9vbGVhbjtcbiAgICAgIGZhaWxTdHJlYW1BdHRlbXB0cz86IG51bWJlcjtcbiAgICB9O1xuICAgIHRhc2tBY3Rpb25zPzoge1xuICAgICAgdGFza3M6IEFycmF5PFJlY29yZDxzdHJpbmcsIHVua25vd24+PjtcbiAgICAgIHJlcXVlc3RzOiBzdHJpbmdbXTtcbiAgICAgIHZlcmlmaWNhdGlvblJlcXVlc3RzPzogQXJyYXk8UmVjb3JkPHN0cmluZywgdW5rbm93bj4+O1xuICAgIH07XG4gICAgcmVjb3ZlcnlUYXNrcz86IEFycmF5PFJlY29yZDxzdHJpbmcsIHVua25vd24+PjtcbiAgICByZWNvdmVyeVdvcmtmbG93cz86IEFycmF5PFJlY29yZDxzdHJpbmcsIHVua25vd24+PjtcbiAgICByZWNvdmVyeVdvcmtmbG93RXhlY3V0aW9ucz86IFJlY29yZDxzdHJpbmcsIEFycmF5PFJlY29yZDxzdHJpbmcsIHVua25vd24+Pj47XG4gIH0sXG4pIHtcbiAgYXdhaXQgcGFnZS5yb3V0ZShcIioqL2FwaS8qKlwiLCBhc3luYyAocm91dGUpID0+IHtcbiAgICBjb25zdCB1cmwgPSBuZXcgVVJMKHJvdXRlLnJlcXVlc3QoKS51cmwoKSk7XG4gICAgY29uc3QgcGF0aCA9IHVybC5wYXRobmFtZS5yZXBsYWNlKC9eXFwvZGFzaGJvYXJkKD89XFwvfCQpLywgXCJcIik7XG4gICAgY29uc3QgYXJhYmljQWkgPSBvdmVycmlkZXM/LmFyYWJpY0FpO1xuICAgIGNvbnN0IGFsdGVybmF0ZUFpID0gb3ZlcnJpZGVzPy5hbHRlcm5hdGVBaTtcbiAgICBjb25zdCBkaXNjb25uZWN0QWkgPSBvdmVycmlkZXM/LmRpc2Nvbm5lY3RBaTtcbiAgICBjb25zdCBhaUZpeHR1cmVzID0gW2FyYWJpY0FpLCBhbHRlcm5hdGVBaSwgZGlzY29ubmVjdEFpXS5maWx0ZXIoXG4gICAgICAoZml4dHVyZSk6IGZpeHR1cmUgaXMgQXJhYmljQWlGaXh0dXJlID0+IEJvb2xlYW4oZml4dHVyZSksXG4gICAgKTtcbiAgICBjb25zdCBoYXNDb25maWd1cmVkQWlGaXh0dXJlID1cbiAgICAgIGFpRml4dHVyZXMubGVuZ3RoID4gMCB8fFxuICAgICAgQm9vbGVhbihvdmVycmlkZXM/LnJlc3VtZUZhaWx1cmUgfHwgb3ZlcnJpZGVzPy5pbnRlcnJ1cHRlZFJlc3VtZSk7XG5cbiAgICBpZiAoYWlGaXh0dXJlcy5sZW5ndGggPiAwICYmIHBhdGguZW5kc1dpdGgoXCIvYXBpL2FpL2NoYXQvc2Vzc2lvbnNcIikpIHtcbiAgICAgIGNvbnN0IHByb2plY3RJZCA9IHVybC5zZWFyY2hQYXJhbXMuZ2V0KFwicHJvamVjdElkXCIpO1xuICAgICAgY29uc3QgcHJvamVjdFNlc3Npb25zID0gYWlGaXh0dXJlcy5maWx0ZXIoXG4gICAgICAgIChmaXh0dXJlKSA9PiAhZml4dHVyZS5wcm9qZWN0SWQgfHwgZml4dHVyZS5wcm9qZWN0SWQgPT09IHByb2plY3RJZCxcbiAgICAgICk7XG4gICAgICByZXR1cm4gcm91dGUuZnVsZmlsbChcbiAgICAgICAganNvblJlc3BvbnNlKFxuICAgICAgICAgIHByb2plY3RTZXNzaW9ucy5tYXAoKGZpeHR1cmUpID0+ICh7XG4gICAgICAgICAgICBpZDogZml4dHVyZS5zZXNzaW9uSWQsXG4gICAgICAgICAgICB0aXRsZTogZml4dHVyZS5xdWVzdGlvbixcbiAgICAgICAgICAgIHVwZGF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAyOjAwLjAwMFpcIixcbiAgICAgICAgICB9KSksXG4gICAgICAgICksXG4gICAgICApO1xuICAgIH1cbiAgICBpZiAob3ZlcnJpZGVzPy5yZXN1bWVGYWlsdXJlICYmIHBhdGguZW5kc1dpdGgoXCIvYXBpL2FpL2NoYXQvc3RyZWFtXCIpKSB7XG4gICAgICBsZXQgcmVxdWVzdEJvZHk6IFJlY29yZDxzdHJpbmcsIHVua25vd24+ID0ge307XG4gICAgICB0cnkge1xuICAgICAgICByZXF1ZXN0Qm9keSA9IHJvdXRlLnJlcXVlc3QoKS5wb3N0RGF0YUpTT04oKSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICAvLyBUaGUgbm9ybWFsIHByb3ZpZGVyLWZyZWUgZmFsbGJhY2sgYmVsb3cgaGFuZGxlcyBtYWxmb3JtZWQgcmVxdWVzdHMuXG4gICAgICB9XG4gICAgICBpZiAoXG4gICAgICAgIHJlcXVlc3RCb2R5LmV4ZWN1dGlvbklkID09PSBvdmVycmlkZXMucmVzdW1lRmFpbHVyZS5maXh0dXJlLmV4ZWN1dGlvbklkXG4gICAgICApIHtcbiAgICAgICAgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoe1xuICAgICAgICAgIHN0YXR1czogMjAwLFxuICAgICAgICAgIGNvbnRlbnRUeXBlOiBcInRleHQvZXZlbnQtc3RyZWFtXCIsXG4gICAgICAgICAgaGVhZGVyczogeyBcIkNhY2hlLUNvbnRyb2xcIjogXCJuby1jYWNoZVwiIH0sXG4gICAgICAgICAgYm9keTogb3ZlcnJpZGVzLnJlc3VtZUZhaWx1cmUuZml4dHVyZS5zdHJlYW1Cb2R5LFxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9XG4gICAgaWYgKG92ZXJyaWRlcz8uaW50ZXJydXB0ZWRSZXN1bWUgJiYgcGF0aC5lbmRzV2l0aChcIi9hcGkvYWkvY2hhdC9zdHJlYW1cIikpIHtcbiAgICAgIGxldCByZXF1ZXN0Qm9keTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gPSB7fTtcbiAgICAgIHRyeSB7XG4gICAgICAgIHJlcXVlc3RCb2R5ID0gcm91dGUucmVxdWVzdCgpLnBvc3REYXRhSlNPTigpIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIC8vIFRoZSBub3JtYWwgcHJvdmlkZXItZnJlZSBmYWxsYmFjayBiZWxvdyBoYW5kbGVzIG1hbGZvcm1lZCByZXF1ZXN0cy5cbiAgICAgIH1cbiAgICAgIGNvbnN0IHsgZml4dHVyZSwgcmVzdW1lZFN0cmVhbUJvZHkgfSA9IG92ZXJyaWRlcy5pbnRlcnJ1cHRlZFJlc3VtZTtcbiAgICAgIGlmIChyZXF1ZXN0Qm9keS5leGVjdXRpb25JZCA9PT0gZml4dHVyZS5leGVjdXRpb25JZCkge1xuICAgICAgICByZXR1cm4gcm91dGUuZnVsZmlsbCh7XG4gICAgICAgICAgc3RhdHVzOiAyMDAsXG4gICAgICAgICAgY29udGVudFR5cGU6IFwidGV4dC9ldmVudC1zdHJlYW1cIixcbiAgICAgICAgICBoZWFkZXJzOiB7IFwiQ2FjaGUtQ29udHJvbFwiOiBcIm5vLWNhY2hlXCIgfSxcbiAgICAgICAgICBib2R5OiByZXN1bWVkU3RyZWFtQm9keSxcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgICBpZiAoIXJlcXVlc3RCb2R5LmV4ZWN1dGlvbklkKSB7XG4gICAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKHtcbiAgICAgICAgICBzdGF0dXM6IDIwMCxcbiAgICAgICAgICBjb250ZW50VHlwZTogXCJ0ZXh0L2V2ZW50LXN0cmVhbVwiLFxuICAgICAgICAgIGhlYWRlcnM6IHsgXCJDYWNoZS1Db250cm9sXCI6IFwibm8tY2FjaGVcIiB9LFxuICAgICAgICAgIC8vIERlbGliZXJhdGVseSBzdG9wIGFmdGVyIHRoZSBkdXJhYmxlIGV4ZWN1dGlvbiBpZGVudGl0eS4gVGhlXG4gICAgICAgICAgLy8gam91cm5leSB3cmFwcyB0aGlzIHJlc3BvbnNlIGluIGEgYnJvd3Nlci1sZXZlbCBzdHJlYW0gZXJyb3IuXG4gICAgICAgICAgYm9keTogZml4dHVyZS5zdHJlYW1Cb2R5LFxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9XG4gICAgbGV0IHJlcXVlc3RlZE1lc3NhZ2U6IHN0cmluZyB8IHVuZGVmaW5lZDtcbiAgICB0cnkge1xuICAgICAgcmVxdWVzdGVkTWVzc2FnZSA9IChyb3V0ZS5yZXF1ZXN0KCkucG9zdERhdGFKU09OKCkgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4pXG4gICAgICAgIC5tZXNzYWdlIGFzIHN0cmluZyB8IHVuZGVmaW5lZDtcbiAgICB9IGNhdGNoIHtcbiAgICAgIC8vIFRoZSBkZWZhdWx0IHByb3ZpZGVyLXVuYXZhaWxhYmxlIHJlc3BvbnNlIGhhbmRsZXMgbWFsZm9ybWVkIHJlcXVlc3RzLlxuICAgIH1cbiAgICBjb25zdCBzdHJlYW1GaXh0dXJlID1cbiAgICAgIGRpc2Nvbm5lY3RBaSA/P1xuICAgICAgYWlGaXh0dXJlcy5maW5kKFxuICAgICAgICAoZml4dHVyZSkgPT5cbiAgICAgICAgICB0eXBlb2YgcmVxdWVzdGVkTWVzc2FnZSA9PT0gXCJzdHJpbmdcIiAmJlxuICAgICAgICAgIChyZXF1ZXN0ZWRNZXNzYWdlID09PSBmaXh0dXJlLnF1ZXN0aW9uIHx8XG4gICAgICAgICAgICByZXF1ZXN0ZWRNZXNzYWdlLmluY2x1ZGVzKGZpeHR1cmUucXVlc3Rpb24pKSxcbiAgICAgICkgPz9cbiAgICAgIGFyYWJpY0FpO1xuICAgIGlmIChzdHJlYW1GaXh0dXJlICYmIHBhdGguZW5kc1dpdGgoXCIvYXBpL2FpL2NoYXQvc3RyZWFtXCIpKVxuICAgICAgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoe1xuICAgICAgICBzdGF0dXM6IDIwMCxcbiAgICAgICAgY29udGVudFR5cGU6IFwidGV4dC9ldmVudC1zdHJlYW1cIixcbiAgICAgICAgaGVhZGVyczogeyBcIkNhY2hlLUNvbnRyb2xcIjogXCJuby1jYWNoZVwiIH0sXG4gICAgICAgIGJvZHk6IHN0cmVhbUZpeHR1cmUuc3RyZWFtQm9keSxcbiAgICAgIH0pO1xuICAgIGNvbnN0IG1lc3NhZ2VGaXh0dXJlID0gYWlGaXh0dXJlcy5maW5kKChmaXh0dXJlKSA9PlxuICAgICAgcGF0aC5lbmRzV2l0aChgL2FwaS9haS9jaGF0LyR7Zml4dHVyZS5zZXNzaW9uSWR9L21lc3NhZ2VzYCksXG4gICAgKTtcbiAgICBpZiAobWVzc2FnZUZpeHR1cmUpXG4gICAgICByZXR1cm4gcm91dGUuZnVsZmlsbChcbiAgICAgICAganNvblJlc3BvbnNlKFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBpZDogYCR7bWVzc2FnZUZpeHR1cmUuc2Vzc2lvbklkfS11c2VyLW1lc3NhZ2VgLFxuICAgICAgICAgICAgc2Vzc2lvbklkOiBtZXNzYWdlRml4dHVyZS5zZXNzaW9uSWQsXG4gICAgICAgICAgICByb2xlOiBcInVzZXJcIixcbiAgICAgICAgICAgIGNvbnRlbnQ6IG1lc3NhZ2VGaXh0dXJlLnF1ZXN0aW9uLFxuICAgICAgICAgICAgY3JlYXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDE6MDAuMDAwWlwiLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgbWVzc2FnZUZpeHR1cmUubWVzc2FnZSxcbiAgICAgICAgXSksXG4gICAgICApO1xuICAgIGlmIChcbiAgICAgIG92ZXJyaWRlcz8uYXVkaXRFeHBvcnQgJiZcbiAgICAgIHBhdGguZW5kc1dpdGgoXCIvYXBpL2FpL2NoYXQvZTJlLWF1ZGl0LXNlc3Npb24vbWVzc2FnZXNcIilcbiAgICApIHtcbiAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKFxuICAgICAgICBqc29uUmVzcG9uc2UoW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIGlkOiBcImUyZS1hdWRpdC11c2VyLW1lc3NhZ2VcIixcbiAgICAgICAgICAgIHNlc3Npb25JZDogXCJlMmUtYXVkaXQtc2Vzc2lvblwiLFxuICAgICAgICAgICAgcm9sZTogXCJ1c2VyXCIsXG4gICAgICAgICAgICBjb250ZW50OiBcIkNvbXBsZXRlZCBhdWRpdCBleGVjdXRpb25cIixcbiAgICAgICAgICAgIGNyZWF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAxOjAwLjAwMFpcIixcbiAgICAgICAgICB9LFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIGlkOiBcImUyZS1hdWRpdC1hc3Npc3RhbnQtbWVzc2FnZVwiLFxuICAgICAgICAgICAgc2Vzc2lvbklkOiBcImUyZS1hdWRpdC1zZXNzaW9uXCIsXG4gICAgICAgICAgICByb2xlOiBcImFzc2lzdGFudFwiLFxuICAgICAgICAgICAgY29udGVudDogXCJDb21wbGV0ZWQgYXVkaXQgZXhlY3V0aW9uXCIsXG4gICAgICAgICAgICBleGVjdXRpb25JZDogRVhFQ1VUSU9OX0lELFxuICAgICAgICAgICAgb3V0Y29tZTogb3ZlcnJpZGVzLmF1ZGl0RXhwb3J0Lm1lc3NhZ2VPdXRjb21lID8/IFwiU1VDQ0VFREVEXCIsXG4gICAgICAgICAgICBjcmVhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMjowMC4wMDBaXCIsXG4gICAgICAgICAgfSxcbiAgICAgICAgXSksXG4gICAgICApO1xuICAgIH1cblxuICAgIGlmIChwYXRoID09PSBcIi9hcGkvZGFzaGJvYXJkXCIpXG4gICAgICByZXR1cm4gcm91dGUuZnVsZmlsbChqc29uUmVzcG9uc2UoZGFzaGJvYXJkRml4dHVyZSkpO1xuICAgIGlmIChvdmVycmlkZXM/LnRhc2tBY3Rpb25zKSB7XG4gICAgICBjb25zdCB2ZXJpZmljYXRpb25NYXRjaCA9IHBhdGgubWF0Y2goXG4gICAgICAgIC9eXFwvYXBpXFwvdGFza3NcXC8oW14vXSspXFwvdmVyaWZpY2F0aW9uJC8sXG4gICAgICApO1xuICAgICAgaWYgKHZlcmlmaWNhdGlvbk1hdGNoICYmIHJvdXRlLnJlcXVlc3QoKS5tZXRob2QoKSA9PT0gXCJQT1NUXCIpIHtcbiAgICAgICAgY29uc3QgWywgdGFza0lkXSA9IHZlcmlmaWNhdGlvbk1hdGNoO1xuICAgICAgICBjb25zdCB0YXNrID0gb3ZlcnJpZGVzLnRhc2tBY3Rpb25zLnRhc2tzLmZpbmQoXG4gICAgICAgICAgKGNhbmRpZGF0ZSkgPT4gY2FuZGlkYXRlLmlkID09PSB0YXNrSWQsXG4gICAgICAgICk7XG4gICAgICAgIGlmICghdGFzaykge1xuICAgICAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKGpzb25SZXNwb25zZSh7IGVycm9yOiBcIlRhc2sgbm90IGZvdW5kXCIgfSwgNDA0KSk7XG4gICAgICAgIH1cblxuICAgICAgICBsZXQgYm9keTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gPSB7fTtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBib2R5ID0gcm91dGUucmVxdWVzdCgpLnBvc3REYXRhSlNPTigpIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAgICAgICB9IGNhdGNoIHtcbiAgICAgICAgICByZXR1cm4gcm91dGUuZnVsZmlsbChcbiAgICAgICAgICAgIGpzb25SZXNwb25zZSh7IGVycm9yOiBcIkludmFsaWQgdmVyaWZpY2F0aW9uIHJlcXVlc3RcIiB9LCA0MDApLFxuICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgcGxhbiA9IHRhc2sucmVtZWRpYXRpb25QbGFuIGFzXG4gICAgICAgICAgfCB7XG4gICAgICAgICAgICAgIHZlcmlmaWNhdGlvbkNoZWNrcz86IEFycmF5PFJlY29yZDxzdHJpbmcsIHVua25vd24+PjtcbiAgICAgICAgICAgICAgdmVyaWZpY2F0aW9uU3RlcHM/OiBzdHJpbmdbXTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB8IHVuZGVmaW5lZDtcbiAgICAgICAgY29uc3QgY2hlY2tzID1cbiAgICAgICAgICBwbGFuPy52ZXJpZmljYXRpb25DaGVja3MgPz9cbiAgICAgICAgICAocGxhbj8udmVyaWZpY2F0aW9uU3RlcHMgPz8gW10pLm1hcCgoZ3VpZGFuY2UsIGluZGV4KSA9PiAoe1xuICAgICAgICAgICAgaWQ6IGBydWxlLXZlcmlmaWNhdGlvbi0ke2luZGV4ICsgMX1gLFxuICAgICAgICAgICAga2luZDogXCJvcGVyYXRvcl9hdHRlc3RhdGlvblwiLFxuICAgICAgICAgICAgZ3VpZGFuY2UsXG4gICAgICAgICAgfSkpO1xuICAgICAgICBjb25zdCBjaGVjayA9IGNoZWNrcy5maW5kKChjYW5kaWRhdGUpID0+IGNhbmRpZGF0ZS5pZCA9PT0gYm9keS5jaGVja0lkKTtcbiAgICAgICAgaWYgKCFjaGVjaykge1xuICAgICAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKFxuICAgICAgICAgICAganNvblJlc3BvbnNlKFxuICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgZXJyb3I6IFwidmVyaWZpY2F0aW9uX2NoZWNrX25vdF9mb3VuZFwiLFxuICAgICAgICAgICAgICAgIHJlYXNvbjpcbiAgICAgICAgICAgICAgICAgIFwiVGhlIHN1Ym1pdHRlZCBjaGVjayBpcyBub3QgcGFydCBvZiB0aGlzIHRhc2sncyBzZXJ2ZXItb3duZWQgdmVyaWZpY2F0aW9uIHBsYW4uXCIsXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIDQwMCxcbiAgICAgICAgICAgICksXG4gICAgICAgICAgKTtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCBwYXNzZWQgPSBib2R5LnBhc3NlZCA9PT0gdHJ1ZTtcbiAgICAgICAgY29uc3QgZXZpZGVuY2UgPVxuICAgICAgICAgIHR5cGVvZiBib2R5LmV2aWRlbmNlID09PSBcInN0cmluZ1wiID8gYm9keS5ldmlkZW5jZS50cmltKCkgOiBcIlwiO1xuICAgICAgICBpZiAocGFzc2VkICYmICFldmlkZW5jZSkge1xuICAgICAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKFxuICAgICAgICAgICAganNvblJlc3BvbnNlKFxuICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgZXJyb3I6IFwidmVyaWZpY2F0aW9uX2V2aWRlbmNlX3JlcXVpcmVkXCIsXG4gICAgICAgICAgICAgICAgcmVhc29uOlxuICAgICAgICAgICAgICAgICAgXCJBIHBhc3NlZCB2ZXJpZmljYXRpb24gY2hlY2sgbXVzdCBpbmNsdWRlIGV4cGxpY2l0IG9wZXJhdG9yIGV2aWRlbmNlLlwiLFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICA0MDAsXG4gICAgICAgICAgICApLFxuICAgICAgICAgICk7XG4gICAgICAgIH1cblxuICAgICAgICBvdmVycmlkZXMudGFza0FjdGlvbnMudmVyaWZpY2F0aW9uUmVxdWVzdHM/LnB1c2goe1xuICAgICAgICAgIHRhc2tJZCxcbiAgICAgICAgICBjaGVja0lkOiBib2R5LmNoZWNrSWQsXG4gICAgICAgICAgcGFzc2VkLFxuICAgICAgICAgIC4uLihldmlkZW5jZSA/IHsgZXZpZGVuY2UgfSA6IHt9KSxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgY29uc3QgcHJpb3JSZXN1bHQgPSAodGFzay52ZXJpZmljYXRpb25SZXN1bHQgPz8ge30pIGFzIHtcbiAgICAgICAgICBzdGVwcz86IEFycmF5PFJlY29yZDxzdHJpbmcsIHVua25vd24+PjtcbiAgICAgICAgICBoaXN0b3J5PzogQXJyYXk8UmVjb3JkPHN0cmluZywgdW5rbm93bj4+O1xuICAgICAgICB9O1xuICAgICAgICBjb25zdCBwcmlvclN0ZXBzID0gcHJpb3JSZXN1bHQuc3RlcHMgPz8gW107XG4gICAgICAgIGNvbnN0IHN0ZXBzID0gY2hlY2tzLm1hcCgoY2FuZGlkYXRlKSA9PiB7XG4gICAgICAgICAgY29uc3QgcHJpb3IgPSBwcmlvclN0ZXBzLmZpbmQoKHN0ZXApID0+IHN0ZXAuaWQgPT09IGNhbmRpZGF0ZS5pZCk7XG4gICAgICAgICAgaWYgKGNhbmRpZGF0ZS5pZCAhPT0gYm9keS5jaGVja0lkKSB7XG4gICAgICAgICAgICByZXR1cm4gKFxuICAgICAgICAgICAgICBwcmlvciA/PyB7XG4gICAgICAgICAgICAgICAgaWQ6IGNhbmRpZGF0ZS5pZCxcbiAgICAgICAgICAgICAgICBuYW1lOiBgUnVsZSB2ZXJpZmljYXRpb24gJHtTdHJpbmcoY2FuZGlkYXRlLmlkKS5yZXBsYWNlKFxuICAgICAgICAgICAgICAgICAgXCJydWxlLXZlcmlmaWNhdGlvbi1cIixcbiAgICAgICAgICAgICAgICAgIFwiI1wiLFxuICAgICAgICAgICAgICAgICl9YCxcbiAgICAgICAgICAgICAgICBraW5kOiBjYW5kaWRhdGUua2luZCA/PyBcIm9wZXJhdG9yX2F0dGVzdGF0aW9uXCIsXG4gICAgICAgICAgICAgICAgZ3VpZGFuY2U6IGNhbmRpZGF0ZS5ndWlkYW5jZSxcbiAgICAgICAgICAgICAgICBwYXNzZWQ6IGZhbHNlLFxuICAgICAgICAgICAgICAgIG91dHB1dDogXCJOb3QgcmVjb3JkZWQg4oCUIG9wZXJhdG9yIGV2aWRlbmNlIGlzIHJlcXVpcmVkXCIsXG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICk7XG4gICAgICAgICAgfVxuICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBpZDogY2FuZGlkYXRlLmlkLFxuICAgICAgICAgICAgbmFtZTogYFJ1bGUgdmVyaWZpY2F0aW9uICR7U3RyaW5nKGNhbmRpZGF0ZS5pZCkucmVwbGFjZShcbiAgICAgICAgICAgICAgXCJydWxlLXZlcmlmaWNhdGlvbi1cIixcbiAgICAgICAgICAgICAgXCIjXCIsXG4gICAgICAgICAgICApfWAsXG4gICAgICAgICAgICBraW5kOiBjYW5kaWRhdGUua2luZCA/PyBcIm9wZXJhdG9yX2F0dGVzdGF0aW9uXCIsXG4gICAgICAgICAgICBndWlkYW5jZTogY2FuZGlkYXRlLmd1aWRhbmNlLFxuICAgICAgICAgICAgcGFzc2VkLFxuICAgICAgICAgICAgLi4uKGV2aWRlbmNlID8geyBldmlkZW5jZSB9IDoge30pLFxuICAgICAgICAgICAgb3V0cHV0OiBwYXNzZWRcbiAgICAgICAgICAgICAgPyBcIk9wZXJhdG9yIGV2aWRlbmNlIHJlY29yZGVkXCJcbiAgICAgICAgICAgICAgOiBcIk9wZXJhdG9yIHJlcG9ydGVkIHRoYXQgdGhlIGNoZWNrIGZhaWxlZFwiLFxuICAgICAgICAgIH07XG4gICAgICAgIH0pO1xuICAgICAgICBjb25zdCBjb21wbGV0ZWQgPSBzdGVwcy5ldmVyeShcbiAgICAgICAgICAoc3RlcCkgPT4gc3RlcC5wYXNzZWQgPT09IHRydWUgJiYgQm9vbGVhbihTdHJpbmcoc3RlcC5ldmlkZW5jZSA/PyBcIlwiKS50cmltKCkpLFxuICAgICAgICApO1xuICAgICAgICB0YXNrLnN0YXR1cyA9IGNvbXBsZXRlZCA/IFwiY29tcGxldGVkXCIgOiBcInZlcmlmeWluZ1wiO1xuICAgICAgICB0YXNrLnZlcmlmaWNhdGlvblJlc3VsdCA9IHtcbiAgICAgICAgICBwYXNzZWQ6IGNvbXBsZXRlZCxcbiAgICAgICAgICBkZWNpc2lvbjogY29tcGxldGVkID8gXCJ2ZXJpZmllZFwiIDogXCJpbmNvbXBsZXRlXCIsXG4gICAgICAgICAgc3RlcHMsXG4gICAgICAgICAgaGlzdG9yeTogW1xuICAgICAgICAgICAgLi4uKHByaW9yUmVzdWx0Lmhpc3RvcnkgPz8gW10pLFxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBpZDogYHZlcmlmaWNhdGlvbi1oaXN0b3J5LSR7U3RyaW5nKFxuICAgICAgICAgICAgICAgIChwcmlvclJlc3VsdC5oaXN0b3J5ID8/IFtdKS5sZW5ndGggKyAxLFxuICAgICAgICAgICAgICApfWAsXG4gICAgICAgICAgICAgIGNoZWNrSWQ6IGNoZWNrLmlkLFxuICAgICAgICAgICAgICBuYW1lOiBgUnVsZSB2ZXJpZmljYXRpb24gJHtTdHJpbmcoY2hlY2suaWQpLnJlcGxhY2UoXG4gICAgICAgICAgICAgICAgXCJydWxlLXZlcmlmaWNhdGlvbi1cIixcbiAgICAgICAgICAgICAgICBcIiNcIixcbiAgICAgICAgICAgICAgKX1gLFxuICAgICAgICAgICAgICBraW5kOiBjaGVjay5raW5kID8/IFwib3BlcmF0b3JfYXR0ZXN0YXRpb25cIixcbiAgICAgICAgICAgICAgZ3VpZGFuY2U6IGNoZWNrLmd1aWRhbmNlLFxuICAgICAgICAgICAgICBwYXNzZWQsXG4gICAgICAgICAgICAgIC4uLihldmlkZW5jZSA/IHsgZXZpZGVuY2UgfSA6IHt9KSxcbiAgICAgICAgICAgICAgYWN0b3I6IFwiZTJlLW9wZXJhdG9yXCIsXG4gICAgICAgICAgICAgIHJlY29yZGVkQXQ6IGAyMDI2LTAxLTAxVDAwOjAke1xuICAgICAgICAgICAgICAgIChwcmlvclJlc3VsdC5oaXN0b3J5ID8/IFtdKS5sZW5ndGggKyAyXG4gICAgICAgICAgICAgIH06MDAuMDAwWmAsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIF0sXG4gICAgICAgIH07XG4gICAgICAgIGlmICh0YXNrLnJlbWVkaWF0aW9uUGxhbiAmJiBjb21wbGV0ZWQpIHtcbiAgICAgICAgICB0YXNrLnJlbWVkaWF0aW9uUGxhbiA9IHtcbiAgICAgICAgICAgIC4uLih0YXNrLnJlbWVkaWF0aW9uUGxhbiBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiksXG4gICAgICAgICAgICBzdGF0dXM6IFwidmVyaWZpZWRcIixcbiAgICAgICAgICB9O1xuICAgICAgICB9XG4gICAgICAgIHRhc2sudXBkYXRlZEF0ID0gXCIyMDI2LTAxLTAxVDAwOjA0OjAwLjAwMFpcIjtcbiAgICAgICAgaWYgKGNvbXBsZXRlZCkgdGFzay5jb21wbGV0ZWRBdCA9IHRhc2sudXBkYXRlZEF0O1xuICAgICAgICByZXR1cm4gcm91dGUuZnVsZmlsbChqc29uUmVzcG9uc2UodGFzaykpO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBhY3Rpb25NYXRjaCA9IHBhdGgubWF0Y2goL15cXC9hcGlcXC90YXNrc1xcLyhbXi9dKylcXC8oZXhlY3V0ZXxyZXRyeSkkLyk7XG4gICAgICBpZiAoYWN0aW9uTWF0Y2ggJiYgcm91dGUucmVxdWVzdCgpLm1ldGhvZCgpID09PSBcIlBPU1RcIikge1xuICAgICAgICBjb25zdCBbLCB0YXNrSWQsIGFjdGlvbl0gPSBhY3Rpb25NYXRjaDtcbiAgICAgICAgY29uc3QgdGFzayA9IG92ZXJyaWRlcy50YXNrQWN0aW9ucy50YXNrcy5maW5kKFxuICAgICAgICAgIChjYW5kaWRhdGUpID0+IGNhbmRpZGF0ZS5pZCA9PT0gdGFza0lkLFxuICAgICAgICApO1xuICAgICAgICBpZiAoIXRhc2spIHtcbiAgICAgICAgICByZXR1cm4gcm91dGUuZnVsZmlsbChqc29uUmVzcG9uc2UoeyBlcnJvcjogXCJUYXNrIG5vdCBmb3VuZFwiIH0sIDQwNCkpO1xuICAgICAgICB9XG5cbiAgICAgICAgb3ZlcnJpZGVzLnRhc2tBY3Rpb25zLnJlcXVlc3RzLnB1c2goYCR7YWN0aW9ufToke3Rhc2tJZH1gKTtcbiAgICAgICAgaWYgKGFjdGlvbiA9PT0gXCJleGVjdXRlXCIpIHtcbiAgICAgICAgICB0YXNrLnN0YXR1cyA9IFwicnVubmluZ1wiO1xuICAgICAgICAgIHRhc2sudXBkYXRlZEF0ID0gXCIyMDI2LTAxLTAxVDAwOjAyOjAwLjAwMFpcIjtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0YXNrLnN0YXR1cyA9IFwicXVldWVkXCI7XG4gICAgICAgICAgdGFzay5yZXRyeUNvdW50ID0gTnVtYmVyKHRhc2sucmV0cnlDb3VudCA/PyAwKSArIDE7XG4gICAgICAgICAgdGFzay51cGRhdGVkQXQgPSBcIjIwMjYtMDEtMDFUMDA6MDI6MDAuMDAwWlwiO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKGpzb25SZXNwb25zZSh0YXNrLCAyMDIpKTtcbiAgICAgIH1cbiAgICB9XG4gICAgaWYgKHBhdGggPT09IFwiL2FwaS90YXNrc1wiKSB7XG4gICAgICByZXR1cm4gcm91dGUuZnVsZmlsbChcbiAgICAgICAganNvblJlc3BvbnNlKFxuICAgICAgICAgIG92ZXJyaWRlcz8udGFza0FjdGlvbnM/LnRhc2tzID8/XG4gICAgICAgICAgICBvdmVycmlkZXM/LnJlY292ZXJ5VGFza3MgPz9cbiAgICAgICAgICAgIChvdmVycmlkZXM/LmxpdmVUYXNrXG4gICAgICAgICAgICAgID8gW1xuICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICBpZDogb3ZlcnJpZGVzLmxpdmVUYXNrLmlkLFxuICAgICAgICAgICAgICAgICAgICBwcm9qZWN0SWQ6IG92ZXJyaWRlcy5saXZlVGFzay5wcm9qZWN0SWQsXG4gICAgICAgICAgICAgICAgICAgIHRpdGxlOiBvdmVycmlkZXMubGl2ZVRhc2sudGl0bGUsXG4gICAgICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiBcIkEgdGFzayB1c2VkIHRvIHZlcmlmeSBsaXZlIGRhc2hib2FyZCB1cGRhdGVzLlwiLFxuICAgICAgICAgICAgICAgICAgICBzdGF0dXM6IFwicnVubmluZ1wiLFxuICAgICAgICAgICAgICAgICAgICBwcmlvcml0eTogXCJwMVwiLFxuICAgICAgICAgICAgICAgICAgICByZWxhdGVkRmlsZXM6IFtdLFxuICAgICAgICAgICAgICAgICAgICByZXRyeUNvdW50OiAwLFxuICAgICAgICAgICAgICAgICAgICBtYXhSZXRyaWVzOiAyLFxuICAgICAgICAgICAgICAgICAgICBjcmVhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMDowMC4wMDBaXCIsXG4gICAgICAgICAgICAgICAgICAgIHVwZGF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAwOjAxLjAwMFpcIixcbiAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgXVxuICAgICAgICAgICAgICA6IFtdKSxcbiAgICAgICAgKSxcbiAgICAgICk7XG4gICAgfVxuICAgIGlmIChwYXRoID09PSBcIi9hcGkvd29ya2Zsb3dzXCIpIHtcbiAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKFxuICAgICAgICBqc29uUmVzcG9uc2Uob3ZlcnJpZGVzPy5yZWNvdmVyeVdvcmtmbG93cyA/PyBbXSksXG4gICAgICApO1xuICAgIH1cbiAgICBjb25zdCB3b3JrZmxvd0V4ZWN1dGlvbnNNYXRjaCA9IHBhdGgubWF0Y2goXG4gICAgICAvXlxcL2FwaVxcL3dvcmtmbG93c1xcLyhbXi9dKylcXC9leGVjdXRpb25zJC8sXG4gICAgKTtcbiAgICBpZiAod29ya2Zsb3dFeGVjdXRpb25zTWF0Y2gpIHtcbiAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKFxuICAgICAgICBqc29uUmVzcG9uc2UoXG4gICAgICAgICAgb3ZlcnJpZGVzPy5yZWNvdmVyeVdvcmtmbG93RXhlY3V0aW9ucz8uW3dvcmtmbG93RXhlY3V0aW9uc01hdGNoWzFdXSA/P1xuICAgICAgICAgICAgW10sXG4gICAgICAgICksXG4gICAgICApO1xuICAgIH1cbiAgICBpZiAoXG4gICAgICBvdmVycmlkZXM/LmF1ZGl0RXhwb3J0ICYmXG4gICAgICBwYXRoID09PSBgL2FwaS9haS9leGVjdXRpb25zLyR7RVhFQ1VUSU9OX0lEfS9hdWRpdC1leHBvcnRgXG4gICAgKSB7XG4gICAgICBvdmVycmlkZXMuYXVkaXRFeHBvcnQucmVxdWVzdHMucHVzaChyb3V0ZS5yZXF1ZXN0KCkudXJsKCkpO1xuICAgICAgaWYgKFxuICAgICAgICBvdmVycmlkZXMuYXVkaXRFeHBvcnQuZmFpbEZpcnN0UHJldmlldyAmJlxuICAgICAgICBvdmVycmlkZXMuYXVkaXRFeHBvcnQucmVxdWVzdHMubGVuZ3RoID09PSAxXG4gICAgICApIHtcbiAgICAgICAgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoXG4gICAgICAgICAganNvblJlc3BvbnNlKFxuICAgICAgICAgICAgeyBlcnJvcjogXCJUZW1wb3JhcnkgcHJldmlldyBuZXR3b3JrIGZhaWx1cmUuXCIgfSxcbiAgICAgICAgICAgIDUwMyxcbiAgICAgICAgICApLFxuICAgICAgICApO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoXG4gICAgICAgIGpzb25SZXNwb25zZShvdmVycmlkZXMuYXVkaXRFeHBvcnQuYm9keSwgMjAwLCB7XG4gICAgICAgICAgXCJDb250ZW50LURpc3Bvc2l0aW9uXCI6IGBhdHRhY2htZW50OyBmaWxlbmFtZT1cIiR7b3ZlcnJpZGVzLmF1ZGl0RXhwb3J0LmZpbGVuYW1lfVwiYCxcbiAgICAgICAgfSksXG4gICAgICApO1xuICAgIH1cbiAgICBpZiAob3ZlcnJpZGVzPy5hcmNoaXZlVXBsb2FkICYmIHBhdGggPT09IFwiL2FwaS91cGxvYWQvYXJjaGl2ZVwiKSB7XG4gICAgICBjb25zdCBjb250ZW50VHlwZSA9IHJvdXRlLnJlcXVlc3QoKS5oZWFkZXJzKClbXCJjb250ZW50LXR5cGVcIl0gPz8gXCJcIjtcbiAgICAgIGlmICghY29udGVudFR5cGUuc3RhcnRzV2l0aChcIm11bHRpcGFydC9mb3JtLWRhdGE7XCIpKSB7XG4gICAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKFxuICAgICAgICAgIGpzb25SZXNwb25zZSh7IGVycm9yOiBcIkV4cGVjdGVkIG11bHRpcGFydCBhcmNoaXZlIHVwbG9hZC5cIiB9LCA0MDApLFxuICAgICAgICApO1xuICAgICAgfVxuICAgICAgY29uc3QgYm9keSA9IHJvdXRlLnJlcXVlc3QoKS5wb3N0RGF0YUJ1ZmZlcigpO1xuICAgICAgaWYgKCFib2R5Py5pbmNsdWRlcyhCdWZmZXIuZnJvbShcImRhc2hib2FyZC1qb3VybmV5LnppcFwiKSkpIHtcbiAgICAgICAgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoXG4gICAgICAgICAganNvblJlc3BvbnNlKHsgZXJyb3I6IFwiRXhwZWN0ZWQgdGhlIGpvdXJuZXkgYXJjaGl2ZSBwYXlsb2FkLlwiIH0sIDQwMCksXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgICByZXR1cm4gcm91dGUuZnVsZmlsbChcbiAgICAgICAganNvblJlc3BvbnNlKFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIHVwbG9hZElkOiBvdmVycmlkZXMuYXJjaGl2ZVVwbG9hZC51cGxvYWRJZCxcbiAgICAgICAgICAgIG9yaWdpbmFsTmFtZTogb3ZlcnJpZGVzLmFyY2hpdmVVcGxvYWQub3JpZ2luYWxOYW1lLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgMjAxLFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIFwiYWNjZXNzLWNvbnRyb2wtYWxsb3ctb3JpZ2luXCI6IG5ldyBVUkwocGFnZS51cmwoKSkub3JpZ2luLFxuICAgICAgICAgICAgXCJhY2Nlc3MtY29udHJvbC1hbGxvdy1jcmVkZW50aWFsc1wiOiBcInRydWVcIixcbiAgICAgICAgICB9LFxuICAgICAgICApLFxuICAgICAgKTtcbiAgICB9XG4gICAgaWYgKG92ZXJyaWRlcz8ubGl2ZVRhc2sgJiYgcGF0aCA9PT0gXCIvYXBpL3Rhc2tzXCIpIHtcbiAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKFxuICAgICAgICBqc29uUmVzcG9uc2UoW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIGlkOiBvdmVycmlkZXMubGl2ZVRhc2suaWQsXG4gICAgICAgICAgICBwcm9qZWN0SWQ6IG92ZXJyaWRlcy5saXZlVGFzay5wcm9qZWN0SWQsXG4gICAgICAgICAgICB0aXRsZTogb3ZlcnJpZGVzLmxpdmVUYXNrLnRpdGxlLFxuICAgICAgICAgICAgZGVzY3JpcHRpb246IFwiQSB0YXNrIHVzZWQgdG8gdmVyaWZ5IGxpdmUgZGFzaGJvYXJkIHVwZGF0ZXMuXCIsXG4gICAgICAgICAgICBzdGF0dXM6IFwicnVubmluZ1wiLFxuICAgICAgICAgICAgcGhhc2U6IFwiRXhlY3V0aW9uXCIsXG4gICAgICAgICAgICByZWxhdGVkRmlsZXM6IFtdLFxuICAgICAgICAgICAgcmV0cnlDb3VudDogMCxcbiAgICAgICAgICAgIG1heFJldHJpZXM6IDIsXG4gICAgICAgICAgICBjcmVhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMDowMC4wMDBaXCIsXG4gICAgICAgICAgICB1cGRhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMDowMS4wMDBaXCIsXG4gICAgICAgICAgfSxcbiAgICAgICAgXSksXG4gICAgICApO1xuICAgIH1cbiAgICBpZiAoXG4gICAgICBvdmVycmlkZXM/LmxpdmVUYXNrICYmXG4gICAgICBwYXRoID09PSBgL2FwaS90YXNrcy8ke292ZXJyaWRlcy5saXZlVGFzay5pZH0vbG9nc2BcbiAgICApIHtcbiAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKGpzb25SZXNwb25zZShvdmVycmlkZXMubGl2ZVRhc2suaW5pdGlhbExvZ3MgPz8gW10pKTtcbiAgICB9XG4gICAgaWYgKFxuICAgICAgb3ZlcnJpZGVzPy5saXZlVGFzayAmJlxuICAgICAgcGF0aCA9PT0gYC9hcGkvdGFza3MvJHtvdmVycmlkZXMubGl2ZVRhc2suaWR9L2xvZ3Mvc3RyZWFtYFxuICAgICkge1xuICAgICAgY29uc3Qgc3RyZWFtUmVxdWVzdHMgPSBvdmVycmlkZXMubGl2ZVRhc2suc3RyZWFtUmVxdWVzdHM7XG4gICAgICBzdHJlYW1SZXF1ZXN0cz8ucHVzaChyb3V0ZS5yZXF1ZXN0KCkudXJsKCkpO1xuICAgICAgaWYgKFxuICAgICAgICAob3ZlcnJpZGVzLmxpdmVUYXNrLmZhaWxGaXJzdFN0cmVhbSAmJiBzdHJlYW1SZXF1ZXN0cz8ubGVuZ3RoID09PSAxKSB8fFxuICAgICAgICAob3ZlcnJpZGVzLmxpdmVUYXNrLmZhaWxTdHJlYW1BdHRlbXB0cyAmJlxuICAgICAgICAgIHN0cmVhbVJlcXVlc3RzICYmXG4gICAgICAgICAgc3RyZWFtUmVxdWVzdHMubGVuZ3RoIDw9IG92ZXJyaWRlcy5saXZlVGFzay5mYWlsU3RyZWFtQXR0ZW1wdHMpXG4gICAgICApIHtcbiAgICAgICAgLy8gRXhlcmNpc2UgdGhlIGJyb3dzZXIncyByZWNvbm5lY3QgcGF0aCB3aXRob3V0IGNoYW5naW5nIHRoZSB0YXNrXG4gICAgICAgIC8vIGxpZmVjeWNsZSBvciBzeW50aGVzaXppbmcgYSBzdWNjZXNzZnVsIHJlc3BvbnNlIGZvciB0aGUgZmlyc3QgdHJ5LlxuICAgICAgICByZXR1cm4gcm91dGUuYWJvcnQoXCJjb25uZWN0aW9ucmVzZXRcIik7XG4gICAgICB9XG4gICAgICByZXR1cm4gcm91dGUuZnVsZmlsbCh7XG4gICAgICAgIHN0YXR1czogMjAwLFxuICAgICAgICBjb250ZW50VHlwZTogXCJ0ZXh0L2V2ZW50LXN0cmVhbVwiLFxuICAgICAgICBoZWFkZXJzOiB7XG4gICAgICAgICAgXCJDYWNoZS1Db250cm9sXCI6IFwibm8tY2FjaGVcIixcbiAgICAgICAgICBcImFjY2Vzcy1jb250cm9sLWFsbG93LW9yaWdpblwiOiBuZXcgVVJMKHBhZ2UudXJsKCkpLm9yaWdpbixcbiAgICAgICAgICBcImFjY2Vzcy1jb250cm9sLWFsbG93LWNyZWRlbnRpYWxzXCI6IFwidHJ1ZVwiLFxuICAgICAgICB9LFxuICAgICAgICBib2R5OiBgZXZlbnQ6IGxvZ1xcbmRhdGE6ICR7SlNPTi5zdHJpbmdpZnkob3ZlcnJpZGVzLmxpdmVUYXNrLmxvZyl9XFxuXFxuYCxcbiAgICAgIH0pO1xuICAgIH1cbiAgICBpZiAocGF0aCA9PT0gXCIvYXBpL3Byb2plY3RzXCIpIHtcbiAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKFxuICAgICAgICBqc29uUmVzcG9uc2UoXG4gICAgICAgICAgb3ZlcnJpZGVzPy5wcm9qZWN0cyA/PyBbXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIGlkOiBcImUyZS1wcm9qZWN0XCIsXG4gICAgICAgICAgICAgIG5hbWU6IFwiU21va2UgUHJvamVjdFwiLFxuICAgICAgICAgICAgICBsYW5ndWFnZTogXCJUeXBlU2NyaXB0XCIsXG4gICAgICAgICAgICAgIGZyYW1ld29yazogXCJSZWFjdFwiLFxuICAgICAgICAgICAgICBzdGF0dXM6IFwiYWN0aXZlXCIsXG4gICAgICAgICAgICAgIHJvb3RQYXRoOiBcIi9jb250cm9sbGVkL3Ntb2tlXCIsXG4gICAgICAgICAgICAgIHF1YWxpdHlTY29yZTogOTIsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIF0sXG4gICAgICAgICksXG4gICAgICApO1xuICAgIH1cbiAgICBpZiAocGF0aCA9PT0gXCIvYXBpL3JlYWRpbmVzc1wiKSB7XG4gICAgICByZXR1cm4gcm91dGUuZnVsZmlsbChcbiAgICAgICAganNvblJlc3BvbnNlKHtcbiAgICAgICAgICBzdGF0dXM6IFwicmVhZHlcIixcbiAgICAgICAgICBjaGVja3M6IHtcbiAgICAgICAgICAgIGFwaTogeyBzdGF0dXM6IFwicmVhZHlcIiB9LFxuICAgICAgICAgICAgZGF0YWJhc2U6IHsgc3RhdHVzOiBcInJlYWR5XCIgfSxcbiAgICAgICAgICAgIHNjaGVtYTogeyBzdGF0dXM6IFwicmVhZHlcIiB9LFxuICAgICAgICAgIH0sXG4gICAgICAgIH0pLFxuICAgICAgKTtcbiAgICB9XG4gICAgaWYgKGhhc0NvbmZpZ3VyZWRBaUZpeHR1cmUgJiYgcGF0aCA9PT0gXCIvYXBpL2FpL2FjdGl2ZS1wcm92aWRlclwiKSB7XG4gICAgICByZXR1cm4gcm91dGUuZnVsZmlsbChcbiAgICAgICAganNvblJlc3BvbnNlKHsgcHJvdmlkZXI6IFwib3BlbnJvdXRlclwiLCBjb25maWd1cmVkOiB0cnVlIH0pLFxuICAgICAgKTtcbiAgICB9XG4gICAgaWYgKFxuICAgICAgb3ZlcnJpZGVzPy5kZWxpdmVyeVJlY292ZXJ5ICYmXG4gICAgICBwYXRoID09PSBcIi9hcGkvYWkvZGVsaXZlcnkvcmVjb3ZlcmFibGVcIlxuICAgICkge1xuICAgICAgb3ZlcnJpZGVzLmRlbGl2ZXJ5UmVjb3ZlcnkucmVxdWVzdHMucHVzaChyb3V0ZS5yZXF1ZXN0KCkudXJsKCkpO1xuICAgICAgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoXG4gICAgICAgIGpzb25SZXNwb25zZSh7IG9wZXJhdGlvbnM6IG92ZXJyaWRlcy5kZWxpdmVyeVJlY292ZXJ5Lm9wZXJhdGlvbnMgfSksXG4gICAgICApO1xuICAgIH1cbiAgICBpZiAoXG4gICAgICBvdmVycmlkZXM/LmRlbGl2ZXJ5UmVjb3Zlcnk/LnJlY292ZXJ5QWN0aW9uICYmXG4gICAgICBwYXRoID09PVxuICAgICAgICBgL2FwaS9haS9kZWxpdmVyeS8ke292ZXJyaWRlcy5kZWxpdmVyeVJlY292ZXJ5LnJlY292ZXJ5QWN0aW9uLnByb3Bvc2FsSWR9LyR7b3ZlcnJpZGVzLmRlbGl2ZXJ5UmVjb3ZlcnkucmVjb3ZlcnlBY3Rpb24uYWN0aW9ufWBcbiAgICApIHtcbiAgICAgIG92ZXJyaWRlcy5kZWxpdmVyeVJlY292ZXJ5LmFjdGlvblJlcXVlc3RzPy5wdXNoKHJvdXRlLnJlcXVlc3QoKS51cmwoKSk7XG4gICAgICBpZiAob3ZlcnJpZGVzLmRlbGl2ZXJ5UmVjb3ZlcnkucmVjb3ZlcnlBY3Rpb24ubmV4dE9wZXJhdGlvbnMpIHtcbiAgICAgICAgb3ZlcnJpZGVzLmRlbGl2ZXJ5UmVjb3Zlcnkub3BlcmF0aW9ucyA9XG4gICAgICAgICAgb3ZlcnJpZGVzLmRlbGl2ZXJ5UmVjb3ZlcnkucmVjb3ZlcnlBY3Rpb24ubmV4dE9wZXJhdGlvbnM7XG4gICAgICB9XG4gICAgICByZXR1cm4gcm91dGUuZnVsZmlsbChcbiAgICAgICAganNvblJlc3BvbnNlKFxuICAgICAgICAgIG92ZXJyaWRlcy5kZWxpdmVyeVJlY292ZXJ5LnJlY292ZXJ5QWN0aW9uLnJlc3BvbnNlLFxuICAgICAgICAgIG92ZXJyaWRlcy5kZWxpdmVyeVJlY292ZXJ5LnJlY292ZXJ5QWN0aW9uLnN0YXR1cyA/PyA0MDksXG4gICAgICAgICksXG4gICAgICApO1xuICAgIH1cbiAgICBpZiAocGF0aCA9PT0gXCIvYXBpL2V2ZW50c1wiKSB7XG4gICAgICBjb25zdCBldmVudHMgPSBvdmVycmlkZXM/LmV2ZW50cyA/PyBkYXNoYm9hcmRGaXh0dXJlLnJlY2VudEV2ZW50cztcbiAgICAgIGNvbnN0IHNlYXJjaCA9IHVybC5zZWFyY2hQYXJhbXMuZ2V0KFwic2VhcmNoXCIpPy50b0xvd2VyQ2FzZSgpO1xuICAgICAgY29uc3QgZmlsdGVyZWRFdmVudHMgPSBldmVudHMuZmlsdGVyKChldmVudCkgPT4ge1xuICAgICAgICBjb25zdCBwcm9qZWN0SWQgPSB1cmwuc2VhcmNoUGFyYW1zLmdldChcInByb2plY3RJZFwiKTtcbiAgICAgICAgY29uc3Qgc2V2ZXJpdHkgPSB1cmwuc2VhcmNoUGFyYW1zLmdldChcInNldmVyaXR5XCIpO1xuICAgICAgICBjb25zdCBjb3JyZWxhdGlvbklkID0gdXJsLnNlYXJjaFBhcmFtcy5nZXQoXCJjb3JyZWxhdGlvbklkXCIpO1xuICAgICAgICByZXR1cm4gKFxuICAgICAgICAgICghcHJvamVjdElkIHx8IGV2ZW50LnByb2plY3RJZCA9PT0gcHJvamVjdElkKSAmJlxuICAgICAgICAgICghc2V2ZXJpdHkgfHwgZXZlbnQuc2V2ZXJpdHkgPT09IHNldmVyaXR5KSAmJlxuICAgICAgICAgICghY29ycmVsYXRpb25JZCB8fCBldmVudC5jb3JyZWxhdGlvbklkID09PSBjb3JyZWxhdGlvbklkKSAmJlxuICAgICAgICAgICghc2VhcmNoIHx8XG4gICAgICAgICAgICBbZXZlbnQubWVzc2FnZSwgZXZlbnQudHlwZSwgZXZlbnQuY29ycmVsYXRpb25JZF1cbiAgICAgICAgICAgICAgLmZpbHRlcigodmFsdWUpOiB2YWx1ZSBpcyBzdHJpbmcgPT4gdHlwZW9mIHZhbHVlID09PSBcInN0cmluZ1wiKVxuICAgICAgICAgICAgICAuc29tZSgodmFsdWUpID0+IHZhbHVlLnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMoc2VhcmNoKSkpXG4gICAgICAgICk7XG4gICAgICB9KTtcbiAgICAgIGNvbnN0IGxpbWl0ID0gTnVtYmVyKHVybC5zZWFyY2hQYXJhbXMuZ2V0KFwibGltaXRcIikpIHx8IDUwO1xuICAgICAgY29uc3QgcGFnZSA9IE51bWJlcih1cmwuc2VhcmNoUGFyYW1zLmdldChcInBhZ2VcIikpIHx8IDE7XG4gICAgICByZXR1cm4gcm91dGUuZnVsZmlsbChcbiAgICAgICAganNvblJlc3BvbnNlKHtcbiAgICAgICAgICBldmVudHM6IGZpbHRlcmVkRXZlbnRzLnNsaWNlKChwYWdlIC0gMSkgKiBsaW1pdCwgcGFnZSAqIGxpbWl0KSxcbiAgICAgICAgICB0b3RhbDogZmlsdGVyZWRFdmVudHMubGVuZ3RoLFxuICAgICAgICB9KSxcbiAgICAgICk7XG4gICAgfVxuICAgIGlmIChcbiAgICAgIG92ZXJyaWRlcz8ucmVzdW1lRmFpbHVyZSAmJlxuICAgICAgcGF0aCA9PT1cbiAgICAgICAgYC9hcGkvYWkvZXhlY3V0aW9ucy8ke292ZXJyaWRlcy5yZXN1bWVGYWlsdXJlLmZpeHR1cmUuZXhlY3V0aW9uSWR9YFxuICAgICkge1xuICAgICAgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoanNvblJlc3BvbnNlKG92ZXJyaWRlcy5yZXN1bWVGYWlsdXJlLmV4ZWN1dGlvbikpO1xuICAgIH1cbiAgICBpZiAoXG4gICAgICBvdmVycmlkZXM/LmludGVycnVwdGVkUmVzdW1lICYmXG4gICAgICBwYXRoID09PVxuICAgICAgICBgL2FwaS9haS9leGVjdXRpb25zLyR7b3ZlcnJpZGVzLmludGVycnVwdGVkUmVzdW1lLmZpeHR1cmUuZXhlY3V0aW9uSWR9YFxuICAgICkge1xuICAgICAgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoanNvblJlc3BvbnNlKG92ZXJyaWRlcy5pbnRlcnJ1cHRlZFJlc3VtZS5leGVjdXRpb24pKTtcbiAgICB9XG4gICAgaWYgKFxuICAgICAgb3ZlcnJpZGVzPy5pbnRlcnJ1cHRlZFJlc3VtZSAmJlxuICAgICAgcGF0aCA9PT1cbiAgICAgICAgYC9hcGkvYWkvZXhlY3V0aW9ucy8ke292ZXJyaWRlcy5pbnRlcnJ1cHRlZFJlc3VtZS5maXh0dXJlLmV4ZWN1dGlvbklkfS9yZXN1bWUtY2FwYWJpbGl0eWBcbiAgICApIHtcbiAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKFxuICAgICAgICBqc29uUmVzcG9uc2Uoe1xuICAgICAgICAgIGV4ZWN1dGlvbklkOiBvdmVycmlkZXMuaW50ZXJydXB0ZWRSZXN1bWUuZml4dHVyZS5leGVjdXRpb25JZCxcbiAgICAgICAgICByZXN1bWVUb2tlbjogb3ZlcnJpZGVzLmludGVycnVwdGVkUmVzdW1lLnJlY292ZXJlZFRva2VuLFxuICAgICAgICB9KSxcbiAgICAgICk7XG4gICAgfVxuICAgIGlmIChwYXRoID09PSBgL2FwaS9haS9leGVjdXRpb25zLyR7RVhFQ1VUSU9OX0lEfWApXG4gICAgICByZXR1cm4gcm91dGUuZnVsZmlsbChcbiAgICAgICAganNvblJlc3BvbnNlKG92ZXJyaWRlcz8uYXVkaXRFeHBvcnQ/LmV4ZWN1dGlvbiA/PyBleGVjdXRpb25GaXh0dXJlKSxcbiAgICAgICk7XG4gICAgaWYgKHBhdGggPT09IFwiL2FwaS9haS9taXNzaW9uLWNvbnRyb2xcIilcbiAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKFxuICAgICAgICBqc29uUmVzcG9uc2UoeyB1cGRhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMTowMC4wMDBaXCIsIGV4ZWN1dGlvbnM6IFtdIH0pLFxuICAgICAgKTtcblxuICAgIC8vIEFJIGlzIGRlbGliZXJhdGVseSBub3QgZXhlY3V0ZWQgaW4gdGhpcyBzbW9rZSBqb3VybmV5LiBUaGlzIHJlc3BvbnNlXG4gICAgLy8gdmVyaWZpZXMgdGhlIHVzZXItdmlzaWJsZSB1bmF2YWlsYWJsZS9lbXB0eSBzdGF0ZSB3aXRob3V0IGEgcHJvdmlkZXIuXG4gICAgaWYgKHBhdGguc3RhcnRzV2l0aChcIi9hcGkvYWkvXCIpKVxuICAgICAgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoXG4gICAgICAgIGpzb25SZXNwb25zZSh7IGVycm9yOiBcIkFJIHByb3ZpZGVyIG5vdCBjb25maWd1cmVkXCIgfSwgNDI4KSxcbiAgICAgICk7XG5cbiAgICByZXR1cm4gcm91dGUuY29udGludWUoKTtcbiAgfSk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGluc3RhbGxBcmFiaWNBaUZpeHR1cmUoXG4gIHBhZ2U6IFBhZ2UsXG4gIG9wdGlvbnM/OiB7XG4gICAgYmxvY2tlZD86IGJvb2xlYW47XG4gICAgc2Vzc2lvbklkPzogc3RyaW5nO1xuICAgIHF1ZXN0aW9uPzogc3RyaW5nO1xuICAgIHByb2plY3RJZD86IHN0cmluZztcbiAgfSxcbikge1xuICBjb25zdCBzZXNzaW9uSWQgPSBvcHRpb25zPy5zZXNzaW9uSWQgPz8gXCJlMmUtYXJhYmljLWFpLXNlc3Npb25cIjtcbiAgY29uc3QgbWVzc2FnZUlkID0gXCJlMmUtYXJhYmljLWFpLW1lc3NhZ2VcIjtcbiAgY29uc3Qgc291cmNlID0gXCJzcmMvZXhlY3V0aW9uLXRvb2xzLnRzXCI7XG4gIGNvbnN0IGJsb2NrZWQgPSBvcHRpb25zPy5ibG9ja2VkID09PSB0cnVlO1xuICBjb25zdCBxdWVzdGlvbiA9XG4gICAgb3B0aW9ucz8ucXVlc3Rpb24gPz9cbiAgICBcItmF2KfYsNinINmK2K3Yr9irINi52YbYryDYp9mG2KrZh9in2KEg2YXZh9mE2KkgcHJvdmlkZXIgdGltZW91dCDYr9in2K7ZhCBleGVjdXRpb24tdG9vbHMudHPYn1wiO1xuICBjb25zdCBhbnN3ZXIgPVxuICAgIFwi2LnZhtivINin2YbYqtmH2KfYoSDZhdmH2YTYqSDZhdiy2YjYryDYp9mE2LDZg9in2KEg2KfZhNin2LXYt9mG2KfYudmK2Iwg2YrYudmK2K8g2KfZhNmF2LPYp9ixINiq2YLYsdmK2LHZi9inINis2LLYptmK2YvYpyDZhdmGINin2YTYo9iv2YTYqSDYp9mE2KrZiiDYrNmP2YXYudiqINio2K/ZhCDYpdi12K/Yp9ixIEZpbmRpbmcg2LrZitixINmF2KvYqNiqLlwiO1xuICBjb25zdCBldmlkZW5jZSA9IFtcbiAgICB7XG4gICAgICBzb3VyY2UsXG4gICAgICAuLi4oYmxvY2tlZFxuICAgICAgICA/IHtcbiAgICAgICAgICAgIGV4Y2VycHQ6IFwicHJvdmlkZXIgdGltZW91dCBpcyBoYW5kbGVkIGhlcmVcIixcbiAgICAgICAgICAgIHN1cHBvcnRzQ2xhaW06IGZhbHNlLFxuICAgICAgICAgICAgZXZpZGVuY2VDbGFzczogXCJSRUFEX0NPTkZJUk1FRFwiLFxuICAgICAgICAgICAgY2l0YXRpb25TdGF0dXM6IFwiQkxPQ0tFRFwiLFxuICAgICAgICAgICAgY2l0YXRpb25SZWFzb246IFwiTUlTU0lOR19MSVRFUkFMX01BVENIXCIsXG4gICAgICAgICAgfVxuICAgICAgICA6IHtcbiAgICAgICAgICAgIGV4Y2VycHQ6ICdyZXR1cm4gcGFydGlhbEZyb21Db2xsZWN0ZWRFdmlkZW5jZShcInByb3ZpZGVyIHRpbWVvdXRcIik7JyxcbiAgICAgICAgICAgIHNvdXJjZVNwYW46IHsgc3RhcnRMaW5lOiA0MiwgZW5kTGluZTogNDIgfSxcbiAgICAgICAgICAgIHN1cHBvcnRzQ2xhaW06IHRydWUsXG4gICAgICAgICAgICBldmlkZW5jZUNsYXNzOiBcIkJFSEFWSU9SX1BST1ZFTlwiLFxuICAgICAgICAgICAgY2l0YXRpb25TdGF0dXM6IFwiQUNDRVBURURcIixcbiAgICAgICAgICAgIGNpdGF0aW9uUmVhc29uOiBcIkFDQ0VQVEVEX1NPVVJDRV9TUEFOXCIsXG4gICAgICAgICAgfSksXG4gICAgfSxcbiAgXTtcbiAgY29uc3QgdG9vbFRyYWNlID0gW1xuICAgIHtcbiAgICAgIGtpbmQ6IFwidG9vbF9jYWxsXCIsXG4gICAgICB0b29sOiBcInJlYWRfZmlsZVwiLFxuICAgICAgYXJnczogeyBwYXRoOiBzb3VyY2UgfSxcbiAgICAgIGNhY2hlZDogZmFsc2UsXG4gICAgICBwcmVmZXRjaGVkOiB0cnVlLFxuICAgIH0sXG4gICAge1xuICAgICAga2luZDogXCJ0b29sX3Jlc3VsdFwiLFxuICAgICAgdG9vbDogXCJyZWFkX2ZpbGVcIixcbiAgICAgIHNvdXJjZSxcbiAgICAgIGNhY2hlZDogZmFsc2UsXG4gICAgICBwcmVmZXRjaGVkOiB0cnVlLFxuICAgIH0sXG4gICAge1xuICAgICAga2luZDogXCJldmlkZW5jZV9pbnRlZ3JpdHlcIixcbiAgICAgIGNvZGU6IFwiRVZJREVOQ0VfSU5URUdSSVRZX09LXCIsXG4gICAgICBjb25zaXN0ZW50OiB0cnVlLFxuICAgICAgdmlvbGF0aW9uczogW10sXG4gICAgICBldmlkZW5jZUZpbGVDb3VudDogMSxcbiAgICAgIGFjY2VwdGVkRXZpZGVuY2VDb3VudDogMSxcbiAgICAgIGNvbXBsZXRlZFJlYWRGaWxlczogW3NvdXJjZV0sXG4gICAgICBhY2NlcHRlZEV2aWRlbmNlRmlsZXM6IFtzb3VyY2VdLFxuICAgICAgb2JqZWN0aXZlVHlwZTogXCJQUk9EVUNUSU9OX1JFQUNIQUJJTElUWVwiLFxuICAgICAgcmVxdWlyZWRFZGdlczogW1wiY2xpZW50LT5zZXJ2ZXJcIiwgXCJzZXJ2ZXItPmRhdGFiYXNlXCJdLFxuICAgICAgcHJvdmVuRWRnZXM6IFtcImNsaWVudC0+c2VydmVyXCJdLFxuICAgICAgY29tcGxldGlvbkdhdGVSZXN1bHQ6IFwiUEFSVElBTExZX1BST1ZFTlwiLFxuICAgICAgZmluYWxBbnN3ZXJUeXBlOiBcIlBST0RVQ1RJT05fUkVBQ0hBQklMSVRZX0FOU1dFUlwiLFxuICAgIH0sXG4gIF07XG4gIGNvbnN0IHRhc2tSZXN1bHQgPSB7XG4gICAga2luZDogXCJCRUhBVklPUl9BTlNXRVJfUkVTVUxUXCIsXG4gICAgYW5zd2VyOiB7XG4gICAgICBhbnN3ZXIsXG4gICAgICBldmlkZW5jZSxcbiAgICAgIGNvbmZpZGVuY2U6IDEsXG4gICAgICBzb3VyY2VTY29wZTogW3NvdXJjZV0sXG4gICAgICBjb3ZlcmFnZToge1xuICAgICAgICByZXF1ZXN0ZWRGaWVsZHM6IFtcInRpbWVvdXQgYmVoYXZpb3JcIl0sXG4gICAgICAgIGFuc3dlcmVkRmllbGRzOiBbXCJ0aW1lb3V0IGJlaGF2aW9yXCJdLFxuICAgICAgICBtaXNzaW5nRmllbGRzOiBbXSxcbiAgICAgICAgY29tcGxldGU6IHRydWUsXG4gICAgICB9LFxuICAgIH0sXG4gIH07XG4gIGNvbnN0IG1lc3NhZ2UgPSB7XG4gICAgaWQ6IG1lc3NhZ2VJZCxcbiAgICBzZXNzaW9uSWQsXG4gICAgcm9sZTogXCJhc3Npc3RhbnRcIixcbiAgICBjb250ZW50OiBgJHthbnN3ZXJ9XFxuXFxuIyMgNikgRmluYWwgSnVkZ21lbnRcXG5OT1QgUFJPVkVOYCxcbiAgICBvcGVyYXRpb25Nb2RlOiBcIkZPUkVOU0lDX0FVRElUXCIsXG4gICAgc291cmNlczogW3NvdXJjZV0sXG4gICAgdG9vbFRyYWNlOiBKU09OLnN0cmluZ2lmeSh0b29sVHJhY2UpLFxuICAgIGJlaGF2aW9yRXZpZGVuY2U6IGV2aWRlbmNlLFxuICAgIHRhc2tSZXN1bHQsXG4gICAgY3JlYXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDI6MDAuMDAwWlwiLFxuICB9O1xuICBjb25zdCBzc2UgPSAoZXZlbnQ6IFJlY29yZDxzdHJpbmcsIHVua25vd24+KSA9PlxuICAgIGBkYXRhOiAke0pTT04uc3RyaW5naWZ5KGV2ZW50KX1cXG5cXG5gO1xuICBjb25zdCBzdHJlYW1Cb2R5ID0gW1xuICAgIHNzZSh7IHR5cGU6IFwic2Vzc2lvbl9zdGFydGVkXCIsIHNlc3Npb25JZCB9KSxcbiAgICBzc2Uoe1xuICAgICAgdHlwZTogXCJleGVjdXRpb25fc3RhcnRlZFwiLFxuICAgICAgZXhlY3V0aW9uSWQ6IFwiZTJlLWV4ZWN1dGlvblwiLFxuICAgICAgc3RhdHVzOiBcInJ1bm5pbmdcIixcbiAgICAgIHJlc3VtYWJsZTogdHJ1ZSxcbiAgICB9KSxcbiAgICBzc2UoeyB0eXBlOiBcInN0YWdlXCIsIHN0YWdlOiBcImJ1aWxkaW5nLWNvbnRleHRcIiB9KSxcbiAgICBzc2UoeyB0eXBlOiBcInN0YWdlXCIsIHN0YWdlOiBcImNhbGxpbmctbW9kZWxcIiB9KSxcbiAgICBzc2Uoe1xuICAgICAgdHlwZTogXCJ0b29sX2NhbGxcIixcbiAgICAgIHRvb2w6IFwicmVhZF9maWxlXCIsXG4gICAgICBhcmdzOiB7IHBhdGg6IHNvdXJjZSB9LFxuICAgICAgY2FjaGVkOiBmYWxzZSxcbiAgICAgIHByZWZldGNoZWQ6IHRydWUsXG4gICAgfSksXG4gICAgc3NlKHtcbiAgICAgIHR5cGU6IFwidG9vbF9yZXN1bHRcIixcbiAgICAgIHRvb2w6IFwicmVhZF9maWxlXCIsXG4gICAgICBzb3VyY2UsXG4gICAgICBjYWNoZWQ6IGZhbHNlLFxuICAgICAgcHJlZmV0Y2hlZDogdHJ1ZSxcbiAgICB9KSxcbiAgICBzc2Uoe1xuICAgICAgdHlwZTogXCJldmlkZW5jZV9pbnRlZ3JpdHlcIixcbiAgICAgIGNvZGU6IFwiRVZJREVOQ0VfSU5URUdSSVRZX09LXCIsXG4gICAgICBjb25zaXN0ZW50OiB0cnVlLFxuICAgICAgdmlvbGF0aW9uczogW10sXG4gICAgICBldmlkZW5jZUZpbGVDb3VudDogMSxcbiAgICAgIGFjY2VwdGVkRXZpZGVuY2VDb3VudDogMSxcbiAgICAgIGNvbXBsZXRlZFJlYWRGaWxlczogW3NvdXJjZV0sXG4gICAgICBhY2NlcHRlZEV2aWRlbmNlRmlsZXM6IFtzb3VyY2VdLFxuICAgICAgb2JqZWN0aXZlVHlwZTogXCJQUk9EVUNUSU9OX1JFQUNIQUJJTElUWVwiLFxuICAgICAgcmVxdWlyZWRFZGdlczogW1wiY2xpZW50LT5zZXJ2ZXJcIiwgXCJzZXJ2ZXItPmRhdGFiYXNlXCJdLFxuICAgICAgcHJvdmVuRWRnZXM6IFtcImNsaWVudC0+c2VydmVyXCJdLFxuICAgICAgY29tcGxldGlvbkdhdGVSZXN1bHQ6IFwiUEFSVElBTExZX1BST1ZFTlwiLFxuICAgICAgZmluYWxBbnN3ZXJUeXBlOiBcIlBST0RVQ1RJT05fUkVBQ0hBQklMSVRZX0FOU1dFUlwiLFxuICAgIH0pLFxuICAgIHNzZSh7IHR5cGU6IFwiZGVsdGFcIiwgZGVsdGE6IGFuc3dlciB9KSxcbiAgICBzc2Uoe1xuICAgICAgdHlwZTogXCJkb25lXCIsXG4gICAgICBzZXNzaW9uSWQsXG4gICAgICBtZXNzYWdlLFxuICAgICAgc291cmNlczogW3NvdXJjZV0sXG4gICAgICB0b29sVHJhY2U6IEpTT04uc3RyaW5naWZ5KHRvb2xUcmFjZSksXG4gICAgICBiZWhhdmlvckV2aWRlbmNlOiBldmlkZW5jZSxcbiAgICAgIHRhc2tSZXN1bHQsXG4gICAgICBwZW5kaW5nQ2hhbmdlczogW10sXG4gICAgfSksXG4gIF0uam9pbihcIlwiKTtcblxuICByZXR1cm4ge1xuICAgIHF1ZXN0aW9uLFxuICAgIGFuc3dlcixcbiAgICBzb3VyY2UsXG4gICAgc2Vzc2lvbklkLFxuICAgIHByb2plY3RJZDogb3B0aW9ucz8ucHJvamVjdElkLFxuICAgIHN0cmVhbUJvZHksXG4gICAgbWVzc2FnZSxcbiAgfTtcbn1cblxuZnVuY3Rpb24gaW5zdGFsbFRvb2xGYWlsdXJlRml4dHVyZSgpOiBBcmFiaWNBaUZpeHR1cmUge1xuICBjb25zdCBzZXNzaW9uSWQgPSBcImUyZS10b29sLWZhaWx1cmUtc2Vzc2lvblwiO1xuICBjb25zdCBtZXNzYWdlSWQgPSBcImUyZS10b29sLWZhaWx1cmUtbWVzc2FnZVwiO1xuICBjb25zdCBzb3VyY2UgPSBcInNyYy9taXNzaW5nLXJlbGVhc2UtZml4dHVyZS50c1wiO1xuICBjb25zdCBxdWVzdGlvbiA9IFwiV2hpY2ggc291cmNlIGZpbGUgaXMgYXZhaWxhYmxlIGZvciB0aGUgcmVsZWFzZSBjaGVjaz9cIjtcbiAgY29uc3QgYW5zd2VyID1cbiAgICBcIkFOQUxZU0lTX0lOQ09NUExFVEU6IFRoZSByZXF1aXJlZCBzb3VyY2UgcmVhZCBkaWQgbm90IGNvbXBsZXRlLCBzbyBubyB2ZXJpZmllZCByZXN1bHQgaXMgYXZhaWxhYmxlLlwiO1xuICBjb25zdCBkaWFnbm9zdGljQ29kZSA9IFwiVE9PTF9FWEVDVVRJT05fRkFJTEVEXCI7XG4gIGNvbnN0IHRvb2xUcmFjZSA9IFtcbiAgICB7XG4gICAgICBraW5kOiBcInRvb2xfY2FsbFwiLFxuICAgICAgdG9vbDogXCJyZWFkX2ZpbGVcIixcbiAgICAgIGFyZ3M6IHsgcGF0aDogc291cmNlIH0sXG4gICAgICBjYWNoZWQ6IGZhbHNlLFxuICAgIH0sXG4gICAge1xuICAgICAga2luZDogXCJ0b29sX3Jlc3VsdFwiLFxuICAgICAgdG9vbDogXCJyZWFkX2ZpbGVcIixcbiAgICAgIHNvdXJjZSxcbiAgICAgIHJlc3VsdEtpbmQ6IFwiZmFpbGVkXCIsXG4gICAgICBkaWFnbm9zdGljQ29kZSxcbiAgICAgIHJlc3VsdFN1bW1hcnk6IFwiVGhlIHJlcXVpcmVkIHNvdXJjZSByZWFkIGRpZCBub3QgY29tcGxldGUuXCIsXG4gICAgfSxcbiAgICB7XG4gICAgICBraW5kOiBcImRvbmVcIixcbiAgICAgIHN0b3BSZWFzb246IFwidG9vbF9mYWlsdXJlXCIsXG4gICAgICBpdGVyYXRpb25zOiAxLFxuICAgICAgbWF4SXRlcmF0aW9uczogOCxcbiAgICAgIHRvb2xDYWxsczogMSxcbiAgICAgIHByZWZldGNoVG9vbENhbGxzOiAwLFxuICAgICAgbG9vcFRvb2xDYWxsczogMSxcbiAgICAgIHN5bnRoZXNpc1N0YXJ0ZWQ6IGZhbHNlLFxuICAgICAgZGlhZ25vc3RpY0NvZGVzOiBbZGlhZ25vc3RpY0NvZGVdLFxuICAgIH0sXG4gIF07XG4gIGNvbnN0IG1lc3NhZ2UgPSB7XG4gICAgaWQ6IG1lc3NhZ2VJZCxcbiAgICBzZXNzaW9uSWQsXG4gICAgcm9sZTogXCJhc3Npc3RhbnRcIixcbiAgICBjb250ZW50OiBhbnN3ZXIsXG4gICAgdG9vbFRyYWNlOiBKU09OLnN0cmluZ2lmeSh0b29sVHJhY2UpLFxuICAgIGNyZWF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAyOjAwLjAwMFpcIixcbiAgfTtcbiAgY29uc3Qgc3NlID0gKGV2ZW50OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPikgPT5cbiAgICBgZGF0YTogJHtKU09OLnN0cmluZ2lmeShldmVudCl9XFxuXFxuYDtcbiAgY29uc3Qgc3RyZWFtQm9keSA9IFtcbiAgICBzc2UoeyB0eXBlOiBcInNlc3Npb25fc3RhcnRlZFwiLCBzZXNzaW9uSWQgfSksXG4gICAgc3NlKHtcbiAgICAgIHR5cGU6IFwiZXhlY3V0aW9uX3N0YXJ0ZWRcIixcbiAgICAgIGV4ZWN1dGlvbklkOiBcImUyZS10b29sLWZhaWx1cmUtZXhlY3V0aW9uXCIsXG4gICAgICBzdGF0dXM6IFwicnVubmluZ1wiLFxuICAgICAgcmVzdW1hYmxlOiB0cnVlLFxuICAgIH0pLFxuICAgIHNzZSh7XG4gICAgICB0eXBlOiBcInRvb2xfY2FsbFwiLFxuICAgICAgdG9vbDogXCJyZWFkX2ZpbGVcIixcbiAgICAgIGFyZ3M6IHsgcGF0aDogc291cmNlIH0sXG4gICAgICBjYWNoZWQ6IGZhbHNlLFxuICAgIH0pLFxuICAgIHNzZSh7XG4gICAgICB0eXBlOiBcInRvb2xfcmVzdWx0XCIsXG4gICAgICB0b29sOiBcInJlYWRfZmlsZVwiLFxuICAgICAgc291cmNlLFxuICAgICAgcmVzdWx0S2luZDogXCJmYWlsZWRcIixcbiAgICAgIGRpYWdub3N0aWNDb2RlLFxuICAgICAgcmVzdWx0U3VtbWFyeTogXCJUaGUgcmVxdWlyZWQgc291cmNlIHJlYWQgZGlkIG5vdCBjb21wbGV0ZS5cIixcbiAgICB9KSxcbiAgICBzc2UoeyB0eXBlOiBcImRlbHRhXCIsIGRlbHRhOiBhbnN3ZXIgfSksXG4gICAgc3NlKHtcbiAgICAgIHR5cGU6IFwiZG9uZVwiLFxuICAgICAgc2Vzc2lvbklkLFxuICAgICAgbWVzc2FnZSxcbiAgICAgIHRvb2xUcmFjZTogSlNPTi5zdHJpbmdpZnkodG9vbFRyYWNlKSxcbiAgICAgIHBlbmRpbmdDaGFuZ2VzOiBbXSxcbiAgICB9KSxcbiAgXS5qb2luKFwiXCIpO1xuXG4gIHJldHVybiB7XG4gICAgcXVlc3Rpb24sXG4gICAgYW5zd2VyLFxuICAgIHNvdXJjZSxcbiAgICBzZXNzaW9uSWQsXG4gICAgc3RyZWFtQm9keSxcbiAgICBtZXNzYWdlLFxuICB9O1xufVxuXG5mdW5jdGlvbiBpbnN0YWxsRGlzY29ubmVjdGVkQWlGaXh0dXJlKCk6IEFyYWJpY0FpRml4dHVyZSB7XG4gIGNvbnN0IHNlc3Npb25JZCA9IFwiZTJlLWRpc2Nvbm5lY3RlZC1haS1zZXNzaW9uXCI7XG4gIGNvbnN0IGV4ZWN1dGlvbklkID0gXCJlMmUtZGlzY29ubmVjdGVkLWFpLWV4ZWN1dGlvblwiO1xuICBjb25zdCBxdWVzdGlvbiA9XG4gICAgXCJXaGF0IGhhcHBlbnMgd2hlbiB0aGUgbW9kZWwgZGlzY29ubmVjdHMgYWZ0ZXIgc3RhcnRpbmcgYW4gYW5zd2VyP1wiO1xuICBjb25zdCBhbnN3ZXIgPVxuICAgIFwiVGhlIG1vZGVsIHN0YXJ0ZWQgYW4gYW5zd2VyLCBidXQgdGhlIHByb3ZpZGVyIGRpc2Nvbm5lY3RlZCBiZWZvcmUgY29tcGxldGlvbi5cIjtcbiAgY29uc3QgZGlhZ25vc3RpY0NvZGUgPSBcIkVYRUNVVElPTl9QUk9WSURFUl9GQUlMVVJFXCI7XG4gIGNvbnN0IHRvb2xUcmFjZSA9IFtcbiAgICB7XG4gICAgICBraW5kOiBcImRvbmVcIixcbiAgICAgIHN0b3BSZWFzb246IFwicHJvdmlkZXJfdGltZW91dFwiLFxuICAgICAgaXRlcmF0aW9uczogMSxcbiAgICAgIG1heEl0ZXJhdGlvbnM6IDgsXG4gICAgICB0b29sQ2FsbHM6IDAsXG4gICAgICBwcmVmZXRjaFRvb2xDYWxsczogMCxcbiAgICAgIGxvb3BUb29sQ2FsbHM6IDAsXG4gICAgICBzeW50aGVzaXNTdGFydGVkOiBmYWxzZSxcbiAgICAgIGRpYWdub3N0aWNDb2RlczogW2RpYWdub3N0aWNDb2RlXSxcbiAgICAgIGRpYWdub3N0aWNEZXRhaWxzOiBbXG4gICAgICAgIFwiVGhlIHByb3ZpZGVyIGRpc2Nvbm5lY3RlZCBhZnRlciB2aXNpYmxlIHJlc3BvbnNlIHRleHQuXCIsXG4gICAgICBdLFxuICAgIH0sXG4gIF07XG4gIGNvbnN0IG1lc3NhZ2UgPSB7XG4gICAgaWQ6IFwiZTJlLWRpc2Nvbm5lY3RlZC1haS1tZXNzYWdlXCIsXG4gICAgc2Vzc2lvbklkLFxuICAgIHJvbGU6IFwiYXNzaXN0YW50XCIsXG4gICAgY29udGVudDogYW5zd2VyLFxuICAgIHRvb2xUcmFjZTogSlNPTi5zdHJpbmdpZnkodG9vbFRyYWNlKSxcbiAgICBvdXRjb21lOiBcIkZBSUxFRFwiLFxuICAgIGVycm9yQ29kZTogZGlhZ25vc3RpY0NvZGUsXG4gICAgZXJyb3JNZXNzYWdlOiBcIlRoZSBwcm92aWRlciBkaXNjb25uZWN0ZWQgYmVmb3JlIGNvbXBsZXRpb24uXCIsXG4gICAgZXhlY3V0aW9uSWQsXG4gICAgY3JlYXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDI6MDAuMDAwWlwiLFxuICB9O1xuICBjb25zdCBzc2UgPSAoZXZlbnQ6IFJlY29yZDxzdHJpbmcsIHVua25vd24+KSA9PlxuICAgIGBkYXRhOiAke0pTT04uc3RyaW5naWZ5KGV2ZW50KX1cXG5cXG5gO1xuICBjb25zdCBzdHJlYW1Cb2R5ID0gW1xuICAgIHNzZSh7IHR5cGU6IFwic2Vzc2lvbl9zdGFydGVkXCIsIHNlc3Npb25JZCB9KSxcbiAgICBzc2Uoe1xuICAgICAgdHlwZTogXCJleGVjdXRpb25fc3RhcnRlZFwiLFxuICAgICAgZXhlY3V0aW9uSWQsXG4gICAgICBzdGF0dXM6IFwicnVubmluZ1wiLFxuICAgICAgcmVzdW1hYmxlOiB0cnVlLFxuICAgIH0pLFxuICAgIHNzZSh7IHR5cGU6IFwic3RhZ2VcIiwgc3RhZ2U6IFwiY2FsbGluZy1tb2RlbFwiIH0pLFxuICAgIHNzZSh7IHR5cGU6IFwiZGVsdGFcIiwgZGVsdGE6IGFuc3dlciB9KSxcbiAgICAvLyBUaGUgcmVhbCByb3V0ZSBlbWl0cyB0aGlzIGFmdGVyIGEgcHJvdmlkZXIgZGlzY29ubmVjdCBzbyB0aGUgY2xpZW50XG4gICAgLy8gZHJvcHMgdGhlIHRyYW5zaWVudCBidWJibGUgYmVmb3JlIHJlbmRlcmluZyB0aGUgcGVyc2lzdGVkIHJlc3VsdC5cbiAgICBzc2UoeyB0eXBlOiBcInN0cmVhbV9yZXNldFwiIH0pLFxuICAgIHNzZSh7XG4gICAgICB0eXBlOiBcImRvbmVcIixcbiAgICAgIHNlc3Npb25JZCxcbiAgICAgIGV4ZWN1dGlvbklkLFxuICAgICAgbWVzc2FnZSxcbiAgICAgIHBlbmRpbmdDaGFuZ2VzOiBbXSxcbiAgICB9KSxcbiAgXS5qb2luKFwiXCIpO1xuXG4gIHJldHVybiB7XG4gICAgcXVlc3Rpb24sXG4gICAgYW5zd2VyLFxuICAgIHNvdXJjZTogXCJwcm92aWRlclwiLFxuICAgIHNlc3Npb25JZCxcbiAgICBleGVjdXRpb25JZCxcbiAgICBzdHJlYW1Cb2R5LFxuICAgIG1lc3NhZ2UsXG4gIH07XG59XG5cbmZ1bmN0aW9uIGluc3RhbGxSZXN1bWVkQW5hbHlzaXNGYWlsdXJlRml4dHVyZSgpIHtcbiAgY29uc3Qgc2Vzc2lvbklkID0gXCJlMmUtcmVzdW1lZC1hbmFseXNpcy1mYWlsdXJlLXNlc3Npb25cIjtcbiAgY29uc3QgZXhlY3V0aW9uSWQgPSBcImUyZS1yZXN1bWVkLWFuYWx5c2lzLWZhaWx1cmUtZXhlY3V0aW9uXCI7XG4gIGNvbnN0IHJlc3VtZVRva2VuID0gXCJlMmUtcmVzdW1lZC1hbmFseXNpcy1mYWlsdXJlLXRva2VuLW9wYXF1ZVwiO1xuICBjb25zdCBxdWVzdGlvbiA9IFwiVmVyaWZ5IHRoZSBhbmFseXNpcyBldmlkZW5jZSBhZnRlciByZWNvbm5lY3QuXCI7XG4gIGNvbnN0IGFuc3dlciA9XG4gICAgXCJBTkFMWVNJU19JTkNPTVBMRVRFOiBUaGUgcmVxdWlyZWQgYW5hbHlzaXMgZGlkIG5vdCBjb21wbGV0ZSwgc28gbm8gdmVyaWZpZWQgcmVzdWx0IGlzIGF2YWlsYWJsZS5cIjtcbiAgY29uc3QgZGlhZ25vc3RpY0NvZGUgPSBcIlRPT0xfVU5BVkFJTEFCTEVcIjtcbiAgY29uc3Qgc3NlID0gKGV2ZW50OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPikgPT5cbiAgICBgZGF0YTogJHtKU09OLnN0cmluZ2lmeShldmVudCl9XFxuXFxuYDtcbiAgY29uc3Qgc3RyZWFtQm9keSA9IFtcbiAgICBzc2UoeyB0eXBlOiBcInNlc3Npb25fc3RhcnRlZFwiLCBzZXNzaW9uSWQgfSksXG4gICAgc3NlKHtcbiAgICAgIHR5cGU6IFwiZXhlY3V0aW9uX3N0YXJ0ZWRcIixcbiAgICAgIGV4ZWN1dGlvbklkLFxuICAgICAgc3RhdHVzOiBcInJ1bm5pbmdcIixcbiAgICAgIHJlc3VtYWJsZTogdHJ1ZSxcbiAgICAgIHJlc3VtZVRva2VuLFxuICAgIH0pLFxuICAgIHNzZSh7XG4gICAgICB0eXBlOiBcImVycm9yXCIsXG4gICAgICBleGVjdXRpb25JZCxcbiAgICAgIGNvZGU6IGRpYWdub3N0aWNDb2RlLFxuICAgICAgbWVzc2FnZTogXCJUaGUgcmVxdWlyZWQgYW5hbHlzaXMgZGlkIG5vdCBjb21wbGV0ZS5cIixcbiAgICB9KSxcbiAgXS5qb2luKFwiXCIpO1xuICBjb25zdCBmaXh0dXJlOiBBcmFiaWNBaUZpeHR1cmUgPSB7XG4gICAgcXVlc3Rpb24sXG4gICAgYW5zd2VyLFxuICAgIHNvdXJjZTogXCJzcmMvbWlzc2luZy1hbmFseXNpcy10b29sLnRzXCIsXG4gICAgc2Vzc2lvbklkLFxuICAgIGV4ZWN1dGlvbklkLFxuICAgIHN0cmVhbUJvZHksXG4gICAgbWVzc2FnZToge1xuICAgICAgaWQ6IFwiZTJlLXJlc3VtZWQtYW5hbHlzaXMtZmFpbHVyZS1tZXNzYWdlXCIsXG4gICAgICBzZXNzaW9uSWQsXG4gICAgICByb2xlOiBcImFzc2lzdGFudFwiLFxuICAgICAgY29udGVudDogYW5zd2VyLFxuICAgICAgb3V0Y29tZTogXCJGQUlMRURcIixcbiAgICAgIGV4ZWN1dGlvbklkLFxuICAgICAgZXJyb3JDb2RlOiBkaWFnbm9zdGljQ29kZSxcbiAgICAgIGVycm9yTWVzc2FnZTogXCJUaGUgcmVxdWlyZWQgYW5hbHlzaXMgZGlkIG5vdCBjb21wbGV0ZS5cIixcbiAgICAgIGNyZWF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAyOjAwLjAwMFpcIixcbiAgICB9LFxuICB9O1xuXG4gIHJldHVybiB7XG4gICAgZml4dHVyZSxcbiAgICBleGVjdXRpb246IHtcbiAgICAgIGlkOiBleGVjdXRpb25JZCxcbiAgICAgIHByb2plY3RJZDogXCJlMmUtcHJvamVjdFwiLFxuICAgICAgb3BlcmF0aW9uSWQ6IFwiZTJlLXJlc3VtZWQtYW5hbHlzaXMtZmFpbHVyZS1vcGVyYXRpb25cIixcbiAgICAgIHNlc3Npb25JZCxcbiAgICAgIHN0YXR1czogXCJmYWlsZWRcIixcbiAgICAgIGZsaWdodFN0YXRlOiBcIkZBSUxFRFwiLFxuICAgICAgZXZpZGVuY2VWZXJkaWN0OiBcIklOQ09NUExFVEVcIixcbiAgICAgIHByb29mUmVxdWlyZWQ6IHRydWUsXG4gICAgICByZXN1bWFibGU6IHRydWUsXG4gICAgICBjaGVja3BvaW50VmVyc2lvbjogMSxcbiAgICAgIGNoZWNrcG9pbnQ6IHtcbiAgICAgICAgc3RhZ2U6IFwidG9vbC1leGVjdXRpb25cIixcbiAgICAgICAgZGV0YWlsOiBcIlRoZSByZXF1aXJlZCBhbmFseXNpcyB0b29sIHdhcyB1bmF2YWlsYWJsZS5cIixcbiAgICAgIH0sXG4gICAgICBvYmplY3RpdmU6IHsgb2JqZWN0aXZlOiBxdWVzdGlvbiB9LFxuICAgICAgZXJyb3I6IFwiVGhlIHJlcXVpcmVkIGFuYWx5c2lzIGRpZCBub3QgY29tcGxldGUuXCIsXG4gICAgICBzdGFydGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMTowMC4wMDBaXCIsXG4gICAgICBjcmVhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMTowMC4wMDBaXCIsXG4gICAgICB1cGRhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMjowMC4wMDBaXCIsXG4gICAgfSxcbiAgfTtcbn1cblxuZnVuY3Rpb24gaW5zdGFsbEludGVycnVwdGVkUmVzdW1lRml4dHVyZSgpIHtcbiAgY29uc3Qgc2Vzc2lvbklkID0gXCJlMmUtaW50ZXJydXB0ZWQtcmVzdW1lLXNlc3Npb25cIjtcbiAgY29uc3QgZXhlY3V0aW9uSWQgPSBcImUyZS1pbnRlcnJ1cHRlZC1yZXN1bWUtZXhlY3V0aW9uXCI7XG4gIGNvbnN0IGluaXRpYWxUb2tlbiA9IFwiZTJlLWludGVycnVwdGVkLWluaXRpYWwtdG9rZW5cIjtcbiAgY29uc3QgcmVjb3ZlcmVkVG9rZW4gPSBcImUyZS1pbnRlcnJ1cHRlZC1yZWNvdmVyZWQtdG9rZW5cIjtcbiAgY29uc3QgcXVlc3Rpb24gPSBcIkNvbnRpbnVlIHRoZSBpbnRlcnJ1cHRlZCByZWxlYXNlIGV4ZWN1dGlvbi5cIjtcbiAgY29uc3QgcGFydGlhbEFuc3dlciA9XG4gICAgXCJUaGUgcmVsZWFzZSBleGVjdXRpb24gc3RhcnRlZCBiZWZvcmUgdGhlIGJyb3dzZXIgZGlzY29ubmVjdGVkLlwiO1xuICBjb25zdCBhbnN3ZXIgPVxuICAgIFwiVGhlIG9yaWdpbmFsIHJlbGVhc2UgZXhlY3V0aW9uIHJlc3VtZWQgYWZ0ZXIgY2FwYWJpbGl0eSByZWNvdmVyeS5cIjtcbiAgY29uc3QgbWVzc2FnZSA9IHtcbiAgICBpZDogXCJlMmUtaW50ZXJydXB0ZWQtcmVzdW1lLW1lc3NhZ2VcIixcbiAgICBzZXNzaW9uSWQsXG4gICAgcm9sZTogXCJhc3Npc3RhbnRcIixcbiAgICBjb250ZW50OiBhbnN3ZXIsXG4gICAgZXhlY3V0aW9uSWQsXG4gICAgb3V0Y29tZTogXCJDT01QTEVURURcIixcbiAgICBjcmVhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMzowMC4wMDBaXCIsXG4gIH07XG4gIGNvbnN0IHNzZSA9IChldmVudDogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pID0+XG4gICAgYGRhdGE6ICR7SlNPTi5zdHJpbmdpZnkoZXZlbnQpfVxcblxcbmA7XG4gIGNvbnN0IGZpeHR1cmU6IEFyYWJpY0FpRml4dHVyZSA9IHtcbiAgICBxdWVzdGlvbixcbiAgICBhbnN3ZXIsXG4gICAgc291cmNlOiBcInJlbGVhc2UtcmVzdW1lXCIsXG4gICAgc2Vzc2lvbklkLFxuICAgIGV4ZWN1dGlvbklkLFxuICAgIHN0cmVhbUJvZHk6IFtcbiAgICAgIHNzZSh7IHR5cGU6IFwic2Vzc2lvbl9zdGFydGVkXCIsIHNlc3Npb25JZCB9KSxcbiAgICAgIHNzZSh7XG4gICAgICAgIHR5cGU6IFwiZXhlY3V0aW9uX3N0YXJ0ZWRcIixcbiAgICAgICAgZXhlY3V0aW9uSWQsXG4gICAgICAgIHN0YXR1czogXCJydW5uaW5nXCIsXG4gICAgICAgIHJlc3VtYWJsZTogdHJ1ZSxcbiAgICAgICAgcmVzdW1lVG9rZW46IGluaXRpYWxUb2tlbixcbiAgICAgIH0pLFxuICAgICAgc3NlKHsgdHlwZTogXCJzdGFnZVwiLCBzdGFnZTogXCJjYWxsaW5nLW1vZGVsXCIgfSksXG4gICAgICBzc2UoeyB0eXBlOiBcImRlbHRhXCIsIGRlbHRhOiBwYXJ0aWFsQW5zd2VyIH0pLFxuICAgIF0uam9pbihcIlwiKSxcbiAgICBtZXNzYWdlLFxuICB9O1xuICByZXR1cm4ge1xuICAgIGZpeHR1cmUsXG4gICAgaW5pdGlhbFRva2VuLFxuICAgIHJlY292ZXJlZFRva2VuLFxuICAgIHJlc3VtZWRTdHJlYW1Cb2R5OiBbXG4gICAgICBzc2UoeyB0eXBlOiBcInNlc3Npb25fc3RhcnRlZFwiLCBzZXNzaW9uSWQgfSksXG4gICAgICBzc2Uoe1xuICAgICAgICB0eXBlOiBcImV4ZWN1dGlvbl9zdGFydGVkXCIsXG4gICAgICAgIGV4ZWN1dGlvbklkLFxuICAgICAgICBzdGF0dXM6IFwicnVubmluZ1wiLFxuICAgICAgICByZXN1bWFibGU6IHRydWUsXG4gICAgICAgIHJlc3VtZVRva2VuOiByZWNvdmVyZWRUb2tlbixcbiAgICAgIH0pLFxuICAgICAgc3NlKHsgdHlwZTogXCJzdGFnZVwiLCBzdGFnZTogXCJyZXN1bWluZy1jaGVja3BvaW50XCIgfSksXG4gICAgICBzc2UoeyB0eXBlOiBcImRlbHRhXCIsIGRlbHRhOiBhbnN3ZXIgfSksXG4gICAgICBzc2Uoe1xuICAgICAgICB0eXBlOiBcImRvbmVcIixcbiAgICAgICAgc2Vzc2lvbklkLFxuICAgICAgICBleGVjdXRpb25JZCxcbiAgICAgICAgbWVzc2FnZSxcbiAgICAgICAgcGVuZGluZ0NoYW5nZXM6IFtdLFxuICAgICAgfSksXG4gICAgXS5qb2luKFwiXCIpLFxuICAgIGV4ZWN1dGlvbjoge1xuICAgICAgaWQ6IGV4ZWN1dGlvbklkLFxuICAgICAgcHJvamVjdElkOiBcImUyZS1wcm9qZWN0XCIsXG4gICAgICBvcGVyYXRpb25JZDogXCJlMmUtaW50ZXJydXB0ZWQtcmVzdW1lLW9wZXJhdGlvblwiLFxuICAgICAgc2Vzc2lvbklkLFxuICAgICAgc3RhdHVzOiBcInBhdXNlZFwiLFxuICAgICAgZmxpZ2h0U3RhdGU6IFwiUEFVU0VEXCIsXG4gICAgICByZXN1bWFibGU6IHRydWUsXG4gICAgICBjaGVja3BvaW50VmVyc2lvbjogMSxcbiAgICAgIGNoZWNrcG9pbnQ6IHtcbiAgICAgICAgc3RhZ2U6IFwiY2FsbGluZy1tb2RlbFwiLFxuICAgICAgICBkZXRhaWw6XG4gICAgICAgICAgXCJUaGUgYnJvd3NlciB0cmFuc3BvcnQgZGlzY29ubmVjdGVkIGFmdGVyIHRoZSBleGVjdXRpb24gc3RhcnRlZC5cIixcbiAgICAgIH0sXG4gICAgICBvYmplY3RpdmU6IHsgb2JqZWN0aXZlOiBxdWVzdGlvbiB9LFxuICAgICAgc3RhcnRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDE6MDAuMDAwWlwiLFxuICAgICAgY3JlYXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDE6MDAuMDAwWlwiLFxuICAgICAgdXBkYXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDI6MDAuMDAwWlwiLFxuICAgIH0sXG4gIH07XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGNyZWF0ZVJlbGVhc2VTaWduSW5VcmwocGFnZTogUGFnZSkge1xuICBjb25zdCBzZWNyZXRLZXkgPSBwcm9jZXNzLmVudi5DTEVSS19TRUNSRVRfS0VZO1xuICBpZiAoIXNlY3JldEtleSkge1xuICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgIFwiQ0xFUktfU0VDUkVUX0tFWSBpcyByZXF1aXJlZCBmb3IgdGhlIHJlbGVhc2Utb25seSBwcm9ncmFtbWF0aWMgQ2xlcmsgaGFuZG9mZi5cIixcbiAgICApO1xuICB9XG5cbiAgY29uc3QgaGVhZGVycyA9IHtcbiAgICBBdXRob3JpemF0aW9uOiBgQmVhcmVyICR7c2VjcmV0S2V5fWAsXG4gICAgXCJDb250ZW50LVR5cGVcIjogXCJhcHBsaWNhdGlvbi9qc29uXCIsXG4gIH07XG4gIGNvbnN0IHVzZXJSZXNwb25zZSA9IGF3YWl0IHBhZ2UucmVxdWVzdC5nZXQoXG4gICAgYGh0dHBzOi8vYXBpLmNsZXJrLmNvbS92MS91c2Vycz9lbWFpbF9hZGRyZXNzPSR7ZW5jb2RlVVJJQ29tcG9uZW50KFRFU1RfVVNFUi5lbWFpbCl9YCxcbiAgICB7IGhlYWRlcnMgfSxcbiAgKTtcbiAgbGV0IHVzZXJJZCA9IHBhcnNlQ2xlcmtVc2VyTG9va3VwUmVzcG9uc2UoYXdhaXQgdXNlclJlc3BvbnNlLmpzb24oKSk7XG5cbiAgaWYgKCF1c2VySWQpIHtcbiAgICBjb25zdCBjcmVhdGVkUmVzcG9uc2UgPSBhd2FpdCBwYWdlLnJlcXVlc3QucG9zdChcbiAgICAgIFwiaHR0cHM6Ly9hcGkuY2xlcmsuY29tL3YxL3VzZXJzXCIsXG4gICAgICB7XG4gICAgICAgIGhlYWRlcnMsXG4gICAgICAgIGRhdGE6IHtcbiAgICAgICAgICBlbWFpbF9hZGRyZXNzOiBbVEVTVF9VU0VSLmVtYWlsXSxcbiAgICAgICAgICBmaXJzdF9uYW1lOiBURVNUX1VTRVIuZmlyc3ROYW1lLFxuICAgICAgICAgIGxhc3RfbmFtZTogVEVTVF9VU0VSLmxhc3ROYW1lLFxuICAgICAgICAgIHNraXBfcGFzc3dvcmRfY2hlY2tzOiB0cnVlLFxuICAgICAgICAgIHNraXBfcGFzc3dvcmRfcmVxdWlyZW1lbnQ6IHRydWUsXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgICk7XG4gICAgdXNlcklkID0gcGFyc2VDcmVhdGVkQ2xlcmtVc2VyUmVzcG9uc2UoYXdhaXQgY3JlYXRlZFJlc3BvbnNlLmpzb24oKSk7XG4gIH1cblxuICBpZiAoIXVzZXJJZCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgIFwiVGhlIGlzb2xhdGVkIENsZXJrIHJlbGVhc2UgdXNlciBjb3VsZCBub3QgYmUgcHJvdmlzaW9uZWQuXCIsXG4gICAgKTtcbiAgfVxuXG4gIGNvbnN0IHRva2VuUmVzcG9uc2UgPSBhd2FpdCBwYWdlLnJlcXVlc3QucG9zdChcbiAgICBcImh0dHBzOi8vYXBpLmNsZXJrLmNvbS92MS9zaWduX2luX3Rva2Vuc1wiLFxuICAgIHsgaGVhZGVycywgZGF0YTogeyB1c2VyX2lkOiB1c2VySWQgfSB9LFxuICApO1xuICBjb25zdCB0b2tlbiA9IHBhcnNlQ2xlcmtTaWduSW5Ub2tlblJlc3BvbnNlKGF3YWl0IHRva2VuUmVzcG9uc2UuanNvbigpKTtcblxuICByZXR1cm4gYCR7bmV3IFVSTChEQVNIQk9BUkRfUEFUSCwgcGFnZS51cmwoKSkudG9TdHJpbmcoKX1zaWduLWluP19fY2xlcmtfdGlja2V0PSR7ZW5jb2RlVVJJQ29tcG9uZW50KHRva2VuKX1gO1xufVxuXG5hc3luYyBmdW5jdGlvbiBwcm9ncmFtbWF0aWNTaWduSW4ocGFnZTogUGFnZSkge1xuICBhd2FpdCBwYWdlLmdvdG8oREFTSEJPQVJEX1BBVEgpO1xuICBhd2FpdCBleHBlY3QoXG4gICAgcGFnZS5nZXRCeVJvbGUoXCJsaW5rXCIsIHsgbmFtZTogXCJTaWduIEluXCIsIGV4YWN0OiB0cnVlIH0pLFxuICApLnRvQmVWaXNpYmxlKCk7XG5cbiAgY29uc3QgaGVscGVyID1cbiAgICBnbG9iYWxUaGlzLnNpZ25JbkNsZXJrVXNlciA/P1xuICAgIGdsb2JhbFRoaXMuX19FTkdJTkVFUklOR09TX1NJR05fSU5fQ0xFUktfVVNFUl9fO1xuICBpZiAoIWhlbHBlcikge1xuICAgIGlmIChwcm9jZXNzLmVudi5SVU5fQ09OVFJPTExFRF9SRUxFQVNFX1ZBTElEQVRJT04gIT09IFwiMVwiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgIFwiQ2xlcmsgYnJvd3NlciBoZWxwZXIgaXMgdW5hdmFpbGFibGUuIFJ1biB0aGlzIGpvdXJuZXkgaW4gdGhlIFJlcGxpdCBicm93c2VyIHJ1bm5lciwgd2hpY2ggaW5qZWN0cyBzaWduSW5DbGVya1VzZXIuXCIsXG4gICAgICApO1xuICAgIH1cbiAgICBhd2FpdCBwYWdlLmdvdG8oYXdhaXQgY3JlYXRlUmVsZWFzZVNpZ25JblVybChwYWdlKSk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UpLnRvSGF2ZVVSTChcbiAgICAgIG5ldyBSZWdFeHAoYCR7REFTSEJPQVJEX1BBVEgucmVwbGFjZUFsbChcIi9cIiwgXCJcXFxcL1wiKX0kYCksXG4gICAgKTtcbiAgICBhd2FpdCBjb21wbGV0ZVJlYWRpbmVzc0hhbmRzaGFrZShwYWdlKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3Qgc2lnbkluVXJsID0gYXdhaXQgaGVscGVyKHtcbiAgICAuLi5URVNUX1VTRVIsXG4gICAgdHRsOiA5MDAsXG4gICAgYmFzZVBhdGg6IERBU0hCT0FSRF9QQVRILFxuICB9KTtcbiAgYXdhaXQgcGFnZS5nb3RvKHNpZ25JblVybCk7XG4gIGF3YWl0IGV4cGVjdChwYWdlKS50b0hhdmVVUkwoXG4gICAgbmV3IFJlZ0V4cChgJHtEQVNIQk9BUkRfUEFUSC5yZXBsYWNlQWxsKFwiL1wiLCBcIlxcXFwvXCIpfSRgKSxcbiAgKTtcbiAgYXdhaXQgY29tcGxldGVSZWFkaW5lc3NIYW5kc2hha2UocGFnZSk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGNvbXBsZXRlUmVhZGluZXNzSGFuZHNoYWtlKHBhZ2U6IFBhZ2UpOiBQcm9taXNlPHZvaWQ+IHtcbiAgY29uc3QgbW9kZSA9IGRhc2hib2FyZFRlc3RNb2RlKCk7XG4gIGlmICghVEVTVF9NT0RFUy5oYXMobW9kZSkpIHtcbiAgICBhd2FpdCB3cml0ZVJlYWRpbmVzc1JlY2VpcHQoXCJibG9ja2VkXCIsIHtcbiAgICAgIG1vZGU6IHsgc3RhdHVzOiBcImJsb2NrZWRcIiwgcmVhc29uOiBcInVuc3VwcG9ydGVkX3Rlc3RfbW9kZVwiIH0sXG4gICAgfSk7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBCTE9DS0VEOiB1bnN1cHBvcnRlZCBkYXNoYm9hcmQgdGVzdCBtb2RlICgke21vZGV9KS5gKTtcbiAgfVxuICBpZiAobW9kZSA9PT0gXCJsaXZlLXByb3ZpZGVyXCIpIHtcbiAgICBpZiAocHJvY2Vzcy5lbnYuREFTSEJPQVJEX0UyRV9MSVZFX1BST1ZJREVSICE9PSBcIjFcIikge1xuICAgICAgYXdhaXQgd3JpdGVSZWFkaW5lc3NSZWNlaXB0KFwiYmxvY2tlZFwiLCB7XG4gICAgICAgIG1vZGU6IHsgc3RhdHVzOiBcInJlYWR5XCIgfSxcbiAgICAgICAgcHJvdmlkZXI6IHsgc3RhdHVzOiBcImJsb2NrZWRcIiwgcmVhc29uOiBcImxpdmVfcHJvdmlkZXJfbm90X2VuYWJsZWRcIiB9LFxuICAgICAgfSk7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgIFwiQkxPQ0tFRDogbGl2ZS1wcm92aWRlciBtb2RlIHJlcXVpcmVzIERBU0hCT0FSRF9FMkVfTElWRV9QUk9WSURFUj0xLlwiLFxuICAgICAgKTtcbiAgICB9XG4gICAgaWYgKHByb2Nlc3MuZW52LkRBU0hCT0FSRF9FMkVfTElWRV9ESVNQT1NBQkxFICE9PSBcIjFcIikge1xuICAgICAgYXdhaXQgd3JpdGVSZWFkaW5lc3NSZWNlaXB0KFwiYmxvY2tlZFwiLCB7XG4gICAgICAgIG1vZGU6IHsgc3RhdHVzOiBcInJlYWR5XCIgfSxcbiAgICAgICAgcHJvdmlkZXI6IHsgc3RhdHVzOiBcInJlYWR5XCIgfSxcbiAgICAgICAgZGlzcG9zYWJsZVByb2plY3Q6IHtcbiAgICAgICAgICBzdGF0dXM6IFwiYmxvY2tlZFwiLFxuICAgICAgICAgIHJlYXNvbjogXCJkaXNwb3NhYmxlX3Byb2plY3RfcmVxdWlyZWRcIixcbiAgICAgICAgfSxcbiAgICAgIH0pO1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICBcIkJMT0NLRUQ6IGxpdmUtcHJvdmlkZXIgbW9kZSByZXF1aXJlcyBhbiBleHBsaWNpdGx5IGRpc3Bvc2FibGUgcHJvamVjdC5cIixcbiAgICAgICk7XG4gICAgfVxuICB9XG5cbiAgY29uc3QgZGVhZGxpbmUgPSBEYXRlLm5vdygpICsgcmVhZGluZXNzVGltZW91dE1zKCk7XG4gIGxldCBsYXN0U3RhdHVzID0gXCJub3QgYXR0ZW1wdGVkXCI7XG4gIGNvbnN0IGNoZWNrczogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gPSB7XG4gICAgbW9kZTogeyBzdGF0dXM6IFwicmVhZHlcIiB9LFxuICAgIHByb3ZpZGVyOiB7XG4gICAgICBzdGF0dXM6IG1vZGUgPT09IFwibGl2ZS1wcm92aWRlclwiID8gXCJyZWFkeVwiIDogXCJyZWFkeVwiLFxuICAgICAgLi4uKG1vZGUgPT09IFwiZml4dHVyZVwiID8geyByZWFzb246IFwicHJvdmlkZXJfZnJlZV9maXh0dXJlXCIgfSA6IHt9KSxcbiAgICB9LFxuICAgIGRpc3Bvc2FibGVQcm9qZWN0OiB7XG4gICAgICBzdGF0dXM6IG1vZGUgPT09IFwibGl2ZS1wcm92aWRlclwiID8gXCJyZWFkeVwiIDogXCJyZWFkeVwiLFxuICAgICAgLi4uKG1vZGUgPT09IFwiZml4dHVyZVwiID8geyByZWFzb246IFwiYnJvd3Nlcl9maXh0dXJlX3Byb2plY3RcIiB9IDoge30pLFxuICAgIH0sXG4gIH07XG4gIHdoaWxlIChEYXRlLm5vdygpIDwgZGVhZGxpbmUpIHtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgZXhwZWN0RGFzaGJvYXJkUmVhZHkocGFnZSk7XG4gICAgICBjb25zdCByZWFkaW5lc3MgPSBhd2FpdCBwYWdlLmV2YWx1YXRlKGFzeW5jICh1cmwpID0+IHtcbiAgICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBmZXRjaCh1cmwsIHsgY3JlZGVudGlhbHM6IFwiaW5jbHVkZVwiIH0pO1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIG9rOiByZXNwb25zZS5vayxcbiAgICAgICAgICBib2R5OiAoYXdhaXQgcmVzcG9uc2UuanNvbigpLmNhdGNoKCgpID0+ICh7fSkpKSBhcyB7XG4gICAgICAgICAgICBzdGF0dXM/OiBzdHJpbmc7XG4gICAgICAgICAgICBjaGVja3M/OiBSZWNvcmQ8c3RyaW5nLCB7IHN0YXR1cz86IHN0cmluZyB9PjtcbiAgICAgICAgICB9LFxuICAgICAgICB9O1xuICAgICAgfSwgbmV3IFVSTChcIi9hcGkvcmVhZGluZXNzXCIsIHBhZ2UudXJsKCkpLnRvU3RyaW5nKCkpO1xuICAgICAgY29uc3QgcmVhZGluZXNzQm9keSA9IHJlYWRpbmVzcy5ib2R5IGFzIHtcbiAgICAgICAgc3RhdHVzPzogc3RyaW5nO1xuICAgICAgICBjaGVja3M/OiBSZWNvcmQ8c3RyaW5nLCB7IHN0YXR1cz86IHN0cmluZyB9PjtcbiAgICAgIH07XG4gICAgICBjaGVja3MuYXBpID0geyBzdGF0dXM6IHJlYWRpbmVzcy5vayA/IFwicmVhZHlcIiA6IFwiYmxvY2tlZFwiIH07XG4gICAgICBjaGVja3MuZGF0YWJhc2UgPSByZWFkaW5lc3NCb2R5LmNoZWNrcz8uZGF0YWJhc2UgPz8geyBzdGF0dXM6IFwiYmxvY2tlZFwiIH07XG4gICAgICBjaGVja3Muc2NoZW1hID0gcmVhZGluZXNzQm9keS5jaGVja3M/LnNjaGVtYSA/PyB7IHN0YXR1czogXCJibG9ja2VkXCIgfTtcbiAgICAgIGlmIChcbiAgICAgICAgcmVhZGluZXNzLm9rICYmXG4gICAgICAgIHJlYWRpbmVzc0JvZHkuc3RhdHVzID09PSBcInJlYWR5XCIgJiZcbiAgICAgICAgT2JqZWN0LnZhbHVlcyhyZWFkaW5lc3NCb2R5LmNoZWNrcyA/PyB7fSkuZXZlcnkoXG4gICAgICAgICAgKGNoZWNrKSA9PiBjaGVjay5zdGF0dXMgPT09IFwicmVhZHlcIixcbiAgICAgICAgKVxuICAgICAgKSB7XG4gICAgICAgIGNvbnN0IHByb2plY3RzUmVzdWx0ID0gYXdhaXQgcGFnZS5ldmFsdWF0ZShhc3luYyAodXJsKSA9PiB7XG4gICAgICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBmZXRjaCh1cmwsIHsgY3JlZGVudGlhbHM6IFwiaW5jbHVkZVwiIH0pO1xuICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBvazogcmVzcG9uc2Uub2ssXG4gICAgICAgICAgICBib2R5OiAoYXdhaXQgcmVzcG9uc2UuanNvbigpLmNhdGNoKCgpID0+IFtdKSkgYXMgQXJyYXk8e1xuICAgICAgICAgICAgICBpZD86IHN0cmluZztcbiAgICAgICAgICAgIH0+LFxuICAgICAgICAgIH07XG4gICAgICAgIH0sIG5ldyBVUkwoXCIvYXBpL3Byb2plY3RzXCIsIHBhZ2UudXJsKCkpLnRvU3RyaW5nKCkpO1xuICAgICAgICBjb25zdCBwcm9qZWN0cyA9IHByb2plY3RzUmVzdWx0LmJvZHk7XG4gICAgICAgIGNvbnN0IGV4cGVjdGVkUHJvamVjdCA9XG4gICAgICAgICAgbW9kZSA9PT0gXCJsaXZlLXByb3ZpZGVyXCJcbiAgICAgICAgICAgID8gcHJvY2Vzcy5lbnYuREFTSEJPQVJEX0UyRV9MSVZFX1BST0pFQ1RfSURcbiAgICAgICAgICAgIDogdW5kZWZpbmVkO1xuICAgICAgICBjb25zdCBmaXh0dXJlUHJvamVjdFJlYWR5ID1cbiAgICAgICAgICBtb2RlID09PSBcImZpeHR1cmVcIlxuICAgICAgICAgICAgPyBwcm9qZWN0cy5sZW5ndGggPiAwICYmIHByb2plY3RzLmV2ZXJ5KChwcm9qZWN0KSA9PiBCb29sZWFuKHByb2plY3QuaWQpKVxuICAgICAgICAgICAgOiBwcm9qZWN0cy5zb21lKChwcm9qZWN0KSA9PiBwcm9qZWN0LmlkID09PSBleHBlY3RlZFByb2plY3QpO1xuICAgICAgICBpZiAoXG4gICAgICAgICAgcHJvamVjdHNSZXN1bHQub2sgJiZcbiAgICAgICAgICBBcnJheS5pc0FycmF5KHByb2plY3RzKSAmJlxuICAgICAgICAgIGZpeHR1cmVQcm9qZWN0UmVhZHlcbiAgICAgICAgKSB7XG4gICAgICAgICAgY2hlY2tzLmF1dGggPSB7IHN0YXR1czogXCJyZWFkeVwiIH07XG4gICAgICAgICAgY2hlY2tzLmZpeHR1cmVQcm9qZWN0ID0ge1xuICAgICAgICAgICAgc3RhdHVzOiBcInJlYWR5XCIsXG4gICAgICAgICAgICBwcm9qZWN0OiBleHBlY3RlZFByb2plY3QgPz8gcHJvamVjdHNbMF0/LmlkLFxuICAgICAgICAgIH07XG4gICAgICAgICAgYXdhaXQgd3JpdGVSZWFkaW5lc3NSZWNlaXB0KFwicmVhZHlcIiwgY2hlY2tzKTtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgbGFzdFN0YXR1cyA9IFwiZml4dHVyZSBwcm9qZWN0IHVuYXZhaWxhYmxlXCI7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBsYXN0U3RhdHVzID1cbiAgICAgICAgICByZWFkaW5lc3NCb2R5LmNoZWNrcyAmJlxuICAgICAgICAgIE9iamVjdC5lbnRyaWVzKHJlYWRpbmVzc0JvZHkuY2hlY2tzKVxuICAgICAgICAgICAgLmZpbHRlcigoWywgY2hlY2tdKSA9PiBjaGVjay5zdGF0dXMgIT09IFwicmVhZHlcIilcbiAgICAgICAgICAgIC5tYXAoKFtuYW1lXSkgPT4gbmFtZSlcbiAgICAgICAgICAgIC5qb2luKFwiLCBcIik7XG4gICAgICAgIGlmICghbGFzdFN0YXR1cykgbGFzdFN0YXR1cyA9IFwicmVhZGluZXNzIGJsb2NrZWRcIjtcbiAgICAgIH1cbiAgICB9IGNhdGNoIHtcbiAgICAgIGxhc3RTdGF0dXMgPSBcInJlYWRpbmVzcyByZXF1ZXN0IGZhaWxlZFwiO1xuICAgIH1cbiAgICBhd2FpdCBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4gc2V0VGltZW91dChyZXNvbHZlLCAyNTApKTtcbiAgfVxuICBhd2FpdCB3cml0ZVJlYWRpbmVzc1JlY2VpcHQoXCJibG9ja2VkXCIsIGNoZWNrcywgbGFzdFN0YXR1cyk7XG4gIHRocm93IG5ldyBFcnJvcihcbiAgICBgQkxPQ0tFRDogZGFzaGJvYXJkIHJlYWRpbmVzcyBoYW5kc2hha2UgZGlkIG5vdCBjb21wbGV0ZSAoJHtsYXN0U3RhdHVzfSkuYCxcbiAgKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gb3Blbk5hdmlnYXRpb24ocGFnZTogUGFnZSwgbGFiZWw6IHN0cmluZywgcGF0aDogc3RyaW5nKSB7XG4gIGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKFwibGlua1wiLCB7IG5hbWU6IGxhYmVsLCBleGFjdDogdHJ1ZSB9KS5jbGljaygpO1xuICBhd2FpdCBleHBlY3QocGFnZSkudG9IYXZlVVJMKG5ldyBSZWdFeHAoYCR7cGF0aC5yZXBsYWNlQWxsKFwiL1wiLCBcIlxcXFwvXCIpfSRgKSk7XG59XG5cbmZ1bmN0aW9uIGFwaVVybChwYWdlOiBQYWdlLCBwYXRoOiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCBhcGlCYXNlVXJsID0gcHJvY2Vzcy5lbnYuREFTSEJPQVJEX0UyRV9BUElfQkFTRV9VUkw7XG4gIHJldHVybiBuZXcgVVJMKHBhdGgsIGFwaUJhc2VVcmwgPyBhcGlCYXNlVXJsIDogcGFnZS51cmwoKSkudG9TdHJpbmcoKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gbGl2ZVJlcXVlc3QoXG4gIHBhZ2U6IFBhZ2UsXG4gIHBhdGg6IHN0cmluZyxcbiAgb3B0aW9ucz86IHsgbWV0aG9kPzogc3RyaW5nOyBib2R5PzogdW5rbm93bjsgdGltZW91dD86IG51bWJlciB9LFxuKTogUHJvbWlzZTx7IHN0YXR1czogbnVtYmVyOyBib2R5OiBzdHJpbmcgfT4ge1xuICByZXR1cm4gcGFnZS5ldmFsdWF0ZShcbiAgICBhc3luYyAoeyB1cmwsIG1ldGhvZCwgYm9keSwgdGltZW91dCB9KSA9PiB7XG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGZldGNoKHVybCwge1xuICAgICAgICBtZXRob2QsXG4gICAgICAgIGNyZWRlbnRpYWxzOiBcImluY2x1ZGVcIixcbiAgICAgICAgaGVhZGVyczpcbiAgICAgICAgICBib2R5ID09PSB1bmRlZmluZWRcbiAgICAgICAgICAgID8gdW5kZWZpbmVkXG4gICAgICAgICAgICA6IHsgXCJDb250ZW50LVR5cGVcIjogXCJhcHBsaWNhdGlvbi9qc29uXCIgfSxcbiAgICAgICAgYm9keTogYm9keSA9PT0gdW5kZWZpbmVkID8gdW5kZWZpbmVkIDogSlNPTi5zdHJpbmdpZnkoYm9keSksXG4gICAgICAgIHNpZ25hbDogdGltZW91dCA/IEFib3J0U2lnbmFsLnRpbWVvdXQodGltZW91dCkgOiB1bmRlZmluZWQsXG4gICAgICB9KTtcbiAgICAgIHJldHVybiB7IHN0YXR1czogcmVzcG9uc2Uuc3RhdHVzLCBib2R5OiBhd2FpdCByZXNwb25zZS50ZXh0KCkgfTtcbiAgICB9LFxuICAgIHtcbiAgICAgIHVybDogYXBpVXJsKHBhZ2UsIHBhdGgpLFxuICAgICAgbWV0aG9kOiBvcHRpb25zPy5tZXRob2QgPz8gXCJHRVRcIixcbiAgICAgIGJvZHk6IG9wdGlvbnM/LmJvZHksXG4gICAgICB0aW1lb3V0OiBvcHRpb25zPy50aW1lb3V0LFxuICAgIH0sXG4gICk7XG59XG5cbnR5cGUgT3JpZ2luRGlhZ25vc3RpYyA9IHtcbiAgb3JpZ2luOiBzdHJpbmc7XG4gIHBoYXNlOiBcIkdFVFwiIHwgXCJwcmVmbGlnaHRcIiB8IFwibXV0YXRpb25cIiB8IFwicmVqZWN0aW9uXCI7XG4gIHN0YXR1cz86IG51bWJlcjtcbiAgaGVhZGVycz86IFJlY29yZDxzdHJpbmcsIHN0cmluZz47XG4gIGVycm9yPzogc3RyaW5nO1xufTtcbmNvbnN0IHJlY29yZGVkT3JpZ2luRGlhZ25vc3RpY3M6IE9yaWdpbkRpYWdub3N0aWNbXSA9IFtdO1xuXG5mdW5jdGlvbiBvcmlnaW5EaWFnbm9zdGljUGF0aCgpOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICByZXR1cm4gcHJvY2Vzcy5lbnYuREFTSEJPQVJEX0UyRV9PUklHSU5fRElBR05PU1RJQ1NfUEFUSDtcbn1cblxuZnVuY3Rpb24gcmVsZXZhbnRPcmlnaW5IZWFkZXJzKFxuICBoZWFkZXJzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+LFxuKTogUmVjb3JkPHN0cmluZywgc3RyaW5nPiB7XG4gIHJldHVybiBPYmplY3QuZnJvbUVudHJpZXMoXG4gICAgT1JJR0lOX0RJQUdOT1NUSUNfSEVBREVSUy5mbGF0TWFwKChuYW1lKSA9PlxuICAgICAgaGVhZGVyc1tuYW1lXSA/IFtbbmFtZSwgaGVhZGVyc1tuYW1lXV1dIDogW10sXG4gICAgKSxcbiAgKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gd3JpdGVPcmlnaW5EaWFnbm9zdGljcygpIHtcbiAgY29uc3Qgb3V0cHV0UGF0aCA9IG9yaWdpbkRpYWdub3N0aWNQYXRoKCk7XG4gIGlmICghb3V0cHV0UGF0aCkgcmV0dXJuO1xuICBhd2FpdCBta2RpcihkaXJuYW1lKG91dHB1dFBhdGgpLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KTtcbiAgYXdhaXQgd3JpdGVGaWxlKFxuICAgIG91dHB1dFBhdGgsXG4gICAgYCR7SlNPTi5zdHJpbmdpZnkoeyBkaWFnbm9zdGljczogcmVjb3JkZWRPcmlnaW5EaWFnbm9zdGljcyB9LCBudWxsLCAyKX1cXG5gLFxuICAgIFwidXRmOFwiLFxuICApO1xufVxuXG5hc3luYyBmdW5jdGlvbiBleHBlY3RPcmlnaW5DYW5Vc2VBcGkocGFnZTogUGFnZSwgb3JpZ2luOiBzdHJpbmcpIHtcbiAgY29uc3QgYXBpQmFzZVVybCA9IHByb2Nlc3MuZW52LkRBU0hCT0FSRF9FMkVfQVBJX0JBU0VfVVJMO1xuICBpZiAoIWFwaUJhc2VVcmwpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICBcIkRBU0hCT0FSRF9FMkVfQVBJX0JBU0VfVVJMIGlzIHJlcXVpcmVkIGZvciBvcmlnaW4gY2hlY2tzLlwiLFxuICAgICk7XG4gIH1cbiAgY29uc3QgaGVhbHRoVXJsID0gbmV3IFVSTChcIi9hcGkvaGVhbHRoelwiLCBhcGlCYXNlVXJsKS50b1N0cmluZygpO1xuICBjb25zdCBtdXRhdGlvblVybCA9IG5ldyBVUkwoXCIvYXBpL2FpL2NoYXRcIiwgYXBpQmFzZVVybCkudG9TdHJpbmcoKTtcbiAgY29uc3QgY29tbW9uSGVhZGVycyA9IHsgT3JpZ2luOiBvcmlnaW4gfTtcblxuICBjb25zdCBkaWFnbm9zdGljczogT3JpZ2luRGlhZ25vc3RpY1tdID0gW107XG4gIGNvbnN0IGNoZWNrID0gYXN5bmMgKFxuICAgIHBoYXNlOiBPcmlnaW5EaWFnbm9zdGljW1wicGhhc2VcIl0sXG4gICAgcmVxdWVzdDogKCkgPT4gUHJvbWlzZTxpbXBvcnQoXCJAcGxheXdyaWdodC90ZXN0XCIpLkFQSVJlc3BvbnNlPixcbiAgICBhc3NlcnRpb246IChcbiAgICAgIHJlc3BvbnNlOiBpbXBvcnQoXCJAcGxheXdyaWdodC90ZXN0XCIpLkFQSVJlc3BvbnNlLFxuICAgICkgPT4gUHJvbWlzZTx2b2lkPixcbiAgKSA9PiB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgcmVxdWVzdCgpO1xuICAgICAgZGlhZ25vc3RpY3MucHVzaCh7XG4gICAgICAgIG9yaWdpbixcbiAgICAgICAgcGhhc2UsXG4gICAgICAgIHN0YXR1czogcmVzcG9uc2Uuc3RhdHVzKCksXG4gICAgICAgIGhlYWRlcnM6IHJlbGV2YW50T3JpZ2luSGVhZGVycyhyZXNwb25zZS5oZWFkZXJzKCkpLFxuICAgICAgfSk7XG4gICAgICByZWNvcmRlZE9yaWdpbkRpYWdub3N0aWNzLnB1c2goZGlhZ25vc3RpY3MuYXQoLTEpISk7XG4gICAgICBhd2FpdCBhc3NlcnRpb24ocmVzcG9uc2UpO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zdCBjdXJyZW50ID0gZGlhZ25vc3RpY3MuYXQoLTEpO1xuICAgICAgaWYgKGN1cnJlbnQ/LnBoYXNlICE9PSBwaGFzZSkge1xuICAgICAgICBkaWFnbm9zdGljcy5wdXNoKHsgb3JpZ2luLCBwaGFzZSB9KTtcbiAgICAgIH1cbiAgICAgIGRpYWdub3N0aWNzLmF0KC0xKSEuZXJyb3IgPSBcIm9yaWdpbiBjaGVjayBmYWlsZWRcIjtcbiAgICAgIGF3YWl0IHdyaXRlT3JpZ2luRGlhZ25vc3RpY3MoKTtcbiAgICAgIHRocm93IGVycm9yO1xuICAgIH1cbiAgfTtcblxuICBhd2FpdCBjaGVjayhcbiAgICBcIkdFVFwiLFxuICAgICgpID0+IHBhZ2UucmVxdWVzdC5nZXQoaGVhbHRoVXJsLCB7IGhlYWRlcnM6IGNvbW1vbkhlYWRlcnMgfSksXG4gICAgYXN5bmMgKHJlc3BvbnNlKSA9PiB7XG4gICAgICBleHBlY3QocmVzcG9uc2Uuc3RhdHVzKCksIGAke29yaWdpbn0gY3JlZGVudGlhbGVkIEdFVCBzdGF0dXNgKS50b0JlKDIwMCk7XG4gICAgICBleHBlY3QocmVzcG9uc2UuaGVhZGVycygpW1wiYWNjZXNzLWNvbnRyb2wtYWxsb3ctb3JpZ2luXCJdKS50b0JlKG9yaWdpbik7XG4gICAgICBleHBlY3QocmVzcG9uc2UuaGVhZGVycygpW1wiYWNjZXNzLWNvbnRyb2wtYWxsb3ctY3JlZGVudGlhbHNcIl0pLnRvQmUoXG4gICAgICAgIFwidHJ1ZVwiLFxuICAgICAgKTtcbiAgICB9LFxuICApO1xuICBhd2FpdCBjaGVjayhcbiAgICBcInByZWZsaWdodFwiLFxuICAgICgpID0+XG4gICAgICBwYWdlLnJlcXVlc3QuZmV0Y2gobXV0YXRpb25VcmwsIHtcbiAgICAgICAgbWV0aG9kOiBcIk9QVElPTlNcIixcbiAgICAgICAgaGVhZGVyczoge1xuICAgICAgICAgIC4uLmNvbW1vbkhlYWRlcnMsXG4gICAgICAgICAgXCJBY2Nlc3MtQ29udHJvbC1SZXF1ZXN0LU1ldGhvZFwiOiBcIlBPU1RcIixcbiAgICAgICAgICBcIkFjY2Vzcy1Db250cm9sLVJlcXVlc3QtSGVhZGVyc1wiOiBcImNvbnRlbnQtdHlwZVwiLFxuICAgICAgICB9LFxuICAgICAgfSksXG4gICAgYXN5bmMgKHJlc3BvbnNlKSA9PiB7XG4gICAgICBleHBlY3QocmVzcG9uc2Uuc3RhdHVzKCksIGAke29yaWdpbn0gbXV0YXRpb24gcHJlZmxpZ2h0IHN0YXR1c2ApLnRvQmUoXG4gICAgICAgIDIwNCxcbiAgICAgICk7XG4gICAgICBleHBlY3QocmVzcG9uc2UuaGVhZGVycygpW1wiYWNjZXNzLWNvbnRyb2wtYWxsb3ctb3JpZ2luXCJdKS50b0JlKG9yaWdpbik7XG4gICAgICBleHBlY3QoXG4gICAgICAgIHJlc3BvbnNlLmhlYWRlcnMoKVtcImFjY2Vzcy1jb250cm9sLWFsbG93LWNyZWRlbnRpYWxzXCJdLFxuICAgICAgICBgJHtvcmlnaW59IG11dGF0aW9uIHByZWZsaWdodCBjcmVkZW50aWFsc2AsXG4gICAgICApLnRvQmUoXCJ0cnVlXCIpO1xuICAgICAgZXhwZWN0KFxuICAgICAgICByZXNwb25zZVxuICAgICAgICAgIC5oZWFkZXJzKClcbiAgICAgICAgICBbXCJhY2Nlc3MtY29udHJvbC1hbGxvdy1tZXRob2RzXCJdPy5zcGxpdChcIixcIilcbiAgICAgICAgICAubWFwKChtZXRob2QpID0+IG1ldGhvZC50cmltKCkudG9VcHBlckNhc2UoKSksXG4gICAgICAgIGAke29yaWdpbn0gbXV0YXRpb24gcHJlZmxpZ2h0IG1ldGhvZHNgLFxuICAgICAgKS50b0NvbnRhaW4oXCJQT1NUXCIpO1xuICAgICAgZXhwZWN0KFxuICAgICAgICByZXNwb25zZVxuICAgICAgICAgIC5oZWFkZXJzKClcbiAgICAgICAgICBbXCJhY2Nlc3MtY29udHJvbC1hbGxvdy1oZWFkZXJzXCJdPy5zcGxpdChcIixcIilcbiAgICAgICAgICAubWFwKChoZWFkZXIpID0+IGhlYWRlci50cmltKCkudG9Mb3dlckNhc2UoKSksXG4gICAgICAgIGAke29yaWdpbn0gbXV0YXRpb24gcHJlZmxpZ2h0IGhlYWRlcnNgLFxuICAgICAgKS50b0NvbnRhaW4oXCJjb250ZW50LXR5cGVcIik7XG4gICAgfSxcbiAgKTtcbiAgYXdhaXQgY2hlY2soXG4gICAgXCJtdXRhdGlvblwiLFxuICAgICgpID0+XG4gICAgICBwYWdlLnJlcXVlc3QucG9zdChtdXRhdGlvblVybCwge1xuICAgICAgICBoZWFkZXJzOiB7IC4uLmNvbW1vbkhlYWRlcnMsIFwiQ29udGVudC1UeXBlXCI6IFwiYXBwbGljYXRpb24vanNvblwiIH0sXG4gICAgICAgIGRhdGE6IHsgbWVzc2FnZTogXCJvcmlnaW4gY29udHJhY3RcIiB9LFxuICAgICAgfSksXG4gICAgYXN5bmMgKHJlc3BvbnNlKSA9PiB7XG4gICAgICBleHBlY3QoXG4gICAgICAgIHJlc3BvbnNlLnN0YXR1cygpLFxuICAgICAgICBgJHtvcmlnaW59IHN0YXRlLWNoYW5naW5nIHJlcXVlc3QgbXVzdCBwYXNzIG9yaWdpbiBwcm90ZWN0aW9uYCxcbiAgICAgICkubm90LnRvQmUoNDAzKTtcbiAgICAgIGV4cGVjdChyZXNwb25zZS5oZWFkZXJzKClbXCJhY2Nlc3MtY29udHJvbC1hbGxvdy1vcmlnaW5cIl0pLnRvQmUob3JpZ2luKTtcbiAgICAgIGV4cGVjdChyZXNwb25zZS5oZWFkZXJzKClbXCJhY2Nlc3MtY29udHJvbC1hbGxvdy1jcmVkZW50aWFsc1wiXSkudG9CZShcbiAgICAgICAgXCJ0cnVlXCIsXG4gICAgICApO1xuICAgIH0sXG4gICk7XG4gIGF3YWl0IHdyaXRlT3JpZ2luRGlhZ25vc3RpY3MoKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZXhwZWN0SG9zdGlsZU9yaWdpblJlamVjdGVkKHBhZ2U6IFBhZ2UpIHtcbiAgY29uc3QgYXBpQmFzZVVybCA9IHByb2Nlc3MuZW52LkRBU0hCT0FSRF9FMkVfQVBJX0JBU0VfVVJMO1xuICBpZiAoIWFwaUJhc2VVcmwpXG4gICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgXCJEQVNIQk9BUkRfRTJFX0FQSV9CQVNFX1VSTCBpcyByZXF1aXJlZCBmb3Igb3JpZ2luIGNoZWNrcy5cIixcbiAgICApO1xuICBjb25zdCBtdXRhdGlvblVybCA9IG5ldyBVUkwoXCIvYXBpL2FpL2NoYXRcIiwgYXBpQmFzZVVybCkudG9TdHJpbmcoKTtcbiAgY29uc3QgdXBsb2FkVXJsID0gbmV3IFVSTChcIi9hcGkvdXBsb2FkL2FyY2hpdmVcIiwgYXBpQmFzZVVybCkudG9TdHJpbmcoKTtcbiAgY29uc3QgbGl2ZVVwZGF0ZVVybCA9IG5ldyBVUkwoXCIvYXBpL2FpL2NoYXQvc3RyZWFtXCIsIGFwaUJhc2VVcmwpLnRvU3RyaW5nKCk7XG4gIGNvbnN0IGRpYWdub3N0aWM6IE9yaWdpbkRpYWdub3N0aWMgPSB7XG4gICAgb3JpZ2luOiBIT1NUSUxFX09SSUdJTixcbiAgICBwaGFzZTogXCJyZWplY3Rpb25cIixcbiAgfTtcbiAgcmVjb3JkZWRPcmlnaW5EaWFnbm9zdGljcy5wdXNoKGRpYWdub3N0aWMpO1xuICB0cnkge1xuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgcGFnZS5yZXF1ZXN0LnBvc3QobXV0YXRpb25VcmwsIHtcbiAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgT3JpZ2luOiBIT1NUSUxFX09SSUdJTixcbiAgICAgICAgXCJDb250ZW50LVR5cGVcIjogXCJhcHBsaWNhdGlvbi9qc29uXCIsXG4gICAgICB9LFxuICAgICAgZGF0YTogeyBtZXNzYWdlOiBcImhvc3RpbGUgb3JpZ2luIGNvbnRyYWN0XCIgfSxcbiAgICB9KTtcbiAgICBkaWFnbm9zdGljLnN0YXR1cyA9IHJlc3BvbnNlLnN0YXR1cygpO1xuICAgIGRpYWdub3N0aWMuaGVhZGVycyA9IHJlbGV2YW50T3JpZ2luSGVhZGVycyhyZXNwb25zZS5oZWFkZXJzKCkpO1xuICAgIGV4cGVjdChyZXNwb25zZS5zdGF0dXMoKSkudG9CZSg0MDMpO1xuICAgIGV4cGVjdChyZXNwb25zZS5oZWFkZXJzKClbXCJhY2Nlc3MtY29udHJvbC1hbGxvdy1vcmlnaW5cIl0pLnRvQmVVbmRlZmluZWQoKTtcbiAgICBleHBlY3QoXG4gICAgICByZXNwb25zZS5oZWFkZXJzKClbXCJhY2Nlc3MtY29udHJvbC1hbGxvdy1jcmVkZW50aWFsc1wiXSxcbiAgICApLnRvQmVVbmRlZmluZWQoKTtcblxuICAgIGNvbnN0IGhvc3RpbGVVcGxvYWQgPSBhd2FpdCBwYWdlLnJlcXVlc3QucG9zdCh1cGxvYWRVcmwsIHtcbiAgICAgIGhlYWRlcnM6IHsgT3JpZ2luOiBIT1NUSUxFX09SSUdJTiB9LFxuICAgICAgbXVsdGlwYXJ0OiB7XG4gICAgICAgIGFyY2hpdmU6IHtcbiAgICAgICAgICBuYW1lOiBcImhvc3RpbGUtZGFzaGJvYXJkLWpvdXJuZXkuemlwXCIsXG4gICAgICAgICAgbWltZVR5cGU6IFwiYXBwbGljYXRpb24vemlwXCIsXG4gICAgICAgICAgYnVmZmVyOiBCdWZmZXIuZnJvbShcIm5vdCBhbiBhcmNoaXZlXCIpLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICB9KTtcbiAgICBleHBlY3QoaG9zdGlsZVVwbG9hZC5zdGF0dXMoKSkudG9CZSg0MDMpO1xuICAgIGV4cGVjdChcbiAgICAgIGhvc3RpbGVVcGxvYWQuaGVhZGVycygpW1wiYWNjZXNzLWNvbnRyb2wtYWxsb3ctb3JpZ2luXCJdLFxuICAgICkudG9CZVVuZGVmaW5lZCgpO1xuXG4gICAgY29uc3QgaG9zdGlsZUxpdmVVcGRhdGUgPSBhd2FpdCBwYWdlLnJlcXVlc3QucG9zdChsaXZlVXBkYXRlVXJsLCB7XG4gICAgICBoZWFkZXJzOiB7XG4gICAgICAgIE9yaWdpbjogSE9TVElMRV9PUklHSU4sXG4gICAgICAgIFwiQ29udGVudC1UeXBlXCI6IFwiYXBwbGljYXRpb24vanNvblwiLFxuICAgICAgfSxcbiAgICAgIGRhdGE6IHt9LFxuICAgIH0pO1xuICAgIGV4cGVjdChob3N0aWxlTGl2ZVVwZGF0ZS5zdGF0dXMoKSkudG9CZSg0MDMpO1xuICAgIGV4cGVjdChcbiAgICAgIGhvc3RpbGVMaXZlVXBkYXRlLmhlYWRlcnMoKVtcImFjY2Vzcy1jb250cm9sLWFsbG93LW9yaWdpblwiXSxcbiAgICApLnRvQmVVbmRlZmluZWQoKTtcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICBkaWFnbm9zdGljLmVycm9yID0gXCJvcmlnaW4gcmVqZWN0aW9uIGNoZWNrIGZhaWxlZFwiO1xuICAgIGF3YWl0IHdyaXRlT3JpZ2luRGlhZ25vc3RpY3MoKTtcbiAgICB0aHJvdyBlcnJvcjtcbiAgfVxuICBhd2FpdCB3cml0ZU9yaWdpbkRpYWdub3N0aWNzKCk7XG59XG5cbmZ1bmN0aW9uIHBhcnNlU3NlKGJvZHk6IHN0cmluZyk6IEFycmF5PFJlY29yZDxzdHJpbmcsIHVua25vd24+PiB7XG4gIHJldHVybiBib2R5LnNwbGl0KC9cXG5cXG4rLykuZmxhdE1hcCgoY2h1bmspID0+IHtcbiAgICBjb25zdCBkYXRhID0gY2h1bmtcbiAgICAgIC5zcGxpdChcIlxcblwiKVxuICAgICAgLmZpbmQoKGxpbmUpID0+IGxpbmUuc3RhcnRzV2l0aChcImRhdGE6IFwiKSlcbiAgICAgID8uc2xpY2UoXCJkYXRhOiBcIi5sZW5ndGgpO1xuICAgIGlmICghZGF0YSkgcmV0dXJuIFtdO1xuICAgIHRyeSB7XG4gICAgICBjb25zdCB2YWx1ZSA9IEpTT04ucGFyc2UoZGF0YSkgYXMgdW5rbm93bjtcbiAgICAgIHJldHVybiB2YWx1ZSAmJiB0eXBlb2YgdmFsdWUgPT09IFwib2JqZWN0XCJcbiAgICAgICAgPyBbdmFsdWUgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj5dXG4gICAgICAgIDogW107XG4gICAgfSBjYXRjaCB7XG4gICAgICByZXR1cm4gW107XG4gICAgfVxuICB9KTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gbGl2ZUpzb24oXG4gIHBhZ2U6IFBhZ2UsXG4gIHBhdGg6IHN0cmluZyxcbik6IFByb21pc2U8UmVjb3JkPHN0cmluZywgYW55Pj4ge1xuICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGxpdmVSZXF1ZXN0KHBhZ2UsIHBhdGgpO1xuICBpZiAocmVzcG9uc2Uuc3RhdHVzIDwgMjAwIHx8IHJlc3BvbnNlLnN0YXR1cyA+PSAzMDApIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICBgTGl2ZSBjb3JyZWxhdGlvbiByZXF1ZXN0IGZhaWxlZDogJHtwYXRofSAoJHtyZXNwb25zZS5zdGF0dXN9KWAsXG4gICAgKTtcbiAgfVxuICByZXR1cm4gSlNPTi5wYXJzZShyZXNwb25zZS5ib2R5KSBhcyBSZWNvcmQ8c3RyaW5nLCBhbnk+O1xufVxuXG5hc3luYyBmdW5jdGlvbiBsaXZlQXJyYXkoXG4gIHBhZ2U6IFBhZ2UsXG4gIHBhdGg6IHN0cmluZyxcbik6IFByb21pc2U8QXJyYXk8UmVjb3JkPHN0cmluZywgYW55Pj4+IHtcbiAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBsaXZlUmVxdWVzdChwYWdlLCBwYXRoKTtcbiAgaWYgKHJlc3BvbnNlLnN0YXR1cyA9PT0gNDA0KSByZXR1cm4gW107XG4gIGlmIChyZXNwb25zZS5zdGF0dXMgPCAyMDAgfHwgcmVzcG9uc2Uuc3RhdHVzID49IDMwMCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgIGBMaXZlIGNvcnJlbGF0aW9uIHJlcXVlc3QgZmFpbGVkOiAke3BhdGh9ICgke3Jlc3BvbnNlLnN0YXR1c30pYCxcbiAgICApO1xuICB9XG4gIGNvbnN0IHZhbHVlID0gSlNPTi5wYXJzZShyZXNwb25zZS5ib2R5KTtcbiAgcmV0dXJuIEFycmF5LmlzQXJyYXkodmFsdWUpID8gdmFsdWUgOiBbXTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gbGl2ZU9wdGlvbmFsUmVjb3JkKFxuICBwYWdlOiBQYWdlLFxuICBwYXRoOiBzdHJpbmcsXG4pOiBQcm9taXNlPFJlY29yZDxzdHJpbmcsIGFueT4gfCB1bmRlZmluZWQ+IHtcbiAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBsaXZlUmVxdWVzdChwYWdlLCBwYXRoKTtcbiAgaWYgKHJlc3BvbnNlLnN0YXR1cyA9PT0gNDA0KSByZXR1cm4gdW5kZWZpbmVkO1xuICBpZiAocmVzcG9uc2Uuc3RhdHVzIDwgMjAwIHx8IHJlc3BvbnNlLnN0YXR1cyA+PSAzMDApIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICBgTGl2ZSBjb3JyZWxhdGlvbiByZXF1ZXN0IGZhaWxlZDogJHtwYXRofSAoJHtyZXNwb25zZS5zdGF0dXN9KWAsXG4gICAgKTtcbiAgfVxuICBjb25zdCB2YWx1ZSA9IEpTT04ucGFyc2UocmVzcG9uc2UuYm9keSk7XG4gIHJldHVybiB2YWx1ZSAmJiB0eXBlb2YgdmFsdWUgPT09IFwib2JqZWN0XCIgJiYgIUFycmF5LmlzQXJyYXkodmFsdWUpXG4gICAgPyAodmFsdWUgYXMgUmVjb3JkPHN0cmluZywgYW55PilcbiAgICA6IHVuZGVmaW5lZDtcbn1cblxudGVzdC5kZXNjcmliZShcIkVuZ2luZWVyaW5nT1MgZGFzaGJvYXJkIGJyb3dzZXIgam91cm5leVwiLCAoKSA9PiB7XG4gIHRlc3QoXCJleHBvcnRzIG9uZSByZWRhY3RlZCBsaXZlLXByb3ZpZGVyIG1pc3Npb24gY29ycmVsYXRpb24gcmVwb3J0XCIsIGFzeW5jICh7XG4gICAgcGFnZSxcbiAgfSkgPT4ge1xuICAgIC8vIFRoZSBQbGF5d3JpZ2h0IGRlYWRsaW5lIG11c3QgbGVhdmUgcm9vbSBmb3IgdGhlIHByb3ZpZGVyLWJvdW5kIHJlcXVlc3RcbiAgICAvLyBhbmQgcG9sbGluZyBsb29wIHRvIGNvbnN1bWUgdGhlaXIgY29tcGxldGUgY29uZmlndXJlZCBidWRnZXQuXG4gICAgdGVzdC5zZXRUaW1lb3V0KGxpdmVUaW1lb3V0TXMoKSArIExJVkVfVEVTVF9USU1FT1VUX01BUkdJTl9NUyk7XG4gICAgdGVzdC5za2lwKFxuICAgICAgcHJvY2Vzcy5lbnYuREFTSEJPQVJEX0UyRV9MSVZFX1BST1ZJREVSICE9PSBcIjFcIixcbiAgICAgIFwiTGl2ZS1wcm92aWRlciByZWxlYXNlIGpvdXJuZXkgaXMgb3B0LWluLlwiLFxuICAgICk7XG4gICAgaWYgKHByb2Nlc3MuZW52LkRBU0hCT0FSRF9FMkVfTElWRV9ESVNQT1NBQkxFICE9PSBcIjFcIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICBcIkxpdmUtcHJvdmlkZXIgam91cm5leSByZXF1aXJlcyBEQVNIQk9BUkRfRTJFX0xJVkVfRElTUE9TQUJMRT0xIGFuZCBhIGRpc3Bvc2FibGUgcHJvamVjdC5cIixcbiAgICAgICk7XG4gICAgfVxuICAgIGNvbnN0IGNhbXBhaWduU2NlbmFyaW8gPSBsaXZlQ2FtcGFpZ25TY2VuYXJpbygpO1xuICAgIGNvbnN0IHByb2plY3RJZCA9IHByb2Nlc3MuZW52LkRBU0hCT0FSRF9FMkVfTElWRV9QUk9KRUNUX0lEO1xuICAgIGlmICghcHJvamVjdElkKVxuICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICBcIkRBU0hCT0FSRF9FMkVfTElWRV9QUk9KRUNUX0lEIGlzIHJlcXVpcmVkIGZvciB0aGUgbGl2ZS1wcm92aWRlciBqb3VybmV5LlwiLFxuICAgICAgKTtcblxuICAgIGF3YWl0IHByb2dyYW1tYXRpY1NpZ25JbihwYWdlKTtcbiAgICBjb25zdCBzdHJlYW1SZXNwb25zZSA9IGF3YWl0IGxpdmVSZXF1ZXN0KHBhZ2UsIFwiL2FwaS9haS9jaGF0L3N0cmVhbVwiLCB7XG4gICAgICBtZXRob2Q6IFwiUE9TVFwiLFxuICAgICAgdGltZW91dDogbGl2ZVRpbWVvdXRNcygpLFxuICAgICAgYm9keToge1xuICAgICAgICBwcm9qZWN0SWQsXG4gICAgICAgICBtZXNzYWdlOiBsaXZlUHJvbXB0KCksXG4gICAgICAgIGlkZW1wb3RlbmN5S2V5OiBgZGFzaGJvYXJkLWxpdmUtJHtEYXRlLm5vdygpfWAsXG4gICAgICB9LFxuICAgIH0pO1xuICAgIGlmIChzdHJlYW1SZXNwb25zZS5zdGF0dXMgPCAyMDAgfHwgc3RyZWFtUmVzcG9uc2Uuc3RhdHVzID49IDMwMCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICBgTGl2ZS1wcm92aWRlciBtaXNzaW9uIGZhaWxlZCB0byBzdGFydCAoJHtzdHJlYW1SZXNwb25zZS5zdGF0dXN9KS5gLFxuICAgICAgKTtcbiAgICB9XG4gICAgY29uc3Qgc3NlRXZlbnRzID0gcGFyc2VTc2Uoc3RyZWFtUmVzcG9uc2UuYm9keSk7XG4gICAgY29uc3Qgc3RhcnRlZCA9IHNzZUV2ZW50cy5maW5kKFxuICAgICAgKGV2ZW50KSA9PiBldmVudC50eXBlID09PSBcImV4ZWN1dGlvbl9zdGFydGVkXCIsXG4gICAgKTtcbiAgICBjb25zdCBleGVjdXRpb25JZCA9XG4gICAgICB0eXBlb2Ygc3RhcnRlZD8uZXhlY3V0aW9uSWQgPT09IFwic3RyaW5nXCJcbiAgICAgICAgPyBzdGFydGVkLmV4ZWN1dGlvbklkXG4gICAgICAgIDogdW5kZWZpbmVkO1xuICAgIGlmICghZXhlY3V0aW9uSWQpXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJMaXZlLXByb3ZpZGVyIHN0cmVhbSBkaWQgbm90IGVtaXQgZXhlY3V0aW9uX3N0YXJ0ZWQuXCIpO1xuICAgIGNvbnN0IHRlcm1pbmFsRG9uZSA9IHNzZUV2ZW50cy5maW5kKChldmVudCkgPT4gZXZlbnQudHlwZSA9PT0gXCJkb25lXCIpO1xuICAgIGNvbnN0IHRlcm1pbmFsTWVzc2FnZSA9XG4gICAgICB0ZXJtaW5hbERvbmU/Lm1lc3NhZ2UgJiZcbiAgICAgIHR5cGVvZiB0ZXJtaW5hbERvbmUubWVzc2FnZSA9PT0gXCJvYmplY3RcIiAmJlxuICAgICAgIUFycmF5LmlzQXJyYXkodGVybWluYWxEb25lLm1lc3NhZ2UpXG4gICAgICAgID8gKHRlcm1pbmFsRG9uZS5tZXNzYWdlIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+KVxuICAgICAgICA6IHVuZGVmaW5lZDtcbiAgICBpZiAoXG4gICAgICAhdGVybWluYWxEb25lIHx8XG4gICAgICB0ZXJtaW5hbE1lc3NhZ2U/LmV4ZWN1dGlvbklkICE9PSBleGVjdXRpb25JZFxuICAgICkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICBcIkxpdmUtcHJvdmlkZXIgc3RyZWFtIGRpZCBub3QgZW1pdCBhIHRlcm1pbmFsIGRvbmUgZXZlbnQgZm9yIGl0cyBleGVjdXRpb24uXCIsXG4gICAgICApO1xuICAgIH1cblxuICAgIGxldCBleGVjdXRpb246IFJlY29yZDxzdHJpbmcsIGFueT4gPSB7fTtcbiAgICBjb25zdCBkZWFkbGluZSA9IERhdGUubm93KCkgKyBsaXZlVGltZW91dE1zKCk7XG4gICAgd2hpbGUgKERhdGUubm93KCkgPCBkZWFkbGluZSkge1xuICAgICAgZXhlY3V0aW9uID0gYXdhaXQgbGl2ZUpzb24ocGFnZSwgYC9hcGkvYWkvZXhlY3V0aW9ucy8ke2V4ZWN1dGlvbklkfWApO1xuICAgICAgaWYgKFxuICAgICAgICBbXCJjb21wbGV0ZWRcIiwgXCJmYWlsZWRcIiwgXCJjYW5jZWxsZWRcIl0uaW5jbHVkZXMoU3RyaW5nKGV4ZWN1dGlvbi5zdGF0dXMpKVxuICAgICAgKVxuICAgICAgICBicmVhaztcbiAgICAgIGF3YWl0IG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiBzZXRUaW1lb3V0KHJlc29sdmUsIDc1MCkpO1xuICAgIH1cbiAgICBpZiAoXG4gICAgICAhW1wiY29tcGxldGVkXCIsIFwiZmFpbGVkXCIsIFwiY2FuY2VsbGVkXCJdLmluY2x1ZGVzKFN0cmluZyhleGVjdXRpb24uc3RhdHVzKSlcbiAgICApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgXCJMaXZlLXByb3ZpZGVyIG1pc3Npb24gZGlkIG5vdCByZWFjaCBhIHRlcm1pbmFsIHN0YXRlIHdpdGhpbiBpdHMgYm91bmQuXCIsXG4gICAgICApO1xuICAgIH1cblxuICAgIGNvbnN0IHNlc3Npb25JZCA9IFN0cmluZyhleGVjdXRpb24uc2Vzc2lvbklkKTtcbiAgICBjb25zdCBtZXNzYWdlcyA9IGF3YWl0IGxpdmVBcnJheShcbiAgICAgIHBhZ2UsXG4gICAgICBgL2FwaS9haS9jaGF0LyR7c2Vzc2lvbklkfS9tZXNzYWdlc2AsXG4gICAgKTtcbiAgICBjb25zdCBldmVudHMgPSBhd2FpdCBsaXZlQXJyYXkoXG4gICAgICBwYWdlLFxuICAgICAgYC9hcGkvZXZlbnRzP3Byb2plY3RJZD0ke2VuY29kZVVSSUNvbXBvbmVudChwcm9qZWN0SWQpfSZjb3JyZWxhdGlvbklkPSR7ZW5jb2RlVVJJQ29tcG9uZW50KFN0cmluZyhleGVjdXRpb24ub3BlcmF0aW9uSWQgPz8gXCJcIikpfWAsXG4gICAgKTtcbiAgICBjb25zdCBwcm9wb3NhbCA9IGF3YWl0IGxpdmVPcHRpb25hbFJlY29yZChcbiAgICAgIHBhZ2UsXG4gICAgICBgL2FwaS9haS9jaGF0LyR7c2Vzc2lvbklkfS9wZW5kaW5nLXByb3Bvc2FsYCxcbiAgICApO1xuICAgIGNvbnN0IGdpdExvZyA9IGF3YWl0IGxpdmVKc29uKHBhZ2UsIGAvYXBpL3Byb2plY3RzLyR7cHJvamVjdElkfS9naXQvbG9nYCk7XG4gICAgY29uc3QgbWlzc2lvbkNvbnRyb2wgPSBhd2FpdCBsaXZlSnNvbihwYWdlLCBcIi9hcGkvYWkvbWlzc2lvbi1jb250cm9sXCIpO1xuICAgIGNvbnN0IGRhc2hib2FyZFN0YXRlID0gYXdhaXQgbGl2ZUpzb24ocGFnZSwgXCIvYXBpL2Rhc2hib2FyZFwiKTtcbiAgICBjb25zdCBjaGVja3BvaW50ID1cbiAgICAgIGV4ZWN1dGlvbi5jaGVja3BvaW50ICYmIHR5cGVvZiBleGVjdXRpb24uY2hlY2twb2ludCA9PT0gXCJvYmplY3RcIlxuICAgICAgICA/IChleGVjdXRpb24uY2hlY2twb2ludCBhcyBSZWNvcmQ8c3RyaW5nLCBhbnk+KVxuICAgICAgICA6IHt9O1xuICAgIGNvbnN0IHJlY2VudFN0ZXBzID0gQXJyYXkuaXNBcnJheShjaGVja3BvaW50LnJlY2VudFN0ZXBzKVxuICAgICAgPyBjaGVja3BvaW50LnJlY2VudFN0ZXBzXG4gICAgICA6IFtdO1xuICAgIGNvbnN0IHZhbGlkYXRpb24gPSByZWNlbnRTdGVwcy5maWx0ZXIoXG4gICAgICAoc3RlcCkgPT4gc3RlcD8ua2luZCA9PT0gXCJ2YWxpZGF0aW9uXCIsXG4gICAgKTtcbiAgICBjb25zdCBwcm9qZWN0UmV2aXNpb24gPVxuICAgICAgdHlwZW9mIGV4ZWN1dGlvbi5wcm9qZWN0UmV2aXNpb24gPT09IFwic3RyaW5nXCJcbiAgICAgICAgPyBleGVjdXRpb24ucHJvamVjdFJldmlzaW9uXG4gICAgICAgIDogdW5kZWZpbmVkO1xuICAgIGNvbnN0IGNhbmRpZGF0ZUhhc2ggPSB2YWxpZGF0aW9uXG4gICAgICAubWFwKChzdGVwKSA9PiBzdGVwPy52YWxpZGF0aW9uPy5jYW5kaWRhdGVIYXNoID8/IHN0ZXA/LmNhbmRpZGF0ZUhhc2gpXG4gICAgICAuZmluZCgodmFsdWUpOiB2YWx1ZSBpcyBzdHJpbmcgPT4gdHlwZW9mIHZhbHVlID09PSBcInN0cmluZ1wiICYmIHZhbHVlLmxlbmd0aCA+IDApO1xuICAgIGNvbnN0IGNhbmRpZGF0ZUlkZW50aXR5ID1cbiAgICAgIHR5cGVvZiBleGVjdXRpb24uY2FuZGlkYXRlSWRlbnRpdHkgPT09IFwic3RyaW5nXCJcbiAgICAgICAgPyBleGVjdXRpb24uY2FuZGlkYXRlSWRlbnRpdHlcbiAgICAgICAgOiBjYW5kaWRhdGVIYXNoXG4gICAgICAgICAgPyBgY2FuZGlkYXRlOiR7Y2FuZGlkYXRlSGFzaH1gXG4gICAgICAgICAgOiBgcmVhZC1vbmx5OiR7cHJvamVjdFJldmlzaW9uID8/IFwidW5rbm93blwifWA7XG4gICAgaWYgKCFwcm9qZWN0UmV2aXNpb24pIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkxpdmUtcHJvdmlkZXIgbWlzc2lvbiBpcyBtaXNzaW5nIGl0cyBwcm9qZWN0IHJldmlzaW9uLlwiKTtcbiAgICB9XG4gICAgaWYgKFxuICAgICAgcHJvY2Vzcy5lbnYuREFTSEJPQVJEX0UyRV9MSVZFX0NBTVBBSUdOID09PSBcIjFcIiAmJlxuICAgICAgKCFjYW5kaWRhdGVJZGVudGl0eSB8fCAhcHJvamVjdFJldmlzaW9uKVxuICAgICkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiTGl2ZSBjYW1wYWlnbiByZXF1aXJlcyBvcGVyYXRpb24sIHJldmlzaW9uLCBhbmQgY2FuZGlkYXRlIGNvcnJlbGF0aW9uLlwiKTtcbiAgICB9XG4gICAgY29uc3QgZXZpZGVuY2VDb3VudCA9IHJlY2VudFN0ZXBzLnJlZHVjZShcbiAgICAgIChjb3VudCwgc3RlcCkgPT4gY291bnQgKyAoTnVtYmVyKHN0ZXA/LmFjY2VwdGVkRXZpZGVuY2VDb3VudCkgfHwgMCksXG4gICAgICAwLFxuICAgICk7XG4gICAgY29uc3QgdGVybWluYWxTdGF0ZSA9IFN0cmluZyhcbiAgICAgIGV4ZWN1dGlvbi5mbGlnaHRTdGF0ZSA/PyBleGVjdXRpb24uc3RhdHVzLFxuICAgICkudG9VcHBlckNhc2UoKTtcbiAgICBjb25zdCBzdWNjZXNzU3RhdGVzID0gbmV3IFNldChbXG4gICAgICBcIkNPTVBMRVRFRFwiLFxuICAgICAgXCJSRUFEWV9GT1JfUkVWSUVXXCIsXG4gICAgICBcIkFQUExJRURcIixcbiAgICAgIFwiQ09NTUlUVEVEXCIsXG4gICAgICBcIlBVU0hFRFwiLFxuICAgIF0pO1xuICAgIGlmIChcbiAgICAgIGNhbXBhaWduU2NlbmFyaW8gPT09IFwiZGVsaXZlcnktc3VjY2Vzc1wiICYmXG4gICAgICBzdWNjZXNzU3RhdGVzLmhhcyh0ZXJtaW5hbFN0YXRlKSAmJlxuICAgICAgIWNhbmRpZGF0ZUhhc2hcbiAgICApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgXCJEZWxpdmVyeS1zdWNjZXNzIGNhbXBhaWduIGNhbm5vdCBwYXNzIHdpdGhvdXQgYSBjYW5kaWRhdGUtYm91bmQgdmFsaWRhdGlvbiBoYXNoLlwiLFxuICAgICAgKTtcbiAgICB9XG4gICAgY29uc3QgZGVsaXZlcnlTdGFnZXMgPSB7XG4gICAgICBhcHBsaWVkOiBldmVudHMuc29tZSgoZXZlbnQpID0+IGV2ZW50Py50eXBlID09PSBcIkFpQ2hhbmdlc0FwcGxpZWRcIiksXG4gICAgICBjb21taXR0ZWQ6IGV2ZW50cy5zb21lKChldmVudCkgPT4gZXZlbnQ/LnR5cGUgPT09IFwiR2l0Q29tbWl0Q3JlYXRlZFwiKSxcbiAgICAgIHB1c2hlZDogZXZlbnRzLnNvbWUoKGV2ZW50KSA9PiBldmVudD8udHlwZSA9PT0gXCJHaXRQdXNoZWRcIiksXG4gICAgfTtcbiAgICBpZiAoXG4gICAgICBjYW1wYWlnblNjZW5hcmlvID09PSBcImRlbGl2ZXJ5LXN1Y2Nlc3NcIiAmJlxuICAgICAgc3VjY2Vzc1N0YXRlcy5oYXModGVybWluYWxTdGF0ZSkgJiZcbiAgICAgICFPYmplY3QudmFsdWVzKGRlbGl2ZXJ5U3RhZ2VzKS5ldmVyeShCb29sZWFuKVxuICAgICkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICBcIkRlbGl2ZXJ5LXN1Y2Nlc3MgY2FtcGFpZ24gY2Fubm90IHBhc3Mgd2l0aG91dCBvcGVyYXRpb24tY29ycmVsYXRlZCBhcHBseSwgY29tbWl0LCBhbmQgcHVzaCBldmlkZW5jZS5cIixcbiAgICAgICk7XG4gICAgfVxuICAgIGlmIChcbiAgICAgIHN1Y2Nlc3NTdGF0ZXMuaGFzKHRlcm1pbmFsU3RhdGUpICYmXG4gICAgICAoZXZpZGVuY2VDb3VudCA8IDEgfHwgdmFsaWRhdGlvbi5sZW5ndGggPCAxKVxuICAgICkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICBgTGl2ZS1wcm92aWRlciBtaXNzaW9uIHJlcG9ydGVkICR7dGVybWluYWxTdGF0ZX0gd2l0aG91dCBhY2NlcHRlZCBldmlkZW5jZSBhbmQgdmFsaWRhdGlvbiBgICtcbiAgICAgICAgICBgKGV2aWRlbmNlPSR7ZXZpZGVuY2VDb3VudH0sIHZhbGlkYXRpb249JHt2YWxpZGF0aW9uLmxlbmd0aH0pLmAsXG4gICAgICApO1xuICAgIH1cbiAgICBjb25zdCBjYXB0dXJlID0ge1xuICAgICAgcHJvamVjdElkLFxuICAgICAgc2Vzc2lvbklkLFxuICAgICAgb3BlcmF0aW9uSWQ6IGV4ZWN1dGlvbi5vcGVyYXRpb25JZCxcbiAgICAgIHdvcmtzcGFjZVJldmlzaW9uOlxuICAgICAgICBnaXRMb2cuY29tbWl0cz8uWzBdPy5zaG9ydEhhc2ggPz9cbiAgICAgICAgZ2l0TG9nLmNvbW1pdHM/LlswXT8uaGFzaD8uc2xpY2UoMCwgMTIpLFxuICAgICAgcHJvamVjdFJldmlzaW9uLFxuICAgICAgY2FuZGlkYXRlSWRlbnRpdHksXG4gICAgICBjYW5kaWRhdGVSZXZpc2lvbjogcHJvamVjdFJldmlzaW9uLFxuICAgICAgY2FtcGFpZ25TY2VuYXJpbyxcbiAgICAgIGRlbGl2ZXJ5U3RhZ2VzLFxuICAgICAgY3VycmVudE9wZXJhdGlvbjoge1xuICAgICAgICBvcGVyYXRpb25JZDogZXhlY3V0aW9uLm9wZXJhdGlvbklkLFxuICAgICAgICByZXZpc2lvbjogcHJvamVjdFJldmlzaW9uLFxuICAgICAgICBzdGF0dXM6IGV4ZWN1dGlvbi5zdGF0dXMsXG4gICAgICAgIHRlcm1pbmFsU3RhdGUsXG4gICAgICB9LFxuICAgICAgcmV0YWluZWRSZXN1bHQ6XG4gICAgICAgIHRlcm1pbmFsU3RhdGUgPT09IFwiRkFJTEVEXCIgfHwgdGVybWluYWxTdGF0ZSA9PT0gXCJCTE9DS0VEXCIgfHwgdGVybWluYWxTdGF0ZSA9PT0gXCJJTkNPTVBMRVRFXCJcbiAgICAgICAgICA/IHtcbiAgICAgICAgICAgICAgb3BlcmF0aW9uSWQ6IGV4ZWN1dGlvbi5vcGVyYXRpb25JZCxcbiAgICAgICAgICAgICAgcmV2aXNpb246IHByb2plY3RSZXZpc2lvbixcbiAgICAgICAgICAgICAgbGFiZWw6IFwicmV0YWluZWQgcmVzdWx0IGZyb20gdGhlIGN1cnJlbnQgZmFpbGVkIG9yIGluY29tcGxldGUgb3BlcmF0aW9uXCIsXG4gICAgICAgICAgICB9XG4gICAgICAgICAgOiB1bmRlZmluZWQsXG4gICAgICB0ZXJtaW5hbFN0YXRlLFxuICAgICAgZXhlY3V0aW9uOiB7XG4gICAgICAgIGlkOiBleGVjdXRpb24uaWQsXG4gICAgICAgIHByb2plY3RJZDogZXhlY3V0aW9uLnByb2plY3RJZCxcbiAgICAgICAgc2Vzc2lvbklkOiBleGVjdXRpb24uc2Vzc2lvbklkLFxuICAgICAgICBvcGVyYXRpb25JZDogZXhlY3V0aW9uLm9wZXJhdGlvbklkLFxuICAgICAgICBzdGF0dXM6IGV4ZWN1dGlvbi5zdGF0dXMsXG4gICAgICAgIGZsaWdodFN0YXRlOiBleGVjdXRpb24uZmxpZ2h0U3RhdGUsXG4gICAgICB9LFxuICAgICAgbWVzc2FnZXM6IG1lc3NhZ2VzLm1hcChcbiAgICAgICAgKHtcbiAgICAgICAgICBpZCxcbiAgICAgICAgICBzZXNzaW9uSWQ6IG1lc3NhZ2VTZXNzaW9uLFxuICAgICAgICAgIHJvbGUsXG4gICAgICAgICAgZXhlY3V0aW9uSWQ6IG1lc3NhZ2VFeGVjdXRpb24sXG4gICAgICAgICAgb3V0Y29tZSxcbiAgICAgICAgfSkgPT4gKHtcbiAgICAgICAgICBpZCxcbiAgICAgICAgICBzZXNzaW9uSWQ6IG1lc3NhZ2VTZXNzaW9uLFxuICAgICAgICAgIHJvbGUsXG4gICAgICAgICAgZXhlY3V0aW9uSWQ6IG1lc3NhZ2VFeGVjdXRpb24sXG4gICAgICAgICAgb3V0Y29tZSxcbiAgICAgICAgfSksXG4gICAgICApLFxuICAgICAgc3NlRXZlbnRzOiBzc2VFdmVudHMubWFwKFxuICAgICAgICAoe1xuICAgICAgICAgIHR5cGUsXG4gICAgICAgICAgZXhlY3V0aW9uSWQ6IGV2ZW50RXhlY3V0aW9uLFxuICAgICAgICAgIHNlc3Npb25JZDogZXZlbnRTZXNzaW9uLFxuICAgICAgICAgIG91dGNvbWUsXG4gICAgICAgICAgY29kZSxcbiAgICAgICAgfSkgPT4gKHtcbiAgICAgICAgICB0eXBlLFxuICAgICAgICAgIGV4ZWN1dGlvbklkOiBldmVudEV4ZWN1dGlvbixcbiAgICAgICAgICBzZXNzaW9uSWQ6IGV2ZW50U2Vzc2lvbixcbiAgICAgICAgICBvdXRjb21lLFxuICAgICAgICAgIGNvZGUsXG4gICAgICAgIH0pLFxuICAgICAgKSxcbiAgICAgIGNoZWNrcG9pbnRzOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBzZXF1ZW5jZTogY2hlY2twb2ludC5zZXF1ZW5jZSxcbiAgICAgICAgICBzdGFnZTogY2hlY2twb2ludC5zdGFnZSxcbiAgICAgICAgICB1cGRhdGVkQXQ6IGNoZWNrcG9pbnQudXBkYXRlZEF0LFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICAgIGV2aWRlbmNlQ291bnQsXG4gICAgICBwcm9wb3NhbHM6IHByb3Bvc2FsXG4gICAgICAgID8gW1xuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBpZDogcHJvcG9zYWwuaWQsXG4gICAgICAgICAgICAgIHJldmlzaW9uOiBwcm9wb3NhbC5yZXZpc2lvbixcbiAgICAgICAgICAgICAgc3RhdHVzOiBwcm9wb3NhbC5zdGF0dXMsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIF1cbiAgICAgICAgOiBbXSxcbiAgICAgIHZhbGlkYXRpb246IHZhbGlkYXRpb24ubWFwKChzdGVwKSA9PiAoe1xuICAgICAgICBzdGF0dXM6IHN0ZXAudmFsaWRhdGlvbj8uc3RhdHVzID8/IHN0ZXAuc3RhdHVzLFxuICAgICAgICBwcm9maWxlOiBzdGVwLnZhbGlkYXRpb24/LnByb2ZpbGUgPz8gc3RlcC52YWxpZGF0aW9uUHJvZmlsZSxcbiAgICAgIH0pKSxcbiAgICAgIGV2ZW50czogZXZlbnRzLm1hcCgoeyB0eXBlLCBzZXZlcml0eSwgY29ycmVsYXRpb25JZCB9KSA9PiAoe1xuICAgICAgICB0eXBlLFxuICAgICAgICBzZXZlcml0eSxcbiAgICAgICAgY29ycmVsYXRpb25JZCxcbiAgICAgIH0pKSxcbiAgICAgIGRhc2hib2FyZDogbWlzc2lvbkNvbnRyb2wsXG4gICAgICBkYXNoYm9hcmRTdGF0ZToge1xuICAgICAgICBwcm9qZWN0Q291bnQ6IGRhc2hib2FyZFN0YXRlLnByb2plY3RDb3VudCxcbiAgICAgICAgYWN0aXZlVGFza0NvdW50OiBkYXNoYm9hcmRTdGF0ZS5hY3RpdmVUYXNrQ291bnQsXG4gICAgICB9LFxuICAgIH07XG4gICAgY29uc3Qgb3V0cHV0UGF0aCA9XG4gICAgICBwcm9jZXNzLmVudi5EQVNIQk9BUkRfRTJFX0xJVkVfUkVQT1JUX1BBVEggPz9cbiAgICAgIFwidGVzdC1yZXN1bHRzL2Rhc2hib2FyZC1qb3VybmV5L2xpdmUtbWlzc2lvbi1jb3JyZWxhdGlvbi5qc29uXCI7XG4gICAgYXdhaXQgbWtkaXIoZGlybmFtZShvdXRwdXRQYXRoKSwgeyByZWN1cnNpdmU6IHRydWUgfSk7XG4gICAgYXdhaXQgd3JpdGVGaWxlKFxuICAgICAgb3V0cHV0UGF0aCxcbiAgICAgIGAke0pTT04uc3RyaW5naWZ5KGNhcHR1cmUsIG51bGwsIDIpfVxcbmAsXG4gICAgICBcInV0ZjhcIixcbiAgICApO1xuICB9KTtcblxuICB0ZXN0KFwic2lnbnMgaW4gYW5kIHRyYXZlcnNlcyB0aGUgYXV0aGVudGljYXRlZCBvcGVyYXRpb25hbCBzaGVsbFwiLCBhc3luYyAoe1xuICAgIHBhZ2UsXG4gIH0pID0+IHtcbiAgICBhd2FpdCBpbnN0YWxsQXBpRml4dHVyZXMocGFnZSk7XG4gICAgYXdhaXQgcHJvZ3JhbW1hdGljU2lnbkluKHBhZ2UpO1xuICAgIGZvciAoY29uc3Qgb3JpZ2luIG9mIGFwcHJvdmVkRGFzaGJvYXJkT3JpZ2lucygpKSB7XG4gICAgICBhd2FpdCBleHBlY3RPcmlnaW5DYW5Vc2VBcGkocGFnZSwgb3JpZ2luKTtcbiAgICB9XG4gICAgYXdhaXQgZXhwZWN0SG9zdGlsZU9yaWdpblJlamVjdGVkKHBhZ2UpO1xuXG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVJvbGUoXCJoZWFkaW5nXCIsIHsgbmFtZTogXCJTeXN0ZW0gT3ZlcnZpZXdcIiB9KSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXCJTWVNURU0gT05MSU5FXCIsIHsgZXhhY3Q6IHRydWUgfSksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiU21va2UgUHJvamVjdFwiLCB7IGV4YWN0OiB0cnVlIH0pLmZpcnN0KCksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiRGFzaGJvYXJkIEFQSSBmaXh0dXJlIHJlYWR5XCIsIHsgZXhhY3Q6IHRydWUgfSksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IG9wZW5OYXZpZ2F0aW9uKHBhZ2UsIFwiUHJvamVjdHNcIiwgYCR7REFTSEJPQVJEX1BBVEh9cHJvamVjdHNgKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5nZXRCeVJvbGUoXCJoZWFkaW5nXCIsIHsgbmFtZTogXCJQcm9qZWN0c1wiIH0pKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiU21va2UgUHJvamVjdFwiLCB7IGV4YWN0OiB0cnVlIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcblxuICAgIGF3YWl0IG9wZW5OYXZpZ2F0aW9uKHBhZ2UsIFwiRXZlbnQgU3RyZWFtXCIsIGAke0RBU0hCT0FSRF9QQVRIfWV2ZW50c2ApO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlSb2xlKFwiaGVhZGluZ1wiLCB7IG5hbWU6IFwiRXZlbnQgU3RyZWFtXCIgfSksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiRGFzaGJvYXJkIEFQSSBmaXh0dXJlIHJlYWR5XCIsIHsgZXhhY3Q6IHRydWUgfSksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuXG4gICAgYXdhaXQgb3Blbk5hdmlnYXRpb24ocGFnZSwgXCJBSSBBc3Npc3RhbnRcIiwgYCR7REFTSEJPQVJEX1BBVEh9YWlgKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZSkubm90LnRvSGF2ZVVSTCgvc2lnbi1pbi8pO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2VcbiAgICAgICAgLmdldEJ5VGV4dChcbiAgICAgICAgICAvQUkgcHJvdmlkZXIgbm90IGNvbmZpZ3VyZWR8Tm8gQUkga2V5IGNvbmZpZ3VyZWR8QUkgQXNzaXN0YW50L2ksXG4gICAgICAgIClcbiAgICAgICAgLmZpcnN0KCksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuXG4gICAgYXdhaXQgb3Blbk5hdmlnYXRpb24oXG4gICAgICBwYWdlLFxuICAgICAgXCJNaXNzaW9uIENvbnRyb2xcIixcbiAgICAgIGAke0RBU0hCT0FSRF9QQVRIfW1pc3Npb24tY29udHJvbGAsXG4gICAgKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5Um9sZShcImhlYWRpbmdcIiwgeyBuYW1lOiBcIk5vIGR1cmFibGUgcnVucyBpbiB0aGUgbGVkZ2VyXCIgfSksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuXG4gICAgYXdhaXQgcGFnZS5nb3RvKGAke0RBU0hCT0FSRF9QQVRIfWZsaWdodC1kZWNrP2V4ZWN1dGlvbklkPSR7RVhFQ1VUSU9OX0lEfWApO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlKS50b0hhdmVVUkwoXG4gICAgICBuZXcgUmVnRXhwKFxuICAgICAgICBgJHtEQVNIQk9BUkRfUEFUSC5yZXBsYWNlQWxsKFwiL1wiLCBcIlxcXFwvXCIpfWZsaWdodC1kZWNrXFxcXD9leGVjdXRpb25JZD1gLFxuICAgICAgKSxcbiAgICApO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlSb2xlKFwiaGVhZGluZ1wiLCB7IG5hbWU6IFwiQXVkaXQgLyBDaGF0IHJ1blwiIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcIkNvbnRyb2xsZWQgYnJvd3NlciBmaXh0dXJlIGNvbXBsZXRlZC5cIiwgeyBleGFjdDogdHJ1ZSB9KSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXCJQUk9WRU5cIiwgeyBleGFjdDogdHJ1ZSB9KS5maXJzdCgpLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgfSk7XG5cbiAgdGVzdChcIm9wZW5zIGZhaWxlZCB0YXNrIGFuZCB3b3JrZmxvdyBkZXRhaWxzIHdpdGggcmVkYWN0ZWQgcmVjb3ZlcnkgZ3VpZGFuY2VcIiwgYXN5bmMgKHtcbiAgICBwYWdlLFxuICB9KSA9PiB7XG4gICAgY29uc3QgcmF3RGlhZ25vc3RpYyA9IFwicHJvdmlkZXIgZGlhZ25vc3RpYzogdXBzdHJlYW0gcmV0dXJuZWQgcmF3IHJlc3BvbnNlXCI7XG4gICAgY29uc3QgcmF3Q3JlZGVudGlhbCA9IFwic2stZTJlLWJyb3dzZXItY3JlZGVudGlhbC1zZWNyZXRcIjtcbiAgICBjb25zdCBzdXBwb3J0UmVmZXJlbmNlcyA9IHtcbiAgICAgIGF1dGhlbnRpY2F0aW9uX2ZhaWxlZDogXCJzdXBwb3J0LXRhc2stYXV0aC0zMlwiLFxuICAgICAgcXVvdGFfZXhoYXVzdGVkOiBcInN1cHBvcnQtdGFzay1xdW90YS0zMlwiLFxuICAgICAgcHJvdmlkZXJfb3V0YWdlOiBcInN1cHBvcnQtd29ya2Zsb3ctb3V0YWdlLTMyXCIsXG4gICAgfTtcbiAgICBjb25zdCByZWNvdmVyeVRhc2tzID0gW1xuICAgICAge1xuICAgICAgICBpZDogXCJlMmUtYXV0aC1mYWlsZWQtdGFza1wiLFxuICAgICAgICBwcm9qZWN0SWQ6IFwiZTJlLXByb2plY3RcIixcbiAgICAgICAgdGl0bGU6IFwiUmVjb3ZlciBhdXRoZW50aWNhdGlvbiBmYWlsdXJlXCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIlRoZSBwcm92aWRlciBhdXRoZW50aWNhdGlvbiB0ZXN0IHRhc2sgZmFpbGVkLlwiLFxuICAgICAgICBzdGF0dXM6IFwiZmFpbGVkXCIsXG4gICAgICAgIHByaW9yaXR5OiBcInAxXCIsXG4gICAgICAgIHJlbGF0ZWRGaWxlczogW1wic3JjL3Byb3ZpZGVyLnRzXCJdLFxuICAgICAgICByZXRyeUNvdW50OiAxLFxuICAgICAgICBtYXhSZXRyaWVzOiAyLFxuICAgICAgICBhZ2VudFJlc3BvbnNlOiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAga2luZDogXCJBSV9UQVNLX0VYRUNVVElPTl9SRUNFSVBUXCIsXG4gICAgICAgICAgdGVybWluYWxTdGF0dXM6IFwiRkFJTEVEXCIsXG4gICAgICAgICAgYXZhaWxhYmlsaXR5U3RhdGU6IFwiYXV0aGVudGljYXRpb25fZmFpbGVkXCIsXG4gICAgICAgICAgY29ycmVsYXRpb25JZDogc3VwcG9ydFJlZmVyZW5jZXMuYXV0aGVudGljYXRpb25fZmFpbGVkLFxuICAgICAgICAgIG9wZXJhdG9yQWN0aW9uOiBcIlJlcGxhY2UgdGhlIHByb3ZpZGVyIEFQSSBrZXkgd2l0aCBhIHZhbGlkIGtleSwgdGhlbiByZXRyeS5cIixcbiAgICAgICAgICBwcm92aWRlcjogXCJvcGVucm91dGVyXCIsXG4gICAgICAgICAgbW9kZWw6IFwic2VjcmV0LW1vZGVsLW5hbWVcIixcbiAgICAgICAgICB0ZXJtaW5hbFJlYXNvbjogcmF3RGlhZ25vc3RpYyxcbiAgICAgICAgICBvcGVyYXRpb25JZDogcmF3Q3JlZGVudGlhbCxcbiAgICAgICAgfSksXG4gICAgICAgIGNyZWF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAwOjAwLjAwMFpcIixcbiAgICAgICAgdXBkYXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDE6MDAuMDAwWlwiLFxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgaWQ6IFwiZTJlLXF1b3RhLWZhaWxlZC10YXNrXCIsXG4gICAgICAgIHByb2plY3RJZDogXCJlMmUtcHJvamVjdFwiLFxuICAgICAgICB0aXRsZTogXCJSZWNvdmVyIHF1b3RhIGV4aGF1c3Rpb25cIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiVGhlIHByb3ZpZGVyIHF1b3RhIHRlc3QgdGFzayBmYWlsZWQuXCIsXG4gICAgICAgIHN0YXR1czogXCJmYWlsZWRcIixcbiAgICAgICAgcHJpb3JpdHk6IFwicDFcIixcbiAgICAgICAgcmV0cnlDb3VudDogMCxcbiAgICAgICAgbWF4UmV0cmllczogMixcbiAgICAgICAgYWdlbnRSZXNwb25zZTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgIGtpbmQ6IFwiQUlfVEFTS19FWEVDVVRJT05fUkVDRUlQVFwiLFxuICAgICAgICAgIHRlcm1pbmFsU3RhdHVzOiBcIkZBSUxFRFwiLFxuICAgICAgICAgIGF2YWlsYWJpbGl0eVN0YXRlOiBcInF1b3RhX2V4aGF1c3RlZFwiLFxuICAgICAgICAgIGNvcnJlbGF0aW9uSWQ6IHN1cHBvcnRSZWZlcmVuY2VzLnF1b3RhX2V4aGF1c3RlZCxcbiAgICAgICAgICBwcm92aWRlcjogXCJvcGVucm91dGVyXCIsXG4gICAgICAgICAgbW9kZWw6IFwic2VjcmV0LW1vZGVsLW5hbWVcIixcbiAgICAgICAgICB0ZXJtaW5hbFJlYXNvbjogcmF3RGlhZ25vc3RpYyxcbiAgICAgICAgICBvcGVyYXRpb25JZDogcmF3Q3JlZGVudGlhbCxcbiAgICAgICAgfSksXG4gICAgICAgIGNyZWF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAwOjAwLjAwMFpcIixcbiAgICAgICAgdXBkYXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDE6MDAuMDAwWlwiLFxuICAgICAgfSxcbiAgICBdO1xuICAgIGNvbnN0IHdvcmtmbG93SWQgPSBcImUyZS1vdXRhZ2Utd29ya2Zsb3dcIjtcbiAgICBhd2FpdCBpbnN0YWxsQXBpRml4dHVyZXMocGFnZSwge1xuICAgICAgcmVjb3ZlcnlUYXNrcyxcbiAgICAgIHJlY292ZXJ5V29ya2Zsb3dzOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBpZDogd29ya2Zsb3dJZCxcbiAgICAgICAgICBwcm9qZWN0SWQ6IFwiZTJlLXByb2plY3RcIixcbiAgICAgICAgICBuYW1lOiBcIlJlY292ZXIgcHJvdmlkZXIgb3V0YWdlXCIsXG4gICAgICAgICAgZGVzY3JpcHRpb246IFwiQSBwaXBlbGluZSB1c2VkIHRvIHZlcmlmeSBvdXRhZ2UgcmVjb3ZlcnkgZ3VpZGFuY2UuXCIsXG4gICAgICAgICAgc3RhdHVzOiBcImZhaWxlZFwiLFxuICAgICAgICAgIHBoYXNlczogW1xuICAgICAgICAgICAgeyBuYW1lOiBcImJ1aWxkXCIsIHN0ZXBzOiBbXCJjb21waWxlXCJdIH0sXG4gICAgICAgICAgICB7IG5hbWU6IFwidGVzdFwiLCBzdGVwczogW1widmVyaWZ5XCJdIH0sXG4gICAgICAgICAgXSxcbiAgICAgICAgICBjdXJyZW50UGhhc2U6IFwidGVzdFwiLFxuICAgICAgICAgIGV4ZWN1dGlvbkNvdW50OiAxLFxuICAgICAgICAgIGNyZWF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAwOjAwLjAwMFpcIixcbiAgICAgICAgICB1cGRhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMTowMC4wMDBaXCIsXG4gICAgICAgIH0sXG4gICAgICBdLFxuICAgICAgcmVjb3ZlcnlXb3JrZmxvd0V4ZWN1dGlvbnM6IHtcbiAgICAgICAgW3dvcmtmbG93SWRdOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgaWQ6IFwiZTJlLW91dGFnZS1leGVjdXRpb25cIixcbiAgICAgICAgICAgIHdvcmtmbG93SWQsXG4gICAgICAgICAgICBzdGF0dXM6IFwiZmFpbGVkXCIsXG4gICAgICAgICAgICBjdXJyZW50UGhhc2U6IFwidGVzdFwiLFxuICAgICAgICAgICAgY29tcGxldGVkUGhhc2VzOiBbXCJidWlsZFwiXSxcbiAgICAgICAgICAgIHN0YXJ0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAwOjAwLjAwMFpcIixcbiAgICAgICAgICAgIGVycm9yTWVzc2FnZTogcmF3RGlhZ25vc3RpYyxcbiAgICAgICAgICAgIHJlY292ZXJ5OiB7XG4gICAgICAgICAgICAgIGF2YWlsYWJpbGl0eVN0YXRlOiBcInByb3ZpZGVyX291dGFnZVwiLFxuICAgICAgICAgICAgICBjb3JyZWxhdGlvbklkOiBzdXBwb3J0UmVmZXJlbmNlcy5wcm92aWRlcl9vdXRhZ2UsXG4gICAgICAgICAgICAgIG9wZXJhdG9yQWN0aW9uOlxuICAgICAgICAgICAgICAgIFwiUmV0cnkgaW4gYSBtb21lbnQ7IGNvbmZpZ3VyZSBhbm90aGVyIHByb3ZpZGVyIGlmIHRoZSBpc3N1ZSBwZXJzaXN0cy5cIixcbiAgICAgICAgICAgICAgZGlhZ25vc3RpYzogcmF3Q3JlZGVudGlhbCxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgXSxcbiAgICAgIH0sXG4gICAgfSk7XG4gICAgYXdhaXQgcHJvZ3JhbW1hdGljU2lnbkluKHBhZ2UpO1xuXG4gICAgYXdhaXQgb3Blbk5hdmlnYXRpb24ocGFnZSwgXCJUYXNrc1wiLCBgJHtEQVNIQk9BUkRfUEFUSH10YXNrc2ApO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlMYWJlbChcIkV4cGFuZCB0YXNrIFJlY292ZXIgYXV0aGVudGljYXRpb24gZmFpbHVyZVwiKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgcGFnZVxuICAgICAgLmdldEJ5TGFiZWwoXCJFeHBhbmQgdGFzayBSZWNvdmVyIGF1dGhlbnRpY2F0aW9uIGZhaWx1cmVcIilcbiAgICAgIC5jbGljaygpO1xuICAgIGNvbnN0IHRhc2tEZXRhaWxzID0gcGFnZS5sb2NhdG9yKFwiI3Rhc2stZGV0YWlscy1lMmUtYXV0aC1mYWlsZWQtdGFza1wiKTtcbiAgICBhd2FpdCBleHBlY3QodGFza0RldGFpbHMpLnRvQ29udGFpblRleHQoXCJQcm92aWRlciBhdXRoZW50aWNhdGlvbiBmYWlsZWRcIik7XG4gICAgYXdhaXQgZXhwZWN0KHRhc2tEZXRhaWxzKS50b0NvbnRhaW5UZXh0KFxuICAgICAgXCJSZXBsYWNlIHRoZSBwcm92aWRlciBBUEkga2V5IHdpdGggYSB2YWxpZCBrZXksIHRoZW4gcmV0cnkuXCIsXG4gICAgKTtcbiAgICBhd2FpdCBleHBlY3QodGFza0RldGFpbHMpLnRvQ29udGFpblRleHQoXG4gICAgICBgU3VwcG9ydCByZWZlcmVuY2U6ICR7c3VwcG9ydFJlZmVyZW5jZXMuYXV0aGVudGljYXRpb25fZmFpbGVkfWAsXG4gICAgKTtcbiAgICBhd2FpdCBwYWdlLmdldEJ5TGFiZWwoXCJFeHBhbmQgdGFzayBSZWNvdmVyIHF1b3RhIGV4aGF1c3Rpb25cIikuY2xpY2soKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5nZXRCeVRleHQoXCJQcm92aWRlciBxdW90YSBpcyBleGhhdXN0ZWRcIikpLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoYFN1cHBvcnQgcmVmZXJlbmNlOiAke3N1cHBvcnRSZWZlcmVuY2VzLnF1b3RhX2V4aGF1c3RlZH1gKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgcGFnZS5yZWxvYWQoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5TGFiZWwoXCJFeHBhbmQgdGFzayBSZWNvdmVyIGF1dGhlbnRpY2F0aW9uIGZhaWx1cmVcIiksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IHBhZ2VcbiAgICAgIC5nZXRCeUxhYmVsKFwiRXhwYW5kIHRhc2sgUmVjb3ZlciBhdXRoZW50aWNhdGlvbiBmYWlsdXJlXCIpXG4gICAgICAuY2xpY2soKTtcbiAgICBjb25zdCByZWxvYWRlZEF1dGhEZXRhaWxzID0gcGFnZS5sb2NhdG9yKFxuICAgICAgXCIjdGFzay1kZXRhaWxzLWUyZS1hdXRoLWZhaWxlZC10YXNrXCIsXG4gICAgKTtcbiAgICBhd2FpdCBleHBlY3QocmVsb2FkZWRBdXRoRGV0YWlscykudG9Db250YWluVGV4dChcbiAgICAgIFwiUHJvdmlkZXIgYXV0aGVudGljYXRpb24gZmFpbGVkXCIsXG4gICAgKTtcbiAgICBhd2FpdCBleHBlY3QocmVsb2FkZWRBdXRoRGV0YWlscykudG9Db250YWluVGV4dChcbiAgICAgIFwiUmVwbGFjZSB0aGUgcHJvdmlkZXIgQVBJIGtleSB3aXRoIGEgdmFsaWQga2V5LCB0aGVuIHJldHJ5LlwiLFxuICAgICk7XG4gICAgYXdhaXQgZXhwZWN0KHJlbG9hZGVkQXV0aERldGFpbHMpLnRvQ29udGFpblRleHQoXG4gICAgICBgU3VwcG9ydCByZWZlcmVuY2U6ICR7c3VwcG9ydFJlZmVyZW5jZXMuYXV0aGVudGljYXRpb25fZmFpbGVkfWAsXG4gICAgKTtcbiAgICBhd2FpdCBwYWdlLmdldEJ5TGFiZWwoXCJFeHBhbmQgdGFzayBSZWNvdmVyIHF1b3RhIGV4aGF1c3Rpb25cIikuY2xpY2soKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5nZXRCeVRleHQoXCJQcm92aWRlciBxdW90YSBpcyBleGhhdXN0ZWRcIikpLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoYFN1cHBvcnQgcmVmZXJlbmNlOiAke3N1cHBvcnRSZWZlcmVuY2VzLnF1b3RhX2V4aGF1c3RlZH1gKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgY29uc3QgcmVsb2FkZWRUYXNrVGV4dCA9IGF3YWl0IHBhZ2UubG9jYXRvcihcImJvZHlcIikuaW5uZXJUZXh0KCk7XG4gICAgZXhwZWN0KHJlbG9hZGVkVGFza1RleHQpLm5vdC50b0NvbnRhaW4ocmF3RGlhZ25vc3RpYyk7XG4gICAgZXhwZWN0KHJlbG9hZGVkVGFza1RleHQpLm5vdC50b0NvbnRhaW4ocmF3Q3JlZGVudGlhbCk7XG4gICAgZXhwZWN0KHJlbG9hZGVkVGFza1RleHQpLm5vdC50b01hdGNoKFxuICAgICAgL3NlY3JldC1tb2RlbC1uYW1lfFxcL2hvbWVcXC9ydW5uZXJ8XFwvdG1wXFwvL2ksXG4gICAgKTtcblxuICAgIGF3YWl0IG9wZW5OYXZpZ2F0aW9uKHBhZ2UsIFwiV29ya2Zsb3dzXCIsIGAke0RBU0hCT0FSRF9QQVRIfXdvcmtmbG93c2ApO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlLmdldEJ5VGV4dChcIlJlY292ZXIgcHJvdmlkZXIgb3V0YWdlXCIpKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJFeGVjdXRpb24gaGlzdG9yeVwiIH0pLmNsaWNrKCk7XG4gICAgY29uc3QgZXhlY3V0aW9uID0gcGFnZVxuICAgICAgLmdldEJ5VGV4dChcImZhaWxlZCDCtyBubyBzdWNjZXNzZnVsIGNvbXBsZXRpb25cIilcbiAgICAgIC5sb2NhdG9yKFwiLi5cIilcbiAgICAgIC5sb2NhdG9yKFwiLi5cIik7XG4gICAgYXdhaXQgZXhwZWN0KGV4ZWN1dGlvbikudG9Db250YWluVGV4dChcbiAgICAgIFwiVGhlIHByb3ZpZGVyIGlzIHRlbXBvcmFyaWx5IHVuYXZhaWxhYmxlXCIsXG4gICAgKTtcbiAgICBhd2FpdCBleHBlY3QoZXhlY3V0aW9uKS50b0NvbnRhaW5UZXh0KFxuICAgICAgXCJSZXRyeSBpbiBhIG1vbWVudDsgY29uZmlndXJlIGFub3RoZXIgcHJvdmlkZXIgaWYgdGhlIGlzc3VlIHBlcnNpc3RzLlwiLFxuICAgICk7XG4gICAgYXdhaXQgZXhwZWN0KGV4ZWN1dGlvbikudG9Db250YWluVGV4dChcbiAgICAgIGBTdXBwb3J0IHJlZmVyZW5jZTogJHtzdXBwb3J0UmVmZXJlbmNlcy5wcm92aWRlcl9vdXRhZ2V9YCxcbiAgICApO1xuICAgIGF3YWl0IHBhZ2UucmVsb2FkKCk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlUZXh0KFwiUmVjb3ZlciBwcm92aWRlciBvdXRhZ2VcIikpLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgcGFnZS5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIkV4ZWN1dGlvbiBoaXN0b3J5XCIgfSkuY2xpY2soKTtcbiAgICBjb25zdCByZWxvYWRlZEV4ZWN1dGlvbiA9IHBhZ2VcbiAgICAgIC5nZXRCeVRleHQoXCJmYWlsZWQgwrcgbm8gc3VjY2Vzc2Z1bCBjb21wbGV0aW9uXCIpXG4gICAgICAubG9jYXRvcihcIi4uXCIpXG4gICAgICAubG9jYXRvcihcIi4uXCIpO1xuICAgIGF3YWl0IGV4cGVjdChyZWxvYWRlZEV4ZWN1dGlvbikudG9Db250YWluVGV4dChcbiAgICAgIFwiVGhlIHByb3ZpZGVyIGlzIHRlbXBvcmFyaWx5IHVuYXZhaWxhYmxlXCIsXG4gICAgKTtcbiAgICBhd2FpdCBleHBlY3QocmVsb2FkZWRFeGVjdXRpb24pLnRvQ29udGFpblRleHQoXG4gICAgICBcIlJldHJ5IGluIGEgbW9tZW50OyBjb25maWd1cmUgYW5vdGhlciBwcm92aWRlciBpZiB0aGUgaXNzdWUgcGVyc2lzdHMuXCIsXG4gICAgKTtcbiAgICBhd2FpdCBleHBlY3QocmVsb2FkZWRFeGVjdXRpb24pLnRvQ29udGFpblRleHQoXG4gICAgICBgU3VwcG9ydCByZWZlcmVuY2U6ICR7c3VwcG9ydFJlZmVyZW5jZXMucHJvdmlkZXJfb3V0YWdlfWAsXG4gICAgKTtcblxuICAgIGNvbnN0IHZpc2libGVUZXh0ID0gYXdhaXQgcGFnZS5sb2NhdG9yKFwiYm9keVwiKS5pbm5lclRleHQoKTtcbiAgICBleHBlY3QodmlzaWJsZVRleHQpLm5vdC50b0NvbnRhaW4ocmF3RGlhZ25vc3RpYyk7XG4gICAgZXhwZWN0KHZpc2libGVUZXh0KS5ub3QudG9Db250YWluKHJhd0NyZWRlbnRpYWwpO1xuICAgIGV4cGVjdCh2aXNpYmxlVGV4dCkubm90LnRvTWF0Y2goXG4gICAgICAvc2VjcmV0LW1vZGVsLW5hbWV8XFwvaG9tZVxcL3J1bm5lcnxcXC90bXBcXC8vaSxcbiAgICApO1xuICAgIGF3YWl0IGV4cGVjdE5vSG9yaXpvbnRhbE92ZXJmbG93KHBhZ2UpO1xuICB9KTtcblxuICB0ZXN0KFwicHJvdmVzIHJlbWVkaWF0aW9uIHBsYW5zLCByZXZpZXcgc3RhdGUsIGFuZCB0YXNrIGFjdGlvbiB0cmFuc2l0aW9uc1wiLCBhc3luYyAoe1xuICAgIHBhZ2UsXG4gIH0pID0+IHtcbiAgICBjb25zdCByYXdQcm9tcHQgPSBcIklOVEVSTkFMX1BST01QVF9zaG91bGRfbmV2ZXJfcmVuZGVyXCI7XG4gICAgY29uc3QgcmF3RGlhZ25vc3RpYyA9IFwicmF3LXByb3ZpZGVyLWRpYWdub3N0aWMtc2hvdWxkLW5ldmVyLXJlbmRlclwiO1xuICAgIGNvbnN0IHJlYWR5VGFza0lkID0gXCJlMmUtcmVhZHktcmVtZWRpYXRpb24tdGFza1wiO1xuICAgIGNvbnN0IHJldmlld1Rhc2tJZCA9IFwiZTJlLXJldmlldy1yZW1lZGlhdGlvbi10YXNrXCI7XG4gICAgY29uc3QgdmVyaWZpY2F0aW9uVGFza0lkID0gXCJlMmUtdmVyaWZpY2F0aW9uLXJlbWVkaWF0aW9uLXRhc2tcIjtcbiAgICBjb25zdCByZW1lZGlhdGlvblRhc2tzID0gW1xuICAgICAge1xuICAgICAgICBpZDogcmVhZHlUYXNrSWQsXG4gICAgICAgIHByb2plY3RJZDogXCJlMmUtcHJvamVjdFwiLFxuICAgICAgICB0aXRsZTogXCJFeGVjdXRlIFNRTCBpbnB1dCBzYW5pdGl6YXRpb24gcmVtZWRpYXRpb25cIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiQSBjb21wbGV0ZSByZW1lZGlhdGlvbiBwbGFuIGlzIHJlYWR5IGZvciBvcGVyYXRvciBleGVjdXRpb24uXCIsXG4gICAgICAgIHN0YXR1czogXCJwZW5kaW5nXCIsXG4gICAgICAgIHByaW9yaXR5OiBcInAxXCIsXG4gICAgICAgIHBoYXNlOiBcIlJlbWVkaWF0aW9uXCIsXG4gICAgICAgIHJlbGF0ZWRGaWxlczogW1wic3JjL2F1dGgvaW5wdXQudHNcIl0sXG4gICAgICAgIHJldHJ5Q291bnQ6IDAsXG4gICAgICAgIG1heFJldHJpZXM6IDIsXG4gICAgICAgIHByb21wdDogcmF3UHJvbXB0LFxuICAgICAgICBhZ2VudFJlc3BvbnNlOiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAga2luZDogXCJBSV9UQVNLX0VYRUNVVElPTl9SRUNFSVBUXCIsXG4gICAgICAgICAgdGVybWluYWxTdGF0dXM6IFwiUkVDT1JERURcIixcbiAgICAgICAgICB0ZXJtaW5hbFJlYXNvbjogcmF3RGlhZ25vc3RpYyxcbiAgICAgICAgfSksXG4gICAgICAgIHJlbWVkaWF0aW9uUGxhbjoge1xuICAgICAgICAgIHZlcnNpb246IDEsXG4gICAgICAgICAgcnVsZUlkOiBcImUyZS1ydWxlLXNxbC1pbnB1dFwiLFxuICAgICAgICAgIHJ1bGVDb2RlOiBcIlNFQy0wMDFcIixcbiAgICAgICAgICBydWxlVGl0bGU6IFwiVW5zYW5pdGl6ZWQgU1FMIGlucHV0XCIsXG4gICAgICAgICAgc2V2ZXJpdHk6IFwiaGlnaFwiLFxuICAgICAgICAgIG9jY3VycmVuY2VDb3VudDogMixcbiAgICAgICAgICBldmlkZW5jZTogW1xuICAgICAgICAgICAgeyBmaWxlOiBcInNyYy9hdXRoL2lucHV0LnRzXCIsIGxpbmU6IDEwLCBzbmlwcGV0OiBcInF1ZXJ5KHVzZXJJbnB1dClcIiwgb2NjdXJyZW5jZXM6IDEgfSxcbiAgICAgICAgICAgIHsgZmlsZTogXCJzcmMvYXV0aC9pbnB1dC50c1wiLCBsaW5lOiAxOCwgc25pcHBldDogXCJxdWVyeShhY2NvdW50SWQpXCIsIG9jY3VycmVuY2VzOiAxIH0sXG4gICAgICAgICAgICB7IGZpbGU6IFwic3JjL2F1dGgvaW5wdXQudHNcIiwgbGluZTogMjcsIHNuaXBwZXQ6IFwicXVlcnkoZmlsdGVyKVwiLCBvY2N1cnJlbmNlczogMSB9LFxuICAgICAgICAgICAgeyBmaWxlOiBcInNyYy9hdXRoL2lucHV0LnRzXCIsIGxpbmU6IDMxLCBzbmlwcGV0OiBcInF1ZXJ5KHNvcnQpXCIsIG9jY3VycmVuY2VzOiAxIH0sXG4gICAgICAgICAgICB7IGZpbGU6IFwic3JjL2F1dGgvaW5wdXQudHNcIiwgbGluZTogNDQsIHNuaXBwZXQ6IFwicXVlcnkobGltaXQpXCIsIG9jY3VycmVuY2VzOiAxIH0sXG4gICAgICAgICAgICB7IGZpbGU6IFwic3JjL2F1dGgvaW5wdXQudHNcIiwgbGluZTogNTIsIHNuaXBwZXQ6IFwicXVlcnkob2Zmc2V0KVwiLCBvY2N1cnJlbmNlczogMSB9LFxuICAgICAgICAgIF0sXG4gICAgICAgICAgcmVsYXRlZEZpbGVzOiBbXCJzcmMvYXV0aC9pbnB1dC50c1wiXSxcbiAgICAgICAgICBmaXhEZXNjcmlwdGlvbjogXCJVc2UgdGhlIHBhcmFtZXRlcml6ZWQgcXVlcnkgaGVscGVyIGZvciBldmVyeSB1c2VyLWNvbnRyb2xsZWQgdmFsdWUuXCIsXG4gICAgICAgICAgdmVyaWZpY2F0aW9uU3RlcHM6IFtcbiAgICAgICAgICAgIFwiUnVuIHRoZSBTUUwgaW5qZWN0aW9uIHJlZ3Jlc3Npb24gdGVzdC5cIixcbiAgICAgICAgICAgIFwiQ29uZmlybSBhbGwgdXNlci1jb250cm9sbGVkIHF1ZXJ5IHZhbHVlcyB1c2UgcGFyYW1ldGVycy5cIixcbiAgICAgICAgICBdLFxuICAgICAgICAgIHNvdXJjZToge1xuICAgICAgICAgICAgdHlwZTogXCJzY2FuXCIsXG4gICAgICAgICAgICBjb3JyZWxhdGlvbklkOiBcImUyZS1zY2FuLWNvcnJlbGF0aW9uXCIsXG4gICAgICAgICAgICByZXZpc2lvbjogXCJyZW1lZGlhdGlvbi1yZXZpc2lvbi00MlwiLFxuICAgICAgICAgICAgY29tcGxldGVuZXNzOiBcIkNPTVBMRVRFXCIsXG4gICAgICAgICAgfSxcbiAgICAgICAgICBzdGF0dXM6IFwicmVhZHlcIixcbiAgICAgICAgfSxcbiAgICAgICAgY3JlYXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDA6MDAuMDAwWlwiLFxuICAgICAgICB1cGRhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMTowMC4wMDBaXCIsXG4gICAgICB9LFxuICAgICAge1xuICAgICAgICBpZDogcmV2aWV3VGFza0lkLFxuICAgICAgICBwcm9qZWN0SWQ6IFwiZTJlLXByb2plY3RcIixcbiAgICAgICAgdGl0bGU6IFwiUmV2aWV3IGluY29tcGxldGUgU1FMIHJlbWVkaWF0aW9uIGV2aWRlbmNlXCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIkFuIGluY29tcGxldGUgcGxhbiBtdXN0IHN0YXkgYmxvY2tlZCB1bnRpbCBhbiBvcGVyYXRvciByZXZpZXdzIGl0LlwiLFxuICAgICAgICBzdGF0dXM6IFwiZmFpbGVkXCIsXG4gICAgICAgIHByaW9yaXR5OiBcInAxXCIsXG4gICAgICAgIHBoYXNlOiBcIlJlbWVkaWF0aW9uXCIsXG4gICAgICAgIHJlbGF0ZWRGaWxlczogW1wic3JjL2F1dGgvaW5wdXQudHNcIl0sXG4gICAgICAgIHJldHJ5Q291bnQ6IDAsXG4gICAgICAgIG1heFJldHJpZXM6IDIsXG4gICAgICAgIHByb21wdDogcmF3UHJvbXB0LFxuICAgICAgICBhZ2VudFJlc3BvbnNlOiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAga2luZDogXCJBSV9UQVNLX0VYRUNVVElPTl9SRUNFSVBUXCIsXG4gICAgICAgICAgdGVybWluYWxTdGF0dXM6IFwiRkFJTEVEXCIsXG4gICAgICAgICAgdGVybWluYWxSZWFzb246IHJhd0RpYWdub3N0aWMsXG4gICAgICAgIH0pLFxuICAgICAgICByZW1lZGlhdGlvblBsYW46IHtcbiAgICAgICAgICB2ZXJzaW9uOiAxLFxuICAgICAgICAgIHJ1bGVJZDogXCJlMmUtcnVsZS1taXNzaW5nLWV2aWRlbmNlXCIsXG4gICAgICAgICAgcnVsZUNvZGU6IFwiU0VDLTAwMlwiLFxuICAgICAgICAgIHJ1bGVUaXRsZTogXCJJbmNvbXBsZXRlIGV2aWRlbmNlIHJldmlld1wiLFxuICAgICAgICAgIHNldmVyaXR5OiBcImNyaXRpY2FsXCIsXG4gICAgICAgICAgb2NjdXJyZW5jZUNvdW50OiAxLFxuICAgICAgICAgIGV2aWRlbmNlOiBbXSxcbiAgICAgICAgICByZWxhdGVkRmlsZXM6IFtcInNyYy9hdXRoL2lucHV0LnRzXCJdLFxuICAgICAgICAgIGZpeERlc2NyaXB0aW9uOiBudWxsLFxuICAgICAgICAgIHZlcmlmaWNhdGlvblN0ZXBzOiBbXSxcbiAgICAgICAgICBzb3VyY2U6IHtcbiAgICAgICAgICAgIHR5cGU6IFwiZGlzY292ZXJ5XCIsXG4gICAgICAgICAgICBjb3JyZWxhdGlvbklkOiBcImUyZS1kaXNjb3ZlcnktY29ycmVsYXRpb25cIixcbiAgICAgICAgICAgIHJldmlzaW9uOiBudWxsLFxuICAgICAgICAgICAgY29tcGxldGVuZXNzOiBcIlBBUlRJQUxcIixcbiAgICAgICAgICB9LFxuICAgICAgICAgIHN0YXR1czogXCJuZWVkc19yZXZpZXdcIixcbiAgICAgICAgfSxcbiAgICAgICAgY3JlYXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDA6MDAuMDAwWlwiLFxuICAgICAgICB1cGRhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMTowMC4wMDBaXCIsXG4gICAgICB9LFxuICAgICAge1xuICAgICAgICBpZDogdmVyaWZpY2F0aW9uVGFza0lkLFxuICAgICAgICBwcm9qZWN0SWQ6IFwiZTJlLXByb2plY3RcIixcbiAgICAgICAgdGl0bGU6IFwiVmVyaWZ5IHBhcmFtZXRlcml6ZWQgU1FMIHJlbWVkaWF0aW9uXCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIkFuIG9wZXJhdG9yIG11c3QgcmVjb3JkIGV2aWRlbmNlIGZvciBldmVyeSB2ZXJpZmljYXRpb24gY2hlY2suXCIsXG4gICAgICAgIHN0YXR1czogXCJ2ZXJpZnlpbmdcIixcbiAgICAgICAgcHJpb3JpdHk6IFwicDFcIixcbiAgICAgICAgcGhhc2U6IFwiUmVtZWRpYXRpb25cIixcbiAgICAgICAgcmVsYXRlZEZpbGVzOiBbXCJzcmMvYXV0aC9pbnB1dC50c1wiXSxcbiAgICAgICAgcmV0cnlDb3VudDogMCxcbiAgICAgICAgbWF4UmV0cmllczogMixcbiAgICAgICAgcHJvbXB0OiByYXdQcm9tcHQsXG4gICAgICAgIHJlbWVkaWF0aW9uUGxhbjoge1xuICAgICAgICAgIHZlcnNpb246IDEsXG4gICAgICAgICAgcnVsZUlkOiBcImUyZS1ydWxlLXZlcmlmaWNhdGlvblwiLFxuICAgICAgICAgIHJ1bGVDb2RlOiBcIlNFQy0wMDNcIixcbiAgICAgICAgICBydWxlVGl0bGU6IFwiUGFyYW1ldGVyaXplZCBTUUwgcmVtZWRpYXRpb25cIixcbiAgICAgICAgICBzZXZlcml0eTogXCJoaWdoXCIsXG4gICAgICAgICAgb2NjdXJyZW5jZUNvdW50OiAyLFxuICAgICAgICAgIGV2aWRlbmNlOiBbXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIGZpbGU6IFwic3JjL2F1dGgvaW5wdXQudHNcIixcbiAgICAgICAgICAgICAgbGluZTogMTAsXG4gICAgICAgICAgICAgIHNuaXBwZXQ6IFwicXVlcnkodXNlcklucHV0KVwiLFxuICAgICAgICAgICAgICBvY2N1cnJlbmNlczogMSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgXSxcbiAgICAgICAgICByZWxhdGVkRmlsZXM6IFtcInNyYy9hdXRoL2lucHV0LnRzXCJdLFxuICAgICAgICAgIGZpeERlc2NyaXB0aW9uOiBcIlVzZSB0aGUgcGFyYW1ldGVyaXplZCBxdWVyeSBoZWxwZXIgZm9yIGV2ZXJ5IHVzZXItY29udHJvbGxlZCB2YWx1ZS5cIixcbiAgICAgICAgICB2ZXJpZmljYXRpb25TdGVwczogW1xuICAgICAgICAgICAgXCJSdW4gdGhlIFNRTCBpbmplY3Rpb24gcmVncmVzc2lvbiB0ZXN0LlwiLFxuICAgICAgICAgICAgXCJDb25maXJtIGFsbCB1c2VyLWNvbnRyb2xsZWQgcXVlcnkgdmFsdWVzIHVzZSBwYXJhbWV0ZXJzLlwiLFxuICAgICAgICAgIF0sXG4gICAgICAgICAgc291cmNlOiB7XG4gICAgICAgICAgICB0eXBlOiBcInNjYW5cIixcbiAgICAgICAgICAgIGNvcnJlbGF0aW9uSWQ6IFwiZTJlLXZlcmlmaWNhdGlvbi1jb3JyZWxhdGlvblwiLFxuICAgICAgICAgICAgcmV2aXNpb246IFwicmVtZWRpYXRpb24tcmV2aXNpb24tNDNcIixcbiAgICAgICAgICAgIGNvbXBsZXRlbmVzczogXCJDT01QTEVURVwiLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgc3RhdHVzOiBcInJlYWR5XCIsXG4gICAgICAgIH0sXG4gICAgICAgIGNyZWF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAwOjAwLjAwMFpcIixcbiAgICAgICAgdXBkYXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDM6MDAuMDAwWlwiLFxuICAgICAgfSxcbiAgICBdO1xuICAgIGNvbnN0IGFjdGlvblJlcXVlc3RzOiBzdHJpbmdbXSA9IFtdO1xuICAgIGNvbnN0IHZlcmlmaWNhdGlvblJlcXVlc3RzOiBBcnJheTxSZWNvcmQ8c3RyaW5nLCB1bmtub3duPj4gPSBbXTtcbiAgICBhd2FpdCBpbnN0YWxsQXBpRml4dHVyZXMocGFnZSwge1xuICAgICAgdGFza0FjdGlvbnM6IHtcbiAgICAgICAgdGFza3M6IHJlbWVkaWF0aW9uVGFza3MsXG4gICAgICAgIHJlcXVlc3RzOiBhY3Rpb25SZXF1ZXN0cyxcbiAgICAgICAgdmVyaWZpY2F0aW9uUmVxdWVzdHMsXG4gICAgICB9LFxuICAgIH0pO1xuICAgIGF3YWl0IHByb2dyYW1tYXRpY1NpZ25JbihwYWdlKTtcbiAgICBhd2FpdCBvcGVuTmF2aWdhdGlvbihwYWdlLCBcIlRhc2tzXCIsIGAke0RBU0hCT0FSRF9QQVRIfXRhc2tzYCk7XG5cbiAgICBjb25zdCByZWFkeVJvdyA9IHBhZ2UuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHtcbiAgICAgIG5hbWU6IC90YXNrIEV4ZWN1dGUgU1FMIGlucHV0IHNhbml0aXphdGlvbiByZW1lZGlhdGlvbi8sXG4gICAgfSk7XG4gICAgYXdhaXQgZXhwZWN0KHJlYWR5Um93KS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlLmdldEJ5VGl0bGUoXCJFeGVjdXRlXCIpKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IHJlYWR5Um93LmNsaWNrKCk7XG5cbiAgICBjb25zdCByZWFkeURldGFpbHMgPSBwYWdlLmxvY2F0b3IoYCN0YXNrLWRldGFpbHMtJHtyZWFkeVRhc2tJZH1gKTtcbiAgICBjb25zdCByZWFkeVBsYW4gPSByZWFkeURldGFpbHMuZ2V0QnlSb2xlKFwicmVnaW9uXCIsIHtcbiAgICAgIG5hbWU6IFwiUmVtZWRpYXRpb24gcGxhblwiLFxuICAgIH0pO1xuICAgIGF3YWl0IGV4cGVjdChyZWFkeVBsYW4pLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KHJlYWR5UGxhbikudG9Db250YWluVGV4dChcIlNFQy0wMDFcIik7XG4gICAgYXdhaXQgZXhwZWN0KHJlYWR5UGxhbikudG9Db250YWluVGV4dChcIlVuc2FuaXRpemVkIFNRTCBpbnB1dFwiKTtcbiAgICBhd2FpdCBleHBlY3QocmVhZHlQbGFuKS50b0NvbnRhaW5UZXh0KFwiaGlnaFwiKTtcbiAgICBhd2FpdCBleHBlY3QocmVhZHlQbGFuKS50b0NvbnRhaW5UZXh0KFwiMiBvY2N1cnJlbmNlKHMpXCIpO1xuICAgIGF3YWl0IGV4cGVjdChyZWFkeVBsYW4pLnRvQ29udGFpblRleHQoXCJzcmMvYXV0aC9pbnB1dC50czoxMFwiKTtcbiAgICBhd2FpdCBleHBlY3QocmVhZHlQbGFuKS50b0NvbnRhaW5UZXh0KFwic3JjL2F1dGgvaW5wdXQudHM6NDRcIik7XG4gICAgYXdhaXQgZXhwZWN0KHJlYWR5UGxhbikudG9Db250YWluVGV4dChcIisxIG1vcmUgZXZpZGVuY2UgaXRlbXNcIik7XG4gICAgYXdhaXQgZXhwZWN0KHJlYWR5UGxhbikubm90LnRvQ29udGFpblRleHQoXCJzcmMvYXV0aC9pbnB1dC50czo1MlwiKTtcbiAgICBhd2FpdCBleHBlY3QocmVhZHlQbGFuKS50b0NvbnRhaW5UZXh0KFxuICAgICAgXCJVc2UgdGhlIHBhcmFtZXRlcml6ZWQgcXVlcnkgaGVscGVyIGZvciBldmVyeSB1c2VyLWNvbnRyb2xsZWQgdmFsdWUuXCIsXG4gICAgKTtcbiAgICBhd2FpdCBleHBlY3QocmVhZHlQbGFuKS50b0NvbnRhaW5UZXh0KFwiUnVuIHRoZSBTUUwgaW5qZWN0aW9uIHJlZ3Jlc3Npb24gdGVzdC5cIik7XG4gICAgYXdhaXQgZXhwZWN0KHJlYWR5UGxhbikudG9Db250YWluVGV4dChcIkNvbmZpcm0gYWxsIHVzZXItY29udHJvbGxlZCBxdWVyeSB2YWx1ZXMgdXNlIHBhcmFtZXRlcnMuXCIpO1xuICAgIGF3YWl0IGV4cGVjdChyZWFkeVBsYW4pLnRvQ29udGFpblRleHQoXCJSZWFkeSB0byBleGVjdXRlXCIpO1xuICAgIGF3YWl0IGV4cGVjdChyZWFkeVBsYW4pLnRvQ29udGFpblRleHQoXCJTb3VyY2U6IHNjYW5cIik7XG4gICAgYXdhaXQgZXhwZWN0KHJlYWR5UGxhbikudG9Db250YWluVGV4dChcInJldmlzaW9uIHJlbWVkaWF0aW9uLVwiKTtcbiAgICBhd2FpdCBleHBlY3QocmVhZHlEZXRhaWxzLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiRGV0YWlsc1wiIH0pKS50b0JlVmlzaWJsZSgpO1xuXG4gICAgYXdhaXQgcGFnZS5nZXRCeVRpdGxlKFwiRXhlY3V0ZVwiKS5jbGljaygpO1xuICAgIGF3YWl0IGV4cGVjdC5wb2xsKCgpID0+IGFjdGlvblJlcXVlc3RzLmxlbmd0aCkudG9CZSgxKTtcbiAgICBleHBlY3QoYWN0aW9uUmVxdWVzdHNbMF0pLnRvQmUoYGV4ZWN1dGU6JHtyZWFkeVRhc2tJZH1gKTtcbiAgICBhd2FpdCBleHBlY3QocmVhZHlSb3cpLnRvQ29udGFpblRleHQoXCJydW5uaW5nXCIpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlLmdldEJ5VGl0bGUoXCJFeGVjdXRlXCIpKS50b0hhdmVDb3VudCgwKTtcblxuICAgIGNvbnN0IHJldmlld1JvdyA9IHBhZ2UuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHtcbiAgICAgIG5hbWU6IC90YXNrIFJldmlldyBpbmNvbXBsZXRlIFNRTCByZW1lZGlhdGlvbiBldmlkZW5jZS8sXG4gICAgfSk7XG4gICAgYXdhaXQgcmV2aWV3Um93LmNsaWNrKCk7XG4gICAgY29uc3QgcmV2aWV3RGV0YWlscyA9IHBhZ2UubG9jYXRvcihgI3Rhc2stZGV0YWlscy0ke3Jldmlld1Rhc2tJZH1gKTtcbiAgICBjb25zdCByZXZpZXdQbGFuID0gcmV2aWV3RGV0YWlscy5nZXRCeVJvbGUoXCJyZWdpb25cIiwge1xuICAgICAgbmFtZTogXCJSZW1lZGlhdGlvbiBwbGFuXCIsXG4gICAgfSk7XG4gICAgYXdhaXQgZXhwZWN0KHJldmlld1BsYW4pLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KHJldmlld1BsYW4pLnRvQ29udGFpblRleHQoXCJTRUMtMDAyXCIpO1xuICAgIGF3YWl0IGV4cGVjdChyZXZpZXdQbGFuKS50b0NvbnRhaW5UZXh0KFwiSW5jb21wbGV0ZSBldmlkZW5jZSByZXZpZXdcIik7XG4gICAgYXdhaXQgZXhwZWN0KHJldmlld1BsYW4pLnRvQ29udGFpblRleHQoXCJjcml0aWNhbFwiKTtcbiAgICBhd2FpdCBleHBlY3QocmV2aWV3UGxhbikudG9Db250YWluVGV4dChcIjEgb2NjdXJyZW5jZShzKVwiKTtcbiAgICBhd2FpdCBleHBlY3QocmV2aWV3UGxhbikudG9Db250YWluVGV4dChcIk5lZWRzIHJldmlld1wiKTtcbiAgICBhd2FpdCBleHBlY3QocmV2aWV3UGxhbikudG9Db250YWluVGV4dChcIk5vIGJvdW5kZWQgZXZpZGVuY2Ugd2FzIHJldGFpbmVkLlwiKTtcbiAgICBhd2FpdCBleHBlY3QocmV2aWV3UGxhbikudG9Db250YWluVGV4dChcIk5vIHZlcmlmaWNhdGlvbiBzdGVwcyBzdXBwbGllZC5cIik7XG4gICAgYXdhaXQgZXhwZWN0KHJldmlld1BsYW4pLnRvQ29udGFpblRleHQoXCJTb3VyY2U6IGRpc2NvdmVyeVwiKTtcbiAgICBhd2FpdCBleHBlY3QocmV2aWV3UGxhbikudG9Db250YWluVGV4dChcInJldmlzaW9uIHVuYXZhaWxhYmxlXCIpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlLmdldEJ5VGl0bGUoXCJSZXRyeVwiKSkudG9CZVZpc2libGUoKTtcblxuICAgIGF3YWl0IHBhZ2UuZ2V0QnlUaXRsZShcIlJldHJ5XCIpLmNsaWNrKCk7XG4gICAgYXdhaXQgZXhwZWN0LnBvbGwoKCkgPT4gYWN0aW9uUmVxdWVzdHMubGVuZ3RoKS50b0JlKDIpO1xuICAgIGV4cGVjdChhY3Rpb25SZXF1ZXN0c1sxXSkudG9CZShgcmV0cnk6JHtyZXZpZXdUYXNrSWR9YCk7XG4gICAgYXdhaXQgZXhwZWN0KHJldmlld1JvdykudG9Db250YWluVGV4dChcInF1ZXVlZFwiKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5nZXRCeVRpdGxlKFwiUmV0cnlcIikpLnRvSGF2ZUNvdW50KDApO1xuXG4gICAgY29uc3QgdmVyaWZpY2F0aW9uUm93ID0gcGFnZS5nZXRCeVJvbGUoXCJidXR0b25cIiwge1xuICAgICAgbmFtZTogL3Rhc2sgVmVyaWZ5IHBhcmFtZXRlcml6ZWQgU1FMIHJlbWVkaWF0aW9uLyxcbiAgICB9KTtcbiAgICBhd2FpdCB2ZXJpZmljYXRpb25Sb3cuY2xpY2soKTtcbiAgICBjb25zdCB2ZXJpZmljYXRpb25EZXRhaWxzID0gcGFnZS5sb2NhdG9yKFxuICAgICAgYCN0YXNrLWRldGFpbHMtJHt2ZXJpZmljYXRpb25UYXNrSWR9YCxcbiAgICApO1xuICAgIGNvbnN0IHZlcmlmaWNhdGlvblBsYW4gPSB2ZXJpZmljYXRpb25EZXRhaWxzLmdldEJ5Um9sZShcInJlZ2lvblwiLCB7XG4gICAgICBuYW1lOiBcIlJlbWVkaWF0aW9uIHBsYW5cIixcbiAgICB9KTtcbiAgICBjb25zdCB2ZXJpZmljYXRpb25DaGVja3MgPSB2ZXJpZmljYXRpb25EZXRhaWxzLmdldEJ5Um9sZShcInJlZ2lvblwiLCB7XG4gICAgICBuYW1lOiBcIk9wZXJhdG9yIHZlcmlmaWNhdGlvbiBjaGVja3NcIixcbiAgICB9KTtcbiAgICBhd2FpdCBleHBlY3QodmVyaWZpY2F0aW9uUGxhbikudG9Db250YWluVGV4dChcIlNFQy0wMDNcIik7XG4gICAgYXdhaXQgZXhwZWN0KHZlcmlmaWNhdGlvblBsYW4pLnRvQ29udGFpblRleHQoXCJSZWFkeSB0byBleGVjdXRlXCIpO1xuICAgIGF3YWl0IHZlcmlmaWNhdGlvbkRldGFpbHNcbiAgICAgIC5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIlJ1biBhbmQgcmVjb3JkIHZlcmlmaWNhdGlvbiBjaGVja3NcIiB9KVxuICAgICAgLmNsaWNrKCk7XG4gICAgYXdhaXQgZXhwZWN0KHZlcmlmaWNhdGlvbkNoZWNrcykudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QodmVyaWZpY2F0aW9uQ2hlY2tzKS50b0NvbnRhaW5UZXh0KFwiSW5jb21wbGV0ZVwiKTtcblxuICAgIGNvbnN0IGZpcnN0R3VpZGFuY2UgPSBcIlJ1biB0aGUgU1FMIGluamVjdGlvbiByZWdyZXNzaW9uIHRlc3QuXCI7XG4gICAgY29uc3Qgc2Vjb25kR3VpZGFuY2UgPVxuICAgICAgXCJDb25maXJtIGFsbCB1c2VyLWNvbnRyb2xsZWQgcXVlcnkgdmFsdWVzIHVzZSBwYXJhbWV0ZXJzLlwiO1xuICAgIGNvbnN0IGZpcnN0RXZpZGVuY2UgPSB2ZXJpZmljYXRpb25DaGVja3MuZ2V0QnlMYWJlbChcbiAgICAgIGBFdmlkZW5jZSBmb3IgJHtmaXJzdEd1aWRhbmNlfWAsXG4gICAgKTtcbiAgICBjb25zdCBzZWNvbmRFdmlkZW5jZSA9IHZlcmlmaWNhdGlvbkNoZWNrcy5nZXRCeUxhYmVsKFxuICAgICAgYEV2aWRlbmNlIGZvciAke3NlY29uZEd1aWRhbmNlfWAsXG4gICAgKTtcbiAgICBjb25zdCBwYXNzQnV0dG9ucyA9IHZlcmlmaWNhdGlvbkNoZWNrcy5nZXRCeVJvbGUoXCJidXR0b25cIiwge1xuICAgICAgbmFtZTogXCJSZWNvcmQgcGFzc2VkXCIsXG4gICAgfSk7XG4gICAgY29uc3QgZmFpbGVkQnV0dG9ucyA9IHZlcmlmaWNhdGlvbkNoZWNrcy5nZXRCeVJvbGUoXCJidXR0b25cIiwge1xuICAgICAgbmFtZTogXCJSZWNvcmQgZmFpbGVkXCIsXG4gICAgfSk7XG4gICAgYXdhaXQgZXhwZWN0KHBhc3NCdXR0b25zLm50aCgwKSkudG9CZURpc2FibGVkKCk7XG4gICAgYXdhaXQgZmlyc3RFdmlkZW5jZS5maWxsKFwiVGhlIHJlZ3Jlc3Npb24gdGVzdCBzdGlsbCBmYWlscyBiZWZvcmUgdGhlIGZpeC5cIik7XG4gICAgYXdhaXQgZmFpbGVkQnV0dG9ucy5udGgoMCkuY2xpY2soKTtcbiAgICBhd2FpdCBleHBlY3QucG9sbCgoKSA9PiB2ZXJpZmljYXRpb25SZXF1ZXN0cy5sZW5ndGgpLnRvQmUoMSk7XG4gICAgZXhwZWN0KHZlcmlmaWNhdGlvblJlcXVlc3RzWzBdKS50b01hdGNoT2JqZWN0KHtcbiAgICAgIHRhc2tJZDogdmVyaWZpY2F0aW9uVGFza0lkLFxuICAgICAgY2hlY2tJZDogXCJydWxlLXZlcmlmaWNhdGlvbi0xXCIsXG4gICAgICBwYXNzZWQ6IGZhbHNlLFxuICAgIH0pO1xuICAgIGF3YWl0IGV4cGVjdCh2ZXJpZmljYXRpb25DaGVja3MpLnRvQ29udGFpblRleHQoXCJJbmNvbXBsZXRlXCIpO1xuICAgIGF3YWl0IGV4cGVjdCh2ZXJpZmljYXRpb25Sb3cpLnRvQ29udGFpblRleHQoXCJ2ZXJpZnlpbmdcIik7XG5cbiAgICBhd2FpdCBmaXJzdEV2aWRlbmNlLmZpbGwoXCJUaGUgZm9jdXNlZCByZWdyZXNzaW9uIHRlc3QgcGFzc2VzIGFmdGVyIHRoZSBmaXguXCIpO1xuICAgIGF3YWl0IHBhc3NCdXR0b25zLm50aCgwKS5jbGljaygpO1xuICAgIGF3YWl0IGV4cGVjdC5wb2xsKCgpID0+IHZlcmlmaWNhdGlvblJlcXVlc3RzLmxlbmd0aCkudG9CZSgyKTtcbiAgICBleHBlY3QodmVyaWZpY2F0aW9uUmVxdWVzdHNbMV0pLnRvTWF0Y2hPYmplY3Qoe1xuICAgICAgdGFza0lkOiB2ZXJpZmljYXRpb25UYXNrSWQsXG4gICAgICBjaGVja0lkOiBcInJ1bGUtdmVyaWZpY2F0aW9uLTFcIixcbiAgICAgIHBhc3NlZDogdHJ1ZSxcbiAgICAgIGV2aWRlbmNlOiBcIlRoZSBmb2N1c2VkIHJlZ3Jlc3Npb24gdGVzdCBwYXNzZXMgYWZ0ZXIgdGhlIGZpeC5cIixcbiAgICB9KTtcbiAgICBhd2FpdCBleHBlY3QodmVyaWZpY2F0aW9uQ2hlY2tzKS50b0NvbnRhaW5UZXh0KFwiSW5jb21wbGV0ZVwiKTtcblxuICAgIGF3YWl0IHNlY29uZEV2aWRlbmNlLmZpbGwoXG4gICAgICBcIkFsbCB1c2VyLWNvbnRyb2xsZWQgcXVlcnkgdmFsdWVzIHVzZSB0aGUgcGFyYW1ldGVyaXplZCBoZWxwZXIuXCIsXG4gICAgKTtcbiAgICBhd2FpdCBwYXNzQnV0dG9ucy5udGgoMSkuY2xpY2soKTtcbiAgICBhd2FpdCBleHBlY3QucG9sbCgoKSA9PiB2ZXJpZmljYXRpb25SZXF1ZXN0cy5sZW5ndGgpLnRvQmUoMyk7XG4gICAgZXhwZWN0KHZlcmlmaWNhdGlvblJlcXVlc3RzWzJdKS50b01hdGNoT2JqZWN0KHtcbiAgICAgIHRhc2tJZDogdmVyaWZpY2F0aW9uVGFza0lkLFxuICAgICAgY2hlY2tJZDogXCJydWxlLXZlcmlmaWNhdGlvbi0yXCIsXG4gICAgICBwYXNzZWQ6IHRydWUsXG4gICAgICBldmlkZW5jZTogXCJBbGwgdXNlci1jb250cm9sbGVkIHF1ZXJ5IHZhbHVlcyB1c2UgdGhlIHBhcmFtZXRlcml6ZWQgaGVscGVyLlwiLFxuICAgIH0pO1xuICAgIGF3YWl0IGV4cGVjdCh2ZXJpZmljYXRpb25Sb3cpLnRvQ29udGFpblRleHQoXCJjb21wbGV0ZWRcIik7XG4gICAgYXdhaXQgdmVyaWZpY2F0aW9uRGV0YWlscy5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIkRldGFpbHNcIiB9KS5jbGljaygpO1xuICAgIGF3YWl0IGV4cGVjdCh2ZXJpZmljYXRpb25QbGFuKS50b0NvbnRhaW5UZXh0KFwiVmVyaWZpZWRcIik7XG4gICAgYXdhaXQgdmVyaWZpY2F0aW9uRGV0YWlscy5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIkxvZ3NcIiB9KS5jbGljaygpO1xuICAgIGF3YWl0IGV4cGVjdCh2ZXJpZmljYXRpb25DaGVja3MpLnRvQ29udGFpblRleHQoXCJWZXJpZmllZFwiKTtcbiAgICBhd2FpdCBleHBlY3QodmVyaWZpY2F0aW9uRGV0YWlscykudG9Db250YWluVGV4dChcbiAgICAgIFwiVGFzayBjb21wbGV0ZWQgYW5kIHZlcmlmaWVkIGJ5IHRoZSBzZXJ2ZXIuXCIsXG4gICAgKTtcblxuICAgIGF3YWl0IHBhZ2UucmVsb2FkKCk7XG4gICAgY29uc3QgcmVsb2FkZWRWZXJpZmljYXRpb25Sb3cgPSBwYWdlLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7XG4gICAgICBuYW1lOiAvdGFzayBWZXJpZnkgcGFyYW1ldGVyaXplZCBTUUwgcmVtZWRpYXRpb24vLFxuICAgIH0pO1xuICAgIGF3YWl0IGV4cGVjdChyZWxvYWRlZFZlcmlmaWNhdGlvblJvdykudG9Db250YWluVGV4dChcImNvbXBsZXRlZFwiKTtcbiAgICBhd2FpdCByZWxvYWRlZFZlcmlmaWNhdGlvblJvdy5jbGljaygpO1xuICAgIGNvbnN0IHJlbG9hZGVkRGV0YWlscyA9IHBhZ2UubG9jYXRvcihcbiAgICAgIGAjdGFzay1kZXRhaWxzLSR7dmVyaWZpY2F0aW9uVGFza0lkfWAsXG4gICAgKTtcbiAgICBhd2FpdCByZWxvYWRlZERldGFpbHMuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJMb2dzXCIgfSkuY2xpY2soKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICByZWxvYWRlZERldGFpbHMuZ2V0QnlSb2xlKFwicmVnaW9uXCIsIHtcbiAgICAgICAgbmFtZTogXCJPcGVyYXRvciB2ZXJpZmljYXRpb24gY2hlY2tzXCIsXG4gICAgICB9KSxcbiAgICApLnRvQ29udGFpblRleHQoXCJWZXJpZmllZFwiKTtcbiAgICBhd2FpdCBleHBlY3QocmVsb2FkZWREZXRhaWxzKS50b0NvbnRhaW5UZXh0KFxuICAgICAgXCJUYXNrIGNvbXBsZXRlZCBhbmQgdmVyaWZpZWQgYnkgdGhlIHNlcnZlci5cIixcbiAgICApO1xuXG4gICAgY29uc3QgdmlzaWJsZVRleHQgPSBhd2FpdCBwYWdlLmxvY2F0b3IoXCJib2R5XCIpLmlubmVyVGV4dCgpO1xuICAgIGV4cGVjdCh2aXNpYmxlVGV4dCkubm90LnRvQ29udGFpbihyYXdQcm9tcHQpO1xuICAgIGV4cGVjdCh2aXNpYmxlVGV4dCkubm90LnRvQ29udGFpbihyYXdEaWFnbm9zdGljKTtcbiAgICBhd2FpdCBleHBlY3ROb0hvcml6b250YWxPdmVyZmxvdyhwYWdlKTtcbiAgfSk7XG5cbiAgdGVzdChcImNvbnZlcmdlcyB0d28gYnJvd3NlciBzZXNzaW9ucyBhY3Jvc3MgcmVsb2FkLCByZWNvbm5lY3QsIHN0YWxlIHJlc3VsdHMsIGFuZCBBUEkgcmVzdGFydFwiLCBhc3luYyAoe1xuICAgIGJyb3dzZXIsXG4gICAgcGFnZSxcbiAgfSkgPT4ge1xuICAgIHRlc3Quc2tpcChcbiAgICAgICFwcm9jZXNzLmVudi5EQVNIQk9BUkRfRTJFX0NPTlRST0xfVVJMLFxuICAgICAgXCJUaGUgbXVsdGktcHJvY2VzcyBjb252ZXJnZW5jZSBjYW1wYWlnbiBydW5zIG9ubHkgdW5kZXIgdGhlIHJlbGVhc2UgcnVubmVyLlwiLFxuICAgICk7XG4gICAgdGVzdC5zZXRUaW1lb3V0KDkwXzAwMCk7XG5cbiAgICBjb25zdCBzZWNvbmRDb250ZXh0ID0gYXdhaXQgYnJvd3Nlci5uZXdDb250ZXh0KCk7XG4gICAgY29uc3Qgc2Vjb25kUGFnZSA9IGF3YWl0IHNlY29uZENvbnRleHQubmV3UGFnZSgpO1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCBQcm9taXNlLmFsbChbaW5zdGFsbEFwaUZpeHR1cmVzKHBhZ2UpLCBpbnN0YWxsQXBpRml4dHVyZXMoc2Vjb25kUGFnZSldKTtcbiAgICAgIGF3YWl0IFByb21pc2UuYWxsKFtwcm9ncmFtbWF0aWNTaWduSW4ocGFnZSksIHByb2dyYW1tYXRpY1NpZ25JbihzZWNvbmRQYWdlKV0pO1xuICAgICAgYXdhaXQgUHJvbWlzZS5hbGwoW1xuICAgICAgICBwYWdlLmdvdG8oREFTSEJPQVJEX1BBVEgpLFxuICAgICAgICBzZWNvbmRQYWdlLmdvdG8oYCR7REFTSEJPQVJEX1BBVEh9YWlgKSxcbiAgICAgIF0pO1xuICAgICAgYXdhaXQgZXhwZWN0RGFzaGJvYXJkUmVhZHkocGFnZSk7XG4gICAgICBhd2FpdCBleHBlY3Qoc2Vjb25kUGFnZS5sb2NhdG9yKFwidGV4dGFyZWFcIikuZmlyc3QoKSkudG9CZVZpc2libGUoKTtcblxuICAgICAgLy8gQSByZXNwb25zZSB0aGF0IGFycml2ZXMgYWZ0ZXIgYSBuZXdlciByZXF1ZXN0IG11c3Qgbm90IHJlcGxhY2UgdGhlXG4gICAgICAvLyB2aXNpYmxlIHJlYWR5IHN0YXRlIHdpdGggc3RhbGUgZGF0YS4gS2VlcCB0aGUgZGVsYXkgYm91bmRlZCBzbyBhXG4gICAgICAvLyBodW5nIHJlcXVlc3QgY2Fubm90IG1ha2UgdGhpcyBjYW1wYWlnbiBwYXNzIGluZGVmaW5pdGVseS5cbiAgICAgIGNvbnN0IGN1cnJlbnREYXNoYm9hcmRGaXh0dXJlID0ge1xuICAgICAgICAuLi5kYXNoYm9hcmRGaXh0dXJlLFxuICAgICAgICAvLyBUaGUgcmVsZWFzZSBydW5uZXIgc3RhcnRzIGFnYWluc3QgcmVhbCBkZXZlbG9wbWVudCBkYXRhLCB3aG9zZVxuICAgICAgICAvLyBzZXJ2ZXItb3duZWQgcmV2aXNpb24gbWF5IGJlIG5ld2VyIHRoYW4gdGhlIHN0YXRpYyBmaXh0dXJlIGJlbG93LlxuICAgICAgICAvLyBLZWVwIHRoaXMgc3ludGhldGljIFwiY3VycmVudFwiIHJlc3BvbnNlIGFoZWFkIG9mIHRoYXQgd2F0ZXJtYXJrIHNvXG4gICAgICAgIC8vIHRoZSB0ZXN0IGV4ZXJjaXNlcyBzdGFsZS1yZXNwb25zZSByZWplY3Rpb24gcmF0aGVyIHRoYW4gZml4dHVyZVxuICAgICAgICAvLyByZWplY3Rpb24uXG4gICAgICAgIGZyZXNobmVzc1JldmlzaW9uOiBcIjIwOTktMDEtMDFUMDA6MDM6MDAuMDAwWlwiLFxuICAgICAgICBwcm9qZWN0U2NvcmVzOiBbeyAuLi5kYXNoYm9hcmRGaXh0dXJlLnByb2plY3RTY29yZXNbMF0sIHByb2plY3ROYW1lOiBcIkNvbmN1cnJlbnQgUHJvamVjdFwiLCBzY29yZTogOTcgfV0sXG4gICAgICAgIGFjdGl2ZVRhc2tDb3VudDogMSxcbiAgICAgICAgdGFza1N0YXR1c0JyZWFrZG93bjogeyBwZW5kaW5nOiAwLCBydW5uaW5nOiAxIH0sXG4gICAgICB9O1xuICAgICAgbGV0IHJlZnJlc2hDb3VudCA9IDA7XG4gICAgICBsZXQgcmVsZWFzZVN0YWxlUmVzcG9uc2UhOiAoKSA9PiB2b2lkO1xuICAgICAgY29uc3Qgc3RhbGVSZXNwb25zZVJlbGVhc2VkID0gbmV3IFByb21pc2U8dm9pZD4oKHJlc29sdmUpID0+IHtcbiAgICAgICAgcmVsZWFzZVN0YWxlUmVzcG9uc2UgPSByZXNvbHZlO1xuICAgICAgfSk7XG4gICAgICBhd2FpdCBwYWdlLnJvdXRlKFwiKiovYXBpL2Rhc2hib2FyZFwiLCBhc3luYyAocm91dGUpID0+IHtcbiAgICAgICAgcmVmcmVzaENvdW50ICs9IDE7XG4gICAgICAgIGlmIChyZWZyZXNoQ291bnQgPT09IDEpIHJldHVybiByb3V0ZS5mdWxmaWxsKGpzb25SZXNwb25zZShjdXJyZW50RGFzaGJvYXJkRml4dHVyZSkpO1xuICAgICAgICBhd2FpdCBzdGFsZVJlc3BvbnNlUmVsZWFzZWQ7XG4gICAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKGpzb25SZXNwb25zZShkYXNoYm9hcmRGaXh0dXJlKSk7XG4gICAgICB9KTtcbiAgICAgIGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJSZWZyZXNoIHN0YXR1c1wiIH0pLmNsaWNrKCk7XG4gICAgICBhd2FpdCBleHBlY3QocGFnZS5nZXRCeVRleHQoXCJDb25jdXJyZW50IFByb2plY3RcIiwgeyBleGFjdDogdHJ1ZSB9KSkudG9CZVZpc2libGUoKTtcbiAgICAgIGF3YWl0IGV4cGVjdChwYWdlLmdldEJ5VGV4dChcIjk3XCIsIHsgZXhhY3Q6IHRydWUgfSkpLnRvQmVWaXNpYmxlKCk7XG4gICAgICBjb25zdCBzdGFsZVJlZnJlc2ggPSBwYWdlLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiUmVmcmVzaCBzdGF0dXNcIiB9KS5jbGljaygpO1xuICAgICAgYXdhaXQgZXhwZWN0LnBvbGwoKCkgPT4gcmVmcmVzaENvdW50KS50b0JlKDIpO1xuICAgICAgcmVsZWFzZVN0YWxlUmVzcG9uc2UoKTtcbiAgICAgIGF3YWl0IHN0YWxlUmVmcmVzaDtcbiAgICAgIGF3YWl0IGV4cGVjdERhc2hib2FyZFJlYWR5KHBhZ2UpO1xuICAgICAgYXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlUZXh0KFwiQ29uY3VycmVudCBQcm9qZWN0XCIsIHsgZXhhY3Q6IHRydWUgfSkpLnRvQmVWaXNpYmxlKCk7XG4gICAgICBhd2FpdCBleHBlY3QocGFnZS5nZXRCeVRleHQoXCI5N1wiLCB7IGV4YWN0OiB0cnVlIH0pKS50b0JlVmlzaWJsZSgpO1xuICAgICAgYXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlUZXh0KFwiMVwiLCB7IGV4YWN0OiB0cnVlIH0pLmZpcnN0KCkpLnRvQmVWaXNpYmxlKCk7XG5cbiAgICAgIC8vIFNpbXVsYXRlIGEgZHJvcHBlZCBjb25uZWN0aW9uIGluIHRoZSBzZWNvbmQgYnJvd3NlciBhbmQgYXNzZXJ0IHRoZVxuICAgICAgLy8gcmVjb3ZlcnkgYWN0aW9uIHJlbmRlcmVkIGJ5IHRoZSBkYXNoYm9hcmQsIHRoZW4gbGV0IHRoZSBuZXh0IHJlcXVlc3RcbiAgICAgIC8vIHJlY29ubmVjdCBub3JtYWxseS5cbiAgICAgIGxldCByZWNvbm5lY3RBdHRlbXB0ID0gMDtcbiAgICAgIGF3YWl0IHNlY29uZFBhZ2UuZ290byhEQVNIQk9BUkRfUEFUSCk7XG4gICAgICBhd2FpdCBleHBlY3REYXNoYm9hcmRSZWFkeShzZWNvbmRQYWdlKTtcbiAgICAgIGF3YWl0IHNlY29uZFBhZ2Uucm91dGUoXCIqKi9hcGkvZGFzaGJvYXJkXCIsIGFzeW5jIChyb3V0ZSkgPT4ge1xuICAgICAgICByZWNvbm5lY3RBdHRlbXB0ICs9IDE7XG4gICAgICAgIC8vIHVzZUdldERhc2hib2FyZCByZXRyaWVzIG9uY2U7IGhvbGQgYm90aCBib3VuZGVkIGF0dGVtcHRzIHNvIHRoZVxuICAgICAgICAvLyByZW5kZXJlZCBlcnJvciBzdGF0ZSBpcyBvYnNlcnZhYmxlIGJlZm9yZSB0aGUgb3BlcmF0b3IgcmV0cmllcy5cbiAgICAgICAgaWYgKHJlY29ubmVjdEF0dGVtcHQgPD0gMikge1xuICAgICAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKFxuICAgICAgICAgICAganNvblJlc3BvbnNlKHsgZXJyb3I6IFwiY29udHJvbGxlZCByZWNvbm5lY3QgaW50ZXJydXB0aW9uXCIgfSwgNTAzKSxcbiAgICAgICAgICApO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiByb3V0ZS5jb250aW51ZSgpO1xuICAgICAgfSk7XG4gICAgICBhd2FpdCBzZWNvbmRQYWdlLnJlbG9hZCgpO1xuICAgICAgYXdhaXQgZXhwZWN0KFxuICAgICAgICBzZWNvbmRQYWdlLmdldEJ5Um9sZShcImhlYWRpbmdcIiwgeyBuYW1lOiBcIkZhaWxlZCB0byBsb2FkIGRhc2hib2FyZFwiIH0pLFxuICAgICAgKS50b0JlVmlzaWJsZSgpO1xuICAgICAgYXdhaXQgZXhwZWN0KFxuICAgICAgICBzZWNvbmRQYWdlLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiUmV0cnkgQ29ubmVjdGlvblwiIH0pLFxuICAgICAgKS50b0JlVmlzaWJsZSgpO1xuICAgICAgYXdhaXQgc2Vjb25kUGFnZS51bnJvdXRlKFwiKiovYXBpL2Rhc2hib2FyZFwiKTtcbiAgICAgIGF3YWl0IHNlY29uZFBhZ2UuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJSZXRyeSBDb25uZWN0aW9uXCIgfSkuY2xpY2soKTtcbiAgICAgIGF3YWl0IGV4cGVjdERhc2hib2FyZFJlYWR5KHNlY29uZFBhZ2UpO1xuXG4gICAgICBhd2FpdCByZXN0YXJ0QXBpRm9yQ2FtcGFpZ24ocGFnZSk7XG4gICAgICBhd2FpdCBQcm9taXNlLmFsbChbcGFnZS5yZWxvYWQoKSwgc2Vjb25kUGFnZS5yZWxvYWQoKV0pO1xuICAgICAgYXdhaXQgZXhwZWN0RGFzaGJvYXJkUmVhZHkocGFnZSk7XG4gICAgICBhd2FpdCBleHBlY3REYXNoYm9hcmRSZWFkeShzZWNvbmRQYWdlKTtcblxuICAgICAgYXdhaXQgcGFnZS5yZWxvYWQoKTtcbiAgICAgIGF3YWl0IGV4cGVjdERhc2hib2FyZFJlYWR5KHBhZ2UpO1xuICAgICAgYXdhaXQgZXhwZWN0KFxuICAgICAgICBwYWdlLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiUmV0cnkgQ29ubmVjdGlvblwiIH0pLFxuICAgICAgKS50b0hhdmVDb3VudCgwKTtcbiAgICAgIGF3YWl0IGV4cGVjdE5vSG9yaXpvbnRhbE92ZXJmbG93KHBhZ2UpO1xuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCBzZWNvbmRDb250ZXh0LmNsb3NlKCk7XG4gICAgfVxuICB9KTtcblxuICB0ZXN0KFwicHJldmlld3MgYW5kIGRvd25sb2FkcyB0aGUgY29tcGxldGVkIGV4ZWN1dGlvbiBhdWRpdCB3aXRob3V0IGR1cGxpY2F0aW5nIGVmZmVjdHNcIiwgYXN5bmMgKHtcbiAgICBwYWdlLFxuICB9KSA9PiB7XG4gICAgY29uc3QgYXVkaXRSZXF1ZXN0czogc3RyaW5nW10gPSBbXTtcbiAgICBjb25zdCBhdWRpdEJvZHkgPSB7XG4gICAgICBmb3JtYXQ6IFwiZW5naW5lZXJpbmdvcy5leGVjdXRpb24tYXVkaXQudjFcIixcbiAgICAgIGV4cG9ydGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMjowMC4wMDBaXCIsXG4gICAgICBleGVjdXRpb246IHtcbiAgICAgICAgaWQ6IEVYRUNVVElPTl9JRCxcbiAgICAgICAgcHJvamVjdElkOiBcImUyZS1wcm9qZWN0XCIsXG4gICAgICAgIHNlc3Npb25JZDogXCJlMmUtYXVkaXQtc2Vzc2lvblwiLFxuICAgICAgICBvcGVyYXRpb25JZDogZXhlY3V0aW9uRml4dHVyZS5vcGVyYXRpb25JZCxcbiAgICAgICAgc3RhdHVzOiBcImNvbXBsZXRlZFwiLFxuICAgICAgICB0ZXJtaW5hbFN0YXRlOiBcImNvbXBsZXRlZFwiLFxuICAgICAgICByZXZpc2lvbjogXCJlMmUtcmV2aXNpb24tNDJcIixcbiAgICAgICAgcHJvb2Y6IHsgcmVxdWlyZWQ6IGZhbHNlLCB2ZXJkaWN0OiBcIlBST1ZFTlwiIH0sXG4gICAgICB9LFxuICAgICAgdGltZWxpbmU6IFtdLFxuICAgICAgdmFsaWRhdGlvbnM6IFt7IHN0YXR1czogXCJwYXNzZWRcIiwgcHJvZmlsZTogXCJyZWxlYXNlLXNhZmVcIiB9XSxcbiAgICAgIGFmZmVjdGVkRmlsZXM6IFtcInNyYy9mZWF0dXJlLnRzXCJdLFxuICAgICAgcmVkYWN0aW9uOiB7XG4gICAgICAgIGV4Y2x1ZGVkOiBbXG4gICAgICAgICAgXCJwcm92aWRlciBzZWNyZXRzXCIsXG4gICAgICAgICAgXCJyYXcgbW9kZWwgb3V0cHV0XCIsXG4gICAgICAgICAgXCJwcml2YXRlIHJ1bnRpbWUgcGF0aHNcIixcbiAgICAgICAgXSxcbiAgICAgIH0sXG4gICAgfTtcbiAgICBhd2FpdCBpbnN0YWxsQXBpRml4dHVyZXMocGFnZSwge1xuICAgICAgYXVkaXRFeHBvcnQ6IHtcbiAgICAgICAgYm9keTogYXVkaXRCb2R5LFxuICAgICAgICBmaWxlbmFtZTogXCJzZXJ2ZXItc3VwcGxpZWQtYXVkaXQtbmFtZS5qc29uXCIsXG4gICAgICAgIHJlcXVlc3RzOiBhdWRpdFJlcXVlc3RzLFxuICAgICAgICBmYWlsRmlyc3RQcmV2aWV3OiB0cnVlLFxuICAgICAgfSxcbiAgICB9KTtcbiAgICBhd2FpdCBwcm9ncmFtbWF0aWNTaWduSW4ocGFnZSk7XG4gICAgYXdhaXQgcGFnZS5ldmFsdWF0ZSgoKSA9PiB7XG4gICAgICBjb25zdCBleGVjdXRpb24gPSB7XG4gICAgICAgIGlkOiBcImUyZS1jb250cm9sbGVkLWV4ZWN1dGlvblwiLFxuICAgICAgICBwcm9qZWN0SWQ6IFwiZTJlLXByb2plY3RcIixcbiAgICAgICAgc2Vzc2lvbklkOiBcImUyZS1hdWRpdC1zZXNzaW9uXCIsXG4gICAgICAgIG1lc3NhZ2U6IFwiQ29tcGxldGVkIGF1ZGl0IGV4ZWN1dGlvblwiLFxuICAgICAgfTtcbiAgICAgIGxvY2FsU3RvcmFnZS5zZXRJdGVtKFxuICAgICAgICBcImVvc19haV9leGVjdXRpb25fY3VycmVudF9lMmUtcHJvamVjdFwiLFxuICAgICAgICBcImUyZS1hdWRpdC1zZXNzaW9uXCIsXG4gICAgICApO1xuICAgICAgbG9jYWxTdG9yYWdlLnNldEl0ZW0oXG4gICAgICAgIFwiZW9zX2FpX2V4ZWN1dGlvbl9lMmUtcHJvamVjdF9lMmUtYXVkaXQtc2Vzc2lvblwiLFxuICAgICAgICBKU09OLnN0cmluZ2lmeShleGVjdXRpb24pLFxuICAgICAgKTtcbiAgICB9KTtcbiAgICBhd2FpdCBwYWdlLmdvdG8oYCR7REFTSEJPQVJEX1BBVEh9YWlgKTtcblxuICAgIGNvbnN0IHByb29mID0gcGFnZS5nZXRCeUxhYmVsKFwiQWdlbnQgZXhlY3V0aW9uIHByb29mXCIpO1xuICAgIGF3YWl0IGV4cGVjdChwcm9vZikudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QocHJvb2YpLnRvQ29udGFpblRleHQoL2NvbXBsZXRlZC9pKTtcbiAgICBhd2FpdCBleHBlY3QocHJvb2YpLnRvQ29udGFpblRleHQoXCJSZXZpc2lvbjogZTJlLXJldmlzaW9uLTQyXCIpO1xuXG4gICAgYXdhaXQgcHJvb2YuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJQcmV2aWV3IGF1ZGl0XCIgfSkuY2xpY2soKTtcbiAgICBjb25zdCBwcmV2aWV3ID0gcGFnZS5nZXRCeUxhYmVsKFwiUmVkYWN0ZWQgYXVkaXQgcHJldmlld1wiKTtcbiAgICBhd2FpdCBleHBlY3QocHJldmlldykudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QocHJldmlldykudG9Db250YWluVGV4dChcIkF1ZGl0IHByZXZpZXcgdGVtcG9yYXJpbHkgdW5hdmFpbGFibGVcIik7XG4gICAgYXdhaXQgZXhwZWN0KHByZXZpZXcpLnRvQ29udGFpblRleHQoXCJzYW1lIGV4ZWN1dGlvbiBhbmQgcmV2aXNpb25cIik7XG4gICAgYXdhaXQgZXhwZWN0KHByZXZpZXcuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJSZXRyeSBwcmV2aWV3XCIgfSkpLnRvQmVWaXNpYmxlKCk7XG4gICAgZXhwZWN0KGF1ZGl0UmVxdWVzdHMpLnRvSGF2ZUxlbmd0aCgxKTtcblxuICAgIGF3YWl0IHByZXZpZXcuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJSZXRyeSBwcmV2aWV3XCIgfSkuY2xpY2soKTtcbiAgICBhd2FpdCBleHBlY3QocHJldmlldykudG9Db250YWluVGV4dChcInByb3ZpZGVyIHNlY3JldHNcIik7XG4gICAgYXdhaXQgZXhwZWN0KHByZXZpZXcpLnRvQ29udGFpblRleHQoXCJyYXcgbW9kZWwgb3V0cHV0XCIpO1xuICAgIGF3YWl0IGV4cGVjdChwcmV2aWV3KS50b0NvbnRhaW5UZXh0KFwicHJpdmF0ZSBydW50aW1lIHBhdGhzXCIpO1xuICAgIGF3YWl0IGV4cGVjdChwcmV2aWV3KS50b0NvbnRhaW5UZXh0KEVYRUNVVElPTl9JRCk7XG4gICAgYXdhaXQgZXhwZWN0KHByZXZpZXcpLnRvQ29udGFpblRleHQoXCJlMmUtb3BlcmF0aW9uXCIpO1xuICAgIGF3YWl0IGV4cGVjdChwcmV2aWV3KS50b0NvbnRhaW5UZXh0KFwiZTJlLXJldmlzaW9uLTQyXCIpO1xuICAgIGV4cGVjdChhdWRpdFJlcXVlc3RzKS50b0hhdmVMZW5ndGgoMik7XG4gICAgZXhwZWN0KG5ldyBVUkwoYXVkaXRSZXF1ZXN0c1swXSkucGF0aG5hbWUpLnRvQmUoXG4gICAgICBgL2FwaS9haS9leGVjdXRpb25zLyR7RVhFQ1VUSU9OX0lEfS9hdWRpdC1leHBvcnRgLFxuICAgICk7XG5cbiAgICBhd2FpdCBwcmV2aWV3LmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiQ2xvc2UgYXVkaXQgcHJldmlld1wiIH0pLmNsaWNrKCk7XG4gICAgYXdhaXQgZXhwZWN0KHByZXZpZXcpLnRvQmVIaWRkZW4oKTtcblxuICAgIGNvbnN0IGRvd25sb2FkUHJvbWlzZSA9IHBhZ2Uud2FpdEZvckV2ZW50KFwiZG93bmxvYWRcIik7XG4gICAgYXdhaXQgcHJvb2YuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJFeHBvcnQgYXVkaXRcIiB9KS5jbGljaygpO1xuICAgIGNvbnN0IGRvd25sb2FkID0gYXdhaXQgZG93bmxvYWRQcm9taXNlO1xuICAgIGV4cGVjdChkb3dubG9hZC5zdWdnZXN0ZWRGaWxlbmFtZSgpKS50b0JlKFwic2VydmVyLXN1cHBsaWVkLWF1ZGl0LW5hbWUuanNvblwiKTtcbiAgICBleHBlY3QoYXVkaXRSZXF1ZXN0cykudG9IYXZlTGVuZ3RoKDMpO1xuXG4gICAgYXdhaXQgcGFnZS5yZWxvYWQoKTtcbiAgICBjb25zdCByZWxvYWRlZFByb29mID0gcGFnZS5nZXRCeUxhYmVsKFwiQWdlbnQgZXhlY3V0aW9uIHByb29mXCIpO1xuICAgIGF3YWl0IGV4cGVjdChyZWxvYWRlZFByb29mKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChyZWxvYWRlZFByb29mKS50b0NvbnRhaW5UZXh0KC9jb21wbGV0ZWQvaSk7XG4gICAgYXdhaXQgZXhwZWN0KHJlbG9hZGVkUHJvb2YpLnRvQ29udGFpblRleHQoXCJFeGVjdXRpb24gZTJlLWNvbnRyb2xsZWQtZXhlY3V0aW9uXCIpO1xuICAgIGF3YWl0IGV4cGVjdChyZWxvYWRlZFByb29mKS50b0NvbnRhaW5UZXh0KFwiUmV2aXNpb246IGUyZS1yZXZpc2lvbi00MlwiKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5TGFiZWwoXCJSZWRhY3RlZCBhdWRpdCBwcmV2aWV3XCIpLFxuICAgICkudG9CZUhpZGRlbigpO1xuICAgIGV4cGVjdChhdWRpdFJlcXVlc3RzKS50b0hhdmVMZW5ndGgoMyk7XG4gIH0pO1xuXG4gIHRlc3QoXCJrZWVwcyB0aGUgY2FuY2VsbGVkIGV4ZWN1dGlvbiBhdWRpdCBoYW5kb2ZmIHJlZGFjdGVkIGFuZCB0ZXJtaW5hbFwiLCBhc3luYyAoe1xuICAgIHBhZ2UsXG4gIH0pID0+IHtcbiAgICBjb25zdCBhdWRpdFJlcXVlc3RzOiBzdHJpbmdbXSA9IFtdO1xuICAgIGNvbnN0IGNhbmNlbGxlZEV4ZWN1dGlvbiA9IHtcbiAgICAgIC4uLmV4ZWN1dGlvbkZpeHR1cmUsXG4gICAgICBzdGF0dXM6IFwiY2FuY2VsbGVkXCIsXG4gICAgICBmbGlnaHRTdGF0ZTogXCJDQU5DRUxMRURcIixcbiAgICAgIGNoZWNrcG9pbnQ6IHtcbiAgICAgICAgc3RhZ2U6IFwiY2FuY2VsbGVkXCIsXG4gICAgICAgIGRldGFpbDogXCJFeGVjdXRpb24gY2FuY2VsbGVkIGJlZm9yZSBhbnkgY2hhbmdlcyB3ZXJlIGFwcGxpZWQuXCIsXG4gICAgICB9LFxuICAgICAgdGVybWluYWxSZWFzb246IFwiY2FuY2VsX3JlcXVlc3RlZFwiLFxuICAgICAgY29tcGxldGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMTozMC4wMDBaXCIsXG4gICAgICB1cGRhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMTozMC4wMDBaXCIsXG4gICAgfTtcbiAgICBjb25zdCBhdWRpdEJvZHkgPSB7XG4gICAgICBmb3JtYXQ6IFwiZW5naW5lZXJpbmdvcy5leGVjdXRpb24tYXVkaXQudjFcIixcbiAgICAgIGV4cG9ydGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMjowMC4wMDBaXCIsXG4gICAgICBleGVjdXRpb246IHtcbiAgICAgICAgaWQ6IEVYRUNVVElPTl9JRCxcbiAgICAgICAgcHJvamVjdElkOiBcImUyZS1wcm9qZWN0XCIsXG4gICAgICAgIHNlc3Npb25JZDogXCJlMmUtYXVkaXQtc2Vzc2lvblwiLFxuICAgICAgICBvcGVyYXRpb25JZDogZXhlY3V0aW9uRml4dHVyZS5vcGVyYXRpb25JZCxcbiAgICAgICAgc3RhdHVzOiBcImNhbmNlbGxlZFwiLFxuICAgICAgICB0ZXJtaW5hbFN0YXRlOiBcImNhbmNlbGxlZFwiLFxuICAgICAgICByZXZpc2lvbjogXCJlMmUtcmV2aXNpb24tNDJcIixcbiAgICAgICAgcHJvb2Y6IHsgcmVxdWlyZWQ6IGZhbHNlLCB2ZXJkaWN0OiBcIk5PVF9SRUNPUkRFRFwiIH0sXG4gICAgICB9LFxuICAgICAgdGltZWxpbmU6IFtcbiAgICAgICAgeyB0eXBlOiBcImNhbmNlbGxlZFwiLCBkZXRhaWw6IFwiQ2FuY2VsbGF0aW9uIGFjY2VwdGVkIGJ5IHRoZSBzZXJ2ZXIuXCIgfSxcbiAgICAgIF0sXG4gICAgICB2YWxpZGF0aW9uczogW10sXG4gICAgICBhZmZlY3RlZEZpbGVzOiBbXSxcbiAgICAgIHJlZGFjdGlvbjoge1xuICAgICAgICBleGNsdWRlZDogW1xuICAgICAgICAgIFwicHJvdmlkZXIgc2VjcmV0c1wiLFxuICAgICAgICAgIFwicmF3IG1vZGVsIG91dHB1dFwiLFxuICAgICAgICAgIFwicHJpdmF0ZSBydW50aW1lIHBhdGhzXCIsXG4gICAgICAgIF0sXG4gICAgICB9LFxuICAgIH07XG4gICAgYXdhaXQgaW5zdGFsbEFwaUZpeHR1cmVzKHBhZ2UsIHtcbiAgICAgIGF1ZGl0RXhwb3J0OiB7XG4gICAgICAgIGJvZHk6IGF1ZGl0Qm9keSxcbiAgICAgICAgZmlsZW5hbWU6IFwiY2FuY2VsbGVkLXNlcnZlci1hdWRpdC5qc29uXCIsXG4gICAgICAgIHJlcXVlc3RzOiBhdWRpdFJlcXVlc3RzLFxuICAgICAgICBleGVjdXRpb246IGNhbmNlbGxlZEV4ZWN1dGlvbixcbiAgICAgICAgbWVzc2FnZU91dGNvbWU6IFwiQ0FOQ0VMTEVEXCIsXG4gICAgICAgIGZhaWxGaXJzdFByZXZpZXc6IHRydWUsXG4gICAgICB9LFxuICAgIH0pO1xuICAgIGF3YWl0IHByb2dyYW1tYXRpY1NpZ25JbihwYWdlKTtcbiAgICBhd2FpdCBwYWdlLmV2YWx1YXRlKCgpID0+IHtcbiAgICAgIGNvbnN0IGV4ZWN1dGlvbiA9IHtcbiAgICAgICAgaWQ6IFwiZTJlLWNvbnRyb2xsZWQtZXhlY3V0aW9uXCIsXG4gICAgICAgIHByb2plY3RJZDogXCJlMmUtcHJvamVjdFwiLFxuICAgICAgICBzZXNzaW9uSWQ6IFwiZTJlLWF1ZGl0LXNlc3Npb25cIixcbiAgICAgICAgbWVzc2FnZTogXCJDYW5jZWxsZWQgYXVkaXQgZXhlY3V0aW9uXCIsXG4gICAgICB9O1xuICAgICAgbG9jYWxTdG9yYWdlLnNldEl0ZW0oXG4gICAgICAgIFwiZW9zX2FpX2V4ZWN1dGlvbl9jdXJyZW50X2UyZS1wcm9qZWN0XCIsXG4gICAgICAgIFwiZTJlLWF1ZGl0LXNlc3Npb25cIixcbiAgICAgICk7XG4gICAgICBsb2NhbFN0b3JhZ2Uuc2V0SXRlbShcbiAgICAgICAgXCJlb3NfYWlfZXhlY3V0aW9uX2UyZS1wcm9qZWN0X2UyZS1hdWRpdC1zZXNzaW9uXCIsXG4gICAgICAgIEpTT04uc3RyaW5naWZ5KGV4ZWN1dGlvbiksXG4gICAgICApO1xuICAgIH0pO1xuICAgIGF3YWl0IHBhZ2UuZ290byhgJHtEQVNIQk9BUkRfUEFUSH1haWApO1xuXG4gICAgY29uc3QgcHJvb2YgPSBwYWdlLmdldEJ5TGFiZWwoXCJBZ2VudCBleGVjdXRpb24gcHJvb2ZcIik7XG4gICAgYXdhaXQgZXhwZWN0KHByb29mKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChwcm9vZikudG9Db250YWluVGV4dChcIkNhbmNlbGxlZFwiKTtcbiAgICBhd2FpdCBleHBlY3QocHJvb2YpLnRvQ29udGFpblRleHQoXCJFeGVjdXRpb24gZTJlLWNvbnRyb2xsZWQtZXhlY3V0aW9uXCIpO1xuICAgIGF3YWl0IGV4cGVjdChwcm9vZikudG9Db250YWluVGV4dChcIlJldmlzaW9uOiBlMmUtcmV2aXNpb24tNDJcIik7XG4gICAgYXdhaXQgZXhwZWN0KHByb29mKS50b0NvbnRhaW5UZXh0KFwiVGVybWluYWwgcmVhc29uOiBjYW5jZWxfcmVxdWVzdGVkXCIpO1xuICAgIGF3YWl0IGV4cGVjdChwcm9vZi5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIkNhbmNlbFwiIH0pKS50b0hhdmVDb3VudCgwKTtcbiAgICBhd2FpdCBleHBlY3QocHJvb2YuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJSZXN1bWVcIiB9KSkudG9IYXZlQ291bnQoMCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcHJvb2YuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJBcHByb3ZlICYgYXBwbHlcIiB9KSxcbiAgICApLnRvSGF2ZUNvdW50KDApO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHByb29mLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IC9jb21taXQgdmVyaWZpZWQgY2hhbmdlcy9pIH0pLFxuICAgICkudG9IYXZlQ291bnQoMCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcHJvb2YuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogL3B1c2ggY29tbWl0dGVkIGNoYW5nZXMvaSB9KSxcbiAgICApLnRvSGF2ZUNvdW50KDApO1xuXG4gICAgYXdhaXQgcHJvb2YuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJQcmV2aWV3IGF1ZGl0XCIgfSkuY2xpY2soKTtcbiAgICBjb25zdCBwcmV2aWV3ID0gcGFnZS5nZXRCeUxhYmVsKFwiUmVkYWN0ZWQgYXVkaXQgcHJldmlld1wiKTtcbiAgICBhd2FpdCBleHBlY3QocHJldmlldykudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QocHJldmlldykudG9Db250YWluVGV4dChcIkF1ZGl0IHByZXZpZXcgdGVtcG9yYXJpbHkgdW5hdmFpbGFibGVcIik7XG4gICAgYXdhaXQgZXhwZWN0KHByZXZpZXcpLnRvQ29udGFpblRleHQoXCJzYW1lIGV4ZWN1dGlvbiBhbmQgcmV2aXNpb25cIik7XG4gICAgYXdhaXQgZXhwZWN0KHByZXZpZXcuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJSZXRyeSBwcmV2aWV3XCIgfSkpLnRvQmVWaXNpYmxlKCk7XG4gICAgZXhwZWN0KGF1ZGl0UmVxdWVzdHMpLnRvSGF2ZUxlbmd0aCgxKTtcblxuICAgIGF3YWl0IHByZXZpZXcuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJSZXRyeSBwcmV2aWV3XCIgfSkuY2xpY2soKTtcbiAgICBhd2FpdCBleHBlY3QocHJldmlldykudG9Db250YWluVGV4dChcImNhbmNlbGxlZFwiKTtcbiAgICBhd2FpdCBleHBlY3QocHJldmlldykudG9Db250YWluVGV4dChFWEVDVVRJT05fSUQpO1xuICAgIGF3YWl0IGV4cGVjdChwcmV2aWV3KS50b0NvbnRhaW5UZXh0KFwiZTJlLW9wZXJhdGlvblwiKTtcbiAgICBhd2FpdCBleHBlY3QocHJldmlldykudG9Db250YWluVGV4dChcImUyZS1yZXZpc2lvbi00MlwiKTtcbiAgICBhd2FpdCBleHBlY3QocHJldmlldykudG9Db250YWluVGV4dChcInByb3ZpZGVyIHNlY3JldHNcIik7XG4gICAgYXdhaXQgZXhwZWN0KHByZXZpZXcpLnRvQ29udGFpblRleHQoXCJyYXcgbW9kZWwgb3V0cHV0XCIpO1xuICAgIGF3YWl0IGV4cGVjdChwcmV2aWV3KS50b0NvbnRhaW5UZXh0KFwicHJpdmF0ZSBydW50aW1lIHBhdGhzXCIpO1xuICAgIGF3YWl0IGV4cGVjdChwcm9vZikudG9Db250YWluVGV4dChcIkNhbmNlbGxlZFwiKTtcbiAgICBhd2FpdCBleHBlY3QocHJvb2YpLnRvQ29udGFpblRleHQoXCJSZXZpc2lvbjogZTJlLXJldmlzaW9uLTQyXCIpO1xuICAgIGF3YWl0IGV4cGVjdChwcm9vZikudG9Db250YWluVGV4dChcIlRlcm1pbmFsIHJlYXNvbjogY2FuY2VsX3JlcXVlc3RlZFwiKTtcbiAgICBleHBlY3QoYXVkaXRSZXF1ZXN0cykudG9IYXZlTGVuZ3RoKDIpO1xuXG4gICAgYXdhaXQgcHJldmlldy5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIkNsb3NlIGF1ZGl0IHByZXZpZXdcIiB9KS5jbGljaygpO1xuICAgIGNvbnN0IGRvd25sb2FkUHJvbWlzZSA9IHBhZ2Uud2FpdEZvckV2ZW50KFwiZG93bmxvYWRcIik7XG4gICAgYXdhaXQgcHJvb2YuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJFeHBvcnQgYXVkaXRcIiB9KS5jbGljaygpO1xuICAgIGNvbnN0IGRvd25sb2FkID0gYXdhaXQgZG93bmxvYWRQcm9taXNlO1xuICAgIGV4cGVjdChkb3dubG9hZC5zdWdnZXN0ZWRGaWxlbmFtZSgpKS50b0JlKFwiY2FuY2VsbGVkLXNlcnZlci1hdWRpdC5qc29uXCIpO1xuICAgIGV4cGVjdChhdWRpdFJlcXVlc3RzKS50b0hhdmVMZW5ndGgoMyk7XG5cbiAgICBhd2FpdCBwYWdlLnJlbG9hZCgpO1xuICAgIGNvbnN0IHJlbG9hZGVkUHJvb2YgPSBwYWdlLmdldEJ5TGFiZWwoXCJBZ2VudCBleGVjdXRpb24gcHJvb2ZcIik7XG4gICAgYXdhaXQgZXhwZWN0KHJlbG9hZGVkUHJvb2YpLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KHJlbG9hZGVkUHJvb2YpLnRvQ29udGFpblRleHQoXCJDYW5jZWxsZWRcIik7XG4gICAgYXdhaXQgZXhwZWN0KHJlbG9hZGVkUHJvb2YpLnRvQ29udGFpblRleHQoXCJSZXZpc2lvbjogZTJlLXJldmlzaW9uLTQyXCIpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlLmdldEJ5TGFiZWwoXCJSZWRhY3RlZCBhdWRpdCBwcmV2aWV3XCIpKS50b0JlSGlkZGVuKCk7XG4gICAgZXhwZWN0KGF1ZGl0UmVxdWVzdHMpLnRvSGF2ZUxlbmd0aCgzKTtcbiAgfSk7XG5cbiAgdGVzdChcInVwbG9hZHMgYW4gYXJjaGl2ZSBhbmQgcmVuZGVycyBhIGxpdmUgdGFzayB1cGRhdGVcIiwgYXN5bmMgKHtcbiAgICBwYWdlLFxuICB9KSA9PiB7XG4gICAgY29uc3QgdGFza0lkID0gXCJlMmUtbGl2ZS10YXNrXCI7XG4gICAgY29uc3QgbGl2ZUxvZyA9IHtcbiAgICAgIGlkOiBcImUyZS1saXZlLWxvZ1wiLFxuICAgICAgdGFza0lkLFxuICAgICAgbGV2ZWw6IFwiaW5mb1wiLFxuICAgICAgbWVzc2FnZTogXCJMaXZlIHVwZGF0ZSByZWNlaXZlZCBmcm9tIHRoZSBzZXJ2ZXJcIixcbiAgICAgIHRpbWVzdGFtcDogXCIyMDI2LTAxLTAxVDAwOjAwOjAyLjAwMFpcIixcbiAgICB9O1xuICAgIGF3YWl0IGluc3RhbGxBcGlGaXh0dXJlcyhwYWdlLCB7XG4gICAgICBhcmNoaXZlVXBsb2FkOiB7XG4gICAgICAgIHVwbG9hZElkOiBcImUyZS11cGxvYWRcIixcbiAgICAgICAgb3JpZ2luYWxOYW1lOiBcImRhc2hib2FyZC1qb3VybmV5LnppcFwiLFxuICAgICAgfSxcbiAgICAgIGxpdmVUYXNrOiB7XG4gICAgICAgIGlkOiB0YXNrSWQsXG4gICAgICAgIHRpdGxlOiBcIlZlcmlmeSBsaXZlIGRhc2hib2FyZCB1cGRhdGVzXCIsXG4gICAgICAgIHByb2plY3RJZDogXCJlMmUtcHJvamVjdFwiLFxuICAgICAgICBsb2c6IGxpdmVMb2csXG4gICAgICB9LFxuICAgIH0pO1xuICAgIGF3YWl0IHByb2dyYW1tYXRpY1NpZ25JbihwYWdlKTtcblxuICAgIC8vIFRoaXMgaXMgYSB2YWxpZCwgZW1wdHkgWklQIGFyY2hpdmUuIEtlZXBpbmcgaXQgaW5saW5lIG1ha2VzIHRoZSBicm93c2VyXG4gICAgLy8gdGVzdCBzZWxmLWNvbnRhaW5lZCB3aGlsZSBzdGlsbCBleGVyY2lzaW5nIEZvcm1EYXRhIGFuZCBtdWx0aXBhcnQgYnl0ZXMuXG4gICAgY29uc3QgdXBsb2FkUmVzdWx0ID0gYXdhaXQgcGFnZS5ldmFsdWF0ZShhc3luYyAoYXBpQmFzZVVybCkgPT4ge1xuICAgICAgY29uc3QgYnl0ZXMgPSBVaW50OEFycmF5LmZyb20oXG4gICAgICAgIGF0b2IoXCJVRXNGQmdBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUE9PVwiKSxcbiAgICAgICAgKGNoYXJhY3RlcikgPT4gY2hhcmFjdGVyLmNoYXJDb2RlQXQoMCksXG4gICAgICApO1xuICAgICAgY29uc3QgYm9keSA9IG5ldyBGb3JtRGF0YSgpO1xuICAgICAgYm9keS5hcHBlbmQoXG4gICAgICAgIFwiYXJjaGl2ZVwiLFxuICAgICAgICBuZXcgQmxvYihbYnl0ZXNdLCB7IHR5cGU6IFwiYXBwbGljYXRpb24vemlwXCIgfSksXG4gICAgICAgIFwiZGFzaGJvYXJkLWpvdXJuZXkuemlwXCIsXG4gICAgICApO1xuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBmZXRjaChcbiAgICAgICAgbmV3IFVSTChcIi9hcGkvdXBsb2FkL2FyY2hpdmVcIiwgYXBpQmFzZVVybCkudG9TdHJpbmcoKSxcbiAgICAgICAgeyBtZXRob2Q6IFwiUE9TVFwiLCBjcmVkZW50aWFsczogXCJpbmNsdWRlXCIsIGJvZHkgfSxcbiAgICAgICk7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBzdGF0dXM6IHJlc3BvbnNlLnN0YXR1cyxcbiAgICAgICAgYm9keTogKGF3YWl0IHJlc3BvbnNlLmpzb24oKSkgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4sXG4gICAgICB9O1xuICAgIH0sIHByb2Nlc3MuZW52LkRBU0hCT0FSRF9FMkVfQVBJX0JBU0VfVVJMID8/IHBhZ2UudXJsKCkpO1xuICAgIGV4cGVjdCh1cGxvYWRSZXN1bHQuc3RhdHVzKS50b0JlKDIwMSk7XG4gICAgZXhwZWN0KHVwbG9hZFJlc3VsdC5ib2R5KS50b0VxdWFsKHtcbiAgICAgIHVwbG9hZElkOiBcImUyZS11cGxvYWRcIixcbiAgICAgIG9yaWdpbmFsTmFtZTogXCJkYXNoYm9hcmQtam91cm5leS56aXBcIixcbiAgICB9KTtcblxuICAgIGF3YWl0IG9wZW5OYXZpZ2F0aW9uKHBhZ2UsIFwiVGFza3NcIiwgYCR7REFTSEJPQVJEX1BBVEh9dGFza3NgKTtcbiAgICBjb25zdCB0YXNrUm93ID0gcGFnZS5nZXRCeUxhYmVsKFxuICAgICAgXCJFeHBhbmQgdGFzayBWZXJpZnkgbGl2ZSBkYXNoYm9hcmQgdXBkYXRlc1wiLFxuICAgICk7XG4gICAgYXdhaXQgZXhwZWN0KHRhc2tSb3cpLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgdGFza1Jvdy5jbGljaygpO1xuICAgIGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJMb2dzXCIgfSkuY2xpY2soKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5nZXRCeVJvbGUoXCJyZWdpb25cIiwgeyBuYW1lOiBcIkFjdGl2aXR5XCIgfSkpLnRvQ29udGFpblRleHQoXG4gICAgICBcIkxpdmUgdXBkYXRlIHJlY2VpdmVkIGZyb20gdGhlIHNlcnZlclwiLFxuICAgICk7XG4gIH0pO1xuXG4gIHRlc3QoXCJyZWNvdmVycyBhIGxpdmUgdGFzayB1cGRhdGUgYWZ0ZXIgYSB0ZW1wb3Jhcnkgc3RyZWFtIGZhaWx1cmVcIiwgYXN5bmMgKHtcbiAgICBwYWdlLFxuICB9KSA9PiB7XG4gICAgY29uc3QgdGFza0lkID0gXCJlMmUtcmVjb25uZWN0aW5nLWxpdmUtdGFza1wiO1xuICAgIGNvbnN0IGxpdmVMb2cgPSB7XG4gICAgICBpZDogXCJlMmUtcmVjb25uZWN0aW5nLWxpdmUtbG9nXCIsXG4gICAgICB0YXNrSWQsXG4gICAgICBsZXZlbDogXCJpbmZvXCIsXG4gICAgICBtZXNzYWdlOiBcIkF1dGhvcml0YXRpdmUgdXBkYXRlIHJlY2VpdmVkIGFmdGVyIHJlY29ubmVjdFwiLFxuICAgICAgdGltZXN0YW1wOiBcIjIwMjYtMDEtMDFUMDA6MDA6MDIuMDAwWlwiLFxuICAgICAgbWV0YWRhdGE6IHtcbiAgICAgICAgb3BlcmF0aW9uSWQ6IFwiZTJlLXJlY29ubmVjdGluZy1vcGVyYXRpb25cIixcbiAgICAgICAgY2hlY2twb2ludFZlcnNpb246IDMsXG4gICAgICB9LFxuICAgIH07XG4gICAgY29uc3Qgc3RyZWFtUmVxdWVzdHM6IHN0cmluZ1tdID0gW107XG4gICAgYXdhaXQgaW5zdGFsbEFwaUZpeHR1cmVzKHBhZ2UsIHtcbiAgICAgIGxpdmVUYXNrOiB7XG4gICAgICAgIGlkOiB0YXNrSWQsXG4gICAgICAgIHRpdGxlOiBcIlJlY292ZXIgbGl2ZSB0YXNrIHVwZGF0ZXNcIixcbiAgICAgICAgcHJvamVjdElkOiBcImUyZS1wcm9qZWN0XCIsXG4gICAgICAgIGxvZzogbGl2ZUxvZyxcbiAgICAgICAgc3RyZWFtUmVxdWVzdHMsXG4gICAgICAgIGZhaWxGaXJzdFN0cmVhbTogdHJ1ZSxcbiAgICAgIH0sXG4gICAgfSk7XG4gICAgYXdhaXQgcHJvZ3JhbW1hdGljU2lnbkluKHBhZ2UpO1xuXG4gICAgYXdhaXQgb3Blbk5hdmlnYXRpb24ocGFnZSwgXCJUYXNrc1wiLCBgJHtEQVNIQk9BUkRfUEFUSH10YXNrc2ApO1xuICAgIGNvbnN0IHRhc2tSb3cgPSBwYWdlLmdldEJ5TGFiZWwoXCJFeHBhbmQgdGFzayBSZWNvdmVyIGxpdmUgdGFzayB1cGRhdGVzXCIpO1xuICAgIGF3YWl0IGV4cGVjdCh0YXNrUm93KS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IHRhc2tSb3cuY2xpY2soKTtcbiAgICBhd2FpdCBwYWdlLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiTG9nc1wiIH0pLmNsaWNrKCk7XG5cbiAgICBjb25zdCBhY3Rpdml0eSA9IHBhZ2UuZ2V0QnlSb2xlKFwicmVnaW9uXCIsIHsgbmFtZTogXCJBY3Rpdml0eVwiIH0pO1xuICAgIGF3YWl0IGV4cGVjdChhY3Rpdml0eSkudG9Db250YWluVGV4dChsaXZlTG9nLm1lc3NhZ2UpO1xuICAgIGF3YWl0IGV4cGVjdFxuICAgICAgLnBvbGwoKCkgPT4gc3RyZWFtUmVxdWVzdHMubGVuZ3RoLCB7XG4gICAgICAgIG1lc3NhZ2U6IFwidGhlIHRhc2sgbG9nIHN0cmVhbSBzaG91bGQgcmVjb25uZWN0IGV4YWN0bHkgb25jZVwiLFxuICAgICAgfSlcbiAgICAgIC50b0JlKDIpO1xuICAgIGV4cGVjdChzdHJlYW1SZXF1ZXN0cykudG9IYXZlTGVuZ3RoKDIpO1xuICAgIGV4cGVjdChzdHJlYW1SZXF1ZXN0c1swXSkudG9CZShzdHJlYW1SZXF1ZXN0c1sxXSk7XG4gICAgZXhwZWN0KG5ldyBVUkwoc3RyZWFtUmVxdWVzdHNbMV0pLnBhdGhuYW1lKS50b0JlKFxuICAgICAgYC9hcGkvdGFza3MvJHt0YXNrSWR9L2xvZ3Mvc3RyZWFtYCxcbiAgICApO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIGFjdGl2aXR5LmxvY2F0b3IoXCJzdW1tYXJ5XCIpLmZpbHRlcih7IGhhc1RleHQ6IGxpdmVMb2cubWVzc2FnZSB9KSxcbiAgICApLnRvSGF2ZUNvdW50KDEpO1xuICB9KTtcblxuICB0ZXN0KFwic2hvd3MgYW4gYWN0aW9uYWJsZSB0ZXJtaW5hbCBzdGF0ZSB3aGVuIGxpdmUgdGFzayByZWNvbm5lY3RzIGFyZSBleGhhdXN0ZWRcIiwgYXN5bmMgKHtcbiAgICBwYWdlLFxuICB9KSA9PiB7XG4gICAgY29uc3QgdGFza0lkID0gXCJlMmUtZXhoYXVzdGVkLWxpdmUtdGFza1wiO1xuICAgIGNvbnN0IG9wZXJhdGlvbklkID0gXCJlMmUtZXhoYXVzdGVkLW9wZXJhdGlvblwiO1xuICAgIGNvbnN0IGxpdmVMb2cgPSB7XG4gICAgICBpZDogXCJlMmUtZXhoYXVzdGVkLWxpdmUtbG9nXCIsXG4gICAgICB0YXNrSWQsXG4gICAgICBsZXZlbDogXCJpbmZvXCIsXG4gICAgICBtZXNzYWdlOiBcIlRoZSBvbmx5IGNvbmZpcm1lZCB0YXNrIHVwZGF0ZVwiLFxuICAgICAgdGltZXN0YW1wOiBcIjIwMjYtMDEtMDFUMDA6MDA6MDIuMDAwWlwiLFxuICAgICAgbWV0YWRhdGE6IHsgb3BlcmF0aW9uSWQgfSxcbiAgICB9O1xuICAgIGNvbnN0IHN0cmVhbVJlcXVlc3RzOiBzdHJpbmdbXSA9IFtdO1xuICAgIGNvbnN0IG5vblN0cmVhbVJlcXVlc3RzOiBzdHJpbmdbXSA9IFtdO1xuICAgIHBhZ2Uub24oXCJyZXF1ZXN0XCIsIChyZXF1ZXN0KSA9PiB7XG4gICAgICBpZiAoIXJlcXVlc3QudXJsKCkuaW5jbHVkZXMoXCIvYXBpL3Rhc2tzL1wiKSkgcmV0dXJuO1xuICAgICAgaWYgKCFyZXF1ZXN0LnVybCgpLmluY2x1ZGVzKFwiL2xvZ3Mvc3RyZWFtXCIpKSBub25TdHJlYW1SZXF1ZXN0cy5wdXNoKHJlcXVlc3QubWV0aG9kKCkpO1xuICAgIH0pO1xuICAgIGF3YWl0IGluc3RhbGxBcGlGaXh0dXJlcyhwYWdlLCB7XG4gICAgICBsaXZlVGFzazoge1xuICAgICAgICBpZDogdGFza0lkLFxuICAgICAgICB0aXRsZTogXCJSZWNvdmVyIGV4aGF1c3RlZCBsaXZlIHRhc2sgdXBkYXRlc1wiLFxuICAgICAgICBwcm9qZWN0SWQ6IFwiZTJlLXByb2plY3RcIixcbiAgICAgICAgbG9nOiBsaXZlTG9nLFxuICAgICAgICBpbml0aWFsTG9nczogW2xpdmVMb2ddLFxuICAgICAgICBzdHJlYW1SZXF1ZXN0cyxcbiAgICAgICAgZmFpbFN0cmVhbUF0dGVtcHRzOiA2LFxuICAgICAgfSxcbiAgICB9KTtcbiAgICBhd2FpdCBwcm9ncmFtbWF0aWNTaWduSW4ocGFnZSk7XG5cbiAgICBhd2FpdCBvcGVuTmF2aWdhdGlvbihwYWdlLCBcIlRhc2tzXCIsIGAke0RBU0hCT0FSRF9QQVRIfXRhc2tzYCk7XG4gICAgYXdhaXQgcGFnZS5nZXRCeUxhYmVsKFwiRXhwYW5kIHRhc2sgUmVjb3ZlciBleGhhdXN0ZWQgbGl2ZSB0YXNrIHVwZGF0ZXNcIikuY2xpY2soKTtcbiAgICBhd2FpdCBwYWdlLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiTG9nc1wiIH0pLmNsaWNrKCk7XG5cbiAgICBjb25zdCBhY3Rpdml0eSA9IHBhZ2UuZ2V0QnlSb2xlKFwicmVnaW9uXCIsIHsgbmFtZTogXCJBY3Rpdml0eVwiIH0pO1xuICAgIGF3YWl0IGV4cGVjdChhY3Rpdml0eSkudG9Db250YWluVGV4dChsaXZlTG9nLm1lc3NhZ2UpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlLmdldEJ5VGV4dChcIlRlbXBvcmFyeSBzdHJlYW0gZmFpbHVyZS5cIiwgeyBleGFjdDogZmFsc2UgfSkpLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0XG4gICAgICAucG9sbCgoKSA9PiBzdHJlYW1SZXF1ZXN0cy5sZW5ndGgsIHtcbiAgICAgICAgbWVzc2FnZTogXCJ0aGUgdGFzayBsb2cgc3RyZWFtIHNob3VsZCBleGhhdXN0IGl0cyBib3VuZGVkIHJlY29ubmVjdCBidWRnZXRcIixcbiAgICAgICAgdGltZW91dDogMzVfMDAwLFxuICAgICAgfSlcbiAgICAgIC50b0JlKDYpO1xuICAgIGNvbnN0IGV4aGF1c3RlZCA9IHBhZ2UuZ2V0QnlSb2xlKFwiYWxlcnRcIik7XG4gICAgYXdhaXQgZXhwZWN0KGV4aGF1c3RlZCkudG9Db250YWluVGV4dChcIkxpdmUgdGFzayB1cGRhdGVzIGNvdWxkIG5vdCByZWNvbm5lY3RcIik7XG4gICAgYXdhaXQgZXhwZWN0KGV4aGF1c3RlZCkudG9Db250YWluVGV4dChcIlJlY29ubmVjdCBhdHRlbXB0cyBhcmUgZXhoYXVzdGVkXCIpO1xuICAgIGF3YWl0IGV4cGVjdChleGhhdXN0ZWQpLnRvQ29udGFpblRleHQob3BlcmF0aW9uSWQpO1xuICAgIGF3YWl0IGV4cGVjdChleGhhdXN0ZWQpLnRvQ29udGFpblRleHQoXCJ0YXNrIGhhcyBub3QgYmVlbiBtYXJrZWQgZmFpbGVkXCIpO1xuICAgIGF3YWl0IGV4cGVjdChleGhhdXN0ZWQuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJSZXRyeSBsaXZlIHVwZGF0ZXNcIiB9KSkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoZXhoYXVzdGVkLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiUmVmcmVzaCB0YXNrIGxvZ3NcIiB9KSkudG9CZVZpc2libGUoKTtcblxuICAgIGF3YWl0IGV4aGF1c3RlZC5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIlJldHJ5IGxpdmUgdXBkYXRlc1wiIH0pLmNsaWNrKCk7XG4gICAgYXdhaXQgZXhwZWN0KGFjdGl2aXR5KS50b0NvbnRhaW5UZXh0KFwiVGhlIG9ubHkgY29uZmlybWVkIHRhc2sgdXBkYXRlXCIpO1xuICAgIGF3YWl0IGV4cGVjdC5wb2xsKCgpID0+IHN0cmVhbVJlcXVlc3RzLmxlbmd0aCkudG9CZSg3KTtcbiAgICBleHBlY3QobmV3IFNldChzdHJlYW1SZXF1ZXN0cykuc2l6ZSkudG9CZSgxKTtcbiAgICBleHBlY3Qobm9uU3RyZWFtUmVxdWVzdHMpLm5vdC50b0NvbnRhaW4oXCJQT1NUXCIpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIGFjdGl2aXR5LmxvY2F0b3IoXCJzdW1tYXJ5XCIpLmZpbHRlcih7IGhhc1RleHQ6IGxpdmVMb2cubWVzc2FnZSB9KSxcbiAgICApLnRvSGF2ZUNvdW50KDEpO1xuICB9KTtcblxuICB0ZXN0KFwicGFnZXMgYW5kIHJlbG9hZHMgdGhlIGZpbHRlcmVkIGV2ZW50IHN0cmVhbSB3aXRob3V0IGxvc2luZyBpdHMgd2luZG93XCIsIGFzeW5jICh7XG4gICAgcGFnZSxcbiAgfSkgPT4ge1xuICAgIGNvbnN0IGV2ZW50cyA9IEFycmF5LmZyb20oeyBsZW5ndGg6IDUxIH0sIChfLCBpbmRleCkgPT4gKHtcbiAgICAgIGlkOiBgZTJlLWV2ZW50LSR7aW5kZXh9YCxcbiAgICAgIHByb2plY3RJZDogXCJlMmUtcHJvamVjdFwiLFxuICAgICAgdHlwZTogXCJBdWRpdEV2ZW50XCIsXG4gICAgICBzZXZlcml0eTogaW5kZXggPCAyID8gXCJzdWNjZXNzXCIgOiBcImluZm9cIixcbiAgICAgIGNvcnJlbGF0aW9uSWQ6IGluZGV4IDwgMiA/IFwicmVsZWFzZS00MlwiIDogbnVsbCxcbiAgICAgIG1lc3NhZ2U6XG4gICAgICAgIGluZGV4IDwgMiA/IGBGaWx0ZXJlZCByZWxlYXNlIGV2ZW50ICR7aW5kZXh9YCA6IGBPbGRlciBldmVudCAke2luZGV4fWAsXG4gICAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKERhdGUuVVRDKDIwMjYsIDAsIDEsIDAsIDAsIDUxIC0gaW5kZXgpKS50b0lTT1N0cmluZygpLFxuICAgIH0pKTtcbiAgICBjb25zdCBldmVudFJlcXVlc3RzOiBzdHJpbmdbXSA9IFtdO1xuICAgIHBhZ2Uub24oXCJyZXF1ZXN0XCIsIChyZXF1ZXN0KSA9PiB7XG4gICAgICBpZiAobmV3IFVSTChyZXF1ZXN0LnVybCgpKS5wYXRobmFtZS5lbmRzV2l0aChcIi9hcGkvZXZlbnRzXCIpKVxuICAgICAgICBldmVudFJlcXVlc3RzLnB1c2gocmVxdWVzdC51cmwoKSk7XG4gICAgfSk7XG4gICAgYXdhaXQgaW5zdGFsbEFwaUZpeHR1cmVzKHBhZ2UsIHtcbiAgICAgIGV2ZW50cyxcbiAgICAgIHByb2plY3RzOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBpZDogXCJlMmUtcHJvamVjdFwiLFxuICAgICAgICAgIG5hbWU6IFwiU21va2UgUHJvamVjdFwiLFxuICAgICAgICAgIGxhbmd1YWdlOiBcIlR5cGVTY3JpcHRcIixcbiAgICAgICAgICBmcmFtZXdvcms6IFwiUmVhY3RcIixcbiAgICAgICAgICBzdGF0dXM6IFwiYWN0aXZlXCIsXG4gICAgICAgICAgcm9vdFBhdGg6IFwiL2NvbnRyb2xsZWQvc21va2VcIixcbiAgICAgICAgICBxdWFsaXR5U2NvcmU6IDkyLFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICB9KTtcbiAgICBhd2FpdCBwcm9ncmFtbWF0aWNTaWduSW4ocGFnZSk7XG4gICAgYXdhaXQgcGFnZS5nb3RvKGAke0RBU0hCT0FSRF9QQVRIfWV2ZW50c2ApO1xuXG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXCJPbGRlciBldmVudCA0OVwiLCB7IGV4YWN0OiB0cnVlIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcIk9sZGVyIGV2ZW50IDUwXCIsIHsgZXhhY3Q6IHRydWUgfSksXG4gICAgKS5ub3QudG9CZVZpc2libGUoKTtcbiAgICBjb25zdCBmaXJzdFJlcXVlc3QgPSBuZXcgVVJMKGV2ZW50UmVxdWVzdHMuYXQoLTEpISk7XG4gICAgZXhwZWN0KGZpcnN0UmVxdWVzdC5zZWFyY2hQYXJhbXMuZ2V0KFwibGltaXRcIikpLnRvQmUoXCI1MFwiKTtcbiAgICBleHBlY3QoZmlyc3RSZXF1ZXN0LnNlYXJjaFBhcmFtcy5nZXQoXCJwYWdlXCIpKS50b0JlKFwiMVwiKTtcblxuICAgIGF3YWl0IFByb21pc2UuYWxsKFtcbiAgICAgIHBhZ2Uud2FpdEZvclJlcXVlc3QoKHJlcXVlc3QpID0+IHtcbiAgICAgICAgY29uc3QgdXJsID0gbmV3IFVSTChyZXF1ZXN0LnVybCgpKTtcbiAgICAgICAgcmV0dXJuIChcbiAgICAgICAgICB1cmwucGF0aG5hbWUuZW5kc1dpdGgoXCIvYXBpL2V2ZW50c1wiKSAmJlxuICAgICAgICAgIHVybC5zZWFyY2hQYXJhbXMuZ2V0KFwicGFnZVwiKSA9PT0gXCIyXCJcbiAgICAgICAgKTtcbiAgICAgIH0pLFxuICAgICAgcGFnZS5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIk9sZGVyXCIgfSkuY2xpY2soKSxcbiAgICBdKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5nZXRCeVRleHQoXCJQYWdlIDIuXCIsIHsgZXhhY3Q6IGZhbHNlIH0pKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiT2xkZXIgZXZlbnQgNTBcIiwgeyBleGFjdDogdHJ1ZSB9KSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXCJGaWx0ZXJlZCByZWxlYXNlIGV2ZW50IDBcIiwgeyBleGFjdDogdHJ1ZSB9KSxcbiAgICApLm5vdC50b0JlVmlzaWJsZSgpO1xuICAgIGV4cGVjdChuZXcgVVJMKGV2ZW50UmVxdWVzdHMuYXQoLTEpISkuc2VhcmNoUGFyYW1zLmdldChcInBhZ2VcIikpLnRvQmUoXCIyXCIpO1xuICAgIGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJOZXdlclwiIH0pLmNsaWNrKCk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlUZXh0KFwiUGFnZSAxLlwiLCB7IGV4YWN0OiBmYWxzZSB9KSkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcIkZpbHRlcmVkIHJlbGVhc2UgZXZlbnQgMFwiLCB7IGV4YWN0OiB0cnVlIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcblxuICAgIGF3YWl0IHBhZ2UuZ2V0QnlQbGFjZWhvbGRlcihcIlNlYXJjaCBsb2dzLi4uXCIpLmZpbGwoXCJGaWx0ZXJlZCByZWxlYXNlXCIpO1xuICAgIGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJUb2dnbGUgZXZlbnQgZmlsdGVyc1wiIH0pLmNsaWNrKCk7XG4gICAgYXdhaXQgcGFnZS5sb2NhdG9yKFwic2VsZWN0XCIpLm50aCgxKS5zZWxlY3RPcHRpb24oXCJzdWNjZXNzXCIpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiRmlsdGVyZWQgcmVsZWFzZSBldmVudCAwXCIsIHsgZXhhY3Q6IHRydWUgfSksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiT2xkZXIgZXZlbnQgMVwiLCB7IGV4YWN0OiB0cnVlIH0pLFxuICAgICkubm90LnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UpLnRvSGF2ZVVSTCgvc2VhcmNoPUZpbHRlcmVkXFwrcmVsZWFzZS8pO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlKS50b0hhdmVVUkwoL3NldmVyaXR5PXN1Y2Nlc3MvKTtcblxuICAgIGF3YWl0IHBhZ2UucmVsb2FkKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXCJGaWx0ZXJlZCByZWxlYXNlIGV2ZW50IDBcIiwgeyBleGFjdDogdHJ1ZSB9KSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXCJPbGRlciBldmVudCAxXCIsIHsgZXhhY3Q6IHRydWUgfSksXG4gICAgKS5ub3QudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5nZXRCeVBsYWNlaG9sZGVyKFwiU2VhcmNoIGxvZ3MuLi5cIikpLnRvSGF2ZVZhbHVlKFxuICAgICAgXCJGaWx0ZXJlZCByZWxlYXNlXCIsXG4gICAgKTtcbiAgICBhd2FpdCBwYWdlLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiVG9nZ2xlIGV2ZW50IGZpbHRlcnNcIiB9KS5jbGljaygpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoXCJzZWxlY3RcIikubnRoKDEpKS50b0hhdmVWYWx1ZShcInN1Y2Nlc3NcIik7XG4gICAgY29uc3QgZmlsdGVyZWRSZXF1ZXN0ID0gbmV3IFVSTChldmVudFJlcXVlc3RzLmF0KC0xKSEpO1xuICAgIGV4cGVjdChmaWx0ZXJlZFJlcXVlc3Quc2VhcmNoUGFyYW1zLmdldChcImxpbWl0XCIpKS50b0JlKFwiNTBcIik7XG4gICAgZXhwZWN0KGZpbHRlcmVkUmVxdWVzdC5zZWFyY2hQYXJhbXMuZ2V0KFwicGFnZVwiKSkudG9CZShcIjFcIik7XG4gICAgZXhwZWN0KGZpbHRlcmVkUmVxdWVzdC5zZWFyY2hQYXJhbXMuZ2V0KFwic2VhcmNoXCIpKS50b0JlKFwiRmlsdGVyZWQgcmVsZWFzZVwiKTtcbiAgICBleHBlY3QoZmlsdGVyZWRSZXF1ZXN0LnNlYXJjaFBhcmFtcy5nZXQoXCJzZXZlcml0eVwiKSkudG9CZShcInN1Y2Nlc3NcIik7XG4gIH0pO1xuXG4gIHRlc3QoXCJyZW5kZXJzIGFuIEFyYWJpYyBzb3VyY2UtYmFja2VkIEFJIGFuc3dlciB3aXRob3V0IGludGVybmFsIGRpYWdub3N0aWNzXCIsIGFzeW5jICh7XG4gICAgcGFnZSxcbiAgfSkgPT4ge1xuICAgIGNvbnN0IGZpeHR1cmUgPSBhd2FpdCBpbnN0YWxsQXJhYmljQWlGaXh0dXJlKHBhZ2UpO1xuICAgIGF3YWl0IGluc3RhbGxBcGlGaXh0dXJlcyhwYWdlLCB7IGFyYWJpY0FpOiBmaXh0dXJlIH0pO1xuICAgIGF3YWl0IHByb2dyYW1tYXRpY1NpZ25JbihwYWdlKTtcbiAgICBhd2FpdCBwYWdlLmdvdG8oYCR7REFTSEJPQVJEX1BBVEh9YWlgKTtcblxuICAgIGNvbnN0IGNvbXBvc2VyID0gcGFnZS5sb2NhdG9yKFwidGV4dGFyZWFcIikuZmlyc3QoKTtcbiAgICBhd2FpdCBleHBlY3QoY29tcG9zZXIpLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgY29tcG9zZXIuZmlsbChmaXh0dXJlLnF1ZXN0aW9uKTtcbiAgICBjb25zdCBzZW5kQnV0dG9uID0gY29tcG9zZXIubG9jYXRvcihcInhwYXRoPS4uXCIpLmdldEJ5Um9sZShcImJ1dHRvblwiKTtcbiAgICBhd2FpdCBleHBlY3Qoc2VuZEJ1dHRvbikudG9CZUVuYWJsZWQoKTtcbiAgICBjb25zdCBzdHJlYW1SZXNwb25zZVByb21pc2UgPSBwYWdlLndhaXRGb3JSZXNwb25zZSgocmVzcG9uc2UpID0+XG4gICAgICByZXNwb25zZS51cmwoKS5pbmNsdWRlcyhcIi9hcGkvYWkvY2hhdC9zdHJlYW1cIiksXG4gICAgKTtcbiAgICBhd2FpdCBzZW5kQnV0dG9uLmNsaWNrKCk7XG4gICAgY29uc3Qgc3RyZWFtUmVzcG9uc2UgPSBhd2FpdCBzdHJlYW1SZXNwb25zZVByb21pc2U7XG4gICAgZXhwZWN0KHN0cmVhbVJlc3BvbnNlLnN0YXR1cygpKS50b0JlKDIwMCk7XG5cbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChmaXh0dXJlLnF1ZXN0aW9uLCB7IGV4YWN0OiB0cnVlIH0pLmxhc3QoKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoZml4dHVyZS5hbnN3ZXIsIHsgZXhhY3Q6IHRydWUgfSkubGFzdCgpLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcIkFnZW50IGFjdGl2aXR5XCIsIHsgZXhhY3Q6IGZhbHNlIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBwYWdlLmxvY2F0b3IoXCJzdW1tYXJ5XCIpLmZpbHRlcih7IGhhc1RleHQ6IFwiQWdlbnQgYWN0aXZpdHlcIiB9KS5jbGljaygpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiUmVhZGluZyBzb3VyY2VcIiwgeyBleGFjdDogZmFsc2UgfSksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KGZpeHR1cmUuc291cmNlLCB7IGV4YWN0OiB0cnVlIH0pLmxhc3QoKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoL0JlaGF2aW9yIGV2aWRlbmNlIMK3IDEgZXhjZXJwdC9pKS5sYXN0KCksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2VcbiAgICAgICAgLmdldEJ5VGV4dCgncmV0dXJuIHBhcnRpYWxGcm9tQ29sbGVjdGVkRXZpZGVuY2UoXCJwcm92aWRlciB0aW1lb3V0XCIpOycsIHtcbiAgICAgICAgICBleGFjdDogdHJ1ZSxcbiAgICAgICAgfSlcbiAgICAgICAgLmxhc3QoKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG5cbiAgICBjb25zdCB2aXNpYmxlVGV4dCA9IGF3YWl0IHBhZ2UubG9jYXRvcihcImJvZHlcIikuaW5uZXJUZXh0KCk7XG4gICAgZXhwZWN0KHZpc2libGVUZXh0KS5ub3QudG9Db250YWluKFwiQ09NUExFVEVEXCIpO1xuICAgIGV4cGVjdCh2aXNpYmxlVGV4dCkubm90LnRvQ29udGFpbihcIlBlcnNpc3RlZCBleGVjdXRpb24gcHJvb2ZcIik7XG4gICAgZXhwZWN0KHZpc2libGVUZXh0KS50b0NvbnRhaW4oXCJOT1QgUFJPVkVOXCIpO1xuICB9KTtcblxuICB0ZXN0KFwia2VlcHMgdGhlIEFJIHNlc3Npb24gZHJhd2VyIG92ZXJsYWlkIG9uIGEgcGhvbmUgdmlld3BvcnQgd2l0aCBhY2NlcHRlZCBldmlkZW5jZVwiLCBhc3luYyAoe1xuICAgIHBhZ2UsXG4gIH0pID0+IHtcbiAgICBhd2FpdCBwYWdlLnNldFZpZXdwb3J0U2l6ZSh7IHdpZHRoOiAzOTAsIGhlaWdodDogODQ0IH0pO1xuICAgIGNvbnN0IGZpeHR1cmUgPSBhd2FpdCBpbnN0YWxsQXJhYmljQWlGaXh0dXJlKHBhZ2UpO1xuICAgIGF3YWl0IGluc3RhbGxBcGlGaXh0dXJlcyhwYWdlLCB7IGFyYWJpY0FpOiBmaXh0dXJlIH0pO1xuICAgIGF3YWl0IHByb2dyYW1tYXRpY1NpZ25JbihwYWdlKTtcbiAgICBhd2FpdCBwYWdlLmdvdG8oYCR7REFTSEJPQVJEX1BBVEh9YWlgKTtcblxuICAgIGNvbnN0IGNvbXBvc2VyID0gcGFnZS5sb2NhdG9yKFwidGV4dGFyZWFcIikuZmlyc3QoKTtcbiAgICBhd2FpdCBjb21wb3Nlci5maWxsKGZpeHR1cmUucXVlc3Rpb24pO1xuICAgIGF3YWl0IGNvbXBvc2VyLmxvY2F0b3IoXCJ4cGF0aD0uLlwiKS5nZXRCeVJvbGUoXCJidXR0b25cIikuY2xpY2soKTtcblxuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KGZpeHR1cmUuYW5zd2VyLCB7IGV4YWN0OiB0cnVlIH0pLmxhc3QoKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZVxuICAgICAgICAuZ2V0QnlUZXh0KGAke2ZpeHR1cmUuc291cmNlfTo0MmAsIHsgZXhhY3Q6IGZhbHNlIH0pXG4gICAgICAgIC5sYXN0KCksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IHBhZ2VcbiAgICAgIC5sb2NhdG9yKFwic3VtbWFyeVwiKVxuICAgICAgLmZpbHRlcih7IGhhc1RleHQ6IFwiQWdlbnQgYWN0aXZpdHlcIiB9KVxuICAgICAgLmxhc3QoKVxuICAgICAgLmNsaWNrKCk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcihcImJvZHlcIikpLnRvQ29udGFpblRleHQoXCJSZWFkaW5nIHNvdXJjZVwiKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKFwiYm9keVwiKSkudG9Db250YWluVGV4dChmaXh0dXJlLnNvdXJjZSk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcihcImJvZHlcIikpLnRvQ29udGFpblRleHQoXG4gICAgICBcIkFjY2VwdGVkOiBzb3VyY2Ugc3BhbiB2ZXJpZmllZC5cIixcbiAgICApO1xuICAgIGF3YWl0IGV4cGVjdE5vSG9yaXpvbnRhbE92ZXJmbG93KHBhZ2UpO1xuXG4gICAgY29uc3QgdmlzaWJsZVRleHQgPSBhd2FpdCBwYWdlLmxvY2F0b3IoXCJib2R5XCIpLmlubmVyVGV4dCgpO1xuICAgIGV4cGVjdCh2aXNpYmxlVGV4dCkubm90LnRvTWF0Y2goXG4gICAgICAvcmF3UHJvbXB0fHN5c3RlbVByb21wdHxwcm92aWRlciBkaWFnbm9zdGljc3xzb3VyY2Utd2luZG93fHJlY292ZXJ5IHByb21wdHxcXC9ob21lXFwvcnVubmVyL2ksXG4gICAgKTtcbiAgfSk7XG5cbiAgdGVzdChcImtlZXBzIHNhZmUgY2l0YXRpb24gc3RhdGUgYWNyb3NzIGJyb3dzZXIgYmFjayBhbmQgZm9yd2FyZCBuYXZpZ2F0aW9uIHdpdGggYmxvY2tlZCBldmlkZW5jZVwiLCBhc3luYyAoe1xuICAgIHBhZ2UsXG4gIH0pID0+IHtcbiAgICBjb25zdCBhY2NlcHRlZCA9IGF3YWl0IGluc3RhbGxBcmFiaWNBaUZpeHR1cmUocGFnZSwge1xuICAgICAgc2Vzc2lvbklkOiBcImUyZS1oaXN0b3J5LWFjY2VwdGVkLXNlc3Npb25cIixcbiAgICAgIHF1ZXN0aW9uOiBcItmF2Kcg2YfZiCDYs9mE2YjZgyDZhdmH2YTYqSBwcm92aWRlciDYudmG2K8g2KfZhNix2KzZiNi5INi52KjYsSDYs9is2YQg2KfZhNmF2KrYtdmB2K3Yn1wiLFxuICAgIH0pO1xuICAgIGNvbnN0IGJsb2NrZWQgPSBhd2FpdCBpbnN0YWxsQXJhYmljQWlGaXh0dXJlKHBhZ2UsIHtcbiAgICAgIGJsb2NrZWQ6IHRydWUsXG4gICAgICBzZXNzaW9uSWQ6IFwiZTJlLWhpc3RvcnktYmxvY2tlZC1zZXNzaW9uXCIsXG4gICAgICBxdWVzdGlvbjogXCLZhdinINmH2Ygg2KfZhNiv2YTZitmEINin2YTZhdit2KzZiNioINi52YbYryDYp9mE2LHYrNmI2Lkg2LnYqNixINiz2KzZhCDYp9mE2YXYqti12YHYrdifXCIsXG4gICAgfSk7XG4gICAgYXdhaXQgaW5zdGFsbEFwaUZpeHR1cmVzKHBhZ2UsIHtcbiAgICAgIGFyYWJpY0FpOiBhY2NlcHRlZCxcbiAgICAgIGFsdGVybmF0ZUFpOiBibG9ja2VkLFxuICAgIH0pO1xuICAgIGF3YWl0IHByb2dyYW1tYXRpY1NpZ25JbihwYWdlKTtcbiAgICBhd2FpdCBwYWdlLmdvdG8oYCR7REFTSEJPQVJEX1BBVEh9YWlgKTtcblxuICAgIGNvbnN0IGNvbXBvc2VyID0gcGFnZS5sb2NhdG9yKFwidGV4dGFyZWFcIikuZmlyc3QoKTtcbiAgICBhd2FpdCBjb21wb3Nlci5maWxsKGJsb2NrZWQucXVlc3Rpb24pO1xuICAgIGF3YWl0IGNvbXBvc2VyLmxvY2F0b3IoXCJ4cGF0aD0uLlwiKS5nZXRCeVJvbGUoXCJidXR0b25cIikuY2xpY2soKTtcblxuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KGJsb2NrZWQuYW5zd2VyLCB7IGV4YWN0OiB0cnVlIH0pLmxhc3QoKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgcGFnZVxuICAgICAgLmxvY2F0b3IoXCJzdW1tYXJ5XCIpXG4gICAgICAuZmlsdGVyKHsgaGFzVGV4dDogXCJBZ2VudCBhY3Rpdml0eVwiIH0pXG4gICAgICAubGFzdCgpXG4gICAgICAuY2xpY2soKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKFwiYm9keVwiKSkudG9Db250YWluVGV4dChcIlJlYWRpbmcgc291cmNlXCIpO1xuICAgIGNvbnN0IHZpc2libGVUZXh0ID0gYXdhaXQgcGFnZS5sb2NhdG9yKFwiYm9keVwiKS5pbm5lclRleHQoKTtcbiAgICBleHBlY3QodmlzaWJsZVRleHQpLm5vdC50b01hdGNoKFxuICAgICAgL3Jhd1Byb21wdHxzeXN0ZW1Qcm9tcHR8cHJvdmlkZXIgZGlhZ25vc3RpY3N8c291cmNlLXdpbmRvd3xyZWNvdmVyeSBwcm9tcHR8XFwvaG9tZVxcL3J1bm5lci9pLFxuICAgICk7XG4gIH0pO1xuXG4gIHRlc3QoXCJrZWVwcyBzYWZlIGNpdGF0aW9uIHN0YXRlIHdoZW4gc3dpdGNoaW5nIHByb2plY3RzXCIsIGFzeW5jICh7XG4gICAgcGFnZSxcbiAgfSkgPT4ge1xuICAgIGNvbnN0IGFjY2VwdGVkID0gYXdhaXQgaW5zdGFsbEFyYWJpY0FpRml4dHVyZShwYWdlLCB7XG4gICAgICBzZXNzaW9uSWQ6IFwiZTJlLWhpc3RvcnktYWNjZXB0ZWQtc2Vzc2lvblwiLFxuICAgICAgcXVlc3Rpb246IFwi2YXYpyDZh9mIINiz2YTZiNmDINmF2YfZhNipIHByb3ZpZGVyINi52YbYryDYp9mE2LHYrNmI2Lkg2LnYqNixINiz2KzZhCDYp9mE2YXYqti12YHYrdifXCIsXG4gICAgfSk7XG4gICAgY29uc3QgYmxvY2tlZCA9IGF3YWl0IGluc3RhbGxBcmFiaWNBaUZpeHR1cmUocGFnZSwge1xuICAgICAgYmxvY2tlZDogdHJ1ZSxcbiAgICAgIHNlc3Npb25JZDogXCJlMmUtaGlzdG9yeS1ibG9ja2VkLXNlc3Npb25cIixcbiAgICAgIHF1ZXN0aW9uOiBcItmF2Kcg2YfZiCDYp9mE2K/ZhNmK2YQg2KfZhNmF2K3YrNmI2Kgg2LnZhtivINin2YTYsdis2YjYuSDYudio2LEg2LPYrNmEINin2YTZhdiq2LXZgdit2J9cIixcbiAgICB9KTtcbiAgICBhd2FpdCBpbnN0YWxsQXBpRml4dHVyZXMocGFnZSwge1xuICAgICAgYXJhYmljQWk6IGFjY2VwdGVkLFxuICAgICAgYWx0ZXJuYXRlQWk6IGJsb2NrZWQsXG4gICAgICBwcm9qZWN0czogW1xuICAgICAgICB7XG4gICAgICAgICAgaWQ6IFwiZTJlLXByb2plY3Qtb25lXCIsXG4gICAgICAgICAgbmFtZTogXCJDaXRhdGlvbiBQcm9qZWN0IE9uZVwiLFxuICAgICAgICAgIGxhbmd1YWdlOiBcIlR5cGVTY3JpcHRcIixcbiAgICAgICAgICBmcmFtZXdvcms6IFwiUmVhY3RcIixcbiAgICAgICAgICBzdGF0dXM6IFwiYWN0aXZlXCIsXG4gICAgICAgICAgcm9vdFBhdGg6IFwiL2NvbnRyb2xsZWQvcHJvamVjdC1vbmVcIixcbiAgICAgICAgICBxdWFsaXR5U2NvcmU6IDkyLFxuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgaWQ6IFwiZTJlLXByb2plY3QtdHdvXCIsXG4gICAgICAgICAgbmFtZTogXCJDaXRhdGlvbiBQcm9qZWN0IFR3b1wiLFxuICAgICAgICAgIGxhbmd1YWdlOiBcIlR5cGVTY3JpcHRcIixcbiAgICAgICAgICBmcmFtZXdvcms6IFwiUmVhY3RcIixcbiAgICAgICAgICBzdGF0dXM6IFwiYWN0aXZlXCIsXG4gICAgICAgICAgcm9vdFBhdGg6IFwiL2NvbnRyb2xsZWQvcHJvamVjdC10d29cIixcbiAgICAgICAgICBxdWFsaXR5U2NvcmU6IDg4LFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICB9KTtcbiAgICBhd2FpdCBwcm9ncmFtbWF0aWNTaWduSW4ocGFnZSk7XG4gICAgYXdhaXQgcGFnZS5nb3RvKGAke0RBU0hCT0FSRF9QQVRIfWFpYCk7XG5cbiAgICBhd2FpdCBwYWdlXG4gICAgICAuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogYWNjZXB0ZWQucXVlc3Rpb24sIGV4YWN0OiB0cnVlIH0pXG4gICAgICAuY2xpY2soKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChhY2NlcHRlZC5hbnN3ZXIsIHsgZXhhY3Q6IHRydWUgfSkubGFzdCgpLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChgJHthY2NlcHRlZC5zb3VyY2V9OjQyYCwgeyBleGFjdDogZmFsc2UgfSkubGFzdCgpLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcIkFjY2VwdGVkOiBzb3VyY2Ugc3BhbiB2ZXJpZmllZC5cIiwgeyBleGFjdDogdHJ1ZSB9KS5sYXN0KCksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuXG4gICAgYXdhaXQgcGFnZS5nZXRCeVJvbGUoXCJjb21ib2JveFwiKS5zZWxlY3RPcHRpb24oXCJlMmUtcHJvamVjdC10d29cIik7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBibG9ja2VkLnF1ZXN0aW9uLCBleGFjdDogdHJ1ZSB9KSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlUZXh0KGFjY2VwdGVkLmFuc3dlciwgeyBleGFjdDogdHJ1ZSB9KSkudG9IYXZlQ291bnQoXG4gICAgICAwLFxuICAgICk7XG4gICAgYXdhaXQgcGFnZVxuICAgICAgLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IGJsb2NrZWQucXVlc3Rpb24sIGV4YWN0OiB0cnVlIH0pXG4gICAgICAuY2xpY2soKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlXG4gICAgICAgIC5nZXRCeVRleHQoXCJCbG9ja2VkOiBubyBtYXRjaGluZyBzb3VyY2UgdGV4dCB3YXMgZm91bmQuXCIsIHtcbiAgICAgICAgICBleGFjdDogdHJ1ZSxcbiAgICAgICAgfSlcbiAgICAgICAgLmxhc3QoKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoYCR7YmxvY2tlZC5zb3VyY2V9OjQyYCwgeyBleGFjdDogZmFsc2UgfSksXG4gICAgKS50b0hhdmVDb3VudCgwKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcIkFjY2VwdGVkOiBzb3VyY2Ugc3BhbiB2ZXJpZmllZC5cIiwgeyBleGFjdDogdHJ1ZSB9KSxcbiAgICApLnRvSGF2ZUNvdW50KDApO1xuXG4gICAgYXdhaXQgcGFnZS5nZXRCeVJvbGUoXCJjb21ib2JveFwiKS5zZWxlY3RPcHRpb24oXCJlMmUtcHJvamVjdC1vbmVcIik7XG4gICAgYXdhaXQgcGFnZVxuICAgICAgLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IGFjY2VwdGVkLnF1ZXN0aW9uLCBleGFjdDogdHJ1ZSB9KVxuICAgICAgLmNsaWNrKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoYCR7YWNjZXB0ZWQuc291cmNlfTo0MmAsIHsgZXhhY3Q6IGZhbHNlIH0pLmxhc3QoKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXCJBY2NlcHRlZDogc291cmNlIHNwYW4gdmVyaWZpZWQuXCIsIHsgZXhhY3Q6IHRydWUgfSkubGFzdCgpLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcIkJsb2NrZWQ6IG5vIG1hdGNoaW5nIHNvdXJjZSB0ZXh0IHdhcyBmb3VuZC5cIiwge1xuICAgICAgICBleGFjdDogdHJ1ZSxcbiAgICAgIH0pLFxuICAgICkudG9IYXZlQ291bnQoMCk7XG5cbiAgICBjb25zdCB2aXNpYmxlVGV4dCA9IGF3YWl0IHBhZ2UubG9jYXRvcihcImJvZHlcIikuaW5uZXJUZXh0KCk7XG4gICAgZXhwZWN0KHZpc2libGVUZXh0KS5ub3QudG9NYXRjaChcbiAgICAgIC9yYXdQcm9tcHR8c3lzdGVtUHJvbXB0fHByb3ZpZGVyIGRpYWdub3N0aWNzfHNvdXJjZS13aW5kb3d8cmVjb3ZlcnkgcHJvbXB0fFxcL2hvbWVcXC9ydW5uZXIvaSxcbiAgICApO1xuICB9KTtcblxuICB0ZXN0KFwia2VlcHMgc2FmZSBjaXRhdGlvbiBzdGF0ZSBhY3Jvc3MgcmVwZWF0ZWQgbmF2aWdhdGlvblwiLCBhc3luYyAoe1xuICAgIHBhZ2UsXG4gIH0pID0+IHtcbiAgICBjb25zdCBhY2NlcHRlZCA9IGF3YWl0IGluc3RhbGxBcmFiaWNBaUZpeHR1cmUocGFnZSwge1xuICAgICAgc2Vzc2lvbklkOiBcImUyZS1oaXN0b3J5LWFjY2VwdGVkLXNlc3Npb25cIixcbiAgICAgIHF1ZXN0aW9uOiBcItmF2Kcg2YfZiCDYs9mE2YjZgyDZhdmH2YTYqSBwcm92aWRlciDYudmG2K8g2KfZhNix2KzZiNi5INi52KjYsSDYs9is2YQg2KfZhNmF2KrYtdmB2K3Yn1wiLFxuICAgIH0pO1xuICAgIGNvbnN0IGJsb2NrZWQgPSBhd2FpdCBpbnN0YWxsQXJhYmljQWlGaXh0dXJlKHBhZ2UsIHtcbiAgICAgIGJsb2NrZWQ6IHRydWUsXG4gICAgICBzZXNzaW9uSWQ6IFwiZTJlLWhpc3RvcnktYmxvY2tlZC1zZXNzaW9uXCIsXG4gICAgICBxdWVzdGlvbjogXCLZhdinINmH2Ygg2KfZhNiv2YTZitmEINin2YTZhdit2KzZiNioINi52YbYryDYp9mE2LHYrNmI2Lkg2LnYqNixINiz2KzZhCDYp9mE2YXYqti12YHYrdifXCIsXG4gICAgfSk7XG4gICAgYXdhaXQgaW5zdGFsbEFwaUZpeHR1cmVzKHBhZ2UsIHtcbiAgICAgIGFyYWJpY0FpOiBhY2NlcHRlZCxcbiAgICAgIGFsdGVybmF0ZUFpOiBibG9ja2VkLFxuICAgIH0pO1xuICAgIGF3YWl0IHByb2dyYW1tYXRpY1NpZ25JbihwYWdlKTtcbiAgICBhd2FpdCBwYWdlLmdvdG8oYCR7REFTSEJPQVJEX1BBVEh9YWlgKTtcblxuICAgIGNvbnN0IGFzc2VydEFjY2VwdGVkQ2l0YXRpb24gPSBhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCBleHBlY3QoXG4gICAgICAgIHBhZ2UuZ2V0QnlUZXh0KGFjY2VwdGVkLmFuc3dlciwgeyBleGFjdDogdHJ1ZSB9KS5sYXN0KCksXG4gICAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgICBhd2FpdCBleHBlY3QoXG4gICAgICAgIHBhZ2UuZ2V0QnlUZXh0KGAke2FjY2VwdGVkLnNvdXJjZX06NDJgLCB7IGV4YWN0OiBmYWxzZSB9KS5sYXN0KCksXG4gICAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgICBhd2FpdCBleHBlY3QoXG4gICAgICAgIHBhZ2VcbiAgICAgICAgICAuZ2V0QnlUZXh0KFwiQWNjZXB0ZWQ6IHNvdXJjZSBzcGFuIHZlcmlmaWVkLlwiLCB7IGV4YWN0OiB0cnVlIH0pXG4gICAgICAgICAgLmxhc3QoKSxcbiAgICAgICkudG9CZVZpc2libGUoKTtcbiAgICAgIGF3YWl0IGV4cGVjdChcbiAgICAgICAgcGFnZS5nZXRCeVRleHQoXCJCbG9ja2VkOiBubyBtYXRjaGluZyBzb3VyY2UgdGV4dCB3YXMgZm91bmQuXCIsIHtcbiAgICAgICAgICBleGFjdDogdHJ1ZSxcbiAgICAgICAgfSksXG4gICAgICApLnRvSGF2ZUNvdW50KDApO1xuICAgIH07XG4gICAgY29uc3QgYXNzZXJ0QmxvY2tlZENpdGF0aW9uID0gYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgZXhwZWN0KFxuICAgICAgICBwYWdlXG4gICAgICAgICAgLmdldEJ5VGV4dChcIkJsb2NrZWQ6IG5vIG1hdGNoaW5nIHNvdXJjZSB0ZXh0IHdhcyBmb3VuZC5cIiwge1xuICAgICAgICAgICAgZXhhY3Q6IHRydWUsXG4gICAgICAgICAgfSlcbiAgICAgICAgICAubGFzdCgpLFxuICAgICAgKS50b0JlVmlzaWJsZSgpO1xuICAgICAgYXdhaXQgZXhwZWN0KFxuICAgICAgICBwYWdlLmdldEJ5VGV4dChgJHtibG9ja2VkLnNvdXJjZX06NDJgLCB7IGV4YWN0OiBmYWxzZSB9KSxcbiAgICAgICkudG9IYXZlQ291bnQoMCk7XG4gICAgICBhd2FpdCBleHBlY3QoXG4gICAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiQWNjZXB0ZWQ6IHNvdXJjZSBzcGFuIHZlcmlmaWVkLlwiLCB7IGV4YWN0OiB0cnVlIH0pLFxuICAgICAgKS50b0hhdmVDb3VudCgwKTtcbiAgICB9O1xuICAgIGNvbnN0IGFzc2VydE5vSW50ZXJuYWxDaXRhdGlvbkRldGFpbHMgPSBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCB2aXNpYmxlVGV4dCA9IGF3YWl0IHBhZ2UubG9jYXRvcihcImJvZHlcIikuaW5uZXJUZXh0KCk7XG4gICAgICBleHBlY3QodmlzaWJsZVRleHQpLm5vdC50b01hdGNoKFxuICAgICAgICAvTUlTU0lOR19MSVRFUkFMX01BVENIfHJhd1Byb21wdHxzeXN0ZW1Qcm9tcHR8cHJvdmlkZXIgZGlhZ25vc3RpY3N8c291cmNlLXdpbmRvd3xyZWNvdmVyeSBwcm9tcHR8XFwvaG9tZVxcL3J1bm5lci9pLFxuICAgICAgKTtcbiAgICB9O1xuXG4gICAgYXdhaXQgcGFnZVxuICAgICAgLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IGFjY2VwdGVkLnF1ZXN0aW9uLCBleGFjdDogdHJ1ZSB9KVxuICAgICAgLmNsaWNrKCk7XG4gICAgYXdhaXQgYXNzZXJ0QWNjZXB0ZWRDaXRhdGlvbigpO1xuXG4gICAgYXdhaXQgb3Blbk5hdmlnYXRpb24ocGFnZSwgXCJQcm9qZWN0c1wiLCBgJHtEQVNIQk9BUkRfUEFUSH1wcm9qZWN0c2ApO1xuICAgIGF3YWl0IHBhZ2UuZ29CYWNrKCk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UpLnRvSGF2ZVVSTChcbiAgICAgIG5ldyBSZWdFeHAoYCR7REFTSEJPQVJEX1BBVEgucmVwbGFjZUFsbChcIi9cIiwgXCJcXFxcL1wiKX1haSRgKSxcbiAgICApO1xuICAgIGF3YWl0IHBhZ2VcbiAgICAgIC5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBhY2NlcHRlZC5xdWVzdGlvbiwgZXhhY3Q6IHRydWUgfSlcbiAgICAgIC5jbGljaygpO1xuICAgIGF3YWl0IGFzc2VydEFjY2VwdGVkQ2l0YXRpb24oKTtcbiAgICBhd2FpdCBhc3NlcnROb0ludGVybmFsQ2l0YXRpb25EZXRhaWxzKCk7XG5cbiAgICBhd2FpdCBwYWdlLmdvRm9yd2FyZCgpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlKS50b0hhdmVVUkwoXG4gICAgICBuZXcgUmVnRXhwKGAke0RBU0hCT0FSRF9QQVRILnJlcGxhY2VBbGwoXCIvXCIsIFwiXFxcXC9cIil9cHJvamVjdHMkYCksXG4gICAgKTtcbiAgICBhd2FpdCBwYWdlLmdvQmFjaygpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlKS50b0hhdmVVUkwoXG4gICAgICBuZXcgUmVnRXhwKGAke0RBU0hCT0FSRF9QQVRILnJlcGxhY2VBbGwoXCIvXCIsIFwiXFxcXC9cIil9YWkkYCksXG4gICAgKTtcbiAgICBhd2FpdCBwYWdlXG4gICAgICAuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogYWNjZXB0ZWQucXVlc3Rpb24sIGV4YWN0OiB0cnVlIH0pXG4gICAgICAuY2xpY2soKTtcbiAgICBhd2FpdCBhc3NlcnRBY2NlcHRlZENpdGF0aW9uKCk7XG5cbiAgICBhd2FpdCBwYWdlXG4gICAgICAuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogYmxvY2tlZC5xdWVzdGlvbiwgZXhhY3Q6IHRydWUgfSlcbiAgICAgIC5jbGljaygpO1xuICAgIGF3YWl0IGFzc2VydEJsb2NrZWRDaXRhdGlvbigpO1xuXG4gICAgYXdhaXQgb3Blbk5hdmlnYXRpb24ocGFnZSwgXCJFdmVudCBTdHJlYW1cIiwgYCR7REFTSEJPQVJEX1BBVEh9ZXZlbnRzYCk7XG4gICAgYXdhaXQgcGFnZS5nb0JhY2soKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZSkudG9IYXZlVVJMKFxuICAgICAgbmV3IFJlZ0V4cChgJHtEQVNIQk9BUkRfUEFUSC5yZXBsYWNlQWxsKFwiL1wiLCBcIlxcXFwvXCIpfWFpJGApLFxuICAgICk7XG4gICAgYXdhaXQgcGFnZVxuICAgICAgLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IGJsb2NrZWQucXVlc3Rpb24sIGV4YWN0OiB0cnVlIH0pXG4gICAgICAuY2xpY2soKTtcbiAgICBhd2FpdCBhc3NlcnRCbG9ja2VkQ2l0YXRpb24oKTtcbiAgICBhd2FpdCBhc3NlcnROb0ludGVybmFsQ2l0YXRpb25EZXRhaWxzKCk7XG5cbiAgICBhd2FpdCBwYWdlLmdvRm9yd2FyZCgpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlKS50b0hhdmVVUkwoXG4gICAgICBuZXcgUmVnRXhwKGAke0RBU0hCT0FSRF9QQVRILnJlcGxhY2VBbGwoXCIvXCIsIFwiXFxcXC9cIil9ZXZlbnRzJGApLFxuICAgICk7XG4gICAgYXdhaXQgcGFnZS5nb0JhY2soKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZSkudG9IYXZlVVJMKFxuICAgICAgbmV3IFJlZ0V4cChgJHtEQVNIQk9BUkRfUEFUSC5yZXBsYWNlQWxsKFwiL1wiLCBcIlxcXFwvXCIpfWFpJGApLFxuICAgICk7XG4gICAgYXdhaXQgcGFnZVxuICAgICAgLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IGJsb2NrZWQucXVlc3Rpb24sIGV4YWN0OiB0cnVlIH0pXG4gICAgICAuY2xpY2soKTtcbiAgICBhd2FpdCBhc3NlcnRCbG9ja2VkQ2l0YXRpb24oKTtcbiAgICBhd2FpdCBhc3NlcnROb0ludGVybmFsQ2l0YXRpb25EZXRhaWxzKCk7XG4gIH0pO1xuXG4gIHRlc3QoXCJrZWVwcyBvbmx5IHRoZSBzYWZlIGJsb2NrZWQgY2l0YXRpb24gcmVhc29uIGFmdGVyIGNoYXQgcmVsb2FkXCIsIGFzeW5jICh7XG4gICAgcGFnZSxcbiAgfSkgPT4ge1xuICAgIGNvbnN0IGZpeHR1cmUgPSBpbnN0YWxsVG9vbEZhaWx1cmVGaXh0dXJlKCk7XG4gICAgYXdhaXQgaW5zdGFsbEFwaUZpeHR1cmVzKHBhZ2UsIHsgYXJhYmljQWk6IGZpeHR1cmUgfSk7XG4gICAgYXdhaXQgcHJvZ3JhbW1hdGljU2lnbkluKHBhZ2UpO1xuICAgIGF3YWl0IHBhZ2UuZ290byhgJHtEQVNIQk9BUkRfUEFUSH1haWApO1xuXG4gICAgY29uc3QgY29tcG9zZXIgPSBwYWdlLmxvY2F0b3IoXCJ0ZXh0YXJlYVwiKS5maXJzdCgpO1xuICAgIGF3YWl0IGNvbXBvc2VyLmZpbGwoZml4dHVyZS5xdWVzdGlvbik7XG4gICAgYXdhaXQgY29tcG9zZXIubG9jYXRvcihcInhwYXRoPS4uXCIpLmdldEJ5Um9sZShcImJ1dHRvblwiKS5jbGljaygpO1xuXG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoZml4dHVyZS5hbnN3ZXIsIHsgZXhhY3Q6IHRydWUgfSkubGFzdCgpLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlXG4gICAgICAgIC5nZXRCeVRleHQoXCJyZXF1aXJlZCB0b29sIGRpZCBub3QgY29tcGxldGUg4oCUIEJMT0NLRUQvSU5DT01QTEVURVwiLCB7XG4gICAgICAgICAgZXhhY3Q6IGZhbHNlLFxuICAgICAgICB9KVxuICAgICAgICAubGFzdCgpLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBwYWdlXG4gICAgICAubG9jYXRvcihcInN1bW1hcnlcIilcbiAgICAgIC5maWx0ZXIoeyBoYXNUZXh0OiBcIkFnZW50IGFjdGl2aXR5XCIgfSlcbiAgICAgIC5sYXN0KClcbiAgICAgIC5jbGljaygpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoXCJib2R5XCIpKS50b0NvbnRhaW5UZXh0KFwiUmVhZGluZyBzb3VyY2VcIik7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcihcImJvZHlcIikpLnRvQ29udGFpblRleHQoXG4gICAgICBcInNyYy9taXNzaW5nLXJlbGVhc2UtZml4dHVyZS50c1wiLFxuICAgICk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcihcImJvZHlcIikpLnRvQ29udGFpblRleHQoXCJUb29sIGZhaWxlZFwiKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKFwiYm9keVwiKSkudG9Db250YWluVGV4dChcIlRPT0xfRVhFQ1VUSU9OX0ZBSUxFRFwiKTtcbiAgICBjb25zdCB2aXNpYmxlVGV4dCA9IGF3YWl0IHBhZ2UubG9jYXRvcihcImJvZHlcIikuaW5uZXJUZXh0KCk7XG4gICAgZXhwZWN0KHZpc2libGVUZXh0KS5ub3QudG9Db250YWluKFwiQ09NUExFVEVEXCIpO1xuICAgIGV4cGVjdCh2aXNpYmxlVGV4dCkudG9Db250YWluKFwiUGVyc2lzdGVkIGV4ZWN1dGlvbiBwcm9vZlwiKTtcbiAgICBleHBlY3QodmlzaWJsZVRleHQpLnRvQ29udGFpbihcIlRoZSByZXF1aXJlZCBzb3VyY2UgcmVhZCBkaWQgbm90IGNvbXBsZXRlLlwiKTtcbiAgfSk7XG5cbiAgdGVzdChcImtlZXBzIHRoZSBmYWlsZWQgQUkgc2Vzc2lvbiBkcmF3ZXIgb3ZlcmxhaWQgb24gYSBwaG9uZSB2aWV3cG9ydFwiLCBhc3luYyAoe1xuICAgIHBhZ2UsXG4gIH0pID0+IHtcbiAgICBhd2FpdCBwYWdlLnNldFZpZXdwb3J0U2l6ZSh7IHdpZHRoOiAzOTAsIGhlaWdodDogODQ0IH0pO1xuICAgIGNvbnN0IGZpeHR1cmUgPSBpbnN0YWxsVG9vbEZhaWx1cmVGaXh0dXJlKCk7XG4gICAgYXdhaXQgaW5zdGFsbEFwaUZpeHR1cmVzKHBhZ2UsIHsgYXJhYmljQWk6IGZpeHR1cmUgfSk7XG4gICAgYXdhaXQgcHJvZ3JhbW1hdGljU2lnbkluKHBhZ2UpO1xuICAgIGF3YWl0IHBhZ2UuZ290byhgJHtEQVNIQk9BUkRfUEFUSH1haWApO1xuXG4gICAgY29uc3QgY29tcG9zZXIgPSBwYWdlLmxvY2F0b3IoXCJ0ZXh0YXJlYVwiKS5maXJzdCgpO1xuICAgIGF3YWl0IGNvbXBvc2VyLmZpbGwoZml4dHVyZS5xdWVzdGlvbik7XG4gICAgYXdhaXQgY29tcG9zZXIubG9jYXRvcihcInhwYXRoPS4uXCIpLmdldEJ5Um9sZShcImJ1dHRvblwiKS5jbGljaygpO1xuXG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoZml4dHVyZS5hbnN3ZXIsIHsgZXhhY3Q6IHRydWUgfSkubGFzdCgpLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlXG4gICAgICAgIC5nZXRCeVRleHQoXCJyZXF1aXJlZCB0b29sIGRpZCBub3QgY29tcGxldGUg4oCUIEJMT0NLRUQvSU5DT01QTEVURVwiLCB7XG4gICAgICAgICAgZXhhY3Q6IGZhbHNlLFxuICAgICAgICB9KVxuICAgICAgICAubGFzdCgpLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBwYWdlXG4gICAgICAubG9jYXRvcihcInN1bW1hcnlcIilcbiAgICAgIC5maWx0ZXIoeyBoYXNUZXh0OiBcIkFnZW50IGFjdGl2aXR5XCIgfSlcbiAgICAgIC5sYXN0KClcbiAgICAgIC5jbGljaygpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoXCJib2R5XCIpKS50b0NvbnRhaW5UZXh0KFwiUmVhZGluZyBzb3VyY2VcIik7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcihcImJvZHlcIikpLnRvQ29udGFpblRleHQoXG4gICAgICBcInNyYy9taXNzaW5nLXJlbGVhc2UtZml4dHVyZS50c1wiLFxuICAgICk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcihcImJvZHlcIikpLnRvQ29udGFpblRleHQoXCJUb29sIGZhaWxlZFwiKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKFwiYm9keVwiKSkudG9Db250YWluVGV4dChcIlRPT0xfRVhFQ1VUSU9OX0ZBSUxFRFwiKTtcbiAgICBjb25zdCB2aXNpYmxlVGV4dCA9IGF3YWl0IHBhZ2UubG9jYXRvcihcImJvZHlcIikuaW5uZXJUZXh0KCk7XG4gICAgZXhwZWN0KHZpc2libGVUZXh0KS5ub3QudG9NYXRjaChcbiAgICAgIC9yYXcgZXhjZXB0aW9ufHN0YWNrIHRyYWNlfFxcL2hvbWVcXC9ydW5uZXJ8c2VjcmV0fGZpeHR1cmUgZGlhZ25vc3RpYy9pLFxuICAgICk7XG5cbiAgICBhd2FpdCBleHBlY3ROb0hvcml6b250YWxPdmVyZmxvdyhwYWdlKTtcbiAgfSk7XG5cbiAgdGVzdChcInByZXNlcnZlcyBvbmUgcGFydGlhbCBhbnN3ZXIgYWZ0ZXIgYSBwcm92aWRlciBkaXNjb25uZWN0IGFuZCBtYXJrcyBpdCBpbmNvbXBsZXRlXCIsIGFzeW5jICh7XG4gICAgcGFnZSxcbiAgfSkgPT4ge1xuICAgIGNvbnN0IGZpeHR1cmUgPSBpbnN0YWxsRGlzY29ubmVjdGVkQWlGaXh0dXJlKCk7XG4gICAgYXdhaXQgaW5zdGFsbEFwaUZpeHR1cmVzKHBhZ2UsIHsgZGlzY29ubmVjdEFpOiBmaXh0dXJlIH0pO1xuICAgIGF3YWl0IHByb2dyYW1tYXRpY1NpZ25JbihwYWdlKTtcbiAgICBhd2FpdCBwYWdlLmdvdG8oYCR7REFTSEJPQVJEX1BBVEh9YWlgKTtcblxuICAgIGNvbnN0IGNvbXBvc2VyID0gcGFnZS5sb2NhdG9yKFwidGV4dGFyZWFcIikuZmlyc3QoKTtcbiAgICBhd2FpdCBjb21wb3Nlci5maWxsKGZpeHR1cmUucXVlc3Rpb24pO1xuICAgIGF3YWl0IGNvbXBvc2VyLmxvY2F0b3IoXCJ4cGF0aD0uLlwiKS5nZXRCeVJvbGUoXCJidXR0b25cIikuY2xpY2soKTtcblxuICAgIGNvbnN0IGFuc3dlciA9IHBhZ2UuZ2V0QnlUZXh0KGZpeHR1cmUuYW5zd2VyLCB7IGV4YWN0OiB0cnVlIH0pO1xuICAgIGF3YWl0IGV4cGVjdChhbnN3ZXIubGFzdCgpKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlLmdldEJ5VGV4dChcIklOQ09NUExFVEU6XCIsIHsgZXhhY3Q6IGZhbHNlIH0pKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwicHJvdmlkZXIgZmFpbHVyZVwiLCB7IGV4YWN0OiBmYWxzZSB9KS5sYXN0KCksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwic3RvcHBlZDogcHJvdmlkZXIgdGltZW91dFwiLCB7IGV4YWN0OiBmYWxzZSB9KS5sYXN0KCksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiVGhlIHByb3ZpZGVyIGRpc2Nvbm5lY3RlZCBhZnRlciB2aXNpYmxlIHJlc3BvbnNlIHRleHQuXCIsIHtcbiAgICAgICAgZXhhY3Q6IHRydWUsXG4gICAgICB9KSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG5cbiAgICBhd2FpdCBwYWdlLnJlbG9hZCgpO1xuICAgIGF3YWl0IHBhZ2VcbiAgICAgIC5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBmaXh0dXJlLnF1ZXN0aW9uLCBleGFjdDogdHJ1ZSB9KVxuICAgICAgLmNsaWNrKCk7XG5cbiAgICBhd2FpdCBleHBlY3QocGFnZS5nZXRCeVRleHQoZml4dHVyZS5hbnN3ZXIsIHsgZXhhY3Q6IHRydWUgfSkubGFzdCgpKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlLmdldEJ5VGV4dChcIklOQ09NUExFVEU6XCIsIHsgZXhhY3Q6IGZhbHNlIH0pKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwicHJvdmlkZXIgZmFpbHVyZVwiLCB7IGV4YWN0OiBmYWxzZSB9KS5sYXN0KCksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwic3RvcHBlZDogcHJvdmlkZXIgdGltZW91dFwiLCB7IGV4YWN0OiBmYWxzZSB9KS5sYXN0KCksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiVGhlIHByb3ZpZGVyIGRpc2Nvbm5lY3RlZCBhZnRlciB2aXNpYmxlIHJlc3BvbnNlIHRleHQuXCIsIHtcbiAgICAgICAgZXhhY3Q6IHRydWUsXG4gICAgICB9KSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gIH0pO1xuXG4gIHRlc3QoXCJyZXN1bWVzIGEgZmFpbGVkIGFuYWx5c2lzIGFuZCBrZWVwcyB0aGUgZXhlY3V0aW9uIGluY29tcGxldGVcIiwgYXN5bmMgKHtcbiAgICBwYWdlLFxuICB9KSA9PiB7XG4gICAgY29uc3QgeyBmaXh0dXJlLCBleGVjdXRpb24gfSA9IGluc3RhbGxSZXN1bWVkQW5hbHlzaXNGYWlsdXJlRml4dHVyZSgpO1xuICAgIGF3YWl0IGluc3RhbGxBcGlGaXh0dXJlcyhwYWdlLCB7XG4gICAgICBhcmFiaWNBaTogZml4dHVyZSxcbiAgICAgIHJlc3VtZUZhaWx1cmU6IHsgZml4dHVyZSwgZXhlY3V0aW9uIH0sXG4gICAgfSk7XG4gICAgYXdhaXQgcHJvZ3JhbW1hdGljU2lnbkluKHBhZ2UpO1xuXG4gICAgYXdhaXQgcGFnZS5ldmFsdWF0ZShcbiAgICAgICh7IHNlc3Npb25JZCwgZXhlY3V0aW9uSWQsIHByb2plY3RJZCwgcmVzdW1lVG9rZW4sIG1lc3NhZ2UgfSkgPT4ge1xuICAgICAgICBsb2NhbFN0b3JhZ2Uuc2V0SXRlbShcbiAgICAgICAgICBgZW9zX2FpX2V4ZWN1dGlvbl9jdXJyZW50XyR7cHJvamVjdElkfWAsXG4gICAgICAgICAgc2Vzc2lvbklkLFxuICAgICAgICApO1xuICAgICAgICBsb2NhbFN0b3JhZ2Uuc2V0SXRlbShcbiAgICAgICAgICBgZW9zX2FpX2V4ZWN1dGlvbl8ke3Byb2plY3RJZH1fJHtzZXNzaW9uSWR9YCxcbiAgICAgICAgICBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAgICBpZDogZXhlY3V0aW9uSWQsXG4gICAgICAgICAgICBwcm9qZWN0SWQsXG4gICAgICAgICAgICBzZXNzaW9uSWQsXG4gICAgICAgICAgICByZXN1bWVUb2tlbixcbiAgICAgICAgICAgIG1lc3NhZ2UsXG4gICAgICAgICAgfSksXG4gICAgICAgICk7XG4gICAgICB9LFxuICAgICAge1xuICAgICAgICBzZXNzaW9uSWQ6IGZpeHR1cmUuc2Vzc2lvbklkLFxuICAgICAgICBleGVjdXRpb25JZDogZml4dHVyZS5leGVjdXRpb25JZCxcbiAgICAgICAgcHJvamVjdElkOiBcImUyZS1wcm9qZWN0XCIsXG4gICAgICAgIHJlc3VtZVRva2VuOiBcImUyZS1yZXN1bWVkLWFuYWx5c2lzLWZhaWx1cmUtdG9rZW4tb3BhcXVlXCIsXG4gICAgICAgIG1lc3NhZ2U6IGZpeHR1cmUucXVlc3Rpb24sXG4gICAgICB9LFxuICAgICk7XG4gICAgYXdhaXQgcGFnZS5nb3RvKGAke0RBU0hCT0FSRF9QQVRIfWFpYCk7XG5cbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcIkEgc2F2ZWQgQUkgZXhlY3V0aW9uIGlzIHJlYWR5IHRvIHJlc3VtZVwiKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgY29uc3QgcmVzdW1lUmVxdWVzdCA9IHBhZ2Uud2FpdEZvclJlcXVlc3QoXG4gICAgICAocmVxdWVzdCkgPT5cbiAgICAgICAgcmVxdWVzdC51cmwoKS5pbmNsdWRlcyhcIi9hcGkvYWkvY2hhdC9zdHJlYW1cIikgJiZcbiAgICAgICAgcmVxdWVzdC5tZXRob2QoKSA9PT0gXCJQT1NUXCIsXG4gICAgKTtcbiAgICBhd2FpdCBwYWdlXG4gICAgICAuZ2V0QnlMYWJlbChcIkFnZW50IGV4ZWN1dGlvbiBwcm9vZlwiKVxuICAgICAgLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiUmVzdW1lXCIsIGV4YWN0OiB0cnVlIH0pXG4gICAgICAuY2xpY2soKTtcbiAgICBjb25zdCByZXF1ZXN0Qm9keSA9IEpTT04ucGFyc2UoXG4gICAgICAoYXdhaXQgcmVzdW1lUmVxdWVzdCkucG9zdERhdGEoKSA/PyBcInt9XCIsXG4gICAgKSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgICBleHBlY3QocmVxdWVzdEJvZHkpLnRvRXF1YWwoXG4gICAgICBleHBlY3Qub2JqZWN0Q29udGFpbmluZyh7XG4gICAgICAgIHByb2plY3RJZDogXCJlMmUtcHJvamVjdFwiLFxuICAgICAgICBzZXNzaW9uSWQ6IGZpeHR1cmUuc2Vzc2lvbklkLFxuICAgICAgICBleGVjdXRpb25JZDogZml4dHVyZS5leGVjdXRpb25JZCxcbiAgICAgICAgcmVzdW1lVG9rZW46IFwiZTJlLXJlc3VtZWQtYW5hbHlzaXMtZmFpbHVyZS10b2tlbi1vcGFxdWVcIixcbiAgICAgICAgbWVzc2FnZTogZml4dHVyZS5xdWVzdGlvbixcbiAgICAgIH0pLFxuICAgICk7XG5cbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcIkZhaWxlZCB0byBzZW5kIG1lc3NhZ2VcIiwgeyBleGFjdDogdHJ1ZSB9KSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXCJBIHNhdmVkIEFJIGV4ZWN1dGlvbiBpcyByZWFkeSB0byByZXN1bWVcIiksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGNvbnN0IHZpc2libGVUZXh0ID0gYXdhaXQgcGFnZS5sb2NhdG9yKFwiYm9keVwiKS5pbm5lclRleHQoKTtcbiAgICBleHBlY3QodmlzaWJsZVRleHQpLm5vdC50b0NvbnRhaW4oXCJDT01QTEVURURcIik7XG4gICAgZXhwZWN0KHZpc2libGVUZXh0KS5ub3QudG9Db250YWluKFwiUGVyc2lzdGVkIGV4ZWN1dGlvbiBwcm9vZlwiKTtcbiAgICBleHBlY3QodmlzaWJsZVRleHQpLnRvQ29udGFpbihcIlRoZSByZXF1aXJlZCBhbmFseXNpcyBkaWQgbm90IGNvbXBsZXRlLlwiKTtcbiAgfSk7XG5cbiAgdGVzdChcInJlY292ZXJzIGEgbWlzc2luZyB0b2tlbiBhZnRlciBhIHJlYWwgc3RyZWFtIGFib3J0IGFuZCByZXN1bWVzIG9uZSBleGVjdXRpb25cIiwgYXN5bmMgKHtcbiAgICBwYWdlLFxuICB9KSA9PiB7XG4gICAgY29uc3QgcmVjb3ZlcnkgPSBpbnN0YWxsSW50ZXJydXB0ZWRSZXN1bWVGaXh0dXJlKCk7XG4gICAgYXdhaXQgaW5zdGFsbEFwaUZpeHR1cmVzKHBhZ2UsIHsgaW50ZXJydXB0ZWRSZXN1bWU6IHJlY292ZXJ5IH0pO1xuICAgIGF3YWl0IHBhZ2UuYWRkSW5pdFNjcmlwdCgoKSA9PiB7XG4gICAgICBjb25zdCBuYXRpdmVGZXRjaCA9IHdpbmRvdy5mZXRjaC5iaW5kKHdpbmRvdyk7XG4gICAgICB3aW5kb3cuZmV0Y2ggPSBhc3luYyAoaW5wdXQsIGluaXQpID0+IHtcbiAgICAgICAgY29uc3QgdXJsID1cbiAgICAgICAgICB0eXBlb2YgaW5wdXQgPT09IFwic3RyaW5nXCJcbiAgICAgICAgICAgID8gaW5wdXRcbiAgICAgICAgICAgIDogaW5wdXQgaW5zdGFuY2VvZiBSZXF1ZXN0XG4gICAgICAgICAgICAgID8gaW5wdXQudXJsXG4gICAgICAgICAgICAgIDogU3RyaW5nKGlucHV0KTtcbiAgICAgICAgY29uc3QgYm9keSA9IHR5cGVvZiBpbml0Py5ib2R5ID09PSBcInN0cmluZ1wiID8gaW5pdC5ib2R5IDogXCJcIjtcbiAgICAgICAgaWYgKFxuICAgICAgICAgICF1cmwuaW5jbHVkZXMoXCIvYXBpL2FpL2NoYXQvc3RyZWFtXCIpIHx8XG4gICAgICAgICAgYm9keS5pbmNsdWRlcygnXCJleGVjdXRpb25JZFwiJylcbiAgICAgICAgKSB7XG4gICAgICAgICAgcmV0dXJuIG5hdGl2ZUZldGNoKGlucHV0LCBpbml0KTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgbmF0aXZlRmV0Y2goaW5wdXQsIGluaXQpO1xuICAgICAgICBpZiAoIXJlc3BvbnNlLmJvZHkpIHJldHVybiByZXNwb25zZTtcbiAgICAgICAgY29uc3QgcmVhZGVyID0gcmVzcG9uc2UuYm9keS5nZXRSZWFkZXIoKTtcbiAgICAgICAgY29uc3QgZW5jb2RlciA9IG5ldyBUZXh0RW5jb2RlcigpO1xuICAgICAgICBjb25zdCBzdHJlYW0gPSBuZXcgUmVhZGFibGVTdHJlYW0oe1xuICAgICAgICAgIGFzeW5jIHN0YXJ0KGNvbnRyb2xsZXIpIHtcbiAgICAgICAgICAgIGxldCBidWZmZXJlZCA9IFwiXCI7XG4gICAgICAgICAgICB3aGlsZSAodHJ1ZSkge1xuICAgICAgICAgICAgICBjb25zdCB7IGRvbmUsIHZhbHVlIH0gPSBhd2FpdCByZWFkZXIucmVhZCgpO1xuICAgICAgICAgICAgICBpZiAoZG9uZSkge1xuICAgICAgICAgICAgICAgIGlmIChidWZmZXJlZCkgY29udHJvbGxlci5lbnF1ZXVlKGVuY29kZXIuZW5jb2RlKGJ1ZmZlcmVkKSk7XG4gICAgICAgICAgICAgICAgY29udHJvbGxlci5jbG9zZSgpO1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICBidWZmZXJlZCArPSBuZXcgVGV4dERlY29kZXIoKS5kZWNvZGUodmFsdWUsIHsgc3RyZWFtOiB0cnVlIH0pO1xuICAgICAgICAgICAgICBjb25zdCBtYXJrZXIgPSBidWZmZXJlZC5pbmRleE9mKCdcInR5cGVcIjpcImV4ZWN1dGlvbl9zdGFydGVkXCInKTtcbiAgICAgICAgICAgICAgY29uc3QgZnJhbWVFbmQgPVxuICAgICAgICAgICAgICAgIG1hcmtlciA8IDAgPyAtMSA6IGJ1ZmZlcmVkLmluZGV4T2YoXCJcXG5cXG5cIiwgbWFya2VyKTtcbiAgICAgICAgICAgICAgaWYgKGZyYW1lRW5kID49IDApIHtcbiAgICAgICAgICAgICAgICBjb250cm9sbGVyLmVucXVldWUoXG4gICAgICAgICAgICAgICAgICBlbmNvZGVyLmVuY29kZShidWZmZXJlZC5zbGljZSgwLCBmcmFtZUVuZCArIDIpKSxcbiAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICAgIGNvbnRyb2xsZXIuZXJyb3IobmV3IFR5cGVFcnJvcihcIm5ldHdvcmsgY29ubmVjdGlvbiByZXNldFwiKSk7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSxcbiAgICAgICAgfSk7XG4gICAgICAgIHJldHVybiBuZXcgUmVzcG9uc2Uoc3RyZWFtLCB7XG4gICAgICAgICAgc3RhdHVzOiByZXNwb25zZS5zdGF0dXMsXG4gICAgICAgICAgc3RhdHVzVGV4dDogcmVzcG9uc2Uuc3RhdHVzVGV4dCxcbiAgICAgICAgICBoZWFkZXJzOiByZXNwb25zZS5oZWFkZXJzLFxuICAgICAgICB9KTtcbiAgICAgIH07XG4gICAgfSk7XG4gICAgYXdhaXQgcHJvZ3JhbW1hdGljU2lnbkluKHBhZ2UpO1xuICAgIGF3YWl0IHBhZ2UuZ290byhgJHtEQVNIQk9BUkRfUEFUSH1haWApO1xuXG4gICAgY29uc3Qgc3RyZWFtUmVxdWVzdHM6IEFycmF5PFJlY29yZDxzdHJpbmcsIHVua25vd24+PiA9IFtdO1xuICAgIHBhZ2Uub24oXCJyZXF1ZXN0XCIsIChyZXF1ZXN0KSA9PiB7XG4gICAgICBpZiAoXG4gICAgICAgIHJlcXVlc3QudXJsKCkuaW5jbHVkZXMoXCIvYXBpL2FpL2NoYXQvc3RyZWFtXCIpICYmXG4gICAgICAgIHJlcXVlc3QubWV0aG9kKCkgPT09IFwiUE9TVFwiXG4gICAgICApIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBzdHJlYW1SZXF1ZXN0cy5wdXNoKFxuICAgICAgICAgICAgcmVxdWVzdC5wb3N0RGF0YUpTT04oKSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPixcbiAgICAgICAgICApO1xuICAgICAgICB9IGNhdGNoIHtcbiAgICAgICAgICAvLyBJZ25vcmUgcmVxdWVzdHMgd2l0aG91dCBhIEpTT04gYm9keTsgdGhlIGFzc2VydGlvbnMgYmVsb3cgcmVxdWlyZVxuICAgICAgICAgIC8vIGJvdGggam91cm5leSByZXF1ZXN0cyB0byBoYXZlIGEgdmFsaWQgcmVxdWVzdCBlbnZlbG9wZS5cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0pO1xuXG4gICAgY29uc3QgY29tcG9zZXIgPSBwYWdlLmxvY2F0b3IoXCJ0ZXh0YXJlYVwiKS5maXJzdCgpO1xuICAgIGF3YWl0IGNvbXBvc2VyLmZpbGwocmVjb3ZlcnkuZml4dHVyZS5xdWVzdGlvbik7XG4gICAgYXdhaXQgY29tcG9zZXIubG9jYXRvcihcInhwYXRoPS4uXCIpLmdldEJ5Um9sZShcImJ1dHRvblwiKS5jbGljaygpO1xuXG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXG4gICAgICAgIFwiRXhlY3V0aW9uIHBhdXNlZCDigJQgcmVhZHkgdG8gcmVzdW1lIGZyb20gaXRzIGR1cmFibGUgY2hlY2twb2ludFwiLFxuICAgICAgICB7XG4gICAgICAgICAgZXhhY3Q6IHRydWUsXG4gICAgICAgIH0sXG4gICAgICApLFxuICAgICkudG9CZVZpc2libGUoKTtcblxuICAgIGNvbnN0IHN0b3JhZ2VLZXkgPVxuICAgICAgXCJlb3NfYWlfZXhlY3V0aW9uX2UyZS1wcm9qZWN0X2UyZS1pbnRlcnJ1cHRlZC1yZXN1bWUtc2Vzc2lvblwiO1xuICAgIGNvbnN0IHBvaW50ZXJLZXkgPSBcImVvc19haV9leGVjdXRpb25fY3VycmVudF9lMmUtcHJvamVjdFwiO1xuICAgIGF3YWl0IGV4cGVjdFxuICAgICAgLnBvbGwoKCkgPT4gcGFnZS5ldmFsdWF0ZSgoa2V5KSA9PiBsb2NhbFN0b3JhZ2UuZ2V0SXRlbShrZXkpLCBzdG9yYWdlS2V5KSlcbiAgICAgIC50b0NvbnRhaW4ocmVjb3ZlcnkuaW5pdGlhbFRva2VuKTtcblxuICAgIGF3YWl0IHBhZ2UuZXZhbHVhdGUoXG4gICAgICAoeyBzdG9yYWdlS2V5LCBwb2ludGVyS2V5IH0pID0+IHtcbiAgICAgICAgY29uc3Qgc2F2ZWQgPSBKU09OLnBhcnNlKGxvY2FsU3RvcmFnZS5nZXRJdGVtKHN0b3JhZ2VLZXkpID8/IFwie31cIik7XG4gICAgICAgIGRlbGV0ZSBzYXZlZC5yZXN1bWVUb2tlbjtcbiAgICAgICAgbG9jYWxTdG9yYWdlLnNldEl0ZW0oc3RvcmFnZUtleSwgSlNPTi5zdHJpbmdpZnkoc2F2ZWQpKTtcbiAgICAgICAgbG9jYWxTdG9yYWdlLnNldEl0ZW0ocG9pbnRlcktleSwgXCJlMmUtaW50ZXJydXB0ZWQtcmVzdW1lLXNlc3Npb25cIik7XG4gICAgICB9LFxuICAgICAgeyBzdG9yYWdlS2V5LCBwb2ludGVyS2V5IH0sXG4gICAgKTtcbiAgICBhd2FpdCBwYWdlLnJlbG9hZCgpO1xuXG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXCJBIHNhdmVkIEFJIGV4ZWN1dGlvbiBpcyByZWFkeSB0byByZXN1bWVcIiwge1xuICAgICAgICBleGFjdDogdHJ1ZSxcbiAgICAgIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3RcbiAgICAgIC5wb2xsKCgpID0+XG4gICAgICAgIHBhZ2UuZXZhbHVhdGUoKGtleSkgPT4ge1xuICAgICAgICAgIGNvbnN0IHNhdmVkID0gSlNPTi5wYXJzZShsb2NhbFN0b3JhZ2UuZ2V0SXRlbShrZXkpID8/IFwie31cIik7XG4gICAgICAgICAgcmV0dXJuIHNhdmVkLnJlc3VtZVRva2VuO1xuICAgICAgICB9LCBzdG9yYWdlS2V5KSxcbiAgICAgIClcbiAgICAgIC50b0JlKHJlY292ZXJ5LnJlY292ZXJlZFRva2VuKTtcblxuICAgIGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJSZXN1bWVcIiwgZXhhY3Q6IHRydWUgfSkuY2xpY2soKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChyZWNvdmVyeS5maXh0dXJlLmFuc3dlciwgeyBleGFjdDogdHJ1ZSB9KSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0LnBvbGwoKCkgPT4gc3RyZWFtUmVxdWVzdHMubGVuZ3RoKS50b0JlKDIpO1xuICAgIGV4cGVjdChzdHJlYW1SZXF1ZXN0c1swXSkudG9FcXVhbChcbiAgICAgIGV4cGVjdC5vYmplY3RDb250YWluaW5nKHtcbiAgICAgICAgcHJvamVjdElkOiBcImUyZS1wcm9qZWN0XCIsXG4gICAgICAgIG1lc3NhZ2U6IHJlY292ZXJ5LmZpeHR1cmUucXVlc3Rpb24sXG4gICAgICB9KSxcbiAgICApO1xuICAgIGV4cGVjdChzdHJlYW1SZXF1ZXN0c1swXT8uZXhlY3V0aW9uSWQpLnRvQmVVbmRlZmluZWQoKTtcbiAgICBleHBlY3Qoc3RyZWFtUmVxdWVzdHNbMF0/LnNlc3Npb25JZCkudG9CZVVuZGVmaW5lZCgpO1xuICAgIGV4cGVjdChzdHJlYW1SZXF1ZXN0c1sxXSkudG9FcXVhbChcbiAgICAgIGV4cGVjdC5vYmplY3RDb250YWluaW5nKHtcbiAgICAgICAgcHJvamVjdElkOiBcImUyZS1wcm9qZWN0XCIsXG4gICAgICAgIHNlc3Npb25JZDogcmVjb3ZlcnkuZml4dHVyZS5zZXNzaW9uSWQsXG4gICAgICAgIGV4ZWN1dGlvbklkOiByZWNvdmVyeS5maXh0dXJlLmV4ZWN1dGlvbklkLFxuICAgICAgICByZXN1bWVUb2tlbjogcmVjb3ZlcnkucmVjb3ZlcmVkVG9rZW4sXG4gICAgICAgIG1lc3NhZ2U6IHJlY292ZXJ5LmZpeHR1cmUucXVlc3Rpb24sXG4gICAgICB9KSxcbiAgICApO1xuICAgIGV4cGVjdChcbiAgICAgIHN0cmVhbVJlcXVlc3RzLm1hcCgocmVxdWVzdCkgPT4gcmVxdWVzdC5leGVjdXRpb25JZCkuZmlsdGVyKEJvb2xlYW4pLFxuICAgICkudG9FcXVhbChbcmVjb3ZlcnkuZml4dHVyZS5leGVjdXRpb25JZF0pO1xuICB9KTtcblxuICB0ZXN0KFwicHJvamVjdHMgZGVsaXZlcnkgcmVjb3Zlcnkgc3RhdGVzIHNhZmVseSBhZnRlciByZWxvYWRcIiwgYXN5bmMgKHtcbiAgICBwYWdlLFxuICB9KSA9PiB7XG4gICAgY29uc3QgcmVjb3ZlcnkgPSB7XG4gICAgICByZXF1ZXN0czogW10gYXMgc3RyaW5nW10sXG4gICAgICBvcGVyYXRpb25zOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBwcm9wb3NhbElkOiBcImUyZS1yZWNvdmVyeS1hdmFpbGFibGUtcHJvcG9zYWxcIixcbiAgICAgICAgICBvcGVyYXRpb25JZDogXCJlMmUtcmVjb3ZlcnktYXZhaWxhYmxlLW9wZXJhdGlvblwiLFxuICAgICAgICAgIHNlc3Npb25JZDogXCJlMmUtcmVjb3ZlcnktYXZhaWxhYmxlLXNlc3Npb25cIixcbiAgICAgICAgICBsaWZlY3ljbGU6IFwiYmxvY2tlZFwiLFxuICAgICAgICAgIHN0YXR1czogXCJwZW5kaW5nXCIsXG4gICAgICAgICAgY3JlYXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDM6MDAuMDAwWlwiLFxuICAgICAgICAgIHJlY292ZXJ5U3RhdGU6IFwicmVjb3ZlcmFibGVcIixcbiAgICAgICAgICBvcGVyYXRvckV4cGxhbmF0aW9uOlxuICAgICAgICAgICAgXCJUaGUgZGVsaXZlcnkgc3RvcHBlZCBiZWNhdXNlIHZhbGlkYXRpb24gbmVlZHMgdG8gYmUgcnVuIGFnYWluLlwiLFxuICAgICAgICAgIG5leHRBY3Rpb246XG4gICAgICAgICAgICBcIlJlc3VtZSB2YWxpZGF0aW9uIHRvIHJlLWNoZWNrIHRoZSBzYXZlZCBjaGFuZ2VzLCBvciBkaXNjYXJkIHRoaXMgcmVjb3ZlcnkgaWYgaXQgaXMgbm8gbG9uZ2VyIG5lZWRlZC5cIixcbiAgICAgICAgICBjb25mbGljdFJlYXNvbjogbnVsbCxcbiAgICAgICAgICB2YWxpZGF0aW9uRXZpZGVuY2U6IFt7IHByb2ZpbGU6IFwid29ya3NwYWNlLXR5cGVjaGVja1wiLCBzdGF0dXM6IFwiZmFpbGVkXCIgfV0sXG4gICAgICAgICAgd29ya3NwYWNlQXZhaWxhYmxlOiB0cnVlLFxuICAgICAgICAgIGNoYW5nZUNvdW50OiAyLFxuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgcHJvcG9zYWxJZDogXCJlMmUtcmVjb3ZlcnktbWlzc2luZy1wcm9wb3NhbFwiLFxuICAgICAgICAgIG9wZXJhdGlvbklkOiBcImUyZS1yZWNvdmVyeS1taXNzaW5nLW9wZXJhdGlvblwiLFxuICAgICAgICAgIHNlc3Npb25JZDogXCJlMmUtcmVjb3ZlcnktbWlzc2luZy1zZXNzaW9uXCIsXG4gICAgICAgICAgbGlmZWN5Y2xlOiBcImFiYW5kb25lZFwiLFxuICAgICAgICAgIHN0YXR1czogXCJwZW5kaW5nXCIsXG4gICAgICAgICAgY3JlYXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDI6MDAuMDAwWlwiLFxuICAgICAgICAgIHJlY292ZXJ5U3RhdGU6IFwibWlzc2luZ193b3Jrc3BhY2VcIixcbiAgICAgICAgICBvcGVyYXRvckV4cGxhbmF0aW9uOlxuICAgICAgICAgICAgXCJUaGUgc2F2ZWQgZGVsaXZlcnkgd29ya3NwYWNlIGlzIG5vIGxvbmdlciBhdmFpbGFibGUsIHNvIHJlY292ZXJ5IGNhbm5vdCBjb250aW51ZS5cIixcbiAgICAgICAgICBuZXh0QWN0aW9uOlxuICAgICAgICAgICAgXCJTdGFydCBhIG5ldyBkZWxpdmVyeSBmcm9tIHRoZSBjdXJyZW50IHByb2plY3QgcmF0aGVyIHRoYW4gcmV0cnlpbmcgdGhpcyByZWNvdmVyeS5cIixcbiAgICAgICAgICBjb25mbGljdFJlYXNvbjogXCJXb3Jrc3BhY2UgZXhwaXJlZCBhZnRlciB0aGUgcnVubmVyIHdhcyByZWN5Y2xlZC5cIixcbiAgICAgICAgICB2YWxpZGF0aW9uRXZpZGVuY2U6IG51bGwsXG4gICAgICAgICAgd29ya3NwYWNlQXZhaWxhYmxlOiBmYWxzZSxcbiAgICAgICAgICBjaGFuZ2VDb3VudDogMSxcbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgIHByb3Bvc2FsSWQ6IFwiZTJlLXJlY292ZXJ5LWRpc2NhcmRlZC1wcm9wb3NhbFwiLFxuICAgICAgICAgIG9wZXJhdGlvbklkOiBcImUyZS1yZWNvdmVyeS1kaXNjYXJkZWQtb3BlcmF0aW9uXCIsXG4gICAgICAgICAgc2Vzc2lvbklkOiBcImUyZS1yZWNvdmVyeS1kaXNjYXJkZWQtc2Vzc2lvblwiLFxuICAgICAgICAgIGxpZmVjeWNsZTogXCJjYW5jZWxsZWRcIixcbiAgICAgICAgICBzdGF0dXM6IFwicmVqZWN0ZWRcIixcbiAgICAgICAgICBjcmVhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMTowMC4wMDBaXCIsXG4gICAgICAgICAgcmVjb3ZlcnlTdGF0ZTogXCJkaXNjYXJkZWRcIixcbiAgICAgICAgICBvcGVyYXRvckV4cGxhbmF0aW9uOiBcIlRoaXMgZGVsaXZlcnkgcmVjb3Zlcnkgd2FzIGFscmVhZHkgZGlzY2FyZGVkLlwiLFxuICAgICAgICAgIG5leHRBY3Rpb246IFwiTm8gYWN0aW9uIGlzIHJlcXVpcmVkLlwiLFxuICAgICAgICAgIGNvbmZsaWN0UmVhc29uOiBcIkludGVybmFsIGRpYWdub3N0aWM6IHNob3VsZCBuZXZlciBiZSByZW5kZXJlZFwiLFxuICAgICAgICAgIHZhbGlkYXRpb25FdmlkZW5jZTogbnVsbCxcbiAgICAgICAgICB3b3Jrc3BhY2VBdmFpbGFibGU6IGZhbHNlLFxuICAgICAgICAgIGNoYW5nZUNvdW50OiAzLFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICB9O1xuICAgIGF3YWl0IGluc3RhbGxBcGlGaXh0dXJlcyhwYWdlLCB7IGRlbGl2ZXJ5UmVjb3Zlcnk6IHJlY292ZXJ5IH0pO1xuICAgIGF3YWl0IHByb2dyYW1tYXRpY1NpZ25JbihwYWdlKTtcbiAgICBhd2FpdCBwYWdlLmdvdG8oYCR7REFTSEJPQVJEX1BBVEh9YWlgKTtcblxuICAgIGNvbnN0IHJlZ2lvbiA9IHBhZ2UuZ2V0QnlSb2xlKFwicmVnaW9uXCIsIHtcbiAgICAgIG5hbWU6IFwiUmVjb3ZlcmFibGUgZGVsaXZlcnkgb3BlcmF0aW9uc1wiLFxuICAgIH0pO1xuICAgIGF3YWl0IGV4cGVjdChyZWdpb24pLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KHJlZ2lvbi5nZXRCeVRleHQoXCJSZWNvdmVyYWJsZVwiLCB7IGV4YWN0OiB0cnVlIH0pKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHJlZ2lvbi5nZXRCeVRleHQoXCJXb3Jrc3BhY2UgdW5hdmFpbGFibGVcIiwgeyBleGFjdDogdHJ1ZSB9KSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcmVnaW9uLmdldEJ5VGV4dChcIkFscmVhZHkgZGlzY2FyZGVkXCIsIHsgZXhhY3Q6IHRydWUgfSksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHJlZ2lvbi5nZXRCeVRleHQoXG4gICAgICAgIFwiVGhlIHNhdmVkIGRlbGl2ZXJ5IHdvcmtzcGFjZSBpcyBubyBsb25nZXIgYXZhaWxhYmxlLCBzbyByZWNvdmVyeSBjYW5ub3QgY29udGludWUuXCIsXG4gICAgICAgIHsgZXhhY3Q6IHRydWUgfSxcbiAgICAgICksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHJlZ2lvbi5nZXRCeVRleHQoXCJUaGlzIGRlbGl2ZXJ5IHJlY292ZXJ5IHdhcyBhbHJlYWR5IGRpc2NhcmRlZC5cIiwge1xuICAgICAgICBleGFjdDogdHJ1ZSxcbiAgICAgIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICByZWdpb24uZ2V0QnlUZXh0KFxuICAgICAgICBcIlJldGFpbmVkIHJlYXNvbjogV29ya3NwYWNlIGV4cGlyZWQgYWZ0ZXIgdGhlIHJ1bm5lciB3YXMgcmVjeWNsZWQuXCIsXG4gICAgICAgIHsgZXhhY3Q6IHRydWUgfSxcbiAgICAgICksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuXG4gICAgY29uc3QgYXZhaWxhYmxlID0gcmVnaW9uLmxvY2F0b3IoXG4gICAgICAnW2RhdGEtb3BlcmF0aW9uLWlkPVwiZTJlLXJlY292ZXJ5LWF2YWlsYWJsZS1vcGVyYXRpb25cIl0nLFxuICAgICk7XG4gICAgY29uc3QgbWlzc2luZyA9IHJlZ2lvbi5sb2NhdG9yKFxuICAgICAgJ1tkYXRhLW9wZXJhdGlvbi1pZD1cImUyZS1yZWNvdmVyeS1taXNzaW5nLW9wZXJhdGlvblwiXScsXG4gICAgKTtcbiAgICBjb25zdCBkaXNjYXJkZWQgPSByZWdpb24ubG9jYXRvcihcbiAgICAgICdbZGF0YS1vcGVyYXRpb24taWQ9XCJlMmUtcmVjb3ZlcnktZGlzY2FyZGVkLW9wZXJhdGlvblwiXScsXG4gICAgKTtcbiAgICBhd2FpdCBleHBlY3QoYXZhaWxhYmxlKS50b0hhdmVBdHRyaWJ1dGUoXG4gICAgICBcImRhdGEtcmVjb3Zlcnktc3RhdGVcIixcbiAgICAgIFwicmVjb3ZlcmFibGVcIixcbiAgICApO1xuICAgIGF3YWl0IGV4cGVjdChtaXNzaW5nKS50b0hhdmVBdHRyaWJ1dGUoXG4gICAgICBcImRhdGEtcmVjb3Zlcnktc3RhdGVcIixcbiAgICAgIFwibWlzc2luZ193b3Jrc3BhY2VcIixcbiAgICApO1xuICAgIGF3YWl0IGV4cGVjdChkaXNjYXJkZWQpLnRvSGF2ZUF0dHJpYnV0ZShcbiAgICAgIFwiZGF0YS1yZWNvdmVyeS1zdGF0ZVwiLFxuICAgICAgXCJkaXNjYXJkZWRcIixcbiAgICApO1xuICAgIGF3YWl0IGV4cGVjdChhdmFpbGFibGUuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJSZXN1bWUgdmFsaWRhdGlvblwiIH0pKS50b0JlRW5hYmxlZCgpO1xuICAgIGF3YWl0IGV4cGVjdChhdmFpbGFibGUuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJEaXNjYXJkIHdvcmtzcGFjZVwiIH0pKS50b0JlRW5hYmxlZCgpO1xuICAgIGF3YWl0IGV4cGVjdChtaXNzaW5nLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiUmVzdW1lIHZhbGlkYXRpb25cIiB9KSkudG9CZURpc2FibGVkKCk7XG4gICAgYXdhaXQgZXhwZWN0KG1pc3NpbmcuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJEaXNjYXJkIHdvcmtzcGFjZVwiIH0pKS50b0JlRGlzYWJsZWQoKTtcbiAgICBhd2FpdCBleHBlY3QoZGlzY2FyZGVkLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiUmVzdW1lIHZhbGlkYXRpb25cIiB9KSkudG9CZURpc2FibGVkKCk7XG4gICAgYXdhaXQgZXhwZWN0KGRpc2NhcmRlZC5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIkRpc2NhcmQgd29ya3NwYWNlXCIgfSkpLnRvQmVEaXNhYmxlZCgpO1xuXG4gICAgY29uc3QgdmlzaWJsZVRleHQgPSBhd2FpdCBwYWdlLmxvY2F0b3IoXCJib2R5XCIpLmlubmVyVGV4dCgpO1xuICAgIGV4cGVjdCh2aXNpYmxlVGV4dCkubm90LnRvTWF0Y2goXG4gICAgICAvXFwvaG9tZVxcL3J1bm5lcnxcXC90bXBcXC98XFwvd29ya3NwYWNlXFwvfGludGVybmFsIGRpYWdub3N0aWMvaSxcbiAgICApO1xuICAgIGF3YWl0IGV4cGVjdE5vSG9yaXpvbnRhbE92ZXJmbG93KHBhZ2UpO1xuXG4gICAgYXdhaXQgcGFnZS5yZWxvYWQoKTtcbiAgICBjb25zdCByZWxvYWRlZFJlZ2lvbiA9IHBhZ2UuZ2V0QnlSb2xlKFwicmVnaW9uXCIsIHtcbiAgICAgIG5hbWU6IFwiUmVjb3ZlcmFibGUgZGVsaXZlcnkgb3BlcmF0aW9uc1wiLFxuICAgIH0pO1xuICAgIGF3YWl0IGV4cGVjdChyZWxvYWRlZFJlZ2lvbikudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICByZWxvYWRlZFJlZ2lvblxuICAgICAgICAubG9jYXRvcignW2RhdGEtb3BlcmF0aW9uLWlkPVwiZTJlLXJlY292ZXJ5LW1pc3Npbmctb3BlcmF0aW9uXCJdJylcbiAgICAgICAgLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiUmVzdW1lIHZhbGlkYXRpb25cIiB9KSxcbiAgICApLnRvQmVEaXNhYmxlZCgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHJlbG9hZGVkUmVnaW9uXG4gICAgICAgIC5sb2NhdG9yKCdbZGF0YS1vcGVyYXRpb24taWQ9XCJlMmUtcmVjb3ZlcnktZGlzY2FyZGVkLW9wZXJhdGlvblwiXScpXG4gICAgICAgIC5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIkRpc2NhcmQgd29ya3NwYWNlXCIgfSksXG4gICAgKS50b0JlRGlzYWJsZWQoKTtcbiAgICBleHBlY3QocmVjb3ZlcnkucmVxdWVzdHMubGVuZ3RoKS50b0JlR3JlYXRlclRoYW5PckVxdWFsKDIpO1xuICAgIGV4cGVjdChyZWNvdmVyeS5yZXF1ZXN0cy5ldmVyeSgodXJsKSA9PiB1cmwuaW5jbHVkZXMoXCJwcm9qZWN0SWQ9ZTJlLXByb2plY3RcIikpKS50b0JlKHRydWUpO1xuICB9KTtcblxuICB0ZXN0KFwiZXhwbGFpbnMgd2hlbiBkZWxpdmVyeSByZWNvdmVyeSBsb3NlcyBhIHJhY2UgYW5kIHJlZnJlc2hlcyBzdGF0ZVwiLCBhc3luYyAoe1xuICAgIHBhZ2UsXG4gIH0pID0+IHtcbiAgICBjb25zdCByZWNvdmVyeSA9IHtcbiAgICAgIHJlcXVlc3RzOiBbXSBhcyBzdHJpbmdbXSxcbiAgICAgIGFjdGlvblJlcXVlc3RzOiBbXSBhcyBzdHJpbmdbXSxcbiAgICAgIG9wZXJhdGlvbnM6IFtcbiAgICAgICAge1xuICAgICAgICAgIHByb3Bvc2FsSWQ6IFwiZTJlLXJlY292ZXJ5LXJhY2UtcHJvcG9zYWxcIixcbiAgICAgICAgICBvcGVyYXRpb25JZDogXCJlMmUtcmVjb3ZlcnktcmFjZS1vcGVyYXRpb25cIixcbiAgICAgICAgICBzZXNzaW9uSWQ6IFwiZTJlLXJlY292ZXJ5LXJhY2Utc2Vzc2lvblwiLFxuICAgICAgICAgIGxpZmVjeWNsZTogXCJibG9ja2VkXCIsXG4gICAgICAgICAgc3RhdHVzOiBcInBlbmRpbmdcIixcbiAgICAgICAgICBjcmVhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowNDowMC4wMDBaXCIsXG4gICAgICAgICAgcmVjb3ZlcnlTdGF0ZTogXCJyZWNvdmVyYWJsZVwiLFxuICAgICAgICAgIG9wZXJhdG9yRXhwbGFuYXRpb246XG4gICAgICAgICAgICBcIlRoZSBkZWxpdmVyeSBzdG9wcGVkIGJlY2F1c2UgdGhlIHJldGFpbmVkIGNoYW5nZXMgbmVlZCByZXZpZXcgYmVmb3JlIHZhbGlkYXRpb24gY2FuIGNvbnRpbnVlLlwiLFxuICAgICAgICAgIG5leHRBY3Rpb246XG4gICAgICAgICAgICBcIlJlc3VtZSB2YWxpZGF0aW9uIHRvIHJlLWNoZWNrIHRoZSBzYXZlZCBjaGFuZ2VzLCBvciBkaXNjYXJkIHRoaXMgcmVjb3ZlcnkgaWYgaXQgaXMgbm8gbG9uZ2VyIG5lZWRlZC5cIixcbiAgICAgICAgICBjb25mbGljdFJlYXNvbjogbnVsbCxcbiAgICAgICAgICB2YWxpZGF0aW9uRXZpZGVuY2U6IFt7IHByb2ZpbGU6IFwid29ya3NwYWNlLXR5cGVjaGVja1wiLCBzdGF0dXM6IFwiZmFpbGVkXCIgfV0sXG4gICAgICAgICAgd29ya3NwYWNlQXZhaWxhYmxlOiB0cnVlLFxuICAgICAgICAgIGNoYW5nZUNvdW50OiAxLFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICAgIHJlY292ZXJ5QWN0aW9uOiB7XG4gICAgICAgIHByb3Bvc2FsSWQ6IFwiZTJlLXJlY292ZXJ5LXJhY2UtcHJvcG9zYWxcIixcbiAgICAgICAgYWN0aW9uOiBcInJlc3VtZS12YWxpZGF0aW9uXCIgYXMgY29uc3QsXG4gICAgICAgIHJlc3BvbnNlOiB7XG4gICAgICAgICAgZXJyb3I6IFwiVGhpcyBkZWxpdmVyeSByZWNvdmVyeSB3YXMgYWxyZWFkeSBkaXNjYXJkZWQuXCIsXG4gICAgICAgICAgY29kZTogXCJERUxJVkVSWV9BTFJFQURZX0RJU0NBUkRFRFwiLFxuICAgICAgICAgIGxpZmVjeWNsZTogXCJjYW5jZWxsZWRcIixcbiAgICAgICAgICByZWNvdmVyeVN0YXRlOiBcImRpc2NhcmRlZFwiLFxuICAgICAgICAgIG5leHRBY3Rpb246IFwiTm8gYWN0aW9uIGlzIHJlcXVpcmVkLlwiLFxuICAgICAgICAgIGRpYWdub3N0aWM6IFwiRG8gbm90IHJlbmRlciB0aGlzIHNlcnZlciBkZXRhaWwuXCIsXG4gICAgICAgIH0sXG4gICAgICAgIG5leHRPcGVyYXRpb25zOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgcHJvcG9zYWxJZDogXCJlMmUtcmVjb3ZlcnktcmFjZS1wcm9wb3NhbFwiLFxuICAgICAgICAgICAgb3BlcmF0aW9uSWQ6IFwiZTJlLXJlY292ZXJ5LXJhY2Utb3BlcmF0aW9uXCIsXG4gICAgICAgICAgICBzZXNzaW9uSWQ6IFwiZTJlLXJlY292ZXJ5LXJhY2Utc2Vzc2lvblwiLFxuICAgICAgICAgICAgbGlmZWN5Y2xlOiBcImNhbmNlbGxlZFwiLFxuICAgICAgICAgICAgc3RhdHVzOiBcInJlamVjdGVkXCIsXG4gICAgICAgICAgICBjcmVhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowNDowMC4wMDBaXCIsXG4gICAgICAgICAgICByZWNvdmVyeVN0YXRlOiBcImRpc2NhcmRlZFwiLFxuICAgICAgICAgICAgb3BlcmF0b3JFeHBsYW5hdGlvbjogXCJUaGlzIGRlbGl2ZXJ5IHJlY292ZXJ5IHdhcyBhbHJlYWR5IGRpc2NhcmRlZC5cIixcbiAgICAgICAgICAgIG5leHRBY3Rpb246IFwiTm8gYWN0aW9uIGlzIHJlcXVpcmVkLlwiLFxuICAgICAgICAgICAgY29uZmxpY3RSZWFzb246IG51bGwsXG4gICAgICAgICAgICB2YWxpZGF0aW9uRXZpZGVuY2U6IG51bGwsXG4gICAgICAgICAgICB3b3Jrc3BhY2VBdmFpbGFibGU6IGZhbHNlLFxuICAgICAgICAgICAgY2hhbmdlQ291bnQ6IDEsXG4gICAgICAgICAgfSxcbiAgICAgICAgXSxcbiAgICAgIH0sXG4gICAgfTtcbiAgICBhd2FpdCBpbnN0YWxsQXBpRml4dHVyZXMocGFnZSwgeyBkZWxpdmVyeVJlY292ZXJ5OiByZWNvdmVyeSB9KTtcbiAgICBhd2FpdCBwcm9ncmFtbWF0aWNTaWduSW4ocGFnZSk7XG4gICAgYXdhaXQgcGFnZS5nb3RvKGAke0RBU0hCT0FSRF9QQVRIfWFpYCk7XG5cbiAgICBjb25zdCByZWdpb24gPSBwYWdlLmdldEJ5Um9sZShcInJlZ2lvblwiLCB7XG4gICAgICBuYW1lOiBcIlJlY292ZXJhYmxlIGRlbGl2ZXJ5IG9wZXJhdGlvbnNcIixcbiAgICB9KTtcbiAgICBjb25zdCBvcGVyYXRpb24gPSByZWdpb24ubG9jYXRvcihcbiAgICAgICdbZGF0YS1vcGVyYXRpb24taWQ9XCJlMmUtcmVjb3ZlcnktcmFjZS1vcGVyYXRpb25cIl0nLFxuICAgICk7XG4gICAgYXdhaXQgZXhwZWN0KG9wZXJhdGlvbi5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIlJlc3VtZSB2YWxpZGF0aW9uXCIgfSkpLnRvQmVFbmFibGVkKCk7XG4gICAgYXdhaXQgb3BlcmF0aW9uLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiUmVzdW1lIHZhbGlkYXRpb25cIiB9KS5jbGljaygpO1xuXG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlUZXh0KFwiUmVjb3Zlcnkgc3RhdGUgY2hhbmdlZFwiLCB7IGV4YWN0OiB0cnVlIH0pKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFxuICAgICAgICBcIlRoaXMgcmVjb3Zlcnkgd2FzIGFscmVhZHkgZGlzY2FyZGVkLiBUaGUgcmVjb3ZlcnkgbGlzdCB3YXMgcmVmcmVzaGVkLlwiLFxuICAgICAgICB7IGV4YWN0OiB0cnVlIH0sXG4gICAgICApLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3RcbiAgICAgIC5wb2xsKCgpID0+IHJlY292ZXJ5LnJlcXVlc3RzLmxlbmd0aClcbiAgICAgIC50b0JlR3JlYXRlclRoYW5PckVxdWFsKDIpO1xuICAgIGF3YWl0IGV4cGVjdChvcGVyYXRpb24pLnRvSGF2ZUF0dHJpYnV0ZShcImRhdGEtcmVjb3Zlcnktc3RhdGVcIiwgXCJkaXNjYXJkZWRcIik7XG4gICAgZXhwZWN0KHJlY292ZXJ5LmFjdGlvblJlcXVlc3RzKS50b0hhdmVMZW5ndGgoMSk7XG4gICAgZXhwZWN0KHJlY292ZXJ5LmFjdGlvblJlcXVlc3RzWzBdKS50b0NvbnRhaW4oXG4gICAgICBcIi9hcGkvYWkvZGVsaXZlcnkvZTJlLXJlY292ZXJ5LXJhY2UtcHJvcG9zYWwvcmVzdW1lLXZhbGlkYXRpb25cIixcbiAgICApO1xuICAgIGV4cGVjdChhd2FpdCByZWdpb24ubG9jYXRvcignW2RhdGEtb3BlcmF0aW9uLWlkPVwiZTJlLXJlY292ZXJ5LXJhY2Utb3BlcmF0aW9uXCJdJykuY291bnQoKSkudG9CZSgxKTtcbiAgICBjb25zdCB2aXNpYmxlVGV4dCA9IGF3YWl0IHBhZ2UubG9jYXRvcihcImJvZHlcIikuaW5uZXJUZXh0KCk7XG4gICAgZXhwZWN0KHZpc2libGVUZXh0KS5ub3QudG9NYXRjaCgvRG8gbm90IHJlbmRlciB0aGlzIHNlcnZlciBkZXRhaWx8XFwvaG9tZVxcL3J1bm5lcnxcXC90bXBcXC8vaSk7XG4gICAgYXdhaXQgZXhwZWN0Tm9Ib3Jpem9udGFsT3ZlcmZsb3cocGFnZSk7XG4gIH0pO1xuXG4gIHRlc3QoXCJleHBsYWlucyB3aGVuIGFuIG9sZCByZWNvdmVyeSBsaW5rIHBvaW50cyB0byBhIGRlbGV0ZWQgb3BlcmF0aW9uXCIsIGFzeW5jICh7XG4gICAgcGFnZSxcbiAgfSkgPT4ge1xuICAgIGNvbnN0IHJlY292ZXJ5ID0ge1xuICAgICAgcmVxdWVzdHM6IFtdIGFzIHN0cmluZ1tdLFxuICAgICAgYWN0aW9uUmVxdWVzdHM6IFtdIGFzIHN0cmluZ1tdLFxuICAgICAgb3BlcmF0aW9uczogW1xuICAgICAgICB7XG4gICAgICAgICAgcHJvcG9zYWxJZDogXCJlMmUtcmVjb3ZlcnktZGVsZXRlZC1wcm9wb3NhbFwiLFxuICAgICAgICAgIG9wZXJhdGlvbklkOiBcImUyZS1yZWNvdmVyeS1kZWxldGVkLW9wZXJhdGlvblwiLFxuICAgICAgICAgIHNlc3Npb25JZDogXCJlMmUtcmVjb3ZlcnktZGVsZXRlZC1zZXNzaW9uXCIsXG4gICAgICAgICAgbGlmZWN5Y2xlOiBcImJsb2NrZWRcIixcbiAgICAgICAgICBzdGF0dXM6IFwicGVuZGluZ1wiLFxuICAgICAgICAgIGNyZWF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjA1OjAwLjAwMFpcIixcbiAgICAgICAgICByZWNvdmVyeVN0YXRlOiBcInJlY292ZXJhYmxlXCIsXG4gICAgICAgICAgb3BlcmF0b3JFeHBsYW5hdGlvbjpcbiAgICAgICAgICAgIFwiVGhlIGRlbGl2ZXJ5IHN0b3BwZWQgYmVjYXVzZSB0aGUgcmV0YWluZWQgY2hhbmdlcyBuZWVkIHJldmlldyBiZWZvcmUgdmFsaWRhdGlvbiBjYW4gY29udGludWUuXCIsXG4gICAgICAgICAgbmV4dEFjdGlvbjpcbiAgICAgICAgICAgIFwiUmVzdW1lIHZhbGlkYXRpb24gdG8gcmUtY2hlY2sgdGhlIHNhdmVkIGNoYW5nZXMsIG9yIGRpc2NhcmQgdGhpcyByZWNvdmVyeSBpZiBpdCBpcyBubyBsb25nZXIgbmVlZGVkLlwiLFxuICAgICAgICAgIGNvbmZsaWN0UmVhc29uOiBudWxsLFxuICAgICAgICAgIHZhbGlkYXRpb25FdmlkZW5jZTogW3sgcHJvZmlsZTogXCJ3b3Jrc3BhY2UtdHlwZWNoZWNrXCIsIHN0YXR1czogXCJmYWlsZWRcIiB9XSxcbiAgICAgICAgICB3b3Jrc3BhY2VBdmFpbGFibGU6IHRydWUsXG4gICAgICAgICAgY2hhbmdlQ291bnQ6IDEsXG4gICAgICAgIH0sXG4gICAgICBdLFxuICAgICAgcmVjb3ZlcnlBY3Rpb246IHtcbiAgICAgICAgcHJvcG9zYWxJZDogXCJlMmUtcmVjb3ZlcnktZGVsZXRlZC1wcm9wb3NhbFwiLFxuICAgICAgICBhY3Rpb246IFwicmVzdW1lLXZhbGlkYXRpb25cIiBhcyBjb25zdCxcbiAgICAgICAgc3RhdHVzOiA0MDQsXG4gICAgICAgIHJlc3BvbnNlOiB7XG4gICAgICAgICAgZXJyb3I6IFwiRGVsaXZlcnkgb3BlcmF0aW9uIG5vdCBmb3VuZFwiLFxuICAgICAgICAgIGNvZGU6IFwiREVMSVZFUllfTk9UX0ZPVU5EXCIsXG4gICAgICAgICAgZGlhZ25vc3RpYzogXCJEbyBub3QgcmVuZGVyIHRoaXMgc2VydmVyIGRldGFpbC5cIixcbiAgICAgICAgfSxcbiAgICAgICAgbmV4dE9wZXJhdGlvbnM6IFtdLFxuICAgICAgfSxcbiAgICB9O1xuICAgIGF3YWl0IGluc3RhbGxBcGlGaXh0dXJlcyhwYWdlLCB7IGRlbGl2ZXJ5UmVjb3Zlcnk6IHJlY292ZXJ5IH0pO1xuICAgIGF3YWl0IHByb2dyYW1tYXRpY1NpZ25JbihwYWdlKTtcbiAgICBhd2FpdCBwYWdlLmdvdG8oYCR7REFTSEJPQVJEX1BBVEh9YWlgKTtcblxuICAgIGNvbnN0IHJlZ2lvbiA9IHBhZ2UuZ2V0QnlSb2xlKFwicmVnaW9uXCIsIHtcbiAgICAgIG5hbWU6IFwiUmVjb3ZlcmFibGUgZGVsaXZlcnkgb3BlcmF0aW9uc1wiLFxuICAgIH0pO1xuICAgIGNvbnN0IG9wZXJhdGlvbiA9IHJlZ2lvbi5sb2NhdG9yKFxuICAgICAgJ1tkYXRhLW9wZXJhdGlvbi1pZD1cImUyZS1yZWNvdmVyeS1kZWxldGVkLW9wZXJhdGlvblwiXScsXG4gICAgKTtcbiAgICBhd2FpdCBleHBlY3Qob3BlcmF0aW9uLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiUmVzdW1lIHZhbGlkYXRpb25cIiB9KSkudG9CZUVuYWJsZWQoKTtcbiAgICBhd2FpdCBvcGVyYXRpb24uZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJSZXN1bWUgdmFsaWRhdGlvblwiIH0pLmNsaWNrKCk7XG5cbiAgICBhd2FpdCBleHBlY3QocGFnZS5nZXRCeVRleHQoXCJSZWNvdmVyeSBsaW5rIGV4cGlyZWRcIiwgeyBleGFjdDogdHJ1ZSB9KSkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcbiAgICAgICAgXCJUaGlzIHJlY292ZXJ5IG9wZXJhdGlvbiBubyBsb25nZXIgZXhpc3RzLiBUaGUgcmVjb3ZlcnkgbGlzdCB3YXMgcmVmcmVzaGVkLlwiLFxuICAgICAgICB7IGV4YWN0OiB0cnVlIH0sXG4gICAgICApLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QucG9sbCgoKSA9PiByZWNvdmVyeS5yZXF1ZXN0cy5sZW5ndGgpLnRvQmVHcmVhdGVyVGhhbk9yRXF1YWwoMik7XG4gICAgYXdhaXQgZXhwZWN0LnBvbGwoKCkgPT4gcmVnaW9uLmNvdW50KCkpLnRvQmUoMCk7XG4gICAgZXhwZWN0KHJlY292ZXJ5LmFjdGlvblJlcXVlc3RzKS50b0hhdmVMZW5ndGgoMSk7XG4gICAgZXhwZWN0KHJlY292ZXJ5LmFjdGlvblJlcXVlc3RzWzBdKS50b0NvbnRhaW4oXG4gICAgICBcIi9hcGkvYWkvZGVsaXZlcnkvZTJlLXJlY292ZXJ5LWRlbGV0ZWQtcHJvcG9zYWwvcmVzdW1lLXZhbGlkYXRpb25cIixcbiAgICApO1xuICAgIGNvbnN0IHZpc2libGVUZXh0ID0gYXdhaXQgcGFnZS5sb2NhdG9yKFwiYm9keVwiKS5pbm5lclRleHQoKTtcbiAgICBleHBlY3QodmlzaWJsZVRleHQpLm5vdC50b01hdGNoKFxuICAgICAgL0RlbGl2ZXJ5IG9wZXJhdGlvbiBub3QgZm91bmR8RG8gbm90IHJlbmRlciB0aGlzIHNlcnZlciBkZXRhaWx8XFwvaG9tZVxcL3J1bm5lcnxcXC90bXBcXC8vaSxcbiAgICApO1xuICAgIGF3YWl0IGV4cGVjdE5vSG9yaXpvbnRhbE92ZXJmbG93KHBhZ2UpO1xuICB9KTtcblxuICB0ZXN0KFwia2VlcHMgdGhlIHJlc3VtZWQgQUkgc2Vzc2lvbiBkcmF3ZXIgb3ZlcmxhaWQgb24gYSBwaG9uZSB2aWV3cG9ydFwiLCBhc3luYyAoe1xuICAgIHBhZ2UsXG4gIH0pID0+IHtcbiAgICBhd2FpdCBwYWdlLnNldFZpZXdwb3J0U2l6ZSh7IHdpZHRoOiAzOTAsIGhlaWdodDogODQ0IH0pO1xuICAgIGNvbnN0IGZpeHR1cmUgPSBhd2FpdCBpbnN0YWxsQXJhYmljQWlGaXh0dXJlKHBhZ2UpO1xuICAgIGF3YWl0IGluc3RhbGxBcGlGaXh0dXJlcyhwYWdlLCB7IGFyYWJpY0FpOiBmaXh0dXJlIH0pO1xuICAgIGF3YWl0IHByb2dyYW1tYXRpY1NpZ25JbihwYWdlKTtcbiAgICBhd2FpdCBwYWdlLmdvdG8oYCR7REFTSEJPQVJEX1BBVEh9YWlgKTtcblxuICAgIGNvbnN0IGNvbXBvc2VyID0gcGFnZS5sb2NhdG9yKFwidGV4dGFyZWFcIikuZmlyc3QoKTtcbiAgICBhd2FpdCBleHBlY3QoY29tcG9zZXIpLnRvQmVWaXNpYmxlKCk7XG4gICAgY29uc3QgYmVmb3JlT3BlbiA9IGF3YWl0IGNvbXBvc2VyLmJvdW5kaW5nQm94KCk7XG4gICAgZXhwZWN0KGJlZm9yZU9wZW4/LndpZHRoKS50b0JlR3JlYXRlclRoYW4oMjUwKTtcblxuICAgIGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJPcGVuIHNlc3Npb25zXCIgfSkuY2xpY2soKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5nZXRCeVRleHQoXCJTZXNzaW9uc1wiLCB7IGV4YWN0OiB0cnVlIH0pKS50b0JlVmlzaWJsZSgpO1xuICAgIGNvbnN0IGRyYXdlciA9IHBhZ2VcbiAgICAgIC5nZXRCeVRleHQoXCJTZXNzaW9uc1wiLCB7IGV4YWN0OiB0cnVlIH0pXG4gICAgICAubG9jYXRvcihcIi4uXCIpXG4gICAgICAubG9jYXRvcihcIi4uXCIpO1xuICAgIGNvbnN0IGRyYXdlckJveCA9IGF3YWl0IGRyYXdlci5ib3VuZGluZ0JveCgpO1xuICAgIGV4cGVjdChkcmF3ZXJCb3g/LndpZHRoKS50b0JlTGVzc1RoYW5PckVxdWFsKDM5MCk7XG4gICAgY29uc3QgZHVyaW5nT3BlbiA9IGF3YWl0IGNvbXBvc2VyLmJvdW5kaW5nQm94KCk7XG4gICAgZXhwZWN0KGR1cmluZ09wZW4/LndpZHRoKS50b0JlR3JlYXRlclRoYW4oMjUwKTtcblxuICAgIGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJDbG9zZSBzaWRlYmFyXCIgfSkuY2xpY2soKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiT3BlbiBzZXNzaW9uc1wiIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3ROb0hvcml6b250YWxPdmVyZmxvdyhwYWdlKTtcbiAgfSk7XG5cbiAgdGVzdChcImtlZXBzIGFsbCBwcm92aWRlciBjYXJkcyBhbmQgY29udHJvbHMgcmVhY2hhYmxlIGF0IG5hcnJvdyBwaG9uZSB3aWR0aHNcIiwgYXN5bmMgKHtcbiAgICBwYWdlLFxuICB9KSA9PiB7XG4gICAgY29uc3QgZml4dHVyZSA9IGF3YWl0IGluc3RhbGxBcmFiaWNBaUZpeHR1cmUocGFnZSk7XG4gICAgYXdhaXQgaW5zdGFsbEFwaUZpeHR1cmVzKHBhZ2UsIHsgYXJhYmljQWk6IGZpeHR1cmUgfSk7XG4gICAgYXdhaXQgcHJvZ3JhbW1hdGljU2lnbkluKHBhZ2UpO1xuXG4gICAgZm9yIChjb25zdCB3aWR0aCBvZiBbMzIwLCAzOTBdKSB7XG4gICAgICBjb25zdCB2aWV3cG9ydCA9IHsgd2lkdGgsIGhlaWdodDogODQ0IH07XG4gICAgICBhd2FpdCBwYWdlLnNldFZpZXdwb3J0U2l6ZSh2aWV3cG9ydCk7XG4gICAgICBhd2FpdCBwYWdlLmdvdG8oYCR7REFTSEJPQVJEX1BBVEh9YWlgKTtcblxuICAgICAgY29uc3QgY29tcG9zZXIgPSBwYWdlLmxvY2F0b3IoXCJ0ZXh0YXJlYVwiKS5maXJzdCgpO1xuICAgICAgYXdhaXQgZXhwZWN0KGNvbXBvc2VyKS50b0JlVmlzaWJsZSgpO1xuICAgICAgYXdhaXQgZXhwZWN0V2l0aGluVmlld3BvcnQoY29tcG9zZXIsIHZpZXdwb3J0LCBgY29tcG9zZXIgYXQgJHt3aWR0aH1weGApO1xuXG4gICAgICBhd2FpdCBwYWdlLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiT3BlbiBzZXNzaW9uc1wiIH0pLmNsaWNrKCk7XG4gICAgICBjb25zdCBkcmF3ZXIgPSBwYWdlLmdldEJ5VGVzdElkKFwic2Vzc2lvbnMtZHJhd2VyXCIpO1xuICAgICAgYXdhaXQgZXhwZWN0KGRyYXdlcikudG9CZVZpc2libGUoKTtcbiAgICAgIGF3YWl0IGV4cGVjdFdpdGhpblZpZXdwb3J0KGRyYXdlciwgdmlld3BvcnQsIGBzZXNzaW9ucyBkcmF3ZXIgYXQgJHt3aWR0aH1weGApO1xuICAgICAgYXdhaXQgZXhwZWN0Tm9Ib3Jpem9udGFsT3ZlcmZsb3cocGFnZSk7XG5cbiAgICAgIGNvbnN0IHByb3ZpZGVyQ2FyZHMgPSBkcmF3ZXIubG9jYXRvcihcIi5wcm92aWRlci1rZXktY2FyZFwiKTtcbiAgICAgIGF3YWl0IGV4cGVjdChwcm92aWRlckNhcmRzKS50b0hhdmVDb3VudCg0KTtcbiAgICAgIGZvciAoY29uc3QgcHJvdmlkZXIgb2YgW1wiT3BlblJvdXRlclwiLCBcIkdlbWluaVwiLCBcIkRlZXBTZWVrXCIsIFwiR3JvcVwiXSkge1xuICAgICAgICBjb25zdCBjYXJkID0gcHJvdmlkZXJDYXJkcy5maWx0ZXIoe1xuICAgICAgICAgIGhhc1RleHQ6IGAke3Byb3ZpZGVyfSBBUEkgS2V5YCxcbiAgICAgICAgfSk7XG4gICAgICAgIGF3YWl0IGV4cGVjdChjYXJkKS50b0hhdmVDb3VudCgxKTtcbiAgICAgICAgYXdhaXQgY2FyZC5zY3JvbGxJbnRvVmlld0lmTmVlZGVkKCk7XG4gICAgICAgIGF3YWl0IGV4cGVjdChjYXJkKS50b0JlVmlzaWJsZSgpO1xuXG4gICAgICAgIGNvbnN0IGlucHV0ID0gY2FyZC5sb2NhdG9yKCdpbnB1dFt0eXBlPVwicGFzc3dvcmRcIl0nKTtcbiAgICAgICAgY29uc3Qgc2F2ZSA9IGNhcmQuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJTYXZlXCIsIGV4YWN0OiB0cnVlIH0pO1xuICAgICAgICBhd2FpdCBleHBlY3QoaW5wdXQpLnRvQmVWaXNpYmxlKCk7XG4gICAgICAgIGF3YWl0IGV4cGVjdChzYXZlKS50b0JlVmlzaWJsZSgpO1xuICAgICAgICBhd2FpdCBpbnB1dC5zY3JvbGxJbnRvVmlld0lmTmVlZGVkKCk7XG4gICAgICAgIGF3YWl0IHNhdmUuc2Nyb2xsSW50b1ZpZXdJZk5lZWRlZCgpO1xuICAgICAgICBhd2FpdCBleHBlY3RXaXRoaW5WaWV3cG9ydChcbiAgICAgICAgICBpbnB1dCxcbiAgICAgICAgICB2aWV3cG9ydCxcbiAgICAgICAgICBgJHtwcm92aWRlcn0ga2V5IGlucHV0IGF0ICR7d2lkdGh9cHhgLFxuICAgICAgICApO1xuICAgICAgICBhd2FpdCBleHBlY3RXaXRoaW5WaWV3cG9ydChcbiAgICAgICAgICBzYXZlLFxuICAgICAgICAgIHZpZXdwb3J0LFxuICAgICAgICAgIGAke3Byb3ZpZGVyfSBTYXZlIGNvbnRyb2wgYXQgJHt3aWR0aH1weGAsXG4gICAgICAgICk7XG4gICAgICB9XG5cbiAgICAgIGF3YWl0IGV4cGVjdFdpdGhpblZpZXdwb3J0KGNvbXBvc2VyLCB2aWV3cG9ydCwgYGNvbXBvc2VyIHdpdGggZHJhd2VyIGF0ICR7d2lkdGh9cHhgKTtcbiAgICAgIGF3YWl0IGV4cGVjdE5vSG9yaXpvbnRhbE92ZXJmbG93KHBhZ2UpO1xuICAgICAgYXdhaXQgcGFnZS5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIkNsb3NlIHNpZGViYXJcIiB9KS5jbGljaygpO1xuICAgICAgYXdhaXQgZXhwZWN0KGRyYXdlcikudG9CZUhpZGRlbigpO1xuICAgIH1cbiAgfSk7XG5cbiAgdGVzdChcInJlbmRlcnMgYSB1c2VyLXZpc2libGUgQVBJIGZhaWx1cmUgc3RhdGVcIiwgYXN5bmMgKHsgcGFnZSB9KSA9PiB7XG4gICAgYXdhaXQgaW5zdGFsbEFwaUZpeHR1cmVzKHBhZ2UpO1xuICAgIGF3YWl0IHByb2dyYW1tYXRpY1NpZ25JbihwYWdlKTtcbiAgICBhd2FpdCBwYWdlLnJvdXRlKFwiKiovYXBpL2Rhc2hib2FyZFwiLCAocm91dGUpID0+XG4gICAgICByb3V0ZS5mdWxmaWxsKFxuICAgICAgICBqc29uUmVzcG9uc2UoeyBlcnJvcjogXCJjb250cm9sbGVkIGRhc2hib2FyZCBvdXRhZ2VcIiB9LCA1MDMpLFxuICAgICAgKSxcbiAgICApO1xuICAgIGF3YWl0IHBhZ2UucmVsb2FkKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVJvbGUoXCJoZWFkaW5nXCIsIHsgbmFtZTogXCJGYWlsZWQgdG8gbG9hZCBkYXNoYm9hcmRcIiB9KSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIlJldHJ5IENvbm5lY3Rp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