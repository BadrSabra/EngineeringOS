import type { AgentCompleteOpts } from "@workspace/ai-orchestrator";

type ModelCooldownAdapter = NonNullable<AgentCompleteOpts["modelCooldownPersistence"]>;
type CredentialCooldownAdapter = NonNullable<AgentCompleteOpts["credentialCooldownPersistence"]>;
type LaneCursorAdapter = NonNullable<AgentCompleteOpts["modelLaneCursorPersistence"]>;

function key(...parts: string[]): string {
  return JSON.stringify(parts);
}

export function isDisposableLiveReviewDatabaseUrl(
  databaseUrl: string | undefined,
  disposableFlag: string | undefined,
): boolean {
  if (disposableFlag !== "1" || !databaseUrl?.trim()) return false;
  try {
    const parsed = new URL(databaseUrl);
    const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    const databaseName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
    const port = Number.parseInt(parsed.port, 10);
    const queryKeys = [...parsed.searchParams.keys()];
    return (
      (parsed.protocol === "postgres:" || parsed.protocol === "postgresql:") &&
      (host === "127.0.0.1" || host === "localhost" || host === "::1") &&
      Number.isInteger(port) && port > 1024 && port <= 65535 &&
      parsed.username === "runner" && parsed.password === "" &&
      queryKeys.every((name) => name === "sslmode") &&
      parsed.searchParams.getAll("sslmode").length <= 1 &&
      (!parsed.searchParams.has("sslmode") || parsed.searchParams.get("sslmode") === "disable") &&
      /^engineeringos_live_review_[a-z0-9][a-z0-9_-]{7,}$/i.test(databaseName)
    );
  } catch {
    return false;
  }
}

/**
 * Disposable provider campaigns must not read or write application cooldown
 * rows or shared free-lane cursors. These adapters keep all campaign state in
 * memory and disappear with the child process.
 */
export function createLiveProviderReviewIsolatedPersistence(): {
  modelCooldownPersistence: ModelCooldownAdapter;
  credentialCooldownPersistence: CredentialCooldownAdapter;
  modelLaneCursorPersistence: LaneCursorAdapter;
} {
  const modelCooldowns = new Map<string, number>();
  const credentialCooldowns = new Map<string, {
    coolingUntil: number;
    code: "RATE_LIMITED" | "QUOTA";
    scope: "provider_credential" | "account_quota" | "unknown";
  }>();
  const laneCursors = new Map<string, number>();

  const modelCooldownPersistence: ModelCooldownAdapter = {
    async readActive(provider, models) {
      const now = Date.now();
      const active: Array<{ model: string; remainingMs: number }> = [];
      for (const model of models) {
        const cooldownKey = key(provider, model);
        const coolingUntil = modelCooldowns.get(cooldownKey);
        if (coolingUntil === undefined) continue;
        if (coolingUntil <= now) {
          modelCooldowns.delete(cooldownKey);
          continue;
        }
        active.push({ model, remainingMs: Math.ceil(coolingUntil - now) });
      }
      return active;
    },
    async write(provider, model, cooldownMs) {
      if (!Number.isSafeInteger(cooldownMs) || cooldownMs <= 0) return;
      const cooldownKey = key(provider, model);
      const nextUntil = Date.now() + cooldownMs;
      modelCooldowns.set(
        cooldownKey,
        Math.max(modelCooldowns.get(cooldownKey) ?? 0, nextUntil),
      );
    },
    async clear(provider, model) {
      modelCooldowns.delete(key(provider, model));
    },
  };

  const credentialCooldownPersistence: CredentialCooldownAdapter = {
    async readActive(fingerprint) {
      const cooldown = credentialCooldowns.get(fingerprint);
      if (!cooldown) return null;
      const remainingMs = Math.ceil(cooldown.coolingUntil - Date.now());
      if (remainingMs <= 0) {
        credentialCooldowns.delete(fingerprint);
        return null;
      }
      return {
        remainingMs,
        code: cooldown.code,
        scope: cooldown.scope,
      };
    },
    async write(fingerprint, cooldown) {
      const previous = credentialCooldowns.get(fingerprint);
      credentialCooldowns.set(
        fingerprint,
        previous && previous.coolingUntil > cooldown.coolingUntil
          ? previous
          : cooldown,
      );
    },
  };

  const modelLaneCursorPersistence: LaneCursorAdapter = {
    async reserveSlot(cursorKey, candidateSetHash, slotCount) {
      if (!Number.isSafeInteger(slotCount) || slotCount < 1) {
        throw new Error("Invalid isolated OpenRouter lane slot count");
      }
      const cursor = key(cursorKey, candidateSetHash);
      const slot = (laneCursors.get(cursor) ?? 0) % slotCount;
      laneCursors.set(cursor, (slot + 1) % slotCount);
      return slot;
    },
  };

  return {
    modelCooldownPersistence,
    credentialCooldownPersistence,
    modelLaneCursorPersistence,
  };
}
