import React, { useState } from 'react';
import {
  useListGraphEntities,
  useListProjects,
} from '@workspace/api-client-react';
import { Network, Search, Layers, Database } from 'lucide-react';
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  ZAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';

export default function Graph() {
  const { data: projects } = useListProjects();
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');

  const effectiveProjectId = selectedProjectId || (projects?.[0]?.id ?? '');

  const { data: entities, isLoading: entitiesLoading } = useListGraphEntities(
    { projectId: effectiveProjectId },
    { query: { enabled: !!effectiveProjectId, staleTime: 30_000 } },
  );

  const scatterData =
    entities?.map((e) => {
      const numId = e.id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
      let color = '#3b82f6';
      if (e.type === 'file') color = '#10b981';
      if (e.type === 'function') color = '#f59e0b';
      if (e.type === 'class') color = '#8b5cf6';
      if (e.type === 'api') color = '#ef4444';
      return {
        x: (numId * 13) % 100,
        y: (numId * 17) % 100,
        z: e.type === 'file' ? 400 : 200,
        name: e.name,
        type: e.type,
        id: e.id,
        color,
      };
    }) || [];

  return (
    <div className="space-y-6 h-full flex flex-col">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 shrink-0">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Network className="w-6 h-6 text-primary" /> Knowledge Graph
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Abstract syntax tree and dependency mapping.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={effectiveProjectId}
            onChange={(e) => setSelectedProjectId(e.target.value)}
            className="bg-card border border-border rounded-md px-3 py-2 text-sm focus:border-primary focus:outline-none w-48 font-medium"
          >
            {projects?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Find entity..."
              className="bg-card border border-border rounded-md pl-9 pr-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary w-64"
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-6 flex-1 min-h-[500px]">
        <div className="col-span-1 bg-card border border-border rounded-xl p-4 shadow-sm flex flex-col overflow-hidden">
          <h3 className="font-semibold mb-4 text-sm flex items-center gap-2">
            <Layers className="w-4 h-4" /> Node Types
          </h3>
          <div className="space-y-2 mb-6 text-sm">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-[#10b981]"></div> Files
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-[#f59e0b]"></div> Functions
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-[#8b5cf6]"></div> Classes
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-[#ef4444]"></div> APIs
            </div>
          </div>

          <h3 className="font-semibold mb-4 text-sm flex items-center gap-2 border-t border-border pt-4">
            <Database className="w-4 h-4" /> Entities List
          </h3>
          <div className="flex-1 overflow-y-auto pr-2 space-y-1">
            {entitiesLoading ? (
              <div className="text-sm text-muted-foreground animate-pulse">Loading nodes...</div>
            ) : (
              entities?.slice(0, 50).map((entity) => (
                <div
                  key={entity.id}
                  className="text-xs p-2 bg-secondary/50 rounded border border-border/50 truncate cursor-pointer hover:bg-secondary transition-colors"
                  title={entity.name}
                >
                  <span className="font-mono opacity-50 mr-2">
                    {entity.type.charAt(0).toUpperCase()}
                  </span>
                  {entity.name}
                </div>
              ))
            )}
          </div>
        </div>

        <div className="col-span-3 bg-card border border-border rounded-xl shadow-sm relative overflow-hidden flex items-center justify-center">
          {entitiesLoading ? (
            <div className="text-primary animate-pulse flex items-center gap-2">
              <Network className="w-5 h-5 animate-spin" /> Computing layout...
            </div>
          ) : scatterData.length === 0 ? (
            <div className="text-muted-foreground text-sm">
              No graph data available for this project.
            </div>
          ) : (
            <div className="w-full h-full absolute inset-0 p-8">
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                  <XAxis type="number" dataKey="x" name="X" hide domain={[0, 100]} />
                  <YAxis type="number" dataKey="y" name="Y" hide domain={[0, 100]} />
                  <ZAxis type="number" dataKey="z" range={[50, 400]} />
                  <Tooltip
                    cursor={{ strokeDasharray: '3 3' }}
                    content={({ active, payload }) => {
                      if (active && payload && payload.length) {
                        const data = payload[0].payload;
                        return (
                          <div className="bg-card border border-border p-3 rounded-lg shadow-xl">
                            <p className="font-semibold text-sm">{data.name}</p>
                            <p className="text-xs text-muted-foreground uppercase font-mono mt-1">
                              {data.type}
                            </p>
                            <p className="text-[10px] text-muted-foreground font-mono mt-2">
                              {data.id}
                            </p>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  <Scatter name="Nodes" data={scatterData}>
                    {scatterData.map((entry, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={entry.color}
                        opacity={0.8}
                        stroke="rgba(255,255,255,0.2)"
                        strokeWidth={2}
                      />
                    ))}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
