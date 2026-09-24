import { describe, expect, it } from "vitest";
import {
  AgentActionSchema,
  AgentEffectSchema,
  EffectContractSchema,
  classifyEffect,
  hashEffectContract,
  parseAgentObservation,
  parseEffectContract,
} from "../agent-state/index.js";
import type { AgentObservation } from "../agent-state/index.js";

const contract = {
  schemaVersion: "1" as const,
  effectId: "effect-1",
  expectedStateChanges: [{ subject: "workspace", predicate: "validated", expectedValue: true }],
  observationProfile: "TEST" as const,
  requiredEvidence: ["validation-1"],
  allowedResult: "OBSERVED" as const,
};

function observation(overrides: Partial<AgentObservation>): AgentObservation {
  return parseAgentObservation({
    schemaVersion: "1",
    observationId: "observation-1",
    projectId: "project-1",
    executionId: "execution-1",
    episodeId: "episode-1",
    kind: "EXTERNAL",
    provenance: "DIRECT_OBSERVATION",
    observationRole: "effect",
    sourceType: "runtime",
    sourceId: "runtime-1",
    sourceVersion: "revision-1",
    subject: "workspace",
    predicate: "validated",
    value: false,
    sourceRefs: ["runtime:1"],
    observedAt: "2026-09-24T00:00:00.000Z",
    projectRevision: "revision-1",
    completeness: "complete",
    freshness: "fresh",
    evidenceRefs: ["evidence:1"],
    ...overrides,
  });
}

describe("agent effect contract", () => {
  it("accepts a bounded effect contract and has a stable hash", () => {
    expect(parseEffectContract(contract).effectId).toBe("effect-1");
    expect(hashEffectContract(contract)).toHaveLength(64);
  });

  it("rejects unknown effect status and oversized payloads", () => {
    expect(AgentEffectSchema.safeParse({
      schemaVersion: "1",
      effectId: "effect-1",
      projectId: "project-1",
      episodeId: "episode-1",
      executionId: "execution-1",
      attempt: 0,
      actionId: "action-1",
      capabilityId: "validation",
      effectContractHash: "hash",
      beforeObservationIds: [],
      afterObservationIds: [],
      expectedEffects: {},
      status: "proven",
      missingEffects: [],
      contradictionRefs: [],
      evidenceRefs: [],
      createdAt: "2026-09-24T00:00:00.000Z",
    }).success).toBe(false);
    expect(EffectContractSchema.safeParse({
      ...contract,
      expectedStateChanges: [{ subject: "x", predicate: "y", expectedValue: "x".repeat(17 * 1024) }],
    }).success).toBe(false);
  });

  it("requires an action to declare the effect contract it is about to execute", () => {
    expect(AgentActionSchema.safeParse({
      schemaVersion: "1",
      actionId: "action-1",
      episodeId: "episode-1",
      capabilityId: "validation",
      intent: "Run the validation capability",
      scope: { projectId: "project-1" },
      preconditions: ["workspace is available"],
      expectedEffects: ["effect-1"],
      authorization: { source: "server" },
      risk: "LOW",
      idempotencyKey: "action-1",
      observationProfile: "TEST",
      failureSemantics: ["Do not claim success without a direct after observation."],
    }).success).toBe(true);
  });

  it("classifies a complete transition as observed", () => {
    expect(classifyEffect({
      contract,
      before: [observation({ value: false })],
      after: [observation({ observationId: "observation-2", value: true })],
    }).status).toBe("observed");
  });

  it("classifies mixed transitions as partial", () => {
    const second = { subject: "other", predicate: "ready", expectedValue: true };
    expect(classifyEffect({
      contract: { ...contract, expectedStateChanges: [...contract.expectedStateChanges, second] },
      before: [
        observation({ value: false }),
        observation({ observationId: "observation-3", subject: "other", predicate: "ready", value: false }),
      ],
      after: [observation({ observationId: "observation-2", value: true })],
    }).status).toBe("partial");
  });

  it("classifies missing direct evidence as not observed", () => {
    expect(classifyEffect({
      contract,
      before: [observation({ value: false, provenance: "SERVER_DERIVED" })],
      after: [],
    }).status).toBe("not_observed");
  });

  it("classifies a conflicting after observation as contradicted", () => {
    expect(classifyEffect({
      contract,
      before: [observation({ value: false })],
      after: [observation({ observationId: "observation-2", value: "wrong" })],
    }).status).toBe("contradicted");
  });

  it("classifies an unchanged state as unknown", () => {
    expect(classifyEffect({
      contract,
      before: [observation({ value: true })],
      after: [observation({ observationId: "observation-2", value: true })],
    }).status).toBe("unknown");
  });
});