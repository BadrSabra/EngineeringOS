import React from 'react';
import { Sidebar } from './Sidebar';
import { Bell, Search, TerminalSquare } from 'lucide-react';

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-[100dvh] w-full bg-background text-foreground overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 border-b border-border bg-card flex items-center justify-between px-4 shrink-0">
          <div className="flex items-center w-96 relative">
            <Search className="w-4 h-4 absolute left-3 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search projects, tasks, rules... (Press '/')"
              className="w-full bg-secondary border border-border rounded-md pl-9 pr-4 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary placeholder:text-muted-foreground"
            />
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground bg-secondary px-2 py-1 rounded border border-border">
              <TerminalSquare className="w-3 h-3" />
              <span>v1.0.4-stable</span>
            </div>
            <button className="relative p-2 text-muted-foreground hover:text-foreground transition-colors rounded-md hover:bg-secondary">
              <Bell className="w-4 h-4" />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-primary rounded-full ring-2 ring-card"></span>
            </button>
          </div>
        </header>
        <main className="flex-1 overflow-auto bg-background p-6">
          <div className="max-w-7xl mx-auto w-full">{children}</div>
        </main>
      </div>
    </div>
  );
}
