/**
 * Chat Agent — conversational interface with full project context.
 *
 * When `rootPath` is supplied the agent activates the file-system tool suite:
 *   read_file      — reads actual source files
 *   list_directory — browses the project tree
 *   search_code    — grep across the codebase
 *   write_file     — queues a proposed change (never writes immediately)
 *
 * The tool loop runs at most MAX_TOOL_ITERATIONS turns before returning a
 * best-effort answer to prevent infinite loops on misbehaving models.
 * Proposed file changes are returned in `pendingChanges` and must be
 * explicitly approved by the user through the dashboard UI.
 */
import { completeRaw, MODEL_POWERFUL, MODEL_FAST } from "../groq-client.js";
import type { RawMessage } from "../groq-client.js";
import type { ProjectContext } from "../context-builder.js";
import { buildChatSystemPrompt } from "../prompts/chat.prompt.js";
import { ChatResponseSchema, type ChatOutput } from "../schemas/chat.schema.js";
import { parseAgentResponse } from "../parsing.js";
import { FILE_TOOL_DEFINITIONS, executeFileTool } from "../tools/file-tools.js";
import type { PendingChange } from "../tools/file-tools.js";

export type ChatMessage = { role: "user" | "assistant"; content: string };
export type { ChatOutput };

const MAX_TOOL_ITERATIONS = 6;

function fallbackChatOutput(raw: string): ChatOutput {
  const trimmed = raw.trim();
  // If raw is valid JSON with a non-empty "response" field, extract it.
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      "response" in parsed &&
      typeof (parsed as Record<string, unknown>).response === "string" &&
      ((parsed as Record<string, unknown>).response as string).length > 0
    ) {
      const sources = (parsed as Record<string, unknown>).sources;
      return {
        response: (parsed as Record<string, unknown>).response as string,
        sources: Array.isArray(sources) ? (sources as string[]) : ["project context"],
      };
    }
  } catch {
    // Not JSON — use the raw text as-is
  }
  return {
    response: trimmed || "I couldn't generate a response — please try again.",
    sources: ["project context"],
  };
}

export async function chat(opts: {
  message: string;
  history: ChatMessage[];
  projectContext: ProjectContext;
  /** Absolute path to the project root on disk. Activates file-system tools when provided. */
  rootPath?: string;
  /** Optional per-user Groq API key. Falls back to process.env.GROQ_API_KEY. */
  apiKey?: string;
}): Promise<ChatOutput> {
  const { message, history, projectContext, rootPath, apiKey } = opts;

  const pendingChanges: PendingChange[] = [];
  const tools = rootPath ? FILE_TOOL_DEFINITIONS : undefined;
  // Use the more capable model when tools are involved — smaller models are
  // unreliable at following multi-step tool-calling protocols.
  const model = rootPath ? MODEL_POWERFUL : MODEL_FAST;

  const messages: RawMessage[] = [
    { role: "system", content: buildChatSystemPrompt(projectContext) },
    ...history.slice(-10).map((m): RawMessage => ({ role: m.role, content: m.content })),
    { role: "user", content: message },
  ];

  for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
    const result = await completeRaw(messages, { model, maxTokens: 4096, apiKey, tools });

    // Model wants to call one or more tools → execute them and loop
    if (result.toolCalls && result.toolCalls.length > 0) {
      // Add the assistant turn (with tool_calls) to the conversation history
      messages.push({
        role: "assistant",
        content: result.content,
        tool_calls: result.toolCalls,
      });

      // Execute each tool call sequentially and add results to history
      for (const tc of result.toolCalls) {
        let args: Record<string, string> = {};
        try {
          args = JSON.parse(tc.function.arguments) as Record<string, string>;
        } catch {
          // malformed arguments — leave args empty, the handler returns an error string
        }
        const output = await executeFileTool(tc.function.name, args, rootPath!, pendingChanges);
        messages.push({ role: "tool", tool_call_id: tc.id, content: output });
      }
      continue; // send enriched history back to the model
    }

    // No tool calls — this is the final response
    const content = result.content ?? "";
    const parsed = parseAgentResponse(content, ChatResponseSchema, fallbackChatOutput);
    if (!parsed.ok) {
      console.warn(JSON.stringify({ scope: "chat-agent", code: parsed.code, message: parsed.message }));
    }
    return {
      ...parsed.data,
      ...(pendingChanges.length > 0 ? { pendingChanges } : {}),
    };
  }

  // Exhausted iterations without a final text response
  console.warn(JSON.stringify({ scope: "chat-agent", code: "TOOL_LOOP_EXHAUSTED", iterations: MAX_TOOL_ITERATIONS }));
  return {
    response:
      "I reached the maximum number of tool steps. Try asking a more specific question or break it into smaller parts.",
    sources: ["tool-loop"],
    ...(pendingChanges.length > 0 ? { pendingChanges } : {}),
  };
}
