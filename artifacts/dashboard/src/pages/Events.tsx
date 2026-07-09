import React from 'react';
import { useListEvents } from '@workspace/api-client-react';
import { Activity, AlertTriangle, CheckCircle2, Search, Filter } from 'lucide-react';

export default function Events() {
  const { data: events, isLoading } = useListEvents({ limit: 100 });

  return (
    <div className="space-y-6 h-full flex flex-col">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 shrink-0">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Event Stream</h1>
          <p className="text-muted-foreground text-sm mt-1">Real-time log of all system activities.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search logs..."
              className="bg-card border border-border rounded-md pl-9 pr-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary w-64"
            />
          </div>
          <button className="p-2 border border-border rounded-md hover:bg-secondary text-muted-foreground transition-colors">
            <Filter className="w-4 h-4" />
          </button>
        </div>
      </div>

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
              <span className="w-2 h-2 bg-primary rounded-full animate-ping"></span> Connecting to
              event stream...
            </div>
          ) : events?.length === 0 ? (
            <div className="p-8 text-muted-foreground opacity-50">No events recorded.</div>
          ) : (
            <div className="space-y-0.5">
              {events?.map((evt) => {
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
