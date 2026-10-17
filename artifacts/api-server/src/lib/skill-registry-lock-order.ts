import { and, eq } from "drizzle-orm";
import {
  aiChangeProposalsTable,
  aiExecutionsTable,
  db,
} from "@workspace/db";

type SkillRegistryTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

type LockedExecutionIdentity = {
  id: string;
  projectId: string;
  goalId: string | null;
};

export type SkillRegistryOrderedLockResult =
  | {
      kind: "locked";
      executions: ReadonlyMap<string, LockedExecutionIdentity>;
      proposal: typeof aiChangeProposalsTable.$inferSelect;
    }
  | { kind: "execution_not_found" | "proposal_not_found" };

/**
 * Skill proof validation and Apply finalization share these rows. Finalization
 * owns Execution before Proposal, so the registry gate must acquire its proof
 * executions first, in a stable order, before locking the Proposal.
 */
export async function lockSkillRegistryExecutionsThenProposal(
  tx: SkillRegistryTransaction,
  input: {
    projectId: string;
    executionIds: readonly string[];
    proposalId: string;
  },
): Promise<SkillRegistryOrderedLockResult> {
  const executionIds = [...new Set(input.executionIds)].sort();
  if (executionIds.length === 0) return { kind: "execution_not_found" };

  const executions = new Map<string, LockedExecutionIdentity>();
  for (const executionId of executionIds) {
    const [execution] = await tx
      .select({
        id: aiExecutionsTable.id,
        projectId: aiExecutionsTable.projectId,
        goalId: aiExecutionsTable.goalId,
      })
      .from(aiExecutionsTable)
      .where(and(
        eq(aiExecutionsTable.id, executionId),
        eq(aiExecutionsTable.projectId, input.projectId),
      ))
      .for("update")
      .limit(1);
    if (!execution) return { kind: "execution_not_found" };
    executions.set(execution.id, execution);
  }

  const [proposal] = await tx
    .select()
    .from(aiChangeProposalsTable)
    .where(and(
      eq(aiChangeProposalsTable.id, input.proposalId),
      eq(aiChangeProposalsTable.projectId, input.projectId),
    ))
    .for("update")
    .limit(1);
  if (!proposal) return { kind: "proposal_not_found" };

  return { kind: "locked", executions, proposal };
}
