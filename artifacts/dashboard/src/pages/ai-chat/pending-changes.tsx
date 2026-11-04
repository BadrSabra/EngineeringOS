import { useEffect, useState } from 'react';
import { Check, ChevronRight, FileCode2, GitMerge, Loader2, RotateCcw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { type LocalReviewBranchStatus } from '@workspace/api-client-react';
import type { PublicValidationResult } from '@workspace/ai-orchestrator';
import { CandidateValidationProof, type DeliveryLifecycle } from './delivery-proof';
import { type BehavioralVerification, type PendingChange, validationProfileLabel } from './provider-runtime';

export function PendingChangesCard({
  changes,
  verificationResults,
  validationEvidence,
  proposalId,
  operationId,
  projectRevision,
  changeSetHash,
  onApply,
  onCreateReviewBranch,
  onApproveMissionCandidate,
  onCreateApplyMission,
  onRebase,
  onReject,
  isPending,
  isReviewBranchPending,
  reviewBranch,
  reviewBranchError,
  isReviewBranchLoading,
  isApplyMissionPending,
  isRebasePending,
  approvalRequired,
  missionCandidate,
  missionCandidateAccepted,
  applyMissionReady,
  liveApplyPaused,
  lifecycle,
}: {
  changes: PendingChange[];
  verificationResults: Record<string, BehavioralVerification>;
  validationEvidence?: PublicValidationResult[] | null;
  proposalId?: string;
  operationId?: string | null;
  projectRevision?: string | null;
  changeSetHash?: string | null;
  onApply: (changes: PendingChange[]) => void;
  onCreateReviewBranch: () => void;
  onApproveMissionCandidate: () => void;
  onCreateApplyMission: () => void;
  onRebase: (changes: PendingChange[]) => void;
  onReject: () => void;
  isPending: boolean;
  isReviewBranchPending: boolean;
  reviewBranch?: LocalReviewBranchStatus;
  reviewBranchError?: string | null;
  isReviewBranchLoading: boolean;
  isApplyMissionPending: boolean;
  isRebasePending: boolean;
  approvalRequired: boolean;
  missionCandidate: boolean;
  missionCandidateAccepted: boolean;
  applyMissionReady: boolean;
  liveApplyPaused: boolean;
  lifecycle?: DeliveryLifecycle;
}) {
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [rejectedHunks, setRejectedHunks] = useState<Set<string>>(new Set());
  const hasPatchConflict = changes.some((change) => Boolean(verificationResults[change.path]?.conflict));

  useEffect(() => {
    // Hunk indexes are local to a proposal revision. A successful rebase
    // replaces the source and hunk list, so never carry old reject decisions
    // into the newly approved diff.
    setRejectedHunks(new Set());
  }, [changes]);

  function toggleExpand(p: string) {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p); else next.add(p);
      return next;
    });
  }

  function hunkKey(filePath: string, index: number) {
    return `${filePath}:${index}`;
  }

  function toggleHunk(filePath: string, index: number) {
    setRejectedHunks((prev) => {
      const next = new Set(prev);
      const key = hunkKey(filePath, index);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  // Build the effective change list honouring per-hunk accept/reject selections.
  // Files where every hunk is rejected are dropped from the apply payload;
  // files with a partial selection forward only the accepted hunks so the
  // server can use rebasePatchHunks to compute the partial result.
  const effectiveChanges = changes.flatMap((change) => {
    if (!change.hunks || change.hunks.length === 0) return [change];
    const accepted = change.hunks.filter((_, i) => !rejectedHunks.has(hunkKey(change.path, i)));
    if (accepted.length === 0) return [];
    if (accepted.length === change.hunks.length) return [change];
    return [{ ...change, hunks: accepted }];
  });

  const totalHunkCount = changes.reduce((s, c) => s + (c.hunks?.length ?? 0), 0);
  const rejectedCount = changes.reduce(
    (s, c) => s + (c.hunks?.filter((_, i) => rejectedHunks.has(hunkKey(c.path, i))).length ?? 0),
    0,
  );
  const acceptedHunkCount = totalHunkCount - rejectedCount;
  const hasPartialSelection = rejectedCount > 0 && totalHunkCount > 0;

  return (
    <div
      id="region-candidate-changes"
      tabIndex={-1}
      role="region"
      aria-label="التغييرات المقترحة والموافقة"
      className="max-w-3xl mx-auto mb-4"
    >
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 overflow-hidden">
        {/* Header */}
        <div dir="rtl" lang="ar" className="flex items-center gap-2 px-4 py-2.5 border-b border-amber-500/20 bg-amber-500/10">
          <FileCode2 className="w-4 h-4 text-amber-400 shrink-0" />
          <span className="text-sm font-medium text-amber-400">
            {changes.length} ملف ضمن التغييرات المقترحة
          </span>
           <span className="text-xs text-muted-foreground ml-auto">
             {lifecycle === 'conflicted'
               ? 'يوجد تعارض — راجعه قبل التطبيق'
               : lifecycle === 'blocked'
                 ? 'التطبيق محجوب — يلزم الاسترداد'
                 : lifecycle === 'isolated'
                   ? 'مساحة التغييرات المعزولة جاهزة للمراجعة'
                   : approvalRequired ? 'راجع الفروق المحدّثة ووافق عليها' : 'بانتظار موافقتك'}
           </span>
        </div>

        <CandidateValidationProof
          evidence={validationEvidence}
          operationId={operationId}
          projectRevision={projectRevision}
          changeSetHash={changeSetHash}
          lifecycle={lifecycle}
        />
        {liveApplyPaused && (
          <div
            className="mx-4 mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100"
            role="alert"
            data-testid="live-workspace-apply-paused"
          >
            <p className="font-medium">التطبيق المباشر متوقف مؤقتًا</p>
            <p className="mt-1 text-amber-100/80">
              بقي المرشح للمراجعة ولم تُعدّل مساحة العمل. يمكنك تجهيز فرع محلي معزول من SHA المصدر المسجل؛ هذا لا يعني Apply أو Commit أو قبول الإثبات.
            </p>
          </div>
        )}
        {reviewBranch?.outcome === 'REVIEW_BRANCH_READY' && reviewBranch.proposalId === proposalId && (
          <div
            className="mx-4 mt-3 rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs text-sky-100"
            role="status"
            data-testid="local-review-branch-ready"
          >
            <p className="font-medium">فرع مراجعة محلي فقط — لم يُطبّق ولم يُعتمد</p>
            <p className="mt-1">الفرع: <code dir="ltr">{reviewBranch.branchName}</code></p>
            <p className="mt-1 break-all">مساحة العمل: <code dir="ltr">{reviewBranch.worktreePath}</code></p>
            <p className="mt-1 break-all">SHA المصدر: <code dir="ltr">{reviewBranch.sourceGitCommitSha}</code></p>
          </div>
        )}
        {isReviewBranchLoading && (
          <p className="mx-4 mt-3 text-xs text-muted-foreground" role="status" data-testid="status-local-review-branch-loading">
            جارٍ التحقق من فرع المراجعة المحلي…
          </p>
        )}
        {reviewBranchError && (
          <div
            className="mx-4 mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100"
            role="alert"
            data-testid="status-local-review-branch-changed"
          >
            تعذّر إعادة التحقق من الفرع المحلي. لم تُستبدل أي تعديلات موجودة. {reviewBranchError}
          </div>
        )}

        {/* Changes list */}
        <div className="divide-y divide-border/40">
          {changes.map((change) => {
            const isNew = change.originalContent === null;
            const isExpanded = expandedPaths.has(change.path);
            const newLines = change.newContent.split('\n').length;
            const oldLines = change.originalContent ? change.originalContent.split('\n').length : 0;

            return (
              <div key={change.path} className="px-4 py-3">
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <code dir="ltr" className="text-xs font-mono text-foreground truncate max-w-[300px]">
                        {change.path}
                      </code>
                      {isNew ? (
                        <span className="text-xs px-1.5 py-0.5 rounded border border-green-500/30 text-green-400 bg-green-500/10">
                          ملف جديد
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          <bdi dir="ltr">{oldLines} → {newLines}</bdi> سطر
                        </span>
                      )}
                    </div>
                    <p dir="auto" className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                      {change.reason}
                    </p>
                    {change.validationProfile && (
                      <p className="text-[11px] text-cyan-300/80 mt-1">
                        Test: {validationProfileLabel(change.validationProfile)}
                      </p>
                    )}
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px]">
                      {change.risk && (
                        <span className={`rounded border px-1.5 py-0.5 ${
                          change.risk === 'high'
                            ? 'border-red-500/30 text-red-300 bg-red-500/10'
                            : change.risk === 'medium'
                              ? 'border-amber-500/30 text-amber-300 bg-amber-500/10'
                              : 'border-emerald-500/30 text-emerald-300 bg-emerald-500/10'
                        }`}>
                          Risk: {change.risk}
                        </span>
                      )}
                      {(change.evidence ?? []).map((evidence) => (
                        <span
                          key={`${evidence.kind}:${evidence.id}`}
                          className="rounded border border-violet-500/30 bg-violet-500/10 px-1.5 py-0.5 text-violet-200"
                          title={evidence.label}
                        >
                          {evidence.kind}: {evidence.id}
                        </span>
                      ))}
                    </div>
                    {verificationResults[change.path] && (
                      <div className={`mt-1.5 text-[11px] ${
                        verificationResults[change.path].status === 'failed' ||
                        verificationResults[change.path].status === 'unavailable'
                          ? 'text-red-400'
                          : verificationResults[change.path].status === 'passed'
                            ? 'text-green-400'
                            : 'text-amber-400'
                      }`}>
                        Behavioral verification: {verificationResults[change.path].status}
                        {verificationResults[change.path].detail
                          ? ` — ${verificationResults[change.path].detail}`
                          : ''}
                      </div>
                    )}
                    {verificationResults[change.path]?.conflict && (
                      <div className="mt-1.5 rounded border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-[11px] text-red-300">
                        Patch conflict: {verificationResults[change.path].conflict?.kind === 'hunk_mismatch'
                          ? `hunk ${((verificationResults[change.path].conflict?.hunkIndex ?? 0) + 1)} no longer matches`
                          : 'the file base changed since this patch was generated'}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => toggleExpand(change.path)}
                    className="flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground px-2 py-0.5 rounded border border-border/50 hover:border-border shrink-0 transition-colors"
                  >
                    <ChevronRight className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                     {isExpanded ? 'إخفاء الفروق' : 'عرض الفروق'}
                  </button>
                </div>

                {isExpanded && (
                  <div className="mt-2 space-y-2">
                    <div className="rounded-lg border border-sky-500/20 bg-sky-500/5 px-3 py-2 text-[11px] text-sky-200/80">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-sky-200">تفاصيل التعديل المقترح</span>
                        <span className="font-mono text-[9px] text-muted-foreground">
                          base {change.baseHash ? `${change.baseHash.slice(0, 12)}…` : 'legacy'}
                        </span>
                      </div>
                      <p className="mt-1">
                        يُفحص التعديل مقابل نسخة المصدر المحددة هذه قبل السماح بتطبيقه.
                      </p>
                    </div>
                    {change.hunks && change.hunks.length > 0 ? (
                      change.hunks.map((hunk, index) => (
                        <div key={`${change.path}-hunk-${index}`} className="rounded-lg border border-border/50 bg-black/30 p-3">
                          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[10px]">
                            <span className="font-medium text-foreground">
                              المقطع {index + 1}
                            </span>
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-muted-foreground">
                                lines {hunk.startLine}–{hunk.endLine}
                              </span>
                              <button
                                onClick={(e) => { e.stopPropagation(); toggleHunk(change.path, index); }}
                                aria-label={rejectedHunks.has(hunkKey(change.path, index)) ? 'مستبعد — اضغط لاختيار المقطع' : 'مختار — اضغط لاستبعاد المقطع'}
                                className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded border transition-colors text-[9px] font-medium ${
                                  rejectedHunks.has(hunkKey(change.path, index))
                                    ? 'border-red-500/40 text-red-300 bg-red-500/10 hover:bg-red-500/20'
                                    : 'border-emerald-500/40 text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20'
                                }`}
                              >
                                {rejectedHunks.has(hunkKey(change.path, index))
                                  ? <><X className="w-2.5 h-2.5" /> مستبعد</>
                                  : <><Check className="w-2.5 h-2.5" /> مختار للتطبيق</>
                                }
                              </button>
                            </div>
                          </div>
                          <p className="mb-2 text-[10px] text-muted-foreground">{hunk.reason}</p>
                            <div className="mb-2 flex flex-wrap items-center gap-1.5 text-[10px]">
                              {hunk.risk && (
                                <span className={`rounded border px-1.5 py-0.5 ${
                                  hunk.risk === 'high'
                                    ? 'border-red-500/30 text-red-300 bg-red-500/10'
                                    : hunk.risk === 'medium'
                                      ? 'border-amber-500/30 text-amber-300 bg-amber-500/10'
                                      : 'border-emerald-500/30 text-emerald-300 bg-emerald-500/10'
                                }`}>
                                  Risk: {hunk.risk}
                                </span>
                              )}
                              {(hunk.evidence ?? []).map((evidence) => (
                                <span
                                  key={`${evidence.kind}:${evidence.id}`}
                                  className="rounded border border-violet-500/20 bg-violet-500/5 px-1.5 py-0.5 text-violet-200/90"
                                  title={evidence.label}
                                >
                                  {evidence.kind === 'validation' ? 'Test' : 'Evidence'}: {evidence.label}
                                  {evidence.file ? ` (${evidence.file}${evidence.line ? `:${evidence.line}` : ''})` : ''}
                                </span>
                              ))}
                            </div>
                          <div className="grid gap-2 md:grid-cols-2">
                            <div className="min-w-0">
                              <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-red-300/80">المحتوى الحالي المتوقع</div>
                              <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded border border-red-500/20 bg-red-500/5 p-2 text-[10px] leading-relaxed text-foreground/80">
                                {hunk.expectedText || '(empty)'}
                              </pre>
                            </div>
                            <div className="min-w-0">
                              <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-emerald-300/80">المحتوى البديل المقترح</div>
                              <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded border border-emerald-500/20 bg-emerald-500/5 p-2 text-[10px] leading-relaxed text-foreground/80">
                                {hunk.replacementText || '(empty)'}
                              </pre>
                            </div>
                          </div>
                        </div>
                      ))
                    ) : (
                      <pre className="max-h-72 overflow-auto rounded-lg border border-border/40 bg-black/40 p-3 text-xs font-mono text-foreground/80 leading-relaxed">
                        {change.newContent}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Actions */}
        <div dir="rtl" lang="ar" className="flex flex-wrap gap-2 px-4 py-3 border-t border-amber-500/20">
          {missionCandidate ? (
            <Button
              size="sm"
              className="h-7 px-3 text-xs bg-amber-500 hover:bg-amber-600 text-black font-medium disabled:opacity-50"
              onClick={missionCandidateAccepted
                ? approvalRequired
                  ? onApproveMissionCandidate
                  : applyMissionReady
                    ? () => onApply(effectiveChanges)
                    : onCreateApplyMission
                : undefined}
              disabled={
                isPending
                || isApplyMissionPending
                || isRebasePending
                || effectiveChanges.length === 0
                || !missionCandidateAccepted
                || (liveApplyPaused && !approvalRequired)
              }
            >
              {isPending || isApplyMissionPending
                ? <Loader2 className="w-3 h-3 animate-spin mr-1.5" />
                : <Check className="w-3 h-3 mr-1.5" />}
              {!missionCandidateAccepted
                ? 'بانتظار قبول التنفيذ الأصلي'
                : approvalRequired
                  ? 'أوافق على المرشح بعد مراجعته'
                  : liveApplyPaused
                    ? 'مسار تطبيق المرشح غير متاح'
                    : applyMissionReady
                      ? `تطبيق المرشح المعتمد (${effectiveChanges.length} تغيير)`
                      : 'إنشاء هدف تطبيق وتسليم'}
            </Button>
          ) : (
            <Button
              size="sm"
              className="h-7 px-3 text-xs bg-amber-500 hover:bg-amber-600 text-black font-medium disabled:opacity-50"
              onClick={() => onApply(effectiveChanges)}
              disabled={liveApplyPaused || isPending || isRebasePending || effectiveChanges.length === 0}
            >
              {isPending
                ? <Loader2 className="w-3 h-3 animate-spin mr-1.5" />
                : <Check className="w-3 h-3 mr-1.5" />}
              {liveApplyPaused
                ? 'التطبيق المباشر متوقف مؤقتًا'
                : `${approvalRequired ? 'الموافقة وتطبيق' : 'تطبيق'} ${effectiveChanges.length} تغيير`}
              {hasPartialSelection ? ` (${acceptedHunkCount}/${totalHunkCount} مقطع)` : ''}
            </Button>
          )}
          {liveApplyPaused && proposalId && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-3 text-xs border-sky-500/40 text-sky-200 hover:bg-sky-500/10"
              onClick={onCreateReviewBranch}
              disabled={isReviewBranchPending || isReviewBranchLoading}
              data-testid="button-create-local-review-branch"
            >
              {isReviewBranchPending
                ? <Loader2 className="w-3 h-3 animate-spin mr-1.5" />
                : <GitMerge className="w-3 h-3 mr-1.5" />}
              {isReviewBranchPending ? 'جارٍ تجهيز الفرع المحلي…' : 'إنشاء فرع مراجعة محلي'}
            </Button>
          )}
          {hasPatchConflict && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-3 text-xs border-sky-500/40 text-sky-300 hover:bg-sky-500/10"
              onClick={() => onRebase(changes)}
              disabled={isPending || isRebasePending}
            >
              {isRebasePending
                ? <Loader2 className="w-3 h-3 animate-spin mr-1.5" />
                : <RotateCcw className="w-3 h-3 mr-1.5" />}
              مواءمة التعديل مع النسخة الحالية
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-3 text-xs text-muted-foreground hover:text-foreground"
            onClick={onReject}
            disabled={isPending}
          >
            <X className="w-3 h-3 mr-1" />
            رفض المقترح
          </Button>
        </div>
      </div>
    </div>
  );
}

export function VerifiedCommitCard({
  paths,
  message,
  onMessageChange,
  onCommit,
  isPending,
  liveApplyPaused,
}: {
  paths: string[];
  message: string;
  onMessageChange: (message: string) => void;
  onCommit: () => void;
  isPending: boolean;
  liveApplyPaused: boolean;
}) {
  return (
    <div className="max-w-3xl mx-auto mb-4">
      <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-emerald-500/20 bg-emerald-500/10">
          <GitMerge className="w-4 h-4 text-emerald-400 shrink-0" />
          <span lang="ar" className="text-sm font-medium text-emerald-400">
            {liveApplyPaused
              ? 'الفحوص مسجلة، لكن الاعتماد المحلي متوقف مؤقتًا'
              : 'التغييرات جاهزة للاعتماد في Git بحسب الفحوص المسجلة'}
          </span>
        </div>
        <div className="px-4 py-3">
          <p className="text-xs text-muted-foreground leading-relaxed">
            {liveApplyPaused
              ? `سُجلت أدلة سابقة لـ ${paths.length} ملف، لكن لا يمكن إنشاء اعتماد جديد من مساحة العمل المشتركة.`
              : `سُجّل نجاح التطبيق والتحقق السلوكي لـ ${paths.length} ملف. اعتماد التغييرات في Git إجراء يدوي منفصل، ولا يعني رفعها إلى المستودع البعيد.`}
          </p>
          {liveApplyPaused && (
            <p className="mt-2 text-xs text-amber-200">
              لم يُنشأ commit جديد. مسار فرع المراجعة من مصدر ثابت غير متاح بعد.
            </p>
          )}
          <p className="text-[11px] text-amber-300/80 mt-2">
            {liveApplyPaused
              ? 'لن تُضمّن تعديلات مساحة العمل المحلية ضمن commit جديد لهذا المرشح.'
              : 'تنبيه: إجراء Git الحالي يضم جميع تغييرات مساحة العمل، بما فيها تعديلاتك المحلية غير المرتبطة بهذا المقترح.'}
          </p>
          <Input
            value={message}
            onChange={(event) => onMessageChange(event.target.value)}
            placeholder="وصف اعتماد التغييرات في Git"
            aria-label="وصف اعتماد التغييرات في Git"
            dir="auto"
            className="mt-3 h-8 text-xs bg-secondary border-border"
            disabled={isPending || liveApplyPaused}
          />
        </div>
        <div className="flex px-4 py-3 border-t border-emerald-500/20">
          <Button
            size="sm"
            className="h-7 px-3 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-medium"
            onClick={onCommit}
            disabled={isPending || liveApplyPaused || !message.trim()}
          >
            {isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1.5" /> : <GitMerge className="w-3 h-3 mr-1.5" />}
            {liveApplyPaused ? 'الاعتماد المحلي متوقف مؤقتًا' : 'اعتماد التغييرات في Git'}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function PushCommitCard({
  onPush,
  isPending,
}: {
  onPush: () => void;
  isPending: boolean;
}) {
  return (
    <div className="max-w-3xl mx-auto mb-4">
      <div className="rounded-xl border border-sky-500/30 bg-sky-500/5 overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-sky-500/20 bg-sky-500/10">
          <GitMerge className="w-4 h-4 text-sky-400 shrink-0" />
          <span lang="ar" className="text-sm font-medium text-sky-400">تغييرات Git جاهزة للرفع إلى المستودع البعيد</span>
        </div>
        <div className="px-4 py-3">
          <p className="text-xs text-muted-foreground leading-relaxed">
            أُنشئ اعتماد Git بحسب السجل. رفعه إجراء يدوي منفصل، ويتطلب مستودعًا بعيدًا عبر HTTPS وصلاحية وصول إلى GitHub معدّة مسبقًا.
          </p>
        </div>
        <div className="flex px-4 py-3 border-t border-sky-500/20">
          <Button
            size="sm"
            className="h-7 px-3 text-xs bg-sky-600 hover:bg-sky-700 text-white font-medium"
            onClick={onPush}
            disabled={isPending}
          >
            {isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1.5" /> : <GitMerge className="w-3 h-3 mr-1.5" />}
            رفع تغييرات Git إلى المستودع البعيد
          </Button>
        </div>
      </div>
    </div>
  );
}
