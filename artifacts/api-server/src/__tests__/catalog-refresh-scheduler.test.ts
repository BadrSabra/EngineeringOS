/**
 * Unit tests for the background free-model catalog refresh scheduler.
 *
 * Tests:
 *   - Immediate first refresh on scheduler start
 *   - Periodic refresh fires at each interval
 *   - stop() cancels further refreshes
 *   - Skips refresh when no key is available
 *   - Handles key-resolver / refresh errors without crashing
 *   - resolveAnyCatalogKey prefers env var over DB
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mock external dependencies before importing the module under test ─────────

vi.mock("@workspace/ai-orchestrator", () => ({
  refreshDynamicCatalog: vi.fn().mockResolvedValue(undefined),
  auditStaticCatalog:    vi.fn().mockReturnValue([]),
  FREE_MODELS:           [{ id: "meta-llama/llama-3.1-8b-instruct:free" }],
}));

vi.mock("@workspace/db", () => ({
  db:                         { select: vi.fn() },
  aiProviderCredentialsTable: { provider: "provider", encryptedApiKey: "encryptedApiKey" },
}));

vi.mock("../lib/credentials-crypto.js", () => ({
  decryptApiKey: vi.fn((v: string) => `decrypted:${v}`),
}));

vi.mock("../lib/logger.js", () => ({
  logger: {
    info:  vi.fn(),
    warn:  vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

// Import after mocks are registered.
import {
  runCatalogRefresh,
  startCatalogRefreshScheduler,
  resolveAnyCatalogKey,
  CATALOG_REFRESH_INTERVAL_MS,
} from "../lib/catalog-refresh-scheduler.js";
import { refreshDynamicCatalog, auditStaticCatalog } from "@workspace/ai-orchestrator";
import { db } from "@workspace/db";
import { decryptApiKey } from "../lib/credentials-crypto.js";
import { logger } from "../lib/logger.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

const mockRefresh = refreshDynamicCatalog as ReturnType<typeof vi.fn>;
const mockAudit   = auditStaticCatalog   as ReturnType<typeof vi.fn>;
const mockDecrypt  = decryptApiKey        as ReturnType<typeof vi.fn>;
const mockDb       = db                   as { select: ReturnType<typeof vi.fn> };

function makeDbChain(row: unknown) {
  const chain = {
    from:  vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(row ? [row] : []),
  };
  mockDb.select.mockReturnValue(chain);
  return chain;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("CATALOG_REFRESH_INTERVAL_MS", () => {
  it("is 5 minutes (300_000 ms)", () => {
    expect(CATALOG_REFRESH_INTERVAL_MS).toBe(300_000);
  });
});

describe("resolveAnyCatalogKey", () => {
  const originalEnv = process.env.OPENROUTER_API_KEY;

  afterEach(() => {
    process.env.OPENROUTER_API_KEY = originalEnv;
    vi.clearAllMocks();
  });

  it("returns env var when set and long enough", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test-key-12345";
    const key = await resolveAnyCatalogKey();
    expect(key).toBe("sk-or-test-key-12345");
    // DB should not have been queried
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it("falls through to DB when env var is absent", async () => {
    delete process.env.OPENROUTER_API_KEY;
    makeDbChain({ encryptedApiKey: "encrypted-value" });
    const key = await resolveAnyCatalogKey();
    expect(mockDecrypt).toHaveBeenCalledWith("encrypted-value");
    expect(key).toBe("decrypted:encrypted-value");
  });

  it("returns undefined when env is absent and DB has no row", async () => {
    delete process.env.OPENROUTER_API_KEY;
    makeDbChain(null);
    const key = await resolveAnyCatalogKey();
    expect(key).toBeUndefined();
  });

  it("returns undefined and logs when DB query throws", async () => {
    delete process.env.OPENROUTER_API_KEY;
    mockDb.select.mockImplementation(() => { throw new Error("DB down"); });
    const key = await resolveAnyCatalogKey();
    expect(key).toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });

  it("ignores env var shorter than 10 chars and queries DB instead", async () => {
    process.env.OPENROUTER_API_KEY = "short";
    makeDbChain(null);
    const key = await resolveAnyCatalogKey();
    // Short env var skipped → DB queried but no row → undefined
    expect(mockDb.select).toHaveBeenCalled();
    expect(key).toBeUndefined();
  });
});

describe("runCatalogRefresh", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls refreshDynamicCatalog with the resolved key and returns true", async () => {
    const getKey = vi.fn().mockResolvedValue("sk-or-test");
    const result = await runCatalogRefresh(getKey);
    expect(result).toBe(true);
    expect(mockRefresh).toHaveBeenCalledWith("sk-or-test");
    expect(mockAudit).toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalled();
  });

  it("returns false and does not call refresh when no key is available", async () => {
    const getKey = vi.fn().mockResolvedValue(undefined);
    const result = await runCatalogRefresh(getKey);
    expect(result).toBe(false);
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("returns false and logs warning when refresh throws", async () => {
    const getKey = vi.fn().mockResolvedValue("sk-or-test");
    mockRefresh.mockRejectedValueOnce(new Error("network error"));
    const result = await runCatalogRefresh(getKey);
    expect(result).toBe(false);
    expect(logger.warn).toHaveBeenCalled();
  });

  it("logs stale model IDs when audit finds them", async () => {
    const stale = ["meta-llama/llama-3.3-70b-instruct:free"];
    mockAudit.mockReturnValueOnce(stale);
    const getKey = vi.fn().mockResolvedValue("sk-or-test");
    await runCatalogRefresh(getKey);
    const infoCall = (logger.info as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => JSON.stringify(c).includes("catalog-refresh"),
    );
    expect(infoCall?.[0]).toMatchObject({ staleModelCount: 1, staleModels: stale });
  });
});

describe("startCatalogRefreshScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs an immediate first refresh on start", async () => {
    const getKey = vi.fn().mockResolvedValue("sk-or-test");
    const { stop } = startCatalogRefreshScheduler({ intervalMs: 1_000, getKey });
    // Flush the immediate async call
    await vi.runAllMicrotasksAsync();
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    stop();
  });

  it("fires again after each interval", async () => {
    const getKey = vi.fn().mockResolvedValue("sk-or-test");
    const { stop } = startCatalogRefreshScheduler({ intervalMs: 1_000, getKey });
    await vi.runAllMicrotasksAsync(); // immediate call
    expect(mockRefresh).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1_000);
    await vi.runAllMicrotasksAsync();
    expect(mockRefresh).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(1_000);
    await vi.runAllMicrotasksAsync();
    expect(mockRefresh).toHaveBeenCalledTimes(3);

    stop();
  });

  it("stop() prevents further refreshes", async () => {
    const getKey = vi.fn().mockResolvedValue("sk-or-test");
    const { stop } = startCatalogRefreshScheduler({ intervalMs: 1_000, getKey });
    await vi.runAllMicrotasksAsync(); // immediate call
    stop();

    vi.advanceTimersByTime(5_000);
    await vi.runAllMicrotasksAsync();
    // Only the initial call; no interval calls after stop
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it("logs startup and stop messages", async () => {
    const getKey = vi.fn().mockResolvedValue(undefined);
    const { stop } = startCatalogRefreshScheduler({ intervalMs: 1_000, getKey });
    await vi.runAllMicrotasksAsync();
    const startLog = (logger.info as ReturnType<typeof vi.fn>).mock.calls.find((c) =>
      JSON.stringify(c).includes("scheduler started"),
    );
    expect(startLog).toBeDefined();
    stop();
    const stopLog = (logger.info as ReturnType<typeof vi.fn>).mock.calls.find((c) =>
      JSON.stringify(c).includes("scheduler stopped"),
    );
    expect(stopLog).toBeDefined();
  });

  it("uses CATALOG_REFRESH_INTERVAL_MS as default interval", async () => {
    // Just verify the exported constant matches the expected 5-min value so
    // the default wiring in index.ts is correct.
    expect(CATALOG_REFRESH_INTERVAL_MS).toBe(5 * 60 * 1_000);
  });
});
