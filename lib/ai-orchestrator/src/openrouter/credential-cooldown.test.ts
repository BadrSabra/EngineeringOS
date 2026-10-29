import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GroqClientError } from "../errors.js";
import {
  _resetOpenRouterCredentialCooldownsForTest,
  _setOpenRouterCredentialCooldownPersistenceForTest,
  assertOpenRouterCredentialAvailable,
  recordOpenRouterCredentialCooldown,
  type CredentialCooldownPersistence,
} from "./credential-cooldown.js";

const fixtureApiKey = "fixture-openrouter-credential-for-cooldown";
const fixtureEncryptionKey = "0123456789abcdef".repeat(4);
let previousEncryptionKey: string | undefined;

beforeEach(() => {
  previousEncryptionKey = process.env.AI_CREDENTIALS_ENCRYPTION_KEY;
  process.env.AI_CREDENTIALS_ENCRYPTION_KEY = fixtureEncryptionKey;
  _resetOpenRouterCredentialCooldownsForTest();
});

afterEach(() => {
  _resetOpenRouterCredentialCooldownsForTest();
  _setOpenRouterCredentialCooldownPersistenceForTest(undefined);
  if (previousEncryptionKey === undefined) {
    delete process.env.AI_CREDENTIALS_ENCRYPTION_KEY;
  } else {
    process.env.AI_CREDENTIALS_ENCRYPTION_KEY = previousEncryptionKey;
  }
});

describe("OpenRouter credential cooldown persistence", () => {
  it.skipIf(process.env.OPENROUTER_CREDENTIAL_COOLDOWN_DB_TEST !== "1")(
    "persists the longest credential window in PostgreSQL across processes",
    async () => {
      _setOpenRouterCredentialCooldownPersistenceForTest(undefined);
      const apiKey = `${fixtureApiKey}-postgres-integration`;
      const { pool } = await import("@workspace/db");
      try {
        await recordOpenRouterCredentialCooldown(
          apiKey,
          new GroqClientError("QUOTA", "fixture account quota", {
            context: { rateLimitScope: "account_quota", retryAfterMs: 30_000 },
          }),
        );

        // Simulate another process receiving a shorter window for this key.
        _resetOpenRouterCredentialCooldownsForTest();
        await recordOpenRouterCredentialCooldown(
          apiKey,
          new GroqClientError("RATE_LIMITED", "fixture shorter limit", {
            context: { rateLimitScope: "provider_credential", retryAfterMs: 1_000 },
          }),
        );

        // A third process must still observe the original, longer quota hold.
        _resetOpenRouterCredentialCooldownsForTest();
        await expect(assertOpenRouterCredentialAvailable(apiKey)).rejects.toMatchObject({
          code: "QUOTA",
          rateLimitScope: "account_quota",
        });
      } finally {
        await pool.end();
      }
    },
  );

  it("shares an exact credential Retry-After across simulated API processes", async () => {
    let stored:
      | {
          fingerprint: string;
          coolingUntil: number;
          code: "RATE_LIMITED" | "QUOTA";
          scope: "provider_credential" | "account_quota" | "unknown";
        }
      | undefined;
    const persistence: CredentialCooldownPersistence = {
      readActive: vi.fn(async (fingerprint) => {
        if (!stored || stored.fingerprint !== fingerprint) return null;
        const remainingMs = Math.ceil(stored.coolingUntil - Date.now());
        return remainingMs > 0
          ? { remainingMs, code: stored.code, scope: stored.scope }
          : null;
      }),
      write: vi.fn(async (fingerprint, cooldown) => {
        if (!stored || cooldown.coolingUntil >= stored.coolingUntil) {
          stored = { fingerprint, ...cooldown };
        }
      }),
    };
    _setOpenRouterCredentialCooldownPersistenceForTest(persistence);

    await recordOpenRouterCredentialCooldown(
      fixtureApiKey,
      new GroqClientError("QUOTA", "fixture provider quota", {
        context: { rateLimitScope: "account_quota", retryAfterMs: 5_000 },
      }),
    );

    expect(stored).toBeDefined();
    expect(stored?.fingerprint).not.toContain(fixtureApiKey);
    expect(stored?.scope).toBe("account_quota");

    // Simulate a second API process with an empty local cache.
    _resetOpenRouterCredentialCooldownsForTest();
    await expect(assertOpenRouterCredentialAvailable(fixtureApiKey)).rejects.toMatchObject({
      code: "QUOTA",
      rateLimitScope: "account_quota",
    });
    expect(persistence.readActive).toHaveBeenCalledTimes(1);
  });

  it("keeps an exact Retry-After with unknown scope unknown", async () => {
    const persistence: CredentialCooldownPersistence = {
      readActive: vi.fn(async () => null),
      write: vi.fn(async () => undefined),
    };
    _setOpenRouterCredentialCooldownPersistenceForTest(persistence);

    await recordOpenRouterCredentialCooldown(
      fixtureApiKey,
      new GroqClientError("RATE_LIMITED", "fixture unclassified limit", {
        context: { retryAfterMs: 2_000 },
      }),
    );

    await expect(assertOpenRouterCredentialAvailable(fixtureApiKey)).rejects.toMatchObject({
      code: "RATE_LIMITED",
      rateLimitScope: "unknown",
    });
    expect(persistence.write).toHaveBeenCalledWith(
      expect.not.stringContaining(fixtureApiKey),
      expect.objectContaining({ scope: "unknown" }),
    );
  });

  it("does not invent a cooldown when the provider omits Retry-After", async () => {
    const persistence: CredentialCooldownPersistence = {
      readActive: vi.fn(async () => null),
      write: vi.fn(async () => undefined),
    };
    _setOpenRouterCredentialCooldownPersistenceForTest(persistence);

    await recordOpenRouterCredentialCooldown(
      fixtureApiKey,
      new GroqClientError("RATE_LIMITED", "fixture limit without retry window"),
    );

    await expect(assertOpenRouterCredentialAvailable(fixtureApiKey)).resolves.toBeUndefined();
    expect(persistence.write).not.toHaveBeenCalled();
  });

  it("leaves upstream shared-pool throttling to the model cooldown path", async () => {
    const persistence: CredentialCooldownPersistence = {
      readActive: vi.fn(async () => null),
      write: vi.fn(async () => undefined),
    };
    _setOpenRouterCredentialCooldownPersistenceForTest(persistence);

    await recordOpenRouterCredentialCooldown(
      fixtureApiKey,
      new GroqClientError("RATE_LIMITED", "fixture shared pool limit", {
        context: {
          rateLimitScope: "upstream_shared_pool",
          retryAfterMs: 3_000,
        },
      }),
    );

    await expect(assertOpenRouterCredentialAvailable(fixtureApiKey)).resolves.toBeUndefined();
    expect(persistence.write).not.toHaveBeenCalled();
  });
});
