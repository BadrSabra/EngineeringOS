import React from 'react';
import { Link, useLocation } from 'wouter';
import { useUser, useClerk } from '@clerk/react';
import {
  LayoutDashboard,
  FolderGit2,
  ListTodo,
  ShieldAlert,
  GitMerge,
  Activity,
  BarChart3,
  Network,
  LogOut,
  Bot,
} from 'lucide-react';
import { basePath } from '@/lib/clerk';

const NAV_ITEMS = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/projects', label: 'Projects', icon: FolderGit2 },
  { href: '/tasks', label: 'Tasks', icon: ListTodo },
  { href: '/rules', label: 'Rules Engine', icon: ShieldAlert },
  { href: '/workflows', label: 'Workflows', icon: GitMerge },
  { href: '/events', label: 'Event Stream', icon: Activity },
  { href: '/metrics', label: 'Metrics', icon: BarChart3 },
  { href: '/graph', label: 'Knowledge Graph', icon: Network },
  { href: '/ai', label: 'AI Assistant', icon: Bot },
];

function operatorInitials(name: string | null | undefined): string {
  if (!name) return 'OP';
  const parts = name.trim().split(/\s+/);
  const initials = parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '');
  return initials.join('') || 'OP';
}

export function Sidebar() {
  const [location] = useLocation();
  const { user } = useUser();
  const { signOut } = useClerk();
  const displayName =
    user?.fullName || user?.username || user?.primaryEmailAddress?.emailAddress || 'Operator';

  return (
    <div className="w-64 border-r border-border bg-card flex flex-col h-full shrink-0">
      <div className="h-14 flex items-center px-4 border-b border-border shrink-0">
        <div className="flex items-center gap-2 text-primary font-bold text-lg tracking-tight">
          <div className="w-6 h-6 bg-primary rounded flex items-center justify-center text-primary-foreground">
            <Network className="w-4 h-4" />
          </div>
          EngineeringOS
        </div>
      </div>

      <div className="flex-1 py-4 px-3 flex flex-col gap-1 overflow-y-auto">
        <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-2 px-2">
          Core Ops
        </div>
        {NAV_ITEMS.map((item) => {
          const isActive =
            location === item.href ||
            (item.href !== '/' && location.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
              }`}
            >
              <item.icon className={`w-4 h-4 ${isActive ? 'text-primary' : ''}`} />
              {item.label}
            </Link>
          );
        })}
      </div>

      <div className="p-4 border-t border-border shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-secondary border border-border flex items-center justify-center text-xs font-mono font-bold shrink-0">
            {operatorInitials(displayName)}
          </div>
          <div className="flex flex-col min-w-0 flex-1">
            <span className="text-sm font-semibold leading-none truncate">{displayName}</span>
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div> Connected
            </span>
          </div>
          <button
            type="button"
            onClick={() => signOut({ redirectUrl: basePath || '/' })}
            title="Sign out"
            className="p-1.5 text-muted-foreground hover:text-foreground transition-colors rounded-md hover:bg-secondary shrink-0"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
