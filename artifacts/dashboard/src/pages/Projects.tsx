import React, { useState, useEffect } from 'react';
import {
  useListProjects,
  getListProjectsQueryKey,
  classifyProjectError,
  isRetryableProjectError,
  emitProjectLoadFailed,
} from '@workspace/api-client-react';
import {
  Search,
  Activity,
  ShieldCheck,
  FolderGit2,
  Radar,
} from 'lucide-react';
import { Link } from 'wouter';
import { DiscoverProjectWizard } from './DiscoverProjectWizard';

export default function Projects() {
  const { data: projects, isLoading, isError, error } = useListProjects({
    query: {
      queryKey: getListProjectsQueryKey(),
      retry: (failureCount, err) => isRetryableProjectError(err, failureCount),
    },
  });
  const [showDiscover, setShowDiscover] = useState(false);
  const [search, setSearch] = useState('');

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

      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Projects</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Manage repositories under autonomous observation.
            </p>
          </div>
          <div className="flex items-center gap-3">
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
