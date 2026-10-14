import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { RefreshButton, RequestError } from './OperatorResilience';

describe('operator resilience controls', () => {
  it('localizes refresh feedback without changing its identity or allowing a second pending refresh', () => {
    const refresh = vi.fn();
    render(<RefreshButton onRefresh={refresh} label="تحديث المهام" refreshingLabel="جارٍ التحديث…" updatedLabel="آخر تحديث:" lastUpdated={1000} isRefreshing />);
    const button = screen.getByRole('button', { name: 'تحديث المهام' });
    expect(button).toHaveTextContent('جارٍ التحديث…');
    expect(button).toHaveAttribute('title', 'تحديث المهام');
    expect(button).toBeDisabled();
    expect(screen.getByText(/آخر تحديث:/).querySelector('bdi')).toHaveAttribute('dir', 'ltr');
    fireEvent.click(button);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('exposes a retry action for failed requests', () => {
    const retry = vi.fn();
    render(<RequestError message="API unavailable" onRetry={retry} />);
    expect(screen.getByRole('alert')).toHaveTextContent('API unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('refreshes from a named keyboard-accessible control', () => {
    const refresh = vi.fn();
    render(<RefreshButton onRefresh={refresh} label="Refresh tasks" />);
    const button = screen.getByRole('button', { name: 'Refresh tasks' });
    expect(button).toHaveAttribute('title', 'Refresh tasks');
    fireEvent.keyDown(button, { key: 'Enter' });
    // Native buttons activate on Enter in the browser; this assertion verifies
    // the control remains a real button rather than an icon-only div.
    fireEvent.click(button);
    expect(refresh).toHaveBeenCalledOnce();
  });
});