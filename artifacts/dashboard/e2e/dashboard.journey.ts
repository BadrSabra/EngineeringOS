import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  isClerkHandoffNavigationAbort,
  parseClerkSignInTokenResponse,
  parseClerkUserLookupResponse,
  parseCreatedClerkUserResponse,
} from "../src/lib/clerk-handoff";
import { CAPABILITY_PROBE_MESSAGE } from "@workspace/ai-orchestrator/capability-probe";

const DASHBOARD_PATH = "/dashboard/";
const TEST_USER = {
  firstName: "EngineeringOS",
  lastName: "Dashboard Smoke",
  email:
    process.env.DASHBOARD_E2E_EMAIL ??
    "engineeringos-dashboard-smoke@example.com",
};
const EXECUTION_ID = "e2e-controlled-execution";
const DEFAULT_LIVE_TIMEOUT_MS = 120_000;
const LIVE_TEST_TIMEOUT_MARGIN_MS = 5_000;
const DEFAULT_READINESS_TIMEOUT_MS = 15_000;
const TEST_MODES = new Set(["fixture", "live-provider"]);
const HOSTILE_ORIGIN = "https://attacker.example";
const ORIGIN_DIAGNOSTIC_HEADERS = [
  "access-control-allow-origin",
  "access-control-allow-methods",
  "access-control-allow-headers",
  "vary",
] as const;
const DEFAULT_LIVE_PROMPT =
  "Perform a bounded forensic audit of this disposable project using read-only tools. " +
  "Produce at least one accepted evidence item and one validation checkpoint, and do not " +
  "report COMPLETED unless both are present. Report only verified evidence.";
const LIVE_CAMPAIGN_SCENARIOS = new Set([
  "provider-outage",
  "malformed-output",
  "delivery-success",
]);

function liveCampaignScenario(): string | undefined {
  const scenario = process.env.DASHBOARD_E2E_LIVE_SCENARIO?.trim();
  if (process.env.DASHBOARD_E2E_LIVE_CAMPAIGN === "1" && !scenario) {
    throw new Error(
      "Live campaign requires DASHBOARD_E2E_LIVE_SCENARIO=provider-outage, malformed-output, or delivery-success.",
    );
  }
  if (scenario && !LIVE_CAMPAIGN_SCENARIOS.has(scenario)) {
    throw new Error(`Unsupported live campaign scenario: ${scenario}.`);
  }
  return scenario;
}

function livePrompt(): string {
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
  return process.env.DASHBOARD_E2E_LIVE_PROMPT ?? DEFAULT_LIVE_PROMPT;
}

function liveTimeoutMs(): number {
  const configured = Number(process.env.DASHBOARD_E2E_LIVE_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_LIVE_TIMEOUT_MS;
}

function dashboardTestMode(): string {
  return process.env.DASHBOARD_E2E_TEST_MODE ?? "fixture";
}

function readinessTimeoutMs(): number {
  const configured = Number(process.env.DASHBOARD_E2E_READINESS_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_READINESS_TIMEOUT_MS;
}

async function writeReadinessReceipt(
  outcome: "ready" | "blocked",
  checks: Record<string, unknown>,
  reason?: string,
) {
  const receiptPath = process.env.DASHBOARD_E2E_READINESS_ARTIFACT_PATH;
  if (!receiptPath) return;
  await mkdir(dirname(receiptPath), { recursive: true });
  await writeFile(
    receiptPath,
    `${JSON.stringify(
      {
        outcome,
        ...(reason ? { reason } : {}),
        checks,
        mode: dashboardTestMode(),
        project:
          dashboardTestMode() === "live-provider"
            ? process.env.DASHBOARD_E2E_LIVE_PROJECT_ID
            : "e2e-project",
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

function approvedDashboardOrigins(): string[] {
  const origins = (process.env.DASHBOARD_E2E_APPROVED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (origins.length === 0) {
    throw new Error(
      "DASHBOARD_E2E_APPROVED_ORIGINS must contain every approved dashboard origin.",
    );
  }
  return origins.map((origin) => {
    const parsed = new URL(origin);
    if (
      parsed.origin !== origin ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    ) {
      throw new Error(
        `Dashboard journey origin must be a bare origin: ${origin}`,
      );
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
  taskStatusBreakdown: { pending: 0, running: 0 },
  projectScores: [
    {
      projectId: "e2e-project",
      projectName: "Smoke Project",
      score: 92,
      trend: "stable",
    },
  ],
  recentEvents: [
    {
      id: "e2e-event",
      type: "SmokeCheck",
      severity: "success",
      message: "Dashboard API fixture ready",
      timestamp: "2026-01-01T00:00:00.000Z",
    },
  ],
  topRules: [],
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
    detail: "Controlled browser fixture completed.",
  },
  objective: { objective: "Verify the dashboard browser journey" },
  startedAt: "2026-01-01T00:00:00.000Z",
  completedAt: "2026-01-01T00:01:00.000Z",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:01:00.000Z",
};

function jsonResponse(
  body: unknown,
  status = 200,
  headers?: Record<string, string>,
) {
  return {
    status,
    contentType: "application/json",
    ...(headers ? { headers } : {}),
    body: JSON.stringify(body),
  };
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(overflow.document).toBeLessThanOrEqual(overflow.viewport + 1);
  expect(overflow.body).toBeLessThanOrEqual(overflow.viewport + 1);
}

async function expectWithinViewport(
  locator: Locator,
  viewport: { width: number; height: number },
  label: string,
) {
  const box = await locator.boundingBox();
  expect(box, `${label} should have a layout box`).not.toBeNull();
  expect(box!.x, `${label} left edge`).toBeGreaterThanOrEqual(-1);
  expect(box!.y, `${label} top edge`).toBeGreaterThanOrEqual(-1);
  expect(box!.x + box!.width, `${label} right edge`).toBeLessThanOrEqual(
    viewport.width + 1,
  );
  expect(box!.y + box!.height, `${label} bottom edge`).toBeLessThanOrEqual(
    viewport.height + 1,
  );
}

async function expectDashboardReady(page: Page) {
  await expect(
    page.getByRole("heading", { name: "System Overview" }),
  ).toBeVisible();
  await expect(page.getByText("SYSTEM ONLINE", { exact: true })).toBeVisible();
}

async function restartApiForCampaign(page: Page) {
  const controlUrl = process.env.DASHBOARD_E2E_CONTROL_URL;
  if (!controlUrl) throw new Error("Dashboard campaign control URL is missing.");
  const response = await page.request.post(`${controlUrl}/restart-api`, {
    timeout: 15_000,
  });
  expect(response.status()).toBe(204);
}

async function setGroqCatalogFixture(
  page: Page,
  mode: "timeout" | "healthy" | "retired",
) {
  const controlUrl = process.env.DASHBOARD_E2E_CONTROL_URL;
  if (!controlUrl) throw new Error("Dashboard campaign control URL is missing.");
  const response = await page.request.post(
    `${controlUrl}/groq-catalog-fixture?mode=${mode}`,
    { timeout: 15_000 },
  );
  expect(response.status()).toBe(204);
}

async function readOperatorAlerts(
  page: Page,
  options: { activeOnly?: boolean } = {},
) {
  const activeOnly = options.activeOnly ?? true;
  const response = await page.evaluate(async (url) => {
    const result = await fetch(url, { credentials: "include" });
    return {
      status: result.status,
      body: (await result.json().catch(() => ({}))) as {
        alerts?: Array<Record<string, unknown>>;
      },
    };
  }, apiUrl(page, `/api/ai/operator-alerts?activeOnly=${activeOnly}&limit=100`));
  expect(response.status).toBe(200);
  return response.body.alerts ?? [];
}

async function writeGroqCatalogEvidence(evidence: Record<string, unknown>) {
  const evidencePath = process.env.DASHBOARD_E2E_GROQ_CATALOG_ARTIFACT_PATH;
  if (!evidencePath) return;
  await mkdir(dirname(evidencePath), { recursive: true });
  await writeFile(
    evidencePath,
    `${JSON.stringify(
      {
        version: 1,
        provider: "groq",
        mode: "controlled-release-fixture",
        ...evidence,
        redaction: {
          excluded: ["credentials", "raw provider diagnostics", "model output"],
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

type ArabicAiFixture = {
  question: string;
  answer: string;
  source: string;
  sessionId: string;
  executionId?: string;
  projectId?: string;
  streamBody: string;
  message: Record<string, unknown>;
};

async function installApiFixtures(
  page: Page,
  overrides?: {
    arabicAi?: ArabicAiFixture;
    capabilityProbeAi?: ArabicAiFixture;
    alternateAi?: ArabicAiFixture;
    disconnectAi?: ArabicAiFixture;
    interruptedAi?: ArabicAiFixture;
    resumeFailure?: {
      fixture: ArabicAiFixture;
      execution: Record<string, unknown>;
    };
    interruptedResume?: {
      fixture: ArabicAiFixture;
      execution: Record<string, unknown>;
      recoveredToken: string;
      resumedStreamBody: string;
    };
    deliveryRecovery?: {
      operations: Array<Record<string, unknown>>;
      requests: string[];
      actionRequests?: string[];
      recoveryAction?: {
        proposalId: string;
        action: "resume-validation" | "discard";
        response: Record<string, unknown>;
        status?: number;
        nextOperations?: Array<Record<string, unknown>>;
      };
    };
    projects?: Array<Record<string, unknown>>;
    events?: Array<Record<string, unknown>>;
    archiveUpload?: {
      uploadId: string;
      originalName: string;
    };
    auditExport?: {
      body: Record<string, unknown>;
      filename: string;
      requests: string[];
      execution?: Record<string, unknown>;
      messageOutcome?: string;
      failFirstPreview?: boolean;
    };
    historicalAudits?: {
      audits: Array<Record<string, unknown>>;
      executions?: Record<string, Record<string, unknown>>;
    };
    liveTask?: {
      id: string;
      title: string;
      projectId: string;
      log: Record<string, unknown>;
      initialLogs?: Array<Record<string, unknown>>;
      streamRequests?: string[];
      failFirstStream?: boolean;
      failStreamAttempts?: number;
    };
    taskActions?: {
      tasks: Array<Record<string, unknown>>;
      requests: string[];
      verificationRequests?: Array<Record<string, unknown>>;
    };
    recoveryTasks?: Array<Record<string, unknown>>;
    recoveryWorkflows?: Array<Record<string, unknown>>;
    recoveryWorkflowExecutions?: Record<string, Array<Record<string, unknown>>>;
    operatorAlertsPassthrough?: boolean;
  },
) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/dashboard(?=\/|$)/, "");
    const arabicAi = overrides?.arabicAi;
    const capabilityProbeAi = overrides?.capabilityProbeAi;
    const alternateAi = overrides?.alternateAi;
    const disconnectAi = overrides?.disconnectAi;
    const interruptedAi = overrides?.interruptedAi;
    const recoveryAi =
      overrides?.resumeFailure?.fixture ?? overrides?.interruptedResume?.fixture;
    const aiFixtures = [
      arabicAi,
      capabilityProbeAi,
      alternateAi,
      disconnectAi,
      interruptedAi,
      recoveryAi,
    ].filter((fixture): fixture is ArabicAiFixture => Boolean(fixture));
    const hasConfiguredAiFixture =
      aiFixtures.length > 0 ||
      Boolean(overrides?.resumeFailure || overrides?.interruptedResume);

    if (
      overrides?.operatorAlertsPassthrough &&
      path === "/api/ai/operator-alerts"
    ) {
      return route.continue();
    }

    if (aiFixtures.length > 0 && path.endsWith("/api/ai/chat/sessions")) {
      const projectId = url.searchParams.get("projectId");
      const projectSessions = aiFixtures.filter(
        (fixture) => !fixture.projectId || fixture.projectId === projectId,
      );
      return route.fulfill(
        jsonResponse(
          projectSessions.map((fixture) => ({
            id: fixture.sessionId,
            title: fixture.question,
            updatedAt: "2026-01-01T00:02:00.000Z",
          })),
        ),
      );
    }
    if (
      overrides?.historicalAudits &&
      path === "/api/ai/executions/history"
    ) {
      return route.fulfill(jsonResponse(overrides.historicalAudits.audits));
    }
    if (overrides?.resumeFailure && path.endsWith("/api/ai/chat/stream")) {
      let requestBody: Record<string, unknown> = {};
      try {
        requestBody = route.request().postDataJSON() as Record<string, unknown>;
      } catch {
        // The normal provider-free fallback below handles malformed requests.
      }
      if (
        requestBody.executionId === overrides.resumeFailure.fixture.executionId
      ) {
        return route.fulfill({
          status: 200,
          contentType: "text/event-stream",
          headers: { "Cache-Control": "no-cache" },
          body: overrides.resumeFailure.fixture.streamBody,
        });
      }
    }
    if (overrides?.interruptedResume && path.endsWith("/api/ai/chat/stream")) {
      let requestBody: Record<string, unknown> = {};
      try {
        requestBody = route.request().postDataJSON() as Record<string, unknown>;
      } catch {
        // The normal provider-free fallback below handles malformed requests.
      }
      const { fixture, resumedStreamBody } = overrides.interruptedResume;
      if (requestBody.executionId === fixture.executionId) {
        return route.fulfill({
          status: 200,
          contentType: "text/event-stream",
          headers: { "Cache-Control": "no-cache" },
          body: resumedStreamBody,
        });
      }
      if (!requestBody.executionId) {
        return route.fulfill({
          status: 200,
          contentType: "text/event-stream",
          headers: { "Cache-Control": "no-cache" },
          // Deliberately stop after the durable execution identity. The
          // journey wraps this response in a browser-level stream error.
          body: fixture.streamBody,
        });
      }
    }
    let requestedMessage: string | undefined;
    try {
      requestedMessage = (route.request().postDataJSON() as Record<string, unknown>)
        .message as string | undefined;
    } catch {
      // The default provider-unavailable response handles malformed requests.
    }
    const streamFixture =
      disconnectAi ??
      aiFixtures.find(
        (fixture) =>
          typeof requestedMessage === "string" &&
          (requestedMessage === fixture.question ||
            requestedMessage.includes(fixture.question)),
      ) ??
      arabicAi;
    if (streamFixture && path.endsWith("/api/ai/chat/stream"))
      return route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        headers: { "Cache-Control": "no-cache" },
        body: streamFixture.streamBody,
      });
    const messageFixture = aiFixtures.find((fixture) =>
      path.endsWith(`/api/ai/chat/${fixture.sessionId}/messages`),
    );
    if (messageFixture)
      return route.fulfill(
        jsonResponse([
          {
            id: `${messageFixture.sessionId}-user-message`,
            sessionId: messageFixture.sessionId,
            role: "user",
            content: messageFixture.question,
            createdAt: "2026-01-01T00:01:00.000Z",
          },
          ...(messageFixture === recoveryAi ? [] : [messageFixture.message]),
        ]),
      );
    if (
      overrides?.auditExport &&
      path.endsWith("/api/ai/chat/e2e-audit-session/messages")
    ) {
      return route.fulfill(
        jsonResponse([
          {
            id: "e2e-audit-user-message",
            sessionId: "e2e-audit-session",
            role: "user",
            content: "Completed audit execution",
            createdAt: "2026-01-01T00:01:00.000Z",
          },
          {
            id: "e2e-audit-assistant-message",
            sessionId: "e2e-audit-session",
            role: "assistant",
            content: "Completed audit execution",
            executionId: EXECUTION_ID,
            outcome: overrides.auditExport.messageOutcome ?? "SUCCEEDED",
            createdAt: "2026-01-01T00:02:00.000Z",
          },
        ]),
      );
    }

    if (path === "/api/dashboard")
      return route.fulfill(jsonResponse(dashboardFixture));
    if (overrides?.taskActions) {
      const verificationMatch = path.match(
        /^\/api\/tasks\/([^/]+)\/verification$/,
      );
      if (verificationMatch && route.request().method() === "POST") {
        const [, taskId] = verificationMatch;
        const task = overrides.taskActions.tasks.find(
          (candidate) => candidate.id === taskId,
        );
        if (!task) {
          return route.fulfill(jsonResponse({ error: "Task not found" }, 404));
        }

        let body: Record<string, unknown> = {};
        try {
          body = route.request().postDataJSON() as Record<string, unknown>;
        } catch {
          return route.fulfill(
            jsonResponse({ error: "Invalid verification request" }, 400),
          );
        }
        const plan = task.remediationPlan as
          | {
              verificationChecks?: Array<Record<string, unknown>>;
              verificationSteps?: string[];
            }
          | undefined;
        const checks =
          plan?.verificationChecks ??
          (plan?.verificationSteps ?? []).map((guidance, index) => ({
            id: `rule-verification-${index + 1}`,
            kind: "operator_attestation",
            guidance,
          }));
        const check = checks.find((candidate) => candidate.id === body.checkId);
        if (!check) {
          return route.fulfill(
            jsonResponse(
              {
                error: "verification_check_not_found",
                reason:
                  "The submitted check is not part of this task's server-owned verification plan.",
              },
              400,
            ),
          );
        }
        const passed = body.passed === true;
        const evidence =
          typeof body.evidence === "string" ? body.evidence.trim() : "";
        if (passed && !evidence) {
          return route.fulfill(
            jsonResponse(
              {
                error: "verification_evidence_required",
                reason:
                  "A passed verification check must include explicit operator evidence.",
              },
              400,
            ),
          );
        }

        overrides.taskActions.verificationRequests?.push({
          taskId,
          checkId: body.checkId,
          passed,
          ...(evidence ? { evidence } : {}),
        });

        const priorResult = (task.verificationResult ?? {}) as {
          steps?: Array<Record<string, unknown>>;
          history?: Array<Record<string, unknown>>;
        };
        const priorSteps = priorResult.steps ?? [];
        const steps = checks.map((candidate) => {
          const prior = priorSteps.find((step) => step.id === candidate.id);
          if (candidate.id !== body.checkId) {
            return (
              prior ?? {
                id: candidate.id,
                name: `Rule verification ${String(candidate.id).replace(
                  "rule-verification-",
                  "#",
                )}`,
                kind: candidate.kind ?? "operator_attestation",
                guidance: candidate.guidance,
                passed: false,
                output: "Not recorded — operator evidence is required",
              }
            );
          }
          return {
            id: candidate.id,
            name: `Rule verification ${String(candidate.id).replace(
              "rule-verification-",
              "#",
            )}`,
            kind: candidate.kind ?? "operator_attestation",
            guidance: candidate.guidance,
            passed,
            ...(evidence ? { evidence } : {}),
            output: passed
              ? "Operator evidence recorded"
              : "Operator reported that the check failed",
          };
        });
        const completed = steps.every(
          (step) => step.passed === true && Boolean(String(step.evidence ?? "").trim()),
        );
        task.status = completed ? "completed" : "verifying";
        task.verificationResult = {
          passed: completed,
          decision: completed ? "verified" : "incomplete",
          steps,
          history: [
            ...(priorResult.history ?? []),
            {
              id: `verification-history-${String(
                (priorResult.history ?? []).length + 1,
              )}`,
              checkId: check.id,
              name: `Rule verification ${String(check.id).replace(
                "rule-verification-",
                "#",
              )}`,
              kind: check.kind ?? "operator_attestation",
              guidance: check.guidance,
              passed,
              ...(evidence ? { evidence } : {}),
              actor: "e2e-operator",
              recordedAt: `2026-01-01T00:0${
                (priorResult.history ?? []).length + 2
              }:00.000Z`,
            },
          ],
        };
        if (task.remediationPlan && completed) {
          task.remediationPlan = {
            ...(task.remediationPlan as Record<string, unknown>),
            status: "verified",
          };
        }
        task.updatedAt = "2026-01-01T00:04:00.000Z";
        if (completed) task.completedAt = task.updatedAt;
        return route.fulfill(jsonResponse(task));
      }

      const actionMatch = path.match(/^\/api\/tasks\/([^/]+)\/(execute|retry)$/);
      if (actionMatch && route.request().method() === "POST") {
        const [, taskId, action] = actionMatch;
        const task = overrides.taskActions.tasks.find(
          (candidate) => candidate.id === taskId,
        );
        if (!task) {
          return route.fulfill(jsonResponse({ error: "Task not found" }, 404));
        }

        overrides.taskActions.requests.push(`${action}:${taskId}`);
        if (action === "execute") {
          task.status = "running";
          task.updatedAt = "2026-01-01T00:02:00.000Z";
        } else {
          task.status = "queued";
          task.retryCount = Number(task.retryCount ?? 0) + 1;
          task.updatedAt = "2026-01-01T00:02:00.000Z";
        }
        return route.fulfill(jsonResponse(task, 202));
      }
    }
    if (path === "/api/tasks") {
      return route.fulfill(
        jsonResponse(
          overrides?.taskActions?.tasks ??
            overrides?.recoveryTasks ??
            (overrides?.liveTask
              ? [
                  {
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
                    updatedAt: "2026-01-01T00:00:01.000Z",
                  },
                ]
              : []),
        ),
      );
    }
    if (path === "/api/workflows") {
      return route.fulfill(
        jsonResponse(overrides?.recoveryWorkflows ?? []),
      );
    }
    const workflowExecutionsMatch = path.match(
      /^\/api\/workflows\/([^/]+)\/executions$/,
    );
    if (workflowExecutionsMatch) {
      return route.fulfill(
        jsonResponse(
          overrides?.recoveryWorkflowExecutions?.[workflowExecutionsMatch[1]] ??
            [],
        ),
      );
    }
    if (
      overrides?.auditExport &&
      path === `/api/ai/executions/${EXECUTION_ID}/audit-export`
    ) {
      overrides.auditExport.requests.push(route.request().url());
      if (
        overrides.auditExport.failFirstPreview &&
        overrides.auditExport.requests.length === 1
      ) {
        return route.fulfill(
          jsonResponse(
            { error: "Temporary preview network failure." },
            503,
          ),
        );
      }
      return route.fulfill(
        jsonResponse(overrides.auditExport.body, 200, {
          "Content-Disposition": `attachment; filename="${overrides.auditExport.filename}"`,
        }),
      );
    }
    if (overrides?.archiveUpload && path === "/api/upload/archive") {
      const contentType = route.request().headers()["content-type"] ?? "";
      if (!contentType.startsWith("multipart/form-data;")) {
        return route.fulfill(
          jsonResponse({ error: "Expected multipart archive upload." }, 400),
        );
      }
      const body = route.request().postDataBuffer();
      if (!body?.includes(Buffer.from("dashboard-journey.zip"))) {
        return route.fulfill(
          jsonResponse({ error: "Expected the journey archive payload." }, 400),
        );
      }
      return route.fulfill(
        jsonResponse(
          {
            uploadId: overrides.archiveUpload.uploadId,
            originalName: overrides.archiveUpload.originalName,
          },
          201,
          {
            "access-control-allow-origin": new URL(page.url()).origin,
            "access-control-allow-credentials": "true",
          },
        ),
      );
    }
    if (overrides?.liveTask && path === "/api/tasks") {
      return route.fulfill(
        jsonResponse([
          {
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
            updatedAt: "2026-01-01T00:00:01.000Z",
          },
        ]),
      );
    }
    if (
      overrides?.liveTask &&
      path === `/api/tasks/${overrides.liveTask.id}/logs`
    ) {
      return route.fulfill(jsonResponse(overrides.liveTask.initialLogs ?? []));
    }
    if (
      overrides?.liveTask &&
      path === `/api/tasks/${overrides.liveTask.id}/logs/stream`
    ) {
      const streamRequests = overrides.liveTask.streamRequests;
      streamRequests?.push(route.request().url());
      if (
        (overrides.liveTask.failFirstStream && streamRequests?.length === 1) ||
        (overrides.liveTask.failStreamAttempts &&
          streamRequests &&
          streamRequests.length <= overrides.liveTask.failStreamAttempts)
      ) {
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
          "access-control-allow-credentials": "true",
        },
        body: `event: log\ndata: ${JSON.stringify(overrides.liveTask.log)}\n\n`,
      });
    }
    if (path === "/api/projects") {
      return route.fulfill(
        jsonResponse(
          overrides?.projects ?? [
            {
              id: "e2e-project",
              name: "Smoke Project",
              language: "TypeScript",
              framework: "React",
              status: "active",
              rootPath: "/controlled/smoke",
              qualityScore: 92,
            },
          ],
        ),
      );
    }
    if (path === "/api/readiness") {
      return route.fulfill(
        jsonResponse({
          status: "ready",
          checks: {
            api: { status: "ready" },
            database: { status: "ready" },
            schema: { status: "ready" },
          },
        }),
      );
    }
    if (hasConfiguredAiFixture && path === "/api/ai/active-provider") {
      return route.fulfill(
        jsonResponse({ provider: "openrouter", configured: true }),
      );
    }
    if (
      overrides?.deliveryRecovery &&
      path === "/api/ai/delivery/recoverable"
    ) {
      overrides.deliveryRecovery.requests.push(route.request().url());
      return route.fulfill(
        jsonResponse({ operations: overrides.deliveryRecovery.operations }),
      );
    }
    if (
      overrides?.deliveryRecovery?.recoveryAction &&
      path ===
        `/api/ai/delivery/${overrides.deliveryRecovery.recoveryAction.proposalId}/${overrides.deliveryRecovery.recoveryAction.action}`
    ) {
      overrides.deliveryRecovery.actionRequests?.push(route.request().url());
      if (overrides.deliveryRecovery.recoveryAction.nextOperations) {
        overrides.deliveryRecovery.operations =
          overrides.deliveryRecovery.recoveryAction.nextOperations;
      }
      return route.fulfill(
        jsonResponse(
          overrides.deliveryRecovery.recoveryAction.response,
          overrides.deliveryRecovery.recoveryAction.status ?? 409,
        ),
      );
    }
    if (path === "/api/events") {
      const events = overrides?.events ?? dashboardFixture.recentEvents;
      const search = url.searchParams.get("search")?.toLowerCase();
      const filteredEvents = events.filter((event) => {
        const projectId = url.searchParams.get("projectId");
        const severity = url.searchParams.get("severity");
        const correlationId = url.searchParams.get("correlationId");
        return (
          (!projectId || event.projectId === projectId) &&
          (!severity || event.severity === severity) &&
          (!correlationId || event.correlationId === correlationId) &&
          (!search ||
            [event.message, event.type, event.correlationId]
              .filter((value): value is string => typeof value === "string")
              .some((value) => value.toLowerCase().includes(search)))
        );
      });
      const limit = Number(url.searchParams.get("limit")) || 50;
      const page = Number(url.searchParams.get("page")) || 1;
      return route.fulfill(
        jsonResponse({
          events: filteredEvents.slice((page - 1) * limit, page * limit),
          total: filteredEvents.length,
        }),
      );
    }
    if (
      overrides?.resumeFailure &&
      path ===
        `/api/ai/executions/${overrides.resumeFailure.fixture.executionId}`
    ) {
      return route.fulfill(jsonResponse(overrides.resumeFailure.execution));
    }
    if (
      overrides?.interruptedResume &&
      path ===
        `/api/ai/executions/${overrides.interruptedResume.fixture.executionId}`
    ) {
      return route.fulfill(jsonResponse(overrides.interruptedResume.execution));
    }
    if (
      overrides?.interruptedResume &&
      path ===
        `/api/ai/executions/${overrides.interruptedResume.fixture.executionId}/resume-capability`
    ) {
      return route.fulfill(
        jsonResponse({
          executionId: overrides.interruptedResume.fixture.executionId,
          resumeToken: overrides.interruptedResume.recoveredToken,
        }),
      );
    }
    if (overrides?.historicalAudits?.executions?.[path.split("/").pop() ?? ""]) {
      return route.fulfill(
        jsonResponse(
          overrides.historicalAudits.executions[path.split("/").pop() ?? ""],
        ),
      );
    }
    if (path === `/api/ai/executions/${EXECUTION_ID}`)
      return route.fulfill(
        jsonResponse(overrides?.auditExport?.execution ?? executionFixture),
      );
    if (path === "/api/ai/mission-control")
      return route.fulfill(
        jsonResponse({ updatedAt: "2026-01-01T00:01:00.000Z", executions: [] }),
      );

    // AI is deliberately not executed in this smoke journey. This response
    // verifies the user-visible unavailable/empty state without a provider.
    if (path.startsWith("/api/ai/"))
      return route.fulfill(
        jsonResponse({ error: "AI provider not configured" }, 428),
      );

    return route.continue();
  });
}

