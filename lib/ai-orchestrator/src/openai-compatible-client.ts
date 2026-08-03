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
 *
 * PR-001: default model derived from FREE_MODELS[0] — no hardcoded string.
 * PR-003: 410 and 422 treated as MODEL_UNAVAILABLE (fallback-worthy).
 * PR-007: GroqClientError carries providerStatus/providerCode/providerMessage.
 * PR-008: QUOTA code for billing exhaustion; MODEL_UNAVAILABLE for 410/422.
 */
import type { RawMessage, ToolDefinition, ToolCall, RawGroqResponse } from "./groq-client.js";
import { GroqClientError } from "./errors.js";
import { buildFallbackChainFromId, resolveFallbackChain } from "./openrouter/model-resolver.js";
import { FREE_MODELS, type ModelCapability } from "./openrouter/model-catalog.js";

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

// PR-001: safe fallback — derived at module load from the static catalog so
// no model string is ever hardcoded in this file.
const FALLBACK_DEFAULT_MODEL: string =
  FREE_MODELS.find((m) => m.quality === "fast")?.id ??
  "meta-llama/llama-3.1-8b-instruct:free";

// ── OpenRouter free-tier helpers ──────────────────────────────────────────────

/**
 * OR-003: Conservative token cap for OpenRouter free-tier requests.
 * Free models have tight per-request output limits; 2 048 keeps us well inside
 * them while still allowing meaningful responses.
 */
const OPENROUTER_DEFAULT_MAX_TOKENS = 2_048;

/**
 * OR-003: Maximum number of non-system messages forwarded to OpenRouter.
 * The system prompt is always kept; the most-recent messages are preferred.
 * Trimming reduces token consumption without hurting conversational coherence.
 */
const OPENROUTER_MAX_MESSAGES = 20;

/** Keep the system message and the most-recent `OPENROUTER_MAX_MESSAGES` turns. */
function trimMessagesForOpenRouter(messages: RawMessage[]): RawMessage[] {
  if (messages.length <= OPENROUTER_MAX_MESSAGES + 1) return messages;
  const [system, ...rest] = messages;
  const trimmed = rest.slice(-OPENROUTER_MAX_MESSAGES);
  return system ? [system, ...trimmed] : trimmed;
}

/** Resolve after `ms` milliseconds (used for retry back-off). */
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * OR-005: True for transient OpenRouter errors that warrant a single retry.
 * User errors (AUTH_ERROR, NON_200) and empty responses are not retried.
 */
function isTransientError(err: unknown): err is GroqClientError {
  return (
    err instanceof GroqClientError &&
    (err.code === "RATE_LIMITED" ||
      err.code === "SERVER_ERROR" ||
      err.code === "TIMEOUT" ||
      err.code === "NETWORK_ERROR")
  );
}

/**
 * PR-003 / PR-004 / PR-008: true for errors that indicate the model itself is
 * unusable and the fallback engine should advance to the next candidate.
 * Includes MODEL_NOT_FOUND (removed), PLAN_RESTRICTED (free-tier), and
 * MODEL_UNAVAILABLE (temporarily offline — 422/410).
 */
function isModelUnavailableError(err: unknown): err is GroqClientError {
  return (
    err instanceof GroqClientError &&
    (err.code === "MODEL_NOT_FOUND" ||
      err.code === "PLAN_RESTRICTED" ||
      err.code === "MODEL_UNAVAILABLE")
  );
}

/**
 * PR-007 / PR-008: extract a structured error code and message from a provider
 * response body string. Returns { code, message } where code is the provider's
 * own error tag (e.g. "model_not_found") and message is the human text.
 */
function extractProviderError(body: string): { code?: string; message?: string } {
  try {
    const parsed = JSON.parse(body) as {
      error?: { code?: string; message?: string; type?: string } | string;
      message?: string;
    };
    if (typeof parsed.error === "object" && parsed.error !== null) {
      return {
        code:    parsed.error.code ?? parsed.error.type,
        message: parsed.error.message,
      };
    }
    if (typeof parsed.error === "string") {
      return { message: parsed.error };
    }
    if (typeof parsed.message === "string") {
      return { message: parsed.message };
    }
  } catch {
    // not JSON
  }
  return {};
}

