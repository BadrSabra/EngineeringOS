import { describe, expect, it } from "vitest";
import { buildAiTaskExecutionReceipt } from "./task-execution-service.js";

function result(overrides: Record<string, unknown> = {}) {
  return {
    summary: "Completed review at /home/runner/workspace/src/app.ts; token=super-secret",
    confidence: "high",
    needsHumanReview: false,
    steps: Array.from({ length: 80 }, (_, index) =>
      `step ${index} /tmp/internal-${index}.ts password=hunter2`,
    ),
    ...overrides,
  } as never;
}

describe("AI task execution receipts", () => {
  it("keeps a bounded, safe structured success receipt", () => {
    const receipt = buildAiTaskExecutionReceipt({
      executionId: "execution-1",
      correlationId: "correlation-1",
      revision: "2026-08-23T00:00:00.000Z",
      provider: "openrouter",
      attempt: 0,
      attempts: 2,
      durationMs: 42,
      stages: ["claim", "context", "provider_call", "provider_fallback", "finalize"],
      result: result(),
    });

    expect(JSON.stringify(receipt).length).toBeLessThanOrEqual(8_000);
    expect(receipt.terminalStatus).toBe("SUCCEEDED");
    expect(receipt.attempts).toBe(2);
    expect(receipt.provider).toBe("openrouter");
    expect(receipt.model).toBeTruthy();
    expect(receipt.summary).not.toContain("/home/runner");
    expect(receipt.summary).not.toContain("super-secret");
    expect(receipt.steps).toHaveLength(24);
    expect(JSON.stringify(receipt)).not.toContain("hunter2");
  });

  it("represents blocked results without storing model payloads", () => {
    const receipt = buildAiTaskExecutionReceipt({
      executionId: "execution-2",
      correlationId: "correlation-2",
      provider: "groq",
      attempt: 1,
      durationMs: 1_000_000_000,
      stages: ["claim", "provider_call"],
      result: result({
        summary: "Needs operator approval",
        needsHumanReview: true,
        steps: ["Review proposed change"],
      }),
    });

    expect(receipt.terminalStatus).toBe("BLOCKED");
    expect(receipt.terminalReason).toBe("human_review_required");
    expect(receipt.durationMs).toBe(86_400_000);
    expect(receipt.evidenceRefs).toEqual([]);
  });
});