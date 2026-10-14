import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DiscoverProjectWizard } from './DiscoverProjectWizard';

const mocks = vi.hoisted(() => ({
  startDiscovery: vi.fn(),
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
    data: id ? mocks.session : undefined,
  }),
  useGetDiscoverySummary: (id: string) => ({
    data: id ? mocks.report : undefined,
    error: null,
  }),
  useImportProject: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useListProjects: () => ({ data: [] }),
  useScanProject: () => ({ mutateAsync: vi.fn(), isPending: false, isError: false }),
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
    mocks.startDiscovery.mockResolvedValue(mocks.session);
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
});
