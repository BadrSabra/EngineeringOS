import { randomUUID } from "node:crypto";
import { and, asc, desc, eq } from "drizzle-orm";
import {
  aiAgentEpisodeEventsTable,
  aiAgentEpisodesTable,
  aiExecutionsTable,
  db,
  eventsTable,
} from "@workspace/db";
import {
  AgentEpisodeSchema,
  AgentEpisodeEventSchema,
  type AgentEpisode,
  type AgentEpisodeEvent,
  type EpisodeEventType,
  type EpisodeState,
  type EpisodeVerdict,
  canonicalJsonHash,
  parseBoundedJson,
  toPublicAgentEpisode,
  type JsonValue,
} from "@workspace/ai-orchestrator";
import { logger } from "../logger.js";
import {
  recordAgentEpisodeShadowFailure,
  recordAgentEpisodeShadowStart,
  recordAgentEpisodeShadowSuccess,
} from "../operational-counters.js";
import { persistAgentEpisodeShadowAttempt } from "./agent-episode-shadow-campaign.js";

type LedgerTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type EpisodeLedgerErrorCode =
  | "not_found"
  | "ownership_mismatch"
  | "attempt_mismatch"
  | "stale_worker"
  | "invalid_transition"
  | "sequence_conflict"
  | "terminal_immutable"
  | "invalid_contract";

export class EpisodeLedgerError extends Error {
  readonly code: EpisodeLedgerErrorCode;

  constructor(code: EpisodeLedgerErrorCode, message: string) {
    super(message);
    this.name = "EpisodeLedgerError";
    this.code = code;
  }
}

export type StartEpisodeInput = {
  projectId: string;
  executionId: string;
  attempt: number;
  workerId: string;
  idempotencyKey: string;
  projectRevision: string;
  intentKind: string;
  scope: JsonValue;
  missionId?: string;
  goalId?: string;
  parentEpisodeId?: string;
  worldRevision?: string;
  beliefRevision?: string;
  planRevision?: string;
  objectiveContractId?: string;
};

export type AppendEpisodeEventInput = {
  episodeId: string;
  projectId: string;
  executionId: string;
  attempt: number;
  workerId: string;
  eventType: EpisodeEventType;
  payload: JsonValue;
  actorType?: "server" | "worker" | "user" | "system";
  actorId?: string;
  correlationId?: string;
  observationRefs?: string[];
  actionRefs?: string[];
  expectedEffectRefs?: string[];
  observedEffectRefs?: string[];
  evidenceRefs?: string[];
};

export type CloseEpisodeInput = AppendEpisodeEventInput & {
  verdict: EpisodeVerdict;
  reasonCode?: string;
  nextActionCode?: string;
};

export type EpisodeOwner = {
  userId: string;
  projectId: string;
  episodeId: string;
};

export type ReplayEpisodeResult = {
  episode: AgentEpisode;
  events: AgentEpisodeEvent[];
};

const TERMINAL_STATES = new Set<EpisodeState>([
  "completed",
  "blocked",
  "failed",
  "cancelled",
]);

const ACTIVE_EXECUTION_STATUSES = new Set([
  "queued",
  "running",
  "paused",
  "cancelling",
]);

const EVENT_STATE: Partial<Record<EpisodeEventType, EpisodeState>> = {
  EPISODE_PAUSED: "paused",
  EPISODE_RESUMED: "running",
  EFFECT_PENDING: "effect_pending",
  REPLAN_REQUESTED: "needs_replan",
  EPISODE_CANCELLED: "cancelled",
};

function ledgerError(code: EpisodeLedgerErrorCode, message: string): never {
  throw new EpisodeLedgerError(code, message);
}

function asIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function episodeToContract(row: typeof aiAgentEpisodesTable.$inferSelect): AgentEpisode {
  return AgentEpisodeSchema.parse({
    schemaVersion: "1",
    episodeId: row.id,
    projectId: row.projectId,
    executionId: row.executionId,
    attempt: row.attempt,
    ...(row.missionId ? { missionId: row.missionId } : {}),
    ...(row.goalId ? { goalId: row.goalId } : {}),
    ...(row.parentEpisodeId ? { parentEpisodeId: row.parentEpisodeId } : {}),
    projectRevision: row.projectRevision,
    ...(row.worldRevision ? { worldRevision: row.worldRevision } : {}),
    ...(row.beliefRevision ? { beliefRevision: row.beliefRevision } : {}),
    ...(row.planRevision ? { planRevision: row.planRevision } : {}),
    intentKind: row.intentKind,
    scope: row.scope,
    ...(row.objectiveContractId ? { objectiveContractId: row.objectiveContractId } : {}),
    observationRefs: row.observationRefs,
    actionRefs: row.actionRefs,
    expectedEffectRefs: row.expectedEffectRefs,
    observedEffectRefs: row.observedEffectRefs,
    evidenceRefs: row.evidenceRefs,
    state: row.state,
    ...(row.verdict ? { verdict: row.verdict } : {}),
    ...(row.reasonCode ? { reasonCode: row.reasonCode } : {}),
    ...(row.nextActionCode ? { nextActionCode: row.nextActionCode } : {}),
    createdAt: asIso(row.createdAt),
    updatedAt: asIso(row.updatedAt),
    ...(row.closedAt ? { closedAt: asIso(row.closedAt) } : {}),
  });
}

function eventToContract(row: typeof aiAgentEpisodeEventsTable.$inferSelect): AgentEpisodeEvent {
  return AgentEpisodeEventSchema.parse({
    schemaVersion: "1",
    eventId: row.id,
    episodeId: row.episodeId,
    projectId: row.projectId,
    executionId: row.executionId,
    attempt: row.attempt,
    sequence: row.sequence,
    eventType: row.eventType,
    payload: row.payload,
    actorType: row.actorType,
    ...(row.actorId ? { actorId: row.actorId } : {}),
    ...(row.correlationId ? { correlationId: row.correlationId } : {}),
    createdAt: asIso(row.createdAt),
  });
}

function verifyExecutionOwnership(
  execution: typeof aiExecutionsTable.$inferSelect | undefined,
  input: Pick<AppendEpisodeEventInput, "projectId" | "executionId" | "attempt" | "workerId">,
): void {
  if (!execution) ledgerError("not_found", "execution not found");
  if (execution!.projectId !== input.projectId) {
    ledgerError("ownership_mismatch", "execution project does not match episode project");
  }
  if (execution!.attempt !== input.attempt) {
    ledgerError("attempt_mismatch", "execution attempt does not match episode attempt");
  }
  if (execution!.workerId !== input.workerId || !execution!.leaseUntil || execution!.leaseUntil <= new Date()) {
    ledgerError("stale_worker", "worker does not own a live execution lease");
  }
  if (!ACTIVE_EXECUTION_STATUSES.has(execution!.status)) {
    ledgerError("stale_worker", "execution is no longer writable");
  }
}

async function lockExecution(
  tx: LedgerTransaction,
  input: Pick<AppendEpisodeEventInput, "projectId" | "executionId" | "attempt" | "workerId">,
) {
  const [execution] = await tx
    .select()
    .from(aiExecutionsTable)
    .where(and(eq(aiExecutionsTable.id, input.executionId), eq(aiExecutionsTable.projectId, input.projectId)))
    .for("update");
  verifyExecutionOwnership(execution, input);
  return execution!;
}

async function lockEpisode(tx: LedgerTransaction, episodeId: string) {
  const [episode] = await tx
    .select()
    .from(aiAgentEpisodesTable)
    .where(eq(aiAgentEpisodesTable.id, episodeId))
    .for("update");
  if (!episode) ledgerError("not_found", "episode not found");
  return episode!;
}

function appendUnique(current: unknown, additions: readonly string[] | undefined): string[] {
  const values = Array.isArray(current) ? current.filter((value): value is string => typeof value === "string") : [];
  return [...new Set([...values, ...(additions ?? [])])];
}

