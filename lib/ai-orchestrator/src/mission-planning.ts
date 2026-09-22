import {
  buildGeneralTaskPlan,
  type GeneralTaskPlan,
} from "./task-planner.js";
import {
  resolveTurnIntent,
  type TurnIntent,
} from "./turn-intent.js";

export type MissionAdmissionKind = "chat" | "project_query" | "mission";

export type MissionAdmissionReason =
  | "low_risk_chat"
  | "evidence_or_project_context"
  | "multi_step_or_mutating_objective";

export type MissionPlanPreview = {
  version: 1;
  objective: string;
  admission: MissionAdmissionKind;
  admissionReason: MissionAdmissionReason;
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

  return {
    version: 1,
    objective: plan.objective,
    admission: admission.admission,
    admissionReason: admission.reason,
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