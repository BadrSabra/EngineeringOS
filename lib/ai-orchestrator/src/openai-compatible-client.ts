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
import { GroqClientError, type GroqErrorCode } from "./errors.js";
import {
  buildFallbackChainFromId,
  isCatalogFreeModelForCapability,
  resolveFallbackChain,
} from "./openrouter/model-resolver.js";
import { getDynamicCatalogStatus } from "./openrouter/dynamic-catalog.js";
import { FREE_MODELS, type ModelCapability } from "./openrouter/model-catalog.js";
import type { TaskType } from "./quality/task-profile.js";
import type { ExecutionPhase } from "./quality/execution-phases.js";
import { getPhaseBudget } from "./quality/execution-phases.js";
import {
  createContentOnlyStreamGuard,
  normalizeProviderResponse,
} from "./provider-tool-calls.js";

export type OpenAICompatibleOptions = {
  model?: string;
  taskType?: TaskType;
  temperature?: number;
  maxTokens?: number;
  /** Selects a bounded output contract when maxTokens is not supplied. */
  outputPhase?: ExecutionPhase;
  timeoutMs?: number;
  /** Disable transient retry when the caller owns bounded model fallback. */
  retryTransient?: boolean;
  /** Cap provider-owned fallback candidates for bounded callers. */
  maxFallbackModels?: number;
  /** Bearer API key — required. */
  apiKey: string;
  tools?: ToolDefinition[];
  /** Full authorized execution manifest; omitted for no-tool synthesis calls. */
  toolManifest?: ToolDefinition[];
  toolChoice?: "auto" | "required";
  responseFormat?: { type: "json_object" };
  /** Override base URL (e.g. "https://openrouter.ai/api/v1"). */
  baseUrl: string;
  /** Provider name used in error messages (e.g. "OpenRouter"). */
  providerName: string;
  /** Extra HTTP headers (e.g. X-Title for OpenRouter). */
  extraHeaders?: Record<string, string>;
  /** Abort the active provider request when the caller cancels execution. */
  signal?: AbortSignal;
};

export type OpenAICompatibleStreamOptions = Omit<
  OpenAICompatibleOptions,
  "tools" | "responseFormat"
> & {
  quality?: "fast" | "powerful";
  capability?: ModelCapability;
};

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

/**
 * An atomic message group:
 *   - "single"     — a user, system, or assistant-without-tool-calls message.
 *   - "tool_group" — an assistant turn that requested tool calls plus ALL of
 *                    the immediately following tool-result messages that belong
 *                    to it.  This group is never split: it is either kept whole
 *                    or dropped whole.
 */
type MessageGroup =
  | { kind: "single";     message:  RawMessage }
  | { kind: "tool_group"; messages: RawMessage[] };

/**
 * Partition a flat message array into atomic groups.
 *
 * Walking forward:
 *   - An assistant message that carries `tool_calls` opens a tool_group and
 *     greedily absorbs the immediately following `tool` role messages whose
 *     `tool_call_id` is in that assistant turn's declared IDs.
 *   - Everything else becomes a "single" group.
 *
 * The result lets the trimmer drop or keep complete groups so the conversation
 * reaching the model is always structurally valid.
 */
function groupMessages(messages: RawMessage[]): MessageGroup[] {
  const groups: MessageGroup[] = [];
  let i = 0;

  while (i < messages.length) {
    const m = messages[i];

    if (
      m.role === "assistant" &&
      Array.isArray(m.tool_calls) &&
      m.tool_calls.length > 0
    ) {
      // Collect the IDs this assistant turn declared.
      const declaredIds = new Set<string>(
        m.tool_calls.map((tc) => tc.id).filter((id): id is string => !!id),
      );

      // Greedily absorb the immediately following tool-result messages.
      const groupMsgs: RawMessage[] = [m];
      let j = i + 1;
      while (j < messages.length && messages[j].role === "tool") {
        const toolMsg = messages[j] as { role: "tool"; tool_call_id?: string };
        if (toolMsg.tool_call_id && declaredIds.has(toolMsg.tool_call_id)) {
          groupMsgs.push(messages[j]);
          j++;
        } else {
          break; // tool result belongs to a different (later) assistant turn
        }
      }

      groups.push({ kind: "tool_group", messages: groupMsgs });
      i = j;
    } else {
      groups.push({ kind: "single", message: m });
      i++;
    }
  }

  return groups;
}

