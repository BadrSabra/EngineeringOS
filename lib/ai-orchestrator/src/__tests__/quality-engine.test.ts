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
