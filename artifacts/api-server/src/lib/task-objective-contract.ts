import { createHash } from "node:crypto";

export const TASK_OBJECTIVE_CONTRACT_VERSION = 1 as const;

export const TASK_OBJECTIVE_KINDS = [
  "knowledge_answer",
  "project_analysis",
  "bug_fix",
  "feature_implementation",
  "refactor",
  "database_change",
  "browser_workflow",
  "deployment",
  "integration_task",
  "file_conversion",
  "media_task",
] as const;
export type TaskObjectiveKind = (typeof TASK_OBJECTIVE_KINDS)[number];

export const TASK_OBJECTIVE_FAILURE_CODES = [
  "objective_not_proven",
  "validator_unavailable",
  "partial_evidence",
  "revision_mismatch",
  "scope_mismatch",
  "validation_failed",
] as const;
export type TaskObjectiveFailureCode = (typeof TASK_OBJECTIVE_FAILURE_CODES)[number];

export type TaskObjectiveContract = {
  version: typeof TASK_OBJECTIVE_CONTRACT_VERSION;
  kind: TaskObjectiveKind;
  objective: string;
  validatorIds: string[];
  requiredEvidence: string[];
  successCriteria: string[];
  failureTaxonomy: TaskObjectiveFailureCode[];
  projectId: string;
  workspaceRevision: string;
  targetPaths: string[];
  hash: string;
};

type BuildTaskObjectiveContractInput = {
  message: string;
  projectId: string;
  workspaceRevision: string;
  targetPaths?: readonly string[];
  proofRequired: boolean;
  turnIntent?: string;
  operationMode?: string;
  implementationTaskMode?: boolean;
};

type TaskObjectiveValidationInput = {
  contract: TaskObjectiveContract;
  workspaceRevision: string;
  projectId?: string;
  operationId?: string;
  objectiveValidated: boolean;
  evidenceVerdict?: string;
  evidenceComplete?: boolean;
  targetPaths?: readonly string[];
  validatorReceipts?: readonly TaskObjectiveValidatorReceipt[];
};

export type TaskObjectiveValidation = {
  allowed: boolean;
  codes: TaskObjectiveFailureCode[];
  reasons: string[];
};

export type TaskObjectiveValidatorReceipt = {
  validatorId: string;
  status: "PROVEN" | "INCOMPLETE" | "UNAVAILABLE";
  operationId: string;
  projectId: string;
  workspaceRevision: string;
  artifactRef: string;
};

export function parseTaskObjectiveValidatorReceipt(
  value: unknown,
): TaskObjectiveValidatorReceipt | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<TaskObjectiveValidatorReceipt>;
  if (
    typeof candidate.validatorId !== "string"
    || !["PROVEN", "INCOMPLETE", "UNAVAILABLE"].includes(candidate.status ?? "")
    || typeof candidate.operationId !== "string"
    || typeof candidate.projectId !== "string"
    || typeof candidate.workspaceRevision !== "string"
    || typeof candidate.artifactRef !== "string"
  ) return undefined;
  return {
    validatorId: candidate.validatorId.slice(0, 120),
    status: candidate.status as TaskObjectiveValidatorReceipt["status"],
    operationId: candidate.operationId.slice(0, 160),
    projectId: candidate.projectId.slice(0, 160),
    workspaceRevision: candidate.workspaceRevision.slice(0, 2_000),
    artifactRef: candidate.artifactRef.slice(0, 500),
  };
}

const SUPPORTED_VALIDATORS = new Set([
  "knowledge-answer.v1",
  "project-query-evidence.v1",
  "registered-validation.v1",
  "browser-preview.v1",
  "database-schema.v1",
  "file-conversion.v1",
  "media-artifact.v1",
]);

const CONTRACT_BLUEPRINTS: Record<
  TaskObjectiveKind,
  Omit<TaskObjectiveContract, "version" | "kind" | "objective" | "projectId" | "workspaceRevision" | "targetPaths" | "hash">
