import { and, eq, gt, inArray, or, sql } from "drizzle-orm";
import {
  aiAgentEpisodesTable,
  aiAgentObservationsTable,
  aiMissionsTable,
  db,
  eventsTable,
} from "@workspace/db";

export const MISSION_REPLAN_BACKOFF_SCHEMA_VERSION = 1 as const;
export const MISSION_REPLAN_BACKOFF_MIN_DELAY_MS = 30_000;
export const MISSION_REPLAN_BACKOFF_MAX_DELAY_MS = 30 * 60_000;

export type MissionReplanBackoff = {
  schemaVersion: typeof MISSION_REPLAN_BACKOFF_SCHEMA_VERSION;
  attemptCount: number;
  lastAttemptAt: string;
  nextAttemptAt: string;
  lastFailureCode: string;
};

type MissionReplanBackoffTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function safeFailureCode(value: string): string {
  return /^[A-Za-z0-9_.-]{1,96}$/.test(value) ? value : "mission_replan_failed";
}

export function parseMissionReplanBackoff(value: unknown): MissionReplanBackoff | null {
  if (!isRecord(value)) return null;
  if (
    value.schemaVersion !== MISSION_REPLAN_BACKOFF_SCHEMA_VERSION
    || !Number.isSafeInteger(value.attemptCount)
    || Number(value.attemptCount) < 1
    || !validTimestamp(value.lastAttemptAt)
    || !validTimestamp(value.nextAttemptAt)
    || typeof value.lastFailureCode !== "string"
  ) return null;
  return {
    schemaVersion: MISSION_REPLAN_BACKOFF_SCHEMA_VERSION,
    attemptCount: Math.min(Number(value.attemptCount), 1_000_000),
    lastAttemptAt: value.lastAttemptAt,
    nextAttemptAt: value.nextAttemptAt,
    lastFailureCode: safeFailureCode(value.lastFailureCode),
  };
}

export function missionReplanBackoffDelayMs(attemptCount: number): number {
  const exponent = Math.min(Math.max(Math.floor(attemptCount) - 1, 0), 16);
  return Math.min(
    MISSION_REPLAN_BACKOFF_MAX_DELAY_MS,
    MISSION_REPLAN_BACKOFF_MIN_DELAY_MS * 2 ** exponent,
  );
}

export function isMissionReplanBackoffActive(
  value: unknown,
  now: Date,
): value is MissionReplanBackoff {
  const backoff = parseMissionReplanBackoff(value);
  return Boolean(backoff && Date.parse(backoff.nextAttemptAt) > now.getTime());
}

function nextMissionReplanBackoff(
  currentPolicy: unknown,
  failureCode: string,
  now: Date,
): MissionReplanBackoff {
  const policy = isRecord(currentPolicy) ? currentPolicy : {};
  const previous = parseMissionReplanBackoff(policy.automaticReplanBackoff);
  const attemptCount = Math.min((previous?.attemptCount ?? 0) + 1, 1_000_000);
  return {
    schemaVersion: MISSION_REPLAN_BACKOFF_SCHEMA_VERSION,
    attemptCount,
    lastAttemptAt: now.toISOString(),
    nextAttemptAt: new Date(
      now.getTime() + missionReplanBackoffDelayMs(attemptCount),
    ).toISOString(),
    lastFailureCode: safeFailureCode(failureCode),
  };
}

async function readDatabaseNow(tx: MissionReplanBackoffTransaction): Promise<Date> {
  const result = await tx.execute(sql`SELECT clock_timestamp() AS now`);
  const raw = (result.rows as Array<{ now: Date | string }>)[0]?.now;
  const now = raw instanceof Date ? raw : new Date(String(raw ?? ""));
  if (!raw || !Number.isFinite(now.getTime())) {
    throw new Error("mission_replan_database_clock_unavailable");
  }
  return now;
}

export async function persistMissionReplanBackoffInTransaction(
  tx: MissionReplanBackoffTransaction,
  input: {
    missionId: string;
    currentPolicy: unknown;
    failureCode: string;
  },
): Promise<MissionReplanBackoff> {
  const now = await readDatabaseNow(tx);
  const policy = isRecord(input.currentPolicy) ? input.currentPolicy : {};
  const backoff = nextMissionReplanBackoff(policy, input.failureCode, now);
  await tx.update(aiMissionsTable)
    .set({
      autonomyPolicy: {
        ...policy,
        automaticReplanBackoff: backoff,
      },
      updatedAt: now,
    })
    .where(eq(aiMissionsTable.id, input.missionId));
  return backoff;
}

export async function persistMissionReplanBackoffForMission(
  missionId: string,
  failureCode: string,
): Promise<MissionReplanBackoff | null> {
  return db.transaction(async (tx) => {
    const [mission] = await tx.select({
      status: aiMissionsTable.status,
      autonomyPolicy: aiMissionsTable.autonomyPolicy,
    }).from(aiMissionsTable)
      .where(eq(aiMissionsTable.id, missionId))
      .for("update")
      .limit(1);
    if (!mission || mission.status !== "needs_replan") return null;
    return persistMissionReplanBackoffInTransaction(tx, {
      missionId,
      currentPolicy: mission.autonomyPolicy,
      failureCode,
    });
  });
}

