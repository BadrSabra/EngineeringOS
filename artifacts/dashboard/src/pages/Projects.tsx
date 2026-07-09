import React, { useState } from 'react';
import {
  useListProjects,
  useCreateProject,
  getListProjectsQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  Search,
  GitBranch,
  Activity,
  ShieldCheck,
  FolderGit2,
} from 'lucide-react';
import { Link } from 'wouter';

export default function Projects() {
  const queryClient = useQueryClient();
  const { data: projects, isLoading } = useListProjects();
  const createProject = useCreateProject();

  const [showCreate, setShowCreate] = useState(false);
  const [newProject, setNewProject] = useState({
    name: '',
    rootPath: '',
    language: 'typescript',
    framework: '',
  });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    createProject.mutate(
      { data: newProject },
      {
        onSuccess: () => {
          setShowCreate(false);
          queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
          setNewProject({ name: '', rootPath: '', language: 'typescript', framework: '' });
        },
      },
    );
  };

  return (
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
              placeholder="Filter projects..."
              className="bg-card border border-border rounded-md pl-9 pr-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary w-64"
            />
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="bg-primary hover:bg-primary/90 text-primary-foreground px-4 py-2 rounded-md font-medium text-sm flex items-center gap-2 shadow-sm transition-colors"
          >
            <Plus className="w-4 h-4" /> Register Project
          </button>
        </div>
      </div>

      {showCreate && (
        <div className="bg-card border border-primary/30 rounded-xl p-5 mb-6 shadow-md relative overflow-hidden">
          <div className="absolute top-0 left-0 w-1 h-full bg-primary"></div>
          <h3 className="font-semibold mb-4 text-lg">Register New Project</h3>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Project Name
                </label>
                <input
                  required
                  value={newProject.name}
                  onChange={(e) => setNewProject({ ...newProject, name: e.target.value })}
                  className="w-full bg-secondary border border-border rounded-md px-3 py-2 text-sm focus:border-primary focus:outline-none"
                  placeholder="e.g. backend-api"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Root Path
                </label>
                <input
                  required
                  value={newProject.rootPath}
                  onChange={(e) => setNewProject({ ...newProject, rootPath: e.target.value })}
                  className="w-full bg-secondary border border-border rounded-md px-3 py-2 text-sm focus:border-primary focus:outline-none font-mono"
                  placeholder="/var/repos/backend-api"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Language
                </label>
                <select
                  value={newProject.language}
                  onChange={(e) => setNewProject({ ...newProject, language: e.target.value })}
                  className="w-full bg-secondary border border-border rounded-md px-3 py-2 text-sm focus:border-primary focus:outline-none"
                >
                  <option value="typescript">TypeScript</option>
                  <option value="javascript">JavaScript</option>
                  <option value="python">Python</option>
                  <option value="go">Go</option>
                  <option value="rust">Rust</option>
                  <option value="java">Java</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Framework (optional)
                </label>
                <input
                  value={newProject.framework}
                  onChange={(e) => setNewProject({ ...newProject, framework: e.target.value })}
                  className="w-full bg-secondary border border-border rounded-md px-3 py-2 text-sm focus:border-primary focus:outline-none"
                  placeholder="e.g. express, fastapi, gin"
                />
              </div>
            </div>
            <div className="flex gap-3">
              <button
                type="submit"
                disabled={createProject.isPending}
                className="bg-primary hover:bg-primary/90 text-primary-foreground px-4 py-2 rounded-md font-medium text-sm disabled:opacity-50 transition-colors"
              >
                {createProject.isPending ? 'Registering…' : 'Register'}
              </button>
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="px-4 py-2 rounded-md font-medium text-sm border border-border hover:bg-secondary transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-48 bg-card border border-border rounded-xl animate-pulse" />
          ))}
        </div>
      ) : projects?.length === 0 ? (
        <div className="border-2 border-dashed border-border rounded-xl p-16 text-center flex flex-col items-center">
          <FolderGit2 className="w-12 h-12 text-muted-foreground mb-4 opacity-50" />
          <h3 className="text-lg font-semibold mb-2">No projects registered</h3>
          <p className="text-muted-foreground text-sm max-w-sm mb-6">
            Register a repository to begin autonomous quality scanning and task orchestration.
          </p>
          <button
            onClick={() => setShowCreate(true)}
            className="bg-primary hover:bg-primary/90 text-primary-foreground px-4 py-2 rounded-md font-medium text-sm flex items-center gap-2"
          >
            <Plus className="w-4 h-4" /> Register First Project
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects?.map((project) => (
            <Link
              key={project.id}
              href={`/projects/${project.id}`}
              className="group bg-card border border-border hover:border-primary/50 rounded-xl p-5 shadow-sm transition-colors flex flex-col"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary shrink-0">
                    <FolderGit2 className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-lg leading-tight group-hover:text-primary transition-colors">
                      {project.name}
                    </h3>
                    <div className="text-xs text-muted-foreground flex items-center gap-1.5 mt-1 font-mono">
                      <GitBranch className="w-3 h-3" /> main
                    </div>
                  </div>
                </div>
                <div
                  className={`px-2.5 py-1 rounded text-xs font-medium uppercase tracking-wider flex items-center gap-1.5
                  ${
                    project.status === 'active'
                      ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20'
                      : project.status === 'scanning'
                      ? 'bg-primary/10 text-primary border border-primary/20'
                      : 'bg-secondary text-muted-foreground border border-border'
                  }`}
                >
                  {project.status === 'active' && (
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                  )}
                  {project.status === 'scanning' && (
                    <Activity className="w-3 h-3 animate-pulse" />
                  )}
                  {project.status}
                </div>
              </div>

              <div className="text-sm text-muted-foreground font-mono truncate bg-secondary/50 px-3 py-2 rounded-md border border-border/50 mb-4">
                {project.rootPath}
              </div>

              <div className="mt-auto grid grid-cols-2 gap-3 pt-4 border-t border-border/50">
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
  );
}
