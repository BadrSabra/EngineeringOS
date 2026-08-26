import { describe, expect, it } from "vitest";
import { runTaskVerification } from "./task-service.js";

describe("runTaskVerification remediation safeguards", () => {
  it("keeps incomplete remediation evidence in review instead of marking it complete", async () => {
    const result = await runTaskVerification(
      {
        id: "task-1",
        ruleId: null,
        relatedFiles: ["src/example.ts"],
        remediationPlan: {
          status: "needs_review",
          evidence: [],
          verificationSteps: [],
        },
      },
      "/not-read",
    );

    expect(result.finalStatus).toBe("verifying");
    expect(result.steps[0]).toMatchObject({
      name: "Remediation plan review",
      passed: false,
    });
  });

  it("records every rule guidance item as a pending server-owned check", async () => {
    const result = await runTaskVerification(
      {
        id: "task-2",
        ruleId: null,
        relatedFiles: [],
        remediationPlan: {
          status: "ready",
          evidence: [{ file: "src/example.ts", line: 4, snippet: "safe", occurrences: 1 }],
          verificationSteps: ["Run the focused test.", "Confirm the safe log output."],
        },
      },
      "/not-read",
    );

    expect(result.finalStatus).toBe("verifying");
    expect(result.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "rule-verification-1",
          kind: "operator_attestation",
          guidance: "Run the focused test.",
          passed: false,
        }),
        expect.objectContaining({
          id: "rule-verification-2",
          kind: "operator_attestation",
          guidance: "Confirm the safe log output.",
          passed: false,
        }),
      ]),
    );
  });

  it("does not execute guidance as a command or treat an automatic signal as proof", async () => {
    const result = await runTaskVerification(
      {
        id: "task-3",
        ruleId: null,
        relatedFiles: [],
        remediationPlan: {
          status: "ready",
          evidence: [{ file: "src/example.ts", line: 4, snippet: "safe", occurrences: 1 }],
          verificationSteps: ["rm -rf /"],
        },
      },
      "/not-read",
    );

    expect(result.finalStatus).toBe("verifying");
    expect(result.steps.some((step) => step.output?.includes("rm -rf"))).toBe(false);
  });
});