import { createHash } from "node:crypto";
import type { QueryPlan } from "./agents/query-planner.js";
import type { TurnIntent } from "./turn-intent.js";
import type { ActiveTaskExecutionPlan } from "./task-session-state.js";

export type GeneralTaskPlanDecision = "CREATE" | "REUSE" | "BLOCK";
export type GeneralTaskPlanSource =
  | "new"
  | "execution_plan"
  | "project_query_state";
export type GeneralTaskPlanProfile = "default" | "project_orientation";

export type GeneralTaskPlanStepKind =
  | "inspect"
  | "analyze"
  | "execute"
  | "validate"
  | "deliver";

export type GeneralTaskPlanStep = {
  id: string;
  title: string;
  kind: GeneralTaskPlanStepKind;
  dependencies: string[];
  files: string[];
  readOnly: boolean;
  approvalRequired: boolean;
  recipe?: {
    recipeId: string;
    recipeVersion: number;
  };
};

export type ProjectOrientationCoverage = {
  purpose: "required";
  components: "required";
  primaryFlow: "required";
  uncertainty: "required";
};

export type ExistingProjectQueryState = {
  requiredEvidencePaths?: readonly string[];
  requiredClaims?: readonly { claimId: string }[];
};

export type GeneralTaskPlan = {
  version: 1;
  objective: string;
  turnKind: TurnIntent["kind"];
  executionTaskType: string;
  profile: GeneralTaskPlanProfile;
  decision: GeneralTaskPlanDecision;
  source: GeneralTaskPlanSource;
  planHash: string;
  steps: GeneralTaskPlanStep[];
  conflicts: string[];
  orientationCoverage?: ProjectOrientationCoverage;
  reusedPlanFingerprint?: string;
  /** An existing durable plan owns the next action; do not create another one. */
  skipQueryPlanner: boolean;
};

export function canReuseTaskPlanRevision(input: {
  persistedRevision?: string | null;
  currentRevision?: string | null;
  explicitOverride?: boolean;
}): boolean {
  if (input.explicitOverride) return true;
  if (!input.persistedRevision) return true;
  return Boolean(input.currentRevision) && input.persistedRevision === input.currentRevision;
}

type GeneralTaskPlanInput = {
  message: string;
  turnIntent: Pick<
    TurnIntent,
    | "kind"
    | "executionTaskType"
    | "requiresTools"
    | "requiresEvidence"
    | "allowsBuildHandoff"
  >;
  objective?: string;
  existingExecutionPlan?: ActiveTaskExecutionPlan | null;
  existingProjectQuery?: ExistingProjectQueryState | null;
  existingQueryPlan?: QueryPlan | null;
  projectOrientation?: boolean;
};

