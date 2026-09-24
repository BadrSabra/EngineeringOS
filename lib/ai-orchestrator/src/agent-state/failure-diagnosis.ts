import { AGENT_STATE_SCHEMA_VERSION, safePublicString } from "./contract-utils.js";
import {
  type FailureDiagnosis,
  type FailureKind,
  parseFailureDiagnosis,
} from "./failure-contract.js";

export type DiagnoseFailureInput = {
  episodeId?: string;
  actionId?: string;
  /** A server-generated, validated result from a registered validator. */
  validatorReceipt?: unknown;
  /** A server-generated classification based on direct before/after observations. */
  effectResult?: unknown;
  /** A server-generated acceptance projection; provider prose is ignored. */
  acceptanceProjection?: unknown;
};

type DiagnosisSignal = {
  kind: FailureKind;
  affectedFacts?: string[];
  requiredObservations?: string[];
};

type DiagnosisPolicy = {
  reasonCode: NonNullable<FailureDiagnosis["reasonCode"]>;
  nextActionCode: NonNullable<FailureDiagnosis["nextActionCode"]>;
  failedAssumption: string;
  requiredObservation: string;
  retryable: boolean;
  requiresApproval: boolean;
  priority: number;
};

const POLICY: Record<FailureKind, DiagnosisPolicy> = {
  NO_PROGRESS: {
    reasonCode: "NO_PROGRESS",
    nextActionCode: "OBSERVE_PROGRESS",
    failedAssumption: "The action produced accepted progress.",
    requiredObservation: "episode:progress",
    retryable: false,
    requiresApproval: false,
    priority: 11,
  },
  MISSING_REQUIRED_READ: {
    reasonCode: "REQUIRED_READ_MISSING",
    nextActionCode: "READ_REQUIRED_SOURCE",
    failedAssumption: "The required source was read completely and freshly.",
    requiredObservation: "source:required_read",
    retryable: true,
    requiresApproval: false,
    priority: 6,
  },
  STALE_PROJECT_REVISION: {
    reasonCode: "PROJECT_REVISION_STALE",
    nextActionCode: "REFRESH_PROJECT_REVISION",
    failedAssumption: "The project revision still matches the evidence.",
    requiredObservation: "project:current_revision",
    retryable: true,
    requiresApproval: false,
    priority: 2,
  },
  STALE_RUNTIME: {
    reasonCode: "RUNTIME_STALE",
    nextActionCode: "VERIFY_RUNTIME_REVISION",
    failedAssumption: "The runtime still serves the requested revision.",
    requiredObservation: "runtime:serving_revision",
    retryable: true,
    requiresApproval: false,
    priority: 3,
  },
  PRECONDITION_FAILED: {
    reasonCode: "PRECONDITIONS_FAILED",
    nextActionCode: "RECHECK_PRECONDITIONS",
    failedAssumption: "The server-owned action preconditions hold.",
    requiredObservation: "action:preconditions",
    retryable: false,
    requiresApproval: false,
    priority: 9,
  },
  VALIDATOR_FAILED: {
    reasonCode: "VALIDATOR_FAILED",
    nextActionCode: "REPAIR_AND_REVALIDATE",
    failedAssumption: "The candidate satisfies its registered validator.",
    requiredObservation: "validation:registered_profile",
    retryable: true,
    requiresApproval: false,
    priority: 7,
  },
  EXPECTED_EFFECT_MISSING: {
    reasonCode: "EXPECTED_EFFECT_NOT_OBSERVED",
    nextActionCode: "OBSERVE_EXPECTED_EFFECT",
    failedAssumption: "The action produced its expected state change.",
    requiredObservation: "effect:fresh_direct_after_state",
    retryable: true,
    requiresApproval: false,
    priority: 5,
  },
  CONTRADICTORY_STATE: {
    reasonCode: "STATE_CONTRADICTED",
    nextActionCode: "RESOLVE_CONTRADICTION",
    failedAssumption: "The observed state agrees with the expected effect.",
    requiredObservation: "state:contradiction_resolution",
    retryable: false,
    requiresApproval: true,
    priority: 4,
  },
  EXTERNAL_DRIFT: {
    reasonCode: "EXTERNAL_STATE_DRIFT",
    nextActionCode: "RECONCILE_EXTERNAL_STATE",
    failedAssumption: "The external state still matches the accepted operation.",
    requiredObservation: "external:current_state",
    retryable: false,
    requiresApproval: true,
    priority: 1,
  },
  AUTHORIZATION_REQUIRED: {
    reasonCode: "OWNER_AUTHORIZATION_MISSING",
    nextActionCode: "REQUEST_APPROVAL",
    failedAssumption: "The operation has the required owner authorization.",
    requiredObservation: "authorization:owner_approval",
    retryable: false,
    requiresApproval: true,
    priority: 0,
  },
  EVIDENCE_INCOMPLETE: {
    reasonCode: "EVIDENCE_INCOMPLETE",
    nextActionCode: "GATHER_REQUIRED_EVIDENCE",
    failedAssumption: "All required evidence is complete and retained.",
    requiredObservation: "evidence:required_complete",
    retryable: true,
    requiresApproval: false,
    priority: 8,
  },
  TOOL_UNAVAILABLE: {
    reasonCode: "CAPABILITY_UNAVAILABLE",
    nextActionCode: "RETRY_OR_REPLACE_CAPABILITY",
    failedAssumption: "The required server-owned capability is available.",
    requiredObservation: "capability:availability",
    retryable: true,
    requiresApproval: false,
    priority: 10,
  },
};

