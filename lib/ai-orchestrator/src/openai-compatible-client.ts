/**
 * Generic OpenAI-compatible HTTP client.
 *
 * Any provider that speaks POST /chat/completions with Bearer auth can be
 * driven through this module by supplying a baseUrl and optional extra headers.
 * OpenRouter and DeepSeek are both wired up here; Groq continues to use the
 * groq-sdk client (which adds circuit-breaking and retry-with-backoff on top).
 *
 * The returned types (`RawGroqResponse`) are intentionally identical to those
 * produced by groq-client.ts so chat-agent.ts and agent-complete.ts can route
 * between providers with a single `provider` string — no per-provider branches
 * in every call site.
 */
import type { RawMessage, ToolDefinition, ToolCall, RawGroqResponse } from "./groq-client.js";
import { GroqClientError } from "./errors.js";

export type OpenAICompatibleOptions = {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  /** Bearer API key — required. */
  apiKey: string;
  tools?: ToolDefinition[];
  responseFormat?: { type: "json_object" };
  /** Override base URL (e.g. "https://openrouter.ai/api/v1"). */
  baseUrl: string;
  /** Provider name used in error messages (e.g. "OpenRouter"). */
  providerName: string;
  /** Extra HTTP headers (e.g. X-Title for OpenRouter). */
  extraHeaders?: Record<string, string>;
};

export type OpenAICompatibleStreamOptions = Omit<
  OpenAICompatibleOptions,
  "tools" | "responseFormat"
>;

const DEFAULT_TIMEOUT_MS = 60_000;

/** Map HTTP status → GroqClientError with a provider-aware message. */
function classifyStatus(
  status: number,
  body: string,
  providerName: string,
): GroqClientError {
  if (status === 401 || status === 403) {
    return new GroqClientError(
      "AUTH_ERROR",
      `${providerName} API authentication failed (${status}) — check your API key`,
    );
  }
  if (status === 429) {
    return new GroqClientError(
      "RATE_LIMITED",
      `${providerName} API rate limit exceeded — wait a moment before retrying`,
    );
  }
  if (status >= 500) {
    return new GroqClientError(
      "SERVER_ERROR",
      `${providerName} API server error (${status}): ${body.slice(0, 200)}`,
    );
  }
  return new GroqClientError(
    "NON_200",
    `${providerName} API responded with status ${status}: ${body.slice(0, 200)}`,
  );
}

/**
 * Non-streaming chat completion against any OpenAI-compatible endpoint.
 * Returns the same `RawGroqResponse` shape as groq-client's `completeRaw()`.
 */
export async function oacCompleteRaw(
  messages: RawMessage[],
  opts: OpenAICompatibleOptions,
): Promise<RawGroqResponse> {
  const {
    model = "deepseek/deepseek-v4-flash:free",
    temperature = 0.2,
    maxTokens = 4096,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    apiKey,
    tools,
    baseUrl,
    providerName,
    extraHeaders = {},
  } = opts;

  const body: Record<string, unknown> = {
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
  };

  const hasTools = Array.isArray(tools) && tools.length > 0;
  if (hasTools) {
    body.tools = tools;
    body.tool_choice = "auto";
  } else if (opts.responseFormat) {
    body.response_format = opts.responseFormat;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        ...extraHeaders,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (controller.signal.aborted) {
      throw new GroqClientError("TIMEOUT", `${providerName} request timed out`, { cause: err });
    }
    throw new GroqClientError(
      "NETWORK_ERROR",
      err instanceof Error ? err.message : `Network error contacting ${providerName}`,
      { cause: err },
    );
  }
  clearTimeout(timer);

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw classifyStatus(response.status, text, providerName);
  }

  const data = (await response.json()) as {
    choices: Array<{
      message?: { content?: string | null; tool_calls?: ToolCall[] };
    }>;
    model: string;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  const msg = data.choices[0]?.message;
  if (!msg) {
    throw new GroqClientError("EMPTY_RESPONSE", `${providerName} returned an empty response`);
  }

  const content = msg.content ?? null;
  const hasCalls = Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0;

  if (!content && !hasCalls) {
    throw new GroqClientError(
      "EMPTY_RESPONSE",
      `${providerName} returned neither content nor tool calls`,
    );
  }

  return {
    content,
    toolCalls: hasCalls ? (msg.tool_calls as ToolCall[]) : null,
    model: data.model,
    usage: {
      promptTokens: data.usage?.prompt_tokens ?? 0,
      completionTokens: data.usage?.completion_tokens ?? 0,
    },
  };
}

/**
 * Streaming chat completion against any OpenAI-compatible endpoint.
 * Yields content deltas in the same way as groq-client's `completeStream()`.
 */
export async function* oacCompleteStream(
  messages: RawMessage[],
  opts: OpenAICompatibleStreamOptions,
): AsyncGenerator<string> {
  const {
    model = "deepseek/deepseek-v4-flash:free",
    temperature = 0.2,
    maxTokens = 4096,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    apiKey,
    baseUrl,
    providerName,
    extraHeaders = {},
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

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        ...extraHeaders,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (controller.signal.aborted) {
      throw new GroqClientError("TIMEOUT", `${providerName} streaming request timed out`, { cause: err });
    }
    throw new GroqClientError(
      "NETWORK_ERROR",
      err instanceof Error ? err.message : `Network error contacting ${providerName}`,
      { cause: err },
    );
  }

  if (!response.ok) {
    clearTimeout(timer);
    const text = await response.text().catch(() => "");
    throw classifyStatus(response.status, text, providerName);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    clearTimeout(timer);
    throw new GroqClientError("EMPTY_RESPONSE", `${providerName} stream has no body`);
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let hadContent = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
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
            yield delta;
          }
        } catch {
          // Ignore malformed SSE frames.
        }
      }
    }
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }

  if (!hadContent) {
    throw new GroqClientError("EMPTY_RESPONSE", `${providerName} stream returned no content`);
  }
}

// ── Pre-built OpenRouter client functions ─────────────────────────────────────

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const OPENROUTER_EXTRA_HEADERS = { "X-Title": "EngineeringOS" };

/**
 * Non-streaming completion via OpenRouter.
 * Signature matches deepseek-client's `deepseekCompleteRaw()` so chat-agent.ts
 * can select the correct function with a single `provider === "openrouter"` check.
 */
export function openrouterCompleteRaw(
  messages: RawMessage[],
  opts: Omit<OpenAICompatibleOptions, "baseUrl" | "providerName" | "extraHeaders">,
): Promise<RawGroqResponse> {
  return oacCompleteRaw(messages, {
    ...opts,
    baseUrl: OPENROUTER_BASE_URL,
    providerName: "OpenRouter",
    extraHeaders: OPENROUTER_EXTRA_HEADERS,
  });
}

/**
 * Streaming completion via OpenRouter.
 * Signature matches deepseek-client's `deepseekCompleteStream()`.
 */
export function openrouterCompleteStream(
  messages: RawMessage[],
  opts: Omit<OpenAICompatibleStreamOptions, "baseUrl" | "providerName" | "extraHeaders">,
): AsyncGenerator<string> {
  return oacCompleteStream(messages, {
    ...opts,
    baseUrl: OPENROUTER_BASE_URL,
    providerName: "OpenRouter",
    extraHeaders: OPENROUTER_EXTRA_HEADERS,
  });
}
