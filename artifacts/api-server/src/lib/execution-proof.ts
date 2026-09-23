import { createHash } from "node:crypto";
import { RecipeReceiptSchema, type RecipeReceipt } from "@workspace/ai-orchestrator";

export const EXECUTION_PROOF_CONTRACT_VERSION = 1 as const;

export type ExecutionProofVerdict = "PROVEN" | "INCOMPLETE" | "UNAVAILABLE";

export type ExecutionTrajectoryDigest = {
  contractVersion: typeof EXECUTION_PROOF_CONTRACT_VERSION;
  source: "recipe_receipt" | "acceptance";
  digest: string;
  nodeCount: number;
  passedNodeCount: number;
  failedNodeCount: number;
  blockedNodeCount: number;
  attemptCount: number;
  totalElapsedMs: number;
  evidenceRefCount: number;
};

export type ExecutionProofProjection = {
  contractVersion: typeof EXECUTION_PROOF_CONTRACT_VERSION;
  verdict: ExecutionProofVerdict;
  evidenceRequired: boolean;
  evidenceComplete: boolean;
  evidenceSnapshotId: string | null;
  acceptedRefs: string[];
  sourceBound: boolean;
  candidateBound: boolean;
  trajectoryDigest: ExecutionTrajectoryDigest;
};

function boundedRefs(values: readonly unknown[]): string[] {
  return [...new Set(
    values
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter(Boolean),
  )].slice(0, 48);
}

function hashSummary(summary: Record<string, unknown>): string {
  return createHash("sha256")
    .update(JSON.stringify(summary), "utf8")
    .digest("hex");
}

