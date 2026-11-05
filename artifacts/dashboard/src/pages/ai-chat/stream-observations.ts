import type { Dispatch, SetStateAction } from 'react';
import type {
  AiChatStreamCallbacks,
  AiExecutionNodeSnapshot,
  AiStreamBehaviorProgressEvent,
} from '@workspace/api-client-react';
import type { LiveAgentActivityEvent, LiveAgentToolStep } from './live-activity';
import { liveToolLabel, PLAN_STAGE_LABELS } from './live-activity';
import { CHAT_STAGE_LABELS } from './stream-errors';

export type LiveEvidenceIntegrity = {
  consistent: boolean;
  violations: string[];
  objectiveType?: string;
  requiredEdges: string[];
  provenEdges: string[];
  completionGateResult?: string;
  finalAnswerType?: 'PRODUCTION_REACHABILITY_ANSWER' | 'BEHAVIORAL_ANSWER' | 'NO_ANSWER';
  objectiveVerdict?: 'ANSWER_COMPLETE' | 'ANSWER_PARTIAL' | 'RECOVERY_REQUIRED' | 'OBJECTIVE_BLOCKED';
};

export type LiveVerdictScope = {
  scope?: 'PRODUCTION' | 'FIXTURE_LOCAL' | 'TEST_LOCAL' | 'SPEC_LOCAL' | 'MIXED' | 'NOT_PROVEN';
  findingStatus?: 'PRODUCTION_PROVEN' | 'FIXTURE_PROVEN' | 'TEST_PROVEN' | 'MIXED_EVIDENCE' | 'NOT_PROVEN';
  objectiveVerdict?: 'ANSWER_COMPLETE' | 'ANSWER_PARTIAL' | 'RECOVERY_REQUIRED' | 'OBJECTIVE_BLOCKED';
};

type ObservationCallbacks = Pick<AiChatStreamCallbacks,
  | 'onStage'
  | 'onExecutionNodes'
  | 'onDelta'
  | 'onToolCall'
  | 'onToolResult'
  | 'onPlanActivity'
  | 'onValidation'
  | 'onRepairState'
  | 'onModelCall'
  | 'onThinking'
  | 'onExecutionGuard'
  | 'onSynthesisStart'
  | 'onExecutionDiagnostic'
  | 'onForensicStatus'
  | 'onScanStarted'
  | 'onScanProgress'
  | 'onScanCompleted'
  | 'onAuditState'
  | 'onBehaviorProgress'
  | 'onVerification'
  | 'onEvidenceIntegrity'
  | 'onDecisionTrace'
>;

type ObservationActions = {
  isCurrent: () => boolean;
  ownsExecution: (executionId: string) => boolean;
  setExecutionNodes: Dispatch<SetStateAction<AiExecutionNodeSnapshot[]>>;
  setStreamingContent: Dispatch<SetStateAction<string>>;
  setAgentStage: Dispatch<SetStateAction<string | null>>;
  setAgentSteps: Dispatch<SetStateAction<LiveAgentToolStep[]>>;
  setAgentIter: Dispatch<SetStateAction<{ iter: number; max: number } | null>>;
  setAgentModel: Dispatch<SetStateAction<string | null>>;
  setAgentDiagnostics: Dispatch<SetStateAction<string[]>>;
  setLiveFixtureLocal: Dispatch<SetStateAction<boolean>>;
  setLiveAuditScopeDescription: Dispatch<SetStateAction<string | null>>;
  setLiveBehaviorProgress: Dispatch<SetStateAction<AiStreamBehaviorProgressEvent | null>>;
  setLiveEvidenceIntegrity: Dispatch<SetStateAction<LiveEvidenceIntegrity | null>>;
  setLiveVerdictScope: Dispatch<SetStateAction<LiveVerdictScope | null>>;
  appendLiveActivityEvent: (event: Omit<LiveAgentActivityEvent, 'id'>) => number;
  completeActiveToolActivity: (
    toolCallId: string | undefined,
    tool: string,
    source?: string,
    cached?: boolean,
  ) => void;
};

