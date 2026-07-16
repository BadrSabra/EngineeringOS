import type { ProjectContext } from "../context-builder.js";
import type { WorkflowPhase } from "../schemas/workflow.schema.js";

export function buildWorkflowSystemPrompt(): string {
  return `You are a workflow orchestration engine for EngineeringOS.
Analyze the workflow state and decide the next action.

You must respond with valid JSON:
{
  "action": "advance" | "wait" | "fail" | "complete",
  "reasoning": "why this action",
  "nextPhase": "name of next phase if action is advance (omit otherwise)",
  "blockers": ["blocker 1", ...] if action is wait,
  "suggestions": ["suggestion 1", ...] optional improvements
}`;
}

export function buildWorkflowUserPrompt(opts: {
  workflowName: string;
  phases: WorkflowPhase[];
  currentPhase: string | null;
  completedPhases: string[];
  projectContext: ProjectContext;
  additionalContext?: string;
}): string {
  const { workflowName, phases, currentPhase, completedPhases, projectContext } = opts;

  const phasesSummary = phases
    .map((p, i) => {
      const status = completedPhases.includes(p.name)
        ? "✓ completed"
        : p.name === currentPhase
          ? "→ current"
          : "○ pending";
      return `${i + 1}. ${p.name} [${status}]: ${p.steps.join(", ")}${p.condition ? ` (condition: ${p.condition})` : ""}`;
    })
    .join("\n");

  return `Orchestrate this workflow:

**Workflow:** ${workflowName}
**Current Phase:** ${currentPhase ?? "not started"}
**Completed Phases:** ${completedPhases.length > 0 ? completedPhases.join(", ") : "none"}

**Phase Definitions:**
${phasesSummary}

**Project context:**
- ${projectContext.project}
- Metrics: ${projectContext.latestMetrics}
- Recent tasks: ${projectContext.recentTasks}
- Recent events: ${projectContext.recentEvents}

${opts.additionalContext ? `**Additional context:** ${opts.additionalContext}` : ""}

Decide the best next action for this workflow.`;
}
