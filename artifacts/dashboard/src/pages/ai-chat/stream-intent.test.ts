import { act, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import type { ActiveExecution } from './delivery-proof';
import type { OperationMode } from './types';
import { createStreamIntentCallback } from './stream-intent';

const initialExecution: ActiveExecution = {
  id: 'execution-1',
  projectId: 'project-1',
  message: 'request',
  operationMode: 'CHAT',
  proofRequired: false,
};

function useIntentHarness(
  isCurrent: () => boolean,
  execution: ActiveExecution | null = initialExecution,
) {
  const [operationMode, setOperationMode] = useState<OperationMode | undefined>('CHAT');
  const [activeExecution, setActiveExecution] = useState<ActiveExecution | null>(execution);
  const [agentStage, setAgentStage] = useState<string | null>('Connecting…');
  const callback = createStreamIntentCallback({
    isCurrent,
    setOperationMode,
    setActiveExecution,
    setAgentStage,
  });

  return { operationMode, activeExecution, agentStage, callback };
}

describe('createStreamIntentCallback', () => {
  it('ignores intent events from a stale stream generation', () => {
    const { result } = renderHook(() => useIntentHarness(() => false));

    act(() => {
      result.current.callback({
        type: 'intent',
        intent: 'PROJECT_QUERY',
        operationMode: 'FORENSIC_AUDIT',
        requiresEvidence: true,
      });
    });

    expect(result.current.operationMode).toBe('CHAT');
    expect(result.current.activeExecution).toEqual(initialExecution);
    expect(result.current.agentStage).toBe('Connecting…');
  });

  it('updates mode and stage without overriding an explicit proof requirement', () => {
    const { result } = renderHook(() => useIntentHarness(() => true));

    act(() => {
      result.current.callback({
        type: 'intent',
        intent: 'PROJECT_QUERY',
        operationMode: 'FORENSIC_AUDIT',
        requiresEvidence: true,
      });
    });

    expect(result.current.operationMode).toBe('FORENSIC_AUDIT');
    expect(result.current.activeExecution).toMatchObject({
      operationMode: 'FORENSIC_AUDIT',
      proofRequired: false,
    });
    expect(result.current.agentStage).toBe('Evidence mode: PROJECT QUERY');
  });

  it('uses intent evidence requirements only when execution proof is unspecified', () => {
    const { result } = renderHook(() => useIntentHarness(
      () => true,
      { ...initialExecution, proofRequired: undefined },
    ));
    act(() => result.current.callback({
      type: 'intent',
      intent: 'FORENSIC_AUDIT',
      operationMode: 'FORENSIC_AUDIT',
      requiresEvidence: true,
    }));

    expect(result.current.activeExecution?.proofRequired).toBe(true);
  });
});
