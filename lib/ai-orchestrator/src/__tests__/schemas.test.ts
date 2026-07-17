import { describe, it, expect } from "vitest";
import {
  PendingChangeSchema,
  ChatResponseSchema,
  ChatOutputSchema,
  CodeReviewResultSchema,
  ScanSummarySchema,
  TaskRecommendationSchema,
  WorkflowDecisionSchema,
} from "../schemas/index.js";
import { ScanInsightSchema } from "../schemas/scan.schema.js";
import { CodeIssueSchema } from "../schemas/code-review.schema.js";
import { WorkflowPhaseSchema } from "../schemas/workflow.schema.js";

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

  it("rejects extra fields", () => {
    expect(ChatResponseSchema.safeParse({ response: "hi", sources: [], extra: 1 }).success).toBe(false);
  });
});

describe("ChatOutputSchema", () => {
  const valid = { response: "hi", sources: [], pendingChanges: [] };

  it("accepts a valid chat output with no pending changes", () => {
    expect(ChatOutputSchema.safeParse(valid).success).toBe(true);
  });

  it("defaults pendingChanges to empty array when omitted", () => {
    const result = ChatOutputSchema.safeParse({ response: "hi", sources: [] });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.pendingChanges).toEqual([]);
  });

  it("rejects a pendingChange with a relative absolutePath", () => {
    const badChange = {
      path: "src/foo.ts",
      absolutePath: "relative/path",
      newContent: "",
      originalContent: null,
      reason: "test",
    };
    expect(ChatOutputSchema.safeParse({ ...valid, pendingChanges: [badChange] }).success).toBe(false);
  });

  it("accepts a pendingChange with a valid absolute absolutePath", () => {
    const goodChange = {
      path: "src/foo.ts",
      absolutePath: "/home/project/src/foo.ts",
      newContent: "export const x = 1;",
      originalContent: null,
      reason: "Add export",
    };
    expect(ChatOutputSchema.safeParse({ ...valid, pendingChanges: [goodChange] }).success).toBe(true);
  });
});

describe("WorkflowPhaseSchema", () => {
  it("accepts a valid phase with at least one step", () => {
    expect(WorkflowPhaseSchema.safeParse({ name: "build", steps: ["compile"] }).success).toBe(true);
  });

  it("rejects a phase with an empty steps array", () => {
    expect(WorkflowPhaseSchema.safeParse({ name: "build", steps: [] }).success).toBe(false);
  });

  it("rejects a phase where a step is an empty string", () => {
    expect(WorkflowPhaseSchema.safeParse({ name: "build", steps: [""] }).success).toBe(false);
  });
});

describe("CodeIssueSchema", () => {
  const validIssue = {
    type: "bug" as const,
    severity: "high" as const,
    title: "Null pointer dereference",
    description: "Value may be null here",
    suggestion: "Add a null guard before accessing",
  };

  it("accepts a valid issue", () => {
    expect(CodeIssueSchema.safeParse(validIssue).success).toBe(true);
  });

  it("rejects extra fields", () => {
    expect(CodeIssueSchema.safeParse({ ...validIssue, extra: 1 }).success).toBe(false);
  });

  it("rejects an empty suggestion", () => {
    expect(CodeIssueSchema.safeParse({ ...validIssue, suggestion: "" }).success).toBe(false);
  });

  it("rejects an empty title", () => {
    expect(CodeIssueSchema.safeParse({ ...validIssue, title: "" }).success).toBe(false);
  });

  it("rejects an empty description", () => {
    expect(CodeIssueSchema.safeParse({ ...validIssue, description: "" }).success).toBe(false);
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

  it("rejects extra fields", () => {
    expect(CodeReviewResultSchema.safeParse({ ...valid, extra: 1 }).success).toBe(false);
  });

  it("rejects an empty summary", () => {
    expect(CodeReviewResultSchema.safeParse({ ...valid, summary: "" }).success).toBe(false);
  });
});

describe("ScanInsightSchema", () => {
  const validInsight = {
    category: "security" as const,
    severity: "high" as const,
    title: "SQL injection risk",
    description: "Input is not sanitised",
    recommendation: "Use parameterised queries",
  };

  it("accepts a valid insight", () => {
    expect(ScanInsightSchema.safeParse(validInsight).success).toBe(true);
  });

  it("rejects extra fields", () => {
    expect(ScanInsightSchema.safeParse({ ...validInsight, extra: 1 }).success).toBe(false);
  });

  it("rejects an empty title", () => {
    expect(ScanInsightSchema.safeParse({ ...validInsight, title: "" }).success).toBe(false);
  });

  it("rejects an empty description", () => {
    expect(ScanInsightSchema.safeParse({ ...validInsight, description: "" }).success).toBe(false);
  });

  it("rejects an empty recommendation", () => {
    expect(ScanInsightSchema.safeParse({ ...validInsight, recommendation: "" }).success).toBe(false);
  });
});

describe("ScanSummarySchema", () => {
  const validSummary = {
    summary: "s",
    overallAssessment: "a",
    insights: [],
    topPriority: "p",
    estimatedImpact: "i",
  };

  it("accepts a valid scan summary", () => {
    expect(ScanSummarySchema.safeParse(validSummary).success).toBe(true);
  });

  it("rejects extra fields", () => {
    expect(ScanSummarySchema.safeParse({ ...validSummary, extra: 1 }).success).toBe(false);
  });

  it("rejects an empty summary", () => {
    expect(ScanSummarySchema.safeParse({ ...validSummary, summary: "" }).success).toBe(false);
  });

  it("rejects an empty overallAssessment", () => {
    expect(ScanSummarySchema.safeParse({ ...validSummary, overallAssessment: "" }).success).toBe(false);
  });
});

describe("TaskRecommendationSchema", () => {
  const validTask = { summary: "s", steps: ["do the thing"], result: "r", confidence: "high" as const };

  it("defaults needsHumanReview to true", () => {
    const result = TaskRecommendationSchema.safeParse(validTask);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.needsHumanReview).toBe(true);
  });

  it("rejects an invalid confidence value", () => {
    expect(TaskRecommendationSchema.safeParse({ ...validTask, confidence: "maybe" }).success).toBe(false);
  });

  it("rejects extra fields", () => {
    expect(TaskRecommendationSchema.safeParse({ ...validTask, extra: "injected" }).success).toBe(false);
  });

  it("rejects an empty summary", () => {
    expect(TaskRecommendationSchema.safeParse({ ...validTask, summary: "" }).success).toBe(false);
  });

  it("rejects an empty steps array", () => {
    expect(TaskRecommendationSchema.safeParse({ ...validTask, steps: [] }).success).toBe(false);
  });

  it("rejects steps containing an empty string", () => {
    expect(TaskRecommendationSchema.safeParse({ ...validTask, steps: [""] }).success).toBe(false);
  });

  it("rejects an empty result", () => {
    expect(TaskRecommendationSchema.safeParse({ ...validTask, result: "" }).success).toBe(false);
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
