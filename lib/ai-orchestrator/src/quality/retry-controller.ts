import { GroqClientError, type AgentErrorCode, type GroqErrorCode } from "../errors.js";
import type { QualityAssessment } from "../quality-engine.js";

export type RetryDecision = {
  shouldRetry: boolean;
  useRelaxedHints: boolean;
  reason: string;
};

const RETRYABLE_GROQ_CODES = new Set<GroqErrorCode>([
  "TIMEOUT",
  "NETWORK_ERROR",
  "SERVER_ERROR",
  "RATE_LIMITED",
  "NON_200",
]);

function isRetryableTransportError(error: unknown): error is GroqClientError {
  return error instanceof GroqClientError && RETRYABLE_GROQ_CODES.has(error.code);
}

function describeAssessment(assessment: QualityAssessment): string {
  return `quality score ${assessment.score.toFixed(2)} below threshold ${assessment.threshold.toFixed(2)}`;
}

export function decideRetry(options: {
  attempt: number;
  limit: number;
  parseError?: { code: AgentErrorCode; message: string };
  assessment?: QualityAssessment;
  transportError?: unknown;
}): RetryDecision {
  let decision: RetryDecision;

  if (options.attempt >= options.limit) {
    decision = {
      shouldRetry: false,
      useRelaxedHints: false,
      reason: "retry budget exhausted",
    };
  } else if (options.parseError) {
    decision = {
      shouldRetry: true,
      useRelaxedHints: true,
      reason: `parse failure (${options.parseError.code})`,
    };
  } else if (options.assessment?.decision === "retry") {
    decision = {
      shouldRetry: true,
      useRelaxedHints: true,
      reason: describeAssessment(options.assessment),
    };
  } else if (isRetryableTransportError(options.transportError)) {
    decision = {
      shouldRetry: true,
      useRelaxedHints: true,
      reason: `transport error (${options.transportError.code})`,
    };
  } else {
    decision = {
      shouldRetry: false,
      useRelaxedHints: false,
      reason: "no retry signal",
    };
  }

  // Log the retry decision so skipped/retried 400-class errors are visible in traces.
  const transportCode =
    options.transportError instanceof GroqClientError
      ? options.transportError.code
      : options.transportError instanceof Error
        ? options.transportError.message
        : null;
  console.info(
    JSON.stringify({
      scope: "retry-controller",
      action: "decide_retry",
      attempt: options.attempt,
      limit: options.limit,
      shouldRetry: decision.shouldRetry,
      useRelaxedHints: decision.useRelaxedHints,
      reason: decision.reason,
      parseErrorCode: options.parseError?.code ?? null,
      assessmentDecision: options.assessment?.decision ?? null,
      assessmentScore: options.assessment?.score ?? null,
      transportErrorCode: transportCode,
      isTransientTransport: isRetryableTransportError(options.transportError),
    }),
  );

  return decision;
}
