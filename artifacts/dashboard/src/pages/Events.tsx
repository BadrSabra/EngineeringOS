import React, { useMemo, useState } from 'react';
import { useListEvents, useListProjects } from '@workspace/api-client-react';
import { Search, Filter, X } from 'lucide-react';

const SEVERITIES = ['info', 'warning', 'error', 'success'] as const;

export default function Events() {
  const { data: projects } = useListProjects();
  const [projectId, setProjectId] = useState('');
  const [severity, setSeverity] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  const { data: events, isLoading } = useListEvents({
    limit: 200,
    ...(projectId ? { projectId } : {}),
  });

  const filteredEvents = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return (events || []).filter((evt) => {
      if (severity && evt.severity !== severity) return false;
      if (
        term &&
        !(evt.message || '').toLowerCase().includes(term) &&
        !evt.type.toLowerCase().includes(term)
      )
        return false;
      return true;
    });
  }, [events, severity, searchTerm]);

  const activeFilterCount = [projectId, severity].filter(Boolean).length;

  return (
    <div className="space-y-6 h-full flex flex-col">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 shrink-0">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Event Stream</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Real-time log of all system activities.
            {filteredEvents.length !== (events || []).length &&
              ` Showing ${filteredEvents.length} of ${events?.length ?? 0}.`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search logs..."
              className="bg-card border border-border rounded-md pl-9 pr-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary w-64"
            />
          </div>
          <button
            onClick={() => setShowFilters((v) => !v)}
            className={`p-2 border rounded-md transition-colors relative ${
              showFilters || activeFilterCount > 0
                ? 'border-primary text-primary bg-primary/10'
                : 'border-border hover:bg-secondary text-muted-foreground'
            }`}
          >
            <Filter className="w-4 h-4" />
            {activeFilterCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 bg-primary text-primary-foreground text-[10px] w-4 h-4 rounded-full flex items-center justify-center font-bold">
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {showFilters && (
        <div className="flex flex-wrap items-center gap-3 shrink-0 bg-card border border-border rounded-xl p-4">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground font-medium">Project</span>
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="bg-secondary/50 border border-border rounded-md px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">All projects</option>
              {projects?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground font-medium">Severity</span>
            <select
              value={severity}
              onChange={(e) => setSeverity(e.target.value)}
              className="bg-secondary/50 border border-border rounded-md px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">All severities</option>
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          {activeFilterCount > 0 && (
            <button
              onClick={() => {
                setProjectId('');
                setSeverity('');
              }}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <X className="w-3 h-3" /> Clear
            </button>
          )}
        </div>
      )}

      <div className="flex-1 bg-[#0a0a0a] border border-border rounded-xl shadow-sm overflow-hidden flex flex-col font-mono text-sm relative">
        <div className="p-2 border-b border-border bg-card/50 flex gap-4 text-xs text-muted-foreground sticky top-0 z-10 shadow-sm backdrop-blur-md">
          <div className="w-32">Timestamp</div>
          <div className="w-16">Level</div>
          <div className="w-32">Type</div>
          <div className="w-48 truncate">Project</div>
          <div className="flex-1">Message</div>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {isLoading ? (
            <div className="p-4 text-primary animate-pulse flex items-center gap-2">
              <span className="w-2 h-2 bg-primary rounded-full animate-ping"></span> Loading events…
            </div>
          ) : (events?.length ?? 0) === 0 ? (
            <div className="p-8 text-muted-foreground opacity-50">No events recorded.</div>
          ) : filteredEvents.length === 0 ? (
            <div className="p-8 text-muted-foreground opacity-50">No events match the current filters.</div>
          ) : (
            <div className="space-y-0.5">
              {filteredEvents.map((evt) => {
                const color =
                  evt.severity === 'error'
                    ? 'text-red-400 bg-red-950/20'
                    : evt.severity === 'success'
                    ? 'text-green-400'
                    : evt.severity === 'warning'
                    ? 'text-yellow-400 bg-yellow-950/20'
                    : 'text-blue-400';

                return (
                  <div
                    key={evt.id}
                    className={`flex gap-4 p-1.5 rounded hover:bg-white/5 transition-colors ${color}`}
                  >
                    <div className="w-32 opacity-70 shrink-0">
                      {new Date(evt.timestamp).toISOString().split('T')[1].replace('Z', '')}
                    </div>
                    <div className="w-16 font-bold uppercase shrink-0">
                      {evt.severity || 'INFO'}
                    </div>
                    <div className="w-32 opacity-80 shrink-0 truncate">{evt.type}</div>
                    <div className="w-48 opacity-60 shrink-0 truncate">{evt.projectId || '-'}</div>
                    <div className="flex-1 whitespace-pre-wrap break-words">{evt.message}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
