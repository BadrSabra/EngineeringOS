import type { ExecutionRecoveryStatus } from '@/lib/execution-recovery-view';

export type StreamResetExecution = {
  id: string;
  sessionId?: string;
};

export type StreamResetStatus = ExecutionRecoveryStatus & {
  id: string;
  sessionId?: string | null;
};

type StreamResetActions = {
  isCurrent: () => boolean;
  getActiveExecution: () => StreamResetExecution | null;
  refetchStatus: () => Promise<{ data?: StreamResetStatus }>;
  clearLiveState: () => void;
  setAgentStage: (stage: string | null) => void;
  executionCanResume: (status: ExecutionRecoveryStatus | null | undefined) => boolean;
  onTerminalStatus: (status: StreamResetStatus, execution: StreamResetExecution) => void;
};

/**
 * Reconcile a recoverable transport reset with the durable execution status.
 * This callback can update presentation, but never decides execution proof or
 * terminal acceptance; those remain owned by the server and AiChat lifecycle.
 */
export function createStreamResetCallback({
  isCurrent,
  getActiveExecution,
  refetchStatus,
  clearLiveState,
  setAgentStage,
  executionCanResume,
  onTerminalStatus,
}: StreamResetActions): () => void {
  return () => {
    if (!isCurrent()) return;

    clearLiveState();
    setAgentStage('Connection interrupted — checking the saved execution…');
    const execution = getActiveExecution();
    if (!execution) return;

    void refetchStatus()
      .then(({ data: status }) => {
        if (!isCurrent() || !status || status.id !== execution.id) return;

        if (status.status === 'completed' || status.status === 'cancelled') {
          onTerminalStatus(status, execution);
          setAgentStage(
            status.status === 'completed'
              ? 'Execution completed — restoring the saved result…'
              : 'Execution cancelled — restoring the saved result…',
          );
        } else if (status.status === 'paused' || status.status === 'failed') {
          setAgentStage(
            executionCanResume(status)
              ? 'Execution saved — ready to resume'
              : 'Execution ended — start a new run',
          );
        } else {
          setAgentStage('Execution is still running on the server…');
        }
      })
      .catch(() => {
        if (isCurrent()) {
          setAgentStage('Connection interrupted — the server is still being checked…');
        }
      });
  };
}