function parseRecipeReceipt(value: unknown): RecipeReceipt | undefined {
  const parsed = RecipeReceiptSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export function buildExecutionTrajectoryDigest(params: {
  outcome: "SUCCEEDED" | "FAILED" | "INTERRUPTED";
  evidenceComplete: boolean;
  recipeReceipt?: unknown;
}): ExecutionTrajectoryDigest {
  const receipt = parseRecipeReceipt(params.recipeReceipt);
  if (receipt) {
    const nodes = receipt.nodes;
    const passedNodeCount = nodes.filter((node) => node.status === "passed").length;
    const failedNodeCount = nodes.filter((node) => node.status === "failed").length;
    const blockedNodeCount = nodes.filter((node) => node.status === "blocked").length;
    const attemptCount = nodes.reduce((sum, node) => sum + node.attempts, 0);
    const totalElapsedMs = nodes.reduce((sum, node) => sum + node.elapsedMs, 0);
    const evidenceRefCount = boundedRefs(receipt.evidenceRefs).length;
    const summary = {
      contractVersion: EXECUTION_PROOF_CONTRACT_VERSION,
      source: "recipe_receipt",
      outcome: params.outcome,
      evidenceComplete: params.evidenceComplete,
      recipeId: receipt.recipeId,
      recipeVersion: receipt.recipeVersion,
      status: receipt.status,
      completedNodeIds: [...receipt.completedNodeIds].sort(),
      nodeStatuses: nodes.map((node) => ({
        nodeId: node.nodeId,
        status: node.status,
        attempts: node.attempts,
        elapsedMs: node.elapsedMs,
        evidenceId: node.evidenceId,
      })),
      evidenceRefs: boundedRefs(receipt.evidenceRefs).sort(),
    };
    return {
      contractVersion: EXECUTION_PROOF_CONTRACT_VERSION,
      source: "recipe_receipt",
      digest: hashSummary(summary),
      nodeCount: nodes.length,
      passedNodeCount,
      failedNodeCount,
      blockedNodeCount,
      attemptCount,
      totalElapsedMs,
      evidenceRefCount,
    };
  }

  const summary = {
    contractVersion: EXECUTION_PROOF_CONTRACT_VERSION,
    source: "acceptance",
    outcome: params.outcome,
    evidenceComplete: params.evidenceComplete,
  };
  return {
    contractVersion: EXECUTION_PROOF_CONTRACT_VERSION,
    source: "acceptance",
    digest: hashSummary(summary),
    nodeCount: 0,
    passedNodeCount: 0,
    failedNodeCount: 0,
    blockedNodeCount: 0,
    attemptCount: 0,
    totalElapsedMs: 0,
    evidenceRefCount: 0,
  };
}

export function buildExecutionProofProjection(params: {
  outcome: "SUCCEEDED" | "FAILED" | "INTERRUPTED";
  evidenceRequired: boolean;
  evidenceComplete: boolean;
  evidenceSnapshotId?: string | null;
  sourceRevision?: string | null;
  candidateIdentity?: string | null;
  recipeReceipt?: unknown;
}): ExecutionProofProjection {
  const verdict: ExecutionProofVerdict = params.outcome === "SUCCEEDED"
    ? params.evidenceRequired && !params.evidenceComplete ? "INCOMPLETE" : "PROVEN"
    : params.evidenceRequired && !params.evidenceComplete ? "INCOMPLETE" : "UNAVAILABLE";
  const acceptedRefs = params.evidenceSnapshotId ? [params.evidenceSnapshotId] : [];
  const receipt = parseRecipeReceipt(params.recipeReceipt);
  if (receipt) acceptedRefs.push(...receipt.evidenceRefs);

  return {
    contractVersion: EXECUTION_PROOF_CONTRACT_VERSION,
    verdict,
    evidenceRequired: params.evidenceRequired,
    evidenceComplete: params.evidenceComplete,
    evidenceSnapshotId: params.evidenceSnapshotId ?? null,
    acceptedRefs: boundedRefs(acceptedRefs),
    sourceBound: typeof params.sourceRevision === "string" && params.sourceRevision.trim().length > 0,
    candidateBound: typeof params.candidateIdentity === "string" && params.candidateIdentity.trim().length > 0,
    trajectoryDigest: buildExecutionTrajectoryDigest({
      outcome: params.outcome,
      evidenceComplete: params.evidenceComplete,
      recipeReceipt: params.recipeReceipt,
    }),
  };
}

export function parseExecutionProofProjection(value: unknown): ExecutionProofProjection | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Partial<ExecutionProofProjection>;
  const digest = candidate.trajectoryDigest;
  if (
    candidate.contractVersion !== EXECUTION_PROOF_CONTRACT_VERSION
    || !["PROVEN", "INCOMPLETE", "UNAVAILABLE"].includes(candidate.verdict ?? "")
    || typeof candidate.evidenceRequired !== "boolean"
    || typeof candidate.evidenceComplete !== "boolean"
    || (candidate.evidenceSnapshotId !== null && typeof candidate.evidenceSnapshotId !== "string")
    || !Array.isArray(candidate.acceptedRefs)
    || candidate.acceptedRefs.some((ref) => typeof ref !== "string")
    || typeof candidate.sourceBound !== "boolean"
    || typeof candidate.candidateBound !== "boolean"
    || !digest
    || digest.contractVersion !== EXECUTION_PROOF_CONTRACT_VERSION
    || !["recipe_receipt", "acceptance"].includes(digest.source ?? "")
    || typeof digest.digest !== "string"
    || !/^[a-f0-9]{64}$/i.test(digest.digest)
    || !Number.isInteger(digest.nodeCount)
    || !Number.isInteger(digest.passedNodeCount)
    || !Number.isInteger(digest.failedNodeCount)
    || !Number.isInteger(digest.blockedNodeCount)
    || !Number.isInteger(digest.attemptCount)
    || !Number.isInteger(digest.totalElapsedMs)
    || !Number.isInteger(digest.evidenceRefCount)
  ) return undefined;

  return {
    contractVersion: EXECUTION_PROOF_CONTRACT_VERSION,
    verdict: candidate.verdict as ExecutionProofVerdict,
    evidenceRequired: candidate.evidenceRequired,
    evidenceComplete: candidate.evidenceComplete,
    evidenceSnapshotId: candidate.evidenceSnapshotId ?? null,
    acceptedRefs: boundedRefs(candidate.acceptedRefs).slice(0, 48),
    sourceBound: candidate.sourceBound,
    candidateBound: candidate.candidateBound,
    trajectoryDigest: {
      contractVersion: EXECUTION_PROOF_CONTRACT_VERSION,
      source: digest.source as ExecutionTrajectoryDigest["source"],
      digest: digest.digest,
      nodeCount: digest.nodeCount,
      passedNodeCount: digest.passedNodeCount,
      failedNodeCount: digest.failedNodeCount,
      blockedNodeCount: digest.blockedNodeCount,
      attemptCount: digest.attemptCount,
      totalElapsedMs: digest.totalElapsedMs,
      evidenceRefCount: digest.evidenceRefCount,
    },
  };
}