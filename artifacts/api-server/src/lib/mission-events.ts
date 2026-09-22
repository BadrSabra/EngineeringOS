export const MISSION_EVENT_SCHEMA_VERSION = 1 as const;

export type MissionEventEnvelope = {
  schemaVersion: typeof MISSION_EVENT_SCHEMA_VERSION;
  eventId: string;
  type: string;
  projectId: string;
  goalId?: string | null;
  workflowId?: string | null;
  planRevision?: string | null;
  correlationId?: string | null;
  payload?: Record<string, unknown>;
};

/**
 * Builds the small server-owned envelope used when a durable event may wake a
 * Mission Goal. Event payloads remain data; target and revision binding are
 * checked by the wake operation before any Goal is changed.
 */
export function createMissionEventEnvelope(params: Omit<MissionEventEnvelope, "schemaVersion">): MissionEventEnvelope {
  return {
    schemaVersion: MISSION_EVENT_SCHEMA_VERSION,
    ...params,
  };
}