import { createHash } from "node:crypto";
import { z } from "zod";

const SuggestionsSchema = z.array(z.string().min(1).max(400)).max(8);
const ReasoningSchema = z.string().min(1).max(4_000);

const WorkflowDecisionReceiptSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("advance"),
    reasoning: ReasoningSchema,
    nextPhase: z.string().min(1).max(4_000),
    suggestions: SuggestionsSchema.optional(),
  }).strict(),
  z.object({
    action: z.literal("wait"),
    reasoning: ReasoningSchema,
    blockers: z.array(z.string().min(1).max(400)).min(1).max(8).optional(),
    suggestions: SuggestionsSchema.optional(),
  }).strict(),
  z.object({
    action: z.literal("fail"),
    reasoning: ReasoningSchema,
    suggestions: SuggestionsSchema.optional(),
  }).strict(),
  z.object({
    action: z.literal("complete"),
    reasoning: ReasoningSchema,
    suggestions: SuggestionsSchema.optional(),
  }).strict(),
]);

const WorkflowOrchestrationDispositionSchema = z.object({
  kind: z.literal("workflow_orchestration_decision"),
  version: z.literal(1),
  workflowId: z.string().min(1).max(160),
  requestKey: z.string().min(1).max(320),
  decision: WorkflowDecisionReceiptSchema,
}).strict();

export type WorkflowOrchestrationContextSnapshot = {
  project: string;
  recentTasks: string;
  latestMetrics: string;
  graphSummary: string;
  recentEvents: string;
  workflows: string;
  worldState?: string;
  metricsVerified: boolean;
  workspaceRevision: string;
  scanCorrelationId?: string | null;
};

/**
 * Hash the project context that influences orchestration. Exclude only prior
 * AiWorkflowOrchestration event lines: this route appends its own event, which
 * must not make an identical retry appear to be a new request.
 */
export function fingerprintWorkflowOrchestrationContext(
  context: WorkflowOrchestrationContextSnapshot,
): string {
  const stableEvents = context.recentEvents
    .split("\n")
    .filter((line) => !line.includes("AiWorkflowOrchestration:"))
    .join("\n");
  return createHash("sha256").update(JSON.stringify({
    project: context.project,
    recentTasks: context.recentTasks,
    latestMetrics: context.latestMetrics,
    graphSummary: context.graphSummary,
    recentEvents: stableEvents,
    workflows: context.workflows,
    worldState: context.worldState ?? null,
    metricsVerified: context.metricsVerified,
    workspaceRevision: context.workspaceRevision,
    scanCorrelationId: context.scanCorrelationId ?? null,
  })).digest("hex");
}

export type WorkflowOrchestrationRequestIdentity = {
  workflowId: string;
  baseExecutionKey: string;
  workflowRevision: string;
  phases: readonly unknown[];
  currentPhase: string | null;
  completedPhases: readonly string[];
  contextFingerprint: string;
  additionalContext?: string;
};

/**
 * Bind the decision idempotency key to the complete workflow-state snapshot
 * and operator context, not only the long-lived workflow execution id.
 */
export function buildWorkflowOrchestrationRequestKey(
  input: WorkflowOrchestrationRequestIdentity,
): string {
  const fingerprint = createHash("sha256").update(JSON.stringify({
    workflowId: input.workflowId,
    workflowRevision: input.workflowRevision,
    phases: input.phases,
    currentPhase: input.currentPhase,
    completedPhases: input.completedPhases,
    contextFingerprint: input.contextFingerprint,
    additionalContext: input.additionalContext ?? null,
  })).digest("hex").slice(0, 24);
  return `${input.baseExecutionKey}:decision:${fingerprint}`;
}

export type WorkflowOrchestrationDisposition = z.infer<
  typeof WorkflowOrchestrationDispositionSchema
>;

type BuildWorkflowOrchestrationDispositionInput = {
  workflowId: string;
  requestKey: string;
  decision: unknown;
};

function boundedStrings(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .slice(0, 8)
    .map((entry) => entry.slice(0, 400));
}

function boundedDecision(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const candidate = value as Record<string, unknown>;
  const suggestions = boundedStrings(candidate.suggestions);
  const common = {
    action: candidate.action,
    reasoning: typeof candidate.reasoning === "string"
      ? candidate.reasoning.slice(0, 4_000)
      : candidate.reasoning,
    ...(suggestions ? { suggestions } : {}),
  };

  switch (candidate.action) {
    case "advance":
      return {
        ...common,
        nextPhase: typeof candidate.nextPhase === "string"
          ? candidate.nextPhase.slice(0, 4_000)
          : candidate.nextPhase,
      };
    case "wait": {
      const blockers = boundedStrings(candidate.blockers);
      return { ...common, ...(blockers ? { blockers } : {}) };
    }
    case "fail":
    case "complete":
      return common;
    default:
      return candidate;
  }
}

/**
 * Persist the bounded decision with the execution acceptance. The acceptance
 * record is the replay authority; event payloads remain projections.
 */
export function buildWorkflowOrchestrationDisposition(
  input: BuildWorkflowOrchestrationDispositionInput,
): WorkflowOrchestrationDisposition {
  return WorkflowOrchestrationDispositionSchema.parse({
    kind: "workflow_orchestration_decision",
    version: 1,
    workflowId: input.workflowId,
    requestKey: input.requestKey,
    decision: boundedDecision(input.decision),
  });
}

/**
 * Recover a prior decision only when the receipt is valid and bound to the
 * exact workflow/request identity. Invalid or legacy receipts fail closed.
 */
export function parseWorkflowOrchestrationDisposition(
  value: unknown,
  expected: { workflowId: string; requestKey: string },
): z.infer<typeof WorkflowDecisionReceiptSchema> | undefined {
  const parsed = WorkflowOrchestrationDispositionSchema.safeParse(value);
  if (
    !parsed.success
    || parsed.data.workflowId !== expected.workflowId
    || parsed.data.requestKey !== expected.requestKey
  ) return undefined;
  return parsed.data.decision;
}
