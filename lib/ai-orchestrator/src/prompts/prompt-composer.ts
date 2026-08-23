import type { ProjectContext } from "../context-builder.js";
import { formatUntrustedContent, type UntrustedContentSource } from "../untrusted-content.js";

export type PromptContextSection = keyof Pick<
  ProjectContext,
  "project" | "latestMetrics" | "graphSummary" | "recentTasks" | "recentEvents" | "workflows"
>;

export type PromptContextProfile =
  | "full"
  | "chat-lite"    // minimal: project info only
  | "chat-normal"  // standard: project + metrics + recent tasks
  | "chat-deep"    // full: all sections (matches old "chat" / "full")
  | "chat"         // legacy alias — new code should use chat-lite/normal/deep
  | "task"
  | "scan"
  | "review"
  | "workflow";

const PROFILE_SECTIONS: Record<PromptContextProfile, readonly PromptContextSection[]> = {
  full:          ["project", "latestMetrics", "graphSummary", "workflows", "recentTasks", "recentEvents"],
  "chat-lite":   ["project"],
  "chat-normal": ["project", "latestMetrics", "recentTasks"],
  "chat-deep":   ["project", "latestMetrics", "graphSummary", "workflows", "recentTasks", "recentEvents"],
  chat:          ["project", "latestMetrics", "recentTasks"],   // legacy; maps to chat-normal semantics
  task:          ["project", "latestMetrics", "graphSummary", "recentTasks", "recentEvents"],
  scan:          ["project", "latestMetrics", "graphSummary", "recentTasks", "recentEvents"],
  review:        ["project", "latestMetrics", "graphSummary", "recentTasks", "recentEvents"],
  workflow:      ["project", "latestMetrics", "workflows", "recentTasks", "recentEvents"],
};

export function composePrompt(...parts: Array<string | null | undefined | false>): string {
  return parts
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join("\n\n");
}

export function promptSection(title: string, body: string): string {
  return `**${title}:**\n${body}`;
}

/**
 * Project context is assembled from repository, git, telemetry, and durable
 * state. Keep it data-only when it crosses into any agent prompt.
 */
export function promptEvidenceSection(
  title: string,
  body: unknown,
  source: UntrustedContentSource = "tool_output",
): string {
  return promptSection(title, formatUntrustedContent(body, { source, path: title }));
}

export function promptCodeBlock(content: string, language = "text"): string {
  return `\`\`\`${language}\n${content}\n\`\`\``;
}

export function promptList(items: string[], indent = ""): string {
  return items.map((item) => `${indent}- ${item}`).join("\n");
}

export function promptContextOverview(
  context: ProjectContext,
  profile: PromptContextProfile = "full",
  options: { includeSessionMemory?: boolean } = {},
): string {
  const sections = new Set(PROFILE_SECTIONS[profile]);
  const includeSessionMemory = options.includeSessionMemory ?? true;

  return composePrompt(
    ...(sections.has("project") ? [promptEvidenceSection("Project", context.project, "source")] : []),
    ...(sections.has("latestMetrics") ? [promptEvidenceSection("Quality Metrics", context.latestMetrics, "provider_diagnostic")] : []),
    ...(sections.has("graphSummary") ? [promptEvidenceSection("Knowledge Graph", context.graphSummary, "source")] : []),
    ...(sections.has("workflows") ? [promptEvidenceSection("Workflows", context.workflows, "checkpoint")] : []),
    ...(sections.has("recentTasks") ? [promptEvidenceSection("Recent Tasks", context.recentTasks, "tool_output")] : []),
    ...(sections.has("recentEvents") ? [promptEvidenceSection("Recent Events", context.recentEvents, "tool_output")] : []),
    ...(includeSessionMemory && context.sessionMemories
      ? [promptEvidenceSection("Prior Session Memory", context.sessionMemories, "session_memory")]
      : []),
  );
}
