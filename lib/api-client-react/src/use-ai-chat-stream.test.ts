/**
 * Task 53 — client-side proof
 *
 * Tests `processAiStream`, the exported SSE-parsing function extracted from
 * `useAiChatStream`.  `processAiStream` contains the real switch-case dispatch
 * (`case 'forensic_status': callbacks.onForensicStatus?.(event); break;`).
 * Deleting or changing that case will cause these tests to fail.
 *
 * The hook itself calls `processAiStream` internally, so exercising the
 * function directly is equivalent to exercising the hook's stream handling
 * without needing a React or fetch runtime.
 *
 * Tests cover:
 *   1. A `forensic_status` frame in a fake ReadableStream routes to
 *      `onForensicStatus` with `isFixtureLocal: true` preserved.
 *   2. A production-scope frame (no `isFixtureLocal`) also triggers the
 *      callback, with `isFixtureLocal` absent.
 *   3. A `forensic_status` frame does NOT trigger unrelated callbacks.
 *   4. Missing callback is handled gracefully (no throw).
 *   5. Full round-trip: server sse() wire format → processAiStream → callback.
 *   6. Multi-frame stream: each frame is dispatched independently.
 *   7. Malformed frames are skipped without disrupting subsequent valid frames.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { processAiStream } from './use-ai-chat-stream.js';
import type {
  AiChatStreamCallbacks,
  AiStreamCrossFileTraceEvent,
  AiStreamEvidenceIntegrityEvent,
  AiStreamForensicStatusEvent,
  AiStreamProductionTraceEvent,
  AiStreamExecutionNodesEvent,
  AiStreamIntentEvent,
  AiStreamAuditStateEvent,
  AiStreamVerificationEvent,
} from './use-ai-chat-stream.js';

// ── Helper: build a ReadableStream from raw SSE frame strings ────────────────

function makeSseStream(...frames: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) {
        controller.enqueue(encoder.encode(frame));
      }
      controller.close();
    },
  });
}

/** Serialise an object the same way the server's `sse()` helper does. */
function sseFrame(data: Record<string, unknown>): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

// ── Shared fixtures ───────────────────────────────────────────────────────────

const FIXTURE_LOCAL_EVENT: AiStreamForensicStatusEvent = {
  type: 'forensic_status',
  auditScope: 'FIXTURE_LOCAL',
  isFixtureLocal: true,
};

const PRODUCTION_EVENT: AiStreamForensicStatusEvent = {
  type: 'forensic_status',
  auditScope: 'PRODUCTION',
  // isFixtureLocal intentionally absent
};

const PRODUCTION_TRACE_EVENT: AiStreamProductionTraceEvent = {
  type: 'production_trace',
  status: 'PROVEN',
  nodes: [],
  edges: [],
};

const INTEGRITY_CONSISTENT_EVENT: AiStreamEvidenceIntegrityEvent = {
  type: 'evidence_integrity',
  code: 'TELEMETRY_CONSISTENT',
  consistent: true,
  violations: [],
  readAttempts: 12,
  uniqueFilesRead: 8,
  evidenceFileCount: 6,
  acceptedEvidenceCount: 4,
};

const INTEGRITY_INCONSISTENT_EVENT: AiStreamEvidenceIntegrityEvent = {
  type: 'evidence_integrity',
  code: 'TELEMETRY_INCONSISTENT',
  consistent: false,
  violations: ['claimed evidence not backed by a completed source read'],
  readAttempts: 12,
  uniqueFilesRead: 8,
  evidenceFileCount: 6,
  acceptedEvidenceCount: 3,
};

