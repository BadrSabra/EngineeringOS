import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Graph from './Graph';

vi.mock('@workspace/api-client-react', () => ({
  useListProjects: vi.fn(),
  useListGraphEntities: vi.fn(),
  useListGraphRelationships: vi.fn(),
  useGetGraphSummary: vi.fn(),
  useGetGraphEntityNeighbors: vi.fn(),
  useGetGraphEntityImpact: vi.fn(),
  getListGraphEntitiesQueryKey: vi.fn(() => ['graph-entities']),
  getListGraphRelationshipsQueryKey: vi.fn(() => ['graph-relationships']),
  getGetGraphSummaryQueryKey: vi.fn(() => ['graph-summary']),
  getGetGraphEntityNeighborsQueryKey: vi.fn(() => ['graph-neighbors']),
  getGetGraphEntityImpactQueryKey: vi.fn(() => ['graph-impact']),
}));

import {
  useGetGraphEntityImpact,
  useGetGraphEntityNeighbors,
  useGetGraphSummary,
  useListGraphEntities,
  useListGraphRelationships,
  useListProjects,
} from '@workspace/api-client-react';

const project = { id: 'project-1', name: 'Alpha service' };
const secondProject = { id: 'project-2', name: 'Beta service' };
const sourceEntity = {
  id: 'entity-source',
  projectId: project.id,
  type: 'file',
  name: 'source.ts',
  path: 'src/source.ts',
  createdAt: '2026-08-22T12:00:00.000Z',
};
const targetEntity = {
  id: 'entity-target',
  projectId: project.id,
  type: 'function',
  name: 'buildGraph',
  path: 'src/graph.ts',
  createdAt: '2026-08-22T12:00:00.000Z',
};
const relationship = {
  id: 'relationship-1',
  sourceId: sourceEntity.id,
  targetId: targetEntity.id,
  projectId: project.id,
  relation: 'calls',
  createdAt: '2026-08-22T12:00:00.000Z',
};
const graphMeta = {
  page: 1,
  pageSize: 100,
  total: 2,
  truncated: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  });

  vi.mocked(useListProjects).mockReturnValue({
    data: [project],
  } as ReturnType<typeof useListProjects>);
  vi.mocked(useListGraphEntities).mockReturnValue({
    data: { items: [sourceEntity, targetEntity], meta: graphMeta },
    isLoading: false,
  } as ReturnType<typeof useListGraphEntities>);
  vi.mocked(useListGraphRelationships).mockReturnValue({
    data: { items: [relationship], meta: { ...graphMeta, total: 1 } },
  } as ReturnType<typeof useListGraphRelationships>);
  vi.mocked(useGetGraphSummary).mockReturnValue({
    data: {
      projectId: project.id,
      entityCount: 2,
      relationshipCount: 1,
      entitiesByType: { file: 1, function: 1 },
      relationsByType: { calls: 1 },
      topConnected: [],
      avgDegree: 1,
      isolatedCount: 0,
      clusterCount: 1,
    },
  } as ReturnType<typeof useGetGraphSummary>);
  vi.mocked(useGetGraphEntityNeighbors).mockReturnValue({
    data: {
      entity: sourceEntity,
      outgoing: [relationship],
      incoming: [],
      neighbors: [targetEntity],
    },
  } as ReturnType<typeof useGetGraphEntityNeighbors>);
  vi.mocked(useGetGraphEntityImpact).mockReturnValue({
    data: undefined,
    isLoading: false,
  } as ReturnType<typeof useGetGraphEntityImpact>);
});

