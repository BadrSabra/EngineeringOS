import { describe, it, expect } from "vitest";
import {
  PendingChangeSchema,
  ChatResponseSchema,
  CodeReviewResultSchema,
  ScanSummarySchema,
  TaskRecommendationSchema,
  WorkflowDecisionSchema,
} from "../schemas/index.js";

describe("PendingChangeSchema", () => {
  const valid = {
    path: "src/foo.ts",
    absolutePath: "/home/project/src/foo.ts",
    newContent: "export const x = 1;",
    originalContent: "export const x = 0;",
    reason: "Update constant value",
  };

  it("accepts a well-formed pending change", () => {
    expect(PendingChangeSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts originalContent of null (new file)", () => {
    expect(PendingChangeSchema.safeParse({ ...valid, originalContent: null }).success).toBe(true);
  });

  it("accepts an empty newContent (file being cleared)", () => {
    expect(PendingChangeSchema.safeParse({ ...valid, newContent: "" }).success).toBe(true);
  });

  it("rejects an empty path", () => {
    expect(PendingChangeSchema.safeParse({ ...valid, path: "" }).success).toBe(false);
  });

  it("rejects an empty absolutePath", () => {
    expect(PendingChangeSchema.safeParse({ ...valid, absolutePath: "" }).success).toBe(false);
  });

  it("rejects a relative absolutePath", () => {
    expect(PendingChangeSchema.safeParse({ ...valid, absolutePath: "src/foo.ts" }).success).toBe(false);
  });

  it("rejects a dot-relative absolutePath", () => {
    expect(PendingChangeSchema.safeParse({ ...valid, absolutePath: "./src/foo.ts" }).success).toBe(false);
  });

  it("rejects an empty reason", () => {
    expect(PendingChangeSchema.safeParse({ ...valid, reason: "" }).success).toBe(false);
  });

  it("rejects originalContent of a non-string, non-null value", () => {
    expect(PendingChangeSchema.safeParse({ ...valid, originalContent: 42 }).success).toBe(false);
  });

  it("rejects originalContent of undefined (must be null for new files, not omitted)", () => {
    const { originalContent: _, ...without } = valid;
    expect(PendingChangeSchema.safeParse(without).success).toBe(false);
  });

  it("rejects an unrecognised extra field", () => {
    expect(PendingChangeSchema.safeParse({ ...valid, extra: "injected" }).success).toBe(false);
  });

  it("rejects a missing path field", () => {
    const { path: _, ...without } = valid;
    expect(PendingChangeSchema.safeParse(without).success).toBe(false);
  });

  it("rejects a missing absolutePath field", () => {
    const { absolutePath: _, ...without } = valid;
    expect(PendingChangeSchema.safeParse(without).success).toBe(false);
  });

  it("rejects a missing reason field", () => {
    const { reason: _, ...without } = valid;
    expect(PendingChangeSchema.safeParse(without).success).toBe(false);
  });
});

describe("ChatResponseSchema", () => {
  it("accepts a valid chat response", () => {
    expect(ChatResponseSchema.safeParse({ response: "hi", sources: ["a"] }).success).toBe(true);
  });

  it("defaults sources when omitted", () => {
    const result = ChatResponseSchema.safeParse({ response: "hi" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.sources).toEqual([]);
  });

  it("rejects an empty response string", () => {
    expect(ChatResponseSchema.safeParse({ response: "", sources: [] }).success).toBe(false);
  });
});

describe("CodeReviewResultSchema", () => {
  const valid = {
    summary: "s",
    overallScore: 80,
    strengths: [],
    issues: [],
    refactoringOpportunities: [],
    securityConcerns: [],
    verdict: "approved",
  };

  it("accepts a valid review", () => {
    expect(CodeReviewResultSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects an out-of-range score", () => {
    expect(CodeReviewResultSchema.safeParse({ ...valid, overallScore: 150 }).success).toBe(false);
  });

  it("rejects an invalid verdict", () => {
    expect(CodeReviewResultSchema.safeParse({ ...valid, verdict: "yolo" }).success).toBe(false);
  });
});

describe("ScanSummarySchema", () => {
  it("accepts a valid scan summary", () => {
    const valid = {
      summary: "s",
      overallAssessment: "a",
      insights: [],
      topPriority: "p",
      estimatedImpact: "i",
    };
    expect(ScanSummarySchema.safeParse(valid).success).toBe(true);
  });
});

describe("TaskRecommendationSchema", () => {
  it("defaults needsHumanReview to true", () => {
    const result = TaskRecommendationSchema.safeParse({
      summary: "s",
      result: "r",
      confidence: "high",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.needsHumanReview).toBe(true);
  });

  it("rejects an invalid confidence value", () => {
    const result = TaskRecommendationSchema.safeParse({
      summary: "s",
      result: "r",
      confidence: "maybe",
    });
    expect(result.success).toBe(false);
  });
});

describe("WorkflowDecisionSchema", () => {
  it("accepts a minimal wait decision", () => {
    expect(WorkflowDecisionSchema.safeParse({ action: "wait", reasoning: "blocked" }).success).toBe(true);
  });

  it("rejects an unknown action", () => {
    expect(WorkflowDecisionSchema.safeParse({ action: "teleport", reasoning: "blocked" }).success).toBe(false);
  });

  it("rejects an empty reasoning string", () => {
    expect(WorkflowDecisionSchema.safeParse({ action: "wait", reasoning: "" }).success).toBe(false);
  });
});
