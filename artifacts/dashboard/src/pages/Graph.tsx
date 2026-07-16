import React, { useMemo, useState, useEffect, useRef } from 'react';
import {
  useListGraphEntities,
  useListGraphRelationships,
  useListProjects,
  useGetGraphEntityNeighbors,
  useGetGraphEntityImpact,
  useGetGraphSummary,
  getListGraphEntitiesQueryKey,
  getListGraphRelationshipsQueryKey,
  getGetGraphSummaryQueryKey,
  getGetGraphEntityNeighborsQueryKey,
  getGetGraphEntityImpactQueryKey,
} from '@workspace/api-client-react';
import type { GraphEntity, GraphRelationship } from '@workspace/api-client-react';
import {
  Network,
  Search,
  Layers,
  Zap,
  GitMerge,
  X,
  AlertCircle,
} from 'lucide-react';

// ─── Force layout ─────────────────────────────────────────────────────────────

type Vec2 = { x: number; y: number };

function runForceLayout(
  entities: GraphEntity[],
  relationships: GraphRelationship[],
  width: number,
  height: number,
  iterations = 80,
): Map<string, Vec2> {
  if (entities.length === 0) return new Map();

  const cx = width / 2;
  const cy = height / 2;
  const r = Math.min(width, height) * 0.38;

  // Initialise: arrange by type in sectors to reduce initial crossings
  const types = [...new Set(entities.map((e) => e.type))];
  const positions = new Map<string, Vec2>();

  entities.forEach((e, i) => {
    const typeIdx = types.indexOf(e.type);
    const typeGroup = entities.filter((x) => x.type === e.type);
    const posInGroup = typeGroup.indexOf(e);
    const baseAngle = (typeIdx / types.length) * 2 * Math.PI;
    const spread = (posInGroup / Math.max(typeGroup.length, 1) - 0.5) * (2 * Math.PI / types.length);
    const angle = baseAngle + spread;
    positions.set(e.id, { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) });
  });

  const adj = new Map<string, Set<string>>();
  for (const e of entities) adj.set(e.id, new Set());
  for (const rel of relationships) {
    adj.get(rel.sourceId)?.add(rel.targetId);
    adj.get(rel.targetId)?.add(rel.sourceId);
  }

  const k = Math.sqrt((width * height) / Math.max(entities.length, 1)) * 0.6;
  const velocities = new Map<string, Vec2>();
  for (const e of entities) velocities.set(e.id, { x: 0, y: 0 });

  for (let iter = 0; iter < iterations; iter++) {
    const cooling = 1 - iter / iterations;
    const maxDisp = k * cooling;

    const disp = new Map<string, Vec2>();
    for (const e of entities) disp.set(e.id, { x: 0, y: 0 });

    // Repulsion between all pairs
    for (let i = 0; i < entities.length; i++) {
      for (let j = i + 1; j < entities.length; j++) {
        const a = entities[i];
        const b = entities[j];
        const pa = positions.get(a.id)!;
        const pb = positions.get(b.id)!;
        const dx = pa.x - pb.x;
        const dy = pa.y - pb.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const force = (k * k) / dist;
        const da = disp.get(a.id)!;
        const db = disp.get(b.id)!;
        da.x += (dx / dist) * force;
        da.y += (dy / dist) * force;
        db.x -= (dx / dist) * force;
        db.y -= (dy / dist) * force;
      }
    }

    // Attraction along edges
    for (const rel of relationships) {
      const pa = positions.get(rel.sourceId);
      const pb = positions.get(rel.targetId);
      if (!pa || !pb) continue;
      const dx = pb.x - pa.x;
      const dy = pb.y - pa.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const force = (dist * dist) / k;
      const da = disp.get(rel.sourceId);
      const db = disp.get(rel.targetId);
      if (da) { da.x += (dx / dist) * force; da.y += (dy / dist) * force; }
      if (db) { db.x -= (dx / dist) * force; db.y -= (dy / dist) * force; }
    }

    // Weak gravity toward center
    for (const e of entities) {
      const p = positions.get(e.id)!;
      const d = disp.get(e.id)!;
      d.x += (cx - p.x) * 0.02;
      d.y += (cy - p.y) * 0.02;
    }

    // Apply displacements with cooling, clamp to bounds
    const pad = 24;
    for (const e of entities) {
      const p = positions.get(e.id)!;
      const d = disp.get(e.id)!;
      const len = Math.sqrt(d.x * d.x + d.y * d.y) || 0.01;
      const clamped = Math.min(len, maxDisp);
      p.x = Math.max(pad, Math.min(width - pad, p.x + (d.x / len) * clamped));
      p.y = Math.max(pad, Math.min(height - pad, p.y + (d.y / len) * clamped));
    }
  }

  return positions;
}

