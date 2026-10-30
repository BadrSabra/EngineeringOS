import { describe, expect, it } from "vitest";
import { shouldApplyStructuredExecutionCooldown } from "./structured-task-execution.js";

describe("structured execution cooldown scope", () => {
  it("does not widen OpenRouter model-pool cooldowns to other free models", () => {
    expect(shouldApplyStructuredExecutionCooldown({
      providerName: "OpenRouter",
      rateLimitScope: "upstream_shared_pool",
    })).toBe(false);
  });

  it("keeps broader provider and unknown cooldowns conservative", () => {
    for (const rateLimitScope of ["provider_credential", "account_quota", "unknown", undefined]) {
      expect(shouldApplyStructuredExecutionCooldown({
        providerName: "OpenRouter",
        rateLimitScope,
      })).toBe(true);
    }
  });

  it("does not apply OpenRouter-specific semantics to another provider", () => {
    expect(shouldApplyStructuredExecutionCooldown({
      providerName: "OtherProvider",
      rateLimitScope: "upstream_shared_pool",
    })).toBe(true);
  });
});
