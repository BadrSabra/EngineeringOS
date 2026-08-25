import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ProviderRecoveryCard } from './ProviderRecoveryCard';

describe('ProviderRecoveryCard', () => {
  it.each([
    ['authentication_failed', 'Provider authentication failed'],
    ['incompatible_model', 'The selected model is unavailable'],
    ['catalog_stale', 'The provider model catalog needs to refresh'],
    ['quota_exhausted', 'Provider quota is exhausted'],
    ['rate_limited', 'The provider rate limit was reached'],
    ['circuit_open', 'Provider temporarily paused'],
    ['provider_outage', 'The provider is temporarily unavailable'],
  ])('explains %s with a recovery action', (state, heading) => {
    render(
      <ProviderRecoveryCard
        recovery={{ availabilityState: state, correlationId: 'support-reference-123' }}
      />,
    );
    expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument();
    expect(screen.getByText(/Next step:/)).toBeInTheDocument();
    expect(screen.getByText('Support reference: support-reference-123')).toBeInTheDocument();
  });

  it('uses the safe server action while keeping upstream diagnostics out of the card', () => {
    render(
      <ProviderRecoveryCard
        recovery={{
          availabilityState: 'quota_exhausted',
          operatorAction: 'Configure another provider, then retry.',
          correlationId: 'corr-42',
          upstreamMessage: 'provider secret and raw upstream response',
        }}
      />,
    );
    expect(screen.getByText('Next step: Configure another provider, then retry.')).toBeInTheDocument();
    expect(screen.queryByText(/raw upstream response/)).not.toBeInTheDocument();
    expect(screen.getByText('Support reference: corr-42')).toBeInTheDocument();
  });
});