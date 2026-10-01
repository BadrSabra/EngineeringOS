import { GroqClientError } from "./errors.js";

/**
 * Provider responses include JSON envelopes around tool arguments, so their
 * cap must be larger than the per-argument limit while remaining finite.
 */
export const MAX_PROVIDER_RESPONSE_BYTES = 20_000_000;
export const MAX_PROVIDER_ERROR_BODY_BYTES = 64_000;

export class ProviderResponseTooLargeError extends Error {
  constructor(readonly maxBytes = MAX_PROVIDER_RESPONSE_BYTES) {
    super(`Provider response exceeded the ${maxBytes}-byte limit`);
    this.name = "ProviderResponseTooLargeError";
  }
}

function findProviderResponseTooLargeError(
  error: unknown,
): ProviderResponseTooLargeError | undefined {
  const seen = new Set<object>();
  let current: unknown = error;
  for (let depth = 0; depth < 6; depth += 1) {
    if (current instanceof ProviderResponseTooLargeError) return current;
    if (typeof current !== "object" || current === null || seen.has(current)) return undefined;
    seen.add(current);
    try {
      current = (current as { cause?: unknown }).cause;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function isProviderResponseTooLargeError(error: unknown): boolean {
  return findProviderResponseTooLargeError(error) !== undefined;
}

export function getProviderResponseTooLargeLimit(error: unknown): number | undefined {
  return findProviderResponseTooLargeError(error)?.maxBytes;
}

function declaredContentLengthExceeds(response: Response, maxBytes: number): boolean {
  const rawLength = response.headers?.get?.("content-length");
  if (!rawLength || !/^\d+$/.test(rawLength.trim())) return false;
  const length = Number(rawLength);
  return Number.isSafeInteger(length) && length > maxBytes;
}

function cancelProviderResponseBody(response: Response, reason: unknown): void {
  try {
    void response.body?.cancel(reason).catch(() => undefined);
  } catch {
    // A locked/already-consumed body cannot be canceled through the stream.
  }
}

export async function readBoundedProviderResponseText(
  response: Response,
  maxBytes = MAX_PROVIDER_RESPONSE_BYTES,
): Promise<string> {
  if (declaredContentLengthExceeds(response, maxBytes)) {
    const error = new ProviderResponseTooLargeError(maxBytes);
    cancelProviderResponseBody(response, error);
    throw error;
  }
  const reader = response.body?.getReader();
  if (!reader) return "";

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        const error = new ProviderResponseTooLargeError(maxBytes);
        try {
          void reader.cancel(error).catch(() => undefined);
        } catch {
          // The size error remains authoritative if the stream is already closed.
        }
        throw error;
      }
      chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, totalBytes).toString("utf8");
}

export async function readBoundedProviderResponseJson<T>(
  response: Response,
  context: { providerName: string; model?: string },
  maxBytes = MAX_PROVIDER_RESPONSE_BYTES,
): Promise<T> {
  let text: string;
  try {
    text = await readBoundedProviderResponseText(response, maxBytes);
  } catch (error) {
    if (!isProviderResponseTooLargeError(error)) throw error;
    throw new GroqClientError(
      "INVALID_PROVIDER_RESPONSE",
      `${context.providerName} response exceeded the ${maxBytes}-byte limit`,
      {
        cause: error,
        context: {
          providerName: context.providerName,
          providerModel: context.model,
          providerCode: "RESPONSE_TOO_LARGE",
        },
      },
    );
  }
  return JSON.parse(text) as T;
}

/**
 * Groq's SDK owns response parsing. Count bytes in a streaming transform so
 * both JSON and SSE responses stay bounded without buffering the whole body.
 */
export function createBoundedProviderFetch(
  baseFetch: typeof fetch = globalThis.fetch,
  maxBytes = MAX_PROVIDER_RESPONSE_BYTES,
): typeof fetch {
  return async (input, init) => {
    const response = await baseFetch(input, init);
    const responseMaxBytes = response.ok
      ? maxBytes
      : Math.min(maxBytes, MAX_PROVIDER_ERROR_BODY_BYTES);
    if (declaredContentLengthExceeds(response, responseMaxBytes)) {
      const error = new ProviderResponseTooLargeError(responseMaxBytes);
      cancelProviderResponseBody(response, error);
      throw error;
    }
    if (!response.body || [204, 205, 304].includes(response.status)) return response;

    let totalBytes = 0;
    const boundedBody = response.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          totalBytes += chunk.byteLength;
          if (totalBytes > responseMaxBytes) {
            controller.error(new ProviderResponseTooLargeError(responseMaxBytes));
            return;
          }
          controller.enqueue(chunk);
        },
      }),
    );
    const headers = new Headers(response.headers);
    headers.delete("content-length");
    return new Response(boundedBody, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
}