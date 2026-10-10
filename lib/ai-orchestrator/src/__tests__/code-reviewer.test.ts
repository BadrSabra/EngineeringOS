import { describe, expect, it, vi } from "vitest";

const { agentComplete } = vi.hoisted(() => ({
  agentComplete: vi.fn(),
}));

vi.mock("../agent-complete.js", () => ({ agentComplete }));

import { reviewCode } from "../agents/code-reviewer.js";
import { buildCodeReviewSystemPrompt } from "../prompts/review.prompt.js";

const context = {
  project: "Small TypeScript utility project",
  recentTasks: "No recent tasks",
  latestMetrics: "No metrics available",
  graphSummary: "No graph entities",
  recentEvents: "No recent events",
  workflows: "No workflows",
  metricsVerified: false,
};

const baseReview = {
  summary: "The selected file was reviewed.",
  overallScore: 70,
  strengths: ["The function has a clear name."],
  refactoringOpportunities: [],
  securityConcerns: [],
  verdict: "needs_changes",
} as const;

describe("reviewCode selected-file acceptance", () => {
  it("provides a syntactically valid JSON example in the system prompt", () => {
    const prompt = buildCodeReviewSystemPrompt();
    const block = prompt.match(/```json\s*([\s\S]*?)\s*```/i)?.[1];
    expect(block).toBeDefined();
    expect(() => JSON.parse(block!)).not.toThrow();
  });

  it("marks a valid-looking empty finding list as a quality rejection", async () => {
    agentComplete.mockResolvedValue({
      content: JSON.stringify({ ...baseReview, issues: [] }),
    });

    const result = await reviewCode(
      context,
      { "src/example.ts": "export const value = 1;" },
      { provider: "openrouter", apiKey: "test-key", qualityProfile: "code_review" },
    );

    expect(result._qualityError).toMatchObject({
      code: "QUALITY_REVIEW_LOW",
    });
    expect(result._qualityError?.reasons.join(" ")).toContain("without findings");
  });

  it("accepts a finding that cites one of the selected files", async () => {
    agentComplete.mockResolvedValue({
      content: JSON.stringify({
        ...baseReview,
        issues: [{
          type: "style",
          severity: "low",
          file: "src/example.ts",
          title: "Use a named constant",
          description: "The value is declared inline.",
          suggestion: "Give the value a descriptive name.",
        }],
      }),
    });

    const result = await reviewCode(
      context,
      { "src/example.ts": "export const value = 1;" },
      { provider: "openrouter", apiKey: "test-key", qualityProfile: "code_review" },
    );

    expect(result._parseError).toBeUndefined();
    expect(result.issues[0]?.file).toBe("src/example.ts");
    expect(result.reviewScope).toMatchObject({
      mode: "SELECTED_FILES",
      selectedFiles: {
        received: 1,
        included: 1,
        omitted: 0,
        clippedExcerpts: 0,
      },
    });
  });

  it("accepts a concise clean review when its complete contract is coherent", async () => {
    agentComplete.mockResolvedValue({
      content: JSON.stringify({
        summary: "No actionable defects were found in the reviewed project evidence.",
        overallScore: 92,
        strengths: [],
        issues: [],
        refactoringOpportunities: [],
        securityConcerns: [],
        verdict: "approved",
      }),
    });

    const result = await reviewCode(context, undefined, {
      provider: "openrouter",
      apiKey: "test-key",
      qualityProfile: "code_review",
    });

    expect(result._parseError).toBeUndefined();
    expect(result._qualityError).toBeUndefined();
    expect(result.verdict).toBe("approved");
  });

  it("requests strict OpenRouter JSON Schema and normalizes null file paths", async () => {
    agentComplete.mockResolvedValue({
      content: JSON.stringify({
        ...baseReview,
        issues: [{
          type: "bug",
          severity: "low",
          file: null,
          title: "Handle the empty input",
          description: "The function does not define behavior for an empty value.",
          suggestion: "Add an explicit empty-input check.",
        }],
      }),
    });

    const result = await reviewCode(context, undefined, {
      provider: "openrouter",
      apiKey: "test-key",
    });

    expect(result._parseError).toBeUndefined();
    expect(result.issues[0]?.file).toBeUndefined();
    expect(agentComplete).toHaveBeenLastCalledWith(
      expect.any(Array),
      expect.objectContaining({
        responseFormat: expect.objectContaining({
          type: "json_schema",
          json_schema: expect.objectContaining({ name: "engineeringos_code_review", strict: true }),
        }),
      }),
    );
  });

  it("does not normalize unknown issue enums into a passing review", async () => {
    agentComplete.mockResolvedValue({
      content: JSON.stringify({
        ...baseReview,
        issues: [{
          type: "warning",
          severity: "info",
          file: "src/example.ts",
          title: "Unsupported issue",
          description: "The provider used unsupported enums.",
          suggestion: "Return one of the declared enum values.",
        }],
      }),
    });

    const result = await reviewCode(context, undefined, {
      provider: "openrouter",
      apiKey: "test-key",
      qualityProfile: "code_review",
    });

    expect(result._parseError?.code).toBe("SCHEMA_VALIDATION_FAILED");
    expect(result._qualityError).toBeUndefined();
  });
});