export const CAPABILITY_LABELS = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7'] as const;

export type CapabilityLabel = (typeof CAPABILITY_LABELS)[number];
export type CapabilityStatus = 'pass' | 'fail' | 'unknown';
export type CapabilityIncompleteReason =
  | 'missing_reads'
  | 'citations'
  | 'runtime_conditions'
  | 'invalid_evidence_ids'
  | 'completion_gate';

export type CapabilityProbeTraceEntry = {
  kind?: string;
  code?: string;
  diagnosticCode?: string;
  diagnosticCodes?: string[];
  details?: string[];
  diagnosticDetails?: string[];
  violations?: string[];
  sourceCoverage?: 'COMPLETE' | 'PARTIAL' | 'NONE';
  completeReads?: boolean;
  completedReadFiles?: string[];
  retainedBodyFiles?: string[];
  evidenceSourceCoverage?: {
    status?: 'COMPLETE' | 'PARTIAL' | 'NONE';
  };
};

export type CapabilityProbeReport = {
  isProbe: boolean;
  complete: boolean;
  score: number | null;
  progress?: {
    closedClaims: CapabilityLabel[];
    pendingClaims: CapabilityLabel[];
    completedGroups: string[];
    failedGroups: string[];
  };
  capabilities: Array<{
    id: CapabilityLabel;
    status: CapabilityStatus;
    text: string | null;
  }>;
  incompleteReasons: CapabilityIncompleteReason[];
};

function capabilityProgress(
  trace: readonly CapabilityProbeTraceEntry[],
): CapabilityProbeReport['progress'] {
  const entries = trace.filter((candidate) =>
    candidate.code === 'CAPABILITY_PROBE_PARTIAL_PROGRESS',
  );
  if (entries.length === 0) return undefined;
  const detail = (prefix: string): string[] =>
    [...new Set(entries.flatMap((entry) =>
      (entry.details ?? [])
        .filter((value) => value.startsWith(prefix))
        .flatMap((value) => value.slice(prefix.length).split(','))
        .map((value) => value.trim())
        .filter(Boolean),
    ))];
  const validClaims = (values: string[]): CapabilityLabel[] =>
    values.filter((value): value is CapabilityLabel =>
      CAPABILITY_LABELS.includes(value as CapabilityLabel),
    );
  const statusMatches = entries.flatMap((entry) =>
    (entry.details ?? [])
      .filter((value) => value.startsWith('micro-probe '))
      .map((value) => value.match(/^micro-probe\s+([^:]+):\s+(completed|failed)$/))
      .filter((match): match is RegExpMatchArray => Boolean(match)),
  );
  const completedGroups = detail('completed groups:');
  const failedGroups = [
    ...detail('failed groups:'),
    ...statusMatches
      .filter((match) => match[2] === 'failed')
      .map((match) => match[1]!.trim()),
  ];
  const closedClaims = validClaims(detail('closed claims:'));
  const explicitPendingClaims = validClaims(detail('pending claims:'));
  const pendingClaims = explicitPendingClaims.length > 0
    ? explicitPendingClaims
    : CAPABILITY_LABELS.filter((label) => !closedClaims.includes(label));
  if (
    closedClaims.length === 0 &&
    pendingClaims.length === 0 &&
    completedGroups.length === 0 &&
    failedGroups.length === 0
  ) return undefined;
  return {
    closedClaims,
    pendingClaims,
    completedGroups,
    failedGroups,
  };
}

function textValues(trace: readonly CapabilityProbeTraceEntry[]): string[] {
  return trace.flatMap((entry) => [
    entry.code,
    entry.diagnosticCode,
    ...(entry.diagnosticCodes ?? []),
    ...(entry.details ?? []),
    ...(entry.diagnosticDetails ?? []),
    ...(entry.violations ?? []),
  ].filter((value): value is string => typeof value === 'string'));
}

function hasLabel(line: string, label: CapabilityLabel): boolean {
  return new RegExp(`^\\s*(?:#{1,6}\\s*)?(?:[-*]\\s*)?${label}\\b`, 'i').test(line);
}

function isMarkdownCapabilityHeading(line: string): boolean {
  return /^\s*#{1,6}\s*(?:[-*]\s*)?C[1-7]\b/i.test(line);
}

function lineFor(lines: string[], label: CapabilityLabel): string | null {
  const startIndex = lines.findIndex((line) => hasLabel(line, label));
  if (startIndex < 0) return null;

  const startLine = lines[startIndex];
  if (!isMarkdownCapabilityHeading(startLine)) return startLine;

  const nextHeadingIndex = lines.findIndex(
    (line, index) => index > startIndex && isMarkdownCapabilityHeading(line),
  );
  return lines
    .slice(startIndex, nextHeadingIndex < 0 ? lines.length : nextHeadingIndex)
    .join('\n')
    .trim();
}

