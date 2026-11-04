import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useLiveActivity } from './use-live-activity';

describe('useLiveActivity', () => {
  it('assigns ordered IDs and retains only the newest 160 events', () => {
    const { result } = renderHook(() => useLiveActivity());

    act(() => {
      for (let index = 0; index < 162; index += 1) {
        result.current.appendActivityEvent({
          kind: 'stage',
          label: `Stage ${index}`,
          status: 'info',
        });
      }
    });

    expect(result.current.activityEvents).toHaveLength(160);
    expect(result.current.activityEvents[0]).toMatchObject({ id: 2, label: 'Stage 2' });
    expect(result.current.activityEvents.at(-1)).toMatchObject({ id: 161, label: 'Stage 161' });
    expect(result.current.activityEventsRef.current).toEqual(result.current.activityEvents);
  });

  it('completes the most recent active event for a tool with its source detail', () => {
    const { result } = renderHook(() => useLiveActivity());

    act(() => {
      result.current.appendActivityEvent({
        kind: 'tool',
        label: 'First read',
        tool: 'read_file',
        status: 'active',
      });
      result.current.appendActivityEvent({
        kind: 'tool',
        label: 'Second read',
        tool: 'read_file',
        status: 'active',
      });
      result.current.completeActiveToolActivity('read_file', 'src/main.ts', true);
    });

    expect(result.current.activityEvents[0]).toMatchObject({ status: 'active' });
    expect(result.current.activityEvents[1]).toMatchObject({
      status: 'done',
      detail: 'cached · src/main.ts',
    });
  });

  it('resets event IDs and live behavior progress when cleared', () => {
    const { result } = renderHook(() => useLiveActivity());

    act(() => {
      result.current.appendActivityEvent({ kind: 'stage', label: 'Before', status: 'info' });
      result.current.clearActivityEvents();
      result.current.appendActivityEvent({ kind: 'stage', label: 'After', status: 'info' });
    });

    expect(result.current.activityEvents).toEqual([
      { id: 0, kind: 'stage', label: 'After', status: 'info' },
    ]);
    expect(result.current.behaviorProgress).toBeNull();
  });
});
