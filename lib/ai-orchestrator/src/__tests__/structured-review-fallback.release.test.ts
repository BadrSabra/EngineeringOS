/**
 * Provider-free release coverage for structured code-review fallback.
 *
 * These fixtures deliberately cross the OpenRouter HTTP boundary instead of
 * mocking agentComplete. That keeps the check useful when model selection,
 * catalog refresh, transport classification, or reviewer parsing changes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reviewCode } from "../agents/code-reviewer.js";
import { _resetCircuitsForTest } from "../openrouter/circuit-breaker.js";
import {
  _resetOpenRouterCredentialCooldownsForTest,
  _setOpenRouterCredentialCooldownPersistenceForTest,
} from "../openrouter/credential-cooldown.js";
import { _resetForTest, getDynamicCatalogStatus } from "../openrouter/dynamic-catalog.js";
import { FREE_MODELS } from "../openrouter/model-catalog.js";
import { _resetModelLaneSchedulerForTest } from "../openrouter/model-resolver.js";
import { _setModelCooldownPersistenceForTest } from "../openrouter/model-cooldown-store.js";

const selectedFile = "src/example.ts";
const reviewContext = {
  project: "Small TypeScript utility project",
  recentTasks: "No recent tasks",
  latestMetrics: "No metrics available",
  graphSummary: "No graph entities",
  recentEvents: "No recent events",
  workflows: "No workflows",
  metricsVerified: false,
};

const reviewWithFinding = JSON.stringify({
  summary: "The selected file contains a small maintainability issue.",
  overallScore: 70,
  strengths: [
    "The function has a clear name.",
    "The selected module has a narrow responsibility.",
    "The current behavior is easy to reproduce.",
  ],
  issues: [{
    type: "style",
    severity: "low",
    file: selectedFile,
    title: "Use a named constant",
    description: "The value is declared inline.",
    suggestion: "Give the value a descriptive name.",
  }],
  refactoringOpportunities: ["Extract the inline value into a named constant."],
  securityConcerns: ["No security concern was found in the selected file."],
  verdict: "needs_changes",
});

const reviewModels = FREE_MODELS
  .filter((model) => model.capabilities.includes("json"))
  .slice(-3);

function resetRoutingState(): void {
  _resetCircuitsForTest();
  _resetOpenRouterCredentialCooldownsForTest();
  _resetModelLaneSchedulerForTest();
  _resetForTest();
}

const fixtureCredentialCooldownKey = "0123456789abcdef".repeat(4);
let previousCredentialCooldownKey: string | undefined;

function installIsolatedCooldownPersistence(): void {
  previousCredentialCooldownKey = process.env.AI_CREDENTIALS_ENCRYPTION_KEY;
  process.env.AI_CREDENTIALS_ENCRYPTION_KEY = fixtureCredentialCooldownKey;
  _setModelCooldownPersistenceForTest({
    readActive: async () => [],
    write: async () => {},
    clear: async () => {},
  });
  _setOpenRouterCredentialCooldownPersistenceForTest({
    readActive: async () => null,
    write: async () => {},
  });
}

if (reviewModels.length < 3) {
  throw new Error("The structured-review release fixture requires three JSON-capable catalog models.");
}

type FixtureResponse = Response;

function jsonResponse(body: unknown, status = 200, headers?: Headers): FixtureResponse {
  const responseHeaders = new Headers(headers);
  if (!responseHeaders.has("content-type")) {
    responseHeaders.set("content-type", "application/json");
  }
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders,
  });
}

function catalogResponse(): FixtureResponse {
  return jsonResponse({
    data: reviewModels.map((model) => ({
      id: model.id,
      pricing: { prompt: "0", completion: "0" },
      supported_parameters: ["response_format", "structured_outputs"],
    })),
  });
}

function installOpenRouterFixture(
  completion: (model: string, callNumber: number) => FixtureResponse,
  options: { catalog?: () => Promise<FixtureResponse> } = {},
) {
  const completionCalls: string[] = [];
  const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
    if (String(url).endsWith("/models")) {
      return options.catalog ? await options.catalog() : catalogResponse();
    }

    const body = JSON.parse(String(init?.body ?? "{}")) as { model?: string };
    const model = String(body.model ?? "");
    completionCalls.push(model);
    return completion(model, completionCalls.length);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { completionCalls, fetchMock };
}

async function runReview() {
  return reviewCode(
    reviewContext,
    { [selectedFile]: "export const value = 1;" },
    {
      provider: "openrouter",
      apiKey: "provider-free-fixture-key",
      qualityProfile: "code_review",
    },
  );
}

describe("structured review provider fallback release check", () => {
  beforeEach(() => {
    resetRoutingState();
    installIsolatedCooldownPersistence();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    _setModelCooldownPersistenceForTest(undefined);
    _setOpenRouterCredentialCooldownPersistenceForTest(undefined);
    if (previousCredentialCooldownKey === undefined) {
      delete process.env.AI_CREDENTIALS_ENCRYPTION_KEY;
    } else {
      process.env.AI_CREDENTIALS_ENCRYPTION_KEY = previousCredentialCooldownKey;
    }
    resetRoutingState();
  });

  const transportFailureCases: Array<{
    name: string;
    firstResponse: () => FixtureResponse;
    failureResponseCount?: number;
    terminal?: boolean;
  }> = [
    {
      name: "reasoning-only response",
      firstResponse: () => jsonResponse({
        choices: [{
          message: {
            content: null,
            reasoning_content: "The model reasoned but did not produce a final answer.",
          },
        }],
      }),
    },
    {
      name: "agent-harness response",
      firstResponse: () => jsonResponse({
        error: {
          code: "agent_only",
          message: "This model is only available through an agent harness.",
        },
      }, 400),
      // The unavailable candidate gets one response; recovery must use the
      // single permitted alternate rather than expanding the model chain.
      failureResponseCount: 1,
    },
    {
      name: "rate-limit response",
      firstResponse: () => jsonResponse({
        error: { message: "Too many requests; try again later." },
      }, 429, new Headers({ "Retry-After": "1" })),
      terminal: true,
    },
    {
      name: "empty response",
      firstResponse: () => jsonResponse({
        choices: [{ message: { content: "" } }],
      }),
    },
  ];

  it.each(transportFailureCases)(
    "handles a $name according to provider fallback policy",
    async ({ firstResponse, failureResponseCount = 1, terminal = false }) => {
      const { completionCalls } = installOpenRouterFixture((model, callNumber) =>
        callNumber <= failureResponseCount ? firstResponse() : jsonResponse({
          choices: [{ message: { content: reviewWithFinding } }],
          model,
          usage: {},
        }),
      );

      if (terminal) {
        await expect(runReview()).rejects.toMatchObject({ code: "RATE_LIMITED" });
        expect(completionCalls).toHaveLength(1);
        expect(reviewModels.some((model) => model.id === completionCalls[0])).toBe(true);
        return;
      }

      const result = await runReview();

      expect(result._parseError).toBeUndefined();
      expect(result.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ file: selectedFile }),
      ]));
      // The reviewer may spend its remaining quality-retry budget on the
      // successful fallback response. The transport fallback itself must
      // still be the first transition to a different model.
      expect(completionCalls.length).toBeGreaterThanOrEqual(failureResponseCount + 1);
      expect(completionCalls.some((model, index) => index > 0 && model !== completionCalls[0])).toBe(true);
    },
  );

  it("marks malformed structured output terminally incomplete instead of completing a review", async () => {
    const { completionCalls } = installOpenRouterFixture(() =>
      jsonResponse({
        choices: [{ message: { content: "{ malformed review output" } }],
      }),
    );

    const result = await runReview();

    expect(result._parseError).toMatchObject({ code: "MALFORMED_JSON" });
    expect(result._parseError?.message).toBeTruthy();
    expect(result.issues).toEqual([]);
    expect(completionCalls.length).toBeGreaterThanOrEqual(2);
  });
});

describe("structured review catalog refresh release check", () => {
  beforeEach(() => {
    resetRoutingState();
    installIsolatedCooldownPersistence();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    _setModelCooldownPersistenceForTest(undefined);
    _setOpenRouterCredentialCooldownPersistenceForTest(undefined);
    if (previousCredentialCooldownKey === undefined) {
      delete process.env.AI_CREDENTIALS_ENCRYPTION_KEY;
    } else {
      process.env.AI_CREDENTIALS_ENCRYPTION_KEY = previousCredentialCooldownKey;
    }
    resetRoutingState();
  });

  const catalogFailureCases: Array<{
    name: string;
    catalog: () => Promise<FixtureResponse>;
    expectedStatus: "failed" | "empty";
  }> = [
    {
      name: "network failure",
      catalog: async () => {
        throw new Error("fixture catalog unavailable");
      },
      expectedStatus: "failed",
    },
    {
      name: "non-200 response",
      catalog: async () => jsonResponse({ error: "catalog unavailable" }, 503),
      expectedStatus: "failed",
    },
    {
      name: "empty response",
      catalog: async () => jsonResponse({ data: [] }),
      expectedStatus: "empty",
    },
    {
      name: "malformed response",
      catalog: async () => new Response("{ malformed", { status: 200 }),
      expectedStatus: "failed",
    },
  ];

  it.each(catalogFailureCases)(
    "fails closed when live JSON-Schema capability cannot be verified after a $name",
    async ({ catalog, expectedStatus }) => {
      const { completionCalls } = installOpenRouterFixture(
        (model) => jsonResponse({
          choices: [{ message: { content: reviewWithFinding } }],
          model,
          usage: {},
        }),
        { catalog },
      );

      await expect(runReview()).rejects.toMatchObject({ code: "INVALID_CONFIG" });
      const catalogStatus = getDynamicCatalogStatus();

      expect(completionCalls).toHaveLength(0);
      expect(catalogStatus.lastRefreshStatus).toBe(expectedStatus);
      expect(catalogStatus.usable).toBe(false);
    },
  );
});