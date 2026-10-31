import { describe, expect, it } from "vitest";
import {
  createLiveProviderReviewIsolatedPersistence,
  isDisposableLiveReviewDatabaseUrl,
} from "./live-provider-review-isolated-persistence.js";

describe("isolated live review persistence", () => {
  it("accepts only explicitly marked loopback databases with unique campaign names", () => {
    const target = "postgresql://runner@127.0.0.1:55432/engineeringos_live_review_20261031_a1b2c3d4";

    expect(isDisposableLiveReviewDatabaseUrl(target, "1")).toBe(true);
    expect(isDisposableLiveReviewDatabaseUrl(target, undefined)).toBe(false);
    expect(isDisposableLiveReviewDatabaseUrl(
      "postgresql://runner@db.example.test:55432/engineeringos_live_review_20261031_a1b2c3d4",
      "1",
    )).toBe(false);
    expect(isDisposableLiveReviewDatabaseUrl(
      "postgresql://runner@127.0.0.1:55432/engineeringos_dev",
      "1",
    )).toBe(false);
    expect(isDisposableLiveReviewDatabaseUrl(
      "postgresql://runner@127.0.0.1:55432/engineeringos_live_review_short",
      "1",
    )).toBe(false);
    expect(isDisposableLiveReviewDatabaseUrl(
      "postgresql://runner@127.0.0.1:55432/engineeringos_live_review_20261031_a1b2c3d4?host=db.example.test",
      "1",
    )).toBe(false);
    expect(isDisposableLiveReviewDatabaseUrl(
      "postgresql://runner@127.0.0.1/engineeringos_live_review_20261031_a1b2c3d4",
      "1",
    )).toBe(false);
  });

  it("keeps model and credential cooldowns local to one campaign instance", async () => {
    const firstRun = createLiveProviderReviewIsolatedPersistence();
    await firstRun.modelCooldownPersistence.write("openrouter", "fixture/model:free", 5_000);
    await firstRun.credentialCooldownPersistence.write("fixture-fingerprint", {
      coolingUntil: Date.now() + 5_000,
      code: "RATE_LIMITED",
      scope: "unknown",
    });

    const modelCooldowns = await firstRun.modelCooldownPersistence.readActive(
      "openrouter",
      ["fixture/model:free"],
    );
    const credentialCooldown = await firstRun.credentialCooldownPersistence.readActive(
      "fixture-fingerprint",
    );

    expect(modelCooldowns).toHaveLength(1);
    expect(modelCooldowns[0]?.remainingMs).toBeGreaterThan(0);
    expect(credentialCooldown).toMatchObject({
      code: "RATE_LIMITED",
      scope: "unknown",
    });
    expect(credentialCooldown?.remainingMs).toBeGreaterThan(0);
    expect(
      await createLiveProviderReviewIsolatedPersistence()
        .modelCooldownPersistence.readActive("openrouter", ["fixture/model:free"]),
    ).toEqual([]);
  });

  it("clears exact model cooldowns and rotates only its in-memory lane cursor", async () => {
    const isolated = createLiveProviderReviewIsolatedPersistence();
    await isolated.modelCooldownPersistence.write("openrouter", "fixture/model:free", 5_000);
    await isolated.modelCooldownPersistence.clear("openrouter", "fixture/model:free");

    expect(
      await isolated.modelCooldownPersistence.readActive("openrouter", ["fixture/model:free"]),
    ).toEqual([]);
    await expect(
      isolated.modelLaneCursorPersistence.reserveSlot("scope", "two-models", 2),
    ).resolves.toBe(0);
    await expect(
      isolated.modelLaneCursorPersistence.reserveSlot("scope", "two-models", 2),
    ).resolves.toBe(1);
    await expect(
      isolated.modelLaneCursorPersistence.reserveSlot("scope", "two-models", 2),
    ).resolves.toBe(0);
  });
});