function hasIncompleteSignal(content: string, values: readonly string[]): boolean {
  return /\bANALYSIS_INCOMPLETE\b/i.test(content)
    || values.some((value) => /CAPABILITY_PROBE/i.test(value));
}

function classifyIncompleteReasons(
  content: string,
  trace: readonly CapabilityProbeTraceEntry[],
  lines: readonly (string | null)[],
): CapabilityIncompleteReason[] {
  const values = textValues(trace);
  const allText = [content, ...values].join('\n');
  const reasons: CapabilityIncompleteReason[] = [];
  const hasIncompleteReads = trace.some((entry) =>
    entry.completeReads === false
    || entry.sourceCoverage === 'PARTIAL'
    || entry.sourceCoverage === 'NONE'
    || entry.evidenceSourceCoverage?.status === 'PARTIAL'
    || entry.evidenceSourceCoverage?.status === 'NONE'
    || (entry.kind === 'evidence_integrity'
      && (entry.retainedBodyFiles?.length ?? entry.completedReadFiles?.length ?? 0) < 2),
  );

  if (
    hasIncompleteReads
    || /CAPABILITY_PROBE_RECOVERY_SKIPPED_INCOMPLETE|did not retain complete source bodies|missing source read|source coverage/i.test(allText)
  ) {
    reasons.push('missing_reads');
  }

  if (
    /invalid\s+evidence(?:\s+id|id)|evidence[_\s-]?id[^.\n]*(?:invalid|missing|resolve|record)|resolve to no records|EI-005/i.test(allText)
  ) {
    reasons.push('invalid_evidence_ids');
  }

  if (
    /citation|claim[_\s-]?unclosed|source fragment|exact source|CAPABILITY_PROBE_EVIDENCE_RECOVERY_(?:REJECTED|PARSE_FAILED|FAILED)/i.test(allText)
  ) {
    reasons.push('citations');
  }

  if (
    /runtime|server[-\s]observed|pending write|no pending write|C2 does not|C5 does not|write[-\s]abstention|CAPABILITY_PROBE_RUNTIME/i.test(allText)
  ) {
    reasons.push('runtime_conditions');
  }

  if (reasons.length === 0 && (hasIncompleteSignal(content, values) || lines.some((line) => line === null))) {
    reasons.push('completion_gate');
  }

  return reasons;
}

export function parseCapabilityProbeReport(
  content: string | null | undefined,
  trace: readonly CapabilityProbeTraceEntry[] = [],
): CapabilityProbeReport | null {
  const response = typeof content === 'string' ? content : '';
  const lines = response.split(/\r?\n/);
  const capabilityLines = CAPABILITY_LABELS.map((label) => lineFor(lines, label));
  const values = textValues(trace);
  const hasProbeTrace = values.some((value) => /CAPABILITY_PROBE/i.test(value));
  const hasCapabilityShape = capabilityLines.some(Boolean) && (
    /\b(?:overall\s+)?score\b/i.test(response)
    || /\bcapabilities?\s+demonstrated\b/i.test(response)
  );
  const isProbe = hasProbeTrace
    || hasCapabilityShape
    || /\bANALYSIS_INCOMPLETE\b[\s\S]*\bcapability probe\b/i.test(response);

  if (!isProbe) return null;

  const capabilities = CAPABILITY_LABELS.map((id, index) => {
    const text = capabilityLines[index];
    const status: CapabilityStatus = text
      ? (/\bPASS\b/i.test(text) ? 'pass' : /\bFAIL\b/i.test(text) ? 'fail' : 'unknown')
      : 'unknown';
    return {
      id,
      text,
      status,
    };
  });
  const score = capabilities.reduce(
    (total, capability) => total + (capability.status === 'pass' ? 1 : 0),
    0,
  );
  const incomplete = /\bANALYSIS_INCOMPLETE\b/i.test(response)
    || capabilities.some((capability) => capability.status !== 'pass')
    || !capabilityLines.every(Boolean);
  const progress = capabilityProgress(trace);

  return {
    isProbe: true,
    complete: !incomplete,
    score: incomplete ? null : score,
    ...(progress ? { progress } : {}),
    capabilities,
    incompleteReasons: incomplete
      ? classifyIncompleteReasons(response, trace, capabilityLines)
      : [],
  };
}
