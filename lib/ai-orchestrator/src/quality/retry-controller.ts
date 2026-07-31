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
  if (options.attempt >= options.limit) {
    return {
      shouldRetry: false,
      useRelaxedHints: false,
      reason: "retry budget exhausted",
    };
  }

  if (options.parseError) {
    return {
      shouldRetry: true,
      useRelaxedHints: true,
      reason: `parse failure (${options.parseError.code})`,
    };
  }

  if (options.assessment?.decision === "retry") {
    return {
      shouldRetry: true,
      useRelaxedHints: true,
      reason: describeAssessment(options.assessment),
    };
  }

  if (isRetryableTransportError(options.transportError)) {
    return {
      shouldRetry: true,
      useRelaxedHints: true,
      reason: `transport error (${options.transportError.code})`,
    };
  }

  return {
    shouldRetry: false,
    useRelaxedHints: false,
    reason: "no retry signal",
  };
}
