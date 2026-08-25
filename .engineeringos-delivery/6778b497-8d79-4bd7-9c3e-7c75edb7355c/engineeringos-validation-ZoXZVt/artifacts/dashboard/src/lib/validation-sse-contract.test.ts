import { describe, expect, it, vi } from 'vitest';
import { processAiStream } from '@workspace/api-client-react';

function sseFrame(event: unknown): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

function streamFor(event: unknown): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(sseFrame(event));
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

describe('dashboard validation SSE contract', () => {
  it.each([
    ['passed', 'VALIDATING', 0],
    ['failed', 'REPAIRING', 1],
  ] as const)('accepts the public nested payload for %s events only', async (status, repairState, exitCode) => {
    const onValidation = vi.fn();

    await processAiStream(streamFor({
      type: 'validation',
      validation: {
        profile: 'workspace-typecheck',
        status,
        scenario: 'registered validation',
        exitCode,
        evidence: {
          evidenceId: `evidence-${status}`,
          observedAt: '2026-08-23T00:00:00.000Z',
          artifactRef: `validation-${status}`,
        },
        detail: 'bounded public detail',
        command: 'pnpm run typecheck',
        stdout: 'private command output',
        stderr: 'private failed-test output',
        failedTests: [{ name: 'private.test.ts', message: 'private test detail' }],
        changedFiles: ['private.ts'],
      },
      repairState,
      attempt: 1,
      maxAttempts: 3,
    }), { onValidation });

    expect(onValidation).toHaveBeenCalledOnce();
    const [event] = onValidation.mock.calls[0];
    expect(event.validation).toEqual({
      profile: 'workspace-typecheck',
      status,
      scenario: 'registered validation',
      exitCode,
      evidence: {
        evidenceId: `evidence-${status}`,
        observedAt: '2026-08-23T00:00:00.000Z',
        artifactRef: `validation-${status}`,
      },
      detail: 'bounded public detail',
    });
    expect(event.validation).not.toHaveProperty('command');
    expect(event.validation).not.toHaveProperty('stdout');
    expect(event.validation).not.toHaveProperty('stderr');
    expect(event.validation).not.toHaveProperty('failedTests');
    expect(event.validation).not.toHaveProperty('changedFiles');
  });

  it('preserves only an allowlisted browser block reason', async () => {
    const onValidation = vi.fn();

    await processAiStream(streamFor({
      type: 'validation',
      validation: {
        profile: 'preview-smoke',
        status: 'unavailable',
        scenario: 'Registered browser validation profile is unavailable.',
        exitCode: null,
        reasonCode: 'stale_revision',
        evidence: {
          evidenceId: 'browser-profile:preview-smoke',
          observedAt: '2026-08-23T00:00:00.000Z',
          artifactRef: 'browser-preview:profile-unavailable',
        },
        detail: 'The browser validation profile is not approved for this plan.',
        reason: 'internal diagnostic must not cross the boundary',
      },
      repairState: 'BLOCKED',
      attempt: 1,
      maxAttempts: 3,
    }), { onValidation });

    expect(onValidation.mock.calls[0][0].validation.reasonCode).toBe('stale_revision');
    expect(onValidation.mock.calls[0][0].validation).not.toHaveProperty('reason');
  });
});