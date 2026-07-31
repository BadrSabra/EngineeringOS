import type { AgentContext as ProjectContext } from "./schemas/context.schema.js";

const CONTEXT_CACHE_TTL_MS = 30_000;
const contextCache = new Map<string, { data: ProjectContext; expiresAt: number }>();

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

export function buildContextCacheKey(projectId: string, sections?: readonly string[]): string {
  const normalized = [...new Set(sections && sections.length > 0 ? sections : [])].sort();
  return `${projectId}::${normalized.join(",")}`;
}

export function getCachedContext(cacheKey: string): { data: ProjectContext; expiresAt: number } | undefined {
  return contextCache.get(cacheKey);
}

export function setCachedContext(cacheKey: string, data: ProjectContext): void {
  contextCache.set(cacheKey, { data, expiresAt: Date.now() + CONTEXT_CACHE_TTL_MS });
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