describe('Graph', () => {
  it('renders and filters items from paginated entity and relationship envelopes', () => {
    const { container } = render(<Graph />);

    expect(screen.getByRole('button', { name: 'source.ts' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'buildGraph' })).toBeInTheDocument();
    expect(screen.getByText('الكيانات (2)')).toBeInTheDocument();
    expect(screen.queryByTestId('graph-partial-data-warning')).not.toBeInTheDocument();
    expect(container.querySelector('line')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('ابحث عن عنصر...'), {
      target: { value: 'build' },
    });

    expect(screen.getByRole('button', { name: 'buildGraph' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'source.ts' })).not.toBeInTheDocument();
    expect(screen.getByText('الكيانات (1)')).toBeInTheDocument();
  });

  it('falls back to an available project when the selected project disappears', () => {
    vi.mocked(useListProjects).mockReturnValue({
      data: [project, secondProject],
    } as ReturnType<typeof useListProjects>);

    const { rerender } = render(<Graph />);
    const projectSelect = screen.getByRole('combobox', { name: 'اختر مشروع الرسم البياني' });

    fireEvent.change(projectSelect, { target: { value: secondProject.id } });

    expect(useListGraphEntities).toHaveBeenLastCalledWith(
      { projectId: secondProject.id },
      expect.objectContaining({
        query: expect.objectContaining({ enabled: true }),
      }),
    );

    vi.mocked(useListProjects).mockReturnValue({
      data: [project],
    } as ReturnType<typeof useListProjects>);
    rerender(<Graph />);

    expect(projectSelect).toHaveValue(project.id);
    expect(useListGraphEntities).toHaveBeenLastCalledWith(
      { projectId: project.id },
      expect.objectContaining({
        query: expect.objectContaining({ enabled: true }),
      }),
    );
  });

  it('does not keep an entity selection or detail query when switching projects', () => {
    vi.mocked(useListProjects).mockReturnValue({
      data: [project, secondProject],
    } as ReturnType<typeof useListProjects>);

    render(<Graph />);
    fireEvent.click(screen.getByRole('button', { name: 'source.ts' }));

    expect(useGetGraphEntityNeighbors).toHaveBeenLastCalledWith(
      sourceEntity.id,
      expect.objectContaining({
        query: expect.objectContaining({ enabled: true }),
      }),
    );

    fireEvent.change(screen.getByRole('combobox', { name: 'اختر مشروع الرسم البياني' }), {
      target: { value: secondProject.id },
    });

    expect(useGetGraphEntityNeighbors).toHaveBeenLastCalledWith(
      '',
      expect.objectContaining({
        query: expect.objectContaining({ enabled: false }),
      }),
    );
    expect(useGetGraphEntityImpact).toHaveBeenLastCalledWith(
      { entityId: '', maxDepth: 3 },
      expect.objectContaining({
        query: expect.objectContaining({ enabled: false }),
      }),
    );
  });

  it('discloses incomplete entity and relationship pages with server-reported coverage counts', () => {
    vi.mocked(useListGraphEntities).mockReturnValue({
      data: {
        items: [sourceEntity, targetEntity],
        meta: { page: 1, pageSize: 100, total: 145, truncated: true },
      },
      isLoading: false,
    } as ReturnType<typeof useListGraphEntities>);
    vi.mocked(useListGraphRelationships).mockReturnValue({
      data: {
        items: [relationship],
        meta: { page: 1, pageSize: 100, total: 241, truncated: true },
      },
    } as ReturnType<typeof useListGraphRelationships>);

    render(<Graph />);

    const warning = screen.getByTestId('graph-partial-data-warning');
    expect(warning).toHaveTextContent('الرسم المعروض جزئي');
    expect(warning).toHaveTextContent('الكيانات المعروضة: 2 / 145');
    expect(warning).toHaveTextContent('العلاقات المعروضة: 1 / 241');
    expect(warning).toHaveAttribute('role', 'status');
  });

  it('consumes relationship items when an entity is selected', () => {
    render(<Graph />);

    fireEvent.click(screen.getByRole('button', { name: 'source.ts' }));

    expect(screen.getByRole('button', { name: 'العلاقات' })).toBeInTheDocument();
    expect(screen.getByText('الصادرة (1)')).toBeInTheDocument();
    expect(screen.getByText('calls')).toBeInTheDocument();
    expect(screen.getAllByText('buildGraph').length).toBeGreaterThan(0);
  });

  it('keeps the page RTL and source paths LTR in the graph details', () => {
    const { container } = render(<Graph />);

    expect(container.firstElementChild).toHaveAttribute('dir', 'rtl');
    fireEvent.click(screen.getByRole('button', { name: 'source.ts' }));
    expect(screen.getByText('src/source.ts', { exact: true })).toHaveAttribute('dir', 'ltr');
  });
});