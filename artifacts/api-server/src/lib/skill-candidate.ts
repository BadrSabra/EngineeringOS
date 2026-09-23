import { z } from "zod";
import {
  EXECUTION_PROOF_CONTRACT_VERSION,
  parseExecutionProofProjection,
  type ExecutionProofProjection,
} from "./execution-proof.js";

export const SKILL_CANDIDATE_CONTRACT_VERSION = 1 as const;

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/i, "expected a SHA-256 digest");
const SafePathSchema = z
  .string()
  .min(1)
  .max(500)
  .regex(
    /^(?!\/)(?![A-Za-z]:[\\/])(?!.*\\)(?!.*(?:^|\/)\.\.(?:\/|$)).+$/,
    "approved paths must be project-relative",
  );

export const SkillCandidateEnvelopeSchema = z.object({
  contractVersion: z.literal(SKILL_CANDIDATE_CONTRACT_VERSION),
  candidateId: z.string().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
  projectId: z.string().min(1).max(160),
  sourceRevision: z.string().min(1).max(240),
  candidateTreeHash: Sha256Schema,
  changeSetHash: Sha256Schema.nullable(),
  approvedPaths: z.array(SafePathSchema).max(48),
  verification: z.object({
    recipeId: z.literal("candidate.verify"),
    recipeVersion: z.literal(1),
  }).strict(),
  proof: z.object({
    receiptId: z.string().min(1).max(240),
    trajectoryDigest: Sha256Schema,
    verdict: z.enum(["PROVEN", "INCOMPLETE", "UNAVAILABLE"]),
    projection: z.unknown(),
  }).strict(),
  shadow: z.object({
    mode: z.literal("shadow-replay"),
    runId: z.string().min(1).max(160),
    isolated: z.literal(true),
    productionExecution: z.literal(false),
  }).strict(),
}).strict();

export type SkillCandidateEnvelope = z.infer<typeof SkillCandidateEnvelopeSchema>;

export const StoredProposalEvidenceSchema = z.object({
  validationResults: z.array(z.unknown()),
  skillCandidate: SkillCandidateEnvelopeSchema,
}).strict();

export type StoredProposalEvidence = z.infer<typeof StoredProposalEvidenceSchema>;

export type SkillCandidateReplayDecision = {
  allowed: boolean;
  reasons: string[];
  envelope?: SkillCandidateEnvelope;
};

export type ShadowReplayReceipt = {
  contractVersion: typeof SKILL_CANDIDATE_CONTRACT_VERSION;
  runId: string;
  candidateId: string;
  projectId: string;
  sourceRevision: string;
  candidateTreeHash: string;
  verification: SkillCandidateEnvelope["verification"];
  proof: {
    receiptId: string;
    trajectoryDigest: string;
    verdict: "PROVEN" | "INCOMPLETE" | "UNAVAILABLE";
  };
  productionExecution: false;
};

export function buildSkillCandidateEnvelope(params: {
  proposalId: string;
  projectId: string;
  sourceRevision: string;
  candidateTreeHash: string;
  changeSetHash?: string | null;
  approvedPaths: readonly string[];
  receiptId: string;
  proof: ExecutionProofProjection;
  runId: string;
}): SkillCandidateEnvelope {
  return SkillCandidateEnvelopeSchema.parse({
    contractVersion: SKILL_CANDIDATE_CONTRACT_VERSION,
    candidateId: `skill-candidate:${params.proposalId}:${params.candidateTreeHash}`,
    projectId: params.projectId,
    sourceRevision: params.sourceRevision,
    candidateTreeHash: params.candidateTreeHash,
    changeSetHash: params.changeSetHash ?? null,
    approvedPaths: uniquePaths(params.approvedPaths),
    verification: {
      recipeId: "candidate.verify",
      recipeVersion: 1,
    },
    proof: {
      receiptId: params.receiptId,
      trajectoryDigest: params.proof.trajectoryDigest.digest,
      verdict: params.proof.verdict,
      projection: params.proof,
    },
    shadow: {
      mode: "shadow-replay",
      runId: params.runId,
      isolated: true,
      productionExecution: false,
    },
  });
}

