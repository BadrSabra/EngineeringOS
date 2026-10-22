import { describe, expect, it } from 'vitest';
import type { MissionProjection } from './ai-missions';
import { shouldPollMissionProjection } from './ai-missions';

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
