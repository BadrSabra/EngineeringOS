import {
  projectCanonicalProof,
  type CanonicalProof,
  type PublicCanonicalProofProjection,
} from "./proof-foundation.js";

export const PROOF_SPINE_CONTRACT_VERSION = 1 as const;

/**
 * The public, metadata-only proof spine shared by evidence, mission, replay,
 * and promotion projections. It deliberately contains identities and bounded
 * verdicts only; source bodies, provider payloads, and raw traces stay out.
 */
export type ProofSpineProjection = {
  contractVersion: typeof PROOF_SPINE_CONTRACT_VERSION;
  verdict: PublicCanonicalProofProjection["verdict"];
  accepted: boolean;
  failureReasons: string[];
  identity: {
    projectId: string | null;
    missionId: string | null;
    goalId: string | null;
    executionId: string | null;
    acceptanceId: string | null;
    attempt: number | null;
    operationId: string | null;
  };
  revision: {
    source: string | null;
    plan: string | null;
    activePlan: string | null;
  };
  evidence: {
    snapshotId: string | null;
    retained: boolean;
  };
  candidate: {
    identity: string | null;
    treeHash: string | null;
  };
  delivery: {
    required: boolean;
    proven: boolean;
    treeHash: string | null;
  };
  trajectoryDigest: string | null;
  replay: {
    replayId: string | null;
    executionId: string | null;
    status: "completed" | "incomplete" | "failed" | null;
  };
  pairedBaseline: {
    status: "passed" | "incomplete" | "regressed" | null;
    promotionAllowed: boolean | null;
  };
};

export type ProofSpineRefs = {
  replay?: {
    replayId: string;
    executionId: string;
    status: "completed" | "incomplete" | "failed";
  } | null;
  pairedBaseline?: {
    status: "passed" | "incomplete" | "regressed";
    promotionAllowed: boolean;
  } | null;
};

function boundedReasons(reasons: readonly string[]): string[] {
  return [...new Set(reasons)]
    .filter((reason) => typeof reason === "string" && reason.length > 0)
    .slice(0, 16);
}

export function projectProofSpine(
  proof: CanonicalProof,
  refs: ProofSpineRefs = {},
): ProofSpineProjection {
  const publicProof = projectCanonicalProof(proof);
  const replay = refs.replay ?? null;
  const pairedBaseline = refs.pairedBaseline ?? null;
  const source = proof.scope.sourceRevision ?? publicProof.sourceRevision;

  return {
    contractVersion: PROOF_SPINE_CONTRACT_VERSION,
    verdict: publicProof.verdict,
    accepted: publicProof.accepted,
    failureReasons: boundedReasons(publicProof.failureReasons),
    identity: {
      projectId: proof.scope.projectId ?? null,
      missionId: proof.scope.missionId ?? null,
      goalId: proof.scope.goalId ?? null,
      executionId: publicProof.executionId,
      acceptanceId: publicProof.acceptanceId,
      attempt: publicProof.attempt,
      operationId: publicProof.operationId,
    },
    revision: {
      source,
      plan: proof.scope.planRevision ?? null,
      activePlan: proof.scope.activePlanRevision ?? null,
    },
    evidence: {
      snapshotId: publicProof.evidenceSnapshotId,
      retained: Boolean(publicProof.evidenceSnapshotId && proof.projection?.evidenceComplete),
    },
    candidate: {
      identity: publicProof.candidateIdentity,
      treeHash: publicProof.candidateTreeHash,
    },
    delivery: {
      required: Boolean(proof.delivery),
      proven: proof.delivery?.status === "completed"
        && Boolean(proof.delivery.treeHash),
      treeHash: publicProof.treeHash,
    },
    trajectoryDigest: proof.trajectoryDigest?.digest ?? null,
    replay: {
      replayId: replay?.replayId ?? null,
      executionId: replay?.executionId ?? null,
      status: replay?.status ?? null,
    },
    pairedBaseline: {
      status: pairedBaseline?.status ?? null,
      promotionAllowed: pairedBaseline?.promotionAllowed ?? null,
    },
  };
}

export function projectPublicProofSpine(
  proof: PublicCanonicalProofProjection,
  refs: ProofSpineRefs = {},
): ProofSpineProjection {
  const replay = refs.replay ?? null;
  const pairedBaseline = refs.pairedBaseline ?? null;
  return {
    contractVersion: PROOF_SPINE_CONTRACT_VERSION,
    verdict: proof.verdict,
    accepted: proof.accepted,
    failureReasons: boundedReasons(proof.failureReasons),
    identity: {
      projectId: null,
      missionId: null,
      goalId: null,
      executionId: proof.executionId,
      acceptanceId: proof.acceptanceId,
      attempt: proof.attempt,
      operationId: proof.operationId,
    },
    revision: { source: proof.sourceRevision, plan: null, activePlan: null },
    evidence: {
      snapshotId: proof.evidenceSnapshotId,
      retained: Boolean(proof.evidenceSnapshotId && proof.accepted),
    },
    candidate: {
      identity: proof.candidateIdentity,
      treeHash: proof.candidateTreeHash,
    },
    delivery: {
      required: Boolean(proof.treeHash || proof.candidateTreeHash),
      proven: Boolean(proof.treeHash),
      treeHash: proof.treeHash,
    },
    trajectoryDigest: null,
    replay: {
      replayId: replay?.replayId ?? null,
      executionId: replay?.executionId ?? null,
      status: replay?.status ?? null,
    },
    pairedBaseline: {
      status: pairedBaseline?.status ?? null,
      promotionAllowed: pairedBaseline?.promotionAllowed ?? null,
    },
  };
}