import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import axe from 'axe-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Metrics from './Metrics';
import { useLocation } from 'wouter';

vi.mock('@workspace/api-client-react', () => ({
  useListMetrics: vi.fn(),
  useListProjects: vi.fn(),
  getListMetricsQueryKey: vi.fn((params) => ['/api/metrics', params]),
}));

import {
  getListMetricsQueryKey,
  useListMetrics,
  useListProjects,
} from '@workspace/api-client-react';

const refetchMetrics = vi.fn();
const refetchProjects = vi.fn();

function mockProjects(
  data: Array<{ id: string; name: string }> = [],
  overrides: Record<string, unknown> = {},
) {
  vi.mocked(useListProjects).mockReturnValue({
    data,
    isError: false,
    isFetching: false,
    dataUpdatedAt: 0,
    refetch: refetchProjects,
    ...overrides,
  } as ReturnType<typeof useListProjects>);
}

function mockMetrics(
  data: Array<Record<string, unknown>> = [],
  overrides: Record<string, unknown> = {},
) {
  vi.mocked(useListMetrics).mockReturnValue({
    data,
    isLoading: false,
    isError: false,
    error: null,
    refetch: refetchMetrics,
    isRefetching: false,
    isFetching: false,
    dataUpdatedAt: 0,
    ...overrides,
  } as ReturnType<typeof useListMetrics>);
}

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, '', '/metrics');
  mockProjects();
  mockMetrics();
});

