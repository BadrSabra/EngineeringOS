import { useState } from 'react';
import { ChevronDown, FileCode2, GitMerge, Search, ShieldAlert, ShieldCheck } from 'lucide-react';
import type { EvidenceGraph } from '@workspace/api-client-react';

const statusClass: Record<string, string> = {
  PROVEN: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
  CONTRADICTED: 'border-red-500/30 bg-red-500/10 text-red-200',
  INCOMPLETE: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
  NOT_PROVEN: 'border-slate-500/30 bg-slate-500/10 text-slate-300',
};

const nodeClass: Record<string, string> = {
  FILE: 'text-sky-200',
  SYMBOL: 'text-violet-200',
  CLAIM: 'text-amber-200',
  SUB_QUERY: 'text-cyan-200',
  VERDICT: 'text-emerald-200',
};

const statusLabels: Record<string, string> = {
  PROVEN: 'مثبت بحسب السجل',
  CONTRADICTED: 'توجد أدلة مناقضة',
  INCOMPLETE: 'الأدلة غير مكتملة',
  NOT_PROVEN: 'غير مثبت',
};
const nodeLabels: Record<string, string> = {
  FILE: 'ملف', SYMBOL: 'عنصر برمجي', CLAIM: 'ادعاء', SUB_QUERY: 'سؤال فرعي', VERDICT: 'نتيجة التحقق',
};
const relationLabels: Record<string, string> = {
  CONTAINS: 'يحتوي على', SUPPORTS: 'يدعم', INVESTIGATED_BY: 'يُبحث عبر',
  CONTRIBUTES_TO: 'يسهم في', CONTRADICTS: 'يناقض',
};

