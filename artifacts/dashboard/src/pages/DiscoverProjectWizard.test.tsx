import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DiscoverProjectWizard } from './DiscoverProjectWizard';

const mocks = vi.hoisted(() => ({
  startDiscovery: vi.fn(),
  importProject: vi.fn(),
  scanProject: vi.fn(),
  scanProjectState: {
    isPending: false,
    isError: false,
    error: null as unknown,
  },
  invalidateQueries: vi.fn(() => Promise.resolve()),
  navigate: vi.fn(),
  session: {
    id: 'discovery-1',
    status: 'ready',
    progress: 100,
    currentStep: null,
    steps: [],
    startedAt: '2026-10-14T12:00:00.000Z',
    completedAt: '2026-10-14T12:00:01.000Z',
  },
  sessionWithoutCache: false,
  projects: [] as { id: string; name: string; rootPath: string; language?: string | null }[],
  sessionQuery: {
    isError: false,
    isFetching: false,
    dataUpdatedAt: Date.parse('2026-11-18T16:20:00.000Z'),
    refetch: vi.fn(),
  },
  report: {
    id: 'discovery-1',
    detectedName: 'sample-app',
    detectedLanguage: 'TypeScript',
    detectedLanguages: ['TypeScript'],
    detectedFramework: 'React',
    detectedRuntime: 'Node.js',
    detectedPackageManager: 'pnpm',
    detectedArchitecture: 'Modular',
    detectedDb: null,
    detectedOrm: null,
    detectedTestFramework: null,
    detectedBuildTool: 'Vite',
    detectedCi: null,
    isMonorepo: false,
    hasDocker: false,
    hasOpenApi: false,
    packageCount: 4,
    moduleCount: 3,
    repoSizeBytes: 1200,
    detectedApis: [],
    detectedRisks: ['No test framework detected'],
    qualityScore: 74,
    confidenceScore: 91,
    completeness: 'COMPLETE',
    completenessReasons: [],
    graphSummary: { entityCount: 5, relationshipCount: 4 },
    supportMatrix: {
      languages: [
        {
          id: 'typescript',
          label: 'TypeScript',
          kind: 'language',
          level: 'deep',
          parser: 'TypeScript compiler API',
          graph: 'AST entities and source relationships',
          validation: 'Generic registered profiles; no language-specific profile',
          changeReadiness: 'Source-grounded planning is available',
          limitations: [
            'Framework-specific validation is not inferred from the language alone.',
          ],
        },
      ],
      frameworks: [
        {
          id: 'react',
          label: 'React',
          kind: 'framework',
          level: 'partial',
          parser: 'Uses the detected project-language parser',
          graph: 'No framework-specific graph extractor',
          validation: 'No framework-specific registered validation profile',
          changeReadiness: 'Source-grounded planning only',
          limitations: [
            'Framework support currently means dependency/configuration detection.',
            'Framework-specific build, test, and runtime checks are not registered.',
          ],
        },
      ],
    },
    ruleViolations: [
      {
        ruleId: 'rule-no-tests',
        code: 'NO_TESTS',
        title: 'No tests found',
        severity: 'high',
        count: 2,
        matches: [
          {
            file: 'src/app.ts',
            line: 7,
            snippet: 'export const app = createApp();',
            occurrences: 2,
          },
        ],
        fixDescription: 'Add tests for the application entry point.',
        verifySteps: ['Run pnpm test'],
        remediationPlan: {
          status: 'needs_review',
          relatedFiles: ['src/app.ts'],
        },
      },
    ],
  },
}));