function nextStateForEvent(current: EpisodeState, eventType: EpisodeEventType): EpisodeState {
  if (EVENT_STATE[eventType]) {
    const next = EVENT_STATE[eventType]!;
    if (eventType === "EPISODE_RESUMED" && current !== "paused") {
      ledgerError("invalid_transition", "only paused episodes can resume");
    }
    if (eventType === "EPISODE_PAUSED" && !["running", "verifying", "effect_pending"].includes(current)) {
      ledgerError("invalid_transition", "episode cannot pause from its current state");
    }
    if (eventType === "EFFECT_PENDING" && !["running", "verifying"].includes(current)) {
      ledgerError("invalid_transition", "episode cannot await an effect from its current state");
    }
    return next;
  }
  return current;
}

async function appendLocked(
  tx: LedgerTransaction,
  input: AppendEpisodeEventInput,
  execution: typeof aiExecutionsTable.$inferSelect,
  episode: typeof aiAgentEpisodesTable.$inferSelect,
): Promise<AgentEpisodeEvent> {
  if (episode.projectId !== input.projectId || episode.executionId !== input.executionId) {
    ledgerError("ownership_mismatch", "episode identity does not match the requested execution");
  }
  if (episode.attempt !== input.attempt) ledgerError("attempt_mismatch", "episode attempt mismatch");
  if (TERMINAL_STATES.has(episode.state) || episode.closedAt) {
    const hash = canonicalJsonHash(input.payload);
    const [existing] = await tx.select().from(aiAgentEpisodeEventsTable).where(and(
      eq(aiAgentEpisodeEventsTable.episodeId, episode.id),
      eq(aiAgentEpisodeEventsTable.eventType, input.eventType),
      eq(aiAgentEpisodeEventsTable.payloadHash, hash),
    )).limit(1);
    if (existing) return eventToContract(existing);
    ledgerError("terminal_immutable", "terminal episode cannot accept new events");
  }

  const payload = parseBoundedJson(input.payload, 32 * 1024);
  const payloadHash = canonicalJsonHash(payload);
  const [existing] = await tx.select().from(aiAgentEpisodeEventsTable).where(and(
    eq(aiAgentEpisodeEventsTable.episodeId, episode.id),
    eq(aiAgentEpisodeEventsTable.eventType, input.eventType),
    eq(aiAgentEpisodeEventsTable.payloadHash, payloadHash),
  )).limit(1);
  if (existing) return eventToContract(existing);

  const [last] = await tx
    .select({ sequence: aiAgentEpisodeEventsTable.sequence })
    .from(aiAgentEpisodeEventsTable)
    .where(eq(aiAgentEpisodeEventsTable.episodeId, episode.id))
    .orderBy(desc(aiAgentEpisodeEventsTable.sequence))
    .limit(1);
  const sequence = last ? last.sequence + 1 : 0;
  const currentState = episode.state as EpisodeState;
  const nextState = nextStateForEvent(currentState, input.eventType);
  const now = new Date();

  const [inserted] = await tx.insert(aiAgentEpisodeEventsTable).values({
    id: randomUUID(),
    episodeId: episode.id,
    projectId: input.projectId,
    executionId: input.executionId,
    attempt: input.attempt,
    sequence,
    eventType: input.eventType,
    payload,
    payloadHash,
    actorType: input.actorType ?? "worker",
    actorId: input.actorId,
    correlationId: input.correlationId,
    createdAt: now,
  }).returning();

  await tx.insert(eventsTable).values({
    id: randomUUID(),
    type: "AiAgentEpisodeEvent",
    projectId: input.projectId,
    ...(episode.goalId ? { goalId: episode.goalId } : {}),
    payload: {
      episodeId: episode.id,
      executionId: input.executionId,
      attempt: input.attempt,
      sequence,
      eventType: input.eventType,
    },
    severity: input.eventType === "EPISODE_CANCELLED" ? "warning" : "info",
    message: "AI agent episode event recorded.",
    correlationId: input.correlationId ?? input.executionId,
    timestamp: now,
  });

  await tx.update(aiAgentEpisodesTable).set({
    state: nextState,
    observationRefs: appendUnique(episode.observationRefs, input.observationRefs),
    actionRefs: appendUnique(episode.actionRefs, input.actionRefs),
    expectedEffectRefs: appendUnique(episode.expectedEffectRefs, input.expectedEffectRefs),
    observedEffectRefs: appendUnique(episode.observedEffectRefs, input.observedEffectRefs),
    evidenceRefs: appendUnique(episode.evidenceRefs, input.evidenceRefs),
    updatedAt: now,
  }).where(eq(aiAgentEpisodesTable.id, episode.id));

  return eventToContract(inserted!);
}

