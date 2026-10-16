import { describe, expect, it } from "vitest";
import {
  closeObjectiveClaimsFromEvidence,
  materializeObjectiveClaimEvidence,
} from "../required-claims.js";
import { EvidenceReferenceSchema } from "../task-contracts.js";

describe("Mission observation evidence", () => {
  it("anchors every scoped claim to an exact server-retained source excerpt", () => {
    const objective: Parameters<typeof materializeObjectiveClaimEvidence>[0]["objective"] = {
      objectiveType: "PROJECT_QUERY_MISSION_OBSERVE",
      goal: "Summarize the verified facts in the requested fixture files.",
      requiredEvidencePaths: ["README.md", "package.json"],
      requiredClaims: [
        {
          claimId: "mission-observe-file-1",
          text: "Read and summarize the server-approved README.md source for this Mission.",
          requiredEvidencePaths: ["README.md"],
        },
        {
          claimId: "mission-observe-file-2",
          text: "Read and summarize the server-approved package.json source for this Mission.",
          requiredEvidencePaths: ["package.json"],
        },
      ],
      requiredEvidenceEdges: [],
    };
    const fileContents = new Map([
      ["README.md", "# Goal-first evidence fixture\nThis project is a read-only test fixture.\n"],
      ["package.json", '{\n  "name": "goal-first-evidence-fixture",\n}\n'],
    ]);

    const evidence = materializeObjectiveClaimEvidence({ objective, fileContents });

    expect(evidence.map((item) => item.claimId)).toEqual([
      "mission-observe-file-1",
      "mission-observe-file-2",
    ]);
    expect(evidence.map((item) => item.source)).toEqual(["README.md", "package.json"]);
    expect(evidence[0]?.excerpt).toContain("# Goal-first evidence fixture");
    expect(evidence[1]?.excerpt).toContain('"name": "goal-first-evidence-fixture"');

    const acceptedEvidence = evidence.map((item) => EvidenceReferenceSchema.parse({
      source: item.source,
      excerpt: item.excerpt,
      supportsClaim: true,
      relevance: 1,
      directness: "DIRECT",
      sourceType: "IMPLEMENTATION",
      productionReachability: "PROVEN",
      evidenceClass: "READ_CONFIRMED",
      citationStatus: "ACCEPTED",
      citationReason: "ACCEPTED_SOURCE_SPAN",
    }));
    const closedClaims = closeObjectiveClaimsFromEvidence({
      objective,
      response: "The bounded summary is tied to both requested source files.",
      assertedClaimIds: objective.requiredClaims.map((claim) => claim.claimId),
      evidence: acceptedEvidence,
      fileContents,
      requireAcceptedEvidence: true,
    });

    expect(closedClaims.map(({ status, evidencePaths }) => ({ status, evidencePaths })))
      .toEqual([
        { status: "CLOSED", evidencePaths: ["README.md"] },
        { status: "CLOSED", evidencePaths: ["package.json"] },
      ]);
  });

  it("does not materialize an observation claim when its required source is absent", () => {
    const objective: Parameters<typeof materializeObjectiveClaimEvidence>[0]["objective"] = {
      objectiveType: "PROJECT_QUERY_MISSION_OBSERVE",
      goal: "Summarize the requested source.",
      requiredEvidencePaths: ["README.md"],
      requiredClaims: [{
        claimId: "mission-observe-file-1",
        text: "Read and summarize the server-approved README.md source.",
        requiredEvidencePaths: ["README.md"],
      }],
      requiredEvidenceEdges: [],
    };

    expect(materializeObjectiveClaimEvidence({
      objective,
      fileContents: new Map(),
    })).toEqual([]);
  });
});
