import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  createTask,
  getListProjectsQueryKey,
  useListProjects,
  type CreateTaskInput as ApiCreateTaskInput,
} from '@workspace/api-client-react';
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  Clock3,
  Code2,
  Edit3,
  GitBranch,
  Layers3,
  ListChecks,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  ShieldAlert,
  TimerReset,
  Workflow,
  X,
  XCircle,
} from 'lucide-react';
import {
  createGoal,
  createMission,
  fetchMissionProjection,
  fetchMissions,
  Goal,
  GoalStatus,
  CreateGoalInput,
  CreateMissionInput,
  Mission,
  MissionStatus,
  MissionProjection,
  MissionRequestError,
  ProjectionEvent,
  ProjectionExecution,
  ProjectionTask,
  ProjectionWorkflow,
  updateGoal,
  updateMission,
  UpdateGoalInput,
  UpdateMissionInput,
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

const missionStatuses: MissionStatus[] = ['draft', 'active', 'waiting', 'blocked', 'needs_replan', 'completed', 'failed', 'cancelled'];
const goalStatuses: GoalStatus[] = ['queued', 'planning', 'running', 'waiting_for_event', 'waiting_for_approval', 'verifying', 'needs_replan', 'completed', 'blocked', 'failed', 'cancelled'];
const priorities: NonNullable<CreateGoalInput['priority']>[] = ['p0', 'p1', 'p2', 'p3'];

function jsonText(value: unknown) {
  if (value === null || value === undefined || value === '') return '';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '';
  }
}

function localDateValue(value: string | null | undefined) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 16);
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16);
}

function isoDateOrNull(value: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

function parseJsonObject(value: string, label: string): { value?: Record<string, unknown>; error?: string } {
  if (!value.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { error: `${label} must be a JSON object.` };
    }
    return { value: parsed as Record<string, unknown> };
  } catch {
    return { error: `${label} contains invalid JSON.` };
  }
}

function FieldLabel({ htmlFor, children, optional = false }: { htmlFor: string; children: string; optional?: boolean }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.14em] text-slate-400">
      {children} {optional ? <span className="text-slate-600">/ optional</span> : null}
    </label>
  );
}

function TextInput({
  id,
  value,
  onChange,
  placeholder,
  multiline = false,
  rows = 3,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
  rows?: number;
}) {
  const className = "w-full rounded-md border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-200 outline-none transition-colors placeholder:text-slate-700 focus:border-cyan-400/70 focus:ring-1 focus:ring-cyan-400/20";
  return multiline ? (
    <textarea id={id} data-testid={id} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} rows={rows} className={`${className} resize-y leading-5`} />
  ) : (
    <input id={id} data-testid={id} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className={className} />
  );
}