/**
 * Progress evidence is only a wake-up hint. The Mission planner still reruns
 * all existing binding, freshness, approval, and execution-authority checks.
 */
export async function hasNewMissionReplanProgressEvidence(
  tx: MissionReplanBackoffTransaction,
  input: {
    missionId: string;
    projectId: string;
    failedGoalId: string;
    after: Date;
  },
): Promise<boolean> {
  const [observation] = await tx.select({
    id: aiAgentObservationsTable.id,
  }).from(aiAgentObservationsTable)
    .innerJoin(
      aiAgentEpisodesTable,
      eq(aiAgentEpisodesTable.id, aiAgentObservationsTable.episodeId),
    )
    .where(and(
      eq(aiAgentEpisodesTable.missionId, input.missionId),
      eq(aiAgentEpisodesTable.projectId, input.projectId),
      eq(aiAgentEpisodesTable.goalId, input.failedGoalId),
      eq(aiAgentObservationsTable.projectId, input.projectId),
      gt(aiAgentObservationsTable.createdAt, input.after),
      eq(aiAgentObservationsTable.kind, "direct_observation"),
      eq(aiAgentObservationsTable.provenance, "DIRECT_OBSERVATION"),
      eq(aiAgentObservationsTable.completeness, "complete"),
      eq(aiAgentObservationsTable.freshness, "fresh"),
    ))
    .limit(1);
  if (observation) return true;

  const [event] = await tx.select({
    id: eventsTable.id,
  }).from(eventsTable)
    .where(and(
      eq(eventsTable.projectId, input.projectId),
      gt(eventsTable.timestamp, input.after),
      or(
        and(
          eq(eventsTable.goalId, input.failedGoalId),
          inArray(eventsTable.type, [
            "AiMissionExternalEventReceived",
            "AiMissionWorldTransitionWakeRequested",
          ]),
        ),
        and(
          eq(eventsTable.type, "MissionGoalWakeDispatched"),
          sql`${eventsTable.payload}->>'missionId' = ${input.missionId}`,
        ),
      ),
    ))
    .limit(1);
  return Boolean(event);
}

/**
 * Filter before LIMIT so deferred rows cannot starve due or newly-evidenced work.
 */
export function missionReplanBackoffCandidateCondition() {
  const policy = aiMissionsTable.autonomyPolicy;
  const backoff = sql`${policy}->'automaticReplanBackoff'`;
  const nextAttemptAt = sql`${policy}->'automaticReplanBackoff'->>'nextAttemptAt'`;
  const lastAttemptAt = sql`
    CASE
      WHEN (${policy}->'automaticReplanBackoff'->>'lastAttemptAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
      THEN (${policy}->'automaticReplanBackoff'->>'lastAttemptAt')::timestamptz
      ELSE '-infinity'::timestamptz
    END
  `;

  return sql`(
    ${backoff} IS NULL
    OR ${backoff}->>'schemaVersion' IS DISTINCT FROM '1'
    OR ${backoff}->>'attemptCount' !~ '^[1-9][0-9]*$'
    OR ${policy}->'automaticReplanBackoff'->>'lastAttemptAt' IS NULL
    OR (${policy}->'automaticReplanBackoff'->>'lastAttemptAt') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
    OR ${nextAttemptAt} IS NULL
    OR ${nextAttemptAt} !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
    OR (CASE
      WHEN ${nextAttemptAt} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
      THEN ${nextAttemptAt}::timestamptz
      ELSE '-infinity'::timestamptz
    END) <= clock_timestamp()
    OR (
      EXISTS (
        SELECT 1
        FROM ai_goals AS failed_goal
        WHERE failed_goal.mission_id = ai_missions.id
          AND failed_goal.project_id = ai_missions.project_id
          AND failed_goal.status = 'needs_replan'
          AND (
            EXISTS (
              SELECT 1
              FROM ai_agent_episodes AS replan_episode
              INNER JOIN ai_agent_observations AS replan_observation
                ON replan_observation.episode_id = replan_episode.id
              WHERE replan_episode.mission_id = ai_missions.id
                AND replan_episode.project_id = ai_missions.project_id
                AND replan_episode.goal_id = failed_goal.id
                AND replan_observation.project_id = ai_missions.project_id
                AND replan_observation.created_at > ${lastAttemptAt}
                AND replan_observation.kind = 'direct_observation'
                AND replan_observation.provenance = 'DIRECT_OBSERVATION'
                AND replan_observation.completeness = 'complete'
                AND replan_observation.freshness = 'fresh'
            )
            OR EXISTS (
              SELECT 1
              FROM events AS replan_signal
              WHERE replan_signal.project_id = ai_missions.project_id
                AND replan_signal.timestamp > ${lastAttemptAt}
                AND (
                  (
                    replan_signal.goal_id = failed_goal.id
                    AND replan_signal.type IN (
                      'AiMissionExternalEventReceived',
                      'AiMissionWorldTransitionWakeRequested'
                    )
                  )
                  OR (
                    replan_signal.type = 'MissionGoalWakeDispatched'
                    AND replan_signal.payload->>'missionId' = ai_missions.id
                  )
                )
            )
          )
      )
    )
  )`;
}
