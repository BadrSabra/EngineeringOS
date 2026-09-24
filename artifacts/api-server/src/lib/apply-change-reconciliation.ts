import { randomUUID } from "node:crypto";
import {
  aiAgentEffectBundlesTable,
  aiAgentEffectsTable,
  aiAgentEpisodeEventsTable,
  aiAgentEpisodesTable,
  aiAgentObservationsTable,
  aiApplyJournalTable,
  aiChangeProposalsTable,
  aiExecutionAcceptancesTable,
  aiExecutionsTable,
  db,
  eventsTable,
  projectsTable,
} from "@workspace/db";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import {
  DELIVERY_TREE_DIGEST_VERSION,
  deliveryWorkspaceExists,
  hashChangeSet,
  hashDeliveryTree,
} from "./delivery-workspace.js";
import { establishProjectRoot } from "./project-root.js";
import { logger } from "./logger.js";

type ApplyRecoveryTreeDecision =
  | "BASE_TREE_PRESENT"
  | "CANDIDATE_TREE_PRESENT"
  | "MIXED_OR_UNRELATED_TREE"
  | "CANDIDATE_WORKSPACE_MISMATCH"
  | "ROOT_UNAVAILABLE";

export function classifyApplyRecoveryTrees(input: {
  baseTreeHash: string | null;
  expectedCandidateTreeHash: string | null;
  liveTreeHash: string | null;
  candidateWorkspaceTreeHash: string | null;
  rootAvailable: boolean;
}): ApplyRecoveryTreeDecision {
  if (!input.rootAvailable || !input.liveTreeHash) return "ROOT_UNAVAILABLE";
  if (
    input.baseTreeHash
    && input.liveTreeHash === input.baseTreeHash
  ) {
    return "BASE_TREE_PRESENT";
  }
  if (
    !input.expectedCandidateTreeHash
    || !input.candidateWorkspaceTreeHash
    || input.candidateWorkspaceTreeHash !== input.expectedCandidateTreeHash
  ) {
    return "CANDIDATE_WORKSPACE_MISMATCH";
  }
  if (input.liveTreeHash === input.expectedCandidateTreeHash) {
    return "CANDIDATE_TREE_PRESENT";
  }
  return "MIXED_OR_UNRELATED_TREE";
}

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : undefined;
}