describe('Metrics', () => {
  it('stacks the project and date controls on narrow screens', () => {
    const { container } = render(<Metrics />);

    expect(container.firstElementChild).toHaveAttribute('dir', 'rtl');
    expect(screen.getByTestId('metrics-controls')).toHaveClass('flex-col', 'w-full', 'min-w-0');
    expect(screen.getByRole('combobox')).toHaveClass('w-full', 'sm:w-56');
    expect(screen.getByTestId('metrics-date-range')).toHaveClass('w-full', 'sm:w-auto');
    expect(screen.getByRole('button', { name: 'الكل' })).toHaveClass('flex-1', 'sm:flex-none');
  });

  it('does not request metrics until a project is available', () => {
    render(<Metrics />);

    expect(screen.getByText('اختر مشروعًا لعرض مؤشراته.')).toBeInTheDocument();
    expect(useListMetrics).toHaveBeenCalledWith(
      { projectId: '' },
      expect.objectContaining({
        query: expect.objectContaining({ enabled: false }),
      }),
    );
  });

  it('loads the first project and distinguishes a real empty response', () => {
    mockProjects([
      { id: 'project-a', name: 'Alpha' },
      { id: 'project-b', name: 'Beta' },
    ]);
    mockMetrics([]);

    render(<Metrics />);

    expect(screen.getByText('لا توجد بيانات مؤشرات سابقة لهذا المشروع بعد.')).toBeInTheDocument();
    expect(useListMetrics).toHaveBeenCalledWith(
      { projectId: 'project-a' },
      expect.objectContaining({
        query: expect.objectContaining({ enabled: true }),
      }),
    );
    expect(getListMetricsQueryKey).toHaveBeenCalledWith({ projectId: 'project-a' });
  });

  it('restores the project and date range from a metrics link', () => {
    window.history.replaceState({}, '', '/metrics?projectId=project-b&range=7d');
    mockProjects([
      { id: 'project-a', name: 'Alpha' },
      { id: 'project-b', name: 'Beta' },
    ]);

    render(<Metrics />);

    expect(screen.getByRole('combobox', { name: 'اختر المشروع' })).toHaveValue('project-b');
    expect(screen.getByRole('button', { name: '٧ أيام' })).toHaveAttribute('aria-pressed', 'true');
    expect(useListMetrics).toHaveBeenCalledWith(
      { projectId: 'project-b' },
      expect.objectContaining({
        query: expect.objectContaining({ enabled: true }),
      }),
    );
  });

  it('updates the metrics link while preserving other route context', () => {
    window.history.replaceState({}, '', '/metrics?projectId=project-a&panel=quality#trend');
    mockProjects([
      { id: 'project-a', name: 'Alpha' },
      { id: 'project-b', name: 'Beta' },
    ]);

    render(<Metrics />);
    fireEvent.change(screen.getByRole('combobox', { name: 'اختر المشروع' }), {
      target: { value: 'project-b' },
    });
    fireEvent.click(screen.getByRole('button', { name: '٧ أيام' }));

    let url = new URL(window.location.href);
    expect(url.searchParams.get('projectId')).toBe('project-b');
    expect(url.searchParams.get('range')).toBe('7d');
    expect(url.searchParams.get('panel')).toBe('quality');
    expect(url.hash).toBe('#trend');

    fireEvent.click(screen.getByRole('button', { name: '٣٠ يومًا' }));
    url = new URL(window.location.href);
    expect(url.searchParams.get('projectId')).toBe('project-b');
    expect(url.searchParams.has('range')).toBe(false);
    expect(url.searchParams.get('panel')).toBe('quality');
    expect(url.hash).toBe('#trend');
  });

  it('uses safe defaults for unsupported URL selections and canonicalizes them', async () => {
    window.history.replaceState({}, '', '/metrics?projectId=removed-project&range=90d&panel=quality');
    mockProjects([{ id: 'project-a', name: 'Alpha' }]);

    render(<Metrics />);

    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: 'اختر المشروع' })).toHaveValue('project-a');
      expect(screen.getByRole('button', { name: '٣٠ يومًا' })).toHaveAttribute('aria-pressed', 'true');
    });
    const url = new URL(window.location.href);
    expect(url.searchParams.get('projectId')).toBe('project-a');
    expect(url.searchParams.has('range')).toBe(false);
    expect(url.searchParams.get('panel')).toBe('quality');
  });

  it('applies new selections when navigation changes only the metrics query', () => {
    function RouteNavigationProbe() {
      const [, navigate] = useLocation();
      return (
        <button
          type="button"
          onClick={() => navigate('/metrics?projectId=project-b&range=all')}
        >
          Open saved metrics view
        </button>
      );
    }
    window.history.replaceState({}, '', '/metrics?projectId=project-a');
    mockProjects([
      { id: 'project-a', name: 'Alpha' },
      { id: 'project-b', name: 'Beta' },
    ]);

    render(
      <>
        <RouteNavigationProbe />
        <Metrics />
      </>,
    );

    expect(screen.getByRole('combobox', { name: 'اختر المشروع' })).toHaveValue('project-a');
    fireEvent.click(screen.getByRole('button', { name: 'Open saved metrics view' }));

    expect(screen.getByRole('combobox', { name: 'اختر المشروع' })).toHaveValue('project-b');
    expect(screen.getByRole('button', { name: 'الكل' })).toHaveAttribute('aria-pressed', 'true');
    expect(useListMetrics).toHaveBeenLastCalledWith(
      { projectId: 'project-b' },
      expect.objectContaining({
        query: expect.objectContaining({ enabled: true }),
      }),
    );
  });

  it('uses a newly selected project for the next metrics query', async () => {
    mockProjects([
      { id: 'project-a', name: 'Alpha' },
      { id: 'project-b', name: 'Beta' },
    ]);
    mockMetrics([]);

    render(<Metrics />);
    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'project-b' },
    });

    await waitFor(() => {
      expect(useListMetrics).toHaveBeenLastCalledWith(
        { projectId: 'project-b' },
        expect.objectContaining({
          query: expect.objectContaining({ enabled: true }),
        }),
      );
    });
  });

  it('falls back to a currently available project when the selected project is removed', async () => {
    mockProjects([
      { id: 'project-a', name: 'Alpha' },
      { id: 'project-b', name: 'Beta' },
    ]);

    const { rerender } = render(<Metrics />);
    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'project-b' },
    });

    await waitFor(() => {
      expect(useListMetrics).toHaveBeenLastCalledWith(
        { projectId: 'project-b' },
        expect.objectContaining({
          query: expect.objectContaining({ enabled: true }),
        }),
      );
    });

    mockProjects([{ id: 'project-a', name: 'Alpha' }]);
    rerender(<Metrics />);

    await waitFor(() => {
      expect(screen.getByRole('combobox')).toHaveValue('project-a');
      expect(useListMetrics).toHaveBeenLastCalledWith(
        { projectId: 'project-a' },
        expect.objectContaining({
          query: expect.objectContaining({ enabled: true }),
        }),
      );
    });
  });

  it('does not refetch metrics for a project removed by the same refresh', async () => {
    mockProjects([
      { id: 'project-a', name: 'Alpha' },
      { id: 'project-b', name: 'Beta' },
    ]);
    const { rerender } = render(<Metrics />);

    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'project-b' },
    });
    await waitFor(() => {
      expect(screen.getByRole('combobox')).toHaveValue('project-b');
    });

    refetchProjects.mockResolvedValue({
      data: [{ id: 'project-a', name: 'Alpha' }],
      isError: false,
    });
    fireEvent.click(screen.getByRole('button', { name: 'تحديث المؤشرات' }));

    await waitFor(() => {
      expect(refetchProjects).toHaveBeenCalledTimes(1);
    });
    expect(refetchMetrics).not.toHaveBeenCalled();

    mockProjects([{ id: 'project-a', name: 'Alpha' }]);
    rerender(<Metrics />);
    await waitFor(() => {
      expect(screen.getByRole('combobox')).toHaveValue('project-a');
    });
  });

  it('refetches metrics when the selected project remains available after project refresh', async () => {
    const projects = [
      { id: 'project-a', name: 'Alpha' },
      { id: 'project-b', name: 'Beta' },
    ];
    mockProjects(projects);
    render(<Metrics />);

    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'project-b' },
    });
    await waitFor(() => {
      expect(screen.getByRole('combobox')).toHaveValue('project-b');
    });

    refetchProjects.mockResolvedValue({
      data: projects,
      isError: false,
    });
    fireEvent.click(screen.getByRole('button', { name: 'تحديث المؤشرات' }));

    await waitFor(() => {
      expect(refetchProjects).toHaveBeenCalledTimes(1);
      expect(refetchMetrics).toHaveBeenCalledTimes(1);
    });
  });

  it('keeps refresh busy while either the projects or metrics read is fetching', () => {
    const projects = [{ id: 'project-a', name: 'Alpha' }];
    mockProjects(projects, {
      isFetching: true,
      dataUpdatedAt: 2_000,
    });
    mockMetrics([], {
      isFetching: false,
      dataUpdatedAt: 3_000,
    });

    const { rerender } = render(<Metrics />);
    const refreshButton = screen.getByRole('button', { name: 'تحديث المؤشرات' });
    expect(refreshButton).toBeDisabled();

    mockProjects(projects, {
      isFetching: false,
      dataUpdatedAt: 2_000,
    });
    mockMetrics([], {
      isFetching: true,
      dataUpdatedAt: 3_000,
    });
    rerender(<Metrics />);

    expect(refreshButton).toBeDisabled();
  });

  it('uses the oldest successful read as the composite last-updated time', () => {
    mockProjects([{ id: 'project-a', name: 'Alpha' }], {
      dataUpdatedAt: 2_000,
    });
    mockMetrics([], {
      dataUpdatedAt: 1_000,
    });

    const { rerender } = render(<Metrics />);

    expect(screen.getByText(/آخر تحديث:/)).toHaveTextContent(
      new Date(1_000).toLocaleTimeString(),
    );

    mockMetrics([], { dataUpdatedAt: 0 });
    rerender(<Metrics />);
    expect(screen.queryByText(/آخر تحديث:/)).not.toBeInTheDocument();

    mockProjects([{ id: 'project-a', name: 'Alpha' }], { dataUpdatedAt: 0 });
    mockMetrics([], { dataUpdatedAt: 1_000 });
    rerender(<Metrics />);

    expect(screen.queryByText(/آخر تحديث:/)).not.toBeInTheDocument();
  });

  it('offers project retry on load failure rather than showing an empty state', () => {
    vi.mocked(useListProjects).mockReturnValue({
      data: undefined,
      isError: true,
      isFetching: false,
      dataUpdatedAt: 0,
      refetch: refetchProjects,
    } as ReturnType<typeof useListProjects>);

    render(<Metrics />);

    expect(screen.getByText('تعذّر تحميل المشاريع لعرض المؤشرات.')).toBeInTheDocument();
    expect(screen.queryByText('لا توجد بيانات مؤشرات سابقة لهذا المشروع بعد.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'حاول مجددًا' }));
    expect(refetchProjects).toHaveBeenCalledTimes(1);
  });

  it('shows an explicit empty project option and disables metrics without a project', () => {
    mockProjects([]);
    render(<Metrics />);

    expect(screen.getByRole('combobox')).toHaveValue('');
    expect(screen.getByRole('option', { name: 'لا توجد مشاريع متاحة' })).toBeDisabled();
    expect(useListMetrics).toHaveBeenLastCalledWith(
      { projectId: '' },
      expect.objectContaining({
        query: expect.objectContaining({ enabled: false }),
      }),
    );
  });

  it('has no axe violations in the no-project state', async () => {
    const { container } = render(<Metrics />);

    const results = await axe.run(container, {
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(results.violations.map(({ id }) => id)).toEqual([]);
  });
});
