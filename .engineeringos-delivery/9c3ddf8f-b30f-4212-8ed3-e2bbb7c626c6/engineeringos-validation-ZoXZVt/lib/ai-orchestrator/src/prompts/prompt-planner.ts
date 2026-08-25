import type { PromptContextProfile } from "./prompt-composer.js";
import type { TaskType, TaskProfile, ContextIntensity } from "../quality/task-profile.js";

export type PromptPlan = {
  contextProfile: PromptContextProfile;
  useTools: boolean;
  streamingMode: boolean;
};

/** Maps contextIntensity → tiered chat profile. */
const CHAT_TIER: Record<ContextIntensity, PromptContextProfile> = {
  lite:   "chat-lite",
  normal: "chat-normal",
  deep:   "chat-deep",
};

/** Fallback mapping for non-chat task types. */
const PROFILE_BY_TASK: Record<TaskType, PromptContextProfile> = {
  chat:           "chat-normal",  // overridden by contextIntensity when full TaskProfile is available
  tool_chat:      "chat-normal",  // overridden by contextIntensity when full TaskProfile is available
  analysis:       "scan",
  task_execution: "task",
  code_review:    "review",
  workflow:       "workflow",
};

/**
 * Legacy helper — accepts only TaskType (no context intensity).
 * Prefer buildPromptPlan(TaskProfile) whenever a full profile is available.
 */
export function buildPromptContextProfile(taskType: TaskType): PromptContextProfile {
  return PROFILE_BY_TASK[taskType];
}

/**
 * Builds a PromptPlan from a full TaskProfile.
 * For chat task types, the contextIntensity field drives the tier selection
 * (chat-lite / chat-normal / chat-deep) instead of a flat "chat" profile.
 */
export function buildPromptPlan(profile: TaskProfile): PromptPlan {
  const isChatType = profile.taskType === "chat" || profile.taskType === "tool_chat";
  const contextProfile: PromptContextProfile = isChatType
    ? CHAT_TIER[profile.contextIntensity]
    : PROFILE_BY_TASK[profile.taskType];

  return {
    contextProfile,
    useTools: profile.taskType === "tool_chat",
    streamingMode: isChatType,
  };
}
