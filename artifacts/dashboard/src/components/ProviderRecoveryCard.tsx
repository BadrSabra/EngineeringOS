import { AlertTriangle } from 'lucide-react';

export type ProviderAvailabilityState =
  | 'missing_credentials'
  | 'authentication_failed'
  | 'incompatible_model'
  | 'no_compatible_free_model'
  | 'catalog_stale'
  | 'quota_exhausted'
  | 'rate_limited'
  | 'circuit_open'
  | 'provider_outage'
  | 'degraded'
  | 'healthy'
  | 'unknown'
  | (string & {});

export type ProviderRecoveryDetails = {
  availabilityState?: unknown;
  operatorAction?: unknown;
  correlationId?: unknown;
};

const stateCopy: Record<string, { label: string; action: string }> = {
  missing_credentials: { label: 'Provider credentials are missing', action: 'Configure an API key for a supported provider, then retry.' },
  authentication_failed: { label: 'Provider authentication failed', action: 'Replace the provider API key with a valid key, then retry.' },
  incompatible_model: { label: 'The selected model is unavailable', action: 'Choose a compatible current model or configure another provider, then retry.' },
  no_compatible_free_model: { label: 'No compatible free model is available', action: 'Select another compatible model or configure another provider, then retry.' },
  catalog_stale: { label: 'The provider model catalog needs to refresh', action: 'Retry shortly; configure another provider if the catalog remains unavailable.' },
  quota_exhausted: { label: 'Provider quota is exhausted', action: 'Add provider credits or configure another provider.' },
  rate_limited: { label: 'The provider rate limit was reached', action: 'Wait for the rate-limit window to reset, then retry or configure another provider.' },
  circuit_open: { label: 'Provider temporarily paused', action: 'Wait for the provider cooldown to finish, then retry or configure another provider.' },
  provider_outage: { label: 'The provider is temporarily unavailable', action: 'Retry in a moment; configure another provider if the issue persists.' },
  degraded: { label: 'Provider service is degraded', action: 'Retry in a moment or configure another provider.' },
  healthy: { label: 'Provider is available', action: 'Retry the operation.' },
  unknown: { label: 'Provider availability is unknown', action: 'Retry in a moment or configure another provider.' },
};

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function ProviderRecoveryCard({
  recovery,
  className = '',
}: {
  recovery: ProviderRecoveryDetails | null | undefined;
  className?: string;
}) {
  if (!recovery || typeof recovery !== 'object') return null;
  const state = text(recovery.availabilityState);
  const operatorAction = text(recovery.operatorAction);
  const correlationId = text(recovery.correlationId);
  if (!state && !operatorAction && !correlationId) return null;

  const copy = stateCopy[state ?? 'unknown'] ?? {
    label: `${(state ?? 'unknown').replace(/_/g, ' ')} provider state`,
    action: 'Retry in a moment or configure another provider.',
  };
  const displayState = state ? state.replace(/_/g, ' ') : undefined;

  return (
    <section
      className={`rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 ${className}`}
      aria-label="Provider recovery actions"
    >
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-200" />
        <div className="min-w-0">
          <h4 className="text-xs font-semibold text-amber-100">{copy.label}</h4>
          {displayState && (
            <p className="mt-0.5 text-[10px] uppercase tracking-wide text-amber-200/70">
              Availability: {displayState}
            </p>
          )}
          <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
            Next step: {operatorAction ?? copy.action}
          </p>
          {correlationId && (
            <p className="mt-1.5 truncate font-mono text-[10px] text-muted-foreground" title={correlationId}>
              Support reference: {correlationId}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}