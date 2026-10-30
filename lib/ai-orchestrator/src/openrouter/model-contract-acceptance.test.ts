import { afterEach, describe, expect, it } from "vitest";
import {
  _resetModelContractAcceptanceForTest,
  getModelContractAcceptanceRate,
  getModelContractAcceptanceWeight,
  MODEL_CONTRACT_ACCEPTANCE_CONFIG,
  MODEL_TASK_CONTRACTS,
  recordModelContractOutcome,
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
});
