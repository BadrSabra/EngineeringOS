/**
 * Provider-free release coverage for structured code-review fallback.
 *
 * These fixtures deliberately cross the OpenRouter HTTP boundary instead of
 * mocking agentComplete. That keeps the check useful when model selection,
 * catalog refresh, transport classification, or reviewer parsing changes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reviewCode } from "../agents/code-reviewer.js";
import { _resetForTest, getDynamicCatalogStatus } from "../openrouter/dynamic-catalog.js";
import { FREE_MODELS } from "../openrouter/model-catalog.js";

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

if (reviewModels.length < 3) {
  throw new Error("The structured-review release fixture requires three JSON-capable catalog models.");
}

type FixtureResponse = {
  ok: boolean;
  status: number;
  headers?: Headers;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
};

function jsonResponse(body: unknown, status = 200, headers?: Headers): FixtureResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function catalogResponse(): FixtureResponse {
  return jsonResponse({
    data: reviewModels.map((model) => ({
      id: model.id,
      pricing: { prompt: "0", completion: "0" },
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
    _resetForTest();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const transportFailureCases: Array<{
    name: string;
    firstResponse: () => FixtureResponse;
    failureResponseCount?: number;
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
      // JSON-mode incompatibility is retried once without response_format
      // before the fallback chain advances.
      failureResponseCount: 2,
    },
    {
      name: "rate-limit response",
      firstResponse: () => jsonResponse({
        error: { message: "Too many requests; try again later." },
      }, 429, new Headers({ "Retry-After": "1" })),
    },
    {
      name: "empty response",
      firstResponse: () => jsonResponse({
        choices: [{ message: { content: "" } }],
      }),
    },
  ];

  it.each(transportFailureCases)(
    "falls back after a $name and returns a cited finding",
    async ({ firstResponse, failureResponseCount = 1 }) => {
      const { completionCalls } = installOpenRouterFixture((model, callNumber) =>
        callNumber <= failureResponseCount ? firstResponse() : jsonResponse({
          choices: [{ message: { content: reviewWithFinding } }],
          model,
          usage: {},
        }),
      );

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
    _resetForTest();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
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
      catalog: async () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error("fixture catalog JSON is malformed");
        },
        text: async () => "{ malformed",
      }),
      expectedStatus: "failed",
    },
  ];

  it.each(catalogFailureCases)(
    "keeps static compatibility routing after a $name",
    async ({ catalog, expectedStatus }) => {
      const { completionCalls } = installOpenRouterFixture(
        (model) => jsonResponse({
          choices: [{ message: { content: reviewWithFinding } }],
          model,
          usage: {},
        }),
        { catalog },
      );

      const result = await runReview();
      const catalogStatus = getDynamicCatalogStatus();

      expect(result._parseError).toBeUndefined();
      expect(result.issues[0]?.file).toBe(selectedFile);
      // A valid structured review can receive bounded quality retries; the
      // catalog failure must not add another model or prevent completion.
      expect(completionCalls.length).toBeGreaterThanOrEqual(1);
      expect(new Set(completionCalls)).toHaveProperty("size", 1);
      expect(catalogStatus.lastRefreshStatus).toBe(expectedStatus);
      expect(catalogStatus.usable).toBe(false);
    },
  );
});