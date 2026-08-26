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
});