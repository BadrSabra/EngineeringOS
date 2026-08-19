import { describe, expect, it } from "vitest";
import { hasValidationEvidence, isProvenValidation } from "../validation-result.js";
import type { ValidationResult } from "../validation-result.js";

function result(overrides: Partial<ValidationResult> = {}): ValidationResult {
  return {
    profile: "workspace-typecheck",
    status: "passed",
    scenario: "Run the workspace typecheck.",
    exitCode: 0,
    command: "pnpm run typecheck",
    stdout: "typecheck passed",
    stderr: "",
    failedTests: [],
    changedFiles: [],
    evidence: {
      evidenceId: "validation-result:test",
      observedAt: "2026-08-18T12:00:00.000Z",
      artifactRef: "validation-result:test",
    },
    ...overrides,
  };
}

describe("canonical validation evidence", () => {
  it("requires all evidence identity fields", () => {
    expect(hasValidationEvidence(result())).toBe(true);
    expect(hasValidationEvidence(result({
      evidence: { evidenceId: "", observedAt: "2026-08-18T12:00:00.000Z", artifactRef: "validation-result:test" },
    }))).toBe(false);
    expect(hasValidationEvidence(result({
      evidence: { evidenceId: "validation-result:test", observedAt: "", artifactRef: "validation-result:test" },
    }))).toBe(false);
  });

  it("does not treat a passed result without evidence as proven", () => {
    expect(isProvenValidation(result())).toBe(true);
    expect(isProvenValidation({
      ...result(),
      evidence: { evidenceId: "", observedAt: "", artifactRef: "" },
    })).toBe(false);
  });
});