// ─── Colour helpers ───────────────────────────────────────────────────────────

const TYPE_COLORS: Record<string, string> = {
  file:     '#10b981',
  function: '#f59e0b',
  class:    '#8b5cf6',
  api:      '#ef4444',
  task:     '#3b82f6',
  rule:     '#ec4899',
  phase:    '#14b8a6',
  module:   '#6366f1',
};
const DEFAULT_COLOR = '#94a3b8';

function nodeColor(type: string) { return TYPE_COLORS[type] ?? DEFAULT_COLOR; }

// ─── Component ────────────────────────────────────────────────────────────────

export default function Graph() {
  const { data: projects } = useListProjects();
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [selectedEntityId, setSelectedEntityId] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [detailTab, setDetailTab] = useState<'relations' | 'impact'>('relations');
  const [_impactExpanded, _setImpactExpanded] = useState(false);

  const svgRef = useRef<SVGSVGElement>(null);
  const [svgSize, setSvgSize] = useState({ w: 600, h: 420 });

  const effectiveProjectId = selectedProjectId || (projects?.[0]?.id ?? '');

  const { data: entities = [], isLoading: entitiesLoading } = useListGraphEntities(
    { projectId: effectiveProjectId },
    { query: { queryKey: getListGraphEntitiesQueryKey({ projectId: effectiveProjectId }), enabled: !!effectiveProjectId, staleTime: 30_000 } },
  );

  const { data: relationships = [] } = useListGraphRelationships(
    { projectId: effectiveProjectId },
    { query: { queryKey: getListGraphRelationshipsQueryKey({ projectId: effectiveProjectId }), enabled: !!effectiveProjectId, staleTime: 30_000 } },
  );

  const { data: summary } = useGetGraphSummary(
    effectiveProjectId,
    { query: { queryKey: getGetGraphSummaryQueryKey(effectiveProjectId), enabled: !!effectiveProjectId, staleTime: 60_000 } },
  );

  const { data: neighborData } = useGetGraphEntityNeighbors(
    selectedEntityId,
    { query: { queryKey: getGetGraphEntityNeighborsQueryKey(selectedEntityId), enabled: !!selectedEntityId, staleTime: 30_000 } },
  );

  const { data: impactData, isLoading: impactLoading } = useGetGraphEntityImpact(
    { entityId: selectedEntityId, maxDepth: 3 },
    { query: { queryKey: getGetGraphEntityImpactQueryKey({ entityId: selectedEntityId, maxDepth: 3 }), enabled: !!selectedEntityId && detailTab === 'impact', staleTime: 30_000 } },
  );

  // Measure SVG container
  useEffect(() => {
    if (!svgRef.current) return;
    const obs = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) setSvgSize({ w: width, h: height });
    });
    obs.observe(svgRef.current);
    return () => obs.disconnect();
  }, []);

  // Compute force layout whenever data or size changes
  const positions = useMemo(
    () => runForceLayout(entities, relationships, svgSize.w, svgSize.h),
    [entities, relationships, svgSize],
  );

  // Highlight sets
  const neighborIds = useMemo(() => {
    const s = new Set<string>();
    neighborData?.neighbors.forEach((n) => s.add(n.id));
    return s;
  }, [neighborData]);

  const impactedIds = useMemo(() => {
    const s = new Set<string>();
    impactData?.impacted?.forEach((h) => s.add(h.entity.id));
    return s;
  }, [impactData]);

  const connectedRelIds = useMemo(() => {
    if (!selectedEntityId) return new Set<string>();
    const s = new Set<string>();
    neighborData?.outgoing.forEach((r) => s.add(r.id));
    neighborData?.incoming.forEach((r) => s.add(r.id));
    return s;
  }, [neighborData, selectedEntityId]);

  const entityById = useMemo(() => {
    const m = new Map<string, GraphEntity>();
    entities.forEach((e) => m.set(e.id, e));
    return m;
  }, [entities]);

  const filteredEntities = useMemo(
    () => entities.filter((e) => e.name.toLowerCase().includes(searchTerm.toLowerCase())),
    [entities, searchTerm],
  );

  function nodeRadius(e: GraphEntity) {
    if (e.id === selectedEntityId) return 12;
    if (neighborIds.has(e.id) || impactedIds.has(e.id)) return 9;
    return 7;
  }

  function nodeOpacity(e: GraphEntity) {
    if (!selectedEntityId) return 1;
    if (e.id === selectedEntityId) return 1;
    if (neighborIds.has(e.id) || impactedIds.has(e.id)) return 0.9;
    return 0.18;
  }

  function edgeOpacity(r: GraphRelationship) {
    if (!selectedEntityId) return 0.25;
    if (connectedRelIds.has(r.id)) return 0.85;
    return 0.05;
  }

  return (
    <div className="space-y-4 h-full flex flex-col">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Network className="w-6 h-6 text-primary" /> Knowledge Graph
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Structural dependency map extracted from source code.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={effectiveProjectId}
            onChange={(e) => { setSelectedProjectId(e.target.value); setSelectedEntityId(''); }}
            className="bg-card border border-border rounded-md px-3 py-2 text-sm focus:border-primary focus:outline-none w-48 font-medium"
          >
            {projects?.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Find entity..."
              className="bg-card border border-border rounded-md pl-9 pr-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary w-56"
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-[220px_1fr_260px] gap-4 flex-1 min-h-0">
        {/* Left sidebar: legend + summary + entity list */}
        <div className="bg-card border border-border rounded-xl p-4 shadow-sm flex flex-col overflow-hidden">
          {/* Type legend */}
          <h3 className="font-semibold text-xs uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5" /> Node Types
          </h3>
          <div className="grid grid-cols-2 gap-1 mb-4 text-xs">
            {Object.entries(TYPE_COLORS).map(([type, color]) => (
              <div key={type} className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                <span className="capitalize text-muted-foreground">{type}</span>
              </div>
            ))}
          </div>

          {/* Summary stats */}
          {summary && (
            <div className="border-t border-border pt-3 mb-4 space-y-2">
              <h3 className="font-semibold text-xs uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
                <GitMerge className="w-3.5 h-3.5" /> Graph Stats
              </h3>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-secondary/50 rounded-lg p-2 text-center">
                  <div className="font-mono font-bold text-lg text-primary">{summary.entityCount}</div>
                  <div className="text-muted-foreground">Entities</div>
                </div>
                <div className="bg-secondary/50 rounded-lg p-2 text-center">
                  <div className="font-mono font-bold text-lg text-primary">{summary.relationshipCount}</div>
                  <div className="text-muted-foreground">Relations</div>
                </div>
                <div className="bg-secondary/50 rounded-lg p-2 text-center">
                  <div className="font-mono font-bold text-lg">{summary.clusterCount}</div>
                  <div className="text-muted-foreground">Clusters</div>
                </div>
                <div className="bg-secondary/50 rounded-lg p-2 text-center">
                  <div className="font-mono font-bold text-lg">{summary.avgDegree.toFixed(1)}</div>
                  <div className="text-muted-foreground">Avg degree</div>
                </div>
              </div>
              {summary.isolatedCount > 0 && (
                <div className="text-xs text-muted-foreground bg-secondary/30 rounded px-2 py-1">
                  {summary.isolatedCount} isolated node{summary.isolatedCount !== 1 ? 's' : ''}
                </div>
              )}
            </div>
          )}

          {/* Entity list */}
          <div className="border-t border-border pt-3 flex flex-col flex-1 min-h-0">
            <h3 className="font-semibold text-xs uppercase tracking-wider text-muted-foreground mb-2">
              Entities ({filteredEntities.length})
            </h3>
            <div className="flex-1 overflow-y-auto space-y-0.5 pr-1">
              {entitiesLoading ? (
                <div className="text-xs text-muted-foreground animate-pulse">Loading...</div>
              ) : filteredEntities.length === 0 ? (
                <div className="text-xs text-muted-foreground italic">No entities found.</div>
              ) : (
                filteredEntities.slice(0, 150).map((entity) => (
                  <button
                    key={entity.id}
                    onClick={() => setSelectedEntityId(entity.id === selectedEntityId ? '' : entity.id)}
                    className={`w-full text-left text-xs p-1.5 rounded border truncate transition-colors ${
                      entity.id === selectedEntityId
                        ? 'bg-primary/20 border-primary text-foreground'
                        : 'bg-transparent border-transparent hover:bg-secondary text-muted-foreground hover:text-foreground'
                    }`}
                    title={entity.name}
                  >
                    <span
                      className="inline-block w-2 h-2 rounded-full mr-1.5 shrink-0"
                      style={{ backgroundColor: nodeColor(entity.type) }}
                    />
                    {entity.name}
                  </button>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Center: SVG graph canvas */}
        <div className="bg-card border border-border rounded-xl shadow-sm relative overflow-hidden">
          {entitiesLoading ? (
            <div className="absolute inset-0 flex items-center justify-center text-primary animate-pulse gap-2 text-sm">
              <Network className="w-5 h-5 animate-spin" /> Computing layout…
            </div>
          ) : entities.length === 0 ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground text-sm gap-3">
              <Network className="w-10 h-10 opacity-20" />
              <p>No graph data for this project.</p>
              <p className="text-xs opacity-70">Run a scan to extract the knowledge graph.</p>
            </div>
          ) : (
            <svg
              ref={svgRef}
              className="w-full h-full"
              onClick={() => setSelectedEntityId('')}
            >
              <defs>
                <marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                  <path d="M0,0 L0,6 L6,3 z" fill="rgba(148,163,184,0.5)" />
                </marker>
                {selectedEntityId && (
                  <filter id="glow">
                    <feGaussianBlur stdDeviation="3" result="blur" />
                    <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                  </filter>
                )}
              </defs>

              {/* Edges */}
              <g>
                {relationships.map((r) => {
                  const src = positions.get(r.sourceId);
                  const tgt = positions.get(r.targetId);
                  if (!src || !tgt) return null;
                  const isConnected = connectedRelIds.has(r.id);
                  const isImpact = impactedIds.has(r.targetId) && r.sourceId === selectedEntityId;
                  return (
                    <line
                      key={r.id}
                      x1={src.x} y1={src.y}
                      x2={tgt.x} y2={tgt.y}
                      stroke={isImpact ? '#f59e0b' : isConnected ? '#6366f1' : '#94a3b8'}
                      strokeOpacity={edgeOpacity(r)}
                      strokeWidth={isConnected ? 1.5 : 1}
                      markerEnd="url(#arrow)"
                    />
                  );
                })}
              </g>

              {/* Nodes */}
              <g>
                {entities.map((e) => {
                  const pos = positions.get(e.id);
                  if (!pos) return null;
                  const isSelected = e.id === selectedEntityId;
                  const isNeighbor = neighborIds.has(e.id);
                  const isImpacted = impactedIds.has(e.id);
                  const color = nodeColor(e.type);
                  const rad = nodeRadius(e);
                  return (
                    <g
                      key={e.id}
                      transform={`translate(${pos.x},${pos.y})`}
                      onClick={(ev) => { ev.stopPropagation(); setSelectedEntityId(e.id === selectedEntityId ? '' : e.id); setDetailTab('relations'); }}
                      style={{ cursor: 'pointer', opacity: nodeOpacity(e) }}
                    >
                      {isSelected && (
                        <circle r={rad + 6} fill={color} opacity={0.2} filter="url(#glow)" />
                      )}
                      {isImpacted && !isSelected && (
                        <circle r={rad + 4} fill="#f59e0b" opacity={0.2} />
                      )}
                      <circle
                        r={rad}
                        fill={color}
                        stroke={isSelected ? '#fff' : isNeighbor ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.15)'}
                        strokeWidth={isSelected ? 2 : 1}
                      />
                      {(isSelected || (entities.length < 30 && rad >= 7)) && (
                        <text
                          y={rad + 11}
                          textAnchor="middle"
                          fill="currentColor"
                          fontSize={9}
                          className="fill-foreground"
                          style={{ pointerEvents: 'none', userSelect: 'none' }}
                        >
                          {e.name.length > 18 ? e.name.slice(0, 16) + '…' : e.name}
                        </text>
                      )}
                    </g>
                  );
                })}
              </g>
            </svg>
          )}
        </div>

        {/* Right sidebar: entity detail */}
        <div className="bg-card border border-border rounded-xl p-4 shadow-sm flex flex-col overflow-hidden">
          {!selectedEntityId ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center text-sm text-muted-foreground gap-3 px-4">
              <Network className="w-8 h-8 opacity-20" />
              <p>Select a node to explore its relationships and impact.</p>
              {summary && summary.topConnected.length > 0 && (
                <div className="mt-4 w-full text-left">
                  <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">
                    Most connected
                  </p>
                  <div className="space-y-1">
                    {summary.topConnected.slice(0, 5).map((c) => {
                      entityById.get(c.entityId);
                      return (
                        <button
                          key={c.entityId}
                          onClick={() => setSelectedEntityId(c.entityId)}
                          className="w-full flex items-center justify-between gap-2 text-xs p-1.5 rounded hover:bg-secondary transition-colors"
                        >
                          <div className="flex items-center gap-1.5 min-w-0">
                            <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: nodeColor(c.entityType) }} />
                            <span className="truncate">{c.entityName}</span>
                          </div>
                          <span className="font-mono text-primary shrink-0">{c.totalDegree}°</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ) : neighborData ? (
            <>
              {/* Entity header */}
              <div className="flex items-start justify-between gap-2 mb-3 shrink-0">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: nodeColor(neighborData.entity.type) }} />
                    <span className="text-xs uppercase font-mono text-muted-foreground">{neighborData.entity.type}</span>
                  </div>
                  <h3 className="font-semibold text-sm truncate" title={neighborData.entity.name}>
                    {neighborData.entity.name}
                  </h3>
                  {neighborData.entity.path && (
                    <p className="text-xs text-muted-foreground font-mono truncate mt-0.5" title={neighborData.entity.path}>
                      {neighborData.entity.path}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => setSelectedEntityId('')}
                  className="text-muted-foreground hover:text-foreground shrink-0 mt-0.5"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Tabs */}
              <div className="flex gap-1 mb-3 shrink-0">
                <button
                  onClick={() => setDetailTab('relations')}
                  className={`flex-1 text-xs py-1.5 rounded-md font-medium transition-colors ${detailTab === 'relations' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary'}`}
                >
                  Relations
                </button>
                <button
                  onClick={() => setDetailTab('impact')}
                  className={`flex-1 text-xs py-1.5 rounded-md font-medium transition-colors flex items-center justify-center gap-1 ${detailTab === 'impact' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary'}`}
                >
                  <Zap className="w-3 h-3" /> Impact
                </button>
              </div>

              <div className="flex-1 overflow-y-auto min-h-0">
                {/* Relations tab */}
                {detailTab === 'relations' && (
                  <div className="space-y-4 pr-1">
                    <div>
                      <h4 className="text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wider">
                        Outgoing ({neighborData.outgoing.length})
                      </h4>
                      {neighborData.outgoing.length === 0 ? (
                        <p className="text-xs text-muted-foreground italic">None</p>
                      ) : (
                        <div className="space-y-1">
                          {neighborData.outgoing.map((rel) => {
                            const target = entityById.get(rel.targetId);
                            return (
                              <button
                                key={rel.id}
                                onClick={() => setSelectedEntityId(rel.targetId)}
                                className="w-full text-left text-xs p-2 bg-secondary/50 rounded border border-border/50 hover:bg-secondary transition-colors"
                                title={target?.name || rel.targetId}
                              >
                                <div className="font-mono text-muted-foreground text-[10px] mb-0.5">{rel.relation}</div>
                                <div className="truncate flex items-center gap-1">
                                  <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: nodeColor(target?.type ?? '') }} />
                                  {target?.name || rel.targetId.slice(0, 12)}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    <div>
                      <h4 className="text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wider">
                        Incoming ({neighborData.incoming.length})
                      </h4>
                      {neighborData.incoming.length === 0 ? (
                        <p className="text-xs text-muted-foreground italic">None</p>
                      ) : (
                        <div className="space-y-1">
                          {neighborData.incoming.map((rel) => {
                            const source = entityById.get(rel.sourceId);
                            return (
                              <button
                                key={rel.id}
                                onClick={() => setSelectedEntityId(rel.sourceId)}
                                className="w-full text-left text-xs p-2 bg-secondary/50 rounded border border-border/50 hover:bg-secondary transition-colors"
                                title={source?.name || rel.sourceId}
                              >
                                <div className="font-mono text-muted-foreground text-[10px] mb-0.5">{rel.relation}</div>
                                <div className="truncate flex items-center gap-1">
                                  <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: nodeColor(source?.type ?? '') }} />
                                  {source?.name || rel.sourceId.slice(0, 12)}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Impact tab */}
                {detailTab === 'impact' && (
                  <div className="pr-1">
                    {impactLoading ? (
                      <div className="text-xs text-muted-foreground animate-pulse">Analysing impact…</div>
                    ) : !impactData ? (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <AlertCircle className="w-3.5 h-3.5" /> No impact data.
                      </div>
                    ) : impactData.impacted.length === 0 ? (
                      <div className="text-xs text-muted-foreground italic text-center py-6">
                        This entity has no downstream dependants within 3 hops.
                      </div>
                    ) : (
                      <>
                        <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 mb-3 text-xs">
                          <div className="font-semibold text-amber-400 mb-1">
                            {impactData.impacted.length} entit{impactData.impacted.length === 1 ? 'y' : 'ies'} affected
                          </div>
                          <div className="text-muted-foreground">
                            A change here propagates up to {impactData.maxDepthReached} hop{impactData.maxDepthReached !== 1 ? 's' : ''} downstream.
                          </div>
                        </div>
                        <div className="space-y-1">
                          {impactData.impacted.map((hop) => (
                            <button
                              key={hop.entity.id}
                              onClick={() => setSelectedEntityId(hop.entity.id)}
                              className="w-full text-left text-xs p-2 bg-secondary/50 rounded border border-border/50 hover:bg-secondary transition-colors"
                            >
                              <div className="flex items-center justify-between gap-1">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: nodeColor(hop.entity.type) }} />
                                  <span className="truncate">{hop.entity.name}</span>
                                </div>
                                <span className="font-mono text-muted-foreground shrink-0">d{hop.depth}</span>
                              </div>
                              <div className="font-mono text-[10px] text-muted-foreground mt-0.5">
                                via {hop.viaRelationship.relation}
                              </div>
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground animate-pulse">
              Loading…
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