const ACCEPTANCE_REASON_KIND: Record<string, FailureKind> = {
  NO_PROGRESS: "NO_PROGRESS",
  MISSING_REQUIRED_READ: "MISSING_REQUIRED_READ",
  STALE_PROJECT_REVISION: "STALE_PROJECT_REVISION",
  STALE_RUNTIME: "STALE_RUNTIME",
  PRECONDITION_FAILED: "PRECONDITION_FAILED",
  VALIDATOR_FAILED: "VALIDATOR_FAILED",
  EXPECTED_EFFECT_MISSING: "EXPECTED_EFFECT_MISSING",
  CONTRADICTORY_STATE: "CONTRADICTORY_STATE",
  EXTERNAL_DRIFT: "EXTERNAL_DRIFT",
  AUTHORIZATION_REQUIRED: "AUTHORIZATION_REQUIRED",
  EVIDENCE_INCOMPLETE: "EVIDENCE_INCOMPLETE",
  TOOL_UNAVAILABLE: "TOOL_UNAVAILABLE",
  EXECUTION_ABANDONED: "NO_PROGRESS",
  EXECUTION_CANCELLED: "NO_PROGRESS",
  EXECUTION_LEASE_EXPIRED: "NO_PROGRESS",
  EXECUTION_ACCEPTANCE_INCOMPLETE: "EVIDENCE_INCOMPLETE",
  EVIDENCE_RECOVERY_EXHAUSTED: "EVIDENCE_INCOMPLETE",
  EXECUTION_PROVIDER_FAILURE: "TOOL_UNAVAILABLE",
  MODEL_OUTPUT_INVALID: "VALIDATOR_FAILED",
};

const ACCEPTANCE_ACTION_KIND: Record<string, FailureKind> = {
  START_NEW_PROBE: "TOOL_UNAVAILABLE",
  REVIEW_INCOMPLETE_EVIDENCE: "EVIDENCE_INCOMPLETE",
  RETRY_AFTER_PARSE: "VALIDATOR_FAILED",
  RETRY_AFTER_TIMEOUT: "TOOL_UNAVAILABLE",
  RETRY_AFTER_RATE_LIMIT: "TOOL_UNAVAILABLE",
  ABANDON_EXECUTION: "NO_PROGRESS",
};

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function boundedReferences(value: unknown, prefix: string): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((item): item is string => typeof item === "string")
    .map((item) => safePublicString(item, 220))
    .filter(Boolean)
    .map((item) => `${prefix}:${item}`))]
    .slice(0, 64);
}

function validatorSignal(value: unknown): DiagnosisSignal | undefined {
  const receipt = record(value);
  if (!receipt) return undefined;
  const reasonCode = typeof receipt.reasonCode === "string" ? receipt.reasonCode : "";
  const failureKind = typeof receipt.failureKind === "string" ? receipt.failureKind : "";
  if (reasonCode === "MISSING_REQUIRED_READ") return { kind: "MISSING_REQUIRED_READ" };
  if (reasonCode === "EVIDENCE_INCOMPLETE") return { kind: "EVIDENCE_INCOMPLETE" };
  if (reasonCode === "EXTERNAL_DRIFT") return { kind: "EXTERNAL_DRIFT" };
  if (reasonCode === "PRECONDITION_FAILED") return { kind: "PRECONDITION_FAILED" };
  if (reasonCode === "stale_revision" || failureKind === "conflict") {
    return { kind: "STALE_PROJECT_REVISION" };
  }
  if (reasonCode === "stale_runtime" || reasonCode === "runtime_revision_mismatch") {
    return { kind: "STALE_RUNTIME" };
  }
  if (reasonCode === "ownership" || reasonCode === "AUTHORIZATION_REQUIRED") {
    return { kind: "AUTHORIZATION_REQUIRED" };
  }
  if (failureKind === "candidate") return { kind: "VALIDATOR_FAILED" };
  if (failureKind === "scope") return { kind: "PRECONDITION_FAILED" };
  if (failureKind === "cancelled") return { kind: "NO_PROGRESS" };
  if (["unavailable", "harness", "timeout", "unknown"].includes(failureKind)) {
    return { kind: "TOOL_UNAVAILABLE" };
  }
  if (receipt.terminalState === "timed_out") return { kind: "TOOL_UNAVAILABLE" };
  if (receipt.status === "unavailable") return { kind: "TOOL_UNAVAILABLE" };
  if (receipt.status === "blocked") return { kind: "PRECONDITION_FAILED" };
  if (receipt.status === "failed") {
    return typeof receipt.exitCode === "number"
      ? { kind: "VALIDATOR_FAILED" }
      : { kind: "TOOL_UNAVAILABLE" };
  }
  return undefined;
}

