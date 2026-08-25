import { describe, expect, it } from "vitest";
import { buildTaskResult } from "../agents/chat-agent.js";
import type {
  ChatTaskResult,
  RepairPlanMetadata,
} from "../schemas/chat.schema.js";
import {
  BehaviorAnswerResultSchema,
  ChatTaskResultSchema,
  CodeExtractionResultSchema,
  FindingResultSchema,
  ForensicReportResultSchema,
  WorkspaceReviewResultSchema,
  RepairResultSchema,
} from "../schemas/chat.schema.js";
import {
  ForensicTaskTypeSchema,
  type EvidenceReference,
  type ForensicTaskType,
  type SemanticBehaviorAnswer,
} from "../task-contracts.js";

/**
 * buildTaskResult is the single mapping from forensicTaskType to a typed
 * client result. These tests pin every branch so a regression (wrong kind
 * string, missing field, schema mismatch) cannot silently produce an invalid
 * taskResult that the safeParse gate would later drop.
 */

function makeEvidence(reference: Partial<EvidenceReference> = {}): EvidenceReference {
  return {
    source: "src/loop.ts",
    excerpt: "if (maxIterations >= 20) return exhausted;",
    sourceSpan: { startLine: 12, endLine: 12 },
    supportsClaim: false,
    relevance: 0.9,
    directness: "DIRECT",
    sourceType: "IMPLEMENTATION",
    productionReachability: "NOT_PROVEN",
    evidenceClass: "READ_CONFIRMED",
    ...reference,
  };
}

function makeBehaviorAnswer(overrides: Partial<SemanticBehaviorAnswer> = {}): SemanticBehaviorAnswer {
  return {
    answer: "maxIterations returns exhausted once the loop counter reaches the cap.",
    evidence: [makeEvidence()],
    sourceScope: [],
    coverage: {
      requestedFields: ["maxiterations"],
      answeredFields: ["maxiterations"],
      missingFields: [],
      complete: true,
    },
    ...overrides,
  };
}

function makeRepairPlan(overrides: Partial<RepairPlanMetadata> = {}): RepairPlanMetadata {
  return {
    findingId: "F-1",
    files: ["src/loop.ts"],
    steps: ["Add an early return when the max is reached."],
    validationProfile: "ai-orchestrator-tests",
    ...overrides,
  };
}

function build(taskType: ForensicTaskType, overrides: Partial<Parameters<typeof buildTaskResult>[0]> = {}) {
  return buildTaskResult({
    forensicTaskType: taskType,
    finalResponse: "result text",
    mergedSources: ["src/loop.ts"],
    semanticBehaviorAnswer: undefined,
    structuredRepairPlan: undefined,
    acceptedBehaviorEvidence: [],
    ...overrides,
  });
}