vi.mock('@workspace/api-client-react', () => ({
  useStartDiscovery: () => ({
    mutateAsync: mocks.startDiscovery,
    isPending: false,
  }),
  useUploadArchive: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useGetDiscoverySession: (id: string) => ({
    data: id && !mocks.sessionWithoutCache ? mocks.session : undefined,
    ...mocks.sessionQuery,
  }),
  useGetDiscoverySummary: (id: string) => ({
    data: id ? mocks.report : undefined,
    error: null,
  }),
  useImportProject: () => ({ mutateAsync: mocks.importProject, isPending: false }),
  useListProjects: () => ({
    data: mocks.projects,
    isLoading: false,
    isFetching: false,
    isError: false,
  }),
  useScanProject: () => ({
    mutateAsync: mocks.scanProject,
    ...mocks.scanProjectState,
  }),
  getListProjectsQueryKey: () => ['/api/projects'],
  getGetDiscoverySessionQueryKey: (id: string) => ['/api/projects/discover', id],
  getGetDiscoverySummaryQueryKey: (id: string) => ['/api/projects/discover', id, 'summary'],
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}));

vi.mock('wouter', () => ({
  useLocation: () => ['/projects', mocks.navigate],
}));

describe('DiscoverProjectWizard Arabic findings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.status = 'ready';
    mocks.session.progress = 100;
    mocks.sessionWithoutCache = false;
    mocks.projects = [];
    mocks.sessionQuery.isError = false;
    mocks.sessionQuery.isFetching = false;
    mocks.sessionQuery.dataUpdatedAt = Date.parse('2026-11-18T16:20:00.000Z');
    mocks.sessionQuery.refetch.mockClear();
    mocks.startDiscovery.mockResolvedValue(mocks.session);
    mocks.importProject.mockResolvedValue({ id: 'imported-project' });
    mocks.scanProject.mockResolvedValue(undefined);
    mocks.scanProjectState.isPending = false;
    mocks.scanProjectState.isError = false;
    mocks.scanProjectState.error = null;
  });

  it('explains where each project source comes from before the user starts scanning', () => {
    render(<DiscoverProjectWizard onClose={vi.fn()} />);

    expect(screen.getByRole('group', { name: 'طرق اختيار مصدر المشروع' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /رابط المشروع/ })).toHaveTextContent(
      'الصق رابط HTTPS للمستودع',
    );
    expect(screen.getByRole('button', { name: /ملف مضغوط من جهازك/ })).toHaveTextContent(
      'ارفع نسخة ZIP أو TAR.GZ أو TGZ',
    );
    expect(screen.getByRole('button', { name: /مجلد موجود على الخادم/ })).toHaveTextContent(
      'خيار متقدم يتطلب مسار المجلد على خادم التطبيق',
    );
    expect(screen.getByText(/لا يبدأ الفحص إلا بعد ضغطك/)).toBeInTheDocument();
    expect(mocks.startDiscovery).not.toHaveBeenCalled();
  });

  it('exposes the selected source and updates it without starting a scan', () => {
    render(<DiscoverProjectWizard onClose={vi.fn()} />);

    const gitSource = screen.getByTestId('source-card-GIT_REPOSITORY');
    const archiveSource = screen.getByTestId('source-card-ARCHIVE_UPLOAD');
    expect(gitSource).toHaveAttribute('aria-pressed', 'true');
    expect(archiveSource).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(archiveSource);

    expect(gitSource).toHaveAttribute('aria-pressed', 'false');
    expect(archiveSource).toHaveAttribute('aria-pressed', 'true');
    expect(mocks.startDiscovery).not.toHaveBeenCalled();
  });

  it('selects the sole existing project automatically but waits for an explicit scan', async () => {
    mocks.projects = [{
      id: 'existing-project',
      name: 'المشروع الوحيد',
      rootPath: '/workspace/project',
      language: 'TypeScript',
    }];
    render(<DiscoverProjectWizard onClose={vi.fn()} />);

    fireEvent.click(screen.getByTestId('source-card-WORKSPACE_PROJECT'));
    const onlyProject = screen.getByTestId('workspace-project-existing-project');
    await waitFor(() => expect(onlyProject).toHaveAttribute('aria-pressed', 'true'));
    expect(mocks.startDiscovery).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('start-discovery'));
    await waitFor(() => {
      expect(mocks.startDiscovery).toHaveBeenCalledWith({
        data: {
          sourceType: 'WORKSPACE_PROJECT',
          sourceConfig: { projectId: 'existing-project' },
        },
      });
    });
  });

  it('keeps project choice explicit when more than one project is available', () => {
    mocks.projects = [
      { id: 'project-one', name: 'المشروع الأول', rootPath: '/workspace/one' },
      { id: 'project-two', name: 'المشروع الثاني', rootPath: '/workspace/two' },
    ];
    render(<DiscoverProjectWizard onClose={vi.fn()} />);

    fireEvent.click(screen.getByTestId('source-card-WORKSPACE_PROJECT'));
    expect(screen.getByTestId('workspace-project-project-one')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('workspace-project-project-two')).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByTestId('start-discovery'));
    expect(screen.getByTestId('discovery-start-error')).toHaveTextContent('اختر مشروعًا أولًا.');
    expect(mocks.startDiscovery).not.toHaveBeenCalled();
  });

  it('marks a cached discovery session as stale after a failed poll and offers a direct retry', async () => {
    mocks.session.status = 'discovering';
    mocks.session.progress = 42;
    mocks.sessionQuery.isError = true;
    const lastSuccessfulRead = Date.parse('2026-11-18T16:20:00.000Z');

    render(<DiscoverProjectWizard onClose={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('https://github.com/owner/repo'), {
      target: { value: 'https://github.com/example/sample-app' },
    });
    fireEvent.click(screen.getByTestId('start-discovery'));

    const warning = await screen.findByTestId('discovery-session-read-error');
    expect(warning).toHaveTextContent('آخر قراءة ناجحة ولا يؤكد الحالة الحالية');
    expect(screen.getByTestId('discovery-session-last-success')).toHaveTextContent(
      new Date(lastSuccessfulRead).toLocaleString('ar-EG'),
    );
    expect(screen.getByText('42%')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'إعادة قراءة حالة الاستكشاف' }));
    expect(mocks.sessionQuery.refetch).toHaveBeenCalledOnce();
  });

  it('distinguishes an initial discovery-session read failure without inventing a last-success timestamp', async () => {
    mocks.session.status = 'discovering';
    mocks.session.progress = 18;
    mocks.sessionWithoutCache = true;
    mocks.sessionQuery.isError = true;
    mocks.sessionQuery.dataUpdatedAt = 0;

    render(<DiscoverProjectWizard onClose={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('https://github.com/owner/repo'), {
      target: { value: 'https://github.com/example/sample-app' },
    });
    fireEvent.click(screen.getByTestId('start-discovery'));

    const warning = await screen.findByTestId('discovery-session-read-error');
    expect(warning).toHaveTextContent('معلومات البدء لا تؤكد التقدم الحالي');
    expect(screen.queryByTestId('discovery-session-last-success')).not.toBeInTheDocument();
    expect(screen.getByTestId('discovery-session-progress-unavailable')).toBeInTheDocument();
    expect(screen.queryByText('18%')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'إعادة قراءة حالة الاستكشاف' }));
    expect(mocks.sessionQuery.refetch).toHaveBeenCalledOnce();
  });

  it('shows localized support dimensions and risks while retaining original rule evidence in accessible details', async () => {
    render(<DiscoverProjectWizard onClose={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText('https://github.com/owner/repo'), {
      target: { value: 'https://github.com/example/sample-app' },
    });
    fireEvent.click(screen.getByTestId('start-discovery'));

    await screen.findByRole('heading', { name: 'نتائج استكشاف المشروع' });
    expect(mocks.startDiscovery).toHaveBeenCalledWith({
      data: {
        sourceType: 'GIT_REPOSITORY',
        sourceConfig: { url: 'https://github.com/example/sample-app' },
      },
    });

    const technicalDetails = screen.getByTestId('discovery-technical-details');
    const technicalSummary = screen.getByTestId('summary-discovery-technical-details');
    expect(technicalDetails).not.toHaveAttribute('open');
    expect(screen.getByTestId('discovery-support-boundary')).toBeVisible();
    expect(technicalSummary).toHaveTextContent('تفاصيل تقنية إضافية');
    fireEvent.click(technicalSummary);
    await waitFor(() => expect(technicalDetails).toHaveAttribute('open'));

    expect(screen.getAllByText('جاهزية التغيير:')).toHaveLength(2);
    expect(screen.getByText('يمكن إعداد خطة تستند إلى ملفات المشروع.')).toBeInTheDocument();
    expect(screen.getByText('لم يُكتشف إطار لاختبار المشروع.')).toBeInTheDocument();
    expect(screen.getByText('لا يُستنتج توفر فحوص إطار العمل من اسم اللغة وحده.')).toBeInTheDocument();
    expect(screen.getByText('يقتصر دعم إطار العمل حاليًا على اكتشاف الحزم وملفات الإعداد.')).toBeInTheDocument();
    expect(screen.getByText('لم تُسجّل فحوص بناء أو اختبار أو تشغيل خاصة بإطار العمل.')).toBeInTheDocument();

    const detailsSummary = screen.getByTestId('summary-discovery-violation-0');
    expect(detailsSummary).toHaveTextContent('عرض العنوان والأدلة والتفاصيل الفنية الأصلية');
    fireEvent.click(detailsSummary);

    expect(screen.getByText('No tests found')).toBeInTheDocument();
    expect(screen.getByText('Add tests for the application entry point.')).toBeInTheDocument();
    expect(screen.getByText('src/app.ts:7 — export const app = createApp(); (2)')).toBeInTheDocument();
    expect(screen.getByText('Run pnpm test')).toBeInTheDocument();
    await waitFor(() => expect(detailsSummary.closest('details')).toHaveAttribute('open'));
  });


  it('does not navigate when project import resolves after the wizard unmounts', async () => {
    let resolveImport!: (project: { id: string }) => void;
    mocks.importProject.mockReturnValue(new Promise<{ id: string }>((resolve) => { resolveImport = resolve; }));
    const onClose = vi.fn();
    const view = render(<DiscoverProjectWizard onClose={onClose} />);

    fireEvent.change(screen.getByPlaceholderText('https://github.com/owner/repo'), {
      target: { value: 'https://github.com/example/sample-app' },
    });
    fireEvent.click(screen.getByTestId('start-discovery'));
    await screen.findByRole('heading', { name: 'نتائج استكشاف المشروع' });
    fireEvent.click(screen.getByRole('button', { name: 'تأكيد وإضافة المشروع' }));
    expect(mocks.importProject).toHaveBeenCalledOnce();

    view.unmount();
    await act(async () => {
      resolveImport({ id: 'imported-project' });
      await Promise.resolve();
    });

    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['/api/projects'] });
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('keeps the success screen open until the user opens the project', async () => {
    const onClose = vi.fn();
    render(<DiscoverProjectWizard onClose={onClose} />);

    fireEvent.change(screen.getByPlaceholderText('https://github.com/owner/repo'), {
      target: { value: 'https://github.com/example/sample-app' },
    });
    fireEvent.click(screen.getByTestId('start-discovery'));
    await screen.findByRole('heading', { name: 'نتائج استكشاف المشروع' });

    vi.useFakeTimers();
    try {
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'تأكيد وإضافة المشروع' }));
        await Promise.resolve();
      });
      expect(screen.getByRole('heading', { name: 'تمت إضافة المشروع' })).toBeInTheDocument();
      expect(screen.getByTestId('button-open-imported-project')).toBeInTheDocument();

      act(() => { vi.advanceTimersByTime(3_000); });
      expect(onClose).not.toHaveBeenCalled();
      expect(mocks.navigate).not.toHaveBeenCalled();

      fireEvent.click(screen.getByTestId('button-open-imported-project'));
      expect(onClose).toHaveBeenCalledOnce();
      expect(mocks.navigate).toHaveBeenCalledWith('/projects/imported-project');
    } finally {
      vi.useRealTimers();
    }
  });

  it('allows the user to start a scan before opening the imported project', async () => {
    const onClose = vi.fn();
    render(<DiscoverProjectWizard onClose={onClose} />);

    fireEvent.change(screen.getByPlaceholderText('https://github.com/owner/repo'), {
      target: { value: 'https://github.com/example/sample-app' },
    });
    fireEvent.click(screen.getByTestId('start-discovery'));
    await screen.findByRole('heading', { name: 'نتائج استكشاف المشروع' });
    fireEvent.click(screen.getByRole('button', { name: 'تأكيد وإضافة المشروع' }));
    await screen.findByRole('heading', { name: 'تمت إضافة المشروع' });

    fireEvent.click(screen.getByRole('button', { name: 'ابدأ الفحص' }));
    await waitFor(() => expect(mocks.scanProject).toHaveBeenCalledWith({ projectId: 'imported-project' }));
    expect(screen.getByTestId('button-open-imported-project')).toBeInTheDocument();
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('keeps the project scan retryable after a failed attempt', async () => {
    mocks.scanProject
      .mockImplementationOnce(async () => {
        mocks.scanProjectState.isError = true;
        mocks.scanProjectState.error = new Error('Scan queue unavailable');
        throw new Error('Scan queue unavailable');
      })
      .mockImplementationOnce(async () => {
        mocks.scanProjectState.isError = false;
        mocks.scanProjectState.error = null;
        return undefined;
      });

    render(<DiscoverProjectWizard onClose={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('https://github.com/owner/repo'), {
      target: { value: 'https://github.com/example/sample-app' },
    });
    fireEvent.click(screen.getByTestId('start-discovery'));
    await screen.findByRole('heading', { name: 'نتائج استكشاف المشروع' });
    fireEvent.click(screen.getByRole('button', { name: 'تأكيد وإضافة المشروع' }));
    await screen.findByRole('heading', { name: 'تمت إضافة المشروع' });

    fireEvent.click(screen.getByRole('button', { name: 'ابدأ الفحص' }));
    const retryButton = await screen.findByRole('button', { name: 'أعد محاولة الفحص' });
    expect(screen.getByTestId('scan-project-error')).toBeInTheDocument();
    expect(retryButton).toBeEnabled();

    fireEvent.click(retryButton);
    await waitFor(() => expect(mocks.scanProject).toHaveBeenCalledTimes(2));
    expect(mocks.scanProject).toHaveBeenNthCalledWith(1, { projectId: 'imported-project' });
    expect(mocks.scanProject).toHaveBeenNthCalledWith(2, { projectId: 'imported-project' });
    expect(await screen.findByTestId('scan-project-success')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'أعد محاولة الفحص' })).not.toBeInTheDocument();
    expect(screen.getByTestId('button-open-imported-project')).toBeInTheDocument();
  });

  it('warns when discovery results are partial', async () => {
    mocks.report.completeness = 'PARTIAL';
    mocks.report.completenessReasons = ['file_open_failed'];
    render(<DiscoverProjectWizard onClose={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText('https://github.com/owner/repo'), {
      target: { value: 'https://github.com/example/sample-app' },
    });
    fireEvent.click(screen.getByTestId('start-discovery'));

    const warning = await screen.findByTestId('discovery-partial-warning');
    expect(warning).toHaveTextContent('نتائج الاستكشاف جزئية');
    expect(warning).toHaveTextContent('بعض ملفات المشروع أو مجلداته لم تدخل التحليل الكامل.');
  });
});
