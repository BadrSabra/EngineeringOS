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

  const candidateSource = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  let candidate = candidateSource;
  if (!/^[[{]/.test(candidateSource)) {
    const braceIdx = candidateSource.indexOf("{");
    const bracketIdx = candidateSource.indexOf("[");
    const starts = [braceIdx, bracketIdx].filter((i) => i >= 0);
    if (starts.length > 0) {
      candidate = candidateSource.slice(Math.min(...starts));
    }
  }

  // Extract only the first complete top-level JSON value. Using the last
  // closing brace is unsafe: models sometimes append a second JSON object,
  // commentary, or a duplicated envelope after an otherwise valid response.
  // In that case the first object is recoverable and must not be discarded.
  const balanced = findBalancedJsonValue(candidate);
  if (balanced) candidate = balanced;

  // Pass 1: try JSON.parse directly. Structural whitespace (newlines, tabs) between
  // tokens is valid JSON and must NOT be replaced — a global \n → \\n transform
  // corrupts it (turning {↵ "key": ... } into {\\n "key": ... } which fails with
  // "Expected property name or '}' at position 1").
  try {
    return { ok: true, data: JSON.parse(candidate) };
  } catch {
    // fall through — may be raw control chars embedded inside string values
  }

  // Pass 2: sanitize bare control characters that appear *inside JSON string literals*
  // only. We match each string token and escape control chars within it; structural
  // whitespace between tokens is left untouched.
  //
  // Pattern: "(?:[^"\\]|\\.)*"  matches a JSON string (quoted, with \" and \\ support).
  // The 's' flag makes . match newlines so embedded literal newlines inside a string
  // are captured and escaped, not left raw.
  const sanitized = candidate.replace(/"(?:[^"\\]|\\.)*"/gs, (str) =>
    str.replace(/[\u0000-\u001F]/g, (ch) => {
      if (ch === "\n") return "\\n";
      if (ch === "\r") return "\\r";
      if (ch === "\t") return "\\t";
      return ""; // strip remaining non-printable control chars
    }),
  );

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

function findBalancedJsonValue(text: string): string | null {
  const first = text.search(/[[{]/);
  if (first < 0) return null;

  const opening = text[first];
  const closing = opening === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = first; i < text.length; i++) {
    const char = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === opening) {
      depth++;
    } else if (char === closing) {
      depth--;
      if (depth === 0) return text.slice(first, i + 1);
    }
  }

  return null;
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
