/**
 * Groq API gateway — the single point of contact with the model provider.
 * Responsibilities are split so each failure mode has an obvious home:
 *   buildRequest  → shape the wire request
 *   sendRequest   → transport (timeout, error classification)
 *   readResponse  → pull content/model/usage out of a completion
 *   complete()    → orchestrates the above with a small bounded retry for
 *                   transient failures, and logs outcome metadata
 *
 * No raw/untyped response or raw SDK error ever reaches an agent — every
 * failure surfaces as a `GroqClientError` with a specific `code`.
 *
 * Per-user API keys: pass `apiKey` in `CompleteOptions` to use a specific
 * key instead of the process.env.GROQ_API_KEY singleton. Each distinct key
 * gets its own cached Groq client instance.
 */
import Groq from "groq-sdk";
import { GroqClientError, type GroqErrorCode } from "./errors.js";

export type Message = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type GroqResponse = {
  content: string;
  model: string;
  usage: { promptTokens: number; completionTokens: number };
};

export type CompleteOptions = {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** Aborts the request if the model hasn't responded within this window. */
  timeoutMs?: number;
  /** Bounded retries for transient failures only (timeout, network, 5xx). */
  maxRetries?: number;
  /**
   * Per-user Groq API key. When provided, overrides the process.env.GROQ_API_KEY
   * singleton. Each distinct key gets its own cached client instance.
   */
  apiKey?: string;
  /**
   * Force a structured JSON response from the model.
   * Only use when tools are NOT present in the request — Groq rejects
   * response_format + tools together.
   */
  responseFormat?: { type: "json_object" };
};

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 3;

/**
 * Exponential backoff with full jitter for transient failures.
 *
 * Base delay per attempt (ms):
 *   attempt 0 (first retry): 1 000 ms  ±50 %  →  500 – 1 500 ms
 *   attempt 1:                2 000 ms  ±50 %  → 1 000 – 3 000 ms
 *   attempt 2:                4 000 ms  ±50 %  → 2 000 – 6 000 ms
 *
 * RATE_LIMITED errors get a longer base (2 000 ms) because Groq's free-tier
 * tokens-per-minute window resets on a 1-minute boundary — waiting longer
 * is almost always better than hammering the endpoint again in under a second.
 */
function retryDelayMs(attempt: number, code: GroqErrorCode): number {
  const base = code === "RATE_LIMITED" ? 2_000 : 1_000;
  const exponential = base * Math.pow(2, attempt);
  // full jitter: uniform random in [0, exponential]
  return Math.floor(Math.random() * exponential);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** llama-3.3-70b — best quality; use for task execution, code review, orchestration */
export const MODEL_POWERFUL = "llama-3.3-70b-versatile";
/** llama-3.1-8b — fast; use for chat and quick analysis */
export const MODEL_FAST = "llama-3.1-8b-instant";

// Singleton for the env-var key; per-key cache for user-provided keys.
let _envClient: Groq | null = null;
const _keyedClients = new Map<string, Groq>();

/**
 * Maximum number of per-user Groq clients held in the keyed cache.
 * Each `Groq` instance is lightweight (holds a base URL + headers), but an
 * unbounded cache grows silently with the number of distinct user-provided
 * keys — a concern in long-running processes with many active users.
 * When the limit is reached the oldest entry (Map insertion order) is evicted
 * before adding the new one, bounding memory to at most MAX_KEYED_CLIENTS
 * instances at any point in time.
 */
const MAX_KEYED_CLIENTS = 50;

function getClient(apiKey?: string): Groq {
  if (apiKey) {
    let client = _keyedClients.get(apiKey);
    if (!client) {
      if (_keyedClients.size >= MAX_KEYED_CLIENTS) {
        // Map preserves insertion order; `.keys().next().value` is the oldest.
        const oldest = _keyedClients.keys().next().value;
        if (oldest !== undefined) _keyedClients.delete(oldest);
      }
      client = new Groq({ apiKey });
      _keyedClients.set(apiKey, client);
    }
    return client;
  }
  if (!_envClient) {
    const envKey = process.env.GROQ_API_KEY;
    if (!envKey) {
      throw new GroqClientError("INVALID_CONFIG", "GROQ_API_KEY environment variable is not set");
    }
    _envClient = new Groq({ apiKey: envKey });
  }
  return _envClient;
}

type ChatRequest = {
  messages: Message[];
  model: string;
  temperature: number;
  max_tokens: number;
};

function buildRequest(messages: Message[], opts: { model: string; temperature: number; maxTokens: number }): ChatRequest {
  return {
    messages,
    model: opts.model,
    temperature: opts.temperature,
    max_tokens: opts.maxTokens,
  };
}

// ── Tool-calling types ────────────────────────────────────────────────────────

export type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type ToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

/**
 * Extended message union used in tool-calling conversations.
 * Covers all four roles the Groq API accepts in a single request.
 */
export type RawMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; content: string; tool_call_id: string };