> = {
  knowledge_answer: {
    validatorIds: ["knowledge-answer.v1"],
    requiredEvidence: ["accepted-answer"],
    successCriteria: [
      "The answer satisfies the server-owned response contract.",
      "Any required claims are supported by retained, operation-bound evidence.",
    ],
    failureTaxonomy: ["objective_not_proven", "partial_evidence", "revision_mismatch"],
  },
  project_analysis: {
    validatorIds: ["project-query-evidence.v1"],
    requiredEvidence: ["complete-source-reads", "accepted-objective-claims"],
    successCriteria: [
      "Required source reads are complete for the declared scope.",
      "The objective claims and verdict are accepted from source evidence.",
    ],
    failureTaxonomy: ["objective_not_proven", "partial_evidence", "revision_mismatch", "scope_mismatch"],
  },
  bug_fix: {
    validatorIds: ["registered-validation.v1"],
    requiredEvidence: ["candidate-validation", "regression-or-runtime-proof"],
    successCriteria: [
      "The registered validator passes on the immutable candidate.",
      "The targeted regression or runtime behavior is proven on the bound revision.",
    ],
    failureTaxonomy: ["objective_not_proven", "validator_unavailable", "validation_failed", "revision_mismatch", "scope_mismatch"],
  },
  feature_implementation: {
    validatorIds: ["registered-validation.v1"],
    requiredEvidence: ["candidate-validation", "behavior-proof"],
    successCriteria: [
      "The registered validator passes on the immutable candidate.",
      "The requested behavior is proven within the approved target scope.",
    ],
    failureTaxonomy: ["objective_not_proven", "validator_unavailable", "validation_failed", "revision_mismatch", "scope_mismatch"],
  },
  refactor: {
    validatorIds: ["registered-validation.v1"],
    requiredEvidence: ["candidate-validation", "invariant-proof"],
    successCriteria: [
      "The registered validator passes on the immutable candidate.",
      "The refactor remains within scope and preserves the required invariant.",
    ],
    failureTaxonomy: ["objective_not_proven", "validator_unavailable", "validation_failed", "revision_mismatch", "scope_mismatch"],
  },
  database_change: {
    validatorIds: ["database-schema.v1"],
    requiredEvidence: ["schema-preflight", "migration-or-runtime-proof"],
    successCriteria: [
      "A server-owned database validator passes the schema or migration contract.",
      "Runtime evidence is bound to the requested database change and revision.",
    ],
    failureTaxonomy: ["objective_not_proven", "validator_unavailable", "validation_failed", "revision_mismatch", "scope_mismatch"],
  },
  browser_workflow: {
    validatorIds: ["browser-preview.v1"],
    requiredEvidence: ["isolated-browser-run", "workflow-assertions"],
    successCriteria: [
      "The registered browser profile runs against the isolated preview.",
      "All server-owned workflow assertions pass for the expected revision.",
    ],
    failureTaxonomy: ["objective_not_proven", "validator_unavailable", "validation_failed", "revision_mismatch"],
  },
  deployment: {
    validatorIds: ["deployment-receipt.v1"],
    requiredEvidence: ["immutable-release-candidate", "deployment-health"],
    successCriteria: [
      "A server-owned deployment receipt binds the promoted candidate to this operation.",
      "Post-deployment health evidence passes for the requested release target.",
    ],
    failureTaxonomy: ["objective_not_proven", "validator_unavailable", "validation_failed", "revision_mismatch"],
  },
  integration_task: {
    validatorIds: ["integration-receipt.v1"],
    requiredEvidence: ["server-owned-integration-receipt"],
    successCriteria: [
      "A server-owned integration adapter records the requested operation.",
      "The resulting artifact or remote state is verified without trusting provider prose.",
    ],
    failureTaxonomy: ["objective_not_proven", "validator_unavailable", "validation_failed", "revision_mismatch"],
  },
  file_conversion: {
    validatorIds: ["file-conversion.v1"],
    requiredEvidence: ["output-artifact", "conversion-integrity"],
    successCriteria: [
      "The converted output artifact is produced in the approved workspace.",
      "The output passes server-owned format and integrity checks.",
    ],
    failureTaxonomy: ["objective_not_proven", "validator_unavailable", "validation_failed", "revision_mismatch", "scope_mismatch"],
  },
  media_task: {
    validatorIds: ["media-artifact.v1"],
    requiredEvidence: ["output-artifact", "media-integrity"],
    successCriteria: [
      "The requested media artifact is produced in the approved workspace.",
      "The output passes server-owned media format and integrity checks.",
    ],
    failureTaxonomy: ["objective_not_proven", "validator_unavailable", "validation_failed", "revision_mismatch", "scope_mismatch"],
  },
};

