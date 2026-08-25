import React, { useEffect, useState } from 'react';
import { AlertTriangle, Check, RefreshCw } from 'lucide-react';
import { useClerk } from '@clerk/react';

export type RequestState = 'loading' | 'ready' | 'empty' | 'error';

export function RefreshButton({
  onRefresh,
  isRefreshing = false,
  lastUpdated,
  label = 'Refresh',
}: {
  onRefresh: () => void | Promise<unknown>;
  isRefreshing?: boolean;
  lastUpdated?: number;
  label?: string;
}) {
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      {lastUpdated ? <span>Updated {new Date(lastUpdated).toLocaleTimeString()}</span> : null}
      <button
        type="button"
        onClick={() => void onRefresh()}
        disabled={isRefreshing}
        aria-label={label}
        title={label}
        className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 hover:bg-secondary hover:text-foreground disabled:cursor-wait disabled:opacity-60"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
        {isRefreshing ? 'Refreshing…' : label}
      </button>
    </div>
  );
}

export function RequestError({
  message = 'Unable to load this data.',
  onRetry,
  title,
  retryLabel = 'Try again',
}: {
  message?: string;
  onRetry?: () => void;
  title?: string;
  retryLabel?: string;
}) {
  return (
    <div role="alert" className="rounded-xl border border-destructive/25 bg-destructive/5 p-8 text-center text-destructive">
      <AlertTriangle className="mx-auto mb-3 h-7 w-7 opacity-80" />
      {title ? <h3 className="mb-1 text-lg font-semibold">{title}</h3> : null}
      <p className="font-medium">{message}</p>
      {onRetry ? (
        <button type="button" onClick={onRetry} className="mt-4 rounded-md border border-destructive/30 px-3 py-1.5 text-sm hover:bg-destructive/10">
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}

export function SessionRecoveryBanner() {
  const { redirectToSignIn } = useClerk();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onExpired = () => setVisible(true);
    window.addEventListener('engineeringos:session-expired', onExpired);
    return () => window.removeEventListener('engineeringos:session-expired', onExpired);
  }, []);

  if (!visible) return null;
  return (
    <div role="alert" className="fixed inset-x-0 top-0 z-[100] flex items-center justify-center gap-3 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-100 shadow-lg">
      <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
      <span>Your session has expired. Sign in again to continue.</span>
      <button
        type="button"
        onClick={() => void redirectToSignIn({ redirectUrl: window.location.href })}
        className="rounded-md bg-amber-400 px-3 py-1 font-medium text-black hover:bg-amber-300"
      >
        Sign in
      </button>
      <button type="button" aria-label="Dismiss session expiry notice" onClick={() => setVisible(false)} className="px-1 text-amber-200 hover:text-white">
        <Check className="h-4 w-4" />
      </button>
    </div>
  );
}