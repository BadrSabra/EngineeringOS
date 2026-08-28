/**
 * Provider tool-call protocol boundary.
 *
 * OpenAI-compatible providers occasionally put an executable request in
 * message.content instead of message.tool_calls.  This module is deliberately
 * strict: only the grammars documented below are accepted, and a call is
 * usable only when its name is present in the request's tool manifest.
 *
 * Accepted textual grammars:
 *   <tool_call>{"name":"read_file","arguments":{"path":"src/a.ts"}}</tool_call>
 *   <tool_call><function=read_file><parameter=path>src/a.ts</parameter></function></tool_call>
 *   <|tool_call_start|>read_file({"path":"src/a.ts"})<|tool_call_end|>
 *   <|tool_call_start|>{"name":"read_file","arguments":{"path":"src/a.ts"}}<|tool_call_end|>
 *
 * Arguments are always JSON objects.  Textual IDs are derived from the
 * normalized call and ordinal, so replay and tests do not depend on randomness.
 * Planning prose is not an execution capability; planning-looking calls (for
 * example plan({...})) are rejected as invalid provider output.
 */
import { createHash } from "node:crypto";
import type { RawGroqResponse, ToolCall, ToolDefinition } from "./groq-client.js";
import { GroqClientError } from "./errors.js";

const MAX_PROVIDER_DIAGNOSTIC = 180;
const PSEUDO_TOOL_NAMES = new Set([
  "plan",
  "planning",
  "apply_patch",
  "patch",
  "shell",
  "terminal",
  "tool_call",
]);

export type ToolCallManifest = ReadonlySet<string> | readonly ToolDefinition[];

export type ProviderToolCallOptions = {
  tools?: ToolCallManifest;
  /**
   * Full server-authorized manifest for an execution turn. `tools` can be a
   * narrower per-iteration exposure (for example after a cached read), while
   * this keeps stale provider responses on the same authorized execution path.
   * It is intentionally omitted for no-tool synthesis calls.
   */
  toolManifest?: ToolCallManifest;
  providerName?: string;
  model?: string;
};

function manifestNames(tools?: ToolCallManifest): ReadonlySet<string> {
  if (!tools) return new Set();
  if (tools instanceof Set) return tools;
  const definitions = tools as readonly ToolDefinition[];
  return new Set(
    definitions
      .map((tool) => tool?.function?.name)
      .filter((name): name is string => typeof name === "string" && name.length > 0),
  );
}

function invalidToolCall(
  reason: string,
  options: ProviderToolCallOptions,
): GroqClientError {
  const safeReason = reason.replace(/[\r\n]+/g, " ").slice(0, MAX_PROVIDER_DIAGNOSTIC);
  return new GroqClientError(
    "INVALID_TOOL_CALL",
    `Provider returned invalid tool-call output: ${safeReason}`,
    {
      context: {
        providerName: options.providerName,
        providerModel: options.model,
        providerCode: "INVALID_TOOL_CALL",
        providerMessage: safeReason,
      },
    },
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonObject(
  value: unknown,
  options: ProviderToolCallOptions,
  label: string,
): Record<string, unknown> {
  let parsed: unknown = value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) throw invalidToolCall(`${label} is empty`, options);
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw invalidToolCall(`${label} is not valid JSON`, options);
    }
  }
  if (!isRecord(parsed)) {
    throw invalidToolCall(`${label} must be a JSON object`, options);
  }
  return parsed;
}

function toolName(
  value: unknown,
  names: ReadonlySet<string>,
  options: ProviderToolCallOptions,
): string {
  if (typeof value !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw invalidToolCall("tool name is not a valid identifier", options);
  }
  if (PSEUDO_TOOL_NAMES.has(value)) {
    throw invalidToolCall(`pseudo-tool "${value}" is not executable`, options);
  }
  if (!names.has(value)) {
    throw invalidToolCall(`tool "${value}" is not in the request manifest`, options);
  }
  return value;
}

function canonicalArguments(
  value: unknown,
  options: ProviderToolCallOptions,
): string {
  const parsed = parseJsonObject(value, options, "tool arguments");
  return JSON.stringify(parsed);
}