export type RawGroqResponse = {
  content: string | null;
  toolCalls: ToolCall[] | null;
  model: string;
  usage: { promptTokens: number; completionTokens: number };
};

function readRawResponse(
  completion: Awaited<ReturnType<Groq["chat"]["completions"]["create"]>>,
): RawGroqResponse {
  const c = completion as {
    choices: Array<{
      message?: { content?: string | null; tool_calls?: ToolCall[] };
    }>;
    model: string;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const msg = c.choices[0]?.message;
  if (!msg) throw new GroqClientError("EMPTY_RESPONSE", "Groq returned an empty response");
  const hasContent = !!msg.content;
  const hasCalls = Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0;
  if (!hasContent && !hasCalls) {
    throw new GroqClientError("EMPTY_RESPONSE", "Groq returned neither content nor tool calls");
  }
  return {
    content: msg.content ?? null,
    toolCalls: hasCalls ? (msg.tool_calls as ToolCall[]) : null,
    model: c.model,
    usage: {
      promptTokens: c.usage?.prompt_tokens ?? 0,
      completionTokens: c.usage?.completion_tokens ?? 0,
    },
  };
}

/**
 * Like `complete()` but supports tool-calling conversations.
 * Accepts the full `RawMessage` union (including tool-result messages) and
 * returns both the text content and any tool calls the model wants to make.
 * The caller is responsible for executing tools and looping until the model
 * returns a final text response with no tool calls.
 */
export async function completeRaw(
  messages: RawMessage[],
  opts: CompleteOptions & { tools?: ToolDefinition[] } = {},
): Promise<RawGroqResponse> {
  const {
    model = MODEL_POWERFUL,
    temperature = 0.2,
    maxTokens = 4096,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxRetries = DEFAULT_MAX_RETRIES,
    apiKey,
    tools,
    responseFormat,
  } = opts;

  const client = getClient(apiKey);
  const hasTools = tools && tools.length > 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const request: any = {
    messages,
    model,
    temperature,
    max_tokens: maxTokens,
    // response_format and tools are mutually exclusive on Groq; tools take priority.
    ...(hasTools ? { tools, tool_choice: "auto" } : responseFormat ? { response_format: responseFormat } : {}),
  };

  const startedAt = Date.now();
  let lastError: GroqClientError | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const completion = await sendRequest(client, request, timeoutMs);
      const result = readRawResponse(completion);
      logOutcome({ model: result.model, durationMs: Date.now() - startedAt, attempt, outcome: "success" });
      return result;
    } catch (err) {
      lastError = err instanceof GroqClientError ? err : classifySdkError(err, false);
      if (attempt < maxRetries && isRetryable(lastError.code)) {
        const delay = retryDelayMs(attempt, lastError.code);
        console.info(JSON.stringify({ scope: "groq-client", event: "retry_backoff", attempt, code: lastError.code, delayMs: delay }));
        await sleep(delay);
        continue;
      }
      break;
    }
  }

  logOutcome({ model, durationMs: Date.now() - startedAt, attempt: maxRetries, outcome: "failure", code: lastError?.code });
  throw lastError ?? new GroqClientError("NETWORK_ERROR", "Unknown Groq client failure");
}

