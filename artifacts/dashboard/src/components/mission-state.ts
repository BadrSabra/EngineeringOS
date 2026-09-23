import type { AiExecutionProjection } from '@workspace/api-client-react';

export type MissionStateKey =
  | 'UNDERSTANDING'
  | 'INVESTIGATING'
  | 'PLANNING'
  | 'AWAITING_APPROVAL'
  | 'BUILDING'
  | 'VALIDATING'
  | 'READY_FOR_REVIEW'
  | 'DELIVERING'
  | 'DELIVERED'
  | 'COMPLETE'
  | 'NEEDS_REPLAN'
  | 'NEEDS_ATTENTION'
  | 'INCOMPLETE';

export type MissionState = {
  key: MissionStateKey;
  label: string;
  detail: string;
  /** The one server-authorized action that should be visually primary. */
  primaryAction: AiExecutionProjection['allowedActions'][number] | null;
  /** Human-readable instruction shown even when the state is waiting-only. */
  primaryActionLabel: string;
};

export type MissionStateInput = {
  projection: AiExecutionProjection;
  executionStatus?: string | null;
  flightState?: string | null;
  evidenceVerdict?: string | null;
  resumable?: boolean | null;
  nextAction?: string | null;
};

function normalized(value: unknown): string {
  return typeof value === 'string' ? value.toUpperCase() : '';
}

function phaseMatches(phase: string, ...values: string[]): boolean {
  return values.some((value) => phase.includes(value));
}

function withPrimaryAction(
  state: Omit<MissionState, 'primaryAction' | 'primaryActionLabel'>,
  preferredActions: AiExecutionProjection['allowedActions'][number][],
  waitingLabel: string,
  allowedActions: AiExecutionProjection['allowedActions'],
): MissionState {
  const primaryAction = preferredActions.find((action) => allowedActions.includes(action)) ?? null;
  return {
    ...state,
    primaryAction,
    primaryActionLabel: primaryAction ? actionLabel(primaryAction) : waitingLabel,
  };
}

function actionLabel(action: AiExecutionProjection['allowedActions'][number]): string {
  switch (action) {
    case 'CANCEL':
      return 'Stop this run';
    case 'RESUME_CHECKPOINT':
      return 'Resume this execution';
    case 'RETRY_CHECKPOINT':
      return 'Retry the checkpoint';
    case 'START_NEW_RUN':
      return 'Start a new mission';
    case 'REVIEW_PROOF':
      return 'Review the proof';
    case 'REVIEW_DIFF':
      return 'Review the changes';
    case 'APPROVE_CHANGES':
      return 'Approve the changes';
  }
}

/**
 * Reduces the server-owned execution signals to the one state an operator
 * needs first. The raw signals remain available in the technical details.
 */