function JsonField({
  id,
  label,
  value,
  onChange,
  error,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
}) {
  return (
    <div>
      <FieldLabel htmlFor={id} optional>{label}</FieldLabel>
      <textarea
        id={id}
        data-testid={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={4}
        spellCheck={false}
        placeholder={'{\n  "key": "value"\n}'}
        aria-invalid={Boolean(error)}
        className={`w-full resize-y rounded-md border bg-slate-950/70 px-3 py-2 font-mono text-xs leading-5 text-slate-200 outline-none transition-colors placeholder:text-slate-700 focus:ring-1 ${error ? 'border-rose-400/60 focus:ring-rose-400/20' : 'border-slate-700 focus:border-cyan-400/70 focus:ring-cyan-400/20'}`}
      />
      {error ? <p className="mt-1 text-xs text-rose-300">{error}</p> : <p className="mt-1 text-[10px] text-slate-600">JSON object only. Leave blank to omit.</p>}
    </div>
  );
}

function EditorModal({
  title,
  eyebrow,
  error,
  saving,
  onClose,
  onSubmit,
  children,
  submitLabel,
}: {
  title: string;
  eyebrow: string;
  error: unknown;
  saving: boolean;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  children: ReactNode;
  submitLabel: string;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, saving]);

  const status = errorStatus(error);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[#020811]/80 px-3 py-6 backdrop-blur-sm sm:px-6 sm:py-10" role="presentation">
      <div className="w-full max-w-2xl overflow-hidden rounded-xl border border-cyan-400/20 bg-[#0b1725] shadow-2xl shadow-cyan-950/20" role="dialog" aria-modal="true" aria-labelledby="mission-editor-title">
        <div className="flex items-start justify-between gap-4 border-b border-slate-800 px-5 py-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-300/70">{eyebrow}</p>
            <h2 id="mission-editor-title" className="mt-1 text-lg font-semibold text-slate-100">{title}</h2>
          </div>
          <button type="button" onClick={onClose} disabled={saving} aria-label="Close editor" data-testid="button-close-editor" className="rounded-md p-1.5 text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-40">
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={onSubmit}>
          <div className="max-h-[calc(100dvh-12rem)] space-y-4 overflow-y-auto px-5 py-5">
            {error ? (
              <div role="alert" className="flex items-start gap-2.5 rounded-md border border-rose-400/25 bg-rose-400/10 px-3 py-2.5 text-xs text-rose-200">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-rose-300" />
                <span>{status === 403 ? 'Your account is not permitted to change this record. ' : ''}{errorMessage(error, 'The server rejected this change. Check the fields and try again.')}</span>
              </div>
            ) : null}
            {children}
          </div>
          <div className="flex flex-col-reverse gap-2 border-t border-slate-800 bg-slate-950/25 px-5 py-4 sm:flex-row sm:justify-end">
            <button type="button" onClick={onClose} disabled={saving} data-testid="button-cancel-editor" className="rounded-md border border-slate-700 px-4 py-2 text-xs font-semibold text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200 disabled:opacity-40">Cancel</button>
            <button type="submit" disabled={saving} data-testid="button-save-editor" className="inline-flex items-center justify-center gap-2 rounded-md border border-cyan-300/40 bg-cyan-300/15 px-4 py-2 text-xs font-semibold text-cyan-100 transition-colors hover:bg-cyan-300/25 disabled:cursor-wait disabled:opacity-60">
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              {saving ? 'Saving…' : submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function MissionEditor({
  projectId,
  mission,
  saving,
  error,
  onClose,
  onSave,
}: {
  projectId: string;
  mission?: Mission | null;
  saving: boolean;
  error: unknown;
  onClose: () => void;
  onSave: (data: CreateMissionInput | UpdateMissionInput) => void;
}) {
  const editing = Boolean(mission);
  const [title, setTitle] = useState(mission?.title ?? '');
  const [intent, setIntent] = useState(mission?.intent ?? '');
  const [status, setStatus] = useState<MissionStatus>(mission?.status ?? 'draft');
  const [autonomyPolicy, setAutonomyPolicy] = useState(jsonText(mission?.autonomyPolicy));
  const [budget, setBudget] = useState(jsonText(mission?.budget));
  const [deadline, setDeadline] = useState(localDateValue(mission?.deadline));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const errors: Record<string, string> = {};
    if (!title.trim()) errors.title = 'Title is required.';
    if (!intent.trim()) errors.intent = 'Intent is required.';
    const policy = parseJsonObject(autonomyPolicy, 'Autonomy policy');
    const budgetValue = parseJsonObject(budget, 'Budget');
    if (policy.error) errors.autonomyPolicy = policy.error;
    if (budgetValue.error) errors.budget = budgetValue.error;
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    if (editing) {
      onSave({ title: title.trim(), intent: intent.trim(), status, autonomyPolicy: policy.value, budget: budgetValue.value, deadline: isoDateOrNull(deadline) });
    } else {
      onSave({ projectId, title: title.trim(), intent: intent.trim(), autonomyPolicy: policy.value, budget: budgetValue.value, deadline: isoDateOrNull(deadline) });
    }
  };

  return (
    <EditorModal title={editing ? 'Edit mission' : 'Create mission'} eyebrow={editing ? 'Mission / update' : 'Mission / new objective'} error={error} saving={saving} onClose={onClose} onSubmit={submit} submitLabel={editing ? 'Save mission' : 'Create mission'}>
      <div>
        <FieldLabel htmlFor="mission-title">Title</FieldLabel>
        <TextInput id="mission-title" value={title} onChange={setTitle} placeholder="A durable objective with a clear finish line" />
        {fieldErrors.title ? <p className="mt-1 text-xs text-rose-300">{fieldErrors.title}</p> : null}
      </div>
      <div>
        <FieldLabel htmlFor="mission-intent">Intent</FieldLabel>
        <TextInput id="mission-intent" value={intent} onChange={setIntent} multiline rows={3} placeholder="What should this mission make true?" />
        {fieldErrors.intent ? <p className="mt-1 text-xs text-rose-300">{fieldErrors.intent}</p> : null}
      </div>
      {editing ? (
        <div>
          <FieldLabel htmlFor="mission-status">Status</FieldLabel>
          <select id="mission-status" value={status} onChange={(event) => setStatus(event.target.value as MissionStatus)} data-testid="select-mission-status" className="w-full rounded-md border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-200 outline-none focus:border-cyan-400/70">
            {missionStatuses.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </div>
      ) : null}
      <details data-testid="details-mission-advanced" className="rounded-md border border-slate-800 bg-slate-950/25 px-3">
        <summary className="cursor-pointer py-3 text-xs font-semibold text-slate-400">Advanced mission settings</summary>
        <div className="space-y-4 pb-3">
          <div>
            <FieldLabel htmlFor="mission-deadline" optional>Deadline</FieldLabel>
            <input id="mission-deadline" type="datetime-local" value={deadline} onChange={(event) => setDeadline(event.target.value)} data-testid="input-mission-deadline" className="w-full rounded-md border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-200 outline-none focus:border-cyan-400/70" />
            <p className="mt-1 text-[10px] text-slate-600">Leave blank when there is no deadline.</p>
          </div>
          <JsonField id="mission-autonomy-policy" label="Autonomy policy" value={autonomyPolicy} onChange={setAutonomyPolicy} error={fieldErrors.autonomyPolicy} />
          <JsonField id="mission-budget" label="Budget" value={budget} onChange={setBudget} error={fieldErrors.budget} />
        </div>
      </details>
    </EditorModal>
  );
}

function GoalEditor({
  goal,
  availableParents,
  saving,
  error,
  onClose,
  onSave,
}: {
  goal?: Goal | null;
  availableParents: Goal[];
  saving: boolean;
  error: unknown;
  onClose: () => void;
  onSave: (data: CreateGoalInput | UpdateGoalInput) => void;
}) {
  const editing = Boolean(goal);
  const [title, setTitle] = useState(goal?.title ?? '');
  const [description, setDescription] = useState(goal?.description ?? '');
  const [parentGoalId, setParentGoalId] = useState(goal?.parentGoalId ?? '');
  const [priority, setPriority] = useState<NonNullable<CreateGoalInput['priority']>>(goal?.priority && priorities.includes(goal.priority as NonNullable<CreateGoalInput['priority']>) ? goal.priority as NonNullable<CreateGoalInput['priority']> : 'p2');
  const [status, setStatus] = useState<GoalStatus>(goal?.status ?? 'queued');
  const [successCriteria, setSuccessCriteria] = useState(jsonText(goal?.successCriteria));
  const [evidenceContract, setEvidenceContract] = useState(jsonText(goal?.evidenceContract));
  const [outcomeContract, setOutcomeContract] = useState(jsonText(goal?.outcomeContract));
  const [nextAction, setNextAction] = useState(jsonText(goal?.nextAction));
  const [blockedReason, setBlockedReason] = useState(goal?.blockedReason ?? '');
  const [nextWakeAt, setNextWakeAt] = useState(localDateValue(goal?.nextWakeAt));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const errors: Record<string, string> = {};
    if (!title.trim()) errors.title = 'Title is required.';
    const parsed = {
      successCriteria: parseJsonObject(successCriteria, 'Success criteria'),
      evidenceContract: parseJsonObject(evidenceContract, 'Evidence contract'),
      outcomeContract: parseJsonObject(outcomeContract, 'Outcome contract'),
      nextAction: parseJsonObject(nextAction, 'Next action'),
    };
    Object.entries(parsed).forEach(([key, result]) => {
      if (result.error) errors[key] = result.error;
    });
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    const common = {
      title: title.trim(),
      description: description.trim() || null,
      parentGoalId: parentGoalId || null,
      priority,
      successCriteria: parsed.successCriteria.value,
      evidenceContract: parsed.evidenceContract.value,
      outcomeContract: parsed.outcomeContract.value,
      nextAction: parsed.nextAction.value,
    };
    onSave(editing ? { ...common, status, blockedReason: blockedReason.trim() || null, nextWakeAt: isoDateOrNull(nextWakeAt) } : common);
  };

  return (
    <EditorModal title={editing ? 'Edit goal' : 'Create goal'} eyebrow={editing ? 'Goal / update' : 'Goal / new workstream'} error={error} saving={saving} onClose={onClose} onSubmit={submit} submitLabel={editing ? 'Save goal' : 'Create goal'}>
      <div>
        <FieldLabel htmlFor="goal-title">Title</FieldLabel>
        <TextInput id="goal-title" value={title} onChange={setTitle} placeholder="A concrete result inside this mission" />
        {fieldErrors.title ? <p className="mt-1 text-xs text-rose-300">{fieldErrors.title}</p> : null}
      </div>
      <div>
        <FieldLabel htmlFor="goal-description" optional>Description</FieldLabel>
        <TextInput id="goal-description" value={description} onChange={setDescription} multiline rows={2} placeholder="Context for the operator and future runs" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <FieldLabel htmlFor="goal-priority">Priority</FieldLabel>
          <select id="goal-priority" value={priority} onChange={(event) => setPriority(event.target.value as NonNullable<CreateGoalInput['priority']>)} data-testid="select-goal-priority" className="w-full rounded-md border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-200 outline-none focus:border-cyan-400/70">
            {priorities.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </div>
        {editing ? (
          <div>
            <FieldLabel htmlFor="goal-status">Status</FieldLabel>
            <select id="goal-status" value={status} onChange={(event) => setStatus(event.target.value as GoalStatus)} data-testid="select-goal-status" className="w-full rounded-md border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-200 outline-none focus:border-cyan-400/70">
              {goalStatuses.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </div>
        ) : null}
      </div>
      <details data-testid="details-goal-advanced" className="rounded-md border border-slate-800 bg-slate-950/25 px-3">
        <summary className="cursor-pointer py-3 text-xs font-semibold text-slate-400">Advanced goal settings</summary>
        <div className="space-y-4 pb-3">
          <div>
            <FieldLabel htmlFor="goal-parent" optional>Parent goal</FieldLabel>
            <select id="goal-parent" value={parentGoalId} onChange={(event) => setParentGoalId(event.target.value)} data-testid="select-goal-parent" className="w-full rounded-md border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-200 outline-none focus:border-cyan-400/70">
              <option value="">No parent goal</option>
              {availableParents.filter((item) => item.id !== goal?.id).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
            </select>
          </div>
          {editing ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <FieldLabel htmlFor="goal-next-wake" optional>Next wake</FieldLabel>
                <input id="goal-next-wake" type="datetime-local" value={nextWakeAt} onChange={(event) => setNextWakeAt(event.target.value)} data-testid="input-goal-next-wake" className="w-full rounded-md border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-200 outline-none focus:border-cyan-400/70" />
              </div>
              <div>
                <FieldLabel htmlFor="goal-blocked-reason" optional>Blocked reason</FieldLabel>
                <TextInput id="goal-blocked-reason" value={blockedReason} onChange={setBlockedReason} placeholder="Why execution cannot proceed" />
              </div>
            </div>
          ) : null}
          <div className="border-t border-slate-800 pt-4">
            <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.16em] text-slate-500">Contracts and next action</p>
            <div className="grid gap-4 lg:grid-cols-2">
              <JsonField id="goal-success-criteria" label="Success criteria" value={successCriteria} onChange={setSuccessCriteria} error={fieldErrors.successCriteria} />
              <JsonField id="goal-evidence-contract" label="Evidence contract" value={evidenceContract} onChange={setEvidenceContract} error={fieldErrors.evidenceContract} />
              <JsonField id="goal-outcome-contract" label="Outcome contract" value={outcomeContract} onChange={setOutcomeContract} error={fieldErrors.outcomeContract} />
              <JsonField id="goal-next-action" label="Next action" value={nextAction} onChange={setNextAction} error={fieldErrors.nextAction} />
            </div>
          </div>
        </div>
      </details>
    </EditorModal>
  );
}

function TaskEditor({
  projectId,
  goal,
  saving,
  error,
  onClose,
  onSave,
}: {
  projectId: string;
  goal: Goal;
  saving: boolean;
  error: unknown;
  onClose: () => void;
  onSave: (data: ApiCreateTaskInput) => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<ApiCreateTaskInput['priority']>('p2');
  const [fieldError, setFieldError] = useState('');

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!title.trim()) {
      setFieldError('Task title is required.');
      return;
    }
    setFieldError('');
    onSave({
      projectId,
      goalId: goal.id,
      title: title.trim(),
      description: description.trim() || undefined,
      priority,
    });
  };

  return (
    <EditorModal
      title="Create task"
      eyebrow={`Task / ${goal.title}`}
      error={error}
      saving={saving}
      onClose={onClose}
      onSubmit={submit}
      submitLabel="Create task"
    >
      <div className="rounded-md border border-cyan-400/15 bg-cyan-300/5 px-3 py-2.5 text-xs leading-5 text-slate-400">
        This task will be saved under <span className="font-semibold text-cyan-100">{goal.title}</span>.
      </div>
      <div>
        <FieldLabel htmlFor="task-title">Task title</FieldLabel>
        <TextInput id="task-title" value={title} onChange={setTitle} placeholder="What needs to be done?" />
        {fieldError ? <p className="mt-1 text-xs text-rose-300">{fieldError}</p> : null}
      </div>
      <div>
        <FieldLabel htmlFor="task-description" optional>Description</FieldLabel>
        <TextInput id="task-description" value={description} onChange={setDescription} multiline rows={3} placeholder="Add context for the operator or AI agent" />
      </div>
      <div>
        <FieldLabel htmlFor="task-priority">Priority</FieldLabel>
        <select id="task-priority" value={priority} onChange={(event) => setPriority(event.target.value as ApiCreateTaskInput['priority'])} data-testid="select-task-priority" className="w-full rounded-md border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-200 outline-none focus:border-cyan-400/70">
          {priorities.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </div>
    </EditorModal>
  );
}

function GoalCard({
  item,
  expanded,
  onToggle,
  onEdit,
  onCreateTask,
}: {
  item: MissionProjection['goals'][number];
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onCreateTask: () => void;
}) {
  const { goal, tasks, workflows, executions, events } = item;
  const linkedCount = tasks.length + workflows.length + executions.length + events.length;
  return (
    <article data-testid={`card-goal-${goal.id}`} className={`overflow-hidden rounded-lg border transition-colors ${expanded ? 'border-cyan-400/30 bg-slate-900/80' : 'border-slate-800 bg-slate-900/45 hover:border-slate-700'}`}>
      <div className="flex items-start gap-3 px-4 py-3.5">
        <button
          type="button"
          onClick={onToggle}
          data-testid={`button-toggle-goal-${goal.id}`}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-start gap-3 text-left"
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
        <div className="flex shrink-0 items-center gap-1">
          <button type="button" onClick={onCreateTask} data-testid={`button-create-task-${goal.id}`} className="inline-flex items-center gap-1 rounded-md border border-cyan-400/25 bg-cyan-300/10 px-2 py-1.5 text-[10px] font-semibold text-cyan-100 transition-colors hover:bg-cyan-300/20">
            <Plus className="h-3 w-3" />
            <span className="hidden sm:inline">New task</span>
            <span className="sm:hidden">Task</span>
          </button>
          <button type="button" onClick={onEdit} data-testid={`button-edit-goal-${goal.id}`} aria-label={`Edit ${goal.title}`} className="rounded-md border border-transparent p-1.5 text-slate-600 transition-colors hover:border-slate-700 hover:bg-slate-800 hover:text-cyan-200">
            <Edit3 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

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

type EditorState =
  | { type: 'mission-create' }
  | { type: 'mission-edit'; mission: Mission }
  | { type: 'goal-create'; missionId: string }
  | { type: 'goal-edit'; missionId: string; goal: Goal }
  | { type: 'task-create'; goal: Goal; projectId: string }
  | null;

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
  const [editor, setEditor] = useState<EditorState>(null);
  const [mutationSaving, setMutationSaving] = useState(false);
  const [mutationError, setMutationError] = useState<unknown>(null);
  const [mutationNotice, setMutationNotice] = useState<string | null>(null);

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

  const openEditor = (next: Exclude<EditorState, null>) => {
    setMutationError(null);
    setMutationNotice(null);
    setEditor(next);
  };

  const closeEditor = () => {
    if (mutationSaving) return;
    setEditor(null);
    setMutationError(null);
  };

  const handleSave = async (data: CreateMissionInput | UpdateMissionInput | CreateGoalInput | UpdateGoalInput | ApiCreateTaskInput) => {
    if (!editor) return;
    setMutationSaving(true);
    setMutationError(null);
    try {
      if (editor.type === 'mission-create') {
        const created = await createMission(data as CreateMissionInput);
        setMissions((current) => [created, ...current.filter((item) => item.id !== created.id)]);
        setSelectedMissionId(created.id);
        setEditor(null);
        setMutationNotice('Mission created.');
        setMissionsReload((value) => value + 1);
        setProjectionReload((value) => value + 1);
      } else if (editor.type === 'mission-edit') {
        const updated = await updateMission(editor.mission.id, data as UpdateMissionInput);
        setMissions((current) => current.map((item) => item.id === updated.id ? updated : item));
        setProjection((current) => current && current.mission.id === updated.id ? { ...current, mission: updated } : current);
        setEditor(null);
        setMutationNotice('Mission updated.');
        setMissionsReload((value) => value + 1);
        setProjectionReload((value) => value + 1);
      } else if (editor.type === 'goal-create') {
        await createGoal(editor.missionId, data as CreateGoalInput);
        setEditor(null);
        setMutationNotice('Goal created.');
        setProjectionReload((value) => value + 1);
      } else if (editor.type === 'goal-edit') {
        const updated = await updateGoal(editor.goal.id, data as UpdateGoalInput);
        setProjection((current) => current ? {
          ...current,
          goals: current.goals.map((item) => item.goal.id === updated.id ? { ...item, goal: updated } : item),
        } : current);
        setEditor(null);
        setMutationNotice('Goal updated.');
        setProjectionReload((value) => value + 1);
      } else {
        const created = await createTask(data as ApiCreateTaskInput);
        setEditor(null);
        setMutationNotice(`Task created: ${created.title}`);
        setProjectionReload((value) => value + 1);
      }
    } catch (error: unknown) {
      setMutationError(error);
    } finally {
      setMutationSaving(false);
    }
  };

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
               Projection + management
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

        {mutationNotice ? (
          <div role="status" className="mb-4 flex items-center justify-between gap-3 rounded-md border border-emerald-400/25 bg-emerald-300/10 px-3 py-2.5 text-xs text-emerald-100">
            <span className="inline-flex items-center gap-2"><CheckCircle2 className="h-4 w-4 shrink-0" />{mutationNotice}</span>
            <button type="button" onClick={() => setMutationNotice(null)} className="text-emerald-200/70 hover:text-emerald-100" aria-label="Dismiss notification"><X className="h-3.5 w-3.5" /></button>
          </div>
        ) : null}

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
              <aside className="hidden rounded-xl border border-slate-800 bg-slate-900/55 xl:block">
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
                    <div className="flex items-center gap-2">
                      <span className="rounded border border-slate-700 bg-slate-950/50 px-2 py-1 font-mono text-[10px] text-slate-500">{missions.length} total</span>
                      <button type="button" onClick={() => openEditor({ type: 'mission-create' })} data-testid="button-create-mission" className="inline-flex items-center gap-1.5 rounded-md border border-cyan-400/30 bg-cyan-300/10 px-2.5 py-1.5 text-[11px] font-semibold text-cyan-100 transition-colors hover:bg-cyan-300/20">
                        <Plus className="h-3.5 w-3.5" />
                         New mission
                      </button>
                    </div>
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
                  <EmptyState icon={ListChecks} title="No missions for this project" description="Create the first durable objective for this project." />
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
                        <div className="flex shrink-0 items-start gap-3 sm:flex-col sm:items-end">
                          <div className="flex items-center gap-2">
                            <button type="button" onClick={() => openEditor({ type: 'goal-create', missionId: activeMission.id })} data-testid="button-create-goal" className="inline-flex items-center gap-1.5 rounded-md border border-emerald-400/30 bg-emerald-300/10 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-100 transition-colors hover:bg-emerald-300/20">
                              <Plus className="h-3.5 w-3.5" />
                              New goal
                            </button>
                            <button type="button" onClick={() => openEditor({ type: 'mission-edit', mission: activeMission })} data-testid={`button-edit-mission-${activeMission.id}`} className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-950/40 px-2.5 py-1.5 text-[11px] font-semibold text-slate-300 transition-colors hover:border-cyan-400/40 hover:text-cyan-100">
                              <Edit3 className="h-3.5 w-3.5" />
                              Edit mission
                            </button>
                          </div>
                          <div className="text-left sm:text-right">
                            <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-slate-600">Last updated</p>
                            <p className="mt-1 text-xs text-slate-400">{formatDate(activeMission.updatedAt, true)}</p>
                          </div>
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
                                onEdit={() => openEditor({ type: 'goal-edit', missionId: activeMission.id, goal: item.goal })}
                                 onCreateTask={() => openEditor({ type: 'task-create', goal: item.goal, projectId })}
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
      {editor?.type === 'mission-create' ? (
        <MissionEditor projectId={projectId} saving={mutationSaving} error={mutationError} onClose={closeEditor} onSave={handleSave} />
      ) : null}
      {editor?.type === 'mission-edit' ? (
        <MissionEditor projectId={projectId} mission={editor.mission} saving={mutationSaving} error={mutationError} onClose={closeEditor} onSave={handleSave} />
      ) : null}
      {editor?.type === 'goal-create' ? (
        <GoalEditor availableParents={projectionGoals.map((item) => item.goal)} saving={mutationSaving} error={mutationError} onClose={closeEditor} onSave={handleSave} />
      ) : null}
      {editor?.type === 'goal-edit' ? (
        <GoalEditor goal={editor.goal} availableParents={projectionGoals.map((item) => item.goal)} saving={mutationSaving} error={mutationError} onClose={closeEditor} onSave={handleSave} />
      ) : null}
      {editor?.type === 'task-create' ? (
        <TaskEditor projectId={editor.projectId} goal={editor.goal} saving={mutationSaving} error={mutationError} onClose={closeEditor} onSave={handleSave} />
      ) : null}
    </main>
  );
}