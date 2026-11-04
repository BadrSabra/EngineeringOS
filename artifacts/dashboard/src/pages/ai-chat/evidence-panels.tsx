import { isValidElement, type ReactNode, useState } from 'react';
import { Check, CheckCircle2, Eye, FileCode2, FileSearch, ShieldAlert } from 'lucide-react';
import { getGetAiChatFileContentQueryKey, useGetAiChatFileContent } from '@workspace/api-client-react';
import { parseProjectQuerySourceReference } from '@/lib/project-query-source-reference';
import type { AiBehaviorEvidence } from '@workspace/api-client-react';
import { type ForensicEvidenceSummary, evidenceAnchor } from './trace-parsing';

/**
 * UI-01: Last-resort display guard.
 * If the backend somehow passes a JSON envelope such as
 * {"response":"...","sources":[...]} as message content, extract and show
 * only the inner `response` string so the user never sees raw JSON in a bubble.
 */
export function extractDisplayText(raw: string): string {
  if (!raw || !raw.trim().startsWith('{')) return raw;
  try {
    const parsed = JSON.parse(raw.trim());
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      typeof (parsed as Record<string, unknown>)['response'] === 'string'
    ) {
      return ((parsed as Record<string, unknown>)['response'] as string).trim() || raw;
    }
  } catch {
    // Not valid JSON — display as-is.
  }
  return raw;
}

export function isInternalTechnicalDump(content: string): boolean {
  const normalized = content.toLowerCase();
  return (
    (normalized.includes('aistreamdecisiontraceevent') && normalized.includes('decision_trace')) ||
    (normalized.includes('/home/runner/workspace') && normalized.includes('directory:')) ||
    (normalized.includes('validator:') && normalized.includes('recoveryattempt:') && normalized.includes('finalstate:'))
  );
}

/**
 * Behavior-evidence panel.
 * Shows each citation's safe outcome so analysts can tell exactly where proof
 * came from, or why an otherwise relevant citation stayed incomplete.
 * - Fragments with a verified line span show a copyable `file:start–end` anchor.
 * - Blocked citations expose only a stable, user-facing reason; provider
 *   prompts, diagnostics, and source-window metadata never reach this panel.
 */
