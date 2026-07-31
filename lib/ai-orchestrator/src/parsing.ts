/**
 * Unified parsing/validation layer for LLM JSON responses.
 *
 * Every agent asks the model for JSON, but models routinely wrap it in code
 * fences, prepend commentary, or occasionally return malformed/empty output.
 * `parseAgentResponse` is the single place that handles all of that: it
 * extracts a JSON candidate from raw text, validates it against a zod schema,
 * and — on any failure — returns a caller-supplied fallback instead of
 * throwing, so one bad model response degrades a single field instead of
 * crashing the request.
 */
import type { ZodType, ZodTypeDef } from "zod";
import type { AgentErrorCode } from "./errors.js";

type JsonExtractResult =
  | { ok: true; data: unknown }
  | { ok: false; code: Extract<AgentErrorCode, "EMPTY_MODEL_RESPONSE" | "MALFORMED_JSON">; message: string };

/**
 * Pulls a JSON value out of raw model text. Handles:
 * - plain JSON
 * - JSON wrapped in ``` or ```json fences
 * - JSON with commentary text before/after it
 * - empty responses
 * - truly malformed JSON (reported, not thrown)
 */
export function extractJson(raw: string): JsonExtractResult {
  // Safety net: strip DeepSeek-R1 <think>...</think> reasoning traces that
  // were not already removed by readRawResponse() (e.g. in unit tests that
  // pass raw strings directly, or if the model embeds a second think block).
  const stripped = (raw ?? "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const trimmed = stripped || (raw ?? "").trim();
  if (!trimmed) {
    return { ok: false, code: "EMPTY_MODEL_RESPONSE", message: "Model returned an empty response" };
  }

  let candidate = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  if (!/^[[{]/.test(candidate)) {
    const braceIdx = candidate.indexOf("{");
    const bracketIdx = candidate.indexOf("[");
    const starts = [braceIdx, bracketIdx].filter((i) => i >= 0);
    if (starts.length > 0) {
      candidate = candidate.slice(Math.min(...starts));
    }
  }

  const lastBrace = candidate.lastIndexOf("}");
  const lastBracket = candidate.lastIndexOf("]");
  const end = Math.max(lastBrace, lastBracket);
  if (end >= 0 && end < candidate.length - 1) {
    candidate = candidate.slice(0, end + 1);
  }

  // LLMs frequently embed bare control characters (newlines, tabs, carriage returns)
  // inside JSON string values, which makes JSON.parse throw "Bad control character".
  // JSON structural characters are all > \u001F, so replacing all control chars with
  // their JSON escape sequences is safe and cannot break the JSON structure itself.
  const sanitized = candidate.replace(/[\u0000-\u001F]/g, (ch) => {
    if (ch === "\n") return "\\n";
    if (ch === "\r") return "\\r";
    if (ch === "\t") return "\\t";
    return ""; // strip remaining non-printable control chars
  });

  try {
    return { ok: true, data: JSON.parse(sanitized) };
  } catch (err) {
    return {
      ok: false,
      code: "MALFORMED_JSON",
      message: err instanceof Error ? err.message : "Failed to parse model output as JSON",
    };
  }
}

export type AgentParseResult<T> =
  | { ok: true; data: T }
  | { ok: false; data: T; code: AgentErrorCode; message: string; raw: string };

/**
 * Extracts JSON from `raw`, validates it against `schema`, and returns the
 * validated data. On extraction or schema failure, returns `fallback(raw)`
 * instead — the caller is responsible for logging `code`/`message` if it
 * wants observability, but never needs to handle a thrown error here.
 */
export function parseAgentResponse<T>(
  raw: string,
  schema: ZodType<T, ZodTypeDef, any>,
  fallback: (raw: string) => T,
): AgentParseResult<T> {
  const extracted = extractJson(raw);
  if (!extracted.ok) {
    return { ok: false, data: fallback(raw), code: extracted.code, message: extracted.message, raw };
  }

  const validated = schema.safeParse(extracted.data);
  if (!validated.success) {
    return {
      ok: false,
      data: fallback(raw),
      code: "SCHEMA_VALIDATION_FAILED",
      message: validated.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; "),
      raw,
    };
  }

  return { ok: true, data: validated.data };
}
