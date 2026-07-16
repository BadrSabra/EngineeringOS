import { Network, Activity, GitMerge, ShieldAlert } from 'lucide-react';
import { Link } from 'wouter';

const FEATURES = [
  { icon: Network, label: 'Knowledge graph of every codebase you connect' },
  { icon: GitMerge, label: 'Workflow orchestration across scan, review, and release' },
  { icon: ShieldAlert, label: 'Rule-driven governance with a full audit trail' },
  { icon: Activity, label: 'Live event stream across every tracked project' },
];

export default function Landing() {
  return (
    <div className="min-h-[100dvh] bg-background text-foreground flex flex-col">
      <header className="h-14 flex items-center px-6 border-b border-border">
        <div className="flex items-center gap-2 text-primary font-bold text-lg tracking-tight">
          <div className="w-6 h-6 bg-primary rounded flex items-center justify-center text-primary-foreground">
            <Network className="w-4 h-4" />
          </div>
          EngineeringOS
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-6">
        <div className="max-w-2xl w-full text-center space-y-8 py-16">
          <div className="space-y-3">
            <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
              Engineering command center
            </div>
            <h1 className="text-4xl font-bold tracking-tight">
              One console for how your code actually moves
            </h1>
            <p className="text-muted-foreground text-base max-w-lg mx-auto">
              Scan projects, extract dependency graphs, enforce rules, and trace
              every workflow end-to-end — all from a single operational view.
            </p>
          </div>

          <div className="flex items-center justify-center gap-3">
            <Link
              href="/sign-in"
              className="inline-flex items-center justify-center rounded-md bg-primary text-primary-foreground border border-primary-border px-6 py-2.5 text-sm font-medium hover-elevate active-elevate-2"
            >
              Sign In
            </Link>
            <Link
              href="/sign-up"
              className="inline-flex items-center justify-center rounded-md border bg-secondary text-secondary-foreground border-secondary-border px-6 py-2.5 text-sm font-medium hover-elevate active-elevate-2"
            >
              Create Account
            </Link>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-6 text-left">
            {FEATURES.map((f) => (
              <div
                key={f.label}
                className="flex items-start gap-3 rounded-md border border-border bg-card p-4"
              >
                <f.icon className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                <span className="text-sm text-muted-foreground">{f.label}</span>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
