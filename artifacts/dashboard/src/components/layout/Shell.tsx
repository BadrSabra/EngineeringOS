import React, { useState } from 'react';
import { Sidebar } from './Sidebar';
import { Bell, Menu, Search, TerminalSquare } from 'lucide-react';

export function Shell({ children }: { children: React.ReactNode }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="flex h-[100dvh] w-full bg-background text-foreground overflow-hidden">
      {mobileNavOpen && (
        <button
          type="button"
          onClick={() => setMobileNavOpen(false)}
          className="fixed inset-0 z-40 bg-black/60 md:hidden"
          aria-label="Close navigation"
        />
      )}
      <Sidebar mobileOpen={mobileNavOpen} onMobileClose={() => setMobileNavOpen(false)} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="h-14 border-b border-border bg-card flex items-center gap-2 justify-between px-3 sm:px-4 shrink-0">
          <div className="relative flex min-w-0 max-w-96 flex-1 items-center gap-2">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              className="shrink-0 rounded-md p-2 text-muted-foreground hover:bg-secondary hover:text-foreground md:hidden"
              aria-label="Open navigation"
              title="Open navigation"
            >
              <Menu className="h-4 w-4" />
            </button>
            <Search className="w-4 h-4 absolute left-3 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search projects, tasks, rules... (Press '/')"
              className="min-w-0 w-full bg-secondary border border-border rounded-md pl-9 pr-4 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary placeholder:text-muted-foreground"
            />
          </div>

          <div className="flex shrink-0 items-center gap-2 sm:gap-4">
            <div className="hidden sm:flex items-center gap-2 text-xs font-mono text-muted-foreground bg-secondary px-2 py-1 rounded border border-border">
              <TerminalSquare className="w-3 h-3" />
              <span>v1.0.4-stable</span>
            </div>
            <button className="relative p-2 text-muted-foreground hover:text-foreground transition-colors rounded-md hover:bg-secondary">
              <Bell className="w-4 h-4" />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-primary rounded-full ring-2 ring-card"></span>
            </button>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-auto overflow-x-hidden bg-background p-3 sm:p-6">
          <div className="h-full min-h-0 max-w-7xl mx-auto w-full">{children}</div>
        </main>
      </div>
    </div>
  );
}
