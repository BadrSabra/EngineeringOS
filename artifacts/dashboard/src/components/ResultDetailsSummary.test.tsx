import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { AiExecutionProjection } from '@workspace/api-client-react';
import { ResultDetailsSummary } from './ResultDetailsSummary';

const projection = (verification: Record<string, unknown>) => ({ verification } as unknown as AiExecutionProjection);

describe('ResultDetailsSummary', () => {
  it('renders RTL Arabic and never claims fresh acceptance for checkpoint proven + passed', () => {
    render(<ResultDetailsSummary input={{ kind: 'execution', executionStatus: 'completed', evidenceVerdict: 'PROVEN',
      projection: projection({ status: 'passed', proofRequired: true, evidenceVerdict: 'PROVEN' }) }} />);
    const root = screen.getByTestId('result-details');
    expect(root.getAttribute('dir')).toBe('rtl');
    expect(screen.getByTestId('text-result-verification').textContent).toContain('لا يُستنتج');
    expect(root.textContent).not.toMatch(/لم يُختبر بعد|not tested/i);
    expect(screen.getByTestId('text-result-checks').textContent).toContain('لا يعني أن العمل لم يُختبر');
    expect(root.querySelector('button')).toBeNull();
  });

  it('shows unavailable verification and cancellation', () => {
    render(<ResultDetailsSummary input={{ kind: 'execution', executionStatus: 'cancelled', projection: projection({ status: 'unavailable' }) }} />);
    expect(screen.getByTestId('text-result-title').textContent).toBe('توقف العمل بالإلغاء');
    expect(screen.getByTestId('text-result-verification').textContent).toContain('غير متاحة');
  });

  it('treats missing execution status as unknown', () => {
    render(<ResultDetailsSummary input={{ kind: 'execution', projection: projection({}) }} />);
    expect(screen.getByTestId('text-result-title').textContent).toBe('الحالة تحتاج تفاصيل');
  });

  it('distinguishes current plan, legacy and historical goals with attempt', () => {
    const { rerender } = render(<ResultDetailsSummary testIdSuffix="g" input={{ kind: 'goal', status: 'completed', planBinding: 'active_revision', inCurrentPlan: true, attempt: 2 }} />);
    expect(screen.getByTestId('text-result-title-g').textContent).toBe('انتهى العمل بحسب السجل');
    expect(screen.getByTestId('text-result-scope-g').textContent).toContain('مرتبط بالخطة الحالية');
    expect(screen.getByTestId('text-result-attempt-g').textContent).toContain('2');
    rerender(<ResultDetailsSummary testIdSuffix="g" input={{ kind: 'goal', status: 'completed', planBinding: 'legacy_unversioned' }} />);
    expect(screen.getByTestId('text-result-scope-g').textContent).toContain('لا توجد نسخة خطة');
    expect(screen.queryByTestId('text-result-attempt-g')).toBeNull();
    rerender(<ResultDetailsSummary testIdSuffix="g" input={{ kind: 'goal', status: 'completed', planBinding: 'active_revision', inCurrentPlan: false }} />);
    expect(screen.getByTestId('text-result-scope-g').textContent).toContain('غير مطابق');
  });
});
