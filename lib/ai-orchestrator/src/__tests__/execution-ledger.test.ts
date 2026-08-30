import { describe, expect, it, vi } from "vitest";
import { createExecutionLedger } from "../execution-ledger.js";

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

  it("propagates cancellation and rejects fresh work", () => {
    const controller = new AbortController();
    const ledger = createExecutionLedger({ signal: controller.signal });
    controller.abort();

    expect(ledger.signal.aborted).toBe(true);
    expect(ledger.admit("recovery", { operation: "retry_backoff" })).toBe(false);
    expect(ledger.snapshot().terminalReason).toBe("cancelled");
  });
});