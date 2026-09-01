import { createHash } from "node:crypto";
import {
  validateGroqDefaultModels,
  type GroqDefaultModelValidation,
} from "./groq-client.js";
import {
  validateGeminiDefaultModels,
  type GeminiDefaultModelValidation,
} from "./openai-compatible-client.js";
import {
  getDynamicCatalogStatus,
  getUsableDynamicModelIds,
  refreshDynamicCatalog,
} from "./openrouter/dynamic-catalog.js";
import {
  loadProvider,
  type ProviderId,
} from "./provider-registry.js";
import { validateDeepSeekDefaultModels, type DeepSeekDefaultModelValidation } from "./deepseek-client.js";
import { GroqClientError } from "./errors.js";

export type CredentialSource = "server" | "user";
export type LifecycleModelRole = "fast" | "powerful";
export type LifecycleCapability = "tools" | "json" | "streaming";

export type ProviderLifecycleReasonCode =
  | "credentials_missing"
  | "credentials_invalid"
  | "credential_check_failed"
  | "model_not_checked"
  | "model_healthy"
  | "model_missing"
  | "model_partial"
  | "catalog_temporarily_unavailable"
  | "capability_not_checked"
  | "capability_mismatch"
  | "circuit_open"
  | "runtime_model_not_found"
  | "runtime_auth_failed"
  | "runtime_transient_failure";

export type LifecycleRoleState = {
  role: LifecycleModelRole;
  modelId: string;
  status: "healthy" | "missing" | "not_checked";
  checkedAt: string | null;
};

export type LifecycleCapabilityState = {
  name: LifecycleCapability;
  supported: boolean | null;
  evidence: "registry" | "catalog" | "probe" | "none";
  checkedAt: string | null;
};

export type ProviderLifecycleSnapshot = {
  provider: ProviderId;
  source: CredentialSource | "none";
  /** SHA-256 identity of the credential, never the credential itself. */
  keyIdentity: string | null;
  revision: number;
  generation: number;
  checkedAt: string | null;
  expiresAt: string | null;
  lastKnownGoodAt: string | null;
  lastKnownGoodExpiresAt: string | null;
  credentialStatus:
    | "credentials_missing"
    | "credentials_invalid"
    | "credentials_valid"
    | "credentials_unchecked";
  modelStatus:
    | "model_not_checked"
    | "model_healthy"
    | "model_partial"
    | "model_missing"
    | "catalog_temporarily_unavailable";
  capabilityStatus:
    | "capability_not_checked"
    | "capability_healthy"
    | "capability_mismatch";
  overallStatus: "unconfigured" | "unavailable" | "ready" | "degraded";
  selectable: boolean;
  roles: LifecycleRoleState[];
  capabilities: LifecycleCapabilityState[];
  reasonCodes: ProviderLifecycleReasonCode[];
};

export type ProviderLifecycleRequirements = {
  requireTools?: boolean;
  requireJson?: boolean;
  requireStreaming?: boolean;
};

export type ProviderLifecycleOptions = {
  provider: ProviderId;
  apiKey?: string;
  source?: CredentialSource;
  requirements?: ProviderLifecycleRequirements;
  /** Refresh the provider catalog/check. Metrics should leave this false. */
  check?: boolean;
};

type CacheEntry = {
  snapshot: ProviderLifecycleSnapshot;
  generation: number;
  lastKnownGood?: ProviderLifecycleSnapshot;
  inFlight?: Promise<ProviderLifecycleSnapshot>;
};

const CACHE_TTL_MS = 5 * 60_000;
const LKG_TTL_MS = 15 * 60_000;
const cache = new Map<string, CacheEntry>();
const revisions = new Map<string, number>();

function fingerprint(apiKey?: string): string | null {
  return apiKey
    ? createHash("sha256").update(apiKey, "utf8").digest("hex").slice(0, 32)
    : null;
}

function cacheKey(provider: ProviderId, source: CredentialSource | "none", keyIdentity: string | null): string {
  return `${provider}:${source}:${keyIdentity ?? "none"}`;
}

function nextRevision(key: string): number {
  const revision = (revisions.get(key) ?? 0) + 1;
  revisions.set(key, revision);
  return revision;
}