function parseRecord(value: unknown): JsonRecord | undefined {
  if (typeof value !== "string") return asRecord(value);
  try {
    return asRecord(JSON.parse(value));
  } catch {
    return undefined;
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function isApplyChangesRequest(value: unknown): boolean {
  const request = parseRecord(value);
  return request?.turnIntent === "APPLY_CHANGES"
    || request?.executionProfile === "approved_source_promotion";
}

function getApplyActionEvent(
  episodeEvents: Array<typeof aiAgentEpisodeEventsTable.$inferSelect>,
  proposal: typeof aiChangeProposalsTable.$inferSelect,
): {
  event: typeof aiAgentEpisodeEventsTable.$inferSelect;
  action: JsonRecord;
  scope: JsonRecord;
  effectContract: JsonRecord;
  attemptId: string;
  changeSetHash: string;
  approvedPaths: string[];
} | undefined {
  for (const event of episodeEvents) {
    if (event.eventType !== "ACTION_REQUESTED") continue;
    const payload = asRecord(event.payload);
    const action = asRecord(payload?.action);
    const scope = asRecord(action?.scope);
    const effectContract = asRecord(payload?.effectContract);
    const attemptId = asString(scope?.attemptId);
    const changeSetHash = asString(scope?.changeSetHash);
    const approvedPaths = asStringArray(scope?.approvedPaths);
    const expectedEffects = asStringArray(action?.expectedEffects);
    if (
      action?.capabilityId !== "approved.source-promotion"
      || action.episodeId !== event.episodeId
      || !asString(action.actionId)
      || scope?.projectId !== proposal.projectId
      || scope?.proposalId !== proposal.id
      || scope?.operationId !== proposal.operationId
      || scope?.candidateTreeHash !== proposal.candidateTreeHash
      || scope?.baseTreeHash !== proposal.baseTreeHash
      || scope?.sourceRevision !== proposal.baseRevision
      || !attemptId
      || !changeSetHash
      || approvedPaths.length === 0
      || !expectedEffects.includes(asString(effectContract?.effectId) ?? "")
      || !effectContract
    ) {
      continue;
    }
    return { event, action, scope, effectContract, attemptId, changeSetHash, approvedPaths };
  }
  return undefined;
}

function promotionIntentMatches(
  journal: Array<typeof aiApplyJournalTable.$inferSelect>,
  proposal: typeof aiChangeProposalsTable.$inferSelect,
  action: NonNullable<ReturnType<typeof getApplyActionEvent>>,
): boolean {
  const intent = [...journal].reverse().find((entry) => entry.stage === "PROMOTION_INTENT");
  const payload = asRecord(intent?.payload);
  const files = Array.isArray(payload?.files) ? payload.files : [];
  const changes = files.flatMap((entry) => {
    const file = asRecord(entry);
    if (typeof file?.path !== "string" || typeof file.newContent !== "string") return [];
    return [{
      path: file.path,
      newContent: file.newContent,
      originalContent: typeof file.originalContent === "string" ? file.originalContent : null,
    }];
  });
  const proposalChanges = parseRecord(proposal.changes);
  const storedChanges = Array.isArray(proposalChanges)
    ? proposalChanges
    : (() => {
        try {
          const parsed = JSON.parse(proposal.changes) as unknown;
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      })();
  const storedByPath = new Map<string, JsonRecord>();
  for (const entry of storedChanges) {
    const change = asRecord(entry);
    if (typeof change?.path !== "string" || storedByPath.has(change.path)) return false;
    storedByPath.set(change.path, change);
  }
  if (
    changes.length === 0
    || changes.length !== files.length
    || new Set(changes.map((change) => change.path)).size !== changes.length
    || new Set(action.approvedPaths).size !== action.approvedPaths.length
    || action.approvedPaths.length !== changes.length
    || !changes.every((change) => action.approvedPaths.includes(change.path))
    || !changes.every((change) => {
      const stored = storedByPath.get(change.path);
      return stored
        && (stored.originalContent ?? null) === change.originalContent;
    })
    || hashChangeSet(changes) !== action.changeSetHash
  ) {
    return false;
  }
  return payload?.operationId === proposal.operationId
    && payload.candidateWorkspace === proposal.workspaceRoot
    && payload.candidateHash === proposal.candidateTreeHash
    && payload.baseRevision === proposal.baseRevision
    && payload.changeSetHash === action.changeSetHash
    && intent?.attemptId === action.attemptId;
}

function effectContractMatches(
  contract: JsonRecord,
  proposal: typeof aiChangeProposalsTable.$inferSelect,
): boolean {
  const expected = Array.isArray(contract.expectedStateChanges)
    ? contract.expectedStateChanges
    : [];
  const candidateIdentity = `${proposal.id}:${proposal.candidateTreeHash}`;
  return contract.observationProfile === "WORKSPACE"
    && contract.allowedResult === "OBSERVED"
    && expected.some((entry) => {
      const change = asRecord(entry);
      return change?.subject === `project:${candidateIdentity}`
        && change.predicate === "workspace.tree_hash"
        && change.expectedValue === proposal.candidateTreeHash;
    });
}

async function hasAcceptedApplyProof(
  proposal: typeof aiChangeProposalsTable.$inferSelect,
  execution: typeof aiExecutionsTable.$inferSelect,
  actionRecord: NonNullable<ReturnType<typeof getApplyActionEvent>>,
): Promise<string | undefined> {
  if (
    proposal.status !== "applied"
    || !proposal.operationId
    || !proposal.candidateTreeHash
    || proposal.treeDigestVersion !== DELIVERY_TREE_DIGEST_VERSION
  ) {
    return undefined;
  }
  const [acceptance] = await db.select()
    .from(aiExecutionAcceptancesTable)
    .where(and(
      eq(aiExecutionAcceptancesTable.executionId, execution.id),
      eq(aiExecutionAcceptancesTable.projectId, proposal.projectId),
      eq(aiExecutionAcceptancesTable.attempt, execution.attempt),
    ))
    .limit(1);
  if (
    !acceptance
    || acceptance.outcome !== "SUCCEEDED"
    || acceptance.terminalStatus !== "completed"
    || acceptance.operationId !== execution.operationId
    || execution.operationId !== actionRecord.attemptId
    || acceptance.sourceRevision !== proposal.baseRevision
    || acceptance.candidateIdentity !== `${proposal.id}:${proposal.candidateTreeHash}`
    || !acceptance.effectBundleId
  ) {
    return undefined;
  }

  const [episode] = await db.select()
    .from(aiAgentEpisodesTable)
    .where(and(
      eq(aiAgentEpisodesTable.id, actionRecord.event.episodeId),
      eq(aiAgentEpisodesTable.projectId, proposal.projectId),
      eq(aiAgentEpisodesTable.executionId, execution.id),
      eq(aiAgentEpisodesTable.attempt, execution.attempt),
    ))
    .limit(1);
  if (!episode || episode.intentKind !== "APPLY_CHANGES") return undefined;

  const [bundle] = await db.select()
    .from(aiAgentEffectBundlesTable)
    .where(and(
      eq(aiAgentEffectBundlesTable.id, acceptance.effectBundleId),
      eq(aiAgentEffectBundlesTable.projectId, proposal.projectId),
      eq(aiAgentEffectBundlesTable.executionId, execution.id),
      eq(aiAgentEffectBundlesTable.attempt, execution.attempt),
      eq(aiAgentEffectBundlesTable.episodeId, episode.id),
    ))
    .limit(1);
  if (!bundle || bundle.verdict !== "OBSERVED") return undefined;
  const effectIds = asStringArray(bundle.effectIds);
  if (effectIds.length === 0) return undefined;
  const effects = await db.select()
    .from(aiAgentEffectsTable)
    .where(inArray(aiAgentEffectsTable.id, effectIds));
  if (
    effects.length !== effectIds.length
    || !effects.every((effect) =>
      effect.projectId === proposal.projectId
      && effect.executionId === execution.id
      && effect.attempt === execution.attempt
      && effect.episodeId === episode.id
      && effect.actionId === actionRecord.action.actionId
      && effect.status === "observed"
      && Array.isArray(effect.expectedEffects)
      && effect.expectedEffects.some((entry) => {
        const expected = asRecord(entry);
        return expected?.subject === `project:${proposal.id}:${proposal.candidateTreeHash}`
          && expected.predicate === "workspace.tree_hash"
          && expected.expectedValue === proposal.candidateTreeHash;
      }),
    )
  ) {
    return undefined;
  }

  const observationIds = [...new Set(effects.flatMap((effect) => [
    ...asStringArray(effect.beforeObservationIds),
    ...asStringArray(effect.afterObservationIds),
  ]))];
  const observations = observationIds.length > 0
    ? await db.select()
      .from(aiAgentObservationsTable)
      .where(inArray(aiAgentObservationsTable.id, observationIds))
    : [];
  if (observations.length !== observationIds.length) return undefined;
  const beforeId = `apply:${execution.id}:${execution.attempt}:before:tree`;
  const afterId = `apply:${execution.id}:${execution.attempt}:after:tree`;
  const hasBefore = observations.some((observation) =>
    observation.projectId === proposal.projectId
    && observation.executionId === execution.id
    && observation.episodeId === episode.id
    && observation.provenance === "DIRECT_OBSERVATION"
    && observation.sourceId === beforeId
    && observation.subject === `project:${proposal.id}:${proposal.candidateTreeHash}`
    && observation.predicate === "workspace.tree_hash"
    && observation.value === proposal.baseTreeHash,
  );
  const hasAfter = observations.some((observation) =>
    observation.projectId === proposal.projectId
    && observation.executionId === execution.id
    && observation.episodeId === episode.id
    && observation.provenance === "DIRECT_OBSERVATION"
    && observation.sourceId === afterId
    && observation.subject === `project:${proposal.id}:${proposal.candidateTreeHash}`
    && observation.predicate === "workspace.tree_hash"
    && observation.value === proposal.candidateTreeHash,
  );
  if (!hasBefore || !hasAfter) return undefined;

  const [appliedEvent] = await db.select()
    .from(eventsTable)
    .where(and(
      eq(eventsTable.projectId, proposal.projectId),
      eq(eventsTable.type, "AiChangesApplied"),
      eq(eventsTable.correlationId, proposal.operationId),
    ))
    .orderBy(desc(eventsTable.timestamp))
    .limit(1);
  const eventPayload = asRecord(appliedEvent?.payload);
  const eventMatches = eventPayload?.proposalId === proposal.id
    && eventPayload.operationId === proposal.operationId
    && eventPayload.applyStatus === "APPLIED"
    && eventPayload.baseTreeHash === proposal.baseTreeHash
    && eventPayload.candidateTreeHash === proposal.candidateTreeHash
    && eventPayload.promotedTreeHash === proposal.candidateTreeHash
    && eventPayload.changeSetHash === actionRecord.changeSetHash
    && eventPayload.treeDigestVersion === DELIVERY_TREE_DIGEST_VERSION;
  return eventMatches ? bundle.id : undefined;
}

async function persistRecoveryDecision(input: {
  proposal: typeof aiChangeProposalsTable.$inferSelect;
  execution: typeof aiExecutionsTable.$inferSelect;
  attemptId: string;
  stage: "BLOCKED" | "RECOVERY_REQUIRED";
  decision: ApplyRecoveryTreeDecision;
  liveTreeHash: string | null;
  candidateWorkspaceTreeHash: string | null;
  reason: string;
}): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [lockedProposal] = await tx.select()
      .from(aiChangeProposalsTable)
      .where(and(
        eq(aiChangeProposalsTable.id, input.proposal.id),
        eq(aiChangeProposalsTable.projectId, input.proposal.projectId),
      ))
      .for("update");
    if (!lockedProposal) return false;
    const processable = lockedProposal.lifecycle === "isolated"
      || lockedProposal.lifecycle === "validated"
      || (lockedProposal.status === "applied" && lockedProposal.lifecycle === "blocked");
    if (
      !processable
      || lockedProposal.operationId !== input.proposal.operationId
      || lockedProposal.candidateTreeHash !== input.proposal.candidateTreeHash
    ) {
      return false;
    }
    const journal = await tx.select({
      sequence: aiApplyJournalTable.sequence,
      stage: aiApplyJournalTable.stage,
      payload: aiApplyJournalTable.payload,
    })
      .from(aiApplyJournalTable)
      .where(and(
        eq(aiApplyJournalTable.operationId, input.proposal.operationId!),
        eq(aiApplyJournalTable.attemptId, input.attemptId),
      ))
      .orderBy(aiApplyJournalTable.sequence);
    const latest = journal.at(-1);
    const latestPayload = asRecord(latest?.payload);
    const sameDecision = latest?.stage === input.stage
      && latestPayload?.recoveryDecision === input.decision
      && latestPayload?.liveTreeHash === input.liveTreeHash
      && latestPayload?.candidateWorkspaceTreeHash === input.candidateWorkspaceTreeHash
      && latestPayload?.reason === input.reason;
    const nextSequence = (latest?.sequence ?? -1) + 1;
    const lifecycle = input.stage === "BLOCKED"
      ? "conflicted"
      : lockedProposal.status === "applied"
        ? "blocked"
        : "conflicted";
    await tx.update(aiChangeProposalsTable)
      .set({
        lifecycle,
        conflictReason: input.reason,
      })
      .where(and(
        eq(aiChangeProposalsTable.id, lockedProposal.id),
        or(
          inArray(aiChangeProposalsTable.lifecycle, ["isolated", "validated"]),
          and(
            eq(aiChangeProposalsTable.status, "applied"),
            eq(aiChangeProposalsTable.lifecycle, "blocked"),
          ),
        ),
      ));
    if (!sameDecision) {
      await tx.insert(aiApplyJournalTable).values({
        id: randomUUID(),
        operationId: input.proposal.operationId!,
        attemptId: input.attemptId,
        projectId: input.proposal.projectId,
        proposalId: input.proposal.id,
        stage: input.stage,
        sequence: nextSequence,
        payload: {
          recoveryDecision: input.decision,
          liveTreeHash: input.liveTreeHash,
          candidateWorkspaceTreeHash: input.candidateWorkspaceTreeHash,
          expectedCandidateTreeHash: input.proposal.candidateTreeHash,
          baseTreeHash: input.proposal.baseTreeHash,
          executionId: input.execution.id,
          executionAttempt: input.execution.attempt,
          reason: input.reason,
          noFilesystemWrites: true,
        },
      });
    }
    return true;
  });
}

