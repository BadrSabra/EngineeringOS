import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { AlertCircle, Bot, ChevronRight, Clock3, Loader2, RotateCcw, User, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CapabilityProbeReport } from '@/components/CapabilityProbeReport';
import { EvidenceGraphPanel } from '@/components/EvidenceGraphPanel';
import { MissionCapsule } from '@/components/MissionCapsule';
import { parseCapabilityProbeReport } from '@/lib/capability-probe-report';
import type { AiCrossFileSemanticTrace, AiFallbackDiagnostic } from '@workspace/api-client-react';
import { readMissionCorrelationReportGeneratedAt } from '@/lib/mission-correlation-report';
import type { BrowserValidationProfileFreshness, ChatMessage } from './types';
import { ProjectQueryResponseCard, ProjectQueryTargetCard, getTurnIntentLabel } from './project-query';
import { SourceCoveragePanel, inferOperationMode } from './delivery-proof';
import { ProjectQueryRetryButton, projectQueryRateLimitRetryAt, providerFailureCategoryLabel, redactInternalDetails, safeChatRecoveryMessage, safePartialProviderResponse } from './provider-runtime';
import { SemanticTraceCard, getFinalForensicVerdict, isEvidenceOnlyFallbackMessage, isForensicFallbackMessage, isForensicRejection, isIncompleteBeforeEvidenceSummary, parseBehaviorEvidence, parseEvidenceGraph, parseExecutionLedger, parseExecutionSummary, parseForensicEvidence, parseSources, parseToolTrace } from './trace-parsing';
import { ForensicEvidenceCard } from './forensic-evidence-card';
import { ExecutionSummaryBanner, ForensicFallbackBanner, PersistedExecutionProof, RepairRadar, parseRepairRadar } from './execution-trace';
import { BehaviorEvidencePanel, ProjectQuerySourceHeading, extractDisplayText, isInternalTechnicalDump } from './evidence-panels';
import { AcceptedProjectQueryMissionAction, type PlanDecision, TaskResultPanel } from './task-result-panel';
import { CodeReviewScopeNotice, structuredFailurePresentation } from './structured-results';
import { CompletedActivityTimeline, activityEventsFromToolTrace } from './live-activity';
import { FlightRecorder } from './flight-recorder';
import { AcceptanceDispositionNotice } from './execution-proof';
import { ContextProvenanceCard, ExecutionLedgerCard } from './context-cards';