export function BehaviorEvidencePanel({ evidence, projectId }: { evidence: AiBehaviorEvidence[]; projectId?: string }) {
  const [copied, setCopied] = useState<string | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  if (evidence.length === 0) return null;

  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      window.setTimeout(() => setCopied((c) => (c === key ? null : c)), 1200);
    } catch {
      // Clipboard unavailable — not fatal for the panel.
    }
  };

  return (
    <div className="mt-1 w-full rounded-lg border border-border/50 bg-background/30 px-3 py-2 flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <FileSearch className="w-3 h-3" />
          Behavior evidence · {evidence.length} {evidence.length === 1 ? 'excerpt' : 'excerpts'}
        </span>
      </div>
      {evidence.map((e, index) => {
        const { label, copy: copyText, hasSpan } = evidenceAnchor(e);
        const key = `${index}-${label}`;
        const isCopied = copied === key;
        const isViewing = viewing === key;
        // The generated client type can briefly lag the additive citation
        // fields carried by persisted behavior evidence.
        const citation = e as AiBehaviorEvidence & {
          citationStatus?: 'ACCEPTED' | 'BLOCKED';
          citationReason?:
            | 'MISSING_LITERAL_MATCH'
            | 'UNRESOLVED_SOURCE_SPAN'
            | 'INSUFFICIENT_BEHAVIORAL_CONTEXT'
            | 'ACCEPTED_SOURCE_SPAN';
        };
        const accepted = citation.citationStatus === 'ACCEPTED' || (citation.citationStatus === undefined && e.supportsClaim && hasSpan);
        const citationReason = citation.citationReason === 'MISSING_LITERAL_MATCH'
          ? 'Blocked: no matching source text was found.'
          : citation.citationReason === 'UNRESOLVED_SOURCE_SPAN'
            ? 'Blocked: the matching source span could not be resolved uniquely.'
            : citation.citationReason === 'INSUFFICIENT_BEHAVIORAL_CONTEXT'
              ? 'Blocked: the citation does not show enough behavior to prove the claim.'
              : accepted
                ? 'Accepted: source span verified.'
                : 'Blocked: source span could not be verified.';
        return (
          <div key={`${e.source}-${index}`} className="min-w-0">
            <div className="flex items-start gap-2 min-w-0">
              <div className="min-w-0 flex-1">
                <div className={`mb-0.5 flex items-center gap-1 text-[10px] font-medium ${accepted ? 'text-emerald-300' : 'text-amber-300'}`}>
                  {accepted ? <CheckCircle2 className="h-3 w-3" /> : <ShieldAlert className="h-3 w-3" />}
                  {citationReason}
                </div>
                <div className={`text-[11px] leading-5 break-words ${hasSpan ? 'text-foreground/90' : 'text-muted-foreground/70 italic'}`}>
                  {e.excerpt && e.excerpt.length > 160 ? `${e.excerpt.slice(0, 160)}…` : e.excerpt}
                </div>
                <div className="mt-0.5 inline-flex items-center gap-0.5">
                  <button
                    type="button"
                    title={hasSpan ? 'Copy file path and line' : 'Copy file path'}
                    onClick={() => copy(copyText, key)}
                    className={`inline-flex items-center gap-1 font-mono text-[10px] transition-colors ${
                      hasSpan
                        ? 'text-primary hover:underline'
                        : 'text-muted-foreground/60 hover:text-muted-foreground'
                    }`}
                  >
                    {hasSpan ? (
                      <><FileCode2 className="w-2.5 h-2.5" />{label}</>
                    ) : (
                      <><FileCode2 className="w-2.5 h-2.5" />{label}<span className="not-italic text-muted-foreground/50">(no span)</span></>
                    )}
                    <Check className={`w-2.5 h-2.5 ${isCopied ? 'text-emerald-400' : 'opacity-0'}`} />
                  </button>
                  {hasSpan && (
                    <button
                      type="button"
                      aria-expanded={isViewing}
                      title={isViewing ? 'Hide file context' : 'View exact source lines'}
                      onClick={() => setViewing(isViewing ? null : key)}
                      className={`inline-flex items-center gap-1 rounded px-1 py-0.5 font-mono text-[10px] transition-colors ${
                        isViewing
                          ? 'text-foreground bg-primary/15'
                          : 'text-muted-foreground/70 hover:text-foreground hover:bg-secondary'
                      }`}
                    >
                      <Eye className="w-2.5 h-2.5" />
                      {isViewing ? 'Hide source' : 'View file'}
                    </button>
                  )}
                </div>
              </div>
            </div>
            {hasSpan && isViewing && <EvidenceSourceLines evidence={e} projectId={projectId} />}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Loads real project-file lines for an evidence or navigation reference. The
 * file-content endpoint supplies true 1-indexed line numbers; this viewer does
 * not accept evidence or alter the assistant's terminal outcome.
 */
function EvidenceSourceLines({
  evidence,
  projectId,
  language = 'en',
}: {
  evidence: AiBehaviorEvidence;
  projectId?: string;
  language?: 'ar' | 'en';
}) {
  const span = evidence.sourceSpan;
  const canLoad = Boolean(projectId && span && evidence.source && Number.isFinite(span.startLine));
  // Request a window WIDER than the exact span (a few lines above and below)
  // so the analyst sees the function/branch around the proof and can scroll
  // beyond the excerpt within the same collapsed panel. The server clamps the
  // window to the file length and a 200-line bound, so this padding is safe
  // even for small files; the span lines are still highlighted client-side.
  const CONTEXT_BEFORE = 6;
  const CONTEXT_AFTER = 12;
  const startLine = span ? Math.max(1, span.startLine - CONTEXT_BEFORE) : 1;
  const endLine = span ? (span.endLine ?? span.startLine) + CONTEXT_AFTER : startLine;
  // MAY-GET: The query is enabled only when a project + span is present.
  const { data, isPending, isError } = useGetAiChatFileContent(
    {
      projectId: projectId ?? '',
      path: evidence.source,
      startLine,
      endLine,
    },
    {
      query: {
        queryKey: getGetAiChatFileContentQueryKey({
          projectId: projectId ?? '',
          path: evidence.source,
          startLine,
          endLine,
        }),
        enabled: canLoad,
        retry: false,
      },
    },
  );

  if (!span || !Number.isFinite(span.startLine)) return null;

  if (isPending) {
    return (
      <div className="mt-1.5 px-2 py-1 text-[10px] text-muted-foreground/70" lang={language} dir={language === 'ar' ? 'rtl' : undefined}>
        {language === 'ar' ? 'جارٍ تحميل أسطر المصدر…' : 'Loading source lines…'}
      </div>
    );
  }

  // File not readable/authorized — do not paint an old quote as current source
  // lines when the project-scoped read cannot verify the requested range.
  if (isError || !data?.available || !data.lines?.length) {
    const reason = data?.reason ? ` · ${data.reason}` : '';
    return (
      <div className="mt-1.5 rounded-md border border-border/40 bg-background/50 px-2 py-1.5" lang={language} dir={language === 'ar' ? 'rtl' : undefined}>
        <div className="text-[10px] text-muted-foreground/70 italic">
          {language === 'ar'
            ? `تعذّر عرض ملف المصدر${reason} — لم يمكن التحقق من موضع الأسطر.`
            : `Source file unavailable${reason} — source line numbers could not be verified.`}
        </div>
        {evidence.excerpt && (
          <pre className="mt-1 whitespace-pre-wrap break-words text-[10px] leading-5 text-muted-foreground/80">{evidence.excerpt}</pre>
        )}
      </div>
    );
  }

  const inSpan = (line: number) => line >= span.startLine && line <= span.endLine;
  return (
    <div className="mt-1.5 overflow-hidden rounded-md border border-border/40 bg-background/50" lang={language}>
      <pre className="max-h-48 overflow-auto px-0 py-1.5 text-[10px] leading-5" dir="ltr">
        {data.lines!.map((row) => {
          const inRange = inSpan(row.line);
          return (
            <div
              key={row.line}
              className={`flex px-2 ${inRange ? 'bg-primary/10 border-l-2 border-primary' : 'border-l-2 border-transparent'}`}
            >
              <span className="w-8 shrink-0 select-none pr-2 text-right font-mono text-muted-foreground/60">
                {row.line}
              </span>
              <code className={`min-w-0 flex-1 whitespace-pre-wrap break-words font-mono ${inRange ? 'text-foreground/90' : 'text-muted-foreground/70'}`}>
                {row.text || ' '}
              </code>
            </div>
          );
        })}
      </pre>
      {data.truncated && (
        <div className="border-t border-border/40 px-2 py-1 text-[10px] text-muted-foreground/60">
          {language === 'ar'
            ? `↕ عُرض جزء محدود من الملف (عدد الأسطر: ${data.fileLines ?? '؟'})`
            : `↕ window truncated (file has ${data.fileLines ?? '?'} lines)`}
        </div>
      )}
    </div>
  );
}

function markdownNodeText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(markdownNodeText).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return markdownNodeText(node.props.children);
  }
  return '';
}

export function ProjectQuerySourceHeading({
  children,
  projectId,
}: {
  children: ReactNode;
  projectId?: string;
}) {
  const [isViewing, setViewing] = useState(false);
  const headingText = markdownNodeText(children);
  const reference = parseProjectQuerySourceReference(headingText);
  const isArabic = /[\u0600-\u06ff]/u.test(headingText);

  if (!reference) {
    return <h4 className="text-sm font-semibold mb-1">{children}</h4>;
  }

  const referenceId = encodeURIComponent(
    `${reference.path}:${reference.startLine}-${reference.endLine}`,
  ).replace(/%/g, '_');
  const panelId = `project-query-source-${referenceId}`;
  const referenceEvidence: AiBehaviorEvidence = {
    source: reference.path,
    sourceSpan: {
      startLine: reference.startLine,
      endLine: reference.endLine,
    },
    supportsClaim: false,
  };
  const toggleLabel = isArabic
    ? isViewing ? 'إخفاء الأسطر' : 'عرض أسطر المصدر'
    : isViewing ? 'Hide source' : 'View source lines';

  return (
    <div className="mb-2 min-w-0">
      <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
        <h4 className="min-w-0 flex-1 break-words text-sm font-semibold">{children}</h4>
        <button
          type="button"
          data-testid={`button-view-project-query-source-${referenceId}`}
          aria-expanded={isViewing}
          aria-controls={panelId}
          title={isArabic
            ? projectId
              ? 'عرض الملف الحالي عند هذا النطاق؛ لا يغيّر ذلك حالة قبول الإجابة.'
              : 'اختر مشروعاً لعرض الملف.'
            : projectId
              ? 'View the current project file at this range; this does not accept the answer.'
              : 'Select a project to view the file.'}
          disabled={!projectId}
          onClick={() => setViewing((open) => !open)}
          className="mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-md border border-border/50 px-2 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Eye className="h-3 w-3" />
          {toggleLabel}
        </button>
      </div>
      <div id={panelId} className="mt-1.5" hidden={!isViewing} aria-live="polite">
        {isViewing && projectId && (
          <>
            <p className="text-[10px] text-muted-foreground/70" lang={isArabic ? 'ar' : 'en'} dir={isArabic ? 'rtl' : undefined}>
              {isArabic
                ? 'هذه أسطر الملف الحالي؛ قد يكون المشروع تغيّر منذ الإجابة. عرضها لا يثبت اكتمال الإجابة ولا يغيّر قرار القبول.'
                : 'These are the current file lines; the project may have changed since the answer. Viewing them does not complete the answer or change acceptance.'}
            </p>
            <EvidenceSourceLines
              evidence={referenceEvidence}
              projectId={projectId}
              language={isArabic ? 'ar' : 'en'}
            />
          </>
        )}
      </div>
    </div>
  );
}

/** Extract the answer shape from the BEHAVIOR_ANSWER_RESULT payload. */
export function behaviorAnswerView(answer: Record<string, unknown> | undefined) {
  const text = typeof answer?.answer === 'string' ? answer.answer : '';
  const confidence =
    typeof answer?.confidence === 'number' ? answer.confidence : undefined;
  const scope = Array.isArray(answer?.sourceScope)
    ? answer.sourceScope.filter((s): s is string => typeof s === 'string')
    : [];
  const coverage = answer?.coverage && typeof answer.coverage === 'object'
    ? (answer.coverage as Record<string, unknown>)
    : undefined;
  const evidence = Array.isArray(answer?.evidence)
    ? (answer.evidence as Array<Record<string, unknown>>)
        .filter((e): e is AiBehaviorEvidence => Boolean(e && typeof e.source === 'string'))
    : [];
  const answeredFields = Array.isArray(coverage?.answeredFields)
    ? coverage.answeredFields.filter((s): s is string => typeof s === 'string')
    : [];
  const missingFields = Array.isArray(coverage?.missingFields)
    ? coverage.missingFields.filter((s): s is string => typeof s === 'string')
    : [];
  return { text, confidence, scope, answeredFields, missingFields, evidence };
}

/** Extract the finding shape from the FINDING_RESULT payload. */
export function findingView(finding: Record<string, unknown> | undefined) {
  const text = typeof finding?.finding === 'string' ? finding.finding : '';
  const severity = typeof finding?.severity === 'string' ? finding.severity : 'NOT_PROVEN';
  const evidence = Array.isArray(finding?.evidence)
    ? (finding.evidence as Array<Record<string, unknown>>)
        .filter((e): e is AiBehaviorEvidence => Boolean(e && typeof e.source === 'string'))
    : [];
  return { text, severity, evidence };
}

export const FINDING_SEVERITY_STYLES: Record<string, string> = {
  CRITICAL: 'border-red-500/50 bg-red-500/15 text-red-300',
  HIGH: 'border-red-500/50 bg-red-500/15 text-red-300',
  MEDIUM: 'border-amber-500/50 bg-amber-500/15 text-amber-300',
  LOW: 'border-slate-500/50 bg-slate-500/15 text-slate-300',
  NOT_PROVEN: 'border-slate-500/50 bg-slate-500/10 text-muted-foreground',
};

export const READINESS_STYLES: Record<string, string> = {
  READY: 'border-green-500/50 bg-green-500/15 text-green-300',
  BLOCKED: 'border-red-500/50 bg-red-500/15 text-red-300',
  NOT_PROVEN: 'border-slate-500/50 bg-slate-500/10 text-muted-foreground',
};

/** FEG-017: human-readable explanation for a NOT_PROVEN forensic terminal. */
export const FORENSIC_TERMINAL_TEXT: Record<
  NonNullable<ForensicEvidenceSummary['forensicStatus']>['terminalKind'] extends infer K ? (K extends undefined ? never : K) : never,
  string
> = {
  INVESTIGATION_NOT_STARTED:
    'Investigation never started — no source read was ever acquired, so no evidence could be gathered. This is not a "no evidence found" verdict.',
  INVESTIGATION_BUDGET_EXHAUSTED:
    'Investigation started and read evidence, but the iteration / soft-limit budget ran out before a verdict was reached.',
  NO_EVIDENCE_FOUND:
    'Investigation ran to a normal end but retained no source evidence that substantiates a defect claim.',
  EVIDENCE_AVAILABLE_BUT_CLAIM_UNCLOSED:
    'Source evidence was retained, but no required claim was closed with a grounded source excerpt. An evidence inventory alone is not a completed answer.',
  NO_RESPONSE_RECOVERY_BLOCKED:
    'Source collection reached an empty provider response, but bounded forensic recovery did not produce an accepted report. The run is blocked without calling it budget exhaustion.',
};

/** EI-036: human-readable Repair Scope Gate reason for the audit panel. */
export const REPAIR_BLOCK_REASON_TEXT: Record<string, string> = {
  REPAIR_BLOCKED_SCOPE_NOT_PRODUCTION:
    'Repair blocked: finding proven only from fixture/test evidence — not proven in production code. Gather production source evidence before approving any repair.',
  REPAIR_BLOCKED_SCOPE_NOT_PROVEN:
    'Repair blocked: finding is not proven, so it cannot be gated to production scope.',
  REPAIR_BLOCKED_MIXED_EVIDENCE:
    'Repair blocked: finding rests on mixed production and fixture/test evidence. Establish a production-scope proof before approving any repair.',
};
