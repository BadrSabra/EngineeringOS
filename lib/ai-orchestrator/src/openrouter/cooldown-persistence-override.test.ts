import { describe, expect, it, vi } from "vitest";
import { GroqClientError } from "../errors.js";
import {
  _resetOpenRouterCredentialCooldownsForTest,
  _setOpenRouterCredentialCooldownPersistenceForTest,
  assertOpenRouterCredentialAvailable,
  recordOpenRouterCredentialCooldown,
  type CredentialCooldownPersistence,
} from "./credential-cooldown.js";
import {
  _setModelCooldownPersistenceForTest,
  clearSharedPoolModelCooldown,
  persistSharedPoolModelCooldown,
  readModelCooldowns,
  type ModelCooldownPersistence,
} from "./model-cooldown-store.js";

describe("isolated cooldown persistence overrides", () => {
  it("uses the provided model store instead of the shared store", async () => {
    const sharedStore: ModelCooldownPersistence = {
      readActive: vi.fn(async () => []),
      write: vi.fn(async () => {}),
      clear: vi.fn(async () => {}),
    };
    const isolatedStore: ModelCooldownPersistence = {
      readActive: vi.fn(async () => []),
      write: vi.fn(async () => {}),
      clear: vi.fn(async () => {}),
    };

    _setModelCooldownPersistenceForTest(sharedStore);
    try {
      await readModelCooldowns("openrouter", ["fixture/isolated-model"], isolatedStore);
      await persistSharedPoolModelCooldown(
        "openrouter",
        "fixture/isolated-model",
        1_000,
        isolatedStore,
      );
      await clearSharedPoolModelCooldown("openrouter", "fixture/isolated-model", isolatedStore);

      expect(isolatedStore.readActive).toHaveBeenCalledWith(
        "openrouter",
        ["fixture/isolated-model", "__upstream_pool__:fixture"],
      );
      expect(isolatedStore.write).toHaveBeenCalledWith(
        "openrouter",
        "fixture/isolated-model",
        1_000,
      );
      expect(isolatedStore.clear).toHaveBeenCalledWith(
        "openrouter",
        "fixture/isolated-model",
      );
      expect(sharedStore.readActive).not.toHaveBeenCalled();
      expect(sharedStore.write).not.toHaveBeenCalled();
      expect(sharedStore.clear).not.toHaveBeenCalled();
    } finally {
      _setModelCooldownPersistenceForTest(undefined);
    }
  });

  it("uses the provided credential store for reads and writes", async () => {
    const previousEncryptionKey = process.env.AI_CREDENTIALS_ENCRYPTION_KEY;
    process.env.AI_CREDENTIALS_ENCRYPTION_KEY = "0123456789abcdef".repeat(4);
    const credential = "fixture-isolated-cooldown-credential";
    const sharedStore: CredentialCooldownPersistence = {
      readActive: vi.fn(async () => null),
      write: vi.fn(async () => {}),
    };
    const isolatedStore: CredentialCooldownPersistence = {
      readActive: vi.fn(async () => null),
      write: vi.fn(async () => {}),
    };

    _setOpenRouterCredentialCooldownPersistenceForTest(sharedStore);
    try {
      await assertOpenRouterCredentialAvailable(credential, isolatedStore);
      await recordOpenRouterCredentialCooldown(
        credential,
        new GroqClientError("RATE_LIMITED", "fixture provider limit", {
          context: {
            rateLimitScope: "provider_credential",
            retryAfterMs: 1_000,
          },
        }),
        isolatedStore,
      );

      expect(isolatedStore.readActive).toHaveBeenCalledTimes(1);
      expect(isolatedStore.write).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          code: "RATE_LIMITED",
          scope: "provider_credential",
        }),
      );
      expect(sharedStore.readActive).not.toHaveBeenCalled();
      expect(sharedStore.write).not.toHaveBeenCalled();
    } finally {
      _resetOpenRouterCredentialCooldownsForTest();
      _setOpenRouterCredentialCooldownPersistenceForTest(undefined);
      if (previousEncryptionKey === undefined) {
        delete process.env.AI_CREDENTIALS_ENCRYPTION_KEY;
      } else {
        process.env.AI_CREDENTIALS_ENCRYPTION_KEY = previousEncryptionKey;
      }
    }
  });
});
