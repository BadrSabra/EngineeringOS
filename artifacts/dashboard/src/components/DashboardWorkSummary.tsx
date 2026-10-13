import { useUser } from '@clerk/react';
import {
  getGetDashboardWorkSummaryQueryKey,
  useGetDashboardWorkSummary,
  type DashboardWorkSummaryItem,
} from '@workspace/api-client-react';
import { ArrowLeft, CircleDot, Hand, History, Info, RotateCw } from 'lucide-react';
import { Link } from 'wouter';

export const WORK_SUMMARY_REFRESH_MS = 30_000;

const STATUS_LABELS: Record<DashboardWorkSummaryItem['kind'], Record<string, string>> = {
  mission: {
    draft: 'مسودة لم تبدأ',
    active: 'قيد العمل',
    waiting: 'متوقفة بانتظار مراجعة',
    blocked: 'متعثرة وتحتاج نظرة',
    needs_replan: 'تحتاج إعادة تخطيط',
    completed: 'مسجّلة كمنتهية',
    failed: 'مسجّلة كمتعثرة',
    cancelled: 'أُلغيت',
  },
  task: {
    pending: 'بانتظار البدء',
    queued: 'في قائمة الانتظار',
    running: 'قيد التنفيذ',
    verifying: 'قيد الفحص',
    completed: 'مسجّلة كمنتهية',
    failed: 'مسجّلة كمتعثرة',
    cancelled: 'أُلغيت',
  },
  execution: {
    queued: 'في قائمة الانتظار',
    running: 'قيد التشغيل',
    paused: 'متوقف مؤقتًا',
    cancelling: 'جارٍ الإيقاف',
    cancelled: 'أُلغي',
    completed: 'مسجّل كمنتهٍ',
    failed: 'مسجّل كمتعثر',
  },
};

const KIND_LABELS: Record<DashboardWorkSummaryItem['kind'], string> = {
  mission: 'هدف',
  task: 'مهمة',
  execution: 'تشغيل',
};

const PLAN_LABELS: Record<DashboardWorkSummaryItem['planBinding'], string | null> = {
  current_plan: 'مرتبطة بالخطة الحالية',
  legacy_unversioned: 'خطة قديمة بلا إصدار',
  revision_mismatch: 'الخطة تغيّرت منذ التسجيل',
  independent: null,
  needs_details: 'تحتاج فتح التفاصيل',
};

export function statusLabel(status: string, kind: DashboardWorkSummaryItem['kind'] = 'task'): string {
  return STATUS_LABELS[kind]?.[status] ?? 'حالة مسجّلة غير معروفة، افتح التفاصيل';
}

/** Strip the artifact base so Wouter's own base handling is not doubled. */
export function toRouterHref(href: string): string {
  const base = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');
  if (base && (href === base || href.startsWith(`${base}/`) || href.startsWith(`${base}?`))) {
    const rest = href.slice(base.length);
    return rest.startsWith('/') ? rest : `/${rest}`;
  }
  return href.startsWith('/') ? href : `/${href}`;
}

function formatTime(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? 'وقت غير مسجّل'
    : d.toLocaleString('ar', { dateStyle: 'medium', timeStyle: 'short' });
}

type SectionKey = 'decisions' | 'active' | 'recent';

const SECTIONS: { key: SectionKey; title: string; meaning: string; empty: string; icon: typeof Hand; tone: string }[] = [
  {
    key: 'decisions',
    title: 'يحتاج مراجعتك',
    meaning: 'عناصر تحتاج أن تراجعها: قد تكون انتظارًا أو تعثرًا أو حاجة لإعادة تخطيط، وليست بالضرورة طلب موافقة. أي قرار يُتخذ داخل التفاصيل، لا من هنا.',
    empty: 'لا شيء ضمن هذا العرض المحدود يحتاج مراجعتك.',
    icon: Hand,
    tone: 'border-amber-500/30 bg-amber-500/[0.04]',
  },
  {
    key: 'active',
    title: 'يعمل الآن',
    meaning: 'عمل حالته المسجّلة جارية أو في الانتظار. التصنيف إرشادي ومبني على السجل فقط.',
    empty: 'لا عمل جارٍ ضمن هذا العرض المحدود.',
    icon: CircleDot,
    tone: 'border-primary/25 bg-primary/[0.03]',
  },
  {
    key: 'recent',
    title: 'انتهى مؤخرًا',
    meaning: 'عمل وصل إلى حالة نهائية مسجّلة. "مكتملة" هنا وصف للسجل وليست إثباتًا؛ افتح التفاصيل لمراجعة الأدلة.',
    empty: 'لا عمل منتهٍ ضمن هذا العرض المحدود.',
    icon: History,
    tone: 'border-border bg-card',
  },
];

function WorkItem({ item }: { item: DashboardWorkSummaryItem }) {
  const plan = PLAN_LABELS[item.planBinding];
  return (
    <li>
      <Link
        href={toRouterHref(item.href)}
        data-testid={`link-work-item-${item.kind}-${item.id}`}
        className="group flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-background/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" data-testid={`text-work-title-${item.id}`}>{item.title}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span className="rounded bg-secondary px-1.5 py-0.5">{KIND_LABELS[item.kind]}</span>
            <span data-testid={`status-work-item-${item.id}`}>{statusLabel(item.status, item.kind)}</span>
            {item.attempt !== null && <span>المحاولة {item.attempt}</span>}
            <span className="truncate">{item.projectName}</span>
            <span>{formatTime(item.updatedAt)}</span>
            {plan && <span className="text-amber-300/90">{plan}</span>}
          </p>
        </div>
        <span className="mt-1 flex shrink-0 items-center gap-1 text-xs font-medium text-primary opacity-80 group-hover:opacity-100">
          افتح التفاصيل
          <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" />
        </span>
      </Link>
    </li>
  );
}

