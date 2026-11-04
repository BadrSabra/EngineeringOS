import { useEffect, useRef, useState } from 'react';

// UI-01: desktop sessions can collapse for a focused chat; mobile uses an
// overlay drawer so it never steals the chat column's usable width.
export function useSessionsDrawer() {
  const [sidebarOpen, setSidebarOpen] = useState(() =>
    typeof window === 'undefined' || window.matchMedia('(min-width: 768px)').matches,
  );
  const sessionsDrawerRef = useRef<HTMLDivElement>(null);
  const sessionsToggleRef = useRef<HTMLButtonElement>(null);
  const sessionsCloseRef = useRef<HTMLButtonElement>(null);
  const mobileSessionsWasOpenRef = useRef(false);
  const mobileSessionsOpenerRef = useRef<HTMLElement | null>(null);
  const isMobileSessionDrawer = typeof window !== 'undefined'
    && !window.matchMedia('(min-width: 768px)').matches;

  useEffect(() => {
    if (!sidebarOpen || window.matchMedia('(min-width: 768px)').matches) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [sidebarOpen]);

  useEffect(() => {
    if (sidebarOpen && isMobileSessionDrawer) {
      if (!mobileSessionsWasOpenRef.current) {
        mobileSessionsOpenerRef.current = sessionsToggleRef.current
          ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
        mobileSessionsWasOpenRef.current = true;
      }
      sessionsCloseRef.current?.focus();

      const handleDrawerKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          setSidebarOpen(false);
          return;
        }
        if (event.key !== 'Tab') return;

        const drawer = sessionsDrawerRef.current;
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

      document.addEventListener('keydown', handleDrawerKeyDown);
      return () => document.removeEventListener('keydown', handleDrawerKeyDown);
    }

    if (!sidebarOpen && mobileSessionsWasOpenRef.current) {
      mobileSessionsWasOpenRef.current = false;
      const opener = mobileSessionsOpenerRef.current;
      mobileSessionsOpenerRef.current = null;
      if (opener?.isConnected) opener.focus();
    }
    return undefined;
  }, [isMobileSessionDrawer, sidebarOpen]);

  return {
    sidebarOpen,
    setSidebarOpen,
    sessionsDrawerRef,
    sessionsToggleRef,
    sessionsCloseRef,
    isMobileSessionDrawer,
  };
}
