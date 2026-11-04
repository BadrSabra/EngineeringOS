import { useState } from 'react';
import { Activity, CheckCircle2, ChevronRight, FileSearch, GitMerge, RotateCcw, ShieldAlert, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { AiBehaviorEvidence } from '@workspace/api-client-react';
import { type FinalForensicVerdict, type ForensicEvidenceSummary, evidenceAnchor, forensicRejectionReason, formatStopReason } from './trace-parsing';
import { FORENSIC_TERMINAL_TEXT, REPAIR_BLOCK_REASON_TEXT } from './evidence-panels';

export function ForensicEvidenceCard({
  evidence,
  defaultExpanded,
  finalVerdict,
  claimEvidence,
}: {
  evidence: ForensicEvidenceSummary;
  defaultExpanded: boolean;
  finalVerdict: FinalForensicVerdict | null;
  /** NI-35: claim-bound behavioral evidence (accepted excerpts with exact spans). */
  claimEvidence?: AiBehaviorEvidence[];
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const uniqueFiles = evidence.evidenceIntegrity
    ? Math.max(evidence.evidenceIntegrity.uniqueFilesRead, evidence.reads.length)
    : evidence.reads.length;
  const hasEvidence = evidence.completedReads > 0;
  const historicalVerdict =
    evidence.diagnosticCodes.some((code) => code.includes('STRUCTURED_RECOVERY_ACCEPTED')) ||
    evidence.diagnosticCodes.some((code) => code.includes('FORENSIC_DETERMINISTIC_FINDING'))
      ? 'FINDING PROVEN'
      : evidence.diagnosticCodes.some((code) => code.includes('FORENSIC_NO_FINDING'))
        ? 'NO FINDING'
        : 'NOT PROVEN';
  const diagnostic = evidence.forensicDiagnostic;
  const fallbackVerdict = finalVerdict ?? historicalVerdict;
  const diagnosticVerdict = diagnostic?.verdict === 'NO_VERIFIED_FINDING'
    ? 'NO_VERIFIED_FINDING'
    : diagnostic?.verdict === 'ANALYSIS_INCOMPLETE'
      ? 'ANALYSIS_INCOMPLETE'
      : diagnostic?.verdict === 'FINDING_PROVEN'
        ? 'FINDING_PROVEN'
        : fallbackVerdict;
  const verdict = diagnostic ? diagnosticVerdict : fallbackVerdict;

  // Normalize fixture-local from either the boolean or the enum field so that
  // auditScope-only traces (written by the incoming-main branch) are treated
  // consistently with isFixtureLocal-only traces (written by this task).
  const isFixtureLocal =
    evidence.forensicStatus?.isFixtureLocal === true ||
    evidence.forensicStatus?.auditScope === 'FIXTURE_LOCAL';

  return (
    <div className={`mt-2 rounded-lg overflow-hidden text-[11px] ${
      isFixtureLocal
        ? 'border border-violet-500/30 bg-violet-500/5'
        : 'border border-amber-500/25 bg-amber-500/5'
    }`}>
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors ${
          isFixtureLocal ? 'hover:bg-violet-500/10' : 'hover:bg-amber-500/10'
        }`}
        aria-expanded={expanded}
      >
        <ShieldAlert className={`w-3.5 h-3.5 shrink-0 ${isFixtureLocal ? 'text-violet-300' : 'text-amber-300'}`} />
        <span className={`font-medium ${isFixtureLocal ? 'text-violet-200' : 'text-amber-200'}`}>
          Forensic evidence
        </span>
          {evidence.auditScopeDescription && (
            <span className="hidden min-w-0 truncate text-[10px] text-muted-foreground sm:inline">
              · {evidence.auditScopeDescription}
            </span>
          )}
        {isFixtureLocal && (
          <span className="rounded-full border border-violet-500/50 bg-violet-500/15 px-1.5 py-0.5 text-[10px] text-violet-200 font-semibold">
            FIXTURE-LOCAL
          </span>
        )}
        <span className={`ml-auto rounded-full border px-1.5 py-0.5 text-[10px] ${
          isFixtureLocal
            ? 'border-violet-500/30 text-violet-200'
            : 'border-amber-500/30 text-amber-200'
        }`}>
          {verdict === 'NOT PROVEN' && evidence.diagnosticCodes.some((code) => code.includes('SKIPPED_NO_EVIDENCE'))
            ? 'NO EVIDENCE'
            : verdict}
        </span>
        <ChevronRight className={`w-3 h-3 text-muted-foreground transition-transform ${expanded ? 'rotate-90' : ''}`} />
      </button>
      {diagnostic && (
        <div
          className={`border-t px-3 py-2.5 ${
            diagnostic.verdict === 'NO_VERIFIED_FINDING'
              ? 'border-emerald-500/25 bg-emerald-500/10'
              : diagnostic.verdict === 'ANALYSIS_INCOMPLETE'
                ? 'border-amber-500/25 bg-amber-500/10'
                : 'border-green-500/25 bg-green-500/10'
          }`}
          role="status"
          aria-label={`Forensic verdict ${diagnosticVerdict}`}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold tracking-wide text-foreground">{diagnosticVerdict}</span>
            <span className="rounded border border-border/50 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">
              {diagnostic.reasonCode.replace(/_/g, ' ')}
            </span>
          </div>
          <p className="mt-1 leading-relaxed text-foreground/90">{diagnostic.explanation}</p>
          {diagnostic.verdict === 'ANALYSIS_INCOMPLETE' && (
            <>
              {(diagnostic.unreadFileCount > 0 || diagnostic.truncatedFileCount > 0) && (
                <div className="mt-1.5 text-muted-foreground">
                  Unread scope: {diagnostic.unreadFileCount}
                  {diagnostic.truncatedFileCount > 0 ? ` · truncated: ${diagnostic.truncatedFileCount}` : ''}
                  {(diagnostic.unreadFiles.length > 0 || diagnostic.truncatedFiles.length > 0) && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {[...diagnostic.unreadFiles, ...diagnostic.truncatedFiles]
                        .filter((file, index, files) => files.indexOf(file) === index)
                        .map((file) => <code key={file} className="rounded bg-background/40 px-1 py-0.5">{file}</code>)}
                    </div>
                  )}
                </div>
              )}
              <p className="mt-1.5 font-medium text-amber-100">{diagnostic.nextAction}</p>
            </>
          )}
        </div>
      )}

      {expanded && (
        <div className={`border-t px-3 py-3 space-y-3 ${isFixtureLocal ? 'border-violet-500/20' : 'border-amber-500/20'}`}>
          {isFixtureLocal && (
            <div className="rounded border border-violet-500/40 bg-violet-500/10 px-2.5 py-2">
              <div className="flex items-center gap-1.5 font-medium text-violet-200">
                <ShieldAlert className="w-3.5 h-3.5 text-violet-300 shrink-0" />
                Fixture-local finding — repair execution blocked
              </div>
              <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                All evidence for this Finding comes from fixture, test, or spec paths. The defect pattern has
                not been proven in production source files. Production reachability is{' '}
                <span className="font-semibold text-amber-300">NOT PROVEN</span> and repair execution is blocked
                until caller and input-path evidence from production code is established.
              </p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded border border-border/50 bg-background/30 px-2 py-1.5">
              <div className="text-base font-semibold text-foreground">{evidence.implementationFiles}</div>
              <div className="text-[10px] text-muted-foreground">implementation files</div>
            </div>
            <div className="rounded border border-border/50 bg-background/30 px-2 py-1.5">
              <div className="text-base font-semibold text-foreground">{evidence.contextFiles}</div>
              <div className="text-[10px] text-muted-foreground">context/config files</div>
            </div>
            <div className="rounded border border-border/50 bg-background/30 px-2 py-1.5">
              <div className="text-base font-semibold text-foreground">{evidence.generatedFiles}</div>
              <div className="text-[10px] text-muted-foreground">generated artifacts</div>
            </div>
            <div className="rounded border border-border/50 bg-background/30 px-2 py-1.5">
              <div className="text-base font-semibold text-foreground">{evidence.completedReads}</div>
              <div className="text-[10px] text-muted-foreground">completed reads</div>
            </div>
            <div className="rounded border border-border/50 bg-background/30 px-2 py-1.5">
              <div className="text-base font-semibold text-amber-300">{evidence.cachedReads}</div>
              <div className="text-[10px] text-muted-foreground">cached repeats</div>
            </div>
            <div className="rounded border border-border/50 bg-background/30 px-2 py-1.5">
              <div className={`text-base font-semibold ${evidence.unattributedResults > 0 ? 'text-amber-300' : 'text-green-300'}`}>
                {evidence.unattributedResults}
              </div>
              <div className="text-[10px] text-muted-foreground">unattributed results</div>
            </div>
          </div>

          {/* NI-35/EI-012: run-ledger telemetry reconciliation */}
          {evidence.evidenceIntegrity && (
            <div className={`rounded border px-2.5 py-2 ${
              evidence.evidenceIntegrity.consistent
                ? 'border-green-500/30 bg-green-500/5'
                : 'border-red-500/30 bg-red-500/5'
            }`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`flex items-center gap-1.5 font-medium ${
                  evidence.evidenceIntegrity.consistent ? 'text-green-200' : 'text-red-200'
                }`}>
                  {evidence.evidenceIntegrity.consistent
                    ? <ShieldCheck className="w-3.5 h-3.5 text-green-300" />
                    : <ShieldAlert className="w-3.5 h-3.5 text-red-300" />}
                  Telemetry reconciliation
                </span>
                <span className={`ml-auto rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${
                  evidence.evidenceIntegrity.consistent
                    ? 'border-green-500/40 text-green-200'
                    : 'border-red-500/40 text-red-200'
                }`}>
                  {evidence.evidenceIntegrity.code || (evidence.evidenceIntegrity.consistent ? 'CONSISTENT' : 'INCONSISTENT')}
                </span>
              </div>
              <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-4">
                <div>
                  <span className="font-semibold text-foreground">{evidence.evidenceIntegrity.uniqueFilesRead}</span>
                  <span className="text-[10px] text-muted-foreground"> unique read</span>
                </div>
                <div>
                  <span className="font-semibold text-foreground">{evidence.evidenceIntegrity.evidenceFileCount}</span>
                  <span className="text-[10px] text-muted-foreground"> evidence file</span>
                </div>
                <div>
                  <span className="font-semibold text-foreground">{evidence.evidenceIntegrity.acceptedEvidenceCount}</span>
                  <span className="text-[10px] text-muted-foreground"> accepted</span>
                </div>
                <div>
                  <span className="font-semibold text-foreground">{evidence.evidenceIntegrity.readAttempts}</span>
                  <span className="text-[10px] text-muted-foreground"> read attempts</span>
                </div>
                <div>
                  <span className="font-semibold text-foreground">
                    {evidence.evidenceIntegrity.retainedBodyFiles.length}
                  </span>
                  <span className="text-[10px] text-muted-foreground"> retained bodies</span>
                </div>
                <div>
                  <span className="font-semibold text-foreground">
                    {evidence.evidenceIntegrity.acceptedEvidenceFiles.length}
                  </span>
                  <span className="text-[10px] text-muted-foreground"> accepted files</span>
                </div>
                <div>
                  <span className="font-semibold text-foreground">
                    {evidence.evidenceIntegrity.acceptedBehavioralClaimCount ??
                      evidence.evidenceIntegrity.acceptedClaimCount}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {evidence.evidenceIntegrity.acceptedBehavioralClaimCount !== undefined
                      ? ' behavioral claims'
                      : ' accepted requirements (legacy)'}
                  </span>
                </div>
              </div>
              {(evidence.evidenceIntegrity.objectiveType ||
                evidence.evidenceIntegrity.completionGateResult ||
                evidence.evidenceIntegrity.finalAnswerType ||
                evidence.evidenceIntegrity.requiredEdges.length > 0 ||
                evidence.evidenceIntegrity.provenEdges.length > 0) && (
                <div className="mt-2 rounded border border-primary/20 bg-primary/5 px-2.5 py-2" aria-label="Objective proof details">
                  <div className="text-[10px] font-semibold text-primary">Objective proof</div>
                  <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-5">
                    <div>
                      <div className="text-[10px] text-muted-foreground">Completion</div>
                      <div className="font-semibold text-foreground">
                        {evidence.evidenceIntegrity.completionGateResult ?? 'Not declared'}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-muted-foreground">Required edges</div>
                      <div className="font-semibold text-foreground">{evidence.evidenceIntegrity.requiredEdges.length}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-muted-foreground">Source edges</div>
                      <div className="font-semibold text-blue-300">
                        {evidence.evidenceIntegrity.provenStructuralEdgeCount ?? 'Unavailable'}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-muted-foreground">Runtime edges</div>
                      <div className="font-semibold text-green-300">
                        {evidence.evidenceIntegrity.provenRuntimeEdgeCount ?? 'Unavailable'}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-muted-foreground">Final answer</div>
                      <div className="break-words font-semibold text-foreground">
                        {evidence.evidenceIntegrity.finalAnswerType
                          ? evidence.evidenceIntegrity.finalAnswerType.replace(/_ANSWER$/, '').replace(/_/g, ' ')
                          : 'Not recorded'}
                      </div>
                    </div>
                  </div>
                  {evidence.evidenceIntegrity.objectiveType && (
                    <div className="mt-1.5 border-t border-border/40 pt-1.5 text-[10px] text-muted-foreground">
                      Objective type: <span className="font-semibold text-foreground">{evidence.evidenceIntegrity.objectiveType}</span>
                    </div>
                  )}
                  {evidence.evidenceIntegrity.requiredEdges.length > 0 && (
                    <div className="mt-1.5 space-y-0.5 border-t border-border/40 pt-1.5">
                      <div className="text-[10px] text-muted-foreground">Edge proof ledger</div>
                      {evidence.evidenceIntegrity.requiredEdges.map((edge) => {
                        const proof = evidence.evidenceIntegrity!.provenEdgeProofs.find(
                          (item) => item.edge === edge,
                        );
                        const isProven = evidence.evidenceIntegrity!.provenEdges.includes(edge);
                        return (
                          <div key={edge} className="font-mono text-[10px] text-foreground/80">
                            <span className={isProven ? 'text-green-300' : 'text-amber-200'}>
                              {isProven ? '✓' : '○'}
                            </span>{' '}
                            {edge}
                            {isProven && (
                              <span className="ml-1 font-sans text-muted-foreground">
                                ({proof
                                  ? proof.basis
                                      .replace('SOURCE_AST', 'source AST')
                                      .replace('RUNTIME_OBSERVED', 'runtime observed')
                                      .replace('BOTH', 'source AST + runtime')
                                  : 'proof basis unavailable'})
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
              {evidence.evidenceIntegrity.sourceCoverage && (
                <div className="mt-1.5 border-t border-border/40 pt-1.5 text-[10px] text-muted-foreground">
                  Canonical source coverage:{' '}
                  <span className="font-semibold text-foreground">
                    {evidence.evidenceIntegrity.sourceCoverage.status}
                  </span>{' '}
                  · {evidence.evidenceIntegrity.sourceCoverage.requestedFiles?.length ?? evidence.evidenceIntegrity.sourceCoverage.roots.length} requested file(s)
                  {evidence.evidenceIntegrity.sourceCoverage.requestedFiles &&
                    evidence.evidenceIntegrity.sourceCoverage.requestedFiles.length > 0 && (
                      <div className="mt-1 space-y-0.5">
                        {!evidence.forensicStatus && (
                          <div className="text-muted-foreground">requested files</div>
                        )}
                        <div className="text-muted-foreground">canonical manifest</div>
                        {evidence.evidenceIntegrity.sourceCoverage.requestedFiles.map((file) => (
                          <code key={file} className="block break-all text-foreground/80">{file}</code>
                        ))}
                      </div>
                    )}
                </div>
              )}
              {(evidence.evidenceIntegrity.scopeExpansions.length > 0 ||
                evidence.evidenceIntegrity.unjustifiedReads.length > 0) && (
                <div className="mt-1.5 border-t border-border/40 pt-1.5 text-[10px] leading-relaxed">
                  <span className="text-muted-foreground">Objective scope:</span>{' '}
                  <span className="text-foreground">
                    {evidence.evidenceIntegrity.scopeExpansions.filter(
                      (expansion) => expansion.kind === 'JUSTIFIED_SCOPE_EXPANSION',
                    ).length}{' '}
                    justified expansion(s)
                  </span>
                  {evidence.evidenceIntegrity.unjustifiedReads.length > 0 && (
                    <span className="ml-2 font-semibold text-red-200">
                      {evidence.evidenceIntegrity.unjustifiedReads.length} blocked read(s)
                    </span>
                  )}
                </div>
              )}
              {evidence.evidenceIntegrity.violations.length > 0 && (() => {
                const violatingFiles = evidence.evidenceIntegrity.violations
                  .map((v) => v.match(/:?\s*([^:]+(?:\.(?:ts|tsx|js|jsx|py|go|rs|sql|sh)))$/i)?.[1])
                  .filter((f): f is string => Boolean(f));
                return (
                  <div className="mt-1.5 border-t border-border/40 pt-1.5 text-[10px] leading-relaxed text-red-200">
                    {violatingFiles.length > 0 ? (
                      <>
                        <span className="text-muted-foreground">Evidence with no backing completed read:</span>{' '}
                        <span className="font-mono">{[...new Set(violatingFiles)].join(', ')}</span>
                      </>
                    ) : (
                      <>
                        <span className="text-muted-foreground">Reconciliation failed closed — the verdict was blocked because cited evidence
                          could not be matched to a completed source read.</span>
                      </>
                    )}
                  </div>
                );
              })()}
            </div>
          )}

          {evidence.forensicStatus && (
            <div className={`rounded border px-2.5 py-2 ${
              evidence.forensicStatus.isFixtureLocal
                ? 'border-violet-500/30 bg-violet-500/5'
                : 'border-primary/25 bg-primary/5'
            }`}>
              <div className="mb-2 flex items-center gap-1.5 font-medium text-foreground">
                <ShieldCheck className={`w-3.5 h-3.5 ${evidence.forensicStatus.isFixtureLocal ? 'text-violet-400' : 'text-primary'}`} />
                Audit state
                {evidence.forensicStatus.isFixtureLocal && (
                  <span className="ml-1 rounded border border-violet-500/40 bg-violet-500/15 px-1 py-0.5 text-[9px] font-semibold text-violet-300 uppercase tracking-wide">
                    fixture-local
                  </span>
                )}
              </div>
              <div className="mb-2 grid grid-cols-1 gap-2 border-b border-border/40 pb-2 sm:grid-cols-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] text-muted-foreground">audit scope</span>
                  <Badge
                    variant="outline"
                    className={
                      evidence.forensicStatus.auditScope === 'FIXTURE_LOCAL'
                        ? 'border-violet-500/40 text-violet-200'
                        : 'border-border/60 text-muted-foreground'
                    }
                  >
                    {evidence.forensicStatus.auditScope === 'FIXTURE_LOCAL' ? 'FIXTURE-LOCAL' : 'PRODUCTION'}
                  </Badge>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] text-muted-foreground">production reachability</span>
                  <Badge variant="outline" className="border-amber-500/40 text-amber-200">
                    {evidence.forensicStatus.productionReachability}
                  </Badge>
                </div>
              </div>
              {evidence.forensicStatus.auditScope === 'FIXTURE_LOCAL' && (
                <div className="mb-2 rounded border border-violet-500/25 bg-violet-500/5 px-2 py-1.5 text-[10px] leading-relaxed text-violet-100">
                  This Finding is proven only inside the test/fixture source. It does not prove a production execution path, and repair execution is blocked for this scope.
                </div>
              )}
              {!evidence.forensicStatus.isFixtureLocal && evidence.forensicStatus.repairBlockReason && (
                <div className="mb-2 rounded border border-red-500/25 bg-red-500/5 px-2 py-1.5 text-[10px] leading-relaxed text-red-100">
                  <span className="font-medium text-red-200">
                    {REPAIR_BLOCK_REASON_TEXT[evidence.forensicStatus.repairBlockReason]
                      ?? `Repair blocked (${evidence.forensicStatus.repairBlockReason}).`
                    }
                  </span>
                </div>
              )}
              <div className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-4">
                <div>
                  <div className="font-semibold text-foreground">{evidence.forensicStatus.sourceCoverage}</div>
                  <div className="text-[10px] text-muted-foreground">source coverage</div>
                </div>
                <div>
                  <div className="font-semibold text-foreground">{evidence.forensicStatus.behavioralAssessment}</div>
                  <div className="text-[10px] text-muted-foreground">behavioral assessment</div>
                </div>
                <div>
                  <div className={`font-semibold ${
                    evidence.forensicStatus.isFixtureLocal ? 'text-violet-300' : 'text-foreground'
                  }`}>
                    {evidence.forensicStatus.isFixtureLocal
                      ? 'FIXTURE-LOCAL'
                      : evidence.forensicStatus.findingStatus}
                  </div>
                  <div className="text-[10px] text-muted-foreground">finding status</div>
                </div>
                <div>
                  <div className={`font-semibold ${evidence.forensicStatus.repairReadiness === 'READY' ? 'text-green-300' : 'text-amber-300'}`}>
                    {evidence.forensicStatus.repairReadiness}
                  </div>
                  <div className="text-[10px] text-muted-foreground">repair readiness</div>
                </div>
                {/* Production reachability — always shown when findingStatus is PROVEN or fixture-local */}
                {(evidence.forensicStatus.productionReachability !== undefined || evidence.forensicStatus.isFixtureLocal) && (
                  <div className="col-span-2 sm:col-span-2">
                    <div className={`font-semibold ${
                      (evidence.forensicStatus.productionReachability ?? 'NOT_PROVEN') === 'PROVEN'
                        ? 'text-green-300'
                        : 'text-amber-300'
                    }`}>
                      {evidence.forensicStatus.productionReachability ?? 'NOT PROVEN'}
                    </div>
                    <div className="text-[10px] text-muted-foreground">production reachability</div>
                  </div>
                )}
              </div>
              {evidence.forensicStatus.isFixtureLocal && (
                <div className="mt-2 border-t border-violet-500/20 pt-2 text-[10px] leading-relaxed text-violet-200">
                  Evidence scope: fixture/test paths only. Production reachability requires caller and
                  input-path evidence from non-fixture source files.
                </div>
              )}
              {(evidence.forensicStatus.effectiveRoot
                || evidence.forensicStatus.projectRevision
                || evidence.forensicStatus.completeReads !== undefined
                || evidence.forensicStatus.appliedBudget
                || evidence.forensicStatus.synthesisLifecycle
                || (evidence.forensicStatus.readStatuses?.length ?? 0) > 0) && (
                <div className="mt-2 rounded border border-border/40 bg-background/20 px-2 py-1.5 text-[10px] leading-relaxed">
                  <div className="font-medium text-foreground">Audit collection telemetry</div>
                  <div className="mt-1 grid grid-cols-1 gap-x-3 gap-y-0.5 text-muted-foreground sm:grid-cols-2">
                    {evidence.forensicStatus.effectiveRoot && (
                      <span>source root: <strong className="text-foreground">{evidence.forensicStatus.effectiveRoot}</strong></span>
                    )}
                    {evidence.forensicStatus.projectRevision && (
                      <span>revision: <code className="text-foreground">{evidence.forensicStatus.projectRevision}</code></span>
                    )}
                    {evidence.forensicStatus.completeReads !== undefined && (
                      <span>complete-read mode: <strong className="text-foreground">{evidence.forensicStatus.completeReads ? 'on' : 'off'}</strong></span>
                    )}
                    {evidence.forensicStatus.appliedBudget && (
                      <span>
                        budget: <strong className="text-foreground">
                          {evidence.forensicStatus.appliedBudget.maxIterations} iterations / {evidence.forensicStatus.appliedBudget.maxToolCalls} tool calls
                        </strong>
                      </span>
                    )}
                    {evidence.forensicStatus.synthesisLifecycle && (
                      <span>
                        synthesis: <strong className="text-foreground">
                          {evidence.forensicStatus.synthesisLifecycle.skipped
                            ? 'skipped'
                            : evidence.forensicStatus.synthesisLifecycle.timedOut
                              ? 'timed out'
                              : evidence.forensicStatus.synthesisLifecycle.attempted
                                ? 'attempted'
                                : 'started'}
                        </strong>
                      </span>
                    )}
                    {evidence.forensicStatus.readStatuses && evidence.forensicStatus.readStatuses.length > 0 && (
                      <span>
                        file reads: <strong className="text-foreground">
                          {evidence.forensicStatus.readStatuses.filter((read) => read.status === 'READ_COMPLETE').length} complete
                        </strong>
                        {' · '}
                        {evidence.forensicStatus.readStatuses.filter((read) => read.status === 'READ_TRUNCATED').length} truncated
                        {' · '}
                        {evidence.forensicStatus.readStatuses.filter((read) => read.status === 'READ_FAILED').length} failed
                      </span>
                    )}
                  </div>
                </div>
              )}
              {!evidence.forensicStatus.isFixtureLocal && evidence.forensicStatus.reason && (
                <div className="mt-2 border-t border-border/40 pt-2 text-[10px] leading-relaxed text-amber-200">
                  {evidence.forensicStatus.reason}
                </div>
              )}
              {evidence.forensicStatus.terminalKind && (
                <div className="mt-2 rounded border border-amber-500/20 bg-amber-500/5 px-2 py-1.5 text-[10px] leading-relaxed text-amber-100">
                  <span className="font-medium text-amber-200">
                    {evidence.forensicStatus.terminalKind.replace(/_/g, ' ')}
                  </span>
                  {' — '}
                  {FORENSIC_TERMINAL_TEXT[evidence.forensicStatus.terminalKind]}
                </div>
              )}
              {evidence.forensicStatus.rootCoverage.length > 0 && (
                <div className="mt-2 border-t border-border/40 pt-2">
                  <div className="mb-1 text-[10px] text-muted-foreground">
                    {evidence.forensicStatus.requestedFiles.length > 0 ? 'requested files' : 'requested roots'}
                  </div>
                  <div className="space-y-1">
                      {evidence.forensicStatus.rootCoverage.map((coverage) => (
                        <div key={coverage.root}>
                          <div className="flex items-center gap-2 text-[10px]">
                            <code className="min-w-0 flex-1 break-all text-foreground/80">{coverage.root}</code>
                            <span className={
                              coverage.status === 'COMPLETE' || coverage.status === 'EMPTY'
                                ? 'text-green-300'
                                : 'text-amber-300'
                            }>
                              {coverage.status}
                            </span>
                            <span className="text-muted-foreground">
                              {coverage.readFiles}/{coverage.discoveredFiles} read
                            </span>
                          </div>
                          {(coverage.unreadPaths?.length || coverage.truncatedPaths?.length) ? (
                            <div className="ml-2 flex flex-wrap gap-1 text-[9px] text-amber-200">
                              {[...(coverage.unreadPaths ?? []), ...(coverage.truncatedPaths ?? [])]
                                .filter((file, fileIndex, files) => files.indexOf(file) === fileIndex)
                                .slice(0, 12)
                                .map((file) => <code key={file} className="rounded bg-amber-500/10 px-1 py-0.5">{file}</code>)}
                            </div>
                          ) : null}
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {evidence.forensicPackets.length > 0 && (
            <div className="rounded border border-violet-500/25 bg-violet-500/5 px-2.5 py-2">
              <div className="mb-2 flex items-center gap-1.5 font-medium text-foreground">
                <GitMerge className="w-3.5 h-3.5 text-violet-300" />
                Evidence packets
              </div>
              <div className="space-y-1.5">
                {evidence.forensicPackets.map((packet) => (
                  <div
                    key={`${packet.root}-${packet.packetIndex}-${packet.status}`}
                    className="rounded border border-border/40 bg-background/20 px-2 py-1.5"
                  >
                    <div className="flex items-center gap-2">
                      <code className="min-w-0 flex-1 break-all text-[10px] text-foreground/85">{packet.root}</code>
                      <span className={`shrink-0 text-[10px] ${
                        packet.status === 'ACCEPTED'
                          ? 'text-green-300'
                          : packet.status === 'FAILED'
                            ? 'text-red-300'
                            : packet.status === 'STARTED'
                              ? 'text-sky-300'
                              : 'text-amber-300'
                      }`}>
                        {packet.status === 'FAILED' ? 'RECOVERY FAILED' : packet.status}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
                      <span>{packet.fileCount} files</span>
                      <span>{packet.implementationFiles} implementation</span>
                      <span>{packet.contextFiles} context</span>
                      <span>{packet.generatedFiles} generated</span>
                      <span>packet {packet.packetIndex + 1}/{packet.packetCount}</span>
                    </div>
                    {packet.reason && (
                      <div className="mt-1 text-[10px] text-amber-200">{packet.reason}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {evidence.execution && (
            <div className="rounded border border-border/50 bg-background/20 px-2.5 py-2">
              <div className="mb-2 flex items-center gap-1.5 font-medium text-foreground">
                <Activity className="w-3.5 h-3.5 text-primary" />
                Execution details
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-4">
                <div>
                    <div className="font-semibold text-foreground">{evidence.execution.toolCalls}</div>
                    <div className="text-[10px] text-muted-foreground">tool calls (all)</div>
                </div>
                <div>
                  <div className="font-semibold text-foreground">
                    {evidence.execution.iterations}/{evidence.execution.maxIterations}
                  </div>
                  <div className="text-[10px] text-muted-foreground">iterations used</div>
                </div>
                <div>
                  <div className="font-semibold text-foreground">
                    {evidence.execution.synthesisStarted
                      ? 'attempted'
                      : evidence.execution.recoveryStarted
                        ? 'not entered'
                        : 'not started'}
                  </div>
                  <div className="text-[10px] text-muted-foreground">report synthesis</div>
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <div className="font-semibold break-words text-foreground">
                    {formatStopReason(
                      evidence.execution.stopReason,
                      evidence.execution.synthesisStarted,
                    )}
                  </div>
                  <div className="text-[10px] text-muted-foreground">stop reason</div>
                </div>
              </div>
              {evidence.execution.recoveryStarted && (
                <div className="mt-2 border-t border-border/40 pt-2 text-[10px] text-amber-200">
                  {evidence.diagnosticCodes.some((code) => code.includes('CAPABILITY_PROBE_EVIDENCE_RECOVERED'))
                    ? 'Capability probe Recovery was accepted after validating the complete declared evidence and exact source grounding.'
                    : evidence.diagnosticCodes.some((code) => code.includes('STRUCTURED_RECOVERY_ACCEPTED'))
                    ? 'Structured forensic Recovery was accepted and rebuilt deterministically from the verified evidence.'
                    : evidence.diagnosticCodes.some((code) => code.includes('CAPABILITY_PROBE_EVIDENCE_RECOVERY_'))
                      ? 'Capability probe Recovery was bounded but did not produce an accepted source-grounded C1–C7 report; the preserved-evidence fallback remains active.'
                    : 'Forensic Recovery started after the tool-loop response but did not produce an accepted six-section report; the preserved-evidence fallback remains active.'}
                </div>
              )}
              {(evidence.execution.prefetchToolCalls > 0 || evidence.execution.loopToolCalls > 0) && (
                <div className="mt-2 border-t border-border/40 pt-2 text-[10px] text-muted-foreground">
                   Counted in total: {evidence.execution.prefetchToolCalls} prefetch · {evidence.execution.loopToolCalls} loop
                </div>
              )}
            </div>
          )}

          <div>
            <div className="mb-1.5 flex items-center gap-1.5 font-medium text-foreground">
              {claimEvidence && claimEvidence.length > 0 ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 text-primary" />
                  These lines prove this behavior
                </>
              ) : (
                <>
                  <FileSearch className="w-3.5 h-3.5 text-primary" />
                  Source reads ({uniqueFiles} unique)
                </>
              )}
            </div>
            {claimEvidence && claimEvidence.length > 0 ? (
              <div className="space-y-1">
                {claimEvidence.map((e) => {
                  const { label, hasSpan } = evidenceAnchor(e);
                  return (
                    <div key={`${e.source}-${e.sourceSpan?.startLine ?? 'nospan'}`} className="rounded border border-border/40 bg-background/20 px-2 py-1.5">
                      <div className="flex items-start gap-1.5">
                        <ChevronRight className={`mt-0.5 w-3 h-3 shrink-0 ${hasSpan ? 'text-green-300' : 'text-muted-foreground'}`} />
                        <code className="min-w-0 flex-1 break-all text-[10px] text-foreground/85">{label}</code>
                        {e.directness && (
                          <span className={`shrink-0 rounded border px-1 py-0.5 text-[9px] font-semibold ${
                            e.directness === 'DIRECT'
                              ? 'border-green-500/30 text-green-300'
                              : 'border-amber-500/30 text-amber-300'
                          }`}>
                            {e.directness}
                          </span>
                        )}
                      </div>
                      {e.excerpt && (
                        <div className="mt-1 ml-4 text-[10px] leading-relaxed text-muted-foreground">
                          {e.excerpt.length > 220 ? `${e.excerpt.slice(0, 220)}…` : e.excerpt}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : hasEvidence ? (
              <div className="space-y-1">
                {evidence.reads.map((read) => (
                  <div key={read.source} className="rounded border border-border/40 bg-background/20 px-2 py-1.5">
                    <div className="flex items-start gap-1.5">
                      <CheckCircle2 className="mt-0.5 w-3 h-3 text-green-400 shrink-0" />
                      <code className="min-w-0 flex-1 break-all text-[10px] text-foreground/85">
                        {read.source}
                      </code>
                      <span className="shrink-0 text-[10px] text-muted-foreground">#{read.firstSeen}</span>
                    </div>
                    <div className="mt-1 ml-4 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
                      <span>{read.completed} completed source bod{read.completed === 1 ? 'y' : 'ies'}</span>
                      {read.prefetched > 0 && <span className="text-sky-300">{read.prefetched} prefetch</span>}
                      {read.loop > 0 && <span className="text-violet-300">{read.loop} loop read{read.loop === 1 ? '' : 's'}</span>}
                      {read.cached > 0 && <span className="text-amber-300">{read.cached} cached repeat{read.cached === 1 ? '' : 's'}</span>}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded border border-amber-500/20 bg-background/20 px-2 py-2 text-muted-foreground">
                No completed source reads were recorded. Directory listings and failed reads are not source evidence.
              </div>
            )}
          </div>

          <div className="rounded border border-border/40 bg-background/20 px-2.5 py-2 text-[10px] leading-relaxed text-muted-foreground">
            <div className="mb-1 font-medium text-foreground">How evidence is classified</div>
            <div>
              <span className="text-green-300">Completed source body</span> can support the Evidence Map.
              <span className="ml-1 text-amber-300">Cached repeat</span> confirms repeated access but does not add new evidence.
              Searches, directory listings, previews, failed reads, and diagnostics are tracked separately and cannot prove a Finding.
            </div>
          </div>

          {evidence.incompleteReads.length > 0 && (
            <div>
              <div className="mb-1 flex items-center gap-1.5 font-medium text-amber-200">
                <RotateCcw className="w-3.5 h-3.5" />
                Reads without a completed result
              </div>
              <div className="space-y-1 text-[10px] text-muted-foreground">
                {evidence.incompleteReads.map((source) => (
                  <div key={source} className="break-all">• {source}</div>
                ))}
              </div>
            </div>
          )}

          {evidence.unattributedResults > 0 && (
            <div className="rounded border border-amber-500/20 bg-background/20 px-2.5 py-2 text-muted-foreground">
              <div className="font-medium text-amber-200">Read result without a source path</div>
              <p className="mt-1 leading-relaxed">
                {evidence.unattributedResults} read result{evidence.unattributedResults === 1 ? '' : 's'} was recorded without a source path.
                It is not counted as completed source evidence, and it is not classified as a failed read.
              </p>
            </div>
          )}

          {finalVerdict === 'FINDING PROVEN' &&
          evidence.diagnosticCodes.some((code) => code.includes('FORENSIC_DETERMINISTIC_FINDING')) ? (
            <div className="rounded border border-green-500/25 bg-green-500/5 px-2.5 py-2">
              <div className="font-medium text-green-300">Final evidence decision: Finding accepted</div>
              <p className="mt-1 leading-relaxed text-muted-foreground">
                The provider Recovery attempt was not required for acceptance. A deterministic executable pattern was verified against the completed source read and passed the evidence gate.
              </p>
            </div>
          ) : (
            <div className="rounded border border-amber-500/20 bg-background/20 px-2.5 py-2">
              <div className="font-medium text-amber-200">
                {finalVerdict === 'FINDING PROVEN' ? 'Final evidence decision: Finding accepted' : 'Why no repair phase was accepted'}
              </div>
              <p className="mt-1 leading-relaxed text-muted-foreground">{forensicRejectionReason(evidence, finalVerdict)}</p>
            </div>
          )}
          {evidence.diagnosticCodes.some((code) =>
            code.includes('STRUCTURED_RECOVERY_REJECTED') ||
            code.includes('CONTRACT_RECOVERY_REJECTED') ||
            code.includes('RECOVERY_PARSE_FAILED'),
          ) && (
            <div className="rounded border border-amber-500/20 bg-amber-500/5 px-2.5 py-2">
              <div className="font-medium text-amber-200">Provider Recovery: rejected</div>
              <p className="mt-1 leading-relaxed text-muted-foreground">
                The provider-generated report did not satisfy the Recovery contract. This status is separate from the final evidence decision above.
              </p>
            </div>
          )}
          <div className="rounded border border-border/40 bg-background/20 px-2.5 py-2">
            {evidence.diagnosticCodes.length > 0 && (
              <div className="mt-2 border-t border-border/40 pt-2 text-[10px] leading-relaxed text-muted-foreground">
                <span className="font-medium text-foreground/80">Diagnostic codes:</span>{' '}
                {evidence.diagnosticCodes.join(' · ')}
              </div>
            )}
            {evidence.diagnosticDetails.length > 0 && (
              <div className="mt-2 border-t border-border/40 pt-2 text-[10px] leading-relaxed text-muted-foreground">
                <span className="font-medium text-foreground/80">Contract notes:</span>{' '}
                {evidence.diagnosticDetails.join(' · ')}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