async function releaseAcceptedApplyProjection(input: {
  proposal: typeof aiChangeProposalsTable.$inferSelect;
  execution: typeof aiExecutionsTable.$inferSelect;
  attemptId: string;
  actionRecord: NonNullable<ReturnType<typeof getApplyActionEvent>>;
  liveTreeHash: string;
  effectBundleId: string;
}): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [proposal] = await tx.select()
      .from(aiChangeProposalsTable)
      .where(and(
        eq(aiChangeProposalsTable.id, input.proposal.id),
        eq(aiChangeProposalsTable.projectId, input.proposal.projectId),
      ))
      .for("update");
    if (
      !proposal
      || proposal.status !== "applied"
      || proposal.lifecycle !== "blocked"
      || proposal.candidateTreeHash !== input.liveTreeHash
      || proposal.promotedTreeHash !== input.liveTreeHash
    ) {
      return false;
    }
    const journal = await tx.select({
      sequence: aiApplyJournalTable.sequence,
      stage: aiApplyJournalTable.stage,
    })
      .from(aiApplyJournalTable)
      .where(and(
        eq(aiApplyJournalTable.operationId, proposal.operationId!),
        eq(aiApplyJournalTable.attemptId, input.attemptId),
      ))
      .orderBy(aiApplyJournalTable.sequence);
    const latest = journal.at(-1);
    const [updated] = await tx.update(aiChangeProposalsTable)
      .set({
        lifecycle: "applied",
        conflictReason: null,
      })
      .where(and(
        eq(aiChangeProposalsTable.id, proposal.id),
        eq(aiChangeProposalsTable.projectId, proposal.projectId),
        eq(aiChangeProposalsTable.status, "applied"),
        eq(aiChangeProposalsTable.lifecycle, "blocked"),
      ))
      .returning({ id: aiChangeProposalsTable.id });
    if (!updated) return false;
    if (latest?.stage !== "APPLIED") {
      await tx.insert(aiApplyJournalTable).values({
        id: randomUUID(),
        operationId: proposal.operationId!,
        attemptId: input.attemptId,
        projectId: proposal.projectId,
        proposalId: proposal.id,
        stage: "APPLIED",
        sequence: (latest?.sequence ?? -1) + 1,
        payload: {
          recoveryDecision: "ACCEPTED_PROOF_RECONCILED",
          executionId: input.execution.id,
          executionAttempt: input.execution.attempt,
          effectBundleId: input.effectBundleId,
          liveTreeHash: input.liveTreeHash,
          noFilesystemWrites: true,
        },
      });
    }
    return true;
  });
}

