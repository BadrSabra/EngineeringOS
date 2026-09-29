import { createHash } from "node:crypto";
import {
  buildGeneralTaskPlan,
  type GeneralTaskPlan,
  type ApplyChangesRequirement,
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

export type RuntimeStartOutcomeKey =
  | "runtime_running"
  | "runtime_not_running"
  | "runtime_other"
  | "runtime_unexpected";

export type RuntimeStartHypothesisReplanEvidence = {
  experimentId: string;
  planRevision: string;
  calibrationScopeRef: string;
  calibrationAssessmentRef: string;
  resultId: string;
  actualOutcomeKey: RuntimeStartOutcomeKey;
  verdict: "matched" | "contradicted" | "inconclusive";
  observationRefs: string[];
  supportingHypothesisIds: string[];
  contradictingHypothesisIds: string[];
  beliefUpdateStatus: "unresolved_unvalidated_forecast";
};

export type BoundedWorldStateValue =
  | null
  | boolean
  | number
  | string
  | BoundedWorldStateValue[]
  | { [key: string]: BoundedWorldStateValue };

export type MissionWorldStatePlanningFact = {
  id: string;
  subject: string;
  predicate: string;
  valueHash: string;
  value: BoundedWorldStateValue;
  status: "believed" | "confirmed";
  sourceObservationIds: string[];
};

export type MissionWorldStatePlanningRead = {
  kind: "advisory_world_state_read";
  planningReadRevision: string;
  worldRevision: string;
  sourceEpisodeId: string;
  sourceExecutionId: string;
  sourceAttempt: number;
  sourceEpisodeWorldRevision?: string;
  taskScope: string;
  projectRevision: string;
  environmentRevision: string;
  facts: MissionWorldStatePlanningFact[];
};

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

const SENSITIVE_WORLD_STATE_LABEL =
  /(?:secret|password|passphrase|credential|private[\s_-]*key|api[\s_-]*key|access[\s_-]*key|session[\s_-]*key|client[\s_-]*secret|token|authorization|cookie|connection[\s_-]*string)/i;
const SENSITIVE_TOKEN_PATTERNS = [
  /\b(?:sk|rk)[_-][A-Za-z0-9_-]{16,}\b/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /\bya29\.[0-9A-Za-z_-]+\b/g,
  /\b(?:gh[pousr]_|glpat-)[A-Za-z0-9_-]{16,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{16,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bnpm_[A-Za-z0-9]{20,}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
];

function sanitizeUntrustedWorldStateString(value: string): string {
  let sanitized = value
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gi, "[redacted private key]");
  for (const pattern of SENSITIVE_TOKEN_PATTERNS) {
    sanitized = sanitized.replace(pattern, "[redacted token]");
  }
  return sanitized
    .replace(/\b(Bearer)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [redacted]")
    .replace(/\b(password|passphrase|secret|credential|token|api[_-]?key|access[_-]?key|session[_-]?key|client[_-]?secret|authorization)\b\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/([a-z][a-z0-9+.-]*:\/\/[^:\s/]+:)[^@\s/]+(@)/gi, "$1[redacted]$2")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .slice(0, 400);
}

function boundedWorldStateValue(value: unknown, depth = 0): BoundedWorldStateValue {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return sanitizeUntrustedWorldStateString(value);
  if (depth >= 3) return "[depth-limit]";
  if (Array.isArray(value)) {
    return value.slice(0, 8).map((item) => boundedWorldStateValue(item, depth + 1));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .slice(0, 12)
        .map(([key, item]) => [
          key.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 80),
          SENSITIVE_WORLD_STATE_LABEL.test(key)
            ? "[redacted]"
            : boundedWorldStateValue(item, depth + 1),
        ]),
    );
  }
  return null;
}

function boundedReadString(
  record: Record<string, unknown>,
  key: string,
  max: number,
): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0
    ? value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max)
    : undefined;
}

/**
 * Normalize persisted World State context before it can reach a task prompt.
 * Values remain evidence data, are strictly bounded, and carry no authority.
 */