const CROSS_FILE_TRACE_EVENT: AiStreamCrossFileTraceEvent = {
  type: 'cross_file_trace',
  status: 'NOT_PROVEN',
  maxDepth: 1,
  nodes: [],
  edges: [{
    from: 'a',
    to: 'b',
    relation: 'calls',
    status: 'NOT_PROVEN',
    sourceSpan: { file: 'src/a.ts', line: 12, column: 4 },
    runtimeObserved: false,
  }],
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('processAiStream — semantic trace dispatch', () => {
  it('routes production_trace to onProductionTrace without losing status', async () => {
    const onProductionTrace = vi.fn();
    await processAiStream(
      makeSseStream(sseFrame(PRODUCTION_TRACE_EVENT)),
      { onProductionTrace },
    );
    expect(onProductionTrace).toHaveBeenCalledWith(PRODUCTION_TRACE_EVENT);
  });

  it('routes cross_file_trace with exact sourceSpan to onCrossFileTrace', async () => {
    const onCrossFileTrace = vi.fn();
    await processAiStream(
      makeSseStream(sseFrame(CROSS_FILE_TRACE_EVENT)),
      { onCrossFileTrace },
    );
    expect(onCrossFileTrace).toHaveBeenCalledWith(CROSS_FILE_TRACE_EVENT);
  });
});

describe('processAiStream — routing and verification contract dispatch', () => {
  it('dispatches intent, audit_state, and verification events without leaking them into text callbacks', async () => {
    const intent: AiStreamIntentEvent = {
      type: 'intent',
      intent: 'FORENSIC_AUDIT',
      operationMode: 'FORENSIC_AUDIT',
      requiresEvidence: true,
    };
    const auditState: AiStreamAuditStateEvent = {
      type: 'audit_state',
      sourceCoverage: 'PARTIAL',
      behaviorAssessment: 'INCOMPLETE',
      findingStatus: 'NOT_PROVEN',
      repairReadiness: 'BLOCKED',
      productionReachability: 'NOT_PROVEN',
    };
    const verification: AiStreamVerificationEvent = {
      type: 'verification',
      stage: 'VERIFIED_RESPONSE',
      responseLength: 42,
      sourceCount: 2,
      evidenceCount: 1,
      acceptedEvidenceCount: 0,
      rejectionReasons: ['missing literal match'],
    };
    const onIntent = vi.fn();
    const onAuditState = vi.fn();
    const onVerification = vi.fn();

    await processAiStream(
      makeSseStream(sseFrame(intent), sseFrame(auditState), sseFrame(verification)),
      { onIntent, onAuditState, onVerification },
    );

    expect(onIntent).toHaveBeenCalledWith(intent);
    expect(onAuditState).toHaveBeenCalledWith(auditState);
    expect(onVerification).toHaveBeenCalledWith(verification);
  });
});

describe('processAiStream — execution node dispatch', () => {
  it('routes the bounded execution tree snapshot to Mission Control', async () => {
    const event: AiStreamExecutionNodesEvent = {
      type: 'execution_nodes',
      executionId: 'execution-1',
      nodes: [{
        id: 'phase:F-1:1',
        title: 'Update the safe path',
        status: 'queued',
        allowedFiles: ['src/safe.ts'],
        dependencies: [],
        validationProfile: 'ai-orchestrator-tests',
        attempts: 0,
      }],
    };
    const onExecutionNodes = vi.fn();

    await processAiStream(makeSseStream(sseFrame(event)), { onExecutionNodes });

    expect(onExecutionNodes).toHaveBeenCalledOnce();
    expect(onExecutionNodes).toHaveBeenCalledWith(event);
  });
});

// ── Evidence integrity dispatch (EI-011/012) ─────────────────────────────────

describe('processAiStream — evidence_integrity dispatch', () => {
  it('routes a TELEMETRY_CONSISTENT frame to onEvidenceIntegrity', async () => {
    const onEvidenceIntegrity = vi.fn();
    await processAiStream(
      makeSseStream(sseFrame(INTEGRITY_CONSISTENT_EVENT)),
      { onEvidenceIntegrity },
    );
    expect(onEvidenceIntegrity).toHaveBeenCalledOnce();
    expect(onEvidenceIntegrity).toHaveBeenCalledWith(INTEGRITY_CONSISTENT_EVENT);
  });

  it('preserves consistent:false + violations on a TELEMETRY_INCONSISTENT frame', async () => {
    const onEvidenceIntegrity = vi.fn();
    await processAiStream(
      makeSseStream(sseFrame(INTEGRITY_INCONSISTENT_EVENT)),
      { onEvidenceIntegrity },
    );
    const received = onEvidenceIntegrity.mock.calls[0]?.[0] as AiStreamEvidenceIntegrityEvent;
    expect(received.code).toBe('TELEMETRY_INCONSISTENT');
    expect(received.consistent).toBe(false);
    expect(received.violations).toContain('claimed evidence not backed by a completed source read');
  });

  it('does NOT fire unrelated callbacks for an evidence_integrity frame', async () => {
    const onEvidenceIntegrity = vi.fn();
    const onForensicStatus = vi.fn();
    const onToolCall = vi.fn();
    await processAiStream(
      makeSseStream(sseFrame(INTEGRITY_CONSISTENT_EVENT)),
      { onEvidenceIntegrity, onForensicStatus, onToolCall },
    );
    expect(onEvidenceIntegrity).toHaveBeenCalledOnce();
    expect(onForensicStatus).not.toHaveBeenCalled();
    expect(onToolCall).not.toHaveBeenCalled();
  });

  it('completes without error when onEvidenceIntegrity is undefined', async () => {
    const callbacks: AiChatStreamCallbacks = {};
    await expect(
      processAiStream(makeSseStream(sseFrame(INTEGRITY_CONSISTENT_EVENT)), callbacks),
    ).resolves.toBeUndefined();
  });

  it('dispatches evidence_integrity even after other frames in the same stream', async () => {
    const onEvidenceIntegrity = vi.fn();
    const onStage = vi.fn();
    await processAiStream(
      makeSseStream(
        sseFrame({ type: 'stage', stage: 'calling-model' }),
        sseFrame(INTEGRITY_CONSISTENT_EVENT),
      ),
      { onEvidenceIntegrity, onStage },
    );
    expect(onEvidenceIntegrity).toHaveBeenCalledOnce();
    expect(onStage).toHaveBeenCalledOnce();
  });

  it('routes the exact wire frame the chat.ts server emits', async () => {
    const serverOutput: Record<string, unknown> = {
      type: 'evidence_integrity',
      code: 'TELEMETRY_CONSISTENT',
      consistent: true,
      violations: [],
      readAttempts: 12,
      uniqueFilesRead: 8,
      evidenceFileCount: 6,
      acceptedEvidenceCount: 4,
    };
    const wireFrame = `data: ${JSON.stringify(serverOutput)}\n\n`;
    const onEvidenceIntegrity = vi.fn();
    await processAiStream(makeSseStream(wireFrame), { onEvidenceIntegrity });
    expect(onEvidenceIntegrity).toHaveBeenCalledOnce();
    expect(onEvidenceIntegrity).toHaveBeenCalledWith(expect.objectContaining({
      type: 'evidence_integrity',
      code: 'TELEMETRY_CONSISTENT',
      consistent: true,
      violations: [],
    }));
  });
});

// ── 1. Fixture-local frame → onForensicStatus called with isFixtureLocal:true ─

describe('processAiStream — forensic_status dispatch (isFixtureLocal: true)', () => {
  it('calls onForensicStatus when a forensic_status frame arrives', async () => {
    const onForensicStatus = vi.fn();
    const body = makeSseStream(sseFrame(FIXTURE_LOCAL_EVENT));

    await processAiStream(body, { onForensicStatus });

    expect(onForensicStatus).toHaveBeenCalledOnce();
  });

  it('preserves isFixtureLocal:true in the event passed to onForensicStatus', async () => {
    const onForensicStatus = vi.fn();
    const body = makeSseStream(sseFrame(FIXTURE_LOCAL_EVENT));

    await processAiStream(body, { onForensicStatus });

    expect(onForensicStatus).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'forensic_status', isFixtureLocal: true }),
    );
  });

  it('preserves auditScope:FIXTURE_LOCAL in the event', async () => {
    const onForensicStatus = vi.fn();
    const body = makeSseStream(sseFrame(FIXTURE_LOCAL_EVENT));

    await processAiStream(body, { onForensicStatus });

    expect(onForensicStatus).toHaveBeenCalledWith(
      expect.objectContaining({ auditScope: 'FIXTURE_LOCAL' }),
    );
  });
});