export async function reconcileInterruptedApplyChanges(): Promise<{
  reconciled: number;
  protectedProposalIds: Set<string>;
}> {
  const proposals = await db.select()
    .from(aiChangeProposalsTable)
    .where(or(
      inArray(aiChangeProposalsTable.lifecycle, ["isolated", "validated"]),
      and(
        eq(aiChangeProposalsTable.status, "applied"),
        eq(aiChangeProposalsTable.lifecycle, "blocked"),
      ),
    ));
  const protectedProposalIds = new Set<string>();
  let reconciled = 0;

  for (const proposal of proposals) {
    if (!proposal.operationId) continue;
    const executions = await db.select()
      .from(aiExecutionsTable)
      .where(and(
        eq(aiExecutionsTable.projectId, proposal.projectId),
        eq(aiExecutionsTable.proposalId, proposal.id),
      ))
      .orderBy(desc(aiExecutionsTable.createdAt));
    const applyExecutions = executions.filter((execution) => isApplyChangesRequest(execution.request));
    if (applyExecutions.length === 0) continue;
    protectedProposalIds.add(proposal.id);

    const selected = applyExecutions[0]!;
    try {
      if (selected.status === "running" || selected.status === "cancelling" || selected.status === "queued") {
        continue;
      }
      const episodes = await db.select()
        .from(aiAgentEpisodesTable)
        .where(and(
          eq(aiAgentEpisodesTable.projectId, proposal.projectId),
          eq(aiAgentEpisodesTable.executionId, selected.id),
          eq(aiAgentEpisodesTable.attempt, selected.attempt),
        ))
        .limit(1);
      const episode = episodes[0];
      const episodeEvents = episode
        ? await db.select()
          .from(aiAgentEpisodeEventsTable)
          .where(and(
            eq(aiAgentEpisodeEventsTable.projectId, proposal.projectId),
            eq(aiAgentEpisodeEventsTable.executionId, selected.id),
            eq(aiAgentEpisodeEventsTable.attempt, selected.attempt),
            eq(aiAgentEpisodeEventsTable.episodeId, episode.id),
          ))
          .orderBy(desc(aiAgentEpisodeEventsTable.sequence))
        : [];
      const actionRecord = getApplyActionEvent(episodeEvents, proposal);
      const attemptId = actionRecord?.attemptId
        ?? asString(parseRecord(selected.request)?.operationId)
        ?? selected.id;
      const journal = await db.select()
        .from(aiApplyJournalTable)
        .where(and(
          eq(aiApplyJournalTable.operationId, proposal.operationId),
          eq(aiApplyJournalTable.attemptId, attemptId),
          eq(aiApplyJournalTable.projectId, proposal.projectId),
          eq(aiApplyJournalTable.proposalId, proposal.id),
        ))
        .orderBy(aiApplyJournalTable.sequence);

      const [project] = await db.select()
        .from(projectsTable)
        .where(eq(projectsTable.id, proposal.projectId))
        .limit(1);
      const establishedRoot = project?.rootPath
        ? await establishProjectRoot(project.rootPath)
        : undefined;
      if (!establishedRoot?.ok) {
        logger.warn({
          proposalId: proposal.id,
          rootReason: establishedRoot?.reason ?? "project_root_missing",
        }, "apply recovery could not re-establish the persisted project root");
      }
      const rootPath = establishedRoot?.ok ? establishedRoot.canonicalPath : undefined;
      const rootMatchesExecution = Boolean(
        rootPath && selected.workspaceRoot === rootPath,
      );
      const candidateWorkspaceValid = await deliveryWorkspaceExists(
        proposal.workspaceRoot,
        proposal.operationId,
      );
      const [liveTreeHash, candidateWorkspaceTreeHash] = await Promise.all([
        rootMatchesExecution && rootPath
          ? hashDeliveryTree(rootPath).catch((error) => {
              logger.warn({
                proposalId: proposal.id,
                digestCode: asString(asRecord(error)?.code) ?? "unknown",
              }, "apply recovery could not hash the live project tree");
              return null;
            })
          : Promise.resolve(null),
        candidateWorkspaceValid && proposal.workspaceRoot
          ? hashDeliveryTree(proposal.workspaceRoot).catch(() => null)
          : Promise.resolve(null),
      ]);
      const treeDecision = classifyApplyRecoveryTrees({
        baseTreeHash: proposal.baseTreeHash,
        expectedCandidateTreeHash: proposal.candidateTreeHash,
        liveTreeHash,
        candidateWorkspaceTreeHash,
        rootAvailable: Boolean(rootMatchesExecution && liveTreeHash),
      });
      const promotionIntentValid = Boolean(
        actionRecord
        && actionRecord.attemptId === attemptId
        && promotionIntentMatches(journal, proposal, actionRecord),
      );
      const effectContractValid = Boolean(
        actionRecord && effectContractMatches(actionRecord.effectContract, proposal),
      );
      const proofContextValid = Boolean(episode && actionRecord && promotionIntentValid && effectContractValid);
      const acceptedProofBundleId =
        treeDecision === "CANDIDATE_TREE_PRESENT"
        && proofContextValid
        && actionRecord
        ? await hasAcceptedApplyProof(proposal, selected, actionRecord)
        : undefined;
      if (treeDecision === "CANDIDATE_TREE_PRESENT" && !acceptedProofBundleId) {
        logger.warn({
          proposalId: proposal.id,
          executionId: selected.id,
          episodeFound: Boolean(episode),
          actionFound: Boolean(actionRecord),
          promotionIntentValid,
          effectContractValid,
        }, "candidate tree remains blocked because apply proof is incomplete");
      }

      if (
        treeDecision === "CANDIDATE_TREE_PRESENT"
        && proofContextValid
        && liveTreeHash
        && actionRecord
        && acceptedProofBundleId
      ) {
        const released = await releaseAcceptedApplyProjection({
          proposal,
          execution: selected,
          attemptId,
          actionRecord,
          liveTreeHash,
          effectBundleId: acceptedProofBundleId,
        });
        if (released) reconciled++;
        continue;
      }

      const baseTreeWithNoPromotion = treeDecision === "BASE_TREE_PRESENT";
      const reason = baseTreeWithNoPromotion
        ? "The original base tree is still present; validation must be resumed before another apply attempt."
        : treeDecision === "CANDIDATE_TREE_PRESENT"
          ? "The candidate tree is present, but this attempt has no complete accepted effect proof; manual recovery is required."
          : "The interrupted apply state could not be matched to a complete server-owned tree and proof; manual recovery is required.";
      const persisted = await persistRecoveryDecision({
        proposal,
        execution: selected,
        attemptId,
        stage: baseTreeWithNoPromotion ? "BLOCKED" : "RECOVERY_REQUIRED",
        decision: treeDecision,
        liveTreeHash,
        candidateWorkspaceTreeHash,
        reason,
      });
      if (persisted) reconciled++;
    } catch (error) {
      logger.warn(
        { error, proposalId: proposal.id, executionId: selected.id },
        "interrupted apply reconciliation failed closed",
      );
      try {
        const attemptId = asString(parseRecord(selected.request)?.operationId) ?? selected.id;
        const persisted = await persistRecoveryDecision({
          proposal,
          execution: selected,
          attemptId,
          stage: "RECOVERY_REQUIRED",
          decision: "ROOT_UNAVAILABLE",
          liveTreeHash: null,
          candidateWorkspaceTreeHash: null,
          reason: "Recovery could not verify the interrupted apply state; manual review is required.",
        });
        if (persisted) reconciled++;
      } catch (persistError) {
        logger.error(
          { error: persistError, proposalId: proposal.id, executionId: selected.id },
          "interrupted apply could not be durably blocked",
        );
      }
    }
  }

  return { reconciled, protectedProposalIds };
}