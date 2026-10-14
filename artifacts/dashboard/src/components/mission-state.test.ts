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
  it('keeps state precedence and action authority independent of Arabic labels', () => {
    const actions: AiExecutionProjection['allowedActions'] = [
      'CANCEL', 'RESUME_CHECKPOINT', 'RETRY_CHECKPOINT', 'START_NEW_RUN',
      'REVIEW_PROOF', 'REVIEW_DIFF', 'APPROVE_CHANGES',
    ];
    const cases = [
      { status: 'running', phase: 'CHAT', key: 'UNDERSTANDING' },
      { status: 'running', phase: 'READ', key: 'INVESTIGATING' },
      { status: 'running', phase: 'PLAN', key: 'PLANNING' },
      { status: 'running', phase: 'BUILD', key: 'BUILDING' },
      { status: 'running', phase: 'VALIDATE', key: 'VALIDATING' },
      { status: 'failed', phase: 'BUILD', key: 'NEEDS_ATTENTION' },
      { status: 'cancelled', phase: 'BUILD', key: 'INCOMPLETE' },
      { status: 'completed', phase: 'BUILD', key: 'NEEDS_ATTENTION' },
    ];
    for (const scenario of cases) {
      for (let mask = 0; mask < 1 << actions.length; mask += 1) {
        const allowedActions = actions.filter((_, index) => mask & (1 << index));
        const state = getMissionState({
          projection: { ...baseProjection, phase: scenario.phase, allowedActions },
          executionStatus: scenario.status,
        });
        expect(state.key).toBe(scenario.key);
        expect(state.label).toMatch(/[\u0600-\u06ff]/);
        expect(state.detail).toMatch(/[\u0600-\u06ff]/);
        expect(state.primaryActionLabel).toMatch(/[\u0600-\u06ff]/);
        if (state.primaryAction) expect(allowedActions).toContain(state.primaryAction);
      }
    }
  });

  it.each(['CHAT', 'INTAKE', 'READ', 'PLAN', 'BUILD', 'VALIDATE'])(
    'does not let a retained %s phase hide a completed accepted execution',
    (phase) => {
      expect(getMissionState({
        projection: {
          ...baseProjection,
          phase,
          verification: { ...baseProjection.verification, status: 'passed', evidenceVerdict: 'PROVEN' },
        },
        executionStatus: 'completed',
        evidenceVerdict: 'PROVEN',
      }).key).toBe('COMPLETE');
    },
  );

  it('keeps unavailable verification ahead of a terminal completion label', () => {
    expect(getMissionState({
      projection: {
        ...baseProjection,
        phase: 'CHAT',
        verification: { status: 'unavailable', evidenceVerdict: 'UNAVAILABLE', proofRequired: false },
      },
      executionStatus: 'completed',
    }).key).toBe('NEEDS_ATTENTION');
  });

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
    })).toMatchObject({ key: 'DELIVERED', label: 'سُجّل التسليم' });
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
    })).toMatchObject({ key: 'DELIVERED', label: 'سُجّل التسليم' });
  });

  it('does not present a completed execution as accepted when required proof is missing', () => {
    expect(getMissionState({
      projection: baseProjection,
      executionStatus: 'completed',
      evidenceVerdict: 'NOT_RECORDED',
    })).toMatchObject({ key: 'NEEDS_ATTENTION', label: 'الإثبات المطلوب غير مكتمل' });
  });

  it('does not present delivery as verified when required proof is missing', () => {
    expect(getMissionState({
      projection: {
        ...baseProjection,
        timeline: [{
          id: 'deliver',
          label: 'Deliver to Git',
          status: 'completed',
          detail: null,
        }],
      },
      executionStatus: 'completed',
      flightState: 'PUSHED',
      evidenceVerdict: 'NOT_RECORDED',
    })).toMatchObject({ key: 'NEEDS_ATTENTION', label: 'الإثبات المطلوب غير مكتمل' });
  });

  it('preserves successful terminal display when proof is not required', () => {
    expect(getMissionState({
      projection: {
        ...baseProjection,
        phase: 'COMPLETE',
        verification: { ...baseProjection.verification, proofRequired: false },
      },
      executionStatus: 'completed',
    })).toMatchObject({ key: 'COMPLETE', label: 'انتهى بحسب السجل' });
  });

  it('makes an interrupted run incomplete rather than successful', () => {
    expect(getMissionState({
      projection: { ...baseProjection, stopped: { reason: 'cancelled', outcome: 'INTERRUPTED' } },
      executionStatus: 'cancelled',
      flightState: 'CANCELLED',
      resumable: true,
    })).toMatchObject({ key: 'INCOMPLETE', label: 'متوقف — يمكن استئنافه' });
  });

  it('surfaces a server-owned replan requirement after reconnect', () => {
    expect(getMissionState({
      projection: baseProjection,
      executionStatus: 'completed',
      flightState: 'BLOCKED',
      nextAction: 'NEEDS_REPLAN',
    })).toMatchObject({ key: 'NEEDS_REPLAN', label: 'يحتاج تعديل الخطة' });
  });
});