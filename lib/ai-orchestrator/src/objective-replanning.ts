import type { ObjectiveContract } from "./schemas/chat.schema.js";
import { buildObjectiveClaimPlan } from "./objective-claim-plan.js";
import { classifyObjectiveScopePath } from "./objective-scope.js";
import {
  FailureDiagnosisSummarySchema,
} from "./agent-state/failure-contract.js";

export type ObjectiveReplanReadStatus =
  | "READ_COMPLETE"
  | "READ_TARGETED"
  | "READ_CACHED"
  | "READ_TRUNCATED"
  | "READ_FAILED";

export type ObjectiveReplanTarget = {
  path: string;
  claimIds: string[];
  edgeKeys: string[];
  reason:
    | "MISSING_REQUIRED_EVIDENCE_PATH"
    | "MISSING_CLAIM_EVIDENCE_PATH"
    | "MISSING_EDGE_CALLER_PATH"
    | "DISCOVERED_PROJECT_QUERY_SOURCE";
};

export type ProjectQueryDiscoveryTarget = {
  path: string;
  claimId: string;
  evidenceNeedles: readonly string[];
  reason: "DISCOVERED_PROJECT_QUERY_SOURCE";
};

export function isObjectiveEvidenceDiagnosisRetryable(value: unknown): boolean {
  const parsedDiagnosis = FailureDiagnosisSummarySchema.safeParse(value);
  if (!parsedDiagnosis.success) return false;
  const diagnosis = parsedDiagnosis.data;
  return diagnosis.retryable
    && !diagnosis.requiresApproval
    && ["MISSING_REQUIRED_READ", "EVIDENCE_INCOMPLETE"].includes(diagnosis.kind);
}

function normalizePath(value: string): string {
  const normalized = value
    .replace(/\\/g, "/")
    .replace(/^(\.\/)+/, "")
    .replace(/^\/+/, "")
    .trim();
  if (!normalized || normalized.split("/").some((part) => part === "..")) return "";
  return normalized;
}

function normalizeSafeProjectPath(value: string): string {
  const slashPath = value.replaceAll("\\", "/").trim();
  if (
    !slashPath
    || slashPath.includes("\0")
    || slashPath.startsWith("/")
    || /^[a-zA-Z]:/.test(slashPath)
  ) {
    return "";
  }
  const parts = slashPath.split("/");
  if (parts.some((part) => part === "..")) return "";
  const normalized = parts.filter((part) => part && part !== ".").join("/");
  return normalized;
}

function claimEvidenceNeedlesForPath(
  claim: ObjectiveContract["requiredClaims"][number],
  path: string,
): string[] {
  const needles = claim.evidenceNeedlesByPath
    ? Object.entries(claim.evidenceNeedlesByPath)
        .find(([candidatePath]) => normalizeSafeProjectPath(candidatePath) === path)?.[1] ?? []
    : claim.evidenceNeedles ?? [];
  return [...new Set(needles
    .map((needle) => needle.trim())
    .filter(Boolean))];
}

/**
 * Select one model-suggested source only when the server-owned objective
 * already binds that exact expansion path to an existing claim and the
 * current project manifest confirms the file exists. The model supplies
 * navigation hints only; this helper never creates claim or scope authority.
 */
export function deriveProjectQueryDiscoveryTarget(input: {
  objective: ObjectiveContract;
  candidatePaths: readonly string[];
  manifestPaths: Iterable<string>;
  retainedFileContents: ReadonlyMap<string, string>;
  readStatuses?: ReadonlyMap<string, ObjectiveReplanReadStatus>;
}): ProjectQueryDiscoveryTarget | undefined {
  if (
    !input.objective.objectiveType.startsWith("PROJECT_QUERY_")
    || !input.objective.scopePolicy
  ) {
    return undefined;
  }

  const manifestPaths = new Set(
    [...input.manifestPaths]
      .map(normalizeSafeProjectPath)
      .filter(Boolean),
  );
  const retainedFileContents = new Map(
    [...input.retainedFileContents.entries()]
      .map(([path, content]) => [normalizeSafeProjectPath(path), content] as const)
      .filter(([path]) => Boolean(path)),
  );
  const readStatuses = new Map(
    [...(input.readStatuses ?? new Map())]
      .map(([path, status]) => [normalizeSafeProjectPath(path), status] as const)
      .filter(([path]) => Boolean(path)),
  );
  const candidatePaths = [...new Set(
    input.candidatePaths.map(normalizeSafeProjectPath).filter(Boolean),
  )];
  const requiredPaths = new Set(
    [
      ...(input.objective.requiredEvidencePaths ?? []),
      ...input.objective.requiredClaims.flatMap((claim) => claim.requiredEvidencePaths ?? []),
    ]
      .map(normalizeSafeProjectPath)
      .filter(Boolean),
  );

  for (const claim of input.objective.requiredClaims) {
    const claimEvidencePaths = (claim.requiredEvidencePaths ?? []).length > 0
      ? (claim.requiredEvidencePaths ?? [])
      : [...retainedFileContents.keys()];
    const alreadySupported = claimEvidencePaths.some((rawPath) => {
      const path = normalizeSafeProjectPath(rawPath);
      const body = retainedFileContents.get(path);
      if (!body) return false;
      return claimEvidenceNeedlesForPath(claim, path)
        .some((needle) => body.includes(needle));
    });
    if (alreadySupported) continue;

    for (const candidatePath of candidatePaths) {
      if (
        !manifestPaths.has(candidatePath)
        || retainedFileContents.has(candidatePath)
        || readStatuses.has(candidatePath)
        || requiredPaths.has(candidatePath)
        || classifyObjectiveScopePath(candidatePath, input.objective.scopePolicy)?.kind
          !== "JUSTIFIED_SCOPE_EXPANSION"
      ) {
        continue;
      }
      const evidenceNeedles = claimEvidenceNeedlesForPath(claim, candidatePath);
      if (evidenceNeedles.length === 0) continue;
      return {
        path: candidatePath,
        claimId: claim.claimId,
        evidenceNeedles,
        reason: "DISCOVERED_PROJECT_QUERY_SOURCE",
      };
    }
  }
  return undefined;
}

