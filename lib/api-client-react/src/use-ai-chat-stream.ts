/**
 * PR-I: Handwritten SSE hook for AI chat streaming.
 *
 * The generated Orval client cannot consume Server-Sent Events, so this hook
 * is maintained manually. It wraps `fetch` with `ReadableStream` parsing and
 * surfaces stage/done/error events from `POST /api/ai/chat/stream`.
 *
 * Usage:
 *   const { send, isPending } = useAiChatStream();
 *   await send({ projectId, message, sessionId }, {
 *     onStage: (stage) => setCurrentStage(stage),
 *     onDone:  (data)  => handleDone(data),
 *     onError: (err)   => handleError(err),
 *   });
 */

import { useState, useCallback } from 'react';

// ── Event shapes ──────────────────────────────────────────────────────────────

export type AiStreamStageEvent = {
  type: 'stage';
  /** Server-defined stage identifier, e.g. "building-context" | "calling-model" */
  stage: string;
};

export type AiStreamDoneEvent = {
  type: 'done';
  sessionId: string;
  message: {
    id: string;
    role: 'assistant';
    content: string;
    sources: string;
    createdAt: string;
  };
  sources: string[];
  pendingChanges: Array<{
    path: string;
    absolutePath: string;
    newContent: string;
    originalContent: string | null;
    reason: string;
  }>;
};

export type AiStreamErrorEvent = {
  type: 'error';
  code: string;
  message: string;
  hint?: string;
  raw?: string;
  parseCode?: string;
};

export type AiStreamEvent = AiStreamStageEvent | AiStreamDoneEvent | AiStreamErrorEvent;

// ── Hook params ───────────────────────────────────────────────────────────────

export type AiChatStreamParams = {
  projectId: string;
  message: string;
  sessionId?: string;
};

export type AiChatStreamCallbacks = {
  onStage?: (stage: string) => void;
  onDone?: (data: AiStreamDoneEvent) => void;
  onError?: (err: AiStreamErrorEvent) => void;
};

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useAiChatStream() {
  const [isPending, setIsPending] = useState(false);

  const send = useCallback(async (
    params: AiChatStreamParams,
    callbacks: AiChatStreamCallbacks = {},
  ): Promise<void> => {
    setIsPending(true);
    try {
      const res = await fetch('/api/ai/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });

      // Handle non-SSE error responses (e.g. 400/401/428/429 before the stream starts)
      if (!res.ok) {
        let parsed: { code?: string; error?: string; hint?: string } = {};
        try { parsed = await res.json() as typeof parsed; } catch { /* ignore */ }
        callbacks.onError?.({
          type: 'error',
          code: parsed.code ?? 'request_failed',
          message: parsed.error ?? `Request failed (${res.status})`,
          hint: parsed.hint,
        });
        return;
      }

      // Server sets Content-Type: text/event-stream for the happy path.
      // If body is null (shouldn't happen in practice), treat as error.
      if (!res.body) {
        callbacks.onError?.({ type: 'error', code: 'no_body', message: 'Stream response had no body.' });
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // SSE events are separated by double newlines: "data: {...}\n\n"
        const chunks = buffer.split('\n\n');
        // Last element is the incomplete chunk — keep it for the next read
        buffer = chunks.pop() ?? '';

        for (const chunk of chunks) {
          const dataLine = chunk.split('\n').find((l) => l.startsWith('data: '));
          if (!dataLine) continue;

          let event: AiStreamEvent;
          try {
            event = JSON.parse(dataLine.slice('data: '.length)) as AiStreamEvent;
          } catch {
            continue; // malformed event — skip
          }

          switch (event.type) {
            case 'stage':
              callbacks.onStage?.(event.stage);
              break;
            case 'done':
              callbacks.onDone?.(event);
              break;
            case 'error':
              callbacks.onError?.(event);
              break;
          }
        }
      }
    } catch (err) {
      // Network-level failure (fetch threw)
      callbacks.onError?.({
        type: 'error',
        code: 'network_error',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIsPending(false);
    }
  }, []);

  return { send, isPending };
}
