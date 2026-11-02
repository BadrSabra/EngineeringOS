import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GroqClientError } from "../errors.js";
import {
  _resetOpenRouterCredentialCooldownsForTest,
  _setOpenRouterCredentialCooldownPersistenceForTest,
  assertOpenRouterCredentialAvailable,
  clearAdaptiveOpenRouterCredentialFailures,
  openRouterCredentialAttemptLaneKey,
  recordAdaptiveOpenRouterCredentialCooldown,
  recordOpenRouterCredentialCooldown,
  resolveOpenRouterCredential,
  type CredentialCooldownPersistence,
} from "./credential-cooldown.js";

const fixtureApiKey = "fixture-openrouter-credential-for-cooldown";
const fixtureEncryptionKey = "0123456789abcdef".repeat(4);
let previousEncryptionKey: string | undefined;

function createMemoryCredentialPersistence(): CredentialCooldownPersistence {
  const stored = new Map<string, {
    coolingUntil: number;
    code: "RATE_LIMITED" | "QUOTA";
    scope: "provider_credential" | "account_quota" | "unknown";
  }>();
  return {
    async readActive(fingerprint) {
      const cooldown = stored.get(fingerprint);
      if (!cooldown) return null;
      const remainingMs = Math.ceil(cooldown.coolingUntil - Date.now());
      return remainingMs > 0
        ? { remainingMs, code: cooldown.code, scope: cooldown.scope }
        : null;
    },
    async write(fingerprint, cooldown) {
      const previous = stored.get(fingerprint);
      if (!previous || cooldown.coolingUntil >= previous.coolingUntil) {
        stored.set(fingerprint, cooldown);
      }
    },
  };
}