export function getMissionState(input: MissionStateInput): MissionState {
  const executionStatus = normalized(input.executionStatus);
  const flightState = normalized(input.flightState);
  const evidenceVerdict = normalized(input.evidenceVerdict ?? input.projection.verification?.evidenceVerdict);
  const nextAction = normalized(input.nextAction);
  const phase = normalized(input.projection.phase);
  const verification = input.projection.verification?.status;
  const stopped = input.projection.stopped?.outcome;
  const deliveryCompleted = input.projection.timeline?.some(
    (item) => item.id === 'deliver' && item.status === 'completed',
  ) ?? false;
  const allowedActions = input.projection.allowedActions ?? [];

  if (nextAction.includes('REPLAN')) {
    return withPrimaryAction({
      key: 'NEEDS_REPLAN',
      label: 'Needs replan',
      detail: 'The server kept this execution incomplete and requires a bounded replan before it can continue.',
    }, ['RESUME_CHECKPOINT', 'RETRY_CHECKPOINT', 'REVIEW_PROOF', 'START_NEW_RUN'], 'Review the replan requirement', allowedActions);
  }

  if (stopped === 'FAILED' || executionStatus === 'FAILED' || flightState === 'BLOCKED' || verification === 'failed' || evidenceVerdict === 'BLOCKED') {
    return withPrimaryAction({
      key: 'NEEDS_ATTENTION',
      label: 'Needs attention',
      detail: 'The server recorded a blocked or failed step. Review the proof and use the available recovery action.',
    }, ['REVIEW_PROOF', 'RESUME_CHECKPOINT', 'RETRY_CHECKPOINT', 'START_NEW_RUN'], 'Review the recorded failure', allowedActions);
  }

  if (stopped === 'INTERRUPTED' || executionStatus === 'CANCELLED' || executionStatus === 'CANCELLING' || flightState === 'CANCELLED') {
    return withPrimaryAction({
      key: 'INCOMPLETE',
      label: input.resumable ? 'Paused — resume available' : 'Incomplete',
      detail: input.resumable
        ? 'This mission stopped with a retained checkpoint. Resume the same execution when you are ready.'
        : 'This mission ended before a complete accepted result was recorded.',
    }, ['RESUME_CHECKPOINT', 'RETRY_CHECKPOINT', 'START_NEW_RUN'], 'Start a new mission', allowedActions);
  }

  if (input.projection.approval?.required && input.projection.approval.status === 'PENDING') {
    return withPrimaryAction({
      key: 'AWAITING_APPROVAL',
      label: 'Awaiting approval',
      detail: 'The plan or proposed changes are ready for your review. Nothing will be applied without approval.',
    }, ['APPROVE_CHANGES', 'REVIEW_DIFF', 'REVIEW_PROOF'], 'Review the pending plan', allowedActions);
  }

  if (flightState === 'PUSHED') {
    return withPrimaryAction({
      key: 'DELIVERED',
      label: 'Delivered',
      detail: 'The server recorded the delivered change. The receipt and proof remain available below.',
    }, ['REVIEW_PROOF', 'REVIEW_DIFF'], 'Open the delivery receipt', allowedActions);
  }

  if (deliveryCompleted) {
    return withPrimaryAction({
      key: 'DELIVERED',
      label: 'Delivered',
      detail: 'The server recorded the delivered change. The receipt and proof remain available below.',
    }, ['REVIEW_PROOF', 'REVIEW_DIFF'], 'Open the delivery receipt', allowedActions);
  }

  if (flightState === 'COMMITTED') {
    return withPrimaryAction({
      key: 'DELIVERING',
      label: 'Committed — ready to push',
      detail: 'The verified change is committed. Push it only through the matching server-owned delivery action.',
    }, ['REVIEW_PROOF'], 'Continue delivery from the owning surface', allowedActions);
  }

  if (flightState === 'APPLIED') {
    return withPrimaryAction({
      key: 'DELIVERING',
      label: 'Applied — ready to commit',
      detail: 'The approved change is applied to the project. The next delivery step is still pending.',
    }, ['REVIEW_PROOF'], 'Continue delivery from the owning surface', allowedActions);
  }

  if (flightState === 'READY_FOR_REVIEW' || input.projection.workspace?.diffStatus === 'available' && verification === 'passed') {
    return withPrimaryAction({
      key: 'READY_FOR_REVIEW',
      label: 'Ready for review',
      detail: 'The server has a reviewable change and recorded validation. Review the diff before delivery.',
    }, ['REVIEW_DIFF', 'REVIEW_PROOF'], 'Review the recorded changes', allowedActions);
  }

  if (verification === 'unavailable' || evidenceVerdict === 'UNAVAILABLE') {
    return withPrimaryAction({
      key: 'NEEDS_ATTENTION',
      label: 'Needs attention',
      detail: 'The required verification or evidence is not complete. Do not treat this run as accepted.',
    }, ['REVIEW_PROOF', 'RESUME_CHECKPOINT', 'RETRY_CHECKPOINT', 'START_NEW_RUN'], 'Review the incomplete evidence', allowedActions);
  }

  if (verification === 'running' || flightState === 'VALIDATING' || phaseMatches(phase, 'VALIDAT')) {
    return withPrimaryAction({
      key: 'VALIDATING',
      label: 'Validating',
      detail: 'The server is checking the current result and collecting the evidence needed for acceptance.',
    }, ['CANCEL'], 'Wait for validation to finish', allowedActions);
  }

  if (phaseMatches(phase, 'BUILD', 'REPAIR') || flightState === 'BUILDING' || flightState === 'REPAIRING') {
    return withPrimaryAction({
      key: 'BUILDING',
      label: 'Building',
      detail: 'The mission is preparing a bounded change inside the approved project scope.',
    }, ['CANCEL'], 'Wait for the candidate build', allowedActions);
  }

  if (phaseMatches(phase, 'PLAN')) {
    return withPrimaryAction({
      key: 'PLANNING',
      label: 'Planning',
      detail: 'The server is turning the request into a bounded plan and identifying the files it needs.',
    }, ['CANCEL'], 'Review the plan when it is ready', allowedActions);
  }

  if (phaseMatches(phase, 'DISCOVER', 'ORIENT', 'EXPLORE', 'READ', 'SEARCH')) {
    return withPrimaryAction({
      key: 'INVESTIGATING',
      label: 'Investigating',
      detail: 'The mission is reading the project and collecting the source evidence for the request.',
    }, ['CANCEL'], 'Continue reading project evidence', allowedActions);
  }

  if (executionStatus === 'QUEUED' || phaseMatches(phase, 'CHAT', 'INTAKE')) {
    return withPrimaryAction({
      key: 'UNDERSTANDING',
      label: 'Understanding the request',
      detail: 'The server is preparing the mission scope before it starts project work.',
    }, ['CANCEL'], 'Wait for execution to start', allowedActions);
  }

  if (executionStatus === 'COMPLETED' || stopped === 'SUCCEEDED') {
    return withPrimaryAction({
      key: 'COMPLETE',
      label: 'Complete',
      detail: 'The server recorded a terminal result for this mission.',
    }, ['REVIEW_PROOF', 'REVIEW_DIFF'], 'Open the final receipt', allowedActions);
  }

  return withPrimaryAction({
    key: 'INVESTIGATING',
    label: 'Working',
    detail: 'The mission is active. The server will update this state as the next bounded step is recorded.',
  }, ['CANCEL'], 'Continue the active mission', allowedActions);
}