async function installArabicAiFixture(
  page: Page,
  options?: {
    blocked?: boolean;
    sessionId?: string;
    question?: string;
    projectId?: string;
  },
) {
  const sessionId = options?.sessionId ?? "e2e-arabic-ai-session";
  const messageId = "e2e-arabic-ai-message";
  const source = "src/execution-tools.ts";
  const blocked = options?.blocked === true;
  const question =
    options?.question ??
    "ماذا يحدث عند انتهاء مهلة provider timeout داخل execution-tools.ts؟";
  const answer =
    "عند انتهاء مهلة مزود الذكاء الاصطناعي، يعيد المسار تقريرًا جزئيًا من الأدلة التي جُمعت بدل إصدار Finding غير مثبت.";
  const evidence = [
    {
      source,
      ...(blocked
        ? {
            excerpt: "provider timeout is handled here",
            supportsClaim: false,
            evidenceClass: "READ_CONFIRMED",
            citationStatus: "BLOCKED",
            citationReason: "MISSING_LITERAL_MATCH",
          }
        : {
            excerpt: 'return partialFromCollectedEvidence("provider timeout");',
            sourceSpan: { startLine: 42, endLine: 42 },
            supportsClaim: true,
            evidenceClass: "BEHAVIOR_PROVEN",
            citationStatus: "ACCEPTED",
            citationReason: "ACCEPTED_SOURCE_SPAN",
          }),
    },
  ];
  const toolTrace = [
    {
      kind: "tool_call",
      tool: "read_file",
      args: { path: source },
      cached: false,
      prefetched: true,
    },
    {
      kind: "tool_result",
      tool: "read_file",
      source,
      cached: false,
      prefetched: true,
    },
    {
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
      finalAnswerType: "PRODUCTION_REACHABILITY_ANSWER",
    },
  ];
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
        complete: true,
      },
    },
  };
  const contextProvenance = {
    schemaVersion: "1",
    intentKind: "FORENSIC_AUDIT",
    revisionLabel: "workspace-revision-safe-7",
    slices: [{
      layer: "tasks",
      source: "db:tasks",
      status: "loaded",
      freshness: "fresh",
      rowCount: 1,
      truncated: false,
    }],
    links: {
      returnedCount: 2,
      truncated: false,
      statuses: ["loaded"],
      details: [{
        source: "file",
        layer: "context",
        direction: "outbound",
        status: "loaded",
        freshness: "fresh",
        rowCount: 1,
        linkReason: "context dependency",
        sourceRefCount: 1,
      }],
    },
    citations: [source],
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
    contextProvenance,
    createdAt: "2026-01-01T00:02:00.000Z",
  };
  const sse = (event: Record<string, unknown>) =>
    `data: ${JSON.stringify(event)}\n\n`;
  const streamBody = [
    sse({ type: "session_started", sessionId }),
    sse({
      type: "execution_started",
      executionId: "e2e-execution",
      status: "running",
      resumable: true,
    }),
    sse({ type: "stage", stage: "building-context" }),
    sse({ type: "stage", stage: "calling-model" }),
    sse({
      type: "tool_call",
      tool: "read_file",
      args: { path: source },
      cached: false,
      prefetched: true,
    }),
    sse({
      type: "tool_result",
      tool: "read_file",
      source,
      cached: false,
      prefetched: true,
    }),
    sse({
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
      finalAnswerType: "PRODUCTION_REACHABILITY_ANSWER",
    }),
    sse({ type: "delta", delta: answer }),
    sse({
      type: "done",
      sessionId,
      message,
      sources: [source],
      toolTrace: JSON.stringify(toolTrace),
      behaviorEvidence: evidence,
      taskResult,
      contextProvenance,
      pendingChanges: [],
    }),
  ].join("");

  return {
    question,
    answer,
    source,
    sessionId,
    projectId: options?.projectId,
    streamBody,
    message,
  };
}

function installCapabilityProbeFixture(): ArabicAiFixture {
  const sessionId = "e2e-capability-probe-session";
  const messageId = "e2e-capability-probe-message";
  const sources = [
    "lib/ai-orchestrator/src/prompts/profile-classifier.ts",
    "lib/ai-orchestrator/src/tools/file-tools.ts",
  ];
  const question = CAPABILITY_PROBE_MESSAGE;
  const answer = [
    "# AI Model Capability Probe",
    "",
    "### C1",
    "PASS — `isPromptProsePath` exists in profile-classifier.ts and returns whether the value includes the defect/repair marker.",
    'Source: `return value.includes("defect/repair");`',
    "",
    "### C2",
    "PASS — read_file read the source bodies and search_code located the requested symbols.",
    'Source: `tool: "read_file"`',
    "",
    "### C3",
    "PASS — the named function's executable return behavior is grounded in the source.",
    'Source: `return value.includes("defect/repair");`',
    "",
    "### C4",
    "PASS — only the two declared files were read; no out-of-scope source was inspected.",
    `Source: \`${sources.join(" and ")}\``,
    "",
    "### C5",
    "PASS — no write_file or replace_text tool was called; this probe was read-only.",
    'Source: `tool: "read_file"`',
    "",
    "### C6",
    "PASS — no eval( or Function( call exists in profile-classifier.ts.",
    'Source: `return value.includes("defect/repair");`',
    "",
    "### C7",
    "PASS — PROSE_PSEUDO_PATH_DENYLIST, run(), and an immediate write_file call are MISSING.",
    'Source: `return "executed:" + name;`',
    "",
    "Coverage: COMPLETE — both declared files were read to completion.",
    "Overall score: 7/7 capabilities demonstrated.",
  ].join("\n");
  const evidence = [
    {
      source: sources[0],
      excerpt: "return value.includes('defect/repair');",
      sourceSpan: { startLine: 2, endLine: 2 },
      supportsClaim: true,
      evidenceClass: "BEHAVIOR_PROVEN",
      citationStatus: "ACCEPTED",
      citationReason: "ACCEPTED_SOURCE_SPAN",
    },
    {
      source: sources[1],
      excerpt: 'return "executed:" + name;',
      sourceSpan: { startLine: 2, endLine: 2 },
      supportsClaim: true,
      evidenceClass: "BEHAVIOR_PROVEN",
      citationStatus: "ACCEPTED",
      citationReason: "ACCEPTED_SOURCE_SPAN",
    },
  ];
  const toolTrace = [
    ...sources.flatMap((source) => [
      {
        kind: "tool_call",
        tool: "read_file",
        args: { path: source },
        cached: false,
        prefetched: true,
      },
      {
        kind: "tool_result",
        tool: "read_file",
        source,
        cached: false,
        prefetched: true,
        resultKind: "ok",
      },
    ]),
    {
      kind: "evidence_integrity",
      code: "EVIDENCE_INTEGRITY_OK",
      consistent: true,
      violations: [],
      readAttempts: 2,
      uniqueFilesRead: 2,
      evidenceFileCount: 2,
      acceptedEvidenceCount: 2,
      acceptedClaimCount: 7,
      completedReadFiles: sources,
      retainedBodyFiles: sources,
      acceptedEvidenceFiles: sources,
      sourceCoverage: "COMPLETE",
      completionGateResult: "COMPLETE",
      finalAnswerType: "BEHAVIORAL_ANSWER",
      requiredEdges: [],
      provenEdges: [],
      scopeExpansions: [],
      unjustifiedReads: [],
    },
    {
      kind: "done",
      stopReason: "response",
      iterations: 1,
      maxIterations: 8,
      toolCalls: 2,
      prefetchToolCalls: 2,
      loopToolCalls: 0,
      synthesisStarted: false,
      diagnosticCodes: [],
    },
  ];
  const taskResult = {
    kind: "BEHAVIOR_ANSWER_RESULT",
    answer: {
      answer,
      evidence,
      confidence: 1,
      sourceScope: sources,
      coverage: {
        requestedFields: ["C1", "C2", "C3", "C4", "C5", "C6", "C7"],
        answeredFields: ["C1", "C2", "C3", "C4", "C5", "C6", "C7"],
        missingFields: [],
        complete: true,
      },
    },
  };
  const message = {
    id: messageId,
    sessionId,
    role: "assistant",
    content: answer,
    operationMode: "CHAT",
    sources,
    toolTrace: JSON.stringify(toolTrace),
    behaviorEvidence: evidence,
    taskResult,
    createdAt: "2026-01-01T00:02:00.000Z",
  };
  const sse = (event: Record<string, unknown>) =>
    `data: ${JSON.stringify(event)}\n\n`;
  const streamBody = [
    sse({ type: "session_started", sessionId }),
    sse({
      type: "execution_started",
      executionId: "e2e-capability-probe-execution",
      status: "running",
      resumable: false,
    }),
    sse({ type: "stage", stage: "building-context" }),
    sse({ type: "stage", stage: "calling-model" }),
    ...sources.flatMap((source) => [
      sse({
        type: "tool_call",
        tool: "read_file",
        args: { path: source },
        cached: false,
        prefetched: true,
      }),
      sse({
        type: "tool_result",
        tool: "read_file",
        source,
        cached: false,
        prefetched: true,
        resultKind: "ok",
      }),
    ]),
    sse({
      type: "evidence_integrity",
      code: "EVIDENCE_INTEGRITY_OK",
      consistent: true,
      violations: [],
      readAttempts: 2,
      uniqueFilesRead: 2,
      evidenceFileCount: 2,
      acceptedEvidenceCount: 2,
      acceptedClaimCount: 7,
      completedReadFiles: sources,
      retainedBodyFiles: sources,
      acceptedEvidenceFiles: sources,
      sourceCoverage: "COMPLETE",
      completionGateResult: "COMPLETE",
      finalAnswerType: "BEHAVIORAL_ANSWER",
      requiredEdges: [],
      provenEdges: [],
      scopeExpansions: [],
      unjustifiedReads: [],
    }),
    sse({ type: "delta", delta: answer }),
    sse({
      type: "done",
      sessionId,
      executionId: "e2e-capability-probe-execution",
      message,
      sources,
      toolTrace: JSON.stringify(toolTrace),
      behaviorEvidence: evidence,
      taskResult,
      pendingChanges: [],
    }),
  ].join("");

  return {
    question,
    answer,
    source: sources[0],
    sessionId,
    streamBody,
    message,
  };
}

function installToolFailureFixture(): ArabicAiFixture {
  const sessionId = "e2e-tool-failure-session";
  const messageId = "e2e-tool-failure-message";
  const source = "src/missing-release-fixture.ts";
  const question = "Which source file is available for the release check?";
  const answer =
    "ANALYSIS_INCOMPLETE: The required source read did not complete, so no verified result is available.";
  const diagnosticCode = "TOOL_EXECUTION_FAILED";
  const toolTrace = [
    {
      kind: "tool_call",
      tool: "read_file",
      args: { path: source },
      cached: false,
    },
    {
      kind: "tool_result",
      tool: "read_file",
      source,
      resultKind: "failed",
      diagnosticCode,
      resultSummary: "The required source read did not complete.",
    },
    {
      kind: "done",
      stopReason: "tool_failure",
      iterations: 1,
      maxIterations: 8,
      toolCalls: 1,
      prefetchToolCalls: 0,
      loopToolCalls: 1,
      synthesisStarted: false,
      diagnosticCodes: [diagnosticCode],
    },
  ];
  const message = {
    id: messageId,
    sessionId,
    role: "assistant",
    content: answer,
    toolTrace: JSON.stringify(toolTrace),
    createdAt: "2026-01-01T00:02:00.000Z",
  };
  const sse = (event: Record<string, unknown>) =>
    `data: ${JSON.stringify(event)}\n\n`;
  const streamBody = [
    sse({ type: "session_started", sessionId }),
    sse({
      type: "execution_started",
      executionId: "e2e-tool-failure-execution",
      status: "running",
      resumable: true,
    }),
    sse({
      type: "tool_call",
      tool: "read_file",
      args: { path: source },
      cached: false,
    }),
    sse({
      type: "tool_result",
      tool: "read_file",
      source,
      resultKind: "failed",
      diagnosticCode,
      resultSummary: "The required source read did not complete.",
    }),
    sse({ type: "delta", delta: answer }),
    sse({
      type: "done",
      sessionId,
      message,
      toolTrace: JSON.stringify(toolTrace),
      pendingChanges: [],
    }),
  ].join("");

  return {
    question,
    answer,
    source,
    sessionId,
    streamBody,
    message,
  };
}

function installIncompleteForensicFixture(): ArabicAiFixture {
  const sessionId = "e2e-incomplete-forensic-session";
  const executionId = "e2e-incomplete-forensic-execution";
  const source = "src/incomplete-audit.ts";
  const question = "Audit the incomplete source scope and report only verified evidence.";
  const answer = [
    "## 1) Executive Verdict",
    "ANALYSIS_INCOMPLETE — NOT PROVEN.",
    "",
    "## 2) Evidence Map",
    `The requested source scope could not be read completely: ${source}.`,
    "",
    "## 3) Findings",
    "No Finding is proven from the retained evidence.",
    "",
    "## 4) Repair Plan",
    "No repair phases are authorized for this incomplete audit.",
    "",
    "## 5) Validation Checklist",
    "Retry the bounded read before drawing a conclusion.",
    "",
    "## 6) Final Judgment",
    "ANALYSIS_INCOMPLETE — NOT PROVEN. Safe terminal reason: SOURCE_COVERAGE_INCOMPLETE. Next safe action: Retry the bounded read.",
  ].join("\n");
  const toolTrace = [
    {
      kind: "tool_call",
      tool: "read_file",
      args: { path: source },
      cached: false,
    },
    {
      kind: "tool_result",
      tool: "read_file",
      source,
      resultKind: "failed",
      diagnosticCode: "TOOL_EXECUTION_FAILED",
      resultSummary: "The required source read did not complete.",
    },
    {
      kind: "forensic_status",
      auditScope: "PRODUCTION",
      sourceCoverage: "PARTIAL",
      behavioralAssessment: "INCOMPLETE",
      findingStatus: "NOT_PROVEN",
      repairReadiness: "BLOCKED",
      productionReachability: "NOT_PROVEN",
      implementationFiles: 1,
      contextFiles: 0,
      generatedFiles: 0,
      effectiveRoot: "PROJECT_ROOT",
      projectRevision: "e2e-forensic-revision-1",
      completeReads: false,
      appliedBudget: {
        maxIterations: 8,
        maxToolCalls: 12,
        synthesisMaxAttempts: 2,
        synthesisTimeoutMs: 1500,
      },
      readStatuses: [{ path: source, status: "READ_FAILED" }],
      synthesisLifecycle: {
        started: false,
        attempted: false,
        timedOut: false,
        skipped: true,
      },
    },
    {
      kind: "forensic_terminal",
      terminalKind: "NO_EVIDENCE_FOUND",
    },
    {
      kind: "forensic_diagnostic",
      forensicDiagnostic: {
        version: "v1",
        verdict: "ANALYSIS_INCOMPLETE",
        reasonCode: "SOURCE_COVERAGE_INCOMPLETE",
        explanation: "The requested source scope could not be read completely.",
        unreadFileCount: 1,
        unreadFiles: [source],
        truncatedFileCount: 0,
        truncatedFiles: [],
        nextActionCode: "RETRY_READ",
        nextAction: "Retry the bounded read before drawing a conclusion.",
      },
    },
    {
      kind: "done",
      stopReason: "tool_failure",
      iterations: 1,
      maxIterations: 8,
      toolCalls: 1,
      prefetchToolCalls: 0,
      loopToolCalls: 1,
      synthesisStarted: false,
      diagnosticCodes: ["TOOL_EXECUTION_FAILED", "FORENSIC_REPORT_FALLBACK_EMITTED"],
    },
  ];
  const message = {
    id: "e2e-incomplete-forensic-message",
    sessionId,
    role: "assistant",
    content: answer,
    operationMode: "FORENSIC_AUDIT",
    sources: [source],
    toolTrace: JSON.stringify(toolTrace),
    createdAt: "2026-01-01T00:02:00.000Z",
  };
  const sse = (event: Record<string, unknown>) =>
    `data: ${JSON.stringify(event)}\n\n`;
  const streamBody = [
    sse({ type: "session_started", sessionId }),
    sse({
      type: "execution_started",
      executionId,
      status: "running",
      resumable: true,
    }),
    sse({ type: "tool_call", tool: "read_file", args: { path: source }, cached: false }),
    sse({
      type: "tool_result",
      tool: "read_file",
      source,
      resultKind: "failed",
      diagnosticCode: "TOOL_EXECUTION_FAILED",
      resultSummary: "The required source read did not complete.",
    }),
    sse({ type: "forensic_status", ...toolTrace[2] }),
    sse({ type: "forensic_terminal", terminalKind: "NO_EVIDENCE_FOUND" }),
    sse({ type: "delta", delta: answer }),
    sse({
      type: "done",
      sessionId,
      executionId,
      message,
      sources: [source],
      toolTrace: JSON.stringify(toolTrace),
      pendingChanges: [],
    }),
  ].join("");

  return {
    question,
    answer,
    source,
    sessionId,
    executionId,
    streamBody,
    message,
  };
}

