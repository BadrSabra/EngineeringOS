import { and, eq } from "drizzle-orm";
import {
  aiChangeProposalsTable,
  aiExecutionsTable,
  aiExecutionAcceptancesTable,
  aiGoalsTable,
  aiMissionHandoffsTable,
  aiMissionLineagesTable,
  aiMissionsTable,
  db,
} from "@workspace/db";
import { checkMissionCandidateAcceptance } from "./mission-candidate-acceptance.js";

type MissionTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Mission = typeof aiMissionsTable.$inferSelect;

export type MissionLineageIdentity = Pick<
  typeof aiMissionLineagesTable.$inferSelect,
  "applyMissionId" | "canonicalMissionId" | "sourceExecutionId" | "sourceGoalId" | "proposalId"
>;

export type MissionLineageResolution =
  | { kind: "not_required" }
  | { kind: "verified"; lineage: MissionLineageIdentity }
  | {
      kind: "unresolved";
      reason:
        | "lineage_missing"
        | "lineage_identity_mismatch"
        | "lineage_source_missing"
        | "lineage_source_not_accepted";
    };

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

/**
 * Reloads the server-authored Apply-Mission parent edge and verifies every
 * persisted relationship. Client-provided IDs are never accepted here.
 */
export async function resolveMissionLineage(
  tx: MissionTransaction,
  mission: Mission,
  options: { requireAcceptedSource?: boolean } = {},
): Promise<MissionLineageResolution> {
  const policy = record(mission.autonomyPolicy);
  if (!Object.hasOwn(policy, "applyMission")) return { kind: "not_required" };

  const applyPolicy = record(policy.applyMission);
  const [lineage] = await tx
    .select()
    .from(aiMissionLineagesTable)
    .where(and(
      eq(aiMissionLineagesTable.applyMissionId, mission.id),
      eq(aiMissionLineagesTable.projectId, mission.projectId),
    ))
    .limit(1);
  if (!lineage) return { kind: "unresolved", reason: "lineage_missing" };

  const [
    canonicalMissionRows,
    sourceExecutionRows,
    sourceGoalRows,
    proposalRows,
  ] = await Promise.all([
    tx.select()
      .from(aiMissionsTable)
      .where(and(
        eq(aiMissionsTable.id, lineage.canonicalMissionId),
        eq(aiMissionsTable.projectId, mission.projectId),
        eq(aiMissionsTable.userId, mission.userId),
      ))
      .limit(1),
    tx.select()
      .from(aiExecutionsTable)
      .where(and(
        eq(aiExecutionsTable.id, lineage.sourceExecutionId),
        eq(aiExecutionsTable.projectId, mission.projectId),
        eq(aiExecutionsTable.userId, mission.userId),
      ))
      .limit(1),
    tx.select()
      .from(aiGoalsTable)
      .where(and(
        eq(aiGoalsTable.id, lineage.sourceGoalId),
        eq(aiGoalsTable.projectId, mission.projectId),
        eq(aiGoalsTable.missionId, lineage.canonicalMissionId),
      ))
      .limit(1),
    tx.select()
      .from(aiChangeProposalsTable)
      .where(and(
        eq(aiChangeProposalsTable.id, lineage.proposalId),
        eq(aiChangeProposalsTable.projectId, mission.projectId),
      ))
      .limit(1),
  ]);
  const [canonicalMission] = canonicalMissionRows;
  const [sourceExecution] = sourceExecutionRows;
  const [sourceGoal] = sourceGoalRows;
  const [proposal] = proposalRows;
  if (!canonicalMission || !sourceExecution || !sourceGoal || !proposal) {
    return { kind: "unresolved", reason: "lineage_source_missing" };
  }

  const [handoff] = proposal.sessionId
    ? await tx.select({ id: aiMissionHandoffsTable.id })
        .from(aiMissionHandoffsTable)
        .where(and(
          eq(aiMissionHandoffsTable.missionId, canonicalMission.id),
          eq(aiMissionHandoffsTable.projectId, mission.projectId),
          eq(aiMissionHandoffsTable.userId, mission.userId),
          eq(aiMissionHandoffsTable.sessionId, proposal.sessionId),
        ))
        .limit(1)
    : [];

  if (
    mission.id === canonicalMission.id
    || lineage.applyMissionId !== mission.id
    || lineage.projectId !== mission.projectId
    || applyPolicy.proposalId !== lineage.proposalId
    || sourceExecution.proposalId !== lineage.proposalId
    || sourceExecution.goalId !== sourceGoal.id
    || sourceGoal.missionId !== canonicalMission.id
    || sourceExecution.sessionId !== proposal.sessionId
    || !proposal.sessionId
    || !handoff
  ) {
    return { kind: "unresolved", reason: "lineage_identity_mismatch" };
  }

  if (!lineage.sourceAcceptanceId) {
    return { kind: "unresolved", reason: "lineage_source_not_accepted" };
  }
  const [sourceAcceptance] = await tx
    .select({
      id: aiExecutionAcceptancesTable.id,
      executionId: aiExecutionAcceptancesTable.executionId,
      projectId: aiExecutionAcceptancesTable.projectId,
      attempt: aiExecutionAcceptancesTable.attempt,
    })
    .from(aiExecutionAcceptancesTable)
    .where(and(
      eq(aiExecutionAcceptancesTable.id, lineage.sourceAcceptanceId),
      eq(aiExecutionAcceptancesTable.executionId, lineage.sourceExecutionId),
      eq(aiExecutionAcceptancesTable.projectId, mission.projectId),
    ))
    .limit(1);
  if (!sourceAcceptance || sourceAcceptance.attempt !== sourceExecution.attempt) {
    return { kind: "unresolved", reason: "lineage_source_not_accepted" };
  }

  if (options.requireAcceptedSource) {
    const acceptance = await checkMissionCandidateAcceptance({
      tx,
      projectId: mission.projectId,
      userId: mission.userId,
      proposal,
      sourceExecution,
      persistedAcceptanceId: lineage.sourceAcceptanceId,
    });
    if (
      !acceptance.accepted
      || acceptance.sourceMissionId !== lineage.canonicalMissionId
      || acceptance.sourceGoalId !== lineage.sourceGoalId
      || acceptance.sourceExecutionId !== lineage.sourceExecutionId
    ) {
      return { kind: "unresolved", reason: "lineage_source_not_accepted" };
    }
  }

  return {
    kind: "verified",
    lineage: {
      applyMissionId: lineage.applyMissionId,
      canonicalMissionId: lineage.canonicalMissionId,
      sourceExecutionId: lineage.sourceExecutionId,
      sourceGoalId: lineage.sourceGoalId,
      proposalId: lineage.proposalId,
    },
  };
}