/** PR-007/PR-008: Map HTTP status → GroqClientError with full provider context. */
function classifyStatus(
  status: number,
  body: string,
  providerName: string,
  model?: string,
): GroqClientError {
  const { code: pCode, message: pMessage } = extractProviderError(body);
  const ctx = {
    providerStatus:  status,
    providerCode:    pCode,
    providerMessage: pMessage ?? body.slice(0, 200),
    providerName,
    providerModel:   model,
  };

  if (status === 401 || status === 403) {
    return new GroqClientError(
      "AUTH_ERROR",
      `${providerName} API authentication failed (${status}) — check your API key`,
      { context: ctx },
    );
  }

  if (status === 429) {
    // PR-008: distinguish QUOTA (credits exhausted) from RATE_LIMITED (per-minute).
    const bodyLower = body.toLowerCase();
    if (
      bodyLower.includes("quota") ||
      bodyLower.includes("credits") ||
      bodyLower.includes("billing") ||
      bodyLower.includes("insufficient")
    ) {
      return new GroqClientError(
        "QUOTA",
        `${providerName} billing quota or credits exhausted (${status}) — check your account`,
        { context: ctx },
      );
    }
    return new GroqClientError(
      "RATE_LIMITED",
      `${providerName} API rate limit exceeded — wait a moment before retrying`,
      { context: ctx },
    );
  }

  if (status >= 500) {
    return new GroqClientError(
      "SERVER_ERROR",
      `${providerName} API server error (${status}): ${body.slice(0, 200)}`,
      { context: ctx },
    );
  }

  const normalizedBody = body.toLowerCase();
  const looksLikeMissingModel =
    normalizedBody.includes("not a valid model id") ||
    normalizedBody.includes("invalid model id") ||
    normalizedBody.includes("unknown model") ||
    normalizedBody.includes("model not found") ||
    normalizedBody.includes("model unavailable") ||
    normalizedBody.includes("unavailable for free") ||
    normalizedBody.includes("no endpoints") ||
    (pCode !== undefined && (
      pCode.includes("model_not_found") ||
      pCode.includes("invalid_model") ||
      pCode.includes("model_unavailable")
    ));

  // PR-004: distinguish removed models (404) from plan-restricted (402).
  //   404 — model permanently discontinued / removed.
  //   402 — model requires a paid plan or the free quota is exhausted.
  //   400 — invalid model slug (body confirms it's a model error).
  if (providerName === "OpenRouter" && status === 404) {
    return new GroqClientError(
      "MODEL_NOT_FOUND",
      `OpenRouter model not found (404) — the model has been discontinued or removed. ${body.slice(0, 200)}`,
      { context: ctx },
    );
  }

  if (providerName === "OpenRouter" && status === 402) {
    return new GroqClientError(
      "PLAN_RESTRICTED",
      `OpenRouter model requires a paid plan or free-tier credit balance (402). ${body.slice(0, 200)}`,
      { context: ctx },
    );
  }

  if (providerName === "OpenRouter" && status === 400 && looksLikeMissingModel) {
    return new GroqClientError(
      "MODEL_NOT_FOUND",
      `OpenRouter rejected the model slug (400) — the model ID may be invalid. ${body.slice(0, 200)}`,
      { context: ctx },
    );
  }

  // PR-003 / PR-008: 410 Gone = model retired; 422 Unprocessable = model
  // temporarily offline or being retired. Both are MODEL_UNAVAILABLE (not
  // MODEL_NOT_FOUND) — the distinction is useful for dashboards (temporary
  // vs. permanent), but both are fallback-worthy.
  if (
    providerName === "OpenRouter" &&
    (status === 410 || status === 422)
  ) {
    return new GroqClientError(
      "MODEL_UNAVAILABLE",
      `OpenRouter model unavailable (${status}) — the model is temporarily offline or being retired. ${body.slice(0, 200)}`,
      { context: ctx },
    );
  }

  return new GroqClientError(
    "NON_200",
    `${providerName} API responded with status ${status}: ${body.slice(0, 200)}`,
    { context: ctx },
  );
}

