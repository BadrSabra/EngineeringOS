import type { ChatMessage } from './types';
import type { LiveAgentActivityEvent } from './live-activity';

type OptimisticUserMessageInput = {
  message: string;
  idTimestamp: number;
  createdAt: string;
};

export function createOptimisticUserMessage({
  message,
  idTimestamp,
  createdAt,
}: OptimisticUserMessageInput): ChatMessage {
  return {
    id: `opt-${idTimestamp}`,
    role: 'user',
    content: message,
    createdAt,
  };
}

export type StreamStartUiActions = {
  setAgentStage: (value: string | null) => void;
  setStreamingContent: (value: string) => void;
  clearAgentSteps: () => void;
  clearLiveActivityEvents: () => void;
  appendLiveActivityEvent: (event: Omit<LiveAgentActivityEvent, 'id'>) => number;
  clearAgentIter: () => void;
  clearAgentModel: () => void;
  setAgentStartedAt: (value: number | null) => void;
  clearAgentElapsedSeconds: () => void;
  clearAgentModelHistory: () => void;
  clearAgentDiagnostics: () => void;
  disableLiveFixture: () => void;
  clearLiveEvidenceIntegrity: () => void;
  clearLiveVerdictScope: () => void;
};

export function initializeStreamStartUi(
  actions: StreamStartUiActions,
  startedAtMs: number,
): void {
  actions.setAgentStage('Connecting…');
  actions.setStreamingContent('');
  actions.clearAgentSteps();
  actions.clearLiveActivityEvents();
  actions.appendLiveActivityEvent({
    kind: 'stage',
    label: 'Connecting to the AI stream',
    status: 'info',
  });
  actions.clearAgentIter();
  actions.clearAgentModel();
  actions.setAgentStartedAt(startedAtMs);
  actions.clearAgentElapsedSeconds();
  actions.clearAgentModelHistory();
  actions.clearAgentDiagnostics();
  actions.disableLiveFixture();
  actions.clearLiveEvidenceIntegrity();
  actions.clearLiveVerdictScope();
}
