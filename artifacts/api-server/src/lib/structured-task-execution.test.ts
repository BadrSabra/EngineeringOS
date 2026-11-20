import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  resolveStructuredRetryAfter,
  shouldApplyStructuredExecutionCooldown,
  structuredCooldownCurrentAttemptPredicate,
} from "./structured-task-execution.js";

describe("structured execution cooldown attempt binding", () => {
  it("matches cooldown acceptances only to the execution's current attempt", () => {
    const query = new PgDialect().sqlToQuery(
      structuredCooldownCurrentAttemptPredicate(),
    );

    expect(query.sql).toContain(
      '"ai_execution_acceptances"."attempt" = "ai_executions"."attempt"',
    );
  });
});

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

describe("structured execution retry directives", () => {
  it.each(["provider", "local_adaptive", "local_admission", "project_rate_limit"] as const)(
    "retains the explicit %s wait",
    async (retryAfterSource) => {
      await expect(resolveStructuredRetryAfter({
        retryAfterMs: 30_000,
        retryAfterSource,
      })).resolves.toEqual({
        retryAfterMs: 30_000,
        source: retryAfterSource,
      });
    },
  );

  it.each(["server_default", "adaptive_default"] as const)(
    "continues to reject legacy %s delays as authoritative waits",
    async (retryAfterSource) => {
      await expect(resolveStructuredRetryAfter({
        retryAfterMs: 30_000,
        retryAfterSource,
      })).resolves.toBeUndefined();
    },
  );
});
