import { describe, expect, it, vi } from "vitest";
import {
  createExecutionLedger,
  estimateProviderRequestTokens,
  normalizeProviderRequestUsage,
} from "../execution-ledger.js";

describe("ExecutionLedger", () => {
  it("shares one aggregate budget across orchestration phases", () => {
    const ledger = createExecutionLedger({
      mode: "hierarchical",
      budget: {
        modelCalls: 2,
        plannerCalls: 1,
        hierarchicalTasks: 1,
        synthesisAttempts: 1,
      },
    });

    expect(ledger.admit("planner", { operation: "query_plan" })).toBe(true);
    expect(ledger.admit("planner", { operation: "query_plan_again" })).toBe(false);
    expect(ledger.admit("model", { provider: "groq", model: "fast" })).toBe(false);

    const snapshot = ledger.snapshot();
    expect(snapshot.counts.planner).toBe(1);
    expect(snapshot.terminalReason).toBe("model_budget");
    expect(snapshot.events.at(-1)).toMatchObject({
      kind: "model",
      status: "rejected",
    });
  });

  it("caps attempt timeouts at the request deadline", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-31T00:00:00.000Z"));
    const ledger = createExecutionLedger({
      budget: { deadlineMs: 2_000 },
    });

    vi.advanceTimersByTime(1_250);
    expect(ledger.timeoutMs(60_000)).toBe(750);
    vi.useRealTimers();
  });

  it("keeps provider usage known, partial, or unknown without inventing zeroes", () => {
    expect(normalizeProviderRequestUsage(0, 14)).toEqual({
      promptTokens: 0,
      completionTokens: 14,
      usageStatus: "known",
    });
    expect(normalizeProviderRequestUsage(12, undefined)).toEqual({
      promptTokens: 12,
      usageStatus: "partial",
    });
    expect(normalizeProviderRequestUsage(undefined, -1)).toEqual({
      usageStatus: "unknown",
    });
  });

  it("reserves configured output limits and fails closed on unserializable payloads", () => {
    const estimate = estimateProviderRequestTokens({
      messages: [{ role: "user", content: "hi" }],
      max_completion_tokens: 24_000,
    });
    expect(estimate).toBeGreaterThan(24_000 + 4_096);

    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(() => estimateProviderRequestTokens(cyclic)).toThrow(/serializable input/);
  });

  it("propagates cancellation and rejects fresh work", () => {
    const controller = new AbortController();
    const ledger = createExecutionLedger({ signal: controller.signal });
    controller.abort();

    expect(ledger.signal.aborted).toBe(true);
    expect(ledger.admit("recovery", { operation: "retry_backoff" })).toBe(false);
    expect(ledger.snapshot().terminalReason).toBe("cancelled");
  });

  it("reserves and reconciles each provider transport request", async () => {
    const reserve = vi.fn(async ({ sequence }: { sequence: number }) => `request:${sequence}`);
    const reconcile = vi.fn(async () => undefined);
    const ledger = createExecutionLedger({
      providerRequestBudget: { reserve, reconcile },
    });

    const first = await ledger.admitProviderRequest!({
      provider: "openrouter",
      model: "model-a",
      estimatedTokens: 9_000,
      operation: "structured_completion",
    });
    const second = await ledger.admitProviderRequest!({
      provider: "openrouter",
      model: "model-b",
      estimatedTokens: 10_000,
    });

    expect(first).toEqual({ admitted: true, reservationId: "request:1" });
    expect(second).toEqual({ admitted: true, reservationId: "request:2" });
    await ledger.completeProviderRequest!({
      reservationId: first.reservationId,
      provider: "openrouter",
      model: "model-a",
      startedAt: Date.now(),
      status: "failed",
      usage: { usageStatus: "unknown" },
    });
    await ledger.completeProviderRequest!({
      reservationId: second.reservationId,
      provider: "openrouter",
      model: "model-b",
      status: "completed",
      usage: { promptTokens: 120, completionTokens: 48, usageStatus: "known" },
    });

    expect(reserve).toHaveBeenCalledTimes(2);
    expect(reconcile).toHaveBeenNthCalledWith(1, expect.objectContaining({
      reservationId: "request:1",
      status: "failed",
      usage: { usageStatus: "unknown" },
    }));
    expect(reconcile).toHaveBeenNthCalledWith(2, expect.objectContaining({
      reservationId: "request:2",
      status: "completed",
      usage: { promptTokens: 120, completionTokens: 48, usageStatus: "known" },
    }));
    expect(ledger.snapshot().counts.provider_attempt).toBe(2);
    expect(ledger.snapshot().events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "provider_attempt",
        status: "failed",
        reservationId: "request:1",
      }),
      expect.objectContaining({
        kind: "provider_attempt",
        status: "completed",
        reservationId: "request:2",
        usage: { promptTokens: 120, completionTokens: 48, usageStatus: "known" },
      }),
    ]));
  });

  it("does not turn reconciliation failures into transport failures or retries", async () => {
    const reconciliationError = new Error("fixture database failure");
    const onReconcileError = vi.fn();
    const ledger = createExecutionLedger({
      providerRequestBudget: {
        reserve: async () => "request:reconcile-fails",
        reconcile: async () => {
          throw reconciliationError;
        },
        onReconcileError,
      },
    });
    const admission = await ledger.admitProviderRequest!({
      provider: "openrouter",
      model: "model-a",
      estimatedTokens: 1_000,
    });

    await expect(ledger.completeProviderRequest!({
      reservationId: admission.reservationId,
      provider: "openrouter",
      model: "model-a",
      status: "completed",
    })).resolves.toBeUndefined();

    expect(onReconcileError).toHaveBeenCalledWith({
      reservationId: "request:reconcile-fails",
      error: reconciliationError,
    });
    expect(ledger.snapshot().events).toContainEqual(expect.objectContaining({
      kind: "provider_attempt",
      status: "completed",
      reservationId: "request:reconcile-fails",
    }));
  });

  it("retains completed provider events across the full bounded attempt budget", async () => {
    const ledger = createExecutionLedger();
    for (let index = 0; index < 150; index += 1) {
      const admission = await ledger.admitProviderRequest!({
        provider: "groq",
        model: `model-${index}`,
        estimatedTokens: 8_192,
      });
      expect(admission.admitted).toBe(true);
      await ledger.completeProviderRequest!({
        provider: "groq",
        model: `model-${index}`,
        status: "completed",
      });
    }

    const completedAttempts = ledger.snapshot().events.filter(
      (event) => event.kind === "provider_attempt" && event.status === "completed",
    );
    expect(completedAttempts).toHaveLength(150);
  });
});