import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ProviderRecoveryCard } from './ProviderRecoveryCard';

describe('ProviderRecoveryCard', () => {
  it.each([
    ['authentication_failed', 'تعذر التحقق من بيانات وصول المزود'],
    ['incompatible_model', 'النموذج المحدد غير متاح'],
    ['catalog_stale', 'قائمة نماذج المزود تحتاج إلى تحديث'],
    ['quota_exhausted', 'انتهت حصة الاستخدام لدى المزود'],
    ['rate_limited', 'بلغ المزود حد الاستخدام'],
    ['circuit_open', 'الاتصال بالمزود معلّق مؤقتًا'],
    ['provider_outage', 'المزود غير متاح مؤقتًا'],
  ])('explains %s with a recovery action', (state, heading) => {
    render(
      <ProviderRecoveryCard
        recovery={{ availabilityState: state, correlationId: 'support-reference-123' }}
      />,
    );
    expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument();
    expect(screen.getByText(/الخطوة التالية:/)).toBeInTheDocument();
    expect(screen.getByText(/مرجع الدعم:/)).toHaveTextContent('support-reference-123');
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
    expect(screen.getByText('Configure another provider, then retry.')).toHaveAttribute('dir', 'auto');
    expect(screen.queryByText(/raw upstream response/)).not.toBeInTheDocument();
    expect(screen.getByText(/مرجع الدعم:/)).toHaveTextContent('corr-42');
  });

  it('keeps unknown states readable without inventing a diagnosis or an action button', () => {
    render(<ProviderRecoveryCard recovery={{ availabilityState: 'future_state' }} />);
    expect(screen.getByRole('region', { name: 'إرشادات استعادة جاهزية المزود' })).toHaveAttribute('dir', 'rtl');
    expect(screen.getByRole('heading', { name: 'حالة المزود غير معروفة' })).toBeInTheDocument();
    expect(screen.getByText('future_state')).toHaveAttribute('dir', 'ltr');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});