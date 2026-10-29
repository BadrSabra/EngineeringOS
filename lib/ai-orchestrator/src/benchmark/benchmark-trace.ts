/**
 * Projects only a server-owned behavioral-proof code into benchmark traces.
 * Diagnostic details can contain contextual text and must not be logged.
 */
export function safeBehavioralProofFailureCode(step: {
  kind: string;
  code?: string;
  details?: readonly string[];
}): string | undefined {
  if (step.kind !== "diagnostic" || step.code !== "EXECUTION_BEHAVIORAL_PROOF_FAILED") {
    return undefined;
  }

  const match = /^code=([A-Z][A-Z0-9_]{0,79})(?::|$)/.exec(step.details?.[0]?.trim() ?? "");
  return match?.[1];
}

export function safeProviderFailureCode(step: {
  kind: string;
  code?: string;
  details?: readonly string[];
}): string | undefined {
  if (step.kind !== "diagnostic" || step.code !== "EXECUTION_PROVIDER_FAILURE") {
    return undefined;
  }

  for (const detail of step.details ?? []) {
    const match = /(?:^|\s)(?:fallback\s+)?provider failure code:\s*([A-Z][A-Z0-9_]{0,63})\b/i
      .exec(detail.trim());
    if (match) return match[1]!.toUpperCase();
  }
  return undefined;
}
