import React from 'react';
import {
  useListWorkflows,
  useStartWorkflow,
  useStopWorkflow,
  getListWorkflowsQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { GitMerge, Plus, Play, Square, Activity, CheckCircle2, ListTree } from 'lucide-react';

export default function Workflows() {
  const queryClient = useQueryClient();
  const { data: workflows, isLoading } = useListWorkflows({});

  const startWorkflow = useStartWorkflow();
  const stopWorkflow = useStopWorkflow();

  const handleToggle = (workflowId: string, status: string) => {
    const isRunning = status === 'running';
    const mutation = isRunning ? stopWorkflow : startWorkflow;
    mutation.mutate(
      { workflowId },
      {
        onSuccess: () => queryClient.invalidateQueries({ queryKey: getListWorkflowsQueryKey() }),
      },
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
        <button className="bg-primary hover:bg-primary/90 text-primary-foreground px-4 py-2 rounded-md font-medium text-sm flex items-center gap-2 shadow-sm transition-colors">
          <Plus className="w-4 h-4" /> Build Pipeline
        </button>
      </div>

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
              {workflow.phases && workflow.phases.length > 0 && (
                <div className="relative">
                  <div className="absolute top-1/2 left-0 w-full h-0.5 bg-secondary -translate-y-1/2 z-0"></div>
                  {workflow.status === 'running' && (
                    <div className="absolute top-1/2 left-0 w-1/2 h-0.5 bg-primary -translate-y-1/2 z-0 animate-pulse"></div>
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
              )}

              <div className="mt-8 bg-secondary/30 rounded-lg p-4 text-xs font-mono text-muted-foreground flex justify-between items-center">
                <span>
                  Runs:{' '}
                  <span className="text-foreground font-bold">{workflow.executionCount || 0}</span>
                </span>
                <span>ID: {workflow.id}</span>
                <span>Project: {workflow.projectId}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
