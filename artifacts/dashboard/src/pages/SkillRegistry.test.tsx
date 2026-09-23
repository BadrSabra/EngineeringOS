import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SkillRegistry from './SkillRegistry';

vi.mock('@workspace/api-client-react', () => ({
  useListProjects: vi.fn(),
}));

import { useListProjects } from '@workspace/api-client-react';

const project = { id: 'project-1', name: 'Alpha service' };
const score = {
  contractVersion: 1,
  status: 'passed',
  promotionAllowed: true,
  pairId: 'shadow-replay-pair:replay-1',
  suiteVersion: 'flight-deck-v2',
  baselineWorkspaceHash: 'b'.repeat(64),
  candidateWorkspaceHash: 'a'.repeat(64),
  metricDeltas: { evidenceCoverage: 0 },
  terminalMismatchCount: 0,
  caseCount: 3,
  blockers: [],
};

const pendingRegistry = {
  id: 'registry-1',
  projectId: project.id,
  skillId: 'candidate-review',
  skillVersion: '1.0.0',
  candidateId: 'skill-candidate:proposal-1',
  proposalId: 'proposal-1',
  shadowReplayId: 'replay-1',
  proofReceiptId: 'receipt-1',
  sourceRevision: 'c'.repeat(40),
  candidateTreeHash: 'a'.repeat(64),
  shadowScore: score,
  promotionStatus: 'pending',
  revocationStatus: 'active',
  approvedBy: null,
  approvedAt: null,
  revokedBy: null,
  revokedAt: null,
  createdAt: '2026-09-23T10:00:00.000Z',
  updatedAt: '2026-09-23T10:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useListProjects).mockReturnValue({
    data: [project],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  } as ReturnType<typeof useListProjects>);
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST' && String(_url).endsWith('/approve')) {
      return {
        ok: true,
        json: async () => ({
          registry: {
            ...pendingRegistry,
            promotionStatus: 'promoted',
            approvedBy: 'operator-1',
            approvedAt: '2026-09-23T10:01:00.000Z',
          },
        }),
      };
    }
    if (init?.method === 'POST' && String(_url).endsWith('/revoke')) {
      return {
        ok: true,
        json: async () => ({
          registry: {
            ...pendingRegistry,
            promotionStatus: 'promoted',
            revocationStatus: 'revoked',
            approvedBy: 'operator-1',
            approvedAt: '2026-09-23T10:01:00.000Z',
            revokedBy: 'operator-1',
            revokedAt: '2026-09-23T10:02:00.000Z',
          },
        }),
      };
    }
    return {
      ok: true,
      json: async () => ({ registry: [pendingRegistry] }),
    };
  }));
  vi.stubGlobal('confirm', vi.fn(() => true));
});

describe('SkillRegistry', () => {
  it('loads a registry row and projects approve/revoke mutations immediately', async () => {
    render(<SkillRegistry />);

    expect(await screen.findByText('candidate-review')).toBeInTheDocument();
    expect(screen.getByText('pending')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('approve-registry-1'));
    await waitFor(() => expect(screen.getByText('promoted')).toBeInTheDocument());
    expect(screen.getByTestId('revoke-registry-1')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('revoke-registry-1'));
    await waitFor(() => expect(screen.getByText('revoked')).toBeInTheDocument());
    expect(screen.queryByTestId('revoke-registry-1')).not.toBeInTheDocument();
  });
});