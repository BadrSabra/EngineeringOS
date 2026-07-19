/**
 * Task Agent — reads a task's prompt and description, executes it via LLM,
 * and returns a structured response that gets written back as agentResponse.
 */
import { complete, MODEL_POWERFUL, type Message } from "../groq-client.js";
import { GroqClientError, type AgentErrorCode } from "../errors.js";
import type { ProjectContext } from "../context-builder.js";
import { buildTaskAgentSystemPrompt, buildTaskAgentUserPrompt } from "../prompts/task.prompt.js";
import { TaskRecommendationSchema, type TaskAgentOutput } from "../schemas/task.schema.js";
import { parseAgentResponse } from "../parsing.js";

export type TaskAgentInput = {
  taskTitle: string;
  taskDescription: string | null;
  taskPrompt: string | null;
  taskPriority: string;
  relatedFiles: string[];
  projectContext: ProjectContext;
  /** Optional per-user Groq API key. Falls back to process.env.GROQ_API_KEY. */
  apiKey?: string;
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

  // G-18: single retry on transient Groq failures (NON_200 / TIMEOUT).
  // Previously any transient error went straight to fallback boilerplate.
  let response: Awaited<ReturnType<typeof complete>>;
  try {
    response = await complete(messages, { model: MODEL_POWERFUL, apiKey: input.apiKey });
  } catch (err) {
    // Retry only NON_200 at the agent level.  TIMEOUT / NETWORK_ERROR /
    // RATE_LIMITED / SERVER_ERROR are already retried 3× inside completeRaw;
    // adding an agent-level retry for those would produce up to 6 total
    // attempts, which is excessive.  NON_200 (an unexpected HTTP status that
    // the base client treats as non-retryable) is the only gap worth covering.
    if (err instanceof GroqClientError && err.code === "NON_200") {
      console.warn(JSON.stringify({ scope: "task-agent", code: "MODEL_RETRY", originalError: err.code }));
      response = await complete(messages, { model: MODEL_POWERFUL, apiKey: input.apiKey });
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
