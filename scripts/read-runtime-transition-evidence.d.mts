export interface RuntimeTransitionEvidenceInput {
  databaseUrl?: string;
  missionId: string;
  projectId: string;
  runtimeStartGoalId: string;
  targetGoalId: string;
}

export function readRuntimeTransitionEvidence(
  input: RuntimeTransitionEvidenceInput,
): unknown;
