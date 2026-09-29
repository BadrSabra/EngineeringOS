import { describe, expect, it } from "vitest";
import {
  deriveProjectQueryDiscoveryTarget,
} from "../objective-replanning.js";
import {
  closeObjectiveClaimsFromEvidence,
  materializeObjectiveClaimEvidence,
  type ClaimEvidenceAttachment,
} from "../required-claims.js";
import type { ObjectiveContract } from "../schemas/chat.schema.js";

const expansionPath = "lib/ai-orchestrator/src/tool-execution-engine.ts";

function objective(overrides: Partial<ObjectiveContract> = {}): ObjectiveContract {
  return {
    objectiveType: "PROJECT_QUERY_BEHAVIOR",
    goal: "Explain the behavior using evidence from the existing project.",
    requiredEvidencePaths: ["src/primary.ts"],
    requiredClaims: [{
      claimId: "existing-claim",
      text: "The server authorizes source reads before they execute.",
      requiredEvidencePaths: ["src/primary.ts"],
      evidenceNeedlesByPath: {
        "src/primary.ts": ["primary-claim-marker"],
        [expansionPath]: ["read_file", "objectiveScopePolicy"],
      },
    }],
    requiredEvidenceEdges: [],
    scopePolicy: {
      primaryPaths: ["src/primary.ts"],
      allowedExpansionPaths: ["lib/ai-orchestrator/src"],
      forbiddenPaths: ["lib/ai-orchestrator/src/__tests__"],
    },
    ...overrides,
  };
}

describe("existing PROJECT_QUERY claim evidence expansion", () => {
  it("selects one manifest-backed, allowed source already bound to an existing claim", () => {
    const result = deriveProjectQueryDiscoveryTarget({
      objective: objective(),
      candidatePaths: ["../outside.ts", expansionPath],
      manifestPaths: [expansionPath],
      retainedFileContents: new Map([["src/primary.ts", "no matching marker"]]),
      readStatuses: new Map(),
    });

    expect(result).toEqual({
      path: expansionPath,
      claimId: "existing-claim",
      evidenceNeedles: ["read_file", "objectiveScopePolicy"],
      reason: "DISCOVERED_PROJECT_QUERY_SOURCE",
    });
  });

  it("does not select missing, out-of-scope, previously read, or unbound candidates", () => {
    expect(deriveProjectQueryDiscoveryTarget({
      objective: objective(),
      candidatePaths: [expansionPath],
      manifestPaths: [],
      retainedFileContents: new Map(),
    })).toBeUndefined();

    expect(deriveProjectQueryDiscoveryTarget({
      objective: objective({
        scopePolicy: {
          primaryPaths: ["src/primary.ts"],
          allowedExpansionPaths: [],
          forbiddenPaths: [],
        },
      }),
      candidatePaths: [expansionPath],
      manifestPaths: [expansionPath],
      retainedFileContents: new Map(),
    })).toBeUndefined();

    expect(deriveProjectQueryDiscoveryTarget({
      objective: objective(),
      candidatePaths: [expansionPath],
      manifestPaths: [expansionPath],
      retainedFileContents: new Map(),
      readStatuses: new Map([[expansionPath, "READ_FAILED"]]),
    })).toBeUndefined();

    expect(deriveProjectQueryDiscoveryTarget({
      objective: objective({
        requiredClaims: [{
          claimId: "existing-claim",
          text: "The server authorizes source reads before they execute.",
          requiredEvidencePaths: ["src/primary.ts"],
          evidenceNeedlesByPath: { "src/primary.ts": ["primary-claim-marker"] },
        }],
      }),
      candidatePaths: [expansionPath],
      manifestPaths: [expansionPath],
      retainedFileContents: new Map(),
    })).toBeUndefined();
  });

  it("retains a candidate read as unaccepted context unless claim needles match", () => {
    const contract = objective();
    const body = "read_file runs only after objectiveScopePolicy authorizes the path.";
    const fileContents = new Map([
      ["src/primary.ts", "no matching marker"],
      [expansionPath, body],
    ]);
    const baseAttachment = {
      claimId: "existing-claim",
      observationId: "observation-row-123",
      sourcePath: expansionPath,
    } as const;
    const contextAttachment: ClaimEvidenceAttachment = {
      ...baseAttachment,
      relation: "context",
    };
    const supportingAttachment: ClaimEvidenceAttachment = {
      ...baseAttachment,
      relation: "supports",
    };

    expect(materializeObjectiveClaimEvidence({
      objective: contract,
      fileContents,
      claimEvidenceAttachments: [contextAttachment],
    })).toEqual([]);
    expect(materializeObjectiveClaimEvidence({
      objective: contract,
      fileContents,
      claimEvidenceAttachments: [supportingAttachment],
    })).toMatchObject([{
      claimId: "existing-claim",
      source: expansionPath,
      excerpt: body,
    }]);

    const evidence = [{
      source: expansionPath,
      excerpt: body,
    }] as never;
    const contextClosure = closeObjectiveClaimsFromEvidence({
      objective: contract,
      response: "",
      assertedClaimIds: ["existing-claim"],
      evidence,
      fileContents,
      claimEvidenceAttachments: [contextAttachment],
      requireAcceptedEvidence: true,
    });
    const supportingClosure = closeObjectiveClaimsFromEvidence({
      objective: contract,
      response: "",
      assertedClaimIds: ["existing-claim"],
      evidence,
      fileContents,
      claimEvidenceAttachments: [supportingAttachment],
      requireAcceptedEvidence: true,
    });

    expect(contextClosure.find((claim) => claim.claimId === "objective:existing-claim")?.status)
      .toBe("UNCLOSED");
    expect(supportingClosure.find((claim) => claim.claimId === "objective:existing-claim"))
      .toMatchObject({ status: "CLOSED", evidencePaths: [expansionPath] });

    const claimWithoutRequiredPaths = objective({
      requiredEvidencePaths: [],
      requiredClaims: [{
        claimId: "existing-claim",
        text: "The server authorizes source reads before they execute.",
        requiredEvidencePaths: [],
        evidenceNeedlesByPath: {
          [expansionPath]: ["read_file", "objectiveScopePolicy"],
        },
      }],
    });
    expect(materializeObjectiveClaimEvidence({
      objective: claimWithoutRequiredPaths,
      fileContents,
      claimEvidenceAttachments: [contextAttachment],
    })).toEqual([]);
    const unattachedExpansionClosure = closeObjectiveClaimsFromEvidence({
      objective: claimWithoutRequiredPaths,
      response: "",
      assertedClaimIds: ["existing-claim"],
      evidence,
      fileContents,
      claimEvidenceAttachments: [contextAttachment],
      requireAcceptedEvidence: true,
    });
    expect(
      unattachedExpansionClosure
        .find((claim) => claim.claimId === "objective:existing-claim")?.status,
    ).toBe("UNCLOSED");
  });
});