function deterministicId(
  name: string,
  args: string,
  ordinal: number,
  prefix: "text" | "native",
): string {
  const digest = createHash("sha256")
    .update(`${prefix}:${ordinal}:${name}:${args}`)
    .digest("hex")
    .slice(0, 20);
  return `${prefix}_${digest}`;
}

/**
 * Normalize native provider calls before they enter replayable message
 * history.  Valid provider IDs are retained for compatibility; absent IDs are
 * deterministic. Invalid arguments are rejected rather than changed to "{}".
 */
export function normalizeProviderToolCalls(
  calls: unknown,
  options: ProviderToolCallOptions = {},
): ToolCall[] {
  if (calls === undefined || calls === null) return [];
  if (!Array.isArray(calls)) {
    throw invalidToolCall("native tool calls must be an array", options);
  }
  if (calls.length === 0) return [];
  const names = manifestNames(options.toolManifest ?? options.tools);
  return calls.map((rawCall, index) => {
    if (!isRecord(rawCall) || rawCall.type !== "function" || !isRecord(rawCall.function)) {
      throw invalidToolCall("native tool call has an invalid shape", options);
    }
    const name = toolName(rawCall.function.name, names, options);
    const args = canonicalArguments(rawCall.function.arguments, options);
    const id =
      typeof rawCall.id === "string" && rawCall.id.trim()
        ? rawCall.id
        : deterministicId(name, args, index, "native");
    return {
      id,
      type: "function",
      function: { name, arguments: args },
    };
  });
}

