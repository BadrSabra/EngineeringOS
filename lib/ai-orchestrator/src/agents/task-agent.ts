/**
 * Task Agent — reads a task's prompt and description, executes it via LLM,
 * and returns a structured response that gets written back as agentResponse.
 */
import type { ProjectContext } from "../context-builder.js";
import { buildTaskAgentSystemPrompt, buildTaskAgentUserPrompt } from "../prompts/task.prompt.js";
import { TaskRecommendationSchema, type TaskAgentOutput } from "../schemas/task.schema.js";
import type { Message } from "../groq-client.js";
import { BaseAgent, type AgentRunResult } from "./base-agent.js";
import type { ProviderId } from "../agent-complete.js";

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
  provider?: ProviderId;
};

export type { TaskAgentOutput };

/**
 * PR-E: Extended return type that carries an optional parse-failure marker.
 * When the model output cannot be parsed, the route surfaces `_parseError`
 * as HTTP 422 instead of a silent 200 with degraded fallback content.
 */
export type TaskAgentResult = AgentRunResult<TaskAgentOutput>;

function fallbackTaskOutput(raw: string): TaskAgentOutput {
  return {
    summary: "Task analyzed by AI agent",
    steps: ["Analysis completed"],
    result: raw.trim() || "The model did not return a structured result.",
    confidence: "medium",
    needsHumanReview: true,
  };
}

class TaskAgent extends BaseAgent<TaskAgentInput, TaskAgentOutput> {
  protected readonly scope = "task-agent";
  protected readonly schema = TaskRecommendationSchema;

  protected buildMessages(input: TaskAgentInput): Message[] {
    return [
      { role: "system", content: buildTaskAgentSystemPrompt(input.projectContext) },
      { role: "user", content: buildTaskAgentUserPrompt(input) },
    ];
  }

  protected fallbackOutput(raw: string): TaskAgentOutput {
    return fallbackTaskOutput(raw);
  }
}

const taskAgent = new TaskAgent();

export async function executeTask(input: TaskAgentInput): Promise<TaskAgentResult> {
  return taskAgent.run(input);
}
