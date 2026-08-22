import { afterEach, describe, expect, it } from "vitest";
import { FREE_MODELS } from "../openrouter/model-catalog.js";
import {
  isFreeOpenRouterModel,
  resolveFreeModelOverride,
} from "../model-selection/model-resolver.js";

describe("free OpenRouter model overrides", () => {
  afterEach(() => {
    delete process.env.RUN_CONTROLLED_RELEASE_VALIDATION;
  });

  it("accepts a catalog model and rejects unknown or paid overrides", () => {
    const freeModel = FREE_MODELS[0].id;
    expect(isFreeOpenRouterModel(freeModel)).toBe(true);
    expect(resolveFreeModelOverride(freeModel)).toBe(freeModel);
    expect(() => resolveFreeModelOverride("openai/gpt-4o")).toThrow(/currently-free/);
  });

  it("keeps non-free models isolated to explicit controlled-live runs", () => {
    process.env.RUN_CONTROLLED_RELEASE_VALIDATION = "1";
    expect(resolveFreeModelOverride("openai/gpt-4o")).toBe("openai/gpt-4o");
  });
});