/**
 * Remove structurally invalid messages before sending to strict
 * OpenAI-compatible providers. A provider may return an empty assistant turn
 * after a tool loop; replaying that turn during synthesis/recovery produces a
 * 400 even when the context is below the trimming limit. Tool results are
 * retained only when they belong to the immediately preceding assistant
 * tool-call turn.
 */
function sanitizeOutboundMessages(messages: RawMessage[]): RawMessage[] {
  const sanitized: RawMessage[] = [];
  let activeToolCallIds = new Set<string>();

  for (const message of messages) {
    if (message.role === "assistant") {
      const hasContent =
        typeof message.content === "string" && message.content.trim().length > 0;
      const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];

      if (!hasContent && toolCalls.length === 0) {
        activeToolCallIds = new Set<string>();
        continue;
      }

      activeToolCallIds = new Set(
        toolCalls
          .map((toolCall) => toolCall.id)
          .filter((id): id is string => Boolean(id)),
      );
      sanitized.push(message);
      continue;
    }

    if (message.role === "tool") {
      const toolCallId = message.tool_call_id;
      if (toolCallId && !activeToolCallIds.has(toolCallId)) continue;
      sanitized.push(message);
      continue;
    }

    activeToolCallIds = new Set<string>();
    sanitized.push(message);
  }

  return sanitized;
}

/**
 * Keep the system message and enough of the most-recent message groups to
 * stay within `OPENROUTER_MAX_MESSAGES` non-system messages.
 *
 * Groups are kept or dropped atomically: an assistant turn that requested
 * tool calls is always sent together with all of its tool-result messages, or
 * not at all.  This prevents Cohere and other strict providers from receiving
 * a `tool` message whose `tool_call_id` has no matching entry in a preceding
 * assistant turn — the structural violation that causes HTTP 400 responses.
 *
 * Overflow policy: a tool_group whose size exceeds the remaining budget is
 * discarded in full (along with all earlier groups).  The outbound message
 * count is always ≤ OPENROUTER_MAX_MESSAGES non-system messages, which keeps
 * the request within typical provider context-window limits.  The result may
 * be just [systemMsg] if all groups are oversized; this is structurally valid
 * and preferable to sending a request that will return HTTP 400.
 */
function trimMessagesForOpenRouter(messages: RawMessage[]): RawMessage[] {
  const sanitizedMessages = sanitizeOutboundMessages(messages);
  // Detect system message by role, not position, to handle callers that omit it.
  const systemMsg = sanitizedMessages[0]?.role === "system" ? sanitizedMessages[0] : null;
  const rest = systemMsg ? sanitizedMessages.slice(1) : sanitizedMessages;

  // Fast path: non-system portion already fits within the budget.
  if (rest.length <= OPENROUTER_MAX_MESSAGES) return sanitizedMessages;

  const groups = groupMessages(rest);

  // Walk from the end and accumulate whole groups until the budget is reached.
  // An oversized group (size > budget) is always discarded — we never exceed
  // OPENROUTER_MAX_MESSAGES even for groups that cannot be split.
  let budget = OPENROUTER_MAX_MESSAGES;
  let startIdx = groups.length; // nothing kept yet

  for (let i = groups.length - 1; i >= 0; i--) {
    // Store in a local so TypeScript can narrow the discriminated union.
    const group = groups[i];
    const size = group.kind === "tool_group" ? group.messages.length : 1;

    if (size <= budget) {
      budget -= size;
      startIdx = i;
    } else {
      break; // oversized or no remaining budget — drop this and all earlier groups
    }
  }

  const kept = groups
    .slice(startIdx)
    .flatMap((g): RawMessage[] =>
      g.kind === "tool_group" ? g.messages : [g.message],
    );

  return systemMsg ? [systemMsg, ...kept] : kept;
}

