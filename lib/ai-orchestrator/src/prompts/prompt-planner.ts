import type { PromptContextProfile } from "./prompt-composer.js";
import type { TaskType } from "../quality/task-profile.js";

export type PromptPlan = {
  contextProfile: PromptContextProfile;
  useTools: boolean;
  streamingMode: boolean;
};

const PROMPT_PROFILE_BY_TASK: Record<TaskType, PromptContextProfile> = {
  chat: "chat",
  tool_chat: "chat",
  analysis: "scan",
  task_execution: "task",
  code_review: "review",
  workflow: "workflow",
};

export function buildPromptContextProfile(taskType: TaskType): PromptContextProfile {
  return PROMPT_PROFILE_BY_TASK[taskType];
}

export function buildPromptPlan(taskType: TaskType): PromptPlan {
  return {
    contextProfile: buildPromptContextProfile(taskType),
    useTools: taskType === "tool_chat",
    streamingMode: taskType === "chat" || taskType === "tool_chat",
  };
}
