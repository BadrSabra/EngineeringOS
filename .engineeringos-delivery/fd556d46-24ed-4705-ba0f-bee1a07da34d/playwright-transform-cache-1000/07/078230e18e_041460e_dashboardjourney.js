// 208271222cf6d0becd1544b716159dd90af5dd99
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
        freshnessRevision: "2026-01-01T00:03:00.000Z",
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJleHBlY3QiLCJ0ZXN0IiwibWtkaXIiLCJ3cml0ZUZpbGUiLCJkaXJuYW1lIiwicGFyc2VDbGVya1NpZ25JblRva2VuUmVzcG9uc2UiLCJwYXJzZUNsZXJrVXNlckxvb2t1cFJlc3BvbnNlIiwicGFyc2VDcmVhdGVkQ2xlcmtVc2VyUmVzcG9uc2UiLCJEQVNIQk9BUkRfUEFUSCIsIlRFU1RfVVNFUiIsImZpcnN0TmFtZSIsImxhc3ROYW1lIiwiZW1haWwiLCJfcHJvY2VzcyRlbnYkREFTSEJPQVIiLCJwcm9jZXNzIiwiZW52IiwiREFTSEJPQVJEX0UyRV9FTUFJTCIsIkVYRUNVVElPTl9JRCIsIkRFRkFVTFRfTElWRV9USU1FT1VUX01TIiwiTElWRV9URVNUX1RJTUVPVVRfTUFSR0lOX01TIiwiSE9TVElMRV9PUklHSU4iLCJPUklHSU5fRElBR05PU1RJQ19IRUFERVJTIiwiREVGQVVMVF9MSVZFX1BST01QVCIsIkxJVkVfQ0FNUEFJR05fU0NFTkFSSU9TIiwiU2V0IiwibGl2ZUNhbXBhaWduU2NlbmFyaW8iLCJfcHJvY2VzcyRlbnYkREFTSEJPQVIyIiwic2NlbmFyaW8iLCJEQVNIQk9BUkRfRTJFX0xJVkVfU0NFTkFSSU8iLCJ0cmltIiwiREFTSEJPQVJEX0UyRV9MSVZFX0NBTVBBSUdOIiwiRXJyb3IiLCJoYXMiLCJsaXZlUHJvbXB0IiwiX3Byb2Nlc3MkZW52JERBU0hCT0FSMyIsIkRBU0hCT0FSRF9FMkVfTElWRV9QUk9NUFQiLCJsaXZlVGltZW91dE1zIiwiY29uZmlndXJlZCIsIk51bWJlciIsIkRBU0hCT0FSRF9FMkVfTElWRV9USU1FT1VUX01TIiwiaXNGaW5pdGUiLCJhcHByb3ZlZERhc2hib2FyZE9yaWdpbnMiLCJfcHJvY2VzcyRlbnYkREFTSEJPQVI0Iiwib3JpZ2lucyIsIkRBU0hCT0FSRF9FMkVfQVBQUk9WRURfT1JJR0lOUyIsInNwbGl0IiwibWFwIiwib3JpZ2luIiwiZmlsdGVyIiwiQm9vbGVhbiIsImxlbmd0aCIsInBhcnNlZCIsIlVSTCIsInBhdGhuYW1lIiwic2VhcmNoIiwiaGFzaCIsImRhc2hib2FyZEZpeHR1cmUiLCJmcmVzaG5lc3NSZXZpc2lvbiIsInByb2plY3RDb3VudCIsImFjdGl2ZVRhc2tDb3VudCIsImNvbXBsZXRlZFRhc2tDb3VudCIsImZhaWxlZFRhc2tDb3VudCIsInRhc2tTdGF0dXNCcmVha2Rvd24iLCJwZW5kaW5nIiwicnVubmluZyIsInByb2plY3RTY29yZXMiLCJwcm9qZWN0SWQiLCJwcm9qZWN0TmFtZSIsInNjb3JlIiwidHJlbmQiLCJyZWNlbnRFdmVudHMiLCJpZCIsInR5cGUiLCJzZXZlcml0eSIsIm1lc3NhZ2UiLCJ0aW1lc3RhbXAiLCJ0b3BSdWxlcyIsImV4ZWN1dGlvbkZpeHR1cmUiLCJvcGVyYXRpb25JZCIsInN0YXR1cyIsImZsaWdodFN0YXRlIiwiZXZpZGVuY2VWZXJkaWN0IiwicHJvb2ZSZXF1aXJlZCIsInJlc3VtYWJsZSIsImNoZWNrcG9pbnRWZXJzaW9uIiwicHJvamVjdFJldmlzaW9uIiwiY2hlY2twb2ludCIsInN0YWdlIiwiZGV0YWlsIiwib2JqZWN0aXZlIiwic3RhcnRlZEF0IiwiY29tcGxldGVkQXQiLCJjcmVhdGVkQXQiLCJ1cGRhdGVkQXQiLCJqc29uUmVzcG9uc2UiLCJib2R5IiwiaGVhZGVycyIsImNvbnRlbnRUeXBlIiwiSlNPTiIsInN0cmluZ2lmeSIsImV4cGVjdE5vSG9yaXpvbnRhbE92ZXJmbG93IiwicGFnZSIsIm92ZXJmbG93IiwiZXZhbHVhdGUiLCJkb2N1bWVudCIsImRvY3VtZW50RWxlbWVudCIsInNjcm9sbFdpZHRoIiwidmlld3BvcnQiLCJ3aW5kb3ciLCJpbm5lcldpZHRoIiwidG9CZUxlc3NUaGFuT3JFcXVhbCIsImV4cGVjdERhc2hib2FyZFJlYWR5IiwiZ2V0QnlSb2xlIiwibmFtZSIsInRvQmVWaXNpYmxlIiwiZ2V0QnlUZXh0IiwiZXhhY3QiLCJyZXN0YXJ0QXBpRm9yQ2FtcGFpZ24iLCJjb250cm9sVXJsIiwiREFTSEJPQVJEX0UyRV9DT05UUk9MX1VSTCIsInJlc3BvbnNlIiwicmVxdWVzdCIsInBvc3QiLCJ0aW1lb3V0IiwidG9CZSIsImluc3RhbGxBcGlGaXh0dXJlcyIsIm92ZXJyaWRlcyIsInJvdXRlIiwiX3JlZiIsIl9vdmVycmlkZXMkZGVsaXZlcnlSZSIsIl9vdmVycmlkZXMkYXVkaXRFeHBvcjIiLCJfb3ZlcnJpZGVzJGF1ZGl0RXhwb3IzIiwidXJsIiwicGF0aCIsInJlcGxhY2UiLCJhcmFiaWNBaSIsImFsdGVybmF0ZUFpIiwiZGlzY29ubmVjdEFpIiwiYWlGaXh0dXJlcyIsImZpeHR1cmUiLCJoYXNDb25maWd1cmVkQWlGaXh0dXJlIiwicmVzdW1lRmFpbHVyZSIsImludGVycnVwdGVkUmVzdW1lIiwiZW5kc1dpdGgiLCJzZWFyY2hQYXJhbXMiLCJnZXQiLCJwcm9qZWN0U2Vzc2lvbnMiLCJmdWxmaWxsIiwic2Vzc2lvbklkIiwidGl0bGUiLCJxdWVzdGlvbiIsInJlcXVlc3RCb2R5IiwicG9zdERhdGFKU09OIiwiZXhlY3V0aW9uSWQiLCJzdHJlYW1Cb2R5IiwicmVzdW1lZFN0cmVhbUJvZHkiLCJyZXF1ZXN0ZWRNZXNzYWdlIiwic3RyZWFtRml4dHVyZSIsImZpbmQiLCJpbmNsdWRlcyIsIm1lc3NhZ2VGaXh0dXJlIiwicm9sZSIsImNvbnRlbnQiLCJhdWRpdEV4cG9ydCIsIl9vdmVycmlkZXMkYXVkaXRFeHBvciIsIm91dGNvbWUiLCJtZXNzYWdlT3V0Y29tZSIsInRhc2tBY3Rpb25zIiwidmVyaWZpY2F0aW9uTWF0Y2giLCJtYXRjaCIsIm1ldGhvZCIsIl9wbGFuJHZlcmlmaWNhdGlvbkNoZSIsIl9wbGFuJHZlcmlmaWNhdGlvblN0ZSIsIl9vdmVycmlkZXMkdGFza0FjdGlvbiIsIl90YXNrJHZlcmlmaWNhdGlvblJlcyIsIl9wcmlvclJlc3VsdCRzdGVwcyIsIl9wcmlvclJlc3VsdCRoaXN0b3J5IiwiX3ByaW9yUmVzdWx0JGhpc3RvcnkyIiwiX2NoZWNrJGtpbmQiLCJfcHJpb3JSZXN1bHQkaGlzdG9yeTMiLCJ0YXNrSWQiLCJ0YXNrIiwidGFza3MiLCJjYW5kaWRhdGUiLCJlcnJvciIsInBsYW4iLCJyZW1lZGlhdGlvblBsYW4iLCJjaGVja3MiLCJ2ZXJpZmljYXRpb25DaGVja3MiLCJ2ZXJpZmljYXRpb25TdGVwcyIsImd1aWRhbmNlIiwiaW5kZXgiLCJraW5kIiwiY2hlY2siLCJjaGVja0lkIiwicmVhc29uIiwicGFzc2VkIiwiZXZpZGVuY2UiLCJ2ZXJpZmljYXRpb25SZXF1ZXN0cyIsInB1c2giLCJwcmlvclJlc3VsdCIsInZlcmlmaWNhdGlvblJlc3VsdCIsInByaW9yU3RlcHMiLCJzdGVwcyIsIl9jYW5kaWRhdGUka2luZDIiLCJwcmlvciIsInN0ZXAiLCJfY2FuZGlkYXRlJGtpbmQiLCJTdHJpbmciLCJvdXRwdXQiLCJjb21wbGV0ZWQiLCJldmVyeSIsIl9zdGVwJGV2aWRlbmNlIiwiZGVjaXNpb24iLCJoaXN0b3J5IiwiYWN0b3IiLCJyZWNvcmRlZEF0IiwiYWN0aW9uTWF0Y2giLCJhY3Rpb24iLCJyZXF1ZXN0cyIsIl90YXNrJHJldHJ5Q291bnQiLCJyZXRyeUNvdW50IiwiX3JlZjIiLCJfb3ZlcnJpZGVzJHRhc2tBY3Rpb24yIiwiX292ZXJyaWRlcyR0YXNrQWN0aW9uMyIsInJlY292ZXJ5VGFza3MiLCJsaXZlVGFzayIsImRlc2NyaXB0aW9uIiwicHJpb3JpdHkiLCJyZWxhdGVkRmlsZXMiLCJtYXhSZXRyaWVzIiwiX292ZXJyaWRlcyRyZWNvdmVyeVdvIiwicmVjb3ZlcnlXb3JrZmxvd3MiLCJ3b3JrZmxvd0V4ZWN1dGlvbnNNYXRjaCIsIl9vdmVycmlkZXMkcmVjb3ZlcnlXbzIiLCJfb3ZlcnJpZGVzJHJlY292ZXJ5V28zIiwicmVjb3ZlcnlXb3JrZmxvd0V4ZWN1dGlvbnMiLCJmYWlsRmlyc3RQcmV2aWV3IiwiZmlsZW5hbWUiLCJhcmNoaXZlVXBsb2FkIiwiX3JvdXRlJHJlcXVlc3QkaGVhZGVyIiwic3RhcnRzV2l0aCIsInBvc3REYXRhQnVmZmVyIiwiQnVmZmVyIiwiZnJvbSIsInVwbG9hZElkIiwib3JpZ2luYWxOYW1lIiwicGhhc2UiLCJfb3ZlcnJpZGVzJGxpdmVUYXNrJGkiLCJpbml0aWFsTG9ncyIsInN0cmVhbVJlcXVlc3RzIiwiZmFpbEZpcnN0U3RyZWFtIiwiZmFpbFN0cmVhbUF0dGVtcHRzIiwiYWJvcnQiLCJsb2ciLCJfb3ZlcnJpZGVzJHByb2plY3RzIiwicHJvamVjdHMiLCJsYW5ndWFnZSIsImZyYW1ld29yayIsInJvb3RQYXRoIiwicXVhbGl0eVNjb3JlIiwicHJvdmlkZXIiLCJkZWxpdmVyeVJlY292ZXJ5Iiwib3BlcmF0aW9ucyIsInJlY292ZXJ5QWN0aW9uIiwicHJvcG9zYWxJZCIsIl9vdmVycmlkZXMkZGVsaXZlcnlSZTIiLCJfb3ZlcnJpZGVzJGRlbGl2ZXJ5UmUzIiwiYWN0aW9uUmVxdWVzdHMiLCJuZXh0T3BlcmF0aW9ucyIsIl9vdmVycmlkZXMkZXZlbnRzIiwiX3VybCRzZWFyY2hQYXJhbXMkZ2V0IiwiZXZlbnRzIiwidG9Mb3dlckNhc2UiLCJmaWx0ZXJlZEV2ZW50cyIsImV2ZW50IiwiY29ycmVsYXRpb25JZCIsInZhbHVlIiwic29tZSIsImxpbWl0Iiwic2xpY2UiLCJ0b3RhbCIsImV4ZWN1dGlvbiIsInJlc3VtZVRva2VuIiwicmVjb3ZlcmVkVG9rZW4iLCJleGVjdXRpb25zIiwiY29udGludWUiLCJpbnN0YWxsQXJhYmljQWlGaXh0dXJlIiwib3B0aW9ucyIsIl9vcHRpb25zJHNlc3Npb25JZCIsIl9vcHRpb25zJHF1ZXN0aW9uIiwibWVzc2FnZUlkIiwic291cmNlIiwiYmxvY2tlZCIsImFuc3dlciIsImV4Y2VycHQiLCJzdXBwb3J0c0NsYWltIiwiZXZpZGVuY2VDbGFzcyIsImNpdGF0aW9uU3RhdHVzIiwiY2l0YXRpb25SZWFzb24iLCJzb3VyY2VTcGFuIiwic3RhcnRMaW5lIiwiZW5kTGluZSIsInRvb2xUcmFjZSIsInRvb2wiLCJhcmdzIiwiY2FjaGVkIiwicHJlZmV0Y2hlZCIsImNvZGUiLCJjb25zaXN0ZW50IiwidmlvbGF0aW9ucyIsImV2aWRlbmNlRmlsZUNvdW50IiwiYWNjZXB0ZWRFdmlkZW5jZUNvdW50IiwiY29tcGxldGVkUmVhZEZpbGVzIiwiYWNjZXB0ZWRFdmlkZW5jZUZpbGVzIiwib2JqZWN0aXZlVHlwZSIsInJlcXVpcmVkRWRnZXMiLCJwcm92ZW5FZGdlcyIsImNvbXBsZXRpb25HYXRlUmVzdWx0IiwiZmluYWxBbnN3ZXJUeXBlIiwidGFza1Jlc3VsdCIsImNvbmZpZGVuY2UiLCJzb3VyY2VTY29wZSIsImNvdmVyYWdlIiwicmVxdWVzdGVkRmllbGRzIiwiYW5zd2VyZWRGaWVsZHMiLCJtaXNzaW5nRmllbGRzIiwiY29tcGxldGUiLCJvcGVyYXRpb25Nb2RlIiwic291cmNlcyIsImJlaGF2aW9yRXZpZGVuY2UiLCJzc2UiLCJkZWx0YSIsInBlbmRpbmdDaGFuZ2VzIiwiam9pbiIsImluc3RhbGxUb29sRmFpbHVyZUZpeHR1cmUiLCJkaWFnbm9zdGljQ29kZSIsInJlc3VsdEtpbmQiLCJyZXN1bHRTdW1tYXJ5Iiwic3RvcFJlYXNvbiIsIml0ZXJhdGlvbnMiLCJtYXhJdGVyYXRpb25zIiwidG9vbENhbGxzIiwicHJlZmV0Y2hUb29sQ2FsbHMiLCJsb29wVG9vbENhbGxzIiwic3ludGhlc2lzU3RhcnRlZCIsImRpYWdub3N0aWNDb2RlcyIsImluc3RhbGxEaXNjb25uZWN0ZWRBaUZpeHR1cmUiLCJkaWFnbm9zdGljRGV0YWlscyIsImVycm9yQ29kZSIsImVycm9yTWVzc2FnZSIsImluc3RhbGxSZXN1bWVkQW5hbHlzaXNGYWlsdXJlRml4dHVyZSIsImluc3RhbGxJbnRlcnJ1cHRlZFJlc3VtZUZpeHR1cmUiLCJpbml0aWFsVG9rZW4iLCJwYXJ0aWFsQW5zd2VyIiwiY3JlYXRlUmVsZWFzZVNpZ25JblVybCIsInNlY3JldEtleSIsIkNMRVJLX1NFQ1JFVF9LRVkiLCJBdXRob3JpemF0aW9uIiwidXNlclJlc3BvbnNlIiwiZW5jb2RlVVJJQ29tcG9uZW50IiwidXNlcklkIiwianNvbiIsImNyZWF0ZWRSZXNwb25zZSIsImRhdGEiLCJlbWFpbF9hZGRyZXNzIiwiZmlyc3RfbmFtZSIsImxhc3RfbmFtZSIsInNraXBfcGFzc3dvcmRfY2hlY2tzIiwic2tpcF9wYXNzd29yZF9yZXF1aXJlbWVudCIsInRva2VuUmVzcG9uc2UiLCJ1c2VyX2lkIiwidG9rZW4iLCJ0b1N0cmluZyIsInByb2dyYW1tYXRpY1NpZ25JbiIsIl9nbG9iYWxUaGlzJHNpZ25JbkNsZSIsImdvdG8iLCJoZWxwZXIiLCJnbG9iYWxUaGlzIiwic2lnbkluQ2xlcmtVc2VyIiwiX19FTkdJTkVFUklOR09TX1NJR05fSU5fQ0xFUktfVVNFUl9fIiwiUlVOX0NPTlRST0xMRURfUkVMRUFTRV9WQUxJREFUSU9OIiwidG9IYXZlVVJMIiwiUmVnRXhwIiwicmVwbGFjZUFsbCIsInNpZ25JblVybCIsInR0bCIsImJhc2VQYXRoIiwib3Blbk5hdmlnYXRpb24iLCJsYWJlbCIsImNsaWNrIiwiYXBpVXJsIiwiYXBpQmFzZVVybCIsIkRBU0hCT0FSRF9FMkVfQVBJX0JBU0VfVVJMIiwibGl2ZVJlcXVlc3QiLCJfb3B0aW9ucyRtZXRob2QiLCJmZXRjaCIsImNyZWRlbnRpYWxzIiwidW5kZWZpbmVkIiwic2lnbmFsIiwiQWJvcnRTaWduYWwiLCJ0ZXh0IiwicmVjb3JkZWRPcmlnaW5EaWFnbm9zdGljcyIsIm9yaWdpbkRpYWdub3N0aWNQYXRoIiwiREFTSEJPQVJEX0UyRV9PUklHSU5fRElBR05PU1RJQ1NfUEFUSCIsInJlbGV2YW50T3JpZ2luSGVhZGVycyIsIk9iamVjdCIsImZyb21FbnRyaWVzIiwiZmxhdE1hcCIsIndyaXRlT3JpZ2luRGlhZ25vc3RpY3MiLCJvdXRwdXRQYXRoIiwicmVjdXJzaXZlIiwiZGlhZ25vc3RpY3MiLCJleHBlY3RPcmlnaW5DYW5Vc2VBcGkiLCJoZWFsdGhVcmwiLCJtdXRhdGlvblVybCIsImNvbW1vbkhlYWRlcnMiLCJPcmlnaW4iLCJhc3NlcnRpb24iLCJhdCIsImN1cnJlbnQiLCJfcmVzcG9uc2UkaGVhZGVycyRhY2MiLCJfcmVzcG9uc2UkaGVhZGVycyRhY2MyIiwidG9VcHBlckNhc2UiLCJ0b0NvbnRhaW4iLCJoZWFkZXIiLCJub3QiLCJleHBlY3RIb3N0aWxlT3JpZ2luUmVqZWN0ZWQiLCJ1cGxvYWRVcmwiLCJsaXZlVXBkYXRlVXJsIiwiZGlhZ25vc3RpYyIsInRvQmVVbmRlZmluZWQiLCJob3N0aWxlVXBsb2FkIiwibXVsdGlwYXJ0IiwiYXJjaGl2ZSIsIm1pbWVUeXBlIiwiYnVmZmVyIiwiaG9zdGlsZUxpdmVVcGRhdGUiLCJwYXJzZVNzZSIsImNodW5rIiwiX2NodW5rJHNwbGl0JGZpbmQiLCJsaW5lIiwicGFyc2UiLCJsaXZlSnNvbiIsImxpdmVBcnJheSIsIkFycmF5IiwiaXNBcnJheSIsImxpdmVPcHRpb25hbFJlY29yZCIsImRlc2NyaWJlIiwiX2V4ZWN1dGlvbiRvcGVyYXRpb25JIiwiX2V4ZWN1dGlvbiRmbGlnaHRTdGF0IiwiX2dpdExvZyRjb21taXRzJDAkc2hvIiwiX2dpdExvZyRjb21taXRzIiwiX2dpdExvZyRjb21taXRzMiIsIl9wcm9jZXNzJGVudiREQVNIQk9BUjUiLCJzZXRUaW1lb3V0Iiwic2tpcCIsIkRBU0hCT0FSRF9FMkVfTElWRV9QUk9WSURFUiIsIkRBU0hCT0FSRF9FMkVfTElWRV9ESVNQT1NBQkxFIiwiY2FtcGFpZ25TY2VuYXJpbyIsIkRBU0hCT0FSRF9FMkVfTElWRV9QUk9KRUNUX0lEIiwic3RyZWFtUmVzcG9uc2UiLCJpZGVtcG90ZW5jeUtleSIsIkRhdGUiLCJub3ciLCJzc2VFdmVudHMiLCJzdGFydGVkIiwiZGVhZGxpbmUiLCJQcm9taXNlIiwicmVzb2x2ZSIsIm1lc3NhZ2VzIiwicHJvcG9zYWwiLCJnaXRMb2ciLCJtaXNzaW9uQ29udHJvbCIsImRhc2hib2FyZFN0YXRlIiwicmVjZW50U3RlcHMiLCJ2YWxpZGF0aW9uIiwiY2FuZGlkYXRlSGFzaCIsIl9zdGVwJHZhbGlkYXRpb24kY2FuZCIsIl9zdGVwJHZhbGlkYXRpb24iLCJjYW5kaWRhdGVJZGVudGl0eSIsImV2aWRlbmNlQ291bnQiLCJyZWR1Y2UiLCJjb3VudCIsInRlcm1pbmFsU3RhdGUiLCJzdWNjZXNzU3RhdGVzIiwiZGVsaXZlcnlTdGFnZXMiLCJhcHBsaWVkIiwiY29tbWl0dGVkIiwicHVzaGVkIiwidmFsdWVzIiwiY2FwdHVyZSIsIndvcmtzcGFjZVJldmlzaW9uIiwiY29tbWl0cyIsInNob3J0SGFzaCIsImNhbmRpZGF0ZVJldmlzaW9uIiwiY3VycmVudE9wZXJhdGlvbiIsInJldmlzaW9uIiwicmV0YWluZWRSZXN1bHQiLCJtZXNzYWdlU2Vzc2lvbiIsIm1lc3NhZ2VFeGVjdXRpb24iLCJldmVudEV4ZWN1dGlvbiIsImV2ZW50U2Vzc2lvbiIsImNoZWNrcG9pbnRzIiwic2VxdWVuY2UiLCJwcm9wb3NhbHMiLCJfc3RlcCR2YWxpZGF0aW9uJHN0YXQiLCJfc3RlcCR2YWxpZGF0aW9uMiIsIl9zdGVwJHZhbGlkYXRpb24kcHJvZiIsIl9zdGVwJHZhbGlkYXRpb24zIiwicHJvZmlsZSIsInZhbGlkYXRpb25Qcm9maWxlIiwiZGFzaGJvYXJkIiwiREFTSEJPQVJEX0UyRV9MSVZFX1JFUE9SVF9QQVRIIiwiZmlyc3QiLCJyYXdEaWFnbm9zdGljIiwicmF3Q3JlZGVudGlhbCIsInN1cHBvcnRSZWZlcmVuY2VzIiwiYXV0aGVudGljYXRpb25fZmFpbGVkIiwicXVvdGFfZXhoYXVzdGVkIiwicHJvdmlkZXJfb3V0YWdlIiwiYWdlbnRSZXNwb25zZSIsInRlcm1pbmFsU3RhdHVzIiwiYXZhaWxhYmlsaXR5U3RhdGUiLCJvcGVyYXRvckFjdGlvbiIsIm1vZGVsIiwidGVybWluYWxSZWFzb24iLCJ3b3JrZmxvd0lkIiwicGhhc2VzIiwiY3VycmVudFBoYXNlIiwiZXhlY3V0aW9uQ291bnQiLCJjb21wbGV0ZWRQaGFzZXMiLCJyZWNvdmVyeSIsImdldEJ5TGFiZWwiLCJ0YXNrRGV0YWlscyIsImxvY2F0b3IiLCJ0b0NvbnRhaW5UZXh0IiwicmVsb2FkIiwicmVsb2FkZWRBdXRoRGV0YWlscyIsInJlbG9hZGVkVGFza1RleHQiLCJpbm5lclRleHQiLCJ0b01hdGNoIiwicmVsb2FkZWRFeGVjdXRpb24iLCJ2aXNpYmxlVGV4dCIsInJhd1Byb21wdCIsInJlYWR5VGFza0lkIiwicmV2aWV3VGFza0lkIiwidmVyaWZpY2F0aW9uVGFza0lkIiwicmVtZWRpYXRpb25UYXNrcyIsInByb21wdCIsInZlcnNpb24iLCJydWxlSWQiLCJydWxlQ29kZSIsInJ1bGVUaXRsZSIsIm9jY3VycmVuY2VDb3VudCIsImZpbGUiLCJzbmlwcGV0Iiwib2NjdXJyZW5jZXMiLCJmaXhEZXNjcmlwdGlvbiIsImNvbXBsZXRlbmVzcyIsInJlYWR5Um93IiwiZ2V0QnlUaXRsZSIsInJlYWR5RGV0YWlscyIsInJlYWR5UGxhbiIsInBvbGwiLCJ0b0hhdmVDb3VudCIsInJldmlld1JvdyIsInJldmlld0RldGFpbHMiLCJyZXZpZXdQbGFuIiwidmVyaWZpY2F0aW9uUm93IiwidmVyaWZpY2F0aW9uRGV0YWlscyIsInZlcmlmaWNhdGlvblBsYW4iLCJmaXJzdEd1aWRhbmNlIiwic2Vjb25kR3VpZGFuY2UiLCJmaXJzdEV2aWRlbmNlIiwic2Vjb25kRXZpZGVuY2UiLCJwYXNzQnV0dG9ucyIsImZhaWxlZEJ1dHRvbnMiLCJudGgiLCJ0b0JlRGlzYWJsZWQiLCJmaWxsIiwidG9NYXRjaE9iamVjdCIsInJlbG9hZGVkVmVyaWZpY2F0aW9uUm93IiwicmVsb2FkZWREZXRhaWxzIiwiYnJvd3NlciIsInNlY29uZENvbnRleHQiLCJuZXdDb250ZXh0Iiwic2Vjb25kUGFnZSIsIm5ld1BhZ2UiLCJhbGwiLCJjdXJyZW50RGFzaGJvYXJkRml4dHVyZSIsInJlZnJlc2hDb3VudCIsInJlbGVhc2VTdGFsZVJlc3BvbnNlIiwic3RhbGVSZXNwb25zZVJlbGVhc2VkIiwic3RhbGVSZWZyZXNoIiwicmVjb25uZWN0QXR0ZW1wdCIsInVucm91dGUiLCJjbG9zZSIsImF1ZGl0UmVxdWVzdHMiLCJhdWRpdEJvZHkiLCJmb3JtYXQiLCJleHBvcnRlZEF0IiwicHJvb2YiLCJyZXF1aXJlZCIsInZlcmRpY3QiLCJ0aW1lbGluZSIsInZhbGlkYXRpb25zIiwiYWZmZWN0ZWRGaWxlcyIsInJlZGFjdGlvbiIsImV4Y2x1ZGVkIiwibG9jYWxTdG9yYWdlIiwic2V0SXRlbSIsInByZXZpZXciLCJ0b0hhdmVMZW5ndGgiLCJ0b0JlSGlkZGVuIiwiZG93bmxvYWRQcm9taXNlIiwid2FpdEZvckV2ZW50IiwiZG93bmxvYWQiLCJzdWdnZXN0ZWRGaWxlbmFtZSIsInJlbG9hZGVkUHJvb2YiLCJjYW5jZWxsZWRFeGVjdXRpb24iLCJfcHJvY2VzcyRlbnYkREFTSEJPQVI2IiwibGl2ZUxvZyIsImxldmVsIiwidXBsb2FkUmVzdWx0IiwiYnl0ZXMiLCJVaW50OEFycmF5IiwiYXRvYiIsImNoYXJhY3RlciIsImNoYXJDb2RlQXQiLCJGb3JtRGF0YSIsImFwcGVuZCIsIkJsb2IiLCJ0b0VxdWFsIiwidGFza1JvdyIsIm1ldGFkYXRhIiwiYWN0aXZpdHkiLCJoYXNUZXh0Iiwibm9uU3RyZWFtUmVxdWVzdHMiLCJvbiIsImV4aGF1c3RlZCIsInNpemUiLCJfIiwiVVRDIiwidG9JU09TdHJpbmciLCJldmVudFJlcXVlc3RzIiwiZmlyc3RSZXF1ZXN0Iiwid2FpdEZvclJlcXVlc3QiLCJnZXRCeVBsYWNlaG9sZGVyIiwic2VsZWN0T3B0aW9uIiwidG9IYXZlVmFsdWUiLCJmaWx0ZXJlZFJlcXVlc3QiLCJjb21wb3NlciIsInNlbmRCdXR0b24iLCJ0b0JlRW5hYmxlZCIsInN0cmVhbVJlc3BvbnNlUHJvbWlzZSIsIndhaXRGb3JSZXNwb25zZSIsImxhc3QiLCJzZXRWaWV3cG9ydFNpemUiLCJ3aWR0aCIsImhlaWdodCIsImFjY2VwdGVkIiwiYXNzZXJ0QWNjZXB0ZWRDaXRhdGlvbiIsImFzc2VydEJsb2NrZWRDaXRhdGlvbiIsImFzc2VydE5vSW50ZXJuYWxDaXRhdGlvbkRldGFpbHMiLCJnb0JhY2siLCJnb0ZvcndhcmQiLCJfYXdhaXQkcmVzdW1lUmVxdWVzdCQiLCJyZXN1bWVSZXF1ZXN0IiwicG9zdERhdGEiLCJvYmplY3RDb250YWluaW5nIiwiX3N0cmVhbVJlcXVlc3RzJCIsIl9zdHJlYW1SZXF1ZXN0cyQyIiwiYWRkSW5pdFNjcmlwdCIsIm5hdGl2ZUZldGNoIiwiYmluZCIsImlucHV0IiwiaW5pdCIsIlJlcXVlc3QiLCJyZWFkZXIiLCJnZXRSZWFkZXIiLCJlbmNvZGVyIiwiVGV4dEVuY29kZXIiLCJzdHJlYW0iLCJSZWFkYWJsZVN0cmVhbSIsInN0YXJ0IiwiY29udHJvbGxlciIsImJ1ZmZlcmVkIiwiZG9uZSIsInJlYWQiLCJlbnF1ZXVlIiwiZW5jb2RlIiwiVGV4dERlY29kZXIiLCJkZWNvZGUiLCJtYXJrZXIiLCJpbmRleE9mIiwiZnJhbWVFbmQiLCJUeXBlRXJyb3IiLCJSZXNwb25zZSIsInN0YXR1c1RleHQiLCJzdG9yYWdlS2V5IiwicG9pbnRlcktleSIsImtleSIsImdldEl0ZW0iLCJfbG9jYWxTdG9yYWdlJGdldEl0ZW0iLCJzYXZlZCIsIl9sb2NhbFN0b3JhZ2UkZ2V0SXRlbTIiLCJsaWZlY3ljbGUiLCJyZWNvdmVyeVN0YXRlIiwib3BlcmF0b3JFeHBsYW5hdGlvbiIsIm5leHRBY3Rpb24iLCJjb25mbGljdFJlYXNvbiIsInZhbGlkYXRpb25FdmlkZW5jZSIsIndvcmtzcGFjZUF2YWlsYWJsZSIsImNoYW5nZUNvdW50IiwicmVnaW9uIiwiYXZhaWxhYmxlIiwibWlzc2luZyIsImRpc2NhcmRlZCIsInRvSGF2ZUF0dHJpYnV0ZSIsInJlbG9hZGVkUmVnaW9uIiwidG9CZUdyZWF0ZXJUaGFuT3JFcXVhbCIsIm9wZXJhdGlvbiIsImJlZm9yZU9wZW4iLCJib3VuZGluZ0JveCIsInRvQmVHcmVhdGVyVGhhbiIsImRyYXdlciIsImRyYXdlckJveCIsImR1cmluZ09wZW4iXSwic291cmNlcyI6WyJkYXNoYm9hcmQuam91cm5leS50cyJdLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBleHBlY3QsIHRlc3QsIHR5cGUgUGFnZSB9IGZyb20gXCJAcGxheXdyaWdodC90ZXN0XCI7XG5pbXBvcnQgeyBta2Rpciwgd3JpdGVGaWxlIH0gZnJvbSBcIm5vZGU6ZnMvcHJvbWlzZXNcIjtcbmltcG9ydCB7IGRpcm5hbWUgfSBmcm9tIFwibm9kZTpwYXRoXCI7XG5pbXBvcnQge1xuICBwYXJzZUNsZXJrU2lnbkluVG9rZW5SZXNwb25zZSxcbiAgcGFyc2VDbGVya1VzZXJMb29rdXBSZXNwb25zZSxcbiAgcGFyc2VDcmVhdGVkQ2xlcmtVc2VyUmVzcG9uc2UsXG59IGZyb20gXCIuLi9zcmMvbGliL2NsZXJrLWhhbmRvZmZcIjtcblxuY29uc3QgREFTSEJPQVJEX1BBVEggPSBcIi9kYXNoYm9hcmQvXCI7XG5jb25zdCBURVNUX1VTRVIgPSB7XG4gIGZpcnN0TmFtZTogXCJFbmdpbmVlcmluZ09TXCIsXG4gIGxhc3ROYW1lOiBcIkRhc2hib2FyZCBTbW9rZVwiLFxuICBlbWFpbDpcbiAgICBwcm9jZXNzLmVudi5EQVNIQk9BUkRfRTJFX0VNQUlMID8/XG4gICAgXCJlbmdpbmVlcmluZ29zLWRhc2hib2FyZC1zbW9rZUBleGFtcGxlLmNvbVwiLFxufTtcbmNvbnN0IEVYRUNVVElPTl9JRCA9IFwiZTJlLWNvbnRyb2xsZWQtZXhlY3V0aW9uXCI7XG5jb25zdCBERUZBVUxUX0xJVkVfVElNRU9VVF9NUyA9IDEyMF8wMDA7XG5jb25zdCBMSVZFX1RFU1RfVElNRU9VVF9NQVJHSU5fTVMgPSA1XzAwMDtcbmNvbnN0IEhPU1RJTEVfT1JJR0lOID0gXCJodHRwczovL2F0dGFja2VyLmV4YW1wbGVcIjtcbmNvbnN0IE9SSUdJTl9ESUFHTk9TVElDX0hFQURFUlMgPSBbXG4gIFwiYWNjZXNzLWNvbnRyb2wtYWxsb3ctb3JpZ2luXCIsXG4gIFwiYWNjZXNzLWNvbnRyb2wtYWxsb3ctbWV0aG9kc1wiLFxuICBcImFjY2Vzcy1jb250cm9sLWFsbG93LWhlYWRlcnNcIixcbiAgXCJ2YXJ5XCIsXG5dIGFzIGNvbnN0O1xuY29uc3QgREVGQVVMVF9MSVZFX1BST01QVCA9XG4gIFwiUGVyZm9ybSBhIGJvdW5kZWQgZm9yZW5zaWMgYXVkaXQgb2YgdGhpcyBkaXNwb3NhYmxlIHByb2plY3QgdXNpbmcgcmVhZC1vbmx5IHRvb2xzLiBcIiArXG4gIFwiUHJvZHVjZSBhdCBsZWFzdCBvbmUgYWNjZXB0ZWQgZXZpZGVuY2UgaXRlbSBhbmQgb25lIHZhbGlkYXRpb24gY2hlY2twb2ludCwgYW5kIGRvIG5vdCBcIiArXG4gIFwicmVwb3J0IENPTVBMRVRFRCB1bmxlc3MgYm90aCBhcmUgcHJlc2VudC4gUmVwb3J0IG9ubHkgdmVyaWZpZWQgZXZpZGVuY2UuXCI7XG5jb25zdCBMSVZFX0NBTVBBSUdOX1NDRU5BUklPUyA9IG5ldyBTZXQoW1xuICBcInByb3ZpZGVyLW91dGFnZVwiLFxuICBcIm1hbGZvcm1lZC1vdXRwdXRcIixcbiAgXCJkZWxpdmVyeS1zdWNjZXNzXCIsXG5dKTtcblxuZnVuY3Rpb24gbGl2ZUNhbXBhaWduU2NlbmFyaW8oKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgY29uc3Qgc2NlbmFyaW8gPSBwcm9jZXNzLmVudi5EQVNIQk9BUkRfRTJFX0xJVkVfU0NFTkFSSU8/LnRyaW0oKTtcbiAgaWYgKHByb2Nlc3MuZW52LkRBU0hCT0FSRF9FMkVfTElWRV9DQU1QQUlHTiA9PT0gXCIxXCIgJiYgIXNjZW5hcmlvKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgXCJMaXZlIGNhbXBhaWduIHJlcXVpcmVzIERBU0hCT0FSRF9FMkVfTElWRV9TQ0VOQVJJTz1wcm92aWRlci1vdXRhZ2UsIG1hbGZvcm1lZC1vdXRwdXQsIG9yIGRlbGl2ZXJ5LXN1Y2Nlc3MuXCIsXG4gICAgKTtcbiAgfVxuICBpZiAoc2NlbmFyaW8gJiYgIUxJVkVfQ0FNUEFJR05fU0NFTkFSSU9TLmhhcyhzY2VuYXJpbykpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYFVuc3VwcG9ydGVkIGxpdmUgY2FtcGFpZ24gc2NlbmFyaW86ICR7c2NlbmFyaW99LmApO1xuICB9XG4gIHJldHVybiBzY2VuYXJpbztcbn1cblxuZnVuY3Rpb24gbGl2ZVByb21wdCgpOiBzdHJpbmcge1xuICBjb25zdCBzY2VuYXJpbyA9IGxpdmVDYW1wYWlnblNjZW5hcmlvKCk7XG4gIGlmIChzY2VuYXJpbyA9PT0gXCJwcm92aWRlci1vdXRhZ2VcIikge1xuICAgIHJldHVybiBcIlJ1biBhIGJvdW5kZWQgZm9yZW5zaWMgYXVkaXQgYW5kIHJlcG9ydCB0aGUgT3BlblJvdXRlciByYXRlLWxpbWl0L3Byb3ZpZGVyLWV4aGF1c3Rpb24gb3V0YWdlIGFzIGEgZmFpbGVkIG9yIGluY29tcGxldGUgb3BlcmF0aW9uLiBEbyBub3QgdXNlIHByaW9yIGFuYWx5c2lzIGFzIGEgY3VycmVudCBhbnN3ZXI7IGluY2x1ZGUgdGhlIGN1cnJlbnQgb3BlcmF0aW9uIGFuZCByZXZpc2lvbi5cIjtcbiAgfVxuICBpZiAoc2NlbmFyaW8gPT09IFwibWFsZm9ybWVkLW91dHB1dFwiKSB7XG4gICAgcmV0dXJuIFwiUnVuIGEgYm91bmRlZCBmb3JlbnNpYyBhdWRpdCBhbmQgdHJlYXQgbWFsZm9ybWVkIHByb3ZpZGVyIG91dHB1dCBhcyBmYWlsZWQgb3IgaW5jb21wbGV0ZS4gRG8gbm90IGNsYWltIHN1Y2Nlc3MsIGFwcGx5LCBjb21taXQsIG9yIHB1c2ggd2l0aG91dCBjYW5kaWRhdGUtYm91bmQgZXZpZGVuY2UuXCI7XG4gIH1cbiAgaWYgKHNjZW5hcmlvID09PSBcImRlbGl2ZXJ5LXN1Y2Nlc3NcIikge1xuICAgIHJldHVybiBcIlBsZWFzZSBjb25kdWN0IHRoZSBib3VuZGVkIGRlbGl2ZXJ5IHByb29mIGNhbXBhaWduIG9uIHRoaXMgZGlzcG9zYWJsZSBwcm9qZWN0LiBFeGVyY2lzZSBhcHBseSwgY29tbWl0LCBhbmQgcHVzaCBvbmx5IHdoZW4gZWFjaCBjdXJyZW50IG9wZXJhdGlvbiwgcHJvamVjdCByZXZpc2lvbiwgY2FuZGlkYXRlIGlkZW50aXR5LCBhbmQgY2FuZGlkYXRlLWJvdW5kIGV2aWRlbmNlIG1hdGNoLiBSZXBvcnQgZXZlcnkgdGVybWluYWwgcmVjZWlwdC5cIjtcbiAgfVxuICByZXR1cm4gcHJvY2Vzcy5lbnYuREFTSEJPQVJEX0UyRV9MSVZFX1BST01QVCA/PyBERUZBVUxUX0xJVkVfUFJPTVBUO1xufVxuXG5mdW5jdGlvbiBsaXZlVGltZW91dE1zKCk6IG51bWJlciB7XG4gIGNvbnN0IGNvbmZpZ3VyZWQgPSBOdW1iZXIocHJvY2Vzcy5lbnYuREFTSEJPQVJEX0UyRV9MSVZFX1RJTUVPVVRfTVMpO1xuICByZXR1cm4gTnVtYmVyLmlzRmluaXRlKGNvbmZpZ3VyZWQpICYmIGNvbmZpZ3VyZWQgPiAwXG4gICAgPyBjb25maWd1cmVkXG4gICAgOiBERUZBVUxUX0xJVkVfVElNRU9VVF9NUztcbn1cblxuZnVuY3Rpb24gYXBwcm92ZWREYXNoYm9hcmRPcmlnaW5zKCk6IHN0cmluZ1tdIHtcbiAgY29uc3Qgb3JpZ2lucyA9IChwcm9jZXNzLmVudi5EQVNIQk9BUkRfRTJFX0FQUFJPVkVEX09SSUdJTlMgPz8gXCJcIilcbiAgICAuc3BsaXQoXCIsXCIpXG4gICAgLm1hcCgob3JpZ2luKSA9PiBvcmlnaW4udHJpbSgpKVxuICAgIC5maWx0ZXIoQm9vbGVhbik7XG4gIGlmIChvcmlnaW5zLmxlbmd0aCA9PT0gMCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgIFwiREFTSEJPQVJEX0UyRV9BUFBST1ZFRF9PUklHSU5TIG11c3QgY29udGFpbiBldmVyeSBhcHByb3ZlZCBkYXNoYm9hcmQgb3JpZ2luLlwiLFxuICAgICk7XG4gIH1cbiAgcmV0dXJuIG9yaWdpbnMubWFwKChvcmlnaW4pID0+IHtcbiAgICBjb25zdCBwYXJzZWQgPSBuZXcgVVJMKG9yaWdpbik7XG4gICAgaWYgKFxuICAgICAgcGFyc2VkLm9yaWdpbiAhPT0gb3JpZ2luIHx8XG4gICAgICBwYXJzZWQucGF0aG5hbWUgIT09IFwiL1wiIHx8XG4gICAgICBwYXJzZWQuc2VhcmNoIHx8XG4gICAgICBwYXJzZWQuaGFzaFxuICAgICkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICBgRGFzaGJvYXJkIGpvdXJuZXkgb3JpZ2luIG11c3QgYmUgYSBiYXJlIG9yaWdpbjogJHtvcmlnaW59YCxcbiAgICAgICk7XG4gICAgfVxuICAgIHJldHVybiBwYXJzZWQub3JpZ2luO1xuICB9KTtcbn1cblxuY29uc3QgZGFzaGJvYXJkRml4dHVyZSA9IHtcbiAgZnJlc2huZXNzUmV2aXNpb246IFwiMjAyNi0wMS0wMVQwMDowMDowMC4wMDBaXCIsXG4gIHByb2plY3RDb3VudDogMSxcbiAgYWN0aXZlVGFza0NvdW50OiAwLFxuICBjb21wbGV0ZWRUYXNrQ291bnQ6IDIsXG4gIGZhaWxlZFRhc2tDb3VudDogMCxcbiAgdGFza1N0YXR1c0JyZWFrZG93bjogeyBwZW5kaW5nOiAwLCBydW5uaW5nOiAwIH0sXG4gIHByb2plY3RTY29yZXM6IFtcbiAgICB7XG4gICAgICBwcm9qZWN0SWQ6IFwiZTJlLXByb2plY3RcIixcbiAgICAgIHByb2plY3ROYW1lOiBcIlNtb2tlIFByb2plY3RcIixcbiAgICAgIHNjb3JlOiA5MixcbiAgICAgIHRyZW5kOiBcInN0YWJsZVwiLFxuICAgIH0sXG4gIF0sXG4gIHJlY2VudEV2ZW50czogW1xuICAgIHtcbiAgICAgIGlkOiBcImUyZS1ldmVudFwiLFxuICAgICAgdHlwZTogXCJTbW9rZUNoZWNrXCIsXG4gICAgICBzZXZlcml0eTogXCJzdWNjZXNzXCIsXG4gICAgICBtZXNzYWdlOiBcIkRhc2hib2FyZCBBUEkgZml4dHVyZSByZWFkeVwiLFxuICAgICAgdGltZXN0YW1wOiBcIjIwMjYtMDEtMDFUMDA6MDA6MDAuMDAwWlwiLFxuICAgIH0sXG4gIF0sXG4gIHRvcFJ1bGVzOiBbXSxcbn07XG5cbmNvbnN0IGV4ZWN1dGlvbkZpeHR1cmUgPSB7XG4gIGlkOiBFWEVDVVRJT05fSUQsXG4gIHByb2plY3RJZDogXCJlMmUtcHJvamVjdFwiLFxuICBvcGVyYXRpb25JZDogXCJlMmUtb3BlcmF0aW9uXCIsXG4gIHN0YXR1czogXCJjb21wbGV0ZWRcIixcbiAgZmxpZ2h0U3RhdGU6IFwiQ09NUExFVEVEXCIsXG4gIGV2aWRlbmNlVmVyZGljdDogXCJQUk9WRU5cIixcbiAgcHJvb2ZSZXF1aXJlZDogZmFsc2UsXG4gIHJlc3VtYWJsZTogZmFsc2UsXG4gIGNoZWNrcG9pbnRWZXJzaW9uOiAxLFxuICBwcm9qZWN0UmV2aXNpb246IFwiZTJlLXJldmlzaW9uLTQyXCIsXG4gIGNoZWNrcG9pbnQ6IHtcbiAgICBzdGFnZTogXCJjb21wbGV0ZVwiLFxuICAgIGRldGFpbDogXCJDb250cm9sbGVkIGJyb3dzZXIgZml4dHVyZSBjb21wbGV0ZWQuXCIsXG4gIH0sXG4gIG9iamVjdGl2ZTogeyBvYmplY3RpdmU6IFwiVmVyaWZ5IHRoZSBkYXNoYm9hcmQgYnJvd3NlciBqb3VybmV5XCIgfSxcbiAgc3RhcnRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDA6MDAuMDAwWlwiLFxuICBjb21wbGV0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAxOjAwLjAwMFpcIixcbiAgY3JlYXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDA6MDAuMDAwWlwiLFxuICB1cGRhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMTowMC4wMDBaXCIsXG59O1xuXG5mdW5jdGlvbiBqc29uUmVzcG9uc2UoXG4gIGJvZHk6IHVua25vd24sXG4gIHN0YXR1cyA9IDIwMCxcbiAgaGVhZGVycz86IFJlY29yZDxzdHJpbmcsIHN0cmluZz4sXG4pIHtcbiAgcmV0dXJuIHtcbiAgICBzdGF0dXMsXG4gICAgY29udGVudFR5cGU6IFwiYXBwbGljYXRpb24vanNvblwiLFxuICAgIC4uLihoZWFkZXJzID8geyBoZWFkZXJzIH0gOiB7fSksXG4gICAgYm9keTogSlNPTi5zdHJpbmdpZnkoYm9keSksXG4gIH07XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGV4cGVjdE5vSG9yaXpvbnRhbE92ZXJmbG93KHBhZ2U6IFBhZ2UpIHtcbiAgY29uc3Qgb3ZlcmZsb3cgPSBhd2FpdCBwYWdlLmV2YWx1YXRlKCgpID0+ICh7XG4gICAgZG9jdW1lbnQ6IGRvY3VtZW50LmRvY3VtZW50RWxlbWVudC5zY3JvbGxXaWR0aCxcbiAgICBib2R5OiBkb2N1bWVudC5ib2R5LnNjcm9sbFdpZHRoLFxuICAgIHZpZXdwb3J0OiB3aW5kb3cuaW5uZXJXaWR0aCxcbiAgfSkpO1xuICBleHBlY3Qob3ZlcmZsb3cuZG9jdW1lbnQpLnRvQmVMZXNzVGhhbk9yRXF1YWwob3ZlcmZsb3cudmlld3BvcnQgKyAxKTtcbiAgZXhwZWN0KG92ZXJmbG93LmJvZHkpLnRvQmVMZXNzVGhhbk9yRXF1YWwob3ZlcmZsb3cudmlld3BvcnQgKyAxKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZXhwZWN0RGFzaGJvYXJkUmVhZHkocGFnZTogUGFnZSkge1xuICBhd2FpdCBleHBlY3QoXG4gICAgcGFnZS5nZXRCeVJvbGUoXCJoZWFkaW5nXCIsIHsgbmFtZTogXCJTeXN0ZW0gT3ZlcnZpZXdcIiB9KSxcbiAgKS50b0JlVmlzaWJsZSgpO1xuICBhd2FpdCBleHBlY3QocGFnZS5nZXRCeVRleHQoXCJTWVNURU0gT05MSU5FXCIsIHsgZXhhY3Q6IHRydWUgfSkpLnRvQmVWaXNpYmxlKCk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHJlc3RhcnRBcGlGb3JDYW1wYWlnbihwYWdlOiBQYWdlKSB7XG4gIGNvbnN0IGNvbnRyb2xVcmwgPSBwcm9jZXNzLmVudi5EQVNIQk9BUkRfRTJFX0NPTlRST0xfVVJMO1xuICBpZiAoIWNvbnRyb2xVcmwpIHRocm93IG5ldyBFcnJvcihcIkRhc2hib2FyZCBjYW1wYWlnbiBjb250cm9sIFVSTCBpcyBtaXNzaW5nLlwiKTtcbiAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBwYWdlLnJlcXVlc3QucG9zdChgJHtjb250cm9sVXJsfS9yZXN0YXJ0LWFwaWAsIHtcbiAgICB0aW1lb3V0OiAxNV8wMDAsXG4gIH0pO1xuICBleHBlY3QocmVzcG9uc2Uuc3RhdHVzKCkpLnRvQmUoMjA0KTtcbn1cblxudHlwZSBBcmFiaWNBaUZpeHR1cmUgPSB7XG4gIHF1ZXN0aW9uOiBzdHJpbmc7XG4gIGFuc3dlcjogc3RyaW5nO1xuICBzb3VyY2U6IHN0cmluZztcbiAgc2Vzc2lvbklkOiBzdHJpbmc7XG4gIGV4ZWN1dGlvbklkPzogc3RyaW5nO1xuICBwcm9qZWN0SWQ/OiBzdHJpbmc7XG4gIHN0cmVhbUJvZHk6IHN0cmluZztcbiAgbWVzc2FnZTogUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG59O1xuXG5hc3luYyBmdW5jdGlvbiBpbnN0YWxsQXBpRml4dHVyZXMoXG4gIHBhZ2U6IFBhZ2UsXG4gIG92ZXJyaWRlcz86IHtcbiAgICBhcmFiaWNBaT86IEFyYWJpY0FpRml4dHVyZTtcbiAgICBhbHRlcm5hdGVBaT86IEFyYWJpY0FpRml4dHVyZTtcbiAgICBkaXNjb25uZWN0QWk/OiBBcmFiaWNBaUZpeHR1cmU7XG4gICAgcmVzdW1lRmFpbHVyZT86IHtcbiAgICAgIGZpeHR1cmU6IEFyYWJpY0FpRml4dHVyZTtcbiAgICAgIGV4ZWN1dGlvbjogUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gICAgfTtcbiAgICBpbnRlcnJ1cHRlZFJlc3VtZT86IHtcbiAgICAgIGZpeHR1cmU6IEFyYWJpY0FpRml4dHVyZTtcbiAgICAgIGV4ZWN1dGlvbjogUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gICAgICByZWNvdmVyZWRUb2tlbjogc3RyaW5nO1xuICAgICAgcmVzdW1lZFN0cmVhbUJvZHk6IHN0cmluZztcbiAgICB9O1xuICAgIGRlbGl2ZXJ5UmVjb3Zlcnk/OiB7XG4gICAgICBvcGVyYXRpb25zOiBBcnJheTxSZWNvcmQ8c3RyaW5nLCB1bmtub3duPj47XG4gICAgICByZXF1ZXN0czogc3RyaW5nW107XG4gICAgICBhY3Rpb25SZXF1ZXN0cz86IHN0cmluZ1tdO1xuICAgICAgcmVjb3ZlcnlBY3Rpb24/OiB7XG4gICAgICAgIHByb3Bvc2FsSWQ6IHN0cmluZztcbiAgICAgICAgYWN0aW9uOiBcInJlc3VtZS12YWxpZGF0aW9uXCIgfCBcImRpc2NhcmRcIjtcbiAgICAgICAgcmVzcG9uc2U6IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAgICAgICBzdGF0dXM/OiBudW1iZXI7XG4gICAgICAgIG5leHRPcGVyYXRpb25zPzogQXJyYXk8UmVjb3JkPHN0cmluZywgdW5rbm93bj4+O1xuICAgICAgfTtcbiAgICB9O1xuICAgIHByb2plY3RzPzogQXJyYXk8UmVjb3JkPHN0cmluZywgdW5rbm93bj4+O1xuICAgIGV2ZW50cz86IEFycmF5PFJlY29yZDxzdHJpbmcsIHVua25vd24+PjtcbiAgICBhcmNoaXZlVXBsb2FkPzoge1xuICAgICAgdXBsb2FkSWQ6IHN0cmluZztcbiAgICAgIG9yaWdpbmFsTmFtZTogc3RyaW5nO1xuICAgIH07XG4gICAgYXVkaXRFeHBvcnQ/OiB7XG4gICAgICBib2R5OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgICAgIGZpbGVuYW1lOiBzdHJpbmc7XG4gICAgICByZXF1ZXN0czogc3RyaW5nW107XG4gICAgICBleGVjdXRpb24/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgICAgIG1lc3NhZ2VPdXRjb21lPzogc3RyaW5nO1xuICAgICAgZmFpbEZpcnN0UHJldmlldz86IGJvb2xlYW47XG4gICAgfTtcbiAgICBsaXZlVGFzaz86IHtcbiAgICAgIGlkOiBzdHJpbmc7XG4gICAgICB0aXRsZTogc3RyaW5nO1xuICAgICAgcHJvamVjdElkOiBzdHJpbmc7XG4gICAgICBsb2c6IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAgICAgaW5pdGlhbExvZ3M/OiBBcnJheTxSZWNvcmQ8c3RyaW5nLCB1bmtub3duPj47XG4gICAgICBzdHJlYW1SZXF1ZXN0cz86IHN0cmluZ1tdO1xuICAgICAgZmFpbEZpcnN0U3RyZWFtPzogYm9vbGVhbjtcbiAgICAgIGZhaWxTdHJlYW1BdHRlbXB0cz86IG51bWJlcjtcbiAgICB9O1xuICAgIHRhc2tBY3Rpb25zPzoge1xuICAgICAgdGFza3M6IEFycmF5PFJlY29yZDxzdHJpbmcsIHVua25vd24+PjtcbiAgICAgIHJlcXVlc3RzOiBzdHJpbmdbXTtcbiAgICAgIHZlcmlmaWNhdGlvblJlcXVlc3RzPzogQXJyYXk8UmVjb3JkPHN0cmluZywgdW5rbm93bj4+O1xuICAgIH07XG4gICAgcmVjb3ZlcnlUYXNrcz86IEFycmF5PFJlY29yZDxzdHJpbmcsIHVua25vd24+PjtcbiAgICByZWNvdmVyeVdvcmtmbG93cz86IEFycmF5PFJlY29yZDxzdHJpbmcsIHVua25vd24+PjtcbiAgICByZWNvdmVyeVdvcmtmbG93RXhlY3V0aW9ucz86IFJlY29yZDxzdHJpbmcsIEFycmF5PFJlY29yZDxzdHJpbmcsIHVua25vd24+Pj47XG4gIH0sXG4pIHtcbiAgYXdhaXQgcGFnZS5yb3V0ZShcIioqL2FwaS8qKlwiLCBhc3luYyAocm91dGUpID0+IHtcbiAgICBjb25zdCB1cmwgPSBuZXcgVVJMKHJvdXRlLnJlcXVlc3QoKS51cmwoKSk7XG4gICAgY29uc3QgcGF0aCA9IHVybC5wYXRobmFtZS5yZXBsYWNlKC9eXFwvZGFzaGJvYXJkKD89XFwvfCQpLywgXCJcIik7XG4gICAgY29uc3QgYXJhYmljQWkgPSBvdmVycmlkZXM/LmFyYWJpY0FpO1xuICAgIGNvbnN0IGFsdGVybmF0ZUFpID0gb3ZlcnJpZGVzPy5hbHRlcm5hdGVBaTtcbiAgICBjb25zdCBkaXNjb25uZWN0QWkgPSBvdmVycmlkZXM/LmRpc2Nvbm5lY3RBaTtcbiAgICBjb25zdCBhaUZpeHR1cmVzID0gW2FyYWJpY0FpLCBhbHRlcm5hdGVBaSwgZGlzY29ubmVjdEFpXS5maWx0ZXIoXG4gICAgICAoZml4dHVyZSk6IGZpeHR1cmUgaXMgQXJhYmljQWlGaXh0dXJlID0+IEJvb2xlYW4oZml4dHVyZSksXG4gICAgKTtcbiAgICBjb25zdCBoYXNDb25maWd1cmVkQWlGaXh0dXJlID1cbiAgICAgIGFpRml4dHVyZXMubGVuZ3RoID4gMCB8fFxuICAgICAgQm9vbGVhbihvdmVycmlkZXM/LnJlc3VtZUZhaWx1cmUgfHwgb3ZlcnJpZGVzPy5pbnRlcnJ1cHRlZFJlc3VtZSk7XG5cbiAgICBpZiAoYWlGaXh0dXJlcy5sZW5ndGggPiAwICYmIHBhdGguZW5kc1dpdGgoXCIvYXBpL2FpL2NoYXQvc2Vzc2lvbnNcIikpIHtcbiAgICAgIGNvbnN0IHByb2plY3RJZCA9IHVybC5zZWFyY2hQYXJhbXMuZ2V0KFwicHJvamVjdElkXCIpO1xuICAgICAgY29uc3QgcHJvamVjdFNlc3Npb25zID0gYWlGaXh0dXJlcy5maWx0ZXIoXG4gICAgICAgIChmaXh0dXJlKSA9PiAhZml4dHVyZS5wcm9qZWN0SWQgfHwgZml4dHVyZS5wcm9qZWN0SWQgPT09IHByb2plY3RJZCxcbiAgICAgICk7XG4gICAgICByZXR1cm4gcm91dGUuZnVsZmlsbChcbiAgICAgICAganNvblJlc3BvbnNlKFxuICAgICAgICAgIHByb2plY3RTZXNzaW9ucy5tYXAoKGZpeHR1cmUpID0+ICh7XG4gICAgICAgICAgICBpZDogZml4dHVyZS5zZXNzaW9uSWQsXG4gICAgICAgICAgICB0aXRsZTogZml4dHVyZS5xdWVzdGlvbixcbiAgICAgICAgICAgIHVwZGF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAyOjAwLjAwMFpcIixcbiAgICAgICAgICB9KSksXG4gICAgICAgICksXG4gICAgICApO1xuICAgIH1cbiAgICBpZiAob3ZlcnJpZGVzPy5yZXN1bWVGYWlsdXJlICYmIHBhdGguZW5kc1dpdGgoXCIvYXBpL2FpL2NoYXQvc3RyZWFtXCIpKSB7XG4gICAgICBsZXQgcmVxdWVzdEJvZHk6IFJlY29yZDxzdHJpbmcsIHVua25vd24+ID0ge307XG4gICAgICB0cnkge1xuICAgICAgICByZXF1ZXN0Qm9keSA9IHJvdXRlLnJlcXVlc3QoKS5wb3N0RGF0YUpTT04oKSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICAvLyBUaGUgbm9ybWFsIHByb3ZpZGVyLWZyZWUgZmFsbGJhY2sgYmVsb3cgaGFuZGxlcyBtYWxmb3JtZWQgcmVxdWVzdHMuXG4gICAgICB9XG4gICAgICBpZiAoXG4gICAgICAgIHJlcXVlc3RCb2R5LmV4ZWN1dGlvbklkID09PSBvdmVycmlkZXMucmVzdW1lRmFpbHVyZS5maXh0dXJlLmV4ZWN1dGlvbklkXG4gICAgICApIHtcbiAgICAgICAgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoe1xuICAgICAgICAgIHN0YXR1czogMjAwLFxuICAgICAgICAgIGNvbnRlbnRUeXBlOiBcInRleHQvZXZlbnQtc3RyZWFtXCIsXG4gICAgICAgICAgaGVhZGVyczogeyBcIkNhY2hlLUNvbnRyb2xcIjogXCJuby1jYWNoZVwiIH0sXG4gICAgICAgICAgYm9keTogb3ZlcnJpZGVzLnJlc3VtZUZhaWx1cmUuZml4dHVyZS5zdHJlYW1Cb2R5LFxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9XG4gICAgaWYgKG92ZXJyaWRlcz8uaW50ZXJydXB0ZWRSZXN1bWUgJiYgcGF0aC5lbmRzV2l0aChcIi9hcGkvYWkvY2hhdC9zdHJlYW1cIikpIHtcbiAgICAgIGxldCByZXF1ZXN0Qm9keTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gPSB7fTtcbiAgICAgIHRyeSB7XG4gICAgICAgIHJlcXVlc3RCb2R5ID0gcm91dGUucmVxdWVzdCgpLnBvc3REYXRhSlNPTigpIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIC8vIFRoZSBub3JtYWwgcHJvdmlkZXItZnJlZSBmYWxsYmFjayBiZWxvdyBoYW5kbGVzIG1hbGZvcm1lZCByZXF1ZXN0cy5cbiAgICAgIH1cbiAgICAgIGNvbnN0IHsgZml4dHVyZSwgcmVzdW1lZFN0cmVhbUJvZHkgfSA9IG92ZXJyaWRlcy5pbnRlcnJ1cHRlZFJlc3VtZTtcbiAgICAgIGlmIChyZXF1ZXN0Qm9keS5leGVjdXRpb25JZCA9PT0gZml4dHVyZS5leGVjdXRpb25JZCkge1xuICAgICAgICByZXR1cm4gcm91dGUuZnVsZmlsbCh7XG4gICAgICAgICAgc3RhdHVzOiAyMDAsXG4gICAgICAgICAgY29udGVudFR5cGU6IFwidGV4dC9ldmVudC1zdHJlYW1cIixcbiAgICAgICAgICBoZWFkZXJzOiB7IFwiQ2FjaGUtQ29udHJvbFwiOiBcIm5vLWNhY2hlXCIgfSxcbiAgICAgICAgICBib2R5OiByZXN1bWVkU3RyZWFtQm9keSxcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgICBpZiAoIXJlcXVlc3RCb2R5LmV4ZWN1dGlvbklkKSB7XG4gICAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKHtcbiAgICAgICAgICBzdGF0dXM6IDIwMCxcbiAgICAgICAgICBjb250ZW50VHlwZTogXCJ0ZXh0L2V2ZW50LXN0cmVhbVwiLFxuICAgICAgICAgIGhlYWRlcnM6IHsgXCJDYWNoZS1Db250cm9sXCI6IFwibm8tY2FjaGVcIiB9LFxuICAgICAgICAgIC8vIERlbGliZXJhdGVseSBzdG9wIGFmdGVyIHRoZSBkdXJhYmxlIGV4ZWN1dGlvbiBpZGVudGl0eS4gVGhlXG4gICAgICAgICAgLy8gam91cm5leSB3cmFwcyB0aGlzIHJlc3BvbnNlIGluIGEgYnJvd3Nlci1sZXZlbCBzdHJlYW0gZXJyb3IuXG4gICAgICAgICAgYm9keTogZml4dHVyZS5zdHJlYW1Cb2R5LFxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9XG4gICAgbGV0IHJlcXVlc3RlZE1lc3NhZ2U6IHN0cmluZyB8IHVuZGVmaW5lZDtcbiAgICB0cnkge1xuICAgICAgcmVxdWVzdGVkTWVzc2FnZSA9IChyb3V0ZS5yZXF1ZXN0KCkucG9zdERhdGFKU09OKCkgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4pXG4gICAgICAgIC5tZXNzYWdlIGFzIHN0cmluZyB8IHVuZGVmaW5lZDtcbiAgICB9IGNhdGNoIHtcbiAgICAgIC8vIFRoZSBkZWZhdWx0IHByb3ZpZGVyLXVuYXZhaWxhYmxlIHJlc3BvbnNlIGhhbmRsZXMgbWFsZm9ybWVkIHJlcXVlc3RzLlxuICAgIH1cbiAgICBjb25zdCBzdHJlYW1GaXh0dXJlID1cbiAgICAgIGRpc2Nvbm5lY3RBaSA/P1xuICAgICAgYWlGaXh0dXJlcy5maW5kKFxuICAgICAgICAoZml4dHVyZSkgPT5cbiAgICAgICAgICB0eXBlb2YgcmVxdWVzdGVkTWVzc2FnZSA9PT0gXCJzdHJpbmdcIiAmJlxuICAgICAgICAgIChyZXF1ZXN0ZWRNZXNzYWdlID09PSBmaXh0dXJlLnF1ZXN0aW9uIHx8XG4gICAgICAgICAgICByZXF1ZXN0ZWRNZXNzYWdlLmluY2x1ZGVzKGZpeHR1cmUucXVlc3Rpb24pKSxcbiAgICAgICkgPz9cbiAgICAgIGFyYWJpY0FpO1xuICAgIGlmIChzdHJlYW1GaXh0dXJlICYmIHBhdGguZW5kc1dpdGgoXCIvYXBpL2FpL2NoYXQvc3RyZWFtXCIpKVxuICAgICAgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoe1xuICAgICAgICBzdGF0dXM6IDIwMCxcbiAgICAgICAgY29udGVudFR5cGU6IFwidGV4dC9ldmVudC1zdHJlYW1cIixcbiAgICAgICAgaGVhZGVyczogeyBcIkNhY2hlLUNvbnRyb2xcIjogXCJuby1jYWNoZVwiIH0sXG4gICAgICAgIGJvZHk6IHN0cmVhbUZpeHR1cmUuc3RyZWFtQm9keSxcbiAgICAgIH0pO1xuICAgIGNvbnN0IG1lc3NhZ2VGaXh0dXJlID0gYWlGaXh0dXJlcy5maW5kKChmaXh0dXJlKSA9PlxuICAgICAgcGF0aC5lbmRzV2l0aChgL2FwaS9haS9jaGF0LyR7Zml4dHVyZS5zZXNzaW9uSWR9L21lc3NhZ2VzYCksXG4gICAgKTtcbiAgICBpZiAobWVzc2FnZUZpeHR1cmUpXG4gICAgICByZXR1cm4gcm91dGUuZnVsZmlsbChcbiAgICAgICAganNvblJlc3BvbnNlKFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBpZDogYCR7bWVzc2FnZUZpeHR1cmUuc2Vzc2lvbklkfS11c2VyLW1lc3NhZ2VgLFxuICAgICAgICAgICAgc2Vzc2lvbklkOiBtZXNzYWdlRml4dHVyZS5zZXNzaW9uSWQsXG4gICAgICAgICAgICByb2xlOiBcInVzZXJcIixcbiAgICAgICAgICAgIGNvbnRlbnQ6IG1lc3NhZ2VGaXh0dXJlLnF1ZXN0aW9uLFxuICAgICAgICAgICAgY3JlYXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDE6MDAuMDAwWlwiLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgbWVzc2FnZUZpeHR1cmUubWVzc2FnZSxcbiAgICAgICAgXSksXG4gICAgICApO1xuICAgIGlmIChcbiAgICAgIG92ZXJyaWRlcz8uYXVkaXRFeHBvcnQgJiZcbiAgICAgIHBhdGguZW5kc1dpdGgoXCIvYXBpL2FpL2NoYXQvZTJlLWF1ZGl0LXNlc3Npb24vbWVzc2FnZXNcIilcbiAgICApIHtcbiAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKFxuICAgICAgICBqc29uUmVzcG9uc2UoW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIGlkOiBcImUyZS1hdWRpdC11c2VyLW1lc3NhZ2VcIixcbiAgICAgICAgICAgIHNlc3Npb25JZDogXCJlMmUtYXVkaXQtc2Vzc2lvblwiLFxuICAgICAgICAgICAgcm9sZTogXCJ1c2VyXCIsXG4gICAgICAgICAgICBjb250ZW50OiBcIkNvbXBsZXRlZCBhdWRpdCBleGVjdXRpb25cIixcbiAgICAgICAgICAgIGNyZWF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAxOjAwLjAwMFpcIixcbiAgICAgICAgICB9LFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIGlkOiBcImUyZS1hdWRpdC1hc3Npc3RhbnQtbWVzc2FnZVwiLFxuICAgICAgICAgICAgc2Vzc2lvbklkOiBcImUyZS1hdWRpdC1zZXNzaW9uXCIsXG4gICAgICAgICAgICByb2xlOiBcImFzc2lzdGFudFwiLFxuICAgICAgICAgICAgY29udGVudDogXCJDb21wbGV0ZWQgYXVkaXQgZXhlY3V0aW9uXCIsXG4gICAgICAgICAgICBleGVjdXRpb25JZDogRVhFQ1VUSU9OX0lELFxuICAgICAgICAgICAgb3V0Y29tZTogb3ZlcnJpZGVzLmF1ZGl0RXhwb3J0Lm1lc3NhZ2VPdXRjb21lID8/IFwiU1VDQ0VFREVEXCIsXG4gICAgICAgICAgICBjcmVhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMjowMC4wMDBaXCIsXG4gICAgICAgICAgfSxcbiAgICAgICAgXSksXG4gICAgICApO1xuICAgIH1cblxuICAgIGlmIChwYXRoID09PSBcIi9hcGkvZGFzaGJvYXJkXCIpXG4gICAgICByZXR1cm4gcm91dGUuZnVsZmlsbChqc29uUmVzcG9uc2UoZGFzaGJvYXJkRml4dHVyZSkpO1xuICAgIGlmIChvdmVycmlkZXM/LnRhc2tBY3Rpb25zKSB7XG4gICAgICBjb25zdCB2ZXJpZmljYXRpb25NYXRjaCA9IHBhdGgubWF0Y2goXG4gICAgICAgIC9eXFwvYXBpXFwvdGFza3NcXC8oW14vXSspXFwvdmVyaWZpY2F0aW9uJC8sXG4gICAgICApO1xuICAgICAgaWYgKHZlcmlmaWNhdGlvbk1hdGNoICYmIHJvdXRlLnJlcXVlc3QoKS5tZXRob2QoKSA9PT0gXCJQT1NUXCIpIHtcbiAgICAgICAgY29uc3QgWywgdGFza0lkXSA9IHZlcmlmaWNhdGlvbk1hdGNoO1xuICAgICAgICBjb25zdCB0YXNrID0gb3ZlcnJpZGVzLnRhc2tBY3Rpb25zLnRhc2tzLmZpbmQoXG4gICAgICAgICAgKGNhbmRpZGF0ZSkgPT4gY2FuZGlkYXRlLmlkID09PSB0YXNrSWQsXG4gICAgICAgICk7XG4gICAgICAgIGlmICghdGFzaykge1xuICAgICAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKGpzb25SZXNwb25zZSh7IGVycm9yOiBcIlRhc2sgbm90IGZvdW5kXCIgfSwgNDA0KSk7XG4gICAgICAgIH1cblxuICAgICAgICBsZXQgYm9keTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gPSB7fTtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBib2R5ID0gcm91dGUucmVxdWVzdCgpLnBvc3REYXRhSlNPTigpIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAgICAgICB9IGNhdGNoIHtcbiAgICAgICAgICByZXR1cm4gcm91dGUuZnVsZmlsbChcbiAgICAgICAgICAgIGpzb25SZXNwb25zZSh7IGVycm9yOiBcIkludmFsaWQgdmVyaWZpY2F0aW9uIHJlcXVlc3RcIiB9LCA0MDApLFxuICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgcGxhbiA9IHRhc2sucmVtZWRpYXRpb25QbGFuIGFzXG4gICAgICAgICAgfCB7XG4gICAgICAgICAgICAgIHZlcmlmaWNhdGlvbkNoZWNrcz86IEFycmF5PFJlY29yZDxzdHJpbmcsIHVua25vd24+PjtcbiAgICAgICAgICAgICAgdmVyaWZpY2F0aW9uU3RlcHM/OiBzdHJpbmdbXTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB8IHVuZGVmaW5lZDtcbiAgICAgICAgY29uc3QgY2hlY2tzID1cbiAgICAgICAgICBwbGFuPy52ZXJpZmljYXRpb25DaGVja3MgPz9cbiAgICAgICAgICAocGxhbj8udmVyaWZpY2F0aW9uU3RlcHMgPz8gW10pLm1hcCgoZ3VpZGFuY2UsIGluZGV4KSA9PiAoe1xuICAgICAgICAgICAgaWQ6IGBydWxlLXZlcmlmaWNhdGlvbi0ke2luZGV4ICsgMX1gLFxuICAgICAgICAgICAga2luZDogXCJvcGVyYXRvcl9hdHRlc3RhdGlvblwiLFxuICAgICAgICAgICAgZ3VpZGFuY2UsXG4gICAgICAgICAgfSkpO1xuICAgICAgICBjb25zdCBjaGVjayA9IGNoZWNrcy5maW5kKChjYW5kaWRhdGUpID0+IGNhbmRpZGF0ZS5pZCA9PT0gYm9keS5jaGVja0lkKTtcbiAgICAgICAgaWYgKCFjaGVjaykge1xuICAgICAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKFxuICAgICAgICAgICAganNvblJlc3BvbnNlKFxuICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgZXJyb3I6IFwidmVyaWZpY2F0aW9uX2NoZWNrX25vdF9mb3VuZFwiLFxuICAgICAgICAgICAgICAgIHJlYXNvbjpcbiAgICAgICAgICAgICAgICAgIFwiVGhlIHN1Ym1pdHRlZCBjaGVjayBpcyBub3QgcGFydCBvZiB0aGlzIHRhc2sncyBzZXJ2ZXItb3duZWQgdmVyaWZpY2F0aW9uIHBsYW4uXCIsXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIDQwMCxcbiAgICAgICAgICAgICksXG4gICAgICAgICAgKTtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCBwYXNzZWQgPSBib2R5LnBhc3NlZCA9PT0gdHJ1ZTtcbiAgICAgICAgY29uc3QgZXZpZGVuY2UgPVxuICAgICAgICAgIHR5cGVvZiBib2R5LmV2aWRlbmNlID09PSBcInN0cmluZ1wiID8gYm9keS5ldmlkZW5jZS50cmltKCkgOiBcIlwiO1xuICAgICAgICBpZiAocGFzc2VkICYmICFldmlkZW5jZSkge1xuICAgICAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKFxuICAgICAgICAgICAganNvblJlc3BvbnNlKFxuICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgZXJyb3I6IFwidmVyaWZpY2F0aW9uX2V2aWRlbmNlX3JlcXVpcmVkXCIsXG4gICAgICAgICAgICAgICAgcmVhc29uOlxuICAgICAgICAgICAgICAgICAgXCJBIHBhc3NlZCB2ZXJpZmljYXRpb24gY2hlY2sgbXVzdCBpbmNsdWRlIGV4cGxpY2l0IG9wZXJhdG9yIGV2aWRlbmNlLlwiLFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICA0MDAsXG4gICAgICAgICAgICApLFxuICAgICAgICAgICk7XG4gICAgICAgIH1cblxuICAgICAgICBvdmVycmlkZXMudGFza0FjdGlvbnMudmVyaWZpY2F0aW9uUmVxdWVzdHM/LnB1c2goe1xuICAgICAgICAgIHRhc2tJZCxcbiAgICAgICAgICBjaGVja0lkOiBib2R5LmNoZWNrSWQsXG4gICAgICAgICAgcGFzc2VkLFxuICAgICAgICAgIC4uLihldmlkZW5jZSA/IHsgZXZpZGVuY2UgfSA6IHt9KSxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgY29uc3QgcHJpb3JSZXN1bHQgPSAodGFzay52ZXJpZmljYXRpb25SZXN1bHQgPz8ge30pIGFzIHtcbiAgICAgICAgICBzdGVwcz86IEFycmF5PFJlY29yZDxzdHJpbmcsIHVua25vd24+PjtcbiAgICAgICAgICBoaXN0b3J5PzogQXJyYXk8UmVjb3JkPHN0cmluZywgdW5rbm93bj4+O1xuICAgICAgICB9O1xuICAgICAgICBjb25zdCBwcmlvclN0ZXBzID0gcHJpb3JSZXN1bHQuc3RlcHMgPz8gW107XG4gICAgICAgIGNvbnN0IHN0ZXBzID0gY2hlY2tzLm1hcCgoY2FuZGlkYXRlKSA9PiB7XG4gICAgICAgICAgY29uc3QgcHJpb3IgPSBwcmlvclN0ZXBzLmZpbmQoKHN0ZXApID0+IHN0ZXAuaWQgPT09IGNhbmRpZGF0ZS5pZCk7XG4gICAgICAgICAgaWYgKGNhbmRpZGF0ZS5pZCAhPT0gYm9keS5jaGVja0lkKSB7XG4gICAgICAgICAgICByZXR1cm4gKFxuICAgICAgICAgICAgICBwcmlvciA/PyB7XG4gICAgICAgICAgICAgICAgaWQ6IGNhbmRpZGF0ZS5pZCxcbiAgICAgICAgICAgICAgICBuYW1lOiBgUnVsZSB2ZXJpZmljYXRpb24gJHtTdHJpbmcoY2FuZGlkYXRlLmlkKS5yZXBsYWNlKFxuICAgICAgICAgICAgICAgICAgXCJydWxlLXZlcmlmaWNhdGlvbi1cIixcbiAgICAgICAgICAgICAgICAgIFwiI1wiLFxuICAgICAgICAgICAgICAgICl9YCxcbiAgICAgICAgICAgICAgICBraW5kOiBjYW5kaWRhdGUua2luZCA/PyBcIm9wZXJhdG9yX2F0dGVzdGF0aW9uXCIsXG4gICAgICAgICAgICAgICAgZ3VpZGFuY2U6IGNhbmRpZGF0ZS5ndWlkYW5jZSxcbiAgICAgICAgICAgICAgICBwYXNzZWQ6IGZhbHNlLFxuICAgICAgICAgICAgICAgIG91dHB1dDogXCJOb3QgcmVjb3JkZWQg4oCUIG9wZXJhdG9yIGV2aWRlbmNlIGlzIHJlcXVpcmVkXCIsXG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICk7XG4gICAgICAgICAgfVxuICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBpZDogY2FuZGlkYXRlLmlkLFxuICAgICAgICAgICAgbmFtZTogYFJ1bGUgdmVyaWZpY2F0aW9uICR7U3RyaW5nKGNhbmRpZGF0ZS5pZCkucmVwbGFjZShcbiAgICAgICAgICAgICAgXCJydWxlLXZlcmlmaWNhdGlvbi1cIixcbiAgICAgICAgICAgICAgXCIjXCIsXG4gICAgICAgICAgICApfWAsXG4gICAgICAgICAgICBraW5kOiBjYW5kaWRhdGUua2luZCA/PyBcIm9wZXJhdG9yX2F0dGVzdGF0aW9uXCIsXG4gICAgICAgICAgICBndWlkYW5jZTogY2FuZGlkYXRlLmd1aWRhbmNlLFxuICAgICAgICAgICAgcGFzc2VkLFxuICAgICAgICAgICAgLi4uKGV2aWRlbmNlID8geyBldmlkZW5jZSB9IDoge30pLFxuICAgICAgICAgICAgb3V0cHV0OiBwYXNzZWRcbiAgICAgICAgICAgICAgPyBcIk9wZXJhdG9yIGV2aWRlbmNlIHJlY29yZGVkXCJcbiAgICAgICAgICAgICAgOiBcIk9wZXJhdG9yIHJlcG9ydGVkIHRoYXQgdGhlIGNoZWNrIGZhaWxlZFwiLFxuICAgICAgICAgIH07XG4gICAgICAgIH0pO1xuICAgICAgICBjb25zdCBjb21wbGV0ZWQgPSBzdGVwcy5ldmVyeShcbiAgICAgICAgICAoc3RlcCkgPT4gc3RlcC5wYXNzZWQgPT09IHRydWUgJiYgQm9vbGVhbihTdHJpbmcoc3RlcC5ldmlkZW5jZSA/PyBcIlwiKS50cmltKCkpLFxuICAgICAgICApO1xuICAgICAgICB0YXNrLnN0YXR1cyA9IGNvbXBsZXRlZCA/IFwiY29tcGxldGVkXCIgOiBcInZlcmlmeWluZ1wiO1xuICAgICAgICB0YXNrLnZlcmlmaWNhdGlvblJlc3VsdCA9IHtcbiAgICAgICAgICBwYXNzZWQ6IGNvbXBsZXRlZCxcbiAgICAgICAgICBkZWNpc2lvbjogY29tcGxldGVkID8gXCJ2ZXJpZmllZFwiIDogXCJpbmNvbXBsZXRlXCIsXG4gICAgICAgICAgc3RlcHMsXG4gICAgICAgICAgaGlzdG9yeTogW1xuICAgICAgICAgICAgLi4uKHByaW9yUmVzdWx0Lmhpc3RvcnkgPz8gW10pLFxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBpZDogYHZlcmlmaWNhdGlvbi1oaXN0b3J5LSR7U3RyaW5nKFxuICAgICAgICAgICAgICAgIChwcmlvclJlc3VsdC5oaXN0b3J5ID8/IFtdKS5sZW5ndGggKyAxLFxuICAgICAgICAgICAgICApfWAsXG4gICAgICAgICAgICAgIGNoZWNrSWQ6IGNoZWNrLmlkLFxuICAgICAgICAgICAgICBuYW1lOiBgUnVsZSB2ZXJpZmljYXRpb24gJHtTdHJpbmcoY2hlY2suaWQpLnJlcGxhY2UoXG4gICAgICAgICAgICAgICAgXCJydWxlLXZlcmlmaWNhdGlvbi1cIixcbiAgICAgICAgICAgICAgICBcIiNcIixcbiAgICAgICAgICAgICAgKX1gLFxuICAgICAgICAgICAgICBraW5kOiBjaGVjay5raW5kID8/IFwib3BlcmF0b3JfYXR0ZXN0YXRpb25cIixcbiAgICAgICAgICAgICAgZ3VpZGFuY2U6IGNoZWNrLmd1aWRhbmNlLFxuICAgICAgICAgICAgICBwYXNzZWQsXG4gICAgICAgICAgICAgIC4uLihldmlkZW5jZSA/IHsgZXZpZGVuY2UgfSA6IHt9KSxcbiAgICAgICAgICAgICAgYWN0b3I6IFwiZTJlLW9wZXJhdG9yXCIsXG4gICAgICAgICAgICAgIHJlY29yZGVkQXQ6IGAyMDI2LTAxLTAxVDAwOjAke1xuICAgICAgICAgICAgICAgIChwcmlvclJlc3VsdC5oaXN0b3J5ID8/IFtdKS5sZW5ndGggKyAyXG4gICAgICAgICAgICAgIH06MDAuMDAwWmAsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIF0sXG4gICAgICAgIH07XG4gICAgICAgIGlmICh0YXNrLnJlbWVkaWF0aW9uUGxhbiAmJiBjb21wbGV0ZWQpIHtcbiAgICAgICAgICB0YXNrLnJlbWVkaWF0aW9uUGxhbiA9IHtcbiAgICAgICAgICAgIC4uLih0YXNrLnJlbWVkaWF0aW9uUGxhbiBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiksXG4gICAgICAgICAgICBzdGF0dXM6IFwidmVyaWZpZWRcIixcbiAgICAgICAgICB9O1xuICAgICAgICB9XG4gICAgICAgIHRhc2sudXBkYXRlZEF0ID0gXCIyMDI2LTAxLTAxVDAwOjA0OjAwLjAwMFpcIjtcbiAgICAgICAgaWYgKGNvbXBsZXRlZCkgdGFzay5jb21wbGV0ZWRBdCA9IHRhc2sudXBkYXRlZEF0O1xuICAgICAgICByZXR1cm4gcm91dGUuZnVsZmlsbChqc29uUmVzcG9uc2UodGFzaykpO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBhY3Rpb25NYXRjaCA9IHBhdGgubWF0Y2goL15cXC9hcGlcXC90YXNrc1xcLyhbXi9dKylcXC8oZXhlY3V0ZXxyZXRyeSkkLyk7XG4gICAgICBpZiAoYWN0aW9uTWF0Y2ggJiYgcm91dGUucmVxdWVzdCgpLm1ldGhvZCgpID09PSBcIlBPU1RcIikge1xuICAgICAgICBjb25zdCBbLCB0YXNrSWQsIGFjdGlvbl0gPSBhY3Rpb25NYXRjaDtcbiAgICAgICAgY29uc3QgdGFzayA9IG92ZXJyaWRlcy50YXNrQWN0aW9ucy50YXNrcy5maW5kKFxuICAgICAgICAgIChjYW5kaWRhdGUpID0+IGNhbmRpZGF0ZS5pZCA9PT0gdGFza0lkLFxuICAgICAgICApO1xuICAgICAgICBpZiAoIXRhc2spIHtcbiAgICAgICAgICByZXR1cm4gcm91dGUuZnVsZmlsbChqc29uUmVzcG9uc2UoeyBlcnJvcjogXCJUYXNrIG5vdCBmb3VuZFwiIH0sIDQwNCkpO1xuICAgICAgICB9XG5cbiAgICAgICAgb3ZlcnJpZGVzLnRhc2tBY3Rpb25zLnJlcXVlc3RzLnB1c2goYCR7YWN0aW9ufToke3Rhc2tJZH1gKTtcbiAgICAgICAgaWYgKGFjdGlvbiA9PT0gXCJleGVjdXRlXCIpIHtcbiAgICAgICAgICB0YXNrLnN0YXR1cyA9IFwicnVubmluZ1wiO1xuICAgICAgICAgIHRhc2sudXBkYXRlZEF0ID0gXCIyMDI2LTAxLTAxVDAwOjAyOjAwLjAwMFpcIjtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0YXNrLnN0YXR1cyA9IFwicXVldWVkXCI7XG4gICAgICAgICAgdGFzay5yZXRyeUNvdW50ID0gTnVtYmVyKHRhc2sucmV0cnlDb3VudCA/PyAwKSArIDE7XG4gICAgICAgICAgdGFzay51cGRhdGVkQXQgPSBcIjIwMjYtMDEtMDFUMDA6MDI6MDAuMDAwWlwiO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKGpzb25SZXNwb25zZSh0YXNrLCAyMDIpKTtcbiAgICAgIH1cbiAgICB9XG4gICAgaWYgKHBhdGggPT09IFwiL2FwaS90YXNrc1wiKSB7XG4gICAgICByZXR1cm4gcm91dGUuZnVsZmlsbChcbiAgICAgICAganNvblJlc3BvbnNlKFxuICAgICAgICAgIG92ZXJyaWRlcz8udGFza0FjdGlvbnM/LnRhc2tzID8/XG4gICAgICAgICAgICBvdmVycmlkZXM/LnJlY292ZXJ5VGFza3MgPz9cbiAgICAgICAgICAgIChvdmVycmlkZXM/LmxpdmVUYXNrXG4gICAgICAgICAgICAgID8gW1xuICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICBpZDogb3ZlcnJpZGVzLmxpdmVUYXNrLmlkLFxuICAgICAgICAgICAgICAgICAgICBwcm9qZWN0SWQ6IG92ZXJyaWRlcy5saXZlVGFzay5wcm9qZWN0SWQsXG4gICAgICAgICAgICAgICAgICAgIHRpdGxlOiBvdmVycmlkZXMubGl2ZVRhc2sudGl0bGUsXG4gICAgICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiBcIkEgdGFzayB1c2VkIHRvIHZlcmlmeSBsaXZlIGRhc2hib2FyZCB1cGRhdGVzLlwiLFxuICAgICAgICAgICAgICAgICAgICBzdGF0dXM6IFwicnVubmluZ1wiLFxuICAgICAgICAgICAgICAgICAgICBwcmlvcml0eTogXCJwMVwiLFxuICAgICAgICAgICAgICAgICAgICByZWxhdGVkRmlsZXM6IFtdLFxuICAgICAgICAgICAgICAgICAgICByZXRyeUNvdW50OiAwLFxuICAgICAgICAgICAgICAgICAgICBtYXhSZXRyaWVzOiAyLFxuICAgICAgICAgICAgICAgICAgICBjcmVhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMDowMC4wMDBaXCIsXG4gICAgICAgICAgICAgICAgICAgIHVwZGF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAwOjAxLjAwMFpcIixcbiAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgXVxuICAgICAgICAgICAgICA6IFtdKSxcbiAgICAgICAgKSxcbiAgICAgICk7XG4gICAgfVxuICAgIGlmIChwYXRoID09PSBcIi9hcGkvd29ya2Zsb3dzXCIpIHtcbiAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKFxuICAgICAgICBqc29uUmVzcG9uc2Uob3ZlcnJpZGVzPy5yZWNvdmVyeVdvcmtmbG93cyA/PyBbXSksXG4gICAgICApO1xuICAgIH1cbiAgICBjb25zdCB3b3JrZmxvd0V4ZWN1dGlvbnNNYXRjaCA9IHBhdGgubWF0Y2goXG4gICAgICAvXlxcL2FwaVxcL3dvcmtmbG93c1xcLyhbXi9dKylcXC9leGVjdXRpb25zJC8sXG4gICAgKTtcbiAgICBpZiAod29ya2Zsb3dFeGVjdXRpb25zTWF0Y2gpIHtcbiAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKFxuICAgICAgICBqc29uUmVzcG9uc2UoXG4gICAgICAgICAgb3ZlcnJpZGVzPy5yZWNvdmVyeVdvcmtmbG93RXhlY3V0aW9ucz8uW3dvcmtmbG93RXhlY3V0aW9uc01hdGNoWzFdXSA/P1xuICAgICAgICAgICAgW10sXG4gICAgICAgICksXG4gICAgICApO1xuICAgIH1cbiAgICBpZiAoXG4gICAgICBvdmVycmlkZXM/LmF1ZGl0RXhwb3J0ICYmXG4gICAgICBwYXRoID09PSBgL2FwaS9haS9leGVjdXRpb25zLyR7RVhFQ1VUSU9OX0lEfS9hdWRpdC1leHBvcnRgXG4gICAgKSB7XG4gICAgICBvdmVycmlkZXMuYXVkaXRFeHBvcnQucmVxdWVzdHMucHVzaChyb3V0ZS5yZXF1ZXN0KCkudXJsKCkpO1xuICAgICAgaWYgKFxuICAgICAgICBvdmVycmlkZXMuYXVkaXRFeHBvcnQuZmFpbEZpcnN0UHJldmlldyAmJlxuICAgICAgICBvdmVycmlkZXMuYXVkaXRFeHBvcnQucmVxdWVzdHMubGVuZ3RoID09PSAxXG4gICAgICApIHtcbiAgICAgICAgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoXG4gICAgICAgICAganNvblJlc3BvbnNlKFxuICAgICAgICAgICAgeyBlcnJvcjogXCJUZW1wb3JhcnkgcHJldmlldyBuZXR3b3JrIGZhaWx1cmUuXCIgfSxcbiAgICAgICAgICAgIDUwMyxcbiAgICAgICAgICApLFxuICAgICAgICApO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoXG4gICAgICAgIGpzb25SZXNwb25zZShvdmVycmlkZXMuYXVkaXRFeHBvcnQuYm9keSwgMjAwLCB7XG4gICAgICAgICAgXCJDb250ZW50LURpc3Bvc2l0aW9uXCI6IGBhdHRhY2htZW50OyBmaWxlbmFtZT1cIiR7b3ZlcnJpZGVzLmF1ZGl0RXhwb3J0LmZpbGVuYW1lfVwiYCxcbiAgICAgICAgfSksXG4gICAgICApO1xuICAgIH1cbiAgICBpZiAob3ZlcnJpZGVzPy5hcmNoaXZlVXBsb2FkICYmIHBhdGggPT09IFwiL2FwaS91cGxvYWQvYXJjaGl2ZVwiKSB7XG4gICAgICBjb25zdCBjb250ZW50VHlwZSA9IHJvdXRlLnJlcXVlc3QoKS5oZWFkZXJzKClbXCJjb250ZW50LXR5cGVcIl0gPz8gXCJcIjtcbiAgICAgIGlmICghY29udGVudFR5cGUuc3RhcnRzV2l0aChcIm11bHRpcGFydC9mb3JtLWRhdGE7XCIpKSB7XG4gICAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKFxuICAgICAgICAgIGpzb25SZXNwb25zZSh7IGVycm9yOiBcIkV4cGVjdGVkIG11bHRpcGFydCBhcmNoaXZlIHVwbG9hZC5cIiB9LCA0MDApLFxuICAgICAgICApO1xuICAgICAgfVxuICAgICAgY29uc3QgYm9keSA9IHJvdXRlLnJlcXVlc3QoKS5wb3N0RGF0YUJ1ZmZlcigpO1xuICAgICAgaWYgKCFib2R5Py5pbmNsdWRlcyhCdWZmZXIuZnJvbShcImRhc2hib2FyZC1qb3VybmV5LnppcFwiKSkpIHtcbiAgICAgICAgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoXG4gICAgICAgICAganNvblJlc3BvbnNlKHsgZXJyb3I6IFwiRXhwZWN0ZWQgdGhlIGpvdXJuZXkgYXJjaGl2ZSBwYXlsb2FkLlwiIH0sIDQwMCksXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgICByZXR1cm4gcm91dGUuZnVsZmlsbChcbiAgICAgICAganNvblJlc3BvbnNlKFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIHVwbG9hZElkOiBvdmVycmlkZXMuYXJjaGl2ZVVwbG9hZC51cGxvYWRJZCxcbiAgICAgICAgICAgIG9yaWdpbmFsTmFtZTogb3ZlcnJpZGVzLmFyY2hpdmVVcGxvYWQub3JpZ2luYWxOYW1lLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgMjAxLFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIFwiYWNjZXNzLWNvbnRyb2wtYWxsb3ctb3JpZ2luXCI6IG5ldyBVUkwocGFnZS51cmwoKSkub3JpZ2luLFxuICAgICAgICAgICAgXCJhY2Nlc3MtY29udHJvbC1hbGxvdy1jcmVkZW50aWFsc1wiOiBcInRydWVcIixcbiAgICAgICAgICB9LFxuICAgICAgICApLFxuICAgICAgKTtcbiAgICB9XG4gICAgaWYgKG92ZXJyaWRlcz8ubGl2ZVRhc2sgJiYgcGF0aCA9PT0gXCIvYXBpL3Rhc2tzXCIpIHtcbiAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKFxuICAgICAgICBqc29uUmVzcG9uc2UoW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIGlkOiBvdmVycmlkZXMubGl2ZVRhc2suaWQsXG4gICAgICAgICAgICBwcm9qZWN0SWQ6IG92ZXJyaWRlcy5saXZlVGFzay5wcm9qZWN0SWQsXG4gICAgICAgICAgICB0aXRsZTogb3ZlcnJpZGVzLmxpdmVUYXNrLnRpdGxlLFxuICAgICAgICAgICAgZGVzY3JpcHRpb246IFwiQSB0YXNrIHVzZWQgdG8gdmVyaWZ5IGxpdmUgZGFzaGJvYXJkIHVwZGF0ZXMuXCIsXG4gICAgICAgICAgICBzdGF0dXM6IFwicnVubmluZ1wiLFxuICAgICAgICAgICAgcGhhc2U6IFwiRXhlY3V0aW9uXCIsXG4gICAgICAgICAgICByZWxhdGVkRmlsZXM6IFtdLFxuICAgICAgICAgICAgcmV0cnlDb3VudDogMCxcbiAgICAgICAgICAgIG1heFJldHJpZXM6IDIsXG4gICAgICAgICAgICBjcmVhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMDowMC4wMDBaXCIsXG4gICAgICAgICAgICB1cGRhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMDowMS4wMDBaXCIsXG4gICAgICAgICAgfSxcbiAgICAgICAgXSksXG4gICAgICApO1xuICAgIH1cbiAgICBpZiAoXG4gICAgICBvdmVycmlkZXM/LmxpdmVUYXNrICYmXG4gICAgICBwYXRoID09PSBgL2FwaS90YXNrcy8ke292ZXJyaWRlcy5saXZlVGFzay5pZH0vbG9nc2BcbiAgICApIHtcbiAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKGpzb25SZXNwb25zZShvdmVycmlkZXMubGl2ZVRhc2suaW5pdGlhbExvZ3MgPz8gW10pKTtcbiAgICB9XG4gICAgaWYgKFxuICAgICAgb3ZlcnJpZGVzPy5saXZlVGFzayAmJlxuICAgICAgcGF0aCA9PT0gYC9hcGkvdGFza3MvJHtvdmVycmlkZXMubGl2ZVRhc2suaWR9L2xvZ3Mvc3RyZWFtYFxuICAgICkge1xuICAgICAgY29uc3Qgc3RyZWFtUmVxdWVzdHMgPSBvdmVycmlkZXMubGl2ZVRhc2suc3RyZWFtUmVxdWVzdHM7XG4gICAgICBzdHJlYW1SZXF1ZXN0cz8ucHVzaChyb3V0ZS5yZXF1ZXN0KCkudXJsKCkpO1xuICAgICAgaWYgKFxuICAgICAgICAob3ZlcnJpZGVzLmxpdmVUYXNrLmZhaWxGaXJzdFN0cmVhbSAmJiBzdHJlYW1SZXF1ZXN0cz8ubGVuZ3RoID09PSAxKSB8fFxuICAgICAgICAob3ZlcnJpZGVzLmxpdmVUYXNrLmZhaWxTdHJlYW1BdHRlbXB0cyAmJlxuICAgICAgICAgIHN0cmVhbVJlcXVlc3RzICYmXG4gICAgICAgICAgc3RyZWFtUmVxdWVzdHMubGVuZ3RoIDw9IG92ZXJyaWRlcy5saXZlVGFzay5mYWlsU3RyZWFtQXR0ZW1wdHMpXG4gICAgICApIHtcbiAgICAgICAgLy8gRXhlcmNpc2UgdGhlIGJyb3dzZXIncyByZWNvbm5lY3QgcGF0aCB3aXRob3V0IGNoYW5naW5nIHRoZSB0YXNrXG4gICAgICAgIC8vIGxpZmVjeWNsZSBvciBzeW50aGVzaXppbmcgYSBzdWNjZXNzZnVsIHJlc3BvbnNlIGZvciB0aGUgZmlyc3QgdHJ5LlxuICAgICAgICByZXR1cm4gcm91dGUuYWJvcnQoXCJjb25uZWN0aW9ucmVzZXRcIik7XG4gICAgICB9XG4gICAgICByZXR1cm4gcm91dGUuZnVsZmlsbCh7XG4gICAgICAgIHN0YXR1czogMjAwLFxuICAgICAgICBjb250ZW50VHlwZTogXCJ0ZXh0L2V2ZW50LXN0cmVhbVwiLFxuICAgICAgICBoZWFkZXJzOiB7XG4gICAgICAgICAgXCJDYWNoZS1Db250cm9sXCI6IFwibm8tY2FjaGVcIixcbiAgICAgICAgICBcImFjY2Vzcy1jb250cm9sLWFsbG93LW9yaWdpblwiOiBuZXcgVVJMKHBhZ2UudXJsKCkpLm9yaWdpbixcbiAgICAgICAgICBcImFjY2Vzcy1jb250cm9sLWFsbG93LWNyZWRlbnRpYWxzXCI6IFwidHJ1ZVwiLFxuICAgICAgICB9LFxuICAgICAgICBib2R5OiBgZXZlbnQ6IGxvZ1xcbmRhdGE6ICR7SlNPTi5zdHJpbmdpZnkob3ZlcnJpZGVzLmxpdmVUYXNrLmxvZyl9XFxuXFxuYCxcbiAgICAgIH0pO1xuICAgIH1cbiAgICBpZiAocGF0aCA9PT0gXCIvYXBpL3Byb2plY3RzXCIpIHtcbiAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKFxuICAgICAgICBqc29uUmVzcG9uc2UoXG4gICAgICAgICAgb3ZlcnJpZGVzPy5wcm9qZWN0cyA/PyBbXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIGlkOiBcImUyZS1wcm9qZWN0XCIsXG4gICAgICAgICAgICAgIG5hbWU6IFwiU21va2UgUHJvamVjdFwiLFxuICAgICAgICAgICAgICBsYW5ndWFnZTogXCJUeXBlU2NyaXB0XCIsXG4gICAgICAgICAgICAgIGZyYW1ld29yazogXCJSZWFjdFwiLFxuICAgICAgICAgICAgICBzdGF0dXM6IFwiYWN0aXZlXCIsXG4gICAgICAgICAgICAgIHJvb3RQYXRoOiBcIi9jb250cm9sbGVkL3Ntb2tlXCIsXG4gICAgICAgICAgICAgIHF1YWxpdHlTY29yZTogOTIsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIF0sXG4gICAgICAgICksXG4gICAgICApO1xuICAgIH1cbiAgICBpZiAoaGFzQ29uZmlndXJlZEFpRml4dHVyZSAmJiBwYXRoID09PSBcIi9hcGkvYWkvYWN0aXZlLXByb3ZpZGVyXCIpIHtcbiAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKFxuICAgICAgICBqc29uUmVzcG9uc2UoeyBwcm92aWRlcjogXCJvcGVucm91dGVyXCIsIGNvbmZpZ3VyZWQ6IHRydWUgfSksXG4gICAgICApO1xuICAgIH1cbiAgICBpZiAoXG4gICAgICBvdmVycmlkZXM/LmRlbGl2ZXJ5UmVjb3ZlcnkgJiZcbiAgICAgIHBhdGggPT09IFwiL2FwaS9haS9kZWxpdmVyeS9yZWNvdmVyYWJsZVwiXG4gICAgKSB7XG4gICAgICBvdmVycmlkZXMuZGVsaXZlcnlSZWNvdmVyeS5yZXF1ZXN0cy5wdXNoKHJvdXRlLnJlcXVlc3QoKS51cmwoKSk7XG4gICAgICByZXR1cm4gcm91dGUuZnVsZmlsbChcbiAgICAgICAganNvblJlc3BvbnNlKHsgb3BlcmF0aW9uczogb3ZlcnJpZGVzLmRlbGl2ZXJ5UmVjb3Zlcnkub3BlcmF0aW9ucyB9KSxcbiAgICAgICk7XG4gICAgfVxuICAgIGlmIChcbiAgICAgIG92ZXJyaWRlcz8uZGVsaXZlcnlSZWNvdmVyeT8ucmVjb3ZlcnlBY3Rpb24gJiZcbiAgICAgIHBhdGggPT09XG4gICAgICAgIGAvYXBpL2FpL2RlbGl2ZXJ5LyR7b3ZlcnJpZGVzLmRlbGl2ZXJ5UmVjb3ZlcnkucmVjb3ZlcnlBY3Rpb24ucHJvcG9zYWxJZH0vJHtvdmVycmlkZXMuZGVsaXZlcnlSZWNvdmVyeS5yZWNvdmVyeUFjdGlvbi5hY3Rpb259YFxuICAgICkge1xuICAgICAgb3ZlcnJpZGVzLmRlbGl2ZXJ5UmVjb3ZlcnkuYWN0aW9uUmVxdWVzdHM/LnB1c2gocm91dGUucmVxdWVzdCgpLnVybCgpKTtcbiAgICAgIGlmIChvdmVycmlkZXMuZGVsaXZlcnlSZWNvdmVyeS5yZWNvdmVyeUFjdGlvbi5uZXh0T3BlcmF0aW9ucykge1xuICAgICAgICBvdmVycmlkZXMuZGVsaXZlcnlSZWNvdmVyeS5vcGVyYXRpb25zID1cbiAgICAgICAgICBvdmVycmlkZXMuZGVsaXZlcnlSZWNvdmVyeS5yZWNvdmVyeUFjdGlvbi5uZXh0T3BlcmF0aW9ucztcbiAgICAgIH1cbiAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKFxuICAgICAgICBqc29uUmVzcG9uc2UoXG4gICAgICAgICAgb3ZlcnJpZGVzLmRlbGl2ZXJ5UmVjb3ZlcnkucmVjb3ZlcnlBY3Rpb24ucmVzcG9uc2UsXG4gICAgICAgICAgb3ZlcnJpZGVzLmRlbGl2ZXJ5UmVjb3ZlcnkucmVjb3ZlcnlBY3Rpb24uc3RhdHVzID8/IDQwOSxcbiAgICAgICAgKSxcbiAgICAgICk7XG4gICAgfVxuICAgIGlmIChwYXRoID09PSBcIi9hcGkvZXZlbnRzXCIpIHtcbiAgICAgIGNvbnN0IGV2ZW50cyA9IG92ZXJyaWRlcz8uZXZlbnRzID8/IGRhc2hib2FyZEZpeHR1cmUucmVjZW50RXZlbnRzO1xuICAgICAgY29uc3Qgc2VhcmNoID0gdXJsLnNlYXJjaFBhcmFtcy5nZXQoXCJzZWFyY2hcIik/LnRvTG93ZXJDYXNlKCk7XG4gICAgICBjb25zdCBmaWx0ZXJlZEV2ZW50cyA9IGV2ZW50cy5maWx0ZXIoKGV2ZW50KSA9PiB7XG4gICAgICAgIGNvbnN0IHByb2plY3RJZCA9IHVybC5zZWFyY2hQYXJhbXMuZ2V0KFwicHJvamVjdElkXCIpO1xuICAgICAgICBjb25zdCBzZXZlcml0eSA9IHVybC5zZWFyY2hQYXJhbXMuZ2V0KFwic2V2ZXJpdHlcIik7XG4gICAgICAgIGNvbnN0IGNvcnJlbGF0aW9uSWQgPSB1cmwuc2VhcmNoUGFyYW1zLmdldChcImNvcnJlbGF0aW9uSWRcIik7XG4gICAgICAgIHJldHVybiAoXG4gICAgICAgICAgKCFwcm9qZWN0SWQgfHwgZXZlbnQucHJvamVjdElkID09PSBwcm9qZWN0SWQpICYmXG4gICAgICAgICAgKCFzZXZlcml0eSB8fCBldmVudC5zZXZlcml0eSA9PT0gc2V2ZXJpdHkpICYmXG4gICAgICAgICAgKCFjb3JyZWxhdGlvbklkIHx8IGV2ZW50LmNvcnJlbGF0aW9uSWQgPT09IGNvcnJlbGF0aW9uSWQpICYmXG4gICAgICAgICAgKCFzZWFyY2ggfHxcbiAgICAgICAgICAgIFtldmVudC5tZXNzYWdlLCBldmVudC50eXBlLCBldmVudC5jb3JyZWxhdGlvbklkXVxuICAgICAgICAgICAgICAuZmlsdGVyKCh2YWx1ZSk6IHZhbHVlIGlzIHN0cmluZyA9PiB0eXBlb2YgdmFsdWUgPT09IFwic3RyaW5nXCIpXG4gICAgICAgICAgICAgIC5zb21lKCh2YWx1ZSkgPT4gdmFsdWUudG9Mb3dlckNhc2UoKS5pbmNsdWRlcyhzZWFyY2gpKSlcbiAgICAgICAgKTtcbiAgICAgIH0pO1xuICAgICAgY29uc3QgbGltaXQgPSBOdW1iZXIodXJsLnNlYXJjaFBhcmFtcy5nZXQoXCJsaW1pdFwiKSkgfHwgNTA7XG4gICAgICBjb25zdCBwYWdlID0gTnVtYmVyKHVybC5zZWFyY2hQYXJhbXMuZ2V0KFwicGFnZVwiKSkgfHwgMTtcbiAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKFxuICAgICAgICBqc29uUmVzcG9uc2Uoe1xuICAgICAgICAgIGV2ZW50czogZmlsdGVyZWRFdmVudHMuc2xpY2UoKHBhZ2UgLSAxKSAqIGxpbWl0LCBwYWdlICogbGltaXQpLFxuICAgICAgICAgIHRvdGFsOiBmaWx0ZXJlZEV2ZW50cy5sZW5ndGgsXG4gICAgICAgIH0pLFxuICAgICAgKTtcbiAgICB9XG4gICAgaWYgKFxuICAgICAgb3ZlcnJpZGVzPy5yZXN1bWVGYWlsdXJlICYmXG4gICAgICBwYXRoID09PVxuICAgICAgICBgL2FwaS9haS9leGVjdXRpb25zLyR7b3ZlcnJpZGVzLnJlc3VtZUZhaWx1cmUuZml4dHVyZS5leGVjdXRpb25JZH1gXG4gICAgKSB7XG4gICAgICByZXR1cm4gcm91dGUuZnVsZmlsbChqc29uUmVzcG9uc2Uob3ZlcnJpZGVzLnJlc3VtZUZhaWx1cmUuZXhlY3V0aW9uKSk7XG4gICAgfVxuICAgIGlmIChcbiAgICAgIG92ZXJyaWRlcz8uaW50ZXJydXB0ZWRSZXN1bWUgJiZcbiAgICAgIHBhdGggPT09XG4gICAgICAgIGAvYXBpL2FpL2V4ZWN1dGlvbnMvJHtvdmVycmlkZXMuaW50ZXJydXB0ZWRSZXN1bWUuZml4dHVyZS5leGVjdXRpb25JZH1gXG4gICAgKSB7XG4gICAgICByZXR1cm4gcm91dGUuZnVsZmlsbChqc29uUmVzcG9uc2Uob3ZlcnJpZGVzLmludGVycnVwdGVkUmVzdW1lLmV4ZWN1dGlvbikpO1xuICAgIH1cbiAgICBpZiAoXG4gICAgICBvdmVycmlkZXM/LmludGVycnVwdGVkUmVzdW1lICYmXG4gICAgICBwYXRoID09PVxuICAgICAgICBgL2FwaS9haS9leGVjdXRpb25zLyR7b3ZlcnJpZGVzLmludGVycnVwdGVkUmVzdW1lLmZpeHR1cmUuZXhlY3V0aW9uSWR9L3Jlc3VtZS1jYXBhYmlsaXR5YFxuICAgICkge1xuICAgICAgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoXG4gICAgICAgIGpzb25SZXNwb25zZSh7XG4gICAgICAgICAgZXhlY3V0aW9uSWQ6IG92ZXJyaWRlcy5pbnRlcnJ1cHRlZFJlc3VtZS5maXh0dXJlLmV4ZWN1dGlvbklkLFxuICAgICAgICAgIHJlc3VtZVRva2VuOiBvdmVycmlkZXMuaW50ZXJydXB0ZWRSZXN1bWUucmVjb3ZlcmVkVG9rZW4sXG4gICAgICAgIH0pLFxuICAgICAgKTtcbiAgICB9XG4gICAgaWYgKHBhdGggPT09IGAvYXBpL2FpL2V4ZWN1dGlvbnMvJHtFWEVDVVRJT05fSUR9YClcbiAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKFxuICAgICAgICBqc29uUmVzcG9uc2Uob3ZlcnJpZGVzPy5hdWRpdEV4cG9ydD8uZXhlY3V0aW9uID8/IGV4ZWN1dGlvbkZpeHR1cmUpLFxuICAgICAgKTtcbiAgICBpZiAocGF0aCA9PT0gXCIvYXBpL2FpL21pc3Npb24tY29udHJvbFwiKVxuICAgICAgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoXG4gICAgICAgIGpzb25SZXNwb25zZSh7IHVwZGF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAxOjAwLjAwMFpcIiwgZXhlY3V0aW9uczogW10gfSksXG4gICAgICApO1xuXG4gICAgLy8gQUkgaXMgZGVsaWJlcmF0ZWx5IG5vdCBleGVjdXRlZCBpbiB0aGlzIHNtb2tlIGpvdXJuZXkuIFRoaXMgcmVzcG9uc2VcbiAgICAvLyB2ZXJpZmllcyB0aGUgdXNlci12aXNpYmxlIHVuYXZhaWxhYmxlL2VtcHR5IHN0YXRlIHdpdGhvdXQgYSBwcm92aWRlci5cbiAgICBpZiAocGF0aC5zdGFydHNXaXRoKFwiL2FwaS9haS9cIikpXG4gICAgICByZXR1cm4gcm91dGUuZnVsZmlsbChcbiAgICAgICAganNvblJlc3BvbnNlKHsgZXJyb3I6IFwiQUkgcHJvdmlkZXIgbm90IGNvbmZpZ3VyZWRcIiB9LCA0MjgpLFxuICAgICAgKTtcblxuICAgIHJldHVybiByb3V0ZS5jb250aW51ZSgpO1xuICB9KTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gaW5zdGFsbEFyYWJpY0FpRml4dHVyZShcbiAgcGFnZTogUGFnZSxcbiAgb3B0aW9ucz86IHtcbiAgICBibG9ja2VkPzogYm9vbGVhbjtcbiAgICBzZXNzaW9uSWQ/OiBzdHJpbmc7XG4gICAgcXVlc3Rpb24/OiBzdHJpbmc7XG4gICAgcHJvamVjdElkPzogc3RyaW5nO1xuICB9LFxuKSB7XG4gIGNvbnN0IHNlc3Npb25JZCA9IG9wdGlvbnM/LnNlc3Npb25JZCA/PyBcImUyZS1hcmFiaWMtYWktc2Vzc2lvblwiO1xuICBjb25zdCBtZXNzYWdlSWQgPSBcImUyZS1hcmFiaWMtYWktbWVzc2FnZVwiO1xuICBjb25zdCBzb3VyY2UgPSBcInNyYy9leGVjdXRpb24tdG9vbHMudHNcIjtcbiAgY29uc3QgYmxvY2tlZCA9IG9wdGlvbnM/LmJsb2NrZWQgPT09IHRydWU7XG4gIGNvbnN0IHF1ZXN0aW9uID1cbiAgICBvcHRpb25zPy5xdWVzdGlvbiA/P1xuICAgIFwi2YXYp9iw2Kcg2YrYrdiv2Ksg2LnZhtivINin2YbYqtmH2KfYoSDZhdmH2YTYqSBwcm92aWRlciB0aW1lb3V0INiv2KfYrtmEIGV4ZWN1dGlvbi10b29scy50c9ifXCI7XG4gIGNvbnN0IGFuc3dlciA9XG4gICAgXCLYudmG2K8g2KfZhtiq2YfYp9ihINmF2YfZhNipINmF2LLZiNivINin2YTYsNmD2KfYoSDYp9mE2KfYtdi32YbYp9i52YrYjCDZiti52YrYryDYp9mE2YXYs9in2LEg2KrZgtix2YrYsdmL2Kcg2KzYstim2YrZi9inINmF2YYg2KfZhNij2K/ZhNipINin2YTYqtmKINis2Y/Zhdi52Kog2KjYr9mEINil2LXYr9in2LEgRmluZGluZyDYutmK2LEg2YXYq9io2KouXCI7XG4gIGNvbnN0IGV2aWRlbmNlID0gW1xuICAgIHtcbiAgICAgIHNvdXJjZSxcbiAgICAgIC4uLihibG9ja2VkXG4gICAgICAgID8ge1xuICAgICAgICAgICAgZXhjZXJwdDogXCJwcm92aWRlciB0aW1lb3V0IGlzIGhhbmRsZWQgaGVyZVwiLFxuICAgICAgICAgICAgc3VwcG9ydHNDbGFpbTogZmFsc2UsXG4gICAgICAgICAgICBldmlkZW5jZUNsYXNzOiBcIlJFQURfQ09ORklSTUVEXCIsXG4gICAgICAgICAgICBjaXRhdGlvblN0YXR1czogXCJCTE9DS0VEXCIsXG4gICAgICAgICAgICBjaXRhdGlvblJlYXNvbjogXCJNSVNTSU5HX0xJVEVSQUxfTUFUQ0hcIixcbiAgICAgICAgICB9XG4gICAgICAgIDoge1xuICAgICAgICAgICAgZXhjZXJwdDogJ3JldHVybiBwYXJ0aWFsRnJvbUNvbGxlY3RlZEV2aWRlbmNlKFwicHJvdmlkZXIgdGltZW91dFwiKTsnLFxuICAgICAgICAgICAgc291cmNlU3BhbjogeyBzdGFydExpbmU6IDQyLCBlbmRMaW5lOiA0MiB9LFxuICAgICAgICAgICAgc3VwcG9ydHNDbGFpbTogdHJ1ZSxcbiAgICAgICAgICAgIGV2aWRlbmNlQ2xhc3M6IFwiQkVIQVZJT1JfUFJPVkVOXCIsXG4gICAgICAgICAgICBjaXRhdGlvblN0YXR1czogXCJBQ0NFUFRFRFwiLFxuICAgICAgICAgICAgY2l0YXRpb25SZWFzb246IFwiQUNDRVBURURfU09VUkNFX1NQQU5cIixcbiAgICAgICAgICB9KSxcbiAgICB9LFxuICBdO1xuICBjb25zdCB0b29sVHJhY2UgPSBbXG4gICAge1xuICAgICAga2luZDogXCJ0b29sX2NhbGxcIixcbiAgICAgIHRvb2w6IFwicmVhZF9maWxlXCIsXG4gICAgICBhcmdzOiB7IHBhdGg6IHNvdXJjZSB9LFxuICAgICAgY2FjaGVkOiBmYWxzZSxcbiAgICAgIHByZWZldGNoZWQ6IHRydWUsXG4gICAgfSxcbiAgICB7XG4gICAgICBraW5kOiBcInRvb2xfcmVzdWx0XCIsXG4gICAgICB0b29sOiBcInJlYWRfZmlsZVwiLFxuICAgICAgc291cmNlLFxuICAgICAgY2FjaGVkOiBmYWxzZSxcbiAgICAgIHByZWZldGNoZWQ6IHRydWUsXG4gICAgfSxcbiAgICB7XG4gICAgICBraW5kOiBcImV2aWRlbmNlX2ludGVncml0eVwiLFxuICAgICAgY29kZTogXCJFVklERU5DRV9JTlRFR1JJVFlfT0tcIixcbiAgICAgIGNvbnNpc3RlbnQ6IHRydWUsXG4gICAgICB2aW9sYXRpb25zOiBbXSxcbiAgICAgIGV2aWRlbmNlRmlsZUNvdW50OiAxLFxuICAgICAgYWNjZXB0ZWRFdmlkZW5jZUNvdW50OiAxLFxuICAgICAgY29tcGxldGVkUmVhZEZpbGVzOiBbc291cmNlXSxcbiAgICAgIGFjY2VwdGVkRXZpZGVuY2VGaWxlczogW3NvdXJjZV0sXG4gICAgICBvYmplY3RpdmVUeXBlOiBcIlBST0RVQ1RJT05fUkVBQ0hBQklMSVRZXCIsXG4gICAgICByZXF1aXJlZEVkZ2VzOiBbXCJjbGllbnQtPnNlcnZlclwiLCBcInNlcnZlci0+ZGF0YWJhc2VcIl0sXG4gICAgICBwcm92ZW5FZGdlczogW1wiY2xpZW50LT5zZXJ2ZXJcIl0sXG4gICAgICBjb21wbGV0aW9uR2F0ZVJlc3VsdDogXCJQQVJUSUFMTFlfUFJPVkVOXCIsXG4gICAgICBmaW5hbEFuc3dlclR5cGU6IFwiUFJPRFVDVElPTl9SRUFDSEFCSUxJVFlfQU5TV0VSXCIsXG4gICAgfSxcbiAgXTtcbiAgY29uc3QgdGFza1Jlc3VsdCA9IHtcbiAgICBraW5kOiBcIkJFSEFWSU9SX0FOU1dFUl9SRVNVTFRcIixcbiAgICBhbnN3ZXI6IHtcbiAgICAgIGFuc3dlcixcbiAgICAgIGV2aWRlbmNlLFxuICAgICAgY29uZmlkZW5jZTogMSxcbiAgICAgIHNvdXJjZVNjb3BlOiBbc291cmNlXSxcbiAgICAgIGNvdmVyYWdlOiB7XG4gICAgICAgIHJlcXVlc3RlZEZpZWxkczogW1widGltZW91dCBiZWhhdmlvclwiXSxcbiAgICAgICAgYW5zd2VyZWRGaWVsZHM6IFtcInRpbWVvdXQgYmVoYXZpb3JcIl0sXG4gICAgICAgIG1pc3NpbmdGaWVsZHM6IFtdLFxuICAgICAgICBjb21wbGV0ZTogdHJ1ZSxcbiAgICAgIH0sXG4gICAgfSxcbiAgfTtcbiAgY29uc3QgbWVzc2FnZSA9IHtcbiAgICBpZDogbWVzc2FnZUlkLFxuICAgIHNlc3Npb25JZCxcbiAgICByb2xlOiBcImFzc2lzdGFudFwiLFxuICAgIGNvbnRlbnQ6IGAke2Fuc3dlcn1cXG5cXG4jIyA2KSBGaW5hbCBKdWRnbWVudFxcbk5PVCBQUk9WRU5gLFxuICAgIG9wZXJhdGlvbk1vZGU6IFwiRk9SRU5TSUNfQVVESVRcIixcbiAgICBzb3VyY2VzOiBbc291cmNlXSxcbiAgICB0b29sVHJhY2U6IEpTT04uc3RyaW5naWZ5KHRvb2xUcmFjZSksXG4gICAgYmVoYXZpb3JFdmlkZW5jZTogZXZpZGVuY2UsXG4gICAgdGFza1Jlc3VsdCxcbiAgICBjcmVhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMjowMC4wMDBaXCIsXG4gIH07XG4gIGNvbnN0IHNzZSA9IChldmVudDogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pID0+XG4gICAgYGRhdGE6ICR7SlNPTi5zdHJpbmdpZnkoZXZlbnQpfVxcblxcbmA7XG4gIGNvbnN0IHN0cmVhbUJvZHkgPSBbXG4gICAgc3NlKHsgdHlwZTogXCJzZXNzaW9uX3N0YXJ0ZWRcIiwgc2Vzc2lvbklkIH0pLFxuICAgIHNzZSh7XG4gICAgICB0eXBlOiBcImV4ZWN1dGlvbl9zdGFydGVkXCIsXG4gICAgICBleGVjdXRpb25JZDogXCJlMmUtZXhlY3V0aW9uXCIsXG4gICAgICBzdGF0dXM6IFwicnVubmluZ1wiLFxuICAgICAgcmVzdW1hYmxlOiB0cnVlLFxuICAgIH0pLFxuICAgIHNzZSh7IHR5cGU6IFwic3RhZ2VcIiwgc3RhZ2U6IFwiYnVpbGRpbmctY29udGV4dFwiIH0pLFxuICAgIHNzZSh7IHR5cGU6IFwic3RhZ2VcIiwgc3RhZ2U6IFwiY2FsbGluZy1tb2RlbFwiIH0pLFxuICAgIHNzZSh7XG4gICAgICB0eXBlOiBcInRvb2xfY2FsbFwiLFxuICAgICAgdG9vbDogXCJyZWFkX2ZpbGVcIixcbiAgICAgIGFyZ3M6IHsgcGF0aDogc291cmNlIH0sXG4gICAgICBjYWNoZWQ6IGZhbHNlLFxuICAgICAgcHJlZmV0Y2hlZDogdHJ1ZSxcbiAgICB9KSxcbiAgICBzc2Uoe1xuICAgICAgdHlwZTogXCJ0b29sX3Jlc3VsdFwiLFxuICAgICAgdG9vbDogXCJyZWFkX2ZpbGVcIixcbiAgICAgIHNvdXJjZSxcbiAgICAgIGNhY2hlZDogZmFsc2UsXG4gICAgICBwcmVmZXRjaGVkOiB0cnVlLFxuICAgIH0pLFxuICAgIHNzZSh7XG4gICAgICB0eXBlOiBcImV2aWRlbmNlX2ludGVncml0eVwiLFxuICAgICAgY29kZTogXCJFVklERU5DRV9JTlRFR1JJVFlfT0tcIixcbiAgICAgIGNvbnNpc3RlbnQ6IHRydWUsXG4gICAgICB2aW9sYXRpb25zOiBbXSxcbiAgICAgIGV2aWRlbmNlRmlsZUNvdW50OiAxLFxuICAgICAgYWNjZXB0ZWRFdmlkZW5jZUNvdW50OiAxLFxuICAgICAgY29tcGxldGVkUmVhZEZpbGVzOiBbc291cmNlXSxcbiAgICAgIGFjY2VwdGVkRXZpZGVuY2VGaWxlczogW3NvdXJjZV0sXG4gICAgICBvYmplY3RpdmVUeXBlOiBcIlBST0RVQ1RJT05fUkVBQ0hBQklMSVRZXCIsXG4gICAgICByZXF1aXJlZEVkZ2VzOiBbXCJjbGllbnQtPnNlcnZlclwiLCBcInNlcnZlci0+ZGF0YWJhc2VcIl0sXG4gICAgICBwcm92ZW5FZGdlczogW1wiY2xpZW50LT5zZXJ2ZXJcIl0sXG4gICAgICBjb21wbGV0aW9uR2F0ZVJlc3VsdDogXCJQQVJUSUFMTFlfUFJPVkVOXCIsXG4gICAgICBmaW5hbEFuc3dlclR5cGU6IFwiUFJPRFVDVElPTl9SRUFDSEFCSUxJVFlfQU5TV0VSXCIsXG4gICAgfSksXG4gICAgc3NlKHsgdHlwZTogXCJkZWx0YVwiLCBkZWx0YTogYW5zd2VyIH0pLFxuICAgIHNzZSh7XG4gICAgICB0eXBlOiBcImRvbmVcIixcbiAgICAgIHNlc3Npb25JZCxcbiAgICAgIG1lc3NhZ2UsXG4gICAgICBzb3VyY2VzOiBbc291cmNlXSxcbiAgICAgIHRvb2xUcmFjZTogSlNPTi5zdHJpbmdpZnkodG9vbFRyYWNlKSxcbiAgICAgIGJlaGF2aW9yRXZpZGVuY2U6IGV2aWRlbmNlLFxuICAgICAgdGFza1Jlc3VsdCxcbiAgICAgIHBlbmRpbmdDaGFuZ2VzOiBbXSxcbiAgICB9KSxcbiAgXS5qb2luKFwiXCIpO1xuXG4gIHJldHVybiB7XG4gICAgcXVlc3Rpb24sXG4gICAgYW5zd2VyLFxuICAgIHNvdXJjZSxcbiAgICBzZXNzaW9uSWQsXG4gICAgcHJvamVjdElkOiBvcHRpb25zPy5wcm9qZWN0SWQsXG4gICAgc3RyZWFtQm9keSxcbiAgICBtZXNzYWdlLFxuICB9O1xufVxuXG5mdW5jdGlvbiBpbnN0YWxsVG9vbEZhaWx1cmVGaXh0dXJlKCk6IEFyYWJpY0FpRml4dHVyZSB7XG4gIGNvbnN0IHNlc3Npb25JZCA9IFwiZTJlLXRvb2wtZmFpbHVyZS1zZXNzaW9uXCI7XG4gIGNvbnN0IG1lc3NhZ2VJZCA9IFwiZTJlLXRvb2wtZmFpbHVyZS1tZXNzYWdlXCI7XG4gIGNvbnN0IHNvdXJjZSA9IFwic3JjL21pc3NpbmctcmVsZWFzZS1maXh0dXJlLnRzXCI7XG4gIGNvbnN0IHF1ZXN0aW9uID0gXCJXaGljaCBzb3VyY2UgZmlsZSBpcyBhdmFpbGFibGUgZm9yIHRoZSByZWxlYXNlIGNoZWNrP1wiO1xuICBjb25zdCBhbnN3ZXIgPVxuICAgIFwiQU5BTFlTSVNfSU5DT01QTEVURTogVGhlIHJlcXVpcmVkIHNvdXJjZSByZWFkIGRpZCBub3QgY29tcGxldGUsIHNvIG5vIHZlcmlmaWVkIHJlc3VsdCBpcyBhdmFpbGFibGUuXCI7XG4gIGNvbnN0IGRpYWdub3N0aWNDb2RlID0gXCJUT09MX0VYRUNVVElPTl9GQUlMRURcIjtcbiAgY29uc3QgdG9vbFRyYWNlID0gW1xuICAgIHtcbiAgICAgIGtpbmQ6IFwidG9vbF9jYWxsXCIsXG4gICAgICB0b29sOiBcInJlYWRfZmlsZVwiLFxuICAgICAgYXJnczogeyBwYXRoOiBzb3VyY2UgfSxcbiAgICAgIGNhY2hlZDogZmFsc2UsXG4gICAgfSxcbiAgICB7XG4gICAgICBraW5kOiBcInRvb2xfcmVzdWx0XCIsXG4gICAgICB0b29sOiBcInJlYWRfZmlsZVwiLFxuICAgICAgc291cmNlLFxuICAgICAgcmVzdWx0S2luZDogXCJmYWlsZWRcIixcbiAgICAgIGRpYWdub3N0aWNDb2RlLFxuICAgICAgcmVzdWx0U3VtbWFyeTogXCJUaGUgcmVxdWlyZWQgc291cmNlIHJlYWQgZGlkIG5vdCBjb21wbGV0ZS5cIixcbiAgICB9LFxuICAgIHtcbiAgICAgIGtpbmQ6IFwiZG9uZVwiLFxuICAgICAgc3RvcFJlYXNvbjogXCJ0b29sX2ZhaWx1cmVcIixcbiAgICAgIGl0ZXJhdGlvbnM6IDEsXG4gICAgICBtYXhJdGVyYXRpb25zOiA4LFxuICAgICAgdG9vbENhbGxzOiAxLFxuICAgICAgcHJlZmV0Y2hUb29sQ2FsbHM6IDAsXG4gICAgICBsb29wVG9vbENhbGxzOiAxLFxuICAgICAgc3ludGhlc2lzU3RhcnRlZDogZmFsc2UsXG4gICAgICBkaWFnbm9zdGljQ29kZXM6IFtkaWFnbm9zdGljQ29kZV0sXG4gICAgfSxcbiAgXTtcbiAgY29uc3QgbWVzc2FnZSA9IHtcbiAgICBpZDogbWVzc2FnZUlkLFxuICAgIHNlc3Npb25JZCxcbiAgICByb2xlOiBcImFzc2lzdGFudFwiLFxuICAgIGNvbnRlbnQ6IGFuc3dlcixcbiAgICB0b29sVHJhY2U6IEpTT04uc3RyaW5naWZ5KHRvb2xUcmFjZSksXG4gICAgY3JlYXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDI6MDAuMDAwWlwiLFxuICB9O1xuICBjb25zdCBzc2UgPSAoZXZlbnQ6IFJlY29yZDxzdHJpbmcsIHVua25vd24+KSA9PlxuICAgIGBkYXRhOiAke0pTT04uc3RyaW5naWZ5KGV2ZW50KX1cXG5cXG5gO1xuICBjb25zdCBzdHJlYW1Cb2R5ID0gW1xuICAgIHNzZSh7IHR5cGU6IFwic2Vzc2lvbl9zdGFydGVkXCIsIHNlc3Npb25JZCB9KSxcbiAgICBzc2Uoe1xuICAgICAgdHlwZTogXCJleGVjdXRpb25fc3RhcnRlZFwiLFxuICAgICAgZXhlY3V0aW9uSWQ6IFwiZTJlLXRvb2wtZmFpbHVyZS1leGVjdXRpb25cIixcbiAgICAgIHN0YXR1czogXCJydW5uaW5nXCIsXG4gICAgICByZXN1bWFibGU6IHRydWUsXG4gICAgfSksXG4gICAgc3NlKHtcbiAgICAgIHR5cGU6IFwidG9vbF9jYWxsXCIsXG4gICAgICB0b29sOiBcInJlYWRfZmlsZVwiLFxuICAgICAgYXJnczogeyBwYXRoOiBzb3VyY2UgfSxcbiAgICAgIGNhY2hlZDogZmFsc2UsXG4gICAgfSksXG4gICAgc3NlKHtcbiAgICAgIHR5cGU6IFwidG9vbF9yZXN1bHRcIixcbiAgICAgIHRvb2w6IFwicmVhZF9maWxlXCIsXG4gICAgICBzb3VyY2UsXG4gICAgICByZXN1bHRLaW5kOiBcImZhaWxlZFwiLFxuICAgICAgZGlhZ25vc3RpY0NvZGUsXG4gICAgICByZXN1bHRTdW1tYXJ5OiBcIlRoZSByZXF1aXJlZCBzb3VyY2UgcmVhZCBkaWQgbm90IGNvbXBsZXRlLlwiLFxuICAgIH0pLFxuICAgIHNzZSh7IHR5cGU6IFwiZGVsdGFcIiwgZGVsdGE6IGFuc3dlciB9KSxcbiAgICBzc2Uoe1xuICAgICAgdHlwZTogXCJkb25lXCIsXG4gICAgICBzZXNzaW9uSWQsXG4gICAgICBtZXNzYWdlLFxuICAgICAgdG9vbFRyYWNlOiBKU09OLnN0cmluZ2lmeSh0b29sVHJhY2UpLFxuICAgICAgcGVuZGluZ0NoYW5nZXM6IFtdLFxuICAgIH0pLFxuICBdLmpvaW4oXCJcIik7XG5cbiAgcmV0dXJuIHtcbiAgICBxdWVzdGlvbixcbiAgICBhbnN3ZXIsXG4gICAgc291cmNlLFxuICAgIHNlc3Npb25JZCxcbiAgICBzdHJlYW1Cb2R5LFxuICAgIG1lc3NhZ2UsXG4gIH07XG59XG5cbmZ1bmN0aW9uIGluc3RhbGxEaXNjb25uZWN0ZWRBaUZpeHR1cmUoKTogQXJhYmljQWlGaXh0dXJlIHtcbiAgY29uc3Qgc2Vzc2lvbklkID0gXCJlMmUtZGlzY29ubmVjdGVkLWFpLXNlc3Npb25cIjtcbiAgY29uc3QgZXhlY3V0aW9uSWQgPSBcImUyZS1kaXNjb25uZWN0ZWQtYWktZXhlY3V0aW9uXCI7XG4gIGNvbnN0IHF1ZXN0aW9uID1cbiAgICBcIldoYXQgaGFwcGVucyB3aGVuIHRoZSBtb2RlbCBkaXNjb25uZWN0cyBhZnRlciBzdGFydGluZyBhbiBhbnN3ZXI/XCI7XG4gIGNvbnN0IGFuc3dlciA9XG4gICAgXCJUaGUgbW9kZWwgc3RhcnRlZCBhbiBhbnN3ZXIsIGJ1dCB0aGUgcHJvdmlkZXIgZGlzY29ubmVjdGVkIGJlZm9yZSBjb21wbGV0aW9uLlwiO1xuICBjb25zdCBkaWFnbm9zdGljQ29kZSA9IFwiRVhFQ1VUSU9OX1BST1ZJREVSX0ZBSUxVUkVcIjtcbiAgY29uc3QgdG9vbFRyYWNlID0gW1xuICAgIHtcbiAgICAgIGtpbmQ6IFwiZG9uZVwiLFxuICAgICAgc3RvcFJlYXNvbjogXCJwcm92aWRlcl90aW1lb3V0XCIsXG4gICAgICBpdGVyYXRpb25zOiAxLFxuICAgICAgbWF4SXRlcmF0aW9uczogOCxcbiAgICAgIHRvb2xDYWxsczogMCxcbiAgICAgIHByZWZldGNoVG9vbENhbGxzOiAwLFxuICAgICAgbG9vcFRvb2xDYWxsczogMCxcbiAgICAgIHN5bnRoZXNpc1N0YXJ0ZWQ6IGZhbHNlLFxuICAgICAgZGlhZ25vc3RpY0NvZGVzOiBbZGlhZ25vc3RpY0NvZGVdLFxuICAgICAgZGlhZ25vc3RpY0RldGFpbHM6IFtcbiAgICAgICAgXCJUaGUgcHJvdmlkZXIgZGlzY29ubmVjdGVkIGFmdGVyIHZpc2libGUgcmVzcG9uc2UgdGV4dC5cIixcbiAgICAgIF0sXG4gICAgfSxcbiAgXTtcbiAgY29uc3QgbWVzc2FnZSA9IHtcbiAgICBpZDogXCJlMmUtZGlzY29ubmVjdGVkLWFpLW1lc3NhZ2VcIixcbiAgICBzZXNzaW9uSWQsXG4gICAgcm9sZTogXCJhc3Npc3RhbnRcIixcbiAgICBjb250ZW50OiBhbnN3ZXIsXG4gICAgdG9vbFRyYWNlOiBKU09OLnN0cmluZ2lmeSh0b29sVHJhY2UpLFxuICAgIG91dGNvbWU6IFwiRkFJTEVEXCIsXG4gICAgZXJyb3JDb2RlOiBkaWFnbm9zdGljQ29kZSxcbiAgICBlcnJvck1lc3NhZ2U6IFwiVGhlIHByb3ZpZGVyIGRpc2Nvbm5lY3RlZCBiZWZvcmUgY29tcGxldGlvbi5cIixcbiAgICBleGVjdXRpb25JZCxcbiAgICBjcmVhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMjowMC4wMDBaXCIsXG4gIH07XG4gIGNvbnN0IHNzZSA9IChldmVudDogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pID0+XG4gICAgYGRhdGE6ICR7SlNPTi5zdHJpbmdpZnkoZXZlbnQpfVxcblxcbmA7XG4gIGNvbnN0IHN0cmVhbUJvZHkgPSBbXG4gICAgc3NlKHsgdHlwZTogXCJzZXNzaW9uX3N0YXJ0ZWRcIiwgc2Vzc2lvbklkIH0pLFxuICAgIHNzZSh7XG4gICAgICB0eXBlOiBcImV4ZWN1dGlvbl9zdGFydGVkXCIsXG4gICAgICBleGVjdXRpb25JZCxcbiAgICAgIHN0YXR1czogXCJydW5uaW5nXCIsXG4gICAgICByZXN1bWFibGU6IHRydWUsXG4gICAgfSksXG4gICAgc3NlKHsgdHlwZTogXCJzdGFnZVwiLCBzdGFnZTogXCJjYWxsaW5nLW1vZGVsXCIgfSksXG4gICAgc3NlKHsgdHlwZTogXCJkZWx0YVwiLCBkZWx0YTogYW5zd2VyIH0pLFxuICAgIC8vIFRoZSByZWFsIHJvdXRlIGVtaXRzIHRoaXMgYWZ0ZXIgYSBwcm92aWRlciBkaXNjb25uZWN0IHNvIHRoZSBjbGllbnRcbiAgICAvLyBkcm9wcyB0aGUgdHJhbnNpZW50IGJ1YmJsZSBiZWZvcmUgcmVuZGVyaW5nIHRoZSBwZXJzaXN0ZWQgcmVzdWx0LlxuICAgIHNzZSh7IHR5cGU6IFwic3RyZWFtX3Jlc2V0XCIgfSksXG4gICAgc3NlKHtcbiAgICAgIHR5cGU6IFwiZG9uZVwiLFxuICAgICAgc2Vzc2lvbklkLFxuICAgICAgZXhlY3V0aW9uSWQsXG4gICAgICBtZXNzYWdlLFxuICAgICAgcGVuZGluZ0NoYW5nZXM6IFtdLFxuICAgIH0pLFxuICBdLmpvaW4oXCJcIik7XG5cbiAgcmV0dXJuIHtcbiAgICBxdWVzdGlvbixcbiAgICBhbnN3ZXIsXG4gICAgc291cmNlOiBcInByb3ZpZGVyXCIsXG4gICAgc2Vzc2lvbklkLFxuICAgIGV4ZWN1dGlvbklkLFxuICAgIHN0cmVhbUJvZHksXG4gICAgbWVzc2FnZSxcbiAgfTtcbn1cblxuZnVuY3Rpb24gaW5zdGFsbFJlc3VtZWRBbmFseXNpc0ZhaWx1cmVGaXh0dXJlKCkge1xuICBjb25zdCBzZXNzaW9uSWQgPSBcImUyZS1yZXN1bWVkLWFuYWx5c2lzLWZhaWx1cmUtc2Vzc2lvblwiO1xuICBjb25zdCBleGVjdXRpb25JZCA9IFwiZTJlLXJlc3VtZWQtYW5hbHlzaXMtZmFpbHVyZS1leGVjdXRpb25cIjtcbiAgY29uc3QgcmVzdW1lVG9rZW4gPSBcImUyZS1yZXN1bWVkLWFuYWx5c2lzLWZhaWx1cmUtdG9rZW4tb3BhcXVlXCI7XG4gIGNvbnN0IHF1ZXN0aW9uID0gXCJWZXJpZnkgdGhlIGFuYWx5c2lzIGV2aWRlbmNlIGFmdGVyIHJlY29ubmVjdC5cIjtcbiAgY29uc3QgYW5zd2VyID1cbiAgICBcIkFOQUxZU0lTX0lOQ09NUExFVEU6IFRoZSByZXF1aXJlZCBhbmFseXNpcyBkaWQgbm90IGNvbXBsZXRlLCBzbyBubyB2ZXJpZmllZCByZXN1bHQgaXMgYXZhaWxhYmxlLlwiO1xuICBjb25zdCBkaWFnbm9zdGljQ29kZSA9IFwiVE9PTF9VTkFWQUlMQUJMRVwiO1xuICBjb25zdCBzc2UgPSAoZXZlbnQ6IFJlY29yZDxzdHJpbmcsIHVua25vd24+KSA9PlxuICAgIGBkYXRhOiAke0pTT04uc3RyaW5naWZ5KGV2ZW50KX1cXG5cXG5gO1xuICBjb25zdCBzdHJlYW1Cb2R5ID0gW1xuICAgIHNzZSh7IHR5cGU6IFwic2Vzc2lvbl9zdGFydGVkXCIsIHNlc3Npb25JZCB9KSxcbiAgICBzc2Uoe1xuICAgICAgdHlwZTogXCJleGVjdXRpb25fc3RhcnRlZFwiLFxuICAgICAgZXhlY3V0aW9uSWQsXG4gICAgICBzdGF0dXM6IFwicnVubmluZ1wiLFxuICAgICAgcmVzdW1hYmxlOiB0cnVlLFxuICAgICAgcmVzdW1lVG9rZW4sXG4gICAgfSksXG4gICAgc3NlKHtcbiAgICAgIHR5cGU6IFwiZXJyb3JcIixcbiAgICAgIGV4ZWN1dGlvbklkLFxuICAgICAgY29kZTogZGlhZ25vc3RpY0NvZGUsXG4gICAgICBtZXNzYWdlOiBcIlRoZSByZXF1aXJlZCBhbmFseXNpcyBkaWQgbm90IGNvbXBsZXRlLlwiLFxuICAgIH0pLFxuICBdLmpvaW4oXCJcIik7XG4gIGNvbnN0IGZpeHR1cmU6IEFyYWJpY0FpRml4dHVyZSA9IHtcbiAgICBxdWVzdGlvbixcbiAgICBhbnN3ZXIsXG4gICAgc291cmNlOiBcInNyYy9taXNzaW5nLWFuYWx5c2lzLXRvb2wudHNcIixcbiAgICBzZXNzaW9uSWQsXG4gICAgZXhlY3V0aW9uSWQsXG4gICAgc3RyZWFtQm9keSxcbiAgICBtZXNzYWdlOiB7XG4gICAgICBpZDogXCJlMmUtcmVzdW1lZC1hbmFseXNpcy1mYWlsdXJlLW1lc3NhZ2VcIixcbiAgICAgIHNlc3Npb25JZCxcbiAgICAgIHJvbGU6IFwiYXNzaXN0YW50XCIsXG4gICAgICBjb250ZW50OiBhbnN3ZXIsXG4gICAgICBvdXRjb21lOiBcIkZBSUxFRFwiLFxuICAgICAgZXhlY3V0aW9uSWQsXG4gICAgICBlcnJvckNvZGU6IGRpYWdub3N0aWNDb2RlLFxuICAgICAgZXJyb3JNZXNzYWdlOiBcIlRoZSByZXF1aXJlZCBhbmFseXNpcyBkaWQgbm90IGNvbXBsZXRlLlwiLFxuICAgICAgY3JlYXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDI6MDAuMDAwWlwiLFxuICAgIH0sXG4gIH07XG5cbiAgcmV0dXJuIHtcbiAgICBmaXh0dXJlLFxuICAgIGV4ZWN1dGlvbjoge1xuICAgICAgaWQ6IGV4ZWN1dGlvbklkLFxuICAgICAgcHJvamVjdElkOiBcImUyZS1wcm9qZWN0XCIsXG4gICAgICBvcGVyYXRpb25JZDogXCJlMmUtcmVzdW1lZC1hbmFseXNpcy1mYWlsdXJlLW9wZXJhdGlvblwiLFxuICAgICAgc2Vzc2lvbklkLFxuICAgICAgc3RhdHVzOiBcImZhaWxlZFwiLFxuICAgICAgZmxpZ2h0U3RhdGU6IFwiRkFJTEVEXCIsXG4gICAgICBldmlkZW5jZVZlcmRpY3Q6IFwiSU5DT01QTEVURVwiLFxuICAgICAgcHJvb2ZSZXF1aXJlZDogdHJ1ZSxcbiAgICAgIHJlc3VtYWJsZTogdHJ1ZSxcbiAgICAgIGNoZWNrcG9pbnRWZXJzaW9uOiAxLFxuICAgICAgY2hlY2twb2ludDoge1xuICAgICAgICBzdGFnZTogXCJ0b29sLWV4ZWN1dGlvblwiLFxuICAgICAgICBkZXRhaWw6IFwiVGhlIHJlcXVpcmVkIGFuYWx5c2lzIHRvb2wgd2FzIHVuYXZhaWxhYmxlLlwiLFxuICAgICAgfSxcbiAgICAgIG9iamVjdGl2ZTogeyBvYmplY3RpdmU6IHF1ZXN0aW9uIH0sXG4gICAgICBlcnJvcjogXCJUaGUgcmVxdWlyZWQgYW5hbHlzaXMgZGlkIG5vdCBjb21wbGV0ZS5cIixcbiAgICAgIHN0YXJ0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAxOjAwLjAwMFpcIixcbiAgICAgIGNyZWF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAxOjAwLjAwMFpcIixcbiAgICAgIHVwZGF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAyOjAwLjAwMFpcIixcbiAgICB9LFxuICB9O1xufVxuXG5mdW5jdGlvbiBpbnN0YWxsSW50ZXJydXB0ZWRSZXN1bWVGaXh0dXJlKCkge1xuICBjb25zdCBzZXNzaW9uSWQgPSBcImUyZS1pbnRlcnJ1cHRlZC1yZXN1bWUtc2Vzc2lvblwiO1xuICBjb25zdCBleGVjdXRpb25JZCA9IFwiZTJlLWludGVycnVwdGVkLXJlc3VtZS1leGVjdXRpb25cIjtcbiAgY29uc3QgaW5pdGlhbFRva2VuID0gXCJlMmUtaW50ZXJydXB0ZWQtaW5pdGlhbC10b2tlblwiO1xuICBjb25zdCByZWNvdmVyZWRUb2tlbiA9IFwiZTJlLWludGVycnVwdGVkLXJlY292ZXJlZC10b2tlblwiO1xuICBjb25zdCBxdWVzdGlvbiA9IFwiQ29udGludWUgdGhlIGludGVycnVwdGVkIHJlbGVhc2UgZXhlY3V0aW9uLlwiO1xuICBjb25zdCBwYXJ0aWFsQW5zd2VyID1cbiAgICBcIlRoZSByZWxlYXNlIGV4ZWN1dGlvbiBzdGFydGVkIGJlZm9yZSB0aGUgYnJvd3NlciBkaXNjb25uZWN0ZWQuXCI7XG4gIGNvbnN0IGFuc3dlciA9XG4gICAgXCJUaGUgb3JpZ2luYWwgcmVsZWFzZSBleGVjdXRpb24gcmVzdW1lZCBhZnRlciBjYXBhYmlsaXR5IHJlY292ZXJ5LlwiO1xuICBjb25zdCBtZXNzYWdlID0ge1xuICAgIGlkOiBcImUyZS1pbnRlcnJ1cHRlZC1yZXN1bWUtbWVzc2FnZVwiLFxuICAgIHNlc3Npb25JZCxcbiAgICByb2xlOiBcImFzc2lzdGFudFwiLFxuICAgIGNvbnRlbnQ6IGFuc3dlcixcbiAgICBleGVjdXRpb25JZCxcbiAgICBvdXRjb21lOiBcIkNPTVBMRVRFRFwiLFxuICAgIGNyZWF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAzOjAwLjAwMFpcIixcbiAgfTtcbiAgY29uc3Qgc3NlID0gKGV2ZW50OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPikgPT5cbiAgICBgZGF0YTogJHtKU09OLnN0cmluZ2lmeShldmVudCl9XFxuXFxuYDtcbiAgY29uc3QgZml4dHVyZTogQXJhYmljQWlGaXh0dXJlID0ge1xuICAgIHF1ZXN0aW9uLFxuICAgIGFuc3dlcixcbiAgICBzb3VyY2U6IFwicmVsZWFzZS1yZXN1bWVcIixcbiAgICBzZXNzaW9uSWQsXG4gICAgZXhlY3V0aW9uSWQsXG4gICAgc3RyZWFtQm9keTogW1xuICAgICAgc3NlKHsgdHlwZTogXCJzZXNzaW9uX3N0YXJ0ZWRcIiwgc2Vzc2lvbklkIH0pLFxuICAgICAgc3NlKHtcbiAgICAgICAgdHlwZTogXCJleGVjdXRpb25fc3RhcnRlZFwiLFxuICAgICAgICBleGVjdXRpb25JZCxcbiAgICAgICAgc3RhdHVzOiBcInJ1bm5pbmdcIixcbiAgICAgICAgcmVzdW1hYmxlOiB0cnVlLFxuICAgICAgICByZXN1bWVUb2tlbjogaW5pdGlhbFRva2VuLFxuICAgICAgfSksXG4gICAgICBzc2UoeyB0eXBlOiBcInN0YWdlXCIsIHN0YWdlOiBcImNhbGxpbmctbW9kZWxcIiB9KSxcbiAgICAgIHNzZSh7IHR5cGU6IFwiZGVsdGFcIiwgZGVsdGE6IHBhcnRpYWxBbnN3ZXIgfSksXG4gICAgXS5qb2luKFwiXCIpLFxuICAgIG1lc3NhZ2UsXG4gIH07XG4gIHJldHVybiB7XG4gICAgZml4dHVyZSxcbiAgICBpbml0aWFsVG9rZW4sXG4gICAgcmVjb3ZlcmVkVG9rZW4sXG4gICAgcmVzdW1lZFN0cmVhbUJvZHk6IFtcbiAgICAgIHNzZSh7IHR5cGU6IFwic2Vzc2lvbl9zdGFydGVkXCIsIHNlc3Npb25JZCB9KSxcbiAgICAgIHNzZSh7XG4gICAgICAgIHR5cGU6IFwiZXhlY3V0aW9uX3N0YXJ0ZWRcIixcbiAgICAgICAgZXhlY3V0aW9uSWQsXG4gICAgICAgIHN0YXR1czogXCJydW5uaW5nXCIsXG4gICAgICAgIHJlc3VtYWJsZTogdHJ1ZSxcbiAgICAgICAgcmVzdW1lVG9rZW46IHJlY292ZXJlZFRva2VuLFxuICAgICAgfSksXG4gICAgICBzc2UoeyB0eXBlOiBcInN0YWdlXCIsIHN0YWdlOiBcInJlc3VtaW5nLWNoZWNrcG9pbnRcIiB9KSxcbiAgICAgIHNzZSh7IHR5cGU6IFwiZGVsdGFcIiwgZGVsdGE6IGFuc3dlciB9KSxcbiAgICAgIHNzZSh7XG4gICAgICAgIHR5cGU6IFwiZG9uZVwiLFxuICAgICAgICBzZXNzaW9uSWQsXG4gICAgICAgIGV4ZWN1dGlvbklkLFxuICAgICAgICBtZXNzYWdlLFxuICAgICAgICBwZW5kaW5nQ2hhbmdlczogW10sXG4gICAgICB9KSxcbiAgICBdLmpvaW4oXCJcIiksXG4gICAgZXhlY3V0aW9uOiB7XG4gICAgICBpZDogZXhlY3V0aW9uSWQsXG4gICAgICBwcm9qZWN0SWQ6IFwiZTJlLXByb2plY3RcIixcbiAgICAgIG9wZXJhdGlvbklkOiBcImUyZS1pbnRlcnJ1cHRlZC1yZXN1bWUtb3BlcmF0aW9uXCIsXG4gICAgICBzZXNzaW9uSWQsXG4gICAgICBzdGF0dXM6IFwicGF1c2VkXCIsXG4gICAgICBmbGlnaHRTdGF0ZTogXCJQQVVTRURcIixcbiAgICAgIHJlc3VtYWJsZTogdHJ1ZSxcbiAgICAgIGNoZWNrcG9pbnRWZXJzaW9uOiAxLFxuICAgICAgY2hlY2twb2ludDoge1xuICAgICAgICBzdGFnZTogXCJjYWxsaW5nLW1vZGVsXCIsXG4gICAgICAgIGRldGFpbDpcbiAgICAgICAgICBcIlRoZSBicm93c2VyIHRyYW5zcG9ydCBkaXNjb25uZWN0ZWQgYWZ0ZXIgdGhlIGV4ZWN1dGlvbiBzdGFydGVkLlwiLFxuICAgICAgfSxcbiAgICAgIG9iamVjdGl2ZTogeyBvYmplY3RpdmU6IHF1ZXN0aW9uIH0sXG4gICAgICBzdGFydGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMTowMC4wMDBaXCIsXG4gICAgICBjcmVhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMTowMC4wMDBaXCIsXG4gICAgICB1cGRhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMjowMC4wMDBaXCIsXG4gICAgfSxcbiAgfTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gY3JlYXRlUmVsZWFzZVNpZ25JblVybChwYWdlOiBQYWdlKSB7XG4gIGNvbnN0IHNlY3JldEtleSA9IHByb2Nlc3MuZW52LkNMRVJLX1NFQ1JFVF9LRVk7XG4gIGlmICghc2VjcmV0S2V5KSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgXCJDTEVSS19TRUNSRVRfS0VZIGlzIHJlcXVpcmVkIGZvciB0aGUgcmVsZWFzZS1vbmx5IHByb2dyYW1tYXRpYyBDbGVyayBoYW5kb2ZmLlwiLFxuICAgICk7XG4gIH1cblxuICBjb25zdCBoZWFkZXJzID0ge1xuICAgIEF1dGhvcml6YXRpb246IGBCZWFyZXIgJHtzZWNyZXRLZXl9YCxcbiAgICBcIkNvbnRlbnQtVHlwZVwiOiBcImFwcGxpY2F0aW9uL2pzb25cIixcbiAgfTtcbiAgY29uc3QgdXNlclJlc3BvbnNlID0gYXdhaXQgcGFnZS5yZXF1ZXN0LmdldChcbiAgICBgaHR0cHM6Ly9hcGkuY2xlcmsuY29tL3YxL3VzZXJzP2VtYWlsX2FkZHJlc3M9JHtlbmNvZGVVUklDb21wb25lbnQoVEVTVF9VU0VSLmVtYWlsKX1gLFxuICAgIHsgaGVhZGVycyB9LFxuICApO1xuICBsZXQgdXNlcklkID0gcGFyc2VDbGVya1VzZXJMb29rdXBSZXNwb25zZShhd2FpdCB1c2VyUmVzcG9uc2UuanNvbigpKTtcblxuICBpZiAoIXVzZXJJZCkge1xuICAgIGNvbnN0IGNyZWF0ZWRSZXNwb25zZSA9IGF3YWl0IHBhZ2UucmVxdWVzdC5wb3N0KFxuICAgICAgXCJodHRwczovL2FwaS5jbGVyay5jb20vdjEvdXNlcnNcIixcbiAgICAgIHtcbiAgICAgICAgaGVhZGVycyxcbiAgICAgICAgZGF0YToge1xuICAgICAgICAgIGVtYWlsX2FkZHJlc3M6IFtURVNUX1VTRVIuZW1haWxdLFxuICAgICAgICAgIGZpcnN0X25hbWU6IFRFU1RfVVNFUi5maXJzdE5hbWUsXG4gICAgICAgICAgbGFzdF9uYW1lOiBURVNUX1VTRVIubGFzdE5hbWUsXG4gICAgICAgICAgc2tpcF9wYXNzd29yZF9jaGVja3M6IHRydWUsXG4gICAgICAgICAgc2tpcF9wYXNzd29yZF9yZXF1aXJlbWVudDogdHJ1ZSxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgKTtcbiAgICB1c2VySWQgPSBwYXJzZUNyZWF0ZWRDbGVya1VzZXJSZXNwb25zZShhd2FpdCBjcmVhdGVkUmVzcG9uc2UuanNvbigpKTtcbiAgfVxuXG4gIGlmICghdXNlcklkKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgXCJUaGUgaXNvbGF0ZWQgQ2xlcmsgcmVsZWFzZSB1c2VyIGNvdWxkIG5vdCBiZSBwcm92aXNpb25lZC5cIixcbiAgICApO1xuICB9XG5cbiAgY29uc3QgdG9rZW5SZXNwb25zZSA9IGF3YWl0IHBhZ2UucmVxdWVzdC5wb3N0KFxuICAgIFwiaHR0cHM6Ly9hcGkuY2xlcmsuY29tL3YxL3NpZ25faW5fdG9rZW5zXCIsXG4gICAgeyBoZWFkZXJzLCBkYXRhOiB7IHVzZXJfaWQ6IHVzZXJJZCB9IH0sXG4gICk7XG4gIGNvbnN0IHRva2VuID0gcGFyc2VDbGVya1NpZ25JblRva2VuUmVzcG9uc2UoYXdhaXQgdG9rZW5SZXNwb25zZS5qc29uKCkpO1xuXG4gIHJldHVybiBgJHtuZXcgVVJMKERBU0hCT0FSRF9QQVRILCBwYWdlLnVybCgpKS50b1N0cmluZygpfXNpZ24taW4/X19jbGVya190aWNrZXQ9JHtlbmNvZGVVUklDb21wb25lbnQodG9rZW4pfWA7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHByb2dyYW1tYXRpY1NpZ25JbihwYWdlOiBQYWdlKSB7XG4gIGF3YWl0IHBhZ2UuZ290byhEQVNIQk9BUkRfUEFUSCk7XG4gIGF3YWl0IGV4cGVjdChcbiAgICBwYWdlLmdldEJ5Um9sZShcImxpbmtcIiwgeyBuYW1lOiBcIlNpZ24gSW5cIiwgZXhhY3Q6IHRydWUgfSksXG4gICkudG9CZVZpc2libGUoKTtcblxuICBjb25zdCBoZWxwZXIgPVxuICAgIGdsb2JhbFRoaXMuc2lnbkluQ2xlcmtVc2VyID8/XG4gICAgZ2xvYmFsVGhpcy5fX0VOR0lORUVSSU5HT1NfU0lHTl9JTl9DTEVSS19VU0VSX187XG4gIGlmICghaGVscGVyKSB7XG4gICAgaWYgKHByb2Nlc3MuZW52LlJVTl9DT05UUk9MTEVEX1JFTEVBU0VfVkFMSURBVElPTiAhPT0gXCIxXCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgXCJDbGVyayBicm93c2VyIGhlbHBlciBpcyB1bmF2YWlsYWJsZS4gUnVuIHRoaXMgam91cm5leSBpbiB0aGUgUmVwbGl0IGJyb3dzZXIgcnVubmVyLCB3aGljaCBpbmplY3RzIHNpZ25JbkNsZXJrVXNlci5cIixcbiAgICAgICk7XG4gICAgfVxuICAgIGF3YWl0IHBhZ2UuZ290byhhd2FpdCBjcmVhdGVSZWxlYXNlU2lnbkluVXJsKHBhZ2UpKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZSkudG9IYXZlVVJMKFxuICAgICAgbmV3IFJlZ0V4cChgJHtEQVNIQk9BUkRfUEFUSC5yZXBsYWNlQWxsKFwiL1wiLCBcIlxcXFwvXCIpfSRgKSxcbiAgICApO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCBzaWduSW5VcmwgPSBhd2FpdCBoZWxwZXIoe1xuICAgIC4uLlRFU1RfVVNFUixcbiAgICB0dGw6IDkwMCxcbiAgICBiYXNlUGF0aDogREFTSEJPQVJEX1BBVEgsXG4gIH0pO1xuICBhd2FpdCBwYWdlLmdvdG8oc2lnbkluVXJsKTtcbiAgYXdhaXQgZXhwZWN0KHBhZ2UpLnRvSGF2ZVVSTChcbiAgICBuZXcgUmVnRXhwKGAke0RBU0hCT0FSRF9QQVRILnJlcGxhY2VBbGwoXCIvXCIsIFwiXFxcXC9cIil9JGApLFxuICApO1xufVxuXG5hc3luYyBmdW5jdGlvbiBvcGVuTmF2aWdhdGlvbihwYWdlOiBQYWdlLCBsYWJlbDogc3RyaW5nLCBwYXRoOiBzdHJpbmcpIHtcbiAgYXdhaXQgcGFnZS5nZXRCeVJvbGUoXCJsaW5rXCIsIHsgbmFtZTogbGFiZWwsIGV4YWN0OiB0cnVlIH0pLmNsaWNrKCk7XG4gIGF3YWl0IGV4cGVjdChwYWdlKS50b0hhdmVVUkwobmV3IFJlZ0V4cChgJHtwYXRoLnJlcGxhY2VBbGwoXCIvXCIsIFwiXFxcXC9cIil9JGApKTtcbn1cblxuZnVuY3Rpb24gYXBpVXJsKHBhZ2U6IFBhZ2UsIHBhdGg6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IGFwaUJhc2VVcmwgPSBwcm9jZXNzLmVudi5EQVNIQk9BUkRfRTJFX0FQSV9CQVNFX1VSTDtcbiAgcmV0dXJuIG5ldyBVUkwocGF0aCwgYXBpQmFzZVVybCA/IGFwaUJhc2VVcmwgOiBwYWdlLnVybCgpKS50b1N0cmluZygpO1xufVxuXG5hc3luYyBmdW5jdGlvbiBsaXZlUmVxdWVzdChcbiAgcGFnZTogUGFnZSxcbiAgcGF0aDogc3RyaW5nLFxuICBvcHRpb25zPzogeyBtZXRob2Q/OiBzdHJpbmc7IGJvZHk/OiB1bmtub3duOyB0aW1lb3V0PzogbnVtYmVyIH0sXG4pOiBQcm9taXNlPHsgc3RhdHVzOiBudW1iZXI7IGJvZHk6IHN0cmluZyB9PiB7XG4gIHJldHVybiBwYWdlLmV2YWx1YXRlKFxuICAgIGFzeW5jICh7IHVybCwgbWV0aG9kLCBib2R5LCB0aW1lb3V0IH0pID0+IHtcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgZmV0Y2godXJsLCB7XG4gICAgICAgIG1ldGhvZCxcbiAgICAgICAgY3JlZGVudGlhbHM6IFwiaW5jbHVkZVwiLFxuICAgICAgICBoZWFkZXJzOlxuICAgICAgICAgIGJvZHkgPT09IHVuZGVmaW5lZFxuICAgICAgICAgICAgPyB1bmRlZmluZWRcbiAgICAgICAgICAgIDogeyBcIkNvbnRlbnQtVHlwZVwiOiBcImFwcGxpY2F0aW9uL2pzb25cIiB9LFxuICAgICAgICBib2R5OiBib2R5ID09PSB1bmRlZmluZWQgPyB1bmRlZmluZWQgOiBKU09OLnN0cmluZ2lmeShib2R5KSxcbiAgICAgICAgc2lnbmFsOiB0aW1lb3V0ID8gQWJvcnRTaWduYWwudGltZW91dCh0aW1lb3V0KSA6IHVuZGVmaW5lZCxcbiAgICAgIH0pO1xuICAgICAgcmV0dXJuIHsgc3RhdHVzOiByZXNwb25zZS5zdGF0dXMsIGJvZHk6IGF3YWl0IHJlc3BvbnNlLnRleHQoKSB9O1xuICAgIH0sXG4gICAge1xuICAgICAgdXJsOiBhcGlVcmwocGFnZSwgcGF0aCksXG4gICAgICBtZXRob2Q6IG9wdGlvbnM/Lm1ldGhvZCA/PyBcIkdFVFwiLFxuICAgICAgYm9keTogb3B0aW9ucz8uYm9keSxcbiAgICAgIHRpbWVvdXQ6IG9wdGlvbnM/LnRpbWVvdXQsXG4gICAgfSxcbiAgKTtcbn1cblxudHlwZSBPcmlnaW5EaWFnbm9zdGljID0ge1xuICBvcmlnaW46IHN0cmluZztcbiAgcGhhc2U6IFwiR0VUXCIgfCBcInByZWZsaWdodFwiIHwgXCJtdXRhdGlvblwiIHwgXCJyZWplY3Rpb25cIjtcbiAgc3RhdHVzPzogbnVtYmVyO1xuICBoZWFkZXJzPzogUmVjb3JkPHN0cmluZywgc3RyaW5nPjtcbiAgZXJyb3I/OiBzdHJpbmc7XG59O1xuY29uc3QgcmVjb3JkZWRPcmlnaW5EaWFnbm9zdGljczogT3JpZ2luRGlhZ25vc3RpY1tdID0gW107XG5cbmZ1bmN0aW9uIG9yaWdpbkRpYWdub3N0aWNQYXRoKCk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gIHJldHVybiBwcm9jZXNzLmVudi5EQVNIQk9BUkRfRTJFX09SSUdJTl9ESUFHTk9TVElDU19QQVRIO1xufVxuXG5mdW5jdGlvbiByZWxldmFudE9yaWdpbkhlYWRlcnMoXG4gIGhlYWRlcnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4sXG4pOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+IHtcbiAgcmV0dXJuIE9iamVjdC5mcm9tRW50cmllcyhcbiAgICBPUklHSU5fRElBR05PU1RJQ19IRUFERVJTLmZsYXRNYXAoKG5hbWUpID0+XG4gICAgICBoZWFkZXJzW25hbWVdID8gW1tuYW1lLCBoZWFkZXJzW25hbWVdXV0gOiBbXSxcbiAgICApLFxuICApO1xufVxuXG5hc3luYyBmdW5jdGlvbiB3cml0ZU9yaWdpbkRpYWdub3N0aWNzKCkge1xuICBjb25zdCBvdXRwdXRQYXRoID0gb3JpZ2luRGlhZ25vc3RpY1BhdGgoKTtcbiAgaWYgKCFvdXRwdXRQYXRoKSByZXR1cm47XG4gIGF3YWl0IG1rZGlyKGRpcm5hbWUob3V0cHV0UGF0aCksIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xuICBhd2FpdCB3cml0ZUZpbGUoXG4gICAgb3V0cHV0UGF0aCxcbiAgICBgJHtKU09OLnN0cmluZ2lmeSh7IGRpYWdub3N0aWNzOiByZWNvcmRlZE9yaWdpbkRpYWdub3N0aWNzIH0sIG51bGwsIDIpfVxcbmAsXG4gICAgXCJ1dGY4XCIsXG4gICk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGV4cGVjdE9yaWdpbkNhblVzZUFwaShwYWdlOiBQYWdlLCBvcmlnaW46IHN0cmluZykge1xuICBjb25zdCBhcGlCYXNlVXJsID0gcHJvY2Vzcy5lbnYuREFTSEJPQVJEX0UyRV9BUElfQkFTRV9VUkw7XG4gIGlmICghYXBpQmFzZVVybCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgIFwiREFTSEJPQVJEX0UyRV9BUElfQkFTRV9VUkwgaXMgcmVxdWlyZWQgZm9yIG9yaWdpbiBjaGVja3MuXCIsXG4gICAgKTtcbiAgfVxuICBjb25zdCBoZWFsdGhVcmwgPSBuZXcgVVJMKFwiL2FwaS9oZWFsdGh6XCIsIGFwaUJhc2VVcmwpLnRvU3RyaW5nKCk7XG4gIGNvbnN0IG11dGF0aW9uVXJsID0gbmV3IFVSTChcIi9hcGkvYWkvY2hhdFwiLCBhcGlCYXNlVXJsKS50b1N0cmluZygpO1xuICBjb25zdCBjb21tb25IZWFkZXJzID0geyBPcmlnaW46IG9yaWdpbiB9O1xuXG4gIGNvbnN0IGRpYWdub3N0aWNzOiBPcmlnaW5EaWFnbm9zdGljW10gPSBbXTtcbiAgY29uc3QgY2hlY2sgPSBhc3luYyAoXG4gICAgcGhhc2U6IE9yaWdpbkRpYWdub3N0aWNbXCJwaGFzZVwiXSxcbiAgICByZXF1ZXN0OiAoKSA9PiBQcm9taXNlPGltcG9ydChcIkBwbGF5d3JpZ2h0L3Rlc3RcIikuQVBJUmVzcG9uc2U+LFxuICAgIGFzc2VydGlvbjogKFxuICAgICAgcmVzcG9uc2U6IGltcG9ydChcIkBwbGF5d3JpZ2h0L3Rlc3RcIikuQVBJUmVzcG9uc2UsXG4gICAgKSA9PiBQcm9taXNlPHZvaWQ+LFxuICApID0+IHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCByZXF1ZXN0KCk7XG4gICAgICBkaWFnbm9zdGljcy5wdXNoKHtcbiAgICAgICAgb3JpZ2luLFxuICAgICAgICBwaGFzZSxcbiAgICAgICAgc3RhdHVzOiByZXNwb25zZS5zdGF0dXMoKSxcbiAgICAgICAgaGVhZGVyczogcmVsZXZhbnRPcmlnaW5IZWFkZXJzKHJlc3BvbnNlLmhlYWRlcnMoKSksXG4gICAgICB9KTtcbiAgICAgIHJlY29yZGVkT3JpZ2luRGlhZ25vc3RpY3MucHVzaChkaWFnbm9zdGljcy5hdCgtMSkhKTtcbiAgICAgIGF3YWl0IGFzc2VydGlvbihyZXNwb25zZSk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnN0IGN1cnJlbnQgPSBkaWFnbm9zdGljcy5hdCgtMSk7XG4gICAgICBpZiAoY3VycmVudD8ucGhhc2UgIT09IHBoYXNlKSB7XG4gICAgICAgIGRpYWdub3N0aWNzLnB1c2goeyBvcmlnaW4sIHBoYXNlIH0pO1xuICAgICAgfVxuICAgICAgZGlhZ25vc3RpY3MuYXQoLTEpIS5lcnJvciA9IFwib3JpZ2luIGNoZWNrIGZhaWxlZFwiO1xuICAgICAgYXdhaXQgd3JpdGVPcmlnaW5EaWFnbm9zdGljcygpO1xuICAgICAgdGhyb3cgZXJyb3I7XG4gICAgfVxuICB9O1xuXG4gIGF3YWl0IGNoZWNrKFxuICAgIFwiR0VUXCIsXG4gICAgKCkgPT4gcGFnZS5yZXF1ZXN0LmdldChoZWFsdGhVcmwsIHsgaGVhZGVyczogY29tbW9uSGVhZGVycyB9KSxcbiAgICBhc3luYyAocmVzcG9uc2UpID0+IHtcbiAgICAgIGV4cGVjdChyZXNwb25zZS5zdGF0dXMoKSwgYCR7b3JpZ2lufSBjcmVkZW50aWFsZWQgR0VUIHN0YXR1c2ApLnRvQmUoMjAwKTtcbiAgICAgIGV4cGVjdChyZXNwb25zZS5oZWFkZXJzKClbXCJhY2Nlc3MtY29udHJvbC1hbGxvdy1vcmlnaW5cIl0pLnRvQmUob3JpZ2luKTtcbiAgICAgIGV4cGVjdChyZXNwb25zZS5oZWFkZXJzKClbXCJhY2Nlc3MtY29udHJvbC1hbGxvdy1jcmVkZW50aWFsc1wiXSkudG9CZShcbiAgICAgICAgXCJ0cnVlXCIsXG4gICAgICApO1xuICAgIH0sXG4gICk7XG4gIGF3YWl0IGNoZWNrKFxuICAgIFwicHJlZmxpZ2h0XCIsXG4gICAgKCkgPT5cbiAgICAgIHBhZ2UucmVxdWVzdC5mZXRjaChtdXRhdGlvblVybCwge1xuICAgICAgICBtZXRob2Q6IFwiT1BUSU9OU1wiLFxuICAgICAgICBoZWFkZXJzOiB7XG4gICAgICAgICAgLi4uY29tbW9uSGVhZGVycyxcbiAgICAgICAgICBcIkFjY2Vzcy1Db250cm9sLVJlcXVlc3QtTWV0aG9kXCI6IFwiUE9TVFwiLFxuICAgICAgICAgIFwiQWNjZXNzLUNvbnRyb2wtUmVxdWVzdC1IZWFkZXJzXCI6IFwiY29udGVudC10eXBlXCIsXG4gICAgICAgIH0sXG4gICAgICB9KSxcbiAgICBhc3luYyAocmVzcG9uc2UpID0+IHtcbiAgICAgIGV4cGVjdChyZXNwb25zZS5zdGF0dXMoKSwgYCR7b3JpZ2lufSBtdXRhdGlvbiBwcmVmbGlnaHQgc3RhdHVzYCkudG9CZShcbiAgICAgICAgMjA0LFxuICAgICAgKTtcbiAgICAgIGV4cGVjdChyZXNwb25zZS5oZWFkZXJzKClbXCJhY2Nlc3MtY29udHJvbC1hbGxvdy1vcmlnaW5cIl0pLnRvQmUob3JpZ2luKTtcbiAgICAgIGV4cGVjdChcbiAgICAgICAgcmVzcG9uc2UuaGVhZGVycygpW1wiYWNjZXNzLWNvbnRyb2wtYWxsb3ctY3JlZGVudGlhbHNcIl0sXG4gICAgICAgIGAke29yaWdpbn0gbXV0YXRpb24gcHJlZmxpZ2h0IGNyZWRlbnRpYWxzYCxcbiAgICAgICkudG9CZShcInRydWVcIik7XG4gICAgICBleHBlY3QoXG4gICAgICAgIHJlc3BvbnNlXG4gICAgICAgICAgLmhlYWRlcnMoKVxuICAgICAgICAgIFtcImFjY2Vzcy1jb250cm9sLWFsbG93LW1ldGhvZHNcIl0/LnNwbGl0KFwiLFwiKVxuICAgICAgICAgIC5tYXAoKG1ldGhvZCkgPT4gbWV0aG9kLnRyaW0oKS50b1VwcGVyQ2FzZSgpKSxcbiAgICAgICAgYCR7b3JpZ2lufSBtdXRhdGlvbiBwcmVmbGlnaHQgbWV0aG9kc2AsXG4gICAgICApLnRvQ29udGFpbihcIlBPU1RcIik7XG4gICAgICBleHBlY3QoXG4gICAgICAgIHJlc3BvbnNlXG4gICAgICAgICAgLmhlYWRlcnMoKVxuICAgICAgICAgIFtcImFjY2Vzcy1jb250cm9sLWFsbG93LWhlYWRlcnNcIl0/LnNwbGl0KFwiLFwiKVxuICAgICAgICAgIC5tYXAoKGhlYWRlcikgPT4gaGVhZGVyLnRyaW0oKS50b0xvd2VyQ2FzZSgpKSxcbiAgICAgICAgYCR7b3JpZ2lufSBtdXRhdGlvbiBwcmVmbGlnaHQgaGVhZGVyc2AsXG4gICAgICApLnRvQ29udGFpbihcImNvbnRlbnQtdHlwZVwiKTtcbiAgICB9LFxuICApO1xuICBhd2FpdCBjaGVjayhcbiAgICBcIm11dGF0aW9uXCIsXG4gICAgKCkgPT5cbiAgICAgIHBhZ2UucmVxdWVzdC5wb3N0KG11dGF0aW9uVXJsLCB7XG4gICAgICAgIGhlYWRlcnM6IHsgLi4uY29tbW9uSGVhZGVycywgXCJDb250ZW50LVR5cGVcIjogXCJhcHBsaWNhdGlvbi9qc29uXCIgfSxcbiAgICAgICAgZGF0YTogeyBtZXNzYWdlOiBcIm9yaWdpbiBjb250cmFjdFwiIH0sXG4gICAgICB9KSxcbiAgICBhc3luYyAocmVzcG9uc2UpID0+IHtcbiAgICAgIGV4cGVjdChcbiAgICAgICAgcmVzcG9uc2Uuc3RhdHVzKCksXG4gICAgICAgIGAke29yaWdpbn0gc3RhdGUtY2hhbmdpbmcgcmVxdWVzdCBtdXN0IHBhc3Mgb3JpZ2luIHByb3RlY3Rpb25gLFxuICAgICAgKS5ub3QudG9CZSg0MDMpO1xuICAgICAgZXhwZWN0KHJlc3BvbnNlLmhlYWRlcnMoKVtcImFjY2Vzcy1jb250cm9sLWFsbG93LW9yaWdpblwiXSkudG9CZShvcmlnaW4pO1xuICAgICAgZXhwZWN0KHJlc3BvbnNlLmhlYWRlcnMoKVtcImFjY2Vzcy1jb250cm9sLWFsbG93LWNyZWRlbnRpYWxzXCJdKS50b0JlKFxuICAgICAgICBcInRydWVcIixcbiAgICAgICk7XG4gICAgfSxcbiAgKTtcbiAgYXdhaXQgd3JpdGVPcmlnaW5EaWFnbm9zdGljcygpO1xufVxuXG5hc3luYyBmdW5jdGlvbiBleHBlY3RIb3N0aWxlT3JpZ2luUmVqZWN0ZWQocGFnZTogUGFnZSkge1xuICBjb25zdCBhcGlCYXNlVXJsID0gcHJvY2Vzcy5lbnYuREFTSEJPQVJEX0UyRV9BUElfQkFTRV9VUkw7XG4gIGlmICghYXBpQmFzZVVybClcbiAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICBcIkRBU0hCT0FSRF9FMkVfQVBJX0JBU0VfVVJMIGlzIHJlcXVpcmVkIGZvciBvcmlnaW4gY2hlY2tzLlwiLFxuICAgICk7XG4gIGNvbnN0IG11dGF0aW9uVXJsID0gbmV3IFVSTChcIi9hcGkvYWkvY2hhdFwiLCBhcGlCYXNlVXJsKS50b1N0cmluZygpO1xuICBjb25zdCB1cGxvYWRVcmwgPSBuZXcgVVJMKFwiL2FwaS91cGxvYWQvYXJjaGl2ZVwiLCBhcGlCYXNlVXJsKS50b1N0cmluZygpO1xuICBjb25zdCBsaXZlVXBkYXRlVXJsID0gbmV3IFVSTChcIi9hcGkvYWkvY2hhdC9zdHJlYW1cIiwgYXBpQmFzZVVybCkudG9TdHJpbmcoKTtcbiAgY29uc3QgZGlhZ25vc3RpYzogT3JpZ2luRGlhZ25vc3RpYyA9IHtcbiAgICBvcmlnaW46IEhPU1RJTEVfT1JJR0lOLFxuICAgIHBoYXNlOiBcInJlamVjdGlvblwiLFxuICB9O1xuICByZWNvcmRlZE9yaWdpbkRpYWdub3N0aWNzLnB1c2goZGlhZ25vc3RpYyk7XG4gIHRyeSB7XG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBwYWdlLnJlcXVlc3QucG9zdChtdXRhdGlvblVybCwge1xuICAgICAgaGVhZGVyczoge1xuICAgICAgICBPcmlnaW46IEhPU1RJTEVfT1JJR0lOLFxuICAgICAgICBcIkNvbnRlbnQtVHlwZVwiOiBcImFwcGxpY2F0aW9uL2pzb25cIixcbiAgICAgIH0sXG4gICAgICBkYXRhOiB7IG1lc3NhZ2U6IFwiaG9zdGlsZSBvcmlnaW4gY29udHJhY3RcIiB9LFxuICAgIH0pO1xuICAgIGRpYWdub3N0aWMuc3RhdHVzID0gcmVzcG9uc2Uuc3RhdHVzKCk7XG4gICAgZGlhZ25vc3RpYy5oZWFkZXJzID0gcmVsZXZhbnRPcmlnaW5IZWFkZXJzKHJlc3BvbnNlLmhlYWRlcnMoKSk7XG4gICAgZXhwZWN0KHJlc3BvbnNlLnN0YXR1cygpKS50b0JlKDQwMyk7XG4gICAgZXhwZWN0KHJlc3BvbnNlLmhlYWRlcnMoKVtcImFjY2Vzcy1jb250cm9sLWFsbG93LW9yaWdpblwiXSkudG9CZVVuZGVmaW5lZCgpO1xuICAgIGV4cGVjdChcbiAgICAgIHJlc3BvbnNlLmhlYWRlcnMoKVtcImFjY2Vzcy1jb250cm9sLWFsbG93LWNyZWRlbnRpYWxzXCJdLFxuICAgICkudG9CZVVuZGVmaW5lZCgpO1xuXG4gICAgY29uc3QgaG9zdGlsZVVwbG9hZCA9IGF3YWl0IHBhZ2UucmVxdWVzdC5wb3N0KHVwbG9hZFVybCwge1xuICAgICAgaGVhZGVyczogeyBPcmlnaW46IEhPU1RJTEVfT1JJR0lOIH0sXG4gICAgICBtdWx0aXBhcnQ6IHtcbiAgICAgICAgYXJjaGl2ZToge1xuICAgICAgICAgIG5hbWU6IFwiaG9zdGlsZS1kYXNoYm9hcmQtam91cm5leS56aXBcIixcbiAgICAgICAgICBtaW1lVHlwZTogXCJhcHBsaWNhdGlvbi96aXBcIixcbiAgICAgICAgICBidWZmZXI6IEJ1ZmZlci5mcm9tKFwibm90IGFuIGFyY2hpdmVcIiksXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgIH0pO1xuICAgIGV4cGVjdChob3N0aWxlVXBsb2FkLnN0YXR1cygpKS50b0JlKDQwMyk7XG4gICAgZXhwZWN0KFxuICAgICAgaG9zdGlsZVVwbG9hZC5oZWFkZXJzKClbXCJhY2Nlc3MtY29udHJvbC1hbGxvdy1vcmlnaW5cIl0sXG4gICAgKS50b0JlVW5kZWZpbmVkKCk7XG5cbiAgICBjb25zdCBob3N0aWxlTGl2ZVVwZGF0ZSA9IGF3YWl0IHBhZ2UucmVxdWVzdC5wb3N0KGxpdmVVcGRhdGVVcmwsIHtcbiAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgT3JpZ2luOiBIT1NUSUxFX09SSUdJTixcbiAgICAgICAgXCJDb250ZW50LVR5cGVcIjogXCJhcHBsaWNhdGlvbi9qc29uXCIsXG4gICAgICB9LFxuICAgICAgZGF0YToge30sXG4gICAgfSk7XG4gICAgZXhwZWN0KGhvc3RpbGVMaXZlVXBkYXRlLnN0YXR1cygpKS50b0JlKDQwMyk7XG4gICAgZXhwZWN0KFxuICAgICAgaG9zdGlsZUxpdmVVcGRhdGUuaGVhZGVycygpW1wiYWNjZXNzLWNvbnRyb2wtYWxsb3ctb3JpZ2luXCJdLFxuICAgICkudG9CZVVuZGVmaW5lZCgpO1xuICB9IGNhdGNoIChlcnJvcikge1xuICAgIGRpYWdub3N0aWMuZXJyb3IgPSBcIm9yaWdpbiByZWplY3Rpb24gY2hlY2sgZmFpbGVkXCI7XG4gICAgYXdhaXQgd3JpdGVPcmlnaW5EaWFnbm9zdGljcygpO1xuICAgIHRocm93IGVycm9yO1xuICB9XG4gIGF3YWl0IHdyaXRlT3JpZ2luRGlhZ25vc3RpY3MoKTtcbn1cblxuZnVuY3Rpb24gcGFyc2VTc2UoYm9keTogc3RyaW5nKTogQXJyYXk8UmVjb3JkPHN0cmluZywgdW5rbm93bj4+IHtcbiAgcmV0dXJuIGJvZHkuc3BsaXQoL1xcblxcbisvKS5mbGF0TWFwKChjaHVuaykgPT4ge1xuICAgIGNvbnN0IGRhdGEgPSBjaHVua1xuICAgICAgLnNwbGl0KFwiXFxuXCIpXG4gICAgICAuZmluZCgobGluZSkgPT4gbGluZS5zdGFydHNXaXRoKFwiZGF0YTogXCIpKVxuICAgICAgPy5zbGljZShcImRhdGE6IFwiLmxlbmd0aCk7XG4gICAgaWYgKCFkYXRhKSByZXR1cm4gW107XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHZhbHVlID0gSlNPTi5wYXJzZShkYXRhKSBhcyB1bmtub3duO1xuICAgICAgcmV0dXJuIHZhbHVlICYmIHR5cGVvZiB2YWx1ZSA9PT0gXCJvYmplY3RcIlxuICAgICAgICA/IFt2YWx1ZSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPl1cbiAgICAgICAgOiBbXTtcbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybiBbXTtcbiAgICB9XG4gIH0pO1xufVxuXG5hc3luYyBmdW5jdGlvbiBsaXZlSnNvbihcbiAgcGFnZTogUGFnZSxcbiAgcGF0aDogc3RyaW5nLFxuKTogUHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBhbnk+PiB7XG4gIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgbGl2ZVJlcXVlc3QocGFnZSwgcGF0aCk7XG4gIGlmIChyZXNwb25zZS5zdGF0dXMgPCAyMDAgfHwgcmVzcG9uc2Uuc3RhdHVzID49IDMwMCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgIGBMaXZlIGNvcnJlbGF0aW9uIHJlcXVlc3QgZmFpbGVkOiAke3BhdGh9ICgke3Jlc3BvbnNlLnN0YXR1c30pYCxcbiAgICApO1xuICB9XG4gIHJldHVybiBKU09OLnBhcnNlKHJlc3BvbnNlLmJvZHkpIGFzIFJlY29yZDxzdHJpbmcsIGFueT47XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGxpdmVBcnJheShcbiAgcGFnZTogUGFnZSxcbiAgcGF0aDogc3RyaW5nLFxuKTogUHJvbWlzZTxBcnJheTxSZWNvcmQ8c3RyaW5nLCBhbnk+Pj4ge1xuICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGxpdmVSZXF1ZXN0KHBhZ2UsIHBhdGgpO1xuICBpZiAocmVzcG9uc2Uuc3RhdHVzID09PSA0MDQpIHJldHVybiBbXTtcbiAgaWYgKHJlc3BvbnNlLnN0YXR1cyA8IDIwMCB8fCByZXNwb25zZS5zdGF0dXMgPj0gMzAwKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgYExpdmUgY29ycmVsYXRpb24gcmVxdWVzdCBmYWlsZWQ6ICR7cGF0aH0gKCR7cmVzcG9uc2Uuc3RhdHVzfSlgLFxuICAgICk7XG4gIH1cbiAgY29uc3QgdmFsdWUgPSBKU09OLnBhcnNlKHJlc3BvbnNlLmJvZHkpO1xuICByZXR1cm4gQXJyYXkuaXNBcnJheSh2YWx1ZSkgPyB2YWx1ZSA6IFtdO1xufVxuXG5hc3luYyBmdW5jdGlvbiBsaXZlT3B0aW9uYWxSZWNvcmQoXG4gIHBhZ2U6IFBhZ2UsXG4gIHBhdGg6IHN0cmluZyxcbik6IFByb21pc2U8UmVjb3JkPHN0cmluZywgYW55PiB8IHVuZGVmaW5lZD4ge1xuICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGxpdmVSZXF1ZXN0KHBhZ2UsIHBhdGgpO1xuICBpZiAocmVzcG9uc2Uuc3RhdHVzID09PSA0MDQpIHJldHVybiB1bmRlZmluZWQ7XG4gIGlmIChyZXNwb25zZS5zdGF0dXMgPCAyMDAgfHwgcmVzcG9uc2Uuc3RhdHVzID49IDMwMCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgIGBMaXZlIGNvcnJlbGF0aW9uIHJlcXVlc3QgZmFpbGVkOiAke3BhdGh9ICgke3Jlc3BvbnNlLnN0YXR1c30pYCxcbiAgICApO1xuICB9XG4gIGNvbnN0IHZhbHVlID0gSlNPTi5wYXJzZShyZXNwb25zZS5ib2R5KTtcbiAgcmV0dXJuIHZhbHVlICYmIHR5cGVvZiB2YWx1ZSA9PT0gXCJvYmplY3RcIiAmJiAhQXJyYXkuaXNBcnJheSh2YWx1ZSlcbiAgICA/ICh2YWx1ZSBhcyBSZWNvcmQ8c3RyaW5nLCBhbnk+KVxuICAgIDogdW5kZWZpbmVkO1xufVxuXG50ZXN0LmRlc2NyaWJlKFwiRW5naW5lZXJpbmdPUyBkYXNoYm9hcmQgYnJvd3NlciBqb3VybmV5XCIsICgpID0+IHtcbiAgdGVzdChcImV4cG9ydHMgb25lIHJlZGFjdGVkIGxpdmUtcHJvdmlkZXIgbWlzc2lvbiBjb3JyZWxhdGlvbiByZXBvcnRcIiwgYXN5bmMgKHtcbiAgICBwYWdlLFxuICB9KSA9PiB7XG4gICAgLy8gVGhlIFBsYXl3cmlnaHQgZGVhZGxpbmUgbXVzdCBsZWF2ZSByb29tIGZvciB0aGUgcHJvdmlkZXItYm91bmQgcmVxdWVzdFxuICAgIC8vIGFuZCBwb2xsaW5nIGxvb3AgdG8gY29uc3VtZSB0aGVpciBjb21wbGV0ZSBjb25maWd1cmVkIGJ1ZGdldC5cbiAgICB0ZXN0LnNldFRpbWVvdXQobGl2ZVRpbWVvdXRNcygpICsgTElWRV9URVNUX1RJTUVPVVRfTUFSR0lOX01TKTtcbiAgICB0ZXN0LnNraXAoXG4gICAgICBwcm9jZXNzLmVudi5EQVNIQk9BUkRfRTJFX0xJVkVfUFJPVklERVIgIT09IFwiMVwiLFxuICAgICAgXCJMaXZlLXByb3ZpZGVyIHJlbGVhc2Ugam91cm5leSBpcyBvcHQtaW4uXCIsXG4gICAgKTtcbiAgICBpZiAocHJvY2Vzcy5lbnYuREFTSEJPQVJEX0UyRV9MSVZFX0RJU1BPU0FCTEUgIT09IFwiMVwiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgIFwiTGl2ZS1wcm92aWRlciBqb3VybmV5IHJlcXVpcmVzIERBU0hCT0FSRF9FMkVfTElWRV9ESVNQT1NBQkxFPTEgYW5kIGEgZGlzcG9zYWJsZSBwcm9qZWN0LlwiLFxuICAgICAgKTtcbiAgICB9XG4gICAgY29uc3QgY2FtcGFpZ25TY2VuYXJpbyA9IGxpdmVDYW1wYWlnblNjZW5hcmlvKCk7XG4gICAgY29uc3QgcHJvamVjdElkID0gcHJvY2Vzcy5lbnYuREFTSEJPQVJEX0UyRV9MSVZFX1BST0pFQ1RfSUQ7XG4gICAgaWYgKCFwcm9qZWN0SWQpXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgIFwiREFTSEJPQVJEX0UyRV9MSVZFX1BST0pFQ1RfSUQgaXMgcmVxdWlyZWQgZm9yIHRoZSBsaXZlLXByb3ZpZGVyIGpvdXJuZXkuXCIsXG4gICAgICApO1xuXG4gICAgYXdhaXQgcHJvZ3JhbW1hdGljU2lnbkluKHBhZ2UpO1xuICAgIGNvbnN0IHN0cmVhbVJlc3BvbnNlID0gYXdhaXQgbGl2ZVJlcXVlc3QocGFnZSwgXCIvYXBpL2FpL2NoYXQvc3RyZWFtXCIsIHtcbiAgICAgIG1ldGhvZDogXCJQT1NUXCIsXG4gICAgICB0aW1lb3V0OiBsaXZlVGltZW91dE1zKCksXG4gICAgICBib2R5OiB7XG4gICAgICAgIHByb2plY3RJZCxcbiAgICAgICAgIG1lc3NhZ2U6IGxpdmVQcm9tcHQoKSxcbiAgICAgICAgaWRlbXBvdGVuY3lLZXk6IGBkYXNoYm9hcmQtbGl2ZS0ke0RhdGUubm93KCl9YCxcbiAgICAgIH0sXG4gICAgfSk7XG4gICAgaWYgKHN0cmVhbVJlc3BvbnNlLnN0YXR1cyA8IDIwMCB8fCBzdHJlYW1SZXNwb25zZS5zdGF0dXMgPj0gMzAwKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgIGBMaXZlLXByb3ZpZGVyIG1pc3Npb24gZmFpbGVkIHRvIHN0YXJ0ICgke3N0cmVhbVJlc3BvbnNlLnN0YXR1c30pLmAsXG4gICAgICApO1xuICAgIH1cbiAgICBjb25zdCBzc2VFdmVudHMgPSBwYXJzZVNzZShzdHJlYW1SZXNwb25zZS5ib2R5KTtcbiAgICBjb25zdCBzdGFydGVkID0gc3NlRXZlbnRzLmZpbmQoXG4gICAgICAoZXZlbnQpID0+IGV2ZW50LnR5cGUgPT09IFwiZXhlY3V0aW9uX3N0YXJ0ZWRcIixcbiAgICApO1xuICAgIGNvbnN0IGV4ZWN1dGlvbklkID1cbiAgICAgIHR5cGVvZiBzdGFydGVkPy5leGVjdXRpb25JZCA9PT0gXCJzdHJpbmdcIlxuICAgICAgICA/IHN0YXJ0ZWQuZXhlY3V0aW9uSWRcbiAgICAgICAgOiB1bmRlZmluZWQ7XG4gICAgaWYgKCFleGVjdXRpb25JZClcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkxpdmUtcHJvdmlkZXIgc3RyZWFtIGRpZCBub3QgZW1pdCBleGVjdXRpb25fc3RhcnRlZC5cIik7XG5cbiAgICBsZXQgZXhlY3V0aW9uOiBSZWNvcmQ8c3RyaW5nLCBhbnk+ID0ge307XG4gICAgY29uc3QgZGVhZGxpbmUgPSBEYXRlLm5vdygpICsgbGl2ZVRpbWVvdXRNcygpO1xuICAgIHdoaWxlIChEYXRlLm5vdygpIDwgZGVhZGxpbmUpIHtcbiAgICAgIGV4ZWN1dGlvbiA9IGF3YWl0IGxpdmVKc29uKHBhZ2UsIGAvYXBpL2FpL2V4ZWN1dGlvbnMvJHtleGVjdXRpb25JZH1gKTtcbiAgICAgIGlmIChcbiAgICAgICAgW1wiY29tcGxldGVkXCIsIFwiZmFpbGVkXCIsIFwiY2FuY2VsbGVkXCJdLmluY2x1ZGVzKFN0cmluZyhleGVjdXRpb24uc3RhdHVzKSlcbiAgICAgIClcbiAgICAgICAgYnJlYWs7XG4gICAgICBhd2FpdCBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4gc2V0VGltZW91dChyZXNvbHZlLCA3NTApKTtcbiAgICB9XG4gICAgaWYgKFxuICAgICAgIVtcImNvbXBsZXRlZFwiLCBcImZhaWxlZFwiLCBcImNhbmNlbGxlZFwiXS5pbmNsdWRlcyhTdHJpbmcoZXhlY3V0aW9uLnN0YXR1cykpXG4gICAgKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgIFwiTGl2ZS1wcm92aWRlciBtaXNzaW9uIGRpZCBub3QgcmVhY2ggYSB0ZXJtaW5hbCBzdGF0ZSB3aXRoaW4gaXRzIGJvdW5kLlwiLFxuICAgICAgKTtcbiAgICB9XG5cbiAgICBjb25zdCBzZXNzaW9uSWQgPSBTdHJpbmcoZXhlY3V0aW9uLnNlc3Npb25JZCk7XG4gICAgY29uc3QgbWVzc2FnZXMgPSBhd2FpdCBsaXZlQXJyYXkoXG4gICAgICBwYWdlLFxuICAgICAgYC9hcGkvYWkvY2hhdC8ke3Nlc3Npb25JZH0vbWVzc2FnZXNgLFxuICAgICk7XG4gICAgY29uc3QgZXZlbnRzID0gYXdhaXQgbGl2ZUFycmF5KFxuICAgICAgcGFnZSxcbiAgICAgIGAvYXBpL2V2ZW50cz9wcm9qZWN0SWQ9JHtlbmNvZGVVUklDb21wb25lbnQocHJvamVjdElkKX0mY29ycmVsYXRpb25JZD0ke2VuY29kZVVSSUNvbXBvbmVudChTdHJpbmcoZXhlY3V0aW9uLm9wZXJhdGlvbklkID8/IFwiXCIpKX1gLFxuICAgICk7XG4gICAgY29uc3QgcHJvcG9zYWwgPSBhd2FpdCBsaXZlT3B0aW9uYWxSZWNvcmQoXG4gICAgICBwYWdlLFxuICAgICAgYC9hcGkvYWkvY2hhdC8ke3Nlc3Npb25JZH0vcGVuZGluZy1wcm9wb3NhbGAsXG4gICAgKTtcbiAgICBjb25zdCBnaXRMb2cgPSBhd2FpdCBsaXZlSnNvbihwYWdlLCBgL2FwaS9wcm9qZWN0cy8ke3Byb2plY3RJZH0vZ2l0L2xvZ2ApO1xuICAgIGNvbnN0IG1pc3Npb25Db250cm9sID0gYXdhaXQgbGl2ZUpzb24ocGFnZSwgXCIvYXBpL2FpL21pc3Npb24tY29udHJvbFwiKTtcbiAgICBjb25zdCBkYXNoYm9hcmRTdGF0ZSA9IGF3YWl0IGxpdmVKc29uKHBhZ2UsIFwiL2FwaS9kYXNoYm9hcmRcIik7XG4gICAgY29uc3QgY2hlY2twb2ludCA9XG4gICAgICBleGVjdXRpb24uY2hlY2twb2ludCAmJiB0eXBlb2YgZXhlY3V0aW9uLmNoZWNrcG9pbnQgPT09IFwib2JqZWN0XCJcbiAgICAgICAgPyAoZXhlY3V0aW9uLmNoZWNrcG9pbnQgYXMgUmVjb3JkPHN0cmluZywgYW55PilcbiAgICAgICAgOiB7fTtcbiAgICBjb25zdCByZWNlbnRTdGVwcyA9IEFycmF5LmlzQXJyYXkoY2hlY2twb2ludC5yZWNlbnRTdGVwcylcbiAgICAgID8gY2hlY2twb2ludC5yZWNlbnRTdGVwc1xuICAgICAgOiBbXTtcbiAgICBjb25zdCB2YWxpZGF0aW9uID0gcmVjZW50U3RlcHMuZmlsdGVyKFxuICAgICAgKHN0ZXApID0+IHN0ZXA/LmtpbmQgPT09IFwidmFsaWRhdGlvblwiLFxuICAgICk7XG4gICAgY29uc3QgcHJvamVjdFJldmlzaW9uID1cbiAgICAgIHR5cGVvZiBleGVjdXRpb24ucHJvamVjdFJldmlzaW9uID09PSBcInN0cmluZ1wiXG4gICAgICAgID8gZXhlY3V0aW9uLnByb2plY3RSZXZpc2lvblxuICAgICAgICA6IHVuZGVmaW5lZDtcbiAgICBjb25zdCBjYW5kaWRhdGVIYXNoID0gdmFsaWRhdGlvblxuICAgICAgLm1hcCgoc3RlcCkgPT4gc3RlcD8udmFsaWRhdGlvbj8uY2FuZGlkYXRlSGFzaCA/PyBzdGVwPy5jYW5kaWRhdGVIYXNoKVxuICAgICAgLmZpbmQoKHZhbHVlKTogdmFsdWUgaXMgc3RyaW5nID0+IHR5cGVvZiB2YWx1ZSA9PT0gXCJzdHJpbmdcIiAmJiB2YWx1ZS5sZW5ndGggPiAwKTtcbiAgICBjb25zdCBjYW5kaWRhdGVJZGVudGl0eSA9XG4gICAgICB0eXBlb2YgZXhlY3V0aW9uLmNhbmRpZGF0ZUlkZW50aXR5ID09PSBcInN0cmluZ1wiXG4gICAgICAgID8gZXhlY3V0aW9uLmNhbmRpZGF0ZUlkZW50aXR5XG4gICAgICAgIDogY2FuZGlkYXRlSGFzaFxuICAgICAgICAgID8gYGNhbmRpZGF0ZToke2NhbmRpZGF0ZUhhc2h9YFxuICAgICAgICAgIDogYHJlYWQtb25seToke3Byb2plY3RSZXZpc2lvbiA/PyBcInVua25vd25cIn1gO1xuICAgIGlmICghcHJvamVjdFJldmlzaW9uKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJMaXZlLXByb3ZpZGVyIG1pc3Npb24gaXMgbWlzc2luZyBpdHMgcHJvamVjdCByZXZpc2lvbi5cIik7XG4gICAgfVxuICAgIGlmIChcbiAgICAgIHByb2Nlc3MuZW52LkRBU0hCT0FSRF9FMkVfTElWRV9DQU1QQUlHTiA9PT0gXCIxXCIgJiZcbiAgICAgICghY2FuZGlkYXRlSWRlbnRpdHkgfHwgIXByb2plY3RSZXZpc2lvbilcbiAgICApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkxpdmUgY2FtcGFpZ24gcmVxdWlyZXMgb3BlcmF0aW9uLCByZXZpc2lvbiwgYW5kIGNhbmRpZGF0ZSBjb3JyZWxhdGlvbi5cIik7XG4gICAgfVxuICAgIGNvbnN0IGV2aWRlbmNlQ291bnQgPSByZWNlbnRTdGVwcy5yZWR1Y2UoXG4gICAgICAoY291bnQsIHN0ZXApID0+IGNvdW50ICsgKE51bWJlcihzdGVwPy5hY2NlcHRlZEV2aWRlbmNlQ291bnQpIHx8IDApLFxuICAgICAgMCxcbiAgICApO1xuICAgIGNvbnN0IHRlcm1pbmFsU3RhdGUgPSBTdHJpbmcoXG4gICAgICBleGVjdXRpb24uZmxpZ2h0U3RhdGUgPz8gZXhlY3V0aW9uLnN0YXR1cyxcbiAgICApLnRvVXBwZXJDYXNlKCk7XG4gICAgY29uc3Qgc3VjY2Vzc1N0YXRlcyA9IG5ldyBTZXQoW1xuICAgICAgXCJDT01QTEVURURcIixcbiAgICAgIFwiUkVBRFlfRk9SX1JFVklFV1wiLFxuICAgICAgXCJBUFBMSUVEXCIsXG4gICAgICBcIkNPTU1JVFRFRFwiLFxuICAgICAgXCJQVVNIRURcIixcbiAgICBdKTtcbiAgICBpZiAoXG4gICAgICBjYW1wYWlnblNjZW5hcmlvID09PSBcImRlbGl2ZXJ5LXN1Y2Nlc3NcIiAmJlxuICAgICAgc3VjY2Vzc1N0YXRlcy5oYXModGVybWluYWxTdGF0ZSkgJiZcbiAgICAgICFjYW5kaWRhdGVIYXNoXG4gICAgKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgIFwiRGVsaXZlcnktc3VjY2VzcyBjYW1wYWlnbiBjYW5ub3QgcGFzcyB3aXRob3V0IGEgY2FuZGlkYXRlLWJvdW5kIHZhbGlkYXRpb24gaGFzaC5cIixcbiAgICAgICk7XG4gICAgfVxuICAgIGNvbnN0IGRlbGl2ZXJ5U3RhZ2VzID0ge1xuICAgICAgYXBwbGllZDogZXZlbnRzLnNvbWUoKGV2ZW50KSA9PiBldmVudD8udHlwZSA9PT0gXCJBaUNoYW5nZXNBcHBsaWVkXCIpLFxuICAgICAgY29tbWl0dGVkOiBldmVudHMuc29tZSgoZXZlbnQpID0+IGV2ZW50Py50eXBlID09PSBcIkdpdENvbW1pdENyZWF0ZWRcIiksXG4gICAgICBwdXNoZWQ6IGV2ZW50cy5zb21lKChldmVudCkgPT4gZXZlbnQ/LnR5cGUgPT09IFwiR2l0UHVzaGVkXCIpLFxuICAgIH07XG4gICAgaWYgKFxuICAgICAgY2FtcGFpZ25TY2VuYXJpbyA9PT0gXCJkZWxpdmVyeS1zdWNjZXNzXCIgJiZcbiAgICAgIHN1Y2Nlc3NTdGF0ZXMuaGFzKHRlcm1pbmFsU3RhdGUpICYmXG4gICAgICAhT2JqZWN0LnZhbHVlcyhkZWxpdmVyeVN0YWdlcykuZXZlcnkoQm9vbGVhbilcbiAgICApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgXCJEZWxpdmVyeS1zdWNjZXNzIGNhbXBhaWduIGNhbm5vdCBwYXNzIHdpdGhvdXQgb3BlcmF0aW9uLWNvcnJlbGF0ZWQgYXBwbHksIGNvbW1pdCwgYW5kIHB1c2ggZXZpZGVuY2UuXCIsXG4gICAgICApO1xuICAgIH1cbiAgICBpZiAoXG4gICAgICBzdWNjZXNzU3RhdGVzLmhhcyh0ZXJtaW5hbFN0YXRlKSAmJlxuICAgICAgKGV2aWRlbmNlQ291bnQgPCAxIHx8IHZhbGlkYXRpb24ubGVuZ3RoIDwgMSlcbiAgICApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgYExpdmUtcHJvdmlkZXIgbWlzc2lvbiByZXBvcnRlZCAke3Rlcm1pbmFsU3RhdGV9IHdpdGhvdXQgYWNjZXB0ZWQgZXZpZGVuY2UgYW5kIHZhbGlkYXRpb24gYCArXG4gICAgICAgICAgYChldmlkZW5jZT0ke2V2aWRlbmNlQ291bnR9LCB2YWxpZGF0aW9uPSR7dmFsaWRhdGlvbi5sZW5ndGh9KS5gLFxuICAgICAgKTtcbiAgICB9XG4gICAgY29uc3QgY2FwdHVyZSA9IHtcbiAgICAgIHByb2plY3RJZCxcbiAgICAgIHNlc3Npb25JZCxcbiAgICAgIG9wZXJhdGlvbklkOiBleGVjdXRpb24ub3BlcmF0aW9uSWQsXG4gICAgICB3b3Jrc3BhY2VSZXZpc2lvbjpcbiAgICAgICAgZ2l0TG9nLmNvbW1pdHM/LlswXT8uc2hvcnRIYXNoID8/XG4gICAgICAgIGdpdExvZy5jb21taXRzPy5bMF0/Lmhhc2g/LnNsaWNlKDAsIDEyKSxcbiAgICAgIHByb2plY3RSZXZpc2lvbixcbiAgICAgIGNhbmRpZGF0ZUlkZW50aXR5LFxuICAgICAgY2FuZGlkYXRlUmV2aXNpb246IHByb2plY3RSZXZpc2lvbixcbiAgICAgIGNhbXBhaWduU2NlbmFyaW8sXG4gICAgICBkZWxpdmVyeVN0YWdlcyxcbiAgICAgIGN1cnJlbnRPcGVyYXRpb246IHtcbiAgICAgICAgb3BlcmF0aW9uSWQ6IGV4ZWN1dGlvbi5vcGVyYXRpb25JZCxcbiAgICAgICAgcmV2aXNpb246IHByb2plY3RSZXZpc2lvbixcbiAgICAgICAgc3RhdHVzOiBleGVjdXRpb24uc3RhdHVzLFxuICAgICAgICB0ZXJtaW5hbFN0YXRlLFxuICAgICAgfSxcbiAgICAgIHJldGFpbmVkUmVzdWx0OlxuICAgICAgICB0ZXJtaW5hbFN0YXRlID09PSBcIkZBSUxFRFwiIHx8IHRlcm1pbmFsU3RhdGUgPT09IFwiQkxPQ0tFRFwiIHx8IHRlcm1pbmFsU3RhdGUgPT09IFwiSU5DT01QTEVURVwiXG4gICAgICAgICAgPyB7XG4gICAgICAgICAgICAgIG9wZXJhdGlvbklkOiBleGVjdXRpb24ub3BlcmF0aW9uSWQsXG4gICAgICAgICAgICAgIHJldmlzaW9uOiBwcm9qZWN0UmV2aXNpb24sXG4gICAgICAgICAgICAgIGxhYmVsOiBcInJldGFpbmVkIHJlc3VsdCBmcm9tIHRoZSBjdXJyZW50IGZhaWxlZCBvciBpbmNvbXBsZXRlIG9wZXJhdGlvblwiLFxuICAgICAgICAgICAgfVxuICAgICAgICAgIDogdW5kZWZpbmVkLFxuICAgICAgdGVybWluYWxTdGF0ZSxcbiAgICAgIGV4ZWN1dGlvbjoge1xuICAgICAgICBpZDogZXhlY3V0aW9uLmlkLFxuICAgICAgICBwcm9qZWN0SWQ6IGV4ZWN1dGlvbi5wcm9qZWN0SWQsXG4gICAgICAgIHNlc3Npb25JZDogZXhlY3V0aW9uLnNlc3Npb25JZCxcbiAgICAgICAgb3BlcmF0aW9uSWQ6IGV4ZWN1dGlvbi5vcGVyYXRpb25JZCxcbiAgICAgICAgc3RhdHVzOiBleGVjdXRpb24uc3RhdHVzLFxuICAgICAgICBmbGlnaHRTdGF0ZTogZXhlY3V0aW9uLmZsaWdodFN0YXRlLFxuICAgICAgfSxcbiAgICAgIG1lc3NhZ2VzOiBtZXNzYWdlcy5tYXAoXG4gICAgICAgICh7XG4gICAgICAgICAgaWQsXG4gICAgICAgICAgc2Vzc2lvbklkOiBtZXNzYWdlU2Vzc2lvbixcbiAgICAgICAgICByb2xlLFxuICAgICAgICAgIGV4ZWN1dGlvbklkOiBtZXNzYWdlRXhlY3V0aW9uLFxuICAgICAgICAgIG91dGNvbWUsXG4gICAgICAgIH0pID0+ICh7XG4gICAgICAgICAgaWQsXG4gICAgICAgICAgc2Vzc2lvbklkOiBtZXNzYWdlU2Vzc2lvbixcbiAgICAgICAgICByb2xlLFxuICAgICAgICAgIGV4ZWN1dGlvbklkOiBtZXNzYWdlRXhlY3V0aW9uLFxuICAgICAgICAgIG91dGNvbWUsXG4gICAgICAgIH0pLFxuICAgICAgKSxcbiAgICAgIHNzZUV2ZW50czogc3NlRXZlbnRzLm1hcChcbiAgICAgICAgKHtcbiAgICAgICAgICB0eXBlLFxuICAgICAgICAgIGV4ZWN1dGlvbklkOiBldmVudEV4ZWN1dGlvbixcbiAgICAgICAgICBzZXNzaW9uSWQ6IGV2ZW50U2Vzc2lvbixcbiAgICAgICAgICBvdXRjb21lLFxuICAgICAgICAgIGNvZGUsXG4gICAgICAgIH0pID0+ICh7XG4gICAgICAgICAgdHlwZSxcbiAgICAgICAgICBleGVjdXRpb25JZDogZXZlbnRFeGVjdXRpb24sXG4gICAgICAgICAgc2Vzc2lvbklkOiBldmVudFNlc3Npb24sXG4gICAgICAgICAgb3V0Y29tZSxcbiAgICAgICAgICBjb2RlLFxuICAgICAgICB9KSxcbiAgICAgICksXG4gICAgICBjaGVja3BvaW50czogW1xuICAgICAgICB7XG4gICAgICAgICAgc2VxdWVuY2U6IGNoZWNrcG9pbnQuc2VxdWVuY2UsXG4gICAgICAgICAgc3RhZ2U6IGNoZWNrcG9pbnQuc3RhZ2UsXG4gICAgICAgICAgdXBkYXRlZEF0OiBjaGVja3BvaW50LnVwZGF0ZWRBdCxcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgICBldmlkZW5jZUNvdW50LFxuICAgICAgcHJvcG9zYWxzOiBwcm9wb3NhbFxuICAgICAgICA/IFtcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgaWQ6IHByb3Bvc2FsLmlkLFxuICAgICAgICAgICAgICByZXZpc2lvbjogcHJvcG9zYWwucmV2aXNpb24sXG4gICAgICAgICAgICAgIHN0YXR1czogcHJvcG9zYWwuc3RhdHVzLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICBdXG4gICAgICAgIDogW10sXG4gICAgICB2YWxpZGF0aW9uOiB2YWxpZGF0aW9uLm1hcCgoc3RlcCkgPT4gKHtcbiAgICAgICAgc3RhdHVzOiBzdGVwLnZhbGlkYXRpb24/LnN0YXR1cyA/PyBzdGVwLnN0YXR1cyxcbiAgICAgICAgcHJvZmlsZTogc3RlcC52YWxpZGF0aW9uPy5wcm9maWxlID8/IHN0ZXAudmFsaWRhdGlvblByb2ZpbGUsXG4gICAgICB9KSksXG4gICAgICBldmVudHM6IGV2ZW50cy5tYXAoKHsgdHlwZSwgc2V2ZXJpdHksIGNvcnJlbGF0aW9uSWQgfSkgPT4gKHtcbiAgICAgICAgdHlwZSxcbiAgICAgICAgc2V2ZXJpdHksXG4gICAgICAgIGNvcnJlbGF0aW9uSWQsXG4gICAgICB9KSksXG4gICAgICBkYXNoYm9hcmQ6IG1pc3Npb25Db250cm9sLFxuICAgICAgZGFzaGJvYXJkU3RhdGU6IHtcbiAgICAgICAgcHJvamVjdENvdW50OiBkYXNoYm9hcmRTdGF0ZS5wcm9qZWN0Q291bnQsXG4gICAgICAgIGFjdGl2ZVRhc2tDb3VudDogZGFzaGJvYXJkU3RhdGUuYWN0aXZlVGFza0NvdW50LFxuICAgICAgfSxcbiAgICB9O1xuICAgIGNvbnN0IG91dHB1dFBhdGggPVxuICAgICAgcHJvY2Vzcy5lbnYuREFTSEJPQVJEX0UyRV9MSVZFX1JFUE9SVF9QQVRIID8/XG4gICAgICBcInRlc3QtcmVzdWx0cy9kYXNoYm9hcmQtam91cm5leS9saXZlLW1pc3Npb24tY29ycmVsYXRpb24uanNvblwiO1xuICAgIGF3YWl0IG1rZGlyKGRpcm5hbWUob3V0cHV0UGF0aCksIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xuICAgIGF3YWl0IHdyaXRlRmlsZShcbiAgICAgIG91dHB1dFBhdGgsXG4gICAgICBgJHtKU09OLnN0cmluZ2lmeShjYXB0dXJlLCBudWxsLCAyKX1cXG5gLFxuICAgICAgXCJ1dGY4XCIsXG4gICAgKTtcbiAgfSk7XG5cbiAgdGVzdChcInNpZ25zIGluIGFuZCB0cmF2ZXJzZXMgdGhlIGF1dGhlbnRpY2F0ZWQgb3BlcmF0aW9uYWwgc2hlbGxcIiwgYXN5bmMgKHtcbiAgICBwYWdlLFxuICB9KSA9PiB7XG4gICAgYXdhaXQgaW5zdGFsbEFwaUZpeHR1cmVzKHBhZ2UpO1xuICAgIGF3YWl0IHByb2dyYW1tYXRpY1NpZ25JbihwYWdlKTtcbiAgICBmb3IgKGNvbnN0IG9yaWdpbiBvZiBhcHByb3ZlZERhc2hib2FyZE9yaWdpbnMoKSkge1xuICAgICAgYXdhaXQgZXhwZWN0T3JpZ2luQ2FuVXNlQXBpKHBhZ2UsIG9yaWdpbik7XG4gICAgfVxuICAgIGF3YWl0IGV4cGVjdEhvc3RpbGVPcmlnaW5SZWplY3RlZChwYWdlKTtcblxuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlSb2xlKFwiaGVhZGluZ1wiLCB7IG5hbWU6IFwiU3lzdGVtIE92ZXJ2aWV3XCIgfSksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiU1lTVEVNIE9OTElORVwiLCB7IGV4YWN0OiB0cnVlIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcIlNtb2tlIFByb2plY3RcIiwgeyBleGFjdDogdHJ1ZSB9KS5maXJzdCgpLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcIkRhc2hib2FyZCBBUEkgZml4dHVyZSByZWFkeVwiLCB7IGV4YWN0OiB0cnVlIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBvcGVuTmF2aWdhdGlvbihwYWdlLCBcIlByb2plY3RzXCIsIGAke0RBU0hCT0FSRF9QQVRIfXByb2plY3RzYCk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlSb2xlKFwiaGVhZGluZ1wiLCB7IG5hbWU6IFwiUHJvamVjdHNcIiB9KSkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcIlNtb2tlIFByb2plY3RcIiwgeyBleGFjdDogdHJ1ZSB9KSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG5cbiAgICBhd2FpdCBvcGVuTmF2aWdhdGlvbihwYWdlLCBcIkV2ZW50IFN0cmVhbVwiLCBgJHtEQVNIQk9BUkRfUEFUSH1ldmVudHNgKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5Um9sZShcImhlYWRpbmdcIiwgeyBuYW1lOiBcIkV2ZW50IFN0cmVhbVwiIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcIkRhc2hib2FyZCBBUEkgZml4dHVyZSByZWFkeVwiLCB7IGV4YWN0OiB0cnVlIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcblxuICAgIGF3YWl0IG9wZW5OYXZpZ2F0aW9uKHBhZ2UsIFwiQUkgQXNzaXN0YW50XCIsIGAke0RBU0hCT0FSRF9QQVRIfWFpYCk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UpLm5vdC50b0hhdmVVUkwoL3NpZ24taW4vKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlXG4gICAgICAgIC5nZXRCeVRleHQoXG4gICAgICAgICAgL0FJIHByb3ZpZGVyIG5vdCBjb25maWd1cmVkfE5vIEFJIGtleSBjb25maWd1cmVkfEFJIEFzc2lzdGFudC9pLFxuICAgICAgICApXG4gICAgICAgIC5maXJzdCgpLFxuICAgICkudG9CZVZpc2libGUoKTtcblxuICAgIGF3YWl0IG9wZW5OYXZpZ2F0aW9uKFxuICAgICAgcGFnZSxcbiAgICAgIFwiTWlzc2lvbiBDb250cm9sXCIsXG4gICAgICBgJHtEQVNIQk9BUkRfUEFUSH1taXNzaW9uLWNvbnRyb2xgLFxuICAgICk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVJvbGUoXCJoZWFkaW5nXCIsIHsgbmFtZTogXCJObyBkdXJhYmxlIHJ1bnMgaW4gdGhlIGxlZGdlclwiIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcblxuICAgIGF3YWl0IHBhZ2UuZ290byhgJHtEQVNIQk9BUkRfUEFUSH1mbGlnaHQtZGVjaz9leGVjdXRpb25JZD0ke0VYRUNVVElPTl9JRH1gKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZSkudG9IYXZlVVJMKFxuICAgICAgbmV3IFJlZ0V4cChcbiAgICAgICAgYCR7REFTSEJPQVJEX1BBVEgucmVwbGFjZUFsbChcIi9cIiwgXCJcXFxcL1wiKX1mbGlnaHQtZGVja1xcXFw/ZXhlY3V0aW9uSWQ9YCxcbiAgICAgICksXG4gICAgKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5Um9sZShcImhlYWRpbmdcIiwgeyBuYW1lOiBcIkF1ZGl0IC8gQ2hhdCBydW5cIiB9KSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXCJDb250cm9sbGVkIGJyb3dzZXIgZml4dHVyZSBjb21wbGV0ZWQuXCIsIHsgZXhhY3Q6IHRydWUgfSksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiUFJPVkVOXCIsIHsgZXhhY3Q6IHRydWUgfSkuZmlyc3QoKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gIH0pO1xuXG4gIHRlc3QoXCJvcGVucyBmYWlsZWQgdGFzayBhbmQgd29ya2Zsb3cgZGV0YWlscyB3aXRoIHJlZGFjdGVkIHJlY292ZXJ5IGd1aWRhbmNlXCIsIGFzeW5jICh7XG4gICAgcGFnZSxcbiAgfSkgPT4ge1xuICAgIGNvbnN0IHJhd0RpYWdub3N0aWMgPSBcInByb3ZpZGVyIGRpYWdub3N0aWM6IHVwc3RyZWFtIHJldHVybmVkIHJhdyByZXNwb25zZVwiO1xuICAgIGNvbnN0IHJhd0NyZWRlbnRpYWwgPSBcInNrLWUyZS1icm93c2VyLWNyZWRlbnRpYWwtc2VjcmV0XCI7XG4gICAgY29uc3Qgc3VwcG9ydFJlZmVyZW5jZXMgPSB7XG4gICAgICBhdXRoZW50aWNhdGlvbl9mYWlsZWQ6IFwic3VwcG9ydC10YXNrLWF1dGgtMzJcIixcbiAgICAgIHF1b3RhX2V4aGF1c3RlZDogXCJzdXBwb3J0LXRhc2stcXVvdGEtMzJcIixcbiAgICAgIHByb3ZpZGVyX291dGFnZTogXCJzdXBwb3J0LXdvcmtmbG93LW91dGFnZS0zMlwiLFxuICAgIH07XG4gICAgY29uc3QgcmVjb3ZlcnlUYXNrcyA9IFtcbiAgICAgIHtcbiAgICAgICAgaWQ6IFwiZTJlLWF1dGgtZmFpbGVkLXRhc2tcIixcbiAgICAgICAgcHJvamVjdElkOiBcImUyZS1wcm9qZWN0XCIsXG4gICAgICAgIHRpdGxlOiBcIlJlY292ZXIgYXV0aGVudGljYXRpb24gZmFpbHVyZVwiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJUaGUgcHJvdmlkZXIgYXV0aGVudGljYXRpb24gdGVzdCB0YXNrIGZhaWxlZC5cIixcbiAgICAgICAgc3RhdHVzOiBcImZhaWxlZFwiLFxuICAgICAgICBwcmlvcml0eTogXCJwMVwiLFxuICAgICAgICByZWxhdGVkRmlsZXM6IFtcInNyYy9wcm92aWRlci50c1wiXSxcbiAgICAgICAgcmV0cnlDb3VudDogMSxcbiAgICAgICAgbWF4UmV0cmllczogMixcbiAgICAgICAgYWdlbnRSZXNwb25zZTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgIGtpbmQ6IFwiQUlfVEFTS19FWEVDVVRJT05fUkVDRUlQVFwiLFxuICAgICAgICAgIHRlcm1pbmFsU3RhdHVzOiBcIkZBSUxFRFwiLFxuICAgICAgICAgIGF2YWlsYWJpbGl0eVN0YXRlOiBcImF1dGhlbnRpY2F0aW9uX2ZhaWxlZFwiLFxuICAgICAgICAgIGNvcnJlbGF0aW9uSWQ6IHN1cHBvcnRSZWZlcmVuY2VzLmF1dGhlbnRpY2F0aW9uX2ZhaWxlZCxcbiAgICAgICAgICBvcGVyYXRvckFjdGlvbjogXCJSZXBsYWNlIHRoZSBwcm92aWRlciBBUEkga2V5IHdpdGggYSB2YWxpZCBrZXksIHRoZW4gcmV0cnkuXCIsXG4gICAgICAgICAgcHJvdmlkZXI6IFwib3BlbnJvdXRlclwiLFxuICAgICAgICAgIG1vZGVsOiBcInNlY3JldC1tb2RlbC1uYW1lXCIsXG4gICAgICAgICAgdGVybWluYWxSZWFzb246IHJhd0RpYWdub3N0aWMsXG4gICAgICAgICAgb3BlcmF0aW9uSWQ6IHJhd0NyZWRlbnRpYWwsXG4gICAgICAgIH0pLFxuICAgICAgICBjcmVhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMDowMC4wMDBaXCIsXG4gICAgICAgIHVwZGF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAxOjAwLjAwMFpcIixcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIGlkOiBcImUyZS1xdW90YS1mYWlsZWQtdGFza1wiLFxuICAgICAgICBwcm9qZWN0SWQ6IFwiZTJlLXByb2plY3RcIixcbiAgICAgICAgdGl0bGU6IFwiUmVjb3ZlciBxdW90YSBleGhhdXN0aW9uXCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIlRoZSBwcm92aWRlciBxdW90YSB0ZXN0IHRhc2sgZmFpbGVkLlwiLFxuICAgICAgICBzdGF0dXM6IFwiZmFpbGVkXCIsXG4gICAgICAgIHByaW9yaXR5OiBcInAxXCIsXG4gICAgICAgIHJldHJ5Q291bnQ6IDAsXG4gICAgICAgIG1heFJldHJpZXM6IDIsXG4gICAgICAgIGFnZW50UmVzcG9uc2U6IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgICBraW5kOiBcIkFJX1RBU0tfRVhFQ1VUSU9OX1JFQ0VJUFRcIixcbiAgICAgICAgICB0ZXJtaW5hbFN0YXR1czogXCJGQUlMRURcIixcbiAgICAgICAgICBhdmFpbGFiaWxpdHlTdGF0ZTogXCJxdW90YV9leGhhdXN0ZWRcIixcbiAgICAgICAgICBjb3JyZWxhdGlvbklkOiBzdXBwb3J0UmVmZXJlbmNlcy5xdW90YV9leGhhdXN0ZWQsXG4gICAgICAgICAgcHJvdmlkZXI6IFwib3BlbnJvdXRlclwiLFxuICAgICAgICAgIG1vZGVsOiBcInNlY3JldC1tb2RlbC1uYW1lXCIsXG4gICAgICAgICAgdGVybWluYWxSZWFzb246IHJhd0RpYWdub3N0aWMsXG4gICAgICAgICAgb3BlcmF0aW9uSWQ6IHJhd0NyZWRlbnRpYWwsXG4gICAgICAgIH0pLFxuICAgICAgICBjcmVhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMDowMC4wMDBaXCIsXG4gICAgICAgIHVwZGF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAxOjAwLjAwMFpcIixcbiAgICAgIH0sXG4gICAgXTtcbiAgICBjb25zdCB3b3JrZmxvd0lkID0gXCJlMmUtb3V0YWdlLXdvcmtmbG93XCI7XG4gICAgYXdhaXQgaW5zdGFsbEFwaUZpeHR1cmVzKHBhZ2UsIHtcbiAgICAgIHJlY292ZXJ5VGFza3MsXG4gICAgICByZWNvdmVyeVdvcmtmbG93czogW1xuICAgICAgICB7XG4gICAgICAgICAgaWQ6IHdvcmtmbG93SWQsXG4gICAgICAgICAgcHJvamVjdElkOiBcImUyZS1wcm9qZWN0XCIsXG4gICAgICAgICAgbmFtZTogXCJSZWNvdmVyIHByb3ZpZGVyIG91dGFnZVwiLFxuICAgICAgICAgIGRlc2NyaXB0aW9uOiBcIkEgcGlwZWxpbmUgdXNlZCB0byB2ZXJpZnkgb3V0YWdlIHJlY292ZXJ5IGd1aWRhbmNlLlwiLFxuICAgICAgICAgIHN0YXR1czogXCJmYWlsZWRcIixcbiAgICAgICAgICBwaGFzZXM6IFtcbiAgICAgICAgICAgIHsgbmFtZTogXCJidWlsZFwiLCBzdGVwczogW1wiY29tcGlsZVwiXSB9LFxuICAgICAgICAgICAgeyBuYW1lOiBcInRlc3RcIiwgc3RlcHM6IFtcInZlcmlmeVwiXSB9LFxuICAgICAgICAgIF0sXG4gICAgICAgICAgY3VycmVudFBoYXNlOiBcInRlc3RcIixcbiAgICAgICAgICBleGVjdXRpb25Db3VudDogMSxcbiAgICAgICAgICBjcmVhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMDowMC4wMDBaXCIsXG4gICAgICAgICAgdXBkYXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDE6MDAuMDAwWlwiLFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICAgIHJlY292ZXJ5V29ya2Zsb3dFeGVjdXRpb25zOiB7XG4gICAgICAgIFt3b3JrZmxvd0lkXTogW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIGlkOiBcImUyZS1vdXRhZ2UtZXhlY3V0aW9uXCIsXG4gICAgICAgICAgICB3b3JrZmxvd0lkLFxuICAgICAgICAgICAgc3RhdHVzOiBcImZhaWxlZFwiLFxuICAgICAgICAgICAgY3VycmVudFBoYXNlOiBcInRlc3RcIixcbiAgICAgICAgICAgIGNvbXBsZXRlZFBoYXNlczogW1wiYnVpbGRcIl0sXG4gICAgICAgICAgICBzdGFydGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMDowMC4wMDBaXCIsXG4gICAgICAgICAgICBlcnJvck1lc3NhZ2U6IHJhd0RpYWdub3N0aWMsXG4gICAgICAgICAgICByZWNvdmVyeToge1xuICAgICAgICAgICAgICBhdmFpbGFiaWxpdHlTdGF0ZTogXCJwcm92aWRlcl9vdXRhZ2VcIixcbiAgICAgICAgICAgICAgY29ycmVsYXRpb25JZDogc3VwcG9ydFJlZmVyZW5jZXMucHJvdmlkZXJfb3V0YWdlLFxuICAgICAgICAgICAgICBvcGVyYXRvckFjdGlvbjpcbiAgICAgICAgICAgICAgICBcIlJldHJ5IGluIGEgbW9tZW50OyBjb25maWd1cmUgYW5vdGhlciBwcm92aWRlciBpZiB0aGUgaXNzdWUgcGVyc2lzdHMuXCIsXG4gICAgICAgICAgICAgIGRpYWdub3N0aWM6IHJhd0NyZWRlbnRpYWwsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgIF0sXG4gICAgICB9LFxuICAgIH0pO1xuICAgIGF3YWl0IHByb2dyYW1tYXRpY1NpZ25JbihwYWdlKTtcblxuICAgIGF3YWl0IG9wZW5OYXZpZ2F0aW9uKHBhZ2UsIFwiVGFza3NcIiwgYCR7REFTSEJPQVJEX1BBVEh9dGFza3NgKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5TGFiZWwoXCJFeHBhbmQgdGFzayBSZWNvdmVyIGF1dGhlbnRpY2F0aW9uIGZhaWx1cmVcIiksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IHBhZ2VcbiAgICAgIC5nZXRCeUxhYmVsKFwiRXhwYW5kIHRhc2sgUmVjb3ZlciBhdXRoZW50aWNhdGlvbiBmYWlsdXJlXCIpXG4gICAgICAuY2xpY2soKTtcbiAgICBjb25zdCB0YXNrRGV0YWlscyA9IHBhZ2UubG9jYXRvcihcIiN0YXNrLWRldGFpbHMtZTJlLWF1dGgtZmFpbGVkLXRhc2tcIik7XG4gICAgYXdhaXQgZXhwZWN0KHRhc2tEZXRhaWxzKS50b0NvbnRhaW5UZXh0KFwiUHJvdmlkZXIgYXV0aGVudGljYXRpb24gZmFpbGVkXCIpO1xuICAgIGF3YWl0IGV4cGVjdCh0YXNrRGV0YWlscykudG9Db250YWluVGV4dChcbiAgICAgIFwiUmVwbGFjZSB0aGUgcHJvdmlkZXIgQVBJIGtleSB3aXRoIGEgdmFsaWQga2V5LCB0aGVuIHJldHJ5LlwiLFxuICAgICk7XG4gICAgYXdhaXQgZXhwZWN0KHRhc2tEZXRhaWxzKS50b0NvbnRhaW5UZXh0KFxuICAgICAgYFN1cHBvcnQgcmVmZXJlbmNlOiAke3N1cHBvcnRSZWZlcmVuY2VzLmF1dGhlbnRpY2F0aW9uX2ZhaWxlZH1gLFxuICAgICk7XG4gICAgYXdhaXQgcGFnZS5nZXRCeUxhYmVsKFwiRXhwYW5kIHRhc2sgUmVjb3ZlciBxdW90YSBleGhhdXN0aW9uXCIpLmNsaWNrKCk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlUZXh0KFwiUHJvdmlkZXIgcXVvdGEgaXMgZXhoYXVzdGVkXCIpKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KGBTdXBwb3J0IHJlZmVyZW5jZTogJHtzdXBwb3J0UmVmZXJlbmNlcy5xdW90YV9leGhhdXN0ZWR9YCksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IHBhZ2UucmVsb2FkKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeUxhYmVsKFwiRXhwYW5kIHRhc2sgUmVjb3ZlciBhdXRoZW50aWNhdGlvbiBmYWlsdXJlXCIpLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBwYWdlXG4gICAgICAuZ2V0QnlMYWJlbChcIkV4cGFuZCB0YXNrIFJlY292ZXIgYXV0aGVudGljYXRpb24gZmFpbHVyZVwiKVxuICAgICAgLmNsaWNrKCk7XG4gICAgY29uc3QgcmVsb2FkZWRBdXRoRGV0YWlscyA9IHBhZ2UubG9jYXRvcihcbiAgICAgIFwiI3Rhc2stZGV0YWlscy1lMmUtYXV0aC1mYWlsZWQtdGFza1wiLFxuICAgICk7XG4gICAgYXdhaXQgZXhwZWN0KHJlbG9hZGVkQXV0aERldGFpbHMpLnRvQ29udGFpblRleHQoXG4gICAgICBcIlByb3ZpZGVyIGF1dGhlbnRpY2F0aW9uIGZhaWxlZFwiLFxuICAgICk7XG4gICAgYXdhaXQgZXhwZWN0KHJlbG9hZGVkQXV0aERldGFpbHMpLnRvQ29udGFpblRleHQoXG4gICAgICBcIlJlcGxhY2UgdGhlIHByb3ZpZGVyIEFQSSBrZXkgd2l0aCBhIHZhbGlkIGtleSwgdGhlbiByZXRyeS5cIixcbiAgICApO1xuICAgIGF3YWl0IGV4cGVjdChyZWxvYWRlZEF1dGhEZXRhaWxzKS50b0NvbnRhaW5UZXh0KFxuICAgICAgYFN1cHBvcnQgcmVmZXJlbmNlOiAke3N1cHBvcnRSZWZlcmVuY2VzLmF1dGhlbnRpY2F0aW9uX2ZhaWxlZH1gLFxuICAgICk7XG4gICAgYXdhaXQgcGFnZS5nZXRCeUxhYmVsKFwiRXhwYW5kIHRhc2sgUmVjb3ZlciBxdW90YSBleGhhdXN0aW9uXCIpLmNsaWNrKCk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlUZXh0KFwiUHJvdmlkZXIgcXVvdGEgaXMgZXhoYXVzdGVkXCIpKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KGBTdXBwb3J0IHJlZmVyZW5jZTogJHtzdXBwb3J0UmVmZXJlbmNlcy5xdW90YV9leGhhdXN0ZWR9YCksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGNvbnN0IHJlbG9hZGVkVGFza1RleHQgPSBhd2FpdCBwYWdlLmxvY2F0b3IoXCJib2R5XCIpLmlubmVyVGV4dCgpO1xuICAgIGV4cGVjdChyZWxvYWRlZFRhc2tUZXh0KS5ub3QudG9Db250YWluKHJhd0RpYWdub3N0aWMpO1xuICAgIGV4cGVjdChyZWxvYWRlZFRhc2tUZXh0KS5ub3QudG9Db250YWluKHJhd0NyZWRlbnRpYWwpO1xuICAgIGV4cGVjdChyZWxvYWRlZFRhc2tUZXh0KS5ub3QudG9NYXRjaChcbiAgICAgIC9zZWNyZXQtbW9kZWwtbmFtZXxcXC9ob21lXFwvcnVubmVyfFxcL3RtcFxcLy9pLFxuICAgICk7XG5cbiAgICBhd2FpdCBvcGVuTmF2aWdhdGlvbihwYWdlLCBcIldvcmtmbG93c1wiLCBgJHtEQVNIQk9BUkRfUEFUSH13b3JrZmxvd3NgKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5nZXRCeVRleHQoXCJSZWNvdmVyIHByb3ZpZGVyIG91dGFnZVwiKSkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBwYWdlLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiRXhlY3V0aW9uIGhpc3RvcnlcIiB9KS5jbGljaygpO1xuICAgIGNvbnN0IGV4ZWN1dGlvbiA9IHBhZ2VcbiAgICAgIC5nZXRCeVRleHQoXCJmYWlsZWQgwrcgbm8gc3VjY2Vzc2Z1bCBjb21wbGV0aW9uXCIpXG4gICAgICAubG9jYXRvcihcIi4uXCIpXG4gICAgICAubG9jYXRvcihcIi4uXCIpO1xuICAgIGF3YWl0IGV4cGVjdChleGVjdXRpb24pLnRvQ29udGFpblRleHQoXG4gICAgICBcIlRoZSBwcm92aWRlciBpcyB0ZW1wb3JhcmlseSB1bmF2YWlsYWJsZVwiLFxuICAgICk7XG4gICAgYXdhaXQgZXhwZWN0KGV4ZWN1dGlvbikudG9Db250YWluVGV4dChcbiAgICAgIFwiUmV0cnkgaW4gYSBtb21lbnQ7IGNvbmZpZ3VyZSBhbm90aGVyIHByb3ZpZGVyIGlmIHRoZSBpc3N1ZSBwZXJzaXN0cy5cIixcbiAgICApO1xuICAgIGF3YWl0IGV4cGVjdChleGVjdXRpb24pLnRvQ29udGFpblRleHQoXG4gICAgICBgU3VwcG9ydCByZWZlcmVuY2U6ICR7c3VwcG9ydFJlZmVyZW5jZXMucHJvdmlkZXJfb3V0YWdlfWAsXG4gICAgKTtcbiAgICBhd2FpdCBwYWdlLnJlbG9hZCgpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlLmdldEJ5VGV4dChcIlJlY292ZXIgcHJvdmlkZXIgb3V0YWdlXCIpKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJFeGVjdXRpb24gaGlzdG9yeVwiIH0pLmNsaWNrKCk7XG4gICAgY29uc3QgcmVsb2FkZWRFeGVjdXRpb24gPSBwYWdlXG4gICAgICAuZ2V0QnlUZXh0KFwiZmFpbGVkIMK3IG5vIHN1Y2Nlc3NmdWwgY29tcGxldGlvblwiKVxuICAgICAgLmxvY2F0b3IoXCIuLlwiKVxuICAgICAgLmxvY2F0b3IoXCIuLlwiKTtcbiAgICBhd2FpdCBleHBlY3QocmVsb2FkZWRFeGVjdXRpb24pLnRvQ29udGFpblRleHQoXG4gICAgICBcIlRoZSBwcm92aWRlciBpcyB0ZW1wb3JhcmlseSB1bmF2YWlsYWJsZVwiLFxuICAgICk7XG4gICAgYXdhaXQgZXhwZWN0KHJlbG9hZGVkRXhlY3V0aW9uKS50b0NvbnRhaW5UZXh0KFxuICAgICAgXCJSZXRyeSBpbiBhIG1vbWVudDsgY29uZmlndXJlIGFub3RoZXIgcHJvdmlkZXIgaWYgdGhlIGlzc3VlIHBlcnNpc3RzLlwiLFxuICAgICk7XG4gICAgYXdhaXQgZXhwZWN0KHJlbG9hZGVkRXhlY3V0aW9uKS50b0NvbnRhaW5UZXh0KFxuICAgICAgYFN1cHBvcnQgcmVmZXJlbmNlOiAke3N1cHBvcnRSZWZlcmVuY2VzLnByb3ZpZGVyX291dGFnZX1gLFxuICAgICk7XG5cbiAgICBjb25zdCB2aXNpYmxlVGV4dCA9IGF3YWl0IHBhZ2UubG9jYXRvcihcImJvZHlcIikuaW5uZXJUZXh0KCk7XG4gICAgZXhwZWN0KHZpc2libGVUZXh0KS5ub3QudG9Db250YWluKHJhd0RpYWdub3N0aWMpO1xuICAgIGV4cGVjdCh2aXNpYmxlVGV4dCkubm90LnRvQ29udGFpbihyYXdDcmVkZW50aWFsKTtcbiAgICBleHBlY3QodmlzaWJsZVRleHQpLm5vdC50b01hdGNoKFxuICAgICAgL3NlY3JldC1tb2RlbC1uYW1lfFxcL2hvbWVcXC9ydW5uZXJ8XFwvdG1wXFwvL2ksXG4gICAgKTtcbiAgICBhd2FpdCBleHBlY3ROb0hvcml6b250YWxPdmVyZmxvdyhwYWdlKTtcbiAgfSk7XG5cbiAgdGVzdChcInByb3ZlcyByZW1lZGlhdGlvbiBwbGFucywgcmV2aWV3IHN0YXRlLCBhbmQgdGFzayBhY3Rpb24gdHJhbnNpdGlvbnNcIiwgYXN5bmMgKHtcbiAgICBwYWdlLFxuICB9KSA9PiB7XG4gICAgY29uc3QgcmF3UHJvbXB0ID0gXCJJTlRFUk5BTF9QUk9NUFRfc2hvdWxkX25ldmVyX3JlbmRlclwiO1xuICAgIGNvbnN0IHJhd0RpYWdub3N0aWMgPSBcInJhdy1wcm92aWRlci1kaWFnbm9zdGljLXNob3VsZC1uZXZlci1yZW5kZXJcIjtcbiAgICBjb25zdCByZWFkeVRhc2tJZCA9IFwiZTJlLXJlYWR5LXJlbWVkaWF0aW9uLXRhc2tcIjtcbiAgICBjb25zdCByZXZpZXdUYXNrSWQgPSBcImUyZS1yZXZpZXctcmVtZWRpYXRpb24tdGFza1wiO1xuICAgIGNvbnN0IHZlcmlmaWNhdGlvblRhc2tJZCA9IFwiZTJlLXZlcmlmaWNhdGlvbi1yZW1lZGlhdGlvbi10YXNrXCI7XG4gICAgY29uc3QgcmVtZWRpYXRpb25UYXNrcyA9IFtcbiAgICAgIHtcbiAgICAgICAgaWQ6IHJlYWR5VGFza0lkLFxuICAgICAgICBwcm9qZWN0SWQ6IFwiZTJlLXByb2plY3RcIixcbiAgICAgICAgdGl0bGU6IFwiRXhlY3V0ZSBTUUwgaW5wdXQgc2FuaXRpemF0aW9uIHJlbWVkaWF0aW9uXCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIkEgY29tcGxldGUgcmVtZWRpYXRpb24gcGxhbiBpcyByZWFkeSBmb3Igb3BlcmF0b3IgZXhlY3V0aW9uLlwiLFxuICAgICAgICBzdGF0dXM6IFwicGVuZGluZ1wiLFxuICAgICAgICBwcmlvcml0eTogXCJwMVwiLFxuICAgICAgICBwaGFzZTogXCJSZW1lZGlhdGlvblwiLFxuICAgICAgICByZWxhdGVkRmlsZXM6IFtcInNyYy9hdXRoL2lucHV0LnRzXCJdLFxuICAgICAgICByZXRyeUNvdW50OiAwLFxuICAgICAgICBtYXhSZXRyaWVzOiAyLFxuICAgICAgICBwcm9tcHQ6IHJhd1Byb21wdCxcbiAgICAgICAgYWdlbnRSZXNwb25zZTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgIGtpbmQ6IFwiQUlfVEFTS19FWEVDVVRJT05fUkVDRUlQVFwiLFxuICAgICAgICAgIHRlcm1pbmFsU3RhdHVzOiBcIlJFQ09SREVEXCIsXG4gICAgICAgICAgdGVybWluYWxSZWFzb246IHJhd0RpYWdub3N0aWMsXG4gICAgICAgIH0pLFxuICAgICAgICByZW1lZGlhdGlvblBsYW46IHtcbiAgICAgICAgICB2ZXJzaW9uOiAxLFxuICAgICAgICAgIHJ1bGVJZDogXCJlMmUtcnVsZS1zcWwtaW5wdXRcIixcbiAgICAgICAgICBydWxlQ29kZTogXCJTRUMtMDAxXCIsXG4gICAgICAgICAgcnVsZVRpdGxlOiBcIlVuc2FuaXRpemVkIFNRTCBpbnB1dFwiLFxuICAgICAgICAgIHNldmVyaXR5OiBcImhpZ2hcIixcbiAgICAgICAgICBvY2N1cnJlbmNlQ291bnQ6IDIsXG4gICAgICAgICAgZXZpZGVuY2U6IFtcbiAgICAgICAgICAgIHsgZmlsZTogXCJzcmMvYXV0aC9pbnB1dC50c1wiLCBsaW5lOiAxMCwgc25pcHBldDogXCJxdWVyeSh1c2VySW5wdXQpXCIsIG9jY3VycmVuY2VzOiAxIH0sXG4gICAgICAgICAgICB7IGZpbGU6IFwic3JjL2F1dGgvaW5wdXQudHNcIiwgbGluZTogMTgsIHNuaXBwZXQ6IFwicXVlcnkoYWNjb3VudElkKVwiLCBvY2N1cnJlbmNlczogMSB9LFxuICAgICAgICAgICAgeyBmaWxlOiBcInNyYy9hdXRoL2lucHV0LnRzXCIsIGxpbmU6IDI3LCBzbmlwcGV0OiBcInF1ZXJ5KGZpbHRlcilcIiwgb2NjdXJyZW5jZXM6IDEgfSxcbiAgICAgICAgICAgIHsgZmlsZTogXCJzcmMvYXV0aC9pbnB1dC50c1wiLCBsaW5lOiAzMSwgc25pcHBldDogXCJxdWVyeShzb3J0KVwiLCBvY2N1cnJlbmNlczogMSB9LFxuICAgICAgICAgICAgeyBmaWxlOiBcInNyYy9hdXRoL2lucHV0LnRzXCIsIGxpbmU6IDQ0LCBzbmlwcGV0OiBcInF1ZXJ5KGxpbWl0KVwiLCBvY2N1cnJlbmNlczogMSB9LFxuICAgICAgICAgICAgeyBmaWxlOiBcInNyYy9hdXRoL2lucHV0LnRzXCIsIGxpbmU6IDUyLCBzbmlwcGV0OiBcInF1ZXJ5KG9mZnNldClcIiwgb2NjdXJyZW5jZXM6IDEgfSxcbiAgICAgICAgICBdLFxuICAgICAgICAgIHJlbGF0ZWRGaWxlczogW1wic3JjL2F1dGgvaW5wdXQudHNcIl0sXG4gICAgICAgICAgZml4RGVzY3JpcHRpb246IFwiVXNlIHRoZSBwYXJhbWV0ZXJpemVkIHF1ZXJ5IGhlbHBlciBmb3IgZXZlcnkgdXNlci1jb250cm9sbGVkIHZhbHVlLlwiLFxuICAgICAgICAgIHZlcmlmaWNhdGlvblN0ZXBzOiBbXG4gICAgICAgICAgICBcIlJ1biB0aGUgU1FMIGluamVjdGlvbiByZWdyZXNzaW9uIHRlc3QuXCIsXG4gICAgICAgICAgICBcIkNvbmZpcm0gYWxsIHVzZXItY29udHJvbGxlZCBxdWVyeSB2YWx1ZXMgdXNlIHBhcmFtZXRlcnMuXCIsXG4gICAgICAgICAgXSxcbiAgICAgICAgICBzb3VyY2U6IHtcbiAgICAgICAgICAgIHR5cGU6IFwic2NhblwiLFxuICAgICAgICAgICAgY29ycmVsYXRpb25JZDogXCJlMmUtc2Nhbi1jb3JyZWxhdGlvblwiLFxuICAgICAgICAgICAgcmV2aXNpb246IFwicmVtZWRpYXRpb24tcmV2aXNpb24tNDJcIixcbiAgICAgICAgICAgIGNvbXBsZXRlbmVzczogXCJDT01QTEVURVwiLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgc3RhdHVzOiBcInJlYWR5XCIsXG4gICAgICAgIH0sXG4gICAgICAgIGNyZWF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAwOjAwLjAwMFpcIixcbiAgICAgICAgdXBkYXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDE6MDAuMDAwWlwiLFxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgaWQ6IHJldmlld1Rhc2tJZCxcbiAgICAgICAgcHJvamVjdElkOiBcImUyZS1wcm9qZWN0XCIsXG4gICAgICAgIHRpdGxlOiBcIlJldmlldyBpbmNvbXBsZXRlIFNRTCByZW1lZGlhdGlvbiBldmlkZW5jZVwiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJBbiBpbmNvbXBsZXRlIHBsYW4gbXVzdCBzdGF5IGJsb2NrZWQgdW50aWwgYW4gb3BlcmF0b3IgcmV2aWV3cyBpdC5cIixcbiAgICAgICAgc3RhdHVzOiBcImZhaWxlZFwiLFxuICAgICAgICBwcmlvcml0eTogXCJwMVwiLFxuICAgICAgICBwaGFzZTogXCJSZW1lZGlhdGlvblwiLFxuICAgICAgICByZWxhdGVkRmlsZXM6IFtcInNyYy9hdXRoL2lucHV0LnRzXCJdLFxuICAgICAgICByZXRyeUNvdW50OiAwLFxuICAgICAgICBtYXhSZXRyaWVzOiAyLFxuICAgICAgICBwcm9tcHQ6IHJhd1Byb21wdCxcbiAgICAgICAgYWdlbnRSZXNwb25zZTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgIGtpbmQ6IFwiQUlfVEFTS19FWEVDVVRJT05fUkVDRUlQVFwiLFxuICAgICAgICAgIHRlcm1pbmFsU3RhdHVzOiBcIkZBSUxFRFwiLFxuICAgICAgICAgIHRlcm1pbmFsUmVhc29uOiByYXdEaWFnbm9zdGljLFxuICAgICAgICB9KSxcbiAgICAgICAgcmVtZWRpYXRpb25QbGFuOiB7XG4gICAgICAgICAgdmVyc2lvbjogMSxcbiAgICAgICAgICBydWxlSWQ6IFwiZTJlLXJ1bGUtbWlzc2luZy1ldmlkZW5jZVwiLFxuICAgICAgICAgIHJ1bGVDb2RlOiBcIlNFQy0wMDJcIixcbiAgICAgICAgICBydWxlVGl0bGU6IFwiSW5jb21wbGV0ZSBldmlkZW5jZSByZXZpZXdcIixcbiAgICAgICAgICBzZXZlcml0eTogXCJjcml0aWNhbFwiLFxuICAgICAgICAgIG9jY3VycmVuY2VDb3VudDogMSxcbiAgICAgICAgICBldmlkZW5jZTogW10sXG4gICAgICAgICAgcmVsYXRlZEZpbGVzOiBbXCJzcmMvYXV0aC9pbnB1dC50c1wiXSxcbiAgICAgICAgICBmaXhEZXNjcmlwdGlvbjogbnVsbCxcbiAgICAgICAgICB2ZXJpZmljYXRpb25TdGVwczogW10sXG4gICAgICAgICAgc291cmNlOiB7XG4gICAgICAgICAgICB0eXBlOiBcImRpc2NvdmVyeVwiLFxuICAgICAgICAgICAgY29ycmVsYXRpb25JZDogXCJlMmUtZGlzY292ZXJ5LWNvcnJlbGF0aW9uXCIsXG4gICAgICAgICAgICByZXZpc2lvbjogbnVsbCxcbiAgICAgICAgICAgIGNvbXBsZXRlbmVzczogXCJQQVJUSUFMXCIsXG4gICAgICAgICAgfSxcbiAgICAgICAgICBzdGF0dXM6IFwibmVlZHNfcmV2aWV3XCIsXG4gICAgICAgIH0sXG4gICAgICAgIGNyZWF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAwOjAwLjAwMFpcIixcbiAgICAgICAgdXBkYXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDE6MDAuMDAwWlwiLFxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgaWQ6IHZlcmlmaWNhdGlvblRhc2tJZCxcbiAgICAgICAgcHJvamVjdElkOiBcImUyZS1wcm9qZWN0XCIsXG4gICAgICAgIHRpdGxlOiBcIlZlcmlmeSBwYXJhbWV0ZXJpemVkIFNRTCByZW1lZGlhdGlvblwiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJBbiBvcGVyYXRvciBtdXN0IHJlY29yZCBldmlkZW5jZSBmb3IgZXZlcnkgdmVyaWZpY2F0aW9uIGNoZWNrLlwiLFxuICAgICAgICBzdGF0dXM6IFwidmVyaWZ5aW5nXCIsXG4gICAgICAgIHByaW9yaXR5OiBcInAxXCIsXG4gICAgICAgIHBoYXNlOiBcIlJlbWVkaWF0aW9uXCIsXG4gICAgICAgIHJlbGF0ZWRGaWxlczogW1wic3JjL2F1dGgvaW5wdXQudHNcIl0sXG4gICAgICAgIHJldHJ5Q291bnQ6IDAsXG4gICAgICAgIG1heFJldHJpZXM6IDIsXG4gICAgICAgIHByb21wdDogcmF3UHJvbXB0LFxuICAgICAgICByZW1lZGlhdGlvblBsYW46IHtcbiAgICAgICAgICB2ZXJzaW9uOiAxLFxuICAgICAgICAgIHJ1bGVJZDogXCJlMmUtcnVsZS12ZXJpZmljYXRpb25cIixcbiAgICAgICAgICBydWxlQ29kZTogXCJTRUMtMDAzXCIsXG4gICAgICAgICAgcnVsZVRpdGxlOiBcIlBhcmFtZXRlcml6ZWQgU1FMIHJlbWVkaWF0aW9uXCIsXG4gICAgICAgICAgc2V2ZXJpdHk6IFwiaGlnaFwiLFxuICAgICAgICAgIG9jY3VycmVuY2VDb3VudDogMixcbiAgICAgICAgICBldmlkZW5jZTogW1xuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBmaWxlOiBcInNyYy9hdXRoL2lucHV0LnRzXCIsXG4gICAgICAgICAgICAgIGxpbmU6IDEwLFxuICAgICAgICAgICAgICBzbmlwcGV0OiBcInF1ZXJ5KHVzZXJJbnB1dClcIixcbiAgICAgICAgICAgICAgb2NjdXJyZW5jZXM6IDEsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIF0sXG4gICAgICAgICAgcmVsYXRlZEZpbGVzOiBbXCJzcmMvYXV0aC9pbnB1dC50c1wiXSxcbiAgICAgICAgICBmaXhEZXNjcmlwdGlvbjogXCJVc2UgdGhlIHBhcmFtZXRlcml6ZWQgcXVlcnkgaGVscGVyIGZvciBldmVyeSB1c2VyLWNvbnRyb2xsZWQgdmFsdWUuXCIsXG4gICAgICAgICAgdmVyaWZpY2F0aW9uU3RlcHM6IFtcbiAgICAgICAgICAgIFwiUnVuIHRoZSBTUUwgaW5qZWN0aW9uIHJlZ3Jlc3Npb24gdGVzdC5cIixcbiAgICAgICAgICAgIFwiQ29uZmlybSBhbGwgdXNlci1jb250cm9sbGVkIHF1ZXJ5IHZhbHVlcyB1c2UgcGFyYW1ldGVycy5cIixcbiAgICAgICAgICBdLFxuICAgICAgICAgIHNvdXJjZToge1xuICAgICAgICAgICAgdHlwZTogXCJzY2FuXCIsXG4gICAgICAgICAgICBjb3JyZWxhdGlvbklkOiBcImUyZS12ZXJpZmljYXRpb24tY29ycmVsYXRpb25cIixcbiAgICAgICAgICAgIHJldmlzaW9uOiBcInJlbWVkaWF0aW9uLXJldmlzaW9uLTQzXCIsXG4gICAgICAgICAgICBjb21wbGV0ZW5lc3M6IFwiQ09NUExFVEVcIixcbiAgICAgICAgICB9LFxuICAgICAgICAgIHN0YXR1czogXCJyZWFkeVwiLFxuICAgICAgICB9LFxuICAgICAgICBjcmVhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMDowMC4wMDBaXCIsXG4gICAgICAgIHVwZGF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAzOjAwLjAwMFpcIixcbiAgICAgIH0sXG4gICAgXTtcbiAgICBjb25zdCBhY3Rpb25SZXF1ZXN0czogc3RyaW5nW10gPSBbXTtcbiAgICBjb25zdCB2ZXJpZmljYXRpb25SZXF1ZXN0czogQXJyYXk8UmVjb3JkPHN0cmluZywgdW5rbm93bj4+ID0gW107XG4gICAgYXdhaXQgaW5zdGFsbEFwaUZpeHR1cmVzKHBhZ2UsIHtcbiAgICAgIHRhc2tBY3Rpb25zOiB7XG4gICAgICAgIHRhc2tzOiByZW1lZGlhdGlvblRhc2tzLFxuICAgICAgICByZXF1ZXN0czogYWN0aW9uUmVxdWVzdHMsXG4gICAgICAgIHZlcmlmaWNhdGlvblJlcXVlc3RzLFxuICAgICAgfSxcbiAgICB9KTtcbiAgICBhd2FpdCBwcm9ncmFtbWF0aWNTaWduSW4ocGFnZSk7XG4gICAgYXdhaXQgb3Blbk5hdmlnYXRpb24ocGFnZSwgXCJUYXNrc1wiLCBgJHtEQVNIQk9BUkRfUEFUSH10YXNrc2ApO1xuXG4gICAgY29uc3QgcmVhZHlSb3cgPSBwYWdlLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7XG4gICAgICBuYW1lOiAvdGFzayBFeGVjdXRlIFNRTCBpbnB1dCBzYW5pdGl6YXRpb24gcmVtZWRpYXRpb24vLFxuICAgIH0pO1xuICAgIGF3YWl0IGV4cGVjdChyZWFkeVJvdykudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5nZXRCeVRpdGxlKFwiRXhlY3V0ZVwiKSkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCByZWFkeVJvdy5jbGljaygpO1xuXG4gICAgY29uc3QgcmVhZHlEZXRhaWxzID0gcGFnZS5sb2NhdG9yKGAjdGFzay1kZXRhaWxzLSR7cmVhZHlUYXNrSWR9YCk7XG4gICAgY29uc3QgcmVhZHlQbGFuID0gcmVhZHlEZXRhaWxzLmdldEJ5Um9sZShcInJlZ2lvblwiLCB7XG4gICAgICBuYW1lOiBcIlJlbWVkaWF0aW9uIHBsYW5cIixcbiAgICB9KTtcbiAgICBhd2FpdCBleHBlY3QocmVhZHlQbGFuKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChyZWFkeVBsYW4pLnRvQ29udGFpblRleHQoXCJTRUMtMDAxXCIpO1xuICAgIGF3YWl0IGV4cGVjdChyZWFkeVBsYW4pLnRvQ29udGFpblRleHQoXCJVbnNhbml0aXplZCBTUUwgaW5wdXRcIik7XG4gICAgYXdhaXQgZXhwZWN0KHJlYWR5UGxhbikudG9Db250YWluVGV4dChcImhpZ2hcIik7XG4gICAgYXdhaXQgZXhwZWN0KHJlYWR5UGxhbikudG9Db250YWluVGV4dChcIjIgb2NjdXJyZW5jZShzKVwiKTtcbiAgICBhd2FpdCBleHBlY3QocmVhZHlQbGFuKS50b0NvbnRhaW5UZXh0KFwic3JjL2F1dGgvaW5wdXQudHM6MTBcIik7XG4gICAgYXdhaXQgZXhwZWN0KHJlYWR5UGxhbikudG9Db250YWluVGV4dChcInNyYy9hdXRoL2lucHV0LnRzOjQ0XCIpO1xuICAgIGF3YWl0IGV4cGVjdChyZWFkeVBsYW4pLnRvQ29udGFpblRleHQoXCIrMSBtb3JlIGV2aWRlbmNlIGl0ZW1zXCIpO1xuICAgIGF3YWl0IGV4cGVjdChyZWFkeVBsYW4pLm5vdC50b0NvbnRhaW5UZXh0KFwic3JjL2F1dGgvaW5wdXQudHM6NTJcIik7XG4gICAgYXdhaXQgZXhwZWN0KHJlYWR5UGxhbikudG9Db250YWluVGV4dChcbiAgICAgIFwiVXNlIHRoZSBwYXJhbWV0ZXJpemVkIHF1ZXJ5IGhlbHBlciBmb3IgZXZlcnkgdXNlci1jb250cm9sbGVkIHZhbHVlLlwiLFxuICAgICk7XG4gICAgYXdhaXQgZXhwZWN0KHJlYWR5UGxhbikudG9Db250YWluVGV4dChcIlJ1biB0aGUgU1FMIGluamVjdGlvbiByZWdyZXNzaW9uIHRlc3QuXCIpO1xuICAgIGF3YWl0IGV4cGVjdChyZWFkeVBsYW4pLnRvQ29udGFpblRleHQoXCJDb25maXJtIGFsbCB1c2VyLWNvbnRyb2xsZWQgcXVlcnkgdmFsdWVzIHVzZSBwYXJhbWV0ZXJzLlwiKTtcbiAgICBhd2FpdCBleHBlY3QocmVhZHlQbGFuKS50b0NvbnRhaW5UZXh0KFwiUmVhZHkgdG8gZXhlY3V0ZVwiKTtcbiAgICBhd2FpdCBleHBlY3QocmVhZHlQbGFuKS50b0NvbnRhaW5UZXh0KFwiU291cmNlOiBzY2FuXCIpO1xuICAgIGF3YWl0IGV4cGVjdChyZWFkeVBsYW4pLnRvQ29udGFpblRleHQoXCJyZXZpc2lvbiByZW1lZGlhdGlvbi1cIik7XG4gICAgYXdhaXQgZXhwZWN0KHJlYWR5RGV0YWlscy5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIkRldGFpbHNcIiB9KSkudG9CZVZpc2libGUoKTtcblxuICAgIGF3YWl0IHBhZ2UuZ2V0QnlUaXRsZShcIkV4ZWN1dGVcIikuY2xpY2soKTtcbiAgICBhd2FpdCBleHBlY3QucG9sbCgoKSA9PiBhY3Rpb25SZXF1ZXN0cy5sZW5ndGgpLnRvQmUoMSk7XG4gICAgZXhwZWN0KGFjdGlvblJlcXVlc3RzWzBdKS50b0JlKGBleGVjdXRlOiR7cmVhZHlUYXNrSWR9YCk7XG4gICAgYXdhaXQgZXhwZWN0KHJlYWR5Um93KS50b0NvbnRhaW5UZXh0KFwicnVubmluZ1wiKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5nZXRCeVRpdGxlKFwiRXhlY3V0ZVwiKSkudG9IYXZlQ291bnQoMCk7XG5cbiAgICBjb25zdCByZXZpZXdSb3cgPSBwYWdlLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7XG4gICAgICBuYW1lOiAvdGFzayBSZXZpZXcgaW5jb21wbGV0ZSBTUUwgcmVtZWRpYXRpb24gZXZpZGVuY2UvLFxuICAgIH0pO1xuICAgIGF3YWl0IHJldmlld1Jvdy5jbGljaygpO1xuICAgIGNvbnN0IHJldmlld0RldGFpbHMgPSBwYWdlLmxvY2F0b3IoYCN0YXNrLWRldGFpbHMtJHtyZXZpZXdUYXNrSWR9YCk7XG4gICAgY29uc3QgcmV2aWV3UGxhbiA9IHJldmlld0RldGFpbHMuZ2V0QnlSb2xlKFwicmVnaW9uXCIsIHtcbiAgICAgIG5hbWU6IFwiUmVtZWRpYXRpb24gcGxhblwiLFxuICAgIH0pO1xuICAgIGF3YWl0IGV4cGVjdChyZXZpZXdQbGFuKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChyZXZpZXdQbGFuKS50b0NvbnRhaW5UZXh0KFwiU0VDLTAwMlwiKTtcbiAgICBhd2FpdCBleHBlY3QocmV2aWV3UGxhbikudG9Db250YWluVGV4dChcIkluY29tcGxldGUgZXZpZGVuY2UgcmV2aWV3XCIpO1xuICAgIGF3YWl0IGV4cGVjdChyZXZpZXdQbGFuKS50b0NvbnRhaW5UZXh0KFwiY3JpdGljYWxcIik7XG4gICAgYXdhaXQgZXhwZWN0KHJldmlld1BsYW4pLnRvQ29udGFpblRleHQoXCIxIG9jY3VycmVuY2UocylcIik7XG4gICAgYXdhaXQgZXhwZWN0KHJldmlld1BsYW4pLnRvQ29udGFpblRleHQoXCJOZWVkcyByZXZpZXdcIik7XG4gICAgYXdhaXQgZXhwZWN0KHJldmlld1BsYW4pLnRvQ29udGFpblRleHQoXCJObyBib3VuZGVkIGV2aWRlbmNlIHdhcyByZXRhaW5lZC5cIik7XG4gICAgYXdhaXQgZXhwZWN0KHJldmlld1BsYW4pLnRvQ29udGFpblRleHQoXCJObyB2ZXJpZmljYXRpb24gc3RlcHMgc3VwcGxpZWQuXCIpO1xuICAgIGF3YWl0IGV4cGVjdChyZXZpZXdQbGFuKS50b0NvbnRhaW5UZXh0KFwiU291cmNlOiBkaXNjb3ZlcnlcIik7XG4gICAgYXdhaXQgZXhwZWN0KHJldmlld1BsYW4pLnRvQ29udGFpblRleHQoXCJyZXZpc2lvbiB1bmF2YWlsYWJsZVwiKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5nZXRCeVRpdGxlKFwiUmV0cnlcIikpLnRvQmVWaXNpYmxlKCk7XG5cbiAgICBhd2FpdCBwYWdlLmdldEJ5VGl0bGUoXCJSZXRyeVwiKS5jbGljaygpO1xuICAgIGF3YWl0IGV4cGVjdC5wb2xsKCgpID0+IGFjdGlvblJlcXVlc3RzLmxlbmd0aCkudG9CZSgyKTtcbiAgICBleHBlY3QoYWN0aW9uUmVxdWVzdHNbMV0pLnRvQmUoYHJldHJ5OiR7cmV2aWV3VGFza0lkfWApO1xuICAgIGF3YWl0IGV4cGVjdChyZXZpZXdSb3cpLnRvQ29udGFpblRleHQoXCJxdWV1ZWRcIik7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlUaXRsZShcIlJldHJ5XCIpKS50b0hhdmVDb3VudCgwKTtcblxuICAgIGNvbnN0IHZlcmlmaWNhdGlvblJvdyA9IHBhZ2UuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHtcbiAgICAgIG5hbWU6IC90YXNrIFZlcmlmeSBwYXJhbWV0ZXJpemVkIFNRTCByZW1lZGlhdGlvbi8sXG4gICAgfSk7XG4gICAgYXdhaXQgdmVyaWZpY2F0aW9uUm93LmNsaWNrKCk7XG4gICAgY29uc3QgdmVyaWZpY2F0aW9uRGV0YWlscyA9IHBhZ2UubG9jYXRvcihcbiAgICAgIGAjdGFzay1kZXRhaWxzLSR7dmVyaWZpY2F0aW9uVGFza0lkfWAsXG4gICAgKTtcbiAgICBjb25zdCB2ZXJpZmljYXRpb25QbGFuID0gdmVyaWZpY2F0aW9uRGV0YWlscy5nZXRCeVJvbGUoXCJyZWdpb25cIiwge1xuICAgICAgbmFtZTogXCJSZW1lZGlhdGlvbiBwbGFuXCIsXG4gICAgfSk7XG4gICAgY29uc3QgdmVyaWZpY2F0aW9uQ2hlY2tzID0gdmVyaWZpY2F0aW9uRGV0YWlscy5nZXRCeVJvbGUoXCJyZWdpb25cIiwge1xuICAgICAgbmFtZTogXCJPcGVyYXRvciB2ZXJpZmljYXRpb24gY2hlY2tzXCIsXG4gICAgfSk7XG4gICAgYXdhaXQgZXhwZWN0KHZlcmlmaWNhdGlvblBsYW4pLnRvQ29udGFpblRleHQoXCJTRUMtMDAzXCIpO1xuICAgIGF3YWl0IGV4cGVjdCh2ZXJpZmljYXRpb25QbGFuKS50b0NvbnRhaW5UZXh0KFwiUmVhZHkgdG8gZXhlY3V0ZVwiKTtcbiAgICBhd2FpdCB2ZXJpZmljYXRpb25EZXRhaWxzXG4gICAgICAuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJSdW4gYW5kIHJlY29yZCB2ZXJpZmljYXRpb24gY2hlY2tzXCIgfSlcbiAgICAgIC5jbGljaygpO1xuICAgIGF3YWl0IGV4cGVjdCh2ZXJpZmljYXRpb25DaGVja3MpLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KHZlcmlmaWNhdGlvbkNoZWNrcykudG9Db250YWluVGV4dChcIkluY29tcGxldGVcIik7XG5cbiAgICBjb25zdCBmaXJzdEd1aWRhbmNlID0gXCJSdW4gdGhlIFNRTCBpbmplY3Rpb24gcmVncmVzc2lvbiB0ZXN0LlwiO1xuICAgIGNvbnN0IHNlY29uZEd1aWRhbmNlID1cbiAgICAgIFwiQ29uZmlybSBhbGwgdXNlci1jb250cm9sbGVkIHF1ZXJ5IHZhbHVlcyB1c2UgcGFyYW1ldGVycy5cIjtcbiAgICBjb25zdCBmaXJzdEV2aWRlbmNlID0gdmVyaWZpY2F0aW9uQ2hlY2tzLmdldEJ5TGFiZWwoXG4gICAgICBgRXZpZGVuY2UgZm9yICR7Zmlyc3RHdWlkYW5jZX1gLFxuICAgICk7XG4gICAgY29uc3Qgc2Vjb25kRXZpZGVuY2UgPSB2ZXJpZmljYXRpb25DaGVja3MuZ2V0QnlMYWJlbChcbiAgICAgIGBFdmlkZW5jZSBmb3IgJHtzZWNvbmRHdWlkYW5jZX1gLFxuICAgICk7XG4gICAgY29uc3QgcGFzc0J1dHRvbnMgPSB2ZXJpZmljYXRpb25DaGVja3MuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHtcbiAgICAgIG5hbWU6IFwiUmVjb3JkIHBhc3NlZFwiLFxuICAgIH0pO1xuICAgIGNvbnN0IGZhaWxlZEJ1dHRvbnMgPSB2ZXJpZmljYXRpb25DaGVja3MuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHtcbiAgICAgIG5hbWU6IFwiUmVjb3JkIGZhaWxlZFwiLFxuICAgIH0pO1xuICAgIGF3YWl0IGV4cGVjdChwYXNzQnV0dG9ucy5udGgoMCkpLnRvQmVEaXNhYmxlZCgpO1xuICAgIGF3YWl0IGZpcnN0RXZpZGVuY2UuZmlsbChcIlRoZSByZWdyZXNzaW9uIHRlc3Qgc3RpbGwgZmFpbHMgYmVmb3JlIHRoZSBmaXguXCIpO1xuICAgIGF3YWl0IGZhaWxlZEJ1dHRvbnMubnRoKDApLmNsaWNrKCk7XG4gICAgYXdhaXQgZXhwZWN0LnBvbGwoKCkgPT4gdmVyaWZpY2F0aW9uUmVxdWVzdHMubGVuZ3RoKS50b0JlKDEpO1xuICAgIGV4cGVjdCh2ZXJpZmljYXRpb25SZXF1ZXN0c1swXSkudG9NYXRjaE9iamVjdCh7XG4gICAgICB0YXNrSWQ6IHZlcmlmaWNhdGlvblRhc2tJZCxcbiAgICAgIGNoZWNrSWQ6IFwicnVsZS12ZXJpZmljYXRpb24tMVwiLFxuICAgICAgcGFzc2VkOiBmYWxzZSxcbiAgICB9KTtcbiAgICBhd2FpdCBleHBlY3QodmVyaWZpY2F0aW9uQ2hlY2tzKS50b0NvbnRhaW5UZXh0KFwiSW5jb21wbGV0ZVwiKTtcbiAgICBhd2FpdCBleHBlY3QodmVyaWZpY2F0aW9uUm93KS50b0NvbnRhaW5UZXh0KFwidmVyaWZ5aW5nXCIpO1xuXG4gICAgYXdhaXQgZmlyc3RFdmlkZW5jZS5maWxsKFwiVGhlIGZvY3VzZWQgcmVncmVzc2lvbiB0ZXN0IHBhc3NlcyBhZnRlciB0aGUgZml4LlwiKTtcbiAgICBhd2FpdCBwYXNzQnV0dG9ucy5udGgoMCkuY2xpY2soKTtcbiAgICBhd2FpdCBleHBlY3QucG9sbCgoKSA9PiB2ZXJpZmljYXRpb25SZXF1ZXN0cy5sZW5ndGgpLnRvQmUoMik7XG4gICAgZXhwZWN0KHZlcmlmaWNhdGlvblJlcXVlc3RzWzFdKS50b01hdGNoT2JqZWN0KHtcbiAgICAgIHRhc2tJZDogdmVyaWZpY2F0aW9uVGFza0lkLFxuICAgICAgY2hlY2tJZDogXCJydWxlLXZlcmlmaWNhdGlvbi0xXCIsXG4gICAgICBwYXNzZWQ6IHRydWUsXG4gICAgICBldmlkZW5jZTogXCJUaGUgZm9jdXNlZCByZWdyZXNzaW9uIHRlc3QgcGFzc2VzIGFmdGVyIHRoZSBmaXguXCIsXG4gICAgfSk7XG4gICAgYXdhaXQgZXhwZWN0KHZlcmlmaWNhdGlvbkNoZWNrcykudG9Db250YWluVGV4dChcIkluY29tcGxldGVcIik7XG5cbiAgICBhd2FpdCBzZWNvbmRFdmlkZW5jZS5maWxsKFxuICAgICAgXCJBbGwgdXNlci1jb250cm9sbGVkIHF1ZXJ5IHZhbHVlcyB1c2UgdGhlIHBhcmFtZXRlcml6ZWQgaGVscGVyLlwiLFxuICAgICk7XG4gICAgYXdhaXQgcGFzc0J1dHRvbnMubnRoKDEpLmNsaWNrKCk7XG4gICAgYXdhaXQgZXhwZWN0LnBvbGwoKCkgPT4gdmVyaWZpY2F0aW9uUmVxdWVzdHMubGVuZ3RoKS50b0JlKDMpO1xuICAgIGV4cGVjdCh2ZXJpZmljYXRpb25SZXF1ZXN0c1syXSkudG9NYXRjaE9iamVjdCh7XG4gICAgICB0YXNrSWQ6IHZlcmlmaWNhdGlvblRhc2tJZCxcbiAgICAgIGNoZWNrSWQ6IFwicnVsZS12ZXJpZmljYXRpb24tMlwiLFxuICAgICAgcGFzc2VkOiB0cnVlLFxuICAgICAgZXZpZGVuY2U6IFwiQWxsIHVzZXItY29udHJvbGxlZCBxdWVyeSB2YWx1ZXMgdXNlIHRoZSBwYXJhbWV0ZXJpemVkIGhlbHBlci5cIixcbiAgICB9KTtcbiAgICBhd2FpdCBleHBlY3QodmVyaWZpY2F0aW9uUm93KS50b0NvbnRhaW5UZXh0KFwiY29tcGxldGVkXCIpO1xuICAgIGF3YWl0IHZlcmlmaWNhdGlvbkRldGFpbHMuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJEZXRhaWxzXCIgfSkuY2xpY2soKTtcbiAgICBhd2FpdCBleHBlY3QodmVyaWZpY2F0aW9uUGxhbikudG9Db250YWluVGV4dChcIlZlcmlmaWVkXCIpO1xuICAgIGF3YWl0IHZlcmlmaWNhdGlvbkRldGFpbHMuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJMb2dzXCIgfSkuY2xpY2soKTtcbiAgICBhd2FpdCBleHBlY3QodmVyaWZpY2F0aW9uQ2hlY2tzKS50b0NvbnRhaW5UZXh0KFwiVmVyaWZpZWRcIik7XG4gICAgYXdhaXQgZXhwZWN0KHZlcmlmaWNhdGlvbkRldGFpbHMpLnRvQ29udGFpblRleHQoXG4gICAgICBcIlRhc2sgY29tcGxldGVkIGFuZCB2ZXJpZmllZCBieSB0aGUgc2VydmVyLlwiLFxuICAgICk7XG5cbiAgICBhd2FpdCBwYWdlLnJlbG9hZCgpO1xuICAgIGNvbnN0IHJlbG9hZGVkVmVyaWZpY2F0aW9uUm93ID0gcGFnZS5nZXRCeVJvbGUoXCJidXR0b25cIiwge1xuICAgICAgbmFtZTogL3Rhc2sgVmVyaWZ5IHBhcmFtZXRlcml6ZWQgU1FMIHJlbWVkaWF0aW9uLyxcbiAgICB9KTtcbiAgICBhd2FpdCBleHBlY3QocmVsb2FkZWRWZXJpZmljYXRpb25Sb3cpLnRvQ29udGFpblRleHQoXCJjb21wbGV0ZWRcIik7XG4gICAgYXdhaXQgcmVsb2FkZWRWZXJpZmljYXRpb25Sb3cuY2xpY2soKTtcbiAgICBjb25zdCByZWxvYWRlZERldGFpbHMgPSBwYWdlLmxvY2F0b3IoXG4gICAgICBgI3Rhc2stZGV0YWlscy0ke3ZlcmlmaWNhdGlvblRhc2tJZH1gLFxuICAgICk7XG4gICAgYXdhaXQgcmVsb2FkZWREZXRhaWxzLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiTG9nc1wiIH0pLmNsaWNrKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcmVsb2FkZWREZXRhaWxzLmdldEJ5Um9sZShcInJlZ2lvblwiLCB7XG4gICAgICAgIG5hbWU6IFwiT3BlcmF0b3IgdmVyaWZpY2F0aW9uIGNoZWNrc1wiLFxuICAgICAgfSksXG4gICAgKS50b0NvbnRhaW5UZXh0KFwiVmVyaWZpZWRcIik7XG4gICAgYXdhaXQgZXhwZWN0KHJlbG9hZGVkRGV0YWlscykudG9Db250YWluVGV4dChcbiAgICAgIFwiVGFzayBjb21wbGV0ZWQgYW5kIHZlcmlmaWVkIGJ5IHRoZSBzZXJ2ZXIuXCIsXG4gICAgKTtcblxuICAgIGNvbnN0IHZpc2libGVUZXh0ID0gYXdhaXQgcGFnZS5sb2NhdG9yKFwiYm9keVwiKS5pbm5lclRleHQoKTtcbiAgICBleHBlY3QodmlzaWJsZVRleHQpLm5vdC50b0NvbnRhaW4ocmF3UHJvbXB0KTtcbiAgICBleHBlY3QodmlzaWJsZVRleHQpLm5vdC50b0NvbnRhaW4ocmF3RGlhZ25vc3RpYyk7XG4gICAgYXdhaXQgZXhwZWN0Tm9Ib3Jpem9udGFsT3ZlcmZsb3cocGFnZSk7XG4gIH0pO1xuXG4gIHRlc3QoXCJjb252ZXJnZXMgdHdvIGJyb3dzZXIgc2Vzc2lvbnMgYWNyb3NzIHJlbG9hZCwgcmVjb25uZWN0LCBzdGFsZSByZXN1bHRzLCBhbmQgQVBJIHJlc3RhcnRcIiwgYXN5bmMgKHtcbiAgICBicm93c2VyLFxuICAgIHBhZ2UsXG4gIH0pID0+IHtcbiAgICB0ZXN0LnNraXAoXG4gICAgICAhcHJvY2Vzcy5lbnYuREFTSEJPQVJEX0UyRV9DT05UUk9MX1VSTCxcbiAgICAgIFwiVGhlIG11bHRpLXByb2Nlc3MgY29udmVyZ2VuY2UgY2FtcGFpZ24gcnVucyBvbmx5IHVuZGVyIHRoZSByZWxlYXNlIHJ1bm5lci5cIixcbiAgICApO1xuICAgIHRlc3Quc2V0VGltZW91dCg5MF8wMDApO1xuXG4gICAgY29uc3Qgc2Vjb25kQ29udGV4dCA9IGF3YWl0IGJyb3dzZXIubmV3Q29udGV4dCgpO1xuICAgIGNvbnN0IHNlY29uZFBhZ2UgPSBhd2FpdCBzZWNvbmRDb250ZXh0Lm5ld1BhZ2UoKTtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgUHJvbWlzZS5hbGwoW3Byb2dyYW1tYXRpY1NpZ25JbihwYWdlKSwgcHJvZ3JhbW1hdGljU2lnbkluKHNlY29uZFBhZ2UpXSk7XG4gICAgICBhd2FpdCBQcm9taXNlLmFsbChbXG4gICAgICAgIHBhZ2UuZ290byhEQVNIQk9BUkRfUEFUSCksXG4gICAgICAgIHNlY29uZFBhZ2UuZ290byhgJHtEQVNIQk9BUkRfUEFUSH1haWApLFxuICAgICAgXSk7XG4gICAgICBhd2FpdCBleHBlY3REYXNoYm9hcmRSZWFkeShwYWdlKTtcbiAgICAgIGF3YWl0IGV4cGVjdChzZWNvbmRQYWdlLmxvY2F0b3IoXCJ0ZXh0YXJlYVwiKS5maXJzdCgpKS50b0JlVmlzaWJsZSgpO1xuXG4gICAgICAvLyBBIHJlc3BvbnNlIHRoYXQgYXJyaXZlcyBhZnRlciBhIG5ld2VyIHJlcXVlc3QgbXVzdCBub3QgcmVwbGFjZSB0aGVcbiAgICAgIC8vIHZpc2libGUgcmVhZHkgc3RhdGUgd2l0aCBzdGFsZSBkYXRhLiBLZWVwIHRoZSBkZWxheSBib3VuZGVkIHNvIGFcbiAgICAgIC8vIGh1bmcgcmVxdWVzdCBjYW5ub3QgbWFrZSB0aGlzIGNhbXBhaWduIHBhc3MgaW5kZWZpbml0ZWx5LlxuICAgICAgY29uc3QgY3VycmVudERhc2hib2FyZEZpeHR1cmUgPSB7XG4gICAgICAgIC4uLmRhc2hib2FyZEZpeHR1cmUsXG4gICAgICAgIGZyZXNobmVzc1JldmlzaW9uOiBcIjIwMjYtMDEtMDFUMDA6MDM6MDAuMDAwWlwiLFxuICAgICAgICBwcm9qZWN0U2NvcmVzOiBbeyAuLi5kYXNoYm9hcmRGaXh0dXJlLnByb2plY3RTY29yZXNbMF0sIHByb2plY3ROYW1lOiBcIkNvbmN1cnJlbnQgUHJvamVjdFwiLCBzY29yZTogOTcgfV0sXG4gICAgICAgIGFjdGl2ZVRhc2tDb3VudDogMSxcbiAgICAgICAgdGFza1N0YXR1c0JyZWFrZG93bjogeyBwZW5kaW5nOiAwLCBydW5uaW5nOiAxIH0sXG4gICAgICB9O1xuICAgICAgbGV0IHJlZnJlc2hDb3VudCA9IDA7XG4gICAgICBsZXQgcmVsZWFzZVN0YWxlUmVzcG9uc2UhOiAoKSA9PiB2b2lkO1xuICAgICAgY29uc3Qgc3RhbGVSZXNwb25zZVJlbGVhc2VkID0gbmV3IFByb21pc2U8dm9pZD4oKHJlc29sdmUpID0+IHtcbiAgICAgICAgcmVsZWFzZVN0YWxlUmVzcG9uc2UgPSByZXNvbHZlO1xuICAgICAgfSk7XG4gICAgICBhd2FpdCBwYWdlLnJvdXRlKFwiKiovYXBpL2Rhc2hib2FyZFwiLCBhc3luYyAocm91dGUpID0+IHtcbiAgICAgICAgcmVmcmVzaENvdW50ICs9IDE7XG4gICAgICAgIGlmIChyZWZyZXNoQ291bnQgPT09IDEpIHJldHVybiByb3V0ZS5mdWxmaWxsKGpzb25SZXNwb25zZShjdXJyZW50RGFzaGJvYXJkRml4dHVyZSkpO1xuICAgICAgICBhd2FpdCBzdGFsZVJlc3BvbnNlUmVsZWFzZWQ7XG4gICAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKGpzb25SZXNwb25zZShkYXNoYm9hcmRGaXh0dXJlKSk7XG4gICAgICB9KTtcbiAgICAgIGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJSZWZyZXNoIHN0YXR1c1wiIH0pLmNsaWNrKCk7XG4gICAgICBhd2FpdCBleHBlY3QocGFnZS5nZXRCeVRleHQoXCJDb25jdXJyZW50IFByb2plY3RcIiwgeyBleGFjdDogdHJ1ZSB9KSkudG9CZVZpc2libGUoKTtcbiAgICAgIGF3YWl0IGV4cGVjdChwYWdlLmdldEJ5VGV4dChcIjk3XCIsIHsgZXhhY3Q6IHRydWUgfSkpLnRvQmVWaXNpYmxlKCk7XG4gICAgICBjb25zdCBzdGFsZVJlZnJlc2ggPSBwYWdlLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiUmVmcmVzaCBzdGF0dXNcIiB9KS5jbGljaygpO1xuICAgICAgYXdhaXQgZXhwZWN0LnBvbGwoKCkgPT4gcmVmcmVzaENvdW50KS50b0JlKDIpO1xuICAgICAgcmVsZWFzZVN0YWxlUmVzcG9uc2UoKTtcbiAgICAgIGF3YWl0IHN0YWxlUmVmcmVzaDtcbiAgICAgIGF3YWl0IGV4cGVjdERhc2hib2FyZFJlYWR5KHBhZ2UpO1xuICAgICAgYXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlUZXh0KFwiQ29uY3VycmVudCBQcm9qZWN0XCIsIHsgZXhhY3Q6IHRydWUgfSkpLnRvQmVWaXNpYmxlKCk7XG4gICAgICBhd2FpdCBleHBlY3QocGFnZS5nZXRCeVRleHQoXCI5N1wiLCB7IGV4YWN0OiB0cnVlIH0pKS50b0JlVmlzaWJsZSgpO1xuICAgICAgYXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlUZXh0KFwiMVwiLCB7IGV4YWN0OiB0cnVlIH0pLmZpcnN0KCkpLnRvQmVWaXNpYmxlKCk7XG5cbiAgICAgIC8vIFNpbXVsYXRlIGEgZHJvcHBlZCBjb25uZWN0aW9uIGluIHRoZSBzZWNvbmQgYnJvd3NlciBhbmQgYXNzZXJ0IHRoZVxuICAgICAgLy8gcmVjb3ZlcnkgYWN0aW9uIHJlbmRlcmVkIGJ5IHRoZSBkYXNoYm9hcmQsIHRoZW4gbGV0IHRoZSBuZXh0IHJlcXVlc3RcbiAgICAgIC8vIHJlY29ubmVjdCBub3JtYWxseS5cbiAgICAgIGxldCByZWNvbm5lY3RBdHRlbXB0ID0gMDtcbiAgICAgIGF3YWl0IHNlY29uZFBhZ2UuZ290byhEQVNIQk9BUkRfUEFUSCk7XG4gICAgICBhd2FpdCBleHBlY3REYXNoYm9hcmRSZWFkeShzZWNvbmRQYWdlKTtcbiAgICAgIGF3YWl0IHNlY29uZFBhZ2Uucm91dGUoXCIqKi9hcGkvZGFzaGJvYXJkXCIsIGFzeW5jIChyb3V0ZSkgPT4ge1xuICAgICAgICByZWNvbm5lY3RBdHRlbXB0ICs9IDE7XG4gICAgICAgIC8vIHVzZUdldERhc2hib2FyZCByZXRyaWVzIG9uY2U7IGhvbGQgYm90aCBib3VuZGVkIGF0dGVtcHRzIHNvIHRoZVxuICAgICAgICAvLyByZW5kZXJlZCBlcnJvciBzdGF0ZSBpcyBvYnNlcnZhYmxlIGJlZm9yZSB0aGUgb3BlcmF0b3IgcmV0cmllcy5cbiAgICAgICAgaWYgKHJlY29ubmVjdEF0dGVtcHQgPD0gMikge1xuICAgICAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKFxuICAgICAgICAgICAganNvblJlc3BvbnNlKHsgZXJyb3I6IFwiY29udHJvbGxlZCByZWNvbm5lY3QgaW50ZXJydXB0aW9uXCIgfSwgNTAzKSxcbiAgICAgICAgICApO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiByb3V0ZS5jb250aW51ZSgpO1xuICAgICAgfSk7XG4gICAgICBhd2FpdCBzZWNvbmRQYWdlLnJlbG9hZCgpO1xuICAgICAgYXdhaXQgZXhwZWN0KFxuICAgICAgICBzZWNvbmRQYWdlLmdldEJ5Um9sZShcImhlYWRpbmdcIiwgeyBuYW1lOiBcIkZhaWxlZCB0byBsb2FkIGRhc2hib2FyZFwiIH0pLFxuICAgICAgKS50b0JlVmlzaWJsZSgpO1xuICAgICAgYXdhaXQgZXhwZWN0KFxuICAgICAgICBzZWNvbmRQYWdlLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiUmV0cnkgQ29ubmVjdGlvblwiIH0pLFxuICAgICAgKS50b0JlVmlzaWJsZSgpO1xuICAgICAgYXdhaXQgc2Vjb25kUGFnZS51bnJvdXRlKFwiKiovYXBpL2Rhc2hib2FyZFwiKTtcbiAgICAgIGF3YWl0IHNlY29uZFBhZ2UuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJSZXRyeSBDb25uZWN0aW9uXCIgfSkuY2xpY2soKTtcbiAgICAgIGF3YWl0IGV4cGVjdERhc2hib2FyZFJlYWR5KHNlY29uZFBhZ2UpO1xuXG4gICAgICBhd2FpdCByZXN0YXJ0QXBpRm9yQ2FtcGFpZ24ocGFnZSk7XG4gICAgICBhd2FpdCBQcm9taXNlLmFsbChbcGFnZS5yZWxvYWQoKSwgc2Vjb25kUGFnZS5yZWxvYWQoKV0pO1xuICAgICAgYXdhaXQgZXhwZWN0RGFzaGJvYXJkUmVhZHkocGFnZSk7XG4gICAgICBhd2FpdCBleHBlY3REYXNoYm9hcmRSZWFkeShzZWNvbmRQYWdlKTtcblxuICAgICAgYXdhaXQgcGFnZS5yZWxvYWQoKTtcbiAgICAgIGF3YWl0IGV4cGVjdERhc2hib2FyZFJlYWR5KHBhZ2UpO1xuICAgICAgYXdhaXQgZXhwZWN0KFxuICAgICAgICBwYWdlLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiUmV0cnkgQ29ubmVjdGlvblwiIH0pLFxuICAgICAgKS50b0hhdmVDb3VudCgwKTtcbiAgICAgIGF3YWl0IGV4cGVjdE5vSG9yaXpvbnRhbE92ZXJmbG93KHBhZ2UpO1xuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCBzZWNvbmRDb250ZXh0LmNsb3NlKCk7XG4gICAgfVxuICB9KTtcblxuICB0ZXN0KFwicHJldmlld3MgYW5kIGRvd25sb2FkcyB0aGUgY29tcGxldGVkIGV4ZWN1dGlvbiBhdWRpdCB3aXRob3V0IGR1cGxpY2F0aW5nIGVmZmVjdHNcIiwgYXN5bmMgKHtcbiAgICBwYWdlLFxuICB9KSA9PiB7XG4gICAgY29uc3QgYXVkaXRSZXF1ZXN0czogc3RyaW5nW10gPSBbXTtcbiAgICBjb25zdCBhdWRpdEJvZHkgPSB7XG4gICAgICBmb3JtYXQ6IFwiZW5naW5lZXJpbmdvcy5leGVjdXRpb24tYXVkaXQudjFcIixcbiAgICAgIGV4cG9ydGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMjowMC4wMDBaXCIsXG4gICAgICBleGVjdXRpb246IHtcbiAgICAgICAgaWQ6IEVYRUNVVElPTl9JRCxcbiAgICAgICAgcHJvamVjdElkOiBcImUyZS1wcm9qZWN0XCIsXG4gICAgICAgIHNlc3Npb25JZDogXCJlMmUtYXVkaXQtc2Vzc2lvblwiLFxuICAgICAgICBvcGVyYXRpb25JZDogZXhlY3V0aW9uRml4dHVyZS5vcGVyYXRpb25JZCxcbiAgICAgICAgc3RhdHVzOiBcImNvbXBsZXRlZFwiLFxuICAgICAgICB0ZXJtaW5hbFN0YXRlOiBcImNvbXBsZXRlZFwiLFxuICAgICAgICByZXZpc2lvbjogXCJlMmUtcmV2aXNpb24tNDJcIixcbiAgICAgICAgcHJvb2Y6IHsgcmVxdWlyZWQ6IGZhbHNlLCB2ZXJkaWN0OiBcIlBST1ZFTlwiIH0sXG4gICAgICB9LFxuICAgICAgdGltZWxpbmU6IFtdLFxuICAgICAgdmFsaWRhdGlvbnM6IFt7IHN0YXR1czogXCJwYXNzZWRcIiwgcHJvZmlsZTogXCJyZWxlYXNlLXNhZmVcIiB9XSxcbiAgICAgIGFmZmVjdGVkRmlsZXM6IFtcInNyYy9mZWF0dXJlLnRzXCJdLFxuICAgICAgcmVkYWN0aW9uOiB7XG4gICAgICAgIGV4Y2x1ZGVkOiBbXG4gICAgICAgICAgXCJwcm92aWRlciBzZWNyZXRzXCIsXG4gICAgICAgICAgXCJyYXcgbW9kZWwgb3V0cHV0XCIsXG4gICAgICAgICAgXCJwcml2YXRlIHJ1bnRpbWUgcGF0aHNcIixcbiAgICAgICAgXSxcbiAgICAgIH0sXG4gICAgfTtcbiAgICBhd2FpdCBpbnN0YWxsQXBpRml4dHVyZXMocGFnZSwge1xuICAgICAgYXVkaXRFeHBvcnQ6IHtcbiAgICAgICAgYm9keTogYXVkaXRCb2R5LFxuICAgICAgICBmaWxlbmFtZTogXCJzZXJ2ZXItc3VwcGxpZWQtYXVkaXQtbmFtZS5qc29uXCIsXG4gICAgICAgIHJlcXVlc3RzOiBhdWRpdFJlcXVlc3RzLFxuICAgICAgICBmYWlsRmlyc3RQcmV2aWV3OiB0cnVlLFxuICAgICAgfSxcbiAgICB9KTtcbiAgICBhd2FpdCBwcm9ncmFtbWF0aWNTaWduSW4ocGFnZSk7XG4gICAgYXdhaXQgcGFnZS5ldmFsdWF0ZSgoKSA9PiB7XG4gICAgICBjb25zdCBleGVjdXRpb24gPSB7XG4gICAgICAgIGlkOiBcImUyZS1jb250cm9sbGVkLWV4ZWN1dGlvblwiLFxuICAgICAgICBwcm9qZWN0SWQ6IFwiZTJlLXByb2plY3RcIixcbiAgICAgICAgc2Vzc2lvbklkOiBcImUyZS1hdWRpdC1zZXNzaW9uXCIsXG4gICAgICAgIG1lc3NhZ2U6IFwiQ29tcGxldGVkIGF1ZGl0IGV4ZWN1dGlvblwiLFxuICAgICAgfTtcbiAgICAgIGxvY2FsU3RvcmFnZS5zZXRJdGVtKFxuICAgICAgICBcImVvc19haV9leGVjdXRpb25fY3VycmVudF9lMmUtcHJvamVjdFwiLFxuICAgICAgICBcImUyZS1hdWRpdC1zZXNzaW9uXCIsXG4gICAgICApO1xuICAgICAgbG9jYWxTdG9yYWdlLnNldEl0ZW0oXG4gICAgICAgIFwiZW9zX2FpX2V4ZWN1dGlvbl9lMmUtcHJvamVjdF9lMmUtYXVkaXQtc2Vzc2lvblwiLFxuICAgICAgICBKU09OLnN0cmluZ2lmeShleGVjdXRpb24pLFxuICAgICAgKTtcbiAgICB9KTtcbiAgICBhd2FpdCBwYWdlLmdvdG8oYCR7REFTSEJPQVJEX1BBVEh9YWlgKTtcblxuICAgIGNvbnN0IHByb29mID0gcGFnZS5nZXRCeUxhYmVsKFwiQWdlbnQgZXhlY3V0aW9uIHByb29mXCIpO1xuICAgIGF3YWl0IGV4cGVjdChwcm9vZikudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QocHJvb2YpLnRvQ29udGFpblRleHQoL2NvbXBsZXRlZC9pKTtcbiAgICBhd2FpdCBleHBlY3QocHJvb2YpLnRvQ29udGFpblRleHQoXCJSZXZpc2lvbjogZTJlLXJldmlzaW9uLTQyXCIpO1xuXG4gICAgYXdhaXQgcHJvb2YuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJQcmV2aWV3IGF1ZGl0XCIgfSkuY2xpY2soKTtcbiAgICBjb25zdCBwcmV2aWV3ID0gcGFnZS5nZXRCeUxhYmVsKFwiUmVkYWN0ZWQgYXVkaXQgcHJldmlld1wiKTtcbiAgICBhd2FpdCBleHBlY3QocHJldmlldykudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QocHJldmlldykudG9Db250YWluVGV4dChcIkF1ZGl0IHByZXZpZXcgdGVtcG9yYXJpbHkgdW5hdmFpbGFibGVcIik7XG4gICAgYXdhaXQgZXhwZWN0KHByZXZpZXcpLnRvQ29udGFpblRleHQoXCJzYW1lIGV4ZWN1dGlvbiBhbmQgcmV2aXNpb25cIik7XG4gICAgYXdhaXQgZXhwZWN0KHByZXZpZXcuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJSZXRyeSBwcmV2aWV3XCIgfSkpLnRvQmVWaXNpYmxlKCk7XG4gICAgZXhwZWN0KGF1ZGl0UmVxdWVzdHMpLnRvSGF2ZUxlbmd0aCgxKTtcblxuICAgIGF3YWl0IHByZXZpZXcuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJSZXRyeSBwcmV2aWV3XCIgfSkuY2xpY2soKTtcbiAgICBhd2FpdCBleHBlY3QocHJldmlldykudG9Db250YWluVGV4dChcInByb3ZpZGVyIHNlY3JldHNcIik7XG4gICAgYXdhaXQgZXhwZWN0KHByZXZpZXcpLnRvQ29udGFpblRleHQoXCJyYXcgbW9kZWwgb3V0cHV0XCIpO1xuICAgIGF3YWl0IGV4cGVjdChwcmV2aWV3KS50b0NvbnRhaW5UZXh0KFwicHJpdmF0ZSBydW50aW1lIHBhdGhzXCIpO1xuICAgIGF3YWl0IGV4cGVjdChwcmV2aWV3KS50b0NvbnRhaW5UZXh0KEVYRUNVVElPTl9JRCk7XG4gICAgYXdhaXQgZXhwZWN0KHByZXZpZXcpLnRvQ29udGFpblRleHQoXCJlMmUtb3BlcmF0aW9uXCIpO1xuICAgIGF3YWl0IGV4cGVjdChwcmV2aWV3KS50b0NvbnRhaW5UZXh0KFwiZTJlLXJldmlzaW9uLTQyXCIpO1xuICAgIGV4cGVjdChhdWRpdFJlcXVlc3RzKS50b0hhdmVMZW5ndGgoMik7XG4gICAgZXhwZWN0KG5ldyBVUkwoYXVkaXRSZXF1ZXN0c1swXSkucGF0aG5hbWUpLnRvQmUoXG4gICAgICBgL2FwaS9haS9leGVjdXRpb25zLyR7RVhFQ1VUSU9OX0lEfS9hdWRpdC1leHBvcnRgLFxuICAgICk7XG5cbiAgICBhd2FpdCBwcmV2aWV3LmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiQ2xvc2UgYXVkaXQgcHJldmlld1wiIH0pLmNsaWNrKCk7XG4gICAgYXdhaXQgZXhwZWN0KHByZXZpZXcpLnRvQmVIaWRkZW4oKTtcblxuICAgIGNvbnN0IGRvd25sb2FkUHJvbWlzZSA9IHBhZ2Uud2FpdEZvckV2ZW50KFwiZG93bmxvYWRcIik7XG4gICAgYXdhaXQgcHJvb2YuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJFeHBvcnQgYXVkaXRcIiB9KS5jbGljaygpO1xuICAgIGNvbnN0IGRvd25sb2FkID0gYXdhaXQgZG93bmxvYWRQcm9taXNlO1xuICAgIGV4cGVjdChkb3dubG9hZC5zdWdnZXN0ZWRGaWxlbmFtZSgpKS50b0JlKFwic2VydmVyLXN1cHBsaWVkLWF1ZGl0LW5hbWUuanNvblwiKTtcbiAgICBleHBlY3QoYXVkaXRSZXF1ZXN0cykudG9IYXZlTGVuZ3RoKDMpO1xuXG4gICAgYXdhaXQgcGFnZS5yZWxvYWQoKTtcbiAgICBjb25zdCByZWxvYWRlZFByb29mID0gcGFnZS5nZXRCeUxhYmVsKFwiQWdlbnQgZXhlY3V0aW9uIHByb29mXCIpO1xuICAgIGF3YWl0IGV4cGVjdChyZWxvYWRlZFByb29mKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChyZWxvYWRlZFByb29mKS50b0NvbnRhaW5UZXh0KC9jb21wbGV0ZWQvaSk7XG4gICAgYXdhaXQgZXhwZWN0KHJlbG9hZGVkUHJvb2YpLnRvQ29udGFpblRleHQoXCJFeGVjdXRpb24gZTJlLWNvbnRyb2xsZWQtZXhlY3V0aW9uXCIpO1xuICAgIGF3YWl0IGV4cGVjdChyZWxvYWRlZFByb29mKS50b0NvbnRhaW5UZXh0KFwiUmV2aXNpb246IGUyZS1yZXZpc2lvbi00MlwiKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5TGFiZWwoXCJSZWRhY3RlZCBhdWRpdCBwcmV2aWV3XCIpLFxuICAgICkudG9CZUhpZGRlbigpO1xuICAgIGV4cGVjdChhdWRpdFJlcXVlc3RzKS50b0hhdmVMZW5ndGgoMyk7XG4gIH0pO1xuXG4gIHRlc3QoXCJrZWVwcyB0aGUgY2FuY2VsbGVkIGV4ZWN1dGlvbiBhdWRpdCBoYW5kb2ZmIHJlZGFjdGVkIGFuZCB0ZXJtaW5hbFwiLCBhc3luYyAoe1xuICAgIHBhZ2UsXG4gIH0pID0+IHtcbiAgICBjb25zdCBhdWRpdFJlcXVlc3RzOiBzdHJpbmdbXSA9IFtdO1xuICAgIGNvbnN0IGNhbmNlbGxlZEV4ZWN1dGlvbiA9IHtcbiAgICAgIC4uLmV4ZWN1dGlvbkZpeHR1cmUsXG4gICAgICBzdGF0dXM6IFwiY2FuY2VsbGVkXCIsXG4gICAgICBmbGlnaHRTdGF0ZTogXCJDQU5DRUxMRURcIixcbiAgICAgIGNoZWNrcG9pbnQ6IHtcbiAgICAgICAgc3RhZ2U6IFwiY2FuY2VsbGVkXCIsXG4gICAgICAgIGRldGFpbDogXCJFeGVjdXRpb24gY2FuY2VsbGVkIGJlZm9yZSBhbnkgY2hhbmdlcyB3ZXJlIGFwcGxpZWQuXCIsXG4gICAgICB9LFxuICAgICAgdGVybWluYWxSZWFzb246IFwiY2FuY2VsX3JlcXVlc3RlZFwiLFxuICAgICAgY29tcGxldGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMTozMC4wMDBaXCIsXG4gICAgICB1cGRhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMTozMC4wMDBaXCIsXG4gICAgfTtcbiAgICBjb25zdCBhdWRpdEJvZHkgPSB7XG4gICAgICBmb3JtYXQ6IFwiZW5naW5lZXJpbmdvcy5leGVjdXRpb24tYXVkaXQudjFcIixcbiAgICAgIGV4cG9ydGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMjowMC4wMDBaXCIsXG4gICAgICBleGVjdXRpb246IHtcbiAgICAgICAgaWQ6IEVYRUNVVElPTl9JRCxcbiAgICAgICAgcHJvamVjdElkOiBcImUyZS1wcm9qZWN0XCIsXG4gICAgICAgIHNlc3Npb25JZDogXCJlMmUtYXVkaXQtc2Vzc2lvblwiLFxuICAgICAgICBvcGVyYXRpb25JZDogZXhlY3V0aW9uRml4dHVyZS5vcGVyYXRpb25JZCxcbiAgICAgICAgc3RhdHVzOiBcImNhbmNlbGxlZFwiLFxuICAgICAgICB0ZXJtaW5hbFN0YXRlOiBcImNhbmNlbGxlZFwiLFxuICAgICAgICByZXZpc2lvbjogXCJlMmUtcmV2aXNpb24tNDJcIixcbiAgICAgICAgcHJvb2Y6IHsgcmVxdWlyZWQ6IGZhbHNlLCB2ZXJkaWN0OiBcIk5PVF9SRUNPUkRFRFwiIH0sXG4gICAgICB9LFxuICAgICAgdGltZWxpbmU6IFtcbiAgICAgICAgeyB0eXBlOiBcImNhbmNlbGxlZFwiLCBkZXRhaWw6IFwiQ2FuY2VsbGF0aW9uIGFjY2VwdGVkIGJ5IHRoZSBzZXJ2ZXIuXCIgfSxcbiAgICAgIF0sXG4gICAgICB2YWxpZGF0aW9uczogW10sXG4gICAgICBhZmZlY3RlZEZpbGVzOiBbXSxcbiAgICAgIHJlZGFjdGlvbjoge1xuICAgICAgICBleGNsdWRlZDogW1xuICAgICAgICAgIFwicHJvdmlkZXIgc2VjcmV0c1wiLFxuICAgICAgICAgIFwicmF3IG1vZGVsIG91dHB1dFwiLFxuICAgICAgICAgIFwicHJpdmF0ZSBydW50aW1lIHBhdGhzXCIsXG4gICAgICAgIF0sXG4gICAgICB9LFxuICAgIH07XG4gICAgYXdhaXQgaW5zdGFsbEFwaUZpeHR1cmVzKHBhZ2UsIHtcbiAgICAgIGF1ZGl0RXhwb3J0OiB7XG4gICAgICAgIGJvZHk6IGF1ZGl0Qm9keSxcbiAgICAgICAgZmlsZW5hbWU6IFwiY2FuY2VsbGVkLXNlcnZlci1hdWRpdC5qc29uXCIsXG4gICAgICAgIHJlcXVlc3RzOiBhdWRpdFJlcXVlc3RzLFxuICAgICAgICBleGVjdXRpb246IGNhbmNlbGxlZEV4ZWN1dGlvbixcbiAgICAgICAgbWVzc2FnZU91dGNvbWU6IFwiQ0FOQ0VMTEVEXCIsXG4gICAgICAgIGZhaWxGaXJzdFByZXZpZXc6IHRydWUsXG4gICAgICB9LFxuICAgIH0pO1xuICAgIGF3YWl0IHByb2dyYW1tYXRpY1NpZ25JbihwYWdlKTtcbiAgICBhd2FpdCBwYWdlLmV2YWx1YXRlKCgpID0+IHtcbiAgICAgIGNvbnN0IGV4ZWN1dGlvbiA9IHtcbiAgICAgICAgaWQ6IFwiZTJlLWNvbnRyb2xsZWQtZXhlY3V0aW9uXCIsXG4gICAgICAgIHByb2plY3RJZDogXCJlMmUtcHJvamVjdFwiLFxuICAgICAgICBzZXNzaW9uSWQ6IFwiZTJlLWF1ZGl0LXNlc3Npb25cIixcbiAgICAgICAgbWVzc2FnZTogXCJDYW5jZWxsZWQgYXVkaXQgZXhlY3V0aW9uXCIsXG4gICAgICB9O1xuICAgICAgbG9jYWxTdG9yYWdlLnNldEl0ZW0oXG4gICAgICAgIFwiZW9zX2FpX2V4ZWN1dGlvbl9jdXJyZW50X2UyZS1wcm9qZWN0XCIsXG4gICAgICAgIFwiZTJlLWF1ZGl0LXNlc3Npb25cIixcbiAgICAgICk7XG4gICAgICBsb2NhbFN0b3JhZ2Uuc2V0SXRlbShcbiAgICAgICAgXCJlb3NfYWlfZXhlY3V0aW9uX2UyZS1wcm9qZWN0X2UyZS1hdWRpdC1zZXNzaW9uXCIsXG4gICAgICAgIEpTT04uc3RyaW5naWZ5KGV4ZWN1dGlvbiksXG4gICAgICApO1xuICAgIH0pO1xuICAgIGF3YWl0IHBhZ2UuZ290byhgJHtEQVNIQk9BUkRfUEFUSH1haWApO1xuXG4gICAgY29uc3QgcHJvb2YgPSBwYWdlLmdldEJ5TGFiZWwoXCJBZ2VudCBleGVjdXRpb24gcHJvb2ZcIik7XG4gICAgYXdhaXQgZXhwZWN0KHByb29mKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChwcm9vZikudG9Db250YWluVGV4dChcIkNhbmNlbGxlZFwiKTtcbiAgICBhd2FpdCBleHBlY3QocHJvb2YpLnRvQ29udGFpblRleHQoXCJFeGVjdXRpb24gZTJlLWNvbnRyb2xsZWQtZXhlY3V0aW9uXCIpO1xuICAgIGF3YWl0IGV4cGVjdChwcm9vZikudG9Db250YWluVGV4dChcIlJldmlzaW9uOiBlMmUtcmV2aXNpb24tNDJcIik7XG4gICAgYXdhaXQgZXhwZWN0KHByb29mKS50b0NvbnRhaW5UZXh0KFwiVGVybWluYWwgcmVhc29uOiBjYW5jZWxfcmVxdWVzdGVkXCIpO1xuICAgIGF3YWl0IGV4cGVjdChwcm9vZi5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIkNhbmNlbFwiIH0pKS50b0hhdmVDb3VudCgwKTtcbiAgICBhd2FpdCBleHBlY3QocHJvb2YuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJSZXN1bWVcIiB9KSkudG9IYXZlQ291bnQoMCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcHJvb2YuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJBcHByb3ZlICYgYXBwbHlcIiB9KSxcbiAgICApLnRvSGF2ZUNvdW50KDApO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHByb29mLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IC9jb21taXQgdmVyaWZpZWQgY2hhbmdlcy9pIH0pLFxuICAgICkudG9IYXZlQ291bnQoMCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcHJvb2YuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogL3B1c2ggY29tbWl0dGVkIGNoYW5nZXMvaSB9KSxcbiAgICApLnRvSGF2ZUNvdW50KDApO1xuXG4gICAgYXdhaXQgcHJvb2YuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJQcmV2aWV3IGF1ZGl0XCIgfSkuY2xpY2soKTtcbiAgICBjb25zdCBwcmV2aWV3ID0gcGFnZS5nZXRCeUxhYmVsKFwiUmVkYWN0ZWQgYXVkaXQgcHJldmlld1wiKTtcbiAgICBhd2FpdCBleHBlY3QocHJldmlldykudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QocHJldmlldykudG9Db250YWluVGV4dChcIkF1ZGl0IHByZXZpZXcgdGVtcG9yYXJpbHkgdW5hdmFpbGFibGVcIik7XG4gICAgYXdhaXQgZXhwZWN0KHByZXZpZXcpLnRvQ29udGFpblRleHQoXCJzYW1lIGV4ZWN1dGlvbiBhbmQgcmV2aXNpb25cIik7XG4gICAgYXdhaXQgZXhwZWN0KHByZXZpZXcuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJSZXRyeSBwcmV2aWV3XCIgfSkpLnRvQmVWaXNpYmxlKCk7XG4gICAgZXhwZWN0KGF1ZGl0UmVxdWVzdHMpLnRvSGF2ZUxlbmd0aCgxKTtcblxuICAgIGF3YWl0IHByZXZpZXcuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJSZXRyeSBwcmV2aWV3XCIgfSkuY2xpY2soKTtcbiAgICBhd2FpdCBleHBlY3QocHJldmlldykudG9Db250YWluVGV4dChcImNhbmNlbGxlZFwiKTtcbiAgICBhd2FpdCBleHBlY3QocHJldmlldykudG9Db250YWluVGV4dChFWEVDVVRJT05fSUQpO1xuICAgIGF3YWl0IGV4cGVjdChwcmV2aWV3KS50b0NvbnRhaW5UZXh0KFwiZTJlLW9wZXJhdGlvblwiKTtcbiAgICBhd2FpdCBleHBlY3QocHJldmlldykudG9Db250YWluVGV4dChcImUyZS1yZXZpc2lvbi00MlwiKTtcbiAgICBhd2FpdCBleHBlY3QocHJldmlldykudG9Db250YWluVGV4dChcInByb3ZpZGVyIHNlY3JldHNcIik7XG4gICAgYXdhaXQgZXhwZWN0KHByZXZpZXcpLnRvQ29udGFpblRleHQoXCJyYXcgbW9kZWwgb3V0cHV0XCIpO1xuICAgIGF3YWl0IGV4cGVjdChwcmV2aWV3KS50b0NvbnRhaW5UZXh0KFwicHJpdmF0ZSBydW50aW1lIHBhdGhzXCIpO1xuICAgIGF3YWl0IGV4cGVjdChwcm9vZikudG9Db250YWluVGV4dChcIkNhbmNlbGxlZFwiKTtcbiAgICBhd2FpdCBleHBlY3QocHJvb2YpLnRvQ29udGFpblRleHQoXCJSZXZpc2lvbjogZTJlLXJldmlzaW9uLTQyXCIpO1xuICAgIGF3YWl0IGV4cGVjdChwcm9vZikudG9Db250YWluVGV4dChcIlRlcm1pbmFsIHJlYXNvbjogY2FuY2VsX3JlcXVlc3RlZFwiKTtcbiAgICBleHBlY3QoYXVkaXRSZXF1ZXN0cykudG9IYXZlTGVuZ3RoKDIpO1xuXG4gICAgYXdhaXQgcHJldmlldy5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIkNsb3NlIGF1ZGl0IHByZXZpZXdcIiB9KS5jbGljaygpO1xuICAgIGNvbnN0IGRvd25sb2FkUHJvbWlzZSA9IHBhZ2Uud2FpdEZvckV2ZW50KFwiZG93bmxvYWRcIik7XG4gICAgYXdhaXQgcHJvb2YuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJFeHBvcnQgYXVkaXRcIiB9KS5jbGljaygpO1xuICAgIGNvbnN0IGRvd25sb2FkID0gYXdhaXQgZG93bmxvYWRQcm9taXNlO1xuICAgIGV4cGVjdChkb3dubG9hZC5zdWdnZXN0ZWRGaWxlbmFtZSgpKS50b0JlKFwiY2FuY2VsbGVkLXNlcnZlci1hdWRpdC5qc29uXCIpO1xuICAgIGV4cGVjdChhdWRpdFJlcXVlc3RzKS50b0hhdmVMZW5ndGgoMyk7XG5cbiAgICBhd2FpdCBwYWdlLnJlbG9hZCgpO1xuICAgIGNvbnN0IHJlbG9hZGVkUHJvb2YgPSBwYWdlLmdldEJ5TGFiZWwoXCJBZ2VudCBleGVjdXRpb24gcHJvb2ZcIik7XG4gICAgYXdhaXQgZXhwZWN0KHJlbG9hZGVkUHJvb2YpLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KHJlbG9hZGVkUHJvb2YpLnRvQ29udGFpblRleHQoXCJDYW5jZWxsZWRcIik7XG4gICAgYXdhaXQgZXhwZWN0KHJlbG9hZGVkUHJvb2YpLnRvQ29udGFpblRleHQoXCJSZXZpc2lvbjogZTJlLXJldmlzaW9uLTQyXCIpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlLmdldEJ5TGFiZWwoXCJSZWRhY3RlZCBhdWRpdCBwcmV2aWV3XCIpKS50b0JlSGlkZGVuKCk7XG4gICAgZXhwZWN0KGF1ZGl0UmVxdWVzdHMpLnRvSGF2ZUxlbmd0aCgzKTtcbiAgfSk7XG5cbiAgdGVzdChcInVwbG9hZHMgYW4gYXJjaGl2ZSBhbmQgcmVuZGVycyBhIGxpdmUgdGFzayB1cGRhdGVcIiwgYXN5bmMgKHtcbiAgICBwYWdlLFxuICB9KSA9PiB7XG4gICAgY29uc3QgdGFza0lkID0gXCJlMmUtbGl2ZS10YXNrXCI7XG4gICAgY29uc3QgbGl2ZUxvZyA9IHtcbiAgICAgIGlkOiBcImUyZS1saXZlLWxvZ1wiLFxuICAgICAgdGFza0lkLFxuICAgICAgbGV2ZWw6IFwiaW5mb1wiLFxuICAgICAgbWVzc2FnZTogXCJMaXZlIHVwZGF0ZSByZWNlaXZlZCBmcm9tIHRoZSBzZXJ2ZXJcIixcbiAgICAgIHRpbWVzdGFtcDogXCIyMDI2LTAxLTAxVDAwOjAwOjAyLjAwMFpcIixcbiAgICB9O1xuICAgIGF3YWl0IGluc3RhbGxBcGlGaXh0dXJlcyhwYWdlLCB7XG4gICAgICBhcmNoaXZlVXBsb2FkOiB7XG4gICAgICAgIHVwbG9hZElkOiBcImUyZS11cGxvYWRcIixcbiAgICAgICAgb3JpZ2luYWxOYW1lOiBcImRhc2hib2FyZC1qb3VybmV5LnppcFwiLFxuICAgICAgfSxcbiAgICAgIGxpdmVUYXNrOiB7XG4gICAgICAgIGlkOiB0YXNrSWQsXG4gICAgICAgIHRpdGxlOiBcIlZlcmlmeSBsaXZlIGRhc2hib2FyZCB1cGRhdGVzXCIsXG4gICAgICAgIHByb2plY3RJZDogXCJlMmUtcHJvamVjdFwiLFxuICAgICAgICBsb2c6IGxpdmVMb2csXG4gICAgICB9LFxuICAgIH0pO1xuICAgIGF3YWl0IHByb2dyYW1tYXRpY1NpZ25JbihwYWdlKTtcblxuICAgIC8vIFRoaXMgaXMgYSB2YWxpZCwgZW1wdHkgWklQIGFyY2hpdmUuIEtlZXBpbmcgaXQgaW5saW5lIG1ha2VzIHRoZSBicm93c2VyXG4gICAgLy8gdGVzdCBzZWxmLWNvbnRhaW5lZCB3aGlsZSBzdGlsbCBleGVyY2lzaW5nIEZvcm1EYXRhIGFuZCBtdWx0aXBhcnQgYnl0ZXMuXG4gICAgY29uc3QgdXBsb2FkUmVzdWx0ID0gYXdhaXQgcGFnZS5ldmFsdWF0ZShhc3luYyAoYXBpQmFzZVVybCkgPT4ge1xuICAgICAgY29uc3QgYnl0ZXMgPSBVaW50OEFycmF5LmZyb20oXG4gICAgICAgIGF0b2IoXCJVRXNGQmdBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUE9PVwiKSxcbiAgICAgICAgKGNoYXJhY3RlcikgPT4gY2hhcmFjdGVyLmNoYXJDb2RlQXQoMCksXG4gICAgICApO1xuICAgICAgY29uc3QgYm9keSA9IG5ldyBGb3JtRGF0YSgpO1xuICAgICAgYm9keS5hcHBlbmQoXG4gICAgICAgIFwiYXJjaGl2ZVwiLFxuICAgICAgICBuZXcgQmxvYihbYnl0ZXNdLCB7IHR5cGU6IFwiYXBwbGljYXRpb24vemlwXCIgfSksXG4gICAgICAgIFwiZGFzaGJvYXJkLWpvdXJuZXkuemlwXCIsXG4gICAgICApO1xuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBmZXRjaChcbiAgICAgICAgbmV3IFVSTChcIi9hcGkvdXBsb2FkL2FyY2hpdmVcIiwgYXBpQmFzZVVybCkudG9TdHJpbmcoKSxcbiAgICAgICAgeyBtZXRob2Q6IFwiUE9TVFwiLCBjcmVkZW50aWFsczogXCJpbmNsdWRlXCIsIGJvZHkgfSxcbiAgICAgICk7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBzdGF0dXM6IHJlc3BvbnNlLnN0YXR1cyxcbiAgICAgICAgYm9keTogKGF3YWl0IHJlc3BvbnNlLmpzb24oKSkgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4sXG4gICAgICB9O1xuICAgIH0sIHByb2Nlc3MuZW52LkRBU0hCT0FSRF9FMkVfQVBJX0JBU0VfVVJMID8/IHBhZ2UudXJsKCkpO1xuICAgIGV4cGVjdCh1cGxvYWRSZXN1bHQuc3RhdHVzKS50b0JlKDIwMSk7XG4gICAgZXhwZWN0KHVwbG9hZFJlc3VsdC5ib2R5KS50b0VxdWFsKHtcbiAgICAgIHVwbG9hZElkOiBcImUyZS11cGxvYWRcIixcbiAgICAgIG9yaWdpbmFsTmFtZTogXCJkYXNoYm9hcmQtam91cm5leS56aXBcIixcbiAgICB9KTtcblxuICAgIGF3YWl0IG9wZW5OYXZpZ2F0aW9uKHBhZ2UsIFwiVGFza3NcIiwgYCR7REFTSEJPQVJEX1BBVEh9dGFza3NgKTtcbiAgICBjb25zdCB0YXNrUm93ID0gcGFnZS5nZXRCeUxhYmVsKFxuICAgICAgXCJFeHBhbmQgdGFzayBWZXJpZnkgbGl2ZSBkYXNoYm9hcmQgdXBkYXRlc1wiLFxuICAgICk7XG4gICAgYXdhaXQgZXhwZWN0KHRhc2tSb3cpLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgdGFza1Jvdy5jbGljaygpO1xuICAgIGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJMb2dzXCIgfSkuY2xpY2soKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5nZXRCeVJvbGUoXCJyZWdpb25cIiwgeyBuYW1lOiBcIkFjdGl2aXR5XCIgfSkpLnRvQ29udGFpblRleHQoXG4gICAgICBcIkxpdmUgdXBkYXRlIHJlY2VpdmVkIGZyb20gdGhlIHNlcnZlclwiLFxuICAgICk7XG4gIH0pO1xuXG4gIHRlc3QoXCJyZWNvdmVycyBhIGxpdmUgdGFzayB1cGRhdGUgYWZ0ZXIgYSB0ZW1wb3Jhcnkgc3RyZWFtIGZhaWx1cmVcIiwgYXN5bmMgKHtcbiAgICBwYWdlLFxuICB9KSA9PiB7XG4gICAgY29uc3QgdGFza0lkID0gXCJlMmUtcmVjb25uZWN0aW5nLWxpdmUtdGFza1wiO1xuICAgIGNvbnN0IGxpdmVMb2cgPSB7XG4gICAgICBpZDogXCJlMmUtcmVjb25uZWN0aW5nLWxpdmUtbG9nXCIsXG4gICAgICB0YXNrSWQsXG4gICAgICBsZXZlbDogXCJpbmZvXCIsXG4gICAgICBtZXNzYWdlOiBcIkF1dGhvcml0YXRpdmUgdXBkYXRlIHJlY2VpdmVkIGFmdGVyIHJlY29ubmVjdFwiLFxuICAgICAgdGltZXN0YW1wOiBcIjIwMjYtMDEtMDFUMDA6MDA6MDIuMDAwWlwiLFxuICAgICAgbWV0YWRhdGE6IHtcbiAgICAgICAgb3BlcmF0aW9uSWQ6IFwiZTJlLXJlY29ubmVjdGluZy1vcGVyYXRpb25cIixcbiAgICAgICAgY2hlY2twb2ludFZlcnNpb246IDMsXG4gICAgICB9LFxuICAgIH07XG4gICAgY29uc3Qgc3RyZWFtUmVxdWVzdHM6IHN0cmluZ1tdID0gW107XG4gICAgYXdhaXQgaW5zdGFsbEFwaUZpeHR1cmVzKHBhZ2UsIHtcbiAgICAgIGxpdmVUYXNrOiB7XG4gICAgICAgIGlkOiB0YXNrSWQsXG4gICAgICAgIHRpdGxlOiBcIlJlY292ZXIgbGl2ZSB0YXNrIHVwZGF0ZXNcIixcbiAgICAgICAgcHJvamVjdElkOiBcImUyZS1wcm9qZWN0XCIsXG4gICAgICAgIGxvZzogbGl2ZUxvZyxcbiAgICAgICAgc3RyZWFtUmVxdWVzdHMsXG4gICAgICAgIGZhaWxGaXJzdFN0cmVhbTogdHJ1ZSxcbiAgICAgIH0sXG4gICAgfSk7XG4gICAgYXdhaXQgcHJvZ3JhbW1hdGljU2lnbkluKHBhZ2UpO1xuXG4gICAgYXdhaXQgb3Blbk5hdmlnYXRpb24ocGFnZSwgXCJUYXNrc1wiLCBgJHtEQVNIQk9BUkRfUEFUSH10YXNrc2ApO1xuICAgIGNvbnN0IHRhc2tSb3cgPSBwYWdlLmdldEJ5TGFiZWwoXCJFeHBhbmQgdGFzayBSZWNvdmVyIGxpdmUgdGFzayB1cGRhdGVzXCIpO1xuICAgIGF3YWl0IGV4cGVjdCh0YXNrUm93KS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IHRhc2tSb3cuY2xpY2soKTtcbiAgICBhd2FpdCBwYWdlLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiTG9nc1wiIH0pLmNsaWNrKCk7XG5cbiAgICBjb25zdCBhY3Rpdml0eSA9IHBhZ2UuZ2V0QnlSb2xlKFwicmVnaW9uXCIsIHsgbmFtZTogXCJBY3Rpdml0eVwiIH0pO1xuICAgIGF3YWl0IGV4cGVjdChhY3Rpdml0eSkudG9Db250YWluVGV4dChsaXZlTG9nLm1lc3NhZ2UpO1xuICAgIGF3YWl0IGV4cGVjdFxuICAgICAgLnBvbGwoKCkgPT4gc3RyZWFtUmVxdWVzdHMubGVuZ3RoLCB7XG4gICAgICAgIG1lc3NhZ2U6IFwidGhlIHRhc2sgbG9nIHN0cmVhbSBzaG91bGQgcmVjb25uZWN0IGV4YWN0bHkgb25jZVwiLFxuICAgICAgfSlcbiAgICAgIC50b0JlKDIpO1xuICAgIGV4cGVjdChzdHJlYW1SZXF1ZXN0cykudG9IYXZlTGVuZ3RoKDIpO1xuICAgIGV4cGVjdChzdHJlYW1SZXF1ZXN0c1swXSkudG9CZShzdHJlYW1SZXF1ZXN0c1sxXSk7XG4gICAgZXhwZWN0KG5ldyBVUkwoc3RyZWFtUmVxdWVzdHNbMV0pLnBhdGhuYW1lKS50b0JlKFxuICAgICAgYC9hcGkvdGFza3MvJHt0YXNrSWR9L2xvZ3Mvc3RyZWFtYCxcbiAgICApO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIGFjdGl2aXR5LmxvY2F0b3IoXCJzdW1tYXJ5XCIpLmZpbHRlcih7IGhhc1RleHQ6IGxpdmVMb2cubWVzc2FnZSB9KSxcbiAgICApLnRvSGF2ZUNvdW50KDEpO1xuICB9KTtcblxuICB0ZXN0KFwic2hvd3MgYW4gYWN0aW9uYWJsZSB0ZXJtaW5hbCBzdGF0ZSB3aGVuIGxpdmUgdGFzayByZWNvbm5lY3RzIGFyZSBleGhhdXN0ZWRcIiwgYXN5bmMgKHtcbiAgICBwYWdlLFxuICB9KSA9PiB7XG4gICAgY29uc3QgdGFza0lkID0gXCJlMmUtZXhoYXVzdGVkLWxpdmUtdGFza1wiO1xuICAgIGNvbnN0IG9wZXJhdGlvbklkID0gXCJlMmUtZXhoYXVzdGVkLW9wZXJhdGlvblwiO1xuICAgIGNvbnN0IGxpdmVMb2cgPSB7XG4gICAgICBpZDogXCJlMmUtZXhoYXVzdGVkLWxpdmUtbG9nXCIsXG4gICAgICB0YXNrSWQsXG4gICAgICBsZXZlbDogXCJpbmZvXCIsXG4gICAgICBtZXNzYWdlOiBcIlRoZSBvbmx5IGNvbmZpcm1lZCB0YXNrIHVwZGF0ZVwiLFxuICAgICAgdGltZXN0YW1wOiBcIjIwMjYtMDEtMDFUMDA6MDA6MDIuMDAwWlwiLFxuICAgICAgbWV0YWRhdGE6IHsgb3BlcmF0aW9uSWQgfSxcbiAgICB9O1xuICAgIGNvbnN0IHN0cmVhbVJlcXVlc3RzOiBzdHJpbmdbXSA9IFtdO1xuICAgIGNvbnN0IG5vblN0cmVhbVJlcXVlc3RzOiBzdHJpbmdbXSA9IFtdO1xuICAgIHBhZ2Uub24oXCJyZXF1ZXN0XCIsIChyZXF1ZXN0KSA9PiB7XG4gICAgICBpZiAoIXJlcXVlc3QudXJsKCkuaW5jbHVkZXMoXCIvYXBpL3Rhc2tzL1wiKSkgcmV0dXJuO1xuICAgICAgaWYgKCFyZXF1ZXN0LnVybCgpLmluY2x1ZGVzKFwiL2xvZ3Mvc3RyZWFtXCIpKSBub25TdHJlYW1SZXF1ZXN0cy5wdXNoKHJlcXVlc3QubWV0aG9kKCkpO1xuICAgIH0pO1xuICAgIGF3YWl0IGluc3RhbGxBcGlGaXh0dXJlcyhwYWdlLCB7XG4gICAgICBsaXZlVGFzazoge1xuICAgICAgICBpZDogdGFza0lkLFxuICAgICAgICB0aXRsZTogXCJSZWNvdmVyIGV4aGF1c3RlZCBsaXZlIHRhc2sgdXBkYXRlc1wiLFxuICAgICAgICBwcm9qZWN0SWQ6IFwiZTJlLXByb2plY3RcIixcbiAgICAgICAgbG9nOiBsaXZlTG9nLFxuICAgICAgICBpbml0aWFsTG9nczogW2xpdmVMb2ddLFxuICAgICAgICBzdHJlYW1SZXF1ZXN0cyxcbiAgICAgICAgZmFpbFN0cmVhbUF0dGVtcHRzOiA2LFxuICAgICAgfSxcbiAgICB9KTtcbiAgICBhd2FpdCBwcm9ncmFtbWF0aWNTaWduSW4ocGFnZSk7XG5cbiAgICBhd2FpdCBvcGVuTmF2aWdhdGlvbihwYWdlLCBcIlRhc2tzXCIsIGAke0RBU0hCT0FSRF9QQVRIfXRhc2tzYCk7XG4gICAgYXdhaXQgcGFnZS5nZXRCeUxhYmVsKFwiRXhwYW5kIHRhc2sgUmVjb3ZlciBleGhhdXN0ZWQgbGl2ZSB0YXNrIHVwZGF0ZXNcIikuY2xpY2soKTtcbiAgICBhd2FpdCBwYWdlLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiTG9nc1wiIH0pLmNsaWNrKCk7XG5cbiAgICBjb25zdCBhY3Rpdml0eSA9IHBhZ2UuZ2V0QnlSb2xlKFwicmVnaW9uXCIsIHsgbmFtZTogXCJBY3Rpdml0eVwiIH0pO1xuICAgIGF3YWl0IGV4cGVjdChhY3Rpdml0eSkudG9Db250YWluVGV4dChsaXZlTG9nLm1lc3NhZ2UpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlLmdldEJ5VGV4dChcIlRlbXBvcmFyeSBzdHJlYW0gZmFpbHVyZS5cIiwgeyBleGFjdDogZmFsc2UgfSkpLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0XG4gICAgICAucG9sbCgoKSA9PiBzdHJlYW1SZXF1ZXN0cy5sZW5ndGgsIHtcbiAgICAgICAgbWVzc2FnZTogXCJ0aGUgdGFzayBsb2cgc3RyZWFtIHNob3VsZCBleGhhdXN0IGl0cyBib3VuZGVkIHJlY29ubmVjdCBidWRnZXRcIixcbiAgICAgICAgdGltZW91dDogMzVfMDAwLFxuICAgICAgfSlcbiAgICAgIC50b0JlKDYpO1xuICAgIGNvbnN0IGV4aGF1c3RlZCA9IHBhZ2UuZ2V0QnlSb2xlKFwiYWxlcnRcIik7XG4gICAgYXdhaXQgZXhwZWN0KGV4aGF1c3RlZCkudG9Db250YWluVGV4dChcIkxpdmUgdGFzayB1cGRhdGVzIGNvdWxkIG5vdCByZWNvbm5lY3RcIik7XG4gICAgYXdhaXQgZXhwZWN0KGV4aGF1c3RlZCkudG9Db250YWluVGV4dChcIlJlY29ubmVjdCBhdHRlbXB0cyBhcmUgZXhoYXVzdGVkXCIpO1xuICAgIGF3YWl0IGV4cGVjdChleGhhdXN0ZWQpLnRvQ29udGFpblRleHQob3BlcmF0aW9uSWQpO1xuICAgIGF3YWl0IGV4cGVjdChleGhhdXN0ZWQpLnRvQ29udGFpblRleHQoXCJ0YXNrIGhhcyBub3QgYmVlbiBtYXJrZWQgZmFpbGVkXCIpO1xuICAgIGF3YWl0IGV4cGVjdChleGhhdXN0ZWQuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJSZXRyeSBsaXZlIHVwZGF0ZXNcIiB9KSkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoZXhoYXVzdGVkLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiUmVmcmVzaCB0YXNrIGxvZ3NcIiB9KSkudG9CZVZpc2libGUoKTtcblxuICAgIGF3YWl0IGV4aGF1c3RlZC5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIlJldHJ5IGxpdmUgdXBkYXRlc1wiIH0pLmNsaWNrKCk7XG4gICAgYXdhaXQgZXhwZWN0KGFjdGl2aXR5KS50b0NvbnRhaW5UZXh0KFwiVGhlIG9ubHkgY29uZmlybWVkIHRhc2sgdXBkYXRlXCIpO1xuICAgIGF3YWl0IGV4cGVjdC5wb2xsKCgpID0+IHN0cmVhbVJlcXVlc3RzLmxlbmd0aCkudG9CZSg3KTtcbiAgICBleHBlY3QobmV3IFNldChzdHJlYW1SZXF1ZXN0cykuc2l6ZSkudG9CZSgxKTtcbiAgICBleHBlY3Qobm9uU3RyZWFtUmVxdWVzdHMpLm5vdC50b0NvbnRhaW4oXCJQT1NUXCIpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIGFjdGl2aXR5LmxvY2F0b3IoXCJzdW1tYXJ5XCIpLmZpbHRlcih7IGhhc1RleHQ6IGxpdmVMb2cubWVzc2FnZSB9KSxcbiAgICApLnRvSGF2ZUNvdW50KDEpO1xuICB9KTtcblxuICB0ZXN0KFwicGFnZXMgYW5kIHJlbG9hZHMgdGhlIGZpbHRlcmVkIGV2ZW50IHN0cmVhbSB3aXRob3V0IGxvc2luZyBpdHMgd2luZG93XCIsIGFzeW5jICh7XG4gICAgcGFnZSxcbiAgfSkgPT4ge1xuICAgIGNvbnN0IGV2ZW50cyA9IEFycmF5LmZyb20oeyBsZW5ndGg6IDUxIH0sIChfLCBpbmRleCkgPT4gKHtcbiAgICAgIGlkOiBgZTJlLWV2ZW50LSR7aW5kZXh9YCxcbiAgICAgIHByb2plY3RJZDogXCJlMmUtcHJvamVjdFwiLFxuICAgICAgdHlwZTogXCJBdWRpdEV2ZW50XCIsXG4gICAgICBzZXZlcml0eTogaW5kZXggPCAyID8gXCJzdWNjZXNzXCIgOiBcImluZm9cIixcbiAgICAgIGNvcnJlbGF0aW9uSWQ6IGluZGV4IDwgMiA/IFwicmVsZWFzZS00MlwiIDogbnVsbCxcbiAgICAgIG1lc3NhZ2U6XG4gICAgICAgIGluZGV4IDwgMiA/IGBGaWx0ZXJlZCByZWxlYXNlIGV2ZW50ICR7aW5kZXh9YCA6IGBPbGRlciBldmVudCAke2luZGV4fWAsXG4gICAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKERhdGUuVVRDKDIwMjYsIDAsIDEsIDAsIDAsIDUxIC0gaW5kZXgpKS50b0lTT1N0cmluZygpLFxuICAgIH0pKTtcbiAgICBjb25zdCBldmVudFJlcXVlc3RzOiBzdHJpbmdbXSA9IFtdO1xuICAgIHBhZ2Uub24oXCJyZXF1ZXN0XCIsIChyZXF1ZXN0KSA9PiB7XG4gICAgICBpZiAobmV3IFVSTChyZXF1ZXN0LnVybCgpKS5wYXRobmFtZS5lbmRzV2l0aChcIi9hcGkvZXZlbnRzXCIpKVxuICAgICAgICBldmVudFJlcXVlc3RzLnB1c2gocmVxdWVzdC51cmwoKSk7XG4gICAgfSk7XG4gICAgYXdhaXQgaW5zdGFsbEFwaUZpeHR1cmVzKHBhZ2UsIHtcbiAgICAgIGV2ZW50cyxcbiAgICAgIHByb2plY3RzOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBpZDogXCJlMmUtcHJvamVjdFwiLFxuICAgICAgICAgIG5hbWU6IFwiU21va2UgUHJvamVjdFwiLFxuICAgICAgICAgIGxhbmd1YWdlOiBcIlR5cGVTY3JpcHRcIixcbiAgICAgICAgICBmcmFtZXdvcms6IFwiUmVhY3RcIixcbiAgICAgICAgICBzdGF0dXM6IFwiYWN0aXZlXCIsXG4gICAgICAgICAgcm9vdFBhdGg6IFwiL2NvbnRyb2xsZWQvc21va2VcIixcbiAgICAgICAgICBxdWFsaXR5U2NvcmU6IDkyLFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICB9KTtcbiAgICBhd2FpdCBwcm9ncmFtbWF0aWNTaWduSW4ocGFnZSk7XG4gICAgYXdhaXQgcGFnZS5nb3RvKGAke0RBU0hCT0FSRF9QQVRIfWV2ZW50c2ApO1xuXG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXCJPbGRlciBldmVudCA0OVwiLCB7IGV4YWN0OiB0cnVlIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcIk9sZGVyIGV2ZW50IDUwXCIsIHsgZXhhY3Q6IHRydWUgfSksXG4gICAgKS5ub3QudG9CZVZpc2libGUoKTtcbiAgICBjb25zdCBmaXJzdFJlcXVlc3QgPSBuZXcgVVJMKGV2ZW50UmVxdWVzdHMuYXQoLTEpISk7XG4gICAgZXhwZWN0KGZpcnN0UmVxdWVzdC5zZWFyY2hQYXJhbXMuZ2V0KFwibGltaXRcIikpLnRvQmUoXCI1MFwiKTtcbiAgICBleHBlY3QoZmlyc3RSZXF1ZXN0LnNlYXJjaFBhcmFtcy5nZXQoXCJwYWdlXCIpKS50b0JlKFwiMVwiKTtcblxuICAgIGF3YWl0IFByb21pc2UuYWxsKFtcbiAgICAgIHBhZ2Uud2FpdEZvclJlcXVlc3QoKHJlcXVlc3QpID0+IHtcbiAgICAgICAgY29uc3QgdXJsID0gbmV3IFVSTChyZXF1ZXN0LnVybCgpKTtcbiAgICAgICAgcmV0dXJuIChcbiAgICAgICAgICB1cmwucGF0aG5hbWUuZW5kc1dpdGgoXCIvYXBpL2V2ZW50c1wiKSAmJlxuICAgICAgICAgIHVybC5zZWFyY2hQYXJhbXMuZ2V0KFwicGFnZVwiKSA9PT0gXCIyXCJcbiAgICAgICAgKTtcbiAgICAgIH0pLFxuICAgICAgcGFnZS5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIk9sZGVyXCIgfSkuY2xpY2soKSxcbiAgICBdKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5nZXRCeVRleHQoXCJQYWdlIDIuXCIsIHsgZXhhY3Q6IGZhbHNlIH0pKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiT2xkZXIgZXZlbnQgNTBcIiwgeyBleGFjdDogdHJ1ZSB9KSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXCJGaWx0ZXJlZCByZWxlYXNlIGV2ZW50IDBcIiwgeyBleGFjdDogdHJ1ZSB9KSxcbiAgICApLm5vdC50b0JlVmlzaWJsZSgpO1xuICAgIGV4cGVjdChuZXcgVVJMKGV2ZW50UmVxdWVzdHMuYXQoLTEpISkuc2VhcmNoUGFyYW1zLmdldChcInBhZ2VcIikpLnRvQmUoXCIyXCIpO1xuICAgIGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJOZXdlclwiIH0pLmNsaWNrKCk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlUZXh0KFwiUGFnZSAxLlwiLCB7IGV4YWN0OiBmYWxzZSB9KSkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcIkZpbHRlcmVkIHJlbGVhc2UgZXZlbnQgMFwiLCB7IGV4YWN0OiB0cnVlIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcblxuICAgIGF3YWl0IHBhZ2UuZ2V0QnlQbGFjZWhvbGRlcihcIlNlYXJjaCBsb2dzLi4uXCIpLmZpbGwoXCJGaWx0ZXJlZCByZWxlYXNlXCIpO1xuICAgIGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJUb2dnbGUgZXZlbnQgZmlsdGVyc1wiIH0pLmNsaWNrKCk7XG4gICAgYXdhaXQgcGFnZS5sb2NhdG9yKFwic2VsZWN0XCIpLm50aCgxKS5zZWxlY3RPcHRpb24oXCJzdWNjZXNzXCIpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiRmlsdGVyZWQgcmVsZWFzZSBldmVudCAwXCIsIHsgZXhhY3Q6IHRydWUgfSksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiT2xkZXIgZXZlbnQgMVwiLCB7IGV4YWN0OiB0cnVlIH0pLFxuICAgICkubm90LnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UpLnRvSGF2ZVVSTCgvc2VhcmNoPUZpbHRlcmVkXFwrcmVsZWFzZS8pO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlKS50b0hhdmVVUkwoL3NldmVyaXR5PXN1Y2Nlc3MvKTtcblxuICAgIGF3YWl0IHBhZ2UucmVsb2FkKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXCJGaWx0ZXJlZCByZWxlYXNlIGV2ZW50IDBcIiwgeyBleGFjdDogdHJ1ZSB9KSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXCJPbGRlciBldmVudCAxXCIsIHsgZXhhY3Q6IHRydWUgfSksXG4gICAgKS5ub3QudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5nZXRCeVBsYWNlaG9sZGVyKFwiU2VhcmNoIGxvZ3MuLi5cIikpLnRvSGF2ZVZhbHVlKFxuICAgICAgXCJGaWx0ZXJlZCByZWxlYXNlXCIsXG4gICAgKTtcbiAgICBhd2FpdCBwYWdlLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiVG9nZ2xlIGV2ZW50IGZpbHRlcnNcIiB9KS5jbGljaygpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoXCJzZWxlY3RcIikubnRoKDEpKS50b0hhdmVWYWx1ZShcInN1Y2Nlc3NcIik7XG4gICAgY29uc3QgZmlsdGVyZWRSZXF1ZXN0ID0gbmV3IFVSTChldmVudFJlcXVlc3RzLmF0KC0xKSEpO1xuICAgIGV4cGVjdChmaWx0ZXJlZFJlcXVlc3Quc2VhcmNoUGFyYW1zLmdldChcImxpbWl0XCIpKS50b0JlKFwiNTBcIik7XG4gICAgZXhwZWN0KGZpbHRlcmVkUmVxdWVzdC5zZWFyY2hQYXJhbXMuZ2V0KFwicGFnZVwiKSkudG9CZShcIjFcIik7XG4gICAgZXhwZWN0KGZpbHRlcmVkUmVxdWVzdC5zZWFyY2hQYXJhbXMuZ2V0KFwic2VhcmNoXCIpKS50b0JlKFwiRmlsdGVyZWQgcmVsZWFzZVwiKTtcbiAgICBleHBlY3QoZmlsdGVyZWRSZXF1ZXN0LnNlYXJjaFBhcmFtcy5nZXQoXCJzZXZlcml0eVwiKSkudG9CZShcInN1Y2Nlc3NcIik7XG4gIH0pO1xuXG4gIHRlc3QoXCJyZW5kZXJzIGFuIEFyYWJpYyBzb3VyY2UtYmFja2VkIEFJIGFuc3dlciB3aXRob3V0IGludGVybmFsIGRpYWdub3N0aWNzXCIsIGFzeW5jICh7XG4gICAgcGFnZSxcbiAgfSkgPT4ge1xuICAgIGNvbnN0IGZpeHR1cmUgPSBhd2FpdCBpbnN0YWxsQXJhYmljQWlGaXh0dXJlKHBhZ2UpO1xuICAgIGF3YWl0IGluc3RhbGxBcGlGaXh0dXJlcyhwYWdlLCB7IGFyYWJpY0FpOiBmaXh0dXJlIH0pO1xuICAgIGF3YWl0IHByb2dyYW1tYXRpY1NpZ25JbihwYWdlKTtcbiAgICBhd2FpdCBwYWdlLmdvdG8oYCR7REFTSEJPQVJEX1BBVEh9YWlgKTtcblxuICAgIGNvbnN0IGNvbXBvc2VyID0gcGFnZS5sb2NhdG9yKFwidGV4dGFyZWFcIikuZmlyc3QoKTtcbiAgICBhd2FpdCBleHBlY3QoY29tcG9zZXIpLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgY29tcG9zZXIuZmlsbChmaXh0dXJlLnF1ZXN0aW9uKTtcbiAgICBjb25zdCBzZW5kQnV0dG9uID0gY29tcG9zZXIubG9jYXRvcihcInhwYXRoPS4uXCIpLmdldEJ5Um9sZShcImJ1dHRvblwiKTtcbiAgICBhd2FpdCBleHBlY3Qoc2VuZEJ1dHRvbikudG9CZUVuYWJsZWQoKTtcbiAgICBjb25zdCBzdHJlYW1SZXNwb25zZVByb21pc2UgPSBwYWdlLndhaXRGb3JSZXNwb25zZSgocmVzcG9uc2UpID0+XG4gICAgICByZXNwb25zZS51cmwoKS5pbmNsdWRlcyhcIi9hcGkvYWkvY2hhdC9zdHJlYW1cIiksXG4gICAgKTtcbiAgICBhd2FpdCBzZW5kQnV0dG9uLmNsaWNrKCk7XG4gICAgY29uc3Qgc3RyZWFtUmVzcG9uc2UgPSBhd2FpdCBzdHJlYW1SZXNwb25zZVByb21pc2U7XG4gICAgZXhwZWN0KHN0cmVhbVJlc3BvbnNlLnN0YXR1cygpKS50b0JlKDIwMCk7XG5cbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChmaXh0dXJlLnF1ZXN0aW9uLCB7IGV4YWN0OiB0cnVlIH0pLmxhc3QoKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoZml4dHVyZS5hbnN3ZXIsIHsgZXhhY3Q6IHRydWUgfSkubGFzdCgpLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcIkFnZW50IGFjdGl2aXR5XCIsIHsgZXhhY3Q6IGZhbHNlIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBwYWdlLmxvY2F0b3IoXCJzdW1tYXJ5XCIpLmZpbHRlcih7IGhhc1RleHQ6IFwiQWdlbnQgYWN0aXZpdHlcIiB9KS5jbGljaygpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiUmVhZGluZyBzb3VyY2VcIiwgeyBleGFjdDogZmFsc2UgfSksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KGZpeHR1cmUuc291cmNlLCB7IGV4YWN0OiB0cnVlIH0pLmxhc3QoKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoL0JlaGF2aW9yIGV2aWRlbmNlIMK3IDEgZXhjZXJwdC9pKS5sYXN0KCksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2VcbiAgICAgICAgLmdldEJ5VGV4dCgncmV0dXJuIHBhcnRpYWxGcm9tQ29sbGVjdGVkRXZpZGVuY2UoXCJwcm92aWRlciB0aW1lb3V0XCIpOycsIHtcbiAgICAgICAgICBleGFjdDogdHJ1ZSxcbiAgICAgICAgfSlcbiAgICAgICAgLmxhc3QoKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG5cbiAgICBjb25zdCB2aXNpYmxlVGV4dCA9IGF3YWl0IHBhZ2UubG9jYXRvcihcImJvZHlcIikuaW5uZXJUZXh0KCk7XG4gICAgZXhwZWN0KHZpc2libGVUZXh0KS5ub3QudG9Db250YWluKFwiQ09NUExFVEVEXCIpO1xuICAgIGV4cGVjdCh2aXNpYmxlVGV4dCkubm90LnRvQ29udGFpbihcIlBlcnNpc3RlZCBleGVjdXRpb24gcHJvb2ZcIik7XG4gICAgZXhwZWN0KHZpc2libGVUZXh0KS50b0NvbnRhaW4oXCJOT1QgUFJPVkVOXCIpO1xuICB9KTtcblxuICB0ZXN0KFwia2VlcHMgdGhlIEFJIHNlc3Npb24gZHJhd2VyIG92ZXJsYWlkIG9uIGEgcGhvbmUgdmlld3BvcnQgd2l0aCBhY2NlcHRlZCBldmlkZW5jZVwiLCBhc3luYyAoe1xuICAgIHBhZ2UsXG4gIH0pID0+IHtcbiAgICBhd2FpdCBwYWdlLnNldFZpZXdwb3J0U2l6ZSh7IHdpZHRoOiAzOTAsIGhlaWdodDogODQ0IH0pO1xuICAgIGNvbnN0IGZpeHR1cmUgPSBhd2FpdCBpbnN0YWxsQXJhYmljQWlGaXh0dXJlKHBhZ2UpO1xuICAgIGF3YWl0IGluc3RhbGxBcGlGaXh0dXJlcyhwYWdlLCB7IGFyYWJpY0FpOiBmaXh0dXJlIH0pO1xuICAgIGF3YWl0IHByb2dyYW1tYXRpY1NpZ25JbihwYWdlKTtcbiAgICBhd2FpdCBwYWdlLmdvdG8oYCR7REFTSEJPQVJEX1BBVEh9YWlgKTtcblxuICAgIGNvbnN0IGNvbXBvc2VyID0gcGFnZS5sb2NhdG9yKFwidGV4dGFyZWFcIikuZmlyc3QoKTtcbiAgICBhd2FpdCBjb21wb3Nlci5maWxsKGZpeHR1cmUucXVlc3Rpb24pO1xuICAgIGF3YWl0IGNvbXBvc2VyLmxvY2F0b3IoXCJ4cGF0aD0uLlwiKS5nZXRCeVJvbGUoXCJidXR0b25cIikuY2xpY2soKTtcblxuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KGZpeHR1cmUuYW5zd2VyLCB7IGV4YWN0OiB0cnVlIH0pLmxhc3QoKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZVxuICAgICAgICAuZ2V0QnlUZXh0KGAke2ZpeHR1cmUuc291cmNlfTo0MmAsIHsgZXhhY3Q6IGZhbHNlIH0pXG4gICAgICAgIC5sYXN0KCksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IHBhZ2VcbiAgICAgIC5sb2NhdG9yKFwic3VtbWFyeVwiKVxuICAgICAgLmZpbHRlcih7IGhhc1RleHQ6IFwiQWdlbnQgYWN0aXZpdHlcIiB9KVxuICAgICAgLmxhc3QoKVxuICAgICAgLmNsaWNrKCk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcihcImJvZHlcIikpLnRvQ29udGFpblRleHQoXCJSZWFkaW5nIHNvdXJjZVwiKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKFwiYm9keVwiKSkudG9Db250YWluVGV4dChmaXh0dXJlLnNvdXJjZSk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcihcImJvZHlcIikpLnRvQ29udGFpblRleHQoXG4gICAgICBcIkFjY2VwdGVkOiBzb3VyY2Ugc3BhbiB2ZXJpZmllZC5cIixcbiAgICApO1xuICAgIGF3YWl0IGV4cGVjdE5vSG9yaXpvbnRhbE92ZXJmbG93KHBhZ2UpO1xuXG4gICAgY29uc3QgdmlzaWJsZVRleHQgPSBhd2FpdCBwYWdlLmxvY2F0b3IoXCJib2R5XCIpLmlubmVyVGV4dCgpO1xuICAgIGV4cGVjdCh2aXNpYmxlVGV4dCkubm90LnRvTWF0Y2goXG4gICAgICAvcmF3UHJvbXB0fHN5c3RlbVByb21wdHxwcm92aWRlciBkaWFnbm9zdGljc3xzb3VyY2Utd2luZG93fHJlY292ZXJ5IHByb21wdHxcXC9ob21lXFwvcnVubmVyL2ksXG4gICAgKTtcbiAgfSk7XG5cbiAgdGVzdChcImtlZXBzIHNhZmUgY2l0YXRpb24gc3RhdGUgYWNyb3NzIGJyb3dzZXIgYmFjayBhbmQgZm9yd2FyZCBuYXZpZ2F0aW9uIHdpdGggYmxvY2tlZCBldmlkZW5jZVwiLCBhc3luYyAoe1xuICAgIHBhZ2UsXG4gIH0pID0+IHtcbiAgICBjb25zdCBhY2NlcHRlZCA9IGF3YWl0IGluc3RhbGxBcmFiaWNBaUZpeHR1cmUocGFnZSwge1xuICAgICAgc2Vzc2lvbklkOiBcImUyZS1oaXN0b3J5LWFjY2VwdGVkLXNlc3Npb25cIixcbiAgICAgIHF1ZXN0aW9uOiBcItmF2Kcg2YfZiCDYs9mE2YjZgyDZhdmH2YTYqSBwcm92aWRlciDYudmG2K8g2KfZhNix2KzZiNi5INi52KjYsSDYs9is2YQg2KfZhNmF2KrYtdmB2K3Yn1wiLFxuICAgIH0pO1xuICAgIGNvbnN0IGJsb2NrZWQgPSBhd2FpdCBpbnN0YWxsQXJhYmljQWlGaXh0dXJlKHBhZ2UsIHtcbiAgICAgIGJsb2NrZWQ6IHRydWUsXG4gICAgICBzZXNzaW9uSWQ6IFwiZTJlLWhpc3RvcnktYmxvY2tlZC1zZXNzaW9uXCIsXG4gICAgICBxdWVzdGlvbjogXCLZhdinINmH2Ygg2KfZhNiv2YTZitmEINin2YTZhdit2KzZiNioINi52YbYryDYp9mE2LHYrNmI2Lkg2LnYqNixINiz2KzZhCDYp9mE2YXYqti12YHYrdifXCIsXG4gICAgfSk7XG4gICAgYXdhaXQgaW5zdGFsbEFwaUZpeHR1cmVzKHBhZ2UsIHtcbiAgICAgIGFyYWJpY0FpOiBhY2NlcHRlZCxcbiAgICAgIGFsdGVybmF0ZUFpOiBibG9ja2VkLFxuICAgIH0pO1xuICAgIGF3YWl0IHByb2dyYW1tYXRpY1NpZ25JbihwYWdlKTtcbiAgICBhd2FpdCBwYWdlLmdvdG8oYCR7REFTSEJPQVJEX1BBVEh9YWlgKTtcblxuICAgIGNvbnN0IGNvbXBvc2VyID0gcGFnZS5sb2NhdG9yKFwidGV4dGFyZWFcIikuZmlyc3QoKTtcbiAgICBhd2FpdCBjb21wb3Nlci5maWxsKGJsb2NrZWQucXVlc3Rpb24pO1xuICAgIGF3YWl0IGNvbXBvc2VyLmxvY2F0b3IoXCJ4cGF0aD0uLlwiKS5nZXRCeVJvbGUoXCJidXR0b25cIikuY2xpY2soKTtcblxuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KGJsb2NrZWQuYW5zd2VyLCB7IGV4YWN0OiB0cnVlIH0pLmxhc3QoKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgcGFnZVxuICAgICAgLmxvY2F0b3IoXCJzdW1tYXJ5XCIpXG4gICAgICAuZmlsdGVyKHsgaGFzVGV4dDogXCJBZ2VudCBhY3Rpdml0eVwiIH0pXG4gICAgICAubGFzdCgpXG4gICAgICAuY2xpY2soKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKFwiYm9keVwiKSkudG9Db250YWluVGV4dChcIlJlYWRpbmcgc291cmNlXCIpO1xuICAgIGNvbnN0IHZpc2libGVUZXh0ID0gYXdhaXQgcGFnZS5sb2NhdG9yKFwiYm9keVwiKS5pbm5lclRleHQoKTtcbiAgICBleHBlY3QodmlzaWJsZVRleHQpLm5vdC50b01hdGNoKFxuICAgICAgL3Jhd1Byb21wdHxzeXN0ZW1Qcm9tcHR8cHJvdmlkZXIgZGlhZ25vc3RpY3N8c291cmNlLXdpbmRvd3xyZWNvdmVyeSBwcm9tcHR8XFwvaG9tZVxcL3J1bm5lci9pLFxuICAgICk7XG4gIH0pO1xuXG4gIHRlc3QoXCJrZWVwcyBzYWZlIGNpdGF0aW9uIHN0YXRlIHdoZW4gc3dpdGNoaW5nIHByb2plY3RzXCIsIGFzeW5jICh7XG4gICAgcGFnZSxcbiAgfSkgPT4ge1xuICAgIGNvbnN0IGFjY2VwdGVkID0gYXdhaXQgaW5zdGFsbEFyYWJpY0FpRml4dHVyZShwYWdlLCB7XG4gICAgICBzZXNzaW9uSWQ6IFwiZTJlLWhpc3RvcnktYWNjZXB0ZWQtc2Vzc2lvblwiLFxuICAgICAgcXVlc3Rpb246IFwi2YXYpyDZh9mIINiz2YTZiNmDINmF2YfZhNipIHByb3ZpZGVyINi52YbYryDYp9mE2LHYrNmI2Lkg2LnYqNixINiz2KzZhCDYp9mE2YXYqti12YHYrdifXCIsXG4gICAgfSk7XG4gICAgY29uc3QgYmxvY2tlZCA9IGF3YWl0IGluc3RhbGxBcmFiaWNBaUZpeHR1cmUocGFnZSwge1xuICAgICAgYmxvY2tlZDogdHJ1ZSxcbiAgICAgIHNlc3Npb25JZDogXCJlMmUtaGlzdG9yeS1ibG9ja2VkLXNlc3Npb25cIixcbiAgICAgIHF1ZXN0aW9uOiBcItmF2Kcg2YfZiCDYp9mE2K/ZhNmK2YQg2KfZhNmF2K3YrNmI2Kgg2LnZhtivINin2YTYsdis2YjYuSDYudio2LEg2LPYrNmEINin2YTZhdiq2LXZgdit2J9cIixcbiAgICB9KTtcbiAgICBhd2FpdCBpbnN0YWxsQXBpRml4dHVyZXMocGFnZSwge1xuICAgICAgYXJhYmljQWk6IGFjY2VwdGVkLFxuICAgICAgYWx0ZXJuYXRlQWk6IGJsb2NrZWQsXG4gICAgICBwcm9qZWN0czogW1xuICAgICAgICB7XG4gICAgICAgICAgaWQ6IFwiZTJlLXByb2plY3Qtb25lXCIsXG4gICAgICAgICAgbmFtZTogXCJDaXRhdGlvbiBQcm9qZWN0IE9uZVwiLFxuICAgICAgICAgIGxhbmd1YWdlOiBcIlR5cGVTY3JpcHRcIixcbiAgICAgICAgICBmcmFtZXdvcms6IFwiUmVhY3RcIixcbiAgICAgICAgICBzdGF0dXM6IFwiYWN0aXZlXCIsXG4gICAgICAgICAgcm9vdFBhdGg6IFwiL2NvbnRyb2xsZWQvcHJvamVjdC1vbmVcIixcbiAgICAgICAgICBxdWFsaXR5U2NvcmU6IDkyLFxuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgaWQ6IFwiZTJlLXByb2plY3QtdHdvXCIsXG4gICAgICAgICAgbmFtZTogXCJDaXRhdGlvbiBQcm9qZWN0IFR3b1wiLFxuICAgICAgICAgIGxhbmd1YWdlOiBcIlR5cGVTY3JpcHRcIixcbiAgICAgICAgICBmcmFtZXdvcms6IFwiUmVhY3RcIixcbiAgICAgICAgICBzdGF0dXM6IFwiYWN0aXZlXCIsXG4gICAgICAgICAgcm9vdFBhdGg6IFwiL2NvbnRyb2xsZWQvcHJvamVjdC10d29cIixcbiAgICAgICAgICBxdWFsaXR5U2NvcmU6IDg4LFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICB9KTtcbiAgICBhd2FpdCBwcm9ncmFtbWF0aWNTaWduSW4ocGFnZSk7XG4gICAgYXdhaXQgcGFnZS5nb3RvKGAke0RBU0hCT0FSRF9QQVRIfWFpYCk7XG5cbiAgICBhd2FpdCBwYWdlXG4gICAgICAuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogYWNjZXB0ZWQucXVlc3Rpb24sIGV4YWN0OiB0cnVlIH0pXG4gICAgICAuY2xpY2soKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChhY2NlcHRlZC5hbnN3ZXIsIHsgZXhhY3Q6IHRydWUgfSkubGFzdCgpLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChgJHthY2NlcHRlZC5zb3VyY2V9OjQyYCwgeyBleGFjdDogZmFsc2UgfSkubGFzdCgpLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcIkFjY2VwdGVkOiBzb3VyY2Ugc3BhbiB2ZXJpZmllZC5cIiwgeyBleGFjdDogdHJ1ZSB9KS5sYXN0KCksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuXG4gICAgYXdhaXQgcGFnZS5nZXRCeVJvbGUoXCJjb21ib2JveFwiKS5zZWxlY3RPcHRpb24oXCJlMmUtcHJvamVjdC10d29cIik7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBibG9ja2VkLnF1ZXN0aW9uLCBleGFjdDogdHJ1ZSB9KSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlUZXh0KGFjY2VwdGVkLmFuc3dlciwgeyBleGFjdDogdHJ1ZSB9KSkudG9IYXZlQ291bnQoXG4gICAgICAwLFxuICAgICk7XG4gICAgYXdhaXQgcGFnZVxuICAgICAgLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IGJsb2NrZWQucXVlc3Rpb24sIGV4YWN0OiB0cnVlIH0pXG4gICAgICAuY2xpY2soKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlXG4gICAgICAgIC5nZXRCeVRleHQoXCJCbG9ja2VkOiBubyBtYXRjaGluZyBzb3VyY2UgdGV4dCB3YXMgZm91bmQuXCIsIHtcbiAgICAgICAgICBleGFjdDogdHJ1ZSxcbiAgICAgICAgfSlcbiAgICAgICAgLmxhc3QoKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoYCR7YmxvY2tlZC5zb3VyY2V9OjQyYCwgeyBleGFjdDogZmFsc2UgfSksXG4gICAgKS50b0hhdmVDb3VudCgwKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcIkFjY2VwdGVkOiBzb3VyY2Ugc3BhbiB2ZXJpZmllZC5cIiwgeyBleGFjdDogdHJ1ZSB9KSxcbiAgICApLnRvSGF2ZUNvdW50KDApO1xuXG4gICAgYXdhaXQgcGFnZS5nZXRCeVJvbGUoXCJjb21ib2JveFwiKS5zZWxlY3RPcHRpb24oXCJlMmUtcHJvamVjdC1vbmVcIik7XG4gICAgYXdhaXQgcGFnZVxuICAgICAgLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IGFjY2VwdGVkLnF1ZXN0aW9uLCBleGFjdDogdHJ1ZSB9KVxuICAgICAgLmNsaWNrKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoYCR7YWNjZXB0ZWQuc291cmNlfTo0MmAsIHsgZXhhY3Q6IGZhbHNlIH0pLmxhc3QoKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXCJBY2NlcHRlZDogc291cmNlIHNwYW4gdmVyaWZpZWQuXCIsIHsgZXhhY3Q6IHRydWUgfSkubGFzdCgpLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcIkJsb2NrZWQ6IG5vIG1hdGNoaW5nIHNvdXJjZSB0ZXh0IHdhcyBmb3VuZC5cIiwge1xuICAgICAgICBleGFjdDogdHJ1ZSxcbiAgICAgIH0pLFxuICAgICkudG9IYXZlQ291bnQoMCk7XG5cbiAgICBjb25zdCB2aXNpYmxlVGV4dCA9IGF3YWl0IHBhZ2UubG9jYXRvcihcImJvZHlcIikuaW5uZXJUZXh0KCk7XG4gICAgZXhwZWN0KHZpc2libGVUZXh0KS5ub3QudG9NYXRjaChcbiAgICAgIC9yYXdQcm9tcHR8c3lzdGVtUHJvbXB0fHByb3ZpZGVyIGRpYWdub3N0aWNzfHNvdXJjZS13aW5kb3d8cmVjb3ZlcnkgcHJvbXB0fFxcL2hvbWVcXC9ydW5uZXIvaSxcbiAgICApO1xuICB9KTtcblxuICB0ZXN0KFwia2VlcHMgc2FmZSBjaXRhdGlvbiBzdGF0ZSBhY3Jvc3MgcmVwZWF0ZWQgbmF2aWdhdGlvblwiLCBhc3luYyAoe1xuICAgIHBhZ2UsXG4gIH0pID0+IHtcbiAgICBjb25zdCBhY2NlcHRlZCA9IGF3YWl0IGluc3RhbGxBcmFiaWNBaUZpeHR1cmUocGFnZSwge1xuICAgICAgc2Vzc2lvbklkOiBcImUyZS1oaXN0b3J5LWFjY2VwdGVkLXNlc3Npb25cIixcbiAgICAgIHF1ZXN0aW9uOiBcItmF2Kcg2YfZiCDYs9mE2YjZgyDZhdmH2YTYqSBwcm92aWRlciDYudmG2K8g2KfZhNix2KzZiNi5INi52KjYsSDYs9is2YQg2KfZhNmF2KrYtdmB2K3Yn1wiLFxuICAgIH0pO1xuICAgIGNvbnN0IGJsb2NrZWQgPSBhd2FpdCBpbnN0YWxsQXJhYmljQWlGaXh0dXJlKHBhZ2UsIHtcbiAgICAgIGJsb2NrZWQ6IHRydWUsXG4gICAgICBzZXNzaW9uSWQ6IFwiZTJlLWhpc3RvcnktYmxvY2tlZC1zZXNzaW9uXCIsXG4gICAgICBxdWVzdGlvbjogXCLZhdinINmH2Ygg2KfZhNiv2YTZitmEINin2YTZhdit2KzZiNioINi52YbYryDYp9mE2LHYrNmI2Lkg2LnYqNixINiz2KzZhCDYp9mE2YXYqti12YHYrdifXCIsXG4gICAgfSk7XG4gICAgYXdhaXQgaW5zdGFsbEFwaUZpeHR1cmVzKHBhZ2UsIHtcbiAgICAgIGFyYWJpY0FpOiBhY2NlcHRlZCxcbiAgICAgIGFsdGVybmF0ZUFpOiBibG9ja2VkLFxuICAgIH0pO1xuICAgIGF3YWl0IHByb2dyYW1tYXRpY1NpZ25JbihwYWdlKTtcbiAgICBhd2FpdCBwYWdlLmdvdG8oYCR7REFTSEJPQVJEX1BBVEh9YWlgKTtcblxuICAgIGNvbnN0IGFzc2VydEFjY2VwdGVkQ2l0YXRpb24gPSBhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCBleHBlY3QoXG4gICAgICAgIHBhZ2UuZ2V0QnlUZXh0KGFjY2VwdGVkLmFuc3dlciwgeyBleGFjdDogdHJ1ZSB9KS5sYXN0KCksXG4gICAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgICBhd2FpdCBleHBlY3QoXG4gICAgICAgIHBhZ2UuZ2V0QnlUZXh0KGAke2FjY2VwdGVkLnNvdXJjZX06NDJgLCB7IGV4YWN0OiBmYWxzZSB9KS5sYXN0KCksXG4gICAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgICBhd2FpdCBleHBlY3QoXG4gICAgICAgIHBhZ2VcbiAgICAgICAgICAuZ2V0QnlUZXh0KFwiQWNjZXB0ZWQ6IHNvdXJjZSBzcGFuIHZlcmlmaWVkLlwiLCB7IGV4YWN0OiB0cnVlIH0pXG4gICAgICAgICAgLmxhc3QoKSxcbiAgICAgICkudG9CZVZpc2libGUoKTtcbiAgICAgIGF3YWl0IGV4cGVjdChcbiAgICAgICAgcGFnZS5nZXRCeVRleHQoXCJCbG9ja2VkOiBubyBtYXRjaGluZyBzb3VyY2UgdGV4dCB3YXMgZm91bmQuXCIsIHtcbiAgICAgICAgICBleGFjdDogdHJ1ZSxcbiAgICAgICAgfSksXG4gICAgICApLnRvSGF2ZUNvdW50KDApO1xuICAgIH07XG4gICAgY29uc3QgYXNzZXJ0QmxvY2tlZENpdGF0aW9uID0gYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgZXhwZWN0KFxuICAgICAgICBwYWdlXG4gICAgICAgICAgLmdldEJ5VGV4dChcIkJsb2NrZWQ6IG5vIG1hdGNoaW5nIHNvdXJjZSB0ZXh0IHdhcyBmb3VuZC5cIiwge1xuICAgICAgICAgICAgZXhhY3Q6IHRydWUsXG4gICAgICAgICAgfSlcbiAgICAgICAgICAubGFzdCgpLFxuICAgICAgKS50b0JlVmlzaWJsZSgpO1xuICAgICAgYXdhaXQgZXhwZWN0KFxuICAgICAgICBwYWdlLmdldEJ5VGV4dChgJHtibG9ja2VkLnNvdXJjZX06NDJgLCB7IGV4YWN0OiBmYWxzZSB9KSxcbiAgICAgICkudG9IYXZlQ291bnQoMCk7XG4gICAgICBhd2FpdCBleHBlY3QoXG4gICAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiQWNjZXB0ZWQ6IHNvdXJjZSBzcGFuIHZlcmlmaWVkLlwiLCB7IGV4YWN0OiB0cnVlIH0pLFxuICAgICAgKS50b0hhdmVDb3VudCgwKTtcbiAgICB9O1xuICAgIGNvbnN0IGFzc2VydE5vSW50ZXJuYWxDaXRhdGlvbkRldGFpbHMgPSBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCB2aXNpYmxlVGV4dCA9IGF3YWl0IHBhZ2UubG9jYXRvcihcImJvZHlcIikuaW5uZXJUZXh0KCk7XG4gICAgICBleHBlY3QodmlzaWJsZVRleHQpLm5vdC50b01hdGNoKFxuICAgICAgICAvTUlTU0lOR19MSVRFUkFMX01BVENIfHJhd1Byb21wdHxzeXN0ZW1Qcm9tcHR8cHJvdmlkZXIgZGlhZ25vc3RpY3N8c291cmNlLXdpbmRvd3xyZWNvdmVyeSBwcm9tcHR8XFwvaG9tZVxcL3J1bm5lci9pLFxuICAgICAgKTtcbiAgICB9O1xuXG4gICAgYXdhaXQgcGFnZVxuICAgICAgLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IGFjY2VwdGVkLnF1ZXN0aW9uLCBleGFjdDogdHJ1ZSB9KVxuICAgICAgLmNsaWNrKCk7XG4gICAgYXdhaXQgYXNzZXJ0QWNjZXB0ZWRDaXRhdGlvbigpO1xuXG4gICAgYXdhaXQgb3Blbk5hdmlnYXRpb24ocGFnZSwgXCJQcm9qZWN0c1wiLCBgJHtEQVNIQk9BUkRfUEFUSH1wcm9qZWN0c2ApO1xuICAgIGF3YWl0IHBhZ2UuZ29CYWNrKCk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UpLnRvSGF2ZVVSTChcbiAgICAgIG5ldyBSZWdFeHAoYCR7REFTSEJPQVJEX1BBVEgucmVwbGFjZUFsbChcIi9cIiwgXCJcXFxcL1wiKX1haSRgKSxcbiAgICApO1xuICAgIGF3YWl0IHBhZ2VcbiAgICAgIC5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBhY2NlcHRlZC5xdWVzdGlvbiwgZXhhY3Q6IHRydWUgfSlcbiAgICAgIC5jbGljaygpO1xuICAgIGF3YWl0IGFzc2VydEFjY2VwdGVkQ2l0YXRpb24oKTtcbiAgICBhd2FpdCBhc3NlcnROb0ludGVybmFsQ2l0YXRpb25EZXRhaWxzKCk7XG5cbiAgICBhd2FpdCBwYWdlLmdvRm9yd2FyZCgpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlKS50b0hhdmVVUkwoXG4gICAgICBuZXcgUmVnRXhwKGAke0RBU0hCT0FSRF9QQVRILnJlcGxhY2VBbGwoXCIvXCIsIFwiXFxcXC9cIil9cHJvamVjdHMkYCksXG4gICAgKTtcbiAgICBhd2FpdCBwYWdlLmdvQmFjaygpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlKS50b0hhdmVVUkwoXG4gICAgICBuZXcgUmVnRXhwKGAke0RBU0hCT0FSRF9QQVRILnJlcGxhY2VBbGwoXCIvXCIsIFwiXFxcXC9cIil9YWkkYCksXG4gICAgKTtcbiAgICBhd2FpdCBwYWdlXG4gICAgICAuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogYWNjZXB0ZWQucXVlc3Rpb24sIGV4YWN0OiB0cnVlIH0pXG4gICAgICAuY2xpY2soKTtcbiAgICBhd2FpdCBhc3NlcnRBY2NlcHRlZENpdGF0aW9uKCk7XG5cbiAgICBhd2FpdCBwYWdlXG4gICAgICAuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogYmxvY2tlZC5xdWVzdGlvbiwgZXhhY3Q6IHRydWUgfSlcbiAgICAgIC5jbGljaygpO1xuICAgIGF3YWl0IGFzc2VydEJsb2NrZWRDaXRhdGlvbigpO1xuXG4gICAgYXdhaXQgb3Blbk5hdmlnYXRpb24ocGFnZSwgXCJFdmVudCBTdHJlYW1cIiwgYCR7REFTSEJPQVJEX1BBVEh9ZXZlbnRzYCk7XG4gICAgYXdhaXQgcGFnZS5nb0JhY2soKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZSkudG9IYXZlVVJMKFxuICAgICAgbmV3IFJlZ0V4cChgJHtEQVNIQk9BUkRfUEFUSC5yZXBsYWNlQWxsKFwiL1wiLCBcIlxcXFwvXCIpfWFpJGApLFxuICAgICk7XG4gICAgYXdhaXQgcGFnZVxuICAgICAgLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IGJsb2NrZWQucXVlc3Rpb24sIGV4YWN0OiB0cnVlIH0pXG4gICAgICAuY2xpY2soKTtcbiAgICBhd2FpdCBhc3NlcnRCbG9ja2VkQ2l0YXRpb24oKTtcbiAgICBhd2FpdCBhc3NlcnROb0ludGVybmFsQ2l0YXRpb25EZXRhaWxzKCk7XG5cbiAgICBhd2FpdCBwYWdlLmdvRm9yd2FyZCgpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlKS50b0hhdmVVUkwoXG4gICAgICBuZXcgUmVnRXhwKGAke0RBU0hCT0FSRF9QQVRILnJlcGxhY2VBbGwoXCIvXCIsIFwiXFxcXC9cIil9ZXZlbnRzJGApLFxuICAgICk7XG4gICAgYXdhaXQgcGFnZS5nb0JhY2soKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZSkudG9IYXZlVVJMKFxuICAgICAgbmV3IFJlZ0V4cChgJHtEQVNIQk9BUkRfUEFUSC5yZXBsYWNlQWxsKFwiL1wiLCBcIlxcXFwvXCIpfWFpJGApLFxuICAgICk7XG4gICAgYXdhaXQgcGFnZVxuICAgICAgLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IGJsb2NrZWQucXVlc3Rpb24sIGV4YWN0OiB0cnVlIH0pXG4gICAgICAuY2xpY2soKTtcbiAgICBhd2FpdCBhc3NlcnRCbG9ja2VkQ2l0YXRpb24oKTtcbiAgICBhd2FpdCBhc3NlcnROb0ludGVybmFsQ2l0YXRpb25EZXRhaWxzKCk7XG4gIH0pO1xuXG4gIHRlc3QoXCJrZWVwcyBvbmx5IHRoZSBzYWZlIGJsb2NrZWQgY2l0YXRpb24gcmVhc29uIGFmdGVyIGNoYXQgcmVsb2FkXCIsIGFzeW5jICh7XG4gICAgcGFnZSxcbiAgfSkgPT4ge1xuICAgIGNvbnN0IGZpeHR1cmUgPSBpbnN0YWxsVG9vbEZhaWx1cmVGaXh0dXJlKCk7XG4gICAgYXdhaXQgaW5zdGFsbEFwaUZpeHR1cmVzKHBhZ2UsIHsgYXJhYmljQWk6IGZpeHR1cmUgfSk7XG4gICAgYXdhaXQgcHJvZ3JhbW1hdGljU2lnbkluKHBhZ2UpO1xuICAgIGF3YWl0IHBhZ2UuZ290byhgJHtEQVNIQk9BUkRfUEFUSH1haWApO1xuXG4gICAgY29uc3QgY29tcG9zZXIgPSBwYWdlLmxvY2F0b3IoXCJ0ZXh0YXJlYVwiKS5maXJzdCgpO1xuICAgIGF3YWl0IGNvbXBvc2VyLmZpbGwoZml4dHVyZS5xdWVzdGlvbik7XG4gICAgYXdhaXQgY29tcG9zZXIubG9jYXRvcihcInhwYXRoPS4uXCIpLmdldEJ5Um9sZShcImJ1dHRvblwiKS5jbGljaygpO1xuXG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoZml4dHVyZS5hbnN3ZXIsIHsgZXhhY3Q6IHRydWUgfSkubGFzdCgpLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlXG4gICAgICAgIC5nZXRCeVRleHQoXCJyZXF1aXJlZCB0b29sIGRpZCBub3QgY29tcGxldGUg4oCUIEJMT0NLRUQvSU5DT01QTEVURVwiLCB7XG4gICAgICAgICAgZXhhY3Q6IGZhbHNlLFxuICAgICAgICB9KVxuICAgICAgICAubGFzdCgpLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBwYWdlXG4gICAgICAubG9jYXRvcihcInN1bW1hcnlcIilcbiAgICAgIC5maWx0ZXIoeyBoYXNUZXh0OiBcIkFnZW50IGFjdGl2aXR5XCIgfSlcbiAgICAgIC5sYXN0KClcbiAgICAgIC5jbGljaygpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoXCJib2R5XCIpKS50b0NvbnRhaW5UZXh0KFwiUmVhZGluZyBzb3VyY2VcIik7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcihcImJvZHlcIikpLnRvQ29udGFpblRleHQoXG4gICAgICBcInNyYy9taXNzaW5nLXJlbGVhc2UtZml4dHVyZS50c1wiLFxuICAgICk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcihcImJvZHlcIikpLnRvQ29udGFpblRleHQoXCJUb29sIGZhaWxlZFwiKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKFwiYm9keVwiKSkudG9Db250YWluVGV4dChcIlRPT0xfRVhFQ1VUSU9OX0ZBSUxFRFwiKTtcbiAgICBjb25zdCB2aXNpYmxlVGV4dCA9IGF3YWl0IHBhZ2UubG9jYXRvcihcImJvZHlcIikuaW5uZXJUZXh0KCk7XG4gICAgZXhwZWN0KHZpc2libGVUZXh0KS5ub3QudG9Db250YWluKFwiQ09NUExFVEVEXCIpO1xuICAgIGV4cGVjdCh2aXNpYmxlVGV4dCkudG9Db250YWluKFwiUGVyc2lzdGVkIGV4ZWN1dGlvbiBwcm9vZlwiKTtcbiAgICBleHBlY3QodmlzaWJsZVRleHQpLnRvQ29udGFpbihcIlRoZSByZXF1aXJlZCBzb3VyY2UgcmVhZCBkaWQgbm90IGNvbXBsZXRlLlwiKTtcbiAgfSk7XG5cbiAgdGVzdChcImtlZXBzIHRoZSBmYWlsZWQgQUkgc2Vzc2lvbiBkcmF3ZXIgb3ZlcmxhaWQgb24gYSBwaG9uZSB2aWV3cG9ydFwiLCBhc3luYyAoe1xuICAgIHBhZ2UsXG4gIH0pID0+IHtcbiAgICBhd2FpdCBwYWdlLnNldFZpZXdwb3J0U2l6ZSh7IHdpZHRoOiAzOTAsIGhlaWdodDogODQ0IH0pO1xuICAgIGNvbnN0IGZpeHR1cmUgPSBpbnN0YWxsVG9vbEZhaWx1cmVGaXh0dXJlKCk7XG4gICAgYXdhaXQgaW5zdGFsbEFwaUZpeHR1cmVzKHBhZ2UsIHsgYXJhYmljQWk6IGZpeHR1cmUgfSk7XG4gICAgYXdhaXQgcHJvZ3JhbW1hdGljU2lnbkluKHBhZ2UpO1xuICAgIGF3YWl0IHBhZ2UuZ290byhgJHtEQVNIQk9BUkRfUEFUSH1haWApO1xuXG4gICAgY29uc3QgY29tcG9zZXIgPSBwYWdlLmxvY2F0b3IoXCJ0ZXh0YXJlYVwiKS5maXJzdCgpO1xuICAgIGF3YWl0IGNvbXBvc2VyLmZpbGwoZml4dHVyZS5xdWVzdGlvbik7XG4gICAgYXdhaXQgY29tcG9zZXIubG9jYXRvcihcInhwYXRoPS4uXCIpLmdldEJ5Um9sZShcImJ1dHRvblwiKS5jbGljaygpO1xuXG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoZml4dHVyZS5hbnN3ZXIsIHsgZXhhY3Q6IHRydWUgfSkubGFzdCgpLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlXG4gICAgICAgIC5nZXRCeVRleHQoXCJyZXF1aXJlZCB0b29sIGRpZCBub3QgY29tcGxldGUg4oCUIEJMT0NLRUQvSU5DT01QTEVURVwiLCB7XG4gICAgICAgICAgZXhhY3Q6IGZhbHNlLFxuICAgICAgICB9KVxuICAgICAgICAubGFzdCgpLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBwYWdlXG4gICAgICAubG9jYXRvcihcInN1bW1hcnlcIilcbiAgICAgIC5maWx0ZXIoeyBoYXNUZXh0OiBcIkFnZW50IGFjdGl2aXR5XCIgfSlcbiAgICAgIC5sYXN0KClcbiAgICAgIC5jbGljaygpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoXCJib2R5XCIpKS50b0NvbnRhaW5UZXh0KFwiUmVhZGluZyBzb3VyY2VcIik7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcihcImJvZHlcIikpLnRvQ29udGFpblRleHQoXG4gICAgICBcInNyYy9taXNzaW5nLXJlbGVhc2UtZml4dHVyZS50c1wiLFxuICAgICk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcihcImJvZHlcIikpLnRvQ29udGFpblRleHQoXCJUb29sIGZhaWxlZFwiKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKFwiYm9keVwiKSkudG9Db250YWluVGV4dChcIlRPT0xfRVhFQ1VUSU9OX0ZBSUxFRFwiKTtcbiAgICBjb25zdCB2aXNpYmxlVGV4dCA9IGF3YWl0IHBhZ2UubG9jYXRvcihcImJvZHlcIikuaW5uZXJUZXh0KCk7XG4gICAgZXhwZWN0KHZpc2libGVUZXh0KS5ub3QudG9NYXRjaChcbiAgICAgIC9yYXcgZXhjZXB0aW9ufHN0YWNrIHRyYWNlfFxcL2hvbWVcXC9ydW5uZXJ8c2VjcmV0fGZpeHR1cmUgZGlhZ25vc3RpYy9pLFxuICAgICk7XG5cbiAgICBhd2FpdCBleHBlY3ROb0hvcml6b250YWxPdmVyZmxvdyhwYWdlKTtcbiAgfSk7XG5cbiAgdGVzdChcInByZXNlcnZlcyBvbmUgcGFydGlhbCBhbnN3ZXIgYWZ0ZXIgYSBwcm92aWRlciBkaXNjb25uZWN0IGFuZCBtYXJrcyBpdCBpbmNvbXBsZXRlXCIsIGFzeW5jICh7XG4gICAgcGFnZSxcbiAgfSkgPT4ge1xuICAgIGNvbnN0IGZpeHR1cmUgPSBpbnN0YWxsRGlzY29ubmVjdGVkQWlGaXh0dXJlKCk7XG4gICAgYXdhaXQgaW5zdGFsbEFwaUZpeHR1cmVzKHBhZ2UsIHsgZGlzY29ubmVjdEFpOiBmaXh0dXJlIH0pO1xuICAgIGF3YWl0IHByb2dyYW1tYXRpY1NpZ25JbihwYWdlKTtcbiAgICBhd2FpdCBwYWdlLmdvdG8oYCR7REFTSEJPQVJEX1BBVEh9YWlgKTtcblxuICAgIGNvbnN0IGNvbXBvc2VyID0gcGFnZS5sb2NhdG9yKFwidGV4dGFyZWFcIikuZmlyc3QoKTtcbiAgICBhd2FpdCBjb21wb3Nlci5maWxsKGZpeHR1cmUucXVlc3Rpb24pO1xuICAgIGF3YWl0IGNvbXBvc2VyLmxvY2F0b3IoXCJ4cGF0aD0uLlwiKS5nZXRCeVJvbGUoXCJidXR0b25cIikuY2xpY2soKTtcblxuICAgIGNvbnN0IGFuc3dlciA9IHBhZ2UuZ2V0QnlUZXh0KGZpeHR1cmUuYW5zd2VyLCB7IGV4YWN0OiB0cnVlIH0pO1xuICAgIGF3YWl0IGV4cGVjdChhbnN3ZXIubGFzdCgpKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlLmdldEJ5VGV4dChcIklOQ09NUExFVEU6XCIsIHsgZXhhY3Q6IGZhbHNlIH0pKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwicHJvdmlkZXIgZmFpbHVyZVwiLCB7IGV4YWN0OiBmYWxzZSB9KS5sYXN0KCksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwic3RvcHBlZDogcHJvdmlkZXIgdGltZW91dFwiLCB7IGV4YWN0OiBmYWxzZSB9KS5sYXN0KCksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiVGhlIHByb3ZpZGVyIGRpc2Nvbm5lY3RlZCBhZnRlciB2aXNpYmxlIHJlc3BvbnNlIHRleHQuXCIsIHtcbiAgICAgICAgZXhhY3Q6IHRydWUsXG4gICAgICB9KSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG5cbiAgICBhd2FpdCBwYWdlLnJlbG9hZCgpO1xuICAgIGF3YWl0IHBhZ2VcbiAgICAgIC5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBmaXh0dXJlLnF1ZXN0aW9uLCBleGFjdDogdHJ1ZSB9KVxuICAgICAgLmNsaWNrKCk7XG5cbiAgICBhd2FpdCBleHBlY3QocGFnZS5nZXRCeVRleHQoZml4dHVyZS5hbnN3ZXIsIHsgZXhhY3Q6IHRydWUgfSkubGFzdCgpKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlLmdldEJ5VGV4dChcIklOQ09NUExFVEU6XCIsIHsgZXhhY3Q6IGZhbHNlIH0pKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwicHJvdmlkZXIgZmFpbHVyZVwiLCB7IGV4YWN0OiBmYWxzZSB9KS5sYXN0KCksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwic3RvcHBlZDogcHJvdmlkZXIgdGltZW91dFwiLCB7IGV4YWN0OiBmYWxzZSB9KS5sYXN0KCksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiVGhlIHByb3ZpZGVyIGRpc2Nvbm5lY3RlZCBhZnRlciB2aXNpYmxlIHJlc3BvbnNlIHRleHQuXCIsIHtcbiAgICAgICAgZXhhY3Q6IHRydWUsXG4gICAgICB9KSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gIH0pO1xuXG4gIHRlc3QoXCJyZXN1bWVzIGEgZmFpbGVkIGFuYWx5c2lzIGFuZCBrZWVwcyB0aGUgZXhlY3V0aW9uIGluY29tcGxldGVcIiwgYXN5bmMgKHtcbiAgICBwYWdlLFxuICB9KSA9PiB7XG4gICAgY29uc3QgeyBmaXh0dXJlLCBleGVjdXRpb24gfSA9IGluc3RhbGxSZXN1bWVkQW5hbHlzaXNGYWlsdXJlRml4dHVyZSgpO1xuICAgIGF3YWl0IGluc3RhbGxBcGlGaXh0dXJlcyhwYWdlLCB7XG4gICAgICBhcmFiaWNBaTogZml4dHVyZSxcbiAgICAgIHJlc3VtZUZhaWx1cmU6IHsgZml4dHVyZSwgZXhlY3V0aW9uIH0sXG4gICAgfSk7XG4gICAgYXdhaXQgcHJvZ3JhbW1hdGljU2lnbkluKHBhZ2UpO1xuXG4gICAgYXdhaXQgcGFnZS5ldmFsdWF0ZShcbiAgICAgICh7IHNlc3Npb25JZCwgZXhlY3V0aW9uSWQsIHByb2plY3RJZCwgcmVzdW1lVG9rZW4sIG1lc3NhZ2UgfSkgPT4ge1xuICAgICAgICBsb2NhbFN0b3JhZ2Uuc2V0SXRlbShcbiAgICAgICAgICBgZW9zX2FpX2V4ZWN1dGlvbl9jdXJyZW50XyR7cHJvamVjdElkfWAsXG4gICAgICAgICAgc2Vzc2lvbklkLFxuICAgICAgICApO1xuICAgICAgICBsb2NhbFN0b3JhZ2Uuc2V0SXRlbShcbiAgICAgICAgICBgZW9zX2FpX2V4ZWN1dGlvbl8ke3Byb2plY3RJZH1fJHtzZXNzaW9uSWR9YCxcbiAgICAgICAgICBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAgICBpZDogZXhlY3V0aW9uSWQsXG4gICAgICAgICAgICBwcm9qZWN0SWQsXG4gICAgICAgICAgICBzZXNzaW9uSWQsXG4gICAgICAgICAgICByZXN1bWVUb2tlbixcbiAgICAgICAgICAgIG1lc3NhZ2UsXG4gICAgICAgICAgfSksXG4gICAgICAgICk7XG4gICAgICB9LFxuICAgICAge1xuICAgICAgICBzZXNzaW9uSWQ6IGZpeHR1cmUuc2Vzc2lvbklkLFxuICAgICAgICBleGVjdXRpb25JZDogZml4dHVyZS5leGVjdXRpb25JZCxcbiAgICAgICAgcHJvamVjdElkOiBcImUyZS1wcm9qZWN0XCIsXG4gICAgICAgIHJlc3VtZVRva2VuOiBcImUyZS1yZXN1bWVkLWFuYWx5c2lzLWZhaWx1cmUtdG9rZW4tb3BhcXVlXCIsXG4gICAgICAgIG1lc3NhZ2U6IGZpeHR1cmUucXVlc3Rpb24sXG4gICAgICB9LFxuICAgICk7XG4gICAgYXdhaXQgcGFnZS5nb3RvKGAke0RBU0hCT0FSRF9QQVRIfWFpYCk7XG5cbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcIkEgc2F2ZWQgQUkgZXhlY3V0aW9uIGlzIHJlYWR5IHRvIHJlc3VtZVwiKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgY29uc3QgcmVzdW1lUmVxdWVzdCA9IHBhZ2Uud2FpdEZvclJlcXVlc3QoXG4gICAgICAocmVxdWVzdCkgPT5cbiAgICAgICAgcmVxdWVzdC51cmwoKS5pbmNsdWRlcyhcIi9hcGkvYWkvY2hhdC9zdHJlYW1cIikgJiZcbiAgICAgICAgcmVxdWVzdC5tZXRob2QoKSA9PT0gXCJQT1NUXCIsXG4gICAgKTtcbiAgICBhd2FpdCBwYWdlXG4gICAgICAuZ2V0QnlMYWJlbChcIkFnZW50IGV4ZWN1dGlvbiBwcm9vZlwiKVxuICAgICAgLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiUmVzdW1lXCIsIGV4YWN0OiB0cnVlIH0pXG4gICAgICAuY2xpY2soKTtcbiAgICBjb25zdCByZXF1ZXN0Qm9keSA9IEpTT04ucGFyc2UoXG4gICAgICAoYXdhaXQgcmVzdW1lUmVxdWVzdCkucG9zdERhdGEoKSA/PyBcInt9XCIsXG4gICAgKSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgICBleHBlY3QocmVxdWVzdEJvZHkpLnRvRXF1YWwoXG4gICAgICBleHBlY3Qub2JqZWN0Q29udGFpbmluZyh7XG4gICAgICAgIHByb2plY3RJZDogXCJlMmUtcHJvamVjdFwiLFxuICAgICAgICBzZXNzaW9uSWQ6IGZpeHR1cmUuc2Vzc2lvbklkLFxuICAgICAgICBleGVjdXRpb25JZDogZml4dHVyZS5leGVjdXRpb25JZCxcbiAgICAgICAgcmVzdW1lVG9rZW46IFwiZTJlLXJlc3VtZWQtYW5hbHlzaXMtZmFpbHVyZS10b2tlbi1vcGFxdWVcIixcbiAgICAgICAgbWVzc2FnZTogZml4dHVyZS5xdWVzdGlvbixcbiAgICAgIH0pLFxuICAgICk7XG5cbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcIkZhaWxlZCB0byBzZW5kIG1lc3NhZ2VcIiwgeyBleGFjdDogdHJ1ZSB9KSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXCJBIHNhdmVkIEFJIGV4ZWN1dGlvbiBpcyByZWFkeSB0byByZXN1bWVcIiksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGNvbnN0IHZpc2libGVUZXh0ID0gYXdhaXQgcGFnZS5sb2NhdG9yKFwiYm9keVwiKS5pbm5lclRleHQoKTtcbiAgICBleHBlY3QodmlzaWJsZVRleHQpLm5vdC50b0NvbnRhaW4oXCJDT01QTEVURURcIik7XG4gICAgZXhwZWN0KHZpc2libGVUZXh0KS5ub3QudG9Db250YWluKFwiUGVyc2lzdGVkIGV4ZWN1dGlvbiBwcm9vZlwiKTtcbiAgICBleHBlY3QodmlzaWJsZVRleHQpLnRvQ29udGFpbihcIlRoZSByZXF1aXJlZCBhbmFseXNpcyBkaWQgbm90IGNvbXBsZXRlLlwiKTtcbiAgfSk7XG5cbiAgdGVzdChcInJlY292ZXJzIGEgbWlzc2luZyB0b2tlbiBhZnRlciBhIHJlYWwgc3RyZWFtIGFib3J0IGFuZCByZXN1bWVzIG9uZSBleGVjdXRpb25cIiwgYXN5bmMgKHtcbiAgICBwYWdlLFxuICB9KSA9PiB7XG4gICAgY29uc3QgcmVjb3ZlcnkgPSBpbnN0YWxsSW50ZXJydXB0ZWRSZXN1bWVGaXh0dXJlKCk7XG4gICAgYXdhaXQgaW5zdGFsbEFwaUZpeHR1cmVzKHBhZ2UsIHsgaW50ZXJydXB0ZWRSZXN1bWU6IHJlY292ZXJ5IH0pO1xuICAgIGF3YWl0IHBhZ2UuYWRkSW5pdFNjcmlwdCgoKSA9PiB7XG4gICAgICBjb25zdCBuYXRpdmVGZXRjaCA9IHdpbmRvdy5mZXRjaC5iaW5kKHdpbmRvdyk7XG4gICAgICB3aW5kb3cuZmV0Y2ggPSBhc3luYyAoaW5wdXQsIGluaXQpID0+IHtcbiAgICAgICAgY29uc3QgdXJsID1cbiAgICAgICAgICB0eXBlb2YgaW5wdXQgPT09IFwic3RyaW5nXCJcbiAgICAgICAgICAgID8gaW5wdXRcbiAgICAgICAgICAgIDogaW5wdXQgaW5zdGFuY2VvZiBSZXF1ZXN0XG4gICAgICAgICAgICAgID8gaW5wdXQudXJsXG4gICAgICAgICAgICAgIDogU3RyaW5nKGlucHV0KTtcbiAgICAgICAgY29uc3QgYm9keSA9IHR5cGVvZiBpbml0Py5ib2R5ID09PSBcInN0cmluZ1wiID8gaW5pdC5ib2R5IDogXCJcIjtcbiAgICAgICAgaWYgKFxuICAgICAgICAgICF1cmwuaW5jbHVkZXMoXCIvYXBpL2FpL2NoYXQvc3RyZWFtXCIpIHx8XG4gICAgICAgICAgYm9keS5pbmNsdWRlcygnXCJleGVjdXRpb25JZFwiJylcbiAgICAgICAgKSB7XG4gICAgICAgICAgcmV0dXJuIG5hdGl2ZUZldGNoKGlucHV0LCBpbml0KTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgbmF0aXZlRmV0Y2goaW5wdXQsIGluaXQpO1xuICAgICAgICBpZiAoIXJlc3BvbnNlLmJvZHkpIHJldHVybiByZXNwb25zZTtcbiAgICAgICAgY29uc3QgcmVhZGVyID0gcmVzcG9uc2UuYm9keS5nZXRSZWFkZXIoKTtcbiAgICAgICAgY29uc3QgZW5jb2RlciA9IG5ldyBUZXh0RW5jb2RlcigpO1xuICAgICAgICBjb25zdCBzdHJlYW0gPSBuZXcgUmVhZGFibGVTdHJlYW0oe1xuICAgICAgICAgIGFzeW5jIHN0YXJ0KGNvbnRyb2xsZXIpIHtcbiAgICAgICAgICAgIGxldCBidWZmZXJlZCA9IFwiXCI7XG4gICAgICAgICAgICB3aGlsZSAodHJ1ZSkge1xuICAgICAgICAgICAgICBjb25zdCB7IGRvbmUsIHZhbHVlIH0gPSBhd2FpdCByZWFkZXIucmVhZCgpO1xuICAgICAgICAgICAgICBpZiAoZG9uZSkge1xuICAgICAgICAgICAgICAgIGlmIChidWZmZXJlZCkgY29udHJvbGxlci5lbnF1ZXVlKGVuY29kZXIuZW5jb2RlKGJ1ZmZlcmVkKSk7XG4gICAgICAgICAgICAgICAgY29udHJvbGxlci5jbG9zZSgpO1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICBidWZmZXJlZCArPSBuZXcgVGV4dERlY29kZXIoKS5kZWNvZGUodmFsdWUsIHsgc3RyZWFtOiB0cnVlIH0pO1xuICAgICAgICAgICAgICBjb25zdCBtYXJrZXIgPSBidWZmZXJlZC5pbmRleE9mKCdcInR5cGVcIjpcImV4ZWN1dGlvbl9zdGFydGVkXCInKTtcbiAgICAgICAgICAgICAgY29uc3QgZnJhbWVFbmQgPVxuICAgICAgICAgICAgICAgIG1hcmtlciA8IDAgPyAtMSA6IGJ1ZmZlcmVkLmluZGV4T2YoXCJcXG5cXG5cIiwgbWFya2VyKTtcbiAgICAgICAgICAgICAgaWYgKGZyYW1lRW5kID49IDApIHtcbiAgICAgICAgICAgICAgICBjb250cm9sbGVyLmVucXVldWUoXG4gICAgICAgICAgICAgICAgICBlbmNvZGVyLmVuY29kZShidWZmZXJlZC5zbGljZSgwLCBmcmFtZUVuZCArIDIpKSxcbiAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICAgIGNvbnRyb2xsZXIuZXJyb3IobmV3IFR5cGVFcnJvcihcIm5ldHdvcmsgY29ubmVjdGlvbiByZXNldFwiKSk7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSxcbiAgICAgICAgfSk7XG4gICAgICAgIHJldHVybiBuZXcgUmVzcG9uc2Uoc3RyZWFtLCB7XG4gICAgICAgICAgc3RhdHVzOiByZXNwb25zZS5zdGF0dXMsXG4gICAgICAgICAgc3RhdHVzVGV4dDogcmVzcG9uc2Uuc3RhdHVzVGV4dCxcbiAgICAgICAgICBoZWFkZXJzOiByZXNwb25zZS5oZWFkZXJzLFxuICAgICAgICB9KTtcbiAgICAgIH07XG4gICAgfSk7XG4gICAgYXdhaXQgcHJvZ3JhbW1hdGljU2lnbkluKHBhZ2UpO1xuICAgIGF3YWl0IHBhZ2UuZ290byhgJHtEQVNIQk9BUkRfUEFUSH1haWApO1xuXG4gICAgY29uc3Qgc3RyZWFtUmVxdWVzdHM6IEFycmF5PFJlY29yZDxzdHJpbmcsIHVua25vd24+PiA9IFtdO1xuICAgIHBhZ2Uub24oXCJyZXF1ZXN0XCIsIChyZXF1ZXN0KSA9PiB7XG4gICAgICBpZiAoXG4gICAgICAgIHJlcXVlc3QudXJsKCkuaW5jbHVkZXMoXCIvYXBpL2FpL2NoYXQvc3RyZWFtXCIpICYmXG4gICAgICAgIHJlcXVlc3QubWV0aG9kKCkgPT09IFwiUE9TVFwiXG4gICAgICApIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBzdHJlYW1SZXF1ZXN0cy5wdXNoKFxuICAgICAgICAgICAgcmVxdWVzdC5wb3N0RGF0YUpTT04oKSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPixcbiAgICAgICAgICApO1xuICAgICAgICB9IGNhdGNoIHtcbiAgICAgICAgICAvLyBJZ25vcmUgcmVxdWVzdHMgd2l0aG91dCBhIEpTT04gYm9keTsgdGhlIGFzc2VydGlvbnMgYmVsb3cgcmVxdWlyZVxuICAgICAgICAgIC8vIGJvdGggam91cm5leSByZXF1ZXN0cyB0byBoYXZlIGEgdmFsaWQgcmVxdWVzdCBlbnZlbG9wZS5cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0pO1xuXG4gICAgY29uc3QgY29tcG9zZXIgPSBwYWdlLmxvY2F0b3IoXCJ0ZXh0YXJlYVwiKS5maXJzdCgpO1xuICAgIGF3YWl0IGNvbXBvc2VyLmZpbGwocmVjb3ZlcnkuZml4dHVyZS5xdWVzdGlvbik7XG4gICAgYXdhaXQgY29tcG9zZXIubG9jYXRvcihcInhwYXRoPS4uXCIpLmdldEJ5Um9sZShcImJ1dHRvblwiKS5jbGljaygpO1xuXG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXG4gICAgICAgIFwiRXhlY3V0aW9uIHBhdXNlZCDigJQgcmVhZHkgdG8gcmVzdW1lIGZyb20gaXRzIGR1cmFibGUgY2hlY2twb2ludFwiLFxuICAgICAgICB7XG4gICAgICAgICAgZXhhY3Q6IHRydWUsXG4gICAgICAgIH0sXG4gICAgICApLFxuICAgICkudG9CZVZpc2libGUoKTtcblxuICAgIGNvbnN0IHN0b3JhZ2VLZXkgPVxuICAgICAgXCJlb3NfYWlfZXhlY3V0aW9uX2UyZS1wcm9qZWN0X2UyZS1pbnRlcnJ1cHRlZC1yZXN1bWUtc2Vzc2lvblwiO1xuICAgIGNvbnN0IHBvaW50ZXJLZXkgPSBcImVvc19haV9leGVjdXRpb25fY3VycmVudF9lMmUtcHJvamVjdFwiO1xuICAgIGF3YWl0IGV4cGVjdFxuICAgICAgLnBvbGwoKCkgPT4gcGFnZS5ldmFsdWF0ZSgoa2V5KSA9PiBsb2NhbFN0b3JhZ2UuZ2V0SXRlbShrZXkpLCBzdG9yYWdlS2V5KSlcbiAgICAgIC50b0NvbnRhaW4ocmVjb3ZlcnkuaW5pdGlhbFRva2VuKTtcblxuICAgIGF3YWl0IHBhZ2UuZXZhbHVhdGUoXG4gICAgICAoeyBzdG9yYWdlS2V5LCBwb2ludGVyS2V5IH0pID0+IHtcbiAgICAgICAgY29uc3Qgc2F2ZWQgPSBKU09OLnBhcnNlKGxvY2FsU3RvcmFnZS5nZXRJdGVtKHN0b3JhZ2VLZXkpID8/IFwie31cIik7XG4gICAgICAgIGRlbGV0ZSBzYXZlZC5yZXN1bWVUb2tlbjtcbiAgICAgICAgbG9jYWxTdG9yYWdlLnNldEl0ZW0oc3RvcmFnZUtleSwgSlNPTi5zdHJpbmdpZnkoc2F2ZWQpKTtcbiAgICAgICAgbG9jYWxTdG9yYWdlLnNldEl0ZW0ocG9pbnRlcktleSwgXCJlMmUtaW50ZXJydXB0ZWQtcmVzdW1lLXNlc3Npb25cIik7XG4gICAgICB9LFxuICAgICAgeyBzdG9yYWdlS2V5LCBwb2ludGVyS2V5IH0sXG4gICAgKTtcbiAgICBhd2FpdCBwYWdlLnJlbG9hZCgpO1xuXG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXCJBIHNhdmVkIEFJIGV4ZWN1dGlvbiBpcyByZWFkeSB0byByZXN1bWVcIiwge1xuICAgICAgICBleGFjdDogdHJ1ZSxcbiAgICAgIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3RcbiAgICAgIC5wb2xsKCgpID0+XG4gICAgICAgIHBhZ2UuZXZhbHVhdGUoKGtleSkgPT4ge1xuICAgICAgICAgIGNvbnN0IHNhdmVkID0gSlNPTi5wYXJzZShsb2NhbFN0b3JhZ2UuZ2V0SXRlbShrZXkpID8/IFwie31cIik7XG4gICAgICAgICAgcmV0dXJuIHNhdmVkLnJlc3VtZVRva2VuO1xuICAgICAgICB9LCBzdG9yYWdlS2V5KSxcbiAgICAgIClcbiAgICAgIC50b0JlKHJlY292ZXJ5LnJlY292ZXJlZFRva2VuKTtcblxuICAgIGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJSZXN1bWVcIiwgZXhhY3Q6IHRydWUgfSkuY2xpY2soKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChyZWNvdmVyeS5maXh0dXJlLmFuc3dlciwgeyBleGFjdDogdHJ1ZSB9KSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0LnBvbGwoKCkgPT4gc3RyZWFtUmVxdWVzdHMubGVuZ3RoKS50b0JlKDIpO1xuICAgIGV4cGVjdChzdHJlYW1SZXF1ZXN0c1swXSkudG9FcXVhbChcbiAgICAgIGV4cGVjdC5vYmplY3RDb250YWluaW5nKHtcbiAgICAgICAgcHJvamVjdElkOiBcImUyZS1wcm9qZWN0XCIsXG4gICAgICAgIG1lc3NhZ2U6IHJlY292ZXJ5LmZpeHR1cmUucXVlc3Rpb24sXG4gICAgICB9KSxcbiAgICApO1xuICAgIGV4cGVjdChzdHJlYW1SZXF1ZXN0c1swXT8uZXhlY3V0aW9uSWQpLnRvQmVVbmRlZmluZWQoKTtcbiAgICBleHBlY3Qoc3RyZWFtUmVxdWVzdHNbMF0/LnNlc3Npb25JZCkudG9CZVVuZGVmaW5lZCgpO1xuICAgIGV4cGVjdChzdHJlYW1SZXF1ZXN0c1sxXSkudG9FcXVhbChcbiAgICAgIGV4cGVjdC5vYmplY3RDb250YWluaW5nKHtcbiAgICAgICAgcHJvamVjdElkOiBcImUyZS1wcm9qZWN0XCIsXG4gICAgICAgIHNlc3Npb25JZDogcmVjb3ZlcnkuZml4dHVyZS5zZXNzaW9uSWQsXG4gICAgICAgIGV4ZWN1dGlvbklkOiByZWNvdmVyeS5maXh0dXJlLmV4ZWN1dGlvbklkLFxuICAgICAgICByZXN1bWVUb2tlbjogcmVjb3ZlcnkucmVjb3ZlcmVkVG9rZW4sXG4gICAgICAgIG1lc3NhZ2U6IHJlY292ZXJ5LmZpeHR1cmUucXVlc3Rpb24sXG4gICAgICB9KSxcbiAgICApO1xuICAgIGV4cGVjdChcbiAgICAgIHN0cmVhbVJlcXVlc3RzLm1hcCgocmVxdWVzdCkgPT4gcmVxdWVzdC5leGVjdXRpb25JZCkuZmlsdGVyKEJvb2xlYW4pLFxuICAgICkudG9FcXVhbChbcmVjb3ZlcnkuZml4dHVyZS5leGVjdXRpb25JZF0pO1xuICB9KTtcblxuICB0ZXN0KFwicHJvamVjdHMgZGVsaXZlcnkgcmVjb3Zlcnkgc3RhdGVzIHNhZmVseSBhZnRlciByZWxvYWRcIiwgYXN5bmMgKHtcbiAgICBwYWdlLFxuICB9KSA9PiB7XG4gICAgY29uc3QgcmVjb3ZlcnkgPSB7XG4gICAgICByZXF1ZXN0czogW10gYXMgc3RyaW5nW10sXG4gICAgICBvcGVyYXRpb25zOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBwcm9wb3NhbElkOiBcImUyZS1yZWNvdmVyeS1hdmFpbGFibGUtcHJvcG9zYWxcIixcbiAgICAgICAgICBvcGVyYXRpb25JZDogXCJlMmUtcmVjb3ZlcnktYXZhaWxhYmxlLW9wZXJhdGlvblwiLFxuICAgICAgICAgIHNlc3Npb25JZDogXCJlMmUtcmVjb3ZlcnktYXZhaWxhYmxlLXNlc3Npb25cIixcbiAgICAgICAgICBsaWZlY3ljbGU6IFwiYmxvY2tlZFwiLFxuICAgICAgICAgIHN0YXR1czogXCJwZW5kaW5nXCIsXG4gICAgICAgICAgY3JlYXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDM6MDAuMDAwWlwiLFxuICAgICAgICAgIHJlY292ZXJ5U3RhdGU6IFwicmVjb3ZlcmFibGVcIixcbiAgICAgICAgICBvcGVyYXRvckV4cGxhbmF0aW9uOlxuICAgICAgICAgICAgXCJUaGUgZGVsaXZlcnkgc3RvcHBlZCBiZWNhdXNlIHZhbGlkYXRpb24gbmVlZHMgdG8gYmUgcnVuIGFnYWluLlwiLFxuICAgICAgICAgIG5leHRBY3Rpb246XG4gICAgICAgICAgICBcIlJlc3VtZSB2YWxpZGF0aW9uIHRvIHJlLWNoZWNrIHRoZSBzYXZlZCBjaGFuZ2VzLCBvciBkaXNjYXJkIHRoaXMgcmVjb3ZlcnkgaWYgaXQgaXMgbm8gbG9uZ2VyIG5lZWRlZC5cIixcbiAgICAgICAgICBjb25mbGljdFJlYXNvbjogbnVsbCxcbiAgICAgICAgICB2YWxpZGF0aW9uRXZpZGVuY2U6IFt7IHByb2ZpbGU6IFwid29ya3NwYWNlLXR5cGVjaGVja1wiLCBzdGF0dXM6IFwiZmFpbGVkXCIgfV0sXG4gICAgICAgICAgd29ya3NwYWNlQXZhaWxhYmxlOiB0cnVlLFxuICAgICAgICAgIGNoYW5nZUNvdW50OiAyLFxuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgcHJvcG9zYWxJZDogXCJlMmUtcmVjb3ZlcnktbWlzc2luZy1wcm9wb3NhbFwiLFxuICAgICAgICAgIG9wZXJhdGlvbklkOiBcImUyZS1yZWNvdmVyeS1taXNzaW5nLW9wZXJhdGlvblwiLFxuICAgICAgICAgIHNlc3Npb25JZDogXCJlMmUtcmVjb3ZlcnktbWlzc2luZy1zZXNzaW9uXCIsXG4gICAgICAgICAgbGlmZWN5Y2xlOiBcImFiYW5kb25lZFwiLFxuICAgICAgICAgIHN0YXR1czogXCJwZW5kaW5nXCIsXG4gICAgICAgICAgY3JlYXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDI6MDAuMDAwWlwiLFxuICAgICAgICAgIHJlY292ZXJ5U3RhdGU6IFwibWlzc2luZ193b3Jrc3BhY2VcIixcbiAgICAgICAgICBvcGVyYXRvckV4cGxhbmF0aW9uOlxuICAgICAgICAgICAgXCJUaGUgc2F2ZWQgZGVsaXZlcnkgd29ya3NwYWNlIGlzIG5vIGxvbmdlciBhdmFpbGFibGUsIHNvIHJlY292ZXJ5IGNhbm5vdCBjb250aW51ZS5cIixcbiAgICAgICAgICBuZXh0QWN0aW9uOlxuICAgICAgICAgICAgXCJTdGFydCBhIG5ldyBkZWxpdmVyeSBmcm9tIHRoZSBjdXJyZW50IHByb2plY3QgcmF0aGVyIHRoYW4gcmV0cnlpbmcgdGhpcyByZWNvdmVyeS5cIixcbiAgICAgICAgICBjb25mbGljdFJlYXNvbjogXCJXb3Jrc3BhY2UgZXhwaXJlZCBhZnRlciB0aGUgcnVubmVyIHdhcyByZWN5Y2xlZC5cIixcbiAgICAgICAgICB2YWxpZGF0aW9uRXZpZGVuY2U6IG51bGwsXG4gICAgICAgICAgd29ya3NwYWNlQXZhaWxhYmxlOiBmYWxzZSxcbiAgICAgICAgICBjaGFuZ2VDb3VudDogMSxcbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgIHByb3Bvc2FsSWQ6IFwiZTJlLXJlY292ZXJ5LWRpc2NhcmRlZC1wcm9wb3NhbFwiLFxuICAgICAgICAgIG9wZXJhdGlvbklkOiBcImUyZS1yZWNvdmVyeS1kaXNjYXJkZWQtb3BlcmF0aW9uXCIsXG4gICAgICAgICAgc2Vzc2lvbklkOiBcImUyZS1yZWNvdmVyeS1kaXNjYXJkZWQtc2Vzc2lvblwiLFxuICAgICAgICAgIGxpZmVjeWNsZTogXCJjYW5jZWxsZWRcIixcbiAgICAgICAgICBzdGF0dXM6IFwicmVqZWN0ZWRcIixcbiAgICAgICAgICBjcmVhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMTowMC4wMDBaXCIsXG4gICAgICAgICAgcmVjb3ZlcnlTdGF0ZTogXCJkaXNjYXJkZWRcIixcbiAgICAgICAgICBvcGVyYXRvckV4cGxhbmF0aW9uOiBcIlRoaXMgZGVsaXZlcnkgcmVjb3Zlcnkgd2FzIGFscmVhZHkgZGlzY2FyZGVkLlwiLFxuICAgICAgICAgIG5leHRBY3Rpb246IFwiTm8gYWN0aW9uIGlzIHJlcXVpcmVkLlwiLFxuICAgICAgICAgIGNvbmZsaWN0UmVhc29uOiBcIkludGVybmFsIGRpYWdub3N0aWM6IHNob3VsZCBuZXZlciBiZSByZW5kZXJlZFwiLFxuICAgICAgICAgIHZhbGlkYXRpb25FdmlkZW5jZTogbnVsbCxcbiAgICAgICAgICB3b3Jrc3BhY2VBdmFpbGFibGU6IGZhbHNlLFxuICAgICAgICAgIGNoYW5nZUNvdW50OiAzLFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICB9O1xuICAgIGF3YWl0IGluc3RhbGxBcGlGaXh0dXJlcyhwYWdlLCB7IGRlbGl2ZXJ5UmVjb3Zlcnk6IHJlY292ZXJ5IH0pO1xuICAgIGF3YWl0IHByb2dyYW1tYXRpY1NpZ25JbihwYWdlKTtcbiAgICBhd2FpdCBwYWdlLmdvdG8oYCR7REFTSEJPQVJEX1BBVEh9YWlgKTtcblxuICAgIGNvbnN0IHJlZ2lvbiA9IHBhZ2UuZ2V0QnlSb2xlKFwicmVnaW9uXCIsIHtcbiAgICAgIG5hbWU6IFwiUmVjb3ZlcmFibGUgZGVsaXZlcnkgb3BlcmF0aW9uc1wiLFxuICAgIH0pO1xuICAgIGF3YWl0IGV4cGVjdChyZWdpb24pLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KHJlZ2lvbi5nZXRCeVRleHQoXCJSZWNvdmVyYWJsZVwiLCB7IGV4YWN0OiB0cnVlIH0pKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHJlZ2lvbi5nZXRCeVRleHQoXCJXb3Jrc3BhY2UgdW5hdmFpbGFibGVcIiwgeyBleGFjdDogdHJ1ZSB9KSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcmVnaW9uLmdldEJ5VGV4dChcIkFscmVhZHkgZGlzY2FyZGVkXCIsIHsgZXhhY3Q6IHRydWUgfSksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHJlZ2lvbi5nZXRCeVRleHQoXG4gICAgICAgIFwiVGhlIHNhdmVkIGRlbGl2ZXJ5IHdvcmtzcGFjZSBpcyBubyBsb25nZXIgYXZhaWxhYmxlLCBzbyByZWNvdmVyeSBjYW5ub3QgY29udGludWUuXCIsXG4gICAgICAgIHsgZXhhY3Q6IHRydWUgfSxcbiAgICAgICksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHJlZ2lvbi5nZXRCeVRleHQoXCJUaGlzIGRlbGl2ZXJ5IHJlY292ZXJ5IHdhcyBhbHJlYWR5IGRpc2NhcmRlZC5cIiwge1xuICAgICAgICBleGFjdDogdHJ1ZSxcbiAgICAgIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICByZWdpb24uZ2V0QnlUZXh0KFxuICAgICAgICBcIlJldGFpbmVkIHJlYXNvbjogV29ya3NwYWNlIGV4cGlyZWQgYWZ0ZXIgdGhlIHJ1bm5lciB3YXMgcmVjeWNsZWQuXCIsXG4gICAgICAgIHsgZXhhY3Q6IHRydWUgfSxcbiAgICAgICksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuXG4gICAgY29uc3QgYXZhaWxhYmxlID0gcmVnaW9uLmxvY2F0b3IoXG4gICAgICAnW2RhdGEtb3BlcmF0aW9uLWlkPVwiZTJlLXJlY292ZXJ5LWF2YWlsYWJsZS1vcGVyYXRpb25cIl0nLFxuICAgICk7XG4gICAgY29uc3QgbWlzc2luZyA9IHJlZ2lvbi5sb2NhdG9yKFxuICAgICAgJ1tkYXRhLW9wZXJhdGlvbi1pZD1cImUyZS1yZWNvdmVyeS1taXNzaW5nLW9wZXJhdGlvblwiXScsXG4gICAgKTtcbiAgICBjb25zdCBkaXNjYXJkZWQgPSByZWdpb24ubG9jYXRvcihcbiAgICAgICdbZGF0YS1vcGVyYXRpb24taWQ9XCJlMmUtcmVjb3ZlcnktZGlzY2FyZGVkLW9wZXJhdGlvblwiXScsXG4gICAgKTtcbiAgICBhd2FpdCBleHBlY3QoYXZhaWxhYmxlKS50b0hhdmVBdHRyaWJ1dGUoXG4gICAgICBcImRhdGEtcmVjb3Zlcnktc3RhdGVcIixcbiAgICAgIFwicmVjb3ZlcmFibGVcIixcbiAgICApO1xuICAgIGF3YWl0IGV4cGVjdChtaXNzaW5nKS50b0hhdmVBdHRyaWJ1dGUoXG4gICAgICBcImRhdGEtcmVjb3Zlcnktc3RhdGVcIixcbiAgICAgIFwibWlzc2luZ193b3Jrc3BhY2VcIixcbiAgICApO1xuICAgIGF3YWl0IGV4cGVjdChkaXNjYXJkZWQpLnRvSGF2ZUF0dHJpYnV0ZShcbiAgICAgIFwiZGF0YS1yZWNvdmVyeS1zdGF0ZVwiLFxuICAgICAgXCJkaXNjYXJkZWRcIixcbiAgICApO1xuICAgIGF3YWl0IGV4cGVjdChhdmFpbGFibGUuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJSZXN1bWUgdmFsaWRhdGlvblwiIH0pKS50b0JlRW5hYmxlZCgpO1xuICAgIGF3YWl0IGV4cGVjdChhdmFpbGFibGUuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJEaXNjYXJkIHdvcmtzcGFjZVwiIH0pKS50b0JlRW5hYmxlZCgpO1xuICAgIGF3YWl0IGV4cGVjdChtaXNzaW5nLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiUmVzdW1lIHZhbGlkYXRpb25cIiB9KSkudG9CZURpc2FibGVkKCk7XG4gICAgYXdhaXQgZXhwZWN0KG1pc3NpbmcuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJEaXNjYXJkIHdvcmtzcGFjZVwiIH0pKS50b0JlRGlzYWJsZWQoKTtcbiAgICBhd2FpdCBleHBlY3QoZGlzY2FyZGVkLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiUmVzdW1lIHZhbGlkYXRpb25cIiB9KSkudG9CZURpc2FibGVkKCk7XG4gICAgYXdhaXQgZXhwZWN0KGRpc2NhcmRlZC5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIkRpc2NhcmQgd29ya3NwYWNlXCIgfSkpLnRvQmVEaXNhYmxlZCgpO1xuXG4gICAgY29uc3QgdmlzaWJsZVRleHQgPSBhd2FpdCBwYWdlLmxvY2F0b3IoXCJib2R5XCIpLmlubmVyVGV4dCgpO1xuICAgIGV4cGVjdCh2aXNpYmxlVGV4dCkubm90LnRvTWF0Y2goXG4gICAgICAvXFwvaG9tZVxcL3J1bm5lcnxcXC90bXBcXC98XFwvd29ya3NwYWNlXFwvfGludGVybmFsIGRpYWdub3N0aWMvaSxcbiAgICApO1xuICAgIGF3YWl0IGV4cGVjdE5vSG9yaXpvbnRhbE92ZXJmbG93KHBhZ2UpO1xuXG4gICAgYXdhaXQgcGFnZS5yZWxvYWQoKTtcbiAgICBjb25zdCByZWxvYWRlZFJlZ2lvbiA9IHBhZ2UuZ2V0QnlSb2xlKFwicmVnaW9uXCIsIHtcbiAgICAgIG5hbWU6IFwiUmVjb3ZlcmFibGUgZGVsaXZlcnkgb3BlcmF0aW9uc1wiLFxuICAgIH0pO1xuICAgIGF3YWl0IGV4cGVjdChyZWxvYWRlZFJlZ2lvbikudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICByZWxvYWRlZFJlZ2lvblxuICAgICAgICAubG9jYXRvcignW2RhdGEtb3BlcmF0aW9uLWlkPVwiZTJlLXJlY292ZXJ5LW1pc3Npbmctb3BlcmF0aW9uXCJdJylcbiAgICAgICAgLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiUmVzdW1lIHZhbGlkYXRpb25cIiB9KSxcbiAgICApLnRvQmVEaXNhYmxlZCgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHJlbG9hZGVkUmVnaW9uXG4gICAgICAgIC5sb2NhdG9yKCdbZGF0YS1vcGVyYXRpb24taWQ9XCJlMmUtcmVjb3ZlcnktZGlzY2FyZGVkLW9wZXJhdGlvblwiXScpXG4gICAgICAgIC5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIkRpc2NhcmQgd29ya3NwYWNlXCIgfSksXG4gICAgKS50b0JlRGlzYWJsZWQoKTtcbiAgICBleHBlY3QocmVjb3ZlcnkucmVxdWVzdHMubGVuZ3RoKS50b0JlR3JlYXRlclRoYW5PckVxdWFsKDIpO1xuICAgIGV4cGVjdChyZWNvdmVyeS5yZXF1ZXN0cy5ldmVyeSgodXJsKSA9PiB1cmwuaW5jbHVkZXMoXCJwcm9qZWN0SWQ9ZTJlLXByb2plY3RcIikpKS50b0JlKHRydWUpO1xuICB9KTtcblxuICB0ZXN0KFwiZXhwbGFpbnMgd2hlbiBkZWxpdmVyeSByZWNvdmVyeSBsb3NlcyBhIHJhY2UgYW5kIHJlZnJlc2hlcyBzdGF0ZVwiLCBhc3luYyAoe1xuICAgIHBhZ2UsXG4gIH0pID0+IHtcbiAgICBjb25zdCByZWNvdmVyeSA9IHtcbiAgICAgIHJlcXVlc3RzOiBbXSBhcyBzdHJpbmdbXSxcbiAgICAgIGFjdGlvblJlcXVlc3RzOiBbXSBhcyBzdHJpbmdbXSxcbiAgICAgIG9wZXJhdGlvbnM6IFtcbiAgICAgICAge1xuICAgICAgICAgIHByb3Bvc2FsSWQ6IFwiZTJlLXJlY292ZXJ5LXJhY2UtcHJvcG9zYWxcIixcbiAgICAgICAgICBvcGVyYXRpb25JZDogXCJlMmUtcmVjb3ZlcnktcmFjZS1vcGVyYXRpb25cIixcbiAgICAgICAgICBzZXNzaW9uSWQ6IFwiZTJlLXJlY292ZXJ5LXJhY2Utc2Vzc2lvblwiLFxuICAgICAgICAgIGxpZmVjeWNsZTogXCJibG9ja2VkXCIsXG4gICAgICAgICAgc3RhdHVzOiBcInBlbmRpbmdcIixcbiAgICAgICAgICBjcmVhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowNDowMC4wMDBaXCIsXG4gICAgICAgICAgcmVjb3ZlcnlTdGF0ZTogXCJyZWNvdmVyYWJsZVwiLFxuICAgICAgICAgIG9wZXJhdG9yRXhwbGFuYXRpb246XG4gICAgICAgICAgICBcIlRoZSBkZWxpdmVyeSBzdG9wcGVkIGJlY2F1c2UgdGhlIHJldGFpbmVkIGNoYW5nZXMgbmVlZCByZXZpZXcgYmVmb3JlIHZhbGlkYXRpb24gY2FuIGNvbnRpbnVlLlwiLFxuICAgICAgICAgIG5leHRBY3Rpb246XG4gICAgICAgICAgICBcIlJlc3VtZSB2YWxpZGF0aW9uIHRvIHJlLWNoZWNrIHRoZSBzYXZlZCBjaGFuZ2VzLCBvciBkaXNjYXJkIHRoaXMgcmVjb3ZlcnkgaWYgaXQgaXMgbm8gbG9uZ2VyIG5lZWRlZC5cIixcbiAgICAgICAgICBjb25mbGljdFJlYXNvbjogbnVsbCxcbiAgICAgICAgICB2YWxpZGF0aW9uRXZpZGVuY2U6IFt7IHByb2ZpbGU6IFwid29ya3NwYWNlLXR5cGVjaGVja1wiLCBzdGF0dXM6IFwiZmFpbGVkXCIgfV0sXG4gICAgICAgICAgd29ya3NwYWNlQXZhaWxhYmxlOiB0cnVlLFxuICAgICAgICAgIGNoYW5nZUNvdW50OiAxLFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICAgIHJlY292ZXJ5QWN0aW9uOiB7XG4gICAgICAgIHByb3Bvc2FsSWQ6IFwiZTJlLXJlY292ZXJ5LXJhY2UtcHJvcG9zYWxcIixcbiAgICAgICAgYWN0aW9uOiBcInJlc3VtZS12YWxpZGF0aW9uXCIgYXMgY29uc3QsXG4gICAgICAgIHJlc3BvbnNlOiB7XG4gICAgICAgICAgZXJyb3I6IFwiVGhpcyBkZWxpdmVyeSByZWNvdmVyeSB3YXMgYWxyZWFkeSBkaXNjYXJkZWQuXCIsXG4gICAgICAgICAgY29kZTogXCJERUxJVkVSWV9BTFJFQURZX0RJU0NBUkRFRFwiLFxuICAgICAgICAgIGxpZmVjeWNsZTogXCJjYW5jZWxsZWRcIixcbiAgICAgICAgICByZWNvdmVyeVN0YXRlOiBcImRpc2NhcmRlZFwiLFxuICAgICAgICAgIG5leHRBY3Rpb246IFwiTm8gYWN0aW9uIGlzIHJlcXVpcmVkLlwiLFxuICAgICAgICAgIGRpYWdub3N0aWM6IFwiRG8gbm90IHJlbmRlciB0aGlzIHNlcnZlciBkZXRhaWwuXCIsXG4gICAgICAgIH0sXG4gICAgICAgIG5leHRPcGVyYXRpb25zOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgcHJvcG9zYWxJZDogXCJlMmUtcmVjb3ZlcnktcmFjZS1wcm9wb3NhbFwiLFxuICAgICAgICAgICAgb3BlcmF0aW9uSWQ6IFwiZTJlLXJlY292ZXJ5LXJhY2Utb3BlcmF0aW9uXCIsXG4gICAgICAgICAgICBzZXNzaW9uSWQ6IFwiZTJlLXJlY292ZXJ5LXJhY2Utc2Vzc2lvblwiLFxuICAgICAgICAgICAgbGlmZWN5Y2xlOiBcImNhbmNlbGxlZFwiLFxuICAgICAgICAgICAgc3RhdHVzOiBcInJlamVjdGVkXCIsXG4gICAgICAgICAgICBjcmVhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowNDowMC4wMDBaXCIsXG4gICAgICAgICAgICByZWNvdmVyeVN0YXRlOiBcImRpc2NhcmRlZFwiLFxuICAgICAgICAgICAgb3BlcmF0b3JFeHBsYW5hdGlvbjogXCJUaGlzIGRlbGl2ZXJ5IHJlY292ZXJ5IHdhcyBhbHJlYWR5IGRpc2NhcmRlZC5cIixcbiAgICAgICAgICAgIG5leHRBY3Rpb246IFwiTm8gYWN0aW9uIGlzIHJlcXVpcmVkLlwiLFxuICAgICAgICAgICAgY29uZmxpY3RSZWFzb246IG51bGwsXG4gICAgICAgICAgICB2YWxpZGF0aW9uRXZpZGVuY2U6IG51bGwsXG4gICAgICAgICAgICB3b3Jrc3BhY2VBdmFpbGFibGU6IGZhbHNlLFxuICAgICAgICAgICAgY2hhbmdlQ291bnQ6IDEsXG4gICAgICAgICAgfSxcbiAgICAgICAgXSxcbiAgICAgIH0sXG4gICAgfTtcbiAgICBhd2FpdCBpbnN0YWxsQXBpRml4dHVyZXMocGFnZSwgeyBkZWxpdmVyeVJlY292ZXJ5OiByZWNvdmVyeSB9KTtcbiAgICBhd2FpdCBwcm9ncmFtbWF0aWNTaWduSW4ocGFnZSk7XG4gICAgYXdhaXQgcGFnZS5nb3RvKGAke0RBU0hCT0FSRF9QQVRIfWFpYCk7XG5cbiAgICBjb25zdCByZWdpb24gPSBwYWdlLmdldEJ5Um9sZShcInJlZ2lvblwiLCB7XG4gICAgICBuYW1lOiBcIlJlY292ZXJhYmxlIGRlbGl2ZXJ5IG9wZXJhdGlvbnNcIixcbiAgICB9KTtcbiAgICBjb25zdCBvcGVyYXRpb24gPSByZWdpb24ubG9jYXRvcihcbiAgICAgICdbZGF0YS1vcGVyYXRpb24taWQ9XCJlMmUtcmVjb3ZlcnktcmFjZS1vcGVyYXRpb25cIl0nLFxuICAgICk7XG4gICAgYXdhaXQgZXhwZWN0KG9wZXJhdGlvbi5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIlJlc3VtZSB2YWxpZGF0aW9uXCIgfSkpLnRvQmVFbmFibGVkKCk7XG4gICAgYXdhaXQgb3BlcmF0aW9uLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiUmVzdW1lIHZhbGlkYXRpb25cIiB9KS5jbGljaygpO1xuXG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlUZXh0KFwiUmVjb3Zlcnkgc3RhdGUgY2hhbmdlZFwiLCB7IGV4YWN0OiB0cnVlIH0pKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFxuICAgICAgICBcIlRoaXMgcmVjb3Zlcnkgd2FzIGFscmVhZHkgZGlzY2FyZGVkLiBUaGUgcmVjb3ZlcnkgbGlzdCB3YXMgcmVmcmVzaGVkLlwiLFxuICAgICAgICB7IGV4YWN0OiB0cnVlIH0sXG4gICAgICApLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3RcbiAgICAgIC5wb2xsKCgpID0+IHJlY292ZXJ5LnJlcXVlc3RzLmxlbmd0aClcbiAgICAgIC50b0JlR3JlYXRlclRoYW5PckVxdWFsKDIpO1xuICAgIGF3YWl0IGV4cGVjdChvcGVyYXRpb24pLnRvSGF2ZUF0dHJpYnV0ZShcImRhdGEtcmVjb3Zlcnktc3RhdGVcIiwgXCJkaXNjYXJkZWRcIik7XG4gICAgZXhwZWN0KHJlY292ZXJ5LmFjdGlvblJlcXVlc3RzKS50b0hhdmVMZW5ndGgoMSk7XG4gICAgZXhwZWN0KHJlY292ZXJ5LmFjdGlvblJlcXVlc3RzWzBdKS50b0NvbnRhaW4oXG4gICAgICBcIi9hcGkvYWkvZGVsaXZlcnkvZTJlLXJlY292ZXJ5LXJhY2UtcHJvcG9zYWwvcmVzdW1lLXZhbGlkYXRpb25cIixcbiAgICApO1xuICAgIGV4cGVjdChhd2FpdCByZWdpb24ubG9jYXRvcignW2RhdGEtb3BlcmF0aW9uLWlkPVwiZTJlLXJlY292ZXJ5LXJhY2Utb3BlcmF0aW9uXCJdJykuY291bnQoKSkudG9CZSgxKTtcbiAgICBjb25zdCB2aXNpYmxlVGV4dCA9IGF3YWl0IHBhZ2UubG9jYXRvcihcImJvZHlcIikuaW5uZXJUZXh0KCk7XG4gICAgZXhwZWN0KHZpc2libGVUZXh0KS5ub3QudG9NYXRjaCgvRG8gbm90IHJlbmRlciB0aGlzIHNlcnZlciBkZXRhaWx8XFwvaG9tZVxcL3J1bm5lcnxcXC90bXBcXC8vaSk7XG4gICAgYXdhaXQgZXhwZWN0Tm9Ib3Jpem9udGFsT3ZlcmZsb3cocGFnZSk7XG4gIH0pO1xuXG4gIHRlc3QoXCJleHBsYWlucyB3aGVuIGFuIG9sZCByZWNvdmVyeSBsaW5rIHBvaW50cyB0byBhIGRlbGV0ZWQgb3BlcmF0aW9uXCIsIGFzeW5jICh7XG4gICAgcGFnZSxcbiAgfSkgPT4ge1xuICAgIGNvbnN0IHJlY292ZXJ5ID0ge1xuICAgICAgcmVxdWVzdHM6IFtdIGFzIHN0cmluZ1tdLFxuICAgICAgYWN0aW9uUmVxdWVzdHM6IFtdIGFzIHN0cmluZ1tdLFxuICAgICAgb3BlcmF0aW9uczogW1xuICAgICAgICB7XG4gICAgICAgICAgcHJvcG9zYWxJZDogXCJlMmUtcmVjb3ZlcnktZGVsZXRlZC1wcm9wb3NhbFwiLFxuICAgICAgICAgIG9wZXJhdGlvbklkOiBcImUyZS1yZWNvdmVyeS1kZWxldGVkLW9wZXJhdGlvblwiLFxuICAgICAgICAgIHNlc3Npb25JZDogXCJlMmUtcmVjb3ZlcnktZGVsZXRlZC1zZXNzaW9uXCIsXG4gICAgICAgICAgbGlmZWN5Y2xlOiBcImJsb2NrZWRcIixcbiAgICAgICAgICBzdGF0dXM6IFwicGVuZGluZ1wiLFxuICAgICAgICAgIGNyZWF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjA1OjAwLjAwMFpcIixcbiAgICAgICAgICByZWNvdmVyeVN0YXRlOiBcInJlY292ZXJhYmxlXCIsXG4gICAgICAgICAgb3BlcmF0b3JFeHBsYW5hdGlvbjpcbiAgICAgICAgICAgIFwiVGhlIGRlbGl2ZXJ5IHN0b3BwZWQgYmVjYXVzZSB0aGUgcmV0YWluZWQgY2hhbmdlcyBuZWVkIHJldmlldyBiZWZvcmUgdmFsaWRhdGlvbiBjYW4gY29udGludWUuXCIsXG4gICAgICAgICAgbmV4dEFjdGlvbjpcbiAgICAgICAgICAgIFwiUmVzdW1lIHZhbGlkYXRpb24gdG8gcmUtY2hlY2sgdGhlIHNhdmVkIGNoYW5nZXMsIG9yIGRpc2NhcmQgdGhpcyByZWNvdmVyeSBpZiBpdCBpcyBubyBsb25nZXIgbmVlZGVkLlwiLFxuICAgICAgICAgIGNvbmZsaWN0UmVhc29uOiBudWxsLFxuICAgICAgICAgIHZhbGlkYXRpb25FdmlkZW5jZTogW3sgcHJvZmlsZTogXCJ3b3Jrc3BhY2UtdHlwZWNoZWNrXCIsIHN0YXR1czogXCJmYWlsZWRcIiB9XSxcbiAgICAgICAgICB3b3Jrc3BhY2VBdmFpbGFibGU6IHRydWUsXG4gICAgICAgICAgY2hhbmdlQ291bnQ6IDEsXG4gICAgICAgIH0sXG4gICAgICBdLFxuICAgICAgcmVjb3ZlcnlBY3Rpb246IHtcbiAgICAgICAgcHJvcG9zYWxJZDogXCJlMmUtcmVjb3ZlcnktZGVsZXRlZC1wcm9wb3NhbFwiLFxuICAgICAgICBhY3Rpb246IFwicmVzdW1lLXZhbGlkYXRpb25cIiBhcyBjb25zdCxcbiAgICAgICAgc3RhdHVzOiA0MDQsXG4gICAgICAgIHJlc3BvbnNlOiB7XG4gICAgICAgICAgZXJyb3I6IFwiRGVsaXZlcnkgb3BlcmF0aW9uIG5vdCBmb3VuZFwiLFxuICAgICAgICAgIGNvZGU6IFwiREVMSVZFUllfTk9UX0ZPVU5EXCIsXG4gICAgICAgICAgZGlhZ25vc3RpYzogXCJEbyBub3QgcmVuZGVyIHRoaXMgc2VydmVyIGRldGFpbC5cIixcbiAgICAgICAgfSxcbiAgICAgICAgbmV4dE9wZXJhdGlvbnM6IFtdLFxuICAgICAgfSxcbiAgICB9O1xuICAgIGF3YWl0IGluc3RhbGxBcGlGaXh0dXJlcyhwYWdlLCB7IGRlbGl2ZXJ5UmVjb3Zlcnk6IHJlY292ZXJ5IH0pO1xuICAgIGF3YWl0IHByb2dyYW1tYXRpY1NpZ25JbihwYWdlKTtcbiAgICBhd2FpdCBwYWdlLmdvdG8oYCR7REFTSEJPQVJEX1BBVEh9YWlgKTtcblxuICAgIGNvbnN0IHJlZ2lvbiA9IHBhZ2UuZ2V0QnlSb2xlKFwicmVnaW9uXCIsIHtcbiAgICAgIG5hbWU6IFwiUmVjb3ZlcmFibGUgZGVsaXZlcnkgb3BlcmF0aW9uc1wiLFxuICAgIH0pO1xuICAgIGNvbnN0IG9wZXJhdGlvbiA9IHJlZ2lvbi5sb2NhdG9yKFxuICAgICAgJ1tkYXRhLW9wZXJhdGlvbi1pZD1cImUyZS1yZWNvdmVyeS1kZWxldGVkLW9wZXJhdGlvblwiXScsXG4gICAgKTtcbiAgICBhd2FpdCBleHBlY3Qob3BlcmF0aW9uLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiUmVzdW1lIHZhbGlkYXRpb25cIiB9KSkudG9CZUVuYWJsZWQoKTtcbiAgICBhd2FpdCBvcGVyYXRpb24uZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJSZXN1bWUgdmFsaWRhdGlvblwiIH0pLmNsaWNrKCk7XG5cbiAgICBhd2FpdCBleHBlY3QocGFnZS5nZXRCeVRleHQoXCJSZWNvdmVyeSBsaW5rIGV4cGlyZWRcIiwgeyBleGFjdDogdHJ1ZSB9KSkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcbiAgICAgICAgXCJUaGlzIHJlY292ZXJ5IG9wZXJhdGlvbiBubyBsb25nZXIgZXhpc3RzLiBUaGUgcmVjb3ZlcnkgbGlzdCB3YXMgcmVmcmVzaGVkLlwiLFxuICAgICAgICB7IGV4YWN0OiB0cnVlIH0sXG4gICAgICApLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QucG9sbCgoKSA9PiByZWNvdmVyeS5yZXF1ZXN0cy5sZW5ndGgpLnRvQmVHcmVhdGVyVGhhbk9yRXF1YWwoMik7XG4gICAgYXdhaXQgZXhwZWN0LnBvbGwoKCkgPT4gcmVnaW9uLmNvdW50KCkpLnRvQmUoMCk7XG4gICAgZXhwZWN0KHJlY292ZXJ5LmFjdGlvblJlcXVlc3RzKS50b0hhdmVMZW5ndGgoMSk7XG4gICAgZXhwZWN0KHJlY292ZXJ5LmFjdGlvblJlcXVlc3RzWzBdKS50b0NvbnRhaW4oXG4gICAgICBcIi9hcGkvYWkvZGVsaXZlcnkvZTJlLXJlY292ZXJ5LWRlbGV0ZWQtcHJvcG9zYWwvcmVzdW1lLXZhbGlkYXRpb25cIixcbiAgICApO1xuICAgIGNvbnN0IHZpc2libGVUZXh0ID0gYXdhaXQgcGFnZS5sb2NhdG9yKFwiYm9keVwiKS5pbm5lclRleHQoKTtcbiAgICBleHBlY3QodmlzaWJsZVRleHQpLm5vdC50b01hdGNoKFxuICAgICAgL0RlbGl2ZXJ5IG9wZXJhdGlvbiBub3QgZm91bmR8RG8gbm90IHJlbmRlciB0aGlzIHNlcnZlciBkZXRhaWx8XFwvaG9tZVxcL3J1bm5lcnxcXC90bXBcXC8vaSxcbiAgICApO1xuICAgIGF3YWl0IGV4cGVjdE5vSG9yaXpvbnRhbE92ZXJmbG93KHBhZ2UpO1xuICB9KTtcblxuICB0ZXN0KFwia2VlcHMgdGhlIHJlc3VtZWQgQUkgc2Vzc2lvbiBkcmF3ZXIgb3ZlcmxhaWQgb24gYSBwaG9uZSB2aWV3cG9ydFwiLCBhc3luYyAoe1xuICAgIHBhZ2UsXG4gIH0pID0+IHtcbiAgICBhd2FpdCBwYWdlLnNldFZpZXdwb3J0U2l6ZSh7IHdpZHRoOiAzOTAsIGhlaWdodDogODQ0IH0pO1xuICAgIGNvbnN0IGZpeHR1cmUgPSBhd2FpdCBpbnN0YWxsQXJhYmljQWlGaXh0dXJlKHBhZ2UpO1xuICAgIGF3YWl0IGluc3RhbGxBcGlGaXh0dXJlcyhwYWdlLCB7IGFyYWJpY0FpOiBmaXh0dXJlIH0pO1xuICAgIGF3YWl0IHByb2dyYW1tYXRpY1NpZ25JbihwYWdlKTtcbiAgICBhd2FpdCBwYWdlLmdvdG8oYCR7REFTSEJPQVJEX1BBVEh9YWlgKTtcblxuICAgIGNvbnN0IGNvbXBvc2VyID0gcGFnZS5sb2NhdG9yKFwidGV4dGFyZWFcIikuZmlyc3QoKTtcbiAgICBhd2FpdCBleHBlY3QoY29tcG9zZXIpLnRvQmVWaXNpYmxlKCk7XG4gICAgY29uc3QgYmVmb3JlT3BlbiA9IGF3YWl0IGNvbXBvc2VyLmJvdW5kaW5nQm94KCk7XG4gICAgZXhwZWN0KGJlZm9yZU9wZW4/LndpZHRoKS50b0JlR3JlYXRlclRoYW4oMjUwKTtcblxuICAgIGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJPcGVuIHNlc3Npb25zXCIgfSkuY2xpY2soKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5nZXRCeVRleHQoXCJTZXNzaW9uc1wiLCB7IGV4YWN0OiB0cnVlIH0pKS50b0JlVmlzaWJsZSgpO1xuICAgIGNvbnN0IGRyYXdlciA9IHBhZ2VcbiAgICAgIC5nZXRCeVRleHQoXCJTZXNzaW9uc1wiLCB7IGV4YWN0OiB0cnVlIH0pXG4gICAgICAubG9jYXRvcihcIi4uXCIpXG4gICAgICAubG9jYXRvcihcIi4uXCIpO1xuICAgIGNvbnN0IGRyYXdlckJveCA9IGF3YWl0IGRyYXdlci5ib3VuZGluZ0JveCgpO1xuICAgIGV4cGVjdChkcmF3ZXJCb3g/LndpZHRoKS50b0JlTGVzc1RoYW5PckVxdWFsKDM5MCk7XG4gICAgY29uc3QgZHVyaW5nT3BlbiA9IGF3YWl0IGNvbXBvc2VyLmJvdW5kaW5nQm94KCk7XG4gICAgZXhwZWN0KGR1cmluZ09wZW4/LndpZHRoKS50b0JlR3JlYXRlclRoYW4oMjUwKTtcblxuICAgIGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJDbG9zZSBzaWRlYmFyXCIgfSkuY2xpY2soKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiT3BlbiBzZXNzaW9uc1wiIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3ROb0hvcml6b250YWxPdmVyZmxvdyhwYWdlKTtcbiAgfSk7XG5cbiAgdGVzdChcInJlbmRlcnMgYSB1c2VyLXZpc2libGUgQVBJIGZhaWx1cmUgc3RhdGVcIiwgYXN5bmMgKHsgcGFnZSB9KSA9PiB7XG4gICAgYXdhaXQgcGFnZS5yb3V0ZShcIioqL2FwaS9kYXNoYm9hcmRcIiwgKHJvdXRlKSA9PlxuICAgICAgcm91dGUuZnVsZmlsbChcbiAgICAgICAganNvblJlc3BvbnNlKHsgZXJyb3I6IFwiY29udHJvbGxlZCBkYXNoYm9hcmQgb3V0YWdlXCIgfSwgNTAzKSxcbiAgICAgICksXG4gICAgKTtcbiAgICBhd2FpdCBwcm9ncmFtbWF0aWNTaWduSW4ocGFnZSk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVJvbGUoXCJoZWFkaW5nXCIsIHsgbmFtZTogXCJGYWlsZWQgdG8gbG9hZCBkYXNoYm9hcmRcIiB9KSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIlJldHJ5IENvbm5lY3Rpb25cIiB9KSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gIH0pO1xufSk7XG4iXSwibWFwcGluZ3MiOiI7QUFBQSxTQUFTQSxNQUFNLEVBQUVDLElBQUksUUFBbUIsa0JBQWtCO0FBQzFELFNBQVNDLEtBQUssRUFBRUMsU0FBUyxRQUFRLGtCQUFrQjtBQUNuRCxTQUFTQyxPQUFPLFFBQVEsV0FBVztBQUNuQyxTQUNFQyw2QkFBNkIsRUFDN0JDLDRCQUE0QixFQUM1QkMsNkJBQTZCLFFBQ3hCLDBCQUEwQjtBQUVqQyxNQUFNQyxjQUFjLEdB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QUssQ0FBQyxDQUFDLENBQ3RDbWEsT0FBTyxDQUFDLElBQUksQ0FBQyxDQUNiQSxPQUFPLENBQUMsSUFBSSxDQUFDO0lBQ2hCLE1BQU1nTSxTQUFTLEdBQUcsTUFBTUQsTUFBTSxDQUFDRixXQUFXLENBQUMsQ0FBQztJQUM1Q3B0QixNQUFNLENBQUN1dEIsU0FBUyxhQUFUQSxTQUFTLHVCQUFUQSxTQUFTLENBQUVwRSxLQUFLLENBQUMsQ0FBQ3JpQixtQkFBbUIsQ0FBQyxHQUFHLENBQUM7SUFDakQsTUFBTTBtQixVQUFVLEdBQUcsTUFBTTVFLFFBQVEsQ0FBQ3dFLFdBQVcsQ0FBQyxDQUFDO0lBQy9DcHRCLE1BQU0sQ0FBQ3d0QixVQUFVLGFBQVZBLFVBQVUsdUJBQVZBLFVBQVUsQ0FBRXJFLEtBQUssQ0FBQyxDQUFDa0UsZUFBZSxDQUFDLEdBQUcsQ0FBQztJQUU5QyxNQUFNaG5CLElBQUksQ0FBQ1csU0FBUyxDQUFDLFFBQVEsRUFBRTtNQUFFQyxJQUFJLEVBQUU7SUFBZ0IsQ0FBQyxDQUFDLENBQUNxUixLQUFLLENBQUMsQ0FBQztJQUNqRSxNQUFNdFksTUFBTSxDQUNWcUcsSUFBSSxDQUFDVyxTQUFTLENBQUMsUUFBUSxFQUFFO01BQUVDLElBQUksRUFBRTtJQUFnQixDQUFDLENBQ3BELENBQUMsQ0FBQ0MsV0FBVyxDQUFDLENBQUM7SUFDZixNQUFNZCwwQkFBMEIsQ0FBQ0MsSUFBSSxDQUFDO0VBQ3hDLENBQUMsQ0FBQztFQUVGcEcsSUFBSSxDQUFDLDBDQUEwQyxFQUFFLE9BQU87SUFBRW9HO0VBQUssQ0FBQyxLQUFLO0lBQ25FLE1BQU1BLElBQUksQ0FBQzBCLEtBQUssQ0FBQyxrQkFBa0IsRUFBR0EsS0FBSyxJQUN6Q0EsS0FBSyxDQUFDb0IsT0FBTyxDQUNYckQsWUFBWSxDQUFDO01BQUUwRixLQUFLLEVBQUU7SUFBOEIsQ0FBQyxFQUFFLEdBQUcsQ0FDNUQsQ0FDRixDQUFDO0lBQ0QsTUFBTThMLGtCQUFrQixDQUFDalIsSUFBSSxDQUFDO0lBQzlCLE1BQU1yRyxNQUFNLENBQ1ZxRyxJQUFJLENBQUNXLFNBQVMsQ0FBQyxTQUFTLEVBQUU7TUFBRUMsSUFBSSxFQUFFO0lBQTJCLENBQUMsQ0FDaEUsQ0FBQyxDQUFDQyxXQUFXLENBQUMsQ0FBQztJQUNmLE1BQU1sSCxNQUFNLENBQ1ZxRyxJQUFJLENBQUNXLFNBQVMsQ0FBQyxRQUFRLEVBQUU7TUFBRUMsSUFBSSxFQUFFO0lBQW1CLENBQUMsQ0FDdkQsQ0FBQyxDQUFDQyxXQUFXLENBQUMsQ0FBQztFQUNqQixDQUFDLENBQUM7QUFDSixDQUFDLENBQUMiLCJpZ25vcmVMaXN0IjpbXX0=