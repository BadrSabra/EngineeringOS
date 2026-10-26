import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MissionProjection } from './ai-missions';
import {
  executeMissionAgentAction,
  MissionRequestError,
  shouldPollMissionProjection,
} from './ai-missions';

afterEach(() => {
  vi.unstubAllGlobals();
});

function projection(
  missionStatus: MissionProjection['mission']['status'],
  state: MissionProjection['engineeringAgent']['state'],
): MissionProjection {
  return {
    mission: { status: missionStatus } as MissionProjection['mission'],
    engineeringAgent: { state } as MissionProjection['engineeringAgent'],
  } as MissionProjection;
}

describe('shouldPollMissionProjection', () => {
  it('continues refreshing a completed Mission while delivery is still pending', () => {
    expect(shouldPollMissionProjection(projection('completed', 'DELIVERING'))).toBe(true);
  });

  it('stops refreshing after the Mission reaches its stable completed projection', () => {
    expect(shouldPollMissionProjection(projection('completed', 'COMPLETE'))).toBe(false);
  });

  it('keeps refreshing an active Mission while it is planning', () => {
    expect(shouldPollMissionProjection(projection('active', 'PLANNING'))).toBe(true);
  });

  it('refreshes recovery even when the Mission status is waiting', () => {
    expect(shouldPollMissionProjection(projection('waiting', 'RECOVERING'))).toBe(true);
  });

  it('does not start polling before a projection has loaded', () => {
    expect(shouldPollMissionProjection(undefined)).toBe(false);
  });
});

describe('executeMissionAgentAction errors', () => {
  it('preserves a nested rejection message and code from the API', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: {
        code: 'mission_requires_replan',
        message: 'The current Mission requires a replan.',
      },
    }), {
      status: 409,
      headers: { 'content-type': 'application/json' },
    })));

    await expect(executeMissionAgentAction('mission-1', {
      idempotencyKey: 'test-key',
      expectedDecision: {
        kind: 'APPROVE',
        target: { kind: 'goal', id: 'goal-1' },
        reasonCode: 'approval_pending',
      },
    })).rejects.toMatchObject({
      name: 'MissionRequestError',
      status: 409,
      code: 'mission_requires_replan',
      message: 'The current Mission requires a replan.',
    } satisfies Partial<MissionRequestError>);
  });
});
