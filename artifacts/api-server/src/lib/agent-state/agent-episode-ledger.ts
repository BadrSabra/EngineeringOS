import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gt, isNull, sql } from "drizzle-orm";
import {
  aiAgentObservationsTable,
  aiAgentEpisodeEventsTable,
  aiAgentEpisodesTable,
  aiExecutionsTable,
  aiGoalsTable,
  aiMissionsTable,
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
  parseAgentAction,
  parseAgentActionRequestedPayload,
  parseBoundedJson,
  toPublicAgentEpisode,
  type JsonValue,
} from "@workspace/ai-orchestrator";
import { logger } from "../logger.js";
import {
  captureEnvironmentAttestation,
  serverEnvironmentProfile,
} from "./environment-attestation.js";
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
  /** Server-resolved root used only to capture a bounded environment attestation. */
  environmentRootPath?: string;
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
export { createToolInvocationEpisodeEventInput } from "./tool-invocation-episode-event.js";

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
    ...(row.environmentRevision ? { environmentRevision: row.environmentRevision } : {}),
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

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

async function persistRequestedActionReferences(
  tx: LedgerTransaction,
  episode: typeof aiAgentEpisodesTable.$inferSelect,
  input: AppendEpisodeEventInput,
  action: ReturnType<typeof parseAgentActionRequestedPayload>["action"],
): Promise<void> {
  await tx.update(aiAgentEpisodesTable).set({
    actionRefs: appendUnique(episode.actionRefs, [
      ...(input.actionRefs ?? []),
      action.actionId,
    ]),
    expectedEffectRefs: appendUnique(episode.expectedEffectRefs, [
      ...(input.expectedEffectRefs ?? []),
      ...action.expectedEffects,
    ]),
    updatedAt: new Date(),
  }).where(eq(aiAgentEpisodesTable.id, episode.id));
}

function missionRepairAggregateCommitActionId(
  input: AppendEpisodeEventInput,
  payload: unknown,
): string | undefined {
  if (input.eventType !== "ACTION_COMMITTED") return undefined;
  const actionId = asRecord(payload)?.actionId;
  if (typeof actionId !== "string" || !actionId.startsWith("mission-repair:")) {
    return undefined;
  }
  const expectedActionId = `mission-repair:${input.executionId}:${input.attempt}`;
  if (actionId !== expectedActionId) {
    ledgerError("invalid_contract", "Mission repair aggregate commit action identity does not match its execution attempt.");
  }
  return actionId;
}

