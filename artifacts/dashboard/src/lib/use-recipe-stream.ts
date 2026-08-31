import { useCallback, useState } from 'react';
import {
  useAiChatStream,
  type AiChatStreamCallbacks,
  type AiChatStreamParams,
  type CapabilityGap,
  type RecipeNodeState,
} from '@workspace/api-client-react';

export function useRecipeStream() {
  const stream = useAiChatStream();
  const [recipeNodes, setRecipeNodes] = useState<RecipeNodeState[]>([]);
  const [capabilityGap, setCapabilityGap] = useState<CapabilityGap | null>(null);

  const send = useCallback(async (params: AiChatStreamParams, callbacks: AiChatStreamCallbacks = {}) => {
    setRecipeNodes([]);
    setCapabilityGap(null);
    await stream.send(params, {
      ...callbacks,
      onRecipeNodeProgress: (event) => {
        setRecipeNodes((current) => {
          const next = current.filter((node) => node.nodeId !== event.nodeId);
          next.push({
            nodeId: event.nodeId,
            title: event.title ?? event.nodeId,
            status: event.status,
            attempts: event.attempts ?? 0,
            elapsedMs: event.elapsedMs,
            excerpt: event.excerpt ?? null,
          });
          return next;
        });
        callbacks.onRecipeNodeProgress?.(event);
      },
      onCapabilityGap: (event) => {
        setCapabilityGap(event.gap);
        callbacks.onCapabilityGap?.(event);
      },
    });
  }, [stream]);

  return { ...stream, send, recipeNodes, capabilityGap };
}