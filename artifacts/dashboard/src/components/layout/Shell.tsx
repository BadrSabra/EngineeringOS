import React, { useState } from 'react';
import { Sidebar } from './Sidebar';
import { Menu } from 'lucide-react';
import { useLocation } from 'wouter';
import { getNavigationPageLabel } from './navigation';

export function Shell({ children }: { children: React.ReactNode }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [location] = useLocation();
  const pageLabel = getNavigationPageLabel(location);

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
        <header className="h-14 shrink-0 border-b border-border bg-card px-3 sm:px-4">
          <div className="flex h-full min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              className="shrink-0 rounded-md p-2 text-muted-foreground hover:bg-secondary hover:text-foreground md:hidden"
              aria-label="Open navigation"
              title="Open navigation"
              data-testid="button-open-navigation"
            >
              <Menu className="h-4 w-4" />
            </button>
            <nav aria-label="Current location" className="min-w-0 truncate text-sm">
              <span className="text-muted-foreground">EngineeringOS</span>
              <span aria-hidden="true" className="px-2 text-muted-foreground/60">/</span>
              <span className="font-semibold text-foreground" data-testid="text-current-page">
                {pageLabel}
              </span>
            </nav>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-auto overflow-x-hidden bg-background p-3 sm:p-6">
          <div className="h-full min-h-0 max-w-7xl mx-auto w-full">{children}</div>
        </main>
      </div>
    </div>
  );
}
