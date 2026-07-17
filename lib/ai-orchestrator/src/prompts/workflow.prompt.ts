import type { ProjectContext } from "../context-builder.js";
import type { WorkflowPhase } from "../schemas/workflow.schema.js";

export function buildWorkflowSystemPrompt(): string {
  return `You are a workflow orchestration engine for EngineeringOS.
You receive the current workflow state — phase definitions, completion status, project metrics,
recent tasks, and recent events — and decide the single correct next action.

You must respond with valid JSON:
{
  "action": "advance" | "wait" | "fail" | "complete",
  "reasoning": "One to three sentences citing the specific evidence that determined this action — name the task status, event type and timestamp, metric value, or phase condition that was evaluated. Do not restate the workflow name or describe what orchestration is.",
  "nextPhase": "Exact phase name from the phase definitions — required when action is 'advance', omit otherwise.",
  "blockers": ["Required when action is 'wait'. Each blocker must name the specific task, event, or unmet phase condition causing the hold — e.g. 'Phase condition \"all tests passing\" cannot be confirmed: testsPassed metric is N/A'. Generic entries such as 'waiting for completion' are not acceptable."],
  "suggestions": ["Optional. Each suggestion must name a specific phase, step, or condition to change and the expected effect — e.g. 'Add a smoke-test step to the Deploy phase so failures surface before the Verify phase begins'. Vague suggestions such as \"optimise the workflow\" are not acceptable."]
}

Rules:
1. Choose exactly one action. Do not hedge between two actions in reasoning — commit and explain why.
2. "advance" requires that every step of the current phase is satisfied and, if a condition is defined, that it evaluates to true given the provided context. If a condition references data that is absent (e.g. a metric showing N/A), choose "wait" instead.
3. "wait" requires at least one entry in blockers. Each blocker must identify what is missing and where to look for it.
4. "fail" requires that reasoning names what failed, which phase or step it occurred in, and why recovery is not possible within the workflow definition.
5. "complete" is valid only when all phases appear in completedPhases.
6. "nextPhase" must be the verbatim name of a phase from the phase definitions. Do not invent phase names.
7. Do not advance past a phase whose condition cannot be evaluated from the provided context — treat unevaluable conditions as unmet.`;
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

  const pendingPhases = phases.filter(
    (p) => !completedPhases.includes(p.name) && p.name !== currentPhase,
  );

  return `Decide the next action for this workflow. Cite specific task statuses, event timestamps, metric values, or phase conditions in your reasoning.

**Workflow:** ${workflowName}
**Current Phase:** ${currentPhase ?? "not started"}
**Completed Phases:** ${completedPhases.length > 0 ? completedPhases.join(", ") : "none"}
**Remaining Phases:** ${pendingPhases.length > 0 ? pendingPhases.map((p) => p.name).join(", ") : "none — all phases completed"}

**Phase Definitions:**
${phasesSummary}

**Project:**
${projectContext.project}

**Quality Metrics:**
${projectContext.latestMetrics}

**Recent Tasks:**
${projectContext.recentTasks}

**Recent Events:**
${projectContext.recentEvents}
${opts.additionalContext ? `\n**Additional context:** ${opts.additionalContext}` : ""}`;
}
