import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { AiChatStreamCallbacks } from '@workspace/api-client-react';
import type { ActiveExecution } from './delivery-proof';
import type { LiveAgentActivityEvent } from './live-activity';
import type { Session, StreamOwner } from './session-state';

type StreamIdentityCallbacks = Pick<
  AiChatStreamCallbacks,
  'onExecutionStarted' | 'onSessionStarted'
>;

type StreamIdentityActions = {
  ownerRef: MutableRefObject<StreamOwner | null>;
  ownsStream: (binding: { sessionId?: string; executionId?: string }) => boolean;
  projectId: string;
  linkedTaskId?: string;
  message: string;
  buildPlanMessageId?: string;
  publishExecution: (execution: ActiveExecution) => void;
  persistSessionSelection: (sessionId: string) => void;
  setSessionId: Dispatch<SetStateAction<string | undefined>>;
  upsertSession: (session: Session) => void;
  appendActivityEvent: (event: Omit<LiveAgentActivityEvent, 'id'>) => number;
};

/**
 * Session and execution identity callbacks. Ownership stays server-verified
 * by the caller's ownsStream fence; this factory only applies owned events.
 */
export function createStreamIdentityCallbacks({
  ownerRef,
  ownsStream,
  projectId,
  linkedTaskId,
  message,
  buildPlanMessageId,
  publishExecution,
  persistSessionSelection,
  setSessionId,
  upsertSession,
  appendActivityEvent,
}: StreamIdentityActions): StreamIdentityCallbacks {
  return {
    onExecutionStarted: (event) => {
      if (!ownsStream({ executionId: event.executionId })) return;
      const owner = ownerRef.current;
      if (!owner) return;
      owner.executionId = event.executionId;

      const execution: ActiveExecution = {
        id: event.executionId,
        projectId,
        ...(owner.sessionId ? { sessionId: owner.sessionId } : {}),
        ...(linkedTaskId ? { linkedTaskId } : {}),
        ...(event.resumeToken ? { resumeToken: event.resumeToken } : {}),
        resumable: event.resumable,
        proofRequired: event.proofRequired,
        operationMode: event.operationMode,
        message,
        ...(buildPlanMessageId ? { buildPlanMessageId } : {}),
      };
      publishExecution(execution);
      appendActivityEvent({
        kind: 'stage',
        label: 'Durable execution reserved',
        detail: event.executionId.slice(0, 8),
        status: 'info',
      });
    },
    onSessionStarted: (event) => {
      if (!ownsStream({ sessionId: event.sessionId })) return;
      const owner = ownerRef.current;
      if (!owner) return;
      owner.sessionId = event.sessionId;

      persistSessionSelection(event.sessionId);
      setSessionId(event.sessionId);
      upsertSession({
        id: event.sessionId,
        title: event.title,
        updatedAt: event.updatedAt,
      });
    },
  };
}
