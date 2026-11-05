import { useRef, useState } from 'react';
import type { AiStreamBehaviorProgressEvent } from '@workspace/api-client-react';
import type { LiveAgentActivityEvent } from './live-activity';

export function useLiveActivity() {
  const [activityEvents, setActivityEvents] = useState<LiveAgentActivityEvent[]>([]);
  const activityEventsRef = useRef<LiveAgentActivityEvent[]>([]);
  const nextActivityIdRef = useRef(0);
  const [behaviorProgress, setBehaviorProgress] = useState<AiStreamBehaviorProgressEvent | null>(null);

  function clearActivityEvents() {
    nextActivityIdRef.current = 0;
    activityEventsRef.current = [];
    setActivityEvents([]);
    setBehaviorProgress(null);
  }

  function appendActivityEvent(
    event: Omit<LiveAgentActivityEvent, 'id'>,
  ): number {
    const id = nextActivityIdRef.current++;
    const next = [
      ...activityEventsRef.current,
      { ...event, id },
    ].slice(-160);
    activityEventsRef.current = next;
    setActivityEvents(next);
    return id;
  }

  function completeActiveToolActivity(
    toolCallId: string | undefined,
    tool: string,
    source?: string,
    cached?: boolean,
  ) {
    const targetIndex = [...activityEventsRef.current].reverse().findIndex(
      (activity) => activity.kind === 'tool' && activity.status === 'active'
        && activity.tool === tool
        && (!toolCallId || activity.toolCallId === toolCallId),
    );
    if (targetIndex < 0) return;
    const index = activityEventsRef.current.length - 1 - targetIndex;
    const next = activityEventsRef.current.map((activity, activityIndex) => activityIndex === index
      ? {
          ...activity,
          status: 'done' as const,
          detail: source
            ? `${cached ? 'cached · ' : ''}${source}`
            : cached ? 'cached' : activity.detail,
        }
      : activity);
    activityEventsRef.current = next;
    setActivityEvents(next);
  }

  return {
    activityEvents,
    activityEventsRef,
    behaviorProgress,
    setBehaviorProgress,
    clearActivityEvents,
    appendActivityEvent,
    completeActiveToolActivity,
  };
}
