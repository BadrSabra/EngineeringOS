import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Rules from './Rules';

const mocks = vi.hoisted(() => {
  const mutation = () => ({ mutate: vi.fn(), isPending: false });

  return {
    rules: [
      {
        id: 'rule-1',
        projectId: undefined,
        code: 'SEC-001',
        title: 'Avoid unsafe eval',
        description: 'Detect dynamic evaluation.',
        severity: 'high',
        pattern: 'eval\\(',
        fixDescription: 'Use a safe parser.',
        verifySteps: ['pnpm test'],
        enabled: true,
        hitCount: 1,
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-01T00:00:00.000Z',
      },
    ],
    projects: [{ id: 'project-1', name: 'Owned Project' }],
    mutations: {
      create: mutation(),
      update: mutation(),
      remove: mutation(),
      evaluate: mutation(),
    },
  };
});

vi.mock('@workspace/api-client-react', () => ({
  getListRulesQueryKey: (params?: unknown) =>
    params ? ['/api/rules', params] : ['/api/rules'],
  getListProjectsQueryKey: (params?: unknown) =>
    params ? ['/api/projects', params] : ['/api/projects'],
  useListRules: () => ({
    data: mocks.rules,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    isRefetching: false,
    dataUpdatedAt: 1,
  }),
  useListProjects: () => ({
    data: mocks.projects,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useCreateRule: () => mocks.mutations.create,
  useUpdateRule: () => mocks.mutations.update,
  useDeleteRule: () => mocks.mutations.remove,
  useEvaluateRule: () => mocks.mutations.evaluate,
}));

function renderRulesPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
  render(
    <QueryClientProvider client={queryClient}>
      <Rules />
    </QueryClientProvider>,
  );
  return { invalidateQueries };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rules[0] = {
    ...mocks.rules[0],
    title: 'Avoid unsafe eval',
    severity: 'high',
    enabled: true,
  };
  for (const mutation of Object.values(mocks.mutations)) {
    mutation.isPending = false;
  }
});

function expandRule() {
  fireEvent.click(screen.getByRole('button', { name: 'Expand rule Avoid unsafe eval' }));
}

describe('Rules actions', () => {
  it('edits supported fields through the generated update contract', async () => {
    const { invalidateQueries } = renderRulesPage();
    expandRule();
    fireEvent.click(screen.getByRole('button', { name: 'Edit rule' }));
    fireEvent.change(screen.getByLabelText('Rule title'), {
      target: { value: 'Avoid unsafe dynamic code' },
    });
    fireEvent.change(screen.getByLabelText('Severity'), {
      target: { value: 'critical' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(mocks.mutations.update.mutate).toHaveBeenCalledWith(
        {
          ruleId: 'rule-1',
          data: {
            title: 'Avoid unsafe dynamic code',
            description: 'Detect dynamic evaluation.',
            severity: 'critical',
            pattern: 'eval\\(',
            fixDescription: 'Use a safe parser.',
            enabled: true,
          },
        },
        expect.objectContaining({
          onSuccess: expect.any(Function),
          onError: expect.any(Function),
        }),
      );
    });

    const [, callbacks] = mocks.mutations.update.mutate.mock.calls[0] as [
      unknown,
      { onSuccess: () => void },
    ];
    act(() => callbacks.onSuccess());
    expect(screen.getByTestId('rule-action-status-rule-1')).toHaveTextContent('Rule updated.');
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['/api/rules'] });
  });

  it('requires explicit confirmation before deleting a rule', async () => {
    renderRulesPage();
    expandRule();
    fireEvent.click(screen.getByRole('button', { name: 'Delete rule' }));

    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      'This permanently removes the rule from the Rules Engine.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }));

    await waitFor(() => {
      expect(mocks.mutations.remove.mutate).toHaveBeenCalledWith(
        { ruleId: 'rule-1' },
        expect.objectContaining({
          onSuccess: expect.any(Function),
          onError: expect.any(Function),
        }),
      );
    });

    const [, callbacks] = mocks.mutations.remove.mutate.mock.calls[0] as [
      unknown,
      { onSuccess: () => void },
    ];
    act(() => callbacks.onSuccess());
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });

  it('evaluates a patterned rule against a selected owned project and renders matches', async () => {
    renderRulesPage();
    expandRule();
    const projectSelect = screen.getByLabelText('Evaluate against project');
    await waitFor(() => expect(projectSelect).toHaveValue('project-1'));
    fireEvent.click(screen.getByRole('button', { name: 'Evaluate rule' }));

    await waitFor(() => {
      expect(mocks.mutations.evaluate.mutate).toHaveBeenCalledWith(
        { ruleId: 'rule-1', data: { projectId: 'project-1' } },
        expect.objectContaining({
          onSuccess: expect.any(Function),
          onError: expect.any(Function),
        }),
      );
    });

    const [, callbacks] = mocks.mutations.evaluate.mutate.mock.calls[0] as [
      unknown,
      { onSuccess: (result: unknown) => void },
    ];
    act(() =>
      callbacks.onSuccess({
        ruleId: 'rule-1',
        projectId: 'project-1',
        matched: true,
        matchCount: 1,
        matches: [
          {
            file: 'src/unsafe.ts',
            line: 12,
            snippet: 'eval(input)',
          },
        ],
      }),
    );

    expect(screen.getByTestId('rule-evaluation-result-rule-1')).toHaveTextContent(
      '1 match found in Owned Project',
    );
    expect(screen.getByTestId('rule-evaluation-result-rule-1')).toHaveTextContent(
      'src/unsafe.ts:12',
    );
    expect(screen.getByTestId('rule-evaluation-result-rule-1')).toHaveTextContent('eval(input)');
  });
});