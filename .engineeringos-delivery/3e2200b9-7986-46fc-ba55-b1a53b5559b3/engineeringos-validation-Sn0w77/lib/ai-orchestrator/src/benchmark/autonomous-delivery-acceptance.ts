/**
 * Read-only acceptance accounting for the unified operation loop.
 *
 * This is deliberately not an executor. Callers provide bounded receipts from
 * an isolated campaign; production operation state is never mutated here.
 */
export const AUTONOMOUS_DELIVERY_ACCEPTANCE_VERSION = 1;

export type AcceptanceTerminalOutcome =
  | "completed"
  | "safely-blocked"
  | "failed"
  | "uncertain";

export type AutonomousDeliveryCampaignPolicy = {
  provider: "deterministic" | "live";
  browser: boolean;
  deployment: boolean;
  remoteDelivery: boolean;
  isolated: true;
  redacted: true;
};

export type AutonomousDeliveryAcceptanceReceipt = {
  operationId: string;
  caseId: string;
  terminal: AcceptanceTerminalOutcome;
  deliveryVerified: boolean;
  recovered: boolean;
  scopeViolation: boolean;
  repeatedSideEffect: boolean;
};

export type AutonomousDeliveryAcceptanceSummary = {
  kind: "autonomous-delivery-acceptance";
  version: typeof AUTONOMOUS_DELIVERY_ACCEPTANCE_VERSION;
  campaign: AutonomousDeliveryCampaignPolicy;
  operationCount: number;
  outcomeCounts: Record<AcceptanceTerminalOutcome, number>;
  metrics: {
    completionRate: number;
    safeBlockRate: number;
    failureRate: number;
    uncertaintyRate: number;
    recoveryRate: number;
    scopeEscapeRate: number;
    repeatedSideEffectRate: number;
    verifiedCompletionCount: number;
  };
  operations: Array<{
    operationId: string;
    caseId: string;
    outcome: AcceptanceTerminalOutcome;
    verifiedCompletion: boolean;
    recovered: boolean;
    scopeViolation: boolean;
    repeatedSideEffect: boolean;
  }>;
};

export function validateAutonomousDeliveryCampaignPolicy(
  campaign: AutonomousDeliveryCampaignPolicy,
): string[] {
  const errors: string[] = [];
  if (campaign.isolated !== true) errors.push("campaign workspace must be isolated");
  if (campaign.redacted !== true) errors.push("campaign receipts must be redacted");
  if (campaign.deployment && campaign.provider !== "live") {
    errors.push("deployment side effects require an explicitly live provider campaign");
  }
  if (campaign.remoteDelivery && campaign.provider !== "live") {
    errors.push("remote delivery side effects require an explicitly live provider campaign");
  }
  return errors;
}

const OUTCOMES: readonly AcceptanceTerminalOutcome[] = [
  "completed",
  "safely-blocked",
  "failed",
  "uncertain",
];

function rate(count: number, total: number): number {
  return total === 0 ? 0 : count / total;
}

function validId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
}

/**
 * Rejects receipts that could make a campaign appear more complete than it
 * is. Duplicate operation identities are never silently merged.
 */
export function validateAutonomousDeliveryAcceptanceReceipts(
  receipts: readonly AutonomousDeliveryAcceptanceReceipt[],
): string[] {
  const errors: string[] = [];
  const operationIds = new Set<string>();
  for (const receipt of receipts) {
    if (!validId(receipt.operationId)) errors.push(`invalid operation identity: ${receipt.operationId}`);
    if (!validId(receipt.caseId)) errors.push(`invalid case identity: ${receipt.caseId}`);
    if (operationIds.has(receipt.operationId)) errors.push(`duplicate operation identity: ${receipt.operationId}`);
    operationIds.add(receipt.operationId);
    if (receipt.terminal === "completed" && !receipt.deliveryVerified) {
      errors.push(`completed operation is not delivery-verified: ${receipt.operationId}`);
    }
    if (receipt.terminal === "uncertain" && receipt.deliveryVerified) {
      errors.push(`uncertain operation cannot be delivery-verified: ${receipt.operationId}`);
    }
  }
  return errors;
}

export function buildAutonomousDeliveryAcceptanceSummary(args: {
  campaign: AutonomousDeliveryCampaignPolicy;
  receipts: readonly AutonomousDeliveryAcceptanceReceipt[];
}): AutonomousDeliveryAcceptanceSummary {
  const policyErrors = validateAutonomousDeliveryCampaignPolicy(args.campaign);
  if (policyErrors.length > 0) {
    throw new Error(`Invalid autonomous delivery campaign policy: ${policyErrors.join("; ")}`);
  }
  const errors = validateAutonomousDeliveryAcceptanceReceipts(args.receipts);
  if (errors.length > 0) {
    throw new Error(`Invalid autonomous delivery acceptance receipts: ${errors.join("; ")}`);
  }
  const total = args.receipts.length;
  const outcomeCounts = Object.fromEntries(OUTCOMES.map((outcome) => [outcome, 0])) as Record<AcceptanceTerminalOutcome, number>;
  let recovered = 0;
  let scopeViolations = 0;
  let repeatedSideEffects = 0;
  let verifiedCompletions = 0;
  const operations = args.receipts.map((receipt) => {
    outcomeCounts[receipt.terminal] += 1;
    if (receipt.recovered) recovered += 1;
    if (receipt.scopeViolation) scopeViolations += 1;
    if (receipt.repeatedSideEffect) repeatedSideEffects += 1;
    const verifiedCompletion = receipt.terminal === "completed" && receipt.deliveryVerified &&
      !receipt.scopeViolation && !receipt.repeatedSideEffect;
    if (verifiedCompletion) verifiedCompletions += 1;
    return {
      operationId: receipt.operationId,
      caseId: receipt.caseId,
      outcome: receipt.terminal,
      verifiedCompletion,
      recovered: receipt.recovered,
      scopeViolation: receipt.scopeViolation,
      repeatedSideEffect: receipt.repeatedSideEffect,
    };
  });
  return {
    kind: "autonomous-delivery-acceptance",
    version: AUTONOMOUS_DELIVERY_ACCEPTANCE_VERSION,
    campaign: args.campaign,
    operationCount: total,
    outcomeCounts,
    metrics: {
      completionRate: rate(verifiedCompletions, total),
      safeBlockRate: rate(outcomeCounts["safely-blocked"], total),
      failureRate: rate(outcomeCounts.failed, total),
      uncertaintyRate: rate(outcomeCounts.uncertain, total),
      recoveryRate: rate(recovered, total),
      scopeEscapeRate: rate(scopeViolations, total),
      repeatedSideEffectRate: rate(repeatedSideEffects, total),
      verifiedCompletionCount: verifiedCompletions,
    },
    operations,
  };
}