import { render, screen } from '@testing-library/react';
import type { MetricRecord } from '@workspace/api-client-react';
import { describe, expect, it } from 'vitest';
import MetricsChangeSummary from './MetricsChangeSummary';

function metric(
  id: string,
  timestamp: string,
  values: Partial<MetricRecord> = {},
): MetricRecord {
  return {
    id,
    projectId: 'project-1',
    timestamp,
    overallScore: 70,
    ...values,
  };
}

describe('MetricsChangeSummary', () => {
  it('compares the two newest readings and respects whether higher or lower values are better', () => {
    const latest = metric('latest', '2026-11-20T12:00:00.000Z', {
      overallScore: 75,
      securityScore: 80,
      performanceScore: 60,
      technicalDebt: 6,
      lintIssues: 6,
    });
    const previous = metric('previous', '2026-11-19T12:00:00.000Z', {
      overallScore: 70,
      securityScore: 85,
      performanceScore: 60,
      technicalDebt: 8,
      lintIssues: 4,
    });
    const readings = [latest, previous];

    render(<MetricsChangeSummary metrics={readings} />);

    expect(screen.getByTestId('metrics-change-summary')).toBeInTheDocument();
    expect(screen.getByTestId('metric-change-overallScore')).toHaveAttribute('data-trend', 'improved');
    expect(screen.getByTestId('metric-change-overallScore')).toHaveAttribute('data-delta', '5');
    expect(screen.getByTestId('metric-change-securityScore')).toHaveAttribute('data-trend', 'declined');
    expect(screen.getByTestId('metric-change-securityScore')).toHaveAttribute('data-delta', '-5');
    expect(screen.getByTestId('metric-change-technicalDebt')).toHaveAttribute('data-trend', 'improved');
    expect(screen.getByTestId('metric-change-technicalDebt')).toHaveAttribute('data-delta', '-2');
    expect(screen.getByTestId('metric-change-lintIssues')).toHaveAttribute('data-trend', 'declined');
    expect(screen.getByTestId('metric-change-performanceScore')).toHaveAttribute('data-trend', 'unchanged');
    expect(readings[0]?.id).toBe('latest');
  });

  it('explains that comparison needs another reading and ignores unavailable optional values', () => {
    const firstReading = metric('first', '2026-11-20T12:00:00.000Z');
    const secondReading = metric('second', '2026-11-21T12:00:00.000Z');

    const { rerender } = render(<MetricsChangeSummary metrics={[firstReading]} />);
    expect(screen.getByTestId('metrics-change-first-reading')).toHaveTextContent(
      'هذه أول قراءة؛ ستظهر المقارنة بعد الفحص التالي.',
    );

    rerender(<MetricsChangeSummary metrics={[firstReading, secondReading]} />);
    expect(screen.getByTestId('metric-change-overallScore')).toHaveAttribute('data-delta', '0');
    expect(screen.getByTestId('metric-change-overallScore')).toHaveAttribute('data-trend', 'unchanged');
    expect(screen.queryByTestId('metric-change-securityScore')).not.toBeInTheDocument();
  });
});
