import { describe, expect, it } from "vitest";
import {
  projectQueryAnswerHasBehavioralFlow,
  projectQueryCandidateClaimsAreAsserted,
} from "../agents/project-query-answer-contract.js";
import {
  ChatOutputSchema,
  ProviderChatOutputSchema,
} from "../schemas/chat.schema.js";

const objective = {
  objectiveType: "PROJECT_QUERY_EMBEDDED-AI",
  requiredClaims: [
    {
      claimId: "pipeline-evidence",
      text: "The project pipeline reads source evidence before synthesis.",
    },
    {
      claimId: "pipeline-flow",
      text: "The pipeline passes retained evidence into the final answer.",
    },
  ],
};

const claimRefs = ["pipeline-evidence", "pipeline-flow"];
const flowRefs = ["pipeline-evidence", "pipeline-flow"];

describe("project-query answer contract", () => {
  it("does not let complete claim references substitute for the claim text", () => {
    const genericResponse = [
      "First, the request enters the system and then passes through several stages.",
      "After that, the system transforms available information before returning a result.",
      "Finally, this describes a generic pipeline without asserting either required behavior.",
    ].join(" ");

    expect(projectQueryCandidateClaimsAreAsserted(objective, {
      text: genericResponse,
      claimRefs,
    })).toBe(false);
    expect(projectQueryAnswerHasBehavioralFlow(objective, genericResponse, flowRefs)).toBe(false);
  });

  it("rejects a canonical claim quoted as a negated assertion", () => {
    const negatedResponse = [
      "First, this system does not demonstrate that the project pipeline reads source evidence before synthesis.",
      "Then, it also does not establish that the pipeline passes retained evidence into the final answer.",
      "Finally, the references are present but the behavior remains unproven.",
    ].join(" ");

    expect(projectQueryCandidateClaimsAreAsserted(objective, {
      text: negatedResponse,
      claimRefs,
    })).toBe(false);
    expect(projectQueryAnswerHasBehavioralFlow(objective, negatedResponse, flowRefs)).toBe(false);
  });

  it("accepts claim text only when the response also describes a bounded flow", () => {
    const supportedResponse = [
      "First, the request enters the bounded project path and reads the declared source.",
      objective.requiredClaims[0]!.text,
      "Then, retained evidence moves into synthesis before the final response.",
      objective.requiredClaims[1]!.text,
      "Finally, these steps show how the project pipeline connects source reading to its answer.",
    ].join(" ");

    expect(projectQueryCandidateClaimsAreAsserted(objective, {
      text: supportedResponse,
      claimRefs,
    })).toBe(true);
    expect(projectQueryAnswerHasBehavioralFlow(objective, supportedResponse, flowRefs)).toBe(true);
  });

  it("does not let flow references bypass the prose flow requirement", () => {
    const inventoryOnlyResponse = [
      objective.requiredClaims[0]!.text,
      objective.requiredClaims[1]!.text,
      "The remaining response is a list of names and descriptions, without a sequence or causal explanation.",
    ].join(" ");

    expect(projectQueryAnswerHasBehavioralFlow(objective, inventoryOnlyResponse, flowRefs)).toBe(false);
  });

  it("reserves answer attestations for server output, not provider JSON", () => {
    const attestation = {
      version: 1,
      responseHash: "a".repeat(64),
      responseSource: "deterministic_fallback",
      claimIds: ["pipeline-evidence", "pipeline-flow"],
      evidenceBindingHash: "b".repeat(64),
    };
    const providerPayload = {
      response: "A provider response.",
      sources: [],
      projectQueryAnswerAttestation: attestation,
    };

    expect(ProviderChatOutputSchema.safeParse(providerPayload).success).toBe(false);
    expect(ChatOutputSchema.safeParse(providerPayload).success).toBe(true);
  });
});