describe("buildTaskResult (per-task typed results)", () => {
  it("routes CODE_EXTRACTION to CODE_EXTRACTION_RESULT with extracted code and source", () => {
    const result = build("CODE_EXTRACTION", {
      finalResponse: "```ts\nreturn partial;\n```",
      mergedSources: ["src/loop.ts", "src/other.ts"],
    });
    expect(result).toBeDefined();
    expect(CodeExtractionResultSchema.safeParse(result!).success).toBe(true);
    if (result?.kind === "CODE_EXTRACTION_RESULT") {
      expect(result.extractedCode).toBe("```ts\nreturn partial;\n```");
      expect(result.source).toBe("src/loop.ts");
    }
    expect(ChatTaskResultSchema.safeParse(result!).success).toBe(true);
  });

  it("omits the optional source for CODE_EXTRACTION when no merged source exists", () => {
    const result = build("CODE_EXTRACTION", {
      finalResponse: "const x = 1;",
      mergedSources: [],
    });
    expect(result).toBeDefined();
    expect(CodeExtractionResultSchema.safeParse(result).success).toBe(true);
    if (result?.kind === "CODE_EXTRACTION_RESULT") {
      expect(result.extractedCode).toBe("const x = 1;");
      expect(result.source).toBeUndefined();
    }
  });

  it("routes BEHAVIOR_QUERY to BEHAVIOR_ANSWER_RESULT carrying the grounded answer", () => {
    const answer = makeBehaviorAnswer();
    const result = build("BEHAVIOR_QUERY", {
      finalResponse: "maxIterations returns exhausted.",
      semanticBehaviorAnswer: answer,
    });
    expect(result).toBeDefined();
    expect(BehaviorAnswerResultSchema.safeParse(result!).success).toBe(true);
    if (result?.kind === "BEHAVIOR_ANSWER_RESULT") {
      expect(result.answer).toBe(answer);
    }
  });

  it("returns undefined from BEHAVIOR_QUERY when there is no semantic answer", () => {
    expect(
      build("BEHAVIOR_QUERY", {
        finalResponse: "I could not answer.",
        semanticBehaviorAnswer: undefined,
      }),
    ).toBeUndefined();
  });

  it("routes FINDING_ANALYSIS to FINDING_RESULT with severity NOT_PROVEN unless evidence proves it", () => {
    const result = build("FINDING_ANALYSIS", {
      finalResponse: "Confirmed: the loop can exhaust without returning.",
      acceptedBehaviorEvidence: [makeEvidence()],
    });
    expect(result).toBeDefined();
    expect(FindingResultSchema.safeParse(result!).success).toBe(true);
    if (result?.kind === "FINDING_RESULT") {
      expect(result.finding.finding).toBe(
        "Confirmed: the loop can exhaust without returning.",
      );
      expect(result.finding.severity).toBe("NOT_PROVEN");
      expect(result.finding.evidence).toHaveLength(1);
    }
  });

  it("marks FINDING_RESULT severity HIGH when evidence reaches FINDING_PROVEN", () => {
    const result = build("FINDING_ANALYSIS", {
      finalResponse: "Confirmed defect.",
      acceptedBehaviorEvidence: [
        makeEvidence({ evidenceClass: "FINDING_PROVEN", supportsClaim: true }),
      ],
    });
    if (result?.kind === "FINDING_RESULT") {
      expect(result.finding.severity).toBe("HIGH");
    }
  });

  it("falls back to a placeholder Finding when FINDING_ANALYSIS response is empty", () => {
    const result = build("FINDING_ANALYSIS", {
      finalResponse: "",
      acceptedBehaviorEvidence: [],
    });
    expect(result).toBeDefined();
    expect(FindingResultSchema.safeParse(result!).success).toBe(true);
    if (result?.kind === "FINDING_RESULT") {
      expect(result.finding.finding).toMatch(/insufficient evidence/i);
      expect(result.finding.severity).toBe("NOT_PROVEN");
    }
  });

  it("routes FULL_FORENSIC_AUDIT to FORENSIC_REPORT_RESULT with report text", () => {
    const result = build("FULL_FORENSIC_AUDIT", {
      finalResponse: "No behavioral defect found in reviewed sources.",
      acceptedBehaviorEvidence: [makeEvidence()],
    });
    expect(result).toBeDefined();
    expect(ForensicReportResultSchema.safeParse(result!).success).toBe(true);
    if (result?.kind === "FORENSIC_REPORT_RESULT") {
      expect(result.report).toBe("No behavioral defect found in reviewed sources.");
      expect(result.evidence).toHaveLength(1);
    }
  });

  it("returns undefined from FULL_FORENSIC_AUDIT when the report text is empty", () => {
    expect(
      build("FULL_FORENSIC_AUDIT", { finalResponse: "   ", mergedSources: [] }),
    ).toBeUndefined();
  });

  it("routes WORKSPACE_REVIEW to a typed report result", () => {
    const result = build("WORKSPACE_REVIEW", {
      finalResponse: "Workspace review report.",
      acceptedBehaviorEvidence: [makeEvidence()],
    });
    expect(result).toBeDefined();
    expect(WorkspaceReviewResultSchema.safeParse(result!).success).toBe(true);
    if (result?.kind === "WORKSPACE_REVIEW_RESULT") {
      expect(result.report).toBe("Workspace review report.");
      expect(result.evidence).toHaveLength(1);
    }
  });

  it("limits FORENSIC_REPORT_RESULT evidence to 20 entries", () => {
    const many = Array.from({ length: 30 }, (_, index) => makeEvidence({ source: `src/f${index}.ts` }));
    const result = build("FULL_FORENSIC_AUDIT", {
      finalResponse: "Full audit report.",
      acceptedBehaviorEvidence: many,
    });
    if (result?.kind === "FORENSIC_REPORT_RESULT") {
      expect(result.evidence).toHaveLength(20);
    }
  });

  it("routes REPAIR_ANALYSIS to REPAIR_RESULT with READY readiness when phases exist", () => {
    const plan = makeRepairPlan();
    const result = build("REPAIR_ANALYSIS", {
      finalResponse: "A repair plan is provided.",
      structuredRepairPlan: [plan],
    });
    expect(result).toBeDefined();
    expect(RepairResultSchema.safeParse(result!).success).toBe(true);
    if (result?.kind === "REPAIR_RESULT") {
      expect(result.phases).toEqual([plan]);
      expect(result.readiness).toBe("READY");
    }
  });

  it("marks REPAIR_RESULT readiness NOT_PROVEN when there are no phases", () => {
    const result = build("REPAIR_ANALYSIS", {
      finalResponse: "No repairs were warranted.",
      structuredRepairPlan: undefined,
    });
    expect(result).toBeDefined();
    expect(RepairResultSchema.safeParse(result!).success).toBe(true);
    if (result?.kind === "REPAIR_RESULT") {
      expect(result.phases).toEqual([]);
      expect(result.readiness).toBe("NOT_PROVEN");
    }
  });

  it("never produces an unparsable ChatTaskResult for any valid branch", () => {
    const answer = makeBehaviorAnswer();
    const plan = makeRepairPlan();
    const evidence = [makeEvidence({ evidenceClass: "FINDING_PROVEN", supportsClaim: true })];
    const candidates: Array<ChatTaskResult | undefined> = [
      build("CODE_EXTRACTION", { finalResponse: "let x = 1;" }),
      build("BEHAVIOR_QUERY", { semanticBehaviorAnswer: answer }),
      build("FINDING_ANALYSIS", { acceptedBehaviorEvidence: evidence }),
      build("FULL_FORENSIC_AUDIT", { finalResponse: "report", acceptedBehaviorEvidence: evidence }),
      build("REPAIR_ANALYSIS", { structuredRepairPlan: [plan] }),
    ];
    for (const candidate of candidates) {
      expect(candidate).toBeDefined();
      expect(ChatTaskResultSchema.safeParse(candidate).success).toBe(true);
    }
  });

  it("produces a defined ChatTaskResult for every ForensicTaskTypeSchema option", () => {
    // Schema-option-driven loop: if a new ForensicTaskType is added to the enum
    // the compiler forces buildTaskResult to handle it (exhaustiveness guard in
    // the switch's default), and this test forces that branch to actually build
    // a parsable result — closing the "forgotten task type silently drops the
    // analyst's result" gap at both the type and runtime level.
    const answer = makeBehaviorAnswer();
    const plan = makeRepairPlan();
    const evidence = [makeEvidence({ evidenceClass: "FINDING_PROVEN", supportsClaim: true })];

    const overrides: Record<`${ForensicTaskType}`, Partial<Parameters<typeof buildTaskResult>[0]>> = {
      CODE_EXTRACTION: {
        finalResponse: "let x = 1;",
        mergedSources: ["src/loop.ts"],
      },
      BEHAVIOR_QUERY: {
        finalResponse: "the loop caps iterations at 20.",
        mergedSources: ["src/loop.ts"],
        semanticBehaviorAnswer: answer,
      },
      FINDING_ANALYSIS: {
        finalResponse: "Confirmed defect.",
        mergedSources: ["src/loop.ts"],
        acceptedBehaviorEvidence: evidence,
      },
      FULL_FORENSIC_AUDIT: {
        finalResponse: "Full audit report.",
        mergedSources: ["src/loop.ts"],
        acceptedBehaviorEvidence: evidence,
      },
      WORKSPACE_REVIEW: {
        finalResponse: "Workspace review report.",
        mergedSources: ["src/loop.ts"],
        acceptedBehaviorEvidence: evidence,
      },
      REPAIR_ANALYSIS: {
        finalResponse: "A repair plan is provided.",
        mergedSources: ["src/loop.ts"],
        structuredRepairPlan: [plan],
      },
    };

    for (const taskType of ForensicTaskTypeSchema.options) {
      const candidate = build(taskType, overrides[taskType]);
      expect(candidate, `unhandled task type ${taskType}`).toBeDefined();
      expect(ChatTaskResultSchema.safeParse(candidate).success, `invalid result for ${taskType}`).toBe(true);
    }
  });
});