export async function startEpisode(input: StartEpisodeInput): Promise<AgentEpisode> {
  return db.transaction(async (tx) => {
    const execution = await lockExecution(tx, input);
    const [existing] = await tx.select().from(aiAgentEpisodesTable).where(and(
      eq(aiAgentEpisodesTable.executionId, input.executionId),
      eq(aiAgentEpisodesTable.attempt, input.attempt),
    )).for("update");
    if (existing) {
      if (existing.idempotencyKey !== input.idempotencyKey) {
        ledgerError("invalid_contract", "episode idempotency key conflicts with existing episode");
      }
      return episodeToContract(existing);
    }

    const scope = parseBoundedJson(input.scope, 16 * 1024);
    const now = new Date();
    const [inserted] = await tx.insert(aiAgentEpisodesTable).values({
      id: randomUUID(),
      projectId: input.projectId,
      executionId: input.executionId,
      attempt: input.attempt,
      missionId: input.missionId,
      goalId: input.goalId,
      parentEpisodeId: input.parentEpisodeId,
      projectRevision: input.projectRevision,
      worldRevision: input.worldRevision,
      beliefRevision: input.beliefRevision,
      planRevision: input.planRevision,
      intentKind: input.intentKind,
      scope,
      objectiveContractId: input.objectiveContractId,
      workerId: input.workerId,
      leaseUntil: execution.leaseUntil!,
      idempotencyKey: input.idempotencyKey,
      state: "running",
      createdAt: now,
      updatedAt: now,
    }).returning();

    await appendLocked(tx, {
      episodeId: inserted!.id,
      projectId: input.projectId,
      executionId: input.executionId,
      attempt: input.attempt,
      workerId: input.workerId,
      eventType: "EPISODE_CREATED",
      payload: { intentKind: input.intentKind, projectRevision: input.projectRevision },
      actorType: "worker",
    }, execution, inserted!);
    const [updated] = await tx.select().from(aiAgentEpisodesTable).where(eq(aiAgentEpisodesTable.id, inserted!.id));
    return episodeToContract(updated!);
  });
}

/**
 * P1 shadow integration deliberately cannot affect the owning execution.
 * Failures are retained in server logs while the existing execution/acceptance
 * path remains authoritative.
 */
export function startEpisodeShadow(input: StartEpisodeInput): void {
  const startedAt = Date.now();
  recordAgentEpisodeShadowStart();
  void startEpisode(input)
    .then(() => {
      const latencyMs = Date.now() - startedAt;
      recordAgentEpisodeShadowSuccess(latencyMs);
      void persistAgentEpisodeShadowAttempt({
        projectId: input.projectId,
        executionId: input.executionId,
        attempt: input.attempt,
        idempotencyKey: input.idempotencyKey,
        outcome: "success",
        latencyMs,
      }).catch((error: unknown) => {
        logger.warn(
          { scope: "agent-episode-ledger", code: "shadow_campaign_persist_failed", error },
          "Shadow campaign telemetry persistence failed; execution path remains authoritative",
        );
      });
    })
    .catch((error: unknown) => {
      const code = error instanceof EpisodeLedgerError ? error.code : "shadow_write_failed";
      const latencyMs = Date.now() - startedAt;
      recordAgentEpisodeShadowFailure(code);
      void persistAgentEpisodeShadowAttempt({
        projectId: input.projectId,
        executionId: input.executionId,
        attempt: input.attempt,
        idempotencyKey: input.idempotencyKey,
        outcome: "failure",
        failureCode: code,
        latencyMs,
      }).catch((telemetryError: unknown) => {
        logger.warn(
          { scope: "agent-episode-ledger", code: "shadow_campaign_persist_failed", error: telemetryError },
          "Shadow campaign telemetry persistence failed; execution path remains authoritative",
        );
      });
      logger.warn(
        {
          scope: "agent-episode-ledger",
          code,
          executionId: input.executionId,
          attempt: input.attempt,
        },
        "Shadow episode write failed; existing execution path remains authoritative",
      );
    });
}