function missionRepairToolCommitActionId(
  input: AppendEpisodeEventInput,
  payload: unknown,
): string | undefined {
  if (input.eventType !== "ACTION_COMMITTED") return undefined;
  const record = asRecord(payload);
  if (!record) return undefined;
  const actionId = record.actionId;
  if (typeof actionId !== "string" || !actionId.startsWith("mission-repair-tool:")) {
    return undefined;
  }

  const actionPrefix = `mission-repair-tool:${input.executionId}:${input.attempt}:`;
  const toolCallIdentity = record.toolCallIdentity;
  if (
    !actionId.startsWith(actionPrefix)
    || !/^[a-f0-9]{32}$/.test(actionId.slice(actionPrefix.length))
    || typeof toolCallIdentity !== "string"
    || !/^[a-f0-9]{64}$/.test(toolCallIdentity)
    || actionId !== `${actionPrefix}${toolCallIdentity.slice(0, 32)}`
    || !["write_file", "replace_text"].includes(String(record.toolName))
    || typeof record.targetPath !== "string"
    || !record.targetPath.trim()
    || typeof record.inputHash !== "string"
    || !/^[a-f0-9]{64}$/.test(record.inputHash)
    || record.stagedInCandidateOverlay !== true
    || record.liveWorkspaceWrites !== false
  ) {
    ledgerError("invalid_contract", "Mission repair tool commit identity or staging contract is invalid.");
  }
  return actionId;
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
  let requestedAction: ReturnType<typeof parseAgentActionRequestedPayload>["action"] | undefined;
  if (input.eventType === "ACTION_REQUESTED") {
    try {
      requestedAction = parseAgentActionRequestedPayload(payload).action;
    } catch {
      ledgerError("invalid_contract", "ACTION_REQUESTED requires a valid canonical AgentAction.");
    }
    if (requestedAction?.episodeId !== episode.id) {
      ledgerError("invalid_contract", "ACTION_REQUESTED action does not belong to this episode.");
    }
  }
  const payloadHash = canonicalJsonHash(payload);
  const aggregateMissionRepairActionId = missionRepairAggregateCommitActionId(input, payload);
  if (aggregateMissionRepairActionId) {
    const priorCommits = await tx.select().from(aiAgentEpisodeEventsTable).where(and(
      eq(aiAgentEpisodeEventsTable.episodeId, episode.id),
      eq(aiAgentEpisodeEventsTable.eventType, "ACTION_COMMITTED"),
    )).orderBy(asc(aiAgentEpisodeEventsTable.sequence));
    const sameActionCommits = priorCommits.filter((row) =>
      asRecord(row.payload)?.actionId === aggregateMissionRepairActionId
    );
    if (sameActionCommits.length > 0) {
      const priorHashes = new Set(sameActionCommits.map((row) => row.payloadHash));
      if (priorHashes.size !== 1 || !priorHashes.has(payloadHash)) {
        ledgerError("invalid_contract", "Mission repair aggregate commit action identity was reused with different semantics.");
      }
      return eventToContract(sameActionCommits[0]!);
    }
  }
  const toolMissionRepairActionId = missionRepairToolCommitActionId(input, payload);
  if (toolMissionRepairActionId) {
    const priorCommits = await tx.select().from(aiAgentEpisodeEventsTable).where(and(
      eq(aiAgentEpisodeEventsTable.episodeId, episode.id),
      eq(aiAgentEpisodeEventsTable.eventType, "ACTION_COMMITTED"),
    )).orderBy(asc(aiAgentEpisodeEventsTable.sequence));
    const sameActionCommits = priorCommits.filter((row) =>
      asRecord(row.payload)?.actionId === toolMissionRepairActionId
    );
    if (sameActionCommits.length > 0) {
      const priorHashes = new Set(sameActionCommits.map((row) => row.payloadHash));
      if (priorHashes.size !== 1 || !priorHashes.has(payloadHash)) {
        ledgerError("invalid_contract", "Mission repair tool action identity was reused with different semantics.");
      }
      return eventToContract(sameActionCommits[0]!);
    }
  }
  const [existing] = await tx.select().from(aiAgentEpisodeEventsTable).where(and(
    eq(aiAgentEpisodeEventsTable.episodeId, episode.id),
    eq(aiAgentEpisodeEventsTable.eventType, input.eventType),
    eq(aiAgentEpisodeEventsTable.payloadHash, payloadHash),
  )).limit(1);
  if (existing) {
    if (requestedAction) {
      await persistRequestedActionReferences(tx, episode, input, requestedAction);
    }
    return eventToContract(existing);
  }
  if (input.eventType === "ACTION_REQUESTED" && requestedAction) {
    const priorRequests = await tx.select().from(aiAgentEpisodeEventsTable).where(and(
      eq(aiAgentEpisodeEventsTable.episodeId, episode.id),
      eq(aiAgentEpisodeEventsTable.eventType, "ACTION_REQUESTED"),
    )).orderBy(asc(aiAgentEpisodeEventsTable.sequence));
    const priorRequest = priorRequests.find((row) => {
      const previousPayload = asRecord(row.payload);
      const previousAction = asRecord(previousPayload?.action);
      return previousAction?.actionId === requestedAction!.actionId
        || previousPayload?.actionId === requestedAction!.actionId;
    });
    if (priorRequest) {
      const previousPayload = asRecord(priorRequest.payload);
      const previousActionValue = previousPayload?.action;
      if (previousActionValue !== undefined) {
        let previousAction: ReturnType<typeof parseAgentAction>;
        try {
          previousAction = parseAgentAction(previousActionValue);
        } catch {
          ledgerError("invalid_contract", "Existing ACTION_REQUESTED action is malformed.");
        }
        if (canonicalJsonHash(previousAction!) !== canonicalJsonHash(requestedAction)) {
          ledgerError("invalid_contract", "ACTION_REQUESTED action identity was reused with different semantics.");
        }
      } else {
        const previousExpectedEffects = previousPayload?.expectedEffects;
        const currentPayload = asRecord(payload);
        if (
          previousPayload?.capabilityId !== requestedAction.capabilityId
          || !Array.isArray(previousExpectedEffects)
          || previousExpectedEffects.length !== requestedAction.expectedEffects.length
          || !previousExpectedEffects.every((effect, index) => effect === requestedAction!.expectedEffects[index])
          || (
            typeof previousPayload?.actionContractHash === "string"
            && previousPayload.actionContractHash !== currentPayload?.actionContractHash
          )
        ) {
          ledgerError("invalid_contract", "Legacy ACTION_REQUESTED identity conflicts with the canonical action.");
        }
      }
      await persistRequestedActionReferences(tx, episode, input, requestedAction);
      return eventToContract(priorRequest);
    }
  }

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
    actionRefs: appendUnique(episode.actionRefs, [
      ...(input.actionRefs ?? []),
      ...(requestedAction ? [requestedAction.actionId] : []),
    ]),
    expectedEffectRefs: appendUnique(episode.expectedEffectRefs, [
      ...(input.expectedEffectRefs ?? []),
      ...(requestedAction?.expectedEffects ?? []),
    ]),
    observedEffectRefs: appendUnique(episode.observedEffectRefs, input.observedEffectRefs),
    evidenceRefs: appendUnique(episode.evidenceRefs, input.evidenceRefs),
    updatedAt: now,
  }).where(eq(aiAgentEpisodesTable.id, episode.id));

  return eventToContract(inserted!);
}

