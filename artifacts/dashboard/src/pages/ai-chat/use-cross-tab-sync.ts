import { useEffect, type Dispatch, type SetStateAction } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { getListAiChatSessionMissionsQueryKey } from '@workspace/api-client-react';
import {
  AI_CHAT_SYNC_STORAGE_KEY,
  aiChatSelectionStorageKey,
  isOpaqueSelectionId,
  parseAiChatSelection,
  type AiChatSyncEvent,
} from './session-state';

// Mirrors session selection and data changes made in other tabs of the same
// project; the server remains authoritative, so malformed events are ignored.
export function useAiChatCrossTabSync({
  qc,
  selectedProjectId,
  setSessionId,
}: {
  qc: QueryClient;
  selectedProjectId: string;
  setSessionId: Dispatch<SetStateAction<string | undefined>>;
}) {
  useEffect(() => {
    if (!selectedProjectId) return;

    const handleSyncEvent = (raw: string | null) => {
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw) as Partial<AiChatSyncEvent>;
        if (
          parsed.version !== 1
          || parsed.projectId !== selectedProjectId
          || (parsed.kind !== 'selection' && parsed.kind !== 'data')
          || typeof parsed.sequence !== 'number'
        ) return;
        const incomingSessionId = isOpaqueSelectionId(parsed.sessionId)
          ? parsed.sessionId
          : undefined;

        if (parsed.kind === 'selection' && incomingSessionId) {
          setSessionId(incomingSessionId);
        }
        if (incomingSessionId) {
          void qc.invalidateQueries({ queryKey: ['ai-messages', incomingSessionId] });
          void qc.invalidateQueries({ queryKey: ['ai-pending-proposal', incomingSessionId] });
          void qc.invalidateQueries({
            queryKey: getListAiChatSessionMissionsQueryKey(incomingSessionId),
          });
        }
        void qc.invalidateQueries({ queryKey: ['ai-sessions', selectedProjectId] });
      } catch {
        // Ignore malformed cross-tab state; the server remains authoritative.
      }
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key === AI_CHAT_SYNC_STORAGE_KEY) {
        handleSyncEvent(event.newValue);
        return;
      }
      if (event.key === aiChatSelectionStorageKey(selectedProjectId) && event.newValue) {
        const selection = parseAiChatSelection(event.newValue, selectedProjectId);
        if (selection?.kind === 'session') {
          setSessionId(selection.sessionId);
          void qc.invalidateQueries({ queryKey: ['ai-messages', selection.sessionId] });
          void qc.invalidateQueries({ queryKey: ['ai-pending-proposal', selection.sessionId] });
          void qc.invalidateQueries({
            queryKey: getListAiChatSessionMissionsQueryKey(selection.sessionId),
          });
          void qc.invalidateQueries({ queryKey: ['ai-sessions', selectedProjectId] });
        }
      }
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [qc, selectedProjectId]);
}
