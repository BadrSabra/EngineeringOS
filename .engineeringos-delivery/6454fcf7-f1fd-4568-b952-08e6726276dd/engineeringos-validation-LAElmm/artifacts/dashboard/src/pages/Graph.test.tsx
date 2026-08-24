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
    expect(screen.getByText('Entities (2)')).toBeInTheDocument();
    expect(container.querySelector('line')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Find entity...'), {
      target: { value: 'build' },
    });

    expect(screen.getByRole('button', { name: 'buildGraph' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'source.ts' })).not.toBeInTheDocument();
    expect(screen.getByText('Entities (1)')).toBeInTheDocument();
  });

  it('consumes relationship items when an entity is selected', () => {
    render(<Graph />);

    fireEvent.click(screen.getByRole('button', { name: 'source.ts' }));

    expect(screen.getByRole('button', { name: 'Relations' })).toBeInTheDocument();
    expect(screen.getByText('Outgoing (1)')).toBeInTheDocument();
    expect(screen.getByText('calls')).toBeInTheDocument();
    expect(screen.getAllByText('buildGraph').length).toBeGreaterThan(0);
  });
});