async function appendHistoricalP75TerminalEventLocked(
  tx: LedgerTransaction,
  episode: typeof aiAgentEpisodesTable.$inferSelect,
  input: Pick<AppendEpisodeEventInput, "projectId" | "executionId" | "workerId">,
  payloadValue: JsonValue,
  now: Date,
): Promise<void> {
  const payload = parseBoundedJson(payloadValue, 32 * 1024);
  const payloadHash = canonicalJsonHash(payload);
  const [last] = await tx
    .select({ sequence: aiAgentEpisodeEventsTable.sequence })
    .from(aiAgentEpisodeEventsTable)
    .where(eq(aiAgentEpisodeEventsTable.episodeId, episode.id))
    .orderBy(desc(aiAgentEpisodeEventsTable.sequence))
    .limit(1);
  const sequence = last ? last.sequence + 1 : 0;

  await tx.insert(aiAgentEpisodeEventsTable).values({
    id: randomUUID(),
    episodeId: episode.id,
    projectId: input.projectId,
    executionId: input.executionId,
    attempt: episode.attempt,
    sequence,
    eventType: "EPISODE_TERMINAL",
    payload,
    payloadHash,
    actorType: "worker",
    actorId: input.workerId,
    correlationId: input.executionId,
    createdAt: now,
  });
  await tx.insert(eventsTable).values({
    id: randomUUID(),
    type: "AiAgentEpisodeEvent",
    projectId: input.projectId,
    ...(episode.goalId ? { goalId: episode.goalId } : {}),
    payload: {
      episodeId: episode.id,
      executionId: input.executionId,
      attempt: episode.attempt,
      sequence,
      eventType: "EPISODE_TERMINAL",
    },
    severity: "info",
    message: "AI agent episode event recorded.",
    correlationId: input.executionId,
    timestamp: now,
  });
}

type P75TerminalizationContext = {
  projectId: string;
  executionId: string;
  attempt: number;
  workerId: string;
  missionId: string;
  goalId: string;
  planRevision: string;
  projectRevision: string;
  sourceExperimentId: string;
  continuationId?: string;
  resultId?: string;
  measurementValidity?: string;
  resultOwnerEpisodeId?: string;
  resultOwnerAttempt?: number;
  reasonCode: string;
};

async function terminalizeRelatedP75Episode(
  tx: LedgerTransaction,
  episode: typeof aiAgentEpisodesTable.$inferSelect,
  input: P75TerminalizationContext,
  recoveredByEpisodeId: string,
  relation: "source_registration" | "prior_observation",
  now: Date,
): Promise<void> {
  const mismatches = [
    ...(episode.projectId !== input.projectId ? ["project"] : []),
    ...(episode.executionId !== input.executionId ? ["execution"] : []),
    ...(episode.missionId !== input.missionId ? ["mission"] : []),
    ...(episode.goalId !== input.goalId ? ["goal"] : []),
    ...(episode.planRevision !== input.planRevision ? ["plan_revision"] : []),
    ...(episode.projectRevision !== input.projectRevision ? ["project_revision"] : []),
  ];
  if (mismatches.length > 0) {
    ledgerError(
      "ownership_mismatch",
      `P7.5 related Episode identity or scope changed: ${mismatches.join(",")}`,
    );
  }
  if (episode.closedAt || TERMINAL_STATES.has(episode.state)) return;

  const payload: JsonValue = {
    verdict: "replan_required",
    reasonCode: input.reasonCode,
    sourceExperimentId: input.sourceExperimentId,
    continuationId: input.continuationId ?? null,
    resultId: input.resultId ?? null,
    measurementValidity: input.measurementValidity ?? null,
    resultOwnerEpisodeId: input.resultOwnerEpisodeId ?? null,
    resultOwnerAttempt: input.resultOwnerAttempt ?? null,
    recoveredByEpisodeId,
    recoveredByAttempt: input.attempt,
    relatedEpisodeRole: relation,
  };
  await appendHistoricalP75TerminalEventLocked(tx, episode, input, payload, now);
  await tx.update(aiAgentEpisodesTable).set({
    state: "completed",
    verdict: "replan_required",
    reasonCode: input.reasonCode,
    nextActionCode: "MISSION_REPLAN",
    closedAt: now,
    updatedAt: now,
  }).where(eq(aiAgentEpisodesTable.id, episode.id));
}