function normalizeText(value: string, max = 2_000): string {
  return value.trim().replace(/\s+/g, " ").slice(0, max);
}

function hasAny(message: string, terms: readonly string[]): boolean {
  return terms.some((term) => message.includes(term));
}

export function inferTaskObjectiveKind(input: {
  message: string;
  turnIntent?: string;
  operationMode?: string;
  implementationTaskMode?: boolean;
}): TaskObjectiveKind {
  const message = input.message.toLocaleLowerCase();
  if (hasAny(message, ["convert", "conversion", "تحويل", "حوّل", "تحويل ملف"])) {
    return "file_conversion";
  }
  if (hasAny(message, ["media", "image", "video", "audio", "صورة", "فيديو", "صوت"])) {
    return "media_task";
  }
  if (hasAny(message, ["deploy", "deployment", "publish", "release", "نشر", "إطلاق"])) {
    return "deployment";
  }
  if (hasAny(message, ["integration", "integrate", "connector", "slack", "github", "stripe", "تكامل"])) {
    return "integration_task";
  }
  if (hasAny(message, ["browser", "e2e", "click", "navigate", "صفحة", "متصفح", "انقر"])) {
    return "browser_workflow";
  }
  if (hasAny(message, ["database", "migration", "schema", "table", "sql", "قاعدة بيانات", "ترحيل"])) {
    return "database_change";
  }
  if (hasAny(message, ["refactor", "cleanup", "rename", "extract", "إعادة هيكلة", "تنظيف"])) {
    return "refactor";
  }
  if (hasAny(message, ["analyze", "analysis", "architecture", "inspect the project", "تحليل", "معمارية"])) {
    return "project_analysis";
  }
  if (hasAny(message, ["bug", "fix", "error", "broken", "regression", "إصلاح", "خطأ", "عطل"])) {
    return "bug_fix";
  }
  if (hasAny(message, ["implement", "implementation", "feature", "build", "create", "add ", "تنفيذ", "ميزة", "أضف"])) {
    return "feature_implementation";
  }
  if (input.implementationTaskMode || input.operationMode === "BUILD") {
    return "feature_implementation";
  }
  if (input.turnIntent === "FORENSIC_AUDIT" || input.turnIntent === "PROJECT_QUERY") {
    return "project_analysis";
  }
  return "knowledge_answer";
}

export function buildTaskObjectiveContract(
  input: BuildTaskObjectiveContractInput,
): TaskObjectiveContract | undefined {
  if (!input.proofRequired) return undefined;
  const kind = inferTaskObjectiveKind(input);
  const blueprint = CONTRACT_BLUEPRINTS[kind];
  const objective = normalizeText(input.message);
  const targetPaths = [...new Set((input.targetPaths ?? []).filter(Boolean).map((path) => path.slice(0, 500)))].slice(0, 48);
  const unsigned = {
    version: TASK_OBJECTIVE_CONTRACT_VERSION,
    kind,
    objective,
    validatorIds: [...blueprint.validatorIds],
    requiredEvidence: [...blueprint.requiredEvidence],
    successCriteria: [...blueprint.successCriteria],
    failureTaxonomy: [...blueprint.failureTaxonomy],
    projectId: input.projectId,
    workspaceRevision: input.workspaceRevision,
    targetPaths,
  } satisfies Omit<TaskObjectiveContract, "hash">;
  return {
    ...unsigned,
    hash: createHash("sha256").update(JSON.stringify(unsigned)).digest("hex"),
  };
}

