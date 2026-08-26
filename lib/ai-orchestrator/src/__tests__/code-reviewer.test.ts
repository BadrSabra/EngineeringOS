import { describe, expect, it, vi } from "vitest";

const { agentComplete } = vi.hoisted(() => ({
  agentComplete: vi.fn(),
}));

vi.mock("../agent-complete.js", () => ({ agentComplete }));

import { reviewCode } from "../agents/code-reviewer.js";

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
  it("marks a valid-looking empty finding list incomplete", async () => {
    agentComplete.mockResolvedValue({
      content: JSON.stringify({ ...baseReview, issues: [] }),
    });

    const result = await reviewCode(
      context,
      { "src/example.ts": "export const value = 1;" },
      { provider: "openrouter", apiKey: "test-key", qualityProfile: "code_review" },
    );

    expect(result._parseError).toMatchObject({
      code: "SCHEMA_VALIDATION_FAILED",
    });
    expect(result._parseError?.message).toContain("selected file");
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
  });
});