function isCompletePath(
  path: string,
  retainedPaths: ReadonlySet<string>,
  readStatuses: ReadonlyMap<string, ObjectiveReplanReadStatus>,
): boolean {
  if (!retainedPaths.has(path)) return false;
  const status = readStatuses.get(path);
  return status !== "READ_TRUNCATED" && status !== "READ_FAILED";
}

function pathFromEndpoint(endpoint: string): string {
  const separator = endpoint.lastIndexOf("#");
  return separator > 0 ? normalizePath(endpoint.slice(0, separator)) : "";
}

/**
 * Build a deterministic, server-owned replan from objective coverage.
 *
 * This helper intentionally does not inspect provider prose, graph hints, or
 * model-selected paths. It only returns paths that the objective contract
 * already declared, and it caps the work to a small number of targets.
 */
export function deriveObjectiveReplanTargets(input: {
  objective: ObjectiveContract;
  retainedPaths: Iterable<string>;
  readStatuses?: ReadonlyMap<string, ObjectiveReplanReadStatus>;
  claimState?: ReadonlyArray<{
    claimId: string;
    status: "PENDING" | "PROVEN" | "BLOCKED";
    evidenceRefs: readonly string[];
  }>;
  maxTargets?: number;
}): ObjectiveReplanTarget[] {
  const retainedPaths = new Set(
    [...input.retainedPaths].map(normalizePath).filter(Boolean),
  );
  const readStatuses = new Map(
    [...(input.readStatuses ?? new Map())]
      .map(([path, status]) => [normalizePath(path), status] as const)
      .filter(([path]) => Boolean(path)),
  );
  const maxTargets = Math.max(0, Math.min(2, Math.floor(input.maxTargets ?? 2)));
  const targets: ObjectiveReplanTarget[] = [];
  const byPath = new Map<string, ObjectiveReplanTarget>();
  const plan = buildObjectiveClaimPlan({
    objective: input.objective,
    retainedPaths: [...retainedPaths].filter((path) => isCompletePath(path, retainedPaths, readStatuses)),
    claimState: input.claimState,
  });

  const add = (
    rawPath: string,
    reason: ObjectiveReplanTarget["reason"],
    claimId?: string,
    edgeKey?: string,
  ) => {
    const path = normalizePath(rawPath);
    if (!path || isCompletePath(path, retainedPaths, readStatuses)) return;
    const existing = byPath.get(path);
    if (existing) {
      if (claimId && !existing.claimIds.includes(claimId)) existing.claimIds.push(claimId);
      if (edgeKey && !existing.edgeKeys.includes(edgeKey)) existing.edgeKeys.push(edgeKey);
      return;
    }
    if (targets.length >= maxTargets) return;
    const target: ObjectiveReplanTarget = {
      path,
      claimIds: claimId ? [claimId] : [],
      edgeKeys: edgeKey ? [edgeKey] : [],
      reason,
    };
    targets.push(target);
    byPath.set(path, target);
  };

  for (const path of plan.missingObjectiveEvidencePaths) {
    add(path, "MISSING_REQUIRED_EVIDENCE_PATH");
  }

  for (const claim of plan.claims) {
    for (const path of claim.missingEvidencePaths) {
      add(path, "MISSING_CLAIM_EVIDENCE_PATH", claim.claimId);
    }
  }

  for (const edge of input.objective.requiredEvidenceEdges ?? []) {
    const callerPath = pathFromEndpoint(edge.from);
    if (!callerPath) continue;
    add(
      callerPath,
      "MISSING_EDGE_CALLER_PATH",
      undefined,
      `${edge.from}->${edge.to}`,
    );
  }

  return targets;
}