export function EvidenceGraphPanel({ graph }: { graph: EvidenceGraph }) {
  const [expanded, setExpanded] = useState(false);
  const displayedNodes = expanded ? graph.nodes : graph.nodes.slice(0, 8);
  const displayedEdges = expanded ? graph.edges : graph.edges.slice(0, 8);
  const contradictions = graph.contradictionClaimIds.length;

  return (
    <section dir="rtl" lang="ar" className="mt-2 overflow-hidden rounded-lg border border-cyan-500/25 bg-cyan-500/5" aria-label="ترابط الأدلة">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-label="تفاصيل ترابط الأدلة"
        className="flex w-full flex-wrap items-center gap-2 px-3 py-2 text-start hover:bg-cyan-500/5"
        aria-expanded={expanded}
      >
        <GitMerge className="h-3.5 w-3.5 shrink-0 text-cyan-300" aria-hidden="true" />
        <span className="min-w-0 flex-1 text-xs font-semibold text-cyan-100">ترابط الأدلة المشتركة</span>
        <span className="text-[10px] text-muted-foreground">
          العناصر: {graph.nodes.length} · القراءات المشتركة: {graph.reads.length}
        </span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>

      <div className="border-t border-cyan-500/15 px-3 py-2.5">
        <p className="mb-2 text-[10px] text-muted-foreground">هذه خريطة للأدلة المسجلة؛ لا تمنح إذن تعديل ولا تثبت اكتمال التنفيذ. غياب أدلة مناقضة لا يثبت صحة كل ادعاء.</p>
        <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
          <span className="rounded-full border border-border/60 bg-background/30 px-2 py-0.5 text-muted-foreground">
            ملف ← عنصر برمجي ← ادعاء ← سؤال فرعي ← نتيجة التحقق
          </span>
          {graph.sourceRevision && (
            <span className="rounded-full border border-border/60 bg-background/30 px-2 py-0.5 font-mono text-muted-foreground">
              نسخة المشروع: <bdi dir="ltr">{graph.sourceRevision}</bdi>
            </span>
          )}
          {contradictions > 0 ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-red-200">
              <ShieldAlert className="h-3 w-3" aria-hidden="true" />
              ادعاءات لها أدلة مناقضة: {contradictions}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-emerald-200">
              <ShieldCheck className="h-3 w-3" aria-hidden="true" />
              لا توجد أدلة مناقضة مسجلة
            </span>
          )}
        </div>

        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <div className="rounded-md border border-border/50 bg-background/20 p-2">
            <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              <FileCode2 className="h-3 w-3" aria-hidden="true" />
              قراءات المصادر المشتركة
            </div>
            <div className="space-y-1">
              {graph.reads.slice(0, expanded ? 12 : 4).map((read) => (
                <div key={read.key} className="flex min-w-0 items-center gap-1.5 text-[10px]">
                  <bdi dir="ltr" className="min-w-0 flex-1 truncate font-mono text-foreground" title={read.path}>{read.path}</bdi>
                  <bdi dir="ltr" className="shrink-0 text-muted-foreground">{read.startLine}–{read.endLine}</bdi>
                  {read.truncated && <span className="shrink-0 text-amber-200">قراءة جزئية</span>}
                  {read.taskIndexes.length > 1 && (
                    <span className="shrink-0 text-cyan-200">×{read.taskIndexes.length}</span>
                  )}
                </div>
              ))}
              {graph.reads.length === 0 && <span className="text-[10px] text-muted-foreground">لا توجد قراءات محفوظة.</span>}
            </div>
          </div>

          <div className="rounded-md border border-border/50 bg-background/20 p-2">
            <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              <Search className="h-3 w-3" aria-hidden="true" />
              عناصر خريطة الأدلة
            </div>
            <div className="space-y-1">
              {displayedNodes.map((node) => (
                <div key={node.id} className="flex min-w-0 items-center gap-1.5 text-[10px]">
                  <span className={`shrink-0 font-semibold ${nodeClass[node.kind] ?? 'text-foreground'}`}>{nodeLabels[node.kind] ?? <bdi dir="ltr">{node.kind}</bdi>}</span>
                  <bdi dir="auto" className="min-w-0 flex-1 truncate text-foreground" title={node.label}>{node.label}</bdi>
                  {node.status && (
                    <span className={`shrink-0 rounded-full border px-1.5 py-0.5 ${statusClass[node.status] ?? statusClass.NOT_PROVEN}`}>
                      {statusLabels[node.status] ?? <>حالة غير معروفة: <bdi dir="ltr">{node.status}</bdi></>}
                    </span>
                  )}
                </div>
              ))}
              {graph.nodes.length === 0 && <span className="text-[10px] text-muted-foreground">لا توجد عناصر في خريطة الأدلة.</span>}
            </div>
          </div>
        </div>

        {displayedEdges.length > 0 && (
          <div className="mt-2 rounded-md border border-border/50 bg-background/20 p-2">
            <div className="mb-1 text-[10px] font-semibold text-muted-foreground">العلاقات المسجلة</div>
            <div className="grid gap-1 sm:grid-cols-2">
              {displayedEdges.map((edge) => (
                <div key={edge.id} className="min-w-0 truncate text-[10px] text-muted-foreground" title={`${edge.from} ${edge.relation} ${edge.to}`}>
                  <bdi dir="ltr" className="font-mono text-foreground">{edge.from.split(':').slice(1).join(':') || edge.from}</bdi>
                  <span className="mx-1 text-cyan-300">{relationLabels[edge.relation] ?? <bdi dir="ltr">{edge.relation}</bdi>}</span>
                  <bdi dir="ltr" className="font-mono text-foreground">{edge.to.split(':').slice(1).join(':') || edge.to}</bdi>
                </div>
              ))}
            </div>
          </div>
        )}

        {(graph.nodes.length > 8 || graph.edges.length > 8 || graph.reads.length > 4) && (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="mt-2 text-[10px] font-medium text-cyan-200 hover:text-cyan-100"
          >
            {expanded ? 'عرض خريطة الأدلة المختصرة' : 'عرض خريطة الأدلة الموسعة'}
          </button>
        )}
      </div>
    </section>
  );
}