function matchingDelimiter(
  text: string,
  openIndex: number,
  open: string,
  close: string,
): number {
  let depth = 0;
  let quote: '"' | "'" | null = null;
  let escaped = false;
  for (let index = openIndex; index < text.length; index += 1) {
    const character = text[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (text.startsWith(open, index)) {
      depth += 1;
      index += open.length - 1;
    } else if (text.startsWith(close, index)) {
      depth -= 1;
      if (depth === 0) return index;
      index += close.length - 1;
    }
  }
  return -1;
}

function parseEnvelope(
  body: string,
  names: ReadonlySet<string>,
  options: ProviderToolCallOptions,
): { name: string; arguments: string } {
  const parsed = parseJsonObject(body, options, "tool-call payload");
  const keys = Object.keys(parsed).sort();
  if (keys.length !== 2 || keys[0] !== "arguments" || keys[1] !== "name") {
    throw invalidToolCall("tool-call payload must contain only name and arguments", options);
  }
  return {
    name: toolName(parsed.name, names, options),
    arguments: canonicalArguments(parsed.arguments, options),
  };
}

function parseFunctionExpression(
  body: string,
  names: ReadonlySet<string>,
  options: ProviderToolCallOptions,
): { name: string; arguments: string } {
  const trimmed = body.trim();
  const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
  if (!match || match.index === undefined) {
    return parseEnvelope(trimmed, names, options);
  }
  const openIndex = trimmed.indexOf("(", match.index);
  const closeIndex = matchingDelimiter(trimmed, openIndex, "(", ")");
  if (closeIndex === -1 || trimmed.slice(closeIndex + 1).trim()) {
    throw invalidToolCall("function call is incomplete", options);
  }
  return {
    name: toolName(match[1], names, options),
    arguments: canonicalArguments(trimmed.slice(openIndex + 1, closeIndex), options),
  };
}

function parseLegacyXmlBody(
  body: string,
  names: ReadonlySet<string>,
  options: ProviderToolCallOptions,
): { name: string; arguments: string } {
  const trimmed = body.trim();
  if (trimmed.startsWith("{")) return parseEnvelope(trimmed, names, options);

  const functionMatch = trimmed.match(
    /^<function=([A-Za-z_][A-Za-z0-9_]*)>([\s\S]*)<\/function>$/,
  );
  if (!functionMatch) {
    throw invalidToolCall("legacy XML tool-call syntax is malformed", options);
  }
  const name = toolName(functionMatch[1], names, options);
  const rest = functionMatch[2];
  const args: Record<string, string> = {};
  let cursor = 0;
  const parameterPattern = /<parameter=([A-Za-z_][A-Za-z0-9_]*)>([\s\S]*?)<\/parameter>/g;
  while (cursor < rest.length) {
    const whitespace = rest.slice(cursor).match(/^\s+/);
    if (whitespace) {
      cursor += whitespace[0].length;
      continue;
    }
    parameterPattern.lastIndex = cursor;
    const parameter = parameterPattern.exec(rest);
    if (!parameter || parameter.index !== cursor || parameter[1] in args) {
      throw invalidToolCall("legacy XML parameters are malformed or duplicated", options);
    }
    args[parameter[1]] = parameter[2].trim();
    cursor = parameterPattern.lastIndex;
  }
  return { name, arguments: JSON.stringify(args) };
}

function parseTextualBody(
  body: string,
  names: ReadonlySet<string>,
  options: ProviderToolCallOptions,
  legacyXml: boolean,
): { name: string; arguments: string } {
  return legacyXml
    ? parseLegacyXmlBody(body, names, options)
    : parseFunctionExpression(body, names, options);
}

function addTextualCall(
  calls: Array<{ name: string; arguments: string }>,
  parsed: { name: string; arguments: string },
) {
  calls.push(parsed);
}

/**
 * Parse and remove only complete, successfully normalized textual calls.
 * Any marker, known executable call, pseudo-tool, malformed call, or call
 * outside the manifest fails closed; arbitrary surrounding prose is preserved.
 */
export function normalizeProviderText(
  content: string,
  options: ProviderToolCallOptions = {},
): { content: string | null; toolCalls: ToolCall[] } {
  const names = manifestNames(options.toolManifest ?? options.tools);
  const textual: Array<{ name: string; arguments: string }> = [];
  const kept: string[] = [];
  let cursor = 0;

  const specialPattern = /<tool_call>|<\/tool_call>|<\|tool_call_start\|>|<\|tool_call_end\|>/g;
  const plainPattern = /\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;

  while (cursor < content.length) {
    specialPattern.lastIndex = cursor;
    plainPattern.lastIndex = cursor;
    const special = specialPattern.exec(content);
    const plain = plainPattern.exec(content);
    const specialIndex = special?.index ?? Number.POSITIVE_INFINITY;
    const plainIndex = plain?.index ?? Number.POSITIVE_INFINITY;
    const nextIndex = Math.min(specialIndex, plainIndex);

    if (!Number.isFinite(nextIndex)) {
      kept.push(content.slice(cursor));
      break;
    }
    if (nextIndex > cursor) kept.push(content.slice(cursor, nextIndex));

    if (specialIndex <= plainIndex) {
      const tag = special![0];
      if (tag === "</tool_call>" || tag === "<|tool_call_end|>") {
        throw invalidToolCall("tool-call end marker has no matching start", options);
      }
      const isLegacy = tag === "<tool_call>";
      const close = isLegacy ? "</tool_call>" : "<|tool_call_end|>";
      const closeIndex = content.indexOf(close, nextIndex + tag.length);
      if (closeIndex === -1) throw invalidToolCall("tool-call marker is incomplete", options);
      const parsed = parseTextualBody(
        content.slice(nextIndex + tag.length, closeIndex),
        names,
        options,
        isLegacy,
      );
      addTextualCall(textual, parsed);
      cursor = closeIndex + close.length;
      continue;
    }

    const name = plain![1];
    const openIndex = content.indexOf("(", plainIndex);
    const closeIndex = matchingDelimiter(content, openIndex, "(", ")");
    const body = closeIndex === -1 ? "" : content.slice(openIndex + 1, closeIndex);
    const looksExecutable =
      names.has(name) || PSEUDO_TOOL_NAMES.has(name) ||
      (closeIndex !== -1 && body.trim().startsWith("{"));
    if (!looksExecutable) {
      kept.push(content.slice(cursor, openIndex + 1));
      cursor = openIndex + 1;
      continue;
    }
    if (closeIndex === -1) throw invalidToolCall("function-style tool call is incomplete", options);
    addTextualCall(
      textual,
      parseFunctionExpression(content.slice(plainIndex, closeIndex + 1), names, options),
    );
    cursor = closeIndex + 1;
  }

  const normalizedCalls = textual.map((call, index) => ({
    id: deterministicId(call.name, call.arguments, index, "text"),
    type: "function" as const,
    function: { name: call.name, arguments: call.arguments },
  }));
  const normalizedContent = kept.join("").trim();
  return {
    content: normalizedContent || null,
    toolCalls: normalizedCalls,
  };
}

export function normalizeProviderResponse(
  response: RawGroqResponse,
  options: ProviderToolCallOptions = {},
): RawGroqResponse {
  const native = normalizeProviderToolCalls(response.toolCalls, options);
  const textual = response.content
    ? normalizeProviderText(response.content, options)
    : { content: null, toolCalls: [] };
  return {
    ...response,
    content: textual.content,
    toolCalls: [...native, ...textual.toolCalls].length > 0
      ? [...native, ...textual.toolCalls]
      : null,
  };
}

const STREAM_MARKER_PREFIXES = [
  "<tool_call>",
  "</tool_call>",
  "<|tool_call_start|>",
  "<|tool_call_end|>",
  "write_file(",
  "replace_text(",
  "read_file(",
  "read_file_range(",
  "list_directory(",
  "search_code(",
  "git_status(",
  "git_diff(",
  "git_log(",
  "run_command(",
  "run_validation(",
  "run_browser_validation(",
  "plan(",
  "planning(",
  "apply_patch(",
  "tool_call(",
];

function streamExecutableStart(text: string): number {
  const special = [
    text.indexOf("<tool_call>"),
    text.indexOf("</tool_call>"),
    text.indexOf("<|tool_call_start|>"),
    text.indexOf("<|tool_call_end|>"),
  ].filter((index) => index >= 0);
  const plain = text.match(/\b[A-Za-z_][A-Za-z0-9_]*\s*\(\s*\{/);
  if (plain?.index !== undefined) special.push(plain.index);
  return special.length > 0 ? Math.min(...special) : -1;
}

function incompletePrefixLength(text: string): number {
  let best = 0;
  for (const prefix of STREAM_MARKER_PREFIXES) {
    // A one-character suffix such as the final "r" in ordinary prose is not
    // enough evidence to delay output for a function-style marker. The "<"
    // prefix is special because it starts both supported marker dialects.
    const minimum = 1;
    const max = Math.min(text.length, prefix.length - 1);
    for (let length = max; length > best; length -= 1) {
      if (length < minimum) continue;
      if (
        length === 1 &&
        !prefix.startsWith("<") &&
        text.length > 1 &&
        /[A-Za-z0-9_]/.test(text[text.length - 2] ?? "")
      ) {
        continue;
      }
      if (text.endsWith(prefix.slice(0, length))) {
        best = length;
        break;
      }
    }
  }
  return best;
}

/**
 * Incremental no-tool stream guard. It emits ordinary text promptly, buffers
 * possible marker prefixes across chunks, and validates the retained suffix at
 * stream termination with an empty manifest so no stream can dispatch tools.
 */
export function createContentOnlyStreamGuard(
  options: Omit<ProviderToolCallOptions, "tools"> = {},
): {
  push(delta: string): string[];
  finish(): string[];
} {
  let pending = "";
  return {
    push(delta: string): string[] {
      pending += delta;
      const start = streamExecutableStart(pending);
      if (start >= 0) {
        const safe = pending.slice(0, start);
        pending = pending.slice(start);
        return safe ? [safe] : [];
      }
      const held = incompletePrefixLength(pending);
      const safe = pending.slice(0, pending.length - held);
      pending = held ? pending.slice(-held) : "";
      return safe ? [safe] : [];
    },
    finish(): string[] {
      if (incompletePrefixLength(pending) > 0) {
        throw invalidToolCall("stream ended with an incomplete tool-call marker", options);
      }
      const result = normalizeProviderText(pending, {
        ...options,
        tools: new Set(),
        toolManifest: new Set(),
      });
      pending = "";
      return result.content ? [result.content] : [];
    },
  };
}