// ── 2. Production-scope frame ─────────────────────────────────────────────────

describe('processAiStream — forensic_status dispatch (production scope)', () => {
  it('also calls onForensicStatus for a production-scope forensic_status frame', async () => {
    const onForensicStatus = vi.fn();
    const body = makeSseStream(sseFrame(PRODUCTION_EVENT));

    await processAiStream(body, { onForensicStatus });

    expect(onForensicStatus).toHaveBeenCalledOnce();
  });

  it('passes auditScope:PRODUCTION and no isFixtureLocal for a production frame', async () => {
    const onForensicStatus = vi.fn();
    const body = makeSseStream(sseFrame(PRODUCTION_EVENT));

    await processAiStream(body, { onForensicStatus });

    const received = onForensicStatus.mock.calls[0]?.[0] as AiStreamForensicStatusEvent;
    expect(received.auditScope).toBe('PRODUCTION');
    expect(received.isFixtureLocal).toBeUndefined();
  });
});

// ── 3. Cross-event isolation ──────────────────────────────────────────────────

describe('processAiStream — forensic_status does not fire unrelated callbacks', () => {
  it('does NOT call onToolCall when only a forensic_status frame arrives', async () => {
    const onToolCall = vi.fn();
    const onForensicStatus = vi.fn();
    const body = makeSseStream(sseFrame(FIXTURE_LOCAL_EVENT));

    await processAiStream(body, { onToolCall, onForensicStatus });

    expect(onToolCall).not.toHaveBeenCalled();
  });

  it('does NOT call onForensicStatus when only a stage frame arrives', async () => {
    const onForensicStatus = vi.fn();
    const onStage = vi.fn();
    const body = makeSseStream(sseFrame({ type: 'stage', stage: 'building-context' }));

    await processAiStream(body, { onForensicStatus, onStage });

    expect(onForensicStatus).not.toHaveBeenCalled();
    expect(onStage).toHaveBeenCalledWith('building-context');
  });
});