function capabilities(
  provider: ProviderId,
  checkedAt: string | null,
  requirements: ProviderLifecycleRequirements,
): { status: ProviderLifecycleSnapshot["capabilityStatus"]; states: LifecycleCapabilityState[]; reasons: ProviderLifecycleReasonCode[] } {
  const config = loadProvider(provider);
  const checks: Array<[LifecycleCapability, boolean]> = [
    ["tools", config.supportsTools],
    ["json", config.supportsJsonMode],
    ["streaming", config.supportsStreaming],
  ];
  const states = checks.map(([name, supported]) => ({
    name,
    supported,
    evidence: "registry" as const,
    checkedAt,
  }));
  const required: LifecycleCapability[] = [];
  if (requirements.requireTools) required.push("tools");
  if (requirements.requireJson) required.push("json");
  if (requirements.requireStreaming) required.push("streaming");
  const mismatch = required.some((name) => !states.find((state) => state.name === name)?.supported);
  return {
    status: mismatch ? "capability_mismatch" : "capability_healthy",
    states,
    reasons: mismatch ? ["capability_mismatch"] : [],
  };
}

function baseSnapshot(
  provider: ProviderId,
  source: CredentialSource | "none",
  keyIdentity: string | null,
  generation: number,
  requirements: ProviderLifecycleRequirements,
): ProviderLifecycleSnapshot {
  const checkedAt = new Date().toISOString();
  const capability = capabilities(provider, checkedAt, requirements);
  const config = loadProvider(provider);
  return {
    provider,
    source,
    keyIdentity,
    revision: 0,
    generation,
    checkedAt,
    expiresAt: null,
    lastKnownGoodAt: null,
    lastKnownGoodExpiresAt: null,
    credentialStatus: source === "none" ? "credentials_missing" : "credentials_unchecked",
    modelStatus: "model_not_checked",
    capabilityStatus: capability.status,
    overallStatus: source === "none" ? "unconfigured" : "unavailable",
    selectable: false,
    roles: (["fast", "powerful"] as const).map((role) => ({
      role,
      modelId: config.defaultModels[role],
      status: "not_checked" as const,
      checkedAt: null,
    })),
    capabilities: capability.states,
    reasonCodes: [
      ...(source === "none" ? ["credentials_missing" as const] : ["model_not_checked" as const]),
      ...capability.reasons,
    ],
  };
}

function modelResult(
  provider: ProviderId,
  validation: GroqDefaultModelValidation | GeminiDefaultModelValidation | DeepSeekDefaultModelValidation,
  checkedAt: string,
): Pick<ProviderLifecycleSnapshot, "modelStatus" | "roles" | "reasonCodes"> {
  const config = loadProvider(provider);
  const missing = validation.missing;
  const modelStatus =
    missing.length === 0 ? "model_healthy" :
      missing.length === 1 ? "model_partial" : "model_missing";
  return {
    modelStatus,
    roles: (["fast", "powerful"] as const).map((role) => ({
      role,
      modelId: config.defaultModels[role],
      status: missing.includes(role) ? "missing" as const : "healthy" as const,
      checkedAt,
    })),
    reasonCodes: [
      modelStatus === "model_healthy" ? "model_healthy" :
        modelStatus === "model_partial" ? "model_partial" : "model_missing",
    ],
  };
}

function completedSnapshot(
  input: ProviderLifecycleSnapshot,
  patch: Partial<ProviderLifecycleSnapshot>,
): ProviderLifecycleSnapshot {
  const snapshot = { ...input, ...patch };
  const canSelect =
    snapshot.credentialStatus === "credentials_valid" &&
    snapshot.modelStatus === "model_healthy" &&
    snapshot.capabilityStatus !== "capability_mismatch";
  return {
    ...snapshot,
    selectable: patch.selectable ?? canSelect,
    overallStatus: patch.overallStatus ?? (
      canSelect
        ? snapshot.modelStatus === "model_healthy" && snapshot.capabilityStatus === "capability_healthy"
          ? "ready"
          : "degraded"
        : snapshot.source === "none"
          ? "unconfigured"
          : "unavailable"
    ),
  };
}

function safeTransientReason(error: unknown): ProviderLifecycleReasonCode {
  if (error instanceof GroqClientError && error.code === "AUTH_ERROR") return "credentials_invalid";
  return "catalog_temporarily_unavailable";
}

