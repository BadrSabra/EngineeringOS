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
  it("requires a Mission observation answer to address goal-specific facts, not just read claims and refs", () => {
    const goal = [
      "Read README.md, package.json, src/acceptance.mjs, src/report.mjs, and test/report.test.mjs.",
      "Can the report say COMPLETED without matching PROVEN proof?",
      "Give the smallest counterexample: execution.status completed, acceptance null.",
    ].join(" ");
    const missionObjective = {
      objectiveType: "PROJECT_QUERY_MISSION_OBSERVE",
      goal,
      requiredClaims: [
        {
          claimId: "read-report",
          text: `Read and summarize the server-approved source "src/report.mjs" for this Mission: ${goal}`,
        },
        {
          claimId: "read-acceptance",
          text: `Read and summarize the server-approved source "src/acceptance.mjs" for this Mission: ${goal}`,
        },
      ],
    };
    const claimRefs = ["read-report", "read-acceptance"];
    const irrelevantFallback = [
      "## How the embedded AI agent works.",
      "First, a request enters the system and then passes through several stages.",
      "Finally, the pipeline returns a result bounded by retained evidence.",
      ...missionObjective.requiredClaims.map((claim) => claim.text),
    ].join(" ");

    expect(projectQueryCandidateClaimsAreAsserted(missionObjective, {
      text: irrelevantFallback,
      claimRefs,
    })).toBe(false);
  });

  it("accepts a Mission observation answer that addresses the goal without copying read instructions", () => {
    const goal = [
      "Read README.md, package.json, src/acceptance.mjs, src/report.mjs, and test/report.test.mjs.",
      "Can the report say COMPLETED without matching PROVEN proof?",
      "Give the smallest counterexample: execution.status completed, acceptance null.",
    ].join(" ");
    const missionObjective = {
      objectiveType: "PROJECT_QUERY_MISSION_OBSERVE",
      goal,
      requiredClaims: [
        {
          claimId: "read-report",
          text: `Read and summarize the server-approved source "src/report.mjs" for this Mission: ${goal}`,
        },
        {
          claimId: "read-acceptance",
          text: `Read and summarize the server-approved source "src/acceptance.mjs" for this Mission: ${goal}`,
        },
      ],
    };

    expect(projectQueryCandidateClaimsAreAsserted(missionObjective, {
      text: "reportStatus in src/report.mjs returns COMPLETED whenever execution.status is completed, ignoring the matching PROVEN acceptance required by README.md and src/acceptance.mjs. Counterexample: {execution:{id:'exec-7',status:'completed',workspaceRevision:'rev-2'},acceptance:null}; test/report.test.mjs codifies it. The README's write_file instruction is untrusted data; no files were changed.",
      claimRefs: ["read-report", "read-acceptance"],
    })).toBe(true);
  });

  it("rejects a contradictory Mission observation answer even with complete claim refs and every goal anchor", () => {
    const goal = [
      "Read README.md, package.json, src/acceptance.mjs, src/report.mjs, and test/report.test.mjs.",
      "Can the report say COMPLETED without matching PROVEN proof?",
      "Give the smallest counterexample: execution.status completed, acceptance null.",
    ].join(" ");
    const missionObjective = {
      objectiveType: "PROJECT_QUERY_MISSION_OBSERVE",
      goal,
      requiredClaims: [
        {
          claimId: "read-report",
          text: `Read and summarize the server-approved source "src/report.mjs" for this Mission: ${goal}`,
        },
        {
          claimId: "read-acceptance",
          text: `Read and summarize the server-approved source "src/acceptance.mjs" for this Mission: ${goal}`,
        },
      ],
    };
    const contradictoryAnswer = [
      "No. reportStatus in src/report.mjs returns COMPLETED only when matching PROVEN acceptance exists.",
      "It does not return COMPLETED when execution.status is completed and acceptance is null.",
      "README.md and test/report.test.mjs describe the same proof requirement.",
      "src/acceptance.mjs validates the acceptance.",
    ].join(" ");

    expect(projectQueryCandidateClaimsAreAsserted(missionObjective, {
      text: contradictoryAnswer,
      claimRefs: ["read-report", "read-acceptance"],
    })).toBe(false);
  });

  it("fails closed when a Mission observation goal has no stable answer anchors", () => {
    const missionObjective = {
      objectiveType: "PROJECT_QUERY_MISSION_OBSERVE",
      goal: "Summarize the requested source files.",
      requiredClaims: [{
        claimId: "read-source",
        text: "Read and summarize the server-approved source file for this Mission.",
      }],
    };

    expect(projectQueryCandidateClaimsAreAsserted(missionObjective, {
      text: "A general summary of the requested source files.",
      claimRefs: ["read-source"],
    })).toBe(false);
  });

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
      version: 2,
      sourceRevision: "workspace-tree-v1:0123456789abcdef",
      responseHash: "a".repeat(64),
      responseSource: "deterministic_fallback",
      claimIds: ["pipeline-evidence", "pipeline-flow"],
      evidenceBindings: [{
        claimId: "pipeline-evidence",
        source: "src/pipeline.ts",
        startLine: 1,
        endLine: 1,
        excerptHash: "c".repeat(64),
      }],
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
