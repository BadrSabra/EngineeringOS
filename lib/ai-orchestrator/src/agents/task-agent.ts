/**
 * Task Agent — reads a task's prompt and description, executes it via LLM,
 * and returns a structured response that gets written back as agentResponse.
 */
import { complete, MODEL_POWERFUL, type Message } from "../groq-client.js";
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

function fallbackTaskOutput(raw: string): TaskAgentOutput {
  return {
    summary: "Task analyzed by AI agent",
    steps: ["Analysis completed"],
    result: raw.trim() || "The model did not return a structured result.",
    confidence: "medium",
    needsHumanReview: true,
  };
}

export async function executeTask(input: TaskAgentInput): Promise<TaskAgentOutput> {
  const messages: Message[] = [
    { role: "system", content: buildTaskAgentSystemPrompt(input.projectContext) },
    { role: "user", content: buildTaskAgentUserPrompt(input) },
  ];

  const response = await complete(messages, { model: MODEL_POWERFUL, apiKey: input.apiKey });
  const parsed = parseAgentResponse(response.content, TaskRecommendationSchema, fallbackTaskOutput);
  if (!parsed.ok) {
    console.warn(JSON.stringify({ scope: "task-agent", code: parsed.code, message: parsed.message }));
  }
  return parsed.data;
}