async function checkProvider(
  provider: ProviderId,
  apiKey: string,
  source: CredentialSource,
  generation: number,
  requirements: ProviderLifecycleRequirements,
  previous?: ProviderLifecycleSnapshot,
): Promise<ProviderLifecycleSnapshot> {
  const keyIdentity = fingerprint(apiKey)!;
  const key = cacheKey(provider, source, keyIdentity);
  const checkedAt = new Date().toISOString();
  const base = baseSnapshot(provider, source, keyIdentity, generation, requirements);
  let model: Pick<ProviderLifecycleSnapshot, "modelStatus" | "roles" | "reasonCodes">;
  let credentialStatus: ProviderLifecycleSnapshot["credentialStatus"] = "credentials_valid";

  try {
    if (provider === "openrouter") {
      await refreshDynamicCatalog(apiKey);
      const ids = getUsableDynamicModelIds();
      if (!ids || ids.size === 0) {
        throw new GroqClientError("SERVER_ERROR", "catalog unavailable");
      }
      const config = loadProvider(provider);
      const missing = (["fast", "powerful"] as const).filter(
        (role) => !ids.has(config.defaultModels[role]),
      );
      const modelStatus =
        missing.length === 0 ? "model_healthy" :
          missing.length === 1 ? "model_partial" : "model_missing";
      model = {
        modelStatus,
        roles: (["fast", "powerful"] as const).map((role) => ({
          role,
          modelId: config.defaultModels[role],
          status: missing.includes(role) ? "missing" as const : "healthy" as const,
          checkedAt,
        })),
        reasonCodes: [modelStatus === "model_healthy" ? "model_healthy" : modelStatus],
      };
    } else {
      const validation =
        provider === "groq"
          ? await validateGroqDefaultModels(apiKey, loadProvider(provider).defaultModels)
          : provider === "gemini"
            ? await validateGeminiDefaultModels(apiKey, loadProvider(provider).defaultModels)
            : await validateDeepSeekDefaultModels(apiKey, loadProvider(provider).defaultModels);
      model = modelResult(provider, validation, checkedAt);
    }
  } catch (error) {
    const reason = safeTransientReason(error);
    if (reason === "credentials_invalid") {
      credentialStatus = "credentials_invalid";
      model = {
        modelStatus: "model_not_checked",
        roles: base.roles,
        reasonCodes: ["credentials_invalid", "model_not_checked"],
      };
    } else if (previous?.credentialStatus === "credentials_valid" && previous.selectable) {
      const lkg = completedSnapshot(previous, {
        generation,
        revision: nextRevision(key),
        checkedAt,
        expiresAt: new Date(Date.now() + CACHE_TTL_MS).toISOString(),
        lastKnownGoodAt: previous.lastKnownGoodAt ?? previous.checkedAt,
        lastKnownGoodExpiresAt: new Date(Date.now() + LKG_TTL_MS).toISOString(),
        overallStatus: "degraded",
        reasonCodes: ["catalog_temporarily_unavailable"],
      });
      return lkg;
    } else {
      model = {
        modelStatus: "catalog_temporarily_unavailable",
        roles: base.roles,
        reasonCodes: ["catalog_temporarily_unavailable"],
      };
    }
  }

  const cap = capabilities(provider, checkedAt, requirements);
  const snapshot = completedSnapshot(base, {
    revision: nextRevision(key),
    checkedAt,
    expiresAt: new Date(Date.now() + CACHE_TTL_MS).toISOString(),
    credentialStatus,
    ...model,
    capabilityStatus: cap.status,
    capabilities: cap.states,
    reasonCodes: [...new Set([...model.reasonCodes, ...cap.reasons])],
  });
  if (snapshot.selectable && snapshot.modelStatus === "model_healthy") {
    snapshot.lastKnownGoodAt = checkedAt;
    snapshot.lastKnownGoodExpiresAt = new Date(Date.now() + LKG_TTL_MS).toISOString();
  }
  return snapshot;
}

