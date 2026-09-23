import { z } from "zod";
import type { DeliveryPairedBaselineComparison } from "./paired-baseline-delivery.js";

export const SKILL_REGISTRY_CONTRACT_VERSION = 1 as const;

const DigestSchema = z.string().regex(/^[a-f0-9]{40}$|^[a-f0-9]{64}$/i);

export const SkillRegistryIdentitySchema = z.object({
  skillId: z.string().trim().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
  skillVersion: z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9][A-Za-z0-9._+-]*$/),
}).strict();

export type SkillRegistryIdentity = z.infer<typeof SkillRegistryIdentitySchema>;

export type SkillShadowScore = {
  contractVersion: typeof SKILL_REGISTRY_CONTRACT_VERSION;
  status: DeliveryPairedBaselineComparison["status"];
  promotionAllowed: boolean;
  pairId: string;
  suiteVersion: string;
  baselineWorkspaceHash: string;
  candidateWorkspaceHash: string;
  metricDeltas: DeliveryPairedBaselineComparison["metricDeltas"] | null;
  terminalMismatchCount: number;
  caseCount: number;
  blockers: string[];
};

const ShadowReplayRegistryReceiptSchema = z.object({
  contractVersion: z.literal(1),
  runId: z.string().min(1).max(160),
  candidateId: z.string().min(1).max(160),
  projectId: z.string().min(1).max(160),
  sourceRevision: z.string().min(1).max(240),
  candidateTreeHash: DigestSchema,
  proof: z.object({
    receiptId: z.string().min(1).max(240),
    trajectoryDigest: DigestSchema,
    verdict: z.literal("PROVEN"),
  }).strict(),
  productionExecution: z.literal(false),
  replayId: z.string().min(1).max(160),
  replayExecutionId: z.string().min(1).max(160),
  status: z.literal("completed"),
  preTreeHash: DigestSchema,
  postTreeHash: DigestSchema,
  workspaceIsolated: z.literal(true),
  workspaceCleaned: z.literal(true),
  pairedBaseline: z.unknown(),
}).passthrough();

export type ShadowReplayRegistryReceipt = z.infer<typeof ShadowReplayRegistryReceiptSchema>;

export function parseShadowReplayRegistryReceipt(value: unknown): ShadowReplayRegistryReceipt | null {
  const parsed = ShadowReplayRegistryReceiptSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isPairedBaselineComparison(value: unknown): value is DeliveryPairedBaselineComparison {
  if (!isRecord(value) || !isRecord(value.contract)) return false;
  const contract = value.contract;
  return (
    value.kind === "code-agent-benchmark-paired-comparison"
    && value.version === 1
    && typeof value.status === "string"
    && ["incomplete", "regressed", "passed"].includes(value.status)
    && typeof value.promotionAllowed === "boolean"
    && typeof contract.pairId === "string"
    && typeof contract.suiteVersion === "string"
    && typeof value.baselineWorkspaceHash === "string"
    && typeof value.candidateWorkspaceHash === "string"
    && Number.isInteger(value.terminalMismatchCount)
    && Array.isArray(value.cases)
    && Array.isArray(value.blockers)
  );
}

export function buildSkillShadowScore(input: {
  comparison: unknown;
  replayId: string;
  candidateId: string;
  candidateTreeHash: string;
  baselineTreeHash?: string | null;
}): SkillShadowScore | null {
  if (!isPairedBaselineComparison(input.comparison)) return null;
  const comparison = input.comparison;
  const contractCandidateId = (
    comparison.contract as unknown as { candidateId?: unknown }
  ).candidateId;
  if (
    comparison.kind !== "code-agent-benchmark-paired-comparison"
    || comparison.version !== 1
    || comparison.contract.pairId !== `shadow-replay-pair:${input.replayId}`
    || contractCandidateId !== input.candidateId
    || !DigestSchema.safeParse(comparison.baselineWorkspaceHash).success
    || !DigestSchema.safeParse(comparison.candidateWorkspaceHash).success
    || comparison.candidateWorkspaceHash !== input.candidateTreeHash
    || (
      input.baselineTreeHash
      && comparison.baselineWorkspaceHash !== input.baselineTreeHash
    )
    || comparison.status !== "passed"
    || comparison.promotionAllowed !== true
  ) {
    return null;
  }

  return {
    contractVersion: SKILL_REGISTRY_CONTRACT_VERSION,
    status: comparison.status,
    promotionAllowed: comparison.promotionAllowed,
    pairId: comparison.contract.pairId,
    suiteVersion: comparison.contract.suiteVersion,
    baselineWorkspaceHash: comparison.baselineWorkspaceHash,
    candidateWorkspaceHash: comparison.candidateWorkspaceHash,
    metricDeltas: comparison.metricDeltas ?? null,
    terminalMismatchCount: comparison.terminalMismatchCount,
    caseCount: comparison.cases.length,
    blockers: [...comparison.blockers],
  };
}

export const SkillShadowScoreSchema = z.object({
  contractVersion: z.literal(SKILL_REGISTRY_CONTRACT_VERSION),
  status: z.enum(["incomplete", "regressed", "passed"]),
  promotionAllowed: z.boolean(),
  pairId: z.string().min(1).max(240),
  suiteVersion: z.string().min(1).max(120),
  baselineWorkspaceHash: DigestSchema,
  candidateWorkspaceHash: DigestSchema,
  metricDeltas: z.record(z.string(), z.unknown()).nullable(),
  terminalMismatchCount: z.number().int().nonnegative(),
  caseCount: z.number().int().nonnegative(),
  blockers: z.array(z.string().max(240)).max(64),
}).strict();