export function sanitizeMissionWorldStatePlanningRead(
  value: unknown,
): MissionWorldStatePlanningRead | undefined {
  const record = jsonRecord(value);
  const planningReadRevision = boundedReadString(record, "planningReadRevision", 64);
  const worldRevision = boundedReadString(record, "worldRevision", 64);
  const sourceEpisodeId = boundedReadString(record, "sourceEpisodeId", 120);
  const sourceExecutionId = boundedReadString(record, "sourceExecutionId", 120);
  const taskScope = boundedReadString(record, "taskScope", 180);
  const projectRevision = boundedReadString(record, "projectRevision", 200);
  const environmentRevision = boundedReadString(record, "environmentRevision", 120);
  const sourceAttempt = record.sourceAttempt;
  if (
    record.kind !== "advisory_world_state_read"
    || !planningReadRevision
    || !/^[a-f0-9]{64}$/i.test(planningReadRevision)
    || !worldRevision
    || !/^[a-f0-9]{64}$/i.test(worldRevision)
    || !sourceEpisodeId
    || !sourceExecutionId
    || !Number.isInteger(sourceAttempt)
    || typeof sourceAttempt !== "number"
    || sourceAttempt < 0
    || !taskScope
    || !projectRevision
    || !environmentRevision
  ) {
    return undefined;
  }

  const facts = (Array.isArray(record.facts) ? record.facts : [])
    .slice(0, 8)
    .flatMap((candidate): MissionWorldStatePlanningFact[] => {
      const fact = jsonRecord(candidate);
      const id = boundedReadString(fact, "id", 120);
      const subject = boundedReadString(fact, "subject", 160);
      const predicate = boundedReadString(fact, "predicate", 120);
      const valueHash = boundedReadString(fact, "valueHash", 64);
      if (
        !id
        || !subject
        || !predicate
        || !valueHash
        || !/^[a-f0-9]{64}$/i.test(valueHash)
        || (fact.status !== "believed" && fact.status !== "confirmed")
        || SENSITIVE_WORLD_STATE_LABEL.test(`${subject} ${predicate}`)
      ) {
        return [];
      }
      const sourceObservationIds = Array.isArray(fact.sourceObservationIds)
        ? fact.sourceObservationIds
          .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
          .slice(0, 8)
          .map((item) => item.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 120))
          .filter(Boolean)
        : [];
      if (sourceObservationIds.length === 0) return [];
      return [{
        id,
        subject,
        predicate,
        valueHash,
        value: boundedWorldStateValue(fact.value),
        status: fact.status,
        sourceObservationIds,
      }];
    });

  const sourceEpisodeWorldRevision = boundedReadString(record, "sourceEpisodeWorldRevision", 64);
  const normalized: MissionWorldStatePlanningRead = {
    kind: "advisory_world_state_read",
    planningReadRevision,
    worldRevision,
    sourceEpisodeId,
    sourceExecutionId,
    sourceAttempt,
    ...(sourceEpisodeWorldRevision
      && /^[a-f0-9]{64}$/i.test(sourceEpisodeWorldRevision)
      ? { sourceEpisodeWorldRevision }
      : {}),
    taskScope,
    projectRevision,
    environmentRevision,
    facts,
  };
  while (normalized.facts.length > 0 && JSON.stringify(normalized).length > 8_000) {
    normalized.facts.pop();
  }
  return normalized.facts.length > 0 ? normalized : undefined;
}

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
  affectedFacts?: string[];
  affectedClaims: string[];
  evidenceRefs: string[];
  hypothesisImpact?: string;
  runtimeStartHypothesisEvidence?: RuntimeStartHypothesisReplanEvidence;
  worldStatePlanningRead?: MissionWorldStatePlanningRead;
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

export function buildApplyChangesMissionPlanPreview(input: {
  objective: string;
  requirement: ApplyChangesRequirement;
}): MissionPlanPreview {
  const planBody = {
    version: 1 as const,
    objective: input.objective,
    missionMode: "apply_changes" as const,
    applyRequirement: input.requirement,
    steps: [
      {
        id: "apply-changes",
        title: "Apply the approved change proposal",
        kind: "execute" as const,
        dependencies: [] as string[],
        files: [] as string[],
        readOnly: false,
        approvalRequired: false,
      },
      {
        id: "report-applied",
        title: "Report the live applied result",
        kind: "deliver" as const,
        dependencies: ["apply-changes"],
        files: [] as string[],
        readOnly: true,
        approvalRequired: false,
      },
    ],
    conflicts: [] as string[],
    decision: "CREATE" as const,
    source: "new" as const,
    profile: "default" as const,
    turnKind: "DELIVERY" as const,
    executionTaskType: "task_execution",
    skipQueryPlanner: true,
  };
  const planHash = createHash("sha256")
    .update(JSON.stringify(planBody))
    .digest("hex");
  return {
    version: 1,
    objective: input.objective,
    admission: "mission",
    admissionReason: "multi_step_or_mutating_objective",
    turnIntent: {
      kind: "DELIVERY",
      executionTaskType: "task_execution",
      requiresTools: true,
      requiresEvidence: true,
      allowsBuildHandoff: true,
      compoundExecution: true,
      compoundWrite: true,
      phases: ["proposal", "execution", "validation"],
    },
    plan: { ...planBody, planHash },
  };
}

