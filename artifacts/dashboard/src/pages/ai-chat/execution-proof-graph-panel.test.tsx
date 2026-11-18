import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExecutionProofGraphProjectorResult } from '@workspace/api-client-react';
import { ExecutionProofGraphPanel } from './execution-proof-graph-panel';

const projectedResult = {
  kind: 'PROJECTED',
  authority: 'READ_ONLY_PROJECTION',
  graphHash: 'a'.repeat(64),
  graph: {
    version: 1,
    profile: 'runtime_start_gate_c_v1',
    graphId: 'graph-1',
    projectId: 'project-1',
    executionId: 'execution-1',
    attempt: 2,
    operationId: 'operation-1',
    sourceRevision: `workspace-tree-v1:${'b'.repeat(64)}`,
    sourceRevisionKind: 'workspace_tree',
    sourceRevisionSource: 'delivery_tree_digest_v1',
    candidateIdentity: null,
    environmentRevision: `env-v1:${'c'.repeat(64)}`,
    nodes: [
      {
        id: 'execution-node',
        projectId: 'project-1',
        executionId: 'execution-1',
        attempt: 2,
        kind: 'EXECUTION',
        status: 'completed',
      },
      {
        id: 'acceptance-node',
        projectId: 'project-1',
        executionId: 'execution-1',
        attempt: 2,
        kind: 'ACCEPTANCE',
        outcome: 'SUCCEEDED',
      },
    ],
    edges: [{
      id: 'edge-1',
      from: 'execution-node',
      to: 'acceptance-node',
      type: 'EXECUTION_HAS_ACCEPTANCE',
    }],
  },
  canonicalProof: {
    accepted: true,
    verdict: 'PROVEN',
    executionId: 'execution-1',
    acceptanceId: 'acceptance-1',
    evidenceSnapshotId: 'snapshot-1',
    attempt: 2,
    operationId: 'operation-1',
    sourceRevision: `workspace-tree-v1:${'b'.repeat(64)}`,
    candidateIdentity: null,
  },
  structuralValidation: {
    validatorVersion: 'execution-proof-graph-validator.v1',
    authority: 'STRUCTURE_ONLY_NO_EXECUTION_AUTHORITY',
    verdict: 'PASS',
    graphHash: 'a'.repeat(64),
    violations: [],
  },
} as unknown as ExecutionProofGraphProjectorResult;

const notProjectableResult = {
  kind: 'NOT_PROJECTABLE',
  authority: 'READ_ONLY_PROJECTION',
  executionId: 'execution-1',
  expectedAttempt: 2,
  reasons: ['UNSUPPORTED_PROOF_MODE'],
} as unknown as ExecutionProofGraphProjectorResult;

const incompleteEvidenceResult = {
  kind: 'NOT_PROJECTABLE',
  authority: 'READ_ONLY_PROJECTION',
  executionId: 'execution-1',
  expectedAttempt: 2,
  reasons: ['EVIDENCE_INCOMPLETE'],
} as unknown as ExecutionProofGraphProjectorResult;

function renderPanel({
  projectId = "project-1",
  executionId = "execution-1",
  attempt = 2,
}: {
  projectId?: string;
  executionId?: string;
  attempt?: number;
} = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ExecutionProofGraphPanel projectId={projectId} executionId={executionId} attempt={attempt} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ExecutionProofGraphPanel', () => {
  it('loads only on demand and keeps graph structure separate from Canonical Proof', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(projectedResult), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    renderPanel();
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('button-proof-graph-execution-1'));
    expect(await screen.findByTestId('proof-graph-result')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      '/api/projects/project-1/executions/execution-1/proof-graph/attempts/2',
    );
    expect(screen.getByTestId('status-proof-graph-canonical')).toHaveTextContent('PROVEN');
    expect(screen.getByTestId('status-proof-graph-structure')).toHaveTextContent('اجتاز البنية');
    expect(screen.getByText(/لا يمنح صلاحية تنفيذ أو تطبيق/)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('toggle-proof-graph-relationships'));
    expect(screen.getByTestId('row-proof-graph-edge-edge-1')).toHaveTextContent('يرتبط بالقبول');
  });

  it('shows a bounded non-projectable reason without implying proof failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(notProjectableResult), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })));

    renderPanel();
    fireEvent.click(screen.getByTestId('button-proof-graph-execution-1'));

    expect(await screen.findByTestId('status-proof-graph-unavailable'))
      .toHaveTextContent('نوع الإثبات غير مدعوم في هذه النسخة.');
    expect(screen.queryByTestId('status-proof-graph-canonical')).not.toBeInTheDocument();
  });

  it('distinguishes incomplete evidence from a Gate C proof mismatch', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(incompleteEvidenceResult), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })));

    renderPanel();
    fireEvent.click(screen.getByTestId('button-proof-graph-execution-1'));

    expect(await screen.findByTestId('status-proof-graph-unavailable'))
      .toHaveTextContent('لقطة الأدلة غير مكتملة أو لا تستوفي شروط القبول.');
  });
  it.each([
    {
      label: "graph project",
      result: {
        ...projectedResult,
        graph: { ...projectedResult.graph, projectId: "project-foreign" },
      },
    },
    {
      label: "graph execution",
      result: {
        ...projectedResult,
        graph: { ...projectedResult.graph, executionId: "execution-foreign" },
      },
    },
    {
      label: "graph attempt",
      result: {
        ...projectedResult,
        graph: { ...projectedResult.graph, attempt: 1 },
      },
    },
    {
      label: "canonical proof attempt",
      result: {
        ...projectedResult,
        canonicalProof: { ...projectedResult.canonicalProof, attempt: 1 },
      },
    },
    {
      label: "node project",
      result: {
        ...projectedResult,
        graph: {
          ...projectedResult.graph,
          nodes: projectedResult.graph.nodes.map((node, index) =>
            index === 0 ? { ...node, projectId: "project-foreign" } : node),
        },
      },
    },
  ])("fails closed when a projected response has a mismatched $label identity", async ({ result }) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })));

    renderPanel();
    fireEvent.click(screen.getByTestId('button-proof-graph-execution-1'));

    expect(await screen.findByTestId('status-proof-graph-identity-mismatch'))
      .toHaveTextContent('لا تطابق هوية المشروع أو التنفيذ أو المحاولة المطلوبة');
    expect(screen.queryByTestId('proof-graph-result')).not.toBeInTheDocument();
    expect(screen.queryByTestId('status-proof-graph-unavailable')).not.toBeInTheDocument();
  });

  it('does not render a NOT_PROJECTABLE reason for a different execution attempt', async () => {
    const response = { ...notProjectableResult, expectedAttempt: 3 };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })));

    renderPanel();
    fireEvent.click(screen.getByTestId('button-proof-graph-execution-1'));

    expect(await screen.findByTestId('status-proof-graph-identity-mismatch')).toBeInTheDocument();
    expect(screen.queryByTestId('status-proof-graph-unavailable')).not.toBeInTheDocument();
  });

});
