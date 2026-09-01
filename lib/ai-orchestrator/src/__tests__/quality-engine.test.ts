import { describe, expect, it } from "vitest";
import { assessStructuredOutput, buildQualityPlan, sortProviderIdsByQuality } from "../quality-engine.js";

describe("sortProviderIdsByQuality", () => {
  it("prefers a thinking-capable provider for analysis tasks", () => {
    const ordered = sortProviderIdsByQuality(["groq", "openrouter", "deepseek", "gemini"], "analysis");
    expect(ordered[0]).toBe("deepseek");
    expect(ordered).not.toContain("gemini");
  });

  it("keeps tool-capable providers ahead of text-only providers for tool chat", () => {
    const ordered = sortProviderIdsByQuality(["gemini", "groq", "openrouter"], "tool_chat", { requireTools: true });
    expect(ordered[0]).not.toBe("gemini");
    expect(ordered).toContain("groq");
    expect(ordered).toContain("openrouter");
  });
});

describe("assessStructuredOutput", () => {
  it("accepts a complete task execution payload", () => {
    const assessment = assessStructuredOutput("task_execution", {
      summary: "Task analyzed",
      steps: ["Inspect", "Fix"],
      result: "Completed successfully",
      confidence: "high",
      needsHumanReview: false,
    });

    expect(assessment.decision).toBe("accept");
    expect(assessment.score).toBeGreaterThanOrEqual(assessment.threshold);
  });

  it("flags fallback-style task output for retry", () => {
    const assessment = assessStructuredOutput("task_execution", {
      summary: "Task analyzed by AI agent",
      steps: [],
      result: "The model did not return a structured result.",
      confidence: "medium",
      needsHumanReview: true,
    });

    expect(assessment.decision).toBe("retry");
    expect(assessment.reasons.length).toBeGreaterThan(0);
  });
});

describe("capability_probe quality profile", () => {
  it("requires read tools without forcing reasoning or JSON mode", () => {
    const plan = buildQualityPlan("capability_probe", { requireTools: true });

    expect(plan.strictHints.requireTools).toBe(true);
    expect(plan.strictHints.requireFunctionCalling).toBe(true);
    expect(plan.strictHints.requireReasoning).toBeUndefined();
    expect(plan.strictHints.requireThinking).toBeUndefined();
    expect(plan.strictHints.requireJsonMode).toBeUndefined();
  });
});

describe("chat quality profile", () => {
  it("does not force reasoning for ordinary conversational turns", () => {
    const plan = buildQualityPlan("chat");

    expect(plan.strictHints.requireStreaming).toBe(true);
    expect(plan.strictHints.requireReasoning).toBeUndefined();
    expect(plan.strictHints.requireThinking).toBeUndefined();
  });
});

describe("code_review quality profile", () => {
  it("requires structured JSON without forcing reasoning-only output", () => {
    const plan = buildQualityPlan("code_review");

    expect(plan.strictHints.requireJsonMode).toBe(true);
    expect(plan.strictHints.requireReasoning).toBeUndefined();
    expect(plan.strictHints.requireThinking).toBeUndefined();
    expect(plan.relaxedHints.requireJsonMode).toBe(true);
    expect(plan.relaxedHints.requireReasoning).toBeUndefined();
  });

  it("rejects filler findings even when the provider populates every array", () => {
    const assessment = assessStructuredOutput("code_review", {
      summary: "The review found several things worth considering in this codebase.",
      overallScore: 74,
      strengths: ["The project has a clear structure."],
      issues: [{
        type: "style",
        severity: "low",
        title: "No issues found",
        description: "This may need improvement.",
        suggestion: "Consider making changes as appropriate.",
      }],
      refactoringOpportunities: ["Refactor where useful."],
      securityConcerns: ["Review security as needed."],
      verdict: "needs_changes",
    });

    expect(assessment.decision).not.toBe("accept");
    expect(assessment.reasons).toContain("one or more findings contain filler or placeholder text");
  });

  it("rejects contradictory verdicts rather than rewarding array density", () => {
    const assessment = assessStructuredOutput("code_review", {
      summary: "No actionable defects were found in the reviewed evidence.",
      overallScore: 96,
      strengths: ["The implementation is consistent."],
      issues: [],
      refactoringOpportunities: [],
      securityConcerns: [],
      verdict: "needs_changes",
    });

    expect(assessment.decision).not.toBe("accept");
    expect(assessment.reasons).toContain("needs_changes verdict conflicts with a very high score");
  });
});
