/**
 * DeepSeek API client — OpenAI-compatible REST API via api.deepseek.com
 *
 * Uses native fetch (no extra dependencies). The interface mirrors
 * groq-client's RawGroqResponse so chat-agent.ts can route to either
 * provider transparently.
 *
 * Model notes:
 *   deepseek-chat     — DeepSeek-V3. Supports function/tool calling.
 *                       Best balance of quality + speed + cost.
 *   deepseek-reasoner — DeepSeek-R1. Stronger reasoning but does NOT
 *                       support tool calling — only use for single-shot
 *                       non-tool tasks. Emits <think> tokens.
 *
 * Both MODEL constants point to deepseek-chat so the agentic tool-calling
 * loop always uses a tool-capable model. R1 can be added for single-shot
 * agents (scan-analyst, code-reviewer) in a future pass.
 */
import type { RawMessage, ToolDefinition, ToolCall, RawGroqResponse } from "./groq-client.js";
import { GroqClientError } from "./errors.js";
import {
  createContentOnlyStreamGuard,
  normalizeProviderResponse,
  normalizeProviderToolCalls,
} from "./provider-tool-calls.js";

export const DEEPSEEK_MODEL_FAST    = "deepseek-chat";
export const DEEPSEEK_MODEL_POWERFUL = "deepseek-chat";

const DEEPSEEK_BASE_URL    = "https://api.deepseek.com";
const DEFAULT_TIMEOUT_MS   = 60_000;
const DEEPSEEK_MODELS_URL = `${DEEPSEEK_BASE_URL}/models`;
const DEEPSEEK_MODEL_CHECK_TIMEOUT_MS = 5_000;

export type DeepSeekDefaultModelRole = "fast" | "powerful";
export type DeepSeekDefaultModelValidation = {
  valid: boolean;
  missing: DeepSeekDefaultModelRole[];
  checkedModels: { fast: string; powerful: string };
};

type DeepSeekModelListResponse = {
  data?: Array<{ id?: unknown; object?: unknown }>;
};

export async function validateDeepSeekDefaultModels(
  apiKey: string,
  defaults: { fast: string; powerful: string },
): Promise<DeepSeekDefaultModelValidation> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEEPSEEK_MODEL_CHECK_TIMEOUT_MS);
  try {
    const response = await fetch(DEEPSEEK_MODELS_URL, {
      method: "GET",
      headers: { Accept: "application/json", Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new GroqClientError("AUTH_ERROR", "DeepSeek credential rejected");
      }
      throw new GroqClientError(
        response.status >= 500 ? "SERVER_ERROR" : "NON_200",
        "DeepSeek model catalog unavailable",
      );
    }
    const payload = (await response.json()) as DeepSeekModelListResponse;
    const ids = new Set(
      (Array.isArray(payload.data) ? payload.data : [])
        .map((model) => typeof model.id === "string" ? model.id.trim() : "")
        .filter(Boolean),
    );
    const missing = (["fast", "powerful"] as const).filter((role) => !ids.has(defaults[role]));
    return { valid: missing.length === 0, missing: [...missing], checkedModels: { ...defaults } };
  } catch (error) {
    if (error instanceof GroqClientError) throw error;
    if (controller.signal.aborted) throw new GroqClientError("TIMEOUT", "DeepSeek model catalog timed out", { cause: error });
    throw new GroqClientError("NETWORK_ERROR", "DeepSeek model catalog unavailable", { cause: error });
  } finally {
    clearTimeout(timer);
  }
}

export type DeepSeekCompleteOptions = {
  model?:     string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  apiKey:     string;               // required — no server-side fallback for DeepSeek
  signal?: AbortSignal;
  tools?:     ToolDefinition[];
  /** Full authorized execution manifest; omitted for no-tool synthesis calls. */
  toolManifest?: ToolDefinition[];
  toolChoice?: "auto" | "required";
  /**
   * Force a structured JSON response.
   * Mutually exclusive with `tools` — when both are present, tools take precedence
   * (same constraint as Groq). Only use in single-shot correction turns.
   */
  responseFormat?: { type: "json_object" };
};

/** Strip <think>…</think> reasoning blocks emitted by DeepSeek-R1. */
function stripThink(raw: string | null): string | null {
  if (!raw) return raw;
  const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  return cleaned || null;
}

/**
 * Classify an HTTP error status code into the same GroqClientError union
 * used by groq-client.ts so callers (routes/ai.ts, chat-agent.ts) handle
 * DeepSeek errors with the same switch statements they already have.
 */
function classifyStatus(status: number, body: string): GroqClientError {
  if (status === 401 || status === 403) {
    return new GroqClientError("AUTH_ERROR", `DeepSeek API authentication failed (${status}) — check your API key at platform.deepseek.com`);
  }
  if (status === 429) {
    return new GroqClientError("RATE_LIMITED", "DeepSeek API rate limit exceeded — wait a moment before retrying");
  }
  if (status >= 500) {
    return new GroqClientError("SERVER_ERROR", `DeepSeek API server error (${status}): ${body.slice(0, 200)}`);
  }
  return new GroqClientError("NON_200", `DeepSeek API responded with status ${status}: ${body.slice(0, 200)}`);
}

/**
 * Stream a chat-completion from DeepSeek using Server-Sent Events.
 * Yields content deltas in the same way as groq-client's `completeStream`
 * so chat-agent.ts can drive either provider through the same async-generator
 * interface.
 *
 * DeepSeek's API is OpenAI-compatible and fully supports `stream: true` on
 * deepseek-chat. Tool calls are not supported in streaming mode — only use
 * this for the final synthesis step (no tools in the request body).
 */
