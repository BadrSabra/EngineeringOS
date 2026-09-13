/**
 * Shared wire-level contract for all handwritten AI SSE endpoints.
 *
 * The event payload shapes remain owned by the dashboard's discriminated
 * TypeScript union, but framing and event-type admission live here so server
 * writers and browser readers cannot silently drift on the transport format.
 */

export const AI_STREAM_EVENT_TYPES = [
  "execution_started",
  "execution_nodes",
  "recipe_node_progress",
  "capability_gap",
  "stage",
  "delta",
  "intent",
  "audit_state",
  "behavior_progress",
  "verification",
  "session_started",
  "scan_started",
  "scan_progress",
  "scan_completed",
  "done",
  "error",
  "stream_reset",
  "tool_call",
  "tool_result",
  "plan_activity",
  "validation",
  "repair_state",
  "model_call",
  "thinking",
  "execution_guard",
  "synthesis_start",
  "execution_diagnostic",
  "forensic_status",
  "forensic_terminal",
  "production_trace",
  "cross_file_trace",
  "evidence_integrity",
  "decision_trace",
  "task_started",
  "task_progress",
  "task_done",
] as const;

export type AiStreamEventType = (typeof AI_STREAM_EVENT_TYPES)[number];

const EVENT_TYPE_SET = new Set<string>(AI_STREAM_EVENT_TYPES);

export function serializeAiSseEvent(event: unknown): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export function parseAiSseEvent(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const event = value as Record<string, unknown>;
  return typeof event.type === "string" && EVENT_TYPE_SET.has(event.type)
    ? event
    : null;
}

export function parseAiSseDataLine(line: string): Record<string, unknown> | null {
  if (!line.startsWith("data: ")) return null;
  try {
    return parseAiSseEvent(JSON.parse(line.slice("data: ".length)));
  } catch {
    return null;
  }
}