// ── XML tool-call helpers ─────────────────────────────────────────────────────
// Some free models (e.g. InclusionAI Ling) output tool calls as XML text in
// their content field instead of (or in addition to) the standard OpenAI
// `tool_calls` JSON array.  These helpers normalise both cases so the rest of
// the codebase never sees raw XML.

/** Strip all <tool_call>…</tool_call> blocks from a content string. */
function stripXmlToolCalls(text: string): string {
  return text.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, "").trim();
}

/**
 * Attempt to parse XML-style tool calls from content.
 * Handles two common formats:
 *   1. JSON inside tags:  <tool_call>{"name":"fn","arguments":{…}}</tool_call>
 *   2. Attribute syntax:  <tool_call> <function=fn> <parameter=k>v</parameter> </function> </tool_call>
 * Returns null when the content contains no recognisable tool-call XML.
 */
function parseXmlToolCalls(content: string): ToolCall[] | null {
  const blocks = [...content.matchAll(/<tool_call>([\s\S]*?)<\/tool_call>/g)];
  if (blocks.length === 0) return null;

  const calls: ToolCall[] = [];
  for (const [, inner] of blocks) {
    const trimmed = inner.trim();

    // Format 1 — JSON inside <tool_call>
    if (trimmed.startsWith("{")) {
      try {
        const parsed = JSON.parse(trimmed) as { name?: string; arguments?: unknown };
        if (parsed.name) {
          calls.push({
            id: `xml_${Math.random().toString(36).slice(2, 9)}`,
            type: "function",
            function: {
              name: parsed.name,
              arguments: JSON.stringify(parsed.arguments ?? {}),
            },
          });
        }
      } catch { /* ignore malformed JSON */ }
      continue;
    }

    // Format 2 — attribute syntax  <function=NAME> <parameter=KEY>VALUE</parameter>
    const fnMatch = trimmed.match(/<function=([^\s>]+)/);
    if (!fnMatch) continue;
    const fnName = fnMatch[1];

    const args: Record<string, string> = {};
    for (const [, key, val] of trimmed.matchAll(/<parameter=([^\s>]+)>([\s\S]*?)<\/parameter>/g)) {
      args[key] = val.trim();
    }
    calls.push({
      id: `xml_${Math.random().toString(36).slice(2, 9)}`,
      type: "function",
      function: { name: fnName, arguments: JSON.stringify(args) },
    });
  }
  return calls.length > 0 ? calls : null;
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
    model = FALLBACK_DEFAULT_MODEL,  // PR-001: no hardcoded string
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

  const isGemini = providerName === "Gemini";
  const hasTools = !isGemini && Array.isArray(tools) && tools.length > 0;
  if (hasTools) {
    body.tools = tools;
    body.tool_choice = "auto";
  } else if (!isGemini && opts.responseFormat) {
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
    throw classifyStatus(response.status, text, providerName, model);
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

  let content = msg.content ?? null;
  let hasCalls = Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0;
  let toolCalls: ToolCall[] | null = hasCalls ? (msg.tool_calls as ToolCall[]) : null;

  // Some free models (e.g. Ling-3.0-flash) embed tool calls as XML text in
  // content instead of using the standard tool_calls JSON field.
  if (content && content.includes("<tool_call>")) {
    if (!hasCalls) {
      const xmlCalls = parseXmlToolCalls(content);
      if (xmlCalls) {
        toolCalls = xmlCalls;
        hasCalls = true;
      }
    }
    content = stripXmlToolCalls(content) || null;
  }

  if (!content && !hasCalls) {
    throw new GroqClientError(
      "EMPTY_RESPONSE",
      `${providerName} returned neither content nor tool calls`,
    );
  }

  return {
    content,
    toolCalls,
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
    model = FALLBACK_DEFAULT_MODEL,  // PR-001: no hardcoded string
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
    throw classifyStatus(response.status, text, providerName, model);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    clearTimeout(timer);
    throw new GroqClientError("EMPTY_RESPONSE", `${providerName} stream has no body`);
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let hadContent = false;
  let xmlStreamBuf = "";

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
            xmlStreamBuf += delta;
          }
        } catch {
          // Ignore malformed SSE frames.
        }
      }

      // Flush safe prefix — everything before any open <tool_call> tag.
      const openIdx = xmlStreamBuf.indexOf("<tool_call>");
      const closeIdx = xmlStreamBuf.indexOf("</tool_call>");
      if (openIdx === -1) {
        if (xmlStreamBuf) { yield xmlStreamBuf; xmlStreamBuf = ""; }
      } else if (closeIdx !== -1 && closeIdx > openIdx) {
        const before = xmlStreamBuf.slice(0, openIdx);
        const after  = xmlStreamBuf.slice(closeIdx + "</tool_call>".length);
        xmlStreamBuf = after;
        if (before) yield before;
      } else {
        const before = xmlStreamBuf.slice(0, openIdx);
        xmlStreamBuf = xmlStreamBuf.slice(openIdx);
        if (before) yield before;
      }
    }
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }

  if (xmlStreamBuf) {
    const clean = stripXmlToolCalls(xmlStreamBuf);
    if (clean) yield clean;
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
 *
 * OR-003: trims context to `OPENROUTER_MAX_MESSAGES` non-system turns and
 *         defaults `maxTokens` to `OPENROUTER_DEFAULT_MAX_TOKENS` (2 048).
 * OR-005: retries once (after 1.5 s back-off) on transient errors (429, 5xx,
 *         timeout, network) before propagating — avoids needless provider
 *         fallback for brief free-tier blips.
 */
export async function openrouterCompleteRaw(
  messages: RawMessage[],
  opts: Omit<OpenAICompatibleOptions, "baseUrl" | "providerName" | "extraHeaders">,
): Promise<RawGroqResponse> {
  const trimmed = trimMessagesForOpenRouter(messages);
  const fullOpts: OpenAICompatibleOptions = {
    maxTokens: OPENROUTER_DEFAULT_MAX_TOKENS,
    ...opts,
    baseUrl: OPENROUTER_BASE_URL,
    providerName: "OpenRouter",
    extraHeaders: OPENROUTER_EXTRA_HEADERS,
  };

  try {
    return await oacCompleteRaw(trimmed, fullOpts);
  } catch (err) {
    if (!isTransientError(err)) throw err;
    console.warn(
      JSON.stringify({
        scope: "openrouter-client",
        code: "TRANSIENT_RETRY",
        errorCode: err.code,
        backoffMs: 1500,
      }),
    );
    await sleep(1500);
    return oacCompleteRaw(trimmed, fullOpts);
  }
}

/**
 * Extended options for openrouterCompleteWithFallback.
 *
 * RC-04: when `model` is not provided, the resolver uses `quality` and
 * `capability` to pick the best currently-free model from the live catalog.
 * This avoids baking in a static model ID at call-site setup time (which would
 * be stale by the time the first catalog refresh completes).
 */
export type OpenRouterFallbackOptions = Omit<
  OpenAICompatibleOptions,
  "baseUrl" | "providerName" | "extraHeaders"
> & {
  /** RC-04: quality tier hint used when `model` is undefined. Defaults to "fast". */
  quality?: "fast" | "powerful";
  /** RC-04: capability hint used when `model` is undefined. Defaults to "chat". */
  capability?: ModelCapability;
};

/**
 * Non-streaming completion via OpenRouter with automatic free-model fallback
 * (STORY-03).
 *
 * PR-003: MODEL_UNAVAILABLE (410/422) is now also fallback-worthy in addition
 * to MODEL_NOT_FOUND (404/402/400).
 *
 * RC-04: when `model` is not provided, resolves the best available free model
 * from the live catalog at call time using the `quality` + `capability` hints.
 */
export async function openrouterCompleteWithFallback(
  messages: RawMessage[],
  opts: OpenRouterFallbackOptions,
): Promise<RawGroqResponse> {
  const initialModel = opts.model;

  // RC-04 / PR-01: when no model is specified, use the resolver to build a full
  // fallback chain from the live free-tier catalog at call time.
  // `quality` and `capability` let callers express intent (e.g. "powerful" for
  // code-review) without hardcoding a specific model ID that may become stale.
  const chain = initialModel
    ? buildFallbackChainFromId(initialModel)
    : resolveFallbackChain({
        capability: opts.capability ?? "chat",
        quality:    opts.quality    ?? "fast",
        requireTools: !!(opts.tools?.length),
      }).map((m) => m.id);
  let lastError: GroqClientError | undefined;

  for (let i = 0; i < chain.length; i++) {
    const model = chain[i] as string;
    try {
      return await openrouterCompleteRaw(messages, { ...opts, model });
    } catch (err) {
      // PR-003: treat MODEL_UNAVAILABLE (422/410) the same as MODEL_NOT_FOUND
      if (isModelUnavailableError(err) && i < chain.length - 1) {
        const nextModel = chain[i + 1] as string;
        console.warn(
          JSON.stringify({
            scope: "openrouter-fallback",
            code: "MODEL_FALLBACK",
            reason: err.code,
            failedModel: model,
            nextModel,
            providerStatus: err.providerStatus,
            attempt: i + 1,
            remaining: chain.length - i - 1,
          }),
        );
        lastError = err;
        continue;
      }
      throw err;
    }
  }

  throw lastError ??
    new GroqClientError("MODEL_NOT_FOUND", "All OpenRouter free-tier fallback models exhausted");
}

/**
 * Streaming completion via OpenRouter.
 *
 * OR-003: same context trim and conservative maxTokens as `openrouterCompleteRaw`.
 * OR-005: retries the stream once on transient errors.
 */
export async function* openrouterCompleteStream(
  messages: RawMessage[],
  opts: Omit<OpenAICompatibleStreamOptions, "baseUrl" | "providerName" | "extraHeaders">,
): AsyncGenerator<string> {
  const trimmed = trimMessagesForOpenRouter(messages);
  const fullOpts: OpenAICompatibleStreamOptions = {
    maxTokens: OPENROUTER_DEFAULT_MAX_TOKENS,
    ...opts,
    baseUrl: OPENROUTER_BASE_URL,
    providerName: "OpenRouter",
    extraHeaders: OPENROUTER_EXTRA_HEADERS,
  };

  try {
    yield* oacCompleteStream(trimmed, fullOpts);
  } catch (err) {
    if (!isTransientError(err)) throw err;
    console.warn(
      JSON.stringify({
        scope: "openrouter-client",
        code: "TRANSIENT_STREAM_RETRY",
        errorCode: err.code,
        backoffMs: 1500,
      }),
    );
    await sleep(1500);
    yield* oacCompleteStream(trimmed, fullOpts);
  }
}

// ── Pre-built Gemini client functions ─────────────────────────────────────────

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";

/**
 * Non-streaming completion via Google Gemini (OpenAI-compatible endpoint).
 * Free tier: 15 RPM / 1,500 RPD / 1M TPD on gemini-2.0-flash-lite.
 */
export function geminiCompleteRaw(
  messages: RawMessage[],
  opts: Omit<OpenAICompatibleOptions, "baseUrl" | "providerName" | "extraHeaders">,
): Promise<RawGroqResponse> {
  const { tools: _tools, responseFormat: _responseFormat, ...safeOpts } = opts;
  return oacCompleteRaw(messages, {
    ...safeOpts,
    baseUrl: GEMINI_BASE_URL,
    providerName: "Gemini",
  });
}

/**
 * Streaming completion via Google Gemini (OpenAI-compatible endpoint).
 */
export function geminiCompleteStream(
  messages: RawMessage[],
  opts: Omit<OpenAICompatibleStreamOptions, "baseUrl" | "providerName" | "extraHeaders">,
): AsyncGenerator<string> {
  const { tools: _tools, responseFormat: _responseFormat, ...safeOpts } =
    opts as OpenAICompatibleOptions & { tools?: unknown; responseFormat?: unknown };
  return oacCompleteStream(messages, {
    ...safeOpts,
    baseUrl: GEMINI_BASE_URL,
    providerName: "Gemini",
  });
}