export async function appendEpisodeEvent(input: AppendEpisodeEventInput): Promise<AgentEpisodeEvent> {
  return db.transaction(async (tx) => {
    const execution = await lockExecution(tx, input);
    const episode = await lockEpisode(tx, input.episodeId);
    return appendLocked(tx, input, execution, episode);
  });
}

export async function loadEpisodeForOwner(owner: EpisodeOwner): Promise<AgentEpisode> {
  const [row] = await db
    .select({ episode: aiAgentEpisodesTable })
    .from(aiAgentEpisodesTable)
    .innerJoin(aiExecutionsTable, eq(aiExecutionsTable.id, aiAgentEpisodesTable.executionId))
    .where(and(
      eq(aiAgentEpisodesTable.id, owner.episodeId),
      eq(aiAgentEpisodesTable.projectId, owner.projectId),
      eq(aiExecutionsTable.projectId, owner.projectId),
      eq(aiExecutionsTable.userId, owner.userId),
    ))
    .limit(1);
  if (!row) ledgerError("not_found", "episode is not owned by this user and project");
  return episodeToContract(row!.episode);
}

export async function closeEpisode(input: CloseEpisodeInput): Promise<AgentEpisode> {
  return db.transaction(async (tx) => {
    const execution = await lockExecution(tx, input);
    const episode = await lockEpisode(tx, input.episodeId);
    if (episode.closedAt || TERMINAL_STATES.has(episode.state)) {
      if (episode.verdict === input.verdict) return episodeToContract(episode);
      ledgerError("terminal_immutable", "episode terminal outcome is immutable");
    }
    const eventType: EpisodeEventType = input.verdict === "cancelled" ? "EPISODE_CANCELLED" : "EPISODE_TERMINAL";
    await appendLocked(tx, { ...input, eventType }, execution, episode);
    const now = new Date();
    await tx.update(aiAgentEpisodesTable).set({
      state: input.verdict === "cancelled" ? "cancelled" : "completed",
      verdict: input.verdict,
      reasonCode: input.reasonCode,
      nextActionCode: input.nextActionCode,
      closedAt: now,
      updatedAt: now,
    }).where(eq(aiAgentEpisodesTable.id, input.episodeId));
    const [closed] = await tx.select().from(aiAgentEpisodesTable).where(eq(aiAgentEpisodesTable.id, input.episodeId));
    return episodeToContract(closed!);
  });
}

export async function replayEpisode(owner: EpisodeOwner): Promise<ReplayEpisodeResult> {
  const episode = await loadEpisodeForOwner(owner);
  const rows = await db
    .select()
    .from(aiAgentEpisodeEventsTable)
    .where(eq(aiAgentEpisodeEventsTable.episodeId, episode.episodeId))
    .orderBy(asc(aiAgentEpisodeEventsTable.sequence));
  for (const [index, row] of rows.entries()) {
    if (
      row.projectId !== episode.projectId
      || row.executionId !== episode.executionId
      || row.attempt !== episode.attempt
      || row.sequence !== index
    ) {
      ledgerError("invalid_contract", "episode event stream is not contiguous or identity-bound");
    }
  }
  return {
    episode,
    events: rows.map(eventToContract),
  };
}

export function publicEpisodeProjection(episode: AgentEpisode) {
  return toPublicAgentEpisode(episode);
}