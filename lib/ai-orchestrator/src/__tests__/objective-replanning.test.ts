import { describe, expect, it } from "vitest";
import { deriveObjectiveReplanTargets } from "../objective-replanning.js";
import type { ObjectiveContract } from "../schemas/chat.schema.js";

function objective(
  overrides: Partial<ObjectiveContract> = {},
): ObjectiveContract {
  return {
    objectiveType: "PROJECT_QUERY_BEHAVIOR",
    goal: "Explain the declared behavior from retained source evidence.",
    requiredEvidencePaths: [],
    requiredClaims: [],
    requiredEvidenceEdges: [],
    ...overrides,
  };
}

describe("deriveObjectiveReplanTargets", () => {
  it("returns only missing declared paths in contract order and caps them", () => {
    const result = deriveObjectiveReplanTargets({
      objective: objective({
        requiredEvidencePaths: ["src/first.ts", "src/second.ts", "src/third.ts"],
      }),
      retainedPaths: ["src/first.ts"],
      maxTargets: 2,
    });

    expect(result).toEqual([
      {
        path: "src/second.ts",
        claimIds: [],
        edgeKeys: [],
        reason: "MISSING_REQUIRED_EVIDENCE_PATH",
      },
      {
        path: "src/third.ts",
        claimIds: [],
        edgeKeys: [],
        reason: "MISSING_REQUIRED_EVIDENCE_PATH",
      },
    ]);
  });

  it("replans truncated claim evidence and annotates the owning claim", () => {
    const result = deriveObjectiveReplanTargets({
      objective: objective({
        requiredClaims: [
          {
            claimId: "behavior",
            text: "The handler validates the incoming request.",
            requiredEvidencePaths: ["src/handler.ts"],
          },
        ],
      }),
      retainedPaths: ["src/handler.ts"],
      readStatuses: new Map([["src/handler.ts", "READ_TRUNCATED"]]),
    });

    expect(result).toEqual([
      {
        path: "src/handler.ts",
        claimIds: ["behavior"],
        edgeKeys: [],
        reason: "MISSING_CLAIM_EVIDENCE_PATH",
      },
    ]);
  });

  it("uses a path-qualified edge caller only when the caller body is missing", () => {
    const result = deriveObjectiveReplanTargets({
      objective: objective({
        requiredEvidenceEdges: [
          {
            from: "src/router.ts#handle",
            to: "src/service.ts#execute",
            relationship: "calls",
          },
          {
            from: "handle",
            to: "execute",
            relationship: "calls",
          },
        ],
      }),
      retainedPaths: [],
      maxTargets: 2,
    });

    expect(result).toEqual([
      {
        path: "src/router.ts",
        claimIds: [],
        edgeKeys: ["src/router.ts#handle->src/service.ts#execute"],
        reason: "MISSING_EDGE_CALLER_PATH",
      },
    ]);
  });

  it("does not treat bare symbols or traversal paths as targets", () => {
    const result = deriveObjectiveReplanTargets({
      objective: objective({
        requiredEvidencePaths: ["../outside.ts"],
        requiredEvidenceEdges: [
          {
            from: "router",
            to: "execute",
            relationship: "calls",
          },
        ],
      }),
      retainedPaths: [],
    });

    expect(result).toEqual([]);
  });
});