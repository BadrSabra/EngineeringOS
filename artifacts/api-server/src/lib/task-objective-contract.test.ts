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
    });

    expect(result.allowed).toBe(true);
  });

  it("keeps deployment, integration, and media tasks incomplete until validators exist", () => {
    for (const message of [
      "Deploy the application",
      "Integrate the application with GitHub",
      "Convert this image to a media artifact",
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
      expect(result.codes).toContain("validator_unavailable");
    }
  });
});