// ── 4. Missing callback safety ────────────────────────────────────────────────

describe('processAiStream — missing onForensicStatus does not throw', () => {
  it('completes without error when onForensicStatus is undefined', async () => {
    const body = makeSseStream(sseFrame(FIXTURE_LOCAL_EVENT));
    const callbacks: AiChatStreamCallbacks = {}; // no onForensicStatus

    await expect(processAiStream(body, callbacks)).resolves.toBeUndefined();
  });
});

// ── 5. Server → client round-trip ────────────────────────────────────────────

describe('processAiStream — full server-to-client round-trip', () => {
  it('routes the exact wire frame the server emits to onForensicStatus', async () => {
    // The server's onStep handler in chat.ts writes:
    //   sse({ type: 'forensic_status', auditScope: step.auditScope, isFixtureLocal: step.isFixtureLocal === true ? true : undefined })
    // where sse(data) = res.write(`data: ${JSON.stringify(data)}\n\n`)
    const serverOutput: Record<string, unknown> = {
      type: 'forensic_status',
      auditScope: 'FIXTURE_LOCAL',
      isFixtureLocal: true, // undefined keys are dropped by JSON.stringify, true is kept
    };
    const wireFrame = `data: ${JSON.stringify(serverOutput)}\n\n`;

    const onForensicStatus = vi.fn();
    const body = makeSseStream(wireFrame);

    await processAiStream(body, { onForensicStatus });

    expect(onForensicStatus).toHaveBeenCalledOnce();
    expect(onForensicStatus).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'forensic_status', isFixtureLocal: true, auditScope: 'FIXTURE_LOCAL' }),
    );
  });
});

// ── 6. Multi-frame streams ────────────────────────────────────────────────────

describe('processAiStream — multi-frame stream handling', () => {
  it('dispatches each frame independently when the stream has multiple events', async () => {
    const onStage = vi.fn();
    const onForensicStatus = vi.fn();

    const body = makeSseStream(
      sseFrame({ type: 'stage', stage: 'calling-model' }),
      sseFrame(FIXTURE_LOCAL_EVENT),
      sseFrame({ type: 'stage', stage: 'done' }),
    );

    await processAiStream(body, { onStage, onForensicStatus });

    expect(onForensicStatus).toHaveBeenCalledOnce();
    expect(onStage).toHaveBeenCalledTimes(2);
  });

  it('forensic_status is reached even after earlier frames in the same stream', async () => {
    const onForensicStatus = vi.fn();

    const body = makeSseStream(
      sseFrame({ type: 'stage', stage: 'building-context' }),
      sseFrame({ type: 'thinking', iter: 1, max: 5 }),
      sseFrame(FIXTURE_LOCAL_EVENT),
    );

    await processAiStream(body, { onForensicStatus });

    expect(onForensicStatus).toHaveBeenCalledOnce();
    expect(onForensicStatus).toHaveBeenCalledWith(
      expect.objectContaining({ isFixtureLocal: true }),
    );
  });
});

// ── 7. Malformed frame tolerance ──────────────────────────────────────────────