function installAcceptanceIncompleteFixture(): ArabicAiFixture {
  const base = installIncompleteForensicFixture();
  const acceptanceDisposition = {
    reasonCodes: ["EXECUTION_ACCEPTANCE_INCOMPLETE"],
    outcome: "FAILED",
    failureKind: "INCOMPLETE",
    recoveryState: "INCOMPLETE",
    operatorAction: "START_NEW_RUN",
  } as const;
  const sse = (event: Record<string, unknown>) =>
    `data: ${JSON.stringify(event)}\n\n`;
  return {
    ...base,
    question: "Retry the proof-required run with mismatched evidence.",
    message: {
      ...base.message,
      content: "",
      outcome: "FAILED",
      errorCode: "EXECUTION_ACCEPTANCE_INCOMPLETE",
      errorMessage: "The acceptance evidence was not proven for this run.",
      failureKind: "INCOMPLETE",
      retryable: true,
      recoveryState: "INCOMPLETE",
      acceptanceDisposition,
    },
    streamBody: [
      sse({ type: "session_started", sessionId: base.sessionId }),
      sse({
        type: "execution_started",
        executionId: base.executionId,
        status: "running",
        resumable: true,
      }),
      sse({
        type: "error",
        executionId: base.executionId,
        sessionId: base.sessionId,
        code: "EXECUTION_ACCEPTANCE_INCOMPLETE",
        message: "The acceptance evidence was not proven for this run.",
        outcome: "FAILED",
        failureKind: "INCOMPLETE",
        retryable: true,
        recoveryState: "INCOMPLETE",
        acceptanceDisposition,
      }),
    ].join(""),
  };
}

function installCancelledForensicFixture(): ArabicAiFixture {
  const sessionId = "e2e-cancelled-forensic-session";
  const executionId = "e2e-cancelled-forensic-execution";
  const source = "src/cancelled-audit.ts";
  const question = "Audit the source and preserve the report if recovery is cancelled.";
  const answer = [
    "## 1) Executive Verdict",
    "ANALYSIS_INCOMPLETE — the audit was cancelled during recovery.",
    "",
    "## 2) Evidence Map",
    `Retained evidence from ${source} is preserved for the next attempt.`,
    "",
    "## 3) Findings",
    "No verified finding was established before cancellation.",
    "",
    "## 4) Repair Plan",
    "No repair phases are authorized for this incomplete audit.",
    "",
    "## 5) Validation Checklist",
    "No executable validation scenario is authorized for this incomplete audit.",
    "",
    "## 6) Final Judgment",
    "ANALYSIS_INCOMPLETE — Safe terminal reason: CANCELLED. Retry the audit before drawing a conclusion.",
  ].join("\n");
  const forensicDiagnostic = {
    version: "v1",
    verdict: "ANALYSIS_INCOMPLETE",
    reasonCode: "CANCELLED",
    explanation: "The audit was cancelled before recovery completed.",
    unreadFileCount: 1,
    unreadFiles: [source],
    truncatedFileCount: 0,
    truncatedFiles: [],
    nextActionCode: "RETRY_READ",
    nextAction: "Retry the bounded audit before drawing a conclusion.",
  };
  const toolTrace = [
    {
      kind: "tool_call",
      tool: "read_file",
      args: { path: source },
      cached: false,
      prefetched: true,
    },
    {
      kind: "tool_result",
      tool: "read_file",
      source,
      cached: false,
      prefetched: true,
      resultKind: "ok",
      resultSummary: "Retained source evidence before cancellation.",
    },
    {
      kind: "forensic_status",
      auditScope: "PRODUCTION",
      productionReachability: "NOT_PROVEN",
      sourceCoverage: "PARTIAL",
      behavioralAssessment: "INCOMPLETE",
      findingStatus: "NOT_PROVEN",
      repairReadiness: "BLOCKED",
      implementationFiles: 1,
      contextFiles: 0,
      generatedFiles: 0,
      requestedFiles: [source],
      effectiveRoot: "PROJECT_ROOT",
      projectRevision: "e2e-cancelled-forensic-revision-1",
      completeReads: false,
      readStatuses: [{ path: source, status: "READ_COMPLETE" }],
    },
    {
      kind: "forensic_recovery_start",
      attempt: 1,
    },
    {
      kind: "forensic_terminal",
      terminalKind: "NO_RESPONSE_RECOVERY_BLOCKED",
    },
    {
      kind: "forensic_diagnostic",
      forensicDiagnostic,
    },
    {
      kind: "done",
      stopReason: "cancelled",
      iterations: 2,
      maxIterations: 8,
      toolCalls: 1,
      prefetchToolCalls: 1,
      loopToolCalls: 0,
      synthesisStarted: true,
      recoveryStarted: true,
      diagnosticCodes: ["EXECUTION_CANCELLED"],
    },
  ];
  const message = {
    id: "e2e-cancelled-forensic-message",
    sessionId,
    role: "assistant",
    content: answer,
    operationMode: "FORENSIC_AUDIT",
    sources: [source],
    toolTrace: JSON.stringify(toolTrace),
    outcome: "INTERRUPTED",
    errorCode: "EXECUTION_CANCELLED",
    errorMessage: "Execution was cancelled before completion.",
    failureKind: "CANCELLATION",
    retryable: true,
    recoveryState: "INCOMPLETE",
    forensicDiagnostic,
    executionId,
    createdAt: "2026-01-01T00:02:00.000Z",
  };
  const sse = (event: Record<string, unknown>) =>
    `data: ${JSON.stringify(event)}\n\n`;
  const streamBody = [
    sse({ type: "session_started", sessionId }),
    sse({
      type: "execution_started",
      executionId,
      status: "running",
      resumable: true,
    }),
    sse({ type: "tool_call", tool: "read_file", args: { path: source }, cached: false, prefetched: true }),
    sse({
      type: "tool_result",
      tool: "read_file",
      source,
      cached: false,
      prefetched: true,
      resultKind: "ok",
      resultSummary: "Retained source evidence before cancellation.",
    }),
    sse({ type: "forensic_status", ...toolTrace[2] }),
    sse({ type: "forensic_recovery_start", attempt: 1 }),
    sse({ type: "forensic_terminal", terminalKind: "NO_RESPONSE_RECOVERY_BLOCKED" }),
    sse({ type: "forensic_diagnostic", forensicDiagnostic }),
    sse({ type: "delta", delta: answer }),
    sse({
      type: "done",
      sessionId,
      executionId,
      message,
      sources: [source],
      toolTrace: JSON.stringify(toolTrace),
      pendingChanges: [],
    }),
  ].join("");

  return {
    question,
    answer,
    source,
    sessionId,
    executionId,
    streamBody,
    message,
  };
}

function installDisconnectedAiFixture(): ArabicAiFixture {
  const sessionId = "e2e-disconnected-ai-session";
  const executionId = "e2e-disconnected-ai-execution";
  const question =
    "What happens when the model disconnects after starting an answer?";
  const answer =
    "The model started an answer, but the provider disconnected before completion.";
  const diagnosticCode = "EXECUTION_PROVIDER_FAILURE";
  const toolTrace = [
    {
      kind: "done",
      stopReason: "provider_timeout",
      iterations: 1,
      maxIterations: 8,
      toolCalls: 0,
      prefetchToolCalls: 0,
      loopToolCalls: 0,
      synthesisStarted: false,
      diagnosticCodes: [diagnosticCode],
      diagnosticDetails: [
        "The provider disconnected after visible response text.",
      ],
    },
  ];
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
    createdAt: "2026-01-01T00:02:00.000Z",
  };
  const sse = (event: Record<string, unknown>) =>
    `data: ${JSON.stringify(event)}\n\n`;
  const streamBody = [
    sse({ type: "session_started", sessionId }),
    sse({
      type: "execution_started",
      executionId,
      status: "running",
      resumable: true,
    }),
    sse({ type: "stage", stage: "calling-model" }),
    sse({ type: "delta", delta: answer }),
    // The real route emits this after a provider disconnect so the client
    // drops the transient bubble before rendering the persisted result.
    sse({ type: "stream_reset" }),
    sse({
      type: "done",
      sessionId,
      executionId,
      message,
      pendingChanges: [],
    }),
  ].join("");

  return {
    question,
    answer,
    source: "provider",
    sessionId,
    executionId,
    streamBody,
    message,
  };
}

function installInterruptedAiFixture(): ArabicAiFixture {
  const sessionId = "e2e-interrupted-ai-session";
  const executionId = "e2e-interrupted-ai-execution";
  const question =
    "What remains visible when the request is cancelled after starting an answer?";
  const answer =
    "The request confirmed the initial scope before cancellation.";
  const diagnosticCode = "EXECUTION_CANCELLED";
  const toolTrace = [
    {
      kind: "done",
      stopReason: "cancelled",
      iterations: 1,
      maxIterations: 8,
      toolCalls: 0,
      prefetchToolCalls: 0,
      loopToolCalls: 0,
      synthesisStarted: false,
      diagnosticCodes: [diagnosticCode],
      diagnosticDetails: [
        "Cancellation stopped the response after visible text was retained.",
      ],
    },
  ];
  const message = {
    id: "e2e-interrupted-ai-message",
    sessionId,
    role: "assistant",
    content: answer,
    toolTrace: JSON.stringify(toolTrace),
    outcome: "INTERRUPTED",
    failureKind: "CANCELLATION",
    errorCode: diagnosticCode,
    errorMessage: "Execution was cancelled before completion.",
    executionId,
    createdAt: "2026-01-01T00:02:00.000Z",
  };
  const sse = (event: Record<string, unknown>) =>
    `data: ${JSON.stringify(event)}\n\n`;
  const streamBody = [
    sse({ type: "session_started", sessionId }),
    sse({
      type: "execution_started",
      executionId,
      status: "running",
      resumable: false,
    }),
    sse({ type: "stage", stage: "calling-model" }),
    sse({ type: "delta", delta: answer }),
    sse({ type: "stream_reset" }),
    sse({
      type: "done",
      sessionId,
      executionId,
      message,
      pendingChanges: [],
    }),
  ].join("");

  return {
    question,
    answer,
    source: "provider",
    sessionId,
    executionId,
    streamBody,
    message,
  };
}

function installResumedAnalysisFailureFixture() {
  const sessionId = "e2e-resumed-analysis-failure-session";
  const executionId = "e2e-resumed-analysis-failure-execution";
  const resumeToken = "e2e-resumed-analysis-failure-token-opaque";
  const question = "Verify the analysis evidence after reconnect.";
  const answer =
    "ANALYSIS_INCOMPLETE: The required analysis did not complete, so no verified result is available.";
  const diagnosticCode = "TOOL_UNAVAILABLE";
  const sse = (event: Record<string, unknown>) =>
    `data: ${JSON.stringify(event)}\n\n`;
  const streamBody = [
    sse({ type: "session_started", sessionId }),
    sse({
      type: "execution_started",
      executionId,
      status: "running",
      resumable: true,
      resumeToken,
    }),
    sse({
      type: "error",
      executionId,
      code: diagnosticCode,
      message: "The required analysis did not complete.",
    }),
  ].join("");
  const fixture: ArabicAiFixture = {
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
      createdAt: "2026-01-01T00:02:00.000Z",
    },
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
        detail: "The required analysis tool was unavailable.",
      },
      objective: { objective: question },
      error: "The required analysis did not complete.",
      startedAt: "2026-01-01T00:01:00.000Z",
      createdAt: "2026-01-01T00:01:00.000Z",
      updatedAt: "2026-01-01T00:02:00.000Z",
    },
  };
}

function installInterruptedResumeFixture() {
  const sessionId = "e2e-interrupted-resume-session";
  const executionId = "e2e-interrupted-resume-execution";
  const initialToken = "e2e-interrupted-initial-token";
  const recoveredToken = "e2e-interrupted-recovered-token";
  const question = "Continue the interrupted release execution.";
  const partialAnswer =
    "The release execution started before the browser disconnected.";
  const answer =
    "The original release execution resumed after capability recovery.";
  const source = "src/release-resume.ts";
  const toolTrace = [
    {
      kind: "tool_call",
      tool: "read_file",
      args: { path: source },
      cached: false,
      prefetched: true,
    },
    {
      kind: "tool_result",
      tool: "read_file",
      source,
      cached: false,
      prefetched: true,
      resultKind: "success",
      resultSummary: "Completed source read retained for the resumed execution.",
    },
    {
      kind: "forensic_status",
      auditScope: "FIXTURE_LOCAL",
      isFixtureLocal: true,
      productionReachability: "NOT_PROVEN",
      sourceCoverage: "COMPLETE",
      behavioralAssessment: "COMPLETE",
      findingStatus: "PROVEN",
      repairReadiness: "BLOCKED",
      requestedFiles: [source],
      reason: "The resumed fixture retains one complete source-backed evidence packet.",
    },
    {
      kind: "evidence_integrity",
      code: "EVIDENCE_INTEGRITY_OK",
      consistent: true,
      violations: [],
      readAttempts: 1,
      uniqueFilesRead: 1,
      evidenceFileCount: 1,
      acceptedEvidenceCount: 1,
      acceptedClaimCount: 1,
      completedReadFiles: [source],
      retainedBodyFiles: [source],
      acceptedEvidenceFiles: [source],
      objectiveType: "BEHAVIORAL_QUERY",
      requiredEdges: [],
      provenEdges: [],
      completionGateResult: "PROVEN",
      finalAnswerType: "BEHAVIORAL_ANSWER",
      evidenceSourceCoverage: {
        status: "COMPLETE",
        requestedFiles: [source],
        roots: [
          {
            root: source,
            discoveredFiles: 1,
            readFiles: 1,
            unreadFiles: 0,
            status: "COMPLETE",
          },
        ],
      },
    },
    {
      kind: "done",
      stopReason: "response",
      iterations: 1,
      maxIterations: 4,
      toolCalls: 1,
      prefetchToolCalls: 1,
      loopToolCalls: 0,
      synthesisStarted: true,
      recoveryStarted: true,
      diagnosticCodes: [],
    },
  ];
  const message = {
    id: "e2e-interrupted-resume-message",
    sessionId,
    role: "assistant",
    content: answer,
    executionId,
    outcome: "COMPLETED",
    operationMode: "FORENSIC_AUDIT",
    sources: [source],
    toolTrace: JSON.stringify(toolTrace),
    createdAt: "2026-01-01T00:03:00.000Z",
  };
  const sse = (event: Record<string, unknown>) =>
    `data: ${JSON.stringify(event)}\n\n`;
  const fixture: ArabicAiFixture = {
    question,
    answer,
    source,
    sessionId,
    executionId,
    streamBody: [
      sse({ type: "session_started", sessionId }),
      sse({
        type: "execution_started",
        executionId,
        status: "running",
        resumable: true,
        resumeToken: initialToken,
      }),
      sse({ type: "stage", stage: "calling-model" }),
      sse({ type: "delta", delta: partialAnswer }),
    ].join(""),
    message,
  };
  return {
    fixture,
    initialToken,
    recoveredToken,
    resumedStreamBody: [
      sse({ type: "session_started", sessionId }),
      sse({
        type: "execution_started",
        executionId,
        status: "running",
        resumable: true,
        resumeToken: recoveredToken,
      }),
      sse({ type: "stage", stage: "resuming-checkpoint" }),
      sse({ type: "delta", delta: answer }),
      sse({
        type: "done",
        sessionId,
        executionId,
        message,
        sources: [source],
        toolTrace: JSON.stringify(toolTrace),
        pendingChanges: [],
      }),
    ].join(""),
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
        detail:
          "The browser transport disconnected after the execution started.",
      },
      objective: { objective: question },
      startedAt: "2026-01-01T00:01:00.000Z",
      createdAt: "2026-01-01T00:01:00.000Z",
      updatedAt: "2026-01-01T00:02:00.000Z",
    },
  };
}

async function createReleaseSignInUrl(page: Page) {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) {
    throw new Error(
      "CLERK_SECRET_KEY is required for the release-only programmatic Clerk handoff.",
    );
  }

  const headers = {
    Authorization: `Bearer ${secretKey}`,
    "Content-Type": "application/json",
  };
  const userResponse = await page.request.get(
    `https://api.clerk.com/v1/users?email_address=${encodeURIComponent(TEST_USER.email)}`,
    { headers },
  );
  let userId = parseClerkUserLookupResponse(await userResponse.json());

  if (!userId) {
    const createdResponse = await page.request.post(
      "https://api.clerk.com/v1/users",
      {
        headers,
        data: {
          email_address: [TEST_USER.email],
          first_name: TEST_USER.firstName,
          last_name: TEST_USER.lastName,
          skip_password_checks: true,
          skip_password_requirement: true,
        },
      },
    );
    userId = parseCreatedClerkUserResponse(await createdResponse.json());
  }

  if (!userId) {
    throw new Error(
      "The isolated Clerk release user could not be provisioned.",
    );
  }

  const tokenResponse = await page.request.post(
    "https://api.clerk.com/v1/sign_in_tokens",
    { headers, data: { user_id: userId } },
  );
  const token = parseClerkSignInTokenResponse(await tokenResponse.json());

  return `${new URL(DASHBOARD_PATH, page.url()).toString()}sign-in?__clerk_ticket=${encodeURIComponent(token)}`;
}

async function navigateClerkHandoff(page: Page, url: string): Promise<void> {
  try {
    // Clerk consumes the ticket and replaces this document. Waiting only for
    // the initial commit avoids treating that expected replacement as a
    // failed page load.
    await page.goto(url, { waitUntil: "commit" });
  } catch (error) {
    if (!isClerkHandoffNavigationAbort(error)) throw error;
  }
}

async function navigateBrowserHistory(
  page: Page,
  direction: "back" | "forward",
): Promise<void> {
  try {
    await (direction === "back" ? page.goBack : page.goForward).call(page, {
      waitUntil: "commit",
    });
  } catch (error) {
    if (!isClerkHandoffNavigationAbort(error)) throw error;
  }
}

async function programmaticSignIn(page: Page) {
  const signInLink = page.getByRole("link", { name: "Sign In", exact: true });
  let signInLoaded = false;
  for (let attempt = 0; attempt < 3 && !signInLoaded; attempt += 1) {
    await page.goto(DASHBOARD_PATH);
    try {
      await expect(signInLink).toBeVisible({ timeout: 5_000 });
      signInLoaded = true;
    } catch (error) {
      if (attempt === 2) throw error;
      await page.waitForTimeout(250);
    }
  }

  const helper =
    globalThis.signInClerkUser ??
    globalThis.__ENGINEERINGOS_SIGN_IN_CLERK_USER__;
  if (!helper) {
    if (process.env.RUN_CONTROLLED_RELEASE_VALIDATION !== "1") {
      throw new Error(
        "Clerk browser helper is unavailable. Run this journey in the Replit browser runner, which injects signInClerkUser.",
      );
    }
    await navigateClerkHandoff(page, await createReleaseSignInUrl(page));
    await expect(page).toHaveURL(
      new RegExp(`${DASHBOARD_PATH.replaceAll("/", "\\/")}$`),
    );
    await completeReadinessHandshake(page);
    return;
  }
  const signInUrl = await helper({
    ...TEST_USER,
    ttl: 900,
    basePath: DASHBOARD_PATH,
  });
  await navigateClerkHandoff(page, signInUrl);
  await expect(page).toHaveURL(
    new RegExp(`${DASHBOARD_PATH.replaceAll("/", "\\/")}$`),
  );
  await completeReadinessHandshake(page);
}

