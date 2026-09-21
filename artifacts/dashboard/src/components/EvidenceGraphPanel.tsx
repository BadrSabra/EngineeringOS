import { useState } from 'react';
import { ChevronDown, FileCode2, GitMerge, Search, ShieldAlert, ShieldCheck } from 'lucide-react';
import type { EvidenceGraph } from '@workspace/api-client-react';

const statusClass: Record<string, string> = {
  PROVEN: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
  CONTRADICTED: 'border-red-500/30 bg-red-500/10 text-red-200',
  INCOMPLETE: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
  NOT_PROVEN: 'border-slate-500/30 bg-slate-500/10 text-slate-300',
};

const nodeClass: Record<string, string> = {
  FILE: 'text-sky-200',
  SYMBOL: 'text-violet-200',
  CLAIM: 'text-amber-200',
  SUB_QUERY: 'text-cyan-200',
  VERDICT: 'text-emerald-200',
};

function titleCase(value: string): string {
  return value.replaceAll('_', ' ').toLocaleLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function EvidenceGraphPanel({ graph }: { graph: EvidenceGraph }) {
  const [expanded, setExpanded] = useState(false);
  const displayedNodes = expanded ? graph.nodes : graph.nodes.slice(0, 8);
  const displayedEdges = expanded ? graph.edges : graph.edges.slice(0, 8);
  const contradictions = graph.contradictionClaimIds.length;

  return (
    <section className="mt-2 overflow-hidden rounded-lg border border-cyan-500/25 bg-cyan-500/5" aria-label="Evidence graph">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-cyan-500/5"
        aria-expanded={expanded}
      >
        <GitMerge className="h-3.5 w-3.5 shrink-0 text-cyan-300" aria-hidden="true" />
        <span className="min-w-0 flex-1 text-xs font-semibold text-cyan-100">Shared evidence graph</span>
        <span className="text-[10px] text-muted-foreground">
          {graph.nodes.length} nodes · {graph.reads.length} shared reads
        </span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>

      <div className="border-t border-cyan-500/15 px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
          <span className="rounded-full border border-border/60 bg-background/30 px-2 py-0.5 text-muted-foreground">
            FILE → SYMBOL → CLAIM → SUB-QUERY → VERDICT
          </span>
          {graph.sourceRevision && (
            <span className="rounded-full border border-border/60 bg-background/30 px-2 py-0.5 font-mono text-muted-foreground">
              revision {graph.sourceRevision}
            </span>
          )}
          {contradictions > 0 ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-red-200">
              <ShieldAlert className="h-3 w-3" aria-hidden="true" />
              {contradictions} contradicted
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-emerald-200">
              <ShieldCheck className="h-3 w-3" aria-hidden="true" />
              no contradictions
            </span>
          )}
        </div>

        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <div className="rounded-md border border-border/50 bg-background/20 p-2">
            <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              <FileCode2 className="h-3 w-3" aria-hidden="true" />
              Shared reads
            </div>
            <div className="space-y-1">
              {graph.reads.slice(0, expanded ? 12 : 4).map((read) => (
                <div key={read.key} className="flex min-w-0 items-center gap-1.5 text-[10px]">
                  <span className="min-w-0 flex-1 truncate font-mono text-foreground" title={read.path}>{read.path}</span>
                  <span className="shrink-0 text-muted-foreground">{read.startLine}–{read.endLine}</span>
                  {read.taskIndexes.length > 1 && (
                    <span className="shrink-0 text-cyan-200">×{read.taskIndexes.length}</span>
                  )}
                </div>
              ))}
              {graph.reads.length === 0 && <span className="text-[10px] text-muted-foreground">No retained reads.</span>}
            </div>
          </div>

          <div className="rounded-md border border-border/50 bg-background/20 p-2">
            <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              <Search className="h-3 w-3" aria-hidden="true" />
              Graph nodes
            </div>
            <div className="space-y-1">
              {displayedNodes.map((node) => (
                <div key={node.id} className="flex min-w-0 items-center gap-1.5 text-[10px]">
                  <span className={`shrink-0 font-semibold ${nodeClass[node.kind] ?? 'text-foreground'}`}>{node.kind}</span>
                  <span className="min-w-0 flex-1 truncate text-foreground" title={node.label}>{node.label}</span>
                  {node.status && (
                    <span className={`shrink-0 rounded-full border px-1.5 py-0.5 ${statusClass[node.status] ?? statusClass.NOT_PROVEN}`}>
                      {titleCase(node.status)}
                    </span>
                  )}
                </div>
              ))}
              {graph.nodes.length === 0 && <span className="text-[10px] text-muted-foreground">No graph nodes.</span>}
            </div>
          </div>
        </div>

        {displayedEdges.length > 0 && (
          <div className="mt-2 rounded-md border border-border/50 bg-background/20 p-2">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Relationships</div>
            <div className="grid gap-1 sm:grid-cols-2">
              {displayedEdges.map((edge) => (
                <div key={edge.id} className="min-w-0 truncate text-[10px] text-muted-foreground" title={`${edge.from} ${edge.relation} ${edge.to}`}>
                  <span className="font-mono text-foreground">{edge.from.split(':').slice(1).join(':') || edge.from}</span>
                  <span className="mx-1 text-cyan-300">{edge.relation}</span>
                  <span className="font-mono text-foreground">{edge.to.split(':').slice(1).join(':') || edge.to}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {(graph.nodes.length > 8 || graph.edges.length > 8 || graph.reads.length > 4) && (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="mt-2 text-[10px] font-medium text-cyan-200 hover:text-cyan-100"
          >
            {expanded ? 'Show compact graph' : 'Show full graph'}
          </button>
        )}
      </div>
    </section>
  );
}