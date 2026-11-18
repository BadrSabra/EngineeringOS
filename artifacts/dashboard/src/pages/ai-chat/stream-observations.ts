import type { Dispatch, SetStateAction } from 'react';
import type {
  AiChatStreamCallbacks,
  AiExecutionNodeSnapshot,
  AiStreamBehaviorProgressEvent,
} from '@workspace/api-client-react';
import type { LiveAgentActivityEvent, LiveAgentToolStep } from './live-activity';
import { liveStageDisplayLabel, liveToolLabel, PLAN_STAGE_LABELS } from './live-activity';
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
        label: 'تم تحميل خطة التنفيذ',
        detail: `عدد العقد: ${event.nodes.length}`,
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
      appendLiveActivityEvent({ kind: 'stage', label: liveStageDisplayLabel(detail), status: 'info' });
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
        label: `${PLAN_STAGE_LABELS[event.stage] ?? 'نشاط الخطة'}${event.stepTitle ? ` · ${event.stepTitle}` : ''}`,
        detail: event.approvalRequired
          ? `الموافقة مطلوبة قبل تغيير الملفات: ${files?.join(', ') || 'approved files'}`
          : event.resultSummary ?? (event.nextStepTitle ? `التالي: ${event.nextStepTitle}` : undefined),
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
          ? 'اجتاز التحقق'
          : status === 'blocked' ? 'حُظر التحقق' : 'فشل التحقق',
        detail: [
          event.validation.profile,
          event.repairState.replace(/_/g, ' '),
          `المحاولة ${event.attempt}/${event.maxAttempts}`,
          event.validation.exitCode != null ? `رمز الخروج ${event.validation.exitCode}` : undefined,
          event.validation.evidence.screenshotAvailable ? 'تم التقاط لقطة شاشة' : undefined,
          event.validation.evidence.consoleErrorCount
            ? `${event.validation.evidence.consoleErrorCount} أخطاء في وحدة التحكم`
            : undefined,
          event.validation.detail,
        ].filter(Boolean).join(' · '),
        status: status === 'passed' ? 'done' : 'info',
      });
    },
    onRepairState: (event) => {
      if (!isCurrent()) return;
      const stageLabel = event.state === 'VALIDATING'
        ? 'Repair loop validating'
        : event.state === 'REPAIRING'
          ? 'Repair correction allowed'
          : event.state === 'READY_FOR_REVIEW'
            ? 'Ready for review'
            : 'Repair blocked';
      const label = event.state === 'VALIDATING'
        ? 'يجري التحقق ضمن دورة الإصلاح'
        : event.state === 'REPAIRING'
          ? 'سُمح بإجراء تصحيح'
          : event.state === 'READY_FOR_REVIEW'
            ? 'جاهز للمراجعة'
            : 'تم حظر الإصلاح';
      setAgentStage(stageLabel);
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
        label: 'استجابة النموذج',
        detail: 'تم استلام استجابة مزوّد الخدمة',
        status: 'info',
      });
    },
    onThinking: (event) => {
      if (!isCurrent()) return;
      setAgentIter({ iter: event.iter, max: event.max });
      appendLiveActivityEvent({
        kind: 'iteration',
        label: 'تكرار النموذج',
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
        label: 'حاجز حماية التنفيذ',
        detail: event.code === 'REPEATED_TOOL_CALL' ? `تم رصد تكرار الأداة ${event.tool}` : event.code,
        status: 'info',
      });
    },
    onSynthesisStart: (event) => {
      if (!isCurrent()) return;
      setAgentStage(`Synthesizing from gathered evidence (${event.iter + 1}/${event.max})`);
      appendLiveActivityEvent({
        kind: 'synthesis',
        label: 'بدأ تركيب النتائج',
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
          ? 'سياسة المرحلة منعت الإجراء'
          : 'تشخيص التنفيذ',
        detail: event.code === 'EXECUTION_PHASE_TOOL_REJECTED' && event.phase && event.tool
          ? `رُفضت الأداة ${event.tool} خلال المرحلة ${event.phase} (${event.code})`
          : detail ? `${event.code} — ${detail}` : event.code,
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
        label: 'أُضيف فحص المشروع إلى قائمة الانتظار',
        detail: `معرّف المهمة: ${event.jobId.slice(0, 8)}`,
        status: 'active',
      });
    },
    onScanProgress: (event) => {
      if (!isCurrent()) return;
      const stageLabel = event.status === 'running'
        ? 'Project scan running'
        : event.status === 'queued'
          ? 'Project scan queued'
          : event.status === 'completed'
            ? 'Project scan completed'
            : 'Project scan failed';
      const label = event.status === 'running'
        ? 'فحص المشروع قيد التنفيذ'
        : event.status === 'queued'
          ? 'أُضيف فحص المشروع إلى قائمة الانتظار'
          : event.status === 'completed'
            ? 'اكتمل فحص المشروع'
            : 'فشل فحص المشروع';
      setAgentStage(stageLabel);
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
      const stageLabel = succeeded ? 'Project scan completed' : 'Project scan failed';
      const label = succeeded ? 'اكتمل فحص المشروع' : 'فشل فحص المشروع';
      setAgentStage(stageLabel);
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
        label: 'حالة التدقيق',
        detail: state === 'Evidence verified'
          ? 'تم التحقق من الأدلة'
          : state === 'Evidence unavailable — audit incomplete'
            ? 'الأدلة غير متاحة؛ التدقيق غير مكتمل'
            : state === 'Audit remains incomplete'
              ? 'ما زال التدقيق غير مكتمل'
              : 'تم تحديث حالة الأدلة',
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
        label: 'التحقق من الإجابة',
        detail: `${event.acceptedEvidenceCount > 0 ? 'اكتمل التحقق من الأدلة' : 'تم تسجيل حالة التحقق؛ الأدلة النهائية ما زالت معلّقة'} (${event.acceptedEvidenceCount}/${event.evidenceCount} مقبولة)`,
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