function classifyAdmission(
  intent: TurnIntent,
  plan: GeneralTaskPlan,
): { admission: MissionAdmissionKind; reason: MissionAdmissionReason } {
  const hasMutation = plan.steps.some((step) =>
    step.readOnly === false || step.approvalRequired,
  );
  const hasRuntimeTransition = (plan.transitionRequirements?.length ?? 0) > 0;
  const hasMultiplePhases = intent.phases.length > 1;
  const isDurableObjective =
    intent.kind === "DELIVERY"
    || intent.compoundExecution
    || intent.compoundWrite
    || hasMutation
    || hasRuntimeTransition
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
  runtimeStartTargetStepId?: string | null;
}): MissionPlanPreview {
  const intent = resolveTurnIntent(input.message, {
    projectOrientation: input.projectOrientation === true,
  });
  const plan = buildGeneralTaskPlan({
    message: input.message,
    objective: input.objective,
    projectOrientation: input.projectOrientation === true,
    turnIntent: intent,
    runtimeStartTargetStepId: input.runtimeStartTargetStepId,
  });
  const admission = classifyAdmission(intent, plan);
  const failureDiagnosis = input.replanContext?.failureDiagnosis
    ? FailureDiagnosisSummarySchema.safeParse(input.replanContext.failureDiagnosis)
    : undefined;
  const worldStatePlanningRead = input.replanContext?.worldStatePlanningRead
    ? sanitizeMissionWorldStatePlanningRead(input.replanContext.worldStatePlanningRead)
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
        ...(input.replanContext.affectedFacts
          ? { affectedFacts: input.replanContext.affectedFacts.slice(0, 24).map((fact) => fact.slice(0, 240)) }
          : {}),
        affectedClaims: input.replanContext.affectedClaims.slice(0, 24).map((claim) => claim.slice(0, 240)),
        evidenceRefs: input.replanContext.evidenceRefs.slice(0, 16).map((ref) => ref.slice(0, 500)),
        ...(input.replanContext.hypothesisImpact
          ? { hypothesisImpact: input.replanContext.hypothesisImpact.slice(0, 500) }
          : {}),
        ...(input.replanContext.runtimeStartHypothesisEvidence
          ? {
              runtimeStartHypothesisEvidence: {
                experimentId: input.replanContext.runtimeStartHypothesisEvidence.experimentId.slice(0, 120),
                planRevision: input.replanContext.runtimeStartHypothesisEvidence.planRevision.slice(0, 200),
                calibrationScopeRef: input.replanContext.runtimeStartHypothesisEvidence.calibrationScopeRef.slice(0, 120),
                calibrationAssessmentRef: input.replanContext.runtimeStartHypothesisEvidence.calibrationAssessmentRef.slice(0, 120),
                resultId: input.replanContext.runtimeStartHypothesisEvidence.resultId.slice(0, 120),
                actualOutcomeKey: input.replanContext.runtimeStartHypothesisEvidence.actualOutcomeKey,
                verdict: input.replanContext.runtimeStartHypothesisEvidence.verdict,
                observationRefs: input.replanContext.runtimeStartHypothesisEvidence.observationRefs
                  .slice(0, 16)
                  .map((ref) => ref.slice(0, 256)),
                supportingHypothesisIds: input.replanContext.runtimeStartHypothesisEvidence.supportingHypothesisIds
                  .slice(0, 3)
                  .map((id) => id.slice(0, 80)),
                contradictingHypothesisIds: input.replanContext.runtimeStartHypothesisEvidence.contradictingHypothesisIds
                  .slice(0, 3)
                  .map((id) => id.slice(0, 80)),
                beliefUpdateStatus: "unresolved_unvalidated_forecast" as const,
              },
            }
          : {}),
        ...(worldStatePlanningRead ? { worldStatePlanningRead } : {}),
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