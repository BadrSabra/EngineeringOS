import { describe, expect, it } from "vitest";
import {
  buildAutonomousDeliveryAcceptanceSummary,
  validateAutonomousDeliveryAcceptanceReceipts,
  type AutonomousDeliveryAcceptanceReceipt,
} from "./autonomous-delivery-acceptance.js";

const campaign = {
  provider: "deterministic" as const,
  browser: false,
  deployment: false,
  remoteDelivery: false,
  isolated: true as const,
  redacted: true as const,
};

function receipt(operationId: string, overrides: Partial<AutonomousDeliveryAcceptanceReceipt> = {}): AutonomousDeliveryAcceptanceReceipt {
  return {
    operationId,
    caseId: `case-${operationId}`,
    terminal: "completed",
    deliveryVerified: true,
    recovered: false,
    scopeViolation: false,
    repeatedSideEffect: false,
    ...overrides,
  };
}

describe("autonomous delivery acceptance", () => {
  it("reports operation-keyed completion, blocking, uncertainty, recovery, and safety metrics", () => {
    const summary = buildAutonomousDeliveryAcceptanceSummary({
      campaign,
      receipts: [
        receipt("op-1"),
        receipt("op-2", { terminal: "safely-blocked", deliveryVerified: false }),
        receipt("op-3", { terminal: "uncertain", deliveryVerified: false, recovered: true }),
        receipt("op-4", { terminal: "completed", scopeViolation: true }),
        receipt("op-5", { terminal: "failed", deliveryVerified: false, repeatedSideEffect: true }),
      ],
    });
    expect(summary.operationCount).toBe(5);
    expect(summary.outcomeCounts).toEqual({ completed: 2, "safely-blocked": 1, failed: 1, uncertain: 1 });
    expect(summary.metrics).toMatchObject({
      completionRate: 1 / 5,
      safeBlockRate: 1 / 5,
      failureRate: 1 / 5,
      uncertaintyRate: 1 / 5,
      recoveryRate: 1 / 5,
      scopeEscapeRate: 1 / 5,
      repeatedSideEffectRate: 1 / 5,
      verifiedCompletionCount: 1,
    });
    expect(summary.operations.map((operation) => operation.operationId)).toEqual([
      "op-1", "op-2", "op-3", "op-4", "op-5",
    ]);
  });

  it("fails closed for duplicate identities and unverifiable completion", () => {
    const receipts = [
      receipt("same"),
      receipt("same"),
      receipt("op-2", { terminal: "completed", deliveryVerified: false }),
    ];
    expect(validateAutonomousDeliveryAcceptanceReceipts(receipts)).toEqual(expect.arrayContaining([
      "duplicate operation identity: same",
      "completed operation is not delivery-verified: op-2",
    ]));
    expect(() => buildAutonomousDeliveryAcceptanceSummary({ campaign, receipts })).toThrow(
      "Invalid autonomous delivery acceptance receipts",
    );
  });

  it("keeps live lanes explicitly opt-in and isolated", () => {
    const summary = buildAutonomousDeliveryAcceptanceSummary({
      campaign: { ...campaign, provider: "live", browser: true, deployment: true, remoteDelivery: true },
      receipts: [],
    });
    expect(summary.campaign).toMatchObject({
      provider: "live",
      browser: true,
      deployment: true,
      remoteDelivery: true,
      isolated: true,
      redacted: true,
    });
  });

  it("rejects policies that could enable side effects without a live isolated campaign", () => {
    expect(() => buildAutonomousDeliveryAcceptanceSummary({
      campaign: { ...campaign, deployment: true },
      receipts: [],
    })).toThrow("deployment side effects require an explicitly live provider campaign");
    expect(() => buildAutonomousDeliveryAcceptanceSummary({
      campaign: { ...campaign, isolated: false as true },
      receipts: [],
    })).toThrow("campaign workspace must be isolated");
  });
});