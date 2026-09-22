import { useEffect, useMemo, useState } from 'react';
import { getListProjectsQueryKey, useListProjects } from '@workspace/api-client-react';
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  Clock3,
  Code2,
  GitBranch,
  Layers3,
  ListChecks,
  RefreshCw,
  ShieldAlert,
  TimerReset,
  Workflow,
  XCircle,
} from 'lucide-react';
import {
  fetchMissionProjection,
  fetchMissions,
  Mission,
  MissionProjection,
  MissionRequestError,
  ProjectionEvent,
  ProjectionExecution,
  ProjectionTask,
  ProjectionWorkflow,
} from '@/lib/ai-missions';

function formatDate(value: string | null | undefined, includeTime = false) {
  if (!value) return 'Not set';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, includeTime
    ? { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }
    : { month: 'short', day: 'numeric', year: 'numeric' });
}

function compactId(value: string) {
  return value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}

function displayJsonValue(value: unknown, fallback: string) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return fallback;
  }
}

function errorStatus(error: unknown) {
  return error instanceof MissionRequestError ? error.status : null;
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

function normalizeProjection(value: MissionProjection): MissionProjection {
  const goals = Array.isArray(value?.goals)
    ? value.goals.filter((item) => item && item.goal).map((item) => ({
        ...item,
        tasks: Array.isArray(item.tasks) ? item.tasks : [],
        workflows: Array.isArray(item.workflows) ? item.workflows : [],
        executions: Array.isArray(item.executions) ? item.executions : [],
        events: Array.isArray(item.events) ? item.events : [],
      }))
    : [];
  const returnedTasks = goals.reduce((sum, item) => sum + item.tasks.length, 0);
  const returnedWorkflows = goals.reduce((sum, item) => sum + item.workflows.length, 0);
  const returnedExecutions = goals.reduce((sum, item) => sum + item.executions.length, 0);
  const returnedEvents = goals.reduce((sum, item) => sum + item.events.length, 0);
  return {
    ...value,
    goals,
    counts: {
      goals: value?.counts?.goals ?? goals.length,
      tasks: value?.counts?.tasks ?? returnedTasks,
      workflows: value?.counts?.workflows ?? returnedWorkflows,
      executions: value?.counts?.executions ?? returnedExecutions,
      events: value?.counts?.events ?? returnedEvents,
    },
  };
}

function statusTone(status: string) {
  if (['active', 'running', 'verifying', 'completed'].includes(status)) {
    return 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300';
  }
  if (['blocked', 'failed', 'cancelled', 'needs_replan'].includes(status)) {
    return 'border-rose-400/25 bg-rose-400/10 text-rose-300';
  }
  if (['waiting', 'waiting_for_event', 'waiting_for_approval'].includes(status)) {
    return 'border-amber-300/25 bg-amber-300/10 text-amber-200';
  }
  return 'border-slate-400/20 bg-slate-400/10 text-slate-300';
}

function StatusPill({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] ${statusTone(status)}`}>
      {status}
    </span>
  );
}

function Metric({ label, value, accent = 'text-slate-100' }: { label: string; value: number | string; accent?: string }) {
  return (
    <div className="border-l border-slate-700/70 pl-3 first:border-l-0 first:pl-0">
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-slate-500">{label}</p>
      <p className={`mt-1 font-mono text-lg font-semibold ${accent}`}>{value}</p>
    </div>
  );
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-slate-800/80 ${className}`} />;
}

function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof Layers3;
  title: string;
  description: string;
}) {
  return (
    <div className="flex min-h-56 flex-col items-center justify-center px-6 text-center">
      <div className="mb-4 rounded-xl border border-slate-700 bg-slate-800/40 p-3 text-slate-500">
        <Icon className="h-5 w-5" />
      </div>
      <h3 className="text-sm font-semibold text-slate-200">{title}</h3>
      <p className="mt-1 max-w-xs text-xs leading-5 text-slate-500">{description}</p>
    </div>
  );
}

