export type MissionStatus =
  | 'draft'
  | 'active'
  | 'waiting'
  | 'blocked'
  | 'needs_replan'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type GoalStatus =
  | 'queued'
  | 'planning'
  | 'running'
  | 'waiting_for_event'
  | 'waiting_for_approval'
  | 'verifying'
  | 'needs_replan'
  | 'completed'
  | 'blocked'
  | 'failed'
  | 'cancelled';

export interface Mission {
  id: string;
  projectId: string;
  userId: string;
  title: string;
  intent: string;
  status: MissionStatus;
  scope: unknown;
  autonomyPolicy: unknown;
  budget: unknown;
  deadline: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface Goal {
  id: string;
  missionId: string;
  projectId: string;
  parentGoalId: string | null;
  title: string;
  description: string | null;
  status: GoalStatus;
  priority: string | number | null;
  successCriteria: unknown;
  evidenceContract: unknown;
  outcomeContract: unknown;
  nextAction: unknown;
  blockedReason: string | null;
  nextWakeAt: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface ProjectionTask {
  id: string;
  title: string;
  status: string;
  priority: string | number | null;
  phase: string | null;
  updatedAt: string;
  completedAt: string | null;
}

export interface ProjectionWorkflow {
  id: string;
  name: string;
  status: string;
  currentPhase: string | null;
  updatedAt: string;
}

export interface ProjectionExecution {
  id: string;
  status: string;
  attempt: number;
  operationId: string | null;
  updatedAt: string;
  completedAt: string | null;
}

export interface ProjectionEvent {
  id: string;
  type: string;
  severity: string;
  message: string;
  correlationId: string | null;
  timestamp: string;
}

export interface MissionProjection {
  mission: Mission;
  goals: Array<{
    goal: Goal;
    tasks: ProjectionTask[];
    workflows: ProjectionWorkflow[];
    executions: ProjectionExecution[];
    events: ProjectionEvent[];
  }>;
  counts: {
    goals: number;
    tasks: number;
    workflows: number;
    executions: number;
    events: number;
  };
}

export class MissionRequestError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'MissionRequestError';
    this.status = status;
  }
}

async function requestJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, {
    method: 'GET',
    credentials: 'include',
    headers: { Accept: 'application/json' },
    signal,
  });

  if (!response.ok) {
    let detail = '';
    try {
      const body = (await response.json()) as { message?: string; error?: string };
      detail = body.message ?? body.error ?? '';
    } catch {
      detail = '';
    }
    throw new MissionRequestError(
      response.status,
      detail || `Request failed with status ${response.status}.`,
    );
  }

  return (await response.json()) as T;
}

export function fetchMissions(projectId: string, signal?: AbortSignal) {
  const query = new URLSearchParams({ projectId });
  return requestJson<Mission[]>(`/api/ai/missions?${query.toString()}`, signal);
}

export function fetchMissionProjection(missionId: string, signal?: AbortSignal) {
  return requestJson<MissionProjection>(`/api/ai/missions/${encodeURIComponent(missionId)}/projection`, signal);
}