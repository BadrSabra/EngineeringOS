import React, { useState, useMemo } from 'react';
import {
  useListRules,
  useCreateRule,
  getListRulesQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  Search,
  ShieldAlert,
  AlertCircle,
  AlertTriangle,
  Info,
  CheckCircle2,
  X,
  BarChart2,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { RefreshButton, RequestError } from '@/components/OperatorResilience';
import RuleDetailActions from '@/components/RuleDetailActions';

type RuleSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

const SEVERITY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

export default function Rules() {
  const queryClient = useQueryClient();
  const [filterSeverity, setFilterSeverity] = useState<RuleSeverity | ''>('');
  const [searchTerm, setSearchTerm] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [expandedRule, setExpandedRule] = useState<string | null>(null);
  const [newRule, setNewRule] = useState({
    title: '',
    code: '',
    description: '',
    pattern: '',
    fixDescription: '',
    severity: 'high' as RuleSeverity,
    verifySteps: [] as string[],
  });

  const { data: rules, isLoading, isError, error, refetch, isRefetching, dataUpdatedAt } = useListRules(
    { severity: filterSeverity || undefined },
    {
      query: {
        queryKey: getListRulesQueryKey({ severity: filterSeverity || undefined }),
        staleTime: 30_000,
      },
    },
  );

  const createRule = useCreateRule();

  const visibleRules = useMemo(() => {
    if (!rules) return [];
    const term = searchTerm.toLowerCase();
    return rules
      .filter(
        (r) =>
          !term ||
          r.title.toLowerCase().includes(term) ||
          r.code.toLowerCase().includes(term) ||
          (r.description ?? '').toLowerCase().includes(term),
      )
      .sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 5) - (SEVERITY_ORDER[b.severity] ?? 5));
  }, [rules, searchTerm]);

  // Summary stats
  const totalHits = rules?.reduce((sum, r) => sum + (r.hitCount ?? 0), 0) ?? 0;
  const enabledCount = rules?.filter((r) => r.enabled).length ?? 0;
  const criticalCount = rules?.filter((r) => r.severity === 'critical' || r.severity === 'high').length ?? 0;

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    createRule.mutate(
      { data: { ...newRule, verifySteps: newRule.verifySteps.map((s) => s.trim()).filter(Boolean) } },
      {
        onSuccess: () => {
          setShowCreate(false);
          queryClient.invalidateQueries({ queryKey: getListRulesQueryKey() });
          setNewRule({ title: '', code: '', description: '', pattern: '', fixDescription: '', severity: 'high', verifySteps: [] });
        },
      },
    );
  };

  const SeverityIcon = ({ severity }: { severity: string }) => {
    switch (severity) {
      case 'critical': return <AlertCircle className="w-4 h-4 text-destructive" />;
      case 'high':     return <AlertTriangle className="w-4 h-4 text-orange-500" />;
      case 'medium':   return <AlertTriangle className="w-4 h-4 text-yellow-500" />;
      case 'low':      return <Info className="w-4 h-4 text-blue-500" />;
      default:         return <CheckCircle2 className="w-4 h-4 text-muted-foreground" />;
    }
  };

  const severityColors: Record<string, string> = {
    critical: 'bg-destructive/10 text-destructive border-destructive/20',
    high:     'bg-orange-500/10 text-orange-500 border-orange-500/20',
    medium:   'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
    low:      'bg-blue-500/10 text-blue-500 border-blue-500/20',
    info:     'bg-secondary text-muted-foreground border-border',
  };

  return (
    <div dir="rtl" lang="ar" className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <ShieldAlert className="w-6 h-6 text-primary" /> محرك القواعد
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            حدّد أنماطًا ثابتة وقواعد استدلال مدعومة بالذكاء الاصطناعي.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Severity filter */}
          <select
            value={filterSeverity}
            onChange={(e) => setFilterSeverity(e.target.value as RuleSeverity | '')}
            className="bg-card border border-border rounded-md px-3 py-2 text-sm focus:border-primary focus:outline-none"
          >
             <option value="">كل مستويات الخطورة</option>
             <option value="critical">حرج</option>
             <option value="high">مرتفع</option>
             <option value="medium">متوسط</option>
             <option value="low">منخفض</option>
             <option value="info">معلومة</option>
          </select>
          {/* Search */}
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="ابحث في القواعد..."
              className="bg-card border border-border rounded-md pl-9 pr-8 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary w-56"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <RefreshButton onRefresh={refetch} isRefreshing={isRefetching} lastUpdated={dataUpdatedAt} label="تحديث القواعد" refreshingLabel="جارٍ التحديث…" updatedLabel="آخر تحديث:" />
          <button
            onClick={() => setShowCreate(true)}
            className="bg-primary hover:bg-primary/90 text-primary-foreground px-4 py-2 rounded-md font-medium text-sm flex items-center gap-2 shadow-sm transition-colors"
          >
            <Plus className="w-4 h-4" /> قاعدة جديدة
          </button>
        </div>
      </div>

      {/* Summary stat row */}
      {rules && rules.length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-card border border-border rounded-xl p-4 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <ShieldAlert className="w-4 h-4" />
            </div>
            <div>
              <div className="text-xl font-bold font-mono">{enabledCount}</div>
              <div className="text-xs text-muted-foreground">القواعد النشطة</div>
            </div>
          </div>
          <div className="bg-card border border-border rounded-xl p-4 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-destructive/10 text-destructive flex items-center justify-center shrink-0">
              <AlertCircle className="w-4 h-4" />
            </div>
            <div>
              <div className="text-xl font-bold font-mono">{criticalCount}</div>
              <div className="text-xs text-muted-foreground">حرجة / مرتفعة</div>
            </div>
          </div>
          <div className="bg-card border border-border rounded-xl p-4 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-amber-500/10 text-amber-500 flex items-center justify-center shrink-0">
              <BarChart2 className="w-4 h-4" />
            </div>
            <div>
              <div className="text-xl font-bold font-mono">{totalHits}</div>
              <div className="text-xs text-muted-foreground">إجمالي المخالفات</div>
            </div>
          </div>
        </div>
      )}

      {/* Active filter indicator */}
      {(searchTerm || filterSeverity) && rules && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>عرض <strong className="text-foreground">{visibleRules.length}</strong> من {rules.length} قاعدة</span>
          {(searchTerm || filterSeverity) && (
            <button
              onClick={() => { setSearchTerm(''); setFilterSeverity(''); }}
              className="text-primary hover:underline"
            >
              مسح عوامل التصفية
            </button>
          )}
        </div>
      )}

      {/* Create form */}
      {showCreate && (
        <div className="bg-card border border-primary/30 rounded-xl p-5 shadow-md relative overflow-hidden">
          <div className="absolute top-0 left-0 w-1 h-full bg-primary"></div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-lg">إنشاء قاعدة جديدة</h3>
            <button onClick={() => setShowCreate(false)} className="text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1.5 md:col-span-2">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">العنوان</label>
                <input
                  required
                  value={newRule.title}
                  onChange={(e) => setNewRule({ ...newRule, title: e.target.value })}
                  className="w-full bg-secondary border border-border rounded-md px-3 py-2 text-sm focus:border-primary focus:outline-none"
                placeholder="مثال: منع حقن SQL في الاستعلامات"
                />
              </div>
              <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">رمز القاعدة</label>
                <input
                  required
                  value={newRule.code}
                  onChange={(e) => setNewRule({ ...newRule, code: e.target.value })}
                  className="w-full bg-secondary border border-border rounded-md px-3 py-2 text-sm font-mono focus:border-primary focus:outline-none"
                placeholder="SEC-001"
                dir="ltr"
                />
              </div>
            </div>
            <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">الوصف</label>
              <textarea
                value={newRule.description}
                onChange={(e) => setNewRule({ ...newRule, description: e.target.value })}
                rows={2}
                className="w-full bg-secondary border border-border rounded-md px-3 py-2 text-sm focus:border-primary focus:outline-none resize-none"
                placeholder="ما الذي تكشفه هذه القاعدة؟"
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">النمط (Regex)</label>
                <input
                  value={newRule.pattern}
                  onChange={(e) => setNewRule({ ...newRule, pattern: e.target.value })}
                  className="w-full bg-secondary border border-border rounded-md px-3 py-2 text-sm font-mono focus:border-primary focus:outline-none"
                  placeholder={`e.g. execute\\s*\\(.*\\$\\{`}
                  dir="ltr"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">مستوى الخطورة</label>
                <select
                  value={newRule.severity}
                  onChange={(e) => setNewRule({ ...newRule, severity: e.target.value as RuleSeverity })}
                  className="w-full bg-secondary border border-border rounded-md px-3 py-2 text-sm focus:border-primary focus:outline-none"
                >
                  <option value="critical">حرج</option>
                  <option value="high">مرتفع</option>
                  <option value="medium">متوسط</option>
                  <option value="low">منخفض</option>
                  <option value="info">معلومة</option>
                </select>
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  خطوات التحقق
                </label>
                <button
                  type="button"
                  onClick={() => setNewRule({ ...newRule, verifySteps: [...newRule.verifySteps, ''] })}
                  className="text-xs text-primary hover:underline flex items-center gap-1"
                >
                  <Plus className="w-3 h-3" /> أضف خطوة
                </button>
              </div>
              {newRule.verifySteps.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">لا توجد خطوات — يمكن إضافة أوامر اختيارية للتحقق من إصلاح القاعدة.</p>
              ) : (
                <div className="space-y-1.5">
                  {newRule.verifySteps.map((step, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <input
                        value={step}
                        onChange={(e) =>
                          setNewRule({
                            ...newRule,
                            verifySteps: newRule.verifySteps.map((s, i) => (i === idx ? e.target.value : s)),
                          })
                        }
                        className="flex-1 bg-secondary border border-border rounded-md px-3 py-1.5 text-sm font-mono focus:border-primary focus:outline-none"
                        placeholder="مثال: pnpm run lint -- --rule no-eval"
                        dir="ltr"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setNewRule({
                            ...newRule,
                            verifySteps: newRule.verifySteps.filter((_, i) => i !== idx),
                          })
                        }
                        className="text-muted-foreground hover:text-destructive p-1"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex gap-3">
              <button
                type="submit"
                disabled={createRule.isPending}
                className="bg-primary hover:bg-primary/90 text-primary-foreground px-4 py-2 rounded-md font-medium text-sm disabled:opacity-50 transition-colors"
              >
                {createRule.isPending ? 'جارٍ الإنشاء…' : 'إنشاء القاعدة'}
              </button>
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="px-4 py-2 rounded-md font-medium text-sm border border-border hover:bg-secondary transition-colors"
              >
                إلغاء
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Rule list */}
      <div className="space-y-2">
        {isLoading ? (
          [...Array(4)].map((_, i) => (
            <div key={i} className="h-20 bg-card border border-border rounded-xl animate-pulse" />
          ))
        ) : isError ? (
          <RequestError message={error instanceof Error ? error.message : 'تعذّر تحميل القواعد.'} retryLabel="حاول مجددًا" onRetry={() => void refetch()} />
        ) : visibleRules.length === 0 ? (
          <div className="border-2 border-dashed border-border rounded-xl p-16 text-center flex flex-col items-center">
            <ShieldAlert className="w-12 h-12 text-muted-foreground mb-4 opacity-50" />
            <h3 className="text-lg font-semibold mb-2">
              {searchTerm || filterSeverity ? 'لا توجد قواعد تطابق عوامل التصفية' : 'لم تُعرّف أي قواعد بعد'}
            </h3>
            <p className="text-muted-foreground text-sm max-w-sm mb-6">
              {searchTerm || filterSeverity
                ? 'جرّب تعديل البحث أو مستوى الخطورة.'
                : 'أنشئ قواعد لاكتشاف الأنماط وفرض المعايير وتشغيل الإصلاحات تلقائيًا.'}
            </p>
            {!(searchTerm || filterSeverity) && (
              <button
                onClick={() => setShowCreate(true)}
                className="bg-primary text-primary-foreground px-4 py-2 rounded-md font-medium text-sm flex items-center gap-2"
              >
                <Plus className="w-4 h-4" /> أنشئ أول قاعدة
              </button>
            )}
          </div>
        ) : (
          visibleRules.map((rule) => (
            <div
              key={rule.id}
              className="bg-card border border-border rounded-xl overflow-hidden hover:border-primary/30 transition-colors"
            >
              <div
                role="button"
                tabIndex={0}
                className="p-4 flex items-start gap-4 cursor-pointer"
                onClick={() => setExpandedRule(expandedRule === rule.id ? null : rule.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setExpandedRule(expandedRule === rule.id ? null : rule.id);
                  }
                }}
                aria-expanded={expandedRule === rule.id}
                aria-label={`${expandedRule === rule.id ? 'طيّ' : 'توسيع'} القاعدة ${rule.title}`}
              >
                <SeverityIcon severity={rule.severity} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="font-mono text-xs bg-secondary px-2 py-0.5 rounded border border-border">
                      {rule.code}
                    </span>
                    <span className="font-semibold text-sm">{rule.title}</span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${severityColors[rule.severity] ?? severityColors.info}`}>
                      {({ critical: 'حرج', high: 'مرتفع', medium: 'متوسط', low: 'منخفض', info: 'معلومة' } as const)[rule.severity]}
                    </span>
                    {!rule.enabled && (
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border border-border text-muted-foreground">
                        معطّلة
                      </span>
                    )}
                  </div>
                  {rule.description && (
                    <p className="text-sm text-muted-foreground line-clamp-1">{rule.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {(rule.hitCount ?? 0) > 0 && (
                    <span className="text-xs font-mono font-bold text-primary bg-primary/10 px-2 py-1 rounded">
                      {rule.hitCount} مرات رصد
                    </span>
                  )}
                  {expandedRule === rule.id ? (
                    <ChevronDown className="w-4 h-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                  )}
                </div>
              </div>

              {expandedRule === rule.id && (
                <div className="border-t border-border bg-secondary/20 p-4 space-y-4 text-sm">
                  {rule.description && (
                    <div>
                      <div className="text-xs text-muted-foreground mb-1 uppercase tracking-wider font-semibold">الوصف</div>
                      <p className="text-sm">{rule.description}</p>
                    </div>
                  )}
                  {rule.pattern && (
                    <div>
                      <div className="text-xs text-muted-foreground mb-1 uppercase tracking-wider font-semibold">نمط الكشف</div>
                      <div dir="ltr" className="bg-background border border-border rounded px-3 py-2 font-mono text-xs text-muted-foreground">
                        {rule.pattern}
                      </div>
                    </div>
                  )}
                  {rule.fixDescription && (
                    <div>
                      <div className="text-xs text-muted-foreground mb-1 uppercase tracking-wider font-semibold">الإصلاح المقترح</div>
                      <p className="text-sm text-muted-foreground">{rule.fixDescription}</p>
                    </div>
                  )}
                  {rule.verifySteps && rule.verifySteps.length > 0 && (
                    <div>
                      <div className="text-xs text-muted-foreground mb-2 uppercase tracking-wider font-semibold">خطوات التحقق</div>
                      <ol className="space-y-1 list-decimal list-inside">
                        {rule.verifySteps.map((step, i) => (
                          <li key={i} className="text-xs text-muted-foreground">{step}</li>
                        ))}
                      </ol>
                    </div>
                  )}
                  <div className="text-xs text-muted-foreground font-mono grid grid-cols-2 gap-2 pt-2 border-t border-border">
                    <div dir="ltr">معرّف القاعدة: {rule.id.slice(0, 12)}…</div>
                    <div>مرات الرصد المسجلة: {rule.hitCount ?? 0}</div>
                    {rule.projectId && <div>مخصصة للمشروع</div>}
                    <div>{rule.enabled ? '● مفعّلة' : '○ معطّلة'}</div>
                  </div>
                  <RuleDetailActions rule={rule} />
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
