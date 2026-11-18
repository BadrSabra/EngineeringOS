import { useState } from 'react';
import { AlertTriangle, ChevronRight, GitBranch, LoaderCircle, ShieldCheck } from 'lucide-react';
import {
  getGetProjectExecutionProofGraphQueryKey,
  useGetProjectExecutionProofGraph,
  type ExecutionProofGraphEdgeType,
  type ExecutionProofGraphNodeKind,
  type ExecutionProofGraphProjectorResult,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';

const nodeKindLabels: Record<ExecutionProofGraphNodeKind, string> = {
  EXECUTION: 'التنفيذ',
  ACCEPTANCE: 'القبول',
  EVIDENCE_SNAPSHOT: 'لقطة الأدلة',
  GATE_C_ARTIFACT: 'إيصال Gate C',
  EPISODE: 'حلقة التنفيذ',
  ACTION_EVENT: 'حدث الإجراء',
  EFFECT_BUNDLE: 'حزمة الأثر',
  EFFECT: 'الأثر المرصود',
  OBSERVATION: 'ملاحظة مباشرة',
};

const edgeTypeLabels: Record<ExecutionProofGraphEdgeType, string> = {
  EXECUTION_HAS_ACCEPTANCE: 'يرتبط بالقبول',
  ACCEPTANCE_HAS_SNAPSHOT: 'يرتبط بلقطة الأدلة',
  EXECUTION_HAS_EPISODE: 'يتضمن حلقة',
  EPISODE_HAS_EVENT: 'يتضمن حدثًا',
  EPISODE_HAS_EFFECT_BUNDLE: 'يرتبط بحزمة أثر',
  BUNDLE_HAS_EFFECT: 'تتضمن أثرًا',
  EFFECT_HAS_OBSERVATION: 'يدعمه رصد',
  SNAPSHOT_HAS_ARTIFACT: 'يتضمن إيصالًا',
  ARTIFACT_BINDS_EVENT: 'يربط حدثًا',
  ARTIFACT_BINDS_EFFECT_BUNDLE: 'يربط حزمة أثر',
  ARTIFACT_BINDS_EFFECT: 'يربط أثرًا',
  ARTIFACT_BINDS_OBSERVATION: 'يربط ملاحظة',
};

const reasonLabels: Record<string, string> = {
  EXECUTION_NOT_FOUND: 'التنفيذ غير موجود ضمن هذا المشروع.',
  ATTEMPT_MISMATCH: 'رقم المحاولة لا يطابق المحاولة المحفوظة.',
  EXECUTION_NOT_COMPLETED: 'لم يكتمل التنفيذ بعد.',
  UNSUPPORTED_PROOF_MODE: 'نوع الإثبات غير مدعوم في هذه النسخة.',
  ACCEPTANCE_MISSING: 'لا يوجد سجل قبول مرتبط.',
  EVIDENCE_SNAPSHOT_MISSING: 'لقطة الأدلة غير متاحة.',
  EVIDENCE_INCOMPLETE: 'لقطة الأدلة غير مكتملة أو لا تستوفي شروط القبول.',
  CANONICAL_PROOF_REJECTED: 'لم يجتز الإثبات الأساسي التحقق.',
  DOMAIN_PROOF_MISMATCH: 'بيانات Gate C لا تطابق الإثبات الأساسي.',
  SOURCE_ROWS_MISSING: 'بعض سجلات المصدر المطلوبة غير متاحة.',
  SOURCE_HASH_MISMATCH: 'بصمة أحد سجلات المصدر غير متطابقة.',
  IDENTITY_MISMATCH: 'هويات التنفيذ أو القبول غير متطابقة.',
  REVISION_MISMATCH: 'نسخة المصدر لا تطابق الإثبات.',
  GRAPH_INVALID: 'علاقات المخطط لا تجتاز الفحص البنيوي.',
};

function matchesRequestedProofGraph(
  result: ExecutionProofGraphProjectorResult,
  requested: { projectId: string; executionId: string; attempt: number },
): boolean {
  if (result.kind === 'NOT_PROJECTABLE') {
    return result.executionId === requested.executionId
      && result.expectedAttempt === requested.attempt;
  }

  if (result.authority !== 'READ_ONLY_PROJECTION') return false;
  const { graph, canonicalProof, structuralValidation } = result;
  if (!graph || !canonicalProof || !structuralValidation || !Array.isArray(graph.nodes)) {
    return false;
  }

  return (
    graph.projectId === requested.projectId
    && graph.executionId === requested.executionId
    && graph.attempt === requested.attempt
    && canonicalProof.executionId === requested.executionId
    && canonicalProof.attempt === requested.attempt
    && canonicalProof.operationId === graph.operationId
    && canonicalProof.sourceRevision === graph.sourceRevision
    && canonicalProof.candidateIdentity === graph.candidateIdentity
    && structuralValidation.graphHash === result.graphHash
    && graph.nodes.length > 0
    && graph.nodes.every((node) =>
      node !== null
      && typeof node === 'object'
      && node.projectId === requested.projectId
      && node.executionId === requested.executionId)
  );
}

function GraphContents({ result }: { result: ExecutionProofGraphProjectorResult }) {
  if (result.kind === 'NOT_PROJECTABLE') {
    return (
      <div
        role="status"
        data-testid="status-proof-graph-unavailable"
        className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-100"
      >
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <div className="space-y-1">
          <p className="font-medium">لا يمكن تكوين مخطط لهذا التنفيذ.</p>
          {result.reasons.map((reason) => (
            <p key={reason} className="text-amber-100/80">
              {reasonLabels[reason] ?? 'تعذّر التحقق من مصدر المخطط.'}
            </p>
          ))}
        </div>
      </div>
    );
  }

  const { graph, structuralValidation, canonicalProof } = result;
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));

  return (
    <div data-testid="proof-graph-result" className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <div
          data-testid="status-proof-graph-canonical"
          className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2"
        >
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Canonical Proof</p>
          <p className="mt-1 text-xs font-semibold text-emerald-100">
            {canonicalProof.verdict} · المحاولة {canonicalProof.attempt}
          </p>
        </div>
        <div
          data-testid="status-proof-graph-structure"
          className={`rounded-md border px-3 py-2 ${
            structuralValidation.verdict === 'PASS'
              ? 'border-sky-500/30 bg-sky-500/10'
              : 'border-amber-500/30 bg-amber-500/10'
          }`}
        >
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">الفحص البنيوي</p>
          <p className="mt-1 text-xs font-semibold text-foreground">
            {structuralValidation.verdict === 'PASS' ? 'اجتاز البنية' : 'لم يجتز البنية'}
            {' · '}
            {graph.nodes.length} عقد · {graph.edges.length} علاقة
          </p>
        </div>
      </div>

      <p className="rounded-md border border-border/60 bg-background/35 px-3 py-2 text-[11px] leading-5 text-muted-foreground">
        هذا عرض للقراءة فقط. نجاح الفحص البنيوي لا يثبت Canonical Proof ولا يمنح صلاحية تنفيذ أو تطبيق.
      </p>

      <ol className="space-y-1.5" data-testid="list-proof-graph-nodes">
        {graph.nodes.map((node, index) => {
          const detail = node.status ?? node.verdict ?? node.outcome ?? node.eventType ?? node.freshness;
          return (
            <li
              key={node.id}
              data-testid={`row-proof-graph-node-${index}`}
              className="flex min-w-0 items-center justify-between gap-3 rounded-md border border-border/50 bg-background/25 px-3 py-2 text-xs"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] text-primary">
                  {index + 1}
                </span>
                <span className="truncate font-medium">{nodeKindLabels[node.kind]}</span>
              </span>
              {detail && (
                <span className="shrink-0 text-[10px] text-muted-foreground" dir="ltr">
                  {detail}
                </span>
              )}
            </li>
          );
        })}
      </ol>

      <details className="rounded-md border border-border/50 bg-background/20">
        <summary
          data-testid="toggle-proof-graph-relationships"
          className="cursor-pointer px-3 py-2 text-xs font-medium text-foreground"
        >
          عرض العلاقات ({graph.edges.length})
        </summary>
        <ul className="space-y-1 border-t border-border/50 p-3">
          {graph.edges.map((edge) => {
            const from = nodeById.get(edge.from);
            const to = nodeById.get(edge.to);
            return (
              <li
                key={edge.id}
                data-testid={`row-proof-graph-edge-${edge.id}`}
                className="flex min-w-0 flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground"
              >
                <span className="font-medium text-foreground">
                  {from ? nodeKindLabels[from.kind] : 'مصدر'}
                </span>
                <span>{edgeTypeLabels[edge.type]}</span>
                <span className="font-medium text-foreground">
                  {to ? nodeKindLabels[to.kind] : 'وجهة'}
                </span>
                {edge.role && <span dir="ltr">({edge.role})</span>}
              </li>
            );
          })}
        </ul>
      </details>
    </div>
  );
}

