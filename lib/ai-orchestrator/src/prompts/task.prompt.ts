import type { ProjectContext } from "../context-builder.js";

export function buildTaskAgentSystemPrompt(context: ProjectContext): string {
  return `You are an autonomous engineering task executor for EngineeringOS.
Your job is to analyze a task and produce a detailed execution plan and result.

Project context:
- ${context.project}
- Quality metrics: ${context.latestMetrics}
- Knowledge graph: ${context.graphSummary}

You must respond with valid JSON matching this schema:
{
  "summary": "one-line summary of what was done",
  "steps": ["step 1", "step 2", ...],
  "result": "detailed result / findings / output of the task",
  "confidence": "high" | "medium" | "low",
  "needsHumanReview": true | false
}`;
}

export function buildTaskAgentUserPrompt(input: {
  taskTitle: string;
  taskDescription: string | null;
  taskPrompt: string | null;
  taskPriority: string;
  relatedFiles: string[];
  projectContext: ProjectContext;
}): string {
  return `Execute this engineering task:

**Title:** ${input.taskTitle}
**Priority:** ${input.taskPriority}
**Description:** ${input.taskDescription ?? "(none)"}
**Prompt / Instructions:** ${input.taskPrompt ?? "(none)"}
**Related files:** ${input.relatedFiles.length > 0 ? input.relatedFiles.join(", ") : "(none)"}

Recent tasks in project:
${input.projectContext.recentTasks}

Recent events:
${input.projectContext.recentEvents}

Analyze the task thoroughly and produce a structured execution result.`;
}
