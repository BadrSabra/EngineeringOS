import { and, eq } from "drizzle-orm";
import {
  aiAgentEpisodesTable,
  aiExecutionsTable,
  db,
} from "@workspace/db";

type EpisodeExecutionTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type EpisodeExecutionLockResult =
  | {
      kind: "locked";
      episode: typeof aiAgentEpisodesTable.$inferSelect;
      execution: typeof aiExecutionsTable.$inferSelect;
    }
  | { kind: "episode_not_found" | "execution_not_found" | "episode_changed" };

/**
 * Lock the execution before its episode. Acceptance finalization holds the
 * execution row before it closes an episode; reversing this order can deadlock
 * with a proof reader on the same completed attempt.
 */
export async function lockEpisodeExecutionPair(
  tx: EpisodeExecutionTransaction,
  input: { projectId: string; episodeId: string },
): Promise<EpisodeExecutionLockResult> {
  const [identity] = await tx
    .select({ executionId: aiAgentEpisodesTable.executionId })
    .from(aiAgentEpisodesTable)
    .where(and(
      eq(aiAgentEpisodesTable.id, input.episodeId),
      eq(aiAgentEpisodesTable.projectId, input.projectId),
    ))
    .limit(1);
  if (!identity) return { kind: "episode_not_found" };

  const [execution] = await tx
    .select()
    .from(aiExecutionsTable)
    .where(and(
      eq(aiExecutionsTable.id, identity.executionId),
      eq(aiExecutionsTable.projectId, input.projectId),
    ))
    .for("update")
    .limit(1);
  if (!execution) return { kind: "execution_not_found" };

  const [episode] = await tx
    .select()
    .from(aiAgentEpisodesTable)
    .where(and(
      eq(aiAgentEpisodesTable.id, input.episodeId),
      eq(aiAgentEpisodesTable.projectId, input.projectId),
      eq(aiAgentEpisodesTable.executionId, identity.executionId),
    ))
    .for("update")
    .limit(1);
  if (!episode || episode.executionId !== execution.id) {
    return { kind: "episode_changed" };
  }

  return { kind: "locked", episode, execution };
}
