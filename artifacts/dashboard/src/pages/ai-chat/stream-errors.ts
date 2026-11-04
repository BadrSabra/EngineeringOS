import type { AiStreamErrorEvent } from '@workspace/api-client-react';
import {
  AiApiError,
  describeAiError,
  providerFailureCategoryGuidance,
} from './provider-runtime';
import { structuredTaskLabel } from './structured-results';

export const CHAT_STAGE_LABELS: Record<string, string> = {
  'building-context': 'Building context…',
  'calling-model': 'Calling AI model…',
  streaming: 'Writing response…',
};

export function safeStructuredFailure(
  err: AiStreamErrorEvent,
  task: 'analyze' | 'review',
): { title: string; reason: string } {
  const name = structuredTaskLabel(task);
  switch (err.failureKind) {
    case 'PROVIDER_FORMAT':
      return { title: `${name} incomplete`, reason: `The ${name} response could not be verified, so no completed result was saved.` };
    case 'RATE_LIMIT':
      return { title: `${name} paused`, reason: `This ${name} reached a temporary usage limit. Wait a moment, then try again.` };
    case 'CONFIGURATION':
      return { title: `${name} unavailable`, reason: `This ${name} cannot run until the AI setup is updated. Fix the setup, then start a new ${name}.` };
    case 'TRANSPORT':
      return { title: `${name} interrupted`, reason: `The connection ended before the ${name} finished, so no completed result was saved.` };
    case 'TOOL_FAILURE':
      return { title: `${name} blocked`, reason: `A required project tool did not complete, so no completed ${name} result was saved.` };
    case 'CANCELLATION':
      return { title: `${name} cancelled`, reason: `The ${name} was cancelled before it reached a verified result.` };
    case 'RECOVERY_FAILURE':
      return { title: `${name} recovery failed`, reason: `The ${name} could not be recovered into a complete verified result.` };
    case 'INCOMPLETE':
      return { title: `${name} incomplete`, reason: `The ${name} did not have enough verified evidence to complete.` };
    default:
      return { title: `${name} incomplete`, reason: `The ${name} could not finish. Try again in a moment.` };
  }
}

export function structuredTaskStageLabel(stage: string): string {
  switch (stage) {
    case 'building-context':
      return 'Building project context';
    case 'calling-model':
      return 'Calling AI model';
    case 'persisting-result':
      return 'Saving result';
    case 'completed':
      return 'Task completed';
    default:
      return stage.replace(/[-_]/g, ' ');
  }
}

export function describeStreamError(err: AiStreamErrorEvent): string {
  if (err.code === 'PROJECT_RATE_LIMIT' || err.rateLimitScope === 'project') {
    const delaySeconds = typeof err.retryAfterMs === 'number' && err.retryAfterMs > 0
      ? Math.ceil(err.retryAfterMs / 1000)
      : undefined;
    return delaySeconds
      ? `This project reached its AI request limit. Wait at least ${delaySeconds} seconds before sending another request.`
      : 'This project reached its AI request limit. No retry interval was provided; wait before sending another request.';
  }
  const categoryGuidance = providerFailureCategoryGuidance(
    err.providerFailureCategory,
    err.rateLimitScope,
    err.retryAfterMs,
    err.retryAfterSource,
  );
  if (categoryGuidance) return categoryGuidance;
  const statusForCode: Record<string, number> = {
    RATE_LIMITED: 429,
    model_output_invalid: 422,
    AUTH_ERROR: 401,
    request_failed: 400,
  };
  const tmpErr = new AiApiError(
    statusForCode[err.code] ?? 502,
    err.message,
    undefined,
    err.code,
    { correlationId: err.correlationId },
  );
  return describeAiError(tmpErr);
}
