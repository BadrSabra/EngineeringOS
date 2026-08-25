import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  BEHAVIORAL_SCORECARD_CONFIG,
  _resetBehavioralScorecardForTest,
  getBehavioralScorecard,
  getBehavioralScorecards,
  recordBehavioralFailure,
  recordBehavioralModelCall,
} from "../behavioral-scorecard.js";
import { FREE_MODELS } from "../openrouter/model-catalog.js";
import { resolveFallbackChain } from "../openrouter/model-resolver.js";
import { _resetForTest as _resetDynamicCatalog } from "../openrouter/dynamic-catalog.js";

describe("behavioral model scorecards", () => {
  beforeEach(() => {
    _resetBehavioralScorecardForTest();
    _resetDynamicCatalog();
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("aggregates loop, soft-limit, and malformed-JSON rates in a rolling window", () => {
    for (let i = 0; i < 5; i++) {
      recordBehavioralModelCall("model-a", i);
    }
    recordBehavioralFailure("model-a", "loop", 0);
    recordBehavioralFailure("model-a", "loop", 1);
    recordBehavioralFailure("model-a", "soft_limit", 2);
    recordBehavioralFailure("model-a", "malformed_json", 3);

    expect(getBehavioralScorecard("model-a")).toMatchObject({
      sampleCount: 5,
      loopCount: 2,
      duplicateToolCallCount: 2,
      softLimitCount: 1,
      malformedJsonCount: 1,
      loopRate: 0.4,
      duplicateToolCallRate: 0.4,
      softLimitRate: 0.2,
      malformedJsonRate: 0.2,
      demoted: false,
    });
  });

  it("demotes a model only after enough recent samples cross the loop threshold", () => {
    for (let i = 0; i < BEHAVIORAL_SCORECARD_CONFIG.minSamples; i++) {
      recordBehavioralModelCall("looping-model", i);
    }
    recordBehavioralFailure("looping-model", "loop", 0);
    recordBehavioralFailure("looping-model", "loop", 1);
    recordBehavioralFailure("looping-model", "loop", 2);

    expect(getBehavioralScorecard("looping-model")?.demoted).toBe(true);
    expect(getBehavioralScorecards()[0]?.model).toBe("looping-model");
  });

  it("recovers after the rolling window expires", () => {
    for (let i = 0; i < BEHAVIORAL_SCORECARD_CONFIG.minSamples; i++) {
      recordBehavioralModelCall("recovering-model", i);
    }
    for (let i = 0; i < 3; i++) {
      recordBehavioralFailure("recovering-model", "loop", i);
    }
    expect(getBehavioralScorecard("recovering-model")?.demoted).toBe(true);

    vi.setSystemTime(BEHAVIORAL_SCORECARD_CONFIG.windowMs + 5);
    expect(getBehavioralScorecard("recovering-model")).toBeUndefined();

    recordBehavioralModelCall("recovering-model");
    expect(getBehavioralScorecard("recovering-model")?.demoted).toBe(false);
  });

  it("demotes task_execution fallback candidates without removing them", () => {
    const candidate = FREE_MODELS.find((model) => model.capabilities.includes("chat"))!;
    for (let i = 0; i < BEHAVIORAL_SCORECARD_CONFIG.minSamples; i++) {
      recordBehavioralModelCall(candidate.id, i);
    }
    for (let i = 0; i < 3; i++) {
      recordBehavioralFailure(candidate.id, "loop", i);
    }

    const normalChain = resolveFallbackChain({
      capability: "chat",
      quality: candidate.quality,
    });
    const taskChain = resolveFallbackChain({
      capability: "chat",
      quality: candidate.quality,
      taskType: "task_execution",
    });

    expect(normalChain[0]?.id).toBe(candidate.id);
    expect(taskChain[0]?.id).not.toBe(candidate.id);
    expect(taskChain.map((model) => model.id)).toContain(candidate.id);
  });

  it("restores the original ordering after the model recovers", () => {
    const candidate = FREE_MODELS.find((model) => model.capabilities.includes("chat"))!;
    for (let i = 0; i < BEHAVIORAL_SCORECARD_CONFIG.minSamples; i++) {
      recordBehavioralModelCall(candidate.id, i);
    }
    for (let i = 0; i < 3; i++) {
      recordBehavioralFailure(candidate.id, "loop", i);
    }
    vi.setSystemTime(BEHAVIORAL_SCORECARD_CONFIG.windowMs + 1);

    const recoveredChain = resolveFallbackChain({
      capability: "chat",
      quality: candidate.quality,
      taskType: "task_execution",
    });
    expect(recoveredChain[0]?.id).toBe(candidate.id);
  });
});