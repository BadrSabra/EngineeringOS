import type { ReactNode } from 'react';
import { Link, useRoute } from 'wouter';
import { Activity, AlertTriangle, ArrowRight, Check, Clock3, Code2, GitBranch, Layers3, RefreshCw, ShieldCheck, Sparkles, Terminal } from 'lucide-react';
import { useGetProjectWorkspaceSnapshot, getGetProjectWorkspaceSnapshotQueryKey } from '@workspace/api-client-react';
import AiChat from '@/pages/AiChat';

const statusLabels: Record<string, string> = {
  active: 'نشط',
  scanning: 'قيد الفحص',
  paused: 'متوقف مؤقتًا',
  archived: 'مؤرشف',
  queued: 'في قائمة الانتظار',
  verifying: 'قيد التحقق',
  running: 'قيد التنفيذ',
  cancelling: 'جارٍ الإيقاف',
  completed: 'مكتمل',
  failed: 'تعثر',
  cancelled: 'أُلغي',
  pending: 'بانتظار المراجعة',
  applied: 'طُبّق',
  rejected: 'مرفوض',
  stopped: 'متوقف',
  starting: 'يبدأ الآن',
  unknown: 'غير معروف',
  verified: 'تم التحقق',
  incomplete: 'غير مكتمل',
  proposed: 'مقترح',
  isolated: 'معزول',
  validated: 'اجتاز التحقق',
  conflicted: 'متعارض',
  committed: 'أُنشئ له التزام',
  abandoned: 'متروك',
  blocked: 'محظور',
};

const warningLabels: Record<string, string> = {
  'tasks source unavailable': 'تعذر قراءة مصدر المهام.',
  'executions source unavailable': 'تعذر قراءة مصدر التنفيذ.',
  'candidate source unavailable': 'تعذر قراءة مصدر المرشح.',
  'runtime source unavailable': 'تعذر قراءة مصدر التشغيل.',
};

function label(value: string | null | undefined) {
  if (!value) return 'غير متاح';
  return statusLabels[value] ?? value.replaceAll('_', ' ');
}

