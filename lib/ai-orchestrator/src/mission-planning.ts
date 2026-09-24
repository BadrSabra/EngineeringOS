import {
  buildGeneralTaskPlan,
  type GeneralTaskPlan,
} from "./task-planner.js";
import {
  resolveTurnIntent,
  type TurnIntent,
} from "./turn-intent.js";
import {
  FailureDiagnosisSummarySchema,
  type FailureDiagnosisSummary,
} from "./agent-state/failure-contract.js";

export type MissionAdmissionKind = "chat" | "project_query" | "mission";

export type MissionAdmissionReason =
  | "low_risk_chat"
  | "evidence_or_project_context"
  | "multi_step_or_mutating_objective";

/**
 * Server-derived recovery context carried into a fresh Mission plan revision.
 * This is deliberately bounded metadata: it is not provider reasoning and it
 * never grants additional scope or mutation authority.
 */
export type MissionReplanContext = {
  failedGoalId?: string;
  failureClass?: string;
  failureCode?: string;
  failureDiagnosis?: FailureDiagnosisSummary;
  affectedPaths: string[];
  affectedClaims: string[];
  evidenceRefs: string[];
  hypothesisImpact?: string;
  nextActions: string[];
  priorPlanRevision?: string;
};

export type MissionPlanPreview = {
  version: 1;
  objective: string;
  admission: MissionAdmissionKind;
  admissionReason: MissionAdmissionReason;
  replanContext?: MissionReplanContext;
  turnIntent: Pick<
    TurnIntent,
    | "kind"
    | "executionTaskType"
    | "requiresTools"
    | "requiresEvidence"
    | "allowsBuildHandoff"
    | "compoundExecution"
    | "compoundWrite"
    | "phases"
  >;
  plan: GeneralTaskPlan;
};

function classifyAdmission(
  intent: TurnIntent,
  plan: GeneralTaskPlan,
): { admission: MissionAdmissionKind; reason: MissionAdmissionReason } {
  const hasMutation = plan.steps.some((step) =>
    step.readOnly === false || step.approvalRequired,
  );
  const hasMultiplePhases = intent.phases.length > 1;
  const isDurableObjective =
    intent.kind === "DELIVERY"
    || intent.compoundExecution
    || intent.compoundWrite
    || hasMutation
    || hasMultiplePhases;

  if (isDurableObjective) {
    return {
      admission: "mission",
      reason: "multi_step_or_mutating_objective",
    };
  }
  if (intent.kind === "PROJECT_QUERY" || intent.kind === "FORENSIC_AUDIT") {
    return {
      admission: "project_query",
      reason: "evidence_or_project_context",
    };
  }
  return {
    admission: "chat",
    reason: "low_risk_chat",
  };
}

/**
 * Builds a read-only admission and plan preview by coordinating the existing
 * intent resolver and general task planner. It never creates durable rows,
 * leases, proposals, or execution handles.
 */
export function buildMissionPlanPreview(input: {
  message: string;
  objective?: string;
  projectOrientation?: boolean;
  replanContext?: MissionReplanContext;
}): MissionPlanPreview {
  const intent = resolveTurnIntent(input.message, {
    projectOrientation: input.projectOrientation === true,
  });
  const plan = buildGeneralTaskPlan({
    message: input.message,
    objective: input.objective,
    projectOrientation: input.projectOrientation === true,
    turnIntent: intent,
  });
  const admission = classifyAdmission(intent, plan);
  const failureDiagnosis = input.replanContext?.failureDiagnosis
    ? FailureDiagnosisSummarySchema.safeParse(input.replanContext.failureDiagnosis)
    : undefined;

  return {
    version: 1,
    objective: plan.objective,
    admission: admission.admission,
    admissionReason: admission.reason,
    ...(input.replanContext ? {
      replanContext: {
        ...(input.replanContext.failedGoalId ? { failedGoalId: input.replanContext.failedGoalId.slice(0, 120) } : {}),
        ...(input.replanContext.failureClass ? { failureClass: input.replanContext.failureClass.slice(0, 80) } : {}),
        ...(input.replanContext.failureCode ? { failureCode: input.replanContext.failureCode.slice(0, 120) } : {}),
        ...(failureDiagnosis?.success
          ? { failureDiagnosis: failureDiagnosis.data }
          : {}),
        affectedPaths: input.replanContext.affectedPaths.slice(0, 24).map((path) => path.slice(0, 500)),
        affectedClaims: input.replanContext.affectedClaims.slice(0, 24).map((claim) => claim.slice(0, 240)),
        evidenceRefs: input.replanContext.evidenceRefs.slice(0, 16).map((ref) => ref.slice(0, 500)),
        ...(input.replanContext.hypothesisImpact
          ? { hypothesisImpact: input.replanContext.hypothesisImpact.slice(0, 500) }
          : {}),
        nextActions: input.replanContext.nextActions.slice(0, 8).map((action) => action.slice(0, 240)),
        ...(input.replanContext.priorPlanRevision
          ? { priorPlanRevision: input.replanContext.priorPlanRevision.slice(0, 200) }
          : {}),
      },
    } : {}),
    turnIntent: {
      kind: intent.kind,
      executionTaskType: intent.executionTaskType,
      requiresTools: intent.requiresTools,
      requiresEvidence: intent.requiresEvidence,
      allowsBuildHandoff: intent.allowsBuildHandoff,
      compoundExecution: intent.compoundExecution,
      compoundWrite: intent.compoundWrite,
      phases: intent.phases,
    },
    plan,
  };
}