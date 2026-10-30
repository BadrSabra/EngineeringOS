import { afterEach, describe, expect, it } from "vitest";
import { resolveFallbackChain, _resetModelLaneSchedulerForTest } from "./model-resolver.js";
import {
  _resetModelContractAcceptanceForTest,
  MODEL_TASK_CONTRACTS,
  recordModelContractOutcome,
  recordModelContractOutput,
} from "./model-contract-acceptance.js";

describe("contract-aware free-model resolver", () => {
  afterEach(() => {
    _resetModelContractAcceptanceForTest();
    _resetModelLaneSchedulerForTest();
  });

  it("selects an accepted lane more often without removing unscored fallbacks", () => {
    const contract = MODEL_TASK_CONTRACTS.PROJECT_QUERY_NO_TOOLS_SYNTHESIS;
    const options = {
      capability: "chat" as const,
      quality: "fast" as const,
      taskContract: contract,
    };
    const baseline = resolveFallbackChain(options);
    expect(baseline.length).toBeGreaterThan(2);

    const acceptedModel = baseline[0]!.id;
    const rejectedModel = baseline[1]!.id;
    const now = Date.now();
    for (let sample = 0; sample < 5; sample += 1) {
      recordModelContractOutput(acceptedModel, contract, "content", now + sample);
      recordModelContractOutcome(acceptedModel, contract, "accepted", now + sample);
      recordModelContractOutput(rejectedModel, contract, "content", now + sample);
      recordModelContractOutcome(rejectedModel, contract, "rejected", now + sample);
    }

    _resetModelLaneSchedulerForTest();
    const scheduled = Array.from(
      { length: 21 },
      () => resolveFallbackChain(options).map((model) => model.id),
    );
    const primaryCount = (model: string) =>
      scheduled.filter((chain) => chain[0] === model).length;

    expect(primaryCount(acceptedModel)).toBeGreaterThan(primaryCount(rejectedModel));
    expect(scheduled.every((chain) => chain.includes(acceptedModel))).toBe(true);
    expect(scheduled.every((chain) => chain.includes(rejectedModel))).toBe(true);
    expect(scheduled.every((chain) => chain.some((model) => ![acceptedModel, rejectedModel].includes(model))))
      .toBe(true);
  });
});
