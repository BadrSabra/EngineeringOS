/**
 * Workflow Orchestrator — given a workflow definition and current execution
 * state, decides the next action: advance, wait, fail, or complete.
 *
 * The workflow engine is split into dedicated modules:
 *   decide()           — ask the model for a proposed decision
 *   validateDecision() — reject any decision inconsistent with real state
 *   executeDecision()  — apply a state transition; validates internally so
 *                        no caller can bypass the guard by calling this
 *                        function directly with an unvalidated decision
 */
import type { AgentErrorCode } from "../errors.js";
import type { Message } from "../groq-client.js";
import type { ProjectContext } from "../context-builder.js";
import { agentComplete } from "../agent-complete.js";
import type { ProviderId } from "../agent-complete.js";
import { assessStructuredOutput } from "../quality-engine.js";
import { buildExecutionPlan } from "../quality/quality-planner.js";
import { decideRetry } from "../quality/retry-controller.js";
import { buildWorkflowSystemPrompt, buildWorkflowUserPrompt } from "../prompts/workflow.prompt.js";
import { WorkflowDecisionSchema, type WorkflowDecision, type WorkflowPhase } from "../schemas/workflow.schema.js";
import { parseAgentResponse } from "../parsing.js";
import { executeWorkflowDecision } from "./workflow-engine/executor.js";
import { validateWorkflowDecision } from "./workflow-engine/guard.js";
import type { WorkflowState } from "./workflow-engine/state.js";

export type { WorkflowPhase };
/** @deprecated use `WorkflowDecision` from "../schemas/workflow.schema.js" */
export type OrchestrationDecision = WorkflowDecision;

/**
 * PR-E: Extended return type that carries an optional parse-failure marker.
 * When the model output cannot be parsed, the route surfaces `_parseError`
 * as HTTP 422 instead of a silent 200 with a degraded "wait" fallback.
 */
export type WorkflowDecisionResult = WorkflowDecision & {
  _parseError?: { code: AgentErrorCode; message: string; raw: string };
};

export type { WorkflowState };

function fallbackDecision(raw: string): WorkflowDecision {
  return {
    action: "wait",
    reasoning: raw.trim() || "Model did not return a usable decision; holding at current phase for manual review.",
    suggestions: ["Review workflow state manually"],
  };
}

/**
 * Asks the model for a proposed decision. Never throws on bad model output —
 * parse/schema failures degrade to a "wait" fallback (see `parseAgentResponse`).
 */
export async function decide(opts: {
  workflowName: string;
  phases: WorkflowPhase[];
  currentPhase: string | null;
  completedPhases: string[];
  projectContext: ProjectContext;
  additionalContext?: string;
  /** Optional per-user API key. Falls back to GROQ_API_KEY env for Groq; required for DeepSeek. */
  apiKey?: string;
  /** AI provider to use. Defaults to "groq". */
  provider?: ProviderId;
}): Promise<WorkflowDecisionResult> {
  const messages: Message[] = [
    { role: "system", content: buildWorkflowSystemPrompt() },
    { role: "user", content: buildWorkflowUserPrompt(opts) },
  ];

  const executionPlan = buildExecutionPlan("workflow", { retryLimit: 2 });
  const parseResponse = (raw: string) => parseAgentResponse(raw, WorkflowDecisionSchema, fallbackDecision);

  const completionOpts = {
    apiKey: opts.apiKey,
    provider: opts.provider,
    qualityProfile: executionPlan.qualityProfile,
    qualityHints: executionPlan.strictHints,
  };

  const response = await agentComplete(messages, completionOpts);
  let parsed = parseResponse(response.content);
  let parseError = parsed.ok ? undefined : { code: parsed.code, message: parsed.message, raw: parsed.raw };
  const assessment = parsed.ok ? assessStructuredOutput(executionPlan.qualityProfile, parsed.data) : undefined;
  const retryDecision = decideRetry({
    attempt: 1,
    limit: executionPlan.retryLimit,
    parseError,
    assessment,
  });

  if (retryDecision.shouldRetry) {
    console.warn(
      JSON.stringify({
        scope: "workflow-orchestrator",
        stage: "decide",
        code: "MODEL_RETRY",
        reason: retryDecision.reason,
      }),
    );

    const retryResponse = await agentComplete(messages, {
      ...completionOpts,
      qualityHints: executionPlan.relaxedHints,
    });
    parsed = parseResponse(retryResponse.content);
    parseError = parsed.ok ? undefined : { code: parsed.code, message: parsed.message, raw: parsed.raw };
  }

  if (!parsed.ok) {
    console.warn(JSON.stringify({ scope: "workflow-orchestrator", stage: "decide", code: parsed.code, message: parsed.message }));
    // PR-E: surface parse failure to the route so it can return 422 instead of
    // silently returning a degraded "wait" fallback as a 200.
    return { ...parsed.data, _parseError: parseError };
  }
  return parsed.data;
}

/** Back-compat convenience for callers that just want validation. */
export function validateDecision(
  decision: WorkflowDecision,
  state: Pick<WorkflowState, "phases" | "currentPhase">,
): WorkflowDecision {
  return validateWorkflowDecision(decision, state);
}

/** Back-compat convenience for callers that just want a validated decision (decide → validate). */
export async function orchestrateWorkflow(opts: {
  workflowName: string;
  phases: WorkflowPhase[];
  currentPhase: string | null;
  completedPhases: string[];
  projectContext: ProjectContext;
  additionalContext?: string;
  /** Optional per-user API key. Falls back to GROQ_API_KEY env for Groq; required for DeepSeek/OpenRouter. */
  apiKey?: string;
  /** AI provider to use. Defaults to "groq". */
  provider?: ProviderId;
}): Promise<WorkflowDecisionResult> {
  const proposed = await decide(opts);
  const parseError = proposed._parseError;

  const metricsUnverified = !opts.projectContext.metricsVerified;
  if (metricsUnverified && (proposed.action === "advance" || proposed.action === "complete")) {
    const reason =
      `Metrics gate: workflow cannot advance while project metrics are unverified. ` +
      `Run a scan first so the orchestrator has reliable data to base its decision on.`;
    console.warn(
      JSON.stringify({
        scope: "workflow-orchestrator",
        code: "METRICS_GATE_BLOCKED",
        proposedAction: proposed.action,
        nextPhase: "nextPhase" in proposed ? proposed.nextPhase : undefined,
      }),
    );
    return { action: "wait", reasoning: reason, blockers: [reason] };
  }

  const validated = validateWorkflowDecision(proposed, { phases: opts.phases, currentPhase: opts.currentPhase });

  if (validated.action !== proposed.action) {
    console.warn(
      JSON.stringify({
        scope: "workflow-orchestrator",
        code: "DECISION_DOWNGRADED",
        originalAction: proposed.action,
        downgradedTo: validated.action,
        reason: validated.reasoning,
        nextPhase: "nextPhase" in proposed ? proposed.nextPhase : undefined,
      }),
    );
  }

  return parseError ? { ...validated, _parseError: parseError } : validated;
}

export { executeWorkflowDecision as executeDecision };
