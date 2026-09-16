import { describe, expect, it } from "vitest";
import {
  buildTaskObjectiveContract,
  inferTaskObjectiveKind,
  validateTaskObjectiveContract,
} from "./task-objective-contract.js";

const base = {
  projectId: "project-1",
  workspaceRevision: "revision-1",
  proofRequired: true,
};

describe("task objective contracts", () => {
  it("maps every requested task family to an explicit server-owned contract", () => {
    const cases = [
      ["What does this project do?", "knowledge_answer"],
      ["Analyze the project architecture", "project_analysis"],
      ["Fix the bug in the login flow", "bug_fix"],
      ["Implement a feature for exports", "feature_implementation"],
      ["Refactor the authentication module", "refactor"],
      ["Add a database migration for users", "database_change"],
      ["Run the browser workflow and click submit", "browser_workflow"],
      ["Deploy and publish the release", "deployment"],
      ["Integrate this with GitHub", "integration_task"],
      ["Convert this CSV to JSON", "file_conversion"],
      ["Generate a media image", "media_task"],
    ] as const;

    for (const [message, expectedKind] of cases) {
      expect(inferTaskObjectiveKind({ message })).toBe(expectedKind);
      const contract = buildTaskObjectiveContract({ ...base, message });
      expect(contract?.kind).toBe(expectedKind);
      expect(contract?.objective).toContain(message);
      expect(contract?.validatorIds.length).toBeGreaterThan(0);
      expect(contract?.successCriteria.length).toBeGreaterThan(0);
      expect(contract?.failureTaxonomy.length).toBeGreaterThan(0);
      expect(contract?.hash).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it("does not infer file conversion from a cross-task acceptance inventory", () => {
    const message =
      "Acceptance coverage لكل أنواع المهام: project analysis, bug fix, file conversion, and media task؛ لكل نوع objective وvalidator وsuccess criteria.";
    expect(inferTaskObjectiveKind({ message })).toBe("project_analysis");
    expect(buildTaskObjectiveContract({ ...base, message })?.kind).toBe("project_analysis");
  });

  it("does not treat a non-empty provider response as proven objective success", () => {
    const contract = buildTaskObjectiveContract({
      ...base,
      message: "Fix the bug in checkout",
    })!;

    const result = validateTaskObjectiveContract({
      contract,
      workspaceRevision: base.workspaceRevision,
      objectiveValidated: false,
      evidenceVerdict: "PROVEN",
      evidenceComplete: true,
    });

    expect(result.allowed).toBe(false);
    expect(result.codes).toContain("objective_not_proven");
  });

  it("rejects a NOT_PROVEN finding with no evidence even when source evidence is complete", () => {
    const contract = buildTaskObjectiveContract({
      ...base,
      message: "Analyze the project acceptance coverage",
      turnIntent: "PROJECT_QUERY",
    })!;

    const result = validateTaskObjectiveContract({
      contract,
      workspaceRevision: base.workspaceRevision,
      objectiveValidated: true,
      evidenceVerdict: "PROVEN",
      evidenceComplete: true,
      taskResult: {
        kind: "FINDING_RESULT",
        finding: {
          finding: "No verified finding",
          evidence: [],
          severity: "NOT_PROVEN",
        },
      },
    });

    expect(result.allowed).toBe(false);
    expect(result.codes).toContain("objective_not_proven");
  });

  it("blocks a successful build when the requested behavior is not proven", () => {
    const contract = buildTaskObjectiveContract({
      ...base,
      message: "Implement the checkout feature",
    })!;

    const result = validateTaskObjectiveContract({
      contract,
      workspaceRevision: base.workspaceRevision,
      objectiveValidated: false,
      evidenceVerdict: "PROVEN",
      evidenceComplete: true,
    });

    expect(result.allowed).toBe(false);
    expect(result.codes).toEqual(["objective_not_proven"]);
  });

  it("rejects revision drift and partial evidence", () => {
    const contract = buildTaskObjectiveContract({
      ...base,
      message: "Analyze the project architecture",
    })!;

    const result = validateTaskObjectiveContract({
      contract,
      workspaceRevision: "revision-2",
      objectiveValidated: false,
      evidenceVerdict: "PARTIAL",
      evidenceComplete: false,
    });

    expect(result.allowed).toBe(false);
    expect(result.codes).toEqual(
      expect.arrayContaining(["revision_mismatch", "partial_evidence", "validation_failed", "objective_not_proven"]),
    );
  });

  it("accepts a browser artifact only after the registered browser validator proves it", () => {
    const contract = buildTaskObjectiveContract({
      ...base,
      message: "Run the browser workflow and verify checkout",
    })!;

    const result = validateTaskObjectiveContract({
      contract,
      workspaceRevision: base.workspaceRevision,
      objectiveValidated: true,
      evidenceVerdict: "PROVEN",
      evidenceComplete: true,
      operationId: "operation-browser",
      validatorReceipts: [{
        validatorId: "browser-preview.v1",
        status: "PROVEN",
        operationId: "operation-browser",
        projectId: base.projectId,
        workspaceRevision: base.workspaceRevision,
        artifactRef: "browser-run:checkout",
      }],
    });

    expect(result.allowed).toBe(true);
  });

  it("keeps deployment and integration tasks incomplete until receipts exist", () => {
    for (const message of [
      "Deploy the application",
      "Integrate the application with GitHub",
    ]) {
      const contract = buildTaskObjectiveContract({ ...base, message })!;
      const result = validateTaskObjectiveContract({
        contract,
        workspaceRevision: base.workspaceRevision,
        objectiveValidated: true,
        evidenceVerdict: "PROVEN",
        evidenceComplete: true,
      });
      expect(result.allowed).toBe(false);
      expect(result.codes).toContain("objective_not_proven");
    }
  });

  it("requires a proven receipt bound to the operation, project, revision, and artifact", () => {
    const contract = buildTaskObjectiveContract({
      ...base,
      message: "Convert this CSV to JSON",
    })!;

    const missing = validateTaskObjectiveContract({
      contract,
      workspaceRevision: base.workspaceRevision,
      projectId: base.projectId,
      operationId: "operation-file",
      objectiveValidated: true,
      evidenceVerdict: "PROVEN",
      evidenceComplete: true,
    });
    expect(missing.allowed).toBe(false);
    expect(missing.codes).toContain("objective_not_proven");

    const mismatched = validateTaskObjectiveContract({
      contract,
      workspaceRevision: base.workspaceRevision,
      projectId: base.projectId,
      operationId: "operation-file",
      objectiveValidated: true,
      evidenceVerdict: "PROVEN",
      evidenceComplete: true,
      validatorReceipts: [{
        validatorId: "file-conversion.v1",
        status: "PROVEN",
        operationId: "other-operation",
        projectId: "other-project",
        workspaceRevision: "old-revision",
        artifactRef: "converted.json",
      }],
    });
    expect(mismatched.allowed).toBe(false);
    expect(mismatched.codes).toEqual(expect.arrayContaining([
      "scope_mismatch",
      "revision_mismatch",
    ]));

    const accepted = validateTaskObjectiveContract({
      contract,
      workspaceRevision: base.workspaceRevision,
      projectId: base.projectId,
      operationId: "operation-file",
      objectiveValidated: true,
      evidenceVerdict: "PROVEN",
      evidenceComplete: true,
      validatorReceipts: [{
        validatorId: "file-conversion.v1",
        status: "PROVEN",
        operationId: "operation-file",
        projectId: base.projectId,
        workspaceRevision: base.workspaceRevision,
        artifactRef: "converted.json",
      }],
    });
    expect(accepted).toEqual({ allowed: true, codes: [], reasons: [] });
  });

  it("does not accept an unavailable or incomplete receipt as proof", () => {
    const contract = buildTaskObjectiveContract({
      ...base,
      message: "Generate a media image",
    })!;
    for (const status of ["UNAVAILABLE", "INCOMPLETE"] as const) {
      const result = validateTaskObjectiveContract({
        contract,
        workspaceRevision: base.workspaceRevision,
        projectId: base.projectId,
        operationId: "operation-media",
        objectiveValidated: true,
        evidenceVerdict: "PROVEN",
        evidenceComplete: true,
        validatorReceipts: [{
          validatorId: "media-artifact.v1",
          status,
          operationId: "operation-media",
          projectId: base.projectId,
          workspaceRevision: base.workspaceRevision,
          artifactRef: "media-output.png",
        }],
      });
      expect(result.allowed).toBe(false);
    }
  });
});