function classifySdkError(err: unknown, aborted: boolean): GroqClientError {
  if (err instanceof GroqClientError) return err;
  if (aborted) return new GroqClientError("TIMEOUT", "Groq request timed out", { cause: err });

  const status = (err as { status?: number } | undefined)?.status;
  if (typeof status === "number") {
    if (status === 401 || status === 403) {
      return new GroqClientError("AUTH_ERROR", `Groq API authentication failed (${status})`, { cause: err });
    }
    if (status === 429) {
      return new GroqClientError("RATE_LIMITED", "Groq API rate limit exceeded", { cause: err });
    }
    if (status >= 500) {
      return new GroqClientError("SERVER_ERROR", `Groq API server error (${status})`, { cause: err });
    }
    return new GroqClientError("NON_200", `Groq API responded with status ${status}`, { cause: err });
  }
  return new GroqClientError(
    "NETWORK_ERROR",
    err instanceof Error ? err.message : "Network error contacting Groq",
    { cause: err },
  );
}

async function sendRequest(client: Groq, request: ChatRequest, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await client.chat.completions.create(request, { signal: controller.signal });
  } catch (err) {
    throw classifySdkError(err, controller.signal.aborted);
  } finally {
    clearTimeout(timer);
  }
}

function readResponse(completion: Awaited<ReturnType<Groq["chat"]["completions"]["create"]>>): GroqResponse {
  // `create()` can resolve to a Stream when streaming is requested; we never
  // request streaming, so this is always a ChatCompletion at runtime.
  const chatCompletion = completion as { choices: Array<{ message?: { content?: string | null } }>; model: string; usage?: { prompt_tokens?: number; completion_tokens?: number } };
  const content = chatCompletion.choices[0]?.message?.content;
  if (!content) {
    throw new GroqClientError("EMPTY_RESPONSE", "Groq returned an empty response");
  }
  return {
    content,
    model: chatCompletion.model,
    usage: {
      promptTokens: chatCompletion.usage?.prompt_tokens ?? 0,
      completionTokens: chatCompletion.usage?.completion_tokens ?? 0,
    },
  };
}

function isRetryable(code: GroqErrorCode): boolean {
  // RATE_LIMITED and SERVER_ERROR were previously absorbed into NON_200
  // (not retried). Now that they are distinct codes, retry both: rate-limit
  // quotas reset after a short window; 5xx errors are transient infrastructure
  // failures. AUTH_ERROR, NON_200, EMPTY_RESPONSE, and INVALID_CONFIG are
  // never retryable — a retry cannot change the outcome.
  return (
    code === "TIMEOUT" ||
    code === "NETWORK_ERROR" ||
    code === "RATE_LIMITED" ||
    code === "SERVER_ERROR"
  );
}

function logOutcome(meta: {
  model: string;
  durationMs: number;
  attempt: number;
  outcome: "success" | "failure";
  code?: GroqErrorCode;
}) {
  const line = JSON.stringify({ scope: "groq-client", ...meta });
  if (meta.outcome === "failure") {
    console.error(line);
  } else {
    console.info(line);
  }
}

export async function complete(messages: Message[], opts: CompleteOptions = {}): Promise<GroqResponse> {
  const {
    model = MODEL_POWERFUL,
    temperature = 0.2,
    maxTokens = 4096,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxRetries = DEFAULT_MAX_RETRIES,
    apiKey,
  } = opts;

  const client = getClient(apiKey);
  const request = buildRequest(messages, { model, temperature, maxTokens });
  const startedAt = Date.now();

  let lastError: GroqClientError | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const completion = await sendRequest(client, request, timeoutMs);
      const result = readResponse(completion);
      logOutcome({ model: result.model, durationMs: Date.now() - startedAt, attempt, outcome: "success" });
      return result;
    } catch (err) {
      lastError = err instanceof GroqClientError ? err : classifySdkError(err, false);
      if (attempt < maxRetries && isRetryable(lastError.code)) {
        const delay = retryDelayMs(attempt, lastError.code);
        console.info(JSON.stringify({ scope: "groq-client", event: "retry_backoff", attempt, code: lastError.code, delayMs: delay }));
        await sleep(delay);
        continue;
      }
      break;
    }
  }

  logOutcome({
    model,
    durationMs: Date.now() - startedAt,
    attempt: maxRetries,
    outcome: "failure",
    code: lastError?.code,
  });
  throw lastError ?? new GroqClientError("NETWORK_ERROR", "Unknown Groq client failure");
}
