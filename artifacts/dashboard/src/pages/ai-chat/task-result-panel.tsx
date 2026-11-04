import { useState } from 'react';
import { Check, CheckCircle2, ChevronRight, Code2, FileSearch, GitMerge, Loader2, Play, ShieldAlert, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { getListBrowserValidationProfilesQueryKey, useListBrowserValidationProfiles } from '@workspace/api-client-react';
import { createMissionFromChat, type MissionPlanPreviewResult, previewMissionPlanFromChat } from '@/lib/ai-missions';
import type { AiBehaviorEvidence } from '@workspace/api-client-react';
import type { BrowserValidationProfileFreshness, ChatMessage } from './types';
import { type AiTaskResult, hasSafeImplementationPlanFileScope } from './session-state';
import { redactInternalDetails } from './provider-runtime';
import { BehaviorEvidencePanel, FINDING_SEVERITY_STYLES, READINESS_STYLES, behaviorAnswerView, extractDisplayText, findingView } from './evidence-panels';

/**
 * AI-008: render the per-task typed result as a structured panel instead of a
 * single prose wall. Dispatches on `taskResult.kind`. Generic chat turns
 * continue to fall back to plain prose; forensic reports remain visible as
 * the primary result even when their verdict is incomplete.
 */
export type PlanDecision = 'approve' | 'reject';

export function TaskResultPanel({
  result,
  projectId,
  messageId,
  onPlanDecision,
  planDecisionPending,
  onPlanBuild,
  planBuildPending,
  browserProfileFreshness,
}: {
  result: AiTaskResult | null | undefined;
  projectId?: string;
  messageId?: string;
  onPlanDecision?: (messageId: string, decision: PlanDecision) => void;
  planDecisionPending?: boolean;
  onPlanBuild?: (messageId: string) => void;
  planBuildPending?: boolean;
  browserProfileFreshness?: BrowserValidationProfileFreshness | null;
}) {
  const [reportExpanded, setReportExpanded] = useState(false);
  const [planDetailsExpanded, setPlanDetailsExpanded] = useState(false);
  const browserProfileName = result?.kind === 'IMPLEMENTATION_PLAN_RESULT'
    ? result.browserValidationProfile
    : undefined;
  const { data: browserProfileData } = useListBrowserValidationProfiles(projectId ?? '', {
    query: {
      enabled: Boolean(projectId && browserProfileName),
      queryKey: getListBrowserValidationProfilesQueryKey(projectId ?? ''),
      staleTime: 15_000,
    },
  });
  const resolvedBrowserProfileFreshness = browserProfileFreshness
    ?? (Array.isArray(browserProfileData)
      ? browserProfileData.find((profile) => profile.name === browserProfileName) ?? null
      : null);
  if (!result) return null;

  switch (result.kind) {
    case 'CODE_EXTRACTION_RESULT': {
      return (
        <div className="mt-1 w-full rounded-lg border border-border/50 bg-background/30 px-3 py-2">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-1.5">
            <Code2 className="w-3 h-3" />
            <span>Extracted code</span>
            {result.source && <code className="ml-auto truncate text-[10px] font-mono">{result.source}</code>}
          </div>
          <pre className="rounded border border-border/40 bg-black/25 p-2.5 text-[11px] font-mono text-foreground/90 overflow-x-auto leading-relaxed">{result.extractedCode}</pre>
        </div>
      );
    }
    case 'PROJECT_QUERY_INVESTIGATION_RESULT': {
      const statusLabel = result.status.replaceAll('_', ' ').toLowerCase();
      const statusClass = result.status === 'ANSWER_COMPLETE'
        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
        : result.status === 'ANSWER_BLOCKED'
          ? 'border-rose-500/30 bg-rose-500/10 text-rose-200'
          : result.status === 'ANSWER_PARTIAL'
            ? 'border-amber-500/30 bg-amber-500/10 text-amber-200'
            : 'border-sky-500/30 bg-sky-500/10 text-sky-200';
      const reasonText: Record<string, string> = {
        NO_ACCEPTED_OBSERVATION: 'No complete source read was accepted.',
        INCOMPLETE_OBSERVATION: 'The available source read was incomplete.',
        EMPTY_ANSWER: 'Complete source evidence was found, but no answer was produced.',
        ANSWER_UNCERTAIN: 'The source evidence did not support a definite answer.',
        ANSWER_PARTIAL: 'The source evidence supports only part of the answer.',
        SCOPE_UNAVAILABLE: 'A verified source scope was not available.',
        IDENTITY_MISMATCH: 'The result did not match the active investigation.',
      };
      return (
        <div
          className="mt-1 w-full rounded-lg border border-border/50 bg-background/30 px-3 py-2 flex flex-col gap-2"
          role="status"
          aria-label="Fact investigation result"
          data-testid="project-query-investigation-result"
        >
          <div className="flex flex-wrap items-center gap-1.5">
            <FileSearch className="h-3.5 w-3.5 text-primary" />
            <span className="text-[11px] font-medium text-foreground">Fact investigation</span>
            <Badge
              variant="outline"
              className={`text-[10px] ${statusClass}`}
              data-testid="project-query-investigation-status"
            >
              {statusLabel}
            </Badge>
            <span className="ml-auto text-[10px] text-muted-foreground">
              Investigation only · not canonical proof
            </span>
          </div>
          {result.answer && (
            <p className="text-[12px] leading-relaxed text-foreground/90 break-words">
              {result.answer}
            </p>
          )}
          {!result.answer && result.reasonCode && (
            <p className="text-[11px] text-muted-foreground">
              {reasonText[result.reasonCode] ?? 'The investigation did not produce a supported answer.'}
            </p>
          )}
          <div className="text-[10px] text-muted-foreground">
            Required question: {result.requiredCoverage.status.toLowerCase()}
            <span className="mx-1.5">·</span>
            Assessment: {result.answerAssessment.replaceAll('_', ' ').toLowerCase()}
          </div>
          {result.sources.length > 0 ? (
            <div className="flex flex-col gap-1" aria-label="Observed source files">
              {result.sources.map((source) => (
                <div
                  key={source.observationId}
                  className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground"
                >
                  <code className="font-mono text-foreground/80">{source.path}</code>
                  {source.lineStart !== undefined && (
                    <span>
                      {source.lineEnd !== undefined && source.lineEnd !== source.lineStart
                        ? `L${source.lineStart}–L${source.lineEnd}`
                        : `L${source.lineStart}`}
                    </span>
                  )}
                  <span className="ml-auto">complete read</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[10px] text-muted-foreground">No complete source reads were retained.</p>
          )}
        </div>
      );
    }
    case 'BEHAVIOR_ANSWER_RESULT': {
      const answer = behaviorAnswerView(result.answer);
      const hasCoverage = answer.answeredFields.length > 0 || answer.missingFields.length > 0;
      return (
        <div className="mt-1 w-full rounded-lg border border-border/50 bg-background/30 px-3 py-2 flex flex-col gap-2">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <FileSearch className="w-3 h-3" />
            <span>Behavior answer</span>
            {typeof answer.confidence === 'number' && (
              <span className="ml-auto rounded border border-border/40 px-1.5 py-0.5 text-[10px]">
                confidence {(answer.confidence * 100).toFixed(0)}%
              </span>
            )}
          </div>
          {answer.text && (
            <p className="text-[12px] leading-relaxed text-foreground/90">{answer.text}</p>
          )}
          {answer.scope.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {answer.scope.map((s) => (
                <Badge key={s} variant="outline" className="text-[10px] font-mono text-muted-foreground">{s}</Badge>
              ))}
            </div>
          )}
          {hasCoverage && (
            <div className="text-[10px] text-muted-foreground">
              Answered fields: {answer.answeredFields.length ? answer.answeredFields.join(', ') : '—'}
              {answer.missingFields.length > 0 && (
                <> · Missing: {answer.missingFields.join(', ')}</>
              )}
            </div>
          )}
          <BehaviorEvidencePanel evidence={answer.evidence} projectId={projectId} />
        </div>
      );
    }
    case 'FINDING_RESULT': {
      const finding = findingView(result.finding);
      if (!finding.text) return null;
      const style = FINDING_SEVERITY_STYLES[finding.severity] ?? FINDING_SEVERITY_STYLES.NOT_PROVEN;
      return (
        <div className="mt-1 w-full rounded-lg border border-border/50 bg-background/30 px-3 py-2 flex flex-col gap-2">
          <div className="flex items-center gap-1.5">
            <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-primary" />
            <span className="text-[11px] font-medium text-foreground">Finding</span>
            <span className={`ml-auto rounded border px-1.5 py-0.5 text-[10px] ${style}`}>{finding.severity}</span>
          </div>
          <p className="text-[12px] leading-relaxed text-foreground/90 break-words">{finding.text}</p>
          <BehaviorEvidencePanel evidence={finding.evidence} projectId={projectId} />
        </div>
      );
    }
    case 'FORENSIC_REPORT_RESULT':
    case 'WORKSPACE_REVIEW_RESULT': {
       if (!result.report) {
         return (
           <div
             className="mt-1 w-full rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200"
             role="status"
             aria-label="Forensic report incomplete"
           >
             ANALYSIS_INCOMPLETE — the forensic report contained no user-facing report body.
             Start a new bounded audit; no forensic verdict was proven.
           </div>
         );
       }
      const evidence = Array.isArray(result.evidence)
        ? result.evidence.filter((e): e is AiBehaviorEvidence => Boolean(e && typeof e.source === 'string'))
        : [];
      return (
        <div className="mt-1 w-full rounded-lg border border-border/50 bg-background/30 px-3 py-2 flex flex-col gap-2">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <ShieldCheck className="w-3 h-3" />
            <span>{result.kind === 'WORKSPACE_REVIEW_RESULT' ? 'Workspace review' : 'Forensic report'}</span>
            {evidence.length > 0 && <span className="ml-auto">{evidence.length} evidence item{evidence.length === 1 ? '' : 's'}</span>}
          </div>
          <p className="text-[12px] leading-relaxed text-foreground/90 whitespace-pre-wrap break-words">{result.report}</p>
          {evidence.length > 0 && (
            <div className="rounded border border-border/40 overflow-hidden">
              <button
                type="button"
                onClick={() => setReportExpanded((expanded) => !expanded)}
                className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-[11px] text-muted-foreground hover:bg-background/40 transition-colors"
                aria-expanded={reportExpanded}
              >
                <ChevronRight className={`w-3 h-3 transition-transform ${reportExpanded ? 'rotate-90' : ''}`} />
                Evidence
              </button>
              {reportExpanded && (
                <div className="border-t border-border/40">
                  <BehaviorEvidencePanel evidence={evidence} projectId={projectId} />
                </div>
              )}
            </div>
          )}
        </div>
      );
    }
    case 'REPAIR_RESULT': {
      const phases = Array.isArray(result.phases) ? result.phases : [];
      const readiness = result.readiness ?? 'NOT_PROVEN';
      const readinessStyle = READINESS_STYLES[readiness] ?? READINESS_STYLES.NOT_PROVEN;
      return (
        <div className="mt-1 w-full rounded-lg border border-border/50 bg-background/30 px-3 py-2 flex flex-col gap-2">
          <div className="flex items-center gap-1.5">
            <GitMerge className="h-3.5 w-3.5 shrink-0 text-primary" />
            <span className="text-[11px] font-medium text-foreground">Repair plan</span>
            <span className={`ml-auto rounded border px-1.5 py-0.5 text-[10px] ${readinessStyle}`}>{readiness}</span>
          </div>
          <p className="text-[10px] text-muted-foreground">
            Plan readiness only; current execution acceptance and completion are not established here.
          </p>
          {phases.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">No repair phases were warranted.</p>
          ) : (
            <ol className="flex flex-col gap-1.5">
              {phases.map((phase, index) => {
                const findingId = typeof phase?.findingId === 'string' ? phase.findingId : undefined;
                const files = Array.isArray(phase?.files)
                  ? phase.files.filter((f): f is string => typeof f === 'string')
                  : [];
                const steps = Array.isArray(phase?.steps)
                  ? phase.steps.filter((s): s is string => typeof s === 'string')
                  : [];
                return (
                  <li key={findingId ?? index} className="rounded border border-border/40 bg-background/25 px-2.5 py-2">
                    <div className="flex items-center gap-2">
                      <span className="rounded border border-border/40 px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">{index + 1}</span>
                      {findingId && <code className="text-[10px] font-mono text-foreground/90">{findingId}</code>}
                    </div>
                    {files.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {files.map((file) => (
                          <code key={file} className="text-[10px] font-mono text-muted-foreground">{file}</code>
                        ))}
                      </div>
                    )}
                    {steps.length > 0 && (
                      <ul className="mt-1 list-disc pl-4 text-[11px] text-foreground/80">
                        {steps.map((step) => (
                          <li key={step} className="leading-relaxed">{step}</li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      );
    }
    case 'IMPLEMENTATION_PLAN_RESULT': {
      const steps = Array.isArray(result.steps) ? result.steps : [];
      const assumptions = Array.isArray(result.assumptions)
        ? result.assumptions.filter((item): item is string => typeof item === 'string')
        : [];
      const validationCommands = Array.isArray(result.validationCommands)
        ? result.validationCommands.filter((item): item is string => typeof item === 'string')
        : [];
      const hasPlanDetails = assumptions.length > 0 || validationCommands.length > 0 ||
        typeof result.browserValidationProfile === 'string' ||
        steps.some((step) => {
          if (!step || typeof step !== 'object') return false;
          return (Array.isArray(step.files) && step.files.length > 0) ||
            (Array.isArray(step.validation) && step.validation.length > 0);
        });
      const hasVerifiedFileScope = hasSafeImplementationPlanFileScope(result);
      const approvalBlocked = result.approvalStatus === 'PENDING_APPROVAL' && !hasVerifiedFileScope;
      const statusLabel =
        result.approvalStatus === 'APPROVED'
          ? 'موافَق عليها لبدء التنفيذ'
          : result.approvalStatus === 'REJECTED'
            ? 'مرفوضة'
            : approvalBlocked
              ? 'يلزم نطاق ملفات متحقق منه'
              : 'بانتظار الموافقة';
      const statusStyle =
        result.approvalStatus === 'APPROVED'
          ? 'border-green-500/50 bg-green-500/10 text-green-300'
          : result.approvalStatus === 'REJECTED'
            ? 'border-red-500/50 bg-red-500/10 text-red-300'
            : approvalBlocked
              ? 'border-amber-500/50 bg-amber-500/10 text-amber-200'
              : '';
      return (
        <div dir="rtl" lang="ar" className="mt-1 w-full rounded-lg border border-primary/30 bg-primary/5 px-3 py-3 flex flex-col gap-2.5">
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-primary" />
            <span className="text-xs font-medium text-foreground">خطة التنفيذ</span>
            <Badge variant="outline" className={`ml-auto shrink-0 text-[10px] ${statusStyle}`}>{statusLabel}</Badge>
          </div>
          <p dir="auto" className="text-sm font-medium leading-snug text-foreground/95">{result.objective}</p>
          <p dir="auto" className="text-xs leading-relaxed text-foreground/80">{result.summary}</p>
          <ol className="flex flex-col gap-2">
            {steps.map((rawStep, index) => {
              const step = rawStep && typeof rawStep === 'object' ? rawStep : {};
              const title = typeof step.title === 'string' ? step.title : `الخطوة ${index + 1}`;
              const description = typeof step.description === 'string' ? step.description : '';
              const files = Array.isArray(step.files)
                ? step.files.filter((file): file is string => typeof file === 'string')
                : [];
              const validation = Array.isArray(step.validation)
                ? step.validation.filter((item): item is string => typeof item === 'string')
                : [];
              return (
                <li key={typeof step.id === 'string' ? step.id : index} className="rounded border border-border/40 bg-background/25 px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="rounded border border-border/40 px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">{index + 1}</span>
                    <span dir="auto" className="min-w-0 text-xs font-medium leading-snug">{title}</span>
                  </div>
                  {description && <p dir="auto" className="mt-1.5 text-xs leading-relaxed text-foreground/80">{description}</p>}
                  {planDetailsExpanded && (
                    <div className="mt-2 flex flex-col gap-1.5 border-t border-border/30 pt-2">
                      {files.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {files.map((file) => <code dir="ltr" key={file} className="max-w-full break-all text-[10px] font-mono text-muted-foreground">{file}</code>)}
                        </div>
                      )}
                      {validation.length > 0 && (
                          <div className="text-[10px] leading-relaxed text-muted-foreground">التحقق: <bdi dir="auto">{validation.join('; ')}</bdi></div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
          {result.risks.length > 0 && (
            <div className="text-[10px] leading-relaxed text-muted-foreground">المخاطر: <bdi dir="auto">{result.risks.join(' · ')}</bdi></div>
          )}
          {hasPlanDetails && (
            <button
              type="button"
              onClick={() => setPlanDetailsExpanded((expanded) => !expanded)}
              className="flex w-full items-center gap-1.5 border-t border-border/30 pt-2 text-left text-[11px] text-muted-foreground hover:text-foreground"
              aria-expanded={planDetailsExpanded}
            >
              <ChevronRight className={`h-3 w-3 transition-transform ${planDetailsExpanded ? 'rotate-90' : ''}`} />
               الملفات والتحقق والافتراضات
            </button>
          )}
          {planDetailsExpanded && assumptions.length > 0 && (
            <div className="rounded border border-border/30 bg-background/20 px-2.5 py-2 text-[10px] leading-relaxed text-muted-foreground">
              <span className="font-medium text-foreground/80">الافتراضات:</span> <bdi dir="auto">{assumptions.join(' · ')}</bdi>
            </div>
          )}
          {planDetailsExpanded && validationCommands.length > 0 && (
            <div className="rounded border border-border/30 bg-background/20 px-2.5 py-2 text-[10px] leading-relaxed text-muted-foreground">
              <span className="font-medium text-foreground/80">أوامر التحقق المقترحة:</span> <bdi dir="ltr">{validationCommands.join(' · ')}</bdi>
            </div>
          )}
          {planDetailsExpanded && typeof result.browserValidationProfile === 'string' && (
            <div className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground/80">فحص المتصفح:</span> <bdi dir="ltr">{result.browserValidationProfile}</bdi>
              {resolvedBrowserProfileFreshness && (
                <span className={`ml-2 ${resolvedBrowserProfileFreshness.freshnessStatus === 'fresh' ? 'text-emerald-400' : 'text-amber-300'}`}>
                   · {resolvedBrowserProfileFreshness.freshnessStatus === 'fresh' ? 'مرتبط بالنسخة الحالية' : 'غير متاح: مرتبط بنسخة قديمة'}
                </span>
              )}
            </div>
          )}
          {result.approvalStatus === 'PENDING_APPROVAL' && approvalBlocked ? (
            <div className="border-t border-border/40 pt-2 text-[10px] leading-relaxed text-amber-200/90">
              <span className="font-medium text-amber-100">الموافقة غير متاحة.</span>{' '}
              لا تملك الخطة نطاق ملفات متحققًا منه. أعد إعدادها بعد تحديد ملفات المصدر ذات الصلة؛ لا يُسمح ببدء التنفيذ أو الكتابة من هذه الخطة.
            </div>
          ) : result.approvalStatus === 'PENDING_APPROVAL' && messageId && onPlanDecision ? (
            <div className="flex flex-wrap items-center gap-2 border-t border-border/40 pt-2">
              <span className="mr-auto text-[10px] text-muted-foreground">لم تتغير الملفات. الموافقة تجهّز خطوة التنفيذ التالية فقط.</span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={planDecisionPending}
                onClick={() => onPlanDecision(messageId, 'reject')}
                className="h-7 px-2 text-[11px] text-red-300 hover:text-red-200"
              >
                رفض الخطة
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={planDecisionPending || (
                  Boolean(result.browserValidationProfile) &&
                  resolvedBrowserProfileFreshness?.freshnessStatus !== 'fresh'
                )}
                onClick={() => onPlanDecision(messageId, 'approve')}
                className="h-7 px-2 text-[11px]"
              >
                {planDecisionPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Check className="mr-1 h-3 w-3" />}
                الموافقة على الخطة
              </Button>
              {result.browserValidationProfile && resolvedBrowserProfileFreshness?.freshnessStatus !== 'fresh' && (
                <span className="basis-full text-[10px] text-amber-300">
                  حدّث المشروع وسجّل فحص المتصفح مجددًا قبل الموافقة على هذه الخطة.
                </span>
              )}
            </div>
          ) : result.approvalStatus === 'APPROVED' && messageId && onPlanBuild ? (
            <div className="flex flex-wrap items-center gap-2 border-t border-border/40 pt-2">
              <span className="mr-auto text-[10px] text-muted-foreground">الخطة موافَق عليها للتنفيذ. تبقى التغييرات فروقًا قابلة للمراجعة حتى تطبّقها صراحةً.</span>
              <Button
                type="button"
                size="sm"
                disabled={planBuildPending || (
                  Boolean(result.browserValidationProfile) &&
                  resolvedBrowserProfileFreshness?.freshnessStatus !== 'fresh'
                )}
                onClick={() => onPlanBuild(messageId)}
                className="h-7 px-2 text-[11px]"
              >
                {planBuildPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Play className="mr-1 h-3 w-3" />}
                بدء التنفيذ وفق الخطة
              </Button>
              {result.browserValidationProfile && resolvedBrowserProfileFreshness?.freshnessStatus !== 'fresh' && (
                <span className="basis-full text-[10px] text-amber-300">
                  حدّث المشروع وسجّل فحص المتصفح مجددًا قبل بدء تنفيذ هذه الخطة.
                </span>
              )}
            </div>
          ) : (
            <div className="text-[10px] text-muted-foreground">
              {result.approvalStatus === 'APPROVED'
                ? 'الخطة موافَق عليها لخطوة التنفيذ التالية. لم تتغير الملفات.'
                : result.approvalStatus === 'REJECTED'
                  ? 'رُفضت الخطة. لم تتغير الملفات.'
                  : 'لم تتغير الملفات. وافق على الخطة قبل بدء تنفيذها.'}
            </div>
          )}
        </div>
      );
    }
    default:
      return null;
  }
}

const DEFAULT_ACCEPTED_FINDING_OBJECTIVE = 'Investigate and fix the accepted finding.';

export function AcceptedProjectQueryMissionAction({
  msg,
  projectId,
  onHandoffComplete,
}: {
  msg: ChatMessage;
  projectId: string;
  onHandoffComplete: (mission: { id: string; title: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [objective, setObjective] = useState(DEFAULT_ACCEPTED_FINDING_OBJECTIVE);
  const [preview, setPreview] = useState<MissionPlanPreviewResult | null>(null);
  const [previewPending, setPreviewPending] = useState(false);
  const [handoffPending, setHandoffPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadPreview() {
    if (!objective.trim()) {
      setError('Enter an objective before previewing the plan.');
      return;
    }
    setPreviewPending(true);
    setPreview(null);
    setError(null);
    try {
      const result = await previewMissionPlanFromChat({
        projectId,
        assistantMessageId: msg.id,
        objective: objective.trim(),
      });
      setPreview(result);
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : 'The plan preview could not be loaded.');
    } finally {
      setPreviewPending(false);
    }
  }

  async function confirmHandoff() {
    if (!preview || preview.admission !== 'mission') return;
    setHandoffPending(true);
    setError(null);
    try {
      const result = await createMissionFromChat({
        projectId,
        idempotencyKey: crypto.randomUUID(),
        assistantMessageId: msg.id,
        objective: objective.trim(),
        expectedPlanHash: preview.plan.planHash,
      });
      onHandoffComplete(result.mission);
      setOpen(false);
      setPreview(null);
    } catch (handoffError) {
      setError(handoffError instanceof Error ? handoffError.message : 'The accepted finding could not be handed off.');
    } finally {
      setHandoffPending(false);
    }
  }

  const acceptedFindingText = redactInternalDetails(extractDisplayText(msg.content));

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-7 px-2 text-[11px]"
        onClick={() => {
          setObjective(DEFAULT_ACCEPTED_FINDING_OBJECTIVE);
          setPreview(null);
          setError(null);
          setOpen(true);
        }}
        data-testid={`button-mission-finding-preview-${msg.id}`}
      >
        <FileSearch className="mr-1 h-3 w-3" />
        Review Mission plan
      </Button>
      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (previewPending || handoffPending) return;
          setOpen(nextOpen);
          if (!nextOpen) {
            setPreview(null);
            setError(null);
          }
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Turn accepted finding into a Mission</DialogTitle>
            <DialogDescription>
              Review the finding, objective, and planned steps. The accepted evidence is context only; the Mission must verify against the current project before any change.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <section className="rounded-lg border border-border/60 bg-muted/20 p-3">
              <div className="mb-1 text-xs font-medium text-muted-foreground">Accepted project finding</div>
              <div className="max-h-36 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed">
                {acceptedFindingText}
              </div>
            </section>
            <div className="space-y-2">
              <label htmlFor={`mission-finding-objective-${msg.id}`} className="text-sm font-medium">
                Mission objective
              </label>
              <Textarea
                id={`mission-finding-objective-${msg.id}`}
                value={objective}
                maxLength={2_000}
                onChange={(event) => {
                  setObjective(event.target.value);
                  setPreview(null);
                  setError(null);
                }}
                className="min-h-20 resize-y"
              />
              <p className="text-xs text-muted-foreground">
                The accepted finding is included as context only, not as proof or authorization. Previewing is read-only; creating the Mission keeps existing approval and validation gates.
              </p>
            </div>
            {preview && (
              <section
                className="space-y-2 rounded-lg border border-border/60 p-3"
                data-testid={`mission-finding-plan-${msg.id}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-medium">Plan preview</div>
                  <span className="text-[11px] text-muted-foreground">
                    {preview.plan.steps.length} planned steps · {preview.admission}
                  </span>
                </div>
                {preview.handoffSource && (
                  <p className="text-xs text-muted-foreground">
                    Bound to accepted evidence at revision {preview.handoffSource.sourceRevision.slice(0, 12)} · {preview.handoffSource.acceptedClaimCount} accepted claims
                  </p>
                )}
                {preview.admission !== 'mission' && (
                  <p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-100">
                    {preview.admissionReason}
                  </p>
                )}
                <ol className="space-y-2">
                  {preview.plan.steps.map((step, index) => (
                    <li key={step.id} className="rounded-md bg-muted/30 p-2">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-mono text-muted-foreground">{index + 1}.</span>
                        <span className="font-medium">{step.title}</span>
                        <span className="rounded border border-border/60 px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                          {step.kind}
                        </span>
                      </div>
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        {step.readOnly ? 'Read-only' : 'May change project files'}
                        {step.approvalRequired ? ' · approval required' : ''}
                        {step.dependencies.length > 0 ? ` · depends on ${step.dependencies.join(', ')}` : ''}
                      </div>
                      {step.files.length > 0 && (
                        <div className="mt-1 break-all font-mono text-[10px] text-muted-foreground/80">
                          {step.files.slice(0, 4).join(', ')}
                          {step.files.length > 4 ? `, +${step.files.length - 4} more` : ''}
                        </div>
                      )}
                    </li>
                  ))}
                </ol>
              </section>
            )}
            {error && (
              <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
                {error}
              </p>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={previewPending || handoffPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => void loadPreview()}
              disabled={previewPending || handoffPending}
            >
              {previewPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {previewPending ? 'Building preview…' : preview ? 'Refresh preview' : 'Preview plan'}
            </Button>
            <Button
              type="button"
              onClick={() => void confirmHandoff()}
              disabled={
                !preview
                || preview.admission !== 'mission'
                || previewPending
                || handoffPending
              }
            >
              {handoffPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {handoffPending ? 'Starting Mission…' : 'Confirm and start Mission'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
