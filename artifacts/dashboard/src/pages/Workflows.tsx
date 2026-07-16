import React, { useState } from 'react';
import {
  useListWorkflows,
  useListProjects,
  useCreateWorkflow,
  useStartWorkflow,
  useStopWorkflow,
  useAdvanceWorkflow,
  useFailWorkflowPhase,
  useRetryWorkflowPhase,
  useListWorkflowExecutions,
  getListWorkflowsQueryKey,
  getListWorkflowExecutionsQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  GitMerge,
  Plus,
  Play,
  Square,
  Activity,
  CheckCircle2,
  ListTree,
  ChevronRight,
  RotateCcw,
  XCircle,
  History,
  ChevronDown,
  ChevronUp,
  X,
  Trash2,
} from 'lucide-react';

function CreateWorkflowModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: projects } = useListProjects();
  const createWorkflow = useCreateWorkflow();

  const [projectId, setProjectId] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [phases, setPhases] = useState<string[]>(['build', 'test', 'deploy']);

  const updatePhase = (idx: number, value: string) => {
    setPhases((prev) => prev.map((p, i) => (i === idx ? value : p)));
  };
  const addPhase = () => setPhases((prev) => [...prev, '']);
  const removePhase = (idx: number) => setPhases((prev) => prev.filter((_, i) => i !== idx));

  const cleanedPhases = phases.map((p) => p.trim()).filter(Boolean);
  const canSubmit = !!projectId && name.trim().length > 0 && cleanedPhases.length > 0;

  const handleSubmit = () => {
    if (!canSubmit) return;
    createWorkflow.mutate(
      {
        data: {
          projectId,
          name: name.trim(),
          description: description.trim() || undefined,
          phases: cleanedPhases.map((p) => ({ name: p, steps: [] })),
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListWorkflowsQueryKey() });
          onClose();
        },
      },
    );
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-card border border-border rounded-xl shadow-xl w-full max-w-lg p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <GitMerge className="w-5 h-5 text-primary" /> Build Pipeline
          </h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-secondary"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Project</label>
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="w-full bg-secondary/50 border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">Select a project…</option>
              {projects?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Release Pipeline"
              className="w-full bg-secondary/50 border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">
              Description (optional)
            </label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this pipeline orchestrate?"
              className="w-full bg-secondary/50 border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">
              Phases (run in order)
            </label>
            <div className="space-y-2">
              {phases.map((phase, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <span className="text-xs font-mono text-muted-foreground w-5 text-center">
                    {idx + 1}
                  </span>
                  <input
                    value={phase}
                    onChange={(e) => updatePhase(idx, e.target.value)}
                    placeholder="phase name"
                    className="flex-1 bg-secondary/50 border border-border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  <button
                    onClick={() => removePhase(idx)}
                    disabled={phases.length <= 1}
                    className="text-muted-foreground hover:text-destructive disabled:opacity-30 p-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
            <button
              onClick={addPhase}
              className="mt-2 text-xs text-primary hover:underline flex items-center gap-1"
            >
              <Plus className="w-3 h-3" /> Add phase
            </button>
          </div>
        </div>

        {createWorkflow.isError && (
          <p className="text-xs text-destructive">Failed to create pipeline. Please try again.</p>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-border">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-md font-medium text-sm text-muted-foreground hover:bg-secondary transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit || createWorkflow.isPending}
            className="bg-primary hover:bg-primary/90 text-primary-foreground px-4 py-2 rounded-md font-medium text-sm disabled:opacity-50 transition-colors"
          >
            {createWorkflow.isPending ? 'Creating…' : 'Create Pipeline'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ExecutionHistory({ workflowId }: { workflowId: string }) {
  const { data: executions, isLoading } = useListWorkflowExecutions(workflowId, {
    query: { queryKey: getListWorkflowExecutionsQueryKey(workflowId), staleTime: 10_000 },
  });
  const queryClient = useQueryClient();
  const retryPhase = useRetryWorkflowPhase();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListWorkflowExecutionsQueryKey(workflowId) });
    queryClient.invalidateQueries({ queryKey: getListWorkflowsQueryKey() });
  };

  if (isLoading) {
    return <div className="text-xs text-muted-foreground animate-pulse py-2">Loading executions...</div>;
  }
  if (!executions || executions.length === 0) {
    return <p className="text-xs text-muted-foreground italic py-2">No executions yet.</p>;
  }

  const statusStyle = (status: string) =>
    status === 'running'
      ? 'text-primary'
      : status === 'completed'
      ? 'text-emerald-500'
      : status === 'failed'
      ? 'text-destructive'
      : 'text-muted-foreground';

  return (
    <div className="space-y-2">
      {executions.map((exec) => (
        <div
          key={exec.id}
          className="flex items-center justify-between text-xs bg-secondary/30 rounded-lg px-3 py-2 gap-3"
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className={`font-bold uppercase tracking-wider ${statusStyle(exec.status)}`}>
                {exec.status}
              </span>
              {exec.currentPhase && (
                <span className="text-muted-foreground font-mono truncate">
                  @ {exec.currentPhase}
                </span>
              )}
            </div>
            {exec.completedPhases && exec.completedPhases.length > 0 && (
              <div className="text-[10px] text-muted-foreground font-mono mt-1 truncate">
                completed: {exec.completedPhases.join(' → ')}
              </div>
            )}
            {exec.errorMessage && (
              <div className="text-[10px] text-destructive mt-1 truncate" title={exec.errorMessage}>
                {exec.errorMessage}
              </div>
            )}
          </div>
          <div className="text-[10px] text-muted-foreground font-mono shrink-0">
            {new Date(exec.startedAt).toLocaleString()}
          </div>
          {exec.status === 'failed' && (
            <button
              onClick={() =>
                retryPhase.mutate(
                  { workflowId, executionId: exec.id },
                  { onSuccess: invalidate },
                )
              }
              disabled={retryPhase.isPending}
              className="shrink-0 flex items-center gap-1 text-primary hover:underline disabled:opacity-50"
            >
              <RotateCcw className="w-3 h-3" /> Retry
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

export default function Workflows() {
  const queryClient = useQueryClient();
  const { data: workflows, isLoading } = useListWorkflows({});
  const [expandedId, setExpandedId] = useState<string>('');
  const [showCreateModal, setShowCreateModal] = useState(false);

  const startWorkflow = useStartWorkflow();
  const stopWorkflow = useStopWorkflow();
  const advanceWorkflow = useAdvanceWorkflow();
  const failPhase = useFailWorkflowPhase();

  const invalidateWorkflow = (workflowId: string) => {
    queryClient.invalidateQueries({ queryKey: getListWorkflowsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListWorkflowExecutionsQueryKey(workflowId) });
  };

  const handleToggle = (workflowId: string, status: string) => {
    const isRunning = status === 'running';
    const mutation = isRunning ? stopWorkflow : startWorkflow;
    mutation.mutate(
      { workflowId },
      { onSuccess: () => invalidateWorkflow(workflowId) },
    );
  };

  const handleAdvance = (workflowId: string) => {
    advanceWorkflow.mutate({ workflowId }, { onSuccess: () => invalidateWorkflow(workflowId) });
  };

  const handleFailPhase = (workflowId: string) => {
    failPhase.mutate(
      { workflowId, data: { error: 'Manually marked as failed by operator' } },
      { onSuccess: () => invalidateWorkflow(workflowId) },
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <GitMerge className="w-6 h-6 text-primary" /> Workflows
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Multi-stage autonomous pipelines.</p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="bg-primary hover:bg-primary/90 text-primary-foreground px-4 py-2 rounded-md font-medium text-sm flex items-center gap-2 shadow-sm transition-colors"
        >
          <Plus className="w-4 h-4" /> Build Pipeline
        </button>
      </div>

      {showCreateModal && <CreateWorkflowModal onClose={() => setShowCreateModal(false)} />}

      <div className="grid grid-cols-1 gap-6">
        {isLoading ? (
          <div className="h-64 bg-card border border-border rounded-xl animate-pulse"></div>
        ) : workflows?.length === 0 ? (
          <div className="border-2 border-dashed border-border rounded-xl p-16 text-center flex flex-col items-center">
            <ListTree className="w-12 h-12 text-muted-foreground mb-4 opacity-50" />
            <h3 className="text-lg font-semibold mb-2">No workflows defined</h3>
            <p className="text-muted-foreground text-sm max-w-sm mb-6">
              Create a pipeline to orchestrate tasks across multiple agents automatically.
            </p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="bg-primary hover:bg-primary/90 text-primary-foreground px-4 py-2 rounded-md font-medium text-sm flex items-center gap-2 shadow-sm transition-colors"
            >
              <Plus className="w-4 h-4" /> Build Pipeline
            </button>
          </div>
        ) : (
          workflows?.map((workflow) => (
            <div
              key={workflow.id}
              className="bg-card border border-border rounded-xl p-6 shadow-sm"
            >
              <div className="flex justify-between items-start mb-6">
                <div>
                  <div className="flex items-center gap-3">
                    <h2 className="text-xl font-bold">{workflow.name}</h2>
                    <span
                      className={`px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wider border
                      ${
                        workflow.status === 'running'
                          ? 'bg-primary/10 text-primary border-primary/20'
                          : workflow.status === 'completed'
                          ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20'
                          : 'bg-secondary text-muted-foreground border-border'
                      }`}
                    >
                      {workflow.status === 'running' ? (
                        <Activity className="w-3 h-3 inline mr-1 animate-pulse" />
                      ) : null}
                      {workflow.status}
                    </span>
                  </div>
                  <p className="text-muted-foreground text-sm mt-1">{workflow.description}</p>
                </div>
                <div className="flex gap-2">
                  {workflow.status === 'running' && (
                    <>
                      <button
                        onClick={() => handleAdvance(workflow.id)}
                        disabled={advanceWorkflow.isPending}
                        className="px-3 py-2 rounded-md font-medium text-sm flex items-center gap-1.5 shadow-sm transition-colors disabled:opacity-50 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500 hover:text-white border border-emerald-500/20"
                        title="Advance to next phase"
                      >
                        <ChevronRight className="w-4 h-4" /> Advance
                      </button>
                      <button
                        onClick={() => handleFailPhase(workflow.id)}
                        disabled={failPhase.isPending}
                        className="px-3 py-2 rounded-md font-medium text-sm flex items-center gap-1.5 shadow-sm transition-colors disabled:opacity-50 bg-secondary text-muted-foreground hover:bg-destructive hover:text-destructive-foreground"
                        title="Mark current phase as failed"
                      >
                        <XCircle className="w-4 h-4" />
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => handleToggle(workflow.id, workflow.status)}
                    disabled={startWorkflow.isPending || stopWorkflow.isPending}
                    className={`px-4 py-2 rounded-md font-medium text-sm flex items-center gap-2 shadow-sm transition-colors disabled:opacity-50
                      ${
                        workflow.status === 'running'
                          ? 'bg-destructive/10 text-destructive hover:bg-destructive hover:text-destructive-foreground border border-destructive/20'
                          : 'bg-primary text-primary-foreground hover:bg-primary/90'
                      }`}
                  >
                    {workflow.status === 'running' ? (
                      <>
                        <Square className="w-4 h-4" fill="currentColor" /> Stop
                      </>
                    ) : (
                      <>
                        <Play className="w-4 h-4" /> Execute
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Phase timeline */}
              {workflow.phases && workflow.phases.length > 0 && (() => {
                const totalPhases = workflow.phases.length;
                const currentPhaseIdx = workflow.currentPhase
                  ? workflow.phases.findIndex((p) => p.name === workflow.currentPhase)
                  : -1;
                const completedCount =
                  workflow.status === 'completed'
                    ? totalPhases
                    : currentPhaseIdx >= 0
                    ? currentPhaseIdx
                    : 0;
                const progressPct =
                  totalPhases > 0 ? (completedCount / totalPhases) * 100 : 0;
                return (
                <div className="relative">
                  <div className="absolute top-1/2 left-0 w-full h-0.5 bg-secondary -translate-y-1/2 z-0"></div>
                  {(workflow.status === 'running' || workflow.status === 'completed') && (
                    <div
                      className={`absolute top-1/2 left-0 h-0.5 bg-primary -translate-y-1/2 z-0 transition-all duration-500${workflow.status === 'running' ? ' animate-pulse' : ''}`}
                      style={{ width: `${progressPct}%` }}
                    ></div>
                  )}
                  <div className="flex items-center justify-between relative z-10">
                    {workflow.phases.map((phase, idx) => {
                      const isCurrent = workflow.currentPhase === phase.name;
                      const isPast = workflow.currentPhase
                        ? workflow.phases.findIndex((p) => p.name === workflow.currentPhase) > idx
                        : false;
                      const isCompleted = workflow.status === 'completed' || isPast;
                      return (
                        <div key={idx} className="flex flex-col items-center bg-card px-2">
                          <div
                            className={`w-8 h-8 rounded-full flex items-center justify-center border-2 mb-2
                            ${
                              isCompleted
                                ? 'bg-emerald-500 border-emerald-500 text-white'
                                : isCurrent
                                ? 'bg-primary/20 border-primary text-primary shadow-[0_0_15px_rgba(0,165,255,0.5)]'
                                : 'bg-secondary border-border text-muted-foreground'
                            }`}
                          >
                            {isCompleted ? (
                              <CheckCircle2 className="w-4 h-4" />
                            ) : (
                              <span className="font-mono text-sm">{idx + 1}</span>
                            )}
                          </div>
                          <span
                            className={`text-xs font-bold uppercase tracking-wider ${
                              isCurrent
                                ? 'text-primary'
                                : isCompleted
                                ? 'text-foreground'
                                : 'text-muted-foreground'
                            }`}
                          >
                            {phase.name}
                          </span>
                          <span className="text-[10px] text-muted-foreground mt-1 font-mono">
                            {phase.steps.length} steps
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
              })()}

              <div className="mt-8 bg-secondary/30 rounded-lg p-4 text-xs font-mono text-muted-foreground flex justify-between items-center">
                <span>
                  Runs:{' '}
                  <span className="text-foreground font-bold">{workflow.executionCount || 0}</span>
                </span>
                <span>ID: {workflow.id}</span>
                <span>Project: {workflow.projectId}</span>
              </div>

              <button
                onClick={() => setExpandedId(expandedId === workflow.id ? '' : workflow.id)}
                className="mt-4 w-full flex items-center justify-between text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors border-t border-border pt-4"
              >
                <span className="flex items-center gap-1.5">
                  <History className="w-3.5 h-3.5" /> Execution history
                </span>
                {expandedId === workflow.id ? (
                  <ChevronUp className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
              </button>
              {expandedId === workflow.id && (
                <div className="mt-3">
                  <ExecutionHistory workflowId={workflow.id} />
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
