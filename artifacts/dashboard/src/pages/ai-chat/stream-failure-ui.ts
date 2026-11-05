export type FailedStreamUiActions = {
  setAgentStage: (value: string | null) => void;
  clearProjectQueryRetryMessage: () => void;
  clearStreamingContent: () => void;
  clearAgentSteps: () => void;
  clearAgentIter: () => void;
  clearAgentModel: () => void;
  setAgentStartedAt: (value: number | null) => void;
  clearAgentElapsedSeconds: () => void;
  clearAgentModelHistory: () => void;
  clearAgentDiagnostics: () => void;
  disableLiveFixture: () => void;
  clearLiveEvidenceIntegrity: () => void;
  clearLiveVerdictScope: () => void;
};

/**
 * Reset only failed-stream presentation. The caller must first pass its
 * ownership fence and decide that reconnect/recovery will not continue.
 */
export function clearFailedStreamUi(actions: FailedStreamUiActions): void {
  actions.setAgentStage(null);
  actions.clearProjectQueryRetryMessage();
  actions.clearStreamingContent();
  actions.clearAgentSteps();
  actions.clearAgentIter();
  actions.clearAgentModel();
  actions.setAgentStartedAt(null);
  actions.clearAgentElapsedSeconds();
  actions.clearAgentModelHistory();
  actions.clearAgentDiagnostics();
  actions.disableLiveFixture();
  actions.clearLiveEvidenceIntegrity();
  actions.clearLiveVerdictScope();
}
