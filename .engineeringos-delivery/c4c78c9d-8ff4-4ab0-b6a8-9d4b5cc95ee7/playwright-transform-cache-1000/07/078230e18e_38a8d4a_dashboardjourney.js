// ffc0c3fba27c9d2c048023a57a8908aea0bb302f
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
    if (path === "/api/tasks") {
      var _overrides$recoveryTa;
      return route.fulfill(jsonResponse((_overrides$recoveryTa = overrides === null || overrides === void 0 ? void 0 : overrides.recoveryTasks) !== null && _overrides$recoveryTa !== void 0 ? _overrides$recoveryTa : overrides !== null && overrides !== void 0 && overrides.liveTask ? [{
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJleHBlY3QiLCJ0ZXN0IiwibWtkaXIiLCJ3cml0ZUZpbGUiLCJkaXJuYW1lIiwicGFyc2VDbGVya1NpZ25JblRva2VuUmVzcG9uc2UiLCJwYXJzZUNsZXJrVXNlckxvb2t1cFJlc3BvbnNlIiwicGFyc2VDcmVhdGVkQ2xlcmtVc2VyUmVzcG9uc2UiLCJEQVNIQk9BUkRfUEFUSCIsIlRFU1RfVVNFUiIsImZpcnN0TmFtZSIsImxhc3ROYW1lIiwiZW1haWwiLCJfcHJvY2VzcyRlbnYkREFTSEJPQVIiLCJwcm9jZXNzIiwiZW52IiwiREFTSEJPQVJEX0UyRV9FTUFJTCIsIkVYRUNVVElPTl9JRCIsIkRFRkFVTFRfTElWRV9USU1FT1VUX01TIiwiTElWRV9URVNUX1RJTUVPVVRfTUFSR0lOX01TIiwiSE9TVElMRV9PUklHSU4iLCJPUklHSU5fRElBR05PU1RJQ19IRUFERVJTIiwiREVGQVVMVF9MSVZFX1BST01QVCIsIkxJVkVfQ0FNUEFJR05fU0NFTkFSSU9TIiwiU2V0IiwibGl2ZUNhbXBhaWduU2NlbmFyaW8iLCJfcHJvY2VzcyRlbnYkREFTSEJPQVIyIiwic2NlbmFyaW8iLCJEQVNIQk9BUkRfRTJFX0xJVkVfU0NFTkFSSU8iLCJ0cmltIiwiREFTSEJPQVJEX0UyRV9MSVZFX0NBTVBBSUdOIiwiRXJyb3IiLCJoYXMiLCJsaXZlUHJvbXB0IiwiX3Byb2Nlc3MkZW52JERBU0hCT0FSMyIsIkRBU0hCT0FSRF9FMkVfTElWRV9QUk9NUFQiLCJsaXZlVGltZW91dE1zIiwiY29uZmlndXJlZCIsIk51bWJlciIsIkRBU0hCT0FSRF9FMkVfTElWRV9USU1FT1VUX01TIiwiaXNGaW5pdGUiLCJhcHByb3ZlZERhc2hib2FyZE9yaWdpbnMiLCJfcHJvY2VzcyRlbnYkREFTSEJPQVI0Iiwib3JpZ2lucyIsIkRBU0hCT0FSRF9FMkVfQVBQUk9WRURfT1JJR0lOUyIsInNwbGl0IiwibWFwIiwib3JpZ2luIiwiZmlsdGVyIiwiQm9vbGVhbiIsImxlbmd0aCIsInBhcnNlZCIsIlVSTCIsInBhdGhuYW1lIiwic2VhcmNoIiwiaGFzaCIsImRhc2hib2FyZEZpeHR1cmUiLCJmcmVzaG5lc3NSZXZpc2lvbiIsInByb2plY3RDb3VudCIsImFjdGl2ZVRhc2tDb3VudCIsImNvbXBsZXRlZFRhc2tDb3VudCIsImZhaWxlZFRhc2tDb3VudCIsInRhc2tTdGF0dXNCcmVha2Rvd24iLCJwZW5kaW5nIiwicnVubmluZyIsInByb2plY3RTY29yZXMiLCJwcm9qZWN0SWQiLCJwcm9qZWN0TmFtZSIsInNjb3JlIiwidHJlbmQiLCJyZWNlbnRFdmVudHMiLCJpZCIsInR5cGUiLCJzZXZlcml0eSIsIm1lc3NhZ2UiLCJ0aW1lc3RhbXAiLCJ0b3BSdWxlcyIsImV4ZWN1dGlvbkZpeHR1cmUiLCJvcGVyYXRpb25JZCIsInN0YXR1cyIsImZsaWdodFN0YXRlIiwiZXZpZGVuY2VWZXJkaWN0IiwicHJvb2ZSZXF1aXJlZCIsInJlc3VtYWJsZSIsImNoZWNrcG9pbnRWZXJzaW9uIiwicHJvamVjdFJldmlzaW9uIiwiY2hlY2twb2ludCIsInN0YWdlIiwiZGV0YWlsIiwib2JqZWN0aXZlIiwic3RhcnRlZEF0IiwiY29tcGxldGVkQXQiLCJjcmVhdGVkQXQiLCJ1cGRhdGVkQXQiLCJqc29uUmVzcG9uc2UiLCJib2R5IiwiaGVhZGVycyIsImNvbnRlbnRUeXBlIiwiSlNPTiIsInN0cmluZ2lmeSIsImV4cGVjdE5vSG9yaXpvbnRhbE92ZXJmbG93IiwicGFnZSIsIm92ZXJmbG93IiwiZXZhbHVhdGUiLCJkb2N1bWVudCIsImRvY3VtZW50RWxlbWVudCIsInNjcm9sbFdpZHRoIiwidmlld3BvcnQiLCJ3aW5kb3ciLCJpbm5lcldpZHRoIiwidG9CZUxlc3NUaGFuT3JFcXVhbCIsImV4cGVjdERhc2hib2FyZFJlYWR5IiwiZ2V0QnlSb2xlIiwibmFtZSIsInRvQmVWaXNpYmxlIiwiZ2V0QnlUZXh0IiwiZXhhY3QiLCJyZXN0YXJ0QXBpRm9yQ2FtcGFpZ24iLCJjb250cm9sVXJsIiwiREFTSEJPQVJEX0UyRV9DT05UUk9MX1VSTCIsInJlc3BvbnNlIiwicmVxdWVzdCIsInBvc3QiLCJ0aW1lb3V0IiwidG9CZSIsImluc3RhbGxBcGlGaXh0dXJlcyIsIm92ZXJyaWRlcyIsInJvdXRlIiwiX3JlZiIsIl9vdmVycmlkZXMkZGVsaXZlcnlSZSIsIl9vdmVycmlkZXMkYXVkaXRFeHBvcjIiLCJfb3ZlcnJpZGVzJGF1ZGl0RXhwb3IzIiwidXJsIiwicGF0aCIsInJlcGxhY2UiLCJhcmFiaWNBaSIsImFsdGVybmF0ZUFpIiwiZGlzY29ubmVjdEFpIiwiYWlGaXh0dXJlcyIsImZpeHR1cmUiLCJlbmRzV2l0aCIsInNlYXJjaFBhcmFtcyIsImdldCIsInByb2plY3RTZXNzaW9ucyIsImZ1bGZpbGwiLCJzZXNzaW9uSWQiLCJ0aXRsZSIsInF1ZXN0aW9uIiwicmVzdW1lRmFpbHVyZSIsInJlcXVlc3RCb2R5IiwicG9zdERhdGFKU09OIiwiZXhlY3V0aW9uSWQiLCJzdHJlYW1Cb2R5IiwiaW50ZXJydXB0ZWRSZXN1bWUiLCJyZXN1bWVkU3RyZWFtQm9keSIsInJlcXVlc3RlZE1lc3NhZ2UiLCJzdHJlYW1GaXh0dXJlIiwiZmluZCIsImluY2x1ZGVzIiwibWVzc2FnZUZpeHR1cmUiLCJyb2xlIiwiY29udGVudCIsImF1ZGl0RXhwb3J0IiwiX292ZXJyaWRlcyRhdWRpdEV4cG9yIiwib3V0Y29tZSIsIm1lc3NhZ2VPdXRjb21lIiwiX292ZXJyaWRlcyRyZWNvdmVyeVRhIiwicmVjb3ZlcnlUYXNrcyIsImxpdmVUYXNrIiwiZGVzY3JpcHRpb24iLCJwcmlvcml0eSIsInJlbGF0ZWRGaWxlcyIsInJldHJ5Q291bnQiLCJtYXhSZXRyaWVzIiwiX292ZXJyaWRlcyRyZWNvdmVyeVdvIiwicmVjb3ZlcnlXb3JrZmxvd3MiLCJ3b3JrZmxvd0V4ZWN1dGlvbnNNYXRjaCIsIm1hdGNoIiwiX292ZXJyaWRlcyRyZWNvdmVyeVdvMiIsIl9vdmVycmlkZXMkcmVjb3ZlcnlXbzMiLCJyZWNvdmVyeVdvcmtmbG93RXhlY3V0aW9ucyIsInJlcXVlc3RzIiwicHVzaCIsImZhaWxGaXJzdFByZXZpZXciLCJlcnJvciIsImZpbGVuYW1lIiwiYXJjaGl2ZVVwbG9hZCIsIl9yb3V0ZSRyZXF1ZXN0JGhlYWRlciIsInN0YXJ0c1dpdGgiLCJwb3N0RGF0YUJ1ZmZlciIsIkJ1ZmZlciIsImZyb20iLCJ1cGxvYWRJZCIsIm9yaWdpbmFsTmFtZSIsInBoYXNlIiwiX292ZXJyaWRlcyRsaXZlVGFzayRpIiwiaW5pdGlhbExvZ3MiLCJzdHJlYW1SZXF1ZXN0cyIsImZhaWxGaXJzdFN0cmVhbSIsImZhaWxTdHJlYW1BdHRlbXB0cyIsImFib3J0IiwibG9nIiwiX292ZXJyaWRlcyRwcm9qZWN0cyIsInByb2plY3RzIiwibGFuZ3VhZ2UiLCJmcmFtZXdvcmsiLCJyb290UGF0aCIsInF1YWxpdHlTY29yZSIsImRlbGl2ZXJ5UmVjb3ZlcnkiLCJvcGVyYXRpb25zIiwicmVjb3ZlcnlBY3Rpb24iLCJwcm9wb3NhbElkIiwiYWN0aW9uIiwiX292ZXJyaWRlcyRkZWxpdmVyeVJlMiIsIl9vdmVycmlkZXMkZGVsaXZlcnlSZTMiLCJhY3Rpb25SZXF1ZXN0cyIsIm5leHRPcGVyYXRpb25zIiwiX292ZXJyaWRlcyRldmVudHMiLCJfdXJsJHNlYXJjaFBhcmFtcyRnZXQiLCJldmVudHMiLCJ0b0xvd2VyQ2FzZSIsImZpbHRlcmVkRXZlbnRzIiwiZXZlbnQiLCJjb3JyZWxhdGlvbklkIiwidmFsdWUiLCJzb21lIiwibGltaXQiLCJzbGljZSIsInRvdGFsIiwiZXhlY3V0aW9uIiwicmVzdW1lVG9rZW4iLCJyZWNvdmVyZWRUb2tlbiIsImV4ZWN1dGlvbnMiLCJjb250aW51ZSIsImluc3RhbGxBcmFiaWNBaUZpeHR1cmUiLCJvcHRpb25zIiwiX29wdGlvbnMkc2Vzc2lvbklkIiwiX29wdGlvbnMkcXVlc3Rpb24iLCJtZXNzYWdlSWQiLCJzb3VyY2UiLCJibG9ja2VkIiwiYW5zd2VyIiwiZXZpZGVuY2UiLCJleGNlcnB0Iiwic3VwcG9ydHNDbGFpbSIsImV2aWRlbmNlQ2xhc3MiLCJjaXRhdGlvblN0YXR1cyIsImNpdGF0aW9uUmVhc29uIiwic291cmNlU3BhbiIsInN0YXJ0TGluZSIsImVuZExpbmUiLCJ0b29sVHJhY2UiLCJraW5kIiwidG9vbCIsImFyZ3MiLCJjYWNoZWQiLCJwcmVmZXRjaGVkIiwiY29kZSIsImNvbnNpc3RlbnQiLCJ2aW9sYXRpb25zIiwiZXZpZGVuY2VGaWxlQ291bnQiLCJhY2NlcHRlZEV2aWRlbmNlQ291bnQiLCJjb21wbGV0ZWRSZWFkRmlsZXMiLCJhY2NlcHRlZEV2aWRlbmNlRmlsZXMiLCJvYmplY3RpdmVUeXBlIiwicmVxdWlyZWRFZGdlcyIsInByb3ZlbkVkZ2VzIiwiY29tcGxldGlvbkdhdGVSZXN1bHQiLCJmaW5hbEFuc3dlclR5cGUiLCJ0YXNrUmVzdWx0IiwiY29uZmlkZW5jZSIsInNvdXJjZVNjb3BlIiwiY292ZXJhZ2UiLCJyZXF1ZXN0ZWRGaWVsZHMiLCJhbnN3ZXJlZEZpZWxkcyIsIm1pc3NpbmdGaWVsZHMiLCJjb21wbGV0ZSIsIm9wZXJhdGlvbk1vZGUiLCJzb3VyY2VzIiwiYmVoYXZpb3JFdmlkZW5jZSIsInNzZSIsImRlbHRhIiwicGVuZGluZ0NoYW5nZXMiLCJqb2luIiwiaW5zdGFsbFRvb2xGYWlsdXJlRml4dHVyZSIsImRpYWdub3N0aWNDb2RlIiwicmVzdWx0S2luZCIsInJlc3VsdFN1bW1hcnkiLCJzdG9wUmVhc29uIiwiaXRlcmF0aW9ucyIsIm1heEl0ZXJhdGlvbnMiLCJ0b29sQ2FsbHMiLCJwcmVmZXRjaFRvb2xDYWxscyIsImxvb3BUb29sQ2FsbHMiLCJzeW50aGVzaXNTdGFydGVkIiwiZGlhZ25vc3RpY0NvZGVzIiwiaW5zdGFsbERpc2Nvbm5lY3RlZEFpRml4dHVyZSIsImRpYWdub3N0aWNEZXRhaWxzIiwiZXJyb3JDb2RlIiwiZXJyb3JNZXNzYWdlIiwiaW5zdGFsbFJlc3VtZWRBbmFseXNpc0ZhaWx1cmVGaXh0dXJlIiwiaW5zdGFsbEludGVycnVwdGVkUmVzdW1lRml4dHVyZSIsImluaXRpYWxUb2tlbiIsInBhcnRpYWxBbnN3ZXIiLCJjcmVhdGVSZWxlYXNlU2lnbkluVXJsIiwic2VjcmV0S2V5IiwiQ0xFUktfU0VDUkVUX0tFWSIsIkF1dGhvcml6YXRpb24iLCJ1c2VyUmVzcG9uc2UiLCJlbmNvZGVVUklDb21wb25lbnQiLCJ1c2VySWQiLCJqc29uIiwiY3JlYXRlZFJlc3BvbnNlIiwiZGF0YSIsImVtYWlsX2FkZHJlc3MiLCJmaXJzdF9uYW1lIiwibGFzdF9uYW1lIiwic2tpcF9wYXNzd29yZF9jaGVja3MiLCJza2lwX3Bhc3N3b3JkX3JlcXVpcmVtZW50IiwidG9rZW5SZXNwb25zZSIsInVzZXJfaWQiLCJ0b2tlbiIsInRvU3RyaW5nIiwicHJvZ3JhbW1hdGljU2lnbkluIiwiX2dsb2JhbFRoaXMkc2lnbkluQ2xlIiwiZ290byIsImhlbHBlciIsImdsb2JhbFRoaXMiLCJzaWduSW5DbGVya1VzZXIiLCJfX0VOR0lORUVSSU5HT1NfU0lHTl9JTl9DTEVSS19VU0VSX18iLCJSVU5fQ09OVFJPTExFRF9SRUxFQVNFX1ZBTElEQVRJT04iLCJ0b0hhdmVVUkwiLCJSZWdFeHAiLCJyZXBsYWNlQWxsIiwic2lnbkluVXJsIiwidHRsIiwiYmFzZVBhdGgiLCJvcGVuTmF2aWdhdGlvbiIsImxhYmVsIiwiY2xpY2siLCJhcGlVcmwiLCJhcGlCYXNlVXJsIiwiREFTSEJPQVJEX0UyRV9BUElfQkFTRV9VUkwiLCJsaXZlUmVxdWVzdCIsIl9vcHRpb25zJG1ldGhvZCIsIm1ldGhvZCIsImZldGNoIiwiY3JlZGVudGlhbHMiLCJ1bmRlZmluZWQiLCJzaWduYWwiLCJBYm9ydFNpZ25hbCIsInRleHQiLCJyZWNvcmRlZE9yaWdpbkRpYWdub3N0aWNzIiwib3JpZ2luRGlhZ25vc3RpY1BhdGgiLCJEQVNIQk9BUkRfRTJFX09SSUdJTl9ESUFHTk9TVElDU19QQVRIIiwicmVsZXZhbnRPcmlnaW5IZWFkZXJzIiwiT2JqZWN0IiwiZnJvbUVudHJpZXMiLCJmbGF0TWFwIiwid3JpdGVPcmlnaW5EaWFnbm9zdGljcyIsIm91dHB1dFBhdGgiLCJyZWN1cnNpdmUiLCJkaWFnbm9zdGljcyIsImV4cGVjdE9yaWdpbkNhblVzZUFwaSIsImhlYWx0aFVybCIsIm11dGF0aW9uVXJsIiwiY29tbW9uSGVhZGVycyIsIk9yaWdpbiIsImNoZWNrIiwiYXNzZXJ0aW9uIiwiYXQiLCJjdXJyZW50IiwiX3Jlc3BvbnNlJGhlYWRlcnMkYWNjIiwiX3Jlc3BvbnNlJGhlYWRlcnMkYWNjMiIsInRvVXBwZXJDYXNlIiwidG9Db250YWluIiwiaGVhZGVyIiwibm90IiwiZXhwZWN0SG9zdGlsZU9yaWdpblJlamVjdGVkIiwidXBsb2FkVXJsIiwibGl2ZVVwZGF0ZVVybCIsImRpYWdub3N0aWMiLCJ0b0JlVW5kZWZpbmVkIiwiaG9zdGlsZVVwbG9hZCIsIm11bHRpcGFydCIsImFyY2hpdmUiLCJtaW1lVHlwZSIsImJ1ZmZlciIsImhvc3RpbGVMaXZlVXBkYXRlIiwicGFyc2VTc2UiLCJjaHVuayIsIl9jaHVuayRzcGxpdCRmaW5kIiwibGluZSIsInBhcnNlIiwibGl2ZUpzb24iLCJsaXZlQXJyYXkiLCJBcnJheSIsImlzQXJyYXkiLCJsaXZlT3B0aW9uYWxSZWNvcmQiLCJkZXNjcmliZSIsIl9leGVjdXRpb24kb3BlcmF0aW9uSSIsIl9leGVjdXRpb24kZmxpZ2h0U3RhdCIsIl9naXRMb2ckY29tbWl0cyQwJHNobyIsIl9naXRMb2ckY29tbWl0cyIsIl9naXRMb2ckY29tbWl0czIiLCJfcHJvY2VzcyRlbnYkREFTSEJPQVI1Iiwic2V0VGltZW91dCIsInNraXAiLCJEQVNIQk9BUkRfRTJFX0xJVkVfUFJPVklERVIiLCJEQVNIQk9BUkRfRTJFX0xJVkVfRElTUE9TQUJMRSIsImNhbXBhaWduU2NlbmFyaW8iLCJEQVNIQk9BUkRfRTJFX0xJVkVfUFJPSkVDVF9JRCIsInN0cmVhbVJlc3BvbnNlIiwiaWRlbXBvdGVuY3lLZXkiLCJEYXRlIiwibm93Iiwic3NlRXZlbnRzIiwic3RhcnRlZCIsImRlYWRsaW5lIiwiU3RyaW5nIiwiUHJvbWlzZSIsInJlc29sdmUiLCJtZXNzYWdlcyIsInByb3Bvc2FsIiwiZ2l0TG9nIiwibWlzc2lvbkNvbnRyb2wiLCJkYXNoYm9hcmRTdGF0ZSIsInJlY2VudFN0ZXBzIiwidmFsaWRhdGlvbiIsInN0ZXAiLCJjYW5kaWRhdGVIYXNoIiwiX3N0ZXAkdmFsaWRhdGlvbiRjYW5kIiwiX3N0ZXAkdmFsaWRhdGlvbiIsImNhbmRpZGF0ZUlkZW50aXR5IiwiZXZpZGVuY2VDb3VudCIsInJlZHVjZSIsImNvdW50IiwidGVybWluYWxTdGF0ZSIsInN1Y2Nlc3NTdGF0ZXMiLCJkZWxpdmVyeVN0YWdlcyIsImFwcGxpZWQiLCJjb21taXR0ZWQiLCJwdXNoZWQiLCJ2YWx1ZXMiLCJldmVyeSIsImNhcHR1cmUiLCJ3b3Jrc3BhY2VSZXZpc2lvbiIsImNvbW1pdHMiLCJzaG9ydEhhc2giLCJjYW5kaWRhdGVSZXZpc2lvbiIsImN1cnJlbnRPcGVyYXRpb24iLCJyZXZpc2lvbiIsInJldGFpbmVkUmVzdWx0IiwibWVzc2FnZVNlc3Npb24iLCJtZXNzYWdlRXhlY3V0aW9uIiwiZXZlbnRFeGVjdXRpb24iLCJldmVudFNlc3Npb24iLCJjaGVja3BvaW50cyIsInNlcXVlbmNlIiwicHJvcG9zYWxzIiwiX3N0ZXAkdmFsaWRhdGlvbiRzdGF0IiwiX3N0ZXAkdmFsaWRhdGlvbjIiLCJfc3RlcCR2YWxpZGF0aW9uJHByb2YiLCJfc3RlcCR2YWxpZGF0aW9uMyIsInByb2ZpbGUiLCJ2YWxpZGF0aW9uUHJvZmlsZSIsImRhc2hib2FyZCIsIkRBU0hCT0FSRF9FMkVfTElWRV9SRVBPUlRfUEFUSCIsImZpcnN0IiwicmF3RGlhZ25vc3RpYyIsInJhd0NyZWRlbnRpYWwiLCJzdXBwb3J0UmVmZXJlbmNlcyIsImF1dGhlbnRpY2F0aW9uX2ZhaWxlZCIsInF1b3RhX2V4aGF1c3RlZCIsInByb3ZpZGVyX291dGFnZSIsImFnZW50UmVzcG9uc2UiLCJ0ZXJtaW5hbFN0YXR1cyIsImF2YWlsYWJpbGl0eVN0YXRlIiwib3BlcmF0b3JBY3Rpb24iLCJwcm92aWRlciIsIm1vZGVsIiwidGVybWluYWxSZWFzb24iLCJ3b3JrZmxvd0lkIiwicGhhc2VzIiwic3RlcHMiLCJjdXJyZW50UGhhc2UiLCJleGVjdXRpb25Db3VudCIsImNvbXBsZXRlZFBoYXNlcyIsInJlY292ZXJ5IiwiZ2V0QnlMYWJlbCIsInRhc2tEZXRhaWxzIiwibG9jYXRvciIsInRvQ29udGFpblRleHQiLCJyZWxvYWQiLCJyZWxvYWRlZEF1dGhEZXRhaWxzIiwicmVsb2FkZWRUYXNrVGV4dCIsImlubmVyVGV4dCIsInRvTWF0Y2giLCJyZWxvYWRlZEV4ZWN1dGlvbiIsInZpc2libGVUZXh0IiwiYnJvd3NlciIsInNlY29uZENvbnRleHQiLCJuZXdDb250ZXh0Iiwic2Vjb25kUGFnZSIsIm5ld1BhZ2UiLCJhbGwiLCJjdXJyZW50RGFzaGJvYXJkRml4dHVyZSIsInJlZnJlc2hDb3VudCIsInJlbGVhc2VTdGFsZVJlc3BvbnNlIiwic3RhbGVSZXNwb25zZVJlbGVhc2VkIiwic3RhbGVSZWZyZXNoIiwicG9sbCIsInJlY29ubmVjdEF0dGVtcHQiLCJ1bnJvdXRlIiwidG9IYXZlQ291bnQiLCJjbG9zZSIsImF1ZGl0UmVxdWVzdHMiLCJhdWRpdEJvZHkiLCJmb3JtYXQiLCJleHBvcnRlZEF0IiwicHJvb2YiLCJyZXF1aXJlZCIsInZlcmRpY3QiLCJ0aW1lbGluZSIsInZhbGlkYXRpb25zIiwiYWZmZWN0ZWRGaWxlcyIsInJlZGFjdGlvbiIsImV4Y2x1ZGVkIiwibG9jYWxTdG9yYWdlIiwic2V0SXRlbSIsInByZXZpZXciLCJ0b0hhdmVMZW5ndGgiLCJ0b0JlSGlkZGVuIiwiZG93bmxvYWRQcm9taXNlIiwid2FpdEZvckV2ZW50IiwiZG93bmxvYWQiLCJzdWdnZXN0ZWRGaWxlbmFtZSIsInJlbG9hZGVkUHJvb2YiLCJjYW5jZWxsZWRFeGVjdXRpb24iLCJfcHJvY2VzcyRlbnYkREFTSEJPQVI2IiwidGFza0lkIiwibGl2ZUxvZyIsImxldmVsIiwidXBsb2FkUmVzdWx0IiwiYnl0ZXMiLCJVaW50OEFycmF5IiwiYXRvYiIsImNoYXJhY3RlciIsImNoYXJDb2RlQXQiLCJGb3JtRGF0YSIsImFwcGVuZCIsIkJsb2IiLCJ0b0VxdWFsIiwidGFza1JvdyIsIm1ldGFkYXRhIiwiYWN0aXZpdHkiLCJoYXNUZXh0Iiwibm9uU3RyZWFtUmVxdWVzdHMiLCJvbiIsImV4aGF1c3RlZCIsInNpemUiLCJfIiwiaW5kZXgiLCJVVEMiLCJ0b0lTT1N0cmluZyIsImV2ZW50UmVxdWVzdHMiLCJmaXJzdFJlcXVlc3QiLCJ3YWl0Rm9yUmVxdWVzdCIsImdldEJ5UGxhY2Vob2xkZXIiLCJmaWxsIiwibnRoIiwic2VsZWN0T3B0aW9uIiwidG9IYXZlVmFsdWUiLCJmaWx0ZXJlZFJlcXVlc3QiLCJjb21wb3NlciIsInNlbmRCdXR0b24iLCJ0b0JlRW5hYmxlZCIsInN0cmVhbVJlc3BvbnNlUHJvbWlzZSIsIndhaXRGb3JSZXNwb25zZSIsImxhc3QiLCJzZXRWaWV3cG9ydFNpemUiLCJ3aWR0aCIsImhlaWdodCIsImFjY2VwdGVkIiwiYXNzZXJ0QWNjZXB0ZWRDaXRhdGlvbiIsImFzc2VydEJsb2NrZWRDaXRhdGlvbiIsImFzc2VydE5vSW50ZXJuYWxDaXRhdGlvbkRldGFpbHMiLCJnb0JhY2siLCJnb0ZvcndhcmQiLCJfYXdhaXQkcmVzdW1lUmVxdWVzdCQiLCJyZXN1bWVSZXF1ZXN0IiwicG9zdERhdGEiLCJvYmplY3RDb250YWluaW5nIiwiX3N0cmVhbVJlcXVlc3RzJCIsIl9zdHJlYW1SZXF1ZXN0cyQyIiwiYWRkSW5pdFNjcmlwdCIsIm5hdGl2ZUZldGNoIiwiYmluZCIsImlucHV0IiwiaW5pdCIsIlJlcXVlc3QiLCJyZWFkZXIiLCJnZXRSZWFkZXIiLCJlbmNvZGVyIiwiVGV4dEVuY29kZXIiLCJzdHJlYW0iLCJSZWFkYWJsZVN0cmVhbSIsInN0YXJ0IiwiY29udHJvbGxlciIsImJ1ZmZlcmVkIiwiZG9uZSIsInJlYWQiLCJlbnF1ZXVlIiwiZW5jb2RlIiwiVGV4dERlY29kZXIiLCJkZWNvZGUiLCJtYXJrZXIiLCJpbmRleE9mIiwiZnJhbWVFbmQiLCJUeXBlRXJyb3IiLCJSZXNwb25zZSIsInN0YXR1c1RleHQiLCJzdG9yYWdlS2V5IiwicG9pbnRlcktleSIsImtleSIsImdldEl0ZW0iLCJfbG9jYWxTdG9yYWdlJGdldEl0ZW0iLCJzYXZlZCIsIl9sb2NhbFN0b3JhZ2UkZ2V0SXRlbTIiLCJsaWZlY3ljbGUiLCJyZWNvdmVyeVN0YXRlIiwib3BlcmF0b3JFeHBsYW5hdGlvbiIsIm5leHRBY3Rpb24iLCJjb25mbGljdFJlYXNvbiIsInZhbGlkYXRpb25FdmlkZW5jZSIsIndvcmtzcGFjZUF2YWlsYWJsZSIsImNoYW5nZUNvdW50IiwicmVnaW9uIiwiYXZhaWxhYmxlIiwibWlzc2luZyIsImRpc2NhcmRlZCIsInRvSGF2ZUF0dHJpYnV0ZSIsInRvQmVEaXNhYmxlZCIsInJlbG9hZGVkUmVnaW9uIiwidG9CZUdyZWF0ZXJUaGFuT3JFcXVhbCIsIm9wZXJhdGlvbiIsImJlZm9yZU9wZW4iLCJib3VuZGluZ0JveCIsInRvQmVHcmVhdGVyVGhhbiIsImRyYXdlciIsImRyYXdlckJveCIsImR1cmluZ09wZW4iXSwic291cmNlcyI6WyJkYXNoYm9hcmQuam91cm5leS50cyJdLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBleHBlY3QsIHRlc3QsIHR5cGUgUGFnZSB9IGZyb20gXCJAcGxheXdyaWdodC90ZXN0XCI7XG5pbXBvcnQgeyBta2Rpciwgd3JpdGVGaWxlIH0gZnJvbSBcIm5vZGU6ZnMvcHJvbWlzZXNcIjtcbmltcG9ydCB7IGRpcm5hbWUgfSBmcm9tIFwibm9kZTpwYXRoXCI7XG5pbXBvcnQge1xuICBwYXJzZUNsZXJrU2lnbkluVG9rZW5SZXNwb25zZSxcbiAgcGFyc2VDbGVya1VzZXJMb29rdXBSZXNwb25zZSxcbiAgcGFyc2VDcmVhdGVkQ2xlcmtVc2VyUmVzcG9uc2UsXG59IGZyb20gXCIuLi9zcmMvbGliL2NsZXJrLWhhbmRvZmZcIjtcblxuY29uc3QgREFTSEJPQVJEX1BBVEggPSBcIi9kYXNoYm9hcmQvXCI7XG5jb25zdCBURVNUX1VTRVIgPSB7XG4gIGZpcnN0TmFtZTogXCJFbmdpbmVlcmluZ09TXCIsXG4gIGxhc3ROYW1lOiBcIkRhc2hib2FyZCBTbW9rZVwiLFxuICBlbWFpbDpcbiAgICBwcm9jZXNzLmVudi5EQVNIQk9BUkRfRTJFX0VNQUlMID8/XG4gICAgXCJlbmdpbmVlcmluZ29zLWRhc2hib2FyZC1zbW9rZUBleGFtcGxlLmNvbVwiLFxufTtcbmNvbnN0IEVYRUNVVElPTl9JRCA9IFwiZTJlLWNvbnRyb2xsZWQtZXhlY3V0aW9uXCI7XG5jb25zdCBERUZBVUxUX0xJVkVfVElNRU9VVF9NUyA9IDEyMF8wMDA7XG5jb25zdCBMSVZFX1RFU1RfVElNRU9VVF9NQVJHSU5fTVMgPSA1XzAwMDtcbmNvbnN0IEhPU1RJTEVfT1JJR0lOID0gXCJodHRwczovL2F0dGFja2VyLmV4YW1wbGVcIjtcbmNvbnN0IE9SSUdJTl9ESUFHTk9TVElDX0hFQURFUlMgPSBbXG4gIFwiYWNjZXNzLWNvbnRyb2wtYWxsb3ctb3JpZ2luXCIsXG4gIFwiYWNjZXNzLWNvbnRyb2wtYWxsb3ctbWV0aG9kc1wiLFxuICBcImFjY2Vzcy1jb250cm9sLWFsbG93LWhlYWRlcnNcIixcbiAgXCJ2YXJ5XCIsXG5dIGFzIGNvbnN0O1xuY29uc3QgREVGQVVMVF9MSVZFX1BST01QVCA9XG4gIFwiUGVyZm9ybSBhIGJvdW5kZWQgZm9yZW5zaWMgYXVkaXQgb2YgdGhpcyBkaXNwb3NhYmxlIHByb2plY3QgdXNpbmcgcmVhZC1vbmx5IHRvb2xzLiBcIiArXG4gIFwiUHJvZHVjZSBhdCBsZWFzdCBvbmUgYWNjZXB0ZWQgZXZpZGVuY2UgaXRlbSBhbmQgb25lIHZhbGlkYXRpb24gY2hlY2twb2ludCwgYW5kIGRvIG5vdCBcIiArXG4gIFwicmVwb3J0IENPTVBMRVRFRCB1bmxlc3MgYm90aCBhcmUgcHJlc2VudC4gUmVwb3J0IG9ubHkgdmVyaWZpZWQgZXZpZGVuY2UuXCI7XG5jb25zdCBMSVZFX0NBTVBBSUdOX1NDRU5BUklPUyA9IG5ldyBTZXQoW1xuICBcInByb3ZpZGVyLW91dGFnZVwiLFxuICBcIm1hbGZvcm1lZC1vdXRwdXRcIixcbiAgXCJkZWxpdmVyeS1zdWNjZXNzXCIsXG5dKTtcblxuZnVuY3Rpb24gbGl2ZUNhbXBhaWduU2NlbmFyaW8oKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgY29uc3Qgc2NlbmFyaW8gPSBwcm9jZXNzLmVudi5EQVNIQk9BUkRfRTJFX0xJVkVfU0NFTkFSSU8/LnRyaW0oKTtcbiAgaWYgKHByb2Nlc3MuZW52LkRBU0hCT0FSRF9FMkVfTElWRV9DQU1QQUlHTiA9PT0gXCIxXCIgJiYgIXNjZW5hcmlvKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgXCJMaXZlIGNhbXBhaWduIHJlcXVpcmVzIERBU0hCT0FSRF9FMkVfTElWRV9TQ0VOQVJJTz1wcm92aWRlci1vdXRhZ2UsIG1hbGZvcm1lZC1vdXRwdXQsIG9yIGRlbGl2ZXJ5LXN1Y2Nlc3MuXCIsXG4gICAgKTtcbiAgfVxuICBpZiAoc2NlbmFyaW8gJiYgIUxJVkVfQ0FNUEFJR05fU0NFTkFSSU9TLmhhcyhzY2VuYXJpbykpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYFVuc3VwcG9ydGVkIGxpdmUgY2FtcGFpZ24gc2NlbmFyaW86ICR7c2NlbmFyaW99LmApO1xuICB9XG4gIHJldHVybiBzY2VuYXJpbztcbn1cblxuZnVuY3Rpb24gbGl2ZVByb21wdCgpOiBzdHJpbmcge1xuICBjb25zdCBzY2VuYXJpbyA9IGxpdmVDYW1wYWlnblNjZW5hcmlvKCk7XG4gIGlmIChzY2VuYXJpbyA9PT0gXCJwcm92aWRlci1vdXRhZ2VcIikge1xuICAgIHJldHVybiBcIlJ1biBhIGJvdW5kZWQgZm9yZW5zaWMgYXVkaXQgYW5kIHJlcG9ydCB0aGUgT3BlblJvdXRlciByYXRlLWxpbWl0L3Byb3ZpZGVyLWV4aGF1c3Rpb24gb3V0YWdlIGFzIGEgZmFpbGVkIG9yIGluY29tcGxldGUgb3BlcmF0aW9uLiBEbyBub3QgdXNlIHByaW9yIGFuYWx5c2lzIGFzIGEgY3VycmVudCBhbnN3ZXI7IGluY2x1ZGUgdGhlIGN1cnJlbnQgb3BlcmF0aW9uIGFuZCByZXZpc2lvbi5cIjtcbiAgfVxuICBpZiAoc2NlbmFyaW8gPT09IFwibWFsZm9ybWVkLW91dHB1dFwiKSB7XG4gICAgcmV0dXJuIFwiUnVuIGEgYm91bmRlZCBmb3JlbnNpYyBhdWRpdCBhbmQgdHJlYXQgbWFsZm9ybWVkIHByb3ZpZGVyIG91dHB1dCBhcyBmYWlsZWQgb3IgaW5jb21wbGV0ZS4gRG8gbm90IGNsYWltIHN1Y2Nlc3MsIGFwcGx5LCBjb21taXQsIG9yIHB1c2ggd2l0aG91dCBjYW5kaWRhdGUtYm91bmQgZXZpZGVuY2UuXCI7XG4gIH1cbiAgaWYgKHNjZW5hcmlvID09PSBcImRlbGl2ZXJ5LXN1Y2Nlc3NcIikge1xuICAgIHJldHVybiBcIlBsZWFzZSBjb25kdWN0IHRoZSBib3VuZGVkIGRlbGl2ZXJ5IHByb29mIGNhbXBhaWduIG9uIHRoaXMgZGlzcG9zYWJsZSBwcm9qZWN0LiBFeGVyY2lzZSBhcHBseSwgY29tbWl0LCBhbmQgcHVzaCBvbmx5IHdoZW4gZWFjaCBjdXJyZW50IG9wZXJhdGlvbiwgcHJvamVjdCByZXZpc2lvbiwgY2FuZGlkYXRlIGlkZW50aXR5LCBhbmQgY2FuZGlkYXRlLWJvdW5kIGV2aWRlbmNlIG1hdGNoLiBSZXBvcnQgZXZlcnkgdGVybWluYWwgcmVjZWlwdC5cIjtcbiAgfVxuICByZXR1cm4gcHJvY2Vzcy5lbnYuREFTSEJPQVJEX0UyRV9MSVZFX1BST01QVCA/PyBERUZBVUxUX0xJVkVfUFJPTVBUO1xufVxuXG5mdW5jdGlvbiBsaXZlVGltZW91dE1zKCk6IG51bWJlciB7XG4gIGNvbnN0IGNvbmZpZ3VyZWQgPSBOdW1iZXIocHJvY2Vzcy5lbnYuREFTSEJPQVJEX0UyRV9MSVZFX1RJTUVPVVRfTVMpO1xuICByZXR1cm4gTnVtYmVyLmlzRmluaXRlKGNvbmZpZ3VyZWQpICYmIGNvbmZpZ3VyZWQgPiAwXG4gICAgPyBjb25maWd1cmVkXG4gICAgOiBERUZBVUxUX0xJVkVfVElNRU9VVF9NUztcbn1cblxuZnVuY3Rpb24gYXBwcm92ZWREYXNoYm9hcmRPcmlnaW5zKCk6IHN0cmluZ1tdIHtcbiAgY29uc3Qgb3JpZ2lucyA9IChwcm9jZXNzLmVudi5EQVNIQk9BUkRfRTJFX0FQUFJPVkVEX09SSUdJTlMgPz8gXCJcIilcbiAgICAuc3BsaXQoXCIsXCIpXG4gICAgLm1hcCgob3JpZ2luKSA9PiBvcmlnaW4udHJpbSgpKVxuICAgIC5maWx0ZXIoQm9vbGVhbik7XG4gIGlmIChvcmlnaW5zLmxlbmd0aCA9PT0gMCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgIFwiREFTSEJPQVJEX0UyRV9BUFBST1ZFRF9PUklHSU5TIG11c3QgY29udGFpbiBldmVyeSBhcHByb3ZlZCBkYXNoYm9hcmQgb3JpZ2luLlwiLFxuICAgICk7XG4gIH1cbiAgcmV0dXJuIG9yaWdpbnMubWFwKChvcmlnaW4pID0+IHtcbiAgICBjb25zdCBwYXJzZWQgPSBuZXcgVVJMKG9yaWdpbik7XG4gICAgaWYgKFxuICAgICAgcGFyc2VkLm9yaWdpbiAhPT0gb3JpZ2luIHx8XG4gICAgICBwYXJzZWQucGF0aG5hbWUgIT09IFwiL1wiIHx8XG4gICAgICBwYXJzZWQuc2VhcmNoIHx8XG4gICAgICBwYXJzZWQuaGFzaFxuICAgICkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICBgRGFzaGJvYXJkIGpvdXJuZXkgb3JpZ2luIG11c3QgYmUgYSBiYXJlIG9yaWdpbjogJHtvcmlnaW59YCxcbiAgICAgICk7XG4gICAgfVxuICAgIHJldHVybiBwYXJzZWQub3JpZ2luO1xuICB9KTtcbn1cblxuY29uc3QgZGFzaGJvYXJkRml4dHVyZSA9IHtcbiAgZnJlc2huZXNzUmV2aXNpb246IFwiMjAyNi0wMS0wMVQwMDowMDowMC4wMDBaXCIsXG4gIHByb2plY3RDb3VudDogMSxcbiAgYWN0aXZlVGFza0NvdW50OiAwLFxuICBjb21wbGV0ZWRUYXNrQ291bnQ6IDIsXG4gIGZhaWxlZFRhc2tDb3VudDogMCxcbiAgdGFza1N0YXR1c0JyZWFrZG93bjogeyBwZW5kaW5nOiAwLCBydW5uaW5nOiAwIH0sXG4gIHByb2plY3RTY29yZXM6IFtcbiAgICB7XG4gICAgICBwcm9qZWN0SWQ6IFwiZTJlLXByb2plY3RcIixcbiAgICAgIHByb2plY3ROYW1lOiBcIlNtb2tlIFByb2plY3RcIixcbiAgICAgIHNjb3JlOiA5MixcbiAgICAgIHRyZW5kOiBcInN0YWJsZVwiLFxuICAgIH0sXG4gIF0sXG4gIHJlY2VudEV2ZW50czogW1xuICAgIHtcbiAgICAgIGlkOiBcImUyZS1ldmVudFwiLFxuICAgICAgdHlwZTogXCJTbW9rZUNoZWNrXCIsXG4gICAgICBzZXZlcml0eTogXCJzdWNjZXNzXCIsXG4gICAgICBtZXNzYWdlOiBcIkRhc2hib2FyZCBBUEkgZml4dHVyZSByZWFkeVwiLFxuICAgICAgdGltZXN0YW1wOiBcIjIwMjYtMDEtMDFUMDA6MDA6MDAuMDAwWlwiLFxuICAgIH0sXG4gIF0sXG4gIHRvcFJ1bGVzOiBbXSxcbn07XG5cbmNvbnN0IGV4ZWN1dGlvbkZpeHR1cmUgPSB7XG4gIGlkOiBFWEVDVVRJT05fSUQsXG4gIHByb2plY3RJZDogXCJlMmUtcHJvamVjdFwiLFxuICBvcGVyYXRpb25JZDogXCJlMmUtb3BlcmF0aW9uXCIsXG4gIHN0YXR1czogXCJjb21wbGV0ZWRcIixcbiAgZmxpZ2h0U3RhdGU6IFwiQ09NUExFVEVEXCIsXG4gIGV2aWRlbmNlVmVyZGljdDogXCJQUk9WRU5cIixcbiAgcHJvb2ZSZXF1aXJlZDogZmFsc2UsXG4gIHJlc3VtYWJsZTogZmFsc2UsXG4gIGNoZWNrcG9pbnRWZXJzaW9uOiAxLFxuICBwcm9qZWN0UmV2aXNpb246IFwiZTJlLXJldmlzaW9uLTQyXCIsXG4gIGNoZWNrcG9pbnQ6IHtcbiAgICBzdGFnZTogXCJjb21wbGV0ZVwiLFxuICAgIGRldGFpbDogXCJDb250cm9sbGVkIGJyb3dzZXIgZml4dHVyZSBjb21wbGV0ZWQuXCIsXG4gIH0sXG4gIG9iamVjdGl2ZTogeyBvYmplY3RpdmU6IFwiVmVyaWZ5IHRoZSBkYXNoYm9hcmQgYnJvd3NlciBqb3VybmV5XCIgfSxcbiAgc3RhcnRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDA6MDAuMDAwWlwiLFxuICBjb21wbGV0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAxOjAwLjAwMFpcIixcbiAgY3JlYXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDA6MDAuMDAwWlwiLFxuICB1cGRhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMTowMC4wMDBaXCIsXG59O1xuXG5mdW5jdGlvbiBqc29uUmVzcG9uc2UoXG4gIGJvZHk6IHVua25vd24sXG4gIHN0YXR1cyA9IDIwMCxcbiAgaGVhZGVycz86IFJlY29yZDxzdHJpbmcsIHN0cmluZz4sXG4pIHtcbiAgcmV0dXJuIHtcbiAgICBzdGF0dXMsXG4gICAgY29udGVudFR5cGU6IFwiYXBwbGljYXRpb24vanNvblwiLFxuICAgIC4uLihoZWFkZXJzID8geyBoZWFkZXJzIH0gOiB7fSksXG4gICAgYm9keTogSlNPTi5zdHJpbmdpZnkoYm9keSksXG4gIH07XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGV4cGVjdE5vSG9yaXpvbnRhbE92ZXJmbG93KHBhZ2U6IFBhZ2UpIHtcbiAgY29uc3Qgb3ZlcmZsb3cgPSBhd2FpdCBwYWdlLmV2YWx1YXRlKCgpID0+ICh7XG4gICAgZG9jdW1lbnQ6IGRvY3VtZW50LmRvY3VtZW50RWxlbWVudC5zY3JvbGxXaWR0aCxcbiAgICBib2R5OiBkb2N1bWVudC5ib2R5LnNjcm9sbFdpZHRoLFxuICAgIHZpZXdwb3J0OiB3aW5kb3cuaW5uZXJXaWR0aCxcbiAgfSkpO1xuICBleHBlY3Qob3ZlcmZsb3cuZG9jdW1lbnQpLnRvQmVMZXNzVGhhbk9yRXF1YWwob3ZlcmZsb3cudmlld3BvcnQgKyAxKTtcbiAgZXhwZWN0KG92ZXJmbG93LmJvZHkpLnRvQmVMZXNzVGhhbk9yRXF1YWwob3ZlcmZsb3cudmlld3BvcnQgKyAxKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZXhwZWN0RGFzaGJvYXJkUmVhZHkocGFnZTogUGFnZSkge1xuICBhd2FpdCBleHBlY3QoXG4gICAgcGFnZS5nZXRCeVJvbGUoXCJoZWFkaW5nXCIsIHsgbmFtZTogXCJTeXN0ZW0gT3ZlcnZpZXdcIiB9KSxcbiAgKS50b0JlVmlzaWJsZSgpO1xuICBhd2FpdCBleHBlY3QocGFnZS5nZXRCeVRleHQoXCJTWVNURU0gT05MSU5FXCIsIHsgZXhhY3Q6IHRydWUgfSkpLnRvQmVWaXNpYmxlKCk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHJlc3RhcnRBcGlGb3JDYW1wYWlnbihwYWdlOiBQYWdlKSB7XG4gIGNvbnN0IGNvbnRyb2xVcmwgPSBwcm9jZXNzLmVudi5EQVNIQk9BUkRfRTJFX0NPTlRST0xfVVJMO1xuICBpZiAoIWNvbnRyb2xVcmwpIHRocm93IG5ldyBFcnJvcihcIkRhc2hib2FyZCBjYW1wYWlnbiBjb250cm9sIFVSTCBpcyBtaXNzaW5nLlwiKTtcbiAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBwYWdlLnJlcXVlc3QucG9zdChgJHtjb250cm9sVXJsfS9yZXN0YXJ0LWFwaWAsIHtcbiAgICB0aW1lb3V0OiAxNV8wMDAsXG4gIH0pO1xuICBleHBlY3QocmVzcG9uc2Uuc3RhdHVzKCkpLnRvQmUoMjA0KTtcbn1cblxudHlwZSBBcmFiaWNBaUZpeHR1cmUgPSB7XG4gIHF1ZXN0aW9uOiBzdHJpbmc7XG4gIGFuc3dlcjogc3RyaW5nO1xuICBzb3VyY2U6IHN0cmluZztcbiAgc2Vzc2lvbklkOiBzdHJpbmc7XG4gIGV4ZWN1dGlvbklkPzogc3RyaW5nO1xuICBwcm9qZWN0SWQ/OiBzdHJpbmc7XG4gIHN0cmVhbUJvZHk6IHN0cmluZztcbiAgbWVzc2FnZTogUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG59O1xuXG5hc3luYyBmdW5jdGlvbiBpbnN0YWxsQXBpRml4dHVyZXMoXG4gIHBhZ2U6IFBhZ2UsXG4gIG92ZXJyaWRlcz86IHtcbiAgICBhcmFiaWNBaT86IEFyYWJpY0FpRml4dHVyZTtcbiAgICBhbHRlcm5hdGVBaT86IEFyYWJpY0FpRml4dHVyZTtcbiAgICBkaXNjb25uZWN0QWk/OiBBcmFiaWNBaUZpeHR1cmU7XG4gICAgcmVzdW1lRmFpbHVyZT86IHtcbiAgICAgIGZpeHR1cmU6IEFyYWJpY0FpRml4dHVyZTtcbiAgICAgIGV4ZWN1dGlvbjogUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gICAgfTtcbiAgICBpbnRlcnJ1cHRlZFJlc3VtZT86IHtcbiAgICAgIGZpeHR1cmU6IEFyYWJpY0FpRml4dHVyZTtcbiAgICAgIGV4ZWN1dGlvbjogUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gICAgICByZWNvdmVyZWRUb2tlbjogc3RyaW5nO1xuICAgICAgcmVzdW1lZFN0cmVhbUJvZHk6IHN0cmluZztcbiAgICB9O1xuICAgIGRlbGl2ZXJ5UmVjb3Zlcnk/OiB7XG4gICAgICBvcGVyYXRpb25zOiBBcnJheTxSZWNvcmQ8c3RyaW5nLCB1bmtub3duPj47XG4gICAgICByZXF1ZXN0czogc3RyaW5nW107XG4gICAgICBhY3Rpb25SZXF1ZXN0cz86IHN0cmluZ1tdO1xuICAgICAgcmVjb3ZlcnlBY3Rpb24/OiB7XG4gICAgICAgIHByb3Bvc2FsSWQ6IHN0cmluZztcbiAgICAgICAgYWN0aW9uOiBcInJlc3VtZS12YWxpZGF0aW9uXCIgfCBcImRpc2NhcmRcIjtcbiAgICAgICAgcmVzcG9uc2U6IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAgICAgICBzdGF0dXM/OiBudW1iZXI7XG4gICAgICAgIG5leHRPcGVyYXRpb25zPzogQXJyYXk8UmVjb3JkPHN0cmluZywgdW5rbm93bj4+O1xuICAgICAgfTtcbiAgICB9O1xuICAgIHByb2plY3RzPzogQXJyYXk8UmVjb3JkPHN0cmluZywgdW5rbm93bj4+O1xuICAgIGV2ZW50cz86IEFycmF5PFJlY29yZDxzdHJpbmcsIHVua25vd24+PjtcbiAgICBhcmNoaXZlVXBsb2FkPzoge1xuICAgICAgdXBsb2FkSWQ6IHN0cmluZztcbiAgICAgIG9yaWdpbmFsTmFtZTogc3RyaW5nO1xuICAgIH07XG4gICAgYXVkaXRFeHBvcnQ/OiB7XG4gICAgICBib2R5OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgICAgIGZpbGVuYW1lOiBzdHJpbmc7XG4gICAgICByZXF1ZXN0czogc3RyaW5nW107XG4gICAgICBleGVjdXRpb24/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgICAgIG1lc3NhZ2VPdXRjb21lPzogc3RyaW5nO1xuICAgICAgZmFpbEZpcnN0UHJldmlldz86IGJvb2xlYW47XG4gICAgfTtcbiAgICBsaXZlVGFzaz86IHtcbiAgICAgIGlkOiBzdHJpbmc7XG4gICAgICB0aXRsZTogc3RyaW5nO1xuICAgICAgcHJvamVjdElkOiBzdHJpbmc7XG4gICAgICBsb2c6IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAgICAgaW5pdGlhbExvZ3M/OiBBcnJheTxSZWNvcmQ8c3RyaW5nLCB1bmtub3duPj47XG4gICAgICBzdHJlYW1SZXF1ZXN0cz86IHN0cmluZ1tdO1xuICAgICAgZmFpbEZpcnN0U3RyZWFtPzogYm9vbGVhbjtcbiAgICAgIGZhaWxTdHJlYW1BdHRlbXB0cz86IG51bWJlcjtcbiAgICB9O1xuICAgIHJlY292ZXJ5VGFza3M/OiBBcnJheTxSZWNvcmQ8c3RyaW5nLCB1bmtub3duPj47XG4gICAgcmVjb3ZlcnlXb3JrZmxvd3M/OiBBcnJheTxSZWNvcmQ8c3RyaW5nLCB1bmtub3duPj47XG4gICAgcmVjb3ZlcnlXb3JrZmxvd0V4ZWN1dGlvbnM/OiBSZWNvcmQ8c3RyaW5nLCBBcnJheTxSZWNvcmQ8c3RyaW5nLCB1bmtub3duPj4+O1xuICB9LFxuKSB7XG4gIGF3YWl0IHBhZ2Uucm91dGUoXCIqKi9hcGkvKipcIiwgYXN5bmMgKHJvdXRlKSA9PiB7XG4gICAgY29uc3QgdXJsID0gbmV3IFVSTChyb3V0ZS5yZXF1ZXN0KCkudXJsKCkpO1xuICAgIGNvbnN0IHBhdGggPSB1cmwucGF0aG5hbWUucmVwbGFjZSgvXlxcL2Rhc2hib2FyZCg/PVxcL3wkKS8sIFwiXCIpO1xuICAgIGNvbnN0IGFyYWJpY0FpID0gb3ZlcnJpZGVzPy5hcmFiaWNBaTtcbiAgICBjb25zdCBhbHRlcm5hdGVBaSA9IG92ZXJyaWRlcz8uYWx0ZXJuYXRlQWk7XG4gICAgY29uc3QgZGlzY29ubmVjdEFpID0gb3ZlcnJpZGVzPy5kaXNjb25uZWN0QWk7XG4gICAgY29uc3QgYWlGaXh0dXJlcyA9IFthcmFiaWNBaSwgYWx0ZXJuYXRlQWksIGRpc2Nvbm5lY3RBaV0uZmlsdGVyKFxuICAgICAgKGZpeHR1cmUpOiBmaXh0dXJlIGlzIEFyYWJpY0FpRml4dHVyZSA9PiBCb29sZWFuKGZpeHR1cmUpLFxuICAgICk7XG5cbiAgICBpZiAoYWlGaXh0dXJlcy5sZW5ndGggPiAwICYmIHBhdGguZW5kc1dpdGgoXCIvYXBpL2FpL2NoYXQvc2Vzc2lvbnNcIikpIHtcbiAgICAgIGNvbnN0IHByb2plY3RJZCA9IHVybC5zZWFyY2hQYXJhbXMuZ2V0KFwicHJvamVjdElkXCIpO1xuICAgICAgY29uc3QgcHJvamVjdFNlc3Npb25zID0gYWlGaXh0dXJlcy5maWx0ZXIoXG4gICAgICAgIChmaXh0dXJlKSA9PiAhZml4dHVyZS5wcm9qZWN0SWQgfHwgZml4dHVyZS5wcm9qZWN0SWQgPT09IHByb2plY3RJZCxcbiAgICAgICk7XG4gICAgICByZXR1cm4gcm91dGUuZnVsZmlsbChcbiAgICAgICAganNvblJlc3BvbnNlKFxuICAgICAgICAgIHByb2plY3RTZXNzaW9ucy5tYXAoKGZpeHR1cmUpID0+ICh7XG4gICAgICAgICAgICBpZDogZml4dHVyZS5zZXNzaW9uSWQsXG4gICAgICAgICAgICB0aXRsZTogZml4dHVyZS5xdWVzdGlvbixcbiAgICAgICAgICAgIHVwZGF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAyOjAwLjAwMFpcIixcbiAgICAgICAgICB9KSksXG4gICAgICAgICksXG4gICAgICApO1xuICAgIH1cbiAgICBpZiAob3ZlcnJpZGVzPy5yZXN1bWVGYWlsdXJlICYmIHBhdGguZW5kc1dpdGgoXCIvYXBpL2FpL2NoYXQvc3RyZWFtXCIpKSB7XG4gICAgICBsZXQgcmVxdWVzdEJvZHk6IFJlY29yZDxzdHJpbmcsIHVua25vd24+ID0ge307XG4gICAgICB0cnkge1xuICAgICAgICByZXF1ZXN0Qm9keSA9IHJvdXRlLnJlcXVlc3QoKS5wb3N0RGF0YUpTT04oKSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICAvLyBUaGUgbm9ybWFsIHByb3ZpZGVyLWZyZWUgZmFsbGJhY2sgYmVsb3cgaGFuZGxlcyBtYWxmb3JtZWQgcmVxdWVzdHMuXG4gICAgICB9XG4gICAgICBpZiAoXG4gICAgICAgIHJlcXVlc3RCb2R5LmV4ZWN1dGlvbklkID09PSBvdmVycmlkZXMucmVzdW1lRmFpbHVyZS5maXh0dXJlLmV4ZWN1dGlvbklkXG4gICAgICApIHtcbiAgICAgICAgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoe1xuICAgICAgICAgIHN0YXR1czogMjAwLFxuICAgICAgICAgIGNvbnRlbnRUeXBlOiBcInRleHQvZXZlbnQtc3RyZWFtXCIsXG4gICAgICAgICAgaGVhZGVyczogeyBcIkNhY2hlLUNvbnRyb2xcIjogXCJuby1jYWNoZVwiIH0sXG4gICAgICAgICAgYm9keTogb3ZlcnJpZGVzLnJlc3VtZUZhaWx1cmUuZml4dHVyZS5zdHJlYW1Cb2R5LFxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9XG4gICAgaWYgKG92ZXJyaWRlcz8uaW50ZXJydXB0ZWRSZXN1bWUgJiYgcGF0aC5lbmRzV2l0aChcIi9hcGkvYWkvY2hhdC9zdHJlYW1cIikpIHtcbiAgICAgIGxldCByZXF1ZXN0Qm9keTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gPSB7fTtcbiAgICAgIHRyeSB7XG4gICAgICAgIHJlcXVlc3RCb2R5ID0gcm91dGUucmVxdWVzdCgpLnBvc3REYXRhSlNPTigpIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIC8vIFRoZSBub3JtYWwgcHJvdmlkZXItZnJlZSBmYWxsYmFjayBiZWxvdyBoYW5kbGVzIG1hbGZvcm1lZCByZXF1ZXN0cy5cbiAgICAgIH1cbiAgICAgIGNvbnN0IHsgZml4dHVyZSwgcmVzdW1lZFN0cmVhbUJvZHkgfSA9IG92ZXJyaWRlcy5pbnRlcnJ1cHRlZFJlc3VtZTtcbiAgICAgIGlmIChyZXF1ZXN0Qm9keS5leGVjdXRpb25JZCA9PT0gZml4dHVyZS5leGVjdXRpb25JZCkge1xuICAgICAgICByZXR1cm4gcm91dGUuZnVsZmlsbCh7XG4gICAgICAgICAgc3RhdHVzOiAyMDAsXG4gICAgICAgICAgY29udGVudFR5cGU6IFwidGV4dC9ldmVudC1zdHJlYW1cIixcbiAgICAgICAgICBoZWFkZXJzOiB7IFwiQ2FjaGUtQ29udHJvbFwiOiBcIm5vLWNhY2hlXCIgfSxcbiAgICAgICAgICBib2R5OiByZXN1bWVkU3RyZWFtQm9keSxcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgICBpZiAoIXJlcXVlc3RCb2R5LmV4ZWN1dGlvbklkKSB7XG4gICAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKHtcbiAgICAgICAgICBzdGF0dXM6IDIwMCxcbiAgICAgICAgICBjb250ZW50VHlwZTogXCJ0ZXh0L2V2ZW50LXN0cmVhbVwiLFxuICAgICAgICAgIGhlYWRlcnM6IHsgXCJDYWNoZS1Db250cm9sXCI6IFwibm8tY2FjaGVcIiB9LFxuICAgICAgICAgIC8vIERlbGliZXJhdGVseSBzdG9wIGFmdGVyIHRoZSBkdXJhYmxlIGV4ZWN1dGlvbiBpZGVudGl0eS4gVGhlXG4gICAgICAgICAgLy8gam91cm5leSB3cmFwcyB0aGlzIHJlc3BvbnNlIGluIGEgYnJvd3Nlci1sZXZlbCBzdHJlYW0gZXJyb3IuXG4gICAgICAgICAgYm9keTogZml4dHVyZS5zdHJlYW1Cb2R5LFxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9XG4gICAgbGV0IHJlcXVlc3RlZE1lc3NhZ2U6IHN0cmluZyB8IHVuZGVmaW5lZDtcbiAgICB0cnkge1xuICAgICAgcmVxdWVzdGVkTWVzc2FnZSA9IChyb3V0ZS5yZXF1ZXN0KCkucG9zdERhdGFKU09OKCkgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4pXG4gICAgICAgIC5tZXNzYWdlIGFzIHN0cmluZyB8IHVuZGVmaW5lZDtcbiAgICB9IGNhdGNoIHtcbiAgICAgIC8vIFRoZSBkZWZhdWx0IHByb3ZpZGVyLXVuYXZhaWxhYmxlIHJlc3BvbnNlIGhhbmRsZXMgbWFsZm9ybWVkIHJlcXVlc3RzLlxuICAgIH1cbiAgICBjb25zdCBzdHJlYW1GaXh0dXJlID1cbiAgICAgIGRpc2Nvbm5lY3RBaSA/P1xuICAgICAgYWlGaXh0dXJlcy5maW5kKFxuICAgICAgICAoZml4dHVyZSkgPT5cbiAgICAgICAgICB0eXBlb2YgcmVxdWVzdGVkTWVzc2FnZSA9PT0gXCJzdHJpbmdcIiAmJlxuICAgICAgICAgIChyZXF1ZXN0ZWRNZXNzYWdlID09PSBmaXh0dXJlLnF1ZXN0aW9uIHx8XG4gICAgICAgICAgICByZXF1ZXN0ZWRNZXNzYWdlLmluY2x1ZGVzKGZpeHR1cmUucXVlc3Rpb24pKSxcbiAgICAgICkgPz9cbiAgICAgIGFyYWJpY0FpO1xuICAgIGlmIChzdHJlYW1GaXh0dXJlICYmIHBhdGguZW5kc1dpdGgoXCIvYXBpL2FpL2NoYXQvc3RyZWFtXCIpKVxuICAgICAgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoe1xuICAgICAgICBzdGF0dXM6IDIwMCxcbiAgICAgICAgY29udGVudFR5cGU6IFwidGV4dC9ldmVudC1zdHJlYW1cIixcbiAgICAgICAgaGVhZGVyczogeyBcIkNhY2hlLUNvbnRyb2xcIjogXCJuby1jYWNoZVwiIH0sXG4gICAgICAgIGJvZHk6IHN0cmVhbUZpeHR1cmUuc3RyZWFtQm9keSxcbiAgICAgIH0pO1xuICAgIGNvbnN0IG1lc3NhZ2VGaXh0dXJlID0gYWlGaXh0dXJlcy5maW5kKChmaXh0dXJlKSA9PlxuICAgICAgcGF0aC5lbmRzV2l0aChgL2FwaS9haS9jaGF0LyR7Zml4dHVyZS5zZXNzaW9uSWR9L21lc3NhZ2VzYCksXG4gICAgKTtcbiAgICBpZiAobWVzc2FnZUZpeHR1cmUpXG4gICAgICByZXR1cm4gcm91dGUuZnVsZmlsbChcbiAgICAgICAganNvblJlc3BvbnNlKFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBpZDogYCR7bWVzc2FnZUZpeHR1cmUuc2Vzc2lvbklkfS11c2VyLW1lc3NhZ2VgLFxuICAgICAgICAgICAgc2Vzc2lvbklkOiBtZXNzYWdlRml4dHVyZS5zZXNzaW9uSWQsXG4gICAgICAgICAgICByb2xlOiBcInVzZXJcIixcbiAgICAgICAgICAgIGNvbnRlbnQ6IG1lc3NhZ2VGaXh0dXJlLnF1ZXN0aW9uLFxuICAgICAgICAgICAgY3JlYXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDE6MDAuMDAwWlwiLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgbWVzc2FnZUZpeHR1cmUubWVzc2FnZSxcbiAgICAgICAgXSksXG4gICAgICApO1xuICAgIGlmIChcbiAgICAgIG92ZXJyaWRlcz8uYXVkaXRFeHBvcnQgJiZcbiAgICAgIHBhdGguZW5kc1dpdGgoXCIvYXBpL2FpL2NoYXQvZTJlLWF1ZGl0LXNlc3Npb24vbWVzc2FnZXNcIilcbiAgICApIHtcbiAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKFxuICAgICAgICBqc29uUmVzcG9uc2UoW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIGlkOiBcImUyZS1hdWRpdC11c2VyLW1lc3NhZ2VcIixcbiAgICAgICAgICAgIHNlc3Npb25JZDogXCJlMmUtYXVkaXQtc2Vzc2lvblwiLFxuICAgICAgICAgICAgcm9sZTogXCJ1c2VyXCIsXG4gICAgICAgICAgICBjb250ZW50OiBcIkNvbXBsZXRlZCBhdWRpdCBleGVjdXRpb25cIixcbiAgICAgICAgICAgIGNyZWF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAxOjAwLjAwMFpcIixcbiAgICAgICAgICB9LFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIGlkOiBcImUyZS1hdWRpdC1hc3Npc3RhbnQtbWVzc2FnZVwiLFxuICAgICAgICAgICAgc2Vzc2lvbklkOiBcImUyZS1hdWRpdC1zZXNzaW9uXCIsXG4gICAgICAgICAgICByb2xlOiBcImFzc2lzdGFudFwiLFxuICAgICAgICAgICAgY29udGVudDogXCJDb21wbGV0ZWQgYXVkaXQgZXhlY3V0aW9uXCIsXG4gICAgICAgICAgICBleGVjdXRpb25JZDogRVhFQ1VUSU9OX0lELFxuICAgICAgICAgICAgb3V0Y29tZTogb3ZlcnJpZGVzLmF1ZGl0RXhwb3J0Lm1lc3NhZ2VPdXRjb21lID8/IFwiU1VDQ0VFREVEXCIsXG4gICAgICAgICAgICBjcmVhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMjowMC4wMDBaXCIsXG4gICAgICAgICAgfSxcbiAgICAgICAgXSksXG4gICAgICApO1xuICAgIH1cblxuICAgIGlmIChwYXRoID09PSBcIi9hcGkvZGFzaGJvYXJkXCIpXG4gICAgICByZXR1cm4gcm91dGUuZnVsZmlsbChqc29uUmVzcG9uc2UoZGFzaGJvYXJkRml4dHVyZSkpO1xuICAgIGlmIChwYXRoID09PSBcIi9hcGkvdGFza3NcIikge1xuICAgICAgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoXG4gICAgICAgIGpzb25SZXNwb25zZShcbiAgICAgICAgICBvdmVycmlkZXM/LnJlY292ZXJ5VGFza3MgPz9cbiAgICAgICAgICAgIChvdmVycmlkZXM/LmxpdmVUYXNrXG4gICAgICAgICAgICAgID8gW1xuICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICBpZDogb3ZlcnJpZGVzLmxpdmVUYXNrLmlkLFxuICAgICAgICAgICAgICAgICAgICBwcm9qZWN0SWQ6IG92ZXJyaWRlcy5saXZlVGFzay5wcm9qZWN0SWQsXG4gICAgICAgICAgICAgICAgICAgIHRpdGxlOiBvdmVycmlkZXMubGl2ZVRhc2sudGl0bGUsXG4gICAgICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiBcIkEgdGFzayB1c2VkIHRvIHZlcmlmeSBsaXZlIGRhc2hib2FyZCB1cGRhdGVzLlwiLFxuICAgICAgICAgICAgICAgICAgICBzdGF0dXM6IFwicnVubmluZ1wiLFxuICAgICAgICAgICAgICAgICAgICBwcmlvcml0eTogXCJwMVwiLFxuICAgICAgICAgICAgICAgICAgICByZWxhdGVkRmlsZXM6IFtdLFxuICAgICAgICAgICAgICAgICAgICByZXRyeUNvdW50OiAwLFxuICAgICAgICAgICAgICAgICAgICBtYXhSZXRyaWVzOiAyLFxuICAgICAgICAgICAgICAgICAgICBjcmVhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMDowMC4wMDBaXCIsXG4gICAgICAgICAgICAgICAgICAgIHVwZGF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAwOjAxLjAwMFpcIixcbiAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgXVxuICAgICAgICAgICAgICA6IFtdKSxcbiAgICAgICAgKSxcbiAgICAgICk7XG4gICAgfVxuICAgIGlmIChwYXRoID09PSBcIi9hcGkvd29ya2Zsb3dzXCIpIHtcbiAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKFxuICAgICAgICBqc29uUmVzcG9uc2Uob3ZlcnJpZGVzPy5yZWNvdmVyeVdvcmtmbG93cyA/PyBbXSksXG4gICAgICApO1xuICAgIH1cbiAgICBjb25zdCB3b3JrZmxvd0V4ZWN1dGlvbnNNYXRjaCA9IHBhdGgubWF0Y2goXG4gICAgICAvXlxcL2FwaVxcL3dvcmtmbG93c1xcLyhbXi9dKylcXC9leGVjdXRpb25zJC8sXG4gICAgKTtcbiAgICBpZiAod29ya2Zsb3dFeGVjdXRpb25zTWF0Y2gpIHtcbiAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKFxuICAgICAgICBqc29uUmVzcG9uc2UoXG4gICAgICAgICAgb3ZlcnJpZGVzPy5yZWNvdmVyeVdvcmtmbG93RXhlY3V0aW9ucz8uW3dvcmtmbG93RXhlY3V0aW9uc01hdGNoWzFdXSA/P1xuICAgICAgICAgICAgW10sXG4gICAgICAgICksXG4gICAgICApO1xuICAgIH1cbiAgICBpZiAoXG4gICAgICBvdmVycmlkZXM/LmF1ZGl0RXhwb3J0ICYmXG4gICAgICBwYXRoID09PSBgL2FwaS9haS9leGVjdXRpb25zLyR7RVhFQ1VUSU9OX0lEfS9hdWRpdC1leHBvcnRgXG4gICAgKSB7XG4gICAgICBvdmVycmlkZXMuYXVkaXRFeHBvcnQucmVxdWVzdHMucHVzaChyb3V0ZS5yZXF1ZXN0KCkudXJsKCkpO1xuICAgICAgaWYgKFxuICAgICAgICBvdmVycmlkZXMuYXVkaXRFeHBvcnQuZmFpbEZpcnN0UHJldmlldyAmJlxuICAgICAgICBvdmVycmlkZXMuYXVkaXRFeHBvcnQucmVxdWVzdHMubGVuZ3RoID09PSAxXG4gICAgICApIHtcbiAgICAgICAgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoXG4gICAgICAgICAganNvblJlc3BvbnNlKFxuICAgICAgICAgICAgeyBlcnJvcjogXCJUZW1wb3JhcnkgcHJldmlldyBuZXR3b3JrIGZhaWx1cmUuXCIgfSxcbiAgICAgICAgICAgIDUwMyxcbiAgICAgICAgICApLFxuICAgICAgICApO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoXG4gICAgICAgIGpzb25SZXNwb25zZShvdmVycmlkZXMuYXVkaXRFeHBvcnQuYm9keSwgMjAwLCB7XG4gICAgICAgICAgXCJDb250ZW50LURpc3Bvc2l0aW9uXCI6IGBhdHRhY2htZW50OyBmaWxlbmFtZT1cIiR7b3ZlcnJpZGVzLmF1ZGl0RXhwb3J0LmZpbGVuYW1lfVwiYCxcbiAgICAgICAgfSksXG4gICAgICApO1xuICAgIH1cbiAgICBpZiAob3ZlcnJpZGVzPy5hcmNoaXZlVXBsb2FkICYmIHBhdGggPT09IFwiL2FwaS91cGxvYWQvYXJjaGl2ZVwiKSB7XG4gICAgICBjb25zdCBjb250ZW50VHlwZSA9IHJvdXRlLnJlcXVlc3QoKS5oZWFkZXJzKClbXCJjb250ZW50LXR5cGVcIl0gPz8gXCJcIjtcbiAgICAgIGlmICghY29udGVudFR5cGUuc3RhcnRzV2l0aChcIm11bHRpcGFydC9mb3JtLWRhdGE7XCIpKSB7XG4gICAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKFxuICAgICAgICAgIGpzb25SZXNwb25zZSh7IGVycm9yOiBcIkV4cGVjdGVkIG11bHRpcGFydCBhcmNoaXZlIHVwbG9hZC5cIiB9LCA0MDApLFxuICAgICAgICApO1xuICAgICAgfVxuICAgICAgY29uc3QgYm9keSA9IHJvdXRlLnJlcXVlc3QoKS5wb3N0RGF0YUJ1ZmZlcigpO1xuICAgICAgaWYgKCFib2R5Py5pbmNsdWRlcyhCdWZmZXIuZnJvbShcImRhc2hib2FyZC1qb3VybmV5LnppcFwiKSkpIHtcbiAgICAgICAgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoXG4gICAgICAgICAganNvblJlc3BvbnNlKHsgZXJyb3I6IFwiRXhwZWN0ZWQgdGhlIGpvdXJuZXkgYXJjaGl2ZSBwYXlsb2FkLlwiIH0sIDQwMCksXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgICByZXR1cm4gcm91dGUuZnVsZmlsbChcbiAgICAgICAganNvblJlc3BvbnNlKFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIHVwbG9hZElkOiBvdmVycmlkZXMuYXJjaGl2ZVVwbG9hZC51cGxvYWRJZCxcbiAgICAgICAgICAgIG9yaWdpbmFsTmFtZTogb3ZlcnJpZGVzLmFyY2hpdmVVcGxvYWQub3JpZ2luYWxOYW1lLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgMjAxLFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIFwiYWNjZXNzLWNvbnRyb2wtYWxsb3ctb3JpZ2luXCI6IG5ldyBVUkwocGFnZS51cmwoKSkub3JpZ2luLFxuICAgICAgICAgICAgXCJhY2Nlc3MtY29udHJvbC1hbGxvdy1jcmVkZW50aWFsc1wiOiBcInRydWVcIixcbiAgICAgICAgICB9LFxuICAgICAgICApLFxuICAgICAgKTtcbiAgICB9XG4gICAgaWYgKG92ZXJyaWRlcz8ubGl2ZVRhc2sgJiYgcGF0aCA9PT0gXCIvYXBpL3Rhc2tzXCIpIHtcbiAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKFxuICAgICAgICBqc29uUmVzcG9uc2UoW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIGlkOiBvdmVycmlkZXMubGl2ZVRhc2suaWQsXG4gICAgICAgICAgICBwcm9qZWN0SWQ6IG92ZXJyaWRlcy5saXZlVGFzay5wcm9qZWN0SWQsXG4gICAgICAgICAgICB0aXRsZTogb3ZlcnJpZGVzLmxpdmVUYXNrLnRpdGxlLFxuICAgICAgICAgICAgZGVzY3JpcHRpb246IFwiQSB0YXNrIHVzZWQgdG8gdmVyaWZ5IGxpdmUgZGFzaGJvYXJkIHVwZGF0ZXMuXCIsXG4gICAgICAgICAgICBzdGF0dXM6IFwicnVubmluZ1wiLFxuICAgICAgICAgICAgcGhhc2U6IFwiRXhlY3V0aW9uXCIsXG4gICAgICAgICAgICByZWxhdGVkRmlsZXM6IFtdLFxuICAgICAgICAgICAgcmV0cnlDb3VudDogMCxcbiAgICAgICAgICAgIG1heFJldHJpZXM6IDIsXG4gICAgICAgICAgICBjcmVhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMDowMC4wMDBaXCIsXG4gICAgICAgICAgICB1cGRhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMDowMS4wMDBaXCIsXG4gICAgICAgICAgfSxcbiAgICAgICAgXSksXG4gICAgICApO1xuICAgIH1cbiAgICBpZiAoXG4gICAgICBvdmVycmlkZXM/LmxpdmVUYXNrICYmXG4gICAgICBwYXRoID09PSBgL2FwaS90YXNrcy8ke292ZXJyaWRlcy5saXZlVGFzay5pZH0vbG9nc2BcbiAgICApIHtcbiAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKGpzb25SZXNwb25zZShvdmVycmlkZXMubGl2ZVRhc2suaW5pdGlhbExvZ3MgPz8gW10pKTtcbiAgICB9XG4gICAgaWYgKFxuICAgICAgb3ZlcnJpZGVzPy5saXZlVGFzayAmJlxuICAgICAgcGF0aCA9PT0gYC9hcGkvdGFza3MvJHtvdmVycmlkZXMubGl2ZVRhc2suaWR9L2xvZ3Mvc3RyZWFtYFxuICAgICkge1xuICAgICAgY29uc3Qgc3RyZWFtUmVxdWVzdHMgPSBvdmVycmlkZXMubGl2ZVRhc2suc3RyZWFtUmVxdWVzdHM7XG4gICAgICBzdHJlYW1SZXF1ZXN0cz8ucHVzaChyb3V0ZS5yZXF1ZXN0KCkudXJsKCkpO1xuICAgICAgaWYgKFxuICAgICAgICAob3ZlcnJpZGVzLmxpdmVUYXNrLmZhaWxGaXJzdFN0cmVhbSAmJiBzdHJlYW1SZXF1ZXN0cz8ubGVuZ3RoID09PSAxKSB8fFxuICAgICAgICAob3ZlcnJpZGVzLmxpdmVUYXNrLmZhaWxTdHJlYW1BdHRlbXB0cyAmJlxuICAgICAgICAgIHN0cmVhbVJlcXVlc3RzICYmXG4gICAgICAgICAgc3RyZWFtUmVxdWVzdHMubGVuZ3RoIDw9IG92ZXJyaWRlcy5saXZlVGFzay5mYWlsU3RyZWFtQXR0ZW1wdHMpXG4gICAgICApIHtcbiAgICAgICAgLy8gRXhlcmNpc2UgdGhlIGJyb3dzZXIncyByZWNvbm5lY3QgcGF0aCB3aXRob3V0IGNoYW5naW5nIHRoZSB0YXNrXG4gICAgICAgIC8vIGxpZmVjeWNsZSBvciBzeW50aGVzaXppbmcgYSBzdWNjZXNzZnVsIHJlc3BvbnNlIGZvciB0aGUgZmlyc3QgdHJ5LlxuICAgICAgICByZXR1cm4gcm91dGUuYWJvcnQoXCJjb25uZWN0aW9ucmVzZXRcIik7XG4gICAgICB9XG4gICAgICByZXR1cm4gcm91dGUuZnVsZmlsbCh7XG4gICAgICAgIHN0YXR1czogMjAwLFxuICAgICAgICBjb250ZW50VHlwZTogXCJ0ZXh0L2V2ZW50LXN0cmVhbVwiLFxuICAgICAgICBoZWFkZXJzOiB7XG4gICAgICAgICAgXCJDYWNoZS1Db250cm9sXCI6IFwibm8tY2FjaGVcIixcbiAgICAgICAgICBcImFjY2Vzcy1jb250cm9sLWFsbG93LW9yaWdpblwiOiBuZXcgVVJMKHBhZ2UudXJsKCkpLm9yaWdpbixcbiAgICAgICAgICBcImFjY2Vzcy1jb250cm9sLWFsbG93LWNyZWRlbnRpYWxzXCI6IFwidHJ1ZVwiLFxuICAgICAgICB9LFxuICAgICAgICBib2R5OiBgZXZlbnQ6IGxvZ1xcbmRhdGE6ICR7SlNPTi5zdHJpbmdpZnkob3ZlcnJpZGVzLmxpdmVUYXNrLmxvZyl9XFxuXFxuYCxcbiAgICAgIH0pO1xuICAgIH1cbiAgICBpZiAocGF0aCA9PT0gXCIvYXBpL3Byb2plY3RzXCIpIHtcbiAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKFxuICAgICAgICBqc29uUmVzcG9uc2UoXG4gICAgICAgICAgb3ZlcnJpZGVzPy5wcm9qZWN0cyA/PyBbXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIGlkOiBcImUyZS1wcm9qZWN0XCIsXG4gICAgICAgICAgICAgIG5hbWU6IFwiU21va2UgUHJvamVjdFwiLFxuICAgICAgICAgICAgICBsYW5ndWFnZTogXCJUeXBlU2NyaXB0XCIsXG4gICAgICAgICAgICAgIGZyYW1ld29yazogXCJSZWFjdFwiLFxuICAgICAgICAgICAgICBzdGF0dXM6IFwiYWN0aXZlXCIsXG4gICAgICAgICAgICAgIHJvb3RQYXRoOiBcIi9jb250cm9sbGVkL3Ntb2tlXCIsXG4gICAgICAgICAgICAgIHF1YWxpdHlTY29yZTogOTIsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIF0sXG4gICAgICAgICksXG4gICAgICApO1xuICAgIH1cbiAgICBpZiAoXG4gICAgICBvdmVycmlkZXM/LmRlbGl2ZXJ5UmVjb3ZlcnkgJiZcbiAgICAgIHBhdGggPT09IFwiL2FwaS9haS9kZWxpdmVyeS9yZWNvdmVyYWJsZVwiXG4gICAgKSB7XG4gICAgICBvdmVycmlkZXMuZGVsaXZlcnlSZWNvdmVyeS5yZXF1ZXN0cy5wdXNoKHJvdXRlLnJlcXVlc3QoKS51cmwoKSk7XG4gICAgICByZXR1cm4gcm91dGUuZnVsZmlsbChcbiAgICAgICAganNvblJlc3BvbnNlKHsgb3BlcmF0aW9uczogb3ZlcnJpZGVzLmRlbGl2ZXJ5UmVjb3Zlcnkub3BlcmF0aW9ucyB9KSxcbiAgICAgICk7XG4gICAgfVxuICAgIGlmIChcbiAgICAgIG92ZXJyaWRlcz8uZGVsaXZlcnlSZWNvdmVyeT8ucmVjb3ZlcnlBY3Rpb24gJiZcbiAgICAgIHBhdGggPT09XG4gICAgICAgIGAvYXBpL2FpL2RlbGl2ZXJ5LyR7b3ZlcnJpZGVzLmRlbGl2ZXJ5UmVjb3ZlcnkucmVjb3ZlcnlBY3Rpb24ucHJvcG9zYWxJZH0vJHtvdmVycmlkZXMuZGVsaXZlcnlSZWNvdmVyeS5yZWNvdmVyeUFjdGlvbi5hY3Rpb259YFxuICAgICkge1xuICAgICAgb3ZlcnJpZGVzLmRlbGl2ZXJ5UmVjb3ZlcnkuYWN0aW9uUmVxdWVzdHM/LnB1c2gocm91dGUucmVxdWVzdCgpLnVybCgpKTtcbiAgICAgIGlmIChvdmVycmlkZXMuZGVsaXZlcnlSZWNvdmVyeS5yZWNvdmVyeUFjdGlvbi5uZXh0T3BlcmF0aW9ucykge1xuICAgICAgICBvdmVycmlkZXMuZGVsaXZlcnlSZWNvdmVyeS5vcGVyYXRpb25zID1cbiAgICAgICAgICBvdmVycmlkZXMuZGVsaXZlcnlSZWNvdmVyeS5yZWNvdmVyeUFjdGlvbi5uZXh0T3BlcmF0aW9ucztcbiAgICAgIH1cbiAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKFxuICAgICAgICBqc29uUmVzcG9uc2UoXG4gICAgICAgICAgb3ZlcnJpZGVzLmRlbGl2ZXJ5UmVjb3ZlcnkucmVjb3ZlcnlBY3Rpb24ucmVzcG9uc2UsXG4gICAgICAgICAgb3ZlcnJpZGVzLmRlbGl2ZXJ5UmVjb3ZlcnkucmVjb3ZlcnlBY3Rpb24uc3RhdHVzID8/IDQwOSxcbiAgICAgICAgKSxcbiAgICAgICk7XG4gICAgfVxuICAgIGlmIChwYXRoID09PSBcIi9hcGkvZXZlbnRzXCIpIHtcbiAgICAgIGNvbnN0IGV2ZW50cyA9IG92ZXJyaWRlcz8uZXZlbnRzID8/IGRhc2hib2FyZEZpeHR1cmUucmVjZW50RXZlbnRzO1xuICAgICAgY29uc3Qgc2VhcmNoID0gdXJsLnNlYXJjaFBhcmFtcy5nZXQoXCJzZWFyY2hcIik/LnRvTG93ZXJDYXNlKCk7XG4gICAgICBjb25zdCBmaWx0ZXJlZEV2ZW50cyA9IGV2ZW50cy5maWx0ZXIoKGV2ZW50KSA9PiB7XG4gICAgICAgIGNvbnN0IHByb2plY3RJZCA9IHVybC5zZWFyY2hQYXJhbXMuZ2V0KFwicHJvamVjdElkXCIpO1xuICAgICAgICBjb25zdCBzZXZlcml0eSA9IHVybC5zZWFyY2hQYXJhbXMuZ2V0KFwic2V2ZXJpdHlcIik7XG4gICAgICAgIGNvbnN0IGNvcnJlbGF0aW9uSWQgPSB1cmwuc2VhcmNoUGFyYW1zLmdldChcImNvcnJlbGF0aW9uSWRcIik7XG4gICAgICAgIHJldHVybiAoXG4gICAgICAgICAgKCFwcm9qZWN0SWQgfHwgZXZlbnQucHJvamVjdElkID09PSBwcm9qZWN0SWQpICYmXG4gICAgICAgICAgKCFzZXZlcml0eSB8fCBldmVudC5zZXZlcml0eSA9PT0gc2V2ZXJpdHkpICYmXG4gICAgICAgICAgKCFjb3JyZWxhdGlvbklkIHx8IGV2ZW50LmNvcnJlbGF0aW9uSWQgPT09IGNvcnJlbGF0aW9uSWQpICYmXG4gICAgICAgICAgKCFzZWFyY2ggfHxcbiAgICAgICAgICAgIFtldmVudC5tZXNzYWdlLCBldmVudC50eXBlLCBldmVudC5jb3JyZWxhdGlvbklkXVxuICAgICAgICAgICAgICAuZmlsdGVyKCh2YWx1ZSk6IHZhbHVlIGlzIHN0cmluZyA9PiB0eXBlb2YgdmFsdWUgPT09IFwic3RyaW5nXCIpXG4gICAgICAgICAgICAgIC5zb21lKCh2YWx1ZSkgPT4gdmFsdWUudG9Mb3dlckNhc2UoKS5pbmNsdWRlcyhzZWFyY2gpKSlcbiAgICAgICAgKTtcbiAgICAgIH0pO1xuICAgICAgY29uc3QgbGltaXQgPSBOdW1iZXIodXJsLnNlYXJjaFBhcmFtcy5nZXQoXCJsaW1pdFwiKSkgfHwgNTA7XG4gICAgICBjb25zdCBwYWdlID0gTnVtYmVyKHVybC5zZWFyY2hQYXJhbXMuZ2V0KFwicGFnZVwiKSkgfHwgMTtcbiAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKFxuICAgICAgICBqc29uUmVzcG9uc2Uoe1xuICAgICAgICAgIGV2ZW50czogZmlsdGVyZWRFdmVudHMuc2xpY2UoKHBhZ2UgLSAxKSAqIGxpbWl0LCBwYWdlICogbGltaXQpLFxuICAgICAgICAgIHRvdGFsOiBmaWx0ZXJlZEV2ZW50cy5sZW5ndGgsXG4gICAgICAgIH0pLFxuICAgICAgKTtcbiAgICB9XG4gICAgaWYgKFxuICAgICAgb3ZlcnJpZGVzPy5yZXN1bWVGYWlsdXJlICYmXG4gICAgICBwYXRoID09PVxuICAgICAgICBgL2FwaS9haS9leGVjdXRpb25zLyR7b3ZlcnJpZGVzLnJlc3VtZUZhaWx1cmUuZml4dHVyZS5leGVjdXRpb25JZH1gXG4gICAgKSB7XG4gICAgICByZXR1cm4gcm91dGUuZnVsZmlsbChqc29uUmVzcG9uc2Uob3ZlcnJpZGVzLnJlc3VtZUZhaWx1cmUuZXhlY3V0aW9uKSk7XG4gICAgfVxuICAgIGlmIChcbiAgICAgIG92ZXJyaWRlcz8uaW50ZXJydXB0ZWRSZXN1bWUgJiZcbiAgICAgIHBhdGggPT09XG4gICAgICAgIGAvYXBpL2FpL2V4ZWN1dGlvbnMvJHtvdmVycmlkZXMuaW50ZXJydXB0ZWRSZXN1bWUuZml4dHVyZS5leGVjdXRpb25JZH1gXG4gICAgKSB7XG4gICAgICByZXR1cm4gcm91dGUuZnVsZmlsbChqc29uUmVzcG9uc2Uob3ZlcnJpZGVzLmludGVycnVwdGVkUmVzdW1lLmV4ZWN1dGlvbikpO1xuICAgIH1cbiAgICBpZiAoXG4gICAgICBvdmVycmlkZXM/LmludGVycnVwdGVkUmVzdW1lICYmXG4gICAgICBwYXRoID09PVxuICAgICAgICBgL2FwaS9haS9leGVjdXRpb25zLyR7b3ZlcnJpZGVzLmludGVycnVwdGVkUmVzdW1lLmZpeHR1cmUuZXhlY3V0aW9uSWR9L3Jlc3VtZS1jYXBhYmlsaXR5YFxuICAgICkge1xuICAgICAgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoXG4gICAgICAgIGpzb25SZXNwb25zZSh7XG4gICAgICAgICAgZXhlY3V0aW9uSWQ6IG92ZXJyaWRlcy5pbnRlcnJ1cHRlZFJlc3VtZS5maXh0dXJlLmV4ZWN1dGlvbklkLFxuICAgICAgICAgIHJlc3VtZVRva2VuOiBvdmVycmlkZXMuaW50ZXJydXB0ZWRSZXN1bWUucmVjb3ZlcmVkVG9rZW4sXG4gICAgICAgIH0pLFxuICAgICAgKTtcbiAgICB9XG4gICAgaWYgKHBhdGggPT09IGAvYXBpL2FpL2V4ZWN1dGlvbnMvJHtFWEVDVVRJT05fSUR9YClcbiAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKFxuICAgICAgICBqc29uUmVzcG9uc2Uob3ZlcnJpZGVzPy5hdWRpdEV4cG9ydD8uZXhlY3V0aW9uID8/IGV4ZWN1dGlvbkZpeHR1cmUpLFxuICAgICAgKTtcbiAgICBpZiAocGF0aCA9PT0gXCIvYXBpL2FpL21pc3Npb24tY29udHJvbFwiKVxuICAgICAgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoXG4gICAgICAgIGpzb25SZXNwb25zZSh7IHVwZGF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAxOjAwLjAwMFpcIiwgZXhlY3V0aW9uczogW10gfSksXG4gICAgICApO1xuXG4gICAgLy8gQUkgaXMgZGVsaWJlcmF0ZWx5IG5vdCBleGVjdXRlZCBpbiB0aGlzIHNtb2tlIGpvdXJuZXkuIFRoaXMgcmVzcG9uc2VcbiAgICAvLyB2ZXJpZmllcyB0aGUgdXNlci12aXNpYmxlIHVuYXZhaWxhYmxlL2VtcHR5IHN0YXRlIHdpdGhvdXQgYSBwcm92aWRlci5cbiAgICBpZiAocGF0aC5zdGFydHNXaXRoKFwiL2FwaS9haS9cIikpXG4gICAgICByZXR1cm4gcm91dGUuZnVsZmlsbChcbiAgICAgICAganNvblJlc3BvbnNlKHsgZXJyb3I6IFwiQUkgcHJvdmlkZXIgbm90IGNvbmZpZ3VyZWRcIiB9LCA0MjgpLFxuICAgICAgKTtcblxuICAgIHJldHVybiByb3V0ZS5jb250aW51ZSgpO1xuICB9KTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gaW5zdGFsbEFyYWJpY0FpRml4dHVyZShcbiAgcGFnZTogUGFnZSxcbiAgb3B0aW9ucz86IHtcbiAgICBibG9ja2VkPzogYm9vbGVhbjtcbiAgICBzZXNzaW9uSWQ/OiBzdHJpbmc7XG4gICAgcXVlc3Rpb24/OiBzdHJpbmc7XG4gICAgcHJvamVjdElkPzogc3RyaW5nO1xuICB9LFxuKSB7XG4gIGNvbnN0IHNlc3Npb25JZCA9IG9wdGlvbnM/LnNlc3Npb25JZCA/PyBcImUyZS1hcmFiaWMtYWktc2Vzc2lvblwiO1xuICBjb25zdCBtZXNzYWdlSWQgPSBcImUyZS1hcmFiaWMtYWktbWVzc2FnZVwiO1xuICBjb25zdCBzb3VyY2UgPSBcInNyYy9leGVjdXRpb24tdG9vbHMudHNcIjtcbiAgY29uc3QgYmxvY2tlZCA9IG9wdGlvbnM/LmJsb2NrZWQgPT09IHRydWU7XG4gIGNvbnN0IHF1ZXN0aW9uID1cbiAgICBvcHRpb25zPy5xdWVzdGlvbiA/P1xuICAgIFwi2YXYp9iw2Kcg2YrYrdiv2Ksg2LnZhtivINin2YbYqtmH2KfYoSDZhdmH2YTYqSBwcm92aWRlciB0aW1lb3V0INiv2KfYrtmEIGV4ZWN1dGlvbi10b29scy50c9ifXCI7XG4gIGNvbnN0IGFuc3dlciA9XG4gICAgXCLYudmG2K8g2KfZhtiq2YfYp9ihINmF2YfZhNipINmF2LLZiNivINin2YTYsNmD2KfYoSDYp9mE2KfYtdi32YbYp9i52YrYjCDZiti52YrYryDYp9mE2YXYs9in2LEg2KrZgtix2YrYsdmL2Kcg2KzYstim2YrZi9inINmF2YYg2KfZhNij2K/ZhNipINin2YTYqtmKINis2Y/Zhdi52Kog2KjYr9mEINil2LXYr9in2LEgRmluZGluZyDYutmK2LEg2YXYq9io2KouXCI7XG4gIGNvbnN0IGV2aWRlbmNlID0gW1xuICAgIHtcbiAgICAgIHNvdXJjZSxcbiAgICAgIC4uLihibG9ja2VkXG4gICAgICAgID8ge1xuICAgICAgICAgICAgZXhjZXJwdDogXCJwcm92aWRlciB0aW1lb3V0IGlzIGhhbmRsZWQgaGVyZVwiLFxuICAgICAgICAgICAgc3VwcG9ydHNDbGFpbTogZmFsc2UsXG4gICAgICAgICAgICBldmlkZW5jZUNsYXNzOiBcIlJFQURfQ09ORklSTUVEXCIsXG4gICAgICAgICAgICBjaXRhdGlvblN0YXR1czogXCJCTE9DS0VEXCIsXG4gICAgICAgICAgICBjaXRhdGlvblJlYXNvbjogXCJNSVNTSU5HX0xJVEVSQUxfTUFUQ0hcIixcbiAgICAgICAgICB9XG4gICAgICAgIDoge1xuICAgICAgICAgICAgZXhjZXJwdDogJ3JldHVybiBwYXJ0aWFsRnJvbUNvbGxlY3RlZEV2aWRlbmNlKFwicHJvdmlkZXIgdGltZW91dFwiKTsnLFxuICAgICAgICAgICAgc291cmNlU3BhbjogeyBzdGFydExpbmU6IDQyLCBlbmRMaW5lOiA0MiB9LFxuICAgICAgICAgICAgc3VwcG9ydHNDbGFpbTogdHJ1ZSxcbiAgICAgICAgICAgIGV2aWRlbmNlQ2xhc3M6IFwiQkVIQVZJT1JfUFJPVkVOXCIsXG4gICAgICAgICAgICBjaXRhdGlvblN0YXR1czogXCJBQ0NFUFRFRFwiLFxuICAgICAgICAgICAgY2l0YXRpb25SZWFzb246IFwiQUNDRVBURURfU09VUkNFX1NQQU5cIixcbiAgICAgICAgICB9KSxcbiAgICB9LFxuICBdO1xuICBjb25zdCB0b29sVHJhY2UgPSBbXG4gICAge1xuICAgICAga2luZDogXCJ0b29sX2NhbGxcIixcbiAgICAgIHRvb2w6IFwicmVhZF9maWxlXCIsXG4gICAgICBhcmdzOiB7IHBhdGg6IHNvdXJjZSB9LFxuICAgICAgY2FjaGVkOiBmYWxzZSxcbiAgICAgIHByZWZldGNoZWQ6IHRydWUsXG4gICAgfSxcbiAgICB7XG4gICAgICBraW5kOiBcInRvb2xfcmVzdWx0XCIsXG4gICAgICB0b29sOiBcInJlYWRfZmlsZVwiLFxuICAgICAgc291cmNlLFxuICAgICAgY2FjaGVkOiBmYWxzZSxcbiAgICAgIHByZWZldGNoZWQ6IHRydWUsXG4gICAgfSxcbiAgICB7XG4gICAgICBraW5kOiBcImV2aWRlbmNlX2ludGVncml0eVwiLFxuICAgICAgY29kZTogXCJFVklERU5DRV9JTlRFR1JJVFlfT0tcIixcbiAgICAgIGNvbnNpc3RlbnQ6IHRydWUsXG4gICAgICB2aW9sYXRpb25zOiBbXSxcbiAgICAgIGV2aWRlbmNlRmlsZUNvdW50OiAxLFxuICAgICAgYWNjZXB0ZWRFdmlkZW5jZUNvdW50OiAxLFxuICAgICAgY29tcGxldGVkUmVhZEZpbGVzOiBbc291cmNlXSxcbiAgICAgIGFjY2VwdGVkRXZpZGVuY2VGaWxlczogW3NvdXJjZV0sXG4gICAgICBvYmplY3RpdmVUeXBlOiBcIlBST0RVQ1RJT05fUkVBQ0hBQklMSVRZXCIsXG4gICAgICByZXF1aXJlZEVkZ2VzOiBbXCJjbGllbnQtPnNlcnZlclwiLCBcInNlcnZlci0+ZGF0YWJhc2VcIl0sXG4gICAgICBwcm92ZW5FZGdlczogW1wiY2xpZW50LT5zZXJ2ZXJcIl0sXG4gICAgICBjb21wbGV0aW9uR2F0ZVJlc3VsdDogXCJQQVJUSUFMTFlfUFJPVkVOXCIsXG4gICAgICBmaW5hbEFuc3dlclR5cGU6IFwiUFJPRFVDVElPTl9SRUFDSEFCSUxJVFlfQU5TV0VSXCIsXG4gICAgfSxcbiAgXTtcbiAgY29uc3QgdGFza1Jlc3VsdCA9IHtcbiAgICBraW5kOiBcIkJFSEFWSU9SX0FOU1dFUl9SRVNVTFRcIixcbiAgICBhbnN3ZXI6IHtcbiAgICAgIGFuc3dlcixcbiAgICAgIGV2aWRlbmNlLFxuICAgICAgY29uZmlkZW5jZTogMSxcbiAgICAgIHNvdXJjZVNjb3BlOiBbc291cmNlXSxcbiAgICAgIGNvdmVyYWdlOiB7XG4gICAgICAgIHJlcXVlc3RlZEZpZWxkczogW1widGltZW91dCBiZWhhdmlvclwiXSxcbiAgICAgICAgYW5zd2VyZWRGaWVsZHM6IFtcInRpbWVvdXQgYmVoYXZpb3JcIl0sXG4gICAgICAgIG1pc3NpbmdGaWVsZHM6IFtdLFxuICAgICAgICBjb21wbGV0ZTogdHJ1ZSxcbiAgICAgIH0sXG4gICAgfSxcbiAgfTtcbiAgY29uc3QgbWVzc2FnZSA9IHtcbiAgICBpZDogbWVzc2FnZUlkLFxuICAgIHNlc3Npb25JZCxcbiAgICByb2xlOiBcImFzc2lzdGFudFwiLFxuICAgIGNvbnRlbnQ6IGAke2Fuc3dlcn1cXG5cXG4jIyA2KSBGaW5hbCBKdWRnbWVudFxcbk5PVCBQUk9WRU5gLFxuICAgIG9wZXJhdGlvbk1vZGU6IFwiRk9SRU5TSUNfQVVESVRcIixcbiAgICBzb3VyY2VzOiBbc291cmNlXSxcbiAgICB0b29sVHJhY2U6IEpTT04uc3RyaW5naWZ5KHRvb2xUcmFjZSksXG4gICAgYmVoYXZpb3JFdmlkZW5jZTogZXZpZGVuY2UsXG4gICAgdGFza1Jlc3VsdCxcbiAgICBjcmVhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMjowMC4wMDBaXCIsXG4gIH07XG4gIGNvbnN0IHNzZSA9IChldmVudDogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pID0+XG4gICAgYGRhdGE6ICR7SlNPTi5zdHJpbmdpZnkoZXZlbnQpfVxcblxcbmA7XG4gIGNvbnN0IHN0cmVhbUJvZHkgPSBbXG4gICAgc3NlKHsgdHlwZTogXCJzZXNzaW9uX3N0YXJ0ZWRcIiwgc2Vzc2lvbklkIH0pLFxuICAgIHNzZSh7XG4gICAgICB0eXBlOiBcImV4ZWN1dGlvbl9zdGFydGVkXCIsXG4gICAgICBleGVjdXRpb25JZDogXCJlMmUtZXhlY3V0aW9uXCIsXG4gICAgICBzdGF0dXM6IFwicnVubmluZ1wiLFxuICAgICAgcmVzdW1hYmxlOiB0cnVlLFxuICAgIH0pLFxuICAgIHNzZSh7IHR5cGU6IFwic3RhZ2VcIiwgc3RhZ2U6IFwiYnVpbGRpbmctY29udGV4dFwiIH0pLFxuICAgIHNzZSh7IHR5cGU6IFwic3RhZ2VcIiwgc3RhZ2U6IFwiY2FsbGluZy1tb2RlbFwiIH0pLFxuICAgIHNzZSh7XG4gICAgICB0eXBlOiBcInRvb2xfY2FsbFwiLFxuICAgICAgdG9vbDogXCJyZWFkX2ZpbGVcIixcbiAgICAgIGFyZ3M6IHsgcGF0aDogc291cmNlIH0sXG4gICAgICBjYWNoZWQ6IGZhbHNlLFxuICAgICAgcHJlZmV0Y2hlZDogdHJ1ZSxcbiAgICB9KSxcbiAgICBzc2Uoe1xuICAgICAgdHlwZTogXCJ0b29sX3Jlc3VsdFwiLFxuICAgICAgdG9vbDogXCJyZWFkX2ZpbGVcIixcbiAgICAgIHNvdXJjZSxcbiAgICAgIGNhY2hlZDogZmFsc2UsXG4gICAgICBwcmVmZXRjaGVkOiB0cnVlLFxuICAgIH0pLFxuICAgIHNzZSh7XG4gICAgICB0eXBlOiBcImV2aWRlbmNlX2ludGVncml0eVwiLFxuICAgICAgY29kZTogXCJFVklERU5DRV9JTlRFR1JJVFlfT0tcIixcbiAgICAgIGNvbnNpc3RlbnQ6IHRydWUsXG4gICAgICB2aW9sYXRpb25zOiBbXSxcbiAgICAgIGV2aWRlbmNlRmlsZUNvdW50OiAxLFxuICAgICAgYWNjZXB0ZWRFdmlkZW5jZUNvdW50OiAxLFxuICAgICAgY29tcGxldGVkUmVhZEZpbGVzOiBbc291cmNlXSxcbiAgICAgIGFjY2VwdGVkRXZpZGVuY2VGaWxlczogW3NvdXJjZV0sXG4gICAgICBvYmplY3RpdmVUeXBlOiBcIlBST0RVQ1RJT05fUkVBQ0hBQklMSVRZXCIsXG4gICAgICByZXF1aXJlZEVkZ2VzOiBbXCJjbGllbnQtPnNlcnZlclwiLCBcInNlcnZlci0+ZGF0YWJhc2VcIl0sXG4gICAgICBwcm92ZW5FZGdlczogW1wiY2xpZW50LT5zZXJ2ZXJcIl0sXG4gICAgICBjb21wbGV0aW9uR2F0ZVJlc3VsdDogXCJQQVJUSUFMTFlfUFJPVkVOXCIsXG4gICAgICBmaW5hbEFuc3dlclR5cGU6IFwiUFJPRFVDVElPTl9SRUFDSEFCSUxJVFlfQU5TV0VSXCIsXG4gICAgfSksXG4gICAgc3NlKHsgdHlwZTogXCJkZWx0YVwiLCBkZWx0YTogYW5zd2VyIH0pLFxuICAgIHNzZSh7XG4gICAgICB0eXBlOiBcImRvbmVcIixcbiAgICAgIHNlc3Npb25JZCxcbiAgICAgIG1lc3NhZ2UsXG4gICAgICBzb3VyY2VzOiBbc291cmNlXSxcbiAgICAgIHRvb2xUcmFjZTogSlNPTi5zdHJpbmdpZnkodG9vbFRyYWNlKSxcbiAgICAgIGJlaGF2aW9yRXZpZGVuY2U6IGV2aWRlbmNlLFxuICAgICAgdGFza1Jlc3VsdCxcbiAgICAgIHBlbmRpbmdDaGFuZ2VzOiBbXSxcbiAgICB9KSxcbiAgXS5qb2luKFwiXCIpO1xuXG4gIHJldHVybiB7XG4gICAgcXVlc3Rpb24sXG4gICAgYW5zd2VyLFxuICAgIHNvdXJjZSxcbiAgICBzZXNzaW9uSWQsXG4gICAgcHJvamVjdElkOiBvcHRpb25zPy5wcm9qZWN0SWQsXG4gICAgc3RyZWFtQm9keSxcbiAgICBtZXNzYWdlLFxuICB9O1xufVxuXG5mdW5jdGlvbiBpbnN0YWxsVG9vbEZhaWx1cmVGaXh0dXJlKCk6IEFyYWJpY0FpRml4dHVyZSB7XG4gIGNvbnN0IHNlc3Npb25JZCA9IFwiZTJlLXRvb2wtZmFpbHVyZS1zZXNzaW9uXCI7XG4gIGNvbnN0IG1lc3NhZ2VJZCA9IFwiZTJlLXRvb2wtZmFpbHVyZS1tZXNzYWdlXCI7XG4gIGNvbnN0IHNvdXJjZSA9IFwic3JjL21pc3NpbmctcmVsZWFzZS1maXh0dXJlLnRzXCI7XG4gIGNvbnN0IHF1ZXN0aW9uID0gXCJXaGljaCBzb3VyY2UgZmlsZSBpcyBhdmFpbGFibGUgZm9yIHRoZSByZWxlYXNlIGNoZWNrP1wiO1xuICBjb25zdCBhbnN3ZXIgPVxuICAgIFwiQU5BTFlTSVNfSU5DT01QTEVURTogVGhlIHJlcXVpcmVkIHNvdXJjZSByZWFkIGRpZCBub3QgY29tcGxldGUsIHNvIG5vIHZlcmlmaWVkIHJlc3VsdCBpcyBhdmFpbGFibGUuXCI7XG4gIGNvbnN0IGRpYWdub3N0aWNDb2RlID0gXCJUT09MX0VYRUNVVElPTl9GQUlMRURcIjtcbiAgY29uc3QgdG9vbFRyYWNlID0gW1xuICAgIHtcbiAgICAgIGtpbmQ6IFwidG9vbF9jYWxsXCIsXG4gICAgICB0b29sOiBcInJlYWRfZmlsZVwiLFxuICAgICAgYXJnczogeyBwYXRoOiBzb3VyY2UgfSxcbiAgICAgIGNhY2hlZDogZmFsc2UsXG4gICAgfSxcbiAgICB7XG4gICAgICBraW5kOiBcInRvb2xfcmVzdWx0XCIsXG4gICAgICB0b29sOiBcInJlYWRfZmlsZVwiLFxuICAgICAgc291cmNlLFxuICAgICAgcmVzdWx0S2luZDogXCJmYWlsZWRcIixcbiAgICAgIGRpYWdub3N0aWNDb2RlLFxuICAgICAgcmVzdWx0U3VtbWFyeTogXCJUaGUgcmVxdWlyZWQgc291cmNlIHJlYWQgZGlkIG5vdCBjb21wbGV0ZS5cIixcbiAgICB9LFxuICAgIHtcbiAgICAgIGtpbmQ6IFwiZG9uZVwiLFxuICAgICAgc3RvcFJlYXNvbjogXCJ0b29sX2ZhaWx1cmVcIixcbiAgICAgIGl0ZXJhdGlvbnM6IDEsXG4gICAgICBtYXhJdGVyYXRpb25zOiA4LFxuICAgICAgdG9vbENhbGxzOiAxLFxuICAgICAgcHJlZmV0Y2hUb29sQ2FsbHM6IDAsXG4gICAgICBsb29wVG9vbENhbGxzOiAxLFxuICAgICAgc3ludGhlc2lzU3RhcnRlZDogZmFsc2UsXG4gICAgICBkaWFnbm9zdGljQ29kZXM6IFtkaWFnbm9zdGljQ29kZV0sXG4gICAgfSxcbiAgXTtcbiAgY29uc3QgbWVzc2FnZSA9IHtcbiAgICBpZDogbWVzc2FnZUlkLFxuICAgIHNlc3Npb25JZCxcbiAgICByb2xlOiBcImFzc2lzdGFudFwiLFxuICAgIGNvbnRlbnQ6IGFuc3dlcixcbiAgICB0b29sVHJhY2U6IEpTT04uc3RyaW5naWZ5KHRvb2xUcmFjZSksXG4gICAgY3JlYXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDI6MDAuMDAwWlwiLFxuICB9O1xuICBjb25zdCBzc2UgPSAoZXZlbnQ6IFJlY29yZDxzdHJpbmcsIHVua25vd24+KSA9PlxuICAgIGBkYXRhOiAke0pTT04uc3RyaW5naWZ5KGV2ZW50KX1cXG5cXG5gO1xuICBjb25zdCBzdHJlYW1Cb2R5ID0gW1xuICAgIHNzZSh7IHR5cGU6IFwic2Vzc2lvbl9zdGFydGVkXCIsIHNlc3Npb25JZCB9KSxcbiAgICBzc2Uoe1xuICAgICAgdHlwZTogXCJleGVjdXRpb25fc3RhcnRlZFwiLFxuICAgICAgZXhlY3V0aW9uSWQ6IFwiZTJlLXRvb2wtZmFpbHVyZS1leGVjdXRpb25cIixcbiAgICAgIHN0YXR1czogXCJydW5uaW5nXCIsXG4gICAgICByZXN1bWFibGU6IHRydWUsXG4gICAgfSksXG4gICAgc3NlKHtcbiAgICAgIHR5cGU6IFwidG9vbF9jYWxsXCIsXG4gICAgICB0b29sOiBcInJlYWRfZmlsZVwiLFxuICAgICAgYXJnczogeyBwYXRoOiBzb3VyY2UgfSxcbiAgICAgIGNhY2hlZDogZmFsc2UsXG4gICAgfSksXG4gICAgc3NlKHtcbiAgICAgIHR5cGU6IFwidG9vbF9yZXN1bHRcIixcbiAgICAgIHRvb2w6IFwicmVhZF9maWxlXCIsXG4gICAgICBzb3VyY2UsXG4gICAgICByZXN1bHRLaW5kOiBcImZhaWxlZFwiLFxuICAgICAgZGlhZ25vc3RpY0NvZGUsXG4gICAgICByZXN1bHRTdW1tYXJ5OiBcIlRoZSByZXF1aXJlZCBzb3VyY2UgcmVhZCBkaWQgbm90IGNvbXBsZXRlLlwiLFxuICAgIH0pLFxuICAgIHNzZSh7IHR5cGU6IFwiZGVsdGFcIiwgZGVsdGE6IGFuc3dlciB9KSxcbiAgICBzc2Uoe1xuICAgICAgdHlwZTogXCJkb25lXCIsXG4gICAgICBzZXNzaW9uSWQsXG4gICAgICBtZXNzYWdlLFxuICAgICAgdG9vbFRyYWNlOiBKU09OLnN0cmluZ2lmeSh0b29sVHJhY2UpLFxuICAgICAgcGVuZGluZ0NoYW5nZXM6IFtdLFxuICAgIH0pLFxuICBdLmpvaW4oXCJcIik7XG5cbiAgcmV0dXJuIHtcbiAgICBxdWVzdGlvbixcbiAgICBhbnN3ZXIsXG4gICAgc291cmNlLFxuICAgIHNlc3Npb25JZCxcbiAgICBzdHJlYW1Cb2R5LFxuICAgIG1lc3NhZ2UsXG4gIH07XG59XG5cbmZ1bmN0aW9uIGluc3RhbGxEaXNjb25uZWN0ZWRBaUZpeHR1cmUoKTogQXJhYmljQWlGaXh0dXJlIHtcbiAgY29uc3Qgc2Vzc2lvbklkID0gXCJlMmUtZGlzY29ubmVjdGVkLWFpLXNlc3Npb25cIjtcbiAgY29uc3QgZXhlY3V0aW9uSWQgPSBcImUyZS1kaXNjb25uZWN0ZWQtYWktZXhlY3V0aW9uXCI7XG4gIGNvbnN0IHF1ZXN0aW9uID1cbiAgICBcIldoYXQgaGFwcGVucyB3aGVuIHRoZSBtb2RlbCBkaXNjb25uZWN0cyBhZnRlciBzdGFydGluZyBhbiBhbnN3ZXI/XCI7XG4gIGNvbnN0IGFuc3dlciA9XG4gICAgXCJUaGUgbW9kZWwgc3RhcnRlZCBhbiBhbnN3ZXIsIGJ1dCB0aGUgcHJvdmlkZXIgZGlzY29ubmVjdGVkIGJlZm9yZSBjb21wbGV0aW9uLlwiO1xuICBjb25zdCBkaWFnbm9zdGljQ29kZSA9IFwiRVhFQ1VUSU9OX1BST1ZJREVSX0ZBSUxVUkVcIjtcbiAgY29uc3QgdG9vbFRyYWNlID0gW1xuICAgIHtcbiAgICAgIGtpbmQ6IFwiZG9uZVwiLFxuICAgICAgc3RvcFJlYXNvbjogXCJwcm92aWRlcl90aW1lb3V0XCIsXG4gICAgICBpdGVyYXRpb25zOiAxLFxuICAgICAgbWF4SXRlcmF0aW9uczogOCxcbiAgICAgIHRvb2xDYWxsczogMCxcbiAgICAgIHByZWZldGNoVG9vbENhbGxzOiAwLFxuICAgICAgbG9vcFRvb2xDYWxsczogMCxcbiAgICAgIHN5bnRoZXNpc1N0YXJ0ZWQ6IGZhbHNlLFxuICAgICAgZGlhZ25vc3RpY0NvZGVzOiBbZGlhZ25vc3RpY0NvZGVdLFxuICAgICAgZGlhZ25vc3RpY0RldGFpbHM6IFtcbiAgICAgICAgXCJUaGUgcHJvdmlkZXIgZGlzY29ubmVjdGVkIGFmdGVyIHZpc2libGUgcmVzcG9uc2UgdGV4dC5cIixcbiAgICAgIF0sXG4gICAgfSxcbiAgXTtcbiAgY29uc3QgbWVzc2FnZSA9IHtcbiAgICBpZDogXCJlMmUtZGlzY29ubmVjdGVkLWFpLW1lc3NhZ2VcIixcbiAgICBzZXNzaW9uSWQsXG4gICAgcm9sZTogXCJhc3Npc3RhbnRcIixcbiAgICBjb250ZW50OiBhbnN3ZXIsXG4gICAgdG9vbFRyYWNlOiBKU09OLnN0cmluZ2lmeSh0b29sVHJhY2UpLFxuICAgIG91dGNvbWU6IFwiRkFJTEVEXCIsXG4gICAgZXJyb3JDb2RlOiBkaWFnbm9zdGljQ29kZSxcbiAgICBlcnJvck1lc3NhZ2U6IFwiVGhlIHByb3ZpZGVyIGRpc2Nvbm5lY3RlZCBiZWZvcmUgY29tcGxldGlvbi5cIixcbiAgICBleGVjdXRpb25JZCxcbiAgICBjcmVhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMjowMC4wMDBaXCIsXG4gIH07XG4gIGNvbnN0IHNzZSA9IChldmVudDogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pID0+XG4gICAgYGRhdGE6ICR7SlNPTi5zdHJpbmdpZnkoZXZlbnQpfVxcblxcbmA7XG4gIGNvbnN0IHN0cmVhbUJvZHkgPSBbXG4gICAgc3NlKHsgdHlwZTogXCJzZXNzaW9uX3N0YXJ0ZWRcIiwgc2Vzc2lvbklkIH0pLFxuICAgIHNzZSh7XG4gICAgICB0eXBlOiBcImV4ZWN1dGlvbl9zdGFydGVkXCIsXG4gICAgICBleGVjdXRpb25JZCxcbiAgICAgIHN0YXR1czogXCJydW5uaW5nXCIsXG4gICAgICByZXN1bWFibGU6IHRydWUsXG4gICAgfSksXG4gICAgc3NlKHsgdHlwZTogXCJzdGFnZVwiLCBzdGFnZTogXCJjYWxsaW5nLW1vZGVsXCIgfSksXG4gICAgc3NlKHsgdHlwZTogXCJkZWx0YVwiLCBkZWx0YTogYW5zd2VyIH0pLFxuICAgIC8vIFRoZSByZWFsIHJvdXRlIGVtaXRzIHRoaXMgYWZ0ZXIgYSBwcm92aWRlciBkaXNjb25uZWN0IHNvIHRoZSBjbGllbnRcbiAgICAvLyBkcm9wcyB0aGUgdHJhbnNpZW50IGJ1YmJsZSBiZWZvcmUgcmVuZGVyaW5nIHRoZSBwZXJzaXN0ZWQgcmVzdWx0LlxuICAgIHNzZSh7IHR5cGU6IFwic3RyZWFtX3Jlc2V0XCIgfSksXG4gICAgc3NlKHtcbiAgICAgIHR5cGU6IFwiZG9uZVwiLFxuICAgICAgc2Vzc2lvbklkLFxuICAgICAgZXhlY3V0aW9uSWQsXG4gICAgICBtZXNzYWdlLFxuICAgICAgcGVuZGluZ0NoYW5nZXM6IFtdLFxuICAgIH0pLFxuICBdLmpvaW4oXCJcIik7XG5cbiAgcmV0dXJuIHtcbiAgICBxdWVzdGlvbixcbiAgICBhbnN3ZXIsXG4gICAgc291cmNlOiBcInByb3ZpZGVyXCIsXG4gICAgc2Vzc2lvbklkLFxuICAgIGV4ZWN1dGlvbklkLFxuICAgIHN0cmVhbUJvZHksXG4gICAgbWVzc2FnZSxcbiAgfTtcbn1cblxuZnVuY3Rpb24gaW5zdGFsbFJlc3VtZWRBbmFseXNpc0ZhaWx1cmVGaXh0dXJlKCkge1xuICBjb25zdCBzZXNzaW9uSWQgPSBcImUyZS1yZXN1bWVkLWFuYWx5c2lzLWZhaWx1cmUtc2Vzc2lvblwiO1xuICBjb25zdCBleGVjdXRpb25JZCA9IFwiZTJlLXJlc3VtZWQtYW5hbHlzaXMtZmFpbHVyZS1leGVjdXRpb25cIjtcbiAgY29uc3QgcmVzdW1lVG9rZW4gPSBcImUyZS1yZXN1bWVkLWFuYWx5c2lzLWZhaWx1cmUtdG9rZW4tb3BhcXVlXCI7XG4gIGNvbnN0IHF1ZXN0aW9uID0gXCJWZXJpZnkgdGhlIGFuYWx5c2lzIGV2aWRlbmNlIGFmdGVyIHJlY29ubmVjdC5cIjtcbiAgY29uc3QgYW5zd2VyID1cbiAgICBcIkFOQUxZU0lTX0lOQ09NUExFVEU6IFRoZSByZXF1aXJlZCBhbmFseXNpcyBkaWQgbm90IGNvbXBsZXRlLCBzbyBubyB2ZXJpZmllZCByZXN1bHQgaXMgYXZhaWxhYmxlLlwiO1xuICBjb25zdCBkaWFnbm9zdGljQ29kZSA9IFwiVE9PTF9VTkFWQUlMQUJMRVwiO1xuICBjb25zdCBzc2UgPSAoZXZlbnQ6IFJlY29yZDxzdHJpbmcsIHVua25vd24+KSA9PlxuICAgIGBkYXRhOiAke0pTT04uc3RyaW5naWZ5KGV2ZW50KX1cXG5cXG5gO1xuICBjb25zdCBzdHJlYW1Cb2R5ID0gW1xuICAgIHNzZSh7IHR5cGU6IFwic2Vzc2lvbl9zdGFydGVkXCIsIHNlc3Npb25JZCB9KSxcbiAgICBzc2Uoe1xuICAgICAgdHlwZTogXCJleGVjdXRpb25fc3RhcnRlZFwiLFxuICAgICAgZXhlY3V0aW9uSWQsXG4gICAgICBzdGF0dXM6IFwicnVubmluZ1wiLFxuICAgICAgcmVzdW1hYmxlOiB0cnVlLFxuICAgICAgcmVzdW1lVG9rZW4sXG4gICAgfSksXG4gICAgc3NlKHtcbiAgICAgIHR5cGU6IFwiZXJyb3JcIixcbiAgICAgIGV4ZWN1dGlvbklkLFxuICAgICAgY29kZTogZGlhZ25vc3RpY0NvZGUsXG4gICAgICBtZXNzYWdlOiBcIlRoZSByZXF1aXJlZCBhbmFseXNpcyBkaWQgbm90IGNvbXBsZXRlLlwiLFxuICAgIH0pLFxuICBdLmpvaW4oXCJcIik7XG4gIGNvbnN0IGZpeHR1cmU6IEFyYWJpY0FpRml4dHVyZSA9IHtcbiAgICBxdWVzdGlvbixcbiAgICBhbnN3ZXIsXG4gICAgc291cmNlOiBcInNyYy9taXNzaW5nLWFuYWx5c2lzLXRvb2wudHNcIixcbiAgICBzZXNzaW9uSWQsXG4gICAgZXhlY3V0aW9uSWQsXG4gICAgc3RyZWFtQm9keSxcbiAgICBtZXNzYWdlOiB7XG4gICAgICBpZDogXCJlMmUtcmVzdW1lZC1hbmFseXNpcy1mYWlsdXJlLW1lc3NhZ2VcIixcbiAgICAgIHNlc3Npb25JZCxcbiAgICAgIHJvbGU6IFwiYXNzaXN0YW50XCIsXG4gICAgICBjb250ZW50OiBhbnN3ZXIsXG4gICAgICBvdXRjb21lOiBcIkZBSUxFRFwiLFxuICAgICAgZXhlY3V0aW9uSWQsXG4gICAgICBlcnJvckNvZGU6IGRpYWdub3N0aWNDb2RlLFxuICAgICAgZXJyb3JNZXNzYWdlOiBcIlRoZSByZXF1aXJlZCBhbmFseXNpcyBkaWQgbm90IGNvbXBsZXRlLlwiLFxuICAgICAgY3JlYXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDI6MDAuMDAwWlwiLFxuICAgIH0sXG4gIH07XG5cbiAgcmV0dXJuIHtcbiAgICBmaXh0dXJlLFxuICAgIGV4ZWN1dGlvbjoge1xuICAgICAgaWQ6IGV4ZWN1dGlvbklkLFxuICAgICAgcHJvamVjdElkOiBcImUyZS1wcm9qZWN0XCIsXG4gICAgICBvcGVyYXRpb25JZDogXCJlMmUtcmVzdW1lZC1hbmFseXNpcy1mYWlsdXJlLW9wZXJhdGlvblwiLFxuICAgICAgc2Vzc2lvbklkLFxuICAgICAgc3RhdHVzOiBcImZhaWxlZFwiLFxuICAgICAgZmxpZ2h0U3RhdGU6IFwiRkFJTEVEXCIsXG4gICAgICBldmlkZW5jZVZlcmRpY3Q6IFwiSU5DT01QTEVURVwiLFxuICAgICAgcHJvb2ZSZXF1aXJlZDogdHJ1ZSxcbiAgICAgIHJlc3VtYWJsZTogdHJ1ZSxcbiAgICAgIGNoZWNrcG9pbnRWZXJzaW9uOiAxLFxuICAgICAgY2hlY2twb2ludDoge1xuICAgICAgICBzdGFnZTogXCJ0b29sLWV4ZWN1dGlvblwiLFxuICAgICAgICBkZXRhaWw6IFwiVGhlIHJlcXVpcmVkIGFuYWx5c2lzIHRvb2wgd2FzIHVuYXZhaWxhYmxlLlwiLFxuICAgICAgfSxcbiAgICAgIG9iamVjdGl2ZTogeyBvYmplY3RpdmU6IHF1ZXN0aW9uIH0sXG4gICAgICBlcnJvcjogXCJUaGUgcmVxdWlyZWQgYW5hbHlzaXMgZGlkIG5vdCBjb21wbGV0ZS5cIixcbiAgICAgIHN0YXJ0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAxOjAwLjAwMFpcIixcbiAgICAgIGNyZWF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAxOjAwLjAwMFpcIixcbiAgICAgIHVwZGF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAyOjAwLjAwMFpcIixcbiAgICB9LFxuICB9O1xufVxuXG5mdW5jdGlvbiBpbnN0YWxsSW50ZXJydXB0ZWRSZXN1bWVGaXh0dXJlKCkge1xuICBjb25zdCBzZXNzaW9uSWQgPSBcImUyZS1pbnRlcnJ1cHRlZC1yZXN1bWUtc2Vzc2lvblwiO1xuICBjb25zdCBleGVjdXRpb25JZCA9IFwiZTJlLWludGVycnVwdGVkLXJlc3VtZS1leGVjdXRpb25cIjtcbiAgY29uc3QgaW5pdGlhbFRva2VuID0gXCJlMmUtaW50ZXJydXB0ZWQtaW5pdGlhbC10b2tlblwiO1xuICBjb25zdCByZWNvdmVyZWRUb2tlbiA9IFwiZTJlLWludGVycnVwdGVkLXJlY292ZXJlZC10b2tlblwiO1xuICBjb25zdCBxdWVzdGlvbiA9IFwiQ29udGludWUgdGhlIGludGVycnVwdGVkIHJlbGVhc2UgZXhlY3V0aW9uLlwiO1xuICBjb25zdCBwYXJ0aWFsQW5zd2VyID1cbiAgICBcIlRoZSByZWxlYXNlIGV4ZWN1dGlvbiBzdGFydGVkIGJlZm9yZSB0aGUgYnJvd3NlciBkaXNjb25uZWN0ZWQuXCI7XG4gIGNvbnN0IGFuc3dlciA9XG4gICAgXCJUaGUgb3JpZ2luYWwgcmVsZWFzZSBleGVjdXRpb24gcmVzdW1lZCBhZnRlciBjYXBhYmlsaXR5IHJlY292ZXJ5LlwiO1xuICBjb25zdCBtZXNzYWdlID0ge1xuICAgIGlkOiBcImUyZS1pbnRlcnJ1cHRlZC1yZXN1bWUtbWVzc2FnZVwiLFxuICAgIHNlc3Npb25JZCxcbiAgICByb2xlOiBcImFzc2lzdGFudFwiLFxuICAgIGNvbnRlbnQ6IGFuc3dlcixcbiAgICBleGVjdXRpb25JZCxcbiAgICBvdXRjb21lOiBcIkNPTVBMRVRFRFwiLFxuICAgIGNyZWF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAzOjAwLjAwMFpcIixcbiAgfTtcbiAgY29uc3Qgc3NlID0gKGV2ZW50OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPikgPT5cbiAgICBgZGF0YTogJHtKU09OLnN0cmluZ2lmeShldmVudCl9XFxuXFxuYDtcbiAgY29uc3QgZml4dHVyZTogQXJhYmljQWlGaXh0dXJlID0ge1xuICAgIHF1ZXN0aW9uLFxuICAgIGFuc3dlcixcbiAgICBzb3VyY2U6IFwicmVsZWFzZS1yZXN1bWVcIixcbiAgICBzZXNzaW9uSWQsXG4gICAgZXhlY3V0aW9uSWQsXG4gICAgc3RyZWFtQm9keTogW1xuICAgICAgc3NlKHsgdHlwZTogXCJzZXNzaW9uX3N0YXJ0ZWRcIiwgc2Vzc2lvbklkIH0pLFxuICAgICAgc3NlKHtcbiAgICAgICAgdHlwZTogXCJleGVjdXRpb25fc3RhcnRlZFwiLFxuICAgICAgICBleGVjdXRpb25JZCxcbiAgICAgICAgc3RhdHVzOiBcInJ1bm5pbmdcIixcbiAgICAgICAgcmVzdW1hYmxlOiB0cnVlLFxuICAgICAgICByZXN1bWVUb2tlbjogaW5pdGlhbFRva2VuLFxuICAgICAgfSksXG4gICAgICBzc2UoeyB0eXBlOiBcInN0YWdlXCIsIHN0YWdlOiBcImNhbGxpbmctbW9kZWxcIiB9KSxcbiAgICAgIHNzZSh7IHR5cGU6IFwiZGVsdGFcIiwgZGVsdGE6IHBhcnRpYWxBbnN3ZXIgfSksXG4gICAgXS5qb2luKFwiXCIpLFxuICAgIG1lc3NhZ2UsXG4gIH07XG4gIHJldHVybiB7XG4gICAgZml4dHVyZSxcbiAgICBpbml0aWFsVG9rZW4sXG4gICAgcmVjb3ZlcmVkVG9rZW4sXG4gICAgcmVzdW1lZFN0cmVhbUJvZHk6IFtcbiAgICAgIHNzZSh7IHR5cGU6IFwic2Vzc2lvbl9zdGFydGVkXCIsIHNlc3Npb25JZCB9KSxcbiAgICAgIHNzZSh7XG4gICAgICAgIHR5cGU6IFwiZXhlY3V0aW9uX3N0YXJ0ZWRcIixcbiAgICAgICAgZXhlY3V0aW9uSWQsXG4gICAgICAgIHN0YXR1czogXCJydW5uaW5nXCIsXG4gICAgICAgIHJlc3VtYWJsZTogdHJ1ZSxcbiAgICAgICAgcmVzdW1lVG9rZW46IHJlY292ZXJlZFRva2VuLFxuICAgICAgfSksXG4gICAgICBzc2UoeyB0eXBlOiBcInN0YWdlXCIsIHN0YWdlOiBcInJlc3VtaW5nLWNoZWNrcG9pbnRcIiB9KSxcbiAgICAgIHNzZSh7IHR5cGU6IFwiZGVsdGFcIiwgZGVsdGE6IGFuc3dlciB9KSxcbiAgICAgIHNzZSh7XG4gICAgICAgIHR5cGU6IFwiZG9uZVwiLFxuICAgICAgICBzZXNzaW9uSWQsXG4gICAgICAgIGV4ZWN1dGlvbklkLFxuICAgICAgICBtZXNzYWdlLFxuICAgICAgICBwZW5kaW5nQ2hhbmdlczogW10sXG4gICAgICB9KSxcbiAgICBdLmpvaW4oXCJcIiksXG4gICAgZXhlY3V0aW9uOiB7XG4gICAgICBpZDogZXhlY3V0aW9uSWQsXG4gICAgICBwcm9qZWN0SWQ6IFwiZTJlLXByb2plY3RcIixcbiAgICAgIG9wZXJhdGlvbklkOiBcImUyZS1pbnRlcnJ1cHRlZC1yZXN1bWUtb3BlcmF0aW9uXCIsXG4gICAgICBzZXNzaW9uSWQsXG4gICAgICBzdGF0dXM6IFwicGF1c2VkXCIsXG4gICAgICBmbGlnaHRTdGF0ZTogXCJQQVVTRURcIixcbiAgICAgIHJlc3VtYWJsZTogdHJ1ZSxcbiAgICAgIGNoZWNrcG9pbnRWZXJzaW9uOiAxLFxuICAgICAgY2hlY2twb2ludDoge1xuICAgICAgICBzdGFnZTogXCJjYWxsaW5nLW1vZGVsXCIsXG4gICAgICAgIGRldGFpbDpcbiAgICAgICAgICBcIlRoZSBicm93c2VyIHRyYW5zcG9ydCBkaXNjb25uZWN0ZWQgYWZ0ZXIgdGhlIGV4ZWN1dGlvbiBzdGFydGVkLlwiLFxuICAgICAgfSxcbiAgICAgIG9iamVjdGl2ZTogeyBvYmplY3RpdmU6IHF1ZXN0aW9uIH0sXG4gICAgICBzdGFydGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMTowMC4wMDBaXCIsXG4gICAgICBjcmVhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMTowMC4wMDBaXCIsXG4gICAgICB1cGRhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMjowMC4wMDBaXCIsXG4gICAgfSxcbiAgfTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gY3JlYXRlUmVsZWFzZVNpZ25JblVybChwYWdlOiBQYWdlKSB7XG4gIGNvbnN0IHNlY3JldEtleSA9IHByb2Nlc3MuZW52LkNMRVJLX1NFQ1JFVF9LRVk7XG4gIGlmICghc2VjcmV0S2V5KSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgXCJDTEVSS19TRUNSRVRfS0VZIGlzIHJlcXVpcmVkIGZvciB0aGUgcmVsZWFzZS1vbmx5IHByb2dyYW1tYXRpYyBDbGVyayBoYW5kb2ZmLlwiLFxuICAgICk7XG4gIH1cblxuICBjb25zdCBoZWFkZXJzID0ge1xuICAgIEF1dGhvcml6YXRpb246IGBCZWFyZXIgJHtzZWNyZXRLZXl9YCxcbiAgICBcIkNvbnRlbnQtVHlwZVwiOiBcImFwcGxpY2F0aW9uL2pzb25cIixcbiAgfTtcbiAgY29uc3QgdXNlclJlc3BvbnNlID0gYXdhaXQgcGFnZS5yZXF1ZXN0LmdldChcbiAgICBgaHR0cHM6Ly9hcGkuY2xlcmsuY29tL3YxL3VzZXJzP2VtYWlsX2FkZHJlc3M9JHtlbmNvZGVVUklDb21wb25lbnQoVEVTVF9VU0VSLmVtYWlsKX1gLFxuICAgIHsgaGVhZGVycyB9LFxuICApO1xuICBsZXQgdXNlcklkID0gcGFyc2VDbGVya1VzZXJMb29rdXBSZXNwb25zZShhd2FpdCB1c2VyUmVzcG9uc2UuanNvbigpKTtcblxuICBpZiAoIXVzZXJJZCkge1xuICAgIGNvbnN0IGNyZWF0ZWRSZXNwb25zZSA9IGF3YWl0IHBhZ2UucmVxdWVzdC5wb3N0KFxuICAgICAgXCJodHRwczovL2FwaS5jbGVyay5jb20vdjEvdXNlcnNcIixcbiAgICAgIHtcbiAgICAgICAgaGVhZGVycyxcbiAgICAgICAgZGF0YToge1xuICAgICAgICAgIGVtYWlsX2FkZHJlc3M6IFtURVNUX1VTRVIuZW1haWxdLFxuICAgICAgICAgIGZpcnN0X25hbWU6IFRFU1RfVVNFUi5maXJzdE5hbWUsXG4gICAgICAgICAgbGFzdF9uYW1lOiBURVNUX1VTRVIubGFzdE5hbWUsXG4gICAgICAgICAgc2tpcF9wYXNzd29yZF9jaGVja3M6IHRydWUsXG4gICAgICAgICAgc2tpcF9wYXNzd29yZF9yZXF1aXJlbWVudDogdHJ1ZSxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgKTtcbiAgICB1c2VySWQgPSBwYXJzZUNyZWF0ZWRDbGVya1VzZXJSZXNwb25zZShhd2FpdCBjcmVhdGVkUmVzcG9uc2UuanNvbigpKTtcbiAgfVxuXG4gIGlmICghdXNlcklkKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgXCJUaGUgaXNvbGF0ZWQgQ2xlcmsgcmVsZWFzZSB1c2VyIGNvdWxkIG5vdCBiZSBwcm92aXNpb25lZC5cIixcbiAgICApO1xuICB9XG5cbiAgY29uc3QgdG9rZW5SZXNwb25zZSA9IGF3YWl0IHBhZ2UucmVxdWVzdC5wb3N0KFxuICAgIFwiaHR0cHM6Ly9hcGkuY2xlcmsuY29tL3YxL3NpZ25faW5fdG9rZW5zXCIsXG4gICAgeyBoZWFkZXJzLCBkYXRhOiB7IHVzZXJfaWQ6IHVzZXJJZCB9IH0sXG4gICk7XG4gIGNvbnN0IHRva2VuID0gcGFyc2VDbGVya1NpZ25JblRva2VuUmVzcG9uc2UoYXdhaXQgdG9rZW5SZXNwb25zZS5qc29uKCkpO1xuXG4gIHJldHVybiBgJHtuZXcgVVJMKERBU0hCT0FSRF9QQVRILCBwYWdlLnVybCgpKS50b1N0cmluZygpfXNpZ24taW4/X19jbGVya190aWNrZXQ9JHtlbmNvZGVVUklDb21wb25lbnQodG9rZW4pfWA7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHByb2dyYW1tYXRpY1NpZ25JbihwYWdlOiBQYWdlKSB7XG4gIGF3YWl0IHBhZ2UuZ290byhEQVNIQk9BUkRfUEFUSCk7XG4gIGF3YWl0IGV4cGVjdChcbiAgICBwYWdlLmdldEJ5Um9sZShcImxpbmtcIiwgeyBuYW1lOiBcIlNpZ24gSW5cIiwgZXhhY3Q6IHRydWUgfSksXG4gICkudG9CZVZpc2libGUoKTtcblxuICBjb25zdCBoZWxwZXIgPVxuICAgIGdsb2JhbFRoaXMuc2lnbkluQ2xlcmtVc2VyID8/XG4gICAgZ2xvYmFsVGhpcy5fX0VOR0lORUVSSU5HT1NfU0lHTl9JTl9DTEVSS19VU0VSX187XG4gIGlmICghaGVscGVyKSB7XG4gICAgaWYgKHByb2Nlc3MuZW52LlJVTl9DT05UUk9MTEVEX1JFTEVBU0VfVkFMSURBVElPTiAhPT0gXCIxXCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgXCJDbGVyayBicm93c2VyIGhlbHBlciBpcyB1bmF2YWlsYWJsZS4gUnVuIHRoaXMgam91cm5leSBpbiB0aGUgUmVwbGl0IGJyb3dzZXIgcnVubmVyLCB3aGljaCBpbmplY3RzIHNpZ25JbkNsZXJrVXNlci5cIixcbiAgICAgICk7XG4gICAgfVxuICAgIGF3YWl0IHBhZ2UuZ290byhhd2FpdCBjcmVhdGVSZWxlYXNlU2lnbkluVXJsKHBhZ2UpKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZSkudG9IYXZlVVJMKFxuICAgICAgbmV3IFJlZ0V4cChgJHtEQVNIQk9BUkRfUEFUSC5yZXBsYWNlQWxsKFwiL1wiLCBcIlxcXFwvXCIpfSRgKSxcbiAgICApO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCBzaWduSW5VcmwgPSBhd2FpdCBoZWxwZXIoe1xuICAgIC4uLlRFU1RfVVNFUixcbiAgICB0dGw6IDkwMCxcbiAgICBiYXNlUGF0aDogREFTSEJPQVJEX1BBVEgsXG4gIH0pO1xuICBhd2FpdCBwYWdlLmdvdG8oc2lnbkluVXJsKTtcbiAgYXdhaXQgZXhwZWN0KHBhZ2UpLnRvSGF2ZVVSTChcbiAgICBuZXcgUmVnRXhwKGAke0RBU0hCT0FSRF9QQVRILnJlcGxhY2VBbGwoXCIvXCIsIFwiXFxcXC9cIil9JGApLFxuICApO1xufVxuXG5hc3luYyBmdW5jdGlvbiBvcGVuTmF2aWdhdGlvbihwYWdlOiBQYWdlLCBsYWJlbDogc3RyaW5nLCBwYXRoOiBzdHJpbmcpIHtcbiAgYXdhaXQgcGFnZS5nZXRCeVJvbGUoXCJsaW5rXCIsIHsgbmFtZTogbGFiZWwsIGV4YWN0OiB0cnVlIH0pLmNsaWNrKCk7XG4gIGF3YWl0IGV4cGVjdChwYWdlKS50b0hhdmVVUkwobmV3IFJlZ0V4cChgJHtwYXRoLnJlcGxhY2VBbGwoXCIvXCIsIFwiXFxcXC9cIil9JGApKTtcbn1cblxuZnVuY3Rpb24gYXBpVXJsKHBhZ2U6IFBhZ2UsIHBhdGg6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IGFwaUJhc2VVcmwgPSBwcm9jZXNzLmVudi5EQVNIQk9BUkRfRTJFX0FQSV9CQVNFX1VSTDtcbiAgcmV0dXJuIG5ldyBVUkwocGF0aCwgYXBpQmFzZVVybCA/IGFwaUJhc2VVcmwgOiBwYWdlLnVybCgpKS50b1N0cmluZygpO1xufVxuXG5hc3luYyBmdW5jdGlvbiBsaXZlUmVxdWVzdChcbiAgcGFnZTogUGFnZSxcbiAgcGF0aDogc3RyaW5nLFxuICBvcHRpb25zPzogeyBtZXRob2Q/OiBzdHJpbmc7IGJvZHk/OiB1bmtub3duOyB0aW1lb3V0PzogbnVtYmVyIH0sXG4pOiBQcm9taXNlPHsgc3RhdHVzOiBudW1iZXI7IGJvZHk6IHN0cmluZyB9PiB7XG4gIHJldHVybiBwYWdlLmV2YWx1YXRlKFxuICAgIGFzeW5jICh7IHVybCwgbWV0aG9kLCBib2R5LCB0aW1lb3V0IH0pID0+IHtcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgZmV0Y2godXJsLCB7XG4gICAgICAgIG1ldGhvZCxcbiAgICAgICAgY3JlZGVudGlhbHM6IFwiaW5jbHVkZVwiLFxuICAgICAgICBoZWFkZXJzOlxuICAgICAgICAgIGJvZHkgPT09IHVuZGVmaW5lZFxuICAgICAgICAgICAgPyB1bmRlZmluZWRcbiAgICAgICAgICAgIDogeyBcIkNvbnRlbnQtVHlwZVwiOiBcImFwcGxpY2F0aW9uL2pzb25cIiB9LFxuICAgICAgICBib2R5OiBib2R5ID09PSB1bmRlZmluZWQgPyB1bmRlZmluZWQgOiBKU09OLnN0cmluZ2lmeShib2R5KSxcbiAgICAgICAgc2lnbmFsOiB0aW1lb3V0ID8gQWJvcnRTaWduYWwudGltZW91dCh0aW1lb3V0KSA6IHVuZGVmaW5lZCxcbiAgICAgIH0pO1xuICAgICAgcmV0dXJuIHsgc3RhdHVzOiByZXNwb25zZS5zdGF0dXMsIGJvZHk6IGF3YWl0IHJlc3BvbnNlLnRleHQoKSB9O1xuICAgIH0sXG4gICAge1xuICAgICAgdXJsOiBhcGlVcmwocGFnZSwgcGF0aCksXG4gICAgICBtZXRob2Q6IG9wdGlvbnM/Lm1ldGhvZCA/PyBcIkdFVFwiLFxuICAgICAgYm9keTogb3B0aW9ucz8uYm9keSxcbiAgICAgIHRpbWVvdXQ6IG9wdGlvbnM/LnRpbWVvdXQsXG4gICAgfSxcbiAgKTtcbn1cblxudHlwZSBPcmlnaW5EaWFnbm9zdGljID0ge1xuICBvcmlnaW46IHN0cmluZztcbiAgcGhhc2U6IFwiR0VUXCIgfCBcInByZWZsaWdodFwiIHwgXCJtdXRhdGlvblwiIHwgXCJyZWplY3Rpb25cIjtcbiAgc3RhdHVzPzogbnVtYmVyO1xuICBoZWFkZXJzPzogUmVjb3JkPHN0cmluZywgc3RyaW5nPjtcbiAgZXJyb3I/OiBzdHJpbmc7XG59O1xuY29uc3QgcmVjb3JkZWRPcmlnaW5EaWFnbm9zdGljczogT3JpZ2luRGlhZ25vc3RpY1tdID0gW107XG5cbmZ1bmN0aW9uIG9yaWdpbkRpYWdub3N0aWNQYXRoKCk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gIHJldHVybiBwcm9jZXNzLmVudi5EQVNIQk9BUkRfRTJFX09SSUdJTl9ESUFHTk9TVElDU19QQVRIO1xufVxuXG5mdW5jdGlvbiByZWxldmFudE9yaWdpbkhlYWRlcnMoXG4gIGhlYWRlcnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4sXG4pOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+IHtcbiAgcmV0dXJuIE9iamVjdC5mcm9tRW50cmllcyhcbiAgICBPUklHSU5fRElBR05PU1RJQ19IRUFERVJTLmZsYXRNYXAoKG5hbWUpID0+XG4gICAgICBoZWFkZXJzW25hbWVdID8gW1tuYW1lLCBoZWFkZXJzW25hbWVdXV0gOiBbXSxcbiAgICApLFxuICApO1xufVxuXG5hc3luYyBmdW5jdGlvbiB3cml0ZU9yaWdpbkRpYWdub3N0aWNzKCkge1xuICBjb25zdCBvdXRwdXRQYXRoID0gb3JpZ2luRGlhZ25vc3RpY1BhdGgoKTtcbiAgaWYgKCFvdXRwdXRQYXRoKSByZXR1cm47XG4gIGF3YWl0IG1rZGlyKGRpcm5hbWUob3V0cHV0UGF0aCksIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xuICBhd2FpdCB3cml0ZUZpbGUoXG4gICAgb3V0cHV0UGF0aCxcbiAgICBgJHtKU09OLnN0cmluZ2lmeSh7IGRpYWdub3N0aWNzOiByZWNvcmRlZE9yaWdpbkRpYWdub3N0aWNzIH0sIG51bGwsIDIpfVxcbmAsXG4gICAgXCJ1dGY4XCIsXG4gICk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGV4cGVjdE9yaWdpbkNhblVzZUFwaShwYWdlOiBQYWdlLCBvcmlnaW46IHN0cmluZykge1xuICBjb25zdCBhcGlCYXNlVXJsID0gcHJvY2Vzcy5lbnYuREFTSEJPQVJEX0UyRV9BUElfQkFTRV9VUkw7XG4gIGlmICghYXBpQmFzZVVybCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgIFwiREFTSEJPQVJEX0UyRV9BUElfQkFTRV9VUkwgaXMgcmVxdWlyZWQgZm9yIG9yaWdpbiBjaGVja3MuXCIsXG4gICAgKTtcbiAgfVxuICBjb25zdCBoZWFsdGhVcmwgPSBuZXcgVVJMKFwiL2FwaS9oZWFsdGh6XCIsIGFwaUJhc2VVcmwpLnRvU3RyaW5nKCk7XG4gIGNvbnN0IG11dGF0aW9uVXJsID0gbmV3IFVSTChcIi9hcGkvYWkvY2hhdFwiLCBhcGlCYXNlVXJsKS50b1N0cmluZygpO1xuICBjb25zdCBjb21tb25IZWFkZXJzID0geyBPcmlnaW46IG9yaWdpbiB9O1xuXG4gIGNvbnN0IGRpYWdub3N0aWNzOiBPcmlnaW5EaWFnbm9zdGljW10gPSBbXTtcbiAgY29uc3QgY2hlY2sgPSBhc3luYyAoXG4gICAgcGhhc2U6IE9yaWdpbkRpYWdub3N0aWNbXCJwaGFzZVwiXSxcbiAgICByZXF1ZXN0OiAoKSA9PiBQcm9taXNlPGltcG9ydChcIkBwbGF5d3JpZ2h0L3Rlc3RcIikuQVBJUmVzcG9uc2U+LFxuICAgIGFzc2VydGlvbjogKFxuICAgICAgcmVzcG9uc2U6IGltcG9ydChcIkBwbGF5d3JpZ2h0L3Rlc3RcIikuQVBJUmVzcG9uc2UsXG4gICAgKSA9PiBQcm9taXNlPHZvaWQ+LFxuICApID0+IHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCByZXF1ZXN0KCk7XG4gICAgICBkaWFnbm9zdGljcy5wdXNoKHtcbiAgICAgICAgb3JpZ2luLFxuICAgICAgICBwaGFzZSxcbiAgICAgICAgc3RhdHVzOiByZXNwb25zZS5zdGF0dXMoKSxcbiAgICAgICAgaGVhZGVyczogcmVsZXZhbnRPcmlnaW5IZWFkZXJzKHJlc3BvbnNlLmhlYWRlcnMoKSksXG4gICAgICB9KTtcbiAgICAgIHJlY29yZGVkT3JpZ2luRGlhZ25vc3RpY3MucHVzaChkaWFnbm9zdGljcy5hdCgtMSkhKTtcbiAgICAgIGF3YWl0IGFzc2VydGlvbihyZXNwb25zZSk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnN0IGN1cnJlbnQgPSBkaWFnbm9zdGljcy5hdCgtMSk7XG4gICAgICBpZiAoY3VycmVudD8ucGhhc2UgIT09IHBoYXNlKSB7XG4gICAgICAgIGRpYWdub3N0aWNzLnB1c2goeyBvcmlnaW4sIHBoYXNlIH0pO1xuICAgICAgfVxuICAgICAgZGlhZ25vc3RpY3MuYXQoLTEpIS5lcnJvciA9IFwib3JpZ2luIGNoZWNrIGZhaWxlZFwiO1xuICAgICAgYXdhaXQgd3JpdGVPcmlnaW5EaWFnbm9zdGljcygpO1xuICAgICAgdGhyb3cgZXJyb3I7XG4gICAgfVxuICB9O1xuXG4gIGF3YWl0IGNoZWNrKFxuICAgIFwiR0VUXCIsXG4gICAgKCkgPT4gcGFnZS5yZXF1ZXN0LmdldChoZWFsdGhVcmwsIHsgaGVhZGVyczogY29tbW9uSGVhZGVycyB9KSxcbiAgICBhc3luYyAocmVzcG9uc2UpID0+IHtcbiAgICAgIGV4cGVjdChyZXNwb25zZS5zdGF0dXMoKSwgYCR7b3JpZ2lufSBjcmVkZW50aWFsZWQgR0VUIHN0YXR1c2ApLnRvQmUoMjAwKTtcbiAgICAgIGV4cGVjdChyZXNwb25zZS5oZWFkZXJzKClbXCJhY2Nlc3MtY29udHJvbC1hbGxvdy1vcmlnaW5cIl0pLnRvQmUob3JpZ2luKTtcbiAgICAgIGV4cGVjdChyZXNwb25zZS5oZWFkZXJzKClbXCJhY2Nlc3MtY29udHJvbC1hbGxvdy1jcmVkZW50aWFsc1wiXSkudG9CZShcbiAgICAgICAgXCJ0cnVlXCIsXG4gICAgICApO1xuICAgIH0sXG4gICk7XG4gIGF3YWl0IGNoZWNrKFxuICAgIFwicHJlZmxpZ2h0XCIsXG4gICAgKCkgPT5cbiAgICAgIHBhZ2UucmVxdWVzdC5mZXRjaChtdXRhdGlvblVybCwge1xuICAgICAgICBtZXRob2Q6IFwiT1BUSU9OU1wiLFxuICAgICAgICBoZWFkZXJzOiB7XG4gICAgICAgICAgLi4uY29tbW9uSGVhZGVycyxcbiAgICAgICAgICBcIkFjY2Vzcy1Db250cm9sLVJlcXVlc3QtTWV0aG9kXCI6IFwiUE9TVFwiLFxuICAgICAgICAgIFwiQWNjZXNzLUNvbnRyb2wtUmVxdWVzdC1IZWFkZXJzXCI6IFwiY29udGVudC10eXBlXCIsXG4gICAgICAgIH0sXG4gICAgICB9KSxcbiAgICBhc3luYyAocmVzcG9uc2UpID0+IHtcbiAgICAgIGV4cGVjdChyZXNwb25zZS5zdGF0dXMoKSwgYCR7b3JpZ2lufSBtdXRhdGlvbiBwcmVmbGlnaHQgc3RhdHVzYCkudG9CZShcbiAgICAgICAgMjA0LFxuICAgICAgKTtcbiAgICAgIGV4cGVjdChyZXNwb25zZS5oZWFkZXJzKClbXCJhY2Nlc3MtY29udHJvbC1hbGxvdy1vcmlnaW5cIl0pLnRvQmUob3JpZ2luKTtcbiAgICAgIGV4cGVjdChcbiAgICAgICAgcmVzcG9uc2UuaGVhZGVycygpW1wiYWNjZXNzLWNvbnRyb2wtYWxsb3ctY3JlZGVudGlhbHNcIl0sXG4gICAgICAgIGAke29yaWdpbn0gbXV0YXRpb24gcHJlZmxpZ2h0IGNyZWRlbnRpYWxzYCxcbiAgICAgICkudG9CZShcInRydWVcIik7XG4gICAgICBleHBlY3QoXG4gICAgICAgIHJlc3BvbnNlXG4gICAgICAgICAgLmhlYWRlcnMoKVxuICAgICAgICAgIFtcImFjY2Vzcy1jb250cm9sLWFsbG93LW1ldGhvZHNcIl0/LnNwbGl0KFwiLFwiKVxuICAgICAgICAgIC5tYXAoKG1ldGhvZCkgPT4gbWV0aG9kLnRyaW0oKS50b1VwcGVyQ2FzZSgpKSxcbiAgICAgICAgYCR7b3JpZ2lufSBtdXRhdGlvbiBwcmVmbGlnaHQgbWV0aG9kc2AsXG4gICAgICApLnRvQ29udGFpbihcIlBPU1RcIik7XG4gICAgICBleHBlY3QoXG4gICAgICAgIHJlc3BvbnNlXG4gICAgICAgICAgLmhlYWRlcnMoKVxuICAgICAgICAgIFtcImFjY2Vzcy1jb250cm9sLWFsbG93LWhlYWRlcnNcIl0/LnNwbGl0KFwiLFwiKVxuICAgICAgICAgIC5tYXAoKGhlYWRlcikgPT4gaGVhZGVyLnRyaW0oKS50b0xvd2VyQ2FzZSgpKSxcbiAgICAgICAgYCR7b3JpZ2lufSBtdXRhdGlvbiBwcmVmbGlnaHQgaGVhZGVyc2AsXG4gICAgICApLnRvQ29udGFpbihcImNvbnRlbnQtdHlwZVwiKTtcbiAgICB9LFxuICApO1xuICBhd2FpdCBjaGVjayhcbiAgICBcIm11dGF0aW9uXCIsXG4gICAgKCkgPT5cbiAgICAgIHBhZ2UucmVxdWVzdC5wb3N0KG11dGF0aW9uVXJsLCB7XG4gICAgICAgIGhlYWRlcnM6IHsgLi4uY29tbW9uSGVhZGVycywgXCJDb250ZW50LVR5cGVcIjogXCJhcHBsaWNhdGlvbi9qc29uXCIgfSxcbiAgICAgICAgZGF0YTogeyBtZXNzYWdlOiBcIm9yaWdpbiBjb250cmFjdFwiIH0sXG4gICAgICB9KSxcbiAgICBhc3luYyAocmVzcG9uc2UpID0+IHtcbiAgICAgIGV4cGVjdChcbiAgICAgICAgcmVzcG9uc2Uuc3RhdHVzKCksXG4gICAgICAgIGAke29yaWdpbn0gc3RhdGUtY2hhbmdpbmcgcmVxdWVzdCBtdXN0IHBhc3Mgb3JpZ2luIHByb3RlY3Rpb25gLFxuICAgICAgKS5ub3QudG9CZSg0MDMpO1xuICAgICAgZXhwZWN0KHJlc3BvbnNlLmhlYWRlcnMoKVtcImFjY2Vzcy1jb250cm9sLWFsbG93LW9yaWdpblwiXSkudG9CZShvcmlnaW4pO1xuICAgICAgZXhwZWN0KHJlc3BvbnNlLmhlYWRlcnMoKVtcImFjY2Vzcy1jb250cm9sLWFsbG93LWNyZWRlbnRpYWxzXCJdKS50b0JlKFxuICAgICAgICBcInRydWVcIixcbiAgICAgICk7XG4gICAgfSxcbiAgKTtcbiAgYXdhaXQgd3JpdGVPcmlnaW5EaWFnbm9zdGljcygpO1xufVxuXG5hc3luYyBmdW5jdGlvbiBleHBlY3RIb3N0aWxlT3JpZ2luUmVqZWN0ZWQocGFnZTogUGFnZSkge1xuICBjb25zdCBhcGlCYXNlVXJsID0gcHJvY2Vzcy5lbnYuREFTSEJPQVJEX0UyRV9BUElfQkFTRV9VUkw7XG4gIGlmICghYXBpQmFzZVVybClcbiAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICBcIkRBU0hCT0FSRF9FMkVfQVBJX0JBU0VfVVJMIGlzIHJlcXVpcmVkIGZvciBvcmlnaW4gY2hlY2tzLlwiLFxuICAgICk7XG4gIGNvbnN0IG11dGF0aW9uVXJsID0gbmV3IFVSTChcIi9hcGkvYWkvY2hhdFwiLCBhcGlCYXNlVXJsKS50b1N0cmluZygpO1xuICBjb25zdCB1cGxvYWRVcmwgPSBuZXcgVVJMKFwiL2FwaS91cGxvYWQvYXJjaGl2ZVwiLCBhcGlCYXNlVXJsKS50b1N0cmluZygpO1xuICBjb25zdCBsaXZlVXBkYXRlVXJsID0gbmV3IFVSTChcIi9hcGkvYWkvY2hhdC9zdHJlYW1cIiwgYXBpQmFzZVVybCkudG9TdHJpbmcoKTtcbiAgY29uc3QgZGlhZ25vc3RpYzogT3JpZ2luRGlhZ25vc3RpYyA9IHtcbiAgICBvcmlnaW46IEhPU1RJTEVfT1JJR0lOLFxuICAgIHBoYXNlOiBcInJlamVjdGlvblwiLFxuICB9O1xuICByZWNvcmRlZE9yaWdpbkRpYWdub3N0aWNzLnB1c2goZGlhZ25vc3RpYyk7XG4gIHRyeSB7XG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBwYWdlLnJlcXVlc3QucG9zdChtdXRhdGlvblVybCwge1xuICAgICAgaGVhZGVyczoge1xuICAgICAgICBPcmlnaW46IEhPU1RJTEVfT1JJR0lOLFxuICAgICAgICBcIkNvbnRlbnQtVHlwZVwiOiBcImFwcGxpY2F0aW9uL2pzb25cIixcbiAgICAgIH0sXG4gICAgICBkYXRhOiB7IG1lc3NhZ2U6IFwiaG9zdGlsZSBvcmlnaW4gY29udHJhY3RcIiB9LFxuICAgIH0pO1xuICAgIGRpYWdub3N0aWMuc3RhdHVzID0gcmVzcG9uc2Uuc3RhdHVzKCk7XG4gICAgZGlhZ25vc3RpYy5oZWFkZXJzID0gcmVsZXZhbnRPcmlnaW5IZWFkZXJzKHJlc3BvbnNlLmhlYWRlcnMoKSk7XG4gICAgZXhwZWN0KHJlc3BvbnNlLnN0YXR1cygpKS50b0JlKDQwMyk7XG4gICAgZXhwZWN0KHJlc3BvbnNlLmhlYWRlcnMoKVtcImFjY2Vzcy1jb250cm9sLWFsbG93LW9yaWdpblwiXSkudG9CZVVuZGVmaW5lZCgpO1xuICAgIGV4cGVjdChcbiAgICAgIHJlc3BvbnNlLmhlYWRlcnMoKVtcImFjY2Vzcy1jb250cm9sLWFsbG93LWNyZWRlbnRpYWxzXCJdLFxuICAgICkudG9CZVVuZGVmaW5lZCgpO1xuXG4gICAgY29uc3QgaG9zdGlsZVVwbG9hZCA9IGF3YWl0IHBhZ2UucmVxdWVzdC5wb3N0KHVwbG9hZFVybCwge1xuICAgICAgaGVhZGVyczogeyBPcmlnaW46IEhPU1RJTEVfT1JJR0lOIH0sXG4gICAgICBtdWx0aXBhcnQ6IHtcbiAgICAgICAgYXJjaGl2ZToge1xuICAgICAgICAgIG5hbWU6IFwiaG9zdGlsZS1kYXNoYm9hcmQtam91cm5leS56aXBcIixcbiAgICAgICAgICBtaW1lVHlwZTogXCJhcHBsaWNhdGlvbi96aXBcIixcbiAgICAgICAgICBidWZmZXI6IEJ1ZmZlci5mcm9tKFwibm90IGFuIGFyY2hpdmVcIiksXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgIH0pO1xuICAgIGV4cGVjdChob3N0aWxlVXBsb2FkLnN0YXR1cygpKS50b0JlKDQwMyk7XG4gICAgZXhwZWN0KFxuICAgICAgaG9zdGlsZVVwbG9hZC5oZWFkZXJzKClbXCJhY2Nlc3MtY29udHJvbC1hbGxvdy1vcmlnaW5cIl0sXG4gICAgKS50b0JlVW5kZWZpbmVkKCk7XG5cbiAgICBjb25zdCBob3N0aWxlTGl2ZVVwZGF0ZSA9IGF3YWl0IHBhZ2UucmVxdWVzdC5wb3N0KGxpdmVVcGRhdGVVcmwsIHtcbiAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgT3JpZ2luOiBIT1NUSUxFX09SSUdJTixcbiAgICAgICAgXCJDb250ZW50LVR5cGVcIjogXCJhcHBsaWNhdGlvbi9qc29uXCIsXG4gICAgICB9LFxuICAgICAgZGF0YToge30sXG4gICAgfSk7XG4gICAgZXhwZWN0KGhvc3RpbGVMaXZlVXBkYXRlLnN0YXR1cygpKS50b0JlKDQwMyk7XG4gICAgZXhwZWN0KFxuICAgICAgaG9zdGlsZUxpdmVVcGRhdGUuaGVhZGVycygpW1wiYWNjZXNzLWNvbnRyb2wtYWxsb3ctb3JpZ2luXCJdLFxuICAgICkudG9CZVVuZGVmaW5lZCgpO1xuICB9IGNhdGNoIChlcnJvcikge1xuICAgIGRpYWdub3N0aWMuZXJyb3IgPSBcIm9yaWdpbiByZWplY3Rpb24gY2hlY2sgZmFpbGVkXCI7XG4gICAgYXdhaXQgd3JpdGVPcmlnaW5EaWFnbm9zdGljcygpO1xuICAgIHRocm93IGVycm9yO1xuICB9XG4gIGF3YWl0IHdyaXRlT3JpZ2luRGlhZ25vc3RpY3MoKTtcbn1cblxuZnVuY3Rpb24gcGFyc2VTc2UoYm9keTogc3RyaW5nKTogQXJyYXk8UmVjb3JkPHN0cmluZywgdW5rbm93bj4+IHtcbiAgcmV0dXJuIGJvZHkuc3BsaXQoL1xcblxcbisvKS5mbGF0TWFwKChjaHVuaykgPT4ge1xuICAgIGNvbnN0IGRhdGEgPSBjaHVua1xuICAgICAgLnNwbGl0KFwiXFxuXCIpXG4gICAgICAuZmluZCgobGluZSkgPT4gbGluZS5zdGFydHNXaXRoKFwiZGF0YTogXCIpKVxuICAgICAgPy5zbGljZShcImRhdGE6IFwiLmxlbmd0aCk7XG4gICAgaWYgKCFkYXRhKSByZXR1cm4gW107XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHZhbHVlID0gSlNPTi5wYXJzZShkYXRhKSBhcyB1bmtub3duO1xuICAgICAgcmV0dXJuIHZhbHVlICYmIHR5cGVvZiB2YWx1ZSA9PT0gXCJvYmplY3RcIlxuICAgICAgICA/IFt2YWx1ZSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPl1cbiAgICAgICAgOiBbXTtcbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybiBbXTtcbiAgICB9XG4gIH0pO1xufVxuXG5hc3luYyBmdW5jdGlvbiBsaXZlSnNvbihcbiAgcGFnZTogUGFnZSxcbiAgcGF0aDogc3RyaW5nLFxuKTogUHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBhbnk+PiB7XG4gIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgbGl2ZVJlcXVlc3QocGFnZSwgcGF0aCk7XG4gIGlmIChyZXNwb25zZS5zdGF0dXMgPCAyMDAgfHwgcmVzcG9uc2Uuc3RhdHVzID49IDMwMCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgIGBMaXZlIGNvcnJlbGF0aW9uIHJlcXVlc3QgZmFpbGVkOiAke3BhdGh9ICgke3Jlc3BvbnNlLnN0YXR1c30pYCxcbiAgICApO1xuICB9XG4gIHJldHVybiBKU09OLnBhcnNlKHJlc3BvbnNlLmJvZHkpIGFzIFJlY29yZDxzdHJpbmcsIGFueT47XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGxpdmVBcnJheShcbiAgcGFnZTogUGFnZSxcbiAgcGF0aDogc3RyaW5nLFxuKTogUHJvbWlzZTxBcnJheTxSZWNvcmQ8c3RyaW5nLCBhbnk+Pj4ge1xuICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGxpdmVSZXF1ZXN0KHBhZ2UsIHBhdGgpO1xuICBpZiAocmVzcG9uc2Uuc3RhdHVzID09PSA0MDQpIHJldHVybiBbXTtcbiAgaWYgKHJlc3BvbnNlLnN0YXR1cyA8IDIwMCB8fCByZXNwb25zZS5zdGF0dXMgPj0gMzAwKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgYExpdmUgY29ycmVsYXRpb24gcmVxdWVzdCBmYWlsZWQ6ICR7cGF0aH0gKCR7cmVzcG9uc2Uuc3RhdHVzfSlgLFxuICAgICk7XG4gIH1cbiAgY29uc3QgdmFsdWUgPSBKU09OLnBhcnNlKHJlc3BvbnNlLmJvZHkpO1xuICByZXR1cm4gQXJyYXkuaXNBcnJheSh2YWx1ZSkgPyB2YWx1ZSA6IFtdO1xufVxuXG5hc3luYyBmdW5jdGlvbiBsaXZlT3B0aW9uYWxSZWNvcmQoXG4gIHBhZ2U6IFBhZ2UsXG4gIHBhdGg6IHN0cmluZyxcbik6IFByb21pc2U8UmVjb3JkPHN0cmluZywgYW55PiB8IHVuZGVmaW5lZD4ge1xuICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGxpdmVSZXF1ZXN0KHBhZ2UsIHBhdGgpO1xuICBpZiAocmVzcG9uc2Uuc3RhdHVzID09PSA0MDQpIHJldHVybiB1bmRlZmluZWQ7XG4gIGlmIChyZXNwb25zZS5zdGF0dXMgPCAyMDAgfHwgcmVzcG9uc2Uuc3RhdHVzID49IDMwMCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgIGBMaXZlIGNvcnJlbGF0aW9uIHJlcXVlc3QgZmFpbGVkOiAke3BhdGh9ICgke3Jlc3BvbnNlLnN0YXR1c30pYCxcbiAgICApO1xuICB9XG4gIGNvbnN0IHZhbHVlID0gSlNPTi5wYXJzZShyZXNwb25zZS5ib2R5KTtcbiAgcmV0dXJuIHZhbHVlICYmIHR5cGVvZiB2YWx1ZSA9PT0gXCJvYmplY3RcIiAmJiAhQXJyYXkuaXNBcnJheSh2YWx1ZSlcbiAgICA/ICh2YWx1ZSBhcyBSZWNvcmQ8c3RyaW5nLCBhbnk+KVxuICAgIDogdW5kZWZpbmVkO1xufVxuXG50ZXN0LmRlc2NyaWJlKFwiRW5naW5lZXJpbmdPUyBkYXNoYm9hcmQgYnJvd3NlciBqb3VybmV5XCIsICgpID0+IHtcbiAgdGVzdChcImV4cG9ydHMgb25lIHJlZGFjdGVkIGxpdmUtcHJvdmlkZXIgbWlzc2lvbiBjb3JyZWxhdGlvbiByZXBvcnRcIiwgYXN5bmMgKHtcbiAgICBwYWdlLFxuICB9KSA9PiB7XG4gICAgLy8gVGhlIFBsYXl3cmlnaHQgZGVhZGxpbmUgbXVzdCBsZWF2ZSByb29tIGZvciB0aGUgcHJvdmlkZXItYm91bmQgcmVxdWVzdFxuICAgIC8vIGFuZCBwb2xsaW5nIGxvb3AgdG8gY29uc3VtZSB0aGVpciBjb21wbGV0ZSBjb25maWd1cmVkIGJ1ZGdldC5cbiAgICB0ZXN0LnNldFRpbWVvdXQobGl2ZVRpbWVvdXRNcygpICsgTElWRV9URVNUX1RJTUVPVVRfTUFSR0lOX01TKTtcbiAgICB0ZXN0LnNraXAoXG4gICAgICBwcm9jZXNzLmVudi5EQVNIQk9BUkRfRTJFX0xJVkVfUFJPVklERVIgIT09IFwiMVwiLFxuICAgICAgXCJMaXZlLXByb3ZpZGVyIHJlbGVhc2Ugam91cm5leSBpcyBvcHQtaW4uXCIsXG4gICAgKTtcbiAgICBpZiAocHJvY2Vzcy5lbnYuREFTSEJPQVJEX0UyRV9MSVZFX0RJU1BPU0FCTEUgIT09IFwiMVwiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgIFwiTGl2ZS1wcm92aWRlciBqb3VybmV5IHJlcXVpcmVzIERBU0hCT0FSRF9FMkVfTElWRV9ESVNQT1NBQkxFPTEgYW5kIGEgZGlzcG9zYWJsZSBwcm9qZWN0LlwiLFxuICAgICAgKTtcbiAgICB9XG4gICAgY29uc3QgY2FtcGFpZ25TY2VuYXJpbyA9IGxpdmVDYW1wYWlnblNjZW5hcmlvKCk7XG4gICAgY29uc3QgcHJvamVjdElkID0gcHJvY2Vzcy5lbnYuREFTSEJPQVJEX0UyRV9MSVZFX1BST0pFQ1RfSUQ7XG4gICAgaWYgKCFwcm9qZWN0SWQpXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgIFwiREFTSEJPQVJEX0UyRV9MSVZFX1BST0pFQ1RfSUQgaXMgcmVxdWlyZWQgZm9yIHRoZSBsaXZlLXByb3ZpZGVyIGpvdXJuZXkuXCIsXG4gICAgICApO1xuXG4gICAgYXdhaXQgcHJvZ3JhbW1hdGljU2lnbkluKHBhZ2UpO1xuICAgIGNvbnN0IHN0cmVhbVJlc3BvbnNlID0gYXdhaXQgbGl2ZVJlcXVlc3QocGFnZSwgXCIvYXBpL2FpL2NoYXQvc3RyZWFtXCIsIHtcbiAgICAgIG1ldGhvZDogXCJQT1NUXCIsXG4gICAgICB0aW1lb3V0OiBsaXZlVGltZW91dE1zKCksXG4gICAgICBib2R5OiB7XG4gICAgICAgIHByb2plY3RJZCxcbiAgICAgICAgIG1lc3NhZ2U6IGxpdmVQcm9tcHQoKSxcbiAgICAgICAgaWRlbXBvdGVuY3lLZXk6IGBkYXNoYm9hcmQtbGl2ZS0ke0RhdGUubm93KCl9YCxcbiAgICAgIH0sXG4gICAgfSk7XG4gICAgaWYgKHN0cmVhbVJlc3BvbnNlLnN0YXR1cyA8IDIwMCB8fCBzdHJlYW1SZXNwb25zZS5zdGF0dXMgPj0gMzAwKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgIGBMaXZlLXByb3ZpZGVyIG1pc3Npb24gZmFpbGVkIHRvIHN0YXJ0ICgke3N0cmVhbVJlc3BvbnNlLnN0YXR1c30pLmAsXG4gICAgICApO1xuICAgIH1cbiAgICBjb25zdCBzc2VFdmVudHMgPSBwYXJzZVNzZShzdHJlYW1SZXNwb25zZS5ib2R5KTtcbiAgICBjb25zdCBzdGFydGVkID0gc3NlRXZlbnRzLmZpbmQoXG4gICAgICAoZXZlbnQpID0+IGV2ZW50LnR5cGUgPT09IFwiZXhlY3V0aW9uX3N0YXJ0ZWRcIixcbiAgICApO1xuICAgIGNvbnN0IGV4ZWN1dGlvbklkID1cbiAgICAgIHR5cGVvZiBzdGFydGVkPy5leGVjdXRpb25JZCA9PT0gXCJzdHJpbmdcIlxuICAgICAgICA/IHN0YXJ0ZWQuZXhlY3V0aW9uSWRcbiAgICAgICAgOiB1bmRlZmluZWQ7XG4gICAgaWYgKCFleGVjdXRpb25JZClcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkxpdmUtcHJvdmlkZXIgc3RyZWFtIGRpZCBub3QgZW1pdCBleGVjdXRpb25fc3RhcnRlZC5cIik7XG5cbiAgICBsZXQgZXhlY3V0aW9uOiBSZWNvcmQ8c3RyaW5nLCBhbnk+ID0ge307XG4gICAgY29uc3QgZGVhZGxpbmUgPSBEYXRlLm5vdygpICsgbGl2ZVRpbWVvdXRNcygpO1xuICAgIHdoaWxlIChEYXRlLm5vdygpIDwgZGVhZGxpbmUpIHtcbiAgICAgIGV4ZWN1dGlvbiA9IGF3YWl0IGxpdmVKc29uKHBhZ2UsIGAvYXBpL2FpL2V4ZWN1dGlvbnMvJHtleGVjdXRpb25JZH1gKTtcbiAgICAgIGlmIChcbiAgICAgICAgW1wiY29tcGxldGVkXCIsIFwiZmFpbGVkXCIsIFwiY2FuY2VsbGVkXCJdLmluY2x1ZGVzKFN0cmluZyhleGVjdXRpb24uc3RhdHVzKSlcbiAgICAgIClcbiAgICAgICAgYnJlYWs7XG4gICAgICBhd2FpdCBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4gc2V0VGltZW91dChyZXNvbHZlLCA3NTApKTtcbiAgICB9XG4gICAgaWYgKFxuICAgICAgIVtcImNvbXBsZXRlZFwiLCBcImZhaWxlZFwiLCBcImNhbmNlbGxlZFwiXS5pbmNsdWRlcyhTdHJpbmcoZXhlY3V0aW9uLnN0YXR1cykpXG4gICAgKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgIFwiTGl2ZS1wcm92aWRlciBtaXNzaW9uIGRpZCBub3QgcmVhY2ggYSB0ZXJtaW5hbCBzdGF0ZSB3aXRoaW4gaXRzIGJvdW5kLlwiLFxuICAgICAgKTtcbiAgICB9XG5cbiAgICBjb25zdCBzZXNzaW9uSWQgPSBTdHJpbmcoZXhlY3V0aW9uLnNlc3Npb25JZCk7XG4gICAgY29uc3QgbWVzc2FnZXMgPSBhd2FpdCBsaXZlQXJyYXkoXG4gICAgICBwYWdlLFxuICAgICAgYC9hcGkvYWkvY2hhdC8ke3Nlc3Npb25JZH0vbWVzc2FnZXNgLFxuICAgICk7XG4gICAgY29uc3QgZXZlbnRzID0gYXdhaXQgbGl2ZUFycmF5KFxuICAgICAgcGFnZSxcbiAgICAgIGAvYXBpL2V2ZW50cz9wcm9qZWN0SWQ9JHtlbmNvZGVVUklDb21wb25lbnQocHJvamVjdElkKX0mY29ycmVsYXRpb25JZD0ke2VuY29kZVVSSUNvbXBvbmVudChTdHJpbmcoZXhlY3V0aW9uLm9wZXJhdGlvbklkID8/IFwiXCIpKX1gLFxuICAgICk7XG4gICAgY29uc3QgcHJvcG9zYWwgPSBhd2FpdCBsaXZlT3B0aW9uYWxSZWNvcmQoXG4gICAgICBwYWdlLFxuICAgICAgYC9hcGkvYWkvY2hhdC8ke3Nlc3Npb25JZH0vcGVuZGluZy1wcm9wb3NhbGAsXG4gICAgKTtcbiAgICBjb25zdCBnaXRMb2cgPSBhd2FpdCBsaXZlSnNvbihwYWdlLCBgL2FwaS9wcm9qZWN0cy8ke3Byb2plY3RJZH0vZ2l0L2xvZ2ApO1xuICAgIGNvbnN0IG1pc3Npb25Db250cm9sID0gYXdhaXQgbGl2ZUpzb24ocGFnZSwgXCIvYXBpL2FpL21pc3Npb24tY29udHJvbFwiKTtcbiAgICBjb25zdCBkYXNoYm9hcmRTdGF0ZSA9IGF3YWl0IGxpdmVKc29uKHBhZ2UsIFwiL2FwaS9kYXNoYm9hcmRcIik7XG4gICAgY29uc3QgY2hlY2twb2ludCA9XG4gICAgICBleGVjdXRpb24uY2hlY2twb2ludCAmJiB0eXBlb2YgZXhlY3V0aW9uLmNoZWNrcG9pbnQgPT09IFwib2JqZWN0XCJcbiAgICAgICAgPyAoZXhlY3V0aW9uLmNoZWNrcG9pbnQgYXMgUmVjb3JkPHN0cmluZywgYW55PilcbiAgICAgICAgOiB7fTtcbiAgICBjb25zdCByZWNlbnRTdGVwcyA9IEFycmF5LmlzQXJyYXkoY2hlY2twb2ludC5yZWNlbnRTdGVwcylcbiAgICAgID8gY2hlY2twb2ludC5yZWNlbnRTdGVwc1xuICAgICAgOiBbXTtcbiAgICBjb25zdCB2YWxpZGF0aW9uID0gcmVjZW50U3RlcHMuZmlsdGVyKFxuICAgICAgKHN0ZXApID0+IHN0ZXA/LmtpbmQgPT09IFwidmFsaWRhdGlvblwiLFxuICAgICk7XG4gICAgY29uc3QgcHJvamVjdFJldmlzaW9uID1cbiAgICAgIHR5cGVvZiBleGVjdXRpb24ucHJvamVjdFJldmlzaW9uID09PSBcInN0cmluZ1wiXG4gICAgICAgID8gZXhlY3V0aW9uLnByb2plY3RSZXZpc2lvblxuICAgICAgICA6IHVuZGVmaW5lZDtcbiAgICBjb25zdCBjYW5kaWRhdGVIYXNoID0gdmFsaWRhdGlvblxuICAgICAgLm1hcCgoc3RlcCkgPT4gc3RlcD8udmFsaWRhdGlvbj8uY2FuZGlkYXRlSGFzaCA/PyBzdGVwPy5jYW5kaWRhdGVIYXNoKVxuICAgICAgLmZpbmQoKHZhbHVlKTogdmFsdWUgaXMgc3RyaW5nID0+IHR5cGVvZiB2YWx1ZSA9PT0gXCJzdHJpbmdcIiAmJiB2YWx1ZS5sZW5ndGggPiAwKTtcbiAgICBjb25zdCBjYW5kaWRhdGVJZGVudGl0eSA9XG4gICAgICB0eXBlb2YgZXhlY3V0aW9uLmNhbmRpZGF0ZUlkZW50aXR5ID09PSBcInN0cmluZ1wiXG4gICAgICAgID8gZXhlY3V0aW9uLmNhbmRpZGF0ZUlkZW50aXR5XG4gICAgICAgIDogY2FuZGlkYXRlSGFzaFxuICAgICAgICAgID8gYGNhbmRpZGF0ZToke2NhbmRpZGF0ZUhhc2h9YFxuICAgICAgICAgIDogYHJlYWQtb25seToke3Byb2plY3RSZXZpc2lvbiA/PyBcInVua25vd25cIn1gO1xuICAgIGlmICghcHJvamVjdFJldmlzaW9uKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJMaXZlLXByb3ZpZGVyIG1pc3Npb24gaXMgbWlzc2luZyBpdHMgcHJvamVjdCByZXZpc2lvbi5cIik7XG4gICAgfVxuICAgIGlmIChcbiAgICAgIHByb2Nlc3MuZW52LkRBU0hCT0FSRF9FMkVfTElWRV9DQU1QQUlHTiA9PT0gXCIxXCIgJiZcbiAgICAgICghY2FuZGlkYXRlSWRlbnRpdHkgfHwgIXByb2plY3RSZXZpc2lvbilcbiAgICApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkxpdmUgY2FtcGFpZ24gcmVxdWlyZXMgb3BlcmF0aW9uLCByZXZpc2lvbiwgYW5kIGNhbmRpZGF0ZSBjb3JyZWxhdGlvbi5cIik7XG4gICAgfVxuICAgIGNvbnN0IGV2aWRlbmNlQ291bnQgPSByZWNlbnRTdGVwcy5yZWR1Y2UoXG4gICAgICAoY291bnQsIHN0ZXApID0+IGNvdW50ICsgKE51bWJlcihzdGVwPy5hY2NlcHRlZEV2aWRlbmNlQ291bnQpIHx8IDApLFxuICAgICAgMCxcbiAgICApO1xuICAgIGNvbnN0IHRlcm1pbmFsU3RhdGUgPSBTdHJpbmcoXG4gICAgICBleGVjdXRpb24uZmxpZ2h0U3RhdGUgPz8gZXhlY3V0aW9uLnN0YXR1cyxcbiAgICApLnRvVXBwZXJDYXNlKCk7XG4gICAgY29uc3Qgc3VjY2Vzc1N0YXRlcyA9IG5ldyBTZXQoW1xuICAgICAgXCJDT01QTEVURURcIixcbiAgICAgIFwiUkVBRFlfRk9SX1JFVklFV1wiLFxuICAgICAgXCJBUFBMSUVEXCIsXG4gICAgICBcIkNPTU1JVFRFRFwiLFxuICAgICAgXCJQVVNIRURcIixcbiAgICBdKTtcbiAgICBpZiAoXG4gICAgICBjYW1wYWlnblNjZW5hcmlvID09PSBcImRlbGl2ZXJ5LXN1Y2Nlc3NcIiAmJlxuICAgICAgc3VjY2Vzc1N0YXRlcy5oYXModGVybWluYWxTdGF0ZSkgJiZcbiAgICAgICFjYW5kaWRhdGVIYXNoXG4gICAgKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgIFwiRGVsaXZlcnktc3VjY2VzcyBjYW1wYWlnbiBjYW5ub3QgcGFzcyB3aXRob3V0IGEgY2FuZGlkYXRlLWJvdW5kIHZhbGlkYXRpb24gaGFzaC5cIixcbiAgICAgICk7XG4gICAgfVxuICAgIGNvbnN0IGRlbGl2ZXJ5U3RhZ2VzID0ge1xuICAgICAgYXBwbGllZDogZXZlbnRzLnNvbWUoKGV2ZW50KSA9PiBldmVudD8udHlwZSA9PT0gXCJBaUNoYW5nZXNBcHBsaWVkXCIpLFxuICAgICAgY29tbWl0dGVkOiBldmVudHMuc29tZSgoZXZlbnQpID0+IGV2ZW50Py50eXBlID09PSBcIkdpdENvbW1pdENyZWF0ZWRcIiksXG4gICAgICBwdXNoZWQ6IGV2ZW50cy5zb21lKChldmVudCkgPT4gZXZlbnQ/LnR5cGUgPT09IFwiR2l0UHVzaGVkXCIpLFxuICAgIH07XG4gICAgaWYgKFxuICAgICAgY2FtcGFpZ25TY2VuYXJpbyA9PT0gXCJkZWxpdmVyeS1zdWNjZXNzXCIgJiZcbiAgICAgIHN1Y2Nlc3NTdGF0ZXMuaGFzKHRlcm1pbmFsU3RhdGUpICYmXG4gICAgICAhT2JqZWN0LnZhbHVlcyhkZWxpdmVyeVN0YWdlcykuZXZlcnkoQm9vbGVhbilcbiAgICApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgXCJEZWxpdmVyeS1zdWNjZXNzIGNhbXBhaWduIGNhbm5vdCBwYXNzIHdpdGhvdXQgb3BlcmF0aW9uLWNvcnJlbGF0ZWQgYXBwbHksIGNvbW1pdCwgYW5kIHB1c2ggZXZpZGVuY2UuXCIsXG4gICAgICApO1xuICAgIH1cbiAgICBpZiAoXG4gICAgICBzdWNjZXNzU3RhdGVzLmhhcyh0ZXJtaW5hbFN0YXRlKSAmJlxuICAgICAgKGV2aWRlbmNlQ291bnQgPCAxIHx8IHZhbGlkYXRpb24ubGVuZ3RoIDwgMSlcbiAgICApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgYExpdmUtcHJvdmlkZXIgbWlzc2lvbiByZXBvcnRlZCAke3Rlcm1pbmFsU3RhdGV9IHdpdGhvdXQgYWNjZXB0ZWQgZXZpZGVuY2UgYW5kIHZhbGlkYXRpb24gYCArXG4gICAgICAgICAgYChldmlkZW5jZT0ke2V2aWRlbmNlQ291bnR9LCB2YWxpZGF0aW9uPSR7dmFsaWRhdGlvbi5sZW5ndGh9KS5gLFxuICAgICAgKTtcbiAgICB9XG4gICAgY29uc3QgY2FwdHVyZSA9IHtcbiAgICAgIHByb2plY3RJZCxcbiAgICAgIHNlc3Npb25JZCxcbiAgICAgIG9wZXJhdGlvbklkOiBleGVjdXRpb24ub3BlcmF0aW9uSWQsXG4gICAgICB3b3Jrc3BhY2VSZXZpc2lvbjpcbiAgICAgICAgZ2l0TG9nLmNvbW1pdHM/LlswXT8uc2hvcnRIYXNoID8/XG4gICAgICAgIGdpdExvZy5jb21taXRzPy5bMF0/Lmhhc2g/LnNsaWNlKDAsIDEyKSxcbiAgICAgIHByb2plY3RSZXZpc2lvbixcbiAgICAgIGNhbmRpZGF0ZUlkZW50aXR5LFxuICAgICAgY2FuZGlkYXRlUmV2aXNpb246IHByb2plY3RSZXZpc2lvbixcbiAgICAgIGNhbXBhaWduU2NlbmFyaW8sXG4gICAgICBkZWxpdmVyeVN0YWdlcyxcbiAgICAgIGN1cnJlbnRPcGVyYXRpb246IHtcbiAgICAgICAgb3BlcmF0aW9uSWQ6IGV4ZWN1dGlvbi5vcGVyYXRpb25JZCxcbiAgICAgICAgcmV2aXNpb246IHByb2plY3RSZXZpc2lvbixcbiAgICAgICAgc3RhdHVzOiBleGVjdXRpb24uc3RhdHVzLFxuICAgICAgICB0ZXJtaW5hbFN0YXRlLFxuICAgICAgfSxcbiAgICAgIHJldGFpbmVkUmVzdWx0OlxuICAgICAgICB0ZXJtaW5hbFN0YXRlID09PSBcIkZBSUxFRFwiIHx8IHRlcm1pbmFsU3RhdGUgPT09IFwiQkxPQ0tFRFwiIHx8IHRlcm1pbmFsU3RhdGUgPT09IFwiSU5DT01QTEVURVwiXG4gICAgICAgICAgPyB7XG4gICAgICAgICAgICAgIG9wZXJhdGlvbklkOiBleGVjdXRpb24ub3BlcmF0aW9uSWQsXG4gICAgICAgICAgICAgIHJldmlzaW9uOiBwcm9qZWN0UmV2aXNpb24sXG4gICAgICAgICAgICAgIGxhYmVsOiBcInJldGFpbmVkIHJlc3VsdCBmcm9tIHRoZSBjdXJyZW50IGZhaWxlZCBvciBpbmNvbXBsZXRlIG9wZXJhdGlvblwiLFxuICAgICAgICAgICAgfVxuICAgICAgICAgIDogdW5kZWZpbmVkLFxuICAgICAgdGVybWluYWxTdGF0ZSxcbiAgICAgIGV4ZWN1dGlvbjoge1xuICAgICAgICBpZDogZXhlY3V0aW9uLmlkLFxuICAgICAgICBwcm9qZWN0SWQ6IGV4ZWN1dGlvbi5wcm9qZWN0SWQsXG4gICAgICAgIHNlc3Npb25JZDogZXhlY3V0aW9uLnNlc3Npb25JZCxcbiAgICAgICAgb3BlcmF0aW9uSWQ6IGV4ZWN1dGlvbi5vcGVyYXRpb25JZCxcbiAgICAgICAgc3RhdHVzOiBleGVjdXRpb24uc3RhdHVzLFxuICAgICAgICBmbGlnaHRTdGF0ZTogZXhlY3V0aW9uLmZsaWdodFN0YXRlLFxuICAgICAgfSxcbiAgICAgIG1lc3NhZ2VzOiBtZXNzYWdlcy5tYXAoXG4gICAgICAgICh7XG4gICAgICAgICAgaWQsXG4gICAgICAgICAgc2Vzc2lvbklkOiBtZXNzYWdlU2Vzc2lvbixcbiAgICAgICAgICByb2xlLFxuICAgICAgICAgIGV4ZWN1dGlvbklkOiBtZXNzYWdlRXhlY3V0aW9uLFxuICAgICAgICAgIG91dGNvbWUsXG4gICAgICAgIH0pID0+ICh7XG4gICAgICAgICAgaWQsXG4gICAgICAgICAgc2Vzc2lvbklkOiBtZXNzYWdlU2Vzc2lvbixcbiAgICAgICAgICByb2xlLFxuICAgICAgICAgIGV4ZWN1dGlvbklkOiBtZXNzYWdlRXhlY3V0aW9uLFxuICAgICAgICAgIG91dGNvbWUsXG4gICAgICAgIH0pLFxuICAgICAgKSxcbiAgICAgIHNzZUV2ZW50czogc3NlRXZlbnRzLm1hcChcbiAgICAgICAgKHtcbiAgICAgICAgICB0eXBlLFxuICAgICAgICAgIGV4ZWN1dGlvbklkOiBldmVudEV4ZWN1dGlvbixcbiAgICAgICAgICBzZXNzaW9uSWQ6IGV2ZW50U2Vzc2lvbixcbiAgICAgICAgICBvdXRjb21lLFxuICAgICAgICAgIGNvZGUsXG4gICAgICAgIH0pID0+ICh7XG4gICAgICAgICAgdHlwZSxcbiAgICAgICAgICBleGVjdXRpb25JZDogZXZlbnRFeGVjdXRpb24sXG4gICAgICAgICAgc2Vzc2lvbklkOiBldmVudFNlc3Npb24sXG4gICAgICAgICAgb3V0Y29tZSxcbiAgICAgICAgICBjb2RlLFxuICAgICAgICB9KSxcbiAgICAgICksXG4gICAgICBjaGVja3BvaW50czogW1xuICAgICAgICB7XG4gICAgICAgICAgc2VxdWVuY2U6IGNoZWNrcG9pbnQuc2VxdWVuY2UsXG4gICAgICAgICAgc3RhZ2U6IGNoZWNrcG9pbnQuc3RhZ2UsXG4gICAgICAgICAgdXBkYXRlZEF0OiBjaGVja3BvaW50LnVwZGF0ZWRBdCxcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgICBldmlkZW5jZUNvdW50LFxuICAgICAgcHJvcG9zYWxzOiBwcm9wb3NhbFxuICAgICAgICA/IFtcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgaWQ6IHByb3Bvc2FsLmlkLFxuICAgICAgICAgICAgICByZXZpc2lvbjogcHJvcG9zYWwucmV2aXNpb24sXG4gICAgICAgICAgICAgIHN0YXR1czogcHJvcG9zYWwuc3RhdHVzLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICBdXG4gICAgICAgIDogW10sXG4gICAgICB2YWxpZGF0aW9uOiB2YWxpZGF0aW9uLm1hcCgoc3RlcCkgPT4gKHtcbiAgICAgICAgc3RhdHVzOiBzdGVwLnZhbGlkYXRpb24/LnN0YXR1cyA/PyBzdGVwLnN0YXR1cyxcbiAgICAgICAgcHJvZmlsZTogc3RlcC52YWxpZGF0aW9uPy5wcm9maWxlID8/IHN0ZXAudmFsaWRhdGlvblByb2ZpbGUsXG4gICAgICB9KSksXG4gICAgICBldmVudHM6IGV2ZW50cy5tYXAoKHsgdHlwZSwgc2V2ZXJpdHksIGNvcnJlbGF0aW9uSWQgfSkgPT4gKHtcbiAgICAgICAgdHlwZSxcbiAgICAgICAgc2V2ZXJpdHksXG4gICAgICAgIGNvcnJlbGF0aW9uSWQsXG4gICAgICB9KSksXG4gICAgICBkYXNoYm9hcmQ6IG1pc3Npb25Db250cm9sLFxuICAgICAgZGFzaGJvYXJkU3RhdGU6IHtcbiAgICAgICAgcHJvamVjdENvdW50OiBkYXNoYm9hcmRTdGF0ZS5wcm9qZWN0Q291bnQsXG4gICAgICAgIGFjdGl2ZVRhc2tDb3VudDogZGFzaGJvYXJkU3RhdGUuYWN0aXZlVGFza0NvdW50LFxuICAgICAgfSxcbiAgICB9O1xuICAgIGNvbnN0IG91dHB1dFBhdGggPVxuICAgICAgcHJvY2Vzcy5lbnYuREFTSEJPQVJEX0UyRV9MSVZFX1JFUE9SVF9QQVRIID8/XG4gICAgICBcInRlc3QtcmVzdWx0cy9kYXNoYm9hcmQtam91cm5leS9saXZlLW1pc3Npb24tY29ycmVsYXRpb24uanNvblwiO1xuICAgIGF3YWl0IG1rZGlyKGRpcm5hbWUob3V0cHV0UGF0aCksIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xuICAgIGF3YWl0IHdyaXRlRmlsZShcbiAgICAgIG91dHB1dFBhdGgsXG4gICAgICBgJHtKU09OLnN0cmluZ2lmeShjYXB0dXJlLCBudWxsLCAyKX1cXG5gLFxuICAgICAgXCJ1dGY4XCIsXG4gICAgKTtcbiAgfSk7XG5cbiAgdGVzdChcInNpZ25zIGluIGFuZCB0cmF2ZXJzZXMgdGhlIGF1dGhlbnRpY2F0ZWQgb3BlcmF0aW9uYWwgc2hlbGxcIiwgYXN5bmMgKHtcbiAgICBwYWdlLFxuICB9KSA9PiB7XG4gICAgYXdhaXQgaW5zdGFsbEFwaUZpeHR1cmVzKHBhZ2UpO1xuICAgIGF3YWl0IHByb2dyYW1tYXRpY1NpZ25JbihwYWdlKTtcbiAgICBmb3IgKGNvbnN0IG9yaWdpbiBvZiBhcHByb3ZlZERhc2hib2FyZE9yaWdpbnMoKSkge1xuICAgICAgYXdhaXQgZXhwZWN0T3JpZ2luQ2FuVXNlQXBpKHBhZ2UsIG9yaWdpbik7XG4gICAgfVxuICAgIGF3YWl0IGV4cGVjdEhvc3RpbGVPcmlnaW5SZWplY3RlZChwYWdlKTtcblxuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlSb2xlKFwiaGVhZGluZ1wiLCB7IG5hbWU6IFwiU3lzdGVtIE92ZXJ2aWV3XCIgfSksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiU1lTVEVNIE9OTElORVwiLCB7IGV4YWN0OiB0cnVlIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcIlNtb2tlIFByb2plY3RcIiwgeyBleGFjdDogdHJ1ZSB9KS5maXJzdCgpLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcIkRhc2hib2FyZCBBUEkgZml4dHVyZSByZWFkeVwiLCB7IGV4YWN0OiB0cnVlIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBvcGVuTmF2aWdhdGlvbihwYWdlLCBcIlByb2plY3RzXCIsIGAke0RBU0hCT0FSRF9QQVRIfXByb2plY3RzYCk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlSb2xlKFwiaGVhZGluZ1wiLCB7IG5hbWU6IFwiUHJvamVjdHNcIiB9KSkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcIlNtb2tlIFByb2plY3RcIiwgeyBleGFjdDogdHJ1ZSB9KSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG5cbiAgICBhd2FpdCBvcGVuTmF2aWdhdGlvbihwYWdlLCBcIkV2ZW50IFN0cmVhbVwiLCBgJHtEQVNIQk9BUkRfUEFUSH1ldmVudHNgKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5Um9sZShcImhlYWRpbmdcIiwgeyBuYW1lOiBcIkV2ZW50IFN0cmVhbVwiIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcIkRhc2hib2FyZCBBUEkgZml4dHVyZSByZWFkeVwiLCB7IGV4YWN0OiB0cnVlIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcblxuICAgIGF3YWl0IG9wZW5OYXZpZ2F0aW9uKHBhZ2UsIFwiQUkgQXNzaXN0YW50XCIsIGAke0RBU0hCT0FSRF9QQVRIfWFpYCk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UpLm5vdC50b0hhdmVVUkwoL3NpZ24taW4vKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlXG4gICAgICAgIC5nZXRCeVRleHQoXG4gICAgICAgICAgL0FJIHByb3ZpZGVyIG5vdCBjb25maWd1cmVkfE5vIEFJIGtleSBjb25maWd1cmVkfEFJIEFzc2lzdGFudC9pLFxuICAgICAgICApXG4gICAgICAgIC5maXJzdCgpLFxuICAgICkudG9CZVZpc2libGUoKTtcblxuICAgIGF3YWl0IG9wZW5OYXZpZ2F0aW9uKFxuICAgICAgcGFnZSxcbiAgICAgIFwiTWlzc2lvbiBDb250cm9sXCIsXG4gICAgICBgJHtEQVNIQk9BUkRfUEFUSH1taXNzaW9uLWNvbnRyb2xgLFxuICAgICk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVJvbGUoXCJoZWFkaW5nXCIsIHsgbmFtZTogXCJObyBkdXJhYmxlIHJ1bnMgaW4gdGhlIGxlZGdlclwiIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcblxuICAgIGF3YWl0IHBhZ2UuZ290byhgJHtEQVNIQk9BUkRfUEFUSH1mbGlnaHQtZGVjaz9leGVjdXRpb25JZD0ke0VYRUNVVElPTl9JRH1gKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZSkudG9IYXZlVVJMKFxuICAgICAgbmV3IFJlZ0V4cChcbiAgICAgICAgYCR7REFTSEJPQVJEX1BBVEgucmVwbGFjZUFsbChcIi9cIiwgXCJcXFxcL1wiKX1mbGlnaHQtZGVja1xcXFw/ZXhlY3V0aW9uSWQ9YCxcbiAgICAgICksXG4gICAgKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5Um9sZShcImhlYWRpbmdcIiwgeyBuYW1lOiBcIkF1ZGl0IC8gQ2hhdCBydW5cIiB9KSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXCJDb250cm9sbGVkIGJyb3dzZXIgZml4dHVyZSBjb21wbGV0ZWQuXCIsIHsgZXhhY3Q6IHRydWUgfSksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiUFJPVkVOXCIsIHsgZXhhY3Q6IHRydWUgfSkuZmlyc3QoKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gIH0pO1xuXG4gIHRlc3QoXCJvcGVucyBmYWlsZWQgdGFzayBhbmQgd29ya2Zsb3cgZGV0YWlscyB3aXRoIHJlZGFjdGVkIHJlY292ZXJ5IGd1aWRhbmNlXCIsIGFzeW5jICh7XG4gICAgcGFnZSxcbiAgfSkgPT4ge1xuICAgIGNvbnN0IHJhd0RpYWdub3N0aWMgPSBcInByb3ZpZGVyIGRpYWdub3N0aWM6IHVwc3RyZWFtIHJldHVybmVkIHJhdyByZXNwb25zZVwiO1xuICAgIGNvbnN0IHJhd0NyZWRlbnRpYWwgPSBcInNrLWUyZS1icm93c2VyLWNyZWRlbnRpYWwtc2VjcmV0XCI7XG4gICAgY29uc3Qgc3VwcG9ydFJlZmVyZW5jZXMgPSB7XG4gICAgICBhdXRoZW50aWNhdGlvbl9mYWlsZWQ6IFwic3VwcG9ydC10YXNrLWF1dGgtMzJcIixcbiAgICAgIHF1b3RhX2V4aGF1c3RlZDogXCJzdXBwb3J0LXRhc2stcXVvdGEtMzJcIixcbiAgICAgIHByb3ZpZGVyX291dGFnZTogXCJzdXBwb3J0LXdvcmtmbG93LW91dGFnZS0zMlwiLFxuICAgIH07XG4gICAgY29uc3QgcmVjb3ZlcnlUYXNrcyA9IFtcbiAgICAgIHtcbiAgICAgICAgaWQ6IFwiZTJlLWF1dGgtZmFpbGVkLXRhc2tcIixcbiAgICAgICAgcHJvamVjdElkOiBcImUyZS1wcm9qZWN0XCIsXG4gICAgICAgIHRpdGxlOiBcIlJlY292ZXIgYXV0aGVudGljYXRpb24gZmFpbHVyZVwiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJUaGUgcHJvdmlkZXIgYXV0aGVudGljYXRpb24gdGVzdCB0YXNrIGZhaWxlZC5cIixcbiAgICAgICAgc3RhdHVzOiBcImZhaWxlZFwiLFxuICAgICAgICBwcmlvcml0eTogXCJwMVwiLFxuICAgICAgICByZWxhdGVkRmlsZXM6IFtcInNyYy9wcm92aWRlci50c1wiXSxcbiAgICAgICAgcmV0cnlDb3VudDogMSxcbiAgICAgICAgbWF4UmV0cmllczogMixcbiAgICAgICAgYWdlbnRSZXNwb25zZTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgIGtpbmQ6IFwiQUlfVEFTS19FWEVDVVRJT05fUkVDRUlQVFwiLFxuICAgICAgICAgIHRlcm1pbmFsU3RhdHVzOiBcIkZBSUxFRFwiLFxuICAgICAgICAgIGF2YWlsYWJpbGl0eVN0YXRlOiBcImF1dGhlbnRpY2F0aW9uX2ZhaWxlZFwiLFxuICAgICAgICAgIGNvcnJlbGF0aW9uSWQ6IHN1cHBvcnRSZWZlcmVuY2VzLmF1dGhlbnRpY2F0aW9uX2ZhaWxlZCxcbiAgICAgICAgICBvcGVyYXRvckFjdGlvbjogXCJSZXBsYWNlIHRoZSBwcm92aWRlciBBUEkga2V5IHdpdGggYSB2YWxpZCBrZXksIHRoZW4gcmV0cnkuXCIsXG4gICAgICAgICAgcHJvdmlkZXI6IFwib3BlbnJvdXRlclwiLFxuICAgICAgICAgIG1vZGVsOiBcInNlY3JldC1tb2RlbC1uYW1lXCIsXG4gICAgICAgICAgdGVybWluYWxSZWFzb246IHJhd0RpYWdub3N0aWMsXG4gICAgICAgICAgb3BlcmF0aW9uSWQ6IHJhd0NyZWRlbnRpYWwsXG4gICAgICAgIH0pLFxuICAgICAgICBjcmVhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMDowMC4wMDBaXCIsXG4gICAgICAgIHVwZGF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAxOjAwLjAwMFpcIixcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIGlkOiBcImUyZS1xdW90YS1mYWlsZWQtdGFza1wiLFxuICAgICAgICBwcm9qZWN0SWQ6IFwiZTJlLXByb2plY3RcIixcbiAgICAgICAgdGl0bGU6IFwiUmVjb3ZlciBxdW90YSBleGhhdXN0aW9uXCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIlRoZSBwcm92aWRlciBxdW90YSB0ZXN0IHRhc2sgZmFpbGVkLlwiLFxuICAgICAgICBzdGF0dXM6IFwiZmFpbGVkXCIsXG4gICAgICAgIHByaW9yaXR5OiBcInAxXCIsXG4gICAgICAgIHJldHJ5Q291bnQ6IDAsXG4gICAgICAgIG1heFJldHJpZXM6IDIsXG4gICAgICAgIGFnZW50UmVzcG9uc2U6IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgICBraW5kOiBcIkFJX1RBU0tfRVhFQ1VUSU9OX1JFQ0VJUFRcIixcbiAgICAgICAgICB0ZXJtaW5hbFN0YXR1czogXCJGQUlMRURcIixcbiAgICAgICAgICBhdmFpbGFiaWxpdHlTdGF0ZTogXCJxdW90YV9leGhhdXN0ZWRcIixcbiAgICAgICAgICBjb3JyZWxhdGlvbklkOiBzdXBwb3J0UmVmZXJlbmNlcy5xdW90YV9leGhhdXN0ZWQsXG4gICAgICAgICAgcHJvdmlkZXI6IFwib3BlbnJvdXRlclwiLFxuICAgICAgICAgIG1vZGVsOiBcInNlY3JldC1tb2RlbC1uYW1lXCIsXG4gICAgICAgICAgdGVybWluYWxSZWFzb246IHJhd0RpYWdub3N0aWMsXG4gICAgICAgICAgb3BlcmF0aW9uSWQ6IHJhd0NyZWRlbnRpYWwsXG4gICAgICAgIH0pLFxuICAgICAgICBjcmVhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMDowMC4wMDBaXCIsXG4gICAgICAgIHVwZGF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAxOjAwLjAwMFpcIixcbiAgICAgIH0sXG4gICAgXTtcbiAgICBjb25zdCB3b3JrZmxvd0lkID0gXCJlMmUtb3V0YWdlLXdvcmtmbG93XCI7XG4gICAgYXdhaXQgaW5zdGFsbEFwaUZpeHR1cmVzKHBhZ2UsIHtcbiAgICAgIHJlY292ZXJ5VGFza3MsXG4gICAgICByZWNvdmVyeVdvcmtmbG93czogW1xuICAgICAgICB7XG4gICAgICAgICAgaWQ6IHdvcmtmbG93SWQsXG4gICAgICAgICAgcHJvamVjdElkOiBcImUyZS1wcm9qZWN0XCIsXG4gICAgICAgICAgbmFtZTogXCJSZWNvdmVyIHByb3ZpZGVyIG91dGFnZVwiLFxuICAgICAgICAgIGRlc2NyaXB0aW9uOiBcIkEgcGlwZWxpbmUgdXNlZCB0byB2ZXJpZnkgb3V0YWdlIHJlY292ZXJ5IGd1aWRhbmNlLlwiLFxuICAgICAgICAgIHN0YXR1czogXCJmYWlsZWRcIixcbiAgICAgICAgICBwaGFzZXM6IFtcbiAgICAgICAgICAgIHsgbmFtZTogXCJidWlsZFwiLCBzdGVwczogW1wiY29tcGlsZVwiXSB9LFxuICAgICAgICAgICAgeyBuYW1lOiBcInRlc3RcIiwgc3RlcHM6IFtcInZlcmlmeVwiXSB9LFxuICAgICAgICAgIF0sXG4gICAgICAgICAgY3VycmVudFBoYXNlOiBcInRlc3RcIixcbiAgICAgICAgICBleGVjdXRpb25Db3VudDogMSxcbiAgICAgICAgICBjcmVhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMDowMC4wMDBaXCIsXG4gICAgICAgICAgdXBkYXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDE6MDAuMDAwWlwiLFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICAgIHJlY292ZXJ5V29ya2Zsb3dFeGVjdXRpb25zOiB7XG4gICAgICAgIFt3b3JrZmxvd0lkXTogW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIGlkOiBcImUyZS1vdXRhZ2UtZXhlY3V0aW9uXCIsXG4gICAgICAgICAgICB3b3JrZmxvd0lkLFxuICAgICAgICAgICAgc3RhdHVzOiBcImZhaWxlZFwiLFxuICAgICAgICAgICAgY3VycmVudFBoYXNlOiBcInRlc3RcIixcbiAgICAgICAgICAgIGNvbXBsZXRlZFBoYXNlczogW1wiYnVpbGRcIl0sXG4gICAgICAgICAgICBzdGFydGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMDowMC4wMDBaXCIsXG4gICAgICAgICAgICBlcnJvck1lc3NhZ2U6IHJhd0RpYWdub3N0aWMsXG4gICAgICAgICAgICByZWNvdmVyeToge1xuICAgICAgICAgICAgICBhdmFpbGFiaWxpdHlTdGF0ZTogXCJwcm92aWRlcl9vdXRhZ2VcIixcbiAgICAgICAgICAgICAgY29ycmVsYXRpb25JZDogc3VwcG9ydFJlZmVyZW5jZXMucHJvdmlkZXJfb3V0YWdlLFxuICAgICAgICAgICAgICBvcGVyYXRvckFjdGlvbjpcbiAgICAgICAgICAgICAgICBcIlJldHJ5IGluIGEgbW9tZW50OyBjb25maWd1cmUgYW5vdGhlciBwcm92aWRlciBpZiB0aGUgaXNzdWUgcGVyc2lzdHMuXCIsXG4gICAgICAgICAgICAgIGRpYWdub3N0aWM6IHJhd0NyZWRlbnRpYWwsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgIF0sXG4gICAgICB9LFxuICAgIH0pO1xuICAgIGF3YWl0IHByb2dyYW1tYXRpY1NpZ25JbihwYWdlKTtcblxuICAgIGF3YWl0IG9wZW5OYXZpZ2F0aW9uKHBhZ2UsIFwiVGFza3NcIiwgYCR7REFTSEJPQVJEX1BBVEh9dGFza3NgKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5TGFiZWwoXCJFeHBhbmQgdGFzayBSZWNvdmVyIGF1dGhlbnRpY2F0aW9uIGZhaWx1cmVcIiksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IHBhZ2VcbiAgICAgIC5nZXRCeUxhYmVsKFwiRXhwYW5kIHRhc2sgUmVjb3ZlciBhdXRoZW50aWNhdGlvbiBmYWlsdXJlXCIpXG4gICAgICAuY2xpY2soKTtcbiAgICBjb25zdCB0YXNrRGV0YWlscyA9IHBhZ2UubG9jYXRvcihcIiN0YXNrLWRldGFpbHMtZTJlLWF1dGgtZmFpbGVkLXRhc2tcIik7XG4gICAgYXdhaXQgZXhwZWN0KHRhc2tEZXRhaWxzKS50b0NvbnRhaW5UZXh0KFwiUHJvdmlkZXIgYXV0aGVudGljYXRpb24gZmFpbGVkXCIpO1xuICAgIGF3YWl0IGV4cGVjdCh0YXNrRGV0YWlscykudG9Db250YWluVGV4dChcbiAgICAgIFwiUmVwbGFjZSB0aGUgcHJvdmlkZXIgQVBJIGtleSB3aXRoIGEgdmFsaWQga2V5LCB0aGVuIHJldHJ5LlwiLFxuICAgICk7XG4gICAgYXdhaXQgZXhwZWN0KHRhc2tEZXRhaWxzKS50b0NvbnRhaW5UZXh0KFxuICAgICAgYFN1cHBvcnQgcmVmZXJlbmNlOiAke3N1cHBvcnRSZWZlcmVuY2VzLmF1dGhlbnRpY2F0aW9uX2ZhaWxlZH1gLFxuICAgICk7XG4gICAgYXdhaXQgcGFnZS5nZXRCeUxhYmVsKFwiRXhwYW5kIHRhc2sgUmVjb3ZlciBxdW90YSBleGhhdXN0aW9uXCIpLmNsaWNrKCk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlUZXh0KFwiUHJvdmlkZXIgcXVvdGEgaXMgZXhoYXVzdGVkXCIpKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KGBTdXBwb3J0IHJlZmVyZW5jZTogJHtzdXBwb3J0UmVmZXJlbmNlcy5xdW90YV9leGhhdXN0ZWR9YCksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IHBhZ2UucmVsb2FkKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeUxhYmVsKFwiRXhwYW5kIHRhc2sgUmVjb3ZlciBhdXRoZW50aWNhdGlvbiBmYWlsdXJlXCIpLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBwYWdlXG4gICAgICAuZ2V0QnlMYWJlbChcIkV4cGFuZCB0YXNrIFJlY292ZXIgYXV0aGVudGljYXRpb24gZmFpbHVyZVwiKVxuICAgICAgLmNsaWNrKCk7XG4gICAgY29uc3QgcmVsb2FkZWRBdXRoRGV0YWlscyA9IHBhZ2UubG9jYXRvcihcbiAgICAgIFwiI3Rhc2stZGV0YWlscy1lMmUtYXV0aC1mYWlsZWQtdGFza1wiLFxuICAgICk7XG4gICAgYXdhaXQgZXhwZWN0KHJlbG9hZGVkQXV0aERldGFpbHMpLnRvQ29udGFpblRleHQoXG4gICAgICBcIlByb3ZpZGVyIGF1dGhlbnRpY2F0aW9uIGZhaWxlZFwiLFxuICAgICk7XG4gICAgYXdhaXQgZXhwZWN0KHJlbG9hZGVkQXV0aERldGFpbHMpLnRvQ29udGFpblRleHQoXG4gICAgICBcIlJlcGxhY2UgdGhlIHByb3ZpZGVyIEFQSSBrZXkgd2l0aCBhIHZhbGlkIGtleSwgdGhlbiByZXRyeS5cIixcbiAgICApO1xuICAgIGF3YWl0IGV4cGVjdChyZWxvYWRlZEF1dGhEZXRhaWxzKS50b0NvbnRhaW5UZXh0KFxuICAgICAgYFN1cHBvcnQgcmVmZXJlbmNlOiAke3N1cHBvcnRSZWZlcmVuY2VzLmF1dGhlbnRpY2F0aW9uX2ZhaWxlZH1gLFxuICAgICk7XG4gICAgYXdhaXQgcGFnZS5nZXRCeUxhYmVsKFwiRXhwYW5kIHRhc2sgUmVjb3ZlciBxdW90YSBleGhhdXN0aW9uXCIpLmNsaWNrKCk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlUZXh0KFwiUHJvdmlkZXIgcXVvdGEgaXMgZXhoYXVzdGVkXCIpKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KGBTdXBwb3J0IHJlZmVyZW5jZTogJHtzdXBwb3J0UmVmZXJlbmNlcy5xdW90YV9leGhhdXN0ZWR9YCksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGNvbnN0IHJlbG9hZGVkVGFza1RleHQgPSBhd2FpdCBwYWdlLmxvY2F0b3IoXCJib2R5XCIpLmlubmVyVGV4dCgpO1xuICAgIGV4cGVjdChyZWxvYWRlZFRhc2tUZXh0KS5ub3QudG9Db250YWluKHJhd0RpYWdub3N0aWMpO1xuICAgIGV4cGVjdChyZWxvYWRlZFRhc2tUZXh0KS5ub3QudG9Db250YWluKHJhd0NyZWRlbnRpYWwpO1xuICAgIGV4cGVjdChyZWxvYWRlZFRhc2tUZXh0KS5ub3QudG9NYXRjaChcbiAgICAgIC9zZWNyZXQtbW9kZWwtbmFtZXxcXC9ob21lXFwvcnVubmVyfFxcL3RtcFxcLy9pLFxuICAgICk7XG5cbiAgICBhd2FpdCBvcGVuTmF2aWdhdGlvbihwYWdlLCBcIldvcmtmbG93c1wiLCBgJHtEQVNIQk9BUkRfUEFUSH13b3JrZmxvd3NgKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5nZXRCeVRleHQoXCJSZWNvdmVyIHByb3ZpZGVyIG91dGFnZVwiKSkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBwYWdlLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiRXhlY3V0aW9uIGhpc3RvcnlcIiB9KS5jbGljaygpO1xuICAgIGNvbnN0IGV4ZWN1dGlvbiA9IHBhZ2VcbiAgICAgIC5nZXRCeVRleHQoXCJmYWlsZWQgwrcgbm8gc3VjY2Vzc2Z1bCBjb21wbGV0aW9uXCIpXG4gICAgICAubG9jYXRvcihcIi4uXCIpXG4gICAgICAubG9jYXRvcihcIi4uXCIpO1xuICAgIGF3YWl0IGV4cGVjdChleGVjdXRpb24pLnRvQ29udGFpblRleHQoXG4gICAgICBcIlRoZSBwcm92aWRlciBpcyB0ZW1wb3JhcmlseSB1bmF2YWlsYWJsZVwiLFxuICAgICk7XG4gICAgYXdhaXQgZXhwZWN0KGV4ZWN1dGlvbikudG9Db250YWluVGV4dChcbiAgICAgIFwiUmV0cnkgaW4gYSBtb21lbnQ7IGNvbmZpZ3VyZSBhbm90aGVyIHByb3ZpZGVyIGlmIHRoZSBpc3N1ZSBwZXJzaXN0cy5cIixcbiAgICApO1xuICAgIGF3YWl0IGV4cGVjdChleGVjdXRpb24pLnRvQ29udGFpblRleHQoXG4gICAgICBgU3VwcG9ydCByZWZlcmVuY2U6ICR7c3VwcG9ydFJlZmVyZW5jZXMucHJvdmlkZXJfb3V0YWdlfWAsXG4gICAgKTtcbiAgICBhd2FpdCBwYWdlLnJlbG9hZCgpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlLmdldEJ5VGV4dChcIlJlY292ZXIgcHJvdmlkZXIgb3V0YWdlXCIpKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJFeGVjdXRpb24gaGlzdG9yeVwiIH0pLmNsaWNrKCk7XG4gICAgY29uc3QgcmVsb2FkZWRFeGVjdXRpb24gPSBwYWdlXG4gICAgICAuZ2V0QnlUZXh0KFwiZmFpbGVkIMK3IG5vIHN1Y2Nlc3NmdWwgY29tcGxldGlvblwiKVxuICAgICAgLmxvY2F0b3IoXCIuLlwiKVxuICAgICAgLmxvY2F0b3IoXCIuLlwiKTtcbiAgICBhd2FpdCBleHBlY3QocmVsb2FkZWRFeGVjdXRpb24pLnRvQ29udGFpblRleHQoXG4gICAgICBcIlRoZSBwcm92aWRlciBpcyB0ZW1wb3JhcmlseSB1bmF2YWlsYWJsZVwiLFxuICAgICk7XG4gICAgYXdhaXQgZXhwZWN0KHJlbG9hZGVkRXhlY3V0aW9uKS50b0NvbnRhaW5UZXh0KFxuICAgICAgXCJSZXRyeSBpbiBhIG1vbWVudDsgY29uZmlndXJlIGFub3RoZXIgcHJvdmlkZXIgaWYgdGhlIGlzc3VlIHBlcnNpc3RzLlwiLFxuICAgICk7XG4gICAgYXdhaXQgZXhwZWN0KHJlbG9hZGVkRXhlY3V0aW9uKS50b0NvbnRhaW5UZXh0KFxuICAgICAgYFN1cHBvcnQgcmVmZXJlbmNlOiAke3N1cHBvcnRSZWZlcmVuY2VzLnByb3ZpZGVyX291dGFnZX1gLFxuICAgICk7XG5cbiAgICBjb25zdCB2aXNpYmxlVGV4dCA9IGF3YWl0IHBhZ2UubG9jYXRvcihcImJvZHlcIikuaW5uZXJUZXh0KCk7XG4gICAgZXhwZWN0KHZpc2libGVUZXh0KS5ub3QudG9Db250YWluKHJhd0RpYWdub3N0aWMpO1xuICAgIGV4cGVjdCh2aXNpYmxlVGV4dCkubm90LnRvQ29udGFpbihyYXdDcmVkZW50aWFsKTtcbiAgICBleHBlY3QodmlzaWJsZVRleHQpLm5vdC50b01hdGNoKFxuICAgICAgL3NlY3JldC1tb2RlbC1uYW1lfFxcL2hvbWVcXC9ydW5uZXJ8XFwvdG1wXFwvL2ksXG4gICAgKTtcbiAgICBhd2FpdCBleHBlY3ROb0hvcml6b250YWxPdmVyZmxvdyhwYWdlKTtcbiAgfSk7XG5cbiAgdGVzdChcImNvbnZlcmdlcyB0d28gYnJvd3NlciBzZXNzaW9ucyBhY3Jvc3MgcmVsb2FkLCByZWNvbm5lY3QsIHN0YWxlIHJlc3VsdHMsIGFuZCBBUEkgcmVzdGFydFwiLCBhc3luYyAoe1xuICAgIGJyb3dzZXIsXG4gICAgcGFnZSxcbiAgfSkgPT4ge1xuICAgIHRlc3Quc2tpcChcbiAgICAgICFwcm9jZXNzLmVudi5EQVNIQk9BUkRfRTJFX0NPTlRST0xfVVJMLFxuICAgICAgXCJUaGUgbXVsdGktcHJvY2VzcyBjb252ZXJnZW5jZSBjYW1wYWlnbiBydW5zIG9ubHkgdW5kZXIgdGhlIHJlbGVhc2UgcnVubmVyLlwiLFxuICAgICk7XG4gICAgdGVzdC5zZXRUaW1lb3V0KDkwXzAwMCk7XG5cbiAgICBjb25zdCBzZWNvbmRDb250ZXh0ID0gYXdhaXQgYnJvd3Nlci5uZXdDb250ZXh0KCk7XG4gICAgY29uc3Qgc2Vjb25kUGFnZSA9IGF3YWl0IHNlY29uZENvbnRleHQubmV3UGFnZSgpO1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCBQcm9taXNlLmFsbChbcHJvZ3JhbW1hdGljU2lnbkluKHBhZ2UpLCBwcm9ncmFtbWF0aWNTaWduSW4oc2Vjb25kUGFnZSldKTtcbiAgICAgIGF3YWl0IFByb21pc2UuYWxsKFtcbiAgICAgICAgcGFnZS5nb3RvKERBU0hCT0FSRF9QQVRIKSxcbiAgICAgICAgc2Vjb25kUGFnZS5nb3RvKGAke0RBU0hCT0FSRF9QQVRIfWFpYCksXG4gICAgICBdKTtcbiAgICAgIGF3YWl0IGV4cGVjdERhc2hib2FyZFJlYWR5KHBhZ2UpO1xuICAgICAgYXdhaXQgZXhwZWN0KHNlY29uZFBhZ2UubG9jYXRvcihcInRleHRhcmVhXCIpLmZpcnN0KCkpLnRvQmVWaXNpYmxlKCk7XG5cbiAgICAgIC8vIEEgcmVzcG9uc2UgdGhhdCBhcnJpdmVzIGFmdGVyIGEgbmV3ZXIgcmVxdWVzdCBtdXN0IG5vdCByZXBsYWNlIHRoZVxuICAgICAgLy8gdmlzaWJsZSByZWFkeSBzdGF0ZSB3aXRoIHN0YWxlIGRhdGEuIEtlZXAgdGhlIGRlbGF5IGJvdW5kZWQgc28gYVxuICAgICAgLy8gaHVuZyByZXF1ZXN0IGNhbm5vdCBtYWtlIHRoaXMgY2FtcGFpZ24gcGFzcyBpbmRlZmluaXRlbHkuXG4gICAgICBjb25zdCBjdXJyZW50RGFzaGJvYXJkRml4dHVyZSA9IHtcbiAgICAgICAgLi4uZGFzaGJvYXJkRml4dHVyZSxcbiAgICAgICAgZnJlc2huZXNzUmV2aXNpb246IFwiMjAyNi0wMS0wMVQwMDowMzowMC4wMDBaXCIsXG4gICAgICAgIHByb2plY3RTY29yZXM6IFt7IC4uLmRhc2hib2FyZEZpeHR1cmUucHJvamVjdFNjb3Jlc1swXSwgcHJvamVjdE5hbWU6IFwiQ29uY3VycmVudCBQcm9qZWN0XCIsIHNjb3JlOiA5NyB9XSxcbiAgICAgICAgYWN0aXZlVGFza0NvdW50OiAxLFxuICAgICAgICB0YXNrU3RhdHVzQnJlYWtkb3duOiB7IHBlbmRpbmc6IDAsIHJ1bm5pbmc6IDEgfSxcbiAgICAgIH07XG4gICAgICBsZXQgcmVmcmVzaENvdW50ID0gMDtcbiAgICAgIGxldCByZWxlYXNlU3RhbGVSZXNwb25zZSE6ICgpID0+IHZvaWQ7XG4gICAgICBjb25zdCBzdGFsZVJlc3BvbnNlUmVsZWFzZWQgPSBuZXcgUHJvbWlzZTx2b2lkPigocmVzb2x2ZSkgPT4ge1xuICAgICAgICByZWxlYXNlU3RhbGVSZXNwb25zZSA9IHJlc29sdmU7XG4gICAgICB9KTtcbiAgICAgIGF3YWl0IHBhZ2Uucm91dGUoXCIqKi9hcGkvZGFzaGJvYXJkXCIsIGFzeW5jIChyb3V0ZSkgPT4ge1xuICAgICAgICByZWZyZXNoQ291bnQgKz0gMTtcbiAgICAgICAgaWYgKHJlZnJlc2hDb3VudCA9PT0gMSkgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoanNvblJlc3BvbnNlKGN1cnJlbnREYXNoYm9hcmRGaXh0dXJlKSk7XG4gICAgICAgIGF3YWl0IHN0YWxlUmVzcG9uc2VSZWxlYXNlZDtcbiAgICAgICAgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoanNvblJlc3BvbnNlKGRhc2hib2FyZEZpeHR1cmUpKTtcbiAgICAgIH0pO1xuICAgICAgYXdhaXQgcGFnZS5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIlJlZnJlc2ggc3RhdHVzXCIgfSkuY2xpY2soKTtcbiAgICAgIGF3YWl0IGV4cGVjdChwYWdlLmdldEJ5VGV4dChcIkNvbmN1cnJlbnQgUHJvamVjdFwiLCB7IGV4YWN0OiB0cnVlIH0pKS50b0JlVmlzaWJsZSgpO1xuICAgICAgYXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlUZXh0KFwiOTdcIiwgeyBleGFjdDogdHJ1ZSB9KSkudG9CZVZpc2libGUoKTtcbiAgICAgIGNvbnN0IHN0YWxlUmVmcmVzaCA9IHBhZ2UuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJSZWZyZXNoIHN0YXR1c1wiIH0pLmNsaWNrKCk7XG4gICAgICBhd2FpdCBleHBlY3QucG9sbCgoKSA9PiByZWZyZXNoQ291bnQpLnRvQmUoMik7XG4gICAgICByZWxlYXNlU3RhbGVSZXNwb25zZSgpO1xuICAgICAgYXdhaXQgc3RhbGVSZWZyZXNoO1xuICAgICAgYXdhaXQgZXhwZWN0RGFzaGJvYXJkUmVhZHkocGFnZSk7XG4gICAgICBhd2FpdCBleHBlY3QocGFnZS5nZXRCeVRleHQoXCJDb25jdXJyZW50IFByb2plY3RcIiwgeyBleGFjdDogdHJ1ZSB9KSkudG9CZVZpc2libGUoKTtcbiAgICAgIGF3YWl0IGV4cGVjdChwYWdlLmdldEJ5VGV4dChcIjk3XCIsIHsgZXhhY3Q6IHRydWUgfSkpLnRvQmVWaXNpYmxlKCk7XG4gICAgICBhd2FpdCBleHBlY3QocGFnZS5nZXRCeVRleHQoXCIxXCIsIHsgZXhhY3Q6IHRydWUgfSkuZmlyc3QoKSkudG9CZVZpc2libGUoKTtcblxuICAgICAgLy8gU2ltdWxhdGUgYSBkcm9wcGVkIGNvbm5lY3Rpb24gaW4gdGhlIHNlY29uZCBicm93c2VyIGFuZCBhc3NlcnQgdGhlXG4gICAgICAvLyByZWNvdmVyeSBhY3Rpb24gcmVuZGVyZWQgYnkgdGhlIGRhc2hib2FyZCwgdGhlbiBsZXQgdGhlIG5leHQgcmVxdWVzdFxuICAgICAgLy8gcmVjb25uZWN0IG5vcm1hbGx5LlxuICAgICAgbGV0IHJlY29ubmVjdEF0dGVtcHQgPSAwO1xuICAgICAgYXdhaXQgc2Vjb25kUGFnZS5nb3RvKERBU0hCT0FSRF9QQVRIKTtcbiAgICAgIGF3YWl0IGV4cGVjdERhc2hib2FyZFJlYWR5KHNlY29uZFBhZ2UpO1xuICAgICAgYXdhaXQgc2Vjb25kUGFnZS5yb3V0ZShcIioqL2FwaS9kYXNoYm9hcmRcIiwgYXN5bmMgKHJvdXRlKSA9PiB7XG4gICAgICAgIHJlY29ubmVjdEF0dGVtcHQgKz0gMTtcbiAgICAgICAgLy8gdXNlR2V0RGFzaGJvYXJkIHJldHJpZXMgb25jZTsgaG9sZCBib3RoIGJvdW5kZWQgYXR0ZW1wdHMgc28gdGhlXG4gICAgICAgIC8vIHJlbmRlcmVkIGVycm9yIHN0YXRlIGlzIG9ic2VydmFibGUgYmVmb3JlIHRoZSBvcGVyYXRvciByZXRyaWVzLlxuICAgICAgICBpZiAocmVjb25uZWN0QXR0ZW1wdCA8PSAyKSB7XG4gICAgICAgICAgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoXG4gICAgICAgICAgICBqc29uUmVzcG9uc2UoeyBlcnJvcjogXCJjb250cm9sbGVkIHJlY29ubmVjdCBpbnRlcnJ1cHRpb25cIiB9LCA1MDMpLFxuICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHJvdXRlLmNvbnRpbnVlKCk7XG4gICAgICB9KTtcbiAgICAgIGF3YWl0IHNlY29uZFBhZ2UucmVsb2FkKCk7XG4gICAgICBhd2FpdCBleHBlY3QoXG4gICAgICAgIHNlY29uZFBhZ2UuZ2V0QnlSb2xlKFwiaGVhZGluZ1wiLCB7IG5hbWU6IFwiRmFpbGVkIHRvIGxvYWQgZGFzaGJvYXJkXCIgfSksXG4gICAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgICBhd2FpdCBleHBlY3QoXG4gICAgICAgIHNlY29uZFBhZ2UuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJSZXRyeSBDb25uZWN0aW9uXCIgfSksXG4gICAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgICBhd2FpdCBzZWNvbmRQYWdlLnVucm91dGUoXCIqKi9hcGkvZGFzaGJvYXJkXCIpO1xuICAgICAgYXdhaXQgc2Vjb25kUGFnZS5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIlJldHJ5IENvbm5lY3Rpb25cIiB9KS5jbGljaygpO1xuICAgICAgYXdhaXQgZXhwZWN0RGFzaGJvYXJkUmVhZHkoc2Vjb25kUGFnZSk7XG5cbiAgICAgIGF3YWl0IHJlc3RhcnRBcGlGb3JDYW1wYWlnbihwYWdlKTtcbiAgICAgIGF3YWl0IFByb21pc2UuYWxsKFtwYWdlLnJlbG9hZCgpLCBzZWNvbmRQYWdlLnJlbG9hZCgpXSk7XG4gICAgICBhd2FpdCBleHBlY3REYXNoYm9hcmRSZWFkeShwYWdlKTtcbiAgICAgIGF3YWl0IGV4cGVjdERhc2hib2FyZFJlYWR5KHNlY29uZFBhZ2UpO1xuXG4gICAgICBhd2FpdCBwYWdlLnJlbG9hZCgpO1xuICAgICAgYXdhaXQgZXhwZWN0RGFzaGJvYXJkUmVhZHkocGFnZSk7XG4gICAgICBhd2FpdCBleHBlY3QoXG4gICAgICAgIHBhZ2UuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJSZXRyeSBDb25uZWN0aW9uXCIgfSksXG4gICAgICApLnRvSGF2ZUNvdW50KDApO1xuICAgICAgYXdhaXQgZXhwZWN0Tm9Ib3Jpem9udGFsT3ZlcmZsb3cocGFnZSk7XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGF3YWl0IHNlY29uZENvbnRleHQuY2xvc2UoKTtcbiAgICB9XG4gIH0pO1xuXG4gIHRlc3QoXCJwcmV2aWV3cyBhbmQgZG93bmxvYWRzIHRoZSBjb21wbGV0ZWQgZXhlY3V0aW9uIGF1ZGl0IHdpdGhvdXQgZHVwbGljYXRpbmcgZWZmZWN0c1wiLCBhc3luYyAoe1xuICAgIHBhZ2UsXG4gIH0pID0+IHtcbiAgICBjb25zdCBhdWRpdFJlcXVlc3RzOiBzdHJpbmdbXSA9IFtdO1xuICAgIGNvbnN0IGF1ZGl0Qm9keSA9IHtcbiAgICAgIGZvcm1hdDogXCJlbmdpbmVlcmluZ29zLmV4ZWN1dGlvbi1hdWRpdC52MVwiLFxuICAgICAgZXhwb3J0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAyOjAwLjAwMFpcIixcbiAgICAgIGV4ZWN1dGlvbjoge1xuICAgICAgICBpZDogRVhFQ1VUSU9OX0lELFxuICAgICAgICBwcm9qZWN0SWQ6IFwiZTJlLXByb2plY3RcIixcbiAgICAgICAgc2Vzc2lvbklkOiBcImUyZS1hdWRpdC1zZXNzaW9uXCIsXG4gICAgICAgIG9wZXJhdGlvbklkOiBleGVjdXRpb25GaXh0dXJlLm9wZXJhdGlvbklkLFxuICAgICAgICBzdGF0dXM6IFwiY29tcGxldGVkXCIsXG4gICAgICAgIHRlcm1pbmFsU3RhdGU6IFwiY29tcGxldGVkXCIsXG4gICAgICAgIHJldmlzaW9uOiBcImUyZS1yZXZpc2lvbi00MlwiLFxuICAgICAgICBwcm9vZjogeyByZXF1aXJlZDogZmFsc2UsIHZlcmRpY3Q6IFwiUFJPVkVOXCIgfSxcbiAgICAgIH0sXG4gICAgICB0aW1lbGluZTogW10sXG4gICAgICB2YWxpZGF0aW9uczogW3sgc3RhdHVzOiBcInBhc3NlZFwiLCBwcm9maWxlOiBcInJlbGVhc2Utc2FmZVwiIH1dLFxuICAgICAgYWZmZWN0ZWRGaWxlczogW1wic3JjL2ZlYXR1cmUudHNcIl0sXG4gICAgICByZWRhY3Rpb246IHtcbiAgICAgICAgZXhjbHVkZWQ6IFtcbiAgICAgICAgICBcInByb3ZpZGVyIHNlY3JldHNcIixcbiAgICAgICAgICBcInJhdyBtb2RlbCBvdXRwdXRcIixcbiAgICAgICAgICBcInByaXZhdGUgcnVudGltZSBwYXRoc1wiLFxuICAgICAgICBdLFxuICAgICAgfSxcbiAgICB9O1xuICAgIGF3YWl0IGluc3RhbGxBcGlGaXh0dXJlcyhwYWdlLCB7XG4gICAgICBhdWRpdEV4cG9ydDoge1xuICAgICAgICBib2R5OiBhdWRpdEJvZHksXG4gICAgICAgIGZpbGVuYW1lOiBcInNlcnZlci1zdXBwbGllZC1hdWRpdC1uYW1lLmpzb25cIixcbiAgICAgICAgcmVxdWVzdHM6IGF1ZGl0UmVxdWVzdHMsXG4gICAgICAgIGZhaWxGaXJzdFByZXZpZXc6IHRydWUsXG4gICAgICB9LFxuICAgIH0pO1xuICAgIGF3YWl0IHByb2dyYW1tYXRpY1NpZ25JbihwYWdlKTtcbiAgICBhd2FpdCBwYWdlLmV2YWx1YXRlKCgpID0+IHtcbiAgICAgIGNvbnN0IGV4ZWN1dGlvbiA9IHtcbiAgICAgICAgaWQ6IFwiZTJlLWNvbnRyb2xsZWQtZXhlY3V0aW9uXCIsXG4gICAgICAgIHByb2plY3RJZDogXCJlMmUtcHJvamVjdFwiLFxuICAgICAgICBzZXNzaW9uSWQ6IFwiZTJlLWF1ZGl0LXNlc3Npb25cIixcbiAgICAgICAgbWVzc2FnZTogXCJDb21wbGV0ZWQgYXVkaXQgZXhlY3V0aW9uXCIsXG4gICAgICB9O1xuICAgICAgbG9jYWxTdG9yYWdlLnNldEl0ZW0oXG4gICAgICAgIFwiZW9zX2FpX2V4ZWN1dGlvbl9jdXJyZW50X2UyZS1wcm9qZWN0XCIsXG4gICAgICAgIFwiZTJlLWF1ZGl0LXNlc3Npb25cIixcbiAgICAgICk7XG4gICAgICBsb2NhbFN0b3JhZ2Uuc2V0SXRlbShcbiAgICAgICAgXCJlb3NfYWlfZXhlY3V0aW9uX2UyZS1wcm9qZWN0X2UyZS1hdWRpdC1zZXNzaW9uXCIsXG4gICAgICAgIEpTT04uc3RyaW5naWZ5KGV4ZWN1dGlvbiksXG4gICAgICApO1xuICAgIH0pO1xuICAgIGF3YWl0IHBhZ2UuZ290byhgJHtEQVNIQk9BUkRfUEFUSH1haWApO1xuXG4gICAgY29uc3QgcHJvb2YgPSBwYWdlLmdldEJ5TGFiZWwoXCJBZ2VudCBleGVjdXRpb24gcHJvb2ZcIik7XG4gICAgYXdhaXQgZXhwZWN0KHByb29mKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChwcm9vZikudG9Db250YWluVGV4dCgvY29tcGxldGVkL2kpO1xuICAgIGF3YWl0IGV4cGVjdChwcm9vZikudG9Db250YWluVGV4dChcIlJldmlzaW9uOiBlMmUtcmV2aXNpb24tNDJcIik7XG5cbiAgICBhd2FpdCBwcm9vZi5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIlByZXZpZXcgYXVkaXRcIiB9KS5jbGljaygpO1xuICAgIGNvbnN0IHByZXZpZXcgPSBwYWdlLmdldEJ5TGFiZWwoXCJSZWRhY3RlZCBhdWRpdCBwcmV2aWV3XCIpO1xuICAgIGF3YWl0IGV4cGVjdChwcmV2aWV3KS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChwcmV2aWV3KS50b0NvbnRhaW5UZXh0KFwiQXVkaXQgcHJldmlldyB0ZW1wb3JhcmlseSB1bmF2YWlsYWJsZVwiKTtcbiAgICBhd2FpdCBleHBlY3QocHJldmlldykudG9Db250YWluVGV4dChcInNhbWUgZXhlY3V0aW9uIGFuZCByZXZpc2lvblwiKTtcbiAgICBhd2FpdCBleHBlY3QocHJldmlldy5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIlJldHJ5IHByZXZpZXdcIiB9KSkudG9CZVZpc2libGUoKTtcbiAgICBleHBlY3QoYXVkaXRSZXF1ZXN0cykudG9IYXZlTGVuZ3RoKDEpO1xuXG4gICAgYXdhaXQgcHJldmlldy5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIlJldHJ5IHByZXZpZXdcIiB9KS5jbGljaygpO1xuICAgIGF3YWl0IGV4cGVjdChwcmV2aWV3KS50b0NvbnRhaW5UZXh0KFwicHJvdmlkZXIgc2VjcmV0c1wiKTtcbiAgICBhd2FpdCBleHBlY3QocHJldmlldykudG9Db250YWluVGV4dChcInJhdyBtb2RlbCBvdXRwdXRcIik7XG4gICAgYXdhaXQgZXhwZWN0KHByZXZpZXcpLnRvQ29udGFpblRleHQoXCJwcml2YXRlIHJ1bnRpbWUgcGF0aHNcIik7XG4gICAgYXdhaXQgZXhwZWN0KHByZXZpZXcpLnRvQ29udGFpblRleHQoRVhFQ1VUSU9OX0lEKTtcbiAgICBhd2FpdCBleHBlY3QocHJldmlldykudG9Db250YWluVGV4dChcImUyZS1vcGVyYXRpb25cIik7XG4gICAgYXdhaXQgZXhwZWN0KHByZXZpZXcpLnRvQ29udGFpblRleHQoXCJlMmUtcmV2aXNpb24tNDJcIik7XG4gICAgZXhwZWN0KGF1ZGl0UmVxdWVzdHMpLnRvSGF2ZUxlbmd0aCgyKTtcbiAgICBleHBlY3QobmV3IFVSTChhdWRpdFJlcXVlc3RzWzBdKS5wYXRobmFtZSkudG9CZShcbiAgICAgIGAvYXBpL2FpL2V4ZWN1dGlvbnMvJHtFWEVDVVRJT05fSUR9L2F1ZGl0LWV4cG9ydGAsXG4gICAgKTtcblxuICAgIGF3YWl0IHByZXZpZXcuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJDbG9zZSBhdWRpdCBwcmV2aWV3XCIgfSkuY2xpY2soKTtcbiAgICBhd2FpdCBleHBlY3QocHJldmlldykudG9CZUhpZGRlbigpO1xuXG4gICAgY29uc3QgZG93bmxvYWRQcm9taXNlID0gcGFnZS53YWl0Rm9yRXZlbnQoXCJkb3dubG9hZFwiKTtcbiAgICBhd2FpdCBwcm9vZi5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIkV4cG9ydCBhdWRpdFwiIH0pLmNsaWNrKCk7XG4gICAgY29uc3QgZG93bmxvYWQgPSBhd2FpdCBkb3dubG9hZFByb21pc2U7XG4gICAgZXhwZWN0KGRvd25sb2FkLnN1Z2dlc3RlZEZpbGVuYW1lKCkpLnRvQmUoXCJzZXJ2ZXItc3VwcGxpZWQtYXVkaXQtbmFtZS5qc29uXCIpO1xuICAgIGV4cGVjdChhdWRpdFJlcXVlc3RzKS50b0hhdmVMZW5ndGgoMyk7XG5cbiAgICBhd2FpdCBwYWdlLnJlbG9hZCgpO1xuICAgIGNvbnN0IHJlbG9hZGVkUHJvb2YgPSBwYWdlLmdldEJ5TGFiZWwoXCJBZ2VudCBleGVjdXRpb24gcHJvb2ZcIik7XG4gICAgYXdhaXQgZXhwZWN0KHJlbG9hZGVkUHJvb2YpLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KHJlbG9hZGVkUHJvb2YpLnRvQ29udGFpblRleHQoL2NvbXBsZXRlZC9pKTtcbiAgICBhd2FpdCBleHBlY3QocmVsb2FkZWRQcm9vZikudG9Db250YWluVGV4dChcIkV4ZWN1dGlvbiBlMmUtY29udHJvbGxlZC1leGVjdXRpb25cIik7XG4gICAgYXdhaXQgZXhwZWN0KHJlbG9hZGVkUHJvb2YpLnRvQ29udGFpblRleHQoXCJSZXZpc2lvbjogZTJlLXJldmlzaW9uLTQyXCIpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlMYWJlbChcIlJlZGFjdGVkIGF1ZGl0IHByZXZpZXdcIiksXG4gICAgKS50b0JlSGlkZGVuKCk7XG4gICAgZXhwZWN0KGF1ZGl0UmVxdWVzdHMpLnRvSGF2ZUxlbmd0aCgzKTtcbiAgfSk7XG5cbiAgdGVzdChcImtlZXBzIHRoZSBjYW5jZWxsZWQgZXhlY3V0aW9uIGF1ZGl0IGhhbmRvZmYgcmVkYWN0ZWQgYW5kIHRlcm1pbmFsXCIsIGFzeW5jICh7XG4gICAgcGFnZSxcbiAgfSkgPT4ge1xuICAgIGNvbnN0IGF1ZGl0UmVxdWVzdHM6IHN0cmluZ1tdID0gW107XG4gICAgY29uc3QgY2FuY2VsbGVkRXhlY3V0aW9uID0ge1xuICAgICAgLi4uZXhlY3V0aW9uRml4dHVyZSxcbiAgICAgIHN0YXR1czogXCJjYW5jZWxsZWRcIixcbiAgICAgIGZsaWdodFN0YXRlOiBcIkNBTkNFTExFRFwiLFxuICAgICAgY2hlY2twb2ludDoge1xuICAgICAgICBzdGFnZTogXCJjYW5jZWxsZWRcIixcbiAgICAgICAgZGV0YWlsOiBcIkV4ZWN1dGlvbiBjYW5jZWxsZWQgYmVmb3JlIGFueSBjaGFuZ2VzIHdlcmUgYXBwbGllZC5cIixcbiAgICAgIH0sXG4gICAgICB0ZXJtaW5hbFJlYXNvbjogXCJjYW5jZWxfcmVxdWVzdGVkXCIsXG4gICAgICBjb21wbGV0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAxOjMwLjAwMFpcIixcbiAgICAgIHVwZGF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAxOjMwLjAwMFpcIixcbiAgICB9O1xuICAgIGNvbnN0IGF1ZGl0Qm9keSA9IHtcbiAgICAgIGZvcm1hdDogXCJlbmdpbmVlcmluZ29zLmV4ZWN1dGlvbi1hdWRpdC52MVwiLFxuICAgICAgZXhwb3J0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAyOjAwLjAwMFpcIixcbiAgICAgIGV4ZWN1dGlvbjoge1xuICAgICAgICBpZDogRVhFQ1VUSU9OX0lELFxuICAgICAgICBwcm9qZWN0SWQ6IFwiZTJlLXByb2plY3RcIixcbiAgICAgICAgc2Vzc2lvbklkOiBcImUyZS1hdWRpdC1zZXNzaW9uXCIsXG4gICAgICAgIG9wZXJhdGlvbklkOiBleGVjdXRpb25GaXh0dXJlLm9wZXJhdGlvbklkLFxuICAgICAgICBzdGF0dXM6IFwiY2FuY2VsbGVkXCIsXG4gICAgICAgIHRlcm1pbmFsU3RhdGU6IFwiY2FuY2VsbGVkXCIsXG4gICAgICAgIHJldmlzaW9uOiBcImUyZS1yZXZpc2lvbi00MlwiLFxuICAgICAgICBwcm9vZjogeyByZXF1aXJlZDogZmFsc2UsIHZlcmRpY3Q6IFwiTk9UX1JFQ09SREVEXCIgfSxcbiAgICAgIH0sXG4gICAgICB0aW1lbGluZTogW1xuICAgICAgICB7IHR5cGU6IFwiY2FuY2VsbGVkXCIsIGRldGFpbDogXCJDYW5jZWxsYXRpb24gYWNjZXB0ZWQgYnkgdGhlIHNlcnZlci5cIiB9LFxuICAgICAgXSxcbiAgICAgIHZhbGlkYXRpb25zOiBbXSxcbiAgICAgIGFmZmVjdGVkRmlsZXM6IFtdLFxuICAgICAgcmVkYWN0aW9uOiB7XG4gICAgICAgIGV4Y2x1ZGVkOiBbXG4gICAgICAgICAgXCJwcm92aWRlciBzZWNyZXRzXCIsXG4gICAgICAgICAgXCJyYXcgbW9kZWwgb3V0cHV0XCIsXG4gICAgICAgICAgXCJwcml2YXRlIHJ1bnRpbWUgcGF0aHNcIixcbiAgICAgICAgXSxcbiAgICAgIH0sXG4gICAgfTtcbiAgICBhd2FpdCBpbnN0YWxsQXBpRml4dHVyZXMocGFnZSwge1xuICAgICAgYXVkaXRFeHBvcnQ6IHtcbiAgICAgICAgYm9keTogYXVkaXRCb2R5LFxuICAgICAgICBmaWxlbmFtZTogXCJjYW5jZWxsZWQtc2VydmVyLWF1ZGl0Lmpzb25cIixcbiAgICAgICAgcmVxdWVzdHM6IGF1ZGl0UmVxdWVzdHMsXG4gICAgICAgIGV4ZWN1dGlvbjogY2FuY2VsbGVkRXhlY3V0aW9uLFxuICAgICAgICBtZXNzYWdlT3V0Y29tZTogXCJDQU5DRUxMRURcIixcbiAgICAgICAgZmFpbEZpcnN0UHJldmlldzogdHJ1ZSxcbiAgICAgIH0sXG4gICAgfSk7XG4gICAgYXdhaXQgcHJvZ3JhbW1hdGljU2lnbkluKHBhZ2UpO1xuICAgIGF3YWl0IHBhZ2UuZXZhbHVhdGUoKCkgPT4ge1xuICAgICAgY29uc3QgZXhlY3V0aW9uID0ge1xuICAgICAgICBpZDogXCJlMmUtY29udHJvbGxlZC1leGVjdXRpb25cIixcbiAgICAgICAgcHJvamVjdElkOiBcImUyZS1wcm9qZWN0XCIsXG4gICAgICAgIHNlc3Npb25JZDogXCJlMmUtYXVkaXQtc2Vzc2lvblwiLFxuICAgICAgICBtZXNzYWdlOiBcIkNhbmNlbGxlZCBhdWRpdCBleGVjdXRpb25cIixcbiAgICAgIH07XG4gICAgICBsb2NhbFN0b3JhZ2Uuc2V0SXRlbShcbiAgICAgICAgXCJlb3NfYWlfZXhlY3V0aW9uX2N1cnJlbnRfZTJlLXByb2plY3RcIixcbiAgICAgICAgXCJlMmUtYXVkaXQtc2Vzc2lvblwiLFxuICAgICAgKTtcbiAgICAgIGxvY2FsU3RvcmFnZS5zZXRJdGVtKFxuICAgICAgICBcImVvc19haV9leGVjdXRpb25fZTJlLXByb2plY3RfZTJlLWF1ZGl0LXNlc3Npb25cIixcbiAgICAgICAgSlNPTi5zdHJpbmdpZnkoZXhlY3V0aW9uKSxcbiAgICAgICk7XG4gICAgfSk7XG4gICAgYXdhaXQgcGFnZS5nb3RvKGAke0RBU0hCT0FSRF9QQVRIfWFpYCk7XG5cbiAgICBjb25zdCBwcm9vZiA9IHBhZ2UuZ2V0QnlMYWJlbChcIkFnZW50IGV4ZWN1dGlvbiBwcm9vZlwiKTtcbiAgICBhd2FpdCBleHBlY3QocHJvb2YpLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KHByb29mKS50b0NvbnRhaW5UZXh0KFwiQ2FuY2VsbGVkXCIpO1xuICAgIGF3YWl0IGV4cGVjdChwcm9vZikudG9Db250YWluVGV4dChcIkV4ZWN1dGlvbiBlMmUtY29udHJvbGxlZC1leGVjdXRpb25cIik7XG4gICAgYXdhaXQgZXhwZWN0KHByb29mKS50b0NvbnRhaW5UZXh0KFwiUmV2aXNpb246IGUyZS1yZXZpc2lvbi00MlwiKTtcbiAgICBhd2FpdCBleHBlY3QocHJvb2YpLnRvQ29udGFpblRleHQoXCJUZXJtaW5hbCByZWFzb246IGNhbmNlbF9yZXF1ZXN0ZWRcIik7XG4gICAgYXdhaXQgZXhwZWN0KHByb29mLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiQ2FuY2VsXCIgfSkpLnRvSGF2ZUNvdW50KDApO1xuICAgIGF3YWl0IGV4cGVjdChwcm9vZi5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIlJlc3VtZVwiIH0pKS50b0hhdmVDb3VudCgwKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwcm9vZi5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIkFwcHJvdmUgJiBhcHBseVwiIH0pLFxuICAgICkudG9IYXZlQ291bnQoMCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcHJvb2YuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogL2NvbW1pdCB2ZXJpZmllZCBjaGFuZ2VzL2kgfSksXG4gICAgKS50b0hhdmVDb3VudCgwKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwcm9vZi5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiAvcHVzaCBjb21taXR0ZWQgY2hhbmdlcy9pIH0pLFxuICAgICkudG9IYXZlQ291bnQoMCk7XG5cbiAgICBhd2FpdCBwcm9vZi5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIlByZXZpZXcgYXVkaXRcIiB9KS5jbGljaygpO1xuICAgIGNvbnN0IHByZXZpZXcgPSBwYWdlLmdldEJ5TGFiZWwoXCJSZWRhY3RlZCBhdWRpdCBwcmV2aWV3XCIpO1xuICAgIGF3YWl0IGV4cGVjdChwcmV2aWV3KS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChwcmV2aWV3KS50b0NvbnRhaW5UZXh0KFwiQXVkaXQgcHJldmlldyB0ZW1wb3JhcmlseSB1bmF2YWlsYWJsZVwiKTtcbiAgICBhd2FpdCBleHBlY3QocHJldmlldykudG9Db250YWluVGV4dChcInNhbWUgZXhlY3V0aW9uIGFuZCByZXZpc2lvblwiKTtcbiAgICBhd2FpdCBleHBlY3QocHJldmlldy5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIlJldHJ5IHByZXZpZXdcIiB9KSkudG9CZVZpc2libGUoKTtcbiAgICBleHBlY3QoYXVkaXRSZXF1ZXN0cykudG9IYXZlTGVuZ3RoKDEpO1xuXG4gICAgYXdhaXQgcHJldmlldy5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIlJldHJ5IHByZXZpZXdcIiB9KS5jbGljaygpO1xuICAgIGF3YWl0IGV4cGVjdChwcmV2aWV3KS50b0NvbnRhaW5UZXh0KFwiY2FuY2VsbGVkXCIpO1xuICAgIGF3YWl0IGV4cGVjdChwcmV2aWV3KS50b0NvbnRhaW5UZXh0KEVYRUNVVElPTl9JRCk7XG4gICAgYXdhaXQgZXhwZWN0KHByZXZpZXcpLnRvQ29udGFpblRleHQoXCJlMmUtb3BlcmF0aW9uXCIpO1xuICAgIGF3YWl0IGV4cGVjdChwcmV2aWV3KS50b0NvbnRhaW5UZXh0KFwiZTJlLXJldmlzaW9uLTQyXCIpO1xuICAgIGF3YWl0IGV4cGVjdChwcmV2aWV3KS50b0NvbnRhaW5UZXh0KFwicHJvdmlkZXIgc2VjcmV0c1wiKTtcbiAgICBhd2FpdCBleHBlY3QocHJldmlldykudG9Db250YWluVGV4dChcInJhdyBtb2RlbCBvdXRwdXRcIik7XG4gICAgYXdhaXQgZXhwZWN0KHByZXZpZXcpLnRvQ29udGFpblRleHQoXCJwcml2YXRlIHJ1bnRpbWUgcGF0aHNcIik7XG4gICAgYXdhaXQgZXhwZWN0KHByb29mKS50b0NvbnRhaW5UZXh0KFwiQ2FuY2VsbGVkXCIpO1xuICAgIGF3YWl0IGV4cGVjdChwcm9vZikudG9Db250YWluVGV4dChcIlJldmlzaW9uOiBlMmUtcmV2aXNpb24tNDJcIik7XG4gICAgYXdhaXQgZXhwZWN0KHByb29mKS50b0NvbnRhaW5UZXh0KFwiVGVybWluYWwgcmVhc29uOiBjYW5jZWxfcmVxdWVzdGVkXCIpO1xuICAgIGV4cGVjdChhdWRpdFJlcXVlc3RzKS50b0hhdmVMZW5ndGgoMik7XG5cbiAgICBhd2FpdCBwcmV2aWV3LmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiQ2xvc2UgYXVkaXQgcHJldmlld1wiIH0pLmNsaWNrKCk7XG4gICAgY29uc3QgZG93bmxvYWRQcm9taXNlID0gcGFnZS53YWl0Rm9yRXZlbnQoXCJkb3dubG9hZFwiKTtcbiAgICBhd2FpdCBwcm9vZi5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIkV4cG9ydCBhdWRpdFwiIH0pLmNsaWNrKCk7XG4gICAgY29uc3QgZG93bmxvYWQgPSBhd2FpdCBkb3dubG9hZFByb21pc2U7XG4gICAgZXhwZWN0KGRvd25sb2FkLnN1Z2dlc3RlZEZpbGVuYW1lKCkpLnRvQmUoXCJjYW5jZWxsZWQtc2VydmVyLWF1ZGl0Lmpzb25cIik7XG4gICAgZXhwZWN0KGF1ZGl0UmVxdWVzdHMpLnRvSGF2ZUxlbmd0aCgzKTtcblxuICAgIGF3YWl0IHBhZ2UucmVsb2FkKCk7XG4gICAgY29uc3QgcmVsb2FkZWRQcm9vZiA9IHBhZ2UuZ2V0QnlMYWJlbChcIkFnZW50IGV4ZWN1dGlvbiBwcm9vZlwiKTtcbiAgICBhd2FpdCBleHBlY3QocmVsb2FkZWRQcm9vZikudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QocmVsb2FkZWRQcm9vZikudG9Db250YWluVGV4dChcIkNhbmNlbGxlZFwiKTtcbiAgICBhd2FpdCBleHBlY3QocmVsb2FkZWRQcm9vZikudG9Db250YWluVGV4dChcIlJldmlzaW9uOiBlMmUtcmV2aXNpb24tNDJcIik7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlMYWJlbChcIlJlZGFjdGVkIGF1ZGl0IHByZXZpZXdcIikpLnRvQmVIaWRkZW4oKTtcbiAgICBleHBlY3QoYXVkaXRSZXF1ZXN0cykudG9IYXZlTGVuZ3RoKDMpO1xuICB9KTtcblxuICB0ZXN0KFwidXBsb2FkcyBhbiBhcmNoaXZlIGFuZCByZW5kZXJzIGEgbGl2ZSB0YXNrIHVwZGF0ZVwiLCBhc3luYyAoe1xuICAgIHBhZ2UsXG4gIH0pID0+IHtcbiAgICBjb25zdCB0YXNrSWQgPSBcImUyZS1saXZlLXRhc2tcIjtcbiAgICBjb25zdCBsaXZlTG9nID0ge1xuICAgICAgaWQ6IFwiZTJlLWxpdmUtbG9nXCIsXG4gICAgICB0YXNrSWQsXG4gICAgICBsZXZlbDogXCJpbmZvXCIsXG4gICAgICBtZXNzYWdlOiBcIkxpdmUgdXBkYXRlIHJlY2VpdmVkIGZyb20gdGhlIHNlcnZlclwiLFxuICAgICAgdGltZXN0YW1wOiBcIjIwMjYtMDEtMDFUMDA6MDA6MDIuMDAwWlwiLFxuICAgIH07XG4gICAgYXdhaXQgaW5zdGFsbEFwaUZpeHR1cmVzKHBhZ2UsIHtcbiAgICAgIGFyY2hpdmVVcGxvYWQ6IHtcbiAgICAgICAgdXBsb2FkSWQ6IFwiZTJlLXVwbG9hZFwiLFxuICAgICAgICBvcmlnaW5hbE5hbWU6IFwiZGFzaGJvYXJkLWpvdXJuZXkuemlwXCIsXG4gICAgICB9LFxuICAgICAgbGl2ZVRhc2s6IHtcbiAgICAgICAgaWQ6IHRhc2tJZCxcbiAgICAgICAgdGl0bGU6IFwiVmVyaWZ5IGxpdmUgZGFzaGJvYXJkIHVwZGF0ZXNcIixcbiAgICAgICAgcHJvamVjdElkOiBcImUyZS1wcm9qZWN0XCIsXG4gICAgICAgIGxvZzogbGl2ZUxvZyxcbiAgICAgIH0sXG4gICAgfSk7XG4gICAgYXdhaXQgcHJvZ3JhbW1hdGljU2lnbkluKHBhZ2UpO1xuXG4gICAgLy8gVGhpcyBpcyBhIHZhbGlkLCBlbXB0eSBaSVAgYXJjaGl2ZS4gS2VlcGluZyBpdCBpbmxpbmUgbWFrZXMgdGhlIGJyb3dzZXJcbiAgICAvLyB0ZXN0IHNlbGYtY29udGFpbmVkIHdoaWxlIHN0aWxsIGV4ZXJjaXNpbmcgRm9ybURhdGEgYW5kIG11bHRpcGFydCBieXRlcy5cbiAgICBjb25zdCB1cGxvYWRSZXN1bHQgPSBhd2FpdCBwYWdlLmV2YWx1YXRlKGFzeW5jIChhcGlCYXNlVXJsKSA9PiB7XG4gICAgICBjb25zdCBieXRlcyA9IFVpbnQ4QXJyYXkuZnJvbShcbiAgICAgICAgYXRvYihcIlVFc0ZCZ0FBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQT09XCIpLFxuICAgICAgICAoY2hhcmFjdGVyKSA9PiBjaGFyYWN0ZXIuY2hhckNvZGVBdCgwKSxcbiAgICAgICk7XG4gICAgICBjb25zdCBib2R5ID0gbmV3IEZvcm1EYXRhKCk7XG4gICAgICBib2R5LmFwcGVuZChcbiAgICAgICAgXCJhcmNoaXZlXCIsXG4gICAgICAgIG5ldyBCbG9iKFtieXRlc10sIHsgdHlwZTogXCJhcHBsaWNhdGlvbi96aXBcIiB9KSxcbiAgICAgICAgXCJkYXNoYm9hcmQtam91cm5leS56aXBcIixcbiAgICAgICk7XG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGZldGNoKFxuICAgICAgICBuZXcgVVJMKFwiL2FwaS91cGxvYWQvYXJjaGl2ZVwiLCBhcGlCYXNlVXJsKS50b1N0cmluZygpLFxuICAgICAgICB7IG1ldGhvZDogXCJQT1NUXCIsIGNyZWRlbnRpYWxzOiBcImluY2x1ZGVcIiwgYm9keSB9LFxuICAgICAgKTtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIHN0YXR1czogcmVzcG9uc2Uuc3RhdHVzLFxuICAgICAgICBib2R5OiAoYXdhaXQgcmVzcG9uc2UuanNvbigpKSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPixcbiAgICAgIH07XG4gICAgfSwgcHJvY2Vzcy5lbnYuREFTSEJPQVJEX0UyRV9BUElfQkFTRV9VUkwgPz8gcGFnZS51cmwoKSk7XG4gICAgZXhwZWN0KHVwbG9hZFJlc3VsdC5zdGF0dXMpLnRvQmUoMjAxKTtcbiAgICBleHBlY3QodXBsb2FkUmVzdWx0LmJvZHkpLnRvRXF1YWwoe1xuICAgICAgdXBsb2FkSWQ6IFwiZTJlLXVwbG9hZFwiLFxuICAgICAgb3JpZ2luYWxOYW1lOiBcImRhc2hib2FyZC1qb3VybmV5LnppcFwiLFxuICAgIH0pO1xuXG4gICAgYXdhaXQgb3Blbk5hdmlnYXRpb24ocGFnZSwgXCJUYXNrc1wiLCBgJHtEQVNIQk9BUkRfUEFUSH10YXNrc2ApO1xuICAgIGNvbnN0IHRhc2tSb3cgPSBwYWdlLmdldEJ5TGFiZWwoXG4gICAgICBcIkV4cGFuZCB0YXNrIFZlcmlmeSBsaXZlIGRhc2hib2FyZCB1cGRhdGVzXCIsXG4gICAgKTtcbiAgICBhd2FpdCBleHBlY3QodGFza1JvdykudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCB0YXNrUm93LmNsaWNrKCk7XG4gICAgYXdhaXQgcGFnZS5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIkxvZ3NcIiB9KS5jbGljaygpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlLmdldEJ5Um9sZShcInJlZ2lvblwiLCB7IG5hbWU6IFwiQWN0aXZpdHlcIiB9KSkudG9Db250YWluVGV4dChcbiAgICAgIFwiTGl2ZSB1cGRhdGUgcmVjZWl2ZWQgZnJvbSB0aGUgc2VydmVyXCIsXG4gICAgKTtcbiAgfSk7XG5cbiAgdGVzdChcInJlY292ZXJzIGEgbGl2ZSB0YXNrIHVwZGF0ZSBhZnRlciBhIHRlbXBvcmFyeSBzdHJlYW0gZmFpbHVyZVwiLCBhc3luYyAoe1xuICAgIHBhZ2UsXG4gIH0pID0+IHtcbiAgICBjb25zdCB0YXNrSWQgPSBcImUyZS1yZWNvbm5lY3RpbmctbGl2ZS10YXNrXCI7XG4gICAgY29uc3QgbGl2ZUxvZyA9IHtcbiAgICAgIGlkOiBcImUyZS1yZWNvbm5lY3RpbmctbGl2ZS1sb2dcIixcbiAgICAgIHRhc2tJZCxcbiAgICAgIGxldmVsOiBcImluZm9cIixcbiAgICAgIG1lc3NhZ2U6IFwiQXV0aG9yaXRhdGl2ZSB1cGRhdGUgcmVjZWl2ZWQgYWZ0ZXIgcmVjb25uZWN0XCIsXG4gICAgICB0aW1lc3RhbXA6IFwiMjAyNi0wMS0wMVQwMDowMDowMi4wMDBaXCIsXG4gICAgICBtZXRhZGF0YToge1xuICAgICAgICBvcGVyYXRpb25JZDogXCJlMmUtcmVjb25uZWN0aW5nLW9wZXJhdGlvblwiLFxuICAgICAgICBjaGVja3BvaW50VmVyc2lvbjogMyxcbiAgICAgIH0sXG4gICAgfTtcbiAgICBjb25zdCBzdHJlYW1SZXF1ZXN0czogc3RyaW5nW10gPSBbXTtcbiAgICBhd2FpdCBpbnN0YWxsQXBpRml4dHVyZXMocGFnZSwge1xuICAgICAgbGl2ZVRhc2s6IHtcbiAgICAgICAgaWQ6IHRhc2tJZCxcbiAgICAgICAgdGl0bGU6IFwiUmVjb3ZlciBsaXZlIHRhc2sgdXBkYXRlc1wiLFxuICAgICAgICBwcm9qZWN0SWQ6IFwiZTJlLXByb2plY3RcIixcbiAgICAgICAgbG9nOiBsaXZlTG9nLFxuICAgICAgICBzdHJlYW1SZXF1ZXN0cyxcbiAgICAgICAgZmFpbEZpcnN0U3RyZWFtOiB0cnVlLFxuICAgICAgfSxcbiAgICB9KTtcbiAgICBhd2FpdCBwcm9ncmFtbWF0aWNTaWduSW4ocGFnZSk7XG5cbiAgICBhd2FpdCBvcGVuTmF2aWdhdGlvbihwYWdlLCBcIlRhc2tzXCIsIGAke0RBU0hCT0FSRF9QQVRIfXRhc2tzYCk7XG4gICAgY29uc3QgdGFza1JvdyA9IHBhZ2UuZ2V0QnlMYWJlbChcIkV4cGFuZCB0YXNrIFJlY292ZXIgbGl2ZSB0YXNrIHVwZGF0ZXNcIik7XG4gICAgYXdhaXQgZXhwZWN0KHRhc2tSb3cpLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgdGFza1Jvdy5jbGljaygpO1xuICAgIGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJMb2dzXCIgfSkuY2xpY2soKTtcblxuICAgIGNvbnN0IGFjdGl2aXR5ID0gcGFnZS5nZXRCeVJvbGUoXCJyZWdpb25cIiwgeyBuYW1lOiBcIkFjdGl2aXR5XCIgfSk7XG4gICAgYXdhaXQgZXhwZWN0KGFjdGl2aXR5KS50b0NvbnRhaW5UZXh0KGxpdmVMb2cubWVzc2FnZSk7XG4gICAgYXdhaXQgZXhwZWN0XG4gICAgICAucG9sbCgoKSA9PiBzdHJlYW1SZXF1ZXN0cy5sZW5ndGgsIHtcbiAgICAgICAgbWVzc2FnZTogXCJ0aGUgdGFzayBsb2cgc3RyZWFtIHNob3VsZCByZWNvbm5lY3QgZXhhY3RseSBvbmNlXCIsXG4gICAgICB9KVxuICAgICAgLnRvQmUoMik7XG4gICAgZXhwZWN0KHN0cmVhbVJlcXVlc3RzKS50b0hhdmVMZW5ndGgoMik7XG4gICAgZXhwZWN0KHN0cmVhbVJlcXVlc3RzWzBdKS50b0JlKHN0cmVhbVJlcXVlc3RzWzFdKTtcbiAgICBleHBlY3QobmV3IFVSTChzdHJlYW1SZXF1ZXN0c1sxXSkucGF0aG5hbWUpLnRvQmUoXG4gICAgICBgL2FwaS90YXNrcy8ke3Rhc2tJZH0vbG9ncy9zdHJlYW1gLFxuICAgICk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgYWN0aXZpdHkubG9jYXRvcihcInN1bW1hcnlcIikuZmlsdGVyKHsgaGFzVGV4dDogbGl2ZUxvZy5tZXNzYWdlIH0pLFxuICAgICkudG9IYXZlQ291bnQoMSk7XG4gIH0pO1xuXG4gIHRlc3QoXCJzaG93cyBhbiBhY3Rpb25hYmxlIHRlcm1pbmFsIHN0YXRlIHdoZW4gbGl2ZSB0YXNrIHJlY29ubmVjdHMgYXJlIGV4aGF1c3RlZFwiLCBhc3luYyAoe1xuICAgIHBhZ2UsXG4gIH0pID0+IHtcbiAgICBjb25zdCB0YXNrSWQgPSBcImUyZS1leGhhdXN0ZWQtbGl2ZS10YXNrXCI7XG4gICAgY29uc3Qgb3BlcmF0aW9uSWQgPSBcImUyZS1leGhhdXN0ZWQtb3BlcmF0aW9uXCI7XG4gICAgY29uc3QgbGl2ZUxvZyA9IHtcbiAgICAgIGlkOiBcImUyZS1leGhhdXN0ZWQtbGl2ZS1sb2dcIixcbiAgICAgIHRhc2tJZCxcbiAgICAgIGxldmVsOiBcImluZm9cIixcbiAgICAgIG1lc3NhZ2U6IFwiVGhlIG9ubHkgY29uZmlybWVkIHRhc2sgdXBkYXRlXCIsXG4gICAgICB0aW1lc3RhbXA6IFwiMjAyNi0wMS0wMVQwMDowMDowMi4wMDBaXCIsXG4gICAgICBtZXRhZGF0YTogeyBvcGVyYXRpb25JZCB9LFxuICAgIH07XG4gICAgY29uc3Qgc3RyZWFtUmVxdWVzdHM6IHN0cmluZ1tdID0gW107XG4gICAgY29uc3Qgbm9uU3RyZWFtUmVxdWVzdHM6IHN0cmluZ1tdID0gW107XG4gICAgcGFnZS5vbihcInJlcXVlc3RcIiwgKHJlcXVlc3QpID0+IHtcbiAgICAgIGlmICghcmVxdWVzdC51cmwoKS5pbmNsdWRlcyhcIi9hcGkvdGFza3MvXCIpKSByZXR1cm47XG4gICAgICBpZiAoIXJlcXVlc3QudXJsKCkuaW5jbHVkZXMoXCIvbG9ncy9zdHJlYW1cIikpIG5vblN0cmVhbVJlcXVlc3RzLnB1c2gocmVxdWVzdC5tZXRob2QoKSk7XG4gICAgfSk7XG4gICAgYXdhaXQgaW5zdGFsbEFwaUZpeHR1cmVzKHBhZ2UsIHtcbiAgICAgIGxpdmVUYXNrOiB7XG4gICAgICAgIGlkOiB0YXNrSWQsXG4gICAgICAgIHRpdGxlOiBcIlJlY292ZXIgZXhoYXVzdGVkIGxpdmUgdGFzayB1cGRhdGVzXCIsXG4gICAgICAgIHByb2plY3RJZDogXCJlMmUtcHJvamVjdFwiLFxuICAgICAgICBsb2c6IGxpdmVMb2csXG4gICAgICAgIGluaXRpYWxMb2dzOiBbbGl2ZUxvZ10sXG4gICAgICAgIHN0cmVhbVJlcXVlc3RzLFxuICAgICAgICBmYWlsU3RyZWFtQXR0ZW1wdHM6IDYsXG4gICAgICB9LFxuICAgIH0pO1xuICAgIGF3YWl0IHByb2dyYW1tYXRpY1NpZ25JbihwYWdlKTtcblxuICAgIGF3YWl0IG9wZW5OYXZpZ2F0aW9uKHBhZ2UsIFwiVGFza3NcIiwgYCR7REFTSEJPQVJEX1BBVEh9dGFza3NgKTtcbiAgICBhd2FpdCBwYWdlLmdldEJ5TGFiZWwoXCJFeHBhbmQgdGFzayBSZWNvdmVyIGV4aGF1c3RlZCBsaXZlIHRhc2sgdXBkYXRlc1wiKS5jbGljaygpO1xuICAgIGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJMb2dzXCIgfSkuY2xpY2soKTtcblxuICAgIGNvbnN0IGFjdGl2aXR5ID0gcGFnZS5nZXRCeVJvbGUoXCJyZWdpb25cIiwgeyBuYW1lOiBcIkFjdGl2aXR5XCIgfSk7XG4gICAgYXdhaXQgZXhwZWN0KGFjdGl2aXR5KS50b0NvbnRhaW5UZXh0KGxpdmVMb2cubWVzc2FnZSk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlUZXh0KFwiVGVtcG9yYXJ5IHN0cmVhbSBmYWlsdXJlLlwiLCB7IGV4YWN0OiBmYWxzZSB9KSkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3RcbiAgICAgIC5wb2xsKCgpID0+IHN0cmVhbVJlcXVlc3RzLmxlbmd0aCwge1xuICAgICAgICBtZXNzYWdlOiBcInRoZSB0YXNrIGxvZyBzdHJlYW0gc2hvdWxkIGV4aGF1c3QgaXRzIGJvdW5kZWQgcmVjb25uZWN0IGJ1ZGdldFwiLFxuICAgICAgICB0aW1lb3V0OiAzNV8wMDAsXG4gICAgICB9KVxuICAgICAgLnRvQmUoNik7XG4gICAgY29uc3QgZXhoYXVzdGVkID0gcGFnZS5nZXRCeVJvbGUoXCJhbGVydFwiKTtcbiAgICBhd2FpdCBleHBlY3QoZXhoYXVzdGVkKS50b0NvbnRhaW5UZXh0KFwiTGl2ZSB0YXNrIHVwZGF0ZXMgY291bGQgbm90IHJlY29ubmVjdFwiKTtcbiAgICBhd2FpdCBleHBlY3QoZXhoYXVzdGVkKS50b0NvbnRhaW5UZXh0KFwiUmVjb25uZWN0IGF0dGVtcHRzIGFyZSBleGhhdXN0ZWRcIik7XG4gICAgYXdhaXQgZXhwZWN0KGV4aGF1c3RlZCkudG9Db250YWluVGV4dChvcGVyYXRpb25JZCk7XG4gICAgYXdhaXQgZXhwZWN0KGV4aGF1c3RlZCkudG9Db250YWluVGV4dChcInRhc2sgaGFzIG5vdCBiZWVuIG1hcmtlZCBmYWlsZWRcIik7XG4gICAgYXdhaXQgZXhwZWN0KGV4aGF1c3RlZC5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIlJldHJ5IGxpdmUgdXBkYXRlc1wiIH0pKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChleGhhdXN0ZWQuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJSZWZyZXNoIHRhc2sgbG9nc1wiIH0pKS50b0JlVmlzaWJsZSgpO1xuXG4gICAgYXdhaXQgZXhoYXVzdGVkLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiUmV0cnkgbGl2ZSB1cGRhdGVzXCIgfSkuY2xpY2soKTtcbiAgICBhd2FpdCBleHBlY3QoYWN0aXZpdHkpLnRvQ29udGFpblRleHQoXCJUaGUgb25seSBjb25maXJtZWQgdGFzayB1cGRhdGVcIik7XG4gICAgYXdhaXQgZXhwZWN0LnBvbGwoKCkgPT4gc3RyZWFtUmVxdWVzdHMubGVuZ3RoKS50b0JlKDcpO1xuICAgIGV4cGVjdChuZXcgU2V0KHN0cmVhbVJlcXVlc3RzKS5zaXplKS50b0JlKDEpO1xuICAgIGV4cGVjdChub25TdHJlYW1SZXF1ZXN0cykubm90LnRvQ29udGFpbihcIlBPU1RcIik7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgYWN0aXZpdHkubG9jYXRvcihcInN1bW1hcnlcIikuZmlsdGVyKHsgaGFzVGV4dDogbGl2ZUxvZy5tZXNzYWdlIH0pLFxuICAgICkudG9IYXZlQ291bnQoMSk7XG4gIH0pO1xuXG4gIHRlc3QoXCJwYWdlcyBhbmQgcmVsb2FkcyB0aGUgZmlsdGVyZWQgZXZlbnQgc3RyZWFtIHdpdGhvdXQgbG9zaW5nIGl0cyB3aW5kb3dcIiwgYXN5bmMgKHtcbiAgICBwYWdlLFxuICB9KSA9PiB7XG4gICAgY29uc3QgZXZlbnRzID0gQXJyYXkuZnJvbSh7IGxlbmd0aDogNTEgfSwgKF8sIGluZGV4KSA9PiAoe1xuICAgICAgaWQ6IGBlMmUtZXZlbnQtJHtpbmRleH1gLFxuICAgICAgcHJvamVjdElkOiBcImUyZS1wcm9qZWN0XCIsXG4gICAgICB0eXBlOiBcIkF1ZGl0RXZlbnRcIixcbiAgICAgIHNldmVyaXR5OiBpbmRleCA8IDIgPyBcInN1Y2Nlc3NcIiA6IFwiaW5mb1wiLFxuICAgICAgY29ycmVsYXRpb25JZDogaW5kZXggPCAyID8gXCJyZWxlYXNlLTQyXCIgOiBudWxsLFxuICAgICAgbWVzc2FnZTpcbiAgICAgICAgaW5kZXggPCAyID8gYEZpbHRlcmVkIHJlbGVhc2UgZXZlbnQgJHtpbmRleH1gIDogYE9sZGVyIGV2ZW50ICR7aW5kZXh9YCxcbiAgICAgIHRpbWVzdGFtcDogbmV3IERhdGUoRGF0ZS5VVEMoMjAyNiwgMCwgMSwgMCwgMCwgNTEgLSBpbmRleCkpLnRvSVNPU3RyaW5nKCksXG4gICAgfSkpO1xuICAgIGNvbnN0IGV2ZW50UmVxdWVzdHM6IHN0cmluZ1tdID0gW107XG4gICAgcGFnZS5vbihcInJlcXVlc3RcIiwgKHJlcXVlc3QpID0+IHtcbiAgICAgIGlmIChuZXcgVVJMKHJlcXVlc3QudXJsKCkpLnBhdGhuYW1lLmVuZHNXaXRoKFwiL2FwaS9ldmVudHNcIikpXG4gICAgICAgIGV2ZW50UmVxdWVzdHMucHVzaChyZXF1ZXN0LnVybCgpKTtcbiAgICB9KTtcbiAgICBhd2FpdCBpbnN0YWxsQXBpRml4dHVyZXMocGFnZSwge1xuICAgICAgZXZlbnRzLFxuICAgICAgcHJvamVjdHM6IFtcbiAgICAgICAge1xuICAgICAgICAgIGlkOiBcImUyZS1wcm9qZWN0XCIsXG4gICAgICAgICAgbmFtZTogXCJTbW9rZSBQcm9qZWN0XCIsXG4gICAgICAgICAgbGFuZ3VhZ2U6IFwiVHlwZVNjcmlwdFwiLFxuICAgICAgICAgIGZyYW1ld29yazogXCJSZWFjdFwiLFxuICAgICAgICAgIHN0YXR1czogXCJhY3RpdmVcIixcbiAgICAgICAgICByb290UGF0aDogXCIvY29udHJvbGxlZC9zbW9rZVwiLFxuICAgICAgICAgIHF1YWxpdHlTY29yZTogOTIsXG4gICAgICAgIH0sXG4gICAgICBdLFxuICAgIH0pO1xuICAgIGF3YWl0IHByb2dyYW1tYXRpY1NpZ25JbihwYWdlKTtcbiAgICBhd2FpdCBwYWdlLmdvdG8oYCR7REFTSEJPQVJEX1BBVEh9ZXZlbnRzYCk7XG5cbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcIk9sZGVyIGV2ZW50IDQ5XCIsIHsgZXhhY3Q6IHRydWUgfSksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiT2xkZXIgZXZlbnQgNTBcIiwgeyBleGFjdDogdHJ1ZSB9KSxcbiAgICApLm5vdC50b0JlVmlzaWJsZSgpO1xuICAgIGNvbnN0IGZpcnN0UmVxdWVzdCA9IG5ldyBVUkwoZXZlbnRSZXF1ZXN0cy5hdCgtMSkhKTtcbiAgICBleHBlY3QoZmlyc3RSZXF1ZXN0LnNlYXJjaFBhcmFtcy5nZXQoXCJsaW1pdFwiKSkudG9CZShcIjUwXCIpO1xuICAgIGV4cGVjdChmaXJzdFJlcXVlc3Quc2VhcmNoUGFyYW1zLmdldChcInBhZ2VcIikpLnRvQmUoXCIxXCIpO1xuXG4gICAgYXdhaXQgUHJvbWlzZS5hbGwoW1xuICAgICAgcGFnZS53YWl0Rm9yUmVxdWVzdCgocmVxdWVzdCkgPT4ge1xuICAgICAgICBjb25zdCB1cmwgPSBuZXcgVVJMKHJlcXVlc3QudXJsKCkpO1xuICAgICAgICByZXR1cm4gKFxuICAgICAgICAgIHVybC5wYXRobmFtZS5lbmRzV2l0aChcIi9hcGkvZXZlbnRzXCIpICYmXG4gICAgICAgICAgdXJsLnNlYXJjaFBhcmFtcy5nZXQoXCJwYWdlXCIpID09PSBcIjJcIlxuICAgICAgICApO1xuICAgICAgfSksXG4gICAgICBwYWdlLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiT2xkZXJcIiB9KS5jbGljaygpLFxuICAgIF0pO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlLmdldEJ5VGV4dChcIlBhZ2UgMi5cIiwgeyBleGFjdDogZmFsc2UgfSkpLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXCJPbGRlciBldmVudCA1MFwiLCB7IGV4YWN0OiB0cnVlIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcIkZpbHRlcmVkIHJlbGVhc2UgZXZlbnQgMFwiLCB7IGV4YWN0OiB0cnVlIH0pLFxuICAgICkubm90LnRvQmVWaXNpYmxlKCk7XG4gICAgZXhwZWN0KG5ldyBVUkwoZXZlbnRSZXF1ZXN0cy5hdCgtMSkhKS5zZWFyY2hQYXJhbXMuZ2V0KFwicGFnZVwiKSkudG9CZShcIjJcIik7XG4gICAgYXdhaXQgcGFnZS5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIk5ld2VyXCIgfSkuY2xpY2soKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5nZXRCeVRleHQoXCJQYWdlIDEuXCIsIHsgZXhhY3Q6IGZhbHNlIH0pKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiRmlsdGVyZWQgcmVsZWFzZSBldmVudCAwXCIsIHsgZXhhY3Q6IHRydWUgfSksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuXG4gICAgYXdhaXQgcGFnZS5nZXRCeVBsYWNlaG9sZGVyKFwiU2VhcmNoIGxvZ3MuLi5cIikuZmlsbChcIkZpbHRlcmVkIHJlbGVhc2VcIik7XG4gICAgYXdhaXQgcGFnZS5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIlRvZ2dsZSBldmVudCBmaWx0ZXJzXCIgfSkuY2xpY2soKTtcbiAgICBhd2FpdCBwYWdlLmxvY2F0b3IoXCJzZWxlY3RcIikubnRoKDEpLnNlbGVjdE9wdGlvbihcInN1Y2Nlc3NcIik7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXCJGaWx0ZXJlZCByZWxlYXNlIGV2ZW50IDBcIiwgeyBleGFjdDogdHJ1ZSB9KSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXCJPbGRlciBldmVudCAxXCIsIHsgZXhhY3Q6IHRydWUgfSksXG4gICAgKS5ub3QudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZSkudG9IYXZlVVJMKC9zZWFyY2g9RmlsdGVyZWRcXCtyZWxlYXNlLyk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UpLnRvSGF2ZVVSTCgvc2V2ZXJpdHk9c3VjY2Vzcy8pO1xuXG4gICAgYXdhaXQgcGFnZS5yZWxvYWQoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcIkZpbHRlcmVkIHJlbGVhc2UgZXZlbnQgMFwiLCB7IGV4YWN0OiB0cnVlIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcIk9sZGVyIGV2ZW50IDFcIiwgeyBleGFjdDogdHJ1ZSB9KSxcbiAgICApLm5vdC50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlLmdldEJ5UGxhY2Vob2xkZXIoXCJTZWFyY2ggbG9ncy4uLlwiKSkudG9IYXZlVmFsdWUoXG4gICAgICBcIkZpbHRlcmVkIHJlbGVhc2VcIixcbiAgICApO1xuICAgIGF3YWl0IHBhZ2UuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJUb2dnbGUgZXZlbnQgZmlsdGVyc1wiIH0pLmNsaWNrKCk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcihcInNlbGVjdFwiKS5udGgoMSkpLnRvSGF2ZVZhbHVlKFwic3VjY2Vzc1wiKTtcbiAgICBjb25zdCBmaWx0ZXJlZFJlcXVlc3QgPSBuZXcgVVJMKGV2ZW50UmVxdWVzdHMuYXQoLTEpISk7XG4gICAgZXhwZWN0KGZpbHRlcmVkUmVxdWVzdC5zZWFyY2hQYXJhbXMuZ2V0KFwibGltaXRcIikpLnRvQmUoXCI1MFwiKTtcbiAgICBleHBlY3QoZmlsdGVyZWRSZXF1ZXN0LnNlYXJjaFBhcmFtcy5nZXQoXCJwYWdlXCIpKS50b0JlKFwiMVwiKTtcbiAgICBleHBlY3QoZmlsdGVyZWRSZXF1ZXN0LnNlYXJjaFBhcmFtcy5nZXQoXCJzZWFyY2hcIikpLnRvQmUoXCJGaWx0ZXJlZCByZWxlYXNlXCIpO1xuICAgIGV4cGVjdChmaWx0ZXJlZFJlcXVlc3Quc2VhcmNoUGFyYW1zLmdldChcInNldmVyaXR5XCIpKS50b0JlKFwic3VjY2Vzc1wiKTtcbiAgfSk7XG5cbiAgdGVzdChcInJlbmRlcnMgYW4gQXJhYmljIHNvdXJjZS1iYWNrZWQgQUkgYW5zd2VyIHdpdGhvdXQgaW50ZXJuYWwgZGlhZ25vc3RpY3NcIiwgYXN5bmMgKHtcbiAgICBwYWdlLFxuICB9KSA9PiB7XG4gICAgY29uc3QgZml4dHVyZSA9IGF3YWl0IGluc3RhbGxBcmFiaWNBaUZpeHR1cmUocGFnZSk7XG4gICAgYXdhaXQgaW5zdGFsbEFwaUZpeHR1cmVzKHBhZ2UsIHsgYXJhYmljQWk6IGZpeHR1cmUgfSk7XG4gICAgYXdhaXQgcHJvZ3JhbW1hdGljU2lnbkluKHBhZ2UpO1xuICAgIGF3YWl0IHBhZ2UuZ290byhgJHtEQVNIQk9BUkRfUEFUSH1haWApO1xuXG4gICAgY29uc3QgY29tcG9zZXIgPSBwYWdlLmxvY2F0b3IoXCJ0ZXh0YXJlYVwiKS5maXJzdCgpO1xuICAgIGF3YWl0IGV4cGVjdChjb21wb3NlcikudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBjb21wb3Nlci5maWxsKGZpeHR1cmUucXVlc3Rpb24pO1xuICAgIGNvbnN0IHNlbmRCdXR0b24gPSBjb21wb3Nlci5sb2NhdG9yKFwieHBhdGg9Li5cIikuZ2V0QnlSb2xlKFwiYnV0dG9uXCIpO1xuICAgIGF3YWl0IGV4cGVjdChzZW5kQnV0dG9uKS50b0JlRW5hYmxlZCgpO1xuICAgIGNvbnN0IHN0cmVhbVJlc3BvbnNlUHJvbWlzZSA9IHBhZ2Uud2FpdEZvclJlc3BvbnNlKChyZXNwb25zZSkgPT5cbiAgICAgIHJlc3BvbnNlLnVybCgpLmluY2x1ZGVzKFwiL2FwaS9haS9jaGF0L3N0cmVhbVwiKSxcbiAgICApO1xuICAgIGF3YWl0IHNlbmRCdXR0b24uY2xpY2soKTtcbiAgICBjb25zdCBzdHJlYW1SZXNwb25zZSA9IGF3YWl0IHN0cmVhbVJlc3BvbnNlUHJvbWlzZTtcbiAgICBleHBlY3Qoc3RyZWFtUmVzcG9uc2Uuc3RhdHVzKCkpLnRvQmUoMjAwKTtcblxuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KGZpeHR1cmUucXVlc3Rpb24sIHsgZXhhY3Q6IHRydWUgfSkubGFzdCgpLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChmaXh0dXJlLmFuc3dlciwgeyBleGFjdDogdHJ1ZSB9KS5sYXN0KCksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiQWdlbnQgYWN0aXZpdHlcIiwgeyBleGFjdDogZmFsc2UgfSksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IHBhZ2UubG9jYXRvcihcInN1bW1hcnlcIikuZmlsdGVyKHsgaGFzVGV4dDogXCJBZ2VudCBhY3Rpdml0eVwiIH0pLmNsaWNrKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXCJSZWFkaW5nIHNvdXJjZVwiLCB7IGV4YWN0OiBmYWxzZSB9KSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoZml4dHVyZS5zb3VyY2UsIHsgZXhhY3Q6IHRydWUgfSkubGFzdCgpLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dCgvQmVoYXZpb3IgZXZpZGVuY2UgwrcgMSBleGNlcnB0L2kpLmxhc3QoKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZVxuICAgICAgICAuZ2V0QnlUZXh0KCdyZXR1cm4gcGFydGlhbEZyb21Db2xsZWN0ZWRFdmlkZW5jZShcInByb3ZpZGVyIHRpbWVvdXRcIik7Jywge1xuICAgICAgICAgIGV4YWN0OiB0cnVlLFxuICAgICAgICB9KVxuICAgICAgICAubGFzdCgpLFxuICAgICkudG9CZVZpc2libGUoKTtcblxuICAgIGNvbnN0IHZpc2libGVUZXh0ID0gYXdhaXQgcGFnZS5sb2NhdG9yKFwiYm9keVwiKS5pbm5lclRleHQoKTtcbiAgICBleHBlY3QodmlzaWJsZVRleHQpLm5vdC50b0NvbnRhaW4oXCJDT01QTEVURURcIik7XG4gICAgZXhwZWN0KHZpc2libGVUZXh0KS5ub3QudG9Db250YWluKFwiUGVyc2lzdGVkIGV4ZWN1dGlvbiBwcm9vZlwiKTtcbiAgICBleHBlY3QodmlzaWJsZVRleHQpLnRvQ29udGFpbihcIk5PVCBQUk9WRU5cIik7XG4gIH0pO1xuXG4gIHRlc3QoXCJrZWVwcyB0aGUgQUkgc2Vzc2lvbiBkcmF3ZXIgb3ZlcmxhaWQgb24gYSBwaG9uZSB2aWV3cG9ydCB3aXRoIGFjY2VwdGVkIGV2aWRlbmNlXCIsIGFzeW5jICh7XG4gICAgcGFnZSxcbiAgfSkgPT4ge1xuICAgIGF3YWl0IHBhZ2Uuc2V0Vmlld3BvcnRTaXplKHsgd2lkdGg6IDM5MCwgaGVpZ2h0OiA4NDQgfSk7XG4gICAgY29uc3QgZml4dHVyZSA9IGF3YWl0IGluc3RhbGxBcmFiaWNBaUZpeHR1cmUocGFnZSk7XG4gICAgYXdhaXQgaW5zdGFsbEFwaUZpeHR1cmVzKHBhZ2UsIHsgYXJhYmljQWk6IGZpeHR1cmUgfSk7XG4gICAgYXdhaXQgcHJvZ3JhbW1hdGljU2lnbkluKHBhZ2UpO1xuICAgIGF3YWl0IHBhZ2UuZ290byhgJHtEQVNIQk9BUkRfUEFUSH1haWApO1xuXG4gICAgY29uc3QgY29tcG9zZXIgPSBwYWdlLmxvY2F0b3IoXCJ0ZXh0YXJlYVwiKS5maXJzdCgpO1xuICAgIGF3YWl0IGNvbXBvc2VyLmZpbGwoZml4dHVyZS5xdWVzdGlvbik7XG4gICAgYXdhaXQgY29tcG9zZXIubG9jYXRvcihcInhwYXRoPS4uXCIpLmdldEJ5Um9sZShcImJ1dHRvblwiKS5jbGljaygpO1xuXG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoZml4dHVyZS5hbnN3ZXIsIHsgZXhhY3Q6IHRydWUgfSkubGFzdCgpLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlXG4gICAgICAgIC5nZXRCeVRleHQoYCR7Zml4dHVyZS5zb3VyY2V9OjQyYCwgeyBleGFjdDogZmFsc2UgfSlcbiAgICAgICAgLmxhc3QoKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgcGFnZVxuICAgICAgLmxvY2F0b3IoXCJzdW1tYXJ5XCIpXG4gICAgICAuZmlsdGVyKHsgaGFzVGV4dDogXCJBZ2VudCBhY3Rpdml0eVwiIH0pXG4gICAgICAubGFzdCgpXG4gICAgICAuY2xpY2soKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKFwiYm9keVwiKSkudG9Db250YWluVGV4dChcIlJlYWRpbmcgc291cmNlXCIpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoXCJib2R5XCIpKS50b0NvbnRhaW5UZXh0KGZpeHR1cmUuc291cmNlKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKFwiYm9keVwiKSkudG9Db250YWluVGV4dChcbiAgICAgIFwiQWNjZXB0ZWQ6IHNvdXJjZSBzcGFuIHZlcmlmaWVkLlwiLFxuICAgICk7XG4gICAgYXdhaXQgZXhwZWN0Tm9Ib3Jpem9udGFsT3ZlcmZsb3cocGFnZSk7XG5cbiAgICBjb25zdCB2aXNpYmxlVGV4dCA9IGF3YWl0IHBhZ2UubG9jYXRvcihcImJvZHlcIikuaW5uZXJUZXh0KCk7XG4gICAgZXhwZWN0KHZpc2libGVUZXh0KS5ub3QudG9NYXRjaChcbiAgICAgIC9yYXdQcm9tcHR8c3lzdGVtUHJvbXB0fHByb3ZpZGVyIGRpYWdub3N0aWNzfHNvdXJjZS13aW5kb3d8cmVjb3ZlcnkgcHJvbXB0fFxcL2hvbWVcXC9ydW5uZXIvaSxcbiAgICApO1xuICB9KTtcblxuICB0ZXN0KFwia2VlcHMgc2FmZSBjaXRhdGlvbiBzdGF0ZSBhY3Jvc3MgYnJvd3NlciBiYWNrIGFuZCBmb3J3YXJkIG5hdmlnYXRpb24gd2l0aCBibG9ja2VkIGV2aWRlbmNlXCIsIGFzeW5jICh7XG4gICAgcGFnZSxcbiAgfSkgPT4ge1xuICAgIGNvbnN0IGFjY2VwdGVkID0gYXdhaXQgaW5zdGFsbEFyYWJpY0FpRml4dHVyZShwYWdlLCB7XG4gICAgICBzZXNzaW9uSWQ6IFwiZTJlLWhpc3RvcnktYWNjZXB0ZWQtc2Vzc2lvblwiLFxuICAgICAgcXVlc3Rpb246IFwi2YXYpyDZh9mIINiz2YTZiNmDINmF2YfZhNipIHByb3ZpZGVyINi52YbYryDYp9mE2LHYrNmI2Lkg2LnYqNixINiz2KzZhCDYp9mE2YXYqti12YHYrdifXCIsXG4gICAgfSk7XG4gICAgY29uc3QgYmxvY2tlZCA9IGF3YWl0IGluc3RhbGxBcmFiaWNBaUZpeHR1cmUocGFnZSwge1xuICAgICAgYmxvY2tlZDogdHJ1ZSxcbiAgICAgIHNlc3Npb25JZDogXCJlMmUtaGlzdG9yeS1ibG9ja2VkLXNlc3Npb25cIixcbiAgICAgIHF1ZXN0aW9uOiBcItmF2Kcg2YfZiCDYp9mE2K/ZhNmK2YQg2KfZhNmF2K3YrNmI2Kgg2LnZhtivINin2YTYsdis2YjYuSDYudio2LEg2LPYrNmEINin2YTZhdiq2LXZgdit2J9cIixcbiAgICB9KTtcbiAgICBhd2FpdCBpbnN0YWxsQXBpRml4dHVyZXMocGFnZSwge1xuICAgICAgYXJhYmljQWk6IGFjY2VwdGVkLFxuICAgICAgYWx0ZXJuYXRlQWk6IGJsb2NrZWQsXG4gICAgfSk7XG4gICAgYXdhaXQgcHJvZ3JhbW1hdGljU2lnbkluKHBhZ2UpO1xuICAgIGF3YWl0IHBhZ2UuZ290byhgJHtEQVNIQk9BUkRfUEFUSH1haWApO1xuXG4gICAgY29uc3QgY29tcG9zZXIgPSBwYWdlLmxvY2F0b3IoXCJ0ZXh0YXJlYVwiKS5maXJzdCgpO1xuICAgIGF3YWl0IGNvbXBvc2VyLmZpbGwoYmxvY2tlZC5xdWVzdGlvbik7XG4gICAgYXdhaXQgY29tcG9zZXIubG9jYXRvcihcInhwYXRoPS4uXCIpLmdldEJ5Um9sZShcImJ1dHRvblwiKS5jbGljaygpO1xuXG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoYmxvY2tlZC5hbnN3ZXIsIHsgZXhhY3Q6IHRydWUgfSkubGFzdCgpLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBwYWdlXG4gICAgICAubG9jYXRvcihcInN1bW1hcnlcIilcbiAgICAgIC5maWx0ZXIoeyBoYXNUZXh0OiBcIkFnZW50IGFjdGl2aXR5XCIgfSlcbiAgICAgIC5sYXN0KClcbiAgICAgIC5jbGljaygpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoXCJib2R5XCIpKS50b0NvbnRhaW5UZXh0KFwiUmVhZGluZyBzb3VyY2VcIik7XG4gICAgY29uc3QgdmlzaWJsZVRleHQgPSBhd2FpdCBwYWdlLmxvY2F0b3IoXCJib2R5XCIpLmlubmVyVGV4dCgpO1xuICAgIGV4cGVjdCh2aXNpYmxlVGV4dCkubm90LnRvTWF0Y2goXG4gICAgICAvcmF3UHJvbXB0fHN5c3RlbVByb21wdHxwcm92aWRlciBkaWFnbm9zdGljc3xzb3VyY2Utd2luZG93fHJlY292ZXJ5IHByb21wdHxcXC9ob21lXFwvcnVubmVyL2ksXG4gICAgKTtcbiAgfSk7XG5cbiAgdGVzdChcImtlZXBzIHNhZmUgY2l0YXRpb24gc3RhdGUgd2hlbiBzd2l0Y2hpbmcgcHJvamVjdHNcIiwgYXN5bmMgKHtcbiAgICBwYWdlLFxuICB9KSA9PiB7XG4gICAgY29uc3QgYWNjZXB0ZWQgPSBhd2FpdCBpbnN0YWxsQXJhYmljQWlGaXh0dXJlKHBhZ2UsIHtcbiAgICAgIHNlc3Npb25JZDogXCJlMmUtaGlzdG9yeS1hY2NlcHRlZC1zZXNzaW9uXCIsXG4gICAgICBxdWVzdGlvbjogXCLZhdinINmH2Ygg2LPZhNmI2YMg2YXZh9mE2KkgcHJvdmlkZXIg2LnZhtivINin2YTYsdis2YjYuSDYudio2LEg2LPYrNmEINin2YTZhdiq2LXZgdit2J9cIixcbiAgICB9KTtcbiAgICBjb25zdCBibG9ja2VkID0gYXdhaXQgaW5zdGFsbEFyYWJpY0FpRml4dHVyZShwYWdlLCB7XG4gICAgICBibG9ja2VkOiB0cnVlLFxuICAgICAgc2Vzc2lvbklkOiBcImUyZS1oaXN0b3J5LWJsb2NrZWQtc2Vzc2lvblwiLFxuICAgICAgcXVlc3Rpb246IFwi2YXYpyDZh9mIINin2YTYr9mE2YrZhCDYp9mE2YXYrdis2YjYqCDYudmG2K8g2KfZhNix2KzZiNi5INi52KjYsSDYs9is2YQg2KfZhNmF2KrYtdmB2K3Yn1wiLFxuICAgIH0pO1xuICAgIGF3YWl0IGluc3RhbGxBcGlGaXh0dXJlcyhwYWdlLCB7XG4gICAgICBhcmFiaWNBaTogYWNjZXB0ZWQsXG4gICAgICBhbHRlcm5hdGVBaTogYmxvY2tlZCxcbiAgICAgIHByb2plY3RzOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBpZDogXCJlMmUtcHJvamVjdC1vbmVcIixcbiAgICAgICAgICBuYW1lOiBcIkNpdGF0aW9uIFByb2plY3QgT25lXCIsXG4gICAgICAgICAgbGFuZ3VhZ2U6IFwiVHlwZVNjcmlwdFwiLFxuICAgICAgICAgIGZyYW1ld29yazogXCJSZWFjdFwiLFxuICAgICAgICAgIHN0YXR1czogXCJhY3RpdmVcIixcbiAgICAgICAgICByb290UGF0aDogXCIvY29udHJvbGxlZC9wcm9qZWN0LW9uZVwiLFxuICAgICAgICAgIHF1YWxpdHlTY29yZTogOTIsXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBpZDogXCJlMmUtcHJvamVjdC10d29cIixcbiAgICAgICAgICBuYW1lOiBcIkNpdGF0aW9uIFByb2plY3QgVHdvXCIsXG4gICAgICAgICAgbGFuZ3VhZ2U6IFwiVHlwZVNjcmlwdFwiLFxuICAgICAgICAgIGZyYW1ld29yazogXCJSZWFjdFwiLFxuICAgICAgICAgIHN0YXR1czogXCJhY3RpdmVcIixcbiAgICAgICAgICByb290UGF0aDogXCIvY29udHJvbGxlZC9wcm9qZWN0LXR3b1wiLFxuICAgICAgICAgIHF1YWxpdHlTY29yZTogODgsXG4gICAgICAgIH0sXG4gICAgICBdLFxuICAgIH0pO1xuICAgIGF3YWl0IHByb2dyYW1tYXRpY1NpZ25JbihwYWdlKTtcbiAgICBhd2FpdCBwYWdlLmdvdG8oYCR7REFTSEJPQVJEX1BBVEh9YWlgKTtcblxuICAgIGF3YWl0IHBhZ2VcbiAgICAgIC5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBhY2NlcHRlZC5xdWVzdGlvbiwgZXhhY3Q6IHRydWUgfSlcbiAgICAgIC5jbGljaygpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KGFjY2VwdGVkLmFuc3dlciwgeyBleGFjdDogdHJ1ZSB9KS5sYXN0KCksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KGAke2FjY2VwdGVkLnNvdXJjZX06NDJgLCB7IGV4YWN0OiBmYWxzZSB9KS5sYXN0KCksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiQWNjZXB0ZWQ6IHNvdXJjZSBzcGFuIHZlcmlmaWVkLlwiLCB7IGV4YWN0OiB0cnVlIH0pLmxhc3QoKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG5cbiAgICBhd2FpdCBwYWdlLmdldEJ5Um9sZShcImNvbWJvYm94XCIpLnNlbGVjdE9wdGlvbihcImUyZS1wcm9qZWN0LXR3b1wiKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IGJsb2NrZWQucXVlc3Rpb24sIGV4YWN0OiB0cnVlIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5nZXRCeVRleHQoYWNjZXB0ZWQuYW5zd2VyLCB7IGV4YWN0OiB0cnVlIH0pKS50b0hhdmVDb3VudChcbiAgICAgIDAsXG4gICAgKTtcbiAgICBhd2FpdCBwYWdlXG4gICAgICAuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogYmxvY2tlZC5xdWVzdGlvbiwgZXhhY3Q6IHRydWUgfSlcbiAgICAgIC5jbGljaygpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2VcbiAgICAgICAgLmdldEJ5VGV4dChcIkJsb2NrZWQ6IG5vIG1hdGNoaW5nIHNvdXJjZSB0ZXh0IHdhcyBmb3VuZC5cIiwge1xuICAgICAgICAgIGV4YWN0OiB0cnVlLFxuICAgICAgICB9KVxuICAgICAgICAubGFzdCgpLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChgJHtibG9ja2VkLnNvdXJjZX06NDJgLCB7IGV4YWN0OiBmYWxzZSB9KSxcbiAgICApLnRvSGF2ZUNvdW50KDApO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiQWNjZXB0ZWQ6IHNvdXJjZSBzcGFuIHZlcmlmaWVkLlwiLCB7IGV4YWN0OiB0cnVlIH0pLFxuICAgICkudG9IYXZlQ291bnQoMCk7XG5cbiAgICBhd2FpdCBwYWdlLmdldEJ5Um9sZShcImNvbWJvYm94XCIpLnNlbGVjdE9wdGlvbihcImUyZS1wcm9qZWN0LW9uZVwiKTtcbiAgICBhd2FpdCBwYWdlXG4gICAgICAuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogYWNjZXB0ZWQucXVlc3Rpb24sIGV4YWN0OiB0cnVlIH0pXG4gICAgICAuY2xpY2soKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChgJHthY2NlcHRlZC5zb3VyY2V9OjQyYCwgeyBleGFjdDogZmFsc2UgfSkubGFzdCgpLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcIkFjY2VwdGVkOiBzb3VyY2Ugc3BhbiB2ZXJpZmllZC5cIiwgeyBleGFjdDogdHJ1ZSB9KS5sYXN0KCksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiQmxvY2tlZDogbm8gbWF0Y2hpbmcgc291cmNlIHRleHQgd2FzIGZvdW5kLlwiLCB7XG4gICAgICAgIGV4YWN0OiB0cnVlLFxuICAgICAgfSksXG4gICAgKS50b0hhdmVDb3VudCgwKTtcblxuICAgIGNvbnN0IHZpc2libGVUZXh0ID0gYXdhaXQgcGFnZS5sb2NhdG9yKFwiYm9keVwiKS5pbm5lclRleHQoKTtcbiAgICBleHBlY3QodmlzaWJsZVRleHQpLm5vdC50b01hdGNoKFxuICAgICAgL3Jhd1Byb21wdHxzeXN0ZW1Qcm9tcHR8cHJvdmlkZXIgZGlhZ25vc3RpY3N8c291cmNlLXdpbmRvd3xyZWNvdmVyeSBwcm9tcHR8XFwvaG9tZVxcL3J1bm5lci9pLFxuICAgICk7XG4gIH0pO1xuXG4gIHRlc3QoXCJrZWVwcyBzYWZlIGNpdGF0aW9uIHN0YXRlIGFjcm9zcyByZXBlYXRlZCBuYXZpZ2F0aW9uXCIsIGFzeW5jICh7XG4gICAgcGFnZSxcbiAgfSkgPT4ge1xuICAgIGNvbnN0IGFjY2VwdGVkID0gYXdhaXQgaW5zdGFsbEFyYWJpY0FpRml4dHVyZShwYWdlLCB7XG4gICAgICBzZXNzaW9uSWQ6IFwiZTJlLWhpc3RvcnktYWNjZXB0ZWQtc2Vzc2lvblwiLFxuICAgICAgcXVlc3Rpb246IFwi2YXYpyDZh9mIINiz2YTZiNmDINmF2YfZhNipIHByb3ZpZGVyINi52YbYryDYp9mE2LHYrNmI2Lkg2LnYqNixINiz2KzZhCDYp9mE2YXYqti12YHYrdifXCIsXG4gICAgfSk7XG4gICAgY29uc3QgYmxvY2tlZCA9IGF3YWl0IGluc3RhbGxBcmFiaWNBaUZpeHR1cmUocGFnZSwge1xuICAgICAgYmxvY2tlZDogdHJ1ZSxcbiAgICAgIHNlc3Npb25JZDogXCJlMmUtaGlzdG9yeS1ibG9ja2VkLXNlc3Npb25cIixcbiAgICAgIHF1ZXN0aW9uOiBcItmF2Kcg2YfZiCDYp9mE2K/ZhNmK2YQg2KfZhNmF2K3YrNmI2Kgg2LnZhtivINin2YTYsdis2YjYuSDYudio2LEg2LPYrNmEINin2YTZhdiq2LXZgdit2J9cIixcbiAgICB9KTtcbiAgICBhd2FpdCBpbnN0YWxsQXBpRml4dHVyZXMocGFnZSwge1xuICAgICAgYXJhYmljQWk6IGFjY2VwdGVkLFxuICAgICAgYWx0ZXJuYXRlQWk6IGJsb2NrZWQsXG4gICAgfSk7XG4gICAgYXdhaXQgcHJvZ3JhbW1hdGljU2lnbkluKHBhZ2UpO1xuICAgIGF3YWl0IHBhZ2UuZ290byhgJHtEQVNIQk9BUkRfUEFUSH1haWApO1xuXG4gICAgY29uc3QgYXNzZXJ0QWNjZXB0ZWRDaXRhdGlvbiA9IGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IGV4cGVjdChcbiAgICAgICAgcGFnZS5nZXRCeVRleHQoYWNjZXB0ZWQuYW5zd2VyLCB7IGV4YWN0OiB0cnVlIH0pLmxhc3QoKSxcbiAgICAgICkudG9CZVZpc2libGUoKTtcbiAgICAgIGF3YWl0IGV4cGVjdChcbiAgICAgICAgcGFnZS5nZXRCeVRleHQoYCR7YWNjZXB0ZWQuc291cmNlfTo0MmAsIHsgZXhhY3Q6IGZhbHNlIH0pLmxhc3QoKSxcbiAgICAgICkudG9CZVZpc2libGUoKTtcbiAgICAgIGF3YWl0IGV4cGVjdChcbiAgICAgICAgcGFnZVxuICAgICAgICAgIC5nZXRCeVRleHQoXCJBY2NlcHRlZDogc291cmNlIHNwYW4gdmVyaWZpZWQuXCIsIHsgZXhhY3Q6IHRydWUgfSlcbiAgICAgICAgICAubGFzdCgpLFxuICAgICAgKS50b0JlVmlzaWJsZSgpO1xuICAgICAgYXdhaXQgZXhwZWN0KFxuICAgICAgICBwYWdlLmdldEJ5VGV4dChcIkJsb2NrZWQ6IG5vIG1hdGNoaW5nIHNvdXJjZSB0ZXh0IHdhcyBmb3VuZC5cIiwge1xuICAgICAgICAgIGV4YWN0OiB0cnVlLFxuICAgICAgICB9KSxcbiAgICAgICkudG9IYXZlQ291bnQoMCk7XG4gICAgfTtcbiAgICBjb25zdCBhc3NlcnRCbG9ja2VkQ2l0YXRpb24gPSBhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCBleHBlY3QoXG4gICAgICAgIHBhZ2VcbiAgICAgICAgICAuZ2V0QnlUZXh0KFwiQmxvY2tlZDogbm8gbWF0Y2hpbmcgc291cmNlIHRleHQgd2FzIGZvdW5kLlwiLCB7XG4gICAgICAgICAgICBleGFjdDogdHJ1ZSxcbiAgICAgICAgICB9KVxuICAgICAgICAgIC5sYXN0KCksXG4gICAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgICBhd2FpdCBleHBlY3QoXG4gICAgICAgIHBhZ2UuZ2V0QnlUZXh0KGAke2Jsb2NrZWQuc291cmNlfTo0MmAsIHsgZXhhY3Q6IGZhbHNlIH0pLFxuICAgICAgKS50b0hhdmVDb3VudCgwKTtcbiAgICAgIGF3YWl0IGV4cGVjdChcbiAgICAgICAgcGFnZS5nZXRCeVRleHQoXCJBY2NlcHRlZDogc291cmNlIHNwYW4gdmVyaWZpZWQuXCIsIHsgZXhhY3Q6IHRydWUgfSksXG4gICAgICApLnRvSGF2ZUNvdW50KDApO1xuICAgIH07XG4gICAgY29uc3QgYXNzZXJ0Tm9JbnRlcm5hbENpdGF0aW9uRGV0YWlscyA9IGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHZpc2libGVUZXh0ID0gYXdhaXQgcGFnZS5sb2NhdG9yKFwiYm9keVwiKS5pbm5lclRleHQoKTtcbiAgICAgIGV4cGVjdCh2aXNpYmxlVGV4dCkubm90LnRvTWF0Y2goXG4gICAgICAgIC9NSVNTSU5HX0xJVEVSQUxfTUFUQ0h8cmF3UHJvbXB0fHN5c3RlbVByb21wdHxwcm92aWRlciBkaWFnbm9zdGljc3xzb3VyY2Utd2luZG93fHJlY292ZXJ5IHByb21wdHxcXC9ob21lXFwvcnVubmVyL2ksXG4gICAgICApO1xuICAgIH07XG5cbiAgICBhd2FpdCBwYWdlXG4gICAgICAuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogYWNjZXB0ZWQucXVlc3Rpb24sIGV4YWN0OiB0cnVlIH0pXG4gICAgICAuY2xpY2soKTtcbiAgICBhd2FpdCBhc3NlcnRBY2NlcHRlZENpdGF0aW9uKCk7XG5cbiAgICBhd2FpdCBvcGVuTmF2aWdhdGlvbihwYWdlLCBcIlByb2plY3RzXCIsIGAke0RBU0hCT0FSRF9QQVRIfXByb2plY3RzYCk7XG4gICAgYXdhaXQgcGFnZS5nb0JhY2soKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZSkudG9IYXZlVVJMKFxuICAgICAgbmV3IFJlZ0V4cChgJHtEQVNIQk9BUkRfUEFUSC5yZXBsYWNlQWxsKFwiL1wiLCBcIlxcXFwvXCIpfWFpJGApLFxuICAgICk7XG4gICAgYXdhaXQgcGFnZVxuICAgICAgLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IGFjY2VwdGVkLnF1ZXN0aW9uLCBleGFjdDogdHJ1ZSB9KVxuICAgICAgLmNsaWNrKCk7XG4gICAgYXdhaXQgYXNzZXJ0QWNjZXB0ZWRDaXRhdGlvbigpO1xuICAgIGF3YWl0IGFzc2VydE5vSW50ZXJuYWxDaXRhdGlvbkRldGFpbHMoKTtcblxuICAgIGF3YWl0IHBhZ2UuZ29Gb3J3YXJkKCk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UpLnRvSGF2ZVVSTChcbiAgICAgIG5ldyBSZWdFeHAoYCR7REFTSEJPQVJEX1BBVEgucmVwbGFjZUFsbChcIi9cIiwgXCJcXFxcL1wiKX1wcm9qZWN0cyRgKSxcbiAgICApO1xuICAgIGF3YWl0IHBhZ2UuZ29CYWNrKCk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UpLnRvSGF2ZVVSTChcbiAgICAgIG5ldyBSZWdFeHAoYCR7REFTSEJPQVJEX1BBVEgucmVwbGFjZUFsbChcIi9cIiwgXCJcXFxcL1wiKX1haSRgKSxcbiAgICApO1xuICAgIGF3YWl0IHBhZ2VcbiAgICAgIC5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBhY2NlcHRlZC5xdWVzdGlvbiwgZXhhY3Q6IHRydWUgfSlcbiAgICAgIC5jbGljaygpO1xuICAgIGF3YWl0IGFzc2VydEFjY2VwdGVkQ2l0YXRpb24oKTtcblxuICAgIGF3YWl0IHBhZ2VcbiAgICAgIC5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBibG9ja2VkLnF1ZXN0aW9uLCBleGFjdDogdHJ1ZSB9KVxuICAgICAgLmNsaWNrKCk7XG4gICAgYXdhaXQgYXNzZXJ0QmxvY2tlZENpdGF0aW9uKCk7XG5cbiAgICBhd2FpdCBvcGVuTmF2aWdhdGlvbihwYWdlLCBcIkV2ZW50IFN0cmVhbVwiLCBgJHtEQVNIQk9BUkRfUEFUSH1ldmVudHNgKTtcbiAgICBhd2FpdCBwYWdlLmdvQmFjaygpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlKS50b0hhdmVVUkwoXG4gICAgICBuZXcgUmVnRXhwKGAke0RBU0hCT0FSRF9QQVRILnJlcGxhY2VBbGwoXCIvXCIsIFwiXFxcXC9cIil9YWkkYCksXG4gICAgKTtcbiAgICBhd2FpdCBwYWdlXG4gICAgICAuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogYmxvY2tlZC5xdWVzdGlvbiwgZXhhY3Q6IHRydWUgfSlcbiAgICAgIC5jbGljaygpO1xuICAgIGF3YWl0IGFzc2VydEJsb2NrZWRDaXRhdGlvbigpO1xuICAgIGF3YWl0IGFzc2VydE5vSW50ZXJuYWxDaXRhdGlvbkRldGFpbHMoKTtcblxuICAgIGF3YWl0IHBhZ2UuZ29Gb3J3YXJkKCk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UpLnRvSGF2ZVVSTChcbiAgICAgIG5ldyBSZWdFeHAoYCR7REFTSEJPQVJEX1BBVEgucmVwbGFjZUFsbChcIi9cIiwgXCJcXFxcL1wiKX1ldmVudHMkYCksXG4gICAgKTtcbiAgICBhd2FpdCBwYWdlLmdvQmFjaygpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlKS50b0hhdmVVUkwoXG4gICAgICBuZXcgUmVnRXhwKGAke0RBU0hCT0FSRF9QQVRILnJlcGxhY2VBbGwoXCIvXCIsIFwiXFxcXC9cIil9YWkkYCksXG4gICAgKTtcbiAgICBhd2FpdCBwYWdlXG4gICAgICAuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogYmxvY2tlZC5xdWVzdGlvbiwgZXhhY3Q6IHRydWUgfSlcbiAgICAgIC5jbGljaygpO1xuICAgIGF3YWl0IGFzc2VydEJsb2NrZWRDaXRhdGlvbigpO1xuICAgIGF3YWl0IGFzc2VydE5vSW50ZXJuYWxDaXRhdGlvbkRldGFpbHMoKTtcbiAgfSk7XG5cbiAgdGVzdChcImtlZXBzIG9ubHkgdGhlIHNhZmUgYmxvY2tlZCBjaXRhdGlvbiByZWFzb24gYWZ0ZXIgY2hhdCByZWxvYWRcIiwgYXN5bmMgKHtcbiAgICBwYWdlLFxuICB9KSA9PiB7XG4gICAgY29uc3QgZml4dHVyZSA9IGluc3RhbGxUb29sRmFpbHVyZUZpeHR1cmUoKTtcbiAgICBhd2FpdCBpbnN0YWxsQXBpRml4dHVyZXMocGFnZSwgeyBhcmFiaWNBaTogZml4dHVyZSB9KTtcbiAgICBhd2FpdCBwcm9ncmFtbWF0aWNTaWduSW4ocGFnZSk7XG4gICAgYXdhaXQgcGFnZS5nb3RvKGAke0RBU0hCT0FSRF9QQVRIfWFpYCk7XG5cbiAgICBjb25zdCBjb21wb3NlciA9IHBhZ2UubG9jYXRvcihcInRleHRhcmVhXCIpLmZpcnN0KCk7XG4gICAgYXdhaXQgY29tcG9zZXIuZmlsbChmaXh0dXJlLnF1ZXN0aW9uKTtcbiAgICBhd2FpdCBjb21wb3Nlci5sb2NhdG9yKFwieHBhdGg9Li5cIikuZ2V0QnlSb2xlKFwiYnV0dG9uXCIpLmNsaWNrKCk7XG5cbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChmaXh0dXJlLmFuc3dlciwgeyBleGFjdDogdHJ1ZSB9KS5sYXN0KCksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2VcbiAgICAgICAgLmdldEJ5VGV4dChcInJlcXVpcmVkIHRvb2wgZGlkIG5vdCBjb21wbGV0ZSDigJQgQkxPQ0tFRC9JTkNPTVBMRVRFXCIsIHtcbiAgICAgICAgICBleGFjdDogZmFsc2UsXG4gICAgICAgIH0pXG4gICAgICAgIC5sYXN0KCksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IHBhZ2VcbiAgICAgIC5sb2NhdG9yKFwic3VtbWFyeVwiKVxuICAgICAgLmZpbHRlcih7IGhhc1RleHQ6IFwiQWdlbnQgYWN0aXZpdHlcIiB9KVxuICAgICAgLmxhc3QoKVxuICAgICAgLmNsaWNrKCk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcihcImJvZHlcIikpLnRvQ29udGFpblRleHQoXCJSZWFkaW5nIHNvdXJjZVwiKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKFwiYm9keVwiKSkudG9Db250YWluVGV4dChcbiAgICAgIFwic3JjL21pc3NpbmctcmVsZWFzZS1maXh0dXJlLnRzXCIsXG4gICAgKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKFwiYm9keVwiKSkudG9Db250YWluVGV4dChcIlRvb2wgZmFpbGVkXCIpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoXCJib2R5XCIpKS50b0NvbnRhaW5UZXh0KFwiVE9PTF9FWEVDVVRJT05fRkFJTEVEXCIpO1xuICAgIGNvbnN0IHZpc2libGVUZXh0ID0gYXdhaXQgcGFnZS5sb2NhdG9yKFwiYm9keVwiKS5pbm5lclRleHQoKTtcbiAgICBleHBlY3QodmlzaWJsZVRleHQpLm5vdC50b0NvbnRhaW4oXCJDT01QTEVURURcIik7XG4gICAgZXhwZWN0KHZpc2libGVUZXh0KS50b0NvbnRhaW4oXCJQZXJzaXN0ZWQgZXhlY3V0aW9uIHByb29mXCIpO1xuICAgIGV4cGVjdCh2aXNpYmxlVGV4dCkudG9Db250YWluKFwiVGhlIHJlcXVpcmVkIHNvdXJjZSByZWFkIGRpZCBub3QgY29tcGxldGUuXCIpO1xuICB9KTtcblxuICB0ZXN0KFwia2VlcHMgdGhlIGZhaWxlZCBBSSBzZXNzaW9uIGRyYXdlciBvdmVybGFpZCBvbiBhIHBob25lIHZpZXdwb3J0XCIsIGFzeW5jICh7XG4gICAgcGFnZSxcbiAgfSkgPT4ge1xuICAgIGF3YWl0IHBhZ2Uuc2V0Vmlld3BvcnRTaXplKHsgd2lkdGg6IDM5MCwgaGVpZ2h0OiA4NDQgfSk7XG4gICAgY29uc3QgZml4dHVyZSA9IGluc3RhbGxUb29sRmFpbHVyZUZpeHR1cmUoKTtcbiAgICBhd2FpdCBpbnN0YWxsQXBpRml4dHVyZXMocGFnZSwgeyBhcmFiaWNBaTogZml4dHVyZSB9KTtcbiAgICBhd2FpdCBwcm9ncmFtbWF0aWNTaWduSW4ocGFnZSk7XG4gICAgYXdhaXQgcGFnZS5nb3RvKGAke0RBU0hCT0FSRF9QQVRIfWFpYCk7XG5cbiAgICBjb25zdCBjb21wb3NlciA9IHBhZ2UubG9jYXRvcihcInRleHRhcmVhXCIpLmZpcnN0KCk7XG4gICAgYXdhaXQgY29tcG9zZXIuZmlsbChmaXh0dXJlLnF1ZXN0aW9uKTtcbiAgICBhd2FpdCBjb21wb3Nlci5sb2NhdG9yKFwieHBhdGg9Li5cIikuZ2V0QnlSb2xlKFwiYnV0dG9uXCIpLmNsaWNrKCk7XG5cbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChmaXh0dXJlLmFuc3dlciwgeyBleGFjdDogdHJ1ZSB9KS5sYXN0KCksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2VcbiAgICAgICAgLmdldEJ5VGV4dChcInJlcXVpcmVkIHRvb2wgZGlkIG5vdCBjb21wbGV0ZSDigJQgQkxPQ0tFRC9JTkNPTVBMRVRFXCIsIHtcbiAgICAgICAgICBleGFjdDogZmFsc2UsXG4gICAgICAgIH0pXG4gICAgICAgIC5sYXN0KCksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IHBhZ2VcbiAgICAgIC5sb2NhdG9yKFwic3VtbWFyeVwiKVxuICAgICAgLmZpbHRlcih7IGhhc1RleHQ6IFwiQWdlbnQgYWN0aXZpdHlcIiB9KVxuICAgICAgLmxhc3QoKVxuICAgICAgLmNsaWNrKCk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcihcImJvZHlcIikpLnRvQ29udGFpblRleHQoXCJSZWFkaW5nIHNvdXJjZVwiKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKFwiYm9keVwiKSkudG9Db250YWluVGV4dChcbiAgICAgIFwic3JjL21pc3NpbmctcmVsZWFzZS1maXh0dXJlLnRzXCIsXG4gICAgKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKFwiYm9keVwiKSkudG9Db250YWluVGV4dChcIlRvb2wgZmFpbGVkXCIpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoXCJib2R5XCIpKS50b0NvbnRhaW5UZXh0KFwiVE9PTF9FWEVDVVRJT05fRkFJTEVEXCIpO1xuICAgIGNvbnN0IHZpc2libGVUZXh0ID0gYXdhaXQgcGFnZS5sb2NhdG9yKFwiYm9keVwiKS5pbm5lclRleHQoKTtcbiAgICBleHBlY3QodmlzaWJsZVRleHQpLm5vdC50b01hdGNoKFxuICAgICAgL3JhdyBleGNlcHRpb258c3RhY2sgdHJhY2V8XFwvaG9tZVxcL3J1bm5lcnxzZWNyZXR8Zml4dHVyZSBkaWFnbm9zdGljL2ksXG4gICAgKTtcblxuICAgIGF3YWl0IGV4cGVjdE5vSG9yaXpvbnRhbE92ZXJmbG93KHBhZ2UpO1xuICB9KTtcblxuICB0ZXN0KFwicHJlc2VydmVzIG9uZSBwYXJ0aWFsIGFuc3dlciBhZnRlciBhIHByb3ZpZGVyIGRpc2Nvbm5lY3QgYW5kIG1hcmtzIGl0IGluY29tcGxldGVcIiwgYXN5bmMgKHtcbiAgICBwYWdlLFxuICB9KSA9PiB7XG4gICAgY29uc3QgZml4dHVyZSA9IGluc3RhbGxEaXNjb25uZWN0ZWRBaUZpeHR1cmUoKTtcbiAgICBhd2FpdCBpbnN0YWxsQXBpRml4dHVyZXMocGFnZSwgeyBkaXNjb25uZWN0QWk6IGZpeHR1cmUgfSk7XG4gICAgYXdhaXQgcHJvZ3JhbW1hdGljU2lnbkluKHBhZ2UpO1xuICAgIGF3YWl0IHBhZ2UuZ290byhgJHtEQVNIQk9BUkRfUEFUSH1haWApO1xuXG4gICAgY29uc3QgY29tcG9zZXIgPSBwYWdlLmxvY2F0b3IoXCJ0ZXh0YXJlYVwiKS5maXJzdCgpO1xuICAgIGF3YWl0IGNvbXBvc2VyLmZpbGwoZml4dHVyZS5xdWVzdGlvbik7XG4gICAgYXdhaXQgY29tcG9zZXIubG9jYXRvcihcInhwYXRoPS4uXCIpLmdldEJ5Um9sZShcImJ1dHRvblwiKS5jbGljaygpO1xuXG4gICAgY29uc3QgYW5zd2VyID0gcGFnZS5nZXRCeVRleHQoZml4dHVyZS5hbnN3ZXIsIHsgZXhhY3Q6IHRydWUgfSk7XG4gICAgYXdhaXQgZXhwZWN0KGFuc3dlci5sYXN0KCkpLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlUZXh0KFwiSU5DT01QTEVURTpcIiwgeyBleGFjdDogZmFsc2UgfSkpLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXCJwcm92aWRlciBmYWlsdXJlXCIsIHsgZXhhY3Q6IGZhbHNlIH0pLmxhc3QoKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXCJzdG9wcGVkOiBwcm92aWRlciB0aW1lb3V0XCIsIHsgZXhhY3Q6IGZhbHNlIH0pLmxhc3QoKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXCJUaGUgcHJvdmlkZXIgZGlzY29ubmVjdGVkIGFmdGVyIHZpc2libGUgcmVzcG9uc2UgdGV4dC5cIiwge1xuICAgICAgICBleGFjdDogdHJ1ZSxcbiAgICAgIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcblxuICAgIGF3YWl0IHBhZ2UucmVsb2FkKCk7XG4gICAgYXdhaXQgcGFnZVxuICAgICAgLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IGZpeHR1cmUucXVlc3Rpb24sIGV4YWN0OiB0cnVlIH0pXG4gICAgICAuY2xpY2soKTtcblxuICAgIGF3YWl0IGV4cGVjdChwYWdlLmdldEJ5VGV4dChmaXh0dXJlLmFuc3dlciwgeyBleGFjdDogdHJ1ZSB9KS5sYXN0KCkpLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlUZXh0KFwiSU5DT01QTEVURTpcIiwgeyBleGFjdDogZmFsc2UgfSkpLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXCJwcm92aWRlciBmYWlsdXJlXCIsIHsgZXhhY3Q6IGZhbHNlIH0pLmxhc3QoKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXCJzdG9wcGVkOiBwcm92aWRlciB0aW1lb3V0XCIsIHsgZXhhY3Q6IGZhbHNlIH0pLmxhc3QoKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXCJUaGUgcHJvdmlkZXIgZGlzY29ubmVjdGVkIGFmdGVyIHZpc2libGUgcmVzcG9uc2UgdGV4dC5cIiwge1xuICAgICAgICBleGFjdDogdHJ1ZSxcbiAgICAgIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgfSk7XG5cbiAgdGVzdChcInJlc3VtZXMgYSBmYWlsZWQgYW5hbHlzaXMgYW5kIGtlZXBzIHRoZSBleGVjdXRpb24gaW5jb21wbGV0ZVwiLCBhc3luYyAoe1xuICAgIHBhZ2UsXG4gIH0pID0+IHtcbiAgICBjb25zdCB7IGZpeHR1cmUsIGV4ZWN1dGlvbiB9ID0gaW5zdGFsbFJlc3VtZWRBbmFseXNpc0ZhaWx1cmVGaXh0dXJlKCk7XG4gICAgYXdhaXQgaW5zdGFsbEFwaUZpeHR1cmVzKHBhZ2UsIHtcbiAgICAgIGFyYWJpY0FpOiBmaXh0dXJlLFxuICAgICAgcmVzdW1lRmFpbHVyZTogeyBmaXh0dXJlLCBleGVjdXRpb24gfSxcbiAgICB9KTtcbiAgICBhd2FpdCBwcm9ncmFtbWF0aWNTaWduSW4ocGFnZSk7XG5cbiAgICBhd2FpdCBwYWdlLmV2YWx1YXRlKFxuICAgICAgKHsgc2Vzc2lvbklkLCBleGVjdXRpb25JZCwgcHJvamVjdElkLCByZXN1bWVUb2tlbiwgbWVzc2FnZSB9KSA9PiB7XG4gICAgICAgIGxvY2FsU3RvcmFnZS5zZXRJdGVtKFxuICAgICAgICAgIGBlb3NfYWlfZXhlY3V0aW9uX2N1cnJlbnRfJHtwcm9qZWN0SWR9YCxcbiAgICAgICAgICBzZXNzaW9uSWQsXG4gICAgICAgICk7XG4gICAgICAgIGxvY2FsU3RvcmFnZS5zZXRJdGVtKFxuICAgICAgICAgIGBlb3NfYWlfZXhlY3V0aW9uXyR7cHJvamVjdElkfV8ke3Nlc3Npb25JZH1gLFxuICAgICAgICAgIEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgICAgIGlkOiBleGVjdXRpb25JZCxcbiAgICAgICAgICAgIHByb2plY3RJZCxcbiAgICAgICAgICAgIHNlc3Npb25JZCxcbiAgICAgICAgICAgIHJlc3VtZVRva2VuLFxuICAgICAgICAgICAgbWVzc2FnZSxcbiAgICAgICAgICB9KSxcbiAgICAgICAgKTtcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIHNlc3Npb25JZDogZml4dHVyZS5zZXNzaW9uSWQsXG4gICAgICAgIGV4ZWN1dGlvbklkOiBmaXh0dXJlLmV4ZWN1dGlvbklkLFxuICAgICAgICBwcm9qZWN0SWQ6IFwiZTJlLXByb2plY3RcIixcbiAgICAgICAgcmVzdW1lVG9rZW46IFwiZTJlLXJlc3VtZWQtYW5hbHlzaXMtZmFpbHVyZS10b2tlbi1vcGFxdWVcIixcbiAgICAgICAgbWVzc2FnZTogZml4dHVyZS5xdWVzdGlvbixcbiAgICAgIH0sXG4gICAgKTtcbiAgICBhd2FpdCBwYWdlLmdvdG8oYCR7REFTSEJPQVJEX1BBVEh9YWlgKTtcblxuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiQSBzYXZlZCBBSSBleGVjdXRpb24gaXMgcmVhZHkgdG8gcmVzdW1lXCIpLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBjb25zdCByZXN1bWVSZXF1ZXN0ID0gcGFnZS53YWl0Rm9yUmVxdWVzdChcbiAgICAgIChyZXF1ZXN0KSA9PlxuICAgICAgICByZXF1ZXN0LnVybCgpLmluY2x1ZGVzKFwiL2FwaS9haS9jaGF0L3N0cmVhbVwiKSAmJlxuICAgICAgICByZXF1ZXN0Lm1ldGhvZCgpID09PSBcIlBPU1RcIixcbiAgICApO1xuICAgIGF3YWl0IHBhZ2VcbiAgICAgIC5nZXRCeUxhYmVsKFwiQWdlbnQgZXhlY3V0aW9uIHByb29mXCIpXG4gICAgICAuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJSZXN1bWVcIiwgZXhhY3Q6IHRydWUgfSlcbiAgICAgIC5jbGljaygpO1xuICAgIGNvbnN0IHJlcXVlc3RCb2R5ID0gSlNPTi5wYXJzZShcbiAgICAgIChhd2FpdCByZXN1bWVSZXF1ZXN0KS5wb3N0RGF0YSgpID8/IFwie31cIixcbiAgICApIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAgIGV4cGVjdChyZXF1ZXN0Qm9keSkudG9FcXVhbChcbiAgICAgIGV4cGVjdC5vYmplY3RDb250YWluaW5nKHtcbiAgICAgICAgcHJvamVjdElkOiBcImUyZS1wcm9qZWN0XCIsXG4gICAgICAgIHNlc3Npb25JZDogZml4dHVyZS5zZXNzaW9uSWQsXG4gICAgICAgIGV4ZWN1dGlvbklkOiBmaXh0dXJlLmV4ZWN1dGlvbklkLFxuICAgICAgICByZXN1bWVUb2tlbjogXCJlMmUtcmVzdW1lZC1hbmFseXNpcy1mYWlsdXJlLXRva2VuLW9wYXF1ZVwiLFxuICAgICAgICBtZXNzYWdlOiBmaXh0dXJlLnF1ZXN0aW9uLFxuICAgICAgfSksXG4gICAgKTtcblxuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiRmFpbGVkIHRvIHNlbmQgbWVzc2FnZVwiLCB7IGV4YWN0OiB0cnVlIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcIkEgc2F2ZWQgQUkgZXhlY3V0aW9uIGlzIHJlYWR5IHRvIHJlc3VtZVwiKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgY29uc3QgdmlzaWJsZVRleHQgPSBhd2FpdCBwYWdlLmxvY2F0b3IoXCJib2R5XCIpLmlubmVyVGV4dCgpO1xuICAgIGV4cGVjdCh2aXNpYmxlVGV4dCkubm90LnRvQ29udGFpbihcIkNPTVBMRVRFRFwiKTtcbiAgICBleHBlY3QodmlzaWJsZVRleHQpLm5vdC50b0NvbnRhaW4oXCJQZXJzaXN0ZWQgZXhlY3V0aW9uIHByb29mXCIpO1xuICAgIGV4cGVjdCh2aXNpYmxlVGV4dCkudG9Db250YWluKFwiVGhlIHJlcXVpcmVkIGFuYWx5c2lzIGRpZCBub3QgY29tcGxldGUuXCIpO1xuICB9KTtcblxuICB0ZXN0KFwicmVjb3ZlcnMgYSBtaXNzaW5nIHRva2VuIGFmdGVyIGEgcmVhbCBzdHJlYW0gYWJvcnQgYW5kIHJlc3VtZXMgb25lIGV4ZWN1dGlvblwiLCBhc3luYyAoe1xuICAgIHBhZ2UsXG4gIH0pID0+IHtcbiAgICBjb25zdCByZWNvdmVyeSA9IGluc3RhbGxJbnRlcnJ1cHRlZFJlc3VtZUZpeHR1cmUoKTtcbiAgICBhd2FpdCBpbnN0YWxsQXBpRml4dHVyZXMocGFnZSwgeyBpbnRlcnJ1cHRlZFJlc3VtZTogcmVjb3ZlcnkgfSk7XG4gICAgYXdhaXQgcGFnZS5hZGRJbml0U2NyaXB0KCgpID0+IHtcbiAgICAgIGNvbnN0IG5hdGl2ZUZldGNoID0gd2luZG93LmZldGNoLmJpbmQod2luZG93KTtcbiAgICAgIHdpbmRvdy5mZXRjaCA9IGFzeW5jIChpbnB1dCwgaW5pdCkgPT4ge1xuICAgICAgICBjb25zdCB1cmwgPVxuICAgICAgICAgIHR5cGVvZiBpbnB1dCA9PT0gXCJzdHJpbmdcIlxuICAgICAgICAgICAgPyBpbnB1dFxuICAgICAgICAgICAgOiBpbnB1dCBpbnN0YW5jZW9mIFJlcXVlc3RcbiAgICAgICAgICAgICAgPyBpbnB1dC51cmxcbiAgICAgICAgICAgICAgOiBTdHJpbmcoaW5wdXQpO1xuICAgICAgICBjb25zdCBib2R5ID0gdHlwZW9mIGluaXQ/LmJvZHkgPT09IFwic3RyaW5nXCIgPyBpbml0LmJvZHkgOiBcIlwiO1xuICAgICAgICBpZiAoXG4gICAgICAgICAgIXVybC5pbmNsdWRlcyhcIi9hcGkvYWkvY2hhdC9zdHJlYW1cIikgfHxcbiAgICAgICAgICBib2R5LmluY2x1ZGVzKCdcImV4ZWN1dGlvbklkXCInKVxuICAgICAgICApIHtcbiAgICAgICAgICByZXR1cm4gbmF0aXZlRmV0Y2goaW5wdXQsIGluaXQpO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBuYXRpdmVGZXRjaChpbnB1dCwgaW5pdCk7XG4gICAgICAgIGlmICghcmVzcG9uc2UuYm9keSkgcmV0dXJuIHJlc3BvbnNlO1xuICAgICAgICBjb25zdCByZWFkZXIgPSByZXNwb25zZS5ib2R5LmdldFJlYWRlcigpO1xuICAgICAgICBjb25zdCBlbmNvZGVyID0gbmV3IFRleHRFbmNvZGVyKCk7XG4gICAgICAgIGNvbnN0IHN0cmVhbSA9IG5ldyBSZWFkYWJsZVN0cmVhbSh7XG4gICAgICAgICAgYXN5bmMgc3RhcnQoY29udHJvbGxlcikge1xuICAgICAgICAgICAgbGV0IGJ1ZmZlcmVkID0gXCJcIjtcbiAgICAgICAgICAgIHdoaWxlICh0cnVlKSB7XG4gICAgICAgICAgICAgIGNvbnN0IHsgZG9uZSwgdmFsdWUgfSA9IGF3YWl0IHJlYWRlci5yZWFkKCk7XG4gICAgICAgICAgICAgIGlmIChkb25lKSB7XG4gICAgICAgICAgICAgICAgaWYgKGJ1ZmZlcmVkKSBjb250cm9sbGVyLmVucXVldWUoZW5jb2Rlci5lbmNvZGUoYnVmZmVyZWQpKTtcbiAgICAgICAgICAgICAgICBjb250cm9sbGVyLmNsb3NlKCk7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIGJ1ZmZlcmVkICs9IG5ldyBUZXh0RGVjb2RlcigpLmRlY29kZSh2YWx1ZSwgeyBzdHJlYW06IHRydWUgfSk7XG4gICAgICAgICAgICAgIGNvbnN0IG1hcmtlciA9IGJ1ZmZlcmVkLmluZGV4T2YoJ1widHlwZVwiOlwiZXhlY3V0aW9uX3N0YXJ0ZWRcIicpO1xuICAgICAgICAgICAgICBjb25zdCBmcmFtZUVuZCA9XG4gICAgICAgICAgICAgICAgbWFya2VyIDwgMCA/IC0xIDogYnVmZmVyZWQuaW5kZXhPZihcIlxcblxcblwiLCBtYXJrZXIpO1xuICAgICAgICAgICAgICBpZiAoZnJhbWVFbmQgPj0gMCkge1xuICAgICAgICAgICAgICAgIGNvbnRyb2xsZXIuZW5xdWV1ZShcbiAgICAgICAgICAgICAgICAgIGVuY29kZXIuZW5jb2RlKGJ1ZmZlcmVkLnNsaWNlKDAsIGZyYW1lRW5kICsgMikpLFxuICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgICAgY29udHJvbGxlci5lcnJvcihuZXcgVHlwZUVycm9yKFwibmV0d29yayBjb25uZWN0aW9uIHJlc2V0XCIpKTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9LFxuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuIG5ldyBSZXNwb25zZShzdHJlYW0sIHtcbiAgICAgICAgICBzdGF0dXM6IHJlc3BvbnNlLnN0YXR1cyxcbiAgICAgICAgICBzdGF0dXNUZXh0OiByZXNwb25zZS5zdGF0dXNUZXh0LFxuICAgICAgICAgIGhlYWRlcnM6IHJlc3BvbnNlLmhlYWRlcnMsXG4gICAgICAgIH0pO1xuICAgICAgfTtcbiAgICB9KTtcbiAgICBhd2FpdCBwcm9ncmFtbWF0aWNTaWduSW4ocGFnZSk7XG4gICAgYXdhaXQgcGFnZS5nb3RvKGAke0RBU0hCT0FSRF9QQVRIfWFpYCk7XG5cbiAgICBjb25zdCBzdHJlYW1SZXF1ZXN0czogQXJyYXk8UmVjb3JkPHN0cmluZywgdW5rbm93bj4+ID0gW107XG4gICAgcGFnZS5vbihcInJlcXVlc3RcIiwgKHJlcXVlc3QpID0+IHtcbiAgICAgIGlmIChcbiAgICAgICAgcmVxdWVzdC51cmwoKS5pbmNsdWRlcyhcIi9hcGkvYWkvY2hhdC9zdHJlYW1cIikgJiZcbiAgICAgICAgcmVxdWVzdC5tZXRob2QoKSA9PT0gXCJQT1NUXCJcbiAgICAgICkge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIHN0cmVhbVJlcXVlc3RzLnB1c2goXG4gICAgICAgICAgICByZXF1ZXN0LnBvc3REYXRhSlNPTigpIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+LFxuICAgICAgICAgICk7XG4gICAgICAgIH0gY2F0Y2gge1xuICAgICAgICAgIC8vIElnbm9yZSByZXF1ZXN0cyB3aXRob3V0IGEgSlNPTiBib2R5OyB0aGUgYXNzZXJ0aW9ucyBiZWxvdyByZXF1aXJlXG4gICAgICAgICAgLy8gYm90aCBqb3VybmV5IHJlcXVlc3RzIHRvIGhhdmUgYSB2YWxpZCByZXF1ZXN0IGVudmVsb3BlLlxuICAgICAgICB9XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICBjb25zdCBjb21wb3NlciA9IHBhZ2UubG9jYXRvcihcInRleHRhcmVhXCIpLmZpcnN0KCk7XG4gICAgYXdhaXQgY29tcG9zZXIuZmlsbChyZWNvdmVyeS5maXh0dXJlLnF1ZXN0aW9uKTtcbiAgICBhd2FpdCBjb21wb3Nlci5sb2NhdG9yKFwieHBhdGg9Li5cIikuZ2V0QnlSb2xlKFwiYnV0dG9uXCIpLmNsaWNrKCk7XG5cbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcbiAgICAgICAgXCJFeGVjdXRpb24gcGF1c2VkIOKAlCByZWFkeSB0byByZXN1bWUgZnJvbSBpdHMgZHVyYWJsZSBjaGVja3BvaW50XCIsXG4gICAgICAgIHtcbiAgICAgICAgICBleGFjdDogdHJ1ZSxcbiAgICAgICAgfSxcbiAgICAgICksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuXG4gICAgY29uc3Qgc3RvcmFnZUtleSA9XG4gICAgICBcImVvc19haV9leGVjdXRpb25fZTJlLXByb2plY3RfZTJlLWludGVycnVwdGVkLXJlc3VtZS1zZXNzaW9uXCI7XG4gICAgY29uc3QgcG9pbnRlcktleSA9IFwiZW9zX2FpX2V4ZWN1dGlvbl9jdXJyZW50X2UyZS1wcm9qZWN0XCI7XG4gICAgYXdhaXQgZXhwZWN0XG4gICAgICAucG9sbCgoKSA9PiBwYWdlLmV2YWx1YXRlKChrZXkpID0+IGxvY2FsU3RvcmFnZS5nZXRJdGVtKGtleSksIHN0b3JhZ2VLZXkpKVxuICAgICAgLnRvQ29udGFpbihyZWNvdmVyeS5pbml0aWFsVG9rZW4pO1xuXG4gICAgYXdhaXQgcGFnZS5ldmFsdWF0ZShcbiAgICAgICh7IHN0b3JhZ2VLZXksIHBvaW50ZXJLZXkgfSkgPT4ge1xuICAgICAgICBjb25zdCBzYXZlZCA9IEpTT04ucGFyc2UobG9jYWxTdG9yYWdlLmdldEl0ZW0oc3RvcmFnZUtleSkgPz8gXCJ7fVwiKTtcbiAgICAgICAgZGVsZXRlIHNhdmVkLnJlc3VtZVRva2VuO1xuICAgICAgICBsb2NhbFN0b3JhZ2Uuc2V0SXRlbShzdG9yYWdlS2V5LCBKU09OLnN0cmluZ2lmeShzYXZlZCkpO1xuICAgICAgICBsb2NhbFN0b3JhZ2Uuc2V0SXRlbShwb2ludGVyS2V5LCBcImUyZS1pbnRlcnJ1cHRlZC1yZXN1bWUtc2Vzc2lvblwiKTtcbiAgICAgIH0sXG4gICAgICB7IHN0b3JhZ2VLZXksIHBvaW50ZXJLZXkgfSxcbiAgICApO1xuICAgIGF3YWl0IHBhZ2UucmVsb2FkKCk7XG5cbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcIkEgc2F2ZWQgQUkgZXhlY3V0aW9uIGlzIHJlYWR5IHRvIHJlc3VtZVwiLCB7XG4gICAgICAgIGV4YWN0OiB0cnVlLFxuICAgICAgfSksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdFxuICAgICAgLnBvbGwoKCkgPT5cbiAgICAgICAgcGFnZS5ldmFsdWF0ZSgoa2V5KSA9PiB7XG4gICAgICAgICAgY29uc3Qgc2F2ZWQgPSBKU09OLnBhcnNlKGxvY2FsU3RvcmFnZS5nZXRJdGVtKGtleSkgPz8gXCJ7fVwiKTtcbiAgICAgICAgICByZXR1cm4gc2F2ZWQucmVzdW1lVG9rZW47XG4gICAgICAgIH0sIHN0b3JhZ2VLZXkpLFxuICAgICAgKVxuICAgICAgLnRvQmUocmVjb3ZlcnkucmVjb3ZlcmVkVG9rZW4pO1xuXG4gICAgYXdhaXQgcGFnZS5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIlJlc3VtZVwiLCBleGFjdDogdHJ1ZSB9KS5jbGljaygpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KHJlY292ZXJ5LmZpeHR1cmUuYW5zd2VyLCB7IGV4YWN0OiB0cnVlIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QucG9sbCgoKSA9PiBzdHJlYW1SZXF1ZXN0cy5sZW5ndGgpLnRvQmUoMik7XG4gICAgZXhwZWN0KHN0cmVhbVJlcXVlc3RzWzBdKS50b0VxdWFsKFxuICAgICAgZXhwZWN0Lm9iamVjdENvbnRhaW5pbmcoe1xuICAgICAgICBwcm9qZWN0SWQ6IFwiZTJlLXByb2plY3RcIixcbiAgICAgICAgbWVzc2FnZTogcmVjb3ZlcnkuZml4dHVyZS5xdWVzdGlvbixcbiAgICAgIH0pLFxuICAgICk7XG4gICAgZXhwZWN0KHN0cmVhbVJlcXVlc3RzWzBdPy5leGVjdXRpb25JZCkudG9CZVVuZGVmaW5lZCgpO1xuICAgIGV4cGVjdChzdHJlYW1SZXF1ZXN0c1swXT8uc2Vzc2lvbklkKS50b0JlVW5kZWZpbmVkKCk7XG4gICAgZXhwZWN0KHN0cmVhbVJlcXVlc3RzWzFdKS50b0VxdWFsKFxuICAgICAgZXhwZWN0Lm9iamVjdENvbnRhaW5pbmcoe1xuICAgICAgICBwcm9qZWN0SWQ6IFwiZTJlLXByb2plY3RcIixcbiAgICAgICAgc2Vzc2lvbklkOiByZWNvdmVyeS5maXh0dXJlLnNlc3Npb25JZCxcbiAgICAgICAgZXhlY3V0aW9uSWQ6IHJlY292ZXJ5LmZpeHR1cmUuZXhlY3V0aW9uSWQsXG4gICAgICAgIHJlc3VtZVRva2VuOiByZWNvdmVyeS5yZWNvdmVyZWRUb2tlbixcbiAgICAgICAgbWVzc2FnZTogcmVjb3ZlcnkuZml4dHVyZS5xdWVzdGlvbixcbiAgICAgIH0pLFxuICAgICk7XG4gICAgZXhwZWN0KFxuICAgICAgc3RyZWFtUmVxdWVzdHMubWFwKChyZXF1ZXN0KSA9PiByZXF1ZXN0LmV4ZWN1dGlvbklkKS5maWx0ZXIoQm9vbGVhbiksXG4gICAgKS50b0VxdWFsKFtyZWNvdmVyeS5maXh0dXJlLmV4ZWN1dGlvbklkXSk7XG4gIH0pO1xuXG4gIHRlc3QoXCJwcm9qZWN0cyBkZWxpdmVyeSByZWNvdmVyeSBzdGF0ZXMgc2FmZWx5IGFmdGVyIHJlbG9hZFwiLCBhc3luYyAoe1xuICAgIHBhZ2UsXG4gIH0pID0+IHtcbiAgICBjb25zdCByZWNvdmVyeSA9IHtcbiAgICAgIHJlcXVlc3RzOiBbXSBhcyBzdHJpbmdbXSxcbiAgICAgIG9wZXJhdGlvbnM6IFtcbiAgICAgICAge1xuICAgICAgICAgIHByb3Bvc2FsSWQ6IFwiZTJlLXJlY292ZXJ5LWF2YWlsYWJsZS1wcm9wb3NhbFwiLFxuICAgICAgICAgIG9wZXJhdGlvbklkOiBcImUyZS1yZWNvdmVyeS1hdmFpbGFibGUtb3BlcmF0aW9uXCIsXG4gICAgICAgICAgc2Vzc2lvbklkOiBcImUyZS1yZWNvdmVyeS1hdmFpbGFibGUtc2Vzc2lvblwiLFxuICAgICAgICAgIGxpZmVjeWNsZTogXCJibG9ja2VkXCIsXG4gICAgICAgICAgc3RhdHVzOiBcInBlbmRpbmdcIixcbiAgICAgICAgICBjcmVhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMzowMC4wMDBaXCIsXG4gICAgICAgICAgcmVjb3ZlcnlTdGF0ZTogXCJyZWNvdmVyYWJsZVwiLFxuICAgICAgICAgIG9wZXJhdG9yRXhwbGFuYXRpb246XG4gICAgICAgICAgICBcIlRoZSBkZWxpdmVyeSBzdG9wcGVkIGJlY2F1c2UgdmFsaWRhdGlvbiBuZWVkcyB0byBiZSBydW4gYWdhaW4uXCIsXG4gICAgICAgICAgbmV4dEFjdGlvbjpcbiAgICAgICAgICAgIFwiUmVzdW1lIHZhbGlkYXRpb24gdG8gcmUtY2hlY2sgdGhlIHNhdmVkIGNoYW5nZXMsIG9yIGRpc2NhcmQgdGhpcyByZWNvdmVyeSBpZiBpdCBpcyBubyBsb25nZXIgbmVlZGVkLlwiLFxuICAgICAgICAgIGNvbmZsaWN0UmVhc29uOiBudWxsLFxuICAgICAgICAgIHZhbGlkYXRpb25FdmlkZW5jZTogW3sgcHJvZmlsZTogXCJ3b3Jrc3BhY2UtdHlwZWNoZWNrXCIsIHN0YXR1czogXCJmYWlsZWRcIiB9XSxcbiAgICAgICAgICB3b3Jrc3BhY2VBdmFpbGFibGU6IHRydWUsXG4gICAgICAgICAgY2hhbmdlQ291bnQ6IDIsXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBwcm9wb3NhbElkOiBcImUyZS1yZWNvdmVyeS1taXNzaW5nLXByb3Bvc2FsXCIsXG4gICAgICAgICAgb3BlcmF0aW9uSWQ6IFwiZTJlLXJlY292ZXJ5LW1pc3Npbmctb3BlcmF0aW9uXCIsXG4gICAgICAgICAgc2Vzc2lvbklkOiBcImUyZS1yZWNvdmVyeS1taXNzaW5nLXNlc3Npb25cIixcbiAgICAgICAgICBsaWZlY3ljbGU6IFwiYWJhbmRvbmVkXCIsXG4gICAgICAgICAgc3RhdHVzOiBcInBlbmRpbmdcIixcbiAgICAgICAgICBjcmVhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMjowMC4wMDBaXCIsXG4gICAgICAgICAgcmVjb3ZlcnlTdGF0ZTogXCJtaXNzaW5nX3dvcmtzcGFjZVwiLFxuICAgICAgICAgIG9wZXJhdG9yRXhwbGFuYXRpb246XG4gICAgICAgICAgICBcIlRoZSBzYXZlZCBkZWxpdmVyeSB3b3Jrc3BhY2UgaXMgbm8gbG9uZ2VyIGF2YWlsYWJsZSwgc28gcmVjb3ZlcnkgY2Fubm90IGNvbnRpbnVlLlwiLFxuICAgICAgICAgIG5leHRBY3Rpb246XG4gICAgICAgICAgICBcIlN0YXJ0IGEgbmV3IGRlbGl2ZXJ5IGZyb20gdGhlIGN1cnJlbnQgcHJvamVjdCByYXRoZXIgdGhhbiByZXRyeWluZyB0aGlzIHJlY292ZXJ5LlwiLFxuICAgICAgICAgIGNvbmZsaWN0UmVhc29uOiBcIldvcmtzcGFjZSBleHBpcmVkIGFmdGVyIHRoZSBydW5uZXIgd2FzIHJlY3ljbGVkLlwiLFxuICAgICAgICAgIHZhbGlkYXRpb25FdmlkZW5jZTogbnVsbCxcbiAgICAgICAgICB3b3Jrc3BhY2VBdmFpbGFibGU6IGZhbHNlLFxuICAgICAgICAgIGNoYW5nZUNvdW50OiAxLFxuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgcHJvcG9zYWxJZDogXCJlMmUtcmVjb3ZlcnktZGlzY2FyZGVkLXByb3Bvc2FsXCIsXG4gICAgICAgICAgb3BlcmF0aW9uSWQ6IFwiZTJlLXJlY292ZXJ5LWRpc2NhcmRlZC1vcGVyYXRpb25cIixcbiAgICAgICAgICBzZXNzaW9uSWQ6IFwiZTJlLXJlY292ZXJ5LWRpc2NhcmRlZC1zZXNzaW9uXCIsXG4gICAgICAgICAgbGlmZWN5Y2xlOiBcImNhbmNlbGxlZFwiLFxuICAgICAgICAgIHN0YXR1czogXCJyZWplY3RlZFwiLFxuICAgICAgICAgIGNyZWF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAxOjAwLjAwMFpcIixcbiAgICAgICAgICByZWNvdmVyeVN0YXRlOiBcImRpc2NhcmRlZFwiLFxuICAgICAgICAgIG9wZXJhdG9yRXhwbGFuYXRpb246IFwiVGhpcyBkZWxpdmVyeSByZWNvdmVyeSB3YXMgYWxyZWFkeSBkaXNjYXJkZWQuXCIsXG4gICAgICAgICAgbmV4dEFjdGlvbjogXCJObyBhY3Rpb24gaXMgcmVxdWlyZWQuXCIsXG4gICAgICAgICAgY29uZmxpY3RSZWFzb246IFwiSW50ZXJuYWwgZGlhZ25vc3RpYzogc2hvdWxkIG5ldmVyIGJlIHJlbmRlcmVkXCIsXG4gICAgICAgICAgdmFsaWRhdGlvbkV2aWRlbmNlOiBudWxsLFxuICAgICAgICAgIHdvcmtzcGFjZUF2YWlsYWJsZTogZmFsc2UsXG4gICAgICAgICAgY2hhbmdlQ291bnQ6IDMsXG4gICAgICAgIH0sXG4gICAgICBdLFxuICAgIH07XG4gICAgYXdhaXQgaW5zdGFsbEFwaUZpeHR1cmVzKHBhZ2UsIHsgZGVsaXZlcnlSZWNvdmVyeTogcmVjb3ZlcnkgfSk7XG4gICAgYXdhaXQgcHJvZ3JhbW1hdGljU2lnbkluKHBhZ2UpO1xuICAgIGF3YWl0IHBhZ2UuZ290byhgJHtEQVNIQk9BUkRfUEFUSH1haWApO1xuXG4gICAgY29uc3QgcmVnaW9uID0gcGFnZS5nZXRCeVJvbGUoXCJyZWdpb25cIiwge1xuICAgICAgbmFtZTogXCJSZWNvdmVyYWJsZSBkZWxpdmVyeSBvcGVyYXRpb25zXCIsXG4gICAgfSk7XG4gICAgYXdhaXQgZXhwZWN0KHJlZ2lvbikudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QocmVnaW9uLmdldEJ5VGV4dChcIlJlY292ZXJhYmxlXCIsIHsgZXhhY3Q6IHRydWUgfSkpLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcmVnaW9uLmdldEJ5VGV4dChcIldvcmtzcGFjZSB1bmF2YWlsYWJsZVwiLCB7IGV4YWN0OiB0cnVlIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICByZWdpb24uZ2V0QnlUZXh0KFwiQWxyZWFkeSBkaXNjYXJkZWRcIiwgeyBleGFjdDogdHJ1ZSB9KSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcmVnaW9uLmdldEJ5VGV4dChcbiAgICAgICAgXCJUaGUgc2F2ZWQgZGVsaXZlcnkgd29ya3NwYWNlIGlzIG5vIGxvbmdlciBhdmFpbGFibGUsIHNvIHJlY292ZXJ5IGNhbm5vdCBjb250aW51ZS5cIixcbiAgICAgICAgeyBleGFjdDogdHJ1ZSB9LFxuICAgICAgKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcmVnaW9uLmdldEJ5VGV4dChcIlRoaXMgZGVsaXZlcnkgcmVjb3Zlcnkgd2FzIGFscmVhZHkgZGlzY2FyZGVkLlwiLCB7XG4gICAgICAgIGV4YWN0OiB0cnVlLFxuICAgICAgfSksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHJlZ2lvbi5nZXRCeVRleHQoXG4gICAgICAgIFwiUmV0YWluZWQgcmVhc29uOiBXb3Jrc3BhY2UgZXhwaXJlZCBhZnRlciB0aGUgcnVubmVyIHdhcyByZWN5Y2xlZC5cIixcbiAgICAgICAgeyBleGFjdDogdHJ1ZSB9LFxuICAgICAgKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG5cbiAgICBjb25zdCBhdmFpbGFibGUgPSByZWdpb24ubG9jYXRvcihcbiAgICAgICdbZGF0YS1vcGVyYXRpb24taWQ9XCJlMmUtcmVjb3ZlcnktYXZhaWxhYmxlLW9wZXJhdGlvblwiXScsXG4gICAgKTtcbiAgICBjb25zdCBtaXNzaW5nID0gcmVnaW9uLmxvY2F0b3IoXG4gICAgICAnW2RhdGEtb3BlcmF0aW9uLWlkPVwiZTJlLXJlY292ZXJ5LW1pc3Npbmctb3BlcmF0aW9uXCJdJyxcbiAgICApO1xuICAgIGNvbnN0IGRpc2NhcmRlZCA9IHJlZ2lvbi5sb2NhdG9yKFxuICAgICAgJ1tkYXRhLW9wZXJhdGlvbi1pZD1cImUyZS1yZWNvdmVyeS1kaXNjYXJkZWQtb3BlcmF0aW9uXCJdJyxcbiAgICApO1xuICAgIGF3YWl0IGV4cGVjdChhdmFpbGFibGUpLnRvSGF2ZUF0dHJpYnV0ZShcbiAgICAgIFwiZGF0YS1yZWNvdmVyeS1zdGF0ZVwiLFxuICAgICAgXCJyZWNvdmVyYWJsZVwiLFxuICAgICk7XG4gICAgYXdhaXQgZXhwZWN0KG1pc3NpbmcpLnRvSGF2ZUF0dHJpYnV0ZShcbiAgICAgIFwiZGF0YS1yZWNvdmVyeS1zdGF0ZVwiLFxuICAgICAgXCJtaXNzaW5nX3dvcmtzcGFjZVwiLFxuICAgICk7XG4gICAgYXdhaXQgZXhwZWN0KGRpc2NhcmRlZCkudG9IYXZlQXR0cmlidXRlKFxuICAgICAgXCJkYXRhLXJlY292ZXJ5LXN0YXRlXCIsXG4gICAgICBcImRpc2NhcmRlZFwiLFxuICAgICk7XG4gICAgYXdhaXQgZXhwZWN0KGF2YWlsYWJsZS5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIlJlc3VtZSB2YWxpZGF0aW9uXCIgfSkpLnRvQmVFbmFibGVkKCk7XG4gICAgYXdhaXQgZXhwZWN0KGF2YWlsYWJsZS5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIkRpc2NhcmQgd29ya3NwYWNlXCIgfSkpLnRvQmVFbmFibGVkKCk7XG4gICAgYXdhaXQgZXhwZWN0KG1pc3NpbmcuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJSZXN1bWUgdmFsaWRhdGlvblwiIH0pKS50b0JlRGlzYWJsZWQoKTtcbiAgICBhd2FpdCBleHBlY3QobWlzc2luZy5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIkRpc2NhcmQgd29ya3NwYWNlXCIgfSkpLnRvQmVEaXNhYmxlZCgpO1xuICAgIGF3YWl0IGV4cGVjdChkaXNjYXJkZWQuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJSZXN1bWUgdmFsaWRhdGlvblwiIH0pKS50b0JlRGlzYWJsZWQoKTtcbiAgICBhd2FpdCBleHBlY3QoZGlzY2FyZGVkLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiRGlzY2FyZCB3b3Jrc3BhY2VcIiB9KSkudG9CZURpc2FibGVkKCk7XG5cbiAgICBjb25zdCB2aXNpYmxlVGV4dCA9IGF3YWl0IHBhZ2UubG9jYXRvcihcImJvZHlcIikuaW5uZXJUZXh0KCk7XG4gICAgZXhwZWN0KHZpc2libGVUZXh0KS5ub3QudG9NYXRjaChcbiAgICAgIC9cXC9ob21lXFwvcnVubmVyfFxcL3RtcFxcL3xcXC93b3Jrc3BhY2VcXC98aW50ZXJuYWwgZGlhZ25vc3RpYy9pLFxuICAgICk7XG4gICAgYXdhaXQgZXhwZWN0Tm9Ib3Jpem9udGFsT3ZlcmZsb3cocGFnZSk7XG5cbiAgICBhd2FpdCBwYWdlLnJlbG9hZCgpO1xuICAgIGNvbnN0IHJlbG9hZGVkUmVnaW9uID0gcGFnZS5nZXRCeVJvbGUoXCJyZWdpb25cIiwge1xuICAgICAgbmFtZTogXCJSZWNvdmVyYWJsZSBkZWxpdmVyeSBvcGVyYXRpb25zXCIsXG4gICAgfSk7XG4gICAgYXdhaXQgZXhwZWN0KHJlbG9hZGVkUmVnaW9uKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHJlbG9hZGVkUmVnaW9uXG4gICAgICAgIC5sb2NhdG9yKCdbZGF0YS1vcGVyYXRpb24taWQ9XCJlMmUtcmVjb3ZlcnktbWlzc2luZy1vcGVyYXRpb25cIl0nKVxuICAgICAgICAuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJSZXN1bWUgdmFsaWRhdGlvblwiIH0pLFxuICAgICkudG9CZURpc2FibGVkKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcmVsb2FkZWRSZWdpb25cbiAgICAgICAgLmxvY2F0b3IoJ1tkYXRhLW9wZXJhdGlvbi1pZD1cImUyZS1yZWNvdmVyeS1kaXNjYXJkZWQtb3BlcmF0aW9uXCJdJylcbiAgICAgICAgLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiRGlzY2FyZCB3b3Jrc3BhY2VcIiB9KSxcbiAgICApLnRvQmVEaXNhYmxlZCgpO1xuICAgIGV4cGVjdChyZWNvdmVyeS5yZXF1ZXN0cy5sZW5ndGgpLnRvQmVHcmVhdGVyVGhhbk9yRXF1YWwoMik7XG4gICAgZXhwZWN0KHJlY292ZXJ5LnJlcXVlc3RzLmV2ZXJ5KCh1cmwpID0+IHVybC5pbmNsdWRlcyhcInByb2plY3RJZD1lMmUtcHJvamVjdFwiKSkpLnRvQmUodHJ1ZSk7XG4gIH0pO1xuXG4gIHRlc3QoXCJleHBsYWlucyB3aGVuIGRlbGl2ZXJ5IHJlY292ZXJ5IGxvc2VzIGEgcmFjZSBhbmQgcmVmcmVzaGVzIHN0YXRlXCIsIGFzeW5jICh7XG4gICAgcGFnZSxcbiAgfSkgPT4ge1xuICAgIGNvbnN0IHJlY292ZXJ5ID0ge1xuICAgICAgcmVxdWVzdHM6IFtdIGFzIHN0cmluZ1tdLFxuICAgICAgYWN0aW9uUmVxdWVzdHM6IFtdIGFzIHN0cmluZ1tdLFxuICAgICAgb3BlcmF0aW9uczogW1xuICAgICAgICB7XG4gICAgICAgICAgcHJvcG9zYWxJZDogXCJlMmUtcmVjb3ZlcnktcmFjZS1wcm9wb3NhbFwiLFxuICAgICAgICAgIG9wZXJhdGlvbklkOiBcImUyZS1yZWNvdmVyeS1yYWNlLW9wZXJhdGlvblwiLFxuICAgICAgICAgIHNlc3Npb25JZDogXCJlMmUtcmVjb3ZlcnktcmFjZS1zZXNzaW9uXCIsXG4gICAgICAgICAgbGlmZWN5Y2xlOiBcImJsb2NrZWRcIixcbiAgICAgICAgICBzdGF0dXM6IFwicGVuZGluZ1wiLFxuICAgICAgICAgIGNyZWF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjA0OjAwLjAwMFpcIixcbiAgICAgICAgICByZWNvdmVyeVN0YXRlOiBcInJlY292ZXJhYmxlXCIsXG4gICAgICAgICAgb3BlcmF0b3JFeHBsYW5hdGlvbjpcbiAgICAgICAgICAgIFwiVGhlIGRlbGl2ZXJ5IHN0b3BwZWQgYmVjYXVzZSB0aGUgcmV0YWluZWQgY2hhbmdlcyBuZWVkIHJldmlldyBiZWZvcmUgdmFsaWRhdGlvbiBjYW4gY29udGludWUuXCIsXG4gICAgICAgICAgbmV4dEFjdGlvbjpcbiAgICAgICAgICAgIFwiUmVzdW1lIHZhbGlkYXRpb24gdG8gcmUtY2hlY2sgdGhlIHNhdmVkIGNoYW5nZXMsIG9yIGRpc2NhcmQgdGhpcyByZWNvdmVyeSBpZiBpdCBpcyBubyBsb25nZXIgbmVlZGVkLlwiLFxuICAgICAgICAgIGNvbmZsaWN0UmVhc29uOiBudWxsLFxuICAgICAgICAgIHZhbGlkYXRpb25FdmlkZW5jZTogW3sgcHJvZmlsZTogXCJ3b3Jrc3BhY2UtdHlwZWNoZWNrXCIsIHN0YXR1czogXCJmYWlsZWRcIiB9XSxcbiAgICAgICAgICB3b3Jrc3BhY2VBdmFpbGFibGU6IHRydWUsXG4gICAgICAgICAgY2hhbmdlQ291bnQ6IDEsXG4gICAgICAgIH0sXG4gICAgICBdLFxuICAgICAgcmVjb3ZlcnlBY3Rpb246IHtcbiAgICAgICAgcHJvcG9zYWxJZDogXCJlMmUtcmVjb3ZlcnktcmFjZS1wcm9wb3NhbFwiLFxuICAgICAgICBhY3Rpb246IFwicmVzdW1lLXZhbGlkYXRpb25cIiBhcyBjb25zdCxcbiAgICAgICAgcmVzcG9uc2U6IHtcbiAgICAgICAgICBlcnJvcjogXCJUaGlzIGRlbGl2ZXJ5IHJlY292ZXJ5IHdhcyBhbHJlYWR5IGRpc2NhcmRlZC5cIixcbiAgICAgICAgICBjb2RlOiBcIkRFTElWRVJZX0FMUkVBRFlfRElTQ0FSREVEXCIsXG4gICAgICAgICAgbGlmZWN5Y2xlOiBcImNhbmNlbGxlZFwiLFxuICAgICAgICAgIHJlY292ZXJ5U3RhdGU6IFwiZGlzY2FyZGVkXCIsXG4gICAgICAgICAgbmV4dEFjdGlvbjogXCJObyBhY3Rpb24gaXMgcmVxdWlyZWQuXCIsXG4gICAgICAgICAgZGlhZ25vc3RpYzogXCJEbyBub3QgcmVuZGVyIHRoaXMgc2VydmVyIGRldGFpbC5cIixcbiAgICAgICAgfSxcbiAgICAgICAgbmV4dE9wZXJhdGlvbnM6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBwcm9wb3NhbElkOiBcImUyZS1yZWNvdmVyeS1yYWNlLXByb3Bvc2FsXCIsXG4gICAgICAgICAgICBvcGVyYXRpb25JZDogXCJlMmUtcmVjb3ZlcnktcmFjZS1vcGVyYXRpb25cIixcbiAgICAgICAgICAgIHNlc3Npb25JZDogXCJlMmUtcmVjb3ZlcnktcmFjZS1zZXNzaW9uXCIsXG4gICAgICAgICAgICBsaWZlY3ljbGU6IFwiY2FuY2VsbGVkXCIsXG4gICAgICAgICAgICBzdGF0dXM6IFwicmVqZWN0ZWRcIixcbiAgICAgICAgICAgIGNyZWF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjA0OjAwLjAwMFpcIixcbiAgICAgICAgICAgIHJlY292ZXJ5U3RhdGU6IFwiZGlzY2FyZGVkXCIsXG4gICAgICAgICAgICBvcGVyYXRvckV4cGxhbmF0aW9uOiBcIlRoaXMgZGVsaXZlcnkgcmVjb3Zlcnkgd2FzIGFscmVhZHkgZGlzY2FyZGVkLlwiLFxuICAgICAgICAgICAgbmV4dEFjdGlvbjogXCJObyBhY3Rpb24gaXMgcmVxdWlyZWQuXCIsXG4gICAgICAgICAgICBjb25mbGljdFJlYXNvbjogbnVsbCxcbiAgICAgICAgICAgIHZhbGlkYXRpb25FdmlkZW5jZTogbnVsbCxcbiAgICAgICAgICAgIHdvcmtzcGFjZUF2YWlsYWJsZTogZmFsc2UsXG4gICAgICAgICAgICBjaGFuZ2VDb3VudDogMSxcbiAgICAgICAgICB9LFxuICAgICAgICBdLFxuICAgICAgfSxcbiAgICB9O1xuICAgIGF3YWl0IGluc3RhbGxBcGlGaXh0dXJlcyhwYWdlLCB7IGRlbGl2ZXJ5UmVjb3Zlcnk6IHJlY292ZXJ5IH0pO1xuICAgIGF3YWl0IHByb2dyYW1tYXRpY1NpZ25JbihwYWdlKTtcbiAgICBhd2FpdCBwYWdlLmdvdG8oYCR7REFTSEJPQVJEX1BBVEh9YWlgKTtcblxuICAgIGNvbnN0IHJlZ2lvbiA9IHBhZ2UuZ2V0QnlSb2xlKFwicmVnaW9uXCIsIHtcbiAgICAgIG5hbWU6IFwiUmVjb3ZlcmFibGUgZGVsaXZlcnkgb3BlcmF0aW9uc1wiLFxuICAgIH0pO1xuICAgIGNvbnN0IG9wZXJhdGlvbiA9IHJlZ2lvbi5sb2NhdG9yKFxuICAgICAgJ1tkYXRhLW9wZXJhdGlvbi1pZD1cImUyZS1yZWNvdmVyeS1yYWNlLW9wZXJhdGlvblwiXScsXG4gICAgKTtcbiAgICBhd2FpdCBleHBlY3Qob3BlcmF0aW9uLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiUmVzdW1lIHZhbGlkYXRpb25cIiB9KSkudG9CZUVuYWJsZWQoKTtcbiAgICBhd2FpdCBvcGVyYXRpb24uZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJSZXN1bWUgdmFsaWRhdGlvblwiIH0pLmNsaWNrKCk7XG5cbiAgICBhd2FpdCBleHBlY3QocGFnZS5nZXRCeVRleHQoXCJSZWNvdmVyeSBzdGF0ZSBjaGFuZ2VkXCIsIHsgZXhhY3Q6IHRydWUgfSkpLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXG4gICAgICAgIFwiVGhpcyByZWNvdmVyeSB3YXMgYWxyZWFkeSBkaXNjYXJkZWQuIFRoZSByZWNvdmVyeSBsaXN0IHdhcyByZWZyZXNoZWQuXCIsXG4gICAgICAgIHsgZXhhY3Q6IHRydWUgfSxcbiAgICAgICksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdFxuICAgICAgLnBvbGwoKCkgPT4gcmVjb3ZlcnkucmVxdWVzdHMubGVuZ3RoKVxuICAgICAgLnRvQmVHcmVhdGVyVGhhbk9yRXF1YWwoMik7XG4gICAgYXdhaXQgZXhwZWN0KG9wZXJhdGlvbikudG9IYXZlQXR0cmlidXRlKFwiZGF0YS1yZWNvdmVyeS1zdGF0ZVwiLCBcImRpc2NhcmRlZFwiKTtcbiAgICBleHBlY3QocmVjb3ZlcnkuYWN0aW9uUmVxdWVzdHMpLnRvSGF2ZUxlbmd0aCgxKTtcbiAgICBleHBlY3QocmVjb3ZlcnkuYWN0aW9uUmVxdWVzdHNbMF0pLnRvQ29udGFpbihcbiAgICAgIFwiL2FwaS9haS9kZWxpdmVyeS9lMmUtcmVjb3ZlcnktcmFjZS1wcm9wb3NhbC9yZXN1bWUtdmFsaWRhdGlvblwiLFxuICAgICk7XG4gICAgZXhwZWN0KGF3YWl0IHJlZ2lvbi5sb2NhdG9yKCdbZGF0YS1vcGVyYXRpb24taWQ9XCJlMmUtcmVjb3ZlcnktcmFjZS1vcGVyYXRpb25cIl0nKS5jb3VudCgpKS50b0JlKDEpO1xuICAgIGNvbnN0IHZpc2libGVUZXh0ID0gYXdhaXQgcGFnZS5sb2NhdG9yKFwiYm9keVwiKS5pbm5lclRleHQoKTtcbiAgICBleHBlY3QodmlzaWJsZVRleHQpLm5vdC50b01hdGNoKC9EbyBub3QgcmVuZGVyIHRoaXMgc2VydmVyIGRldGFpbHxcXC9ob21lXFwvcnVubmVyfFxcL3RtcFxcLy9pKTtcbiAgICBhd2FpdCBleHBlY3ROb0hvcml6b250YWxPdmVyZmxvdyhwYWdlKTtcbiAgfSk7XG5cbiAgdGVzdChcImV4cGxhaW5zIHdoZW4gYW4gb2xkIHJlY292ZXJ5IGxpbmsgcG9pbnRzIHRvIGEgZGVsZXRlZCBvcGVyYXRpb25cIiwgYXN5bmMgKHtcbiAgICBwYWdlLFxuICB9KSA9PiB7XG4gICAgY29uc3QgcmVjb3ZlcnkgPSB7XG4gICAgICByZXF1ZXN0czogW10gYXMgc3RyaW5nW10sXG4gICAgICBhY3Rpb25SZXF1ZXN0czogW10gYXMgc3RyaW5nW10sXG4gICAgICBvcGVyYXRpb25zOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBwcm9wb3NhbElkOiBcImUyZS1yZWNvdmVyeS1kZWxldGVkLXByb3Bvc2FsXCIsXG4gICAgICAgICAgb3BlcmF0aW9uSWQ6IFwiZTJlLXJlY292ZXJ5LWRlbGV0ZWQtb3BlcmF0aW9uXCIsXG4gICAgICAgICAgc2Vzc2lvbklkOiBcImUyZS1yZWNvdmVyeS1kZWxldGVkLXNlc3Npb25cIixcbiAgICAgICAgICBsaWZlY3ljbGU6IFwiYmxvY2tlZFwiLFxuICAgICAgICAgIHN0YXR1czogXCJwZW5kaW5nXCIsXG4gICAgICAgICAgY3JlYXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDU6MDAuMDAwWlwiLFxuICAgICAgICAgIHJlY292ZXJ5U3RhdGU6IFwicmVjb3ZlcmFibGVcIixcbiAgICAgICAgICBvcGVyYXRvckV4cGxhbmF0aW9uOlxuICAgICAgICAgICAgXCJUaGUgZGVsaXZlcnkgc3RvcHBlZCBiZWNhdXNlIHRoZSByZXRhaW5lZCBjaGFuZ2VzIG5lZWQgcmV2aWV3IGJlZm9yZSB2YWxpZGF0aW9uIGNhbiBjb250aW51ZS5cIixcbiAgICAgICAgICBuZXh0QWN0aW9uOlxuICAgICAgICAgICAgXCJSZXN1bWUgdmFsaWRhdGlvbiB0byByZS1jaGVjayB0aGUgc2F2ZWQgY2hhbmdlcywgb3IgZGlzY2FyZCB0aGlzIHJlY292ZXJ5IGlmIGl0IGlzIG5vIGxvbmdlciBuZWVkZWQuXCIsXG4gICAgICAgICAgY29uZmxpY3RSZWFzb246IG51bGwsXG4gICAgICAgICAgdmFsaWRhdGlvbkV2aWRlbmNlOiBbeyBwcm9maWxlOiBcIndvcmtzcGFjZS10eXBlY2hlY2tcIiwgc3RhdHVzOiBcImZhaWxlZFwiIH1dLFxuICAgICAgICAgIHdvcmtzcGFjZUF2YWlsYWJsZTogdHJ1ZSxcbiAgICAgICAgICBjaGFuZ2VDb3VudDogMSxcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgICByZWNvdmVyeUFjdGlvbjoge1xuICAgICAgICBwcm9wb3NhbElkOiBcImUyZS1yZWNvdmVyeS1kZWxldGVkLXByb3Bvc2FsXCIsXG4gICAgICAgIGFjdGlvbjogXCJyZXN1bWUtdmFsaWRhdGlvblwiIGFzIGNvbnN0LFxuICAgICAgICBzdGF0dXM6IDQwNCxcbiAgICAgICAgcmVzcG9uc2U6IHtcbiAgICAgICAgICBlcnJvcjogXCJEZWxpdmVyeSBvcGVyYXRpb24gbm90IGZvdW5kXCIsXG4gICAgICAgICAgY29kZTogXCJERUxJVkVSWV9OT1RfRk9VTkRcIixcbiAgICAgICAgICBkaWFnbm9zdGljOiBcIkRvIG5vdCByZW5kZXIgdGhpcyBzZXJ2ZXIgZGV0YWlsLlwiLFxuICAgICAgICB9LFxuICAgICAgICBuZXh0T3BlcmF0aW9uczogW10sXG4gICAgICB9LFxuICAgIH07XG4gICAgYXdhaXQgaW5zdGFsbEFwaUZpeHR1cmVzKHBhZ2UsIHsgZGVsaXZlcnlSZWNvdmVyeTogcmVjb3ZlcnkgfSk7XG4gICAgYXdhaXQgcHJvZ3JhbW1hdGljU2lnbkluKHBhZ2UpO1xuICAgIGF3YWl0IHBhZ2UuZ290byhgJHtEQVNIQk9BUkRfUEFUSH1haWApO1xuXG4gICAgY29uc3QgcmVnaW9uID0gcGFnZS5nZXRCeVJvbGUoXCJyZWdpb25cIiwge1xuICAgICAgbmFtZTogXCJSZWNvdmVyYWJsZSBkZWxpdmVyeSBvcGVyYXRpb25zXCIsXG4gICAgfSk7XG4gICAgY29uc3Qgb3BlcmF0aW9uID0gcmVnaW9uLmxvY2F0b3IoXG4gICAgICAnW2RhdGEtb3BlcmF0aW9uLWlkPVwiZTJlLXJlY292ZXJ5LWRlbGV0ZWQtb3BlcmF0aW9uXCJdJyxcbiAgICApO1xuICAgIGF3YWl0IGV4cGVjdChvcGVyYXRpb24uZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJSZXN1bWUgdmFsaWRhdGlvblwiIH0pKS50b0JlRW5hYmxlZCgpO1xuICAgIGF3YWl0IG9wZXJhdGlvbi5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIlJlc3VtZSB2YWxpZGF0aW9uXCIgfSkuY2xpY2soKTtcblxuICAgIGF3YWl0IGV4cGVjdChwYWdlLmdldEJ5VGV4dChcIlJlY292ZXJ5IGxpbmsgZXhwaXJlZFwiLCB7IGV4YWN0OiB0cnVlIH0pKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFxuICAgICAgICBcIlRoaXMgcmVjb3Zlcnkgb3BlcmF0aW9uIG5vIGxvbmdlciBleGlzdHMuIFRoZSByZWNvdmVyeSBsaXN0IHdhcyByZWZyZXNoZWQuXCIsXG4gICAgICAgIHsgZXhhY3Q6IHRydWUgfSxcbiAgICAgICksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdC5wb2xsKCgpID0+IHJlY292ZXJ5LnJlcXVlc3RzLmxlbmd0aCkudG9CZUdyZWF0ZXJUaGFuT3JFcXVhbCgyKTtcbiAgICBhd2FpdCBleHBlY3QucG9sbCgoKSA9PiByZWdpb24uY291bnQoKSkudG9CZSgwKTtcbiAgICBleHBlY3QocmVjb3ZlcnkuYWN0aW9uUmVxdWVzdHMpLnRvSGF2ZUxlbmd0aCgxKTtcbiAgICBleHBlY3QocmVjb3ZlcnkuYWN0aW9uUmVxdWVzdHNbMF0pLnRvQ29udGFpbihcbiAgICAgIFwiL2FwaS9haS9kZWxpdmVyeS9lMmUtcmVjb3ZlcnktZGVsZXRlZC1wcm9wb3NhbC9yZXN1bWUtdmFsaWRhdGlvblwiLFxuICAgICk7XG4gICAgY29uc3QgdmlzaWJsZVRleHQgPSBhd2FpdCBwYWdlLmxvY2F0b3IoXCJib2R5XCIpLmlubmVyVGV4dCgpO1xuICAgIGV4cGVjdCh2aXNpYmxlVGV4dCkubm90LnRvTWF0Y2goXG4gICAgICAvRGVsaXZlcnkgb3BlcmF0aW9uIG5vdCBmb3VuZHxEbyBub3QgcmVuZGVyIHRoaXMgc2VydmVyIGRldGFpbHxcXC9ob21lXFwvcnVubmVyfFxcL3RtcFxcLy9pLFxuICAgICk7XG4gICAgYXdhaXQgZXhwZWN0Tm9Ib3Jpem9udGFsT3ZlcmZsb3cocGFnZSk7XG4gIH0pO1xuXG4gIHRlc3QoXCJrZWVwcyB0aGUgcmVzdW1lZCBBSSBzZXNzaW9uIGRyYXdlciBvdmVybGFpZCBvbiBhIHBob25lIHZpZXdwb3J0XCIsIGFzeW5jICh7XG4gICAgcGFnZSxcbiAgfSkgPT4ge1xuICAgIGF3YWl0IHBhZ2Uuc2V0Vmlld3BvcnRTaXplKHsgd2lkdGg6IDM5MCwgaGVpZ2h0OiA4NDQgfSk7XG4gICAgY29uc3QgZml4dHVyZSA9IGF3YWl0IGluc3RhbGxBcmFiaWNBaUZpeHR1cmUocGFnZSk7XG4gICAgYXdhaXQgaW5zdGFsbEFwaUZpeHR1cmVzKHBhZ2UsIHsgYXJhYmljQWk6IGZpeHR1cmUgfSk7XG4gICAgYXdhaXQgcHJvZ3JhbW1hdGljU2lnbkluKHBhZ2UpO1xuICAgIGF3YWl0IHBhZ2UuZ290byhgJHtEQVNIQk9BUkRfUEFUSH1haWApO1xuXG4gICAgY29uc3QgY29tcG9zZXIgPSBwYWdlLmxvY2F0b3IoXCJ0ZXh0YXJlYVwiKS5maXJzdCgpO1xuICAgIGF3YWl0IGV4cGVjdChjb21wb3NlcikudG9CZVZpc2libGUoKTtcbiAgICBjb25zdCBiZWZvcmVPcGVuID0gYXdhaXQgY29tcG9zZXIuYm91bmRpbmdCb3goKTtcbiAgICBleHBlY3QoYmVmb3JlT3Blbj8ud2lkdGgpLnRvQmVHcmVhdGVyVGhhbigyNTApO1xuXG4gICAgYXdhaXQgcGFnZS5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIk9wZW4gc2Vzc2lvbnNcIiB9KS5jbGljaygpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlLmdldEJ5VGV4dChcIlNlc3Npb25zXCIsIHsgZXhhY3Q6IHRydWUgfSkpLnRvQmVWaXNpYmxlKCk7XG4gICAgY29uc3QgZHJhd2VyID0gcGFnZVxuICAgICAgLmdldEJ5VGV4dChcIlNlc3Npb25zXCIsIHsgZXhhY3Q6IHRydWUgfSlcbiAgICAgIC5sb2NhdG9yKFwiLi5cIilcbiAgICAgIC5sb2NhdG9yKFwiLi5cIik7XG4gICAgY29uc3QgZHJhd2VyQm94ID0gYXdhaXQgZHJhd2VyLmJvdW5kaW5nQm94KCk7XG4gICAgZXhwZWN0KGRyYXdlckJveD8ud2lkdGgpLnRvQmVMZXNzVGhhbk9yRXF1YWwoMzkwKTtcbiAgICBjb25zdCBkdXJpbmdPcGVuID0gYXdhaXQgY29tcG9zZXIuYm91bmRpbmdCb3goKTtcbiAgICBleHBlY3QoZHVyaW5nT3Blbj8ud2lkdGgpLnRvQmVHcmVhdGVyVGhhbigyNTApO1xuXG4gICAgYXdhaXQgcGFnZS5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIkNsb3NlIHNpZGViYXJcIiB9KS5jbGljaygpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJPcGVuIHNlc3Npb25zXCIgfSksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdE5vSG9yaXpvbnRhbE92ZXJmbG93KHBhZ2UpO1xuICB9KTtcblxuICB0ZXN0KFwicmVuZGVycyBhIHVzZXItdmlzaWJsZSBBUEkgZmFpbHVyZSBzdGF0ZVwiLCBhc3luYyAoeyBwYWdlIH0pID0+IHtcbiAgICBhd2FpdCBwYWdlLnJvdXRlKFwiKiovYXBpL2Rhc2hib2FyZFwiLCAocm91dGUpID0+XG4gICAgICByb3V0ZS5mdWxmaWxsKFxuICAgICAgICBqc29uUmVzcG9uc2UoeyBlcnJvcjogXCJjb250cm9sbGVkIGRhc2hib2FyZCBvdXRhZ2VcIiB9LCA1MDMpLFxuICAgICAgKSxcbiAgICApO1xuICAgIGF3YWl0IHByb2dyYW1tYXRpY1NpZ25JbihwYWdlKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5Um9sZShcImhlYWRpbmdcIiwgeyBuYW1lOiBcIkZhaWxlZCB0byBsb2FkIGRhc2hib2FyZFwiIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiUmV0cnkgQ29ubmVjdGlvblwiIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgfSk7XG59KTtcbiJdLCJtYXBwaW5ncyI6IjtBQUFBLFNBQVNBLE1BQU0sRUFBRUMsSUFBSSxRQUFtQixrQkFBa0I7QUFDMUQsU0FBU0MsS0FBSyxFQUFFQyxTQUFTLFFBQVEsa0JBQWtCO0FBQ25ELFNBQVNDLE9BQU8sUUFBUSxXQUFXO0FBQ25DLFNBQ0VDLDZCQUE2QixFQUM3QkMsNEJBQTRCLEVBQzVCQyw2QkFBNkIsUUFDeEIsMEJBQTBCO0FBRWpDLE1BQU1DLGNBQWMsR0FBRyxhQUFhO0FBQ3BDLE1BQU1DLFNBQVMsR0FBRztFQUNoQkMsU0FBUyxFQUFFLGVBQWU7RUFDMUJDLFFBQVEsRUFBRSxpQkFBaUI7RUFDM0JDLEtBQUssR0FBQUMscUJBQUEsR0FDSEMsT0FBTyxDQUFDQyxHQUFHLENBQUNDLG1CQUFtQixjQUFBSCxxQkFBQSxjQUFBQSxxQkFBQSxHQUMvQjtBQUNKLENBQUM7QUFDRCxNQUFNSSxZQUFZLEdBQUcsMEJBQTBCO0FBQy9DLE1BQU1DLHVCQUF1QixHQUFHLE1BQU87QUFDdkMsTUFBTUMsMkJBQTJCLEdBQUcsSUFBSztBQUN6QyxNQUFNQyxjQUFjLEdBQUcsMEJBQTBCO0FBQ2pELE1BQU1DLHlCQUF5QixHQUFHLENBQ2hDLDZCQUE2QixFQUM3Qiw4QkFBOEIsRUFDOUIsOEJBQThCLEVBQzlCLE1BQU0sQ0FDRTtBQUNWLE1BQU1DLG1CQUFtQixHQUN2QixxRkFBcUYsR0FDckYsd0ZBQXdGLEdBQ3hGLDBFQUEwRTtBQUM1RSxNQUFNQyx1QkFBdUIsR0FBRyxJQUFJQyxHQUFHLENBQUMsQ0FDdEMsaUJBQWlCLEVBQ2pCLGtCQUFrQixFQUNsQixrQkFBa0IsQ0FDbkIsQ0FBQztBQUVGLFNBQVNDLG9CQUFvQkEsQ0FBQSxFQUF1QjtFQUFBLElBQUFDLHNCQUFBO0VBQ2xELE1BQU1DLFFBQVEsSUFBQUQsc0JBQUEsR0FBR1osT0FBTyxDQUFDQyxHQUFHLENBQUNhLDJCQUEyQixjQUFBRixzQkFBQSx1QkFBdkNBLHNCQUFBLENBQXlDRyxJQUFJLENBQUMsQ0FBQztFQUNoRSxJQUFJZixPQUFPLENBQUNDLEdBQUcsQ0FBQ2UsMkJBQTJCLEtBQUssR0FBRyxJQUFJLENBQUNILFFBQVEsRUFBRTtJQUNoRSxNQUFNLElBQUlJLEtBQUssQ0FDYiw0R0FDRixDQUFDO0VBQ0g7RUFDQSxJQUFJSixRQUFRLElBQUksQ0FBQ0osdUJBQXVCLENBQUNTLEdBQUcsQ0FBQ0wsUUFBUSxDQUFDLEVBQUU7SUFDdEQsTUFBTSxJQUFJSSxLQUFLLENBQUMsdUNBQXVDSixRQUFRLEdBQUcsQ0FBQztFQUNyRTtFQUNBLE9BQU9BLFFBQVE7QUFDakI7QUFFQSxTQUFTTSxVQUFVQSxDQUFBLEVBQVc7RUFBQSxJQUFBQyxzQkFBQTtFQUM1QixNQUFNUCxRQUFRLEdBQUdGLG9CQUFvQixDQUFDLENBQUM7RUFDdkMsSUFBSUUsUUFBUSxLQUFLLGlCQUFpQixFQUFFO0lBQ2xDLE9BQU8sOE5BQThOO0VBQ3ZPO0VBQ0EsSUFBSUEsUUFBUSxLQUFLLGtCQUFrQixFQUFFO0lBQ25DLE9BQU8sMEtBQTBLO0VBQ25MO0VBQ0EsSUFBSUEsUUFBUSxLQUFLLGtCQUFrQixFQUFFO0lBQ25DLE9BQU8sNFBBQTRQO0VBQ3JRO0VBQ0EsUUFBQU8sc0JBQUEsR0FBT3BCLE9BQU8sQ0FBQ0MsR0FBRyxDQUFDb0IseUJBQXlCLGNBQUFELHNCQUFBLGNBQUFBLHNCQUFBLEdBQUlaLG1CQUFtQjtBQUNyRTtBQUVBLFNBQVNjLGFBQWFBLENBQUEsRUFBVztFQUMvQixNQUFNQyxVQUFVLEdBQUdDLE1BQU0sQ0FBQ3hCLE9BQU8sQ0FBQ0MsR0FBRyxDQUFDd0IsNkJBQTZCLENBQUM7RUFDcEUsT0FBT0QsTUFBTSxDQUFDRSxRQUFRLENBQUNILFVBQVUsQ0FBQyxJQUFJQSxVQUFVLEdBQUcsQ0FBQyxHQUNoREEsVUFBVSxHQUNWbkIsdUJBQXVCO0FBQzdCO0FBRUEsU0FBU3VCLHdCQUF3QkEsQ0FBQSxFQUFhO0VBQUEsSUFBQUMsc0JBQUE7RUFDNUMsTUFBTUMsT0FBTyxHQUFHLEVBQUFELHNCQUFBLEdBQUM1QixPQUFPLENBQUNDLEdBQUcsQ0FBQzZCLDhCQUE4QixjQUFBRixzQkFBQSxjQUFBQSxzQkFBQSxHQUFJLEVBQUUsRUFDOURHLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FDVkMsR0FBRyxDQUFFQyxNQUFNLElBQUtBLE1BQU0sQ0FBQ2xCLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FDOUJtQixNQUFNLENBQUNDLE9BQU8sQ0FBQztFQUNsQixJQUFJTixPQUFPLENBQUNPLE1BQU0sS0FBSyxDQUFDLEVBQUU7SUFDeEIsTUFBTSxJQUFJbkIsS0FBSyxDQUNiLDhFQUNGLENBQUM7RUFDSDtFQUNBLE9BQU9ZLE9BQU8sQ0FBQ0csR0FBRyxDQUFFQyxNQUFNLElBQUs7SUFDN0IsTUFBTUksTUFBTSxHQUFHLElBQUlDLEdBQUcsQ0FBQ0wsTUFBTSxDQUFDO0lBQzlCLElBQ0VJLE1BQU0sQ0FBQ0osTUFBTSxLQUFLQSxNQUFNLElBQ3hCSSxNQUFNLENBQUNFLFFBQVEsS0FBSyxHQUFHLElBQ3ZCRixNQUFNLENBQUNHLE1BQU0sSUFDYkgsTUFBTSxDQUFDSSxJQUFJLEVBQ1g7TUFDQSxNQUFNLElBQUl4QixLQUFLLENBQ2IsbURBQW1EZ0IsTUFBTSxFQUMzRCxDQUFDO0lBQ0g7SUFDQSxPQUFPSSxNQUFNLENBQUNKLE1BQU07RUFDdEIsQ0FBQyxDQUFDO0FBQ0o7QUFFQSxNQUFNUyxnQkFBZ0IsR0FBRztFQUN2QkMsaUJBQWlCLEVBQUUsMEJBQTBCO0VBQzdDQyxZQUFZLEVBQUUsQ0FBQztFQUNmQyxlQUFlLEVBQUUsQ0FBQztFQUNsQkMsa0JBQWtCLEVBQUUsQ0FBQztFQUNyQkMsZUFBZSxFQUFFLENBQUM7RUFDbEJDLG1CQUFtQixFQUFFO0lBQUVDLE9BQU8sRUFBRSxDQUFDO0lBQUVDLE9BQU8sRUFBRTtFQUFFLENBQUM7RUFDL0NDLGFBQWEsRUFBRSxDQUNiO0lBQ0VDLFNBQVMsRUFBRSxhQUFhO0lBQ3hCQyxXQUFXLEVBQUUsZUFBZTtJQUM1QkMsS0FBSyxFQUFFLEVBQUU7SUFDVEMsS0FBSyxFQUFFO0VBQ1QsQ0FBQyxDQUNGO0VBQ0RDLFlBQVksRUFBRSxDQUNaO0lBQ0VDLEVBQUUsRUFBRSxXQUFXO0lBQ2ZDLElBQUksRUFBRSxZQUFZO0lBQ2xCQyxRQUFRLEVBQUUsU0FBUztJQUNuQkMsT0FBTyxFQUFFLDZCQUE2QjtJQUN0Q0MsU0FBUyxFQUFFO0VBQ2IsQ0FBQyxDQUNGO0VBQ0RDLFFBQVEsRUFBRTtBQUNaLENBQUM7QUFFRCxNQUFNQyxnQkFBZ0IsR0FBRztFQUN2Qk4sRUFBRSxFQUFFdEQsWUFBWTtFQUNoQmlELFNBQVMsRUFBRSxhQUFhO0VBQ3hCWSxXQUFXLEVBQUUsZUFBZTtFQUM1QkMsTUFBTSxFQUFFLFdBQVc7RUFDbkJDLFdBQVcsRUFBRSxXQUFXO0VBQ3hCQyxlQUFlLEVBQUUsUUFBUTtFQUN6QkMsYUFBYSxFQUFFLEtBQUs7RUFDcEJDLFNBQVMsRUFBRSxLQUFLO0VBQ2hCQyxpQkFBaUIsRUFBRSxDQUFDO0VBQ3BCQyxlQUFlLEVBQUUsaUJBQWlCO0VBQ2xDQyxVQUFVLEVBQUU7SUFDVkMsS0FBSyxFQUFFLFVBQVU7SUFDakJDLE1BQU0sRUFBRTtFQUNWLENBQUM7RUFDREMsU0FBUyxFQUFFO0lBQUVBLFNBQVMsRUFBRTtFQUF1QyxDQUFDO0VBQ2hFQyxTQUFTLEVBQUUsMEJBQTBCO0VBQ3JDQyxXQUFXLEVBQUUsMEJBQTBCO0VBQ3ZDQyxTQUFTLEVBQUUsMEJBQTBCO0VBQ3JDQyxTQUFTLEVBQUU7QUFDYixDQUFDO0FBRUQsU0FBU0MsWUFBWUEsQ0FDbkJDLElBQWEsRUFDYmhCLE1BQU0sR0FBRyxHQUFHLEVBQ1ppQixPQUFnQyxFQUNoQztFQUNBLE9BQU87SUFDTGpCLE1BQU07SUFDTmtCLFdBQVcsRUFBRSxrQkFBa0I7SUFDL0IsSUFBSUQsT0FBTyxHQUFHO01BQUVBO0lBQVEsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDO0lBQy9CRCxJQUFJLEVBQUVHLElBQUksQ0FBQ0MsU0FBUyxDQUFDSixJQUFJO0VBQzNCLENBQUM7QUFDSDtBQUVBLGVBQWVLLDBCQUEwQkEsQ0FBQ0MsSUFBVSxFQUFFO0VBQ3BELE1BQU1DLFFBQVEsR0FBRyxNQUFNRCxJQUFJLENBQUNFLFFBQVEsQ0FBQyxPQUFPO0lBQzFDQyxRQUFRLEVBQUVBLFFBQVEsQ0FBQ0MsZUFBZSxDQUFDQyxXQUFXO0lBQzlDWCxJQUFJLEVBQUVTLFFBQVEsQ0FBQ1QsSUFBSSxDQUFDVyxXQUFXO0lBQy9CQyxRQUFRLEVBQUVDLE1BQU0sQ0FBQ0M7RUFDbkIsQ0FBQyxDQUFDLENBQUM7RUFDSDdHLE1BQU0sQ0FBQ3NHLFFBQVEsQ0FBQ0UsUUFBUSxDQUFDLENBQUNNLG1CQUFtQixDQUFDUixRQUFRLENBQUNLLFFBQVEsR0FBRyxDQUFDLENBQUM7RUFDcEUzRyxNQUFNLENBQUNzRyxRQUFRLENBQUNQLElBQUksQ0FBQyxDQUFDZSxtQkFBbUIsQ0FBQ1IsUUFBUSxDQUFDSyxRQUFRLEdBQUcsQ0FBQyxDQUFDO0FBQ2xFO0FBRUEsZUFBZUksb0JBQW9CQSxDQUFDVixJQUFVLEVBQUU7RUFDOUMsTUFBTXJHLE1BQU0sQ0FDVnFHLElBQUksQ0FBQ1csU0FBUyxDQUFDLFNBQVMsRUFBRTtJQUFFQyxJQUFJLEVBQUU7RUFBa0IsQ0FBQyxDQUN2RCxDQUFDLENBQUNDLFdBQVcsQ0FBQyxDQUFDO0VBQ2YsTUFBTWxILE1BQU0sQ0FBQ3FHLElBQUksQ0FBQ2MsU0FBUyxDQUFDLGVBQWUsRUFBRTtJQUFFQyxLQUFLLEVBQUU7RUFBSyxDQUFDLENBQUMsQ0FBQyxDQUFDRixXQUFXLENBQUMsQ0FBQztBQUM5RTtBQUVBLGVBQWVHLHFCQUFxQkEsQ0FBQ2hCLElBQVUsRUFBRTtFQUMvQyxNQUFNaUIsVUFBVSxHQUFHeEcsT0FBTyxDQUFDQyxHQUFHLENBQUN3Ryx5QkFBeUI7RUFDeEQsSUFBSSxDQUFDRCxVQUFVLEVBQUUsTUFBTSxJQUFJdkYsS0FBSyxDQUFDLDRDQUE0QyxDQUFDO0VBQzlFLE1BQU15RixRQUFRLEdBQUcsTUFBTW5CLElBQUksQ0FBQ29CLE9BQU8sQ0FBQ0MsSUFBSSxDQUFDLEdBQUdKLFVBQVUsY0FBYyxFQUFFO0lBQ3BFSyxPQUFPLEVBQUU7RUFDWCxDQUFDLENBQUM7RUFDRjNILE1BQU0sQ0FBQ3dILFFBQVEsQ0FBQ3pDLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQzZDLElBQUksQ0FBQyxHQUFHLENBQUM7QUFDckM7QUFhQSxlQUFlQyxrQkFBa0JBLENBQy9CeEIsSUFBVSxFQUNWeUIsU0FxREMsRUFDRDtFQUNBLE1BQU16QixJQUFJLENBQUMwQixLQUFLLENBQUMsV0FBVyxFQUFFLE1BQU9BLEtBQUssSUFBSztJQUFBLElBQUFDLElBQUEsRUFBQUMscUJBQUEsRUFBQUMsc0JBQUEsRUFBQUMsc0JBQUE7SUFDN0MsTUFBTUMsR0FBRyxHQUFHLElBQUloRixHQUFHLENBQUMyRSxLQUFLLENBQUNOLE9BQU8sQ0FBQyxDQUFDLENBQUNXLEdBQUcsQ0FBQyxDQUFDLENBQUM7SUFDMUMsTUFBTUMsSUFBSSxHQUFHRCxHQUFHLENBQUMvRSxRQUFRLENBQUNpRixPQUFPLENBQUMsc0JBQXNCLEVBQUUsRUFBRSxDQUFDO0lBQzdELE1BQU1DLFFBQVEsR0FBR1QsU0FBUyxhQUFUQSxTQUFTLHVCQUFUQSxTQUFTLENBQUVTLFFBQVE7SUFDcEMsTUFBTUMsV0FBVyxHQUFHVixTQUFTLGFBQVRBLFNBQVMsdUJBQVRBLFNBQVMsQ0FBRVUsV0FBVztJQUMxQyxNQUFNQyxZQUFZLEdBQUdYLFNBQVMsYUFBVEEsU0FBUyx1QkFBVEEsU0FBUyxDQUFFVyxZQUFZO0lBQzVDLE1BQU1DLFVBQVUsR0FBRyxDQUFDSCxRQUFRLEVBQUVDLFdBQVcsRUFBRUMsWUFBWSxDQUFDLENBQUN6RixNQUFNLENBQzVEMkYsT0FBTyxJQUFpQzFGLE9BQU8sQ0FBQzBGLE9BQU8sQ0FDMUQsQ0FBQztJQUVELElBQUlELFVBQVUsQ0FBQ3hGLE1BQU0sR0FBRyxDQUFDLElBQUltRixJQUFJLENBQUNPLFFBQVEsQ0FBQyx1QkFBdUIsQ0FBQyxFQUFFO01BQ25FLE1BQU0xRSxTQUFTLEdBQUdrRSxHQUFHLENBQUNTLFlBQVksQ0FBQ0MsR0FBRyxDQUFDLFdBQVcsQ0FBQztNQUNuRCxNQUFNQyxlQUFlLEdBQUdMLFVBQVUsQ0FBQzFGLE1BQU0sQ0FDdEMyRixPQUFPLElBQUssQ0FBQ0EsT0FBTyxDQUFDekUsU0FBUyxJQUFJeUUsT0FBTyxDQUFDekUsU0FBUyxLQUFLQSxTQUMzRCxDQUFDO01BQ0QsT0FBTzZELEtBQUssQ0FBQ2lCLE9BQU8sQ0FDbEJsRCxZQUFZLENBQ1ZpRCxlQUFlLENBQUNqRyxHQUFHLENBQUU2RixPQUFPLEtBQU07UUFDaENwRSxFQUFFLEVBQUVvRSxPQUFPLENBQUNNLFNBQVM7UUFDckJDLEtBQUssRUFBRVAsT0FBTyxDQUFDUSxRQUFRO1FBQ3ZCdEQsU0FBUyxFQUFFO01BQ2IsQ0FBQyxDQUFDLENBQ0osQ0FDRixDQUFDO0lBQ0g7SUFDQSxJQUFJaUMsU0FBUyxhQUFUQSxTQUFTLGVBQVRBLFNBQVMsQ0FBRXNCLGFBQWEsSUFBSWYsSUFBSSxDQUFDTyxRQUFRLENBQUMscUJBQXFCLENBQUMsRUFBRTtNQUNwRSxJQUFJUyxXQUFvQyxHQUFHLENBQUMsQ0FBQztNQUM3QyxJQUFJO1FBQ0ZBLFdBQVcsR0FBR3RCLEtBQUssQ0FBQ04sT0FBTyxDQUFDLENBQUMsQ0FBQzZCLFlBQVksQ0FBQyxDQUE0QjtNQUN6RSxDQUFDLENBQUMsTUFBTTtRQUNOO01BQUE7TUFFRixJQUNFRCxXQUFXLENBQUNFLFdBQVcsS0FBS3pCLFNBQVMsQ0FBQ3NCLGFBQWEsQ0FBQ1QsT0FBTyxDQUFDWSxXQUFXLEVBQ3ZFO1FBQ0EsT0FBT3hCLEtBQUssQ0FBQ2lCLE9BQU8sQ0FBQztVQUNuQmpFLE1BQU0sRUFBRSxHQUFHO1VBQ1hrQixXQUFXLEVBQUUsbUJBQW1CO1VBQ2hDRCxPQUFPLEVBQUU7WUFBRSxlQUFlLEVBQUU7VUFBVyxDQUFDO1VBQ3hDRCxJQUFJLEVBQUUrQixTQUFTLENBQUNzQixhQUFhLENBQUNULE9BQU8sQ0FBQ2E7UUFDeEMsQ0FBQyxDQUFDO01BQ0o7SUFDRjtJQUNBLElBQUkxQixTQUFTLGFBQVRBLFNBQVMsZUFBVEEsU0FBUyxDQUFFMkIsaUJBQWlCLElBQUlwQixJQUFJLENBQUNPLFFBQVEsQ0FBQyxxQkFBcUIsQ0FBQyxFQUFFO01BQ3hFLElBQUlTLFdBQW9DLEdBQUcsQ0FBQyxDQUFDO01BQzdDLElBQUk7UUFDRkEsV0FBVyxHQUFHdEIsS0FBSyxDQUFDTixPQUFPLENBQUMsQ0FBQyxDQUFDNkIsWUFBWSxDQUFDLENBQTRCO01BQ3pFLENBQUMsQ0FBQyxNQUFNO1FBQ047TUFBQTtNQUVGLE1BQU07UUFBRVgsT0FBTztRQUFFZTtNQUFrQixDQUFDLEdBQUc1QixTQUFTLENBQUMyQixpQkFBaUI7TUFDbEUsSUFBSUosV0FBVyxDQUFDRSxXQUFXLEtBQUtaLE9BQU8sQ0FBQ1ksV0FBVyxFQUFFO1FBQ25ELE9BQU94QixLQUFLLENBQUNpQixPQUFPLENBQUM7VUFDbkJqRSxNQUFNLEVBQUUsR0FBRztVQUNYa0IsV0FBVyxFQUFFLG1CQUFtQjtVQUNoQ0QsT0FBTyxFQUFFO1lBQUUsZUFBZSxFQUFFO1VBQVcsQ0FBQztVQUN4Q0QsSUFBSSxFQUFFMkQ7UUFDUixDQUFDLENBQUM7TUFDSjtNQUNBLElBQUksQ0FBQ0wsV0FBVyxDQUFDRSxXQUFXLEVBQUU7UUFDNUIsT0FBT3hCLEtBQUssQ0FBQ2lCLE9BQU8sQ0FBQztVQUNuQmpFLE1BQU0sRUFBRSxHQUFHO1VBQ1hrQixXQUFXLEVBQUUsbUJBQW1CO1VBQ2hDRCxPQUFPLEVBQUU7WUFBRSxlQUFlLEVBQUU7VUFBVyxDQUFDO1VBQ3hDO1VBQ0E7VUFDQUQsSUFBSSxFQUFFNEMsT0FBTyxDQUFDYTtRQUNoQixDQUFDLENBQUM7TUFDSjtJQUNGO0lBQ0EsSUFBSUcsZ0JBQW9DO0lBQ3hDLElBQUk7TUFDRkEsZ0JBQWdCLEdBQUk1QixLQUFLLENBQUNOLE9BQU8sQ0FBQyxDQUFDLENBQUM2QixZQUFZLENBQUMsQ0FBQyxDQUMvQzVFLE9BQTZCO0lBQ2xDLENBQUMsQ0FBQyxNQUFNO01BQ047SUFBQTtJQUVGLE1BQU1rRixhQUFhLElBQUE1QixJQUFBLEdBQ2pCUyxZQUFZLGFBQVpBLFlBQVksY0FBWkEsWUFBWSxHQUNaQyxVQUFVLENBQUNtQixJQUFJLENBQ1psQixPQUFPLElBQ04sT0FBT2dCLGdCQUFnQixLQUFLLFFBQVEsS0FDbkNBLGdCQUFnQixLQUFLaEIsT0FBTyxDQUFDUSxRQUFRLElBQ3BDUSxnQkFBZ0IsQ0FBQ0csUUFBUSxDQUFDbkIsT0FBTyxDQUFDUSxRQUFRLENBQUMsQ0FDakQsQ0FBQyxjQUFBbkIsSUFBQSxjQUFBQSxJQUFBLEdBQ0RPLFFBQVE7SUFDVixJQUFJcUIsYUFBYSxJQUFJdkIsSUFBSSxDQUFDTyxRQUFRLENBQUMscUJBQXFCLENBQUMsRUFDdkQsT0FBT2IsS0FBSyxDQUFDaUIsT0FBTyxDQUFDO01BQ25CakUsTUFBTSxFQUFFLEdBQUc7TUFDWGtCLFdBQVcsRUFBRSxtQkFBbUI7TUFDaENELE9BQU8sRUFBRTtRQUFFLGVBQWUsRUFBRTtNQUFXLENBQUM7TUFDeENELElBQUksRUFBRTZELGFBQWEsQ0FBQ0o7SUFDdEIsQ0FBQyxDQUFDO0lBQ0osTUFBTU8sY0FBYyxHQUFHckIsVUFBVSxDQUFDbUIsSUFBSSxDQUFFbEIsT0FBTyxJQUM3Q04sSUFBSSxDQUFDTyxRQUFRLENBQUMsZ0JBQWdCRCxPQUFPLENBQUNNLFNBQVMsV0FBVyxDQUM1RCxDQUFDO0lBQ0QsSUFBSWMsY0FBYyxFQUNoQixPQUFPaEMsS0FBSyxDQUFDaUIsT0FBTyxDQUNsQmxELFlBQVksQ0FBQyxDQUNYO01BQ0V2QixFQUFFLEVBQUUsR0FBR3dGLGNBQWMsQ0FBQ2QsU0FBUyxlQUFlO01BQzlDQSxTQUFTLEVBQUVjLGNBQWMsQ0FBQ2QsU0FBUztNQUNuQ2UsSUFBSSxFQUFFLE1BQU07TUFDWkMsT0FBTyxFQUFFRixjQUFjLENBQUNaLFFBQVE7TUFDaEN2RCxTQUFTLEVBQUU7SUFDYixDQUFDLEVBQ0RtRSxjQUFjLENBQUNyRixPQUFPLENBQ3ZCLENBQ0gsQ0FBQztJQUNILElBQ0VvRCxTQUFTLGFBQVRBLFNBQVMsZUFBVEEsU0FBUyxDQUFFb0MsV0FBVyxJQUN0QjdCLElBQUksQ0FBQ08sUUFBUSxDQUFDLHlDQUF5QyxDQUFDLEVBQ3hEO01BQUEsSUFBQXVCLHFCQUFBO01BQ0EsT0FBT3BDLEtBQUssQ0FBQ2lCLE9BQU8sQ0FDbEJsRCxZQUFZLENBQUMsQ0FDWDtRQUNFdkIsRUFBRSxFQUFFLHdCQUF3QjtRQUM1QjBFLFNBQVMsRUFBRSxtQkFBbUI7UUFDOUJlLElBQUksRUFBRSxNQUFNO1FBQ1pDLE9BQU8sRUFBRSwyQkFBMkI7UUFDcENyRSxTQUFTLEVBQUU7TUFDYixDQUFDLEVBQ0Q7UUFDRXJCLEVBQUUsRUFBRSw2QkFBNkI7UUFDakMwRSxTQUFTLEVBQUUsbUJBQW1CO1FBQzlCZSxJQUFJLEVBQUUsV0FBVztRQUNqQkMsT0FBTyxFQUFFLDJCQUEyQjtRQUNwQ1YsV0FBVyxFQUFFdEksWUFBWTtRQUN6Qm1KLE9BQU8sR0FBQUQscUJBQUEsR0FBRXJDLFNBQVMsQ0FBQ29DLFdBQVcsQ0FBQ0csY0FBYyxjQUFBRixxQkFBQSxjQUFBQSxxQkFBQSxHQUFJLFdBQVc7UUFDNUR2RSxTQUFTLEVBQUU7TUFDYixDQUFDLENBQ0YsQ0FDSCxDQUFDO0lBQ0g7SUFFQSxJQUFJeUMsSUFBSSxLQUFLLGdCQUFnQixFQUMzQixPQUFPTixLQUFLLENBQUNpQixPQUFPLENBQUNsRCxZQUFZLENBQUN0QyxnQkFBZ0IsQ0FBQyxDQUFDO0lBQ3RELElBQUk2RSxJQUFJLEtBQUssWUFBWSxFQUFFO01BQUEsSUFBQWlDLHFCQUFBO01BQ3pCLE9BQU92QyxLQUFLLENBQUNpQixPQUFPLENBQ2xCbEQsWUFBWSxFQUFBd0UscUJBQUEsR0FDVnhDLFNBQVMsYUFBVEEsU0FBUyx1QkFBVEEsU0FBUyxDQUFFeUMsYUFBYSxjQUFBRCxxQkFBQSxjQUFBQSxxQkFBQSxHQUNyQnhDLFNBQVMsYUFBVEEsU0FBUyxlQUFUQSxTQUFTLENBQUUwQyxRQUFRLEdBQ2hCLENBQ0U7UUFDRWpHLEVBQUUsRUFBRXVELFNBQVMsQ0FBQzBDLFFBQVEsQ0FBQ2pHLEVBQUU7UUFDekJMLFNBQVMsRUFBRTRELFNBQVMsQ0FBQzBDLFFBQVEsQ0FBQ3RHLFNBQVM7UUFDdkNnRixLQUFLLEVBQUVwQixTQUFTLENBQUMwQyxRQUFRLENBQUN0QixLQUFLO1FBQy9CdUIsV0FBVyxFQUFFLCtDQUErQztRQUM1RDFGLE1BQU0sRUFBRSxTQUFTO1FBQ2pCMkYsUUFBUSxFQUFFLElBQUk7UUFDZEMsWUFBWSxFQUFFLEVBQUU7UUFDaEJDLFVBQVUsRUFBRSxDQUFDO1FBQ2JDLFVBQVUsRUFBRSxDQUFDO1FBQ2JqRixTQUFTLEVBQUUsMEJBQTBCO1FBQ3JDQyxTQUFTLEVBQUU7TUFDYixDQUFDLENBQ0YsR0FDRCxFQUNSLENBQ0YsQ0FBQztJQUNIO0lBQ0EsSUFBSXdDLElBQUksS0FBSyxnQkFBZ0IsRUFBRTtNQUFBLElBQUF5QyxxQkFBQTtNQUM3QixPQUFPL0MsS0FBSyxDQUFDaUIsT0FBTyxDQUNsQmxELFlBQVksRUFBQWdGLHFCQUFBLEdBQUNoRCxTQUFTLGFBQVRBLFNBQVMsdUJBQVRBLFNBQVMsQ0FBRWlELGlCQUFpQixjQUFBRCxxQkFBQSxjQUFBQSxxQkFBQSxHQUFJLEVBQUUsQ0FDakQsQ0FBQztJQUNIO0lBQ0EsTUFBTUUsdUJBQXVCLEdBQUczQyxJQUFJLENBQUM0QyxLQUFLLENBQ3hDLHlDQUNGLENBQUM7SUFDRCxJQUFJRCx1QkFBdUIsRUFBRTtNQUFBLElBQUFFLHNCQUFBLEVBQUFDLHNCQUFBO01BQzNCLE9BQU9wRCxLQUFLLENBQUNpQixPQUFPLENBQ2xCbEQsWUFBWSxFQUFBb0Ysc0JBQUEsR0FDVnBELFNBQVMsYUFBVEEsU0FBUyxnQkFBQXFELHNCQUFBLEdBQVRyRCxTQUFTLENBQUVzRCwwQkFBMEIsY0FBQUQsc0JBQUEsdUJBQXJDQSxzQkFBQSxDQUF3Q0gsdUJBQXVCLENBQUMsQ0FBQyxDQUFDLENBQUMsY0FBQUUsc0JBQUEsY0FBQUEsc0JBQUEsR0FDakUsRUFDSixDQUNGLENBQUM7SUFDSDtJQUNBLElBQ0VwRCxTQUFTLGFBQVRBLFNBQVMsZUFBVEEsU0FBUyxDQUFFb0MsV0FBVyxJQUN0QjdCLElBQUksS0FBSyxzQkFBc0JwSCxZQUFZLGVBQWUsRUFDMUQ7TUFDQTZHLFNBQVMsQ0FBQ29DLFdBQVcsQ0FBQ21CLFFBQVEsQ0FBQ0MsSUFBSSxDQUFDdkQsS0FBSyxDQUFDTixPQUFPLENBQUMsQ0FBQyxDQUFDVyxHQUFHLENBQUMsQ0FBQyxDQUFDO01BQzFELElBQ0VOLFNBQVMsQ0FBQ29DLFdBQVcsQ0FBQ3FCLGdCQUFnQixJQUN0Q3pELFNBQVMsQ0FBQ29DLFdBQVcsQ0FBQ21CLFFBQVEsQ0FBQ25JLE1BQU0sS0FBSyxDQUFDLEVBQzNDO1FBQ0EsT0FBTzZFLEtBQUssQ0FBQ2lCLE9BQU8sQ0FDbEJsRCxZQUFZLENBQ1Y7VUFBRTBGLEtBQUssRUFBRTtRQUFxQyxDQUFDLEVBQy9DLEdBQ0YsQ0FDRixDQUFDO01BQ0g7TUFDQSxPQUFPekQsS0FBSyxDQUFDaUIsT0FBTyxDQUNsQmxELFlBQVksQ0FBQ2dDLFNBQVMsQ0FBQ29DLFdBQVcsQ0FBQ25FLElBQUksRUFBRSxHQUFHLEVBQUU7UUFDNUMscUJBQXFCLEVBQUUseUJBQXlCK0IsU0FBUyxDQUFDb0MsV0FBVyxDQUFDdUIsUUFBUTtNQUNoRixDQUFDLENBQ0gsQ0FBQztJQUNIO0lBQ0EsSUFBSTNELFNBQVMsYUFBVEEsU0FBUyxlQUFUQSxTQUFTLENBQUU0RCxhQUFhLElBQUlyRCxJQUFJLEtBQUsscUJBQXFCLEVBQUU7TUFBQSxJQUFBc0QscUJBQUE7TUFDOUQsTUFBTTFGLFdBQVcsSUFBQTBGLHFCQUFBLEdBQUc1RCxLQUFLLENBQUNOLE9BQU8sQ0FBQyxDQUFDLENBQUN6QixPQUFPLENBQUMsQ0FBQyxDQUFDLGNBQWMsQ0FBQyxjQUFBMkYscUJBQUEsY0FBQUEscUJBQUEsR0FBSSxFQUFFO01BQ25FLElBQUksQ0FBQzFGLFdBQVcsQ0FBQzJGLFVBQVUsQ0FBQyxzQkFBc0IsQ0FBQyxFQUFFO1FBQ25ELE9BQU83RCxLQUFLLENBQUNpQixPQUFPLENBQ2xCbEQsWUFBWSxDQUFDO1VBQUUwRixLQUFLLEVBQUU7UUFBcUMsQ0FBQyxFQUFFLEdBQUcsQ0FDbkUsQ0FBQztNQUNIO01BQ0EsTUFBTXpGLElBQUksR0FBR2dDLEtBQUssQ0FBQ04sT0FBTyxDQUFDLENBQUMsQ0FBQ29FLGNBQWMsQ0FBQyxDQUFDO01BQzdDLElBQUksRUFBQzlGLElBQUksYUFBSkEsSUFBSSxlQUFKQSxJQUFJLENBQUUrRCxRQUFRLENBQUNnQyxNQUFNLENBQUNDLElBQUksQ0FBQyx1QkFBdUIsQ0FBQyxDQUFDLEdBQUU7UUFDekQsT0FBT2hFLEtBQUssQ0FBQ2lCLE9BQU8sQ0FDbEJsRCxZQUFZLENBQUM7VUFBRTBGLEtBQUssRUFBRTtRQUF3QyxDQUFDLEVBQUUsR0FBRyxDQUN0RSxDQUFDO01BQ0g7TUFDQSxPQUFPekQsS0FBSyxDQUFDaUIsT0FBTyxDQUNsQmxELFlBQVksQ0FDVjtRQUNFa0csUUFBUSxFQUFFbEUsU0FBUyxDQUFDNEQsYUFBYSxDQUFDTSxRQUFRO1FBQzFDQyxZQUFZLEVBQUVuRSxTQUFTLENBQUM0RCxhQUFhLENBQUNPO01BQ3hDLENBQUMsRUFDRCxHQUFHLEVBQ0g7UUFDRSw2QkFBNkIsRUFBRSxJQUFJN0ksR0FBRyxDQUFDaUQsSUFBSSxDQUFDK0IsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDckYsTUFBTTtRQUN6RCxrQ0FBa0MsRUFBRTtNQUN0QyxDQUNGLENBQ0YsQ0FBQztJQUNIO0lBQ0EsSUFBSStFLFNBQVMsYUFBVEEsU0FBUyxlQUFUQSxTQUFTLENBQUUwQyxRQUFRLElBQUluQyxJQUFJLEtBQUssWUFBWSxFQUFFO01BQ2hELE9BQU9OLEtBQUssQ0FBQ2lCLE9BQU8sQ0FDbEJsRCxZQUFZLENBQUMsQ0FDWDtRQUNFdkIsRUFBRSxFQUFFdUQsU0FBUyxDQUFDMEMsUUFBUSxDQUFDakcsRUFBRTtRQUN6QkwsU0FBUyxFQUFFNEQsU0FBUyxDQUFDMEMsUUFBUSxDQUFDdEcsU0FBUztRQUN2Q2dGLEtBQUssRUFBRXBCLFNBQVMsQ0FBQzBDLFFBQVEsQ0FBQ3RCLEtBQUs7UUFDL0J1QixXQUFXLEVBQUUsK0NBQStDO1FBQzVEMUYsTUFBTSxFQUFFLFNBQVM7UUFDakJtSCxLQUFLLEVBQUUsV0FBVztRQUNsQnZCLFlBQVksRUFBRSxFQUFFO1FBQ2hCQyxVQUFVLEVBQUUsQ0FBQztRQUNiQyxVQUFVLEVBQUUsQ0FBQztRQUNiakYsU0FBUyxFQUFFLDBCQUEwQjtRQUNyQ0MsU0FBUyxFQUFFO01BQ2IsQ0FBQyxDQUNGLENBQ0gsQ0FBQztJQUNIO0lBQ0EsSUFDRWlDLFNBQVMsYUFBVEEsU0FBUyxlQUFUQSxTQUFTLENBQUUwQyxRQUFRLElBQ25CbkMsSUFBSSxLQUFLLGNBQWNQLFNBQVMsQ0FBQzBDLFFBQVEsQ0FBQ2pHLEVBQUUsT0FBTyxFQUNuRDtNQUFBLElBQUE0SCxxQkFBQTtNQUNBLE9BQU9wRSxLQUFLLENBQUNpQixPQUFPLENBQUNsRCxZQUFZLEVBQUFxRyxxQkFBQSxHQUFDckUsU0FBUyxDQUFDMEMsUUFBUSxDQUFDNEIsV0FBVyxjQUFBRCxxQkFBQSxjQUFBQSxxQkFBQSxHQUFJLEVBQUUsQ0FBQyxDQUFDO0lBQzFFO0lBQ0EsSUFDRXJFLFNBQVMsYUFBVEEsU0FBUyxlQUFUQSxTQUFTLENBQUUwQyxRQUFRLElBQ25CbkMsSUFBSSxLQUFLLGNBQWNQLFNBQVMsQ0FBQzBDLFFBQVEsQ0FBQ2pHLEVBQUUsY0FBYyxFQUMxRDtNQUNBLE1BQU04SCxjQUFjLEdBQUd2RSxTQUFTLENBQUMwQyxRQUFRLENBQUM2QixjQUFjO01BQ3hEQSxjQUFjLGFBQWRBLGNBQWMsZUFBZEEsY0FBYyxDQUFFZixJQUFJLENBQUN2RCxLQUFLLENBQUNOLE9BQU8sQ0FBQyxDQUFDLENBQUNXLEdBQUcsQ0FBQyxDQUFDLENBQUM7TUFDM0MsSUFDR04sU0FBUyxDQUFDMEMsUUFBUSxDQUFDOEIsZUFBZSxJQUFJLENBQUFELGNBQWMsYUFBZEEsY0FBYyx1QkFBZEEsY0FBYyxDQUFFbkosTUFBTSxNQUFLLENBQUMsSUFDbEU0RSxTQUFTLENBQUMwQyxRQUFRLENBQUMrQixrQkFBa0IsSUFDcENGLGNBQWMsSUFDZEEsY0FBYyxDQUFDbkosTUFBTSxJQUFJNEUsU0FBUyxDQUFDMEMsUUFBUSxDQUFDK0Isa0JBQW1CLEVBQ2pFO1FBQ0E7UUFDQTtRQUNBLE9BQU94RSxLQUFLLENBQUN5RSxLQUFLLENBQUMsaUJBQWlCLENBQUM7TUFDdkM7TUFDQSxPQUFPekUsS0FBSyxDQUFDaUIsT0FBTyxDQUFDO1FBQ25CakUsTUFBTSxFQUFFLEdBQUc7UUFDWGtCLFdBQVcsRUFBRSxtQkFBbUI7UUFDaENELE9BQU8sRUFBRTtVQUNQLGVBQWUsRUFBRSxVQUFVO1VBQzNCLDZCQUE2QixFQUFFLElBQUk1QyxHQUFHLENBQUNpRCxJQUFJLENBQUMrQixHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUNyRixNQUFNO1VBQ3pELGtDQUFrQyxFQUFFO1FBQ3RDLENBQUM7UUFDRGdELElBQUksRUFBRSxxQkFBcUJHLElBQUksQ0FBQ0MsU0FBUyxDQUFDMkIsU0FBUyxDQUFDMEMsUUFBUSxDQUFDaUMsR0FBRyxDQUFDO01BQ25FLENBQUMsQ0FBQztJQUNKO0lBQ0EsSUFBSXBFLElBQUksS0FBSyxlQUFlLEVBQUU7TUFBQSxJQUFBcUUsbUJBQUE7TUFDNUIsT0FBTzNFLEtBQUssQ0FBQ2lCLE9BQU8sQ0FDbEJsRCxZQUFZLEVBQUE0RyxtQkFBQSxHQUNWNUUsU0FBUyxhQUFUQSxTQUFTLHVCQUFUQSxTQUFTLENBQUU2RSxRQUFRLGNBQUFELG1CQUFBLGNBQUFBLG1CQUFBLEdBQUksQ0FDckI7UUFDRW5JLEVBQUUsRUFBRSxhQUFhO1FBQ2pCMEMsSUFBSSxFQUFFLGVBQWU7UUFDckIyRixRQUFRLEVBQUUsWUFBWTtRQUN0QkMsU0FBUyxFQUFFLE9BQU87UUFDbEI5SCxNQUFNLEVBQUUsUUFBUTtRQUNoQitILFFBQVEsRUFBRSxtQkFBbUI7UUFDN0JDLFlBQVksRUFBRTtNQUNoQixDQUFDLENBRUwsQ0FDRixDQUFDO0lBQ0g7SUFDQSxJQUNFakYsU0FBUyxhQUFUQSxTQUFTLGVBQVRBLFNBQVMsQ0FBRWtGLGdCQUFnQixJQUMzQjNFLElBQUksS0FBSyw4QkFBOEIsRUFDdkM7TUFDQVAsU0FBUyxDQUFDa0YsZ0JBQWdCLENBQUMzQixRQUFRLENBQUNDLElBQUksQ0FBQ3ZELEtBQUssQ0FBQ04sT0FBTyxDQUFDLENBQUMsQ0FBQ1csR0FBRyxDQUFDLENBQUMsQ0FBQztNQUMvRCxPQUFPTCxLQUFLLENBQUNpQixPQUFPLENBQ2xCbEQsWUFBWSxDQUFDO1FBQUVtSCxVQUFVLEVBQUVuRixTQUFTLENBQUNrRixnQkFBZ0IsQ0FBQ0M7TUFBVyxDQUFDLENBQ3BFLENBQUM7SUFDSDtJQUNBLElBQ0VuRixTQUFTLGFBQVRBLFNBQVMsZ0JBQUFHLHFCQUFBLEdBQVRILFNBQVMsQ0FBRWtGLGdCQUFnQixjQUFBL0UscUJBQUEsZUFBM0JBLHFCQUFBLENBQTZCaUYsY0FBYyxJQUMzQzdFLElBQUksS0FDRixvQkFBb0JQLFNBQVMsQ0FBQ2tGLGdCQUFnQixDQUFDRSxjQUFjLENBQUNDLFVBQVUsSUFBSXJGLFNBQVMsQ0FBQ2tGLGdCQUFnQixDQUFDRSxjQUFjLENBQUNFLE1BQU0sRUFBRSxFQUNoSTtNQUFBLElBQUFDLHNCQUFBLEVBQUFDLHNCQUFBO01BQ0EsQ0FBQUQsc0JBQUEsR0FBQXZGLFNBQVMsQ0FBQ2tGLGdCQUFnQixDQUFDTyxjQUFjLGNBQUFGLHNCQUFBLGVBQXpDQSxzQkFBQSxDQUEyQy9CLElBQUksQ0FBQ3ZELEtBQUssQ0FBQ04sT0FBTyxDQUFDLENBQUMsQ0FBQ1csR0FBRyxDQUFDLENBQUMsQ0FBQztNQUN0RSxJQUFJTixTQUFTLENBQUNrRixnQkFBZ0IsQ0FBQ0UsY0FBYyxDQUFDTSxjQUFjLEVBQUU7UUFDNUQxRixTQUFTLENBQUNrRixnQkFBZ0IsQ0FBQ0MsVUFBVSxHQUNuQ25GLFNBQVMsQ0FBQ2tGLGdCQUFnQixDQUFDRSxjQUFjLENBQUNNLGNBQWM7TUFDNUQ7TUFDQSxPQUFPekYsS0FBSyxDQUFDaUIsT0FBTyxDQUNsQmxELFlBQVksQ0FDVmdDLFNBQVMsQ0FBQ2tGLGdCQUFnQixDQUFDRSxjQUFjLENBQUMxRixRQUFRLEdBQUE4RixzQkFBQSxHQUNsRHhGLFNBQVMsQ0FBQ2tGLGdCQUFnQixDQUFDRSxjQUFjLENBQUNuSSxNQUFNLGNBQUF1SSxzQkFBQSxjQUFBQSxzQkFBQSxHQUFJLEdBQ3RELENBQ0YsQ0FBQztJQUNIO0lBQ0EsSUFBSWpGLElBQUksS0FBSyxhQUFhLEVBQUU7TUFBQSxJQUFBb0YsaUJBQUEsRUFBQUMscUJBQUE7TUFDMUIsTUFBTUMsTUFBTSxJQUFBRixpQkFBQSxHQUFHM0YsU0FBUyxhQUFUQSxTQUFTLHVCQUFUQSxTQUFTLENBQUU2RixNQUFNLGNBQUFGLGlCQUFBLGNBQUFBLGlCQUFBLEdBQUlqSyxnQkFBZ0IsQ0FBQ2MsWUFBWTtNQUNqRSxNQUFNaEIsTUFBTSxJQUFBb0sscUJBQUEsR0FBR3RGLEdBQUcsQ0FBQ1MsWUFBWSxDQUFDQyxHQUFHLENBQUMsUUFBUSxDQUFDLGNBQUE0RSxxQkFBQSx1QkFBOUJBLHFCQUFBLENBQWdDRSxXQUFXLENBQUMsQ0FBQztNQUM1RCxNQUFNQyxjQUFjLEdBQUdGLE1BQU0sQ0FBQzNLLE1BQU0sQ0FBRThLLEtBQUssSUFBSztRQUM5QyxNQUFNNUosU0FBUyxHQUFHa0UsR0FBRyxDQUFDUyxZQUFZLENBQUNDLEdBQUcsQ0FBQyxXQUFXLENBQUM7UUFDbkQsTUFBTXJFLFFBQVEsR0FBRzJELEdBQUcsQ0FBQ1MsWUFBWSxDQUFDQyxHQUFHLENBQUMsVUFBVSxDQUFDO1FBQ2pELE1BQU1pRixhQUFhLEdBQUczRixHQUFHLENBQUNTLFlBQVksQ0FBQ0MsR0FBRyxDQUFDLGVBQWUsQ0FBQztRQUMzRCxPQUNFLENBQUMsQ0FBQzVFLFNBQVMsSUFBSTRKLEtBQUssQ0FBQzVKLFNBQVMsS0FBS0EsU0FBUyxNQUMzQyxDQUFDTyxRQUFRLElBQUlxSixLQUFLLENBQUNySixRQUFRLEtBQUtBLFFBQVEsQ0FBQyxLQUN6QyxDQUFDc0osYUFBYSxJQUFJRCxLQUFLLENBQUNDLGFBQWEsS0FBS0EsYUFBYSxDQUFDLEtBQ3hELENBQUN6SyxNQUFNLElBQ04sQ0FBQ3dLLEtBQUssQ0FBQ3BKLE9BQU8sRUFBRW9KLEtBQUssQ0FBQ3RKLElBQUksRUFBRXNKLEtBQUssQ0FBQ0MsYUFBYSxDQUFDLENBQzdDL0ssTUFBTSxDQUFFZ0wsS0FBSyxJQUFzQixPQUFPQSxLQUFLLEtBQUssUUFBUSxDQUFDLENBQzdEQyxJQUFJLENBQUVELEtBQUssSUFBS0EsS0FBSyxDQUFDSixXQUFXLENBQUMsQ0FBQyxDQUFDOUQsUUFBUSxDQUFDeEcsTUFBTSxDQUFDLENBQUMsQ0FBQztNQUUvRCxDQUFDLENBQUM7TUFDRixNQUFNNEssS0FBSyxHQUFHNUwsTUFBTSxDQUFDOEYsR0FBRyxDQUFDUyxZQUFZLENBQUNDLEdBQUcsQ0FBQyxPQUFPLENBQUMsQ0FBQyxJQUFJLEVBQUU7TUFDekQsTUFBTXpDLElBQUksR0FBRy9ELE1BQU0sQ0FBQzhGLEdBQUcsQ0FBQ1MsWUFBWSxDQUFDQyxHQUFHLENBQUMsTUFBTSxDQUFDLENBQUMsSUFBSSxDQUFDO01BQ3RELE9BQU9mLEtBQUssQ0FBQ2lCLE9BQU8sQ0FDbEJsRCxZQUFZLENBQUM7UUFDWDZILE1BQU0sRUFBRUUsY0FBYyxDQUFDTSxLQUFLLENBQUMsQ0FBQzlILElBQUksR0FBRyxDQUFDLElBQUk2SCxLQUFLLEVBQUU3SCxJQUFJLEdBQUc2SCxLQUFLLENBQUM7UUFDOURFLEtBQUssRUFBRVAsY0FBYyxDQUFDM0s7TUFDeEIsQ0FBQyxDQUNILENBQUM7SUFDSDtJQUNBLElBQ0U0RSxTQUFTLGFBQVRBLFNBQVMsZUFBVEEsU0FBUyxDQUFFc0IsYUFBYSxJQUN4QmYsSUFBSSxLQUNGLHNCQUFzQlAsU0FBUyxDQUFDc0IsYUFBYSxDQUFDVCxPQUFPLENBQUNZLFdBQVcsRUFBRSxFQUNyRTtNQUNBLE9BQU94QixLQUFLLENBQUNpQixPQUFPLENBQUNsRCxZQUFZLENBQUNnQyxTQUFTLENBQUNzQixhQUFhLENBQUNpRixTQUFTLENBQUMsQ0FBQztJQUN2RTtJQUNBLElBQ0V2RyxTQUFTLGFBQVRBLFNBQVMsZUFBVEEsU0FBUyxDQUFFMkIsaUJBQWlCLElBQzVCcEIsSUFBSSxLQUNGLHNCQUFzQlAsU0FBUyxDQUFDMkIsaUJBQWlCLENBQUNkLE9BQU8sQ0FBQ1ksV0FBVyxFQUFFLEVBQ3pFO01BQ0EsT0FBT3hCLEtBQUssQ0FBQ2lCLE9BQU8sQ0FBQ2xELFlBQVksQ0FBQ2dDLFNBQVMsQ0FBQzJCLGlCQUFpQixDQUFDNEUsU0FBUyxDQUFDLENBQUM7SUFDM0U7SUFDQSxJQUNFdkcsU0FBUyxhQUFUQSxTQUFTLGVBQVRBLFNBQVMsQ0FBRTJCLGlCQUFpQixJQUM1QnBCLElBQUksS0FDRixzQkFBc0JQLFNBQVMsQ0FBQzJCLGlCQUFpQixDQUFDZCxPQUFPLENBQUNZLFdBQVcsb0JBQW9CLEVBQzNGO01BQ0EsT0FBT3hCLEtBQUssQ0FBQ2lCLE9BQU8sQ0FDbEJsRCxZQUFZLENBQUM7UUFDWHlELFdBQVcsRUFBRXpCLFNBQVMsQ0FBQzJCLGlCQUFpQixDQUFDZCxPQUFPLENBQUNZLFdBQVc7UUFDNUQrRSxXQUFXLEVBQUV4RyxTQUFTLENBQUMyQixpQkFBaUIsQ0FBQzhFO01BQzNDLENBQUMsQ0FDSCxDQUFDO0lBQ0g7SUFDQSxJQUFJbEcsSUFBSSxLQUFLLHNCQUFzQnBILFlBQVksRUFBRSxFQUMvQyxPQUFPOEcsS0FBSyxDQUFDaUIsT0FBTyxDQUNsQmxELFlBQVksRUFBQW9DLHNCQUFBLEdBQUNKLFNBQVMsYUFBVEEsU0FBUyxnQkFBQUssc0JBQUEsR0FBVEwsU0FBUyxDQUFFb0MsV0FBVyxjQUFBL0Isc0JBQUEsdUJBQXRCQSxzQkFBQSxDQUF3QmtHLFNBQVMsY0FBQW5HLHNCQUFBLGNBQUFBLHNCQUFBLEdBQUlyRCxnQkFBZ0IsQ0FDcEUsQ0FBQztJQUNILElBQUl3RCxJQUFJLEtBQUsseUJBQXlCLEVBQ3BDLE9BQU9OLEtBQUssQ0FBQ2lCLE9BQU8sQ0FDbEJsRCxZQUFZLENBQUM7TUFBRUQsU0FBUyxFQUFFLDBCQUEwQjtNQUFFMkksVUFBVSxFQUFFO0lBQUcsQ0FBQyxDQUN4RSxDQUFDOztJQUVIO0lBQ0E7SUFDQSxJQUFJbkcsSUFBSSxDQUFDdUQsVUFBVSxDQUFDLFVBQVUsQ0FBQyxFQUM3QixPQUFPN0QsS0FBSyxDQUFDaUIsT0FBTyxDQUNsQmxELFlBQVksQ0FBQztNQUFFMEYsS0FBSyxFQUFFO0lBQTZCLENBQUMsRUFBRSxHQUFHLENBQzNELENBQUM7SUFFSCxPQUFPekQsS0FBSyxDQUFDMEcsUUFBUSxDQUFDLENBQUM7RUFDekIsQ0FBQyxDQUFDO0FBQ0o7QUFFQSxlQUFlQyxzQkFBc0JBLENBQ25DckksSUFBVSxFQUNWc0ksT0FLQyxFQUNEO0VBQUEsSUFBQUMsa0JBQUEsRUFBQUMsaUJBQUE7RUFDQSxNQUFNNUYsU0FBUyxJQUFBMkYsa0JBQUEsR0FBR0QsT0FBTyxhQUFQQSxPQUFPLHVCQUFQQSxPQUFPLENBQUUxRixTQUFTLGNBQUEyRixrQkFBQSxjQUFBQSxrQkFBQSxHQUFJLHVCQUF1QjtFQUMvRCxNQUFNRSxTQUFTLEdBQUcsdUJBQXVCO0VBQ3pDLE1BQU1DLE1BQU0sR0FBRyx3QkFBd0I7RUFDdkMsTUFBTUMsT0FBTyxHQUFHLENBQUFMLE9BQU8sYUFBUEEsT0FBTyx1QkFBUEEsT0FBTyxDQUFFSyxPQUFPLE1BQUssSUFBSTtFQUN6QyxNQUFNN0YsUUFBUSxJQUFBMEYsaUJBQUEsR0FDWkYsT0FBTyxhQUFQQSxPQUFPLHVCQUFQQSxPQUFPLENBQUV4RixRQUFRLGNBQUEwRixpQkFBQSxjQUFBQSxpQkFBQSxHQUNqQixxRUFBcUU7RUFDdkUsTUFBTUksTUFBTSxHQUNWLG9IQUFvSDtFQUN0SCxNQUFNQyxRQUFRLEdBQUcsQ0FDZjtJQUNFSCxNQUFNO0lBQ04sSUFBSUMsT0FBTyxHQUNQO01BQ0VHLE9BQU8sRUFBRSxrQ0FBa0M7TUFDM0NDLGFBQWEsRUFBRSxLQUFLO01BQ3BCQyxhQUFhLEVBQUUsZ0JBQWdCO01BQy9CQyxjQUFjLEVBQUUsU0FBUztNQUN6QkMsY0FBYyxFQUFFO0lBQ2xCLENBQUMsR0FDRDtNQUNFSixPQUFPLEVBQUUsMERBQTBEO01BQ25FSyxVQUFVLEVBQUU7UUFBRUMsU0FBUyxFQUFFLEVBQUU7UUFBRUMsT0FBTyxFQUFFO01BQUcsQ0FBQztNQUMxQ04sYUFBYSxFQUFFLElBQUk7TUFDbkJDLGFBQWEsRUFBRSxpQkFBaUI7TUFDaENDLGNBQWMsRUFBRSxVQUFVO01BQzFCQyxjQUFjLEVBQUU7SUFDbEIsQ0FBQztFQUNQLENBQUMsQ0FDRjtFQUNELE1BQU1JLFNBQVMsR0FBRyxDQUNoQjtJQUNFQyxJQUFJLEVBQUUsV0FBVztJQUNqQkMsSUFBSSxFQUFFLFdBQVc7SUFDakJDLElBQUksRUFBRTtNQUFFekgsSUFBSSxFQUFFMEc7SUFBTyxDQUFDO0lBQ3RCZ0IsTUFBTSxFQUFFLEtBQUs7SUFDYkMsVUFBVSxFQUFFO0VBQ2QsQ0FBQyxFQUNEO0lBQ0VKLElBQUksRUFBRSxhQUFhO0lBQ25CQyxJQUFJLEVBQUUsV0FBVztJQUNqQmQsTUFBTTtJQUNOZ0IsTUFBTSxFQUFFLEtBQUs7SUFDYkMsVUFBVSxFQUFFO0VBQ2QsQ0FBQyxFQUNEO0lBQ0VKLElBQUksRUFBRSxvQkFBb0I7SUFDMUJLLElBQUksRUFBRSx1QkFBdUI7SUFDN0JDLFVBQVUsRUFBRSxJQUFJO0lBQ2hCQyxVQUFVLEVBQUUsRUFBRTtJQUNkQyxpQkFBaUIsRUFBRSxDQUFDO0lBQ3BCQyxxQkFBcUIsRUFBRSxDQUFDO0lBQ3hCQyxrQkFBa0IsRUFBRSxDQUFDdkIsTUFBTSxDQUFDO0lBQzVCd0IscUJBQXFCLEVBQUUsQ0FBQ3hCLE1BQU0sQ0FBQztJQUMvQnlCLGFBQWEsRUFBRSx5QkFBeUI7SUFDeENDLGFBQWEsRUFBRSxDQUFDLGdCQUFnQixFQUFFLGtCQUFrQixDQUFDO0lBQ3JEQyxXQUFXLEVBQUUsQ0FBQyxnQkFBZ0IsQ0FBQztJQUMvQkMsb0JBQW9CLEVBQUUsa0JBQWtCO0lBQ3hDQyxlQUFlLEVBQUU7RUFDbkIsQ0FBQyxDQUNGO0VBQ0QsTUFBTUMsVUFBVSxHQUFHO0lBQ2pCakIsSUFBSSxFQUFFLHdCQUF3QjtJQUM5QlgsTUFBTSxFQUFFO01BQ05BLE1BQU07TUFDTkMsUUFBUTtNQUNSNEIsVUFBVSxFQUFFLENBQUM7TUFDYkMsV0FBVyxFQUFFLENBQUNoQyxNQUFNLENBQUM7TUFDckJpQyxRQUFRLEVBQUU7UUFDUkMsZUFBZSxFQUFFLENBQUMsa0JBQWtCLENBQUM7UUFDckNDLGNBQWMsRUFBRSxDQUFDLGtCQUFrQixDQUFDO1FBQ3BDQyxhQUFhLEVBQUUsRUFBRTtRQUNqQkMsUUFBUSxFQUFFO01BQ1o7SUFDRjtFQUNGLENBQUM7RUFDRCxNQUFNMU0sT0FBTyxHQUFHO0lBQ2RILEVBQUUsRUFBRXVLLFNBQVM7SUFDYjdGLFNBQVM7SUFDVGUsSUFBSSxFQUFFLFdBQVc7SUFDakJDLE9BQU8sRUFBRSxHQUFHZ0YsTUFBTSxzQ0FBc0M7SUFDeERvQyxhQUFhLEVBQUUsZ0JBQWdCO0lBQy9CQyxPQUFPLEVBQUUsQ0FBQ3ZDLE1BQU0sQ0FBQztJQUNqQlksU0FBUyxFQUFFekosSUFBSSxDQUFDQyxTQUFTLENBQUN3SixTQUFTLENBQUM7SUFDcEM0QixnQkFBZ0IsRUFBRXJDLFFBQVE7SUFDMUIyQixVQUFVO0lBQ1ZqTCxTQUFTLEVBQUU7RUFDYixDQUFDO0VBQ0QsTUFBTTRMLEdBQUcsR0FBSTFELEtBQThCLElBQ3pDLFNBQVM1SCxJQUFJLENBQUNDLFNBQVMsQ0FBQzJILEtBQUssQ0FBQyxNQUFNO0VBQ3RDLE1BQU10RSxVQUFVLEdBQUcsQ0FDakJnSSxHQUFHLENBQUM7SUFBRWhOLElBQUksRUFBRSxpQkFBaUI7SUFBRXlFO0VBQVUsQ0FBQyxDQUFDLEVBQzNDdUksR0FBRyxDQUFDO0lBQ0ZoTixJQUFJLEVBQUUsbUJBQW1CO0lBQ3pCK0UsV0FBVyxFQUFFLGVBQWU7SUFDNUJ4RSxNQUFNLEVBQUUsU0FBUztJQUNqQkksU0FBUyxFQUFFO0VBQ2IsQ0FBQyxDQUFDLEVBQ0ZxTSxHQUFHLENBQUM7SUFBRWhOLElBQUksRUFBRSxPQUFPO0lBQUVlLEtBQUssRUFBRTtFQUFtQixDQUFDLENBQUMsRUFDakRpTSxHQUFHLENBQUM7SUFBRWhOLElBQUksRUFBRSxPQUFPO0lBQUVlLEtBQUssRUFBRTtFQUFnQixDQUFDLENBQUMsRUFDOUNpTSxHQUFHLENBQUM7SUFDRmhOLElBQUksRUFBRSxXQUFXO0lBQ2pCcUwsSUFBSSxFQUFFLFdBQVc7SUFDakJDLElBQUksRUFBRTtNQUFFekgsSUFBSSxFQUFFMEc7SUFBTyxDQUFDO0lBQ3RCZ0IsTUFBTSxFQUFFLEtBQUs7SUFDYkMsVUFBVSxFQUFFO0VBQ2QsQ0FBQyxDQUFDLEVBQ0Z3QixHQUFHLENBQUM7SUFDRmhOLElBQUksRUFBRSxhQUFhO0lBQ25CcUwsSUFBSSxFQUFFLFdBQVc7SUFDakJkLE1BQU07SUFDTmdCLE1BQU0sRUFBRSxLQUFLO0lBQ2JDLFVBQVUsRUFBRTtFQUNkLENBQUMsQ0FBQyxFQUNGd0IsR0FBRyxDQUFDO0lBQ0ZoTixJQUFJLEVBQUUsb0JBQW9CO0lBQzFCeUwsSUFBSSxFQUFFLHVCQUF1QjtJQUM3QkMsVUFBVSxFQUFFLElBQUk7SUFDaEJDLFVBQVUsRUFBRSxFQUFFO0lBQ2RDLGlCQUFpQixFQUFFLENBQUM7SUFDcEJDLHFCQUFxQixFQUFFLENBQUM7SUFDeEJDLGtCQUFrQixFQUFFLENBQUN2QixNQUFNLENBQUM7SUFDNUJ3QixxQkFBcUIsRUFBRSxDQUFDeEIsTUFBTSxDQUFDO0lBQy9CeUIsYUFBYSxFQUFFLHlCQUF5QjtJQUN4Q0MsYUFBYSxFQUFFLENBQUMsZ0JBQWdCLEVBQUUsa0JBQWtCLENBQUM7SUFDckRDLFdBQVcsRUFBRSxDQUFDLGdCQUFnQixDQUFDO0lBQy9CQyxvQkFBb0IsRUFBRSxrQkFBa0I7SUFDeENDLGVBQWUsRUFBRTtFQUNuQixDQUFDLENBQUMsRUFDRlksR0FBRyxDQUFDO0lBQUVoTixJQUFJLEVBQUUsT0FBTztJQUFFaU4sS0FBSyxFQUFFeEM7RUFBTyxDQUFDLENBQUMsRUFDckN1QyxHQUFHLENBQUM7SUFDRmhOLElBQUksRUFBRSxNQUFNO0lBQ1p5RSxTQUFTO0lBQ1R2RSxPQUFPO0lBQ1A0TSxPQUFPLEVBQUUsQ0FBQ3ZDLE1BQU0sQ0FBQztJQUNqQlksU0FBUyxFQUFFekosSUFBSSxDQUFDQyxTQUFTLENBQUN3SixTQUFTLENBQUM7SUFDcEM0QixnQkFBZ0IsRUFBRXJDLFFBQVE7SUFDMUIyQixVQUFVO0lBQ1ZhLGNBQWMsRUFBRTtFQUNsQixDQUFDLENBQUMsQ0FDSCxDQUFDQyxJQUFJLENBQUMsRUFBRSxDQUFDO0VBRVYsT0FBTztJQUNMeEksUUFBUTtJQUNSOEYsTUFBTTtJQUNORixNQUFNO0lBQ045RixTQUFTO0lBQ1QvRSxTQUFTLEVBQUV5SyxPQUFPLGFBQVBBLE9BQU8sdUJBQVBBLE9BQU8sQ0FBRXpLLFNBQVM7SUFDN0JzRixVQUFVO0lBQ1Y5RTtFQUNGLENBQUM7QUFDSDtBQUVBLFNBQVNrTix5QkFBeUJBLENBQUEsRUFBb0I7RUFDcEQsTUFBTTNJLFNBQVMsR0FBRywwQkFBMEI7RUFDNUMsTUFBTTZGLFNBQVMsR0FBRywwQkFBMEI7RUFDNUMsTUFBTUMsTUFBTSxHQUFHLGdDQUFnQztFQUMvQyxNQUFNNUYsUUFBUSxHQUFHLHVEQUF1RDtFQUN4RSxNQUFNOEYsTUFBTSxHQUNWLHFHQUFxRztFQUN2RyxNQUFNNEMsY0FBYyxHQUFHLHVCQUF1QjtFQUM5QyxNQUFNbEMsU0FBUyxHQUFHLENBQ2hCO0lBQ0VDLElBQUksRUFBRSxXQUFXO0lBQ2pCQyxJQUFJLEVBQUUsV0FBVztJQUNqQkMsSUFBSSxFQUFFO01BQUV6SCxJQUFJLEVBQUUwRztJQUFPLENBQUM7SUFDdEJnQixNQUFNLEVBQUU7RUFDVixDQUFDLEVBQ0Q7SUFDRUgsSUFBSSxFQUFFLGFBQWE7SUFDbkJDLElBQUksRUFBRSxXQUFXO0lBQ2pCZCxNQUFNO0lBQ04rQyxVQUFVLEVBQUUsUUFBUTtJQUNwQkQsY0FBYztJQUNkRSxhQUFhLEVBQUU7RUFDakIsQ0FBQyxFQUNEO0lBQ0VuQyxJQUFJLEVBQUUsTUFBTTtJQUNab0MsVUFBVSxFQUFFLGNBQWM7SUFDMUJDLFVBQVUsRUFBRSxDQUFDO0lBQ2JDLGFBQWEsRUFBRSxDQUFDO0lBQ2hCQyxTQUFTLEVBQUUsQ0FBQztJQUNaQyxpQkFBaUIsRUFBRSxDQUFDO0lBQ3BCQyxhQUFhLEVBQUUsQ0FBQztJQUNoQkMsZ0JBQWdCLEVBQUUsS0FBSztJQUN2QkMsZUFBZSxFQUFFLENBQUNWLGNBQWM7RUFDbEMsQ0FBQyxDQUNGO0VBQ0QsTUFBTW5OLE9BQU8sR0FBRztJQUNkSCxFQUFFLEVBQUV1SyxTQUFTO0lBQ2I3RixTQUFTO0lBQ1RlLElBQUksRUFBRSxXQUFXO0lBQ2pCQyxPQUFPLEVBQUVnRixNQUFNO0lBQ2ZVLFNBQVMsRUFBRXpKLElBQUksQ0FBQ0MsU0FBUyxDQUFDd0osU0FBUyxDQUFDO0lBQ3BDL0osU0FBUyxFQUFFO0VBQ2IsQ0FBQztFQUNELE1BQU00TCxHQUFHLEdBQUkxRCxLQUE4QixJQUN6QyxTQUFTNUgsSUFBSSxDQUFDQyxTQUFTLENBQUMySCxLQUFLLENBQUMsTUFBTTtFQUN0QyxNQUFNdEUsVUFBVSxHQUFHLENBQ2pCZ0ksR0FBRyxDQUFDO0lBQUVoTixJQUFJLEVBQUUsaUJBQWlCO0lBQUV5RTtFQUFVLENBQUMsQ0FBQyxFQUMzQ3VJLEdBQUcsQ0FBQztJQUNGaE4sSUFBSSxFQUFFLG1CQUFtQjtJQUN6QitFLFdBQVcsRUFBRSw0QkFBNEI7SUFDekN4RSxNQUFNLEVBQUUsU0FBUztJQUNqQkksU0FBUyxFQUFFO0VBQ2IsQ0FBQyxDQUFDLEVBQ0ZxTSxHQUFHLENBQUM7SUFDRmhOLElBQUksRUFBRSxXQUFXO0lBQ2pCcUwsSUFBSSxFQUFFLFdBQVc7SUFDakJDLElBQUksRUFBRTtNQUFFekgsSUFBSSxFQUFFMEc7SUFBTyxDQUFDO0lBQ3RCZ0IsTUFBTSxFQUFFO0VBQ1YsQ0FBQyxDQUFDLEVBQ0Z5QixHQUFHLENBQUM7SUFDRmhOLElBQUksRUFBRSxhQUFhO0lBQ25CcUwsSUFBSSxFQUFFLFdBQVc7SUFDakJkLE1BQU07SUFDTitDLFVBQVUsRUFBRSxRQUFRO0lBQ3BCRCxjQUFjO0lBQ2RFLGFBQWEsRUFBRTtFQUNqQixDQUFDLENBQUMsRUFDRlAsR0FBRyxDQUFDO0lBQUVoTixJQUFJLEVBQUUsT0FBTztJQUFFaU4sS0FBSyxFQUFFeEM7RUFBTyxDQUFDLENBQUMsRUFDckN1QyxHQUFHLENBQUM7SUFDRmhOLElBQUksRUFBRSxNQUFNO0lBQ1p5RSxTQUFTO0lBQ1R2RSxPQUFPO0lBQ1BpTCxTQUFTLEVBQUV6SixJQUFJLENBQUNDLFNBQVMsQ0FBQ3dKLFNBQVMsQ0FBQztJQUNwQytCLGNBQWMsRUFBRTtFQUNsQixDQUFDLENBQUMsQ0FDSCxDQUFDQyxJQUFJLENBQUMsRUFBRSxDQUFDO0VBRVYsT0FBTztJQUNMeEksUUFBUTtJQUNSOEYsTUFBTTtJQUNORixNQUFNO0lBQ045RixTQUFTO0lBQ1RPLFVBQVU7SUFDVjlFO0VBQ0YsQ0FBQztBQUNIO0FBRUEsU0FBUzhOLDRCQUE0QkEsQ0FBQSxFQUFvQjtFQUN2RCxNQUFNdkosU0FBUyxHQUFHLDZCQUE2QjtFQUMvQyxNQUFNTSxXQUFXLEdBQUcsK0JBQStCO0VBQ25ELE1BQU1KLFFBQVEsR0FDWixtRUFBbUU7RUFDckUsTUFBTThGLE1BQU0sR0FDViwrRUFBK0U7RUFDakYsTUFBTTRDLGNBQWMsR0FBRyw0QkFBNEI7RUFDbkQsTUFBTWxDLFNBQVMsR0FBRyxDQUNoQjtJQUNFQyxJQUFJLEVBQUUsTUFBTTtJQUNab0MsVUFBVSxFQUFFLGtCQUFrQjtJQUM5QkMsVUFBVSxFQUFFLENBQUM7SUFDYkMsYUFBYSxFQUFFLENBQUM7SUFDaEJDLFNBQVMsRUFBRSxDQUFDO0lBQ1pDLGlCQUFpQixFQUFFLENBQUM7SUFDcEJDLGFBQWEsRUFBRSxDQUFDO0lBQ2hCQyxnQkFBZ0IsRUFBRSxLQUFLO0lBQ3ZCQyxlQUFlLEVBQUUsQ0FBQ1YsY0FBYyxDQUFDO0lBQ2pDWSxpQkFBaUIsRUFBRSxDQUNqQix3REFBd0Q7RUFFNUQsQ0FBQyxDQUNGO0VBQ0QsTUFBTS9OLE9BQU8sR0FBRztJQUNkSCxFQUFFLEVBQUUsNkJBQTZCO0lBQ2pDMEUsU0FBUztJQUNUZSxJQUFJLEVBQUUsV0FBVztJQUNqQkMsT0FBTyxFQUFFZ0YsTUFBTTtJQUNmVSxTQUFTLEVBQUV6SixJQUFJLENBQUNDLFNBQVMsQ0FBQ3dKLFNBQVMsQ0FBQztJQUNwQ3ZGLE9BQU8sRUFBRSxRQUFRO0lBQ2pCc0ksU0FBUyxFQUFFYixjQUFjO0lBQ3pCYyxZQUFZLEVBQUUsOENBQThDO0lBQzVEcEosV0FBVztJQUNYM0QsU0FBUyxFQUFFO0VBQ2IsQ0FBQztFQUNELE1BQU00TCxHQUFHLEdBQUkxRCxLQUE4QixJQUN6QyxTQUFTNUgsSUFBSSxDQUFDQyxTQUFTLENBQUMySCxLQUFLLENBQUMsTUFBTTtFQUN0QyxNQUFNdEUsVUFBVSxHQUFHLENBQ2pCZ0ksR0FBRyxDQUFDO0lBQUVoTixJQUFJLEVBQUUsaUJBQWlCO0lBQUV5RTtFQUFVLENBQUMsQ0FBQyxFQUMzQ3VJLEdBQUcsQ0FBQztJQUNGaE4sSUFBSSxFQUFFLG1CQUFtQjtJQUN6QitFLFdBQVc7SUFDWHhFLE1BQU0sRUFBRSxTQUFTO0lBQ2pCSSxTQUFTLEVBQUU7RUFDYixDQUFDLENBQUMsRUFDRnFNLEdBQUcsQ0FBQztJQUFFaE4sSUFBSSxFQUFFLE9BQU87SUFBRWUsS0FBSyxFQUFFO0VBQWdCLENBQUMsQ0FBQyxFQUM5Q2lNLEdBQUcsQ0FBQztJQUFFaE4sSUFBSSxFQUFFLE9BQU87SUFBRWlOLEtBQUssRUFBRXhDO0VBQU8sQ0FBQyxDQUFDO0VBQ3JDO0VBQ0E7RUFDQXVDLEdBQUcsQ0FBQztJQUFFaE4sSUFBSSxFQUFFO0VBQWUsQ0FBQyxDQUFDLEVBQzdCZ04sR0FBRyxDQUFDO0lBQ0ZoTixJQUFJLEVBQUUsTUFBTTtJQUNaeUUsU0FBUztJQUNUTSxXQUFXO0lBQ1g3RSxPQUFPO0lBQ1BnTixjQUFjLEVBQUU7RUFDbEIsQ0FBQyxDQUFDLENBQ0gsQ0FBQ0MsSUFBSSxDQUFDLEVBQUUsQ0FBQztFQUVWLE9BQU87SUFDTHhJLFFBQVE7SUFDUjhGLE1BQU07SUFDTkYsTUFBTSxFQUFFLFVBQVU7SUFDbEI5RixTQUFTO0lBQ1RNLFdBQVc7SUFDWEMsVUFBVTtJQUNWOUU7RUFDRixDQUFDO0FBQ0g7QUFFQSxTQUFTa08sb0NBQW9DQSxDQUFBLEVBQUc7RUFDOUMsTUFBTTNKLFNBQVMsR0FBRyxzQ0FBc0M7RUFDeEQsTUFBTU0sV0FBVyxHQUFHLHdDQUF3QztFQUM1RCxNQUFNK0UsV0FBVyxHQUFHLDJDQUEyQztFQUMvRCxNQUFNbkYsUUFBUSxHQUFHLCtDQUErQztFQUNoRSxNQUFNOEYsTUFBTSxHQUNWLGtHQUFrRztFQUNwRyxNQUFNNEMsY0FBYyxHQUFHLGtCQUFrQjtFQUN6QyxNQUFNTCxHQUFHLEdBQUkxRCxLQUE4QixJQUN6QyxTQUFTNUgsSUFBSSxDQUFDQyxTQUFTLENBQUMySCxLQUFLLENBQUMsTUFBTTtFQUN0QyxNQUFNdEUsVUFBVSxHQUFHLENBQ2pCZ0ksR0FBRyxDQUFDO0lBQUVoTixJQUFJLEVBQUUsaUJBQWlCO0lBQUV5RTtFQUFVLENBQUMsQ0FBQyxFQUMzQ3VJLEdBQUcsQ0FBQztJQUNGaE4sSUFBSSxFQUFFLG1CQUFtQjtJQUN6QitFLFdBQVc7SUFDWHhFLE1BQU0sRUFBRSxTQUFTO0lBQ2pCSSxTQUFTLEVBQUUsSUFBSTtJQUNmbUo7RUFDRixDQUFDLENBQUMsRUFDRmtELEdBQUcsQ0FBQztJQUNGaE4sSUFBSSxFQUFFLE9BQU87SUFDYitFLFdBQVc7SUFDWDBHLElBQUksRUFBRTRCLGNBQWM7SUFDcEJuTixPQUFPLEVBQUU7RUFDWCxDQUFDLENBQUMsQ0FDSCxDQUFDaU4sSUFBSSxDQUFDLEVBQUUsQ0FBQztFQUNWLE1BQU1oSixPQUF3QixHQUFHO0lBQy9CUSxRQUFRO0lBQ1I4RixNQUFNO0lBQ05GLE1BQU0sRUFBRSw4QkFBOEI7SUFDdEM5RixTQUFTO0lBQ1RNLFdBQVc7SUFDWEMsVUFBVTtJQUNWOUUsT0FBTyxFQUFFO01BQ1BILEVBQUUsRUFBRSxzQ0FBc0M7TUFDMUMwRSxTQUFTO01BQ1RlLElBQUksRUFBRSxXQUFXO01BQ2pCQyxPQUFPLEVBQUVnRixNQUFNO01BQ2Y3RSxPQUFPLEVBQUUsUUFBUTtNQUNqQmIsV0FBVztNQUNYbUosU0FBUyxFQUFFYixjQUFjO01BQ3pCYyxZQUFZLEVBQUUseUNBQXlDO01BQ3ZEL00sU0FBUyxFQUFFO0lBQ2I7RUFDRixDQUFDO0VBRUQsT0FBTztJQUNMK0MsT0FBTztJQUNQMEYsU0FBUyxFQUFFO01BQ1Q5SixFQUFFLEVBQUVnRixXQUFXO01BQ2ZyRixTQUFTLEVBQUUsYUFBYTtNQUN4QlksV0FBVyxFQUFFLHdDQUF3QztNQUNyRG1FLFNBQVM7TUFDVGxFLE1BQU0sRUFBRSxRQUFRO01BQ2hCQyxXQUFXLEVBQUUsUUFBUTtNQUNyQkMsZUFBZSxFQUFFLFlBQVk7TUFDN0JDLGFBQWEsRUFBRSxJQUFJO01BQ25CQyxTQUFTLEVBQUUsSUFBSTtNQUNmQyxpQkFBaUIsRUFBRSxDQUFDO01BQ3BCRSxVQUFVLEVBQUU7UUFDVkMsS0FBSyxFQUFFLGdCQUFnQjtRQUN2QkMsTUFBTSxFQUFFO01BQ1YsQ0FBQztNQUNEQyxTQUFTLEVBQUU7UUFBRUEsU0FBUyxFQUFFMEQ7TUFBUyxDQUFDO01BQ2xDcUMsS0FBSyxFQUFFLHlDQUF5QztNQUNoRDlGLFNBQVMsRUFBRSwwQkFBMEI7TUFDckNFLFNBQVMsRUFBRSwwQkFBMEI7TUFDckNDLFNBQVMsRUFBRTtJQUNiO0VBQ0YsQ0FBQztBQUNIO0FBRUEsU0FBU2dOLCtCQUErQkEsQ0FBQSxFQUFHO0VBQ3pDLE1BQU01SixTQUFTLEdBQUcsZ0NBQWdDO0VBQ2xELE1BQU1NLFdBQVcsR0FBRyxrQ0FBa0M7RUFDdEQsTUFBTXVKLFlBQVksR0FBRywrQkFBK0I7RUFDcEQsTUFBTXZFLGNBQWMsR0FBRyxpQ0FBaUM7RUFDeEQsTUFBTXBGLFFBQVEsR0FBRyw2Q0FBNkM7RUFDOUQsTUFBTTRKLGFBQWEsR0FDakIsZ0VBQWdFO0VBQ2xFLE1BQU05RCxNQUFNLEdBQ1YsbUVBQW1FO0VBQ3JFLE1BQU12SyxPQUFPLEdBQUc7SUFDZEgsRUFBRSxFQUFFLGdDQUFnQztJQUNwQzBFLFNBQVM7SUFDVGUsSUFBSSxFQUFFLFdBQVc7SUFDakJDLE9BQU8sRUFBRWdGLE1BQU07SUFDZjFGLFdBQVc7SUFDWGEsT0FBTyxFQUFFLFdBQVc7SUFDcEJ4RSxTQUFTLEVBQUU7RUFDYixDQUFDO0VBQ0QsTUFBTTRMLEdBQUcsR0FBSTFELEtBQThCLElBQ3pDLFNBQVM1SCxJQUFJLENBQUNDLFNBQVMsQ0FBQzJILEtBQUssQ0FBQyxNQUFNO0VBQ3RDLE1BQU1uRixPQUF3QixHQUFHO0lBQy9CUSxRQUFRO0lBQ1I4RixNQUFNO0lBQ05GLE1BQU0sRUFBRSxnQkFBZ0I7SUFDeEI5RixTQUFTO0lBQ1RNLFdBQVc7SUFDWEMsVUFBVSxFQUFFLENBQ1ZnSSxHQUFHLENBQUM7TUFBRWhOLElBQUksRUFBRSxpQkFBaUI7TUFBRXlFO0lBQVUsQ0FBQyxDQUFDLEVBQzNDdUksR0FBRyxDQUFDO01BQ0ZoTixJQUFJLEVBQUUsbUJBQW1CO01BQ3pCK0UsV0FBVztNQUNYeEUsTUFBTSxFQUFFLFNBQVM7TUFDakJJLFNBQVMsRUFBRSxJQUFJO01BQ2ZtSixXQUFXLEVBQUV3RTtJQUNmLENBQUMsQ0FBQyxFQUNGdEIsR0FBRyxDQUFDO01BQUVoTixJQUFJLEVBQUUsT0FBTztNQUFFZSxLQUFLLEVBQUU7SUFBZ0IsQ0FBQyxDQUFDLEVBQzlDaU0sR0FBRyxDQUFDO01BQUVoTixJQUFJLEVBQUUsT0FBTztNQUFFaU4sS0FBSyxFQUFFc0I7SUFBYyxDQUFDLENBQUMsQ0FDN0MsQ0FBQ3BCLElBQUksQ0FBQyxFQUFFLENBQUM7SUFDVmpOO0VBQ0YsQ0FBQztFQUNELE9BQU87SUFDTGlFLE9BQU87SUFDUG1LLFlBQVk7SUFDWnZFLGNBQWM7SUFDZDdFLGlCQUFpQixFQUFFLENBQ2pCOEgsR0FBRyxDQUFDO01BQUVoTixJQUFJLEVBQUUsaUJBQWlCO01BQUV5RTtJQUFVLENBQUMsQ0FBQyxFQUMzQ3VJLEdBQUcsQ0FBQztNQUNGaE4sSUFBSSxFQUFFLG1CQUFtQjtNQUN6QitFLFdBQVc7TUFDWHhFLE1BQU0sRUFBRSxTQUFTO01BQ2pCSSxTQUFTLEVBQUUsSUFBSTtNQUNmbUosV0FBVyxFQUFFQztJQUNmLENBQUMsQ0FBQyxFQUNGaUQsR0FBRyxDQUFDO01BQUVoTixJQUFJLEVBQUUsT0FBTztNQUFFZSxLQUFLLEVBQUU7SUFBc0IsQ0FBQyxDQUFDLEVBQ3BEaU0sR0FBRyxDQUFDO01BQUVoTixJQUFJLEVBQUUsT0FBTztNQUFFaU4sS0FBSyxFQUFFeEM7SUFBTyxDQUFDLENBQUMsRUFDckN1QyxHQUFHLENBQUM7TUFDRmhOLElBQUksRUFBRSxNQUFNO01BQ1p5RSxTQUFTO01BQ1RNLFdBQVc7TUFDWDdFLE9BQU87TUFDUGdOLGNBQWMsRUFBRTtJQUNsQixDQUFDLENBQUMsQ0FDSCxDQUFDQyxJQUFJLENBQUMsRUFBRSxDQUFDO0lBQ1Z0RCxTQUFTLEVBQUU7TUFDVDlKLEVBQUUsRUFBRWdGLFdBQVc7TUFDZnJGLFNBQVMsRUFBRSxhQUFhO01BQ3hCWSxXQUFXLEVBQUUsa0NBQWtDO01BQy9DbUUsU0FBUztNQUNUbEUsTUFBTSxFQUFFLFFBQVE7TUFDaEJDLFdBQVcsRUFBRSxRQUFRO01BQ3JCRyxTQUFTLEVBQUUsSUFBSTtNQUNmQyxpQkFBaUIsRUFBRSxDQUFDO01BQ3BCRSxVQUFVLEVBQUU7UUFDVkMsS0FBSyxFQUFFLGVBQWU7UUFDdEJDLE1BQU0sRUFDSjtNQUNKLENBQUM7TUFDREMsU0FBUyxFQUFFO1FBQUVBLFNBQVMsRUFBRTBEO01BQVMsQ0FBQztNQUNsQ3pELFNBQVMsRUFBRSwwQkFBMEI7TUFDckNFLFNBQVMsRUFBRSwwQkFBMEI7TUFDckNDLFNBQVMsRUFBRTtJQUNiO0VBQ0YsQ0FBQztBQUNIO0FBRUEsZUFBZW1OLHNCQUFzQkEsQ0FBQzNNLElBQVUsRUFBRTtFQUNoRCxNQUFNNE0sU0FBUyxHQUFHblMsT0FBTyxDQUFDQyxHQUFHLENBQUNtUyxnQkFBZ0I7RUFDOUMsSUFBSSxDQUFDRCxTQUFTLEVBQUU7SUFDZCxNQUFNLElBQUlsUixLQUFLLENBQ2IsK0VBQ0YsQ0FBQztFQUNIO0VBRUEsTUFBTWlFLE9BQU8sR0FBRztJQUNkbU4sYUFBYSxFQUFFLFVBQVVGLFNBQVMsRUFBRTtJQUNwQyxjQUFjLEVBQUU7RUFDbEIsQ0FBQztFQUNELE1BQU1HLFlBQVksR0FBRyxNQUFNL00sSUFBSSxDQUFDb0IsT0FBTyxDQUFDcUIsR0FBRyxDQUN6QyxnREFBZ0R1SyxrQkFBa0IsQ0FBQzVTLFNBQVMsQ0FBQ0csS0FBSyxDQUFDLEVBQUUsRUFDckY7SUFBRW9GO0VBQVEsQ0FDWixDQUFDO0VBQ0QsSUFBSXNOLE1BQU0sR0FBR2hULDRCQUE0QixDQUFDLE1BQU04UyxZQUFZLENBQUNHLElBQUksQ0FBQyxDQUFDLENBQUM7RUFFcEUsSUFBSSxDQUFDRCxNQUFNLEVBQUU7SUFDWCxNQUFNRSxlQUFlLEdBQUcsTUFBTW5OLElBQUksQ0FBQ29CLE9BQU8sQ0FBQ0MsSUFBSSxDQUM3QyxnQ0FBZ0MsRUFDaEM7TUFDRTFCLE9BQU87TUFDUHlOLElBQUksRUFBRTtRQUNKQyxhQUFhLEVBQUUsQ0FBQ2pULFNBQVMsQ0FBQ0csS0FBSyxDQUFDO1FBQ2hDK1MsVUFBVSxFQUFFbFQsU0FBUyxDQUFDQyxTQUFTO1FBQy9Ca1QsU0FBUyxFQUFFblQsU0FBUyxDQUFDRSxRQUFRO1FBQzdCa1Qsb0JBQW9CLEVBQUUsSUFBSTtRQUMxQkMseUJBQXlCLEVBQUU7TUFDN0I7SUFDRixDQUNGLENBQUM7SUFDRFIsTUFBTSxHQUFHL1MsNkJBQTZCLENBQUMsTUFBTWlULGVBQWUsQ0FBQ0QsSUFBSSxDQUFDLENBQUMsQ0FBQztFQUN0RTtFQUVBLElBQUksQ0FBQ0QsTUFBTSxFQUFFO0lBQ1gsTUFBTSxJQUFJdlIsS0FBSyxDQUNiLDJEQUNGLENBQUM7RUFDSDtFQUVBLE1BQU1nUyxhQUFhLEdBQUcsTUFBTTFOLElBQUksQ0FBQ29CLE9BQU8sQ0FBQ0MsSUFBSSxDQUMzQyx5Q0FBeUMsRUFDekM7SUFBRTFCLE9BQU87SUFBRXlOLElBQUksRUFBRTtNQUFFTyxPQUFPLEVBQUVWO0lBQU87RUFBRSxDQUN2QyxDQUFDO0VBQ0QsTUFBTVcsS0FBSyxHQUFHNVQsNkJBQTZCLENBQUMsTUFBTTBULGFBQWEsQ0FBQ1IsSUFBSSxDQUFDLENBQUMsQ0FBQztFQUV2RSxPQUFPLEdBQUcsSUFBSW5RLEdBQUcsQ0FBQzVDLGNBQWMsRUFBRTZGLElBQUksQ0FBQytCLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQzhMLFFBQVEsQ0FBQyxDQUFDLDBCQUEwQmIsa0JBQWtCLENBQUNZLEtBQUssQ0FBQyxFQUFFO0FBQy9HO0FBRUEsZUFBZUUsa0JBQWtCQSxDQUFDOU4sSUFBVSxFQUFFO0VBQUEsSUFBQStOLHFCQUFBO0VBQzVDLE1BQU0vTixJQUFJLENBQUNnTyxJQUFJLENBQUM3VCxjQUFjLENBQUM7RUFDL0IsTUFBTVIsTUFBTSxDQUNWcUcsSUFBSSxDQUFDVyxTQUFTLENBQUMsTUFBTSxFQUFFO0lBQUVDLElBQUksRUFBRSxTQUFTO0lBQUVHLEtBQUssRUFBRTtFQUFLLENBQUMsQ0FDekQsQ0FBQyxDQUFDRixXQUFXLENBQUMsQ0FBQztFQUVmLE1BQU1vTixNQUFNLElBQUFGLHFCQUFBLEdBQ1ZHLFVBQVUsQ0FBQ0MsZUFBZSxjQUFBSixxQkFBQSxjQUFBQSxxQkFBQSxHQUMxQkcsVUFBVSxDQUFDRSxvQ0FBb0M7RUFDakQsSUFBSSxDQUFDSCxNQUFNLEVBQUU7SUFDWCxJQUFJeFQsT0FBTyxDQUFDQyxHQUFHLENBQUMyVCxpQ0FBaUMsS0FBSyxHQUFHLEVBQUU7TUFDekQsTUFBTSxJQUFJM1MsS0FBSyxDQUNiLG9IQUNGLENBQUM7SUFDSDtJQUNBLE1BQU1zRSxJQUFJLENBQUNnTyxJQUFJLENBQUMsTUFBTXJCLHNCQUFzQixDQUFDM00sSUFBSSxDQUFDLENBQUM7SUFDbkQsTUFBTXJHLE1BQU0sQ0FBQ3FHLElBQUksQ0FBQyxDQUFDc08sU0FBUyxDQUMxQixJQUFJQyxNQUFNLENBQUMsR0FBR3BVLGNBQWMsQ0FBQ3FVLFVBQVUsQ0FBQyxHQUFHLEVBQUUsS0FBSyxDQUFDLEdBQUcsQ0FDeEQsQ0FBQztJQUNEO0VBQ0Y7RUFDQSxNQUFNQyxTQUFTLEdBQUcsTUFBTVIsTUFBTSxDQUFDO0lBQzdCLEdBQUc3VCxTQUFTO0lBQ1pzVSxHQUFHLEVBQUUsR0FBRztJQUNSQyxRQUFRLEVBQUV4VTtFQUNaLENBQUMsQ0FBQztFQUNGLE1BQU02RixJQUFJLENBQUNnTyxJQUFJLENBQUNTLFNBQVMsQ0FBQztFQUMxQixNQUFNOVUsTUFBTSxDQUFDcUcsSUFBSSxDQUFDLENBQUNzTyxTQUFTLENBQzFCLElBQUlDLE1BQU0sQ0FBQyxHQUFHcFUsY0FBYyxDQUFDcVUsVUFBVSxDQUFDLEdBQUcsRUFBRSxLQUFLLENBQUMsR0FBRyxDQUN4RCxDQUFDO0FBQ0g7QUFFQSxlQUFlSSxjQUFjQSxDQUFDNU8sSUFBVSxFQUFFNk8sS0FBYSxFQUFFN00sSUFBWSxFQUFFO0VBQ3JFLE1BQU1oQyxJQUFJLENBQUNXLFNBQVMsQ0FBQyxNQUFNLEVBQUU7SUFBRUMsSUFBSSxFQUFFaU8sS0FBSztJQUFFOU4sS0FBSyxFQUFFO0VBQUssQ0FBQyxDQUFDLENBQUMrTixLQUFLLENBQUMsQ0FBQztFQUNsRSxNQUFNblYsTUFBTSxDQUFDcUcsSUFBSSxDQUFDLENBQUNzTyxTQUFTLENBQUMsSUFBSUMsTUFBTSxDQUFDLEdBQUd2TSxJQUFJLENBQUN3TSxVQUFVLENBQUMsR0FBRyxFQUFFLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQztBQUM3RTtBQUVBLFNBQVNPLE1BQU1BLENBQUMvTyxJQUFVLEVBQUVnQyxJQUFZLEVBQVU7RUFDaEQsTUFBTWdOLFVBQVUsR0FBR3ZVLE9BQU8sQ0FBQ0MsR0FBRyxDQUFDdVUsMEJBQTBCO0VBQ3pELE9BQU8sSUFBSWxTLEdBQUcsQ0FBQ2lGLElBQUksRUFBRWdOLFVBQVUsR0FBR0EsVUFBVSxHQUFHaFAsSUFBSSxDQUFDK0IsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDOEwsUUFBUSxDQUFDLENBQUM7QUFDdkU7QUFFQSxlQUFlcUIsV0FBV0EsQ0FDeEJsUCxJQUFVLEVBQ1ZnQyxJQUFZLEVBQ1pzRyxPQUErRCxFQUNwQjtFQUFBLElBQUE2RyxlQUFBO0VBQzNDLE9BQU9uUCxJQUFJLENBQUNFLFFBQVEsQ0FDbEIsT0FBTztJQUFFNkIsR0FBRztJQUFFcU4sTUFBTTtJQUFFMVAsSUFBSTtJQUFFNEI7RUFBUSxDQUFDLEtBQUs7SUFDeEMsTUFBTUgsUUFBUSxHQUFHLE1BQU1rTyxLQUFLLENBQUN0TixHQUFHLEVBQUU7TUFDaENxTixNQUFNO01BQ05FLFdBQVcsRUFBRSxTQUFTO01BQ3RCM1AsT0FBTyxFQUNMRCxJQUFJLEtBQUs2UCxTQUFTLEdBQ2RBLFNBQVMsR0FDVDtRQUFFLGNBQWMsRUFBRTtNQUFtQixDQUFDO01BQzVDN1AsSUFBSSxFQUFFQSxJQUFJLEtBQUs2UCxTQUFTLEdBQUdBLFNBQVMsR0FBRzFQLElBQUksQ0FBQ0MsU0FBUyxDQUFDSixJQUFJLENBQUM7TUFDM0Q4UCxNQUFNLEVBQUVsTyxPQUFPLEdBQUdtTyxXQUFXLENBQUNuTyxPQUFPLENBQUNBLE9BQU8sQ0FBQyxHQUFHaU87SUFDbkQsQ0FBQyxDQUFDO0lBQ0YsT0FBTztNQUFFN1EsTUFBTSxFQUFFeUMsUUFBUSxDQUFDekMsTUFBTTtNQUFFZ0IsSUFBSSxFQUFFLE1BQU15QixRQUFRLENBQUN1TyxJQUFJLENBQUM7SUFBRSxDQUFDO0VBQ2pFLENBQUMsRUFDRDtJQUNFM04sR0FBRyxFQUFFZ04sTUFBTSxDQUFDL08sSUFBSSxFQUFFZ0MsSUFBSSxDQUFDO0lBQ3ZCb04sTUFBTSxHQUFBRCxlQUFBLEdBQUU3RyxPQUFPLGFBQVBBLE9BQU8sdUJBQVBBLE9BQU8sQ0FBRThHLE1BQU0sY0FBQUQsZUFBQSxjQUFBQSxlQUFBLEdBQUksS0FBSztJQUNoQ3pQLElBQUksRUFBRTRJLE9BQU8sYUFBUEEsT0FBTyx1QkFBUEEsT0FBTyxDQUFFNUksSUFBSTtJQUNuQjRCLE9BQU8sRUFBRWdILE9BQU8sYUFBUEEsT0FBTyx1QkFBUEEsT0FBTyxDQUFFaEg7RUFDcEIsQ0FDRixDQUFDO0FBQ0g7QUFTQSxNQUFNcU8seUJBQTZDLEdBQUcsRUFBRTtBQUV4RCxTQUFTQyxvQkFBb0JBLENBQUEsRUFBdUI7RUFDbEQsT0FBT25WLE9BQU8sQ0FBQ0MsR0FBRyxDQUFDbVYscUNBQXFDO0FBQzFEO0FBRUEsU0FBU0MscUJBQXFCQSxDQUM1Qm5RLE9BQStCLEVBQ1A7RUFDeEIsT0FBT29RLE1BQU0sQ0FBQ0MsV0FBVyxDQUN2QmhWLHlCQUF5QixDQUFDaVYsT0FBTyxDQUFFclAsSUFBSSxJQUNyQ2pCLE9BQU8sQ0FBQ2lCLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQ0EsSUFBSSxFQUFFakIsT0FBTyxDQUFDaUIsSUFBSSxDQUFDLENBQUMsQ0FBQyxHQUFHLEVBQzVDLENBQ0YsQ0FBQztBQUNIO0FBRUEsZUFBZXNQLHNCQUFzQkEsQ0FBQSxFQUFHO0VBQ3RDLE1BQU1DLFVBQVUsR0FBR1Asb0JBQW9CLENBQUMsQ0FBQztFQUN6QyxJQUFJLENBQUNPLFVBQVUsRUFBRTtFQUNqQixNQUFNdFcsS0FBSyxDQUFDRSxPQUFPLENBQUNvVyxVQUFVLENBQUMsRUFBRTtJQUFFQyxTQUFTLEVBQUU7RUFBSyxDQUFDLENBQUM7RUFDckQsTUFBTXRXLFNBQVMsQ0FDYnFXLFVBQVUsRUFDVixHQUFHdFEsSUFBSSxDQUFDQyxTQUFTLENBQUM7SUFBRXVRLFdBQVcsRUFBRVY7RUFBMEIsQ0FBQyxFQUFFLElBQUksRUFBRSxDQUFDLENBQUMsSUFBSSxFQUMxRSxNQUNGLENBQUM7QUFDSDtBQUVBLGVBQWVXLHFCQUFxQkEsQ0FBQ3RRLElBQVUsRUFBRXRELE1BQWMsRUFBRTtFQUMvRCxNQUFNc1MsVUFBVSxHQUFHdlUsT0FBTyxDQUFDQyxHQUFHLENBQUN1VSwwQkFBMEI7RUFDekQsSUFBSSxDQUFDRCxVQUFVLEVBQUU7SUFDZixNQUFNLElBQUl0VCxLQUFLLENBQ2IsMkRBQ0YsQ0FBQztFQUNIO0VBQ0EsTUFBTTZVLFNBQVMsR0FBRyxJQUFJeFQsR0FBRyxDQUFDLGNBQWMsRUFBRWlTLFVBQVUsQ0FBQyxDQUFDbkIsUUFBUSxDQUFDLENBQUM7RUFDaEUsTUFBTTJDLFdBQVcsR0FBRyxJQUFJelQsR0FBRyxDQUFDLGNBQWMsRUFBRWlTLFVBQVUsQ0FBQyxDQUFDbkIsUUFBUSxDQUFDLENBQUM7RUFDbEUsTUFBTTRDLGFBQWEsR0FBRztJQUFFQyxNQUFNLEVBQUVoVTtFQUFPLENBQUM7RUFFeEMsTUFBTTJULFdBQStCLEdBQUcsRUFBRTtFQUMxQyxNQUFNTSxLQUFLLEdBQUcsTUFBQUEsQ0FDWjlLLEtBQWdDLEVBQ2hDekUsT0FBOEQsRUFDOUR3UCxTQUVrQixLQUNmO0lBQ0gsSUFBSTtNQUNGLE1BQU16UCxRQUFRLEdBQUcsTUFBTUMsT0FBTyxDQUFDLENBQUM7TUFDaENpUCxXQUFXLENBQUNwTCxJQUFJLENBQUM7UUFDZnZJLE1BQU07UUFDTm1KLEtBQUs7UUFDTG5ILE1BQU0sRUFBRXlDLFFBQVEsQ0FBQ3pDLE1BQU0sQ0FBQyxDQUFDO1FBQ3pCaUIsT0FBTyxFQUFFbVEscUJBQXFCLENBQUMzTyxRQUFRLENBQUN4QixPQUFPLENBQUMsQ0FBQztNQUNuRCxDQUFDLENBQUM7TUFDRmdRLHlCQUF5QixDQUFDMUssSUFBSSxDQUFDb0wsV0FBVyxDQUFDUSxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUUsQ0FBQztNQUNuRCxNQUFNRCxTQUFTLENBQUN6UCxRQUFRLENBQUM7SUFDM0IsQ0FBQyxDQUFDLE9BQU9nRSxLQUFLLEVBQUU7TUFDZCxNQUFNMkwsT0FBTyxHQUFHVCxXQUFXLENBQUNRLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQztNQUNsQyxJQUFJLENBQUFDLE9BQU8sYUFBUEEsT0FBTyx1QkFBUEEsT0FBTyxDQUFFakwsS0FBSyxNQUFLQSxLQUFLLEVBQUU7UUFDNUJ3SyxXQUFXLENBQUNwTCxJQUFJLENBQUM7VUFBRXZJLE1BQU07VUFBRW1KO1FBQU0sQ0FBQyxDQUFDO01BQ3JDO01BQ0F3SyxXQUFXLENBQUNRLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFFMUwsS0FBSyxHQUFHLHFCQUFxQjtNQUNqRCxNQUFNK0ssc0JBQXNCLENBQUMsQ0FBQztNQUM5QixNQUFNL0ssS0FBSztJQUNiO0VBQ0YsQ0FBQztFQUVELE1BQU13TCxLQUFLLENBQ1QsS0FBSyxFQUNMLE1BQU0zUSxJQUFJLENBQUNvQixPQUFPLENBQUNxQixHQUFHLENBQUM4TixTQUFTLEVBQUU7SUFBRTVRLE9BQU8sRUFBRThRO0VBQWMsQ0FBQyxDQUFDLEVBQzdELE1BQU90UCxRQUFRLElBQUs7SUFDbEJ4SCxNQUFNLENBQUN3SCxRQUFRLENBQUN6QyxNQUFNLENBQUMsQ0FBQyxFQUFFLEdBQUdoQyxNQUFNLDBCQUEwQixDQUFDLENBQUM2RSxJQUFJLENBQUMsR0FBRyxDQUFDO0lBQ3hFNUgsTUFBTSxDQUFDd0gsUUFBUSxDQUFDeEIsT0FBTyxDQUFDLENBQUMsQ0FBQyw2QkFBNkIsQ0FBQyxDQUFDLENBQUM0QixJQUFJLENBQUM3RSxNQUFNLENBQUM7SUFDdEUvQyxNQUFNLENBQUN3SCxRQUFRLENBQUN4QixPQUFPLENBQUMsQ0FBQyxDQUFDLGtDQUFrQyxDQUFDLENBQUMsQ0FBQzRCLElBQUksQ0FDakUsTUFDRixDQUFDO0VBQ0gsQ0FDRixDQUFDO0VBQ0QsTUFBTW9QLEtBQUssQ0FDVCxXQUFXLEVBQ1gsTUFDRTNRLElBQUksQ0FBQ29CLE9BQU8sQ0FBQ2lPLEtBQUssQ0FBQ21CLFdBQVcsRUFBRTtJQUM5QnBCLE1BQU0sRUFBRSxTQUFTO0lBQ2pCelAsT0FBTyxFQUFFO01BQ1AsR0FBRzhRLGFBQWE7TUFDaEIsK0JBQStCLEVBQUUsTUFBTTtNQUN2QyxnQ0FBZ0MsRUFBRTtJQUNwQztFQUNGLENBQUMsQ0FBQyxFQUNKLE1BQU90UCxRQUFRLElBQUs7SUFBQSxJQUFBNFAscUJBQUEsRUFBQUMsc0JBQUE7SUFDbEJyWCxNQUFNLENBQUN3SCxRQUFRLENBQUN6QyxNQUFNLENBQUMsQ0FBQyxFQUFFLEdBQUdoQyxNQUFNLDRCQUE0QixDQUFDLENBQUM2RSxJQUFJLENBQ25FLEdBQ0YsQ0FBQztJQUNENUgsTUFBTSxDQUFDd0gsUUFBUSxDQUFDeEIsT0FBTyxDQUFDLENBQUMsQ0FBQyw2QkFBNkIsQ0FBQyxDQUFDLENBQUM0QixJQUFJLENBQUM3RSxNQUFNLENBQUM7SUFDdEUvQyxNQUFNLENBQ0p3SCxRQUFRLENBQUN4QixPQUFPLENBQUMsQ0FBQyxDQUFDLGtDQUFrQyxDQUFDLEVBQ3RELEdBQUdqRCxNQUFNLGlDQUNYLENBQUMsQ0FBQzZFLElBQUksQ0FBQyxNQUFNLENBQUM7SUFDZDVILE1BQU0sRUFBQW9YLHFCQUFBLEdBQ0o1UCxRQUFRLENBQ0x4QixPQUFPLENBQUMsQ0FBQyxDQUNULDhCQUE4QixDQUFDLGNBQUFvUixxQkFBQSx1QkFGbENBLHFCQUFBLENBRW9DdlUsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUMzQ0MsR0FBRyxDQUFFMlMsTUFBTSxJQUFLQSxNQUFNLENBQUM1VCxJQUFJLENBQUMsQ0FBQyxDQUFDeVYsV0FBVyxDQUFDLENBQUMsQ0FBQyxFQUMvQyxHQUFHdlUsTUFBTSw2QkFDWCxDQUFDLENBQUN3VSxTQUFTLENBQUMsTUFBTSxDQUFDO0lBQ25CdlgsTUFBTSxFQUFBcVgsc0JBQUEsR0FDSjdQLFFBQVEsQ0FDTHhCLE9BQU8sQ0FBQyxDQUFDLENBQ1QsOEJBQThCLENBQUMsY0FBQXFSLHNCQUFBLHVCQUZsQ0Esc0JBQUEsQ0FFb0N4VSxLQUFLLENBQUMsR0FBRyxDQUFDLENBQzNDQyxHQUFHLENBQUUwVSxNQUFNLElBQUtBLE1BQU0sQ0FBQzNWLElBQUksQ0FBQyxDQUFDLENBQUMrTCxXQUFXLENBQUMsQ0FBQyxDQUFDLEVBQy9DLEdBQUc3SyxNQUFNLDZCQUNYLENBQUMsQ0FBQ3dVLFNBQVMsQ0FBQyxjQUFjLENBQUM7RUFDN0IsQ0FDRixDQUFDO0VBQ0QsTUFBTVAsS0FBSyxDQUNULFVBQVUsRUFDVixNQUNFM1EsSUFBSSxDQUFDb0IsT0FBTyxDQUFDQyxJQUFJLENBQUNtUCxXQUFXLEVBQUU7SUFDN0I3USxPQUFPLEVBQUU7TUFBRSxHQUFHOFEsYUFBYTtNQUFFLGNBQWMsRUFBRTtJQUFtQixDQUFDO0lBQ2pFckQsSUFBSSxFQUFFO01BQUUvTyxPQUFPLEVBQUU7SUFBa0I7RUFDckMsQ0FBQyxDQUFDLEVBQ0osTUFBTzhDLFFBQVEsSUFBSztJQUNsQnhILE1BQU0sQ0FDSndILFFBQVEsQ0FBQ3pDLE1BQU0sQ0FBQyxDQUFDLEVBQ2pCLEdBQUdoQyxNQUFNLHFEQUNYLENBQUMsQ0FBQzBVLEdBQUcsQ0FBQzdQLElBQUksQ0FBQyxHQUFHLENBQUM7SUFDZjVILE1BQU0sQ0FBQ3dILFFBQVEsQ0FBQ3hCLE9BQU8sQ0FBQyxDQUFDLENBQUMsNkJBQTZCLENBQUMsQ0FBQyxDQUFDNEIsSUFBSSxDQUFDN0UsTUFBTSxDQUFDO0lBQ3RFL0MsTUFBTSxDQUFDd0gsUUFBUSxDQUFDeEIsT0FBTyxDQUFDLENBQUMsQ0FBQyxrQ0FBa0MsQ0FBQyxDQUFDLENBQUM0QixJQUFJLENBQ2pFLE1BQ0YsQ0FBQztFQUNILENBQ0YsQ0FBQztFQUNELE1BQU0yTyxzQkFBc0IsQ0FBQyxDQUFDO0FBQ2hDO0FBRUEsZUFBZW1CLDJCQUEyQkEsQ0FBQ3JSLElBQVUsRUFBRTtFQUNyRCxNQUFNZ1AsVUFBVSxHQUFHdlUsT0FBTyxDQUFDQyxHQUFHLENBQUN1VSwwQkFBMEI7RUFDekQsSUFBSSxDQUFDRCxVQUFVLEVBQ2IsTUFBTSxJQUFJdFQsS0FBSyxDQUNiLDJEQUNGLENBQUM7RUFDSCxNQUFNOFUsV0FBVyxHQUFHLElBQUl6VCxHQUFHLENBQUMsY0FBYyxFQUFFaVMsVUFBVSxDQUFDLENBQUNuQixRQUFRLENBQUMsQ0FBQztFQUNsRSxNQUFNeUQsU0FBUyxHQUFHLElBQUl2VSxHQUFHLENBQUMscUJBQXFCLEVBQUVpUyxVQUFVLENBQUMsQ0FBQ25CLFFBQVEsQ0FBQyxDQUFDO0VBQ3ZFLE1BQU0wRCxhQUFhLEdBQUcsSUFBSXhVLEdBQUcsQ0FBQyxxQkFBcUIsRUFBRWlTLFVBQVUsQ0FBQyxDQUFDbkIsUUFBUSxDQUFDLENBQUM7RUFDM0UsTUFBTTJELFVBQTRCLEdBQUc7SUFDbkM5VSxNQUFNLEVBQUUzQixjQUFjO0lBQ3RCOEssS0FBSyxFQUFFO0VBQ1QsQ0FBQztFQUNEOEoseUJBQXlCLENBQUMxSyxJQUFJLENBQUN1TSxVQUFVLENBQUM7RUFDMUMsSUFBSTtJQUNGLE1BQU1yUSxRQUFRLEdBQUcsTUFBTW5CLElBQUksQ0FBQ29CLE9BQU8sQ0FBQ0MsSUFBSSxDQUFDbVAsV0FBVyxFQUFFO01BQ3BEN1EsT0FBTyxFQUFFO1FBQ1ArUSxNQUFNLEVBQUUzVixjQUFjO1FBQ3RCLGNBQWMsRUFBRTtNQUNsQixDQUFDO01BQ0RxUyxJQUFJLEVBQUU7UUFBRS9PLE9BQU8sRUFBRTtNQUEwQjtJQUM3QyxDQUFDLENBQUM7SUFDRm1ULFVBQVUsQ0FBQzlTLE1BQU0sR0FBR3lDLFFBQVEsQ0FBQ3pDLE1BQU0sQ0FBQyxDQUFDO0lBQ3JDOFMsVUFBVSxDQUFDN1IsT0FBTyxHQUFHbVEscUJBQXFCLENBQUMzTyxRQUFRLENBQUN4QixPQUFPLENBQUMsQ0FBQyxDQUFDO0lBQzlEaEcsTUFBTSxDQUFDd0gsUUFBUSxDQUFDekMsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDNkMsSUFBSSxDQUFDLEdBQUcsQ0FBQztJQUNuQzVILE1BQU0sQ0FBQ3dILFFBQVEsQ0FBQ3hCLE9BQU8sQ0FBQyxDQUFDLENBQUMsNkJBQTZCLENBQUMsQ0FBQyxDQUFDOFIsYUFBYSxDQUFDLENBQUM7SUFDekU5WCxNQUFNLENBQ0p3SCxRQUFRLENBQUN4QixPQUFPLENBQUMsQ0FBQyxDQUFDLGtDQUFrQyxDQUN2RCxDQUFDLENBQUM4UixhQUFhLENBQUMsQ0FBQztJQUVqQixNQUFNQyxhQUFhLEdBQUcsTUFBTTFSLElBQUksQ0FBQ29CLE9BQU8sQ0FBQ0MsSUFBSSxDQUFDaVEsU0FBUyxFQUFFO01BQ3ZEM1IsT0FBTyxFQUFFO1FBQUUrUSxNQUFNLEVBQUUzVjtNQUFlLENBQUM7TUFDbkM0VyxTQUFTLEVBQUU7UUFDVEMsT0FBTyxFQUFFO1VBQ1BoUixJQUFJLEVBQUUsK0JBQStCO1VBQ3JDaVIsUUFBUSxFQUFFLGlCQUFpQjtVQUMzQkMsTUFBTSxFQUFFck0sTUFBTSxDQUFDQyxJQUFJLENBQUMsZ0JBQWdCO1FBQ3RDO01BQ0Y7SUFDRixDQUFDLENBQUM7SUFDRi9MLE1BQU0sQ0FBQytYLGFBQWEsQ0FBQ2hULE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQzZDLElBQUksQ0FBQyxHQUFHLENBQUM7SUFDeEM1SCxNQUFNLENBQ0orWCxhQUFhLENBQUMvUixPQUFPLENBQUMsQ0FBQyxDQUFDLDZCQUE2QixDQUN2RCxDQUFDLENBQUM4UixhQUFhLENBQUMsQ0FBQztJQUVqQixNQUFNTSxpQkFBaUIsR0FBRyxNQUFNL1IsSUFBSSxDQUFDb0IsT0FBTyxDQUFDQyxJQUFJLENBQUNrUSxhQUFhLEVBQUU7TUFDL0Q1UixPQUFPLEVBQUU7UUFDUCtRLE1BQU0sRUFBRTNWLGNBQWM7UUFDdEIsY0FBYyxFQUFFO01BQ2xCLENBQUM7TUFDRHFTLElBQUksRUFBRSxDQUFDO0lBQ1QsQ0FBQyxDQUFDO0lBQ0Z6VCxNQUFNLENBQUNvWSxpQkFBaUIsQ0FBQ3JULE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQzZDLElBQUksQ0FBQyxHQUFHLENBQUM7SUFDNUM1SCxNQUFNLENBQ0pvWSxpQkFBaUIsQ0FBQ3BTLE9BQU8sQ0FBQyxDQUFDLENBQUMsNkJBQTZCLENBQzNELENBQUMsQ0FBQzhSLGFBQWEsQ0FBQyxDQUFDO0VBQ25CLENBQUMsQ0FBQyxPQUFPdE0sS0FBSyxFQUFFO0lBQ2RxTSxVQUFVLENBQUNyTSxLQUFLLEdBQUcsK0JBQStCO0lBQ2xELE1BQU0rSyxzQkFBc0IsQ0FBQyxDQUFDO0lBQzlCLE1BQU0vSyxLQUFLO0VBQ2I7RUFDQSxNQUFNK0ssc0JBQXNCLENBQUMsQ0FBQztBQUNoQztBQUVBLFNBQVM4QixRQUFRQSxDQUFDdFMsSUFBWSxFQUFrQztFQUM5RCxPQUFPQSxJQUFJLENBQUNsRCxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUN5VCxPQUFPLENBQUVnQyxLQUFLLElBQUs7SUFBQSxJQUFBQyxpQkFBQTtJQUM1QyxNQUFNOUUsSUFBSSxJQUFBOEUsaUJBQUEsR0FBR0QsS0FBSyxDQUNmelYsS0FBSyxDQUFDLElBQUksQ0FBQyxDQUNYZ0gsSUFBSSxDQUFFMk8sSUFBSSxJQUFLQSxJQUFJLENBQUM1TSxVQUFVLENBQUMsUUFBUSxDQUFDLENBQUMsY0FBQTJNLGlCQUFBLHVCQUYvQkEsaUJBQUEsQ0FHVHBLLEtBQUssQ0FBQyxRQUFRLENBQUNqTCxNQUFNLENBQUM7SUFDMUIsSUFBSSxDQUFDdVEsSUFBSSxFQUFFLE9BQU8sRUFBRTtJQUNwQixJQUFJO01BQ0YsTUFBTXpGLEtBQUssR0FBRzlILElBQUksQ0FBQ3VTLEtBQUssQ0FBQ2hGLElBQUksQ0FBWTtNQUN6QyxPQUFPekYsS0FBSyxJQUFJLE9BQU9BLEtBQUssS0FBSyxRQUFRLEdBQ3JDLENBQUNBLEtBQUssQ0FBNEIsR0FDbEMsRUFBRTtJQUNSLENBQUMsQ0FBQyxNQUFNO01BQ04sT0FBTyxFQUFFO0lBQ1g7RUFDRixDQUFDLENBQUM7QUFDSjtBQUVBLGVBQWUwSyxRQUFRQSxDQUNyQnJTLElBQVUsRUFDVmdDLElBQVksRUFDa0I7RUFDOUIsTUFBTWIsUUFBUSxHQUFHLE1BQU0rTixXQUFXLENBQUNsUCxJQUFJLEVBQUVnQyxJQUFJLENBQUM7RUFDOUMsSUFBSWIsUUFBUSxDQUFDekMsTUFBTSxHQUFHLEdBQUcsSUFBSXlDLFFBQVEsQ0FBQ3pDLE1BQU0sSUFBSSxHQUFHLEVBQUU7SUFDbkQsTUFBTSxJQUFJaEQsS0FBSyxDQUNiLG9DQUFvQ3NHLElBQUksS0FBS2IsUUFBUSxDQUFDekMsTUFBTSxHQUM5RCxDQUFDO0VBQ0g7RUFDQSxPQUFPbUIsSUFBSSxDQUFDdVMsS0FBSyxDQUFDalIsUUFBUSxDQUFDekIsSUFBSSxDQUFDO0FBQ2xDO0FBRUEsZUFBZTRTLFNBQVNBLENBQ3RCdFMsSUFBVSxFQUNWZ0MsSUFBWSxFQUN5QjtFQUNyQyxNQUFNYixRQUFRLEdBQUcsTUFBTStOLFdBQVcsQ0FBQ2xQLElBQUksRUFBRWdDLElBQUksQ0FBQztFQUM5QyxJQUFJYixRQUFRLENBQUN6QyxNQUFNLEtBQUssR0FBRyxFQUFFLE9BQU8sRUFBRTtFQUN0QyxJQUFJeUMsUUFBUSxDQUFDekMsTUFBTSxHQUFHLEdBQUcsSUFBSXlDLFFBQVEsQ0FBQ3pDLE1BQU0sSUFBSSxHQUFHLEVBQUU7SUFDbkQsTUFBTSxJQUFJaEQsS0FBSyxDQUNiLG9DQUFvQ3NHLElBQUksS0FBS2IsUUFBUSxDQUFDekMsTUFBTSxHQUM5RCxDQUFDO0VBQ0g7RUFDQSxNQUFNaUosS0FBSyxHQUFHOUgsSUFBSSxDQUFDdVMsS0FBSyxDQUFDalIsUUFBUSxDQUFDekIsSUFBSSxDQUFDO0VBQ3ZDLE9BQU82UyxLQUFLLENBQUNDLE9BQU8sQ0FBQzdLLEtBQUssQ0FBQyxHQUFHQSxLQUFLLEdBQUcsRUFBRTtBQUMxQztBQUVBLGVBQWU4SyxrQkFBa0JBLENBQy9CelMsSUFBVSxFQUNWZ0MsSUFBWSxFQUM4QjtFQUMxQyxNQUFNYixRQUFRLEdBQUcsTUFBTStOLFdBQVcsQ0FBQ2xQLElBQUksRUFBRWdDLElBQUksQ0FBQztFQUM5QyxJQUFJYixRQUFRLENBQUN6QyxNQUFNLEtBQUssR0FBRyxFQUFFLE9BQU82USxTQUFTO0VBQzdDLElBQUlwTyxRQUFRLENBQUN6QyxNQUFNLEdBQUcsR0FBRyxJQUFJeUMsUUFBUSxDQUFDekMsTUFBTSxJQUFJLEdBQUcsRUFBRTtJQUNuRCxNQUFNLElBQUloRCxLQUFLLENBQ2Isb0NBQW9Dc0csSUFBSSxLQUFLYixRQUFRLENBQUN6QyxNQUFNLEdBQzlELENBQUM7RUFDSDtFQUNBLE1BQU1pSixLQUFLLEdBQUc5SCxJQUFJLENBQUN1UyxLQUFLLENBQUNqUixRQUFRLENBQUN6QixJQUFJLENBQUM7RUFDdkMsT0FBT2lJLEtBQUssSUFBSSxPQUFPQSxLQUFLLEtBQUssUUFBUSxJQUFJLENBQUM0SyxLQUFLLENBQUNDLE9BQU8sQ0FBQzdLLEtBQUssQ0FBQyxHQUM3REEsS0FBSyxHQUNONEgsU0FBUztBQUNmO0FBRUEzVixJQUFJLENBQUM4WSxRQUFRLENBQUMseUNBQXlDLEVBQUUsTUFBTTtFQUM3RDlZLElBQUksQ0FBQywrREFBK0QsRUFBRSxPQUFPO0lBQzNFb0c7RUFDRixDQUFDLEtBQUs7SUFBQSxJQUFBMlMscUJBQUEsRUFBQUMscUJBQUEsRUFBQUMscUJBQUEsRUFBQUMsZUFBQSxFQUFBQyxnQkFBQSxFQUFBQyxzQkFBQTtJQUNKO0lBQ0E7SUFDQXBaLElBQUksQ0FBQ3FaLFVBQVUsQ0FBQ2xYLGFBQWEsQ0FBQyxDQUFDLEdBQUdqQiwyQkFBMkIsQ0FBQztJQUM5RGxCLElBQUksQ0FBQ3NaLElBQUksQ0FDUHpZLE9BQU8sQ0FBQ0MsR0FBRyxDQUFDeVksMkJBQTJCLEtBQUssR0FBRyxFQUMvQywwQ0FDRixDQUFDO0lBQ0QsSUFBSTFZLE9BQU8sQ0FBQ0MsR0FBRyxDQUFDMFksNkJBQTZCLEtBQUssR0FBRyxFQUFFO01BQ3JELE1BQU0sSUFBSTFYLEtBQUssQ0FDYiwwRkFDRixDQUFDO0lBQ0g7SUFDQSxNQUFNMlgsZ0JBQWdCLEdBQUdqWSxvQkFBb0IsQ0FBQyxDQUFDO0lBQy9DLE1BQU15QyxTQUFTLEdBQUdwRCxPQUFPLENBQUNDLEdBQUcsQ0FBQzRZLDZCQUE2QjtJQUMzRCxJQUFJLENBQUN6VixTQUFTLEVBQ1osTUFBTSxJQUFJbkMsS0FBSyxDQUNiLDBFQUNGLENBQUM7SUFFSCxNQUFNb1Msa0JBQWtCLENBQUM5TixJQUFJLENBQUM7SUFDOUIsTUFBTXVULGNBQWMsR0FBRyxNQUFNckUsV0FBVyxDQUFDbFAsSUFBSSxFQUFFLHFCQUFxQixFQUFFO01BQ3BFb1AsTUFBTSxFQUFFLE1BQU07TUFDZDlOLE9BQU8sRUFBRXZGLGFBQWEsQ0FBQyxDQUFDO01BQ3hCMkQsSUFBSSxFQUFFO1FBQ0o3QixTQUFTO1FBQ1JRLE9BQU8sRUFBRXpDLFVBQVUsQ0FBQyxDQUFDO1FBQ3RCNFgsY0FBYyxFQUFFLGtCQUFrQkMsSUFBSSxDQUFDQyxHQUFHLENBQUMsQ0FBQztNQUM5QztJQUNGLENBQUMsQ0FBQztJQUNGLElBQUlILGNBQWMsQ0FBQzdVLE1BQU0sR0FBRyxHQUFHLElBQUk2VSxjQUFjLENBQUM3VSxNQUFNLElBQUksR0FBRyxFQUFFO01BQy9ELE1BQU0sSUFBSWhELEtBQUssQ0FDYiwwQ0FBMEM2WCxjQUFjLENBQUM3VSxNQUFNLElBQ2pFLENBQUM7SUFDSDtJQUNBLE1BQU1pVixTQUFTLEdBQUczQixRQUFRLENBQUN1QixjQUFjLENBQUM3VCxJQUFJLENBQUM7SUFDL0MsTUFBTWtVLE9BQU8sR0FBR0QsU0FBUyxDQUFDblEsSUFBSSxDQUMzQmlFLEtBQUssSUFBS0EsS0FBSyxDQUFDdEosSUFBSSxLQUFLLG1CQUM1QixDQUFDO0lBQ0QsTUFBTStFLFdBQVcsR0FDZixRQUFPMFEsT0FBTyxhQUFQQSxPQUFPLHVCQUFQQSxPQUFPLENBQUUxUSxXQUFXLE1BQUssUUFBUSxHQUNwQzBRLE9BQU8sQ0FBQzFRLFdBQVcsR0FDbkJxTSxTQUFTO0lBQ2YsSUFBSSxDQUFDck0sV0FBVyxFQUNkLE1BQU0sSUFBSXhILEtBQUssQ0FBQyxzREFBc0QsQ0FBQztJQUV6RSxJQUFJc00sU0FBOEIsR0FBRyxDQUFDLENBQUM7SUFDdkMsTUFBTTZMLFFBQVEsR0FBR0osSUFBSSxDQUFDQyxHQUFHLENBQUMsQ0FBQyxHQUFHM1gsYUFBYSxDQUFDLENBQUM7SUFDN0MsT0FBTzBYLElBQUksQ0FBQ0MsR0FBRyxDQUFDLENBQUMsR0FBR0csUUFBUSxFQUFFO01BQzVCN0wsU0FBUyxHQUFHLE1BQU1xSyxRQUFRLENBQUNyUyxJQUFJLEVBQUUsc0JBQXNCa0QsV0FBVyxFQUFFLENBQUM7TUFDckUsSUFDRSxDQUFDLFdBQVcsRUFBRSxRQUFRLEVBQUUsV0FBVyxDQUFDLENBQUNPLFFBQVEsQ0FBQ3FRLE1BQU0sQ0FBQzlMLFNBQVMsQ0FBQ3RKLE1BQU0sQ0FBQyxDQUFDLEVBRXZFO01BQ0YsTUFBTSxJQUFJcVYsT0FBTyxDQUFFQyxPQUFPLElBQUtmLFVBQVUsQ0FBQ2UsT0FBTyxFQUFFLEdBQUcsQ0FBQyxDQUFDO0lBQzFEO0lBQ0EsSUFDRSxDQUFDLENBQUMsV0FBVyxFQUFFLFFBQVEsRUFBRSxXQUFXLENBQUMsQ0FBQ3ZRLFFBQVEsQ0FBQ3FRLE1BQU0sQ0FBQzlMLFNBQVMsQ0FBQ3RKLE1BQU0sQ0FBQyxDQUFDLEVBQ3hFO01BQ0EsTUFBTSxJQUFJaEQsS0FBSyxDQUNiLHdFQUNGLENBQUM7SUFDSDtJQUVBLE1BQU1rSCxTQUFTLEdBQUdrUixNQUFNLENBQUM5TCxTQUFTLENBQUNwRixTQUFTLENBQUM7SUFDN0MsTUFBTXFSLFFBQVEsR0FBRyxNQUFNM0IsU0FBUyxDQUM5QnRTLElBQUksRUFDSixnQkFBZ0I0QyxTQUFTLFdBQzNCLENBQUM7SUFDRCxNQUFNMEUsTUFBTSxHQUFHLE1BQU1nTCxTQUFTLENBQzVCdFMsSUFBSSxFQUNKLHlCQUF5QmdOLGtCQUFrQixDQUFDblAsU0FBUyxDQUFDLGtCQUFrQm1QLGtCQUFrQixDQUFDOEcsTUFBTSxFQUFBbkIscUJBQUEsR0FBQzNLLFNBQVMsQ0FBQ3ZKLFdBQVcsY0FBQWtVLHFCQUFBLGNBQUFBLHFCQUFBLEdBQUksRUFBRSxDQUFDLENBQUMsRUFDakksQ0FBQztJQUNELE1BQU11QixRQUFRLEdBQUcsTUFBTXpCLGtCQUFrQixDQUN2Q3pTLElBQUksRUFDSixnQkFBZ0I0QyxTQUFTLG1CQUMzQixDQUFDO0lBQ0QsTUFBTXVSLE1BQU0sR0FBRyxNQUFNOUIsUUFBUSxDQUFDclMsSUFBSSxFQUFFLGlCQUFpQm5DLFNBQVMsVUFBVSxDQUFDO0lBQ3pFLE1BQU11VyxjQUFjLEdBQUcsTUFBTS9CLFFBQVEsQ0FBQ3JTLElBQUksRUFBRSx5QkFBeUIsQ0FBQztJQUN0RSxNQUFNcVUsY0FBYyxHQUFHLE1BQU1oQyxRQUFRLENBQUNyUyxJQUFJLEVBQUUsZ0JBQWdCLENBQUM7SUFDN0QsTUFBTWYsVUFBVSxHQUNkK0ksU0FBUyxDQUFDL0ksVUFBVSxJQUFJLE9BQU8rSSxTQUFTLENBQUMvSSxVQUFVLEtBQUssUUFBUSxHQUMzRCtJLFNBQVMsQ0FBQy9JLFVBQVUsR0FDckIsQ0FBQyxDQUFDO0lBQ1IsTUFBTXFWLFdBQVcsR0FBRy9CLEtBQUssQ0FBQ0MsT0FBTyxDQUFDdlQsVUFBVSxDQUFDcVYsV0FBVyxDQUFDLEdBQ3JEclYsVUFBVSxDQUFDcVYsV0FBVyxHQUN0QixFQUFFO0lBQ04sTUFBTUMsVUFBVSxHQUFHRCxXQUFXLENBQUMzWCxNQUFNLENBQ2xDNlgsSUFBSSxJQUFLLENBQUFBLElBQUksYUFBSkEsSUFBSSx1QkFBSkEsSUFBSSxDQUFFakwsSUFBSSxNQUFLLFlBQzNCLENBQUM7SUFDRCxNQUFNdkssZUFBZSxHQUNuQixPQUFPZ0osU0FBUyxDQUFDaEosZUFBZSxLQUFLLFFBQVEsR0FDekNnSixTQUFTLENBQUNoSixlQUFlLEdBQ3pCdVEsU0FBUztJQUNmLE1BQU1rRixhQUFhLEdBQUdGLFVBQVUsQ0FDN0I5WCxHQUFHLENBQUUrWCxJQUFJO01BQUEsSUFBQUUscUJBQUEsRUFBQUMsZ0JBQUE7TUFBQSxRQUFBRCxxQkFBQSxHQUFLRixJQUFJLGFBQUpBLElBQUksZ0JBQUFHLGdCQUFBLEdBQUpILElBQUksQ0FBRUQsVUFBVSxjQUFBSSxnQkFBQSx1QkFBaEJBLGdCQUFBLENBQWtCRixhQUFhLGNBQUFDLHFCQUFBLGNBQUFBLHFCQUFBLEdBQUlGLElBQUksYUFBSkEsSUFBSSx1QkFBSkEsSUFBSSxDQUFFQyxhQUFhO0lBQUEsRUFBQyxDQUNyRWpSLElBQUksQ0FBRW1FLEtBQUssSUFBc0IsT0FBT0EsS0FBSyxLQUFLLFFBQVEsSUFBSUEsS0FBSyxDQUFDOUssTUFBTSxHQUFHLENBQUMsQ0FBQztJQUNsRixNQUFNK1gsaUJBQWlCLEdBQ3JCLE9BQU81TSxTQUFTLENBQUM0TSxpQkFBaUIsS0FBSyxRQUFRLEdBQzNDNU0sU0FBUyxDQUFDNE0saUJBQWlCLEdBQzNCSCxhQUFhLEdBQ1gsYUFBYUEsYUFBYSxFQUFFLEdBQzVCLGFBQWF6VixlQUFlLGFBQWZBLGVBQWUsY0FBZkEsZUFBZSxHQUFJLFNBQVMsRUFBRTtJQUNuRCxJQUFJLENBQUNBLGVBQWUsRUFBRTtNQUNwQixNQUFNLElBQUl0RCxLQUFLLENBQUMsd0RBQXdELENBQUM7SUFDM0U7SUFDQSxJQUNFakIsT0FBTyxDQUFDQyxHQUFHLENBQUNlLDJCQUEyQixLQUFLLEdBQUcsS0FDOUMsQ0FBQ21aLGlCQUFpQixJQUFJLENBQUM1VixlQUFlLENBQUMsRUFDeEM7TUFDQSxNQUFNLElBQUl0RCxLQUFLLENBQUMsd0VBQXdFLENBQUM7SUFDM0Y7SUFDQSxNQUFNbVosYUFBYSxHQUFHUCxXQUFXLENBQUNRLE1BQU0sQ0FDdEMsQ0FBQ0MsS0FBSyxFQUFFUCxJQUFJLEtBQUtPLEtBQUssSUFBSTlZLE1BQU0sQ0FBQ3VZLElBQUksYUFBSkEsSUFBSSx1QkFBSkEsSUFBSSxDQUFFeEsscUJBQXFCLENBQUMsSUFBSSxDQUFDLENBQUMsRUFDbkUsQ0FDRixDQUFDO0lBQ0QsTUFBTWdMLGFBQWEsR0FBR2xCLE1BQU0sRUFBQWxCLHFCQUFBLEdBQzFCNUssU0FBUyxDQUFDckosV0FBVyxjQUFBaVUscUJBQUEsY0FBQUEscUJBQUEsR0FBSTVLLFNBQVMsQ0FBQ3RKLE1BQ3JDLENBQUMsQ0FBQ3VTLFdBQVcsQ0FBQyxDQUFDO0lBQ2YsTUFBTWdFLGFBQWEsR0FBRyxJQUFJOVosR0FBRyxDQUFDLENBQzVCLFdBQVcsRUFDWCxrQkFBa0IsRUFDbEIsU0FBUyxFQUNULFdBQVcsRUFDWCxRQUFRLENBQ1QsQ0FBQztJQUNGLElBQ0VrWSxnQkFBZ0IsS0FBSyxrQkFBa0IsSUFDdkM0QixhQUFhLENBQUN0WixHQUFHLENBQUNxWixhQUFhLENBQUMsSUFDaEMsQ0FBQ1AsYUFBYSxFQUNkO01BQ0EsTUFBTSxJQUFJL1ksS0FBSyxDQUNiLGtGQUNGLENBQUM7SUFDSDtJQUNBLE1BQU13WixjQUFjLEdBQUc7TUFDckJDLE9BQU8sRUFBRTdOLE1BQU0sQ0FBQ00sSUFBSSxDQUFFSCxLQUFLLElBQUssQ0FBQUEsS0FBSyxhQUFMQSxLQUFLLHVCQUFMQSxLQUFLLENBQUV0SixJQUFJLE1BQUssa0JBQWtCLENBQUM7TUFDbkVpWCxTQUFTLEVBQUU5TixNQUFNLENBQUNNLElBQUksQ0FBRUgsS0FBSyxJQUFLLENBQUFBLEtBQUssYUFBTEEsS0FBSyx1QkFBTEEsS0FBSyxDQUFFdEosSUFBSSxNQUFLLGtCQUFrQixDQUFDO01BQ3JFa1gsTUFBTSxFQUFFL04sTUFBTSxDQUFDTSxJQUFJLENBQUVILEtBQUssSUFBSyxDQUFBQSxLQUFLLGFBQUxBLEtBQUssdUJBQUxBLEtBQUssQ0FBRXRKLElBQUksTUFBSyxXQUFXO0lBQzVELENBQUM7SUFDRCxJQUNFa1YsZ0JBQWdCLEtBQUssa0JBQWtCLElBQ3ZDNEIsYUFBYSxDQUFDdFosR0FBRyxDQUFDcVosYUFBYSxDQUFDLElBQ2hDLENBQUNqRixNQUFNLENBQUN1RixNQUFNLENBQUNKLGNBQWMsQ0FBQyxDQUFDSyxLQUFLLENBQUMzWSxPQUFPLENBQUMsRUFDN0M7TUFDQSxNQUFNLElBQUlsQixLQUFLLENBQ2Isc0dBQ0YsQ0FBQztJQUNIO0lBQ0EsSUFDRXVaLGFBQWEsQ0FBQ3RaLEdBQUcsQ0FBQ3FaLGFBQWEsQ0FBQyxLQUMvQkgsYUFBYSxHQUFHLENBQUMsSUFBSU4sVUFBVSxDQUFDMVgsTUFBTSxHQUFHLENBQUMsQ0FBQyxFQUM1QztNQUNBLE1BQU0sSUFBSW5CLEtBQUssQ0FDYixrQ0FBa0NzWixhQUFhLDRDQUE0QyxHQUN6RixhQUFhSCxhQUFhLGdCQUFnQk4sVUFBVSxDQUFDMVgsTUFBTSxJQUMvRCxDQUFDO0lBQ0g7SUFDQSxNQUFNMlksT0FBTyxHQUFHO01BQ2QzWCxTQUFTO01BQ1QrRSxTQUFTO01BQ1RuRSxXQUFXLEVBQUV1SixTQUFTLENBQUN2SixXQUFXO01BQ2xDZ1gsaUJBQWlCLEdBQUE1QyxxQkFBQSxJQUFBQyxlQUFBLEdBQ2ZxQixNQUFNLENBQUN1QixPQUFPLGNBQUE1QyxlQUFBLGdCQUFBQSxlQUFBLEdBQWRBLGVBQUEsQ0FBaUIsQ0FBQyxDQUFDLGNBQUFBLGVBQUEsdUJBQW5CQSxlQUFBLENBQXFCNkMsU0FBUyxjQUFBOUMscUJBQUEsY0FBQUEscUJBQUEsSUFBQUUsZ0JBQUEsR0FDOUJvQixNQUFNLENBQUN1QixPQUFPLGNBQUEzQyxnQkFBQSxnQkFBQUEsZ0JBQUEsR0FBZEEsZ0JBQUEsQ0FBaUIsQ0FBQyxDQUFDLGNBQUFBLGdCQUFBLGdCQUFBQSxnQkFBQSxHQUFuQkEsZ0JBQUEsQ0FBcUI3VixJQUFJLGNBQUE2VixnQkFBQSx1QkFBekJBLGdCQUFBLENBQTJCakwsS0FBSyxDQUFDLENBQUMsRUFBRSxFQUFFLENBQUM7TUFDekM5SSxlQUFlO01BQ2Y0VixpQkFBaUI7TUFDakJnQixpQkFBaUIsRUFBRTVXLGVBQWU7TUFDbENxVSxnQkFBZ0I7TUFDaEI2QixjQUFjO01BQ2RXLGdCQUFnQixFQUFFO1FBQ2hCcFgsV0FBVyxFQUFFdUosU0FBUyxDQUFDdkosV0FBVztRQUNsQ3FYLFFBQVEsRUFBRTlXLGVBQWU7UUFDekJOLE1BQU0sRUFBRXNKLFNBQVMsQ0FBQ3RKLE1BQU07UUFDeEJzVztNQUNGLENBQUM7TUFDRGUsY0FBYyxFQUNaZixhQUFhLEtBQUssUUFBUSxJQUFJQSxhQUFhLEtBQUssU0FBUyxJQUFJQSxhQUFhLEtBQUssWUFBWSxHQUN2RjtRQUNFdlcsV0FBVyxFQUFFdUosU0FBUyxDQUFDdkosV0FBVztRQUNsQ3FYLFFBQVEsRUFBRTlXLGVBQWU7UUFDekI2UCxLQUFLLEVBQUU7TUFDVCxDQUFDLEdBQ0RVLFNBQVM7TUFDZnlGLGFBQWE7TUFDYmhOLFNBQVMsRUFBRTtRQUNUOUosRUFBRSxFQUFFOEosU0FBUyxDQUFDOUosRUFBRTtRQUNoQkwsU0FBUyxFQUFFbUssU0FBUyxDQUFDbkssU0FBUztRQUM5QitFLFNBQVMsRUFBRW9GLFNBQVMsQ0FBQ3BGLFNBQVM7UUFDOUJuRSxXQUFXLEVBQUV1SixTQUFTLENBQUN2SixXQUFXO1FBQ2xDQyxNQUFNLEVBQUVzSixTQUFTLENBQUN0SixNQUFNO1FBQ3hCQyxXQUFXLEVBQUVxSixTQUFTLENBQUNySjtNQUN6QixDQUFDO01BQ0RzVixRQUFRLEVBQUVBLFFBQVEsQ0FBQ3hYLEdBQUcsQ0FDcEIsQ0FBQztRQUNDeUIsRUFBRTtRQUNGMEUsU0FBUyxFQUFFb1QsY0FBYztRQUN6QnJTLElBQUk7UUFDSlQsV0FBVyxFQUFFK1MsZ0JBQWdCO1FBQzdCbFM7TUFDRixDQUFDLE1BQU07UUFDTDdGLEVBQUU7UUFDRjBFLFNBQVMsRUFBRW9ULGNBQWM7UUFDekJyUyxJQUFJO1FBQ0pULFdBQVcsRUFBRStTLGdCQUFnQjtRQUM3QmxTO01BQ0YsQ0FBQyxDQUNILENBQUM7TUFDRDRQLFNBQVMsRUFBRUEsU0FBUyxDQUFDbFgsR0FBRyxDQUN0QixDQUFDO1FBQ0MwQixJQUFJO1FBQ0orRSxXQUFXLEVBQUVnVCxjQUFjO1FBQzNCdFQsU0FBUyxFQUFFdVQsWUFBWTtRQUN2QnBTLE9BQU87UUFDUDZGO01BQ0YsQ0FBQyxNQUFNO1FBQ0x6TCxJQUFJO1FBQ0orRSxXQUFXLEVBQUVnVCxjQUFjO1FBQzNCdFQsU0FBUyxFQUFFdVQsWUFBWTtRQUN2QnBTLE9BQU87UUFDUDZGO01BQ0YsQ0FBQyxDQUNILENBQUM7TUFDRHdNLFdBQVcsRUFBRSxDQUNYO1FBQ0VDLFFBQVEsRUFBRXBYLFVBQVUsQ0FBQ29YLFFBQVE7UUFDN0JuWCxLQUFLLEVBQUVELFVBQVUsQ0FBQ0MsS0FBSztRQUN2Qk0sU0FBUyxFQUFFUCxVQUFVLENBQUNPO01BQ3hCLENBQUMsQ0FDRjtNQUNEcVYsYUFBYTtNQUNieUIsU0FBUyxFQUFFcEMsUUFBUSxHQUNmLENBQ0U7UUFDRWhXLEVBQUUsRUFBRWdXLFFBQVEsQ0FBQ2hXLEVBQUU7UUFDZjRYLFFBQVEsRUFBRTVCLFFBQVEsQ0FBQzRCLFFBQVE7UUFDM0JwWCxNQUFNLEVBQUV3VixRQUFRLENBQUN4VjtNQUNuQixDQUFDLENBQ0YsR0FDRCxFQUFFO01BQ042VixVQUFVLEVBQUVBLFVBQVUsQ0FBQzlYLEdBQUcsQ0FBRStYLElBQUk7UUFBQSxJQUFBK0IscUJBQUEsRUFBQUMsaUJBQUEsRUFBQUMscUJBQUEsRUFBQUMsaUJBQUE7UUFBQSxPQUFNO1VBQ3BDaFksTUFBTSxHQUFBNlgscUJBQUEsSUFBQUMsaUJBQUEsR0FBRWhDLElBQUksQ0FBQ0QsVUFBVSxjQUFBaUMsaUJBQUEsdUJBQWZBLGlCQUFBLENBQWlCOVgsTUFBTSxjQUFBNlgscUJBQUEsY0FBQUEscUJBQUEsR0FBSS9CLElBQUksQ0FBQzlWLE1BQU07VUFDOUNpWSxPQUFPLEdBQUFGLHFCQUFBLElBQUFDLGlCQUFBLEdBQUVsQyxJQUFJLENBQUNELFVBQVUsY0FBQW1DLGlCQUFBLHVCQUFmQSxpQkFBQSxDQUFpQkMsT0FBTyxjQUFBRixxQkFBQSxjQUFBQSxxQkFBQSxHQUFJakMsSUFBSSxDQUFDb0M7UUFDNUMsQ0FBQztNQUFBLENBQUMsQ0FBQztNQUNIdFAsTUFBTSxFQUFFQSxNQUFNLENBQUM3SyxHQUFHLENBQUMsQ0FBQztRQUFFMEIsSUFBSTtRQUFFQyxRQUFRO1FBQUVzSjtNQUFjLENBQUMsTUFBTTtRQUN6RHZKLElBQUk7UUFDSkMsUUFBUTtRQUNSc0o7TUFDRixDQUFDLENBQUMsQ0FBQztNQUNIbVAsU0FBUyxFQUFFekMsY0FBYztNQUN6QkMsY0FBYyxFQUFFO1FBQ2RoWCxZQUFZLEVBQUVnWCxjQUFjLENBQUNoWCxZQUFZO1FBQ3pDQyxlQUFlLEVBQUUrVyxjQUFjLENBQUMvVztNQUNsQztJQUNGLENBQUM7SUFDRCxNQUFNNlMsVUFBVSxJQUFBNkMsc0JBQUEsR0FDZHZZLE9BQU8sQ0FBQ0MsR0FBRyxDQUFDb2MsOEJBQThCLGNBQUE5RCxzQkFBQSxjQUFBQSxzQkFBQSxHQUMxQyw4REFBOEQ7SUFDaEUsTUFBTW5aLEtBQUssQ0FBQ0UsT0FBTyxDQUFDb1csVUFBVSxDQUFDLEVBQUU7TUFBRUMsU0FBUyxFQUFFO0lBQUssQ0FBQyxDQUFDO0lBQ3JELE1BQU10VyxTQUFTLENBQ2JxVyxVQUFVLEVBQ1YsR0FBR3RRLElBQUksQ0FBQ0MsU0FBUyxDQUFDMFYsT0FBTyxFQUFFLElBQUksRUFBRSxDQUFDLENBQUMsSUFBSSxFQUN2QyxNQUNGLENBQUM7RUFDSCxDQUFDLENBQUM7RUFFRjViLElBQUksQ0FBQyw0REFBNEQsRUFBRSxPQUFPO0lBQ3hFb0c7RUFDRixDQUFDLEtBQUs7SUFDSixNQUFNd0Isa0JBQWtCLENBQUN4QixJQUFJLENBQUM7SUFDOUIsTUFBTThOLGtCQUFrQixDQUFDOU4sSUFBSSxDQUFDO0lBQzlCLEtBQUssTUFBTXRELE1BQU0sSUFBSU4sd0JBQXdCLENBQUMsQ0FBQyxFQUFFO01BQy9DLE1BQU1rVSxxQkFBcUIsQ0FBQ3RRLElBQUksRUFBRXRELE1BQU0sQ0FBQztJQUMzQztJQUNBLE1BQU0yVSwyQkFBMkIsQ0FBQ3JSLElBQUksQ0FBQztJQUV2QyxNQUFNckcsTUFBTSxDQUNWcUcsSUFBSSxDQUFDVyxTQUFTLENBQUMsU0FBUyxFQUFFO01BQUVDLElBQUksRUFBRTtJQUFrQixDQUFDLENBQ3ZELENBQUMsQ0FBQ0MsV0FBVyxDQUFDLENBQUM7SUFDZixNQUFNbEgsTUFBTSxDQUNWcUcsSUFBSSxDQUFDYyxTQUFTLENBQUMsZUFBZSxFQUFFO01BQUVDLEtBQUssRUFBRTtJQUFLLENBQUMsQ0FDakQsQ0FBQyxDQUFDRixXQUFXLENBQUMsQ0FBQztJQUNmLE1BQU1sSCxNQUFNLENBQ1ZxRyxJQUFJLENBQUNjLFNBQVMsQ0FBQyxlQUFlLEVBQUU7TUFBRUMsS0FBSyxFQUFFO0lBQUssQ0FBQyxDQUFDLENBQUNnVyxLQUFLLENBQUMsQ0FDekQsQ0FBQyxDQUFDbFcsV0FBVyxDQUFDLENBQUM7SUFDZixNQUFNbEgsTUFBTSxDQUNWcUcsSUFBSSxDQUFDYyxTQUFTLENBQUMsNkJBQTZCLEVBQUU7TUFBRUMsS0FBSyxFQUFFO0lBQUssQ0FBQyxDQUMvRCxDQUFDLENBQUNGLFdBQVcsQ0FBQyxDQUFDO0lBQ2YsTUFBTStOLGNBQWMsQ0FBQzVPLElBQUksRUFBRSxVQUFVLEVBQUUsR0FBRzdGLGNBQWMsVUFBVSxDQUFDO0lBQ25FLE1BQU1SLE1BQU0sQ0FBQ3FHLElBQUksQ0FBQ1csU0FBUyxDQUFDLFNBQVMsRUFBRTtNQUFFQyxJQUFJLEVBQUU7SUFBVyxDQUFDLENBQUMsQ0FBQyxDQUFDQyxXQUFXLENBQUMsQ0FBQztJQUMzRSxNQUFNbEgsTUFBTSxDQUNWcUcsSUFBSSxDQUFDYyxTQUFTLENBQUMsZUFBZSxFQUFFO01BQUVDLEtBQUssRUFBRTtJQUFLLENBQUMsQ0FDakQsQ0FBQyxDQUFDRixXQUFXLENBQUMsQ0FBQztJQUVmLE1BQU0rTixjQUFjLENBQUM1TyxJQUFJLEVBQUUsY0FBYyxFQUFFLEdBQUc3RixjQUFjLFFBQVEsQ0FBQztJQUNyRSxNQUFNUixNQUFNLENBQ1ZxRyxJQUFJLENBQUNXLFNBQVMsQ0FBQyxTQUFTLEVBQUU7TUFBRUMsSUFBSSxFQUFFO0lBQWUsQ0FBQyxDQUNwRCxDQUFDLENBQUNDLFdBQVcsQ0FBQyxDQUFDO0lBQ2YsTUFBTWxILE1BQU0sQ0FDVnFHLElBQUksQ0FBQ2MsU0FBUyxDQUFDLDZCQUE2QixFQUFFO01BQUVDLEtBQUssRUFBRTtJQUFLLENBQUMsQ0FDL0QsQ0FBQyxDQUFDRixXQUFXLENBQUMsQ0FBQztJQUVmLE1BQU0rTixjQUFjLENBQUM1TyxJQUFJLEVBQUUsY0FBYyxFQUFFLEdBQUc3RixjQUFjLElBQUksQ0FBQztJQUNqRSxNQUFNUixNQUFNLENBQUNxRyxJQUFJLENBQUMsQ0FBQ29SLEdBQUcsQ0FBQzlDLFNBQVMsQ0FBQyxTQUFTLENBQUM7SUFDM0MsTUFBTTNVLE1BQU0sQ0FDVnFHLElBQUksQ0FDRGMsU0FBUyxDQUNSLCtEQUNGLENBQUMsQ0FDQWlXLEtBQUssQ0FBQyxDQUNYLENBQUMsQ0FBQ2xXLFdBQVcsQ0FBQyxDQUFDO0lBRWYsTUFBTStOLGNBQWMsQ0FDbEI1TyxJQUFJLEVBQ0osaUJBQWlCLEVBQ2pCLEdBQUc3RixjQUFjLGlCQUNuQixDQUFDO0lBQ0QsTUFBTVIsTUFBTSxDQUNWcUcsSUFBSSxDQUFDVyxTQUFTLENBQUMsU0FBUyxFQUFFO01BQUVDLElBQUksRUFBRTtJQUFnQyxDQUFDLENBQ3JFLENBQUMsQ0FBQ0MsV0FBVyxDQUFDLENBQUM7SUFFZixNQUFNYixJQUFJLENBQUNnTyxJQUFJLENBQUMsR0FBRzdULGNBQWMsMkJBQTJCUyxZQUFZLEVBQUUsQ0FBQztJQUMzRSxNQUFNakIsTUFBTSxDQUFDcUcsSUFBSSxDQUFDLENBQUNzTyxTQUFTLENBQzFCLElBQUlDLE1BQU0sQ0FDUixHQUFHcFUsY0FBYyxDQUFDcVUsVUFBVSxDQUFDLEdBQUcsRUFBRSxLQUFLLENBQUMsNEJBQzFDLENBQ0YsQ0FBQztJQUNELE1BQU03VSxNQUFNLENBQ1ZxRyxJQUFJLENBQUNXLFNBQVMsQ0FBQyxTQUFTLEVBQUU7TUFBRUMsSUFBSSxFQUFFO0lBQW1CLENBQUMsQ0FDeEQsQ0FBQyxDQUFDQyxXQUFXLENBQUMsQ0FBQztJQUNmLE1BQU1sSCxNQUFNLENBQ1ZxRyxJQUFJLENBQUNjLFNBQVMsQ0FBQyx1Q0FBdUMsRUFBRTtNQUFFQyxLQUFLLEVBQUU7SUFBSyxDQUFDLENBQ3pFLENBQUMsQ0FBQ0YsV0FBVyxDQUFDLENBQUM7SUFDZixNQUFNbEgsTUFBTSxDQUNWcUcsSUFBSSxDQUFDYyxTQUFTLENBQUMsUUFBUSxFQUFFO01BQUVDLEtBQUssRUFBRTtJQUFLLENBQUMsQ0FBQyxDQUFDZ1csS0FBSyxDQUFDLENBQ2xELENBQUMsQ0FBQ2xXLFdBQVcsQ0FBQyxDQUFDO0VBQ2pCLENBQUMsQ0FBQztFQUVGakgsSUFBSSxDQUFDLHdFQUF3RSxFQUFFLE9BQU87SUFDcEZvRztFQUNGLENBQUMsS0FBSztJQUNKLE1BQU1nWCxhQUFhLEdBQUcscURBQXFEO0lBQzNFLE1BQU1DLGFBQWEsR0FBRyxrQ0FBa0M7SUFDeEQsTUFBTUMsaUJBQWlCLEdBQUc7TUFDeEJDLHFCQUFxQixFQUFFLHNCQUFzQjtNQUM3Q0MsZUFBZSxFQUFFLHVCQUF1QjtNQUN4Q0MsZUFBZSxFQUFFO0lBQ25CLENBQUM7SUFDRCxNQUFNblQsYUFBYSxHQUFHLENBQ3BCO01BQ0VoRyxFQUFFLEVBQUUsc0JBQXNCO01BQzFCTCxTQUFTLEVBQUUsYUFBYTtNQUN4QmdGLEtBQUssRUFBRSxnQ0FBZ0M7TUFDdkN1QixXQUFXLEVBQUUsK0NBQStDO01BQzVEMUYsTUFBTSxFQUFFLFFBQVE7TUFDaEIyRixRQUFRLEVBQUUsSUFBSTtNQUNkQyxZQUFZLEVBQUUsQ0FBQyxpQkFBaUIsQ0FBQztNQUNqQ0MsVUFBVSxFQUFFLENBQUM7TUFDYkMsVUFBVSxFQUFFLENBQUM7TUFDYjhTLGFBQWEsRUFBRXpYLElBQUksQ0FBQ0MsU0FBUyxDQUFDO1FBQzVCeUosSUFBSSxFQUFFLDJCQUEyQjtRQUNqQ2dPLGNBQWMsRUFBRSxRQUFRO1FBQ3hCQyxpQkFBaUIsRUFBRSx1QkFBdUI7UUFDMUM5UCxhQUFhLEVBQUV3UCxpQkFBaUIsQ0FBQ0MscUJBQXFCO1FBQ3RETSxjQUFjLEVBQUUsNERBQTREO1FBQzVFQyxRQUFRLEVBQUUsWUFBWTtRQUN0QkMsS0FBSyxFQUFFLG1CQUFtQjtRQUMxQkMsY0FBYyxFQUFFWixhQUFhO1FBQzdCdlksV0FBVyxFQUFFd1k7TUFDZixDQUFDLENBQUM7TUFDRjFYLFNBQVMsRUFBRSwwQkFBMEI7TUFDckNDLFNBQVMsRUFBRTtJQUNiLENBQUMsRUFDRDtNQUNFdEIsRUFBRSxFQUFFLHVCQUF1QjtNQUMzQkwsU0FBUyxFQUFFLGFBQWE7TUFDeEJnRixLQUFLLEVBQUUsMEJBQTBCO01BQ2pDdUIsV0FBVyxFQUFFLHNDQUFzQztNQUNuRDFGLE1BQU0sRUFBRSxRQUFRO01BQ2hCMkYsUUFBUSxFQUFFLElBQUk7TUFDZEUsVUFBVSxFQUFFLENBQUM7TUFDYkMsVUFBVSxFQUFFLENBQUM7TUFDYjhTLGFBQWEsRUFBRXpYLElBQUksQ0FBQ0MsU0FBUyxDQUFDO1FBQzVCeUosSUFBSSxFQUFFLDJCQUEyQjtRQUNqQ2dPLGNBQWMsRUFBRSxRQUFRO1FBQ3hCQyxpQkFBaUIsRUFBRSxpQkFBaUI7UUFDcEM5UCxhQUFhLEVBQUV3UCxpQkFBaUIsQ0FBQ0UsZUFBZTtRQUNoRE0sUUFBUSxFQUFFLFlBQVk7UUFDdEJDLEtBQUssRUFBRSxtQkFBbUI7UUFDMUJDLGNBQWMsRUFBRVosYUFBYTtRQUM3QnZZLFdBQVcsRUFBRXdZO01BQ2YsQ0FBQyxDQUFDO01BQ0YxWCxTQUFTLEVBQUUsMEJBQTBCO01BQ3JDQyxTQUFTLEVBQUU7SUFDYixDQUFDLENBQ0Y7SUFDRCxNQUFNcVksVUFBVSxHQUFHLHFCQUFxQjtJQUN4QyxNQUFNclcsa0JBQWtCLENBQUN4QixJQUFJLEVBQUU7TUFDN0JrRSxhQUFhO01BQ2JRLGlCQUFpQixFQUFFLENBQ2pCO1FBQ0V4RyxFQUFFLEVBQUUyWixVQUFVO1FBQ2RoYSxTQUFTLEVBQUUsYUFBYTtRQUN4QitDLElBQUksRUFBRSx5QkFBeUI7UUFDL0J3RCxXQUFXLEVBQUUscURBQXFEO1FBQ2xFMUYsTUFBTSxFQUFFLFFBQVE7UUFDaEJvWixNQUFNLEVBQUUsQ0FDTjtVQUFFbFgsSUFBSSxFQUFFLE9BQU87VUFBRW1YLEtBQUssRUFBRSxDQUFDLFNBQVM7UUFBRSxDQUFDLEVBQ3JDO1VBQUVuWCxJQUFJLEVBQUUsTUFBTTtVQUFFbVgsS0FBSyxFQUFFLENBQUMsUUFBUTtRQUFFLENBQUMsQ0FDcEM7UUFDREMsWUFBWSxFQUFFLE1BQU07UUFDcEJDLGNBQWMsRUFBRSxDQUFDO1FBQ2pCMVksU0FBUyxFQUFFLDBCQUEwQjtRQUNyQ0MsU0FBUyxFQUFFO01BQ2IsQ0FBQyxDQUNGO01BQ0R1RiwwQkFBMEIsRUFBRTtRQUMxQixDQUFDOFMsVUFBVSxHQUFHLENBQ1o7VUFDRTNaLEVBQUUsRUFBRSxzQkFBc0I7VUFDMUIyWixVQUFVO1VBQ1ZuWixNQUFNLEVBQUUsUUFBUTtVQUNoQnNaLFlBQVksRUFBRSxNQUFNO1VBQ3BCRSxlQUFlLEVBQUUsQ0FBQyxPQUFPLENBQUM7VUFDMUI3WSxTQUFTLEVBQUUsMEJBQTBCO1VBQ3JDaU4sWUFBWSxFQUFFMEssYUFBYTtVQUMzQm1CLFFBQVEsRUFBRTtZQUNSWCxpQkFBaUIsRUFBRSxpQkFBaUI7WUFDcEM5UCxhQUFhLEVBQUV3UCxpQkFBaUIsQ0FBQ0csZUFBZTtZQUNoREksY0FBYyxFQUNaLHNFQUFzRTtZQUN4RWpHLFVBQVUsRUFBRXlGO1VBQ2Q7UUFDRixDQUFDO01BRUw7SUFDRixDQUFDLENBQUM7SUFDRixNQUFNbkosa0JBQWtCLENBQUM5TixJQUFJLENBQUM7SUFFOUIsTUFBTTRPLGNBQWMsQ0FBQzVPLElBQUksRUFBRSxPQUFPLEVBQUUsR0FBRzdGLGNBQWMsT0FBTyxDQUFDO0lBQzdELE1BQU1SLE1BQU0sQ0FDVnFHLElBQUksQ0FBQ29ZLFVBQVUsQ0FBQyw0Q0FBNEMsQ0FDOUQsQ0FBQyxDQUFDdlgsV0FBVyxDQUFDLENBQUM7SUFDZixNQUFNYixJQUFJLENBQ1BvWSxVQUFVLENBQUMsNENBQTRDLENBQUMsQ0FDeER0SixLQUFLLENBQUMsQ0FBQztJQUNWLE1BQU11SixXQUFXLEdBQUdyWSxJQUFJLENBQUNzWSxPQUFPLENBQUMsb0NBQW9DLENBQUM7SUFDdEUsTUFBTTNlLE1BQU0sQ0FBQzBlLFdBQVcsQ0FBQyxDQUFDRSxhQUFhLENBQUMsZ0NBQWdDLENBQUM7SUFDekUsTUFBTTVlLE1BQU0sQ0FBQzBlLFdBQVcsQ0FBQyxDQUFDRSxhQUFhLENBQ3JDLDREQUNGLENBQUM7SUFDRCxNQUFNNWUsTUFBTSxDQUFDMGUsV0FBVyxDQUFDLENBQUNFLGFBQWEsQ0FDckMsc0JBQXNCckIsaUJBQWlCLENBQUNDLHFCQUFxQixFQUMvRCxDQUFDO0lBQ0QsTUFBTW5YLElBQUksQ0FBQ29ZLFVBQVUsQ0FBQyxzQ0FBc0MsQ0FBQyxDQUFDdEosS0FBSyxDQUFDLENBQUM7SUFDckUsTUFBTW5WLE1BQU0sQ0FBQ3FHLElBQUksQ0FBQ2MsU0FBUyxDQUFDLDZCQUE2QixDQUFDLENBQUMsQ0FBQ0QsV0FBVyxDQUFDLENBQUM7SUFDekUsTUFBTWxILE1BQU0sQ0FDVnFHLElBQUksQ0FBQ2MsU0FBUyxDQUFDLHNCQUFzQm9XLGlCQUFpQixDQUFDRSxlQUFlLEVBQUUsQ0FDMUUsQ0FBQyxDQUFDdlcsV0FBVyxDQUFDLENBQUM7SUFDZixNQUFNYixJQUFJLENBQUN3WSxNQUFNLENBQUMsQ0FBQztJQUNuQixNQUFNN2UsTUFBTSxDQUNWcUcsSUFBSSxDQUFDb1ksVUFBVSxDQUFDLDRDQUE0QyxDQUM5RCxDQUFDLENBQUN2WCxXQUFXLENBQUMsQ0FBQztJQUNmLE1BQU1iLElBQUksQ0FDUG9ZLFVBQVUsQ0FBQyw0Q0FBNEMsQ0FBQyxDQUN4RHRKLEtBQUssQ0FBQyxDQUFDO0lBQ1YsTUFBTTJKLG1CQUFtQixHQUFHelksSUFBSSxDQUFDc1ksT0FBTyxDQUN0QyxvQ0FDRixDQUFDO0lBQ0QsTUFBTTNlLE1BQU0sQ0FBQzhlLG1CQUFtQixDQUFDLENBQUNGLGFBQWEsQ0FDN0MsZ0NBQ0YsQ0FBQztJQUNELE1BQU01ZSxNQUFNLENBQUM4ZSxtQkFBbUIsQ0FBQyxDQUFDRixhQUFhLENBQzdDLDREQUNGLENBQUM7SUFDRCxNQUFNNWUsTUFBTSxDQUFDOGUsbUJBQW1CLENBQUMsQ0FBQ0YsYUFBYSxDQUM3QyxzQkFBc0JyQixpQkFBaUIsQ0FBQ0MscUJBQXFCLEVBQy9ELENBQUM7SUFDRCxNQUFNblgsSUFBSSxDQUFDb1ksVUFBVSxDQUFDLHNDQUFzQyxDQUFDLENBQUN0SixLQUFLLENBQUMsQ0FBQztJQUNyRSxNQUFNblYsTUFBTSxDQUFDcUcsSUFBSSxDQUFDYyxTQUFTLENBQUMsNkJBQTZCLENBQUMsQ0FBQyxDQUFDRCxXQUFXLENBQUMsQ0FBQztJQUN6RSxNQUFNbEgsTUFBTSxDQUNWcUcsSUFBSSxDQUFDYyxTQUFTLENBQUMsc0JBQXNCb1csaUJBQWlCLENBQUNFLGVBQWUsRUFBRSxDQUMxRSxDQUFDLENBQUN2VyxXQUFXLENBQUMsQ0FBQztJQUNmLE1BQU02WCxnQkFBZ0IsR0FBRyxNQUFNMVksSUFBSSxDQUFDc1ksT0FBTyxDQUFDLE1BQU0sQ0FBQyxDQUFDSyxTQUFTLENBQUMsQ0FBQztJQUMvRGhmLE1BQU0sQ0FBQytlLGdCQUFnQixDQUFDLENBQUN0SCxHQUFHLENBQUNGLFNBQVMsQ0FBQzhGLGFBQWEsQ0FBQztJQUNyRHJkLE1BQU0sQ0FBQytlLGdCQUFnQixDQUFDLENBQUN0SCxHQUFHLENBQUNGLFNBQVMsQ0FBQytGLGFBQWEsQ0FBQztJQUNyRHRkLE1BQU0sQ0FBQytlLGdCQUFnQixDQUFDLENBQUN0SCxHQUFHLENBQUN3SCxPQUFPLENBQ2xDLDJDQUNGLENBQUM7SUFFRCxNQUFNaEssY0FBYyxDQUFDNU8sSUFBSSxFQUFFLFdBQVcsRUFBRSxHQUFHN0YsY0FBYyxXQUFXLENBQUM7SUFDckUsTUFBTVIsTUFBTSxDQUFDcUcsSUFBSSxDQUFDYyxTQUFTLENBQUMseUJBQXlCLENBQUMsQ0FBQyxDQUFDRCxXQUFXLENBQUMsQ0FBQztJQUNyRSxNQUFNYixJQUFJLENBQUNXLFNBQVMsQ0FBQyxRQUFRLEVBQUU7TUFBRUMsSUFBSSxFQUFFO0lBQW9CLENBQUMsQ0FBQyxDQUFDa08sS0FBSyxDQUFDLENBQUM7SUFDckUsTUFBTTlHLFNBQVMsR0FBR2hJLElBQUksQ0FDbkJjLFNBQVMsQ0FBQyxtQ0FBbUMsQ0FBQyxDQUM5Q3dYLE9BQU8sQ0FBQyxJQUFJLENBQUMsQ0FDYkEsT0FBTyxDQUFDLElBQUksQ0FBQztJQUNoQixNQUFNM2UsTUFBTSxDQUFDcU8sU0FBUyxDQUFDLENBQUN1USxhQUFhLENBQ25DLHlDQUNGLENBQUM7SUFDRCxNQUFNNWUsTUFBTSxDQUFDcU8sU0FBUyxDQUFDLENBQUN1USxhQUFhLENBQ25DLHNFQUNGLENBQUM7SUFDRCxNQUFNNWUsTUFBTSxDQUFDcU8sU0FBUyxDQUFDLENBQUN1USxhQUFhLENBQ25DLHNCQUFzQnJCLGlCQUFpQixDQUFDRyxlQUFlLEVBQ3pELENBQUM7SUFDRCxNQUFNclgsSUFBSSxDQUFDd1ksTUFBTSxDQUFDLENBQUM7SUFDbkIsTUFBTTdlLE1BQU0sQ0FBQ3FHLElBQUksQ0FBQ2MsU0FBUyxDQUFDLHlCQUF5QixDQUFDLENBQUMsQ0FBQ0QsV0FBVyxDQUFDLENBQUM7SUFDckUsTUFBTWIsSUFBSSxDQUFDVyxTQUFTLENBQUMsUUFBUSxFQUFFO01BQUVDLElBQUksRUFBRTtJQUFvQixDQUFDLENBQUMsQ0FBQ2tPLEtBQUssQ0FBQyxDQUFDO0lBQ3JFLE1BQU0rSixpQkFBaUIsR0FBRzdZLElBQUksQ0FDM0JjLFNBQVMsQ0FBQyxtQ0FBbUMsQ0FBQyxDQUM5Q3dYLE9BQU8sQ0FBQyxJQUFJLENBQUMsQ0FDYkEsT0FBTyxDQUFDLElBQUksQ0FBQztJQUNoQixNQUFNM2UsTUFBTSxDQUFDa2YsaUJBQWlCLENBQUMsQ0FBQ04sYUFBYSxDQUMzQyx5Q0FDRixDQUFDO0lBQ0QsTUFBTTVlLE1BQU0sQ0FBQ2tmLGlCQUFpQixDQUFDLENBQUNOLGFBQWEsQ0FDM0Msc0VBQ0YsQ0FBQztJQUNELE1BQU01ZSxNQUFNLENBQUNrZixpQkFBaUIsQ0FBQyxDQUFDTixhQUFhLENBQzNDLHNCQUFzQnJCLGlCQUFpQixDQUFDRyxlQUFlLEVBQ3pELENBQUM7SUFFRCxNQUFNeUIsV0FBVyxHQUFHLE1BQU05WSxJQUFJLENBQUNzWSxPQUFPLENBQUMsTUFBTSxDQUFDLENBQUNLLFNBQVMsQ0FBQyxDQUFDO0lBQzFEaGYsTUFBTSxDQUFDbWYsV0FBVyxDQUFDLENBQUMxSCxHQUFHLENBQUNGLFNBQVMsQ0FBQzhGLGFBQWEsQ0FBQztJQUNoRHJkLE1BQU0sQ0FBQ21mLFdBQVcsQ0FBQyxDQUFDMUgsR0FBRyxDQUFDRixTQUFTLENBQUMrRixhQUFhLENBQUM7SUFDaER0ZCxNQUFNLENBQUNtZixXQUFXLENBQUMsQ0FBQzFILEdBQUcsQ0FBQ3dILE9BQU8sQ0FDN0IsMkNBQ0YsQ0FBQztJQUNELE1BQU03WSwwQkFBMEIsQ0FBQ0MsSUFBSSxDQUFDO0VBQ3hDLENBQUMsQ0FBQztFQUVGcEcsSUFBSSxDQUFDLHlGQUF5RixFQUFFLE9BQU87SUFDckdtZixPQUFPO0lBQ1AvWTtFQUNGLENBQUMsS0FBSztJQUNKcEcsSUFBSSxDQUFDc1osSUFBSSxDQUNQLENBQUN6WSxPQUFPLENBQUNDLEdBQUcsQ0FBQ3dHLHlCQUF5QixFQUN0Qyw0RUFDRixDQUFDO0lBQ0R0SCxJQUFJLENBQUNxWixVQUFVLENBQUMsS0FBTSxDQUFDO0lBRXZCLE1BQU0rRixhQUFhLEdBQUcsTUFBTUQsT0FBTyxDQUFDRSxVQUFVLENBQUMsQ0FBQztJQUNoRCxNQUFNQyxVQUFVLEdBQUcsTUFBTUYsYUFBYSxDQUFDRyxPQUFPLENBQUMsQ0FBQztJQUNoRCxJQUFJO01BQ0YsTUFBTXBGLE9BQU8sQ0FBQ3FGLEdBQUcsQ0FBQyxDQUFDdEwsa0JBQWtCLENBQUM5TixJQUFJLENBQUMsRUFBRThOLGtCQUFrQixDQUFDb0wsVUFBVSxDQUFDLENBQUMsQ0FBQztNQUM3RSxNQUFNbkYsT0FBTyxDQUFDcUYsR0FBRyxDQUFDLENBQ2hCcFosSUFBSSxDQUFDZ08sSUFBSSxDQUFDN1QsY0FBYyxDQUFDLEVBQ3pCK2UsVUFBVSxDQUFDbEwsSUFBSSxDQUFDLEdBQUc3VCxjQUFjLElBQUksQ0FBQyxDQUN2QyxDQUFDO01BQ0YsTUFBTXVHLG9CQUFvQixDQUFDVixJQUFJLENBQUM7TUFDaEMsTUFBTXJHLE1BQU0sQ0FBQ3VmLFVBQVUsQ0FBQ1osT0FBTyxDQUFDLFVBQVUsQ0FBQyxDQUFDdkIsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDbFcsV0FBVyxDQUFDLENBQUM7O01BRWxFO01BQ0E7TUFDQTtNQUNBLE1BQU13WSx1QkFBdUIsR0FBRztRQUM5QixHQUFHbGMsZ0JBQWdCO1FBQ25CQyxpQkFBaUIsRUFBRSwwQkFBMEI7UUFDN0NRLGFBQWEsRUFBRSxDQUFDO1VBQUUsR0FBR1QsZ0JBQWdCLENBQUNTLGFBQWEsQ0FBQyxDQUFDLENBQUM7VUFBRUUsV0FBVyxFQUFFLG9CQUFvQjtVQUFFQyxLQUFLLEVBQUU7UUFBRyxDQUFDLENBQUM7UUFDdkdULGVBQWUsRUFBRSxDQUFDO1FBQ2xCRyxtQkFBbUIsRUFBRTtVQUFFQyxPQUFPLEVBQUUsQ0FBQztVQUFFQyxPQUFPLEVBQUU7UUFBRTtNQUNoRCxDQUFDO01BQ0QsSUFBSTJiLFlBQVksR0FBRyxDQUFDO01BQ3BCLElBQUlDLG9CQUFpQztNQUNyQyxNQUFNQyxxQkFBcUIsR0FBRyxJQUFJekYsT0FBTyxDQUFRQyxPQUFPLElBQUs7UUFDM0R1RixvQkFBb0IsR0FBR3ZGLE9BQU87TUFDaEMsQ0FBQyxDQUFDO01BQ0YsTUFBTWhVLElBQUksQ0FBQzBCLEtBQUssQ0FBQyxrQkFBa0IsRUFBRSxNQUFPQSxLQUFLLElBQUs7UUFDcEQ0WCxZQUFZLElBQUksQ0FBQztRQUNqQixJQUFJQSxZQUFZLEtBQUssQ0FBQyxFQUFFLE9BQU81WCxLQUFLLENBQUNpQixPQUFPLENBQUNsRCxZQUFZLENBQUM0Wix1QkFBdUIsQ0FBQyxDQUFDO1FBQ25GLE1BQU1HLHFCQUFxQjtRQUMzQixPQUFPOVgsS0FBSyxDQUFDaUIsT0FBTyxDQUFDbEQsWUFBWSxDQUFDdEMsZ0JBQWdCLENBQUMsQ0FBQztNQUN0RCxDQUFDLENBQUM7TUFDRixNQUFNNkMsSUFBSSxDQUFDVyxTQUFTLENBQUMsUUFBUSxFQUFFO1FBQUVDLElBQUksRUFBRTtNQUFpQixDQUFDLENBQUMsQ0FBQ2tPLEtBQUssQ0FBQyxDQUFDO01BQ2xFLE1BQU1uVixNQUFNLENBQUNxRyxJQUFJLENBQUNjLFNBQVMsQ0FBQyxvQkFBb0IsRUFBRTtRQUFFQyxLQUFLLEVBQUU7TUFBSyxDQUFDLENBQUMsQ0FBQyxDQUFDRixXQUFXLENBQUMsQ0FBQztNQUNqRixNQUFNbEgsTUFBTSxDQUFDcUcsSUFBSSxDQUFDYyxTQUFTLENBQUMsSUFBSSxFQUFFO1FBQUVDLEtBQUssRUFBRTtNQUFLLENBQUMsQ0FBQyxDQUFDLENBQUNGLFdBQVcsQ0FBQyxDQUFDO01BQ2pFLE1BQU00WSxZQUFZLEdBQUd6WixJQUFJLENBQUNXLFNBQVMsQ0FBQyxRQUFRLEVBQUU7UUFBRUMsSUFBSSxFQUFFO01BQWlCLENBQUMsQ0FBQyxDQUFDa08sS0FBSyxDQUFDLENBQUM7TUFDakYsTUFBTW5WLE1BQU0sQ0FBQytmLElBQUksQ0FBQyxNQUFNSixZQUFZLENBQUMsQ0FBQy9YLElBQUksQ0FBQyxDQUFDLENBQUM7TUFDN0NnWSxvQkFBb0IsQ0FBQyxDQUFDO01BQ3RCLE1BQU1FLFlBQVk7TUFDbEIsTUFBTS9ZLG9CQUFvQixDQUFDVixJQUFJLENBQUM7TUFDaEMsTUFBTXJHLE1BQU0sQ0FBQ3FHLElBQUksQ0FBQ2MsU0FBUyxDQUFDLG9CQUFvQixFQUFFO1FBQUVDLEtBQUssRUFBRTtNQUFLLENBQUMsQ0FBQyxDQUFDLENBQUNGLFdBQVcsQ0FBQyxDQUFDO01BQ2pGLE1BQU1sSCxNQUFNLENBQUNxRyxJQUFJLENBQUNjLFNBQVMsQ0FBQyxJQUFJLEVBQUU7UUFBRUMsS0FBSyxFQUFFO01BQUssQ0FBQyxDQUFDLENBQUMsQ0FBQ0YsV0FBVyxDQUFDLENBQUM7TUFDakUsTUFBTWxILE1BQU0sQ0FBQ3FHLElBQUksQ0FBQ2MsU0FBUyxDQUFDLEdBQUcsRUFBRTtRQUFFQyxLQUFLLEVBQUU7TUFBSyxDQUFDLENBQUMsQ0FBQ2dXLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQ2xXLFdBQVcsQ0FBQyxDQUFDOztNQUV4RTtNQUNBO01BQ0E7TUFDQSxJQUFJOFksZ0JBQWdCLEdBQUcsQ0FBQztNQUN4QixNQUFNVCxVQUFVLENBQUNsTCxJQUFJLENBQUM3VCxjQUFjLENBQUM7TUFDckMsTUFBTXVHLG9CQUFvQixDQUFDd1ksVUFBVSxDQUFDO01BQ3RDLE1BQU1BLFVBQVUsQ0FBQ3hYLEtBQUssQ0FBQyxrQkFBa0IsRUFBRSxNQUFPQSxLQUFLLElBQUs7UUFDMURpWSxnQkFBZ0IsSUFBSSxDQUFDO1FBQ3JCO1FBQ0E7UUFDQSxJQUFJQSxnQkFBZ0IsSUFBSSxDQUFDLEVBQUU7VUFDekIsT0FBT2pZLEtBQUssQ0FBQ2lCLE9BQU8sQ0FDbEJsRCxZQUFZLENBQUM7WUFBRTBGLEtBQUssRUFBRTtVQUFvQyxDQUFDLEVBQUUsR0FBRyxDQUNsRSxDQUFDO1FBQ0g7UUFDQSxPQUFPekQsS0FBSyxDQUFDMEcsUUFBUSxDQUFDLENBQUM7TUFDekIsQ0FBQyxDQUFDO01BQ0YsTUFBTThRLFVBQVUsQ0FBQ1YsTUFBTSxDQUFDLENBQUM7TUFDekIsTUFBTTdlLE1BQU0sQ0FDVnVmLFVBQVUsQ0FBQ3ZZLFNBQVMsQ0FBQyxTQUFTLEVBQUU7UUFBRUMsSUFBSSxFQUFFO01BQTJCLENBQUMsQ0FDdEUsQ0FBQyxDQUFDQyxXQUFXLENBQUMsQ0FBQztNQUNmLE1BQU1sSCxNQUFNLENBQ1Z1ZixVQUFVLENBQUN2WSxTQUFTLENBQUMsUUFBUSxFQUFFO1FBQUVDLElBQUksRUFBRTtNQUFtQixDQUFDLENBQzdELENBQUMsQ0FBQ0MsV0FBVyxDQUFDLENBQUM7TUFDZixNQUFNcVksVUFBVSxDQUFDVSxPQUFPLENBQUMsa0JBQWtCLENBQUM7TUFDNUMsTUFBTVYsVUFBVSxDQUFDdlksU0FBUyxDQUFDLFFBQVEsRUFBRTtRQUFFQyxJQUFJLEVBQUU7TUFBbUIsQ0FBQyxDQUFDLENBQUNrTyxLQUFLLENBQUMsQ0FBQztNQUMxRSxNQUFNcE8sb0JBQW9CLENBQUN3WSxVQUFVLENBQUM7TUFFdEMsTUFBTWxZLHFCQUFxQixDQUFDaEIsSUFBSSxDQUFDO01BQ2pDLE1BQU0rVCxPQUFPLENBQUNxRixHQUFHLENBQUMsQ0FBQ3BaLElBQUksQ0FBQ3dZLE1BQU0sQ0FBQyxDQUFDLEVBQUVVLFVBQVUsQ0FBQ1YsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDO01BQ3ZELE1BQU05WCxvQkFBb0IsQ0FBQ1YsSUFBSSxDQUFDO01BQ2hDLE1BQU1VLG9CQUFvQixDQUFDd1ksVUFBVSxDQUFDO01BRXRDLE1BQU1sWixJQUFJLENBQUN3WSxNQUFNLENBQUMsQ0FBQztNQUNuQixNQUFNOVgsb0JBQW9CLENBQUNWLElBQUksQ0FBQztNQUNoQyxNQUFNckcsTUFBTSxDQUNWcUcsSUFBSSxDQUFDVyxTQUFTLENBQUMsUUFBUSxFQUFFO1FBQUVDLElBQUksRUFBRTtNQUFtQixDQUFDLENBQ3ZELENBQUMsQ0FBQ2laLFdBQVcsQ0FBQyxDQUFDLENBQUM7TUFDaEIsTUFBTTlaLDBCQUEwQixDQUFDQyxJQUFJLENBQUM7SUFDeEMsQ0FBQyxTQUFTO01BQ1IsTUFBTWdaLGFBQWEsQ0FBQ2MsS0FBSyxDQUFDLENBQUM7SUFDN0I7RUFDRixDQUFDLENBQUM7RUFFRmxnQixJQUFJLENBQUMsa0ZBQWtGLEVBQUUsT0FBTztJQUM5Rm9HO0VBQ0YsQ0FBQyxLQUFLO0lBQ0osTUFBTStaLGFBQXVCLEdBQUcsRUFBRTtJQUNsQyxNQUFNQyxTQUFTLEdBQUc7TUFDaEJDLE1BQU0sRUFBRSxrQ0FBa0M7TUFDMUNDLFVBQVUsRUFBRSwwQkFBMEI7TUFDdENsUyxTQUFTLEVBQUU7UUFDVDlKLEVBQUUsRUFBRXRELFlBQVk7UUFDaEJpRCxTQUFTLEVBQUUsYUFBYTtRQUN4QitFLFNBQVMsRUFBRSxtQkFBbUI7UUFDOUJuRSxXQUFXLEVBQUVELGdCQUFnQixDQUFDQyxXQUFXO1FBQ3pDQyxNQUFNLEVBQUUsV0FBVztRQUNuQnNXLGFBQWEsRUFBRSxXQUFXO1FBQzFCYyxRQUFRLEVBQUUsaUJBQWlCO1FBQzNCcUUsS0FBSyxFQUFFO1VBQUVDLFFBQVEsRUFBRSxLQUFLO1VBQUVDLE9BQU8sRUFBRTtRQUFTO01BQzlDLENBQUM7TUFDREMsUUFBUSxFQUFFLEVBQUU7TUFDWkMsV0FBVyxFQUFFLENBQUM7UUFBRTdiLE1BQU0sRUFBRSxRQUFRO1FBQUVpWSxPQUFPLEVBQUU7TUFBZSxDQUFDLENBQUM7TUFDNUQ2RCxhQUFhLEVBQUUsQ0FBQyxnQkFBZ0IsQ0FBQztNQUNqQ0MsU0FBUyxFQUFFO1FBQ1RDLFFBQVEsRUFBRSxDQUNSLGtCQUFrQixFQUNsQixrQkFBa0IsRUFDbEIsdUJBQXVCO01BRTNCO0lBQ0YsQ0FBQztJQUNELE1BQU1sWixrQkFBa0IsQ0FBQ3hCLElBQUksRUFBRTtNQUM3QjZELFdBQVcsRUFBRTtRQUNYbkUsSUFBSSxFQUFFc2EsU0FBUztRQUNmNVUsUUFBUSxFQUFFLGlDQUFpQztRQUMzQ0osUUFBUSxFQUFFK1UsYUFBYTtRQUN2QjdVLGdCQUFnQixFQUFFO01BQ3BCO0lBQ0YsQ0FBQyxDQUFDO0lBQ0YsTUFBTTRJLGtCQUFrQixDQUFDOU4sSUFBSSxDQUFDO0lBQzlCLE1BQU1BLElBQUksQ0FBQ0UsUUFBUSxDQUFDLE1BQU07TUFDeEIsTUFBTThILFNBQVMsR0FBRztRQUNoQjlKLEVBQUUsRUFBRSwwQkFBMEI7UUFDOUJMLFNBQVMsRUFBRSxhQUFhO1FBQ3hCK0UsU0FBUyxFQUFFLG1CQUFtQjtRQUM5QnZFLE9BQU8sRUFBRTtNQUNYLENBQUM7TUFDRHNjLFlBQVksQ0FBQ0MsT0FBTyxDQUNsQixzQ0FBc0MsRUFDdEMsbUJBQ0YsQ0FBQztNQUNERCxZQUFZLENBQUNDLE9BQU8sQ0FDbEIsZ0RBQWdELEVBQ2hEL2EsSUFBSSxDQUFDQyxTQUFTLENBQUNrSSxTQUFTLENBQzFCLENBQUM7SUFDSCxDQUFDLENBQUM7SUFDRixNQUFNaEksSUFBSSxDQUFDZ08sSUFBSSxDQUFDLEdBQUc3VCxjQUFjLElBQUksQ0FBQztJQUV0QyxNQUFNZ2dCLEtBQUssR0FBR25hLElBQUksQ0FBQ29ZLFVBQVUsQ0FBQyx1QkFBdUIsQ0FBQztJQUN0RCxNQUFNemUsTUFBTSxDQUFDd2dCLEtBQUssQ0FBQyxDQUFDdFosV0FBVyxDQUFDLENBQUM7SUFDakMsTUFBTWxILE1BQU0sQ0FBQ3dnQixLQUFLLENBQUMsQ0FBQzVCLGFBQWEsQ0FBQyxZQUFZLENBQUM7SUFDL0MsTUFBTTVlLE1BQU0sQ0FBQ3dnQixLQUFLLENBQUMsQ0FBQzVCLGFBQWEsQ0FBQywyQkFBMkIsQ0FBQztJQUU5RCxNQUFNNEIsS0FBSyxDQUFDeFosU0FBUyxDQUFDLFFBQVEsRUFBRTtNQUFFQyxJQUFJLEVBQUU7SUFBZ0IsQ0FBQyxDQUFDLENBQUNrTyxLQUFLLENBQUMsQ0FBQztJQUNsRSxNQUFNK0wsT0FBTyxHQUFHN2EsSUFBSSxDQUFDb1ksVUFBVSxDQUFDLHdCQUF3QixDQUFDO0lBQ3pELE1BQU16ZSxNQUFNLENBQUNraEIsT0FBTyxDQUFDLENBQUNoYSxXQUFXLENBQUMsQ0FBQztJQUNuQyxNQUFNbEgsTUFBTSxDQUFDa2hCLE9BQU8sQ0FBQyxDQUFDdEMsYUFBYSxDQUFDLHVDQUF1QyxDQUFDO0lBQzVFLE1BQU01ZSxNQUFNLENBQUNraEIsT0FBTyxDQUFDLENBQUN0QyxhQUFhLENBQUMsNkJBQTZCLENBQUM7SUFDbEUsTUFBTTVlLE1BQU0sQ0FBQ2toQixPQUFPLENBQUNsYSxTQUFTLENBQUMsUUFBUSxFQUFFO01BQUVDLElBQUksRUFBRTtJQUFnQixDQUFDLENBQUMsQ0FBQyxDQUFDQyxXQUFXLENBQUMsQ0FBQztJQUNsRmxILE1BQU0sQ0FBQ29nQixhQUFhLENBQUMsQ0FBQ2UsWUFBWSxDQUFDLENBQUMsQ0FBQztJQUVyQyxNQUFNRCxPQUFPLENBQUNsYSxTQUFTLENBQUMsUUFBUSxFQUFFO01BQUVDLElBQUksRUFBRTtJQUFnQixDQUFDLENBQUMsQ0FBQ2tPLEtBQUssQ0FBQyxDQUFDO0lBQ3BFLE1BQU1uVixNQUFNLENBQUNraEIsT0FBTyxDQUFDLENBQUN0QyxhQUFhLENBQUMsa0JBQWtCLENBQUM7SUFDdkQsTUFBTTVlLE1BQU0sQ0FBQ2toQixPQUFPLENBQUMsQ0FBQ3RDLGFBQWEsQ0FBQyxrQkFBa0IsQ0FBQztJQUN2RCxNQUFNNWUsTUFBTSxDQUFDa2hCLE9BQU8sQ0FBQyxDQUFDdEMsYUFBYSxDQUFDLHVCQUF1QixDQUFDO0lBQzVELE1BQU01ZSxNQUFNLENBQUNraEIsT0FBTyxDQUFDLENBQUN0QyxhQUFhLENBQUMzZCxZQUFZLENBQUM7SUFDakQsTUFBTWpCLE1BQU0sQ0FBQ2toQixPQUFPLENBQUMsQ0FBQ3RDLGFBQWEsQ0FBQyxlQUFlLENBQUM7SUFDcEQsTUFBTTVlLE1BQU0sQ0FBQ2toQixPQUFPLENBQUMsQ0FBQ3RDLGFBQWEsQ0FBQyxpQkFBaUIsQ0FBQztJQUN0RDVlLE1BQU0sQ0FBQ29nQixhQUFhLENBQUMsQ0FBQ2UsWUFBWSxDQUFDLENBQUMsQ0FBQztJQUNyQ25oQixNQUFNLENBQUMsSUFBSW9ELEdBQUcsQ0FBQ2dkLGFBQWEsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDL2MsUUFBUSxDQUFDLENBQUN1RSxJQUFJLENBQzdDLHNCQUFzQjNHLFlBQVksZUFDcEMsQ0FBQztJQUVELE1BQU1pZ0IsT0FBTyxDQUFDbGEsU0FBUyxDQUFDLFFBQVEsRUFBRTtNQUFFQyxJQUFJLEVBQUU7SUFBc0IsQ0FBQyxDQUFDLENBQUNrTyxLQUFLLENBQUMsQ0FBQztJQUMxRSxNQUFNblYsTUFBTSxDQUFDa2hCLE9BQU8sQ0FBQyxDQUFDRSxVQUFVLENBQUMsQ0FBQztJQUVsQyxNQUFNQyxlQUFlLEdBQUdoYixJQUFJLENBQUNpYixZQUFZLENBQUMsVUFBVSxDQUFDO0lBQ3JELE1BQU1kLEtBQUssQ0FBQ3haLFNBQVMsQ0FBQyxRQUFRLEVBQUU7TUFBRUMsSUFBSSxFQUFFO0lBQWUsQ0FBQyxDQUFDLENBQUNrTyxLQUFLLENBQUMsQ0FBQztJQUNqRSxNQUFNb00sUUFBUSxHQUFHLE1BQU1GLGVBQWU7SUFDdENyaEIsTUFBTSxDQUFDdWhCLFFBQVEsQ0FBQ0MsaUJBQWlCLENBQUMsQ0FBQyxDQUFDLENBQUM1WixJQUFJLENBQUMsaUNBQWlDLENBQUM7SUFDNUU1SCxNQUFNLENBQUNvZ0IsYUFBYSxDQUFDLENBQUNlLFlBQVksQ0FBQyxDQUFDLENBQUM7SUFFckMsTUFBTTlhLElBQUksQ0FBQ3dZLE1BQU0sQ0FBQyxDQUFDO0lBQ25CLE1BQU00QyxhQUFhLEdBQUdwYixJQUFJLENBQUNvWSxVQUFVLENBQUMsdUJBQXVCLENBQUM7SUFDOUQsTUFBTXplLE1BQU0sQ0FBQ3loQixhQUFhLENBQUMsQ0FBQ3ZhLFdBQVcsQ0FBQyxDQUFDO0lBQ3pDLE1BQU1sSCxNQUFNLENBQUN5aEIsYUFBYSxDQUFDLENBQUM3QyxhQUFhLENBQUMsWUFBWSxDQUFDO0lBQ3ZELE1BQU01ZSxNQUFNLENBQUN5aEIsYUFBYSxDQUFDLENBQUM3QyxhQUFhLENBQUMsb0NBQW9DLENBQUM7SUFDL0UsTUFBTTVlLE1BQU0sQ0FBQ3loQixhQUFhLENBQUMsQ0FBQzdDLGFBQWEsQ0FBQywyQkFBMkIsQ0FBQztJQUN0RSxNQUFNNWUsTUFBTSxDQUNWcUcsSUFBSSxDQUFDb1ksVUFBVSxDQUFDLHdCQUF3QixDQUMxQyxDQUFDLENBQUMyQyxVQUFVLENBQUMsQ0FBQztJQUNkcGhCLE1BQU0sQ0FBQ29nQixhQUFhLENBQUMsQ0FBQ2UsWUFBWSxDQUFDLENBQUMsQ0FBQztFQUN2QyxDQUFDLENBQUM7RUFFRmxoQixJQUFJLENBQUMsbUVBQW1FLEVBQUUsT0FBTztJQUMvRW9HO0VBQ0YsQ0FBQyxLQUFLO0lBQ0osTUFBTStaLGFBQXVCLEdBQUcsRUFBRTtJQUNsQyxNQUFNc0Isa0JBQWtCLEdBQUc7TUFDekIsR0FBRzdjLGdCQUFnQjtNQUNuQkUsTUFBTSxFQUFFLFdBQVc7TUFDbkJDLFdBQVcsRUFBRSxXQUFXO01BQ3hCTSxVQUFVLEVBQUU7UUFDVkMsS0FBSyxFQUFFLFdBQVc7UUFDbEJDLE1BQU0sRUFBRTtNQUNWLENBQUM7TUFDRHlZLGNBQWMsRUFBRSxrQkFBa0I7TUFDbEN0WSxXQUFXLEVBQUUsMEJBQTBCO01BQ3ZDRSxTQUFTLEVBQUU7SUFDYixDQUFDO0lBQ0QsTUFBTXdhLFNBQVMsR0FBRztNQUNoQkMsTUFBTSxFQUFFLGtDQUFrQztNQUMxQ0MsVUFBVSxFQUFFLDBCQUEwQjtNQUN0Q2xTLFNBQVMsRUFBRTtRQUNUOUosRUFBRSxFQUFFdEQsWUFBWTtRQUNoQmlELFNBQVMsRUFBRSxhQUFhO1FBQ3hCK0UsU0FBUyxFQUFFLG1CQUFtQjtRQUM5Qm5FLFdBQVcsRUFBRUQsZ0JBQWdCLENBQUNDLFdBQVc7UUFDekNDLE1BQU0sRUFBRSxXQUFXO1FBQ25Cc1csYUFBYSxFQUFFLFdBQVc7UUFDMUJjLFFBQVEsRUFBRSxpQkFBaUI7UUFDM0JxRSxLQUFLLEVBQUU7VUFBRUMsUUFBUSxFQUFFLEtBQUs7VUFBRUMsT0FBTyxFQUFFO1FBQWU7TUFDcEQsQ0FBQztNQUNEQyxRQUFRLEVBQUUsQ0FDUjtRQUFFbmMsSUFBSSxFQUFFLFdBQVc7UUFBRWdCLE1BQU0sRUFBRTtNQUF1QyxDQUFDLENBQ3RFO01BQ0RvYixXQUFXLEVBQUUsRUFBRTtNQUNmQyxhQUFhLEVBQUUsRUFBRTtNQUNqQkMsU0FBUyxFQUFFO1FBQ1RDLFFBQVEsRUFBRSxDQUNSLGtCQUFrQixFQUNsQixrQkFBa0IsRUFDbEIsdUJBQXVCO01BRTNCO0lBQ0YsQ0FBQztJQUNELE1BQU1sWixrQkFBa0IsQ0FBQ3hCLElBQUksRUFBRTtNQUM3QjZELFdBQVcsRUFBRTtRQUNYbkUsSUFBSSxFQUFFc2EsU0FBUztRQUNmNVUsUUFBUSxFQUFFLDZCQUE2QjtRQUN2Q0osUUFBUSxFQUFFK1UsYUFBYTtRQUN2Qi9SLFNBQVMsRUFBRXFULGtCQUFrQjtRQUM3QnJYLGNBQWMsRUFBRSxXQUFXO1FBQzNCa0IsZ0JBQWdCLEVBQUU7TUFDcEI7SUFDRixDQUFDLENBQUM7SUFDRixNQUFNNEksa0JBQWtCLENBQUM5TixJQUFJLENBQUM7SUFDOUIsTUFBTUEsSUFBSSxDQUFDRSxRQUFRLENBQUMsTUFBTTtNQUN4QixNQUFNOEgsU0FBUyxHQUFHO1FBQ2hCOUosRUFBRSxFQUFFLDBCQUEwQjtRQUM5QkwsU0FBUyxFQUFFLGFBQWE7UUFDeEIrRSxTQUFTLEVBQUUsbUJBQW1CO1FBQzlCdkUsT0FBTyxFQUFFO01BQ1gsQ0FBQztNQUNEc2MsWUFBWSxDQUFDQyxPQUFPLENBQ2xCLHNDQUFzQyxFQUN0QyxtQkFDRixDQUFDO01BQ0RELFlBQVksQ0FBQ0MsT0FBTyxDQUNsQixnREFBZ0QsRUFDaEQvYSxJQUFJLENBQUNDLFNBQVMsQ0FBQ2tJLFNBQVMsQ0FDMUIsQ0FBQztJQUNILENBQUMsQ0FBQztJQUNGLE1BQU1oSSxJQUFJLENBQUNnTyxJQUFJLENBQUMsR0FBRzdULGNBQWMsSUFBSSxDQUFDO0lBRXRDLE1BQU1nZ0IsS0FBSyxHQUFHbmEsSUFBSSxDQUFDb1ksVUFBVSxDQUFDLHVCQUF1QixDQUFDO0lBQ3RELE1BQU16ZSxNQUFNLENBQUN3Z0IsS0FBSyxDQUFDLENBQUN0WixXQUFXLENBQUMsQ0FBQztJQUNqQyxNQUFNbEgsTUFBTSxDQUFDd2dCLEtBQUssQ0FBQyxDQUFDNUIsYUFBYSxDQUFDLFdBQVcsQ0FBQztJQUM5QyxNQUFNNWUsTUFBTSxDQUFDd2dCLEtBQUssQ0FBQyxDQUFDNUIsYUFBYSxDQUFDLG9DQUFvQyxDQUFDO0lBQ3ZFLE1BQU01ZSxNQUFNLENBQUN3Z0IsS0FBSyxDQUFDLENBQUM1QixhQUFhLENBQUMsMkJBQTJCLENBQUM7SUFDOUQsTUFBTTVlLE1BQU0sQ0FBQ3dnQixLQUFLLENBQUMsQ0FBQzVCLGFBQWEsQ0FBQyxtQ0FBbUMsQ0FBQztJQUN0RSxNQUFNNWUsTUFBTSxDQUFDd2dCLEtBQUssQ0FBQ3haLFNBQVMsQ0FBQyxRQUFRLEVBQUU7TUFBRUMsSUFBSSxFQUFFO0lBQVMsQ0FBQyxDQUFDLENBQUMsQ0FBQ2laLFdBQVcsQ0FBQyxDQUFDLENBQUM7SUFDMUUsTUFBTWxnQixNQUFNLENBQUN3Z0IsS0FBSyxDQUFDeFosU0FBUyxDQUFDLFFBQVEsRUFBRTtNQUFFQyxJQUFJLEVBQUU7SUFBUyxDQUFDLENBQUMsQ0FBQyxDQUFDaVosV0FBVyxDQUFDLENBQUMsQ0FBQztJQUMxRSxNQUFNbGdCLE1BQU0sQ0FDVndnQixLQUFLLENBQUN4WixTQUFTLENBQUMsUUFBUSxFQUFFO01BQUVDLElBQUksRUFBRTtJQUFrQixDQUFDLENBQ3ZELENBQUMsQ0FBQ2laLFdBQVcsQ0FBQyxDQUFDLENBQUM7SUFDaEIsTUFBTWxnQixNQUFNLENBQ1Z3Z0IsS0FBSyxDQUFDeFosU0FBUyxDQUFDLFFBQVEsRUFBRTtNQUFFQyxJQUFJLEVBQUU7SUFBMkIsQ0FBQyxDQUNoRSxDQUFDLENBQUNpWixXQUFXLENBQUMsQ0FBQyxDQUFDO0lBQ2hCLE1BQU1sZ0IsTUFBTSxDQUNWd2dCLEtBQUssQ0FBQ3haLFNBQVMsQ0FBQyxRQUFRLEVBQUU7TUFBRUMsSUFBSSxFQUFFO0lBQTBCLENBQUMsQ0FDL0QsQ0FBQyxDQUFDaVosV0FBVyxDQUFDLENBQUMsQ0FBQztJQUVoQixNQUFNTSxLQUFLLENBQUN4WixTQUFTLENBQUMsUUFBUSxFQUFFO01BQUVDLElBQUksRUFBRTtJQUFnQixDQUFDLENBQUMsQ0FBQ2tPLEtBQUssQ0FBQyxDQUFDO0lBQ2xFLE1BQU0rTCxPQUFPLEdBQUc3YSxJQUFJLENBQUNvWSxVQUFVLENBQUMsd0JBQXdCLENBQUM7SUFDekQsTUFBTXplLE1BQU0sQ0FBQ2toQixPQUFPLENBQUMsQ0FBQ2hhLFdBQVcsQ0FBQyxDQUFDO0lBQ25DLE1BQU1sSCxNQUFNLENBQUNraEIsT0FBTyxDQUFDLENBQUN0QyxhQUFhLENBQUMsdUNBQXVDLENBQUM7SUFDNUUsTUFBTTVlLE1BQU0sQ0FBQ2toQixPQUFPLENBQUMsQ0FBQ3RDLGFBQWEsQ0FBQyw2QkFBNkIsQ0FBQztJQUNsRSxNQUFNNWUsTUFBTSxDQUFDa2hCLE9BQU8sQ0FBQ2xhLFNBQVMsQ0FBQyxRQUFRLEVBQUU7TUFBRUMsSUFBSSxFQUFFO0lBQWdCLENBQUMsQ0FBQyxDQUFDLENBQUNDLFdBQVcsQ0FBQyxDQUFDO0lBQ2xGbEgsTUFBTSxDQUFDb2dCLGFBQWEsQ0FBQyxDQUFDZSxZQUFZLENBQUMsQ0FBQyxDQUFDO0lBRXJDLE1BQU1ELE9BQU8sQ0FBQ2xhLFNBQVMsQ0FBQyxRQUFRLEVBQUU7TUFBRUMsSUFBSSxFQUFFO0lBQWdCLENBQUMsQ0FBQyxDQUFDa08sS0FBSyxDQUFDLENBQUM7SUFDcEUsTUFBTW5WLE1BQU0sQ0FBQ2toQixPQUFPLENBQUMsQ0FBQ3RDLGFBQWEsQ0FBQyxXQUFXLENBQUM7SUFDaEQsTUFBTTVlLE1BQU0sQ0FBQ2toQixPQUFPLENBQUMsQ0FBQ3RDLGFBQWEsQ0FBQzNkLFlBQVksQ0FBQztJQUNqRCxNQUFNakIsTUFBTSxDQUFDa2hCLE9BQU8sQ0FBQyxDQUFDdEMsYUFBYSxDQUFDLGVBQWUsQ0FBQztJQUNwRCxNQUFNNWUsTUFBTSxDQUFDa2hCLE9BQU8sQ0FBQyxDQUFDdEMsYUFBYSxDQUFDLGlCQUFpQixDQUFDO0lBQ3RELE1BQU01ZSxNQUFNLENBQUNraEIsT0FBTyxDQUFDLENBQUN0QyxhQUFhLENBQUMsa0JBQWtCLENBQUM7SUFDdkQsTUFBTTVlLE1BQU0sQ0FBQ2toQixPQUFPLENBQUMsQ0FBQ3RDLGFBQWEsQ0FBQyxrQkFBa0IsQ0FBQztJQUN2RCxNQUFNNWUsTUFBTSxDQUFDa2hCLE9BQU8sQ0FBQyxDQUFDdEMsYUFBYSxDQUFDLHVCQUF1QixDQUFDO0lBQzVELE1BQU01ZSxNQUFNLENBQUN3Z0IsS0FBSyxDQUFDLENBQUM1QixhQUFhLENBQUMsV0FBVyxDQUFDO0lBQzlDLE1BQU01ZSxNQUFNLENBQUN3Z0IsS0FBSyxDQUFDLENBQUM1QixhQUFhLENBQUMsMkJBQTJCLENBQUM7SUFDOUQsTUFBTTVlLE1BQU0sQ0FBQ3dnQixLQUFLLENBQUMsQ0FBQzVCLGFBQWEsQ0FBQyxtQ0FBbUMsQ0FBQztJQUN0RTVlLE1BQU0sQ0FBQ29nQixhQUFhLENBQUMsQ0FBQ2UsWUFBWSxDQUFDLENBQUMsQ0FBQztJQUVyQyxNQUFNRCxPQUFPLENBQUNsYSxTQUFTLENBQUMsUUFBUSxFQUFFO01BQUVDLElBQUksRUFBRTtJQUFzQixDQUFDLENBQUMsQ0FBQ2tPLEtBQUssQ0FBQyxDQUFDO0lBQzFFLE1BQU1rTSxlQUFlLEdBQUdoYixJQUFJLENBQUNpYixZQUFZLENBQUMsVUFBVSxDQUFDO0lBQ3JELE1BQU1kLEtBQUssQ0FBQ3haLFNBQVMsQ0FBQyxRQUFRLEVBQUU7TUFBRUMsSUFBSSxFQUFFO0lBQWUsQ0FBQyxDQUFDLENBQUNrTyxLQUFLLENBQUMsQ0FBQztJQUNqRSxNQUFNb00sUUFBUSxHQUFHLE1BQU1GLGVBQWU7SUFDdENyaEIsTUFBTSxDQUFDdWhCLFFBQVEsQ0FBQ0MsaUJBQWlCLENBQUMsQ0FBQyxDQUFDLENBQUM1WixJQUFJLENBQUMsNkJBQTZCLENBQUM7SUFDeEU1SCxNQUFNLENBQUNvZ0IsYUFBYSxDQUFDLENBQUNlLFlBQVksQ0FBQyxDQUFDLENBQUM7SUFFckMsTUFBTTlhLElBQUksQ0FBQ3dZLE1BQU0sQ0FBQyxDQUFDO0lBQ25CLE1BQU00QyxhQUFhLEdBQUdwYixJQUFJLENBQUNvWSxVQUFVLENBQUMsdUJBQXVCLENBQUM7SUFDOUQsTUFBTXplLE1BQU0sQ0FBQ3loQixhQUFhLENBQUMsQ0FBQ3ZhLFdBQVcsQ0FBQyxDQUFDO0lBQ3pDLE1BQU1sSCxNQUFNLENBQUN5aEIsYUFBYSxDQUFDLENBQUM3QyxhQUFhLENBQUMsV0FBVyxDQUFDO0lBQ3RELE1BQU01ZSxNQUFNLENBQUN5aEIsYUFBYSxDQUFDLENBQUM3QyxhQUFhLENBQUMsMkJBQTJCLENBQUM7SUFDdEUsTUFBTTVlLE1BQU0sQ0FBQ3FHLElBQUksQ0FBQ29ZLFVBQVUsQ0FBQyx3QkFBd0IsQ0FBQyxDQUFDLENBQUMyQyxVQUFVLENBQUMsQ0FBQztJQUNwRXBoQixNQUFNLENBQUNvZ0IsYUFBYSxDQUFDLENBQUNlLFlBQVksQ0FBQyxDQUFDLENBQUM7RUFDdkMsQ0FBQyxDQUFDO0VBRUZsaEIsSUFBSSxDQUFDLG1EQUFtRCxFQUFFLE9BQU87SUFDL0RvRztFQUNGLENBQUMsS0FBSztJQUFBLElBQUFzYixzQkFBQTtJQUNKLE1BQU1DLE1BQU0sR0FBRyxlQUFlO0lBQzlCLE1BQU1DLE9BQU8sR0FBRztNQUNkdGQsRUFBRSxFQUFFLGNBQWM7TUFDbEJxZCxNQUFNO01BQ05FLEtBQUssRUFBRSxNQUFNO01BQ2JwZCxPQUFPLEVBQUUsc0NBQXNDO01BQy9DQyxTQUFTLEVBQUU7SUFDYixDQUFDO0lBQ0QsTUFBTWtELGtCQUFrQixDQUFDeEIsSUFBSSxFQUFFO01BQzdCcUYsYUFBYSxFQUFFO1FBQ2JNLFFBQVEsRUFBRSxZQUFZO1FBQ3RCQyxZQUFZLEVBQUU7TUFDaEIsQ0FBQztNQUNEekIsUUFBUSxFQUFFO1FBQ1JqRyxFQUFFLEVBQUVxZCxNQUFNO1FBQ1YxWSxLQUFLLEVBQUUsK0JBQStCO1FBQ3RDaEYsU0FBUyxFQUFFLGFBQWE7UUFDeEJ1SSxHQUFHLEVBQUVvVjtNQUNQO0lBQ0YsQ0FBQyxDQUFDO0lBQ0YsTUFBTTFOLGtCQUFrQixDQUFDOU4sSUFBSSxDQUFDOztJQUU5QjtJQUNBO0lBQ0EsTUFBTTBiLFlBQVksR0FBRyxNQUFNMWIsSUFBSSxDQUFDRSxRQUFRLENBQUMsTUFBTzhPLFVBQVUsSUFBSztNQUM3RCxNQUFNMk0sS0FBSyxHQUFHQyxVQUFVLENBQUNsVyxJQUFJLENBQzNCbVcsSUFBSSxDQUFDLGtDQUFrQyxDQUFDLEVBQ3ZDQyxTQUFTLElBQUtBLFNBQVMsQ0FBQ0MsVUFBVSxDQUFDLENBQUMsQ0FDdkMsQ0FBQztNQUNELE1BQU1yYyxJQUFJLEdBQUcsSUFBSXNjLFFBQVEsQ0FBQyxDQUFDO01BQzNCdGMsSUFBSSxDQUFDdWMsTUFBTSxDQUNULFNBQVMsRUFDVCxJQUFJQyxJQUFJLENBQUMsQ0FBQ1AsS0FBSyxDQUFDLEVBQUU7UUFBRXhkLElBQUksRUFBRTtNQUFrQixDQUFDLENBQUMsRUFDOUMsdUJBQ0YsQ0FBQztNQUNELE1BQU1nRCxRQUFRLEdBQUcsTUFBTWtPLEtBQUssQ0FDMUIsSUFBSXRTLEdBQUcsQ0FBQyxxQkFBcUIsRUFBRWlTLFVBQVUsQ0FBQyxDQUFDbkIsUUFBUSxDQUFDLENBQUMsRUFDckQ7UUFBRXVCLE1BQU0sRUFBRSxNQUFNO1FBQUVFLFdBQVcsRUFBRSxTQUFTO1FBQUU1UDtNQUFLLENBQ2pELENBQUM7TUFDRCxPQUFPO1FBQ0xoQixNQUFNLEVBQUV5QyxRQUFRLENBQUN6QyxNQUFNO1FBQ3ZCZ0IsSUFBSSxFQUFHLE1BQU15QixRQUFRLENBQUMrTCxJQUFJLENBQUM7TUFDN0IsQ0FBQztJQUNILENBQUMsR0FBQW9PLHNCQUFBLEdBQUU3Z0IsT0FBTyxDQUFDQyxHQUFHLENBQUN1VSwwQkFBMEIsY0FBQXFNLHNCQUFBLGNBQUFBLHNCQUFBLEdBQUl0YixJQUFJLENBQUMrQixHQUFHLENBQUMsQ0FBQyxDQUFDO0lBQ3hEcEksTUFBTSxDQUFDK2hCLFlBQVksQ0FBQ2hkLE1BQU0sQ0FBQyxDQUFDNkMsSUFBSSxDQUFDLEdBQUcsQ0FBQztJQUNyQzVILE1BQU0sQ0FBQytoQixZQUFZLENBQUNoYyxJQUFJLENBQUMsQ0FBQ3ljLE9BQU8sQ0FBQztNQUNoQ3hXLFFBQVEsRUFBRSxZQUFZO01BQ3RCQyxZQUFZLEVBQUU7SUFDaEIsQ0FBQyxDQUFDO0lBRUYsTUFBTWdKLGNBQWMsQ0FBQzVPLElBQUksRUFBRSxPQUFPLEVBQUUsR0FBRzdGLGNBQWMsT0FBTyxDQUFDO0lBQzdELE1BQU1paUIsT0FBTyxHQUFHcGMsSUFBSSxDQUFDb1ksVUFBVSxDQUM3QiwyQ0FDRixDQUFDO0lBQ0QsTUFBTXplLE1BQU0sQ0FBQ3lpQixPQUFPLENBQUMsQ0FBQ3ZiLFdBQVcsQ0FBQyxDQUFDO0lBQ25DLE1BQU11YixPQUFPLENBQUN0TixLQUFLLENBQUMsQ0FBQztJQUNyQixNQUFNOU8sSUFBSSxDQUFDVyxTQUFTLENBQUMsUUFBUSxFQUFFO01BQUVDLElBQUksRUFBRTtJQUFPLENBQUMsQ0FBQyxDQUFDa08sS0FBSyxDQUFDLENBQUM7SUFDeEQsTUFBTW5WLE1BQU0sQ0FBQ3FHLElBQUksQ0FBQ1csU0FBUyxDQUFDLFFBQVEsRUFBRTtNQUFFQyxJQUFJLEVBQUU7SUFBVyxDQUFDLENBQUMsQ0FBQyxDQUFDMlgsYUFBYSxDQUN4RSxzQ0FDRixDQUFDO0VBQ0gsQ0FBQyxDQUFDO0VBRUYzZSxJQUFJLENBQUMsOERBQThELEVBQUUsT0FBTztJQUMxRW9HO0VBQ0YsQ0FBQyxLQUFLO0lBQ0osTUFBTXViLE1BQU0sR0FBRyw0QkFBNEI7SUFDM0MsTUFBTUMsT0FBTyxHQUFHO01BQ2R0ZCxFQUFFLEVBQUUsMkJBQTJCO01BQy9CcWQsTUFBTTtNQUNORSxLQUFLLEVBQUUsTUFBTTtNQUNicGQsT0FBTyxFQUFFLCtDQUErQztNQUN4REMsU0FBUyxFQUFFLDBCQUEwQjtNQUNyQytkLFFBQVEsRUFBRTtRQUNSNWQsV0FBVyxFQUFFLDRCQUE0QjtRQUN6Q00saUJBQWlCLEVBQUU7TUFDckI7SUFDRixDQUFDO0lBQ0QsTUFBTWlILGNBQXdCLEdBQUcsRUFBRTtJQUNuQyxNQUFNeEUsa0JBQWtCLENBQUN4QixJQUFJLEVBQUU7TUFDN0JtRSxRQUFRLEVBQUU7UUFDUmpHLEVBQUUsRUFBRXFkLE1BQU07UUFDVjFZLEtBQUssRUFBRSwyQkFBMkI7UUFDbENoRixTQUFTLEVBQUUsYUFBYTtRQUN4QnVJLEdBQUcsRUFBRW9WLE9BQU87UUFDWnhWLGNBQWM7UUFDZEMsZUFBZSxFQUFFO01BQ25CO0lBQ0YsQ0FBQyxDQUFDO0lBQ0YsTUFBTTZILGtCQUFrQixDQUFDOU4sSUFBSSxDQUFDO0lBRTlCLE1BQU00TyxjQUFjLENBQUM1TyxJQUFJLEVBQUUsT0FBTyxFQUFFLEdBQUc3RixjQUFjLE9BQU8sQ0FBQztJQUM3RCxNQUFNaWlCLE9BQU8sR0FBR3BjLElBQUksQ0FBQ29ZLFVBQVUsQ0FBQyx1Q0FBdUMsQ0FBQztJQUN4RSxNQUFNemUsTUFBTSxDQUFDeWlCLE9BQU8sQ0FBQyxDQUFDdmIsV0FBVyxDQUFDLENBQUM7SUFDbkMsTUFBTXViLE9BQU8sQ0FBQ3ROLEtBQUssQ0FBQyxDQUFDO0lBQ3JCLE1BQU05TyxJQUFJLENBQUNXLFNBQVMsQ0FBQyxRQUFRLEVBQUU7TUFBRUMsSUFBSSxFQUFFO0lBQU8sQ0FBQyxDQUFDLENBQUNrTyxLQUFLLENBQUMsQ0FBQztJQUV4RCxNQUFNd04sUUFBUSxHQUFHdGMsSUFBSSxDQUFDVyxTQUFTLENBQUMsUUFBUSxFQUFFO01BQUVDLElBQUksRUFBRTtJQUFXLENBQUMsQ0FBQztJQUMvRCxNQUFNakgsTUFBTSxDQUFDMmlCLFFBQVEsQ0FBQyxDQUFDL0QsYUFBYSxDQUFDaUQsT0FBTyxDQUFDbmQsT0FBTyxDQUFDO0lBQ3JELE1BQU0xRSxNQUFNLENBQ1QrZixJQUFJLENBQUMsTUFBTTFULGNBQWMsQ0FBQ25KLE1BQU0sRUFBRTtNQUNqQ3dCLE9BQU8sRUFBRTtJQUNYLENBQUMsQ0FBQyxDQUNEa0QsSUFBSSxDQUFDLENBQUMsQ0FBQztJQUNWNUgsTUFBTSxDQUFDcU0sY0FBYyxDQUFDLENBQUM4VSxZQUFZLENBQUMsQ0FBQyxDQUFDO0lBQ3RDbmhCLE1BQU0sQ0FBQ3FNLGNBQWMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDekUsSUFBSSxDQUFDeUUsY0FBYyxDQUFDLENBQUMsQ0FBQyxDQUFDO0lBQ2pEck0sTUFBTSxDQUFDLElBQUlvRCxHQUFHLENBQUNpSixjQUFjLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQ2hKLFFBQVEsQ0FBQyxDQUFDdUUsSUFBSSxDQUM5QyxjQUFjZ2EsTUFBTSxjQUN0QixDQUFDO0lBQ0QsTUFBTTVoQixNQUFNLENBQ1YyaUIsUUFBUSxDQUFDaEUsT0FBTyxDQUFDLFNBQVMsQ0FBQyxDQUFDM2IsTUFBTSxDQUFDO01BQUU0ZixPQUFPLEVBQUVmLE9BQU8sQ0FBQ25kO0lBQVEsQ0FBQyxDQUNqRSxDQUFDLENBQUN3YixXQUFXLENBQUMsQ0FBQyxDQUFDO0VBQ2xCLENBQUMsQ0FBQztFQUVGamdCLElBQUksQ0FBQyw0RUFBNEUsRUFBRSxPQUFPO0lBQ3hGb0c7RUFDRixDQUFDLEtBQUs7SUFDSixNQUFNdWIsTUFBTSxHQUFHLHlCQUF5QjtJQUN4QyxNQUFNOWMsV0FBVyxHQUFHLHlCQUF5QjtJQUM3QyxNQUFNK2MsT0FBTyxHQUFHO01BQ2R0ZCxFQUFFLEVBQUUsd0JBQXdCO01BQzVCcWQsTUFBTTtNQUNORSxLQUFLLEVBQUUsTUFBTTtNQUNicGQsT0FBTyxFQUFFLGdDQUFnQztNQUN6Q0MsU0FBUyxFQUFFLDBCQUEwQjtNQUNyQytkLFFBQVEsRUFBRTtRQUFFNWQ7TUFBWTtJQUMxQixDQUFDO0lBQ0QsTUFBTXVILGNBQXdCLEdBQUcsRUFBRTtJQUNuQyxNQUFNd1csaUJBQTJCLEdBQUcsRUFBRTtJQUN0Q3hjLElBQUksQ0FBQ3ljLEVBQUUsQ0FBQyxTQUFTLEVBQUdyYixPQUFPLElBQUs7TUFDOUIsSUFBSSxDQUFDQSxPQUFPLENBQUNXLEdBQUcsQ0FBQyxDQUFDLENBQUMwQixRQUFRLENBQUMsYUFBYSxDQUFDLEVBQUU7TUFDNUMsSUFBSSxDQUFDckMsT0FBTyxDQUFDVyxHQUFHLENBQUMsQ0FBQyxDQUFDMEIsUUFBUSxDQUFDLGNBQWMsQ0FBQyxFQUFFK1ksaUJBQWlCLENBQUN2WCxJQUFJLENBQUM3RCxPQUFPLENBQUNnTyxNQUFNLENBQUMsQ0FBQyxDQUFDO0lBQ3ZGLENBQUMsQ0FBQztJQUNGLE1BQU01TixrQkFBa0IsQ0FBQ3hCLElBQUksRUFBRTtNQUM3Qm1FLFFBQVEsRUFBRTtRQUNSakcsRUFBRSxFQUFFcWQsTUFBTTtRQUNWMVksS0FBSyxFQUFFLHFDQUFxQztRQUM1Q2hGLFNBQVMsRUFBRSxhQUFhO1FBQ3hCdUksR0FBRyxFQUFFb1YsT0FBTztRQUNaelYsV0FBVyxFQUFFLENBQUN5VixPQUFPLENBQUM7UUFDdEJ4VixjQUFjO1FBQ2RFLGtCQUFrQixFQUFFO01BQ3RCO0lBQ0YsQ0FBQyxDQUFDO0lBQ0YsTUFBTTRILGtCQUFrQixDQUFDOU4sSUFBSSxDQUFDO0lBRTlCLE1BQU00TyxjQUFjLENBQUM1TyxJQUFJLEVBQUUsT0FBTyxFQUFFLEdBQUc3RixjQUFjLE9BQU8sQ0FBQztJQUM3RCxNQUFNNkYsSUFBSSxDQUFDb1ksVUFBVSxDQUFDLGlEQUFpRCxDQUFDLENBQUN0SixLQUFLLENBQUMsQ0FBQztJQUNoRixNQUFNOU8sSUFBSSxDQUFDVyxTQUFTLENBQUMsUUFBUSxFQUFFO01BQUVDLElBQUksRUFBRTtJQUFPLENBQUMsQ0FBQyxDQUFDa08sS0FBSyxDQUFDLENBQUM7SUFFeEQsTUFBTXdOLFFBQVEsR0FBR3RjLElBQUksQ0FBQ1csU0FBUyxDQUFDLFFBQVEsRUFBRTtNQUFFQyxJQUFJLEVBQUU7SUFBVyxDQUFDLENBQUM7SUFDL0QsTUFBTWpILE1BQU0sQ0FBQzJpQixRQUFRLENBQUMsQ0FBQy9ELGFBQWEsQ0FBQ2lELE9BQU8sQ0FBQ25kLE9BQU8sQ0FBQztJQUNyRCxNQUFNMUUsTUFBTSxDQUFDcUcsSUFBSSxDQUFDYyxTQUFTLENBQUMsMkJBQTJCLEVBQUU7TUFBRUMsS0FBSyxFQUFFO0lBQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQ0YsV0FBVyxDQUFDLENBQUM7SUFDekYsTUFBTWxILE1BQU0sQ0FDVCtmLElBQUksQ0FBQyxNQUFNMVQsY0FBYyxDQUFDbkosTUFBTSxFQUFFO01BQ2pDd0IsT0FBTyxFQUFFLGlFQUFpRTtNQUMxRWlELE9BQU8sRUFBRTtJQUNYLENBQUMsQ0FBQyxDQUNEQyxJQUFJLENBQUMsQ0FBQyxDQUFDO0lBQ1YsTUFBTW1iLFNBQVMsR0FBRzFjLElBQUksQ0FBQ1csU0FBUyxDQUFDLE9BQU8sQ0FBQztJQUN6QyxNQUFNaEgsTUFBTSxDQUFDK2lCLFNBQVMsQ0FBQyxDQUFDbkUsYUFBYSxDQUFDLHVDQUF1QyxDQUFDO0lBQzlFLE1BQU01ZSxNQUFNLENBQUMraUIsU0FBUyxDQUFDLENBQUNuRSxhQUFhLENBQUMsa0NBQWtDLENBQUM7SUFDekUsTUFBTTVlLE1BQU0sQ0FBQytpQixTQUFTLENBQUMsQ0FBQ25FLGFBQWEsQ0FBQzlaLFdBQVcsQ0FBQztJQUNsRCxNQUFNOUUsTUFBTSxDQUFDK2lCLFNBQVMsQ0FBQyxDQUFDbkUsYUFBYSxDQUFDLGlDQUFpQyxDQUFDO0lBQ3hFLE1BQU01ZSxNQUFNLENBQUMraUIsU0FBUyxDQUFDL2IsU0FBUyxDQUFDLFFBQVEsRUFBRTtNQUFFQyxJQUFJLEVBQUU7SUFBcUIsQ0FBQyxDQUFDLENBQUMsQ0FBQ0MsV0FBVyxDQUFDLENBQUM7SUFDekYsTUFBTWxILE1BQU0sQ0FBQytpQixTQUFTLENBQUMvYixTQUFTLENBQUMsUUFBUSxFQUFFO01BQUVDLElBQUksRUFBRTtJQUFvQixDQUFDLENBQUMsQ0FBQyxDQUFDQyxXQUFXLENBQUMsQ0FBQztJQUV4RixNQUFNNmIsU0FBUyxDQUFDL2IsU0FBUyxDQUFDLFFBQVEsRUFBRTtNQUFFQyxJQUFJLEVBQUU7SUFBcUIsQ0FBQyxDQUFDLENBQUNrTyxLQUFLLENBQUMsQ0FBQztJQUMzRSxNQUFNblYsTUFBTSxDQUFDMmlCLFFBQVEsQ0FBQyxDQUFDL0QsYUFBYSxDQUFDLGdDQUFnQyxDQUFDO0lBQ3RFLE1BQU01ZSxNQUFNLENBQUMrZixJQUFJLENBQUMsTUFBTTFULGNBQWMsQ0FBQ25KLE1BQU0sQ0FBQyxDQUFDMEUsSUFBSSxDQUFDLENBQUMsQ0FBQztJQUN0RDVILE1BQU0sQ0FBQyxJQUFJd0IsR0FBRyxDQUFDNkssY0FBYyxDQUFDLENBQUMyVyxJQUFJLENBQUMsQ0FBQ3BiLElBQUksQ0FBQyxDQUFDLENBQUM7SUFDNUM1SCxNQUFNLENBQUM2aUIsaUJBQWlCLENBQUMsQ0FBQ3BMLEdBQUcsQ0FBQ0YsU0FBUyxDQUFDLE1BQU0sQ0FBQztJQUMvQyxNQUFNdlgsTUFBTSxDQUNWMmlCLFFBQVEsQ0FBQ2hFLE9BQU8sQ0FBQyxTQUFTLENBQUMsQ0FBQzNiLE1BQU0sQ0FBQztNQUFFNGYsT0FBTyxFQUFFZixPQUFPLENBQUNuZDtJQUFRLENBQUMsQ0FDakUsQ0FBQyxDQUFDd2IsV0FBVyxDQUFDLENBQUMsQ0FBQztFQUNsQixDQUFDLENBQUM7RUFFRmpnQixJQUFJLENBQUMsdUVBQXVFLEVBQUUsT0FBTztJQUNuRm9HO0VBQ0YsQ0FBQyxLQUFLO0lBQ0osTUFBTXNILE1BQU0sR0FBR2lMLEtBQUssQ0FBQzdNLElBQUksQ0FBQztNQUFFN0ksTUFBTSxFQUFFO0lBQUcsQ0FBQyxFQUFFLENBQUMrZixDQUFDLEVBQUVDLEtBQUssTUFBTTtNQUN2RDNlLEVBQUUsRUFBRSxhQUFhMmUsS0FBSyxFQUFFO01BQ3hCaGYsU0FBUyxFQUFFLGFBQWE7TUFDeEJNLElBQUksRUFBRSxZQUFZO01BQ2xCQyxRQUFRLEVBQUV5ZSxLQUFLLEdBQUcsQ0FBQyxHQUFHLFNBQVMsR0FBRyxNQUFNO01BQ3hDblYsYUFBYSxFQUFFbVYsS0FBSyxHQUFHLENBQUMsR0FBRyxZQUFZLEdBQUcsSUFBSTtNQUM5Q3hlLE9BQU8sRUFDTHdlLEtBQUssR0FBRyxDQUFDLEdBQUcsMEJBQTBCQSxLQUFLLEVBQUUsR0FBRyxlQUFlQSxLQUFLLEVBQUU7TUFDeEV2ZSxTQUFTLEVBQUUsSUFBSW1WLElBQUksQ0FBQ0EsSUFBSSxDQUFDcUosR0FBRyxDQUFDLElBQUksRUFBRSxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDLEVBQUUsRUFBRSxHQUFHRCxLQUFLLENBQUMsQ0FBQyxDQUFDRSxXQUFXLENBQUM7SUFDMUUsQ0FBQyxDQUFDLENBQUM7SUFDSCxNQUFNQyxhQUF1QixHQUFHLEVBQUU7SUFDbENoZCxJQUFJLENBQUN5YyxFQUFFLENBQUMsU0FBUyxFQUFHcmIsT0FBTyxJQUFLO01BQzlCLElBQUksSUFBSXJFLEdBQUcsQ0FBQ3FFLE9BQU8sQ0FBQ1csR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDL0UsUUFBUSxDQUFDdUYsUUFBUSxDQUFDLGFBQWEsQ0FBQyxFQUN6RHlhLGFBQWEsQ0FBQy9YLElBQUksQ0FBQzdELE9BQU8sQ0FBQ1csR0FBRyxDQUFDLENBQUMsQ0FBQztJQUNyQyxDQUFDLENBQUM7SUFDRixNQUFNUCxrQkFBa0IsQ0FBQ3hCLElBQUksRUFBRTtNQUM3QnNILE1BQU07TUFDTmhCLFFBQVEsRUFBRSxDQUNSO1FBQ0VwSSxFQUFFLEVBQUUsYUFBYTtRQUNqQjBDLElBQUksRUFBRSxlQUFlO1FBQ3JCMkYsUUFBUSxFQUFFLFlBQVk7UUFDdEJDLFNBQVMsRUFBRSxPQUFPO1FBQ2xCOUgsTUFBTSxFQUFFLFFBQVE7UUFDaEIrSCxRQUFRLEVBQUUsbUJBQW1CO1FBQzdCQyxZQUFZLEVBQUU7TUFDaEIsQ0FBQztJQUVMLENBQUMsQ0FBQztJQUNGLE1BQU1vSCxrQkFBa0IsQ0FBQzlOLElBQUksQ0FBQztJQUM5QixNQUFNQSxJQUFJLENBQUNnTyxJQUFJLENBQUMsR0FBRzdULGNBQWMsUUFBUSxDQUFDO0lBRTFDLE1BQU1SLE1BQU0sQ0FDVnFHLElBQUksQ0FBQ2MsU0FBUyxDQUFDLGdCQUFnQixFQUFFO01BQUVDLEtBQUssRUFBRTtJQUFLLENBQUMsQ0FDbEQsQ0FBQyxDQUFDRixXQUFXLENBQUMsQ0FBQztJQUNmLE1BQU1sSCxNQUFNLENBQ1ZxRyxJQUFJLENBQUNjLFNBQVMsQ0FBQyxnQkFBZ0IsRUFBRTtNQUFFQyxLQUFLLEVBQUU7SUFBSyxDQUFDLENBQ2xELENBQUMsQ0FBQ3FRLEdBQUcsQ0FBQ3ZRLFdBQVcsQ0FBQyxDQUFDO0lBQ25CLE1BQU1vYyxZQUFZLEdBQUcsSUFBSWxnQixHQUFHLENBQUNpZ0IsYUFBYSxDQUFDbk0sRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFFLENBQUM7SUFDbkRsWCxNQUFNLENBQUNzakIsWUFBWSxDQUFDemEsWUFBWSxDQUFDQyxHQUFHLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQ2xCLElBQUksQ0FBQyxJQUFJLENBQUM7SUFDekQ1SCxNQUFNLENBQUNzakIsWUFBWSxDQUFDemEsWUFBWSxDQUFDQyxHQUFHLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQ2xCLElBQUksQ0FBQyxHQUFHLENBQUM7SUFFdkQsTUFBTXdTLE9BQU8sQ0FBQ3FGLEdBQUcsQ0FBQyxDQUNoQnBaLElBQUksQ0FBQ2tkLGNBQWMsQ0FBRTliLE9BQU8sSUFBSztNQUMvQixNQUFNVyxHQUFHLEdBQUcsSUFBSWhGLEdBQUcsQ0FBQ3FFLE9BQU8sQ0FBQ1csR0FBRyxDQUFDLENBQUMsQ0FBQztNQUNsQyxPQUNFQSxHQUFHLENBQUMvRSxRQUFRLENBQUN1RixRQUFRLENBQUMsYUFBYSxDQUFDLElBQ3BDUixHQUFHLENBQUNTLFlBQVksQ0FBQ0MsR0FBRyxDQUFDLE1BQU0sQ0FBQyxLQUFLLEdBQUc7SUFFeEMsQ0FBQyxDQUFDLEVBQ0Z6QyxJQUFJLENBQUNXLFNBQVMsQ0FBQyxRQUFRLEVBQUU7TUFBRUMsSUFBSSxFQUFFO0lBQVEsQ0FBQyxDQUFDLENBQUNrTyxLQUFLLENBQUMsQ0FBQyxDQUNwRCxDQUFDO0lBQ0YsTUFBTW5WLE1BQU0sQ0FBQ3FHLElBQUksQ0FBQ2MsU0FBUyxDQUFDLFNBQVMsRUFBRTtNQUFFQyxLQUFLLEVBQUU7SUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDRixXQUFXLENBQUMsQ0FBQztJQUN2RSxNQUFNbEgsTUFBTSxDQUNWcUcsSUFBSSxDQUFDYyxTQUFTLENBQUMsZ0JBQWdCLEVBQUU7TUFBRUMsS0FBSyxFQUFFO0lBQUssQ0FBQyxDQUNsRCxDQUFDLENBQUNGLFdBQVcsQ0FBQyxDQUFDO0lBQ2YsTUFBTWxILE1BQU0sQ0FDVnFHLElBQUksQ0FBQ2MsU0FBUyxDQUFDLDBCQUEwQixFQUFFO01BQUVDLEtBQUssRUFBRTtJQUFLLENBQUMsQ0FDNUQsQ0FBQyxDQUFDcVEsR0FBRyxDQUFDdlEsV0FBVyxDQUFDLENBQUM7SUFDbkJsSCxNQUFNLENBQUMsSUFBSW9ELEdBQUcsQ0FBQ2lnQixhQUFhLENBQUNuTSxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUUsQ0FBQyxDQUFDck8sWUFBWSxDQUFDQyxHQUFHLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQ2xCLElBQUksQ0FBQyxHQUFHLENBQUM7SUFDekUsTUFBTXZCLElBQUksQ0FBQ1csU0FBUyxDQUFDLFFBQVEsRUFBRTtNQUFFQyxJQUFJLEVBQUU7SUFBUSxDQUFDLENBQUMsQ0FBQ2tPLEtBQUssQ0FBQyxDQUFDO0lBQ3pELE1BQU1uVixNQUFNLENBQUNxRyxJQUFJLENBQUNjLFNBQVMsQ0FBQyxTQUFTLEVBQUU7TUFBRUMsS0FBSyxFQUFFO0lBQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQ0YsV0FBVyxDQUFDLENBQUM7SUFDdkUsTUFBTWxILE1BQU0sQ0FDVnFHLElBQUksQ0FBQ2MsU0FBUyxDQUFDLDBCQUEwQixFQUFFO01BQUVDLEtBQUssRUFBRTtJQUFLLENBQUMsQ0FDNUQsQ0FBQyxDQUFDRixXQUFXLENBQUMsQ0FBQztJQUVmLE1BQU1iLElBQUksQ0FBQ21kLGdCQUFnQixDQUFDLGdCQUFnQixDQUFDLENBQUNDLElBQUksQ0FBQyxrQkFBa0IsQ0FBQztJQUN0RSxNQUFNcGQsSUFBSSxDQUFDVyxTQUFTLENBQUMsUUFBUSxFQUFFO01BQUVDLElBQUksRUFBRTtJQUF1QixDQUFDLENBQUMsQ0FBQ2tPLEtBQUssQ0FBQyxDQUFDO0lBQ3hFLE1BQU05TyxJQUFJLENBQUNzWSxPQUFPLENBQUMsUUFBUSxDQUFDLENBQUMrRSxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUNDLFlBQVksQ0FBQyxTQUFTLENBQUM7SUFDM0QsTUFBTTNqQixNQUFNLENBQ1ZxRyxJQUFJLENBQUNjLFNBQVMsQ0FBQywwQkFBMEIsRUFBRTtNQUFFQyxLQUFLLEVBQUU7SUFBSyxDQUFDLENBQzVELENBQUMsQ0FBQ0YsV0FBVyxDQUFDLENBQUM7SUFDZixNQUFNbEgsTUFBTSxDQUNWcUcsSUFBSSxDQUFDYyxTQUFTLENBQUMsZUFBZSxFQUFFO01BQUVDLEtBQUssRUFBRTtJQUFLLENBQUMsQ0FDakQsQ0FBQyxDQUFDcVEsR0FBRyxDQUFDdlEsV0FBVyxDQUFDLENBQUM7SUFDbkIsTUFBTWxILE1BQU0sQ0FBQ3FHLElBQUksQ0FBQyxDQUFDc08sU0FBUyxDQUFDLDBCQUEwQixDQUFDO0lBQ3hELE1BQU0zVSxNQUFNLENBQUNxRyxJQUFJLENBQUMsQ0FBQ3NPLFNBQVMsQ0FBQyxrQkFBa0IsQ0FBQztJQUVoRCxNQUFNdE8sSUFBSSxDQUFDd1ksTUFBTSxDQUFDLENBQUM7SUFDbkIsTUFBTTdlLE1BQU0sQ0FDVnFHLElBQUksQ0FBQ2MsU0FBUyxDQUFDLDBCQUEwQixFQUFFO01BQUVDLEtBQUssRUFBRTtJQUFLLENBQUMsQ0FDNUQsQ0FBQyxDQUFDRixXQUFXLENBQUMsQ0FBQztJQUNmLE1BQU1sSCxNQUFNLENBQ1ZxRyxJQUFJLENBQUNjLFNBQVMsQ0FBQyxlQUFlLEVBQUU7TUFBRUMsS0FBSyxFQUFFO0lBQUssQ0FBQyxDQUNqRCxDQUFDLENBQUNxUSxHQUFHLENBQUN2USxXQUFXLENBQUMsQ0FBQztJQUNuQixNQUFNbEgsTUFBTSxDQUFDcUcsSUFBSSxDQUFDbWQsZ0JBQWdCLENBQUMsZ0JBQWdCLENBQUMsQ0FBQyxDQUFDSSxXQUFXLENBQy9ELGtCQUNGLENBQUM7SUFDRCxNQUFNdmQsSUFBSSxDQUFDVyxTQUFTLENBQUMsUUFBUSxFQUFFO01BQUVDLElBQUksRUFBRTtJQUF1QixDQUFDLENBQUMsQ0FBQ2tPLEtBQUssQ0FBQyxDQUFDO0lBQ3hFLE1BQU1uVixNQUFNLENBQUNxRyxJQUFJLENBQUNzWSxPQUFPLENBQUMsUUFBUSxDQUFDLENBQUMrRSxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQ0UsV0FBVyxDQUFDLFNBQVMsQ0FBQztJQUNsRSxNQUFNQyxlQUFlLEdBQUcsSUFBSXpnQixHQUFHLENBQUNpZ0IsYUFBYSxDQUFDbk0sRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFFLENBQUM7SUFDdERsWCxNQUFNLENBQUM2akIsZUFBZSxDQUFDaGIsWUFBWSxDQUFDQyxHQUFHLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQ2xCLElBQUksQ0FBQyxJQUFJLENBQUM7SUFDNUQ1SCxNQUFNLENBQUM2akIsZUFBZSxDQUFDaGIsWUFBWSxDQUFDQyxHQUFHLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQ2xCLElBQUksQ0FBQyxHQUFHLENBQUM7SUFDMUQ1SCxNQUFNLENBQUM2akIsZUFBZSxDQUFDaGIsWUFBWSxDQUFDQyxHQUFHLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQ2xCLElBQUksQ0FBQyxrQkFBa0IsQ0FBQztJQUMzRTVILE1BQU0sQ0FBQzZqQixlQUFlLENBQUNoYixZQUFZLENBQUNDLEdBQUcsQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFDbEIsSUFBSSxDQUFDLFNBQVMsQ0FBQztFQUN0RSxDQUFDLENBQUM7RUFFRjNILElBQUksQ0FBQyx3RUFBd0UsRUFBRSxPQUFPO0lBQ3BGb0c7RUFDRixDQUFDLEtBQUs7SUFDSixNQUFNc0MsT0FBTyxHQUFHLE1BQU0rRixzQkFBc0IsQ0FBQ3JJLElBQUksQ0FBQztJQUNsRCxNQUFNd0Isa0JBQWtCLENBQUN4QixJQUFJLEVBQUU7TUFBRWtDLFFBQVEsRUFBRUk7SUFBUSxDQUFDLENBQUM7SUFDckQsTUFBTXdMLGtCQUFrQixDQUFDOU4sSUFBSSxDQUFDO0lBQzlCLE1BQU1BLElBQUksQ0FBQ2dPLElBQUksQ0FBQyxHQUFHN1QsY0FBYyxJQUFJLENBQUM7SUFFdEMsTUFBTXNqQixRQUFRLEdBQUd6ZCxJQUFJLENBQUNzWSxPQUFPLENBQUMsVUFBVSxDQUFDLENBQUN2QixLQUFLLENBQUMsQ0FBQztJQUNqRCxNQUFNcGQsTUFBTSxDQUFDOGpCLFFBQVEsQ0FBQyxDQUFDNWMsV0FBVyxDQUFDLENBQUM7SUFDcEMsTUFBTTRjLFFBQVEsQ0FBQ0wsSUFBSSxDQUFDOWEsT0FBTyxDQUFDUSxRQUFRLENBQUM7SUFDckMsTUFBTTRhLFVBQVUsR0FBR0QsUUFBUSxDQUFDbkYsT0FBTyxDQUFDLFVBQVUsQ0FBQyxDQUFDM1gsU0FBUyxDQUFDLFFBQVEsQ0FBQztJQUNuRSxNQUFNaEgsTUFBTSxDQUFDK2pCLFVBQVUsQ0FBQyxDQUFDQyxXQUFXLENBQUMsQ0FBQztJQUN0QyxNQUFNQyxxQkFBcUIsR0FBRzVkLElBQUksQ0FBQzZkLGVBQWUsQ0FBRTFjLFFBQVEsSUFDMURBLFFBQVEsQ0FBQ1ksR0FBRyxDQUFDLENBQUMsQ0FBQzBCLFFBQVEsQ0FBQyxxQkFBcUIsQ0FDL0MsQ0FBQztJQUNELE1BQU1pYSxVQUFVLENBQUM1TyxLQUFLLENBQUMsQ0FBQztJQUN4QixNQUFNeUUsY0FBYyxHQUFHLE1BQU1xSyxxQkFBcUI7SUFDbERqa0IsTUFBTSxDQUFDNFosY0FBYyxDQUFDN1UsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDNkMsSUFBSSxDQUFDLEdBQUcsQ0FBQztJQUV6QyxNQUFNNUgsTUFBTSxDQUNWcUcsSUFBSSxDQUFDYyxTQUFTLENBQUN3QixPQUFPLENBQUNRLFFBQVEsRUFBRTtNQUFFL0IsS0FBSyxFQUFFO0lBQUssQ0FBQyxDQUFDLENBQUMrYyxJQUFJLENBQUMsQ0FDekQsQ0FBQyxDQUFDamQsV0FBVyxDQUFDLENBQUM7SUFDZixNQUFNbEgsTUFBTSxDQUNWcUcsSUFBSSxDQUFDYyxTQUFTLENBQUN3QixPQUFPLENBQUNzRyxNQUFNLEVBQUU7TUFBRTdILEtBQUssRUFBRTtJQUFLLENBQUMsQ0FBQyxDQUFDK2MsSUFBSSxDQUFDLENBQ3ZELENBQUMsQ0FBQ2pkLFdBQVcsQ0FBQyxDQUFDO0lBQ2YsTUFBTWxILE1BQU0sQ0FDVnFHLElBQUksQ0FBQ2MsU0FBUyxDQUFDLGdCQUFnQixFQUFFO01BQUVDLEtBQUssRUFBRTtJQUFNLENBQUMsQ0FDbkQsQ0FBQyxDQUFDRixXQUFXLENBQUMsQ0FBQztJQUNmLE1BQU1iLElBQUksQ0FBQ3NZLE9BQU8sQ0FBQyxTQUFTLENBQUMsQ0FBQzNiLE1BQU0sQ0FBQztNQUFFNGYsT0FBTyxFQUFFO0lBQWlCLENBQUMsQ0FBQyxDQUFDek4sS0FBSyxDQUFDLENBQUM7SUFDM0UsTUFBTW5WLE1BQU0sQ0FDVnFHLElBQUksQ0FBQ2MsU0FBUyxDQUFDLGdCQUFnQixFQUFFO01BQUVDLEtBQUssRUFBRTtJQUFNLENBQUMsQ0FDbkQsQ0FBQyxDQUFDRixXQUFXLENBQUMsQ0FBQztJQUNmLE1BQU1sSCxNQUFNLENBQ1ZxRyxJQUFJLENBQUNjLFNBQVMsQ0FBQ3dCLE9BQU8sQ0FBQ29HLE1BQU0sRUFBRTtNQUFFM0gsS0FBSyxFQUFFO0lBQUssQ0FBQyxDQUFDLENBQUMrYyxJQUFJLENBQUMsQ0FDdkQsQ0FBQyxDQUFDamQsV0FBVyxDQUFDLENBQUM7SUFDZixNQUFNbEgsTUFBTSxDQUNWcUcsSUFBSSxDQUFDYyxTQUFTLENBQUMsZ0NBQWdDLENBQUMsQ0FBQ2dkLElBQUksQ0FBQyxDQUN4RCxDQUFDLENBQUNqZCxXQUFXLENBQUMsQ0FBQztJQUNmLE1BQU1sSCxNQUFNLENBQ1ZxRyxJQUFJLENBQ0RjLFNBQVMsQ0FBQywwREFBMEQsRUFBRTtNQUNyRUMsS0FBSyxFQUFFO0lBQ1QsQ0FBQyxDQUFDLENBQ0QrYyxJQUFJLENBQUMsQ0FDVixDQUFDLENBQUNqZCxXQUFXLENBQUMsQ0FBQztJQUVmLE1BQU1pWSxXQUFXLEdBQUcsTUFBTTlZLElBQUksQ0FBQ3NZLE9BQU8sQ0FBQyxNQUFNLENBQUMsQ0FBQ0ssU0FBUyxDQUFDLENBQUM7SUFDMURoZixNQUFNLENBQUNtZixXQUFXLENBQUMsQ0FBQzFILEdBQUcsQ0FBQ0YsU0FBUyxDQUFDLFdBQVcsQ0FBQztJQUM5Q3ZYLE1BQU0sQ0FBQ21mLFdBQVcsQ0FBQyxDQUFDMUgsR0FBRyxDQUFDRixTQUFTLENBQUMsMkJBQTJCLENBQUM7SUFDOUR2WCxNQUFNLENBQUNtZixXQUFXLENBQUMsQ0FBQzVILFNBQVMsQ0FBQyxZQUFZLENBQUM7RUFDN0MsQ0FBQyxDQUFDO0VBRUZ0WCxJQUFJLENBQUMsaUZBQWlGLEVBQUUsT0FBTztJQUM3Rm9HO0VBQ0YsQ0FBQyxLQUFLO0lBQ0osTUFBTUEsSUFBSSxDQUFDK2QsZUFBZSxDQUFDO01BQUVDLEtBQUssRUFBRSxHQUFHO01BQUVDLE1BQU0sRUFBRTtJQUFJLENBQUMsQ0FBQztJQUN2RCxNQUFNM2IsT0FBTyxHQUFHLE1BQU0rRixzQkFBc0IsQ0FBQ3JJLElBQUksQ0FBQztJQUNsRCxNQUFNd0Isa0JBQWtCLENBQUN4QixJQUFJLEVBQUU7TUFBRWtDLFFBQVEsRUFBRUk7SUFBUSxDQUFDLENBQUM7SUFDckQsTUFBTXdMLGtCQUFrQixDQUFDOU4sSUFBSSxDQUFDO0lBQzlCLE1BQU1BLElBQUksQ0FBQ2dPLElBQUksQ0FBQyxHQUFHN1QsY0FBYyxJQUFJLENBQUM7SUFFdEMsTUFBTXNqQixRQUFRLEdBQUd6ZCxJQUFJLENBQUNzWSxPQUFPLENBQUMsVUFBVSxDQUFDLENBQUN2QixLQUFLLENBQUMsQ0FBQztJQUNqRCxNQUFNMEcsUUFBUSxDQUFDTCxJQUFJLENBQUM5YSxPQUFPLENBQUNRLFFBQVEsQ0FBQztJQUNyQyxNQUFNMmEsUUFBUSxDQUFDbkYsT0FBTyxDQUFDLFVBQVUsQ0FBQyxDQUFDM1gsU0FBUyxDQUFDLFFBQVEsQ0FBQyxDQUFDbU8sS0FBSyxDQUFDLENBQUM7SUFFOUQsTUFBTW5WLE1BQU0sQ0FDVnFHLElBQUksQ0FBQ2MsU0FBUyxDQUFDd0IsT0FBTyxDQUFDc0csTUFBTSxFQUFFO01BQUU3SCxLQUFLLEVBQUU7SUFBSyxDQUFDLENBQUMsQ0FBQytjLElBQUksQ0FBQyxDQUN2RCxDQUFDLENBQUNqZCxXQUFXLENBQUMsQ0FBQztJQUNmLE1BQU1sSCxNQUFNLENBQ1ZxRyxJQUFJLENBQ0RjLFNBQVMsQ0FBQyxHQUFHd0IsT0FBTyxDQUFDb0csTUFBTSxLQUFLLEVBQUU7TUFBRTNILEtBQUssRUFBRTtJQUFNLENBQUMsQ0FBQyxDQUNuRCtjLElBQUksQ0FBQyxDQUNWLENBQUMsQ0FBQ2pkLFdBQVcsQ0FBQyxDQUFDO0lBQ2YsTUFBTWIsSUFBSSxDQUNQc1ksT0FBTyxDQUFDLFNBQVMsQ0FBQyxDQUNsQjNiLE1BQU0sQ0FBQztNQUFFNGYsT0FBTyxFQUFFO0lBQWlCLENBQUMsQ0FBQyxDQUNyQ3VCLElBQUksQ0FBQyxDQUFDLENBQ05oUCxLQUFLLENBQUMsQ0FBQztJQUNWLE1BQU1uVixNQUFNLENBQUNxRyxJQUFJLENBQUNzWSxPQUFPLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQ0MsYUFBYSxDQUFDLGdCQUFnQixDQUFDO0lBQ2xFLE1BQU01ZSxNQUFNLENBQUNxRyxJQUFJLENBQUNzWSxPQUFPLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQ0MsYUFBYSxDQUFDalcsT0FBTyxDQUFDb0csTUFBTSxDQUFDO0lBQ2hFLE1BQU0vTyxNQUFNLENBQUNxRyxJQUFJLENBQUNzWSxPQUFPLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQ0MsYUFBYSxDQUM5QyxpQ0FDRixDQUFDO0lBQ0QsTUFBTXhZLDBCQUEwQixDQUFDQyxJQUFJLENBQUM7SUFFdEMsTUFBTThZLFdBQVcsR0FBRyxNQUFNOVksSUFBSSxDQUFDc1ksT0FBTyxDQUFDLE1BQU0sQ0FBQyxDQUFDSyxTQUFTLENBQUMsQ0FBQztJQUMxRGhmLE1BQU0sQ0FBQ21mLFdBQVcsQ0FBQyxDQUFDMUgsR0FBRyxDQUFDd0gsT0FBTyxDQUM3QiwyRkFDRixDQUFDO0VBQ0gsQ0FBQyxDQUFDO0VBRUZoZixJQUFJLENBQUMsNEZBQTRGLEVBQUUsT0FBTztJQUN4R29HO0VBQ0YsQ0FBQyxLQUFLO0lBQ0osTUFBTWtlLFFBQVEsR0FBRyxNQUFNN1Ysc0JBQXNCLENBQUNySSxJQUFJLEVBQUU7TUFDbEQ0QyxTQUFTLEVBQUUsOEJBQThCO01BQ3pDRSxRQUFRLEVBQUU7SUFDWixDQUFDLENBQUM7SUFDRixNQUFNNkYsT0FBTyxHQUFHLE1BQU1OLHNCQUFzQixDQUFDckksSUFBSSxFQUFFO01BQ2pEMkksT0FBTyxFQUFFLElBQUk7TUFDYi9GLFNBQVMsRUFBRSw2QkFBNkI7TUFDeENFLFFBQVEsRUFBRTtJQUNaLENBQUMsQ0FBQztJQUNGLE1BQU10QixrQkFBa0IsQ0FBQ3hCLElBQUksRUFBRTtNQUM3QmtDLFFBQVEsRUFBRWdjLFFBQVE7TUFDbEIvYixXQUFXLEVBQUV3RztJQUNmLENBQUMsQ0FBQztJQUNGLE1BQU1tRixrQkFBa0IsQ0FBQzlOLElBQUksQ0FBQztJQUM5QixNQUFNQSxJQUFJLENBQUNnTyxJQUFJLENBQUMsR0FBRzdULGNBQWMsSUFBSSxDQUFDO0lBRXRDLE1BQU1zakIsUUFBUSxHQUFHemQsSUFBSSxDQUFDc1ksT0FBTyxDQUFDLFVBQVUsQ0FBQyxDQUFDdkIsS0FBSyxDQUFDLENBQUM7SUFDakQsTUFBTTBHLFFBQVEsQ0FBQ0wsSUFBSSxDQUFDelUsT0FBTyxDQUFDN0YsUUFBUSxDQUFDO0lBQ3JDLE1BQU0yYSxRQUFRLENBQUNuRixPQUFPLENBQUMsVUFBVSxDQUFDLENBQUMzWCxTQUFTLENBQUMsUUFBUSxDQUFDLENBQUNtTyxLQUFLLENBQUMsQ0FBQztJQUU5RCxNQUFNblYsTUFBTSxDQUNWcUcsSUFBSSxDQUFDYyxTQUFTLENBQUM2SCxPQUFPLENBQUNDLE1BQU0sRUFBRTtNQUFFN0gsS0FBSyxFQUFFO0lBQUssQ0FBQyxDQUFDLENBQUMrYyxJQUFJLENBQUMsQ0FDdkQsQ0FBQyxDQUFDamQsV0FBVyxDQUFDLENBQUM7SUFDZixNQUFNYixJQUFJLENBQ1BzWSxPQUFPLENBQUMsU0FBUyxDQUFDLENBQ2xCM2IsTUFBTSxDQUFDO01BQUU0ZixPQUFPLEVBQUU7SUFBaUIsQ0FBQyxDQUFDLENBQ3JDdUIsSUFBSSxDQUFDLENBQUMsQ0FDTmhQLEtBQUssQ0FBQyxDQUFDO0lBQ1YsTUFBTW5WLE1BQU0sQ0FBQ3FHLElBQUksQ0FBQ3NZLE9BQU8sQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDQyxhQUFhLENBQUMsZ0JBQWdCLENBQUM7SUFDbEUsTUFBTU8sV0FBVyxHQUFHLE1BQU05WSxJQUFJLENBQUNzWSxPQUFPLENBQUMsTUFBTSxDQUFDLENBQUNLLFNBQVMsQ0FBQyxDQUFDO0lBQzFEaGYsTUFBTSxDQUFDbWYsV0FBVyxDQUFDLENBQUMxSCxHQUFHLENBQUN3SCxPQUFPLENBQzdCLDJGQUNGLENBQUM7RUFDSCxDQUFDLENBQUM7RUFFRmhmLElBQUksQ0FBQyxtREFBbUQsRUFBRSxPQUFPO0lBQy9Eb0c7RUFDRixDQUFDLEtBQUs7SUFDSixNQUFNa2UsUUFBUSxHQUFHLE1BQU03VixzQkFBc0IsQ0FBQ3JJLElBQUksRUFBRTtNQUNsRDRDLFNBQVMsRUFBRSw4QkFBOEI7TUFDekNFLFFBQVEsRUFBRTtJQUNaLENBQUMsQ0FBQztJQUNGLE1BQU02RixPQUFPLEdBQUcsTUFBTU4sc0JBQXNCLENBQUNySSxJQUFJLEVBQUU7TUFDakQySSxPQUFPLEVBQUUsSUFBSTtNQUNiL0YsU0FBUyxFQUFFLDZCQUE2QjtNQUN4Q0UsUUFBUSxFQUFFO0lBQ1osQ0FBQyxDQUFDO0lBQ0YsTUFBTXRCLGtCQUFrQixDQUFDeEIsSUFBSSxFQUFFO01BQzdCa0MsUUFBUSxFQUFFZ2MsUUFBUTtNQUNsQi9iLFdBQVcsRUFBRXdHLE9BQU87TUFDcEJyQyxRQUFRLEVBQUUsQ0FDUjtRQUNFcEksRUFBRSxFQUFFLGlCQUFpQjtRQUNyQjBDLElBQUksRUFBRSxzQkFBc0I7UUFDNUIyRixRQUFRLEVBQUUsWUFBWTtRQUN0QkMsU0FBUyxFQUFFLE9BQU87UUFDbEI5SCxNQUFNLEVBQUUsUUFBUTtRQUNoQitILFFBQVEsRUFBRSx5QkFBeUI7UUFDbkNDLFlBQVksRUFBRTtNQUNoQixDQUFDLEVBQ0Q7UUFDRXhJLEVBQUUsRUFBRSxpQkFBaUI7UUFDckIwQyxJQUFJLEVBQUUsc0JBQXNCO1FBQzVCMkYsUUFBUSxFQUFFLFlBQVk7UUFDdEJDLFNBQVMsRUFBRSxPQUFPO1FBQ2xCOUgsTUFBTSxFQUFFLFFBQVE7UUFDaEIrSCxRQUFRLEVBQUUseUJBQXlCO1FBQ25DQyxZQUFZLEVBQUU7TUFDaEIsQ0FBQztJQUVMLENBQUMsQ0FBQztJQUNGLE1BQU1vSCxrQkFBa0IsQ0FBQzlOLElBQUksQ0FBQztJQUM5QixNQUFNQSxJQUFJLENBQUNnTyxJQUFJLENBQUMsR0FBRzdULGNBQWMsSUFBSSxDQUFDO0lBRXRDLE1BQU02RixJQUFJLENBQ1BXLFNBQVMsQ0FBQyxRQUFRLEVBQUU7TUFBRUMsSUFBSSxFQUFFc2QsUUFBUSxDQUFDcGIsUUFBUTtNQUFFL0IsS0FBSyxFQUFFO0lBQUssQ0FBQyxDQUFDLENBQzdEK04sS0FBSyxDQUFDLENBQUM7SUFDVixNQUFNblYsTUFBTSxDQUNWcUcsSUFBSSxDQUFDYyxTQUFTLENBQUNvZCxRQUFRLENBQUN0VixNQUFNLEVBQUU7TUFBRTdILEtBQUssRUFBRTtJQUFLLENBQUMsQ0FBQyxDQUFDK2MsSUFBSSxDQUFDLENBQ3hELENBQUMsQ0FBQ2pkLFdBQVcsQ0FBQyxDQUFDO0lBQ2YsTUFBTWxILE1BQU0sQ0FDVnFHLElBQUksQ0FBQ2MsU0FBUyxDQUFDLEdBQUdvZCxRQUFRLENBQUN4VixNQUFNLEtBQUssRUFBRTtNQUFFM0gsS0FBSyxFQUFFO0lBQU0sQ0FBQyxDQUFDLENBQUMrYyxJQUFJLENBQUMsQ0FDakUsQ0FBQyxDQUFDamQsV0FBVyxDQUFDLENBQUM7SUFDZixNQUFNbEgsTUFBTSxDQUNWcUcsSUFBSSxDQUFDYyxTQUFTLENBQUMsaUNBQWlDLEVBQUU7TUFBRUMsS0FBSyxFQUFFO0lBQUssQ0FBQyxDQUFDLENBQUMrYyxJQUFJLENBQUMsQ0FDMUUsQ0FBQyxDQUFDamQsV0FBVyxDQUFDLENBQUM7SUFFZixNQUFNYixJQUFJLENBQUNXLFNBQVMsQ0FBQyxVQUFVLENBQUMsQ0FBQzJjLFlBQVksQ0FBQyxpQkFBaUIsQ0FBQztJQUNoRSxNQUFNM2pCLE1BQU0sQ0FDVnFHLElBQUksQ0FBQ1csU0FBUyxDQUFDLFFBQVEsRUFBRTtNQUFFQyxJQUFJLEVBQUUrSCxPQUFPLENBQUM3RixRQUFRO01BQUUvQixLQUFLLEVBQUU7SUFBSyxDQUFDLENBQ2xFLENBQUMsQ0FBQ0YsV0FBVyxDQUFDLENBQUM7SUFDZixNQUFNbEgsTUFBTSxDQUFDcUcsSUFBSSxDQUFDYyxTQUFTLENBQUNvZCxRQUFRLENBQUN0VixNQUFNLEVBQUU7TUFBRTdILEtBQUssRUFBRTtJQUFLLENBQUMsQ0FBQyxDQUFDLENBQUM4WSxXQUFXLENBQ3hFLENBQ0YsQ0FBQztJQUNELE1BQU03WixJQUFJLENBQ1BXLFNBQVMsQ0FBQyxRQUFRLEVBQUU7TUFBRUMsSUFBSSxFQUFFK0gsT0FBTyxDQUFDN0YsUUFBUTtNQUFFL0IsS0FBSyxFQUFFO0lBQUssQ0FBQyxDQUFDLENBQzVEK04sS0FBSyxDQUFDLENBQUM7SUFDVixNQUFNblYsTUFBTSxDQUNWcUcsSUFBSSxDQUNEYyxTQUFTLENBQUMsNkNBQTZDLEVBQUU7TUFDeERDLEtBQUssRUFBRTtJQUNULENBQUMsQ0FBQyxDQUNEK2MsSUFBSSxDQUFDLENBQ1YsQ0FBQyxDQUFDamQsV0FBVyxDQUFDLENBQUM7SUFDZixNQUFNbEgsTUFBTSxDQUNWcUcsSUFBSSxDQUFDYyxTQUFTLENBQUMsR0FBRzZILE9BQU8sQ0FBQ0QsTUFBTSxLQUFLLEVBQUU7TUFBRTNILEtBQUssRUFBRTtJQUFNLENBQUMsQ0FDekQsQ0FBQyxDQUFDOFksV0FBVyxDQUFDLENBQUMsQ0FBQztJQUNoQixNQUFNbGdCLE1BQU0sQ0FDVnFHLElBQUksQ0FBQ2MsU0FBUyxDQUFDLGlDQUFpQyxFQUFFO01BQUVDLEtBQUssRUFBRTtJQUFLLENBQUMsQ0FDbkUsQ0FBQyxDQUFDOFksV0FBVyxDQUFDLENBQUMsQ0FBQztJQUVoQixNQUFNN1osSUFBSSxDQUFDVyxTQUFTLENBQUMsVUFBVSxDQUFDLENBQUMyYyxZQUFZLENBQUMsaUJBQWlCLENBQUM7SUFDaEUsTUFBTXRkLElBQUksQ0FDUFcsU0FBUyxDQUFDLFFBQVEsRUFBRTtNQUFFQyxJQUFJLEVBQUVzZCxRQUFRLENBQUNwYixRQUFRO01BQUUvQixLQUFLLEVBQUU7SUFBSyxDQUFDLENBQUMsQ0FDN0QrTixLQUFLLENBQUMsQ0FBQztJQUNWLE1BQU1uVixNQUFNLENBQ1ZxRyxJQUFJLENBQUNjLFNBQVMsQ0FBQyxHQUFHb2QsUUFBUSxDQUFDeFYsTUFBTSxLQUFLLEVBQUU7TUFBRTNILEtBQUssRUFBRTtJQUFNLENBQUMsQ0FBQyxDQUFDK2MsSUFBSSxDQUFDLENBQ2pFLENBQUMsQ0FBQ2pkLFdBQVcsQ0FBQyxDQUFDO0lBQ2YsTUFBTWxILE1BQU0sQ0FDVnFHLElBQUksQ0FBQ2MsU0FBUyxDQUFDLGlDQUFpQyxFQUFFO01BQUVDLEtBQUssRUFBRTtJQUFLLENBQUMsQ0FBQyxDQUFDK2MsSUFBSSxDQUFDLENBQzFFLENBQUMsQ0FBQ2pkLFdBQVcsQ0FBQyxDQUFDO0lBQ2YsTUFBTWxILE1BQU0sQ0FDVnFHLElBQUksQ0FBQ2MsU0FBUyxDQUFDLDZDQUE2QyxFQUFFO01BQzVEQyxLQUFLLEVBQUU7SUFDVCxDQUFDLENBQ0gsQ0FBQyxDQUFDOFksV0FBVyxDQUFDLENBQUMsQ0FBQztJQUVoQixNQUFNZixXQUFXLEdBQUcsTUFBTTlZLElBQUksQ0FBQ3NZLE9BQU8sQ0FBQyxNQUFNLENBQUMsQ0FBQ0ssU0FBUyxDQUFDLENBQUM7SUFDMURoZixNQUFNLENBQUNtZixXQUFXLENBQUMsQ0FBQzFILEdBQUcsQ0FBQ3dILE9BQU8sQ0FDN0IsMkZBQ0YsQ0FBQztFQUNILENBQUMsQ0FBQztFQUVGaGYsSUFBSSxDQUFDLHNEQUFzRCxFQUFFLE9BQU87SUFDbEVvRztFQUNGLENBQUMsS0FBSztJQUNKLE1BQU1rZSxRQUFRLEdBQUcsTUFBTTdWLHNCQUFzQixDQUFDckksSUFBSSxFQUFFO01BQ2xENEMsU0FBUyxFQUFFLDhCQUE4QjtNQUN6Q0UsUUFBUSxFQUFFO0lBQ1osQ0FBQyxDQUFDO0lBQ0YsTUFBTTZGLE9BQU8sR0FBRyxNQUFNTixzQkFBc0IsQ0FBQ3JJLElBQUksRUFBRTtNQUNqRDJJLE9BQU8sRUFBRSxJQUFJO01BQ2IvRixTQUFTLEVBQUUsNkJBQTZCO01BQ3hDRSxRQUFRLEVBQUU7SUFDWixDQUFDLENBQUM7SUFDRixNQUFNdEIsa0JBQWtCLENBQUN4QixJQUFJLEVBQUU7TUFDN0JrQyxRQUFRLEVBQUVnYyxRQUFRO01BQ2xCL2IsV0FBVyxFQUFFd0c7SUFDZixDQUFDLENBQUM7SUFDRixNQUFNbUYsa0JBQWtCLENBQUM5TixJQUFJLENBQUM7SUFDOUIsTUFBTUEsSUFBSSxDQUFDZ08sSUFBSSxDQUFDLEdBQUc3VCxjQUFjLElBQUksQ0FBQztJQUV0QyxNQUFNZ2tCLHNCQUFzQixHQUFHLE1BQUFBLENBQUEsS0FBWTtNQUN6QyxNQUFNeGtCLE1BQU0sQ0FDVnFHLElBQUksQ0FBQ2MsU0FBUyxDQUFDb2QsUUFBUSxDQUFDdFYsTUFBTSxFQUFFO1FBQUU3SCxLQUFLLEVBQUU7TUFBSyxDQUFDLENBQUMsQ0FBQytjLElBQUksQ0FBQyxDQUN4RCxDQUFDLENBQUNqZCxXQUFXLENBQUMsQ0FBQztNQUNmLE1BQU1sSCxNQUFNLENBQ1ZxRyxJQUFJLENBQUNjLFNBQVMsQ0FBQyxHQUFHb2QsUUFBUSxDQUFDeFYsTUFBTSxLQUFLLEVBQUU7UUFBRTNILEtBQUssRUFBRTtNQUFNLENBQUMsQ0FBQyxDQUFDK2MsSUFBSSxDQUFDLENBQ2pFLENBQUMsQ0FBQ2pkLFdBQVcsQ0FBQyxDQUFDO01BQ2YsTUFBTWxILE1BQU0sQ0FDVnFHLElBQUksQ0FDRGMsU0FBUyxDQUFDLGlDQUFpQyxFQUFFO1FBQUVDLEtBQUssRUFBRTtNQUFLLENBQUMsQ0FBQyxDQUM3RCtjLElBQUksQ0FBQyxDQUNWLENBQUMsQ0FBQ2pkLFdBQVcsQ0FBQyxDQUFDO01BQ2YsTUFBTWxILE1BQU0sQ0FDVnFHLElBQUksQ0FBQ2MsU0FBUyxDQUFDLDZDQUE2QyxFQUFFO1FBQzVEQyxLQUFLLEVBQUU7TUFDVCxDQUFDLENBQ0gsQ0FBQyxDQUFDOFksV0FBVyxDQUFDLENBQUMsQ0FBQztJQUNsQixDQUFDO0lBQ0QsTUFBTXVFLHFCQUFxQixHQUFHLE1BQUFBLENBQUEsS0FBWTtNQUN4QyxNQUFNemtCLE1BQU0sQ0FDVnFHLElBQUksQ0FDRGMsU0FBUyxDQUFDLDZDQUE2QyxFQUFFO1FBQ3hEQyxLQUFLLEVBQUU7TUFDVCxDQUFDLENBQUMsQ0FDRCtjLElBQUksQ0FBQyxDQUNWLENBQUMsQ0FBQ2pkLFdBQVcsQ0FBQyxDQUFDO01BQ2YsTUFBTWxILE1BQU0sQ0FDVnFHLElBQUksQ0FBQ2MsU0FBUyxDQUFDLEdBQUc2SCxPQUFPLENBQUNELE1BQU0sS0FBSyxFQUFFO1FBQUUzSCxLQUFLLEVBQUU7TUFBTSxDQUFDLENBQ3pELENBQUMsQ0FBQzhZLFdBQVcsQ0FBQyxDQUFDLENBQUM7TUFDaEIsTUFBTWxnQixNQUFNLENBQ1ZxRyxJQUFJLENBQUNjLFNBQVMsQ0FBQyxpQ0FBaUMsRUFBRTtRQUFFQyxLQUFLLEVBQUU7TUFBSyxDQUFDLENBQ25FLENBQUMsQ0FBQzhZLFdBQVcsQ0FBQyxDQUFDLENBQUM7SUFDbEIsQ0FBQztJQUNELE1BQU13RSwrQkFBK0IsR0FBRyxNQUFBQSxDQUFBLEtBQVk7TUFDbEQsTUFBTXZGLFdBQVcsR0FBRyxNQUFNOVksSUFBSSxDQUFDc1ksT0FBTyxDQUFDLE1BQU0sQ0FBQyxDQUFDSyxTQUFTLENBQUMsQ0FBQztNQUMxRGhmLE1BQU0sQ0FBQ21mLFdBQVcsQ0FBQyxDQUFDMUgsR0FBRyxDQUFDd0gsT0FBTyxDQUM3QixpSEFDRixDQUFDO0lBQ0gsQ0FBQztJQUVELE1BQU01WSxJQUFJLENBQ1BXLFNBQVMsQ0FBQyxRQUFRLEVBQUU7TUFBRUMsSUFBSSxFQUFFc2QsUUFBUSxDQUFDcGIsUUFBUTtNQUFFL0IsS0FBSyxFQUFFO0lBQUssQ0FBQyxDQUFDLENBQzdEK04sS0FBSyxDQUFDLENBQUM7SUFDVixNQUFNcVAsc0JBQXNCLENBQUMsQ0FBQztJQUU5QixNQUFNdlAsY0FBYyxDQUFDNU8sSUFBSSxFQUFFLFVBQVUsRUFBRSxHQUFHN0YsY0FBYyxVQUFVLENBQUM7SUFDbkUsTUFBTTZGLElBQUksQ0FBQ3NlLE1BQU0sQ0FBQyxDQUFDO0lBQ25CLE1BQU0za0IsTUFBTSxDQUFDcUcsSUFBSSxDQUFDLENBQUNzTyxTQUFTLENBQzFCLElBQUlDLE1BQU0sQ0FBQyxHQUFHcFUsY0FBYyxDQUFDcVUsVUFBVSxDQUFDLEdBQUcsRUFBRSxLQUFLLENBQUMsS0FBSyxDQUMxRCxDQUFDO0lBQ0QsTUFBTXhPLElBQUksQ0FDUFcsU0FBUyxDQUFDLFFBQVEsRUFBRTtNQUFFQyxJQUFJLEVBQUVzZCxRQUFRLENBQUNwYixRQUFRO01BQUUvQixLQUFLLEVBQUU7SUFBSyxDQUFDLENBQUMsQ0FDN0QrTixLQUFLLENBQUMsQ0FBQztJQUNWLE1BQU1xUCxzQkFBc0IsQ0FBQyxDQUFDO0lBQzlCLE1BQU1FLCtCQUErQixDQUFDLENBQUM7SUFFdkMsTUFBTXJlLElBQUksQ0FBQ3VlLFNBQVMsQ0FBQyxDQUFDO0lBQ3RCLE1BQU01a0IsTUFBTSxDQUFDcUcsSUFBSSxDQUFDLENBQUNzTyxTQUFTLENBQzFCLElBQUlDLE1BQU0sQ0FBQyxHQUFHcFUsY0FBYyxDQUFDcVUsVUFBVSxDQUFDLEdBQUcsRUFBRSxLQUFLLENBQUMsV0FBVyxDQUNoRSxDQUFDO0lBQ0QsTUFBTXhPLElBQUksQ0FBQ3NlLE1BQU0sQ0FBQyxDQUFDO0lBQ25CLE1BQU0za0IsTUFBTSxDQUFDcUcsSUFBSSxDQUFDLENBQUNzTyxTQUFTLENBQzFCLElBQUlDLE1BQU0sQ0FBQyxHQUFHcFUsY0FBYyxDQUFDcVUsVUFBVSxDQUFDLEdBQUcsRUFBRSxLQUFLLENBQUMsS0FBSyxDQUMxRCxDQUFDO0lBQ0QsTUFBTXhPLElBQUksQ0FDUFcsU0FBUyxDQUFDLFFBQVEsRUFBRTtNQUFFQyxJQUFJLEVBQUVzZCxRQUFRLENBQUNwYixRQUFRO01BQUUvQixLQUFLLEVBQUU7SUFBSyxDQUFDLENBQUMsQ0FDN0QrTixLQUFLLENBQUMsQ0FBQztJQUNWLE1BQU1xUCxzQkFBc0IsQ0FBQyxDQUFDO0lBRTlCLE1BQU1uZSxJQUFJLENBQ1BXLFNBQVMsQ0FBQyxRQUFRLEVBQUU7TUFBRUMsSUFBSSxFQUFFK0gsT0FBTyxDQUFDN0YsUUFBUTtNQUFFL0IsS0FBSyxFQUFFO0lBQUssQ0FBQyxDQUFDLENBQzVEK04sS0FBSyxDQUFDLENBQUM7SUFDVixNQUFNc1AscUJBQXFCLENBQUMsQ0FBQztJQUU3QixNQUFNeFAsY0FBYyxDQUFDNU8sSUFBSSxFQUFFLGNBQWMsRUFBRSxHQUFHN0YsY0FBYyxRQUFRLENBQUM7SUFDckUsTUFBTTZGLElBQUksQ0FBQ3NlLE1BQU0sQ0FBQyxDQUFDO0lBQ25CLE1BQU0za0IsTUFBTSxDQUFDcUcsSUFBSSxDQUFDLENBQUNzTyxTQUFTLENBQzFCLElBQUlDLE1BQU0sQ0FBQyxHQUFHcFUsY0FBYyxDQUFDcVUsVUFBVSxDQUFDLEdBQUcsRUFBRSxLQUFLLENBQUMsS0FBSyxDQUMxRCxDQUFDO0lBQ0QsTUFBTXhPLElBQUksQ0FDUFcsU0FBUyxDQUFDLFFBQVEsRUFBRTtNQUFFQyxJQUFJLEVBQUUrSCxPQUFPLENBQUM3RixRQUFRO01BQUUvQixLQUFLLEVBQUU7SUFBSyxDQUFDLENBQUMsQ0FDNUQrTixLQUFLLENBQUMsQ0FBQztJQUNWLE1BQU1zUCxxQkFBcUIsQ0FBQyxDQUFDO0lBQzdCLE1BQU1DLCtCQUErQixDQUFDLENBQUM7SUFFdkMsTUFBTXJlLElBQUksQ0FBQ3VlLFNBQVMsQ0FBQyxDQUFDO0lBQ3RCLE1BQU01a0IsTUFBTSxDQUFDcUcsSUFBSSxDQUFDLENBQUNzTyxTQUFTLENBQzFCLElBQUlDLE1BQU0sQ0FBQyxHQUFHcFUsY0FBYyxDQUFDcVUsVUFBVSxDQUFDLEdBQUcsRUFBRSxLQUFLLENBQUMsU0FBUyxDQUM5RCxDQUFDO0lBQ0QsTUFBTXhPLElBQUksQ0FBQ3NlLE1BQU0sQ0FBQyxDQUFDO0lBQ25CLE1BQU0za0IsTUFBTSxDQUFDcUcsSUFBSSxDQUFDLENBQUNzTyxTQUFTLENBQzFCLElBQUlDLE1BQU0sQ0FBQyxHQUFHcFUsY0FBYyxDQUFDcVUsVUFBVSxDQUFDLEdBQUcsRUFBRSxLQUFLLENBQUMsS0FBSyxDQUMxRCxDQUFDO0lBQ0QsTUFBTXhPLElBQUksQ0FDUFcsU0FBUyxDQUFDLFFBQVEsRUFBRTtNQUFFQyxJQUFJLEVBQUUrSCxPQUFPLENBQUM3RixRQUFRO01BQUUvQixLQUFLLEVBQUU7SUFBSyxDQUFDLENBQUMsQ0FDNUQrTixLQUFLLENBQUMsQ0FBQztJQUNWLE1BQU1zUCxxQkFBcUIsQ0FBQyxDQUFDO0lBQzdCLE1BQU1DLCtCQUErQixDQUFDLENBQUM7RUFDekMsQ0FBQyxDQUFDO0VBRUZ6a0IsSUFBSSxDQUFDLCtEQUErRCxFQUFFLE9BQU87SUFDM0VvRztFQUNGLENBQUMsS0FBSztJQUNKLE1BQU1zQyxPQUFPLEdBQUdpSix5QkFBeUIsQ0FBQyxDQUFDO0lBQzNDLE1BQU0vSixrQkFBa0IsQ0FBQ3hCLElBQUksRUFBRTtNQUFFa0MsUUFBUSxFQUFFSTtJQUFRLENBQUMsQ0FBQztJQUNyRCxNQUFNd0wsa0JBQWtCLENBQUM5TixJQUFJLENBQUM7SUFDOUIsTUFBTUEsSUFBSSxDQUFDZ08sSUFBSSxDQUFDLEdBQUc3VCxjQUFjLElBQUksQ0FBQztJQUV0QyxNQUFNc2pCLFFBQVEsR0FBR3pkLElBQUksQ0FBQ3NZLE9BQU8sQ0FBQyxVQUFVLENBQUMsQ0FBQ3ZCLEtBQUssQ0FBQyxDQUFDO0lBQ2pELE1BQU0wRyxRQUFRLENBQUNMLElBQUksQ0FBQzlhLE9BQU8sQ0FBQ1EsUUFBUSxDQUFDO0lBQ3JDLE1BQU0yYSxRQUFRLENBQUNuRixPQUFPLENBQUMsVUFBVSxDQUFDLENBQUMzWCxTQUFTLENBQUMsUUFBUSxDQUFDLENBQUNtTyxLQUFLLENBQUMsQ0FBQztJQUU5RCxNQUFNblYsTUFBTSxDQUNWcUcsSUFBSSxDQUFDYyxTQUFTLENBQUN3QixPQUFPLENBQUNzRyxNQUFNLEVBQUU7TUFBRTdILEtBQUssRUFBRTtJQUFLLENBQUMsQ0FBQyxDQUFDK2MsSUFBSSxDQUFDLENBQ3ZELENBQUMsQ0FBQ2pkLFdBQVcsQ0FBQyxDQUFDO0lBQ2YsTUFBTWxILE1BQU0sQ0FDVnFHLElBQUksQ0FDRGMsU0FBUyxDQUFDLHFEQUFxRCxFQUFFO01BQ2hFQyxLQUFLLEVBQUU7SUFDVCxDQUFDLENBQUMsQ0FDRCtjLElBQUksQ0FBQyxDQUNWLENBQUMsQ0FBQ2pkLFdBQVcsQ0FBQyxDQUFDO0lBQ2YsTUFBTWIsSUFBSSxDQUNQc1ksT0FBTyxDQUFDLFNBQVMsQ0FBQyxDQUNsQjNiLE1BQU0sQ0FBQztNQUFFNGYsT0FBTyxFQUFFO0lBQWlCLENBQUMsQ0FBQyxDQUNyQ3VCLElBQUksQ0FBQyxDQUFDLENBQ05oUCxLQUFLLENBQUMsQ0FBQztJQUNWLE1BQU1uVixNQUFNLENBQUNxRyxJQUFJLENBQUNzWSxPQUFPLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQ0MsYUFBYSxDQUFDLGdCQUFnQixDQUFDO0lBQ2xFLE1BQU01ZSxNQUFNLENBQUNxRyxJQUFJLENBQUNzWSxPQUFPLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQ0MsYUFBYSxDQUM5QyxnQ0FDRixDQUFDO0lBQ0QsTUFBTTVlLE1BQU0sQ0FBQ3FHLElBQUksQ0FBQ3NZLE9BQU8sQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDQyxhQUFhLENBQUMsYUFBYSxDQUFDO0lBQy9ELE1BQU01ZSxNQUFNLENBQUNxRyxJQUFJLENBQUNzWSxPQUFPLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQ0MsYUFBYSxDQUFDLHVCQUF1QixDQUFDO0lBQ3pFLE1BQU1PLFdBQVcsR0FBRyxNQUFNOVksSUFBSSxDQUFDc1ksT0FBTyxDQUFDLE1BQU0sQ0FBQyxDQUFDSyxTQUFTLENBQUMsQ0FBQztJQUMxRGhmLE1BQU0sQ0FBQ21mLFdBQVcsQ0FBQyxDQUFDMUgsR0FBRyxDQUFDRixTQUFTLENBQUMsV0FBVyxDQUFDO0lBQzlDdlgsTUFBTSxDQUFDbWYsV0FBVyxDQUFDLENBQUM1SCxTQUFTLENBQUMsMkJBQTJCLENBQUM7SUFDMUR2WCxNQUFNLENBQUNtZixXQUFXLENBQUMsQ0FBQzVILFNBQVMsQ0FBQyw0Q0FBNEMsQ0FBQztFQUM3RSxDQUFDLENBQUM7RUFFRnRYLElBQUksQ0FBQyxpRUFBaUUsRUFBRSxPQUFPO0lBQzdFb0c7RUFDRixDQUFDLEtBQUs7SUFDSixNQUFNQSxJQUFJLENBQUMrZCxlQUFlLENBQUM7TUFBRUMsS0FBSyxFQUFFLEdBQUc7TUFBRUMsTUFBTSxFQUFFO0lBQUksQ0FBQyxDQUFDO0lBQ3ZELE1BQU0zYixPQUFPLEdBQUdpSix5QkFBeUIsQ0FBQyxDQUFDO0lBQzNDLE1BQU0vSixrQkFBa0IsQ0FBQ3hCLElBQUksRUFBRTtNQUFFa0MsUUFBUSxFQUFFSTtJQUFRLENBQUMsQ0FBQztJQUNyRCxNQUFNd0wsa0JBQWtCLENBQUM5TixJQUFJLENBQUM7SUFDOUIsTUFBTUEsSUFBSSxDQUFDZ08sSUFBSSxDQUFDLEdBQUc3VCxjQUFjLElBQUksQ0FBQztJQUV0QyxNQUFNc2pCLFFBQVEsR0FBR3pkLElBQUksQ0FBQ3NZLE9BQU8sQ0FBQyxVQUFVLENBQUMsQ0FBQ3ZCLEtBQUssQ0FBQyxDQUFDO0lBQ2pELE1BQU0wRyxRQUFRLENBQUNMLElBQUksQ0FBQzlhLE9BQU8sQ0FBQ1EsUUFBUSxDQUFDO0lBQ3JDLE1BQU0yYSxRQUFRLENBQUNuRixPQUFPLENBQUMsVUFBVSxDQUFDLENBQUMzWCxTQUFTLENBQUMsUUFBUSxDQUFDLENBQUNtTyxLQUFLLENBQUMsQ0FBQztJQUU5RCxNQUFNblYsTUFBTSxDQUNWcUcsSUFBSSxDQUFDYyxTQUFTLENBQUN3QixPQUFPLENBQUNzRyxNQUFNLEVBQUU7TUFBRTdILEtBQUssRUFBRTtJQUFLLENBQUMsQ0FBQyxDQUFDK2MsSUFBSSxDQUFDLENBQ3ZELENBQUMsQ0FBQ2pkLFdBQVcsQ0FBQyxDQUFDO0lBQ2YsTUFBTWxILE1BQU0sQ0FDVnFHLElBQUksQ0FDRGMsU0FBUyxDQUFDLHFEQUFxRCxFQUFFO01BQ2hFQyxLQUFLLEVBQUU7SUFDVCxDQUFDLENBQUMsQ0FDRCtjLElBQUksQ0FBQyxDQUNWLENBQUMsQ0FBQ2pkLFdBQVcsQ0FBQyxDQUFDO0lBQ2YsTUFBTWIsSUFBSSxDQUNQc1ksT0FBTyxDQUFDLFNBQVMsQ0FBQyxDQUNsQjNiLE1BQU0sQ0FBQztNQUFFNGYsT0FBTyxFQUFFO0lBQWlCLENBQUMsQ0FBQyxDQUNyQ3VCLElBQUksQ0FBQyxDQUFDLENBQ05oUCxLQUFLLENBQUMsQ0FBQztJQUNWLE1BQU1uVixNQUFNLENBQUNxRyxJQUFJLENBQUNzWSxPQUFPLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQ0MsYUFBYSxDQUFDLGdCQUFnQixDQUFDO0lBQ2xFLE1BQU01ZSxNQUFNLENBQUNxRyxJQUFJLENBQUNzWSxPQUFPLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQ0MsYUFBYSxDQUM5QyxnQ0FDRixDQUFDO0lBQ0QsTUFBTTVlLE1BQU0sQ0FBQ3FHLElBQUksQ0FBQ3NZLE9BQU8sQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDQyxhQUFhLENBQUMsYUFBYSxDQUFDO0lBQy9ELE1BQU01ZSxNQUFNLENBQUNxRyxJQUFJLENBQUNzWSxPQUFPLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQ0MsYUFBYSxDQUFDLHVCQUF1QixDQUFDO0lBQ3pFLE1BQU1PLFdBQVcsR0FBRyxNQUFNOVksSUFBSSxDQUFDc1ksT0FBTyxDQUFDLE1BQU0sQ0FBQyxDQUFDSyxTQUFTLENBQUMsQ0FBQztJQUMxRGhmLE1BQU0sQ0FBQ21mLFdBQVcsQ0FBQyxDQUFDMUgsR0FBRyxDQUFDd0gsT0FBTyxDQUM3QixxRUFDRixDQUFDO0lBRUQsTUFBTTdZLDBCQUEwQixDQUFDQyxJQUFJLENBQUM7RUFDeEMsQ0FBQyxDQUFDO0VBRUZwRyxJQUFJLENBQUMsa0ZBQWtGLEVBQUUsT0FBTztJQUM5Rm9HO0VBQ0YsQ0FBQyxLQUFLO0lBQ0osTUFBTXNDLE9BQU8sR0FBRzZKLDRCQUE0QixDQUFDLENBQUM7SUFDOUMsTUFBTTNLLGtCQUFrQixDQUFDeEIsSUFBSSxFQUFFO01BQUVvQyxZQUFZLEVBQUVFO0lBQVEsQ0FBQyxDQUFDO0lBQ3pELE1BQU13TCxrQkFBa0IsQ0FBQzlOLElBQUksQ0FBQztJQUM5QixNQUFNQSxJQUFJLENBQUNnTyxJQUFJLENBQUMsR0FBRzdULGNBQWMsSUFBSSxDQUFDO0lBRXRDLE1BQU1zakIsUUFBUSxHQUFHemQsSUFBSSxDQUFDc1ksT0FBTyxDQUFDLFVBQVUsQ0FBQyxDQUFDdkIsS0FBSyxDQUFDLENBQUM7SUFDakQsTUFBTTBHLFFBQVEsQ0FBQ0wsSUFBSSxDQUFDOWEsT0FBTyxDQUFDUSxRQUFRLENBQUM7SUFDckMsTUFBTTJhLFFBQVEsQ0FBQ25GLE9BQU8sQ0FBQyxVQUFVLENBQUMsQ0FBQzNYLFNBQVMsQ0FBQyxRQUFRLENBQUMsQ0FBQ21PLEtBQUssQ0FBQyxDQUFDO0lBRTlELE1BQU1sRyxNQUFNLEdBQUc1SSxJQUFJLENBQUNjLFNBQVMsQ0FBQ3dCLE9BQU8sQ0FBQ3NHLE1BQU0sRUFBRTtNQUFFN0gsS0FBSyxFQUFFO0lBQUssQ0FBQyxDQUFDO0lBQzlELE1BQU1wSCxNQUFNLENBQUNpUCxNQUFNLENBQUNrVixJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUNqZCxXQUFXLENBQUMsQ0FBQztJQUN6QyxNQUFNbEgsTUFBTSxDQUFDcUcsSUFBSSxDQUFDYyxTQUFTLENBQUMsYUFBYSxFQUFFO01BQUVDLEtBQUssRUFBRTtJQUFNLENBQUMsQ0FBQyxDQUFDLENBQUNGLFdBQVcsQ0FBQyxDQUFDO0lBQzNFLE1BQU1sSCxNQUFNLENBQ1ZxRyxJQUFJLENBQUNjLFNBQVMsQ0FBQyxrQkFBa0IsRUFBRTtNQUFFQyxLQUFLLEVBQUU7SUFBTSxDQUFDLENBQUMsQ0FBQytjLElBQUksQ0FBQyxDQUM1RCxDQUFDLENBQUNqZCxXQUFXLENBQUMsQ0FBQztJQUNmLE1BQU1sSCxNQUFNLENBQ1ZxRyxJQUFJLENBQUNjLFNBQVMsQ0FBQywyQkFBMkIsRUFBRTtNQUFFQyxLQUFLLEVBQUU7SUFBTSxDQUFDLENBQUMsQ0FBQytjLElBQUksQ0FBQyxDQUNyRSxDQUFDLENBQUNqZCxXQUFXLENBQUMsQ0FBQztJQUNmLE1BQU1sSCxNQUFNLENBQ1ZxRyxJQUFJLENBQUNjLFNBQVMsQ0FBQyx3REFBd0QsRUFBRTtNQUN2RUMsS0FBSyxFQUFFO0lBQ1QsQ0FBQyxDQUNILENBQUMsQ0FBQ0YsV0FBVyxDQUFDLENBQUM7SUFFZixNQUFNYixJQUFJLENBQUN3WSxNQUFNLENBQUMsQ0FBQztJQUNuQixNQUFNeFksSUFBSSxDQUNQVyxTQUFTLENBQUMsUUFBUSxFQUFFO01BQUVDLElBQUksRUFBRTBCLE9BQU8sQ0FBQ1EsUUFBUTtNQUFFL0IsS0FBSyxFQUFFO0lBQUssQ0FBQyxDQUFDLENBQzVEK04sS0FBSyxDQUFDLENBQUM7SUFFVixNQUFNblYsTUFBTSxDQUFDcUcsSUFBSSxDQUFDYyxTQUFTLENBQUN3QixPQUFPLENBQUNzRyxNQUFNLEVBQUU7TUFBRTdILEtBQUssRUFBRTtJQUFLLENBQUMsQ0FBQyxDQUFDK2MsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDamQsV0FBVyxDQUFDLENBQUM7SUFDbEYsTUFBTWxILE1BQU0sQ0FBQ3FHLElBQUksQ0FBQ2MsU0FBUyxDQUFDLGFBQWEsRUFBRTtNQUFFQyxLQUFLLEVBQUU7SUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDRixXQUFXLENBQUMsQ0FBQztJQUMzRSxNQUFNbEgsTUFBTSxDQUNWcUcsSUFBSSxDQUFDYyxTQUFTLENBQUMsa0JBQWtCLEVBQUU7TUFBRUMsS0FBSyxFQUFFO0lBQU0sQ0FBQyxDQUFDLENBQUMrYyxJQUFJLENBQUMsQ0FDNUQsQ0FBQyxDQUFDamQsV0FBVyxDQUFDLENBQUM7SUFDZixNQUFNbEgsTUFBTSxDQUNWcUcsSUFBSSxDQUFDYyxTQUFTLENBQUMsMkJBQTJCLEVBQUU7TUFBRUMsS0FBSyxFQUFFO0lBQU0sQ0FBQyxDQUFDLENBQUMrYyxJQUFJLENBQUMsQ0FDckUsQ0FBQyxDQUFDamQsV0FBVyxDQUFDLENBQUM7SUFDZixNQUFNbEgsTUFBTSxDQUNWcUcsSUFBSSxDQUFDYyxTQUFTLENBQUMsd0RBQXdELEVBQUU7TUFDdkVDLEtBQUssRUFBRTtJQUNULENBQUMsQ0FDSCxDQUFDLENBQUNGLFdBQVcsQ0FBQyxDQUFDO0VBQ2pCLENBQUMsQ0FBQztFQUVGakgsSUFBSSxDQUFDLDhEQUE4RCxFQUFFLE9BQU87SUFDMUVvRztFQUNGLENBQUMsS0FBSztJQUFBLElBQUF3ZSxxQkFBQTtJQUNKLE1BQU07TUFBRWxjLE9BQU87TUFBRTBGO0lBQVUsQ0FBQyxHQUFHdUUsb0NBQW9DLENBQUMsQ0FBQztJQUNyRSxNQUFNL0ssa0JBQWtCLENBQUN4QixJQUFJLEVBQUU7TUFDN0JrQyxRQUFRLEVBQUVJLE9BQU87TUFDakJTLGFBQWEsRUFBRTtRQUFFVCxPQUFPO1FBQUUwRjtNQUFVO0lBQ3RDLENBQUMsQ0FBQztJQUNGLE1BQU04RixrQkFBa0IsQ0FBQzlOLElBQUksQ0FBQztJQUU5QixNQUFNQSxJQUFJLENBQUNFLFFBQVEsQ0FDakIsQ0FBQztNQUFFMEMsU0FBUztNQUFFTSxXQUFXO01BQUVyRixTQUFTO01BQUVvSyxXQUFXO01BQUU1SjtJQUFRLENBQUMsS0FBSztNQUMvRHNjLFlBQVksQ0FBQ0MsT0FBTyxDQUNsQiw0QkFBNEIvYyxTQUFTLEVBQUUsRUFDdkMrRSxTQUNGLENBQUM7TUFDRCtYLFlBQVksQ0FBQ0MsT0FBTyxDQUNsQixvQkFBb0IvYyxTQUFTLElBQUkrRSxTQUFTLEVBQUUsRUFDNUMvQyxJQUFJLENBQUNDLFNBQVMsQ0FBQztRQUNiNUIsRUFBRSxFQUFFZ0YsV0FBVztRQUNmckYsU0FBUztRQUNUK0UsU0FBUztRQUNUcUYsV0FBVztRQUNYNUo7TUFDRixDQUFDLENBQ0gsQ0FBQztJQUNILENBQUMsRUFDRDtNQUNFdUUsU0FBUyxFQUFFTixPQUFPLENBQUNNLFNBQVM7TUFDNUJNLFdBQVcsRUFBRVosT0FBTyxDQUFDWSxXQUFXO01BQ2hDckYsU0FBUyxFQUFFLGFBQWE7TUFDeEJvSyxXQUFXLEVBQUUsMkNBQTJDO01BQ3hENUosT0FBTyxFQUFFaUUsT0FBTyxDQUFDUTtJQUNuQixDQUNGLENBQUM7SUFDRCxNQUFNOUMsSUFBSSxDQUFDZ08sSUFBSSxDQUFDLEdBQUc3VCxjQUFjLElBQUksQ0FBQztJQUV0QyxNQUFNUixNQUFNLENBQ1ZxRyxJQUFJLENBQUNjLFNBQVMsQ0FBQyx5Q0FBeUMsQ0FDMUQsQ0FBQyxDQUFDRCxXQUFXLENBQUMsQ0FBQztJQUNmLE1BQU00ZCxhQUFhLEdBQUd6ZSxJQUFJLENBQUNrZCxjQUFjLENBQ3RDOWIsT0FBTyxJQUNOQSxPQUFPLENBQUNXLEdBQUcsQ0FBQyxDQUFDLENBQUMwQixRQUFRLENBQUMscUJBQXFCLENBQUMsSUFDN0NyQyxPQUFPLENBQUNnTyxNQUFNLENBQUMsQ0FBQyxLQUFLLE1BQ3pCLENBQUM7SUFDRCxNQUFNcFAsSUFBSSxDQUNQb1ksVUFBVSxDQUFDLHVCQUF1QixDQUFDLENBQ25DelgsU0FBUyxDQUFDLFFBQVEsRUFBRTtNQUFFQyxJQUFJLEVBQUUsUUFBUTtNQUFFRyxLQUFLLEVBQUU7SUFBSyxDQUFDLENBQUMsQ0FDcEQrTixLQUFLLENBQUMsQ0FBQztJQUNWLE1BQU05TCxXQUFXLEdBQUduRCxJQUFJLENBQUN1UyxLQUFLLEVBQUFvTSxxQkFBQSxHQUM1QixDQUFDLE1BQU1DLGFBQWEsRUFBRUMsUUFBUSxDQUFDLENBQUMsY0FBQUYscUJBQUEsY0FBQUEscUJBQUEsR0FBSSxJQUN0QyxDQUE0QjtJQUM1QjdrQixNQUFNLENBQUNxSixXQUFXLENBQUMsQ0FBQ21aLE9BQU8sQ0FDekJ4aUIsTUFBTSxDQUFDZ2xCLGdCQUFnQixDQUFDO01BQ3RCOWdCLFNBQVMsRUFBRSxhQUFhO01BQ3hCK0UsU0FBUyxFQUFFTixPQUFPLENBQUNNLFNBQVM7TUFDNUJNLFdBQVcsRUFBRVosT0FBTyxDQUFDWSxXQUFXO01BQ2hDK0UsV0FBVyxFQUFFLDJDQUEyQztNQUN4RDVKLE9BQU8sRUFBRWlFLE9BQU8sQ0FBQ1E7SUFDbkIsQ0FBQyxDQUNILENBQUM7SUFFRCxNQUFNbkosTUFBTSxDQUNWcUcsSUFBSSxDQUFDYyxTQUFTLENBQUMsd0JBQXdCLEVBQUU7TUFBRUMsS0FBSyxFQUFFO0lBQUssQ0FBQyxDQUMxRCxDQUFDLENBQUNGLFdBQVcsQ0FBQyxDQUFDO0lBQ2YsTUFBTWxILE1BQU0sQ0FDVnFHLElBQUksQ0FBQ2MsU0FBUyxDQUFDLHlDQUF5QyxDQUMxRCxDQUFDLENBQUNELFdBQVcsQ0FBQyxDQUFDO0lBQ2YsTUFBTWlZLFdBQVcsR0FBRyxNQUFNOVksSUFBSSxDQUFDc1ksT0FBTyxDQUFDLE1BQU0sQ0FBQyxDQUFDSyxTQUFTLENBQUMsQ0FBQztJQUMxRGhmLE1BQU0sQ0FBQ21mLFdBQVcsQ0FBQyxDQUFDMUgsR0FBRyxDQUFDRixTQUFTLENBQUMsV0FBVyxDQUFDO0lBQzlDdlgsTUFBTSxDQUFDbWYsV0FBVyxDQUFDLENBQUMxSCxHQUFHLENBQUNGLFNBQVMsQ0FBQywyQkFBMkIsQ0FBQztJQUM5RHZYLE1BQU0sQ0FBQ21mLFdBQVcsQ0FBQyxDQUFDNUgsU0FBUyxDQUFDLHlDQUF5QyxDQUFDO0VBQzFFLENBQUMsQ0FBQztFQUVGdFgsSUFBSSxDQUFDLDhFQUE4RSxFQUFFLE9BQU87SUFDMUZvRztFQUNGLENBQUMsS0FBSztJQUFBLElBQUE0ZSxnQkFBQSxFQUFBQyxpQkFBQTtJQUNKLE1BQU0xRyxRQUFRLEdBQUczTCwrQkFBK0IsQ0FBQyxDQUFDO0lBQ2xELE1BQU1oTCxrQkFBa0IsQ0FBQ3hCLElBQUksRUFBRTtNQUFFb0QsaUJBQWlCLEVBQUUrVTtJQUFTLENBQUMsQ0FBQztJQUMvRCxNQUFNblksSUFBSSxDQUFDOGUsYUFBYSxDQUFDLE1BQU07TUFDN0IsTUFBTUMsV0FBVyxHQUFHeGUsTUFBTSxDQUFDOE8sS0FBSyxDQUFDMlAsSUFBSSxDQUFDemUsTUFBTSxDQUFDO01BQzdDQSxNQUFNLENBQUM4TyxLQUFLLEdBQUcsT0FBTzRQLEtBQUssRUFBRUMsSUFBSSxLQUFLO1FBQ3BDLE1BQU1uZCxHQUFHLEdBQ1AsT0FBT2tkLEtBQUssS0FBSyxRQUFRLEdBQ3JCQSxLQUFLLEdBQ0xBLEtBQUssWUFBWUUsT0FBTyxHQUN0QkYsS0FBSyxDQUFDbGQsR0FBRyxHQUNUK1IsTUFBTSxDQUFDbUwsS0FBSyxDQUFDO1FBQ3JCLE1BQU12ZixJQUFJLEdBQUcsUUFBT3dmLElBQUksYUFBSkEsSUFBSSx1QkFBSkEsSUFBSSxDQUFFeGYsSUFBSSxNQUFLLFFBQVEsR0FBR3dmLElBQUksQ0FBQ3hmLElBQUksR0FBRyxFQUFFO1FBQzVELElBQ0UsQ0FBQ3FDLEdBQUcsQ0FBQzBCLFFBQVEsQ0FBQyxxQkFBcUIsQ0FBQyxJQUNwQy9ELElBQUksQ0FBQytELFFBQVEsQ0FBQyxlQUFlLENBQUMsRUFDOUI7VUFDQSxPQUFPc2IsV0FBVyxDQUFDRSxLQUFLLEVBQUVDLElBQUksQ0FBQztRQUNqQztRQUVBLE1BQU0vZCxRQUFRLEdBQUcsTUFBTTRkLFdBQVcsQ0FBQ0UsS0FBSyxFQUFFQyxJQUFJLENBQUM7UUFDL0MsSUFBSSxDQUFDL2QsUUFBUSxDQUFDekIsSUFBSSxFQUFFLE9BQU95QixRQUFRO1FBQ25DLE1BQU1pZSxNQUFNLEdBQUdqZSxRQUFRLENBQUN6QixJQUFJLENBQUMyZixTQUFTLENBQUMsQ0FBQztRQUN4QyxNQUFNQyxPQUFPLEdBQUcsSUFBSUMsV0FBVyxDQUFDLENBQUM7UUFDakMsTUFBTUMsTUFBTSxHQUFHLElBQUlDLGNBQWMsQ0FBQztVQUNoQyxNQUFNQyxLQUFLQSxDQUFDQyxVQUFVLEVBQUU7WUFDdEIsSUFBSUMsUUFBUSxHQUFHLEVBQUU7WUFDakIsT0FBTyxJQUFJLEVBQUU7Y0FDWCxNQUFNO2dCQUFFQyxJQUFJO2dCQUFFbFk7Y0FBTSxDQUFDLEdBQUcsTUFBTXlYLE1BQU0sQ0FBQ1UsSUFBSSxDQUFDLENBQUM7Y0FDM0MsSUFBSUQsSUFBSSxFQUFFO2dCQUNSLElBQUlELFFBQVEsRUFBRUQsVUFBVSxDQUFDSSxPQUFPLENBQUNULE9BQU8sQ0FBQ1UsTUFBTSxDQUFDSixRQUFRLENBQUMsQ0FBQztnQkFDMURELFVBQVUsQ0FBQzdGLEtBQUssQ0FBQyxDQUFDO2dCQUNsQjtjQUNGO2NBQ0E4RixRQUFRLElBQUksSUFBSUssV0FBVyxDQUFDLENBQUMsQ0FBQ0MsTUFBTSxDQUFDdlksS0FBSyxFQUFFO2dCQUFFNlgsTUFBTSxFQUFFO2NBQUssQ0FBQyxDQUFDO2NBQzdELE1BQU1XLE1BQU0sR0FBR1AsUUFBUSxDQUFDUSxPQUFPLENBQUMsNEJBQTRCLENBQUM7Y0FDN0QsTUFBTUMsUUFBUSxHQUNaRixNQUFNLEdBQUcsQ0FBQyxHQUFHLENBQUMsQ0FBQyxHQUFHUCxRQUFRLENBQUNRLE9BQU8sQ0FBQyxNQUFNLEVBQUVELE1BQU0sQ0FBQztjQUNwRCxJQUFJRSxRQUFRLElBQUksQ0FBQyxFQUFFO2dCQUNqQlYsVUFBVSxDQUFDSSxPQUFPLENBQ2hCVCxPQUFPLENBQUNVLE1BQU0sQ0FBQ0osUUFBUSxDQUFDOVgsS0FBSyxDQUFDLENBQUMsRUFBRXVZLFFBQVEsR0FBRyxDQUFDLENBQUMsQ0FDaEQsQ0FBQztnQkFDRFYsVUFBVSxDQUFDeGEsS0FBSyxDQUFDLElBQUltYixTQUFTLENBQUMsMEJBQTBCLENBQUMsQ0FBQztnQkFDM0Q7Y0FDRjtZQUNGO1VBQ0Y7UUFDRixDQUFDLENBQUM7UUFDRixPQUFPLElBQUlDLFFBQVEsQ0FBQ2YsTUFBTSxFQUFFO1VBQzFCOWdCLE1BQU0sRUFBRXlDLFFBQVEsQ0FBQ3pDLE1BQU07VUFDdkI4aEIsVUFBVSxFQUFFcmYsUUFBUSxDQUFDcWYsVUFBVTtVQUMvQjdnQixPQUFPLEVBQUV3QixRQUFRLENBQUN4QjtRQUNwQixDQUFDLENBQUM7TUFDSixDQUFDO0lBQ0gsQ0FBQyxDQUFDO0lBQ0YsTUFBTW1PLGtCQUFrQixDQUFDOU4sSUFBSSxDQUFDO0lBQzlCLE1BQU1BLElBQUksQ0FBQ2dPLElBQUksQ0FBQyxHQUFHN1QsY0FBYyxJQUFJLENBQUM7SUFFdEMsTUFBTTZMLGNBQThDLEdBQUcsRUFBRTtJQUN6RGhHLElBQUksQ0FBQ3ljLEVBQUUsQ0FBQyxTQUFTLEVBQUdyYixPQUFPLElBQUs7TUFDOUIsSUFDRUEsT0FBTyxDQUFDVyxHQUFHLENBQUMsQ0FBQyxDQUFDMEIsUUFBUSxDQUFDLHFCQUFxQixDQUFDLElBQzdDckMsT0FBTyxDQUFDZ08sTUFBTSxDQUFDLENBQUMsS0FBSyxNQUFNLEVBQzNCO1FBQ0EsSUFBSTtVQUNGcEosY0FBYyxDQUFDZixJQUFJLENBQ2pCN0QsT0FBTyxDQUFDNkIsWUFBWSxDQUFDLENBQ3ZCLENBQUM7UUFDSCxDQUFDLENBQUMsTUFBTTtVQUNOO1VBQ0E7UUFBQTtNQUVKO0lBQ0YsQ0FBQyxDQUFDO0lBRUYsTUFBTXdhLFFBQVEsR0FBR3pkLElBQUksQ0FBQ3NZLE9BQU8sQ0FBQyxVQUFVLENBQUMsQ0FBQ3ZCLEtBQUssQ0FBQyxDQUFDO0lBQ2pELE1BQU0wRyxRQUFRLENBQUNMLElBQUksQ0FBQ2pGLFFBQVEsQ0FBQzdWLE9BQU8sQ0FBQ1EsUUFBUSxDQUFDO0lBQzlDLE1BQU0yYSxRQUFRLENBQUNuRixPQUFPLENBQUMsVUFBVSxDQUFDLENBQUMzWCxTQUFTLENBQUMsUUFBUSxDQUFDLENBQUNtTyxLQUFLLENBQUMsQ0FBQztJQUU5RCxNQUFNblYsTUFBTSxDQUNWcUcsSUFBSSxDQUFDYyxTQUFTLENBQ1osZ0VBQWdFLEVBQ2hFO01BQ0VDLEtBQUssRUFBRTtJQUNULENBQ0YsQ0FDRixDQUFDLENBQUNGLFdBQVcsQ0FBQyxDQUFDO0lBRWYsTUFBTTRmLFVBQVUsR0FDZCw2REFBNkQ7SUFDL0QsTUFBTUMsVUFBVSxHQUFHLHNDQUFzQztJQUN6RCxNQUFNL21CLE1BQU0sQ0FDVCtmLElBQUksQ0FBQyxNQUFNMVosSUFBSSxDQUFDRSxRQUFRLENBQUV5Z0IsR0FBRyxJQUFLaEcsWUFBWSxDQUFDaUcsT0FBTyxDQUFDRCxHQUFHLENBQUMsRUFBRUYsVUFBVSxDQUFDLENBQUMsQ0FDekV2UCxTQUFTLENBQUNpSCxRQUFRLENBQUMxTCxZQUFZLENBQUM7SUFFbkMsTUFBTXpNLElBQUksQ0FBQ0UsUUFBUSxDQUNqQixDQUFDO01BQUV1Z0IsVUFBVTtNQUFFQztJQUFXLENBQUMsS0FBSztNQUFBLElBQUFHLHFCQUFBO01BQzlCLE1BQU1DLEtBQUssR0FBR2poQixJQUFJLENBQUN1UyxLQUFLLEVBQUF5TyxxQkFBQSxHQUFDbEcsWUFBWSxDQUFDaUcsT0FBTyxDQUFDSCxVQUFVLENBQUMsY0FBQUkscUJBQUEsY0FBQUEscUJBQUEsR0FBSSxJQUFJLENBQUM7TUFDbEUsT0FBT0MsS0FBSyxDQUFDN1ksV0FBVztNQUN4QjBTLFlBQVksQ0FBQ0MsT0FBTyxDQUFDNkYsVUFBVSxFQUFFNWdCLElBQUksQ0FBQ0MsU0FBUyxDQUFDZ2hCLEtBQUssQ0FBQyxDQUFDO01BQ3ZEbkcsWUFBWSxDQUFDQyxPQUFPLENBQUM4RixVQUFVLEVBQUUsZ0NBQWdDLENBQUM7SUFDcEUsQ0FBQyxFQUNEO01BQUVELFVBQVU7TUFBRUM7SUFBVyxDQUMzQixDQUFDO0lBQ0QsTUFBTTFnQixJQUFJLENBQUN3WSxNQUFNLENBQUMsQ0FBQztJQUVuQixNQUFNN2UsTUFBTSxDQUNWcUcsSUFBSSxDQUFDYyxTQUFTLENBQUMseUNBQXlDLEVBQUU7TUFDeERDLEtBQUssRUFBRTtJQUNULENBQUMsQ0FDSCxDQUFDLENBQUNGLFdBQVcsQ0FBQyxDQUFDO0lBQ2YsTUFBTWxILE1BQU0sQ0FDVCtmLElBQUksQ0FBQyxNQUNKMVosSUFBSSxDQUFDRSxRQUFRLENBQUV5Z0IsR0FBRyxJQUFLO01BQUEsSUFBQUksc0JBQUE7TUFDckIsTUFBTUQsS0FBSyxHQUFHamhCLElBQUksQ0FBQ3VTLEtBQUssRUFBQTJPLHNCQUFBLEdBQUNwRyxZQUFZLENBQUNpRyxPQUFPLENBQUNELEdBQUcsQ0FBQyxjQUFBSSxzQkFBQSxjQUFBQSxzQkFBQSxHQUFJLElBQUksQ0FBQztNQUMzRCxPQUFPRCxLQUFLLENBQUM3WSxXQUFXO0lBQzFCLENBQUMsRUFBRXdZLFVBQVUsQ0FDZixDQUFDLENBQ0FsZixJQUFJLENBQUM0VyxRQUFRLENBQUNqUSxjQUFjLENBQUM7SUFFaEMsTUFBTWxJLElBQUksQ0FBQ1csU0FBUyxDQUFDLFFBQVEsRUFBRTtNQUFFQyxJQUFJLEVBQUUsUUFBUTtNQUFFRyxLQUFLLEVBQUU7SUFBSyxDQUFDLENBQUMsQ0FBQytOLEtBQUssQ0FBQyxDQUFDO0lBQ3ZFLE1BQU1uVixNQUFNLENBQ1ZxRyxJQUFJLENBQUNjLFNBQVMsQ0FBQ3FYLFFBQVEsQ0FBQzdWLE9BQU8sQ0FBQ3NHLE1BQU0sRUFBRTtNQUFFN0gsS0FBSyxFQUFFO0lBQUssQ0FBQyxDQUN6RCxDQUFDLENBQUNGLFdBQVcsQ0FBQyxDQUFDO0lBQ2YsTUFBTWxILE1BQU0sQ0FBQytmLElBQUksQ0FBQyxNQUFNMVQsY0FBYyxDQUFDbkosTUFBTSxDQUFDLENBQUMwRSxJQUFJLENBQUMsQ0FBQyxDQUFDO0lBQ3RENUgsTUFBTSxDQUFDcU0sY0FBYyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUNtVyxPQUFPLENBQy9CeGlCLE1BQU0sQ0FBQ2dsQixnQkFBZ0IsQ0FBQztNQUN0QjlnQixTQUFTLEVBQUUsYUFBYTtNQUN4QlEsT0FBTyxFQUFFOFosUUFBUSxDQUFDN1YsT0FBTyxDQUFDUTtJQUM1QixDQUFDLENBQ0gsQ0FBQztJQUNEbkosTUFBTSxFQUFBaWxCLGdCQUFBLEdBQUM1WSxjQUFjLENBQUMsQ0FBQyxDQUFDLGNBQUE0WSxnQkFBQSx1QkFBakJBLGdCQUFBLENBQW1CMWIsV0FBVyxDQUFDLENBQUN1TyxhQUFhLENBQUMsQ0FBQztJQUN0RDlYLE1BQU0sRUFBQWtsQixpQkFBQSxHQUFDN1ksY0FBYyxDQUFDLENBQUMsQ0FBQyxjQUFBNlksaUJBQUEsdUJBQWpCQSxpQkFBQSxDQUFtQmpjLFNBQVMsQ0FBQyxDQUFDNk8sYUFBYSxDQUFDLENBQUM7SUFDcEQ5WCxNQUFNLENBQUNxTSxjQUFjLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQ21XLE9BQU8sQ0FDL0J4aUIsTUFBTSxDQUFDZ2xCLGdCQUFnQixDQUFDO01BQ3RCOWdCLFNBQVMsRUFBRSxhQUFhO01BQ3hCK0UsU0FBUyxFQUFFdVYsUUFBUSxDQUFDN1YsT0FBTyxDQUFDTSxTQUFTO01BQ3JDTSxXQUFXLEVBQUVpVixRQUFRLENBQUM3VixPQUFPLENBQUNZLFdBQVc7TUFDekMrRSxXQUFXLEVBQUVrUSxRQUFRLENBQUNqUSxjQUFjO01BQ3BDN0osT0FBTyxFQUFFOFosUUFBUSxDQUFDN1YsT0FBTyxDQUFDUTtJQUM1QixDQUFDLENBQ0gsQ0FBQztJQUNEbkosTUFBTSxDQUNKcU0sY0FBYyxDQUFDdkosR0FBRyxDQUFFMkUsT0FBTyxJQUFLQSxPQUFPLENBQUM4QixXQUFXLENBQUMsQ0FBQ3ZHLE1BQU0sQ0FBQ0MsT0FBTyxDQUNyRSxDQUFDLENBQUN1ZixPQUFPLENBQUMsQ0FBQ2hFLFFBQVEsQ0FBQzdWLE9BQU8sQ0FBQ1ksV0FBVyxDQUFDLENBQUM7RUFDM0MsQ0FBQyxDQUFDO0VBRUZ0SixJQUFJLENBQUMsdURBQXVELEVBQUUsT0FBTztJQUNuRW9HO0VBQ0YsQ0FBQyxLQUFLO0lBQ0osTUFBTW1ZLFFBQVEsR0FBRztNQUNmblQsUUFBUSxFQUFFLEVBQWM7TUFDeEI0QixVQUFVLEVBQUUsQ0FDVjtRQUNFRSxVQUFVLEVBQUUsaUNBQWlDO1FBQzdDckksV0FBVyxFQUFFLGtDQUFrQztRQUMvQ21FLFNBQVMsRUFBRSxnQ0FBZ0M7UUFDM0NvZSxTQUFTLEVBQUUsU0FBUztRQUNwQnRpQixNQUFNLEVBQUUsU0FBUztRQUNqQmEsU0FBUyxFQUFFLDBCQUEwQjtRQUNyQzBoQixhQUFhLEVBQUUsYUFBYTtRQUM1QkMsbUJBQW1CLEVBQ2pCLGdFQUFnRTtRQUNsRUMsVUFBVSxFQUNSLHNHQUFzRztRQUN4R0MsY0FBYyxFQUFFLElBQUk7UUFDcEJDLGtCQUFrQixFQUFFLENBQUM7VUFBRTFLLE9BQU8sRUFBRSxxQkFBcUI7VUFBRWpZLE1BQU0sRUFBRTtRQUFTLENBQUMsQ0FBQztRQUMxRTRpQixrQkFBa0IsRUFBRSxJQUFJO1FBQ3hCQyxXQUFXLEVBQUU7TUFDZixDQUFDLEVBQ0Q7UUFDRXphLFVBQVUsRUFBRSwrQkFBK0I7UUFDM0NySSxXQUFXLEVBQUUsZ0NBQWdDO1FBQzdDbUUsU0FBUyxFQUFFLDhCQUE4QjtRQUN6Q29lLFNBQVMsRUFBRSxXQUFXO1FBQ3RCdGlCLE1BQU0sRUFBRSxTQUFTO1FBQ2pCYSxTQUFTLEVBQUUsMEJBQTBCO1FBQ3JDMGhCLGFBQWEsRUFBRSxtQkFBbUI7UUFDbENDLG1CQUFtQixFQUNqQixtRkFBbUY7UUFDckZDLFVBQVUsRUFDUixtRkFBbUY7UUFDckZDLGNBQWMsRUFBRSxrREFBa0Q7UUFDbEVDLGtCQUFrQixFQUFFLElBQUk7UUFDeEJDLGtCQUFrQixFQUFFLEtBQUs7UUFDekJDLFdBQVcsRUFBRTtNQUNmLENBQUMsRUFDRDtRQUNFemEsVUFBVSxFQUFFLGlDQUFpQztRQUM3Q3JJLFdBQVcsRUFBRSxrQ0FBa0M7UUFDL0NtRSxTQUFTLEVBQUUsZ0NBQWdDO1FBQzNDb2UsU0FBUyxFQUFFLFdBQVc7UUFDdEJ0aUIsTUFBTSxFQUFFLFVBQVU7UUFDbEJhLFNBQVMsRUFBRSwwQkFBMEI7UUFDckMwaEIsYUFBYSxFQUFFLFdBQVc7UUFDMUJDLG1CQUFtQixFQUFFLCtDQUErQztRQUNwRUMsVUFBVSxFQUFFLHdCQUF3QjtRQUNwQ0MsY0FBYyxFQUFFLCtDQUErQztRQUMvREMsa0JBQWtCLEVBQUUsSUFBSTtRQUN4QkMsa0JBQWtCLEVBQUUsS0FBSztRQUN6QkMsV0FBVyxFQUFFO01BQ2YsQ0FBQztJQUVMLENBQUM7SUFDRCxNQUFNL2Ysa0JBQWtCLENBQUN4QixJQUFJLEVBQUU7TUFBRTJHLGdCQUFnQixFQUFFd1I7SUFBUyxDQUFDLENBQUM7SUFDOUQsTUFBTXJLLGtCQUFrQixDQUFDOU4sSUFBSSxDQUFDO0lBQzlCLE1BQU1BLElBQUksQ0FBQ2dPLElBQUksQ0FBQyxHQUFHN1QsY0FBYyxJQUFJLENBQUM7SUFFdEMsTUFBTXFuQixNQUFNLEdBQUd4aEIsSUFBSSxDQUFDVyxTQUFTLENBQUMsUUFBUSxFQUFFO01BQ3RDQyxJQUFJLEVBQUU7SUFDUixDQUFDLENBQUM7SUFDRixNQUFNakgsTUFBTSxDQUFDNm5CLE1BQU0sQ0FBQyxDQUFDM2dCLFdBQVcsQ0FBQyxDQUFDO0lBQ2xDLE1BQU1sSCxNQUFNLENBQUM2bkIsTUFBTSxDQUFDMWdCLFNBQVMsQ0FBQyxhQUFhLEVBQUU7TUFBRUMsS0FBSyxFQUFFO0lBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQ0YsV0FBVyxDQUFDLENBQUM7SUFDNUUsTUFBTWxILE1BQU0sQ0FDVjZuQixNQUFNLENBQUMxZ0IsU0FBUyxDQUFDLHVCQUF1QixFQUFFO01BQUVDLEtBQUssRUFBRTtJQUFLLENBQUMsQ0FDM0QsQ0FBQyxDQUFDRixXQUFXLENBQUMsQ0FBQztJQUNmLE1BQU1sSCxNQUFNLENBQ1Y2bkIsTUFBTSxDQUFDMWdCLFNBQVMsQ0FBQyxtQkFBbUIsRUFBRTtNQUFFQyxLQUFLLEVBQUU7SUFBSyxDQUFDLENBQ3ZELENBQUMsQ0FBQ0YsV0FBVyxDQUFDLENBQUM7SUFDZixNQUFNbEgsTUFBTSxDQUNWNm5CLE1BQU0sQ0FBQzFnQixTQUFTLENBQ2QsbUZBQW1GLEVBQ25GO01BQUVDLEtBQUssRUFBRTtJQUFLLENBQ2hCLENBQ0YsQ0FBQyxDQUFDRixXQUFXLENBQUMsQ0FBQztJQUNmLE1BQU1sSCxNQUFNLENBQ1Y2bkIsTUFBTSxDQUFDMWdCLFNBQVMsQ0FBQywrQ0FBK0MsRUFBRTtNQUNoRUMsS0FBSyxFQUFFO0lBQ1QsQ0FBQyxDQUNILENBQUMsQ0FBQ0YsV0FBVyxDQUFDLENBQUM7SUFDZixNQUFNbEgsTUFBTSxDQUNWNm5CLE1BQU0sQ0FBQzFnQixTQUFTLENBQ2QsbUVBQW1FLEVBQ25FO01BQUVDLEtBQUssRUFBRTtJQUFLLENBQ2hCLENBQ0YsQ0FBQyxDQUFDRixXQUFXLENBQUMsQ0FBQztJQUVmLE1BQU00Z0IsU0FBUyxHQUFHRCxNQUFNLENBQUNsSixPQUFPLENBQzlCLHdEQUNGLENBQUM7SUFDRCxNQUFNb0osT0FBTyxHQUFHRixNQUFNLENBQUNsSixPQUFPLENBQzVCLHNEQUNGLENBQUM7SUFDRCxNQUFNcUosU0FBUyxHQUFHSCxNQUFNLENBQUNsSixPQUFPLENBQzlCLHdEQUNGLENBQUM7SUFDRCxNQUFNM2UsTUFBTSxDQUFDOG5CLFNBQVMsQ0FBQyxDQUFDRyxlQUFlLENBQ3JDLHFCQUFxQixFQUNyQixhQUNGLENBQUM7SUFDRCxNQUFNam9CLE1BQU0sQ0FBQytuQixPQUFPLENBQUMsQ0FBQ0UsZUFBZSxDQUNuQyxxQkFBcUIsRUFDckIsbUJBQ0YsQ0FBQztJQUNELE1BQU1qb0IsTUFBTSxDQUFDZ29CLFNBQVMsQ0FBQyxDQUFDQyxlQUFlLENBQ3JDLHFCQUFxQixFQUNyQixXQUNGLENBQUM7SUFDRCxNQUFNam9CLE1BQU0sQ0FBQzhuQixTQUFTLENBQUM5Z0IsU0FBUyxDQUFDLFFBQVEsRUFBRTtNQUFFQyxJQUFJLEVBQUU7SUFBb0IsQ0FBQyxDQUFDLENBQUMsQ0FBQytjLFdBQVcsQ0FBQyxDQUFDO0lBQ3hGLE1BQU1oa0IsTUFBTSxDQUFDOG5CLFNBQVMsQ0FBQzlnQixTQUFTLENBQUMsUUFBUSxFQUFFO01BQUVDLElBQUksRUFBRTtJQUFvQixDQUFDLENBQUMsQ0FBQyxDQUFDK2MsV0FBVyxDQUFDLENBQUM7SUFDeEYsTUFBTWhrQixNQUFNLENBQUMrbkIsT0FBTyxDQUFDL2dCLFNBQVMsQ0FBQyxRQUFRLEVBQUU7TUFBRUMsSUFBSSxFQUFFO0lBQW9CLENBQUMsQ0FBQyxDQUFDLENBQUNpaEIsWUFBWSxDQUFDLENBQUM7SUFDdkYsTUFBTWxvQixNQUFNLENBQUMrbkIsT0FBTyxDQUFDL2dCLFNBQVMsQ0FBQyxRQUFRLEVBQUU7TUFBRUMsSUFBSSxFQUFFO0lBQW9CLENBQUMsQ0FBQyxDQUFDLENBQUNpaEIsWUFBWSxDQUFDLENBQUM7SUFDdkYsTUFBTWxvQixNQUFNLENBQUNnb0IsU0FBUyxDQUFDaGhCLFNBQVMsQ0FBQyxRQUFRLEVBQUU7TUFBRUMsSUFBSSxFQUFFO0lBQW9CLENBQUMsQ0FBQyxDQUFDLENBQUNpaEIsWUFBWSxDQUFDLENBQUM7SUFDekYsTUFBTWxvQixNQUFNLENBQUNnb0IsU0FBUyxDQUFDaGhCLFNBQVMsQ0FBQyxRQUFRLEVBQUU7TUFBRUMsSUFBSSxFQUFFO0lBQW9CLENBQUMsQ0FBQyxDQUFDLENBQUNpaEIsWUFBWSxDQUFDLENBQUM7SUFFekYsTUFBTS9JLFdBQVcsR0FBRyxNQUFNOVksSUFBSSxDQUFDc1ksT0FBTyxDQUFDLE1BQU0sQ0FBQyxDQUFDSyxTQUFTLENBQUMsQ0FBQztJQUMxRGhmLE1BQU0sQ0FBQ21mLFdBQVcsQ0FBQyxDQUFDMUgsR0FBRyxDQUFDd0gsT0FBTyxDQUM3QiwyREFDRixDQUFDO0lBQ0QsTUFBTTdZLDBCQUEwQixDQUFDQyxJQUFJLENBQUM7SUFFdEMsTUFBTUEsSUFBSSxDQUFDd1ksTUFBTSxDQUFDLENBQUM7SUFDbkIsTUFBTXNKLGNBQWMsR0FBRzloQixJQUFJLENBQUNXLFNBQVMsQ0FBQyxRQUFRLEVBQUU7TUFDOUNDLElBQUksRUFBRTtJQUNSLENBQUMsQ0FBQztJQUNGLE1BQU1qSCxNQUFNLENBQUNtb0IsY0FBYyxDQUFDLENBQUNqaEIsV0FBVyxDQUFDLENBQUM7SUFDMUMsTUFBTWxILE1BQU0sQ0FDVm1vQixjQUFjLENBQ1h4SixPQUFPLENBQUMsc0RBQXNELENBQUMsQ0FDL0QzWCxTQUFTLENBQUMsUUFBUSxFQUFFO01BQUVDLElBQUksRUFBRTtJQUFvQixDQUFDLENBQ3RELENBQUMsQ0FBQ2loQixZQUFZLENBQUMsQ0FBQztJQUNoQixNQUFNbG9CLE1BQU0sQ0FDVm1vQixjQUFjLENBQ1h4SixPQUFPLENBQUMsd0RBQXdELENBQUMsQ0FDakUzWCxTQUFTLENBQUMsUUFBUSxFQUFFO01BQUVDLElBQUksRUFBRTtJQUFvQixDQUFDLENBQ3RELENBQUMsQ0FBQ2loQixZQUFZLENBQUMsQ0FBQztJQUNoQmxvQixNQUFNLENBQUN3ZSxRQUFRLENBQUNuVCxRQUFRLENBQUNuSSxNQUFNLENBQUMsQ0FBQ2tsQixzQkFBc0IsQ0FBQyxDQUFDLENBQUM7SUFDMURwb0IsTUFBTSxDQUFDd2UsUUFBUSxDQUFDblQsUUFBUSxDQUFDdVEsS0FBSyxDQUFFeFQsR0FBRyxJQUFLQSxHQUFHLENBQUMwQixRQUFRLENBQUMsdUJBQXVCLENBQUMsQ0FBQyxDQUFDLENBQUNsQyxJQUFJLENBQUMsSUFBSSxDQUFDO0VBQzVGLENBQUMsQ0FBQztFQUVGM0gsSUFBSSxDQUFDLGtFQUFrRSxFQUFFLE9BQU87SUFDOUVvRztFQUNGLENBQUMsS0FBSztJQUNKLE1BQU1tWSxRQUFRLEdBQUc7TUFDZm5ULFFBQVEsRUFBRSxFQUFjO01BQ3hCa0MsY0FBYyxFQUFFLEVBQWM7TUFDOUJOLFVBQVUsRUFBRSxDQUNWO1FBQ0VFLFVBQVUsRUFBRSw0QkFBNEI7UUFDeENySSxXQUFXLEVBQUUsNkJBQTZCO1FBQzFDbUUsU0FBUyxFQUFFLDJCQUEyQjtRQUN0Q29lLFNBQVMsRUFBRSxTQUFTO1FBQ3BCdGlCLE1BQU0sRUFBRSxTQUFTO1FBQ2pCYSxTQUFTLEVBQUUsMEJBQTBCO1FBQ3JDMGhCLGFBQWEsRUFBRSxhQUFhO1FBQzVCQyxtQkFBbUIsRUFDakIsK0ZBQStGO1FBQ2pHQyxVQUFVLEVBQ1Isc0dBQXNHO1FBQ3hHQyxjQUFjLEVBQUUsSUFBSTtRQUNwQkMsa0JBQWtCLEVBQUUsQ0FBQztVQUFFMUssT0FBTyxFQUFFLHFCQUFxQjtVQUFFalksTUFBTSxFQUFFO1FBQVMsQ0FBQyxDQUFDO1FBQzFFNGlCLGtCQUFrQixFQUFFLElBQUk7UUFDeEJDLFdBQVcsRUFBRTtNQUNmLENBQUMsQ0FDRjtNQUNEMWEsY0FBYyxFQUFFO1FBQ2RDLFVBQVUsRUFBRSw0QkFBNEI7UUFDeENDLE1BQU0sRUFBRSxtQkFBNEI7UUFDcEM1RixRQUFRLEVBQUU7VUFDUmdFLEtBQUssRUFBRSwrQ0FBK0M7VUFDdER5RSxJQUFJLEVBQUUsNEJBQTRCO1VBQ2xDb1gsU0FBUyxFQUFFLFdBQVc7VUFDdEJDLGFBQWEsRUFBRSxXQUFXO1VBQzFCRSxVQUFVLEVBQUUsd0JBQXdCO1VBQ3BDM1AsVUFBVSxFQUFFO1FBQ2QsQ0FBQztRQUNEckssY0FBYyxFQUFFLENBQ2Q7VUFDRUwsVUFBVSxFQUFFLDRCQUE0QjtVQUN4Q3JJLFdBQVcsRUFBRSw2QkFBNkI7VUFDMUNtRSxTQUFTLEVBQUUsMkJBQTJCO1VBQ3RDb2UsU0FBUyxFQUFFLFdBQVc7VUFDdEJ0aUIsTUFBTSxFQUFFLFVBQVU7VUFDbEJhLFNBQVMsRUFBRSwwQkFBMEI7VUFDckMwaEIsYUFBYSxFQUFFLFdBQVc7VUFDMUJDLG1CQUFtQixFQUFFLCtDQUErQztVQUNwRUMsVUFBVSxFQUFFLHdCQUF3QjtVQUNwQ0MsY0FBYyxFQUFFLElBQUk7VUFDcEJDLGtCQUFrQixFQUFFLElBQUk7VUFDeEJDLGtCQUFrQixFQUFFLEtBQUs7VUFDekJDLFdBQVcsRUFBRTtRQUNmLENBQUM7TUFFTDtJQUNGLENBQUM7SUFDRCxNQUFNL2Ysa0JBQWtCLENBQUN4QixJQUFJLEVBQUU7TUFBRTJHLGdCQUFnQixFQUFFd1I7SUFBUyxDQUFDLENBQUM7SUFDOUQsTUFBTXJLLGtCQUFrQixDQUFDOU4sSUFBSSxDQUFDO0lBQzlCLE1BQU1BLElBQUksQ0FBQ2dPLElBQUksQ0FBQyxHQUFHN1QsY0FBYyxJQUFJLENBQUM7SUFFdEMsTUFBTXFuQixNQUFNLEdBQUd4aEIsSUFBSSxDQUFDVyxTQUFTLENBQUMsUUFBUSxFQUFFO01BQ3RDQyxJQUFJLEVBQUU7SUFDUixDQUFDLENBQUM7SUFDRixNQUFNb2hCLFNBQVMsR0FBR1IsTUFBTSxDQUFDbEosT0FBTyxDQUM5QixtREFDRixDQUFDO0lBQ0QsTUFBTTNlLE1BQU0sQ0FBQ3FvQixTQUFTLENBQUNyaEIsU0FBUyxDQUFDLFFBQVEsRUFBRTtNQUFFQyxJQUFJLEVBQUU7SUFBb0IsQ0FBQyxDQUFDLENBQUMsQ0FBQytjLFdBQVcsQ0FBQyxDQUFDO0lBQ3hGLE1BQU1xRSxTQUFTLENBQUNyaEIsU0FBUyxDQUFDLFFBQVEsRUFBRTtNQUFFQyxJQUFJLEVBQUU7SUFBb0IsQ0FBQyxDQUFDLENBQUNrTyxLQUFLLENBQUMsQ0FBQztJQUUxRSxNQUFNblYsTUFBTSxDQUFDcUcsSUFBSSxDQUFDYyxTQUFTLENBQUMsd0JBQXdCLEVBQUU7TUFBRUMsS0FBSyxFQUFFO0lBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQ0YsV0FBVyxDQUFDLENBQUM7SUFDckYsTUFBTWxILE1BQU0sQ0FDVnFHLElBQUksQ0FBQ2MsU0FBUyxDQUNaLHVFQUF1RSxFQUN2RTtNQUFFQyxLQUFLLEVBQUU7SUFBSyxDQUNoQixDQUNGLENBQUMsQ0FBQ0YsV0FBVyxDQUFDLENBQUM7SUFDZixNQUFNbEgsTUFBTSxDQUNUK2YsSUFBSSxDQUFDLE1BQU12QixRQUFRLENBQUNuVCxRQUFRLENBQUNuSSxNQUFNLENBQUMsQ0FDcENrbEIsc0JBQXNCLENBQUMsQ0FBQyxDQUFDO0lBQzVCLE1BQU1wb0IsTUFBTSxDQUFDcW9CLFNBQVMsQ0FBQyxDQUFDSixlQUFlLENBQUMscUJBQXFCLEVBQUUsV0FBVyxDQUFDO0lBQzNFam9CLE1BQU0sQ0FBQ3dlLFFBQVEsQ0FBQ2pSLGNBQWMsQ0FBQyxDQUFDNFQsWUFBWSxDQUFDLENBQUMsQ0FBQztJQUMvQ25oQixNQUFNLENBQUN3ZSxRQUFRLENBQUNqUixjQUFjLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQ2dLLFNBQVMsQ0FDMUMsK0RBQ0YsQ0FBQztJQUNEdlgsTUFBTSxDQUFDLE1BQU02bkIsTUFBTSxDQUFDbEosT0FBTyxDQUFDLG1EQUFtRCxDQUFDLENBQUN2RCxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUN4VCxJQUFJLENBQUMsQ0FBQyxDQUFDO0lBQ2pHLE1BQU11WCxXQUFXLEdBQUcsTUFBTTlZLElBQUksQ0FBQ3NZLE9BQU8sQ0FBQyxNQUFNLENBQUMsQ0FBQ0ssU0FBUyxDQUFDLENBQUM7SUFDMURoZixNQUFNLENBQUNtZixXQUFXLENBQUMsQ0FBQzFILEdBQUcsQ0FBQ3dILE9BQU8sQ0FBQywwREFBMEQsQ0FBQztJQUMzRixNQUFNN1ksMEJBQTBCLENBQUNDLElBQUksQ0FBQztFQUN4QyxDQUFDLENBQUM7RUFFRnBHLElBQUksQ0FBQyxrRUFBa0UsRUFBRSxPQUFPO0lBQzlFb0c7RUFDRixDQUFDLEtBQUs7SUFDSixNQUFNbVksUUFBUSxHQUFHO01BQ2ZuVCxRQUFRLEVBQUUsRUFBYztNQUN4QmtDLGNBQWMsRUFBRSxFQUFjO01BQzlCTixVQUFVLEVBQUUsQ0FDVjtRQUNFRSxVQUFVLEVBQUUsK0JBQStCO1FBQzNDckksV0FBVyxFQUFFLGdDQUFnQztRQUM3Q21FLFNBQVMsRUFBRSw4QkFBOEI7UUFDekNvZSxTQUFTLEVBQUUsU0FBUztRQUNwQnRpQixNQUFNLEVBQUUsU0FBUztRQUNqQmEsU0FBUyxFQUFFLDBCQUEwQjtRQUNyQzBoQixhQUFhLEVBQUUsYUFBYTtRQUM1QkMsbUJBQW1CLEVBQ2pCLCtGQUErRjtRQUNqR0MsVUFBVSxFQUNSLHNHQUFzRztRQUN4R0MsY0FBYyxFQUFFLElBQUk7UUFDcEJDLGtCQUFrQixFQUFFLENBQUM7VUFBRTFLLE9BQU8sRUFBRSxxQkFBcUI7VUFBRWpZLE1BQU0sRUFBRTtRQUFTLENBQUMsQ0FBQztRQUMxRTRpQixrQkFBa0IsRUFBRSxJQUFJO1FBQ3hCQyxXQUFXLEVBQUU7TUFDZixDQUFDLENBQ0Y7TUFDRDFhLGNBQWMsRUFBRTtRQUNkQyxVQUFVLEVBQUUsK0JBQStCO1FBQzNDQyxNQUFNLEVBQUUsbUJBQTRCO1FBQ3BDckksTUFBTSxFQUFFLEdBQUc7UUFDWHlDLFFBQVEsRUFBRTtVQUNSZ0UsS0FBSyxFQUFFLDhCQUE4QjtVQUNyQ3lFLElBQUksRUFBRSxvQkFBb0I7VUFDMUI0SCxVQUFVLEVBQUU7UUFDZCxDQUFDO1FBQ0RySyxjQUFjLEVBQUU7TUFDbEI7SUFDRixDQUFDO0lBQ0QsTUFBTTNGLGtCQUFrQixDQUFDeEIsSUFBSSxFQUFFO01BQUUyRyxnQkFBZ0IsRUFBRXdSO0lBQVMsQ0FBQyxDQUFDO0lBQzlELE1BQU1ySyxrQkFBa0IsQ0FBQzlOLElBQUksQ0FBQztJQUM5QixNQUFNQSxJQUFJLENBQUNnTyxJQUFJLENBQUMsR0FBRzdULGNBQWMsSUFBSSxDQUFDO0lBRXRDLE1BQU1xbkIsTUFBTSxHQUFHeGhCLElBQUksQ0FBQ1csU0FBUyxDQUFDLFFBQVEsRUFBRTtNQUN0Q0MsSUFBSSxFQUFFO0lBQ1IsQ0FBQyxDQUFDO0lBQ0YsTUFBTW9oQixTQUFTLEdBQUdSLE1BQU0sQ0FBQ2xKLE9BQU8sQ0FDOUIsc0RBQ0YsQ0FBQztJQUNELE1BQU0zZSxNQUFNLENBQUNxb0IsU0FBUyxDQUFDcmhCLFNBQVMsQ0FBQyxRQUFRLEVBQUU7TUFBRUMsSUFBSSxFQUFFO0lBQW9CLENBQUMsQ0FBQyxDQUFDLENBQUMrYyxXQUFXLENBQUMsQ0FBQztJQUN4RixNQUFNcUUsU0FBUyxDQUFDcmhCLFNBQVMsQ0FBQyxRQUFRLEVBQUU7TUFBRUMsSUFBSSxFQUFFO0lBQW9CLENBQUMsQ0FBQyxDQUFDa08sS0FBSyxDQUFDLENBQUM7SUFFMUUsTUFBTW5WLE1BQU0sQ0FBQ3FHLElBQUksQ0FBQ2MsU0FBUyxDQUFDLHVCQUF1QixFQUFFO01BQUVDLEtBQUssRUFBRTtJQUFLLENBQUMsQ0FBQyxDQUFDLENBQUNGLFdBQVcsQ0FBQyxDQUFDO0lBQ3BGLE1BQU1sSCxNQUFNLENBQ1ZxRyxJQUFJLENBQUNjLFNBQVMsQ0FDWiw0RUFBNEUsRUFDNUU7TUFBRUMsS0FBSyxFQUFFO0lBQUssQ0FDaEIsQ0FDRixDQUFDLENBQUNGLFdBQVcsQ0FBQyxDQUFDO0lBQ2YsTUFBTWxILE1BQU0sQ0FBQytmLElBQUksQ0FBQyxNQUFNdkIsUUFBUSxDQUFDblQsUUFBUSxDQUFDbkksTUFBTSxDQUFDLENBQUNrbEIsc0JBQXNCLENBQUMsQ0FBQyxDQUFDO0lBQzNFLE1BQU1wb0IsTUFBTSxDQUFDK2YsSUFBSSxDQUFDLE1BQU04SCxNQUFNLENBQUN6TSxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUN4VCxJQUFJLENBQUMsQ0FBQyxDQUFDO0lBQy9DNUgsTUFBTSxDQUFDd2UsUUFBUSxDQUFDalIsY0FBYyxDQUFDLENBQUM0VCxZQUFZLENBQUMsQ0FBQyxDQUFDO0lBQy9DbmhCLE1BQU0sQ0FBQ3dlLFFBQVEsQ0FBQ2pSLGNBQWMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDZ0ssU0FBUyxDQUMxQyxrRUFDRixDQUFDO0lBQ0QsTUFBTTRILFdBQVcsR0FBRyxNQUFNOVksSUFBSSxDQUFDc1ksT0FBTyxDQUFDLE1BQU0sQ0FBQyxDQUFDSyxTQUFTLENBQUMsQ0FBQztJQUMxRGhmLE1BQU0sQ0FBQ21mLFdBQVcsQ0FBQyxDQUFDMUgsR0FBRyxDQUFDd0gsT0FBTyxDQUM3Qix1RkFDRixDQUFDO0lBQ0QsTUFBTTdZLDBCQUEwQixDQUFDQyxJQUFJLENBQUM7RUFDeEMsQ0FBQyxDQUFDO0VBRUZwRyxJQUFJLENBQUMsa0VBQWtFLEVBQUUsT0FBTztJQUM5RW9HO0VBQ0YsQ0FBQyxLQUFLO0lBQ0osTUFBTUEsSUFBSSxDQUFDK2QsZUFBZSxDQUFDO01BQUVDLEtBQUssRUFBRSxHQUFHO01BQUVDLE1BQU0sRUFBRTtJQUFJLENBQUMsQ0FBQztJQUN2RCxNQUFNM2IsT0FBTyxHQUFHLE1BQU0rRixzQkFBc0IsQ0FBQ3JJLElBQUksQ0FBQztJQUNsRCxNQUFNd0Isa0JBQWtCLENBQUN4QixJQUFJLEVBQUU7TUFBRWtDLFFBQVEsRUFBRUk7SUFBUSxDQUFDLENBQUM7SUFDckQsTUFBTXdMLGtCQUFrQixDQUFDOU4sSUFBSSxDQUFDO0lBQzlCLE1BQU1BLElBQUksQ0FBQ2dPLElBQUksQ0FBQyxHQUFHN1QsY0FBYyxJQUFJLENBQUM7SUFFdEMsTUFBTXNqQixRQUFRLEdBQUd6ZCxJQUFJLENBQUNzWSxPQUFPLENBQUMsVUFBVSxDQUFDLENBQUN2QixLQUFLLENBQUMsQ0FBQztJQUNqRCxNQUFNcGQsTUFBTSxDQUFDOGpCLFFBQVEsQ0FBQyxDQUFDNWMsV0FBVyxDQUFDLENBQUM7SUFDcEMsTUFBTW9oQixVQUFVLEdBQUcsTUFBTXhFLFFBQVEsQ0FBQ3lFLFdBQVcsQ0FBQyxDQUFDO0lBQy9Ddm9CLE1BQU0sQ0FBQ3NvQixVQUFVLGFBQVZBLFVBQVUsdUJBQVZBLFVBQVUsQ0FBRWpFLEtBQUssQ0FBQyxDQUFDbUUsZUFBZSxDQUFDLEdBQUcsQ0FBQztJQUU5QyxNQUFNbmlCLElBQUksQ0FBQ1csU0FBUyxDQUFDLFFBQVEsRUFBRTtNQUFFQyxJQUFJLEVBQUU7SUFBZ0IsQ0FBQyxDQUFDLENBQUNrTyxLQUFLLENBQUMsQ0FBQztJQUNqRSxNQUFNblYsTUFBTSxDQUFDcUcsSUFBSSxDQUFDYyxTQUFTLENBQUMsVUFBVSxFQUFFO01BQUVDLEtBQUssRUFBRTtJQUFLLENBQUMsQ0FBQyxDQUFDLENBQUNGLFdBQVcsQ0FBQyxDQUFDO0lBQ3ZFLE1BQU11aEIsTUFBTSxHQUFHcGlCLElBQUksQ0FDaEJjLFNBQVMsQ0FBQyxVQUFVLEVBQUU7TUFBRUMsS0FBSyxFQUFFO0lBQUssQ0FBQyxDQUFDLENBQ3RDdVgsT0FBTyxDQUFDLElBQUksQ0FBQyxDQUNiQSxPQUFPLENBQUMsSUFBSSxDQUFDO0lBQ2hCLE1BQU0rSixTQUFTLEdBQUcsTUFBTUQsTUFBTSxDQUFDRixXQUFXLENBQUMsQ0FBQztJQUM1Q3ZvQixNQUFNLENBQUMwb0IsU0FBUyxhQUFUQSxTQUFTLHVCQUFUQSxTQUFTLENBQUVyRSxLQUFLLENBQUMsQ0FBQ3ZkLG1CQUFtQixDQUFDLEdBQUcsQ0FBQztJQUNqRCxNQUFNNmhCLFVBQVUsR0FBRyxNQUFNN0UsUUFBUSxDQUFDeUUsV0FBVyxDQUFDLENBQUM7SUFDL0N2b0IsTUFBTSxDQUFDMm9CLFVBQVUsYUFBVkEsVUFBVSx1QkFBVkEsVUFBVSxDQUFFdEUsS0FBSyxDQUFDLENBQUNtRSxlQUFlLENBQUMsR0FBRyxDQUFDO0lBRTlDLE1BQU1uaUIsSUFBSSxDQUFDVyxTQUFTLENBQUMsUUFBUSxFQUFFO01BQUVDLElBQUksRUFBRTtJQUFnQixDQUFDLENBQUMsQ0FBQ2tPLEtBQUssQ0FBQyxDQUFDO0lBQ2pFLE1BQU1uVixNQUFNLENBQ1ZxRyxJQUFJLENBQUNXLFNBQVMsQ0FBQyxRQUFRLEVBQUU7TUFBRUMsSUFBSSxFQUFFO0lBQWdCLENBQUMsQ0FDcEQsQ0FBQyxDQUFDQyxXQUFXLENBQUMsQ0FBQztJQUNmLE1BQU1kLDBCQUEwQixDQUFDQyxJQUFJLENBQUM7RUFDeEMsQ0FBQyxDQUFDO0VBRUZwRyxJQUFJLENBQUMsMENBQTBDLEVBQUUsT0FBTztJQUFFb0c7RUFBSyxDQUFDLEtBQUs7SUFDbkUsTUFBTUEsSUFBSSxDQUFDMEIsS0FBSyxDQUFDLGtCQUFrQixFQUFHQSxLQUFLLElBQ3pDQSxLQUFLLENBQUNpQixPQUFPLENBQ1hsRCxZQUFZLENBQUM7TUFBRTBGLEtBQUssRUFBRTtJQUE4QixDQUFDLEVBQUUsR0FBRyxDQUM1RCxDQUNGLENBQUM7SUFDRCxNQUFNMkksa0JBQWtCLENBQUM5TixJQUFJLENBQUM7SUFDOUIsTUFBTXJHLE1BQU0sQ0FDVnFHLElBQUksQ0FBQ1csU0FBUyxDQUFDLFNBQVMsRUFBRTtNQUFFQyxJQUFJLEVBQUU7SUFBMkIsQ0FBQyxDQUNoRSxDQUFDLENBQUNDLFdBQVcsQ0FBQyxDQUFDO0lBQ2YsTUFBTWxILE1BQU0sQ0FDVnFHLElBQUksQ0FBQ1csU0FBUyxDQUFDLFFBQVEsRUFBRTtNQUFFQyxJQUFJLEVBQUU7SUFBbUIsQ0FBQyxDQUN2RCxDQUFDLENBQUNDLFdBQVcsQ0FBQyxDQUFDO0VBQ2pCLENBQUMsQ0FBQztBQUNKLENBQUMsQ0FBQyIsImlnbm9yZUxpc3QiOltdfQ==