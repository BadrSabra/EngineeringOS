import { useState } from 'react';
import {
  Activity,
  ArrowUpRight,
  Bot,
  ChevronDown,
  Code2,
  GitMerge,
  Search,
  Zap,
} from 'lucide-react';
import './_group.css';

const primaryActions = [
  {
    label: 'Analyze Scan',
    description: 'Turn the latest scan into three practical improvements.',
    icon: Search,
  },
  {
    label: 'Code Review',
    description: 'Find the most important quality issues in this project.',
    icon: Code2,
  },
];

const additionalActions = [
  { label: 'Task Status', icon: Zap },
  { label: 'Workflow Health', icon: GitMerge },
  { label: 'Capability Probe', icon: Activity },
];

export function Refined() {
  const [moreActionsExpanded, setMoreActionsExpanded] = useState(false);

  return (
    <div className="min-h-screen bg-background px-5 py-8 font-sans text-foreground sm:px-8">
      <main className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-2xl flex-col justify-center gap-6">
        <header className="flex items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-primary/25 bg-primary/10 shadow-sm">
            <Bot className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0 pt-0.5">
            <p className="font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-primary">
              EngineeringOS · Project assistant
            </p>
            <h1 className="mt-2 text-xl font-semibold tracking-tight sm:text-2xl">
              What should we work on?
            </h1>
            <p className="mt-1.5 max-w-lg text-sm leading-6 text-muted-foreground">
              Ask a question or start with a focused review. You can change the project from Sessions.
            </p>
          </div>
        </header>

        <section aria-label="Common starting points" className="grid gap-3 sm:grid-cols-2">
          {primaryActions.map((action) => (
            <button
              key={action.label}
              type="button"
              className="group relative flex min-h-28 items-start gap-3 rounded-xl border border-border/80 bg-card/70 p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/45 hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/15 bg-primary/10 text-primary transition-colors group-hover:bg-primary/15">
                <action.icon className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1 pt-0.5">
                <span className="block text-sm font-medium text-foreground">{action.label}</span>
                <span className="mt-1 block text-xs leading-5 text-muted-foreground">{action.description}</span>
              </span>
              <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground/60 transition-all group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-primary" />
            </button>
          ))}
        </section>

        <section className="border-t border-border/70 pt-3">
          <button
            type="button"
            aria-expanded={moreActionsExpanded}
            aria-controls="refined-additional-actions"
            onClick={() => setMoreActionsExpanded((expanded) => !expanded)}
            className="flex w-full items-center gap-2 rounded-md px-1 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="flex-1 font-medium">More actions</span>
            <span className="rounded-full border border-border px-1.5 py-0.5 font-mono text-[10px]">
              {additionalActions.length}
            </span>
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${moreActionsExpanded ? 'rotate-180' : ''}`} />
          </button>
          <div id="refined-additional-actions" hidden={!moreActionsExpanded} className="mt-2 grid gap-2 sm:grid-cols-3">
            {additionalActions.map((action) => (
              <button
                key={action.label}
                type="button"
                className="flex min-w-0 items-center gap-2 rounded-lg border border-border/70 bg-secondary/35 px-3 py-2.5 text-left text-xs text-muted-foreground transition-colors hover:border-primary/35 hover:bg-secondary/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <action.icon className="h-3.5 w-3.5 shrink-0 text-primary" />
                <span className="truncate">{action.label}</span>
              </button>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}