export async function* deepseekCompleteStream(
  messages: RawMessage[],
  opts: Omit<DeepSeekCompleteOptions, "tools" | "responseFormat">,
): AsyncGenerator<string> {
  const {
    model     = DEEPSEEK_MODEL_FAST,
    temperature = 0.2,
    maxTokens = 4096,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    apiKey,
    signal,
  } = opts;

  const body: Record<string, unknown> = {
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
    stream: true,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) onAbort();
  else signal?.addEventListener("abort", onAbort, { once: true });

  let response: Response;
  try {
    response = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body:   JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
    if (controller.signal.aborted) {
      throw new GroqClientError("TIMEOUT", "DeepSeek streaming request timed out", { cause: err });
    }
    throw new GroqClientError(
      "NETWORK_ERROR",
      err instanceof Error ? err.message : "Network error contacting DeepSeek",
      { cause: err },
    );
  }

  if (!response.ok) {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
    const text = await response.text().catch(() => "");
    throw classifyStatus(response.status, text);
  }

  // Parse the SSE stream line by line.
  const reader = response.body?.getReader();
  if (!reader) {
    clearTimeout(timer);
    throw new GroqClientError("EMPTY_RESPONSE", "DeepSeek stream has no body");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let hadContent = false;
  const streamGuard = createContentOnlyStreamGuard({ providerName: "DeepSeek", model });

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      // Keep the last (possibly incomplete) line in the buffer.
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === "data: [DONE]") continue;
        if (!trimmed.startsWith("data: ")) continue;

        try {
          const json = JSON.parse(trimmed.slice(6)) as {
            choices?: Array<{ delta?: { content?: string | null } }>;
          };
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) {
            hadContent = true;
            for (const safeText of streamGuard.push(delta)) yield safeText;
          }
        } catch {
          // Ignore malformed SSE frames.
        }
      }
    }
    // Providers occasionally omit the final newline. Parse that last complete
    // SSE frame before the no-tool guard is finalized.
    buffer += decoder.decode();
    const trailing = buffer.trim();
    if (trailing.startsWith("data: ") && trailing !== "data: [DONE]") {
      try {
        const json = JSON.parse(trailing.slice(6)) as {
          choices?: Array<{ delta?: { content?: string | null } }>;
        };
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) {
          hadContent = true;
          for (const safeText of streamGuard.push(delta)) yield safeText;
        }
      } catch {
        // Ignore malformed SSE frames.
      }
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }

  for (const safeText of streamGuard.finish()) yield safeText;

  if (!hadContent) {
    throw new GroqClientError("EMPTY_RESPONSE", "DeepSeek stream returned no content");
  }
}

/**
 * Send a chat-completion request to DeepSeek and return a RawGroqResponse.
 * The returned shape is identical to completeRaw() so chat-agent.ts can
 * call either function through the same code path.
 */
export async function deepseekCompleteRaw(
  messages: RawMessage[],
  opts: DeepSeekCompleteOptions,
): Promise<RawGroqResponse> {
  const {
    model     = DEEPSEEK_MODEL_FAST,
    temperature = 0.2,
    maxTokens = 4096,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    apiKey,
    signal,
    tools,
    toolChoice,
  } = opts;

  const body: Record<string, unknown> = {
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
  };

  const hasTools = Array.isArray(tools) && tools.length > 0;
  if (hasTools) {
    body.tools        = tools;
    body.tool_choice  = toolChoice ?? "auto";
  } else if (opts.responseFormat) {
    // tools and response_format are mutually exclusive on DeepSeek (same as Groq).
    body.response_format = opts.responseFormat;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) onAbort();
  else signal?.addEventListener("abort", onAbort, { once: true });

  let response: Response;
  try {
    response = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body:   JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
    if (controller.signal.aborted) {
      throw new GroqClientError("TIMEOUT", "DeepSeek request timed out", { cause: err });
    }
    throw new GroqClientError(
      "NETWORK_ERROR",
      err instanceof Error ? err.message : "Network error contacting DeepSeek",
      { cause: err },
    );
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
    throw classifyStatus(response.status, text);
  }

  const data = await response.json() as {
    choices: Array<{
      message?: { content?: string | null; tool_calls?: unknown };
    }>;
    model:  string;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  clearTimeout(timer);
  signal?.removeEventListener("abort", onAbort);

  const msg = data.choices[0]?.message;
  if (!msg) {
    throw new GroqClientError("EMPTY_RESPONSE", "DeepSeek returned an empty response");
  }

  // Strip <think> tokens from DeepSeek-R1; safe no-op for DeepSeek-V3.
  const content   = stripThink(msg.content ?? null);
  const rawToolCalls: unknown = msg.tool_calls;
  const hasCalls  = Array.isArray(rawToolCalls) && rawToolCalls.length > 0;

  if (!content && !hasCalls) {
    if (rawToolCalls !== undefined) {
      normalizeProviderToolCalls(rawToolCalls, {
        tools,
        toolManifest: opts.toolManifest,
        providerName: "DeepSeek",
        model,
      });
    }
    throw new GroqClientError("EMPTY_RESPONSE", "DeepSeek returned neither content nor tool calls");
  }

  return normalizeProviderResponse({
    content,
    toolCalls: rawToolCalls === undefined ? null : rawToolCalls as ToolCall[],
    model:  data.model,
    usage: {
      promptTokens:       data.usage?.prompt_tokens  ?? 0,
      completionTokens:   data.usage?.completion_tokens ?? 0,
    },
  }, { tools, toolManifest: opts.toolManifest, providerName: "DeepSeek", model });
}
