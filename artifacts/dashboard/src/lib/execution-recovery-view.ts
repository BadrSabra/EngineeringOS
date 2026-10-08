import type { AiExecutionProjection } from '@workspace/api-client-react';

export type ExecutionRecoveryStatus = {
  status?: string;
  linkedTaskId?: string | null;
  resumable?: boolean;
  proofRequired?: boolean;
  evidenceVerdict?: string | null;
  acceptance?: {
    resumable?: boolean;
    nextActionCode?: string;
  } | null;
  projection?: Pick<AiExecutionProjection, 'allowedActions'> | null;
};

export type ExecutionRecoveryView = {
  title: string;
  detail: string;
  action: 'resume' | 'retry' | null;
  actionLabel: string | null;
  nextStep: string;
};

export function executionCanResume(
  execution: ExecutionRecoveryStatus | null | undefined,
): boolean {
  if (
    !execution
    || execution.linkedTaskId
    || (execution.status !== 'paused' && execution.status !== 'failed')
  ) {
    return false;
  }
  // The durable status response is authoritative. Older records may not
  // contain acceptance or a projection, but an explicit refusal must win.
  return execution.resumable !== false
    && execution.acceptance?.resumable !== false
    && (
      execution.acceptance?.nextActionCode === undefined
      || execution.acceptance.nextActionCode === 'RESUME_ALLOWED'
      || execution.acceptance.nextActionCode === 'RETRY_AFTER_PARSE'
      || execution.acceptance.nextActionCode === 'RETRY_AFTER_TIMEOUT'
      || execution.acceptance.nextActionCode === 'RETRY_AFTER_RATE_LIMIT'
    );
}

export function getExecutionRecoveryView(
  execution: ExecutionRecoveryStatus | null | undefined,
  historical: boolean,
): ExecutionRecoveryView {
  if (historical) {
    return {
      title: 'Historical audit — read-only',
      detail: 'Review the retained execution and proof. Recovery actions belong to the current execution, not this historical view.',
      action: null,
      actionLabel: null,
      nextStep: 'Review the retained proof',
    };
  }
  if (!execution?.status) {
    return {
      title: 'Checking saved execution status',
      detail: 'Waiting for the server before offering a recovery action.',
      action: null,
      actionLabel: null,
      nextStep: 'Wait for the server status',
    };
  }

  if (
    execution.linkedTaskId
    && (execution.status === 'paused' || execution.status === 'failed')
  ) {
    return {
      title: 'Task-owned execution — recover it from Tasks',
      detail: 'This execution is controlled by its Task. Resume or retry it from the owning Task so its lifecycle and remaining budget are checked.',
      action: null,
      actionLabel: null,
      nextStep: 'Open the owning Task in Tasks',
    };
  }

  const actions = execution.projection?.allowedActions;
  const retryAllowed = execution.status === 'failed'
    && actions?.includes('RETRY_CHECKPOINT')
    && (
      !execution.acceptance?.nextActionCode
      || ['RETRY_AFTER_PARSE', 'RETRY_AFTER_TIMEOUT', 'RETRY_AFTER_RATE_LIMIT']
        .includes(execution.acceptance.nextActionCode)
    );
  if (retryAllowed) {
    return {
      title: 'Execution failed — checkpoint retry available',
      detail: 'The server permits retrying this checkpoint in the same execution. Later delivery still follows the owner policy and server gates.',
      action: 'retry',
      actionLabel: 'Retry checkpoint',
      nextStep: 'Retry this execution checkpoint',
    };
  }

  const resumeAllowed = executionCanResume(execution)
    && (!actions || actions.includes('RESUME_CHECKPOINT'));
  if (resumeAllowed) {
    return {
      title: execution.status === 'failed'
        ? 'Execution failed — resume available'
        : 'Saved execution paused — resume available',
      detail: 'Continue this saved execution from its checkpoint. Later delivery still follows the owner policy and server gates.',
      action: 'resume',
      actionLabel: 'Resume execution',
      nextStep: 'Resume this saved execution',
    };
  }

  switch (execution.status) {
    case 'queued':
      return {
        title: 'Execution queued on the server',
        detail: 'The server has not started this execution yet.',
        action: null, actionLabel: null, nextStep: 'Wait for execution to start',
      };
    case 'running':
      return {
        title: 'Execution running on the server',
        detail: 'Progress and proof will update as the server works.',
        action: null, actionLabel: null, nextStep: 'Wait for the current execution',
      };
    case 'cancelling':
      return {
        title: 'Execution cancellation in progress',
        detail: 'Wait for the server to confirm the final outcome.',
        action: null, actionLabel: null, nextStep: 'Wait for the cancellation outcome',
      };
    case 'completed':
      return {
        title: execution.proofRequired && execution.evidenceVerdict !== 'PROVEN'
          ? 'Execution ended — proof not accepted'
          : 'Execution finished — review recorded proof',
        detail: 'Completion of a run is not approval to apply changes. Check the recorded acceptance and evidence.',
        action: null, actionLabel: null, nextStep: 'Review the recorded proof',
      };
    case 'cancelled':
      return {
        title: 'Execution cancelled — review retained proof',
        detail: 'The execution stopped. Review its retained audit before deciding whether to start a new run.',
        action: null, actionLabel: null, nextStep: 'Review the retained audit',
      };
    case 'paused':
    case 'failed':
      return {
        title: 'Execution ended — start a new run',
        detail: 'The server has not authorized resuming this execution. Review its proof before starting a separate run.',
        action: null, actionLabel: null, nextStep: 'Review proof or start a new run',
      };
    default:
      return {
        title: 'Checking execution outcome',
        detail: 'This status does not authorize a recovery action. Review the server record.',
        action: null, actionLabel: null, nextStep: 'Review the server status',
      };
  }
}