import type { AiExecutionProjection } from '@workspace/api-client-react';
import { describe, expect, it } from 'vitest';
import { getMissionState } from './mission-state';

const baseProjection: AiExecutionProjection = {
  schemaVersion: 2,
  kind: 'DELIVERY',
  phase: 'BUILD',
  objective: 'Update the dashboard',
  progress: { percent: 40, label: 'Building', currentStep: 'Edit files', completedSteps: 1, totalSteps: 3 },
  plan: { steps: [], currentStepId: null },
  tools: { totalCalls: 0, activeTool: null, recent: [] },
  workspace: { changedFiles: [], diffStatus: 'not_available' },
  verification: { status: 'pending', evidenceVerdict: 'NOT_RECORDED', proofRequired: true },
  approval: { required: false, status: 'NOT_REQUIRED', proposalId: null },
  stopped: { reason: null, outcome: null },
  timeline: [],
  allowedActions: [],
};

describe('getMissionState', () => {
  it('prefers a server-owned blocked result over an otherwise active phase', () => {
    expect(getMissionState({
      projection: { ...baseProjection, verification: { ...baseProjection.verification, status: 'failed' } },
      executionStatus: 'completed',
      flightState: 'BLOCKED',
    }).key).toBe('NEEDS_ATTENTION');
  });

  it('keeps approval as the primary operator state before delivery', () => {
    expect(getMissionState({
      projection: { ...baseProjection, approval: { required: true, status: 'PENDING', proposalId: 'proposal-1' } },
      executionStatus: 'running',
      flightState: 'BUILDING',
    }).key).toBe('AWAITING_APPROVAL');
  });

  it('uses the delivery lifecycle when the durable flight state is available', () => {
    expect(getMissionState({
      projection: baseProjection,
      executionStatus: 'completed',
      flightState: 'PUSHED',
      evidenceVerdict: 'PROVEN',
    })).toMatchObject({ key: 'DELIVERED', label: 'Delivered' });
  });

  it('prefers a completed delivery timeline over a reviewable workspace snapshot', () => {
    expect(getMissionState({
      projection: {
        ...baseProjection,
        verification: { ...baseProjection.verification, status: 'passed' },
        workspace: { changedFiles: ['src/feature.ts'], diffStatus: 'available' },
        timeline: [{
          id: 'deliver',
          label: 'Deliver to Git',
          status: 'completed',
          detail: null,
        }],
      },
      executionStatus: 'completed',
      flightState: 'COMPLETED',
      evidenceVerdict: 'PROVEN',
    })).toMatchObject({ key: 'DELIVERED', label: 'Delivered' });
  });

  it('makes an interrupted run incomplete rather than successful', () => {
    expect(getMissionState({
      projection: { ...baseProjection, stopped: { reason: 'cancelled', outcome: 'INTERRUPTED' } },
      executionStatus: 'cancelled',
      flightState: 'CANCELLED',
      resumable: true,
    })).toMatchObject({ key: 'INCOMPLETE', label: 'Paused — resume available' });
  });

  it('surfaces a server-owned replan requirement after reconnect', () => {
    expect(getMissionState({
      projection: baseProjection,
      executionStatus: 'completed',
      flightState: 'BLOCKED',
      nextAction: 'NEEDS_REPLAN',
    })).toMatchObject({ key: 'NEEDS_REPLAN', label: 'Needs replan' });
  });
});