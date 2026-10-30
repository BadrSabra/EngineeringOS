import { afterEach, describe, expect, it } from "vitest";
import {
  _resetModelContractAcceptanceForTest,
  getModelContractAvailabilityWeight,
  getModelContractAcceptanceRate,
  getModelContractAcceptanceWeight,
  hydrateModelContractSamples,
  MODEL_CONTRACT_ACCEPTANCE_CONFIG,
  MODEL_TASK_CONTRACTS,
  recordModelContractOutcome,
  recordModelContractOutput,
  selectWeightedModelIndex,
} from "./model-contract-acceptance.js";

describe("model contract acceptance history", () => {
  afterEach(() => _resetModelContractAcceptanceForTest());

  it("does not rank a model until the server has evaluated enough outcomes", () => {
    const contract = MODEL_TASK_CONTRACTS.PROJECT_QUERY_NO_TOOLS_SYNTHESIS;
    for (let i = 0; i < MODEL_CONTRACT_ACCEPTANCE_CONFIG.minSamples - 1; i += 1) {
      recordModelContractOutcome("model-a", contract, "accepted", 1_000 + i);
    }
    expect(getModelContractAcceptanceRate("model-a", contract, 1_000)).toBeNull();
  });

  it("keeps rates isolated by exact model and contract", () => {
    const synthesis = MODEL_TASK_CONTRACTS.PROJECT_QUERY_NO_TOOLS_SYNTHESIS;
    for (let i = 0; i < 5; i += 1) {
      recordModelContractOutcome("model-a", synthesis, "accepted", 1_000 + i);
      recordModelContractOutcome("model-b", synthesis, "rejected", 1_000 + i);
    }

    expect(getModelContractAcceptanceRate("model-a", synthesis, 1_010)).toBeGreaterThan(0.5);
    expect(getModelContractAcceptanceRate("model-b", synthesis, 1_010)).toBeLessThan(0.5);
    expect(getModelContractAcceptanceWeight("model-a", synthesis, 1_010)).toBe(4);
    expect(getModelContractAcceptanceWeight("model-b", synthesis, 1_010)).toBe(1);
    expect(getModelContractAcceptanceWeight("model-new", synthesis, 1_010)).toBeNull();
    expect(getModelContractAcceptanceRate("model-a", "another-contract" as typeof synthesis, 1_010)).toBeNull();
  });

  it("expires outcomes outside the rolling observation window", () => {
    const contract = MODEL_TASK_CONTRACTS.PROJECT_QUERY_NO_TOOLS_SYNTHESIS;
    for (let i = 0; i < MODEL_CONTRACT_ACCEPTANCE_CONFIG.minSamples; i += 1) {
      recordModelContractOutcome("model-a", contract, "accepted", 1_000 + i);
    }

    expect(getModelContractAcceptanceRate(
      "model-a",
      contract,
      1_000 + MODEL_CONTRACT_ACCEPTANCE_CONFIG.windowMs + 1,
    )).toBeNull();
  });

  it("uses weighted primary selection while leaving the fallback chain intact", () => {
    const weights = [4, 1];
    expect(Array.from({ length: 5 }, (_, cursor) =>
      selectWeightedModelIndex(weights, cursor),
    )).toEqual([0, 0, 0, 0, 1]);
  });

  it("keeps empty-output availability separate from contract acceptance", () => {
    const contract = MODEL_TASK_CONTRACTS.PROJECT_QUERY_NO_TOOLS_SYNTHESIS;
    for (let i = 0; i < 5; i += 1) {
      recordModelContractOutput("model-content", contract, "content", 2_000 + i);
      recordModelContractOutcome("model-content", contract, "rejected", 2_000 + i);
      recordModelContractOutput("model-empty", contract, "empty", 2_000 + i);
    }

    expect(getModelContractAvailabilityWeight("model-content", contract, 2_010)).toBe(4);
    expect(getModelContractAcceptanceWeight("model-content", contract, 2_010)).toBe(1);
    expect(getModelContractAvailabilityWeight("model-empty", contract, 2_010)).toBe(1);
    expect(getModelContractAcceptanceRate("model-empty", contract, 2_010)).toBeNull();
  });

  it("rehydrates recent exact-contract samples and ignores stale or unknown rows", () => {
    const contract = MODEL_TASK_CONTRACTS.PROJECT_QUERY_NO_TOOLS_SYNTHESIS;
    const now = 10_000;
    const samples = [
      ...Array.from({ length: 5 }, (_, index) => ({
        model: "persisted-accepted",
        contract,
        outcome: "accepted",
        occurredAt: now - 20 + index,
      })),
      ...Array.from({ length: 5 }, (_, index) => ({
        model: "persisted-rejected",
        contract,
        outcome: "rejected",
        occurredAt: now - 20 + index,
      })),
      ...Array.from({ length: 5 }, (_, index) => ({
        model: "persisted-empty",
        contract,
        outcome: "empty",
        occurredAt: now - 20 + index,
      })),
      {
        model: "stale",
        contract,
        outcome: "accepted",
        occurredAt: now - MODEL_CONTRACT_ACCEPTANCE_CONFIG.windowMs - 1,
      },
      {
        model: "unknown-contract",
        contract: "not-a-server-contract",
        outcome: "accepted",
        occurredAt: now - 10,
      },
    ];

    hydrateModelContractSamples(samples, now);

    expect(getModelContractAcceptanceWeight("persisted-accepted", contract, now)).toBe(4);
    expect(getModelContractAcceptanceWeight("persisted-rejected", contract, now)).toBe(1);
    expect(getModelContractAvailabilityWeight("persisted-empty", contract, now)).toBe(1);
    expect(getModelContractAcceptanceRate("persisted-empty", contract, now)).toBeNull();
    expect(getModelContractAcceptanceRate("stale", contract, now)).toBeNull();
    expect(getModelContractAcceptanceRate(
      "unknown-contract",
      contract,
      now,
    )).toBeNull();
  });
});
