import { useState } from 'react';
import { ChevronRight, ShieldAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { AiCodeReview, AiScanAnalysis, AiStreamErrorEvent } from '@workspace/api-client-react';

/** Format a scan analysis result as a markdown chat message. */
export function formatScanAnalysis(data: AiScanAnalysis): string {
  const sev = (s: string) =>
    s === 'critical' ? '🔴' : s === 'high' ? '🟠' : s === 'medium' ? '🟡' : '🔵';
  const lines: string[] = [
    `## Scan Analysis\n`,
    `**${data.overallAssessment}**\n`,
    data.summary,
    '',
  ];
  if (data.insights?.length) {
    lines.push('### Key Insights');
    data.insights.forEach((ins) =>
      lines.push(`- ${sev(ins.severity)} **${ins.title}** — ${ins.recommendation}`),
    );
    lines.push('');
  }
  lines.push(`**Top Priority:** ${data.topPriority}`);
  lines.push(`**Estimated Impact:** ${data.estimatedImpact}`);
  return lines.join('\n');
}

/** Format a code review result as a markdown chat message. */
export function formatCodeReview(data: AiCodeReview): string {
  const verdictLabel =
    data.verdict === 'approved'
      ? '✅ Approved'
      : data.verdict === 'needs_changes'
        ? '⚠️ Needs Changes'
        : '🔴 Major Rework';
  const sev = (s: string) =>
    s === 'critical' ? '🔴' : s === 'high' ? '🟠' : s === 'medium' ? '🟡' : '🔵';
  const lines: string[] = [
    `## Code Review — ${data.overallScore}/100  ${verdictLabel}\n`,
    data.summary,
    '',
  ];
  if (data.strengths?.length) {
    lines.push('### Strengths');
    data.strengths.forEach((s) => lines.push(`- ${s}`));
    lines.push('');
  }
  if (data.issues?.length) {
    lines.push('### Issues');
    data.issues.slice(0, 5).forEach((issue) =>
      lines.push(
        `- ${sev(issue.severity)} **${issue.title}** (${issue.type}${issue.file ? `, \`${issue.file}\`` : ''}) — ${issue.suggestion}`,
      ),
    );
    lines.push('');
  }
  if (data.securityConcerns?.length) {
    lines.push('### Security Concerns');
    data.securityConcerns.forEach((s) => lines.push(`- ${s}`));
    lines.push('');
  }
  lines.push(`**Verdict:** ${data.verdict.replace('_', ' ')}`);
  return lines.join('\n');
}

export function CodeReviewScopeNotice({ review }: { review: AiCodeReview }) {
  const [expanded, setExpanded] = useState(false);
  const scope = review.reviewScope;
  if (!scope) return null;
  const selected = scope.selectedFiles;
  const partial =
    scope.scanCompleteness !== 'COMPLETE'
    || selected.omitted > 0
    || selected.clippedExcerpts > 0;
  const modeLabel = scope.mode === 'SELECTED_FILES'
    ? 'Selected source files + project evidence'
    : 'Graph and metrics evidence';
  return (
    <div
      className={`mt-2 w-full rounded-lg border px-3 py-2 ${
        partial ? 'border-amber-500/40 bg-amber-500/10' : 'border-primary/30 bg-primary/5'
      }`}
      role="note"
      aria-label="Code review scope"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <ShieldAlert className={`h-3.5 w-3.5 ${partial ? 'text-amber-300' : 'text-primary'}`} />
        <span className="text-[11px] font-medium text-foreground">Bounded review scope</span>
        <Badge variant="outline" className="text-[10px]">{modeLabel}</Badge>
        <Badge variant="outline" className="ml-auto text-[10px]">
          Project score: {review.overallScore}/100
        </Badge>
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-foreground/80">
        Approval means no issues were found in the reviewed evidence. It does not mean every repository file was inspected.
      </p>
      {partial && (
        <p className="mt-1 text-[11px] font-medium leading-relaxed text-amber-200">
          This review is partial: some supplied evidence was omitted, clipped, or came from an incomplete scan.
        </p>
      )}
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
        aria-expanded={expanded}
      >
        <ChevronRight className={`h-3 w-3 transition-transform ${expanded ? 'rotate-90' : ''}`} />
        Scope details
      </button>
      {expanded && (
        <div className="mt-1 border-t border-border/40 pt-2 text-[10px] leading-relaxed text-muted-foreground">
          <div>Selected files received: {selected.received}; included: {selected.included}; omitted: {selected.omitted}; clipped excerpts: {selected.clippedExcerpts}</div>
          <div>Graph entities: {scope.context.graphEntitiesIncluded}; relationships: {scope.context.graphRelationshipsIncluded}; metrics: {scope.context.metricsIncluded ? 'included' : 'not available'}; scan: {scope.scanCompleteness.toLowerCase()}</div>
          <div>Output verdict: {review.verdict.replace('_', ' ')}. This is separate from any output-quality acceptance gate.</div>
          <ul className="mt-1 list-disc pl-4">
            {scope.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

export function structuredTaskLabel(task: 'analyze' | 'review'): string {
  return task === 'analyze' ? 'scan analysis' : 'code review';
}

export function structuredTaskPrompt(task: 'analyze' | 'review'): string {
  return task === 'analyze'
    ? 'Analyze the latest scan results and suggest the top 3 improvements.'
    : 'Review the codebase and identify the most critical quality issues.';
}

export function parseStructuredFailureMetadata(toolTrace: string | null | undefined): {
  task: 'analyze' | 'review';
  failureKind?: AiStreamErrorEvent['failureKind'];
  retryable?: boolean;
} | undefined {
  if (!toolTrace) return undefined;
  try {
    const parsed: unknown = JSON.parse(toolTrace);
    if (!Array.isArray(parsed)) return undefined;
    const marker = parsed.find((entry) => (
      entry
      && typeof entry === 'object'
      && (entry as Record<string, unknown>).kind === 'structured_task_failure'
    )) as Record<string, unknown> | undefined;
    if (marker?.task !== 'analyze' && marker?.task !== 'review') return undefined;
    const failureKinds: AiStreamErrorEvent['failureKind'][] = [
      'PROVIDER_FORMAT', 'RATE_LIMIT', 'CONFIGURATION', 'PROVIDER_FAILURE', 'TRANSPORT',
    ];
    return {
      task: marker.task,
      failureKind: failureKinds.includes(marker.failureKind as AiStreamErrorEvent['failureKind'])
        ? marker.failureKind as AiStreamErrorEvent['failureKind']
        : undefined,
      retryable: typeof marker.retryable === 'boolean' ? marker.retryable : undefined,
    };
  } catch {
    return undefined;
  }
}

export function structuredFailurePresentation(
  task: 'analyze' | 'review',
  failureKind: AiStreamErrorEvent['failureKind'],
  retryable?: boolean,
): {
  title: string;
  description: string;
  retryable: boolean;
} {
  const name = structuredTaskLabel(task);
  const defaultRetryable = failureKind !== 'CONFIGURATION';
  const canRetry = retryable ?? defaultRetryable;

  switch (failureKind) {
    case 'PROVIDER_FORMAT':
      return {
        title: `${name[0].toUpperCase()}${name.slice(1)} incomplete`,
        description: `The ${name} response could not be verified, so no completed result was saved.`,
        retryable: canRetry,
      };
    case 'RATE_LIMIT':
      return {
        title: `${name[0].toUpperCase()}${name.slice(1)} paused`,
        description: `This ${name} reached a temporary usage limit. Wait a moment, then try again.`,
        retryable: canRetry,
      };
    case 'CONFIGURATION':
      return {
        title: `${name[0].toUpperCase()}${name.slice(1)} unavailable`,
        description: `This ${name} cannot run until the AI setup is updated. Fix the setup, then start a new ${name}.`,
        retryable: canRetry,
      };
    case 'TRANSPORT':
      return {
        title: `${name[0].toUpperCase()}${name.slice(1)} interrupted`,
        description: `The connection ended before the ${name} finished, so no completed result was saved.`,
        retryable: canRetry,
      };
    default:
      return {
        title: `${name[0].toUpperCase()}${name.slice(1)} incomplete`,
        description: `The ${name} could not finish. Try again in a moment.`,
        retryable: canRetry,
      };
  }
}
