import type { AgentContext as ProjectContext } from "./schemas/context.schema.js";
import type { ExecutionPlan } from "./model-selection/execution-plan.js";
import type { CacheMode } from "./model-selection/execution-plan.js";
import type { SliceId } from "./context-runtime/context-object.js";
import type { ContextObject } from "./context-runtime/context-object.js";

const CONTEXT_CACHE_TTL_MS = 30_000;
export type ContextCacheRuntime = {
  /** Unassembled slices retained so age policy can run on cache hits. */
  contextObject: ContextObject;
  /** Context strings before admission decisions are applied. */
  baseContext: ProjectContext;
};

export type CachedContext = {
  data: ProjectContext;
  expiresAt: number;
  runtime?: ContextCacheRuntime;
};

const contextCache = new Map<string, CachedContext>();

let _invalidationNotifier: ((projectId: string) => void) | null = null;

export type NotifyPoolClient = {
  query(sql: string, params?: unknown[]): Promise<unknown>;
  on(event: "notification", listener: (msg: { channel: string; payload?: string }) => void): NotifyPoolClient;
  on(event: "error", listener: (err: Error) => void): NotifyPoolClient;
  on(event: "end", listener: () => void): NotifyPoolClient;
  release(): void;
  removeAllListeners(): NotifyPoolClient;
};

export type NotifyPool = {
  connect(): Promise<NotifyPoolClient>;
};

/**
 * Derive a short, stable hash from the budget-relevant fields of an ExecutionPlan.
 * Used as the third segment of the cache key so plan changes bust the cache.
 */
export function hashExecutionPlan(
  plan: Pick<ExecutionPlan, "contextBudget" | "graphBudget"> & {
    contextIntensity?: string;
    graphMode?: string;
    cacheMode?: CacheMode;
  },
): string {
  return [
    plan.contextIntensity ?? "?",
    plan.graphMode        ?? "?",
    plan.contextBudget,
    plan.graphBudget,
    plan.cacheMode ?? "?",
  ].join(":");
}

export function buildContextCacheKey(
  projectId: string,
  sections?: readonly string[],
  planHash?: string,
): string {
  const normalized = [...new Set(sections && sections.length > 0 ? sections : [])].sort();
  const base = `${projectId}::${normalized.join(",")}`;
  return planHash ? `${base}::plan:${planHash}` : base;
}

/** Maps each SliceId to the section name(s) stored in the cache key segments. */
const SLICE_TO_SECTIONS: Record<SliceId, string[]> = {
  project:       [],   // always present → full invalidation
  recentTasks:   ["tasks"],
  latestMetrics: ["metrics"],
  graphSummary:  ["graphEntities", "graphRelationships"],
  recentEvents:  ["events"],
  workflows:     ["workflows"],
};

/**
 * Selectively invalidate cache entries that include a specific slice.
 * Avoids a full project cache bust when only one domain changes.
 * Falls back to full invalidation for the "project" slice.
 */
export function invalidateContextSlice(projectId: string, sliceId: SliceId): void {
  const targetSections = SLICE_TO_SECTIONS[sliceId];
  if (targetSections.length === 0) {
    // "project" appears in every entry → full bust
    invalidateContextCache(projectId);
    return;
  }
  const prefix = `${projectId}::`;
  for (const key of contextCache.keys()) {
    if (!key.startsWith(prefix)) continue;
    const segments = key.slice(prefix.length).split("::");
    const sectionPart = segments[0] ?? "";
    const sections = sectionPart.split(",");
    if (targetSections.some((s) => sections.includes(s))) {
      contextCache.delete(key);
    }
  }
}

export function getCachedContext(
  cacheKey: string,
  cacheMode: CacheMode = "normal",
): CachedContext | undefined {
  if (cacheMode === "bypass") return undefined;
  return contextCache.get(cacheKey);
}

export function setCachedContext(
  cacheKey: string,
  data: ProjectContext,
  cacheMode: CacheMode = "normal",
  runtime?: ContextCacheRuntime,
): void {
  if (cacheMode === "bypass") return;
  const ttl = cacheMode === "aggressive"
    ? CONTEXT_CACHE_TTL_MS * 4
    : CONTEXT_CACHE_TTL_MS;
  contextCache.set(cacheKey, { data, expiresAt: Date.now() + ttl, runtime });
}

export function setInvalidationNotifier(fn: (projectId: string) => void): void {
  _invalidationNotifier = fn;
}

/**
 * Invalidate the cached context for a project immediately.
 * Call after any write that changes context-relevant data — e.g. applying AI
 * file changes, completing a scan, or updating a task.
 */
export function invalidateContextCache(projectId: string): void {
  for (const key of contextCache.keys()) {
    if (key.startsWith(`${projectId}::`)) {
      contextCache.delete(key);
    }
  }
  if (_invalidationNotifier) {
    try {
      _invalidationNotifier(projectId);
    } catch {
      /* swallowed — degrades to TTL */
    }
  }
}

/**
 * Start a dedicated PostgreSQL LISTEN connection for cross-process cache
 * invalidation.
 */
export function startContextInvalidationChannel(pool: NotifyPool): { stop: () => void } {
  let client: NotifyPoolClient | null = null;
  let stopped = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  async function connect(): Promise<void> {
    if (stopped) return;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    let acquired: NotifyPoolClient | null = null;
    try {
      acquired = await pool.connect();
      await acquired.query("LISTEN ctx_invalid");

      client = acquired;
      acquired = null;

      client.on("notification", (msg) => {
        if (msg.channel === "ctx_invalid" && msg.payload) {
          const prefix = `${msg.payload}::`;
          for (const key of contextCache.keys()) {
            if (key.startsWith(prefix)) {
              contextCache.delete(key);
            }
          }
        }
      });

      client.on("error", (err) => {
        console.warn(JSON.stringify({ scope: "ctx-cache-channel", code: "LISTEN_ERROR", error: String(err) }));
        disconnect();
      });

      client.on("end", () => {
        if (!stopped) {
          console.warn(JSON.stringify({ scope: "ctx-cache-channel", code: "LISTEN_ENDED" }));
          disconnect();
        }
      });

      console.info(JSON.stringify({ scope: "ctx-cache-channel", code: "LISTEN_READY", channel: "ctx_invalid" }));
    } catch (err) {
      if (acquired) {
        try { acquired.removeAllListeners(); } catch { /* ignore */ }
        try { acquired.release(); } catch { /* ignore */ }
      }
      console.warn(JSON.stringify({ scope: "ctx-cache-channel", code: "CONNECT_FAILED", error: String(err) }));
      scheduleReconnect();
    }
  }

  function releaseClient(): void {
    if (client) {
      client.removeAllListeners();
      client.release();
      client = null;
    }
  }

  function scheduleReconnect(): void {
    if (stopped) return;
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connect();
    }, 5_000);
  }

  function disconnect(): void {
    releaseClient();
    scheduleReconnect();
  }

  void connect();

  return {
    stop(): void {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      releaseClient();
    },
  };
}