export async function getProviderLifecycleSnapshot(
  options: ProviderLifecycleOptions,
): Promise<ProviderLifecycleSnapshot> {
  const source = options.apiKey ? options.source ?? "user" : "none";
  const keyIdentity = fingerprint(options.apiKey);
  const key = cacheKey(options.provider, source, keyIdentity);
  const requirements = options.requirements ?? {};
  const existing = cache.get(key);
  if (!options.apiKey) {
    return completedSnapshot(baseSnapshot(options.provider, source, keyIdentity, existing?.generation ?? 0, requirements), {
      revision: existing?.snapshot.revision ?? 0,
    });
  }
  const keySource: CredentialSource = options.source ?? "user";
  const scopedKey = cacheKey(options.provider, keySource, keyIdentity);
  if (!options.check && existing?.snapshot) return existing.snapshot;
  if (!options.check && !existing) {
    const unverified = baseSnapshot(options.provider, keySource, keyIdentity, 0, requirements);
    return {
      ...unverified,
      overallStatus: unverified.capabilityStatus === "capability_mismatch" ? "unavailable" : "degraded",
      selectable: unverified.capabilityStatus !== "capability_mismatch",
      reasonCodes: [
        "model_not_checked",
        ...(unverified.capabilityStatus === "capability_mismatch" ? ["capability_mismatch" as const] : []),
      ],
    };
  }
  if (options.check && existing?.snapshot.expiresAt && Date.parse(existing.snapshot.expiresAt) > Date.now()) {
    return existing.snapshot;
  }
  if (existing?.inFlight) return existing.inFlight;

  const generation = existing?.generation ?? 0;
  const promise = checkProvider(
    options.provider,
    options.apiKey,
    keySource,
    generation,
    requirements,
    existing?.lastKnownGood ?? existing?.snapshot,
  ).then((snapshot) => {
    const current = cache.get(scopedKey);
    if (current && current.generation !== generation) return current.snapshot;
    cache.set(scopedKey, {
      snapshot,
      generation,
      lastKnownGood: snapshot.selectable ? snapshot : current?.lastKnownGood,
    });
    return snapshot;
  }).finally(() => {
    const current = cache.get(scopedKey);
    if (current) delete current.inFlight;
  });
  cache.set(scopedKey, { snapshot: existing?.snapshot ?? baseSnapshot(options.provider, keySource, keyIdentity, generation, requirements), generation, lastKnownGood: existing?.lastKnownGood, inFlight: promise });
  return promise;
}

export function invalidateProviderLifecycle(
  provider: ProviderId,
  source?: CredentialSource,
  apiKey?: string,
): void {
  const identity = fingerprint(apiKey);
  for (const key of [...cache.keys()]) {
    const [keyProvider, keySource, keyIdentity] = key.split(":");
    if (
      keyProvider === provider &&
      (source === undefined || keySource === source) &&
      (apiKey === undefined || keyIdentity === identity)
    ) {
      const entry = cache.get(key);
      const expiredSnapshot = entry?.snapshot
        ? { ...entry.snapshot, expiresAt: new Date(0).toISOString() }
        : undefined;
      cache.set(key, {
        snapshot: expiredSnapshot ?? baseSnapshot(provider, keySource as CredentialSource, keyIdentity === "none" ? null : keyIdentity, (entry?.generation ?? 0) + 1, {}),
        generation: (entry?.generation ?? 0) + 1,
        lastKnownGood: undefined,
      });
    }
  }
}

export function recordProviderLifecycleOutcome(input: {
  provider: ProviderId;
  source: CredentialSource;
  apiKey: string;
  model?: string;
  code: "MODEL_NOT_FOUND" | "AUTH_ERROR" | "TIMEOUT" | "SERVER_ERROR" | "RATE_LIMITED";
}): void {
  const key = cacheKey(input.provider, input.source, fingerprint(input.apiKey));
  const entry = cache.get(key);
  if (!entry) return;
  const reason: ProviderLifecycleReasonCode =
    input.code === "MODEL_NOT_FOUND" ? "runtime_model_not_found" :
      input.code === "AUTH_ERROR" ? "runtime_auth_failed" : "runtime_transient_failure";
  const modelMissing = input.code === "MODEL_NOT_FOUND" || input.code === "AUTH_ERROR";
  const snapshot = entry.snapshot;
  const roles = input.model
    ? snapshot.roles.map((role) => role.modelId === input.model && modelMissing ? { ...role, status: "missing" as const } : role)
    : snapshot.roles;
  cache.set(key, {
    ...entry,
    snapshot: completedSnapshot(snapshot, {
      revision: nextRevision(key),
      roles,
      modelStatus: modelMissing ? "model_missing" : snapshot.modelStatus,
      credentialStatus: input.code === "AUTH_ERROR" ? "credentials_invalid" : snapshot.credentialStatus,
      overallStatus: "unavailable",
      selectable: false,
      reasonCodes: [...new Set([...snapshot.reasonCodes, reason])],
    }),
    lastKnownGood: modelMissing ? entry.lastKnownGood : entry.lastKnownGood,
  });
}

export function _resetProviderLifecycleForTest(): void {
  cache.clear();
  revisions.clear();
}

export function getProviderLifecycleCacheStatus(provider: ProviderId): {
  provider: ProviderId;
  entries: number;
  catalog: ReturnType<typeof getDynamicCatalogStatus>;
} {
  return {
    provider,
    entries: [...cache.keys()].filter((key) => key.startsWith(`${provider}:`)).length,
    catalog: getDynamicCatalogStatus(),
  };
}