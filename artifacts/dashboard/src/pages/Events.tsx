import React, { useEffect, useState } from 'react';
import { useListEvents, useListProjects } from '@workspace/api-client-react';
import { Search, Filter, X } from 'lucide-react';
import { RefreshButton } from '@/components/OperatorResilience';

const SEVERITIES = ['info', 'warning', 'error', 'success'] as const;
const PAGE_SIZE = 50;

function initialEventViewState() {
  const params = new URLSearchParams(window.location.search);
  return {
    projectId: params.get('projectId') ?? '',
    severity: params.get('severity') ?? '',
    correlationId: params.get('correlationId') ?? '',
    searchTerm: params.get('search') ?? '',
    page: Math.max(1, Number(params.get('page')) || 1),
  };
}

export default function Events() {
  const { data: projects } = useListProjects();
  const [viewState] = useState(initialEventViewState);
  const [projectId, setProjectId] = useState(viewState.projectId);
  const [severity, setSeverity] = useState(viewState.severity);
  const [correlationId, setCorrelationId] = useState(viewState.correlationId);
  const [searchTerm, setSearchTerm] = useState(viewState.searchTerm);
  const [page, setPage] = useState(viewState.page);
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams();
    if (projectId) params.set('projectId', projectId);
    if (severity) params.set('severity', severity);
    if (correlationId.trim()) params.set('correlationId', correlationId.trim());
    if (searchTerm.trim()) params.set('search', searchTerm.trim());
    if (page > 1) params.set('page', String(page));
    const query = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
  }, [projectId, severity, correlationId, searchTerm, page]);

  const { data: eventsPage, isLoading, isError, error, refetch } = useListEvents({
    limit: PAGE_SIZE,
    page,
    ...(projectId ? { projectId } : {}),
    ...(correlationId.trim() ? { correlationId: correlationId.trim() } : {}),
    ...(severity ? { severity: severity as (typeof SEVERITIES)[number] } : {}),
    ...(searchTerm.trim() ? { search: searchTerm.trim() } : {}),
  });

  const activeFilterCount = [projectId, severity, correlationId.trim(), searchTerm.trim()].filter(Boolean).length;
  const events = eventsPage?.events ?? [];
  const total = eventsPage?.total ?? 0;
  const hasNextPage = page * PAGE_SIZE < total;

  return (
    <div dir="rtl" lang="ar" className="space-y-6 h-full flex flex-col">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 shrink-0">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">سجل الأحداث</h1>
          <p className="text-muted-foreground text-sm mt-1">
            سجل مباشر لأنشطة النظام.
            {' '}صفحة <bdi dir="ltr">{page}</bdi>. تُطبَّق عوامل التصفية على سجل الأحداث بالكامل.
          </p>
        </div>
        <div
          data-testid="events-controls"
          className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto sm:flex-nowrap sm:gap-3"
        >
          <div data-testid="events-search" className="relative min-w-0 basis-full sm:basis-auto">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={searchTerm}
               onChange={(e) => {
                 setSearchTerm(e.target.value);
                 setPage(1);
               }}
              placeholder="ابحث في السجلات..."
              className="w-full min-w-0 bg-card border border-border rounded-md pl-9 pr-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary sm:w-64"
            />
          </div>
          <div className="shrink-0">
            <RefreshButton onRefresh={refetch} isRefreshing={isLoading} label="تحديث الأحداث" />
          </div>
          <button
            aria-label="إظهار أو إخفاء عوامل تصفية الأحداث"
            onClick={() => setShowFilters((v) => !v)}
            className={`shrink-0 p-2 border rounded-md transition-colors relative ${
              showFilters || activeFilterCount > 0
                ? 'border-primary text-primary bg-primary/10'
                : 'border-border hover:bg-secondary text-muted-foreground'
            }`}
          >
            <Filter className="w-4 h-4" />
            {activeFilterCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 bg-primary text-primary-foreground text-[10px] w-4 h-4 rounded-full flex items-center justify-center font-bold">
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {showFilters && (
        <div className="flex flex-wrap items-center gap-3 shrink-0 bg-card border border-border rounded-xl p-4">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground font-medium">المشروع</span>
            <select
              value={projectId}
               onChange={(e) => {
                 setProjectId(e.target.value);
                 setPage(1);
               }}
              className="bg-secondary/50 border border-border rounded-md px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">كل المشاريع</option>
              {projects?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground font-medium">مستوى الخطورة</span>
            <select
              value={severity}
               onChange={(e) => {
                 setSeverity(e.target.value);
                 setPage(1);
               }}
              className="bg-secondary/50 border border-border rounded-md px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">كل المستويات</option>
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {s === 'info' ? 'معلومة' : s === 'warning' ? 'تحذير' : s === 'error' ? 'خطأ' : 'نجاح'}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground font-medium">العملية</span>
            <input
              value={correlationId}
               onChange={(e) => {
                 setCorrelationId(e.target.value);
                 setPage(1);
               }}
              placeholder="معرّف الارتباط"
              dir="ltr"
              className="w-64 bg-secondary/50 border border-border rounded-md px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          {activeFilterCount > 0 && (
            <button
              onClick={() => {
                setProjectId('');
                setSeverity('');
                setCorrelationId('');
                setSearchTerm('');
                setPage(1);
              }}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <X className="w-3 h-3" /> مسح عوامل التصفية
            </button>
          )}
        </div>
      )}

      <div className="flex-1 min-w-0 bg-[#0a0a0a] border border-border rounded-xl shadow-sm overflow-hidden flex flex-col font-mono text-sm relative">
        <div
          data-testid="events-log-scroll"
          role="region"
          aria-label="سجل الأحداث؛ مرّر أفقيًا لعرض بقية الأعمدة."
          tabIndex={0}
          dir="ltr"
          className="min-w-0 flex-1 overflow-auto"
        >
          <div className="min-w-[900px]">
            <div className="p-2 border-b border-border bg-card/50 flex gap-4 text-xs text-muted-foreground sticky top-0 z-10 shadow-sm backdrop-blur-md">
              <div className="w-32">الوقت</div>
              <div className="w-16">المستوى</div>
              <div className="w-32">النوع</div>
              <div className="w-48 truncate">المشروع</div>
              <div className="w-56 truncate">العملية</div>
              <div className="flex-1">الرسالة</div>
            </div>

            <div className="p-2">
              {isLoading ? (
                <div className="p-4 text-primary animate-pulse flex items-center gap-2">
                  <span className="w-2 h-2 bg-primary rounded-full animate-ping"></span> جارٍ تحميل الأحداث…
                </div>
              ) : isError ? (
                <div className="p-8 text-red-300">
                  <p>تعذّر تحميل الأحداث{error instanceof Error && error.message ? `: ${error.message}` : '.'}</p>
                  <button
                    type="button"
                    onClick={() => void refetch()}
                    className="mt-3 rounded-md border border-red-400/50 px-3 py-1.5 text-xs text-red-200 hover:bg-red-950/40"
                  >
                    حاول مجددًا
                  </button>
                </div>
              ) : (events?.length ?? 0) === 0 ? (
                <div className="p-8 text-muted-foreground opacity-50">
                  {activeFilterCount > 0 ? 'لا توجد أحداث تطابق عوامل التصفية الحالية.' : 'لا توجد أحداث مسجلة.'}
                </div>
              ) : (
                <div className="space-y-0.5">
                  {(events || []).map((evt) => {
                    const color =
                      evt.severity === 'error'
                        ? 'text-red-400 bg-red-950/20'
                        : evt.severity === 'success'
                        ? 'text-green-400'
                        : evt.severity === 'warning'
                        ? 'text-yellow-400 bg-yellow-950/20'
                        : 'text-blue-400';

                    return (
                      <div
                        key={evt.id}
                        className={`flex gap-4 p-1.5 rounded hover:bg-white/5 transition-colors ${color}`}
                      >
                        <div className="w-32 opacity-70 shrink-0">
                          {new Date(evt.timestamp).toISOString().split('T')[1].replace('Z', '')}
                        </div>
                        <div className="w-16 font-bold uppercase shrink-0">
                          {evt.severity === 'info' ? 'معلومة' : evt.severity === 'warning' ? 'تحذير' : evt.severity === 'error' ? 'خطأ' : evt.severity === 'success' ? 'نجاح' : evt.severity || 'معلومة'}
                        </div>
                        <div className="w-32 opacity-80 shrink-0 truncate"><bdi dir="ltr">{evt.type}</bdi></div>
                        <div className="w-48 opacity-60 shrink-0 truncate"><bdi dir="ltr">{evt.projectId || '-'}</bdi></div>
                        <div className="w-56 opacity-60 shrink-0 truncate" title={evt.correlationId || undefined}>
                          {evt.correlationId ? <bdi dir="ltr">{evt.correlationId}</bdi> : 'غير مرتبط'}
                        </div>
                        <div className="flex-1 whitespace-pre-wrap break-words"><bdi dir="auto">{evt.message}</bdi></div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
        {!isLoading && !isError && (events?.length ?? 0) > 0 && (
          <div className="shrink-0 border-t border-border bg-card/50 px-3 py-2 flex items-center justify-between text-xs text-muted-foreground">
            <span>
                عرض {((page - 1) * PAGE_SIZE) + 1}–{((page - 1) * PAGE_SIZE) + events.length} من {total}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={page === 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                className="rounded-md border border-border px-3 py-1.5 hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-40"
              >
                الأحدث
              </button>
              <button
                type="button"
                disabled={!hasNextPage}
                onClick={() => setPage((current) => current + 1)}
                className="rounded-md border border-border px-3 py-1.5 hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-40"
              >
                الأقدم
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
