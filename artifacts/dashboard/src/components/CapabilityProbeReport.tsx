import { AlertTriangle, CheckCircle2, CircleHelp, FileWarning, ShieldAlert } from 'lucide-react';
import {
  type CapabilityIncompleteReason,
  type CapabilityProbeReport as CapabilityProbeReportData,
  type CapabilityProbeTraceEntry,
  parseCapabilityProbeReport,
} from '@/lib/capability-probe-report';

const REASON_COPY: Record<CapabilityIncompleteReason, {
  label: string;
  description: string;
}> = {
  missing_reads: {
    label: 'Missing source reads',
    description: 'The named source bodies were not retained completely, so the report cannot be scored.',
  },
  citations: {
    label: 'Citations or claims incomplete',
    description: 'One or more capability claims did not close with an accepted source citation.',
  },
  runtime_conditions: {
    label: 'Runtime conditions not satisfied',
    description: 'Server-observed read or write conditions did not satisfy the probe contract.',
  },
  invalid_evidence_ids: {
    label: 'Invalid Evidence IDs',
    description: 'A cited Evidence ID did not resolve to retained evidence for this run.',
  },
  completion_gate: {
    label: 'Completion gate not satisfied',
    description: 'The server kept the result incomplete rather than presenting an unverified score.',
  },
};

function statusClasses(status: 'pass' | 'fail' | 'unknown'): string {
  switch (status) {
    case 'pass':
      return 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200';
    case 'fail':
      return 'border-red-400/30 bg-red-400/10 text-red-200';
    default:
      return 'border-border/60 bg-background/30 text-muted-foreground';
  }
}

function StatusIcon({ status }: { status: 'pass' | 'fail' | 'unknown' }) {
  if (status === 'pass') return <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />;
  if (status === 'fail') return <ShieldAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />;
  return <CircleHelp className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />;
}

export function CapabilityProbeReport({
  content,
  trace,
  report: suppliedReport,
}: {
  content: string;
  trace: readonly CapabilityProbeTraceEntry[];
  report?: CapabilityProbeReportData | null;
}) {
  const report = suppliedReport ?? parseCapabilityProbeReport(content, trace);
  if (!report) return null;

  return (
    <section
      aria-label="Capability probe report"
      className={`rounded-lg border p-3 ${
        report.complete
          ? 'border-emerald-400/30 bg-emerald-400/5'
          : 'border-amber-400/30 bg-amber-400/5'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          {report.complete
            ? <CheckCircle2 className="h-4 w-4 text-emerald-300" aria-hidden="true" />
            : <AlertTriangle className="h-4 w-4 text-amber-300" aria-hidden="true" />}
          <div>
            <h3 className="text-xs font-semibold text-foreground">Capability probe</h3>
            <p className="text-[10px] text-muted-foreground">
              {report.complete ? 'Server-verified C1–C7 report' : 'Incomplete — no unverified score shown'}
            </p>
          </div>
        </div>
        <div
          aria-label={report.complete ? `Capability probe score ${report.score} out of 7` : 'Capability probe score unavailable'}
          className={`rounded-md border px-2 py-1 text-right ${report.complete ? 'border-emerald-400/30 text-emerald-200' : 'border-amber-400/30 text-amber-200'}`}
        >
          <div className="text-[9px] uppercase tracking-wide text-muted-foreground">Score</div>
          <div className="text-sm font-semibold">{report.complete ? `${report.score}/7` : '—/7'}</div>
        </div>
      </div>

      <div className="mt-3 grid gap-1.5">
        {report.capabilities.map((capability) => (
          <div
            key={capability.id}
            className={`flex min-w-0 items-start gap-2 rounded border px-2 py-1.5 text-[11px] ${statusClasses(capability.status)}`}
          >
            <StatusIcon status={capability.status} />
            <span className="w-6 shrink-0 font-semibold">{capability.id}</span>
            <span className="min-w-0 whitespace-pre-wrap break-words">
              {capability.text
                ? capability.text.replace(/^\s*(?:[-*]\s*)?C[1-7]\s*[:—-]?\s*/i, '')
                : 'Not recorded'}
            </span>
          </div>
        ))}
      </div>

      {!report.complete && (
        <div className="mt-3 border-t border-amber-400/20 pt-2.5">
          <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-amber-200">
            <FileWarning className="h-3.5 w-3.5" aria-hidden="true" />
            Why this report is incomplete
          </div>
          <ul className="space-y-1.5">
            {report.incompleteReasons.map((reason) => (
              <li key={reason} className="text-[11px] text-amber-100/85">
                <span className="font-semibold">{REASON_COPY[reason].label}:</span>{' '}
                {REASON_COPY[reason].description}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
