import React, { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useStartDiscovery,
  useUploadArchive,
  useGetDiscoverySession,
  useGetDiscoverySummary,
  useImportProject,
  useListProjects,
  useScanProject,
  getListProjectsQueryKey,
  getGetDiscoverySessionQueryKey,
  getGetDiscoverySummaryQueryKey,
} from '@workspace/api-client-react';
import type { ArchiveUploadOutput, Project } from '@workspace/api-client-react';
import { useLocation } from 'wouter';
import {
  discoveryRiskLabel,
  discoveryViolationSummary,
  relatedFilesCountLabel,
  supportDetailLabel,
} from '@/lib/discovery-copy';
import {
  X,
  FolderOpen,
  Loader2,
  CheckCircle2,
  Circle,
  AlertTriangle,
  ChevronLeft,
  Edit2,
  ShieldAlert,
  GitBranch,
  Package,
  Box,
  Terminal,
  Database,
  Cpu,
  TestTube2,
  Hammer,
  GitFork,
  Layers,
  Lock,
  FileCode2,
  Globe,
  Cloud,
} from 'lucide-react';

// ─── Types ─────────────────────────────────────────────────────────────────────

type SourceType =
  | 'LOCAL_FOLDER'
  | 'WORKSPACE_PROJECT'
  | 'GIT_REPOSITORY'
  | 'ARCHIVE_UPLOAD'
  | 'REMOTE_FILESYSTEM'
  | 'DOCKER_VOLUME';

interface DiscoveryStep {
  name: string;
  status: 'pending' | 'running' | 'done' | 'error';
  durationMs?: number;
}

interface DiscoverySession {
  id: string;
  status: 'pending' | 'discovering' | 'ready' | 'imported' | 'error';
  progress: number;
  currentStep: string | null;
  steps: DiscoveryStep[];
  startedAt: string;
  completedAt?: string | null;
  error?: string | null;
}

interface DiscoveryReport {
  id: string;
  detectedName: string;
  detectedLanguage: string;
  detectedLanguages: string[];
  detectedFramework: string | null;
  detectedRuntime: string | null;
  detectedPackageManager: string | null;
  detectedArchitecture: string | null;
  detectedDb: string | null;
  detectedOrm: string | null;
  detectedTestFramework: string | null;
  detectedBuildTool: string | null;
  detectedCi: string | null;
  isMonorepo: boolean;
  hasDocker: boolean;
  hasOpenApi: boolean;
  packageCount: number;
  moduleCount: number;
  repoSizeBytes: number;
  detectedApis: string[];
  detectedRisks: string[];
  qualityScore: number;
  confidenceScore: number;
  graphSummary: { entityCount: number; relationshipCount: number };
  supportMatrix?: {
    languages: Array<{
      id: string;
      label: string;
      kind: 'language' | 'framework';
      level: 'deep' | 'partial' | 'metadata-only';
      parser: string;
      graph: string;
      validation: string;
      changeReadiness: string;
      limitations: string[];
    }>;
    frameworks: Array<{
      id: string;
      label: string;
      kind: 'language' | 'framework';
      level: 'deep' | 'partial' | 'metadata-only';
      parser: string;
      graph: string;
      validation: string;
      changeReadiness: string;
      limitations: string[];
    }>;
  };
  sourceRevision?: string;
  sourceProvenance?: string;
  sourceCorrelationId?: string;
  ruleViolations: Array<{
    ruleId?: string;
    code: string;
    title: string;
    severity: string;
    count: number;
    matches?: Array<{ file: string; line: number; snippet: string; occurrences: number }>;
    fixDescription?: string | null;
    verifySteps?: string[];
    remediationPlan?: {
      status: 'needs_review' | 'ready' | 'verified';
      relatedFiles: string[];
    };
  }>;
}

interface Props {
  onClose: () => void;
}

const MAX_ARCHIVE_SIZE_BYTES = 50 * 1024 * 1024;
const ARCHIVE_FILE_ACCEPT = '.zip,.tar.gz,.tgz';

function getArchiveFileError(file: File | null): string | null {
  if (!file) return 'اختر ملفًا مضغوطًا للمتابعة.';

  const name = file.name.toLowerCase();
  if (!name.endsWith('.zip') && !name.endsWith('.tar.gz') && !name.endsWith('.tgz')) {
    return 'اختر ملفًا بصيغة .zip أو .tar.gz أو .tgz.';
  }
  if (file.size > MAX_ARCHIVE_SIZE_BYTES) {
    return 'يجب ألا يتجاوز حجم الملف 50 ميبيبايت.';
  }
  return null;
}

// ─── Source type definitions ────────────────────────────────────────────────────

interface SourceDef {
  type: SourceType;
  label: string;
  description: string;
  icon: React.ElementType;
  available: boolean;
  badge?: string;
  /** Human-readable explanation shown on disabled cards so the user knows *why* the option is unavailable. */
  disabledReason?: string;
}

const SOURCE_DEFS: SourceDef[] = [
  {
    type: 'GIT_REPOSITORY',
    label: 'مستودع Git',
    description: 'أضف مستودعًا بعيدًا لفحصه.',
    icon: GitBranch,
    available: true,
    badge: 'موصى به',
  },
  {
    type: 'LOCAL_FOLDER',
    label: 'مجلد على الخادم',
    description: 'افحص مجلدًا محفوظًا على هذا الخادم.',
    icon: FolderOpen,
    available: true,
  },
  {
    type: 'WORKSPACE_PROJECT',
    label: 'مشروع مسجّل',
    description: 'أعد فحص مشروع أضفته من قبل.',
    icon: Layers,
    available: true,
  },
  {
    type: 'ARCHIVE_UPLOAD',
    label: 'رفع ملف مشروع',
    description: 'ارفع ملفًا بصيغة .zip أو .tar.gz أو .tgz لفحصه.',
    icon: Package,
    available: true,
  },
  {
    type: 'REMOTE_FILESYSTEM',
    label: 'مجلد على خادم بعيد',
    description: 'افحص ملفات موجودة على خادم آخر.',
    icon: Cloud,
    available: false,
    badge: 'غير متاح',
    disabledReason: 'يتطلب اتصال SSH/SFTP بخادم آخر، وهذا غير متاح حاليًا.',
  },
  {
    type: 'DOCKER_VOLUME',
    label: 'وحدة تخزين Docker',
    description: 'افحص ملفات محفوظة داخل حاوية Docker.',
    icon: Box,
    available: false,
    badge: 'غير متاح',
    disabledReason: 'يتطلب تشغيل Docker محليًا، وهذا غير متاح حاليًا. يمكنك استخدام مستودع Git بدلًا من ذلك.',
  },
];