export function ExecutionProofGraphPanel({
  projectId,
  executionId,
  attempt,
}: {
  projectId: string;
  executionId: string;
  attempt: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const query = useGetProjectExecutionProofGraph(projectId, executionId, attempt, {
    query: {
      enabled: expanded,
      queryKey: getGetProjectExecutionProofGraphQueryKey(projectId, executionId, attempt),
      retry: false,
    },
  });
  const responseMatchesRequest = query.data
    ? matchesRequestedProofGraph(query.data, { projectId, executionId, attempt })
    : false;

  return (
    <section
      data-testid={`section-proof-graph-${executionId}`}
      className="w-full overflow-hidden rounded-lg border border-border/60 bg-background/30"
    >
      <Button
        type="button"
        variant="ghost"
        size="sm"
        data-testid={`button-proof-graph-${executionId}`}
        aria-expanded={expanded}
        className="h-auto min-h-9 w-full justify-start gap-2 rounded-none px-3 py-2 text-xs"
        onClick={() => setExpanded((current) => !current)}
      >
        <GitBranch className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
        <span>{expanded ? 'إخفاء مخطط الإثبات' : 'عرض مخطط الإثبات'}</span>
        <ChevronRight
          className={`ml-auto h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-90' : ''}`}
          aria-hidden="true"
        />
      </Button>

      {expanded && (
        <div
          role="region"
          aria-label="مخطط إثبات التنفيذ"
          data-testid={`region-proof-graph-${executionId}`}
          className="space-y-3 border-t border-border/50 p-3"
        >
          {query.isLoading ? (
            <div
              role="status"
              data-testid="status-proof-graph-loading"
              className="flex items-center gap-2 text-xs text-muted-foreground"
            >
              <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
              جارٍ تحميل المخطط والتحقق من المحاولة…
            </div>
          ) : query.isError ? (
            <div
              role="alert"
              data-testid="status-proof-graph-error"
              className="flex flex-wrap items-center justify-between gap-2 text-xs text-amber-100"
            >
              <span>تعذّر تحميل مخطط الإثبات. لم يتغير قرار القبول أو صلاحيات التنفيذ.</span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                data-testid={`button-retry-proof-graph-${executionId}`}
                onClick={() => void query.refetch()}
              >
                إعادة المحاولة
              </Button>
            </div>
          ) : query.data && !responseMatchesRequest ? (
            <div
              role="alert"
              data-testid="status-proof-graph-identity-mismatch"
              className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-100"
            >
              استجابة مخطط الإثبات لا تطابق هوية المشروع أو التنفيذ أو المحاولة المطلوبة؛ لم نعرضها.
            </div>
          ) : query.data ? (
            <GraphContents result={query.data} />
          ) : (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              لا توجد نتيجة للمخطط حتى الآن.
            </div>
          )}
        </div>
      )}
    </section>
  );
}
