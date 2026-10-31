const scenarios = new Set([
  "structured-review",
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
  const attemptedModels = Array.isArray(receipt.attemptedModels)
    ? receipt.attemptedModels.slice(0, 8)
    : [];
  if (
    attemptedModels.some((model) => typeof model !== "string" || !safeModelPattern.test(model)) ||
    (typeof receipt.requestedModel === "string" &&
      !safeModelPattern.test(receipt.requestedModel)) ||
    (receipt.requestedModel !== undefined &&
      typeof receipt.requestedModel !== "string") ||
    (receipt.modelIdentityMatched !== undefined &&
      typeof receipt.modelIdentityMatched !== "boolean")
  ) {
    throw new Error("invalid_receipt");
  }
  if (
    attemptedModels.length !== modelAttempts.length ||
    attemptedModels.some((model, index) => model !== modelAttempts[index]?.model)
  ) {
    throw new Error("invalid_receipt");
  }
  if (receipt.requestedModel !== undefined) {
    const expectedIdentityMatch =
      attemptedModels.length === 1 && attemptedModels[0] === receipt.requestedModel;
    if (
      receipt.modelIdentityMatched !== expectedIdentityMatch ||
      (receipt.accepted === true && !expectedIdentityMatch)
    ) {
      throw new Error("invalid_receipt");
    }
  }
  if (receipt.modelCatalogSnapshot !== undefined) {
    const snapshot = receipt.modelCatalogSnapshot;
    if (
      !snapshot ||
      typeof snapshot !== "object" ||
      Array.isArray(snapshot) ||
      Object.keys(snapshot).some((key) => ![
        "checkedAt",
        "freeModelSetHash",
        "requestedModelListed",
        "requestedModelStaticEligible",
        "requestedModelSupportsJsonSchema",
      ].includes(key)) ||
      typeof snapshot.checkedAt !== "string" ||
      !Number.isFinite(Date.parse(snapshot.checkedAt)) ||
      typeof snapshot.freeModelSetHash !== "string" ||
      !/^[a-f0-9]{16}$/.test(snapshot.freeModelSetHash) ||
      typeof snapshot.requestedModelListed !== "boolean" ||
      typeof snapshot.requestedModelStaticEligible !== "boolean" ||
      ![true, false, null].includes(snapshot.requestedModelSupportsJsonSchema)
    ) {
      throw new Error("invalid_receipt");
    }
  }

  if (
    receipt.rateLimitScope !== undefined &&
    !safeRateLimitScopes.has(receipt.rateLimitScope)
  ) {
    throw new Error("invalid_receipt");
  }
  if (
    receipt.retryAfterMs !== undefined &&
    (!Number.isSafeInteger(receipt.retryAfterMs) || receipt.retryAfterMs <= 0)
  ) {
    throw new Error("invalid_receipt");
  }
  if (
    receipt.providerStatus !== undefined &&
    (!Number.isInteger(receipt.providerStatus) ||
      receipt.providerStatus < 400 ||
      receipt.providerStatus > 599)
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
  if (typeof receipt.requestedModel === "string") {
    summary.requestedModel = receipt.requestedModel;
    summary.modelIdentityMatched = receipt.modelIdentityMatched;
    summary.attemptedModels = attemptedModels;
  }
  if (receipt.modelCatalogSnapshot) {
    summary.modelCatalogSnapshot = {
      checkedAt: receipt.modelCatalogSnapshot.checkedAt,
      freeModelSetHash: receipt.modelCatalogSnapshot.freeModelSetHash,
      requestedModelListed: receipt.modelCatalogSnapshot.requestedModelListed,
      requestedModelStaticEligible: receipt.modelCatalogSnapshot.requestedModelStaticEligible,
      requestedModelSupportsJsonSchema: receipt.modelCatalogSnapshot.requestedModelSupportsJsonSchema,
    };
  }
  if (typeof receipt.failureCode === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(receipt.failureCode)) {
    summary.failureCode = receipt.failureCode;
  }
  if (receipt.rateLimitScope) summary.rateLimitScope = receipt.rateLimitScope;
  if (receipt.retryAfterMs !== undefined) summary.retryAfterMs = receipt.retryAfterMs;
  if (receipt.providerStatus !== undefined) summary.providerStatus = receipt.providerStatus;
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
