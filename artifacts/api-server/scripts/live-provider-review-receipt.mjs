const scenarios = new Set([
  "reasoning-only",
  "agent-harness",
  "rate-limit",
  "empty",
  "malformed",
]);
const forbiddenTerms = ["raw", "prompt", "apiKey", "secret", "providerMessage", "provider body", "source"];
const safeModelPattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/;
const safeRateLimitScopes = new Set([
  "account",
  "key",
  "model",
  "provider_credential",
  "upstream_shared_pool",
  "unknown",
]);

export function validateAndSummarizeCampaignReceipt(receipt) {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
    throw new Error("invalid_receipt");
  }

  const serialized = JSON.stringify(receipt);
  if (forbiddenTerms.some((term) => serialized.toLowerCase().includes(term.toLowerCase()))) {
    throw new Error("invalid_receipt");
  }

  if (
    receipt.kind !== "code-review-provider-campaign-receipt" ||
    receipt.version !== 1 ||
    !scenarios.has(receipt.scenario) ||
    !["fallback-success", "terminal-incomplete"].includes(receipt.outcomeClass) ||
    !["COMPLETE", "INCOMPLETE"].includes(receipt.terminalStatus) ||
    !Array.isArray(receipt.evidence) ||
    !Array.isArray(receipt.modelAttempts)
  ) {
    throw new Error("invalid_receipt");
  }

  if (
    receipt.outcomeClass === "fallback-success" &&
    (receipt.terminalStatus !== "COMPLETE" || receipt.evidence.length !== 1)
  ) {
    throw new Error("invalid_receipt");
  }
  if (
    receipt.outcomeClass === "terminal-incomplete" &&
    (receipt.terminalStatus !== "INCOMPLETE" || receipt.evidence.length !== 0)
  ) {
    throw new Error("invalid_receipt");
  }

  const modelAttempts = receipt.modelAttempts.slice(0, 8).map((attempt) => {
    if (
      !attempt ||
      typeof attempt.model !== "string" ||
      !safeModelPattern.test(attempt.model) ||
      !["free", "paid", "unknown"].includes(attempt.tier)
    ) {
      throw new Error("invalid_receipt");
    }
    return { model: attempt.model, tier: attempt.tier };
  });

  if (
    receipt.rateLimitScope !== undefined &&
    !safeRateLimitScopes.has(receipt.rateLimitScope)
  ) {
    throw new Error("invalid_receipt");
  }

  const summary = {
    kind: receipt.kind,
    scenario: receipt.scenario,
    outcome: receipt.outcomeClass,
    terminal: receipt.terminalStatus,
    evidenceCount: receipt.evidence.length,
    modelAttempts,
  };
  if (typeof receipt.failureCode === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(receipt.failureCode)) {
    summary.failureCode = receipt.failureCode;
  }
  if (receipt.rateLimitScope) summary.rateLimitScope = receipt.rateLimitScope;
  if (typeof receipt.failureModel === "string" && safeModelPattern.test(receipt.failureModel)) {
    summary.failureModel = receipt.failureModel;
  }
  return summary;
}

export function summarizeCampaignChildFailure({ code, signal, receiptStatus, receipt }) {
  const safeSignal = typeof signal === "string" && /^SIG[A-Z0-9]+$/.test(signal)
    ? signal
    : undefined;
  const summary = receiptStatus === "validated"
    ? validateAndSummarizeCampaignReceipt(receipt)
    : undefined;

  return {
    kind: "live-provider-review-campaign",
    status: "child_failed",
    childStatus: safeSignal ?? (Number.isInteger(code) ? `exit_${code}` : "unknown"),
    receiptStatus: ["validated", "missing", "invalid"].includes(receiptStatus)
      ? receiptStatus
      : "unknown",
    ...(summary ? { receipt: summary } : {}),
  };
}
