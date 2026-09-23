import { describe, expect, it } from "vitest";
import {
  AgentEffectSchema,
  EffectContractSchema,
  hashEffectContract,
  parseEffectContract,
} from "../agent-state/index.js";

const contract = {
  schemaVersion: "1" as const,
  effectId: "effect-1",
  expectedStateChanges: [{ subject: "workspace", predicate: "validated", expectedValue: true }],
  observationProfile: "TEST" as const,
  requiredEvidence: ["validation-1"],
  allowedResult: "OBSERVED" as const,
};

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
});