/**
 * @internal — exported for unit tests only.
 * Do not import this from application code.
 */
export const _trimMessagesForOpenRouter = trimMessagesForOpenRouter;

/**
 * @internal — exported for unit tests only.
 * Do not import this from application code.
 */
export const _groupMessages = groupMessages;

/** Resolve after `ms` milliseconds (used for retry back-off). */
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Return the value only when it is a real string; otherwise ignore it. */
function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

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

export type OpenRouterFailureAction =
  | "retry"
  | "choose-alternative"
  | "wait"
  | "narrow-request"
  | "stop-safely";

export type OpenRouterFailureDisposition = {
  action: OpenRouterFailureAction;
  terminal: boolean;
  evidenceStatus: "complete" | "incomplete";
};

/**
 * Stable, provider-free policy used by recovery callers and diagnostics.
 * Authentication/quota failures never consume a paid fallback, while an
 * empty or interrupted result can never be presented as a verified finding.
 */
export function classifyOpenRouterFailure(
  code: GroqErrorCode,
): OpenRouterFailureDisposition {
  switch (code) {
    case "RATE_LIMITED":
      return { action: "wait", terminal: false, evidenceStatus: "incomplete" };
    case "TIMEOUT":
    case "NETWORK_ERROR":
    case "SERVER_ERROR":
      return { action: "retry", terminal: false, evidenceStatus: "incomplete" };
    case "MODEL_NOT_FOUND":
    case "MODEL_UNAVAILABLE":
    case "PLAN_RESTRICTED":
    case "EMPTY_RESPONSE":
      return {
        action: "choose-alternative",
        terminal: false,
        evidenceStatus: "incomplete",
      };
    case "NON_200":
      return { action: "narrow-request", terminal: true, evidenceStatus: "incomplete" };
    case "AUTH_ERROR":
    case "QUOTA":
    case "INVALID_CONFIG":
    case "INVALID_TOOL_CALL":
      return { action: "stop-safely", terminal: true, evidenceStatus: "incomplete" };
  }
}

/**
 * PR-003 / PR-004 / PR-008: true for errors that indicate the model itself is
 * unusable and the fallback engine should advance to the next candidate.
 * Includes MODEL_NOT_FOUND (removed), PLAN_RESTRICTED (free-tier),
 * MODEL_UNAVAILABLE (temporarily offline — 422/410), and EMPTY_RESPONSE
 * (a model-specific silent completion).
 */
function isModelUnavailableError(err: unknown): err is GroqClientError {
  return (
    err instanceof GroqClientError &&
    (err.code === "MODEL_NOT_FOUND" ||
      err.code === "PLAN_RESTRICTED" ||
      err.code === "MODEL_UNAVAILABLE" ||
      err.code === "EMPTY_RESPONSE")
  );
}

/**
 * PR-007 / PR-008: extract a structured error code and message from a provider
 * response body string. Returns { code, message } where code is the provider's
 * own error tag (e.g. "model_not_found") and message is the human text.
 */
function extractProviderError(body: string): { code?: string; message?: string } {
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const error = parsed.error;

    if (typeof error === "object" && error !== null) {
      const errorObj = error as Record<string, unknown>;
      return {
        code:    asString(errorObj.code) ?? asString(errorObj.type),
        message: asString(errorObj.message),
      };
    }

    if (typeof error === "string") {
      return { message: error };
    }

    const message = parsed.message;
    if (typeof message === "string") {
      return { message };
    }
  } catch {
    // not JSON
  }
  return {};
}

/**
 * OpenRouter sometimes returns HTTP 400 for request-shape issues that are
 * recoverable by trying another model in the fallback chain — for example,
 * unsupported `response_format` / structured-output requests.
 */