export async function startEpisode(input: StartEpisodeInput): Promise<AgentEpisode> {
  let environmentRevision: string | undefined;
  if (input.environmentRootPath) {
    const profile = serverEnvironmentProfile(input.intentKind, input.scope);
    try {
      const attestation = await captureEnvironmentAttestation({
        rootPath: input.environmentRootPath,
        profile,
      });
      if (attestation.status === "known") {
        environmentRevision = attestation.environmentRevision;
      } else if (attestation.reason !== "unsupported_profile") {
        logger.debug(
          { projectId: input.projectId, reason: attestation.reason },
          "Episode environment attestation is unknown",
        );
      }
    } catch (error) {
      logger.warn(
        { projectId: input.projectId, error },
        "Episode environment attestation failed",
      );
    }
  }
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
      environmentRevision,
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
  void startEpisodeShadowWithEpisode(input);
}

/**
 * Best-effort shadow start for callers that need the episode identity for
 * advisory telemetry. A failed Episode write must never take ownership from
 * the existing execution or acceptance path.
 */
export async function startEpisodeShadowWithEpisode(
  input: StartEpisodeInput,
): Promise<AgentEpisode | undefined> {
  const startedAt = Date.now();
  recordAgentEpisodeShadowStart();
  try {
    const episode = await startEpisode(input);
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
    return episode;
  } catch (error) {
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
    return undefined;
  }
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

/**
 * Atomically close an advisory P7.5 continuation Episode and complete the
 * execution's control-plane lease. Keeping both writes under the execution-row
 * lock lets cancellation or lease rotation win cleanly instead of leaving a
 * replan Episode attached to an execution that was cancelled in between writes.
 */
export async function terminalizeP75MeasurementContinuationEpisode(input: P75TerminalizationContext & {
  episodeId: string;
  userId: string;
  operationId: string;
  sourceEpisodeId?: string;
  sourceAttempt?: number;
  observationOwnerEpisodeId?: string;
  observationOwnerAttempt?: number;
  observationContinuationId?: string;
  observationId?: string;
}): Promise<AgentEpisode> {
  return db.transaction(async (tx) => {
    const [mission] = await tx.select().from(aiMissionsTable).where(and(
      eq(aiMissionsTable.id, input.missionId),
      eq(aiMissionsTable.projectId, input.projectId),
    )).for("update");
    const [goal] = await tx.select().from(aiGoalsTable).where(and(
      eq(aiGoalsTable.id, input.goalId),
      eq(aiGoalsTable.missionId, input.missionId),
      eq(aiGoalsTable.projectId, input.projectId),
    )).for("update");
    if (!mission || !goal) {
      ledgerError("ownership_mismatch", "P7.5 continuation Mission or Goal identity changed");
    }
    const execution = await lockExecution(tx, input);
    if (
      execution.status !== "running"
      || execution.cancelRequestedAt
      || execution.userId !== input.userId
      || execution.operationId !== input.operationId
      || execution.goalId !== input.goalId
      || execution.recipeReceipt !== null
    ) {
      ledgerError("stale_worker", "P7.5 continuation no longer owns an uncancelled Mission execution");
    }
    const episode = await lockEpisode(tx, input.episodeId);
    const episodeMismatchFields = [
      ...(episode.projectId !== input.projectId ? ["project"] : []),
      ...(episode.executionId !== input.executionId ? ["execution"] : []),
      ...(episode.attempt !== input.attempt ? ["attempt"] : []),
      ...(episode.missionId !== input.missionId ? ["mission"] : []),
      ...(episode.goalId !== input.goalId ? ["goal"] : []),
      ...(episode.planRevision !== input.planRevision ? ["plan_revision"] : []),
      ...(episode.projectRevision !== input.projectRevision ? ["project_revision"] : []),
    ];
    if (episodeMismatchFields.length > 0) {
      ledgerError(
        "ownership_mismatch",
        `P7.5 continuation Episode identity or scope changed: ${episodeMismatchFields.join(",")}`,
      );
    }
    if (episode.closedAt || TERMINAL_STATES.has(episode.state)) {
      ledgerError("terminal_immutable", "P7.5 continuation Episode is already terminal");
    }

    const hasSourceEpisodeId = input.sourceEpisodeId !== undefined;
    const hasSourceAttempt = input.sourceAttempt !== undefined;
    if (hasSourceEpisodeId !== hasSourceAttempt) {
      ledgerError("invalid_contract", "P7.5 source Episode identity must include both Episode and attempt.");
    }
    let sourceEpisode: typeof aiAgentEpisodesTable.$inferSelect | undefined;
    if (hasSourceEpisodeId && input.sourceEpisodeId && input.sourceAttempt !== undefined) {
      if (input.sourceAttempt >= input.attempt) {
        ledgerError("ownership_mismatch", "P7.5 source registration must belong to an earlier execution attempt.");
      }
      sourceEpisode = await lockEpisode(tx, input.sourceEpisodeId);
      if (
        sourceEpisode.attempt !== input.sourceAttempt
        || sourceEpisode.projectId !== input.projectId
        || sourceEpisode.executionId !== input.executionId
        || sourceEpisode.missionId !== input.missionId
        || sourceEpisode.goalId !== input.goalId
        || sourceEpisode.planRevision !== input.planRevision
        || sourceEpisode.projectRevision !== input.projectRevision
      ) {
        ledgerError("ownership_mismatch", "P7.5 source registration Episode identity or scope changed.");
      }
      const registrationEvents = await tx.select().from(aiAgentEpisodeEventsTable).where(and(
        eq(aiAgentEpisodeEventsTable.episodeId, sourceEpisode.id),
        eq(aiAgentEpisodeEventsTable.projectId, input.projectId),
        eq(aiAgentEpisodeEventsTable.executionId, input.executionId),
        eq(aiAgentEpisodeEventsTable.attempt, input.sourceAttempt),
        eq(aiAgentEpisodeEventsTable.eventType, "OBSERVATION_REQUESTED"),
      ));
      const matchingRegistrations = registrationEvents.filter((event) => {
        const registration = asRecord(event.payload);
        return registration?.recordKind === "P75_HYPOTHESIS_EXPERIMENT_REGISTERED"
          && registration.experimentId === input.sourceExperimentId
          && registration.projectId === input.projectId
          && registration.executionId === input.executionId
          && registration.attempt === input.sourceAttempt
          && registration.episodeId === sourceEpisode!.id
          && registration.missionId === input.missionId
          && registration.goalId === input.goalId
          && registration.planRevision === input.planRevision
          && registration.projectRevision === input.projectRevision;
      });
      if (matchingRegistrations.length !== 1) {
        ledgerError("invalid_contract", "P7.5 source Episode does not contain one exact experiment registration.");
      }
    }

    const hasObservationEpisodeId = input.observationOwnerEpisodeId !== undefined;
    const hasObservationAttempt = input.observationOwnerAttempt !== undefined;
    const hasObservationContinuationId = input.observationContinuationId !== undefined;
    const hasObservationId = input.observationId !== undefined;
    if (
      hasObservationEpisodeId !== hasObservationAttempt
      || hasObservationEpisodeId !== hasObservationContinuationId
      || hasObservationEpisodeId !== hasObservationId
    ) {
      ledgerError(
        "invalid_contract",
        "P7.5 recovered observation owner requires an Episode, attempt, and observation identity.",
      );
    }
    let observationEpisode: typeof aiAgentEpisodesTable.$inferSelect | undefined;
    if (
      hasObservationEpisodeId
      && input.observationOwnerEpisodeId
      && input.observationOwnerAttempt !== undefined
      && input.observationContinuationId
      && input.observationId
    ) {
      if (input.observationOwnerAttempt >= input.attempt) {
        ledgerError("ownership_mismatch", "P7.5 recovered observation must belong to an earlier continuation attempt.");
      }
      observationEpisode = await lockEpisode(tx, input.observationOwnerEpisodeId);
      if (
        observationEpisode.attempt !== input.observationOwnerAttempt
        || observationEpisode.projectId !== input.projectId
        || observationEpisode.executionId !== input.executionId
        || observationEpisode.missionId !== input.missionId
        || observationEpisode.goalId !== input.goalId
        || observationEpisode.planRevision !== input.planRevision
        || observationEpisode.projectRevision !== input.projectRevision
      ) {
        ledgerError("ownership_mismatch", "P7.5 recovered observation Episode identity or scope changed.");
      }
      const requestEvents = await tx.select().from(aiAgentEpisodeEventsTable).where(and(
        eq(aiAgentEpisodeEventsTable.episodeId, observationEpisode.id),
        eq(aiAgentEpisodeEventsTable.projectId, input.projectId),
        eq(aiAgentEpisodeEventsTable.executionId, input.executionId),
        eq(aiAgentEpisodeEventsTable.attempt, input.observationOwnerAttempt),
        eq(aiAgentEpisodeEventsTable.eventType, "OBSERVATION_REQUESTED"),
      ));
      const matchingRequests = requestEvents.filter((event) => {
        const request = asRecord(event.payload);
        const measurement = asRecord(request?.measurement);
        return request?.recordKind === "P75_HYPOTHESIS_MEASUREMENT_CONTINUATION_REQUESTED"
          && request.continuationId === input.observationContinuationId
          && measurement?.projectId === input.projectId
          && measurement.executionId === input.executionId
          && measurement.episodeId === observationEpisode!.id
          && measurement.attempt === input.observationOwnerAttempt
          && measurement.missionId === input.missionId
          && measurement.goalId === input.goalId
          && measurement.planRevision === input.planRevision
          && measurement.projectRevision === input.projectRevision;
      });
      const [retainedObservation] = await tx.select().from(aiAgentObservationsTable).where(and(
        eq(aiAgentObservationsTable.id, input.observationId),
        eq(aiAgentObservationsTable.projectId, input.projectId),
        eq(aiAgentObservationsTable.executionId, input.executionId),
        eq(aiAgentObservationsTable.episodeId, observationEpisode.id),
        eq(aiAgentObservationsTable.sourceId, `${input.observationContinuationId}:runtime.status`),
        eq(aiAgentObservationsTable.predicate, "runtime.status"),
      ));
      if (matchingRequests.length !== 1 || !retainedObservation) {
        ledgerError(
          "invalid_contract",
          `P7.5 recovered observation owner lacks its exact request or retained observation (requests=${matchingRequests.length}, observation=${Boolean(retainedObservation)}, episode=${observationEpisode.id}, continuation=${input.observationContinuationId}, observationId=${input.observationId}).`,
        );
      }
    }

    const hasResultOwnerEpisodeId = input.resultOwnerEpisodeId !== undefined;
    const hasResultOwnerAttempt = input.resultOwnerAttempt !== undefined;
    const resultOwnerEpisodeIdInput = input.resultOwnerEpisodeId;
    const resultOwnerAttemptInput = input.resultOwnerAttempt;
    if (hasResultOwnerEpisodeId !== hasResultOwnerAttempt) {
      ledgerError("invalid_contract", "P7.5 continuation result owner identity must include both Episode and attempt.");
    }

    let resultOwnerEpisode = episode;
    if (resultOwnerEpisodeIdInput !== undefined && resultOwnerAttemptInput !== undefined) {
      if (
        !input.continuationId
        || !input.resultId
        || !input.measurementValidity
      ) {
        ledgerError("invalid_contract", "P7.5 continuation result owner requires a complete stored result identity.");
      }
      if (resultOwnerEpisodeIdInput === episode.id) {
        if (resultOwnerAttemptInput !== episode.attempt) {
          ledgerError("ownership_mismatch", "P7.5 result owner attempt does not match its Episode.");
        }
      } else {
        if (input.reasonCode !== "P75_CONTINUATION_RESULT_ALREADY_RECORDED") {
          ledgerError("invalid_contract", "Only a recovered stored P7.5 result can close a prior Episode.");
        }
        if (resultOwnerAttemptInput >= input.attempt) {
          ledgerError("ownership_mismatch", "P7.5 result owner must be from an earlier execution attempt.");
        }
        resultOwnerEpisode = await lockEpisode(tx, resultOwnerEpisodeIdInput);
        const resultOwnerMismatchFields = [
          ...(resultOwnerEpisode.projectId !== input.projectId ? ["project"] : []),
          ...(resultOwnerEpisode.executionId !== input.executionId ? ["execution"] : []),
          ...(resultOwnerEpisode.attempt !== input.resultOwnerAttempt ? ["attempt"] : []),
          ...(resultOwnerEpisode.missionId !== input.missionId ? ["mission"] : []),
          ...(resultOwnerEpisode.goalId !== input.goalId ? ["goal"] : []),
          ...(resultOwnerEpisode.planRevision !== input.planRevision ? ["plan_revision"] : []),
          ...(resultOwnerEpisode.projectRevision !== input.projectRevision ? ["project_revision"] : []),
        ];
        if (resultOwnerMismatchFields.length > 0) {
          ledgerError(
            "ownership_mismatch",
            `P7.5 result-owning Episode identity or scope changed: ${resultOwnerMismatchFields.join(",")}`,
          );
        }
      }

      const resultRows = await tx.select().from(aiAgentEpisodeEventsTable).where(and(
        eq(aiAgentEpisodeEventsTable.episodeId, resultOwnerEpisode.id),
        eq(aiAgentEpisodeEventsTable.projectId, input.projectId),
        eq(aiAgentEpisodeEventsTable.executionId, input.executionId),
        eq(aiAgentEpisodeEventsTable.attempt, resultOwnerEpisode.attempt),
        eq(aiAgentEpisodeEventsTable.eventType, "OBSERVATION_RECORDED"),
      ));
      const matchingResults = resultRows.filter((row) => {
        const result = asRecord(row.payload);
        const measurement = asRecord(result?.measurement);
        return result?.recordKind === "P75_HYPOTHESIS_MEASUREMENT_CONTINUATION_RESULT"
          && result.sourceExperimentId === input.sourceExperimentId
          && result.continuationId === input.continuationId
          && result.resultId === input.resultId
          && result.measurementValidity === input.measurementValidity
          && result.calibrationEligibility === "not_eligible_without_versioned_policy_review"
          && measurement?.projectId === input.projectId
          && measurement.executionId === input.executionId
          && measurement.episodeId === resultOwnerEpisode.id
          && measurement.attempt === resultOwnerEpisode.attempt
          && measurement.missionId === input.missionId
          && measurement.goalId === input.goalId
          && measurement.planRevision === input.planRevision
          && measurement.projectRevision === input.projectRevision
          && (
            !input.observationId
            || result.observationId === input.observationId
          )
          && typeof result.continuationRequestHash === "string";
      });
      const sourceResults = resultRows.filter((row) => {
        const result = asRecord(row.payload);
        return result?.recordKind === "P75_HYPOTHESIS_MEASUREMENT_CONTINUATION_RESULT"
          && result.sourceExperimentId === input.sourceExperimentId;
      });
      if (sourceResults.length !== 1 || matchingResults.length !== 1) {
        ledgerError("invalid_contract", "P7.5 result owner does not contain one exact persisted continuation result.");
      }
      const resultPayload = asRecord(matchingResults[0]!.payload)!;
      const continuationRequests = await tx.select().from(aiAgentEpisodeEventsTable).where(and(
        eq(aiAgentEpisodeEventsTable.episodeId, resultOwnerEpisode.id),
        eq(aiAgentEpisodeEventsTable.projectId, input.projectId),
        eq(aiAgentEpisodeEventsTable.executionId, input.executionId),
        eq(aiAgentEpisodeEventsTable.attempt, resultOwnerEpisode.attempt),
        eq(aiAgentEpisodeEventsTable.eventType, "OBSERVATION_REQUESTED"),
      ));
      const matchingRequests = continuationRequests.filter((row) => {
        const request = asRecord(row.payload);
        const measurement = asRecord(request?.measurement);
        const source = asRecord(request?.source);
        let requestHashMatches = false;
        try {
          requestHashMatches = canonicalJsonHash(
            parseBoundedJson(row.payload, 32 * 1024),
          ) === resultPayload.continuationRequestHash;
        } catch {
          requestHashMatches = false;
        }
        return request?.recordKind === "P75_HYPOTHESIS_MEASUREMENT_CONTINUATION_REQUESTED"
          && request.continuationId === input.continuationId
          && source?.experimentId === input.sourceExperimentId
          && requestHashMatches
          && measurement?.projectId === input.projectId
          && measurement.executionId === input.executionId
          && measurement.episodeId === resultOwnerEpisode.id
          && measurement.attempt === resultOwnerEpisode.attempt
          && measurement.missionId === input.missionId
          && measurement.goalId === input.goalId
          && measurement.planRevision === input.planRevision
          && measurement.projectRevision === input.projectRevision;
      });
      const sameContinuationRequests = continuationRequests.filter((row) => {
        const request = asRecord(row.payload);
        return request?.recordKind === "P75_HYPOTHESIS_MEASUREMENT_CONTINUATION_REQUESTED"
          && request.continuationId === input.continuationId;
      });
      if (sameContinuationRequests.length !== 1 || matchingRequests.length !== 1) {
        ledgerError("invalid_contract", "P7.5 result owner has no unique matching persisted continuation request.");
      }
    }

    const resultOwnerEpisodeId = resultOwnerEpisode.id;
    const resultOwnerAttempt = resultOwnerEpisode.attempt;
    const now = new Date();
    if (resultOwnerEpisode.id !== episode.id) {
      const resultOwnerTerminalPayload: JsonValue = {
        verdict: "replan_required",
        reasonCode: input.reasonCode,
        sourceExperimentId: input.sourceExperimentId,
        continuationId: input.continuationId ?? null,
        resultId: input.resultId ?? null,
        measurementValidity: input.measurementValidity ?? null,
        resultOwnerEpisodeId,
        resultOwnerAttempt,
        recoveredByEpisodeId: episode.id,
        recoveredByAttempt: input.attempt,
      };
      if (resultOwnerEpisode.closedAt || TERMINAL_STATES.has(resultOwnerEpisode.state)) {
        const terminalEvents = await tx.select().from(aiAgentEpisodeEventsTable).where(and(
          eq(aiAgentEpisodeEventsTable.episodeId, resultOwnerEpisode.id),
          eq(aiAgentEpisodeEventsTable.eventType, "EPISODE_TERMINAL"),
        ));
        const matchingTerminalEvents = terminalEvents.filter((event) => (
          event.projectId === input.projectId
          && event.executionId === input.executionId
          && event.attempt === resultOwnerEpisode.attempt
          && event.payloadHash === canonicalJsonHash(resultOwnerTerminalPayload)
        ));
        if (
          resultOwnerEpisode.state !== "completed"
          || resultOwnerEpisode.verdict !== "replan_required"
          || resultOwnerEpisode.reasonCode !== input.reasonCode
          || !resultOwnerEpisode.closedAt
          || terminalEvents.length !== 1
          || matchingTerminalEvents.length !== 1
        ) {
          ledgerError("terminal_immutable", "P7.5 result-owning Episode is terminal with conflicting recovery semantics.");
        }
      } else {
        await appendHistoricalP75TerminalEventLocked(
          tx,
          resultOwnerEpisode,
          input,
          resultOwnerTerminalPayload,
          now,
        );
        await tx.update(aiAgentEpisodesTable).set({
          state: "completed",
          verdict: "replan_required",
          reasonCode: input.reasonCode,
          nextActionCode: "MISSION_REPLAN",
          closedAt: now,
          updatedAt: now,
        }).where(eq(aiAgentEpisodesTable.id, resultOwnerEpisode.id));
      }
    }

    const terminalizedRelatedEpisodeIds = new Set([
      episode.id,
      resultOwnerEpisode.id,
    ]);
    if (sourceEpisode && !terminalizedRelatedEpisodeIds.has(sourceEpisode.id)) {
      await terminalizeRelatedP75Episode(
        tx,
        sourceEpisode,
        input,
        episode.id,
        "source_registration",
        now,
      );
      terminalizedRelatedEpisodeIds.add(sourceEpisode.id);
    }
    if (
      observationEpisode
      && !terminalizedRelatedEpisodeIds.has(observationEpisode.id)
    ) {
      await terminalizeRelatedP75Episode(
        tx,
        observationEpisode,
        input,
        episode.id,
        "prior_observation",
        now,
      );
    }

    const payload: JsonValue = {
      verdict: "replan_required",
      reasonCode: input.reasonCode,
      sourceExperimentId: input.sourceExperimentId,
      continuationId: input.continuationId ?? null,
      resultId: input.resultId ?? null,
      measurementValidity: input.measurementValidity ?? null,
      resultOwnerEpisodeId,
      resultOwnerAttempt,
    };
    await appendLocked(tx, {
      episodeId: input.episodeId,
      projectId: input.projectId,
      executionId: input.executionId,
      attempt: input.attempt,
      workerId: input.workerId,
      eventType: "EPISODE_TERMINAL",
      payload,
      actorType: "worker",
      actorId: input.workerId,
      correlationId: input.executionId,
    }, execution, episode);

    await tx.update(aiAgentEpisodesTable).set({
      state: "completed",
      verdict: "replan_required",
      reasonCode: input.reasonCode,
      nextActionCode: "MISSION_REPLAN",
      closedAt: now,
      updatedAt: now,
    }).where(eq(aiAgentEpisodesTable.id, input.episodeId));

    await tx.update(aiGoalsTable).set({
      status: "needs_replan",
      blockedReason: input.reasonCode,
      completedAt: null,
      nextWakeAt: null,
      updatedAt: now,
    }).where(and(
      eq(aiGoalsTable.id, goal.id),
      eq(aiGoalsTable.missionId, input.missionId),
      eq(aiGoalsTable.projectId, input.projectId),
    ));

    const observationOnlyTerminalization = JSON.stringify({
      kind: "P75_HYPOTHESIS_MEASUREMENT_CONTINUATION",
      episodeId: input.episodeId,
      resultOwnerEpisodeId,
      resultOwnerAttempt,
      sourceExperimentId: input.sourceExperimentId,
      continuationId: input.continuationId ?? null,
      resultId: input.resultId ?? null,
      reasonCode: input.reasonCode,
      createsAcceptance: false,
    });
    const [updatedExecution] = await tx.update(aiExecutionsTable).set({
      status: "completed",
      workerId: null,
      leaseUntil: null,
      updatedAt: now,
      completedAt: now,
      finalMessageId: null,
      error: null,
      checkpoint: sql`
        jsonb_set(
          jsonb_set(
            ${aiExecutionsTable.checkpoint}::jsonb,
            '{stage}',
            to_jsonb('completed'::text),
            true
          ),
          '{observationOnlyTerminalization}',
          ${observationOnlyTerminalization}::jsonb,
          true
        )::text
      `,
      checkpointVersion: sql`${aiExecutionsTable.checkpointVersion} + 1`,
    }).where(and(
      eq(aiExecutionsTable.id, input.executionId),
      eq(aiExecutionsTable.projectId, input.projectId),
      eq(aiExecutionsTable.userId, input.userId),
      eq(aiExecutionsTable.operationId, input.operationId),
      eq(aiExecutionsTable.goalId, input.goalId),
      eq(aiExecutionsTable.attempt, input.attempt),
      eq(aiExecutionsTable.status, "running"),
      eq(aiExecutionsTable.workerId, input.workerId),
      gt(aiExecutionsTable.leaseUntil, now),
      isNull(aiExecutionsTable.cancelRequestedAt),
      isNull(aiExecutionsTable.recipeReceipt),
    )).returning({ id: aiExecutionsTable.id });
    if (!updatedExecution) {
      ledgerError("stale_worker", "P7.5 continuation lost its execution ownership fence");
    }

    const [closed] = await tx.select().from(aiAgentEpisodesTable)
      .where(eq(aiAgentEpisodesTable.id, input.episodeId));
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