export default function DashboardWorkSummary() {
  const { user, isLoaded } = useUser();
  const ownerId = isLoaded !== false ? user?.id ?? null : null;
  const query = useGetDashboardWorkSummary({
    query: {
      queryKey: [...getGetDashboardWorkSummaryQueryKey(), { owner: ownerId }],
      enabled: Boolean(ownerId),
      staleTime: WORK_SUMMARY_REFRESH_MS,
      refetchInterval: WORK_SUMMARY_REFRESH_MS,
      retry: 1,
    },
  });
  const { data, error, isLoading, isFetching, refetch } = query;

  const header = (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 id="home-work-overview-heading" className="text-lg font-semibold">ما يحدث في عملك</h2>
        <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">
          عرض لما سجّله النظام عن عملك أنت فقط. الحالات هنا مسجّلة ولم يُعَد التحقق منها؛ التحقق والقرارات داخل صفحة كل عنصر.
        </p>
      </div>
      {isFetching && data && !error && (
        <span className="text-xs text-muted-foreground" data-testid="status-work-overview-refreshing">جارٍ التحديث…</span>
      )}
    </div>
  );

  let body;
  if (!ownerId || (isLoading && !data)) {
    body = (
      <div data-testid="status-work-overview-loading" aria-busy="true" className="grid gap-3 lg:grid-cols-3">
        <span className="sr-only">جارٍ قراءة ملخص العمل</span>
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-40 animate-pulse rounded-xl border border-border bg-card" />
        ))}
      </div>
    );
  } else if (error) {
    body = (
      <div role="alert" data-testid="status-work-overview-error" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
        <p className="text-sm font-medium">تعذرت قراءة ملخص العمل.</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          هذا لا يعني أنه لا يوجد عمل. لم يتغير شيء في مشاريعك؛ أعد القراءة فقط.
        </p>
        <button
          type="button"
          data-testid="button-retry-work-overview"
          onClick={() => void refetch()}
          className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
        >
          <RotateCw aria-hidden="true" className="h-3.5 w-3.5" />
          أعد القراءة
        </button>
      </div>
    );
  } else if (data) {
    const allEmpty = !data.decisions.length && !data.active.length && !data.recent.length;
    const c = data.coverage;
    body = (
      <div className="space-y-3">
        {allEmpty ? (
          <div data-testid="status-work-overview-empty" className="rounded-xl border border-dashed border-border bg-card p-5 text-sm">
            {c.partial || c.goalsTruncated || c.excludedExecutionCount > 0 ? (
              <>
                <p className="font-medium" data-testid="text-work-empty-bounded">لا توجد عناصر ضمن هذا العرض المحدود.</p>
                <p className="mt-1 text-xs text-muted-foreground">قد يوجد عمل آخر لم يشمله هذا العرض؛ افتح المهام أو المشاريع لرؤية كل شيء.</p>
              </>
            ) : (
              <>
                <p className="font-medium">لا توجد عناصر مسجّلة لعرضها الآن.</p>
                <p className="mt-1 text-xs text-muted-foreground">اكتب هدفك في الأعلى لتبدأ، وسيظهر هنا ما يتقدم وما يحتاج مراجعتك.</p>
              </>
            )}
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-3">
            {SECTIONS.map((s) => {
              const items = data[s.key];
              const Icon = s.icon;
              return (
                <section
                  key={s.key}
                  aria-labelledby={`work-section-${s.key}`}
                  data-testid={`section-work-${s.key}`}
                  className={`rounded-xl border p-3 ${s.tone}`}
                >
                  <div className="flex items-center gap-2 px-1">
                    <Icon aria-hidden="true" className="h-4 w-4 text-primary" />
                    <h3 id={`work-section-${s.key}`} className="text-sm font-semibold">{s.title}</h3>
                  </div>
                  <p className="mt-1 px-1 text-xs leading-5 text-muted-foreground">{s.meaning}</p>
                  {items.length ? (
                    <ul className="mt-2 -mx-1 divide-y divide-border/60">
                      {items.map((item) => <WorkItem key={`${item.kind}-${item.id}`} item={item} />)}
                    </ul>
                  ) : (
                    <p className="mt-3 px-1 pb-1 text-xs text-muted-foreground" data-testid={`empty-work-${s.key}`}>{s.empty}</p>
                  )}
                </section>
              );
            })}
          </div>
        )}
        <div data-testid="text-work-coverage" className="flex items-start gap-2 rounded-lg bg-secondary/40 px-3 py-2 text-xs leading-5 text-muted-foreground">
          <Info aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <p>
            {c.partial || c.goalsTruncated
              ? `هذا عرض جزئي: نقرأ حتى ${c.sourceLimit} سجلات من كل نوع ونعرض حتى ${c.sectionLimit} في كل قسم، لذا قد يوجد عمل آخر غير ظاهر. `
              : `نقرأ حتى ${c.sourceLimit} سجلات من كل نوع ونعرض حتى ${c.sectionLimit} في كل قسم. `}
            {c.excludedExecutionCount > 0 && `لم نعرض ${c.excludedExecutionCount} من عمليات التشغيل غير المصنّفة أو الخاصة بالمحادثة. `}
            التصنيف إرشادي ومبني على الحالة المسجّلة. 
            هذا ليس عددًا كليًا لعملك. آخر قراءة: {formatTime(data.observedAt)}.
          </p>
        </div>
      </div>
    );
  }

  return (
    <section aria-labelledby="home-work-overview-heading" data-testid="section-home-work-overview" dir="rtl" className="space-y-3">
      {header}
      {body}
    </section>
  );
}
