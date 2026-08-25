import { describe, expect, it } from "vitest";
import { hasValidationEvidence, isProvenValidation, toPublicValidationResult } from "../validation-result.js";
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

  it("projects only bounded validation metadata for persistence and clients", () => {
    const publicResult = toPublicValidationResult(result({
      command: "pnpm test -- --reporter verbose",
      stdout: "PRIVATE_SOURCE=do-not-save",
      stderr: "token: abc123",
      failedTests: [{ name: "private.test.ts", file: "src/private.ts", message: "secret@example.com" }],
      changedFiles: ["src/private.ts"],
      detail: "Validation failed; [redacted email] [redacted credential]",
    }));

    expect(publicResult).toEqual({
      profile: "workspace-typecheck",
      status: "passed",
      scenario: "Run the workspace typecheck.",
      exitCode: 0,
      evidence: result().evidence,
      detail: "Validation failed; [redacted email] [redacted credential]",
    });
    expect(publicResult).not.toHaveProperty("command");
    expect(publicResult).not.toHaveProperty("stdout");
    expect(publicResult).not.toHaveProperty("stderr");
    expect(publicResult).not.toHaveProperty("failedTests");
    expect(publicResult).not.toHaveProperty("changedFiles");
  });

  it("retains candidate integrity identifiers in the public receipt", () => {
    const publicResult = toPublicValidationResult(result({
      evidence: {
        ...result().evidence,
        operationId: "operation-1",
        projectRevision: "revision-1",
        candidateHash: "candidate-1",
        changeSetHash: "changeset-1",
        promotedHash: "promoted-1",
      },
    }));

    expect(publicResult.evidence).toMatchObject({
      operationId: "operation-1",
      projectRevision: "revision-1",
      candidateHash: "candidate-1",
      changeSetHash: "changeset-1",
      promotedHash: "promoted-1",
    });
  });
});