function ErrorState({
  title,
  message,
  forbidden = false,
  onRetry,
}: {
  title: string;
  message: string;
  forbidden?: boolean;
  onRetry: () => void;
}) {
  return (
    <div className="flex min-h-56 flex-col items-center justify-center px-6 text-center">
      <div className="mb-4 rounded-xl border border-rose-400/20 bg-rose-400/10 p-3 text-rose-300">
        {forbidden ? <ShieldAlert className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
      </div>
      <h3 className="text-sm font-semibold text-slate-200">{title}</h3>
      <p className="mt-1 max-w-sm text-xs leading-5 text-slate-500">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        data-testid="button-retry-missions"
        className="mt-4 inline-flex items-center gap-2 rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 transition-colors hover:border-cyan-400/50 hover:bg-slate-700"
      >
        <RefreshCw className="h-3.5 w-3.5" />
        Try again
      </button>
    </div>
  );
}

function CollectionLine({
  icon: Icon,
  label,
  value,
  empty,
}: {
  icon: typeof Code2;
  label: string;
  value: string;
  empty?: boolean;
}) {
  return (
    <div className="flex items-start gap-2.5 border-b border-slate-800/80 py-2.5 last:border-b-0">
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" />
      <div className="min-w-0">
        <p className="font-mono text-[10px] uppercase tracking-[0.13em] text-slate-600">{label}</p>
        <p className={`mt-0.5 truncate text-xs ${empty ? 'text-slate-600' : 'text-slate-300'}`}>{value}</p>
      </div>
    </div>
  );
}

function TaskList({ tasks }: { tasks: ProjectionTask[] }) {
  if (tasks.length === 0) {
    return <p className="text-xs text-slate-600">No linked tasks in this projection.</p>;
  }
  return (
    <div className="space-y-1.5">
      {tasks.map((task) => (
        <div key={task.id} data-testid={`row-task-${task.id}`} className="flex items-center gap-2 rounded-md border border-slate-800 bg-slate-950/30 px-2.5 py-2">
          <ListChecks className="h-3.5 w-3.5 shrink-0 text-cyan-300/70" />
          <span className="min-w-0 flex-1 truncate text-xs text-slate-300">{task.title}</span>
          <span className="font-mono text-[10px] text-slate-600">{task.phase ?? '—'}</span>
          <StatusPill status={task.status} />
        </div>
      ))}
    </div>
  );
}

function WorkflowList({ workflows }: { workflows: ProjectionWorkflow[] }) {
  if (workflows.length === 0) {
    return <p className="text-xs text-slate-600">No linked workflows in this projection.</p>;
  }
  return (
    <div className="space-y-1.5">
      {workflows.map((workflow) => (
        <div key={workflow.id} data-testid={`row-workflow-${workflow.id}`} className="flex items-center gap-2 rounded-md border border-slate-800 bg-slate-950/30 px-2.5 py-2">
          <Workflow className="h-3.5 w-3.5 shrink-0 text-violet-300/70" />
          <span className="min-w-0 flex-1 truncate text-xs text-slate-300">{workflow.name}</span>
          <span className="font-mono text-[10px] text-slate-600">{workflow.currentPhase ?? '—'}</span>
          <StatusPill status={workflow.status} />
        </div>
      ))}
    </div>
  );
}

function ExecutionList({ executions }: { executions: ProjectionExecution[] }) {
  if (executions.length === 0) {
    return <p className="text-xs text-slate-600">No executions attached to this goal.</p>;
  }
  return (
    <div className="space-y-1.5">
      {executions.map((execution) => (
        <div key={execution.id} data-testid={`row-execution-${execution.id}`} className="flex items-center gap-2 rounded-md border border-slate-800 bg-slate-950/30 px-2.5 py-2">
          <TimerReset className="h-3.5 w-3.5 shrink-0 text-amber-200/70" />
          <span className="font-mono text-[10px] text-slate-500">{compactId(execution.id)}</span>
          <span className="min-w-0 flex-1 truncate text-xs text-slate-400">attempt {execution.attempt}</span>
          <StatusPill status={execution.status} />
        </div>
      ))}
    </div>
  );
}

function EventList({ events }: { events: ProjectionEvent[] }) {
  if (events.length === 0) {
    return <p className="text-xs text-slate-600">No events attached to this goal.</p>;
  }
  return (
    <div className="space-y-1.5">
      {events.map((event) => (
        <div key={event.id} data-testid={`row-event-${event.id}`} className="rounded-md border border-slate-800 bg-slate-950/30 px-2.5 py-2">
          <div className="flex items-center gap-2">
            <CircleDot className={`h-3.5 w-3.5 shrink-0 ${event.severity === 'error' || event.severity === 'critical' ? 'text-rose-300' : 'text-cyan-300/70'}`} />
            <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-slate-500">{event.type}</span>
            <span className="ml-auto font-mono text-[10px] text-slate-600">{formatDate(event.timestamp, true)}</span>
          </div>
          <p className="mt-1 text-xs leading-5 text-slate-400">{event.message}</p>
        </div>
      ))}
    </div>
  );
}

function GoalCard({
  item,
  expanded,
  onToggle,
}: {
  item: MissionProjection['goals'][number];
  expanded: boolean;
  onToggle: () => void;
}) {
  const { goal, tasks, workflows, executions, events } = item;
  const linkedCount = tasks.length + workflows.length + executions.length + events.length;
  return (
    <article data-testid={`card-goal-${goal.id}`} className={`overflow-hidden rounded-lg border transition-colors ${expanded ? 'border-cyan-400/30 bg-slate-900/80' : 'border-slate-800 bg-slate-900/45 hover:border-slate-700'}`}>
      <button
        type="button"
        onClick={onToggle}
        data-testid={`button-toggle-goal-${goal.id}`}
        aria-expanded={expanded}
        className="flex w-full items-start gap-3 px-4 py-3.5 text-left"
      >
        <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border ${statusTone(goal.status)}`}>
          {goal.status === 'completed' ? <CheckCircle2 className="h-4 w-4" /> : goal.status === 'blocked' || goal.status === 'failed' ? <XCircle className="h-4 w-4" /> : <CircleDot className="h-4 w-4" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-slate-100">{goal.title}</h3>
            <StatusPill status={goal.status} />
          </div>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{goal.description || 'No description provided.'}</p>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10px] text-slate-600">
            <span>priority {goal.priority ?? '—'}</span>
            <span>{linkedCount} linked records</span>
            {goal.nextWakeAt ? <span>next wake {formatDate(goal.nextWakeAt, true)}</span> : null}
          </div>
        </div>
        <ChevronDown className={`mt-1 h-4 w-4 shrink-0 text-slate-500 transition-transform ${expanded ? 'rotate-180 text-cyan-300' : ''}`} />
      </button>

      {expanded ? (
        <div className="grid gap-4 border-t border-slate-800 px-4 py-4 lg:grid-cols-2">
          <div className="space-y-3">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-slate-600">Next action</p>
              <p className="mt-1 break-words text-xs leading-5 text-slate-300">
                {displayJsonValue(goal.nextAction, 'No next action recorded.')}
              </p>
            </div>
            {goal.blockedReason ? (
              <div className="rounded-md border border-rose-400/20 bg-rose-400/5 px-3 py-2">
                <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-rose-300/70">Blocked reason</p>
                <p className="mt-1 text-xs leading-5 text-rose-200/80">{goal.blockedReason}</p>
              </div>
            ) : null}
            <div className="grid grid-cols-2 gap-3 border-t border-slate-800 pt-3">
              <CollectionLine icon={Clock3} label="Updated" value={formatDate(goal.updatedAt, true)} />
              <CollectionLine icon={CheckCircle2} label="Completed" value={formatDate(goal.completedAt, true)} empty={!goal.completedAt} />
            </div>
          </div>
          <div className="space-y-4">
            <div>
              <div className="mb-2 flex items-center gap-2">
                <ListChecks className="h-3.5 w-3.5 text-cyan-300/70" />
                <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-slate-500">Tasks <span className="text-slate-700">({tasks.length})</span></p>
              </div>
              <TaskList tasks={tasks} />
            </div>
            <div>
              <div className="mb-2 flex items-center gap-2">
                <Workflow className="h-3.5 w-3.5 text-violet-300/70" />
                <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-slate-500">Workflows <span className="text-slate-700">({workflows.length})</span></p>
              </div>
              <WorkflowList workflows={workflows} />
            </div>
            <div>
              <div className="mb-2 flex items-center gap-2">
                <TimerReset className="h-3.5 w-3.5 text-amber-200/70" />
                <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-slate-500">Executions <span className="text-slate-700">({executions.length})</span></p>
              </div>
              <ExecutionList executions={executions} />
            </div>
            <div>
              <div className="mb-2 flex items-center gap-2">
                <CircleDot className="h-3.5 w-3.5 text-cyan-300/70" />
                <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-slate-500">Events <span className="text-slate-700">({events.length})</span></p>
              </div>
              <EventList events={events} />
            </div>
          </div>
        </div>
      ) : null}
    </article>
  );
}

export default function Missions() {
  const {
    data: rawProjects,
    isLoading: projectsLoading,
    isError: projectsError,
    error: projectsQueryError,
    refetch: refetchProjects,
  } = useListProjects(undefined, {
    query: { queryKey: getListProjectsQueryKey() },
  });
  const projects = useMemo(() => rawProjects ?? [], [rawProjects]);
  const [projectId, setProjectId] = useState('');
  const [selectedMissionId, setSelectedMissionId] = useState<string | null>(null);
  const [expandedGoalId, setExpandedGoalId] = useState<string | null>(null);
  const [missions, setMissions] = useState<Mission[]>([]);
  const [missionsLoading, setMissionsLoading] = useState(false);
  const [missionsError, setMissionsError] = useState<unknown>(null);
  const [missionsReload, setMissionsReload] = useState(0);
  const [projection, setProjection] = useState<MissionProjection | null>(null);
  const [projectionLoading, setProjectionLoading] = useState(false);
  const [projectionError, setProjectionError] = useState<unknown>(null);
  const [projectionReload, setProjectionReload] = useState(0);

  useEffect(() => {
    if (projects.length === 0) {
      setProjectId('');
      return;
    }
    setProjectId((current) => projects.some((project) => String(project.id) === current) ? current : String(projects[0].id));
  }, [projects]);

  useEffect(() => {
    setSelectedMissionId(null);
    setExpandedGoalId(null);
    setProjection(null);
    setProjectionError(null);
  }, [projectId]);

  useEffect(() => {
    if (!projectId) {
      setMissions([]);
      setMissionsError(null);
      setMissionsLoading(false);
      return;
    }
    const controller = new AbortController();
    setMissionsLoading(true);
    setMissionsError(null);
    fetchMissions(projectId, controller.signal)
      .then((data) => setMissions(Array.isArray(data) ? data : []))
      .catch((error: unknown) => {
        if ((error as { name?: string }).name !== 'AbortError') setMissionsError(error);
      })
      .finally(() => {
        if (!controller.signal.aborted) setMissionsLoading(false);
      });
    return () => controller.abort();
  }, [projectId, missionsReload]);

  const activeMissionId = selectedMissionId && missions.some((mission) => mission.id === selectedMissionId)
    ? selectedMissionId
    : missions[0]?.id ?? null;
  const activeMission = missions.find((mission) => mission.id === activeMissionId) ?? null;

  useEffect(() => {
    if (!activeMissionId) {
      setProjection(null);
      setProjectionError(null);
      setProjectionLoading(false);
      return;
    }
    const controller = new AbortController();
    setProjectionLoading(true);
    setProjectionError(null);
    setProjection(null);
    fetchMissionProjection(activeMissionId, controller.signal)
      .then((data) => setProjection(normalizeProjection(data)))
      .catch((error: unknown) => {
        if ((error as { name?: string }).name !== 'AbortError') setProjectionError(error);
      })
      .finally(() => {
        if (!controller.signal.aborted) setProjectionLoading(false);
      });
    return () => controller.abort();
  }, [activeMissionId, projectionReload]);

  useEffect(() => {
    setExpandedGoalId(null);
  }, [activeMissionId]);

  const selectedProject = projects.find((project) => String(project.id) === projectId);
  const projectErrorStatus = typeof projectsQueryError === 'object' && projectsQueryError !== null && 'status' in projectsQueryError
    ? Number((projectsQueryError as { status?: unknown }).status)
    : null;
  const projectionGoals = projection?.goals ?? [];
  const projectionIsPartial = projection
    ? projection.counts.goals !== projectionGoals.length
      || projection.counts.tasks !== projectionGoals.reduce((sum, item) => sum + item.tasks.length, 0)
      || projection.counts.workflows !== projectionGoals.reduce((sum, item) => sum + item.workflows.length, 0)
      || projection.counts.executions !== projectionGoals.reduce((sum, item) => sum + item.executions.length, 0)
      || projection.counts.events !== projectionGoals.reduce((sum, item) => sum + item.events.length, 0)
    : false;

  return (
    <main className="min-h-[100dvh] bg-[#08111d] px-4 py-5 text-slate-100 md:px-7 md:py-7">
      <div className="mx-auto max-w-[1700px]">
        <header className="mb-6 flex flex-col gap-4 border-b border-slate-800/90 pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-cyan-300/70">
              <span className="h-1.5 w-1.5 rounded-full bg-cyan-300" />
              AI / Missions
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-50 md:text-3xl">Durable objectives</h1>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">
              Project-owned missions and the work attached to them, read from the operational projection.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-slate-600 sm:flex">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
              Read-only projection
            </div>
            <button
              type="button"
              onClick={() => {
                void refetchProjects();
                setMissionsReload((value) => value + 1);
                setProjectionReload((value) => value + 1);
              }}
              data-testid="button-refresh-missions"
              className="inline-flex items-center gap-2 rounded-md border border-slate-700 bg-slate-900/70 px-3 py-2 text-xs font-semibold text-slate-300 transition-colors hover:border-cyan-400/40 hover:bg-slate-800 hover:text-slate-100"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </button>
          </div>
        </header>

        {projectsLoading ? (
          <div className="grid gap-4 xl:grid-cols-[250px_350px_minmax(0,1fr)]">
            <Skeleton className="h-96" />
            <Skeleton className="h-96" />
            <Skeleton className="h-96" />
          </div>
        ) : projectsError ? (
          <section className="rounded-xl border border-slate-800 bg-slate-900/50">
            <ErrorState
              title={projectErrorStatus === 403 ? 'Project access is restricted' : 'Projects are unavailable'}
              message={projectErrorStatus === 403 ? 'Your account cannot view the owned project set.' : errorMessage(projectsQueryError, 'The project list could not be loaded.')}
              forbidden={projectErrorStatus === 403}
              onRetry={() => void refetchProjects()}
            />
          </section>
        ) : projects.length === 0 ? (
          <section className="rounded-xl border border-slate-800 bg-slate-900/50">
            <EmptyState icon={Layers3} title="No owned projects" description="Missions appear here when an owned project is available to your account." />
          </section>
        ) : (
          <>
            <div className="mb-4 flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-900/50 p-3 sm:flex-row sm:items-center">
              <label htmlFor="mission-project-select" className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-slate-500">
                <Code2 className="h-3.5 w-3.5 text-cyan-300/70" />
                Owned project
              </label>
              <select
                id="mission-project-select"
                value={projectId}
                onChange={(event) => setProjectId(event.target.value)}
                data-testid="select-mission-project"
                className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-200 outline-none transition-colors focus:border-cyan-400/60"
              >
                {projects.map((project) => (
                  <option key={project.id} value={String(project.id)}>{project.name}</option>
                ))}
              </select>
              {selectedProject ? <span className="font-mono text-[10px] text-slate-600">{compactId(String(selectedProject.id))}</span> : null}
            </div>

            <div className="grid items-start gap-4 xl:grid-cols-[250px_350px_minmax(0,1fr)]">
              <aside className="rounded-xl border border-slate-800 bg-slate-900/55">
                <div className="border-b border-slate-800 px-4 py-3">
                  <div className="flex items-center justify-between">
                    <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-slate-500">Project scope</p>
                    <span className="font-mono text-[10px] text-slate-600">{projects.length}</span>
                  </div>
                </div>
                <div className="space-y-1 p-2">
                  {projects.map((project) => {
                    const isCurrent = String(project.id) === projectId;
                    return (
                      <button
                        type="button"
                        key={project.id}
                        onClick={() => setProjectId(String(project.id))}
                        data-testid={`button-project-${project.id}`}
                        className={`w-full rounded-md border px-3 py-3 text-left transition-colors ${isCurrent ? 'border-cyan-400/25 bg-cyan-300/10' : 'border-transparent hover:border-slate-700 hover:bg-slate-800/70'}`}
                      >
                        <div className="flex items-start gap-2">
                          <GitBranch className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${isCurrent ? 'text-cyan-300' : 'text-slate-600'}`} />
                          <span className={`min-w-0 flex-1 truncate text-sm font-medium ${isCurrent ? 'text-cyan-100' : 'text-slate-300'}`}>{project.name}</span>
                          {isCurrent ? <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-cyan-300/70" /> : null}
                        </div>
                        <p className="mt-1 truncate pl-5 font-mono text-[10px] text-slate-600">{compactId(String(project.id))}</p>
                      </button>
                    );
                  })}
                </div>
              </aside>

              <section className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/55">
                <div className="border-b border-slate-800 px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-slate-500">Mission queue</p>
                      <p className="mt-1 text-xs text-slate-600">{selectedProject?.name ?? 'Select a project'}</p>
                    </div>
                    <span className="rounded border border-slate-700 bg-slate-950/50 px-2 py-1 font-mono text-[10px] text-slate-500">{missions.length} total</span>
                  </div>
                </div>
                {missionsLoading ? (
                  <div className="space-y-2 p-3">
                    {[1, 2, 3].map((item) => <Skeleton key={item} className="h-24" />)}
                  </div>
                ) : missionsError ? (
                  <ErrorState
                    title={errorStatus(missionsError) === 403 ? 'Mission access is restricted' : 'Missions are unavailable'}
                    message={errorStatus(missionsError) === 403 ? 'This project does not permit mission projection access.' : errorMessage(missionsError, 'The mission list could not be loaded.')}
                    forbidden={errorStatus(missionsError) === 403}
                    onRetry={() => setMissionsReload((value) => value + 1)}
                  />
                ) : missions.length === 0 ? (
                  <EmptyState icon={ListChecks} title="No missions for this project" description="This project has no durable objectives in the current read-only view." />
                ) : (
                  <div className="space-y-2 p-3">
                    {missions.map((mission) => {
                      const isCurrent = mission.id === activeMissionId;
                      return (
                        <button
                          type="button"
                          key={mission.id}
                          onClick={() => setSelectedMissionId(mission.id)}
                          data-testid={`button-mission-${mission.id}`}
                          className={`w-full rounded-lg border px-3 py-3 text-left transition-colors ${isCurrent ? 'border-cyan-400/35 bg-cyan-300/[0.07]' : 'border-slate-800 bg-slate-950/20 hover:border-slate-700 hover:bg-slate-800/50'}`}
                        >
                          <div className="flex items-start gap-2">
                            <div className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${isCurrent ? 'bg-cyan-300' : 'bg-slate-600'}`} />
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="line-clamp-2 text-sm font-semibold text-slate-200">{mission.title}</span>
                                <StatusPill status={mission.status} />
                              </div>
                              <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{mission.intent || 'No intent recorded.'}</p>
                              <p className="mt-2 font-mono text-[10px] text-slate-600">{compactId(mission.id)} · updated {formatDate(mission.updatedAt, true)}</p>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </section>

              <section className="min-w-0 rounded-xl border border-slate-800 bg-slate-900/55">
                {!activeMission ? (
                  <EmptyState icon={Layers3} title="Select a mission" description="Choose a mission from the queue to inspect its goals and linked operational records." />
                ) : (
                  <>
                    <div className="border-b border-slate-800 px-4 py-4 md:px-5">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <div className="mb-2 flex flex-wrap items-center gap-2">
                            <StatusPill status={activeMission.status} />
                            <span className="font-mono text-[10px] text-slate-600">{compactId(activeMission.id)}</span>
                          </div>
                          <h2 data-testid={`text-mission-title-${activeMission.id}`} className="text-xl font-semibold tracking-tight text-slate-50">{activeMission.title}</h2>
                          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">{activeMission.intent || 'No intent recorded for this mission.'}</p>
                        </div>
                        <div className="shrink-0 text-left sm:text-right">
                          <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-slate-600">Last updated</p>
                          <p className="mt-1 text-xs text-slate-400">{formatDate(activeMission.updatedAt, true)}</p>
                        </div>
                      </div>
                      <div className="mt-5 flex flex-wrap gap-x-6 gap-y-3">
                        <Metric label="Goals" value={projection?.counts.goals ?? '—'} accent="text-cyan-200" />
                        <Metric label="Tasks" value={projection?.counts.tasks ?? '—'} />
                        <Metric label="Workflows" value={projection?.counts.workflows ?? '—'} />
                        <Metric label="Executions" value={projection?.counts.executions ?? '—'} />
                        <Metric label="Events" value={projection?.counts.events ?? '—'} />
                      </div>
                    </div>

                    {projectionLoading ? (
                      <div className="space-y-3 p-4 md:p-5">
                        <Skeleton className="h-16" />
                        <Skeleton className="h-40" />
                        <Skeleton className="h-40" />
                      </div>
                    ) : projectionError ? (
                      <ErrorState
                        title={errorStatus(projectionError) === 403 ? 'Projection access is restricted' : 'Projection unavailable'}
                        message={errorStatus(projectionError) === 403 ? 'You can see the mission but not its linked operational records.' : errorMessage(projectionError, 'The mission projection could not be loaded.')}
                        forbidden={errorStatus(projectionError) === 403}
                        onRetry={() => setProjectionReload((value) => value + 1)}
                      />
                    ) : projection ? (
                      <div className="p-4 md:p-5">
                        {projectionIsPartial ? (
                          <div className="mb-4 flex items-start gap-2.5 rounded-md border border-amber-300/20 bg-amber-300/5 px-3 py-2.5 text-xs text-amber-100/80">
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-200" />
                            <span>This projection is partial. Some linked records may not be retained in the response.</span>
                          </div>
                        ) : null}
                        <div className="mb-4 flex items-center justify-between gap-3">
                          <div>
                            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-slate-500">Mission goals</p>
                            <p className="mt-1 text-xs text-slate-600">Expand a goal to inspect its attached records.</p>
                          </div>
                          <span className="font-mono text-[10px] text-slate-600">{projectionGoals.length} returned</span>
                        </div>
                        {projectionGoals.length === 0 ? (
                          <EmptyState icon={ListChecks} title="No goals returned" description="This mission has no goals in the current projection." />
                        ) : (
                          <div className="space-y-2">
                            {projectionGoals.map((item) => (
                              <GoalCard
                                key={item.goal.id}
                                item={item}
                                expanded={expandedGoalId === item.goal.id}
                                onToggle={() => setExpandedGoalId((current) => current === item.goal.id ? null : item.goal.id)}
                              />
                            ))}
                          </div>
                        )}
                        <div className="mt-5 grid gap-3 border-t border-slate-800 pt-4 text-xs text-slate-500 sm:grid-cols-3">
                          <span>Scope: {activeMission.scope ? 'recorded' : 'not recorded'}</span>
                          <span>Autonomy policy: {activeMission.autonomyPolicy ? 'recorded' : 'not recorded'}</span>
                          <span>Deadline: {formatDate(activeMission.deadline)}</span>
                        </div>
                      </div>
                    ) : (
                      <EmptyState icon={Layers3} title="No projection returned" description="The mission exists, but its read-only projection was empty." />
                    )}
                  </>
                )}
              </section>
            </div>
          </>
        )}
      </div>
    </main>
  );
}