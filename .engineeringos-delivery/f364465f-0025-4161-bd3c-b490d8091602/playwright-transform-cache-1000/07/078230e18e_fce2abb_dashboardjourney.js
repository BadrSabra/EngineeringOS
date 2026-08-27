// 693b2bb09d2514082033fd89ce789196b2c61676
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
function approvedDashboardOrigins() {
  var _process$env$DASHBOAR4;
  const origins = ((_process$env$DASHBOAR4 = process.env.DASHBOARD_E2E_APPROVED_ORIGINS) !== null && _process$env$DASHBOAR4 !== void 0 ? _process$env$DASHBOAR4 : "").split(",").map(origin => origin.trim()).filter(Boolean);
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
    return;
  }
  const signInUrl = await helper({
    ...TEST_USER,
    ttl: 900,
    basePath: DASHBOARD_PATH
  });
  await page.goto(signInUrl);
  await expect(page).toHaveURL(new RegExp(`${DASHBOARD_PATH.replaceAll("/", "\\/")}$`));
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
    var _execution$operationI, _execution$flightStat, _gitLog$commits$0$sho, _gitLog$commits, _gitLog$commits2, _process$env$DASHBOAR5;
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
    const outputPath = (_process$env$DASHBOAR5 = process.env.DASHBOARD_E2E_LIVE_REPORT_PATH) !== null && _process$env$DASHBOAR5 !== void 0 ? _process$env$DASHBOAR5 : "test-results/dashboard-journey/live-mission-correlation.json";
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
    var _process$env$DASHBOAR6;
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
    }, (_process$env$DASHBOAR6 = process.env.DASHBOARD_E2E_API_BASE_URL) !== null && _process$env$DASHBOAR6 !== void 0 ? _process$env$DASHBOAR6 : page.url());
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
    await page.route("**/api/dashboard", route => route.fulfill(jsonResponse({
      error: "controlled dashboard outage"
    }, 503)));
    await programmaticSignIn(page);
    await expect(page.getByRole("heading", {
      name: "Failed to load dashboard"
    })).toBeVisible();
    await expect(page.getByRole("button", {
      name: "Retry Connection"
    })).toBeVisible();
  });
});
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJleHBlY3QiLCJ0ZXN0IiwibWtkaXIiLCJ3cml0ZUZpbGUiLCJkaXJuYW1lIiwicGFyc2VDbGVya1NpZ25JblRva2VuUmVzcG9uc2UiLCJwYXJzZUNsZXJrVXNlckxvb2t1cFJlc3BvbnNlIiwicGFyc2VDcmVhdGVkQ2xlcmtVc2VyUmVzcG9uc2UiLCJEQVNIQk9BUkRfUEFUSCIsIlRFU1RfVVNFUiIsImZpcnN0TmFtZSIsImxhc3ROYW1lIiwiZW1haWwiLCJfcHJvY2VzcyRlbnYkREFTSEJPQVIiLCJwcm9jZXNzIiwiZW52IiwiREFTSEJPQVJEX0UyRV9FTUFJTCIsIkVYRUNVVElPTl9JRCIsIkRFRkFVTFRfTElWRV9USU1FT1VUX01TIiwiTElWRV9URVNUX1RJTUVPVVRfTUFSR0lOX01TIiwiSE9TVElMRV9PUklHSU4iLCJPUklHSU5fRElBR05PU1RJQ19IRUFERVJTIiwiREVGQVVMVF9MSVZFX1BST01QVCIsIkxJVkVfQ0FNUEFJR05fU0NFTkFSSU9TIiwiU2V0IiwibGl2ZUNhbXBhaWduU2NlbmFyaW8iLCJfcHJvY2VzcyRlbnYkREFTSEJPQVIyIiwic2NlbmFyaW8iLCJEQVNIQk9BUkRfRTJFX0xJVkVfU0NFTkFSSU8iLCJ0cmltIiwiREFTSEJPQVJEX0UyRV9MSVZFX0NBTVBBSUdOIiwiRXJyb3IiLCJoYXMiLCJsaXZlUHJvbXB0IiwiX3Byb2Nlc3MkZW52JERBU0hCT0FSMyIsIkRBU0hCT0FSRF9FMkVfTElWRV9QUk9NUFQiLCJsaXZlVGltZW91dE1zIiwiY29uZmlndXJlZCIsIk51bWJlciIsIkRBU0hCT0FSRF9FMkVfTElWRV9USU1FT1VUX01TIiwiaXNGaW5pdGUiLCJhcHByb3ZlZERhc2hib2FyZE9yaWdpbnMiLCJfcHJvY2VzcyRlbnYkREFTSEJPQVI0Iiwib3JpZ2lucyIsIkRBU0hCT0FSRF9FMkVfQVBQUk9WRURfT1JJR0lOUyIsInNwbGl0IiwibWFwIiwib3JpZ2luIiwiZmlsdGVyIiwiQm9vbGVhbiIsImxlbmd0aCIsInBhcnNlZCIsIlVSTCIsInBhdGhuYW1lIiwic2VhcmNoIiwiaGFzaCIsImRhc2hib2FyZEZpeHR1cmUiLCJmcmVzaG5lc3NSZXZpc2lvbiIsInByb2plY3RDb3VudCIsImFjdGl2ZVRhc2tDb3VudCIsImNvbXBsZXRlZFRhc2tDb3VudCIsImZhaWxlZFRhc2tDb3VudCIsInRhc2tTdGF0dXNCcmVha2Rvd24iLCJwZW5kaW5nIiwicnVubmluZyIsInByb2plY3RTY29yZXMiLCJwcm9qZWN0SWQiLCJwcm9qZWN0TmFtZSIsInNjb3JlIiwidHJlbmQiLCJyZWNlbnRFdmVudHMiLCJpZCIsInR5cGUiLCJzZXZlcml0eSIsIm1lc3NhZ2UiLCJ0aW1lc3RhbXAiLCJ0b3BSdWxlcyIsImV4ZWN1dGlvbkZpeHR1cmUiLCJvcGVyYXRpb25JZCIsInN0YXR1cyIsImZsaWdodFN0YXRlIiwiZXZpZGVuY2VWZXJkaWN0IiwicHJvb2ZSZXF1aXJlZCIsInJlc3VtYWJsZSIsImNoZWNrcG9pbnRWZXJzaW9uIiwicHJvamVjdFJldmlzaW9uIiwiY2hlY2twb2ludCIsInN0YWdlIiwiZGV0YWlsIiwib2JqZWN0aXZlIiwic3RhcnRlZEF0IiwiY29tcGxldGVkQXQiLCJjcmVhdGVkQXQiLCJ1cGRhdGVkQXQiLCJqc29uUmVzcG9uc2UiLCJib2R5IiwiaGVhZGVycyIsImNvbnRlbnRUeXBlIiwiSlNPTiIsInN0cmluZ2lmeSIsImV4cGVjdE5vSG9yaXpvbnRhbE92ZXJmbG93IiwicGFnZSIsIm92ZXJmbG93IiwiZXZhbHVhdGUiLCJkb2N1bWVudCIsImRvY3VtZW50RWxlbWVudCIsInNjcm9sbFdpZHRoIiwidmlld3BvcnQiLCJ3aW5kb3ciLCJpbm5lcldpZHRoIiwidG9CZUxlc3NUaGFuT3JFcXVhbCIsImV4cGVjdERhc2hib2FyZFJlYWR5IiwiZ2V0QnlSb2xlIiwibmFtZSIsInRvQmVWaXNpYmxlIiwiZ2V0QnlUZXh0IiwiZXhhY3QiLCJyZXN0YXJ0QXBpRm9yQ2FtcGFpZ24iLCJjb250cm9sVXJsIiwiREFTSEJPQVJEX0UyRV9DT05UUk9MX1VSTCIsInJlc3BvbnNlIiwicmVxdWVzdCIsInBvc3QiLCJ0aW1lb3V0IiwidG9CZSIsImluc3RhbGxBcGlGaXh0dXJlcyIsIm92ZXJyaWRlcyIsInJvdXRlIiwiX3JlZiIsIl9vdmVycmlkZXMkZGVsaXZlcnlSZSIsIl9vdmVycmlkZXMkYXVkaXRFeHBvcjIiLCJfb3ZlcnJpZGVzJGF1ZGl0RXhwb3IzIiwidXJsIiwicGF0aCIsInJlcGxhY2UiLCJhcmFiaWNBaSIsImFsdGVybmF0ZUFpIiwiZGlzY29ubmVjdEFpIiwiYWlGaXh0dXJlcyIsImZpeHR1cmUiLCJoYXNDb25maWd1cmVkQWlGaXh0dXJlIiwicmVzdW1lRmFpbHVyZSIsImludGVycnVwdGVkUmVzdW1lIiwiZW5kc1dpdGgiLCJzZWFyY2hQYXJhbXMiLCJnZXQiLCJwcm9qZWN0U2Vzc2lvbnMiLCJmdWxmaWxsIiwic2Vzc2lvbklkIiwidGl0bGUiLCJxdWVzdGlvbiIsInJlcXVlc3RCb2R5IiwicG9zdERhdGFKU09OIiwiZXhlY3V0aW9uSWQiLCJzdHJlYW1Cb2R5IiwicmVzdW1lZFN0cmVhbUJvZHkiLCJyZXF1ZXN0ZWRNZXNzYWdlIiwic3RyZWFtRml4dHVyZSIsImZpbmQiLCJpbmNsdWRlcyIsIm1lc3NhZ2VGaXh0dXJlIiwicm9sZSIsImNvbnRlbnQiLCJhdWRpdEV4cG9ydCIsIl9vdmVycmlkZXMkYXVkaXRFeHBvciIsIm91dGNvbWUiLCJtZXNzYWdlT3V0Y29tZSIsInRhc2tBY3Rpb25zIiwidmVyaWZpY2F0aW9uTWF0Y2giLCJtYXRjaCIsIm1ldGhvZCIsIl9wbGFuJHZlcmlmaWNhdGlvbkNoZSIsIl9wbGFuJHZlcmlmaWNhdGlvblN0ZSIsIl9vdmVycmlkZXMkdGFza0FjdGlvbiIsIl90YXNrJHZlcmlmaWNhdGlvblJlcyIsIl9wcmlvclJlc3VsdCRzdGVwcyIsIl9wcmlvclJlc3VsdCRoaXN0b3J5IiwiX3ByaW9yUmVzdWx0JGhpc3RvcnkyIiwiX2NoZWNrJGtpbmQiLCJfcHJpb3JSZXN1bHQkaGlzdG9yeTMiLCJ0YXNrSWQiLCJ0YXNrIiwidGFza3MiLCJjYW5kaWRhdGUiLCJlcnJvciIsInBsYW4iLCJyZW1lZGlhdGlvblBsYW4iLCJjaGVja3MiLCJ2ZXJpZmljYXRpb25DaGVja3MiLCJ2ZXJpZmljYXRpb25TdGVwcyIsImd1aWRhbmNlIiwiaW5kZXgiLCJraW5kIiwiY2hlY2siLCJjaGVja0lkIiwicmVhc29uIiwicGFzc2VkIiwiZXZpZGVuY2UiLCJ2ZXJpZmljYXRpb25SZXF1ZXN0cyIsInB1c2giLCJwcmlvclJlc3VsdCIsInZlcmlmaWNhdGlvblJlc3VsdCIsInByaW9yU3RlcHMiLCJzdGVwcyIsIl9jYW5kaWRhdGUka2luZDIiLCJwcmlvciIsInN0ZXAiLCJfY2FuZGlkYXRlJGtpbmQiLCJTdHJpbmciLCJvdXRwdXQiLCJjb21wbGV0ZWQiLCJldmVyeSIsIl9zdGVwJGV2aWRlbmNlIiwiZGVjaXNpb24iLCJoaXN0b3J5IiwiYWN0b3IiLCJyZWNvcmRlZEF0IiwiYWN0aW9uTWF0Y2giLCJhY3Rpb24iLCJyZXF1ZXN0cyIsIl90YXNrJHJldHJ5Q291bnQiLCJyZXRyeUNvdW50IiwiX3JlZjIiLCJfb3ZlcnJpZGVzJHRhc2tBY3Rpb24yIiwiX292ZXJyaWRlcyR0YXNrQWN0aW9uMyIsInJlY292ZXJ5VGFza3MiLCJsaXZlVGFzayIsImRlc2NyaXB0aW9uIiwicHJpb3JpdHkiLCJyZWxhdGVkRmlsZXMiLCJtYXhSZXRyaWVzIiwiX292ZXJyaWRlcyRyZWNvdmVyeVdvIiwicmVjb3ZlcnlXb3JrZmxvd3MiLCJ3b3JrZmxvd0V4ZWN1dGlvbnNNYXRjaCIsIl9vdmVycmlkZXMkcmVjb3ZlcnlXbzIiLCJfb3ZlcnJpZGVzJHJlY292ZXJ5V28zIiwicmVjb3ZlcnlXb3JrZmxvd0V4ZWN1dGlvbnMiLCJmYWlsRmlyc3RQcmV2aWV3IiwiZmlsZW5hbWUiLCJhcmNoaXZlVXBsb2FkIiwiX3JvdXRlJHJlcXVlc3QkaGVhZGVyIiwic3RhcnRzV2l0aCIsInBvc3REYXRhQnVmZmVyIiwiQnVmZmVyIiwiZnJvbSIsInVwbG9hZElkIiwib3JpZ2luYWxOYW1lIiwicGhhc2UiLCJfb3ZlcnJpZGVzJGxpdmVUYXNrJGkiLCJpbml0aWFsTG9ncyIsInN0cmVhbVJlcXVlc3RzIiwiZmFpbEZpcnN0U3RyZWFtIiwiZmFpbFN0cmVhbUF0dGVtcHRzIiwiYWJvcnQiLCJsb2ciLCJfb3ZlcnJpZGVzJHByb2plY3RzIiwicHJvamVjdHMiLCJsYW5ndWFnZSIsImZyYW1ld29yayIsInJvb3RQYXRoIiwicXVhbGl0eVNjb3JlIiwicHJvdmlkZXIiLCJkZWxpdmVyeVJlY292ZXJ5Iiwib3BlcmF0aW9ucyIsInJlY292ZXJ5QWN0aW9uIiwicHJvcG9zYWxJZCIsIl9vdmVycmlkZXMkZGVsaXZlcnlSZTIiLCJfb3ZlcnJpZGVzJGRlbGl2ZXJ5UmUzIiwiYWN0aW9uUmVxdWVzdHMiLCJuZXh0T3BlcmF0aW9ucyIsIl9vdmVycmlkZXMkZXZlbnRzIiwiX3VybCRzZWFyY2hQYXJhbXMkZ2V0IiwiZXZlbnRzIiwidG9Mb3dlckNhc2UiLCJmaWx0ZXJlZEV2ZW50cyIsImV2ZW50IiwiY29ycmVsYXRpb25JZCIsInZhbHVlIiwic29tZSIsImxpbWl0Iiwic2xpY2UiLCJ0b3RhbCIsImV4ZWN1dGlvbiIsInJlc3VtZVRva2VuIiwicmVjb3ZlcmVkVG9rZW4iLCJleGVjdXRpb25zIiwiY29udGludWUiLCJpbnN0YWxsQXJhYmljQWlGaXh0dXJlIiwib3B0aW9ucyIsIl9vcHRpb25zJHNlc3Npb25JZCIsIl9vcHRpb25zJHF1ZXN0aW9uIiwibWVzc2FnZUlkIiwic291cmNlIiwiYmxvY2tlZCIsImFuc3dlciIsImV4Y2VycHQiLCJzdXBwb3J0c0NsYWltIiwiZXZpZGVuY2VDbGFzcyIsImNpdGF0aW9uU3RhdHVzIiwiY2l0YXRpb25SZWFzb24iLCJzb3VyY2VTcGFuIiwic3RhcnRMaW5lIiwiZW5kTGluZSIsInRvb2xUcmFjZSIsInRvb2wiLCJhcmdzIiwiY2FjaGVkIiwicHJlZmV0Y2hlZCIsImNvZGUiLCJjb25zaXN0ZW50IiwidmlvbGF0aW9ucyIsImV2aWRlbmNlRmlsZUNvdW50IiwiYWNjZXB0ZWRFdmlkZW5jZUNvdW50IiwiY29tcGxldGVkUmVhZEZpbGVzIiwiYWNjZXB0ZWRFdmlkZW5jZUZpbGVzIiwib2JqZWN0aXZlVHlwZSIsInJlcXVpcmVkRWRnZXMiLCJwcm92ZW5FZGdlcyIsImNvbXBsZXRpb25HYXRlUmVzdWx0IiwiZmluYWxBbnN3ZXJUeXBlIiwidGFza1Jlc3VsdCIsImNvbmZpZGVuY2UiLCJzb3VyY2VTY29wZSIsImNvdmVyYWdlIiwicmVxdWVzdGVkRmllbGRzIiwiYW5zd2VyZWRGaWVsZHMiLCJtaXNzaW5nRmllbGRzIiwiY29tcGxldGUiLCJvcGVyYXRpb25Nb2RlIiwic291cmNlcyIsImJlaGF2aW9yRXZpZGVuY2UiLCJzc2UiLCJkZWx0YSIsInBlbmRpbmdDaGFuZ2VzIiwiam9pbiIsImluc3RhbGxUb29sRmFpbHVyZUZpeHR1cmUiLCJkaWFnbm9zdGljQ29kZSIsInJlc3VsdEtpbmQiLCJyZXN1bHRTdW1tYXJ5Iiwic3RvcFJlYXNvbiIsIml0ZXJhdGlvbnMiLCJtYXhJdGVyYXRpb25zIiwidG9vbENhbGxzIiwicHJlZmV0Y2hUb29sQ2FsbHMiLCJsb29wVG9vbENhbGxzIiwic3ludGhlc2lzU3RhcnRlZCIsImRpYWdub3N0aWNDb2RlcyIsImluc3RhbGxEaXNjb25uZWN0ZWRBaUZpeHR1cmUiLCJkaWFnbm9zdGljRGV0YWlscyIsImVycm9yQ29kZSIsImVycm9yTWVzc2FnZSIsImluc3RhbGxSZXN1bWVkQW5hbHlzaXNGYWlsdXJlRml4dHVyZSIsImluc3RhbGxJbnRlcnJ1cHRlZFJlc3VtZUZpeHR1cmUiLCJpbml0aWFsVG9rZW4iLCJwYXJ0aWFsQW5zd2VyIiwiY3JlYXRlUmVsZWFzZVNpZ25JblVybCIsInNlY3JldEtleSIsIkNMRVJLX1NFQ1JFVF9LRVkiLCJBdXRob3JpemF0aW9uIiwidXNlclJlc3BvbnNlIiwiZW5jb2RlVVJJQ29tcG9uZW50IiwidXNlcklkIiwianNvbiIsImNyZWF0ZWRSZXNwb25zZSIsImRhdGEiLCJlbWFpbF9hZGRyZXNzIiwiZmlyc3RfbmFtZSIsImxhc3RfbmFtZSIsInNraXBfcGFzc3dvcmRfY2hlY2tzIiwic2tpcF9wYXNzd29yZF9yZXF1aXJlbWVudCIsInRva2VuUmVzcG9uc2UiLCJ1c2VyX2lkIiwidG9rZW4iLCJ0b1N0cmluZyIsInByb2dyYW1tYXRpY1NpZ25JbiIsIl9nbG9iYWxUaGlzJHNpZ25JbkNsZSIsImdvdG8iLCJoZWxwZXIiLCJnbG9iYWxUaGlzIiwic2lnbkluQ2xlcmtVc2VyIiwiX19FTkdJTkVFUklOR09TX1NJR05fSU5fQ0xFUktfVVNFUl9fIiwiUlVOX0NPTlRST0xMRURfUkVMRUFTRV9WQUxJREFUSU9OIiwidG9IYXZlVVJMIiwiUmVnRXhwIiwicmVwbGFjZUFsbCIsInNpZ25JblVybCIsInR0bCIsImJhc2VQYXRoIiwib3Blbk5hdmlnYXRpb24iLCJsYWJlbCIsImNsaWNrIiwiYXBpVXJsIiwiYXBpQmFzZVVybCIsIkRBU0hCT0FSRF9FMkVfQVBJX0JBU0VfVVJMIiwibGl2ZVJlcXVlc3QiLCJfb3B0aW9ucyRtZXRob2QiLCJmZXRjaCIsImNyZWRlbnRpYWxzIiwidW5kZWZpbmVkIiwic2lnbmFsIiwiQWJvcnRTaWduYWwiLCJ0ZXh0IiwicmVjb3JkZWRPcmlnaW5EaWFnbm9zdGljcyIsIm9yaWdpbkRpYWdub3N0aWNQYXRoIiwiREFTSEJPQVJEX0UyRV9PUklHSU5fRElBR05PU1RJQ1NfUEFUSCIsInJlbGV2YW50T3JpZ2luSGVhZGVycyIsIk9iamVjdCIsImZyb21FbnRyaWVzIiwiZmxhdE1hcCIsIndyaXRlT3JpZ2luRGlhZ25vc3RpY3MiLCJvdXRwdXRQYXRoIiwicmVjdXJzaXZlIiwiZGlhZ25vc3RpY3MiLCJleHBlY3RPcmlnaW5DYW5Vc2VBcGkiLCJoZWFsdGhVcmwiLCJtdXRhdGlvblVybCIsImNvbW1vbkhlYWRlcnMiLCJPcmlnaW4iLCJhc3NlcnRpb24iLCJhdCIsImN1cnJlbnQiLCJfcmVzcG9uc2UkaGVhZGVycyRhY2MiLCJfcmVzcG9uc2UkaGVhZGVycyRhY2MyIiwidG9VcHBlckNhc2UiLCJ0b0NvbnRhaW4iLCJoZWFkZXIiLCJub3QiLCJleHBlY3RIb3N0aWxlT3JpZ2luUmVqZWN0ZWQiLCJ1cGxvYWRVcmwiLCJsaXZlVXBkYXRlVXJsIiwiZGlhZ25vc3RpYyIsInRvQmVVbmRlZmluZWQiLCJob3N0aWxlVXBsb2FkIiwibXVsdGlwYXJ0IiwiYXJjaGl2ZSIsIm1pbWVUeXBlIiwiYnVmZmVyIiwiaG9zdGlsZUxpdmVVcGRhdGUiLCJwYXJzZVNzZSIsImNodW5rIiwiX2NodW5rJHNwbGl0JGZpbmQiLCJsaW5lIiwicGFyc2UiLCJsaXZlSnNvbiIsImxpdmVBcnJheSIsIkFycmF5IiwiaXNBcnJheSIsImxpdmVPcHRpb25hbFJlY29yZCIsImRlc2NyaWJlIiwiX2V4ZWN1dGlvbiRvcGVyYXRpb25JIiwiX2V4ZWN1dGlvbiRmbGlnaHRTdGF0IiwiX2dpdExvZyRjb21taXRzJDAkc2hvIiwiX2dpdExvZyRjb21taXRzIiwiX2dpdExvZyRjb21taXRzMiIsIl9wcm9jZXNzJGVudiREQVNIQk9BUjUiLCJzZXRUaW1lb3V0Iiwic2tpcCIsIkRBU0hCT0FSRF9FMkVfTElWRV9QUk9WSURFUiIsIkRBU0hCT0FSRF9FMkVfTElWRV9ESVNQT1NBQkxFIiwiY2FtcGFpZ25TY2VuYXJpbyIsIkRBU0hCT0FSRF9FMkVfTElWRV9QUk9KRUNUX0lEIiwic3RyZWFtUmVzcG9uc2UiLCJpZGVtcG90ZW5jeUtleSIsIkRhdGUiLCJub3ciLCJzc2VFdmVudHMiLCJzdGFydGVkIiwiZGVhZGxpbmUiLCJQcm9taXNlIiwicmVzb2x2ZSIsIm1lc3NhZ2VzIiwicHJvcG9zYWwiLCJnaXRMb2ciLCJtaXNzaW9uQ29udHJvbCIsImRhc2hib2FyZFN0YXRlIiwicmVjZW50U3RlcHMiLCJ2YWxpZGF0aW9uIiwiY2FuZGlkYXRlSGFzaCIsIl9zdGVwJHZhbGlkYXRpb24kY2FuZCIsIl9zdGVwJHZhbGlkYXRpb24iLCJjYW5kaWRhdGVJZGVudGl0eSIsImV2aWRlbmNlQ291bnQiLCJyZWR1Y2UiLCJjb3VudCIsInRlcm1pbmFsU3RhdGUiLCJzdWNjZXNzU3RhdGVzIiwiZGVsaXZlcnlTdGFnZXMiLCJhcHBsaWVkIiwiY29tbWl0dGVkIiwicHVzaGVkIiwidmFsdWVzIiwiY2FwdHVyZSIsIndvcmtzcGFjZVJldmlzaW9uIiwiY29tbWl0cyIsInNob3J0SGFzaCIsImNhbmRpZGF0ZVJldmlzaW9uIiwiY3VycmVudE9wZXJhdGlvbiIsInJldmlzaW9uIiwicmV0YWluZWRSZXN1bHQiLCJtZXNzYWdlU2Vzc2lvbiIsIm1lc3NhZ2VFeGVjdXRpb24iLCJldmVudEV4ZWN1dGlvbiIsImV2ZW50U2Vzc2lvbiIsImNoZWNrcG9pbnRzIiwic2VxdWVuY2UiLCJwcm9wb3NhbHMiLCJfc3RlcCR2YWxpZGF0aW9uJHN0YXQiLCJfc3RlcCR2YWxpZGF0aW9uMiIsIl9zdGVwJHZhbGlkYXRpb24kcHJvZiIsIl9zdGVwJHZhbGlkYXRpb24zIiwicHJvZmlsZSIsInZhbGlkYXRpb25Qcm9maWxlIiwiZGFzaGJvYXJkIiwiREFTSEJPQVJEX0UyRV9MSVZFX1JFUE9SVF9QQVRIIiwiZmlyc3QiLCJyYXdEaWFnbm9zdGljIiwicmF3Q3JlZGVudGlhbCIsInN1cHBvcnRSZWZlcmVuY2VzIiwiYXV0aGVudGljYXRpb25fZmFpbGVkIiwicXVvdGFfZXhoYXVzdGVkIiwicHJvdmlkZXJfb3V0YWdlIiwiYWdlbnRSZXNwb25zZSIsInRlcm1pbmFsU3RhdHVzIiwiYXZhaWxhYmlsaXR5U3RhdGUiLCJvcGVyYXRvckFjdGlvbiIsIm1vZGVsIiwidGVybWluYWxSZWFzb24iLCJ3b3JrZmxvd0lkIiwicGhhc2VzIiwiY3VycmVudFBoYXNlIiwiZXhlY3V0aW9uQ291bnQiLCJjb21wbGV0ZWRQaGFzZXMiLCJyZWNvdmVyeSIsImdldEJ5TGFiZWwiLCJ0YXNrRGV0YWlscyIsImxvY2F0b3IiLCJ0b0NvbnRhaW5UZXh0IiwicmVsb2FkIiwicmVsb2FkZWRBdXRoRGV0YWlscyIsInJlbG9hZGVkVGFza1RleHQiLCJpbm5lclRleHQiLCJ0b01hdGNoIiwicmVsb2FkZWRFeGVjdXRpb24iLCJ2aXNpYmxlVGV4dCIsInJhd1Byb21wdCIsInJlYWR5VGFza0lkIiwicmV2aWV3VGFza0lkIiwidmVyaWZpY2F0aW9uVGFza0lkIiwicmVtZWRpYXRpb25UYXNrcyIsInByb21wdCIsInZlcnNpb24iLCJydWxlSWQiLCJydWxlQ29kZSIsInJ1bGVUaXRsZSIsIm9jY3VycmVuY2VDb3VudCIsImZpbGUiLCJzbmlwcGV0Iiwib2NjdXJyZW5jZXMiLCJmaXhEZXNjcmlwdGlvbiIsImNvbXBsZXRlbmVzcyIsInJlYWR5Um93IiwiZ2V0QnlUaXRsZSIsInJlYWR5RGV0YWlscyIsInJlYWR5UGxhbiIsInBvbGwiLCJ0b0hhdmVDb3VudCIsInJldmlld1JvdyIsInJldmlld0RldGFpbHMiLCJyZXZpZXdQbGFuIiwidmVyaWZpY2F0aW9uUm93IiwidmVyaWZpY2F0aW9uRGV0YWlscyIsInZlcmlmaWNhdGlvblBsYW4iLCJmaXJzdEd1aWRhbmNlIiwic2Vjb25kR3VpZGFuY2UiLCJmaXJzdEV2aWRlbmNlIiwic2Vjb25kRXZpZGVuY2UiLCJwYXNzQnV0dG9ucyIsImZhaWxlZEJ1dHRvbnMiLCJudGgiLCJ0b0JlRGlzYWJsZWQiLCJmaWxsIiwidG9NYXRjaE9iamVjdCIsInJlbG9hZGVkVmVyaWZpY2F0aW9uUm93IiwicmVsb2FkZWREZXRhaWxzIiwiYnJvd3NlciIsInNlY29uZENvbnRleHQiLCJuZXdDb250ZXh0Iiwic2Vjb25kUGFnZSIsIm5ld1BhZ2UiLCJhbGwiLCJjdXJyZW50RGFzaGJvYXJkRml4dHVyZSIsInJlZnJlc2hDb3VudCIsInJlbGVhc2VTdGFsZVJlc3BvbnNlIiwic3RhbGVSZXNwb25zZVJlbGVhc2VkIiwic3RhbGVSZWZyZXNoIiwicmVjb25uZWN0QXR0ZW1wdCIsInVucm91dGUiLCJjbG9zZSIsImF1ZGl0UmVxdWVzdHMiLCJhdWRpdEJvZHkiLCJmb3JtYXQiLCJleHBvcnRlZEF0IiwicHJvb2YiLCJyZXF1aXJlZCIsInZlcmRpY3QiLCJ0aW1lbGluZSIsInZhbGlkYXRpb25zIiwiYWZmZWN0ZWRGaWxlcyIsInJlZGFjdGlvbiIsImV4Y2x1ZGVkIiwibG9jYWxTdG9yYWdlIiwic2V0SXRlbSIsInByZXZpZXciLCJ0b0hhdmVMZW5ndGgiLCJ0b0JlSGlkZGVuIiwiZG93bmxvYWRQcm9taXNlIiwid2FpdEZvckV2ZW50IiwiZG93bmxvYWQiLCJzdWdnZXN0ZWRGaWxlbmFtZSIsInJlbG9hZGVkUHJvb2YiLCJjYW5jZWxsZWRFeGVjdXRpb24iLCJfcHJvY2VzcyRlbnYkREFTSEJPQVI2IiwibGl2ZUxvZyIsImxldmVsIiwidXBsb2FkUmVzdWx0IiwiYnl0ZXMiLCJVaW50OEFycmF5IiwiYXRvYiIsImNoYXJhY3RlciIsImNoYXJDb2RlQXQiLCJGb3JtRGF0YSIsImFwcGVuZCIsIkJsb2IiLCJ0b0VxdWFsIiwidGFza1JvdyIsIm1ldGFkYXRhIiwiYWN0aXZpdHkiLCJoYXNUZXh0Iiwibm9uU3RyZWFtUmVxdWVzdHMiLCJvbiIsImV4aGF1c3RlZCIsInNpemUiLCJfIiwiVVRDIiwidG9JU09TdHJpbmciLCJldmVudFJlcXVlc3RzIiwiZmlyc3RSZXF1ZXN0Iiwid2FpdEZvclJlcXVlc3QiLCJnZXRCeVBsYWNlaG9sZGVyIiwic2VsZWN0T3B0aW9uIiwidG9IYXZlVmFsdWUiLCJmaWx0ZXJlZFJlcXVlc3QiLCJjb21wb3NlciIsInNlbmRCdXR0b24iLCJ0b0JlRW5hYmxlZCIsInN0cmVhbVJlc3BvbnNlUHJvbWlzZSIsIndhaXRGb3JSZXNwb25zZSIsImxhc3QiLCJzZXRWaWV3cG9ydFNpemUiLCJ3aWR0aCIsImhlaWdodCIsImFjY2VwdGVkIiwiYXNzZXJ0QWNjZXB0ZWRDaXRhdGlvbiIsImFzc2VydEJsb2NrZWRDaXRhdGlvbiIsImFzc2VydE5vSW50ZXJuYWxDaXRhdGlvbkRldGFpbHMiLCJnb0JhY2siLCJnb0ZvcndhcmQiLCJfYXdhaXQkcmVzdW1lUmVxdWVzdCQiLCJyZXN1bWVSZXF1ZXN0IiwicG9zdERhdGEiLCJvYmplY3RDb250YWluaW5nIiwiX3N0cmVhbVJlcXVlc3RzJCIsIl9zdHJlYW1SZXF1ZXN0cyQyIiwiYWRkSW5pdFNjcmlwdCIsIm5hdGl2ZUZldGNoIiwiYmluZCIsImlucHV0IiwiaW5pdCIsIlJlcXVlc3QiLCJyZWFkZXIiLCJnZXRSZWFkZXIiLCJlbmNvZGVyIiwiVGV4dEVuY29kZXIiLCJzdHJlYW0iLCJSZWFkYWJsZVN0cmVhbSIsInN0YXJ0IiwiY29udHJvbGxlciIsImJ1ZmZlcmVkIiwiZG9uZSIsInJlYWQiLCJlbnF1ZXVlIiwiZW5jb2RlIiwiVGV4dERlY29kZXIiLCJkZWNvZGUiLCJtYXJrZXIiLCJpbmRleE9mIiwiZnJhbWVFbmQiLCJUeXBlRXJyb3IiLCJSZXNwb25zZSIsInN0YXR1c1RleHQiLCJzdG9yYWdlS2V5IiwicG9pbnRlcktleSIsImtleSIsImdldEl0ZW0iLCJfbG9jYWxTdG9yYWdlJGdldEl0ZW0iLCJzYXZlZCIsIl9sb2NhbFN0b3JhZ2UkZ2V0SXRlbTIiLCJsaWZlY3ljbGUiLCJyZWNvdmVyeVN0YXRlIiwib3BlcmF0b3JFeHBsYW5hdGlvbiIsIm5leHRBY3Rpb24iLCJjb25mbGljdFJlYXNvbiIsInZhbGlkYXRpb25FdmlkZW5jZSIsIndvcmtzcGFjZUF2YWlsYWJsZSIsImNoYW5nZUNvdW50IiwicmVnaW9uIiwiYXZhaWxhYmxlIiwibWlzc2luZyIsImRpc2NhcmRlZCIsInRvSGF2ZUF0dHJpYnV0ZSIsInJlbG9hZGVkUmVnaW9uIiwidG9CZUdyZWF0ZXJUaGFuT3JFcXVhbCIsIm9wZXJhdGlvbiIsImJlZm9yZU9wZW4iLCJib3VuZGluZ0JveCIsInRvQmVHcmVhdGVyVGhhbiIsImRyYXdlciIsImRyYXdlckJveCIsImR1cmluZ09wZW4iXSwic291cmNlcyI6WyJkYXNoYm9hcmQuam91cm5leS50cyJdLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBleHBlY3QsIHRlc3QsIHR5cGUgUGFnZSB9IGZyb20gXCJAcGxheXdyaWdodC90ZXN0XCI7XG5pbXBvcnQgeyBta2Rpciwgd3JpdGVGaWxlIH0gZnJvbSBcIm5vZGU6ZnMvcHJvbWlzZXNcIjtcbmltcG9ydCB7IGRpcm5hbWUgfSBmcm9tIFwibm9kZTpwYXRoXCI7XG5pbXBvcnQge1xuICBwYXJzZUNsZXJrU2lnbkluVG9rZW5SZXNwb25zZSxcbiAgcGFyc2VDbGVya1VzZXJMb29rdXBSZXNwb25zZSxcbiAgcGFyc2VDcmVhdGVkQ2xlcmtVc2VyUmVzcG9uc2UsXG59IGZyb20gXCIuLi9zcmMvbGliL2NsZXJrLWhhbmRvZmZcIjtcblxuY29uc3QgREFTSEJPQVJEX1BBVEggPSBcIi9kYXNoYm9hcmQvXCI7XG5jb25zdCBURVNUX1VTRVIgPSB7XG4gIGZpcnN0TmFtZTogXCJFbmdpbmVlcmluZ09TXCIsXG4gIGxhc3ROYW1lOiBcIkRhc2hib2FyZCBTbW9rZVwiLFxuICBlbWFpbDpcbiAgICBwcm9jZXNzLmVudi5EQVNIQk9BUkRfRTJFX0VNQUlMID8/XG4gICAgXCJlbmdpbmVlcmluZ29zLWRhc2hib2FyZC1zbW9rZUBleGFtcGxlLmNvbVwiLFxufTtcbmNvbnN0IEVYRUNVVElPTl9JRCA9IFwiZTJlLWNvbnRyb2xsZWQtZXhlY3V0aW9uXCI7XG5jb25zdCBERUZBVUxUX0xJVkVfVElNRU9VVF9NUyA9IDEyMF8wMDA7XG5jb25zdCBMSVZFX1RFU1RfVElNRU9VVF9NQVJHSU5fTVMgPSA1XzAwMDtcbmNvbnN0IEhPU1RJTEVfT1JJR0lOID0gXCJodHRwczovL2F0dGFja2VyLmV4YW1wbGVcIjtcbmNvbnN0IE9SSUdJTl9ESUFHTk9TVElDX0hFQURFUlMgPSBbXG4gIFwiYWNjZXNzLWNvbnRyb2wtYWxsb3ctb3JpZ2luXCIsXG4gIFwiYWNjZXNzLWNvbnRyb2wtYWxsb3ctbWV0aG9kc1wiLFxuICBcImFjY2Vzcy1jb250cm9sLWFsbG93LWhlYWRlcnNcIixcbiAgXCJ2YXJ5XCIsXG5dIGFzIGNvbnN0O1xuY29uc3QgREVGQVVMVF9MSVZFX1BST01QVCA9XG4gIFwiUGVyZm9ybSBhIGJvdW5kZWQgZm9yZW5zaWMgYXVkaXQgb2YgdGhpcyBkaXNwb3NhYmxlIHByb2plY3QgdXNpbmcgcmVhZC1vbmx5IHRvb2xzLiBcIiArXG4gIFwiUHJvZHVjZSBhdCBsZWFzdCBvbmUgYWNjZXB0ZWQgZXZpZGVuY2UgaXRlbSBhbmQgb25lIHZhbGlkYXRpb24gY2hlY2twb2ludCwgYW5kIGRvIG5vdCBcIiArXG4gIFwicmVwb3J0IENPTVBMRVRFRCB1bmxlc3MgYm90aCBhcmUgcHJlc2VudC4gUmVwb3J0IG9ubHkgdmVyaWZpZWQgZXZpZGVuY2UuXCI7XG5jb25zdCBMSVZFX0NBTVBBSUdOX1NDRU5BUklPUyA9IG5ldyBTZXQoW1xuICBcInByb3ZpZGVyLW91dGFnZVwiLFxuICBcIm1hbGZvcm1lZC1vdXRwdXRcIixcbiAgXCJkZWxpdmVyeS1zdWNjZXNzXCIsXG5dKTtcblxuZnVuY3Rpb24gbGl2ZUNhbXBhaWduU2NlbmFyaW8oKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgY29uc3Qgc2NlbmFyaW8gPSBwcm9jZXNzLmVudi5EQVNIQk9BUkRfRTJFX0xJVkVfU0NFTkFSSU8/LnRyaW0oKTtcbiAgaWYgKHByb2Nlc3MuZW52LkRBU0hCT0FSRF9FMkVfTElWRV9DQU1QQUlHTiA9PT0gXCIxXCIgJiYgIXNjZW5hcmlvKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgXCJMaXZlIGNhbXBhaWduIHJlcXVpcmVzIERBU0hCT0FSRF9FMkVfTElWRV9TQ0VOQVJJTz1wcm92aWRlci1vdXRhZ2UsIG1hbGZvcm1lZC1vdXRwdXQsIG9yIGRlbGl2ZXJ5LXN1Y2Nlc3MuXCIsXG4gICAgKTtcbiAgfVxuICBpZiAoc2NlbmFyaW8gJiYgIUxJVkVfQ0FNUEFJR05fU0NFTkFSSU9TLmhhcyhzY2VuYXJpbykpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYFVuc3VwcG9ydGVkIGxpdmUgY2FtcGFpZ24gc2NlbmFyaW86ICR7c2NlbmFyaW99LmApO1xuICB9XG4gIHJldHVybiBzY2VuYXJpbztcbn1cblxuZnVuY3Rpb24gbGl2ZVByb21wdCgpOiBzdHJpbmcge1xuICBjb25zdCBzY2VuYXJpbyA9IGxpdmVDYW1wYWlnblNjZW5hcmlvKCk7XG4gIGlmIChzY2VuYXJpbyA9PT0gXCJwcm92aWRlci1vdXRhZ2VcIikge1xuICAgIHJldHVybiBcIlJ1biBhIGJvdW5kZWQgZm9yZW5zaWMgYXVkaXQgYW5kIHJlcG9ydCB0aGUgT3BlblJvdXRlciByYXRlLWxpbWl0L3Byb3ZpZGVyLWV4aGF1c3Rpb24gb3V0YWdlIGFzIGEgZmFpbGVkIG9yIGluY29tcGxldGUgb3BlcmF0aW9uLiBEbyBub3QgdXNlIHByaW9yIGFuYWx5c2lzIGFzIGEgY3VycmVudCBhbnN3ZXI7IGluY2x1ZGUgdGhlIGN1cnJlbnQgb3BlcmF0aW9uIGFuZCByZXZpc2lvbi5cIjtcbiAgfVxuICBpZiAoc2NlbmFyaW8gPT09IFwibWFsZm9ybWVkLW91dHB1dFwiKSB7XG4gICAgcmV0dXJuIFwiUnVuIGEgYm91bmRlZCBmb3JlbnNpYyBhdWRpdCBhbmQgdHJlYXQgbWFsZm9ybWVkIHByb3ZpZGVyIG91dHB1dCBhcyBmYWlsZWQgb3IgaW5jb21wbGV0ZS4gRG8gbm90IGNsYWltIHN1Y2Nlc3MsIGFwcGx5LCBjb21taXQsIG9yIHB1c2ggd2l0aG91dCBjYW5kaWRhdGUtYm91bmQgZXZpZGVuY2UuXCI7XG4gIH1cbiAgaWYgKHNjZW5hcmlvID09PSBcImRlbGl2ZXJ5LXN1Y2Nlc3NcIikge1xuICAgIHJldHVybiBcIlBsZWFzZSBjb25kdWN0IHRoZSBib3VuZGVkIGRlbGl2ZXJ5IHByb29mIGNhbXBhaWduIG9uIHRoaXMgZGlzcG9zYWJsZSBwcm9qZWN0LiBFeGVyY2lzZSBhcHBseSwgY29tbWl0LCBhbmQgcHVzaCBvbmx5IHdoZW4gZWFjaCBjdXJyZW50IG9wZXJhdGlvbiwgcHJvamVjdCByZXZpc2lvbiwgY2FuZGlkYXRlIGlkZW50aXR5LCBhbmQgY2FuZGlkYXRlLWJvdW5kIGV2aWRlbmNlIG1hdGNoLiBSZXBvcnQgZXZlcnkgdGVybWluYWwgcmVjZWlwdC5cIjtcbiAgfVxuICByZXR1cm4gcHJvY2Vzcy5lbnYuREFTSEJPQVJEX0UyRV9MSVZFX1BST01QVCA/PyBERUZBVUxUX0xJVkVfUFJPTVBUO1xufVxuXG5mdW5jdGlvbiBsaXZlVGltZW91dE1zKCk6IG51bWJlciB7XG4gIGNvbnN0IGNvbmZpZ3VyZWQgPSBOdW1iZXIocHJvY2Vzcy5lbnYuREFTSEJPQVJEX0UyRV9MSVZFX1RJTUVPVVRfTVMpO1xuICByZXR1cm4gTnVtYmVyLmlzRmluaXRlKGNvbmZpZ3VyZWQpICYmIGNvbmZpZ3VyZWQgPiAwXG4gICAgPyBjb25maWd1cmVkXG4gICAgOiBERUZBVUxUX0xJVkVfVElNRU9VVF9NUztcbn1cblxuZnVuY3Rpb24gYXBwcm92ZWREYXNoYm9hcmRPcmlnaW5zKCk6IHN0cmluZ1tdIHtcbiAgY29uc3Qgb3JpZ2lucyA9IChwcm9jZXNzLmVudi5EQVNIQk9BUkRfRTJFX0FQUFJPVkVEX09SSUdJTlMgPz8gXCJcIilcbiAgICAuc3BsaXQoXCIsXCIpXG4gICAgLm1hcCgob3JpZ2luKSA9PiBvcmlnaW4udHJpbSgpKVxuICAgIC5maWx0ZXIoQm9vbGVhbik7XG4gIGlmIChvcmlnaW5zLmxlbmd0aCA9PT0gMCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgIFwiREFTSEJPQVJEX0UyRV9BUFBST1ZFRF9PUklHSU5TIG11c3QgY29udGFpbiBldmVyeSBhcHByb3ZlZCBkYXNoYm9hcmQgb3JpZ2luLlwiLFxuICAgICk7XG4gIH1cbiAgcmV0dXJuIG9yaWdpbnMubWFwKChvcmlnaW4pID0+IHtcbiAgICBjb25zdCBwYXJzZWQgPSBuZXcgVVJMKG9yaWdpbik7XG4gICAgaWYgKFxuICAgICAgcGFyc2VkLm9yaWdpbiAhPT0gb3JpZ2luIHx8XG4gICAgICBwYXJzZWQucGF0aG5hbWUgIT09IFwiL1wiIHx8XG4gICAgICBwYXJzZWQuc2VhcmNoIHx8XG4gICAgICBwYXJzZWQuaGFzaFxuICAgICkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICBgRGFzaGJvYXJkIGpvdXJuZXkgb3JpZ2luIG11c3QgYmUgYSBiYXJlIG9yaWdpbjogJHtvcmlnaW59YCxcbiAgICAgICk7XG4gICAgfVxuICAgIHJldHVybiBwYXJzZWQub3JpZ2luO1xuICB9KTtcbn1cblxuY29uc3QgZGFzaGJvYXJkRml4dHVyZSA9IHtcbiAgZnJlc2huZXNzUmV2aXNpb246IFwiMjAyNi0wMS0wMVQwMDowMDowMC4wMDBaXCIsXG4gIHByb2plY3RDb3VudDogMSxcbiAgYWN0aXZlVGFza0NvdW50OiAwLFxuICBjb21wbGV0ZWRUYXNrQ291bnQ6IDIsXG4gIGZhaWxlZFRhc2tDb3VudDogMCxcbiAgdGFza1N0YXR1c0JyZWFrZG93bjogeyBwZW5kaW5nOiAwLCBydW5uaW5nOiAwIH0sXG4gIHByb2plY3RTY29yZXM6IFtcbiAgICB7XG4gICAgICBwcm9qZWN0SWQ6IFwiZTJlLXByb2plY3RcIixcbiAgICAgIHByb2plY3ROYW1lOiBcIlNtb2tlIFByb2plY3RcIixcbiAgICAgIHNjb3JlOiA5MixcbiAgICAgIHRyZW5kOiBcInN0YWJsZVwiLFxuICAgIH0sXG4gIF0sXG4gIHJlY2VudEV2ZW50czogW1xuICAgIHtcbiAgICAgIGlkOiBcImUyZS1ldmVudFwiLFxuICAgICAgdHlwZTogXCJTbW9rZUNoZWNrXCIsXG4gICAgICBzZXZlcml0eTogXCJzdWNjZXNzXCIsXG4gICAgICBtZXNzYWdlOiBcIkRhc2hib2FyZCBBUEkgZml4dHVyZSByZWFkeVwiLFxuICAgICAgdGltZXN0YW1wOiBcIjIwMjYtMDEtMDFUMDA6MDA6MDAuMDAwWlwiLFxuICAgIH0sXG4gIF0sXG4gIHRvcFJ1bGVzOiBbXSxcbn07XG5cbmNvbnN0IGV4ZWN1dGlvbkZpeHR1cmUgPSB7XG4gIGlkOiBFWEVDVVRJT05fSUQsXG4gIHByb2plY3RJZDogXCJlMmUtcHJvamVjdFwiLFxuICBvcGVyYXRpb25JZDogXCJlMmUtb3BlcmF0aW9uXCIsXG4gIHN0YXR1czogXCJjb21wbGV0ZWRcIixcbiAgZmxpZ2h0U3RhdGU6IFwiQ09NUExFVEVEXCIsXG4gIGV2aWRlbmNlVmVyZGljdDogXCJQUk9WRU5cIixcbiAgcHJvb2ZSZXF1aXJlZDogZmFsc2UsXG4gIHJlc3VtYWJsZTogZmFsc2UsXG4gIGNoZWNrcG9pbnRWZXJzaW9uOiAxLFxuICBwcm9qZWN0UmV2aXNpb246IFwiZTJlLXJldmlzaW9uLTQyXCIsXG4gIGNoZWNrcG9pbnQ6IHtcbiAgICBzdGFnZTogXCJjb21wbGV0ZVwiLFxuICAgIGRldGFpbDogXCJDb250cm9sbGVkIGJyb3dzZXIgZml4dHVyZSBjb21wbGV0ZWQuXCIsXG4gIH0sXG4gIG9iamVjdGl2ZTogeyBvYmplY3RpdmU6IFwiVmVyaWZ5IHRoZSBkYXNoYm9hcmQgYnJvd3NlciBqb3VybmV5XCIgfSxcbiAgc3RhcnRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDA6MDAuMDAwWlwiLFxuICBjb21wbGV0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAxOjAwLjAwMFpcIixcbiAgY3JlYXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDA6MDAuMDAwWlwiLFxuICB1cGRhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMTowMC4wMDBaXCIsXG59O1xuXG5mdW5jdGlvbiBqc29uUmVzcG9uc2UoXG4gIGJvZHk6IHVua25vd24sXG4gIHN0YXR1cyA9IDIwMCxcbiAgaGVhZGVycz86IFJlY29yZDxzdHJpbmcsIHN0cmluZz4sXG4pIHtcbiAgcmV0dXJuIHtcbiAgICBzdGF0dXMsXG4gICAgY29udGVudFR5cGU6IFwiYXBwbGljYXRpb24vanNvblwiLFxuICAgIC4uLihoZWFkZXJzID8geyBoZWFkZXJzIH0gOiB7fSksXG4gICAgYm9keTogSlNPTi5zdHJpbmdpZnkoYm9keSksXG4gIH07XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGV4cGVjdE5vSG9yaXpvbnRhbE92ZXJmbG93KHBhZ2U6IFBhZ2UpIHtcbiAgY29uc3Qgb3ZlcmZsb3cgPSBhd2FpdCBwYWdlLmV2YWx1YXRlKCgpID0+ICh7XG4gICAgZG9jdW1lbnQ6IGRvY3VtZW50LmRvY3VtZW50RWxlbWVudC5zY3JvbGxXaWR0aCxcbiAgICBib2R5OiBkb2N1bWVudC5ib2R5LnNjcm9sbFdpZHRoLFxuICAgIHZpZXdwb3J0OiB3aW5kb3cuaW5uZXJXaWR0aCxcbiAgfSkpO1xuICBleHBlY3Qob3ZlcmZsb3cuZG9jdW1lbnQpLnRvQmVMZXNzVGhhbk9yRXF1YWwob3ZlcmZsb3cudmlld3BvcnQgKyAxKTtcbiAgZXhwZWN0KG92ZXJmbG93LmJvZHkpLnRvQmVMZXNzVGhhbk9yRXF1YWwob3ZlcmZsb3cudmlld3BvcnQgKyAxKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZXhwZWN0RGFzaGJvYXJkUmVhZHkocGFnZTogUGFnZSkge1xuICBhd2FpdCBleHBlY3QoXG4gICAgcGFnZS5nZXRCeVJvbGUoXCJoZWFkaW5nXCIsIHsgbmFtZTogXCJTeXN0ZW0gT3ZlcnZpZXdcIiB9KSxcbiAgKS50b0JlVmlzaWJsZSgpO1xuICBhd2FpdCBleHBlY3QocGFnZS5nZXRCeVRleHQoXCJTWVNURU0gT05MSU5FXCIsIHsgZXhhY3Q6IHRydWUgfSkpLnRvQmVWaXNpYmxlKCk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHJlc3RhcnRBcGlGb3JDYW1wYWlnbihwYWdlOiBQYWdlKSB7XG4gIGNvbnN0IGNvbnRyb2xVcmwgPSBwcm9jZXNzLmVudi5EQVNIQk9BUkRfRTJFX0NPTlRST0xfVVJMO1xuICBpZiAoIWNvbnRyb2xVcmwpIHRocm93IG5ldyBFcnJvcihcIkRhc2hib2FyZCBjYW1wYWlnbiBjb250cm9sIFVSTCBpcyBtaXNzaW5nLlwiKTtcbiAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBwYWdlLnJlcXVlc3QucG9zdChgJHtjb250cm9sVXJsfS9yZXN0YXJ0LWFwaWAsIHtcbiAgICB0aW1lb3V0OiAxNV8wMDAsXG4gIH0pO1xuICBleHBlY3QocmVzcG9uc2Uuc3RhdHVzKCkpLnRvQmUoMjA0KTtcbn1cblxudHlwZSBBcmFiaWNBaUZpeHR1cmUgPSB7XG4gIHF1ZXN0aW9uOiBzdHJpbmc7XG4gIGFuc3dlcjogc3RyaW5nO1xuICBzb3VyY2U6IHN0cmluZztcbiAgc2Vzc2lvbklkOiBzdHJpbmc7XG4gIGV4ZWN1dGlvbklkPzogc3RyaW5nO1xuICBwcm9qZWN0SWQ/OiBzdHJpbmc7XG4gIHN0cmVhbUJvZHk6IHN0cmluZztcbiAgbWVzc2FnZTogUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG59O1xuXG5hc3luYyBmdW5jdGlvbiBpbnN0YWxsQXBpRml4dHVyZXMoXG4gIHBhZ2U6IFBhZ2UsXG4gIG92ZXJyaWRlcz86IHtcbiAgICBhcmFiaWNBaT86IEFyYWJpY0FpRml4dHVyZTtcbiAgICBhbHRlcm5hdGVBaT86IEFyYWJpY0FpRml4dHVyZTtcbiAgICBkaXNjb25uZWN0QWk/OiBBcmFiaWNBaUZpeHR1cmU7XG4gICAgcmVzdW1lRmFpbHVyZT86IHtcbiAgICAgIGZpeHR1cmU6IEFyYWJpY0FpRml4dHVyZTtcbiAgICAgIGV4ZWN1dGlvbjogUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gICAgfTtcbiAgICBpbnRlcnJ1cHRlZFJlc3VtZT86IHtcbiAgICAgIGZpeHR1cmU6IEFyYWJpY0FpRml4dHVyZTtcbiAgICAgIGV4ZWN1dGlvbjogUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gICAgICByZWNvdmVyZWRUb2tlbjogc3RyaW5nO1xuICAgICAgcmVzdW1lZFN0cmVhbUJvZHk6IHN0cmluZztcbiAgICB9O1xuICAgIGRlbGl2ZXJ5UmVjb3Zlcnk/OiB7XG4gICAgICBvcGVyYXRpb25zOiBBcnJheTxSZWNvcmQ8c3RyaW5nLCB1bmtub3duPj47XG4gICAgICByZXF1ZXN0czogc3RyaW5nW107XG4gICAgICBhY3Rpb25SZXF1ZXN0cz86IHN0cmluZ1tdO1xuICAgICAgcmVjb3ZlcnlBY3Rpb24/OiB7XG4gICAgICAgIHByb3Bvc2FsSWQ6IHN0cmluZztcbiAgICAgICAgYWN0aW9uOiBcInJlc3VtZS12YWxpZGF0aW9uXCIgfCBcImRpc2NhcmRcIjtcbiAgICAgICAgcmVzcG9uc2U6IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAgICAgICBzdGF0dXM/OiBudW1iZXI7XG4gICAgICAgIG5leHRPcGVyYXRpb25zPzogQXJyYXk8UmVjb3JkPHN0cmluZywgdW5rbm93bj4+O1xuICAgICAgfTtcbiAgICB9O1xuICAgIHByb2plY3RzPzogQXJyYXk8UmVjb3JkPHN0cmluZywgdW5rbm93bj4+O1xuICAgIGV2ZW50cz86IEFycmF5PFJlY29yZDxzdHJpbmcsIHVua25vd24+PjtcbiAgICBhcmNoaXZlVXBsb2FkPzoge1xuICAgICAgdXBsb2FkSWQ6IHN0cmluZztcbiAgICAgIG9yaWdpbmFsTmFtZTogc3RyaW5nO1xuICAgIH07XG4gICAgYXVkaXRFeHBvcnQ/OiB7XG4gICAgICBib2R5OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgICAgIGZpbGVuYW1lOiBzdHJpbmc7XG4gICAgICByZXF1ZXN0czogc3RyaW5nW107XG4gICAgICBleGVjdXRpb24/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgICAgIG1lc3NhZ2VPdXRjb21lPzogc3RyaW5nO1xuICAgICAgZmFpbEZpcnN0UHJldmlldz86IGJvb2xlYW47XG4gICAgfTtcbiAgICBsaXZlVGFzaz86IHtcbiAgICAgIGlkOiBzdHJpbmc7XG4gICAgICB0aXRsZTogc3RyaW5nO1xuICAgICAgcHJvamVjdElkOiBzdHJpbmc7XG4gICAgICBsb2c6IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAgICAgaW5pdGlhbExvZ3M/OiBBcnJheTxSZWNvcmQ8c3RyaW5nLCB1bmtub3duPj47XG4gICAgICBzdHJlYW1SZXF1ZXN0cz86IHN0cmluZ1tdO1xuICAgICAgZmFpbEZpcnN0U3RyZWFtPzogYm9vbGVhbjtcbiAgICAgIGZhaWxTdHJlYW1BdHRlbXB0cz86IG51bWJlcjtcbiAgICB9O1xuICAgIHRhc2tBY3Rpb25zPzoge1xuICAgICAgdGFza3M6IEFycmF5PFJlY29yZDxzdHJpbmcsIHVua25vd24+PjtcbiAgICAgIHJlcXVlc3RzOiBzdHJpbmdbXTtcbiAgICAgIHZlcmlmaWNhdGlvblJlcXVlc3RzPzogQXJyYXk8UmVjb3JkPHN0cmluZywgdW5rbm93bj4+O1xuICAgIH07XG4gICAgcmVjb3ZlcnlUYXNrcz86IEFycmF5PFJlY29yZDxzdHJpbmcsIHVua25vd24+PjtcbiAgICByZWNvdmVyeVdvcmtmbG93cz86IEFycmF5PFJlY29yZDxzdHJpbmcsIHVua25vd24+PjtcbiAgICByZWNvdmVyeVdvcmtmbG93RXhlY3V0aW9ucz86IFJlY29yZDxzdHJpbmcsIEFycmF5PFJlY29yZDxzdHJpbmcsIHVua25vd24+Pj47XG4gIH0sXG4pIHtcbiAgYXdhaXQgcGFnZS5yb3V0ZShcIioqL2FwaS8qKlwiLCBhc3luYyAocm91dGUpID0+IHtcbiAgICBjb25zdCB1cmwgPSBuZXcgVVJMKHJvdXRlLnJlcXVlc3QoKS51cmwoKSk7XG4gICAgY29uc3QgcGF0aCA9IHVybC5wYXRobmFtZS5yZXBsYWNlKC9eXFwvZGFzaGJvYXJkKD89XFwvfCQpLywgXCJcIik7XG4gICAgY29uc3QgYXJhYmljQWkgPSBvdmVycmlkZXM/LmFyYWJpY0FpO1xuICAgIGNvbnN0IGFsdGVybmF0ZUFpID0gb3ZlcnJpZGVzPy5hbHRlcm5hdGVBaTtcbiAgICBjb25zdCBkaXNjb25uZWN0QWkgPSBvdmVycmlkZXM/LmRpc2Nvbm5lY3RBaTtcbiAgICBjb25zdCBhaUZpeHR1cmVzID0gW2FyYWJpY0FpLCBhbHRlcm5hdGVBaSwgZGlzY29ubmVjdEFpXS5maWx0ZXIoXG4gICAgICAoZml4dHVyZSk6IGZpeHR1cmUgaXMgQXJhYmljQWlGaXh0dXJlID0+IEJvb2xlYW4oZml4dHVyZSksXG4gICAgKTtcbiAgICBjb25zdCBoYXNDb25maWd1cmVkQWlGaXh0dXJlID1cbiAgICAgIGFpRml4dHVyZXMubGVuZ3RoID4gMCB8fFxuICAgICAgQm9vbGVhbihvdmVycmlkZXM/LnJlc3VtZUZhaWx1cmUgfHwgb3ZlcnJpZGVzPy5pbnRlcnJ1cHRlZFJlc3VtZSk7XG5cbiAgICBpZiAoYWlGaXh0dXJlcy5sZW5ndGggPiAwICYmIHBhdGguZW5kc1dpdGgoXCIvYXBpL2FpL2NoYXQvc2Vzc2lvbnNcIikpIHtcbiAgICAgIGNvbnN0IHByb2plY3RJZCA9IHVybC5zZWFyY2hQYXJhbXMuZ2V0KFwicHJvamVjdElkXCIpO1xuICAgICAgY29uc3QgcHJvamVjdFNlc3Npb25zID0gYWlGaXh0dXJlcy5maWx0ZXIoXG4gICAgICAgIChmaXh0dXJlKSA9PiAhZml4dHVyZS5wcm9qZWN0SWQgfHwgZml4dHVyZS5wcm9qZWN0SWQgPT09IHByb2plY3RJZCxcbiAgICAgICk7XG4gICAgICByZXR1cm4gcm91dGUuZnVsZmlsbChcbiAgICAgICAganNvblJlc3BvbnNlKFxuICAgICAgICAgIHByb2plY3RTZXNzaW9ucy5tYXAoKGZpeHR1cmUpID0+ICh7XG4gICAgICAgICAgICBpZDogZml4dHVyZS5zZXNzaW9uSWQsXG4gICAgICAgICAgICB0aXRsZTogZml4dHVyZS5xdWVzdGlvbixcbiAgICAgICAgICAgIHVwZGF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAyOjAwLjAwMFpcIixcbiAgICAgICAgICB9KSksXG4gICAgICAgICksXG4gICAgICApO1xuICAgIH1cbiAgICBpZiAob3ZlcnJpZGVzPy5yZXN1bWVGYWlsdXJlICYmIHBhdGguZW5kc1dpdGgoXCIvYXBpL2FpL2NoYXQvc3RyZWFtXCIpKSB7XG4gICAgICBsZXQgcmVxdWVzdEJvZHk6IFJlY29yZDxzdHJpbmcsIHVua25vd24+ID0ge307XG4gICAgICB0cnkge1xuICAgICAgICByZXF1ZXN0Qm9keSA9IHJvdXRlLnJlcXVlc3QoKS5wb3N0RGF0YUpTT04oKSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICAvLyBUaGUgbm9ybWFsIHByb3ZpZGVyLWZyZWUgZmFsbGJhY2sgYmVsb3cgaGFuZGxlcyBtYWxmb3JtZWQgcmVxdWVzdHMuXG4gICAgICB9XG4gICAgICBpZiAoXG4gICAgICAgIHJlcXVlc3RCb2R5LmV4ZWN1dGlvbklkID09PSBvdmVycmlkZXMucmVzdW1lRmFpbHVyZS5maXh0dXJlLmV4ZWN1dGlvbklkXG4gICAgICApIHtcbiAgICAgICAgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoe1xuICAgICAgICAgIHN0YXR1czogMjAwLFxuICAgICAgICAgIGNvbnRlbnRUeXBlOiBcInRleHQvZXZlbnQtc3RyZWFtXCIsXG4gICAgICAgICAgaGVhZGVyczogeyBcIkNhY2hlLUNvbnRyb2xcIjogXCJuby1jYWNoZVwiIH0sXG4gICAgICAgICAgYm9keTogb3ZlcnJpZGVzLnJlc3VtZUZhaWx1cmUuZml4dHVyZS5zdHJlYW1Cb2R5LFxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9XG4gICAgaWYgKG92ZXJyaWRlcz8uaW50ZXJydXB0ZWRSZXN1bWUgJiYgcGF0aC5lbmRzV2l0aChcIi9hcGkvYWkvY2hhdC9zdHJlYW1cIikpIHtcbiAgICAgIGxldCByZXF1ZXN0Qm9keTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gPSB7fTtcbiAgICAgIHRyeSB7XG4gICAgICAgIHJlcXVlc3RCb2R5ID0gcm91dGUucmVxdWVzdCgpLnBvc3REYXRhSlNPTigpIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIC8vIFRoZSBub3JtYWwgcHJvdmlkZXItZnJlZSBmYWxsYmFjayBiZWxvdyBoYW5kbGVzIG1hbGZvcm1lZCByZXF1ZXN0cy5cbiAgICAgIH1cbiAgICAgIGNvbnN0IHsgZml4dHVyZSwgcmVzdW1lZFN0cmVhbUJvZHkgfSA9IG92ZXJyaWRlcy5pbnRlcnJ1cHRlZFJlc3VtZTtcbiAgICAgIGlmIChyZXF1ZXN0Qm9keS5leGVjdXRpb25JZCA9PT0gZml4dHVyZS5leGVjdXRpb25JZCkge1xuICAgICAgICByZXR1cm4gcm91dGUuZnVsZmlsbCh7XG4gICAgICAgICAgc3RhdHVzOiAyMDAsXG4gICAgICAgICAgY29udGVudFR5cGU6IFwidGV4dC9ldmVudC1zdHJlYW1cIixcbiAgICAgICAgICBoZWFkZXJzOiB7IFwiQ2FjaGUtQ29udHJvbFwiOiBcIm5vLWNhY2hlXCIgfSxcbiAgICAgICAgICBib2R5OiByZXN1bWVkU3RyZWFtQm9keSxcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgICBpZiAoIXJlcXVlc3RCb2R5LmV4ZWN1dGlvbklkKSB7XG4gICAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKHtcbiAgICAgICAgICBzdGF0dXM6IDIwMCxcbiAgICAgICAgICBjb250ZW50VHlwZTogXCJ0ZXh0L2V2ZW50LXN0cmVhbVwiLFxuICAgICAgICAgIGhlYWRlcnM6IHsgXCJDYWNoZS1Db250cm9sXCI6IFwibm8tY2FjaGVcIiB9LFxuICAgICAgICAgIC8vIERlbGliZXJhdGVseSBzdG9wIGFmdGVyIHRoZSBkdXJhYmxlIGV4ZWN1dGlvbiBpZGVudGl0eS4gVGhlXG4gICAgICAgICAgLy8gam91cm5leSB3cmFwcyB0aGlzIHJlc3BvbnNlIGluIGEgYnJvd3Nlci1sZXZlbCBzdHJlYW0gZXJyb3IuXG4gICAgICAgICAgYm9keTogZml4dHVyZS5zdHJlYW1Cb2R5LFxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9XG4gICAgbGV0IHJlcXVlc3RlZE1lc3NhZ2U6IHN0cmluZyB8IHVuZGVmaW5lZDtcbiAgICB0cnkge1xuICAgICAgcmVxdWVzdGVkTWVzc2FnZSA9IChyb3V0ZS5yZXF1ZXN0KCkucG9zdERhdGFKU09OKCkgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4pXG4gICAgICAgIC5tZXNzYWdlIGFzIHN0cmluZyB8IHVuZGVmaW5lZDtcbiAgICB9IGNhdGNoIHtcbiAgICAgIC8vIFRoZSBkZWZhdWx0IHByb3ZpZGVyLXVuYXZhaWxhYmxlIHJlc3BvbnNlIGhhbmRsZXMgbWFsZm9ybWVkIHJlcXVlc3RzLlxuICAgIH1cbiAgICBjb25zdCBzdHJlYW1GaXh0dXJlID1cbiAgICAgIGRpc2Nvbm5lY3RBaSA/P1xuICAgICAgYWlGaXh0dXJlcy5maW5kKFxuICAgICAgICAoZml4dHVyZSkgPT5cbiAgICAgICAgICB0eXBlb2YgcmVxdWVzdGVkTWVzc2FnZSA9PT0gXCJzdHJpbmdcIiAmJlxuICAgICAgICAgIChyZXF1ZXN0ZWRNZXNzYWdlID09PSBmaXh0dXJlLnF1ZXN0aW9uIHx8XG4gICAgICAgICAgICByZXF1ZXN0ZWRNZXNzYWdlLmluY2x1ZGVzKGZpeHR1cmUucXVlc3Rpb24pKSxcbiAgICAgICkgPz9cbiAgICAgIGFyYWJpY0FpO1xuICAgIGlmIChzdHJlYW1GaXh0dXJlICYmIHBhdGguZW5kc1dpdGgoXCIvYXBpL2FpL2NoYXQvc3RyZWFtXCIpKVxuICAgICAgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoe1xuICAgICAgICBzdGF0dXM6IDIwMCxcbiAgICAgICAgY29udGVudFR5cGU6IFwidGV4dC9ldmVudC1zdHJlYW1cIixcbiAgICAgICAgaGVhZGVyczogeyBcIkNhY2hlLUNvbnRyb2xcIjogXCJuby1jYWNoZVwiIH0sXG4gICAgICAgIGJvZHk6IHN0cmVhbUZpeHR1cmUuc3RyZWFtQm9keSxcbiAgICAgIH0pO1xuICAgIGNvbnN0IG1lc3NhZ2VGaXh0dXJlID0gYWlGaXh0dXJlcy5maW5kKChmaXh0dXJlKSA9PlxuICAgICAgcGF0aC5lbmRzV2l0aChgL2FwaS9haS9jaGF0LyR7Zml4dHVyZS5zZXNzaW9uSWR9L21lc3NhZ2VzYCksXG4gICAgKTtcbiAgICBpZiAobWVzc2FnZUZpeHR1cmUpXG4gICAgICByZXR1cm4gcm91dGUuZnVsZmlsbChcbiAgICAgICAganNvblJlc3BvbnNlKFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBpZDogYCR7bWVzc2FnZUZpeHR1cmUuc2Vzc2lvbklkfS11c2VyLW1lc3NhZ2VgLFxuICAgICAgICAgICAgc2Vzc2lvbklkOiBtZXNzYWdlRml4dHVyZS5zZXNzaW9uSWQsXG4gICAgICAgICAgICByb2xlOiBcInVzZXJcIixcbiAgICAgICAgICAgIGNvbnRlbnQ6IG1lc3NhZ2VGaXh0dXJlLnF1ZXN0aW9uLFxuICAgICAgICAgICAgY3JlYXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDE6MDAuMDAwWlwiLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgbWVzc2FnZUZpeHR1cmUubWVzc2FnZSxcbiAgICAgICAgXSksXG4gICAgICApO1xuICAgIGlmIChcbiAgICAgIG92ZXJyaWRlcz8uYXVkaXRFeHBvcnQgJiZcbiAgICAgIHBhdGguZW5kc1dpdGgoXCIvYXBpL2FpL2NoYXQvZTJlLWF1ZGl0LXNlc3Npb24vbWVzc2FnZXNcIilcbiAgICApIHtcbiAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKFxuICAgICAgICBqc29uUmVzcG9uc2UoW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIGlkOiBcImUyZS1hdWRpdC11c2VyLW1lc3NhZ2VcIixcbiAgICAgICAgICAgIHNlc3Npb25JZDogXCJlMmUtYXVkaXQtc2Vzc2lvblwiLFxuICAgICAgICAgICAgcm9sZTogXCJ1c2VyXCIsXG4gICAgICAgICAgICBjb250ZW50OiBcIkNvbXBsZXRlZCBhdWRpdCBleGVjdXRpb25cIixcbiAgICAgICAgICAgIGNyZWF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAxOjAwLjAwMFpcIixcbiAgICAgICAgICB9LFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIGlkOiBcImUyZS1hdWRpdC1hc3Npc3RhbnQtbWVzc2FnZVwiLFxuICAgICAgICAgICAgc2Vzc2lvbklkOiBcImUyZS1hdWRpdC1zZXNzaW9uXCIsXG4gICAgICAgICAgICByb2xlOiBcImFzc2lzdGFudFwiLFxuICAgICAgICAgICAgY29udGVudDogXCJDb21wbGV0ZWQgYXVkaXQgZXhlY3V0aW9uXCIsXG4gICAgICAgICAgICBleGVjdXRpb25JZDogRVhFQ1VUSU9OX0lELFxuICAgICAgICAgICAgb3V0Y29tZTogb3ZlcnJpZGVzLmF1ZGl0RXhwb3J0Lm1lc3NhZ2VPdXRjb21lID8/IFwiU1VDQ0VFREVEXCIsXG4gICAgICAgICAgICBjcmVhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMjowMC4wMDBaXCIsXG4gICAgICAgICAgfSxcbiAgICAgICAgXSksXG4gICAgICApO1xuICAgIH1cblxuICAgIGlmIChwYXRoID09PSBcIi9hcGkvZGFzaGJvYXJkXCIpXG4gICAgICByZXR1cm4gcm91dGUuZnVsZmlsbChqc29uUmVzcG9uc2UoZGFzaGJvYXJkRml4dHVyZSkpO1xuICAgIGlmIChvdmVycmlkZXM/LnRhc2tBY3Rpb25zKSB7XG4gICAgICBjb25zdCB2ZXJpZmljYXRpb25NYXRjaCA9IHBhdGgubWF0Y2goXG4gICAgICAgIC9eXFwvYXBpXFwvdGFza3NcXC8oW14vXSspXFwvdmVyaWZpY2F0aW9uJC8sXG4gICAgICApO1xuICAgICAgaWYgKHZlcmlmaWNhdGlvbk1hdGNoICYmIHJvdXRlLnJlcXVlc3QoKS5tZXRob2QoKSA9PT0gXCJQT1NUXCIpIHtcbiAgICAgICAgY29uc3QgWywgdGFza0lkXSA9IHZlcmlmaWNhdGlvbk1hdGNoO1xuICAgICAgICBjb25zdCB0YXNrID0gb3ZlcnJpZGVzLnRhc2tBY3Rpb25zLnRhc2tzLmZpbmQoXG4gICAgICAgICAgKGNhbmRpZGF0ZSkgPT4gY2FuZGlkYXRlLmlkID09PSB0YXNrSWQsXG4gICAgICAgICk7XG4gICAgICAgIGlmICghdGFzaykge1xuICAgICAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKGpzb25SZXNwb25zZSh7IGVycm9yOiBcIlRhc2sgbm90IGZvdW5kXCIgfSwgNDA0KSk7XG4gICAgICAgIH1cblxuICAgICAgICBsZXQgYm9keTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gPSB7fTtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBib2R5ID0gcm91dGUucmVxdWVzdCgpLnBvc3REYXRhSlNPTigpIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAgICAgICB9IGNhdGNoIHtcbiAgICAgICAgICByZXR1cm4gcm91dGUuZnVsZmlsbChcbiAgICAgICAgICAgIGpzb25SZXNwb25zZSh7IGVycm9yOiBcIkludmFsaWQgdmVyaWZpY2F0aW9uIHJlcXVlc3RcIiB9LCA0MDApLFxuICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgcGxhbiA9IHRhc2sucmVtZWRpYXRpb25QbGFuIGFzXG4gICAgICAgICAgfCB7XG4gICAgICAgICAgICAgIHZlcmlmaWNhdGlvbkNoZWNrcz86IEFycmF5PFJlY29yZDxzdHJpbmcsIHVua25vd24+PjtcbiAgICAgICAgICAgICAgdmVyaWZpY2F0aW9uU3RlcHM/OiBzdHJpbmdbXTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB8IHVuZGVmaW5lZDtcbiAgICAgICAgY29uc3QgY2hlY2tzID1cbiAgICAgICAgICBwbGFuPy52ZXJpZmljYXRpb25DaGVja3MgPz9cbiAgICAgICAgICAocGxhbj8udmVyaWZpY2F0aW9uU3RlcHMgPz8gW10pLm1hcCgoZ3VpZGFuY2UsIGluZGV4KSA9PiAoe1xuICAgICAgICAgICAgaWQ6IGBydWxlLXZlcmlmaWNhdGlvbi0ke2luZGV4ICsgMX1gLFxuICAgICAgICAgICAga2luZDogXCJvcGVyYXRvcl9hdHRlc3RhdGlvblwiLFxuICAgICAgICAgICAgZ3VpZGFuY2UsXG4gICAgICAgICAgfSkpO1xuICAgICAgICBjb25zdCBjaGVjayA9IGNoZWNrcy5maW5kKChjYW5kaWRhdGUpID0+IGNhbmRpZGF0ZS5pZCA9PT0gYm9keS5jaGVja0lkKTtcbiAgICAgICAgaWYgKCFjaGVjaykge1xuICAgICAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKFxuICAgICAgICAgICAganNvblJlc3BvbnNlKFxuICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgZXJyb3I6IFwidmVyaWZpY2F0aW9uX2NoZWNrX25vdF9mb3VuZFwiLFxuICAgICAgICAgICAgICAgIHJlYXNvbjpcbiAgICAgICAgICAgICAgICAgIFwiVGhlIHN1Ym1pdHRlZCBjaGVjayBpcyBub3QgcGFydCBvZiB0aGlzIHRhc2sncyBzZXJ2ZXItb3duZWQgdmVyaWZpY2F0aW9uIHBsYW4uXCIsXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIDQwMCxcbiAgICAgICAgICAgICksXG4gICAgICAgICAgKTtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCBwYXNzZWQgPSBib2R5LnBhc3NlZCA9PT0gdHJ1ZTtcbiAgICAgICAgY29uc3QgZXZpZGVuY2UgPVxuICAgICAgICAgIHR5cGVvZiBib2R5LmV2aWRlbmNlID09PSBcInN0cmluZ1wiID8gYm9keS5ldmlkZW5jZS50cmltKCkgOiBcIlwiO1xuICAgICAgICBpZiAocGFzc2VkICYmICFldmlkZW5jZSkge1xuICAgICAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKFxuICAgICAgICAgICAganNvblJlc3BvbnNlKFxuICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgZXJyb3I6IFwidmVyaWZpY2F0aW9uX2V2aWRlbmNlX3JlcXVpcmVkXCIsXG4gICAgICAgICAgICAgICAgcmVhc29uOlxuICAgICAgICAgICAgICAgICAgXCJBIHBhc3NlZCB2ZXJpZmljYXRpb24gY2hlY2sgbXVzdCBpbmNsdWRlIGV4cGxpY2l0IG9wZXJhdG9yIGV2aWRlbmNlLlwiLFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICA0MDAsXG4gICAgICAgICAgICApLFxuICAgICAgICAgICk7XG4gICAgICAgIH1cblxuICAgICAgICBvdmVycmlkZXMudGFza0FjdGlvbnMudmVyaWZpY2F0aW9uUmVxdWVzdHM/LnB1c2goe1xuICAgICAgICAgIHRhc2tJZCxcbiAgICAgICAgICBjaGVja0lkOiBib2R5LmNoZWNrSWQsXG4gICAgICAgICAgcGFzc2VkLFxuICAgICAgICAgIC4uLihldmlkZW5jZSA/IHsgZXZpZGVuY2UgfSA6IHt9KSxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgY29uc3QgcHJpb3JSZXN1bHQgPSAodGFzay52ZXJpZmljYXRpb25SZXN1bHQgPz8ge30pIGFzIHtcbiAgICAgICAgICBzdGVwcz86IEFycmF5PFJlY29yZDxzdHJpbmcsIHVua25vd24+PjtcbiAgICAgICAgICBoaXN0b3J5PzogQXJyYXk8UmVjb3JkPHN0cmluZywgdW5rbm93bj4+O1xuICAgICAgICB9O1xuICAgICAgICBjb25zdCBwcmlvclN0ZXBzID0gcHJpb3JSZXN1bHQuc3RlcHMgPz8gW107XG4gICAgICAgIGNvbnN0IHN0ZXBzID0gY2hlY2tzLm1hcCgoY2FuZGlkYXRlKSA9PiB7XG4gICAgICAgICAgY29uc3QgcHJpb3IgPSBwcmlvclN0ZXBzLmZpbmQoKHN0ZXApID0+IHN0ZXAuaWQgPT09IGNhbmRpZGF0ZS5pZCk7XG4gICAgICAgICAgaWYgKGNhbmRpZGF0ZS5pZCAhPT0gYm9keS5jaGVja0lkKSB7XG4gICAgICAgICAgICByZXR1cm4gKFxuICAgICAgICAgICAgICBwcmlvciA/PyB7XG4gICAgICAgICAgICAgICAgaWQ6IGNhbmRpZGF0ZS5pZCxcbiAgICAgICAgICAgICAgICBuYW1lOiBgUnVsZSB2ZXJpZmljYXRpb24gJHtTdHJpbmcoY2FuZGlkYXRlLmlkKS5yZXBsYWNlKFxuICAgICAgICAgICAgICAgICAgXCJydWxlLXZlcmlmaWNhdGlvbi1cIixcbiAgICAgICAgICAgICAgICAgIFwiI1wiLFxuICAgICAgICAgICAgICAgICl9YCxcbiAgICAgICAgICAgICAgICBraW5kOiBjYW5kaWRhdGUua2luZCA/PyBcIm9wZXJhdG9yX2F0dGVzdGF0aW9uXCIsXG4gICAgICAgICAgICAgICAgZ3VpZGFuY2U6IGNhbmRpZGF0ZS5ndWlkYW5jZSxcbiAgICAgICAgICAgICAgICBwYXNzZWQ6IGZhbHNlLFxuICAgICAgICAgICAgICAgIG91dHB1dDogXCJOb3QgcmVjb3JkZWQg4oCUIG9wZXJhdG9yIGV2aWRlbmNlIGlzIHJlcXVpcmVkXCIsXG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICk7XG4gICAgICAgICAgfVxuICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBpZDogY2FuZGlkYXRlLmlkLFxuICAgICAgICAgICAgbmFtZTogYFJ1bGUgdmVyaWZpY2F0aW9uICR7U3RyaW5nKGNhbmRpZGF0ZS5pZCkucmVwbGFjZShcbiAgICAgICAgICAgICAgXCJydWxlLXZlcmlmaWNhdGlvbi1cIixcbiAgICAgICAgICAgICAgXCIjXCIsXG4gICAgICAgICAgICApfWAsXG4gICAgICAgICAgICBraW5kOiBjYW5kaWRhdGUua2luZCA/PyBcIm9wZXJhdG9yX2F0dGVzdGF0aW9uXCIsXG4gICAgICAgICAgICBndWlkYW5jZTogY2FuZGlkYXRlLmd1aWRhbmNlLFxuICAgICAgICAgICAgcGFzc2VkLFxuICAgICAgICAgICAgLi4uKGV2aWRlbmNlID8geyBldmlkZW5jZSB9IDoge30pLFxuICAgICAgICAgICAgb3V0cHV0OiBwYXNzZWRcbiAgICAgICAgICAgICAgPyBcIk9wZXJhdG9yIGV2aWRlbmNlIHJlY29yZGVkXCJcbiAgICAgICAgICAgICAgOiBcIk9wZXJhdG9yIHJlcG9ydGVkIHRoYXQgdGhlIGNoZWNrIGZhaWxlZFwiLFxuICAgICAgICAgIH07XG4gICAgICAgIH0pO1xuICAgICAgICBjb25zdCBjb21wbGV0ZWQgPSBzdGVwcy5ldmVyeShcbiAgICAgICAgICAoc3RlcCkgPT4gc3RlcC5wYXNzZWQgPT09IHRydWUgJiYgQm9vbGVhbihTdHJpbmcoc3RlcC5ldmlkZW5jZSA/PyBcIlwiKS50cmltKCkpLFxuICAgICAgICApO1xuICAgICAgICB0YXNrLnN0YXR1cyA9IGNvbXBsZXRlZCA/IFwiY29tcGxldGVkXCIgOiBcInZlcmlmeWluZ1wiO1xuICAgICAgICB0YXNrLnZlcmlmaWNhdGlvblJlc3VsdCA9IHtcbiAgICAgICAgICBwYXNzZWQ6IGNvbXBsZXRlZCxcbiAgICAgICAgICBkZWNpc2lvbjogY29tcGxldGVkID8gXCJ2ZXJpZmllZFwiIDogXCJpbmNvbXBsZXRlXCIsXG4gICAgICAgICAgc3RlcHMsXG4gICAgICAgICAgaGlzdG9yeTogW1xuICAgICAgICAgICAgLi4uKHByaW9yUmVzdWx0Lmhpc3RvcnkgPz8gW10pLFxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBpZDogYHZlcmlmaWNhdGlvbi1oaXN0b3J5LSR7U3RyaW5nKFxuICAgICAgICAgICAgICAgIChwcmlvclJlc3VsdC5oaXN0b3J5ID8/IFtdKS5sZW5ndGggKyAxLFxuICAgICAgICAgICAgICApfWAsXG4gICAgICAgICAgICAgIGNoZWNrSWQ6IGNoZWNrLmlkLFxuICAgICAgICAgICAgICBuYW1lOiBgUnVsZSB2ZXJpZmljYXRpb24gJHtTdHJpbmcoY2hlY2suaWQpLnJlcGxhY2UoXG4gICAgICAgICAgICAgICAgXCJydWxlLXZlcmlmaWNhdGlvbi1cIixcbiAgICAgICAgICAgICAgICBcIiNcIixcbiAgICAgICAgICAgICAgKX1gLFxuICAgICAgICAgICAgICBraW5kOiBjaGVjay5raW5kID8/IFwib3BlcmF0b3JfYXR0ZXN0YXRpb25cIixcbiAgICAgICAgICAgICAgZ3VpZGFuY2U6IGNoZWNrLmd1aWRhbmNlLFxuICAgICAgICAgICAgICBwYXNzZWQsXG4gICAgICAgICAgICAgIC4uLihldmlkZW5jZSA/IHsgZXZpZGVuY2UgfSA6IHt9KSxcbiAgICAgICAgICAgICAgYWN0b3I6IFwiZTJlLW9wZXJhdG9yXCIsXG4gICAgICAgICAgICAgIHJlY29yZGVkQXQ6IGAyMDI2LTAxLTAxVDAwOjAke1xuICAgICAgICAgICAgICAgIChwcmlvclJlc3VsdC5oaXN0b3J5ID8/IFtdKS5sZW5ndGggKyAyXG4gICAgICAgICAgICAgIH06MDAuMDAwWmAsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIF0sXG4gICAgICAgIH07XG4gICAgICAgIGlmICh0YXNrLnJlbWVkaWF0aW9uUGxhbiAmJiBjb21wbGV0ZWQpIHtcbiAgICAgICAgICB0YXNrLnJlbWVkaWF0aW9uUGxhbiA9IHtcbiAgICAgICAgICAgIC4uLih0YXNrLnJlbWVkaWF0aW9uUGxhbiBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiksXG4gICAgICAgICAgICBzdGF0dXM6IFwidmVyaWZpZWRcIixcbiAgICAgICAgICB9O1xuICAgICAgICB9XG4gICAgICAgIHRhc2sudXBkYXRlZEF0ID0gXCIyMDI2LTAxLTAxVDAwOjA0OjAwLjAwMFpcIjtcbiAgICAgICAgaWYgKGNvbXBsZXRlZCkgdGFzay5jb21wbGV0ZWRBdCA9IHRhc2sudXBkYXRlZEF0O1xuICAgICAgICByZXR1cm4gcm91dGUuZnVsZmlsbChqc29uUmVzcG9uc2UodGFzaykpO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBhY3Rpb25NYXRjaCA9IHBhdGgubWF0Y2goL15cXC9hcGlcXC90YXNrc1xcLyhbXi9dKylcXC8oZXhlY3V0ZXxyZXRyeSkkLyk7XG4gICAgICBpZiAoYWN0aW9uTWF0Y2ggJiYgcm91dGUucmVxdWVzdCgpLm1ldGhvZCgpID09PSBcIlBPU1RcIikge1xuICAgICAgICBjb25zdCBbLCB0YXNrSWQsIGFjdGlvbl0gPSBhY3Rpb25NYXRjaDtcbiAgICAgICAgY29uc3QgdGFzayA9IG92ZXJyaWRlcy50YXNrQWN0aW9ucy50YXNrcy5maW5kKFxuICAgICAgICAgIChjYW5kaWRhdGUpID0+IGNhbmRpZGF0ZS5pZCA9PT0gdGFza0lkLFxuICAgICAgICApO1xuICAgICAgICBpZiAoIXRhc2spIHtcbiAgICAgICAgICByZXR1cm4gcm91dGUuZnVsZmlsbChqc29uUmVzcG9uc2UoeyBlcnJvcjogXCJUYXNrIG5vdCBmb3VuZFwiIH0sIDQwNCkpO1xuICAgICAgICB9XG5cbiAgICAgICAgb3ZlcnJpZGVzLnRhc2tBY3Rpb25zLnJlcXVlc3RzLnB1c2goYCR7YWN0aW9ufToke3Rhc2tJZH1gKTtcbiAgICAgICAgaWYgKGFjdGlvbiA9PT0gXCJleGVjdXRlXCIpIHtcbiAgICAgICAgICB0YXNrLnN0YXR1cyA9IFwicnVubmluZ1wiO1xuICAgICAgICAgIHRhc2sudXBkYXRlZEF0ID0gXCIyMDI2LTAxLTAxVDAwOjAyOjAwLjAwMFpcIjtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0YXNrLnN0YXR1cyA9IFwicXVldWVkXCI7XG4gICAgICAgICAgdGFzay5yZXRyeUNvdW50ID0gTnVtYmVyKHRhc2sucmV0cnlDb3VudCA/PyAwKSArIDE7XG4gICAgICAgICAgdGFzay51cGRhdGVkQXQgPSBcIjIwMjYtMDEtMDFUMDA6MDI6MDAuMDAwWlwiO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKGpzb25SZXNwb25zZSh0YXNrLCAyMDIpKTtcbiAgICAgIH1cbiAgICB9XG4gICAgaWYgKHBhdGggPT09IFwiL2FwaS90YXNrc1wiKSB7XG4gICAgICByZXR1cm4gcm91dGUuZnVsZmlsbChcbiAgICAgICAganNvblJlc3BvbnNlKFxuICAgICAgICAgIG92ZXJyaWRlcz8udGFza0FjdGlvbnM/LnRhc2tzID8/XG4gICAgICAgICAgICBvdmVycmlkZXM/LnJlY292ZXJ5VGFza3MgPz9cbiAgICAgICAgICAgIChvdmVycmlkZXM/LmxpdmVUYXNrXG4gICAgICAgICAgICAgID8gW1xuICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICBpZDogb3ZlcnJpZGVzLmxpdmVUYXNrLmlkLFxuICAgICAgICAgICAgICAgICAgICBwcm9qZWN0SWQ6IG92ZXJyaWRlcy5saXZlVGFzay5wcm9qZWN0SWQsXG4gICAgICAgICAgICAgICAgICAgIHRpdGxlOiBvdmVycmlkZXMubGl2ZVRhc2sudGl0bGUsXG4gICAgICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiBcIkEgdGFzayB1c2VkIHRvIHZlcmlmeSBsaXZlIGRhc2hib2FyZCB1cGRhdGVzLlwiLFxuICAgICAgICAgICAgICAgICAgICBzdGF0dXM6IFwicnVubmluZ1wiLFxuICAgICAgICAgICAgICAgICAgICBwcmlvcml0eTogXCJwMVwiLFxuICAgICAgICAgICAgICAgICAgICByZWxhdGVkRmlsZXM6IFtdLFxuICAgICAgICAgICAgICAgICAgICByZXRyeUNvdW50OiAwLFxuICAgICAgICAgICAgICAgICAgICBtYXhSZXRyaWVzOiAyLFxuICAgICAgICAgICAgICAgICAgICBjcmVhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMDowMC4wMDBaXCIsXG4gICAgICAgICAgICAgICAgICAgIHVwZGF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAwOjAxLjAwMFpcIixcbiAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgXVxuICAgICAgICAgICAgICA6IFtdKSxcbiAgICAgICAgKSxcbiAgICAgICk7XG4gICAgfVxuICAgIGlmIChwYXRoID09PSBcIi9hcGkvd29ya2Zsb3dzXCIpIHtcbiAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKFxuICAgICAgICBqc29uUmVzcG9uc2Uob3ZlcnJpZGVzPy5yZWNvdmVyeVdvcmtmbG93cyA/PyBbXSksXG4gICAgICApO1xuICAgIH1cbiAgICBjb25zdCB3b3JrZmxvd0V4ZWN1dGlvbnNNYXRjaCA9IHBhdGgubWF0Y2goXG4gICAgICAvXlxcL2FwaVxcL3dvcmtmbG93c1xcLyhbXi9dKylcXC9leGVjdXRpb25zJC8sXG4gICAgKTtcbiAgICBpZiAod29ya2Zsb3dFeGVjdXRpb25zTWF0Y2gpIHtcbiAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKFxuICAgICAgICBqc29uUmVzcG9uc2UoXG4gICAgICAgICAgb3ZlcnJpZGVzPy5yZWNvdmVyeVdvcmtmbG93RXhlY3V0aW9ucz8uW3dvcmtmbG93RXhlY3V0aW9uc01hdGNoWzFdXSA/P1xuICAgICAgICAgICAgW10sXG4gICAgICAgICksXG4gICAgICApO1xuICAgIH1cbiAgICBpZiAoXG4gICAgICBvdmVycmlkZXM/LmF1ZGl0RXhwb3J0ICYmXG4gICAgICBwYXRoID09PSBgL2FwaS9haS9leGVjdXRpb25zLyR7RVhFQ1VUSU9OX0lEfS9hdWRpdC1leHBvcnRgXG4gICAgKSB7XG4gICAgICBvdmVycmlkZXMuYXVkaXRFeHBvcnQucmVxdWVzdHMucHVzaChyb3V0ZS5yZXF1ZXN0KCkudXJsKCkpO1xuICAgICAgaWYgKFxuICAgICAgICBvdmVycmlkZXMuYXVkaXRFeHBvcnQuZmFpbEZpcnN0UHJldmlldyAmJlxuICAgICAgICBvdmVycmlkZXMuYXVkaXRFeHBvcnQucmVxdWVzdHMubGVuZ3RoID09PSAxXG4gICAgICApIHtcbiAgICAgICAgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoXG4gICAgICAgICAganNvblJlc3BvbnNlKFxuICAgICAgICAgICAgeyBlcnJvcjogXCJUZW1wb3JhcnkgcHJldmlldyBuZXR3b3JrIGZhaWx1cmUuXCIgfSxcbiAgICAgICAgICAgIDUwMyxcbiAgICAgICAgICApLFxuICAgICAgICApO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoXG4gICAgICAgIGpzb25SZXNwb25zZShvdmVycmlkZXMuYXVkaXRFeHBvcnQuYm9keSwgMjAwLCB7XG4gICAgICAgICAgXCJDb250ZW50LURpc3Bvc2l0aW9uXCI6IGBhdHRhY2htZW50OyBmaWxlbmFtZT1cIiR7b3ZlcnJpZGVzLmF1ZGl0RXhwb3J0LmZpbGVuYW1lfVwiYCxcbiAgICAgICAgfSksXG4gICAgICApO1xuICAgIH1cbiAgICBpZiAob3ZlcnJpZGVzPy5hcmNoaXZlVXBsb2FkICYmIHBhdGggPT09IFwiL2FwaS91cGxvYWQvYXJjaGl2ZVwiKSB7XG4gICAgICBjb25zdCBjb250ZW50VHlwZSA9IHJvdXRlLnJlcXVlc3QoKS5oZWFkZXJzKClbXCJjb250ZW50LXR5cGVcIl0gPz8gXCJcIjtcbiAgICAgIGlmICghY29udGVudFR5cGUuc3RhcnRzV2l0aChcIm11bHRpcGFydC9mb3JtLWRhdGE7XCIpKSB7XG4gICAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKFxuICAgICAgICAgIGpzb25SZXNwb25zZSh7IGVycm9yOiBcIkV4cGVjdGVkIG11bHRpcGFydCBhcmNoaXZlIHVwbG9hZC5cIiB9LCA0MDApLFxuICAgICAgICApO1xuICAgICAgfVxuICAgICAgY29uc3QgYm9keSA9IHJvdXRlLnJlcXVlc3QoKS5wb3N0RGF0YUJ1ZmZlcigpO1xuICAgICAgaWYgKCFib2R5Py5pbmNsdWRlcyhCdWZmZXIuZnJvbShcImRhc2hib2FyZC1qb3VybmV5LnppcFwiKSkpIHtcbiAgICAgICAgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoXG4gICAgICAgICAganNvblJlc3BvbnNlKHsgZXJyb3I6IFwiRXhwZWN0ZWQgdGhlIGpvdXJuZXkgYXJjaGl2ZSBwYXlsb2FkLlwiIH0sIDQwMCksXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgICByZXR1cm4gcm91dGUuZnVsZmlsbChcbiAgICAgICAganNvblJlc3BvbnNlKFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIHVwbG9hZElkOiBvdmVycmlkZXMuYXJjaGl2ZVVwbG9hZC51cGxvYWRJZCxcbiAgICAgICAgICAgIG9yaWdpbmFsTmFtZTogb3ZlcnJpZGVzLmFyY2hpdmVVcGxvYWQub3JpZ2luYWxOYW1lLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgMjAxLFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIFwiYWNjZXNzLWNvbnRyb2wtYWxsb3ctb3JpZ2luXCI6IG5ldyBVUkwocGFnZS51cmwoKSkub3JpZ2luLFxuICAgICAgICAgICAgXCJhY2Nlc3MtY29udHJvbC1hbGxvdy1jcmVkZW50aWFsc1wiOiBcInRydWVcIixcbiAgICAgICAgICB9LFxuICAgICAgICApLFxuICAgICAgKTtcbiAgICB9XG4gICAgaWYgKG92ZXJyaWRlcz8ubGl2ZVRhc2sgJiYgcGF0aCA9PT0gXCIvYXBpL3Rhc2tzXCIpIHtcbiAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKFxuICAgICAgICBqc29uUmVzcG9uc2UoW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIGlkOiBvdmVycmlkZXMubGl2ZVRhc2suaWQsXG4gICAgICAgICAgICBwcm9qZWN0SWQ6IG92ZXJyaWRlcy5saXZlVGFzay5wcm9qZWN0SWQsXG4gICAgICAgICAgICB0aXRsZTogb3ZlcnJpZGVzLmxpdmVUYXNrLnRpdGxlLFxuICAgICAgICAgICAgZGVzY3JpcHRpb246IFwiQSB0YXNrIHVzZWQgdG8gdmVyaWZ5IGxpdmUgZGFzaGJvYXJkIHVwZGF0ZXMuXCIsXG4gICAgICAgICAgICBzdGF0dXM6IFwicnVubmluZ1wiLFxuICAgICAgICAgICAgcGhhc2U6IFwiRXhlY3V0aW9uXCIsXG4gICAgICAgICAgICByZWxhdGVkRmlsZXM6IFtdLFxuICAgICAgICAgICAgcmV0cnlDb3VudDogMCxcbiAgICAgICAgICAgIG1heFJldHJpZXM6IDIsXG4gICAgICAgICAgICBjcmVhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMDowMC4wMDBaXCIsXG4gICAgICAgICAgICB1cGRhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMDowMS4wMDBaXCIsXG4gICAgICAgICAgfSxcbiAgICAgICAgXSksXG4gICAgICApO1xuICAgIH1cbiAgICBpZiAoXG4gICAgICBvdmVycmlkZXM/LmxpdmVUYXNrICYmXG4gICAgICBwYXRoID09PSBgL2FwaS90YXNrcy8ke292ZXJyaWRlcy5saXZlVGFzay5pZH0vbG9nc2BcbiAgICApIHtcbiAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKGpzb25SZXNwb25zZShvdmVycmlkZXMubGl2ZVRhc2suaW5pdGlhbExvZ3MgPz8gW10pKTtcbiAgICB9XG4gICAgaWYgKFxuICAgICAgb3ZlcnJpZGVzPy5saXZlVGFzayAmJlxuICAgICAgcGF0aCA9PT0gYC9hcGkvdGFza3MvJHtvdmVycmlkZXMubGl2ZVRhc2suaWR9L2xvZ3Mvc3RyZWFtYFxuICAgICkge1xuICAgICAgY29uc3Qgc3RyZWFtUmVxdWVzdHMgPSBvdmVycmlkZXMubGl2ZVRhc2suc3RyZWFtUmVxdWVzdHM7XG4gICAgICBzdHJlYW1SZXF1ZXN0cz8ucHVzaChyb3V0ZS5yZXF1ZXN0KCkudXJsKCkpO1xuICAgICAgaWYgKFxuICAgICAgICAob3ZlcnJpZGVzLmxpdmVUYXNrLmZhaWxGaXJzdFN0cmVhbSAmJiBzdHJlYW1SZXF1ZXN0cz8ubGVuZ3RoID09PSAxKSB8fFxuICAgICAgICAob3ZlcnJpZGVzLmxpdmVUYXNrLmZhaWxTdHJlYW1BdHRlbXB0cyAmJlxuICAgICAgICAgIHN0cmVhbVJlcXVlc3RzICYmXG4gICAgICAgICAgc3RyZWFtUmVxdWVzdHMubGVuZ3RoIDw9IG92ZXJyaWRlcy5saXZlVGFzay5mYWlsU3RyZWFtQXR0ZW1wdHMpXG4gICAgICApIHtcbiAgICAgICAgLy8gRXhlcmNpc2UgdGhlIGJyb3dzZXIncyByZWNvbm5lY3QgcGF0aCB3aXRob3V0IGNoYW5naW5nIHRoZSB0YXNrXG4gICAgICAgIC8vIGxpZmVjeWNsZSBvciBzeW50aGVzaXppbmcgYSBzdWNjZXNzZnVsIHJlc3BvbnNlIGZvciB0aGUgZmlyc3QgdHJ5LlxuICAgICAgICByZXR1cm4gcm91dGUuYWJvcnQoXCJjb25uZWN0aW9ucmVzZXRcIik7XG4gICAgICB9XG4gICAgICByZXR1cm4gcm91dGUuZnVsZmlsbCh7XG4gICAgICAgIHN0YXR1czogMjAwLFxuICAgICAgICBjb250ZW50VHlwZTogXCJ0ZXh0L2V2ZW50LXN0cmVhbVwiLFxuICAgICAgICBoZWFkZXJzOiB7XG4gICAgICAgICAgXCJDYWNoZS1Db250cm9sXCI6IFwibm8tY2FjaGVcIixcbiAgICAgICAgICBcImFjY2Vzcy1jb250cm9sLWFsbG93LW9yaWdpblwiOiBuZXcgVVJMKHBhZ2UudXJsKCkpLm9yaWdpbixcbiAgICAgICAgICBcImFjY2Vzcy1jb250cm9sLWFsbG93LWNyZWRlbnRpYWxzXCI6IFwidHJ1ZVwiLFxuICAgICAgICB9LFxuICAgICAgICBib2R5OiBgZXZlbnQ6IGxvZ1xcbmRhdGE6ICR7SlNPTi5zdHJpbmdpZnkob3ZlcnJpZGVzLmxpdmVUYXNrLmxvZyl9XFxuXFxuYCxcbiAgICAgIH0pO1xuICAgIH1cbiAgICBpZiAocGF0aCA9PT0gXCIvYXBpL3Byb2plY3RzXCIpIHtcbiAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKFxuICAgICAgICBqc29uUmVzcG9uc2UoXG4gICAgICAgICAgb3ZlcnJpZGVzPy5wcm9qZWN0cyA/PyBbXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIGlkOiBcImUyZS1wcm9qZWN0XCIsXG4gICAgICAgICAgICAgIG5hbWU6IFwiU21va2UgUHJvamVjdFwiLFxuICAgICAgICAgICAgICBsYW5ndWFnZTogXCJUeXBlU2NyaXB0XCIsXG4gICAgICAgICAgICAgIGZyYW1ld29yazogXCJSZWFjdFwiLFxuICAgICAgICAgICAgICBzdGF0dXM6IFwiYWN0aXZlXCIsXG4gICAgICAgICAgICAgIHJvb3RQYXRoOiBcIi9jb250cm9sbGVkL3Ntb2tlXCIsXG4gICAgICAgICAgICAgIHF1YWxpdHlTY29yZTogOTIsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIF0sXG4gICAgICAgICksXG4gICAgICApO1xuICAgIH1cbiAgICBpZiAoaGFzQ29uZmlndXJlZEFpRml4dHVyZSAmJiBwYXRoID09PSBcIi9hcGkvYWkvYWN0aXZlLXByb3ZpZGVyXCIpIHtcbiAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKFxuICAgICAgICBqc29uUmVzcG9uc2UoeyBwcm92aWRlcjogXCJvcGVucm91dGVyXCIsIGNvbmZpZ3VyZWQ6IHRydWUgfSksXG4gICAgICApO1xuICAgIH1cbiAgICBpZiAoXG4gICAgICBvdmVycmlkZXM/LmRlbGl2ZXJ5UmVjb3ZlcnkgJiZcbiAgICAgIHBhdGggPT09IFwiL2FwaS9haS9kZWxpdmVyeS9yZWNvdmVyYWJsZVwiXG4gICAgKSB7XG4gICAgICBvdmVycmlkZXMuZGVsaXZlcnlSZWNvdmVyeS5yZXF1ZXN0cy5wdXNoKHJvdXRlLnJlcXVlc3QoKS51cmwoKSk7XG4gICAgICByZXR1cm4gcm91dGUuZnVsZmlsbChcbiAgICAgICAganNvblJlc3BvbnNlKHsgb3BlcmF0aW9uczogb3ZlcnJpZGVzLmRlbGl2ZXJ5UmVjb3Zlcnkub3BlcmF0aW9ucyB9KSxcbiAgICAgICk7XG4gICAgfVxuICAgIGlmIChcbiAgICAgIG92ZXJyaWRlcz8uZGVsaXZlcnlSZWNvdmVyeT8ucmVjb3ZlcnlBY3Rpb24gJiZcbiAgICAgIHBhdGggPT09XG4gICAgICAgIGAvYXBpL2FpL2RlbGl2ZXJ5LyR7b3ZlcnJpZGVzLmRlbGl2ZXJ5UmVjb3ZlcnkucmVjb3ZlcnlBY3Rpb24ucHJvcG9zYWxJZH0vJHtvdmVycmlkZXMuZGVsaXZlcnlSZWNvdmVyeS5yZWNvdmVyeUFjdGlvbi5hY3Rpb259YFxuICAgICkge1xuICAgICAgb3ZlcnJpZGVzLmRlbGl2ZXJ5UmVjb3ZlcnkuYWN0aW9uUmVxdWVzdHM/LnB1c2gocm91dGUucmVxdWVzdCgpLnVybCgpKTtcbiAgICAgIGlmIChvdmVycmlkZXMuZGVsaXZlcnlSZWNvdmVyeS5yZWNvdmVyeUFjdGlvbi5uZXh0T3BlcmF0aW9ucykge1xuICAgICAgICBvdmVycmlkZXMuZGVsaXZlcnlSZWNvdmVyeS5vcGVyYXRpb25zID1cbiAgICAgICAgICBvdmVycmlkZXMuZGVsaXZlcnlSZWNvdmVyeS5yZWNvdmVyeUFjdGlvbi5uZXh0T3BlcmF0aW9ucztcbiAgICAgIH1cbiAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKFxuICAgICAgICBqc29uUmVzcG9uc2UoXG4gICAgICAgICAgb3ZlcnJpZGVzLmRlbGl2ZXJ5UmVjb3ZlcnkucmVjb3ZlcnlBY3Rpb24ucmVzcG9uc2UsXG4gICAgICAgICAgb3ZlcnJpZGVzLmRlbGl2ZXJ5UmVjb3ZlcnkucmVjb3ZlcnlBY3Rpb24uc3RhdHVzID8/IDQwOSxcbiAgICAgICAgKSxcbiAgICAgICk7XG4gICAgfVxuICAgIGlmIChwYXRoID09PSBcIi9hcGkvZXZlbnRzXCIpIHtcbiAgICAgIGNvbnN0IGV2ZW50cyA9IG92ZXJyaWRlcz8uZXZlbnRzID8/IGRhc2hib2FyZEZpeHR1cmUucmVjZW50RXZlbnRzO1xuICAgICAgY29uc3Qgc2VhcmNoID0gdXJsLnNlYXJjaFBhcmFtcy5nZXQoXCJzZWFyY2hcIik/LnRvTG93ZXJDYXNlKCk7XG4gICAgICBjb25zdCBmaWx0ZXJlZEV2ZW50cyA9IGV2ZW50cy5maWx0ZXIoKGV2ZW50KSA9PiB7XG4gICAgICAgIGNvbnN0IHByb2plY3RJZCA9IHVybC5zZWFyY2hQYXJhbXMuZ2V0KFwicHJvamVjdElkXCIpO1xuICAgICAgICBjb25zdCBzZXZlcml0eSA9IHVybC5zZWFyY2hQYXJhbXMuZ2V0KFwic2V2ZXJpdHlcIik7XG4gICAgICAgIGNvbnN0IGNvcnJlbGF0aW9uSWQgPSB1cmwuc2VhcmNoUGFyYW1zLmdldChcImNvcnJlbGF0aW9uSWRcIik7XG4gICAgICAgIHJldHVybiAoXG4gICAgICAgICAgKCFwcm9qZWN0SWQgfHwgZXZlbnQucHJvamVjdElkID09PSBwcm9qZWN0SWQpICYmXG4gICAgICAgICAgKCFzZXZlcml0eSB8fCBldmVudC5zZXZlcml0eSA9PT0gc2V2ZXJpdHkpICYmXG4gICAgICAgICAgKCFjb3JyZWxhdGlvbklkIHx8IGV2ZW50LmNvcnJlbGF0aW9uSWQgPT09IGNvcnJlbGF0aW9uSWQpICYmXG4gICAgICAgICAgKCFzZWFyY2ggfHxcbiAgICAgICAgICAgIFtldmVudC5tZXNzYWdlLCBldmVudC50eXBlLCBldmVudC5jb3JyZWxhdGlvbklkXVxuICAgICAgICAgICAgICAuZmlsdGVyKCh2YWx1ZSk6IHZhbHVlIGlzIHN0cmluZyA9PiB0eXBlb2YgdmFsdWUgPT09IFwic3RyaW5nXCIpXG4gICAgICAgICAgICAgIC5zb21lKCh2YWx1ZSkgPT4gdmFsdWUudG9Mb3dlckNhc2UoKS5pbmNsdWRlcyhzZWFyY2gpKSlcbiAgICAgICAgKTtcbiAgICAgIH0pO1xuICAgICAgY29uc3QgbGltaXQgPSBOdW1iZXIodXJsLnNlYXJjaFBhcmFtcy5nZXQoXCJsaW1pdFwiKSkgfHwgNTA7XG4gICAgICBjb25zdCBwYWdlID0gTnVtYmVyKHVybC5zZWFyY2hQYXJhbXMuZ2V0KFwicGFnZVwiKSkgfHwgMTtcbiAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKFxuICAgICAgICBqc29uUmVzcG9uc2Uoe1xuICAgICAgICAgIGV2ZW50czogZmlsdGVyZWRFdmVudHMuc2xpY2UoKHBhZ2UgLSAxKSAqIGxpbWl0LCBwYWdlICogbGltaXQpLFxuICAgICAgICAgIHRvdGFsOiBmaWx0ZXJlZEV2ZW50cy5sZW5ndGgsXG4gICAgICAgIH0pLFxuICAgICAgKTtcbiAgICB9XG4gICAgaWYgKFxuICAgICAgb3ZlcnJpZGVzPy5yZXN1bWVGYWlsdXJlICYmXG4gICAgICBwYXRoID09PVxuICAgICAgICBgL2FwaS9haS9leGVjdXRpb25zLyR7b3ZlcnJpZGVzLnJlc3VtZUZhaWx1cmUuZml4dHVyZS5leGVjdXRpb25JZH1gXG4gICAgKSB7XG4gICAgICByZXR1cm4gcm91dGUuZnVsZmlsbChqc29uUmVzcG9uc2Uob3ZlcnJpZGVzLnJlc3VtZUZhaWx1cmUuZXhlY3V0aW9uKSk7XG4gICAgfVxuICAgIGlmIChcbiAgICAgIG92ZXJyaWRlcz8uaW50ZXJydXB0ZWRSZXN1bWUgJiZcbiAgICAgIHBhdGggPT09XG4gICAgICAgIGAvYXBpL2FpL2V4ZWN1dGlvbnMvJHtvdmVycmlkZXMuaW50ZXJydXB0ZWRSZXN1bWUuZml4dHVyZS5leGVjdXRpb25JZH1gXG4gICAgKSB7XG4gICAgICByZXR1cm4gcm91dGUuZnVsZmlsbChqc29uUmVzcG9uc2Uob3ZlcnJpZGVzLmludGVycnVwdGVkUmVzdW1lLmV4ZWN1dGlvbikpO1xuICAgIH1cbiAgICBpZiAoXG4gICAgICBvdmVycmlkZXM/LmludGVycnVwdGVkUmVzdW1lICYmXG4gICAgICBwYXRoID09PVxuICAgICAgICBgL2FwaS9haS9leGVjdXRpb25zLyR7b3ZlcnJpZGVzLmludGVycnVwdGVkUmVzdW1lLmZpeHR1cmUuZXhlY3V0aW9uSWR9L3Jlc3VtZS1jYXBhYmlsaXR5YFxuICAgICkge1xuICAgICAgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoXG4gICAgICAgIGpzb25SZXNwb25zZSh7XG4gICAgICAgICAgZXhlY3V0aW9uSWQ6IG92ZXJyaWRlcy5pbnRlcnJ1cHRlZFJlc3VtZS5maXh0dXJlLmV4ZWN1dGlvbklkLFxuICAgICAgICAgIHJlc3VtZVRva2VuOiBvdmVycmlkZXMuaW50ZXJydXB0ZWRSZXN1bWUucmVjb3ZlcmVkVG9rZW4sXG4gICAgICAgIH0pLFxuICAgICAgKTtcbiAgICB9XG4gICAgaWYgKHBhdGggPT09IGAvYXBpL2FpL2V4ZWN1dGlvbnMvJHtFWEVDVVRJT05fSUR9YClcbiAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKFxuICAgICAgICBqc29uUmVzcG9uc2Uob3ZlcnJpZGVzPy5hdWRpdEV4cG9ydD8uZXhlY3V0aW9uID8/IGV4ZWN1dGlvbkZpeHR1cmUpLFxuICAgICAgKTtcbiAgICBpZiAocGF0aCA9PT0gXCIvYXBpL2FpL21pc3Npb24tY29udHJvbFwiKVxuICAgICAgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoXG4gICAgICAgIGpzb25SZXNwb25zZSh7IHVwZGF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAxOjAwLjAwMFpcIiwgZXhlY3V0aW9uczogW10gfSksXG4gICAgICApO1xuXG4gICAgLy8gQUkgaXMgZGVsaWJlcmF0ZWx5IG5vdCBleGVjdXRlZCBpbiB0aGlzIHNtb2tlIGpvdXJuZXkuIFRoaXMgcmVzcG9uc2VcbiAgICAvLyB2ZXJpZmllcyB0aGUgdXNlci12aXNpYmxlIHVuYXZhaWxhYmxlL2VtcHR5IHN0YXRlIHdpdGhvdXQgYSBwcm92aWRlci5cbiAgICBpZiAocGF0aC5zdGFydHNXaXRoKFwiL2FwaS9haS9cIikpXG4gICAgICByZXR1cm4gcm91dGUuZnVsZmlsbChcbiAgICAgICAganNvblJlc3BvbnNlKHsgZXJyb3I6IFwiQUkgcHJvdmlkZXIgbm90IGNvbmZpZ3VyZWRcIiB9LCA0MjgpLFxuICAgICAgKTtcblxuICAgIHJldHVybiByb3V0ZS5jb250aW51ZSgpO1xuICB9KTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gaW5zdGFsbEFyYWJpY0FpRml4dHVyZShcbiAgcGFnZTogUGFnZSxcbiAgb3B0aW9ucz86IHtcbiAgICBibG9ja2VkPzogYm9vbGVhbjtcbiAgICBzZXNzaW9uSWQ/OiBzdHJpbmc7XG4gICAgcXVlc3Rpb24/OiBzdHJpbmc7XG4gICAgcHJvamVjdElkPzogc3RyaW5nO1xuICB9LFxuKSB7XG4gIGNvbnN0IHNlc3Npb25JZCA9IG9wdGlvbnM/LnNlc3Npb25JZCA/PyBcImUyZS1hcmFiaWMtYWktc2Vzc2lvblwiO1xuICBjb25zdCBtZXNzYWdlSWQgPSBcImUyZS1hcmFiaWMtYWktbWVzc2FnZVwiO1xuICBjb25zdCBzb3VyY2UgPSBcInNyYy9leGVjdXRpb24tdG9vbHMudHNcIjtcbiAgY29uc3QgYmxvY2tlZCA9IG9wdGlvbnM/LmJsb2NrZWQgPT09IHRydWU7XG4gIGNvbnN0IHF1ZXN0aW9uID1cbiAgICBvcHRpb25zPy5xdWVzdGlvbiA/P1xuICAgIFwi2YXYp9iw2Kcg2YrYrdiv2Ksg2LnZhtivINin2YbYqtmH2KfYoSDZhdmH2YTYqSBwcm92aWRlciB0aW1lb3V0INiv2KfYrtmEIGV4ZWN1dGlvbi10b29scy50c9ifXCI7XG4gIGNvbnN0IGFuc3dlciA9XG4gICAgXCLYudmG2K8g2KfZhtiq2YfYp9ihINmF2YfZhNipINmF2LLZiNivINin2YTYsNmD2KfYoSDYp9mE2KfYtdi32YbYp9i52YrYjCDZiti52YrYryDYp9mE2YXYs9in2LEg2KrZgtix2YrYsdmL2Kcg2KzYstim2YrZi9inINmF2YYg2KfZhNij2K/ZhNipINin2YTYqtmKINis2Y/Zhdi52Kog2KjYr9mEINil2LXYr9in2LEgRmluZGluZyDYutmK2LEg2YXYq9io2KouXCI7XG4gIGNvbnN0IGV2aWRlbmNlID0gW1xuICAgIHtcbiAgICAgIHNvdXJjZSxcbiAgICAgIC4uLihibG9ja2VkXG4gICAgICAgID8ge1xuICAgICAgICAgICAgZXhjZXJwdDogXCJwcm92aWRlciB0aW1lb3V0IGlzIGhhbmRsZWQgaGVyZVwiLFxuICAgICAgICAgICAgc3VwcG9ydHNDbGFpbTogZmFsc2UsXG4gICAgICAgICAgICBldmlkZW5jZUNsYXNzOiBcIlJFQURfQ09ORklSTUVEXCIsXG4gICAgICAgICAgICBjaXRhdGlvblN0YXR1czogXCJCTE9DS0VEXCIsXG4gICAgICAgICAgICBjaXRhdGlvblJlYXNvbjogXCJNSVNTSU5HX0xJVEVSQUxfTUFUQ0hcIixcbiAgICAgICAgICB9XG4gICAgICAgIDoge1xuICAgICAgICAgICAgZXhjZXJwdDogJ3JldHVybiBwYXJ0aWFsRnJvbUNvbGxlY3RlZEV2aWRlbmNlKFwicHJvdmlkZXIgdGltZW91dFwiKTsnLFxuICAgICAgICAgICAgc291cmNlU3BhbjogeyBzdGFydExpbmU6IDQyLCBlbmRMaW5lOiA0MiB9LFxuICAgICAgICAgICAgc3VwcG9ydHNDbGFpbTogdHJ1ZSxcbiAgICAgICAgICAgIGV2aWRlbmNlQ2xhc3M6IFwiQkVIQVZJT1JfUFJPVkVOXCIsXG4gICAgICAgICAgICBjaXRhdGlvblN0YXR1czogXCJBQ0NFUFRFRFwiLFxuICAgICAgICAgICAgY2l0YXRpb25SZWFzb246IFwiQUNDRVBURURfU09VUkNFX1NQQU5cIixcbiAgICAgICAgICB9KSxcbiAgICB9LFxuICBdO1xuICBjb25zdCB0b29sVHJhY2UgPSBbXG4gICAge1xuICAgICAga2luZDogXCJ0b29sX2NhbGxcIixcbiAgICAgIHRvb2w6IFwicmVhZF9maWxlXCIsXG4gICAgICBhcmdzOiB7IHBhdGg6IHNvdXJjZSB9LFxuICAgICAgY2FjaGVkOiBmYWxzZSxcbiAgICAgIHByZWZldGNoZWQ6IHRydWUsXG4gICAgfSxcbiAgICB7XG4gICAgICBraW5kOiBcInRvb2xfcmVzdWx0XCIsXG4gICAgICB0b29sOiBcInJlYWRfZmlsZVwiLFxuICAgICAgc291cmNlLFxuICAgICAgY2FjaGVkOiBmYWxzZSxcbiAgICAgIHByZWZldGNoZWQ6IHRydWUsXG4gICAgfSxcbiAgICB7XG4gICAgICBraW5kOiBcImV2aWRlbmNlX2ludGVncml0eVwiLFxuICAgICAgY29kZTogXCJFVklERU5DRV9JTlRFR1JJVFlfT0tcIixcbiAgICAgIGNvbnNpc3RlbnQ6IHRydWUsXG4gICAgICB2aW9sYXRpb25zOiBbXSxcbiAgICAgIGV2aWRlbmNlRmlsZUNvdW50OiAxLFxuICAgICAgYWNjZXB0ZWRFdmlkZW5jZUNvdW50OiAxLFxuICAgICAgY29tcGxldGVkUmVhZEZpbGVzOiBbc291cmNlXSxcbiAgICAgIGFjY2VwdGVkRXZpZGVuY2VGaWxlczogW3NvdXJjZV0sXG4gICAgICBvYmplY3RpdmVUeXBlOiBcIlBST0RVQ1RJT05fUkVBQ0hBQklMSVRZXCIsXG4gICAgICByZXF1aXJlZEVkZ2VzOiBbXCJjbGllbnQtPnNlcnZlclwiLCBcInNlcnZlci0+ZGF0YWJhc2VcIl0sXG4gICAgICBwcm92ZW5FZGdlczogW1wiY2xpZW50LT5zZXJ2ZXJcIl0sXG4gICAgICBjb21wbGV0aW9uR2F0ZVJlc3VsdDogXCJQQVJUSUFMTFlfUFJPVkVOXCIsXG4gICAgICBmaW5hbEFuc3dlclR5cGU6IFwiUFJPRFVDVElPTl9SRUFDSEFCSUxJVFlfQU5TV0VSXCIsXG4gICAgfSxcbiAgXTtcbiAgY29uc3QgdGFza1Jlc3VsdCA9IHtcbiAgICBraW5kOiBcIkJFSEFWSU9SX0FOU1dFUl9SRVNVTFRcIixcbiAgICBhbnN3ZXI6IHtcbiAgICAgIGFuc3dlcixcbiAgICAgIGV2aWRlbmNlLFxuICAgICAgY29uZmlkZW5jZTogMSxcbiAgICAgIHNvdXJjZVNjb3BlOiBbc291cmNlXSxcbiAgICAgIGNvdmVyYWdlOiB7XG4gICAgICAgIHJlcXVlc3RlZEZpZWxkczogW1widGltZW91dCBiZWhhdmlvclwiXSxcbiAgICAgICAgYW5zd2VyZWRGaWVsZHM6IFtcInRpbWVvdXQgYmVoYXZpb3JcIl0sXG4gICAgICAgIG1pc3NpbmdGaWVsZHM6IFtdLFxuICAgICAgICBjb21wbGV0ZTogdHJ1ZSxcbiAgICAgIH0sXG4gICAgfSxcbiAgfTtcbiAgY29uc3QgbWVzc2FnZSA9IHtcbiAgICBpZDogbWVzc2FnZUlkLFxuICAgIHNlc3Npb25JZCxcbiAgICByb2xlOiBcImFzc2lzdGFudFwiLFxuICAgIGNvbnRlbnQ6IGAke2Fuc3dlcn1cXG5cXG4jIyA2KSBGaW5hbCBKdWRnbWVudFxcbk5PVCBQUk9WRU5gLFxuICAgIG9wZXJhdGlvbk1vZGU6IFwiRk9SRU5TSUNfQVVESVRcIixcbiAgICBzb3VyY2VzOiBbc291cmNlXSxcbiAgICB0b29sVHJhY2U6IEpTT04uc3RyaW5naWZ5KHRvb2xUcmFjZSksXG4gICAgYmVoYXZpb3JFdmlkZW5jZTogZXZpZGVuY2UsXG4gICAgdGFza1Jlc3VsdCxcbiAgICBjcmVhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMjowMC4wMDBaXCIsXG4gIH07XG4gIGNvbnN0IHNzZSA9IChldmVudDogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pID0+XG4gICAgYGRhdGE6ICR7SlNPTi5zdHJpbmdpZnkoZXZlbnQpfVxcblxcbmA7XG4gIGNvbnN0IHN0cmVhbUJvZHkgPSBbXG4gICAgc3NlKHsgdHlwZTogXCJzZXNzaW9uX3N0YXJ0ZWRcIiwgc2Vzc2lvbklkIH0pLFxuICAgIHNzZSh7XG4gICAgICB0eXBlOiBcImV4ZWN1dGlvbl9zdGFydGVkXCIsXG4gICAgICBleGVjdXRpb25JZDogXCJlMmUtZXhlY3V0aW9uXCIsXG4gICAgICBzdGF0dXM6IFwicnVubmluZ1wiLFxuICAgICAgcmVzdW1hYmxlOiB0cnVlLFxuICAgIH0pLFxuICAgIHNzZSh7IHR5cGU6IFwic3RhZ2VcIiwgc3RhZ2U6IFwiYnVpbGRpbmctY29udGV4dFwiIH0pLFxuICAgIHNzZSh7IHR5cGU6IFwic3RhZ2VcIiwgc3RhZ2U6IFwiY2FsbGluZy1tb2RlbFwiIH0pLFxuICAgIHNzZSh7XG4gICAgICB0eXBlOiBcInRvb2xfY2FsbFwiLFxuICAgICAgdG9vbDogXCJyZWFkX2ZpbGVcIixcbiAgICAgIGFyZ3M6IHsgcGF0aDogc291cmNlIH0sXG4gICAgICBjYWNoZWQ6IGZhbHNlLFxuICAgICAgcHJlZmV0Y2hlZDogdHJ1ZSxcbiAgICB9KSxcbiAgICBzc2Uoe1xuICAgICAgdHlwZTogXCJ0b29sX3Jlc3VsdFwiLFxuICAgICAgdG9vbDogXCJyZWFkX2ZpbGVcIixcbiAgICAgIHNvdXJjZSxcbiAgICAgIGNhY2hlZDogZmFsc2UsXG4gICAgICBwcmVmZXRjaGVkOiB0cnVlLFxuICAgIH0pLFxuICAgIHNzZSh7XG4gICAgICB0eXBlOiBcImV2aWRlbmNlX2ludGVncml0eVwiLFxuICAgICAgY29kZTogXCJFVklERU5DRV9JTlRFR1JJVFlfT0tcIixcbiAgICAgIGNvbnNpc3RlbnQ6IHRydWUsXG4gICAgICB2aW9sYXRpb25zOiBbXSxcbiAgICAgIGV2aWRlbmNlRmlsZUNvdW50OiAxLFxuICAgICAgYWNjZXB0ZWRFdmlkZW5jZUNvdW50OiAxLFxuICAgICAgY29tcGxldGVkUmVhZEZpbGVzOiBbc291cmNlXSxcbiAgICAgIGFjY2VwdGVkRXZpZGVuY2VGaWxlczogW3NvdXJjZV0sXG4gICAgICBvYmplY3RpdmVUeXBlOiBcIlBST0RVQ1RJT05fUkVBQ0hBQklMSVRZXCIsXG4gICAgICByZXF1aXJlZEVkZ2VzOiBbXCJjbGllbnQtPnNlcnZlclwiLCBcInNlcnZlci0+ZGF0YWJhc2VcIl0sXG4gICAgICBwcm92ZW5FZGdlczogW1wiY2xpZW50LT5zZXJ2ZXJcIl0sXG4gICAgICBjb21wbGV0aW9uR2F0ZVJlc3VsdDogXCJQQVJUSUFMTFlfUFJPVkVOXCIsXG4gICAgICBmaW5hbEFuc3dlclR5cGU6IFwiUFJPRFVDVElPTl9SRUFDSEFCSUxJVFlfQU5TV0VSXCIsXG4gICAgfSksXG4gICAgc3NlKHsgdHlwZTogXCJkZWx0YVwiLCBkZWx0YTogYW5zd2VyIH0pLFxuICAgIHNzZSh7XG4gICAgICB0eXBlOiBcImRvbmVcIixcbiAgICAgIHNlc3Npb25JZCxcbiAgICAgIG1lc3NhZ2UsXG4gICAgICBzb3VyY2VzOiBbc291cmNlXSxcbiAgICAgIHRvb2xUcmFjZTogSlNPTi5zdHJpbmdpZnkodG9vbFRyYWNlKSxcbiAgICAgIGJlaGF2aW9yRXZpZGVuY2U6IGV2aWRlbmNlLFxuICAgICAgdGFza1Jlc3VsdCxcbiAgICAgIHBlbmRpbmdDaGFuZ2VzOiBbXSxcbiAgICB9KSxcbiAgXS5qb2luKFwiXCIpO1xuXG4gIHJldHVybiB7XG4gICAgcXVlc3Rpb24sXG4gICAgYW5zd2VyLFxuICAgIHNvdXJjZSxcbiAgICBzZXNzaW9uSWQsXG4gICAgcHJvamVjdElkOiBvcHRpb25zPy5wcm9qZWN0SWQsXG4gICAgc3RyZWFtQm9keSxcbiAgICBtZXNzYWdlLFxuICB9O1xufVxuXG5mdW5jdGlvbiBpbnN0YWxsVG9vbEZhaWx1cmVGaXh0dXJlKCk6IEFyYWJpY0FpRml4dHVyZSB7XG4gIGNvbnN0IHNlc3Npb25JZCA9IFwiZTJlLXRvb2wtZmFpbHVyZS1zZXNzaW9uXCI7XG4gIGNvbnN0IG1lc3NhZ2VJZCA9IFwiZTJlLXRvb2wtZmFpbHVyZS1tZXNzYWdlXCI7XG4gIGNvbnN0IHNvdXJjZSA9IFwic3JjL21pc3NpbmctcmVsZWFzZS1maXh0dXJlLnRzXCI7XG4gIGNvbnN0IHF1ZXN0aW9uID0gXCJXaGljaCBzb3VyY2UgZmlsZSBpcyBhdmFpbGFibGUgZm9yIHRoZSByZWxlYXNlIGNoZWNrP1wiO1xuICBjb25zdCBhbnN3ZXIgPVxuICAgIFwiQU5BTFlTSVNfSU5DT01QTEVURTogVGhlIHJlcXVpcmVkIHNvdXJjZSByZWFkIGRpZCBub3QgY29tcGxldGUsIHNvIG5vIHZlcmlmaWVkIHJlc3VsdCBpcyBhdmFpbGFibGUuXCI7XG4gIGNvbnN0IGRpYWdub3N0aWNDb2RlID0gXCJUT09MX0VYRUNVVElPTl9GQUlMRURcIjtcbiAgY29uc3QgdG9vbFRyYWNlID0gW1xuICAgIHtcbiAgICAgIGtpbmQ6IFwidG9vbF9jYWxsXCIsXG4gICAgICB0b29sOiBcInJlYWRfZmlsZVwiLFxuICAgICAgYXJnczogeyBwYXRoOiBzb3VyY2UgfSxcbiAgICAgIGNhY2hlZDogZmFsc2UsXG4gICAgfSxcbiAgICB7XG4gICAgICBraW5kOiBcInRvb2xfcmVzdWx0XCIsXG4gICAgICB0b29sOiBcInJlYWRfZmlsZVwiLFxuICAgICAgc291cmNlLFxuICAgICAgcmVzdWx0S2luZDogXCJmYWlsZWRcIixcbiAgICAgIGRpYWdub3N0aWNDb2RlLFxuICAgICAgcmVzdWx0U3VtbWFyeTogXCJUaGUgcmVxdWlyZWQgc291cmNlIHJlYWQgZGlkIG5vdCBjb21wbGV0ZS5cIixcbiAgICB9LFxuICAgIHtcbiAgICAgIGtpbmQ6IFwiZG9uZVwiLFxuICAgICAgc3RvcFJlYXNvbjogXCJ0b29sX2ZhaWx1cmVcIixcbiAgICAgIGl0ZXJhdGlvbnM6IDEsXG4gICAgICBtYXhJdGVyYXRpb25zOiA4LFxuICAgICAgdG9vbENhbGxzOiAxLFxuICAgICAgcHJlZmV0Y2hUb29sQ2FsbHM6IDAsXG4gICAgICBsb29wVG9vbENhbGxzOiAxLFxuICAgICAgc3ludGhlc2lzU3RhcnRlZDogZmFsc2UsXG4gICAgICBkaWFnbm9zdGljQ29kZXM6IFtkaWFnbm9zdGljQ29kZV0sXG4gICAgfSxcbiAgXTtcbiAgY29uc3QgbWVzc2FnZSA9IHtcbiAgICBpZDogbWVzc2FnZUlkLFxuICAgIHNlc3Npb25JZCxcbiAgICByb2xlOiBcImFzc2lzdGFudFwiLFxuICAgIGNvbnRlbnQ6IGFuc3dlcixcbiAgICB0b29sVHJhY2U6IEpTT04uc3RyaW5naWZ5KHRvb2xUcmFjZSksXG4gICAgY3JlYXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDI6MDAuMDAwWlwiLFxuICB9O1xuICBjb25zdCBzc2UgPSAoZXZlbnQ6IFJlY29yZDxzdHJpbmcsIHVua25vd24+KSA9PlxuICAgIGBkYXRhOiAke0pTT04uc3RyaW5naWZ5KGV2ZW50KX1cXG5cXG5gO1xuICBjb25zdCBzdHJlYW1Cb2R5ID0gW1xuICAgIHNzZSh7IHR5cGU6IFwic2Vzc2lvbl9zdGFydGVkXCIsIHNlc3Npb25JZCB9KSxcbiAgICBzc2Uoe1xuICAgICAgdHlwZTogXCJleGVjdXRpb25fc3RhcnRlZFwiLFxuICAgICAgZXhlY3V0aW9uSWQ6IFwiZTJlLXRvb2wtZmFpbHVyZS1leGVjdXRpb25cIixcbiAgICAgIHN0YXR1czogXCJydW5uaW5nXCIsXG4gICAgICByZXN1bWFibGU6IHRydWUsXG4gICAgfSksXG4gICAgc3NlKHtcbiAgICAgIHR5cGU6IFwidG9vbF9jYWxsXCIsXG4gICAgICB0b29sOiBcInJlYWRfZmlsZVwiLFxuICAgICAgYXJnczogeyBwYXRoOiBzb3VyY2UgfSxcbiAgICAgIGNhY2hlZDogZmFsc2UsXG4gICAgfSksXG4gICAgc3NlKHtcbiAgICAgIHR5cGU6IFwidG9vbF9yZXN1bHRcIixcbiAgICAgIHRvb2w6IFwicmVhZF9maWxlXCIsXG4gICAgICBzb3VyY2UsXG4gICAgICByZXN1bHRLaW5kOiBcImZhaWxlZFwiLFxuICAgICAgZGlhZ25vc3RpY0NvZGUsXG4gICAgICByZXN1bHRTdW1tYXJ5OiBcIlRoZSByZXF1aXJlZCBzb3VyY2UgcmVhZCBkaWQgbm90IGNvbXBsZXRlLlwiLFxuICAgIH0pLFxuICAgIHNzZSh7IHR5cGU6IFwiZGVsdGFcIiwgZGVsdGE6IGFuc3dlciB9KSxcbiAgICBzc2Uoe1xuICAgICAgdHlwZTogXCJkb25lXCIsXG4gICAgICBzZXNzaW9uSWQsXG4gICAgICBtZXNzYWdlLFxuICAgICAgdG9vbFRyYWNlOiBKU09OLnN0cmluZ2lmeSh0b29sVHJhY2UpLFxuICAgICAgcGVuZGluZ0NoYW5nZXM6IFtdLFxuICAgIH0pLFxuICBdLmpvaW4oXCJcIik7XG5cbiAgcmV0dXJuIHtcbiAgICBxdWVzdGlvbixcbiAgICBhbnN3ZXIsXG4gICAgc291cmNlLFxuICAgIHNlc3Npb25JZCxcbiAgICBzdHJlYW1Cb2R5LFxuICAgIG1lc3NhZ2UsXG4gIH07XG59XG5cbmZ1bmN0aW9uIGluc3RhbGxEaXNjb25uZWN0ZWRBaUZpeHR1cmUoKTogQXJhYmljQWlGaXh0dXJlIHtcbiAgY29uc3Qgc2Vzc2lvbklkID0gXCJlMmUtZGlzY29ubmVjdGVkLWFpLXNlc3Npb25cIjtcbiAgY29uc3QgZXhlY3V0aW9uSWQgPSBcImUyZS1kaXNjb25uZWN0ZWQtYWktZXhlY3V0aW9uXCI7XG4gIGNvbnN0IHF1ZXN0aW9uID1cbiAgICBcIldoYXQgaGFwcGVucyB3aGVuIHRoZSBtb2RlbCBkaXNjb25uZWN0cyBhZnRlciBzdGFydGluZyBhbiBhbnN3ZXI/XCI7XG4gIGNvbnN0IGFuc3dlciA9XG4gICAgXCJUaGUgbW9kZWwgc3RhcnRlZCBhbiBhbnN3ZXIsIGJ1dCB0aGUgcHJvdmlkZXIgZGlzY29ubmVjdGVkIGJlZm9yZSBjb21wbGV0aW9uLlwiO1xuICBjb25zdCBkaWFnbm9zdGljQ29kZSA9IFwiRVhFQ1VUSU9OX1BST1ZJREVSX0ZBSUxVUkVcIjtcbiAgY29uc3QgdG9vbFRyYWNlID0gW1xuICAgIHtcbiAgICAgIGtpbmQ6IFwiZG9uZVwiLFxuICAgICAgc3RvcFJlYXNvbjogXCJwcm92aWRlcl90aW1lb3V0XCIsXG4gICAgICBpdGVyYXRpb25zOiAxLFxuICAgICAgbWF4SXRlcmF0aW9uczogOCxcbiAgICAgIHRvb2xDYWxsczogMCxcbiAgICAgIHByZWZldGNoVG9vbENhbGxzOiAwLFxuICAgICAgbG9vcFRvb2xDYWxsczogMCxcbiAgICAgIHN5bnRoZXNpc1N0YXJ0ZWQ6IGZhbHNlLFxuICAgICAgZGlhZ25vc3RpY0NvZGVzOiBbZGlhZ25vc3RpY0NvZGVdLFxuICAgICAgZGlhZ25vc3RpY0RldGFpbHM6IFtcbiAgICAgICAgXCJUaGUgcHJvdmlkZXIgZGlzY29ubmVjdGVkIGFmdGVyIHZpc2libGUgcmVzcG9uc2UgdGV4dC5cIixcbiAgICAgIF0sXG4gICAgfSxcbiAgXTtcbiAgY29uc3QgbWVzc2FnZSA9IHtcbiAgICBpZDogXCJlMmUtZGlzY29ubmVjdGVkLWFpLW1lc3NhZ2VcIixcbiAgICBzZXNzaW9uSWQsXG4gICAgcm9sZTogXCJhc3Npc3RhbnRcIixcbiAgICBjb250ZW50OiBhbnN3ZXIsXG4gICAgdG9vbFRyYWNlOiBKU09OLnN0cmluZ2lmeSh0b29sVHJhY2UpLFxuICAgIG91dGNvbWU6IFwiRkFJTEVEXCIsXG4gICAgZXJyb3JDb2RlOiBkaWFnbm9zdGljQ29kZSxcbiAgICBlcnJvck1lc3NhZ2U6IFwiVGhlIHByb3ZpZGVyIGRpc2Nvbm5lY3RlZCBiZWZvcmUgY29tcGxldGlvbi5cIixcbiAgICBleGVjdXRpb25JZCxcbiAgICBjcmVhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMjowMC4wMDBaXCIsXG4gIH07XG4gIGNvbnN0IHNzZSA9IChldmVudDogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pID0+XG4gICAgYGRhdGE6ICR7SlNPTi5zdHJpbmdpZnkoZXZlbnQpfVxcblxcbmA7XG4gIGNvbnN0IHN0cmVhbUJvZHkgPSBbXG4gICAgc3NlKHsgdHlwZTogXCJzZXNzaW9uX3N0YXJ0ZWRcIiwgc2Vzc2lvbklkIH0pLFxuICAgIHNzZSh7XG4gICAgICB0eXBlOiBcImV4ZWN1dGlvbl9zdGFydGVkXCIsXG4gICAgICBleGVjdXRpb25JZCxcbiAgICAgIHN0YXR1czogXCJydW5uaW5nXCIsXG4gICAgICByZXN1bWFibGU6IHRydWUsXG4gICAgfSksXG4gICAgc3NlKHsgdHlwZTogXCJzdGFnZVwiLCBzdGFnZTogXCJjYWxsaW5nLW1vZGVsXCIgfSksXG4gICAgc3NlKHsgdHlwZTogXCJkZWx0YVwiLCBkZWx0YTogYW5zd2VyIH0pLFxuICAgIC8vIFRoZSByZWFsIHJvdXRlIGVtaXRzIHRoaXMgYWZ0ZXIgYSBwcm92aWRlciBkaXNjb25uZWN0IHNvIHRoZSBjbGllbnRcbiAgICAvLyBkcm9wcyB0aGUgdHJhbnNpZW50IGJ1YmJsZSBiZWZvcmUgcmVuZGVyaW5nIHRoZSBwZXJzaXN0ZWQgcmVzdWx0LlxuICAgIHNzZSh7IHR5cGU6IFwic3RyZWFtX3Jlc2V0XCIgfSksXG4gICAgc3NlKHtcbiAgICAgIHR5cGU6IFwiZG9uZVwiLFxuICAgICAgc2Vzc2lvbklkLFxuICAgICAgZXhlY3V0aW9uSWQsXG4gICAgICBtZXNzYWdlLFxuICAgICAgcGVuZGluZ0NoYW5nZXM6IFtdLFxuICAgIH0pLFxuICBdLmpvaW4oXCJcIik7XG5cbiAgcmV0dXJuIHtcbiAgICBxdWVzdGlvbixcbiAgICBhbnN3ZXIsXG4gICAgc291cmNlOiBcInByb3ZpZGVyXCIsXG4gICAgc2Vzc2lvbklkLFxuICAgIGV4ZWN1dGlvbklkLFxuICAgIHN0cmVhbUJvZHksXG4gICAgbWVzc2FnZSxcbiAgfTtcbn1cblxuZnVuY3Rpb24gaW5zdGFsbFJlc3VtZWRBbmFseXNpc0ZhaWx1cmVGaXh0dXJlKCkge1xuICBjb25zdCBzZXNzaW9uSWQgPSBcImUyZS1yZXN1bWVkLWFuYWx5c2lzLWZhaWx1cmUtc2Vzc2lvblwiO1xuICBjb25zdCBleGVjdXRpb25JZCA9IFwiZTJlLXJlc3VtZWQtYW5hbHlzaXMtZmFpbHVyZS1leGVjdXRpb25cIjtcbiAgY29uc3QgcmVzdW1lVG9rZW4gPSBcImUyZS1yZXN1bWVkLWFuYWx5c2lzLWZhaWx1cmUtdG9rZW4tb3BhcXVlXCI7XG4gIGNvbnN0IHF1ZXN0aW9uID0gXCJWZXJpZnkgdGhlIGFuYWx5c2lzIGV2aWRlbmNlIGFmdGVyIHJlY29ubmVjdC5cIjtcbiAgY29uc3QgYW5zd2VyID1cbiAgICBcIkFOQUxZU0lTX0lOQ09NUExFVEU6IFRoZSByZXF1aXJlZCBhbmFseXNpcyBkaWQgbm90IGNvbXBsZXRlLCBzbyBubyB2ZXJpZmllZCByZXN1bHQgaXMgYXZhaWxhYmxlLlwiO1xuICBjb25zdCBkaWFnbm9zdGljQ29kZSA9IFwiVE9PTF9VTkFWQUlMQUJMRVwiO1xuICBjb25zdCBzc2UgPSAoZXZlbnQ6IFJlY29yZDxzdHJpbmcsIHVua25vd24+KSA9PlxuICAgIGBkYXRhOiAke0pTT04uc3RyaW5naWZ5KGV2ZW50KX1cXG5cXG5gO1xuICBjb25zdCBzdHJlYW1Cb2R5ID0gW1xuICAgIHNzZSh7IHR5cGU6IFwic2Vzc2lvbl9zdGFydGVkXCIsIHNlc3Npb25JZCB9KSxcbiAgICBzc2Uoe1xuICAgICAgdHlwZTogXCJleGVjdXRpb25fc3RhcnRlZFwiLFxuICAgICAgZXhlY3V0aW9uSWQsXG4gICAgICBzdGF0dXM6IFwicnVubmluZ1wiLFxuICAgICAgcmVzdW1hYmxlOiB0cnVlLFxuICAgICAgcmVzdW1lVG9rZW4sXG4gICAgfSksXG4gICAgc3NlKHtcbiAgICAgIHR5cGU6IFwiZXJyb3JcIixcbiAgICAgIGV4ZWN1dGlvbklkLFxuICAgICAgY29kZTogZGlhZ25vc3RpY0NvZGUsXG4gICAgICBtZXNzYWdlOiBcIlRoZSByZXF1aXJlZCBhbmFseXNpcyBkaWQgbm90IGNvbXBsZXRlLlwiLFxuICAgIH0pLFxuICBdLmpvaW4oXCJcIik7XG4gIGNvbnN0IGZpeHR1cmU6IEFyYWJpY0FpRml4dHVyZSA9IHtcbiAgICBxdWVzdGlvbixcbiAgICBhbnN3ZXIsXG4gICAgc291cmNlOiBcInNyYy9taXNzaW5nLWFuYWx5c2lzLXRvb2wudHNcIixcbiAgICBzZXNzaW9uSWQsXG4gICAgZXhlY3V0aW9uSWQsXG4gICAgc3RyZWFtQm9keSxcbiAgICBtZXNzYWdlOiB7XG4gICAgICBpZDogXCJlMmUtcmVzdW1lZC1hbmFseXNpcy1mYWlsdXJlLW1lc3NhZ2VcIixcbiAgICAgIHNlc3Npb25JZCxcbiAgICAgIHJvbGU6IFwiYXNzaXN0YW50XCIsXG4gICAgICBjb250ZW50OiBhbnN3ZXIsXG4gICAgICBvdXRjb21lOiBcIkZBSUxFRFwiLFxuICAgICAgZXhlY3V0aW9uSWQsXG4gICAgICBlcnJvckNvZGU6IGRpYWdub3N0aWNDb2RlLFxuICAgICAgZXJyb3JNZXNzYWdlOiBcIlRoZSByZXF1aXJlZCBhbmFseXNpcyBkaWQgbm90IGNvbXBsZXRlLlwiLFxuICAgICAgY3JlYXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDI6MDAuMDAwWlwiLFxuICAgIH0sXG4gIH07XG5cbiAgcmV0dXJuIHtcbiAgICBmaXh0dXJlLFxuICAgIGV4ZWN1dGlvbjoge1xuICAgICAgaWQ6IGV4ZWN1dGlvbklkLFxuICAgICAgcHJvamVjdElkOiBcImUyZS1wcm9qZWN0XCIsXG4gICAgICBvcGVyYXRpb25JZDogXCJlMmUtcmVzdW1lZC1hbmFseXNpcy1mYWlsdXJlLW9wZXJhdGlvblwiLFxuICAgICAgc2Vzc2lvbklkLFxuICAgICAgc3RhdHVzOiBcImZhaWxlZFwiLFxuICAgICAgZmxpZ2h0U3RhdGU6IFwiRkFJTEVEXCIsXG4gICAgICBldmlkZW5jZVZlcmRpY3Q6IFwiSU5DT01QTEVURVwiLFxuICAgICAgcHJvb2ZSZXF1aXJlZDogdHJ1ZSxcbiAgICAgIHJlc3VtYWJsZTogdHJ1ZSxcbiAgICAgIGNoZWNrcG9pbnRWZXJzaW9uOiAxLFxuICAgICAgY2hlY2twb2ludDoge1xuICAgICAgICBzdGFnZTogXCJ0b29sLWV4ZWN1dGlvblwiLFxuICAgICAgICBkZXRhaWw6IFwiVGhlIHJlcXVpcmVkIGFuYWx5c2lzIHRvb2wgd2FzIHVuYXZhaWxhYmxlLlwiLFxuICAgICAgfSxcbiAgICAgIG9iamVjdGl2ZTogeyBvYmplY3RpdmU6IHF1ZXN0aW9uIH0sXG4gICAgICBlcnJvcjogXCJUaGUgcmVxdWlyZWQgYW5hbHlzaXMgZGlkIG5vdCBjb21wbGV0ZS5cIixcbiAgICAgIHN0YXJ0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAxOjAwLjAwMFpcIixcbiAgICAgIGNyZWF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAxOjAwLjAwMFpcIixcbiAgICAgIHVwZGF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAyOjAwLjAwMFpcIixcbiAgICB9LFxuICB9O1xufVxuXG5mdW5jdGlvbiBpbnN0YWxsSW50ZXJydXB0ZWRSZXN1bWVGaXh0dXJlKCkge1xuICBjb25zdCBzZXNzaW9uSWQgPSBcImUyZS1pbnRlcnJ1cHRlZC1yZXN1bWUtc2Vzc2lvblwiO1xuICBjb25zdCBleGVjdXRpb25JZCA9IFwiZTJlLWludGVycnVwdGVkLXJlc3VtZS1leGVjdXRpb25cIjtcbiAgY29uc3QgaW5pdGlhbFRva2VuID0gXCJlMmUtaW50ZXJydXB0ZWQtaW5pdGlhbC10b2tlblwiO1xuICBjb25zdCByZWNvdmVyZWRUb2tlbiA9IFwiZTJlLWludGVycnVwdGVkLXJlY292ZXJlZC10b2tlblwiO1xuICBjb25zdCBxdWVzdGlvbiA9IFwiQ29udGludWUgdGhlIGludGVycnVwdGVkIHJlbGVhc2UgZXhlY3V0aW9uLlwiO1xuICBjb25zdCBwYXJ0aWFsQW5zd2VyID1cbiAgICBcIlRoZSByZWxlYXNlIGV4ZWN1dGlvbiBzdGFydGVkIGJlZm9yZSB0aGUgYnJvd3NlciBkaXNjb25uZWN0ZWQuXCI7XG4gIGNvbnN0IGFuc3dlciA9XG4gICAgXCJUaGUgb3JpZ2luYWwgcmVsZWFzZSBleGVjdXRpb24gcmVzdW1lZCBhZnRlciBjYXBhYmlsaXR5IHJlY292ZXJ5LlwiO1xuICBjb25zdCBtZXNzYWdlID0ge1xuICAgIGlkOiBcImUyZS1pbnRlcnJ1cHRlZC1yZXN1bWUtbWVzc2FnZVwiLFxuICAgIHNlc3Npb25JZCxcbiAgICByb2xlOiBcImFzc2lzdGFudFwiLFxuICAgIGNvbnRlbnQ6IGFuc3dlcixcbiAgICBleGVjdXRpb25JZCxcbiAgICBvdXRjb21lOiBcIkNPTVBMRVRFRFwiLFxuICAgIGNyZWF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAzOjAwLjAwMFpcIixcbiAgfTtcbiAgY29uc3Qgc3NlID0gKGV2ZW50OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPikgPT5cbiAgICBgZGF0YTogJHtKU09OLnN0cmluZ2lmeShldmVudCl9XFxuXFxuYDtcbiAgY29uc3QgZml4dHVyZTogQXJhYmljQWlGaXh0dXJlID0ge1xuICAgIHF1ZXN0aW9uLFxuICAgIGFuc3dlcixcbiAgICBzb3VyY2U6IFwicmVsZWFzZS1yZXN1bWVcIixcbiAgICBzZXNzaW9uSWQsXG4gICAgZXhlY3V0aW9uSWQsXG4gICAgc3RyZWFtQm9keTogW1xuICAgICAgc3NlKHsgdHlwZTogXCJzZXNzaW9uX3N0YXJ0ZWRcIiwgc2Vzc2lvbklkIH0pLFxuICAgICAgc3NlKHtcbiAgICAgICAgdHlwZTogXCJleGVjdXRpb25fc3RhcnRlZFwiLFxuICAgICAgICBleGVjdXRpb25JZCxcbiAgICAgICAgc3RhdHVzOiBcInJ1bm5pbmdcIixcbiAgICAgICAgcmVzdW1hYmxlOiB0cnVlLFxuICAgICAgICByZXN1bWVUb2tlbjogaW5pdGlhbFRva2VuLFxuICAgICAgfSksXG4gICAgICBzc2UoeyB0eXBlOiBcInN0YWdlXCIsIHN0YWdlOiBcImNhbGxpbmctbW9kZWxcIiB9KSxcbiAgICAgIHNzZSh7IHR5cGU6IFwiZGVsdGFcIiwgZGVsdGE6IHBhcnRpYWxBbnN3ZXIgfSksXG4gICAgXS5qb2luKFwiXCIpLFxuICAgIG1lc3NhZ2UsXG4gIH07XG4gIHJldHVybiB7XG4gICAgZml4dHVyZSxcbiAgICBpbml0aWFsVG9rZW4sXG4gICAgcmVjb3ZlcmVkVG9rZW4sXG4gICAgcmVzdW1lZFN0cmVhbUJvZHk6IFtcbiAgICAgIHNzZSh7IHR5cGU6IFwic2Vzc2lvbl9zdGFydGVkXCIsIHNlc3Npb25JZCB9KSxcbiAgICAgIHNzZSh7XG4gICAgICAgIHR5cGU6IFwiZXhlY3V0aW9uX3N0YXJ0ZWRcIixcbiAgICAgICAgZXhlY3V0aW9uSWQsXG4gICAgICAgIHN0YXR1czogXCJydW5uaW5nXCIsXG4gICAgICAgIHJlc3VtYWJsZTogdHJ1ZSxcbiAgICAgICAgcmVzdW1lVG9rZW46IHJlY292ZXJlZFRva2VuLFxuICAgICAgfSksXG4gICAgICBzc2UoeyB0eXBlOiBcInN0YWdlXCIsIHN0YWdlOiBcInJlc3VtaW5nLWNoZWNrcG9pbnRcIiB9KSxcbiAgICAgIHNzZSh7IHR5cGU6IFwiZGVsdGFcIiwgZGVsdGE6IGFuc3dlciB9KSxcbiAgICAgIHNzZSh7XG4gICAgICAgIHR5cGU6IFwiZG9uZVwiLFxuICAgICAgICBzZXNzaW9uSWQsXG4gICAgICAgIGV4ZWN1dGlvbklkLFxuICAgICAgICBtZXNzYWdlLFxuICAgICAgICBwZW5kaW5nQ2hhbmdlczogW10sXG4gICAgICB9KSxcbiAgICBdLmpvaW4oXCJcIiksXG4gICAgZXhlY3V0aW9uOiB7XG4gICAgICBpZDogZXhlY3V0aW9uSWQsXG4gICAgICBwcm9qZWN0SWQ6IFwiZTJlLXByb2plY3RcIixcbiAgICAgIG9wZXJhdGlvbklkOiBcImUyZS1pbnRlcnJ1cHRlZC1yZXN1bWUtb3BlcmF0aW9uXCIsXG4gICAgICBzZXNzaW9uSWQsXG4gICAgICBzdGF0dXM6IFwicGF1c2VkXCIsXG4gICAgICBmbGlnaHRTdGF0ZTogXCJQQVVTRURcIixcbiAgICAgIHJlc3VtYWJsZTogdHJ1ZSxcbiAgICAgIGNoZWNrcG9pbnRWZXJzaW9uOiAxLFxuICAgICAgY2hlY2twb2ludDoge1xuICAgICAgICBzdGFnZTogXCJjYWxsaW5nLW1vZGVsXCIsXG4gICAgICAgIGRldGFpbDpcbiAgICAgICAgICBcIlRoZSBicm93c2VyIHRyYW5zcG9ydCBkaXNjb25uZWN0ZWQgYWZ0ZXIgdGhlIGV4ZWN1dGlvbiBzdGFydGVkLlwiLFxuICAgICAgfSxcbiAgICAgIG9iamVjdGl2ZTogeyBvYmplY3RpdmU6IHF1ZXN0aW9uIH0sXG4gICAgICBzdGFydGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMTowMC4wMDBaXCIsXG4gICAgICBjcmVhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMTowMC4wMDBaXCIsXG4gICAgICB1cGRhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMjowMC4wMDBaXCIsXG4gICAgfSxcbiAgfTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gY3JlYXRlUmVsZWFzZVNpZ25JblVybChwYWdlOiBQYWdlKSB7XG4gIGNvbnN0IHNlY3JldEtleSA9IHByb2Nlc3MuZW52LkNMRVJLX1NFQ1JFVF9LRVk7XG4gIGlmICghc2VjcmV0S2V5KSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgXCJDTEVSS19TRUNSRVRfS0VZIGlzIHJlcXVpcmVkIGZvciB0aGUgcmVsZWFzZS1vbmx5IHByb2dyYW1tYXRpYyBDbGVyayBoYW5kb2ZmLlwiLFxuICAgICk7XG4gIH1cblxuICBjb25zdCBoZWFkZXJzID0ge1xuICAgIEF1dGhvcml6YXRpb246IGBCZWFyZXIgJHtzZWNyZXRLZXl9YCxcbiAgICBcIkNvbnRlbnQtVHlwZVwiOiBcImFwcGxpY2F0aW9uL2pzb25cIixcbiAgfTtcbiAgY29uc3QgdXNlclJlc3BvbnNlID0gYXdhaXQgcGFnZS5yZXF1ZXN0LmdldChcbiAgICBgaHR0cHM6Ly9hcGkuY2xlcmsuY29tL3YxL3VzZXJzP2VtYWlsX2FkZHJlc3M9JHtlbmNvZGVVUklDb21wb25lbnQoVEVTVF9VU0VSLmVtYWlsKX1gLFxuICAgIHsgaGVhZGVycyB9LFxuICApO1xuICBsZXQgdXNlcklkID0gcGFyc2VDbGVya1VzZXJMb29rdXBSZXNwb25zZShhd2FpdCB1c2VyUmVzcG9uc2UuanNvbigpKTtcblxuICBpZiAoIXVzZXJJZCkge1xuICAgIGNvbnN0IGNyZWF0ZWRSZXNwb25zZSA9IGF3YWl0IHBhZ2UucmVxdWVzdC5wb3N0KFxuICAgICAgXCJodHRwczovL2FwaS5jbGVyay5jb20vdjEvdXNlcnNcIixcbiAgICAgIHtcbiAgICAgICAgaGVhZGVycyxcbiAgICAgICAgZGF0YToge1xuICAgICAgICAgIGVtYWlsX2FkZHJlc3M6IFtURVNUX1VTRVIuZW1haWxdLFxuICAgICAgICAgIGZpcnN0X25hbWU6IFRFU1RfVVNFUi5maXJzdE5hbWUsXG4gICAgICAgICAgbGFzdF9uYW1lOiBURVNUX1VTRVIubGFzdE5hbWUsXG4gICAgICAgICAgc2tpcF9wYXNzd29yZF9jaGVja3M6IHRydWUsXG4gICAgICAgICAgc2tpcF9wYXNzd29yZF9yZXF1aXJlbWVudDogdHJ1ZSxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgKTtcbiAgICB1c2VySWQgPSBwYXJzZUNyZWF0ZWRDbGVya1VzZXJSZXNwb25zZShhd2FpdCBjcmVhdGVkUmVzcG9uc2UuanNvbigpKTtcbiAgfVxuXG4gIGlmICghdXNlcklkKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgXCJUaGUgaXNvbGF0ZWQgQ2xlcmsgcmVsZWFzZSB1c2VyIGNvdWxkIG5vdCBiZSBwcm92aXNpb25lZC5cIixcbiAgICApO1xuICB9XG5cbiAgY29uc3QgdG9rZW5SZXNwb25zZSA9IGF3YWl0IHBhZ2UucmVxdWVzdC5wb3N0KFxuICAgIFwiaHR0cHM6Ly9hcGkuY2xlcmsuY29tL3YxL3NpZ25faW5fdG9rZW5zXCIsXG4gICAgeyBoZWFkZXJzLCBkYXRhOiB7IHVzZXJfaWQ6IHVzZXJJZCB9IH0sXG4gICk7XG4gIGNvbnN0IHRva2VuID0gcGFyc2VDbGVya1NpZ25JblRva2VuUmVzcG9uc2UoYXdhaXQgdG9rZW5SZXNwb25zZS5qc29uKCkpO1xuXG4gIHJldHVybiBgJHtuZXcgVVJMKERBU0hCT0FSRF9QQVRILCBwYWdlLnVybCgpKS50b1N0cmluZygpfXNpZ24taW4/X19jbGVya190aWNrZXQ9JHtlbmNvZGVVUklDb21wb25lbnQodG9rZW4pfWA7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHByb2dyYW1tYXRpY1NpZ25JbihwYWdlOiBQYWdlKSB7XG4gIGF3YWl0IHBhZ2UuZ290byhEQVNIQk9BUkRfUEFUSCk7XG4gIGF3YWl0IGV4cGVjdChcbiAgICBwYWdlLmdldEJ5Um9sZShcImxpbmtcIiwgeyBuYW1lOiBcIlNpZ24gSW5cIiwgZXhhY3Q6IHRydWUgfSksXG4gICkudG9CZVZpc2libGUoKTtcblxuICBjb25zdCBoZWxwZXIgPVxuICAgIGdsb2JhbFRoaXMuc2lnbkluQ2xlcmtVc2VyID8/XG4gICAgZ2xvYmFsVGhpcy5fX0VOR0lORUVSSU5HT1NfU0lHTl9JTl9DTEVSS19VU0VSX187XG4gIGlmICghaGVscGVyKSB7XG4gICAgaWYgKHByb2Nlc3MuZW52LlJVTl9DT05UUk9MTEVEX1JFTEVBU0VfVkFMSURBVElPTiAhPT0gXCIxXCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgXCJDbGVyayBicm93c2VyIGhlbHBlciBpcyB1bmF2YWlsYWJsZS4gUnVuIHRoaXMgam91cm5leSBpbiB0aGUgUmVwbGl0IGJyb3dzZXIgcnVubmVyLCB3aGljaCBpbmplY3RzIHNpZ25JbkNsZXJrVXNlci5cIixcbiAgICAgICk7XG4gICAgfVxuICAgIGF3YWl0IHBhZ2UuZ290byhhd2FpdCBjcmVhdGVSZWxlYXNlU2lnbkluVXJsKHBhZ2UpKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZSkudG9IYXZlVVJMKFxuICAgICAgbmV3IFJlZ0V4cChgJHtEQVNIQk9BUkRfUEFUSC5yZXBsYWNlQWxsKFwiL1wiLCBcIlxcXFwvXCIpfSRgKSxcbiAgICApO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCBzaWduSW5VcmwgPSBhd2FpdCBoZWxwZXIoe1xuICAgIC4uLlRFU1RfVVNFUixcbiAgICB0dGw6IDkwMCxcbiAgICBiYXNlUGF0aDogREFTSEJPQVJEX1BBVEgsXG4gIH0pO1xuICBhd2FpdCBwYWdlLmdvdG8oc2lnbkluVXJsKTtcbiAgYXdhaXQgZXhwZWN0KHBhZ2UpLnRvSGF2ZVVSTChcbiAgICBuZXcgUmVnRXhwKGAke0RBU0hCT0FSRF9QQVRILnJlcGxhY2VBbGwoXCIvXCIsIFwiXFxcXC9cIil9JGApLFxuICApO1xufVxuXG5hc3luYyBmdW5jdGlvbiBvcGVuTmF2aWdhdGlvbihwYWdlOiBQYWdlLCBsYWJlbDogc3RyaW5nLCBwYXRoOiBzdHJpbmcpIHtcbiAgYXdhaXQgcGFnZS5nZXRCeVJvbGUoXCJsaW5rXCIsIHsgbmFtZTogbGFiZWwsIGV4YWN0OiB0cnVlIH0pLmNsaWNrKCk7XG4gIGF3YWl0IGV4cGVjdChwYWdlKS50b0hhdmVVUkwobmV3IFJlZ0V4cChgJHtwYXRoLnJlcGxhY2VBbGwoXCIvXCIsIFwiXFxcXC9cIil9JGApKTtcbn1cblxuZnVuY3Rpb24gYXBpVXJsKHBhZ2U6IFBhZ2UsIHBhdGg6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IGFwaUJhc2VVcmwgPSBwcm9jZXNzLmVudi5EQVNIQk9BUkRfRTJFX0FQSV9CQVNFX1VSTDtcbiAgcmV0dXJuIG5ldyBVUkwocGF0aCwgYXBpQmFzZVVybCA/IGFwaUJhc2VVcmwgOiBwYWdlLnVybCgpKS50b1N0cmluZygpO1xufVxuXG5hc3luYyBmdW5jdGlvbiBsaXZlUmVxdWVzdChcbiAgcGFnZTogUGFnZSxcbiAgcGF0aDogc3RyaW5nLFxuICBvcHRpb25zPzogeyBtZXRob2Q/OiBzdHJpbmc7IGJvZHk/OiB1bmtub3duOyB0aW1lb3V0PzogbnVtYmVyIH0sXG4pOiBQcm9taXNlPHsgc3RhdHVzOiBudW1iZXI7IGJvZHk6IHN0cmluZyB9PiB7XG4gIHJldHVybiBwYWdlLmV2YWx1YXRlKFxuICAgIGFzeW5jICh7IHVybCwgbWV0aG9kLCBib2R5LCB0aW1lb3V0IH0pID0+IHtcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgZmV0Y2godXJsLCB7XG4gICAgICAgIG1ldGhvZCxcbiAgICAgICAgY3JlZGVudGlhbHM6IFwiaW5jbHVkZVwiLFxuICAgICAgICBoZWFkZXJzOlxuICAgICAgICAgIGJvZHkgPT09IHVuZGVmaW5lZFxuICAgICAgICAgICAgPyB1bmRlZmluZWRcbiAgICAgICAgICAgIDogeyBcIkNvbnRlbnQtVHlwZVwiOiBcImFwcGxpY2F0aW9uL2pzb25cIiB9LFxuICAgICAgICBib2R5OiBib2R5ID09PSB1bmRlZmluZWQgPyB1bmRlZmluZWQgOiBKU09OLnN0cmluZ2lmeShib2R5KSxcbiAgICAgICAgc2lnbmFsOiB0aW1lb3V0ID8gQWJvcnRTaWduYWwudGltZW91dCh0aW1lb3V0KSA6IHVuZGVmaW5lZCxcbiAgICAgIH0pO1xuICAgICAgcmV0dXJuIHsgc3RhdHVzOiByZXNwb25zZS5zdGF0dXMsIGJvZHk6IGF3YWl0IHJlc3BvbnNlLnRleHQoKSB9O1xuICAgIH0sXG4gICAge1xuICAgICAgdXJsOiBhcGlVcmwocGFnZSwgcGF0aCksXG4gICAgICBtZXRob2Q6IG9wdGlvbnM/Lm1ldGhvZCA/PyBcIkdFVFwiLFxuICAgICAgYm9keTogb3B0aW9ucz8uYm9keSxcbiAgICAgIHRpbWVvdXQ6IG9wdGlvbnM/LnRpbWVvdXQsXG4gICAgfSxcbiAgKTtcbn1cblxudHlwZSBPcmlnaW5EaWFnbm9zdGljID0ge1xuICBvcmlnaW46IHN0cmluZztcbiAgcGhhc2U6IFwiR0VUXCIgfCBcInByZWZsaWdodFwiIHwgXCJtdXRhdGlvblwiIHwgXCJyZWplY3Rpb25cIjtcbiAgc3RhdHVzPzogbnVtYmVyO1xuICBoZWFkZXJzPzogUmVjb3JkPHN0cmluZywgc3RyaW5nPjtcbiAgZXJyb3I/OiBzdHJpbmc7XG59O1xuY29uc3QgcmVjb3JkZWRPcmlnaW5EaWFnbm9zdGljczogT3JpZ2luRGlhZ25vc3RpY1tdID0gW107XG5cbmZ1bmN0aW9uIG9yaWdpbkRpYWdub3N0aWNQYXRoKCk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gIHJldHVybiBwcm9jZXNzLmVudi5EQVNIQk9BUkRfRTJFX09SSUdJTl9ESUFHTk9TVElDU19QQVRIO1xufVxuXG5mdW5jdGlvbiByZWxldmFudE9yaWdpbkhlYWRlcnMoXG4gIGhlYWRlcnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4sXG4pOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+IHtcbiAgcmV0dXJuIE9iamVjdC5mcm9tRW50cmllcyhcbiAgICBPUklHSU5fRElBR05PU1RJQ19IRUFERVJTLmZsYXRNYXAoKG5hbWUpID0+XG4gICAgICBoZWFkZXJzW25hbWVdID8gW1tuYW1lLCBoZWFkZXJzW25hbWVdXV0gOiBbXSxcbiAgICApLFxuICApO1xufVxuXG5hc3luYyBmdW5jdGlvbiB3cml0ZU9yaWdpbkRpYWdub3N0aWNzKCkge1xuICBjb25zdCBvdXRwdXRQYXRoID0gb3JpZ2luRGlhZ25vc3RpY1BhdGgoKTtcbiAgaWYgKCFvdXRwdXRQYXRoKSByZXR1cm47XG4gIGF3YWl0IG1rZGlyKGRpcm5hbWUob3V0cHV0UGF0aCksIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xuICBhd2FpdCB3cml0ZUZpbGUoXG4gICAgb3V0cHV0UGF0aCxcbiAgICBgJHtKU09OLnN0cmluZ2lmeSh7IGRpYWdub3N0aWNzOiByZWNvcmRlZE9yaWdpbkRpYWdub3N0aWNzIH0sIG51bGwsIDIpfVxcbmAsXG4gICAgXCJ1dGY4XCIsXG4gICk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGV4cGVjdE9yaWdpbkNhblVzZUFwaShwYWdlOiBQYWdlLCBvcmlnaW46IHN0cmluZykge1xuICBjb25zdCBhcGlCYXNlVXJsID0gcHJvY2Vzcy5lbnYuREFTSEJPQVJEX0UyRV9BUElfQkFTRV9VUkw7XG4gIGlmICghYXBpQmFzZVVybCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgIFwiREFTSEJPQVJEX0UyRV9BUElfQkFTRV9VUkwgaXMgcmVxdWlyZWQgZm9yIG9yaWdpbiBjaGVja3MuXCIsXG4gICAgKTtcbiAgfVxuICBjb25zdCBoZWFsdGhVcmwgPSBuZXcgVVJMKFwiL2FwaS9oZWFsdGh6XCIsIGFwaUJhc2VVcmwpLnRvU3RyaW5nKCk7XG4gIGNvbnN0IG11dGF0aW9uVXJsID0gbmV3IFVSTChcIi9hcGkvYWkvY2hhdFwiLCBhcGlCYXNlVXJsKS50b1N0cmluZygpO1xuICBjb25zdCBjb21tb25IZWFkZXJzID0geyBPcmlnaW46IG9yaWdpbiB9O1xuXG4gIGNvbnN0IGRpYWdub3N0aWNzOiBPcmlnaW5EaWFnbm9zdGljW10gPSBbXTtcbiAgY29uc3QgY2hlY2sgPSBhc3luYyAoXG4gICAgcGhhc2U6IE9yaWdpbkRpYWdub3N0aWNbXCJwaGFzZVwiXSxcbiAgICByZXF1ZXN0OiAoKSA9PiBQcm9taXNlPGltcG9ydChcIkBwbGF5d3JpZ2h0L3Rlc3RcIikuQVBJUmVzcG9uc2U+LFxuICAgIGFzc2VydGlvbjogKFxuICAgICAgcmVzcG9uc2U6IGltcG9ydChcIkBwbGF5d3JpZ2h0L3Rlc3RcIikuQVBJUmVzcG9uc2UsXG4gICAgKSA9PiBQcm9taXNlPHZvaWQ+LFxuICApID0+IHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCByZXF1ZXN0KCk7XG4gICAgICBkaWFnbm9zdGljcy5wdXNoKHtcbiAgICAgICAgb3JpZ2luLFxuICAgICAgICBwaGFzZSxcbiAgICAgICAgc3RhdHVzOiByZXNwb25zZS5zdGF0dXMoKSxcbiAgICAgICAgaGVhZGVyczogcmVsZXZhbnRPcmlnaW5IZWFkZXJzKHJlc3BvbnNlLmhlYWRlcnMoKSksXG4gICAgICB9KTtcbiAgICAgIHJlY29yZGVkT3JpZ2luRGlhZ25vc3RpY3MucHVzaChkaWFnbm9zdGljcy5hdCgtMSkhKTtcbiAgICAgIGF3YWl0IGFzc2VydGlvbihyZXNwb25zZSk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnN0IGN1cnJlbnQgPSBkaWFnbm9zdGljcy5hdCgtMSk7XG4gICAgICBpZiAoY3VycmVudD8ucGhhc2UgIT09IHBoYXNlKSB7XG4gICAgICAgIGRpYWdub3N0aWNzLnB1c2goeyBvcmlnaW4sIHBoYXNlIH0pO1xuICAgICAgfVxuICAgICAgZGlhZ25vc3RpY3MuYXQoLTEpIS5lcnJvciA9IFwib3JpZ2luIGNoZWNrIGZhaWxlZFwiO1xuICAgICAgYXdhaXQgd3JpdGVPcmlnaW5EaWFnbm9zdGljcygpO1xuICAgICAgdGhyb3cgZXJyb3I7XG4gICAgfVxuICB9O1xuXG4gIGF3YWl0IGNoZWNrKFxuICAgIFwiR0VUXCIsXG4gICAgKCkgPT4gcGFnZS5yZXF1ZXN0LmdldChoZWFsdGhVcmwsIHsgaGVhZGVyczogY29tbW9uSGVhZGVycyB9KSxcbiAgICBhc3luYyAocmVzcG9uc2UpID0+IHtcbiAgICAgIGV4cGVjdChyZXNwb25zZS5zdGF0dXMoKSwgYCR7b3JpZ2lufSBjcmVkZW50aWFsZWQgR0VUIHN0YXR1c2ApLnRvQmUoMjAwKTtcbiAgICAgIGV4cGVjdChyZXNwb25zZS5oZWFkZXJzKClbXCJhY2Nlc3MtY29udHJvbC1hbGxvdy1vcmlnaW5cIl0pLnRvQmUob3JpZ2luKTtcbiAgICAgIGV4cGVjdChyZXNwb25zZS5oZWFkZXJzKClbXCJhY2Nlc3MtY29udHJvbC1hbGxvdy1jcmVkZW50aWFsc1wiXSkudG9CZShcbiAgICAgICAgXCJ0cnVlXCIsXG4gICAgICApO1xuICAgIH0sXG4gICk7XG4gIGF3YWl0IGNoZWNrKFxuICAgIFwicHJlZmxpZ2h0XCIsXG4gICAgKCkgPT5cbiAgICAgIHBhZ2UucmVxdWVzdC5mZXRjaChtdXRhdGlvblVybCwge1xuICAgICAgICBtZXRob2Q6IFwiT1BUSU9OU1wiLFxuICAgICAgICBoZWFkZXJzOiB7XG4gICAgICAgICAgLi4uY29tbW9uSGVhZGVycyxcbiAgICAgICAgICBcIkFjY2Vzcy1Db250cm9sLVJlcXVlc3QtTWV0aG9kXCI6IFwiUE9TVFwiLFxuICAgICAgICAgIFwiQWNjZXNzLUNvbnRyb2wtUmVxdWVzdC1IZWFkZXJzXCI6IFwiY29udGVudC10eXBlXCIsXG4gICAgICAgIH0sXG4gICAgICB9KSxcbiAgICBhc3luYyAocmVzcG9uc2UpID0+IHtcbiAgICAgIGV4cGVjdChyZXNwb25zZS5zdGF0dXMoKSwgYCR7b3JpZ2lufSBtdXRhdGlvbiBwcmVmbGlnaHQgc3RhdHVzYCkudG9CZShcbiAgICAgICAgMjA0LFxuICAgICAgKTtcbiAgICAgIGV4cGVjdChyZXNwb25zZS5oZWFkZXJzKClbXCJhY2Nlc3MtY29udHJvbC1hbGxvdy1vcmlnaW5cIl0pLnRvQmUob3JpZ2luKTtcbiAgICAgIGV4cGVjdChcbiAgICAgICAgcmVzcG9uc2UuaGVhZGVycygpW1wiYWNjZXNzLWNvbnRyb2wtYWxsb3ctY3JlZGVudGlhbHNcIl0sXG4gICAgICAgIGAke29yaWdpbn0gbXV0YXRpb24gcHJlZmxpZ2h0IGNyZWRlbnRpYWxzYCxcbiAgICAgICkudG9CZShcInRydWVcIik7XG4gICAgICBleHBlY3QoXG4gICAgICAgIHJlc3BvbnNlXG4gICAgICAgICAgLmhlYWRlcnMoKVxuICAgICAgICAgIFtcImFjY2Vzcy1jb250cm9sLWFsbG93LW1ldGhvZHNcIl0/LnNwbGl0KFwiLFwiKVxuICAgICAgICAgIC5tYXAoKG1ldGhvZCkgPT4gbWV0aG9kLnRyaW0oKS50b1VwcGVyQ2FzZSgpKSxcbiAgICAgICAgYCR7b3JpZ2lufSBtdXRhdGlvbiBwcmVmbGlnaHQgbWV0aG9kc2AsXG4gICAgICApLnRvQ29udGFpbihcIlBPU1RcIik7XG4gICAgICBleHBlY3QoXG4gICAgICAgIHJlc3BvbnNlXG4gICAgICAgICAgLmhlYWRlcnMoKVxuICAgICAgICAgIFtcImFjY2Vzcy1jb250cm9sLWFsbG93LWhlYWRlcnNcIl0/LnNwbGl0KFwiLFwiKVxuICAgICAgICAgIC5tYXAoKGhlYWRlcikgPT4gaGVhZGVyLnRyaW0oKS50b0xvd2VyQ2FzZSgpKSxcbiAgICAgICAgYCR7b3JpZ2lufSBtdXRhdGlvbiBwcmVmbGlnaHQgaGVhZGVyc2AsXG4gICAgICApLnRvQ29udGFpbihcImNvbnRlbnQtdHlwZVwiKTtcbiAgICB9LFxuICApO1xuICBhd2FpdCBjaGVjayhcbiAgICBcIm11dGF0aW9uXCIsXG4gICAgKCkgPT5cbiAgICAgIHBhZ2UucmVxdWVzdC5wb3N0KG11dGF0aW9uVXJsLCB7XG4gICAgICAgIGhlYWRlcnM6IHsgLi4uY29tbW9uSGVhZGVycywgXCJDb250ZW50LVR5cGVcIjogXCJhcHBsaWNhdGlvbi9qc29uXCIgfSxcbiAgICAgICAgZGF0YTogeyBtZXNzYWdlOiBcIm9yaWdpbiBjb250cmFjdFwiIH0sXG4gICAgICB9KSxcbiAgICBhc3luYyAocmVzcG9uc2UpID0+IHtcbiAgICAgIGV4cGVjdChcbiAgICAgICAgcmVzcG9uc2Uuc3RhdHVzKCksXG4gICAgICAgIGAke29yaWdpbn0gc3RhdGUtY2hhbmdpbmcgcmVxdWVzdCBtdXN0IHBhc3Mgb3JpZ2luIHByb3RlY3Rpb25gLFxuICAgICAgKS5ub3QudG9CZSg0MDMpO1xuICAgICAgZXhwZWN0KHJlc3BvbnNlLmhlYWRlcnMoKVtcImFjY2Vzcy1jb250cm9sLWFsbG93LW9yaWdpblwiXSkudG9CZShvcmlnaW4pO1xuICAgICAgZXhwZWN0KHJlc3BvbnNlLmhlYWRlcnMoKVtcImFjY2Vzcy1jb250cm9sLWFsbG93LWNyZWRlbnRpYWxzXCJdKS50b0JlKFxuICAgICAgICBcInRydWVcIixcbiAgICAgICk7XG4gICAgfSxcbiAgKTtcbiAgYXdhaXQgd3JpdGVPcmlnaW5EaWFnbm9zdGljcygpO1xufVxuXG5hc3luYyBmdW5jdGlvbiBleHBlY3RIb3N0aWxlT3JpZ2luUmVqZWN0ZWQocGFnZTogUGFnZSkge1xuICBjb25zdCBhcGlCYXNlVXJsID0gcHJvY2Vzcy5lbnYuREFTSEJPQVJEX0UyRV9BUElfQkFTRV9VUkw7XG4gIGlmICghYXBpQmFzZVVybClcbiAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICBcIkRBU0hCT0FSRF9FMkVfQVBJX0JBU0VfVVJMIGlzIHJlcXVpcmVkIGZvciBvcmlnaW4gY2hlY2tzLlwiLFxuICAgICk7XG4gIGNvbnN0IG11dGF0aW9uVXJsID0gbmV3IFVSTChcIi9hcGkvYWkvY2hhdFwiLCBhcGlCYXNlVXJsKS50b1N0cmluZygpO1xuICBjb25zdCB1cGxvYWRVcmwgPSBuZXcgVVJMKFwiL2FwaS91cGxvYWQvYXJjaGl2ZVwiLCBhcGlCYXNlVXJsKS50b1N0cmluZygpO1xuICBjb25zdCBsaXZlVXBkYXRlVXJsID0gbmV3IFVSTChcIi9hcGkvYWkvY2hhdC9zdHJlYW1cIiwgYXBpQmFzZVVybCkudG9TdHJpbmcoKTtcbiAgY29uc3QgZGlhZ25vc3RpYzogT3JpZ2luRGlhZ25vc3RpYyA9IHtcbiAgICBvcmlnaW46IEhPU1RJTEVfT1JJR0lOLFxuICAgIHBoYXNlOiBcInJlamVjdGlvblwiLFxuICB9O1xuICByZWNvcmRlZE9yaWdpbkRpYWdub3N0aWNzLnB1c2goZGlhZ25vc3RpYyk7XG4gIHRyeSB7XG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBwYWdlLnJlcXVlc3QucG9zdChtdXRhdGlvblVybCwge1xuICAgICAgaGVhZGVyczoge1xuICAgICAgICBPcmlnaW46IEhPU1RJTEVfT1JJR0lOLFxuICAgICAgICBcIkNvbnRlbnQtVHlwZVwiOiBcImFwcGxpY2F0aW9uL2pzb25cIixcbiAgICAgIH0sXG4gICAgICBkYXRhOiB7IG1lc3NhZ2U6IFwiaG9zdGlsZSBvcmlnaW4gY29udHJhY3RcIiB9LFxuICAgIH0pO1xuICAgIGRpYWdub3N0aWMuc3RhdHVzID0gcmVzcG9uc2Uuc3RhdHVzKCk7XG4gICAgZGlhZ25vc3RpYy5oZWFkZXJzID0gcmVsZXZhbnRPcmlnaW5IZWFkZXJzKHJlc3BvbnNlLmhlYWRlcnMoKSk7XG4gICAgZXhwZWN0KHJlc3BvbnNlLnN0YXR1cygpKS50b0JlKDQwMyk7XG4gICAgZXhwZWN0KHJlc3BvbnNlLmhlYWRlcnMoKVtcImFjY2Vzcy1jb250cm9sLWFsbG93LW9yaWdpblwiXSkudG9CZVVuZGVmaW5lZCgpO1xuICAgIGV4cGVjdChcbiAgICAgIHJlc3BvbnNlLmhlYWRlcnMoKVtcImFjY2Vzcy1jb250cm9sLWFsbG93LWNyZWRlbnRpYWxzXCJdLFxuICAgICkudG9CZVVuZGVmaW5lZCgpO1xuXG4gICAgY29uc3QgaG9zdGlsZVVwbG9hZCA9IGF3YWl0IHBhZ2UucmVxdWVzdC5wb3N0KHVwbG9hZFVybCwge1xuICAgICAgaGVhZGVyczogeyBPcmlnaW46IEhPU1RJTEVfT1JJR0lOIH0sXG4gICAgICBtdWx0aXBhcnQ6IHtcbiAgICAgICAgYXJjaGl2ZToge1xuICAgICAgICAgIG5hbWU6IFwiaG9zdGlsZS1kYXNoYm9hcmQtam91cm5leS56aXBcIixcbiAgICAgICAgICBtaW1lVHlwZTogXCJhcHBsaWNhdGlvbi96aXBcIixcbiAgICAgICAgICBidWZmZXI6IEJ1ZmZlci5mcm9tKFwibm90IGFuIGFyY2hpdmVcIiksXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgIH0pO1xuICAgIGV4cGVjdChob3N0aWxlVXBsb2FkLnN0YXR1cygpKS50b0JlKDQwMyk7XG4gICAgZXhwZWN0KFxuICAgICAgaG9zdGlsZVVwbG9hZC5oZWFkZXJzKClbXCJhY2Nlc3MtY29udHJvbC1hbGxvdy1vcmlnaW5cIl0sXG4gICAgKS50b0JlVW5kZWZpbmVkKCk7XG5cbiAgICBjb25zdCBob3N0aWxlTGl2ZVVwZGF0ZSA9IGF3YWl0IHBhZ2UucmVxdWVzdC5wb3N0KGxpdmVVcGRhdGVVcmwsIHtcbiAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgT3JpZ2luOiBIT1NUSUxFX09SSUdJTixcbiAgICAgICAgXCJDb250ZW50LVR5cGVcIjogXCJhcHBsaWNhdGlvbi9qc29uXCIsXG4gICAgICB9LFxuICAgICAgZGF0YToge30sXG4gICAgfSk7XG4gICAgZXhwZWN0KGhvc3RpbGVMaXZlVXBkYXRlLnN0YXR1cygpKS50b0JlKDQwMyk7XG4gICAgZXhwZWN0KFxuICAgICAgaG9zdGlsZUxpdmVVcGRhdGUuaGVhZGVycygpW1wiYWNjZXNzLWNvbnRyb2wtYWxsb3ctb3JpZ2luXCJdLFxuICAgICkudG9CZVVuZGVmaW5lZCgpO1xuICB9IGNhdGNoIChlcnJvcikge1xuICAgIGRpYWdub3N0aWMuZXJyb3IgPSBcIm9yaWdpbiByZWplY3Rpb24gY2hlY2sgZmFpbGVkXCI7XG4gICAgYXdhaXQgd3JpdGVPcmlnaW5EaWFnbm9zdGljcygpO1xuICAgIHRocm93IGVycm9yO1xuICB9XG4gIGF3YWl0IHdyaXRlT3JpZ2luRGlhZ25vc3RpY3MoKTtcbn1cblxuZnVuY3Rpb24gcGFyc2VTc2UoYm9keTogc3RyaW5nKTogQXJyYXk8UmVjb3JkPHN0cmluZywgdW5rbm93bj4+IHtcbiAgcmV0dXJuIGJvZHkuc3BsaXQoL1xcblxcbisvKS5mbGF0TWFwKChjaHVuaykgPT4ge1xuICAgIGNvbnN0IGRhdGEgPSBjaHVua1xuICAgICAgLnNwbGl0KFwiXFxuXCIpXG4gICAgICAuZmluZCgobGluZSkgPT4gbGluZS5zdGFydHNXaXRoKFwiZGF0YTogXCIpKVxuICAgICAgPy5zbGljZShcImRhdGE6IFwiLmxlbmd0aCk7XG4gICAgaWYgKCFkYXRhKSByZXR1cm4gW107XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHZhbHVlID0gSlNPTi5wYXJzZShkYXRhKSBhcyB1bmtub3duO1xuICAgICAgcmV0dXJuIHZhbHVlICYmIHR5cGVvZiB2YWx1ZSA9PT0gXCJvYmplY3RcIlxuICAgICAgICA/IFt2YWx1ZSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPl1cbiAgICAgICAgOiBbXTtcbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybiBbXTtcbiAgICB9XG4gIH0pO1xufVxuXG5hc3luYyBmdW5jdGlvbiBsaXZlSnNvbihcbiAgcGFnZTogUGFnZSxcbiAgcGF0aDogc3RyaW5nLFxuKTogUHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBhbnk+PiB7XG4gIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgbGl2ZVJlcXVlc3QocGFnZSwgcGF0aCk7XG4gIGlmIChyZXNwb25zZS5zdGF0dXMgPCAyMDAgfHwgcmVzcG9uc2Uuc3RhdHVzID49IDMwMCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgIGBMaXZlIGNvcnJlbGF0aW9uIHJlcXVlc3QgZmFpbGVkOiAke3BhdGh9ICgke3Jlc3BvbnNlLnN0YXR1c30pYCxcbiAgICApO1xuICB9XG4gIHJldHVybiBKU09OLnBhcnNlKHJlc3BvbnNlLmJvZHkpIGFzIFJlY29yZDxzdHJpbmcsIGFueT47XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGxpdmVBcnJheShcbiAgcGFnZTogUGFnZSxcbiAgcGF0aDogc3RyaW5nLFxuKTogUHJvbWlzZTxBcnJheTxSZWNvcmQ8c3RyaW5nLCBhbnk+Pj4ge1xuICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGxpdmVSZXF1ZXN0KHBhZ2UsIHBhdGgpO1xuICBpZiAocmVzcG9uc2Uuc3RhdHVzID09PSA0MDQpIHJldHVybiBbXTtcbiAgaWYgKHJlc3BvbnNlLnN0YXR1cyA8IDIwMCB8fCByZXNwb25zZS5zdGF0dXMgPj0gMzAwKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgYExpdmUgY29ycmVsYXRpb24gcmVxdWVzdCBmYWlsZWQ6ICR7cGF0aH0gKCR7cmVzcG9uc2Uuc3RhdHVzfSlgLFxuICAgICk7XG4gIH1cbiAgY29uc3QgdmFsdWUgPSBKU09OLnBhcnNlKHJlc3BvbnNlLmJvZHkpO1xuICByZXR1cm4gQXJyYXkuaXNBcnJheSh2YWx1ZSkgPyB2YWx1ZSA6IFtdO1xufVxuXG5hc3luYyBmdW5jdGlvbiBsaXZlT3B0aW9uYWxSZWNvcmQoXG4gIHBhZ2U6IFBhZ2UsXG4gIHBhdGg6IHN0cmluZyxcbik6IFByb21pc2U8UmVjb3JkPHN0cmluZywgYW55PiB8IHVuZGVmaW5lZD4ge1xuICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGxpdmVSZXF1ZXN0KHBhZ2UsIHBhdGgpO1xuICBpZiAocmVzcG9uc2Uuc3RhdHVzID09PSA0MDQpIHJldHVybiB1bmRlZmluZWQ7XG4gIGlmIChyZXNwb25zZS5zdGF0dXMgPCAyMDAgfHwgcmVzcG9uc2Uuc3RhdHVzID49IDMwMCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgIGBMaXZlIGNvcnJlbGF0aW9uIHJlcXVlc3QgZmFpbGVkOiAke3BhdGh9ICgke3Jlc3BvbnNlLnN0YXR1c30pYCxcbiAgICApO1xuICB9XG4gIGNvbnN0IHZhbHVlID0gSlNPTi5wYXJzZShyZXNwb25zZS5ib2R5KTtcbiAgcmV0dXJuIHZhbHVlICYmIHR5cGVvZiB2YWx1ZSA9PT0gXCJvYmplY3RcIiAmJiAhQXJyYXkuaXNBcnJheSh2YWx1ZSlcbiAgICA/ICh2YWx1ZSBhcyBSZWNvcmQ8c3RyaW5nLCBhbnk+KVxuICAgIDogdW5kZWZpbmVkO1xufVxuXG50ZXN0LmRlc2NyaWJlKFwiRW5naW5lZXJpbmdPUyBkYXNoYm9hcmQgYnJvd3NlciBqb3VybmV5XCIsICgpID0+IHtcbiAgdGVzdChcImV4cG9ydHMgb25lIHJlZGFjdGVkIGxpdmUtcHJvdmlkZXIgbWlzc2lvbiBjb3JyZWxhdGlvbiByZXBvcnRcIiwgYXN5bmMgKHtcbiAgICBwYWdlLFxuICB9KSA9PiB7XG4gICAgLy8gVGhlIFBsYXl3cmlnaHQgZGVhZGxpbmUgbXVzdCBsZWF2ZSByb29tIGZvciB0aGUgcHJvdmlkZXItYm91bmQgcmVxdWVzdFxuICAgIC8vIGFuZCBwb2xsaW5nIGxvb3AgdG8gY29uc3VtZSB0aGVpciBjb21wbGV0ZSBjb25maWd1cmVkIGJ1ZGdldC5cbiAgICB0ZXN0LnNldFRpbWVvdXQobGl2ZVRpbWVvdXRNcygpICsgTElWRV9URVNUX1RJTUVPVVRfTUFSR0lOX01TKTtcbiAgICB0ZXN0LnNraXAoXG4gICAgICBwcm9jZXNzLmVudi5EQVNIQk9BUkRfRTJFX0xJVkVfUFJPVklERVIgIT09IFwiMVwiLFxuICAgICAgXCJMaXZlLXByb3ZpZGVyIHJlbGVhc2Ugam91cm5leSBpcyBvcHQtaW4uXCIsXG4gICAgKTtcbiAgICBpZiAocHJvY2Vzcy5lbnYuREFTSEJPQVJEX0UyRV9MSVZFX0RJU1BPU0FCTEUgIT09IFwiMVwiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgIFwiTGl2ZS1wcm92aWRlciBqb3VybmV5IHJlcXVpcmVzIERBU0hCT0FSRF9FMkVfTElWRV9ESVNQT1NBQkxFPTEgYW5kIGEgZGlzcG9zYWJsZSBwcm9qZWN0LlwiLFxuICAgICAgKTtcbiAgICB9XG4gICAgY29uc3QgY2FtcGFpZ25TY2VuYXJpbyA9IGxpdmVDYW1wYWlnblNjZW5hcmlvKCk7XG4gICAgY29uc3QgcHJvamVjdElkID0gcHJvY2Vzcy5lbnYuREFTSEJPQVJEX0UyRV9MSVZFX1BST0pFQ1RfSUQ7XG4gICAgaWYgKCFwcm9qZWN0SWQpXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgIFwiREFTSEJPQVJEX0UyRV9MSVZFX1BST0pFQ1RfSUQgaXMgcmVxdWlyZWQgZm9yIHRoZSBsaXZlLXByb3ZpZGVyIGpvdXJuZXkuXCIsXG4gICAgICApO1xuXG4gICAgYXdhaXQgcHJvZ3JhbW1hdGljU2lnbkluKHBhZ2UpO1xuICAgIGNvbnN0IHN0cmVhbVJlc3BvbnNlID0gYXdhaXQgbGl2ZVJlcXVlc3QocGFnZSwgXCIvYXBpL2FpL2NoYXQvc3RyZWFtXCIsIHtcbiAgICAgIG1ldGhvZDogXCJQT1NUXCIsXG4gICAgICB0aW1lb3V0OiBsaXZlVGltZW91dE1zKCksXG4gICAgICBib2R5OiB7XG4gICAgICAgIHByb2plY3RJZCxcbiAgICAgICAgIG1lc3NhZ2U6IGxpdmVQcm9tcHQoKSxcbiAgICAgICAgaWRlbXBvdGVuY3lLZXk6IGBkYXNoYm9hcmQtbGl2ZS0ke0RhdGUubm93KCl9YCxcbiAgICAgIH0sXG4gICAgfSk7XG4gICAgaWYgKHN0cmVhbVJlc3BvbnNlLnN0YXR1cyA8IDIwMCB8fCBzdHJlYW1SZXNwb25zZS5zdGF0dXMgPj0gMzAwKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgIGBMaXZlLXByb3ZpZGVyIG1pc3Npb24gZmFpbGVkIHRvIHN0YXJ0ICgke3N0cmVhbVJlc3BvbnNlLnN0YXR1c30pLmAsXG4gICAgICApO1xuICAgIH1cbiAgICBjb25zdCBzc2VFdmVudHMgPSBwYXJzZVNzZShzdHJlYW1SZXNwb25zZS5ib2R5KTtcbiAgICBjb25zdCBzdGFydGVkID0gc3NlRXZlbnRzLmZpbmQoXG4gICAgICAoZXZlbnQpID0+IGV2ZW50LnR5cGUgPT09IFwiZXhlY3V0aW9uX3N0YXJ0ZWRcIixcbiAgICApO1xuICAgIGNvbnN0IGV4ZWN1dGlvbklkID1cbiAgICAgIHR5cGVvZiBzdGFydGVkPy5leGVjdXRpb25JZCA9PT0gXCJzdHJpbmdcIlxuICAgICAgICA/IHN0YXJ0ZWQuZXhlY3V0aW9uSWRcbiAgICAgICAgOiB1bmRlZmluZWQ7XG4gICAgaWYgKCFleGVjdXRpb25JZClcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkxpdmUtcHJvdmlkZXIgc3RyZWFtIGRpZCBub3QgZW1pdCBleGVjdXRpb25fc3RhcnRlZC5cIik7XG5cbiAgICBsZXQgZXhlY3V0aW9uOiBSZWNvcmQ8c3RyaW5nLCBhbnk+ID0ge307XG4gICAgY29uc3QgZGVhZGxpbmUgPSBEYXRlLm5vdygpICsgbGl2ZVRpbWVvdXRNcygpO1xuICAgIHdoaWxlIChEYXRlLm5vdygpIDwgZGVhZGxpbmUpIHtcbiAgICAgIGV4ZWN1dGlvbiA9IGF3YWl0IGxpdmVKc29uKHBhZ2UsIGAvYXBpL2FpL2V4ZWN1dGlvbnMvJHtleGVjdXRpb25JZH1gKTtcbiAgICAgIGlmIChcbiAgICAgICAgW1wiY29tcGxldGVkXCIsIFwiZmFpbGVkXCIsIFwiY2FuY2VsbGVkXCJdLmluY2x1ZGVzKFN0cmluZyhleGVjdXRpb24uc3RhdHVzKSlcbiAgICAgIClcbiAgICAgICAgYnJlYWs7XG4gICAgICBhd2FpdCBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4gc2V0VGltZW91dChyZXNvbHZlLCA3NTApKTtcbiAgICB9XG4gICAgaWYgKFxuICAgICAgIVtcImNvbXBsZXRlZFwiLCBcImZhaWxlZFwiLCBcImNhbmNlbGxlZFwiXS5pbmNsdWRlcyhTdHJpbmcoZXhlY3V0aW9uLnN0YXR1cykpXG4gICAgKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgIFwiTGl2ZS1wcm92aWRlciBtaXNzaW9uIGRpZCBub3QgcmVhY2ggYSB0ZXJtaW5hbCBzdGF0ZSB3aXRoaW4gaXRzIGJvdW5kLlwiLFxuICAgICAgKTtcbiAgICB9XG5cbiAgICBjb25zdCBzZXNzaW9uSWQgPSBTdHJpbmcoZXhlY3V0aW9uLnNlc3Npb25JZCk7XG4gICAgY29uc3QgbWVzc2FnZXMgPSBhd2FpdCBsaXZlQXJyYXkoXG4gICAgICBwYWdlLFxuICAgICAgYC9hcGkvYWkvY2hhdC8ke3Nlc3Npb25JZH0vbWVzc2FnZXNgLFxuICAgICk7XG4gICAgY29uc3QgZXZlbnRzID0gYXdhaXQgbGl2ZUFycmF5KFxuICAgICAgcGFnZSxcbiAgICAgIGAvYXBpL2V2ZW50cz9wcm9qZWN0SWQ9JHtlbmNvZGVVUklDb21wb25lbnQocHJvamVjdElkKX0mY29ycmVsYXRpb25JZD0ke2VuY29kZVVSSUNvbXBvbmVudChTdHJpbmcoZXhlY3V0aW9uLm9wZXJhdGlvbklkID8/IFwiXCIpKX1gLFxuICAgICk7XG4gICAgY29uc3QgcHJvcG9zYWwgPSBhd2FpdCBsaXZlT3B0aW9uYWxSZWNvcmQoXG4gICAgICBwYWdlLFxuICAgICAgYC9hcGkvYWkvY2hhdC8ke3Nlc3Npb25JZH0vcGVuZGluZy1wcm9wb3NhbGAsXG4gICAgKTtcbiAgICBjb25zdCBnaXRMb2cgPSBhd2FpdCBsaXZlSnNvbihwYWdlLCBgL2FwaS9wcm9qZWN0cy8ke3Byb2plY3RJZH0vZ2l0L2xvZ2ApO1xuICAgIGNvbnN0IG1pc3Npb25Db250cm9sID0gYXdhaXQgbGl2ZUpzb24ocGFnZSwgXCIvYXBpL2FpL21pc3Npb24tY29udHJvbFwiKTtcbiAgICBjb25zdCBkYXNoYm9hcmRTdGF0ZSA9IGF3YWl0IGxpdmVKc29uKHBhZ2UsIFwiL2FwaS9kYXNoYm9hcmRcIik7XG4gICAgY29uc3QgY2hlY2twb2ludCA9XG4gICAgICBleGVjdXRpb24uY2hlY2twb2ludCAmJiB0eXBlb2YgZXhlY3V0aW9uLmNoZWNrcG9pbnQgPT09IFwib2JqZWN0XCJcbiAgICAgICAgPyAoZXhlY3V0aW9uLmNoZWNrcG9pbnQgYXMgUmVjb3JkPHN0cmluZywgYW55PilcbiAgICAgICAgOiB7fTtcbiAgICBjb25zdCByZWNlbnRTdGVwcyA9IEFycmF5LmlzQXJyYXkoY2hlY2twb2ludC5yZWNlbnRTdGVwcylcbiAgICAgID8gY2hlY2twb2ludC5yZWNlbnRTdGVwc1xuICAgICAgOiBbXTtcbiAgICBjb25zdCB2YWxpZGF0aW9uID0gcmVjZW50U3RlcHMuZmlsdGVyKFxuICAgICAgKHN0ZXApID0+IHN0ZXA/LmtpbmQgPT09IFwidmFsaWRhdGlvblwiLFxuICAgICk7XG4gICAgY29uc3QgcHJvamVjdFJldmlzaW9uID1cbiAgICAgIHR5cGVvZiBleGVjdXRpb24ucHJvamVjdFJldmlzaW9uID09PSBcInN0cmluZ1wiXG4gICAgICAgID8gZXhlY3V0aW9uLnByb2plY3RSZXZpc2lvblxuICAgICAgICA6IHVuZGVmaW5lZDtcbiAgICBjb25zdCBjYW5kaWRhdGVIYXNoID0gdmFsaWRhdGlvblxuICAgICAgLm1hcCgoc3RlcCkgPT4gc3RlcD8udmFsaWRhdGlvbj8uY2FuZGlkYXRlSGFzaCA/PyBzdGVwPy5jYW5kaWRhdGVIYXNoKVxuICAgICAgLmZpbmQoKHZhbHVlKTogdmFsdWUgaXMgc3RyaW5nID0+IHR5cGVvZiB2YWx1ZSA9PT0gXCJzdHJpbmdcIiAmJiB2YWx1ZS5sZW5ndGggPiAwKTtcbiAgICBjb25zdCBjYW5kaWRhdGVJZGVudGl0eSA9XG4gICAgICB0eXBlb2YgZXhlY3V0aW9uLmNhbmRpZGF0ZUlkZW50aXR5ID09PSBcInN0cmluZ1wiXG4gICAgICAgID8gZXhlY3V0aW9uLmNhbmRpZGF0ZUlkZW50aXR5XG4gICAgICAgIDogY2FuZGlkYXRlSGFzaFxuICAgICAgICAgID8gYGNhbmRpZGF0ZToke2NhbmRpZGF0ZUhhc2h9YFxuICAgICAgICAgIDogYHJlYWQtb25seToke3Byb2plY3RSZXZpc2lvbiA/PyBcInVua25vd25cIn1gO1xuICAgIGlmICghcHJvamVjdFJldmlzaW9uKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJMaXZlLXByb3ZpZGVyIG1pc3Npb24gaXMgbWlzc2luZyBpdHMgcHJvamVjdCByZXZpc2lvbi5cIik7XG4gICAgfVxuICAgIGlmIChcbiAgICAgIHByb2Nlc3MuZW52LkRBU0hCT0FSRF9FMkVfTElWRV9DQU1QQUlHTiA9PT0gXCIxXCIgJiZcbiAgICAgICghY2FuZGlkYXRlSWRlbnRpdHkgfHwgIXByb2plY3RSZXZpc2lvbilcbiAgICApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkxpdmUgY2FtcGFpZ24gcmVxdWlyZXMgb3BlcmF0aW9uLCByZXZpc2lvbiwgYW5kIGNhbmRpZGF0ZSBjb3JyZWxhdGlvbi5cIik7XG4gICAgfVxuICAgIGNvbnN0IGV2aWRlbmNlQ291bnQgPSByZWNlbnRTdGVwcy5yZWR1Y2UoXG4gICAgICAoY291bnQsIHN0ZXApID0+IGNvdW50ICsgKE51bWJlcihzdGVwPy5hY2NlcHRlZEV2aWRlbmNlQ291bnQpIHx8IDApLFxuICAgICAgMCxcbiAgICApO1xuICAgIGNvbnN0IHRlcm1pbmFsU3RhdGUgPSBTdHJpbmcoXG4gICAgICBleGVjdXRpb24uZmxpZ2h0U3RhdGUgPz8gZXhlY3V0aW9uLnN0YXR1cyxcbiAgICApLnRvVXBwZXJDYXNlKCk7XG4gICAgY29uc3Qgc3VjY2Vzc1N0YXRlcyA9IG5ldyBTZXQoW1xuICAgICAgXCJDT01QTEVURURcIixcbiAgICAgIFwiUkVBRFlfRk9SX1JFVklFV1wiLFxuICAgICAgXCJBUFBMSUVEXCIsXG4gICAgICBcIkNPTU1JVFRFRFwiLFxuICAgICAgXCJQVVNIRURcIixcbiAgICBdKTtcbiAgICBpZiAoXG4gICAgICBjYW1wYWlnblNjZW5hcmlvID09PSBcImRlbGl2ZXJ5LXN1Y2Nlc3NcIiAmJlxuICAgICAgc3VjY2Vzc1N0YXRlcy5oYXModGVybWluYWxTdGF0ZSkgJiZcbiAgICAgICFjYW5kaWRhdGVIYXNoXG4gICAgKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgIFwiRGVsaXZlcnktc3VjY2VzcyBjYW1wYWlnbiBjYW5ub3QgcGFzcyB3aXRob3V0IGEgY2FuZGlkYXRlLWJvdW5kIHZhbGlkYXRpb24gaGFzaC5cIixcbiAgICAgICk7XG4gICAgfVxuICAgIGNvbnN0IGRlbGl2ZXJ5U3RhZ2VzID0ge1xuICAgICAgYXBwbGllZDogZXZlbnRzLnNvbWUoKGV2ZW50KSA9PiBldmVudD8udHlwZSA9PT0gXCJBaUNoYW5nZXNBcHBsaWVkXCIpLFxuICAgICAgY29tbWl0dGVkOiBldmVudHMuc29tZSgoZXZlbnQpID0+IGV2ZW50Py50eXBlID09PSBcIkdpdENvbW1pdENyZWF0ZWRcIiksXG4gICAgICBwdXNoZWQ6IGV2ZW50cy5zb21lKChldmVudCkgPT4gZXZlbnQ/LnR5cGUgPT09IFwiR2l0UHVzaGVkXCIpLFxuICAgIH07XG4gICAgaWYgKFxuICAgICAgY2FtcGFpZ25TY2VuYXJpbyA9PT0gXCJkZWxpdmVyeS1zdWNjZXNzXCIgJiZcbiAgICAgIHN1Y2Nlc3NTdGF0ZXMuaGFzKHRlcm1pbmFsU3RhdGUpICYmXG4gICAgICAhT2JqZWN0LnZhbHVlcyhkZWxpdmVyeVN0YWdlcykuZXZlcnkoQm9vbGVhbilcbiAgICApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgXCJEZWxpdmVyeS1zdWNjZXNzIGNhbXBhaWduIGNhbm5vdCBwYXNzIHdpdGhvdXQgb3BlcmF0aW9uLWNvcnJlbGF0ZWQgYXBwbHksIGNvbW1pdCwgYW5kIHB1c2ggZXZpZGVuY2UuXCIsXG4gICAgICApO1xuICAgIH1cbiAgICBpZiAoXG4gICAgICBzdWNjZXNzU3RhdGVzLmhhcyh0ZXJtaW5hbFN0YXRlKSAmJlxuICAgICAgKGV2aWRlbmNlQ291bnQgPCAxIHx8IHZhbGlkYXRpb24ubGVuZ3RoIDwgMSlcbiAgICApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgYExpdmUtcHJvdmlkZXIgbWlzc2lvbiByZXBvcnRlZCAke3Rlcm1pbmFsU3RhdGV9IHdpdGhvdXQgYWNjZXB0ZWQgZXZpZGVuY2UgYW5kIHZhbGlkYXRpb24gYCArXG4gICAgICAgICAgYChldmlkZW5jZT0ke2V2aWRlbmNlQ291bnR9LCB2YWxpZGF0aW9uPSR7dmFsaWRhdGlvbi5sZW5ndGh9KS5gLFxuICAgICAgKTtcbiAgICB9XG4gICAgY29uc3QgY2FwdHVyZSA9IHtcbiAgICAgIHByb2plY3RJZCxcbiAgICAgIHNlc3Npb25JZCxcbiAgICAgIG9wZXJhdGlvbklkOiBleGVjdXRpb24ub3BlcmF0aW9uSWQsXG4gICAgICB3b3Jrc3BhY2VSZXZpc2lvbjpcbiAgICAgICAgZ2l0TG9nLmNvbW1pdHM/LlswXT8uc2hvcnRIYXNoID8/XG4gICAgICAgIGdpdExvZy5jb21taXRzPy5bMF0/Lmhhc2g/LnNsaWNlKDAsIDEyKSxcbiAgICAgIHByb2plY3RSZXZpc2lvbixcbiAgICAgIGNhbmRpZGF0ZUlkZW50aXR5LFxuICAgICAgY2FuZGlkYXRlUmV2aXNpb246IHByb2plY3RSZXZpc2lvbixcbiAgICAgIGNhbXBhaWduU2NlbmFyaW8sXG4gICAgICBkZWxpdmVyeVN0YWdlcyxcbiAgICAgIGN1cnJlbnRPcGVyYXRpb246IHtcbiAgICAgICAgb3BlcmF0aW9uSWQ6IGV4ZWN1dGlvbi5vcGVyYXRpb25JZCxcbiAgICAgICAgcmV2aXNpb246IHByb2plY3RSZXZpc2lvbixcbiAgICAgICAgc3RhdHVzOiBleGVjdXRpb24uc3RhdHVzLFxuICAgICAgICB0ZXJtaW5hbFN0YXRlLFxuICAgICAgfSxcbiAgICAgIHJldGFpbmVkUmVzdWx0OlxuICAgICAgICB0ZXJtaW5hbFN0YXRlID09PSBcIkZBSUxFRFwiIHx8IHRlcm1pbmFsU3RhdGUgPT09IFwiQkxPQ0tFRFwiIHx8IHRlcm1pbmFsU3RhdGUgPT09IFwiSU5DT01QTEVURVwiXG4gICAgICAgICAgPyB7XG4gICAgICAgICAgICAgIG9wZXJhdGlvbklkOiBleGVjdXRpb24ub3BlcmF0aW9uSWQsXG4gICAgICAgICAgICAgIHJldmlzaW9uOiBwcm9qZWN0UmV2aXNpb24sXG4gICAgICAgICAgICAgIGxhYmVsOiBcInJldGFpbmVkIHJlc3VsdCBmcm9tIHRoZSBjdXJyZW50IGZhaWxlZCBvciBpbmNvbXBsZXRlIG9wZXJhdGlvblwiLFxuICAgICAgICAgICAgfVxuICAgICAgICAgIDogdW5kZWZpbmVkLFxuICAgICAgdGVybWluYWxTdGF0ZSxcbiAgICAgIGV4ZWN1dGlvbjoge1xuICAgICAgICBpZDogZXhlY3V0aW9uLmlkLFxuICAgICAgICBwcm9qZWN0SWQ6IGV4ZWN1dGlvbi5wcm9qZWN0SWQsXG4gICAgICAgIHNlc3Npb25JZDogZXhlY3V0aW9uLnNlc3Npb25JZCxcbiAgICAgICAgb3BlcmF0aW9uSWQ6IGV4ZWN1dGlvbi5vcGVyYXRpb25JZCxcbiAgICAgICAgc3RhdHVzOiBleGVjdXRpb24uc3RhdHVzLFxuICAgICAgICBmbGlnaHRTdGF0ZTogZXhlY3V0aW9uLmZsaWdodFN0YXRlLFxuICAgICAgfSxcbiAgICAgIG1lc3NhZ2VzOiBtZXNzYWdlcy5tYXAoXG4gICAgICAgICh7XG4gICAgICAgICAgaWQsXG4gICAgICAgICAgc2Vzc2lvbklkOiBtZXNzYWdlU2Vzc2lvbixcbiAgICAgICAgICByb2xlLFxuICAgICAgICAgIGV4ZWN1dGlvbklkOiBtZXNzYWdlRXhlY3V0aW9uLFxuICAgICAgICAgIG91dGNvbWUsXG4gICAgICAgIH0pID0+ICh7XG4gICAgICAgICAgaWQsXG4gICAgICAgICAgc2Vzc2lvbklkOiBtZXNzYWdlU2Vzc2lvbixcbiAgICAgICAgICByb2xlLFxuICAgICAgICAgIGV4ZWN1dGlvbklkOiBtZXNzYWdlRXhlY3V0aW9uLFxuICAgICAgICAgIG91dGNvbWUsXG4gICAgICAgIH0pLFxuICAgICAgKSxcbiAgICAgIHNzZUV2ZW50czogc3NlRXZlbnRzLm1hcChcbiAgICAgICAgKHtcbiAgICAgICAgICB0eXBlLFxuICAgICAgICAgIGV4ZWN1dGlvbklkOiBldmVudEV4ZWN1dGlvbixcbiAgICAgICAgICBzZXNzaW9uSWQ6IGV2ZW50U2Vzc2lvbixcbiAgICAgICAgICBvdXRjb21lLFxuICAgICAgICAgIGNvZGUsXG4gICAgICAgIH0pID0+ICh7XG4gICAgICAgICAgdHlwZSxcbiAgICAgICAgICBleGVjdXRpb25JZDogZXZlbnRFeGVjdXRpb24sXG4gICAgICAgICAgc2Vzc2lvbklkOiBldmVudFNlc3Npb24sXG4gICAgICAgICAgb3V0Y29tZSxcbiAgICAgICAgICBjb2RlLFxuICAgICAgICB9KSxcbiAgICAgICksXG4gICAgICBjaGVja3BvaW50czogW1xuICAgICAgICB7XG4gICAgICAgICAgc2VxdWVuY2U6IGNoZWNrcG9pbnQuc2VxdWVuY2UsXG4gICAgICAgICAgc3RhZ2U6IGNoZWNrcG9pbnQuc3RhZ2UsXG4gICAgICAgICAgdXBkYXRlZEF0OiBjaGVja3BvaW50LnVwZGF0ZWRBdCxcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgICBldmlkZW5jZUNvdW50LFxuICAgICAgcHJvcG9zYWxzOiBwcm9wb3NhbFxuICAgICAgICA/IFtcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgaWQ6IHByb3Bvc2FsLmlkLFxuICAgICAgICAgICAgICByZXZpc2lvbjogcHJvcG9zYWwucmV2aXNpb24sXG4gICAgICAgICAgICAgIHN0YXR1czogcHJvcG9zYWwuc3RhdHVzLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICBdXG4gICAgICAgIDogW10sXG4gICAgICB2YWxpZGF0aW9uOiB2YWxpZGF0aW9uLm1hcCgoc3RlcCkgPT4gKHtcbiAgICAgICAgc3RhdHVzOiBzdGVwLnZhbGlkYXRpb24/LnN0YXR1cyA/PyBzdGVwLnN0YXR1cyxcbiAgICAgICAgcHJvZmlsZTogc3RlcC52YWxpZGF0aW9uPy5wcm9maWxlID8/IHN0ZXAudmFsaWRhdGlvblByb2ZpbGUsXG4gICAgICB9KSksXG4gICAgICBldmVudHM6IGV2ZW50cy5tYXAoKHsgdHlwZSwgc2V2ZXJpdHksIGNvcnJlbGF0aW9uSWQgfSkgPT4gKHtcbiAgICAgICAgdHlwZSxcbiAgICAgICAgc2V2ZXJpdHksXG4gICAgICAgIGNvcnJlbGF0aW9uSWQsXG4gICAgICB9KSksXG4gICAgICBkYXNoYm9hcmQ6IG1pc3Npb25Db250cm9sLFxuICAgICAgZGFzaGJvYXJkU3RhdGU6IHtcbiAgICAgICAgcHJvamVjdENvdW50OiBkYXNoYm9hcmRTdGF0ZS5wcm9qZWN0Q291bnQsXG4gICAgICAgIGFjdGl2ZVRhc2tDb3VudDogZGFzaGJvYXJkU3RhdGUuYWN0aXZlVGFza0NvdW50LFxuICAgICAgfSxcbiAgICB9O1xuICAgIGNvbnN0IG91dHB1dFBhdGggPVxuICAgICAgcHJvY2Vzcy5lbnYuREFTSEJPQVJEX0UyRV9MSVZFX1JFUE9SVF9QQVRIID8/XG4gICAgICBcInRlc3QtcmVzdWx0cy9kYXNoYm9hcmQtam91cm5leS9saXZlLW1pc3Npb24tY29ycmVsYXRpb24uanNvblwiO1xuICAgIGF3YWl0IG1rZGlyKGRpcm5hbWUob3V0cHV0UGF0aCksIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xuICAgIGF3YWl0IHdyaXRlRmlsZShcbiAgICAgIG91dHB1dFBhdGgsXG4gICAgICBgJHtKU09OLnN0cmluZ2lmeShjYXB0dXJlLCBudWxsLCAyKX1cXG5gLFxuICAgICAgXCJ1dGY4XCIsXG4gICAgKTtcbiAgfSk7XG5cbiAgdGVzdChcInNpZ25zIGluIGFuZCB0cmF2ZXJzZXMgdGhlIGF1dGhlbnRpY2F0ZWQgb3BlcmF0aW9uYWwgc2hlbGxcIiwgYXN5bmMgKHtcbiAgICBwYWdlLFxuICB9KSA9PiB7XG4gICAgYXdhaXQgaW5zdGFsbEFwaUZpeHR1cmVzKHBhZ2UpO1xuICAgIGF3YWl0IHByb2dyYW1tYXRpY1NpZ25JbihwYWdlKTtcbiAgICBmb3IgKGNvbnN0IG9yaWdpbiBvZiBhcHByb3ZlZERhc2hib2FyZE9yaWdpbnMoKSkge1xuICAgICAgYXdhaXQgZXhwZWN0T3JpZ2luQ2FuVXNlQXBpKHBhZ2UsIG9yaWdpbik7XG4gICAgfVxuICAgIGF3YWl0IGV4cGVjdEhvc3RpbGVPcmlnaW5SZWplY3RlZChwYWdlKTtcblxuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlSb2xlKFwiaGVhZGluZ1wiLCB7IG5hbWU6IFwiU3lzdGVtIE92ZXJ2aWV3XCIgfSksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiU1lTVEVNIE9OTElORVwiLCB7IGV4YWN0OiB0cnVlIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcIlNtb2tlIFByb2plY3RcIiwgeyBleGFjdDogdHJ1ZSB9KS5maXJzdCgpLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcIkRhc2hib2FyZCBBUEkgZml4dHVyZSByZWFkeVwiLCB7IGV4YWN0OiB0cnVlIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBvcGVuTmF2aWdhdGlvbihwYWdlLCBcIlByb2plY3RzXCIsIGAke0RBU0hCT0FSRF9QQVRIfXByb2plY3RzYCk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlSb2xlKFwiaGVhZGluZ1wiLCB7IG5hbWU6IFwiUHJvamVjdHNcIiB9KSkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcIlNtb2tlIFByb2plY3RcIiwgeyBleGFjdDogdHJ1ZSB9KSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG5cbiAgICBhd2FpdCBvcGVuTmF2aWdhdGlvbihwYWdlLCBcIkV2ZW50IFN0cmVhbVwiLCBgJHtEQVNIQk9BUkRfUEFUSH1ldmVudHNgKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5Um9sZShcImhlYWRpbmdcIiwgeyBuYW1lOiBcIkV2ZW50IFN0cmVhbVwiIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcIkRhc2hib2FyZCBBUEkgZml4dHVyZSByZWFkeVwiLCB7IGV4YWN0OiB0cnVlIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcblxuICAgIGF3YWl0IG9wZW5OYXZpZ2F0aW9uKHBhZ2UsIFwiQUkgQXNzaXN0YW50XCIsIGAke0RBU0hCT0FSRF9QQVRIfWFpYCk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UpLm5vdC50b0hhdmVVUkwoL3NpZ24taW4vKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlXG4gICAgICAgIC5nZXRCeVRleHQoXG4gICAgICAgICAgL0FJIHByb3ZpZGVyIG5vdCBjb25maWd1cmVkfE5vIEFJIGtleSBjb25maWd1cmVkfEFJIEFzc2lzdGFudC9pLFxuICAgICAgICApXG4gICAgICAgIC5maXJzdCgpLFxuICAgICkudG9CZVZpc2libGUoKTtcblxuICAgIGF3YWl0IG9wZW5OYXZpZ2F0aW9uKFxuICAgICAgcGFnZSxcbiAgICAgIFwiTWlzc2lvbiBDb250cm9sXCIsXG4gICAgICBgJHtEQVNIQk9BUkRfUEFUSH1taXNzaW9uLWNvbnRyb2xgLFxuICAgICk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVJvbGUoXCJoZWFkaW5nXCIsIHsgbmFtZTogXCJObyBkdXJhYmxlIHJ1bnMgaW4gdGhlIGxlZGdlclwiIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcblxuICAgIGF3YWl0IHBhZ2UuZ290byhgJHtEQVNIQk9BUkRfUEFUSH1mbGlnaHQtZGVjaz9leGVjdXRpb25JZD0ke0VYRUNVVElPTl9JRH1gKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZSkudG9IYXZlVVJMKFxuICAgICAgbmV3IFJlZ0V4cChcbiAgICAgICAgYCR7REFTSEJPQVJEX1BBVEgucmVwbGFjZUFsbChcIi9cIiwgXCJcXFxcL1wiKX1mbGlnaHQtZGVja1xcXFw/ZXhlY3V0aW9uSWQ9YCxcbiAgICAgICksXG4gICAgKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5Um9sZShcImhlYWRpbmdcIiwgeyBuYW1lOiBcIkF1ZGl0IC8gQ2hhdCBydW5cIiB9KSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXCJDb250cm9sbGVkIGJyb3dzZXIgZml4dHVyZSBjb21wbGV0ZWQuXCIsIHsgZXhhY3Q6IHRydWUgfSksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiUFJPVkVOXCIsIHsgZXhhY3Q6IHRydWUgfSkuZmlyc3QoKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gIH0pO1xuXG4gIHRlc3QoXCJvcGVucyBmYWlsZWQgdGFzayBhbmQgd29ya2Zsb3cgZGV0YWlscyB3aXRoIHJlZGFjdGVkIHJlY292ZXJ5IGd1aWRhbmNlXCIsIGFzeW5jICh7XG4gICAgcGFnZSxcbiAgfSkgPT4ge1xuICAgIGNvbnN0IHJhd0RpYWdub3N0aWMgPSBcInByb3ZpZGVyIGRpYWdub3N0aWM6IHVwc3RyZWFtIHJldHVybmVkIHJhdyByZXNwb25zZVwiO1xuICAgIGNvbnN0IHJhd0NyZWRlbnRpYWwgPSBcInNrLWUyZS1icm93c2VyLWNyZWRlbnRpYWwtc2VjcmV0XCI7XG4gICAgY29uc3Qgc3VwcG9ydFJlZmVyZW5jZXMgPSB7XG4gICAgICBhdXRoZW50aWNhdGlvbl9mYWlsZWQ6IFwic3VwcG9ydC10YXNrLWF1dGgtMzJcIixcbiAgICAgIHF1b3RhX2V4aGF1c3RlZDogXCJzdXBwb3J0LXRhc2stcXVvdGEtMzJcIixcbiAgICAgIHByb3ZpZGVyX291dGFnZTogXCJzdXBwb3J0LXdvcmtmbG93LW91dGFnZS0zMlwiLFxuICAgIH07XG4gICAgY29uc3QgcmVjb3ZlcnlUYXNrcyA9IFtcbiAgICAgIHtcbiAgICAgICAgaWQ6IFwiZTJlLWF1dGgtZmFpbGVkLXRhc2tcIixcbiAgICAgICAgcHJvamVjdElkOiBcImUyZS1wcm9qZWN0XCIsXG4gICAgICAgIHRpdGxlOiBcIlJlY292ZXIgYXV0aGVudGljYXRpb24gZmFpbHVyZVwiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJUaGUgcHJvdmlkZXIgYXV0aGVudGljYXRpb24gdGVzdCB0YXNrIGZhaWxlZC5cIixcbiAgICAgICAgc3RhdHVzOiBcImZhaWxlZFwiLFxuICAgICAgICBwcmlvcml0eTogXCJwMVwiLFxuICAgICAgICByZWxhdGVkRmlsZXM6IFtcInNyYy9wcm92aWRlci50c1wiXSxcbiAgICAgICAgcmV0cnlDb3VudDogMSxcbiAgICAgICAgbWF4UmV0cmllczogMixcbiAgICAgICAgYWdlbnRSZXNwb25zZTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgIGtpbmQ6IFwiQUlfVEFTS19FWEVDVVRJT05fUkVDRUlQVFwiLFxuICAgICAgICAgIHRlcm1pbmFsU3RhdHVzOiBcIkZBSUxFRFwiLFxuICAgICAgICAgIGF2YWlsYWJpbGl0eVN0YXRlOiBcImF1dGhlbnRpY2F0aW9uX2ZhaWxlZFwiLFxuICAgICAgICAgIGNvcnJlbGF0aW9uSWQ6IHN1cHBvcnRSZWZlcmVuY2VzLmF1dGhlbnRpY2F0aW9uX2ZhaWxlZCxcbiAgICAgICAgICBvcGVyYXRvckFjdGlvbjogXCJSZXBsYWNlIHRoZSBwcm92aWRlciBBUEkga2V5IHdpdGggYSB2YWxpZCBrZXksIHRoZW4gcmV0cnkuXCIsXG4gICAgICAgICAgcHJvdmlkZXI6IFwib3BlbnJvdXRlclwiLFxuICAgICAgICAgIG1vZGVsOiBcInNlY3JldC1tb2RlbC1uYW1lXCIsXG4gICAgICAgICAgdGVybWluYWxSZWFzb246IHJhd0RpYWdub3N0aWMsXG4gICAgICAgICAgb3BlcmF0aW9uSWQ6IHJhd0NyZWRlbnRpYWwsXG4gICAgICAgIH0pLFxuICAgICAgICBjcmVhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMDowMC4wMDBaXCIsXG4gICAgICAgIHVwZGF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAxOjAwLjAwMFpcIixcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIGlkOiBcImUyZS1xdW90YS1mYWlsZWQtdGFza1wiLFxuICAgICAgICBwcm9qZWN0SWQ6IFwiZTJlLXByb2plY3RcIixcbiAgICAgICAgdGl0bGU6IFwiUmVjb3ZlciBxdW90YSBleGhhdXN0aW9uXCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIlRoZSBwcm92aWRlciBxdW90YSB0ZXN0IHRhc2sgZmFpbGVkLlwiLFxuICAgICAgICBzdGF0dXM6IFwiZmFpbGVkXCIsXG4gICAgICAgIHByaW9yaXR5OiBcInAxXCIsXG4gICAgICAgIHJldHJ5Q291bnQ6IDAsXG4gICAgICAgIG1heFJldHJpZXM6IDIsXG4gICAgICAgIGFnZW50UmVzcG9uc2U6IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgICBraW5kOiBcIkFJX1RBU0tfRVhFQ1VUSU9OX1JFQ0VJUFRcIixcbiAgICAgICAgICB0ZXJtaW5hbFN0YXR1czogXCJGQUlMRURcIixcbiAgICAgICAgICBhdmFpbGFiaWxpdHlTdGF0ZTogXCJxdW90YV9leGhhdXN0ZWRcIixcbiAgICAgICAgICBjb3JyZWxhdGlvbklkOiBzdXBwb3J0UmVmZXJlbmNlcy5xdW90YV9leGhhdXN0ZWQsXG4gICAgICAgICAgcHJvdmlkZXI6IFwib3BlbnJvdXRlclwiLFxuICAgICAgICAgIG1vZGVsOiBcInNlY3JldC1tb2RlbC1uYW1lXCIsXG4gICAgICAgICAgdGVybWluYWxSZWFzb246IHJhd0RpYWdub3N0aWMsXG4gICAgICAgICAgb3BlcmF0aW9uSWQ6IHJhd0NyZWRlbnRpYWwsXG4gICAgICAgIH0pLFxuICAgICAgICBjcmVhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMDowMC4wMDBaXCIsXG4gICAgICAgIHVwZGF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAxOjAwLjAwMFpcIixcbiAgICAgIH0sXG4gICAgXTtcbiAgICBjb25zdCB3b3JrZmxvd0lkID0gXCJlMmUtb3V0YWdlLXdvcmtmbG93XCI7XG4gICAgYXdhaXQgaW5zdGFsbEFwaUZpeHR1cmVzKHBhZ2UsIHtcbiAgICAgIHJlY292ZXJ5VGFza3MsXG4gICAgICByZWNvdmVyeVdvcmtmbG93czogW1xuICAgICAgICB7XG4gICAgICAgICAgaWQ6IHdvcmtmbG93SWQsXG4gICAgICAgICAgcHJvamVjdElkOiBcImUyZS1wcm9qZWN0XCIsXG4gICAgICAgICAgbmFtZTogXCJSZWNvdmVyIHByb3ZpZGVyIG91dGFnZVwiLFxuICAgICAgICAgIGRlc2NyaXB0aW9uOiBcIkEgcGlwZWxpbmUgdXNlZCB0byB2ZXJpZnkgb3V0YWdlIHJlY292ZXJ5IGd1aWRhbmNlLlwiLFxuICAgICAgICAgIHN0YXR1czogXCJmYWlsZWRcIixcbiAgICAgICAgICBwaGFzZXM6IFtcbiAgICAgICAgICAgIHsgbmFtZTogXCJidWlsZFwiLCBzdGVwczogW1wiY29tcGlsZVwiXSB9LFxuICAgICAgICAgICAgeyBuYW1lOiBcInRlc3RcIiwgc3RlcHM6IFtcInZlcmlmeVwiXSB9LFxuICAgICAgICAgIF0sXG4gICAgICAgICAgY3VycmVudFBoYXNlOiBcInRlc3RcIixcbiAgICAgICAgICBleGVjdXRpb25Db3VudDogMSxcbiAgICAgICAgICBjcmVhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMDowMC4wMDBaXCIsXG4gICAgICAgICAgdXBkYXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDE6MDAuMDAwWlwiLFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICAgIHJlY292ZXJ5V29ya2Zsb3dFeGVjdXRpb25zOiB7XG4gICAgICAgIFt3b3JrZmxvd0lkXTogW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIGlkOiBcImUyZS1vdXRhZ2UtZXhlY3V0aW9uXCIsXG4gICAgICAgICAgICB3b3JrZmxvd0lkLFxuICAgICAgICAgICAgc3RhdHVzOiBcImZhaWxlZFwiLFxuICAgICAgICAgICAgY3VycmVudFBoYXNlOiBcInRlc3RcIixcbiAgICAgICAgICAgIGNvbXBsZXRlZFBoYXNlczogW1wiYnVpbGRcIl0sXG4gICAgICAgICAgICBzdGFydGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMDowMC4wMDBaXCIsXG4gICAgICAgICAgICBlcnJvck1lc3NhZ2U6IHJhd0RpYWdub3N0aWMsXG4gICAgICAgICAgICByZWNvdmVyeToge1xuICAgICAgICAgICAgICBhdmFpbGFiaWxpdHlTdGF0ZTogXCJwcm92aWRlcl9vdXRhZ2VcIixcbiAgICAgICAgICAgICAgY29ycmVsYXRpb25JZDogc3VwcG9ydFJlZmVyZW5jZXMucHJvdmlkZXJfb3V0YWdlLFxuICAgICAgICAgICAgICBvcGVyYXRvckFjdGlvbjpcbiAgICAgICAgICAgICAgICBcIlJldHJ5IGluIGEgbW9tZW50OyBjb25maWd1cmUgYW5vdGhlciBwcm92aWRlciBpZiB0aGUgaXNzdWUgcGVyc2lzdHMuXCIsXG4gICAgICAgICAgICAgIGRpYWdub3N0aWM6IHJhd0NyZWRlbnRpYWwsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgIF0sXG4gICAgICB9LFxuICAgIH0pO1xuICAgIGF3YWl0IHByb2dyYW1tYXRpY1NpZ25JbihwYWdlKTtcblxuICAgIGF3YWl0IG9wZW5OYXZpZ2F0aW9uKHBhZ2UsIFwiVGFza3NcIiwgYCR7REFTSEJPQVJEX1BBVEh9dGFza3NgKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5TGFiZWwoXCJFeHBhbmQgdGFzayBSZWNvdmVyIGF1dGhlbnRpY2F0aW9uIGZhaWx1cmVcIiksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IHBhZ2VcbiAgICAgIC5nZXRCeUxhYmVsKFwiRXhwYW5kIHRhc2sgUmVjb3ZlciBhdXRoZW50aWNhdGlvbiBmYWlsdXJlXCIpXG4gICAgICAuY2xpY2soKTtcbiAgICBjb25zdCB0YXNrRGV0YWlscyA9IHBhZ2UubG9jYXRvcihcIiN0YXNrLWRldGFpbHMtZTJlLWF1dGgtZmFpbGVkLXRhc2tcIik7XG4gICAgYXdhaXQgZXhwZWN0KHRhc2tEZXRhaWxzKS50b0NvbnRhaW5UZXh0KFwiUHJvdmlkZXIgYXV0aGVudGljYXRpb24gZmFpbGVkXCIpO1xuICAgIGF3YWl0IGV4cGVjdCh0YXNrRGV0YWlscykudG9Db250YWluVGV4dChcbiAgICAgIFwiUmVwbGFjZSB0aGUgcHJvdmlkZXIgQVBJIGtleSB3aXRoIGEgdmFsaWQga2V5LCB0aGVuIHJldHJ5LlwiLFxuICAgICk7XG4gICAgYXdhaXQgZXhwZWN0KHRhc2tEZXRhaWxzKS50b0NvbnRhaW5UZXh0KFxuICAgICAgYFN1cHBvcnQgcmVmZXJlbmNlOiAke3N1cHBvcnRSZWZlcmVuY2VzLmF1dGhlbnRpY2F0aW9uX2ZhaWxlZH1gLFxuICAgICk7XG4gICAgYXdhaXQgcGFnZS5nZXRCeUxhYmVsKFwiRXhwYW5kIHRhc2sgUmVjb3ZlciBxdW90YSBleGhhdXN0aW9uXCIpLmNsaWNrKCk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlUZXh0KFwiUHJvdmlkZXIgcXVvdGEgaXMgZXhoYXVzdGVkXCIpKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KGBTdXBwb3J0IHJlZmVyZW5jZTogJHtzdXBwb3J0UmVmZXJlbmNlcy5xdW90YV9leGhhdXN0ZWR9YCksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IHBhZ2UucmVsb2FkKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeUxhYmVsKFwiRXhwYW5kIHRhc2sgUmVjb3ZlciBhdXRoZW50aWNhdGlvbiBmYWlsdXJlXCIpLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBwYWdlXG4gICAgICAuZ2V0QnlMYWJlbChcIkV4cGFuZCB0YXNrIFJlY292ZXIgYXV0aGVudGljYXRpb24gZmFpbHVyZVwiKVxuICAgICAgLmNsaWNrKCk7XG4gICAgY29uc3QgcmVsb2FkZWRBdXRoRGV0YWlscyA9IHBhZ2UubG9jYXRvcihcbiAgICAgIFwiI3Rhc2stZGV0YWlscy1lMmUtYXV0aC1mYWlsZWQtdGFza1wiLFxuICAgICk7XG4gICAgYXdhaXQgZXhwZWN0KHJlbG9hZGVkQXV0aERldGFpbHMpLnRvQ29udGFpblRleHQoXG4gICAgICBcIlByb3ZpZGVyIGF1dGhlbnRpY2F0aW9uIGZhaWxlZFwiLFxuICAgICk7XG4gICAgYXdhaXQgZXhwZWN0KHJlbG9hZGVkQXV0aERldGFpbHMpLnRvQ29udGFpblRleHQoXG4gICAgICBcIlJlcGxhY2UgdGhlIHByb3ZpZGVyIEFQSSBrZXkgd2l0aCBhIHZhbGlkIGtleSwgdGhlbiByZXRyeS5cIixcbiAgICApO1xuICAgIGF3YWl0IGV4cGVjdChyZWxvYWRlZEF1dGhEZXRhaWxzKS50b0NvbnRhaW5UZXh0KFxuICAgICAgYFN1cHBvcnQgcmVmZXJlbmNlOiAke3N1cHBvcnRSZWZlcmVuY2VzLmF1dGhlbnRpY2F0aW9uX2ZhaWxlZH1gLFxuICAgICk7XG4gICAgYXdhaXQgcGFnZS5nZXRCeUxhYmVsKFwiRXhwYW5kIHRhc2sgUmVjb3ZlciBxdW90YSBleGhhdXN0aW9uXCIpLmNsaWNrKCk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlUZXh0KFwiUHJvdmlkZXIgcXVvdGEgaXMgZXhoYXVzdGVkXCIpKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KGBTdXBwb3J0IHJlZmVyZW5jZTogJHtzdXBwb3J0UmVmZXJlbmNlcy5xdW90YV9leGhhdXN0ZWR9YCksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGNvbnN0IHJlbG9hZGVkVGFza1RleHQgPSBhd2FpdCBwYWdlLmxvY2F0b3IoXCJib2R5XCIpLmlubmVyVGV4dCgpO1xuICAgIGV4cGVjdChyZWxvYWRlZFRhc2tUZXh0KS5ub3QudG9Db250YWluKHJhd0RpYWdub3N0aWMpO1xuICAgIGV4cGVjdChyZWxvYWRlZFRhc2tUZXh0KS5ub3QudG9Db250YWluKHJhd0NyZWRlbnRpYWwpO1xuICAgIGV4cGVjdChyZWxvYWRlZFRhc2tUZXh0KS5ub3QudG9NYXRjaChcbiAgICAgIC9zZWNyZXQtbW9kZWwtbmFtZXxcXC9ob21lXFwvcnVubmVyfFxcL3RtcFxcLy9pLFxuICAgICk7XG5cbiAgICBhd2FpdCBvcGVuTmF2aWdhdGlvbihwYWdlLCBcIldvcmtmbG93c1wiLCBgJHtEQVNIQk9BUkRfUEFUSH13b3JrZmxvd3NgKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5nZXRCeVRleHQoXCJSZWNvdmVyIHByb3ZpZGVyIG91dGFnZVwiKSkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBwYWdlLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiRXhlY3V0aW9uIGhpc3RvcnlcIiB9KS5jbGljaygpO1xuICAgIGNvbnN0IGV4ZWN1dGlvbiA9IHBhZ2VcbiAgICAgIC5nZXRCeVRleHQoXCJmYWlsZWQgwrcgbm8gc3VjY2Vzc2Z1bCBjb21wbGV0aW9uXCIpXG4gICAgICAubG9jYXRvcihcIi4uXCIpXG4gICAgICAubG9jYXRvcihcIi4uXCIpO1xuICAgIGF3YWl0IGV4cGVjdChleGVjdXRpb24pLnRvQ29udGFpblRleHQoXG4gICAgICBcIlRoZSBwcm92aWRlciBpcyB0ZW1wb3JhcmlseSB1bmF2YWlsYWJsZVwiLFxuICAgICk7XG4gICAgYXdhaXQgZXhwZWN0KGV4ZWN1dGlvbikudG9Db250YWluVGV4dChcbiAgICAgIFwiUmV0cnkgaW4gYSBtb21lbnQ7IGNvbmZpZ3VyZSBhbm90aGVyIHByb3ZpZGVyIGlmIHRoZSBpc3N1ZSBwZXJzaXN0cy5cIixcbiAgICApO1xuICAgIGF3YWl0IGV4cGVjdChleGVjdXRpb24pLnRvQ29udGFpblRleHQoXG4gICAgICBgU3VwcG9ydCByZWZlcmVuY2U6ICR7c3VwcG9ydFJlZmVyZW5jZXMucHJvdmlkZXJfb3V0YWdlfWAsXG4gICAgKTtcbiAgICBhd2FpdCBwYWdlLnJlbG9hZCgpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlLmdldEJ5VGV4dChcIlJlY292ZXIgcHJvdmlkZXIgb3V0YWdlXCIpKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJFeGVjdXRpb24gaGlzdG9yeVwiIH0pLmNsaWNrKCk7XG4gICAgY29uc3QgcmVsb2FkZWRFeGVjdXRpb24gPSBwYWdlXG4gICAgICAuZ2V0QnlUZXh0KFwiZmFpbGVkIMK3IG5vIHN1Y2Nlc3NmdWwgY29tcGxldGlvblwiKVxuICAgICAgLmxvY2F0b3IoXCIuLlwiKVxuICAgICAgLmxvY2F0b3IoXCIuLlwiKTtcbiAgICBhd2FpdCBleHBlY3QocmVsb2FkZWRFeGVjdXRpb24pLnRvQ29udGFpblRleHQoXG4gICAgICBcIlRoZSBwcm92aWRlciBpcyB0ZW1wb3JhcmlseSB1bmF2YWlsYWJsZVwiLFxuICAgICk7XG4gICAgYXdhaXQgZXhwZWN0KHJlbG9hZGVkRXhlY3V0aW9uKS50b0NvbnRhaW5UZXh0KFxuICAgICAgXCJSZXRyeSBpbiBhIG1vbWVudDsgY29uZmlndXJlIGFub3RoZXIgcHJvdmlkZXIgaWYgdGhlIGlzc3VlIHBlcnNpc3RzLlwiLFxuICAgICk7XG4gICAgYXdhaXQgZXhwZWN0KHJlbG9hZGVkRXhlY3V0aW9uKS50b0NvbnRhaW5UZXh0KFxuICAgICAgYFN1cHBvcnQgcmVmZXJlbmNlOiAke3N1cHBvcnRSZWZlcmVuY2VzLnByb3ZpZGVyX291dGFnZX1gLFxuICAgICk7XG5cbiAgICBjb25zdCB2aXNpYmxlVGV4dCA9IGF3YWl0IHBhZ2UubG9jYXRvcihcImJvZHlcIikuaW5uZXJUZXh0KCk7XG4gICAgZXhwZWN0KHZpc2libGVUZXh0KS5ub3QudG9Db250YWluKHJhd0RpYWdub3N0aWMpO1xuICAgIGV4cGVjdCh2aXNpYmxlVGV4dCkubm90LnRvQ29udGFpbihyYXdDcmVkZW50aWFsKTtcbiAgICBleHBlY3QodmlzaWJsZVRleHQpLm5vdC50b01hdGNoKFxuICAgICAgL3NlY3JldC1tb2RlbC1uYW1lfFxcL2hvbWVcXC9ydW5uZXJ8XFwvdG1wXFwvL2ksXG4gICAgKTtcbiAgICBhd2FpdCBleHBlY3ROb0hvcml6b250YWxPdmVyZmxvdyhwYWdlKTtcbiAgfSk7XG5cbiAgdGVzdChcInByb3ZlcyByZW1lZGlhdGlvbiBwbGFucywgcmV2aWV3IHN0YXRlLCBhbmQgdGFzayBhY3Rpb24gdHJhbnNpdGlvbnNcIiwgYXN5bmMgKHtcbiAgICBwYWdlLFxuICB9KSA9PiB7XG4gICAgY29uc3QgcmF3UHJvbXB0ID0gXCJJTlRFUk5BTF9QUk9NUFRfc2hvdWxkX25ldmVyX3JlbmRlclwiO1xuICAgIGNvbnN0IHJhd0RpYWdub3N0aWMgPSBcInJhdy1wcm92aWRlci1kaWFnbm9zdGljLXNob3VsZC1uZXZlci1yZW5kZXJcIjtcbiAgICBjb25zdCByZWFkeVRhc2tJZCA9IFwiZTJlLXJlYWR5LXJlbWVkaWF0aW9uLXRhc2tcIjtcbiAgICBjb25zdCByZXZpZXdUYXNrSWQgPSBcImUyZS1yZXZpZXctcmVtZWRpYXRpb24tdGFza1wiO1xuICAgIGNvbnN0IHZlcmlmaWNhdGlvblRhc2tJZCA9IFwiZTJlLXZlcmlmaWNhdGlvbi1yZW1lZGlhdGlvbi10YXNrXCI7XG4gICAgY29uc3QgcmVtZWRpYXRpb25UYXNrcyA9IFtcbiAgICAgIHtcbiAgICAgICAgaWQ6IHJlYWR5VGFza0lkLFxuICAgICAgICBwcm9qZWN0SWQ6IFwiZTJlLXByb2plY3RcIixcbiAgICAgICAgdGl0bGU6IFwiRXhlY3V0ZSBTUUwgaW5wdXQgc2FuaXRpemF0aW9uIHJlbWVkaWF0aW9uXCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIkEgY29tcGxldGUgcmVtZWRpYXRpb24gcGxhbiBpcyByZWFkeSBmb3Igb3BlcmF0b3IgZXhlY3V0aW9uLlwiLFxuICAgICAgICBzdGF0dXM6IFwicGVuZGluZ1wiLFxuICAgICAgICBwcmlvcml0eTogXCJwMVwiLFxuICAgICAgICBwaGFzZTogXCJSZW1lZGlhdGlvblwiLFxuICAgICAgICByZWxhdGVkRmlsZXM6IFtcInNyYy9hdXRoL2lucHV0LnRzXCJdLFxuICAgICAgICByZXRyeUNvdW50OiAwLFxuICAgICAgICBtYXhSZXRyaWVzOiAyLFxuICAgICAgICBwcm9tcHQ6IHJhd1Byb21wdCxcbiAgICAgICAgYWdlbnRSZXNwb25zZTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgIGtpbmQ6IFwiQUlfVEFTS19FWEVDVVRJT05fUkVDRUlQVFwiLFxuICAgICAgICAgIHRlcm1pbmFsU3RhdHVzOiBcIlJFQ09SREVEXCIsXG4gICAgICAgICAgdGVybWluYWxSZWFzb246IHJhd0RpYWdub3N0aWMsXG4gICAgICAgIH0pLFxuICAgICAgICByZW1lZGlhdGlvblBsYW46IHtcbiAgICAgICAgICB2ZXJzaW9uOiAxLFxuICAgICAgICAgIHJ1bGVJZDogXCJlMmUtcnVsZS1zcWwtaW5wdXRcIixcbiAgICAgICAgICBydWxlQ29kZTogXCJTRUMtMDAxXCIsXG4gICAgICAgICAgcnVsZVRpdGxlOiBcIlVuc2FuaXRpemVkIFNRTCBpbnB1dFwiLFxuICAgICAgICAgIHNldmVyaXR5OiBcImhpZ2hcIixcbiAgICAgICAgICBvY2N1cnJlbmNlQ291bnQ6IDIsXG4gICAgICAgICAgZXZpZGVuY2U6IFtcbiAgICAgICAgICAgIHsgZmlsZTogXCJzcmMvYXV0aC9pbnB1dC50c1wiLCBsaW5lOiAxMCwgc25pcHBldDogXCJxdWVyeSh1c2VySW5wdXQpXCIsIG9jY3VycmVuY2VzOiAxIH0sXG4gICAgICAgICAgICB7IGZpbGU6IFwic3JjL2F1dGgvaW5wdXQudHNcIiwgbGluZTogMTgsIHNuaXBwZXQ6IFwicXVlcnkoYWNjb3VudElkKVwiLCBvY2N1cnJlbmNlczogMSB9LFxuICAgICAgICAgICAgeyBmaWxlOiBcInNyYy9hdXRoL2lucHV0LnRzXCIsIGxpbmU6IDI3LCBzbmlwcGV0OiBcInF1ZXJ5KGZpbHRlcilcIiwgb2NjdXJyZW5jZXM6IDEgfSxcbiAgICAgICAgICAgIHsgZmlsZTogXCJzcmMvYXV0aC9pbnB1dC50c1wiLCBsaW5lOiAzMSwgc25pcHBldDogXCJxdWVyeShzb3J0KVwiLCBvY2N1cnJlbmNlczogMSB9LFxuICAgICAgICAgICAgeyBmaWxlOiBcInNyYy9hdXRoL2lucHV0LnRzXCIsIGxpbmU6IDQ0LCBzbmlwcGV0OiBcInF1ZXJ5KGxpbWl0KVwiLCBvY2N1cnJlbmNlczogMSB9LFxuICAgICAgICAgICAgeyBmaWxlOiBcInNyYy9hdXRoL2lucHV0LnRzXCIsIGxpbmU6IDUyLCBzbmlwcGV0OiBcInF1ZXJ5KG9mZnNldClcIiwgb2NjdXJyZW5jZXM6IDEgfSxcbiAgICAgICAgICBdLFxuICAgICAgICAgIHJlbGF0ZWRGaWxlczogW1wic3JjL2F1dGgvaW5wdXQudHNcIl0sXG4gICAgICAgICAgZml4RGVzY3JpcHRpb246IFwiVXNlIHRoZSBwYXJhbWV0ZXJpemVkIHF1ZXJ5IGhlbHBlciBmb3IgZXZlcnkgdXNlci1jb250cm9sbGVkIHZhbHVlLlwiLFxuICAgICAgICAgIHZlcmlmaWNhdGlvblN0ZXBzOiBbXG4gICAgICAgICAgICBcIlJ1biB0aGUgU1FMIGluamVjdGlvbiByZWdyZXNzaW9uIHRlc3QuXCIsXG4gICAgICAgICAgICBcIkNvbmZpcm0gYWxsIHVzZXItY29udHJvbGxlZCBxdWVyeSB2YWx1ZXMgdXNlIHBhcmFtZXRlcnMuXCIsXG4gICAgICAgICAgXSxcbiAgICAgICAgICBzb3VyY2U6IHtcbiAgICAgICAgICAgIHR5cGU6IFwic2NhblwiLFxuICAgICAgICAgICAgY29ycmVsYXRpb25JZDogXCJlMmUtc2Nhbi1jb3JyZWxhdGlvblwiLFxuICAgICAgICAgICAgcmV2aXNpb246IFwicmVtZWRpYXRpb24tcmV2aXNpb24tNDJcIixcbiAgICAgICAgICAgIGNvbXBsZXRlbmVzczogXCJDT01QTEVURVwiLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgc3RhdHVzOiBcInJlYWR5XCIsXG4gICAgICAgIH0sXG4gICAgICAgIGNyZWF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAwOjAwLjAwMFpcIixcbiAgICAgICAgdXBkYXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDE6MDAuMDAwWlwiLFxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgaWQ6IHJldmlld1Rhc2tJZCxcbiAgICAgICAgcHJvamVjdElkOiBcImUyZS1wcm9qZWN0XCIsXG4gICAgICAgIHRpdGxlOiBcIlJldmlldyBpbmNvbXBsZXRlIFNRTCByZW1lZGlhdGlvbiBldmlkZW5jZVwiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJBbiBpbmNvbXBsZXRlIHBsYW4gbXVzdCBzdGF5IGJsb2NrZWQgdW50aWwgYW4gb3BlcmF0b3IgcmV2aWV3cyBpdC5cIixcbiAgICAgICAgc3RhdHVzOiBcImZhaWxlZFwiLFxuICAgICAgICBwcmlvcml0eTogXCJwMVwiLFxuICAgICAgICBwaGFzZTogXCJSZW1lZGlhdGlvblwiLFxuICAgICAgICByZWxhdGVkRmlsZXM6IFtcInNyYy9hdXRoL2lucHV0LnRzXCJdLFxuICAgICAgICByZXRyeUNvdW50OiAwLFxuICAgICAgICBtYXhSZXRyaWVzOiAyLFxuICAgICAgICBwcm9tcHQ6IHJhd1Byb21wdCxcbiAgICAgICAgYWdlbnRSZXNwb25zZTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgIGtpbmQ6IFwiQUlfVEFTS19FWEVDVVRJT05fUkVDRUlQVFwiLFxuICAgICAgICAgIHRlcm1pbmFsU3RhdHVzOiBcIkZBSUxFRFwiLFxuICAgICAgICAgIHRlcm1pbmFsUmVhc29uOiByYXdEaWFnbm9zdGljLFxuICAgICAgICB9KSxcbiAgICAgICAgcmVtZWRpYXRpb25QbGFuOiB7XG4gICAgICAgICAgdmVyc2lvbjogMSxcbiAgICAgICAgICBydWxlSWQ6IFwiZTJlLXJ1bGUtbWlzc2luZy1ldmlkZW5jZVwiLFxuICAgICAgICAgIHJ1bGVDb2RlOiBcIlNFQy0wMDJcIixcbiAgICAgICAgICBydWxlVGl0bGU6IFwiSW5jb21wbGV0ZSBldmlkZW5jZSByZXZpZXdcIixcbiAgICAgICAgICBzZXZlcml0eTogXCJjcml0aWNhbFwiLFxuICAgICAgICAgIG9jY3VycmVuY2VDb3VudDogMSxcbiAgICAgICAgICBldmlkZW5jZTogW10sXG4gICAgICAgICAgcmVsYXRlZEZpbGVzOiBbXCJzcmMvYXV0aC9pbnB1dC50c1wiXSxcbiAgICAgICAgICBmaXhEZXNjcmlwdGlvbjogbnVsbCxcbiAgICAgICAgICB2ZXJpZmljYXRpb25TdGVwczogW10sXG4gICAgICAgICAgc291cmNlOiB7XG4gICAgICAgICAgICB0eXBlOiBcImRpc2NvdmVyeVwiLFxuICAgICAgICAgICAgY29ycmVsYXRpb25JZDogXCJlMmUtZGlzY292ZXJ5LWNvcnJlbGF0aW9uXCIsXG4gICAgICAgICAgICByZXZpc2lvbjogbnVsbCxcbiAgICAgICAgICAgIGNvbXBsZXRlbmVzczogXCJQQVJUSUFMXCIsXG4gICAgICAgICAgfSxcbiAgICAgICAgICBzdGF0dXM6IFwibmVlZHNfcmV2aWV3XCIsXG4gICAgICAgIH0sXG4gICAgICAgIGNyZWF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAwOjAwLjAwMFpcIixcbiAgICAgICAgdXBkYXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDE6MDAuMDAwWlwiLFxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgaWQ6IHZlcmlmaWNhdGlvblRhc2tJZCxcbiAgICAgICAgcHJvamVjdElkOiBcImUyZS1wcm9qZWN0XCIsXG4gICAgICAgIHRpdGxlOiBcIlZlcmlmeSBwYXJhbWV0ZXJpemVkIFNRTCByZW1lZGlhdGlvblwiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJBbiBvcGVyYXRvciBtdXN0IHJlY29yZCBldmlkZW5jZSBmb3IgZXZlcnkgdmVyaWZpY2F0aW9uIGNoZWNrLlwiLFxuICAgICAgICBzdGF0dXM6IFwidmVyaWZ5aW5nXCIsXG4gICAgICAgIHByaW9yaXR5OiBcInAxXCIsXG4gICAgICAgIHBoYXNlOiBcIlJlbWVkaWF0aW9uXCIsXG4gICAgICAgIHJlbGF0ZWRGaWxlczogW1wic3JjL2F1dGgvaW5wdXQudHNcIl0sXG4gICAgICAgIHJldHJ5Q291bnQ6IDAsXG4gICAgICAgIG1heFJldHJpZXM6IDIsXG4gICAgICAgIHByb21wdDogcmF3UHJvbXB0LFxuICAgICAgICByZW1lZGlhdGlvblBsYW46IHtcbiAgICAgICAgICB2ZXJzaW9uOiAxLFxuICAgICAgICAgIHJ1bGVJZDogXCJlMmUtcnVsZS12ZXJpZmljYXRpb25cIixcbiAgICAgICAgICBydWxlQ29kZTogXCJTRUMtMDAzXCIsXG4gICAgICAgICAgcnVsZVRpdGxlOiBcIlBhcmFtZXRlcml6ZWQgU1FMIHJlbWVkaWF0aW9uXCIsXG4gICAgICAgICAgc2V2ZXJpdHk6IFwiaGlnaFwiLFxuICAgICAgICAgIG9jY3VycmVuY2VDb3VudDogMixcbiAgICAgICAgICBldmlkZW5jZTogW1xuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBmaWxlOiBcInNyYy9hdXRoL2lucHV0LnRzXCIsXG4gICAgICAgICAgICAgIGxpbmU6IDEwLFxuICAgICAgICAgICAgICBzbmlwcGV0OiBcInF1ZXJ5KHVzZXJJbnB1dClcIixcbiAgICAgICAgICAgICAgb2NjdXJyZW5jZXM6IDEsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIF0sXG4gICAgICAgICAgcmVsYXRlZEZpbGVzOiBbXCJzcmMvYXV0aC9pbnB1dC50c1wiXSxcbiAgICAgICAgICBmaXhEZXNjcmlwdGlvbjogXCJVc2UgdGhlIHBhcmFtZXRlcml6ZWQgcXVlcnkgaGVscGVyIGZvciBldmVyeSB1c2VyLWNvbnRyb2xsZWQgdmFsdWUuXCIsXG4gICAgICAgICAgdmVyaWZpY2F0aW9uU3RlcHM6IFtcbiAgICAgICAgICAgIFwiUnVuIHRoZSBTUUwgaW5qZWN0aW9uIHJlZ3Jlc3Npb24gdGVzdC5cIixcbiAgICAgICAgICAgIFwiQ29uZmlybSBhbGwgdXNlci1jb250cm9sbGVkIHF1ZXJ5IHZhbHVlcyB1c2UgcGFyYW1ldGVycy5cIixcbiAgICAgICAgICBdLFxuICAgICAgICAgIHNvdXJjZToge1xuICAgICAgICAgICAgdHlwZTogXCJzY2FuXCIsXG4gICAgICAgICAgICBjb3JyZWxhdGlvbklkOiBcImUyZS12ZXJpZmljYXRpb24tY29ycmVsYXRpb25cIixcbiAgICAgICAgICAgIHJldmlzaW9uOiBcInJlbWVkaWF0aW9uLXJldmlzaW9uLTQzXCIsXG4gICAgICAgICAgICBjb21wbGV0ZW5lc3M6IFwiQ09NUExFVEVcIixcbiAgICAgICAgICB9LFxuICAgICAgICAgIHN0YXR1czogXCJyZWFkeVwiLFxuICAgICAgICB9LFxuICAgICAgICBjcmVhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMDowMC4wMDBaXCIsXG4gICAgICAgIHVwZGF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAzOjAwLjAwMFpcIixcbiAgICAgIH0sXG4gICAgXTtcbiAgICBjb25zdCBhY3Rpb25SZXF1ZXN0czogc3RyaW5nW10gPSBbXTtcbiAgICBjb25zdCB2ZXJpZmljYXRpb25SZXF1ZXN0czogQXJyYXk8UmVjb3JkPHN0cmluZywgdW5rbm93bj4+ID0gW107XG4gICAgYXdhaXQgaW5zdGFsbEFwaUZpeHR1cmVzKHBhZ2UsIHtcbiAgICAgIHRhc2tBY3Rpb25zOiB7XG4gICAgICAgIHRhc2tzOiByZW1lZGlhdGlvblRhc2tzLFxuICAgICAgICByZXF1ZXN0czogYWN0aW9uUmVxdWVzdHMsXG4gICAgICAgIHZlcmlmaWNhdGlvblJlcXVlc3RzLFxuICAgICAgfSxcbiAgICB9KTtcbiAgICBhd2FpdCBwcm9ncmFtbWF0aWNTaWduSW4ocGFnZSk7XG4gICAgYXdhaXQgb3Blbk5hdmlnYXRpb24ocGFnZSwgXCJUYXNrc1wiLCBgJHtEQVNIQk9BUkRfUEFUSH10YXNrc2ApO1xuXG4gICAgY29uc3QgcmVhZHlSb3cgPSBwYWdlLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7XG4gICAgICBuYW1lOiAvdGFzayBFeGVjdXRlIFNRTCBpbnB1dCBzYW5pdGl6YXRpb24gcmVtZWRpYXRpb24vLFxuICAgIH0pO1xuICAgIGF3YWl0IGV4cGVjdChyZWFkeVJvdykudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5nZXRCeVRpdGxlKFwiRXhlY3V0ZVwiKSkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCByZWFkeVJvdy5jbGljaygpO1xuXG4gICAgY29uc3QgcmVhZHlEZXRhaWxzID0gcGFnZS5sb2NhdG9yKGAjdGFzay1kZXRhaWxzLSR7cmVhZHlUYXNrSWR9YCk7XG4gICAgY29uc3QgcmVhZHlQbGFuID0gcmVhZHlEZXRhaWxzLmdldEJ5Um9sZShcInJlZ2lvblwiLCB7XG4gICAgICBuYW1lOiBcIlJlbWVkaWF0aW9uIHBsYW5cIixcbiAgICB9KTtcbiAgICBhd2FpdCBleHBlY3QocmVhZHlQbGFuKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChyZWFkeVBsYW4pLnRvQ29udGFpblRleHQoXCJTRUMtMDAxXCIpO1xuICAgIGF3YWl0IGV4cGVjdChyZWFkeVBsYW4pLnRvQ29udGFpblRleHQoXCJVbnNhbml0aXplZCBTUUwgaW5wdXRcIik7XG4gICAgYXdhaXQgZXhwZWN0KHJlYWR5UGxhbikudG9Db250YWluVGV4dChcImhpZ2hcIik7XG4gICAgYXdhaXQgZXhwZWN0KHJlYWR5UGxhbikudG9Db250YWluVGV4dChcIjIgb2NjdXJyZW5jZShzKVwiKTtcbiAgICBhd2FpdCBleHBlY3QocmVhZHlQbGFuKS50b0NvbnRhaW5UZXh0KFwic3JjL2F1dGgvaW5wdXQudHM6MTBcIik7XG4gICAgYXdhaXQgZXhwZWN0KHJlYWR5UGxhbikudG9Db250YWluVGV4dChcInNyYy9hdXRoL2lucHV0LnRzOjQ0XCIpO1xuICAgIGF3YWl0IGV4cGVjdChyZWFkeVBsYW4pLnRvQ29udGFpblRleHQoXCIrMSBtb3JlIGV2aWRlbmNlIGl0ZW1zXCIpO1xuICAgIGF3YWl0IGV4cGVjdChyZWFkeVBsYW4pLm5vdC50b0NvbnRhaW5UZXh0KFwic3JjL2F1dGgvaW5wdXQudHM6NTJcIik7XG4gICAgYXdhaXQgZXhwZWN0KHJlYWR5UGxhbikudG9Db250YWluVGV4dChcbiAgICAgIFwiVXNlIHRoZSBwYXJhbWV0ZXJpemVkIHF1ZXJ5IGhlbHBlciBmb3IgZXZlcnkgdXNlci1jb250cm9sbGVkIHZhbHVlLlwiLFxuICAgICk7XG4gICAgYXdhaXQgZXhwZWN0KHJlYWR5UGxhbikudG9Db250YWluVGV4dChcIlJ1biB0aGUgU1FMIGluamVjdGlvbiByZWdyZXNzaW9uIHRlc3QuXCIpO1xuICAgIGF3YWl0IGV4cGVjdChyZWFkeVBsYW4pLnRvQ29udGFpblRleHQoXCJDb25maXJtIGFsbCB1c2VyLWNvbnRyb2xsZWQgcXVlcnkgdmFsdWVzIHVzZSBwYXJhbWV0ZXJzLlwiKTtcbiAgICBhd2FpdCBleHBlY3QocmVhZHlQbGFuKS50b0NvbnRhaW5UZXh0KFwiUmVhZHkgdG8gZXhlY3V0ZVwiKTtcbiAgICBhd2FpdCBleHBlY3QocmVhZHlQbGFuKS50b0NvbnRhaW5UZXh0KFwiU291cmNlOiBzY2FuXCIpO1xuICAgIGF3YWl0IGV4cGVjdChyZWFkeVBsYW4pLnRvQ29udGFpblRleHQoXCJyZXZpc2lvbiByZW1lZGlhdGlvbi1cIik7XG4gICAgYXdhaXQgZXhwZWN0KHJlYWR5RGV0YWlscy5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIkRldGFpbHNcIiB9KSkudG9CZVZpc2libGUoKTtcblxuICAgIGF3YWl0IHBhZ2UuZ2V0QnlUaXRsZShcIkV4ZWN1dGVcIikuY2xpY2soKTtcbiAgICBhd2FpdCBleHBlY3QucG9sbCgoKSA9PiBhY3Rpb25SZXF1ZXN0cy5sZW5ndGgpLnRvQmUoMSk7XG4gICAgZXhwZWN0KGFjdGlvblJlcXVlc3RzWzBdKS50b0JlKGBleGVjdXRlOiR7cmVhZHlUYXNrSWR9YCk7XG4gICAgYXdhaXQgZXhwZWN0KHJlYWR5Um93KS50b0NvbnRhaW5UZXh0KFwicnVubmluZ1wiKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5nZXRCeVRpdGxlKFwiRXhlY3V0ZVwiKSkudG9IYXZlQ291bnQoMCk7XG5cbiAgICBjb25zdCByZXZpZXdSb3cgPSBwYWdlLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7XG4gICAgICBuYW1lOiAvdGFzayBSZXZpZXcgaW5jb21wbGV0ZSBTUUwgcmVtZWRpYXRpb24gZXZpZGVuY2UvLFxuICAgIH0pO1xuICAgIGF3YWl0IHJldmlld1Jvdy5jbGljaygpO1xuICAgIGNvbnN0IHJldmlld0RldGFpbHMgPSBwYWdlLmxvY2F0b3IoYCN0YXNrLWRldGFpbHMtJHtyZXZpZXdUYXNrSWR9YCk7XG4gICAgY29uc3QgcmV2aWV3UGxhbiA9IHJldmlld0RldGFpbHMuZ2V0QnlSb2xlKFwicmVnaW9uXCIsIHtcbiAgICAgIG5hbWU6IFwiUmVtZWRpYXRpb24gcGxhblwiLFxuICAgIH0pO1xuICAgIGF3YWl0IGV4cGVjdChyZXZpZXdQbGFuKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChyZXZpZXdQbGFuKS50b0NvbnRhaW5UZXh0KFwiU0VDLTAwMlwiKTtcbiAgICBhd2FpdCBleHBlY3QocmV2aWV3UGxhbikudG9Db250YWluVGV4dChcIkluY29tcGxldGUgZXZpZGVuY2UgcmV2aWV3XCIpO1xuICAgIGF3YWl0IGV4cGVjdChyZXZpZXdQbGFuKS50b0NvbnRhaW5UZXh0KFwiY3JpdGljYWxcIik7XG4gICAgYXdhaXQgZXhwZWN0KHJldmlld1BsYW4pLnRvQ29udGFpblRleHQoXCIxIG9jY3VycmVuY2UocylcIik7XG4gICAgYXdhaXQgZXhwZWN0KHJldmlld1BsYW4pLnRvQ29udGFpblRleHQoXCJOZWVkcyByZXZpZXdcIik7XG4gICAgYXdhaXQgZXhwZWN0KHJldmlld1BsYW4pLnRvQ29udGFpblRleHQoXCJObyBib3VuZGVkIGV2aWRlbmNlIHdhcyByZXRhaW5lZC5cIik7XG4gICAgYXdhaXQgZXhwZWN0KHJldmlld1BsYW4pLnRvQ29udGFpblRleHQoXCJObyB2ZXJpZmljYXRpb24gc3RlcHMgc3VwcGxpZWQuXCIpO1xuICAgIGF3YWl0IGV4cGVjdChyZXZpZXdQbGFuKS50b0NvbnRhaW5UZXh0KFwiU291cmNlOiBkaXNjb3ZlcnlcIik7XG4gICAgYXdhaXQgZXhwZWN0KHJldmlld1BsYW4pLnRvQ29udGFpblRleHQoXCJyZXZpc2lvbiB1bmF2YWlsYWJsZVwiKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5nZXRCeVRpdGxlKFwiUmV0cnlcIikpLnRvQmVWaXNpYmxlKCk7XG5cbiAgICBhd2FpdCBwYWdlLmdldEJ5VGl0bGUoXCJSZXRyeVwiKS5jbGljaygpO1xuICAgIGF3YWl0IGV4cGVjdC5wb2xsKCgpID0+IGFjdGlvblJlcXVlc3RzLmxlbmd0aCkudG9CZSgyKTtcbiAgICBleHBlY3QoYWN0aW9uUmVxdWVzdHNbMV0pLnRvQmUoYHJldHJ5OiR7cmV2aWV3VGFza0lkfWApO1xuICAgIGF3YWl0IGV4cGVjdChyZXZpZXdSb3cpLnRvQ29udGFpblRleHQoXCJxdWV1ZWRcIik7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlUaXRsZShcIlJldHJ5XCIpKS50b0hhdmVDb3VudCgwKTtcblxuICAgIGNvbnN0IHZlcmlmaWNhdGlvblJvdyA9IHBhZ2UuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHtcbiAgICAgIG5hbWU6IC90YXNrIFZlcmlmeSBwYXJhbWV0ZXJpemVkIFNRTCByZW1lZGlhdGlvbi8sXG4gICAgfSk7XG4gICAgYXdhaXQgdmVyaWZpY2F0aW9uUm93LmNsaWNrKCk7XG4gICAgY29uc3QgdmVyaWZpY2F0aW9uRGV0YWlscyA9IHBhZ2UubG9jYXRvcihcbiAgICAgIGAjdGFzay1kZXRhaWxzLSR7dmVyaWZpY2F0aW9uVGFza0lkfWAsXG4gICAgKTtcbiAgICBjb25zdCB2ZXJpZmljYXRpb25QbGFuID0gdmVyaWZpY2F0aW9uRGV0YWlscy5nZXRCeVJvbGUoXCJyZWdpb25cIiwge1xuICAgICAgbmFtZTogXCJSZW1lZGlhdGlvbiBwbGFuXCIsXG4gICAgfSk7XG4gICAgY29uc3QgdmVyaWZpY2F0aW9uQ2hlY2tzID0gdmVyaWZpY2F0aW9uRGV0YWlscy5nZXRCeVJvbGUoXCJyZWdpb25cIiwge1xuICAgICAgbmFtZTogXCJPcGVyYXRvciB2ZXJpZmljYXRpb24gY2hlY2tzXCIsXG4gICAgfSk7XG4gICAgYXdhaXQgZXhwZWN0KHZlcmlmaWNhdGlvblBsYW4pLnRvQ29udGFpblRleHQoXCJTRUMtMDAzXCIpO1xuICAgIGF3YWl0IGV4cGVjdCh2ZXJpZmljYXRpb25QbGFuKS50b0NvbnRhaW5UZXh0KFwiUmVhZHkgdG8gZXhlY3V0ZVwiKTtcbiAgICBhd2FpdCB2ZXJpZmljYXRpb25EZXRhaWxzXG4gICAgICAuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJSdW4gYW5kIHJlY29yZCB2ZXJpZmljYXRpb24gY2hlY2tzXCIgfSlcbiAgICAgIC5jbGljaygpO1xuICAgIGF3YWl0IGV4cGVjdCh2ZXJpZmljYXRpb25DaGVja3MpLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KHZlcmlmaWNhdGlvbkNoZWNrcykudG9Db250YWluVGV4dChcIkluY29tcGxldGVcIik7XG5cbiAgICBjb25zdCBmaXJzdEd1aWRhbmNlID0gXCJSdW4gdGhlIFNRTCBpbmplY3Rpb24gcmVncmVzc2lvbiB0ZXN0LlwiO1xuICAgIGNvbnN0IHNlY29uZEd1aWRhbmNlID1cbiAgICAgIFwiQ29uZmlybSBhbGwgdXNlci1jb250cm9sbGVkIHF1ZXJ5IHZhbHVlcyB1c2UgcGFyYW1ldGVycy5cIjtcbiAgICBjb25zdCBmaXJzdEV2aWRlbmNlID0gdmVyaWZpY2F0aW9uQ2hlY2tzLmdldEJ5TGFiZWwoXG4gICAgICBgRXZpZGVuY2UgZm9yICR7Zmlyc3RHdWlkYW5jZX1gLFxuICAgICk7XG4gICAgY29uc3Qgc2Vjb25kRXZpZGVuY2UgPSB2ZXJpZmljYXRpb25DaGVja3MuZ2V0QnlMYWJlbChcbiAgICAgIGBFdmlkZW5jZSBmb3IgJHtzZWNvbmRHdWlkYW5jZX1gLFxuICAgICk7XG4gICAgY29uc3QgcGFzc0J1dHRvbnMgPSB2ZXJpZmljYXRpb25DaGVja3MuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHtcbiAgICAgIG5hbWU6IFwiUmVjb3JkIHBhc3NlZFwiLFxuICAgIH0pO1xuICAgIGNvbnN0IGZhaWxlZEJ1dHRvbnMgPSB2ZXJpZmljYXRpb25DaGVja3MuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHtcbiAgICAgIG5hbWU6IFwiUmVjb3JkIGZhaWxlZFwiLFxuICAgIH0pO1xuICAgIGF3YWl0IGV4cGVjdChwYXNzQnV0dG9ucy5udGgoMCkpLnRvQmVEaXNhYmxlZCgpO1xuICAgIGF3YWl0IGZpcnN0RXZpZGVuY2UuZmlsbChcIlRoZSByZWdyZXNzaW9uIHRlc3Qgc3RpbGwgZmFpbHMgYmVmb3JlIHRoZSBmaXguXCIpO1xuICAgIGF3YWl0IGZhaWxlZEJ1dHRvbnMubnRoKDApLmNsaWNrKCk7XG4gICAgYXdhaXQgZXhwZWN0LnBvbGwoKCkgPT4gdmVyaWZpY2F0aW9uUmVxdWVzdHMubGVuZ3RoKS50b0JlKDEpO1xuICAgIGV4cGVjdCh2ZXJpZmljYXRpb25SZXF1ZXN0c1swXSkudG9NYXRjaE9iamVjdCh7XG4gICAgICB0YXNrSWQ6IHZlcmlmaWNhdGlvblRhc2tJZCxcbiAgICAgIGNoZWNrSWQ6IFwicnVsZS12ZXJpZmljYXRpb24tMVwiLFxuICAgICAgcGFzc2VkOiBmYWxzZSxcbiAgICB9KTtcbiAgICBhd2FpdCBleHBlY3QodmVyaWZpY2F0aW9uQ2hlY2tzKS50b0NvbnRhaW5UZXh0KFwiSW5jb21wbGV0ZVwiKTtcbiAgICBhd2FpdCBleHBlY3QodmVyaWZpY2F0aW9uUm93KS50b0NvbnRhaW5UZXh0KFwidmVyaWZ5aW5nXCIpO1xuXG4gICAgYXdhaXQgZmlyc3RFdmlkZW5jZS5maWxsKFwiVGhlIGZvY3VzZWQgcmVncmVzc2lvbiB0ZXN0IHBhc3NlcyBhZnRlciB0aGUgZml4LlwiKTtcbiAgICBhd2FpdCBwYXNzQnV0dG9ucy5udGgoMCkuY2xpY2soKTtcbiAgICBhd2FpdCBleHBlY3QucG9sbCgoKSA9PiB2ZXJpZmljYXRpb25SZXF1ZXN0cy5sZW5ndGgpLnRvQmUoMik7XG4gICAgZXhwZWN0KHZlcmlmaWNhdGlvblJlcXVlc3RzWzFdKS50b01hdGNoT2JqZWN0KHtcbiAgICAgIHRhc2tJZDogdmVyaWZpY2F0aW9uVGFza0lkLFxuICAgICAgY2hlY2tJZDogXCJydWxlLXZlcmlmaWNhdGlvbi0xXCIsXG4gICAgICBwYXNzZWQ6IHRydWUsXG4gICAgICBldmlkZW5jZTogXCJUaGUgZm9jdXNlZCByZWdyZXNzaW9uIHRlc3QgcGFzc2VzIGFmdGVyIHRoZSBmaXguXCIsXG4gICAgfSk7XG4gICAgYXdhaXQgZXhwZWN0KHZlcmlmaWNhdGlvbkNoZWNrcykudG9Db250YWluVGV4dChcIkluY29tcGxldGVcIik7XG5cbiAgICBhd2FpdCBzZWNvbmRFdmlkZW5jZS5maWxsKFxuICAgICAgXCJBbGwgdXNlci1jb250cm9sbGVkIHF1ZXJ5IHZhbHVlcyB1c2UgdGhlIHBhcmFtZXRlcml6ZWQgaGVscGVyLlwiLFxuICAgICk7XG4gICAgYXdhaXQgcGFzc0J1dHRvbnMubnRoKDEpLmNsaWNrKCk7XG4gICAgYXdhaXQgZXhwZWN0LnBvbGwoKCkgPT4gdmVyaWZpY2F0aW9uUmVxdWVzdHMubGVuZ3RoKS50b0JlKDMpO1xuICAgIGV4cGVjdCh2ZXJpZmljYXRpb25SZXF1ZXN0c1syXSkudG9NYXRjaE9iamVjdCh7XG4gICAgICB0YXNrSWQ6IHZlcmlmaWNhdGlvblRhc2tJZCxcbiAgICAgIGNoZWNrSWQ6IFwicnVsZS12ZXJpZmljYXRpb24tMlwiLFxuICAgICAgcGFzc2VkOiB0cnVlLFxuICAgICAgZXZpZGVuY2U6IFwiQWxsIHVzZXItY29udHJvbGxlZCBxdWVyeSB2YWx1ZXMgdXNlIHRoZSBwYXJhbWV0ZXJpemVkIGhlbHBlci5cIixcbiAgICB9KTtcbiAgICBhd2FpdCBleHBlY3QodmVyaWZpY2F0aW9uUm93KS50b0NvbnRhaW5UZXh0KFwiY29tcGxldGVkXCIpO1xuICAgIGF3YWl0IHZlcmlmaWNhdGlvbkRldGFpbHMuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJEZXRhaWxzXCIgfSkuY2xpY2soKTtcbiAgICBhd2FpdCBleHBlY3QodmVyaWZpY2F0aW9uUGxhbikudG9Db250YWluVGV4dChcIlZlcmlmaWVkXCIpO1xuICAgIGF3YWl0IHZlcmlmaWNhdGlvbkRldGFpbHMuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJMb2dzXCIgfSkuY2xpY2soKTtcbiAgICBhd2FpdCBleHBlY3QodmVyaWZpY2F0aW9uQ2hlY2tzKS50b0NvbnRhaW5UZXh0KFwiVmVyaWZpZWRcIik7XG4gICAgYXdhaXQgZXhwZWN0KHZlcmlmaWNhdGlvbkRldGFpbHMpLnRvQ29udGFpblRleHQoXG4gICAgICBcIlRhc2sgY29tcGxldGVkIGFuZCB2ZXJpZmllZCBieSB0aGUgc2VydmVyLlwiLFxuICAgICk7XG5cbiAgICBhd2FpdCBwYWdlLnJlbG9hZCgpO1xuICAgIGNvbnN0IHJlbG9hZGVkVmVyaWZpY2F0aW9uUm93ID0gcGFnZS5nZXRCeVJvbGUoXCJidXR0b25cIiwge1xuICAgICAgbmFtZTogL3Rhc2sgVmVyaWZ5IHBhcmFtZXRlcml6ZWQgU1FMIHJlbWVkaWF0aW9uLyxcbiAgICB9KTtcbiAgICBhd2FpdCBleHBlY3QocmVsb2FkZWRWZXJpZmljYXRpb25Sb3cpLnRvQ29udGFpblRleHQoXCJjb21wbGV0ZWRcIik7XG4gICAgYXdhaXQgcmVsb2FkZWRWZXJpZmljYXRpb25Sb3cuY2xpY2soKTtcbiAgICBjb25zdCByZWxvYWRlZERldGFpbHMgPSBwYWdlLmxvY2F0b3IoXG4gICAgICBgI3Rhc2stZGV0YWlscy0ke3ZlcmlmaWNhdGlvblRhc2tJZH1gLFxuICAgICk7XG4gICAgYXdhaXQgcmVsb2FkZWREZXRhaWxzLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiTG9nc1wiIH0pLmNsaWNrKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcmVsb2FkZWREZXRhaWxzLmdldEJ5Um9sZShcInJlZ2lvblwiLCB7XG4gICAgICAgIG5hbWU6IFwiT3BlcmF0b3IgdmVyaWZpY2F0aW9uIGNoZWNrc1wiLFxuICAgICAgfSksXG4gICAgKS50b0NvbnRhaW5UZXh0KFwiVmVyaWZpZWRcIik7XG4gICAgYXdhaXQgZXhwZWN0KHJlbG9hZGVkRGV0YWlscykudG9Db250YWluVGV4dChcbiAgICAgIFwiVGFzayBjb21wbGV0ZWQgYW5kIHZlcmlmaWVkIGJ5IHRoZSBzZXJ2ZXIuXCIsXG4gICAgKTtcblxuICAgIGNvbnN0IHZpc2libGVUZXh0ID0gYXdhaXQgcGFnZS5sb2NhdG9yKFwiYm9keVwiKS5pbm5lclRleHQoKTtcbiAgICBleHBlY3QodmlzaWJsZVRleHQpLm5vdC50b0NvbnRhaW4ocmF3UHJvbXB0KTtcbiAgICBleHBlY3QodmlzaWJsZVRleHQpLm5vdC50b0NvbnRhaW4ocmF3RGlhZ25vc3RpYyk7XG4gICAgYXdhaXQgZXhwZWN0Tm9Ib3Jpem9udGFsT3ZlcmZsb3cocGFnZSk7XG4gIH0pO1xuXG4gIHRlc3QoXCJjb252ZXJnZXMgdHdvIGJyb3dzZXIgc2Vzc2lvbnMgYWNyb3NzIHJlbG9hZCwgcmVjb25uZWN0LCBzdGFsZSByZXN1bHRzLCBhbmQgQVBJIHJlc3RhcnRcIiwgYXN5bmMgKHtcbiAgICBicm93c2VyLFxuICAgIHBhZ2UsXG4gIH0pID0+IHtcbiAgICB0ZXN0LnNraXAoXG4gICAgICAhcHJvY2Vzcy5lbnYuREFTSEJPQVJEX0UyRV9DT05UUk9MX1VSTCxcbiAgICAgIFwiVGhlIG11bHRpLXByb2Nlc3MgY29udmVyZ2VuY2UgY2FtcGFpZ24gcnVucyBvbmx5IHVuZGVyIHRoZSByZWxlYXNlIHJ1bm5lci5cIixcbiAgICApO1xuICAgIHRlc3Quc2V0VGltZW91dCg5MF8wMDApO1xuXG4gICAgY29uc3Qgc2Vjb25kQ29udGV4dCA9IGF3YWl0IGJyb3dzZXIubmV3Q29udGV4dCgpO1xuICAgIGNvbnN0IHNlY29uZFBhZ2UgPSBhd2FpdCBzZWNvbmRDb250ZXh0Lm5ld1BhZ2UoKTtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgUHJvbWlzZS5hbGwoW3Byb2dyYW1tYXRpY1NpZ25JbihwYWdlKSwgcHJvZ3JhbW1hdGljU2lnbkluKHNlY29uZFBhZ2UpXSk7XG4gICAgICBhd2FpdCBQcm9taXNlLmFsbChbXG4gICAgICAgIHBhZ2UuZ290byhEQVNIQk9BUkRfUEFUSCksXG4gICAgICAgIHNlY29uZFBhZ2UuZ290byhgJHtEQVNIQk9BUkRfUEFUSH1haWApLFxuICAgICAgXSk7XG4gICAgICBhd2FpdCBleHBlY3REYXNoYm9hcmRSZWFkeShwYWdlKTtcbiAgICAgIGF3YWl0IGV4cGVjdChzZWNvbmRQYWdlLmxvY2F0b3IoXCJ0ZXh0YXJlYVwiKS5maXJzdCgpKS50b0JlVmlzaWJsZSgpO1xuXG4gICAgICAvLyBBIHJlc3BvbnNlIHRoYXQgYXJyaXZlcyBhZnRlciBhIG5ld2VyIHJlcXVlc3QgbXVzdCBub3QgcmVwbGFjZSB0aGVcbiAgICAgIC8vIHZpc2libGUgcmVhZHkgc3RhdGUgd2l0aCBzdGFsZSBkYXRhLiBLZWVwIHRoZSBkZWxheSBib3VuZGVkIHNvIGFcbiAgICAgIC8vIGh1bmcgcmVxdWVzdCBjYW5ub3QgbWFrZSB0aGlzIGNhbXBhaWduIHBhc3MgaW5kZWZpbml0ZWx5LlxuICAgICAgY29uc3QgY3VycmVudERhc2hib2FyZEZpeHR1cmUgPSB7XG4gICAgICAgIC4uLmRhc2hib2FyZEZpeHR1cmUsXG4gICAgICAgIC8vIFRoZSByZWxlYXNlIHJ1bm5lciBzdGFydHMgYWdhaW5zdCByZWFsIGRldmVsb3BtZW50IGRhdGEsIHdob3NlXG4gICAgICAgIC8vIHNlcnZlci1vd25lZCByZXZpc2lvbiBtYXkgYmUgbmV3ZXIgdGhhbiB0aGUgc3RhdGljIGZpeHR1cmUgYmVsb3cuXG4gICAgICAgIC8vIEtlZXAgdGhpcyBzeW50aGV0aWMgXCJjdXJyZW50XCIgcmVzcG9uc2UgYWhlYWQgb2YgdGhhdCB3YXRlcm1hcmsgc29cbiAgICAgICAgLy8gdGhlIHRlc3QgZXhlcmNpc2VzIHN0YWxlLXJlc3BvbnNlIHJlamVjdGlvbiByYXRoZXIgdGhhbiBmaXh0dXJlXG4gICAgICAgIC8vIHJlamVjdGlvbi5cbiAgICAgICAgZnJlc2huZXNzUmV2aXNpb246IFwiMjA5OS0wMS0wMVQwMDowMzowMC4wMDBaXCIsXG4gICAgICAgIHByb2plY3RTY29yZXM6IFt7IC4uLmRhc2hib2FyZEZpeHR1cmUucHJvamVjdFNjb3Jlc1swXSwgcHJvamVjdE5hbWU6IFwiQ29uY3VycmVudCBQcm9qZWN0XCIsIHNjb3JlOiA5NyB9XSxcbiAgICAgICAgYWN0aXZlVGFza0NvdW50OiAxLFxuICAgICAgICB0YXNrU3RhdHVzQnJlYWtkb3duOiB7IHBlbmRpbmc6IDAsIHJ1bm5pbmc6IDEgfSxcbiAgICAgIH07XG4gICAgICBsZXQgcmVmcmVzaENvdW50ID0gMDtcbiAgICAgIGxldCByZWxlYXNlU3RhbGVSZXNwb25zZSE6ICgpID0+IHZvaWQ7XG4gICAgICBjb25zdCBzdGFsZVJlc3BvbnNlUmVsZWFzZWQgPSBuZXcgUHJvbWlzZTx2b2lkPigocmVzb2x2ZSkgPT4ge1xuICAgICAgICByZWxlYXNlU3RhbGVSZXNwb25zZSA9IHJlc29sdmU7XG4gICAgICB9KTtcbiAgICAgIGF3YWl0IHBhZ2Uucm91dGUoXCIqKi9hcGkvZGFzaGJvYXJkXCIsIGFzeW5jIChyb3V0ZSkgPT4ge1xuICAgICAgICByZWZyZXNoQ291bnQgKz0gMTtcbiAgICAgICAgaWYgKHJlZnJlc2hDb3VudCA9PT0gMSkgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoanNvblJlc3BvbnNlKGN1cnJlbnREYXNoYm9hcmRGaXh0dXJlKSk7XG4gICAgICAgIGF3YWl0IHN0YWxlUmVzcG9uc2VSZWxlYXNlZDtcbiAgICAgICAgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoanNvblJlc3BvbnNlKGRhc2hib2FyZEZpeHR1cmUpKTtcbiAgICAgIH0pO1xuICAgICAgYXdhaXQgcGFnZS5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIlJlZnJlc2ggc3RhdHVzXCIgfSkuY2xpY2soKTtcbiAgICAgIGF3YWl0IGV4cGVjdChwYWdlLmdldEJ5VGV4dChcIkNvbmN1cnJlbnQgUHJvamVjdFwiLCB7IGV4YWN0OiB0cnVlIH0pKS50b0JlVmlzaWJsZSgpO1xuICAgICAgYXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlUZXh0KFwiOTdcIiwgeyBleGFjdDogdHJ1ZSB9KSkudG9CZVZpc2libGUoKTtcbiAgICAgIGNvbnN0IHN0YWxlUmVmcmVzaCA9IHBhZ2UuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJSZWZyZXNoIHN0YXR1c1wiIH0pLmNsaWNrKCk7XG4gICAgICBhd2FpdCBleHBlY3QucG9sbCgoKSA9PiByZWZyZXNoQ291bnQpLnRvQmUoMik7XG4gICAgICByZWxlYXNlU3RhbGVSZXNwb25zZSgpO1xuICAgICAgYXdhaXQgc3RhbGVSZWZyZXNoO1xuICAgICAgYXdhaXQgZXhwZWN0RGFzaGJvYXJkUmVhZHkocGFnZSk7XG4gICAgICBhd2FpdCBleHBlY3QocGFnZS5nZXRCeVRleHQoXCJDb25jdXJyZW50IFByb2plY3RcIiwgeyBleGFjdDogdHJ1ZSB9KSkudG9CZVZpc2libGUoKTtcbiAgICAgIGF3YWl0IGV4cGVjdChwYWdlLmdldEJ5VGV4dChcIjk3XCIsIHsgZXhhY3Q6IHRydWUgfSkpLnRvQmVWaXNpYmxlKCk7XG4gICAgICBhd2FpdCBleHBlY3QocGFnZS5nZXRCeVRleHQoXCIxXCIsIHsgZXhhY3Q6IHRydWUgfSkuZmlyc3QoKSkudG9CZVZpc2libGUoKTtcblxuICAgICAgLy8gU2ltdWxhdGUgYSBkcm9wcGVkIGNvbm5lY3Rpb24gaW4gdGhlIHNlY29uZCBicm93c2VyIGFuZCBhc3NlcnQgdGhlXG4gICAgICAvLyByZWNvdmVyeSBhY3Rpb24gcmVuZGVyZWQgYnkgdGhlIGRhc2hib2FyZCwgdGhlbiBsZXQgdGhlIG5leHQgcmVxdWVzdFxuICAgICAgLy8gcmVjb25uZWN0IG5vcm1hbGx5LlxuICAgICAgbGV0IHJlY29ubmVjdEF0dGVtcHQgPSAwO1xuICAgICAgYXdhaXQgc2Vjb25kUGFnZS5nb3RvKERBU0hCT0FSRF9QQVRIKTtcbiAgICAgIGF3YWl0IGV4cGVjdERhc2hib2FyZFJlYWR5KHNlY29uZFBhZ2UpO1xuICAgICAgYXdhaXQgc2Vjb25kUGFnZS5yb3V0ZShcIioqL2FwaS9kYXNoYm9hcmRcIiwgYXN5bmMgKHJvdXRlKSA9PiB7XG4gICAgICAgIHJlY29ubmVjdEF0dGVtcHQgKz0gMTtcbiAgICAgICAgLy8gdXNlR2V0RGFzaGJvYXJkIHJldHJpZXMgb25jZTsgaG9sZCBib3RoIGJvdW5kZWQgYXR0ZW1wdHMgc28gdGhlXG4gICAgICAgIC8vIHJlbmRlcmVkIGVycm9yIHN0YXRlIGlzIG9ic2VydmFibGUgYmVmb3JlIHRoZSBvcGVyYXRvciByZXRyaWVzLlxuICAgICAgICBpZiAocmVjb25uZWN0QXR0ZW1wdCA8PSAyKSB7XG4gICAgICAgICAgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoXG4gICAgICAgICAgICBqc29uUmVzcG9uc2UoeyBlcnJvcjogXCJjb250cm9sbGVkIHJlY29ubmVjdCBpbnRlcnJ1cHRpb25cIiB9LCA1MDMpLFxuICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHJvdXRlLmNvbnRpbnVlKCk7XG4gICAgICB9KTtcbiAgICAgIGF3YWl0IHNlY29uZFBhZ2UucmVsb2FkKCk7XG4gICAgICBhd2FpdCBleHBlY3QoXG4gICAgICAgIHNlY29uZFBhZ2UuZ2V0QnlSb2xlKFwiaGVhZGluZ1wiLCB7IG5hbWU6IFwiRmFpbGVkIHRvIGxvYWQgZGFzaGJvYXJkXCIgfSksXG4gICAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgICBhd2FpdCBleHBlY3QoXG4gICAgICAgIHNlY29uZFBhZ2UuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJSZXRyeSBDb25uZWN0aW9uXCIgfSksXG4gICAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgICBhd2FpdCBzZWNvbmRQYWdlLnVucm91dGUoXCIqKi9hcGkvZGFzaGJvYXJkXCIpO1xuICAgICAgYXdhaXQgc2Vjb25kUGFnZS5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIlJldHJ5IENvbm5lY3Rpb25cIiB9KS5jbGljaygpO1xuICAgICAgYXdhaXQgZXhwZWN0RGFzaGJvYXJkUmVhZHkoc2Vjb25kUGFnZSk7XG5cbiAgICAgIGF3YWl0IHJlc3RhcnRBcGlGb3JDYW1wYWlnbihwYWdlKTtcbiAgICAgIGF3YWl0IFByb21pc2UuYWxsKFtwYWdlLnJlbG9hZCgpLCBzZWNvbmRQYWdlLnJlbG9hZCgpXSk7XG4gICAgICBhd2FpdCBleHBlY3REYXNoYm9hcmRSZWFkeShwYWdlKTtcbiAgICAgIGF3YWl0IGV4cGVjdERhc2hib2FyZFJlYWR5KHNlY29uZFBhZ2UpO1xuXG4gICAgICBhd2FpdCBwYWdlLnJlbG9hZCgpO1xuICAgICAgYXdhaXQgZXhwZWN0RGFzaGJvYXJkUmVhZHkocGFnZSk7XG4gICAgICBhd2FpdCBleHBlY3QoXG4gICAgICAgIHBhZ2UuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJSZXRyeSBDb25uZWN0aW9uXCIgfSksXG4gICAgICApLnRvSGF2ZUNvdW50KDApO1xuICAgICAgYXdhaXQgZXhwZWN0Tm9Ib3Jpem9udGFsT3ZlcmZsb3cocGFnZSk7XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGF3YWl0IHNlY29uZENvbnRleHQuY2xvc2UoKTtcbiAgICB9XG4gIH0pO1xuXG4gIHRlc3QoXCJwcmV2aWV3cyBhbmQgZG93bmxvYWRzIHRoZSBjb21wbGV0ZWQgZXhlY3V0aW9uIGF1ZGl0IHdpdGhvdXQgZHVwbGljYXRpbmcgZWZmZWN0c1wiLCBhc3luYyAoe1xuICAgIHBhZ2UsXG4gIH0pID0+IHtcbiAgICBjb25zdCBhdWRpdFJlcXVlc3RzOiBzdHJpbmdbXSA9IFtdO1xuICAgIGNvbnN0IGF1ZGl0Qm9keSA9IHtcbiAgICAgIGZvcm1hdDogXCJlbmdpbmVlcmluZ29zLmV4ZWN1dGlvbi1hdWRpdC52MVwiLFxuICAgICAgZXhwb3J0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAyOjAwLjAwMFpcIixcbiAgICAgIGV4ZWN1dGlvbjoge1xuICAgICAgICBpZDogRVhFQ1VUSU9OX0lELFxuICAgICAgICBwcm9qZWN0SWQ6IFwiZTJlLXByb2plY3RcIixcbiAgICAgICAgc2Vzc2lvbklkOiBcImUyZS1hdWRpdC1zZXNzaW9uXCIsXG4gICAgICAgIG9wZXJhdGlvbklkOiBleGVjdXRpb25GaXh0dXJlLm9wZXJhdGlvbklkLFxuICAgICAgICBzdGF0dXM6IFwiY29tcGxldGVkXCIsXG4gICAgICAgIHRlcm1pbmFsU3RhdGU6IFwiY29tcGxldGVkXCIsXG4gICAgICAgIHJldmlzaW9uOiBcImUyZS1yZXZpc2lvbi00MlwiLFxuICAgICAgICBwcm9vZjogeyByZXF1aXJlZDogZmFsc2UsIHZlcmRpY3Q6IFwiUFJPVkVOXCIgfSxcbiAgICAgIH0sXG4gICAgICB0aW1lbGluZTogW10sXG4gICAgICB2YWxpZGF0aW9uczogW3sgc3RhdHVzOiBcInBhc3NlZFwiLCBwcm9maWxlOiBcInJlbGVhc2Utc2FmZVwiIH1dLFxuICAgICAgYWZmZWN0ZWRGaWxlczogW1wic3JjL2ZlYXR1cmUudHNcIl0sXG4gICAgICByZWRhY3Rpb246IHtcbiAgICAgICAgZXhjbHVkZWQ6IFtcbiAgICAgICAgICBcInByb3ZpZGVyIHNlY3JldHNcIixcbiAgICAgICAgICBcInJhdyBtb2RlbCBvdXRwdXRcIixcbiAgICAgICAgICBcInByaXZhdGUgcnVudGltZSBwYXRoc1wiLFxuICAgICAgICBdLFxuICAgICAgfSxcbiAgICB9O1xuICAgIGF3YWl0IGluc3RhbGxBcGlGaXh0dXJlcyhwYWdlLCB7XG4gICAgICBhdWRpdEV4cG9ydDoge1xuICAgICAgICBib2R5OiBhdWRpdEJvZHksXG4gICAgICAgIGZpbGVuYW1lOiBcInNlcnZlci1zdXBwbGllZC1hdWRpdC1uYW1lLmpzb25cIixcbiAgICAgICAgcmVxdWVzdHM6IGF1ZGl0UmVxdWVzdHMsXG4gICAgICAgIGZhaWxGaXJzdFByZXZpZXc6IHRydWUsXG4gICAgICB9LFxuICAgIH0pO1xuICAgIGF3YWl0IHByb2dyYW1tYXRpY1NpZ25JbihwYWdlKTtcbiAgICBhd2FpdCBwYWdlLmV2YWx1YXRlKCgpID0+IHtcbiAgICAgIGNvbnN0IGV4ZWN1dGlvbiA9IHtcbiAgICAgICAgaWQ6IFwiZTJlLWNvbnRyb2xsZWQtZXhlY3V0aW9uXCIsXG4gICAgICAgIHByb2plY3RJZDogXCJlMmUtcHJvamVjdFwiLFxuICAgICAgICBzZXNzaW9uSWQ6IFwiZTJlLWF1ZGl0LXNlc3Npb25cIixcbiAgICAgICAgbWVzc2FnZTogXCJDb21wbGV0ZWQgYXVkaXQgZXhlY3V0aW9uXCIsXG4gICAgICB9O1xuICAgICAgbG9jYWxTdG9yYWdlLnNldEl0ZW0oXG4gICAgICAgIFwiZW9zX2FpX2V4ZWN1dGlvbl9jdXJyZW50X2UyZS1wcm9qZWN0XCIsXG4gICAgICAgIFwiZTJlLWF1ZGl0LXNlc3Npb25cIixcbiAgICAgICk7XG4gICAgICBsb2NhbFN0b3JhZ2Uuc2V0SXRlbShcbiAgICAgICAgXCJlb3NfYWlfZXhlY3V0aW9uX2UyZS1wcm9qZWN0X2UyZS1hdWRpdC1zZXNzaW9uXCIsXG4gICAgICAgIEpTT04uc3RyaW5naWZ5KGV4ZWN1dGlvbiksXG4gICAgICApO1xuICAgIH0pO1xuICAgIGF3YWl0IHBhZ2UuZ290byhgJHtEQVNIQk9BUkRfUEFUSH1haWApO1xuXG4gICAgY29uc3QgcHJvb2YgPSBwYWdlLmdldEJ5TGFiZWwoXCJBZ2VudCBleGVjdXRpb24gcHJvb2ZcIik7XG4gICAgYXdhaXQgZXhwZWN0KHByb29mKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChwcm9vZikudG9Db250YWluVGV4dCgvY29tcGxldGVkL2kpO1xuICAgIGF3YWl0IGV4cGVjdChwcm9vZikudG9Db250YWluVGV4dChcIlJldmlzaW9uOiBlMmUtcmV2aXNpb24tNDJcIik7XG5cbiAgICBhd2FpdCBwcm9vZi5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIlByZXZpZXcgYXVkaXRcIiB9KS5jbGljaygpO1xuICAgIGNvbnN0IHByZXZpZXcgPSBwYWdlLmdldEJ5TGFiZWwoXCJSZWRhY3RlZCBhdWRpdCBwcmV2aWV3XCIpO1xuICAgIGF3YWl0IGV4cGVjdChwcmV2aWV3KS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChwcmV2aWV3KS50b0NvbnRhaW5UZXh0KFwiQXVkaXQgcHJldmlldyB0ZW1wb3JhcmlseSB1bmF2YWlsYWJsZVwiKTtcbiAgICBhd2FpdCBleHBlY3QocHJldmlldykudG9Db250YWluVGV4dChcInNhbWUgZXhlY3V0aW9uIGFuZCByZXZpc2lvblwiKTtcbiAgICBhd2FpdCBleHBlY3QocHJldmlldy5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIlJldHJ5IHByZXZpZXdcIiB9KSkudG9CZVZpc2libGUoKTtcbiAgICBleHBlY3QoYXVkaXRSZXF1ZXN0cykudG9IYXZlTGVuZ3RoKDEpO1xuXG4gICAgYXdhaXQgcHJldmlldy5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIlJldHJ5IHByZXZpZXdcIiB9KS5jbGljaygpO1xuICAgIGF3YWl0IGV4cGVjdChwcmV2aWV3KS50b0NvbnRhaW5UZXh0KFwicHJvdmlkZXIgc2VjcmV0c1wiKTtcbiAgICBhd2FpdCBleHBlY3QocHJldmlldykudG9Db250YWluVGV4dChcInJhdyBtb2RlbCBvdXRwdXRcIik7XG4gICAgYXdhaXQgZXhwZWN0KHByZXZpZXcpLnRvQ29udGFpblRleHQoXCJwcml2YXRlIHJ1bnRpbWUgcGF0aHNcIik7XG4gICAgYXdhaXQgZXhwZWN0KHByZXZpZXcpLnRvQ29udGFpblRleHQoRVhFQ1VUSU9OX0lEKTtcbiAgICBhd2FpdCBleHBlY3QocHJldmlldykudG9Db250YWluVGV4dChcImUyZS1vcGVyYXRpb25cIik7XG4gICAgYXdhaXQgZXhwZWN0KHByZXZpZXcpLnRvQ29udGFpblRleHQoXCJlMmUtcmV2aXNpb24tNDJcIik7XG4gICAgZXhwZWN0KGF1ZGl0UmVxdWVzdHMpLnRvSGF2ZUxlbmd0aCgyKTtcbiAgICBleHBlY3QobmV3IFVSTChhdWRpdFJlcXVlc3RzWzBdKS5wYXRobmFtZSkudG9CZShcbiAgICAgIGAvYXBpL2FpL2V4ZWN1dGlvbnMvJHtFWEVDVVRJT05fSUR9L2F1ZGl0LWV4cG9ydGAsXG4gICAgKTtcblxuICAgIGF3YWl0IHByZXZpZXcuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJDbG9zZSBhdWRpdCBwcmV2aWV3XCIgfSkuY2xpY2soKTtcbiAgICBhd2FpdCBleHBlY3QocHJldmlldykudG9CZUhpZGRlbigpO1xuXG4gICAgY29uc3QgZG93bmxvYWRQcm9taXNlID0gcGFnZS53YWl0Rm9yRXZlbnQoXCJkb3dubG9hZFwiKTtcbiAgICBhd2FpdCBwcm9vZi5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIkV4cG9ydCBhdWRpdFwiIH0pLmNsaWNrKCk7XG4gICAgY29uc3QgZG93bmxvYWQgPSBhd2FpdCBkb3dubG9hZFByb21pc2U7XG4gICAgZXhwZWN0KGRvd25sb2FkLnN1Z2dlc3RlZEZpbGVuYW1lKCkpLnRvQmUoXCJzZXJ2ZXItc3VwcGxpZWQtYXVkaXQtbmFtZS5qc29uXCIpO1xuICAgIGV4cGVjdChhdWRpdFJlcXVlc3RzKS50b0hhdmVMZW5ndGgoMyk7XG5cbiAgICBhd2FpdCBwYWdlLnJlbG9hZCgpO1xuICAgIGNvbnN0IHJlbG9hZGVkUHJvb2YgPSBwYWdlLmdldEJ5TGFiZWwoXCJBZ2VudCBleGVjdXRpb24gcHJvb2ZcIik7XG4gICAgYXdhaXQgZXhwZWN0KHJlbG9hZGVkUHJvb2YpLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KHJlbG9hZGVkUHJvb2YpLnRvQ29udGFpblRleHQoL2NvbXBsZXRlZC9pKTtcbiAgICBhd2FpdCBleHBlY3QocmVsb2FkZWRQcm9vZikudG9Db250YWluVGV4dChcIkV4ZWN1dGlvbiBlMmUtY29udHJvbGxlZC1leGVjdXRpb25cIik7XG4gICAgYXdhaXQgZXhwZWN0KHJlbG9hZGVkUHJvb2YpLnRvQ29udGFpblRleHQoXCJSZXZpc2lvbjogZTJlLXJldmlzaW9uLTQyXCIpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlMYWJlbChcIlJlZGFjdGVkIGF1ZGl0IHByZXZpZXdcIiksXG4gICAgKS50b0JlSGlkZGVuKCk7XG4gICAgZXhwZWN0KGF1ZGl0UmVxdWVzdHMpLnRvSGF2ZUxlbmd0aCgzKTtcbiAgfSk7XG5cbiAgdGVzdChcImtlZXBzIHRoZSBjYW5jZWxsZWQgZXhlY3V0aW9uIGF1ZGl0IGhhbmRvZmYgcmVkYWN0ZWQgYW5kIHRlcm1pbmFsXCIsIGFzeW5jICh7XG4gICAgcGFnZSxcbiAgfSkgPT4ge1xuICAgIGNvbnN0IGF1ZGl0UmVxdWVzdHM6IHN0cmluZ1tdID0gW107XG4gICAgY29uc3QgY2FuY2VsbGVkRXhlY3V0aW9uID0ge1xuICAgICAgLi4uZXhlY3V0aW9uRml4dHVyZSxcbiAgICAgIHN0YXR1czogXCJjYW5jZWxsZWRcIixcbiAgICAgIGZsaWdodFN0YXRlOiBcIkNBTkNFTExFRFwiLFxuICAgICAgY2hlY2twb2ludDoge1xuICAgICAgICBzdGFnZTogXCJjYW5jZWxsZWRcIixcbiAgICAgICAgZGV0YWlsOiBcIkV4ZWN1dGlvbiBjYW5jZWxsZWQgYmVmb3JlIGFueSBjaGFuZ2VzIHdlcmUgYXBwbGllZC5cIixcbiAgICAgIH0sXG4gICAgICB0ZXJtaW5hbFJlYXNvbjogXCJjYW5jZWxfcmVxdWVzdGVkXCIsXG4gICAgICBjb21wbGV0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAxOjMwLjAwMFpcIixcbiAgICAgIHVwZGF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAxOjMwLjAwMFpcIixcbiAgICB9O1xuICAgIGNvbnN0IGF1ZGl0Qm9keSA9IHtcbiAgICAgIGZvcm1hdDogXCJlbmdpbmVlcmluZ29zLmV4ZWN1dGlvbi1hdWRpdC52MVwiLFxuICAgICAgZXhwb3J0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAyOjAwLjAwMFpcIixcbiAgICAgIGV4ZWN1dGlvbjoge1xuICAgICAgICBpZDogRVhFQ1VUSU9OX0lELFxuICAgICAgICBwcm9qZWN0SWQ6IFwiZTJlLXByb2plY3RcIixcbiAgICAgICAgc2Vzc2lvbklkOiBcImUyZS1hdWRpdC1zZXNzaW9uXCIsXG4gICAgICAgIG9wZXJhdGlvbklkOiBleGVjdXRpb25GaXh0dXJlLm9wZXJhdGlvbklkLFxuICAgICAgICBzdGF0dXM6IFwiY2FuY2VsbGVkXCIsXG4gICAgICAgIHRlcm1pbmFsU3RhdGU6IFwiY2FuY2VsbGVkXCIsXG4gICAgICAgIHJldmlzaW9uOiBcImUyZS1yZXZpc2lvbi00MlwiLFxuICAgICAgICBwcm9vZjogeyByZXF1aXJlZDogZmFsc2UsIHZlcmRpY3Q6IFwiTk9UX1JFQ09SREVEXCIgfSxcbiAgICAgIH0sXG4gICAgICB0aW1lbGluZTogW1xuICAgICAgICB7IHR5cGU6IFwiY2FuY2VsbGVkXCIsIGRldGFpbDogXCJDYW5jZWxsYXRpb24gYWNjZXB0ZWQgYnkgdGhlIHNlcnZlci5cIiB9LFxuICAgICAgXSxcbiAgICAgIHZhbGlkYXRpb25zOiBbXSxcbiAgICAgIGFmZmVjdGVkRmlsZXM6IFtdLFxuICAgICAgcmVkYWN0aW9uOiB7XG4gICAgICAgIGV4Y2x1ZGVkOiBbXG4gICAgICAgICAgXCJwcm92aWRlciBzZWNyZXRzXCIsXG4gICAgICAgICAgXCJyYXcgbW9kZWwgb3V0cHV0XCIsXG4gICAgICAgICAgXCJwcml2YXRlIHJ1bnRpbWUgcGF0aHNcIixcbiAgICAgICAgXSxcbiAgICAgIH0sXG4gICAgfTtcbiAgICBhd2FpdCBpbnN0YWxsQXBpRml4dHVyZXMocGFnZSwge1xuICAgICAgYXVkaXRFeHBvcnQ6IHtcbiAgICAgICAgYm9keTogYXVkaXRCb2R5LFxuICAgICAgICBmaWxlbmFtZTogXCJjYW5jZWxsZWQtc2VydmVyLWF1ZGl0Lmpzb25cIixcbiAgICAgICAgcmVxdWVzdHM6IGF1ZGl0UmVxdWVzdHMsXG4gICAgICAgIGV4ZWN1dGlvbjogY2FuY2VsbGVkRXhlY3V0aW9uLFxuICAgICAgICBtZXNzYWdlT3V0Y29tZTogXCJDQU5DRUxMRURcIixcbiAgICAgICAgZmFpbEZpcnN0UHJldmlldzogdHJ1ZSxcbiAgICAgIH0sXG4gICAgfSk7XG4gICAgYXdhaXQgcHJvZ3JhbW1hdGljU2lnbkluKHBhZ2UpO1xuICAgIGF3YWl0IHBhZ2UuZXZhbHVhdGUoKCkgPT4ge1xuICAgICAgY29uc3QgZXhlY3V0aW9uID0ge1xuICAgICAgICBpZDogXCJlMmUtY29udHJvbGxlZC1leGVjdXRpb25cIixcbiAgICAgICAgcHJvamVjdElkOiBcImUyZS1wcm9qZWN0XCIsXG4gICAgICAgIHNlc3Npb25JZDogXCJlMmUtYXVkaXQtc2Vzc2lvblwiLFxuICAgICAgICBtZXNzYWdlOiBcIkNhbmNlbGxlZCBhdWRpdCBleGVjdXRpb25cIixcbiAgICAgIH07XG4gICAgICBsb2NhbFN0b3JhZ2Uuc2V0SXRlbShcbiAgICAgICAgXCJlb3NfYWlfZXhlY3V0aW9uX2N1cnJlbnRfZTJlLXByb2plY3RcIixcbiAgICAgICAgXCJlMmUtYXVkaXQtc2Vzc2lvblwiLFxuICAgICAgKTtcbiAgICAgIGxvY2FsU3RvcmFnZS5zZXRJdGVtKFxuICAgICAgICBcImVvc19haV9leGVjdXRpb25fZTJlLXByb2plY3RfZTJlLWF1ZGl0LXNlc3Npb25cIixcbiAgICAgICAgSlNPTi5zdHJpbmdpZnkoZXhlY3V0aW9uKSxcbiAgICAgICk7XG4gICAgfSk7XG4gICAgYXdhaXQgcGFnZS5nb3RvKGAke0RBU0hCT0FSRF9QQVRIfWFpYCk7XG5cbiAgICBjb25zdCBwcm9vZiA9IHBhZ2UuZ2V0QnlMYWJlbChcIkFnZW50IGV4ZWN1dGlvbiBwcm9vZlwiKTtcbiAgICBhd2FpdCBleHBlY3QocHJvb2YpLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KHByb29mKS50b0NvbnRhaW5UZXh0KFwiQ2FuY2VsbGVkXCIpO1xuICAgIGF3YWl0IGV4cGVjdChwcm9vZikudG9Db250YWluVGV4dChcIkV4ZWN1dGlvbiBlMmUtY29udHJvbGxlZC1leGVjdXRpb25cIik7XG4gICAgYXdhaXQgZXhwZWN0KHByb29mKS50b0NvbnRhaW5UZXh0KFwiUmV2aXNpb246IGUyZS1yZXZpc2lvbi00MlwiKTtcbiAgICBhd2FpdCBleHBlY3QocHJvb2YpLnRvQ29udGFpblRleHQoXCJUZXJtaW5hbCByZWFzb246IGNhbmNlbF9yZXF1ZXN0ZWRcIik7XG4gICAgYXdhaXQgZXhwZWN0KHByb29mLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiQ2FuY2VsXCIgfSkpLnRvSGF2ZUNvdW50KDApO1xuICAgIGF3YWl0IGV4cGVjdChwcm9vZi5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIlJlc3VtZVwiIH0pKS50b0hhdmVDb3VudCgwKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwcm9vZi5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIkFwcHJvdmUgJiBhcHBseVwiIH0pLFxuICAgICkudG9IYXZlQ291bnQoMCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcHJvb2YuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogL2NvbW1pdCB2ZXJpZmllZCBjaGFuZ2VzL2kgfSksXG4gICAgKS50b0hhdmVDb3VudCgwKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwcm9vZi5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiAvcHVzaCBjb21taXR0ZWQgY2hhbmdlcy9pIH0pLFxuICAgICkudG9IYXZlQ291bnQoMCk7XG5cbiAgICBhd2FpdCBwcm9vZi5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIlByZXZpZXcgYXVkaXRcIiB9KS5jbGljaygpO1xuICAgIGNvbnN0IHByZXZpZXcgPSBwYWdlLmdldEJ5TGFiZWwoXCJSZWRhY3RlZCBhdWRpdCBwcmV2aWV3XCIpO1xuICAgIGF3YWl0IGV4cGVjdChwcmV2aWV3KS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChwcmV2aWV3KS50b0NvbnRhaW5UZXh0KFwiQXVkaXQgcHJldmlldyB0ZW1wb3JhcmlseSB1bmF2YWlsYWJsZVwiKTtcbiAgICBhd2FpdCBleHBlY3QocHJldmlldykudG9Db250YWluVGV4dChcInNhbWUgZXhlY3V0aW9uIGFuZCByZXZpc2lvblwiKTtcbiAgICBhd2FpdCBleHBlY3QocHJldmlldy5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIlJldHJ5IHByZXZpZXdcIiB9KSkudG9CZVZpc2libGUoKTtcbiAgICBleHBlY3QoYXVkaXRSZXF1ZXN0cykudG9IYXZlTGVuZ3RoKDEpO1xuXG4gICAgYXdhaXQgcHJldmlldy5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIlJldHJ5IHByZXZpZXdcIiB9KS5jbGljaygpO1xuICAgIGF3YWl0IGV4cGVjdChwcmV2aWV3KS50b0NvbnRhaW5UZXh0KFwiY2FuY2VsbGVkXCIpO1xuICAgIGF3YWl0IGV4cGVjdChwcmV2aWV3KS50b0NvbnRhaW5UZXh0KEVYRUNVVElPTl9JRCk7XG4gICAgYXdhaXQgZXhwZWN0KHByZXZpZXcpLnRvQ29udGFpblRleHQoXCJlMmUtb3BlcmF0aW9uXCIpO1xuICAgIGF3YWl0IGV4cGVjdChwcmV2aWV3KS50b0NvbnRhaW5UZXh0KFwiZTJlLXJldmlzaW9uLTQyXCIpO1xuICAgIGF3YWl0IGV4cGVjdChwcmV2aWV3KS50b0NvbnRhaW5UZXh0KFwicHJvdmlkZXIgc2VjcmV0c1wiKTtcbiAgICBhd2FpdCBleHBlY3QocHJldmlldykudG9Db250YWluVGV4dChcInJhdyBtb2RlbCBvdXRwdXRcIik7XG4gICAgYXdhaXQgZXhwZWN0KHByZXZpZXcpLnRvQ29udGFpblRleHQoXCJwcml2YXRlIHJ1bnRpbWUgcGF0aHNcIik7XG4gICAgYXdhaXQgZXhwZWN0KHByb29mKS50b0NvbnRhaW5UZXh0KFwiQ2FuY2VsbGVkXCIpO1xuICAgIGF3YWl0IGV4cGVjdChwcm9vZikudG9Db250YWluVGV4dChcIlJldmlzaW9uOiBlMmUtcmV2aXNpb24tNDJcIik7XG4gICAgYXdhaXQgZXhwZWN0KHByb29mKS50b0NvbnRhaW5UZXh0KFwiVGVybWluYWwgcmVhc29uOiBjYW5jZWxfcmVxdWVzdGVkXCIpO1xuICAgIGV4cGVjdChhdWRpdFJlcXVlc3RzKS50b0hhdmVMZW5ndGgoMik7XG5cbiAgICBhd2FpdCBwcmV2aWV3LmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiQ2xvc2UgYXVkaXQgcHJldmlld1wiIH0pLmNsaWNrKCk7XG4gICAgY29uc3QgZG93bmxvYWRQcm9taXNlID0gcGFnZS53YWl0Rm9yRXZlbnQoXCJkb3dubG9hZFwiKTtcbiAgICBhd2FpdCBwcm9vZi5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIkV4cG9ydCBhdWRpdFwiIH0pLmNsaWNrKCk7XG4gICAgY29uc3QgZG93bmxvYWQgPSBhd2FpdCBkb3dubG9hZFByb21pc2U7XG4gICAgZXhwZWN0KGRvd25sb2FkLnN1Z2dlc3RlZEZpbGVuYW1lKCkpLnRvQmUoXCJjYW5jZWxsZWQtc2VydmVyLWF1ZGl0Lmpzb25cIik7XG4gICAgZXhwZWN0KGF1ZGl0UmVxdWVzdHMpLnRvSGF2ZUxlbmd0aCgzKTtcblxuICAgIGF3YWl0IHBhZ2UucmVsb2FkKCk7XG4gICAgY29uc3QgcmVsb2FkZWRQcm9vZiA9IHBhZ2UuZ2V0QnlMYWJlbChcIkFnZW50IGV4ZWN1dGlvbiBwcm9vZlwiKTtcbiAgICBhd2FpdCBleHBlY3QocmVsb2FkZWRQcm9vZikudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QocmVsb2FkZWRQcm9vZikudG9Db250YWluVGV4dChcIkNhbmNlbGxlZFwiKTtcbiAgICBhd2FpdCBleHBlY3QocmVsb2FkZWRQcm9vZikudG9Db250YWluVGV4dChcIlJldmlzaW9uOiBlMmUtcmV2aXNpb24tNDJcIik7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlMYWJlbChcIlJlZGFjdGVkIGF1ZGl0IHByZXZpZXdcIikpLnRvQmVIaWRkZW4oKTtcbiAgICBleHBlY3QoYXVkaXRSZXF1ZXN0cykudG9IYXZlTGVuZ3RoKDMpO1xuICB9KTtcblxuICB0ZXN0KFwidXBsb2FkcyBhbiBhcmNoaXZlIGFuZCByZW5kZXJzIGEgbGl2ZSB0YXNrIHVwZGF0ZVwiLCBhc3luYyAoe1xuICAgIHBhZ2UsXG4gIH0pID0+IHtcbiAgICBjb25zdCB0YXNrSWQgPSBcImUyZS1saXZlLXRhc2tcIjtcbiAgICBjb25zdCBsaXZlTG9nID0ge1xuICAgICAgaWQ6IFwiZTJlLWxpdmUtbG9nXCIsXG4gICAgICB0YXNrSWQsXG4gICAgICBsZXZlbDogXCJpbmZvXCIsXG4gICAgICBtZXNzYWdlOiBcIkxpdmUgdXBkYXRlIHJlY2VpdmVkIGZyb20gdGhlIHNlcnZlclwiLFxuICAgICAgdGltZXN0YW1wOiBcIjIwMjYtMDEtMDFUMDA6MDA6MDIuMDAwWlwiLFxuICAgIH07XG4gICAgYXdhaXQgaW5zdGFsbEFwaUZpeHR1cmVzKHBhZ2UsIHtcbiAgICAgIGFyY2hpdmVVcGxvYWQ6IHtcbiAgICAgICAgdXBsb2FkSWQ6IFwiZTJlLXVwbG9hZFwiLFxuICAgICAgICBvcmlnaW5hbE5hbWU6IFwiZGFzaGJvYXJkLWpvdXJuZXkuemlwXCIsXG4gICAgICB9LFxuICAgICAgbGl2ZVRhc2s6IHtcbiAgICAgICAgaWQ6IHRhc2tJZCxcbiAgICAgICAgdGl0bGU6IFwiVmVyaWZ5IGxpdmUgZGFzaGJvYXJkIHVwZGF0ZXNcIixcbiAgICAgICAgcHJvamVjdElkOiBcImUyZS1wcm9qZWN0XCIsXG4gICAgICAgIGxvZzogbGl2ZUxvZyxcbiAgICAgIH0sXG4gICAgfSk7XG4gICAgYXdhaXQgcHJvZ3JhbW1hdGljU2lnbkluKHBhZ2UpO1xuXG4gICAgLy8gVGhpcyBpcyBhIHZhbGlkLCBlbXB0eSBaSVAgYXJjaGl2ZS4gS2VlcGluZyBpdCBpbmxpbmUgbWFrZXMgdGhlIGJyb3dzZXJcbiAgICAvLyB0ZXN0IHNlbGYtY29udGFpbmVkIHdoaWxlIHN0aWxsIGV4ZXJjaXNpbmcgRm9ybURhdGEgYW5kIG11bHRpcGFydCBieXRlcy5cbiAgICBjb25zdCB1cGxvYWRSZXN1bHQgPSBhd2FpdCBwYWdlLmV2YWx1YXRlKGFzeW5jIChhcGlCYXNlVXJsKSA9PiB7XG4gICAgICBjb25zdCBieXRlcyA9IFVpbnQ4QXJyYXkuZnJvbShcbiAgICAgICAgYXRvYihcIlVFc0ZCZ0FBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQT09XCIpLFxuICAgICAgICAoY2hhcmFjdGVyKSA9PiBjaGFyYWN0ZXIuY2hhckNvZGVBdCgwKSxcbiAgICAgICk7XG4gICAgICBjb25zdCBib2R5ID0gbmV3IEZvcm1EYXRhKCk7XG4gICAgICBib2R5LmFwcGVuZChcbiAgICAgICAgXCJhcmNoaXZlXCIsXG4gICAgICAgIG5ldyBCbG9iKFtieXRlc10sIHsgdHlwZTogXCJhcHBsaWNhdGlvbi96aXBcIiB9KSxcbiAgICAgICAgXCJkYXNoYm9hcmQtam91cm5leS56aXBcIixcbiAgICAgICk7XG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGZldGNoKFxuICAgICAgICBuZXcgVVJMKFwiL2FwaS91cGxvYWQvYXJjaGl2ZVwiLCBhcGlCYXNlVXJsKS50b1N0cmluZygpLFxuICAgICAgICB7IG1ldGhvZDogXCJQT1NUXCIsIGNyZWRlbnRpYWxzOiBcImluY2x1ZGVcIiwgYm9keSB9LFxuICAgICAgKTtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIHN0YXR1czogcmVzcG9uc2Uuc3RhdHVzLFxuICAgICAgICBib2R5OiAoYXdhaXQgcmVzcG9uc2UuanNvbigpKSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPixcbiAgICAgIH07XG4gICAgfSwgcHJvY2Vzcy5lbnYuREFTSEJPQVJEX0UyRV9BUElfQkFTRV9VUkwgPz8gcGFnZS51cmwoKSk7XG4gICAgZXhwZWN0KHVwbG9hZFJlc3VsdC5zdGF0dXMpLnRvQmUoMjAxKTtcbiAgICBleHBlY3QodXBsb2FkUmVzdWx0LmJvZHkpLnRvRXF1YWwoe1xuICAgICAgdXBsb2FkSWQ6IFwiZTJlLXVwbG9hZFwiLFxuICAgICAgb3JpZ2luYWxOYW1lOiBcImRhc2hib2FyZC1qb3VybmV5LnppcFwiLFxuICAgIH0pO1xuXG4gICAgYXdhaXQgb3Blbk5hdmlnYXRpb24ocGFnZSwgXCJUYXNrc1wiLCBgJHtEQVNIQk9BUkRfUEFUSH10YXNrc2ApO1xuICAgIGNvbnN0IHRhc2tSb3cgPSBwYWdlLmdldEJ5TGFiZWwoXG4gICAgICBcIkV4cGFuZCB0YXNrIFZlcmlmeSBsaXZlIGRhc2hib2FyZCB1cGRhdGVzXCIsXG4gICAgKTtcbiAgICBhd2FpdCBleHBlY3QodGFza1JvdykudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCB0YXNrUm93LmNsaWNrKCk7XG4gICAgYXdhaXQgcGFnZS5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIkxvZ3NcIiB9KS5jbGljaygpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlLmdldEJ5Um9sZShcInJlZ2lvblwiLCB7IG5hbWU6IFwiQWN0aXZpdHlcIiB9KSkudG9Db250YWluVGV4dChcbiAgICAgIFwiTGl2ZSB1cGRhdGUgcmVjZWl2ZWQgZnJvbSB0aGUgc2VydmVyXCIsXG4gICAgKTtcbiAgfSk7XG5cbiAgdGVzdChcInJlY292ZXJzIGEgbGl2ZSB0YXNrIHVwZGF0ZSBhZnRlciBhIHRlbXBvcmFyeSBzdHJlYW0gZmFpbHVyZVwiLCBhc3luYyAoe1xuICAgIHBhZ2UsXG4gIH0pID0+IHtcbiAgICBjb25zdCB0YXNrSWQgPSBcImUyZS1yZWNvbm5lY3RpbmctbGl2ZS10YXNrXCI7XG4gICAgY29uc3QgbGl2ZUxvZyA9IHtcbiAgICAgIGlkOiBcImUyZS1yZWNvbm5lY3RpbmctbGl2ZS1sb2dcIixcbiAgICAgIHRhc2tJZCxcbiAgICAgIGxldmVsOiBcImluZm9cIixcbiAgICAgIG1lc3NhZ2U6IFwiQXV0aG9yaXRhdGl2ZSB1cGRhdGUgcmVjZWl2ZWQgYWZ0ZXIgcmVjb25uZWN0XCIsXG4gICAgICB0aW1lc3RhbXA6IFwiMjAyNi0wMS0wMVQwMDowMDowMi4wMDBaXCIsXG4gICAgICBtZXRhZGF0YToge1xuICAgICAgICBvcGVyYXRpb25JZDogXCJlMmUtcmVjb25uZWN0aW5nLW9wZXJhdGlvblwiLFxuICAgICAgICBjaGVja3BvaW50VmVyc2lvbjogMyxcbiAgICAgIH0sXG4gICAgfTtcbiAgICBjb25zdCBzdHJlYW1SZXF1ZXN0czogc3RyaW5nW10gPSBbXTtcbiAgICBhd2FpdCBpbnN0YWxsQXBpRml4dHVyZXMocGFnZSwge1xuICAgICAgbGl2ZVRhc2s6IHtcbiAgICAgICAgaWQ6IHRhc2tJZCxcbiAgICAgICAgdGl0bGU6IFwiUmVjb3ZlciBsaXZlIHRhc2sgdXBkYXRlc1wiLFxuICAgICAgICBwcm9qZWN0SWQ6IFwiZTJlLXByb2plY3RcIixcbiAgICAgICAgbG9nOiBsaXZlTG9nLFxuICAgICAgICBzdHJlYW1SZXF1ZXN0cyxcbiAgICAgICAgZmFpbEZpcnN0U3RyZWFtOiB0cnVlLFxuICAgICAgfSxcbiAgICB9KTtcbiAgICBhd2FpdCBwcm9ncmFtbWF0aWNTaWduSW4ocGFnZSk7XG5cbiAgICBhd2FpdCBvcGVuTmF2aWdhdGlvbihwYWdlLCBcIlRhc2tzXCIsIGAke0RBU0hCT0FSRF9QQVRIfXRhc2tzYCk7XG4gICAgY29uc3QgdGFza1JvdyA9IHBhZ2UuZ2V0QnlMYWJlbChcIkV4cGFuZCB0YXNrIFJlY292ZXIgbGl2ZSB0YXNrIHVwZGF0ZXNcIik7XG4gICAgYXdhaXQgZXhwZWN0KHRhc2tSb3cpLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgdGFza1Jvdy5jbGljaygpO1xuICAgIGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJMb2dzXCIgfSkuY2xpY2soKTtcblxuICAgIGNvbnN0IGFjdGl2aXR5ID0gcGFnZS5nZXRCeVJvbGUoXCJyZWdpb25cIiwgeyBuYW1lOiBcIkFjdGl2aXR5XCIgfSk7XG4gICAgYXdhaXQgZXhwZWN0KGFjdGl2aXR5KS50b0NvbnRhaW5UZXh0KGxpdmVMb2cubWVzc2FnZSk7XG4gICAgYXdhaXQgZXhwZWN0XG4gICAgICAucG9sbCgoKSA9PiBzdHJlYW1SZXF1ZXN0cy5sZW5ndGgsIHtcbiAgICAgICAgbWVzc2FnZTogXCJ0aGUgdGFzayBsb2cgc3RyZWFtIHNob3VsZCByZWNvbm5lY3QgZXhhY3RseSBvbmNlXCIsXG4gICAgICB9KVxuICAgICAgLnRvQmUoMik7XG4gICAgZXhwZWN0KHN0cmVhbVJlcXVlc3RzKS50b0hhdmVMZW5ndGgoMik7XG4gICAgZXhwZWN0KHN0cmVhbVJlcXVlc3RzWzBdKS50b0JlKHN0cmVhbVJlcXVlc3RzWzFdKTtcbiAgICBleHBlY3QobmV3IFVSTChzdHJlYW1SZXF1ZXN0c1sxXSkucGF0aG5hbWUpLnRvQmUoXG4gICAgICBgL2FwaS90YXNrcy8ke3Rhc2tJZH0vbG9ncy9zdHJlYW1gLFxuICAgICk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgYWN0aXZpdHkubG9jYXRvcihcInN1bW1hcnlcIikuZmlsdGVyKHsgaGFzVGV4dDogbGl2ZUxvZy5tZXNzYWdlIH0pLFxuICAgICkudG9IYXZlQ291bnQoMSk7XG4gIH0pO1xuXG4gIHRlc3QoXCJzaG93cyBhbiBhY3Rpb25hYmxlIHRlcm1pbmFsIHN0YXRlIHdoZW4gbGl2ZSB0YXNrIHJlY29ubmVjdHMgYXJlIGV4aGF1c3RlZFwiLCBhc3luYyAoe1xuICAgIHBhZ2UsXG4gIH0pID0+IHtcbiAgICBjb25zdCB0YXNrSWQgPSBcImUyZS1leGhhdXN0ZWQtbGl2ZS10YXNrXCI7XG4gICAgY29uc3Qgb3BlcmF0aW9uSWQgPSBcImUyZS1leGhhdXN0ZWQtb3BlcmF0aW9uXCI7XG4gICAgY29uc3QgbGl2ZUxvZyA9IHtcbiAgICAgIGlkOiBcImUyZS1leGhhdXN0ZWQtbGl2ZS1sb2dcIixcbiAgICAgIHRhc2tJZCxcbiAgICAgIGxldmVsOiBcImluZm9cIixcbiAgICAgIG1lc3NhZ2U6IFwiVGhlIG9ubHkgY29uZmlybWVkIHRhc2sgdXBkYXRlXCIsXG4gICAgICB0aW1lc3RhbXA6IFwiMjAyNi0wMS0wMVQwMDowMDowMi4wMDBaXCIsXG4gICAgICBtZXRhZGF0YTogeyBvcGVyYXRpb25JZCB9LFxuICAgIH07XG4gICAgY29uc3Qgc3RyZWFtUmVxdWVzdHM6IHN0cmluZ1tdID0gW107XG4gICAgY29uc3Qgbm9uU3RyZWFtUmVxdWVzdHM6IHN0cmluZ1tdID0gW107XG4gICAgcGFnZS5vbihcInJlcXVlc3RcIiwgKHJlcXVlc3QpID0+IHtcbiAgICAgIGlmICghcmVxdWVzdC51cmwoKS5pbmNsdWRlcyhcIi9hcGkvdGFza3MvXCIpKSByZXR1cm47XG4gICAgICBpZiAoIXJlcXVlc3QudXJsKCkuaW5jbHVkZXMoXCIvbG9ncy9zdHJlYW1cIikpIG5vblN0cmVhbVJlcXVlc3RzLnB1c2gocmVxdWVzdC5tZXRob2QoKSk7XG4gICAgfSk7XG4gICAgYXdhaXQgaW5zdGFsbEFwaUZpeHR1cmVzKHBhZ2UsIHtcbiAgICAgIGxpdmVUYXNrOiB7XG4gICAgICAgIGlkOiB0YXNrSWQsXG4gICAgICAgIHRpdGxlOiBcIlJlY292ZXIgZXhoYXVzdGVkIGxpdmUgdGFzayB1cGRhdGVzXCIsXG4gICAgICAgIHByb2plY3RJZDogXCJlMmUtcHJvamVjdFwiLFxuICAgICAgICBsb2c6IGxpdmVMb2csXG4gICAgICAgIGluaXRpYWxMb2dzOiBbbGl2ZUxvZ10sXG4gICAgICAgIHN0cmVhbVJlcXVlc3RzLFxuICAgICAgICBmYWlsU3RyZWFtQXR0ZW1wdHM6IDYsXG4gICAgICB9LFxuICAgIH0pO1xuICAgIGF3YWl0IHByb2dyYW1tYXRpY1NpZ25JbihwYWdlKTtcblxuICAgIGF3YWl0IG9wZW5OYXZpZ2F0aW9uKHBhZ2UsIFwiVGFza3NcIiwgYCR7REFTSEJPQVJEX1BBVEh9dGFza3NgKTtcbiAgICBhd2FpdCBwYWdlLmdldEJ5TGFiZWwoXCJFeHBhbmQgdGFzayBSZWNvdmVyIGV4aGF1c3RlZCBsaXZlIHRhc2sgdXBkYXRlc1wiKS5jbGljaygpO1xuICAgIGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJMb2dzXCIgfSkuY2xpY2soKTtcblxuICAgIGNvbnN0IGFjdGl2aXR5ID0gcGFnZS5nZXRCeVJvbGUoXCJyZWdpb25cIiwgeyBuYW1lOiBcIkFjdGl2aXR5XCIgfSk7XG4gICAgYXdhaXQgZXhwZWN0KGFjdGl2aXR5KS50b0NvbnRhaW5UZXh0KGxpdmVMb2cubWVzc2FnZSk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlUZXh0KFwiVGVtcG9yYXJ5IHN0cmVhbSBmYWlsdXJlLlwiLCB7IGV4YWN0OiBmYWxzZSB9KSkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3RcbiAgICAgIC5wb2xsKCgpID0+IHN0cmVhbVJlcXVlc3RzLmxlbmd0aCwge1xuICAgICAgICBtZXNzYWdlOiBcInRoZSB0YXNrIGxvZyBzdHJlYW0gc2hvdWxkIGV4aGF1c3QgaXRzIGJvdW5kZWQgcmVjb25uZWN0IGJ1ZGdldFwiLFxuICAgICAgICB0aW1lb3V0OiAzNV8wMDAsXG4gICAgICB9KVxuICAgICAgLnRvQmUoNik7XG4gICAgY29uc3QgZXhoYXVzdGVkID0gcGFnZS5nZXRCeVJvbGUoXCJhbGVydFwiKTtcbiAgICBhd2FpdCBleHBlY3QoZXhoYXVzdGVkKS50b0NvbnRhaW5UZXh0KFwiTGl2ZSB0YXNrIHVwZGF0ZXMgY291bGQgbm90IHJlY29ubmVjdFwiKTtcbiAgICBhd2FpdCBleHBlY3QoZXhoYXVzdGVkKS50b0NvbnRhaW5UZXh0KFwiUmVjb25uZWN0IGF0dGVtcHRzIGFyZSBleGhhdXN0ZWRcIik7XG4gICAgYXdhaXQgZXhwZWN0KGV4aGF1c3RlZCkudG9Db250YWluVGV4dChvcGVyYXRpb25JZCk7XG4gICAgYXdhaXQgZXhwZWN0KGV4aGF1c3RlZCkudG9Db250YWluVGV4dChcInRhc2sgaGFzIG5vdCBiZWVuIG1hcmtlZCBmYWlsZWRcIik7XG4gICAgYXdhaXQgZXhwZWN0KGV4aGF1c3RlZC5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIlJldHJ5IGxpdmUgdXBkYXRlc1wiIH0pKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChleGhhdXN0ZWQuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJSZWZyZXNoIHRhc2sgbG9nc1wiIH0pKS50b0JlVmlzaWJsZSgpO1xuXG4gICAgYXdhaXQgZXhoYXVzdGVkLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiUmV0cnkgbGl2ZSB1cGRhdGVzXCIgfSkuY2xpY2soKTtcbiAgICBhd2FpdCBleHBlY3QoYWN0aXZpdHkpLnRvQ29udGFpblRleHQoXCJUaGUgb25seSBjb25maXJtZWQgdGFzayB1cGRhdGVcIik7XG4gICAgYXdhaXQgZXhwZWN0LnBvbGwoKCkgPT4gc3RyZWFtUmVxdWVzdHMubGVuZ3RoKS50b0JlKDcpO1xuICAgIGV4cGVjdChuZXcgU2V0KHN0cmVhbVJlcXVlc3RzKS5zaXplKS50b0JlKDEpO1xuICAgIGV4cGVjdChub25TdHJlYW1SZXF1ZXN0cykubm90LnRvQ29udGFpbihcIlBPU1RcIik7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgYWN0aXZpdHkubG9jYXRvcihcInN1bW1hcnlcIikuZmlsdGVyKHsgaGFzVGV4dDogbGl2ZUxvZy5tZXNzYWdlIH0pLFxuICAgICkudG9IYXZlQ291bnQoMSk7XG4gIH0pO1xuXG4gIHRlc3QoXCJwYWdlcyBhbmQgcmVsb2FkcyB0aGUgZmlsdGVyZWQgZXZlbnQgc3RyZWFtIHdpdGhvdXQgbG9zaW5nIGl0cyB3aW5kb3dcIiwgYXN5bmMgKHtcbiAgICBwYWdlLFxuICB9KSA9PiB7XG4gICAgY29uc3QgZXZlbnRzID0gQXJyYXkuZnJvbSh7IGxlbmd0aDogNTEgfSwgKF8sIGluZGV4KSA9PiAoe1xuICAgICAgaWQ6IGBlMmUtZXZlbnQtJHtpbmRleH1gLFxuICAgICAgcHJvamVjdElkOiBcImUyZS1wcm9qZWN0XCIsXG4gICAgICB0eXBlOiBcIkF1ZGl0RXZlbnRcIixcbiAgICAgIHNldmVyaXR5OiBpbmRleCA8IDIgPyBcInN1Y2Nlc3NcIiA6IFwiaW5mb1wiLFxuICAgICAgY29ycmVsYXRpb25JZDogaW5kZXggPCAyID8gXCJyZWxlYXNlLTQyXCIgOiBudWxsLFxuICAgICAgbWVzc2FnZTpcbiAgICAgICAgaW5kZXggPCAyID8gYEZpbHRlcmVkIHJlbGVhc2UgZXZlbnQgJHtpbmRleH1gIDogYE9sZGVyIGV2ZW50ICR7aW5kZXh9YCxcbiAgICAgIHRpbWVzdGFtcDogbmV3IERhdGUoRGF0ZS5VVEMoMjAyNiwgMCwgMSwgMCwgMCwgNTEgLSBpbmRleCkpLnRvSVNPU3RyaW5nKCksXG4gICAgfSkpO1xuICAgIGNvbnN0IGV2ZW50UmVxdWVzdHM6IHN0cmluZ1tdID0gW107XG4gICAgcGFnZS5vbihcInJlcXVlc3RcIiwgKHJlcXVlc3QpID0+IHtcbiAgICAgIGlmIChuZXcgVVJMKHJlcXVlc3QudXJsKCkpLnBhdGhuYW1lLmVuZHNXaXRoKFwiL2FwaS9ldmVudHNcIikpXG4gICAgICAgIGV2ZW50UmVxdWVzdHMucHVzaChyZXF1ZXN0LnVybCgpKTtcbiAgICB9KTtcbiAgICBhd2FpdCBpbnN0YWxsQXBpRml4dHVyZXMocGFnZSwge1xuICAgICAgZXZlbnRzLFxuICAgICAgcHJvamVjdHM6IFtcbiAgICAgICAge1xuICAgICAgICAgIGlkOiBcImUyZS1wcm9qZWN0XCIsXG4gICAgICAgICAgbmFtZTogXCJTbW9rZSBQcm9qZWN0XCIsXG4gICAgICAgICAgbGFuZ3VhZ2U6IFwiVHlwZVNjcmlwdFwiLFxuICAgICAgICAgIGZyYW1ld29yazogXCJSZWFjdFwiLFxuICAgICAgICAgIHN0YXR1czogXCJhY3RpdmVcIixcbiAgICAgICAgICByb290UGF0aDogXCIvY29udHJvbGxlZC9zbW9rZVwiLFxuICAgICAgICAgIHF1YWxpdHlTY29yZTogOTIsXG4gICAgICAgIH0sXG4gICAgICBdLFxuICAgIH0pO1xuICAgIGF3YWl0IHByb2dyYW1tYXRpY1NpZ25JbihwYWdlKTtcbiAgICBhd2FpdCBwYWdlLmdvdG8oYCR7REFTSEJPQVJEX1BBVEh9ZXZlbnRzYCk7XG5cbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcIk9sZGVyIGV2ZW50IDQ5XCIsIHsgZXhhY3Q6IHRydWUgfSksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiT2xkZXIgZXZlbnQgNTBcIiwgeyBleGFjdDogdHJ1ZSB9KSxcbiAgICApLm5vdC50b0JlVmlzaWJsZSgpO1xuICAgIGNvbnN0IGZpcnN0UmVxdWVzdCA9IG5ldyBVUkwoZXZlbnRSZXF1ZXN0cy5hdCgtMSkhKTtcbiAgICBleHBlY3QoZmlyc3RSZXF1ZXN0LnNlYXJjaFBhcmFtcy5nZXQoXCJsaW1pdFwiKSkudG9CZShcIjUwXCIpO1xuICAgIGV4cGVjdChmaXJzdFJlcXVlc3Quc2VhcmNoUGFyYW1zLmdldChcInBhZ2VcIikpLnRvQmUoXCIxXCIpO1xuXG4gICAgYXdhaXQgUHJvbWlzZS5hbGwoW1xuICAgICAgcGFnZS53YWl0Rm9yUmVxdWVzdCgocmVxdWVzdCkgPT4ge1xuICAgICAgICBjb25zdCB1cmwgPSBuZXcgVVJMKHJlcXVlc3QudXJsKCkpO1xuICAgICAgICByZXR1cm4gKFxuICAgICAgICAgIHVybC5wYXRobmFtZS5lbmRzV2l0aChcIi9hcGkvZXZlbnRzXCIpICYmXG4gICAgICAgICAgdXJsLnNlYXJjaFBhcmFtcy5nZXQoXCJwYWdlXCIpID09PSBcIjJcIlxuICAgICAgICApO1xuICAgICAgfSksXG4gICAgICBwYWdlLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiT2xkZXJcIiB9KS5jbGljaygpLFxuICAgIF0pO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlLmdldEJ5VGV4dChcIlBhZ2UgMi5cIiwgeyBleGFjdDogZmFsc2UgfSkpLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXCJPbGRlciBldmVudCA1MFwiLCB7IGV4YWN0OiB0cnVlIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcIkZpbHRlcmVkIHJlbGVhc2UgZXZlbnQgMFwiLCB7IGV4YWN0OiB0cnVlIH0pLFxuICAgICkubm90LnRvQmVWaXNpYmxlKCk7XG4gICAgZXhwZWN0KG5ldyBVUkwoZXZlbnRSZXF1ZXN0cy5hdCgtMSkhKS5zZWFyY2hQYXJhbXMuZ2V0KFwicGFnZVwiKSkudG9CZShcIjJcIik7XG4gICAgYXdhaXQgcGFnZS5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIk5ld2VyXCIgfSkuY2xpY2soKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5nZXRCeVRleHQoXCJQYWdlIDEuXCIsIHsgZXhhY3Q6IGZhbHNlIH0pKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiRmlsdGVyZWQgcmVsZWFzZSBldmVudCAwXCIsIHsgZXhhY3Q6IHRydWUgfSksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuXG4gICAgYXdhaXQgcGFnZS5nZXRCeVBsYWNlaG9sZGVyKFwiU2VhcmNoIGxvZ3MuLi5cIikuZmlsbChcIkZpbHRlcmVkIHJlbGVhc2VcIik7XG4gICAgYXdhaXQgcGFnZS5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIlRvZ2dsZSBldmVudCBmaWx0ZXJzXCIgfSkuY2xpY2soKTtcbiAgICBhd2FpdCBwYWdlLmxvY2F0b3IoXCJzZWxlY3RcIikubnRoKDEpLnNlbGVjdE9wdGlvbihcInN1Y2Nlc3NcIik7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXCJGaWx0ZXJlZCByZWxlYXNlIGV2ZW50IDBcIiwgeyBleGFjdDogdHJ1ZSB9KSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXCJPbGRlciBldmVudCAxXCIsIHsgZXhhY3Q6IHRydWUgfSksXG4gICAgKS5ub3QudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZSkudG9IYXZlVVJMKC9zZWFyY2g9RmlsdGVyZWRcXCtyZWxlYXNlLyk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UpLnRvSGF2ZVVSTCgvc2V2ZXJpdHk9c3VjY2Vzcy8pO1xuXG4gICAgYXdhaXQgcGFnZS5yZWxvYWQoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcIkZpbHRlcmVkIHJlbGVhc2UgZXZlbnQgMFwiLCB7IGV4YWN0OiB0cnVlIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcIk9sZGVyIGV2ZW50IDFcIiwgeyBleGFjdDogdHJ1ZSB9KSxcbiAgICApLm5vdC50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlLmdldEJ5UGxhY2Vob2xkZXIoXCJTZWFyY2ggbG9ncy4uLlwiKSkudG9IYXZlVmFsdWUoXG4gICAgICBcIkZpbHRlcmVkIHJlbGVhc2VcIixcbiAgICApO1xuICAgIGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJUb2dnbGUgZXZlbnQgZmlsdGVyc1wiIH0pLmNsaWNrKCk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcihcInNlbGVjdFwiKS5udGgoMSkpLnRvSGF2ZVZhbHVlKFwic3VjY2Vzc1wiKTtcbiAgICBjb25zdCBmaWx0ZXJlZFJlcXVlc3QgPSBuZXcgVVJMKGV2ZW50UmVxdWVzdHMuYXQoLTEpISk7XG4gICAgZXhwZWN0KGZpbHRlcmVkUmVxdWVzdC5zZWFyY2hQYXJhbXMuZ2V0KFwibGltaXRcIikpLnRvQmUoXCI1MFwiKTtcbiAgICBleHBlY3QoZmlsdGVyZWRSZXF1ZXN0LnNlYXJjaFBhcmFtcy5nZXQoXCJwYWdlXCIpKS50b0JlKFwiMVwiKTtcbiAgICBleHBlY3QoZmlsdGVyZWRSZXF1ZXN0LnNlYXJjaFBhcmFtcy5nZXQoXCJzZWFyY2hcIikpLnRvQmUoXCJGaWx0ZXJlZCByZWxlYXNlXCIpO1xuICAgIGV4cGVjdChmaWx0ZXJlZFJlcXVlc3Quc2VhcmNoUGFyYW1zLmdldChcInNldmVyaXR5XCIpKS50b0JlKFwic3VjY2Vzc1wiKTtcbiAgfSk7XG5cbiAgdGVzdChcInJlbmRlcnMgYW4gQXJhYmljIHNvdXJjZS1iYWNrZWQgQUkgYW5zd2VyIHdpdGhvdXQgaW50ZXJuYWwgZGlhZ25vc3RpY3NcIiwgYXN5bmMgKHtcbiAgICBwYWdlLFxuICB9KSA9PiB7XG4gICAgY29uc3QgZml4dHVyZSA9IGF3YWl0IGluc3RhbGxBcmFiaWNBaUZpeHR1cmUocGFnZSk7XG4gICAgYXdhaXQgaW5zdGFsbEFwaUZpeHR1cmVzKHBhZ2UsIHsgYXJhYmljQWk6IGZpeHR1cmUgfSk7XG4gICAgYXdhaXQgcHJvZ3JhbW1hdGljU2lnbkluKHBhZ2UpO1xuICAgIGF3YWl0IHBhZ2UuZ290byhgJHtEQVNIQk9BUkRfUEFUSH1haWApO1xuXG4gICAgY29uc3QgY29tcG9zZXIgPSBwYWdlLmxvY2F0b3IoXCJ0ZXh0YXJlYVwiKS5maXJzdCgpO1xuICAgIGF3YWl0IGV4cGVjdChjb21wb3NlcikudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBjb21wb3Nlci5maWxsKGZpeHR1cmUucXVlc3Rpb24pO1xuICAgIGNvbnN0IHNlbmRCdXR0b24gPSBjb21wb3Nlci5sb2NhdG9yKFwieHBhdGg9Li5cIikuZ2V0QnlSb2xlKFwiYnV0dG9uXCIpO1xuICAgIGF3YWl0IGV4cGVjdChzZW5kQnV0dG9uKS50b0JlRW5hYmxlZCgpO1xuICAgIGNvbnN0IHN0cmVhbVJlc3BvbnNlUHJvbWlzZSA9IHBhZ2Uud2FpdEZvclJlc3BvbnNlKChyZXNwb25zZSkgPT5cbiAgICAgIHJlc3BvbnNlLnVybCgpLmluY2x1ZGVzKFwiL2FwaS9haS9jaGF0L3N0cmVhbVwiKSxcbiAgICApO1xuICAgIGF3YWl0IHNlbmRCdXR0b24uY2xpY2soKTtcbiAgICBjb25zdCBzdHJlYW1SZXNwb25zZSA9IGF3YWl0IHN0cmVhbVJlc3BvbnNlUHJvbWlzZTtcbiAgICBleHBlY3Qoc3RyZWFtUmVzcG9uc2Uuc3RhdHVzKCkpLnRvQmUoMjAwKTtcblxuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KGZpeHR1cmUucXVlc3Rpb24sIHsgZXhhY3Q6IHRydWUgfSkubGFzdCgpLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChmaXh0dXJlLmFuc3dlciwgeyBleGFjdDogdHJ1ZSB9KS5sYXN0KCksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiQWdlbnQgYWN0aXZpdHlcIiwgeyBleGFjdDogZmFsc2UgfSksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IHBhZ2UubG9jYXRvcihcInN1bW1hcnlcIikuZmlsdGVyKHsgaGFzVGV4dDogXCJBZ2VudCBhY3Rpdml0eVwiIH0pLmNsaWNrKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXCJSZWFkaW5nIHNvdXJjZVwiLCB7IGV4YWN0OiBmYWxzZSB9KSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoZml4dHVyZS5zb3VyY2UsIHsgZXhhY3Q6IHRydWUgfSkubGFzdCgpLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dCgvQmVoYXZpb3IgZXZpZGVuY2UgwrcgMSBleGNlcnB0L2kpLmxhc3QoKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZVxuICAgICAgICAuZ2V0QnlUZXh0KCdyZXR1cm4gcGFydGlhbEZyb21Db2xsZWN0ZWRFdmlkZW5jZShcInByb3ZpZGVyIHRpbWVvdXRcIik7Jywge1xuICAgICAgICAgIGV4YWN0OiB0cnVlLFxuICAgICAgICB9KVxuICAgICAgICAubGFzdCgpLFxuICAgICkudG9CZVZpc2libGUoKTtcblxuICAgIGNvbnN0IHZpc2libGVUZXh0ID0gYXdhaXQgcGFnZS5sb2NhdG9yKFwiYm9keVwiKS5pbm5lclRleHQoKTtcbiAgICBleHBlY3QodmlzaWJsZVRleHQpLm5vdC50b0NvbnRhaW4oXCJDT01QTEVURURcIik7XG4gICAgZXhwZWN0KHZpc2libGVUZXh0KS5ub3QudG9Db250YWluKFwiUGVyc2lzdGVkIGV4ZWN1dGlvbiBwcm9vZlwiKTtcbiAgICBleHBlY3QodmlzaWJsZVRleHQpLnRvQ29udGFpbihcIk5PVCBQUk9WRU5cIik7XG4gIH0pO1xuXG4gIHRlc3QoXCJrZWVwcyB0aGUgQUkgc2Vzc2lvbiBkcmF3ZXIgb3ZlcmxhaWQgb24gYSBwaG9uZSB2aWV3cG9ydCB3aXRoIGFjY2VwdGVkIGV2aWRlbmNlXCIsIGFzeW5jICh7XG4gICAgcGFnZSxcbiAgfSkgPT4ge1xuICAgIGF3YWl0IHBhZ2Uuc2V0Vmlld3BvcnRTaXplKHsgd2lkdGg6IDM5MCwgaGVpZ2h0OiA4NDQgfSk7XG4gICAgY29uc3QgZml4dHVyZSA9IGF3YWl0IGluc3RhbGxBcmFiaWNBaUZpeHR1cmUocGFnZSk7XG4gICAgYXdhaXQgaW5zdGFsbEFwaUZpeHR1cmVzKHBhZ2UsIHsgYXJhYmljQWk6IGZpeHR1cmUgfSk7XG4gICAgYXdhaXQgcHJvZ3JhbW1hdGljU2lnbkluKHBhZ2UpO1xuICAgIGF3YWl0IHBhZ2UuZ290byhgJHtEQVNIQk9BUkRfUEFUSH1haWApO1xuXG4gICAgY29uc3QgY29tcG9zZXIgPSBwYWdlLmxvY2F0b3IoXCJ0ZXh0YXJlYVwiKS5maXJzdCgpO1xuICAgIGF3YWl0IGNvbXBvc2VyLmZpbGwoZml4dHVyZS5xdWVzdGlvbik7XG4gICAgYXdhaXQgY29tcG9zZXIubG9jYXRvcihcInhwYXRoPS4uXCIpLmdldEJ5Um9sZShcImJ1dHRvblwiKS5jbGljaygpO1xuXG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoZml4dHVyZS5hbnN3ZXIsIHsgZXhhY3Q6IHRydWUgfSkubGFzdCgpLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlXG4gICAgICAgIC5nZXRCeVRleHQoYCR7Zml4dHVyZS5zb3VyY2V9OjQyYCwgeyBleGFjdDogZmFsc2UgfSlcbiAgICAgICAgLmxhc3QoKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgcGFnZVxuICAgICAgLmxvY2F0b3IoXCJzdW1tYXJ5XCIpXG4gICAgICAuZmlsdGVyKHsgaGFzVGV4dDogXCJBZ2VudCBhY3Rpdml0eVwiIH0pXG4gICAgICAubGFzdCgpXG4gICAgICAuY2xpY2soKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKFwiYm9keVwiKSkudG9Db250YWluVGV4dChcIlJlYWRpbmcgc291cmNlXCIpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoXCJib2R5XCIpKS50b0NvbnRhaW5UZXh0KGZpeHR1cmUuc291cmNlKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKFwiYm9keVwiKSkudG9Db250YWluVGV4dChcbiAgICAgIFwiQWNjZXB0ZWQ6IHNvdXJjZSBzcGFuIHZlcmlmaWVkLlwiLFxuICAgICk7XG4gICAgYXdhaXQgZXhwZWN0Tm9Ib3Jpem9udGFsT3ZlcmZsb3cocGFnZSk7XG5cbiAgICBjb25zdCB2aXNpYmxlVGV4dCA9IGF3YWl0IHBhZ2UubG9jYXRvcihcImJvZHlcIikuaW5uZXJUZXh0KCk7XG4gICAgZXhwZWN0KHZpc2libGVUZXh0KS5ub3QudG9NYXRjaChcbiAgICAgIC9yYXdQcm9tcHR8c3lzdGVtUHJvbXB0fHByb3ZpZGVyIGRpYWdub3N0aWNzfHNvdXJjZS13aW5kb3d8cmVjb3ZlcnkgcHJvbXB0fFxcL2hvbWVcXC9ydW5uZXIvaSxcbiAgICApO1xuICB9KTtcblxuICB0ZXN0KFwia2VlcHMgc2FmZSBjaXRhdGlvbiBzdGF0ZSBhY3Jvc3MgYnJvd3NlciBiYWNrIGFuZCBmb3J3YXJkIG5hdmlnYXRpb24gd2l0aCBibG9ja2VkIGV2aWRlbmNlXCIsIGFzeW5jICh7XG4gICAgcGFnZSxcbiAgfSkgPT4ge1xuICAgIGNvbnN0IGFjY2VwdGVkID0gYXdhaXQgaW5zdGFsbEFyYWJpY0FpRml4dHVyZShwYWdlLCB7XG4gICAgICBzZXNzaW9uSWQ6IFwiZTJlLWhpc3RvcnktYWNjZXB0ZWQtc2Vzc2lvblwiLFxuICAgICAgcXVlc3Rpb246IFwi2YXYpyDZh9mIINiz2YTZiNmDINmF2YfZhNipIHByb3ZpZGVyINi52YbYryDYp9mE2LHYrNmI2Lkg2LnYqNixINiz2KzZhCDYp9mE2YXYqti12YHYrdifXCIsXG4gICAgfSk7XG4gICAgY29uc3QgYmxvY2tlZCA9IGF3YWl0IGluc3RhbGxBcmFiaWNBaUZpeHR1cmUocGFnZSwge1xuICAgICAgYmxvY2tlZDogdHJ1ZSxcbiAgICAgIHNlc3Npb25JZDogXCJlMmUtaGlzdG9yeS1ibG9ja2VkLXNlc3Npb25cIixcbiAgICAgIHF1ZXN0aW9uOiBcItmF2Kcg2YfZiCDYp9mE2K/ZhNmK2YQg2KfZhNmF2K3YrNmI2Kgg2LnZhtivINin2YTYsdis2YjYuSDYudio2LEg2LPYrNmEINin2YTZhdiq2LXZgdit2J9cIixcbiAgICB9KTtcbiAgICBhd2FpdCBpbnN0YWxsQXBpRml4dHVyZXMocGFnZSwge1xuICAgICAgYXJhYmljQWk6IGFjY2VwdGVkLFxuICAgICAgYWx0ZXJuYXRlQWk6IGJsb2NrZWQsXG4gICAgfSk7XG4gICAgYXdhaXQgcHJvZ3JhbW1hdGljU2lnbkluKHBhZ2UpO1xuICAgIGF3YWl0IHBhZ2UuZ290byhgJHtEQVNIQk9BUkRfUEFUSH1haWApO1xuXG4gICAgY29uc3QgY29tcG9zZXIgPSBwYWdlLmxvY2F0b3IoXCJ0ZXh0YXJlYVwiKS5maXJzdCgpO1xuICAgIGF3YWl0IGNvbXBvc2VyLmZpbGwoYmxvY2tlZC5xdWVzdGlvbik7XG4gICAgYXdhaXQgY29tcG9zZXIubG9jYXRvcihcInhwYXRoPS4uXCIpLmdldEJ5Um9sZShcImJ1dHRvblwiKS5jbGljaygpO1xuXG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoYmxvY2tlZC5hbnN3ZXIsIHsgZXhhY3Q6IHRydWUgfSkubGFzdCgpLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBwYWdlXG4gICAgICAubG9jYXRvcihcInN1bW1hcnlcIilcbiAgICAgIC5maWx0ZXIoeyBoYXNUZXh0OiBcIkFnZW50IGFjdGl2aXR5XCIgfSlcbiAgICAgIC5sYXN0KClcbiAgICAgIC5jbGljaygpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoXCJib2R5XCIpKS50b0NvbnRhaW5UZXh0KFwiUmVhZGluZyBzb3VyY2VcIik7XG4gICAgY29uc3QgdmlzaWJsZVRleHQgPSBhd2FpdCBwYWdlLmxvY2F0b3IoXCJib2R5XCIpLmlubmVyVGV4dCgpO1xuICAgIGV4cGVjdCh2aXNpYmxlVGV4dCkubm90LnRvTWF0Y2goXG4gICAgICAvcmF3UHJvbXB0fHN5c3RlbVByb21wdHxwcm92aWRlciBkaWFnbm9zdGljc3xzb3VyY2Utd2luZG93fHJlY292ZXJ5IHByb21wdHxcXC9ob21lXFwvcnVubmVyL2ksXG4gICAgKTtcbiAgfSk7XG5cbiAgdGVzdChcImtlZXBzIHNhZmUgY2l0YXRpb24gc3RhdGUgd2hlbiBzd2l0Y2hpbmcgcHJvamVjdHNcIiwgYXN5bmMgKHtcbiAgICBwYWdlLFxuICB9KSA9PiB7XG4gICAgY29uc3QgYWNjZXB0ZWQgPSBhd2FpdCBpbnN0YWxsQXJhYmljQWlGaXh0dXJlKHBhZ2UsIHtcbiAgICAgIHNlc3Npb25JZDogXCJlMmUtaGlzdG9yeS1hY2NlcHRlZC1zZXNzaW9uXCIsXG4gICAgICBxdWVzdGlvbjogXCLZhdinINmH2Ygg2LPZhNmI2YMg2YXZh9mE2KkgcHJvdmlkZXIg2LnZhtivINin2YTYsdis2YjYuSDYudio2LEg2LPYrNmEINin2YTZhdiq2LXZgdit2J9cIixcbiAgICB9KTtcbiAgICBjb25zdCBibG9ja2VkID0gYXdhaXQgaW5zdGFsbEFyYWJpY0FpRml4dHVyZShwYWdlLCB7XG4gICAgICBibG9ja2VkOiB0cnVlLFxuICAgICAgc2Vzc2lvbklkOiBcImUyZS1oaXN0b3J5LWJsb2NrZWQtc2Vzc2lvblwiLFxuICAgICAgcXVlc3Rpb246IFwi2YXYpyDZh9mIINin2YTYr9mE2YrZhCDYp9mE2YXYrdis2YjYqCDYudmG2K8g2KfZhNix2KzZiNi5INi52KjYsSDYs9is2YQg2KfZhNmF2KrYtdmB2K3Yn1wiLFxuICAgIH0pO1xuICAgIGF3YWl0IGluc3RhbGxBcGlGaXh0dXJlcyhwYWdlLCB7XG4gICAgICBhcmFiaWNBaTogYWNjZXB0ZWQsXG4gICAgICBhbHRlcm5hdGVBaTogYmxvY2tlZCxcbiAgICAgIHByb2plY3RzOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBpZDogXCJlMmUtcHJvamVjdC1vbmVcIixcbiAgICAgICAgICBuYW1lOiBcIkNpdGF0aW9uIFByb2plY3QgT25lXCIsXG4gICAgICAgICAgbGFuZ3VhZ2U6IFwiVHlwZVNjcmlwdFwiLFxuICAgICAgICAgIGZyYW1ld29yazogXCJSZWFjdFwiLFxuICAgICAgICAgIHN0YXR1czogXCJhY3RpdmVcIixcbiAgICAgICAgICByb290UGF0aDogXCIvY29udHJvbGxlZC9wcm9qZWN0LW9uZVwiLFxuICAgICAgICAgIHF1YWxpdHlTY29yZTogOTIsXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBpZDogXCJlMmUtcHJvamVjdC10d29cIixcbiAgICAgICAgICBuYW1lOiBcIkNpdGF0aW9uIFByb2plY3QgVHdvXCIsXG4gICAgICAgICAgbGFuZ3VhZ2U6IFwiVHlwZVNjcmlwdFwiLFxuICAgICAgICAgIGZyYW1ld29yazogXCJSZWFjdFwiLFxuICAgICAgICAgIHN0YXR1czogXCJhY3RpdmVcIixcbiAgICAgICAgICByb290UGF0aDogXCIvY29udHJvbGxlZC9wcm9qZWN0LXR3b1wiLFxuICAgICAgICAgIHF1YWxpdHlTY29yZTogODgsXG4gICAgICAgIH0sXG4gICAgICBdLFxuICAgIH0pO1xuICAgIGF3YWl0IHByb2dyYW1tYXRpY1NpZ25JbihwYWdlKTtcbiAgICBhd2FpdCBwYWdlLmdvdG8oYCR7REFTSEJPQVJEX1BBVEh9YWlgKTtcblxuICAgIGF3YWl0IHBhZ2VcbiAgICAgIC5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBhY2NlcHRlZC5xdWVzdGlvbiwgZXhhY3Q6IHRydWUgfSlcbiAgICAgIC5jbGljaygpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KGFjY2VwdGVkLmFuc3dlciwgeyBleGFjdDogdHJ1ZSB9KS5sYXN0KCksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KGAke2FjY2VwdGVkLnNvdXJjZX06NDJgLCB7IGV4YWN0OiBmYWxzZSB9KS5sYXN0KCksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiQWNjZXB0ZWQ6IHNvdXJjZSBzcGFuIHZlcmlmaWVkLlwiLCB7IGV4YWN0OiB0cnVlIH0pLmxhc3QoKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG5cbiAgICBhd2FpdCBwYWdlLmdldEJ5Um9sZShcImNvbWJvYm94XCIpLnNlbGVjdE9wdGlvbihcImUyZS1wcm9qZWN0LXR3b1wiKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IGJsb2NrZWQucXVlc3Rpb24sIGV4YWN0OiB0cnVlIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5nZXRCeVRleHQoYWNjZXB0ZWQuYW5zd2VyLCB7IGV4YWN0OiB0cnVlIH0pKS50b0hhdmVDb3VudChcbiAgICAgIDAsXG4gICAgKTtcbiAgICBhd2FpdCBwYWdlXG4gICAgICAuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogYmxvY2tlZC5xdWVzdGlvbiwgZXhhY3Q6IHRydWUgfSlcbiAgICAgIC5jbGljaygpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2VcbiAgICAgICAgLmdldEJ5VGV4dChcIkJsb2NrZWQ6IG5vIG1hdGNoaW5nIHNvdXJjZSB0ZXh0IHdhcyBmb3VuZC5cIiwge1xuICAgICAgICAgIGV4YWN0OiB0cnVlLFxuICAgICAgICB9KVxuICAgICAgICAubGFzdCgpLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChgJHtibG9ja2VkLnNvdXJjZX06NDJgLCB7IGV4YWN0OiBmYWxzZSB9KSxcbiAgICApLnRvSGF2ZUNvdW50KDApO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiQWNjZXB0ZWQ6IHNvdXJjZSBzcGFuIHZlcmlmaWVkLlwiLCB7IGV4YWN0OiB0cnVlIH0pLFxuICAgICkudG9IYXZlQ291bnQoMCk7XG5cbiAgICBhd2FpdCBwYWdlLmdldEJ5Um9sZShcImNvbWJvYm94XCIpLnNlbGVjdE9wdGlvbihcImUyZS1wcm9qZWN0LW9uZVwiKTtcbiAgICBhd2FpdCBwYWdlXG4gICAgICAuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogYWNjZXB0ZWQucXVlc3Rpb24sIGV4YWN0OiB0cnVlIH0pXG4gICAgICAuY2xpY2soKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChgJHthY2NlcHRlZC5zb3VyY2V9OjQyYCwgeyBleGFjdDogZmFsc2UgfSkubGFzdCgpLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcIkFjY2VwdGVkOiBzb3VyY2Ugc3BhbiB2ZXJpZmllZC5cIiwgeyBleGFjdDogdHJ1ZSB9KS5sYXN0KCksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiQmxvY2tlZDogbm8gbWF0Y2hpbmcgc291cmNlIHRleHQgd2FzIGZvdW5kLlwiLCB7XG4gICAgICAgIGV4YWN0OiB0cnVlLFxuICAgICAgfSksXG4gICAgKS50b0hhdmVDb3VudCgwKTtcblxuICAgIGNvbnN0IHZpc2libGVUZXh0ID0gYXdhaXQgcGFnZS5sb2NhdG9yKFwiYm9keVwiKS5pbm5lclRleHQoKTtcbiAgICBleHBlY3QodmlzaWJsZVRleHQpLm5vdC50b01hdGNoKFxuICAgICAgL3Jhd1Byb21wdHxzeXN0ZW1Qcm9tcHR8cHJvdmlkZXIgZGlhZ25vc3RpY3N8c291cmNlLXdpbmRvd3xyZWNvdmVyeSBwcm9tcHR8XFwvaG9tZVxcL3J1bm5lci9pLFxuICAgICk7XG4gIH0pO1xuXG4gIHRlc3QoXCJrZWVwcyBzYWZlIGNpdGF0aW9uIHN0YXRlIGFjcm9zcyByZXBlYXRlZCBuYXZpZ2F0aW9uXCIsIGFzeW5jICh7XG4gICAgcGFnZSxcbiAgfSkgPT4ge1xuICAgIGNvbnN0IGFjY2VwdGVkID0gYXdhaXQgaW5zdGFsbEFyYWJpY0FpRml4dHVyZShwYWdlLCB7XG4gICAgICBzZXNzaW9uSWQ6IFwiZTJlLWhpc3RvcnktYWNjZXB0ZWQtc2Vzc2lvblwiLFxuICAgICAgcXVlc3Rpb246IFwi2YXYpyDZh9mIINiz2YTZiNmDINmF2YfZhNipIHByb3ZpZGVyINi52YbYryDYp9mE2LHYrNmI2Lkg2LnYqNixINiz2KzZhCDYp9mE2YXYqti12YHYrdifXCIsXG4gICAgfSk7XG4gICAgY29uc3QgYmxvY2tlZCA9IGF3YWl0IGluc3RhbGxBcmFiaWNBaUZpeHR1cmUocGFnZSwge1xuICAgICAgYmxvY2tlZDogdHJ1ZSxcbiAgICAgIHNlc3Npb25JZDogXCJlMmUtaGlzdG9yeS1ibG9ja2VkLXNlc3Npb25cIixcbiAgICAgIHF1ZXN0aW9uOiBcItmF2Kcg2YfZiCDYp9mE2K/ZhNmK2YQg2KfZhNmF2K3YrNmI2Kgg2LnZhtivINin2YTYsdis2YjYuSDYudio2LEg2LPYrNmEINin2YTZhdiq2LXZgdit2J9cIixcbiAgICB9KTtcbiAgICBhd2FpdCBpbnN0YWxsQXBpRml4dHVyZXMocGFnZSwge1xuICAgICAgYXJhYmljQWk6IGFjY2VwdGVkLFxuICAgICAgYWx0ZXJuYXRlQWk6IGJsb2NrZWQsXG4gICAgfSk7XG4gICAgYXdhaXQgcHJvZ3JhbW1hdGljU2lnbkluKHBhZ2UpO1xuICAgIGF3YWl0IHBhZ2UuZ290byhgJHtEQVNIQk9BUkRfUEFUSH1haWApO1xuXG4gICAgY29uc3QgYXNzZXJ0QWNjZXB0ZWRDaXRhdGlvbiA9IGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IGV4cGVjdChcbiAgICAgICAgcGFnZS5nZXRCeVRleHQoYWNjZXB0ZWQuYW5zd2VyLCB7IGV4YWN0OiB0cnVlIH0pLmxhc3QoKSxcbiAgICAgICkudG9CZVZpc2libGUoKTtcbiAgICAgIGF3YWl0IGV4cGVjdChcbiAgICAgICAgcGFnZS5nZXRCeVRleHQoYCR7YWNjZXB0ZWQuc291cmNlfTo0MmAsIHsgZXhhY3Q6IGZhbHNlIH0pLmxhc3QoKSxcbiAgICAgICkudG9CZVZpc2libGUoKTtcbiAgICAgIGF3YWl0IGV4cGVjdChcbiAgICAgICAgcGFnZVxuICAgICAgICAgIC5nZXRCeVRleHQoXCJBY2NlcHRlZDogc291cmNlIHNwYW4gdmVyaWZpZWQuXCIsIHsgZXhhY3Q6IHRydWUgfSlcbiAgICAgICAgICAubGFzdCgpLFxuICAgICAgKS50b0JlVmlzaWJsZSgpO1xuICAgICAgYXdhaXQgZXhwZWN0KFxuICAgICAgICBwYWdlLmdldEJ5VGV4dChcIkJsb2NrZWQ6IG5vIG1hdGNoaW5nIHNvdXJjZSB0ZXh0IHdhcyBmb3VuZC5cIiwge1xuICAgICAgICAgIGV4YWN0OiB0cnVlLFxuICAgICAgICB9KSxcbiAgICAgICkudG9IYXZlQ291bnQoMCk7XG4gICAgfTtcbiAgICBjb25zdCBhc3NlcnRCbG9ja2VkQ2l0YXRpb24gPSBhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCBleHBlY3QoXG4gICAgICAgIHBhZ2VcbiAgICAgICAgICAuZ2V0QnlUZXh0KFwiQmxvY2tlZDogbm8gbWF0Y2hpbmcgc291cmNlIHRleHQgd2FzIGZvdW5kLlwiLCB7XG4gICAgICAgICAgICBleGFjdDogdHJ1ZSxcbiAgICAgICAgICB9KVxuICAgICAgICAgIC5sYXN0KCksXG4gICAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgICBhd2FpdCBleHBlY3QoXG4gICAgICAgIHBhZ2UuZ2V0QnlUZXh0KGAke2Jsb2NrZWQuc291cmNlfTo0MmAsIHsgZXhhY3Q6IGZhbHNlIH0pLFxuICAgICAgKS50b0hhdmVDb3VudCgwKTtcbiAgICAgIGF3YWl0IGV4cGVjdChcbiAgICAgICAgcGFnZS5nZXRCeVRleHQoXCJBY2NlcHRlZDogc291cmNlIHNwYW4gdmVyaWZpZWQuXCIsIHsgZXhhY3Q6IHRydWUgfSksXG4gICAgICApLnRvSGF2ZUNvdW50KDApO1xuICAgIH07XG4gICAgY29uc3QgYXNzZXJ0Tm9JbnRlcm5hbENpdGF0aW9uRGV0YWlscyA9IGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHZpc2libGVUZXh0ID0gYXdhaXQgcGFnZS5sb2NhdG9yKFwiYm9keVwiKS5pbm5lclRleHQoKTtcbiAgICAgIGV4cGVjdCh2aXNpYmxlVGV4dCkubm90LnRvTWF0Y2goXG4gICAgICAgIC9NSVNTSU5HX0xJVEVSQUxfTUFUQ0h8cmF3UHJvbXB0fHN5c3RlbVByb21wdHxwcm92aWRlciBkaWFnbm9zdGljc3xzb3VyY2Utd2luZG93fHJlY292ZXJ5IHByb21wdHxcXC9ob21lXFwvcnVubmVyL2ksXG4gICAgICApO1xuICAgIH07XG5cbiAgICBhd2FpdCBwYWdlXG4gICAgICAuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogYWNjZXB0ZWQucXVlc3Rpb24sIGV4YWN0OiB0cnVlIH0pXG4gICAgICAuY2xpY2soKTtcbiAgICBhd2FpdCBhc3NlcnRBY2NlcHRlZENpdGF0aW9uKCk7XG5cbiAgICBhd2FpdCBvcGVuTmF2aWdhdGlvbihwYWdlLCBcIlByb2plY3RzXCIsIGAke0RBU0hCT0FSRF9QQVRIfXByb2plY3RzYCk7XG4gICAgYXdhaXQgcGFnZS5nb0JhY2soKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZSkudG9IYXZlVVJMKFxuICAgICAgbmV3IFJlZ0V4cChgJHtEQVNIQk9BUkRfUEFUSC5yZXBsYWNlQWxsKFwiL1wiLCBcIlxcXFwvXCIpfWFpJGApLFxuICAgICk7XG4gICAgYXdhaXQgcGFnZVxuICAgICAgLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IGFjY2VwdGVkLnF1ZXN0aW9uLCBleGFjdDogdHJ1ZSB9KVxuICAgICAgLmNsaWNrKCk7XG4gICAgYXdhaXQgYXNzZXJ0QWNjZXB0ZWRDaXRhdGlvbigpO1xuICAgIGF3YWl0IGFzc2VydE5vSW50ZXJuYWxDaXRhdGlvbkRldGFpbHMoKTtcblxuICAgIGF3YWl0IHBhZ2UuZ29Gb3J3YXJkKCk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UpLnRvSGF2ZVVSTChcbiAgICAgIG5ldyBSZWdFeHAoYCR7REFTSEJPQVJEX1BBVEgucmVwbGFjZUFsbChcIi9cIiwgXCJcXFxcL1wiKX1wcm9qZWN0cyRgKSxcbiAgICApO1xuICAgIGF3YWl0IHBhZ2UuZ29CYWNrKCk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UpLnRvSGF2ZVVSTChcbiAgICAgIG5ldyBSZWdFeHAoYCR7REFTSEJPQVJEX1BBVEgucmVwbGFjZUFsbChcIi9cIiwgXCJcXFxcL1wiKX1haSRgKSxcbiAgICApO1xuICAgIGF3YWl0IHBhZ2VcbiAgICAgIC5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBhY2NlcHRlZC5xdWVzdGlvbiwgZXhhY3Q6IHRydWUgfSlcbiAgICAgIC5jbGljaygpO1xuICAgIGF3YWl0IGFzc2VydEFjY2VwdGVkQ2l0YXRpb24oKTtcblxuICAgIGF3YWl0IHBhZ2VcbiAgICAgIC5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBibG9ja2VkLnF1ZXN0aW9uLCBleGFjdDogdHJ1ZSB9KVxuICAgICAgLmNsaWNrKCk7XG4gICAgYXdhaXQgYXNzZXJ0QmxvY2tlZENpdGF0aW9uKCk7XG5cbiAgICBhd2FpdCBvcGVuTmF2aWdhdGlvbihwYWdlLCBcIkV2ZW50IFN0cmVhbVwiLCBgJHtEQVNIQk9BUkRfUEFUSH1ldmVudHNgKTtcbiAgICBhd2FpdCBwYWdlLmdvQmFjaygpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlKS50b0hhdmVVUkwoXG4gICAgICBuZXcgUmVnRXhwKGAke0RBU0hCT0FSRF9QQVRILnJlcGxhY2VBbGwoXCIvXCIsIFwiXFxcXC9cIil9YWkkYCksXG4gICAgKTtcbiAgICBhd2FpdCBwYWdlXG4gICAgICAuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogYmxvY2tlZC5xdWVzdGlvbiwgZXhhY3Q6IHRydWUgfSlcbiAgICAgIC5jbGljaygpO1xuICAgIGF3YWl0IGFzc2VydEJsb2NrZWRDaXRhdGlvbigpO1xuICAgIGF3YWl0IGFzc2VydE5vSW50ZXJuYWxDaXRhdGlvbkRldGFpbHMoKTtcblxuICAgIGF3YWl0IHBhZ2UuZ29Gb3J3YXJkKCk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UpLnRvSGF2ZVVSTChcbiAgICAgIG5ldyBSZWdFeHAoYCR7REFTSEJPQVJEX1BBVEgucmVwbGFjZUFsbChcIi9cIiwgXCJcXFxcL1wiKX1ldmVudHMkYCksXG4gICAgKTtcbiAgICBhd2FpdCBwYWdlLmdvQmFjaygpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlKS50b0hhdmVVUkwoXG4gICAgICBuZXcgUmVnRXhwKGAke0RBU0hCT0FSRF9QQVRILnJlcGxhY2VBbGwoXCIvXCIsIFwiXFxcXC9cIil9YWkkYCksXG4gICAgKTtcbiAgICBhd2FpdCBwYWdlXG4gICAgICAuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogYmxvY2tlZC5xdWVzdGlvbiwgZXhhY3Q6IHRydWUgfSlcbiAgICAgIC5jbGljaygpO1xuICAgIGF3YWl0IGFzc2VydEJsb2NrZWRDaXRhdGlvbigpO1xuICAgIGF3YWl0IGFzc2VydE5vSW50ZXJuYWxDaXRhdGlvbkRldGFpbHMoKTtcbiAgfSk7XG5cbiAgdGVzdChcImtlZXBzIG9ubHkgdGhlIHNhZmUgYmxvY2tlZCBjaXRhdGlvbiByZWFzb24gYWZ0ZXIgY2hhdCByZWxvYWRcIiwgYXN5bmMgKHtcbiAgICBwYWdlLFxuICB9KSA9PiB7XG4gICAgY29uc3QgZml4dHVyZSA9IGluc3RhbGxUb29sRmFpbHVyZUZpeHR1cmUoKTtcbiAgICBhd2FpdCBpbnN0YWxsQXBpRml4dHVyZXMocGFnZSwgeyBhcmFiaWNBaTogZml4dHVyZSB9KTtcbiAgICBhd2FpdCBwcm9ncmFtbWF0aWNTaWduSW4ocGFnZSk7XG4gICAgYXdhaXQgcGFnZS5nb3RvKGAke0RBU0hCT0FSRF9QQVRIfWFpYCk7XG5cbiAgICBjb25zdCBjb21wb3NlciA9IHBhZ2UubG9jYXRvcihcInRleHRhcmVhXCIpLmZpcnN0KCk7XG4gICAgYXdhaXQgY29tcG9zZXIuZmlsbChmaXh0dXJlLnF1ZXN0aW9uKTtcbiAgICBhd2FpdCBjb21wb3Nlci5sb2NhdG9yKFwieHBhdGg9Li5cIikuZ2V0QnlSb2xlKFwiYnV0dG9uXCIpLmNsaWNrKCk7XG5cbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChmaXh0dXJlLmFuc3dlciwgeyBleGFjdDogdHJ1ZSB9KS5sYXN0KCksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2VcbiAgICAgICAgLmdldEJ5VGV4dChcInJlcXVpcmVkIHRvb2wgZGlkIG5vdCBjb21wbGV0ZSDigJQgQkxPQ0tFRC9JTkNPTVBMRVRFXCIsIHtcbiAgICAgICAgICBleGFjdDogZmFsc2UsXG4gICAgICAgIH0pXG4gICAgICAgIC5sYXN0KCksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IHBhZ2VcbiAgICAgIC5sb2NhdG9yKFwic3VtbWFyeVwiKVxuICAgICAgLmZpbHRlcih7IGhhc1RleHQ6IFwiQWdlbnQgYWN0aXZpdHlcIiB9KVxuICAgICAgLmxhc3QoKVxuICAgICAgLmNsaWNrKCk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcihcImJvZHlcIikpLnRvQ29udGFpblRleHQoXCJSZWFkaW5nIHNvdXJjZVwiKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKFwiYm9keVwiKSkudG9Db250YWluVGV4dChcbiAgICAgIFwic3JjL21pc3NpbmctcmVsZWFzZS1maXh0dXJlLnRzXCIsXG4gICAgKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKFwiYm9keVwiKSkudG9Db250YWluVGV4dChcIlRvb2wgZmFpbGVkXCIpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoXCJib2R5XCIpKS50b0NvbnRhaW5UZXh0KFwiVE9PTF9FWEVDVVRJT05fRkFJTEVEXCIpO1xuICAgIGNvbnN0IHZpc2libGVUZXh0ID0gYXdhaXQgcGFnZS5sb2NhdG9yKFwiYm9keVwiKS5pbm5lclRleHQoKTtcbiAgICBleHBlY3QodmlzaWJsZVRleHQpLm5vdC50b0NvbnRhaW4oXCJDT01QTEVURURcIik7XG4gICAgZXhwZWN0KHZpc2libGVUZXh0KS50b0NvbnRhaW4oXCJQZXJzaXN0ZWQgZXhlY3V0aW9uIHByb29mXCIpO1xuICAgIGV4cGVjdCh2aXNpYmxlVGV4dCkudG9Db250YWluKFwiVGhlIHJlcXVpcmVkIHNvdXJjZSByZWFkIGRpZCBub3QgY29tcGxldGUuXCIpO1xuICB9KTtcblxuICB0ZXN0KFwia2VlcHMgdGhlIGZhaWxlZCBBSSBzZXNzaW9uIGRyYXdlciBvdmVybGFpZCBvbiBhIHBob25lIHZpZXdwb3J0XCIsIGFzeW5jICh7XG4gICAgcGFnZSxcbiAgfSkgPT4ge1xuICAgIGF3YWl0IHBhZ2Uuc2V0Vmlld3BvcnRTaXplKHsgd2lkdGg6IDM5MCwgaGVpZ2h0OiA4NDQgfSk7XG4gICAgY29uc3QgZml4dHVyZSA9IGluc3RhbGxUb29sRmFpbHVyZUZpeHR1cmUoKTtcbiAgICBhd2FpdCBpbnN0YWxsQXBpRml4dHVyZXMocGFnZSwgeyBhcmFiaWNBaTogZml4dHVyZSB9KTtcbiAgICBhd2FpdCBwcm9ncmFtbWF0aWNTaWduSW4ocGFnZSk7XG4gICAgYXdhaXQgcGFnZS5nb3RvKGAke0RBU0hCT0FSRF9QQVRIfWFpYCk7XG5cbiAgICBjb25zdCBjb21wb3NlciA9IHBhZ2UubG9jYXRvcihcInRleHRhcmVhXCIpLmZpcnN0KCk7XG4gICAgYXdhaXQgY29tcG9zZXIuZmlsbChmaXh0dXJlLnF1ZXN0aW9uKTtcbiAgICBhd2FpdCBjb21wb3Nlci5sb2NhdG9yKFwieHBhdGg9Li5cIikuZ2V0QnlSb2xlKFwiYnV0dG9uXCIpLmNsaWNrKCk7XG5cbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChmaXh0dXJlLmFuc3dlciwgeyBleGFjdDogdHJ1ZSB9KS5sYXN0KCksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2VcbiAgICAgICAgLmdldEJ5VGV4dChcInJlcXVpcmVkIHRvb2wgZGlkIG5vdCBjb21wbGV0ZSDigJQgQkxPQ0tFRC9JTkNPTVBMRVRFXCIsIHtcbiAgICAgICAgICBleGFjdDogZmFsc2UsXG4gICAgICAgIH0pXG4gICAgICAgIC5sYXN0KCksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IHBhZ2VcbiAgICAgIC5sb2NhdG9yKFwic3VtbWFyeVwiKVxuICAgICAgLmZpbHRlcih7IGhhc1RleHQ6IFwiQWdlbnQgYWN0aXZpdHlcIiB9KVxuICAgICAgLmxhc3QoKVxuICAgICAgLmNsaWNrKCk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcihcImJvZHlcIikpLnRvQ29udGFpblRleHQoXCJSZWFkaW5nIHNvdXJjZVwiKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKFwiYm9keVwiKSkudG9Db250YWluVGV4dChcbiAgICAgIFwic3JjL21pc3NpbmctcmVsZWFzZS1maXh0dXJlLnRzXCIsXG4gICAgKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKFwiYm9keVwiKSkudG9Db250YWluVGV4dChcIlRvb2wgZmFpbGVkXCIpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoXCJib2R5XCIpKS50b0NvbnRhaW5UZXh0KFwiVE9PTF9FWEVDVVRJT05fRkFJTEVEXCIpO1xuICAgIGNvbnN0IHZpc2libGVUZXh0ID0gYXdhaXQgcGFnZS5sb2NhdG9yKFwiYm9keVwiKS5pbm5lclRleHQoKTtcbiAgICBleHBlY3QodmlzaWJsZVRleHQpLm5vdC50b01hdGNoKFxuICAgICAgL3JhdyBleGNlcHRpb258c3RhY2sgdHJhY2V8XFwvaG9tZVxcL3J1bm5lcnxzZWNyZXR8Zml4dHVyZSBkaWFnbm9zdGljL2ksXG4gICAgKTtcblxuICAgIGF3YWl0IGV4cGVjdE5vSG9yaXpvbnRhbE92ZXJmbG93KHBhZ2UpO1xuICB9KTtcblxuICB0ZXN0KFwicHJlc2VydmVzIG9uZSBwYXJ0aWFsIGFuc3dlciBhZnRlciBhIHByb3ZpZGVyIGRpc2Nvbm5lY3QgYW5kIG1hcmtzIGl0IGluY29tcGxldGVcIiwgYXN5bmMgKHtcbiAgICBwYWdlLFxuICB9KSA9PiB7XG4gICAgY29uc3QgZml4dHVyZSA9IGluc3RhbGxEaXNjb25uZWN0ZWRBaUZpeHR1cmUoKTtcbiAgICBhd2FpdCBpbnN0YWxsQXBpRml4dHVyZXMocGFnZSwgeyBkaXNjb25uZWN0QWk6IGZpeHR1cmUgfSk7XG4gICAgYXdhaXQgcHJvZ3JhbW1hdGljU2lnbkluKHBhZ2UpO1xuICAgIGF3YWl0IHBhZ2UuZ290byhgJHtEQVNIQk9BUkRfUEFUSH1haWApO1xuXG4gICAgY29uc3QgY29tcG9zZXIgPSBwYWdlLmxvY2F0b3IoXCJ0ZXh0YXJlYVwiKS5maXJzdCgpO1xuICAgIGF3YWl0IGNvbXBvc2VyLmZpbGwoZml4dHVyZS5xdWVzdGlvbik7XG4gICAgYXdhaXQgY29tcG9zZXIubG9jYXRvcihcInhwYXRoPS4uXCIpLmdldEJ5Um9sZShcImJ1dHRvblwiKS5jbGljaygpO1xuXG4gICAgY29uc3QgYW5zd2VyID0gcGFnZS5nZXRCeVRleHQoZml4dHVyZS5hbnN3ZXIsIHsgZXhhY3Q6IHRydWUgfSk7XG4gICAgYXdhaXQgZXhwZWN0KGFuc3dlci5sYXN0KCkpLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlUZXh0KFwiSU5DT01QTEVURTpcIiwgeyBleGFjdDogZmFsc2UgfSkpLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXCJwcm92aWRlciBmYWlsdXJlXCIsIHsgZXhhY3Q6IGZhbHNlIH0pLmxhc3QoKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXCJzdG9wcGVkOiBwcm92aWRlciB0aW1lb3V0XCIsIHsgZXhhY3Q6IGZhbHNlIH0pLmxhc3QoKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXCJUaGUgcHJvdmlkZXIgZGlzY29ubmVjdGVkIGFmdGVyIHZpc2libGUgcmVzcG9uc2UgdGV4dC5cIiwge1xuICAgICAgICBleGFjdDogdHJ1ZSxcbiAgICAgIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcblxuICAgIGF3YWl0IHBhZ2UucmVsb2FkKCk7XG4gICAgYXdhaXQgcGFnZVxuICAgICAgLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IGZpeHR1cmUucXVlc3Rpb24sIGV4YWN0OiB0cnVlIH0pXG4gICAgICAuY2xpY2soKTtcblxuICAgIGF3YWl0IGV4cGVjdChwYWdlLmdldEJ5VGV4dChmaXh0dXJlLmFuc3dlciwgeyBleGFjdDogdHJ1ZSB9KS5sYXN0KCkpLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlUZXh0KFwiSU5DT01QTEVURTpcIiwgeyBleGFjdDogZmFsc2UgfSkpLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXCJwcm92aWRlciBmYWlsdXJlXCIsIHsgZXhhY3Q6IGZhbHNlIH0pLmxhc3QoKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXCJzdG9wcGVkOiBwcm92aWRlciB0aW1lb3V0XCIsIHsgZXhhY3Q6IGZhbHNlIH0pLmxhc3QoKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXCJUaGUgcHJvdmlkZXIgZGlzY29ubmVjdGVkIGFmdGVyIHZpc2libGUgcmVzcG9uc2UgdGV4dC5cIiwge1xuICAgICAgICBleGFjdDogdHJ1ZSxcbiAgICAgIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgfSk7XG5cbiAgdGVzdChcInJlc3VtZXMgYSBmYWlsZWQgYW5hbHlzaXMgYW5kIGtlZXBzIHRoZSBleGVjdXRpb24gaW5jb21wbGV0ZVwiLCBhc3luYyAoe1xuICAgIHBhZ2UsXG4gIH0pID0+IHtcbiAgICBjb25zdCB7IGZpeHR1cmUsIGV4ZWN1dGlvbiB9ID0gaW5zdGFsbFJlc3VtZWRBbmFseXNpc0ZhaWx1cmVGaXh0dXJlKCk7XG4gICAgYXdhaXQgaW5zdGFsbEFwaUZpeHR1cmVzKHBhZ2UsIHtcbiAgICAgIGFyYWJpY0FpOiBmaXh0dXJlLFxuICAgICAgcmVzdW1lRmFpbHVyZTogeyBmaXh0dXJlLCBleGVjdXRpb24gfSxcbiAgICB9KTtcbiAgICBhd2FpdCBwcm9ncmFtbWF0aWNTaWduSW4ocGFnZSk7XG5cbiAgICBhd2FpdCBwYWdlLmV2YWx1YXRlKFxuICAgICAgKHsgc2Vzc2lvbklkLCBleGVjdXRpb25JZCwgcHJvamVjdElkLCByZXN1bWVUb2tlbiwgbWVzc2FnZSB9KSA9PiB7XG4gICAgICAgIGxvY2FsU3RvcmFnZS5zZXRJdGVtKFxuICAgICAgICAgIGBlb3NfYWlfZXhlY3V0aW9uX2N1cnJlbnRfJHtwcm9qZWN0SWR9YCxcbiAgICAgICAgICBzZXNzaW9uSWQsXG4gICAgICAgICk7XG4gICAgICAgIGxvY2FsU3RvcmFnZS5zZXRJdGVtKFxuICAgICAgICAgIGBlb3NfYWlfZXhlY3V0aW9uXyR7cHJvamVjdElkfV8ke3Nlc3Npb25JZH1gLFxuICAgICAgICAgIEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgICAgIGlkOiBleGVjdXRpb25JZCxcbiAgICAgICAgICAgIHByb2plY3RJZCxcbiAgICAgICAgICAgIHNlc3Npb25JZCxcbiAgICAgICAgICAgIHJlc3VtZVRva2VuLFxuICAgICAgICAgICAgbWVzc2FnZSxcbiAgICAgICAgICB9KSxcbiAgICAgICAgKTtcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIHNlc3Npb25JZDogZml4dHVyZS5zZXNzaW9uSWQsXG4gICAgICAgIGV4ZWN1dGlvbklkOiBmaXh0dXJlLmV4ZWN1dGlvbklkLFxuICAgICAgICBwcm9qZWN0SWQ6IFwiZTJlLXByb2plY3RcIixcbiAgICAgICAgcmVzdW1lVG9rZW46IFwiZTJlLXJlc3VtZWQtYW5hbHlzaXMtZmFpbHVyZS10b2tlbi1vcGFxdWVcIixcbiAgICAgICAgbWVzc2FnZTogZml4dHVyZS5xdWVzdGlvbixcbiAgICAgIH0sXG4gICAgKTtcbiAgICBhd2FpdCBwYWdlLmdvdG8oYCR7REFTSEJPQVJEX1BBVEh9YWlgKTtcblxuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiQSBzYXZlZCBBSSBleGVjdXRpb24gaXMgcmVhZHkgdG8gcmVzdW1lXCIpLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBjb25zdCByZXN1bWVSZXF1ZXN0ID0gcGFnZS53YWl0Rm9yUmVxdWVzdChcbiAgICAgIChyZXF1ZXN0KSA9PlxuICAgICAgICByZXF1ZXN0LnVybCgpLmluY2x1ZGVzKFwiL2FwaS9haS9jaGF0L3N0cmVhbVwiKSAmJlxuICAgICAgICByZXF1ZXN0Lm1ldGhvZCgpID09PSBcIlBPU1RcIixcbiAgICApO1xuICAgIGF3YWl0IHBhZ2VcbiAgICAgIC5nZXRCeUxhYmVsKFwiQWdlbnQgZXhlY3V0aW9uIHByb29mXCIpXG4gICAgICAuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJSZXN1bWVcIiwgZXhhY3Q6IHRydWUgfSlcbiAgICAgIC5jbGljaygpO1xuICAgIGNvbnN0IHJlcXVlc3RCb2R5ID0gSlNPTi5wYXJzZShcbiAgICAgIChhd2FpdCByZXN1bWVSZXF1ZXN0KS5wb3N0RGF0YSgpID8/IFwie31cIixcbiAgICApIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAgIGV4cGVjdChyZXF1ZXN0Qm9keSkudG9FcXVhbChcbiAgICAgIGV4cGVjdC5vYmplY3RDb250YWluaW5nKHtcbiAgICAgICAgcHJvamVjdElkOiBcImUyZS1wcm9qZWN0XCIsXG4gICAgICAgIHNlc3Npb25JZDogZml4dHVyZS5zZXNzaW9uSWQsXG4gICAgICAgIGV4ZWN1dGlvbklkOiBmaXh0dXJlLmV4ZWN1dGlvbklkLFxuICAgICAgICByZXN1bWVUb2tlbjogXCJlMmUtcmVzdW1lZC1hbmFseXNpcy1mYWlsdXJlLXRva2VuLW9wYXF1ZVwiLFxuICAgICAgICBtZXNzYWdlOiBmaXh0dXJlLnF1ZXN0aW9uLFxuICAgICAgfSksXG4gICAgKTtcblxuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiRmFpbGVkIHRvIHNlbmQgbWVzc2FnZVwiLCB7IGV4YWN0OiB0cnVlIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcIkEgc2F2ZWQgQUkgZXhlY3V0aW9uIGlzIHJlYWR5IHRvIHJlc3VtZVwiKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgY29uc3QgdmlzaWJsZVRleHQgPSBhd2FpdCBwYWdlLmxvY2F0b3IoXCJib2R5XCIpLmlubmVyVGV4dCgpO1xuICAgIGV4cGVjdCh2aXNpYmxlVGV4dCkubm90LnRvQ29udGFpbihcIkNPTVBMRVRFRFwiKTtcbiAgICBleHBlY3QodmlzaWJsZVRleHQpLm5vdC50b0NvbnRhaW4oXCJQZXJzaXN0ZWQgZXhlY3V0aW9uIHByb29mXCIpO1xuICAgIGV4cGVjdCh2aXNpYmxlVGV4dCkudG9Db250YWluKFwiVGhlIHJlcXVpcmVkIGFuYWx5c2lzIGRpZCBub3QgY29tcGxldGUuXCIpO1xuICB9KTtcblxuICB0ZXN0KFwicmVjb3ZlcnMgYSBtaXNzaW5nIHRva2VuIGFmdGVyIGEgcmVhbCBzdHJlYW0gYWJvcnQgYW5kIHJlc3VtZXMgb25lIGV4ZWN1dGlvblwiLCBhc3luYyAoe1xuICAgIHBhZ2UsXG4gIH0pID0+IHtcbiAgICBjb25zdCByZWNvdmVyeSA9IGluc3RhbGxJbnRlcnJ1cHRlZFJlc3VtZUZpeHR1cmUoKTtcbiAgICBhd2FpdCBpbnN0YWxsQXBpRml4dHVyZXMocGFnZSwgeyBpbnRlcnJ1cHRlZFJlc3VtZTogcmVjb3ZlcnkgfSk7XG4gICAgYXdhaXQgcGFnZS5hZGRJbml0U2NyaXB0KCgpID0+IHtcbiAgICAgIGNvbnN0IG5hdGl2ZUZldGNoID0gd2luZG93LmZldGNoLmJpbmQod2luZG93KTtcbiAgICAgIHdpbmRvdy5mZXRjaCA9IGFzeW5jIChpbnB1dCwgaW5pdCkgPT4ge1xuICAgICAgICBjb25zdCB1cmwgPVxuICAgICAgICAgIHR5cGVvZiBpbnB1dCA9PT0gXCJzdHJpbmdcIlxuICAgICAgICAgICAgPyBpbnB1dFxuICAgICAgICAgICAgOiBpbnB1dCBpbnN0YW5jZW9mIFJlcXVlc3RcbiAgICAgICAgICAgICAgPyBpbnB1dC51cmxcbiAgICAgICAgICAgICAgOiBTdHJpbmcoaW5wdXQpO1xuICAgICAgICBjb25zdCBib2R5ID0gdHlwZW9mIGluaXQ/LmJvZHkgPT09IFwic3RyaW5nXCIgPyBpbml0LmJvZHkgOiBcIlwiO1xuICAgICAgICBpZiAoXG4gICAgICAgICAgIXVybC5pbmNsdWRlcyhcIi9hcGkvYWkvY2hhdC9zdHJlYW1cIikgfHxcbiAgICAgICAgICBib2R5LmluY2x1ZGVzKCdcImV4ZWN1dGlvbklkXCInKVxuICAgICAgICApIHtcbiAgICAgICAgICByZXR1cm4gbmF0aXZlRmV0Y2goaW5wdXQsIGluaXQpO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBuYXRpdmVGZXRjaChpbnB1dCwgaW5pdCk7XG4gICAgICAgIGlmICghcmVzcG9uc2UuYm9keSkgcmV0dXJuIHJlc3BvbnNlO1xuICAgICAgICBjb25zdCByZWFkZXIgPSByZXNwb25zZS5ib2R5LmdldFJlYWRlcigpO1xuICAgICAgICBjb25zdCBlbmNvZGVyID0gbmV3IFRleHRFbmNvZGVyKCk7XG4gICAgICAgIGNvbnN0IHN0cmVhbSA9IG5ldyBSZWFkYWJsZVN0cmVhbSh7XG4gICAgICAgICAgYXN5bmMgc3RhcnQoY29udHJvbGxlcikge1xuICAgICAgICAgICAgbGV0IGJ1ZmZlcmVkID0gXCJcIjtcbiAgICAgICAgICAgIHdoaWxlICh0cnVlKSB7XG4gICAgICAgICAgICAgIGNvbnN0IHsgZG9uZSwgdmFsdWUgfSA9IGF3YWl0IHJlYWRlci5yZWFkKCk7XG4gICAgICAgICAgICAgIGlmIChkb25lKSB7XG4gICAgICAgICAgICAgICAgaWYgKGJ1ZmZlcmVkKSBjb250cm9sbGVyLmVucXVldWUoZW5jb2Rlci5lbmNvZGUoYnVmZmVyZWQpKTtcbiAgICAgICAgICAgICAgICBjb250cm9sbGVyLmNsb3NlKCk7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIGJ1ZmZlcmVkICs9IG5ldyBUZXh0RGVjb2RlcigpLmRlY29kZSh2YWx1ZSwgeyBzdHJlYW06IHRydWUgfSk7XG4gICAgICAgICAgICAgIGNvbnN0IG1hcmtlciA9IGJ1ZmZlcmVkLmluZGV4T2YoJ1widHlwZVwiOlwiZXhlY3V0aW9uX3N0YXJ0ZWRcIicpO1xuICAgICAgICAgICAgICBjb25zdCBmcmFtZUVuZCA9XG4gICAgICAgICAgICAgICAgbWFya2VyIDwgMCA/IC0xIDogYnVmZmVyZWQuaW5kZXhPZihcIlxcblxcblwiLCBtYXJrZXIpO1xuICAgICAgICAgICAgICBpZiAoZnJhbWVFbmQgPj0gMCkge1xuICAgICAgICAgICAgICAgIGNvbnRyb2xsZXIuZW5xdWV1ZShcbiAgICAgICAgICAgICAgICAgIGVuY29kZXIuZW5jb2RlKGJ1ZmZlcmVkLnNsaWNlKDAsIGZyYW1lRW5kICsgMikpLFxuICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgICAgY29udHJvbGxlci5lcnJvcihuZXcgVHlwZUVycm9yKFwibmV0d29yayBjb25uZWN0aW9uIHJlc2V0XCIpKTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9LFxuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuIG5ldyBSZXNwb25zZShzdHJlYW0sIHtcbiAgICAgICAgICBzdGF0dXM6IHJlc3BvbnNlLnN0YXR1cyxcbiAgICAgICAgICBzdGF0dXNUZXh0OiByZXNwb25zZS5zdGF0dXNUZXh0LFxuICAgICAgICAgIGhlYWRlcnM6IHJlc3BvbnNlLmhlYWRlcnMsXG4gICAgICAgIH0pO1xuICAgICAgfTtcbiAgICB9KTtcbiAgICBhd2FpdCBwcm9ncmFtbWF0aWNTaWduSW4ocGFnZSk7XG4gICAgYXdhaXQgcGFnZS5nb3RvKGAke0RBU0hCT0FSRF9QQVRIfWFpYCk7XG5cbiAgICBjb25zdCBzdHJlYW1SZXF1ZXN0czogQXJyYXk8UmVjb3JkPHN0cmluZywgdW5rbm93bj4+ID0gW107XG4gICAgcGFnZS5vbihcInJlcXVlc3RcIiwgKHJlcXVlc3QpID0+IHtcbiAgICAgIGlmIChcbiAgICAgICAgcmVxdWVzdC51cmwoKS5pbmNsdWRlcyhcIi9hcGkvYWkvY2hhdC9zdHJlYW1cIikgJiZcbiAgICAgICAgcmVxdWVzdC5tZXRob2QoKSA9PT0gXCJQT1NUXCJcbiAgICAgICkge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIHN0cmVhbVJlcXVlc3RzLnB1c2goXG4gICAgICAgICAgICByZXF1ZXN0LnBvc3REYXRhSlNPTigpIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+LFxuICAgICAgICAgICk7XG4gICAgICAgIH0gY2F0Y2gge1xuICAgICAgICAgIC8vIElnbm9yZSByZXF1ZXN0cyB3aXRob3V0IGEgSlNPTiBib2R5OyB0aGUgYXNzZXJ0aW9ucyBiZWxvdyByZXF1aXJlXG4gICAgICAgICAgLy8gYm90aCBqb3VybmV5IHJlcXVlc3RzIHRvIGhhdmUgYSB2YWxpZCByZXF1ZXN0IGVudmVsb3BlLlxuICAgICAgICB9XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICBjb25zdCBjb21wb3NlciA9IHBhZ2UubG9jYXRvcihcInRleHRhcmVhXCIpLmZpcnN0KCk7XG4gICAgYXdhaXQgY29tcG9zZXIuZmlsbChyZWNvdmVyeS5maXh0dXJlLnF1ZXN0aW9uKTtcbiAgICBhd2FpdCBjb21wb3Nlci5sb2NhdG9yKFwieHBhdGg9Li5cIikuZ2V0QnlSb2xlKFwiYnV0dG9uXCIpLmNsaWNrKCk7XG5cbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcbiAgICAgICAgXCJFeGVjdXRpb24gcGF1c2VkIOKAlCByZWFkeSB0byByZXN1bWUgZnJvbSBpdHMgZHVyYWJsZSBjaGVja3BvaW50XCIsXG4gICAgICAgIHtcbiAgICAgICAgICBleGFjdDogdHJ1ZSxcbiAgICAgICAgfSxcbiAgICAgICksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuXG4gICAgY29uc3Qgc3RvcmFnZUtleSA9XG4gICAgICBcImVvc19haV9leGVjdXRpb25fZTJlLXByb2plY3RfZTJlLWludGVycnVwdGVkLXJlc3VtZS1zZXNzaW9uXCI7XG4gICAgY29uc3QgcG9pbnRlcktleSA9IFwiZW9zX2FpX2V4ZWN1dGlvbl9jdXJyZW50X2UyZS1wcm9qZWN0XCI7XG4gICAgYXdhaXQgZXhwZWN0XG4gICAgICAucG9sbCgoKSA9PiBwYWdlLmV2YWx1YXRlKChrZXkpID0+IGxvY2FsU3RvcmFnZS5nZXRJdGVtKGtleSksIHN0b3JhZ2VLZXkpKVxuICAgICAgLnRvQ29udGFpbihyZWNvdmVyeS5pbml0aWFsVG9rZW4pO1xuXG4gICAgYXdhaXQgcGFnZS5ldmFsdWF0ZShcbiAgICAgICh7IHN0b3JhZ2VLZXksIHBvaW50ZXJLZXkgfSkgPT4ge1xuICAgICAgICBjb25zdCBzYXZlZCA9IEpTT04ucGFyc2UobG9jYWxTdG9yYWdlLmdldEl0ZW0oc3RvcmFnZUtleSkgPz8gXCJ7fVwiKTtcbiAgICAgICAgZGVsZXRlIHNhdmVkLnJlc3VtZVRva2VuO1xuICAgICAgICBsb2NhbFN0b3JhZ2Uuc2V0SXRlbShzdG9yYWdlS2V5LCBKU09OLnN0cmluZ2lmeShzYXZlZCkpO1xuICAgICAgICBsb2NhbFN0b3JhZ2Uuc2V0SXRlbShwb2ludGVyS2V5LCBcImUyZS1pbnRlcnJ1cHRlZC1yZXN1bWUtc2Vzc2lvblwiKTtcbiAgICAgIH0sXG4gICAgICB7IHN0b3JhZ2VLZXksIHBvaW50ZXJLZXkgfSxcbiAgICApO1xuICAgIGF3YWl0IHBhZ2UucmVsb2FkKCk7XG5cbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcIkEgc2F2ZWQgQUkgZXhlY3V0aW9uIGlzIHJlYWR5IHRvIHJlc3VtZVwiLCB7XG4gICAgICAgIGV4YWN0OiB0cnVlLFxuICAgICAgfSksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdFxuICAgICAgLnBvbGwoKCkgPT5cbiAgICAgICAgcGFnZS5ldmFsdWF0ZSgoa2V5KSA9PiB7XG4gICAgICAgICAgY29uc3Qgc2F2ZWQgPSBKU09OLnBhcnNlKGxvY2FsU3RvcmFnZS5nZXRJdGVtKGtleSkgPz8gXCJ7fVwiKTtcbiAgICAgICAgICByZXR1cm4gc2F2ZWQucmVzdW1lVG9rZW47XG4gICAgICAgIH0sIHN0b3JhZ2VLZXkpLFxuICAgICAgKVxuICAgICAgLnRvQmUocmVjb3ZlcnkucmVjb3ZlcmVkVG9rZW4pO1xuXG4gICAgYXdhaXQgcGFnZS5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIlJlc3VtZVwiLCBleGFjdDogdHJ1ZSB9KS5jbGljaygpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KHJlY292ZXJ5LmZpeHR1cmUuYW5zd2VyLCB7IGV4YWN0OiB0cnVlIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QucG9sbCgoKSA9PiBzdHJlYW1SZXF1ZXN0cy5sZW5ndGgpLnRvQmUoMik7XG4gICAgZXhwZWN0KHN0cmVhbVJlcXVlc3RzWzBdKS50b0VxdWFsKFxuICAgICAgZXhwZWN0Lm9iamVjdENvbnRhaW5pbmcoe1xuICAgICAgICBwcm9qZWN0SWQ6IFwiZTJlLXByb2plY3RcIixcbiAgICAgICAgbWVzc2FnZTogcmVjb3ZlcnkuZml4dHVyZS5xdWVzdGlvbixcbiAgICAgIH0pLFxuICAgICk7XG4gICAgZXhwZWN0KHN0cmVhbVJlcXVlc3RzWzBdPy5leGVjdXRpb25JZCkudG9CZVVuZGVmaW5lZCgpO1xuICAgIGV4cGVjdChzdHJlYW1SZXF1ZXN0c1swXT8uc2Vzc2lvbklkKS50b0JlVW5kZWZpbmVkKCk7XG4gICAgZXhwZWN0KHN0cmVhbVJlcXVlc3RzWzFdKS50b0VxdWFsKFxuICAgICAgZXhwZWN0Lm9iamVjdENvbnRhaW5pbmcoe1xuICAgICAgICBwcm9qZWN0SWQ6IFwiZTJlLXByb2plY3RcIixcbiAgICAgICAgc2Vzc2lvbklkOiByZWNvdmVyeS5maXh0dXJlLnNlc3Npb25JZCxcbiAgICAgICAgZXhlY3V0aW9uSWQ6IHJlY292ZXJ5LmZpeHR1cmUuZXhlY3V0aW9uSWQsXG4gICAgICAgIHJlc3VtZVRva2VuOiByZWNvdmVyeS5yZWNvdmVyZWRUb2tlbixcbiAgICAgICAgbWVzc2FnZTogcmVjb3ZlcnkuZml4dHVyZS5xdWVzdGlvbixcbiAgICAgIH0pLFxuICAgICk7XG4gICAgZXhwZWN0KFxuICAgICAgc3RyZWFtUmVxdWVzdHMubWFwKChyZXF1ZXN0KSA9PiByZXF1ZXN0LmV4ZWN1dGlvbklkKS5maWx0ZXIoQm9vbGVhbiksXG4gICAgKS50b0VxdWFsKFtyZWNvdmVyeS5maXh0dXJlLmV4ZWN1dGlvbklkXSk7XG4gIH0pO1xuXG4gIHRlc3QoXCJwcm9qZWN0cyBkZWxpdmVyeSByZWNvdmVyeSBzdGF0ZXMgc2FmZWx5IGFmdGVyIHJlbG9hZFwiLCBhc3luYyAoe1xuICAgIHBhZ2UsXG4gIH0pID0+IHtcbiAgICBjb25zdCByZWNvdmVyeSA9IHtcbiAgICAgIHJlcXVlc3RzOiBbXSBhcyBzdHJpbmdbXSxcbiAgICAgIG9wZXJhdGlvbnM6IFtcbiAgICAgICAge1xuICAgICAgICAgIHByb3Bvc2FsSWQ6IFwiZTJlLXJlY292ZXJ5LWF2YWlsYWJsZS1wcm9wb3NhbFwiLFxuICAgICAgICAgIG9wZXJhdGlvbklkOiBcImUyZS1yZWNvdmVyeS1hdmFpbGFibGUtb3BlcmF0aW9uXCIsXG4gICAgICAgICAgc2Vzc2lvbklkOiBcImUyZS1yZWNvdmVyeS1hdmFpbGFibGUtc2Vzc2lvblwiLFxuICAgICAgICAgIGxpZmVjeWNsZTogXCJibG9ja2VkXCIsXG4gICAgICAgICAgc3RhdHVzOiBcInBlbmRpbmdcIixcbiAgICAgICAgICBjcmVhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMzowMC4wMDBaXCIsXG4gICAgICAgICAgcmVjb3ZlcnlTdGF0ZTogXCJyZWNvdmVyYWJsZVwiLFxuICAgICAgICAgIG9wZXJhdG9yRXhwbGFuYXRpb246XG4gICAgICAgICAgICBcIlRoZSBkZWxpdmVyeSBzdG9wcGVkIGJlY2F1c2UgdmFsaWRhdGlvbiBuZWVkcyB0byBiZSBydW4gYWdhaW4uXCIsXG4gICAgICAgICAgbmV4dEFjdGlvbjpcbiAgICAgICAgICAgIFwiUmVzdW1lIHZhbGlkYXRpb24gdG8gcmUtY2hlY2sgdGhlIHNhdmVkIGNoYW5nZXMsIG9yIGRpc2NhcmQgdGhpcyByZWNvdmVyeSBpZiBpdCBpcyBubyBsb25nZXIgbmVlZGVkLlwiLFxuICAgICAgICAgIGNvbmZsaWN0UmVhc29uOiBudWxsLFxuICAgICAgICAgIHZhbGlkYXRpb25FdmlkZW5jZTogW3sgcHJvZmlsZTogXCJ3b3Jrc3BhY2UtdHlwZWNoZWNrXCIsIHN0YXR1czogXCJmYWlsZWRcIiB9XSxcbiAgICAgICAgICB3b3Jrc3BhY2VBdmFpbGFibGU6IHRydWUsXG4gICAgICAgICAgY2hhbmdlQ291bnQ6IDIsXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBwcm9wb3NhbElkOiBcImUyZS1yZWNvdmVyeS1taXNzaW5nLXByb3Bvc2FsXCIsXG4gICAgICAgICAgb3BlcmF0aW9uSWQ6IFwiZTJlLXJlY292ZXJ5LW1pc3Npbmctb3BlcmF0aW9uXCIsXG4gICAgICAgICAgc2Vzc2lvbklkOiBcImUyZS1yZWNvdmVyeS1taXNzaW5nLXNlc3Npb25cIixcbiAgICAgICAgICBsaWZlY3ljbGU6IFwiYWJhbmRvbmVkXCIsXG4gICAgICAgICAgc3RhdHVzOiBcInBlbmRpbmdcIixcbiAgICAgICAgICBjcmVhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMjowMC4wMDBaXCIsXG4gICAgICAgICAgcmVjb3ZlcnlTdGF0ZTogXCJtaXNzaW5nX3dvcmtzcGFjZVwiLFxuICAgICAgICAgIG9wZXJhdG9yRXhwbGFuYXRpb246XG4gICAgICAgICAgICBcIlRoZSBzYXZlZCBkZWxpdmVyeSB3b3Jrc3BhY2UgaXMgbm8gbG9uZ2VyIGF2YWlsYWJsZSwgc28gcmVjb3ZlcnkgY2Fubm90IGNvbnRpbnVlLlwiLFxuICAgICAgICAgIG5leHRBY3Rpb246XG4gICAgICAgICAgICBcIlN0YXJ0IGEgbmV3IGRlbGl2ZXJ5IGZyb20gdGhlIGN1cnJlbnQgcHJvamVjdCByYXRoZXIgdGhhbiByZXRyeWluZyB0aGlzIHJlY292ZXJ5LlwiLFxuICAgICAgICAgIGNvbmZsaWN0UmVhc29uOiBcIldvcmtzcGFjZSBleHBpcmVkIGFmdGVyIHRoZSBydW5uZXIgd2FzIHJlY3ljbGVkLlwiLFxuICAgICAgICAgIHZhbGlkYXRpb25FdmlkZW5jZTogbnVsbCxcbiAgICAgICAgICB3b3Jrc3BhY2VBdmFpbGFibGU6IGZhbHNlLFxuICAgICAgICAgIGNoYW5nZUNvdW50OiAxLFxuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgcHJvcG9zYWxJZDogXCJlMmUtcmVjb3ZlcnktZGlzY2FyZGVkLXByb3Bvc2FsXCIsXG4gICAgICAgICAgb3BlcmF0aW9uSWQ6IFwiZTJlLXJlY292ZXJ5LWRpc2NhcmRlZC1vcGVyYXRpb25cIixcbiAgICAgICAgICBzZXNzaW9uSWQ6IFwiZTJlLXJlY292ZXJ5LWRpc2NhcmRlZC1zZXNzaW9uXCIsXG4gICAgICAgICAgbGlmZWN5Y2xlOiBcImNhbmNlbGxlZFwiLFxuICAgICAgICAgIHN0YXR1czogXCJyZWplY3RlZFwiLFxuICAgICAgICAgIGNyZWF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAxOjAwLjAwMFpcIixcbiAgICAgICAgICByZWNvdmVyeVN0YXRlOiBcImRpc2NhcmRlZFwiLFxuICAgICAgICAgIG9wZXJhdG9yRXhwbGFuYXRpb246IFwiVGhpcyBkZWxpdmVyeSByZWNvdmVyeSB3YXMgYWxyZWFkeSBkaXNjYXJkZWQuXCIsXG4gICAgICAgICAgbmV4dEFjdGlvbjogXCJObyBhY3Rpb24gaXMgcmVxdWlyZWQuXCIsXG4gICAgICAgICAgY29uZmxpY3RSZWFzb246IFwiSW50ZXJuYWwgZGlhZ25vc3RpYzogc2hvdWxkIG5ldmVyIGJlIHJlbmRlcmVkXCIsXG4gICAgICAgICAgdmFsaWRhdGlvbkV2aWRlbmNlOiBudWxsLFxuICAgICAgICAgIHdvcmtzcGFjZUF2YWlsYWJsZTogZmFsc2UsXG4gICAgICAgICAgY2hhbmdlQ291bnQ6IDMsXG4gICAgICAgIH0sXG4gICAgICBdLFxuICAgIH07XG4gICAgYXdhaXQgaW5zdGFsbEFwaUZpeHR1cmVzKHBhZ2UsIHsgZGVsaXZlcnlSZWNvdmVyeTogcmVjb3ZlcnkgfSk7XG4gICAgYXdhaXQgcHJvZ3JhbW1hdGljU2lnbkluKHBhZ2UpO1xuICAgIGF3YWl0IHBhZ2UuZ290byhgJHtEQVNIQk9BUkRfUEFUSH1haWApO1xuXG4gICAgY29uc3QgcmVnaW9uID0gcGFnZS5nZXRCeVJvbGUoXCJyZWdpb25cIiwge1xuICAgICAgbmFtZTogXCJSZWNvdmVyYWJsZSBkZWxpdmVyeSBvcGVyYXRpb25zXCIsXG4gICAgfSk7XG4gICAgYXdhaXQgZXhwZWN0KHJlZ2lvbikudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QocmVnaW9uLmdldEJ5VGV4dChcIlJlY292ZXJhYmxlXCIsIHsgZXhhY3Q6IHRydWUgfSkpLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcmVnaW9uLmdldEJ5VGV4dChcIldvcmtzcGFjZSB1bmF2YWlsYWJsZVwiLCB7IGV4YWN0OiB0cnVlIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICByZWdpb24uZ2V0QnlUZXh0KFwiQWxyZWFkeSBkaXNjYXJkZWRcIiwgeyBleGFjdDogdHJ1ZSB9KSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcmVnaW9uLmdldEJ5VGV4dChcbiAgICAgICAgXCJUaGUgc2F2ZWQgZGVsaXZlcnkgd29ya3NwYWNlIGlzIG5vIGxvbmdlciBhdmFpbGFibGUsIHNvIHJlY292ZXJ5IGNhbm5vdCBjb250aW51ZS5cIixcbiAgICAgICAgeyBleGFjdDogdHJ1ZSB9LFxuICAgICAgKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcmVnaW9uLmdldEJ5VGV4dChcIlRoaXMgZGVsaXZlcnkgcmVjb3Zlcnkgd2FzIGFscmVhZHkgZGlzY2FyZGVkLlwiLCB7XG4gICAgICAgIGV4YWN0OiB0cnVlLFxuICAgICAgfSksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHJlZ2lvbi5nZXRCeVRleHQoXG4gICAgICAgIFwiUmV0YWluZWQgcmVhc29uOiBXb3Jrc3BhY2UgZXhwaXJlZCBhZnRlciB0aGUgcnVubmVyIHdhcyByZWN5Y2xlZC5cIixcbiAgICAgICAgeyBleGFjdDogdHJ1ZSB9LFxuICAgICAgKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG5cbiAgICBjb25zdCBhdmFpbGFibGUgPSByZWdpb24ubG9jYXRvcihcbiAgICAgICdbZGF0YS1vcGVyYXRpb24taWQ9XCJlMmUtcmVjb3ZlcnktYXZhaWxhYmxlLW9wZXJhdGlvblwiXScsXG4gICAgKTtcbiAgICBjb25zdCBtaXNzaW5nID0gcmVnaW9uLmxvY2F0b3IoXG4gICAgICAnW2RhdGEtb3BlcmF0aW9uLWlkPVwiZTJlLXJlY292ZXJ5LW1pc3Npbmctb3BlcmF0aW9uXCJdJyxcbiAgICApO1xuICAgIGNvbnN0IGRpc2NhcmRlZCA9IHJlZ2lvbi5sb2NhdG9yKFxuICAgICAgJ1tkYXRhLW9wZXJhdGlvbi1pZD1cImUyZS1yZWNvdmVyeS1kaXNjYXJkZWQtb3BlcmF0aW9uXCJdJyxcbiAgICApO1xuICAgIGF3YWl0IGV4cGVjdChhdmFpbGFibGUpLnRvSGF2ZUF0dHJpYnV0ZShcbiAgICAgIFwiZGF0YS1yZWNvdmVyeS1zdGF0ZVwiLFxuICAgICAgXCJyZWNvdmVyYWJsZVwiLFxuICAgICk7XG4gICAgYXdhaXQgZXhwZWN0KG1pc3NpbmcpLnRvSGF2ZUF0dHJpYnV0ZShcbiAgICAgIFwiZGF0YS1yZWNvdmVyeS1zdGF0ZVwiLFxuICAgICAgXCJtaXNzaW5nX3dvcmtzcGFjZVwiLFxuICAgICk7XG4gICAgYXdhaXQgZXhwZWN0KGRpc2NhcmRlZCkudG9IYXZlQXR0cmlidXRlKFxuICAgICAgXCJkYXRhLXJlY292ZXJ5LXN0YXRlXCIsXG4gICAgICBcImRpc2NhcmRlZFwiLFxuICAgICk7XG4gICAgYXdhaXQgZXhwZWN0KGF2YWlsYWJsZS5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIlJlc3VtZSB2YWxpZGF0aW9uXCIgfSkpLnRvQmVFbmFibGVkKCk7XG4gICAgYXdhaXQgZXhwZWN0KGF2YWlsYWJsZS5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIkRpc2NhcmQgd29ya3NwYWNlXCIgfSkpLnRvQmVFbmFibGVkKCk7XG4gICAgYXdhaXQgZXhwZWN0KG1pc3NpbmcuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJSZXN1bWUgdmFsaWRhdGlvblwiIH0pKS50b0JlRGlzYWJsZWQoKTtcbiAgICBhd2FpdCBleHBlY3QobWlzc2luZy5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIkRpc2NhcmQgd29ya3NwYWNlXCIgfSkpLnRvQmVEaXNhYmxlZCgpO1xuICAgIGF3YWl0IGV4cGVjdChkaXNjYXJkZWQuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJSZXN1bWUgdmFsaWRhdGlvblwiIH0pKS50b0JlRGlzYWJsZWQoKTtcbiAgICBhd2FpdCBleHBlY3QoZGlzY2FyZGVkLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiRGlzY2FyZCB3b3Jrc3BhY2VcIiB9KSkudG9CZURpc2FibGVkKCk7XG5cbiAgICBjb25zdCB2aXNpYmxlVGV4dCA9IGF3YWl0IHBhZ2UubG9jYXRvcihcImJvZHlcIikuaW5uZXJUZXh0KCk7XG4gICAgZXhwZWN0KHZpc2libGVUZXh0KS5ub3QudG9NYXRjaChcbiAgICAgIC9cXC9ob21lXFwvcnVubmVyfFxcL3RtcFxcL3xcXC93b3Jrc3BhY2VcXC98aW50ZXJuYWwgZGlhZ25vc3RpYy9pLFxuICAgICk7XG4gICAgYXdhaXQgZXhwZWN0Tm9Ib3Jpem9udGFsT3ZlcmZsb3cocGFnZSk7XG5cbiAgICBhd2FpdCBwYWdlLnJlbG9hZCgpO1xuICAgIGNvbnN0IHJlbG9hZGVkUmVnaW9uID0gcGFnZS5nZXRCeVJvbGUoXCJyZWdpb25cIiwge1xuICAgICAgbmFtZTogXCJSZWNvdmVyYWJsZSBkZWxpdmVyeSBvcGVyYXRpb25zXCIsXG4gICAgfSk7XG4gICAgYXdhaXQgZXhwZWN0KHJlbG9hZGVkUmVnaW9uKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHJlbG9hZGVkUmVnaW9uXG4gICAgICAgIC5sb2NhdG9yKCdbZGF0YS1vcGVyYXRpb24taWQ9XCJlMmUtcmVjb3ZlcnktbWlzc2luZy1vcGVyYXRpb25cIl0nKVxuICAgICAgICAuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJSZXN1bWUgdmFsaWRhdGlvblwiIH0pLFxuICAgICkudG9CZURpc2FibGVkKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcmVsb2FkZWRSZWdpb25cbiAgICAgICAgLmxvY2F0b3IoJ1tkYXRhLW9wZXJhdGlvbi1pZD1cImUyZS1yZWNvdmVyeS1kaXNjYXJkZWQtb3BlcmF0aW9uXCJdJylcbiAgICAgICAgLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiRGlzY2FyZCB3b3Jrc3BhY2VcIiB9KSxcbiAgICApLnRvQmVEaXNhYmxlZCgpO1xuICAgIGV4cGVjdChyZWNvdmVyeS5yZXF1ZXN0cy5sZW5ndGgpLnRvQmVHcmVhdGVyVGhhbk9yRXF1YWwoMik7XG4gICAgZXhwZWN0KHJlY292ZXJ5LnJlcXVlc3RzLmV2ZXJ5KCh1cmwpID0+IHVybC5pbmNsdWRlcyhcInByb2plY3RJZD1lMmUtcHJvamVjdFwiKSkpLnRvQmUodHJ1ZSk7XG4gIH0pO1xuXG4gIHRlc3QoXCJleHBsYWlucyB3aGVuIGRlbGl2ZXJ5IHJlY292ZXJ5IGxvc2VzIGEgcmFjZSBhbmQgcmVmcmVzaGVzIHN0YXRlXCIsIGFzeW5jICh7XG4gICAgcGFnZSxcbiAgfSkgPT4ge1xuICAgIGNvbnN0IHJlY292ZXJ5ID0ge1xuICAgICAgcmVxdWVzdHM6IFtdIGFzIHN0cmluZ1tdLFxuICAgICAgYWN0aW9uUmVxdWVzdHM6IFtdIGFzIHN0cmluZ1tdLFxuICAgICAgb3BlcmF0aW9uczogW1xuICAgICAgICB7XG4gICAgICAgICAgcHJvcG9zYWxJZDogXCJlMmUtcmVjb3ZlcnktcmFjZS1wcm9wb3NhbFwiLFxuICAgICAgICAgIG9wZXJhdGlvbklkOiBcImUyZS1yZWNvdmVyeS1yYWNlLW9wZXJhdGlvblwiLFxuICAgICAgICAgIHNlc3Npb25JZDogXCJlMmUtcmVjb3ZlcnktcmFjZS1zZXNzaW9uXCIsXG4gICAgICAgICAgbGlmZWN5Y2xlOiBcImJsb2NrZWRcIixcbiAgICAgICAgICBzdGF0dXM6IFwicGVuZGluZ1wiLFxuICAgICAgICAgIGNyZWF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjA0OjAwLjAwMFpcIixcbiAgICAgICAgICByZWNvdmVyeVN0YXRlOiBcInJlY292ZXJhYmxlXCIsXG4gICAgICAgICAgb3BlcmF0b3JFeHBsYW5hdGlvbjpcbiAgICAgICAgICAgIFwiVGhlIGRlbGl2ZXJ5IHN0b3BwZWQgYmVjYXVzZSB0aGUgcmV0YWluZWQgY2hhbmdlcyBuZWVkIHJldmlldyBiZWZvcmUgdmFsaWRhdGlvbiBjYW4gY29udGludWUuXCIsXG4gICAgICAgICAgbmV4dEFjdGlvbjpcbiAgICAgICAgICAgIFwiUmVzdW1lIHZhbGlkYXRpb24gdG8gcmUtY2hlY2sgdGhlIHNhdmVkIGNoYW5nZXMsIG9yIGRpc2NhcmQgdGhpcyByZWNvdmVyeSBpZiBpdCBpcyBubyBsb25nZXIgbmVlZGVkLlwiLFxuICAgICAgICAgIGNvbmZsaWN0UmVhc29uOiBudWxsLFxuICAgICAgICAgIHZhbGlkYXRpb25FdmlkZW5jZTogW3sgcHJvZmlsZTogXCJ3b3Jrc3BhY2UtdHlwZWNoZWNrXCIsIHN0YXR1czogXCJmYWlsZWRcIiB9XSxcbiAgICAgICAgICB3b3Jrc3BhY2VBdmFpbGFibGU6IHRydWUsXG4gICAgICAgICAgY2hhbmdlQ291bnQ6IDEsXG4gICAgICAgIH0sXG4gICAgICBdLFxuICAgICAgcmVjb3ZlcnlBY3Rpb246IHtcbiAgICAgICAgcHJvcG9zYWxJZDogXCJlMmUtcmVjb3ZlcnktcmFjZS1wcm9wb3NhbFwiLFxuICAgICAgICBhY3Rpb246IFwicmVzdW1lLXZhbGlkYXRpb25cIiBhcyBjb25zdCxcbiAgICAgICAgcmVzcG9uc2U6IHtcbiAgICAgICAgICBlcnJvcjogXCJUaGlzIGRlbGl2ZXJ5IHJlY292ZXJ5IHdhcyBhbHJlYWR5IGRpc2NhcmRlZC5cIixcbiAgICAgICAgICBjb2RlOiBcIkRFTElWRVJZX0FMUkVBRFlfRElTQ0FSREVEXCIsXG4gICAgICAgICAgbGlmZWN5Y2xlOiBcImNhbmNlbGxlZFwiLFxuICAgICAgICAgIHJlY292ZXJ5U3RhdGU6IFwiZGlzY2FyZGVkXCIsXG4gICAgICAgICAgbmV4dEFjdGlvbjogXCJObyBhY3Rpb24gaXMgcmVxdWlyZWQuXCIsXG4gICAgICAgICAgZGlhZ25vc3RpYzogXCJEbyBub3QgcmVuZGVyIHRoaXMgc2VydmVyIGRldGFpbC5cIixcbiAgICAgICAgfSxcbiAgICAgICAgbmV4dE9wZXJhdGlvbnM6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBwcm9wb3NhbElkOiBcImUyZS1yZWNvdmVyeS1yYWNlLXByb3Bvc2FsXCIsXG4gICAgICAgICAgICBvcGVyYXRpb25JZDogXCJlMmUtcmVjb3ZlcnktcmFjZS1vcGVyYXRpb25cIixcbiAgICAgICAgICAgIHNlc3Npb25JZDogXCJlMmUtcmVjb3ZlcnktcmFjZS1zZXNzaW9uXCIsXG4gICAgICAgICAgICBsaWZlY3ljbGU6IFwiY2FuY2VsbGVkXCIsXG4gICAgICAgICAgICBzdGF0dXM6IFwicmVqZWN0ZWRcIixcbiAgICAgICAgICAgIGNyZWF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjA0OjAwLjAwMFpcIixcbiAgICAgICAgICAgIHJlY292ZXJ5U3RhdGU6IFwiZGlzY2FyZGVkXCIsXG4gICAgICAgICAgICBvcGVyYXRvckV4cGxhbmF0aW9uOiBcIlRoaXMgZGVsaXZlcnkgcmVjb3Zlcnkgd2FzIGFscmVhZHkgZGlzY2FyZGVkLlwiLFxuICAgICAgICAgICAgbmV4dEFjdGlvbjogXCJObyBhY3Rpb24gaXMgcmVxdWlyZWQuXCIsXG4gICAgICAgICAgICBjb25mbGljdFJlYXNvbjogbnVsbCxcbiAgICAgICAgICAgIHZhbGlkYXRpb25FdmlkZW5jZTogbnVsbCxcbiAgICAgICAgICAgIHdvcmtzcGFjZUF2YWlsYWJsZTogZmFsc2UsXG4gICAgICAgICAgICBjaGFuZ2VDb3VudDogMSxcbiAgICAgICAgICB9LFxuICAgICAgICBdLFxuICAgICAgfSxcbiAgICB9O1xuICAgIGF3YWl0IGluc3RhbGxBcGlGaXh0dXJlcyhwYWdlLCB7IGRlbGl2ZXJ5UmVjb3Zlcnk6IHJlY292ZXJ5IH0pO1xuICAgIGF3YWl0IHByb2dyYW1tYXRpY1NpZ25JbihwYWdlKTtcbiAgICBhd2FpdCBwYWdlLmdvdG8oYCR7REFTSEJPQVJEX1BBVEh9YWlgKTtcblxuICAgIGNvbnN0IHJlZ2lvbiA9IHBhZ2UuZ2V0QnlSb2xlKFwicmVnaW9uXCIsIHtcbiAgICAgIG5hbWU6IFwiUmVjb3ZlcmFibGUgZGVsaXZlcnkgb3BlcmF0aW9uc1wiLFxuICAgIH0pO1xuICAgIGNvbnN0IG9wZXJhdGlvbiA9IHJlZ2lvbi5sb2NhdG9yKFxuICAgICAgJ1tkYXRhLW9wZXJhdGlvbi1pZD1cImUyZS1yZWNvdmVyeS1yYWNlLW9wZXJhdGlvblwiXScsXG4gICAgKTtcbiAgICBhd2FpdCBleHBlY3Qob3BlcmF0aW9uLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiUmVzdW1lIHZhbGlkYXRpb25cIiB9KSkudG9CZUVuYWJsZWQoKTtcbiAgICBhd2FpdCBvcGVyYXRpb24uZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJSZXN1bWUgdmFsaWRhdGlvblwiIH0pLmNsaWNrKCk7XG5cbiAgICBhd2FpdCBleHBlY3QocGFnZS5nZXRCeVRleHQoXCJSZWNvdmVyeSBzdGF0ZSBjaGFuZ2VkXCIsIHsgZXhhY3Q6IHRydWUgfSkpLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXG4gICAgICAgIFwiVGhpcyByZWNvdmVyeSB3YXMgYWxyZWFkeSBkaXNjYXJkZWQuIFRoZSByZWNvdmVyeSBsaXN0IHdhcyByZWZyZXNoZWQuXCIsXG4gICAgICAgIHsgZXhhY3Q6IHRydWUgfSxcbiAgICAgICksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdFxuICAgICAgLnBvbGwoKCkgPT4gcmVjb3ZlcnkucmVxdWVzdHMubGVuZ3RoKVxuICAgICAgLnRvQmVHcmVhdGVyVGhhbk9yRXF1YWwoMik7XG4gICAgYXdhaXQgZXhwZWN0KG9wZXJhdGlvbikudG9IYXZlQXR0cmlidXRlKFwiZGF0YS1yZWNvdmVyeS1zdGF0ZVwiLCBcImRpc2NhcmRlZFwiKTtcbiAgICBleHBlY3QocmVjb3ZlcnkuYWN0aW9uUmVxdWVzdHMpLnRvSGF2ZUxlbmd0aCgxKTtcbiAgICBleHBlY3QocmVjb3ZlcnkuYWN0aW9uUmVxdWVzdHNbMF0pLnRvQ29udGFpbihcbiAgICAgIFwiL2FwaS9haS9kZWxpdmVyeS9lMmUtcmVjb3ZlcnktcmFjZS1wcm9wb3NhbC9yZXN1bWUtdmFsaWRhdGlvblwiLFxuICAgICk7XG4gICAgZXhwZWN0KGF3YWl0IHJlZ2lvbi5sb2NhdG9yKCdbZGF0YS1vcGVyYXRpb24taWQ9XCJlMmUtcmVjb3ZlcnktcmFjZS1vcGVyYXRpb25cIl0nKS5jb3VudCgpKS50b0JlKDEpO1xuICAgIGNvbnN0IHZpc2libGVUZXh0ID0gYXdhaXQgcGFnZS5sb2NhdG9yKFwiYm9keVwiKS5pbm5lclRleHQoKTtcbiAgICBleHBlY3QodmlzaWJsZVRleHQpLm5vdC50b01hdGNoKC9EbyBub3QgcmVuZGVyIHRoaXMgc2VydmVyIGRldGFpbHxcXC9ob21lXFwvcnVubmVyfFxcL3RtcFxcLy9pKTtcbiAgICBhd2FpdCBleHBlY3ROb0hvcml6b250YWxPdmVyZmxvdyhwYWdlKTtcbiAgfSk7XG5cbiAgdGVzdChcImV4cGxhaW5zIHdoZW4gYW4gb2xkIHJlY292ZXJ5IGxpbmsgcG9pbnRzIHRvIGEgZGVsZXRlZCBvcGVyYXRpb25cIiwgYXN5bmMgKHtcbiAgICBwYWdlLFxuICB9KSA9PiB7XG4gICAgY29uc3QgcmVjb3ZlcnkgPSB7XG4gICAgICByZXF1ZXN0czogW10gYXMgc3RyaW5nW10sXG4gICAgICBhY3Rpb25SZXF1ZXN0czogW10gYXMgc3RyaW5nW10sXG4gICAgICBvcGVyYXRpb25zOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBwcm9wb3NhbElkOiBcImUyZS1yZWNvdmVyeS1kZWxldGVkLXByb3Bvc2FsXCIsXG4gICAgICAgICAgb3BlcmF0aW9uSWQ6IFwiZTJlLXJlY292ZXJ5LWRlbGV0ZWQtb3BlcmF0aW9uXCIsXG4gICAgICAgICAgc2Vzc2lvbklkOiBcImUyZS1yZWNvdmVyeS1kZWxldGVkLXNlc3Npb25cIixcbiAgICAgICAgICBsaWZlY3ljbGU6IFwiYmxvY2tlZFwiLFxuICAgICAgICAgIHN0YXR1czogXCJwZW5kaW5nXCIsXG4gICAgICAgICAgY3JlYXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDU6MDAuMDAwWlwiLFxuICAgICAgICAgIHJlY292ZXJ5U3RhdGU6IFwicmVjb3ZlcmFibGVcIixcbiAgICAgICAgICBvcGVyYXRvckV4cGxhbmF0aW9uOlxuICAgICAgICAgICAgXCJUaGUgZGVsaXZlcnkgc3RvcHBlZCBiZWNhdXNlIHRoZSByZXRhaW5lZCBjaGFuZ2VzIG5lZWQgcmV2aWV3IGJlZm9yZSB2YWxpZGF0aW9uIGNhbiBjb250aW51ZS5cIixcbiAgICAgICAgICBuZXh0QWN0aW9uOlxuICAgICAgICAgICAgXCJSZXN1bWUgdmFsaWRhdGlvbiB0byByZS1jaGVjayB0aGUgc2F2ZWQgY2hhbmdlcywgb3IgZGlzY2FyZCB0aGlzIHJlY292ZXJ5IGlmIGl0IGlzIG5vIGxvbmdlciBuZWVkZWQuXCIsXG4gICAgICAgICAgY29uZmxpY3RSZWFzb246IG51bGwsXG4gICAgICAgICAgdmFsaWRhdGlvbkV2aWRlbmNlOiBbeyBwcm9maWxlOiBcIndvcmtzcGFjZS10eXBlY2hlY2tcIiwgc3RhdHVzOiBcImZhaWxlZFwiIH1dLFxuICAgICAgICAgIHdvcmtzcGFjZUF2YWlsYWJsZTogdHJ1ZSxcbiAgICAgICAgICBjaGFuZ2VDb3VudDogMSxcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgICByZWNvdmVyeUFjdGlvbjoge1xuICAgICAgICBwcm9wb3NhbElkOiBcImUyZS1yZWNvdmVyeS1kZWxldGVkLXByb3Bvc2FsXCIsXG4gICAgICAgIGFjdGlvbjogXCJyZXN1bWUtdmFsaWRhdGlvblwiIGFzIGNvbnN0LFxuICAgICAgICBzdGF0dXM6IDQwNCxcbiAgICAgICAgcmVzcG9uc2U6IHtcbiAgICAgICAgICBlcnJvcjogXCJEZWxpdmVyeSBvcGVyYXRpb24gbm90IGZvdW5kXCIsXG4gICAgICAgICAgY29kZTogXCJERUxJVkVSWV9OT1RfRk9VTkRcIixcbiAgICAgICAgICBkaWFnbm9zdGljOiBcIkRvIG5vdCByZW5kZXIgdGhpcyBzZXJ2ZXIgZGV0YWlsLlwiLFxuICAgICAgICB9LFxuICAgICAgICBuZXh0T3BlcmF0aW9uczogW10sXG4gICAgICB9LFxuICAgIH07XG4gICAgYXdhaXQgaW5zdGFsbEFwaUZpeHR1cmVzKHBhZ2UsIHsgZGVsaXZlcnlSZWNvdmVyeTogcmVjb3ZlcnkgfSk7XG4gICAgYXdhaXQgcHJvZ3JhbW1hdGljU2lnbkluKHBhZ2UpO1xuICAgIGF3YWl0IHBhZ2UuZ290byhgJHtEQVNIQk9BUkRfUEFUSH1haWApO1xuXG4gICAgY29uc3QgcmVnaW9uID0gcGFnZS5nZXRCeVJvbGUoXCJyZWdpb25cIiwge1xuICAgICAgbmFtZTogXCJSZWNvdmVyYWJsZSBkZWxpdmVyeSBvcGVyYXRpb25zXCIsXG4gICAgfSk7XG4gICAgY29uc3Qgb3BlcmF0aW9uID0gcmVnaW9uLmxvY2F0b3IoXG4gICAgICAnW2RhdGEtb3BlcmF0aW9uLWlkPVwiZTJlLXJlY292ZXJ5LWRlbGV0ZWQtb3BlcmF0aW9uXCJdJyxcbiAgICApO1xuICAgIGF3YWl0IGV4cGVjdChvcGVyYXRpb24uZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJSZXN1bWUgdmFsaWRhdGlvblwiIH0pKS50b0JlRW5hYmxlZCgpO1xuICAgIGF3YWl0IG9wZXJhdGlvbi5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIlJlc3VtZSB2YWxpZGF0aW9uXCIgfSkuY2xpY2soKTtcblxuICAgIGF3YWl0IGV4cGVjdChwYWdlLmdldEJ5VGV4dChcIlJlY292ZXJ5IGxpbmsgZXhwaXJlZFwiLCB7IGV4YWN0OiB0cnVlIH0pKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFxuICAgICAgICBcIlRoaXMgcmVjb3Zlcnkgb3BlcmF0aW9uIG5vIGxvbmdlciBleGlzdHMuIFRoZSByZWNvdmVyeSBsaXN0IHdhcyByZWZyZXNoZWQuXCIsXG4gICAgICAgIHsgZXhhY3Q6IHRydWUgfSxcbiAgICAgICksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdC5wb2xsKCgpID0+IHJlY292ZXJ5LnJlcXVlc3RzLmxlbmd0aCkudG9CZUdyZWF0ZXJUaGFuT3JFcXVhbCgyKTtcbiAgICBhd2FpdCBleHBlY3QucG9sbCgoKSA9PiByZWdpb24uY291bnQoKSkudG9CZSgwKTtcbiAgICBleHBlY3QocmVjb3ZlcnkuYWN0aW9uUmVxdWVzdHMpLnRvSGF2ZUxlbmd0aCgxKTtcbiAgICBleHBlY3QocmVjb3ZlcnkuYWN0aW9uUmVxdWVzdHNbMF0pLnRvQ29udGFpbihcbiAgICAgIFwiL2FwaS9haS9kZWxpdmVyeS9lMmUtcmVjb3ZlcnktZGVsZXRlZC1wcm9wb3NhbC9yZXN1bWUtdmFsaWRhdGlvblwiLFxuICAgICk7XG4gICAgY29uc3QgdmlzaWJsZVRleHQgPSBhd2FpdCBwYWdlLmxvY2F0b3IoXCJib2R5XCIpLmlubmVyVGV4dCgpO1xuICAgIGV4cGVjdCh2aXNpYmxlVGV4dCkubm90LnRvTWF0Y2goXG4gICAgICAvRGVsaXZlcnkgb3BlcmF0aW9uIG5vdCBmb3VuZHxEbyBub3QgcmVuZGVyIHRoaXMgc2VydmVyIGRldGFpbHxcXC9ob21lXFwvcnVubmVyfFxcL3RtcFxcLy9pLFxuICAgICk7XG4gICAgYXdhaXQgZXhwZWN0Tm9Ib3Jpem9udGFsT3ZlcmZsb3cocGFnZSk7XG4gIH0pO1xuXG4gIHRlc3QoXCJrZWVwcyB0aGUgcmVzdW1lZCBBSSBzZXNzaW9uIGRyYXdlciBvdmVybGFpZCBvbiBhIHBob25lIHZpZXdwb3J0XCIsIGFzeW5jICh7XG4gICAgcGFnZSxcbiAgfSkgPT4ge1xuICAgIGF3YWl0IHBhZ2Uuc2V0Vmlld3BvcnRTaXplKHsgd2lkdGg6IDM5MCwgaGVpZ2h0OiA4NDQgfSk7XG4gICAgY29uc3QgZml4dHVyZSA9IGF3YWl0IGluc3RhbGxBcmFiaWNBaUZpeHR1cmUocGFnZSk7XG4gICAgYXdhaXQgaW5zdGFsbEFwaUZpeHR1cmVzKHBhZ2UsIHsgYXJhYmljQWk6IGZpeHR1cmUgfSk7XG4gICAgYXdhaXQgcHJvZ3JhbW1hdGljU2lnbkluKHBhZ2UpO1xuICAgIGF3YWl0IHBhZ2UuZ290byhgJHtEQVNIQk9BUkRfUEFUSH1haWApO1xuXG4gICAgY29uc3QgY29tcG9zZXIgPSBwYWdlLmxvY2F0b3IoXCJ0ZXh0YXJlYVwiKS5maXJzdCgpO1xuICAgIGF3YWl0IGV4cGVjdChjb21wb3NlcikudG9CZVZpc2libGUoKTtcbiAgICBjb25zdCBiZWZvcmVPcGVuID0gYXdhaXQgY29tcG9zZXIuYm91bmRpbmdCb3goKTtcbiAgICBleHBlY3QoYmVmb3JlT3Blbj8ud2lkdGgpLnRvQmVHcmVhdGVyVGhhbigyNTApO1xuXG4gICAgYXdhaXQgcGFnZS5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIk9wZW4gc2Vzc2lvbnNcIiB9KS5jbGljaygpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlLmdldEJ5VGV4dChcIlNlc3Npb25zXCIsIHsgZXhhY3Q6IHRydWUgfSkpLnRvQmVWaXNpYmxlKCk7XG4gICAgY29uc3QgZHJhd2VyID0gcGFnZVxuICAgICAgLmdldEJ5VGV4dChcIlNlc3Npb25zXCIsIHsgZXhhY3Q6IHRydWUgfSlcbiAgICAgIC5sb2NhdG9yKFwiLi5cIilcbiAgICAgIC5sb2NhdG9yKFwiLi5cIik7XG4gICAgY29uc3QgZHJhd2VyQm94ID0gYXdhaXQgZHJhd2VyLmJvdW5kaW5nQm94KCk7XG4gICAgZXhwZWN0KGRyYXdlckJveD8ud2lkdGgpLnRvQmVMZXNzVGhhbk9yRXF1YWwoMzkwKTtcbiAgICBjb25zdCBkdXJpbmdPcGVuID0gYXdhaXQgY29tcG9zZXIuYm91bmRpbmdCb3goKTtcbiAgICBleHBlY3QoZHVyaW5nT3Blbj8ud2lkdGgpLnRvQmVHcmVhdGVyVGhhbigyNTApO1xuXG4gICAgYXdhaXQgcGFnZS5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIkNsb3NlIHNpZGViYXJcIiB9KS5jbGljaygpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJPcGVuIHNlc3Npb25zXCIgfSksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdE5vSG9yaXpvbnRhbE92ZXJmbG93KHBhZ2UpO1xuICB9KTtcblxuICB0ZXN0KFwicmVuZGVycyBhIHVzZXItdmlzaWJsZSBBUEkgZmFpbHVyZSBzdGF0ZVwiLCBhc3luYyAoeyBwYWdlIH0pID0+IHtcbiAgICBhd2FpdCBwYWdlLnJvdXRlKFwiKiovYXBpL2Rhc2hib2FyZFwiLCAocm91dGUpID0+XG4gICAgICByb3V0ZS5mdWxmaWxsKFxuICAgICAgICBqc29uUmVzcG9uc2UoeyBlcnJvcjogXCJjb250cm9sbGVkIGRhc2hib2FyZCBvdXRhZ2VcIiB9LCA1MDMpLFxuICAgICAgKSxcbiAgICApO1xuICAgIGF3YWl0IHByb2dyYW1tYXRpY1NpZ25JbihwYWdlKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5Um9sZShcImhlYWRpbmdcIiwgeyBuYW1lOiBcIkZhaWxlZCB0byBsb2FkIGRhc2hib2FyZFwiIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiUmV0cnkgQ29ubmVjdGlvblwiIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgfSk7XG59KTtcbiJdLCJtYXBwaW5ncyI6IjtBQUFBLFNBQVNBLE1BQU0sRUFBRUMsSUFBSSxRQUFtQixrQkFBa0I7QUFDMUQsU0FBU0MsS0FBSyxFQUFFQyxTQUFTLFFBQVEsa0JBQWtCO0FBQ25ELFNBQVNDLE9BQU8sUUFBUSxXQUFXO0FBQ25DLFNBQ0VDLDZCQUE2QixFQUM3QkMsNEJBQTRCLEVBQzVCQyw2QkFBNkIsUUFDeEIsMEJBQTBCO0FBRWpDLE1BQU1DLGNBQWMsR0FBRyxhQUFhO0FBQ3BDLE1BQU1DLFNBQVMsR0FBRztFQUNoQkMsU0FBUyxFQUFFLGVBQWU7RUFDMUJDLFFBQVEsRUFBRSxpQkFBaUI7RUFDM0JDLEtBQUssR0FBQUMscUJBQUEsR0FDSEMsT0FBTyxDQUFDQyxHQUFHLENBQUNDLG1CQUFtQixjQUFBSCxxQkFBQSxjQUFBQSxxQkFBQSxHQUMvQjtBQUNKLENBQUM7QUFDRCxNQUFNSSxZQUFZLEdBQUcsMEJBQTBCO0FBQy9DLE1BQU1DLHVCQUF1QixHQUFHLE1BQU87QUFDdkMsTUFBTUMsMkJBQTJCLEdBQUcsSUFBSztBQUN6QyxNQUFNQyxjQUFjLEdBQUcsMEJBQTBCO0FBQ2pELE1BQU1DLHlCQUF5QixHQUFHLENBQ2hDLDZCQUE2QixFQUM3Qiw4QkFBOEIsRUFDOUIsOEJBQThCLEVBQzlCLE1BQU0sQ0FDRTtBQUNWLE1BQU1DLG1CQUFtQixHQUN2QixxRkFBcUYsR0FDckYsd0ZBQXdGLEdBQ3hGLDBFQUEwRTtBQUM1RSxNQUFNQyx1QkFBdUIsR0FBRyxJQUFJQyxHQUFHLENBQUMsQ0FDdEMsaUJBQWlCLEVBQ2pCLGtCQUFrQixFQUNsQixrQkFBa0IsQ0FDbkIsQ0FBQztBQUVGLFNBQVNDLG9CQUFvQkEsQ0FBQSxFQUF1QjtFQUFBLElBQUFDLHNCQUFBO0VBQ2xE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