function looksLikeRecoverableOpenRouterRequestError(body: string, providerCode?: string): boolean {
  const normalizedBody = body.toLowerCase();
  return (
    normalizedBody.includes("response_format") ||
    normalizedBody.includes("tool_choice") ||
    normalizedBody.includes("structured output") ||
    normalizedBody.includes("structured outputs") ||
    normalizedBody.includes("unsupported parameter") ||
    normalizedBody.includes("request parameter") ||
    normalizedBody.includes("invalid request") ||
    normalizedBody.includes("not supported") ||
    normalizedBody.includes("agent harness") ||
    normalizedBody.includes("requires an agent") ||
    normalizedBody.includes("only available through an agent") ||
    normalizedBody.includes("agent-only") ||
    normalizedBody.includes("agentic") ||
    (providerCode?.includes("invalid_request") ?? false) ||
    (providerCode?.includes("unsupported") ?? false)
  );
}

const MAX_RETRY_AFTER_MS = 60_000;

function parseRetryAfterMs(headers?: Headers): number | undefined {
  const value = headers?.get("retry-after")?.trim();
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, Math.ceil(seconds * 1000)));
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return undefined;
  return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, timestamp - Date.now()));
}

/** PR-007/PR-008: Map HTTP status → GroqClientError with full provider context. */
function classifyStatus(
  status: number,
  body: string,
  providerName: string,
  model?: string,
  headers?: Headers,
): GroqClientError {
  const { code: pCode, message: pMessage } = extractProviderError(body);
  const providerCode = asString(pCode);
  const ctx = {
    providerStatus:  status,
    providerCode,
    providerMessage: pMessage ?? body.slice(0, 200),
    providerName,
    providerModel:   model,
    retryAfterMs:    status === 429 ? parseRetryAfterMs(headers) : undefined,
  };

  // Log the classification decision so errors can be traced back to their root cause.
  console.warn(
    JSON.stringify({
      scope: "openai-compatible-client",
      action: "classify_status",
      providerName,
      model,
      providerStatus: status,
      providerCode,
      providerMessage: pMessage ?? null,
      bodyPreview: body.slice(0, 300),
    }),
  );

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
    (providerCode?.includes("model_not_found") ||
      providerCode?.includes("invalid_model") ||
      providerCode?.includes("model_unavailable"));

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
    const accountQuota =
      normalizedBody.includes("quota") ||
      normalizedBody.includes("credits exhausted") ||
      normalizedBody.includes("credit balance") ||
      normalizedBody.includes("insufficient funds") ||
      normalizedBody.includes("insufficient credits") ||
      normalizedBody.includes("balance is") ||
      normalizedBody.includes("account limit");
    if (accountQuota) {
      return new GroqClientError(
        "QUOTA",
        `OpenRouter account quota or credits exhausted (402) — stop safely and check your account`,
        { context: ctx },
      );
    }
    return new GroqClientError(
      "PLAN_RESTRICTED",
      `OpenRouter model requires a paid plan or free-tier credit balance (402). ${body.slice(0, 200)}`,
      { context: ctx },
    );
  }

  if (providerName === "OpenRouter" && status === 400) {
    if (looksLikeMissingModel) {
      return new GroqClientError(
        "MODEL_NOT_FOUND",
        `OpenRouter rejected the model slug (400) — the model ID may be invalid. ${body.slice(0, 200)}`,
        { context: ctx },
      );
    }

    if (
      normalizedBody.includes("unavailable for free") ||
      normalizedBody.includes("free tier") ||
      normalizedBody.includes("requires a paid plan") ||
      normalizedBody.includes("paid plan") ||
      normalizedBody.includes("credits") ||
      normalizedBody.includes("billing")
    ) {
      return new GroqClientError(
        "PLAN_RESTRICTED",
        `OpenRouter rejected the request because the selected model requires a paid plan or free-tier credits (400). ${body.slice(0, 200)}`,
        { context: ctx },
      );
    }

    if (looksLikeRecoverableOpenRouterRequestError(body, providerCode)) {
      return new GroqClientError(
        "MODEL_UNAVAILABLE",
        `OpenRouter rejected a request feature or parameter (400) — the selected model cannot satisfy this request shape. ${body.slice(0, 200)}`,
        { context: ctx },
      );
    }
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
    maxTokens = opts.outputPhase ? getPhaseBudget(opts.outputPhase).maxOutputTokens : 4096,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    apiKey,
    tools,
    baseUrl,
    providerName,
    extraHeaders = {},
    signal,
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
    body.tool_choice = opts.toolChoice ?? "auto";
  } else if (!isGemini && opts.responseFormat) {
    body.response_format = opts.responseFormat;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) onAbort();
  else signal?.addEventListener("abort", onAbort, { once: true });
  const cleanup = () => {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  };

  // Capture raw payload for diagnostics before the request is sent.
  console.info(
    JSON.stringify({
      scope: "openai-compatible-client",
      action: "pre_fetch",
      providerName,
      model,
      baseUrl,
      messageCount: messages.length,
      hasTools: hasTools,
      toolCount: hasTools && Array.isArray(tools) ? tools.length : 0,
      responseFormatRequested: opts.responseFormat?.type ?? null,
      responseFormatApplied: !hasTools && opts.responseFormat?.type
        ? opts.responseFormat.type
        : null,
      maxTokens,
      temperature,
    }),
  );

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
    cleanup();
    if (controller.signal.aborted) {
      throw new GroqClientError("TIMEOUT", `${providerName} request timed out`, {
        cause: err,
        context: { providerName, providerModel: model },
      });
    }
    throw new GroqClientError(
      "NETWORK_ERROR",
      err instanceof Error ? err.message : `Network error contacting ${providerName}`,
      { cause: err, context: { providerName, providerModel: model } },
    );
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    cleanup();
    // Log the raw response before classifying so we never lose context.
    console.warn(
      JSON.stringify({
        scope: "openai-compatible-client",
        action: "non_ok_response",
        providerName,
        model,
        status: response.status,
        bodyPreview: text.slice(0, 400),
      }),
    );
    throw classifyStatus(response.status, text, providerName, model, response.headers);
  }

  let data: {
    choices: Array<{
      finish_reason?: string | null;
      message?: {
        content?: string | null;
        tool_calls?: unknown;
        reasoning_content?: string | null;
        reasoning?: string | null;
      };
    }>;
    model: string;
    output_text?: string | null;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      reasoning_tokens?: number;
      completion_tokens_details?: { reasoning_tokens?: number };
    };
  };
  try {
    // Keep the request timer active until the response body has been fully
    // consumed. Fetch can resolve headers before a slow provider finishes
    // sending the JSON body.
    data = (await response.json()) as typeof data;
  } catch (err) {
    cleanup();
    if (controller.signal.aborted) {
      throw new GroqClientError("TIMEOUT", `${providerName} response body timed out`, {
        cause: err,
        context: { providerName, providerModel: model },
      });
    }
    throw err;
  }
  cleanup();

  const choice = data.choices[0];
  const msg = choice?.message;
  const outputText = data.output_text ?? null;
  if (!msg && !outputText) {
    throw new GroqClientError("EMPTY_RESPONSE", `${providerName} returned an empty response`, {
      context: { providerName, providerModel: model },
    });
  }

  let content = msg?.content ?? outputText;
  const reasoningContent = msg?.reasoning_content ?? msg?.reasoning ?? null;
  const reasoningTokens =
    data.usage?.reasoning_tokens ??
    data.usage?.completion_tokens_details?.reasoning_tokens;
  const normalized = normalizeProviderResponse(
    {
      content,
      toolCalls:
        msg?.tool_calls === undefined ? null : msg.tool_calls as ToolCall[],
      model: data.model,
      usage: {
        promptTokens: data.usage?.prompt_tokens ?? 0,
        completionTokens: data.usage?.completion_tokens ?? 0,
      },
      finishReason: choice?.finish_reason ?? null,
      reasoningContent,
      outputText,
      reasoningTokens,
    },
    { tools, toolManifest: opts.toolManifest, providerName, model },
  );
  content = normalized.content;
  const normalizedCalls = normalized.toolCalls ?? [];
  const toolCalls = normalizedCalls.length > 0 ? normalizedCalls : null;
  const hasCalls = toolCalls !== null;

  if (!content && !hasCalls) {
    throw new GroqClientError(
      "EMPTY_RESPONSE",
      `${providerName} returned neither content nor tool calls`,
      { context: { providerName, providerModel: model } },
    );
  }

  console.info(
    JSON.stringify({
      scope: "openai-compatible-client",
      action: "response_received",
      providerName,
      requestedModel: model,
      actualModel: data.model,
      finishReason: choice?.finish_reason ?? null,
      contentLength: content?.length ?? 0,
      outputTextLength: outputText?.length ?? 0,
      reasoningContentLength: reasoningContent?.length ?? 0,
      reasoningTokens: reasoningTokens ?? 0,
      hasToolCalls: hasCalls,
    }),
  );

  return { ...normalized, content, toolCalls };
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
  const cleanup = () => {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  };

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
    cleanup();
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
    const text = await response.text().catch(() => "");
    cleanup();
    throw classifyStatus(response.status, text, providerName, model, response.headers);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    cleanup();
    throw new GroqClientError("EMPTY_RESPONSE", `${providerName} stream has no body`);
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let hadContent = false;
  const streamGuard = createContentOnlyStreamGuard({ providerName, model });

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
  } catch (err) {
    if (err instanceof GroqClientError) throw err;
    if (controller.signal.aborted) {
      throw new GroqClientError("TIMEOUT", `${providerName} streaming response timed out`, {
        cause: err,
        context: { providerName, providerModel: model },
      });
    }
    throw new GroqClientError(
      "NETWORK_ERROR",
      err instanceof Error ? err.message : `Network error reading ${providerName} stream`,
      { cause: err, context: { providerName, providerModel: model } },
    );
  } finally {
    cleanup();
    reader.releaseLock();
  }

  for (const safeText of streamGuard.finish()) yield safeText;

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
    // OpenRouter-compatible models do not all implement JSON mode consistently.
    // A 400 caused by response_format must not consume the whole Recovery chain:
    // retry the same model once with the prompt-only contract.
    if (
      fullOpts.responseFormat &&
      err instanceof GroqClientError &&
      (err.code === "NON_200" || err.code === "MODEL_UNAVAILABLE") &&
      err.providerStatus === 400
    ) {
      console.warn(
        JSON.stringify({
          scope: "openrouter-client",
          code: "JSON_MODE_UNSUPPORTED",
          model: fullOpts.model,
          action: "retry_without_response_format",
        }),
      );
      return oacCompleteRaw(trimmed, { ...fullOpts, responseFormat: undefined });
    }
    if (
      err instanceof GroqClientError &&
      err.code === "RATE_LIMITED" &&
      err.retryAfterMs !== undefined
    ) {
      throw err;
    }
    if (!isTransientError(err) || opts.retryTransient === false) throw err;
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
  /** Execution-plan tool contract, including calls with tools supplied later. */
  requireTools?: boolean;
};