export function MessageBubble({
  msg,
  projectId,
  sessionId,
  proposalId,
  onPlanDecision,
  planDecisionPending,
  onPlanBuild,
  planBuildPending,
  browserProfileFreshness,
  onRegenerateReport,
  reportRegenerationPending,
  onRetryStructuredTask,
  retryPending,
  onRetryProjectQuery,
  projectQueryRetryPending,
  onMissionHandoff,
  missionHandoffPending,
  onMissionHandoffComplete,
  onExplainFallback,
  fallbackDiagnostic,
  fallbackDiagnosticPending,
  fallbackDiagnosticError,
}: {
  msg: ChatMessage;
  projectId?: string;
  sessionId?: string;
  proposalId?: string;
  onPlanDecision?: (messageId: string, decision: PlanDecision) => void;
  planDecisionPending?: boolean;
  onPlanBuild?: (messageId: string) => void;
  planBuildPending?: boolean;
  browserProfileFreshness?: BrowserValidationProfileFreshness | null;
  onRegenerateReport?: (messageId: string) => void;
  reportRegenerationPending?: boolean;
  onRetryStructuredTask?: (task: 'analyze' | 'review', messageId: string) => void;
  retryPending?: boolean;
  onRetryProjectQuery?: (messageId: string) => void;
  projectQueryRetryPending?: boolean;
  onMissionHandoff?: (message: ChatMessage) => void;
  missionHandoffPending?: boolean;
  onMissionHandoffComplete?: (mission: { id: string; title: string }) => void;
  onExplainFallback?: (message: ChatMessage) => void;
  fallbackDiagnostic?: AiFallbackDiagnostic;
  fallbackDiagnosticPending?: boolean;
  fallbackDiagnosticError?: boolean;
}) {
  const isUser = msg.role === 'user';
  const isChatTurn = !isUser && msg.turnIntent === 'CHAT';
  const turnIntentLabel = getTurnIntentLabel(msg);
  const [technicalDetailsExpanded, setTechnicalDetailsExpanded] = useState(false);
  const canOfferMissionHandoff = isUser && Boolean(projectId && sessionId && onMissionHandoff);
  const sources = parseSources(msg.sources);
  const toolTrace = parseToolTrace(msg.toolTrace);
  const evidenceGraph = msg.evidenceGraph ?? parseEvidenceGraph(msg.toolTrace);
  // Older PROJECT_QUERY rows can retain a generic forensic diagnostic in their
  // persisted trace. The source-selection/decision markers are server-owned
  // and let history renders recognize those rows even when the top-level
  // turnIntent was not present in the older API projection.
  const isProjectQueryTurn = !isUser && (
    msg.taskResult?.kind === 'PROJECT_QUERY_INVESTIGATION_RESULT' ||
    msg.turnIntent === 'PROJECT_QUERY' ||
    toolTrace.some((entry) =>
      entry.kind === 'project_query_source_selection' ||
      (entry.kind === 'decision_trace' && entry.taskType === 'PROJECT_QUERY') ||
      (entry.kind === 'evidence_integrity' && entry.objectiveType?.startsWith('PROJECT_QUERY')),
    )
  );
  const isFactInvestigation = !isUser
    && msg.taskResult?.kind === 'PROJECT_QUERY_INVESTIGATION_RESULT';
  const canOfferAcceptedFindingMission = Boolean(
    !isUser
    && projectId
    && isProjectQueryTurn
    && msg.outcome === 'SUCCEEDED'
    && msg.acceptanceDisposition == null
    && msg.terminalProjection?.outcome === 'SUCCEEDED'
    && msg.terminalProjection.messageId === msg.id
    && msg.terminalProjection.acceptanceId
    && msg.projection?.verification.proofRequired === true
    && msg.projection.verification.evidenceVerdict === 'PROVEN',
  );
  const capabilityProbeReport = !isUser
    ? parseCapabilityProbeReport(msg.content, toolTrace)
    : null;
  const activityTrace = toolTrace.filter((entry) => entry.kind !== 'execution_ledger');
  const forensicDiagnostic = !isUser && !isChatTurn && !isProjectQueryTurn
    ? msg.forensicDiagnostic
      ?? [...toolTrace].reverse().find((entry) => entry.kind === 'forensic_diagnostic')?.forensicDiagnostic
    : undefined;
  const activityEvents = msg.activityEvents ?? activityEventsFromToolTrace(activityTrace);
  const executionSummary = !isUser ? parseExecutionSummary(toolTrace) : null;
  const executionLedger = !isUser ? (msg.executionLedger ?? parseExecutionLedger(toolTrace)) : null;
  const repairRadar = !isUser ? parseRepairRadar(toolTrace) : null;
  // UI-01: strip any accidental JSON envelope before rendering.
  const displayContent = extractDisplayText(msg.content);
  const redactedDisplayContent = redactInternalDetails(displayContent);
  const internalTechnicalDump = !isUser && isInternalTechnicalDump(displayContent);
  const isStructuredPlan = !isUser && msg.taskResult?.kind === 'IMPLEMENTATION_PLAN_RESULT';
  const failedTurn = !isUser && (msg.outcome === 'FAILED' || msg.outcome === 'INTERRUPTED');
  const isGenericInterruptedTurn = !isUser &&
    msg.outcome === 'INTERRUPTED' &&
    (msg.operationMode === 'CHAT' ||
      (!msg.operationMode &&
        !msg.taskResult &&
        !msg.forensicDiagnostic &&
        !toolTrace.some((entry) =>
          entry.kind === 'forensic_status' ||
          entry.kind === 'forensic_diagnostic' ||
          entry.kind === 'forensic_recovery_start',
        )));
  const structuredFailure = !isUser && failedTurn && msg.structuredTask
    ? structuredFailurePresentation(msg.structuredTask, msg.failureKind, msg.retryable)
    : null;
  const failureKindLabel = isGenericInterruptedTurn
    ? 'Connection interrupted'
    : providerFailureCategoryLabel(msg.providerFailureCategory) ?? (
      msg.failureKind === 'QUALITY_REVIEW'
        ? 'Quality review rejected'
        : msg.failureKind === 'PROVIDER_FORMAT'
          ? 'Provider format issue'
          : msg.failureKind === 'RATE_LIMIT'
            ? 'Rate limit'
            : msg.failureKind === 'CONFIGURATION'
              ? 'Configuration issue'
              : msg.failureKind === 'TRANSPORT'
                ? 'Connection interrupted'
                : msg.failureKind === 'TOOL_FAILURE'
                  ? 'Required tool failed'
                  : msg.failureKind === 'CANCELLATION'
                    ? 'Cancelled before completion'
                    : msg.failureKind === 'RECOVERY_FAILURE'
                      ? 'Recovery failed'
                      : msg.failureKind === 'INCOMPLETE'
                        ? 'Incomplete evidence'
                        : 'Provider failure'
    );
  const preservedFailureReport = failedTurn
    && !isFactInvestigation
    && !internalTechnicalDump
    && (isForensicFallbackMessage(displayContent) || /\bANALYSIS_INCOMPLETE\b/i.test(displayContent))
    ? redactedDisplayContent
    : null;
  const userFacingContent = internalTechnicalDump
    ? 'The agent produced internal technical details for this run.'
    : redactedDisplayContent;
  const persistedForensicStatus = !isUser && !isChatTurn && !isFactInvestigation
    ? [...toolTrace].reverse().find((entry) => entry.kind === 'forensic_status')
    : undefined;
  const finalVerdict = !isUser && !isChatTurn && !isFactInvestigation
    ? getFinalForensicVerdict(displayContent, persistedForensicStatus?.findingStatus)
    : null;
  const productionTrace = !isUser
    ? [...toolTrace].reverse().find(
        (entry) => entry.kind === 'production_trace' && entry.productionTrace,
      )?.productionTrace
    : undefined;
  const crossFileTraces = !isUser
    ? toolTrace
        .filter((entry) => entry.kind === 'cross_file_trace' && entry.crossFileTrace)
        .map((entry) => entry.crossFileTrace as AiCrossFileSemanticTrace)
    : [];
  const isForensicFallback = !isUser && !isChatTurn && !isFactInvestigation
    && isForensicFallbackMessage(displayContent);
  const isEvidenceOnlyFallback = isForensicFallback && isEvidenceOnlyFallbackMessage(displayContent);
  const incompleteBeforeEvidence = !isUser && isIncompleteBeforeEvidenceSummary(executionSummary);
  const isNoFindingFallback = !isUser && Boolean(
    forensicDiagnostic?.verdict !== 'ANALYSIS_INCOMPLETE' && (
      finalVerdict === 'NO FINDING' ||
    (
      !finalVerdict &&
      executionSummary?.diagnosticCodes.some((code) => code.includes('FORENSIC_NO_FINDING')) &&
      !executionSummary.diagnosticCodes.some((code) =>
        code.includes('FORENSIC_DETERMINISTIC_FINDING') ||
        code.includes('STRUCTURED_RECOVERY_ACCEPTED'),
      )
      )
    ),
  );
  const inferredOperationMode = !isUser
    ? inferOperationMode({
        operationMode: msg.operationMode,
        taskResult: msg.taskResult,
        proposalId,
      })
    : undefined;
  const isForensicRun = !isUser && !isChatTurn && (
    inferredOperationMode === 'FORENSIC_AUDIT'
    || isForensicFallback
    || finalVerdict !== null
    || Boolean(forensicDiagnostic)
    || Boolean(msg.taskResult && ['FINDING_RESULT', 'FORENSIC_REPORT_RESULT', 'WORKSPACE_REVIEW_RESULT', 'BEHAVIOR_ANSWER_RESULT', 'REPAIR_RESULT'].includes(msg.taskResult.kind))
  );
  const isEngineeringExecution = !isUser && !isForensicRun && !isFactInvestigation && (
    inferredOperationMode === 'DELIVERY'
    || Boolean(repairRadar)
    || toolTrace.some((entry) => entry.kind === 'validation' || entry.kind === 'repair_state')
  );
  const forensicEvidence = !isUser && !isChatTurn &&
    (isForensicFallback || finalVerdict !== null || Boolean(forensicDiagnostic) || isForensicRejection(executionSummary, finalVerdict))
    ? parseForensicEvidence(toolTrace, executionSummary, forensicDiagnostic)
    : null;
  const reportGeneratedAt = !isUser && !isChatTurn
    ? readMissionCorrelationReportGeneratedAt(msg.missionCorrelationReport)
    : null;
  const safeFailureMessage = failedTurn ? safeChatRecoveryMessage(msg) : null;
  const partialProviderResponse = failedTurn && !structuredFailure
    ? safePartialProviderResponse(msg, displayContent, internalTechnicalDump)
    : null;
  const canRetryProjectQuery = Boolean(
    failedTurn
    && !structuredFailure
    && msg.turnIntent === 'PROJECT_QUERY'
    && msg.retryable !== false
    && (
      msg.providerFailureCategory !== 'RATE_LIMITED'
      || (
        Boolean(msg.projectQueryTarget)
        && (
          msg.acceptanceDisposition?.nextActionCode === 'RETRY_AFTER_RATE_LIMIT'
          || msg.terminalProjection?.nextActionCode === 'RETRY_AFTER_RATE_LIMIT'
        )
      )
    )
    && onRetryProjectQuery,
  );
  const rateLimitedProjectQueryRetry = Boolean(
    msg.providerFailureCategory === 'RATE_LIMITED'
    && (
      msg.acceptanceDisposition?.nextActionCode === 'RETRY_AFTER_RATE_LIMIT'
      || msg.terminalProjection?.nextActionCode === 'RETRY_AFTER_RATE_LIMIT'
    ),
  );
  const behaviorEvidenceCount = parseBehaviorEvidence(msg.behaviorEvidence).length;
  const hasEvidenceDetails = !isUser && Boolean(
    msg.contextProvenance
    || msg.projectQueryTarget
    || isProjectQueryTurn
    || msg.sourceSelectionRecord
    || evidenceGraph
    || behaviorEvidenceCount > 0,
  );
  const hasExecutionDetails = !isUser && Boolean(
    isForensicFallback
    || incompleteBeforeEvidence
    || executionSummary
    || executionLedger
    || repairRadar
    || isEngineeringExecution
    || isForensicRun
    || activityEvents.length > 0
    || productionTrace
    || crossFileTraces.length > 0,
  );
  return (
    <div
      data-chat-message-id={msg.id}
      role="group"
      aria-label={isUser ? 'Your message' : 'Assistant response'}
      className={`chat-message flex min-w-0 max-w-full gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'} mb-6`}
    >
      <div
        className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
          isUser ? 'bg-primary text-primary-foreground' : 'bg-secondary border border-border'
        }`}
      >
        {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4 text-primary" />}
      </div>
      <div className={`chat-message-content flex min-w-0 max-w-[calc(100%-2.75rem)] flex-col gap-2 ${isUser ? 'items-end' : 'items-start'} sm:max-w-[75%]`}>
        <div
          className={`flex items-center gap-1.5 px-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${
            isUser ? 'text-primary/80' : 'text-muted-foreground'
          }`}
        >
          <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${isUser ? 'bg-primary' : 'bg-sky-300/70'}`} />
          {isUser ? 'You' : 'EngineeringOS AI'}
          {turnIntentLabel && (
            <span
              aria-label={`Turn intent: ${turnIntentLabel}`}
              data-testid={`text-turn-intent-${msg.id}`}
              className="ml-1 rounded border border-border/70 bg-background/40 px-1.5 py-0.5 text-[9px] leading-none tracking-[0.08em]"
            >
              {turnIntentLabel}
            </span>
          )}
        </div>
        {!isStructuredPlan && <div
          className={`chat-message-bubble min-w-0 max-w-full overflow-hidden rounded-xl px-4 py-3 text-sm leading-relaxed shadow-sm [overflow-wrap:anywhere] ${
            isUser
              ? 'rounded-tr-sm border border-primary/35 bg-primary text-primary-foreground whitespace-pre-wrap'
              : 'rounded-tl-sm border border-border/80 bg-secondary/70 prose prose-sm prose-invert'
          }`}
        >
          {failedTurn ? (
            <>
              {capabilityProbeReport ? (
                <>
                  <CapabilityProbeReport
                    content={msg.content}
                    trace={toolTrace}
                    report={capabilityProbeReport}
                  />
                  <div className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-amber-200">
                    <div className="font-medium">Capability probe incomplete</div>
                    <div className="mt-1 text-[10px] uppercase tracking-wide text-amber-300/80">
                      {msg.outcome === 'INTERRUPTED' ? 'Execution interrupted' : 'Fail-closed result'}
                    </div>
                  </div>
                </>
              ) : structuredFailure ? (
                <div
                  className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-amber-100"
                  role="status"
                  aria-label={`${structuredFailure.title} status`}
                >
                  <div className="flex items-start gap-2">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden="true" />
                    <div className="min-w-0">
                      <div className="font-medium">{structuredFailure.title}</div>
                      <p className="mt-1 text-xs text-amber-100/80">{structuredFailure.description}</p>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                    <span className={`rounded border px-1.5 py-0.5 ${
                      structuredFailure.retryable
                        ? 'border-emerald-400/30 text-emerald-200'
                        : 'border-amber-300/30 text-amber-200'
                    }`}>
                      {structuredFailure.retryable ? 'Retry available' : 'Retry unavailable'}
                    </span>
                    {structuredFailure.retryable && onRetryStructuredTask && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-8 justify-center text-xs"
                        onClick={() => onRetryStructuredTask(msg.structuredTask!, msg.id)}
                        disabled={retryPending}
                        aria-label={`Retry ${msg.structuredTask === 'analyze' ? 'analysis' : 'code review'}`}
                      >
                        {retryPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="mr-1.5 h-3.5 w-3.5" />}
                        {retryPending ? 'Retrying…' : `Retry ${msg.structuredTask === 'analyze' ? 'analysis' : 'code review'}`}
                      </Button>
                    )}
                  </div>
                  {!structuredFailure.retryable && (
                    <p className="mt-2 text-[11px] text-amber-100/70">
                      Update the AI setup before starting a new attempt.
                    </p>
                  )}
                </div>
              ) : (
                <>
                  {partialProviderResponse && (
                    <div className="mb-2 whitespace-pre-wrap border-b border-border/40 pb-2">
                      {partialProviderResponse}
                    </div>
                  )}
                  {preservedFailureReport ? (
                    <div className="mb-2 whitespace-pre-wrap">{preservedFailureReport}</div>
                  ) : (
                    <div className="mb-2 whitespace-pre-wrap">{safeFailureMessage}</div>
                  )}
                  <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-amber-200">
                    <div className="font-medium">
                      {msg.outcome === 'INTERRUPTED' ? 'Execution interrupted' : 'Execution failed'}
                    </div>
                    <div className="mt-1 text-[10px] uppercase tracking-wide text-amber-300/80">{failureKindLabel}</div>
                    {msg.recoveryState && msg.recoveryState !== 'NONE' && (
                      <div className="mt-1 text-[10px] opacity-70">
                        {msg.recoveryState === 'REQUIRED' ? 'Recovery required' : 'Additional evidence is required'}
                      </div>
                    )}
                  </div>
                   {canRetryProjectQuery && (
                     <ProjectQueryRetryButton
                       rateLimited={rateLimitedProjectQueryRetry}
                       retryAt={rateLimitedProjectQueryRetry ? projectQueryRateLimitRetryAt(msg) : null}
                       pending={Boolean(projectQueryRetryPending)}
                       onRetry={() => onRetryProjectQuery?.(msg.id)}
                     />
                   )}
                  <AcceptanceDispositionNotice disposition={msg.acceptanceDisposition} />
                </>
              )}
            </>
          ) : isUser ? userFacingContent : capabilityProbeReport ? (
            <CapabilityProbeReport
              content={msg.content}
              trace={toolTrace}
              report={capabilityProbeReport}
            />
          ) : (
            <ReactMarkdown
              components={{
                p: ({ children }) => <p className="mb-3 leading-7 last:mb-0">{children}</p>,
                ul: ({ children }) => <ul className="mb-3 list-disc space-y-1 pl-5">{children}</ul>,
                ol: ({ children }) => <ol className="mb-3 list-decimal space-y-1 pl-5">{children}</ol>,
                li: ({ children }) => <li className="leading-6">{children}</li>,
                strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                code: ({ children, className }) => (
                  <code className={`${className ?? ''} ${className ? '' : 'break-all'} rounded border border-border/50 bg-background/60 px-1 py-0.5 text-xs font-mono text-sky-100`}>
                    {children}
                  </code>
                ),
                pre: ({ children }) => <pre className="mb-3 max-w-full overflow-x-auto rounded-lg border border-border/60 bg-background/70 p-3 text-xs font-mono leading-5 whitespace-pre">{children}</pre>,
                h1: ({ children }) => <h1 className="mb-3 mt-5 border-b border-border/50 pb-1 text-lg font-bold leading-snug tracking-tight text-foreground first:mt-0">{children}</h1>,
                h2: ({ children }) => <h2 className="mb-2 mt-5 text-base font-semibold leading-snug tracking-tight text-foreground first:mt-0">{children}</h2>,
                h3: ({ children }) => <h3 className="mb-1.5 mt-4 text-sm font-semibold leading-snug text-foreground first:mt-0">{children}</h3>,
                h4: ({ children }) => (
                  <ProjectQuerySourceHeading projectId={projectId}>{children}</ProjectQuerySourceHeading>
                ),
              }}
            >
              {userFacingContent}
            </ReactMarkdown>
          )}
        </div>}
        {!isUser && msg.projection?.kind === 'DELIVERY' && (
          <MissionCapsule
            projection={msg.projection}
            executionId={msg.executionId}
            proposalId={msg.projection.approval?.proposalId}
            readOnly
            hideRecoveryActions
            timelineOpenByDefault
          />
        )}
        {canOfferMissionHandoff && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 px-2 text-[11px]"
            onClick={() => onMissionHandoff?.(msg)}
            disabled={missionHandoffPending}
            data-testid={`button-mission-handoff-${msg.id}`}
          >
            {missionHandoffPending
              ? <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              : <Zap className="mr-1 h-3 w-3" />}
            {missionHandoffPending ? 'Starting mission…' : 'Start as mission'}
          </Button>
        )}
        {canOfferAcceptedFindingMission && projectId && (
          <AcceptedProjectQueryMissionAction
            msg={msg}
            projectId={projectId}
            onHandoffComplete={(mission) => onMissionHandoffComplete?.(mission)}
          />
        )}
        {internalTechnicalDump && (
          <div className="w-full rounded-lg border border-border/40 bg-background/20">
            <button
              type="button"
              onClick={() => setTechnicalDetailsExpanded((expanded) => !expanded)}
              className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-[11px] text-muted-foreground hover:text-foreground"
              aria-expanded={technicalDetailsExpanded}
            >
              <ChevronRight className={`h-3 w-3 transition-transform ${technicalDetailsExpanded ? 'rotate-90' : ''}`} />
              Technical details
            </button>
            {technicalDetailsExpanded && (
              <pre className="max-h-80 overflow-auto border-t border-border/40 p-3 text-[10px] leading-relaxed font-mono whitespace-pre-wrap break-words">{redactedDisplayContent}</pre>
            )}
          </div>
        )}
        {sources.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {sources.map((s) => (
              <Badge key={s} variant="outline" className="max-w-full whitespace-normal break-all text-xs font-mono text-muted-foreground">
                {s}
              </Badge>
            ))}
          </div>
        )}
        {hasEvidenceDetails && (
          <div aria-hidden="true" className="mt-1 flex items-center gap-2 px-1">
            <span className="h-px w-4 shrink-0 bg-sky-400/40" />
            <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-sky-200/70">
              الأدلة وسياق الإجابة
            </span>
            <span className="h-px flex-1 bg-border/60" />
          </div>
        )}
        <div
          role={hasEvidenceDetails ? 'group' : undefined}
          aria-label={hasEvidenceDetails ? 'الأدلة وسياق الإجابة' : undefined}
          className={hasEvidenceDetails
            ? 'flex w-full flex-col gap-3 border-l-2 border-sky-400/20 pl-3'
            : 'flex w-full flex-col gap-0'}
        >
          {!isUser && msg.contextProvenance && (
            <ContextProvenanceCard provenance={msg.contextProvenance} />
          )}
          {!isUser && msg.projectQueryTarget && (
            <ProjectQueryTargetCard decision={msg.projectQueryTarget} />
          )}
          {!isUser && isProjectQueryTurn && (
            <ProjectQueryResponseCard
              source={msg.projectQueryResponseSource}
              fallbackReason={msg.projectQueryResponseFallbackReason}
              acceptanceDisposition={msg.acceptanceDisposition}
              messageId={msg.id}
              executionId={msg.executionId}
              projectId={projectId}
              sessionId={sessionId}
              diagnostic={fallbackDiagnostic}
              diagnosticPending={fallbackDiagnosticPending}
              diagnosticError={fallbackDiagnosticError}
              onExplainFallback={
                onExplainFallback
                && projectId
                && sessionId
                && msg.executionId
                ? () => onExplainFallback(msg)
                : undefined
              }
            />
          )}
          {!isUser && msg.sourceSelectionRecord && (
            <SourceCoveragePanel record={msg.sourceSelectionRecord} />
          )}
          {!isUser && evidenceGraph && <EvidenceGraphPanel graph={evidenceGraph} />}
          {!isUser && <BehaviorEvidencePanel evidence={parseBehaviorEvidence(msg.behaviorEvidence)} projectId={projectId} />}
        </div>
        {!isUser && (
          <TaskResultPanel
            result={msg.taskResult}
            projectId={projectId}
            messageId={msg.id}
            onPlanDecision={onPlanDecision}
            planDecisionPending={planDecisionPending}
            onPlanBuild={onPlanBuild}
            planBuildPending={planBuildPending}
            browserProfileFreshness={browserProfileFreshness}
          />
        )}
        {!isUser && msg.structuredReview && (
          <CodeReviewScopeNotice review={msg.structuredReview} />
        )}
        {!isUser && msg.missionCorrelationReportError && (
          <div className="mt-2 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
            <span className="min-w-0 flex-1">The historical mission report is unavailable, but this conversation is preserved.</span>
            {onRegenerateReport && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 shrink-0 px-2 text-[11px]"
                onClick={() => onRegenerateReport(msg.id)}
                disabled={reportRegenerationPending}
              >
                {reportRegenerationPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RotateCcw className="mr-1 h-3 w-3" />}
                {reportRegenerationPending ? 'Regenerating…' : 'Regenerate report'}
              </Button>
            )}
          </div>
        )}
        {reportGeneratedAt && (
          <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Clock3 className="h-3 w-3" aria-hidden="true" />
            <span>Report regenerated at </span>
            <time dateTime={reportGeneratedAt}>
              {new Date(reportGeneratedAt).toLocaleString()}
            </time>
          </div>
        )}
        {hasExecutionDetails && (
          <div aria-hidden="true" className="mt-1 flex items-center gap-2 px-1">
            <span className="h-px w-4 shrink-0 bg-primary/40" />
            <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Run details
            </span>
            <span className="h-px flex-1 bg-border/60" />
          </div>
        )}
        <div
          role={hasExecutionDetails ? 'group' : undefined}
          aria-label={hasExecutionDetails ? 'Run details' : undefined}
          className={hasExecutionDetails
            ? 'flex w-full flex-col gap-3 border-l-2 border-primary/20 pl-3'
            : 'flex w-full flex-col gap-0'}
        >
          {isForensicFallback
            ? <ForensicFallbackBanner
                evidenceOnly={isEvidenceOnlyFallback}
                noFinding={isNoFindingFallback}
              />
            : incompleteBeforeEvidence
              ? null
              : <ExecutionSummaryBanner
                  summary={executionSummary}
                  operatorTraceId={`operator-trace-${msg.id}`}
                  // Generic chats do not show forensic evidence cards, but a
                  // failed provider/connection still needs its persisted
                  // execution stop reason and diagnostic surfaced. Keep this
                  // narrow so successful ordinary chat stays telemetry-free.
                  visible={isForensicRun || isEngineeringExecution || (failedTurn && executionSummary !== null)}
                />}
          {isEngineeringExecution && repairRadar && <RepairRadar trace={activityTrace} />}
          {!isUser && !isChatTurn && <ExecutionLedgerCard snapshot={executionLedger} />}
          {!isUser && !isFactInvestigation && !failedTurn && (isForensicRun || isEngineeringExecution) && (
            <PersistedExecutionProof
              summary={executionSummary}
              trace={activityTrace}
              evidence={forensicEvidence}
              finalVerdict={finalVerdict}
              behaviorEvidenceCount={behaviorEvidenceCount}
              traceId={`operator-trace-${msg.id}`}
            />
          )}
          {!isChatTurn && (
            <CompletedActivityTimeline
              events={activityEvents}
              defaultOpen={false}
            />
          )}
          {!isChatTurn && (
            <SemanticTraceCard
              productionTrace={productionTrace}
              crossFileTraces={crossFileTraces}
            />
          )}
          {forensicEvidence && (
            <ForensicEvidenceCard
              evidence={forensicEvidence}
              // Task #43: keep the forensic card expanded by default whenever the
              // audit is fixture-local, so the FIXTURE-LOCAL / NOT PROVEN
              // separation is never hidden behind a collapsed card.
              defaultExpanded={isForensicFallback || forensicEvidence.forensicStatus?.auditScope === 'FIXTURE_LOCAL'}
              finalVerdict={finalVerdict}
              // NI-35: ship the claim-bound behavioral evidence so the card can
              // render "these lines prove this behavior" instead of just the
              // raw list of files that were read.
              claimEvidence={parseBehaviorEvidence(msg.behaviorEvidence)}
            />
          )}
          {isEngineeringExecution && <FlightRecorder trace={activityTrace} />}
        </div>
      </div>
    </div>
  );
}
