import { useState } from 'react';
import { Activity, Bot, ChevronRight, Code2, GitMerge, Search, Zap } from 'lucide-react';
import './_group.css';

const commonActions = [
  { label: 'Analyze Scan', icon: Search },
  { label: 'Code Review', icon: Code2 },
];

const additionalActions = [
  { label: 'Task Status', icon: Zap },
  { label: 'Workflow Health', icon: GitMerge },
  { label: 'Capability Probe', icon: Activity },
];

export function Current() {
  const [moreActionsExpanded, setMoreActionsExpanded] = useState(false);

  return (
    <div className="min-h-screen bg-background font-sans text-foreground">
      <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-5 py-8">
        <div className="flex flex-col items-center gap-2">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10">
            <Bot className="h-6 w-6 text-primary" />
          </div>
          <p className="text-sm font-medium">How can I help with your project?</p>
          <p className="max-w-xs text-center text-xs text-muted-foreground">
            Ask a question about this project, or choose a starting point below.
          </p>
        </div>

        <div className="w-full max-w-sm">
          <div className="mb-2 px-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Common starting points
          </div>
          <div className="grid grid-cols-2 gap-2">
            {commonActions.map((action) => (
              <button
                key={action.label}
                type="button"
                className="flex items-center gap-2 rounded-lg border border-border bg-secondary px-3 py-2 text-left text-xs transition-colors hover:bg-secondary/80"
              >
                <action.icon className="h-3.5 w-3.5 shrink-0 text-primary" />
                {action.label}
              </button>
            ))}
          </div>
          <div className="mt-2">
            <button
              type="button"
              aria-expanded={moreActionsExpanded}
              aria-controls="current-additional-actions"
              onClick={() => setMoreActionsExpanded((expanded) => !expanded)}
              className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-[11px] text-muted-foreground transition-colors hover:bg-secondary/70 hover:text-foreground"
            >
              <span>More actions</span>
              <ChevronRight className={`h-3 w-3 transition-transform ${moreActionsExpanded ? 'rotate-90' : ''}`} />
            </button>
            <div id="current-additional-actions" hidden={!moreActionsExpanded} className="mt-1 grid grid-cols-2 gap-2">
              {additionalActions.map((action) => (
                <button
                  key={action.label}
                  type="button"
                  className="flex items-center gap-2 rounded-lg border border-border bg-secondary px-3 py-2 text-left text-xs transition-colors hover:bg-secondary/80"
                >
                  <action.icon className="h-3.5 w-3.5 shrink-0 text-primary" />
                  {action.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}