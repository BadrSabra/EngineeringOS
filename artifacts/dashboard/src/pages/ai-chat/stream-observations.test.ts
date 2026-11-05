import { act, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { useLiveActivity } from './use-live-activity';
import {
  createStreamObservationCallbacks,
  type LiveEvidenceIntegrity,
  type LiveVerdictScope,
} from './stream-observations';
import type { LiveAgentToolStep } from './live-activity';
import type { AiExecutionNodeSnapshot } from '@workspace/api-client-react';

function useObservationHarness(
  isCurrent: () => boolean,
  ownsExecution: (executionId: string) => boolean = () => true,
) {
  const [executionNodes, setExecutionNodes] = useState<AiExecutionNodeSnapshot[]>([]);
  const [streamingContent, setStreamingContent] = useState('');
  const [agentStage, setAgentStage] = useState<string | null>(null);
  const [agentSteps, setAgentSteps] = useState<LiveAgentToolStep[]>([]);
  const [agentIter, setAgentIter] = useState<{ iter: number; max: number } | null>(null);
  const [agentModel, setAgentModel] = useState<string | null>(null);
  const [agentDiagnostics, setAgentDiagnostics] = useState<string[]>([]);
  const [liveFixtureLocal, setLiveFixtureLocal] = useState(false);
  const [liveAuditScopeDescription, setLiveAuditScopeDescription] = useState<string | null>(null);
  const [liveEvidenceIntegrity, setLiveEvidenceIntegrity] = useState<LiveEvidenceIntegrity | null>(null);
  const [liveVerdictScope, setLiveVerdictScope] = useState<LiveVerdictScope | null>(null);
  const activity = useLiveActivity();
  const callbacks = createStreamObservationCallbacks({
    isCurrent,
    ownsExecution,
    setExecutionNodes,
    setStreamingContent,
    setAgentStage,
    setAgentSteps,
    setAgentIter,
    setAgentModel,
    setAgentDiagnostics,
    setLiveFixtureLocal,
    setLiveAuditScopeDescription,
    setLiveBehaviorProgress: activity.setBehaviorProgress,
    setLiveEvidenceIntegrity,
    setLiveVerdictScope,
    appendLiveActivityEvent: activity.appendActivityEvent,
    completeActiveToolActivity: activity.completeActiveToolActivity,
  });

  return {
    executionNodes,
    streamingContent,
    agentStage,
    agentSteps,
    agentIter,
    agentModel,
    agentDiagnostics,
    liveFixtureLocal,
    liveAuditScopeDescription,
    liveEvidenceIntegrity,
    liveVerdictScope,
    activity,
    callbacks,
  };
}

describe('createStreamObservationCallbacks', () => {
  it('keeps streamed deltas behind the current-generation fence', () => {
    let current = false;
    const { result } = renderHook(() => useObservationHarness(() => current));

    act(() => result.current.callbacks.onDelta?.('stale'));
    expect(result.current.streamingContent).toBe('');

    current = true;
    act(() => {
      result.current.callbacks.onDelta?.('live ');
      result.current.callbacks.onDelta?.('text');
    });
    expect(result.current.streamingContent).toBe('live text');
  });

  it('updates plan snapshots only for the owning execution', () => {
    let ownerExecutionId = 'execution-current';
    const { result } = renderHook(() => useObservationHarness(
      () => true,
      (executionId) => executionId === ownerExecutionId,
    ));
    const event = {
      type: 'execution_nodes' as const,
      executionId: 'execution-old',
      nodes: [{
        id: 'node-1',
        title: 'Inspect source',
        status: 'queued' as const,
        allowedFiles: ['src/main.ts'],
        dependencies: [],
        validationProfile: 'workspace-typecheck',
        attempts: 0,
      }],
    };

    act(() => result.current.callbacks.onExecutionNodes?.(event));
    expect(result.current.executionNodes).toEqual([]);
    expect(result.current.activity.activityEvents).toEqual([]);

    ownerExecutionId = 'execution-old';
    act(() => result.current.callbacks.onExecutionNodes?.(event));
    expect(result.current.executionNodes).toEqual(event.nodes);
    expect(result.current.activity.activityEvents).toMatchObject([
      {
        kind: 'stage',
        label: 'Execution plan loaded',
        detail: '1 node',
      },
    ]);
  });

  it('ignores stale stream observations and labels current stages', () => {
    let current = false;
    const { result } = renderHook(() => useObservationHarness(() => current));

    act(() => result.current.callbacks.onStage?.('streaming'));
    expect(result.current.agentStage).toBeNull();
    expect(result.current.activity.activityEvents).toEqual([]);

    current = true;
    act(() => result.current.callbacks.onStage?.('streaming'));
    expect(result.current.agentStage).toBe('Writing response…');
    expect(result.current.activity.activityEvents).toMatchObject([
      { kind: 'stage', label: 'Stage', detail: 'Writing response…', status: 'info' },
    ]);
  });

  it('projects tool call and result events into steps and the activity trail', () => {
    const { result } = renderHook(() => useObservationHarness(() => true));

    const readA = {
      type: 'tool_call',
      tool: 'read_file',
      args: { path: 'src/a.ts' },
      cached: false,
      toolCallId: 'call-a',
    } as const;
    const readB = {
      type: 'tool_call',
      tool: 'read_file',
      args: { path: 'src/b.ts' },
      cached: false,
      toolCallId: 'call-b',
    } as const;
    act(() => {
      result.current.callbacks.onToolCall?.(readA);
      result.current.callbacks.onToolCall?.(readB);
    });
    act(() => {
      result.current.callbacks.onToolResult?.({
        type: 'tool_result',
        tool: 'read_file',
        toolCallId: 'call-b',
        source: 'src/b.ts',
        cached: true,
      });
    });
    expect(result.current.agentSteps).toMatchObject([
      { toolCallId: 'call-a', done: false },
      { toolCallId: 'call-b', done: true, source: 'src/b.ts' },
    ]);
    act(() => {
      result.current.callbacks.onToolResult?.({
        type: 'tool_result',
        tool: 'read_file',
        toolCallId: 'call-a',
        source: 'src/a.ts',
        cached: false,
      });
    });

    expect(result.current.agentSteps).toHaveLength(2);
    expect(result.current.agentSteps).toMatchObject([
      { toolCallId: 'call-a', done: true, source: 'src/a.ts' },
      { toolCallId: 'call-b', done: true, source: 'src/b.ts' },
    ]);
    expect(result.current.activity.activityEvents).toMatchObject([
      { toolCallId: 'call-a', status: 'done', detail: 'src/a.ts' },
      { toolCallId: 'call-b', status: 'done', detail: 'cached · src/b.ts' },
    ]);
    expect(result.current.activity.activityEvents[1]).toMatchObject({
      status: 'done',
      detail: 'cached · src/b.ts',
    });
  });
});
