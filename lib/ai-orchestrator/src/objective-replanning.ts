import type { ObjectiveContract } from "./schemas/chat.schema.js";

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
    | "MISSING_EDGE_CALLER_PATH";
};

function normalizePath(value: string): string {
  const normalized = value
    .replace(/\\/g, "/")
    .replace(/^(\.\/)+/, "")
    .replace(/^\/+/, "")
    .trim();
  if (!normalized || normalized.split("/").some((part) => part === "..")) return "";
  return normalized;
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

  for (const path of input.objective.requiredEvidencePaths ?? []) {
    add(path, "MISSING_REQUIRED_EVIDENCE_PATH");
  }

  for (const claim of input.objective.requiredClaims) {
    for (const path of claim.requiredEvidencePaths ?? []) {
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