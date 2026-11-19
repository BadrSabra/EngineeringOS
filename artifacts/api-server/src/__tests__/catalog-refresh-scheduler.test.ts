/**
 * Unit tests for the background free-model catalog refresh scheduler.
 *
 * Tests:
 *   - Immediate first refresh on scheduler start
 *   - Periodic refresh fires at each interval
 *   - stop() cancels further refreshes
 *   - Refresh is anonymous even when a server key is configured
 *   - Handles refresh errors without crashing
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@workspace/ai-orchestrator", () => ({
  refreshDynamicCatalog: vi.fn().mockResolvedValue(undefined),
  auditStaticCatalog: vi.fn().mockReturnValue([]),
  FREE_MODELS: [{ id: "meta-llama/llama-3.1-8b-instruct:free" }],
  isProviderEgressDisabled: vi.fn(() => false),
}));

vi.mock("../lib/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  runCatalogRefresh,
  startCatalogRefreshScheduler,
  CATALOG_REFRESH_INTERVAL_MS,
} from "../lib/catalog-refresh-scheduler.js";
import { refreshDynamicCatalog, auditStaticCatalog } from "@workspace/ai-orchestrator";
import { logger } from "../lib/logger.js";

const mockRefresh = refreshDynamicCatalog as ReturnType<typeof vi.fn>;
const mockAudit = auditStaticCatalog as ReturnType<typeof vi.fn>;

describe("CATALOG_REFRESH_INTERVAL_MS", () => {
  it("is 5 minutes (300_000 ms)", () => {
    expect(CATALOG_REFRESH_INTERVAL_MS).toBe(300_000);
  });
});

describe("runCatalogRefresh", () => {
  const originalOpenRouterKey = process.env.OPENROUTER_API_KEY;

  beforeEach(() => vi.clearAllMocks());

  afterEach(() => {
    if (originalOpenRouterKey === undefined) {
      delete process.env.OPENROUTER_API_KEY;
    } else {
      process.env.OPENROUTER_API_KEY = originalOpenRouterKey;
    }
  });

  it("refreshes the public catalog anonymously even when a server key is configured", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-server-test-key";
    const result = await runCatalogRefresh();

    expect(result).toBe(true);
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect(mockRefresh).toHaveBeenCalledWith();
    expect(mockAudit).toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalled();
  });

  it("refreshes anonymously when no server key is configured", async () => {
    delete process.env.OPENROUTER_API_KEY;
    const result = await runCatalogRefresh();

    expect(result).toBe(true);
    expect(mockRefresh).toHaveBeenCalledWith();
    expect(mockAudit).toHaveBeenCalled();
  });

  it("returns false and logs warning when refresh throws", async () => {
    mockRefresh.mockRejectedValueOnce(new Error("network error"));
    const result = await runCatalogRefresh();

    expect(result).toBe(false);
    expect(logger.warn).toHaveBeenCalled();
  });

  it("logs stale model IDs when audit finds them", async () => {
    const stale = ["meta-llama/llama-3.3-70b-instruct:free"];
    mockAudit.mockReturnValueOnce(stale);
    await runCatalogRefresh();

    const infoCall = (logger.info as ReturnType<typeof vi.fn>).mock.calls.find(
      (call) => JSON.stringify(call).includes("catalog-refresh"),
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
    const { stop } = startCatalogRefreshScheduler({ intervalMs: 1_000 });
    await vi.advanceTimersByTimeAsync(0);
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect(mockRefresh).toHaveBeenCalledWith();
    stop();
  });

  it("fires again after each interval", async () => {
    const { stop } = startCatalogRefreshScheduler({ intervalMs: 1_000 });
    await vi.advanceTimersByTimeAsync(0);
    expect(mockRefresh).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(mockRefresh).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(mockRefresh).toHaveBeenCalledTimes(3);

    stop();
  });

  it("stop() prevents further refreshes", async () => {
    const { stop } = startCatalogRefreshScheduler({ intervalMs: 1_000 });
    await vi.advanceTimersByTimeAsync(0);
    stop();

    await vi.advanceTimersByTimeAsync(5_000);
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it("logs startup and stop messages", async () => {
    const { stop } = startCatalogRefreshScheduler({ intervalMs: 1_000 });
    await vi.advanceTimersByTimeAsync(0);
    const startLog = (logger.info as ReturnType<typeof vi.fn>).mock.calls.find((call) =>
      JSON.stringify(call).includes("scheduler started"),
    );
    expect(startLog).toBeDefined();
    stop();
    const stopLog = (logger.info as ReturnType<typeof vi.fn>).mock.calls.find((call) =>
      JSON.stringify(call).includes("scheduler stopped"),
    );
    expect(stopLog).toBeDefined();
  });

  it("uses CATALOG_REFRESH_INTERVAL_MS as default interval", () => {
    expect(CATALOG_REFRESH_INTERVAL_MS).toBe(5 * 60 * 1_000);
  });
});
