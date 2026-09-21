import { z } from "zod";
import type { EvidenceReference } from "./task-contracts.js";

export const ServerConfidenceLevelSchema = z.enum(["HIGH", "MEDIUM", "LIMITED", "NOT_PROVEN"]);
export type ServerConfidenceLevel = z.infer<typeof ServerConfidenceLevelSchema>;

export const ServerConfidenceSchema = z.object({
  score: z.number().min(0).max(1),
  level: ServerConfidenceLevelSchema,
  evidenceCompleteness: z.number().min(0).max(1),
  acceptedClaimCount: z.number().int().nonnegative(),
  requiredClaimCount: z.number().int().nonnegative(),
  sourceDiversity: z.number().min(0).max(1),
  sourceTypes: z.array(z.enum(["IMPLEMENTATION", "TEST", "CONFIG", "UNKNOWN"])).max(4),
  sourceCount: z.number().int().nonnegative(),
  projectionEvidence: z.boolean(),
  revisionMatch: z.boolean(),
  contradictionCount: z.number().int().nonnegative(),
  contradictionFree: z.boolean(),
  objectiveClosure: z.boolean(),
  modelSuggestedScore: z.number().min(0).max(1).optional(),
}).strict();
export type ServerConfidence = z.infer<typeof ServerConfidenceSchema>;

type ConfidenceGate = {
  status?: string;
  completedClaims?: readonly string[];
  requiredClaims?: readonly string[];
  contradictoryClaims?: readonly string[];
};

type ConfidenceEvidence = Pick<
  EvidenceReference,
  "source" | "sourceType" | "supportsClaim" | "citationStatus"
>;

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function round(value: number): number {
  return Math.round(clamp(value) * 100) / 100;
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/^\/+/, "").trim();
}

/**
 * Compute the public confidence projection from server-owned observations.
 * Provider confidence is retained only as an optional comparison point; it
 * never participates in the score or verdict.
 */
export function computeServerOwnedConfidence(input: {
  objective?: {
    requiredClaims: readonly {
      requiredEvidencePaths?: readonly string[];
    }[];
    requiredEvidencePaths?: readonly string[];
  };
  gate?: ConfidenceGate | null;
  evidence: readonly ConfidenceEvidence[];
  requiredEvidencePaths?: readonly string[];
  expectedRevision?: string;
  observedRevision?: string;
  contradictionCount?: number;
  objectiveClosure?: boolean;
  projectionEvidence?: boolean;
  modelSuggestedScore?: number;
}): ServerConfidence {
  const acceptedEvidence = input.evidence.filter(
    (item) => item.supportsClaim && item.citationStatus !== "BLOCKED",
  );
  const requiredPaths = [
    ...(input.requiredEvidencePaths ?? []),
    ...(input.objective?.requiredEvidencePaths ?? []),
    ...(input.objective?.requiredClaims.flatMap((claim) => claim.requiredEvidencePaths ?? []) ?? []),
  ]
    .map(normalizePath)
    .filter(Boolean)
    .filter((path, index, all) => all.indexOf(path) === index);
  const acceptedPaths = new Set(acceptedEvidence.map((item) => normalizePath(item.source)).filter(Boolean));
  const evidenceCompleteness = requiredPaths.length > 0
    ? requiredPaths.filter((path) => acceptedPaths.has(path)).length / requiredPaths.length
    : acceptedEvidence.length > 0
      ? 1
      : 0;

  const requiredClaimCount = input.gate?.requiredClaims?.length
    ?? input.objective?.requiredClaims.length
    ?? 0;
  const acceptedClaimCount = input.gate?.completedClaims?.length
    ?? (requiredClaimCount > 0 ? Math.min(requiredClaimCount, acceptedEvidence.length) : acceptedEvidence.length);
  const claimCoverage = requiredClaimCount > 0
    ? clamp(acceptedClaimCount / requiredClaimCount)
    : acceptedEvidence.length > 0
      ? 1
      : 0;

  const sourceTypes = [...new Set(acceptedEvidence.map((item) => item.sourceType))];
  const sourceCount = acceptedPaths.size;
  const typeScore = sourceTypes.length === 0
    ? 0
    : sourceTypes.length === 1
      ? 0.35
      : sourceTypes.length === 2
        ? 0.65
        : 0.85;
  const breadthScore = sourceCount >= 3 ? 0.15 : sourceCount === 2 ? 0.1 : 0;
  const sourceDiversity = clamp(
    typeScore + breadthScore + (input.projectionEvidence ? 0.15 : 0),
  );

  const expectedRevision = input.expectedRevision?.trim();
  const observedRevision = input.observedRevision?.trim();
  const revisionMatch = Boolean(
    expectedRevision
      && observedRevision
      && expectedRevision !== "unavailable"
      && observedRevision !== "unavailable"
      && expectedRevision === observedRevision,
  );
  const contradictionCount = Math.max(
    0,
    Math.trunc(input.contradictionCount ?? input.gate?.contradictoryClaims?.length ?? 0),
  );
  const contradictionFree = contradictionCount === 0;
  const objectiveClosure = input.objective
    ? Boolean(
        input.objectiveClosure
        ?? (
          input.gate?.status === "PROVEN"
          && (input.gate?.contradictoryClaims?.length ?? 0) === 0
        ),
      )
    : Boolean(input.objectiveClosure ?? evidenceCompleteness === 1);

  // Source diversity is deliberately the strongest quality multiplier: a
  // single implementation file must remain limited even when it is complete.
  const rawScore =
    evidenceCompleteness * 0.15
    + claimCoverage * 0.10
    + sourceDiversity * 0.35
    + (revisionMatch ? 0.15 : 0)
    + (contradictionFree ? 0.10 : 0)
    + (objectiveClosure ? 0.15 : 0);
  const score = round(rawScore);
  const proven = Boolean(
    score >= 0.85
    && evidenceCompleteness === 1
    && claimCoverage === 1
    && sourceTypes.length >= 2
    && revisionMatch
    && contradictionFree
    && objectiveClosure,
  );
  const level: ServerConfidenceLevel = !proven && (!objectiveClosure || !contradictionFree || score < 0.45)
    ? "NOT_PROVEN"
    : proven
      ? "HIGH"
      : score >= 0.8
        ? "MEDIUM"
        : "LIMITED";

  return {
    score,
    level,
    evidenceCompleteness: round(evidenceCompleteness),
    acceptedClaimCount,
    requiredClaimCount,
    sourceDiversity: round(sourceDiversity),
    sourceTypes,
    sourceCount,
    projectionEvidence: Boolean(input.projectionEvidence),
    revisionMatch,
    contradictionCount,
    contradictionFree,
    objectiveClosure,
    ...(typeof input.modelSuggestedScore === "number"
      ? { modelSuggestedScore: round(input.modelSuggestedScore) }
      : {}),
  };
}