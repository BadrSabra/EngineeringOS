import { describe, expect, it } from "vitest";
import {
  LIVE_RESPONSE_QUALITY_CASES,
  buildLiveResponseQualityScorecard,
  runLiveResponseQualityBenchmark,
  scoreLiveResponseQualityCase,
} from "./live-response-quality.js";

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    response: "The answer is grounded in the source.",
    persistedResponse: "The answer is grounded in the source.",
    persistedTurnKind: "FORENSIC_AUDIT" as const,
    persistedTaskType: "BEHAVIOR_QUERY" as const,
    persistedVerdict: "PROVEN" as const,
    evidence: [{ source: "src/chat.ts", accepted: true, validCitation: true, completeRead: true, inScope: true }],
    answeredFields: ["routing decision", "source", "behavior", "evidence"],
    scopeAdhered: true,
    terminalState: "SUCCEEDED" as const,
    fixtureRevision: "fixture-v1",
    ...overrides,
  };
}

describe("live response quality benchmark", () => {
  it("ships a fixed matrix across all required prompt families", () => {
    expect(LIVE_RESPONSE_QUALITY_CASES).toHaveLength(8);
    expect(new Set(LIVE_RESPONSE_QUALITY_CASES.map((entry) => entry.family))).toEqual(new Set([
      "ordinary-project-question", "arabic-behavior-question", "forensic-audit",
      "compound-report", "capability-probe", "ambiguous-request",
      "unsupported-claim", "blocked-request",
    ]));
  });

  it("does not accept fluent text when persisted intent, evidence, or verdict is wrong", () => {
    const testCase = LIVE_RESPONSE_QUALITY_CASES[0]!;
    const result = scoreLiveResponseQualityCase(testCase, snapshot({
      persistedTurnKind: "CHAT",
      persistedTaskType: undefined,
      persistedVerdict: "PROVEN",
      evidence: [],
    }));
    expect(result.grade).toBe("FAIL");
    expect(result.failureCodes).toEqual(expect.arrayContaining(["INTENT_MISMATCH", "EVIDENCE_NOT_GROUNDED"]));
  });

  it("marks unavailable provider runs separately from quality failures", async () => {
    const scorecard = await runLiveResponseQualityBenchmark({
      cases: LIVE_RESPONSE_QUALITY_CASES.slice(0, 1),
      caseTimeoutMs: 20,
      executeCase: async () => {
        throw new Error("rate limit");
      },
    });
    expect(scorecard.cases[0]?.grade).toBe("UNAVAILABLE");
    expect(scorecard.metrics.unavailableCount).toBe(1);
    expect(scorecard.metrics.falseSuccessRate).toBe(0);
    expect(scorecard.rolloutAllowed).toBe(false);
  });

  it("treats a correctly blocked request as a bounded outcome", () => {
    const testCase = LIVE_RESPONSE_QUALITY_CASES.find((entry) => entry.family === "ambiguous-request")!;
    const result = scoreLiveResponseQualityCase(testCase, snapshot({
      response: "Please specify the project or files to review.",
      persistedResponse: "Please specify the project or files to review.",
      persistedTurnKind: "BLOCKED",
      persistedTaskType: undefined,
      persistedVerdict: "BLOCKED",
      evidence: [],
      answeredFields: ["scope"],
      terminalState: "BLOCKED",
    }));
    expect(result.grade).toBe("BLOCKED");
    expect(result.falseSuccess).toBe(false);
  });

  it("blocks rollout on false success and scope escape", () => {
    const scorecard = buildLiveResponseQualityScorecard({
      results: [{
        ...scoreLiveResponseQualityCase(LIVE_RESPONSE_QUALITY_CASES[0]!, snapshot({
          persistedTurnKind: "CHAT",
          persistedTaskType: undefined,
        })),
        falseSuccess: true,
        failureCodes: ["FALSE_SUCCESS", "SCOPE_ESCAPE"],
        scopeAdhered: false,
      }],
    });
    expect(scorecard.rolloutAllowed).toBe(false);
    expect(scorecard.rolloutBlockers).toEqual(expect.arrayContaining(["false success detected", "scope escape detected"]));
  });
});