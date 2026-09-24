import { createHash, randomUUID } from "node:crypto";
import { asc, desc, eq } from "drizzle-orm";
import {
  aiAgentShadowCampaignEventsTable,
  db,
  type AiAgentShadowCampaignEvent,
} from "@workspace/db";

export const AGENT_EPISODE_SHADOW_CAMPAIGN_ID = `shadow-campaign:${randomUUID()}`;

export type AgentEpisodeShadowCampaignScorecard = {
  campaignId: string;
  writes: number;
  successes: number;
  failures: number;
  staleWorkerRejections: number;
  sequenceConflicts: number;
  idempotencyConflicts: number;
  terminalImmutableRejections: number;
  p95LatencyMs: number | null;
  firstOccurredAt: string;
  lastOccurredAt: string;
};

function hashIdempotencyKey(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function p95(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  return sorted[index] ?? null;
}

function toScorecard(
  campaignId: string,
  rows: readonly AiAgentShadowCampaignEvent[],
): AgentEpisodeShadowCampaignScorecard | undefined {
  if (rows.length === 0) return undefined;
  const latencies = rows.flatMap((row) => row.latencyMs === null ? [] : [row.latencyMs]);
  const countFailure = (code: string) => rows.filter((row) => row.failureCode === code).length;
  return {
    campaignId,
    writes: rows.length,
    successes: rows.filter((row) => row.outcome === "success").length,
    failures: rows.filter((row) => row.outcome === "failure").length,
    staleWorkerRejections: countFailure("stale_worker"),
    sequenceConflicts: countFailure("sequence_conflict"),
    idempotencyConflicts: countFailure("invalid_contract"),
    terminalImmutableRejections: countFailure("terminal_immutable"),
    p95LatencyMs: p95(latencies),
    firstOccurredAt: rows[0]!.occurredAt.toISOString(),
    lastOccurredAt: rows[rows.length - 1]!.occurredAt.toISOString(),
  };
}

export async function persistAgentEpisodeShadowAttempt(input: {
  projectId: string;
  executionId: string;
  attempt: number;
  idempotencyKey: string;
  outcome: "success" | "failure";
  failureCode?: string;
  latencyMs: number;
}): Promise<void> {
  await db.insert(aiAgentShadowCampaignEventsTable).values({
    id: randomUUID(),
    campaignId: AGENT_EPISODE_SHADOW_CAMPAIGN_ID,
    projectId: input.projectId,
    executionId: input.executionId,
    attempt: input.attempt,
    idempotencyKeyHash: hashIdempotencyKey(input.idempotencyKey),
    outcome: input.outcome,
    ...(input.failureCode ? { failureCode: input.failureCode.slice(0, 80) } : {}),
    latencyMs: Math.max(0, Math.min(Math.round(input.latencyMs), 60_000)),
  }).onConflictDoNothing();
}

/**
 * Returns the most recent bounded campaign, including campaigns from earlier
 * API processes. This is telemetry only and must never feed acceptance.
 */
export async function loadLatestAgentEpisodeShadowCampaignScorecard(): Promise<
  AgentEpisodeShadowCampaignScorecard | undefined
> {
  const [latest] = await db
    .select()
    .from(aiAgentShadowCampaignEventsTable)
    .orderBy(desc(aiAgentShadowCampaignEventsTable.occurredAt))
    .limit(1);
  if (!latest) return undefined;

  const rows = await db
    .select()
    .from(aiAgentShadowCampaignEventsTable)
    .where(eq(aiAgentShadowCampaignEventsTable.campaignId, latest.campaignId))
    .orderBy(asc(aiAgentShadowCampaignEventsTable.occurredAt))
    .limit(2_048);
  return toScorecard(latest.campaignId, rows);
}