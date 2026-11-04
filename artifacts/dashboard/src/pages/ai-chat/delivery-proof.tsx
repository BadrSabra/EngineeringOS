import { useState } from 'react';
import { AlertCircle, ChevronRight, FileSearch, Loader2, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { AiExecutionProjection, AiStreamBehaviorProgressEvent, AiTerminalProjection } from '@workspace/api-client-react';
import type { BrowserValidationBlockReason, PublicValidationResult } from '@workspace/ai-orchestrator';
import type { ChatMessage, OperationMode } from './types';
import type { AiTaskResult } from './session-state';

// ── PR-011: Source Coverage Panel ─────────────────────────────────────────────

type SourceCoveragePanelProps = {
  record: NonNullable<ChatMessage['sourceSelectionRecord']>;
};

const readStatusBadge: Record<
  NonNullable<ChatMessage['sourceSelectionRecord']>['fileStatuses'][number]['readStatus'],
  { label: string; className: string }
> = {
  READ_COMPLETE: { label: 'قراءة كاملة', className: 'border-emerald-500/40 text-emerald-300' },
  READ_TRUNCATED: { label: 'قراءة جزئية', className: 'border-amber-500/40 text-amber-300' },
  READ_FAILED: { label: 'تعذرت القراءة', className: 'border-red-500/40 text-red-300' },
  READ_SKIPPED: { label: 'لم يُقرأ', className: 'border-border/60 text-muted-foreground' },
};

const plannerTierInfo: Record<
  NonNullable<ChatMessage['sourceSelectionRecord']>['plannerTier'],
  { label: string; className: string }
> = {
  targeted: { label: 'بحث موجّه', className: 'border-sky-500/30 bg-sky-500/10 text-sky-300' },
  graph_enriched: { label: 'بحث يستعين بترابط الملفات', className: 'border-indigo-500/30 bg-indigo-500/10 text-indigo-300' },
  fallback: { label: 'خطة بحث بديلة', className: 'border-amber-500/30 bg-amber-500/10 text-amber-300' },
};

export function SourceCoveragePanel({ record }: SourceCoveragePanelProps) {
  const [expanded, setExpanded] = useState(false);

  const plannedStatuses = record.fileStatuses.filter((e) => e.origin === 'planned');
  const modelChosenStatuses = record.fileStatuses.filter((e) => e.origin === 'model_chosen');
  const tierInfo = plannerTierInfo[record.plannerTier] ?? { label: 'طريقة بحث غير معروفة', className: 'border-border/60 text-muted-foreground' };

  return (
    <div dir="rtl" lang="ar" className="mt-2 rounded-lg border border-border/40 bg-background/20 text-[11px]">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full flex-wrap items-center gap-1.5 px-3 py-2 text-start text-muted-foreground hover:text-foreground"
        aria-label="تفاصيل مصادر الإجابة"
        aria-expanded={expanded}
      >
        <ChevronRight className={`h-3 w-3 transition-transform ${expanded ? 'rotate-90' : ''}`} />
        <span className="flex-1 font-medium">مصادر الإجابة</span>
        <span className={`rounded border px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${tierInfo.className}`}>
          {tierInfo.label}
        </span>
        <span className="ms-1 text-muted-foreground">
          {record.plannedFiles.length > 0
            ? `الملفات المخططة: ${record.plannedFiles.length}`
            : 'لا توجد ملفات مخططة'}
        </span>
      </button>
      {expanded && (
        <div className="border-t border-border/40 px-3 py-2 space-y-2">
          <p className="text-muted-foreground">هذه تفاصيل اختيار المصادر وقراءتها؛ القراءة الكاملة لا تعني قبول كل ادعاء أو اكتمال التنفيذ.</p>
          {record.orientationCoverage && (
            <div
              className={`rounded border px-2 py-1 ${
                record.orientationCoverage.complete
                  ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-200'
                  : 'border-amber-500/30 bg-amber-500/5 text-amber-200'
              }`}
              data-testid="orientation-coverage"
            >
              <div className="font-semibold">
                تغطية التعرف على المشروع: {record.orientationCoverage.complete ? 'كاملة' : 'غير مكتملة'}
              </div>
              {record.orientationCoverage.missingRoles.length > 0 && (
                <div className="mt-0.5 text-[10px] text-amber-200">
                  أدوار المصادر الناقصة: <bdi dir="ltr">{record.orientationCoverage.missingRoles.join(', ')}</bdi>
                </div>
              )}
            </div>
          )}
          {record.plannedFiles.length === 0 && (
            <div className="rounded border border-amber-500/30 bg-amber-500/8 px-2 py-1 text-amber-300">
              لم تختر خطة البحث ملفات. استُخدمت طريقة بديلة لاكتشاف المصادر؛ راجع التغطية قبل الاعتماد على الإجابة.
            </div>
          )}
          {record.truncatedPlannedCount > 0 && (
            <div className="flex items-center gap-1.5 rounded border border-amber-500/30 bg-amber-500/8 px-2 py-1 text-amber-300">
              <AlertCircle className="h-3 w-3 shrink-0" />
              <span>
                ملفات مخططة قُرئت جزئيًا: {record.truncatedPlannedCount} — قد تعتمد الإجابة على تغطية جزئية للمصادر.
              </span>
            </div>
          )}
          {plannedStatuses.length > 0 && (
            <div className="space-y-1">
              <div className="text-[10px] font-semibold text-muted-foreground mb-1">ملفات خطة البحث</div>
              {plannedStatuses.map((entry) => {
                const badge = readStatusBadge[entry.readStatus] ?? { label: 'حالة قراءة غير معروفة', className: 'border-border/60 text-muted-foreground' };
                return (
                  <div key={entry.path} className="flex items-center gap-2 min-w-0">
                    <code dir="ltr" title={entry.path} className="min-w-0 flex-1 truncate font-mono text-[10px] text-foreground/80">{entry.path}</code>
                    <Badge title={entry.readStatus} variant="outline" className={`shrink-0 text-[9px] px-1 py-0 ${badge.className}`}>
                      {badge.label}
                    </Badge>
                  </div>
                );
              })}
            </div>
          )}
          {modelChosenStatuses.length > 0 && (
            <div className="space-y-1">
              <div className="text-[10px] font-semibold text-muted-foreground mb-1">المصادر الإضافية المختارة</div>
              {modelChosenStatuses.map((entry) => {
                const badge = readStatusBadge[entry.readStatus] ?? { label: 'حالة قراءة غير معروفة', className: 'border-border/60 text-muted-foreground' };
                return (
                  <div key={entry.path} className="flex items-center gap-2 min-w-0">
                    <code dir="ltr" title={entry.path} className="min-w-0 flex-1 truncate font-mono text-[10px] text-foreground/60">{entry.path}</code>
                    <Badge title={entry.readStatus} variant="outline" className={`shrink-0 text-[9px] px-1 py-0 ${badge.className}`}>
                      {badge.label}
                    </Badge>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export type DeliveryLifecycle =
  | 'proposed' | 'isolated' | 'validated' | 'applied' | 'conflicted'
  | 'committed' | 'cancelled' | 'abandoned' | 'blocked';

export type RecoverableDelivery = {
  proposalId: string;
  operationId: string;
  projectRevision?: string | null;
  changeSetHash?: string | null;
  sessionId: string;
  lifecycle: DeliveryLifecycle;
  status: string;
  createdAt: string;
  conflictReason?: string | null;
  recoveryState: 'recoverable' | 'missing_workspace' | 'discarded';
  operatorExplanation: string;
  nextAction: string;
  validationEvidence?: PublicValidationResult[] | null;
  promotionDecision?: 'AUTO_PROMOTE_ELIGIBLE' | 'REVIEW_REQUIRED' | 'BLOCKED';
  promotionReasons?: string[];
  workspaceAvailable: boolean;
  changeCount: number;
};

export function CandidateValidationProof({
  evidence,
  operationId,
  projectRevision,
  changeSetHash,
  lifecycle,
}: {
  evidence?: PublicValidationResult[] | null;
  operationId?: string | null;
  projectRevision?: string | null;
  changeSetHash?: string | null;
  lifecycle?: DeliveryLifecycle | null;
}) {
  const receipts = evidence?.filter((item) => item && item.evidence) ?? [];
  const hasEvidence = receipts.length > 0;
  const receipt = receipts[0];
  const displayedOperationId = operationId ?? receipt?.evidence.operationId;
  const displayedRevision = projectRevision ?? receipt?.evidence.projectRevision;
  const displayedChangeSetHash = changeSetHash ?? receipt?.evidence.changeSetHash;
  const isBlocked = lifecycle === 'blocked' || lifecycle === 'conflicted';
  const isPromoted = lifecycle === 'applied' || lifecycle === 'committed';
  const statusLabel = !hasEvidence
    ? 'Unavailable'
    : isBlocked
      ? 'Blocked'
      : isPromoted
        ? 'Promoted'
        : evidence?.every((item) => item.status === 'passed')
          ? 'Validated candidate'
          : 'Review required';
  const statusClass = statusLabel === 'Promoted' || statusLabel === 'Validated candidate'
    ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-200'
    : statusLabel === 'Blocked' || statusLabel === 'Review required'
      ? 'border-amber-500/30 bg-amber-500/5 text-amber-200'
      : 'border-border/60 bg-background/30 text-muted-foreground';

  return (
    <div className={`border-y px-4 py-3 ${statusClass}`} aria-label="Candidate validation proof">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 shrink-0" />
        <span className="text-xs font-semibold">Candidate validation receipt</span>
        <span className="ml-auto rounded-full border border-current/30 px-1.5 py-0.5 text-[10px] font-semibold">
          {statusLabel}
        </span>
      </div>
      <div className="mt-2 grid gap-1.5 text-[10px] sm:grid-cols-2">
        <div><span className="text-muted-foreground">Operation ID </span><code className="break-all">{displayedOperationId ?? 'Unavailable'}</code></div>
        <div><span className="text-muted-foreground">Project revision </span><code className="break-all">{displayedRevision ?? 'Unavailable'}</code></div>
        <div><span className="text-muted-foreground">Candidate hash </span><code className="break-all">{receipt?.evidence.candidateHash ?? 'Unavailable'}</code></div>
        <div><span className="text-muted-foreground">Changeset hash </span><code className="break-all">{displayedChangeSetHash ?? 'Unavailable'}</code></div>
      </div>
      {hasEvidence ? (
        <div className="mt-2 space-y-1 border-t border-current/10 pt-2">
          {receipts.map((item) => (
            <div key={item.evidence.evidenceId} className="space-y-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="font-medium">{item.profile}</span>
                <span className="text-muted-foreground">{item.terminalState ?? item.status}</span>
                <span className="text-muted-foreground">{item.scenario}</span>
                {item.evidence.promotedHash && <span className="text-emerald-300">promoted bytes verified</span>}
              </div>
              {(item.processBudgetMs !== undefined || item.overallBudgetMs !== undefined) && (
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-muted-foreground">
                  {item.processBudgetMs !== undefined && <span>process budget {formatValidationDuration(item.processBudgetMs)}</span>}
                  {item.overallBudgetMs !== undefined && <span>overall budget {formatValidationDuration(item.overallBudgetMs)}</span>}
                  {item.elapsedMs !== undefined && <span>elapsed {formatValidationDuration(item.elapsedMs)}</span>}
                  {item.remainingMs !== undefined && <span>remaining {formatValidationDuration(item.remainingMs)}</span>}
                </div>
              )}
              {item.nextAction && <div className="text-current/80">Next safe action: {item.nextAction}</div>}
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-2 border-t border-current/10 pt-2 text-[10px]">No public validation receipt is available for this candidate.</p>
      )}
    </div>
  );
}

export function formatValidationDuration(valueMs: number): string {
  if (valueMs < 1000) return `${valueMs} ms`;
  const seconds = valueMs / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)} s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

export function BehaviorProgressCard({
  progress,
}: {
  progress: AiStreamBehaviorProgressEvent;
}) {
  const phaseLabel = progress.phase === 'reading'
    ? 'Reading project evidence'
    : progress.phase === 'validating'
      ? 'Validating gathered evidence'
      : 'Preparing the evidence-based answer';
  const files = progress.completedReadFiles.slice(-6);

  return (
    <div
      className="rounded-md border border-primary/25 bg-primary/5 px-3 py-2 text-xs"
      role="status"
      aria-live="polite"
      aria-label="Behavior analysis progress"
    >
      <div className="flex items-center gap-2">
        <FileSearch className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
        <span className="font-medium">{phaseLabel}</span>
        <Loader2 className="ml-auto h-3.5 w-3.5 shrink-0 animate-spin text-primary" aria-hidden="true" />
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
        <span>{progress.readCount} read{progress.readCount === 1 ? '' : 's'}</span>
        {progress.evidenceCount !== undefined && (
          <span>{progress.acceptedEvidenceCount ?? 0}/{progress.evidenceCount} evidence accepted</span>
        )}
        {progress.acceptedClaimCount !== undefined && (
          <span>{progress.acceptedClaimCount} claim{progress.acceptedClaimCount === 1 ? '' : 's'} closed</span>
        )}
        <span>revision {progress.revision}</span>
      </div>
      {files.length > 0 && (
        <div className="mt-1.5 truncate font-mono text-[10px] text-muted-foreground" title={files.join(', ')}>
          Latest reads: {files.join(', ')}
        </div>
      )}
      <div className="mt-1 text-[10px] text-muted-foreground/80">
        Progress only — the verified answer appears after validation.
      </div>
    </div>
  );
}

export function browserValidationBlockExplanation(reasonCode: BrowserValidationBlockReason | undefined): {
  title: string;
  action: string;
} | null {
  switch (reasonCode) {
    case 'ownership':
      return {
        title: 'This browser check is not available for the selected project.',
        action: 'Choose a project you own or ask its owner to register the check.',
      };
    case 'invalid_profile':
      return {
        title: 'The browser check profile is not valid for this run.',
        action: 'Use the approved browser profile instead of retrying the same request.',
      };
    case 'resource_limit':
      return {
        title: 'The browser check exceeds the Preview resource limits.',
        action: 'Use a smaller approved check or update the profile before rerunning validation.',
      };
    case 'stale_revision':
      return {
        title: 'The browser check belongs to an older project revision.',
        action: 'Refresh the project and create a new approved validation run before retrying.',
      };
    default:
      return null;
  }
}

export function inferOperationMode(params: {
  operationMode?: unknown;
  taskResult?: AiTaskResult | null;
  proposalId?: string | null;
}): OperationMode | undefined {
  if (
    params.operationMode === 'FORENSIC_AUDIT'
    || params.operationMode === 'DELIVERY'
    || params.operationMode === 'CHAT'
  ) {
    return params.operationMode;
  }
  if (params.proposalId) return 'DELIVERY';
  if (params.taskResult?.kind === 'IMPLEMENTATION_PLAN_RESULT') return 'DELIVERY';
  if (
    params.taskResult?.kind === 'FORENSIC_REPORT_RESULT'
    || params.taskResult?.kind === 'WORKSPACE_REVIEW_RESULT'
    || params.taskResult?.kind === 'FINDING_RESULT'
    || params.taskResult?.kind === 'BEHAVIOR_ANSWER_RESULT'
    || params.taskResult?.kind === 'REPAIR_RESULT'
  ) {
    return 'FORENSIC_AUDIT';
  }
  return undefined;
}

export type ActiveExecution = {
  id: string;
  projectId: string;
  attempt?: number;
  sessionId?: string;
  linkedTaskId?: string | null;
  resumeToken?: string;
  resumable?: boolean;
  proofRequired?: boolean;
  operationMode?: OperationMode;
  message: string;
  buildPlanMessageId?: string;
  terminalProjection?: AiTerminalProjection | null;
  projection?: AiExecutionProjection | null;
};
