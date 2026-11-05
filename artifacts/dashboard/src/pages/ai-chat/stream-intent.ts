import type { Dispatch, SetStateAction } from 'react';
import type { AiChatStreamCallbacks } from '@workspace/api-client-react';
import type { ActiveExecution } from './delivery-proof';
import type { OperationMode } from './types';

type StreamIntentCallback = NonNullable<AiChatStreamCallbacks['onIntent']>;

type StreamIntentActions = {
  isCurrent: () => boolean;
  setOperationMode: Dispatch<SetStateAction<OperationMode | undefined>>;
  setActiveExecution: Dispatch<SetStateAction<ActiveExecution | null>>;
  setAgentStage: Dispatch<SetStateAction<string | null>>;
};

/**
 * Apply the server-authoritative intent projection for the current stream.
 * The generation fence is supplied by AiChat, where stream ownership lives.
 */
export function createStreamIntentCallback({
  isCurrent,
  setOperationMode,
  setActiveExecution,
  setAgentStage,
}: StreamIntentActions): StreamIntentCallback {
  return (event) => {
    if (!isCurrent()) return;

    setOperationMode(event.operationMode);
    setActiveExecution((current) => current
      ? {
          ...current,
          operationMode: event.operationMode,
          proofRequired: current.proofRequired ?? event.requiresEvidence,
        }
      : current);
    setAgentStage(
      event.requiresEvidence
        ? `Evidence mode: ${event.intent.replace(/_/g, ' ')}`
        : `Request mode: ${event.intent.replace(/_/g, ' ')}`,
    );
  };
}
