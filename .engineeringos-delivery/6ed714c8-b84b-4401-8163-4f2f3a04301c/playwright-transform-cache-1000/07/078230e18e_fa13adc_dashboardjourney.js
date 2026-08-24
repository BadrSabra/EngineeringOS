// ce49f3238e14a4990ee4d4d9adfdf2041dca1be9
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
function liveTimeoutMs() {
  const configured = Number(process.env.DASHBOARD_E2E_LIVE_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_LIVE_TIMEOUT_MS;
}
function approvedDashboardOrigins() {
  var _process$env$DASHBOAR2;
  const origins = ((_process$env$DASHBOAR2 = process.env.DASHBOARD_E2E_APPROVED_ORIGINS) !== null && _process$env$DASHBOAR2 !== void 0 ? _process$env$DASHBOAR2 : "").split(",").map(origin => origin.trim()).filter(Boolean);
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
async function installApiFixtures(page, overrides) {
  await page.route("**/api/**", async route => {
    var _overrides$deliveryRe, _overrides$auditExpor2, _overrides$auditExpor3;
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
    const streamFixture = disconnectAi !== null && disconnectAi !== void 0 ? disconnectAi : arabicAi;
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
    var _process$env$DASHBOAR3, _execution$operationI, _execution$flightStat, _gitLog$commits$0$sho, _gitLog$commits, _gitLog$commits2, _process$env$DASHBOAR4;
    // The Playwright deadline must leave room for the provider-bound request
    // and polling loop to consume their complete configured budget.
    test.setTimeout(liveTimeoutMs() + LIVE_TEST_TIMEOUT_MARGIN_MS);
    test.skip(process.env.DASHBOARD_E2E_LIVE_PROVIDER !== "1", "Live-provider release journey is opt-in.");
    if (process.env.DASHBOARD_E2E_LIVE_DISPOSABLE !== "1") {
      throw new Error("Live-provider journey requires DASHBOARD_E2E_LIVE_DISPOSABLE=1 and a disposable project.");
    }
    const projectId = process.env.DASHBOARD_E2E_LIVE_PROJECT_ID;
    if (!projectId) throw new Error("DASHBOARD_E2E_LIVE_PROJECT_ID is required for the live-provider journey.");
    await programmaticSignIn(page);
    const streamResponse = await liveRequest(page, "/api/ai/chat/stream", {
      method: "POST",
      timeout: liveTimeoutMs(),
      body: {
        projectId,
        message: (_process$env$DASHBOAR3 = process.env.DASHBOARD_E2E_LIVE_PROMPT) !== null && _process$env$DASHBOAR3 !== void 0 ? _process$env$DASHBOAR3 : DEFAULT_LIVE_PROMPT,
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
    const evidenceCount = recentSteps.reduce((count, step) => count + (Number(step === null || step === void 0 ? void 0 : step.acceptedEvidenceCount) || 0), 0);
    const terminalState = String((_execution$flightStat = execution.flightState) !== null && _execution$flightStat !== void 0 ? _execution$flightStat : execution.status).toUpperCase();
    const successStates = new Set(["COMPLETED", "READY_FOR_REVIEW", "APPLIED", "COMMITTED", "PUSHED"]);
    if (successStates.has(terminalState) && (evidenceCount < 1 || validation.length < 1)) {
      throw new Error(`Live-provider mission reported ${terminalState} without accepted evidence and validation ` + `(evidence=${evidenceCount}, validation=${validation.length}).`);
    }
    const capture = {
      projectId,
      sessionId,
      operationId: execution.operationId,
      workspaceRevision: (_gitLog$commits$0$sho = (_gitLog$commits = gitLog.commits) === null || _gitLog$commits === void 0 || (_gitLog$commits = _gitLog$commits[0]) === null || _gitLog$commits === void 0 ? void 0 : _gitLog$commits.shortHash) !== null && _gitLog$commits$0$sho !== void 0 ? _gitLog$commits$0$sho : (_gitLog$commits2 = gitLog.commits) === null || _gitLog$commits2 === void 0 || (_gitLog$commits2 = _gitLog$commits2[0]) === null || _gitLog$commits2 === void 0 || (_gitLog$commits2 = _gitLog$commits2.hash) === null || _gitLog$commits2 === void 0 ? void 0 : _gitLog$commits2.slice(0, 12),
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
        var _step$validation$stat, _step$validation, _step$validation$prof, _step$validation2;
        return {
          status: (_step$validation$stat = (_step$validation = step.validation) === null || _step$validation === void 0 ? void 0 : _step$validation.status) !== null && _step$validation$stat !== void 0 ? _step$validation$stat : step.status,
          profile: (_step$validation$prof = (_step$validation2 = step.validation) === null || _step$validation2 === void 0 ? void 0 : _step$validation2.profile) !== null && _step$validation$prof !== void 0 ? _step$validation$prof : step.validationProfile
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
    const outputPath = (_process$env$DASHBOAR4 = process.env.DASHBOARD_E2E_LIVE_REPORT_PATH) !== null && _process$env$DASHBOAR4 !== void 0 ? _process$env$DASHBOAR4 : "test-results/dashboard-journey/live-mission-correlation.json";
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
    await expect(page.getByText("Showing 1–1 of 1", {
      exact: true
    })).toBeVisible();
    await expect(page.getByRole("button", {
      name: "Older"
    })).toBeDisabled();
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
    var _process$env$DASHBOAR5;
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
    }, (_process$env$DASHBOAR5 = process.env.DASHBOARD_E2E_API_BASE_URL) !== null && _process$env$DASHBOAR5 !== void 0 ? _process$env$DASHBOAR5 : page.url());
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
    expect(visibleText).toContain("The required analysis did not complete.");
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
    await page.locator("summary").filter({
      hasText: "Persisted execution proof"
    }).last().click();
    await expect(page.getByText("required tool failed — operation blocked", {
      exact: true
    }).last()).toBeVisible();
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
    await page.locator("summary").filter({
      hasText: "Persisted execution proof"
    }).last().click();
    await expect(page.getByText("required tool failed — operation blocked", {
      exact: true
    }).last()).toBeVisible();
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
    await page.locator("summary").filter({
      hasText: "Persisted execution proof"
    }).last().click();
    await expect(page.getByText("required tool failed — operation blocked", {
      exact: true
    }).last()).toBeVisible();
    const visibleText = await page.locator("body").innerText();
    expect(visibleText).not.toContain("COMPLETED");
    expect(visibleText).not.toContain("Persisted execution proof");
    expect(visibleText).toContain("The required analysis did not complete.");
  });
  test("keeps the failed AI session drawer overlaid on a phone viewport", async ({
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
    await page.locator("summary").filter({
      hasText: "Persisted execution proof"
    }).last().click();
    await expect(page.getByText("required tool failed — operation blocked", {
      exact: true
    }).last()).toBeVisible();
    const visibleText = await page.locator("body").innerText();
    expect(visibleText).not.toMatch(/raw exception|stack trace|\/home\/runner|secret|fixture diagnostic/i);
    await page.reload();
    await page.getByRole("button", {
      name: fixture.question,
      exact: true
    }).click();
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
    await page.locator("summary").filter({
      hasText: "Persisted execution proof"
    }).last().click();
    await expect(page.getByText("required tool failed — operation blocked", {
      exact: true
    }).last()).toBeVisible();
    const reloadedText = await page.locator("body").innerText();
    await expectNoHorizontalOverflow(page);
    expect(reloadedText).not.toMatch(/raw exception|stack trace|\/home\/runner|secret|fixture diagnostic/i);
  });
  test("preserves one partial answer after a provider disconnect and marks it incomplete", async ({
    page
  }) => {
    const fixture = await installArabicAiFixture(page);
    await installApiFixtures(page, {
      arabicAi: fixture
    });
    await programmaticSignIn(page);
    await page.goto(`${DASHBOARD_PATH}ai`);
    const composer = page.locator("textarea").first();
    await composer.fill(fixture.question);
    await composer.locator("xpath=..").getByRole("button").click();
    const answer = page.getByText(fixture.answer, {
      exact: true
    });
    await expect(answer).toHaveCount(1);
    await expect(answer).toBeVisible();
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
    })).toHaveCount(1);
    await expect(page.getByText(fixture.answer, {
      exact: true
    })).toBeVisible();
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
    await page.getByRole("button", {
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJleHBlY3QiLCJ0ZXN0IiwibWtkaXIiLCJ3cml0ZUZpbGUiLCJkaXJuYW1lIiwicGFyc2VDbGVya1NpZ25JblRva2VuUmVzcG9uc2UiLCJwYXJzZUNsZXJrVXNlckxvb2t1cFJlc3BvbnNlIiwicGFyc2VDcmVhdGVkQ2xlcmtVc2VyUmVzcG9uc2UiLCJEQVNIQk9BUkRfUEFUSCIsIlRFU1RfVVNFUiIsImZpcnN0TmFtZSIsImxhc3ROYW1lIiwiZW1haWwiLCJfcHJvY2VzcyRlbnYkREFTSEJPQVIiLCJwcm9jZXNzIiwiZW52IiwiREFTSEJPQVJEX0UyRV9FTUFJTCIsIkVYRUNVVElPTl9JRCIsIkRFRkFVTFRfTElWRV9USU1FT1VUX01TIiwiTElWRV9URVNUX1RJTUVPVVRfTUFSR0lOX01TIiwiSE9TVElMRV9PUklHSU4iLCJPUklHSU5fRElBR05PU1RJQ19IRUFERVJTIiwiREVGQVVMVF9MSVZFX1BST01QVCIsImxpdmVUaW1lb3V0TXMiLCJjb25maWd1cmVkIiwiTnVtYmVyIiwiREFTSEJPQVJEX0UyRV9MSVZFX1RJTUVPVVRfTVMiLCJpc0Zpbml0ZSIsImFwcHJvdmVkRGFzaGJvYXJkT3JpZ2lucyIsIl9wcm9jZXNzJGVudiREQVNIQk9BUjIiLCJvcmlnaW5zIiwiREFTSEJPQVJEX0UyRV9BUFBST1ZFRF9PUklHSU5TIiwic3BsaXQiLCJtYXAiLCJvcmlnaW4iLCJ0cmltIiwiZmlsdGVyIiwiQm9vbGVhbiIsImxlbmd0aCIsIkVycm9yIiwicGFyc2VkIiwiVVJMIiwicGF0aG5hbWUiLCJzZWFyY2giLCJoYXNoIiwiZGFzaGJvYXJkRml4dHVyZSIsInByb2plY3RDb3VudCIsImFjdGl2ZVRhc2tDb3VudCIsImNvbXBsZXRlZFRhc2tDb3VudCIsImZhaWxlZFRhc2tDb3VudCIsInRhc2tTdGF0dXNCcmVha2Rvd24iLCJwZW5kaW5nIiwicnVubmluZyIsInByb2plY3RTY29yZXMiLCJwcm9qZWN0SWQiLCJwcm9qZWN0TmFtZSIsInNjb3JlIiwidHJlbmQiLCJyZWNlbnRFdmVudHMiLCJpZCIsInR5cGUiLCJzZXZlcml0eSIsIm1lc3NhZ2UiLCJ0aW1lc3RhbXAiLCJ0b3BSdWxlcyIsImV4ZWN1dGlvbkZpeHR1cmUiLCJvcGVyYXRpb25JZCIsInN0YXR1cyIsImZsaWdodFN0YXRlIiwiZXZpZGVuY2VWZXJkaWN0IiwicHJvb2ZSZXF1aXJlZCIsInJlc3VtYWJsZSIsImNoZWNrcG9pbnRWZXJzaW9uIiwicHJvamVjdFJldmlzaW9uIiwiY2hlY2twb2ludCIsInN0YWdlIiwiZGV0YWlsIiwib2JqZWN0aXZlIiwic3RhcnRlZEF0IiwiY29tcGxldGVkQXQiLCJjcmVhdGVkQXQiLCJ1cGRhdGVkQXQiLCJqc29uUmVzcG9uc2UiLCJib2R5IiwiaGVhZGVycyIsImNvbnRlbnRUeXBlIiwiSlNPTiIsInN0cmluZ2lmeSIsImV4cGVjdE5vSG9yaXpvbnRhbE92ZXJmbG93IiwicGFnZSIsIm92ZXJmbG93IiwiZXZhbHVhdGUiLCJkb2N1bWVudCIsImRvY3VtZW50RWxlbWVudCIsInNjcm9sbFdpZHRoIiwidmlld3BvcnQiLCJ3aW5kb3ciLCJpbm5lcldpZHRoIiwidG9CZUxlc3NUaGFuT3JFcXVhbCIsImluc3RhbGxBcGlGaXh0dXJlcyIsIm92ZXJyaWRlcyIsInJvdXRlIiwiX292ZXJyaWRlcyRkZWxpdmVyeVJlIiwiX292ZXJyaWRlcyRhdWRpdEV4cG9yMiIsIl9vdmVycmlkZXMkYXVkaXRFeHBvcjMiLCJ1cmwiLCJyZXF1ZXN0IiwicGF0aCIsInJlcGxhY2UiLCJhcmFiaWNBaSIsImFsdGVybmF0ZUFpIiwiZGlzY29ubmVjdEFpIiwiYWlGaXh0dXJlcyIsImZpeHR1cmUiLCJlbmRzV2l0aCIsInNlYXJjaFBhcmFtcyIsImdldCIsInByb2plY3RTZXNzaW9ucyIsImZ1bGZpbGwiLCJzZXNzaW9uSWQiLCJ0aXRsZSIsInF1ZXN0aW9uIiwicmVzdW1lRmFpbHVyZSIsInJlcXVlc3RCb2R5IiwicG9zdERhdGFKU09OIiwiZXhlY3V0aW9uSWQiLCJzdHJlYW1Cb2R5IiwiaW50ZXJydXB0ZWRSZXN1bWUiLCJyZXN1bWVkU3RyZWFtQm9keSIsInN0cmVhbUZpeHR1cmUiLCJtZXNzYWdlRml4dHVyZSIsImZpbmQiLCJyb2xlIiwiY29udGVudCIsImF1ZGl0RXhwb3J0IiwiX292ZXJyaWRlcyRhdWRpdEV4cG9yIiwib3V0Y29tZSIsIm1lc3NhZ2VPdXRjb21lIiwicmVxdWVzdHMiLCJwdXNoIiwiZmFpbEZpcnN0UHJldmlldyIsImVycm9yIiwiZmlsZW5hbWUiLCJhcmNoaXZlVXBsb2FkIiwiX3JvdXRlJHJlcXVlc3QkaGVhZGVyIiwic3RhcnRzV2l0aCIsInBvc3REYXRhQnVmZmVyIiwiaW5jbHVkZXMiLCJCdWZmZXIiLCJmcm9tIiwidXBsb2FkSWQiLCJvcmlnaW5hbE5hbWUiLCJsaXZlVGFzayIsImRlc2NyaXB0aW9uIiwicGhhc2UiLCJyZWxhdGVkRmlsZXMiLCJyZXRyeUNvdW50IiwibWF4UmV0cmllcyIsIl9vdmVycmlkZXMkbGl2ZVRhc2skaSIsImluaXRpYWxMb2dzIiwic3RyZWFtUmVxdWVzdHMiLCJmYWlsRmlyc3RTdHJlYW0iLCJmYWlsU3RyZWFtQXR0ZW1wdHMiLCJhYm9ydCIsImxvZyIsIl9vdmVycmlkZXMkcHJvamVjdHMiLCJwcm9qZWN0cyIsIm5hbWUiLCJsYW5ndWFnZSIsImZyYW1ld29yayIsInJvb3RQYXRoIiwicXVhbGl0eVNjb3JlIiwiZGVsaXZlcnlSZWNvdmVyeSIsIm9wZXJhdGlvbnMiLCJyZWNvdmVyeUFjdGlvbiIsInByb3Bvc2FsSWQiLCJhY3Rpb24iLCJfb3ZlcnJpZGVzJGRlbGl2ZXJ5UmUyIiwiX292ZXJyaWRlcyRkZWxpdmVyeVJlMyIsImFjdGlvblJlcXVlc3RzIiwibmV4dE9wZXJhdGlvbnMiLCJyZXNwb25zZSIsIl9vdmVycmlkZXMkZXZlbnRzIiwiX3VybCRzZWFyY2hQYXJhbXMkZ2V0IiwiZXZlbnRzIiwidG9Mb3dlckNhc2UiLCJmaWx0ZXJlZEV2ZW50cyIsImV2ZW50IiwiY29ycmVsYXRpb25JZCIsInZhbHVlIiwic29tZSIsImxpbWl0Iiwic2xpY2UiLCJ0b3RhbCIsImV4ZWN1dGlvbiIsInJlc3VtZVRva2VuIiwicmVjb3ZlcmVkVG9rZW4iLCJleGVjdXRpb25zIiwiY29udGludWUiLCJpbnN0YWxsQXJhYmljQWlGaXh0dXJlIiwib3B0aW9ucyIsIl9vcHRpb25zJHNlc3Npb25JZCIsIl9vcHRpb25zJHF1ZXN0aW9uIiwibWVzc2FnZUlkIiwic291cmNlIiwiYmxvY2tlZCIsImFuc3dlciIsImV2aWRlbmNlIiwiZXhjZXJwdCIsInN1cHBvcnRzQ2xhaW0iLCJldmlkZW5jZUNsYXNzIiwiY2l0YXRpb25TdGF0dXMiLCJjaXRhdGlvblJlYXNvbiIsInNvdXJjZVNwYW4iLCJzdGFydExpbmUiLCJlbmRMaW5lIiwidG9vbFRyYWNlIiwia2luZCIsInRvb2wiLCJhcmdzIiwiY2FjaGVkIiwicHJlZmV0Y2hlZCIsImNvZGUiLCJjb25zaXN0ZW50IiwidmlvbGF0aW9ucyIsImV2aWRlbmNlRmlsZUNvdW50IiwiYWNjZXB0ZWRFdmlkZW5jZUNvdW50IiwiY29tcGxldGVkUmVhZEZpbGVzIiwiYWNjZXB0ZWRFdmlkZW5jZUZpbGVzIiwib2JqZWN0aXZlVHlwZSIsInJlcXVpcmVkRWRnZXMiLCJwcm92ZW5FZGdlcyIsImNvbXBsZXRpb25HYXRlUmVzdWx0IiwiZmluYWxBbnN3ZXJUeXBlIiwidGFza1Jlc3VsdCIsImNvbmZpZGVuY2UiLCJzb3VyY2VTY29wZSIsImNvdmVyYWdlIiwicmVxdWVzdGVkRmllbGRzIiwiYW5zd2VyZWRGaWVsZHMiLCJtaXNzaW5nRmllbGRzIiwiY29tcGxldGUiLCJvcGVyYXRpb25Nb2RlIiwic291cmNlcyIsImJlaGF2aW9yRXZpZGVuY2UiLCJzc2UiLCJkZWx0YSIsInBlbmRpbmdDaGFuZ2VzIiwiam9pbiIsImluc3RhbGxUb29sRmFpbHVyZUZpeHR1cmUiLCJkaWFnbm9zdGljQ29kZSIsInJlc3VsdEtpbmQiLCJyZXN1bHRTdW1tYXJ5Iiwic3RvcFJlYXNvbiIsIml0ZXJhdGlvbnMiLCJtYXhJdGVyYXRpb25zIiwidG9vbENhbGxzIiwicHJlZmV0Y2hUb29sQ2FsbHMiLCJsb29wVG9vbENhbGxzIiwic3ludGhlc2lzU3RhcnRlZCIsImRpYWdub3N0aWNDb2RlcyIsImluc3RhbGxEaXNjb25uZWN0ZWRBaUZpeHR1cmUiLCJkaWFnbm9zdGljRGV0YWlscyIsImVycm9yQ29kZSIsImVycm9yTWVzc2FnZSIsImluc3RhbGxSZXN1bWVkQW5hbHlzaXNGYWlsdXJlRml4dHVyZSIsImluc3RhbGxJbnRlcnJ1cHRlZFJlc3VtZUZpeHR1cmUiLCJpbml0aWFsVG9rZW4iLCJwYXJ0aWFsQW5zd2VyIiwiY3JlYXRlUmVsZWFzZVNpZ25JblVybCIsInNlY3JldEtleSIsIkNMRVJLX1NFQ1JFVF9LRVkiLCJBdXRob3JpemF0aW9uIiwidXNlclJlc3BvbnNlIiwiZW5jb2RlVVJJQ29tcG9uZW50IiwidXNlcklkIiwianNvbiIsImNyZWF0ZWRSZXNwb25zZSIsInBvc3QiLCJkYXRhIiwiZW1haWxfYWRkcmVzcyIsImZpcnN0X25hbWUiLCJsYXN0X25hbWUiLCJza2lwX3Bhc3N3b3JkX2NoZWNrcyIsInNraXBfcGFzc3dvcmRfcmVxdWlyZW1lbnQiLCJ0b2tlblJlc3BvbnNlIiwidXNlcl9pZCIsInRva2VuIiwidG9TdHJpbmciLCJwcm9ncmFtbWF0aWNTaWduSW4iLCJfZ2xvYmFsVGhpcyRzaWduSW5DbGUiLCJnb3RvIiwiZ2V0QnlSb2xlIiwiZXhhY3QiLCJ0b0JlVmlzaWJsZSIsImhlbHBlciIsImdsb2JhbFRoaXMiLCJzaWduSW5DbGVya1VzZXIiLCJfX0VOR0lORUVSSU5HT1NfU0lHTl9JTl9DTEVSS19VU0VSX18iLCJSVU5fQ09OVFJPTExFRF9SRUxFQVNFX1ZBTElEQVRJT04iLCJ0b0hhdmVVUkwiLCJSZWdFeHAiLCJyZXBsYWNlQWxsIiwic2lnbkluVXJsIiwidHRsIiwiYmFzZVBhdGgiLCJvcGVuTmF2aWdhdGlvbiIsImxhYmVsIiwiY2xpY2siLCJhcGlVcmwiLCJhcGlCYXNlVXJsIiwiREFTSEJPQVJEX0UyRV9BUElfQkFTRV9VUkwiLCJsaXZlUmVxdWVzdCIsIl9vcHRpb25zJG1ldGhvZCIsIm1ldGhvZCIsInRpbWVvdXQiLCJmZXRjaCIsImNyZWRlbnRpYWxzIiwidW5kZWZpbmVkIiwic2lnbmFsIiwiQWJvcnRTaWduYWwiLCJ0ZXh0IiwicmVjb3JkZWRPcmlnaW5EaWFnbm9zdGljcyIsIm9yaWdpbkRpYWdub3N0aWNQYXRoIiwiREFTSEJPQVJEX0UyRV9PUklHSU5fRElBR05PU1RJQ1NfUEFUSCIsInJlbGV2YW50T3JpZ2luSGVhZGVycyIsIk9iamVjdCIsImZyb21FbnRyaWVzIiwiZmxhdE1hcCIsIndyaXRlT3JpZ2luRGlhZ25vc3RpY3MiLCJvdXRwdXRQYXRoIiwicmVjdXJzaXZlIiwiZGlhZ25vc3RpY3MiLCJleHBlY3RPcmlnaW5DYW5Vc2VBcGkiLCJoZWFsdGhVcmwiLCJtdXRhdGlvblVybCIsImNvbW1vbkhlYWRlcnMiLCJPcmlnaW4iLCJjaGVjayIsImFzc2VydGlvbiIsImF0IiwiY3VycmVudCIsInRvQmUiLCJfcmVzcG9uc2UkaGVhZGVycyRhY2MiLCJfcmVzcG9uc2UkaGVhZGVycyRhY2MyIiwidG9VcHBlckNhc2UiLCJ0b0NvbnRhaW4iLCJoZWFkZXIiLCJub3QiLCJleHBlY3RIb3N0aWxlT3JpZ2luUmVqZWN0ZWQiLCJ1cGxvYWRVcmwiLCJsaXZlVXBkYXRlVXJsIiwiZGlhZ25vc3RpYyIsInRvQmVVbmRlZmluZWQiLCJob3N0aWxlVXBsb2FkIiwibXVsdGlwYXJ0IiwiYXJjaGl2ZSIsIm1pbWVUeXBlIiwiYnVmZmVyIiwiaG9zdGlsZUxpdmVVcGRhdGUiLCJwYXJzZVNzZSIsImNodW5rIiwiX2NodW5rJHNwbGl0JGZpbmQiLCJsaW5lIiwicGFyc2UiLCJsaXZlSnNvbiIsImxpdmVBcnJheSIsIkFycmF5IiwiaXNBcnJheSIsImxpdmVPcHRpb25hbFJlY29yZCIsImRlc2NyaWJlIiwiX3Byb2Nlc3MkZW52JERBU0hCT0FSMyIsIl9leGVjdXRpb24kb3BlcmF0aW9uSSIsIl9leGVjdXRpb24kZmxpZ2h0U3RhdCIsIl9naXRMb2ckY29tbWl0cyQwJHNobyIsIl9naXRMb2ckY29tbWl0cyIsIl9naXRMb2ckY29tbWl0czIiLCJfcHJvY2VzcyRlbnYkREFTSEJPQVI0Iiwic2V0VGltZW91dCIsInNraXAiLCJEQVNIQk9BUkRfRTJFX0xJVkVfUFJPVklERVIiLCJEQVNIQk9BUkRfRTJFX0xJVkVfRElTUE9TQUJMRSIsIkRBU0hCT0FSRF9FMkVfTElWRV9QUk9KRUNUX0lEIiwic3RyZWFtUmVzcG9uc2UiLCJEQVNIQk9BUkRfRTJFX0xJVkVfUFJPTVBUIiwiaWRlbXBvdGVuY3lLZXkiLCJEYXRlIiwibm93Iiwic3NlRXZlbnRzIiwic3RhcnRlZCIsImRlYWRsaW5lIiwiU3RyaW5nIiwiUHJvbWlzZSIsInJlc29sdmUiLCJtZXNzYWdlcyIsInByb3Bvc2FsIiwiZ2l0TG9nIiwibWlzc2lvbkNvbnRyb2wiLCJkYXNoYm9hcmRTdGF0ZSIsInJlY2VudFN0ZXBzIiwidmFsaWRhdGlvbiIsInN0ZXAiLCJldmlkZW5jZUNvdW50IiwicmVkdWNlIiwiY291bnQiLCJ0ZXJtaW5hbFN0YXRlIiwic3VjY2Vzc1N0YXRlcyIsIlNldCIsImhhcyIsImNhcHR1cmUiLCJ3b3Jrc3BhY2VSZXZpc2lvbiIsImNvbW1pdHMiLCJzaG9ydEhhc2giLCJtZXNzYWdlU2Vzc2lvbiIsIm1lc3NhZ2VFeGVjdXRpb24iLCJldmVudEV4ZWN1dGlvbiIsImV2ZW50U2Vzc2lvbiIsImNoZWNrcG9pbnRzIiwic2VxdWVuY2UiLCJwcm9wb3NhbHMiLCJyZXZpc2lvbiIsIl9zdGVwJHZhbGlkYXRpb24kc3RhdCIsIl9zdGVwJHZhbGlkYXRpb24iLCJfc3RlcCR2YWxpZGF0aW9uJHByb2YiLCJfc3RlcCR2YWxpZGF0aW9uMiIsInByb2ZpbGUiLCJ2YWxpZGF0aW9uUHJvZmlsZSIsImRhc2hib2FyZCIsIkRBU0hCT0FSRF9FMkVfTElWRV9SRVBPUlRfUEFUSCIsImdldEJ5VGV4dCIsImZpcnN0IiwidG9CZURpc2FibGVkIiwiYXVkaXRSZXF1ZXN0cyIsImF1ZGl0Qm9keSIsImZvcm1hdCIsImV4cG9ydGVkQXQiLCJwcm9vZiIsInJlcXVpcmVkIiwidmVyZGljdCIsInRpbWVsaW5lIiwidmFsaWRhdGlvbnMiLCJhZmZlY3RlZEZpbGVzIiwicmVkYWN0aW9uIiwiZXhjbHVkZWQiLCJsb2NhbFN0b3JhZ2UiLCJzZXRJdGVtIiwiZ2V0QnlMYWJlbCIsInRvQ29udGFpblRleHQiLCJwcmV2aWV3IiwidG9IYXZlTGVuZ3RoIiwidG9CZUhpZGRlbiIsImRvd25sb2FkUHJvbWlzZSIsIndhaXRGb3JFdmVudCIsImRvd25sb2FkIiwic3VnZ2VzdGVkRmlsZW5hbWUiLCJyZWxvYWQiLCJyZWxvYWRlZFByb29mIiwiY2FuY2VsbGVkRXhlY3V0aW9uIiwidGVybWluYWxSZWFzb24iLCJ0b0hhdmVDb3VudCIsIl9wcm9jZXNzJGVudiREQVNIQk9BUjUiLCJ0YXNrSWQiLCJsaXZlTG9nIiwibGV2ZWwiLCJ1cGxvYWRSZXN1bHQiLCJieXRlcyIsIlVpbnQ4QXJyYXkiLCJhdG9iIiwiY2hhcmFjdGVyIiwiY2hhckNvZGVBdCIsIkZvcm1EYXRhIiwiYXBwZW5kIiwiQmxvYiIsInRvRXF1YWwiLCJ0YXNrUm93IiwibWV0YWRhdGEiLCJhY3Rpdml0eSIsInBvbGwiLCJsb2NhdG9yIiwiaGFzVGV4dCIsIm5vblN0cmVhbVJlcXVlc3RzIiwib24iLCJleGhhdXN0ZWQiLCJzaXplIiwiXyIsImluZGV4IiwiVVRDIiwidG9JU09TdHJpbmciLCJldmVudFJlcXVlc3RzIiwiZmlyc3RSZXF1ZXN0IiwiYWxsIiwid2FpdEZvclJlcXVlc3QiLCJnZXRCeVBsYWNlaG9sZGVyIiwiZmlsbCIsIm50aCIsInNlbGVjdE9wdGlvbiIsInRvSGF2ZVZhbHVlIiwiZmlsdGVyZWRSZXF1ZXN0IiwiY29tcG9zZXIiLCJzZW5kQnV0dG9uIiwidG9CZUVuYWJsZWQiLCJzdHJlYW1SZXNwb25zZVByb21pc2UiLCJ3YWl0Rm9yUmVzcG9uc2UiLCJsYXN0IiwidmlzaWJsZVRleHQiLCJpbm5lclRleHQiLCJzZXRWaWV3cG9ydFNpemUiLCJ3aWR0aCIsImhlaWdodCIsInRvTWF0Y2giLCJhY2NlcHRlZCIsImFzc2VydEFjY2VwdGVkQ2l0YXRpb24iLCJhc3NlcnRCbG9ja2VkQ2l0YXRpb24iLCJhc3NlcnROb0ludGVybmFsQ2l0YXRpb25EZXRhaWxzIiwiZ29CYWNrIiwiZ29Gb3J3YXJkIiwicmVsb2FkZWRUZXh0IiwiX2F3YWl0JHJlc3VtZVJlcXVlc3QkIiwicmVzdW1lUmVxdWVzdCIsInBvc3REYXRhIiwib2JqZWN0Q29udGFpbmluZyIsIl9zdHJlYW1SZXF1ZXN0cyQiLCJfc3RyZWFtUmVxdWVzdHMkMiIsInJlY292ZXJ5IiwiYWRkSW5pdFNjcmlwdCIsIm5hdGl2ZUZldGNoIiwiYmluZCIsImlucHV0IiwiaW5pdCIsIlJlcXVlc3QiLCJyZWFkZXIiLCJnZXRSZWFkZXIiLCJlbmNvZGVyIiwiVGV4dEVuY29kZXIiLCJzdHJlYW0iLCJSZWFkYWJsZVN0cmVhbSIsInN0YXJ0IiwiY29udHJvbGxlciIsImJ1ZmZlcmVkIiwiZG9uZSIsInJlYWQiLCJlbnF1ZXVlIiwiZW5jb2RlIiwiY2xvc2UiLCJUZXh0RGVjb2RlciIsImRlY29kZSIsIm1hcmtlciIsImluZGV4T2YiLCJmcmFtZUVuZCIsIlR5cGVFcnJvciIsIlJlc3BvbnNlIiwic3RhdHVzVGV4dCIsInN0b3JhZ2VLZXkiLCJwb2ludGVyS2V5Iiwia2V5IiwiZ2V0SXRlbSIsIl9sb2NhbFN0b3JhZ2UkZ2V0SXRlbSIsInNhdmVkIiwiX2xvY2FsU3RvcmFnZSRnZXRJdGVtMiIsImxpZmVjeWNsZSIsInJlY292ZXJ5U3RhdGUiLCJvcGVyYXRvckV4cGxhbmF0aW9uIiwibmV4dEFjdGlvbiIsImNvbmZsaWN0UmVhc29uIiwidmFsaWRhdGlvbkV2aWRlbmNlIiwid29ya3NwYWNlQXZhaWxhYmxlIiwiY2hhbmdlQ291bnQiLCJyZWdpb24iLCJhdmFpbGFibGUiLCJtaXNzaW5nIiwiZGlzY2FyZGVkIiwidG9IYXZlQXR0cmlidXRlIiwicmVsb2FkZWRSZWdpb24iLCJ0b0JlR3JlYXRlclRoYW5PckVxdWFsIiwiZXZlcnkiLCJvcGVyYXRpb24iLCJiZWZvcmVPcGVuIiwiYm91bmRpbmdCb3giLCJ0b0JlR3JlYXRlclRoYW4iLCJkcmF3ZXIiLCJkcmF3ZXJCb3giLCJkdXJpbmdPcGVuIl0sInNvdXJjZXMiOlsiZGFzaGJvYXJkLmpvdXJuZXkudHMiXSwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgZXhwZWN0LCB0ZXN0LCB0eXBlIFBhZ2UgfSBmcm9tIFwiQHBsYXl3cmlnaHQvdGVzdFwiO1xuaW1wb3J0IHsgbWtkaXIsIHdyaXRlRmlsZSB9IGZyb20gXCJub2RlOmZzL3Byb21pc2VzXCI7XG5pbXBvcnQgeyBkaXJuYW1lIH0gZnJvbSBcIm5vZGU6cGF0aFwiO1xuaW1wb3J0IHtcbiAgcGFyc2VDbGVya1NpZ25JblRva2VuUmVzcG9uc2UsXG4gIHBhcnNlQ2xlcmtVc2VyTG9va3VwUmVzcG9uc2UsXG4gIHBhcnNlQ3JlYXRlZENsZXJrVXNlclJlc3BvbnNlLFxufSBmcm9tIFwiLi4vc3JjL2xpYi9jbGVyay1oYW5kb2ZmXCI7XG5cbmNvbnN0IERBU0hCT0FSRF9QQVRIID0gXCIvZGFzaGJvYXJkL1wiO1xuY29uc3QgVEVTVF9VU0VSID0ge1xuICBmaXJzdE5hbWU6IFwiRW5naW5lZXJpbmdPU1wiLFxuICBsYXN0TmFtZTogXCJEYXNoYm9hcmQgU21va2VcIixcbiAgZW1haWw6XG4gICAgcHJvY2Vzcy5lbnYuREFTSEJPQVJEX0UyRV9FTUFJTCA/P1xuICAgIFwiZW5naW5lZXJpbmdvcy1kYXNoYm9hcmQtc21va2VAZXhhbXBsZS5jb21cIixcbn07XG5jb25zdCBFWEVDVVRJT05fSUQgPSBcImUyZS1jb250cm9sbGVkLWV4ZWN1dGlvblwiO1xuY29uc3QgREVGQVVMVF9MSVZFX1RJTUVPVVRfTVMgPSAxMjBfMDAwO1xuY29uc3QgTElWRV9URVNUX1RJTUVPVVRfTUFSR0lOX01TID0gNV8wMDA7XG5jb25zdCBIT1NUSUxFX09SSUdJTiA9IFwiaHR0cHM6Ly9hdHRhY2tlci5leGFtcGxlXCI7XG5jb25zdCBPUklHSU5fRElBR05PU1RJQ19IRUFERVJTID0gW1xuICBcImFjY2Vzcy1jb250cm9sLWFsbG93LW9yaWdpblwiLFxuICBcImFjY2Vzcy1jb250cm9sLWFsbG93LW1ldGhvZHNcIixcbiAgXCJhY2Nlc3MtY29udHJvbC1hbGxvdy1oZWFkZXJzXCIsXG4gIFwidmFyeVwiLFxuXSBhcyBjb25zdDtcbmNvbnN0IERFRkFVTFRfTElWRV9QUk9NUFQgPVxuICBcIlBlcmZvcm0gYSBib3VuZGVkIGZvcmVuc2ljIGF1ZGl0IG9mIHRoaXMgZGlzcG9zYWJsZSBwcm9qZWN0IHVzaW5nIHJlYWQtb25seSB0b29scy4gXCIgK1xuICBcIlByb2R1Y2UgYXQgbGVhc3Qgb25lIGFjY2VwdGVkIGV2aWRlbmNlIGl0ZW0gYW5kIG9uZSB2YWxpZGF0aW9uIGNoZWNrcG9pbnQsIGFuZCBkbyBub3QgXCIgK1xuICBcInJlcG9ydCBDT01QTEVURUQgdW5sZXNzIGJvdGggYXJlIHByZXNlbnQuIFJlcG9ydCBvbmx5IHZlcmlmaWVkIGV2aWRlbmNlLlwiO1xuXG5mdW5jdGlvbiBsaXZlVGltZW91dE1zKCk6IG51bWJlciB7XG4gIGNvbnN0IGNvbmZpZ3VyZWQgPSBOdW1iZXIocHJvY2Vzcy5lbnYuREFTSEJPQVJEX0UyRV9MSVZFX1RJTUVPVVRfTVMpO1xuICByZXR1cm4gTnVtYmVyLmlzRmluaXRlKGNvbmZpZ3VyZWQpICYmIGNvbmZpZ3VyZWQgPiAwXG4gICAgPyBjb25maWd1cmVkXG4gICAgOiBERUZBVUxUX0xJVkVfVElNRU9VVF9NUztcbn1cblxuZnVuY3Rpb24gYXBwcm92ZWREYXNoYm9hcmRPcmlnaW5zKCk6IHN0cmluZ1tdIHtcbiAgY29uc3Qgb3JpZ2lucyA9IChwcm9jZXNzLmVudi5EQVNIQk9BUkRfRTJFX0FQUFJPVkVEX09SSUdJTlMgPz8gXCJcIilcbiAgICAuc3BsaXQoXCIsXCIpXG4gICAgLm1hcCgob3JpZ2luKSA9PiBvcmlnaW4udHJpbSgpKVxuICAgIC5maWx0ZXIoQm9vbGVhbik7XG4gIGlmIChvcmlnaW5zLmxlbmd0aCA9PT0gMCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgIFwiREFTSEJPQVJEX0UyRV9BUFBST1ZFRF9PUklHSU5TIG11c3QgY29udGFpbiBldmVyeSBhcHByb3ZlZCBkYXNoYm9hcmQgb3JpZ2luLlwiLFxuICAgICk7XG4gIH1cbiAgcmV0dXJuIG9yaWdpbnMubWFwKChvcmlnaW4pID0+IHtcbiAgICBjb25zdCBwYXJzZWQgPSBuZXcgVVJMKG9yaWdpbik7XG4gICAgaWYgKFxuICAgICAgcGFyc2VkLm9yaWdpbiAhPT0gb3JpZ2luIHx8XG4gICAgICBwYXJzZWQucGF0aG5hbWUgIT09IFwiL1wiIHx8XG4gICAgICBwYXJzZWQuc2VhcmNoIHx8XG4gICAgICBwYXJzZWQuaGFzaFxuICAgICkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICBgRGFzaGJvYXJkIGpvdXJuZXkgb3JpZ2luIG11c3QgYmUgYSBiYXJlIG9yaWdpbjogJHtvcmlnaW59YCxcbiAgICAgICk7XG4gICAgfVxuICAgIHJldHVybiBwYXJzZWQub3JpZ2luO1xuICB9KTtcbn1cblxuY29uc3QgZGFzaGJvYXJkRml4dHVyZSA9IHtcbiAgcHJvamVjdENvdW50OiAxLFxuICBhY3RpdmVUYXNrQ291bnQ6IDAsXG4gIGNvbXBsZXRlZFRhc2tDb3VudDogMixcbiAgZmFpbGVkVGFza0NvdW50OiAwLFxuICB0YXNrU3RhdHVzQnJlYWtkb3duOiB7IHBlbmRpbmc6IDAsIHJ1bm5pbmc6IDAgfSxcbiAgcHJvamVjdFNjb3JlczogW1xuICAgIHtcbiAgICAgIHByb2plY3RJZDogXCJlMmUtcHJvamVjdFwiLFxuICAgICAgcHJvamVjdE5hbWU6IFwiU21va2UgUHJvamVjdFwiLFxuICAgICAgc2NvcmU6IDkyLFxuICAgICAgdHJlbmQ6IFwic3RhYmxlXCIsXG4gICAgfSxcbiAgXSxcbiAgcmVjZW50RXZlbnRzOiBbXG4gICAge1xuICAgICAgaWQ6IFwiZTJlLWV2ZW50XCIsXG4gICAgICB0eXBlOiBcIlNtb2tlQ2hlY2tcIixcbiAgICAgIHNldmVyaXR5OiBcInN1Y2Nlc3NcIixcbiAgICAgIG1lc3NhZ2U6IFwiRGFzaGJvYXJkIEFQSSBmaXh0dXJlIHJlYWR5XCIsXG4gICAgICB0aW1lc3RhbXA6IFwiMjAyNi0wMS0wMVQwMDowMDowMC4wMDBaXCIsXG4gICAgfSxcbiAgXSxcbiAgdG9wUnVsZXM6IFtdLFxufTtcblxuY29uc3QgZXhlY3V0aW9uRml4dHVyZSA9IHtcbiAgaWQ6IEVYRUNVVElPTl9JRCxcbiAgcHJvamVjdElkOiBcImUyZS1wcm9qZWN0XCIsXG4gIG9wZXJhdGlvbklkOiBcImUyZS1vcGVyYXRpb25cIixcbiAgc3RhdHVzOiBcImNvbXBsZXRlZFwiLFxuICBmbGlnaHRTdGF0ZTogXCJDT01QTEVURURcIixcbiAgZXZpZGVuY2VWZXJkaWN0OiBcIlBST1ZFTlwiLFxuICBwcm9vZlJlcXVpcmVkOiBmYWxzZSxcbiAgcmVzdW1hYmxlOiBmYWxzZSxcbiAgY2hlY2twb2ludFZlcnNpb246IDEsXG4gIHByb2plY3RSZXZpc2lvbjogXCJlMmUtcmV2aXNpb24tNDJcIixcbiAgY2hlY2twb2ludDoge1xuICAgIHN0YWdlOiBcImNvbXBsZXRlXCIsXG4gICAgZGV0YWlsOiBcIkNvbnRyb2xsZWQgYnJvd3NlciBmaXh0dXJlIGNvbXBsZXRlZC5cIixcbiAgfSxcbiAgb2JqZWN0aXZlOiB7IG9iamVjdGl2ZTogXCJWZXJpZnkgdGhlIGRhc2hib2FyZCBicm93c2VyIGpvdXJuZXlcIiB9LFxuICBzdGFydGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMDowMC4wMDBaXCIsXG4gIGNvbXBsZXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDE6MDAuMDAwWlwiLFxuICBjcmVhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMDowMC4wMDBaXCIsXG4gIHVwZGF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAxOjAwLjAwMFpcIixcbn07XG5cbmZ1bmN0aW9uIGpzb25SZXNwb25zZShcbiAgYm9keTogdW5rbm93bixcbiAgc3RhdHVzID0gMjAwLFxuICBoZWFkZXJzPzogUmVjb3JkPHN0cmluZywgc3RyaW5nPixcbikge1xuICByZXR1cm4ge1xuICAgIHN0YXR1cyxcbiAgICBjb250ZW50VHlwZTogXCJhcHBsaWNhdGlvbi9qc29uXCIsXG4gICAgLi4uKGhlYWRlcnMgPyB7IGhlYWRlcnMgfSA6IHt9KSxcbiAgICBib2R5OiBKU09OLnN0cmluZ2lmeShib2R5KSxcbiAgfTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZXhwZWN0Tm9Ib3Jpem9udGFsT3ZlcmZsb3cocGFnZTogUGFnZSkge1xuICBjb25zdCBvdmVyZmxvdyA9IGF3YWl0IHBhZ2UuZXZhbHVhdGUoKCkgPT4gKHtcbiAgICBkb2N1bWVudDogZG9jdW1lbnQuZG9jdW1lbnRFbGVtZW50LnNjcm9sbFdpZHRoLFxuICAgIGJvZHk6IGRvY3VtZW50LmJvZHkuc2Nyb2xsV2lkdGgsXG4gICAgdmlld3BvcnQ6IHdpbmRvdy5pbm5lcldpZHRoLFxuICB9KSk7XG4gIGV4cGVjdChvdmVyZmxvdy5kb2N1bWVudCkudG9CZUxlc3NUaGFuT3JFcXVhbChvdmVyZmxvdy52aWV3cG9ydCArIDEpO1xuICBleHBlY3Qob3ZlcmZsb3cuYm9keSkudG9CZUxlc3NUaGFuT3JFcXVhbChvdmVyZmxvdy52aWV3cG9ydCArIDEpO1xufVxuXG50eXBlIEFyYWJpY0FpRml4dHVyZSA9IHtcbiAgcXVlc3Rpb246IHN0cmluZztcbiAgYW5zd2VyOiBzdHJpbmc7XG4gIHNvdXJjZTogc3RyaW5nO1xuICBzZXNzaW9uSWQ6IHN0cmluZztcbiAgZXhlY3V0aW9uSWQ/OiBzdHJpbmc7XG4gIHByb2plY3RJZD86IHN0cmluZztcbiAgc3RyZWFtQm9keTogc3RyaW5nO1xuICBtZXNzYWdlOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbn07XG5cbmFzeW5jIGZ1bmN0aW9uIGluc3RhbGxBcGlGaXh0dXJlcyhcbiAgcGFnZTogUGFnZSxcbiAgb3ZlcnJpZGVzPzoge1xuICAgIGFyYWJpY0FpPzogQXJhYmljQWlGaXh0dXJlO1xuICAgIGFsdGVybmF0ZUFpPzogQXJhYmljQWlGaXh0dXJlO1xuICAgIGRpc2Nvbm5lY3RBaT86IEFyYWJpY0FpRml4dHVyZTtcbiAgICByZXN1bWVGYWlsdXJlPzoge1xuICAgICAgZml4dHVyZTogQXJhYmljQWlGaXh0dXJlO1xuICAgICAgZXhlY3V0aW9uOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgICB9O1xuICAgIGludGVycnVwdGVkUmVzdW1lPzoge1xuICAgICAgZml4dHVyZTogQXJhYmljQWlGaXh0dXJlO1xuICAgICAgZXhlY3V0aW9uOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgICAgIHJlY292ZXJlZFRva2VuOiBzdHJpbmc7XG4gICAgICByZXN1bWVkU3RyZWFtQm9keTogc3RyaW5nO1xuICAgIH07XG4gICAgZGVsaXZlcnlSZWNvdmVyeT86IHtcbiAgICAgIG9wZXJhdGlvbnM6IEFycmF5PFJlY29yZDxzdHJpbmcsIHVua25vd24+PjtcbiAgICAgIHJlcXVlc3RzOiBzdHJpbmdbXTtcbiAgICAgIGFjdGlvblJlcXVlc3RzPzogc3RyaW5nW107XG4gICAgICByZWNvdmVyeUFjdGlvbj86IHtcbiAgICAgICAgcHJvcG9zYWxJZDogc3RyaW5nO1xuICAgICAgICBhY3Rpb246IFwicmVzdW1lLXZhbGlkYXRpb25cIiB8IFwiZGlzY2FyZFwiO1xuICAgICAgICByZXNwb25zZTogUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gICAgICAgIHN0YXR1cz86IG51bWJlcjtcbiAgICAgICAgbmV4dE9wZXJhdGlvbnM/OiBBcnJheTxSZWNvcmQ8c3RyaW5nLCB1bmtub3duPj47XG4gICAgICB9O1xuICAgIH07XG4gICAgcHJvamVjdHM/OiBBcnJheTxSZWNvcmQ8c3RyaW5nLCB1bmtub3duPj47XG4gICAgZXZlbnRzPzogQXJyYXk8UmVjb3JkPHN0cmluZywgdW5rbm93bj4+O1xuICAgIGFyY2hpdmVVcGxvYWQ/OiB7XG4gICAgICB1cGxvYWRJZDogc3RyaW5nO1xuICAgICAgb3JpZ2luYWxOYW1lOiBzdHJpbmc7XG4gICAgfTtcbiAgICBhdWRpdEV4cG9ydD86IHtcbiAgICAgIGJvZHk6IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAgICAgZmlsZW5hbWU6IHN0cmluZztcbiAgICAgIHJlcXVlc3RzOiBzdHJpbmdbXTtcbiAgICAgIGV4ZWN1dGlvbj86IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAgICAgbWVzc2FnZU91dGNvbWU/OiBzdHJpbmc7XG4gICAgICBmYWlsRmlyc3RQcmV2aWV3PzogYm9vbGVhbjtcbiAgICB9O1xuICAgIGxpdmVUYXNrPzoge1xuICAgICAgaWQ6IHN0cmluZztcbiAgICAgIHRpdGxlOiBzdHJpbmc7XG4gICAgICBwcm9qZWN0SWQ6IHN0cmluZztcbiAgICAgIGxvZzogUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gICAgICBpbml0aWFsTG9ncz86IEFycmF5PFJlY29yZDxzdHJpbmcsIHVua25vd24+PjtcbiAgICAgIHN0cmVhbVJlcXVlc3RzPzogc3RyaW5nW107XG4gICAgICBmYWlsRmlyc3RTdHJlYW0/OiBib29sZWFuO1xuICAgICAgZmFpbFN0cmVhbUF0dGVtcHRzPzogbnVtYmVyO1xuICAgIH07XG4gIH0sXG4pIHtcbiAgYXdhaXQgcGFnZS5yb3V0ZShcIioqL2FwaS8qKlwiLCBhc3luYyAocm91dGUpID0+IHtcbiAgICBjb25zdCB1cmwgPSBuZXcgVVJMKHJvdXRlLnJlcXVlc3QoKS51cmwoKSk7XG4gICAgY29uc3QgcGF0aCA9IHVybC5wYXRobmFtZS5yZXBsYWNlKC9eXFwvZGFzaGJvYXJkKD89XFwvfCQpLywgXCJcIik7XG4gICAgY29uc3QgYXJhYmljQWkgPSBvdmVycmlkZXM/LmFyYWJpY0FpO1xuICAgIGNvbnN0IGFsdGVybmF0ZUFpID0gb3ZlcnJpZGVzPy5hbHRlcm5hdGVBaTtcbiAgICBjb25zdCBkaXNjb25uZWN0QWkgPSBvdmVycmlkZXM/LmRpc2Nvbm5lY3RBaTtcbiAgICBjb25zdCBhaUZpeHR1cmVzID0gW2FyYWJpY0FpLCBhbHRlcm5hdGVBaSwgZGlzY29ubmVjdEFpXS5maWx0ZXIoXG4gICAgICAoZml4dHVyZSk6IGZpeHR1cmUgaXMgQXJhYmljQWlGaXh0dXJlID0+IEJvb2xlYW4oZml4dHVyZSksXG4gICAgKTtcblxuICAgIGlmIChhaUZpeHR1cmVzLmxlbmd0aCA+IDAgJiYgcGF0aC5lbmRzV2l0aChcIi9hcGkvYWkvY2hhdC9zZXNzaW9uc1wiKSkge1xuICAgICAgY29uc3QgcHJvamVjdElkID0gdXJsLnNlYXJjaFBhcmFtcy5nZXQoXCJwcm9qZWN0SWRcIik7XG4gICAgICBjb25zdCBwcm9qZWN0U2Vzc2lvbnMgPSBhaUZpeHR1cmVzLmZpbHRlcihcbiAgICAgICAgKGZpeHR1cmUpID0+ICFmaXh0dXJlLnByb2plY3RJZCB8fCBmaXh0dXJlLnByb2plY3RJZCA9PT0gcHJvamVjdElkLFxuICAgICAgKTtcbiAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKFxuICAgICAgICBqc29uUmVzcG9uc2UoXG4gICAgICAgICAgcHJvamVjdFNlc3Npb25zLm1hcCgoZml4dHVyZSkgPT4gKHtcbiAgICAgICAgICAgIGlkOiBmaXh0dXJlLnNlc3Npb25JZCxcbiAgICAgICAgICAgIHRpdGxlOiBmaXh0dXJlLnF1ZXN0aW9uLFxuICAgICAgICAgICAgdXBkYXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDI6MDAuMDAwWlwiLFxuICAgICAgICAgIH0pKSxcbiAgICAgICAgKSxcbiAgICAgICk7XG4gICAgfVxuICAgIGlmIChvdmVycmlkZXM/LnJlc3VtZUZhaWx1cmUgJiYgcGF0aC5lbmRzV2l0aChcIi9hcGkvYWkvY2hhdC9zdHJlYW1cIikpIHtcbiAgICAgIGxldCByZXF1ZXN0Qm9keTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gPSB7fTtcbiAgICAgIHRyeSB7XG4gICAgICAgIHJlcXVlc3RCb2R5ID0gcm91dGUucmVxdWVzdCgpLnBvc3REYXRhSlNPTigpIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIC8vIFRoZSBub3JtYWwgcHJvdmlkZXItZnJlZSBmYWxsYmFjayBiZWxvdyBoYW5kbGVzIG1hbGZvcm1lZCByZXF1ZXN0cy5cbiAgICAgIH1cbiAgICAgIGlmIChcbiAgICAgICAgcmVxdWVzdEJvZHkuZXhlY3V0aW9uSWQgPT09IG92ZXJyaWRlcy5yZXN1bWVGYWlsdXJlLmZpeHR1cmUuZXhlY3V0aW9uSWRcbiAgICAgICkge1xuICAgICAgICByZXR1cm4gcm91dGUuZnVsZmlsbCh7XG4gICAgICAgICAgc3RhdHVzOiAyMDAsXG4gICAgICAgICAgY29udGVudFR5cGU6IFwidGV4dC9ldmVudC1zdHJlYW1cIixcbiAgICAgICAgICBoZWFkZXJzOiB7IFwiQ2FjaGUtQ29udHJvbFwiOiBcIm5vLWNhY2hlXCIgfSxcbiAgICAgICAgICBib2R5OiBvdmVycmlkZXMucmVzdW1lRmFpbHVyZS5maXh0dXJlLnN0cmVhbUJvZHksXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH1cbiAgICBpZiAob3ZlcnJpZGVzPy5pbnRlcnJ1cHRlZFJlc3VtZSAmJiBwYXRoLmVuZHNXaXRoKFwiL2FwaS9haS9jaGF0L3N0cmVhbVwiKSkge1xuICAgICAgbGV0IHJlcXVlc3RCb2R5OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiA9IHt9O1xuICAgICAgdHJ5IHtcbiAgICAgICAgcmVxdWVzdEJvZHkgPSByb3V0ZS5yZXF1ZXN0KCkucG9zdERhdGFKU09OKCkgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgLy8gVGhlIG5vcm1hbCBwcm92aWRlci1mcmVlIGZhbGxiYWNrIGJlbG93IGhhbmRsZXMgbWFsZm9ybWVkIHJlcXVlc3RzLlxuICAgICAgfVxuICAgICAgY29uc3QgeyBmaXh0dXJlLCByZXN1bWVkU3RyZWFtQm9keSB9ID0gb3ZlcnJpZGVzLmludGVycnVwdGVkUmVzdW1lO1xuICAgICAgaWYgKHJlcXVlc3RCb2R5LmV4ZWN1dGlvbklkID09PSBmaXh0dXJlLmV4ZWN1dGlvbklkKSB7XG4gICAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKHtcbiAgICAgICAgICBzdGF0dXM6IDIwMCxcbiAgICAgICAgICBjb250ZW50VHlwZTogXCJ0ZXh0L2V2ZW50LXN0cmVhbVwiLFxuICAgICAgICAgIGhlYWRlcnM6IHsgXCJDYWNoZS1Db250cm9sXCI6IFwibm8tY2FjaGVcIiB9LFxuICAgICAgICAgIGJvZHk6IHJlc3VtZWRTdHJlYW1Cb2R5LFxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICAgIGlmICghcmVxdWVzdEJvZHkuZXhlY3V0aW9uSWQpIHtcbiAgICAgICAgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoe1xuICAgICAgICAgIHN0YXR1czogMjAwLFxuICAgICAgICAgIGNvbnRlbnRUeXBlOiBcInRleHQvZXZlbnQtc3RyZWFtXCIsXG4gICAgICAgICAgaGVhZGVyczogeyBcIkNhY2hlLUNvbnRyb2xcIjogXCJuby1jYWNoZVwiIH0sXG4gICAgICAgICAgLy8gRGVsaWJlcmF0ZWx5IHN0b3AgYWZ0ZXIgdGhlIGR1cmFibGUgZXhlY3V0aW9uIGlkZW50aXR5LiBUaGVcbiAgICAgICAgICAvLyBqb3VybmV5IHdyYXBzIHRoaXMgcmVzcG9uc2UgaW4gYSBicm93c2VyLWxldmVsIHN0cmVhbSBlcnJvci5cbiAgICAgICAgICBib2R5OiBmaXh0dXJlLnN0cmVhbUJvZHksXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH1cbiAgICBjb25zdCBzdHJlYW1GaXh0dXJlID0gZGlzY29ubmVjdEFpID8/IGFyYWJpY0FpO1xuICAgIGlmIChzdHJlYW1GaXh0dXJlICYmIHBhdGguZW5kc1dpdGgoXCIvYXBpL2FpL2NoYXQvc3RyZWFtXCIpKVxuICAgICAgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoe1xuICAgICAgICBzdGF0dXM6IDIwMCxcbiAgICAgICAgY29udGVudFR5cGU6IFwidGV4dC9ldmVudC1zdHJlYW1cIixcbiAgICAgICAgaGVhZGVyczogeyBcIkNhY2hlLUNvbnRyb2xcIjogXCJuby1jYWNoZVwiIH0sXG4gICAgICAgIGJvZHk6IHN0cmVhbUZpeHR1cmUuc3RyZWFtQm9keSxcbiAgICAgIH0pO1xuICAgIGNvbnN0IG1lc3NhZ2VGaXh0dXJlID0gYWlGaXh0dXJlcy5maW5kKChmaXh0dXJlKSA9PlxuICAgICAgcGF0aC5lbmRzV2l0aChgL2FwaS9haS9jaGF0LyR7Zml4dHVyZS5zZXNzaW9uSWR9L21lc3NhZ2VzYCksXG4gICAgKTtcbiAgICBpZiAobWVzc2FnZUZpeHR1cmUpXG4gICAgICByZXR1cm4gcm91dGUuZnVsZmlsbChcbiAgICAgICAganNvblJlc3BvbnNlKFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBpZDogYCR7bWVzc2FnZUZpeHR1cmUuc2Vzc2lvbklkfS11c2VyLW1lc3NhZ2VgLFxuICAgICAgICAgICAgc2Vzc2lvbklkOiBtZXNzYWdlRml4dHVyZS5zZXNzaW9uSWQsXG4gICAgICAgICAgICByb2xlOiBcInVzZXJcIixcbiAgICAgICAgICAgIGNvbnRlbnQ6IG1lc3NhZ2VGaXh0dXJlLnF1ZXN0aW9uLFxuICAgICAgICAgICAgY3JlYXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDE6MDAuMDAwWlwiLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgbWVzc2FnZUZpeHR1cmUubWVzc2FnZSxcbiAgICAgICAgXSksXG4gICAgICApO1xuICAgIGlmIChcbiAgICAgIG92ZXJyaWRlcz8uYXVkaXRFeHBvcnQgJiZcbiAgICAgIHBhdGguZW5kc1dpdGgoXCIvYXBpL2FpL2NoYXQvZTJlLWF1ZGl0LXNlc3Npb24vbWVzc2FnZXNcIilcbiAgICApIHtcbiAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKFxuICAgICAgICBqc29uUmVzcG9uc2UoW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIGlkOiBcImUyZS1hdWRpdC11c2VyLW1lc3NhZ2VcIixcbiAgICAgICAgICAgIHNlc3Npb25JZDogXCJlMmUtYXVkaXQtc2Vzc2lvblwiLFxuICAgICAgICAgICAgcm9sZTogXCJ1c2VyXCIsXG4gICAgICAgICAgICBjb250ZW50OiBcIkNvbXBsZXRlZCBhdWRpdCBleGVjdXRpb25cIixcbiAgICAgICAgICAgIGNyZWF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAxOjAwLjAwMFpcIixcbiAgICAgICAgICB9LFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIGlkOiBcImUyZS1hdWRpdC1hc3Npc3RhbnQtbWVzc2FnZVwiLFxuICAgICAgICAgICAgc2Vzc2lvbklkOiBcImUyZS1hdWRpdC1zZXNzaW9uXCIsXG4gICAgICAgICAgICByb2xlOiBcImFzc2lzdGFudFwiLFxuICAgICAgICAgICAgY29udGVudDogXCJDb21wbGV0ZWQgYXVkaXQgZXhlY3V0aW9uXCIsXG4gICAgICAgICAgICBleGVjdXRpb25JZDogRVhFQ1VUSU9OX0lELFxuICAgICAgICAgICAgb3V0Y29tZTogb3ZlcnJpZGVzLmF1ZGl0RXhwb3J0Lm1lc3NhZ2VPdXRjb21lID8/IFwiU1VDQ0VFREVEXCIsXG4gICAgICAgICAgICBjcmVhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMjowMC4wMDBaXCIsXG4gICAgICAgICAgfSxcbiAgICAgICAgXSksXG4gICAgICApO1xuICAgIH1cblxuICAgIGlmIChwYXRoID09PSBcIi9hcGkvZGFzaGJvYXJkXCIpXG4gICAgICByZXR1cm4gcm91dGUuZnVsZmlsbChqc29uUmVzcG9uc2UoZGFzaGJvYXJkRml4dHVyZSkpO1xuICAgIGlmIChcbiAgICAgIG92ZXJyaWRlcz8uYXVkaXRFeHBvcnQgJiZcbiAgICAgIHBhdGggPT09IGAvYXBpL2FpL2V4ZWN1dGlvbnMvJHtFWEVDVVRJT05fSUR9L2F1ZGl0LWV4cG9ydGBcbiAgICApIHtcbiAgICAgIG92ZXJyaWRlcy5hdWRpdEV4cG9ydC5yZXF1ZXN0cy5wdXNoKHJvdXRlLnJlcXVlc3QoKS51cmwoKSk7XG4gICAgICBpZiAoXG4gICAgICAgIG92ZXJyaWRlcy5hdWRpdEV4cG9ydC5mYWlsRmlyc3RQcmV2aWV3ICYmXG4gICAgICAgIG92ZXJyaWRlcy5hdWRpdEV4cG9ydC5yZXF1ZXN0cy5sZW5ndGggPT09IDFcbiAgICAgICkge1xuICAgICAgICByZXR1cm4gcm91dGUuZnVsZmlsbChcbiAgICAgICAgICBqc29uUmVzcG9uc2UoXG4gICAgICAgICAgICB7IGVycm9yOiBcIlRlbXBvcmFyeSBwcmV2aWV3IG5ldHdvcmsgZmFpbHVyZS5cIiB9LFxuICAgICAgICAgICAgNTAzLFxuICAgICAgICAgICksXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgICByZXR1cm4gcm91dGUuZnVsZmlsbChcbiAgICAgICAganNvblJlc3BvbnNlKG92ZXJyaWRlcy5hdWRpdEV4cG9ydC5ib2R5LCAyMDAsIHtcbiAgICAgICAgICBcIkNvbnRlbnQtRGlzcG9zaXRpb25cIjogYGF0dGFjaG1lbnQ7IGZpbGVuYW1lPVwiJHtvdmVycmlkZXMuYXVkaXRFeHBvcnQuZmlsZW5hbWV9XCJgLFxuICAgICAgICB9KSxcbiAgICAgICk7XG4gICAgfVxuICAgIGlmIChvdmVycmlkZXM/LmFyY2hpdmVVcGxvYWQgJiYgcGF0aCA9PT0gXCIvYXBpL3VwbG9hZC9hcmNoaXZlXCIpIHtcbiAgICAgIGNvbnN0IGNvbnRlbnRUeXBlID0gcm91dGUucmVxdWVzdCgpLmhlYWRlcnMoKVtcImNvbnRlbnQtdHlwZVwiXSA/PyBcIlwiO1xuICAgICAgaWYgKCFjb250ZW50VHlwZS5zdGFydHNXaXRoKFwibXVsdGlwYXJ0L2Zvcm0tZGF0YTtcIikpIHtcbiAgICAgICAgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoXG4gICAgICAgICAganNvblJlc3BvbnNlKHsgZXJyb3I6IFwiRXhwZWN0ZWQgbXVsdGlwYXJ0IGFyY2hpdmUgdXBsb2FkLlwiIH0sIDQwMCksXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgICBjb25zdCBib2R5ID0gcm91dGUucmVxdWVzdCgpLnBvc3REYXRhQnVmZmVyKCk7XG4gICAgICBpZiAoIWJvZHk/LmluY2x1ZGVzKEJ1ZmZlci5mcm9tKFwiZGFzaGJvYXJkLWpvdXJuZXkuemlwXCIpKSkge1xuICAgICAgICByZXR1cm4gcm91dGUuZnVsZmlsbChcbiAgICAgICAgICBqc29uUmVzcG9uc2UoeyBlcnJvcjogXCJFeHBlY3RlZCB0aGUgam91cm5leSBhcmNoaXZlIHBheWxvYWQuXCIgfSwgNDAwKSxcbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKFxuICAgICAgICBqc29uUmVzcG9uc2UoXG4gICAgICAgICAge1xuICAgICAgICAgICAgdXBsb2FkSWQ6IG92ZXJyaWRlcy5hcmNoaXZlVXBsb2FkLnVwbG9hZElkLFxuICAgICAgICAgICAgb3JpZ2luYWxOYW1lOiBvdmVycmlkZXMuYXJjaGl2ZVVwbG9hZC5vcmlnaW5hbE5hbWUsXG4gICAgICAgICAgfSxcbiAgICAgICAgICAyMDEsXG4gICAgICAgICAge1xuICAgICAgICAgICAgXCJhY2Nlc3MtY29udHJvbC1hbGxvdy1vcmlnaW5cIjogbmV3IFVSTChwYWdlLnVybCgpKS5vcmlnaW4sXG4gICAgICAgICAgICBcImFjY2Vzcy1jb250cm9sLWFsbG93LWNyZWRlbnRpYWxzXCI6IFwidHJ1ZVwiLFxuICAgICAgICAgIH0sXG4gICAgICAgICksXG4gICAgICApO1xuICAgIH1cbiAgICBpZiAob3ZlcnJpZGVzPy5saXZlVGFzayAmJiBwYXRoID09PSBcIi9hcGkvdGFza3NcIikge1xuICAgICAgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoXG4gICAgICAgIGpzb25SZXNwb25zZShbXG4gICAgICAgICAge1xuICAgICAgICAgICAgaWQ6IG92ZXJyaWRlcy5saXZlVGFzay5pZCxcbiAgICAgICAgICAgIHByb2plY3RJZDogb3ZlcnJpZGVzLmxpdmVUYXNrLnByb2plY3RJZCxcbiAgICAgICAgICAgIHRpdGxlOiBvdmVycmlkZXMubGl2ZVRhc2sudGl0bGUsXG4gICAgICAgICAgICBkZXNjcmlwdGlvbjogXCJBIHRhc2sgdXNlZCB0byB2ZXJpZnkgbGl2ZSBkYXNoYm9hcmQgdXBkYXRlcy5cIixcbiAgICAgICAgICAgIHN0YXR1czogXCJydW5uaW5nXCIsXG4gICAgICAgICAgICBwaGFzZTogXCJFeGVjdXRpb25cIixcbiAgICAgICAgICAgIHJlbGF0ZWRGaWxlczogW10sXG4gICAgICAgICAgICByZXRyeUNvdW50OiAwLFxuICAgICAgICAgICAgbWF4UmV0cmllczogMixcbiAgICAgICAgICAgIGNyZWF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAwOjAwLjAwMFpcIixcbiAgICAgICAgICAgIHVwZGF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAwOjAxLjAwMFpcIixcbiAgICAgICAgICB9LFxuICAgICAgICBdKSxcbiAgICAgICk7XG4gICAgfVxuICAgIGlmIChcbiAgICAgIG92ZXJyaWRlcz8ubGl2ZVRhc2sgJiZcbiAgICAgIHBhdGggPT09IGAvYXBpL3Rhc2tzLyR7b3ZlcnJpZGVzLmxpdmVUYXNrLmlkfS9sb2dzYFxuICAgICkge1xuICAgICAgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoanNvblJlc3BvbnNlKG92ZXJyaWRlcy5saXZlVGFzay5pbml0aWFsTG9ncyA/PyBbXSkpO1xuICAgIH1cbiAgICBpZiAoXG4gICAgICBvdmVycmlkZXM/LmxpdmVUYXNrICYmXG4gICAgICBwYXRoID09PSBgL2FwaS90YXNrcy8ke292ZXJyaWRlcy5saXZlVGFzay5pZH0vbG9ncy9zdHJlYW1gXG4gICAgKSB7XG4gICAgICBjb25zdCBzdHJlYW1SZXF1ZXN0cyA9IG92ZXJyaWRlcy5saXZlVGFzay5zdHJlYW1SZXF1ZXN0cztcbiAgICAgIHN0cmVhbVJlcXVlc3RzPy5wdXNoKHJvdXRlLnJlcXVlc3QoKS51cmwoKSk7XG4gICAgICBpZiAoXG4gICAgICAgIChvdmVycmlkZXMubGl2ZVRhc2suZmFpbEZpcnN0U3RyZWFtICYmIHN0cmVhbVJlcXVlc3RzPy5sZW5ndGggPT09IDEpIHx8XG4gICAgICAgIChvdmVycmlkZXMubGl2ZVRhc2suZmFpbFN0cmVhbUF0dGVtcHRzICYmXG4gICAgICAgICAgc3RyZWFtUmVxdWVzdHMgJiZcbiAgICAgICAgICBzdHJlYW1SZXF1ZXN0cy5sZW5ndGggPD0gb3ZlcnJpZGVzLmxpdmVUYXNrLmZhaWxTdHJlYW1BdHRlbXB0cylcbiAgICAgICkge1xuICAgICAgICAvLyBFeGVyY2lzZSB0aGUgYnJvd3NlcidzIHJlY29ubmVjdCBwYXRoIHdpdGhvdXQgY2hhbmdpbmcgdGhlIHRhc2tcbiAgICAgICAgLy8gbGlmZWN5Y2xlIG9yIHN5bnRoZXNpemluZyBhIHN1Y2Nlc3NmdWwgcmVzcG9uc2UgZm9yIHRoZSBmaXJzdCB0cnkuXG4gICAgICAgIHJldHVybiByb3V0ZS5hYm9ydChcImNvbm5lY3Rpb25yZXNldFwiKTtcbiAgICAgIH1cbiAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKHtcbiAgICAgICAgc3RhdHVzOiAyMDAsXG4gICAgICAgIGNvbnRlbnRUeXBlOiBcInRleHQvZXZlbnQtc3RyZWFtXCIsXG4gICAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgICBcIkNhY2hlLUNvbnRyb2xcIjogXCJuby1jYWNoZVwiLFxuICAgICAgICAgIFwiYWNjZXNzLWNvbnRyb2wtYWxsb3ctb3JpZ2luXCI6IG5ldyBVUkwocGFnZS51cmwoKSkub3JpZ2luLFxuICAgICAgICAgIFwiYWNjZXNzLWNvbnRyb2wtYWxsb3ctY3JlZGVudGlhbHNcIjogXCJ0cnVlXCIsXG4gICAgICAgIH0sXG4gICAgICAgIGJvZHk6IGBldmVudDogbG9nXFxuZGF0YTogJHtKU09OLnN0cmluZ2lmeShvdmVycmlkZXMubGl2ZVRhc2subG9nKX1cXG5cXG5gLFxuICAgICAgfSk7XG4gICAgfVxuICAgIGlmIChwYXRoID09PSBcIi9hcGkvcHJvamVjdHNcIikge1xuICAgICAgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoXG4gICAgICAgIGpzb25SZXNwb25zZShcbiAgICAgICAgICBvdmVycmlkZXM/LnByb2plY3RzID8/IFtcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgaWQ6IFwiZTJlLXByb2plY3RcIixcbiAgICAgICAgICAgICAgbmFtZTogXCJTbW9rZSBQcm9qZWN0XCIsXG4gICAgICAgICAgICAgIGxhbmd1YWdlOiBcIlR5cGVTY3JpcHRcIixcbiAgICAgICAgICAgICAgZnJhbWV3b3JrOiBcIlJlYWN0XCIsXG4gICAgICAgICAgICAgIHN0YXR1czogXCJhY3RpdmVcIixcbiAgICAgICAgICAgICAgcm9vdFBhdGg6IFwiL2NvbnRyb2xsZWQvc21va2VcIixcbiAgICAgICAgICAgICAgcXVhbGl0eVNjb3JlOiA5MixcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgXSxcbiAgICAgICAgKSxcbiAgICAgICk7XG4gICAgfVxuICAgIGlmIChcbiAgICAgIG92ZXJyaWRlcz8uZGVsaXZlcnlSZWNvdmVyeSAmJlxuICAgICAgcGF0aCA9PT0gXCIvYXBpL2FpL2RlbGl2ZXJ5L3JlY292ZXJhYmxlXCJcbiAgICApIHtcbiAgICAgIG92ZXJyaWRlcy5kZWxpdmVyeVJlY292ZXJ5LnJlcXVlc3RzLnB1c2gocm91dGUucmVxdWVzdCgpLnVybCgpKTtcbiAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKFxuICAgICAgICBqc29uUmVzcG9uc2UoeyBvcGVyYXRpb25zOiBvdmVycmlkZXMuZGVsaXZlcnlSZWNvdmVyeS5vcGVyYXRpb25zIH0pLFxuICAgICAgKTtcbiAgICB9XG4gICAgaWYgKFxuICAgICAgb3ZlcnJpZGVzPy5kZWxpdmVyeVJlY292ZXJ5Py5yZWNvdmVyeUFjdGlvbiAmJlxuICAgICAgcGF0aCA9PT1cbiAgICAgICAgYC9hcGkvYWkvZGVsaXZlcnkvJHtvdmVycmlkZXMuZGVsaXZlcnlSZWNvdmVyeS5yZWNvdmVyeUFjdGlvbi5wcm9wb3NhbElkfS8ke292ZXJyaWRlcy5kZWxpdmVyeVJlY292ZXJ5LnJlY292ZXJ5QWN0aW9uLmFjdGlvbn1gXG4gICAgKSB7XG4gICAgICBvdmVycmlkZXMuZGVsaXZlcnlSZWNvdmVyeS5hY3Rpb25SZXF1ZXN0cz8ucHVzaChyb3V0ZS5yZXF1ZXN0KCkudXJsKCkpO1xuICAgICAgaWYgKG92ZXJyaWRlcy5kZWxpdmVyeVJlY292ZXJ5LnJlY292ZXJ5QWN0aW9uLm5leHRPcGVyYXRpb25zKSB7XG4gICAgICAgIG92ZXJyaWRlcy5kZWxpdmVyeVJlY292ZXJ5Lm9wZXJhdGlvbnMgPVxuICAgICAgICAgIG92ZXJyaWRlcy5kZWxpdmVyeVJlY292ZXJ5LnJlY292ZXJ5QWN0aW9uLm5leHRPcGVyYXRpb25zO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoXG4gICAgICAgIGpzb25SZXNwb25zZShcbiAgICAgICAgICBvdmVycmlkZXMuZGVsaXZlcnlSZWNvdmVyeS5yZWNvdmVyeUFjdGlvbi5yZXNwb25zZSxcbiAgICAgICAgICBvdmVycmlkZXMuZGVsaXZlcnlSZWNvdmVyeS5yZWNvdmVyeUFjdGlvbi5zdGF0dXMgPz8gNDA5LFxuICAgICAgICApLFxuICAgICAgKTtcbiAgICB9XG4gICAgaWYgKHBhdGggPT09IFwiL2FwaS9ldmVudHNcIikge1xuICAgICAgY29uc3QgZXZlbnRzID0gb3ZlcnJpZGVzPy5ldmVudHMgPz8gZGFzaGJvYXJkRml4dHVyZS5yZWNlbnRFdmVudHM7XG4gICAgICBjb25zdCBzZWFyY2ggPSB1cmwuc2VhcmNoUGFyYW1zLmdldChcInNlYXJjaFwiKT8udG9Mb3dlckNhc2UoKTtcbiAgICAgIGNvbnN0IGZpbHRlcmVkRXZlbnRzID0gZXZlbnRzLmZpbHRlcigoZXZlbnQpID0+IHtcbiAgICAgICAgY29uc3QgcHJvamVjdElkID0gdXJsLnNlYXJjaFBhcmFtcy5nZXQoXCJwcm9qZWN0SWRcIik7XG4gICAgICAgIGNvbnN0IHNldmVyaXR5ID0gdXJsLnNlYXJjaFBhcmFtcy5nZXQoXCJzZXZlcml0eVwiKTtcbiAgICAgICAgY29uc3QgY29ycmVsYXRpb25JZCA9IHVybC5zZWFyY2hQYXJhbXMuZ2V0KFwiY29ycmVsYXRpb25JZFwiKTtcbiAgICAgICAgcmV0dXJuIChcbiAgICAgICAgICAoIXByb2plY3RJZCB8fCBldmVudC5wcm9qZWN0SWQgPT09IHByb2plY3RJZCkgJiZcbiAgICAgICAgICAoIXNldmVyaXR5IHx8IGV2ZW50LnNldmVyaXR5ID09PSBzZXZlcml0eSkgJiZcbiAgICAgICAgICAoIWNvcnJlbGF0aW9uSWQgfHwgZXZlbnQuY29ycmVsYXRpb25JZCA9PT0gY29ycmVsYXRpb25JZCkgJiZcbiAgICAgICAgICAoIXNlYXJjaCB8fFxuICAgICAgICAgICAgW2V2ZW50Lm1lc3NhZ2UsIGV2ZW50LnR5cGUsIGV2ZW50LmNvcnJlbGF0aW9uSWRdXG4gICAgICAgICAgICAgIC5maWx0ZXIoKHZhbHVlKTogdmFsdWUgaXMgc3RyaW5nID0+IHR5cGVvZiB2YWx1ZSA9PT0gXCJzdHJpbmdcIilcbiAgICAgICAgICAgICAgLnNvbWUoKHZhbHVlKSA9PiB2YWx1ZS50b0xvd2VyQ2FzZSgpLmluY2x1ZGVzKHNlYXJjaCkpKVxuICAgICAgICApO1xuICAgICAgfSk7XG4gICAgICBjb25zdCBsaW1pdCA9IE51bWJlcih1cmwuc2VhcmNoUGFyYW1zLmdldChcImxpbWl0XCIpKSB8fCA1MDtcbiAgICAgIGNvbnN0IHBhZ2UgPSBOdW1iZXIodXJsLnNlYXJjaFBhcmFtcy5nZXQoXCJwYWdlXCIpKSB8fCAxO1xuICAgICAgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoXG4gICAgICAgIGpzb25SZXNwb25zZSh7XG4gICAgICAgICAgZXZlbnRzOiBmaWx0ZXJlZEV2ZW50cy5zbGljZSgocGFnZSAtIDEpICogbGltaXQsIHBhZ2UgKiBsaW1pdCksXG4gICAgICAgICAgdG90YWw6IGZpbHRlcmVkRXZlbnRzLmxlbmd0aCxcbiAgICAgICAgfSksXG4gICAgICApO1xuICAgIH1cbiAgICBpZiAoXG4gICAgICBvdmVycmlkZXM/LnJlc3VtZUZhaWx1cmUgJiZcbiAgICAgIHBhdGggPT09XG4gICAgICAgIGAvYXBpL2FpL2V4ZWN1dGlvbnMvJHtvdmVycmlkZXMucmVzdW1lRmFpbHVyZS5maXh0dXJlLmV4ZWN1dGlvbklkfWBcbiAgICApIHtcbiAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKGpzb25SZXNwb25zZShvdmVycmlkZXMucmVzdW1lRmFpbHVyZS5leGVjdXRpb24pKTtcbiAgICB9XG4gICAgaWYgKFxuICAgICAgb3ZlcnJpZGVzPy5pbnRlcnJ1cHRlZFJlc3VtZSAmJlxuICAgICAgcGF0aCA9PT1cbiAgICAgICAgYC9hcGkvYWkvZXhlY3V0aW9ucy8ke292ZXJyaWRlcy5pbnRlcnJ1cHRlZFJlc3VtZS5maXh0dXJlLmV4ZWN1dGlvbklkfWBcbiAgICApIHtcbiAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKGpzb25SZXNwb25zZShvdmVycmlkZXMuaW50ZXJydXB0ZWRSZXN1bWUuZXhlY3V0aW9uKSk7XG4gICAgfVxuICAgIGlmIChcbiAgICAgIG92ZXJyaWRlcz8uaW50ZXJydXB0ZWRSZXN1bWUgJiZcbiAgICAgIHBhdGggPT09XG4gICAgICAgIGAvYXBpL2FpL2V4ZWN1dGlvbnMvJHtvdmVycmlkZXMuaW50ZXJydXB0ZWRSZXN1bWUuZml4dHVyZS5leGVjdXRpb25JZH0vcmVzdW1lLWNhcGFiaWxpdHlgXG4gICAgKSB7XG4gICAgICByZXR1cm4gcm91dGUuZnVsZmlsbChcbiAgICAgICAganNvblJlc3BvbnNlKHtcbiAgICAgICAgICBleGVjdXRpb25JZDogb3ZlcnJpZGVzLmludGVycnVwdGVkUmVzdW1lLmZpeHR1cmUuZXhlY3V0aW9uSWQsXG4gICAgICAgICAgcmVzdW1lVG9rZW46IG92ZXJyaWRlcy5pbnRlcnJ1cHRlZFJlc3VtZS5yZWNvdmVyZWRUb2tlbixcbiAgICAgICAgfSksXG4gICAgICApO1xuICAgIH1cbiAgICBpZiAocGF0aCA9PT0gYC9hcGkvYWkvZXhlY3V0aW9ucy8ke0VYRUNVVElPTl9JRH1gKVxuICAgICAgcmV0dXJuIHJvdXRlLmZ1bGZpbGwoXG4gICAgICAgIGpzb25SZXNwb25zZShvdmVycmlkZXM/LmF1ZGl0RXhwb3J0Py5leGVjdXRpb24gPz8gZXhlY3V0aW9uRml4dHVyZSksXG4gICAgICApO1xuICAgIGlmIChwYXRoID09PSBcIi9hcGkvYWkvbWlzc2lvbi1jb250cm9sXCIpXG4gICAgICByZXR1cm4gcm91dGUuZnVsZmlsbChcbiAgICAgICAganNvblJlc3BvbnNlKHsgdXBkYXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDE6MDAuMDAwWlwiLCBleGVjdXRpb25zOiBbXSB9KSxcbiAgICAgICk7XG5cbiAgICAvLyBBSSBpcyBkZWxpYmVyYXRlbHkgbm90IGV4ZWN1dGVkIGluIHRoaXMgc21va2Ugam91cm5leS4gVGhpcyByZXNwb25zZVxuICAgIC8vIHZlcmlmaWVzIHRoZSB1c2VyLXZpc2libGUgdW5hdmFpbGFibGUvZW1wdHkgc3RhdGUgd2l0aG91dCBhIHByb3ZpZGVyLlxuICAgIGlmIChwYXRoLnN0YXJ0c1dpdGgoXCIvYXBpL2FpL1wiKSlcbiAgICAgIHJldHVybiByb3V0ZS5mdWxmaWxsKFxuICAgICAgICBqc29uUmVzcG9uc2UoeyBlcnJvcjogXCJBSSBwcm92aWRlciBub3QgY29uZmlndXJlZFwiIH0sIDQyOCksXG4gICAgICApO1xuXG4gICAgcmV0dXJuIHJvdXRlLmNvbnRpbnVlKCk7XG4gIH0pO1xufVxuXG5hc3luYyBmdW5jdGlvbiBpbnN0YWxsQXJhYmljQWlGaXh0dXJlKFxuICBwYWdlOiBQYWdlLFxuICBvcHRpb25zPzoge1xuICAgIGJsb2NrZWQ/OiBib29sZWFuO1xuICAgIHNlc3Npb25JZD86IHN0cmluZztcbiAgICBxdWVzdGlvbj86IHN0cmluZztcbiAgICBwcm9qZWN0SWQ/OiBzdHJpbmc7XG4gIH0sXG4pIHtcbiAgY29uc3Qgc2Vzc2lvbklkID0gb3B0aW9ucz8uc2Vzc2lvbklkID8/IFwiZTJlLWFyYWJpYy1haS1zZXNzaW9uXCI7XG4gIGNvbnN0IG1lc3NhZ2VJZCA9IFwiZTJlLWFyYWJpYy1haS1tZXNzYWdlXCI7XG4gIGNvbnN0IHNvdXJjZSA9IFwic3JjL2V4ZWN1dGlvbi10b29scy50c1wiO1xuICBjb25zdCBibG9ja2VkID0gb3B0aW9ucz8uYmxvY2tlZCA9PT0gdHJ1ZTtcbiAgY29uc3QgcXVlc3Rpb24gPVxuICAgIG9wdGlvbnM/LnF1ZXN0aW9uID8/XG4gICAgXCLZhdin2LDYpyDZitit2K/YqyDYudmG2K8g2KfZhtiq2YfYp9ihINmF2YfZhNipIHByb3ZpZGVyIHRpbWVvdXQg2K/Yp9iu2YQgZXhlY3V0aW9uLXRvb2xzLnRz2J9cIjtcbiAgY29uc3QgYW5zd2VyID1cbiAgICBcIti52YbYryDYp9mG2KrZh9in2KEg2YXZh9mE2Kkg2YXYstmI2K8g2KfZhNiw2YPYp9ihINin2YTYp9i12LfZhtin2LnZitiMINmK2LnZitivINin2YTZhdiz2KfYsSDYqtmC2LHZitix2YvYpyDYrNiy2KbZitmL2Kcg2YXZhiDYp9mE2KPYr9mE2Kkg2KfZhNiq2Yog2KzZj9mF2LnYqiDYqNiv2YQg2KXYtdiv2KfYsSBGaW5kaW5nINi62YrYsSDZhdir2KjYqi5cIjtcbiAgY29uc3QgZXZpZGVuY2UgPSBbXG4gICAge1xuICAgICAgc291cmNlLFxuICAgICAgLi4uKGJsb2NrZWRcbiAgICAgICAgPyB7XG4gICAgICAgICAgICBleGNlcnB0OiBcInByb3ZpZGVyIHRpbWVvdXQgaXMgaGFuZGxlZCBoZXJlXCIsXG4gICAgICAgICAgICBzdXBwb3J0c0NsYWltOiBmYWxzZSxcbiAgICAgICAgICAgIGV2aWRlbmNlQ2xhc3M6IFwiUkVBRF9DT05GSVJNRURcIixcbiAgICAgICAgICAgIGNpdGF0aW9uU3RhdHVzOiBcIkJMT0NLRURcIixcbiAgICAgICAgICAgIGNpdGF0aW9uUmVhc29uOiBcIk1JU1NJTkdfTElURVJBTF9NQVRDSFwiLFxuICAgICAgICAgIH1cbiAgICAgICAgOiB7XG4gICAgICAgICAgICBleGNlcnB0OiAncmV0dXJuIHBhcnRpYWxGcm9tQ29sbGVjdGVkRXZpZGVuY2UoXCJwcm92aWRlciB0aW1lb3V0XCIpOycsXG4gICAgICAgICAgICBzb3VyY2VTcGFuOiB7IHN0YXJ0TGluZTogNDIsIGVuZExpbmU6IDQyIH0sXG4gICAgICAgICAgICBzdXBwb3J0c0NsYWltOiB0cnVlLFxuICAgICAgICAgICAgZXZpZGVuY2VDbGFzczogXCJCRUhBVklPUl9QUk9WRU5cIixcbiAgICAgICAgICAgIGNpdGF0aW9uU3RhdHVzOiBcIkFDQ0VQVEVEXCIsXG4gICAgICAgICAgICBjaXRhdGlvblJlYXNvbjogXCJBQ0NFUFRFRF9TT1VSQ0VfU1BBTlwiLFxuICAgICAgICAgIH0pLFxuICAgIH0sXG4gIF07XG4gIGNvbnN0IHRvb2xUcmFjZSA9IFtcbiAgICB7XG4gICAgICBraW5kOiBcInRvb2xfY2FsbFwiLFxuICAgICAgdG9vbDogXCJyZWFkX2ZpbGVcIixcbiAgICAgIGFyZ3M6IHsgcGF0aDogc291cmNlIH0sXG4gICAgICBjYWNoZWQ6IGZhbHNlLFxuICAgICAgcHJlZmV0Y2hlZDogdHJ1ZSxcbiAgICB9LFxuICAgIHtcbiAgICAgIGtpbmQ6IFwidG9vbF9yZXN1bHRcIixcbiAgICAgIHRvb2w6IFwicmVhZF9maWxlXCIsXG4gICAgICBzb3VyY2UsXG4gICAgICBjYWNoZWQ6IGZhbHNlLFxuICAgICAgcHJlZmV0Y2hlZDogdHJ1ZSxcbiAgICB9LFxuICAgIHtcbiAgICAgIGtpbmQ6IFwiZXZpZGVuY2VfaW50ZWdyaXR5XCIsXG4gICAgICBjb2RlOiBcIkVWSURFTkNFX0lOVEVHUklUWV9PS1wiLFxuICAgICAgY29uc2lzdGVudDogdHJ1ZSxcbiAgICAgIHZpb2xhdGlvbnM6IFtdLFxuICAgICAgZXZpZGVuY2VGaWxlQ291bnQ6IDEsXG4gICAgICBhY2NlcHRlZEV2aWRlbmNlQ291bnQ6IDEsXG4gICAgICBjb21wbGV0ZWRSZWFkRmlsZXM6IFtzb3VyY2VdLFxuICAgICAgYWNjZXB0ZWRFdmlkZW5jZUZpbGVzOiBbc291cmNlXSxcbiAgICAgIG9iamVjdGl2ZVR5cGU6IFwiUFJPRFVDVElPTl9SRUFDSEFCSUxJVFlcIixcbiAgICAgIHJlcXVpcmVkRWRnZXM6IFtcImNsaWVudC0+c2VydmVyXCIsIFwic2VydmVyLT5kYXRhYmFzZVwiXSxcbiAgICAgIHByb3ZlbkVkZ2VzOiBbXCJjbGllbnQtPnNlcnZlclwiXSxcbiAgICAgIGNvbXBsZXRpb25HYXRlUmVzdWx0OiBcIlBBUlRJQUxMWV9QUk9WRU5cIixcbiAgICAgIGZpbmFsQW5zd2VyVHlwZTogXCJQUk9EVUNUSU9OX1JFQUNIQUJJTElUWV9BTlNXRVJcIixcbiAgICB9LFxuICBdO1xuICBjb25zdCB0YXNrUmVzdWx0ID0ge1xuICAgIGtpbmQ6IFwiQkVIQVZJT1JfQU5TV0VSX1JFU1VMVFwiLFxuICAgIGFuc3dlcjoge1xuICAgICAgYW5zd2VyLFxuICAgICAgZXZpZGVuY2UsXG4gICAgICBjb25maWRlbmNlOiAxLFxuICAgICAgc291cmNlU2NvcGU6IFtzb3VyY2VdLFxuICAgICAgY292ZXJhZ2U6IHtcbiAgICAgICAgcmVxdWVzdGVkRmllbGRzOiBbXCJ0aW1lb3V0IGJlaGF2aW9yXCJdLFxuICAgICAgICBhbnN3ZXJlZEZpZWxkczogW1widGltZW91dCBiZWhhdmlvclwiXSxcbiAgICAgICAgbWlzc2luZ0ZpZWxkczogW10sXG4gICAgICAgIGNvbXBsZXRlOiB0cnVlLFxuICAgICAgfSxcbiAgICB9LFxuICB9O1xuICBjb25zdCBtZXNzYWdlID0ge1xuICAgIGlkOiBtZXNzYWdlSWQsXG4gICAgc2Vzc2lvbklkLFxuICAgIHJvbGU6IFwiYXNzaXN0YW50XCIsXG4gICAgY29udGVudDogYCR7YW5zd2VyfVxcblxcbiMjIDYpIEZpbmFsIEp1ZGdtZW50XFxuTk9UIFBST1ZFTmAsXG4gICAgb3BlcmF0aW9uTW9kZTogXCJGT1JFTlNJQ19BVURJVFwiLFxuICAgIHNvdXJjZXM6IFtzb3VyY2VdLFxuICAgIHRvb2xUcmFjZTogSlNPTi5zdHJpbmdpZnkodG9vbFRyYWNlKSxcbiAgICBiZWhhdmlvckV2aWRlbmNlOiBldmlkZW5jZSxcbiAgICB0YXNrUmVzdWx0LFxuICAgIGNyZWF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAyOjAwLjAwMFpcIixcbiAgfTtcbiAgY29uc3Qgc3NlID0gKGV2ZW50OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPikgPT5cbiAgICBgZGF0YTogJHtKU09OLnN0cmluZ2lmeShldmVudCl9XFxuXFxuYDtcbiAgY29uc3Qgc3RyZWFtQm9keSA9IFtcbiAgICBzc2UoeyB0eXBlOiBcInNlc3Npb25fc3RhcnRlZFwiLCBzZXNzaW9uSWQgfSksXG4gICAgc3NlKHtcbiAgICAgIHR5cGU6IFwiZXhlY3V0aW9uX3N0YXJ0ZWRcIixcbiAgICAgIGV4ZWN1dGlvbklkOiBcImUyZS1leGVjdXRpb25cIixcbiAgICAgIHN0YXR1czogXCJydW5uaW5nXCIsXG4gICAgICByZXN1bWFibGU6IHRydWUsXG4gICAgfSksXG4gICAgc3NlKHsgdHlwZTogXCJzdGFnZVwiLCBzdGFnZTogXCJidWlsZGluZy1jb250ZXh0XCIgfSksXG4gICAgc3NlKHsgdHlwZTogXCJzdGFnZVwiLCBzdGFnZTogXCJjYWxsaW5nLW1vZGVsXCIgfSksXG4gICAgc3NlKHtcbiAgICAgIHR5cGU6IFwidG9vbF9jYWxsXCIsXG4gICAgICB0b29sOiBcInJlYWRfZmlsZVwiLFxuICAgICAgYXJnczogeyBwYXRoOiBzb3VyY2UgfSxcbiAgICAgIGNhY2hlZDogZmFsc2UsXG4gICAgICBwcmVmZXRjaGVkOiB0cnVlLFxuICAgIH0pLFxuICAgIHNzZSh7XG4gICAgICB0eXBlOiBcInRvb2xfcmVzdWx0XCIsXG4gICAgICB0b29sOiBcInJlYWRfZmlsZVwiLFxuICAgICAgc291cmNlLFxuICAgICAgY2FjaGVkOiBmYWxzZSxcbiAgICAgIHByZWZldGNoZWQ6IHRydWUsXG4gICAgfSksXG4gICAgc3NlKHtcbiAgICAgIHR5cGU6IFwiZXZpZGVuY2VfaW50ZWdyaXR5XCIsXG4gICAgICBjb2RlOiBcIkVWSURFTkNFX0lOVEVHUklUWV9PS1wiLFxuICAgICAgY29uc2lzdGVudDogdHJ1ZSxcbiAgICAgIHZpb2xhdGlvbnM6IFtdLFxuICAgICAgZXZpZGVuY2VGaWxlQ291bnQ6IDEsXG4gICAgICBhY2NlcHRlZEV2aWRlbmNlQ291bnQ6IDEsXG4gICAgICBjb21wbGV0ZWRSZWFkRmlsZXM6IFtzb3VyY2VdLFxuICAgICAgYWNjZXB0ZWRFdmlkZW5jZUZpbGVzOiBbc291cmNlXSxcbiAgICAgIG9iamVjdGl2ZVR5cGU6IFwiUFJPRFVDVElPTl9SRUFDSEFCSUxJVFlcIixcbiAgICAgIHJlcXVpcmVkRWRnZXM6IFtcImNsaWVudC0+c2VydmVyXCIsIFwic2VydmVyLT5kYXRhYmFzZVwiXSxcbiAgICAgIHByb3ZlbkVkZ2VzOiBbXCJjbGllbnQtPnNlcnZlclwiXSxcbiAgICAgIGNvbXBsZXRpb25HYXRlUmVzdWx0OiBcIlBBUlRJQUxMWV9QUk9WRU5cIixcbiAgICAgIGZpbmFsQW5zd2VyVHlwZTogXCJQUk9EVUNUSU9OX1JFQUNIQUJJTElUWV9BTlNXRVJcIixcbiAgICB9KSxcbiAgICBzc2UoeyB0eXBlOiBcImRlbHRhXCIsIGRlbHRhOiBhbnN3ZXIgfSksXG4gICAgc3NlKHtcbiAgICAgIHR5cGU6IFwiZG9uZVwiLFxuICAgICAgc2Vzc2lvbklkLFxuICAgICAgbWVzc2FnZSxcbiAgICAgIHNvdXJjZXM6IFtzb3VyY2VdLFxuICAgICAgdG9vbFRyYWNlOiBKU09OLnN0cmluZ2lmeSh0b29sVHJhY2UpLFxuICAgICAgYmVoYXZpb3JFdmlkZW5jZTogZXZpZGVuY2UsXG4gICAgICB0YXNrUmVzdWx0LFxuICAgICAgcGVuZGluZ0NoYW5nZXM6IFtdLFxuICAgIH0pLFxuICBdLmpvaW4oXCJcIik7XG5cbiAgcmV0dXJuIHtcbiAgICBxdWVzdGlvbixcbiAgICBhbnN3ZXIsXG4gICAgc291cmNlLFxuICAgIHNlc3Npb25JZCxcbiAgICBwcm9qZWN0SWQ6IG9wdGlvbnM/LnByb2plY3RJZCxcbiAgICBzdHJlYW1Cb2R5LFxuICAgIG1lc3NhZ2UsXG4gIH07XG59XG5cbmZ1bmN0aW9uIGluc3RhbGxUb29sRmFpbHVyZUZpeHR1cmUoKTogQXJhYmljQWlGaXh0dXJlIHtcbiAgY29uc3Qgc2Vzc2lvbklkID0gXCJlMmUtdG9vbC1mYWlsdXJlLXNlc3Npb25cIjtcbiAgY29uc3QgbWVzc2FnZUlkID0gXCJlMmUtdG9vbC1mYWlsdXJlLW1lc3NhZ2VcIjtcbiAgY29uc3Qgc291cmNlID0gXCJzcmMvbWlzc2luZy1yZWxlYXNlLWZpeHR1cmUudHNcIjtcbiAgY29uc3QgcXVlc3Rpb24gPSBcIldoaWNoIHNvdXJjZSBmaWxlIGlzIGF2YWlsYWJsZSBmb3IgdGhlIHJlbGVhc2UgY2hlY2s/XCI7XG4gIGNvbnN0IGFuc3dlciA9XG4gICAgXCJBTkFMWVNJU19JTkNPTVBMRVRFOiBUaGUgcmVxdWlyZWQgc291cmNlIHJlYWQgZGlkIG5vdCBjb21wbGV0ZSwgc28gbm8gdmVyaWZpZWQgcmVzdWx0IGlzIGF2YWlsYWJsZS5cIjtcbiAgY29uc3QgZGlhZ25vc3RpY0NvZGUgPSBcIlRPT0xfRVhFQ1VUSU9OX0ZBSUxFRFwiO1xuICBjb25zdCB0b29sVHJhY2UgPSBbXG4gICAge1xuICAgICAga2luZDogXCJ0b29sX2NhbGxcIixcbiAgICAgIHRvb2w6IFwicmVhZF9maWxlXCIsXG4gICAgICBhcmdzOiB7IHBhdGg6IHNvdXJjZSB9LFxuICAgICAgY2FjaGVkOiBmYWxzZSxcbiAgICB9LFxuICAgIHtcbiAgICAgIGtpbmQ6IFwidG9vbF9yZXN1bHRcIixcbiAgICAgIHRvb2w6IFwicmVhZF9maWxlXCIsXG4gICAgICBzb3VyY2UsXG4gICAgICByZXN1bHRLaW5kOiBcImZhaWxlZFwiLFxuICAgICAgZGlhZ25vc3RpY0NvZGUsXG4gICAgICByZXN1bHRTdW1tYXJ5OiBcIlRoZSByZXF1aXJlZCBzb3VyY2UgcmVhZCBkaWQgbm90IGNvbXBsZXRlLlwiLFxuICAgIH0sXG4gICAge1xuICAgICAga2luZDogXCJkb25lXCIsXG4gICAgICBzdG9wUmVhc29uOiBcInRvb2xfZmFpbHVyZVwiLFxuICAgICAgaXRlcmF0aW9uczogMSxcbiAgICAgIG1heEl0ZXJhdGlvbnM6IDgsXG4gICAgICB0b29sQ2FsbHM6IDEsXG4gICAgICBwcmVmZXRjaFRvb2xDYWxsczogMCxcbiAgICAgIGxvb3BUb29sQ2FsbHM6IDEsXG4gICAgICBzeW50aGVzaXNTdGFydGVkOiBmYWxzZSxcbiAgICAgIGRpYWdub3N0aWNDb2RlczogW2RpYWdub3N0aWNDb2RlXSxcbiAgICB9LFxuICBdO1xuICBjb25zdCBtZXNzYWdlID0ge1xuICAgIGlkOiBtZXNzYWdlSWQsXG4gICAgc2Vzc2lvbklkLFxuICAgIHJvbGU6IFwiYXNzaXN0YW50XCIsXG4gICAgY29udGVudDogYW5zd2VyLFxuICAgIHRvb2xUcmFjZTogSlNPTi5zdHJpbmdpZnkodG9vbFRyYWNlKSxcbiAgICBjcmVhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMjowMC4wMDBaXCIsXG4gIH07XG4gIGNvbnN0IHNzZSA9IChldmVudDogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pID0+XG4gICAgYGRhdGE6ICR7SlNPTi5zdHJpbmdpZnkoZXZlbnQpfVxcblxcbmA7XG4gIGNvbnN0IHN0cmVhbUJvZHkgPSBbXG4gICAgc3NlKHsgdHlwZTogXCJzZXNzaW9uX3N0YXJ0ZWRcIiwgc2Vzc2lvbklkIH0pLFxuICAgIHNzZSh7XG4gICAgICB0eXBlOiBcImV4ZWN1dGlvbl9zdGFydGVkXCIsXG4gICAgICBleGVjdXRpb25JZDogXCJlMmUtdG9vbC1mYWlsdXJlLWV4ZWN1dGlvblwiLFxuICAgICAgc3RhdHVzOiBcInJ1bm5pbmdcIixcbiAgICAgIHJlc3VtYWJsZTogdHJ1ZSxcbiAgICB9KSxcbiAgICBzc2Uoe1xuICAgICAgdHlwZTogXCJ0b29sX2NhbGxcIixcbiAgICAgIHRvb2w6IFwicmVhZF9maWxlXCIsXG4gICAgICBhcmdzOiB7IHBhdGg6IHNvdXJjZSB9LFxuICAgICAgY2FjaGVkOiBmYWxzZSxcbiAgICB9KSxcbiAgICBzc2Uoe1xuICAgICAgdHlwZTogXCJ0b29sX3Jlc3VsdFwiLFxuICAgICAgdG9vbDogXCJyZWFkX2ZpbGVcIixcbiAgICAgIHNvdXJjZSxcbiAgICAgIHJlc3VsdEtpbmQ6IFwiZmFpbGVkXCIsXG4gICAgICBkaWFnbm9zdGljQ29kZSxcbiAgICAgIHJlc3VsdFN1bW1hcnk6IFwiVGhlIHJlcXVpcmVkIHNvdXJjZSByZWFkIGRpZCBub3QgY29tcGxldGUuXCIsXG4gICAgfSksXG4gICAgc3NlKHsgdHlwZTogXCJkZWx0YVwiLCBkZWx0YTogYW5zd2VyIH0pLFxuICAgIHNzZSh7XG4gICAgICB0eXBlOiBcImRvbmVcIixcbiAgICAgIHNlc3Npb25JZCxcbiAgICAgIG1lc3NhZ2UsXG4gICAgICB0b29sVHJhY2U6IEpTT04uc3RyaW5naWZ5KHRvb2xUcmFjZSksXG4gICAgICBwZW5kaW5nQ2hhbmdlczogW10sXG4gICAgfSksXG4gIF0uam9pbihcIlwiKTtcblxuICByZXR1cm4ge1xuICAgIHF1ZXN0aW9uLFxuICAgIGFuc3dlcixcbiAgICBzb3VyY2UsXG4gICAgc2Vzc2lvbklkLFxuICAgIHN0cmVhbUJvZHksXG4gICAgbWVzc2FnZSxcbiAgfTtcbn1cblxuZnVuY3Rpb24gaW5zdGFsbERpc2Nvbm5lY3RlZEFpRml4dHVyZSgpOiBBcmFiaWNBaUZpeHR1cmUge1xuICBjb25zdCBzZXNzaW9uSWQgPSBcImUyZS1kaXNjb25uZWN0ZWQtYWktc2Vzc2lvblwiO1xuICBjb25zdCBleGVjdXRpb25JZCA9IFwiZTJlLWRpc2Nvbm5lY3RlZC1haS1leGVjdXRpb25cIjtcbiAgY29uc3QgcXVlc3Rpb24gPVxuICAgIFwiV2hhdCBoYXBwZW5zIHdoZW4gdGhlIG1vZGVsIGRpc2Nvbm5lY3RzIGFmdGVyIHN0YXJ0aW5nIGFuIGFuc3dlcj9cIjtcbiAgY29uc3QgYW5zd2VyID1cbiAgICBcIlRoZSBtb2RlbCBzdGFydGVkIGFuIGFuc3dlciwgYnV0IHRoZSBwcm92aWRlciBkaXNjb25uZWN0ZWQgYmVmb3JlIGNvbXBsZXRpb24uXCI7XG4gIGNvbnN0IGRpYWdub3N0aWNDb2RlID0gXCJFWEVDVVRJT05fUFJPVklERVJfRkFJTFVSRVwiO1xuICBjb25zdCB0b29sVHJhY2UgPSBbXG4gICAge1xuICAgICAga2luZDogXCJkb25lXCIsXG4gICAgICBzdG9wUmVhc29uOiBcInByb3ZpZGVyX3RpbWVvdXRcIixcbiAgICAgIGl0ZXJhdGlvbnM6IDEsXG4gICAgICBtYXhJdGVyYXRpb25zOiA4LFxuICAgICAgdG9vbENhbGxzOiAwLFxuICAgICAgcHJlZmV0Y2hUb29sQ2FsbHM6IDAsXG4gICAgICBsb29wVG9vbENhbGxzOiAwLFxuICAgICAgc3ludGhlc2lzU3RhcnRlZDogZmFsc2UsXG4gICAgICBkaWFnbm9zdGljQ29kZXM6IFtkaWFnbm9zdGljQ29kZV0sXG4gICAgICBkaWFnbm9zdGljRGV0YWlsczogW1xuICAgICAgICBcIlRoZSBwcm92aWRlciBkaXNjb25uZWN0ZWQgYWZ0ZXIgdmlzaWJsZSByZXNwb25zZSB0ZXh0LlwiLFxuICAgICAgXSxcbiAgICB9LFxuICBdO1xuICBjb25zdCBtZXNzYWdlID0ge1xuICAgIGlkOiBcImUyZS1kaXNjb25uZWN0ZWQtYWktbWVzc2FnZVwiLFxuICAgIHNlc3Npb25JZCxcbiAgICByb2xlOiBcImFzc2lzdGFudFwiLFxuICAgIGNvbnRlbnQ6IGFuc3dlcixcbiAgICB0b29sVHJhY2U6IEpTT04uc3RyaW5naWZ5KHRvb2xUcmFjZSksXG4gICAgb3V0Y29tZTogXCJGQUlMRURcIixcbiAgICBlcnJvckNvZGU6IGRpYWdub3N0aWNDb2RlLFxuICAgIGVycm9yTWVzc2FnZTogXCJUaGUgcHJvdmlkZXIgZGlzY29ubmVjdGVkIGJlZm9yZSBjb21wbGV0aW9uLlwiLFxuICAgIGV4ZWN1dGlvbklkLFxuICAgIGNyZWF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAyOjAwLjAwMFpcIixcbiAgfTtcbiAgY29uc3Qgc3NlID0gKGV2ZW50OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPikgPT5cbiAgICBgZGF0YTogJHtKU09OLnN0cmluZ2lmeShldmVudCl9XFxuXFxuYDtcbiAgY29uc3Qgc3RyZWFtQm9keSA9IFtcbiAgICBzc2UoeyB0eXBlOiBcInNlc3Npb25fc3RhcnRlZFwiLCBzZXNzaW9uSWQgfSksXG4gICAgc3NlKHtcbiAgICAgIHR5cGU6IFwiZXhlY3V0aW9uX3N0YXJ0ZWRcIixcbiAgICAgIGV4ZWN1dGlvbklkLFxuICAgICAgc3RhdHVzOiBcInJ1bm5pbmdcIixcbiAgICAgIHJlc3VtYWJsZTogdHJ1ZSxcbiAgICB9KSxcbiAgICBzc2UoeyB0eXBlOiBcInN0YWdlXCIsIHN0YWdlOiBcImNhbGxpbmctbW9kZWxcIiB9KSxcbiAgICBzc2UoeyB0eXBlOiBcImRlbHRhXCIsIGRlbHRhOiBhbnN3ZXIgfSksXG4gICAgLy8gVGhlIHJlYWwgcm91dGUgZW1pdHMgdGhpcyBhZnRlciBhIHByb3ZpZGVyIGRpc2Nvbm5lY3Qgc28gdGhlIGNsaWVudFxuICAgIC8vIGRyb3BzIHRoZSB0cmFuc2llbnQgYnViYmxlIGJlZm9yZSByZW5kZXJpbmcgdGhlIHBlcnNpc3RlZCByZXN1bHQuXG4gICAgc3NlKHsgdHlwZTogXCJzdHJlYW1fcmVzZXRcIiB9KSxcbiAgICBzc2Uoe1xuICAgICAgdHlwZTogXCJkb25lXCIsXG4gICAgICBzZXNzaW9uSWQsXG4gICAgICBleGVjdXRpb25JZCxcbiAgICAgIG1lc3NhZ2UsXG4gICAgICBwZW5kaW5nQ2hhbmdlczogW10sXG4gICAgfSksXG4gIF0uam9pbihcIlwiKTtcblxuICByZXR1cm4ge1xuICAgIHF1ZXN0aW9uLFxuICAgIGFuc3dlcixcbiAgICBzb3VyY2U6IFwicHJvdmlkZXJcIixcbiAgICBzZXNzaW9uSWQsXG4gICAgZXhlY3V0aW9uSWQsXG4gICAgc3RyZWFtQm9keSxcbiAgICBtZXNzYWdlLFxuICB9O1xufVxuXG5mdW5jdGlvbiBpbnN0YWxsUmVzdW1lZEFuYWx5c2lzRmFpbHVyZUZpeHR1cmUoKSB7XG4gIGNvbnN0IHNlc3Npb25JZCA9IFwiZTJlLXJlc3VtZWQtYW5hbHlzaXMtZmFpbHVyZS1zZXNzaW9uXCI7XG4gIGNvbnN0IGV4ZWN1dGlvbklkID0gXCJlMmUtcmVzdW1lZC1hbmFseXNpcy1mYWlsdXJlLWV4ZWN1dGlvblwiO1xuICBjb25zdCByZXN1bWVUb2tlbiA9IFwiZTJlLXJlc3VtZWQtYW5hbHlzaXMtZmFpbHVyZS10b2tlbi1vcGFxdWVcIjtcbiAgY29uc3QgcXVlc3Rpb24gPSBcIlZlcmlmeSB0aGUgYW5hbHlzaXMgZXZpZGVuY2UgYWZ0ZXIgcmVjb25uZWN0LlwiO1xuICBjb25zdCBhbnN3ZXIgPVxuICAgIFwiQU5BTFlTSVNfSU5DT01QTEVURTogVGhlIHJlcXVpcmVkIGFuYWx5c2lzIGRpZCBub3QgY29tcGxldGUsIHNvIG5vIHZlcmlmaWVkIHJlc3VsdCBpcyBhdmFpbGFibGUuXCI7XG4gIGNvbnN0IGRpYWdub3N0aWNDb2RlID0gXCJUT09MX1VOQVZBSUxBQkxFXCI7XG4gIGNvbnN0IHNzZSA9IChldmVudDogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pID0+XG4gICAgYGRhdGE6ICR7SlNPTi5zdHJpbmdpZnkoZXZlbnQpfVxcblxcbmA7XG4gIGNvbnN0IHN0cmVhbUJvZHkgPSBbXG4gICAgc3NlKHsgdHlwZTogXCJzZXNzaW9uX3N0YXJ0ZWRcIiwgc2Vzc2lvbklkIH0pLFxuICAgIHNzZSh7XG4gICAgICB0eXBlOiBcImV4ZWN1dGlvbl9zdGFydGVkXCIsXG4gICAgICBleGVjdXRpb25JZCxcbiAgICAgIHN0YXR1czogXCJydW5uaW5nXCIsXG4gICAgICByZXN1bWFibGU6IHRydWUsXG4gICAgICByZXN1bWVUb2tlbixcbiAgICB9KSxcbiAgICBzc2Uoe1xuICAgICAgdHlwZTogXCJlcnJvclwiLFxuICAgICAgZXhlY3V0aW9uSWQsXG4gICAgICBjb2RlOiBkaWFnbm9zdGljQ29kZSxcbiAgICAgIG1lc3NhZ2U6IFwiVGhlIHJlcXVpcmVkIGFuYWx5c2lzIGRpZCBub3QgY29tcGxldGUuXCIsXG4gICAgfSksXG4gIF0uam9pbihcIlwiKTtcbiAgY29uc3QgZml4dHVyZTogQXJhYmljQWlGaXh0dXJlID0ge1xuICAgIHF1ZXN0aW9uLFxuICAgIGFuc3dlcixcbiAgICBzb3VyY2U6IFwic3JjL21pc3NpbmctYW5hbHlzaXMtdG9vbC50c1wiLFxuICAgIHNlc3Npb25JZCxcbiAgICBleGVjdXRpb25JZCxcbiAgICBzdHJlYW1Cb2R5LFxuICAgIG1lc3NhZ2U6IHtcbiAgICAgIGlkOiBcImUyZS1yZXN1bWVkLWFuYWx5c2lzLWZhaWx1cmUtbWVzc2FnZVwiLFxuICAgICAgc2Vzc2lvbklkLFxuICAgICAgcm9sZTogXCJhc3Npc3RhbnRcIixcbiAgICAgIGNvbnRlbnQ6IGFuc3dlcixcbiAgICAgIG91dGNvbWU6IFwiRkFJTEVEXCIsXG4gICAgICBleGVjdXRpb25JZCxcbiAgICAgIGVycm9yQ29kZTogZGlhZ25vc3RpY0NvZGUsXG4gICAgICBlcnJvck1lc3NhZ2U6IFwiVGhlIHJlcXVpcmVkIGFuYWx5c2lzIGRpZCBub3QgY29tcGxldGUuXCIsXG4gICAgICBjcmVhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMjowMC4wMDBaXCIsXG4gICAgfSxcbiAgfTtcblxuICByZXR1cm4ge1xuICAgIGZpeHR1cmUsXG4gICAgZXhlY3V0aW9uOiB7XG4gICAgICBpZDogZXhlY3V0aW9uSWQsXG4gICAgICBwcm9qZWN0SWQ6IFwiZTJlLXByb2plY3RcIixcbiAgICAgIG9wZXJhdGlvbklkOiBcImUyZS1yZXN1bWVkLWFuYWx5c2lzLWZhaWx1cmUtb3BlcmF0aW9uXCIsXG4gICAgICBzZXNzaW9uSWQsXG4gICAgICBzdGF0dXM6IFwiZmFpbGVkXCIsXG4gICAgICBmbGlnaHRTdGF0ZTogXCJGQUlMRURcIixcbiAgICAgIGV2aWRlbmNlVmVyZGljdDogXCJJTkNPTVBMRVRFXCIsXG4gICAgICBwcm9vZlJlcXVpcmVkOiB0cnVlLFxuICAgICAgcmVzdW1hYmxlOiB0cnVlLFxuICAgICAgY2hlY2twb2ludFZlcnNpb246IDEsXG4gICAgICBjaGVja3BvaW50OiB7XG4gICAgICAgIHN0YWdlOiBcInRvb2wtZXhlY3V0aW9uXCIsXG4gICAgICAgIGRldGFpbDogXCJUaGUgcmVxdWlyZWQgYW5hbHlzaXMgdG9vbCB3YXMgdW5hdmFpbGFibGUuXCIsXG4gICAgICB9LFxuICAgICAgb2JqZWN0aXZlOiB7IG9iamVjdGl2ZTogcXVlc3Rpb24gfSxcbiAgICAgIGVycm9yOiBcIlRoZSByZXF1aXJlZCBhbmFseXNpcyBkaWQgbm90IGNvbXBsZXRlLlwiLFxuICAgICAgc3RhcnRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDE6MDAuMDAwWlwiLFxuICAgICAgY3JlYXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDE6MDAuMDAwWlwiLFxuICAgICAgdXBkYXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDI6MDAuMDAwWlwiLFxuICAgIH0sXG4gIH07XG59XG5cbmZ1bmN0aW9uIGluc3RhbGxJbnRlcnJ1cHRlZFJlc3VtZUZpeHR1cmUoKSB7XG4gIGNvbnN0IHNlc3Npb25JZCA9IFwiZTJlLWludGVycnVwdGVkLXJlc3VtZS1zZXNzaW9uXCI7XG4gIGNvbnN0IGV4ZWN1dGlvbklkID0gXCJlMmUtaW50ZXJydXB0ZWQtcmVzdW1lLWV4ZWN1dGlvblwiO1xuICBjb25zdCBpbml0aWFsVG9rZW4gPSBcImUyZS1pbnRlcnJ1cHRlZC1pbml0aWFsLXRva2VuXCI7XG4gIGNvbnN0IHJlY292ZXJlZFRva2VuID0gXCJlMmUtaW50ZXJydXB0ZWQtcmVjb3ZlcmVkLXRva2VuXCI7XG4gIGNvbnN0IHF1ZXN0aW9uID0gXCJDb250aW51ZSB0aGUgaW50ZXJydXB0ZWQgcmVsZWFzZSBleGVjdXRpb24uXCI7XG4gIGNvbnN0IHBhcnRpYWxBbnN3ZXIgPVxuICAgIFwiVGhlIHJlbGVhc2UgZXhlY3V0aW9uIHN0YXJ0ZWQgYmVmb3JlIHRoZSBicm93c2VyIGRpc2Nvbm5lY3RlZC5cIjtcbiAgY29uc3QgYW5zd2VyID1cbiAgICBcIlRoZSBvcmlnaW5hbCByZWxlYXNlIGV4ZWN1dGlvbiByZXN1bWVkIGFmdGVyIGNhcGFiaWxpdHkgcmVjb3ZlcnkuXCI7XG4gIGNvbnN0IG1lc3NhZ2UgPSB7XG4gICAgaWQ6IFwiZTJlLWludGVycnVwdGVkLXJlc3VtZS1tZXNzYWdlXCIsXG4gICAgc2Vzc2lvbklkLFxuICAgIHJvbGU6IFwiYXNzaXN0YW50XCIsXG4gICAgY29udGVudDogYW5zd2VyLFxuICAgIGV4ZWN1dGlvbklkLFxuICAgIG91dGNvbWU6IFwiQ09NUExFVEVEXCIsXG4gICAgY3JlYXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDM6MDAuMDAwWlwiLFxuICB9O1xuICBjb25zdCBzc2UgPSAoZXZlbnQ6IFJlY29yZDxzdHJpbmcsIHVua25vd24+KSA9PlxuICAgIGBkYXRhOiAke0pTT04uc3RyaW5naWZ5KGV2ZW50KX1cXG5cXG5gO1xuICBjb25zdCBmaXh0dXJlOiBBcmFiaWNBaUZpeHR1cmUgPSB7XG4gICAgcXVlc3Rpb24sXG4gICAgYW5zd2VyLFxuICAgIHNvdXJjZTogXCJyZWxlYXNlLXJlc3VtZVwiLFxuICAgIHNlc3Npb25JZCxcbiAgICBleGVjdXRpb25JZCxcbiAgICBzdHJlYW1Cb2R5OiBbXG4gICAgICBzc2UoeyB0eXBlOiBcInNlc3Npb25fc3RhcnRlZFwiLCBzZXNzaW9uSWQgfSksXG4gICAgICBzc2Uoe1xuICAgICAgICB0eXBlOiBcImV4ZWN1dGlvbl9zdGFydGVkXCIsXG4gICAgICAgIGV4ZWN1dGlvbklkLFxuICAgICAgICBzdGF0dXM6IFwicnVubmluZ1wiLFxuICAgICAgICByZXN1bWFibGU6IHRydWUsXG4gICAgICAgIHJlc3VtZVRva2VuOiBpbml0aWFsVG9rZW4sXG4gICAgICB9KSxcbiAgICAgIHNzZSh7IHR5cGU6IFwic3RhZ2VcIiwgc3RhZ2U6IFwiY2FsbGluZy1tb2RlbFwiIH0pLFxuICAgICAgc3NlKHsgdHlwZTogXCJkZWx0YVwiLCBkZWx0YTogcGFydGlhbEFuc3dlciB9KSxcbiAgICBdLmpvaW4oXCJcIiksXG4gICAgbWVzc2FnZSxcbiAgfTtcbiAgcmV0dXJuIHtcbiAgICBmaXh0dXJlLFxuICAgIGluaXRpYWxUb2tlbixcbiAgICByZWNvdmVyZWRUb2tlbixcbiAgICByZXN1bWVkU3RyZWFtQm9keTogW1xuICAgICAgc3NlKHsgdHlwZTogXCJzZXNzaW9uX3N0YXJ0ZWRcIiwgc2Vzc2lvbklkIH0pLFxuICAgICAgc3NlKHtcbiAgICAgICAgdHlwZTogXCJleGVjdXRpb25fc3RhcnRlZFwiLFxuICAgICAgICBleGVjdXRpb25JZCxcbiAgICAgICAgc3RhdHVzOiBcInJ1bm5pbmdcIixcbiAgICAgICAgcmVzdW1hYmxlOiB0cnVlLFxuICAgICAgICByZXN1bWVUb2tlbjogcmVjb3ZlcmVkVG9rZW4sXG4gICAgICB9KSxcbiAgICAgIHNzZSh7IHR5cGU6IFwic3RhZ2VcIiwgc3RhZ2U6IFwicmVzdW1pbmctY2hlY2twb2ludFwiIH0pLFxuICAgICAgc3NlKHsgdHlwZTogXCJkZWx0YVwiLCBkZWx0YTogYW5zd2VyIH0pLFxuICAgICAgc3NlKHtcbiAgICAgICAgdHlwZTogXCJkb25lXCIsXG4gICAgICAgIHNlc3Npb25JZCxcbiAgICAgICAgZXhlY3V0aW9uSWQsXG4gICAgICAgIG1lc3NhZ2UsXG4gICAgICAgIHBlbmRpbmdDaGFuZ2VzOiBbXSxcbiAgICAgIH0pLFxuICAgIF0uam9pbihcIlwiKSxcbiAgICBleGVjdXRpb246IHtcbiAgICAgIGlkOiBleGVjdXRpb25JZCxcbiAgICAgIHByb2plY3RJZDogXCJlMmUtcHJvamVjdFwiLFxuICAgICAgb3BlcmF0aW9uSWQ6IFwiZTJlLWludGVycnVwdGVkLXJlc3VtZS1vcGVyYXRpb25cIixcbiAgICAgIHNlc3Npb25JZCxcbiAgICAgIHN0YXR1czogXCJwYXVzZWRcIixcbiAgICAgIGZsaWdodFN0YXRlOiBcIlBBVVNFRFwiLFxuICAgICAgcmVzdW1hYmxlOiB0cnVlLFxuICAgICAgY2hlY2twb2ludFZlcnNpb246IDEsXG4gICAgICBjaGVja3BvaW50OiB7XG4gICAgICAgIHN0YWdlOiBcImNhbGxpbmctbW9kZWxcIixcbiAgICAgICAgZGV0YWlsOlxuICAgICAgICAgIFwiVGhlIGJyb3dzZXIgdHJhbnNwb3J0IGRpc2Nvbm5lY3RlZCBhZnRlciB0aGUgZXhlY3V0aW9uIHN0YXJ0ZWQuXCIsXG4gICAgICB9LFxuICAgICAgb2JqZWN0aXZlOiB7IG9iamVjdGl2ZTogcXVlc3Rpb24gfSxcbiAgICAgIHN0YXJ0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAxOjAwLjAwMFpcIixcbiAgICAgIGNyZWF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAxOjAwLjAwMFpcIixcbiAgICAgIHVwZGF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAyOjAwLjAwMFpcIixcbiAgICB9LFxuICB9O1xufVxuXG5hc3luYyBmdW5jdGlvbiBjcmVhdGVSZWxlYXNlU2lnbkluVXJsKHBhZ2U6IFBhZ2UpIHtcbiAgY29uc3Qgc2VjcmV0S2V5ID0gcHJvY2Vzcy5lbnYuQ0xFUktfU0VDUkVUX0tFWTtcbiAgaWYgKCFzZWNyZXRLZXkpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICBcIkNMRVJLX1NFQ1JFVF9LRVkgaXMgcmVxdWlyZWQgZm9yIHRoZSByZWxlYXNlLW9ubHkgcHJvZ3JhbW1hdGljIENsZXJrIGhhbmRvZmYuXCIsXG4gICAgKTtcbiAgfVxuXG4gIGNvbnN0IGhlYWRlcnMgPSB7XG4gICAgQXV0aG9yaXphdGlvbjogYEJlYXJlciAke3NlY3JldEtleX1gLFxuICAgIFwiQ29udGVudC1UeXBlXCI6IFwiYXBwbGljYXRpb24vanNvblwiLFxuICB9O1xuICBjb25zdCB1c2VyUmVzcG9uc2UgPSBhd2FpdCBwYWdlLnJlcXVlc3QuZ2V0KFxuICAgIGBodHRwczovL2FwaS5jbGVyay5jb20vdjEvdXNlcnM/ZW1haWxfYWRkcmVzcz0ke2VuY29kZVVSSUNvbXBvbmVudChURVNUX1VTRVIuZW1haWwpfWAsXG4gICAgeyBoZWFkZXJzIH0sXG4gICk7XG4gIGxldCB1c2VySWQgPSBwYXJzZUNsZXJrVXNlckxvb2t1cFJlc3BvbnNlKGF3YWl0IHVzZXJSZXNwb25zZS5qc29uKCkpO1xuXG4gIGlmICghdXNlcklkKSB7XG4gICAgY29uc3QgY3JlYXRlZFJlc3BvbnNlID0gYXdhaXQgcGFnZS5yZXF1ZXN0LnBvc3QoXG4gICAgICBcImh0dHBzOi8vYXBpLmNsZXJrLmNvbS92MS91c2Vyc1wiLFxuICAgICAge1xuICAgICAgICBoZWFkZXJzLFxuICAgICAgICBkYXRhOiB7XG4gICAgICAgICAgZW1haWxfYWRkcmVzczogW1RFU1RfVVNFUi5lbWFpbF0sXG4gICAgICAgICAgZmlyc3RfbmFtZTogVEVTVF9VU0VSLmZpcnN0TmFtZSxcbiAgICAgICAgICBsYXN0X25hbWU6IFRFU1RfVVNFUi5sYXN0TmFtZSxcbiAgICAgICAgICBza2lwX3Bhc3N3b3JkX2NoZWNrczogdHJ1ZSxcbiAgICAgICAgICBza2lwX3Bhc3N3b3JkX3JlcXVpcmVtZW50OiB0cnVlLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICApO1xuICAgIHVzZXJJZCA9IHBhcnNlQ3JlYXRlZENsZXJrVXNlclJlc3BvbnNlKGF3YWl0IGNyZWF0ZWRSZXNwb25zZS5qc29uKCkpO1xuICB9XG5cbiAgaWYgKCF1c2VySWQpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICBcIlRoZSBpc29sYXRlZCBDbGVyayByZWxlYXNlIHVzZXIgY291bGQgbm90IGJlIHByb3Zpc2lvbmVkLlwiLFxuICAgICk7XG4gIH1cblxuICBjb25zdCB0b2tlblJlc3BvbnNlID0gYXdhaXQgcGFnZS5yZXF1ZXN0LnBvc3QoXG4gICAgXCJodHRwczovL2FwaS5jbGVyay5jb20vdjEvc2lnbl9pbl90b2tlbnNcIixcbiAgICB7IGhlYWRlcnMsIGRhdGE6IHsgdXNlcl9pZDogdXNlcklkIH0gfSxcbiAgKTtcbiAgY29uc3QgdG9rZW4gPSBwYXJzZUNsZXJrU2lnbkluVG9rZW5SZXNwb25zZShhd2FpdCB0b2tlblJlc3BvbnNlLmpzb24oKSk7XG5cbiAgcmV0dXJuIGAke25ldyBVUkwoREFTSEJPQVJEX1BBVEgsIHBhZ2UudXJsKCkpLnRvU3RyaW5nKCl9c2lnbi1pbj9fX2NsZXJrX3RpY2tldD0ke2VuY29kZVVSSUNvbXBvbmVudCh0b2tlbil9YDtcbn1cblxuYXN5bmMgZnVuY3Rpb24gcHJvZ3JhbW1hdGljU2lnbkluKHBhZ2U6IFBhZ2UpIHtcbiAgYXdhaXQgcGFnZS5nb3RvKERBU0hCT0FSRF9QQVRIKTtcbiAgYXdhaXQgZXhwZWN0KFxuICAgIHBhZ2UuZ2V0QnlSb2xlKFwibGlua1wiLCB7IG5hbWU6IFwiU2lnbiBJblwiLCBleGFjdDogdHJ1ZSB9KSxcbiAgKS50b0JlVmlzaWJsZSgpO1xuXG4gIGNvbnN0IGhlbHBlciA9XG4gICAgZ2xvYmFsVGhpcy5zaWduSW5DbGVya1VzZXIgPz9cbiAgICBnbG9iYWxUaGlzLl9fRU5HSU5FRVJJTkdPU19TSUdOX0lOX0NMRVJLX1VTRVJfXztcbiAgaWYgKCFoZWxwZXIpIHtcbiAgICBpZiAocHJvY2Vzcy5lbnYuUlVOX0NPTlRST0xMRURfUkVMRUFTRV9WQUxJREFUSU9OICE9PSBcIjFcIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICBcIkNsZXJrIGJyb3dzZXIgaGVscGVyIGlzIHVuYXZhaWxhYmxlLiBSdW4gdGhpcyBqb3VybmV5IGluIHRoZSBSZXBsaXQgYnJvd3NlciBydW5uZXIsIHdoaWNoIGluamVjdHMgc2lnbkluQ2xlcmtVc2VyLlwiLFxuICAgICAgKTtcbiAgICB9XG4gICAgYXdhaXQgcGFnZS5nb3RvKGF3YWl0IGNyZWF0ZVJlbGVhc2VTaWduSW5VcmwocGFnZSkpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlKS50b0hhdmVVUkwoXG4gICAgICBuZXcgUmVnRXhwKGAke0RBU0hCT0FSRF9QQVRILnJlcGxhY2VBbGwoXCIvXCIsIFwiXFxcXC9cIil9JGApLFxuICAgICk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IHNpZ25JblVybCA9IGF3YWl0IGhlbHBlcih7XG4gICAgLi4uVEVTVF9VU0VSLFxuICAgIHR0bDogOTAwLFxuICAgIGJhc2VQYXRoOiBEQVNIQk9BUkRfUEFUSCxcbiAgfSk7XG4gIGF3YWl0IHBhZ2UuZ290byhzaWduSW5VcmwpO1xuICBhd2FpdCBleHBlY3QocGFnZSkudG9IYXZlVVJMKFxuICAgIG5ldyBSZWdFeHAoYCR7REFTSEJPQVJEX1BBVEgucmVwbGFjZUFsbChcIi9cIiwgXCJcXFxcL1wiKX0kYCksXG4gICk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIG9wZW5OYXZpZ2F0aW9uKHBhZ2U6IFBhZ2UsIGxhYmVsOiBzdHJpbmcsIHBhdGg6IHN0cmluZykge1xuICBhd2FpdCBwYWdlLmdldEJ5Um9sZShcImxpbmtcIiwgeyBuYW1lOiBsYWJlbCwgZXhhY3Q6IHRydWUgfSkuY2xpY2soKTtcbiAgYXdhaXQgZXhwZWN0KHBhZ2UpLnRvSGF2ZVVSTChuZXcgUmVnRXhwKGAke3BhdGgucmVwbGFjZUFsbChcIi9cIiwgXCJcXFxcL1wiKX0kYCkpO1xufVxuXG5mdW5jdGlvbiBhcGlVcmwocGFnZTogUGFnZSwgcGF0aDogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgYXBpQmFzZVVybCA9IHByb2Nlc3MuZW52LkRBU0hCT0FSRF9FMkVfQVBJX0JBU0VfVVJMO1xuICByZXR1cm4gbmV3IFVSTChwYXRoLCBhcGlCYXNlVXJsID8gYXBpQmFzZVVybCA6IHBhZ2UudXJsKCkpLnRvU3RyaW5nKCk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGxpdmVSZXF1ZXN0KFxuICBwYWdlOiBQYWdlLFxuICBwYXRoOiBzdHJpbmcsXG4gIG9wdGlvbnM/OiB7IG1ldGhvZD86IHN0cmluZzsgYm9keT86IHVua25vd247IHRpbWVvdXQ/OiBudW1iZXIgfSxcbik6IFByb21pc2U8eyBzdGF0dXM6IG51bWJlcjsgYm9keTogc3RyaW5nIH0+IHtcbiAgcmV0dXJuIHBhZ2UuZXZhbHVhdGUoXG4gICAgYXN5bmMgKHsgdXJsLCBtZXRob2QsIGJvZHksIHRpbWVvdXQgfSkgPT4ge1xuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBmZXRjaCh1cmwsIHtcbiAgICAgICAgbWV0aG9kLFxuICAgICAgICBjcmVkZW50aWFsczogXCJpbmNsdWRlXCIsXG4gICAgICAgIGhlYWRlcnM6XG4gICAgICAgICAgYm9keSA9PT0gdW5kZWZpbmVkXG4gICAgICAgICAgICA/IHVuZGVmaW5lZFxuICAgICAgICAgICAgOiB7IFwiQ29udGVudC1UeXBlXCI6IFwiYXBwbGljYXRpb24vanNvblwiIH0sXG4gICAgICAgIGJvZHk6IGJvZHkgPT09IHVuZGVmaW5lZCA/IHVuZGVmaW5lZCA6IEpTT04uc3RyaW5naWZ5KGJvZHkpLFxuICAgICAgICBzaWduYWw6IHRpbWVvdXQgPyBBYm9ydFNpZ25hbC50aW1lb3V0KHRpbWVvdXQpIDogdW5kZWZpbmVkLFxuICAgICAgfSk7XG4gICAgICByZXR1cm4geyBzdGF0dXM6IHJlc3BvbnNlLnN0YXR1cywgYm9keTogYXdhaXQgcmVzcG9uc2UudGV4dCgpIH07XG4gICAgfSxcbiAgICB7XG4gICAgICB1cmw6IGFwaVVybChwYWdlLCBwYXRoKSxcbiAgICAgIG1ldGhvZDogb3B0aW9ucz8ubWV0aG9kID8/IFwiR0VUXCIsXG4gICAgICBib2R5OiBvcHRpb25zPy5ib2R5LFxuICAgICAgdGltZW91dDogb3B0aW9ucz8udGltZW91dCxcbiAgICB9LFxuICApO1xufVxuXG50eXBlIE9yaWdpbkRpYWdub3N0aWMgPSB7XG4gIG9yaWdpbjogc3RyaW5nO1xuICBwaGFzZTogXCJHRVRcIiB8IFwicHJlZmxpZ2h0XCIgfCBcIm11dGF0aW9uXCIgfCBcInJlamVjdGlvblwiO1xuICBzdGF0dXM/OiBudW1iZXI7XG4gIGhlYWRlcnM/OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+O1xuICBlcnJvcj86IHN0cmluZztcbn07XG5jb25zdCByZWNvcmRlZE9yaWdpbkRpYWdub3N0aWNzOiBPcmlnaW5EaWFnbm9zdGljW10gPSBbXTtcblxuZnVuY3Rpb24gb3JpZ2luRGlhZ25vc3RpY1BhdGgoKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgcmV0dXJuIHByb2Nlc3MuZW52LkRBU0hCT0FSRF9FMkVfT1JJR0lOX0RJQUdOT1NUSUNTX1BBVEg7XG59XG5cbmZ1bmN0aW9uIHJlbGV2YW50T3JpZ2luSGVhZGVycyhcbiAgaGVhZGVyczogUmVjb3JkPHN0cmluZywgc3RyaW5nPixcbik6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4ge1xuICByZXR1cm4gT2JqZWN0LmZyb21FbnRyaWVzKFxuICAgIE9SSUdJTl9ESUFHTk9TVElDX0hFQURFUlMuZmxhdE1hcCgobmFtZSkgPT5cbiAgICAgIGhlYWRlcnNbbmFtZV0gPyBbW25hbWUsIGhlYWRlcnNbbmFtZV1dXSA6IFtdLFxuICAgICksXG4gICk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHdyaXRlT3JpZ2luRGlhZ25vc3RpY3MoKSB7XG4gIGNvbnN0IG91dHB1dFBhdGggPSBvcmlnaW5EaWFnbm9zdGljUGF0aCgpO1xuICBpZiAoIW91dHB1dFBhdGgpIHJldHVybjtcbiAgYXdhaXQgbWtkaXIoZGlybmFtZShvdXRwdXRQYXRoKSwgeyByZWN1cnNpdmU6IHRydWUgfSk7XG4gIGF3YWl0IHdyaXRlRmlsZShcbiAgICBvdXRwdXRQYXRoLFxuICAgIGAke0pTT04uc3RyaW5naWZ5KHsgZGlhZ25vc3RpY3M6IHJlY29yZGVkT3JpZ2luRGlhZ25vc3RpY3MgfSwgbnVsbCwgMil9XFxuYCxcbiAgICBcInV0ZjhcIixcbiAgKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZXhwZWN0T3JpZ2luQ2FuVXNlQXBpKHBhZ2U6IFBhZ2UsIG9yaWdpbjogc3RyaW5nKSB7XG4gIGNvbnN0IGFwaUJhc2VVcmwgPSBwcm9jZXNzLmVudi5EQVNIQk9BUkRfRTJFX0FQSV9CQVNFX1VSTDtcbiAgaWYgKCFhcGlCYXNlVXJsKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgXCJEQVNIQk9BUkRfRTJFX0FQSV9CQVNFX1VSTCBpcyByZXF1aXJlZCBmb3Igb3JpZ2luIGNoZWNrcy5cIixcbiAgICApO1xuICB9XG4gIGNvbnN0IGhlYWx0aFVybCA9IG5ldyBVUkwoXCIvYXBpL2hlYWx0aHpcIiwgYXBpQmFzZVVybCkudG9TdHJpbmcoKTtcbiAgY29uc3QgbXV0YXRpb25VcmwgPSBuZXcgVVJMKFwiL2FwaS9haS9jaGF0XCIsIGFwaUJhc2VVcmwpLnRvU3RyaW5nKCk7XG4gIGNvbnN0IGNvbW1vbkhlYWRlcnMgPSB7IE9yaWdpbjogb3JpZ2luIH07XG5cbiAgY29uc3QgZGlhZ25vc3RpY3M6IE9yaWdpbkRpYWdub3N0aWNbXSA9IFtdO1xuICBjb25zdCBjaGVjayA9IGFzeW5jIChcbiAgICBwaGFzZTogT3JpZ2luRGlhZ25vc3RpY1tcInBoYXNlXCJdLFxuICAgIHJlcXVlc3Q6ICgpID0+IFByb21pc2U8aW1wb3J0KFwiQHBsYXl3cmlnaHQvdGVzdFwiKS5BUElSZXNwb25zZT4sXG4gICAgYXNzZXJ0aW9uOiAoXG4gICAgICByZXNwb25zZTogaW1wb3J0KFwiQHBsYXl3cmlnaHQvdGVzdFwiKS5BUElSZXNwb25zZSxcbiAgICApID0+IFByb21pc2U8dm9pZD4sXG4gICkgPT4ge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHJlcXVlc3QoKTtcbiAgICAgIGRpYWdub3N0aWNzLnB1c2goe1xuICAgICAgICBvcmlnaW4sXG4gICAgICAgIHBoYXNlLFxuICAgICAgICBzdGF0dXM6IHJlc3BvbnNlLnN0YXR1cygpLFxuICAgICAgICBoZWFkZXJzOiByZWxldmFudE9yaWdpbkhlYWRlcnMocmVzcG9uc2UuaGVhZGVycygpKSxcbiAgICAgIH0pO1xuICAgICAgcmVjb3JkZWRPcmlnaW5EaWFnbm9zdGljcy5wdXNoKGRpYWdub3N0aWNzLmF0KC0xKSEpO1xuICAgICAgYXdhaXQgYXNzZXJ0aW9uKHJlc3BvbnNlKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc3QgY3VycmVudCA9IGRpYWdub3N0aWNzLmF0KC0xKTtcbiAgICAgIGlmIChjdXJyZW50Py5waGFzZSAhPT0gcGhhc2UpIHtcbiAgICAgICAgZGlhZ25vc3RpY3MucHVzaCh7IG9yaWdpbiwgcGhhc2UgfSk7XG4gICAgICB9XG4gICAgICBkaWFnbm9zdGljcy5hdCgtMSkhLmVycm9yID0gXCJvcmlnaW4gY2hlY2sgZmFpbGVkXCI7XG4gICAgICBhd2FpdCB3cml0ZU9yaWdpbkRpYWdub3N0aWNzKCk7XG4gICAgICB0aHJvdyBlcnJvcjtcbiAgICB9XG4gIH07XG5cbiAgYXdhaXQgY2hlY2soXG4gICAgXCJHRVRcIixcbiAgICAoKSA9PiBwYWdlLnJlcXVlc3QuZ2V0KGhlYWx0aFVybCwgeyBoZWFkZXJzOiBjb21tb25IZWFkZXJzIH0pLFxuICAgIGFzeW5jIChyZXNwb25zZSkgPT4ge1xuICAgICAgZXhwZWN0KHJlc3BvbnNlLnN0YXR1cygpLCBgJHtvcmlnaW59IGNyZWRlbnRpYWxlZCBHRVQgc3RhdHVzYCkudG9CZSgyMDApO1xuICAgICAgZXhwZWN0KHJlc3BvbnNlLmhlYWRlcnMoKVtcImFjY2Vzcy1jb250cm9sLWFsbG93LW9yaWdpblwiXSkudG9CZShvcmlnaW4pO1xuICAgICAgZXhwZWN0KHJlc3BvbnNlLmhlYWRlcnMoKVtcImFjY2Vzcy1jb250cm9sLWFsbG93LWNyZWRlbnRpYWxzXCJdKS50b0JlKFxuICAgICAgICBcInRydWVcIixcbiAgICAgICk7XG4gICAgfSxcbiAgKTtcbiAgYXdhaXQgY2hlY2soXG4gICAgXCJwcmVmbGlnaHRcIixcbiAgICAoKSA9PlxuICAgICAgcGFnZS5yZXF1ZXN0LmZldGNoKG11dGF0aW9uVXJsLCB7XG4gICAgICAgIG1ldGhvZDogXCJPUFRJT05TXCIsXG4gICAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgICAuLi5jb21tb25IZWFkZXJzLFxuICAgICAgICAgIFwiQWNjZXNzLUNvbnRyb2wtUmVxdWVzdC1NZXRob2RcIjogXCJQT1NUXCIsXG4gICAgICAgICAgXCJBY2Nlc3MtQ29udHJvbC1SZXF1ZXN0LUhlYWRlcnNcIjogXCJjb250ZW50LXR5cGVcIixcbiAgICAgICAgfSxcbiAgICAgIH0pLFxuICAgIGFzeW5jIChyZXNwb25zZSkgPT4ge1xuICAgICAgZXhwZWN0KHJlc3BvbnNlLnN0YXR1cygpLCBgJHtvcmlnaW59IG11dGF0aW9uIHByZWZsaWdodCBzdGF0dXNgKS50b0JlKFxuICAgICAgICAyMDQsXG4gICAgICApO1xuICAgICAgZXhwZWN0KHJlc3BvbnNlLmhlYWRlcnMoKVtcImFjY2Vzcy1jb250cm9sLWFsbG93LW9yaWdpblwiXSkudG9CZShvcmlnaW4pO1xuICAgICAgZXhwZWN0KFxuICAgICAgICByZXNwb25zZS5oZWFkZXJzKClbXCJhY2Nlc3MtY29udHJvbC1hbGxvdy1jcmVkZW50aWFsc1wiXSxcbiAgICAgICAgYCR7b3JpZ2lufSBtdXRhdGlvbiBwcmVmbGlnaHQgY3JlZGVudGlhbHNgLFxuICAgICAgKS50b0JlKFwidHJ1ZVwiKTtcbiAgICAgIGV4cGVjdChcbiAgICAgICAgcmVzcG9uc2VcbiAgICAgICAgICAuaGVhZGVycygpXG4gICAgICAgICAgW1wiYWNjZXNzLWNvbnRyb2wtYWxsb3ctbWV0aG9kc1wiXT8uc3BsaXQoXCIsXCIpXG4gICAgICAgICAgLm1hcCgobWV0aG9kKSA9PiBtZXRob2QudHJpbSgpLnRvVXBwZXJDYXNlKCkpLFxuICAgICAgICBgJHtvcmlnaW59IG11dGF0aW9uIHByZWZsaWdodCBtZXRob2RzYCxcbiAgICAgICkudG9Db250YWluKFwiUE9TVFwiKTtcbiAgICAgIGV4cGVjdChcbiAgICAgICAgcmVzcG9uc2VcbiAgICAgICAgICAuaGVhZGVycygpXG4gICAgICAgICAgW1wiYWNjZXNzLWNvbnRyb2wtYWxsb3ctaGVhZGVyc1wiXT8uc3BsaXQoXCIsXCIpXG4gICAgICAgICAgLm1hcCgoaGVhZGVyKSA9PiBoZWFkZXIudHJpbSgpLnRvTG93ZXJDYXNlKCkpLFxuICAgICAgICBgJHtvcmlnaW59IG11dGF0aW9uIHByZWZsaWdodCBoZWFkZXJzYCxcbiAgICAgICkudG9Db250YWluKFwiY29udGVudC10eXBlXCIpO1xuICAgIH0sXG4gICk7XG4gIGF3YWl0IGNoZWNrKFxuICAgIFwibXV0YXRpb25cIixcbiAgICAoKSA9PlxuICAgICAgcGFnZS5yZXF1ZXN0LnBvc3QobXV0YXRpb25VcmwsIHtcbiAgICAgICAgaGVhZGVyczogeyAuLi5jb21tb25IZWFkZXJzLCBcIkNvbnRlbnQtVHlwZVwiOiBcImFwcGxpY2F0aW9uL2pzb25cIiB9LFxuICAgICAgICBkYXRhOiB7IG1lc3NhZ2U6IFwib3JpZ2luIGNvbnRyYWN0XCIgfSxcbiAgICAgIH0pLFxuICAgIGFzeW5jIChyZXNwb25zZSkgPT4ge1xuICAgICAgZXhwZWN0KFxuICAgICAgICByZXNwb25zZS5zdGF0dXMoKSxcbiAgICAgICAgYCR7b3JpZ2lufSBzdGF0ZS1jaGFuZ2luZyByZXF1ZXN0IG11c3QgcGFzcyBvcmlnaW4gcHJvdGVjdGlvbmAsXG4gICAgICApLm5vdC50b0JlKDQwMyk7XG4gICAgICBleHBlY3QocmVzcG9uc2UuaGVhZGVycygpW1wiYWNjZXNzLWNvbnRyb2wtYWxsb3ctb3JpZ2luXCJdKS50b0JlKG9yaWdpbik7XG4gICAgICBleHBlY3QocmVzcG9uc2UuaGVhZGVycygpW1wiYWNjZXNzLWNvbnRyb2wtYWxsb3ctY3JlZGVudGlhbHNcIl0pLnRvQmUoXG4gICAgICAgIFwidHJ1ZVwiLFxuICAgICAgKTtcbiAgICB9LFxuICApO1xuICBhd2FpdCB3cml0ZU9yaWdpbkRpYWdub3N0aWNzKCk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGV4cGVjdEhvc3RpbGVPcmlnaW5SZWplY3RlZChwYWdlOiBQYWdlKSB7XG4gIGNvbnN0IGFwaUJhc2VVcmwgPSBwcm9jZXNzLmVudi5EQVNIQk9BUkRfRTJFX0FQSV9CQVNFX1VSTDtcbiAgaWYgKCFhcGlCYXNlVXJsKVxuICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgIFwiREFTSEJPQVJEX0UyRV9BUElfQkFTRV9VUkwgaXMgcmVxdWlyZWQgZm9yIG9yaWdpbiBjaGVja3MuXCIsXG4gICAgKTtcbiAgY29uc3QgbXV0YXRpb25VcmwgPSBuZXcgVVJMKFwiL2FwaS9haS9jaGF0XCIsIGFwaUJhc2VVcmwpLnRvU3RyaW5nKCk7XG4gIGNvbnN0IHVwbG9hZFVybCA9IG5ldyBVUkwoXCIvYXBpL3VwbG9hZC9hcmNoaXZlXCIsIGFwaUJhc2VVcmwpLnRvU3RyaW5nKCk7XG4gIGNvbnN0IGxpdmVVcGRhdGVVcmwgPSBuZXcgVVJMKFwiL2FwaS9haS9jaGF0L3N0cmVhbVwiLCBhcGlCYXNlVXJsKS50b1N0cmluZygpO1xuICBjb25zdCBkaWFnbm9zdGljOiBPcmlnaW5EaWFnbm9zdGljID0ge1xuICAgIG9yaWdpbjogSE9TVElMRV9PUklHSU4sXG4gICAgcGhhc2U6IFwicmVqZWN0aW9uXCIsXG4gIH07XG4gIHJlY29yZGVkT3JpZ2luRGlhZ25vc3RpY3MucHVzaChkaWFnbm9zdGljKTtcbiAgdHJ5IHtcbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHBhZ2UucmVxdWVzdC5wb3N0KG11dGF0aW9uVXJsLCB7XG4gICAgICBoZWFkZXJzOiB7XG4gICAgICAgIE9yaWdpbjogSE9TVElMRV9PUklHSU4sXG4gICAgICAgIFwiQ29udGVudC1UeXBlXCI6IFwiYXBwbGljYXRpb24vanNvblwiLFxuICAgICAgfSxcbiAgICAgIGRhdGE6IHsgbWVzc2FnZTogXCJob3N0aWxlIG9yaWdpbiBjb250cmFjdFwiIH0sXG4gICAgfSk7XG4gICAgZGlhZ25vc3RpYy5zdGF0dXMgPSByZXNwb25zZS5zdGF0dXMoKTtcbiAgICBkaWFnbm9zdGljLmhlYWRlcnMgPSByZWxldmFudE9yaWdpbkhlYWRlcnMocmVzcG9uc2UuaGVhZGVycygpKTtcbiAgICBleHBlY3QocmVzcG9uc2Uuc3RhdHVzKCkpLnRvQmUoNDAzKTtcbiAgICBleHBlY3QocmVzcG9uc2UuaGVhZGVycygpW1wiYWNjZXNzLWNvbnRyb2wtYWxsb3ctb3JpZ2luXCJdKS50b0JlVW5kZWZpbmVkKCk7XG4gICAgZXhwZWN0KFxuICAgICAgcmVzcG9uc2UuaGVhZGVycygpW1wiYWNjZXNzLWNvbnRyb2wtYWxsb3ctY3JlZGVudGlhbHNcIl0sXG4gICAgKS50b0JlVW5kZWZpbmVkKCk7XG5cbiAgICBjb25zdCBob3N0aWxlVXBsb2FkID0gYXdhaXQgcGFnZS5yZXF1ZXN0LnBvc3QodXBsb2FkVXJsLCB7XG4gICAgICBoZWFkZXJzOiB7IE9yaWdpbjogSE9TVElMRV9PUklHSU4gfSxcbiAgICAgIG11bHRpcGFydDoge1xuICAgICAgICBhcmNoaXZlOiB7XG4gICAgICAgICAgbmFtZTogXCJob3N0aWxlLWRhc2hib2FyZC1qb3VybmV5LnppcFwiLFxuICAgICAgICAgIG1pbWVUeXBlOiBcImFwcGxpY2F0aW9uL3ppcFwiLFxuICAgICAgICAgIGJ1ZmZlcjogQnVmZmVyLmZyb20oXCJub3QgYW4gYXJjaGl2ZVwiKSxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgfSk7XG4gICAgZXhwZWN0KGhvc3RpbGVVcGxvYWQuc3RhdHVzKCkpLnRvQmUoNDAzKTtcbiAgICBleHBlY3QoXG4gICAgICBob3N0aWxlVXBsb2FkLmhlYWRlcnMoKVtcImFjY2Vzcy1jb250cm9sLWFsbG93LW9yaWdpblwiXSxcbiAgICApLnRvQmVVbmRlZmluZWQoKTtcblxuICAgIGNvbnN0IGhvc3RpbGVMaXZlVXBkYXRlID0gYXdhaXQgcGFnZS5yZXF1ZXN0LnBvc3QobGl2ZVVwZGF0ZVVybCwge1xuICAgICAgaGVhZGVyczoge1xuICAgICAgICBPcmlnaW46IEhPU1RJTEVfT1JJR0lOLFxuICAgICAgICBcIkNvbnRlbnQtVHlwZVwiOiBcImFwcGxpY2F0aW9uL2pzb25cIixcbiAgICAgIH0sXG4gICAgICBkYXRhOiB7fSxcbiAgICB9KTtcbiAgICBleHBlY3QoaG9zdGlsZUxpdmVVcGRhdGUuc3RhdHVzKCkpLnRvQmUoNDAzKTtcbiAgICBleHBlY3QoXG4gICAgICBob3N0aWxlTGl2ZVVwZGF0ZS5oZWFkZXJzKClbXCJhY2Nlc3MtY29udHJvbC1hbGxvdy1vcmlnaW5cIl0sXG4gICAgKS50b0JlVW5kZWZpbmVkKCk7XG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgZGlhZ25vc3RpYy5lcnJvciA9IFwib3JpZ2luIHJlamVjdGlvbiBjaGVjayBmYWlsZWRcIjtcbiAgICBhd2FpdCB3cml0ZU9yaWdpbkRpYWdub3N0aWNzKCk7XG4gICAgdGhyb3cgZXJyb3I7XG4gIH1cbiAgYXdhaXQgd3JpdGVPcmlnaW5EaWFnbm9zdGljcygpO1xufVxuXG5mdW5jdGlvbiBwYXJzZVNzZShib2R5OiBzdHJpbmcpOiBBcnJheTxSZWNvcmQ8c3RyaW5nLCB1bmtub3duPj4ge1xuICByZXR1cm4gYm9keS5zcGxpdCgvXFxuXFxuKy8pLmZsYXRNYXAoKGNodW5rKSA9PiB7XG4gICAgY29uc3QgZGF0YSA9IGNodW5rXG4gICAgICAuc3BsaXQoXCJcXG5cIilcbiAgICAgIC5maW5kKChsaW5lKSA9PiBsaW5lLnN0YXJ0c1dpdGgoXCJkYXRhOiBcIikpXG4gICAgICA/LnNsaWNlKFwiZGF0YTogXCIubGVuZ3RoKTtcbiAgICBpZiAoIWRhdGEpIHJldHVybiBbXTtcbiAgICB0cnkge1xuICAgICAgY29uc3QgdmFsdWUgPSBKU09OLnBhcnNlKGRhdGEpIGFzIHVua25vd247XG4gICAgICByZXR1cm4gdmFsdWUgJiYgdHlwZW9mIHZhbHVlID09PSBcIm9iamVjdFwiXG4gICAgICAgID8gW3ZhbHVlIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+XVxuICAgICAgICA6IFtdO1xuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuIFtdO1xuICAgIH1cbiAgfSk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGxpdmVKc29uKFxuICBwYWdlOiBQYWdlLFxuICBwYXRoOiBzdHJpbmcsXG4pOiBQcm9taXNlPFJlY29yZDxzdHJpbmcsIGFueT4+IHtcbiAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBsaXZlUmVxdWVzdChwYWdlLCBwYXRoKTtcbiAgaWYgKHJlc3BvbnNlLnN0YXR1cyA8IDIwMCB8fCByZXNwb25zZS5zdGF0dXMgPj0gMzAwKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgYExpdmUgY29ycmVsYXRpb24gcmVxdWVzdCBmYWlsZWQ6ICR7cGF0aH0gKCR7cmVzcG9uc2Uuc3RhdHVzfSlgLFxuICAgICk7XG4gIH1cbiAgcmV0dXJuIEpTT04ucGFyc2UocmVzcG9uc2UuYm9keSkgYXMgUmVjb3JkPHN0cmluZywgYW55Pjtcbn1cblxuYXN5bmMgZnVuY3Rpb24gbGl2ZUFycmF5KFxuICBwYWdlOiBQYWdlLFxuICBwYXRoOiBzdHJpbmcsXG4pOiBQcm9taXNlPEFycmF5PFJlY29yZDxzdHJpbmcsIGFueT4+PiB7XG4gIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgbGl2ZVJlcXVlc3QocGFnZSwgcGF0aCk7XG4gIGlmIChyZXNwb25zZS5zdGF0dXMgPT09IDQwNCkgcmV0dXJuIFtdO1xuICBpZiAocmVzcG9uc2Uuc3RhdHVzIDwgMjAwIHx8IHJlc3BvbnNlLnN0YXR1cyA+PSAzMDApIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICBgTGl2ZSBjb3JyZWxhdGlvbiByZXF1ZXN0IGZhaWxlZDogJHtwYXRofSAoJHtyZXNwb25zZS5zdGF0dXN9KWAsXG4gICAgKTtcbiAgfVxuICBjb25zdCB2YWx1ZSA9IEpTT04ucGFyc2UocmVzcG9uc2UuYm9keSk7XG4gIHJldHVybiBBcnJheS5pc0FycmF5KHZhbHVlKSA/IHZhbHVlIDogW107XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGxpdmVPcHRpb25hbFJlY29yZChcbiAgcGFnZTogUGFnZSxcbiAgcGF0aDogc3RyaW5nLFxuKTogUHJvbWlzZTxSZWNvcmQ8c3RyaW5nLCBhbnk+IHwgdW5kZWZpbmVkPiB7XG4gIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgbGl2ZVJlcXVlc3QocGFnZSwgcGF0aCk7XG4gIGlmIChyZXNwb25zZS5zdGF0dXMgPT09IDQwNCkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgaWYgKHJlc3BvbnNlLnN0YXR1cyA8IDIwMCB8fCByZXNwb25zZS5zdGF0dXMgPj0gMzAwKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgYExpdmUgY29ycmVsYXRpb24gcmVxdWVzdCBmYWlsZWQ6ICR7cGF0aH0gKCR7cmVzcG9uc2Uuc3RhdHVzfSlgLFxuICAgICk7XG4gIH1cbiAgY29uc3QgdmFsdWUgPSBKU09OLnBhcnNlKHJlc3BvbnNlLmJvZHkpO1xuICByZXR1cm4gdmFsdWUgJiYgdHlwZW9mIHZhbHVlID09PSBcIm9iamVjdFwiICYmICFBcnJheS5pc0FycmF5KHZhbHVlKVxuICAgID8gKHZhbHVlIGFzIFJlY29yZDxzdHJpbmcsIGFueT4pXG4gICAgOiB1bmRlZmluZWQ7XG59XG5cbnRlc3QuZGVzY3JpYmUoXCJFbmdpbmVlcmluZ09TIGRhc2hib2FyZCBicm93c2VyIGpvdXJuZXlcIiwgKCkgPT4ge1xuICB0ZXN0KFwiZXhwb3J0cyBvbmUgcmVkYWN0ZWQgbGl2ZS1wcm92aWRlciBtaXNzaW9uIGNvcnJlbGF0aW9uIHJlcG9ydFwiLCBhc3luYyAoe1xuICAgIHBhZ2UsXG4gIH0pID0+IHtcbiAgICAvLyBUaGUgUGxheXdyaWdodCBkZWFkbGluZSBtdXN0IGxlYXZlIHJvb20gZm9yIHRoZSBwcm92aWRlci1ib3VuZCByZXF1ZXN0XG4gICAgLy8gYW5kIHBvbGxpbmcgbG9vcCB0byBjb25zdW1lIHRoZWlyIGNvbXBsZXRlIGNvbmZpZ3VyZWQgYnVkZ2V0LlxuICAgIHRlc3Quc2V0VGltZW91dChsaXZlVGltZW91dE1zKCkgKyBMSVZFX1RFU1RfVElNRU9VVF9NQVJHSU5fTVMpO1xuICAgIHRlc3Quc2tpcChcbiAgICAgIHByb2Nlc3MuZW52LkRBU0hCT0FSRF9FMkVfTElWRV9QUk9WSURFUiAhPT0gXCIxXCIsXG4gICAgICBcIkxpdmUtcHJvdmlkZXIgcmVsZWFzZSBqb3VybmV5IGlzIG9wdC1pbi5cIixcbiAgICApO1xuICAgIGlmIChwcm9jZXNzLmVudi5EQVNIQk9BUkRfRTJFX0xJVkVfRElTUE9TQUJMRSAhPT0gXCIxXCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgXCJMaXZlLXByb3ZpZGVyIGpvdXJuZXkgcmVxdWlyZXMgREFTSEJPQVJEX0UyRV9MSVZFX0RJU1BPU0FCTEU9MSBhbmQgYSBkaXNwb3NhYmxlIHByb2plY3QuXCIsXG4gICAgICApO1xuICAgIH1cbiAgICBjb25zdCBwcm9qZWN0SWQgPSBwcm9jZXNzLmVudi5EQVNIQk9BUkRfRTJFX0xJVkVfUFJPSkVDVF9JRDtcbiAgICBpZiAoIXByb2plY3RJZClcbiAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgXCJEQVNIQk9BUkRfRTJFX0xJVkVfUFJPSkVDVF9JRCBpcyByZXF1aXJlZCBmb3IgdGhlIGxpdmUtcHJvdmlkZXIgam91cm5leS5cIixcbiAgICAgICk7XG5cbiAgICBhd2FpdCBwcm9ncmFtbWF0aWNTaWduSW4ocGFnZSk7XG4gICAgY29uc3Qgc3RyZWFtUmVzcG9uc2UgPSBhd2FpdCBsaXZlUmVxdWVzdChwYWdlLCBcIi9hcGkvYWkvY2hhdC9zdHJlYW1cIiwge1xuICAgICAgbWV0aG9kOiBcIlBPU1RcIixcbiAgICAgIHRpbWVvdXQ6IGxpdmVUaW1lb3V0TXMoKSxcbiAgICAgIGJvZHk6IHtcbiAgICAgICAgcHJvamVjdElkLFxuICAgICAgICBtZXNzYWdlOiBwcm9jZXNzLmVudi5EQVNIQk9BUkRfRTJFX0xJVkVfUFJPTVBUID8/IERFRkFVTFRfTElWRV9QUk9NUFQsXG4gICAgICAgIGlkZW1wb3RlbmN5S2V5OiBgZGFzaGJvYXJkLWxpdmUtJHtEYXRlLm5vdygpfWAsXG4gICAgICB9LFxuICAgIH0pO1xuICAgIGlmIChzdHJlYW1SZXNwb25zZS5zdGF0dXMgPCAyMDAgfHwgc3RyZWFtUmVzcG9uc2Uuc3RhdHVzID49IDMwMCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICBgTGl2ZS1wcm92aWRlciBtaXNzaW9uIGZhaWxlZCB0byBzdGFydCAoJHtzdHJlYW1SZXNwb25zZS5zdGF0dXN9KS5gLFxuICAgICAgKTtcbiAgICB9XG4gICAgY29uc3Qgc3NlRXZlbnRzID0gcGFyc2VTc2Uoc3RyZWFtUmVzcG9uc2UuYm9keSk7XG4gICAgY29uc3Qgc3RhcnRlZCA9IHNzZUV2ZW50cy5maW5kKFxuICAgICAgKGV2ZW50KSA9PiBldmVudC50eXBlID09PSBcImV4ZWN1dGlvbl9zdGFydGVkXCIsXG4gICAgKTtcbiAgICBjb25zdCBleGVjdXRpb25JZCA9XG4gICAgICB0eXBlb2Ygc3RhcnRlZD8uZXhlY3V0aW9uSWQgPT09IFwic3RyaW5nXCJcbiAgICAgICAgPyBzdGFydGVkLmV4ZWN1dGlvbklkXG4gICAgICAgIDogdW5kZWZpbmVkO1xuICAgIGlmICghZXhlY3V0aW9uSWQpXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJMaXZlLXByb3ZpZGVyIHN0cmVhbSBkaWQgbm90IGVtaXQgZXhlY3V0aW9uX3N0YXJ0ZWQuXCIpO1xuXG4gICAgbGV0IGV4ZWN1dGlvbjogUmVjb3JkPHN0cmluZywgYW55PiA9IHt9O1xuICAgIGNvbnN0IGRlYWRsaW5lID0gRGF0ZS5ub3coKSArIGxpdmVUaW1lb3V0TXMoKTtcbiAgICB3aGlsZSAoRGF0ZS5ub3coKSA8IGRlYWRsaW5lKSB7XG4gICAgICBleGVjdXRpb24gPSBhd2FpdCBsaXZlSnNvbihwYWdlLCBgL2FwaS9haS9leGVjdXRpb25zLyR7ZXhlY3V0aW9uSWR9YCk7XG4gICAgICBpZiAoXG4gICAgICAgIFtcImNvbXBsZXRlZFwiLCBcImZhaWxlZFwiLCBcImNhbmNlbGxlZFwiXS5pbmNsdWRlcyhTdHJpbmcoZXhlY3V0aW9uLnN0YXR1cykpXG4gICAgICApXG4gICAgICAgIGJyZWFrO1xuICAgICAgYXdhaXQgbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHNldFRpbWVvdXQocmVzb2x2ZSwgNzUwKSk7XG4gICAgfVxuICAgIGlmIChcbiAgICAgICFbXCJjb21wbGV0ZWRcIiwgXCJmYWlsZWRcIiwgXCJjYW5jZWxsZWRcIl0uaW5jbHVkZXMoU3RyaW5nKGV4ZWN1dGlvbi5zdGF0dXMpKVxuICAgICkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICBcIkxpdmUtcHJvdmlkZXIgbWlzc2lvbiBkaWQgbm90IHJlYWNoIGEgdGVybWluYWwgc3RhdGUgd2l0aGluIGl0cyBib3VuZC5cIixcbiAgICAgICk7XG4gICAgfVxuXG4gICAgY29uc3Qgc2Vzc2lvbklkID0gU3RyaW5nKGV4ZWN1dGlvbi5zZXNzaW9uSWQpO1xuICAgIGNvbnN0IG1lc3NhZ2VzID0gYXdhaXQgbGl2ZUFycmF5KFxuICAgICAgcGFnZSxcbiAgICAgIGAvYXBpL2FpL2NoYXQvJHtzZXNzaW9uSWR9L21lc3NhZ2VzYCxcbiAgICApO1xuICAgIGNvbnN0IGV2ZW50cyA9IGF3YWl0IGxpdmVBcnJheShcbiAgICAgIHBhZ2UsXG4gICAgICBgL2FwaS9ldmVudHM/cHJvamVjdElkPSR7ZW5jb2RlVVJJQ29tcG9uZW50KHByb2plY3RJZCl9JmNvcnJlbGF0aW9uSWQ9JHtlbmNvZGVVUklDb21wb25lbnQoU3RyaW5nKGV4ZWN1dGlvbi5vcGVyYXRpb25JZCA/PyBcIlwiKSl9YCxcbiAgICApO1xuICAgIGNvbnN0IHByb3Bvc2FsID0gYXdhaXQgbGl2ZU9wdGlvbmFsUmVjb3JkKFxuICAgICAgcGFnZSxcbiAgICAgIGAvYXBpL2FpL2NoYXQvJHtzZXNzaW9uSWR9L3BlbmRpbmctcHJvcG9zYWxgLFxuICAgICk7XG4gICAgY29uc3QgZ2l0TG9nID0gYXdhaXQgbGl2ZUpzb24ocGFnZSwgYC9hcGkvcHJvamVjdHMvJHtwcm9qZWN0SWR9L2dpdC9sb2dgKTtcbiAgICBjb25zdCBtaXNzaW9uQ29udHJvbCA9IGF3YWl0IGxpdmVKc29uKHBhZ2UsIFwiL2FwaS9haS9taXNzaW9uLWNvbnRyb2xcIik7XG4gICAgY29uc3QgZGFzaGJvYXJkU3RhdGUgPSBhd2FpdCBsaXZlSnNvbihwYWdlLCBcIi9hcGkvZGFzaGJvYXJkXCIpO1xuICAgIGNvbnN0IGNoZWNrcG9pbnQgPVxuICAgICAgZXhlY3V0aW9uLmNoZWNrcG9pbnQgJiYgdHlwZW9mIGV4ZWN1dGlvbi5jaGVja3BvaW50ID09PSBcIm9iamVjdFwiXG4gICAgICAgID8gKGV4ZWN1dGlvbi5jaGVja3BvaW50IGFzIFJlY29yZDxzdHJpbmcsIGFueT4pXG4gICAgICAgIDoge307XG4gICAgY29uc3QgcmVjZW50U3RlcHMgPSBBcnJheS5pc0FycmF5KGNoZWNrcG9pbnQucmVjZW50U3RlcHMpXG4gICAgICA/IGNoZWNrcG9pbnQucmVjZW50U3RlcHNcbiAgICAgIDogW107XG4gICAgY29uc3QgdmFsaWRhdGlvbiA9IHJlY2VudFN0ZXBzLmZpbHRlcihcbiAgICAgIChzdGVwKSA9PiBzdGVwPy5raW5kID09PSBcInZhbGlkYXRpb25cIixcbiAgICApO1xuICAgIGNvbnN0IGV2aWRlbmNlQ291bnQgPSByZWNlbnRTdGVwcy5yZWR1Y2UoXG4gICAgICAoY291bnQsIHN0ZXApID0+IGNvdW50ICsgKE51bWJlcihzdGVwPy5hY2NlcHRlZEV2aWRlbmNlQ291bnQpIHx8IDApLFxuICAgICAgMCxcbiAgICApO1xuICAgIGNvbnN0IHRlcm1pbmFsU3RhdGUgPSBTdHJpbmcoXG4gICAgICBleGVjdXRpb24uZmxpZ2h0U3RhdGUgPz8gZXhlY3V0aW9uLnN0YXR1cyxcbiAgICApLnRvVXBwZXJDYXNlKCk7XG4gICAgY29uc3Qgc3VjY2Vzc1N0YXRlcyA9IG5ldyBTZXQoW1xuICAgICAgXCJDT01QTEVURURcIixcbiAgICAgIFwiUkVBRFlfRk9SX1JFVklFV1wiLFxuICAgICAgXCJBUFBMSUVEXCIsXG4gICAgICBcIkNPTU1JVFRFRFwiLFxuICAgICAgXCJQVVNIRURcIixcbiAgICBdKTtcbiAgICBpZiAoXG4gICAgICBzdWNjZXNzU3RhdGVzLmhhcyh0ZXJtaW5hbFN0YXRlKSAmJlxuICAgICAgKGV2aWRlbmNlQ291bnQgPCAxIHx8IHZhbGlkYXRpb24ubGVuZ3RoIDwgMSlcbiAgICApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgYExpdmUtcHJvdmlkZXIgbWlzc2lvbiByZXBvcnRlZCAke3Rlcm1pbmFsU3RhdGV9IHdpdGhvdXQgYWNjZXB0ZWQgZXZpZGVuY2UgYW5kIHZhbGlkYXRpb24gYCArXG4gICAgICAgICAgYChldmlkZW5jZT0ke2V2aWRlbmNlQ291bnR9LCB2YWxpZGF0aW9uPSR7dmFsaWRhdGlvbi5sZW5ndGh9KS5gLFxuICAgICAgKTtcbiAgICB9XG4gICAgY29uc3QgY2FwdHVyZSA9IHtcbiAgICAgIHByb2plY3RJZCxcbiAgICAgIHNlc3Npb25JZCxcbiAgICAgIG9wZXJhdGlvbklkOiBleGVjdXRpb24ub3BlcmF0aW9uSWQsXG4gICAgICB3b3Jrc3BhY2VSZXZpc2lvbjpcbiAgICAgICAgZ2l0TG9nLmNvbW1pdHM/LlswXT8uc2hvcnRIYXNoID8/XG4gICAgICAgIGdpdExvZy5jb21taXRzPy5bMF0/Lmhhc2g/LnNsaWNlKDAsIDEyKSxcbiAgICAgIHRlcm1pbmFsU3RhdGUsXG4gICAgICBleGVjdXRpb246IHtcbiAgICAgICAgaWQ6IGV4ZWN1dGlvbi5pZCxcbiAgICAgICAgcHJvamVjdElkOiBleGVjdXRpb24ucHJvamVjdElkLFxuICAgICAgICBzZXNzaW9uSWQ6IGV4ZWN1dGlvbi5zZXNzaW9uSWQsXG4gICAgICAgIG9wZXJhdGlvbklkOiBleGVjdXRpb24ub3BlcmF0aW9uSWQsXG4gICAgICAgIHN0YXR1czogZXhlY3V0aW9uLnN0YXR1cyxcbiAgICAgICAgZmxpZ2h0U3RhdGU6IGV4ZWN1dGlvbi5mbGlnaHRTdGF0ZSxcbiAgICAgIH0sXG4gICAgICBtZXNzYWdlczogbWVzc2FnZXMubWFwKFxuICAgICAgICAoe1xuICAgICAgICAgIGlkLFxuICAgICAgICAgIHNlc3Npb25JZDogbWVzc2FnZVNlc3Npb24sXG4gICAgICAgICAgcm9sZSxcbiAgICAgICAgICBleGVjdXRpb25JZDogbWVzc2FnZUV4ZWN1dGlvbixcbiAgICAgICAgICBvdXRjb21lLFxuICAgICAgICB9KSA9PiAoe1xuICAgICAgICAgIGlkLFxuICAgICAgICAgIHNlc3Npb25JZDogbWVzc2FnZVNlc3Npb24sXG4gICAgICAgICAgcm9sZSxcbiAgICAgICAgICBleGVjdXRpb25JZDogbWVzc2FnZUV4ZWN1dGlvbixcbiAgICAgICAgICBvdXRjb21lLFxuICAgICAgICB9KSxcbiAgICAgICksXG4gICAgICBzc2VFdmVudHM6IHNzZUV2ZW50cy5tYXAoXG4gICAgICAgICh7XG4gICAgICAgICAgdHlwZSxcbiAgICAgICAgICBleGVjdXRpb25JZDogZXZlbnRFeGVjdXRpb24sXG4gICAgICAgICAgc2Vzc2lvbklkOiBldmVudFNlc3Npb24sXG4gICAgICAgICAgb3V0Y29tZSxcbiAgICAgICAgICBjb2RlLFxuICAgICAgICB9KSA9PiAoe1xuICAgICAgICAgIHR5cGUsXG4gICAgICAgICAgZXhlY3V0aW9uSWQ6IGV2ZW50RXhlY3V0aW9uLFxuICAgICAgICAgIHNlc3Npb25JZDogZXZlbnRTZXNzaW9uLFxuICAgICAgICAgIG91dGNvbWUsXG4gICAgICAgICAgY29kZSxcbiAgICAgICAgfSksXG4gICAgICApLFxuICAgICAgY2hlY2twb2ludHM6IFtcbiAgICAgICAge1xuICAgICAgICAgIHNlcXVlbmNlOiBjaGVja3BvaW50LnNlcXVlbmNlLFxuICAgICAgICAgIHN0YWdlOiBjaGVja3BvaW50LnN0YWdlLFxuICAgICAgICAgIHVwZGF0ZWRBdDogY2hlY2twb2ludC51cGRhdGVkQXQsXG4gICAgICAgIH0sXG4gICAgICBdLFxuICAgICAgZXZpZGVuY2VDb3VudCxcbiAgICAgIHByb3Bvc2FsczogcHJvcG9zYWxcbiAgICAgICAgPyBbXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIGlkOiBwcm9wb3NhbC5pZCxcbiAgICAgICAgICAgICAgcmV2aXNpb246IHByb3Bvc2FsLnJldmlzaW9uLFxuICAgICAgICAgICAgICBzdGF0dXM6IHByb3Bvc2FsLnN0YXR1cyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgXVxuICAgICAgICA6IFtdLFxuICAgICAgdmFsaWRhdGlvbjogdmFsaWRhdGlvbi5tYXAoKHN0ZXApID0+ICh7XG4gICAgICAgIHN0YXR1czogc3RlcC52YWxpZGF0aW9uPy5zdGF0dXMgPz8gc3RlcC5zdGF0dXMsXG4gICAgICAgIHByb2ZpbGU6IHN0ZXAudmFsaWRhdGlvbj8ucHJvZmlsZSA/PyBzdGVwLnZhbGlkYXRpb25Qcm9maWxlLFxuICAgICAgfSkpLFxuICAgICAgZXZlbnRzOiBldmVudHMubWFwKCh7IHR5cGUsIHNldmVyaXR5LCBjb3JyZWxhdGlvbklkIH0pID0+ICh7XG4gICAgICAgIHR5cGUsXG4gICAgICAgIHNldmVyaXR5LFxuICAgICAgICBjb3JyZWxhdGlvbklkLFxuICAgICAgfSkpLFxuICAgICAgZGFzaGJvYXJkOiBtaXNzaW9uQ29udHJvbCxcbiAgICAgIGRhc2hib2FyZFN0YXRlOiB7XG4gICAgICAgIHByb2plY3RDb3VudDogZGFzaGJvYXJkU3RhdGUucHJvamVjdENvdW50LFxuICAgICAgICBhY3RpdmVUYXNrQ291bnQ6IGRhc2hib2FyZFN0YXRlLmFjdGl2ZVRhc2tDb3VudCxcbiAgICAgIH0sXG4gICAgfTtcbiAgICBjb25zdCBvdXRwdXRQYXRoID1cbiAgICAgIHByb2Nlc3MuZW52LkRBU0hCT0FSRF9FMkVfTElWRV9SRVBPUlRfUEFUSCA/P1xuICAgICAgXCJ0ZXN0LXJlc3VsdHMvZGFzaGJvYXJkLWpvdXJuZXkvbGl2ZS1taXNzaW9uLWNvcnJlbGF0aW9uLmpzb25cIjtcbiAgICBhd2FpdCBta2RpcihkaXJuYW1lKG91dHB1dFBhdGgpLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KTtcbiAgICBhd2FpdCB3cml0ZUZpbGUoXG4gICAgICBvdXRwdXRQYXRoLFxuICAgICAgYCR7SlNPTi5zdHJpbmdpZnkoY2FwdHVyZSwgbnVsbCwgMil9XFxuYCxcbiAgICAgIFwidXRmOFwiLFxuICAgICk7XG4gIH0pO1xuXG4gIHRlc3QoXCJzaWducyBpbiBhbmQgdHJhdmVyc2VzIHRoZSBhdXRoZW50aWNhdGVkIG9wZXJhdGlvbmFsIHNoZWxsXCIsIGFzeW5jICh7XG4gICAgcGFnZSxcbiAgfSkgPT4ge1xuICAgIGF3YWl0IGluc3RhbGxBcGlGaXh0dXJlcyhwYWdlKTtcbiAgICBhd2FpdCBwcm9ncmFtbWF0aWNTaWduSW4ocGFnZSk7XG4gICAgZm9yIChjb25zdCBvcmlnaW4gb2YgYXBwcm92ZWREYXNoYm9hcmRPcmlnaW5zKCkpIHtcbiAgICAgIGF3YWl0IGV4cGVjdE9yaWdpbkNhblVzZUFwaShwYWdlLCBvcmlnaW4pO1xuICAgIH1cbiAgICBhd2FpdCBleHBlY3RIb3N0aWxlT3JpZ2luUmVqZWN0ZWQocGFnZSk7XG5cbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5Um9sZShcImhlYWRpbmdcIiwgeyBuYW1lOiBcIlN5c3RlbSBPdmVydmlld1wiIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcIlNZU1RFTSBPTkxJTkVcIiwgeyBleGFjdDogdHJ1ZSB9KSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXCJTbW9rZSBQcm9qZWN0XCIsIHsgZXhhY3Q6IHRydWUgfSkuZmlyc3QoKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXCJEYXNoYm9hcmQgQVBJIGZpeHR1cmUgcmVhZHlcIiwgeyBleGFjdDogdHJ1ZSB9KSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXCJTaG93aW5nIDHigJMxIG9mIDFcIiwgeyBleGFjdDogdHJ1ZSB9KSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJPbGRlclwiIH0pKS50b0JlRGlzYWJsZWQoKTtcblxuICAgIGF3YWl0IG9wZW5OYXZpZ2F0aW9uKHBhZ2UsIFwiUHJvamVjdHNcIiwgYCR7REFTSEJPQVJEX1BBVEh9cHJvamVjdHNgKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5nZXRCeVJvbGUoXCJoZWFkaW5nXCIsIHsgbmFtZTogXCJQcm9qZWN0c1wiIH0pKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiU21va2UgUHJvamVjdFwiLCB7IGV4YWN0OiB0cnVlIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcblxuICAgIGF3YWl0IG9wZW5OYXZpZ2F0aW9uKHBhZ2UsIFwiRXZlbnQgU3RyZWFtXCIsIGAke0RBU0hCT0FSRF9QQVRIfWV2ZW50c2ApO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlSb2xlKFwiaGVhZGluZ1wiLCB7IG5hbWU6IFwiRXZlbnQgU3RyZWFtXCIgfSksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiRGFzaGJvYXJkIEFQSSBmaXh0dXJlIHJlYWR5XCIsIHsgZXhhY3Q6IHRydWUgfSksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuXG4gICAgYXdhaXQgb3Blbk5hdmlnYXRpb24ocGFnZSwgXCJBSSBBc3Npc3RhbnRcIiwgYCR7REFTSEJPQVJEX1BBVEh9YWlgKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZSkubm90LnRvSGF2ZVVSTCgvc2lnbi1pbi8pO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2VcbiAgICAgICAgLmdldEJ5VGV4dChcbiAgICAgICAgICAvQUkgcHJvdmlkZXIgbm90IGNvbmZpZ3VyZWR8Tm8gQUkga2V5IGNvbmZpZ3VyZWR8QUkgQXNzaXN0YW50L2ksXG4gICAgICAgIClcbiAgICAgICAgLmZpcnN0KCksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuXG4gICAgYXdhaXQgb3Blbk5hdmlnYXRpb24oXG4gICAgICBwYWdlLFxuICAgICAgXCJNaXNzaW9uIENvbnRyb2xcIixcbiAgICAgIGAke0RBU0hCT0FSRF9QQVRIfW1pc3Npb24tY29udHJvbGAsXG4gICAgKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5Um9sZShcImhlYWRpbmdcIiwgeyBuYW1lOiBcIk5vIGR1cmFibGUgcnVucyBpbiB0aGUgbGVkZ2VyXCIgfSksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuXG4gICAgYXdhaXQgcGFnZS5nb3RvKGAke0RBU0hCT0FSRF9QQVRIfWZsaWdodC1kZWNrP2V4ZWN1dGlvbklkPSR7RVhFQ1VUSU9OX0lEfWApO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlKS50b0hhdmVVUkwoXG4gICAgICBuZXcgUmVnRXhwKFxuICAgICAgICBgJHtEQVNIQk9BUkRfUEFUSC5yZXBsYWNlQWxsKFwiL1wiLCBcIlxcXFwvXCIpfWZsaWdodC1kZWNrXFxcXD9leGVjdXRpb25JZD1gLFxuICAgICAgKSxcbiAgICApO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlSb2xlKFwiaGVhZGluZ1wiLCB7IG5hbWU6IFwiQXVkaXQgLyBDaGF0IHJ1blwiIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcIkNvbnRyb2xsZWQgYnJvd3NlciBmaXh0dXJlIGNvbXBsZXRlZC5cIiwgeyBleGFjdDogdHJ1ZSB9KSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXCJQUk9WRU5cIiwgeyBleGFjdDogdHJ1ZSB9KS5maXJzdCgpLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgfSk7XG5cbiAgdGVzdChcInByZXZpZXdzIGFuZCBkb3dubG9hZHMgdGhlIGNvbXBsZXRlZCBleGVjdXRpb24gYXVkaXQgd2l0aG91dCBkdXBsaWNhdGluZyBlZmZlY3RzXCIsIGFzeW5jICh7XG4gICAgcGFnZSxcbiAgfSkgPT4ge1xuICAgIGNvbnN0IGF1ZGl0UmVxdWVzdHM6IHN0cmluZ1tdID0gW107XG4gICAgY29uc3QgYXVkaXRCb2R5ID0ge1xuICAgICAgZm9ybWF0OiBcImVuZ2luZWVyaW5nb3MuZXhlY3V0aW9uLWF1ZGl0LnYxXCIsXG4gICAgICBleHBvcnRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDI6MDAuMDAwWlwiLFxuICAgICAgZXhlY3V0aW9uOiB7XG4gICAgICAgIGlkOiBFWEVDVVRJT05fSUQsXG4gICAgICAgIHByb2plY3RJZDogXCJlMmUtcHJvamVjdFwiLFxuICAgICAgICBzZXNzaW9uSWQ6IFwiZTJlLWF1ZGl0LXNlc3Npb25cIixcbiAgICAgICAgb3BlcmF0aW9uSWQ6IGV4ZWN1dGlvbkZpeHR1cmUub3BlcmF0aW9uSWQsXG4gICAgICAgIHN0YXR1czogXCJjb21wbGV0ZWRcIixcbiAgICAgICAgdGVybWluYWxTdGF0ZTogXCJjb21wbGV0ZWRcIixcbiAgICAgICAgcmV2aXNpb246IFwiZTJlLXJldmlzaW9uLTQyXCIsXG4gICAgICAgIHByb29mOiB7IHJlcXVpcmVkOiBmYWxzZSwgdmVyZGljdDogXCJQUk9WRU5cIiB9LFxuICAgICAgfSxcbiAgICAgIHRpbWVsaW5lOiBbXSxcbiAgICAgIHZhbGlkYXRpb25zOiBbeyBzdGF0dXM6IFwicGFzc2VkXCIsIHByb2ZpbGU6IFwicmVsZWFzZS1zYWZlXCIgfV0sXG4gICAgICBhZmZlY3RlZEZpbGVzOiBbXCJzcmMvZmVhdHVyZS50c1wiXSxcbiAgICAgIHJlZGFjdGlvbjoge1xuICAgICAgICBleGNsdWRlZDogW1xuICAgICAgICAgIFwicHJvdmlkZXIgc2VjcmV0c1wiLFxuICAgICAgICAgIFwicmF3IG1vZGVsIG91dHB1dFwiLFxuICAgICAgICAgIFwicHJpdmF0ZSBydW50aW1lIHBhdGhzXCIsXG4gICAgICAgIF0sXG4gICAgICB9LFxuICAgIH07XG4gICAgYXdhaXQgaW5zdGFsbEFwaUZpeHR1cmVzKHBhZ2UsIHtcbiAgICAgIGF1ZGl0RXhwb3J0OiB7XG4gICAgICAgIGJvZHk6IGF1ZGl0Qm9keSxcbiAgICAgICAgZmlsZW5hbWU6IFwic2VydmVyLXN1cHBsaWVkLWF1ZGl0LW5hbWUuanNvblwiLFxuICAgICAgICByZXF1ZXN0czogYXVkaXRSZXF1ZXN0cyxcbiAgICAgICAgZmFpbEZpcnN0UHJldmlldzogdHJ1ZSxcbiAgICAgIH0sXG4gICAgfSk7XG4gICAgYXdhaXQgcHJvZ3JhbW1hdGljU2lnbkluKHBhZ2UpO1xuICAgIGF3YWl0IHBhZ2UuZXZhbHVhdGUoKCkgPT4ge1xuICAgICAgY29uc3QgZXhlY3V0aW9uID0ge1xuICAgICAgICBpZDogXCJlMmUtY29udHJvbGxlZC1leGVjdXRpb25cIixcbiAgICAgICAgcHJvamVjdElkOiBcImUyZS1wcm9qZWN0XCIsXG4gICAgICAgIHNlc3Npb25JZDogXCJlMmUtYXVkaXQtc2Vzc2lvblwiLFxuICAgICAgICBtZXNzYWdlOiBcIkNvbXBsZXRlZCBhdWRpdCBleGVjdXRpb25cIixcbiAgICAgIH07XG4gICAgICBsb2NhbFN0b3JhZ2Uuc2V0SXRlbShcbiAgICAgICAgXCJlb3NfYWlfZXhlY3V0aW9uX2N1cnJlbnRfZTJlLXByb2plY3RcIixcbiAgICAgICAgXCJlMmUtYXVkaXQtc2Vzc2lvblwiLFxuICAgICAgKTtcbiAgICAgIGxvY2FsU3RvcmFnZS5zZXRJdGVtKFxuICAgICAgICBcImVvc19haV9leGVjdXRpb25fZTJlLXByb2plY3RfZTJlLWF1ZGl0LXNlc3Npb25cIixcbiAgICAgICAgSlNPTi5zdHJpbmdpZnkoZXhlY3V0aW9uKSxcbiAgICAgICk7XG4gICAgfSk7XG4gICAgYXdhaXQgcGFnZS5nb3RvKGAke0RBU0hCT0FSRF9QQVRIfWFpYCk7XG5cbiAgICBjb25zdCBwcm9vZiA9IHBhZ2UuZ2V0QnlMYWJlbChcIkFnZW50IGV4ZWN1dGlvbiBwcm9vZlwiKTtcbiAgICBhd2FpdCBleHBlY3QocHJvb2YpLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KHByb29mKS50b0NvbnRhaW5UZXh0KC9jb21wbGV0ZWQvaSk7XG4gICAgYXdhaXQgZXhwZWN0KHByb29mKS50b0NvbnRhaW5UZXh0KFwiUmV2aXNpb246IGUyZS1yZXZpc2lvbi00MlwiKTtcblxuICAgIGF3YWl0IHByb29mLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiUHJldmlldyBhdWRpdFwiIH0pLmNsaWNrKCk7XG4gICAgY29uc3QgcHJldmlldyA9IHBhZ2UuZ2V0QnlMYWJlbChcIlJlZGFjdGVkIGF1ZGl0IHByZXZpZXdcIik7XG4gICAgYXdhaXQgZXhwZWN0KHByZXZpZXcpLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KHByZXZpZXcpLnRvQ29udGFpblRleHQoXCJBdWRpdCBwcmV2aWV3IHRlbXBvcmFyaWx5IHVuYXZhaWxhYmxlXCIpO1xuICAgIGF3YWl0IGV4cGVjdChwcmV2aWV3KS50b0NvbnRhaW5UZXh0KFwic2FtZSBleGVjdXRpb24gYW5kIHJldmlzaW9uXCIpO1xuICAgIGF3YWl0IGV4cGVjdChwcmV2aWV3LmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiUmV0cnkgcHJldmlld1wiIH0pKS50b0JlVmlzaWJsZSgpO1xuICAgIGV4cGVjdChhdWRpdFJlcXVlc3RzKS50b0hhdmVMZW5ndGgoMSk7XG5cbiAgICBhd2FpdCBwcmV2aWV3LmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiUmV0cnkgcHJldmlld1wiIH0pLmNsaWNrKCk7XG4gICAgYXdhaXQgZXhwZWN0KHByZXZpZXcpLnRvQ29udGFpblRleHQoXCJwcm92aWRlciBzZWNyZXRzXCIpO1xuICAgIGF3YWl0IGV4cGVjdChwcmV2aWV3KS50b0NvbnRhaW5UZXh0KFwicmF3IG1vZGVsIG91dHB1dFwiKTtcbiAgICBhd2FpdCBleHBlY3QocHJldmlldykudG9Db250YWluVGV4dChcInByaXZhdGUgcnVudGltZSBwYXRoc1wiKTtcbiAgICBhd2FpdCBleHBlY3QocHJldmlldykudG9Db250YWluVGV4dChFWEVDVVRJT05fSUQpO1xuICAgIGF3YWl0IGV4cGVjdChwcmV2aWV3KS50b0NvbnRhaW5UZXh0KFwiZTJlLW9wZXJhdGlvblwiKTtcbiAgICBhd2FpdCBleHBlY3QocHJldmlldykudG9Db250YWluVGV4dChcImUyZS1yZXZpc2lvbi00MlwiKTtcbiAgICBleHBlY3QoYXVkaXRSZXF1ZXN0cykudG9IYXZlTGVuZ3RoKDIpO1xuICAgIGV4cGVjdChuZXcgVVJMKGF1ZGl0UmVxdWVzdHNbMF0pLnBhdGhuYW1lKS50b0JlKFxuICAgICAgYC9hcGkvYWkvZXhlY3V0aW9ucy8ke0VYRUNVVElPTl9JRH0vYXVkaXQtZXhwb3J0YCxcbiAgICApO1xuXG4gICAgYXdhaXQgcHJldmlldy5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIkNsb3NlIGF1ZGl0IHByZXZpZXdcIiB9KS5jbGljaygpO1xuICAgIGF3YWl0IGV4cGVjdChwcmV2aWV3KS50b0JlSGlkZGVuKCk7XG5cbiAgICBjb25zdCBkb3dubG9hZFByb21pc2UgPSBwYWdlLndhaXRGb3JFdmVudChcImRvd25sb2FkXCIpO1xuICAgIGF3YWl0IHByb29mLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiRXhwb3J0IGF1ZGl0XCIgfSkuY2xpY2soKTtcbiAgICBjb25zdCBkb3dubG9hZCA9IGF3YWl0IGRvd25sb2FkUHJvbWlzZTtcbiAgICBleHBlY3QoZG93bmxvYWQuc3VnZ2VzdGVkRmlsZW5hbWUoKSkudG9CZShcInNlcnZlci1zdXBwbGllZC1hdWRpdC1uYW1lLmpzb25cIik7XG4gICAgZXhwZWN0KGF1ZGl0UmVxdWVzdHMpLnRvSGF2ZUxlbmd0aCgzKTtcblxuICAgIGF3YWl0IHBhZ2UucmVsb2FkKCk7XG4gICAgY29uc3QgcmVsb2FkZWRQcm9vZiA9IHBhZ2UuZ2V0QnlMYWJlbChcIkFnZW50IGV4ZWN1dGlvbiBwcm9vZlwiKTtcbiAgICBhd2FpdCBleHBlY3QocmVsb2FkZWRQcm9vZikudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QocmVsb2FkZWRQcm9vZikudG9Db250YWluVGV4dCgvY29tcGxldGVkL2kpO1xuICAgIGF3YWl0IGV4cGVjdChyZWxvYWRlZFByb29mKS50b0NvbnRhaW5UZXh0KFwiRXhlY3V0aW9uIGUyZS1jb250cm9sbGVkLWV4ZWN1dGlvblwiKTtcbiAgICBhd2FpdCBleHBlY3QocmVsb2FkZWRQcm9vZikudG9Db250YWluVGV4dChcIlJldmlzaW9uOiBlMmUtcmV2aXNpb24tNDJcIik7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeUxhYmVsKFwiUmVkYWN0ZWQgYXVkaXQgcHJldmlld1wiKSxcbiAgICApLnRvQmVIaWRkZW4oKTtcbiAgICBleHBlY3QoYXVkaXRSZXF1ZXN0cykudG9IYXZlTGVuZ3RoKDMpO1xuICB9KTtcblxuICB0ZXN0KFwia2VlcHMgdGhlIGNhbmNlbGxlZCBleGVjdXRpb24gYXVkaXQgaGFuZG9mZiByZWRhY3RlZCBhbmQgdGVybWluYWxcIiwgYXN5bmMgKHtcbiAgICBwYWdlLFxuICB9KSA9PiB7XG4gICAgY29uc3QgYXVkaXRSZXF1ZXN0czogc3RyaW5nW10gPSBbXTtcbiAgICBjb25zdCBjYW5jZWxsZWRFeGVjdXRpb24gPSB7XG4gICAgICAuLi5leGVjdXRpb25GaXh0dXJlLFxuICAgICAgc3RhdHVzOiBcImNhbmNlbGxlZFwiLFxuICAgICAgZmxpZ2h0U3RhdGU6IFwiQ0FOQ0VMTEVEXCIsXG4gICAgICBjaGVja3BvaW50OiB7XG4gICAgICAgIHN0YWdlOiBcImNhbmNlbGxlZFwiLFxuICAgICAgICBkZXRhaWw6IFwiRXhlY3V0aW9uIGNhbmNlbGxlZCBiZWZvcmUgYW55IGNoYW5nZXMgd2VyZSBhcHBsaWVkLlwiLFxuICAgICAgfSxcbiAgICAgIHRlcm1pbmFsUmVhc29uOiBcImNhbmNlbF9yZXF1ZXN0ZWRcIixcbiAgICAgIGNvbXBsZXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDE6MzAuMDAwWlwiLFxuICAgICAgdXBkYXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDE6MzAuMDAwWlwiLFxuICAgIH07XG4gICAgY29uc3QgYXVkaXRCb2R5ID0ge1xuICAgICAgZm9ybWF0OiBcImVuZ2luZWVyaW5nb3MuZXhlY3V0aW9uLWF1ZGl0LnYxXCIsXG4gICAgICBleHBvcnRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDI6MDAuMDAwWlwiLFxuICAgICAgZXhlY3V0aW9uOiB7XG4gICAgICAgIGlkOiBFWEVDVVRJT05fSUQsXG4gICAgICAgIHByb2plY3RJZDogXCJlMmUtcHJvamVjdFwiLFxuICAgICAgICBzZXNzaW9uSWQ6IFwiZTJlLWF1ZGl0LXNlc3Npb25cIixcbiAgICAgICAgb3BlcmF0aW9uSWQ6IGV4ZWN1dGlvbkZpeHR1cmUub3BlcmF0aW9uSWQsXG4gICAgICAgIHN0YXR1czogXCJjYW5jZWxsZWRcIixcbiAgICAgICAgdGVybWluYWxTdGF0ZTogXCJjYW5jZWxsZWRcIixcbiAgICAgICAgcmV2aXNpb246IFwiZTJlLXJldmlzaW9uLTQyXCIsXG4gICAgICAgIHByb29mOiB7IHJlcXVpcmVkOiBmYWxzZSwgdmVyZGljdDogXCJOT1RfUkVDT1JERURcIiB9LFxuICAgICAgfSxcbiAgICAgIHRpbWVsaW5lOiBbXG4gICAgICAgIHsgdHlwZTogXCJjYW5jZWxsZWRcIiwgZGV0YWlsOiBcIkNhbmNlbGxhdGlvbiBhY2NlcHRlZCBieSB0aGUgc2VydmVyLlwiIH0sXG4gICAgICBdLFxuICAgICAgdmFsaWRhdGlvbnM6IFtdLFxuICAgICAgYWZmZWN0ZWRGaWxlczogW10sXG4gICAgICByZWRhY3Rpb246IHtcbiAgICAgICAgZXhjbHVkZWQ6IFtcbiAgICAgICAgICBcInByb3ZpZGVyIHNlY3JldHNcIixcbiAgICAgICAgICBcInJhdyBtb2RlbCBvdXRwdXRcIixcbiAgICAgICAgICBcInByaXZhdGUgcnVudGltZSBwYXRoc1wiLFxuICAgICAgICBdLFxuICAgICAgfSxcbiAgICB9O1xuICAgIGF3YWl0IGluc3RhbGxBcGlGaXh0dXJlcyhwYWdlLCB7XG4gICAgICBhdWRpdEV4cG9ydDoge1xuICAgICAgICBib2R5OiBhdWRpdEJvZHksXG4gICAgICAgIGZpbGVuYW1lOiBcImNhbmNlbGxlZC1zZXJ2ZXItYXVkaXQuanNvblwiLFxuICAgICAgICByZXF1ZXN0czogYXVkaXRSZXF1ZXN0cyxcbiAgICAgICAgZXhlY3V0aW9uOiBjYW5jZWxsZWRFeGVjdXRpb24sXG4gICAgICAgIG1lc3NhZ2VPdXRjb21lOiBcIkNBTkNFTExFRFwiLFxuICAgICAgICBmYWlsRmlyc3RQcmV2aWV3OiB0cnVlLFxuICAgICAgfSxcbiAgICB9KTtcbiAgICBhd2FpdCBwcm9ncmFtbWF0aWNTaWduSW4ocGFnZSk7XG4gICAgYXdhaXQgcGFnZS5ldmFsdWF0ZSgoKSA9PiB7XG4gICAgICBjb25zdCBleGVjdXRpb24gPSB7XG4gICAgICAgIGlkOiBcImUyZS1jb250cm9sbGVkLWV4ZWN1dGlvblwiLFxuICAgICAgICBwcm9qZWN0SWQ6IFwiZTJlLXByb2plY3RcIixcbiAgICAgICAgc2Vzc2lvbklkOiBcImUyZS1hdWRpdC1zZXNzaW9uXCIsXG4gICAgICAgIG1lc3NhZ2U6IFwiQ2FuY2VsbGVkIGF1ZGl0IGV4ZWN1dGlvblwiLFxuICAgICAgfTtcbiAgICAgIGxvY2FsU3RvcmFnZS5zZXRJdGVtKFxuICAgICAgICBcImVvc19haV9leGVjdXRpb25fY3VycmVudF9lMmUtcHJvamVjdFwiLFxuICAgICAgICBcImUyZS1hdWRpdC1zZXNzaW9uXCIsXG4gICAgICApO1xuICAgICAgbG9jYWxTdG9yYWdlLnNldEl0ZW0oXG4gICAgICAgIFwiZW9zX2FpX2V4ZWN1dGlvbl9lMmUtcHJvamVjdF9lMmUtYXVkaXQtc2Vzc2lvblwiLFxuICAgICAgICBKU09OLnN0cmluZ2lmeShleGVjdXRpb24pLFxuICAgICAgKTtcbiAgICB9KTtcbiAgICBhd2FpdCBwYWdlLmdvdG8oYCR7REFTSEJPQVJEX1BBVEh9YWlgKTtcblxuICAgIGNvbnN0IHByb29mID0gcGFnZS5nZXRCeUxhYmVsKFwiQWdlbnQgZXhlY3V0aW9uIHByb29mXCIpO1xuICAgIGF3YWl0IGV4cGVjdChwcm9vZikudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QocHJvb2YpLnRvQ29udGFpblRleHQoXCJDYW5jZWxsZWRcIik7XG4gICAgYXdhaXQgZXhwZWN0KHByb29mKS50b0NvbnRhaW5UZXh0KFwiRXhlY3V0aW9uIGUyZS1jb250cm9sbGVkLWV4ZWN1dGlvblwiKTtcbiAgICBhd2FpdCBleHBlY3QocHJvb2YpLnRvQ29udGFpblRleHQoXCJSZXZpc2lvbjogZTJlLXJldmlzaW9uLTQyXCIpO1xuICAgIGF3YWl0IGV4cGVjdChwcm9vZikudG9Db250YWluVGV4dChcIlRlcm1pbmFsIHJlYXNvbjogY2FuY2VsX3JlcXVlc3RlZFwiKTtcbiAgICBhd2FpdCBleHBlY3QocHJvb2YuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJDYW5jZWxcIiB9KSkudG9IYXZlQ291bnQoMCk7XG4gICAgYXdhaXQgZXhwZWN0KHByb29mLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiUmVzdW1lXCIgfSkpLnRvSGF2ZUNvdW50KDApO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHByb29mLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiQXBwcm92ZSAmIGFwcGx5XCIgfSksXG4gICAgKS50b0hhdmVDb3VudCgwKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwcm9vZi5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiAvY29tbWl0IHZlcmlmaWVkIGNoYW5nZXMvaSB9KSxcbiAgICApLnRvSGF2ZUNvdW50KDApO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHByb29mLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IC9wdXNoIGNvbW1pdHRlZCBjaGFuZ2VzL2kgfSksXG4gICAgKS50b0hhdmVDb3VudCgwKTtcblxuICAgIGF3YWl0IHByb29mLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiUHJldmlldyBhdWRpdFwiIH0pLmNsaWNrKCk7XG4gICAgY29uc3QgcHJldmlldyA9IHBhZ2UuZ2V0QnlMYWJlbChcIlJlZGFjdGVkIGF1ZGl0IHByZXZpZXdcIik7XG4gICAgYXdhaXQgZXhwZWN0KHByZXZpZXcpLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KHByZXZpZXcpLnRvQ29udGFpblRleHQoXCJBdWRpdCBwcmV2aWV3IHRlbXBvcmFyaWx5IHVuYXZhaWxhYmxlXCIpO1xuICAgIGF3YWl0IGV4cGVjdChwcmV2aWV3KS50b0NvbnRhaW5UZXh0KFwic2FtZSBleGVjdXRpb24gYW5kIHJldmlzaW9uXCIpO1xuICAgIGF3YWl0IGV4cGVjdChwcmV2aWV3LmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiUmV0cnkgcHJldmlld1wiIH0pKS50b0JlVmlzaWJsZSgpO1xuICAgIGV4cGVjdChhdWRpdFJlcXVlc3RzKS50b0hhdmVMZW5ndGgoMSk7XG5cbiAgICBhd2FpdCBwcmV2aWV3LmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiUmV0cnkgcHJldmlld1wiIH0pLmNsaWNrKCk7XG4gICAgYXdhaXQgZXhwZWN0KHByZXZpZXcpLnRvQ29udGFpblRleHQoXCJjYW5jZWxsZWRcIik7XG4gICAgYXdhaXQgZXhwZWN0KHByZXZpZXcpLnRvQ29udGFpblRleHQoRVhFQ1VUSU9OX0lEKTtcbiAgICBhd2FpdCBleHBlY3QocHJldmlldykudG9Db250YWluVGV4dChcImUyZS1vcGVyYXRpb25cIik7XG4gICAgYXdhaXQgZXhwZWN0KHByZXZpZXcpLnRvQ29udGFpblRleHQoXCJlMmUtcmV2aXNpb24tNDJcIik7XG4gICAgYXdhaXQgZXhwZWN0KHByZXZpZXcpLnRvQ29udGFpblRleHQoXCJwcm92aWRlciBzZWNyZXRzXCIpO1xuICAgIGF3YWl0IGV4cGVjdChwcmV2aWV3KS50b0NvbnRhaW5UZXh0KFwicmF3IG1vZGVsIG91dHB1dFwiKTtcbiAgICBhd2FpdCBleHBlY3QocHJldmlldykudG9Db250YWluVGV4dChcInByaXZhdGUgcnVudGltZSBwYXRoc1wiKTtcbiAgICBhd2FpdCBleHBlY3QocHJvb2YpLnRvQ29udGFpblRleHQoXCJDYW5jZWxsZWRcIik7XG4gICAgYXdhaXQgZXhwZWN0KHByb29mKS50b0NvbnRhaW5UZXh0KFwiUmV2aXNpb246IGUyZS1yZXZpc2lvbi00MlwiKTtcbiAgICBhd2FpdCBleHBlY3QocHJvb2YpLnRvQ29udGFpblRleHQoXCJUZXJtaW5hbCByZWFzb246IGNhbmNlbF9yZXF1ZXN0ZWRcIik7XG4gICAgZXhwZWN0KGF1ZGl0UmVxdWVzdHMpLnRvSGF2ZUxlbmd0aCgyKTtcblxuICAgIGF3YWl0IHByZXZpZXcuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJDbG9zZSBhdWRpdCBwcmV2aWV3XCIgfSkuY2xpY2soKTtcbiAgICBjb25zdCBkb3dubG9hZFByb21pc2UgPSBwYWdlLndhaXRGb3JFdmVudChcImRvd25sb2FkXCIpO1xuICAgIGF3YWl0IHByb29mLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiRXhwb3J0IGF1ZGl0XCIgfSkuY2xpY2soKTtcbiAgICBjb25zdCBkb3dubG9hZCA9IGF3YWl0IGRvd25sb2FkUHJvbWlzZTtcbiAgICBleHBlY3QoZG93bmxvYWQuc3VnZ2VzdGVkRmlsZW5hbWUoKSkudG9CZShcImNhbmNlbGxlZC1zZXJ2ZXItYXVkaXQuanNvblwiKTtcbiAgICBleHBlY3QoYXVkaXRSZXF1ZXN0cykudG9IYXZlTGVuZ3RoKDMpO1xuXG4gICAgYXdhaXQgcGFnZS5yZWxvYWQoKTtcbiAgICBjb25zdCByZWxvYWRlZFByb29mID0gcGFnZS5nZXRCeUxhYmVsKFwiQWdlbnQgZXhlY3V0aW9uIHByb29mXCIpO1xuICAgIGF3YWl0IGV4cGVjdChyZWxvYWRlZFByb29mKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChyZWxvYWRlZFByb29mKS50b0NvbnRhaW5UZXh0KFwiQ2FuY2VsbGVkXCIpO1xuICAgIGF3YWl0IGV4cGVjdChyZWxvYWRlZFByb29mKS50b0NvbnRhaW5UZXh0KFwiUmV2aXNpb246IGUyZS1yZXZpc2lvbi00MlwiKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5nZXRCeUxhYmVsKFwiUmVkYWN0ZWQgYXVkaXQgcHJldmlld1wiKSkudG9CZUhpZGRlbigpO1xuICAgIGV4cGVjdChhdWRpdFJlcXVlc3RzKS50b0hhdmVMZW5ndGgoMyk7XG4gIH0pO1xuXG4gIHRlc3QoXCJ1cGxvYWRzIGFuIGFyY2hpdmUgYW5kIHJlbmRlcnMgYSBsaXZlIHRhc2sgdXBkYXRlXCIsIGFzeW5jICh7XG4gICAgcGFnZSxcbiAgfSkgPT4ge1xuICAgIGNvbnN0IHRhc2tJZCA9IFwiZTJlLWxpdmUtdGFza1wiO1xuICAgIGNvbnN0IGxpdmVMb2cgPSB7XG4gICAgICBpZDogXCJlMmUtbGl2ZS1sb2dcIixcbiAgICAgIHRhc2tJZCxcbiAgICAgIGxldmVsOiBcImluZm9cIixcbiAgICAgIG1lc3NhZ2U6IFwiTGl2ZSB1cGRhdGUgcmVjZWl2ZWQgZnJvbSB0aGUgc2VydmVyXCIsXG4gICAgICB0aW1lc3RhbXA6IFwiMjAyNi0wMS0wMVQwMDowMDowMi4wMDBaXCIsXG4gICAgfTtcbiAgICBhd2FpdCBpbnN0YWxsQXBpRml4dHVyZXMocGFnZSwge1xuICAgICAgYXJjaGl2ZVVwbG9hZDoge1xuICAgICAgICB1cGxvYWRJZDogXCJlMmUtdXBsb2FkXCIsXG4gICAgICAgIG9yaWdpbmFsTmFtZTogXCJkYXNoYm9hcmQtam91cm5leS56aXBcIixcbiAgICAgIH0sXG4gICAgICBsaXZlVGFzazoge1xuICAgICAgICBpZDogdGFza0lkLFxuICAgICAgICB0aXRsZTogXCJWZXJpZnkgbGl2ZSBkYXNoYm9hcmQgdXBkYXRlc1wiLFxuICAgICAgICBwcm9qZWN0SWQ6IFwiZTJlLXByb2plY3RcIixcbiAgICAgICAgbG9nOiBsaXZlTG9nLFxuICAgICAgfSxcbiAgICB9KTtcbiAgICBhd2FpdCBwcm9ncmFtbWF0aWNTaWduSW4ocGFnZSk7XG5cbiAgICAvLyBUaGlzIGlzIGEgdmFsaWQsIGVtcHR5IFpJUCBhcmNoaXZlLiBLZWVwaW5nIGl0IGlubGluZSBtYWtlcyB0aGUgYnJvd3NlclxuICAgIC8vIHRlc3Qgc2VsZi1jb250YWluZWQgd2hpbGUgc3RpbGwgZXhlcmNpc2luZyBGb3JtRGF0YSBhbmQgbXVsdGlwYXJ0IGJ5dGVzLlxuICAgIGNvbnN0IHVwbG9hZFJlc3VsdCA9IGF3YWl0IHBhZ2UuZXZhbHVhdGUoYXN5bmMgKGFwaUJhc2VVcmwpID0+IHtcbiAgICAgIGNvbnN0IGJ5dGVzID0gVWludDhBcnJheS5mcm9tKFxuICAgICAgICBhdG9iKFwiVUVzRkJnQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBPT1cIiksXG4gICAgICAgIChjaGFyYWN0ZXIpID0+IGNoYXJhY3Rlci5jaGFyQ29kZUF0KDApLFxuICAgICAgKTtcbiAgICAgIGNvbnN0IGJvZHkgPSBuZXcgRm9ybURhdGEoKTtcbiAgICAgIGJvZHkuYXBwZW5kKFxuICAgICAgICBcImFyY2hpdmVcIixcbiAgICAgICAgbmV3IEJsb2IoW2J5dGVzXSwgeyB0eXBlOiBcImFwcGxpY2F0aW9uL3ppcFwiIH0pLFxuICAgICAgICBcImRhc2hib2FyZC1qb3VybmV5LnppcFwiLFxuICAgICAgKTtcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgZmV0Y2goXG4gICAgICAgIG5ldyBVUkwoXCIvYXBpL3VwbG9hZC9hcmNoaXZlXCIsIGFwaUJhc2VVcmwpLnRvU3RyaW5nKCksXG4gICAgICAgIHsgbWV0aG9kOiBcIlBPU1RcIiwgY3JlZGVudGlhbHM6IFwiaW5jbHVkZVwiLCBib2R5IH0sXG4gICAgICApO1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgc3RhdHVzOiByZXNwb25zZS5zdGF0dXMsXG4gICAgICAgIGJvZHk6IChhd2FpdCByZXNwb25zZS5qc29uKCkpIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+LFxuICAgICAgfTtcbiAgICB9LCBwcm9jZXNzLmVudi5EQVNIQk9BUkRfRTJFX0FQSV9CQVNFX1VSTCA/PyBwYWdlLnVybCgpKTtcbiAgICBleHBlY3QodXBsb2FkUmVzdWx0LnN0YXR1cykudG9CZSgyMDEpO1xuICAgIGV4cGVjdCh1cGxvYWRSZXN1bHQuYm9keSkudG9FcXVhbCh7XG4gICAgICB1cGxvYWRJZDogXCJlMmUtdXBsb2FkXCIsXG4gICAgICBvcmlnaW5hbE5hbWU6IFwiZGFzaGJvYXJkLWpvdXJuZXkuemlwXCIsXG4gICAgfSk7XG5cbiAgICBhd2FpdCBvcGVuTmF2aWdhdGlvbihwYWdlLCBcIlRhc2tzXCIsIGAke0RBU0hCT0FSRF9QQVRIfXRhc2tzYCk7XG4gICAgY29uc3QgdGFza1JvdyA9IHBhZ2UuZ2V0QnlMYWJlbChcbiAgICAgIFwiRXhwYW5kIHRhc2sgVmVyaWZ5IGxpdmUgZGFzaGJvYXJkIHVwZGF0ZXNcIixcbiAgICApO1xuICAgIGF3YWl0IGV4cGVjdCh0YXNrUm93KS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IHRhc2tSb3cuY2xpY2soKTtcbiAgICBhd2FpdCBwYWdlLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiTG9nc1wiIH0pLmNsaWNrKCk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlSb2xlKFwicmVnaW9uXCIsIHsgbmFtZTogXCJBY3Rpdml0eVwiIH0pKS50b0NvbnRhaW5UZXh0KFxuICAgICAgXCJMaXZlIHVwZGF0ZSByZWNlaXZlZCBmcm9tIHRoZSBzZXJ2ZXJcIixcbiAgICApO1xuICB9KTtcblxuICB0ZXN0KFwicmVjb3ZlcnMgYSBsaXZlIHRhc2sgdXBkYXRlIGFmdGVyIGEgdGVtcG9yYXJ5IHN0cmVhbSBmYWlsdXJlXCIsIGFzeW5jICh7XG4gICAgcGFnZSxcbiAgfSkgPT4ge1xuICAgIGNvbnN0IHRhc2tJZCA9IFwiZTJlLXJlY29ubmVjdGluZy1saXZlLXRhc2tcIjtcbiAgICBjb25zdCBsaXZlTG9nID0ge1xuICAgICAgaWQ6IFwiZTJlLXJlY29ubmVjdGluZy1saXZlLWxvZ1wiLFxuICAgICAgdGFza0lkLFxuICAgICAgbGV2ZWw6IFwiaW5mb1wiLFxuICAgICAgbWVzc2FnZTogXCJBdXRob3JpdGF0aXZlIHVwZGF0ZSByZWNlaXZlZCBhZnRlciByZWNvbm5lY3RcIixcbiAgICAgIHRpbWVzdGFtcDogXCIyMDI2LTAxLTAxVDAwOjAwOjAyLjAwMFpcIixcbiAgICAgIG1ldGFkYXRhOiB7XG4gICAgICAgIG9wZXJhdGlvbklkOiBcImUyZS1yZWNvbm5lY3Rpbmctb3BlcmF0aW9uXCIsXG4gICAgICAgIGNoZWNrcG9pbnRWZXJzaW9uOiAzLFxuICAgICAgfSxcbiAgICB9O1xuICAgIGNvbnN0IHN0cmVhbVJlcXVlc3RzOiBzdHJpbmdbXSA9IFtdO1xuICAgIGF3YWl0IGluc3RhbGxBcGlGaXh0dXJlcyhwYWdlLCB7XG4gICAgICBsaXZlVGFzazoge1xuICAgICAgICBpZDogdGFza0lkLFxuICAgICAgICB0aXRsZTogXCJSZWNvdmVyIGxpdmUgdGFzayB1cGRhdGVzXCIsXG4gICAgICAgIHByb2plY3RJZDogXCJlMmUtcHJvamVjdFwiLFxuICAgICAgICBsb2c6IGxpdmVMb2csXG4gICAgICAgIHN0cmVhbVJlcXVlc3RzLFxuICAgICAgICBmYWlsRmlyc3RTdHJlYW06IHRydWUsXG4gICAgICB9LFxuICAgIH0pO1xuICAgIGF3YWl0IHByb2dyYW1tYXRpY1NpZ25JbihwYWdlKTtcblxuICAgIGF3YWl0IG9wZW5OYXZpZ2F0aW9uKHBhZ2UsIFwiVGFza3NcIiwgYCR7REFTSEJPQVJEX1BBVEh9dGFza3NgKTtcbiAgICBjb25zdCB0YXNrUm93ID0gcGFnZS5nZXRCeUxhYmVsKFwiRXhwYW5kIHRhc2sgUmVjb3ZlciBsaXZlIHRhc2sgdXBkYXRlc1wiKTtcbiAgICBhd2FpdCBleHBlY3QodGFza1JvdykudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCB0YXNrUm93LmNsaWNrKCk7XG4gICAgYXdhaXQgcGFnZS5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIkxvZ3NcIiB9KS5jbGljaygpO1xuXG4gICAgY29uc3QgYWN0aXZpdHkgPSBwYWdlLmdldEJ5Um9sZShcInJlZ2lvblwiLCB7IG5hbWU6IFwiQWN0aXZpdHlcIiB9KTtcbiAgICBhd2FpdCBleHBlY3QoYWN0aXZpdHkpLnRvQ29udGFpblRleHQobGl2ZUxvZy5tZXNzYWdlKTtcbiAgICBhd2FpdCBleHBlY3RcbiAgICAgIC5wb2xsKCgpID0+IHN0cmVhbVJlcXVlc3RzLmxlbmd0aCwge1xuICAgICAgICBtZXNzYWdlOiBcInRoZSB0YXNrIGxvZyBzdHJlYW0gc2hvdWxkIHJlY29ubmVjdCBleGFjdGx5IG9uY2VcIixcbiAgICAgIH0pXG4gICAgICAudG9CZSgyKTtcbiAgICBleHBlY3Qoc3RyZWFtUmVxdWVzdHMpLnRvSGF2ZUxlbmd0aCgyKTtcbiAgICBleHBlY3Qoc3RyZWFtUmVxdWVzdHNbMF0pLnRvQmUoc3RyZWFtUmVxdWVzdHNbMV0pO1xuICAgIGV4cGVjdChuZXcgVVJMKHN0cmVhbVJlcXVlc3RzWzFdKS5wYXRobmFtZSkudG9CZShcbiAgICAgIGAvYXBpL3Rhc2tzLyR7dGFza0lkfS9sb2dzL3N0cmVhbWAsXG4gICAgKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBhY3Rpdml0eS5sb2NhdG9yKFwic3VtbWFyeVwiKS5maWx0ZXIoeyBoYXNUZXh0OiBsaXZlTG9nLm1lc3NhZ2UgfSksXG4gICAgKS50b0hhdmVDb3VudCgxKTtcbiAgfSk7XG5cbiAgdGVzdChcInNob3dzIGFuIGFjdGlvbmFibGUgdGVybWluYWwgc3RhdGUgd2hlbiBsaXZlIHRhc2sgcmVjb25uZWN0cyBhcmUgZXhoYXVzdGVkXCIsIGFzeW5jICh7XG4gICAgcGFnZSxcbiAgfSkgPT4ge1xuICAgIGNvbnN0IHRhc2tJZCA9IFwiZTJlLWV4aGF1c3RlZC1saXZlLXRhc2tcIjtcbiAgICBjb25zdCBvcGVyYXRpb25JZCA9IFwiZTJlLWV4aGF1c3RlZC1vcGVyYXRpb25cIjtcbiAgICBjb25zdCBsaXZlTG9nID0ge1xuICAgICAgaWQ6IFwiZTJlLWV4aGF1c3RlZC1saXZlLWxvZ1wiLFxuICAgICAgdGFza0lkLFxuICAgICAgbGV2ZWw6IFwiaW5mb1wiLFxuICAgICAgbWVzc2FnZTogXCJUaGUgb25seSBjb25maXJtZWQgdGFzayB1cGRhdGVcIixcbiAgICAgIHRpbWVzdGFtcDogXCIyMDI2LTAxLTAxVDAwOjAwOjAyLjAwMFpcIixcbiAgICAgIG1ldGFkYXRhOiB7IG9wZXJhdGlvbklkIH0sXG4gICAgfTtcbiAgICBjb25zdCBzdHJlYW1SZXF1ZXN0czogc3RyaW5nW10gPSBbXTtcbiAgICBjb25zdCBub25TdHJlYW1SZXF1ZXN0czogc3RyaW5nW10gPSBbXTtcbiAgICBwYWdlLm9uKFwicmVxdWVzdFwiLCAocmVxdWVzdCkgPT4ge1xuICAgICAgaWYgKCFyZXF1ZXN0LnVybCgpLmluY2x1ZGVzKFwiL2FwaS90YXNrcy9cIikpIHJldHVybjtcbiAgICAgIGlmICghcmVxdWVzdC51cmwoKS5pbmNsdWRlcyhcIi9sb2dzL3N0cmVhbVwiKSkgbm9uU3RyZWFtUmVxdWVzdHMucHVzaChyZXF1ZXN0Lm1ldGhvZCgpKTtcbiAgICB9KTtcbiAgICBhd2FpdCBpbnN0YWxsQXBpRml4dHVyZXMocGFnZSwge1xuICAgICAgbGl2ZVRhc2s6IHtcbiAgICAgICAgaWQ6IHRhc2tJZCxcbiAgICAgICAgdGl0bGU6IFwiUmVjb3ZlciBleGhhdXN0ZWQgbGl2ZSB0YXNrIHVwZGF0ZXNcIixcbiAgICAgICAgcHJvamVjdElkOiBcImUyZS1wcm9qZWN0XCIsXG4gICAgICAgIGxvZzogbGl2ZUxvZyxcbiAgICAgICAgaW5pdGlhbExvZ3M6IFtsaXZlTG9nXSxcbiAgICAgICAgc3RyZWFtUmVxdWVzdHMsXG4gICAgICAgIGZhaWxTdHJlYW1BdHRlbXB0czogNixcbiAgICAgIH0sXG4gICAgfSk7XG4gICAgYXdhaXQgcHJvZ3JhbW1hdGljU2lnbkluKHBhZ2UpO1xuXG4gICAgYXdhaXQgb3Blbk5hdmlnYXRpb24ocGFnZSwgXCJUYXNrc1wiLCBgJHtEQVNIQk9BUkRfUEFUSH10YXNrc2ApO1xuICAgIGF3YWl0IHBhZ2UuZ2V0QnlMYWJlbChcIkV4cGFuZCB0YXNrIFJlY292ZXIgZXhoYXVzdGVkIGxpdmUgdGFzayB1cGRhdGVzXCIpLmNsaWNrKCk7XG4gICAgYXdhaXQgcGFnZS5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIkxvZ3NcIiB9KS5jbGljaygpO1xuXG4gICAgY29uc3QgYWN0aXZpdHkgPSBwYWdlLmdldEJ5Um9sZShcInJlZ2lvblwiLCB7IG5hbWU6IFwiQWN0aXZpdHlcIiB9KTtcbiAgICBhd2FpdCBleHBlY3QoYWN0aXZpdHkpLnRvQ29udGFpblRleHQobGl2ZUxvZy5tZXNzYWdlKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5nZXRCeVRleHQoXCJUZW1wb3Jhcnkgc3RyZWFtIGZhaWx1cmUuXCIsIHsgZXhhY3Q6IGZhbHNlIH0pKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdFxuICAgICAgLnBvbGwoKCkgPT4gc3RyZWFtUmVxdWVzdHMubGVuZ3RoLCB7XG4gICAgICAgIG1lc3NhZ2U6IFwidGhlIHRhc2sgbG9nIHN0cmVhbSBzaG91bGQgZXhoYXVzdCBpdHMgYm91bmRlZCByZWNvbm5lY3QgYnVkZ2V0XCIsXG4gICAgICAgIHRpbWVvdXQ6IDM1XzAwMCxcbiAgICAgIH0pXG4gICAgICAudG9CZSg2KTtcbiAgICBjb25zdCBleGhhdXN0ZWQgPSBwYWdlLmdldEJ5Um9sZShcImFsZXJ0XCIpO1xuICAgIGF3YWl0IGV4cGVjdChleGhhdXN0ZWQpLnRvQ29udGFpblRleHQoXCJMaXZlIHRhc2sgdXBkYXRlcyBjb3VsZCBub3QgcmVjb25uZWN0XCIpO1xuICAgIGF3YWl0IGV4cGVjdChleGhhdXN0ZWQpLnRvQ29udGFpblRleHQoXCJSZWNvbm5lY3QgYXR0ZW1wdHMgYXJlIGV4aGF1c3RlZFwiKTtcbiAgICBhd2FpdCBleHBlY3QoZXhoYXVzdGVkKS50b0NvbnRhaW5UZXh0KG9wZXJhdGlvbklkKTtcbiAgICBhd2FpdCBleHBlY3QoZXhoYXVzdGVkKS50b0NvbnRhaW5UZXh0KFwidGFzayBoYXMgbm90IGJlZW4gbWFya2VkIGZhaWxlZFwiKTtcbiAgICBhd2FpdCBleHBlY3QoZXhoYXVzdGVkLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiUmV0cnkgbGl2ZSB1cGRhdGVzXCIgfSkpLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KGV4aGF1c3RlZC5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIlJlZnJlc2ggdGFzayBsb2dzXCIgfSkpLnRvQmVWaXNpYmxlKCk7XG5cbiAgICBhd2FpdCBleGhhdXN0ZWQuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJSZXRyeSBsaXZlIHVwZGF0ZXNcIiB9KS5jbGljaygpO1xuICAgIGF3YWl0IGV4cGVjdChhY3Rpdml0eSkudG9Db250YWluVGV4dChcIlRoZSBvbmx5IGNvbmZpcm1lZCB0YXNrIHVwZGF0ZVwiKTtcbiAgICBhd2FpdCBleHBlY3QucG9sbCgoKSA9PiBzdHJlYW1SZXF1ZXN0cy5sZW5ndGgpLnRvQmUoNyk7XG4gICAgZXhwZWN0KG5ldyBTZXQoc3RyZWFtUmVxdWVzdHMpLnNpemUpLnRvQmUoMSk7XG4gICAgZXhwZWN0KG5vblN0cmVhbVJlcXVlc3RzKS5ub3QudG9Db250YWluKFwiUE9TVFwiKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBhY3Rpdml0eS5sb2NhdG9yKFwic3VtbWFyeVwiKS5maWx0ZXIoeyBoYXNUZXh0OiBsaXZlTG9nLm1lc3NhZ2UgfSksXG4gICAgKS50b0hhdmVDb3VudCgxKTtcbiAgfSk7XG5cbiAgdGVzdChcInBhZ2VzIGFuZCByZWxvYWRzIHRoZSBmaWx0ZXJlZCBldmVudCBzdHJlYW0gd2l0aG91dCBsb3NpbmcgaXRzIHdpbmRvd1wiLCBhc3luYyAoe1xuICAgIHBhZ2UsXG4gIH0pID0+IHtcbiAgICBjb25zdCBldmVudHMgPSBBcnJheS5mcm9tKHsgbGVuZ3RoOiA1MSB9LCAoXywgaW5kZXgpID0+ICh7XG4gICAgICBpZDogYGUyZS1ldmVudC0ke2luZGV4fWAsXG4gICAgICBwcm9qZWN0SWQ6IFwiZTJlLXByb2plY3RcIixcbiAgICAgIHR5cGU6IFwiQXVkaXRFdmVudFwiLFxuICAgICAgc2V2ZXJpdHk6IGluZGV4IDwgMiA/IFwic3VjY2Vzc1wiIDogXCJpbmZvXCIsXG4gICAgICBjb3JyZWxhdGlvbklkOiBpbmRleCA8IDIgPyBcInJlbGVhc2UtNDJcIiA6IG51bGwsXG4gICAgICBtZXNzYWdlOlxuICAgICAgICBpbmRleCA8IDIgPyBgRmlsdGVyZWQgcmVsZWFzZSBldmVudCAke2luZGV4fWAgOiBgT2xkZXIgZXZlbnQgJHtpbmRleH1gLFxuICAgICAgdGltZXN0YW1wOiBuZXcgRGF0ZShEYXRlLlVUQygyMDI2LCAwLCAxLCAwLCAwLCA1MSAtIGluZGV4KSkudG9JU09TdHJpbmcoKSxcbiAgICB9KSk7XG4gICAgY29uc3QgZXZlbnRSZXF1ZXN0czogc3RyaW5nW10gPSBbXTtcbiAgICBwYWdlLm9uKFwicmVxdWVzdFwiLCAocmVxdWVzdCkgPT4ge1xuICAgICAgaWYgKG5ldyBVUkwocmVxdWVzdC51cmwoKSkucGF0aG5hbWUuZW5kc1dpdGgoXCIvYXBpL2V2ZW50c1wiKSlcbiAgICAgICAgZXZlbnRSZXF1ZXN0cy5wdXNoKHJlcXVlc3QudXJsKCkpO1xuICAgIH0pO1xuICAgIGF3YWl0IGluc3RhbGxBcGlGaXh0dXJlcyhwYWdlLCB7XG4gICAgICBldmVudHMsXG4gICAgICBwcm9qZWN0czogW1xuICAgICAgICB7XG4gICAgICAgICAgaWQ6IFwiZTJlLXByb2plY3RcIixcbiAgICAgICAgICBuYW1lOiBcIlNtb2tlIFByb2plY3RcIixcbiAgICAgICAgICBsYW5ndWFnZTogXCJUeXBlU2NyaXB0XCIsXG4gICAgICAgICAgZnJhbWV3b3JrOiBcIlJlYWN0XCIsXG4gICAgICAgICAgc3RhdHVzOiBcImFjdGl2ZVwiLFxuICAgICAgICAgIHJvb3RQYXRoOiBcIi9jb250cm9sbGVkL3Ntb2tlXCIsXG4gICAgICAgICAgcXVhbGl0eVNjb3JlOiA5MixcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgfSk7XG4gICAgYXdhaXQgcHJvZ3JhbW1hdGljU2lnbkluKHBhZ2UpO1xuICAgIGF3YWl0IHBhZ2UuZ290byhgJHtEQVNIQk9BUkRfUEFUSH1ldmVudHNgKTtcblxuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiT2xkZXIgZXZlbnQgNDlcIiwgeyBleGFjdDogdHJ1ZSB9KSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXCJPbGRlciBldmVudCA1MFwiLCB7IGV4YWN0OiB0cnVlIH0pLFxuICAgICkubm90LnRvQmVWaXNpYmxlKCk7XG4gICAgY29uc3QgZmlyc3RSZXF1ZXN0ID0gbmV3IFVSTChldmVudFJlcXVlc3RzLmF0KC0xKSEpO1xuICAgIGV4cGVjdChmaXJzdFJlcXVlc3Quc2VhcmNoUGFyYW1zLmdldChcImxpbWl0XCIpKS50b0JlKFwiNTBcIik7XG4gICAgZXhwZWN0KGZpcnN0UmVxdWVzdC5zZWFyY2hQYXJhbXMuZ2V0KFwicGFnZVwiKSkudG9CZShcIjFcIik7XG5cbiAgICBhd2FpdCBQcm9taXNlLmFsbChbXG4gICAgICBwYWdlLndhaXRGb3JSZXF1ZXN0KChyZXF1ZXN0KSA9PiB7XG4gICAgICAgIGNvbnN0IHVybCA9IG5ldyBVUkwocmVxdWVzdC51cmwoKSk7XG4gICAgICAgIHJldHVybiAoXG4gICAgICAgICAgdXJsLnBhdGhuYW1lLmVuZHNXaXRoKFwiL2FwaS9ldmVudHNcIikgJiZcbiAgICAgICAgICB1cmwuc2VhcmNoUGFyYW1zLmdldChcInBhZ2VcIikgPT09IFwiMlwiXG4gICAgICAgICk7XG4gICAgICB9KSxcbiAgICAgIHBhZ2UuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJPbGRlclwiIH0pLmNsaWNrKCksXG4gICAgXSk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlUZXh0KFwiUGFnZSAyLlwiLCB7IGV4YWN0OiBmYWxzZSB9KSkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcIk9sZGVyIGV2ZW50IDUwXCIsIHsgZXhhY3Q6IHRydWUgfSksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiRmlsdGVyZWQgcmVsZWFzZSBldmVudCAwXCIsIHsgZXhhY3Q6IHRydWUgfSksXG4gICAgKS5ub3QudG9CZVZpc2libGUoKTtcbiAgICBleHBlY3QobmV3IFVSTChldmVudFJlcXVlc3RzLmF0KC0xKSEpLnNlYXJjaFBhcmFtcy5nZXQoXCJwYWdlXCIpKS50b0JlKFwiMlwiKTtcbiAgICBhd2FpdCBwYWdlLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiTmV3ZXJcIiB9KS5jbGljaygpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlLmdldEJ5VGV4dChcIlBhZ2UgMS5cIiwgeyBleGFjdDogZmFsc2UgfSkpLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXCJGaWx0ZXJlZCByZWxlYXNlIGV2ZW50IDBcIiwgeyBleGFjdDogdHJ1ZSB9KSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG5cbiAgICBhd2FpdCBwYWdlLmdldEJ5UGxhY2Vob2xkZXIoXCJTZWFyY2ggbG9ncy4uLlwiKS5maWxsKFwiRmlsdGVyZWQgcmVsZWFzZVwiKTtcbiAgICBhd2FpdCBwYWdlLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiVG9nZ2xlIGV2ZW50IGZpbHRlcnNcIiB9KS5jbGljaygpO1xuICAgIGF3YWl0IHBhZ2UubG9jYXRvcihcInNlbGVjdFwiKS5udGgoMSkuc2VsZWN0T3B0aW9uKFwic3VjY2Vzc1wiKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcIkZpbHRlcmVkIHJlbGVhc2UgZXZlbnQgMFwiLCB7IGV4YWN0OiB0cnVlIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcIk9sZGVyIGV2ZW50IDFcIiwgeyBleGFjdDogdHJ1ZSB9KSxcbiAgICApLm5vdC50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlKS50b0hhdmVVUkwoL3NlYXJjaD1GaWx0ZXJlZFxcK3JlbGVhc2UvKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZSkudG9IYXZlVVJMKC9zZXZlcml0eT1zdWNjZXNzLyk7XG5cbiAgICBhd2FpdCBwYWdlLnJlbG9hZCgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiRmlsdGVyZWQgcmVsZWFzZSBldmVudCAwXCIsIHsgZXhhY3Q6IHRydWUgfSksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiT2xkZXIgZXZlbnQgMVwiLCB7IGV4YWN0OiB0cnVlIH0pLFxuICAgICkubm90LnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UuZ2V0QnlQbGFjZWhvbGRlcihcIlNlYXJjaCBsb2dzLi4uXCIpKS50b0hhdmVWYWx1ZShcbiAgICAgIFwiRmlsdGVyZWQgcmVsZWFzZVwiLFxuICAgICk7XG4gICAgYXdhaXQgcGFnZS5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIlRvZ2dsZSBldmVudCBmaWx0ZXJzXCIgfSkuY2xpY2soKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKFwic2VsZWN0XCIpLm50aCgxKSkudG9IYXZlVmFsdWUoXCJzdWNjZXNzXCIpO1xuICAgIGNvbnN0IGZpbHRlcmVkUmVxdWVzdCA9IG5ldyBVUkwoZXZlbnRSZXF1ZXN0cy5hdCgtMSkhKTtcbiAgICBleHBlY3QoZmlsdGVyZWRSZXF1ZXN0LnNlYXJjaFBhcmFtcy5nZXQoXCJsaW1pdFwiKSkudG9CZShcIjUwXCIpO1xuICAgIGV4cGVjdChmaWx0ZXJlZFJlcXVlc3Quc2VhcmNoUGFyYW1zLmdldChcInBhZ2VcIikpLnRvQmUoXCIxXCIpO1xuICAgIGV4cGVjdChmaWx0ZXJlZFJlcXVlc3Quc2VhcmNoUGFyYW1zLmdldChcInNlYXJjaFwiKSkudG9CZShcIkZpbHRlcmVkIHJlbGVhc2VcIik7XG4gICAgZXhwZWN0KGZpbHRlcmVkUmVxdWVzdC5zZWFyY2hQYXJhbXMuZ2V0KFwic2V2ZXJpdHlcIikpLnRvQmUoXCJzdWNjZXNzXCIpO1xuICB9KTtcblxuICB0ZXN0KFwicmVuZGVycyBhbiBBcmFiaWMgc291cmNlLWJhY2tlZCBBSSBhbnN3ZXIgd2l0aG91dCBpbnRlcm5hbCBkaWFnbm9zdGljc1wiLCBhc3luYyAoe1xuICAgIHBhZ2UsXG4gIH0pID0+IHtcbiAgICBjb25zdCBmaXh0dXJlID0gYXdhaXQgaW5zdGFsbEFyYWJpY0FpRml4dHVyZShwYWdlKTtcbiAgICBhd2FpdCBpbnN0YWxsQXBpRml4dHVyZXMocGFnZSwgeyBhcmFiaWNBaTogZml4dHVyZSB9KTtcbiAgICBhd2FpdCBwcm9ncmFtbWF0aWNTaWduSW4ocGFnZSk7XG4gICAgYXdhaXQgcGFnZS5nb3RvKGAke0RBU0hCT0FSRF9QQVRIfWFpYCk7XG5cbiAgICBjb25zdCBjb21wb3NlciA9IHBhZ2UubG9jYXRvcihcInRleHRhcmVhXCIpLmZpcnN0KCk7XG4gICAgYXdhaXQgZXhwZWN0KGNvbXBvc2VyKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGNvbXBvc2VyLmZpbGwoZml4dHVyZS5xdWVzdGlvbik7XG4gICAgY29uc3Qgc2VuZEJ1dHRvbiA9IGNvbXBvc2VyLmxvY2F0b3IoXCJ4cGF0aD0uLlwiKS5nZXRCeVJvbGUoXCJidXR0b25cIik7XG4gICAgYXdhaXQgZXhwZWN0KHNlbmRCdXR0b24pLnRvQmVFbmFibGVkKCk7XG4gICAgY29uc3Qgc3RyZWFtUmVzcG9uc2VQcm9taXNlID0gcGFnZS53YWl0Rm9yUmVzcG9uc2UoKHJlc3BvbnNlKSA9PlxuICAgICAgcmVzcG9uc2UudXJsKCkuaW5jbHVkZXMoXCIvYXBpL2FpL2NoYXQvc3RyZWFtXCIpLFxuICAgICk7XG4gICAgYXdhaXQgc2VuZEJ1dHRvbi5jbGljaygpO1xuICAgIGNvbnN0IHN0cmVhbVJlc3BvbnNlID0gYXdhaXQgc3RyZWFtUmVzcG9uc2VQcm9taXNlO1xuICAgIGV4cGVjdChzdHJlYW1SZXNwb25zZS5zdGF0dXMoKSkudG9CZSgyMDApO1xuXG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoZml4dHVyZS5xdWVzdGlvbiwgeyBleGFjdDogdHJ1ZSB9KS5sYXN0KCksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KGZpeHR1cmUuYW5zd2VyLCB7IGV4YWN0OiB0cnVlIH0pLmxhc3QoKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXCJBZ2VudCBhY3Rpdml0eVwiLCB7IGV4YWN0OiBmYWxzZSB9KSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgcGFnZS5sb2NhdG9yKFwic3VtbWFyeVwiKS5maWx0ZXIoeyBoYXNUZXh0OiBcIkFnZW50IGFjdGl2aXR5XCIgfSkuY2xpY2soKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcIlJlYWRpbmcgc291cmNlXCIsIHsgZXhhY3Q6IGZhbHNlIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChmaXh0dXJlLnNvdXJjZSwgeyBleGFjdDogdHJ1ZSB9KS5sYXN0KCksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KC9CZWhhdmlvciBldmlkZW5jZSDCtyAxIGV4Y2VycHQvaSkubGFzdCgpLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlXG4gICAgICAgIC5nZXRCeVRleHQoJ3JldHVybiBwYXJ0aWFsRnJvbUNvbGxlY3RlZEV2aWRlbmNlKFwicHJvdmlkZXIgdGltZW91dFwiKTsnLCB7XG4gICAgICAgICAgZXhhY3Q6IHRydWUsXG4gICAgICAgIH0pXG4gICAgICAgIC5sYXN0KCksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuXG4gICAgY29uc3QgdmlzaWJsZVRleHQgPSBhd2FpdCBwYWdlLmxvY2F0b3IoXCJib2R5XCIpLmlubmVyVGV4dCgpO1xuICAgIGV4cGVjdCh2aXNpYmxlVGV4dCkubm90LnRvQ29udGFpbihcIkNPTVBMRVRFRFwiKTtcbiAgICBleHBlY3QodmlzaWJsZVRleHQpLm5vdC50b0NvbnRhaW4oXCJQZXJzaXN0ZWQgZXhlY3V0aW9uIHByb29mXCIpO1xuICAgIGV4cGVjdCh2aXNpYmxlVGV4dCkudG9Db250YWluKFwiVGhlIHJlcXVpcmVkIGFuYWx5c2lzIGRpZCBub3QgY29tcGxldGUuXCIpO1xuICB9KTtcblxuICB0ZXN0KFwia2VlcHMgdGhlIEFJIHNlc3Npb24gZHJhd2VyIG92ZXJsYWlkIG9uIGEgcGhvbmUgdmlld3BvcnQgd2l0aCBhY2NlcHRlZCBldmlkZW5jZVwiLCBhc3luYyAoe1xuICAgIHBhZ2UsXG4gIH0pID0+IHtcbiAgICBhd2FpdCBwYWdlLnNldFZpZXdwb3J0U2l6ZSh7IHdpZHRoOiAzOTAsIGhlaWdodDogODQ0IH0pO1xuICAgIGNvbnN0IGZpeHR1cmUgPSBhd2FpdCBpbnN0YWxsQXJhYmljQWlGaXh0dXJlKHBhZ2UpO1xuICAgIGF3YWl0IGluc3RhbGxBcGlGaXh0dXJlcyhwYWdlLCB7IGFyYWJpY0FpOiBmaXh0dXJlIH0pO1xuICAgIGF3YWl0IHByb2dyYW1tYXRpY1NpZ25JbihwYWdlKTtcbiAgICBhd2FpdCBwYWdlLmdvdG8oYCR7REFTSEJPQVJEX1BBVEh9YWlgKTtcblxuICAgIGNvbnN0IGNvbXBvc2VyID0gcGFnZS5sb2NhdG9yKFwidGV4dGFyZWFcIikuZmlyc3QoKTtcbiAgICBhd2FpdCBjb21wb3Nlci5maWxsKGZpeHR1cmUucXVlc3Rpb24pO1xuICAgIGF3YWl0IGNvbXBvc2VyLmxvY2F0b3IoXCJ4cGF0aD0uLlwiKS5nZXRCeVJvbGUoXCJidXR0b25cIikuY2xpY2soKTtcblxuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KGZpeHR1cmUuYW5zd2VyLCB7IGV4YWN0OiB0cnVlIH0pLmxhc3QoKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZVxuICAgICAgICAuZ2V0QnlUZXh0KFwicmVxdWlyZWQgdG9vbCBkaWQgbm90IGNvbXBsZXRlIOKAlCBCTE9DS0VEL0lOQ09NUExFVEVcIiwge1xuICAgICAgICAgIGV4YWN0OiBmYWxzZSxcbiAgICAgICAgfSlcbiAgICAgICAgLmxhc3QoKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgcGFnZVxuICAgICAgLmxvY2F0b3IoXCJzdW1tYXJ5XCIpXG4gICAgICAuZmlsdGVyKHsgaGFzVGV4dDogXCJBZ2VudCBhY3Rpdml0eVwiIH0pXG4gICAgICAubGFzdCgpXG4gICAgICAuY2xpY2soKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKFwiYm9keVwiKSkudG9Db250YWluVGV4dChcIlJlYWRpbmcgc291cmNlXCIpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoXCJib2R5XCIpKS50b0NvbnRhaW5UZXh0KFxuICAgICAgXCJzcmMvbWlzc2luZy1yZWxlYXNlLWZpeHR1cmUudHNcIixcbiAgICApO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoXCJib2R5XCIpKS50b0NvbnRhaW5UZXh0KFwiVG9vbCBmYWlsZWRcIik7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcihcImJvZHlcIikpLnRvQ29udGFpblRleHQoXCJUT09MX0VYRUNVVElPTl9GQUlMRURcIik7XG4gICAgYXdhaXQgcGFnZVxuICAgICAgLmxvY2F0b3IoXCJzdW1tYXJ5XCIpXG4gICAgICAuZmlsdGVyKHsgaGFzVGV4dDogXCJQZXJzaXN0ZWQgZXhlY3V0aW9uIHByb29mXCIgfSlcbiAgICAgIC5sYXN0KClcbiAgICAgIC5jbGljaygpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2VcbiAgICAgICAgLmdldEJ5VGV4dChcInJlcXVpcmVkIHRvb2wgZmFpbGVkIOKAlCBvcGVyYXRpb24gYmxvY2tlZFwiLCB7IGV4YWN0OiB0cnVlIH0pXG4gICAgICAgIC5sYXN0KCksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdE5vSG9yaXpvbnRhbE92ZXJmbG93KHBhZ2UpO1xuXG4gICAgY29uc3QgdmlzaWJsZVRleHQgPSBhd2FpdCBwYWdlLmxvY2F0b3IoXCJib2R5XCIpLmlubmVyVGV4dCgpO1xuICAgIGV4cGVjdCh2aXNpYmxlVGV4dCkubm90LnRvTWF0Y2goXG4gICAgICAvcmF3UHJvbXB0fHN5c3RlbVByb21wdHxwcm92aWRlciBkaWFnbm9zdGljc3xzb3VyY2Utd2luZG93fHJlY292ZXJ5IHByb21wdHxcXC9ob21lXFwvcnVubmVyL2ksXG4gICAgKTtcbiAgfSk7XG5cbiAgdGVzdChcImtlZXBzIHNhZmUgY2l0YXRpb24gc3RhdGUgYWNyb3NzIGJyb3dzZXIgYmFjayBhbmQgZm9yd2FyZCBuYXZpZ2F0aW9uIHdpdGggYmxvY2tlZCBldmlkZW5jZVwiLCBhc3luYyAoe1xuICAgIHBhZ2UsXG4gIH0pID0+IHtcbiAgICBjb25zdCBhY2NlcHRlZCA9IGF3YWl0IGluc3RhbGxBcmFiaWNBaUZpeHR1cmUocGFnZSwge1xuICAgICAgc2Vzc2lvbklkOiBcImUyZS1oaXN0b3J5LWFjY2VwdGVkLXNlc3Npb25cIixcbiAgICAgIHF1ZXN0aW9uOiBcItmF2Kcg2YfZiCDYs9mE2YjZgyDZhdmH2YTYqSBwcm92aWRlciDYudmG2K8g2KfZhNix2KzZiNi5INi52KjYsSDYs9is2YQg2KfZhNmF2KrYtdmB2K3Yn1wiLFxuICAgIH0pO1xuICAgIGNvbnN0IGJsb2NrZWQgPSBhd2FpdCBpbnN0YWxsQXJhYmljQWlGaXh0dXJlKHBhZ2UsIHtcbiAgICAgIGJsb2NrZWQ6IHRydWUsXG4gICAgICBzZXNzaW9uSWQ6IFwiZTJlLWhpc3RvcnktYmxvY2tlZC1zZXNzaW9uXCIsXG4gICAgICBxdWVzdGlvbjogXCLZhdinINmH2Ygg2KfZhNiv2YTZitmEINin2YTZhdit2KzZiNioINi52YbYryDYp9mE2LHYrNmI2Lkg2LnYqNixINiz2KzZhCDYp9mE2YXYqti12YHYrdifXCIsXG4gICAgfSk7XG4gICAgYXdhaXQgaW5zdGFsbEFwaUZpeHR1cmVzKHBhZ2UsIHtcbiAgICAgIGFyYWJpY0FpOiBhY2NlcHRlZCxcbiAgICAgIGFsdGVybmF0ZUFpOiBibG9ja2VkLFxuICAgIH0pO1xuICAgIGF3YWl0IHByb2dyYW1tYXRpY1NpZ25JbihwYWdlKTtcbiAgICBhd2FpdCBwYWdlLmdvdG8oYCR7REFTSEJPQVJEX1BBVEh9YWlgKTtcblxuICAgIGNvbnN0IGNvbXBvc2VyID0gcGFnZS5sb2NhdG9yKFwidGV4dGFyZWFcIikuZmlyc3QoKTtcbiAgICBhd2FpdCBjb21wb3Nlci5maWxsKGZpeHR1cmUucXVlc3Rpb24pO1xuICAgIGF3YWl0IGNvbXBvc2VyLmxvY2F0b3IoXCJ4cGF0aD0uLlwiKS5nZXRCeVJvbGUoXCJidXR0b25cIikuY2xpY2soKTtcblxuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KGZpeHR1cmUuYW5zd2VyLCB7IGV4YWN0OiB0cnVlIH0pLmxhc3QoKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZVxuICAgICAgICAuZ2V0QnlUZXh0KFwicmVxdWlyZWQgdG9vbCBkaWQgbm90IGNvbXBsZXRlIOKAlCBCTE9DS0VEL0lOQ09NUExFVEVcIiwge1xuICAgICAgICAgIGV4YWN0OiBmYWxzZSxcbiAgICAgICAgfSlcbiAgICAgICAgLmxhc3QoKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgcGFnZVxuICAgICAgLmxvY2F0b3IoXCJzdW1tYXJ5XCIpXG4gICAgICAuZmlsdGVyKHsgaGFzVGV4dDogXCJBZ2VudCBhY3Rpdml0eVwiIH0pXG4gICAgICAubGFzdCgpXG4gICAgICAuY2xpY2soKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKFwiYm9keVwiKSkudG9Db250YWluVGV4dChcIlJlYWRpbmcgc291cmNlXCIpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoXCJib2R5XCIpKS50b0NvbnRhaW5UZXh0KFxuICAgICAgXCJzcmMvbWlzc2luZy1yZWxlYXNlLWZpeHR1cmUudHNcIixcbiAgICApO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoXCJib2R5XCIpKS50b0NvbnRhaW5UZXh0KFwiVG9vbCBmYWlsZWRcIik7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcihcImJvZHlcIikpLnRvQ29udGFpblRleHQoXCJUT09MX0VYRUNVVElPTl9GQUlMRURcIik7XG4gICAgYXdhaXQgcGFnZVxuICAgICAgLmxvY2F0b3IoXCJzdW1tYXJ5XCIpXG4gICAgICAuZmlsdGVyKHsgaGFzVGV4dDogXCJQZXJzaXN0ZWQgZXhlY3V0aW9uIHByb29mXCIgfSlcbiAgICAgIC5sYXN0KClcbiAgICAgIC5jbGljaygpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2VcbiAgICAgICAgLmdldEJ5VGV4dChcInJlcXVpcmVkIHRvb2wgZmFpbGVkIOKAlCBvcGVyYXRpb24gYmxvY2tlZFwiLCB7IGV4YWN0OiB0cnVlIH0pXG4gICAgICAgIC5sYXN0KCksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuXG4gICAgY29uc3QgdmlzaWJsZVRleHQgPSBhd2FpdCBwYWdlLmxvY2F0b3IoXCJib2R5XCIpLmlubmVyVGV4dCgpO1xuICAgIGV4cGVjdCh2aXNpYmxlVGV4dCkubm90LnRvTWF0Y2goXG4gICAgICAvcmF3UHJvbXB0fHN5c3RlbVByb21wdHxwcm92aWRlciBkaWFnbm9zdGljc3xzb3VyY2Utd2luZG93fHJlY292ZXJ5IHByb21wdHxcXC9ob21lXFwvcnVubmVyL2ksXG4gICAgKTtcbiAgfSk7XG5cbiAgdGVzdChcImtlZXBzIHNhZmUgY2l0YXRpb24gc3RhdGUgd2hlbiBzd2l0Y2hpbmcgcHJvamVjdHNcIiwgYXN5bmMgKHtcbiAgICBwYWdlLFxuICB9KSA9PiB7XG4gICAgY29uc3QgYWNjZXB0ZWQgPSBhd2FpdCBpbnN0YWxsQXJhYmljQWlGaXh0dXJlKHBhZ2UsIHtcbiAgICAgIHNlc3Npb25JZDogXCJlMmUtaGlzdG9yeS1hY2NlcHRlZC1zZXNzaW9uXCIsXG4gICAgICBxdWVzdGlvbjogXCLZhdinINmH2Ygg2LPZhNmI2YMg2YXZh9mE2KkgcHJvdmlkZXIg2LnZhtivINin2YTYsdis2YjYuSDYudio2LEg2LPYrNmEINin2YTZhdiq2LXZgdit2J9cIixcbiAgICB9KTtcbiAgICBjb25zdCBibG9ja2VkID0gYXdhaXQgaW5zdGFsbEFyYWJpY0FpRml4dHVyZShwYWdlLCB7XG4gICAgICBibG9ja2VkOiB0cnVlLFxuICAgICAgc2Vzc2lvbklkOiBcImUyZS1oaXN0b3J5LWJsb2NrZWQtc2Vzc2lvblwiLFxuICAgICAgcXVlc3Rpb246IFwi2YXYpyDZh9mIINin2YTYr9mE2YrZhCDYp9mE2YXYrdis2YjYqCDYudmG2K8g2KfZhNix2KzZiNi5INi52KjYsSDYs9is2YQg2KfZhNmF2KrYtdmB2K3Yn1wiLFxuICAgIH0pO1xuICAgIGF3YWl0IGluc3RhbGxBcGlGaXh0dXJlcyhwYWdlLCB7XG4gICAgICBhcmFiaWNBaTogYWNjZXB0ZWQsXG4gICAgICBhbHRlcm5hdGVBaTogYmxvY2tlZCxcbiAgICAgIHByb2plY3RzOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBpZDogXCJlMmUtcHJvamVjdC1vbmVcIixcbiAgICAgICAgICBuYW1lOiBcIkNpdGF0aW9uIFByb2plY3QgT25lXCIsXG4gICAgICAgICAgbGFuZ3VhZ2U6IFwiVHlwZVNjcmlwdFwiLFxuICAgICAgICAgIGZyYW1ld29yazogXCJSZWFjdFwiLFxuICAgICAgICAgIHN0YXR1czogXCJhY3RpdmVcIixcbiAgICAgICAgICByb290UGF0aDogXCIvY29udHJvbGxlZC9wcm9qZWN0LW9uZVwiLFxuICAgICAgICAgIHF1YWxpdHlTY29yZTogOTIsXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBpZDogXCJlMmUtcHJvamVjdC10d29cIixcbiAgICAgICAgICBuYW1lOiBcIkNpdGF0aW9uIFByb2plY3QgVHdvXCIsXG4gICAgICAgICAgbGFuZ3VhZ2U6IFwiVHlwZVNjcmlwdFwiLFxuICAgICAgICAgIGZyYW1ld29yazogXCJSZWFjdFwiLFxuICAgICAgICAgIHN0YXR1czogXCJhY3RpdmVcIixcbiAgICAgICAgICByb290UGF0aDogXCIvY29udHJvbGxlZC9wcm9qZWN0LXR3b1wiLFxuICAgICAgICAgIHF1YWxpdHlTY29yZTogODgsXG4gICAgICAgIH0sXG4gICAgICBdLFxuICAgIH0pO1xuICAgIGF3YWl0IHByb2dyYW1tYXRpY1NpZ25JbihwYWdlKTtcbiAgICBhd2FpdCBwYWdlLmdvdG8oYCR7REFTSEJPQVJEX1BBVEh9YWlgKTtcblxuICAgIGF3YWl0IHBhZ2VcbiAgICAgIC5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBhY2NlcHRlZC5xdWVzdGlvbiwgZXhhY3Q6IHRydWUgfSlcbiAgICAgIC5jbGljaygpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KGFjY2VwdGVkLmFuc3dlciwgeyBleGFjdDogdHJ1ZSB9KS5sYXN0KCksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KGAke2FjY2VwdGVkLnNvdXJjZX06NDJgLCB7IGV4YWN0OiBmYWxzZSB9KS5sYXN0KCksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiQWNjZXB0ZWQ6IHNvdXJjZSBzcGFuIHZlcmlmaWVkLlwiLCB7IGV4YWN0OiB0cnVlIH0pLmxhc3QoKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG5cbiAgICBhd2FpdCBwYWdlLmdldEJ5Um9sZShcImNvbWJvYm94XCIpLnNlbGVjdE9wdGlvbihcImUyZS1wcm9qZWN0LXR3b1wiKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IGJsb2NrZWQucXVlc3Rpb24sIGV4YWN0OiB0cnVlIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5nZXRCeVRleHQoYWNjZXB0ZWQuYW5zd2VyLCB7IGV4YWN0OiB0cnVlIH0pKS50b0hhdmVDb3VudChcbiAgICAgIDAsXG4gICAgKTtcbiAgICBhd2FpdCBwYWdlXG4gICAgICAuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogYmxvY2tlZC5xdWVzdGlvbiwgZXhhY3Q6IHRydWUgfSlcbiAgICAgIC5jbGljaygpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2VcbiAgICAgICAgLmdldEJ5VGV4dChcIkJsb2NrZWQ6IG5vIG1hdGNoaW5nIHNvdXJjZSB0ZXh0IHdhcyBmb3VuZC5cIiwge1xuICAgICAgICAgIGV4YWN0OiB0cnVlLFxuICAgICAgICB9KVxuICAgICAgICAubGFzdCgpLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChgJHtibG9ja2VkLnNvdXJjZX06NDJgLCB7IGV4YWN0OiBmYWxzZSB9KSxcbiAgICApLnRvSGF2ZUNvdW50KDApO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiQWNjZXB0ZWQ6IHNvdXJjZSBzcGFuIHZlcmlmaWVkLlwiLCB7IGV4YWN0OiB0cnVlIH0pLFxuICAgICkudG9IYXZlQ291bnQoMCk7XG5cbiAgICBhd2FpdCBwYWdlLmdldEJ5Um9sZShcImNvbWJvYm94XCIpLnNlbGVjdE9wdGlvbihcImUyZS1wcm9qZWN0LW9uZVwiKTtcbiAgICBhd2FpdCBwYWdlXG4gICAgICAuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogYWNjZXB0ZWQucXVlc3Rpb24sIGV4YWN0OiB0cnVlIH0pXG4gICAgICAuY2xpY2soKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChgJHthY2NlcHRlZC5zb3VyY2V9OjQyYCwgeyBleGFjdDogZmFsc2UgfSkubGFzdCgpLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcIkFjY2VwdGVkOiBzb3VyY2Ugc3BhbiB2ZXJpZmllZC5cIiwgeyBleGFjdDogdHJ1ZSB9KS5sYXN0KCksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiQmxvY2tlZDogbm8gbWF0Y2hpbmcgc291cmNlIHRleHQgd2FzIGZvdW5kLlwiLCB7XG4gICAgICAgIGV4YWN0OiB0cnVlLFxuICAgICAgfSksXG4gICAgKS50b0hhdmVDb3VudCgwKTtcblxuICAgIGNvbnN0IHZpc2libGVUZXh0ID0gYXdhaXQgcGFnZS5sb2NhdG9yKFwiYm9keVwiKS5pbm5lclRleHQoKTtcbiAgICBleHBlY3QodmlzaWJsZVRleHQpLm5vdC50b01hdGNoKFxuICAgICAgL3Jhd1Byb21wdHxzeXN0ZW1Qcm9tcHR8cHJvdmlkZXIgZGlhZ25vc3RpY3N8c291cmNlLXdpbmRvd3xyZWNvdmVyeSBwcm9tcHR8XFwvaG9tZVxcL3J1bm5lci9pLFxuICAgICk7XG4gIH0pO1xuXG4gIHRlc3QoXCJrZWVwcyBzYWZlIGNpdGF0aW9uIHN0YXRlIGFjcm9zcyByZXBlYXRlZCBuYXZpZ2F0aW9uXCIsIGFzeW5jICh7XG4gICAgcGFnZSxcbiAgfSkgPT4ge1xuICAgIGNvbnN0IGFjY2VwdGVkID0gYXdhaXQgaW5zdGFsbEFyYWJpY0FpRml4dHVyZShwYWdlLCB7XG4gICAgICBzZXNzaW9uSWQ6IFwiZTJlLWhpc3RvcnktYWNjZXB0ZWQtc2Vzc2lvblwiLFxuICAgICAgcXVlc3Rpb246IFwi2YXYpyDZh9mIINiz2YTZiNmDINmF2YfZhNipIHByb3ZpZGVyINi52YbYryDYp9mE2LHYrNmI2Lkg2LnYqNixINiz2KzZhCDYp9mE2YXYqti12YHYrdifXCIsXG4gICAgfSk7XG4gICAgY29uc3QgYmxvY2tlZCA9IGF3YWl0IGluc3RhbGxBcmFiaWNBaUZpeHR1cmUocGFnZSwge1xuICAgICAgYmxvY2tlZDogdHJ1ZSxcbiAgICAgIHNlc3Npb25JZDogXCJlMmUtaGlzdG9yeS1ibG9ja2VkLXNlc3Npb25cIixcbiAgICAgIHF1ZXN0aW9uOiBcItmF2Kcg2YfZiCDYp9mE2K/ZhNmK2YQg2KfZhNmF2K3YrNmI2Kgg2LnZhtivINin2YTYsdis2YjYuSDYudio2LEg2LPYrNmEINin2YTZhdiq2LXZgdit2J9cIixcbiAgICB9KTtcbiAgICBhd2FpdCBpbnN0YWxsQXBpRml4dHVyZXMocGFnZSwge1xuICAgICAgYXJhYmljQWk6IGFjY2VwdGVkLFxuICAgICAgYWx0ZXJuYXRlQWk6IGJsb2NrZWQsXG4gICAgfSk7XG4gICAgYXdhaXQgcHJvZ3JhbW1hdGljU2lnbkluKHBhZ2UpO1xuICAgIGF3YWl0IHBhZ2UuZ290byhgJHtEQVNIQk9BUkRfUEFUSH1haWApO1xuXG4gICAgY29uc3QgYXNzZXJ0QWNjZXB0ZWRDaXRhdGlvbiA9IGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IGV4cGVjdChcbiAgICAgICAgcGFnZS5nZXRCeVRleHQoYWNjZXB0ZWQuYW5zd2VyLCB7IGV4YWN0OiB0cnVlIH0pLmxhc3QoKSxcbiAgICAgICkudG9CZVZpc2libGUoKTtcbiAgICAgIGF3YWl0IGV4cGVjdChcbiAgICAgICAgcGFnZS5nZXRCeVRleHQoYCR7YWNjZXB0ZWQuc291cmNlfTo0MmAsIHsgZXhhY3Q6IGZhbHNlIH0pLmxhc3QoKSxcbiAgICAgICkudG9CZVZpc2libGUoKTtcbiAgICAgIGF3YWl0IGV4cGVjdChcbiAgICAgICAgcGFnZVxuICAgICAgICAgIC5nZXRCeVRleHQoXCJBY2NlcHRlZDogc291cmNlIHNwYW4gdmVyaWZpZWQuXCIsIHsgZXhhY3Q6IHRydWUgfSlcbiAgICAgICAgICAubGFzdCgpLFxuICAgICAgKS50b0JlVmlzaWJsZSgpO1xuICAgICAgYXdhaXQgZXhwZWN0KFxuICAgICAgICBwYWdlLmdldEJ5VGV4dChcIkJsb2NrZWQ6IG5vIG1hdGNoaW5nIHNvdXJjZSB0ZXh0IHdhcyBmb3VuZC5cIiwge1xuICAgICAgICAgIGV4YWN0OiB0cnVlLFxuICAgICAgICB9KSxcbiAgICAgICkudG9IYXZlQ291bnQoMCk7XG4gICAgfTtcbiAgICBjb25zdCBhc3NlcnRCbG9ja2VkQ2l0YXRpb24gPSBhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCBleHBlY3QoXG4gICAgICAgIHBhZ2VcbiAgICAgICAgICAuZ2V0QnlUZXh0KFwiQmxvY2tlZDogbm8gbWF0Y2hpbmcgc291cmNlIHRleHQgd2FzIGZvdW5kLlwiLCB7XG4gICAgICAgICAgICBleGFjdDogdHJ1ZSxcbiAgICAgICAgICB9KVxuICAgICAgICAgIC5sYXN0KCksXG4gICAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgICBhd2FpdCBleHBlY3QoXG4gICAgICAgIHBhZ2UuZ2V0QnlUZXh0KGAke2Jsb2NrZWQuc291cmNlfTo0MmAsIHsgZXhhY3Q6IGZhbHNlIH0pLFxuICAgICAgKS50b0hhdmVDb3VudCgwKTtcbiAgICAgIGF3YWl0IGV4cGVjdChcbiAgICAgICAgcGFnZS5nZXRCeVRleHQoXCJBY2NlcHRlZDogc291cmNlIHNwYW4gdmVyaWZpZWQuXCIsIHsgZXhhY3Q6IHRydWUgfSksXG4gICAgICApLnRvSGF2ZUNvdW50KDApO1xuICAgIH07XG4gICAgY29uc3QgYXNzZXJ0Tm9JbnRlcm5hbENpdGF0aW9uRGV0YWlscyA9IGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHZpc2libGVUZXh0ID0gYXdhaXQgcGFnZS5sb2NhdG9yKFwiYm9keVwiKS5pbm5lclRleHQoKTtcbiAgICAgIGV4cGVjdCh2aXNpYmxlVGV4dCkubm90LnRvTWF0Y2goXG4gICAgICAgIC9NSVNTSU5HX0xJVEVSQUxfTUFUQ0h8cmF3UHJvbXB0fHN5c3RlbVByb21wdHxwcm92aWRlciBkaWFnbm9zdGljc3xzb3VyY2Utd2luZG93fHJlY292ZXJ5IHByb21wdHxcXC9ob21lXFwvcnVubmVyL2ksXG4gICAgICApO1xuICAgIH07XG5cbiAgICBhd2FpdCBwYWdlXG4gICAgICAuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogYWNjZXB0ZWQucXVlc3Rpb24sIGV4YWN0OiB0cnVlIH0pXG4gICAgICAuY2xpY2soKTtcbiAgICBhd2FpdCBhc3NlcnRBY2NlcHRlZENpdGF0aW9uKCk7XG5cbiAgICBhd2FpdCBvcGVuTmF2aWdhdGlvbihwYWdlLCBcIlByb2plY3RzXCIsIGAke0RBU0hCT0FSRF9QQVRIfXByb2plY3RzYCk7XG4gICAgYXdhaXQgcGFnZS5nb0JhY2soKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZSkudG9IYXZlVVJMKFxuICAgICAgbmV3IFJlZ0V4cChgJHtEQVNIQk9BUkRfUEFUSC5yZXBsYWNlQWxsKFwiL1wiLCBcIlxcXFwvXCIpfWFpJGApLFxuICAgICk7XG4gICAgYXdhaXQgcGFnZVxuICAgICAgLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IGFjY2VwdGVkLnF1ZXN0aW9uLCBleGFjdDogdHJ1ZSB9KVxuICAgICAgLmNsaWNrKCk7XG4gICAgYXdhaXQgYXNzZXJ0QWNjZXB0ZWRDaXRhdGlvbigpO1xuICAgIGF3YWl0IGFzc2VydE5vSW50ZXJuYWxDaXRhdGlvbkRldGFpbHMoKTtcblxuICAgIGF3YWl0IHBhZ2UuZ29Gb3J3YXJkKCk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UpLnRvSGF2ZVVSTChcbiAgICAgIG5ldyBSZWdFeHAoYCR7REFTSEJPQVJEX1BBVEgucmVwbGFjZUFsbChcIi9cIiwgXCJcXFxcL1wiKX1wcm9qZWN0cyRgKSxcbiAgICApO1xuICAgIGF3YWl0IHBhZ2UuZ29CYWNrKCk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UpLnRvSGF2ZVVSTChcbiAgICAgIG5ldyBSZWdFeHAoYCR7REFTSEJPQVJEX1BBVEgucmVwbGFjZUFsbChcIi9cIiwgXCJcXFxcL1wiKX1haSRgKSxcbiAgICApO1xuICAgIGF3YWl0IHBhZ2VcbiAgICAgIC5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBhY2NlcHRlZC5xdWVzdGlvbiwgZXhhY3Q6IHRydWUgfSlcbiAgICAgIC5jbGljaygpO1xuICAgIGF3YWl0IGFzc2VydEFjY2VwdGVkQ2l0YXRpb24oKTtcblxuICAgIGF3YWl0IHBhZ2VcbiAgICAgIC5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBibG9ja2VkLnF1ZXN0aW9uLCBleGFjdDogdHJ1ZSB9KVxuICAgICAgLmNsaWNrKCk7XG4gICAgYXdhaXQgYXNzZXJ0QmxvY2tlZENpdGF0aW9uKCk7XG5cbiAgICBhd2FpdCBvcGVuTmF2aWdhdGlvbihwYWdlLCBcIkV2ZW50IFN0cmVhbVwiLCBgJHtEQVNIQk9BUkRfUEFUSH1ldmVudHNgKTtcbiAgICBhd2FpdCBwYWdlLmdvQmFjaygpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlKS50b0hhdmVVUkwoXG4gICAgICBuZXcgUmVnRXhwKGAke0RBU0hCT0FSRF9QQVRILnJlcGxhY2VBbGwoXCIvXCIsIFwiXFxcXC9cIil9YWkkYCksXG4gICAgKTtcbiAgICBhd2FpdCBwYWdlXG4gICAgICAuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogYmxvY2tlZC5xdWVzdGlvbiwgZXhhY3Q6IHRydWUgfSlcbiAgICAgIC5jbGljaygpO1xuICAgIGF3YWl0IGFzc2VydEJsb2NrZWRDaXRhdGlvbigpO1xuICAgIGF3YWl0IGFzc2VydE5vSW50ZXJuYWxDaXRhdGlvbkRldGFpbHMoKTtcblxuICAgIGF3YWl0IHBhZ2UuZ29Gb3J3YXJkKCk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UpLnRvSGF2ZVVSTChcbiAgICAgIG5ldyBSZWdFeHAoYCR7REFTSEJPQVJEX1BBVEgucmVwbGFjZUFsbChcIi9cIiwgXCJcXFxcL1wiKX1ldmVudHMkYCksXG4gICAgKTtcbiAgICBhd2FpdCBwYWdlLmdvQmFjaygpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlKS50b0hhdmVVUkwoXG4gICAgICBuZXcgUmVnRXhwKGAke0RBU0hCT0FSRF9QQVRILnJlcGxhY2VBbGwoXCIvXCIsIFwiXFxcXC9cIil9YWkkYCksXG4gICAgKTtcbiAgICBhd2FpdCBwYWdlXG4gICAgICAuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogYmxvY2tlZC5xdWVzdGlvbiwgZXhhY3Q6IHRydWUgfSlcbiAgICAgIC5jbGljaygpO1xuICAgIGF3YWl0IGFzc2VydEJsb2NrZWRDaXRhdGlvbigpO1xuICAgIGF3YWl0IGFzc2VydE5vSW50ZXJuYWxDaXRhdGlvbkRldGFpbHMoKTtcbiAgfSk7XG5cbiAgdGVzdChcImtlZXBzIG9ubHkgdGhlIHNhZmUgYmxvY2tlZCBjaXRhdGlvbiByZWFzb24gYWZ0ZXIgY2hhdCByZWxvYWRcIiwgYXN5bmMgKHtcbiAgICBwYWdlLFxuICB9KSA9PiB7XG4gICAgY29uc3QgZml4dHVyZSA9IGF3YWl0IGluc3RhbGxBcmFiaWNBaUZpeHR1cmUocGFnZSk7XG4gICAgYXdhaXQgaW5zdGFsbEFwaUZpeHR1cmVzKHBhZ2UsIHsgYXJhYmljQWk6IGZpeHR1cmUgfSk7XG4gICAgYXdhaXQgcHJvZ3JhbW1hdGljU2lnbkluKHBhZ2UpO1xuICAgIGF3YWl0IHBhZ2UuZ290byhgJHtEQVNIQk9BUkRfUEFUSH1haWApO1xuXG4gICAgY29uc3QgY29tcG9zZXIgPSBwYWdlLmxvY2F0b3IoXCJ0ZXh0YXJlYVwiKS5maXJzdCgpO1xuICAgIGF3YWl0IGNvbXBvc2VyLmZpbGwoZml4dHVyZS5xdWVzdGlvbik7XG4gICAgYXdhaXQgY29tcG9zZXIubG9jYXRvcihcInhwYXRoPS4uXCIpLmdldEJ5Um9sZShcImJ1dHRvblwiKS5jbGljaygpO1xuXG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoZml4dHVyZS5hbnN3ZXIsIHsgZXhhY3Q6IHRydWUgfSkubGFzdCgpLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlXG4gICAgICAgIC5nZXRCeVRleHQoXCJyZXF1aXJlZCB0b29sIGRpZCBub3QgY29tcGxldGUg4oCUIEJMT0NLRUQvSU5DT01QTEVURVwiLCB7XG4gICAgICAgICAgZXhhY3Q6IGZhbHNlLFxuICAgICAgICB9KVxuICAgICAgICAubGFzdCgpLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBwYWdlXG4gICAgICAubG9jYXRvcihcInN1bW1hcnlcIilcbiAgICAgIC5maWx0ZXIoeyBoYXNUZXh0OiBcIkFnZW50IGFjdGl2aXR5XCIgfSlcbiAgICAgIC5sYXN0KClcbiAgICAgIC5jbGljaygpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoXCJib2R5XCIpKS50b0NvbnRhaW5UZXh0KFwiUmVhZGluZyBzb3VyY2VcIik7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcihcImJvZHlcIikpLnRvQ29udGFpblRleHQoXG4gICAgICBcInNyYy9taXNzaW5nLXJlbGVhc2UtZml4dHVyZS50c1wiLFxuICAgICk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcihcImJvZHlcIikpLnRvQ29udGFpblRleHQoXCJUb29sIGZhaWxlZFwiKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKFwiYm9keVwiKSkudG9Db250YWluVGV4dChcIlRPT0xfRVhFQ1VUSU9OX0ZBSUxFRFwiKTtcbiAgICBhd2FpdCBwYWdlXG4gICAgICAubG9jYXRvcihcInN1bW1hcnlcIilcbiAgICAgIC5maWx0ZXIoeyBoYXNUZXh0OiBcIlBlcnNpc3RlZCBleGVjdXRpb24gcHJvb2ZcIiB9KVxuICAgICAgLmxhc3QoKVxuICAgICAgLmNsaWNrKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZVxuICAgICAgICAuZ2V0QnlUZXh0KFwicmVxdWlyZWQgdG9vbCBmYWlsZWQg4oCUIG9wZXJhdGlvbiBibG9ja2VkXCIsIHsgZXhhY3Q6IHRydWUgfSlcbiAgICAgICAgLmxhc3QoKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG5cbiAgICBjb25zdCB2aXNpYmxlVGV4dCA9IGF3YWl0IHBhZ2UubG9jYXRvcihcImJvZHlcIikuaW5uZXJUZXh0KCk7XG4gICAgZXhwZWN0KHZpc2libGVUZXh0KS5ub3QudG9Db250YWluKFwiQ09NUExFVEVEXCIpO1xuICAgIGV4cGVjdCh2aXNpYmxlVGV4dCkubm90LnRvQ29udGFpbihcIlBlcnNpc3RlZCBleGVjdXRpb24gcHJvb2ZcIik7XG4gICAgZXhwZWN0KHZpc2libGVUZXh0KS50b0NvbnRhaW4oXCJUaGUgcmVxdWlyZWQgYW5hbHlzaXMgZGlkIG5vdCBjb21wbGV0ZS5cIik7XG4gIH0pO1xuXG4gIHRlc3QoXCJrZWVwcyB0aGUgZmFpbGVkIEFJIHNlc3Npb24gZHJhd2VyIG92ZXJsYWlkIG9uIGEgcGhvbmUgdmlld3BvcnRcIiwgYXN5bmMgKHtcbiAgICBwYWdlLFxuICB9KSA9PiB7XG4gICAgYXdhaXQgcGFnZS5zZXRWaWV3cG9ydFNpemUoeyB3aWR0aDogMzkwLCBoZWlnaHQ6IDg0NCB9KTtcbiAgICBjb25zdCBmaXh0dXJlID0gYXdhaXQgaW5zdGFsbEFyYWJpY0FpRml4dHVyZShwYWdlKTtcbiAgICBhd2FpdCBpbnN0YWxsQXBpRml4dHVyZXMocGFnZSwgeyBhcmFiaWNBaTogZml4dHVyZSB9KTtcbiAgICBhd2FpdCBwcm9ncmFtbWF0aWNTaWduSW4ocGFnZSk7XG4gICAgYXdhaXQgcGFnZS5nb3RvKGAke0RBU0hCT0FSRF9QQVRIfWFpYCk7XG5cbiAgICBjb25zdCBjb21wb3NlciA9IHBhZ2UubG9jYXRvcihcInRleHRhcmVhXCIpLmZpcnN0KCk7XG4gICAgYXdhaXQgY29tcG9zZXIuZmlsbChmaXh0dXJlLnF1ZXN0aW9uKTtcbiAgICBhd2FpdCBjb21wb3Nlci5sb2NhdG9yKFwieHBhdGg9Li5cIikuZ2V0QnlSb2xlKFwiYnV0dG9uXCIpLmNsaWNrKCk7XG5cbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChmaXh0dXJlLmFuc3dlciwgeyBleGFjdDogdHJ1ZSB9KS5sYXN0KCksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2VcbiAgICAgICAgLmdldEJ5VGV4dChcInJlcXVpcmVkIHRvb2wgZGlkIG5vdCBjb21wbGV0ZSDigJQgQkxPQ0tFRC9JTkNPTVBMRVRFXCIsIHtcbiAgICAgICAgICBleGFjdDogZmFsc2UsXG4gICAgICAgIH0pXG4gICAgICAgIC5sYXN0KCksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IHBhZ2VcbiAgICAgIC5sb2NhdG9yKFwic3VtbWFyeVwiKVxuICAgICAgLmZpbHRlcih7IGhhc1RleHQ6IFwiQWdlbnQgYWN0aXZpdHlcIiB9KVxuICAgICAgLmxhc3QoKVxuICAgICAgLmNsaWNrKCk7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcihcImJvZHlcIikpLnRvQ29udGFpblRleHQoXCJSZWFkaW5nIHNvdXJjZVwiKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKFwiYm9keVwiKSkudG9Db250YWluVGV4dChcbiAgICAgIFwic3JjL21pc3NpbmctcmVsZWFzZS1maXh0dXJlLnRzXCIsXG4gICAgKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKFwiYm9keVwiKSkudG9Db250YWluVGV4dChcIlRvb2wgZmFpbGVkXCIpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoXCJib2R5XCIpKS50b0NvbnRhaW5UZXh0KFwiVE9PTF9FWEVDVVRJT05fRkFJTEVEXCIpO1xuICAgIGF3YWl0IHBhZ2VcbiAgICAgIC5sb2NhdG9yKFwic3VtbWFyeVwiKVxuICAgICAgLmZpbHRlcih7IGhhc1RleHQ6IFwiUGVyc2lzdGVkIGV4ZWN1dGlvbiBwcm9vZlwiIH0pXG4gICAgICAubGFzdCgpXG4gICAgICAuY2xpY2soKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlXG4gICAgICAgIC5nZXRCeVRleHQoXCJyZXF1aXJlZCB0b29sIGZhaWxlZCDigJQgb3BlcmF0aW9uIGJsb2NrZWRcIiwgeyBleGFjdDogdHJ1ZSB9KVxuICAgICAgICAubGFzdCgpLFxuICAgICkudG9CZVZpc2libGUoKTtcblxuICAgIGNvbnN0IHZpc2libGVUZXh0ID0gYXdhaXQgcGFnZS5sb2NhdG9yKFwiYm9keVwiKS5pbm5lclRleHQoKTtcbiAgICBleHBlY3QodmlzaWJsZVRleHQpLm5vdC50b01hdGNoKFxuICAgICAgL3JhdyBleGNlcHRpb258c3RhY2sgdHJhY2V8XFwvaG9tZVxcL3J1bm5lcnxzZWNyZXR8Zml4dHVyZSBkaWFnbm9zdGljL2ksXG4gICAgKTtcblxuICAgIGF3YWl0IHBhZ2UucmVsb2FkKCk7XG4gICAgYXdhaXQgcGFnZVxuICAgICAgLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IGZpeHR1cmUucXVlc3Rpb24sIGV4YWN0OiB0cnVlIH0pXG4gICAgICAuY2xpY2soKTtcblxuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KGZpeHR1cmUuYW5zd2VyLCB7IGV4YWN0OiB0cnVlIH0pLmxhc3QoKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZVxuICAgICAgICAuZ2V0QnlUZXh0KFwicmVxdWlyZWQgdG9vbCBkaWQgbm90IGNvbXBsZXRlIOKAlCBCTE9DS0VEL0lOQ09NUExFVEVcIiwge1xuICAgICAgICAgIGV4YWN0OiBmYWxzZSxcbiAgICAgICAgfSlcbiAgICAgICAgLmxhc3QoKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgcGFnZVxuICAgICAgLmxvY2F0b3IoXCJzdW1tYXJ5XCIpXG4gICAgICAuZmlsdGVyKHsgaGFzVGV4dDogXCJBZ2VudCBhY3Rpdml0eVwiIH0pXG4gICAgICAubGFzdCgpXG4gICAgICAuY2xpY2soKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5sb2NhdG9yKFwiYm9keVwiKSkudG9Db250YWluVGV4dChcIlJlYWRpbmcgc291cmNlXCIpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoXCJib2R5XCIpKS50b0NvbnRhaW5UZXh0KFxuICAgICAgXCJzcmMvbWlzc2luZy1yZWxlYXNlLWZpeHR1cmUudHNcIixcbiAgICApO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlLmxvY2F0b3IoXCJib2R5XCIpKS50b0NvbnRhaW5UZXh0KFwiVG9vbCBmYWlsZWRcIik7XG4gICAgYXdhaXQgZXhwZWN0KHBhZ2UubG9jYXRvcihcImJvZHlcIikpLnRvQ29udGFpblRleHQoXCJUT09MX0VYRUNVVElPTl9GQUlMRURcIik7XG4gICAgYXdhaXQgcGFnZVxuICAgICAgLmxvY2F0b3IoXCJzdW1tYXJ5XCIpXG4gICAgICAuZmlsdGVyKHsgaGFzVGV4dDogXCJQZXJzaXN0ZWQgZXhlY3V0aW9uIHByb29mXCIgfSlcbiAgICAgIC5sYXN0KClcbiAgICAgIC5jbGljaygpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2VcbiAgICAgICAgLmdldEJ5VGV4dChcInJlcXVpcmVkIHRvb2wgZmFpbGVkIOKAlCBvcGVyYXRpb24gYmxvY2tlZFwiLCB7IGV4YWN0OiB0cnVlIH0pXG4gICAgICAgIC5sYXN0KCksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuXG4gICAgY29uc3QgcmVsb2FkZWRUZXh0ID0gYXdhaXQgcGFnZS5sb2NhdG9yKFwiYm9keVwiKS5pbm5lclRleHQoKTtcbiAgICBhd2FpdCBleHBlY3ROb0hvcml6b250YWxPdmVyZmxvdyhwYWdlKTtcbiAgICBleHBlY3QocmVsb2FkZWRUZXh0KS5ub3QudG9NYXRjaChcbiAgICAgIC9yYXcgZXhjZXB0aW9ufHN0YWNrIHRyYWNlfFxcL2hvbWVcXC9ydW5uZXJ8c2VjcmV0fGZpeHR1cmUgZGlhZ25vc3RpYy9pLFxuICAgICk7XG4gIH0pO1xuXG4gIHRlc3QoXCJwcmVzZXJ2ZXMgb25lIHBhcnRpYWwgYW5zd2VyIGFmdGVyIGEgcHJvdmlkZXIgZGlzY29ubmVjdCBhbmQgbWFya3MgaXQgaW5jb21wbGV0ZVwiLCBhc3luYyAoe1xuICAgIHBhZ2UsXG4gIH0pID0+IHtcbiAgICBjb25zdCBmaXh0dXJlID0gYXdhaXQgaW5zdGFsbEFyYWJpY0FpRml4dHVyZShwYWdlKTtcbiAgICBhd2FpdCBpbnN0YWxsQXBpRml4dHVyZXMocGFnZSwgeyBhcmFiaWNBaTogZml4dHVyZSB9KTtcbiAgICBhd2FpdCBwcm9ncmFtbWF0aWNTaWduSW4ocGFnZSk7XG4gICAgYXdhaXQgcGFnZS5nb3RvKGAke0RBU0hCT0FSRF9QQVRIfWFpYCk7XG5cbiAgICBjb25zdCBjb21wb3NlciA9IHBhZ2UubG9jYXRvcihcInRleHRhcmVhXCIpLmZpcnN0KCk7XG4gICAgYXdhaXQgY29tcG9zZXIuZmlsbChmaXh0dXJlLnF1ZXN0aW9uKTtcbiAgICBhd2FpdCBjb21wb3Nlci5sb2NhdG9yKFwieHBhdGg9Li5cIikuZ2V0QnlSb2xlKFwiYnV0dG9uXCIpLmNsaWNrKCk7XG5cbiAgICBjb25zdCBhbnN3ZXIgPSBwYWdlLmdldEJ5VGV4dChmaXh0dXJlLmFuc3dlciwgeyBleGFjdDogdHJ1ZSB9KTtcbiAgICBhd2FpdCBleHBlY3QoYW5zd2VyKS50b0hhdmVDb3VudCgxKTtcbiAgICBhd2FpdCBleHBlY3QoYW5zd2VyKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlLmdldEJ5VGV4dChcIklOQ09NUExFVEU6XCIsIHsgZXhhY3Q6IGZhbHNlIH0pKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwicHJvdmlkZXIgZmFpbHVyZVwiLCB7IGV4YWN0OiBmYWxzZSB9KS5sYXN0KCksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwic3RvcHBlZDogcHJvdmlkZXIgdGltZW91dFwiLCB7IGV4YWN0OiBmYWxzZSB9KS5sYXN0KCksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiVGhlIHByb3ZpZGVyIGRpc2Nvbm5lY3RlZCBhZnRlciB2aXNpYmxlIHJlc3BvbnNlIHRleHQuXCIsIHtcbiAgICAgICAgZXhhY3Q6IHRydWUsXG4gICAgICB9KSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG5cbiAgICBhd2FpdCBwYWdlLnJlbG9hZCgpO1xuICAgIGF3YWl0IHBhZ2VcbiAgICAgIC5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBmaXh0dXJlLnF1ZXN0aW9uLCBleGFjdDogdHJ1ZSB9KVxuICAgICAgLmNsaWNrKCk7XG5cbiAgICBhd2FpdCBleHBlY3QocGFnZS5nZXRCeVRleHQoZml4dHVyZS5hbnN3ZXIsIHsgZXhhY3Q6IHRydWUgfSkpLnRvSGF2ZUNvdW50KFxuICAgICAgMSxcbiAgICApO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlLmdldEJ5VGV4dChmaXh0dXJlLmFuc3dlciwgeyBleGFjdDogdHJ1ZSB9KSkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QocGFnZS5nZXRCeVRleHQoXCJJTkNPTVBMRVRFOlwiLCB7IGV4YWN0OiBmYWxzZSB9KSkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcInByb3ZpZGVyIGZhaWx1cmVcIiwgeyBleGFjdDogZmFsc2UgfSkubGFzdCgpLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcInN0b3BwZWQ6IHByb3ZpZGVyIHRpbWVvdXRcIiwgeyBleGFjdDogZmFsc2UgfSkubGFzdCgpLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcIlRoZSBwcm92aWRlciBkaXNjb25uZWN0ZWQgYWZ0ZXIgdmlzaWJsZSByZXNwb25zZSB0ZXh0LlwiLCB7XG4gICAgICAgIGV4YWN0OiB0cnVlLFxuICAgICAgfSksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICB9KTtcblxuICB0ZXN0KFwicmVzdW1lcyBhIGZhaWxlZCBhbmFseXNpcyBhbmQga2VlcHMgdGhlIGV4ZWN1dGlvbiBpbmNvbXBsZXRlXCIsIGFzeW5jICh7XG4gICAgcGFnZSxcbiAgfSkgPT4ge1xuICAgIGNvbnN0IHsgZml4dHVyZSwgZXhlY3V0aW9uIH0gPSBpbnN0YWxsUmVzdW1lZEFuYWx5c2lzRmFpbHVyZUZpeHR1cmUoKTtcbiAgICBhd2FpdCBpbnN0YWxsQXBpRml4dHVyZXMocGFnZSwge1xuICAgICAgYXJhYmljQWk6IGZpeHR1cmUsXG4gICAgICByZXN1bWVGYWlsdXJlOiB7IGZpeHR1cmUsIGV4ZWN1dGlvbiB9LFxuICAgIH0pO1xuICAgIGF3YWl0IHByb2dyYW1tYXRpY1NpZ25JbihwYWdlKTtcblxuICAgIGF3YWl0IHBhZ2UuZXZhbHVhdGUoXG4gICAgICAoeyBzZXNzaW9uSWQsIGV4ZWN1dGlvbklkLCBwcm9qZWN0SWQsIHJlc3VtZVRva2VuLCBtZXNzYWdlIH0pID0+IHtcbiAgICAgICAgbG9jYWxTdG9yYWdlLnNldEl0ZW0oXG4gICAgICAgICAgYGVvc19haV9leGVjdXRpb25fY3VycmVudF8ke3Byb2plY3RJZH1gLFxuICAgICAgICAgIHNlc3Npb25JZCxcbiAgICAgICAgKTtcbiAgICAgICAgbG9jYWxTdG9yYWdlLnNldEl0ZW0oXG4gICAgICAgICAgYGVvc19haV9leGVjdXRpb25fJHtwcm9qZWN0SWR9XyR7c2Vzc2lvbklkfWAsXG4gICAgICAgICAgSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgICAgaWQ6IGV4ZWN1dGlvbklkLFxuICAgICAgICAgICAgcHJvamVjdElkLFxuICAgICAgICAgICAgc2Vzc2lvbklkLFxuICAgICAgICAgICAgcmVzdW1lVG9rZW4sXG4gICAgICAgICAgICBtZXNzYWdlLFxuICAgICAgICAgIH0pLFxuICAgICAgICApO1xuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgc2Vzc2lvbklkOiBmaXh0dXJlLnNlc3Npb25JZCxcbiAgICAgICAgZXhlY3V0aW9uSWQ6IGZpeHR1cmUuZXhlY3V0aW9uSWQsXG4gICAgICAgIHByb2plY3RJZDogXCJlMmUtcHJvamVjdFwiLFxuICAgICAgICByZXN1bWVUb2tlbjogXCJlMmUtcmVzdW1lZC1hbmFseXNpcy1mYWlsdXJlLXRva2VuLW9wYXF1ZVwiLFxuICAgICAgICBtZXNzYWdlOiBmaXh0dXJlLnF1ZXN0aW9uLFxuICAgICAgfSxcbiAgICApO1xuICAgIGF3YWl0IHBhZ2UuZ290byhgJHtEQVNIQk9BUkRfUEFUSH1haWApO1xuXG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXCJBIHNhdmVkIEFJIGV4ZWN1dGlvbiBpcyByZWFkeSB0byByZXN1bWVcIiksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGNvbnN0IHJlc3VtZVJlcXVlc3QgPSBwYWdlLndhaXRGb3JSZXF1ZXN0KFxuICAgICAgKHJlcXVlc3QpID0+XG4gICAgICAgIHJlcXVlc3QudXJsKCkuaW5jbHVkZXMoXCIvYXBpL2FpL2NoYXQvc3RyZWFtXCIpICYmXG4gICAgICAgIHJlcXVlc3QubWV0aG9kKCkgPT09IFwiUE9TVFwiLFxuICAgICk7XG4gICAgYXdhaXQgcGFnZS5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIlJlc3VtZVwiLCBleGFjdDogdHJ1ZSB9KS5jbGljaygpO1xuICAgIGNvbnN0IHJlcXVlc3RCb2R5ID0gSlNPTi5wYXJzZShcbiAgICAgIChhd2FpdCByZXN1bWVSZXF1ZXN0KS5wb3N0RGF0YSgpID8/IFwie31cIixcbiAgICApIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAgIGV4cGVjdChyZXF1ZXN0Qm9keSkudG9FcXVhbChcbiAgICAgIGV4cGVjdC5vYmplY3RDb250YWluaW5nKHtcbiAgICAgICAgcHJvamVjdElkOiBcImUyZS1wcm9qZWN0XCIsXG4gICAgICAgIHNlc3Npb25JZDogZml4dHVyZS5zZXNzaW9uSWQsXG4gICAgICAgIGV4ZWN1dGlvbklkOiBmaXh0dXJlLmV4ZWN1dGlvbklkLFxuICAgICAgICByZXN1bWVUb2tlbjogXCJlMmUtcmVzdW1lZC1hbmFseXNpcy1mYWlsdXJlLXRva2VuLW9wYXF1ZVwiLFxuICAgICAgICBtZXNzYWdlOiBmaXh0dXJlLnF1ZXN0aW9uLFxuICAgICAgfSksXG4gICAgKTtcblxuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFwiRmFpbGVkIHRvIHNlbmQgbWVzc2FnZVwiLCB7IGV4YWN0OiB0cnVlIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcIkEgc2F2ZWQgQUkgZXhlY3V0aW9uIGlzIHJlYWR5IHRvIHJlc3VtZVwiKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgY29uc3QgdmlzaWJsZVRleHQgPSBhd2FpdCBwYWdlLmxvY2F0b3IoXCJib2R5XCIpLmlubmVyVGV4dCgpO1xuICAgIGV4cGVjdCh2aXNpYmxlVGV4dCkubm90LnRvQ29udGFpbihcIkNPTVBMRVRFRFwiKTtcbiAgICBleHBlY3QodmlzaWJsZVRleHQpLm5vdC50b0NvbnRhaW4oXCJQZXJzaXN0ZWQgZXhlY3V0aW9uIHByb29mXCIpO1xuICAgIGV4cGVjdCh2aXNpYmxlVGV4dCkudG9Db250YWluKFwiVGhlIHJlcXVpcmVkIGFuYWx5c2lzIGRpZCBub3QgY29tcGxldGUuXCIpO1xuICB9KTtcblxuICB0ZXN0KFwicmVjb3ZlcnMgYSBtaXNzaW5nIHRva2VuIGFmdGVyIGEgcmVhbCBzdHJlYW0gYWJvcnQgYW5kIHJlc3VtZXMgb25lIGV4ZWN1dGlvblwiLCBhc3luYyAoe1xuICAgIHBhZ2UsXG4gIH0pID0+IHtcbiAgICBjb25zdCByZWNvdmVyeSA9IGluc3RhbGxJbnRlcnJ1cHRlZFJlc3VtZUZpeHR1cmUoKTtcbiAgICBhd2FpdCBpbnN0YWxsQXBpRml4dHVyZXMocGFnZSwgeyBpbnRlcnJ1cHRlZFJlc3VtZTogcmVjb3ZlcnkgfSk7XG4gICAgYXdhaXQgcGFnZS5hZGRJbml0U2NyaXB0KCgpID0+IHtcbiAgICAgIGNvbnN0IG5hdGl2ZUZldGNoID0gd2luZG93LmZldGNoLmJpbmQod2luZG93KTtcbiAgICAgIHdpbmRvdy5mZXRjaCA9IGFzeW5jIChpbnB1dCwgaW5pdCkgPT4ge1xuICAgICAgICBjb25zdCB1cmwgPVxuICAgICAgICAgIHR5cGVvZiBpbnB1dCA9PT0gXCJzdHJpbmdcIlxuICAgICAgICAgICAgPyBpbnB1dFxuICAgICAgICAgICAgOiBpbnB1dCBpbnN0YW5jZW9mIFJlcXVlc3RcbiAgICAgICAgICAgICAgPyBpbnB1dC51cmxcbiAgICAgICAgICAgICAgOiBTdHJpbmcoaW5wdXQpO1xuICAgICAgICBjb25zdCBib2R5ID0gdHlwZW9mIGluaXQ/LmJvZHkgPT09IFwic3RyaW5nXCIgPyBpbml0LmJvZHkgOiBcIlwiO1xuICAgICAgICBpZiAoXG4gICAgICAgICAgIXVybC5pbmNsdWRlcyhcIi9hcGkvYWkvY2hhdC9zdHJlYW1cIikgfHxcbiAgICAgICAgICBib2R5LmluY2x1ZGVzKCdcImV4ZWN1dGlvbklkXCInKVxuICAgICAgICApIHtcbiAgICAgICAgICByZXR1cm4gbmF0aXZlRmV0Y2goaW5wdXQsIGluaXQpO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBuYXRpdmVGZXRjaChpbnB1dCwgaW5pdCk7XG4gICAgICAgIGlmICghcmVzcG9uc2UuYm9keSkgcmV0dXJuIHJlc3BvbnNlO1xuICAgICAgICBjb25zdCByZWFkZXIgPSByZXNwb25zZS5ib2R5LmdldFJlYWRlcigpO1xuICAgICAgICBjb25zdCBlbmNvZGVyID0gbmV3IFRleHRFbmNvZGVyKCk7XG4gICAgICAgIGNvbnN0IHN0cmVhbSA9IG5ldyBSZWFkYWJsZVN0cmVhbSh7XG4gICAgICAgICAgYXN5bmMgc3RhcnQoY29udHJvbGxlcikge1xuICAgICAgICAgICAgbGV0IGJ1ZmZlcmVkID0gXCJcIjtcbiAgICAgICAgICAgIHdoaWxlICh0cnVlKSB7XG4gICAgICAgICAgICAgIGNvbnN0IHsgZG9uZSwgdmFsdWUgfSA9IGF3YWl0IHJlYWRlci5yZWFkKCk7XG4gICAgICAgICAgICAgIGlmIChkb25lKSB7XG4gICAgICAgICAgICAgICAgaWYgKGJ1ZmZlcmVkKSBjb250cm9sbGVyLmVucXVldWUoZW5jb2Rlci5lbmNvZGUoYnVmZmVyZWQpKTtcbiAgICAgICAgICAgICAgICBjb250cm9sbGVyLmNsb3NlKCk7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIGJ1ZmZlcmVkICs9IG5ldyBUZXh0RGVjb2RlcigpLmRlY29kZSh2YWx1ZSwgeyBzdHJlYW06IHRydWUgfSk7XG4gICAgICAgICAgICAgIGNvbnN0IG1hcmtlciA9IGJ1ZmZlcmVkLmluZGV4T2YoJ1widHlwZVwiOlwiZXhlY3V0aW9uX3N0YXJ0ZWRcIicpO1xuICAgICAgICAgICAgICBjb25zdCBmcmFtZUVuZCA9XG4gICAgICAgICAgICAgICAgbWFya2VyIDwgMCA/IC0xIDogYnVmZmVyZWQuaW5kZXhPZihcIlxcblxcblwiLCBtYXJrZXIpO1xuICAgICAgICAgICAgICBpZiAoZnJhbWVFbmQgPj0gMCkge1xuICAgICAgICAgICAgICAgIGNvbnRyb2xsZXIuZW5xdWV1ZShcbiAgICAgICAgICAgICAgICAgIGVuY29kZXIuZW5jb2RlKGJ1ZmZlcmVkLnNsaWNlKDAsIGZyYW1lRW5kICsgMikpLFxuICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgICAgY29udHJvbGxlci5lcnJvcihuZXcgVHlwZUVycm9yKFwibmV0d29yayBjb25uZWN0aW9uIHJlc2V0XCIpKTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9LFxuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuIG5ldyBSZXNwb25zZShzdHJlYW0sIHtcbiAgICAgICAgICBzdGF0dXM6IHJlc3BvbnNlLnN0YXR1cyxcbiAgICAgICAgICBzdGF0dXNUZXh0OiByZXNwb25zZS5zdGF0dXNUZXh0LFxuICAgICAgICAgIGhlYWRlcnM6IHJlc3BvbnNlLmhlYWRlcnMsXG4gICAgICAgIH0pO1xuICAgICAgfTtcbiAgICB9KTtcbiAgICBhd2FpdCBwcm9ncmFtbWF0aWNTaWduSW4ocGFnZSk7XG4gICAgYXdhaXQgcGFnZS5nb3RvKGAke0RBU0hCT0FSRF9QQVRIfWFpYCk7XG5cbiAgICBjb25zdCBzdHJlYW1SZXF1ZXN0czogQXJyYXk8UmVjb3JkPHN0cmluZywgdW5rbm93bj4+ID0gW107XG4gICAgcGFnZS5vbihcInJlcXVlc3RcIiwgKHJlcXVlc3QpID0+IHtcbiAgICAgIGlmIChcbiAgICAgICAgcmVxdWVzdC51cmwoKS5pbmNsdWRlcyhcIi9hcGkvYWkvY2hhdC9zdHJlYW1cIikgJiZcbiAgICAgICAgcmVxdWVzdC5tZXRob2QoKSA9PT0gXCJQT1NUXCJcbiAgICAgICkge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIHN0cmVhbVJlcXVlc3RzLnB1c2goXG4gICAgICAgICAgICByZXF1ZXN0LnBvc3REYXRhSlNPTigpIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+LFxuICAgICAgICAgICk7XG4gICAgICAgIH0gY2F0Y2gge1xuICAgICAgICAgIC8vIElnbm9yZSByZXF1ZXN0cyB3aXRob3V0IGEgSlNPTiBib2R5OyB0aGUgYXNzZXJ0aW9ucyBiZWxvdyByZXF1aXJlXG4gICAgICAgICAgLy8gYm90aCBqb3VybmV5IHJlcXVlc3RzIHRvIGhhdmUgYSB2YWxpZCByZXF1ZXN0IGVudmVsb3BlLlxuICAgICAgICB9XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICBjb25zdCBjb21wb3NlciA9IHBhZ2UubG9jYXRvcihcInRleHRhcmVhXCIpLmZpcnN0KCk7XG4gICAgYXdhaXQgY29tcG9zZXIuZmlsbChyZWNvdmVyeS5maXh0dXJlLnF1ZXN0aW9uKTtcbiAgICBhd2FpdCBjb21wb3Nlci5sb2NhdG9yKFwieHBhdGg9Li5cIikuZ2V0QnlSb2xlKFwiYnV0dG9uXCIpLmNsaWNrKCk7XG5cbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcbiAgICAgICAgXCJFeGVjdXRpb24gcGF1c2VkIOKAlCByZWFkeSB0byByZXN1bWUgZnJvbSBpdHMgZHVyYWJsZSBjaGVja3BvaW50XCIsXG4gICAgICAgIHtcbiAgICAgICAgICBleGFjdDogdHJ1ZSxcbiAgICAgICAgfSxcbiAgICAgICksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuXG4gICAgY29uc3Qgc3RvcmFnZUtleSA9XG4gICAgICBcImVvc19haV9leGVjdXRpb25fZTJlLXByb2plY3RfZTJlLWludGVycnVwdGVkLXJlc3VtZS1zZXNzaW9uXCI7XG4gICAgY29uc3QgcG9pbnRlcktleSA9IFwiZW9zX2FpX2V4ZWN1dGlvbl9jdXJyZW50X2UyZS1wcm9qZWN0XCI7XG4gICAgYXdhaXQgZXhwZWN0XG4gICAgICAucG9sbCgoKSA9PiBwYWdlLmV2YWx1YXRlKChrZXkpID0+IGxvY2FsU3RvcmFnZS5nZXRJdGVtKGtleSksIHN0b3JhZ2VLZXkpKVxuICAgICAgLnRvQ29udGFpbihyZWNvdmVyeS5pbml0aWFsVG9rZW4pO1xuXG4gICAgYXdhaXQgcGFnZS5ldmFsdWF0ZShcbiAgICAgICh7IHN0b3JhZ2VLZXksIHBvaW50ZXJLZXkgfSkgPT4ge1xuICAgICAgICBjb25zdCBzYXZlZCA9IEpTT04ucGFyc2UobG9jYWxTdG9yYWdlLmdldEl0ZW0oc3RvcmFnZUtleSkgPz8gXCJ7fVwiKTtcbiAgICAgICAgZGVsZXRlIHNhdmVkLnJlc3VtZVRva2VuO1xuICAgICAgICBsb2NhbFN0b3JhZ2Uuc2V0SXRlbShzdG9yYWdlS2V5LCBKU09OLnN0cmluZ2lmeShzYXZlZCkpO1xuICAgICAgICBsb2NhbFN0b3JhZ2Uuc2V0SXRlbShwb2ludGVyS2V5LCBcImUyZS1pbnRlcnJ1cHRlZC1yZXN1bWUtc2Vzc2lvblwiKTtcbiAgICAgIH0sXG4gICAgICB7IHN0b3JhZ2VLZXksIHBvaW50ZXJLZXkgfSxcbiAgICApO1xuICAgIGF3YWl0IHBhZ2UucmVsb2FkKCk7XG5cbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5VGV4dChcIkEgc2F2ZWQgQUkgZXhlY3V0aW9uIGlzIHJlYWR5IHRvIHJlc3VtZVwiLCB7XG4gICAgICAgIGV4YWN0OiB0cnVlLFxuICAgICAgfSksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdFxuICAgICAgLnBvbGwoKCkgPT5cbiAgICAgICAgcGFnZS5ldmFsdWF0ZSgoa2V5KSA9PiB7XG4gICAgICAgICAgY29uc3Qgc2F2ZWQgPSBKU09OLnBhcnNlKGxvY2FsU3RvcmFnZS5nZXRJdGVtKGtleSkgPz8gXCJ7fVwiKTtcbiAgICAgICAgICByZXR1cm4gc2F2ZWQucmVzdW1lVG9rZW47XG4gICAgICAgIH0sIHN0b3JhZ2VLZXkpLFxuICAgICAgKVxuICAgICAgLnRvQmUocmVjb3ZlcnkucmVjb3ZlcmVkVG9rZW4pO1xuXG4gICAgYXdhaXQgcGFnZS5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIlJlc3VtZVwiLCBleGFjdDogdHJ1ZSB9KS5jbGljaygpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KHJlY292ZXJ5LmZpeHR1cmUuYW5zd2VyLCB7IGV4YWN0OiB0cnVlIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QucG9sbCgoKSA9PiBzdHJlYW1SZXF1ZXN0cy5sZW5ndGgpLnRvQmUoMik7XG4gICAgZXhwZWN0KHN0cmVhbVJlcXVlc3RzWzBdKS50b0VxdWFsKFxuICAgICAgZXhwZWN0Lm9iamVjdENvbnRhaW5pbmcoe1xuICAgICAgICBwcm9qZWN0SWQ6IFwiZTJlLXByb2plY3RcIixcbiAgICAgICAgbWVzc2FnZTogcmVjb3ZlcnkuZml4dHVyZS5xdWVzdGlvbixcbiAgICAgIH0pLFxuICAgICk7XG4gICAgZXhwZWN0KHN0cmVhbVJlcXVlc3RzWzBdPy5leGVjdXRpb25JZCkudG9CZVVuZGVmaW5lZCgpO1xuICAgIGV4cGVjdChzdHJlYW1SZXF1ZXN0c1swXT8uc2Vzc2lvbklkKS50b0JlVW5kZWZpbmVkKCk7XG4gICAgZXhwZWN0KHN0cmVhbVJlcXVlc3RzWzFdKS50b0VxdWFsKFxuICAgICAgZXhwZWN0Lm9iamVjdENvbnRhaW5pbmcoe1xuICAgICAgICBwcm9qZWN0SWQ6IFwiZTJlLXByb2plY3RcIixcbiAgICAgICAgc2Vzc2lvbklkOiByZWNvdmVyeS5maXh0dXJlLnNlc3Npb25JZCxcbiAgICAgICAgZXhlY3V0aW9uSWQ6IHJlY292ZXJ5LmZpeHR1cmUuZXhlY3V0aW9uSWQsXG4gICAgICAgIHJlc3VtZVRva2VuOiByZWNvdmVyeS5yZWNvdmVyZWRUb2tlbixcbiAgICAgICAgbWVzc2FnZTogcmVjb3ZlcnkuZml4dHVyZS5xdWVzdGlvbixcbiAgICAgIH0pLFxuICAgICk7XG4gICAgZXhwZWN0KFxuICAgICAgc3RyZWFtUmVxdWVzdHMubWFwKChyZXF1ZXN0KSA9PiByZXF1ZXN0LmV4ZWN1dGlvbklkKS5maWx0ZXIoQm9vbGVhbiksXG4gICAgKS50b0VxdWFsKFtyZWNvdmVyeS5maXh0dXJlLmV4ZWN1dGlvbklkXSk7XG4gIH0pO1xuXG4gIHRlc3QoXCJwcm9qZWN0cyBkZWxpdmVyeSByZWNvdmVyeSBzdGF0ZXMgc2FmZWx5IGFmdGVyIHJlbG9hZFwiLCBhc3luYyAoe1xuICAgIHBhZ2UsXG4gIH0pID0+IHtcbiAgICBjb25zdCByZWNvdmVyeSA9IHtcbiAgICAgIHJlcXVlc3RzOiBbXSBhcyBzdHJpbmdbXSxcbiAgICAgIG9wZXJhdGlvbnM6IFtcbiAgICAgICAge1xuICAgICAgICAgIHByb3Bvc2FsSWQ6IFwiZTJlLXJlY292ZXJ5LWF2YWlsYWJsZS1wcm9wb3NhbFwiLFxuICAgICAgICAgIG9wZXJhdGlvbklkOiBcImUyZS1yZWNvdmVyeS1hdmFpbGFibGUtb3BlcmF0aW9uXCIsXG4gICAgICAgICAgc2Vzc2lvbklkOiBcImUyZS1yZWNvdmVyeS1hdmFpbGFibGUtc2Vzc2lvblwiLFxuICAgICAgICAgIGxpZmVjeWNsZTogXCJibG9ja2VkXCIsXG4gICAgICAgICAgc3RhdHVzOiBcInBlbmRpbmdcIixcbiAgICAgICAgICBjcmVhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMzowMC4wMDBaXCIsXG4gICAgICAgICAgcmVjb3ZlcnlTdGF0ZTogXCJyZWNvdmVyYWJsZVwiLFxuICAgICAgICAgIG9wZXJhdG9yRXhwbGFuYXRpb246XG4gICAgICAgICAgICBcIlRoZSBkZWxpdmVyeSBzdG9wcGVkIGJlY2F1c2UgdmFsaWRhdGlvbiBuZWVkcyB0byBiZSBydW4gYWdhaW4uXCIsXG4gICAgICAgICAgbmV4dEFjdGlvbjpcbiAgICAgICAgICAgIFwiUmVzdW1lIHZhbGlkYXRpb24gdG8gcmUtY2hlY2sgdGhlIHNhdmVkIGNoYW5nZXMsIG9yIGRpc2NhcmQgdGhpcyByZWNvdmVyeSBpZiBpdCBpcyBubyBsb25nZXIgbmVlZGVkLlwiLFxuICAgICAgICAgIGNvbmZsaWN0UmVhc29uOiBudWxsLFxuICAgICAgICAgIHZhbGlkYXRpb25FdmlkZW5jZTogW3sgcHJvZmlsZTogXCJ3b3Jrc3BhY2UtdHlwZWNoZWNrXCIsIHN0YXR1czogXCJmYWlsZWRcIiB9XSxcbiAgICAgICAgICB3b3Jrc3BhY2VBdmFpbGFibGU6IHRydWUsXG4gICAgICAgICAgY2hhbmdlQ291bnQ6IDIsXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBwcm9wb3NhbElkOiBcImUyZS1yZWNvdmVyeS1taXNzaW5nLXByb3Bvc2FsXCIsXG4gICAgICAgICAgb3BlcmF0aW9uSWQ6IFwiZTJlLXJlY292ZXJ5LW1pc3Npbmctb3BlcmF0aW9uXCIsXG4gICAgICAgICAgc2Vzc2lvbklkOiBcImUyZS1yZWNvdmVyeS1taXNzaW5nLXNlc3Npb25cIixcbiAgICAgICAgICBsaWZlY3ljbGU6IFwiYWJhbmRvbmVkXCIsXG4gICAgICAgICAgc3RhdHVzOiBcInBlbmRpbmdcIixcbiAgICAgICAgICBjcmVhdGVkQXQ6IFwiMjAyNi0wMS0wMVQwMDowMjowMC4wMDBaXCIsXG4gICAgICAgICAgcmVjb3ZlcnlTdGF0ZTogXCJtaXNzaW5nX3dvcmtzcGFjZVwiLFxuICAgICAgICAgIG9wZXJhdG9yRXhwbGFuYXRpb246XG4gICAgICAgICAgICBcIlRoZSBzYXZlZCBkZWxpdmVyeSB3b3Jrc3BhY2UgaXMgbm8gbG9uZ2VyIGF2YWlsYWJsZSwgc28gcmVjb3ZlcnkgY2Fubm90IGNvbnRpbnVlLlwiLFxuICAgICAgICAgIG5leHRBY3Rpb246XG4gICAgICAgICAgICBcIlN0YXJ0IGEgbmV3IGRlbGl2ZXJ5IGZyb20gdGhlIGN1cnJlbnQgcHJvamVjdCByYXRoZXIgdGhhbiByZXRyeWluZyB0aGlzIHJlY292ZXJ5LlwiLFxuICAgICAgICAgIGNvbmZsaWN0UmVhc29uOiBcIldvcmtzcGFjZSBleHBpcmVkIGFmdGVyIHRoZSBydW5uZXIgd2FzIHJlY3ljbGVkLlwiLFxuICAgICAgICAgIHZhbGlkYXRpb25FdmlkZW5jZTogbnVsbCxcbiAgICAgICAgICB3b3Jrc3BhY2VBdmFpbGFibGU6IGZhbHNlLFxuICAgICAgICAgIGNoYW5nZUNvdW50OiAxLFxuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgcHJvcG9zYWxJZDogXCJlMmUtcmVjb3ZlcnktZGlzY2FyZGVkLXByb3Bvc2FsXCIsXG4gICAgICAgICAgb3BlcmF0aW9uSWQ6IFwiZTJlLXJlY292ZXJ5LWRpc2NhcmRlZC1vcGVyYXRpb25cIixcbiAgICAgICAgICBzZXNzaW9uSWQ6IFwiZTJlLXJlY292ZXJ5LWRpc2NhcmRlZC1zZXNzaW9uXCIsXG4gICAgICAgICAgbGlmZWN5Y2xlOiBcImNhbmNlbGxlZFwiLFxuICAgICAgICAgIHN0YXR1czogXCJyZWplY3RlZFwiLFxuICAgICAgICAgIGNyZWF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjAxOjAwLjAwMFpcIixcbiAgICAgICAgICByZWNvdmVyeVN0YXRlOiBcImRpc2NhcmRlZFwiLFxuICAgICAgICAgIG9wZXJhdG9yRXhwbGFuYXRpb246IFwiVGhpcyBkZWxpdmVyeSByZWNvdmVyeSB3YXMgYWxyZWFkeSBkaXNjYXJkZWQuXCIsXG4gICAgICAgICAgbmV4dEFjdGlvbjogXCJObyBhY3Rpb24gaXMgcmVxdWlyZWQuXCIsXG4gICAgICAgICAgY29uZmxpY3RSZWFzb246IFwiSW50ZXJuYWwgZGlhZ25vc3RpYzogc2hvdWxkIG5ldmVyIGJlIHJlbmRlcmVkXCIsXG4gICAgICAgICAgdmFsaWRhdGlvbkV2aWRlbmNlOiBudWxsLFxuICAgICAgICAgIHdvcmtzcGFjZUF2YWlsYWJsZTogZmFsc2UsXG4gICAgICAgICAgY2hhbmdlQ291bnQ6IDMsXG4gICAgICAgIH0sXG4gICAgICBdLFxuICAgIH07XG4gICAgYXdhaXQgaW5zdGFsbEFwaUZpeHR1cmVzKHBhZ2UsIHsgZGVsaXZlcnlSZWNvdmVyeTogcmVjb3ZlcnkgfSk7XG4gICAgYXdhaXQgcHJvZ3JhbW1hdGljU2lnbkluKHBhZ2UpO1xuICAgIGF3YWl0IHBhZ2UuZ290byhgJHtEQVNIQk9BUkRfUEFUSH1haWApO1xuXG4gICAgY29uc3QgcmVnaW9uID0gcGFnZS5nZXRCeVJvbGUoXCJyZWdpb25cIiwge1xuICAgICAgbmFtZTogXCJSZWNvdmVyYWJsZSBkZWxpdmVyeSBvcGVyYXRpb25zXCIsXG4gICAgfSk7XG4gICAgYXdhaXQgZXhwZWN0KHJlZ2lvbikudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QocmVnaW9uLmdldEJ5VGV4dChcIlJlY292ZXJhYmxlXCIsIHsgZXhhY3Q6IHRydWUgfSkpLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcmVnaW9uLmdldEJ5VGV4dChcIldvcmtzcGFjZSB1bmF2YWlsYWJsZVwiLCB7IGV4YWN0OiB0cnVlIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICByZWdpb24uZ2V0QnlUZXh0KFwiQWxyZWFkeSBkaXNjYXJkZWRcIiwgeyBleGFjdDogdHJ1ZSB9KSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcmVnaW9uLmdldEJ5VGV4dChcbiAgICAgICAgXCJUaGUgc2F2ZWQgZGVsaXZlcnkgd29ya3NwYWNlIGlzIG5vIGxvbmdlciBhdmFpbGFibGUsIHNvIHJlY292ZXJ5IGNhbm5vdCBjb250aW51ZS5cIixcbiAgICAgICAgeyBleGFjdDogdHJ1ZSB9LFxuICAgICAgKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcmVnaW9uLmdldEJ5VGV4dChcIlRoaXMgZGVsaXZlcnkgcmVjb3Zlcnkgd2FzIGFscmVhZHkgZGlzY2FyZGVkLlwiLCB7XG4gICAgICAgIGV4YWN0OiB0cnVlLFxuICAgICAgfSksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHJlZ2lvbi5nZXRCeVRleHQoXG4gICAgICAgIFwiUmV0YWluZWQgcmVhc29uOiBXb3Jrc3BhY2UgZXhwaXJlZCBhZnRlciB0aGUgcnVubmVyIHdhcyByZWN5Y2xlZC5cIixcbiAgICAgICAgeyBleGFjdDogdHJ1ZSB9LFxuICAgICAgKSxcbiAgICApLnRvQmVWaXNpYmxlKCk7XG5cbiAgICBjb25zdCBhdmFpbGFibGUgPSByZWdpb24ubG9jYXRvcihcbiAgICAgICdbZGF0YS1vcGVyYXRpb24taWQ9XCJlMmUtcmVjb3ZlcnktYXZhaWxhYmxlLW9wZXJhdGlvblwiXScsXG4gICAgKTtcbiAgICBjb25zdCBtaXNzaW5nID0gcmVnaW9uLmxvY2F0b3IoXG4gICAgICAnW2RhdGEtb3BlcmF0aW9uLWlkPVwiZTJlLXJlY292ZXJ5LW1pc3Npbmctb3BlcmF0aW9uXCJdJyxcbiAgICApO1xuICAgIGNvbnN0IGRpc2NhcmRlZCA9IHJlZ2lvbi5sb2NhdG9yKFxuICAgICAgJ1tkYXRhLW9wZXJhdGlvbi1pZD1cImUyZS1yZWNvdmVyeS1kaXNjYXJkZWQtb3BlcmF0aW9uXCJdJyxcbiAgICApO1xuICAgIGF3YWl0IGV4cGVjdChhdmFpbGFibGUpLnRvSGF2ZUF0dHJpYnV0ZShcbiAgICAgIFwiZGF0YS1yZWNvdmVyeS1zdGF0ZVwiLFxuICAgICAgXCJyZWNvdmVyYWJsZVwiLFxuICAgICk7XG4gICAgYXdhaXQgZXhwZWN0KG1pc3NpbmcpLnRvSGF2ZUF0dHJpYnV0ZShcbiAgICAgIFwiZGF0YS1yZWNvdmVyeS1zdGF0ZVwiLFxuICAgICAgXCJtaXNzaW5nX3dvcmtzcGFjZVwiLFxuICAgICk7XG4gICAgYXdhaXQgZXhwZWN0KGRpc2NhcmRlZCkudG9IYXZlQXR0cmlidXRlKFxuICAgICAgXCJkYXRhLXJlY292ZXJ5LXN0YXRlXCIsXG4gICAgICBcImRpc2NhcmRlZFwiLFxuICAgICk7XG4gICAgYXdhaXQgZXhwZWN0KGF2YWlsYWJsZS5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIlJlc3VtZSB2YWxpZGF0aW9uXCIgfSkpLnRvQmVFbmFibGVkKCk7XG4gICAgYXdhaXQgZXhwZWN0KGF2YWlsYWJsZS5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIkRpc2NhcmQgd29ya3NwYWNlXCIgfSkpLnRvQmVFbmFibGVkKCk7XG4gICAgYXdhaXQgZXhwZWN0KG1pc3NpbmcuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJSZXN1bWUgdmFsaWRhdGlvblwiIH0pKS50b0JlRGlzYWJsZWQoKTtcbiAgICBhd2FpdCBleHBlY3QobWlzc2luZy5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIkRpc2NhcmQgd29ya3NwYWNlXCIgfSkpLnRvQmVEaXNhYmxlZCgpO1xuICAgIGF3YWl0IGV4cGVjdChkaXNjYXJkZWQuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJSZXN1bWUgdmFsaWRhdGlvblwiIH0pKS50b0JlRGlzYWJsZWQoKTtcbiAgICBhd2FpdCBleHBlY3QoZGlzY2FyZGVkLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiRGlzY2FyZCB3b3Jrc3BhY2VcIiB9KSkudG9CZURpc2FibGVkKCk7XG5cbiAgICBjb25zdCB2aXNpYmxlVGV4dCA9IGF3YWl0IHBhZ2UubG9jYXRvcihcImJvZHlcIikuaW5uZXJUZXh0KCk7XG4gICAgZXhwZWN0KHZpc2libGVUZXh0KS5ub3QudG9NYXRjaChcbiAgICAgIC9cXC9ob21lXFwvcnVubmVyfFxcL3RtcFxcL3xcXC93b3Jrc3BhY2VcXC98aW50ZXJuYWwgZGlhZ25vc3RpYy9pLFxuICAgICk7XG4gICAgYXdhaXQgZXhwZWN0Tm9Ib3Jpem9udGFsT3ZlcmZsb3cocGFnZSk7XG5cbiAgICBhd2FpdCBwYWdlLnJlbG9hZCgpO1xuICAgIGNvbnN0IHJlbG9hZGVkUmVnaW9uID0gcGFnZS5nZXRCeVJvbGUoXCJyZWdpb25cIiwge1xuICAgICAgbmFtZTogXCJSZWNvdmVyYWJsZSBkZWxpdmVyeSBvcGVyYXRpb25zXCIsXG4gICAgfSk7XG4gICAgYXdhaXQgZXhwZWN0KHJlbG9hZGVkUmVnaW9uKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHJlbG9hZGVkUmVnaW9uXG4gICAgICAgIC5sb2NhdG9yKCdbZGF0YS1vcGVyYXRpb24taWQ9XCJlMmUtcmVjb3ZlcnktbWlzc2luZy1vcGVyYXRpb25cIl0nKVxuICAgICAgICAuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJSZXN1bWUgdmFsaWRhdGlvblwiIH0pLFxuICAgICkudG9CZURpc2FibGVkKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcmVsb2FkZWRSZWdpb25cbiAgICAgICAgLmxvY2F0b3IoJ1tkYXRhLW9wZXJhdGlvbi1pZD1cImUyZS1yZWNvdmVyeS1kaXNjYXJkZWQtb3BlcmF0aW9uXCJdJylcbiAgICAgICAgLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiRGlzY2FyZCB3b3Jrc3BhY2VcIiB9KSxcbiAgICApLnRvQmVEaXNhYmxlZCgpO1xuICAgIGV4cGVjdChyZWNvdmVyeS5yZXF1ZXN0cy5sZW5ndGgpLnRvQmVHcmVhdGVyVGhhbk9yRXF1YWwoMik7XG4gICAgZXhwZWN0KHJlY292ZXJ5LnJlcXVlc3RzLmV2ZXJ5KCh1cmwpID0+IHVybC5pbmNsdWRlcyhcInByb2plY3RJZD1lMmUtcHJvamVjdFwiKSkpLnRvQmUodHJ1ZSk7XG4gIH0pO1xuXG4gIHRlc3QoXCJleHBsYWlucyB3aGVuIGRlbGl2ZXJ5IHJlY292ZXJ5IGxvc2VzIGEgcmFjZSBhbmQgcmVmcmVzaGVzIHN0YXRlXCIsIGFzeW5jICh7XG4gICAgcGFnZSxcbiAgfSkgPT4ge1xuICAgIGNvbnN0IHJlY292ZXJ5ID0ge1xuICAgICAgcmVxdWVzdHM6IFtdIGFzIHN0cmluZ1tdLFxuICAgICAgYWN0aW9uUmVxdWVzdHM6IFtdIGFzIHN0cmluZ1tdLFxuICAgICAgb3BlcmF0aW9uczogW1xuICAgICAgICB7XG4gICAgICAgICAgcHJvcG9zYWxJZDogXCJlMmUtcmVjb3ZlcnktcmFjZS1wcm9wb3NhbFwiLFxuICAgICAgICAgIG9wZXJhdGlvbklkOiBcImUyZS1yZWNvdmVyeS1yYWNlLW9wZXJhdGlvblwiLFxuICAgICAgICAgIHNlc3Npb25JZDogXCJlMmUtcmVjb3ZlcnktcmFjZS1zZXNzaW9uXCIsXG4gICAgICAgICAgbGlmZWN5Y2xlOiBcImJsb2NrZWRcIixcbiAgICAgICAgICBzdGF0dXM6IFwicGVuZGluZ1wiLFxuICAgICAgICAgIGNyZWF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjA0OjAwLjAwMFpcIixcbiAgICAgICAgICByZWNvdmVyeVN0YXRlOiBcInJlY292ZXJhYmxlXCIsXG4gICAgICAgICAgb3BlcmF0b3JFeHBsYW5hdGlvbjpcbiAgICAgICAgICAgIFwiVGhlIGRlbGl2ZXJ5IHN0b3BwZWQgYmVjYXVzZSB0aGUgcmV0YWluZWQgY2hhbmdlcyBuZWVkIHJldmlldyBiZWZvcmUgdmFsaWRhdGlvbiBjYW4gY29udGludWUuXCIsXG4gICAgICAgICAgbmV4dEFjdGlvbjpcbiAgICAgICAgICAgIFwiUmVzdW1lIHZhbGlkYXRpb24gdG8gcmUtY2hlY2sgdGhlIHNhdmVkIGNoYW5nZXMsIG9yIGRpc2NhcmQgdGhpcyByZWNvdmVyeSBpZiBpdCBpcyBubyBsb25nZXIgbmVlZGVkLlwiLFxuICAgICAgICAgIGNvbmZsaWN0UmVhc29uOiBudWxsLFxuICAgICAgICAgIHZhbGlkYXRpb25FdmlkZW5jZTogW3sgcHJvZmlsZTogXCJ3b3Jrc3BhY2UtdHlwZWNoZWNrXCIsIHN0YXR1czogXCJmYWlsZWRcIiB9XSxcbiAgICAgICAgICB3b3Jrc3BhY2VBdmFpbGFibGU6IHRydWUsXG4gICAgICAgICAgY2hhbmdlQ291bnQ6IDEsXG4gICAgICAgIH0sXG4gICAgICBdLFxuICAgICAgcmVjb3ZlcnlBY3Rpb246IHtcbiAgICAgICAgcHJvcG9zYWxJZDogXCJlMmUtcmVjb3ZlcnktcmFjZS1wcm9wb3NhbFwiLFxuICAgICAgICBhY3Rpb246IFwicmVzdW1lLXZhbGlkYXRpb25cIiBhcyBjb25zdCxcbiAgICAgICAgcmVzcG9uc2U6IHtcbiAgICAgICAgICBlcnJvcjogXCJUaGlzIGRlbGl2ZXJ5IHJlY292ZXJ5IHdhcyBhbHJlYWR5IGRpc2NhcmRlZC5cIixcbiAgICAgICAgICBjb2RlOiBcIkRFTElWRVJZX0FMUkVBRFlfRElTQ0FSREVEXCIsXG4gICAgICAgICAgbGlmZWN5Y2xlOiBcImNhbmNlbGxlZFwiLFxuICAgICAgICAgIHJlY292ZXJ5U3RhdGU6IFwiZGlzY2FyZGVkXCIsXG4gICAgICAgICAgbmV4dEFjdGlvbjogXCJObyBhY3Rpb24gaXMgcmVxdWlyZWQuXCIsXG4gICAgICAgICAgZGlhZ25vc3RpYzogXCJEbyBub3QgcmVuZGVyIHRoaXMgc2VydmVyIGRldGFpbC5cIixcbiAgICAgICAgfSxcbiAgICAgICAgbmV4dE9wZXJhdGlvbnM6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBwcm9wb3NhbElkOiBcImUyZS1yZWNvdmVyeS1yYWNlLXByb3Bvc2FsXCIsXG4gICAgICAgICAgICBvcGVyYXRpb25JZDogXCJlMmUtcmVjb3ZlcnktcmFjZS1vcGVyYXRpb25cIixcbiAgICAgICAgICAgIHNlc3Npb25JZDogXCJlMmUtcmVjb3ZlcnktcmFjZS1zZXNzaW9uXCIsXG4gICAgICAgICAgICBsaWZlY3ljbGU6IFwiY2FuY2VsbGVkXCIsXG4gICAgICAgICAgICBzdGF0dXM6IFwicmVqZWN0ZWRcIixcbiAgICAgICAgICAgIGNyZWF0ZWRBdDogXCIyMDI2LTAxLTAxVDAwOjA0OjAwLjAwMFpcIixcbiAgICAgICAgICAgIHJlY292ZXJ5U3RhdGU6IFwiZGlzY2FyZGVkXCIsXG4gICAgICAgICAgICBvcGVyYXRvckV4cGxhbmF0aW9uOiBcIlRoaXMgZGVsaXZlcnkgcmVjb3Zlcnkgd2FzIGFscmVhZHkgZGlzY2FyZGVkLlwiLFxuICAgICAgICAgICAgbmV4dEFjdGlvbjogXCJObyBhY3Rpb24gaXMgcmVxdWlyZWQuXCIsXG4gICAgICAgICAgICBjb25mbGljdFJlYXNvbjogbnVsbCxcbiAgICAgICAgICAgIHZhbGlkYXRpb25FdmlkZW5jZTogbnVsbCxcbiAgICAgICAgICAgIHdvcmtzcGFjZUF2YWlsYWJsZTogZmFsc2UsXG4gICAgICAgICAgICBjaGFuZ2VDb3VudDogMSxcbiAgICAgICAgICB9LFxuICAgICAgICBdLFxuICAgICAgfSxcbiAgICB9O1xuICAgIGF3YWl0IGluc3RhbGxBcGlGaXh0dXJlcyhwYWdlLCB7IGRlbGl2ZXJ5UmVjb3Zlcnk6IHJlY292ZXJ5IH0pO1xuICAgIGF3YWl0IHByb2dyYW1tYXRpY1NpZ25JbihwYWdlKTtcbiAgICBhd2FpdCBwYWdlLmdvdG8oYCR7REFTSEJPQVJEX1BBVEh9YWlgKTtcblxuICAgIGNvbnN0IHJlZ2lvbiA9IHBhZ2UuZ2V0QnlSb2xlKFwicmVnaW9uXCIsIHtcbiAgICAgIG5hbWU6IFwiUmVjb3ZlcmFibGUgZGVsaXZlcnkgb3BlcmF0aW9uc1wiLFxuICAgIH0pO1xuICAgIGNvbnN0IG9wZXJhdGlvbiA9IHJlZ2lvbi5sb2NhdG9yKFxuICAgICAgJ1tkYXRhLW9wZXJhdGlvbi1pZD1cImUyZS1yZWNvdmVyeS1yYWNlLW9wZXJhdGlvblwiXScsXG4gICAgKTtcbiAgICBhd2FpdCBleHBlY3Qob3BlcmF0aW9uLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiUmVzdW1lIHZhbGlkYXRpb25cIiB9KSkudG9CZUVuYWJsZWQoKTtcbiAgICBhd2FpdCBvcGVyYXRpb24uZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJSZXN1bWUgdmFsaWRhdGlvblwiIH0pLmNsaWNrKCk7XG5cbiAgICBhd2FpdCBleHBlY3QocGFnZS5nZXRCeVRleHQoXCJSZWNvdmVyeSBzdGF0ZSBjaGFuZ2VkXCIsIHsgZXhhY3Q6IHRydWUgfSkpLnRvQmVWaXNpYmxlKCk7XG4gICAgYXdhaXQgZXhwZWN0KFxuICAgICAgcGFnZS5nZXRCeVRleHQoXG4gICAgICAgIFwiVGhpcyByZWNvdmVyeSB3YXMgYWxyZWFkeSBkaXNjYXJkZWQuIFRoZSByZWNvdmVyeSBsaXN0IHdhcyByZWZyZXNoZWQuXCIsXG4gICAgICAgIHsgZXhhY3Q6IHRydWUgfSxcbiAgICAgICksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdFxuICAgICAgLnBvbGwoKCkgPT4gcmVjb3ZlcnkucmVxdWVzdHMubGVuZ3RoKVxuICAgICAgLnRvQmVHcmVhdGVyVGhhbk9yRXF1YWwoMik7XG4gICAgYXdhaXQgZXhwZWN0KG9wZXJhdGlvbikudG9IYXZlQXR0cmlidXRlKFwiZGF0YS1yZWNvdmVyeS1zdGF0ZVwiLCBcImRpc2NhcmRlZFwiKTtcbiAgICBleHBlY3QocmVjb3ZlcnkuYWN0aW9uUmVxdWVzdHMpLnRvSGF2ZUxlbmd0aCgxKTtcbiAgICBleHBlY3QocmVjb3ZlcnkuYWN0aW9uUmVxdWVzdHNbMF0pLnRvQ29udGFpbihcbiAgICAgIFwiL2FwaS9haS9kZWxpdmVyeS9lMmUtcmVjb3ZlcnktcmFjZS1wcm9wb3NhbC9yZXN1bWUtdmFsaWRhdGlvblwiLFxuICAgICk7XG4gICAgZXhwZWN0KGF3YWl0IHJlZ2lvbi5sb2NhdG9yKCdbZGF0YS1vcGVyYXRpb24taWQ9XCJlMmUtcmVjb3ZlcnktcmFjZS1vcGVyYXRpb25cIl0nKS5jb3VudCgpKS50b0JlKDEpO1xuICAgIGNvbnN0IHZpc2libGVUZXh0ID0gYXdhaXQgcGFnZS5sb2NhdG9yKFwiYm9keVwiKS5pbm5lclRleHQoKTtcbiAgICBleHBlY3QodmlzaWJsZVRleHQpLm5vdC50b01hdGNoKC9EbyBub3QgcmVuZGVyIHRoaXMgc2VydmVyIGRldGFpbHxcXC9ob21lXFwvcnVubmVyfFxcL3RtcFxcLy9pKTtcbiAgICBhd2FpdCBleHBlY3ROb0hvcml6b250YWxPdmVyZmxvdyhwYWdlKTtcbiAgfSk7XG5cbiAgdGVzdChcImV4cGxhaW5zIHdoZW4gYW4gb2xkIHJlY292ZXJ5IGxpbmsgcG9pbnRzIHRvIGEgZGVsZXRlZCBvcGVyYXRpb25cIiwgYXN5bmMgKHtcbiAgICBwYWdlLFxuICB9KSA9PiB7XG4gICAgY29uc3QgcmVjb3ZlcnkgPSB7XG4gICAgICByZXF1ZXN0czogW10gYXMgc3RyaW5nW10sXG4gICAgICBhY3Rpb25SZXF1ZXN0czogW10gYXMgc3RyaW5nW10sXG4gICAgICBvcGVyYXRpb25zOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBwcm9wb3NhbElkOiBcImUyZS1yZWNvdmVyeS1kZWxldGVkLXByb3Bvc2FsXCIsXG4gICAgICAgICAgb3BlcmF0aW9uSWQ6IFwiZTJlLXJlY292ZXJ5LWRlbGV0ZWQtb3BlcmF0aW9uXCIsXG4gICAgICAgICAgc2Vzc2lvbklkOiBcImUyZS1yZWNvdmVyeS1kZWxldGVkLXNlc3Npb25cIixcbiAgICAgICAgICBsaWZlY3ljbGU6IFwiYmxvY2tlZFwiLFxuICAgICAgICAgIHN0YXR1czogXCJwZW5kaW5nXCIsXG4gICAgICAgICAgY3JlYXRlZEF0OiBcIjIwMjYtMDEtMDFUMDA6MDU6MDAuMDAwWlwiLFxuICAgICAgICAgIHJlY292ZXJ5U3RhdGU6IFwicmVjb3ZlcmFibGVcIixcbiAgICAgICAgICBvcGVyYXRvckV4cGxhbmF0aW9uOlxuICAgICAgICAgICAgXCJUaGUgZGVsaXZlcnkgc3RvcHBlZCBiZWNhdXNlIHRoZSByZXRhaW5lZCBjaGFuZ2VzIG5lZWQgcmV2aWV3IGJlZm9yZSB2YWxpZGF0aW9uIGNhbiBjb250aW51ZS5cIixcbiAgICAgICAgICBuZXh0QWN0aW9uOlxuICAgICAgICAgICAgXCJSZXN1bWUgdmFsaWRhdGlvbiB0byByZS1jaGVjayB0aGUgc2F2ZWQgY2hhbmdlcywgb3IgZGlzY2FyZCB0aGlzIHJlY292ZXJ5IGlmIGl0IGlzIG5vIGxvbmdlciBuZWVkZWQuXCIsXG4gICAgICAgICAgY29uZmxpY3RSZWFzb246IG51bGwsXG4gICAgICAgICAgdmFsaWRhdGlvbkV2aWRlbmNlOiBbeyBwcm9maWxlOiBcIndvcmtzcGFjZS10eXBlY2hlY2tcIiwgc3RhdHVzOiBcImZhaWxlZFwiIH1dLFxuICAgICAgICAgIHdvcmtzcGFjZUF2YWlsYWJsZTogdHJ1ZSxcbiAgICAgICAgICBjaGFuZ2VDb3VudDogMSxcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgICByZWNvdmVyeUFjdGlvbjoge1xuICAgICAgICBwcm9wb3NhbElkOiBcImUyZS1yZWNvdmVyeS1kZWxldGVkLXByb3Bvc2FsXCIsXG4gICAgICAgIGFjdGlvbjogXCJyZXN1bWUtdmFsaWRhdGlvblwiIGFzIGNvbnN0LFxuICAgICAgICBzdGF0dXM6IDQwNCxcbiAgICAgICAgcmVzcG9uc2U6IHtcbiAgICAgICAgICBlcnJvcjogXCJEZWxpdmVyeSBvcGVyYXRpb24gbm90IGZvdW5kXCIsXG4gICAgICAgICAgY29kZTogXCJERUxJVkVSWV9OT1RfRk9VTkRcIixcbiAgICAgICAgICBkaWFnbm9zdGljOiBcIkRvIG5vdCByZW5kZXIgdGhpcyBzZXJ2ZXIgZGV0YWlsLlwiLFxuICAgICAgICB9LFxuICAgICAgICBuZXh0T3BlcmF0aW9uczogW10sXG4gICAgICB9LFxuICAgIH07XG4gICAgYXdhaXQgaW5zdGFsbEFwaUZpeHR1cmVzKHBhZ2UsIHsgZGVsaXZlcnlSZWNvdmVyeTogcmVjb3ZlcnkgfSk7XG4gICAgYXdhaXQgcHJvZ3JhbW1hdGljU2lnbkluKHBhZ2UpO1xuICAgIGF3YWl0IHBhZ2UuZ290byhgJHtEQVNIQk9BUkRfUEFUSH1haWApO1xuXG4gICAgY29uc3QgcmVnaW9uID0gcGFnZS5nZXRCeVJvbGUoXCJyZWdpb25cIiwge1xuICAgICAgbmFtZTogXCJSZWNvdmVyYWJsZSBkZWxpdmVyeSBvcGVyYXRpb25zXCIsXG4gICAgfSk7XG4gICAgY29uc3Qgb3BlcmF0aW9uID0gcmVnaW9uLmxvY2F0b3IoXG4gICAgICAnW2RhdGEtb3BlcmF0aW9uLWlkPVwiZTJlLXJlY292ZXJ5LWRlbGV0ZWQtb3BlcmF0aW9uXCJdJyxcbiAgICApO1xuICAgIGF3YWl0IGV4cGVjdChvcGVyYXRpb24uZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJSZXN1bWUgdmFsaWRhdGlvblwiIH0pKS50b0JlRW5hYmxlZCgpO1xuICAgIGF3YWl0IG9wZXJhdGlvbi5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIlJlc3VtZSB2YWxpZGF0aW9uXCIgfSkuY2xpY2soKTtcblxuICAgIGF3YWl0IGV4cGVjdChwYWdlLmdldEJ5VGV4dChcIlJlY292ZXJ5IGxpbmsgZXhwaXJlZFwiLCB7IGV4YWN0OiB0cnVlIH0pKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlUZXh0KFxuICAgICAgICBcIlRoaXMgcmVjb3Zlcnkgb3BlcmF0aW9uIG5vIGxvbmdlciBleGlzdHMuIFRoZSByZWNvdmVyeSBsaXN0IHdhcyByZWZyZXNoZWQuXCIsXG4gICAgICAgIHsgZXhhY3Q6IHRydWUgfSxcbiAgICAgICksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdC5wb2xsKCgpID0+IHJlY292ZXJ5LnJlcXVlc3RzLmxlbmd0aCkudG9CZUdyZWF0ZXJUaGFuT3JFcXVhbCgyKTtcbiAgICBhd2FpdCBleHBlY3QucG9sbCgoKSA9PiByZWdpb24uY291bnQoKSkudG9CZSgwKTtcbiAgICBleHBlY3QocmVjb3ZlcnkuYWN0aW9uUmVxdWVzdHMpLnRvSGF2ZUxlbmd0aCgxKTtcbiAgICBleHBlY3QocmVjb3ZlcnkuYWN0aW9uUmVxdWVzdHNbMF0pLnRvQ29udGFpbihcbiAgICAgIFwiL2FwaS9haS9kZWxpdmVyeS9lMmUtcmVjb3ZlcnktZGVsZXRlZC1wcm9wb3NhbC9yZXN1bWUtdmFsaWRhdGlvblwiLFxuICAgICk7XG4gICAgY29uc3QgdmlzaWJsZVRleHQgPSBhd2FpdCBwYWdlLmxvY2F0b3IoXCJib2R5XCIpLmlubmVyVGV4dCgpO1xuICAgIGV4cGVjdCh2aXNpYmxlVGV4dCkubm90LnRvTWF0Y2goXG4gICAgICAvRGVsaXZlcnkgb3BlcmF0aW9uIG5vdCBmb3VuZHxEbyBub3QgcmVuZGVyIHRoaXMgc2VydmVyIGRldGFpbHxcXC9ob21lXFwvcnVubmVyfFxcL3RtcFxcLy9pLFxuICAgICk7XG4gICAgYXdhaXQgZXhwZWN0Tm9Ib3Jpem9udGFsT3ZlcmZsb3cocGFnZSk7XG4gIH0pO1xuXG4gIHRlc3QoXCJrZWVwcyB0aGUgcmVzdW1lZCBBSSBzZXNzaW9uIGRyYXdlciBvdmVybGFpZCBvbiBhIHBob25lIHZpZXdwb3J0XCIsIGFzeW5jICh7XG4gICAgcGFnZSxcbiAgfSkgPT4ge1xuICAgIGF3YWl0IHBhZ2Uuc2V0Vmlld3BvcnRTaXplKHsgd2lkdGg6IDM5MCwgaGVpZ2h0OiA4NDQgfSk7XG4gICAgY29uc3QgZml4dHVyZSA9IGF3YWl0IGluc3RhbGxBcmFiaWNBaUZpeHR1cmUocGFnZSk7XG4gICAgYXdhaXQgaW5zdGFsbEFwaUZpeHR1cmVzKHBhZ2UsIHsgYXJhYmljQWk6IGZpeHR1cmUgfSk7XG4gICAgYXdhaXQgcHJvZ3JhbW1hdGljU2lnbkluKHBhZ2UpO1xuICAgIGF3YWl0IHBhZ2UuZ290byhgJHtEQVNIQk9BUkRfUEFUSH1haWApO1xuXG4gICAgY29uc3QgY29tcG9zZXIgPSBwYWdlLmxvY2F0b3IoXCJ0ZXh0YXJlYVwiKS5maXJzdCgpO1xuICAgIGF3YWl0IGV4cGVjdChjb21wb3NlcikudG9CZVZpc2libGUoKTtcbiAgICBjb25zdCBiZWZvcmVPcGVuID0gYXdhaXQgY29tcG9zZXIuYm91bmRpbmdCb3goKTtcbiAgICBleHBlY3QoYmVmb3JlT3Blbj8ud2lkdGgpLnRvQmVHcmVhdGVyVGhhbigyNTApO1xuXG4gICAgYXdhaXQgcGFnZS5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIk9wZW4gc2Vzc2lvbnNcIiB9KS5jbGljaygpO1xuICAgIGF3YWl0IGV4cGVjdChwYWdlLmdldEJ5VGV4dChcIlNlc3Npb25zXCIsIHsgZXhhY3Q6IHRydWUgfSkpLnRvQmVWaXNpYmxlKCk7XG4gICAgY29uc3QgZHJhd2VyID0gcGFnZVxuICAgICAgLmdldEJ5VGV4dChcIlNlc3Npb25zXCIsIHsgZXhhY3Q6IHRydWUgfSlcbiAgICAgIC5sb2NhdG9yKFwiLi5cIilcbiAgICAgIC5sb2NhdG9yKFwiLi5cIik7XG4gICAgY29uc3QgZHJhd2VyQm94ID0gYXdhaXQgZHJhd2VyLmJvdW5kaW5nQm94KCk7XG4gICAgZXhwZWN0KGRyYXdlckJveD8ud2lkdGgpLnRvQmVMZXNzVGhhbk9yRXF1YWwoMzkwKTtcbiAgICBjb25zdCBkdXJpbmdPcGVuID0gYXdhaXQgY29tcG9zZXIuYm91bmRpbmdCb3goKTtcbiAgICBleHBlY3QoZHVyaW5nT3Blbj8ud2lkdGgpLnRvQmVHcmVhdGVyVGhhbigyNTApO1xuXG4gICAgYXdhaXQgcGFnZS5nZXRCeVJvbGUoXCJidXR0b25cIiwgeyBuYW1lOiBcIkNsb3NlIHNpZGViYXJcIiB9KS5jbGljaygpO1xuICAgIGF3YWl0IGV4cGVjdChcbiAgICAgIHBhZ2UuZ2V0QnlSb2xlKFwiYnV0dG9uXCIsIHsgbmFtZTogXCJPcGVuIHNlc3Npb25zXCIgfSksXG4gICAgKS50b0JlVmlzaWJsZSgpO1xuICAgIGF3YWl0IGV4cGVjdE5vSG9yaXpvbnRhbE92ZXJmbG93KHBhZ2UpO1xuICB9KTtcblxuICB0ZXN0KFwicmVuZGVycyBhIHVzZXItdmlzaWJsZSBBUEkgZmFpbHVyZSBzdGF0ZVwiLCBhc3luYyAoeyBwYWdlIH0pID0+IHtcbiAgICBhd2FpdCBwYWdlLnJvdXRlKFwiKiovYXBpL2Rhc2hib2FyZFwiLCAocm91dGUpID0+XG4gICAgICByb3V0ZS5mdWxmaWxsKFxuICAgICAgICBqc29uUmVzcG9uc2UoeyBlcnJvcjogXCJjb250cm9sbGVkIGRhc2hib2FyZCBvdXRhZ2VcIiB9LCA1MDMpLFxuICAgICAgKSxcbiAgICApO1xuICAgIGF3YWl0IHByb2dyYW1tYXRpY1NpZ25JbihwYWdlKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5Um9sZShcImhlYWRpbmdcIiwgeyBuYW1lOiBcIkZhaWxlZCB0byBsb2FkIGRhc2hib2FyZFwiIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgICBhd2FpdCBleHBlY3QoXG4gICAgICBwYWdlLmdldEJ5Um9sZShcImJ1dHRvblwiLCB7IG5hbWU6IFwiUmV0cnkgQ29ubmVjdGlvblwiIH0pLFxuICAgICkudG9CZVZpc2libGUoKTtcbiAgfSk7XG59KTtcbiJdLCJtYXBwaW5ncyI6IjtBQUFBLFNBQVNBLE1BQU0sRUFBRUMsSUFBSSxRQUFtQixrQkFBa0I7QUFDMUQsU0FBU0MsS0FBSyxFQUFFQyxTQUFTLFFBQVEsa0JBQWtCO0FBQ25ELFNBQVNDLE9BQU8sUUFBUSxXQUFXO0FBQ25DLFNBQ0VDLDZCQUE2QixFQUM3QkMsNEJBQTRCLEVBQzVCQyw2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