function dateLabel(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : new Intl.DateTimeFormat('ar', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function Identifier({ children }: { children: string | number | null | undefined }) {
  if (children === null || children === undefined || children === '') return <span>—</span>;
  return <bdi dir="ltr" className="workspace-identifier">{children}</bdi>;
}

function WorkspaceSkeleton() {
  return (
    <div className="space-y-5" role="status" aria-label="جارٍ تحميل مساحة المشروع">
      <div className="workspace-skeleton h-36 rounded-2xl" />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(320px,.8fr)]">
        <div className="workspace-skeleton h-[560px] rounded-2xl" />
        <div className="space-y-4">
          <div className="workspace-skeleton h-48 rounded-2xl" />
          <div className="workspace-skeleton h-48 rounded-2xl" />
          <div className="workspace-skeleton h-36 rounded-2xl" />
        </div>
      </div>
    </div>
  );
}

function SourceNote({ available, children }: { available: boolean; children: ReactNode }) {
  return available ? null : (
    <p className="mt-3 rounded-lg border border-amber-300/20 bg-amber-200/[.06] px-3 py-2 text-xs leading-6 text-amber-100/80" role="status">
      {children}
    </p>
  );
}

export default function ProjectWorkspace() {
  const [, params] = useRoute('/projects/:projectId/workspace');
  const projectId = params?.projectId ?? '';
  const snapshotQuery = useGetProjectWorkspaceSnapshot(projectId, {
    query: {
      enabled: !!projectId,
      queryKey: getGetProjectWorkspaceSnapshotQueryKey(projectId),
    },
  });
  const { data: snapshot, isLoading, isError, refetch, isFetching } = snapshotQuery;

  if (isLoading) return <WorkspaceSkeleton />;
  if (isError || !snapshot) {
    return (
      <section dir="rtl" className="workspace-error" role="alert">
        <div className="workspace-error-mark"><AlertTriangle className="h-5 w-5" /></div>
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-slate-100">تعذر فتح مساحة المشروع</h1>
          <p className="mt-1 text-sm leading-6 text-slate-400">
            لم تصلنا قراءة موثوقة لحالة المشروع. أعد المحاولة؛ لا يعني ذلك عدم وجود عمل.
          </p>
          <button type="button" onClick={() => void refetch()} className="workspace-retry mt-5">
            <RefreshCw className="h-4 w-4" /> إعادة المحاولة
          </button>
        </div>
      </section>
    );
  }

  const { project, work, runtime, freshness } = snapshot;
  const candidate = work.candidate;
  const execution = work.latestExecution;

  return (
    <div dir="rtl" lang="ar" className="project-workspace" data-testid="project-workspace">
      <header className="workspace-project-heading">
        <div className="workspace-heading-top">
          <div className="flex min-w-0 items-center gap-2 text-xs text-slate-400">
            <Link href="/projects" className="workspace-back" aria-label="العودة إلى المشاريع"><ArrowRight className="h-4 w-4" /></Link>
            <span>المشاريع</span><span aria-hidden="true" className="text-slate-600">/</span>
            <span className="truncate text-slate-300">{project.name}</span>
          </div>
          <button type="button" className="workspace-refresh" onClick={() => void refetch()} disabled={isFetching}>
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
            <span>{isFetching ? 'جارٍ التحديث' : 'تحديث الحالة'}</span>
          </button>
        </div>
        <div className="mt-5 flex flex-col justify-between gap-5 md:flex-row md:items-end">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="workspace-eyebrow"><span className="workspace-live-dot" /> مساحة المشروع</span>
              {freshness.partial && <span className="workspace-partial">قراءة جزئية</span>}
            </div>
            <h1 className="truncate text-2xl font-semibold tracking-tight text-slate-50 sm:text-3xl">{project.name}</h1>
            <p dir="auto" className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
              {project.description || 'تحدث مع المساعد عن العمل المطلوب، وتابع الحالة المسجلة هنا.'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="workspace-meta"><Code2 className="h-3.5 w-3.5" /><Identifier>{project.language}</Identifier></span>
            {project.framework && <span className="workspace-meta"><Layers3 className="h-3.5 w-3.5" /><Identifier>{project.framework}</Identifier></span>}
            <span className="workspace-meta"><Activity className="h-3.5 w-3.5" />{label(project.status)}</span>
          </div>
        </div>
        {freshness.partial && (
          <div className="workspace-warning mt-5" role="status">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-medium">بعض المعلومات غير مكتملة</p>
              <p className="mt-0.5 text-xs leading-5 opacity-80">الحالة أدناه تعكس المصادر التي أمكن قراءتها فقط، ولا يستنتج غياب العمل من مصدر غير متاح.</p>
              {freshness.warnings.length > 0 && (
                <ul className="mt-1 list-inside list-disc text-xs leading-5 opacity-70">
                  {freshness.warnings.map((warning, index) => <li key={`${index}-${warning}`}>{warningLabels[warning] ?? 'تعذر تحديث أحد المصادر.'}</li>)}
                </ul>
              )}
            </div>
          </div>
        )}
      </header>

      <div className="workspace-columns">
        <section className="workspace-chat-panel" aria-label="المحادثة مع مساعد المشروع">
          <div className="workspace-panel-heading">
            <span className="workspace-section-icon"><Sparkles className="h-4 w-4" /></span>
            <div>
              <h2>مساحة الحوار</h2>
              <p>صف ما تريد بعباراتك، ولا يُرسل شيء حتى تختار الإرسال.</p>
            </div>
          </div>
          <div className="workspace-chat-body" dir="ltr">
            <AiChat key={project.id} workspaceProjectId={project.id} workspaceMode />
          </div>
        </section>

        <aside className="workspace-trust-column" aria-label="ملخص العمل وحالة التشغيل">
          <section className="workspace-card">
            <div className="workspace-card-heading">
              <div className="workspace-card-icon work"><Activity className="h-4 w-4" /></div>
              <div className="min-w-0 flex-1">
                <h2>العمل الأخير</h2>
                <p>ملخص قراءة من المهام والتنفيذ</p>
              </div>
              <span className="workspace-readonly">للاطلاع</span>
            </div>
            <SourceNote available={work.tasksSource === 'available'}>مصدر المهام غير متاح الآن؛ لا يمكن تأكيد قائمة العمل.</SourceNote>
            {work.tasksSource === 'available' && work.recentTasks.length === 0 ? (
              <div className="workspace-empty">
                <div className="workspace-empty-mark"><Check className="h-4 w-4" /></div>
                <p className="font-medium text-slate-300">لا توجد مهام حديثة مسجلة</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">هذا ملخص للمهام التي أعادها المصدر، وليس تأكيدًا على عدم وجود عمل خارجها.</p>
              </div>
            ) : (
              <div className="mt-4 space-y-2">
                {work.recentTasks.map((task) => (
                  <article key={task.id} className="workspace-task">
                    <div className="flex min-w-0 flex-1 items-start gap-2">
                      <span className="workspace-task-mark" />
                      <div className="min-w-0">
                        <p dir="auto" className="text-sm leading-5 text-slate-200">{task.title}</p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                          <span>{dateLabel(task.updatedAt)}</span>
                          <span aria-hidden="true">·</span>
                          <span>التحقق: {label(task.verificationDecision)}</span>
                        </div>
                      </div>
                    </div>
                    <span className={`workspace-status status-${task.status}`}>{label(task.status)}</span>
                  </article>
                ))}
              </div>
            )}
            <SourceNote available={work.executionSource === 'available'}>مصدر التنفيذ غير متاح؛ لا يمكن تأكيد حالة تنفيذ حديثة.</SourceNote>
            {execution && (
              <div className="workspace-execution">
                <div className="flex items-center gap-2 text-xs text-slate-400"><Terminal className="h-3.5 w-3.5 text-teal-300" /> آخر تنفيذ</div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className={`workspace-status status-${execution.status}`}>{label(execution.status)}</span>
                  <span className="text-xs text-slate-500">المحاولة <Identifier>{execution.attempt}</Identifier></span>
                  <span className="text-xs text-slate-500">{dateLabel(execution.updatedAt)}</span>
                </div>
                <details className="workspace-details mt-3">
                  <summary>تفاصيل التنفيذ</summary>
                  <dl className="workspace-detail-grid">
                    <dt>معرّف التنفيذ</dt><dd><Identifier>{execution.id}</Identifier></dd>
                    <dt>المرشح المرتبط</dt><dd><Identifier>{execution.proposalId}</Identifier></dd>
                    <dt>نسخة الأساس</dt><dd><Identifier>{execution.baseRevision}</Identifier></dd>
                  </dl>
                </details>
              </div>
            )}
          </section>

          <section className="workspace-card">
            <div className="workspace-card-heading">
              <div className="workspace-card-icon candidate"><GitBranch className="h-4 w-4" /></div>
              <div className="min-w-0 flex-1">
                <h2>النسخة المرشحة</h2>
                <p>حالة المرشح المسجلة للمشروع</p>
              </div>
              {candidate && <span className={`workspace-status status-${candidate.status}`}>{label(candidate.status)}</span>}
            </div>
            <SourceNote available={work.candidateSource === 'available'}>مصدر المرشح غير متاح؛ لا يمكن تأكيد حالة التغييرات.</SourceNote>
            {work.candidateSource === 'available' && !candidate ? (
              <div className="workspace-empty compact">
                <p className="font-medium text-slate-300">لا يوجد مرشح مسجل في هذه القراءة</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">لن نعرض مراجعة أو اعتمادًا ما لم يسجله المصدر.</p>
              </div>
            ) : candidate && (
              <div className="mt-4">
                <div className="grid grid-cols-2 gap-2">
                  <div className="workspace-stat"><span>دورة الحياة</span><strong>{label(candidate.lifecycle)}</strong></div>
                  <div className="workspace-stat"><span>المراجعة</span><strong>{candidate.approvalRequired ? 'الموافقة مطلوبة' : 'لا تتطلب موافقة'}</strong></div>
                  <div className="workspace-stat"><span>النسخة</span><strong><Identifier>{candidate.revision}</Identifier></strong></div>
                  <div className="workspace-stat"><span>أُنشئ</span><strong>{dateLabel(candidate.createdAt)}</strong></div>
                </div>
                <details className="workspace-details mt-3">
                  <summary>معلومات تقنية عن المرشح</summary>
                  <dl className="workspace-detail-grid">
                    <dt>معرّف المرشح</dt><dd><Identifier>{candidate.proposalId}</Identifier></dd>
                    <dt>معرّف العملية</dt><dd><Identifier>{candidate.operationId}</Identifier></dd>
                    <dt>نسخة الأساس</dt><dd><Identifier>{candidate.baseRevision}</Identifier></dd>
                    <dt>بصمة شجرة المرشح</dt><dd><Identifier>{candidate.candidateTreeHash}</Identifier></dd>
                    <dt>بصمة مجموعة التغييرات</dt><dd><Identifier>{candidate.changeSetHash}</Identifier></dd>
                  </dl>
                </details>
              </div>
            )}
          </section>

          <section className="workspace-card runtime-card">
            <div className="workspace-card-heading">
              <div className="workspace-card-icon runtime"><Activity className="h-4 w-4" /></div>
              <div className="min-w-0 flex-1">
                <h2>حالة التشغيل</h2>
                <p>حالة جلسة المشروع المسجلة</p>
              </div>
              <span className={`workspace-status status-${runtime.status}`}>{label(runtime.status)}</span>
            </div>
            {runtime.source === 'unavailable' ? (
              <SourceNote available={false}>مصدر التشغيل غير متاح الآن؛ لا يمكن تأكيد الحالة الحالية.</SourceNote>
            ) : (
              <div className="mt-4">
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <Clock3 className="h-3.5 w-3.5" />
                  {runtime.status === 'running' ? 'بدأت الجلسة' : 'آخر تغيير مسجل'}
                  <span>{dateLabel(runtime.status === 'running' ? runtime.startedAt : runtime.stoppedAt ?? runtime.startedAt)}</span>
                </div>
                {runtime.runtimeRevision && (
                  <p className="mt-3 text-xs leading-5 text-slate-500">
                    نسخة الجلسة المسجلة: <Identifier>{runtime.runtimeRevision}</Identifier>
                    <span className="block mt-1">هذه النسخة مرتبطة بجلسة التشغيل، ولا تثبت أنها النسخة الحالية للمشروع.</span>
                  </p>
                )}
                <p className="mt-3 border-t border-slate-700/60 pt-3 text-xs leading-5 text-slate-500">
                  لا تتوفر معاينة تفاعلية هنا. هذه الحالة لا تمثل معاينة للمرشح.
                </p>
              </div>
            )}
          </section>

          <div className="workspace-observed">
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>آخر قراءة موحدة: {dateLabel(snapshot.observedAt)}</span>
          </div>
        </aside>
      </div>
    </div>
  );
}
