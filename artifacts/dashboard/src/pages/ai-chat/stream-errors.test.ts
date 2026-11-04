import { describe, expect, it } from 'vitest';
import type { AiStreamErrorEvent } from '@workspace/api-client-react';
import {
  CHAT_STAGE_LABELS,
  describeStreamError,
  safeStructuredFailure,
  structuredTaskStageLabel,
} from './stream-errors';

function streamError(overrides: Partial<AiStreamErrorEvent> = {}): AiStreamErrorEvent {
  return {
    type: 'error',
    code: 'request_failed',
    message: 'Request failed',
    ...overrides,
  };
}

describe('AI chat stream error presentation', () => {
  it('keeps project rate limits explicit and rounds retry time upward', () => {
    expect(describeStreamError(streamError({
      code: 'PROJECT_RATE_LIMIT',
      retryAfterMs: 1_001,
    }))).toContain('Wait at least 2 seconds');
    expect(describeStreamError(streamError({
      code: 'PROJECT_RATE_LIMIT',
    }))).toContain('No retry interval was provided');
  });

  it('uses provider-category guidance instead of exposing provider diagnostics', () => {
    const guidance = describeStreamError(streamError({
      code: 'upstream',
      message: 'private raw provider response',
      providerFailureCategory: 'TIMEOUT',
    }));
    expect(guidance).toContain('لم يرد OpenRouter');
    expect(guidance).not.toContain('private raw provider response');
  });

  it('provides stable recovery copy for structured task failures', () => {
    const failure = safeStructuredFailure(streamError({
      failureKind: 'TRANSPORT',
      message: 'private connection detail',
    }), 'analyze');
    expect(failure.title).toBe('scan analysis interrupted');
    expect(failure.reason).toContain('no completed result was saved');
    expect(failure.reason).not.toContain('private connection detail');
  });

  it('preserves stage labels and readable fallback labels', () => {
    expect(CHAT_STAGE_LABELS['calling-model']).toBe('Calling AI model…');
    expect(structuredTaskStageLabel('persisting-result')).toBe('Saving result');
    expect(structuredTaskStageLabel('custom-stage_name')).toBe('custom stage name');
  });
});
