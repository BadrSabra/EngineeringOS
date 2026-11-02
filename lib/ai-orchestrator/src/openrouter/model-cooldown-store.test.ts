import { afterEach, describe, expect, it, vi } from "vitest";
import {
  _resetCircuitsForTest,
  getModelCooldownRemainingMs,
  isModelCoolingDown,
  recordModelFailure,
} from "./circuit-breaker.js";
import {
  _resetLocalAdaptiveModelCooldownsForTest,
  _setModelCooldownPersistenceForTest,
  clearSharedPoolModelCooldown,
  persistSharedPoolModelCooldown,
  recordLocalAdaptiveModelCooldown,
  recordRepeatedProviderRetryAfterCooldown,
  readModelCooldowns,
  upstreamPoolCooldownKeyForModel,
} from "./model-cooldown-store.js";

describe("shared OpenRouter model cooldown persistence", () => {
  afterEach(() => {
    _resetCircuitsForTest();
    _resetLocalAdaptiveModelCooldownsForTest();
    _setModelCooldownPersistenceForTest(undefined);
    vi.useRealTimers();
  });

  it("uses only the provider Retry-After and expires at that exact duration", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-30T12:00:00.000Z"));
    const persisted = new Map<string, number>();
    _setModelCooldownPersistenceForTest({
      readActive: async (provider, models) => models.flatMap((model) => {
        const coolingUntil = persisted.get(`${provider}:${model}`);
        return coolingUntil && coolingUntil > Date.now()
          ? [{ model, remainingMs: coolingUntil - Date.now() }]
          : [];
      }),
      write: async (provider, model, cooldownMs) => {
        const key = `${provider}:${model}`;
        persisted.set(
          key,
          Math.max(persisted.get(key) ?? 0, Date.now() + cooldownMs),
        );
      },
      clear: async (provider, model) => {
        persisted.delete(`${provider}:${model}`);
      },
    });

    const failedModel = "fixture/shared-pool-model";
    recordModelFailure("openrouter", failedModel);
    await persistSharedPoolModelCooldown("openrouter", failedModel);
    expect(isModelCoolingDown("openrouter", failedModel)).toBe(false);
    expect(getModelCooldownRemainingMs("openrouter", failedModel)).toBeNull();
    expect(persisted.has(`openrouter:${failedModel}`)).toBe(false);

    recordModelFailure("openrouter", failedModel, 5_000);
    await persistSharedPoolModelCooldown("openrouter", failedModel, 5_000);
    expect(getModelCooldownRemainingMs("openrouter", failedModel)).toBe(5_000);
    expect(persisted.get(`openrouter:${failedModel}`)).toBe(Date.now() + 5_000);

    // A different API process has an empty in-memory cache but shares the DB.
    _resetCircuitsForTest();
    const recoveredState = await readModelCooldowns("openrouter", [
      failedModel,
      "fixture/healthy-model",
    ]);
    expect([...recoveredState.keys()]).toEqual([failedModel]);
    expect(recoveredState.get(failedModel)).toEqual({
      remainingMs: 5_000,
      source: "provider",
    });
    expect(isModelCoolingDown("openrouter", failedModel)).toBe(true);
    expect(isModelCoolingDown("openrouter", "fixture/healthy-model")).toBe(false);

    await vi.advanceTimersByTimeAsync(5_000 + 1);
    _resetCircuitsForTest();
    const expiredState = await readModelCooldowns("openrouter", [failedModel]);
    expect(expiredState.size).toBe(0);
    expect(isModelCoolingDown("openrouter", failedModel)).toBe(false);
  });

  it("clears persisted failure history after a successful model response", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-30T12:00:00.000Z"));
    const persisted = new Map<string, number>();
    _setModelCooldownPersistenceForTest({
      readActive: async (provider, models) => models.flatMap((model) => {
        const coolingUntil = persisted.get(`${provider}:${model}`);
        return coolingUntil && coolingUntil > Date.now()
          ? [{ model, remainingMs: coolingUntil - Date.now() }]
          : [];
      }),
      write: async (provider, model, cooldownMs) => {
        persisted.set(`${provider}:${model}`, Date.now() + cooldownMs);
      },
      clear: async (provider, model) => {
        persisted.delete(`${provider}:${model}`);
      },
    });

    const recoveredModel = "fixture/recovered-model";
    recordModelFailure("openrouter", recoveredModel, 30_000);
    await persistSharedPoolModelCooldown("openrouter", recoveredModel, 30_000);
    expect(persisted.has(`openrouter:${recoveredModel}`)).toBe(true);

    await clearSharedPoolModelCooldown("openrouter", recoveredModel);
    _resetCircuitsForTest();
    expect(persisted.has(`openrouter:${recoveredModel}`)).toBe(false);
    await expect(readModelCooldowns("openrouter", [recoveredModel])).resolves.toEqual(new Map());
  });

  it("fails closed when shared model cooldown state cannot be read", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    _setModelCooldownPersistenceForTest({
      readActive: async () => {
        throw new Error("fixture database unavailable");
      },
      write: async () => undefined,
      clear: async () => undefined,
    });

    try {
      await expect(readModelCooldowns("openrouter", ["fixture/model"])).rejects.toMatchObject({
        code: "MODEL_ATTEMPT_BUSY",
        providerCode: "MODEL_COOLDOWN_STORE_UNAVAILABLE",
      });
    } finally {
      warn.mockRestore();
    }
  });

  it("shares an upstream pool Retry-After only with matching model namespaces", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-30T12:00:00.000Z"));
    const persisted = new Map<string, number>();
    _setModelCooldownPersistenceForTest({
      readActive: async (provider, models) => models.flatMap((model) => {
        const coolingUntil = persisted.get(`${provider}:${model}`);
        return coolingUntil && coolingUntil > Date.now()
          ? [{ model, remainingMs: coolingUntil - Date.now() }]
          : [];
      }),
      write: async (provider, model, cooldownMs) => {
        persisted.set(`${provider}:${model}`, Date.now() + cooldownMs);
      },
      clear: async (provider, model) => {
        persisted.delete(`${provider}:${model}`);
      },
    });

    const first = "thinkingmachines/inkling:free";
    const sibling = "thinkingmachines/inkling-small:free";
    const unrelated = "liquid/lfm-2.5-2.6b:free";
    const poolKey = upstreamPoolCooldownKeyForModel(first, "Thinking Machines");
    expect(poolKey).toBeDefined();
    expect(upstreamPoolCooldownKeyForModel(unrelated, "Thinking Machines")).toBeUndefined();

    recordModelFailure("openrouter", poolKey!, 5_000);
    await persistSharedPoolModelCooldown("openrouter", poolKey!, 5_000);
    _resetCircuitsForTest();

    const recoveredState = await readModelCooldowns("openrouter", [first, sibling, unrelated]);
    expect(recoveredState.get(first)).toEqual({
      remainingMs: 5_000,
      source: "provider",
    });
    expect(recoveredState.get(sibling)).toEqual({
      remainingMs: 5_000,
      source: "provider",
    });
    expect(recoveredState.has(unrelated)).toBe(false);
    expect(recoveredState.get(poolKey!)).toEqual({
      remainingMs: 5_000,
      source: "provider",
    });

    await vi.advanceTimersByTimeAsync(5_001);
    _resetCircuitsForTest();
    expect(await readModelCooldowns("openrouter", [first, sibling, unrelated])).toEqual(new Map());
  });

  it("escalates missing-header 429s per model and leaves other free lanes available", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-31T12:00:00.000Z"));
    const persisted = new Map<string, { coolingUntil: number; updatedAt: number }>();
    _setModelCooldownPersistenceForTest({
      readActive: async (provider, models) => models.flatMap((model) => {
        const row = persisted.get(`${provider}:${model}`);
        return row && row.coolingUntil > Date.now()
          ? [{ model, remainingMs: row.coolingUntil - Date.now() }]
          : [];
      }),
      write: async (provider, model, cooldownMs) => {
        persisted.set(`${provider}:${model}`, {
          coolingUntil: Date.now() + cooldownMs,
          updatedAt: Date.now(),
        });
      },
      readRecentCooldownMs: async (provider, model, maxAgeMs) => {
        const row = persisted.get(`${provider}:${model}`);
        if (!row || Date.now() - row.updatedAt > maxAgeMs) return undefined;
        return row.coolingUntil - row.updatedAt;
      },
      clear: async (provider, model) => {
        persisted.delete(`${provider}:${model}`);
      },
    });

    const throttledModel = "liquid/lfm-2.5-2.6b:free";
    const healthyModel = "cohere/north-mini-code:free";
    expect(await recordLocalAdaptiveModelCooldown("openrouter", throttledModel)).toBe(30_000);
    let cooldowns = await readModelCooldowns("openrouter", [throttledModel, healthyModel]);
    expect(cooldowns.get(throttledModel)).toMatchObject({ source: "local_adaptive" });
    expect(cooldowns.has(healthyModel)).toBe(false);

    await vi.advanceTimersByTimeAsync(30_001);
    _resetCircuitsForTest();
    _resetLocalAdaptiveModelCooldownsForTest();
    expect(await recordLocalAdaptiveModelCooldown("openrouter", throttledModel)).toBe(60_000);
    cooldowns = await readModelCooldowns("openrouter", [throttledModel, healthyModel]);
    expect(cooldowns.get(throttledModel)).toMatchObject({ source: "local_adaptive" });
    expect(cooldowns.has(healthyModel)).toBe(false);

    let previousCooldownMs = 60_000;
    for (const expectedCooldownMs of [120_000, 240_000, 480_000, 600_000, 600_000]) {
      await vi.advanceTimersByTimeAsync(previousCooldownMs + 1);
      _resetCircuitsForTest();
      _resetLocalAdaptiveModelCooldownsForTest();
      expect(
        await recordLocalAdaptiveModelCooldown("openrouter", throttledModel),
      ).toBe(expectedCooldownMs);
      previousCooldownMs = expectedCooldownMs;
    }

    await vi.advanceTimersByTimeAsync(60 * 60_000 + 1);
    _resetCircuitsForTest();
    _resetLocalAdaptiveModelCooldownsForTest();
    expect(await recordLocalAdaptiveModelCooldown("openrouter", throttledModel)).toBe(30_000);

    await clearSharedPoolModelCooldown("openrouter", throttledModel);
    _resetCircuitsForTest();
    _resetLocalAdaptiveModelCooldownsForTest();
    expect(await readModelCooldowns("openrouter", [throttledModel, healthyModel])).toEqual(new Map());
    expect(await recordLocalAdaptiveModelCooldown("openrouter", throttledModel)).toBe(30_000);
  });

  it("escalates repeated explicit shared-pool 429s and restores the hold across processes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-02T10:00:00.000Z"));
    const persisted = new Map<string, { coolingUntil: number; updatedAt: number }>();
    _setModelCooldownPersistenceForTest({
      readActive: async (provider, models) => models.flatMap((model) => {
        const row = persisted.get(`${provider}:${model}`);
        return row && row.coolingUntil > Date.now()
          ? [{ model, remainingMs: row.coolingUntil - Date.now() }]
          : [];
      }),
      write: async (provider, model, cooldownMs) => {
        persisted.set(`${provider}:${model}`, {
          coolingUntil: Date.now() + cooldownMs,
          updatedAt: Date.now(),
        });
      },
      readRecentCooldownMs: async (provider, model, maxAgeMs) => {
        const row = persisted.get(`${provider}:${model}`);
        if (!row || Date.now() - row.updatedAt > maxAgeMs) return undefined;
        return row.coolingUntil - row.updatedAt;
      },
      clear: async (provider, model) => {
        persisted.delete(`${provider}:${model}`);
      },
    });

    const model = "thinkingmachines/inkling:free";
    const sibling = "thinkingmachines/inkling-small:free";
    const unrelated = "liquid/lfm-2.5-2.6b:free";
    const poolKey = upstreamPoolCooldownKeyForModel(model, "Thinking Machines")!;

    try {
      // The first explicit provider hint remains authoritative on its own.
      expect(await recordRepeatedProviderRetryAfterCooldown(
        "openrouter",
        poolKey,
        1_000,
      )).toBe(0);
      recordModelFailure("openrouter", poolKey, 1_000);
      await persistSharedPoolModelCooldown("openrouter", poolKey, 1_000);

      // After the provider's window expires, a second real 429 opens a local
      // hold. The history survives an API-process restart.
      await vi.advanceTimersByTimeAsync(1_001);
      _resetCircuitsForTest();
      _resetLocalAdaptiveModelCooldownsForTest();
      recordModelFailure("openrouter", poolKey, 1_000);
      await persistSharedPoolModelCooldown("openrouter", poolKey, 1_000);
      expect(await recordRepeatedProviderRetryAfterCooldown(
        "openrouter",
        poolKey,
        1_000,
      )).toBe(30_000);

      _resetCircuitsForTest();
      _resetLocalAdaptiveModelCooldownsForTest();
      let cooldowns = await readModelCooldowns("openrouter", [model, sibling, unrelated]);
      expect(cooldowns.get(model)).toMatchObject({
        remainingMs: expect.any(Number),
        source: "local_adaptive",
      });
      expect(cooldowns.get(sibling)).toMatchObject({ source: "local_adaptive" });
      expect(cooldowns.has(unrelated)).toBe(false);

      // A further rate limit after the local hold doubles it, up to the cap.
      await vi.advanceTimersByTimeAsync(30_001);
      _resetCircuitsForTest();
      _resetLocalAdaptiveModelCooldownsForTest();
      recordModelFailure("openrouter", poolKey, 1_000);
      await persistSharedPoolModelCooldown("openrouter", poolKey, 1_000);
      expect(await recordRepeatedProviderRetryAfterCooldown(
        "openrouter",
        poolKey,
        1_000,
      )).toBe(60_000);

      await clearSharedPoolModelCooldown("openrouter", poolKey);
      expect(await recordRepeatedProviderRetryAfterCooldown(
        "openrouter",
        poolKey,
        1_000,
      )).toBe(0);
    } finally {
      await clearSharedPoolModelCooldown("openrouter", poolKey);
      vi.useRealTimers();
    }
  });
});