export function parseTaskObjectiveContract(value: unknown): TaskObjectiveContract | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<TaskObjectiveContract>;
  if (
    candidate.version !== TASK_OBJECTIVE_CONTRACT_VERSION
    || typeof candidate.kind !== "string"
    || !TASK_OBJECTIVE_KINDS.includes(candidate.kind as TaskObjectiveKind)
    || typeof candidate.objective !== "string"
    || !Array.isArray(candidate.validatorIds)
    || !Array.isArray(candidate.requiredEvidence)
    || !Array.isArray(candidate.successCriteria)
    || !Array.isArray(candidate.failureTaxonomy)
    || typeof candidate.projectId !== "string"
    || typeof candidate.workspaceRevision !== "string"
    || !Array.isArray(candidate.targetPaths)
    || typeof candidate.hash !== "string"
  ) return undefined;
  const contract = {
    version: candidate.version,
    kind: candidate.kind,
    objective: normalizeText(candidate.objective),
    validatorIds: candidate.validatorIds.filter((value): value is string => typeof value === "string").slice(0, 8),
    requiredEvidence: candidate.requiredEvidence.filter((value): value is string => typeof value === "string").slice(0, 12),
    successCriteria: candidate.successCriteria.filter((value): value is string => typeof value === "string").slice(0, 8),
    failureTaxonomy: candidate.failureTaxonomy.filter(
      (value): value is TaskObjectiveFailureCode =>
        typeof value === "string" && TASK_OBJECTIVE_FAILURE_CODES.includes(value as TaskObjectiveFailureCode),
    ).slice(0, 8),
    projectId: candidate.projectId,
    workspaceRevision: candidate.workspaceRevision,
    targetPaths: candidate.targetPaths.filter((value): value is string => typeof value === "string").slice(0, 48),
    hash: candidate.hash,
  } satisfies TaskObjectiveContract;
  const { hash, ...unsigned } = contract;
  if (createHash("sha256").update(JSON.stringify(unsigned)).digest("hex") !== hash) return undefined;
  return contract;
}

export function validateTaskObjectiveContract(
  input: TaskObjectiveValidationInput,
): TaskObjectiveValidation {
  const codes: TaskObjectiveFailureCode[] = [];
  const reasons: string[] = [];
  const add = (code: TaskObjectiveFailureCode, reason: string) => {
    if (!codes.includes(code)) codes.push(code);
    reasons.push(reason);
  };
  if (input.contract.workspaceRevision !== input.workspaceRevision) {
    add("revision_mismatch", "task objective revision does not match the execution revision");
  }
  if (input.projectId && input.contract.projectId !== input.projectId) {
    add("scope_mismatch", "task objective project does not match the execution project");
  }
  if (input.targetPaths && input.contract.targetPaths.some((path) => !input.targetPaths!.includes(path))) {
    add("scope_mismatch", "task objective target scope does not match the execution scope");
  }
  if (input.contract.validatorIds.some((id) => !SUPPORTED_VALIDATORS.has(id))) {
    add("validator_unavailable", `no server-owned validator is registered for ${input.contract.kind}`);
  }
  for (const validatorId of input.contract.validatorIds) {
    if (!SUPPORTED_VALIDATORS.has(validatorId)) continue;
    const receipt = input.validatorReceipts?.find((candidate) => candidate.validatorId === validatorId);
    if (!receipt) {
      add("objective_not_proven", `server-owned receipt is missing for ${validatorId}`);
      continue;
    }
    if (receipt.status === "UNAVAILABLE") {
      add("validator_unavailable", `${validatorId} reported that its validator is unavailable`);
      continue;
    }
    if (receipt.status !== "PROVEN") {
      add("partial_evidence", `${validatorId} did not produce a proven receipt`);
      continue;
    }
    if (!receipt.operationId.trim() || (input.operationId && receipt.operationId !== input.operationId)) {
      add("scope_mismatch", `${validatorId} receipt is not bound to the execution operation`);
    }
    const expectedProjectId = input.projectId ?? input.contract.projectId;
    if (receipt.projectId !== expectedProjectId) {
      add("scope_mismatch", `${validatorId} receipt is not bound to the execution project`);
    }
    if (receipt.workspaceRevision !== input.contract.workspaceRevision
      || receipt.workspaceRevision !== input.workspaceRevision) {
      add("revision_mismatch", `${validatorId} receipt is not bound to the execution revision`);
    }
    if (!receipt.artifactRef.trim()) {
      add("validation_failed", `${validatorId} receipt has no server-owned artifact reference`);
    }
  }
  if (input.evidenceComplete === false) {
    add("partial_evidence", "task objective evidence is incomplete");
  }
  if (input.evidenceVerdict && !["PROVEN", "ANSWER_COMPLETE"].includes(input.evidenceVerdict)) {
    add("validation_failed", `task objective evidence verdict is ${input.evidenceVerdict}`);
  }
  if (!input.objectiveValidated) {
    add("objective_not_proven", "task objective success criteria were not proven by a server-owned validator");
  }
  return { allowed: codes.length === 0, codes, reasons };
}