beforeEach(() => {
  previousEncryptionKey = process.env.AI_CREDENTIALS_ENCRYPTION_KEY;
  process.env.AI_CREDENTIALS_ENCRYPTION_KEY = fixtureEncryptionKey;
  _resetOpenRouterCredentialCooldownsForTest();
  _setOpenRouterCredentialCooldownPersistenceForTest(createMemoryCredentialPersistence());
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

  it("blocks admission when the persistent credential fingerprint key is absent", async () => {
    delete process.env.AI_CREDENTIALS_ENCRYPTION_KEY;
    const persistence: CredentialCooldownPersistence = {
      readActive: vi.fn(async () => null),
      write: vi.fn(async () => undefined),
    };
    _setOpenRouterCredentialCooldownPersistenceForTest(persistence);

    await expect(assertOpenRouterCredentialAvailable(fixtureApiKey)).rejects.toMatchObject({
      code: "INVALID_CONFIG",
      providerCode: "CREDENTIAL_COOLDOWN_PERSISTENCE_UNAVAILABLE",
    });
    expect(persistence.readActive).not.toHaveBeenCalled();
  });

  it("blocks admission when shared credential cooldown state cannot be read", async () => {
    const persistence: CredentialCooldownPersistence = {
      readActive: vi.fn(async () => {
        throw new Error("fixture database unavailable");
      }),
      write: vi.fn(async () => undefined),
    };
    _setOpenRouterCredentialCooldownPersistenceForTest(persistence);

    await expect(assertOpenRouterCredentialAvailable(fixtureApiKey)).rejects.toMatchObject({
      code: "INVALID_CONFIG",
      providerCode: "CREDENTIAL_COOLDOWN_STORE_UNAVAILABLE",
    });
  });

  it("does not silently accept a process-only credential cooldown when persistence fails", async () => {
    const persistence: CredentialCooldownPersistence = {
      readActive: vi.fn(async () => null),
      write: vi.fn(async () => {
        throw new Error("fixture database unavailable");
      }),
    };

    await expect(recordOpenRouterCredentialCooldown(
      fixtureApiKey,
      new GroqClientError("RATE_LIMITED", "fixture credential limit", {
        context: {
          rateLimitScope: "provider_credential",
          retryAfterMs: 1_000,
        },
      }),
      persistence,
    )).rejects.toMatchObject({
      code: "INVALID_CONFIG",
      providerCode: "CREDENTIAL_COOLDOWN_STORE_UNAVAILABLE",
    });
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

  it("uses the configured credential consistently without exposing it in the shared lease key", async () => {
    const previousOpenRouterKey = process.env.OPENROUTER_API_KEY;
    const configuredKey = "fixture-environment-openrouter-key";
    process.env.OPENROUTER_API_KEY = configuredKey;
    const persistence: CredentialCooldownPersistence = {
      readActive: vi.fn(async () => null),
      write: vi.fn(async () => undefined),
    };
    _setOpenRouterCredentialCooldownPersistenceForTest(persistence);

    try {
      expect(resolveOpenRouterCredential(undefined)).toBe(configuredKey);
      const laneKey = openRouterCredentialAttemptLaneKey(configuredKey);
      expect(laneKey).toMatch(/^__openrouter_credential_attempt_lane__:[a-f0-9]{64}$/);
      expect(laneKey).not.toContain(configuredKey);

      await recordOpenRouterCredentialCooldown(
        undefined,
        new GroqClientError("RATE_LIMITED", "fixture environment credential limit", {
          context: { retryAfterMs: 10_000 },
        }),
      );
      await expect(assertOpenRouterCredentialAvailable(undefined)).rejects.toMatchObject({
        code: "RATE_LIMITED",
        rateLimitScope: "unknown",
      });
      expect(persistence.write).toHaveBeenCalledWith(
        expect.not.stringContaining(configuredKey),
        expect.objectContaining({ scope: "unknown" }),
      );
    } finally {
      if (previousOpenRouterKey === undefined) {
        delete process.env.OPENROUTER_API_KEY;
      } else {
        process.env.OPENROUTER_API_KEY = previousOpenRouterKey;
      }
    }
  });

  it("applies a bounded progressive credential hold for unscoped 429s without Retry-After", async () => {
    vi.useFakeTimers({ now: 0 });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const stored: Array<{ scope: string; coolingUntil: number }> = [];
    const persistence: CredentialCooldownPersistence = {
      readActive: vi.fn(async () => {
        const active = stored.at(-1);
        if (!active) return null;
        const remainingMs = active.coolingUntil - Date.now();
        return remainingMs > 0
          ? {
              remainingMs,
              code: "RATE_LIMITED" as const,
              scope: active.scope as "provider_credential" | "account_quota" | "unknown",
            }
          : null;
      }),
      write: vi.fn(async (_fingerprint, cooldown) => {
        stored.push({ scope: cooldown.scope, coolingUntil: cooldown.coolingUntil });
      }),
    };
    _setOpenRouterCredentialCooldownPersistenceForTest(persistence);

    try {
      expect(await recordAdaptiveOpenRouterCredentialCooldown(
        fixtureApiKey,
        persistence,
        "account_quota",
      )).toBe(30_000);
      await expect(assertOpenRouterCredentialAvailable(fixtureApiKey)).rejects.toMatchObject({
        code: "RATE_LIMITED",
        rateLimitScope: "account_quota",
      });

      vi.setSystemTime(30_001);
      expect(await recordAdaptiveOpenRouterCredentialCooldown(
        fixtureApiKey,
        persistence,
        "account_quota",
      )).toBe(60_000);

      clearAdaptiveOpenRouterCredentialFailures(fixtureApiKey);
      vi.setSystemTime(90_002);
      expect(await recordAdaptiveOpenRouterCredentialCooldown(
        fixtureApiKey,
        persistence,
        "account_quota",
      )).toBe(30_000);
      expect(stored.map((entry) => entry.scope)).toEqual([
        "account_quota",
        "account_quota",
        "account_quota",
      ]);
    } finally {
      warn.mockRestore();
      vi.useRealTimers();
    }
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
