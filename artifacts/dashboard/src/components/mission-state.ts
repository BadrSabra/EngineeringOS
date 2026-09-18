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
  | 'NEEDS_ATTENTION'
  | 'INCOMPLETE';

export type MissionState = {
  key: MissionStateKey;
  label: string;
  detail: string;
};

export type MissionStateInput = {
  projection: AiExecutionProjection;
  executionStatus?: string | null;
  flightState?: string | null;
  evidenceVerdict?: string | null;
  resumable?: boolean | null;
};

function normalized(value: unknown): string {
  return typeof value === 'string' ? value.toUpperCase() : '';
}

function phaseMatches(phase: string, ...values: string[]): boolean {
  return values.some((value) => phase.includes(value));
}

/**
 * Reduces the server-owned execution signals to the one state an operator
 * needs first. The raw signals remain available in the technical details.
 */
export function getMissionState(input: MissionStateInput): MissionState {
  const executionStatus = normalized(input.executionStatus);
  const flightState = normalized(input.flightState);
  const evidenceVerdict = normalized(input.evidenceVerdict ?? input.projection.verification?.evidenceVerdict);
  const phase = normalized(input.projection.phase);
  const verification = input.projection.verification?.status;
  const stopped = input.projection.stopped?.outcome;

  if (stopped === 'FAILED' || executionStatus === 'FAILED' || flightState === 'BLOCKED' || verification === 'failed' || evidenceVerdict === 'BLOCKED') {
    return {
      key: 'NEEDS_ATTENTION',
      label: 'Needs attention',
      detail: 'The server recorded a blocked or failed step. Review the proof and use the available recovery action.',
    };
  }

  if (stopped === 'INTERRUPTED' || executionStatus === 'CANCELLED' || executionStatus === 'CANCELLING' || flightState === 'CANCELLED') {
    return {
      key: 'INCOMPLETE',
      label: input.resumable ? 'Paused — resume available' : 'Incomplete',
      detail: input.resumable
        ? 'This mission stopped with a retained checkpoint. Resume the same execution when you are ready.'
        : 'This mission ended before a complete accepted result was recorded.',
    };
  }

  if (input.projection.approval?.required && input.projection.approval.status === 'PENDING') {
    return {
      key: 'AWAITING_APPROVAL',
      label: 'Awaiting approval',
      detail: 'The plan or proposed changes are ready for your review. Nothing will be applied without approval.',
    };
  }

  if (flightState === 'PUSHED') {
    return {
      key: 'DELIVERED',
      label: 'Delivered',
      detail: 'The server recorded the delivered change. The receipt and proof remain available below.',
    };
  }

  if (flightState === 'COMMITTED') {
    return {
      key: 'DELIVERING',
      label: 'Committed — ready to push',
      detail: 'The verified change is committed. Push it only through the matching server-owned delivery action.',
    };
  }

  if (flightState === 'APPLIED') {
    return {
      key: 'DELIVERING',
      label: 'Applied — ready to commit',
      detail: 'The approved change is applied to the project. The next delivery step is still pending.',
    };
  }

  if (flightState === 'READY_FOR_REVIEW' || input.projection.workspace?.diffStatus === 'available' && verification === 'passed') {
    return {
      key: 'READY_FOR_REVIEW',
      label: 'Ready for review',
      detail: 'The server has a reviewable change and recorded validation. Review the diff before delivery.',
    };
  }

  if (verification === 'unavailable' || evidenceVerdict === 'UNAVAILABLE') {
    return {
      key: 'NEEDS_ATTENTION',
      label: 'Needs attention',
      detail: 'The required verification or evidence is not complete. Do not treat this run as accepted.',
    };
  }

  if (verification === 'running' || flightState === 'VALIDATING' || phaseMatches(phase, 'VALIDAT')) {
    return {
      key: 'VALIDATING',
      label: 'Validating',
      detail: 'The server is checking the current result and collecting the evidence needed for acceptance.',
    };
  }

  if (phaseMatches(phase, 'BUILD', 'REPAIR') || flightState === 'BUILDING' || flightState === 'REPAIRING') {
    return {
      key: 'BUILDING',
      label: 'Building',
      detail: 'The mission is preparing a bounded change inside the approved project scope.',
    };
  }

  if (phaseMatches(phase, 'PLAN')) {
    return {
      key: 'PLANNING',
      label: 'Planning',
      detail: 'The server is turning the request into a bounded plan and identifying the files it needs.',
    };
  }

  if (phaseMatches(phase, 'DISCOVER', 'ORIENT', 'EXPLORE', 'READ', 'SEARCH')) {
    return {
      key: 'INVESTIGATING',
      label: 'Investigating',
      detail: 'The mission is reading the project and collecting the source evidence for the request.',
    };
  }

  if (executionStatus === 'QUEUED' || phaseMatches(phase, 'CHAT', 'INTAKE')) {
    return {
      key: 'UNDERSTANDING',
      label: 'Understanding the request',
      detail: 'The server is preparing the mission scope before it starts project work.',
    };
  }

  if (executionStatus === 'COMPLETED' || stopped === 'SUCCEEDED') {
    return {
      key: 'COMPLETE',
      label: 'Complete',
      detail: 'The server recorded a terminal result for this mission.',
    };
  }

  return {
    key: 'INVESTIGATING',
    label: 'Working',
    detail: 'The mission is active. The server will update this state as the next bounded step is recorded.',
  };
}