async function completeReadinessHandshake(page: Page): Promise<void> {
  const mode = dashboardTestMode();
  if (!TEST_MODES.has(mode)) {
    await writeReadinessReceipt("blocked", {
      mode: { status: "blocked", reason: "unsupported_test_mode" },
    });
    throw new Error(`BLOCKED: unsupported dashboard test mode (${mode}).`);
  }
  if (mode === "live-provider") {
    if (process.env.DASHBOARD_E2E_LIVE_PROVIDER !== "1") {
      await writeReadinessReceipt("blocked", {
        mode: { status: "ready" },
        provider: { status: "blocked", reason: "live_provider_not_enabled" },
      });
      throw new Error(
        "BLOCKED: live-provider mode requires DASHBOARD_E2E_LIVE_PROVIDER=1.",
      );
    }
    if (process.env.DASHBOARD_E2E_LIVE_DISPOSABLE !== "1") {
      await writeReadinessReceipt("blocked", {
        mode: { status: "ready" },
        provider: { status: "ready" },
        disposableProject: {
          status: "blocked",
          reason: "disposable_project_required",
        },
      });
      throw new Error(
        "BLOCKED: live-provider mode requires an explicitly disposable project.",
      );
    }
  }

  const deadline = Date.now() + readinessTimeoutMs();
  let lastStatus = "not attempted";
  const checks: Record<string, unknown> = {
    mode: { status: "ready" },
    provider: {
      status: mode === "live-provider" ? "ready" : "ready",
      ...(mode === "fixture" ? { reason: "provider_free_fixture" } : {}),
    },
    disposableProject: {
      status: mode === "live-provider" ? "ready" : "ready",
      ...(mode === "fixture" ? { reason: "browser_fixture_project" } : {}),
    },
  };
  while (Date.now() < deadline) {
    try {
      await expectDashboardReady(page);
      const readiness = await page.evaluate(async (url) => {
        const response = await fetch(url, { credentials: "include" });
        return {
          ok: response.ok,
          body: (await response.json().catch(() => ({}))) as {
            status?: string;
            checks?: Record<string, { status?: string }>;
          },
        };
      }, new URL("/api/readiness", page.url()).toString());
      const readinessBody = readiness.body as {
        status?: string;
        checks?: Record<string, { status?: string }>;
      };
      checks.api = { status: readiness.ok ? "ready" : "blocked" };
      checks.database = readinessBody.checks?.database ?? { status: "blocked" };
      checks.schema = readinessBody.checks?.schema ?? { status: "blocked" };
      if (
        readiness.ok &&
        readinessBody.status === "ready" &&
        Object.values(readinessBody.checks ?? {}).every(
          (check) => check.status === "ready",
        )
      ) {
        const projectsResult = await page.evaluate(async (url) => {
          const response = await fetch(url, { credentials: "include" });
          return {
            ok: response.ok,
            body: (await response.json().catch(() => [])) as Array<{
              id?: string;
            }>,
          };
        }, new URL("/api/projects", page.url()).toString());
        const projects = projectsResult.body;
        const expectedProject =
          mode === "live-provider"
            ? process.env.DASHBOARD_E2E_LIVE_PROJECT_ID
            : undefined;
        const fixtureProjectReady =
          mode === "fixture"
            ? projects.length > 0 && projects.every((project) => Boolean(project.id))
            : projects.some((project) => project.id === expectedProject);
        if (
          projectsResult.ok &&
          Array.isArray(projects) &&
          fixtureProjectReady
        ) {
          checks.auth = { status: "ready" };
          checks.fixtureProject = {
            status: "ready",
            project: expectedProject ?? projects[0]?.id,
          };
          await writeReadinessReceipt("ready", checks);
          return;
        }
        lastStatus = "fixture project unavailable";
      } else {
        lastStatus =
          readinessBody.checks &&
          Object.entries(readinessBody.checks)
            .filter(([, check]) => check.status !== "ready")
            .map(([name]) => name)
            .join(", ");
        if (!lastStatus) lastStatus = "readiness blocked";
      }
    } catch {
      lastStatus = "readiness request failed";
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  await writeReadinessReceipt("blocked", checks, lastStatus);
  throw new Error(
    `BLOCKED: dashboard readiness handshake did not complete (${lastStatus}).`,
  );
}

async function openNavigation(page: Page, label: string, path: string) {
  await page.getByRole("link", { name: label, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${path.replaceAll("/", "\\/")}$`));
}

function apiUrl(page: Page, path: string): string {
  const apiBaseUrl = process.env.DASHBOARD_E2E_API_BASE_URL;
  return new URL(path, apiBaseUrl ? apiBaseUrl : page.url()).toString();
}

async function liveRequest(
  page: Page,
  path: string,
  options?: { method?: string; body?: unknown; timeout?: number },
): Promise<{ status: number; body: string }> {
  return page.evaluate(
    async ({ url, method, body, timeout }) => {
      const response = await fetch(url, {
        method,
        credentials: "include",
        headers:
          body === undefined
            ? undefined
            : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: timeout ? AbortSignal.timeout(timeout) : undefined,
      });
      return { status: response.status, body: await response.text() };
    },
    {
      url: apiUrl(page, path),
      method: options?.method ?? "GET",
      body: options?.body,
      timeout: options?.timeout,
    },
  );
}

type OriginDiagnostic = {
  origin: string;
  phase: "GET" | "preflight" | "mutation" | "rejection";
  status?: number;
  headers?: Record<string, string>;
  error?: string;
};
const recordedOriginDiagnostics: OriginDiagnostic[] = [];

function originDiagnosticPath(): string | undefined {
  return process.env.DASHBOARD_E2E_ORIGIN_DIAGNOSTICS_PATH;
}

function relevantOriginHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    ORIGIN_DIAGNOSTIC_HEADERS.flatMap((name) =>
      headers[name] ? [[name, headers[name]]] : [],
    ),
  );
}

async function writeOriginDiagnostics() {
  const outputPath = originDiagnosticPath();
  if (!outputPath) return;
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(
    outputPath,
    `${JSON.stringify({ diagnostics: recordedOriginDiagnostics }, null, 2)}\n`,
    "utf8",
  );
}

async function expectOriginCanUseApi(page: Page, origin: string) {
  const apiBaseUrl = process.env.DASHBOARD_E2E_API_BASE_URL;
  if (!apiBaseUrl) {
    throw new Error(
      "DASHBOARD_E2E_API_BASE_URL is required for origin checks.",
    );
  }
  const healthUrl = new URL("/api/healthz", apiBaseUrl).toString();
  const mutationUrl = new URL("/api/ai/chat", apiBaseUrl).toString();
  const commonHeaders = { Origin: origin };

  const diagnostics: OriginDiagnostic[] = [];
  const check = async (
    phase: OriginDiagnostic["phase"],
    request: () => Promise<import("@playwright/test").APIResponse>,
    assertion: (
      response: import("@playwright/test").APIResponse,
    ) => Promise<void>,
  ) => {
    try {
      const response = await request();
      diagnostics.push({
        origin,
        phase,
        status: response.status(),
        headers: relevantOriginHeaders(response.headers()),
      });
      recordedOriginDiagnostics.push(diagnostics.at(-1)!);
      await assertion(response);
    } catch (error) {
      const current = diagnostics.at(-1);
      if (current?.phase !== phase) {
        diagnostics.push({ origin, phase });
      }
      diagnostics.at(-1)!.error = "origin check failed";
      await writeOriginDiagnostics();
      throw error;
    }
  };

  await check(
    "GET",
    () => page.request.get(healthUrl, { headers: commonHeaders }),
    async (response) => {
      expect(response.status(), `${origin} credentialed GET status`).toBe(200);
      expect(response.headers()["access-control-allow-origin"]).toBe(origin);
      expect(response.headers()["access-control-allow-credentials"]).toBe(
        "true",
      );
    },
  );
  await check(
    "preflight",
    () =>
      page.request.fetch(mutationUrl, {
        method: "OPTIONS",
        headers: {
          ...commonHeaders,
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "content-type",
        },
      }),
    async (response) => {
      expect(response.status(), `${origin} mutation preflight status`).toBe(
        204,
      );
      expect(response.headers()["access-control-allow-origin"]).toBe(origin);
      expect(
        response.headers()["access-control-allow-credentials"],
        `${origin} mutation preflight credentials`,
      ).toBe("true");
      expect(
        response
          .headers()
          ["access-control-allow-methods"]?.split(",")
          .map((method) => method.trim().toUpperCase()),
        `${origin} mutation preflight methods`,
      ).toContain("POST");
      expect(
        response
          .headers()
          ["access-control-allow-headers"]?.split(",")
          .map((header) => header.trim().toLowerCase()),
        `${origin} mutation preflight headers`,
      ).toContain("content-type");
    },
  );
  await check(
    "mutation",
    () =>
      page.request.post(mutationUrl, {
        headers: { ...commonHeaders, "Content-Type": "application/json" },
        data: { message: "origin contract" },
      }),
    async (response) => {
      expect(
        response.status(),
        `${origin} state-changing request must pass origin protection`,
      ).not.toBe(403);
      expect(response.headers()["access-control-allow-origin"]).toBe(origin);
      expect(response.headers()["access-control-allow-credentials"]).toBe(
        "true",
      );
    },
  );
  await writeOriginDiagnostics();
}

async function expectHostileOriginRejected(page: Page) {
  const apiBaseUrl = process.env.DASHBOARD_E2E_API_BASE_URL;
  if (!apiBaseUrl)
    throw new Error(
      "DASHBOARD_E2E_API_BASE_URL is required for origin checks.",
    );
  const mutationUrl = new URL("/api/ai/chat", apiBaseUrl).toString();
  const uploadUrl = new URL("/api/upload/archive", apiBaseUrl).toString();
  const liveUpdateUrl = new URL("/api/ai/chat/stream", apiBaseUrl).toString();
  const diagnostic: OriginDiagnostic = {
    origin: HOSTILE_ORIGIN,
    phase: "rejection",
  };
  recordedOriginDiagnostics.push(diagnostic);
  try {
    const response = await page.request.post(mutationUrl, {
      headers: {
        Origin: HOSTILE_ORIGIN,
        "Content-Type": "application/json",
      },
      data: { message: "hostile origin contract" },
    });
    diagnostic.status = response.status();
    diagnostic.headers = relevantOriginHeaders(response.headers());
    expect(response.status()).toBe(403);
    expect(response.headers()["access-control-allow-origin"]).toBeUndefined();
    expect(
      response.headers()["access-control-allow-credentials"],
    ).toBeUndefined();

    const hostileUpload = await page.request.post(uploadUrl, {
      headers: { Origin: HOSTILE_ORIGIN },
      multipart: {
        archive: {
          name: "hostile-dashboard-journey.zip",
          mimeType: "application/zip",
          buffer: Buffer.from("not an archive"),
        },
      },
    });
    expect(hostileUpload.status()).toBe(403);
    expect(
      hostileUpload.headers()["access-control-allow-origin"],
    ).toBeUndefined();

    const hostileLiveUpdate = await page.request.post(liveUpdateUrl, {
      headers: {
        Origin: HOSTILE_ORIGIN,
        "Content-Type": "application/json",
      },
      data: {},
    });
    expect(hostileLiveUpdate.status()).toBe(403);
    expect(
      hostileLiveUpdate.headers()["access-control-allow-origin"],
    ).toBeUndefined();
  } catch (error) {
    diagnostic.error = "origin rejection check failed";
    await writeOriginDiagnostics();
    throw error;
  }
  await writeOriginDiagnostics();
}

function parseSse(body: string): Array<Record<string, unknown>> {
  return body.split(/\n\n+/).flatMap((chunk) => {
    const data = chunk
      .split("\n")
      .find((line) => line.startsWith("data: "))
      ?.slice("data: ".length);
    if (!data) return [];
    try {
      const value = JSON.parse(data) as unknown;
      return value && typeof value === "object"
        ? [value as Record<string, unknown>]
        : [];
    } catch {
      return [];
    }
  });
}

async function liveJson(
  page: Page,
  path: string,
): Promise<Record<string, any>> {
  const response = await liveRequest(page, path);
  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      `Live correlation request failed: ${path} (${response.status})`,
    );
  }
  return JSON.parse(response.body) as Record<string, any>;
}

async function liveArray(
  page: Page,
  path: string,
): Promise<Array<Record<string, any>>> {
  const response = await liveRequest(page, path);
  if (response.status === 404) return [];
  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      `Live correlation request failed: ${path} (${response.status})`,
    );
  }
  const value = JSON.parse(response.body);
  return Array.isArray(value) ? value : [];
}

async function liveOptionalRecord(
  page: Page,
  path: string,
): Promise<Record<string, any> | undefined> {
  const response = await liveRequest(page, path);
  if (response.status === 404) return undefined;
  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      `Live correlation request failed: ${path} (${response.status})`,
    );
  }
  const value = JSON.parse(response.body);
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : undefined;
}

test.describe("EngineeringOS dashboard browser journey", () => {
  test("exports one redacted live-provider mission correlation report", async ({
    page,
  }) => {
    // The Playwright deadline must leave room for the provider-bound request
    // and polling loop to consume their complete configured budget.
    test.setTimeout(liveTimeoutMs() + LIVE_TEST_TIMEOUT_MARGIN_MS);
    test.skip(
      process.env.DASHBOARD_E2E_LIVE_PROVIDER !== "1",
      "Live-provider release journey is opt-in.",
    );
    if (process.env.DASHBOARD_E2E_LIVE_DISPOSABLE !== "1") {
      throw new Error(
        "Live-provider journey requires DASHBOARD_E2E_LIVE_DISPOSABLE=1 and a disposable project.",
      );
    }
    const campaignScenario = liveCampaignScenario();
    const projectId = process.env.DASHBOARD_E2E_LIVE_PROJECT_ID;
    if (!projectId)
      throw new Error(
        "DASHBOARD_E2E_LIVE_PROJECT_ID is required for the live-provider journey.",
      );

    await programmaticSignIn(page);
    const streamResponse = await liveRequest(page, "/api/ai/chat/stream", {
      method: "POST",
      timeout: liveTimeoutMs(),
      body: {
        projectId,
         message: livePrompt(),
        idempotencyKey: `dashboard-live-${Date.now()}`,
      },
    });
    if (streamResponse.status < 200 || streamResponse.status >= 300) {
      throw new Error(
        `Live-provider mission failed to start (${streamResponse.status}).`,
      );
    }
    const sseEvents = parseSse(streamResponse.body);
    const started = sseEvents.find(
      (event) => event.type === "execution_started",
    );
    const executionId =
      typeof started?.executionId === "string"
        ? started.executionId
        : undefined;
    if (!executionId)
      throw new Error("Live-provider stream did not emit execution_started.");
    const terminalDone = sseEvents.find((event) => event.type === "done");
    const terminalMessage =
      terminalDone?.message &&
      typeof terminalDone.message === "object" &&
      !Array.isArray(terminalDone.message)
        ? (terminalDone.message as Record<string, unknown>)
        : undefined;
    if (
      !terminalDone ||
      terminalMessage?.executionId !== executionId
    ) {
      throw new Error(
        "Live-provider stream did not emit a terminal done event for its execution.",
      );
    }

    let execution: Record<string, any> = {};
    const deadline = Date.now() + liveTimeoutMs();
    while (Date.now() < deadline) {
      execution = await liveJson(page, `/api/ai/executions/${executionId}`);
      if (
        ["completed", "failed", "cancelled"].includes(String(execution.status))
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
    if (
      !["completed", "failed", "cancelled"].includes(String(execution.status))
    ) {
      throw new Error(
        "Live-provider mission did not reach a terminal state within its bound.",
      );
    }

    const sessionId = String(execution.sessionId);
    const messages = await liveArray(
      page,
      `/api/ai/chat/${sessionId}/messages`,
    );
    const events = await liveArray(
      page,
      `/api/events?projectId=${encodeURIComponent(projectId)}&correlationId=${encodeURIComponent(String(execution.operationId ?? ""))}`,
    );
    const proposal = await liveOptionalRecord(
      page,
      `/api/ai/chat/${sessionId}/pending-proposal`,
    );
    const gitLog = await liveJson(page, `/api/projects/${projectId}/git/log`);
    const missionControl = await liveJson(page, "/api/ai/mission-control");
    const dashboardState = await liveJson(page, "/api/dashboard");
    const checkpoint =
      execution.checkpoint && typeof execution.checkpoint === "object"
        ? (execution.checkpoint as Record<string, any>)
        : {};
    const recentSteps = Array.isArray(checkpoint.recentSteps)
      ? checkpoint.recentSteps
      : [];
    const validation = recentSteps.filter(
      (step) => step?.kind === "validation",
    );
    const projectRevision =
      typeof execution.projectRevision === "string"
        ? execution.projectRevision
        : undefined;
    const candidateHash = validation
      .map((step) => step?.validation?.candidateHash ?? step?.candidateHash)
      .find((value): value is string => typeof value === "string" && value.length > 0);
    const candidateIdentity =
      typeof execution.candidateIdentity === "string"
        ? execution.candidateIdentity
        : candidateHash
          ? `candidate:${candidateHash}`
          : `read-only:${projectRevision ?? "unknown"}`;
    if (!projectRevision) {
      throw new Error("Live-provider mission is missing its project revision.");
    }
    if (
      process.env.DASHBOARD_E2E_LIVE_CAMPAIGN === "1" &&
      (!candidateIdentity || !projectRevision)
    ) {
      throw new Error("Live campaign requires operation, revision, and candidate correlation.");
    }
    const evidenceCount = recentSteps.reduce(
      (count, step) => count + (Number(step?.acceptedEvidenceCount) || 0),
      0,
    );
    const terminalState = String(
      execution.flightState ?? execution.status,
    ).toUpperCase();
    const successStates = new Set([
      "COMPLETED",
      "READY_FOR_REVIEW",
      "APPLIED",
      "COMMITTED",
      "PUSHED",
    ]);
    if (
      campaignScenario === "delivery-success" &&
      successStates.has(terminalState) &&
      !candidateHash
    ) {
      throw new Error(
        "Delivery-success campaign cannot pass without a candidate-bound validation hash.",
      );
    }
    const deliveryStages = {
      applied: events.some((event) => event?.type === "AiChangesApplied"),
      committed: events.some((event) => event?.type === "GitCommitCreated"),
      pushed: events.some((event) => event?.type === "GitPushed"),
    };
    if (
      campaignScenario === "delivery-success" &&
      successStates.has(terminalState) &&
      !Object.values(deliveryStages).every(Boolean)
    ) {
      throw new Error(
        "Delivery-success campaign cannot pass without operation-correlated apply, commit, and push evidence.",
      );
    }
    if (
      successStates.has(terminalState) &&
      (evidenceCount < 1 || validation.length < 1)
    ) {
      throw new Error(
        `Live-provider mission reported ${terminalState} without accepted evidence and validation ` +
          `(evidence=${evidenceCount}, validation=${validation.length}).`,
      );
    }
    const capture = {
      projectId,
      sessionId,
      operationId: execution.operationId,
      workspaceRevision:
        gitLog.commits?.[0]?.shortHash ??
        gitLog.commits?.[0]?.hash?.slice(0, 12),
      projectRevision,
      candidateIdentity,
      candidateRevision: projectRevision,
      campaignScenario,
      deliveryStages,
      currentOperation: {
        operationId: execution.operationId,
        revision: projectRevision,
        status: execution.status,
        terminalState,
      },
      retainedResult:
        terminalState === "FAILED" || terminalState === "BLOCKED" || terminalState === "INCOMPLETE"
          ? {
              operationId: execution.operationId,
              revision: projectRevision,
              label: "retained result from the current failed or incomplete operation",
            }
          : undefined,
      terminalState,
      execution: {
        id: execution.id,
        projectId: execution.projectId,
        sessionId: execution.sessionId,
        operationId: execution.operationId,
        status: execution.status,
        flightState: execution.flightState,
      },
      messages: messages.map(
        ({
          id,
          sessionId: messageSession,
          role,
          executionId: messageExecution,
          outcome,
        }) => ({
          id,
          sessionId: messageSession,
          role,
          executionId: messageExecution,
          outcome,
        }),
      ),
      sseEvents: sseEvents.map(
        ({
          type,
          executionId: eventExecution,
          sessionId: eventSession,
          outcome,
          code,
        }) => ({
          type,
          executionId: eventExecution,
          sessionId: eventSession,
          outcome,
          code,
        }),
      ),
      checkpoints: [
        {
          sequence: checkpoint.sequence,
          stage: checkpoint.stage,
          updatedAt: checkpoint.updatedAt,
        },
      ],
      evidenceCount,
      proposals: proposal
        ? [
            {
              id: proposal.id,
              revision: proposal.revision,
              status: proposal.status,
            },
          ]
        : [],
      validation: validation.map((step) => ({
        status: step.validation?.status ?? step.status,
        profile: step.validation?.profile ?? step.validationProfile,
      })),
      events: events.map(({ type, severity, correlationId }) => ({
        type,
        severity,
        correlationId,
      })),
      dashboard: missionControl,
      dashboardState: {
        projectCount: dashboardState.projectCount,
        activeTaskCount: dashboardState.activeTaskCount,
      },
    };
    const outputPath =
      process.env.DASHBOARD_E2E_LIVE_REPORT_PATH ??
      "test-results/dashboard-journey/live-mission-correlation.json";
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(
      outputPath,
      `${JSON.stringify(capture, null, 2)}\n`,
      "utf8",
    );
  });

  test("signs in and traverses the authenticated operational shell", async ({
    page,
  }) => {
    await installApiFixtures(page);
    await programmaticSignIn(page);
    for (const origin of approvedDashboardOrigins()) {
      await expectOriginCanUseApi(page, origin);
    }
    await expectHostileOriginRejected(page);

    await expect(
      page.getByRole("heading", { name: "System Overview" }),
    ).toBeVisible();
    await expect(
      page.getByText("SYSTEM ONLINE", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Smoke Project", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText("Dashboard API fixture ready", { exact: true }),
    ).toBeVisible();
    await openNavigation(page, "Projects", `${DASHBOARD_PATH}projects`);
    await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
    await expect(
      page.getByText("Smoke Project", { exact: true }),
    ).toBeVisible();

    await openNavigation(page, "Event Stream", `${DASHBOARD_PATH}events`);
    await expect(
      page.getByRole("heading", { name: "Event Stream" }),
    ).toBeVisible();
    await expect(
      page.getByText("Dashboard API fixture ready", { exact: true }),
    ).toBeVisible();

    await openNavigation(page, "AI Assistant", `${DASHBOARD_PATH}ai`);
    await expect(page).not.toHaveURL(/sign-in/);
    await expect(
      page
        .getByText(
          /AI provider not configured|No AI key configured|AI Assistant/i,
        )
        .first(),
    ).toBeVisible();

    await openNavigation(
      page,
      "Mission Control",
      `${DASHBOARD_PATH}mission-control`,
    );
    await expect(
      page.getByRole("heading", { name: "No durable runs in the ledger" }),
    ).toBeVisible();

    await page.goto(`${DASHBOARD_PATH}flight-deck?executionId=${EXECUTION_ID}`);
    await expect(page).toHaveURL(
      new RegExp(
        `${DASHBOARD_PATH.replaceAll("/", "\\/")}flight-deck\\?executionId=`,
      ),
    );
    await expect(
      page.getByRole("heading", { name: "Audit / Chat run" }),
    ).toBeVisible();
    await expect(
      page.getByText("Controlled browser fixture completed.", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("PROVEN", { exact: true }).first(),
    ).toBeVisible();
  });

  test("runs the Capability Probe action with complete source-grounded C1-C7 coverage", async ({
    page,
  }) => {
    const fixture = installCapabilityProbeFixture();
    await installApiFixtures(page, { capabilityProbeAi: fixture });
    await programmaticSignIn(page);
    await page.goto(`${DASHBOARD_PATH}ai`);

    const probeRequestPromise = page.waitForRequest((request) =>
      request.url().includes("/api/ai/chat/stream"),
    );
    const probeResponsePromise = page.waitForResponse((response) =>
      response.url().includes("/api/ai/chat/stream"),
    );
    await page.getByRole("button", { name: "Capability Probe", exact: true }).click();

    const probeRequest = await probeRequestPromise;
    expect(probeRequest.postDataJSON()).toMatchObject({
      message: CAPABILITY_PROBE_MESSAGE,
    });
    expect((await probeResponsePromise).status()).toBe(200);

    await expect(
      page.locator("body"),
    ).toContainText("Coverage: COMPLETE — both declared files were read to completion.");
    await expect(page.locator("body")).toContainText(
      "Overall score: 7/7 capabilities demonstrated.",
    );
    for (const capability of ["C1", "C2", "C3", "C4", "C5", "C6", "C7"]) {
      await expect(page.getByRole("heading", { name: capability, exact: true })).toBeVisible();
    }
    await expect(
      page.getByText("Behavior evidence · 2 excerpts", { exact: true }).first(),
    ).toBeVisible();

    const bodyText = await page.locator("body").innerText();
    expect(bodyText).toContain("profile-classifier.ts:2");
    expect(bodyText).toContain("file-tools.ts:2");
    expect(bodyText).toContain("Accepted: source span verified.");
    expect(bodyText).not.toMatch(
      /file-tools\.ts[^\n]{0,80}(?:truncated|↕)/i,
    );
    expect(bodyText).not.toMatch(/(?:\/home\/|\/tmp\/|\/srv\/|\/workspace\/)/);
  });

  test("opens failed task and workflow details with redacted recovery guidance", async ({
    page,
  }) => {
    const rawDiagnostic = "provider diagnostic: upstream returned raw response";
    const rawCredential = "sk-e2e-browser-credential-secret";
    const supportReferences = {
      authentication_failed: "support-task-auth-32",
      quota_exhausted: "support-task-quota-32",
      provider_outage: "support-workflow-outage-32",
    };
    const recoveryTasks = [
      {
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
          operationId: rawCredential,
        }),
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:01:00.000Z",
      },
      {
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
          operationId: rawCredential,
        }),
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:01:00.000Z",
      },
    ];
    const workflowId = "e2e-outage-workflow";
    await installApiFixtures(page, {
      recoveryTasks,
      recoveryWorkflows: [
        {
          id: workflowId,
          projectId: "e2e-project",
          name: "Recover provider outage",
          description: "A pipeline used to verify outage recovery guidance.",
          status: "failed",
          phases: [
            { name: "build", steps: ["compile"] },
            { name: "test", steps: ["verify"] },
          ],
          currentPhase: "test",
          executionCount: 1,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:01:00.000Z",
        },
      ],
      recoveryWorkflowExecutions: {
        [workflowId]: [
          {
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
              operatorAction:
                "Retry in a moment; configure another provider if the issue persists.",
              diagnostic: rawCredential,
            },
          },
        ],
      },
    });
    await programmaticSignIn(page);

    await openNavigation(page, "Tasks", `${DASHBOARD_PATH}tasks`);
    await expect(
      page.getByLabel("Expand task Recover authentication failure"),
    ).toBeVisible();
    await page
      .getByLabel("Expand task Recover authentication failure")
      .click();
    const taskDetails = page.locator("#task-details-e2e-auth-failed-task");
    await expect(taskDetails).toContainText("Provider authentication failed");
    await expect(taskDetails).toContainText(
      "Replace the provider API key with a valid key, then retry.",
    );
    await expect(taskDetails).toContainText(
      `Support reference: ${supportReferences.authentication_failed}`,
    );
    await page.getByLabel("Expand task Recover quota exhaustion").click();
    await expect(page.getByText("Provider quota is exhausted")).toBeVisible();
    await expect(
      page.getByText(`Support reference: ${supportReferences.quota_exhausted}`),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByLabel("Expand task Recover authentication failure"),
    ).toBeVisible();
    await page
      .getByLabel("Expand task Recover authentication failure")
      .click();
    const reloadedAuthDetails = page.locator(
      "#task-details-e2e-auth-failed-task",
    );
    await expect(reloadedAuthDetails).toContainText(
      "Provider authentication failed",
    );
    await expect(reloadedAuthDetails).toContainText(
      "Replace the provider API key with a valid key, then retry.",
    );
    await expect(reloadedAuthDetails).toContainText(
      `Support reference: ${supportReferences.authentication_failed}`,
    );
    await page.getByLabel("Expand task Recover quota exhaustion").click();
    await expect(page.getByText("Provider quota is exhausted")).toBeVisible();
    await expect(
      page.getByText(`Support reference: ${supportReferences.quota_exhausted}`),
    ).toBeVisible();
    const reloadedTaskText = await page.locator("body").innerText();
    expect(reloadedTaskText).not.toContain(rawDiagnostic);
    expect(reloadedTaskText).not.toContain(rawCredential);
    expect(reloadedTaskText).not.toMatch(
      /secret-model-name|\/home\/runner|\/tmp\//i,
    );

    await openNavigation(page, "Workflows", `${DASHBOARD_PATH}workflows`);
    await expect(page.getByText("Recover provider outage")).toBeVisible();
    await page.getByRole("button", { name: "Execution history" }).click();
    const execution = page
      .getByText("failed · no successful completion")
      .locator("..")
      .locator("..");
    await expect(execution).toContainText(
      "The provider is temporarily unavailable",
    );
    await expect(execution).toContainText(
      "Retry in a moment; configure another provider if the issue persists.",
    );
    await expect(execution).toContainText(
      `Support reference: ${supportReferences.provider_outage}`,
    );
    await page.reload();
    await expect(page.getByText("Recover provider outage")).toBeVisible();
    await page.getByRole("button", { name: "Execution history" }).click();
    const reloadedExecution = page
      .getByText("failed · no successful completion")
      .locator("..")
      .locator("..");
    await expect(reloadedExecution).toContainText(
      "The provider is temporarily unavailable",
    );
    await expect(reloadedExecution).toContainText(
      "Retry in a moment; configure another provider if the issue persists.",
    );
    await expect(reloadedExecution).toContainText(
      `Support reference: ${supportReferences.provider_outage}`,
    );

    const visibleText = await page.locator("body").innerText();
    expect(visibleText).not.toContain(rawDiagnostic);
    expect(visibleText).not.toContain(rawCredential);
    expect(visibleText).not.toMatch(
      /secret-model-name|\/home\/runner|\/tmp\//i,
    );
    await expectNoHorizontalOverflow(page);
  });

  test("proves remediation plans, review state, and task action transitions", async ({
    page,
  }) => {
    const rawPrompt = "INTERNAL_PROMPT_should_never_render";
    const rawDiagnostic = "raw-provider-diagnostic-should-never-render";
    const readyTaskId = "e2e-ready-remediation-task";
    const reviewTaskId = "e2e-review-remediation-task";
    const verificationTaskId = "e2e-verification-remediation-task";
    const remediationTasks = [
      {
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
          terminalReason: rawDiagnostic,
        }),
        remediationPlan: {
          version: 1,
          ruleId: "e2e-rule-sql-input",
          ruleCode: "SEC-001",
          ruleTitle: "Unsanitized SQL input",
          severity: "high",
          occurrenceCount: 2,
          evidence: [
            { file: "src/auth/input.ts", line: 10, snippet: "query(userInput)", occurrences: 1 },
            { file: "src/auth/input.ts", line: 18, snippet: "query(accountId)", occurrences: 1 },
            { file: "src/auth/input.ts", line: 27, snippet: "query(filter)", occurrences: 1 },
            { file: "src/auth/input.ts", line: 31, snippet: "query(sort)", occurrences: 1 },
            { file: "src/auth/input.ts", line: 44, snippet: "query(limit)", occurrences: 1 },
            { file: "src/auth/input.ts", line: 52, snippet: "query(offset)", occurrences: 1 },
          ],
          relatedFiles: ["src/auth/input.ts"],
          fixDescription: "Use the parameterized query helper for every user-controlled value.",
          verificationSteps: [
            "Run the SQL injection regression test.",
            "Confirm all user-controlled query values use parameters.",
          ],
          source: {
            type: "scan",
            correlationId: "e2e-scan-correlation",
            revision: "remediation-revision-42",
            completeness: "COMPLETE",
          },
          status: "ready",
        },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:01:00.000Z",
      },
      {
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
          terminalReason: rawDiagnostic,
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
            completeness: "PARTIAL",
          },
          status: "needs_review",
        },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:01:00.000Z",
      },
      {
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
          evidence: [
            {
              file: "src/auth/input.ts",
              line: 10,
              snippet: "query(userInput)",
              occurrences: 1,
            },
          ],
          relatedFiles: ["src/auth/input.ts"],
          fixDescription: "Use the parameterized query helper for every user-controlled value.",
          verificationSteps: [
            "Run the SQL injection regression test.",
            "Confirm all user-controlled query values use parameters.",
          ],
          source: {
            type: "scan",
            correlationId: "e2e-verification-correlation",
            revision: "remediation-revision-43",
            completeness: "COMPLETE",
          },
          status: "ready",
        },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:03:00.000Z",
      },
    ];
    const actionRequests: string[] = [];
    const verificationRequests: Array<Record<string, unknown>> = [];
    await installApiFixtures(page, {
      taskActions: {
        tasks: remediationTasks,
        requests: actionRequests,
        verificationRequests,
      },
    });
    await programmaticSignIn(page);
    await openNavigation(page, "Tasks", `${DASHBOARD_PATH}tasks`);

    const readyRow = page.getByRole("button", {
      name: /task Execute SQL input sanitization remediation/,
    });
    await expect(readyRow).toBeVisible();
    await expect(page.getByTitle("Execute")).toBeVisible();
    await readyRow.click();

    const readyDetails = page.locator(`#task-details-${readyTaskId}`);
    const readyPlan = readyDetails.getByRole("region", {
      name: "Remediation plan",
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
    await expect(readyPlan).toContainText(
      "Use the parameterized query helper for every user-controlled value.",
    );
    await expect(readyPlan).toContainText("Run the SQL injection regression test.");
    await expect(readyPlan).toContainText("Confirm all user-controlled query values use parameters.");
    await expect(readyPlan).toContainText("Ready to execute");
    await expect(readyPlan).toContainText("Source: scan");
    await expect(readyPlan).toContainText("revision remediation-");
    await expect(readyDetails.getByRole("button", { name: "Details" })).toBeVisible();

    await page.getByTitle("Execute").click();
    await expect.poll(() => actionRequests.length).toBe(1);
    expect(actionRequests[0]).toBe(`execute:${readyTaskId}`);
    await expect(readyRow).toContainText("running");
    await expect(page.getByTitle("Execute")).toHaveCount(0);

    const reviewRow = page.getByRole("button", {
      name: /task Review incomplete SQL remediation evidence/,
    });
    await reviewRow.click();
    const reviewDetails = page.locator(`#task-details-${reviewTaskId}`);
    const reviewPlan = reviewDetails.getByRole("region", {
      name: "Remediation plan",
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
      name: /task Verify parameterized SQL remediation/,
    });
    await verificationRow.click();
    const verificationDetails = page.locator(
      `#task-details-${verificationTaskId}`,
    );
    const verificationPlan = verificationDetails.getByRole("region", {
      name: "Remediation plan",
    });
    const verificationChecks = verificationDetails.getByRole("region", {
      name: "Operator verification checks",
    });
    await expect(verificationPlan).toContainText("SEC-003");
    await expect(verificationPlan).toContainText("Ready to execute");
    await verificationDetails
      .getByRole("button", { name: "Run and record verification checks" })
      .click();
    await expect(verificationChecks).toBeVisible();
    await expect(verificationChecks).toContainText("Incomplete");

    const firstGuidance = "Run the SQL injection regression test.";
    const secondGuidance =
      "Confirm all user-controlled query values use parameters.";
    const firstEvidence = verificationChecks.getByLabel(
      `Evidence for ${firstGuidance}`,
    );
    const secondEvidence = verificationChecks.getByLabel(
      `Evidence for ${secondGuidance}`,
    );
    const passButtons = verificationChecks.getByRole("button", {
      name: "Record passed",
    });
    const failedButtons = verificationChecks.getByRole("button", {
      name: "Record failed",
    });
    await expect(passButtons.nth(0)).toBeDisabled();
    await firstEvidence.fill("The regression test still fails before the fix.");
    await failedButtons.nth(0).click();
    await expect.poll(() => verificationRequests.length).toBe(1);
    expect(verificationRequests[0]).toMatchObject({
      taskId: verificationTaskId,
      checkId: "rule-verification-1",
      passed: false,
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
      evidence: "The focused regression test passes after the fix.",
    });
    await expect(verificationChecks).toContainText("Incomplete");

    await secondEvidence.fill(
      "All user-controlled query values use the parameterized helper.",
    );
    await passButtons.nth(1).click();
    await expect.poll(() => verificationRequests.length).toBe(3);
    expect(verificationRequests[2]).toMatchObject({
      taskId: verificationTaskId,
      checkId: "rule-verification-2",
      passed: true,
      evidence: "All user-controlled query values use the parameterized helper.",
    });
    await expect(verificationRow).toContainText("completed");
    await verificationDetails.getByRole("button", { name: "Details" }).click();
    await expect(verificationPlan).toContainText("Verified");
    await verificationDetails.getByRole("button", { name: "Logs" }).click();
    await expect(verificationChecks).toContainText("Verified");
    await expect(verificationDetails).toContainText(
      "Task completed and verified by the server.",
    );

    await page.reload();
    const reloadedVerificationRow = page.getByRole("button", {
      name: /task Verify parameterized SQL remediation/,
    });
    await expect(reloadedVerificationRow).toContainText("completed");
    await reloadedVerificationRow.click();
    const reloadedDetails = page.locator(
      `#task-details-${verificationTaskId}`,
    );
    await reloadedDetails.getByRole("button", { name: "Logs" }).click();
    await expect(
      reloadedDetails.getByRole("region", {
        name: "Operator verification checks",
      }),
    ).toContainText("Verified");
    await expect(reloadedDetails).toContainText(
      "Task completed and verified by the server.",
    );

    const visibleText = await page.locator("body").innerText();
    expect(visibleText).not.toContain(rawPrompt);
    expect(visibleText).not.toContain(rawDiagnostic);
    await expectNoHorizontalOverflow(page);
  });

  test("converges two browser sessions across reload, reconnect, stale results, and API restart", async ({
    browser,
    page,
  }) => {
    test.skip(
      !process.env.DASHBOARD_E2E_CONTROL_URL,
      "The multi-process convergence campaign runs only under the release runner.",
    );
    test.setTimeout(90_000);

    const secondContext = await browser.newContext();
    const secondPage = await secondContext.newPage();
    try {
      await Promise.all([installApiFixtures(page), installApiFixtures(secondPage)]);
      await Promise.all([programmaticSignIn(page), programmaticSignIn(secondPage)]);
      await Promise.all([
        page.goto(DASHBOARD_PATH),
        secondPage.goto(`${DASHBOARD_PATH}ai`),
      ]);
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
        projectScores: [{ ...dashboardFixture.projectScores[0], projectName: "Concurrent Project", score: 97 }],
        activeTaskCount: 1,
        taskStatusBreakdown: { pending: 0, running: 1 },
      };
      let refreshCount = 0;
      let releaseStaleResponse!: () => void;
      const staleResponseReleased = new Promise<void>((resolve) => {
        releaseStaleResponse = resolve;
      });
      await page.route("**/api/dashboard", async (route) => {
        refreshCount += 1;
        if (refreshCount === 1) return route.fulfill(jsonResponse(currentDashboardFixture));
        await staleResponseReleased;
        return route.fulfill(jsonResponse(dashboardFixture));
      });
      await page.getByRole("button", { name: "Refresh status" }).click();
      await expect(page.getByText("Concurrent Project", { exact: true })).toBeVisible();
      await expect(page.getByText("97", { exact: true })).toBeVisible();
      const staleRefresh = page.getByRole("button", { name: "Refresh status" }).click();
      await expect.poll(() => refreshCount).toBe(2);
      releaseStaleResponse();
      await staleRefresh;
      await expectDashboardReady(page);
      await expect(page.getByText("Concurrent Project", { exact: true })).toBeVisible();
      await expect(page.getByText("97", { exact: true })).toBeVisible();
      await expect(page.getByText("1", { exact: true }).first()).toBeVisible();

      // Simulate a dropped connection in the second browser and assert the
      // recovery action rendered by the dashboard, then let the next request
      // reconnect normally.
      let reconnectAttempt = 0;
      await secondPage.goto(DASHBOARD_PATH);
      await expectDashboardReady(secondPage);
      await secondPage.route("**/api/dashboard", async (route) => {
        reconnectAttempt += 1;
        // useGetDashboard retries once; hold both bounded attempts so the
        // rendered error state is observable before the operator retries.
        if (reconnectAttempt <= 2) {
          return route.fulfill(
            jsonResponse({ error: "controlled reconnect interruption" }, 503),
          );
        }
        return route.continue();
      });
      await secondPage.reload();
      await expect(
        secondPage.getByRole("heading", { name: "Failed to load dashboard" }),
      ).toBeVisible();
      await expect(
        secondPage.getByRole("button", { name: "Retry Connection" }),
      ).toBeVisible();
      await secondPage.unroute("**/api/dashboard");
      await secondPage.getByRole("button", { name: "Retry Connection" }).click();
      await expectDashboardReady(secondPage);

      await restartApiForCampaign(page);
      await Promise.all([page.reload(), secondPage.reload()]);
      await expectDashboardReady(page);
      await expectDashboardReady(secondPage);

      await page.reload();
      await expectDashboardReady(page);
      await expect(
        page.getByRole("button", { name: "Retry Connection" }),
      ).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
    } finally {
      await secondContext.close();
    }
  });

  test("shows one temporary Groq outage across restarts and resolves it after recovery", async ({
    page,
  }) => {
    test.skip(
      process.env.DASHBOARD_E2E_GROQ_CATALOG_FIXTURE !== "1" ||
        !process.env.DASHBOARD_E2E_CONTROL_URL,
      "The controlled Groq catalog campaign runs only under the release runner.",
    );
    test.setTimeout(120_000);

    await installApiFixtures(page, { operatorAlertsPassthrough: true });
    await programmaticSignIn(page);

    // Clear any active Groq state left by an interrupted earlier campaign.
    await setGroqCatalogFixture(page, "healthy");
    await restartApiForCampaign(page);
    const baselineAlerts = await readOperatorAlerts(page, { activeOnly: false });
    const baselineOutage = baselineAlerts.find(
      (alert) => alert.kind === "groq_model_catalog_unavailable",
    );
    const baselineOccurrenceCount = Number(
      baselineOutage?.occurrenceCount ?? 0,
    );

    await setGroqCatalogFixture(page, "timeout");
    await restartApiForCampaign(page);
    await restartApiForCampaign(page);
    const outageAlerts = await readOperatorAlerts(page);
    const outageAlertsForGroq = outageAlerts.filter(
      (alert) => alert.kind === "groq_model_catalog_unavailable",
    );
    expect(outageAlertsForGroq).toHaveLength(1);
    expect(outageAlertsForGroq[0]).toMatchObject({
      provider: "groq",
      modelRole: "catalog",
      modelId: "catalog",
      status: "open",
      occurrenceCount: baselineOccurrenceCount + 2,
    });
    expect(
      outageAlerts.some((alert) => alert.kind === "groq_model_catalog_drift"),
    ).toBe(false);
    const outageText = JSON.stringify(outageAlertsForGroq[0]);
    expect(outageText).not.toMatch(/apiKey|raw provider|timeout/i);

    await setGroqCatalogFixture(page, "healthy");
    await restartApiForCampaign(page);
    const recoveredAlerts = await readOperatorAlerts(page);
    expect(recoveredAlerts).toHaveLength(0);

    await setGroqCatalogFixture(page, "retired");
    await restartApiForCampaign(page);
    const retiredAlerts = await readOperatorAlerts(page);
    expect(
      retiredAlerts.some((alert) => alert.kind === "groq_model_catalog_unavailable"),
    ).toBe(false);
    const driftAlerts = retiredAlerts.filter(
      (alert) => alert.kind === "groq_model_catalog_drift",
    );
    expect(driftAlerts).toHaveLength(1);
    expect(driftAlerts[0]).toMatchObject({
      provider: "groq",
      modelRole: "fast",
      modelId: "openai/gpt-oss-20b",
      status: "open",
    });
    expect(Number(driftAlerts[0]?.occurrenceCount)).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(driftAlerts[0])).not.toMatch(/apiKey|raw provider/i);

    await setGroqCatalogFixture(page, "healthy");
    await restartApiForCampaign(page);
    const finalAlerts = await readOperatorAlerts(page);
    expect(finalAlerts).toHaveLength(0);
    await writeGroqCatalogEvidence({
      outcome: "passed",
      outage: {
        openAlertCount: outageAlertsForGroq.length,
        occurrenceDelta:
          Number(outageAlertsForGroq[0]?.occurrenceCount ?? 0) -
          baselineOccurrenceCount,
        driftAlertCount: 0,
      },
      recovery: { openAlertCount: recoveredAlerts.length },
      retiredModel: {
        outageAlertCount: retiredAlerts.filter(
          (alert) => alert.kind === "groq_model_catalog_unavailable",
        ).length,
        driftAlertCount: driftAlerts.length,
      },
      healthyAfterRetired: { openAlertCount: finalAlerts.length },
    });
  });

  test("previews and downloads the completed execution audit without duplicating effects", async ({
    page,
  }) => {
    const auditRequests: string[] = [];
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
        proof: { required: false, verdict: "PROVEN" },
      },
      timeline: [],
      validations: [{ status: "passed", profile: "release-safe" }],
      affectedFiles: ["src/feature.ts"],
      redaction: {
        excluded: [
          "provider secrets",
          "raw model output",
          "private runtime paths",
        ],
      },
    };
    await installApiFixtures(page, {
      auditExport: {
        body: auditBody,
        filename: "server-supplied-audit-name.json",
        requests: auditRequests,
        failFirstPreview: true,
      },
    });
    await programmaticSignIn(page);
    await page.evaluate(() => {
      const execution = {
        id: "e2e-controlled-execution",
        projectId: "e2e-project",
        sessionId: "e2e-audit-session",
        message: "Completed audit execution",
      };
      localStorage.setItem(
        "eos_ai_execution_current_e2e-project",
        "e2e-audit-session",
      );
      localStorage.setItem(
        "eos_ai_execution_e2e-project_e2e-audit-session",
        JSON.stringify(execution),
      );
    });
    await page.goto(`${DASHBOARD_PATH}ai`);

    const proof = page.getByLabel("Agent execution proof");
    await expect(proof).toBeVisible();
    await expect(proof).toContainText(/completed/i);
    await expect(proof).toContainText("Revision: e2e-revision-42");

    await proof.getByRole("button", { name: "Preview audit" }).click();
    const preview = page.getByLabel("Redacted audit preview");
    await expect(preview).toBeVisible();
    await expect(preview).toContainText("Audit preview temporarily unavailable");
    await expect(preview).toContainText("same execution and revision");
    await expect(preview.getByRole("button", { name: "Retry preview" })).toBeVisible();
    expect(auditRequests).toHaveLength(1);

    await preview.getByRole("button", { name: "Retry preview" }).click();
    await expect(preview).toContainText("provider secrets");
    await expect(preview).toContainText("raw model output");
    await expect(preview).toContainText("private runtime paths");
    await expect(preview).toContainText(EXECUTION_ID);
    await expect(preview).toContainText("e2e-operation");
    await expect(preview).toContainText("e2e-revision-42");
    expect(auditRequests).toHaveLength(2);
    expect(new URL(auditRequests[0]).pathname).toBe(
      `/api/ai/executions/${EXECUTION_ID}/audit-export`,
    );

    await preview.getByRole("button", { name: "Close audit preview" }).click();
    await expect(preview).toBeHidden();

    const downloadPromise = page.waitForEvent("download");
    await proof.getByRole("button", { name: "Export audit" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("server-supplied-audit-name.json");
    expect(auditRequests).toHaveLength(3);

    await page.reload();
    const reloadedProof = page.getByLabel("Agent execution proof");
    await expect(reloadedProof).toBeVisible();
    await expect(reloadedProof).toContainText(/completed/i);
    await expect(reloadedProof).toContainText("Execution e2e-controlled-execution");
    await expect(reloadedProof).toContainText("Revision: e2e-revision-42");
    await expect(
      page.getByLabel("Redacted audit preview"),
    ).toBeHidden();
    expect(auditRequests).toHaveLength(3);
  });

  test("keeps the cancelled execution audit handoff redacted and terminal", async ({
    page,
  }) => {
    const auditRequests: string[] = [];
    const cancelledExecution = {
      ...executionFixture,
      status: "cancelled",
      flightState: "CANCELLED",
      checkpoint: {
        stage: "cancelled",
        detail: "Execution cancelled before any changes were applied.",
      },
      terminalReason: "cancel_requested",
      completedAt: "2026-01-01T00:01:30.000Z",
      updatedAt: "2026-01-01T00:01:30.000Z",
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
        proof: { required: false, verdict: "NOT_RECORDED" },
      },
      timeline: [
        { type: "cancelled", detail: "Cancellation accepted by the server." },
      ],
      validations: [],
      affectedFiles: [],
      redaction: {
        excluded: [
          "provider secrets",
          "raw model output",
          "private runtime paths",
        ],
      },
    };
    await installApiFixtures(page, {
      auditExport: {
        body: auditBody,
        filename: "cancelled-server-audit.json",
        requests: auditRequests,
        execution: cancelledExecution,
        messageOutcome: "CANCELLED",
        failFirstPreview: true,
      },
    });
    await programmaticSignIn(page);
    await page.evaluate(() => {
      const execution = {
        id: "e2e-controlled-execution",
        projectId: "e2e-project",
        sessionId: "e2e-audit-session",
        message: "Cancelled audit execution",
      };
      localStorage.setItem(
        "eos_ai_execution_current_e2e-project",
        "e2e-audit-session",
      );
      localStorage.setItem(
        "eos_ai_execution_e2e-project_e2e-audit-session",
        JSON.stringify(execution),
      );
    });
    await page.goto(`${DASHBOARD_PATH}ai`);

    const proof = page.getByLabel("Agent execution proof");
    await expect(proof).toBeVisible();
    await expect(proof).toContainText("Cancelled");
    await expect(proof).toContainText("Execution e2e-controlled-execution");
    await expect(proof).toContainText("Revision: e2e-revision-42");
    await expect(proof).toContainText("Terminal reason: cancel_requested");
    await expect(proof.getByRole("button", { name: "Cancel" })).toHaveCount(0);
    await expect(proof.getByRole("button", { name: "Resume" })).toHaveCount(0);
    await expect(
      proof.getByRole("button", { name: "Approve & apply" }),
    ).toHaveCount(0);
    await expect(
      proof.getByRole("button", { name: /commit verified changes/i }),
    ).toHaveCount(0);
    await expect(
      proof.getByRole("button", { name: /push committed changes/i }),
    ).toHaveCount(0);

    await proof.getByRole("button", { name: "Preview audit" }).click();
    const preview = page.getByLabel("Redacted audit preview");
    await expect(preview).toBeVisible();
    await expect(preview).toContainText("Audit preview temporarily unavailable");
    await expect(preview).toContainText("same execution and revision");
    await expect(preview.getByRole("button", { name: "Retry preview" })).toBeVisible();
    expect(auditRequests).toHaveLength(1);

    await preview.getByRole("button", { name: "Retry preview" }).click();
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

    await preview.getByRole("button", { name: "Close audit preview" }).click();
    const downloadPromise = page.waitForEvent("download");
    await proof.getByRole("button", { name: "Export audit" }).click();
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
    page,
  }) => {
    const taskId = "e2e-live-task";
    const liveLog = {
      id: "e2e-live-log",
      taskId,
      level: "info",
      message: "Live update received from the server",
      timestamp: "2026-01-01T00:00:02.000Z",
    };
    await installApiFixtures(page, {
      archiveUpload: {
        uploadId: "e2e-upload",
        originalName: "dashboard-journey.zip",
      },
      liveTask: {
        id: taskId,
        title: "Verify live dashboard updates",
        projectId: "e2e-project",
        log: liveLog,
      },
    });
    await programmaticSignIn(page);

    // This is a valid, empty ZIP archive. Keeping it inline makes the browser
    // test self-contained while still exercising FormData and multipart bytes.
    const uploadResult = await page.evaluate(async (apiBaseUrl) => {
      const bytes = Uint8Array.from(
        atob("UEsFBgAAAAAAAAAAAAAAAAAAAAAAAA=="),
        (character) => character.charCodeAt(0),
      );
      const body = new FormData();
      body.append(
        "archive",
        new Blob([bytes], { type: "application/zip" }),
        "dashboard-journey.zip",
      );
      const response = await fetch(
        new URL("/api/upload/archive", apiBaseUrl).toString(),
        { method: "POST", credentials: "include", body },
      );
      return {
        status: response.status,
        body: (await response.json()) as Record<string, unknown>,
      };
    }, process.env.DASHBOARD_E2E_API_BASE_URL ?? page.url());
    expect(uploadResult.status).toBe(201);
    expect(uploadResult.body).toEqual({
      uploadId: "e2e-upload",
      originalName: "dashboard-journey.zip",
    });

    await openNavigation(page, "Tasks", `${DASHBOARD_PATH}tasks`);
    const taskRow = page.getByLabel(
      "Expand task Verify live dashboard updates",
    );
    await expect(taskRow).toBeVisible();
    await taskRow.click();
    await page.getByRole("button", { name: "Logs" }).click();
    await expect(page.getByRole("region", { name: "Activity" })).toContainText(
      "Live update received from the server",
    );
  });

  test("recovers a live task update after a temporary stream failure", async ({
    page,
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
        checkpointVersion: 3,
      },
    };
    const streamRequests: string[] = [];
    await installApiFixtures(page, {
      liveTask: {
        id: taskId,
        title: "Recover live task updates",
        projectId: "e2e-project",
        log: liveLog,
        streamRequests,
        failFirstStream: true,
      },
    });
    await programmaticSignIn(page);

    await openNavigation(page, "Tasks", `${DASHBOARD_PATH}tasks`);
    const taskRow = page.getByLabel("Expand task Recover live task updates");
    await expect(taskRow).toBeVisible();
    await taskRow.click();
    await page.getByRole("button", { name: "Logs" }).click();

    const activity = page.getByRole("region", { name: "Activity" });
    await expect(activity).toContainText(liveLog.message);
    await expect
      .poll(() => streamRequests.length, {
        message: "the task log stream should reconnect exactly once",
      })
      .toBe(2);
    expect(streamRequests).toHaveLength(2);
    expect(streamRequests[0]).toBe(streamRequests[1]);
    expect(new URL(streamRequests[1]).pathname).toBe(
      `/api/tasks/${taskId}/logs/stream`,
    );
    await expect(
      activity.locator("summary").filter({ hasText: liveLog.message }),
    ).toHaveCount(1);
  });

  test("shows an actionable terminal state when live task reconnects are exhausted", async ({
    page,
  }) => {
    const taskId = "e2e-exhausted-live-task";
    const operationId = "e2e-exhausted-operation";
    const liveLog = {
      id: "e2e-exhausted-live-log",
      taskId,
      level: "info",
      message: "The only confirmed task update",
      timestamp: "2026-01-01T00:00:02.000Z",
      metadata: { operationId },
    };
    const streamRequests: string[] = [];
    const nonStreamRequests: string[] = [];
    page.on("request", (request) => {
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
        failStreamAttempts: 6,
      },
    });
    await programmaticSignIn(page);

    await openNavigation(page, "Tasks", `${DASHBOARD_PATH}tasks`);
    await page.getByLabel("Expand task Recover exhausted live task updates").click();
    await page.getByRole("button", { name: "Logs" }).click();

    const activity = page.getByRole("region", { name: "Activity" });
    await expect(activity).toContainText(liveLog.message);
    await expect(page.getByText("Temporary stream failure.", { exact: false })).toBeVisible();
    await expect
      .poll(() => streamRequests.length, {
        message: "the task log stream should exhaust its bounded reconnect budget",
        timeout: 35_000,
      })
      .toBe(6);
    const exhausted = page.getByRole("alert");
    await expect(exhausted).toContainText("Live task updates could not reconnect");
    await expect(exhausted).toContainText("Reconnect attempts are exhausted");
    await expect(exhausted).toContainText(operationId);
    await expect(exhausted).toContainText("task has not been marked failed");
    await expect(exhausted.getByRole("button", { name: "Retry live updates" })).toBeVisible();
    await expect(exhausted.getByRole("button", { name: "Refresh task logs" })).toBeVisible();

    await exhausted.getByRole("button", { name: "Retry live updates" }).click();
    await expect(activity).toContainText("The only confirmed task update");
    await expect.poll(() => streamRequests.length).toBe(7);
    expect(new Set(streamRequests).size).toBe(1);
    expect(nonStreamRequests).not.toContain("POST");
    await expect(
      activity.locator("summary").filter({ hasText: liveLog.message }),
    ).toHaveCount(1);
  });

  test("pages and reloads the filtered event stream without losing its window", async ({
    page,
  }) => {
    const events = Array.from({ length: 51 }, (_, index) => ({
      id: `e2e-event-${index}`,
      projectId: "e2e-project",
      type: "AuditEvent",
      severity: index < 2 ? "success" : "info",
      correlationId: index < 2 ? "release-42" : null,
      message:
        index < 2 ? `Filtered release event ${index}` : `Older event ${index}`,
      timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, 51 - index)).toISOString(),
    }));
    const eventRequests: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.endsWith("/api/events"))
        eventRequests.push(request.url());
    });
    await installApiFixtures(page, {
      events,
      projects: [
        {
          id: "e2e-project",
          name: "Smoke Project",
          language: "TypeScript",
          framework: "React",
          status: "active",
          rootPath: "/controlled/smoke",
          qualityScore: 92,
        },
      ],
    });
    await programmaticSignIn(page);
    await page.goto(`${DASHBOARD_PATH}events`);

    await expect(
      page.getByText("Older event 49", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Older event 50", { exact: true }),
    ).not.toBeVisible();
    const firstRequest = new URL(eventRequests.at(-1)!);
    expect(firstRequest.searchParams.get("limit")).toBe("50");
    expect(firstRequest.searchParams.get("page")).toBe("1");

    await Promise.all([
      page.waitForRequest((request) => {
        const url = new URL(request.url());
        return (
          url.pathname.endsWith("/api/events") &&
          url.searchParams.get("page") === "2"
        );
      }),
      page.getByRole("button", { name: "Older" }).click(),
    ]);
    await expect(page.getByText("Page 2.", { exact: false })).toBeVisible();
    await expect(
      page.getByText("Older event 50", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Filtered release event 0", { exact: true }),
    ).not.toBeVisible();
    expect(new URL(eventRequests.at(-1)!).searchParams.get("page")).toBe("2");
    await page.getByRole("button", { name: "Newer" }).click();
    await expect(page.getByText("Page 1.", { exact: false })).toBeVisible();
    await expect(
      page.getByText("Filtered release event 0", { exact: true }),
    ).toBeVisible();

    await page.getByPlaceholder("Search logs...").fill("Filtered release");
    await page.getByRole("button", { name: "Toggle event filters" }).click();
    await page.locator("select").nth(1).selectOption("success");
    await expect(
      page.getByText("Filtered release event 0", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Older event 1", { exact: true }),
    ).not.toBeVisible();
    await expect(page).toHaveURL(/search=Filtered\+release/);
    await expect(page).toHaveURL(/severity=success/);

    await page.reload();
    await expect(
      page.getByText("Filtered release event 0", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Older event 1", { exact: true }),
    ).not.toBeVisible();
    await expect(page.getByPlaceholder("Search logs...")).toHaveValue(
      "Filtered release",
    );
    await page.getByRole("button", { name: "Toggle event filters" }).click();
    await expect(page.locator("select").nth(1)).toHaveValue("success");
    const filteredRequest = new URL(eventRequests.at(-1)!);
    expect(filteredRequest.searchParams.get("limit")).toBe("50");
    expect(filteredRequest.searchParams.get("page")).toBe("1");
    expect(filteredRequest.searchParams.get("search")).toBe("Filtered release");
    expect(filteredRequest.searchParams.get("severity")).toBe("success");
  });

  test("renders an Arabic source-backed AI answer without internal diagnostics", async ({
    page,
  }) => {
    const fixture = await installArabicAiFixture(page);
    await installApiFixtures(page, { arabicAi: fixture });
    await programmaticSignIn(page);
    await page.goto(`${DASHBOARD_PATH}ai`);

    const composer = page.locator("textarea").first();
    await expect(composer).toBeVisible();
    await composer.fill(fixture.question);
    const sendButton = composer.locator("xpath=..").getByRole("button");
    await expect(sendButton).toBeEnabled();
    const streamResponsePromise = page.waitForResponse((response) =>
      response.url().includes("/api/ai/chat/stream"),
    );
    await sendButton.click();
    const streamResponse = await streamResponsePromise;
    expect(streamResponse.status()).toBe(200);

    await expect(
      page.getByText(fixture.question, { exact: true }).last(),
    ).toBeVisible();
    await expect(
      page.getByText(fixture.answer, { exact: true }).last(),
    ).toBeVisible();
    await expect(
      page.getByText("Agent activity", { exact: false }),
    ).toBeVisible();
    await page.locator("summary").filter({ hasText: "Agent activity" }).click();
    await expect(
      page.getByText("Reading source", { exact: false }),
    ).toBeVisible();
    await expect(
      page.getByText(fixture.source, { exact: true }).last(),
    ).toBeVisible();
    await expect(
      page.getByText(/Behavior evidence · 1 excerpt/i).last(),
    ).toBeVisible();
    await expect(
      page
        .getByText('return partialFromCollectedEvidence("provider timeout");', {
          exact: true,
        })
        .last(),
    ).toBeVisible();

    const provenance = page.locator('[aria-label="Context provenance"]');
    await expect(provenance).toBeVisible();
    await provenance.getByRole("button").click();
    await expect(provenance).toContainText("Revision: workspace-revision-safe-7");
    await expect(provenance).toContainText("Links: 2");
    await expect(provenance).toContainText("file/context: context dependency");
    const provenanceBeforeReload = await provenance.innerText();

    const visibleText = await page.locator("body").innerText();
    expect(visibleText).not.toContain("COMPLETED");
    expect(visibleText).not.toContain("Persisted execution proof");
    expect(visibleText).toContain("NOT PROVEN");

    await page.reload();
    await expect(page.getByText(fixture.answer, { exact: true }).last()).toBeVisible();
    const reloadedProvenance = page.locator('[aria-label="Context provenance"]');
    await expect(reloadedProvenance).toBeVisible();
    await reloadedProvenance.getByRole("button").click();
    await expect(reloadedProvenance).toContainText("Revision: workspace-revision-safe-7");
    await expect(reloadedProvenance).toContainText("Links: 2");
    await expect(reloadedProvenance).toContainText("file/context: context dependency");
    expect(await reloadedProvenance.innerText()).toBe(provenanceBeforeReload);
    const reloadedText = await page.locator("body").innerText();
    expect(reloadedText).not.toContain("/home/runner/");
    expect(reloadedText).not.toContain("provider diagnostics");
  });

  test("keeps the incomplete six-section forensic report and telemetry after reload", async ({
    page,
  }) => {
    const fixture = installIncompleteForensicFixture();
    await installApiFixtures(page, { arabicAi: fixture });
    await programmaticSignIn(page);
    await page.goto(`${DASHBOARD_PATH}ai`);

    const composer = page.locator("textarea").first();
    await composer.fill(fixture.question);
    await composer.locator("xpath=..").getByRole("button").click();

    await expect(page.getByRole("heading", { name: "1) Executive Verdict" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "6) Final Judgment" })).toBeVisible();
    await expect(page.getByText(/Safe terminal reason: SOURCE_COVERAGE_INCOMPLETE/)).toBeVisible();
    await expect(page.getByText("ANALYSIS_INCOMPLETE").last()).toBeVisible();
    const evidenceToggle = page.getByRole("button", { name: /Forensic evidence/ });
    if (await evidenceToggle.getAttribute("aria-expanded") !== "true") {
      await evidenceToggle.click();
    }
    await expect(page.getByText("PROJECT_ROOT", { exact: true })).toBeVisible();
    await expect(page.getByText("e2e-forensic-revision-1", { exact: true })).toBeVisible();
    await expect(page.getByText("skipped", { exact: true })).toBeVisible();
    await expect(page.getByText(/Retry the bounded read before drawing a conclusion/).last()).toBeVisible();

    const beforeReload = await page.locator("body").innerText();
    expect(beforeReload).not.toContain("FINDING PROVEN");
    expect(beforeReload).not.toContain("NO_VERIFIED_FINDING");

    await page.reload();
    // The project-scoped last-session selection restores this conversation
    // without requiring another session-drawer click.
    await expect(page.getByRole("heading", { name: "1) Executive Verdict" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "6) Final Judgment" })).toBeVisible();
    await expect(page.getByText(/Safe terminal reason: SOURCE_COVERAGE_INCOMPLETE/)).toBeVisible();
    await expect(page.getByText("ANALYSIS_INCOMPLETE").last()).toBeVisible();
    const reloadedEvidenceToggle = page.getByRole("button", { name: /Forensic evidence/ });
    if (await reloadedEvidenceToggle.getAttribute("aria-expanded") !== "true") {
      await reloadedEvidenceToggle.click();
    }
    await expect(page.getByText("PROJECT_ROOT", { exact: true })).toBeVisible();
    await expect(page.getByText("e2e-forensic-revision-1", { exact: true })).toBeVisible();
    const afterReload = await page.locator("body").innerText();
    expect(afterReload).not.toContain("FINDING PROVEN");
    expect(afterReload).not.toContain("NO_VERIFIED_FINDING");
  });

  test("keeps the acceptance disposition identical after chat reload", async ({
    page,
  }) => {
    const fixture = installAcceptanceIncompleteFixture();
    await installApiFixtures(page, { arabicAi: fixture });
    await programmaticSignIn(page);
    await page.goto(`${DASHBOARD_PATH}ai`);

    const composer = page.locator("textarea").first();
    await composer.fill(fixture.question);
    await composer.locator("xpath=..").getByRole("button").click();

    const notice = page.getByRole("region", { name: "Acceptance disposition" });
    await expect(notice).toContainText("EXECUTION_ACCEPTANCE_INCOMPLETE");
    await expect(notice).toContainText("Start a new scoped run");
    const beforeReload = await notice.textContent();
    expect(await page.locator("body").innerText()).not.toContain("FINDING PROVEN");

    await page.reload();
    const reloadedNotice = page.getByRole("region", { name: "Acceptance disposition" });
    expect(await reloadedNotice.textContent()).toBe(beforeReload);
    expect(await page.locator("body").innerText()).not.toContain("FINDING PROVEN");
  });

  test("reopens a cancelled forensic report from session history after reload", async ({
    page,
  }) => {
    const fixture = installCancelledForensicFixture();
    await installApiFixtures(page, { arabicAi: fixture });
    await programmaticSignIn(page);
    await page.goto(`${DASHBOARD_PATH}ai`);

    const composer = page.locator("textarea").first();
    await composer.fill(fixture.question);
    await composer.locator("xpath=..").getByRole("button").click();

    for (const heading of [
      "## 1) Executive Verdict",
      "## 2) Evidence Map",
      "## 3) Findings",
      "## 4) Repair Plan",
      "## 5) Validation Checklist",
      "## 6) Final Judgment",
    ]) {
      await expect(page.locator("body")).toContainText(heading);
    }
    await expect(page.getByText(/Safe terminal reason: CANCELLED/).last()).toBeVisible();
    await expect(page.getByText("Cancelled before completion")).toBeVisible();
    await expect(page.getByText("ANALYSIS_INCOMPLETE").last()).toBeVisible();

    const evidenceToggle = page.getByRole("button", { name: /Forensic evidence/ });
    if (await evidenceToggle.getAttribute("aria-expanded") !== "true") {
      await evidenceToggle.click();
    }
    await expect(page.getByText(fixture.source, { exact: true }).last()).toBeVisible();
    await expect(page.getByText("PARTIAL", { exact: true })).toBeVisible();
    await expect(page.getByText("INCOMPLETE", { exact: true }).last()).toBeVisible();
    await expect(page.getByText(/Retry the bounded audit before drawing a conclusion/)).toBeVisible();

    const beforeReload = await page.locator("body").innerText();
    expect(beforeReload).not.toContain("NO_VERIFIED_FINDING");
    expect(beforeReload).not.toContain("FINDING PROVEN");
    expect(beforeReload).not.toContain("Persisted execution proof");
    expect(beforeReload).not.toContain("COMPLETED");
    expect(beforeReload).not.toContain("recovery-provider");
    expect(beforeReload).not.toContain("recovery-provider-model");
    expect(beforeReload).not.toContain(fixture.sessionId);
    expect(beforeReload).not.toContain(fixture.executionId);
    expect(beforeReload).not.toMatch(/(?:\/home\/|\/tmp\/|\/srv\/|\/workspace\/)/);

    await page.reload();
    // The cancelled audit remains the explicit re-selection coverage below;
    // this reload verifies the normal selected-session path.
    await page.getByRole("button", { name: fixture.question, exact: true }).click();
    for (const heading of [
      "## 1) Executive Verdict",
      "## 2) Evidence Map",
      "## 3) Findings",
      "## 4) Repair Plan",
      "## 5) Validation Checklist",
      "## 6) Final Judgment",
    ]) {
      await expect(page.locator("body")).toContainText(heading);
    }
    await expect(page.getByText(/Safe terminal reason: CANCELLED/).last()).toBeVisible();
    await expect(page.getByText("Cancelled before completion")).toBeVisible();
    await expect(page.getByText("ANALYSIS_INCOMPLETE").last()).toBeVisible();

    const reloadedEvidenceToggle = page.getByRole("button", { name: /Forensic evidence/ });
    if (await reloadedEvidenceToggle.getAttribute("aria-expanded") !== "true") {
      await reloadedEvidenceToggle.click();
    }
    await expect(page.getByText(fixture.source, { exact: true }).last()).toBeVisible();
    await expect(page.getByText(/Retry the bounded audit before drawing a conclusion/)).toBeVisible();
    const afterReload = await page.locator("body").innerText();
    expect(afterReload).not.toContain("NO_VERIFIED_FINDING");
    expect(afterReload).not.toContain("FINDING PROVEN");
    expect(afterReload).not.toContain("Persisted execution proof");
    expect(afterReload).not.toContain("COMPLETED");
    expect(afterReload).not.toContain("recovery-provider");
    expect(afterReload).not.toContain("recovery-provider-model");
    expect(afterReload).not.toContain(fixture.sessionId);
    expect(afterReload).not.toContain(fixture.executionId);
    expect(afterReload).not.toMatch(/(?:\/home\/|\/tmp\/|\/srv\/|\/workspace\/)/);
  });

  test("restores a selected historical audit with its linked session after reload", async ({
    page,
  }) => {
    const fixture = installCancelledForensicFixture();
    const historyItem = {
      id: fixture.executionId,
      projectId: "e2e-project",
      sessionId: fixture.sessionId,
      status: "cancelled",
      objective: fixture.question,
      evidenceVerdict: "PARTIAL",
      evidenceReason: "The audit was cancelled during bounded recovery.",
      terminalReason: "CANCELLED",
      proofRequired: true,
      disposition: "RETAIN_FOR_REVIEW",
      recommendedAction: "REVIEW_RETAINED_PROOF",
      resumable: false,
      checkpointVersion: 1,
      createdAt: "2026-01-01T00:01:00.000Z",
      updatedAt: "2026-01-01T00:02:00.000Z",
      completedAt: null,
    };
    const execution = {
      id: fixture.executionId,
      projectId: "e2e-project",
      sessionId: fixture.sessionId,
      status: "cancelled",
      message: fixture.question,
      checkpointVersion: 1,
    };
    await installApiFixtures(page, {
      arabicAi: fixture,
      historicalAudits: {
        audits: [historyItem],
        executions: { [fixture.executionId]: execution },
      },
    });
    await page.addInitScript(
      ({ value }) => localStorage.setItem("eos_ai_selection_e2e-project", value),
      {
        value: JSON.stringify({
          version: 1,
          projectId: "e2e-project",
          kind: "historical-audit",
          executionId: fixture.executionId,
          sessionId: fixture.sessionId,
        }),
      },
    );
    await programmaticSignIn(page);
    await page.goto(`${DASHBOARD_PATH}ai`);

    for (const heading of [
      "## 1) Executive Verdict",
      "## 2) Evidence Map",
      "## 3) Findings",
      "## 4) Repair Plan",
      "## 5) Validation Checklist",
      "## 6) Final Judgment",
    ]) {
      await expect(page.locator("body")).toContainText(heading);
    }
    await expect(page.getByText(/Safe terminal reason: CANCELLED/).last()).toBeVisible();
    await expect(page.getByText("ANALYSIS_INCOMPLETE").last()).toBeVisible();
    await expect(
      page.getByRole("button", { name: `Review audit ${fixture.question}` }),
    ).toHaveClass(/bg-primary\/10/);
    const visibleText = await page.locator("body").innerText();
    expect(visibleText).not.toContain("FINDING PROVEN");
    expect(visibleText).not.toContain("NO_VERIFIED_FINDING");
    expect(visibleText).not.toMatch(/(?:\/home\/|\/tmp\/|\/srv\/|\/workspace\/)/);
  });

  test("clears a project-mismatched last selection instead of showing stale audit content", async ({
    page,
  }) => {
    const fixture = installIncompleteForensicFixture();
    await installApiFixtures(page, { arabicAi: fixture });
    await page.addInitScript(
      ({ value }) => localStorage.setItem("eos_ai_selection_e2e-project", value),
      {
        value: JSON.stringify({
          version: 1,
          projectId: "another-project",
          kind: "session",
          sessionId: fixture.sessionId,
          report: fixture.answer,
        }),
      },
    );
    await programmaticSignIn(page);
    await page.goto(`${DASHBOARD_PATH}ai`);

    await expect(
      page.getByRole("button", { name: fixture.question, exact: true }),
    ).not.toHaveClass(/bg-primary\/10/);
    await expect(page.getByRole("heading", { name: "1) Executive Verdict" }))
      .not.toBeVisible();
    expect(
      await page.evaluate(() => localStorage.getItem("eos_ai_selection_e2e-project")),
    ).toBeNull();
    const visibleText = await page.locator("body").innerText();
    expect(visibleText).not.toContain("ANALYSIS_INCOMPLETE");
    expect(visibleText).not.toContain("FINDING PROVEN");
  });

  test("keeps the AI session drawer overlaid on a phone viewport with accepted evidence", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const fixture = await installArabicAiFixture(page);
    await installApiFixtures(page, { arabicAi: fixture });
    await programmaticSignIn(page);
    await page.goto(`${DASHBOARD_PATH}ai`);

    const composer = page.locator("textarea").first();
    await composer.fill(fixture.question);
    await composer.locator("xpath=..").getByRole("button").click();

    await expect(
      page.getByText(fixture.answer, { exact: true }).last(),
    ).toBeVisible();
    await expect(
      page
        .getByText(`${fixture.source}:42`, { exact: false })
        .last(),
    ).toBeVisible();
    await page
      .locator("summary")
      .filter({ hasText: "Agent activity" })
      .last()
      .click();
    await expect(page.locator("body")).toContainText("Reading source");
    await expect(page.locator("body")).toContainText(fixture.source);
    await expect(page.locator("body")).toContainText(
      "Accepted: source span verified.",
    );
    await expectNoHorizontalOverflow(page);

    const visibleText = await page.locator("body").innerText();
    expect(visibleText).not.toMatch(
      /rawPrompt|systemPrompt|provider diagnostics|source-window|recovery prompt|\/home\/runner/i,
    );
  });

  test("keeps safe citation state across browser back and forward navigation with blocked evidence", async ({
    page,
  }) => {
    const accepted = await installArabicAiFixture(page, {
      sessionId: "e2e-history-accepted-session",
      question: "ما هو سلوك مهلة provider عند الرجوع عبر سجل المتصفح؟",
    });
    const blocked = await installArabicAiFixture(page, {
      blocked: true,
      sessionId: "e2e-history-blocked-session",
      question: "ما هو الدليل المحجوب عند الرجوع عبر سجل المتصفح؟",
    });
    await installApiFixtures(page, {
      arabicAi: accepted,
      alternateAi: blocked,
    });
    await programmaticSignIn(page);
    await page.goto(`${DASHBOARD_PATH}ai`);

    const composer = page.locator("textarea").first();
    await composer.fill(blocked.question);
    await composer.locator("xpath=..").getByRole("button").click();

    await expect(
      page.getByText(blocked.answer, { exact: true }).last(),
    ).toBeVisible();
    await page
      .locator("summary")
      .filter({ hasText: "Agent activity" })
      .last()
      .click();
    await expect(page.locator("body")).toContainText("Reading source");
    const visibleText = await page.locator("body").innerText();
    expect(visibleText).not.toMatch(
      /rawPrompt|systemPrompt|provider diagnostics|source-window|recovery prompt|\/home\/runner/i,
    );
  });

  test("keeps safe citation state when switching projects", async ({
    page,
  }) => {
    const accepted = await installArabicAiFixture(page, {
      sessionId: "e2e-history-accepted-session",
      question: "ما هو سلوك مهلة provider عند الرجوع عبر سجل المتصفح؟",
    });
    const blocked = await installArabicAiFixture(page, {
      blocked: true,
      sessionId: "e2e-history-blocked-session",
      question: "ما هو الدليل المحجوب عند الرجوع عبر سجل المتصفح؟",
    });
    await installApiFixtures(page, {
      arabicAi: accepted,
      alternateAi: blocked,
      projects: [
        {
          id: "e2e-project-one",
          name: "Citation Project One",
          language: "TypeScript",
          framework: "React",
          status: "active",
          rootPath: "/controlled/project-one",
          qualityScore: 92,
        },
        {
          id: "e2e-project-two",
          name: "Citation Project Two",
          language: "TypeScript",
          framework: "React",
          status: "active",
          rootPath: "/controlled/project-two",
          qualityScore: 88,
        },
      ],
    });
    await programmaticSignIn(page);
    await page.goto(`${DASHBOARD_PATH}ai`);

    await page
      .getByRole("button", { name: accepted.question, exact: true })
      .click();
    await expect(
      page.getByText(accepted.answer, { exact: true }).last(),
    ).toBeVisible();
    await expect(
      page.getByText(`${accepted.source}:42`, { exact: false }).last(),
    ).toBeVisible();
    await expect(
      page.getByText("Accepted: source span verified.", { exact: true }).last(),
    ).toBeVisible();

    await page.getByRole("combobox").selectOption("e2e-project-two");
    await expect(
      page.getByRole("button", { name: blocked.question, exact: true }),
    ).toBeVisible();
    await expect(page.getByText(accepted.answer, { exact: true })).toHaveCount(
      0,
    );
    await page
      .getByRole("button", { name: blocked.question, exact: true })
      .click();
    await expect(
      page
        .getByText("Blocked: no matching source text was found.", {
          exact: true,
        })
        .last(),
    ).toBeVisible();
    await expect(
      page.getByText(`${blocked.source}:42`, { exact: false }),
    ).toHaveCount(0);
    await expect(
      page.getByText("Accepted: source span verified.", { exact: true }),
    ).toHaveCount(0);

    await page.getByRole("combobox").selectOption("e2e-project-one");
    await page
      .getByRole("button", { name: accepted.question, exact: true })
      .click();
    await expect(
      page.getByText(`${accepted.source}:42`, { exact: false }).last(),
    ).toBeVisible();
    await expect(
      page.getByText("Accepted: source span verified.", { exact: true }).last(),
    ).toBeVisible();
    await expect(
      page.getByText("Blocked: no matching source text was found.", {
        exact: true,
      }),
    ).toHaveCount(0);

    const visibleText = await page.locator("body").innerText();
    expect(visibleText).not.toMatch(
      /rawPrompt|systemPrompt|provider diagnostics|source-window|recovery prompt|\/home\/runner/i,
    );
  });

  test("keeps safe citation state across repeated navigation", async ({
    page,
  }) => {
    const accepted = await installArabicAiFixture(page, {
      sessionId: "e2e-history-accepted-session",
      question: "ما هو سلوك مهلة provider عند الرجوع عبر سجل المتصفح؟",
    });
    const blocked = await installArabicAiFixture(page, {
      blocked: true,
      sessionId: "e2e-history-blocked-session",
      question: "ما هو الدليل المحجوب عند الرجوع عبر سجل المتصفح؟",
    });
    await installApiFixtures(page, {
      arabicAi: accepted,
      alternateAi: blocked,
    });
    await programmaticSignIn(page);
    await page.goto(`${DASHBOARD_PATH}ai`);

    const assertAcceptedCitation = async () => {
      await expect(
        page.getByText(accepted.answer, { exact: true }).last(),
      ).toBeVisible();
      await expect(
        page.getByText(`${accepted.source}:42`, { exact: false }).last(),
      ).toBeVisible();
      await expect(
        page
          .getByText("Accepted: source span verified.", { exact: true })
          .last(),
      ).toBeVisible();
      await expect(
        page.getByText("Blocked: no matching source text was found.", {
          exact: true,
        }),
      ).toHaveCount(0);
    };
    const assertBlockedCitation = async () => {
      await expect(
        page
          .getByText("Blocked: no matching source text was found.", {
            exact: true,
          })
          .last(),
      ).toBeVisible();
      await expect(
        page.getByText(`${blocked.source}:42`, { exact: false }),
      ).toHaveCount(0);
      await expect(
        page.getByText("Accepted: source span verified.", { exact: true }),
      ).toHaveCount(0);
    };
    const assertNoInternalCitationDetails = async () => {
      const visibleText = await page.locator("body").innerText();
      expect(visibleText).not.toMatch(
        /MISSING_LITERAL_MATCH|rawPrompt|systemPrompt|provider diagnostics|source-window|recovery prompt|\/home\/runner/i,
      );
    };

    await page
      .getByRole("button", { name: accepted.question, exact: true })
      .click();
    await assertAcceptedCitation();

    await openNavigation(page, "Projects", `${DASHBOARD_PATH}projects`);
    await navigateBrowserHistory(page, "back");
    await expect(page).toHaveURL(
      new RegExp(`${DASHBOARD_PATH.replaceAll("/", "\\/")}ai$`),
    );
    await page
      .getByRole("button", { name: accepted.question, exact: true })
      .click();
    await assertAcceptedCitation();
    await assertNoInternalCitationDetails();

    await navigateBrowserHistory(page, "forward");
    await expect(page).toHaveURL(
      new RegExp(`${DASHBOARD_PATH.replaceAll("/", "\\/")}projects$`),
    );
    await navigateBrowserHistory(page, "back");
    await expect(page).toHaveURL(
      new RegExp(`${DASHBOARD_PATH.replaceAll("/", "\\/")}ai$`),
    );
    await page
      .getByRole("button", { name: accepted.question, exact: true })
      .click();
    await assertAcceptedCitation();

    await page
      .getByRole("button", { name: blocked.question, exact: true })
      .click();
    await assertBlockedCitation();

    await openNavigation(page, "Event Stream", `${DASHBOARD_PATH}events`);
    await navigateBrowserHistory(page, "back");
    await expect(page).toHaveURL(
      new RegExp(`${DASHBOARD_PATH.replaceAll("/", "\\/")}ai$`),
    );
    await page
      .getByRole("button", { name: blocked.question, exact: true })
      .click();
    await assertBlockedCitation();
    await assertNoInternalCitationDetails();

    await navigateBrowserHistory(page, "forward");
    await expect(page).toHaveURL(
      new RegExp(`${DASHBOARD_PATH.replaceAll("/", "\\/")}events$`),
    );
    await navigateBrowserHistory(page, "back");
    await expect(page).toHaveURL(
      new RegExp(`${DASHBOARD_PATH.replaceAll("/", "\\/")}ai$`),
    );
    await page
      .getByRole("button", { name: blocked.question, exact: true })
      .click();
    await assertBlockedCitation();
    await assertNoInternalCitationDetails();
  });

  test("keeps only the safe blocked citation reason after chat reload", async ({
    page,
  }) => {
    const fixture = installToolFailureFixture();
    await installApiFixtures(page, { arabicAi: fixture });
    await programmaticSignIn(page);
    await page.goto(`${DASHBOARD_PATH}ai`);

    const composer = page.locator("textarea").first();
    await composer.fill(fixture.question);
    await composer.locator("xpath=..").getByRole("button").click();

    await expect(
      page.getByText(fixture.answer, { exact: true }).last(),
    ).toBeVisible();
    await expect(
      page
        .getByText("required tool did not complete — BLOCKED/INCOMPLETE", {
          exact: false,
        })
        .last(),
    ).toBeVisible();
    await page
      .locator("summary")
      .filter({ hasText: "Agent activity" })
      .last()
      .click();
    await expect(page.locator("body")).toContainText("Reading source");
    await expect(page.locator("body")).toContainText(
      "src/missing-release-fixture.ts",
    );
    await expect(page.locator("body")).toContainText("Tool failed");
    await expect(page.locator("body")).toContainText("TOOL_EXECUTION_FAILED");
    const visibleText = await page.locator("body").innerText();
    expect(visibleText).not.toContain("COMPLETED");
    expect(visibleText).toContain("Persisted execution proof");
    expect(visibleText).toContain("The required source read did not complete.");
  });

  test("keeps the failed AI session drawer overlaid on a phone viewport", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const fixture = installToolFailureFixture();
    await installApiFixtures(page, { arabicAi: fixture });
    await programmaticSignIn(page);
    await page.goto(`${DASHBOARD_PATH}ai`);

    const composer = page.locator("textarea").first();
    await composer.fill(fixture.question);
    await composer.locator("xpath=..").getByRole("button").click();

    await expect(
      page.getByText(fixture.answer, { exact: true }).last(),
    ).toBeVisible();
    await expect(
      page
        .getByText("required tool did not complete — BLOCKED/INCOMPLETE", {
          exact: false,
        })
        .last(),
    ).toBeVisible();
    await page
      .locator("summary")
      .filter({ hasText: "Agent activity" })
      .last()
      .click();
    await expect(page.locator("body")).toContainText("Reading source");
    await expect(page.locator("body")).toContainText(
      "src/missing-release-fixture.ts",
    );
    await expect(page.locator("body")).toContainText("Tool failed");
    await expect(page.locator("body")).toContainText("TOOL_EXECUTION_FAILED");
    const visibleText = await page.locator("body").innerText();
    expect(visibleText).not.toMatch(
      /raw exception|stack trace|\/home\/runner|secret|fixture diagnostic/i,
    );

    await expectNoHorizontalOverflow(page);
  });

  test("preserves one partial answer after a provider disconnect and marks it incomplete", async ({
    page,
  }) => {
    const fixture = installDisconnectedAiFixture();
    await installApiFixtures(page, { disconnectAi: fixture });
    await programmaticSignIn(page);
    await page.goto(`${DASHBOARD_PATH}ai`);

    const composer = page.locator("textarea").first();
    await composer.fill(fixture.question);
    await composer.locator("xpath=..").getByRole("button").click();

    const answer = page.getByText(fixture.answer, { exact: true });
    await expect(answer.last()).toBeVisible();
    await expect(page.getByText("INCOMPLETE:", { exact: false })).toBeVisible();
    await expect(
      page.getByText("provider failure", { exact: false }).last(),
    ).toBeVisible();
    await expect(
      page.getByText("stopped: provider timeout", { exact: false }).last(),
    ).toBeVisible();
    await expect(
      page.getByText("The provider disconnected after visible response text.", {
        exact: true,
      }),
    ).toBeVisible();

    await page.reload();
    await page
      .getByRole("button", { name: fixture.question, exact: true })
      .click();

    await expect(page.getByText(fixture.answer, { exact: true }).last()).toBeVisible();
    await expect(page.getByText("INCOMPLETE:", { exact: false })).toBeVisible();
    await expect(
      page.getByText("provider failure", { exact: false }).last(),
    ).toBeVisible();
    await expect(
      page.getByText("stopped: provider timeout", { exact: false }).last(),
    ).toBeVisible();
    await expect(
      page.getByText("The provider disconnected after visible response text.", {
        exact: true,
      }),
    ).toBeVisible();
  });

  test("preserves one partial answer after an interrupted terminal result", async ({
    page,
  }) => {
    const fixture = installInterruptedAiFixture();
    await installApiFixtures(page, { interruptedAi: fixture });
    await programmaticSignIn(page);
    await page.goto(`${DASHBOARD_PATH}ai`);

    const composer = page.locator("textarea").first();
    await composer.fill(fixture.question);
    await composer.locator("xpath=..").getByRole("button").click();

    const assertInterruptedReplay = async () => {
      await expect(page.getByText(fixture.answer, { exact: true }).last()).toBeVisible();
      await expect(page.getByText("Execution interrupted", { exact: true }).last()).toBeVisible();
      await expect(page.getByText("Connection interrupted", { exact: true }).last()).toBeVisible();
      await expect(page.getByText("INCOMPLETE:", { exact: false }).last()).toBeVisible();
      await expect(page.getByText("stopped: cancelled", { exact: false }).last()).toBeVisible();
      await expect(page.getByText("EXECUTION_CANCELLED", { exact: false }).last()).toBeVisible();
      await expect(page.getByLabel("Agent execution proof")).toHaveCount(0);
      const visibleText = await page.locator("body").innerText();
      expect(visibleText).not.toMatch(
        /raw provider exception|stack trace|\/home\/runner|secret|apiKey=|123e4567-e89b-12d3-a456-426614174000/i,
      );
    };

    await assertInterruptedReplay();

    await page.reload();
    await page
      .getByRole("button", { name: fixture.question, exact: true })
      .click();
    await assertInterruptedReplay();
  });

  test("resumes a failed analysis and keeps the execution incomplete", async ({
    page,
  }) => {
    const { fixture, execution } = installResumedAnalysisFailureFixture();
    await installApiFixtures(page, {
      arabicAi: fixture,
      resumeFailure: { fixture, execution },
    });
    await programmaticSignIn(page);

    await page.evaluate(
      ({ sessionId, executionId, projectId, resumeToken, message }) => {
        localStorage.setItem(
          `eos_ai_execution_current_${projectId}`,
          sessionId,
        );
        localStorage.setItem(
          `eos_ai_execution_${projectId}_${sessionId}`,
          JSON.stringify({
            id: executionId,
            projectId,
            sessionId,
            resumeToken,
            message,
          }),
        );
      },
      {
        sessionId: fixture.sessionId,
        executionId: fixture.executionId,
        projectId: "e2e-project",
        resumeToken: "e2e-resumed-analysis-failure-token-opaque",
        message: fixture.question,
      },
    );
    await page.goto(`${DASHBOARD_PATH}ai`);

    await expect(
      page.getByText("A saved AI execution is ready to resume"),
    ).toBeVisible();
    const resumeRequest = page.waitForRequest(
      (request) =>
        request.url().includes("/api/ai/chat/stream") &&
        request.method() === "POST",
    );
    await page
      .getByLabel("Agent execution proof")
      .getByRole("button", { name: "Resume", exact: true })
      .click();
    const requestBody = JSON.parse(
      (await resumeRequest).postData() ?? "{}",
    ) as Record<string, unknown>;
    expect(requestBody).toEqual(
      expect.objectContaining({
        projectId: "e2e-project",
        sessionId: fixture.sessionId,
        executionId: fixture.executionId,
        resumeToken: "e2e-resumed-analysis-failure-token-opaque",
        message: fixture.question,
      }),
    );

    await expect(
      page.getByText("Failed to send message", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("A saved AI execution is ready to resume"),
    ).toBeVisible();
    const visibleText = await page.locator("body").innerText();
    expect(visibleText).not.toContain("COMPLETED");
    expect(visibleText).not.toContain("Persisted execution proof");
    expect(visibleText).toContain("The required analysis did not complete.");
  });

  test("recovers a missing token after a real stream abort and resumes one execution", async ({
    page,
  }) => {
    const recovery = installInterruptedResumeFixture();
    await installApiFixtures(page, { interruptedResume: recovery });
    await page.addInitScript(() => {
      const nativeFetch = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof Request
              ? input.url
              : String(input);
        const body = typeof init?.body === "string" ? init.body : "";
        if (
          !url.includes("/api/ai/chat/stream") ||
          body.includes('"executionId"')
        ) {
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
              const { done, value } = await reader.read();
              if (done) {
                if (buffered) controller.enqueue(encoder.encode(buffered));
                controller.close();
                return;
              }
              buffered += new TextDecoder().decode(value, { stream: true });
              const marker = buffered.indexOf('"type":"execution_started"');
              const frameEnd =
                marker < 0 ? -1 : buffered.indexOf("\n\n", marker);
              if (frameEnd >= 0) {
                controller.enqueue(
                  encoder.encode(buffered.slice(0, frameEnd + 2)),
                );
                // Let the browser deliver the durable identity frame before
                // simulating the transport failure. Without this yield,
                // Chromium can reject the stream before the client observes
                // execution_started.
                await new Promise((resolve) => setTimeout(resolve, 0));
                controller.error(new TypeError("network connection reset"));
                return;
              }
            }
          },
        });
        return new Response(stream, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      };
    });
    await programmaticSignIn(page);
    await page.goto(`${DASHBOARD_PATH}ai`);

    const streamRequests: Array<Record<string, unknown>> = [];
    page.on("request", (request) => {
      if (
        request.url().includes("/api/ai/chat/stream") &&
        request.method() === "POST"
      ) {
        try {
          streamRequests.push(
            request.postDataJSON() as Record<string, unknown>,
          );
        } catch {
          // Ignore requests without a JSON body; the assertions below require
          // both journey requests to have a valid request envelope.
        }
      }
    });

    const composer = page.locator("textarea").first();
    await composer.fill(recovery.fixture.question);
    await composer.locator("xpath=..").getByRole("button").click();

    await expect(
      page.getByText(
        "Execution paused — ready to resume from its durable checkpoint",
        {
          exact: true,
        },
      ),
    ).toBeVisible();
    const executionProof = page.getByLabel("Agent execution proof");
    await expect(executionProof).toBeVisible();
    await expect(
      executionProof.getByRole("button", { name: "Resume", exact: true }),
    ).toBeVisible();

    const storageKey =
      "eos_ai_execution_e2e-project_e2e-interrupted-resume-session";
    const pointerKey = "eos_ai_execution_current_e2e-project";
    await expect
      .poll(() => page.evaluate((key) => localStorage.getItem(key), storageKey))
      .toContain(recovery.initialToken);

    await page.evaluate(
      ({ storageKey, pointerKey }) => {
        const saved = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
        delete saved.resumeToken;
        localStorage.setItem(storageKey, JSON.stringify(saved));
        localStorage.setItem(pointerKey, "e2e-interrupted-resume-session");
      },
      { storageKey, pointerKey },
    );
    await page.reload();

    await expect(
      page.getByText("A saved AI execution is ready to resume", {
        exact: true,
      }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate((key) => {
          const saved = JSON.parse(localStorage.getItem(key) ?? "{}");
          return saved.resumeToken;
        }, storageKey),
      )
      .toBe(recovery.recoveredToken);

    await executionProof
      .getByRole("button", { name: "Resume", exact: true })
      .click();
    await expect(
      page.getByText(recovery.fixture.answer, { exact: true }),
    ).toBeVisible();
    const evidenceButton = page.getByRole("button", {
      name: /Forensic evidence/,
    });
    await expect(evidenceButton).toBeVisible();
    await expect(evidenceButton).toHaveAttribute("aria-expanded", "true");
    await expect(
      page.getByText("Telemetry reconciliation", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("EVIDENCE_INTEGRITY_OK", { exact: true })).toBeVisible();
    await expect.poll(() => streamRequests.length).toBe(2);
    expect(streamRequests[0]).toEqual(
      expect.objectContaining({
        projectId: "e2e-project",
        message: recovery.fixture.question,
      }),
    );
    expect(streamRequests[0]?.executionId).toBeUndefined();
    expect(streamRequests[0]?.sessionId).toBeUndefined();
    expect(streamRequests[1]).toEqual(
      expect.objectContaining({
        projectId: "e2e-project",
        sessionId: recovery.fixture.sessionId,
        executionId: recovery.fixture.executionId,
        resumeToken: recovery.recoveredToken,
        message: recovery.fixture.question,
      }),
    );
    expect(
      streamRequests.map((request) => request.executionId).filter(Boolean),
    ).toEqual([recovery.fixture.executionId]);
    const visibleText = await page.locator("body").innerText();
    expect(visibleText).not.toMatch(
      /(?:provider[_ ](?:diagnostic|error)|internal prompt|stack trace|\/home\/runner\/|\/tmp\/|(?:^|\s)at\s+(?:\/|[A-Za-z]:\\))/i,
    );
  });

  test("projects delivery recovery states safely after reload", async ({
    page,
  }) => {
    const recovery = {
      requests: [] as string[],
      operations: [
        {
          proposalId: "e2e-recovery-available-proposal",
          operationId: "e2e-recovery-available-operation",
          sessionId: "e2e-recovery-available-session",
          lifecycle: "blocked",
          status: "pending",
          createdAt: "2026-01-01T00:03:00.000Z",
          recoveryState: "recoverable",
          operatorExplanation:
            "The delivery stopped because validation needs to be run again.",
          nextAction:
            "Resume validation to re-check the saved changes, or discard this recovery if it is no longer needed.",
          conflictReason: null,
          validationEvidence: [{ profile: "workspace-typecheck", status: "failed" }],
          workspaceAvailable: true,
          changeCount: 2,
        },
        {
          proposalId: "e2e-recovery-missing-proposal",
          operationId: "e2e-recovery-missing-operation",
          sessionId: "e2e-recovery-missing-session",
          lifecycle: "abandoned",
          status: "pending",
          createdAt: "2026-01-01T00:02:00.000Z",
          recoveryState: "missing_workspace",
          operatorExplanation:
            "The saved delivery workspace is no longer available, so recovery cannot continue.",
          nextAction:
            "Start a new delivery from the current project rather than retrying this recovery.",
          conflictReason: "Workspace expired after the runner was recycled.",
          validationEvidence: null,
          workspaceAvailable: false,
          changeCount: 1,
        },
        {
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
          changeCount: 3,
        },
      ],
    };
    await installApiFixtures(page, { deliveryRecovery: recovery });
    await programmaticSignIn(page);
    await page.goto(`${DASHBOARD_PATH}ai`);

    const region = page.getByRole("region", {
      name: "Recoverable delivery operations",
    });
    await expect(region).toBeVisible();
    await expect(region.getByText("Recoverable", { exact: true })).toBeVisible();
    await expect(
      region.getByText("Workspace unavailable", { exact: true }),
    ).toBeVisible();
    await expect(
      region.getByText("Already discarded", { exact: true }),
    ).toBeVisible();
    await expect(
      region.getByText(
        "The saved delivery workspace is no longer available, so recovery cannot continue.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      region.getByText("This delivery recovery was already discarded.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      region.getByText(
        "Retained reason: Workspace expired after the runner was recycled.",
        { exact: true },
      ),
    ).toBeVisible();

    const available = region.locator(
      '[data-operation-id="e2e-recovery-available-operation"]',
    );
    const missing = region.locator(
      '[data-operation-id="e2e-recovery-missing-operation"]',
    );
    const discarded = region.locator(
      '[data-operation-id="e2e-recovery-discarded-operation"]',
    );
    await expect(available).toHaveAttribute(
      "data-recovery-state",
      "recoverable",
    );
    await expect(missing).toHaveAttribute(
      "data-recovery-state",
      "missing_workspace",
    );
    await expect(discarded).toHaveAttribute(
      "data-recovery-state",
      "discarded",
    );
    await expect(available.getByRole("button", { name: "Resume validation" })).toBeEnabled();
    await expect(available.getByRole("button", { name: "Discard workspace" })).toBeEnabled();
    await expect(missing.getByRole("button", { name: "Resume validation" })).toBeDisabled();
    await expect(missing.getByRole("button", { name: "Discard workspace" })).toBeDisabled();
    await expect(discarded.getByRole("button", { name: "Resume validation" })).toBeDisabled();
    await expect(discarded.getByRole("button", { name: "Discard workspace" })).toBeDisabled();

    const visibleText = await page.locator("body").innerText();
    expect(visibleText).not.toMatch(
      /\/home\/runner|\/tmp\/|\/workspace\/|internal diagnostic/i,
    );
    await expectNoHorizontalOverflow(page);

    await page.reload();
    const reloadedRegion = page.getByRole("region", {
      name: "Recoverable delivery operations",
    });
    await expect(reloadedRegion).toBeVisible();
    await expect(
      reloadedRegion
        .locator('[data-operation-id="e2e-recovery-missing-operation"]')
        .getByRole("button", { name: "Resume validation" }),
    ).toBeDisabled();
    await expect(
      reloadedRegion
        .locator('[data-operation-id="e2e-recovery-discarded-operation"]')
        .getByRole("button", { name: "Discard workspace" }),
    ).toBeDisabled();
    expect(recovery.requests.length).toBeGreaterThanOrEqual(2);
    expect(recovery.requests.every((url) => url.includes("projectId=e2e-project"))).toBe(true);
  });

  test("explains when delivery recovery loses a race and refreshes state", async ({
    page,
  }) => {
    const recovery = {
      requests: [] as string[],
      actionRequests: [] as string[],
      operations: [
        {
          proposalId: "e2e-recovery-race-proposal",
          operationId: "e2e-recovery-race-operation",
          sessionId: "e2e-recovery-race-session",
          lifecycle: "blocked",
          status: "pending",
          createdAt: "2026-01-01T00:04:00.000Z",
          recoveryState: "recoverable",
          operatorExplanation:
            "The delivery stopped because the retained changes need review before validation can continue.",
          nextAction:
            "Resume validation to re-check the saved changes, or discard this recovery if it is no longer needed.",
          conflictReason: null,
          validationEvidence: [{ profile: "workspace-typecheck", status: "failed" }],
          workspaceAvailable: true,
          changeCount: 1,
        },
      ],
      recoveryAction: {
        proposalId: "e2e-recovery-race-proposal",
        action: "resume-validation" as const,
        response: {
          error: "This delivery recovery was already discarded.",
          code: "DELIVERY_ALREADY_DISCARDED",
          lifecycle: "cancelled",
          recoveryState: "discarded",
          nextAction: "No action is required.",
          diagnostic: "Do not render this server detail.",
        },
        nextOperations: [
          {
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
            changeCount: 1,
          },
        ],
      },
    };
    await installApiFixtures(page, { deliveryRecovery: recovery });
    await programmaticSignIn(page);
    await page.goto(`${DASHBOARD_PATH}ai`);

    const region = page.getByRole("region", {
      name: "Recoverable delivery operations",
    });
    const operation = region.locator(
      '[data-operation-id="e2e-recovery-race-operation"]',
    );
    await expect(operation.getByRole("button", { name: "Resume validation" })).toBeEnabled();
    await operation.getByRole("button", { name: "Resume validation" }).click();

    await expect(page.getByText("Recovery state changed", { exact: true })).toBeVisible();
    await expect(
      page.getByText(
        "This recovery was already discarded. The recovery list was refreshed.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect
      .poll(() => recovery.requests.length)
      .toBeGreaterThanOrEqual(2);
    await expect(operation).toHaveAttribute("data-recovery-state", "discarded");
    expect(recovery.actionRequests).toHaveLength(1);
    expect(recovery.actionRequests[0]).toContain(
      "/api/ai/delivery/e2e-recovery-race-proposal/resume-validation",
    );
    expect(await region.locator('[data-operation-id="e2e-recovery-race-operation"]').count()).toBe(1);
    const visibleText = await page.locator("body").innerText();
    expect(visibleText).not.toMatch(/Do not render this server detail|\/home\/runner|\/tmp\//i);
    await expectNoHorizontalOverflow(page);
  });

  test("explains when an old recovery link points to a deleted operation", async ({
    page,
  }) => {
    const recovery = {
      requests: [] as string[],
      actionRequests: [] as string[],
      operations: [
        {
          proposalId: "e2e-recovery-deleted-proposal",
          operationId: "e2e-recovery-deleted-operation",
          sessionId: "e2e-recovery-deleted-session",
          lifecycle: "blocked",
          status: "pending",
          createdAt: "2026-01-01T00:05:00.000Z",
          recoveryState: "recoverable",
          operatorExplanation:
            "The delivery stopped because the retained changes need review before validation can continue.",
          nextAction:
            "Resume validation to re-check the saved changes, or discard this recovery if it is no longer needed.",
          conflictReason: null,
          validationEvidence: [{ profile: "workspace-typecheck", status: "failed" }],
          workspaceAvailable: true,
          changeCount: 1,
        },
      ],
      recoveryAction: {
        proposalId: "e2e-recovery-deleted-proposal",
        action: "resume-validation" as const,
        status: 404,
        response: {
          error: "Delivery operation not found",
          code: "DELIVERY_NOT_FOUND",
          diagnostic: "Do not render this server detail.",
        },
        nextOperations: [],
      },
    };
    await installApiFixtures(page, { deliveryRecovery: recovery });
    await programmaticSignIn(page);
    await page.goto(`${DASHBOARD_PATH}ai`);

    const region = page.getByRole("region", {
      name: "Recoverable delivery operations",
    });
    const operation = region.locator(
      '[data-operation-id="e2e-recovery-deleted-operation"]',
    );
    await expect(operation.getByRole("button", { name: "Resume validation" })).toBeEnabled();
    await operation.getByRole("button", { name: "Resume validation" }).click();

    await expect(page.getByText("Recovery link expired", { exact: true })).toBeVisible();
    await expect(
      page.getByText(
        "This recovery operation no longer exists. The recovery list was refreshed.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect.poll(() => recovery.requests.length).toBeGreaterThanOrEqual(2);
    await expect.poll(() => region.count()).toBe(0);
    expect(recovery.actionRequests).toHaveLength(1);
    expect(recovery.actionRequests[0]).toContain(
      "/api/ai/delivery/e2e-recovery-deleted-proposal/resume-validation",
    );
    const visibleText = await page.locator("body").innerText();
    expect(visibleText).not.toMatch(
      /Delivery operation not found|Do not render this server detail|\/home\/runner|\/tmp\//i,
    );
    await expectNoHorizontalOverflow(page);
  });

  test("keeps the resumed AI session drawer overlaid on a phone viewport", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const fixture = await installArabicAiFixture(page);
    await installApiFixtures(page, { arabicAi: fixture });
    await programmaticSignIn(page);
    await page.goto(`${DASHBOARD_PATH}ai`);

    const composer = page.locator("textarea").first();
    await expect(composer).toBeVisible();
    const beforeOpen = await composer.boundingBox();
    expect(beforeOpen?.width).toBeGreaterThan(250);

    await page.getByRole("button", { name: "Open sessions" }).click();
    await expect(page.getByText("Sessions", { exact: true })).toBeVisible();
    const drawer = page
      .getByText("Sessions", { exact: true })
      .locator("..")
      .locator("..");
    const drawerBox = await drawer.boundingBox();
    expect(drawerBox?.width).toBeLessThanOrEqual(390);
    const duringOpen = await composer.boundingBox();
    expect(duringOpen?.width).toBeGreaterThan(250);

    await page.getByRole("button", { name: "Close sidebar" }).click();
    await expect(
      page.getByRole("button", { name: "Open sessions" }),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("keeps all provider cards and controls reachable at narrow phone widths", async ({
    page,
  }) => {
    const fixture = await installArabicAiFixture(page);
    await installApiFixtures(page, { arabicAi: fixture });
    await programmaticSignIn(page);

    for (const width of [320, 390]) {
      const viewport = { width, height: 844 };
      await page.setViewportSize(viewport);
      await page.goto(`${DASHBOARD_PATH}ai`);

      const composer = page.locator("textarea").first();
      await expect(composer).toBeVisible();
      await expectWithinViewport(composer, viewport, `composer at ${width}px`);

      await page.getByRole("button", { name: "Open sessions" }).click();
      const drawer = page.getByTestId("sessions-drawer");
      await expect(drawer).toBeVisible();
      await expectWithinViewport(drawer, viewport, `sessions drawer at ${width}px`);
      const drawerBox = await drawer.boundingBox();
      expect(drawerBox?.height, `sessions drawer height at ${width}px`).toBeGreaterThan(
        viewport.height * 0.8,
      );
      await expectNoHorizontalOverflow(page);

      const providerCards = drawer.locator(".provider-key-card");
      await expect(providerCards).toHaveCount(4);
      for (const provider of ["OpenRouter", "Gemini", "DeepSeek", "Groq"]) {
        const card = providerCards.filter({
          hasText: `${provider} API Key`,
        });
        await expect(card).toHaveCount(1);
        await card.scrollIntoViewIfNeeded();
        await expect(card).toBeVisible();

        const input = card.locator('input[type="password"]');
        const save = card.getByRole("button", { name: "Save", exact: true });
        await expect(input).toBeVisible();
        await expect(save).toBeVisible();
        await input.scrollIntoViewIfNeeded();
        await save.evaluate((element) =>
          element.scrollIntoView({ block: "center", inline: "nearest" }),
        );
        await expectWithinViewport(
          input,
          viewport,
          `${provider} key input at ${width}px`,
        );
        await expectWithinViewport(
          save,
          viewport,
          `${provider} Save control at ${width}px`,
        );
      }

      await expectWithinViewport(composer, viewport, `composer with drawer at ${width}px`);
      await expectNoHorizontalOverflow(page);
      await page.getByRole("button", { name: "Close sidebar" }).click();
      await expect(drawer).toBeHidden();
    }
  });

  test("renders a user-visible API failure state", async ({ page }) => {
    await installApiFixtures(page);
    await programmaticSignIn(page);
    await page.route("**/api/dashboard", (route) =>
      route.fulfill(
        jsonResponse({ error: "controlled dashboard outage" }, 503),
      ),
    );
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Failed to load dashboard" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Retry Connection" }),
    ).toBeVisible();
  });
});