function hashPlan(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function uniquePaths(paths: readonly string[] | undefined): string[] {
  return [...new Set(
    (paths ?? [])
      .map((path) => path.trim().replaceAll("\\", "/").replace(/^\.\/+/, ""))
      .filter(Boolean),
  )].slice(0, 48);
}

function step(
  id: string,
  title: string,
  kind: GeneralTaskPlanStepKind,
  dependencies: string[] = [],
  options: Partial<Pick<GeneralTaskPlanStep, "files" | "readOnly" | "approvalRequired" | "recipe">> = {},
): GeneralTaskPlanStep {
  return {
    id,
    title,
    kind,
    dependencies,
    files: options.files ?? [],
    readOnly: options.readOnly ?? kind !== "execute",
    approvalRequired: options.approvalRequired ?? kind === "execute",
    ...(options.recipe ? { recipe: options.recipe } : {}),
  };
}

function stepsForIntent(input: GeneralTaskPlanInput): GeneralTaskPlanStep[] {
  const { turnIntent } = input;
  if (input.projectOrientation && turnIntent.kind === "PROJECT_QUERY") {
    return [
      step("discover-purpose", "Discover the project purpose", "inspect"),
      step(
        "map-components",
        "Map the main product components",
        "analyze",
        ["discover-purpose"],
      ),
      step(
        "trace-primary-flow",
        "Trace the primary user flow",
        "analyze",
        ["map-components"],
      ),
      step(
        "verify-orientation",
        "Verify the functional explanation",
        "validate",
        ["trace-primary-flow"],
      ),
      step(
        "deliver",
        "Deliver the functional project overview",
        "deliver",
        ["verify-orientation"],
      ),
    ];
  }

  if (turnIntent.kind === "CHAT" && !turnIntent.requiresTools) {
    return [step("deliver", "Respond to the user", "deliver")];
  }

  const inspect = turnIntent.requiresTools || turnIntent.requiresEvidence
    ? step("inspect", "Inspect the relevant project context", "inspect")
    : undefined;
  const analyze = turnIntent.kind === "PROJECT_QUERY" || turnIntent.kind === "FORENSIC_AUDIT"
    ? step(
        "analyze",
        "Analyze the retained project evidence",
        "analyze",
        inspect ? ["inspect"] : [],
      )
    : undefined;

  if (turnIntent.kind === "DELIVERY") {
    const execute = step(
      "execute",
      "Execute the approved change plan",
      "execute",
      inspect ? ["inspect"] : [],
      { readOnly: false, approvalRequired: !turnIntent.allowsBuildHandoff },
    );
    const validate = step(
      "validate",
      "Validate the resulting workspace",
      "validate",
      ["execute"],
      { recipe: { recipeId: "validation.recover", recipeVersion: 1 } },
    );
    return [
      ...(inspect ? [inspect] : []),
      execute,
      validate,
      step("deliver", "Deliver the verified result", "deliver", ["validate"]),
    ];
  }

  return [
    ...(inspect ? [inspect] : []),
    ...(analyze ? [analyze] : []),
    step(
      "deliver",
      turnIntent.requiresEvidence ? "Deliver the evidence-bound result" : "Deliver the result",
      "deliver",
      [analyze?.id ?? inspect?.id].filter((id): id is string => Boolean(id)),
    ),
  ];
}

function stepsForExistingExecutionPlan(
  plan: ActiveTaskExecutionPlan,
): GeneralTaskPlanStep[] {
  const nodes = plan.nodes.slice(0, 24);
  if (nodes.length === 0) {
    return stepsForIntent({
      message: "",
      turnIntent: {
        kind: "DELIVERY",
        executionTaskType: "task_execution",
        requiresTools: true,
        requiresEvidence: false,
        allowsBuildHandoff: false,
      },
    });
  }
  return [
    ...nodes.map((node) => {
      const description = `${node.title} ${node.capabilityId ?? ""}`.toLowerCase();
      const kind: GeneralTaskPlanStepKind =
        /(?:test|validat|check|verify)/.test(description)
          ? "validate"
          : /(?:inspect|read|analy[sz])/.test(description)
            ? "inspect"
            : "execute";
      return step(
        node.id,
        node.title,
        kind,
        [...node.dependencies],
        {
          files: uniquePaths(node.allowedFiles),
          readOnly: kind !== "execute",
          approvalRequired: false,
        },
      );
    }),
    step(
      "deliver",
      "Deliver the existing plan result",
      "deliver",
      nodes.map((node) => node.id),
    ),
  ];
}

function stepsForExistingProjectQuery(
  state: ExistingProjectQueryState,
): GeneralTaskPlanStep[] {
  const files = uniquePaths(state.requiredEvidencePaths);
  const claims = state.requiredClaims?.length ?? 0;
  return [
    step("inspect", "Read the existing project-query evidence scope", "inspect", [], { files }),
    step(
      "analyze",
      `Close ${claims || "the"} server-owned project claims`,
      "analyze",
      ["inspect"],
      { files },
    ),
    step("deliver", "Deliver the existing project-query result", "deliver", ["analyze"]),
  ];
}

/**
 * Coordinates the existing planners instead of replacing them.
 *
 * Priority is intentional:
 *   durable execution plan → persisted project-query scope → current query plan → new plan
 *
 * A durable plan owns the next action. The general layer therefore reports
 * REUSE and asks the caller not to invoke another query planner, preventing
 * duplicate plans and conflicting scopes during resume or execution handoff.
 */
export function buildGeneralTaskPlan(input: GeneralTaskPlanInput): GeneralTaskPlan {
  const objective = (input.objective ?? input.message).trim().slice(0, 2_000);
  const profile: GeneralTaskPlanProfile =
    input.projectOrientation && input.turnIntent.kind === "PROJECT_QUERY"
      ? "project_orientation"
      : "default";
  let decision: GeneralTaskPlanDecision = "CREATE";
  let source: GeneralTaskPlanSource = "new";
  let steps: GeneralTaskPlanStep[];
  let reusedPlanFingerprint: string | undefined;
  const conflicts: string[] = [];
  let skipQueryPlanner = false;
  const orientationCoverage: ProjectOrientationCoverage | undefined =
    profile === "project_orientation"
      ? {
          purpose: "required",
          components: "required",
          primaryFlow: "required",
          uncertainty: "required",
        }
      : undefined;

  if (input.existingExecutionPlan) {
    decision = "REUSE";
    source = "execution_plan";
    skipQueryPlanner = true;
    steps = stepsForExistingExecutionPlan(input.existingExecutionPlan);
    reusedPlanFingerprint = input.existingExecutionPlan.planFingerprint ?? undefined;
    if (input.existingQueryPlan) {
      conflicts.push("existing query plan is superseded by the durable execution plan");
    }
  } else if (input.existingProjectQuery) {
    decision = "REUSE";
    source = "project_query_state";
    skipQueryPlanner = true;
    steps = stepsForExistingProjectQuery(input.existingProjectQuery);
    if (input.existingQueryPlan) {
      conflicts.push("new query plan is unnecessary because project-query scope is persisted");
    }
  } else if (input.existingQueryPlan) {
    decision = "REUSE";
    source = "project_query_state";
    skipQueryPlanner = true;
    steps = [
      step("inspect", "Read the files selected by the existing query plan", "inspect", [], {
        files: uniquePaths(input.existingQueryPlan.targetFiles),
      }),
      ...input.existingQueryPlan.subQueries.slice(0, 5).map((query, index) =>
        step(`analyze-${index + 1}`, query, "analyze", ["inspect"]),
      ),
      step("deliver", "Deliver the existing query-plan result", "deliver", [
        ...(input.existingQueryPlan.subQueries.length > 0
          ? input.existingQueryPlan.subQueries.slice(0, 5).map((_, index) => `analyze-${index + 1}`)
          : ["inspect"]),
      ]),
    ];
  } else {
    steps = stepsForIntent(input);
  }

  if (steps.length === 0) {
    decision = "BLOCK";
    conflicts.push("task planner produced no executable steps");
  }

  return {
    version: 1,
    objective,
    turnKind: input.turnIntent.kind,
    executionTaskType: input.turnIntent.executionTaskType,
    profile,
    decision,
    source,
    planHash: hashPlan({
      objective,
      turnKind: input.turnIntent.kind,
      executionTaskType: input.turnIntent.executionTaskType,
      profile,
      source,
      steps,
      reusedPlanFingerprint,
      orientationCoverage,
    }),
    steps,
    conflicts: conflicts.slice(0, 8),
    ...(orientationCoverage ? { orientationCoverage } : {}),
    ...(reusedPlanFingerprint ? { reusedPlanFingerprint } : {}),
    skipQueryPlanner,
  };
}