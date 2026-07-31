import type { ProjectContext } from "../context-builder.js";

export type PromptContextSection = keyof Pick<
  ProjectContext,
  "project" | "latestMetrics" | "graphSummary" | "recentTasks" | "recentEvents" | "workflows"
>;

export type PromptContextProfile = "full" | "chat" | "task" | "scan" | "review" | "workflow";

const PROFILE_SECTIONS: Record<PromptContextProfile, readonly PromptContextSection[]> = {
  full: ["project", "latestMetrics", "graphSummary", "workflows", "recentTasks", "recentEvents"],
  chat: ["project", "latestMetrics", "graphSummary", "workflows", "recentTasks", "recentEvents"],
  task: ["project", "latestMetrics", "graphSummary", "recentTasks", "recentEvents"],
  scan: ["project", "latestMetrics", "graphSummary", "recentTasks", "recentEvents"],
  review: ["project", "latestMetrics", "graphSummary", "recentTasks", "recentEvents"],
  workflow: ["project", "latestMetrics", "workflows", "recentTasks", "recentEvents"],
};

export function composePrompt(...parts: Array<string | null | undefined | false>): string {
  return parts
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join("\n\n");
}

export function promptSection(title: string, body: string): string {
  return `**${title}:**\n${body}`;
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
): string {
  const sections = new Set(PROFILE_SECTIONS[profile]);

  return composePrompt(
    ...(sections.has("project") ? [promptSection("Project", context.project)] : []),
    ...(sections.has("latestMetrics") ? [promptSection("Quality Metrics", context.latestMetrics)] : []),
    ...(sections.has("graphSummary") ? [promptSection("Knowledge Graph", context.graphSummary)] : []),
    ...(sections.has("workflows") ? [promptSection("Workflows", context.workflows)] : []),
    ...(sections.has("recentTasks") ? [promptSection("Recent Tasks", context.recentTasks)] : []),
    ...(sections.has("recentEvents") ? [promptSection("Recent Events", context.recentEvents)] : []),
  );
}
