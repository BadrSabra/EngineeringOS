import React, { useState, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import {
  useListProjects,
  getListProjectsQueryKey,
  useStartProjectBootstrap,
  useGetProjectBootstrap,
  getGetProjectBootstrapQueryKey,
  classifyProjectError,
  isRetryableProjectError,
  emitProjectLoadFailed,
  type ProjectBootstrapOperation,
} from '@workspace/api-client-react';
import {
  Search,
  Activity,
  ShieldCheck,
  FolderGit2,
  Radar,
  Plus,
  X,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
} from 'lucide-react';
import { Link } from 'wouter';
import { DiscoverProjectWizard } from './DiscoverProjectWizard';
import { newestUpdatedAt, useMonotonicData } from '@/lib/freshness';

export default function Projects() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { data: rawProjects, isLoading, isError, error } = useListProjects(undefined, {
    query: {
      queryKey: getListProjectsQueryKey(),
      retry: (failureCount, err) => isRetryableProjectError(err, failureCount),
    },
  });
  const projects = useMonotonicData(rawProjects, newestUpdatedAt(rawProjects));
  const [showDiscover, setShowDiscover] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState('');
  const [projectName, setProjectName] = useState('');
  const [projectDescription, setProjectDescription] = useState('');
  const [bootstrapId, setBootstrapId] = useState('');
  const [initialOperation, setInitialOperation] = useState<ProjectBootstrapOperation | null>(null);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [pollLimitReached, setPollLimitReached] = useState(false);
  const idempotencyKey = useRef('');
  const pollingStartedAt = useRef<number | null>(null);
  const handoffScheduledForProject = useRef<string | null>(null);
  const startBootstrap = useStartProjectBootstrap();
  const bootstrapQuery = useGetProjectBootstrap(bootstrapId, {
    query: {
      enabled: Boolean(bootstrapId) && !pollLimitReached,
      queryKey: getGetProjectBootstrapQueryKey(bootstrapId),
      refetchInterval: (query) => {
        const status = query.state.data?.status;
        const timedOut = pollingStartedAt.current !== null && Date.now() - pollingStartedAt.current >= 120_000;
        if (status === 'completed' || status === 'failed' || timedOut) return false;
        return 1500;
      },
    },
  });
  const operation = bootstrapQuery.data ?? initialOperation;

  useEffect(() => {
    if (!bootstrapId || pollLimitReached || !pollingStartedAt.current) return;
    const remaining = Math.max(0, 120_000 - (Date.now() - pollingStartedAt.current));
    const timer = window.setTimeout(() => setPollLimitReached(true), remaining);
    return () => window.clearTimeout(timer);
  }, [bootstrapId, pollLimitReached]);

  useEffect(() => {
    if (operation?.status !== 'completed' || !operation.projectId) return;
    if (handoffScheduledForProject.current === operation.projectId) return;
    handoffScheduledForProject.current = operation.projectId;
    if (projectDescription.trim()) {
      try {
        sessionStorage.setItem(`eos_project_planning_handoff:${operation.projectId}`, projectDescription.trim());
      } catch {
        // The project remains available in chat; a storage restriction must not block navigation.
      }
    }
    void queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() }).finally(() => {
      setLocation(`/ai?projectId=${encodeURIComponent(operation.projectId!)}`);
    });
  }, [operation?.status, operation?.projectId, projectDescription, queryClient, setLocation]);

  const resetCreate = () => {
    setShowCreate(false);
    setProjectName('');
    setProjectDescription('');
    setBootstrapId('');
    setInitialOperation(null);
    setBootstrapError(null);
    setPollLimitReached(false);
    pollingStartedAt.current = null;
  };

  const submitCreate = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = projectName.trim();
    if (!name || startBootstrap.isPending) return;
    if (!idempotencyKey.current) idempotencyKey.current = crypto.randomUUID();
    setBootstrapError(null);
    setPollLimitReached(false);
    pollingStartedAt.current = Date.now();
    startBootstrap.mutate(
      { data: { idempotencyKey: idempotencyKey.current, name, description: projectDescription.trim() } },
      {
        onSuccess: (created) => {
          setInitialOperation(created);
          setBootstrapId(created.id);
        },
        onError: () => setBootstrapError('The creation request could not be started. No project is confirmed as created. You can retry safely.'),
      },
    );
  };

  const projectLoadFailure = isError ? classifyProjectError(error) : null;

  // Emit structured telemetry on first load failure (TanStack Query v5:
  // onError was removed from query options; useEffect is the correct place).
  useEffect(() => {
    if (error) emitProjectLoadFailed(error);
  }, [error]);

  const filtered = projects?.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <>
      {showDiscover && <DiscoverProjectWizard onClose={() => setShowDiscover(false)} />}
      {showCreate && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm" role="presentation">
          <section role="dialog" aria-modal="true" aria-labelledby="create-project-title" className="w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
            <div className="flex items-start justify-between border-b border-border px-6 py-5">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-primary">Project bootstrap / React + Vite</div>
                <h2 id="create-project-title" className="mt-1 text-xl font-semibold">Start from a governed starter</h2>
                <p className="mt-1 text-sm text-muted-foreground">EngineeringOS provisions the locked template and reports its durable operation status.</p>
              </div>
              <button type="button" onClick={resetCreate} aria-label="Close create project" data-testid="button-close-project-create" className="rounded-md p-2 text-muted-foreground hover:bg-secondary hover:text-foreground"><X className="h-4 w-4" /></button>
            </div>
            {!bootstrapId ? (
              <form onSubmit={submitCreate} className="space-y-5 px-6 py-6">
                <label className="block space-y-2">
                  <span className="text-sm font-medium">Project name</span>
                  <input autoFocus required maxLength={80} value={projectName} onChange={(event) => { setProjectName(event.target.value); idempotencyKey.current = ''; }} placeholder="e.g. Atlas Field Notes" data-testid="input-project-name" className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-primary/15" />
                  <span className="block text-right font-mono text-[10px] text-muted-foreground">{projectName.length}/80</span>
                </label>
                <label className="block space-y-2">
                  <span className="text-sm font-medium">What are you planning to build?</span>
                  <textarea maxLength={3000} rows={5} value={projectDescription} onChange={(event) => { setProjectDescription(event.target.value); idempotencyKey.current = ''; }} placeholder="Describe the problem, intended users, and the first useful outcome." data-testid="input-project-description" className="w-full resize-y rounded-lg border border-input bg-background px-3 py-2.5 text-sm leading-relaxed outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-primary/15" />
                  <span className="block text-right font-mono text-[10px] text-muted-foreground">{projectDescription.length}/3000</span>
                </label>
                <div className="flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs leading-relaxed text-muted-foreground">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <p>The starter is server-owned. Your description will arrive in project chat as an unsent planning prompt; it does not authorize edits or start an AI run.</p>
                </div>
                {bootstrapError && <p role="alert" data-testid="status-bootstrap-error" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{bootstrapError}</p>}
                <div className="flex justify-end gap-2 pt-1">
                  <button type="button" onClick={resetCreate} className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-secondary">Cancel</button>
                  <button type="submit" disabled={!projectName.trim() || startBootstrap.isPending} data-testid="button-start-project-bootstrap" className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50">
                    {startBootstrap.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                    {startBootstrap.isPending ? 'Starting operation…' : 'Create project'}
                  </button>
                </div>
              </form>
            ) : (
              <div className="px-6 py-7">
                <div className="flex items-center gap-3">
                  {operation?.status === 'completed' ? <CheckCircle2 className="h-5 w-5 text-emerald-400" /> : operation?.status === 'failed' || bootstrapQuery.isError ? <AlertTriangle className="h-5 w-5 text-amber-400" /> : <Loader2 className="h-5 w-5 animate-spin text-primary" />}
                  <div>
                    <div className="text-sm font-semibold" data-testid="status-bootstrap-operation">{operation?.status ?? (bootstrapQuery.isLoading ? 'queued' : 'checking')}</div>
                    <div className="text-xs text-muted-foreground">{operation?.status === 'completed' && operation.projectId ? 'Project is ready. Opening its project conversation…' : operation?.status === 'completed' ? 'The operation completed without a project reference. No project chat was opened.' : operation?.status === 'failed' ? 'The starter was not provisioned.' : 'Checking the durable operation. This view will update as the server reports progress.'}</div>
                  </div>
                </div>
                <div className="mt-5 rounded-lg border border-border bg-background/60 p-4 font-mono text-xs">
                  <div className="flex justify-between gap-3"><span className="text-muted-foreground">Operation</span><span className="break-all text-foreground">{operation?.id ?? bootstrapId}</span></div>
                  <div className="mt-2 flex justify-between gap-3"><span className="text-muted-foreground">Template</span><span className="text-foreground">{operation?.templateVersion ?? 'Locked React / Vite'}</span></div>
                  <div className="mt-2 flex justify-between gap-3"><span className="text-muted-foreground">Updated</span><span className="text-foreground">{operation?.updatedAt ? new Date(operation.updatedAt).toLocaleTimeString() : 'Waiting for first status read'}</span></div>
                </div>
                {operation?.status === 'failed' && (
                  <div role="alert" data-testid="status-bootstrap-failed" className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
                    <div className="font-medium text-amber-200">{operation.errorMessage || 'Project setup could not be completed.'}</div>
                    <div className="mt-1 text-xs text-muted-foreground">No project chat was opened. The server reported a safe failure state.</div>
                    {operation.errorCode && <div className="mt-2 font-mono text-[10px] text-muted-foreground">Code: {operation.errorCode}</div>}
                  </div>
                )}
                {operation?.status === 'completed' && !operation.projectId && (
                  <div role="alert" className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-100">
                    The server returned a completed operation without a project ID. No destination was inferred. Contact your workspace administrator with the operation ID above.
                  </div>
                )}
                {bootstrapQuery.isError && <p role="alert" className="mt-4 text-sm text-amber-200">The operation status is temporarily unavailable. The project was not assumed to be ready.</p>}
                {pollLimitReached && operation?.status !== 'completed' && operation?.status !== 'failed' && (
                  <div role="status" className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-100">
                    Status polling paused after the bounded wait. The operation may still be running.
                    <button type="button" onClick={() => { pollingStartedAt.current = Date.now(); setPollLimitReached(false); void bootstrapQuery.refetch(); }} data-testid="button-resume-bootstrap-polling" className="ml-2 inline-flex items-center gap-1 underline underline-offset-2">Check again <ArrowRight className="h-3 w-3" /></button>
                  </div>
                )}
                {(operation?.status === 'failed' || bootstrapQuery.isError || (operation?.status === 'completed' && !operation.projectId)) && (
                  <div className="mt-5 flex justify-end gap-2">
                    <button type="button" onClick={() => void bootstrapQuery.refetch()} className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-secondary">Retry status check</button>
                    <button type="button" onClick={resetCreate} className="rounded-lg bg-secondary px-3 py-2 text-sm hover:bg-secondary/80">Close</button>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      )}

      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Projects</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Manage repositories under autonomous observation.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter projects..."
                className="bg-card border border-border rounded-md pl-9 pr-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary w-64"
              />
            </div>
            <button
              onClick={() => setShowDiscover(true)}
              className="bg-primary hover:bg-primary/90 text-primary-foreground px-4 py-2 rounded-md font-medium text-sm flex items-center gap-2 shadow-sm transition-colors"
            >
              <Radar className="w-4 h-4" /> Discover Project
            </button>
            <button
              type="button"
              onClick={() => { idempotencyKey.current = ''; setShowCreate(true); }}
              data-testid="button-new-project"
              className="flex items-center gap-2 rounded-md border border-border bg-card px-4 py-2 text-sm font-medium transition-colors hover:border-primary/40 hover:bg-secondary"
            >
              <Plus className="h-4 w-4" /> New project
            </button>
          </div>
        </div>

        {isLoading && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="bg-card border border-border rounded-xl p-5 animate-pulse h-44" />
            ))}
          </div>
        )}

        {projectLoadFailure && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-14 h-14 rounded-2xl bg-destructive/10 border border-destructive/20 flex items-center justify-center mb-4">
              <Activity className="w-6 h-6 text-destructive/70" />
            </div>
            <h3 className="font-semibold text-lg mb-1">Could not load projects</h3>
            <p className="text-sm text-muted-foreground max-w-xs mb-5">
              {projectLoadFailure.message}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="bg-secondary hover:bg-secondary/80 text-foreground px-4 py-2 rounded-md text-sm font-medium transition-colors border border-border"
            >
              Refresh
            </button>
          </div>
        )}

        {!isLoading && !projectLoadFailure && (!filtered || filtered.length === 0) && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-4">
              <Radar className="w-7 h-7 text-primary/60" />
            </div>
            <h3 className="font-semibold text-lg mb-1">
              {search ? 'No projects match your search' : 'No projects yet'}
            </h3>
            <p className="text-sm text-muted-foreground max-w-xs mb-5">
              {search
                ? 'Try a different search term.'
                : 'Click Discover Project to let EngineeringOS autonomously analyze your first repository.'}
            </p>
            {!search && (
              <button
                onClick={() => setShowDiscover(true)}
                className="bg-primary hover:bg-primary/90 text-primary-foreground px-5 py-2.5 rounded-lg font-semibold text-sm flex items-center gap-2 transition-colors"
              >
                <Radar className="w-4 h-4" /> Discover Project
              </button>
            )}
          </div>
        )}

        {!isLoading && filtered && filtered.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map((project) => (
              <Link
                key={project.id}
                to={`/projects/${project.id}`}
                className="bg-card border border-border hover:border-primary/40 rounded-xl p-5 flex flex-col gap-3 transition-all hover:shadow-md hover:shadow-primary/5 group relative overflow-hidden"
              >
                <div className="absolute top-0 left-0 w-0.5 h-full bg-primary/0 group-hover:bg-primary/60 transition-all" />
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <FolderGit2 className="w-4 h-4 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <div className="font-semibold truncate">{project.name}</div>
                      <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5">
                        {project.language && (
                          <span className="font-mono bg-secondary/80 px-1.5 py-0.5 rounded text-[10px]">
                            {project.language}
                          </span>
                        )}
                        {project.framework && (
                          <span className="truncate text-muted-foreground/60">{project.framework}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div
                    className={`text-xs px-2 py-0.5 rounded-full border font-medium shrink-0 ${
                      project.status === 'active'
                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                        : project.status === 'scanning'
                        ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                        : 'bg-muted/50 text-muted-foreground border-border'
                    }`}
                  >
                    {project.status}
                  </div>
                </div>

                {project.description && (
                  <p className="text-xs text-muted-foreground line-clamp-2">{project.description}</p>
                )}

                <div className="text-sm text-muted-foreground font-mono truncate bg-secondary/50 px-3 py-2 rounded-md border border-border/50">
                  {project.rootPath}
                </div>

                <div className="mt-auto grid grid-cols-2 gap-3 pt-3 border-t border-border/50">
                  <div>
                    <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1 flex items-center gap-1">
                      <ShieldCheck className="w-3 h-3" /> Quality
                    </div>
                    <div className="font-mono font-bold text-lg flex items-baseline gap-1">
                      <span
                        className={
                          project.qualityScore && project.qualityScore >= 80
                            ? 'text-emerald-500'
                            : project.qualityScore && project.qualityScore >= 60
                            ? 'text-yellow-500'
                            : 'text-destructive'
                        }
                      >
                        {project.qualityScore ?? '--'}
                      </span>
                      <span className="text-xs text-muted-foreground font-sans font-normal">/ 100</span>
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
                      Last Scan
                    </div>
                    <div className="text-sm font-medium">
                      {project.lastScanAt
                        ? new Date(project.lastScanAt).toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : 'Never'}
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
