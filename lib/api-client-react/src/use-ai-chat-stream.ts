/**
 * PR-06: Handwritten SSE hook for AI chat streaming — intentional codegen exception.
 *
 * This hook is the ONLY sanctioned consumer of `POST /api/ai/chat/stream`.
 * The contract between this hook and the server is documented in two places
 * that must be kept in sync:
 *
 *   1. `lib/api-spec/openapi.yaml`  — the `AiStreamEvent` event shapes in the
 *      `/api/ai/chat/stream` operation description (x-no-codegen: true).
 *
 *   2. This file — the TypeScript event union below is the authoritative runtime
 *      type for all consumers. Do not add a new event type on the server without
 *      first extending `AiStreamEvent` here and updating the openapi.yaml
 *      description.
 *
 * Why not generated?
 *   Orval does not support Server-Sent Events (text/event-stream). OpenAPI 3.1
 *   has no standard way to describe a multiplexed discriminated event stream.
 *   This hook fills that gap: it wraps native `fetch` + `ReadableStream`, parses
 *   `data: <JSON>\n\n` frames, and routes each parsed event to a typed callback.
 *
 * Usage:
 *   const { send, isPending } = useAiChatStream();
 *   await send({ projectId, message, sessionId }, {
 *     onStage: (stage) => setCurrentStage(stage),
 *     onDelta: (token) => appendToken(token),   // real-time streaming tokens
 *     onDone:  (data)  => handleDone(data),
 *     onError: (err)   => handleError(err),
 *   });
 */

import { useState, useCallback } from 'react';

// ── Event shapes ──────────────────────────────────────────────────────────────

export type AiStreamStageEvent = {
  type: 'stage';
  /** Server-defined stage identifier, e.g. "building-context" | "calling-model" | "streaming" */
  stage: string;
};

export type AiStreamDeltaEvent = {
  type: 'delta';
  /** Incremental text fragment from the model's streaming response. */
  delta: string;
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
  /** STORY-04: actual model used at runtime (may differ from configured default if fallback occurred). */
  resolvedModel?: { id: string; provider: string; free: boolean };
};

export type AiStreamErrorEvent = {
  type: 'error';
  code: string;
  message: string;
  hint?: string;
  raw?: string;
  parseCode?: string;
};

export type AiStreamEvent = AiStreamStageEvent | AiStreamDeltaEvent | AiStreamDoneEvent | AiStreamErrorEvent;

// ── Hook params ───────────────────────────────────────────────────────────────

export type AiChatStreamParams = {
  projectId: string;
  message: string;
  sessionId?: string;
};

export type AiChatStreamCallbacks = {
  onStage?: (stage: string) => void;
  /** Called for each incremental text token from the model's streaming response. */
  onDelta?: (delta: string) => void;
  /** Called when the SSE stream breaks mid-flight so callers can clear partial state. */
  onStreamReset?: () => void;
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

        // HTTP 401 without a structured code means the Clerk session expired
        // (the auth middleware rejected the request before it reached the AI handler).
        // Surface this as AUTH_ERROR so describeStreamError maps it to the
        // correct 401 case with a session-expiry hint rather than the generic
        // "Groq API key is invalid" fallback.
        const isSessionExpiry = res.status === 401 && !parsed.code;
        callbacks.onError?.({
          type: 'error',
          code: isSessionExpiry ? 'AUTH_ERROR' : (parsed.code ?? 'request_failed'),
          message: parsed.error ?? `Request failed (${res.status})`,
          hint: isSessionExpiry
            ? 'جلستك انتهت — أعد تحميل الصفحة لتسجيل الدخول. / Your session expired — refresh the page to sign in again.'
            : parsed.hint,
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
            case 'delta':
              callbacks.onDelta?.(event.delta);
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
