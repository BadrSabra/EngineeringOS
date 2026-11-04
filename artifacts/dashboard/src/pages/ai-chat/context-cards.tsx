import { useState } from 'react';
import { ChevronRight, Clock3 } from 'lucide-react';
import type { ExecutionLedgerPublicSnapshot } from '@workspace/ai-orchestrator';
import type { ChatMessage } from './types';

export function ContextProvenanceCard({
  provenance,
}: {
  provenance: NonNullable<ChatMessage['contextProvenance']>;
}) {
  const [expanded, setExpanded] = useState(false);
  const loaded = provenance.slices.filter((slice) => slice.status === 'loaded').length;
  const failed = provenance.slices.filter((slice) => slice.status === 'load_failed').length;
  const unavailable = provenance.slices.filter((slice) => slice.status === 'not_requested' || slice.status === 'empty').length;
  const sliceLabels: Record<string, string> = {
    loaded: 'حُمّل', load_failed: 'تعذر التحميل', not_requested: 'لم يُطلب', empty: 'لا توجد بيانات',
  };
  return (
    <div dir="rtl" lang="ar" className="mt-2 w-full overflow-hidden rounded-lg border border-border/60 bg-muted/20 text-[11px]" aria-label="سياق الإجابة ومصادره">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        aria-label="تفاصيل سياق الإجابة"
        className="flex w-full flex-wrap items-center gap-2 px-3 py-2 text-start transition-colors hover:bg-muted/40"
      >
        <span className="font-medium text-foreground">سياق الإجابة ومصادره</span>
        <span className="text-muted-foreground">
          محمّل: {loaded} · غير متوفر: {unavailable}{failed > 0 ? ` · تعذر تحميله: ${failed}` : ''}
        </span>
        <ChevronRight className={`ms-auto h-3 w-3 text-muted-foreground transition-transform ${expanded ? 'rotate-90' : ''}`} />
      </button>
      {expanded && (
        <div className="space-y-1 border-t border-border/40 px-3 py-2 text-muted-foreground">
          <p>تحميل السياق لا يثبت صحة الادعاءات أو اكتمال التنفيذ.</p>
          <div><span className="text-foreground">نوع الطلب:</span> <bdi dir="ltr">{provenance.intentKind}</bdi></div>
          <div className="break-words"><span className="text-foreground">نسخة المشروع:</span> <bdi dir="ltr">{provenance.revisionLabel}</bdi></div>
          <div><span className="text-foreground">الروابط:</span> {provenance.links.returnedCount}{provenance.links.truncated ? ' (عرض جزئي)' : ''}</div>
          {provenance.links.details.length > 0 && (
            <div className="space-y-0.5">
              {provenance.links.details.slice(0, 12).map((link, index) => (
                <div className="break-words" key={`${link.source}-${link.layer}-${index}`}>
                  <bdi dir="ltr" className="text-foreground">{link.source}/{link.layer}:</bdi>{' '}
                  <bdi dir="auto">{link.linkReason}</bdi> (<bdi dir="ltr">{link.direction}, {link.status}</bdi>، المراجع: {link.sourceRefCount})
                </div>
              ))}
            </div>
          )}
          <div className="space-y-0.5">
            {provenance.slices.map((slice) => (
              <div className="break-words" key={slice.layer}>
                <bdi dir="ltr" className="text-foreground">{slice.layer}:</bdi> {sliceLabels[slice.status] ?? <bdi dir="ltr">{slice.status}</bdi>}، السجلات: {slice.rowCount}
                {slice.truncated ? ' (عرض جزئي)' : ''}
                {slice.failureCode && <> · <bdi dir="ltr">{slice.failureCode}</bdi></>}
              </div>
            ))}
          </div>
          {provenance.citations.length > 0 && (
            <div className="break-words"><span className="text-foreground">الاستشهادات:</span> <bdi dir="ltr">{provenance.citations.join(', ')}</bdi></div>
          )}
        </div>
      )}
    </div>
  );
}

export function ExecutionLedgerCard({ snapshot }: { snapshot: ExecutionLedgerPublicSnapshot | null }) {
  const [expanded, setExpanded] = useState(false);
  if (!snapshot) return null;
  const reasonLabels: Record<string, string> = {
    completed: 'Completed',
    cancelled: 'Cancelled',
    deadline: 'Deadline reached',
    model_budget: 'Model budget exhausted',
    tool_budget: 'Tool budget exhausted',
    recovery_budget: 'Recovery budget exhausted',
    provider_exhausted: 'All providers exhausted',
    failed: 'Stopped after a failure',
  };
  const phaseCounts = [
    ['Model', snapshot.counts.model],
    ['Provider', snapshot.counts.provider_attempt],
    ['Provider changes', snapshot.counts.provider_change],
    ['Tools', snapshot.counts.tool],
    ['Planning', snapshot.counts.planner],
    ['Synthesis', snapshot.counts.synthesis],
    ['Recovery', snapshot.counts.recovery],
    ['Tasks', snapshot.counts.hierarchical_task],
  ].filter(([, count]) => typeof count === 'number' && count > 0);
  return (
    <div className="mt-2 w-full overflow-hidden rounded-lg border border-primary/20 bg-primary/5 text-[11px]" aria-label="Execution ledger">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-primary/10"
      >
        <Clock3 className="h-3.5 w-3.5 shrink-0 text-primary" />
        <span className="font-medium text-foreground">Request stopped: {reasonLabels[snapshot.terminalReason ?? 'failed'] ?? 'Stopped'}</span>
        <span className="text-muted-foreground">{snapshot.elapsedMs} ms</span>
        <ChevronRight className={`ml-auto h-3 w-3 text-muted-foreground transition-transform ${expanded ? 'rotate-90' : ''}`} />
      </button>
      {expanded && (
        <div className="space-y-2 border-t border-primary/15 px-3 py-2 text-muted-foreground">
          <div><span className="text-foreground">Phases:</span> {phaseCounts.length > 0 ? phaseCounts.map(([name, count]) => `${name} ${count}`).join(' · ') : 'none recorded'}</div>
          <div><span className="text-foreground">Providers:</span> {snapshot.providers.length > 0 ? snapshot.providers.join(', ') : 'none recorded'}</div>
          <div><span className="text-foreground">Models:</span> {snapshot.models.length > 0 ? snapshot.models.join(', ') : 'none recorded'}</div>
        </div>
      )}
    </div>
  );
}
