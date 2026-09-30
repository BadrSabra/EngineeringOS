import React, { useEffect, useRef, useState } from 'react';
import { Sidebar } from './Sidebar';
import { Menu } from 'lucide-react';
import { useLocation } from 'wouter';
import { getNavigationPageLabel } from './navigation';

export function Shell({ children }: { children: React.ReactNode }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const navigationDrawerRef = useRef<HTMLDivElement>(null);
  const navigationCloseRef = useRef<HTMLButtonElement>(null);
  const navigationOpenerRef = useRef<HTMLButtonElement>(null);
  const navigationWasOpenRef = useRef(false);
  const [location] = useLocation();
  const pageLabel = getNavigationPageLabel(location);

  useEffect(() => {
    if (mobileNavOpen) {
      navigationWasOpenRef.current = true;
      navigationCloseRef.current?.focus();

      const handleNavigationKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          setMobileNavOpen(false);
          return;
        }
        if (event.key !== 'Tab') return;

        const drawer = navigationDrawerRef.current;
        if (!drawer) return;
        const focusable = Array.from(drawer.querySelectorAll<HTMLElement>(
          'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
        )).filter((element) => (
          element.getAttribute('aria-hidden') !== 'true'
          && !element.closest('[hidden], [inert]')
          && window.getComputedStyle(element).visibility !== 'hidden'
          && window.getComputedStyle(element).display !== 'none'
        ));
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!first || !last) {
          event.preventDefault();
          drawer.focus();
          return;
        }
        if (!drawer.contains(document.activeElement)) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
        } else if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      };

      document.addEventListener('keydown', handleNavigationKeyDown);
      return () => document.removeEventListener('keydown', handleNavigationKeyDown);
    }

    if (navigationWasOpenRef.current) {
      navigationWasOpenRef.current = false;
      if (navigationOpenerRef.current?.isConnected) navigationOpenerRef.current.focus();
    }
    return undefined;
  }, [mobileNavOpen]);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileNavOpen]);

  return (
    <div className="flex h-[100dvh] w-full bg-background text-foreground overflow-hidden">
      {mobileNavOpen && (
        <button
          type="button"
          onClick={() => setMobileNavOpen(false)}
          className="fixed inset-0 z-40 bg-black/60 md:hidden"
          aria-label="Close navigation"
          tabIndex={-1}
        />
      )}
      <Sidebar
        mobileOpen={mobileNavOpen}
        onMobileClose={() => setMobileNavOpen(false)}
        mobileDrawerRef={navigationDrawerRef}
        mobileCloseRef={navigationCloseRef}
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="h-14 shrink-0 border-b border-border bg-card px-3 sm:px-4">
          <div className="flex h-full min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              ref={navigationOpenerRef}
              className="shrink-0 rounded-md p-2 text-muted-foreground hover:bg-secondary hover:text-foreground md:hidden"
              aria-label="Open navigation"
              title="Open navigation"
              aria-expanded={mobileNavOpen}
              aria-controls="mobile-navigation-drawer"
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