describe('processAiStream — malformed frame tolerance', () => {
  it('skips a malformed frame and still dispatches the subsequent forensic_status frame', async () => {
    const onForensicStatus = vi.fn();

    const body = makeSseStream(
      'data: {not valid json}\n\n',          // malformed — must be skipped
      sseFrame(FIXTURE_LOCAL_EVENT),          // valid — must be dispatched
    );

    await processAiStream(body, { onForensicStatus });

    expect(onForensicStatus).toHaveBeenCalledOnce();
  });
});

describe('processAiStream — structured task events', () => {
  it('dispatches task lifecycle events without invoking chat-only callbacks', async () => {
    const started = vi.fn();
    const progress = vi.fn();
    const model = vi.fn();
    const done = vi.fn();
    const delta = vi.fn();

    await processAiStream(
      makeSseStream(
        sseFrame({ type: 'task_started', task: 'analyze', projectId: 'project-1' }),
        sseFrame({ type: 'stage', stage: 'building-context' }),
        sseFrame({ type: 'task_progress', task: 'analyze', message: 'Calling AI model…' }),
        sseFrame({ type: 'model_call', model: 'test-model', provider: 'test-provider' }),
        sseFrame({ type: 'task_done', task: 'analyze', result: { summary: 'complete' } }),
      ),
      { onTaskStarted: started, onTaskProgress: progress, onModelCall: model, onTaskDone: done, onDelta: delta },
    );

    expect(started).toHaveBeenCalledWith({ type: 'task_started', task: 'analyze', projectId: 'project-1' });
    expect(progress).toHaveBeenCalledWith({
      type: 'task_progress',
      task: 'analyze',
      message: 'Calling AI model…',
    });
    expect(model).toHaveBeenCalledWith({ type: 'model_call', model: 'test-model', provider: 'test-provider' });
    expect(done).toHaveBeenCalledWith({ type: 'task_done', task: 'analyze', result: { summary: 'complete' } });
    expect(delta).not.toHaveBeenCalled();
  });
});

describe('processAiStream — validation events', () => {
  it.each([
    ['passed', 'VALIDATING', 0],
    ['failed', 'REPAIRING', 1],
  ] as const)('parses the public nested validation contract for %s events', async (status, repairState, exitCode) => {
    const onValidation = vi.fn();
    const onToolResult = vi.fn();
    const event = {
      type: 'validation',
      validation: {
        profile: 'workspace-typecheck',
        status,
        scenario: 'registered validation',
        exitCode,
        evidence: {
          evidenceId: `validation-${status}`,
          observedAt: '2026-08-23T00:00:00.000Z',
          artifactRef: `validation-${status}`,
        },
        detail: status === 'failed' ? 'typecheck failed' : 'typecheck passed',
        // These fields must never be accepted from the public nested payload.
        command: 'pnpm run typecheck',
        stdout: 'PRIVATE_COMMAND_OUTPUT',
        stderr: 'PRIVATE_ERROR_OUTPUT',
        failedTests: [{ name: 'private.test.ts', message: 'PRIVATE_FAILURE_DETAIL' }],
        changedFiles: ['private.ts'],
      },
      repairState,
      attempt: 1,
      maxAttempts: 3,
    } as const;

    await processAiStream(makeSseStream(sseFrame(event)), { onValidation, onToolResult });

    expect(onValidation).toHaveBeenCalledWith({
      type: 'validation',
      validation: {
        profile: 'workspace-typecheck',
        status,
        scenario: 'registered validation',
        exitCode,
        evidence: {
          evidenceId: `validation-${status}`,
          observedAt: '2026-08-23T00:00:00.000Z',
          artifactRef: `validation-${status}`,
        },
        detail: status === 'failed' ? 'typecheck failed' : 'typecheck passed',
      },
      repairState,
      attempt: 1,
      maxAttempts: 3,
    });
    expect(onToolResult).not.toHaveBeenCalled();
  });

  it('routes named repair states independently from validation results', async () => {
    const onRepairState = vi.fn();
    const event = {
      type: 'repair_state',
      state: 'READY_FOR_REVIEW',
      detail: 'Validation passed; pending changes are ready for review.',
    } as const;

    await processAiStream(makeSseStream(sseFrame(event)), { onRepairState });

    expect(onRepairState).toHaveBeenCalledWith(event);
  });
});
