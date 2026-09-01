import { describe, expect, it } from "vitest";
import { deriveForensicDiagnostic } from "../forensic-diagnostics.js";

function completeTrace(overrides: Record<string, unknown> = {}) {
  return [
    {
      kind: "forensic_status",
      sourceCoverage: "COMPLETE",
      behavioralAssessment: "COMPLETE",
      findingStatus: "NO_FINDING",
      rootCoverage: [],
      ...overrides,
    },
    {
      kind: "evidence_integrity",
      consistent: true,
      evidenceSourceCoverage: { status: "COMPLETE", roots: [] },
    },
    { kind: "decision_trace", finalState: "VERIFIED" },
  ];
}

describe("forensic diagnostic projection", () => {
  it("accepts only a complete reconciled no-finding as NO_VERIFIED_FINDING", () => {
    expect(deriveForensicDiagnostic(completeTrace())).toMatchObject({
      verdict: "NO_VERIFIED_FINDING",
      reasonCode: "COMPLETE_NO_FINDING",
      nextActionCode: "NONE",
    });
  });

  it("fails closed and retains bounded unread/truncated scope", () => {
    const result = deriveForensicDiagnostic(completeTrace({
      sourceCoverage: "PARTIAL",
      rootCoverage: [{
        root: ".",
        discoveredFiles: 3,
        readFiles: 1,
        unreadFiles: 2,
        status: "PARTIAL",
        unreadPaths: ["src/unread.ts", "/secret", "../outside.ts"],
        truncatedPaths: ["src/large.ts"],
      }],
    }));
    expect(result).toMatchObject({
      verdict: "ANALYSIS_INCOMPLETE",
      reasonCode: "SCOPE_BLOCKED_READ",
      unreadFiles: ["src/unread.ts"],
      truncatedFiles: ["src/large.ts"],
      nextActionCode: "REVIEW_SCOPE",
    });
  });

  it.each([
    ["timeout", "TIMEOUT"],
    ["root_unavailable", "SCOPE_BLOCKED_READ"],
    ["failed", "TOOL_FAILURE"],
  ] as const)("maps tool failure %s to %s", (analysisFailureCategory, reasonCode) => {
    expect(deriveForensicDiagnostic([
      ...completeTrace({ sourceCoverage: "PARTIAL" }),
      { kind: "tool_result", resultKind: "failed", analysisFailureCategory },
    ])).toMatchObject({ verdict: "ANALYSIS_INCOMPLETE", reasonCode });
  });

  it("gives cancellation precedence over stale clean telemetry", () => {
    expect(deriveForensicDiagnostic([
      ...completeTrace(),
      { kind: "done", stopReason: "cancelled" },
    ])).toMatchObject({
      verdict: "ANALYSIS_INCOMPLETE",
      reasonCode: "CANCELLED",
    });
  });

  it("never exposes unsafe paths or provider-shaped text", () => {
    const result = deriveForensicDiagnostic(completeTrace({
      sourceCoverage: "PARTIAL",
      rootCoverage: [{
        root: ".",
        discoveredFiles: 2,
        readFiles: 0,
        unreadFiles: 2,
        status: "PARTIAL",
        unreadPaths: ["src/ok.ts", "/home/user/private.ts", "provider timeout: secret"],
      }],
    }));
    expect(result?.unreadFiles).toEqual(["src/ok.ts"]);
    expect(JSON.stringify(result)).not.toContain("provider timeout");
  });
});