function effectSignal(value: unknown): DiagnosisSignal | undefined {
  const effect = record(value);
  if (!effect) return undefined;
  const missing = boundedReferences(effect.missingEffects, "expected-effect");
  const contradictions = boundedReferences(effect.contradictionRefs, "observation");
  if (effect.reasonCode === "EXTERNAL_DRIFT" || effect.failureKind === "EXTERNAL_DRIFT") {
    return { kind: "EXTERNAL_DRIFT", affectedFacts: missing };
  }
  if (effect.reasonCode === "STALE_RUNTIME") return { kind: "STALE_RUNTIME" };
  if (effect.reasonCode === "STALE_PROJECT_REVISION") return { kind: "STALE_PROJECT_REVISION" };
  if (effect.reasonCode === "AUTHORIZATION_REQUIRED") return { kind: "AUTHORIZATION_REQUIRED" };
  if (effect.reasonCode === "MISSING_REQUIRED_READ") return { kind: "MISSING_REQUIRED_READ" };
  if (effect.reasonCode === "EVIDENCE_INCOMPLETE") return { kind: "EVIDENCE_INCOMPLETE" };
  if (effect.reasonCode === "PRECONDITION_FAILED") return { kind: "PRECONDITION_FAILED" };
  if (effect.status === "contradicted" || contradictions.length > 0) {
    return {
      kind: "CONTRADICTORY_STATE",
      affectedFacts: contradictions,
      requiredObservations: contradictions.map((reference) => `resolve:${reference}`),
    };
  }
  if (effect.status === "not_observed" || (effect.status === "partial" && missing.length > 0)) {
    return {
      kind: "EXPECTED_EFFECT_MISSING",
      affectedFacts: missing,
      requiredObservations: missing.map((reference) => `observe:${reference}`),
    };
  }
  if (effect.status === "unknown" || effect.status === "partial") {
    return { kind: "EVIDENCE_INCOMPLETE" };
  }
  return undefined;
}

function acceptanceSignal(value: unknown): DiagnosisSignal | undefined {
  const projection = record(value);
  if (!projection) return undefined;
  const disposition = record(projection.disposition) ?? projection;
  const reasonCodes = [
    projection.reasonCode,
    disposition.reasonCode,
    ...(Array.isArray(disposition.reasonCodes) ? disposition.reasonCodes : []),
  ].filter((code): code is string => typeof code === "string");
  const nextActionCode = typeof disposition.nextActionCode === "string"
    ? disposition.nextActionCode
    : undefined;
  const kind = reasonCodes.map((code) => ACCEPTANCE_REASON_KIND[code]).find(Boolean)
    ?? (nextActionCode ? ACCEPTANCE_ACTION_KIND[nextActionCode] : undefined);
  return kind ? { kind } : undefined;
}

const SIGNAL_PRIORITY: Record<FailureKind, number> = Object.fromEntries(
  Object.entries(POLICY).map(([kind, policy]) => [kind, policy.priority]),
) as Record<FailureKind, number>;

/**
 * Derive a stable diagnosis from recognized server-owned validation, effect,
 * and acceptance signals. Human-readable provider/tool messages are ignored.
 */
export function tryDiagnoseFailure(input: DiagnoseFailureInput): FailureDiagnosis | undefined {
  const signals = [
    validatorSignal(input.validatorReceipt),
    effectSignal(input.effectResult),
    acceptanceSignal(input.acceptanceProjection),
  ].filter((signal): signal is DiagnosisSignal => Boolean(signal));
  signals.sort((left, right) => SIGNAL_PRIORITY[left.kind] - SIGNAL_PRIORITY[right.kind]);
  const selected = signals[0];
  if (!selected) return undefined;

  const policy = POLICY[selected.kind];
  return parseFailureDiagnosis({
    schemaVersion: AGENT_STATE_SCHEMA_VERSION,
    ...(input.episodeId ? { episodeId: input.episodeId } : {}),
    ...(input.actionId ? { actionId: input.actionId } : {}),
    kind: selected.kind,
    failedAssumptions: [policy.failedAssumption],
    affectedFacts: selected.affectedFacts ?? [],
    affectedClaims: [],
    requiredObservations: selected.requiredObservations?.length
      ? selected.requiredObservations
      : [policy.requiredObservation],
    retryable: policy.retryable,
    requiresApproval: policy.requiresApproval,
    reasonCode: policy.reasonCode,
    nextActionCode: policy.nextActionCode,
  });
}

export function diagnoseFailure(input: DiagnoseFailureInput): FailureDiagnosis {
  const diagnosis = tryDiagnoseFailure(input);
  if (!diagnosis) {
    throw new Error("No recognized server-owned failure signal is available for diagnosis.");
  }
  return diagnosis;
}