import { canonicalJsonHash } from "@workspace/ai-orchestrator";
import type { MissionStrategyPlanOutcomeEvaluation } from "@workspace/ai-orchestrator";

export function missionOutcomeSnapshotId(
  decisionId: string,
  evaluation: MissionStrategyPlanOutcomeEvaluation,
): string {
  const { evaluatedAt: _evaluatedAt, ...stableEvaluation } = evaluation;
  return `mission-outcome-snapshot:${canonicalJsonHash({
    decisionId,
    evidenceSetHash: evaluation.evidenceSetHash,
    evaluation: stableEvaluation,
  } as Parameters<typeof canonicalJsonHash>[0])}`;
}