/**
 * Non-streaming completion via OpenRouter with automatic free-model fallback
 * (STORY-03).
 *
 * PR-003: MODEL_UNAVAILABLE (410/422) is now also fallback-worthy in addition
 * to MODEL_NOT_FOUND (404/402/400). EMPTY_RESPONSE is also fallback-worthy
 * because a silent completion identifies an unusable model candidate, not the
 * whole OpenRouter provider.
 *
 * RC-04: when `model` is not provided, resolves the best available free model
 * from the live catalog at call time using the `quality` + `capability` hints.
 */
export async function openrouterCompleteWithFallback(
  messages: RawMessage[],
  opts: OpenRouterFallbackOptions,
): Promise<RawGroqResponse> {
  const initialModel = opts.model;
  const capability = opts.capability ?? "chat";
  const requireTools = opts.requireTools ?? !!(opts.tools?.length);
  const knownInitialModel = initialModel
    ? FREE_MODELS.some((candidate) => candidate.id === initialModel)
    : true;
  if (initialModel && !knownInitialModel) {
    throw new GroqClientError(
      "INVALID_CONFIG",
      `OpenRouter configured model is not a known free catalog model: ${initialModel}`,
      { context: { providerName: "OpenRouter", providerModel: initialModel, providerCode: "STALE_CONFIGURED_MODEL" } },
    );
  }

  // RC-04 / PR-01: when no model is specified, use the resolver to build a full
  // fallback chain from the live free-tier catalog at call time.
  // `quality` and `capability` let callers express intent (e.g. "powerful" for
  // code-review) without hardcoding a specific model ID that may become stale.
  const resolvedChain = initialModel
    ? buildFallbackChainFromId(initialModel, opts.taskType, { capability, requireTools })
    : resolveFallbackChain({
        capability,
        quality:    opts.quality    ?? "fast",
        requireTools,
         taskType: opts.taskType,
      }).map((m) => m.id);
  if (initialModel && resolvedChain.length === 0) {
    const catalog = getDynamicCatalogStatus();
    throw new GroqClientError(
      "INVALID_CONFIG",
      `OpenRouter model ${initialModel} does not satisfy capability="${capability}" in the current catalog`,
      {
        context: {
          providerName: "OpenRouter",
          providerModel: initialModel,
          providerCode: "MODEL_CAPABILITY_MISMATCH",
          catalogLoaded: catalog.loaded,
          catalogUsable: catalog.usable,
          catalogStatus: catalog.lastRefreshStatus,
          catalogError: catalog.lastRefreshError ?? undefined,
        },
      },
    );
  }
  const maxFallbackModels =
    Number.isInteger(opts.maxFallbackModels) && opts.maxFallbackModels! > 0
      ? opts.maxFallbackModels
      : undefined;
  const chain = maxFallbackModels
    ? resolvedChain.slice(0, maxFallbackModels)
    : resolvedChain;
  if (maxFallbackModels && resolvedChain.length > chain.length) {
    console.info(
      JSON.stringify({
        scope: "openrouter-fallback",
        code: "FALLBACK_CHAIN_BOUNDED",
        requestedLength: resolvedChain.length,
        appliedLength: chain.length,
        maxFallbackModels,
      }),
    );
  }
  let lastError: GroqClientError | undefined;
  const attemptedModels: string[] = [];

  for (let i = 0; i < chain.length; i++) {
    const model = chain[i] as string;
    attemptedModels.push(model);
    try {
      return await openrouterCompleteRaw(messages, { ...opts, model });
    } catch (err) {
      // PR-003: treat MODEL_UNAVAILABLE (422/410) the same as MODEL_NOT_FOUND.
      // Bounded Recovery also owns transient fallback: it disables the
      // per-model retry above and advances immediately to the next live
      // reasoning candidate instead of letting chat-agent replay a tool-loop
      // chain on top of this one.
      const fallbackOnTransient =
        opts.retryTransient === false && isTransientError(err);
      if ((isModelUnavailableError(err) || fallbackOnTransient) && i < chain.length - 1) {
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
      if (err instanceof GroqClientError) {
        throw new GroqClientError(err.code, err.message, {
          cause: err,
          context: {
            ...err.toProviderContext(),
            providerModel: err.providerModel ?? model,
            providerAttemptedModels: [...attemptedModels],
          },
        });
      }
      throw err;
    }
  }

  if (lastError) {
    throw new GroqClientError(lastError.code, lastError.message, {
      cause: lastError,
      context: {
        ...lastError.toProviderContext(),
        providerModel: lastError.providerModel ?? attemptedModels.at(-1),
        providerAttemptedModels: [...attemptedModels],
      },
    });
  }
  const catalog = getDynamicCatalogStatus();
  throw new GroqClientError("MODEL_NOT_FOUND", "All OpenRouter free-tier fallback models exhausted", {
    context: {
      providerAttemptedModels: [...attemptedModels],
      catalogLoaded: catalog.loaded,
      catalogUsable: catalog.usable,
      catalogStatus: catalog.lastRefreshStatus,
      catalogError: catalog.lastRefreshError ?? undefined,
    },
  });
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

  const capability = opts.capability;
  const initialModel = opts.model;
  if (initialModel && capability && !isCatalogFreeModelForCapability(initialModel, { capability })) {
    throw new GroqClientError(
      "INVALID_CONFIG",
      `OpenRouter stream requires a currently-free model matching capability="${capability}"`,
      { context: { providerName: "OpenRouter", providerModel: initialModel } },
    );
  }
  const resolved = initialModel
    ? buildFallbackChainFromId(initialModel, opts.taskType, capability ? { capability } : {})
    : resolveFallbackChain({
        capability: capability ?? "chat",
        quality: opts.quality ?? "fast",
      }).map((model) => model.id);
  const maxFallbackModels =
    Number.isInteger(opts.maxFallbackModels) && opts.maxFallbackModels! > 0
      ? opts.maxFallbackModels
      : undefined;
  const chain = (maxFallbackModels ? resolved.slice(0, maxFallbackModels) : resolved);
  const attemptedModels: string[] = [];
  let lastError: GroqClientError | undefined;

  for (let index = 0; index < chain.length; index++) {
    const model = chain[index]!;
    attemptedModels.push(model);
    let emitted = false;
    let transientRetried = false;
    while (true) {
      try {
        for await (const delta of oacCompleteStream(trimmed, { ...fullOpts, model })) {
          emitted = true;
          yield delta;
        }
        return;
      } catch (err) {
        const providerError = err instanceof GroqClientError ? err : undefined;
        // Once bytes have been emitted, retrying would duplicate or splice the
        // answer. The caller must terminalize the partial stream instead.
        if (emitted || !providerError) {
          const terminalError = providerError ?? new GroqClientError(
            "NETWORK_ERROR",
            err instanceof Error ? err.message : "OpenRouter stream disconnected",
            { cause: err, context: { providerName: "OpenRouter", providerModel: model } },
          );
          throw new GroqClientError(terminalError.code, terminalError.message, {
            cause: terminalError,
            context: {
              ...terminalError.toProviderContext(),
              providerModel: terminalError.providerModel ?? model,
              providerAttemptedModels: [...attemptedModels],
            },
          });
        }
        if (
          !transientRetried &&
          opts.retryTransient !== false &&
          isTransientError(providerError) &&
          providerError.retryAfterMs === undefined
        ) {
          transientRetried = true;
          await sleep(1500);
          continue;
        }
        const canAdvance = isModelUnavailableError(providerError) ||
          (opts.retryTransient === false && isTransientError(providerError));
        if (!canAdvance || index >= chain.length - 1) {
          throw new GroqClientError(providerError.code, providerError.message, {
            cause: providerError,
            context: {
              ...providerError.toProviderContext(),
              providerModel: providerError.providerModel ?? model,
              providerAttemptedModels: [...attemptedModels],
            },
          });
        }
        lastError = providerError;
        console.warn(JSON.stringify({
          scope: "openrouter-fallback",
          code: "STREAM_MODEL_FALLBACK",
          reason: providerError.code,
          failedModel: model,
          nextModel: chain[index + 1],
          attempt: index + 1,
        }));
        break;
      }
    }
  }
  if (lastError) {
    throw new GroqClientError(lastError.code, lastError.message, {
      cause: lastError,
      context: { ...lastError.toProviderContext(), providerAttemptedModels: attemptedModels },
    });
  }
  throw new GroqClientError("MODEL_NOT_FOUND", "No OpenRouter free model satisfies the stream capability", {
    context: { providerAttemptedModels: attemptedModels },
  });
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
