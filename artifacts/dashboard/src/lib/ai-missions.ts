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
  dependencies?: GoalDependency[];
}

export interface GoalDependency {
  id: string;
  goalId: string;
  dependsOnGoalId: string;
  planRevision: string;
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

async function requestJson<T>(url: string, init: RequestInit = {}, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, {
    method: 'GET',
    credentials: 'include',
    headers: { Accept: 'application/json', ...(init.headers ?? {}) },
    ...init,
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
  return requestJson<Mission[]>(`/api/ai/missions?${query.toString()}`, {}, signal);
}

export function fetchMissionProjection(missionId: string, signal?: AbortSignal) {
  return requestJson<MissionProjection>(`/api/ai/missions/${encodeURIComponent(missionId)}/projection`, {}, signal);
}

export interface CreateMissionInput {
  projectId: string;
  title: string;
  intent: string;
  status?: Extract<MissionStatus, 'draft' | 'active'>;
  autonomyPolicy?: Record<string, unknown>;
  budget?: Record<string, unknown>;
  deadline?: string | null;
}

export interface UpdateMissionInput {
  title?: string;
  intent?: string;
  status?: MissionStatus;
  autonomyPolicy?: Record<string, unknown>;
  budget?: Record<string, unknown>;
  deadline?: string | null;
}

export interface CreateGoalInput {
  title: string;
  description?: string | null;
  parentGoalId?: string | null;
  priority?: 'p0' | 'p1' | 'p2' | 'p3';
  successCriteria?: Record<string, unknown>;
  evidenceContract?: Record<string, unknown>;
  outcomeContract?: Record<string, unknown>;
  nextAction?: Record<string, unknown>;
  dependsOnGoalIds?: string[];
  planRevision?: string;
}

export interface UpdateGoalInput extends CreateGoalInput {
  status?: GoalStatus;
  blockedReason?: string | null;
  nextWakeAt?: string | null;
}

function jsonRequest(method: 'POST' | 'PATCH', body: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export function createMission(body: CreateMissionInput) {
  return requestJson<Mission>('/api/ai/missions', jsonRequest('POST', body));
}

export interface ChatMissionHandoffInput {
  projectId: string;
  message: string;
  title?: string;
  objective?: string;
  expectedPlanHash?: string;
  sessionId?: string;
  messageId?: string;
}

export interface ChatMissionHandoffResult {
  mission: Mission;
  activation: { goalId: string; taskId: string };
  preview: {
    admission: 'mission';
    admissionReason: string;
    objective: string;
    plan: { planHash: string };
  };
}

export function createMissionFromChat(body: ChatMissionHandoffInput) {
  return requestJson<ChatMissionHandoffResult>(
    '/api/ai/missions/from-chat',
    jsonRequest('POST', body),
  );
}

export interface ReplanMissionInput {
  message?: string;
  objective?: string;
  expectedPlanHash?: string;
  reason?: string;
}

export function replanMission(missionId: string, body: ReplanMissionInput) {
  return requestJson<{
    mission: Mission;
    plan: ChatMissionHandoffResult['preview']['plan'];
    goal: { goalId: string; taskId: string };
    run: { status: string; goalId: string; reason?: string };
  }>(
    `/api/ai/missions/${encodeURIComponent(missionId)}/replan`,
    jsonRequest('POST', body),
  );
}

export function updateMission(missionId: string, body: UpdateMissionInput) {
  return requestJson<Mission>(
    `/api/ai/missions/${encodeURIComponent(missionId)}`,
    jsonRequest('PATCH', body),
  );
}

export function createGoal(missionId: string, body: CreateGoalInput) {
  return requestJson<Goal>(
    `/api/ai/missions/${encodeURIComponent(missionId)}/goals`,
    jsonRequest('POST', body),
  );
}

export function updateGoal(goalId: string, body: UpdateGoalInput) {
  return requestJson<Goal>(
    `/api/ai/goals/${encodeURIComponent(goalId)}`,
    jsonRequest('PATCH', body),
  );
}