// ─── Helpers ───────────────────────────────────────────────────────────────────

function fmt(bytes: number): string {
  if (bytes < 1024) return `${bytes} بايت`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} كيلوبايت`;
  return `${(bytes / 1024 / 1024).toFixed(1)} ميغابايت`;
}

const DISCOVERY_STEP_LABELS: Record<string, string> = {
  'Finding repository': 'العثور على ملفات المشروع',
  'Reading configuration files': 'قراءة ملفات الإعداد',
  'Detecting languages': 'تحديد لغات البرمجة',
  'Detecting frameworks & runtime': 'تحديد أطر العمل وبيئة التشغيل',
  'Scanning source tree': 'فحص ملفات المشروع',
  'Building dependency graph': 'بناء خريطة الاعتماديات',
  'Calculating metrics': 'حساب المؤشرات',
  'Extracting architecture': 'استنتاج بنية المشروع',
  'Preparing summary': 'إعداد الملخص',
  Initialize: 'تهيئة الاستكشاف',
};

function discoveryStepLabel(name: string): string {
  return DISCOVERY_STEP_LABELS[name] ?? name;
}

function scoreColor(score: number): string {
  if (score >= 80) return 'text-emerald-400';
  if (score >= 60) return 'text-yellow-400';
  return 'text-red-400';
}

function severityBadge(sev: string): string {
  const map: Record<string, string> = {
    critical: 'bg-red-500/20 text-red-400 border-red-500/30',
    high: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
    medium: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    low: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    info: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
  };
  return map[sev] ?? map.info;
}

// ─── Git error parser ──────────────────────────────────────────────────────────

function parseGitError(raw: string | null | undefined): { message: string; suggestCredentials: boolean } {
  if (!raw) return { message: 'تعذر إكمال الفحص لسبب غير معروف.', suggestCredentials: false };
  const lower = raw.toLowerCase();
  if (
    lower.includes('authentication failed') ||
    lower.includes('could not read username') ||
    lower.includes('invalid username or password') ||
    lower.includes('403')
  ) {
    return {
      message: 'تعذر تسجيل الدخول إلى المستودع. ارجع وأضف بيانات الوصول المطلوبة.',
      suggestCredentials: true,
    };
  }
  if (lower.includes('not found') && (lower.includes('repository') || lower.includes('remote'))) {
    return {
      message: 'لم يُعثر على المستودع. تحقق من الرابط، وأضف بيانات الوصول إذا كان المستودع خاصًا.',
      suggestCredentials: true,
    };
  }
  if (lower.includes('could not resolve host') || lower.includes('unable to access') || lower.includes('timed out')) {
    return {
      message: 'تعذر الاتصال بموقع المستودع. تحقق من الرابط وحاول مرة أخرى.',
      suggestCredentials: false,
    };
  }
  // Strip the "Git clone failed: Command failed: git clone ..." prefix for readability
  const trimmed = raw.replace(/^Git clone failed:\s*Command failed:[^\n]*\n?/i, '').trim();
  return { message: trimmed || raw, suggestCredentials: false };
}

// ─── API error helpers ─────────────────────────────────────────────────────────

const REASON_HINTS: Record<string, string> = {
  invalid_source: 'بيانات المصدر غير صحيحة. تحقق من المسار أو الرابط.',
  unsupported_source: 'هذا النوع من المصادر غير متاح حاليًا. استخدم مستودع Git أو ملف مشروع.',
  no_project_root: 'لم يُعثر على مجلد مشروع معروف في هذا الموقع.',
  resolution_failed: 'لم يكتمل استكشاف المشروع. ابدأ المحاولة من جديد.',
  not_found: 'تعذر العثور على جلسة الاستكشاف.',
  permission_denied: 'ليس لديك صلاحية الوصول إلى جلسة الاستكشاف هذه.',
  import_failed: 'تعذرت إضافة المشروع. حاول مرة أخرى.',
  server_error: 'حدث خطأ غير متوقع. حاول مرة أخرى.',
};

function extractApiError(err: unknown, fallback: string): string {
  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>;
    const resp = e['response'] as Record<string, unknown> | undefined;
    const data = resp?.['data'] as Record<string, unknown> | undefined;
    const reason = typeof data?.['reason'] === 'string' ? (data['reason'] as string) : undefined;
    if (reason && REASON_HINTS[reason]) return REASON_HINTS[reason];
    if (typeof data?.['error'] === 'string') return data['error'] as string;
    if (typeof e['message'] === 'string' && e['message']) return e['message'] as string;
  }
  return fallback;
}

function extractArchiveUploadError(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>;
    const response = e['response'] as Record<string, unknown> | undefined;
    const data = response?.['data'] as Record<string, unknown> | undefined;
    const status =
      typeof response?.['status'] === 'number'
        ? response['status']
        : typeof e['status'] === 'number'
          ? e['status']
          : undefined;
    const code = typeof data?.['code'] === 'string' ? data['code'] : undefined;

    if (status === 413 || code === 'UPLOAD_TOO_LARGE') {
      return 'حجم الملف يتجاوز الحد الأقصى (50 ميبيبايت). اختر ملفًا أصغر وحاول مرة أخرى.';
    }
    if (status === 422) {
      return 'تعذر التحقق من الملف. تأكد أنه ملف .zip أو .tar.gz أو .tgz صالح ولا يحتوي على مسارات أو روابط غير آمنة.';
    }
    if (status === 400) {
      return 'صيغة الملف غير مدعومة. اختر ملف .zip أو .tar.gz أو .tgz وحاول مرة أخرى.';
    }
  }

  return extractApiError(
    err,
    'تعذر رفع الملف. تحقق من اتصالك وحاول مرة أخرى.',
  );
}

// ─── Step icon ─────────────────────────────────────────────────────────────────

function StepIcon({ status }: { status: DiscoveryStep['status'] }) {
  if (status === 'done') return <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />;
  if (status === 'running') return <Loader2 className="w-4 h-4 text-primary animate-spin shrink-0" />;
  if (status === 'error') return <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />;
  return <Circle className="w-4 h-4 text-muted-foreground/30 shrink-0" />;
}

// ─── Report row ────────────────────────────────────────────────────────────────

function ReportRow({
  icon: Icon,
  label,
  value,
  isOverride,
  editable,
  onEdit,
}: {
  icon: React.ElementType;
  label: string;
  value: string | null | undefined;
  isOverride?: boolean;
  editable?: boolean;
  onEdit?: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');

  const commit = () => { onEdit?.(draft); setEditing(false); };

  if (!value && !editing) {
    return (
      <div className="flex items-center gap-3 py-2.5 border-b border-border/30">
        <Icon className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0" />
        <span className="text-xs text-muted-foreground/50 w-36 shrink-0">{label}</span>
        <span className="text-xs text-muted-foreground/30 italic">لم يُكتشف</span>
        {editable && (
          <button
            aria-label={`إدخال ${label}`}
            title={`إدخال ${label}`}
            className="mr-auto text-xs text-muted-foreground/40 hover:text-primary flex items-center gap-1"
            onClick={() => setEditing(true)}
          >
            <Edit2 className="w-3 h-3" /> تعديل
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-border/30">
      <Icon className="w-3.5 h-3.5 text-primary/70 shrink-0" />
      <span className="text-xs text-muted-foreground/70 w-36 shrink-0">{label}</span>
      {editing ? (
        <div className="flex gap-2 flex-1">
          <input
            autoFocus
            className="flex-1 bg-secondary border border-primary/40 rounded px-2 py-0.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary"
            dir="auto"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
          />
          <button className="text-xs bg-primary text-primary-foreground px-2 py-0.5 rounded" onClick={commit}>حفظ</button>
        </div>
      ) : (
        <>
          <span dir="auto" className="text-sm font-medium font-mono truncate">{value}</span>
          {isOverride && (
            <span className="mr-2 text-[10px] bg-primary/20 text-primary border border-primary/30 px-1.5 py-0.5 rounded-full shrink-0">تعديل يدوي</span>
          )}
          {!isOverride && value && (
            <span className="mr-2 text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-1.5 py-0.5 rounded-full shrink-0">تم اكتشافه</span>
          )}
          {editable && (
            <button
              aria-label={`تعديل ${label}`}
              title={`تعديل ${label}`}
              className="mr-auto text-muted-foreground/40 hover:text-primary shrink-0"
              onClick={() => { setDraft(value ?? ''); setEditing(true); }}
            >
              <Edit2 className="w-3 h-3" />
            </button>
          )}
        </>
      )}
    </div>
  );
}

// ─── Main wizard ───────────────────────────────────────────────────────────────

export function DiscoverProjectWizard({ onClose }: Props) {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();

  // Wizard state
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [sourceType, setSourceType] = useState<SourceType>('GIT_REPOSITORY');
  // Per-source config fields
  const [localPath, setLocalPath] = useState('');
  const [gitUrl, setGitUrl] = useState('');
  const [gitBranch, setGitBranch] = useState('');
  const [gitUsername, setGitUsername] = useState('');
  const [gitToken, setGitToken] = useState('');
  const [useCredentials, setUseCredentials] = useState(false);
  const [archiveFile, setArchiveFile] = useState<File | null>(null);
  const [uploadedArchive, setUploadedArchive] = useState<ArchiveUploadOutput | null>(null);

  const [discoveryId, setDiscoveryId] = useState<string | null>(null);
  const [session, setSession] = useState<DiscoverySession | null>(null);
  const [report, setReport] = useState<DiscoveryReport | null>(null);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [importError, setImportError] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [workspaceProjectId, setWorkspaceProjectId] = useState<string>('');
  const [importedProjectId, setImportedProjectId] = useState<string | null>(null);
  const [scanTriggered, setScanTriggered] = useState(false);

  const startDiscovery = useStartDiscovery();
  const archiveUpload = useUploadArchive();
  const importProject = useImportProject();
  const scanProject = useScanProject();
  const { data: projectsListData } = useListProjects();

  // Polling via react-query (enabled only when discoveryId set and not done)
  const { data: sessionData } = useGetDiscoverySession(discoveryId ?? '', {
    query: {
      queryKey: getGetDiscoverySessionQueryKey(discoveryId ?? ''),
      enabled: !!discoveryId && step === 2,
      refetchInterval: (query) => {
        const s = query.state.data as DiscoverySession | undefined;
        if (!s) return 800;
        return s.status === 'pending' || s.status === 'discovering'
          ? 800
          : false;
      },
    },
  });

  const { data: summaryData, error: summaryError } = useGetDiscoverySummary(discoveryId ?? '', {
    query: {
      queryKey: getGetDiscoverySummaryQueryKey(discoveryId ?? ''),
      enabled: !!discoveryId && (session?.status === 'ready' || sessionData?.status === 'ready'),
    },
  });

  // Sync session data
  useEffect(() => {
    if (!sessionData) return;
    const s = sessionData as unknown as DiscoverySession;
    setSession(s);
    if (s.status === 'ready' || s.status === 'error') {
      if (s.status === 'ready') setStep(3);
    }
  }, [sessionData]);

  useEffect(() => {
    if (!summaryData) return;
    setReport(summaryData as unknown as DiscoveryReport);
  }, [summaryData]);

  // Computed display label for the progress step header
  const sourceLabel = (): string => {
    if (sourceType === 'GIT_REPOSITORY') return gitUrl || 'مستودع Git';
    if (sourceType === 'LOCAL_FOLDER') {
      const p = localPath.trim();
      return p ? (p.startsWith('/') ? p : `/${p}`) : 'مجلد على الخادم';
    }
    if (sourceType === 'WORKSPACE_PROJECT') {
      const projects = projectsListData as Project[] | undefined;
      const proj = projects?.find((p) => p.id === workspaceProjectId);
      return proj?.name ?? 'مشروع مسجّل';
    }
    if (sourceType === 'ARCHIVE_UPLOAD') {
      return uploadedArchive?.originalName ?? archiveFile?.name ?? 'رفع ملف مشروع';
    }
    return sourceType;
  };

  const handleStart = async (e: React.FormEvent) => {
    e.preventDefault();
    setStartError(null);

    // Build sourceConfig from current state
    let sourceConfig: Record<string, unknown> = {};
    if (sourceType === 'LOCAL_FOLDER') {
      const rawPath = localPath.trim();
      if (!rawPath) { setStartError('أدخل مسار مجلد المشروع.'); return; }
      sourceConfig = { path: rawPath.startsWith('/') ? rawPath : `/${rawPath}` };
    } else if (sourceType === 'GIT_REPOSITORY') {
      const url = gitUrl.trim();
      if (!url) { setStartError('أدخل رابط المستودع.'); return; }
      sourceConfig = { url };
      if (gitBranch.trim()) sourceConfig.branch = gitBranch.trim();
      if (useCredentials && gitToken.trim()) {
        sourceConfig.credentials = { username: gitUsername.trim() || 'oauth2', token: gitToken.trim() };
      }
    } else if (sourceType === 'WORKSPACE_PROJECT') {
      if (!workspaceProjectId) { setStartError('اختر مشروعًا أولًا.'); return; }
      sourceConfig = { projectId: workspaceProjectId };
    } else if (sourceType === 'ARCHIVE_UPLOAD') {
      const file = archiveFile;
      const fileError = getArchiveFileError(file);
      if (fileError || !file) {
        setStartError(fileError ?? 'اختر ملفًا مضغوطًا للمتابعة.');
        return;
      }

      let upload = uploadedArchive;
      if (!upload) {
        try {
          upload = await archiveUpload.mutateAsync({ data: { archive: file } });
          setUploadedArchive(upload);
        } catch (err: unknown) {
          setStartError(extractArchiveUploadError(err));
          return;
        }
      }
      sourceConfig = { uploadId: upload.uploadId };
    }

    try {
      const result = await startDiscovery.mutateAsync({
        data: { sourceType, sourceConfig } as Parameters<typeof startDiscovery.mutateAsync>[0]['data'],
      });
      const s = result as unknown as DiscoverySession;
      setDiscoveryId(s.id);
      setSession(s);
      setStep(2);
    } catch (err: unknown) {
      setStartError(extractApiError(err, 'تعذر بدء استكشاف المشروع. تحقق من البيانات وحاول مرة أخرى.'));
    }
  };

  const handleImport = async () => {
    if (!discoveryId || !report) return;
    setImportError(null);
    try {
      const project = await importProject.mutateAsync({
        data: { discoveryId, overrides: Object.keys(overrides).length > 0 ? overrides : undefined },
      });
      const pid = (project as unknown as { id: string }).id;
      setImportedProjectId(pid);
      setStep(4);
      queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
      setTimeout(() => {
        onClose();
        navigate(`/projects/${pid}`);
      }, 2200);
    } catch (err) {
      setImportError(extractApiError(err, 'تعذرت إضافة المشروع. حاول مرة أخرى.'));
    }
  };

  const setOverride = (key: string) => (value: string) =>
    setOverrides((prev) => ({ ...prev, [key]: value }));

  // ── Step 1 ──────────────────────────────────────────────────────────────────
  const renderStep1 = () => (
    <form onSubmit={handleStart} className="space-y-5">
      <div>
        <h2 className="text-xl font-bold tracking-tight mb-1">اكتشف مشروعًا</h2>
        <p className="text-sm text-muted-foreground">
          اختر طريقة إضافة مشروعك، وسيفحصه EngineeringOS تلقائيًا.
        </p>
      </div>

      {/* Source type cards */}
      <div className="grid grid-cols-2 gap-2.5">
        {SOURCE_DEFS.map((src) => {
          const Icon = src.icon;
          const selected = sourceType === src.type;
          return (
            <button
              key={src.type}
              data-testid={src.type === 'ARCHIVE_UPLOAD' ? 'source-card-ARCHIVE_UPLOAD' : undefined}
              type="button"
              disabled={!src.available}
              onClick={() => { if (src.available) setSourceType(src.type); }}
              className={`relative text-right rounded-xl border p-3.5 flex items-start gap-3 transition-all
                ${src.available ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}
                ${selected
                  ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                  : src.available
                    ? 'border-border hover:border-primary/40 bg-card'
                    : 'border-border/40 bg-card/50'
                }`}
            >
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${selected ? 'bg-primary/15' : 'bg-secondary'}`}>
                <Icon className={`w-4 h-4 ${selected ? 'text-primary' : 'text-muted-foreground'}`} />
              </div>
              <div className="min-w-0">
                <div className={`text-sm font-semibold ${selected ? 'text-foreground' : 'text-foreground/80'}`}>{src.label}</div>
                <div className="text-xs text-muted-foreground mt-0.5 leading-snug">{src.description}</div>
                {!src.available && src.disabledReason && (
                  <div className="text-[10px] text-amber-400/70 mt-1.5 leading-snug flex items-start gap-1">
                    <AlertTriangle className="w-2.5 h-2.5 shrink-0 mt-px" />
                    <span>{src.disabledReason}</span>
                  </div>
                )}
              </div>
              {src.badge && (
                <span className={`absolute top-2 left-2 text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${
                  src.badge === 'موصى به'
                    ? 'bg-primary/15 text-primary border-primary/30'
                    : 'bg-secondary text-muted-foreground/60 border-border/50'
                }`}>{src.badge}</span>
              )}
              {selected && (
                <div className="absolute top-2 right-2 w-4 h-4 rounded-full border-2 border-primary flex items-center justify-center">
                  <div className="w-2 h-2 rounded-full bg-primary" />
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Per-source config */}
      <div className="space-y-3">
        {sourceType === 'WORKSPACE_PROJECT' && (
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">اختر مشروعًا</label>
            {(() => {
              const projects = projectsListData as Project[] | undefined;
              if (!projects || projects.length === 0) {
                return (
                  <p className="text-xs text-muted-foreground/60 py-2">
                    لا توجد مشاريع مسجّلة. أضف مشروعًا من Git أو من ملف مضغوط أولًا.
                  </p>
                );
              }
              return (
                <div className="space-y-1.5">
                  {projects.map((proj) => (
                    <button
                      key={proj.id}
                      type="button"
                      onClick={() => setWorkspaceProjectId(proj.id)}
                      className={`w-full text-right rounded-lg border px-3.5 py-2.5 flex items-center gap-3 transition-all
                        ${workspaceProjectId === proj.id
                          ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                          : 'border-border hover:border-primary/40 bg-card'
                        }`}
                    >
                      <div className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 ${workspaceProjectId === proj.id ? 'bg-primary/15' : 'bg-secondary'}`}>
                        <Layers className={`w-3.5 h-3.5 ${workspaceProjectId === proj.id ? 'text-primary' : 'text-muted-foreground'}`} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate">{proj.name}</div>
                        <div className="text-xs text-muted-foreground/60 font-mono truncate">{proj.rootPath}</div>
                      </div>
                      {proj.language && (
                        <span className="text-[10px] bg-secondary text-muted-foreground/70 border border-border/50 px-1.5 py-0.5 rounded-full shrink-0">{proj.language}</span>
                      )}
                    </button>
                  ))}
                </div>
              );
            })()}
          </div>
        )}

        {sourceType === 'ARCHIVE_UPLOAD' && (
          <div className="space-y-2">
            <label
              htmlFor="discovery-archive-file"
              className="text-xs font-semibold text-muted-foreground uppercase tracking-wider"
            >
              ملف المشروع المضغوط
            </label>
            <input
              id="discovery-archive-file"
              data-testid="archive-file-input"
              name="archive"
              type="file"
              accept={ARCHIVE_FILE_ACCEPT}
              aria-required="true"
              aria-describedby="discovery-archive-help"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0] ?? null;
                setArchiveFile(file);
                setUploadedArchive(null);
                setStartError(getArchiveFileError(file));
              }}
              className="block w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground file:ml-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-primary-foreground hover:file:bg-primary/90 focus:outline-none focus:ring-1 focus:ring-primary/40"
            />
            <p id="discovery-archive-help" className="text-xs text-muted-foreground/70">
              الصيغ المدعومة: <code dir="ltr">.zip</code> و<code dir="ltr">.tar.gz</code> و<code dir="ltr">.tgz</code>.
              الحد الأقصى للحجم: 50 ميبيبايت.
            </p>
            {archiveFile && (
              <p data-testid="archive-file-selection" dir="rtl" className="text-xs text-muted-foreground">
                الملف المحدد: <span dir="auto" className="font-medium text-foreground">{archiveFile.name}</span>
                {' · '}{fmt(archiveFile.size)}
              </p>
            )}
            {uploadedArchive && (
              <p data-testid="archive-upload-success" role="status" className="text-xs text-emerald-400">
                تم رفع الملف. سيُعاد استخدامه إذا احتاج الفحص إلى محاولة أخرى.
              </p>
            )}
          </div>
        )}

        {sourceType === 'LOCAL_FOLDER' && (
          <>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">مسار مجلد المشروع</label>
              <div className="relative">
                <Terminal className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type="text"
                  dir="ltr"
                  required
                  autoFocus
                  value={localPath}
                  onChange={(e) => setLocalPath(e.target.value)}
                  placeholder="/path/to/your/project"
                  className="w-full bg-secondary border border-border rounded-lg pr-10 pl-4 py-2.5 text-sm font-mono focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30 transition-colors"
                />
              </div>
              {localPath.trim() && !localPath.trim().startsWith('/') && (
                <p className="text-xs text-amber-400/80 flex items-center gap-1.5">
                  <AlertTriangle className="w-3 h-3 shrink-0" />
                  سيُستخدم المسار <span dir="ltr" className="font-mono">/{localPath.trim()}</span>
                </p>
              )}
              <p className="text-xs text-muted-foreground/60">أدخل المسار الكامل لمجلد المشروع على الخادم.</p>
            </div>
          </>
        )}

        {sourceType === 'GIT_REPOSITORY' && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">رابط مستودع Git</label>
              <div className="relative">
                <Globe className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type="url"
                  dir="ltr"
                  required
                  autoFocus
                  value={gitUrl}
                  onChange={(e) => setGitUrl(e.target.value)}
                  placeholder="https://github.com/owner/repo"
                  className="w-full bg-secondary border border-border rounded-lg pr-10 pl-4 py-2.5 text-sm font-mono focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30 transition-colors"
                />
              </div>
              {(() => {
                const u = gitUrl.trim();
                const isSsh = u.startsWith('ssh://') || u.startsWith('git@');
                return isSsh ? (
                  <p dir="rtl" className="text-xs text-amber-400/80 flex items-center gap-1.5">
                    <AlertTriangle className="w-3 h-3 shrink-0" />
                    روابط SSH غير مدعومة. استخدم رابط <span dir="ltr" className="font-mono">https://</span> بدلًا منها.
                  </p>
                ) : null;
              })()}
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">الفرع <span className="normal-case font-normal text-muted-foreground/60">(اختياري، الافتراضي HEAD)</span></label>
              <input
                type="text"
                dir="ltr"
                value={gitBranch}
                onChange={(e) => setGitBranch(e.target.value)}
                placeholder="main"
                className="w-full bg-secondary border border-border rounded-lg px-4 py-2.5 text-sm font-mono focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30 transition-colors"
              />
            </div>
            <div>
              <button
                type="button"
                onClick={() => setUseCredentials((v) => !v)}
                className="text-xs text-muted-foreground/60 hover:text-primary flex items-center gap-1.5 transition-colors"
              >
                <Lock className="w-3 h-3" />
                {useCredentials ? 'إخفاء بيانات الدخول' : 'هل المستودع خاص؟ أضف بيانات الدخول'}
              </button>
            </div>
            {useCredentials && (
              <div className="space-y-2 bg-secondary/50 rounded-lg p-3 border border-border/50">
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">اسم المستخدم</label>
                  <input
                    type="text"
                    dir="ltr"
                    value={gitUsername}
                    onChange={(e) => setGitUsername(e.target.value)}
                    placeholder="your-github-username"
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm font-mono focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">رمز الوصول الشخصي</label>
                  <input
                    type="password"
                    dir="ltr"
                    value={gitToken}
                    onChange={(e) => setGitToken(e.target.value)}
                    placeholder="ghp_..."
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm font-mono focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30"
                  />
                </div>
                <p className="text-[11px] text-muted-foreground/60 pt-0.5">
                  GitHub:{' '}
                  <a
                    href="https://github.com/settings/tokens/new?scopes=repo&description=EngineeringOS"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary/70 hover:text-primary underline underline-offset-2"
                  >
                    أنشئ رمز وصول شخصيًا
                  </a>
                  {' '}بصلاحية <code dir="ltr" className="font-mono bg-secondary px-1 rounded">repo</code>.
                  لمستودعات GitLab وBitbucket، استخدم رمزًا بصلاحية القراءة.
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {startError && (
        <div
          role="alert"
          data-testid="discovery-start-error"
          dir="auto"
          className="flex items-start gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3"
        >
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{startError}</span>
        </div>
      )}

      <div className="flex justify-end gap-3 pt-2">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 text-sm rounded-lg border border-border hover:border-primary/40 text-muted-foreground hover:text-foreground transition-colors"
        >
          إلغاء
        </button>
        <button
          type="submit"
          data-testid="start-discovery"
          disabled={startDiscovery.isPending || archiveUpload.isPending}
          className="px-5 py-2 bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-semibold rounded-lg flex items-center gap-2 disabled:opacity-50 transition-colors"
        >
          {startDiscovery.isPending || archiveUpload.isPending
            ? <Loader2 className="w-4 h-4 animate-spin" />
            : <ChevronLeft className="w-4 h-4" />}
          {archiveUpload.isPending
            ? 'جارٍ رفع الملف…'
            : startDiscovery.isPending
              ? 'جارٍ بدء الاستكشاف…'
              : 'ابدأ استكشاف المشروع'}
        </button>
      </div>
    </form>
  );

  // ── Step 2 ──────────────────────────────────────────────────────────────────
  const renderStep2 = () => {
    const steps = session?.steps ?? [];
    const progress = session?.progress ?? 0;
    const isError = session?.status === 'error';

    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-bold tracking-tight mb-1">جارٍ تحليل المشروع…</h2>
          <p dir="auto" className="text-sm text-muted-foreground font-mono truncate">{sourceLabel()}</p>
        </div>

        {/* Progress bar */}
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{isError ? 'فشل الاستكشاف' : progress < 100 ? 'جارٍ الاستكشاف…' : 'اكتمل'}</span>
            <span className="font-mono">{progress}%</span>
          </div>
          <div className="w-full h-1.5 bg-secondary rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${isError ? 'bg-red-500' : 'bg-primary'}`}
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* Steps */}
        <div className="space-y-2">
          {steps.map((s, i) => (
            <div
              key={i}
              className={`flex items-center gap-3 py-1.5 px-3 rounded-lg transition-colors ${s.status === 'running' ? 'bg-primary/5' : ''}`}
            >
              <StepIcon status={s.status} />
              <span className={`text-sm flex-1 ${s.status === 'done' ? 'text-foreground/60' : s.status === 'running' ? 'text-foreground font-medium' : 'text-muted-foreground/40'}`}>
                {discoveryStepLabel(s.name)}
              </span>
              {s.durationMs !== undefined && s.status === 'done' && (
                <span className="text-xs font-mono text-muted-foreground/40">{s.durationMs}ms</span>
              )}
            </div>
          ))}
        </div>

        {isError && (() => {
          const { message, suggestCredentials } = parseGitError(session?.error);
          return (
            <>
              <div className="flex items-start gap-3 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <div className="space-y-1.5">
                  <div className="font-medium">فشل استكشاف المشروع</div>
                  <div dir="auto" className="text-xs opacity-80 leading-snug">{message}</div>
                  {suggestCredentials && (
                    <button
                      onClick={() => {
                        setStep(1);
                        setDiscoveryId(null);
                        setSession(null);
                        setUseCredentials(true);
                      }}
                      className="text-xs text-primary/80 hover:text-primary underline underline-offset-2 mt-1"
                    >
                      ارجع وأضف بيانات الدخول
                    </button>
                  )}
                </div>
              </div>
              <div className="flex justify-between pt-2">
                <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-border hover:border-primary/40 text-muted-foreground hover:text-foreground transition-colors">
                  إغلاق
                </button>
                <button
                  onClick={() => { setStep(1); setDiscoveryId(null); setSession(null); }}
                  className="px-4 py-2 bg-primary text-primary-foreground text-sm rounded-lg"
                >
                  حاول مرة أخرى
                </button>
              </div>
            </>
          );
        })()}
      </div>
    );
  };

  // ── Step 3 ──────────────────────────────────────────────────────────────────
  const renderStep3 = () => {
    if (!report) {
      if (summaryError) {
        return (
          <div className="space-y-4 py-4">
            <div className="flex items-start gap-3 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <div className="font-medium mb-0.5">تعذر تحميل نتائج الاستكشاف</div>
                <div dir="auto" className="text-xs opacity-80">{extractApiError(summaryError, 'تعذر تحميل نتائج التحليل.')}</div>
              </div>
            </div>
            <div className="flex justify-between pt-2">
              <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-border hover:border-primary/40 text-muted-foreground hover:text-foreground transition-colors">
                إغلاق
              </button>
              <button
                onClick={() => { setStep(1); setDiscoveryId(null); setSession(null); setReport(null); }}
                className="px-4 py-2 bg-primary text-primary-foreground text-sm rounded-lg"
              >
                حاول مرة أخرى
              </button>
            </div>
          </div>
        );
      }
      return (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
      );
    }

    const name = overrides['name'] ?? report.detectedName;
    const language = overrides['language'] ?? report.detectedLanguage;
    const framework = overrides['framework'] ?? report.detectedFramework;

    return (
      <div className="space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold tracking-tight mb-0.5">نتائج استكشاف المشروع</h2>
            <p className="text-sm text-muted-foreground">حلّل EngineeringOS مشروعك. راجع التفاصيل قبل إضافته.</p>
          </div>
          <div className="text-right shrink-0">
            <div className={`text-2xl font-bold font-mono ${scoreColor(report.qualityScore)}`}>
              {report.qualityScore}<span className="text-sm text-muted-foreground font-sans font-normal">/100</span>
            </div>
            <div className="text-xs text-muted-foreground">مؤشر جودة المشروع</div>
          </div>
        </div>

        {/* Confidence bar */}
        <div className="bg-card border border-border/50 rounded-xl px-4 py-3 flex items-center gap-4">
          <div className="flex-1">
            <div className="flex justify-between text-xs mb-1">
              <span className="text-muted-foreground">موثوقية الاكتشاف</span>
              <span className="font-mono font-semibold text-emerald-400">{report.confidenceScore}%</span>
            </div>
            <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
              <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${report.confidenceScore}%` }} />
            </div>
          </div>
          <div className="text-xs text-muted-foreground text-right shrink-0">
            <div className="font-mono">{report.moduleCount} وحدات</div>
            <div className="font-mono">{fmt(report.repoSizeBytes)}</div>
          </div>
        </div>

        {/* Identity */}
        <div className="bg-card border border-border/50 rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border/50 bg-secondary/30">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">معلومات المشروع</span>
          </div>
          <div className="px-4 py-1">
            <ReportRow icon={FileCode2} label="اسم المشروع" value={name} isOverride={!!overrides['name']} editable onEdit={setOverride('name')} />
            <ReportRow icon={Terminal} label="لغة البرمجة الأساسية" value={language} isOverride={!!overrides['language']} editable onEdit={setOverride('language')} />
            <ReportRow icon={Layers} label="إطار العمل" value={framework} isOverride={!!overrides['framework']} editable onEdit={setOverride('framework')} />
            <ReportRow icon={Cpu} label="بيئة التشغيل" value={report.detectedRuntime} />
            <ReportRow icon={Package} label="أداة إدارة الحزم" value={report.detectedPackageManager} />
            <ReportRow icon={GitBranch} label="بنية المشروع" value={report.detectedArchitecture} />
          </div>
        </div>

        {/* Infrastructure */}
        <div className="bg-card border border-border/50 rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border/50 bg-secondary/30">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">التقنيات المستخدمة</span>
          </div>
          <div className="px-4 py-1">
            <ReportRow icon={Database} label="قاعدة البيانات" value={report.detectedDb} />
            <ReportRow icon={Box} label="أداة ربط قاعدة البيانات (ORM)" value={report.detectedOrm} />
            <ReportRow icon={TestTube2} label="أداة الاختبار" value={report.detectedTestFramework} />
            <ReportRow icon={Hammer} label="أداة البناء" value={report.detectedBuildTool} />
            <ReportRow icon={GitFork} label="التكامل والنشر المستمران (CI/CD)" value={report.detectedCi} />
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: 'واجهات API', value: report.detectedApis.length },
            { label: 'الوحدات', value: report.moduleCount },
            { label: 'الحزم', value: report.packageCount },
            { label: 'عناصر خريطة المشروع', value: report.graphSummary.entityCount },
          ].map(({ label, value }) => (
            <div key={label} className="bg-card border border-border/50 rounded-xl px-3 py-3 text-center">
              <div className="text-lg font-bold font-mono">{value}</div>
              <div className="text-xs text-muted-foreground">{label}</div>
            </div>
          ))}
        </div>

        {report.supportMatrix && (
          <div className="bg-card border border-border/50 rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 border-b border-border/50 bg-secondary/30">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                مستوى الدعم
              </span>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  هذه مؤشرات منفصلة: اكتشاف اللغة لا يعني توافر التحليل البنيوي أو خريطة العلاقات أو التحقق أو جاهزية التغيير.
                </p>
            </div>
            <div className="p-4 space-y-3">
              {[...report.supportMatrix.languages, ...report.supportMatrix.frameworks].map((target) => {
                const badgeClass =
                  target.level === 'deep'
                    ? 'border-emerald-500/30 text-emerald-400 bg-emerald-500/5'
                    : target.level === 'partial'
                      ? 'border-amber-500/30 text-amber-300 bg-amber-500/5'
                      : 'border-border text-muted-foreground bg-secondary/30';
                return (
                  <div key={`${target.kind}-${target.id}`} className="rounded-lg border border-border/50 bg-secondary/20 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span dir="auto" className="font-medium">{target.label}</span>
                        <span className="text-[10px] text-muted-foreground">{target.kind === 'language' ? 'لغة' : 'إطار عمل'}</span>
                      </div>
                      <span className={`rounded border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${badgeClass}`}>
                        {target.level === 'deep' ? 'تحليل متقدم' : target.level === 'partial' ? 'دعم جزئي' : 'بيانات وصفية فقط'}
                      </span>
                    </div>
                    <div className="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                      <span><strong className="text-foreground/80">تحليل الملفات:</strong> <bdi>{supportDetailLabel(target.parser)}</bdi></span>
                      <span><strong className="text-foreground/80">خريطة العلاقات:</strong> <bdi>{supportDetailLabel(target.graph)}</bdi></span>
                      <span><strong className="text-foreground/80">التحقق:</strong> <bdi>{supportDetailLabel(target.validation)}</bdi></span>
                      <span><strong className="text-foreground/80">جاهزية التغيير:</strong> <bdi>{supportDetailLabel(target.changeReadiness)}</bdi></span>
                    </div>
                    {target.limitations.length > 0 && (
                      <ul className="mt-2 list-inside list-disc space-y-1 text-xs text-muted-foreground">
                        {target.limitations.map((limitation, index) => (
                          <li key={`${target.id}-limitation-${index}`} dir="auto">
                            {supportDetailLabel(limitation)}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Flags */}
        <div className="flex flex-wrap gap-2">
          {report.isMonorepo && (
            <span className="text-xs bg-blue-500/10 text-blue-400 border border-blue-500/20 px-2.5 py-1 rounded-full flex items-center gap-1.5">
              <GitBranch className="w-3 h-3" /> مشروع متعدد الحزم
            </span>
          )}
          {report.hasDocker && (
            <span className="text-xs bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 px-2.5 py-1 rounded-full flex items-center gap-1.5">
              <Box className="w-3 h-3" /> يستخدم Docker
            </span>
          )}
          {report.hasOpenApi && (
            <span className="text-xs bg-purple-500/10 text-purple-400 border border-purple-500/20 px-2.5 py-1 rounded-full flex items-center gap-1.5">
              <FileCode2 className="w-3 h-3" /> واجهات OpenAPI
            </span>
          )}
          {report.detectedLanguages.slice(0, 4).map((l) => (
            <span key={l} className="text-xs bg-secondary text-muted-foreground border border-border/50 px-2.5 py-1 rounded-full">{l}</span>
          ))}
        </div>

        {/* Risks */}
        {report.detectedRisks.length > 0 && (
          <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-xl px-4 py-3 space-y-1.5">
            <div className="flex items-center gap-2 mb-2">
              <ShieldAlert className="w-4 h-4 text-yellow-400" />
              <span className="text-xs font-semibold text-yellow-400 uppercase tracking-wider">
                {report.detectedRisks.length} مخاطر مكتشفة
              </span>
            </div>
            {report.detectedRisks.map((r, i) => (
                <div key={i} dir="auto" className="text-xs text-yellow-300/80 flex items-start gap-2">
                <span className="text-yellow-500 mt-0.5">▸</span>{discoveryRiskLabel(r)}
              </div>
            ))}
          </div>
        )}

        {/* Rule violations */}
        {report.ruleViolations.length > 0 && (
          <div className="bg-card border border-border/50 rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 border-b border-border/50 bg-secondary/30">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                مقترحات المعالجة ({report.ruleViolations.length})
              </span>
            </div>
            <div className="divide-y divide-border/30">
              {report.ruleViolations.slice(0, 5).map((v, i) => (
                <React.Fragment key={i}>
                <div className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`text-[10px] border px-1.5 py-0.5 rounded ${severityBadge(v.severity)}`}>
                      {discoveryViolationSummary(v.severity, v.count)}
                    </span>
                    <span className="text-xs font-mono text-muted-foreground" dir="ltr">{v.code}</span>
                    <span className="mr-auto text-[11px] text-muted-foreground">
                      {v.remediationPlan?.status === 'ready'
                        ? 'جاهز للتنفيذ'
                        : v.remediationPlan?.status === 'verified'
                          ? 'تم التحقق'
                          : 'يحتاج إلى مراجعة'}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                    {v.remediationPlan?.relatedFiles?.length ? (
                      <span>{relatedFilesCountLabel(v.remediationPlan.relatedFiles.length)}</span>
                    ) : null}
                    {v.fixDescription ? <span>إرشادات الإصلاح متاحة</span> : <span>لا توجد إرشادات للإصلاح</span>}
                    {v.verifySteps?.length ? <span>{v.verifySteps.length} خطوات تحقق</span> : null}
                  </div>
                  <details className="mt-2 rounded-md border border-border/40 bg-secondary/20 px-3 py-2 text-xs">
                    <summary className="cursor-pointer font-medium text-primary">
                      عرض العنوان والأدلة والتفاصيل الفنية الأصلية
                    </summary>
                    <div className="mt-3 space-y-2 text-muted-foreground">
                      <div>
                        <span className="font-semibold text-foreground/80">العنوان الأصلي: </span>
                        <span dir="auto">{v.title}</span>
                      </div>
                      {v.ruleId && (
                        <div>
                          <span className="font-semibold text-foreground/80">معرّف القاعدة: </span>
                          <bdi dir="ltr" className="font-mono">{v.ruleId}</bdi>
                        </div>
                      )}
                      {v.fixDescription && (
                        <div>
                          <span className="font-semibold text-foreground/80">وصف الإصلاح الأصلي: </span>
                          <span dir="auto">{v.fixDescription}</span>
                        </div>
                      )}
                      {v.remediationPlan?.relatedFiles?.length ? (
                        <div>
                          <span className="font-semibold text-foreground/80">الملفات المرتبطة: </span>
                          <ul className="mt-1 list-inside list-disc space-y-1">
                            {v.remediationPlan.relatedFiles.map((file, fileIndex) => (
                              <li key={`${file}-${fileIndex}`} dir="ltr" className="font-mono text-left break-all">{file}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      {v.matches?.length ? (
                        <div>
                          <span className="font-semibold text-foreground/80">المواضع والمقتطفات الأصلية:</span>
                          <ul className="mt-1 space-y-1">
                            {v.matches.map((match, matchIndex) => (
                              <li key={`${match.file}:${match.line}:${matchIndex}`} dir="ltr" className="font-mono text-left break-all">
                                {match.file}:{match.line} — {match.snippet} ({match.occurrences})
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      {v.verifySteps?.length ? (
                        <div>
                          <span className="font-semibold text-foreground/80">خطوات التحقق الأصلية:</span>
                          <ol className="mt-1 list-inside list-decimal space-y-1">
                            {v.verifySteps.map((step, stepIndex) => (
                              <li key={`${stepIndex}-${step}`} dir="auto">{step}</li>
                            ))}
                          </ol>
                        </div>
                      ) : null}
                    </div>
                  </details>
                </div>
                </React.Fragment>
              ))}
              {report.ruleViolations.length > 5 && (
                <div className="px-4 py-2 text-xs text-muted-foreground/50">و{report.ruleViolations.length - 5} مخالفات أخرى…</div>
              )}
            </div>
          </div>
        )}

        {importError && (
          <div dir="auto" className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3">
            <AlertTriangle className="w-4 h-4 shrink-0" />{importError}
          </div>
        )}

        <div className="flex justify-between gap-3 pt-2">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-border hover:border-primary/40 text-muted-foreground hover:text-foreground transition-colors">
            إلغاء
          </button>
          <button
            onClick={handleImport}
            disabled={importProject.isPending}
            className="px-6 py-2 bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-semibold rounded-lg flex items-center gap-2 disabled:opacity-50 transition-colors"
          >
            {importProject.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
            تأكيد وإضافة المشروع
          </button>
        </div>
      </div>
    );
  };

  // ── Step 4 ──────────────────────────────────────────────────────────────────
  const renderStep4 = () => (
    <div className="space-y-6 py-4">
      <div className="text-center">
        <div className="w-14 h-14 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center mx-auto mb-4">
          <CheckCircle2 className="w-7 h-7 text-emerald-400" />
        </div>
        <h2 className="text-xl font-bold tracking-tight mb-1">تمت إضافة المشروع</h2>
        <p className="text-sm text-muted-foreground">
          <span dir="auto" className="font-semibold text-foreground">{overrides['name'] ?? report?.detectedName}</span>{' '}
          أصبح الآن تحت المتابعة التلقائية.
        </p>
      </div>

      <div className="bg-card border border-emerald-500/20 rounded-xl divide-y divide-border/30">
        {[
          'تم إنشاء سجل المشروع',
          'تم إعداد القواعد الافتراضية',
          'تم حساب المؤشرات الأولية',
          `تم إنشاء خريطة المعرفة (${report?.graphSummary.entityCount ?? 0} عنصر)`,
          `تم إنشاء ${report?.ruleViolations.length ?? 0} مهمة بناءً على المخالفات`,
          'تم تسجيل العملية في سجل المراجعة',
        ].map((item, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-2.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span className="text-sm">{item}</span>
          </div>
        ))}
      </div>

      {importedProjectId && !scanTriggered && (
        <div className="flex justify-center">
          <button
            onClick={async () => {
              setScanTriggered(true);
              await scanProject.mutateAsync({ projectId: importedProjectId });
            }}
            disabled={scanProject.isPending}
            className="px-5 py-2 bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-semibold rounded-lg flex items-center gap-2 disabled:opacity-60 transition-colors"
          >
            {scanProject.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <GitBranch className="w-4 h-4" />}
            ابدأ الفحص
          </button>
        </div>
      )}
      {scanTriggered && !scanProject.isPending && !scanProject.isError && (
        <p className="text-center text-xs text-emerald-400 flex items-center justify-center gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5" /> بدأ الفحص، وستظهر نتائجه في لوحة المشروع.
        </p>
      )}
      {scanProject.isError && (
        <p dir="auto" className="text-center text-xs text-red-400 flex items-center justify-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5" /> {extractApiError(scanProject.error, 'تعذر بدء الفحص.')}
        </p>
      )}
      <p className="text-center text-xs text-muted-foreground">جارٍ الانتقال إلى لوحة المشروع…</p>
    </div>
  );

  // ── Step indicators ─────────────────────────────────────────────────────────
  const stepLabels = ['المصدر', 'الاستكشاف', 'النتائج', 'إضافة المشروع'];

  return (
    <div
      dir="rtl"
      lang="ar"
      data-testid="discovery-wizard"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={step === 1 ? onClose : undefined} />

      {/* Panel */}
      <div className="relative bg-background border border-border/60 rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 shrink-0">
          <div className="flex items-center gap-2">
            {stepLabels.map((label, i) => {
              const s = (i + 1) as 1 | 2 | 3 | 4;
              const active = s === step;
              const done = s < step;
              return (
                <React.Fragment key={i}>
                  <div className={`flex items-center gap-1.5 text-xs font-medium transition-colors ${active ? 'text-foreground' : done ? 'text-muted-foreground/60' : 'text-muted-foreground/30'}`}>
                    <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold border transition-colors ${active ? 'bg-primary text-primary-foreground border-primary' : done ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40' : 'bg-secondary/50 text-muted-foreground/30 border-border/30'}`}>
                      {done ? '✓' : i + 1}
                    </div>
                    <span className="hidden sm:block">{label}</span>
                  </div>
                  {i < stepLabels.length - 1 && <ChevronLeft className="w-3 h-3 text-muted-foreground/20 shrink-0" />}
                </React.Fragment>
              );
            })}
          </div>
          {step <= 2 && (
            <button
              type="button"
              aria-label="إغلاق معالج اكتشاف المشروع"
              title="إغلاق معالج اكتشاف المشروع"
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground transition-colors mr-4 shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-5">
          {step === 1 && renderStep1()}
          {step === 2 && renderStep2()}
          {step === 3 && renderStep3()}
          {step === 4 && renderStep4()}
        </div>
      </div>
    </div>
  );
}