/**
 * Presentation-only callbacks for live stream events. Session ownership,
 * execution persistence, terminal acceptance, and error recovery stay with
 * AiChat's lifecycle callbacks.
 */
export function createStreamObservationCallbacks({
  isCurrent,
  ownsExecution,
  setExecutionNodes,
  setStreamingContent,
  setAgentStage,
  setAgentSteps,
  setAgentIter,
  setAgentModel,
  setAgentDiagnostics,
  setLiveFixtureLocal,
  setLiveAuditScopeDescription,
  setLiveBehaviorProgress,
  setLiveEvidenceIntegrity,
  setLiveVerdictScope,
  appendLiveActivityEvent,
  completeActiveToolActivity,
}: ObservationActions): ObservationCallbacks {
  return {
    onExecutionNodes: (event) => {
      if (!ownsExecution(event.executionId)) return;
      setExecutionNodes(event.nodes);
      appendLiveActivityEvent({
        kind: 'stage',
        label: 'Execution plan loaded',
        detail: `${event.nodes.length} node${event.nodes.length === 1 ? '' : 's'}`,
        status: 'info',
      });
    },
    onDelta: (delta) => {
      if (isCurrent()) setStreamingContent((previous) => previous + delta);
    },
    onStage: (stage) => {
      if (!isCurrent()) return;
      const detail = CHAT_STAGE_LABELS[stage] ?? stage;
      setAgentStage(detail);
      appendLiveActivityEvent({ kind: 'stage', label: 'Stage', detail, status: 'info' });
    },
    onToolCall: (event) => {
      if (!isCurrent()) return;
      const activityId = appendLiveActivityEvent({
        kind: 'tool',
        label: liveToolLabel({ tool: event.tool, args: event.args, done: false, cached: event.cached }),
        ...(event.toolCallId ? { toolCallId: event.toolCallId } : {}),
        tool: event.tool,
        status: 'active',
      });
      setAgentSteps((previous) => [...previous, {
        activityId,
        ...(event.toolCallId ? { toolCallId: event.toolCallId } : {}),
        tool: event.tool,
        args: event.args,
        done: false,
        cached: event.cached,
      }]);
    },
    onToolResult: (event) => {
      if (!isCurrent()) return;
      setAgentSteps((previous) => {
        const targetIndex = [...previous].reverse().findIndex(
          (step) => step.tool === event.tool
            && !step.done
            && (!event.toolCallId || step.toolCallId === event.toolCallId),
        );
        if (targetIndex < 0) return previous;
        const index = previous.length - 1 - targetIndex;
        return previous.map((step, stepIndex) => stepIndex === index
          ? { ...step, done: true, source: event.source, cached: event.cached }
          : step);
      });
      completeActiveToolActivity(
        event.toolCallId,
        event.tool,
        event.source,
        event.cached,
      );
    },
    onPlanActivity: (event) => {
      if (!isCurrent()) return;
      const files = event.files?.slice(0, 12);
      appendLiveActivityEvent({
        kind: 'plan',
        label: `${PLAN_STAGE_LABELS[event.stage] ?? 'Plan activity'}${event.stepTitle ? ` · ${event.stepTitle}` : ''}`,
        detail: event.approvalRequired
          ? `Approval required before changing: ${files?.join(', ') || 'approved files'}`
          : event.resultSummary ?? (event.nextStepTitle ? `Next: ${event.nextStepTitle}` : undefined),
        status: event.status,
      });
    },
    onValidation: (event) => {
      if (!isCurrent()) return;
      const status = event.validation.status;
      const statusLabel = status === 'passed' ? 'passed' : status === 'blocked' ? 'blocked' : status;
      setAgentStage(`Validation ${statusLabel} (${event.attempt}/${event.maxAttempts})`);
      appendLiveActivityEvent({
        kind: 'validation',
        label: status === 'passed'
          ? 'Validation passed'
          : status === 'blocked' ? 'Validation blocked' : 'Validation failed',
        detail: [
          event.validation.profile,
          event.repairState.replace(/_/g, ' '),
          `attempt ${event.attempt}/${event.maxAttempts}`,
          event.validation.exitCode != null ? `exit ${event.validation.exitCode}` : undefined,
          event.validation.evidence.screenshotAvailable ? 'screenshot captured' : undefined,
          event.validation.evidence.consoleErrorCount
            ? `${event.validation.evidence.consoleErrorCount} console error${event.validation.evidence.consoleErrorCount === 1 ? '' : 's'}`
            : undefined,
          event.validation.detail,
        ].filter(Boolean).join(' · '),
        status: status === 'passed' ? 'done' : 'info',
      });
    },
    onRepairState: (event) => {
      if (!isCurrent()) return;
      const label = event.state === 'VALIDATING'
        ? 'Repair loop validating'
        : event.state === 'REPAIRING'
          ? 'Repair correction allowed'
          : event.state === 'READY_FOR_REVIEW'
            ? 'Ready for review'
            : 'Repair blocked';
      setAgentStage(label);
      appendLiveActivityEvent({
        kind: 'repair_state',
        label,
        detail: event.detail,
        status: event.state === 'READY_FOR_REVIEW' ? 'done' : event.state === 'VALIDATING' ? 'active' : 'info',
      });
    },
    onModelCall: () => {
      if (!isCurrent()) return;
      setAgentModel('AI model');
      setAgentStage('Model response received');
      appendLiveActivityEvent({
        kind: 'model',
        label: 'Model response',
        detail: 'Provider response received',
        status: 'info',
      });
    },
    onThinking: (event) => {
      if (!isCurrent()) return;
      setAgentIter({ iter: event.iter, max: event.max });
      appendLiveActivityEvent({
        kind: 'iteration',
        label: 'Model iteration',
        detail: `${event.iter + 1}/${event.max}`,
        status: 'info',
      });
    },
    onExecutionGuard: (event) => {
      if (!isCurrent()) return;
      setAgentStage(event.code === 'REPEATED_TOOL_CALL'
        ? `Execution stopped: repeated ${event.tool}`
        : 'Execution guard stopped the run');
      appendLiveActivityEvent({
        kind: 'guard',
        label: 'Execution guard',
        detail: event.code === 'REPEATED_TOOL_CALL' ? `repeated ${event.tool}` : event.code,
        status: 'info',
      });
    },
    onSynthesisStart: (event) => {
      if (!isCurrent()) return;
      setAgentStage(`Synthesizing from gathered evidence (${event.iter + 1}/${event.max})`);
      appendLiveActivityEvent({
        kind: 'synthesis',
        label: 'Synthesis started',
        detail: `${event.iter + 1}/${event.max}`,
        status: 'active',
      });
    },
    onExecutionDiagnostic: (event) => {
      if (!isCurrent()) return;
      const detail = event.details?.[0];
      const diagnostic = event.code.replace(/^FORENSIC_CONTRACT_/, '').replace(/_/g, ' ').toLowerCase();
      setAgentDiagnostics((previous) => [...previous, detail ? `${diagnostic}: ${detail}` : diagnostic].slice(-4));
      setAgentStage(`Execution diagnostic: ${diagnostic}${detail ? ` — ${detail}` : ''}`);
      appendLiveActivityEvent({
        kind: event.code === 'EXECUTION_PHASE_TOOL_REJECTED' ? 'phase_rejection' : 'diagnostic',
        label: event.code === 'EXECUTION_PHASE_TOOL_REJECTED'
          ? 'Phase policy blocked action'
          : 'Execution diagnostic',
        detail: event.code === 'EXECUTION_PHASE_TOOL_REJECTED' && event.phase && event.tool
          ? `${event.tool} rejected during ${event.phase} phase`
          : detail ? `${diagnostic} — ${detail}` : diagnostic,
        status: 'info',
      });
    },
    onForensicStatus: (event) => {
      if (!isCurrent()) return;
      if (event.isFixtureLocal === true || event.auditScope === 'FIXTURE_LOCAL') {
        setLiveFixtureLocal(true);
      }
      const scopeDescription = (event as typeof event & { scopeDescription?: string }).scopeDescription;
      if (scopeDescription) setLiveAuditScopeDescription(scopeDescription);
    },
    onScanStarted: (event) => {
      if (!isCurrent()) return;
      setAgentStage('Project scan queued');
      appendLiveActivityEvent({
        kind: 'stage',
        label: 'Project scan queued',
        detail: event.jobId.slice(0, 8),
        status: 'active',
      });
    },
    onScanProgress: (event) => {
      if (!isCurrent()) return;
      const label = event.status === 'running'
        ? 'Project scan running'
        : event.status === 'queued'
          ? 'Project scan queued'
          : event.status === 'completed'
            ? 'Project scan completed'
            : 'Project scan failed';
      setAgentStage(label);
      appendLiveActivityEvent({
        kind: 'stage',
        label,
        detail: event.error ?? event.jobId.slice(0, 8),
        status: event.status === 'completed' ? 'done' : event.status === 'failed' ? 'info' : 'active',
      });
    },
    onScanCompleted: (event) => {
      if (!isCurrent()) return;
      const succeeded = event.status === 'completed';
      const label = succeeded ? 'Project scan completed' : 'Project scan failed';
      setAgentStage(label);
      appendLiveActivityEvent({
        kind: 'stage',
        label,
        detail: event.error ?? event.jobId.slice(0, 8),
        status: succeeded ? 'done' : 'info',
      });
    },
    onAuditState: (event) => {
      if (!isCurrent()) return;
      const state = event.sourceCoverage === 'COMPLETE' && event.findingStatus === 'PROVEN'
        ? 'Evidence verified'
        : event.sourceCoverage === 'NONE'
          ? 'Evidence unavailable — audit incomplete'
          : event.findingStatus === 'NOT_PROVEN' || event.repairReadiness === 'BLOCKED'
            ? 'Audit remains incomplete'
            : 'Evidence state updated';
      setAgentStage(state);
      appendLiveActivityEvent({
        kind: 'stage',
        label: 'Audit state',
        detail: state,
        status: state === 'Evidence verified' ? 'done' : 'info',
      });
    },
    onBehaviorProgress: (event) => {
      if (isCurrent()) setLiveBehaviorProgress(event);
    },
    onVerification: (event) => {
      if (!isCurrent()) return;
      const status = event.acceptedEvidenceCount > 0
        ? 'Evidence verification completed'
        : 'Verification state recorded — final evidence pending';
      setAgentStage(status);
      appendLiveActivityEvent({
        kind: 'validation',
        label: 'Response verification',
        detail: `${status} (${event.acceptedEvidenceCount}/${event.evidenceCount} accepted)`,
        status: event.acceptedEvidenceCount > 0 ? 'done' : 'info',
      });
    },
    onEvidenceIntegrity: (event) => {
      if (!isCurrent()) return;
      setLiveEvidenceIntegrity({
        consistent: event.consistent,
        violations: event.violations,
        objectiveType: event.objectiveType,
        requiredEdges: event.requiredEdges ?? [],
        provenEdges: event.provenEdges ?? [],
        completionGateResult: event.completionGateResult,
        finalAnswerType: event.finalAnswerType,
        objectiveVerdict: event.objectiveVerdict,
      });
    },
    onDecisionTrace: (event) => {
      if (!isCurrent()) return;
      setLiveVerdictScope({
        scope: event.verdictScope,
        findingStatus: event.scopedFindingStatus,
        objectiveVerdict: event.objectiveVerdict,
      });
    },
  };
}
