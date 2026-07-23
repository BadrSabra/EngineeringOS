/**
 * Task Agent — reads a task's prompt and description, executes it via LLM,
 * and returns a structured response that gets written back as agentResponse.
 */
import { GroqClientError, type AgentErrorCode } from "../errors.js";
import type { Message } from "../groq-client.js";
import type { ProjectContext } from "../context-builder.js";
import { buildTaskAgentSystemPrompt, buildTaskAgentUserPrompt } from "../prompts/task.prompt.js";
import { TaskRecommendationSchema, type TaskAgentOutput } from "../schemas/task.schema.js";
import { parseAgentResponse } from "../parsing.js";
import { agentComplete } from "../agent-complete.js";

export type TaskAgentInput = {
  taskTitle: string;
  taskDescription: string | null;
  taskPrompt: string | null;
  taskPriority: string;
  relatedFiles: string[];
  projectContext: ProjectContext;
  /** Optional per-user API key. Falls back to GROQ_API_KEY env for Groq; required for DeepSeek. */
  apiKey?: string;
  /** AI provider to use. Defaults to "groq". */
  provider?: "groq" | "deepseek" | "openrouter";
};

export type { TaskAgentOutput };

/**
 * PR-E: Extended return type that carries an optional parse-failure marker.
 * When the model output cannot be parsed, the route surfaces `_parseError`
 * as HTTP 422 instead of a silent 200 with degraded fallback content.
 */
export type TaskAgentResult = TaskAgentOutput & {
  _parseError?: { code: AgentErrorCode; message: string; raw: string };
};

function fallbackTaskOutput(raw: string): TaskAgentOutput {
  return {
    summary: "Task analyzed by AI agent",
    steps: ["Analysis completed"],
    result: raw.trim() || "The model did not return a structured result.",
    confidence: "medium",
    needsHumanReview: true,
  };
}

export async function executeTask(input: TaskAgentInput): Promise<TaskAgentResult> {
  const messages: Message[] = [
    { role: "system", content: buildTaskAgentSystemPrompt(input.projectContext) },
    { role: "user", content: buildTaskAgentUserPrompt(input) },
  ];

  const completeOpts = { apiKey: input.apiKey, provider: input.provider };

  // G-18: single retry on transient NON_200 failures.
  let response: { content: string };
  try {
    response = await agentComplete(messages, completeOpts);
  } catch (err) {
    if (err instanceof GroqClientError && err.code === "NON_200") {
      console.warn(JSON.stringify({ scope: "task-agent", code: "MODEL_RETRY", originalError: err.code }));
      response = await agentComplete(messages, completeOpts);
    } else {
      throw err;
    }
  }

  const parsed = parseAgentResponse(response.content, TaskRecommendationSchema, fallbackTaskOutput);
  if (!parsed.ok) {
    console.warn(JSON.stringify({ scope: "task-agent", code: parsed.code, message: parsed.message }));
    // PR-E: surface parse failure to the route so it can return 422 instead of
    // silently returning degraded fallback content as a 200.
    return { ...parsed.data, _parseError: { code: parsed.code, message: parsed.message, raw: parsed.raw } };
  }
  return parsed.data;
}