export function parseStoredProposalEvidence(value: unknown): {
  validationResults: unknown[];
  skillCandidate?: SkillCandidateEnvelope;
} {
  if (Array.isArray(value)) return { validationResults: value };
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { validationResults: [] };
  }
  const record = value as Record<string, unknown>;
  const validationResults = Array.isArray(record.validationResults)
    ? record.validationResults
    : [];
  const candidate = SkillCandidateEnvelopeSchema.safeParse(record.skillCandidate);
  return candidate.success
    ? { validationResults, skillCandidate: candidate.data }
    : { validationResults };
}

export function serializeProposalEvidence(
  current: unknown,
  skillCandidate: SkillCandidateEnvelope,
): string {
  const parsed = parseStoredProposalEvidence(current);
  return JSON.stringify({
    validationResults: parsed.validationResults,
    skillCandidate,
  } satisfies StoredProposalEvidence);
}

function uniquePaths(paths: readonly string[]): string[] {
  return [...new Set(paths.map((path) => path.trim()).filter(Boolean))];
}

export function validateSkillCandidateForShadow(
  value: unknown,
  expected?: {
    projectId?: string;
    sourceRevision?: string;
    candidateTreeHash?: string;
    changeSetHash?: string | null;
  },
): SkillCandidateReplayDecision {
  const parsed = SkillCandidateEnvelopeSchema.safeParse(value);
  if (!parsed.success) {
    return { allowed: false, reasons: ["invalid_skill_candidate_envelope"] };
  }
  const envelope = parsed.data;
  const reasons: string[] = [];
  const proof = parseExecutionProofProjection(envelope.proof.projection);
  if (!proof) reasons.push("invalid_execution_proof_projection");
  if (proof && proof.contractVersion !== EXECUTION_PROOF_CONTRACT_VERSION) {
    reasons.push("unsupported_execution_proof_version");
  }
  if (proof && proof.trajectoryDigest.digest !== envelope.proof.trajectoryDigest) {
    reasons.push("trajectory_digest_mismatch");
  }
  if (proof && (proof.verdict !== envelope.proof.verdict || proof.verdict !== "PROVEN")) {
    reasons.push("skill_candidate_proof_not_proven");
  }
  if (proof && (!proof.evidenceComplete || !proof.sourceBound || !proof.candidateBound)) {
    reasons.push("skill_candidate_proof_not_bound");
  }
  if (expected?.projectId && envelope.projectId !== expected.projectId) {
    reasons.push("project_mismatch");
  }
  if (expected?.sourceRevision && envelope.sourceRevision !== expected.sourceRevision) {
    reasons.push("source_revision_mismatch");
  }
  if (expected?.candidateTreeHash && envelope.candidateTreeHash !== expected.candidateTreeHash) {
    reasons.push("candidate_tree_hash_mismatch");
  }
  if (
    expected
    && expected.changeSetHash !== undefined
    && envelope.changeSetHash !== expected.changeSetHash
  ) {
    reasons.push("change_set_hash_mismatch");
  }
  if (uniquePaths(envelope.approvedPaths).length !== envelope.approvedPaths.length) {
    reasons.push("duplicate_approved_path");
  }
  return reasons.length === 0
    ? { allowed: true, reasons: [], envelope }
    : { allowed: false, reasons };
}

export function buildShadowReplayReceipt(
  value: unknown,
  expected?: Parameters<typeof validateSkillCandidateForShadow>[1],
): ShadowReplayReceipt {
  const decision = validateSkillCandidateForShadow(value, expected);
  if (!decision.allowed || !decision.envelope) {
    throw new Error(`Shadow replay rejected: ${decision.reasons.join("; ")}`);
  }
  const envelope = decision.envelope;
  return {
    contractVersion: SKILL_CANDIDATE_CONTRACT_VERSION,
    runId: envelope.shadow.runId,
    candidateId: envelope.candidateId,
    projectId: envelope.projectId,
    sourceRevision: envelope.sourceRevision,
    candidateTreeHash: envelope.candidateTreeHash,
    verification: envelope.verification,
    proof: {
      receiptId: envelope.proof.receiptId,
      trajectoryDigest: envelope.proof.trajectoryDigest,
      verdict: envelope.proof.verdict,
    },
    productionExecution: false,
  };
}