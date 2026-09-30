import { afterEach, describe, expect, it, vi } from "vitest";
import {
  _resetCircuitsForTest,
  isModelCoolingDown,
  recordModelFailure,
} from "./circuit-breaker.js";
import {
  _setModelCooldownPersistenceForTest,
  persistSharedPoolModelCooldown,
  readModelCooldowns,
} from "./model-cooldown-store.js";

describe("shared OpenRouter model cooldown persistence", () => {
  afterEach(() => {
    _resetCircuitsForTest();
    _setModelCooldownPersistenceForTest(undefined);
    vi.useRealTimers();
  });

  it("is visible after process-local state is cleared and expires after 90 seconds", async () => {
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
    });

    const failedModel = "fixture/shared-pool-model";
    recordModelFailure("openrouter", failedModel);
    await persistSharedPoolModelCooldown("openrouter", failedModel);
    expect(persisted.get(`openrouter:${failedModel}`)).toBe(Date.now() + 90_000);

    // A different API process has an empty in-memory cache but shares the DB.
    _resetCircuitsForTest();
    const recoveredState = await readModelCooldowns("openrouter", [
      failedModel,
      "fixture/healthy-model",
    ]);
    expect([...recoveredState.keys()]).toEqual([failedModel]);
    expect(recoveredState.get(failedModel)).toBe(90_000);
    expect(isModelCoolingDown("openrouter", failedModel)).toBe(true);
    expect(isModelCoolingDown("openrouter", "fixture/healthy-model")).toBe(false);

    await vi.advanceTimersByTimeAsync(90_001);
    _resetCircuitsForTest();
    const expiredState = await readModelCooldowns("openrouter", [failedModel]);
    expect(expiredState.size).toBe(0);
    expect(isModelCoolingDown("openrouter", failedModel)).toBe(false);
  });
});