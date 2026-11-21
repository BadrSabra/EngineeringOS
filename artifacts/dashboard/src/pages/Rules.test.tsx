import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readGoalDrafts, storeHomeGoalDraft } from '@/lib/home-goal-handoff';
import Rules from './Rules';

const mocks = vi.hoisted(() => {
  const mutation = () => ({ mutate: vi.fn(), isPending: false });

  return {
    rules: [
      {
        id: 'rule-1',
        projectId: undefined as string | null | undefined,
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
    clerkUser: { isLoaded: true, user: { id: 'user-1' } as { id: string } | null },
    setLocation: vi.fn(),
    mutations: {
      create: mutation(),
      update: mutation(),
      remove: mutation(),
      evaluate: mutation(),
    },
  };
});

vi.mock('@clerk/react', () => ({
  useUser: () => mocks.clerkUser,
}));

vi.mock('wouter', () => ({
  useLocation: () => ['/rules', mocks.setLocation],
}));

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
  const renderPage = () => (
    <QueryClientProvider client={queryClient}>
      <Rules />
    </QueryClientProvider>
  );
  const rendered = render(renderPage());
  return {
    invalidateQueries,
    rerender: () => rendered.rerender(renderPage()),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  mocks.projects.splice(0, mocks.projects.length, { id: 'project-1', name: 'Owned Project' });
  mocks.rules.splice(0, mocks.rules.length, {
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
  });
  for (const mutation of Object.values(mocks.mutations)) {
    mutation.isPending = false;
  }
});

function expandRule() {
  fireEvent.click(screen.getByRole('button', { name: 'توسيع القاعدة Avoid unsafe eval' }));
}

describe('Rule goal handoff integration', () => {
  it('offers the assistant handoff for a project-scoped rule', () => {
    mocks.rules[0] = { ...mocks.rules[0], projectId: 'project-1' };
    renderRulesPage();
    expandRule();

    expect(screen.getByTestId('button-rule-goal-handoff-rule-1')).toBeInTheDocument();
  });

  it('opens the assistant with an unsent rule setup draft and keeps manual creation available', () => {
    mocks.rules.splice(0);
    renderRulesPage();

    fireEvent.click(screen.getByTestId('button-rule-empty-assistant'));

    const draft = readGoalDrafts('user-1').drafts[0];
    expect(draft).toMatchObject({ source: 'home', projectId: null });
    expect(draft.text).toContain('أريد إعداد قاعدة فحص جديدة');
    expect(draft.text).toContain('لا تحفظ القاعدة ولا تعدّل ملفات المشروع');
    expect(mocks.setLocation).toHaveBeenCalledWith(`/ai?goalDraftId=${draft.id}`);
    expect(mocks.mutations.create.mutate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('أنشئ أول قاعدة'));
    expect(screen.getByText('إنشاء قاعدة جديدة')).toBeInTheDocument();
  });

  it('stays on the Rules page if the assistant draft cannot be saved', () => {
    mocks.rules.splice(0);
    for (let index = 0; index < 8; index += 1) {
      expect(storeHomeGoalDraft(`مسودة ${index}`, 'user-1')).not.toBeNull();
    }
    renderRulesPage();

    fireEvent.click(screen.getByTestId('button-rule-empty-assistant'));

    expect(screen.getByTestId('text-rule-goal-handoff-error')).toHaveTextContent(
      'تعذر حفظ مسودة طلب المساعدة.',
    );
    expect(mocks.setLocation).not.toHaveBeenCalled();
    expect(mocks.mutations.create.mutate).not.toHaveBeenCalled();
    expect(readGoalDrafts('user-1').drafts).toHaveLength(8);
  });
});

describe('Rules actions', () => {
  it('opens the only matching rule when Enter is pressed in search', () => {
    renderRulesPage();
    const search = screen.getByRole('textbox', { name: 'ابحث في القواعد' });

    fireEvent.change(search, { target: { value: 'unsafe' } });
    fireEvent.keyDown(search, { key: 'Enter', code: 'Enter' });

    expect(screen.getByRole('button', { name: 'طيّ القاعدة Avoid unsafe eval' }))
      .toHaveAttribute('aria-expanded', 'true');
  });

  it('does not choose a rule when Enter is pressed with multiple matches', () => {
    const savedRules = mocks.rules;
    mocks.rules = [
      ...savedRules,
      { ...savedRules[0], id: 'rule-2', code: 'SEC-002', title: 'Unsafe template evaluation' },
    ];

    try {
      renderRulesPage();
      const search = screen.getByRole('textbox', { name: 'ابحث في القواعد' });

      fireEvent.change(search, { target: { value: 'unsafe' } });
      fireEvent.keyDown(search, { key: 'Enter', code: 'Enter' });

      expect(screen.getByRole('button', { name: 'توسيع القاعدة Avoid unsafe eval' }))
        .toHaveAttribute('aria-expanded', 'false');
      expect(screen.getByRole('button', { name: 'توسيع القاعدة Unsafe template evaluation' }))
        .toHaveAttribute('aria-expanded', 'false');
    } finally {
      mocks.rules = savedRules;
    }
  });

  it('makes the read-only behavior clear when no rules have been added', () => {
    const savedRules = mocks.rules;
    mocks.rules = [];

    try {
      renderRulesPage();

      expect(screen.getByRole('heading', { level: 1, name: 'قواعد الفحص' })).toBeInTheDocument();
      expect(screen.getByText(/فحص القاعدة يعرض النتائج للمراجعة ولا يغيّر ملفات المشروع/)).toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 3, name: 'لم تضف قواعد للفحص بعد' })).toBeInTheDocument();
      expect(screen.getByText(/يعرض النتائج للمراجعة فقط، ولا يغيّر ملفات المشروع/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'أنشئ أول قاعدة' })).toBeInTheDocument();
      expect(screen.queryByText(/تشغيل الإصلاحات تلقائيًا/)).not.toBeInTheDocument();
    } finally {
      mocks.rules = savedRules;
    }
  });

  it('generates a unique rule code so creating a rule needs one fewer manual field', () => {
    renderRulesPage();
    fireEvent.click(screen.getByRole('button', { name: 'قاعدة جديدة' }));

    const codeInput = screen.getByTestId('input-new-rule-code');
    const generatedCode = (codeInput as HTMLInputElement).value;
    expect(generatedCode).toMatch(/^RULE-[0-9A-F]{20}$/);
    expect(screen.getByText('أنشأنا رمزًا فريدًا لك؛ يمكنك تغييره إذا احتجت.')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('مثال: منع حقن SQL في الاستعلامات'), {
      target: { value: 'مراجعة استخدام eval' },
    });
    fireEvent.change(screen.getByTestId('input-rule-pattern'), {
      target: { value: 'eval\\(' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'إنشاء القاعدة' }));

    expect(mocks.mutations.create.mutate).toHaveBeenCalledWith(
      {
        data: expect.objectContaining({
          code: generatedCode,
          title: 'مراجعة استخدام eval',
          pattern: 'eval\\(',
        }),
      },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );

    const [, callbacks] = mocks.mutations.create.mutate.mock.calls[0] as [
      unknown,
      { onSuccess: () => void },
    ];
    act(() => callbacks.onSuccess());
    fireEvent.click(screen.getByRole('button', { name: 'قاعدة جديدة' }));
    const nextCode = (screen.getByTestId('input-new-rule-code') as HTMLInputElement).value;
    expect(nextCode).toMatch(/^RULE-[0-9A-F]{20}$/);
    expect(nextCode).not.toBe(generatedCode);
  });

  it('edits supported fields through the generated update contract', async () => {
    const { invalidateQueries } = renderRulesPage();
    expandRule();
    fireEvent.click(screen.getByRole('button', { name: 'تعديل القاعدة' }));
    fireEvent.change(screen.getByLabelText('عنوان القاعدة'), {
      target: { value: 'Avoid unsafe dynamic code' },
    });
    fireEvent.change(screen.getByLabelText('مستوى الخطورة'), {
      target: { value: 'critical' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'حفظ التغييرات' }));

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
    expect(screen.getByTestId('rule-action-status-rule-1')).toHaveTextContent('تم تحديث القاعدة.');
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['/api/rules'] });
  });

  it('requires explicit confirmation before deleting a rule', async () => {
    renderRulesPage();
    expandRule();
    fireEvent.click(screen.getByRole('button', { name: 'حذف القاعدة' }));

    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      'سيؤدي هذا إلى إزالة القاعدة نهائيًا من محرك القواعد.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'حذف نهائيًا' }));

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
    expect(screen.getByTestId('rule-action-status-rule-1')).toHaveTextContent('تم حذف القاعدة.');
  });

  it('reconciles a removed evaluation project to a currently owned project before submitting', async () => {
    mocks.projects.push({ id: 'project-2', name: 'Second Project' });
    const { rerender } = renderRulesPage();
    expandRule();

    const projectSelect = screen.getByLabelText('مشروع الفحص');
    await waitFor(() => expect(projectSelect).toHaveValue('project-1'));
    fireEvent.change(projectSelect, { target: { value: 'project-2' } });
    expect(projectSelect).toHaveValue('project-2');

    // Simulate the latest owned-project query no longer containing the
    // previously selected project while the page remains mounted.
    mocks.projects.splice(0, mocks.projects.length, { id: 'project-1', name: 'Owned Project' });
    rerender();

    await waitFor(() => expect(projectSelect).toHaveValue('project-1'));
    fireEvent.click(screen.getByRole('button', { name: 'فحص القاعدة' }));

    expect(mocks.mutations.evaluate.mutate).toHaveBeenCalledWith(
      { ruleId: 'rule-1', data: { projectId: 'project-1' } },
      expect.objectContaining({
        onSuccess: expect.any(Function),
        onError: expect.any(Function),
      }),
    );
  });

  it('ignores a late evaluation result after the operator changes project', async () => {
    mocks.projects.push({ id: 'project-2', name: 'Second Project' });
    renderRulesPage();
    expandRule();

    const projectSelect = screen.getByLabelText('مشروع الفحص');
    await waitFor(() => expect(projectSelect).toHaveValue('project-1'));
    fireEvent.click(screen.getByRole('button', { name: 'فحص القاعدة' }));

    const [, callbacks] = mocks.mutations.evaluate.mutate.mock.calls[0] as [
      unknown,
      { onSuccess: (result: unknown) => void; onError: () => void },
    ];

    fireEvent.change(projectSelect, { target: { value: 'project-2' } });
    act(() => callbacks.onSuccess({
      ruleId: 'rule-1',
      projectId: 'project-1',
      matched: true,
      matchCount: 1,
      matches: [{ file: 'src/old-project.ts', line: 7, snippet: 'oldProjectMatch()' }],
    }));

    expect(screen.queryByTestId('rule-evaluation-result-rule-1')).not.toBeInTheDocument();

    // Returning to the original project must not resurrect a result from a
    // request that was superseded by the project switch.
    fireEvent.change(projectSelect, { target: { value: 'project-1' } });
    expect(screen.queryByTestId('rule-evaluation-result-rule-1')).not.toBeInTheDocument();
  });

  it('ignores a late evaluation error after the operator changes project', async () => {
    mocks.projects.push({ id: 'project-2', name: 'Second Project' });
    renderRulesPage();
    expandRule();

    const projectSelect = screen.getByLabelText('مشروع الفحص');
    await waitFor(() => expect(projectSelect).toHaveValue('project-1'));
    fireEvent.click(screen.getByRole('button', { name: 'فحص القاعدة' }));

    const [, callbacks] = mocks.mutations.evaluate.mutate.mock.calls[0] as [
      unknown,
      { onSuccess: (result: unknown) => void; onError: () => void },
    ];

    fireEvent.change(projectSelect, { target: { value: 'project-2' } });
    act(() => callbacks.onError());

    expect(screen.queryByTestId('rule-evaluation-error-rule-1')).not.toBeInTheDocument();
  });

  it('evaluates a patterned rule against a selected owned project and renders matches', async () => {
    renderRulesPage();
    expandRule();
    const projectSelect = screen.getByLabelText('مشروع الفحص');
    await waitFor(() => expect(projectSelect).toHaveValue('project-1'));
    fireEvent.click(screen.getByRole('button', { name: 'فحص القاعدة' }));

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

    const result = screen.getByTestId('rule-evaluation-result-rule-1');
    expect(result).toHaveTextContent('عدد المطابقات: ١');
    expect(within(result).getByText('Owned Project')).toHaveAttribute('dir', 'auto');
    expect(within(result).getByText('src/unsafe.ts:12')).toHaveAttribute('dir', 'ltr');
    expect(within(result).getByText('eval(input)')).toHaveAttribute('dir', 'ltr');
  });

  it('shows the Arabic no-match result for the selected project', async () => {
    renderRulesPage();
    expandRule();
    fireEvent.click(screen.getByRole('button', { name: 'فحص القاعدة' }));

    const [, callbacks] = mocks.mutations.evaluate.mutate.mock.calls[0] as [
      unknown,
      { onSuccess: (result: unknown) => void },
    ];
    act(() => callbacks.onSuccess({
      ruleId: 'rule-1',
      projectId: 'project-1',
      matched: false,
      matchCount: 0,
      matches: [],
    }));

    const result = screen.getByTestId('rule-evaluation-result-rule-1');
    expect(result).toHaveTextContent('لم تُعثر على مطابقات.');
    expect(within(result).getByText('Owned Project')).toHaveAttribute('dir', 'auto');
  });
});