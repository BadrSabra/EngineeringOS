import { Check, Circle, Loader2, X } from 'lucide-react';
import type { RecipeNodeState } from '@workspace/api-client-react';

export function RecipeProgressPanel({ nodes }: { nodes: RecipeNodeState[] }) {
  if (nodes.length === 0) return null;
  const terminal = nodes.every((node) => ['passed', 'failed', 'blocked'].includes(node.status));
  return (
    <details open={!terminal} className="mb-4 rounded-lg border border-border bg-card/70 p-3">
      <summary className="cursor-pointer text-xs font-semibold text-foreground">
        Recipe progress <span className="ml-1 text-muted-foreground">({nodes.length} steps)</span>
      </summary>
      <div className="mt-2 space-y-1.5">
        {nodes.map((node) => (
          <div key={node.nodeId} className="flex items-start gap-2 rounded-md px-2 py-1.5 text-xs">
            <span className="mt-0.5 shrink-0" aria-label={node.status}>
              {node.status === 'running' ? <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" /> :
                node.status === 'passed' ? <Check className="h-3.5 w-3.5 text-emerald-400" /> :
                  node.status === 'failed' || node.status === 'blocked' ? <X className="h-3.5 w-3.5 text-red-400" /> :
                    <Circle className="h-3.5 w-3.5 text-muted-foreground" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="font-medium">{node.title}</span>
              {node.excerpt && (
                <details className="mt-1 text-[11px] text-muted-foreground">
                  <summary className="cursor-pointer">Show bounded output</summary>
                  <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-words rounded bg-background/60 p-2">{node.excerpt.slice(0, 500)}</pre>
                </details>
              )}
            </span>
          </div>
        ))}
      </div>
    </details>
  );
}