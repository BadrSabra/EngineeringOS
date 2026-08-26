import { describe, expect, it } from "vitest";
import {
  buildRemediationPlan,
  buildRemediationPrompt,
  REMEDIATION_PLAN_LIMITS,
} from "./remediation-plan.js";

describe("remediation plans", () => {
  it("keeps evidence within fixed bounds and derives unique related files", () => {
    const plan = buildRemediationPlan({
      ruleId: "rule-1",
      ruleCode: "SEC-001",
      ruleTitle: "Unsafe logging",
      severity: "high",
      occurrenceCount: 4,
      matches: Array.from({ length: 120 }, (_, index) => ({
        file: index % 2 ? "src/b.ts" : "src/a.ts",
        line: index + 1,
        snippet: "x".repeat(500),
        occurrences: 1,
      })),
      fixDescription: "Remove the sensitive value before logging.",
      verificationSteps: ["Run the security test suite."],
      source: {
        type: "scan",
        correlationId: "scan-1",
        revision: "revision-1",
        completeness: "COMPLETE",
      },
    });

    expect(plan.evidence).toHaveLength(REMEDIATION_PLAN_LIMITS.maxEvidence);
    expect(plan.relatedFiles).toEqual(["src/a.ts", "src/b.ts"]);
    expect(plan.evidence[0].snippet).toHaveLength(
      REMEDIATION_PLAN_LIMITS.maxSnippetLength,
    );
    expect(plan.status).toBe("ready");
  });

  it("requires review when evidence or verification guidance is missing", () => {
    const plan = buildRemediationPlan({
      ruleCode: "STYLE-001",
      ruleTitle: "Style issue",
      severity: "low",
      occurrenceCount: 1,
      source: {
        type: "discovery",
        correlationId: null,
        revision: null,
        completeness: "PARTIAL",
      },
    });

    expect(plan.status).toBe("needs_review");
    expect(buildRemediationPrompt(plan)).toContain("do not invent");
    expect(buildRemediationPrompt(plan)).toContain("request human review");
  });
});