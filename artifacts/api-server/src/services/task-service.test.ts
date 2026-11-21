import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

  it("verifies only the exact related files and avoids suffix collisions", async () => {
    const root = await mkdtemp(join(tmpdir(), "task-verification-targeted-"));
    try {
      await mkdir(join(root, "src"), { recursive: true });
      await mkdir(join(root, "other", "src"), { recursive: true });
      await writeFile(join(root, "src", "target.ts"), "export const target = true;");
      await writeFile(join(root, "other", "src", "target.ts"), "export const decoy = true;");
      await writeFile(join(root, "unrelated.ts"), "export const unrelated = true;");

      const result = await runTaskVerification(
        { id: "task-targeted", ruleId: null, relatedFiles: ["src/target.ts"] },
        root,
      );

      expect(result.finalStatus).toBe("completed");
      expect(result.steps).toContainEqual(
        expect.objectContaining({ name: "File existence check", passed: true }),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not accept a partial set of related files as complete", async () => {
    const root = await mkdtemp(join(tmpdir(), "task-verification-missing-"));
    try {
      await mkdir(join(root, "src"), { recursive: true });
      await writeFile(join(root, "src", "present.ts"), "export const present = true;");

      const result = await runTaskVerification(
        {
          id: "task-missing",
          ruleId: null,
          relatedFiles: ["src/present.ts", "other/missing.ts"],
        },
        root,
      );

      expect(result.finalStatus).toBe("verifying");
      expect(result.steps[0]?.output).toContain("other/missing.ts");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects malformed related-file references without scanning", async () => {
    const result = await runTaskVerification(
      { id: "task-invalid-path", ruleId: null, relatedFiles: ["../outside.ts"] },
      "/not-read",
    );

    expect(result.finalStatus).toBe("verifying");
    expect(result.steps[0]).toMatchObject({
      name: "File reference validation",
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