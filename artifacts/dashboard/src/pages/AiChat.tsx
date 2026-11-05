import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useUser } from '@clerk/react';
import { AlertCircle, ArrowUpRight, Bot, ChevronDown, ChevronRight, FileSearch, Loader2, Menu, Plus, RotateCcw, Send, ShieldAlert, ShieldCheck, Trash2, X, XCircle } from 'lucide-react';
import { Link, useLocation, useSearch } from 'wouter';
import { Button } from '@/components/ui/button';
import { AssistantScopeSwitch } from '@/components/AssistantScopeSwitch';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { HOME_GOAL_MAX_LENGTH, STARTER_GOAL_MAX_LENGTH } from '@/lib/home-goal-handoff';
import { GoalDraftNotice, useGoalDraftHandoff } from '@/lib/use-goal-draft-handoff';
import { buildAssistantScopeHref, getAssistantComposerContextId, readAssistantComposerDraft, readAssistantScopeContext, rememberAssistantScopeContext, saveAssistantComposerDraft } from '@/lib/assistant-scope-continuity';
import { type AiChatSessionMissionsResponse, classifyProjectError, emitProjectLoadFailed, getGetAiDeliveryPolicyQueryKey, getGetLocalReviewBranchQueryKey, getListAiChatSessionMissionsQueryKey, getListProjectsQueryKey, isRetryableProjectError, useAiApplyChanges, useAiRebaseChanges, useAiTaskStream, useApproveAiRebasedProposal, useCreateLocalReviewBranch, useExplainAiFallback, useGetActiveProvider, useGetAiDeliveryPolicy, useGetAiExecution, useGetAiPendingProposal, useGetLocalReviewBranch, useGitCommit, useGitPush, useListAiChatMessages, useListAiChatSessionMissions, useListAiChatSessions, useListAiExecutionHistory, useListEvents, useListProjects, useRejectAiChangeProposal, useSetAiChatSessionActiveMission, useUpdateAiDeliveryPolicy } from '@workspace/api-client-react';
import { useRecipeStream } from '@/lib/use-recipe-stream';
import { RecipeProgressPanel } from '@/components/RecipeProgressPanel';
import { CapabilityGapNotice } from '@/components/CapabilityGapNotice';
import { ChatSessionMissionHandoffs } from '@/components/ChatSessionMissionHandoffs';
import { executionCanResume, getExecutionRecoveryView } from '@/lib/execution-recovery-view';
import { resolveExecutionProofPresentation } from '@/lib/execution-proof-presentation';
import { createApplyMissionFromProposal, createMissionFromChat, executeMissionAgentAction, fetchMissionProjection, type MissionProjection, shouldPollMissionProjection } from '@/lib/ai-missions';
import type { AiCodeReview, AiExecutionNodeSnapshot, AiExecutionProjection, AiScanAnalysis } from '@workspace/api-client-react';
import type { PublicValidationResult } from '@workspace/ai-orchestrator';
import { isRunProjectScanRequest } from '@workspace/ai-orchestrator/scan-command';
import { readStoredMissionCorrelationReport } from '@/lib/mission-correlation-report';
import type { ChatMessage, OperationMode, Project } from './ai-chat/types';
import { isFallbackDiagnosticQuestion } from './ai-chat/project-query';
import { type ActiveExecution, BehaviorProgressCard, CandidateValidationProof, type DeliveryLifecycle, type RecoverableDelivery, browserValidationBlockExplanation, inferOperationMode } from './ai-chat/delivery-proof';
import { type AiTaskResult, type RouteMissionRestoration, type Session, type StreamOwner, aiChatSelectionStorageKey, clearAiChatSelection, getStoredAiChatSessionId, isOpaqueSelectionId, parseAiChatRouteTarget, parseAiChatSelection, persistAiChatSelection, persistedCompletedReadFiles, publishAiChatData, sessionForensicStatusLabel } from './ai-chat/session-state';
import { type ActiveProvider, type ApprovedPendingChange, type BehavioralVerification, ModelContractQualityCard, type PendingChange, ProviderReadinessNotice, describeAiError, hasValidationProfile } from './ai-chat/provider-runtime';
import { getFinalForensicVerdict, parseToolTrace } from './ai-chat/trace-parsing';
import { OperationTracePanel } from './ai-chat/execution-trace';
import { PendingChangesCard, PushCommitCard, VerifiedCommitCard } from './ai-chat/pending-changes';
import { ProjectQuerySourceHeading } from './ai-chat/evidence-panels';
import type { PlanDecision } from './ai-chat/task-result-panel';
import { MessageBubble } from './ai-chat/message-bubble';
import { useAiChatCrossTabSync } from './ai-chat/use-cross-tab-sync';
import { usePendingChangesPersistence } from './ai-chat/use-pending-changes-persistence';
import { useProviderMetrics } from './ai-chat/use-provider-metrics';
import { useExecutionAudit } from './ai-chat/use-execution-audit';
import { useSessionsDrawer } from './ai-chat/use-sessions-drawer';
import { useLiveActivity } from './ai-chat/use-live-activity';
import { DeepSeekKeyCard, GeminiKeyCard, GroqKeyCard, OpenRouterKeyCard } from './ai-chat/provider-key-cards';
import { formatCodeReview, formatScanAnalysis, parseStructuredFailureMetadata, structuredTaskPrompt } from './ai-chat/structured-results';
import { describeStreamError, safeStructuredFailure, structuredTaskStageLabel } from './ai-chat/stream-errors';
import { ADDITIONAL_AI_ACTIONS, AI_ACTIONS, COMMON_AI_ACTIONS, LiveAgentActivity, type LiveAgentToolStep, liveToolLabel } from './ai-chat/live-activity';
import { createStreamObservationCallbacks, type LiveEvidenceIntegrity, type LiveVerdictScope } from './ai-chat/stream-observations';
import { createStreamResetCallback } from './ai-chat/stream-recovery';
import { createStreamIdentityCallbacks } from './ai-chat/stream-lifecycle';
import {
  isResumableStreamDisconnect,
  projectCompletedAssistantMessage,
  projectFailedAssistantMessage,
  projectRetainedCompletedExecution,
  projectRetainedFailedExecution,
} from './ai-chat/stream-terminal';
import { AgentExecutionProofPanel, type AgentExecutionProofStatus, historicalAuditDispositionLabel, historicalAuditStatusLabel } from './ai-chat/execution-proof';
export { AI_CHAT_SELECTION_STORAGE_PREFIX, parseAiChatRouteTarget, parseAiChatSelection } from './ai-chat/session-state';
export { BenchmarkMissionControlPanel, auditExportFilename, auditRedactionCategoryLabel, auditExportFailureMessage, historicalAuditStatusLabel, historicalAuditDispositionLabel } from './ai-chat/execution-proof';

export default function AiChat() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const activeMissionSelectionMutation = useSetAiChatSessionActiveMission();
  const fallbackDiagnosticMutation = useExplainAiFallback();
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { isLoaded, user } = useUser();

  const [, setLocation] = useLocation();
  const locationSearch = useSearch();
  const chatRouteTarget = useMemo(
    () => parseAiChatRouteTarget(locationSearch),
    [locationSearch],
  );
  const [routeMissionRestoration, setRouteMissionRestoration] =
    useState<RouteMissionRestoration | null>(null);
  const routeMissionSelectionAttempt = useRef('');
  const hydratedSelectionContextRef = useRef('');
  const lastRouteContextRef = useRef('');
  const currentRouteMissionKey = chatRouteTarget?.projectId
    && chatRouteTarget.sessionId
    && chatRouteTarget.missionId
    ? `${chatRouteTarget.projectId}:${chatRouteTarget.sessionId}:${chatRouteTarget.missionId}`
    : '';
  const currentRouteMissionKeyRef = useRef(currentRouteMissionKey);
  currentRouteMissionKeyRef.current = currentRouteMissionKey;
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [providerSettingsOpen, setProviderSettingsOpen] = useState(false);
  const [deliveryPolicyExpanded, setDeliveryPolicyExpanded] = useState(false);
  const [historicalAuditsExpanded, setHistoricalAuditsExpanded] = useState(false);
  const [moreActionsExpanded, setMoreActionsExpanded] = useState(false);
  const [sessionId, setSessionId] = useState<string | undefined>(undefined);
  // AI-TASK-006: task linkage — read from URL search params so the Tasks page
  // can deep-link to /ai?taskId=<uuid>&projectId=<id> to open a task-aware session.
  const [linkedTaskId] = useState<string | undefined>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('taskId') ?? undefined;
  });
  const [input, setInput] = useState('');
  const draftHandoff = useGoalDraftHandoff({
    ownerId: isLoaded ? user?.id ?? null : null,
    routeProjectId: chatRouteTarget?.projectId,
    routeDraftId: new URLSearchParams(window.location.search).get('goalDraftId'),
    selectedProjectId, input, setInput,
  });
  const [scopeDraftRestored, setScopeDraftRestored] = useState(false);
  const [scopeDraftStorageError, setScopeDraftStorageError] = useState('');
  const restoredScopeDraftKey = useRef('');
  const generalScopeContext = readAssistantScopeContext(user?.id, 'general');
  const generalScopeHref = generalScopeContext
    ? buildAssistantScopeHref(generalScopeContext)
    : '/general-chat';
  const homeGoalNeedsProjectConfirmation = draftHandoff.needsProjectConfirmation;
  const [localMessages, setLocalMessages] = useState<ChatMessage[]>([]);
  const [historicalReportError, setHistoricalReportError] = useState<string | null>(null);
  const [planDecisionPending, setPlanDecisionPending] = useState<string | null>(null);
  const [planBuildPending, setPlanBuildPending] = useState<string | null>(null);
  const [missionHandoffPending, setMissionHandoffPending] = useState<string | null>(null);
  const [pendingChanges, setPendingChanges] = useState<PendingChange[]>([]);
  const [proposalId, setProposalId] = useState<string | undefined>(undefined);
  const [proposalUnavailable, setProposalUnavailable] = useState<string | null>(null);
  const [operationId, setOperationId] = useState<string | undefined>(undefined);
  const [operationMode, setOperationMode] = useState<OperationMode | undefined>(undefined);
  const [proposalRequiresApproval, setProposalRequiresApproval] = useState(false);
  const [proposalRevision, setProposalRevision] = useState<number | undefined>(undefined);
  const [deliveryLifecycle, setDeliveryLifecycle] = useState<DeliveryLifecycle | undefined>(undefined);
  const [validationEvidence, setValidationEvidence] = useState<PublicValidationResult[]>([]);
  const reapprovalApplyRef = useRef<ApprovedPendingChange[] | null>(null);
  const liveProposalRef = useRef<string | null>(null);
  const [verificationResults, setVerificationResults] = useState<Record<string, BehavioralVerification>>({});
  const [commitReadyPaths, setCommitReadyPaths] = useState<string[]>([]);
  const [commitProposalId, setCommitProposalId] = useState<string | undefined>(undefined);
  const [commitMessage, setCommitMessage] = useState('Apply verified AI changes');
  const [pushReady, setPushReady] = useState(false);
  // PR-I: agentStage is now driven by real SSE stage events from the server
  // rather than a client-side timer that rotated through fake labels.
  const [agentStage, setAgentStage] = useState<string | null>(null);
  // Streaming: accumulates raw text deltas while Groq is streaming a response.
  // Cleared to '' once the `done` event arrives and the full message is added.
  const [streamingContent, setStreamingContent] = useState('');
  const {
    send: streamSend,
    cancel: cancelStream,
    isPending: isSending,
    recipeNodes,
    capabilityGap,
  } = useRecipeStream();
  const { send: taskStreamSend, cancel: cancelTaskStream, isPending: isTaskSending } = useAiTaskStream();

  useAiChatCrossTabSync({ qc, selectedProjectId, setSessionId });

  const streamGenerationRef = useRef(0);
  const streamOwnerRef = useRef<StreamOwner | null>(null);
  const { data: operationEventsPage, isLoading: operationEventsLoading } = useListEvents(
    {
      projectId: selectedProjectId,
      ...(operationId ? { correlationId: operationId } : {}),
      limit: 100,
    },
    {
      query: {
        queryKey: ['operation-trace', selectedProjectId, operationId],
        enabled: isLoaded && !!selectedProjectId && !!operationId,
      },
    },
  );
  const operationEvents = operationEventsPage?.events ?? [];

  useEffect(() => {
    return () => {
      if (autoReconnectRef.current.timer !== null) {
        window.clearTimeout(autoReconnectRef.current.timer);
      }
      autoReconnectRef.current = { executionId: null, attempts: 0, timer: null };
      cancelStream();
      cancelTaskStream();
    };
  }, [cancelStream, cancelTaskStream]);

  // Live agent tool-step tracking — updated in real time via SSE callbacks.
  const [agentSteps, setAgentSteps] = useState<LiveAgentToolStep[]>([]);
  const {
    activityEvents: agentActivityEvents,
    activityEventsRef: agentActivityEventsRef,
    behaviorProgress: liveBehaviorProgress,
    setBehaviorProgress: setLiveBehaviorProgress,
    clearActivityEvents: clearLiveActivityEvents,
    appendActivityEvent: appendLiveActivityEvent,
    completeActiveToolActivity,
  } = useLiveActivity();
  const [agentIter, setAgentIter] = useState<{ iter: number; max: number } | null>(null);
  const [agentModel, setAgentModel] = useState<string | null>(null);
  const [agentStartedAt, setAgentStartedAt] = useState<number | null>(null);
  const [agentElapsedSeconds, setAgentElapsedSeconds] = useState(0);
  const [agentModelHistory, setAgentModelHistory] = useState<Array<{ id: string; provider: string }>>([]);
  const [agentDiagnostics, setAgentDiagnostics] = useState<string[]>([]);
  const [structuredRetryMessageId, setStructuredRetryMessageId] = useState<string | null>(null);
  const [projectQueryRetryMessageId, setProjectQueryRetryMessageId] = useState<string | null>(null);
  const [structuredCooldowns, setStructuredCooldowns] = useState<Partial<Record<'analyze' | 'review', string>>>({});
  const structuredTaskRunRef = useRef<{ task: 'analyze' | 'review'; prompt: string; placeholderId: string } | null>(null);
  const [activeExecution, setActiveExecution] = useState<ActiveExecution | null>(null);
  const [historicalExecutionId, setHistoricalExecutionId] = useState<string | null>(null);
  const [executionControlPending, setExecutionControlPending] = useState(false);
  const [resumeRecoveryError, setResumeRecoveryError] = useState<string | null>(null);
  const [resumeRecoveryPending, setResumeRecoveryPending] = useState(false);
  const [missionAgentActionPending, setMissionAgentActionPending] = useState(false);
  const [missionAgentActionNotice, setMissionAgentActionNotice] = useState<string | null>(null);
  const [missionAgentActionError, setMissionAgentActionError] = useState<string | null>(null);
  const missionAgentActionKeys = useRef(new Map<string, string>());
  const resumeRecoveryPendingRef = useRef<string | null>(null);
  // Prevent a manual Resume click from racing an already scheduled automatic
  // reconnect. The resume-token path used to bypass resumeRecoveryPendingRef,
  // allowing both callers to send a second stream for the same execution.
  const resumeStreamExecutionRef = useRef<string | null>(null);
  const autoReconnectRef = useRef<{
    executionId: string | null;
    attempts: number;
    timer: number | null;
  }>({ executionId: null, attempts: 0, timer: null });
  const [executionNodes, setExecutionNodes] = useState<AiExecutionNodeSnapshot[]>([]);
  const activeExecutionRef = useRef<ActiveExecution | null>(null);
  /** True once a live forensic_status SSE step reports isFixtureLocal — lets
   *  LiveAgentActivity show the FIXTURE-LOCAL badge before the report lands. */
  const [liveFixtureLocal, setLiveFixtureLocal] = useState(false);
  /** Task #58: live verdict proof scope + scoped finding status from the
   *  decision_trace SSE event — surfaced during the run, cleared on done so the
   *  persisted forensic card takes over. */
  const [liveVerdictScope, setLiveVerdictScope] = useState<LiveVerdictScope | null>(null);
  const [liveAuditScopeDescription, setLiveAuditScopeDescription] = useState<string | null>(null);
  /** NI-35: live evidence_integrity (EI-012) reconciliation shown during the
   *  stream; cleared on done so the persisted forensic card takes over. */
  const [liveEvidenceIntegrity, setLiveEvidenceIntegrity] = useState<LiveEvidenceIntegrity | null>(null);

  // Keep the opaque resume token across tab refreshes. The server stores only
  // its hash, so losing this browser copy would make a paused execution look
  // resumable while making the actual resume impossible.
  const executionPointerKey = selectedProjectId
    ? `eos_ai_execution_current_${selectedProjectId}`
    : undefined;
  const pointedExecutionSessionId = (() => {
    if (
      !executionPointerKey
      || sessionId
      || (chatRouteTarget?.projectId === selectedProjectId && chatRouteTarget.sessionId)
    ) return undefined;
    const value = localStorage.getItem(executionPointerKey);
    return value && value.trim() ? value : undefined;
  })();
  const executionStorageSessionId = sessionId ?? pointedExecutionSessionId;
  const executionStorageKey = selectedProjectId && executionStorageSessionId
    ? `eos_ai_execution_${selectedProjectId}_${executionStorageSessionId}`
    : undefined;
  const hydratedExecutionScopeRef = useRef<string | null>(null);
  const storedExecution = (() => {
    if (!executionStorageKey) return null;
    try {
      const raw = localStorage.getItem(executionStorageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<ActiveExecution>;
      if (
        typeof parsed.id !== 'string' ||
        typeof parsed.projectId !== 'string' ||
        typeof parsed.sessionId !== 'string' ||
        typeof parsed.message !== 'string'
      ) {
        localStorage.removeItem(executionStorageKey);
        return null;
      }
      if (
        parsed.projectId !== selectedProjectId ||
        parsed.sessionId !== executionStorageSessionId
      ) {
        localStorage.removeItem(executionStorageKey);
        return null;
      }
      return parsed as ActiveExecution & { sessionId: string };
    } catch {
      localStorage.removeItem(executionStorageKey);
      return null;
    }
  })();

  const {
    data: activeExecutionStatus,
    refetch: refetchActiveExecutionStatus,
  } = useGetAiExecution(
    activeExecution?.id ?? '',
    {
      query: {
        queryKey: ['ai-execution', activeExecution?.id],
        enabled: Boolean(activeExecution?.id && isLoaded),
        refetchInterval: isSending || isTaskSending ? 5_000 : 15_000,
        refetchOnMount: 'always',
        refetchOnWindowFocus: true,
      },
    },
  );

  const {
    data: historicalAudits = [],
    isLoading: historicalAuditsLoading,
    isError: historicalAuditsError,
  } = useListAiExecutionHistory(
    { projectId: selectedProjectId, limit: 20 },
    {
      query: {
        queryKey: ['ai-execution-history', selectedProjectId],
        enabled: isLoaded && !!selectedProjectId,
        staleTime: 2_000,
        refetchInterval: 5_000,
        refetchOnWindowFocus: true,
      },
    },
  );

  const {
    auditExportPending,
    auditPreviewPending,
    auditPreview,
    auditPreviewError,
    setAuditPreview,
    setAuditPreviewError,
    previewExecutionAudit,
    exportExecutionAudit,
  } = useExecutionAudit(activeExecution?.id);

  useEffect(() => {
    if (!executionStorageKey || hydratedExecutionScopeRef.current === executionStorageKey) return;
    hydratedExecutionScopeRef.current = executionStorageKey;
    if (!storedExecution) return;
    activeExecutionRef.current = storedExecution;
    setActiveExecution(storedExecution);
    setSessionId((current) => current ?? storedExecution.sessionId);
    setAgentStage('Saved execution recovered — checking server status…');
  }, [executionStorageKey, storedExecution?.id]);

  useEffect(() => {
    if (
      !executionStorageKey ||
      !executionPointerKey ||
      !executionStorageSessionId ||
      !activeExecution
    ) return;
    if (
      activeExecution.projectId !== selectedProjectId ||
      activeExecution.sessionId !== executionStorageSessionId
    ) return;
    localStorage.setItem(
      executionStorageKey,
      JSON.stringify({
        ...activeExecution,
        projectId: selectedProjectId,
        sessionId: executionStorageSessionId,
      }),
    );
    localStorage.setItem(executionPointerKey, executionStorageSessionId);
  }, [
    activeExecution,
    executionPointerKey,
    executionStorageKey,
    executionStorageSessionId,
    selectedProjectId,
  ]);

  useEffect(() => {
    if (!activeExecutionStatus || !activeExecution) return;
    if (
      activeExecution.projectId !== selectedProjectId ||
      activeExecution.sessionId !== sessionId
    ) return;
    if (activeExecutionStatus.status === 'completed' || activeExecutionStatus.status === 'cancelled') {
      const recoveredSessionId = activeExecution.sessionId ?? sessionId;
      if (recoveredSessionId) {
        void qc.invalidateQueries({ queryKey: ['ai-messages', recoveredSessionId] });
        void qc.invalidateQueries({ queryKey: ['ai-pending-proposal', recoveredSessionId] });
      }
      void qc.invalidateQueries({ queryKey: ['ai-sessions', selectedProjectId] });
      // Keep the durable pointer and proof panel after terminal completion.
      // Operators must be able to export the record after a reconnect or
      // refresh, not only while the SSE subscriber is still attached.
      setAgentStage(
        activeExecutionStatus.status === 'completed'
          ? 'Execution completed — audit export is available'
          : 'Execution cancelled — audit export is available',
      );
      if (activeExecution.resumeToken || activeExecution.resumable) {
        const terminalExecution = {
          ...activeExecution,
          resumable: false,
          resumeToken: undefined,
        };
        activeExecutionRef.current = terminalExecution;
        setActiveExecution(terminalExecution);
      }
      return;
    }
    if (activeExecutionStatus.status === 'paused' || activeExecutionStatus.status === 'failed') {
      if (executionCanResume(activeExecutionStatus)) {
        setAgentStage('Automatic recovery is available — resume manually if it remains paused');
      } else {
        setAgentStage('Execution ended — start a new run');
        if (activeExecution.resumeToken || activeExecution.resumable) {
          const nonResumableExecution = {
            ...activeExecution,
            resumable: false,
            resumeToken: undefined,
          };
          activeExecutionRef.current = nonResumableExecution;
          setActiveExecution(nonResumableExecution);
        }
      }
    } else if (activeExecutionStatus.status === 'running' && !isSending && !isTaskSending) {
      setAgentStage('Execution is still running on the server…');
    }
  }, [
    activeExecutionStatus?.status,
    activeExecutionStatus?.linkedTaskId,
    activeExecution?.id,
    activeExecution?.sessionId,
    isSending,
    isTaskSending,
    qc,
    selectedProjectId,
    sessionId,
    executionPointerKey,
    executionStorageKey,
  ]);

  function resetAutoReconnect() {
    const current = autoReconnectRef.current;
    if (current.timer !== null) {
      window.clearTimeout(current.timer);
    }
    autoReconnectRef.current = { executionId: null, attempts: 0, timer: null };
  }

  function scheduleAutoReconnect(execution: ActiveExecution): boolean {
    const current = autoReconnectRef.current;
    const attempts = current.executionId === execution.id ? current.attempts : 0;
    // Automatic reconnects may reuse a token already received from the stream.
    // Fetching a missing capability is reserved for an explicit user action.
    if (attempts >= 3 || !execution.resumeToken) {
      return false;
    }
    if (current.timer !== null) {
      return true;
    }

    const nextAttempts = attempts + 1;
    const delayMs = Math.min(4_000, 750 * nextAttempts);
    autoReconnectRef.current = {
      executionId: execution.id,
      attempts: nextAttempts,
      timer: window.setTimeout(() => {
        autoReconnectRef.current = {
          executionId: execution.id,
          attempts: nextAttempts,
          timer: null,
        };
        void resumeActiveExecution();
      }, delayMs),
    };
    setAgentStage(`Reconnecting to the saved execution… (${nextAttempts}/3)`);
    appendLiveActivityEvent({
      kind: 'stage',
      label: 'Reconnecting',
      detail: `Retry ${nextAttempts} of 3`,
      status: 'info',
    });
    return true;
  }

  function clearExecutionScopedState(options?: { preserveBuildPending?: boolean }) {
    resetAutoReconnect();
    resumeStreamExecutionRef.current = null;
    streamOwnerRef.current = null;
    activeExecutionRef.current = null;
    setActiveExecution(null);
    setExecutionNodes([]);
    setOperationId(undefined);
    setOperationMode(undefined);
    setCommitReadyPaths([]);
    setCommitProposalId(undefined);
    setPushReady(false);
    if (!options?.preserveBuildPending) {
      setPlanBuildPending(null);
      setPlanDecisionPending(null);
    }
  }

  function resetStructuredTaskState() {
    setAgentStage(null);
    setAgentSteps([]);
    setAgentIter(null);
    setAgentModel(null);
    setAgentStartedAt(null);
    setAgentElapsedSeconds(0);
    setAgentModelHistory([]);
    setAgentDiagnostics([]);
    setExecutionNodes([]);
    setLiveFixtureLocal(false);
    setLiveEvidenceIntegrity(null);
    setLiveVerdictScope(null);
  }

  function startStructuredTask(task: 'analyze' | 'review', prompt: string, retryMessageId?: string) {
    if (!selectedProjectId || isTaskSending) return;
    const placeholderId = `${task}-placeholder`;
    const title = task === 'analyze' ? 'Analyzing scan…' : 'Reviewing code…';
    const startLabel = task === 'analyze' ? 'Starting scan analysis' : 'Starting code review';

    structuredTaskRunRef.current = { task, prompt, placeholderId };
    if (!retryMessageId) {
      setLocalMessages((prev) => [
        ...prev,
        { id: placeholderId, role: 'user' as const, content: prompt, createdAt: new Date().toISOString() },
      ]);
    }
    setAgentStage(title);
    setAgentSteps([]);
    clearLiveActivityEvents();
    appendLiveActivityEvent({ kind: 'stage', label: startLabel, status: 'info' });
    setAgentIter(null);
    setAgentModel(null);
    setStreamingContent('');
    setAgentStartedAt(Date.now());
    setAgentElapsedSeconds(0);
    setAgentModelHistory([]);
    setAgentDiagnostics([]);

    void taskStreamSend({
      projectId: selectedProjectId,
      task,
      ...(sessionId ? { sessionId } : {}),
    }, {
      onExecutionStarted: (event) => {
        if (event.sessionId) {
          persistAiChatSelection({
            version: 1,
            projectId: selectedProjectId,
            kind: 'session',
            sessionId: event.sessionId,
          });
          setSessionId(event.sessionId);
          void qc.invalidateQueries({ queryKey: ['ai-sessions', selectedProjectId] });
        }
        const nextExecution: ActiveExecution = {
          id: event.executionId,
          projectId: selectedProjectId,
          ...(event.sessionId ? { sessionId: event.sessionId } : {}),
          ...(event.resumeToken ? { resumeToken: event.resumeToken } : {}),
          resumable: event.resumable,
          proofRequired: false,
          message: prompt,
        };
        activeExecutionRef.current = nextExecution;
        setActiveExecution(nextExecution);
        appendLiveActivityEvent({
          kind: 'stage',
          label: 'Durable execution reserved',
          detail: event.executionId.slice(0, 8),
          status: 'info',
        });
      },
      onTaskStarted: (event) => {
        appendLiveActivityEvent({
          kind: 'stage',
          label: `${event.task === 'analyze' ? 'Analysis' : 'Review'} task accepted`,
          status: 'done',
        });
      },
      onStage: (stage) => {
        const label = structuredTaskStageLabel(stage);
        setAgentStage(label);
        appendLiveActivityEvent({ kind: 'stage', label, status: stage === 'completed' ? 'done' : 'active' });
      },
      onTaskProgress: (event) => {
        appendLiveActivityEvent({
          kind: 'stage',
          label: event.message,
          status: 'info',
        });
      },
      onModelCall: (event) => {
        setAgentModel('AI model');
        appendLiveActivityEvent({
          kind: 'model',
          label: 'Model response',
          detail: 'Provider response received',
          status: 'info',
        });
      },
      onTaskDone: (event) => {
        appendLiveActivityEvent({
          kind: 'stage',
          label: task === 'analyze' ? 'Analysis result received' : 'Review result received',
          status: 'done',
        });
        const activityEvents = agentActivityEventsRef.current;
        setStructuredRetryMessageId(null);
        structuredTaskRunRef.current = null;
        resetStructuredTaskState();
        setLocalMessages((prev) => [
          ...prev.filter((message) => message.id !== placeholderId),
          {
            id: `${task}-${Date.now()}`,
            role: 'assistant' as const,
            content: task === 'analyze'
              ? formatScanAnalysis(event.result as unknown as AiScanAnalysis)
              : formatCodeReview(event.result as unknown as AiCodeReview),
            activityEvents,
            structuredTask: task,
            structuredReview: task === 'review'
              ? event.result as unknown as AiCodeReview
              : null,
            createdAt: new Date().toISOString(),
          },
        ]);
        if (event.executionId) {
          void qc.invalidateQueries({ queryKey: ['ai-messages', activeExecutionRef.current?.sessionId ?? sessionId] });
          void qc.invalidateQueries({ queryKey: ['ai-sessions', selectedProjectId] });
        }
      },
      onError: (err) => {
        const failureEvents = agentActivityEventsRef.current;
        const failure = safeStructuredFailure(err, task);
        if (err.retryAt && Date.parse(err.retryAt) > Date.now()) {
          setStructuredCooldowns((previous) => ({ ...previous, [task]: err.retryAt }));
        }
        const admissionRejected = err.failureKind === 'RATE_LIMIT' && !err.executionId;
        if (admissionRejected) {
          if (err.sessionId) {
            persistAiChatSelection({
              version: 1,
              projectId: selectedProjectId,
              kind: 'session',
              sessionId: err.sessionId,
            });
            setSessionId(err.sessionId);
            void qc.invalidateQueries({ queryKey: ['ai-messages', err.sessionId] });
            void qc.invalidateQueries({ queryKey: ['ai-sessions', selectedProjectId] });
          }
          resetStructuredTaskState();
          setStructuredRetryMessageId(null);
          setLocalMessages((prev) => prev.filter((message) => message.id !== placeholderId));
          const seconds = err.retryAt && Date.parse(err.retryAt) > Date.now()
            ? Math.max(1, Math.ceil((Date.parse(err.retryAt) - Date.now()) / 1_000))
            : undefined;
          toast({
            title: 'Retry is waiting for the provider',
            description: seconds
              ? `The server is already waiting for the provider. Try again in about ${seconds} seconds.`
              : 'The server is already waiting for the provider. Try again after it recovers.',
          });
          return;
        }
        if (err.sessionId) {
          persistAiChatSelection({
            version: 1,
            projectId: selectedProjectId,
            kind: 'session',
            sessionId: err.sessionId,
          });
          setSessionId(err.sessionId);
          void qc.invalidateQueries({ queryKey: ['ai-messages', err.sessionId] });
          qc.setQueryData<Session[]>(
            ['ai-sessions', selectedProjectId],
            (previous = []) => previous.some((session) => session.id === err.sessionId)
              ? previous
              : [
                  {
                    id: err.sessionId!,
                    title: task === 'review' ? 'Code review' : 'Scan analysis',
                    updatedAt: new Date().toISOString(),
                  },
                  ...previous,
                ],
          );
        }
        resetStructuredTaskState();
        setStructuredRetryMessageId(null);
        setLocalMessages((prev) => [
          ...prev.filter((message) => message.id !== placeholderId),
          {
            id: `${task}-failed-${Date.now()}`,
            role: 'assistant' as const,
            content: failure.reason,
            outcome: err.outcome ?? 'FAILED',
            errorCode: err.code,
            errorMessage: failure.reason,
            failureKind: err.failureKind,
            retryable: err.retryable ?? err.failureKind !== 'CONFIGURATION',
            structuredTask: task,
            activityEvents: failureEvents,
            createdAt: new Date().toISOString(),
          },
        ]);
      },
      onStreamReset: () => {
        const execution = activeExecutionRef.current;
        if (execution) {
          setAgentStage('Connection interrupted — checking the saved execution…');
          void refetchActiveExecutionStatus()
            .then(({ data: status }) => {
              if (!status || status.id !== execution.id) return;
              if (status.status === 'completed' || status.status === 'failed' || status.status === 'cancelled') {
                if (status.sessionId) {
                  void qc.invalidateQueries({ queryKey: ['ai-messages', status.sessionId] });
                  void qc.invalidateQueries({ queryKey: ['ai-sessions', selectedProjectId] });
                  setSessionId(status.sessionId);
                }
                setAgentStage(
                  status.status === 'completed'
                    ? 'Execution completed — restoring the saved result…'
                    : 'Execution ended — restoring the saved result…',
                );
                return;
              }
              setAgentStage('Execution is still running on the server…');
            })
            .catch(() => {
              setAgentStage('Connection interrupted — the server is still being checked…');
            });
          return;
        }
        const failureEvents = agentActivityEventsRef.current;
        const failure = safeStructuredFailure(
          { type: 'error', code: 'transport_interrupted', message: '', failureKind: 'TRANSPORT', outcome: 'INTERRUPTED' },
          task,
        );
        resetStructuredTaskState();
        setStructuredRetryMessageId(null);
        setLocalMessages((prev) => [
          ...prev.filter((message) => message.id !== placeholderId),
          {
            id: `${task}-interrupted-${Date.now()}`,
            role: 'assistant' as const,
            content: failure.reason,
            outcome: 'INTERRUPTED',
            errorCode: 'transport_interrupted',
            errorMessage: failure.reason,
            failureKind: 'TRANSPORT',
            retryable: true,
            structuredTask: task,
            activityEvents: failureEvents,
            createdAt: new Date().toISOString(),
          },
        ]);
      },
    });
  }

  function retryStructuredTask(task: 'analyze' | 'review', messageId: string) {
    const activeRun = structuredTaskRunRef.current;
    if (structuredRetryMessageId || isTaskSending) return;
    const retryAt = structuredCooldowns[task]
      ?? activeExecutionStatus?.acceptance?.disposition?.retryAt;
    if (
      retryAt
      && Date.parse(retryAt) > Date.now()
    ) {
      const seconds = Math.max(1, Math.ceil((Date.parse(retryAt) - Date.now()) / 1_000));
      toast({
        title: 'Retry is waiting for the provider',
        description: `Try again in about ${seconds} second${seconds === 1 ? '' : 's'}.`,
      });
      return;
    }
    if (retryAt) {
      setStructuredCooldowns((previous) => {
        const next = { ...previous };
        delete next[task];
        return next;
      });
    }
    const run = activeRun?.task === task
      ? activeRun
      : {
          task,
          prompt: structuredTaskPrompt(task),
          placeholderId: `${task}-placeholder`,
        };
    setStructuredRetryMessageId(messageId);
    startStructuredTask(task, run.prompt, messageId);
  }

  async function retryProjectQuery(messageId: string) {
    if (projectQueryRetryMessageId || isSending || !sessionId) return;
    const failedMessageIndex = messages.findIndex((message) => message.id === messageId);
    const failedMessage = failedMessageIndex >= 0 ? messages[failedMessageIndex] : undefined;
    const originalUserMessage = failedMessageIndex >= 0
      ? [...messages.slice(0, failedMessageIndex)]
        .reverse()
        .find((message) => message.role === 'user')
        ?.content
        ?.trim()
      : undefined;
    const activeExecution = activeExecutionRef.current;
    const executionId = failedMessage?.executionId ?? activeExecution?.id;
    const resumableActiveExecution =
      activeExecution && activeExecution.id === executionId ? activeExecution : undefined;
    const taskLinkedExecution = (
      activeExecutionStatus && activeExecutionStatus.id === executionId
        ? activeExecutionStatus.linkedTaskId
        : undefined
    ) ?? resumableActiveExecution?.linkedTaskId;
    if (taskLinkedExecution) {
      toast({
        title: 'Task recovery is managed by Tasks',
        description: 'Open the owning Task to resume or retry this execution.',
      });
      return;
    }
    const messageToResume = originalUserMessage || resumableActiveExecution?.message.trim();
    if (!executionId || !messageToResume) {
      toast({
        title: 'Retry unavailable',
        description: 'The original project question or execution identity is no longer available.',
        variant: 'destructive',
      });
      return;
    }

    setProjectQueryRetryMessageId(messageId);
    // Targeted PROJECT_QUERY runs are intentionally not resumable after an
    // incomplete proof result. They must create a fresh execution so the
    // server can rebuild the objective scope instead of replaying an
    // evidence-incomplete attempt. General project orientation can resume
    // only when the server-owned acceptance still authorizes it. Historical
    // messages may omit projectQueryTarget or acceptanceDisposition, so use
    // the durable execution status when it is available.
    const durableNextActionCode =
      failedMessage?.acceptanceDisposition?.nextActionCode
      ?? failedMessage?.terminalProjection?.nextActionCode
      ?? (activeExecutionStatus?.id === executionId
        ? activeExecutionStatus.acceptance?.nextActionCode
        : undefined);
    const retryAfterRateLimit = Boolean(failedMessage?.projectQueryTarget)
      && failedMessage?.providerFailureCategory === 'RATE_LIMITED'
      && durableNextActionCode === 'RETRY_AFTER_RATE_LIMIT';
    const requiresFreshProjectQueryRun =
      !retryAfterRateLimit && (
        Boolean(failedMessage?.projectQueryTarget)
        || durableNextActionCode === 'START_NEW_PROBE'
        || durableNextActionCode === 'REVIEW_INCOMPLETE_EVIDENCE'
        || durableNextActionCode === 'ABANDON_EXECUTION'
        || (activeExecutionStatus?.id === executionId && !executionCanResume(activeExecutionStatus))
      );
    if (requiresFreshProjectQueryRun) {
      sendMessage('retry');
      return;
    }

    try {
      let resumeToken =
        activeExecution?.id === executionId ? activeExecution.resumeToken : undefined;
      if (!resumeToken) {
        const response = await fetch(
          `/api/ai/executions/${encodeURIComponent(executionId)}/${retryAfterRateLimit ? 'retry-capability' : 'resume-capability'}`,
          {
            method: 'POST',
            credentials: 'include',
            headers: { Accept: 'application/json' },
          },
        );
        const body = await response.json().catch(() => ({})) as {
          executionId?: string;
          resumeToken?: string;
          error?: string;
        };
        if (!response.ok || body.executionId !== executionId || !body.resumeToken) {
          throw new Error(body.error || 'Resume is no longer available for this execution.');
        }
        resumeToken = body.resumeToken;
      }
      sendMessage(messageToResume, {
        executionId,
        resumeToken,
        sessionId: resumableActiveExecution?.sessionId,
      });
    } catch (error) {
      setProjectQueryRetryMessageId(null);
      toast({
        title: 'Retry unavailable',
        description: error instanceof Error ? error.message : 'The saved execution could not be resumed.',
        variant: 'destructive',
      });
    }
  }

  const { data: activeProvider } = useGetActiveProvider<ActiveProvider>({
    query: {
      queryKey: ['active-provider'],
      staleTime: 30_000,
      refetchInterval: 10_000,
      refetchOnWindowFocus: true,
    },
  });

  const { pendingKey, verificationKey } = usePendingChangesPersistence({
    sessionId,
    pendingChanges,
    setPendingChanges,
    verificationResults,
    setVerificationResults,
  });

  // Use the generated hook (same URL and auth path as Projects.tsx) so this
  // query uses customFetch — which throws ApiError on non-2xx, preserving the
  // HTTP status through to the error classifier below.
  const {
    data: rawProjects,
    isLoading: projectsLoading,
    error: projectsError,
  } = useListProjects(undefined, {
    query: {
      queryKey: getListProjectsQueryKey(),
      // Wait for Clerk to finish loading before the very first request so we
      // don't race the browser's own session cookie hydration.
      enabled: isLoaded,
      // Classify each failure to decide whether to retry automatically.
       // Clerk can briefly return 401 while its browser session cookie is
       // refreshed during a long-running AI stream. Retry only when Clerk has
       // already loaded a signed-in user; an unauthenticated 401 remains
       // terminal and is shown as a real session-expiry error.
       retry: (failureCount, err) =>
         isRetryableProjectError(err, failureCount, 2, isLoaded && !!user),
    },
  });
  const projects = (rawProjects as Project[] | undefined) ?? [];

  const {
    metricsProvider,
    setMetricsProvider,
    metricsWindowDays,
    setMetricsWindowDays,
    qualityExportPending,
    metricsData,
    metricsLoading,
    metricsFetching,
    metricsError,
    refetchMetrics,
    metricsMap,
    activeProviderMetric,
    activeProviderSendBlocked,
    exportQualityReport,
  } = useProviderMetrics({ selectedProjectId, projects, activeProvider, isLoaded });

  // Derive a classified failure record once and reuse it in all three places
  // where error text is shown — status, kind, and message are all in one place.
  const projectLoadFailure = projectsError ? classifyProjectError(projectsError) : null;

  // Emit telemetry whenever a project-load failure is first observed.
  // TanStack Query v5 removed onError from query options; useEffect is the
  // correct place for side-effects on state changes.
  useEffect(() => {
    if (projectsError) emitProjectLoadFailed(projectsError, { userId: user?.id });
  }, [projectsError, user?.id]);

  const requestedSessionId = (chatRouteTarget?.projectId === selectedProjectId
    ? chatRouteTarget.sessionId
    : undefined)
    ?? sessionId
    ?? (selectedProjectId ? getStoredAiChatSessionId(selectedProjectId) : undefined);

  const {
    data: sessions = [],
    isFetched: sessionsFetched,
    isError: sessionsError,
  } = useListAiChatSessions<Session[]>(
    {
      projectId: selectedProjectId ?? '',
      ...(requestedSessionId ? { sessionId: requestedSessionId } : {}),
    },
    {
      query: {
        queryKey: ['ai-sessions', selectedProjectId, requestedSessionId ?? null],
        enabled: isLoaded && !!selectedProjectId,
      },
    },
  );

  useEffect(() => {
    const routeProjectId = chatRouteTarget?.projectId;
    const routeSessionId = chatRouteTarget?.sessionId;
    if (
      !user?.id
      || !routeProjectId
      || routeProjectId !== selectedProjectId
      || !draftHandoff.isReady
      || draftHandoff.activeDraft
    ) return;
    if (routeSessionId) {
      if (
        sessionId !== routeSessionId
        || !sessionsFetched
        || sessionsError
        || !sessions.some((session) => session.id === routeSessionId)
      ) return;
    } else if (sessionId) {
      // A stored session selection is a different context from a new-chat
      // route. Do not place a new-chat draft into that session.
      return;
    }
    const contextId = getAssistantComposerContextId('project', routeProjectId, routeSessionId);
    if (!contextId) return;
    const key = `${user.id}:project:${contextId}`;
    if (restoredScopeDraftKey.current === key) return;
    restoredScopeDraftKey.current = key;
    const stored = readAssistantComposerDraft(user.id, 'project', contextId);
    if (!stored.ok) {
      setScopeDraftStorageError('تعذر استعادة النص غير المرسل لهذه المحادثة من هذا التبويب.');
      return;
    }
    setScopeDraftStorageError('');
    if (stored.text?.trim() && !input.trim()) {
      setInput(stored.text);
      setScopeDraftRestored(true);
    }
  }, [
    user?.id,
    chatRouteTarget,
    selectedProjectId,
    sessionId,
    sessions,
    sessionsFetched,
    sessionsError,
    draftHandoff.isReady,
    draftHandoff.activeDraft,
    input,
  ]);

  // Browser selection state is only trusted after both project-owned lists
  // have loaded. The durable execution pointer is intentionally independent:
  // when it recovered a different session, leave that resumable execution
  // visible rather than allowing a stale selection to replace it.
  useEffect(() => {
    if (!chatRouteTarget?.projectId) return;
    const routeContextKey = [
      chatRouteTarget.projectId,
      chatRouteTarget.sessionId ?? '',
      chatRouteTarget.missionId ?? '',
    ].join('|');
    if (lastRouteContextRef.current === routeContextKey) return;
    lastRouteContextRef.current = routeContextKey;
    routeMissionSelectionAttempt.current = '';
    setRouteMissionRestoration(null);
    if (chatRouteTarget.projectId !== selectedProjectId) {
      setSelectedProjectId(chatRouteTarget.projectId);
    }
  }, [
    chatRouteTarget?.projectId,
    chatRouteTarget?.sessionId,
    chatRouteTarget?.missionId,
    selectedProjectId,
  ]);

  useEffect(() => {
    if (
      !selectedProjectId
      || !sessionsFetched
      || sessionsError
    ) {
      return;
    }

    const routeContextKey = chatRouteTarget?.projectId === selectedProjectId
      ? JSON.stringify([selectedProjectId, chatRouteTarget.sessionId ?? null, chatRouteTarget.missionId ?? null])
      : JSON.stringify([selectedProjectId, null, null]);
    const selectionContextKey = `${selectedProjectId}:${routeContextKey}`;
    if (hydratedSelectionContextRef.current === selectionContextKey) return;

    let rawSelection: string | null = null;
    try {
      rawSelection = localStorage.getItem(aiChatSelectionStorageKey(selectedProjectId));
    } catch {
      return;
    }
    const routeSessionId = chatRouteTarget?.projectId === selectedProjectId
      ? chatRouteTarget.sessionId
      : undefined;
    const routeSelection = routeSessionId && sessions.some((session) => session.id === routeSessionId)
      ? {
          version: 1 as const,
          projectId: selectedProjectId,
          kind: 'session' as const,
          sessionId: routeSessionId,
        }
      : null;
    const selection = routeSessionId
      ? routeSelection
      : parseAiChatSelection(rawSelection, selectedProjectId);
    if (!selection) {
      hydratedSelectionContextRef.current = selectionContextKey;
      if (rawSelection !== null) clearAiChatSelection(selectedProjectId);
      if (routeSessionId) {
        // A stale deep link must not silently fall back to a saved execution
        // from another conversation.
        setLocalMessages([]);
        clearExecutionScopedState();
        setSessionId(undefined);
      }
      return;
    }
    if (selection.kind === 'historical-audit' && historicalAuditsLoading) return;
    hydratedSelectionContextRef.current = selectionContextKey;

    const recoveredExecution = Boolean(
      storedExecution
      && storedExecution.projectId === selectedProjectId,
    );

    const resetVisibleSelection = (preserveRecoveredExecution: boolean) => {
      setLocalMessages([]);
      setPendingChanges([]);
      setProposalId(undefined);
      setProposalUnavailable(null);
      liveProposalRef.current = null;
      setProposalRequiresApproval(false);
      setProposalRevision(undefined);
      setVerificationResults({});
      setHistoricalExecutionId(null);
      setAuditPreview(null);
      setAuditPreviewError(null);
      if (!preserveRecoveredExecution) {
        clearExecutionScopedState();
        setSessionId(undefined);
      }
    };

    if (selection.kind === 'session') {
      if (recoveredExecution && storedExecution?.sessionId !== selection.sessionId && !routeSelection) {
        return;
      }
      if (!sessions.some((session) => session.id === selection.sessionId)) {
        clearAiChatSelection(selectedProjectId);
        resetVisibleSelection(recoveredExecution);
        return;
      }
      resetVisibleSelection(recoveredExecution && storedExecution?.sessionId === selection.sessionId);
      if (routeSelection) persistAiChatSelection(routeSelection);
      setSessionId(selection.sessionId);
      return;
    }

    const audit = historicalAudits.find((candidate) => candidate.id === selection.executionId);
    const linkedSessionId = audit && isOpaqueSelectionId(audit.sessionId)
      ? audit.sessionId
      : undefined;
    if (
      recoveredExecution
      && (
        storedExecution?.sessionId !== linkedSessionId
        || storedExecution?.id !== selection.executionId
      )
    ) {
      return;
    }
    const hasUsableAuditSession = Boolean(
      audit
      && audit.projectId === selectedProjectId
      && linkedSessionId
      && (!selection.sessionId || linkedSessionId === selection.sessionId)
      && sessions.some((session) => session.id === linkedSessionId),
    );
    if (!hasUsableAuditSession || !audit || !linkedSessionId) {
      clearAiChatSelection(selectedProjectId);
      resetVisibleSelection(recoveredExecution);
      return;
    }

    resetVisibleSelection(recoveredExecution);
    setHistoricalExecutionId(audit.id);
    setSessionId(linkedSessionId);
    setActiveExecution({
      id: audit.id,
      projectId: audit.projectId,
      sessionId: linkedSessionId,
       message: audit.objective,
       proofRequired: audit.proofRequired,
       ...(audit.terminalProjection ? { terminalProjection: audit.terminalProjection } : {}),
    });
  }, [
    activeExecution?.id,
    activeExecution?.projectId,
    activeExecution?.sessionId,
    historicalAudits,
    historicalAuditsLoading,
    selectedProjectId,
    sessions,
    sessionsError,
    sessionsFetched,
    storedExecution?.id,
    chatRouteTarget,
  ]);

  const { data: serverMessages = [], isFetched: messagesFetched, isError: messagesError } = useListAiChatMessages<ChatMessage[]>(
    sessionId ?? '',
    {
      query: {
        queryKey: ['ai-messages', sessionId],
        enabled: isLoaded && !!sessionId,
      },
    },
  );

  const {
    data: chatSessionMissions,
    isPending: chatSessionMissionsPending,
    isError: chatSessionMissionsError,
    refetch: refetchChatSessionMissions,
  } = useListAiChatSessionMissions(sessionId ?? '', {
    query: {
      queryKey: [
        ...getListAiChatSessionMissionsQueryKey(sessionId ?? ''),
        user?.id ?? null,
      ],
      enabled: isLoaded && Boolean(selectedProjectId && sessionId),
      staleTime: 0,
      refetchOnMount: 'always',
      refetchOnWindowFocus: true,
      refetchInterval: 15_000,
      refetchIntervalInBackground: false,
    },
  });
  const currentSessionMissions = chatSessionMissions?.sessionId === sessionId
    ? chatSessionMissions
    : undefined;
  const currentSessionMissionsPending = chatSessionMissionsPending
    || Boolean(sessionId && !currentSessionMissions && !chatSessionMissionsError);
  const routeMissionId = chatRouteTarget?.projectId === selectedProjectId
    && chatRouteTarget.sessionId === sessionId
    ? chatRouteTarget.missionId
    : undefined;
  const routeMissionIsLinked = Boolean(
    routeMissionId
    && currentSessionMissions !== undefined
    && currentSessionMissions?.sessionId === sessionId
    && currentSessionMissions.missions.some(({ mission }) => mission.id === routeMissionId),
  );
  const routeMissionIsSelected = routeMissionIsLinked
    && currentSessionMissions?.activeMissionId === routeMissionId;
  const workspaceMissionId = routeMissionId
    ? (routeMissionIsSelected ? routeMissionId : null)
    : currentSessionMissions?.missions.some(
        ({ mission }) => mission.id === currentSessionMissions.activeMissionId,
      )
      ? currentSessionMissions.activeMissionId
      : null;
  const missionAgentProjectionQuery = useQuery({
    queryKey: ['mission-agent-projection', selectedProjectId, workspaceMissionId],
    queryFn: () => fetchMissionProjection(workspaceMissionId!),
    enabled: Boolean(workspaceMissionId && selectedProjectId && sessionId && user?.id),
    staleTime: 0,
    refetchInterval: (query) => {
      const projection = query.state.data as MissionProjection | undefined;
      return shouldPollMissionProjection(projection) ? 3_000 : false;
    },
  });
  const routeMissionProjection = missionAgentProjectionQuery.data;
  const routeMissionAgent = routeMissionProjection
    && routeMissionProjection.mission.id === workspaceMissionId
    && String(routeMissionProjection.mission.projectId) === selectedProjectId
    && routeMissionProjection.engineeringAgent?.schemaVersion === 2
    && routeMissionProjection.engineeringAgent.missionId === workspaceMissionId
    && (
      routeMissionProjection.engineeringAgent.sessionId === sessionId
      || routeMissionProjection.agentControl?.handoff.sessionId === sessionId
    )
    ? routeMissionProjection.engineeringAgent
    : null;
  const routeMissionWorkspace = routeMissionProjection?.workspaceSummary ?? null;
  const routeMissionPhaseLabel = routeMissionAgent
    ? ({
        PLANNING: 'التخطيط',
        WORKING: 'قيد التنفيذ',
        VERIFYING: 'التحقق',
        AWAITING_APPROVAL: 'بانتظار الموافقة',
        RECOVERING: 'استعادة التنفيذ',
        DELIVERING: 'التسليم',
        COMPLETE: 'مكتملة بإثبات',
        NEEDS_ATTENTION: 'تحتاج إلى مراجعة',
      } as const)[routeMissionAgent.state]
    : null;
  const routeMissionEvidenceLabel = routeMissionWorkspace
    ? routeMissionWorkspace.evidence.required === false
      && routeMissionWorkspace.evidence.state !== 'proven'
      ? 'لم تكن الأدلة مطلوبة وفق سياسة المهمة'
      : ({
        not_started: 'لم يبدأ التحقق',
        pending: 'التحقق جارٍ أو بانتظار التنفيذ',
        proven: 'الأدلة مقبولة',
        incomplete: 'الأدلة غير مكتملة',
        unavailable: 'تعذر التحقق من الأدلة',
      } as const)[routeMissionWorkspace.evidence.state]
    : null;
  const routeMissionDeliveryLabel = routeMissionWorkspace
    ? ({
        not_required: 'لا يتطلب تسليمًا خارجيًا',
        waiting_for_proof: 'بانتظار إثبات العمل قبل التسليم',
        pending: 'التسليم بانتظار الإكمال',
        receipt_recorded: 'سُجل إيصال التسليم',
      } as const)[routeMissionWorkspace.delivery.state]
    : null;
  const routeMissionInterventionLabel = routeMissionAgent
    ? routeMissionAgent.intervention.required
      ? ({
          approval: 'بانتظار موافقتك',
          review: 'تحتاج المهمة إلى مراجعتك',
          recovery: 'تحتاج متابعة الاستعادة',
          scope: 'تحتاج إلى مراجعة نطاق المهمة',
          delivery: 'تحتاج إلى متابعة التسليم',
          none: 'تحتاج إلى مراجعتك',
        } as const)[routeMissionAgent.intervention.kind]
      : 'لا يوجد تدخل مطلوب الآن'
    : null;
  const routeMissionLastActivity = routeMissionWorkspace?.lastActivityAt
    ? new Date(routeMissionWorkspace.lastActivityAt)
    : null;

  const selectSessionMission = useCallback(async (
    targetSessionId: string,
    missionId: string,
    showErrorToast = true,
  ): Promise<void> => {
    try {
      const result = await activeMissionSelectionMutation.mutateAsync({
        sessionId: targetSessionId,
        data: { missionId },
      });
      const queryKey = [
        ...getListAiChatSessionMissionsQueryKey(targetSessionId),
        user?.id ?? null,
      ];
      qc.setQueryData<AiChatSessionMissionsResponse>(queryKey, (current) => (
        current?.sessionId === targetSessionId
          ? { ...current, activeMissionId: result.activeMissionId }
          : current
      ));
      await qc.invalidateQueries({
        queryKey: getListAiChatSessionMissionsQueryKey(targetSessionId),
      });
    } catch (error) {
      if (showErrorToast) {
        toast({
          title: 'تعذّر تغيير المهمة الحالية',
          description: error instanceof Error ? error.message : 'لم يتغير الاختيار المحفوظ.',
          variant: 'destructive',
        });
      }
      throw error;
    }
  }, [activeMissionSelectionMutation, qc, toast, user?.id]);

  useEffect(() => {
    if (
      !routeMissionId
      || !sessionId
      || !selectedProjectId
    ) {
      return;
    }
    const attemptKey = `${selectedProjectId}:${sessionId}:${routeMissionId}`;
    if (currentSessionMissionsPending) return;
    if (chatSessionMissionsError) {
      setRouteMissionRestoration((current) => (
        current?.key === attemptKey && current.kind === 'missions-unavailable'
          ? current
          : { key: attemptKey, kind: 'missions-unavailable' }
      ));
      return;
    }
    if (currentSessionMissions?.sessionId !== sessionId) return;
    if (currentSessionMissions.activeMissionId === routeMissionId) {
      routeMissionSelectionAttempt.current = attemptKey;
      setRouteMissionRestoration(null);
      return;
    }
    if (!currentSessionMissions.missions.some(({ mission }) => mission.id === routeMissionId)) {
      setRouteMissionRestoration((current) => (
        current?.key === attemptKey && current.kind === 'not-linked'
          ? current
          : { key: attemptKey, kind: 'not-linked' }
      ));
      return;
    }
    if (routeMissionRestoration?.key === attemptKey) {
      if (routeMissionRestoration.kind === 'selection-failed') return;
      setRouteMissionRestoration(null);
    }
    if (routeMissionSelectionAttempt.current === attemptKey) return;
    routeMissionSelectionAttempt.current = attemptKey;
    setRouteMissionRestoration(null);
    void selectSessionMission(sessionId, routeMissionId, false).catch(() => {
      if (currentRouteMissionKeyRef.current === attemptKey) {
        setRouteMissionRestoration({ key: attemptKey, kind: 'selection-failed' });
      }
    });
  }, [
    currentSessionMissions,
    chatSessionMissionsError,
    currentSessionMissionsPending,
    routeMissionId,
    routeMissionRestoration,
    selectSessionMission,
    selectedProjectId,
    sessionId,
  ]);

  const retryRouteMissionRestoration = useCallback(async () => {
    if (!routeMissionRestoration || !sessionId) return;
    const attemptKey = routeMissionRestoration.key;
    try {
      await refetchChatSessionMissions();
    } finally {
      if (currentRouteMissionKeyRef.current === attemptKey) {
        routeMissionSelectionAttempt.current = '';
        setRouteMissionRestoration(null);
      }
    }
  }, [refetchChatSessionMissions, routeMissionRestoration, sessionId]);

  const { data: serverProposal } = useGetAiPendingProposal<{
    proposalId: string | null;
    operationId: string | null;
    changes: PendingChange[];
    approvalRequired: boolean;
    revision: number | null;
    lifecycle?: DeliveryLifecycle | null;
    workspaceRoot?: string | null;
    baseRevision?: string | null;
    changeSetHash?: string | null;
    conflictReason?: string | null;
    validationEvidence?: PublicValidationResult[] | null;
    missionCandidate?: boolean;
    missionCandidateAccepted?: boolean;
    applyMissionReady?: boolean;
    sourceMissionId?: string | null;
    sourceGoalId?: string | null;
  }>(
    sessionId ?? '',
    {
      query: {
        queryKey: ['ai-pending-proposal', sessionId],
        enabled: isLoaded && !!sessionId,
        refetchInterval: (query) => {
          const proposal = query.state.data as {
            missionCandidate?: boolean;
            missionCandidateAccepted?: boolean;
          } | undefined;
          return proposal?.missionCandidate && !proposal.missionCandidateAccepted ? 3_000 : false;
        },
      },
    },
  );

  const { data: recoverableDeliveries } = useQuery<{ operations: RecoverableDelivery[] }>({
    queryKey: ['ai-delivery-recoverable', selectedProjectId],
    enabled: isLoaded && !!selectedProjectId,
    queryFn: async () => {
      const response = await fetch(`/api/ai/delivery/recoverable?projectId=${encodeURIComponent(selectedProjectId)}`, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error('Recoverable delivery operations could not be loaded.');
      return response.json();
    },
    refetchInterval: 30_000,
  });
  const { data: deliveryPolicy } = useGetAiDeliveryPolicy(
    { projectId: selectedProjectId },
    {
      query: {
        queryKey: getGetAiDeliveryPolicyQueryKey({ projectId: selectedProjectId }),
        enabled: isLoaded && !!selectedProjectId,
        staleTime: 10_000,
      },
    },
  );
  const updateDeliveryPolicyMutation = useUpdateAiDeliveryPolicy({
    mutation: {
      onSuccess: (policy) => {
        qc.setQueryData(
          getGetAiDeliveryPolicyQueryKey({ projectId: selectedProjectId }),
          policy,
        );
        toast({
          title: policy.automaticPromotionEnabled
            ? 'Automatic promotion enabled'
            : 'Automatic promotion disabled',
          description: policy.automaticPromotionEnabled
            ? 'Only server-validated, low-risk delivery candidates can be promoted automatically.'
            : 'Delivery proposals will require the existing review and apply flow.',
        });
      },
      onError: (error) => {
        toast({
          title: 'Delivery policy could not be updated',
          description: error instanceof Error ? error.message : 'Try again.',
          variant: 'destructive',
        });
      },
    },
  });
  const [deliveryRecoveryPending, setDeliveryRecoveryPending] = useState<string | null>(null);
  const [applyMissionPending, setApplyMissionPending] = useState(false);
  const [deliveryToDiscard, setDeliveryToDiscard] = useState<{
    projectId: string;
    delivery: RecoverableDelivery;
  } | null>(null);

  async function recoverDelivery(proposal: RecoverableDelivery, action: 'resume-validation' | 'discard') {
    if (deliveryRecoveryPending || proposal.recoveryState !== 'recoverable') return;
    setDeliveryRecoveryPending(proposal.proposalId);
    try {
      const response = await fetch(`/api/ai/delivery/${encodeURIComponent(proposal.proposalId)}/${action}`, {
        method: 'POST',
        credentials: 'include',
        headers: { Accept: 'application/json' },
        body: '{}',
      });
      const payload = await response.json().catch(() => ({})) as {
        error?: string;
        code?: string;
        lifecycle?: DeliveryLifecycle;
        automaticPromotion?: boolean;
      };
      if (!response.ok) {
        if (response.status === 404 && payload.code === 'DELIVERY_NOT_FOUND') {
          void qc.invalidateQueries({ queryKey: ['ai-delivery-recoverable', selectedProjectId] });
          toast({
            title: 'Recovery link expired',
            description: 'This recovery operation no longer exists. The recovery list was refreshed.',
            variant: 'destructive',
          });
          return;
        }
        if (response.status === 409 && (
          payload.code === 'DELIVERY_ALREADY_DISCARDED' ||
          payload.code === 'DELIVERY_NOT_RECOVERABLE'
        )) {
          void qc.invalidateQueries({ queryKey: ['ai-delivery-recoverable', selectedProjectId] });
          toast({
            title: 'Recovery state changed',
            description: payload.code === 'DELIVERY_ALREADY_DISCARDED'
              ? 'This recovery was already discarded. The recovery list was refreshed.'
              : 'This recovery workspace is no longer available. The recovery list was refreshed.',
            variant: 'destructive',
          });
          return;
        }
        throw new Error(payload.error || 'تعذر إكمال استرداد مساحة التسليم.');
      }
      void qc.invalidateQueries({ queryKey: ['ai-delivery-recoverable', selectedProjectId] });
      if (action === 'resume-validation') {
        setSessionId(proposal.sessionId);
        void qc.invalidateQueries({ queryKey: ['ai-pending-proposal', proposal.sessionId] });
        toast({
          title: payload.automaticPromotion
            ? 'طُبّق مرشح التسليم تلقائيًا بعد الفحوص'
            : payload.lifecycle === 'validated'
              ? 'استُكملت الفحوص المسجلة'
              : 'الفحوص ما زالت محجوبة',
          description: payload.automaticPromotion
            ? 'طبّقت سياسة المالك المعتمدة هذا المرشح منخفض المخاطر عبر مسار التطبيق المحمي القائم.'
            : payload.lifecycle === 'validated'
              ? 'اجتازت مساحة العملية المحفوظة فحوصها المسجلة؛ هذا لا يعني رفع تغييرات Git.'
            : 'حُفظت الأدلة المتاحة، وما زالت العملية محجوبة.',
        });
      } else {
        toast({ title: 'أُزيلت مساحة التسليم المؤقتة', description: 'أُزيلت المساحة التابعة لهذه العملية فقط، لا مشروعك.' });
        void qc.invalidateQueries({ queryKey: ['ai-pending-proposal', proposal.sessionId] });
        if (sessionId === proposal.sessionId) {
          liveProposalRef.current = null;
          setPendingChanges([]);
          setProposalId(undefined);
          setProposalRequiresApproval(false);
          setProposalRevision(undefined);
          setValidationEvidence([]);
        }
      }
       publishAiChatData(selectedProjectId, proposal.sessionId);
    } catch (error) {
      toast({
        title: 'تعذر استرداد مساحة التسليم',
        description: error instanceof Error ? error.message : 'لم تتغير العملية.',
        variant: 'destructive',
      });
    } finally {
      setDeliveryRecoveryPending(null);
    }
  }

  const regenerateReportMutation = useMutation({
    mutationFn: async (messageId: string) => {
      const response = await fetch(
        `/api/ai/chat/${encodeURIComponent(sessionId ?? '')}/messages/${encodeURIComponent(messageId)}/mission-correlation-report/regenerate`,
        { method: 'POST', credentials: 'include' },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof payload?.error === 'string' ? payload.error : 'The historical report could not be regenerated.');
      }
      return payload;
    },
    onSuccess: () => {
      if (sessionId) void qc.invalidateQueries({ queryKey: ['ai-messages', sessionId] });
      void qc.invalidateQueries({ queryKey: ['ai-sessions', selectedProjectId] });
       publishAiChatData(selectedProjectId, sessionId);
      toast({ title: 'Historical report regenerated', description: 'The report is now available from the retained run evidence.' });
    },
    onError: (error) => {
      toast({
        title: 'Report regeneration failed',
        description: error instanceof Error ? error.message : 'The conversation was not changed.',
        variant: 'destructive',
      });
    },
  });

  useEffect(() => {
    if (!messagesFetched) return;

    // A mission report is optional enrichment on an otherwise useful message.
    // Validate each one independently so one old/corrupt report cannot discard
    // the complete conversation or expose parser details in the UI.
    let hasUnavailableReport = false;
    const safeMessages = serverMessages.map((message) => {
      const structuredFailure = parseStructuredFailureMetadata(message.toolTrace);
      const withStructuredFailure = structuredFailure
        ? {
            ...message,
            structuredTask: structuredFailure.task,
            failureKind: structuredFailure.failureKind ?? message.failureKind,
            retryable: structuredFailure.retryable ?? message.retryable,
          }
        : message;
      if (message.missionCorrelationReportError) {
        hasUnavailableReport = true;
        return { ...withStructuredFailure, missionCorrelationReport: undefined };
      }
      if (message.missionCorrelationReport === undefined || message.missionCorrelationReport === null) {
        return withStructuredFailure;
      }
      try {
        readStoredMissionCorrelationReport(message.missionCorrelationReport);
        return withStructuredFailure;
      } catch {
        hasUnavailableReport = true;
        return { ...withStructuredFailure, missionCorrelationReport: undefined };
      }
    });
    setHistoricalReportError(
      hasUnavailableReport
        ? 'A historical mission report could not be loaded. Your conversation is still available.'
        : null,
    );
    // A newly-created session starts its messages query with an empty result
    // while the SSE stream is already running. Do not let that initial empty
    // response erase the optimistic user bubble (or a structured-task
    // placeholder), otherwise the page falls back to the empty-chat hero and
    // hides all live progress until the assistant finishes.
    setLocalMessages((previous) => {
      const transientMessages = previous.filter((message) =>
        message.id.startsWith('opt-') || message.id.endsWith('-placeholder'),
      );
      if (transientMessages.length === 0) return safeMessages;

      const stillPending = transientMessages.filter((transient) =>
        !safeMessages.some((serverMessage) =>
          serverMessage.role === transient.role &&
          serverMessage.content === transient.content,
        ),
      );
      return [...safeMessages, ...stillPending];
    });
  }, [messagesFetched, serverMessages]);

  useEffect(() => {
    if (!serverProposal) return;
    // A live stream can finish with a persisted proposal just before the
    // session-scoped query observes it. Do not let an initial empty or stale
    // response erase the proposal that the stream has already handed to the
    // user. The server query becomes authoritative once it observes the same
    // proposal identity (or after an explicit apply/reject clears this ref).
    if (
      liveProposalRef.current
      && serverProposal.proposalId !== liveProposalRef.current
    ) {
      return;
    }
    if (serverProposal.changes.length > 0) {
      liveProposalRef.current = null;
    }
    setProposalId(serverProposal.proposalId ?? undefined);
    setOperationId(serverProposal.operationId ?? undefined);
    setOperationMode(serverProposal.proposalId ? 'DELIVERY' : undefined);
    setProposalRequiresApproval(serverProposal.approvalRequired === true);
    setProposalRevision(serverProposal.revision ?? undefined);
    setDeliveryLifecycle(serverProposal.lifecycle ?? (serverProposal.changes.length > 0 ? 'proposed' : undefined));
    setValidationEvidence(serverProposal.validationEvidence ?? []);
    // The server is authoritative after a session reload. An empty response
    // means the proposal was rejected/consumed (or never existed), so clear
    // any stale localStorage-backed changes instead of showing an unapprovable
    // card that would submit without a valid proposalId.
    setPendingChanges(serverProposal.changes);
    if (serverProposal.changes.length === 0 && pendingKey && verificationKey) {
      localStorage.removeItem(pendingKey);
      localStorage.removeItem(verificationKey);
      setVerificationResults({});
    }
  }, [serverProposal]);

  // A session belongs to exactly one project. If the selected project's
  // session list has been fetched and no longer contains the active session,
  // fail closed instead of sending that session ID with a different project.
  useEffect(() => {
    const sessionOwnsRecoveredExecution = Boolean(
      activeExecution
      && activeExecution.projectId === selectedProjectId
      && activeExecution.sessionId === sessionId,
    );
    if (
      !sessionsFetched ||
      sessionsError ||
      !sessionId ||
      sessionOwnsRecoveredExecution ||
      sessions.some((session) => session.id === sessionId)
    ) {
      return;
    }
    setSessionId(undefined);
    setLocalMessages([]);
    setPendingChanges([]);
    setProposalId(undefined);
    setProposalUnavailable(null);
    liveProposalRef.current = null;
    setProposalRequiresApproval(false);
    setProposalRevision(undefined);
    setVerificationResults({});
    clearExecutionScopedState();
  }, [
    activeExecution?.projectId,
    activeExecution?.sessionId,
    selectedProjectId,
    sessions,
    sessionsError,
    sessionsFetched,
    sessionId,
  ]);

  useEffect(() => {
    if (!draftHandoff.isReady) return;
    const draftNeedsExplicitProject = Boolean(
      draftHandoff.activeDraft
      && !draftHandoff.activeDraft.projectId
      && !chatRouteTarget?.projectId
    );
    if (!draftNeedsExplicitProject && projects.length > 0 && !selectedProjectId) {
      // Explicit route/draft targets must never silently become the first project.
      setSelectedProjectId(chatRouteTarget?.projectId ?? draftHandoff.activeDraft?.projectId ?? projects[0].id);
    }
  }, [projects, selectedProjectId, chatRouteTarget, draftHandoff.activeDraft?.projectId, draftHandoff.isReady]);

  useEffect(() => {
    const targetMessageId = chatRouteTarget?.messageId;
    const routeMissionIsRestored = !routeMissionId
      || currentSessionMissions?.activeMissionId === routeMissionId;
    if (
      !targetMessageId
      || !messagesFetched
      || !sessionId
      || chatRouteTarget?.projectId !== selectedProjectId
      || chatRouteTarget.sessionId !== sessionId
      || !routeMissionIsRestored
    ) {
      return;
    }
    const belongsToSession = localMessages.some((message) => (
      message.id === targetMessageId
      && (!message.sessionId || message.sessionId === sessionId)
    ));
    if (!belongsToSession) return;
    const target = [...document.querySelectorAll<HTMLElement>('[data-chat-message-id]')]
      .find((element) => element.dataset.chatMessageId === targetMessageId);
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [
    chatRouteTarget,
    currentSessionMissions?.activeMissionId,
    localMessages,
    messagesFetched,
    routeMissionId,
    selectedProjectId,
    sessionId,
  ]);

  useEffect(() => {
    if (
      chatRouteTarget?.messageId
      && chatRouteTarget.projectId === selectedProjectId
      && chatRouteTarget.sessionId === sessionId
    ) {
      return;
    }
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatRouteTarget, localMessages, selectedProjectId, sessionId]);

  const applyMutation = useAiApplyChanges({
    mutation: {
      onSuccess: (data) => {
        const failed = data.results.filter((r) => !r.ok);
        const succeeded = data.results.filter((r) => r.ok);
        const missionHandoff = data.lifecycle?.missionHandoff;
        const missionHandoffFailed = missionHandoff?.transitionStatus === 'not_created'
          || missionHandoff?.transitionStatus === 'terminal_failed'
          || ['blocked', 'failed', 'conflict', 'needs_replan'].includes(missionHandoff?.goalWakeStatus ?? '');
        const missionHandoffPending = Boolean(missionHandoff)
          && !missionHandoffFailed
          && (missionHandoff?.transitionStatus !== 'materialized'
            || missionHandoff?.goalWakeStatus !== 'completed');
        const verificationFor = (result: (typeof data.results)[number]): BehavioralVerification => ({
          status: result.behavioralVerification?.status ?? 'unavailable',
          profile: result.behavioralVerification?.profile,
          scenario: result.behavioralVerification?.scenario,
          detail: result.behavioralVerification?.detail ?? 'No behavioral verification result was returned.',
          conflict: result.conflict ?? undefined,
        });

        if (failed.length > 0) {
          toast({
            title: `${failed.length} file(s) failed to apply`,
            description: failed.map((f) => `${f.path}: ${f.error}`).join('\n'),
            variant: 'destructive',
          });
        }
        if (succeeded.length > 0) {
          const verificationText = succeeded
            .map((r) => `${r.path}: ${verificationFor(r).status}`)
            .join('\n');
          const needsReview = succeeded.filter((r) => verificationFor(r).status !== 'passed');
          const missionHandoffMessage = missionHandoffFailed
            ? '\nتعذر استكمال إثبات التسليم لهدف Mission؛ لم يُعلَن اكتماله.'
            : missionHandoffPending
              ? '\nتم تطبيق التغييرات، وهدف Mission ما زال قيد التحقق.'
              : missionHandoff
                ? '\nاكتمل إثبات هدف Mission.'
                : '';
          toast({
            title: missionHandoffFailed
              ? `Wrote ${succeeded.length} file change${succeeded.length !== 1 ? 's' : ''} — Mission needs attention`
              : needsReview.length > 0
              ? `Wrote ${succeeded.length} file change${succeeded.length !== 1 ? 's' : ''} — review required`
              : `Wrote ${succeeded.length} file change${succeeded.length !== 1 ? 's' : ''}`,
            description: needsReview.length > 0
              ? `Persistence verified, but behavioral verification is incomplete.\n${verificationText}${missionHandoffMessage}`
              : `Persistence and behavioral verification passed.\n${verificationText}${missionHandoffMessage}`,
            ...(missionHandoffFailed ? { variant: 'destructive' as const } : {}),
          });
        }
        setOperationId(data.correlationId);
        setValidationEvidence(data.validationEvidence ?? []);
        setDeliveryLifecycle(data.applyStatus === 'APPLIED' ? 'applied' : 'blocked');
        setProposalRequiresApproval(false);
        setProposalRevision(undefined);
        setVerificationResults((prev) => ({
          ...prev,
          ...Object.fromEntries(data.results.map((r) => [r.path, verificationFor(r)])),
        }));
        // A persisted change is removed only after behavioral verification passes.
        // Skipped, failed, or unavailable verification remains visible for review.
        const completedPaths = new Set(
          succeeded
            .filter((r) => verificationFor(r).status === 'passed')
            .map((r) => r.path),
        );
        setPendingChanges((prev) => prev.filter((c) => !completedPaths.has(c.path)));
        if (succeeded.length > 0 && failed.length === 0 && completedPaths.size === succeeded.length) {
          liveProposalRef.current = null;
          setProposalId(undefined);
          setCommitReadyPaths([...completedPaths]);
          setCommitProposalId(proposalId);
          setPushReady(false);
        } else {
          setCommitReadyPaths([]);
          setCommitProposalId(undefined);
          setPushReady(false);
        }

        // G-05: refresh git-status in the GitPanel so it reflects the newly
        // written files (dirty markers, unstaged changes) without a manual reload.
        void qc.invalidateQueries({ queryKey: ['git-status', selectedProjectId] });
        void qc.invalidateQueries({ queryKey: ['ai-pending-proposal', sessionId] });
        publishAiChatData(selectedProjectId, sessionId);
      },
      onError: (err) => {
        toast({ title: 'Failed to apply changes', description: describeAiError(err), variant: 'destructive' });
      },
    },
  });

  const reapprovalMutation = useApproveAiRebasedProposal({
    mutation: {
      onSuccess: () => {
        const changesToApply = reapprovalApplyRef.current;
        reapprovalApplyRef.current = null;
        setProposalRequiresApproval(false);
        if (!changesToApply || !selectedProjectId || !proposalId) return;
        applyMutation.mutate({
          data: {
            changes: changesToApply,
            projectId: selectedProjectId,
            proposalId,
            ...(operationId ? { operationId } : {}),
          },
        });
      },
      onError: (err) => {
        reapprovalApplyRef.current = null;
        toast({
          title: 'Re-approval required',
          description: describeAiError(err),
          variant: 'destructive',
        });
      },
    },
  });

  const rebaseMutation = useAiRebaseChanges({
    mutation: {
      onSuccess: (data) => {
        const rebasedChanges = data.changes as PendingChange[];
        setPendingChanges(rebasedChanges);
        setProposalRequiresApproval(data.approvalRequired === true);
        setProposalRevision(data.revision);
        setVerificationResults((prev) => {
          const next = { ...prev };
          for (const change of rebasedChanges) delete next[change.path];
          return next;
        });
        setCommitReadyPaths([]);
        setCommitProposalId(undefined);
        setPushReady(false);
        toast({
          title: 'Patch rebased for review',
          description: `${data.rebasedFiles.length} file${data.rebasedFiles.length !== 1 ? 's' : ''} matched the current workspace. Review and approve the new diff before applying.`,
        });
        void qc.invalidateQueries({ queryKey: ['ai-pending-proposal', sessionId] });
        publishAiChatData(selectedProjectId, sessionId);
      },
      onError: (err) => {
        toast({
          title: 'Patch could not be rebased',
          description: describeAiError(err),
          variant: 'destructive',
        });
      },
    },
  });

  const localReviewBranchQuery = useGetLocalReviewBranch(
    selectedProjectId ?? '',
    proposalId ?? '',
    {
      query: {
        enabled: Boolean(selectedProjectId && proposalId),
        queryKey: getGetLocalReviewBranchQueryKey(selectedProjectId ?? '', proposalId ?? ''),
        staleTime: 0,
        refetchOnMount: 'always',
        refetchOnWindowFocus: true,
        retry: false,
      },
    },
  );

  const localReviewBranchMutation = useCreateLocalReviewBranch({
    mutation: {
      onSuccess: (_result, variables) => {
        void qc.invalidateQueries({
          queryKey: getGetLocalReviewBranchQueryKey(
            variables.projectId,
            variables.data.proposalId,
          ),
        });
      toast({
        title: 'فرع المراجعة المحلي جاهز',
        description: 'أُنشئ من SHA المصدر المسجل. لم يُطبّق التغيير ولم يُنشأ commit أو push أو إثبات قبول.',
      });
      },
      onError: (error) => {
        toast({
          title: 'تعذّر تجهيز فرع المراجعة',
          description: describeAiError(error),
          variant: 'destructive',
        });
      },
    },
  });

  const commitMutation = useGitCommit({
    mutation: {
      onSuccess: (data) => {
        toast({
          title: 'Changes committed',
          description: data.output || 'The verified changes were committed successfully.',
        });
        setCommitReadyPaths([]);
        setCommitProposalId(undefined);
        setPushReady(true);
        setOperationId(data.correlationId);
        void qc.invalidateQueries({ queryKey: ['git-status', selectedProjectId] });
        publishAiChatData(selectedProjectId, sessionId);
      },
      onError: (err) => {
        toast({ title: 'Failed to create commit', description: describeAiError(err), variant: 'destructive' });
      },
    },
  });

  const pushMutation = useGitPush({
    mutation: {
      onSuccess: (data) => {
        toast({
          title: 'Changes pushed',
          description: data.output || `Branch ${data.branch} was pushed successfully.`,
        });
        setPushReady(false);
        setOperationId(data.correlationId);
        void qc.invalidateQueries({ queryKey: ['git-status', selectedProjectId] });
        publishAiChatData(selectedProjectId, sessionId);
      },
      onError: (err) => {
        toast({ title: 'Failed to push changes', description: describeAiError(err), variant: 'destructive' });
      },
    },
  });

  const rejectMutation = useRejectAiChangeProposal({
    mutation: {
      onSuccess: () => {
        liveProposalRef.current = null;
        setPendingChanges([]);
        setProposalId(undefined);
        setOperationId(undefined);
        void qc.invalidateQueries({ queryKey: ['ai-pending-proposal', sessionId] });
        publishAiChatData(selectedProjectId, sessionId);
      },
      onError: (err) => {
        toast({ title: 'Failed to reject proposal', description: describeAiError(err), variant: 'destructive' });
      },
    },
  });

  function handleApplyChanges(changes: PendingChange[]) {
    if (!selectedProjectId || !proposalId) {
      toast({
        title: 'Proposal unavailable',
        description: 'Refresh the chat before applying these changes.',
        variant: 'destructive',
      });
      return;
    }
    const approvedChanges = changes.filter(hasValidationProfile);
    if (approvedChanges.length !== changes.length) {
      toast({
        title: 'Validation required',
        description: 'One or more changes are not eligible for approval yet.',
        variant: 'destructive',
      });
      return;
    }
    if (proposalRequiresApproval) {
      if (proposalRevision === undefined) {
        toast({
          title: 'Proposal revision unavailable',
          description: 'Refresh the chat before approving this rebased patch.',
          variant: 'destructive',
        });
        return;
      }
      reapprovalApplyRef.current = approvedChanges;
      reapprovalMutation.mutate({
        proposalId,
        data: {
          projectId: selectedProjectId,
          revision: proposalRevision,
        },
      });
      return;
    }
    applyMutation.mutate({
      data: {
        changes: approvedChanges,
        projectId: selectedProjectId,
        proposalId,
      },
    });
  }

  function handleApproveMissionCandidate() {
    if (
      !selectedProjectId
      || !proposalId
      || proposalRevision === undefined
      || serverProposal?.missionCandidateAccepted !== true
    ) {
      toast({
        title: 'المقترح غير متاح للموافقة',
        description: 'حدّث المحادثة ثم راجع المقترح قبل الموافقة عليه.',
        variant: 'destructive',
      });
      return;
    }
    reapprovalApplyRef.current = null;
    reapprovalMutation.mutate({
      proposalId,
      data: {
        projectId: selectedProjectId,
        revision: proposalRevision,
      },
    });
  }

  async function handleCreateApplyMission() {
    if (
      !selectedProjectId
      || !proposalId
      || serverProposal?.missionCandidate !== true
      || serverProposal?.missionCandidateAccepted !== true
      || proposalRequiresApproval
      || applyMissionPending
    ) return;
    setApplyMissionPending(true);
    try {
      await createApplyMissionFromProposal({
        projectId: selectedProjectId,
        proposalId,
        title: 'تطبيق المرشح المعتمد وتسليمه',
        intent: 'تطبيق المرشح المعتمد على مساحة المشروع والتحقق من التسليم إلى المستودع المرتبط.',
      });
      if (sessionId) {
        await qc.invalidateQueries({ queryKey: ['ai-pending-proposal', sessionId] });
      }
      toast({
        title: 'أُنشئ هدف التطبيق والتسليم',
        description: 'راجع هدف التطبيق ثم استخدم زر تطبيق المرشح المعتمد لبدء التطبيق المحمي بصورة منفصلة.',
      });
    } catch (error) {
      toast({
        title: 'تعذر إنشاء هدف التطبيق',
        description: error instanceof Error ? error.message : 'لم يُطبّق المرشح.',
        variant: 'destructive',
      });
    } finally {
      setApplyMissionPending(false);
    }
  }

  async function handleProjectionAction(action: AiExecutionProjection['allowedActions'][number]): Promise<void> {
    if (action === 'CANCEL') {
      await cancelActiveExecution();
      return;
    }
    if (action === 'RESUME_CHECKPOINT' || action === 'RETRY_CHECKPOINT') {
      void resumeActiveExecution(action === 'RETRY_CHECKPOINT' ? 'retry' : 'resume');
      return;
    }
    if (action === 'APPROVE_CHANGES') {
      if (pendingChanges.length === 0) {
        throw new Error('No pending validated changes are available to approve.');
      }
      handleApplyChanges(pendingChanges);
      return;
    }
    if (action === 'START_NEW_RUN') {
      const message = activeExecutionRef.current?.message?.trim();
      if (!message) throw new Error('The original request is not available for a new run.');
      sendMessage(message);
      return;
    }
    throw new Error('This action is handled by the dedicated proof or diff review.');
  }

  function handleRebaseChanges(changes: PendingChange[]) {
    if (!selectedProjectId || !proposalId) {
      toast({
        title: 'Proposal unavailable',
        description: 'Refresh the chat before rebasing this patch.',
        variant: 'destructive',
      });
      return;
    }
    rebaseMutation.mutate({
      data: {
        projectId: selectedProjectId,
        proposalId,
        changes,
      },
    });
  }

  function handleRejectProposal() {
    if (!proposalId) {
      setPendingChanges([]);
      return;
    }
    rejectMutation.mutate({ proposalId });
    setProposalRequiresApproval(false);
    setProposalRevision(undefined);
  }

  function handleCreateLocalReviewBranch() {
    if (!selectedProjectId || !proposalId || localReviewBranchMutation.isPending) return;
    localReviewBranchMutation.mutate({
      projectId: selectedProjectId,
      data: { proposalId },
    });
  }

  function handleCommitVerifiedChanges() {
    if (!selectedProjectId || commitReadyPaths.length === 0) return;
    if (!commitMessage.trim()) {
      toast({ title: 'Commit message required', description: 'Enter a commit message before committing.', variant: 'destructive' });
      return;
    }
    commitMutation.mutate({
      projectId: selectedProjectId,
      data: {
        message: commitMessage.trim(),
        proposalId: commitProposalId,
        ...(operationId ? { operationId } : {}),
      },
    });
  }

  function handlePushCommittedChanges() {
    if (!selectedProjectId || !pushReady) return;
    const traceData = {
      ...(commitProposalId ? { proposalId: commitProposalId } : {}),
      ...(operationId ? { operationId } : {}),
    };
    pushMutation.mutate(
      Object.keys(traceData).length > 0
        ? { projectId: selectedProjectId, data: traceData }
        : { projectId: selectedProjectId },
    );
  }

  function preserveCurrentProjectComposerDraft(): boolean {
    if (!input.trim() || draftHandoff.activeDraft) return true;
    const contextId = getAssistantComposerContextId('project', selectedProjectId, sessionId);
    const saved = Boolean(user?.id && contextId
      && saveAssistantComposerDraft(user.id, 'project', contextId, input));
    if (!saved) setScopeDraftStorageError('تعذر حفظ النص لهذه المحادثة.');
    return saved;
  }

  function handleSwitchToGeneral(): boolean {
    const draftSaved = preserveCurrentProjectComposerDraft();
    const contextSaved = Boolean(user?.id && selectedProjectId && rememberAssistantScopeContext(user.id, {
      scope: 'project',
      projectId: selectedProjectId,
      ...(sessionId ? { sessionId } : {}),
      ...(draftHandoff.activeDraft ? { draftId: draftHandoff.activeDraft.id } : {}),
    }));
    if (!draftSaved || !contextSaved) {
      setScopeDraftStorageError('تعذر حفظ سياق المحادثة أو النص غير المرسل لهذا التبويب.');
      if (input.trim() && !window.confirm('تعذر حفظ استمرار هذه المسودة. هل تريد فتح المحادثة العامة على أي حال؟')) {
        return false;
      }
    }
    return true;
  }

  /** Core send — accepts a pre-trimmed message string. Used by handleSend and
   *  handleQuickAction so both paths share the same streaming logic. */
  function sendMessage(
    msg: string,
    options?: {
      buildPlanMessageId?: string;
      executionId?: string;
      resumeToken?: string;
      sessionId?: string;
    },
  ) {
    if (!msg.trim()) return;
    if (!selectedProjectId) {
      toast({ title: 'اختر مشروعًا للمحادثة', description: 'حدد المشروع المقصود قبل إرسال الرسالة.', variant: 'destructive' });
      return;
    }
    if (!options?.executionId && homeGoalNeedsProjectConfirmation) {
      toast({ title: 'حدد مشروع هذا الهدف', description: 'أكد المشروع المقصود قبل إرسال المسودة. هذا التأكيد لا يوافق على تعديل المشروع.', variant: 'default' });
      return;
    }
    const isProjectScanRequest = isRunProjectScanRequest(msg);
    if (!isProjectScanRequest && !activeProvider) {
      toast({ title: 'جارٍ التحقق من إعداد المساعد', description: 'انتظر قليلًا ثم أعد المحاولة صراحةً.', variant: 'default' });
      return;
    }
    if (!isProjectScanRequest && (!activeProvider?.configured || !activeProvider?.provider)) {
      toast({ title: 'المساعد غير مهيّأ للإرسال', description: 'راجع إعدادات المزود في بطاقاته. لا تكتب مفتاح الوصول داخل المحادثة.', variant: 'destructive' });
      return;
    }
    if (!isProjectScanRequest && activeProviderSendBlocked) {
      toast({
        title: 'الإرسال متوقف بسبب حالة المزود',
        description: 'راجع حالة الإرسال، ثم أعد المحاولة يدويًا بعد انتهائها. لن يحوّل النظام الطلب إلى مزود آخر.',
        variant: 'destructive',
      });
      return;
    }
    if (isSending) return;
    if (!options?.executionId && !draftHandoff.onSend(msg)) return;
    setProposalUnavailable(null);
    const generation = ++streamGenerationRef.current;
    const requestProjectId = selectedProjectId;
    const requestSessionId = options?.sessionId ?? sessionId;
    if (!options?.executionId && msg.trim() === input.trim() && !draftHandoff.activeDraft && user?.id) {
      const contextId = getAssistantComposerContextId('project', requestProjectId, requestSessionId);
      if (contextId && !saveAssistantComposerDraft(user.id, 'project', contextId, '')) {
        setScopeDraftStorageError('تعذر مسح نسخة المسودة المحفوظة؛ سيبقى النص ظاهرًا إذا ألغيت الإرسال.');
        if (!window.confirm('تعذر مسح نسخة النص غير المرسل المحفوظة. هل تريد الإرسال على أي حال؟')) return;
      }
    }
    streamOwnerRef.current = {
      generation,
      projectId: requestProjectId,
      ...(requestSessionId ? { sessionId: requestSessionId } : {}),
      ...(options?.executionId ? { executionId: options.executionId } : {}),
    };
    const ownsStream = (binding?: { sessionId?: string; executionId?: string }) => {
      const owner = streamOwnerRef.current;
      if (
        !owner ||
        owner.generation !== generation ||
        owner.projectId !== requestProjectId
      ) return false;
      if (binding?.sessionId && owner.sessionId && binding.sessionId !== owner.sessionId) {
        return false;
      }
      if (
        binding?.executionId &&
        owner.executionId &&
        binding.executionId !== owner.executionId
      ) return false;
      return true;
    };
    setInput('');
    setScopeDraftRestored(false);

    const isResume = Boolean(options?.executionId);
    if (!isResume) {
      const optimistic: ChatMessage = {
        id: `opt-${Date.now()}`,
        role: 'user',
        content: msg.trim(),
        createdAt: new Date().toISOString(),
      };
      setLocalMessages((prev) => [...prev, optimistic]);
      clearExecutionScopedState({ preserveBuildPending: Boolean(options?.buildPlanMessageId) });
      streamOwnerRef.current = {
        generation,
        projectId: requestProjectId,
        ...(requestSessionId ? { sessionId: requestSessionId } : {}),
      };
    }
    setAgentStage('Connecting…');
    setStreamingContent('');
    setAgentSteps([]);
    clearLiveActivityEvents();
    appendLiveActivityEvent({ kind: 'stage', label: 'Connecting to the AI stream', status: 'info' });
    setAgentIter(null);
    setAgentModel(null);
    setAgentStartedAt(Date.now());
    setAgentElapsedSeconds(0);
    setAgentModelHistory([]);
    setAgentDiagnostics([]);
    setLiveFixtureLocal(false);
    setLiveEvidenceIntegrity(null);
    setLiveVerdictScope(null);

    const streamObservationCallbacks = createStreamObservationCallbacks({
      isCurrent: () => generation === streamGenerationRef.current,
      ownsExecution: (executionId) => ownsStream({ executionId }),
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
    });
    const streamResetCallback = createStreamResetCallback({
      isCurrent: () => generation === streamGenerationRef.current,
      getActiveExecution: () => activeExecutionRef.current,
      refetchStatus: () => refetchActiveExecutionStatus(),
      clearLiveState: () => {
        setStreamingContent('');
        setAgentSteps([]);
        clearLiveActivityEvents();
        setAgentStartedAt(null);
        setAgentElapsedSeconds(0);
      },
      setAgentStage,
      executionCanResume,
      onTerminalStatus: (status, execution) => {
        const recoveredSessionId = status.sessionId ?? execution.sessionId;
        if (recoveredSessionId) {
          void qc.invalidateQueries({ queryKey: ['ai-messages', recoveredSessionId] });
          void qc.invalidateQueries({ queryKey: ['ai-pending-proposal', recoveredSessionId] });
          publishAiChatData(requestProjectId, recoveredSessionId);
        }
        void qc.invalidateQueries({ queryKey: ['ai-sessions', requestProjectId] });
      },
    });
    const streamIdentityCallbacks = createStreamIdentityCallbacks({
      ownerRef: streamOwnerRef,
      ownsStream,
      projectId: requestProjectId,
      linkedTaskId,
      message: msg.trim(),
      buildPlanMessageId: options?.buildPlanMessageId,
      publishExecution: (execution) => {
        activeExecutionRef.current = execution;
        setActiveExecution(execution);
      },
      persistSessionSelection: (startedSessionId) => {
        persistAiChatSelection({
          version: 1,
          projectId: requestProjectId,
          kind: 'session',
          sessionId: startedSessionId,
        });
      },
      setSessionId,
      upsertSession: (session) => {
        qc.setQueryData<Session[]>(
          ['ai-sessions', requestProjectId],
          (previous = []) => [
            session,
            ...previous.filter((item) => item.id !== session.id),
          ],
        );
      },
      appendActivityEvent: appendLiveActivityEvent,
    });

    void streamSend(
      {
        projectId: requestProjectId,
        message: msg.trim(),
        sessionId: requestSessionId,
        linkedTaskId,
        buildPlanMessageId: options?.buildPlanMessageId,
        executionId: options?.executionId,
        resumeToken: options?.resumeToken,
      },
      {
        ...streamObservationCallbacks,
        ...streamIdentityCallbacks,
        onStreamReset: streamResetCallback,
         onIntent: (event) => {
           if (generation !== streamGenerationRef.current) return;
           setOperationMode(event.operationMode);
            setActiveExecution((current) => current
              ? {
                  ...current,
                  operationMode: event.operationMode,
                  proofRequired: current.proofRequired ?? event.requiresEvidence,
                }
              : current);
           setAgentStage(
             event.requiresEvidence
               ? `Evidence mode: ${event.intent.replace(/_/g, ' ')}`
               : `Request mode: ${event.intent.replace(/_/g, ' ')}`,
           );
         },
        onDone: (data) => {
          if (!ownsStream({ sessionId: data.sessionId })) return;
           resetAutoReconnect();
           if (
             resumeStreamExecutionRef.current === options?.executionId
           ) {
             resumeStreamExecutionRef.current = null;
           }
          persistAiChatSelection({
            version: 1,
            projectId: requestProjectId,
            kind: 'session',
            sessionId: data.sessionId,
          });
          const activityEvents = agentActivityEventsRef.current;
          setAgentStage(null);
           setProjectQueryRetryMessageId(null);
          setStreamingContent('');
          setAgentSteps([]);
          setAgentIter(null);
          setAgentModel(null);
          setAgentStartedAt(null);
          setAgentElapsedSeconds(0);
          setAgentModelHistory([]);
          setAgentDiagnostics([]);
          setLiveFixtureLocal(false);
          setLiveEvidenceIntegrity(null);
          setLiveVerdictScope(null);
          setLiveBehaviorProgress(null);
          setLiveAuditScopeDescription(null);
          const currentExecution = activeExecutionRef.current;
          const retainedExecution = projectRetainedCompletedExecution(currentExecution, data);
          if (retainedExecution) {
             activeExecutionRef.current = retainedExecution;
             setActiveExecution(retainedExecution);
           } else {
             activeExecutionRef.current = null;
             setActiveExecution(null);
           }
          setSessionId(data.sessionId);
          qc.setQueryData<Session[]>(
            ['ai-sessions', requestProjectId],
            (previous = []) => {
              const existing = previous.find((session) => session.id === data.sessionId);
              return [
                {
                  id: data.sessionId,
                  title: existing?.title ?? data.message.content.slice(0, 60),
                  updatedAt: data.message.createdAt,
                },
                ...previous.filter((session) => session.id !== data.sessionId),
              ];
            },
          );
          const nextOperationMode = inferOperationMode({
            operationMode: data.operationMode,
            taskResult: data.taskResult as AiTaskResult | undefined,
            proposalId: data.proposalId,
          });
          const completedMessage = projectCompletedAssistantMessage(
            data,
            activityEvents,
            nextOperationMode,
          );
          setLocalMessages((prev) => {
            const withoutOpt = prev.filter((m) => !m.id.startsWith('opt-'));
            return [...withoutOpt, completedMessage];
          });
          // The new-session message query can resolve while the stream is still
          // running and cache an empty history. Re-fetch after the server's
          // terminal event so persisted user messages (and their durable IDs)
          // are restored for actions such as Mission handoff.
          void qc.invalidateQueries({ queryKey: ['ai-messages', data.sessionId] });
          setPendingChanges(data.pendingChanges ?? []);
          setProposalId(data.proposalId ?? undefined);
          setProposalUnavailable(data.proposalUnavailable ?? null);
          if (data.proposalId && (data.pendingChanges?.length ?? 0) > 0) {
            liveProposalRef.current = data.proposalId;
          }
          setOperationMode(nextOperationMode);
          setOperationId(
            nextOperationMode === 'DELIVERY'
              ? data.operationId ?? (data.proposalId ? data.message.id : undefined)
              : undefined,
          );
          streamOwnerRef.current = null;
          if (data.proposalId && (data.pendingChanges?.length ?? 0) > 0) {
             // Refresh the durable proposal after the live result so a
             // just-created session converges to the server-owned approval
             // record instead of retaining a stale empty query result.
             void qc.invalidateQueries({ queryKey: ['ai-pending-proposal', data.sessionId] });
           }
          publishAiChatData(requestProjectId, data.sessionId);
          void qc.invalidateQueries({ queryKey: ['ai-sessions', requestProjectId] });
        },
        onError: (err) => {
          if (!ownsStream(err.executionId ? { executionId: err.executionId } : undefined)) return;
          const currentExecution = activeExecutionRef.current;
           const erroredExecutionId = err.executionId ?? currentExecution?.id;
           if (resumeStreamExecutionRef.current === erroredExecutionId) {
             resumeStreamExecutionRef.current = null;
           }
          const retainedFailedExecution = projectRetainedFailedExecution(err, currentExecution);
          const resumableDisconnect = isResumableStreamDisconnect(err, currentExecution);
           if (resumableDisconnect && currentExecution && scheduleAutoReconnect(currentExecution)) {
             setAgentStartedAt(null);
             setAgentElapsedSeconds(0);
             void refetchActiveExecutionStatus?.();
             void qc.invalidateQueries({ queryKey: ['ai-execution', currentExecution.id] });
             publishAiChatData(requestProjectId, currentExecution.sessionId);
             return;
           }
           resetAutoReconnect();
          setAgentStage(null);
          setProjectQueryRetryMessageId(null);
          setStreamingContent('');
          setAgentSteps([]);
          setAgentIter(null);
          setAgentModel(null);
          setAgentStartedAt(null);
          setAgentElapsedSeconds(0);
          setAgentModelHistory([]);
          setAgentDiagnostics([]);
          setLiveFixtureLocal(false);
          setLiveEvidenceIntegrity(null);
          setLiveVerdictScope(null);
          setLocalMessages((prev) => prev.filter((m) => !m.id.startsWith('opt-')));
          const failedExecutionId = err.executionId ?? currentExecution?.id;
          const failedSessionId = currentExecution?.sessionId ?? sessionId;
          if (!retainedFailedExecution) {
            activeExecutionRef.current = null;
            setActiveExecution(null);
          } else {
            activeExecutionRef.current = retainedFailedExecution;
            setActiveExecution(retainedFailedExecution);
          }
          if (failedExecutionId) {
            void qc.invalidateQueries({ queryKey: ['ai-execution', failedExecutionId] });
          }
          if (failedSessionId) {
            void qc.invalidateQueries({ queryKey: ['ai-messages', failedSessionId] });
          }
          void qc.invalidateQueries({ queryKey: ['ai-sessions', requestProjectId] });
           publishAiChatData(requestProjectId, failedSessionId);
          const failedMessage = projectFailedAssistantMessage(err, failedExecutionId);
          if (failedMessage) {
            setLocalMessages((prev) => [
              ...prev.filter((m) => !m.id.startsWith('opt-')),
              failedMessage,
            ]);
          }
          toast({ title: 'Failed to send message', description: describeStreamError(err), variant: 'destructive' });
        },
      },
    ).finally(() => {
      if (
        options?.buildPlanMessageId &&
        generation === streamGenerationRef.current
      ) setPlanBuildPending(null);
    });
  }

  function missionExecutionContextFromChat(executionId: string): ActiveExecution | null {
    const current = activeExecutionRef.current;
    if (
      current?.id === executionId
      && current.projectId === selectedProjectId
      && current.sessionId === sessionId
    ) {
      return current;
    }

    let executionMessageIndex = -1;
    for (let index = localMessages.length - 1; index >= 0; index -= 1) {
      if (
        localMessages[index].executionId === executionId
        && localMessages[index].role === 'assistant'
      ) {
        executionMessageIndex = index;
        break;
      }
    }
    if (executionMessageIndex < 0) return null;
    const originalUserMessage = [...localMessages.slice(0, executionMessageIndex + 1)]
      .reverse()
      .find((message) => message.role === 'user' && message.content.trim());
    if (!originalUserMessage) return null;

    return {
      id: executionId,
      projectId: selectedProjectId ?? '',
      sessionId: sessionId ?? undefined,
      message: originalUserMessage.content,
      resumable: true,
    };
  }

  async function resumeActiveExecution(
    mode: 'resume' | 'retry' = 'resume',
    recoveryCapability?: { executionId: string; resumeToken: string; attempt: number },
    executionContext?: ActiveExecution,
  ): Promise<boolean> {
    const execution = executionContext ?? activeExecutionRef.current;
    if (
      !execution
      || resumeRecoveryPendingRef.current === execution.id
      || resumeStreamExecutionRef.current === execution.id
    ) return false;
    setResumeRecoveryError(null);
    // A manual resume supersedes a queued automatic reconnect. Clearing the
    // timer here also closes the race where the timer fires after the button
    // handler has already sent the same resume request.
    resetAutoReconnect();
    const ownerTaskId = execution.linkedTaskId
      ?? (activeExecutionStatus?.id === execution.id
        ? activeExecutionStatus.linkedTaskId
        : undefined);
    if (ownerTaskId && !recoveryCapability) {
      setResumeRecoveryError('This Task-linked execution must be resumed from its owning Task.');
      return false;
    }

    if (recoveryCapability && recoveryCapability.executionId !== execution.id) {
      setResumeRecoveryError('The Mission recovery capability does not match the active Execution.');
      return false;
    }
    const suppliedResumeToken = recoveryCapability?.resumeToken;
    if (suppliedResumeToken || (mode === 'resume' && execution.resumeToken)) {
      const recovered = {
        ...execution,
        ...(suppliedResumeToken ? { resumeToken: suppliedResumeToken } : {}),
        ...(recoveryCapability ? { attempt: recoveryCapability.attempt } : {}),
      };
      activeExecutionRef.current = recovered;
      setActiveExecution(recovered);
      if (executionStorageKey) {
        localStorage.setItem(
          executionStorageKey,
          JSON.stringify({
            ...recovered,
            projectId: selectedProjectId,
            sessionId: executionStorageSessionId,
          }),
        );
      }
      resumeStreamExecutionRef.current = execution.id;
      sendMessage(execution.message, {
        executionId: execution.id,
        resumeToken: recovered.resumeToken,
        buildPlanMessageId: execution.buildPlanMessageId,
        sessionId: execution.sessionId,
      });
      return true;
    }

    resumeRecoveryPendingRef.current = execution.id;
    setResumeRecoveryPending(true);
    try {
      const response = await fetch(
        `/api/ai/executions/${encodeURIComponent(execution.id)}/${mode === 'retry' ? 'retry-capability' : 'resume-capability'}`,
        {
        method: 'POST',
        credentials: 'include',
        headers: { Accept: 'application/json' },
        },
      );
      const body = await response.json().catch(() => ({})) as {
        executionId?: string;
        resumeToken?: string;
        error?: string;
      };
      if (!response.ok || body.executionId !== execution.id || !body.resumeToken) {
        throw new Error(
          body.error
            || (mode === 'retry'
              ? 'Retry is no longer available for this execution.'
              : 'Resume is no longer available for this execution.'),
        );
      }

      const recovered = { ...execution, resumeToken: body.resumeToken };
      activeExecutionRef.current = recovered;
      // Persist the capability only after an explicit manual resume request.
      // Passive status polling must not claim the token while the server-side
      // recovery coordinator is trying to continue the same execution.
      if (executionStorageKey) {
        localStorage.setItem(
          executionStorageKey,
          JSON.stringify({
            ...recovered,
            projectId: selectedProjectId,
            sessionId: executionStorageSessionId,
          }),
        );
        if (executionPointerKey && executionStorageSessionId) {
          localStorage.setItem(executionPointerKey, executionStorageSessionId);
        }
      }
      setActiveExecution(recovered);
      resumeStreamExecutionRef.current = recovered.id;
      sendMessage(recovered.message, {
        executionId: recovered.id,
        resumeToken: recovered.resumeToken,
        buildPlanMessageId: recovered.buildPlanMessageId,
        sessionId: recovered.sessionId,
      });
      return true;
    } catch (error: unknown) {
      setResumeRecoveryError(
        error instanceof Error
          ? error.message
          : 'Could not recover the resume capability. Try again.',
      );
      return false;
    } finally {
      if (resumeRecoveryPendingRef.current === execution.id) {
        resumeRecoveryPendingRef.current = null;
      }
      setResumeRecoveryPending(false);
    }
  }

  async function performRouteMissionAction(command?: 'STOP') {
    const agent = routeMissionAgent;
    const missionId = workspaceMissionId;
    if (!agent || !missionId || missionAgentActionPending) return;
    const action = command ?? agent.nextAction.kind;
    if (action === 'NONE') return;
    const stopCommand = command
      ? agent.availableCommands.find((item) => item.kind === command)
      : undefined;
    if (command && !stopCommand) {
      setMissionAgentActionError('أمر الإيقاف لم يعد متاحًا في الحالة الحالية.');
      void missionAgentProjectionQuery.refetch();
      return;
    }
    const targetId = command
      ? stopCommand?.target.id ?? ''
      : agent.nextAction.target?.id ?? '';
    const recoveryExecution = action === 'RESUME' || action === 'RETRY'
      ? missionExecutionContextFromChat(targetId)
      : undefined;
    if ((action === 'RESUME' || action === 'RETRY') && !recoveryExecution) {
      setMissionAgentActionError('رسالة هذا التنفيذ غير موجودة في المحادثة الحالية. حدّث سجل المحادثة قبل الاسترداد.');
      return;
    }
    if (action === 'APPROVE' && !window.confirm('هل تريد اعتماد القرار الحالي لهذه المهمة؟')) return;
    if (action === 'REPLAN' && !window.confirm('هل تريد إنشاء نسخة خطة جديدة لهذه المهمة؟')) return;
    if (action === 'STOP' && !window.confirm('هل تريد إرسال طلب إيقاف التنفيذ الحالي؟')) return;
    const actionIdentity = `${missionId}:${action}:${targetId}`;
    const idempotencyKey = missionAgentActionKeys.current.get(actionIdentity)
      ?? crypto.randomUUID();
    missionAgentActionKeys.current.set(actionIdentity, idempotencyKey);
    setMissionAgentActionPending(true);
    setMissionAgentActionError(null);
    setMissionAgentActionNotice(null);
    try {
      const result = await executeMissionAgentAction(missionId, {
        idempotencyKey,
        expectedDecision: {
          kind: agent.nextAction.kind,
          target: agent.nextAction.target,
          reasonCode: agent.nextAction.reasonCode,
        },
        ...(command ? { command } : {}),
      });
      await missionAgentProjectionQuery.refetch();
      if (result.recovery) {
        const resumed = await resumeActiveExecution(
          action === 'RETRY' ? 'retry' : 'resume',
          result.recovery,
          recoveryExecution!,
        );
        if (!resumed) {
          throw new Error('لم يبدأ الاسترداد بعد. حدّث حالة المهمة وحاول مرة أخرى.');
        }
        missionAgentActionKeys.current.delete(actionIdentity);
        setMissionAgentActionNotice(
          action === 'RETRY' ? 'بدأت إعادة المحاولة عبر مسار الاسترداد الحالي.' : 'بدأ استئناف التنفيذ عبر مسار الاسترداد الحالي.',
        );
      } else {
        if (result.outcome !== 'in_progress') {
          missionAgentActionKeys.current.delete(actionIdentity);
        }
        setMissionAgentActionNotice(result.outcome === 'in_progress'
          ? 'هذا الطلب قيد التنفيذ بالفعل؛ ستُحدّث الحالة تلقائيًا.'
          : 'أُرسل الإجراء عبر بوابة المهمة، وتم تحديث الحالة.');
      }
    } catch (error: unknown) {
      const status = typeof error === 'object' && error !== null && 'status' in error
        ? Number((error as { status?: unknown }).status)
        : Number.NaN;
      const code = typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: unknown }).code)
        : '';
      if (Number.isFinite(status) && status < 500) {
        missionAgentActionKeys.current.delete(actionIdentity);
      }
      setMissionAgentActionError(
        code === 'EXECUTION_OWNER_ROUTE_REQUIRED'
          ? 'هذا التنفيذ تابع لمهمة أخرى؛ افتح المهمة المالكة لاستئنافه أو إعادة محاولته.'
          : error instanceof Error
            ? error.message
            : 'تعذر تنفيذ إجراء المهمة. حدّث الحالة وحاول مجددًا.',
      );
      void missionAgentProjectionQuery.refetch();
    } finally {
      setMissionAgentActionPending(false);
    }
  }

  async function cancelActiveExecution() {
    const execution = activeExecutionRef.current;
    if (!execution || executionControlPending) return;
    setExecutionControlPending(true);
    try {
      const response = await fetch(`/api/ai/executions/${encodeURIComponent(execution.id)}/cancel`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: '{}',
      });
      const body = await response.json().catch(() => ({})) as {
        error?: string;
        status?: AgentExecutionProofStatus['status'];
      };
      if (!response.ok) throw new Error(body.error || 'This execution could not be cancelled.');
      cancelStream();
      cancelTaskStream();
      setAgentStage('Cancellation requested — waiting for the server terminal state…');
      if (body.status) {
        qc.setQueryData(
          ['ai-execution', execution.id],
          (current: AgentExecutionProofStatus | undefined) => current
            ? { ...current, status: body.status }
            : current,
        );
      }
      void qc.invalidateQueries({ queryKey: ['ai-execution', execution.id] });
      void refetchActiveExecutionStatus?.();
      if (execution.sessionId) {
        void qc.invalidateQueries({ queryKey: ['ai-messages', execution.sessionId] });
      }
      toast({ title: 'Cancellation requested', description: 'The server is closing this execution. No changes will be applied automatically.' });
    } catch (error) {
      toast({
        title: 'Cancellation failed',
        description: error instanceof Error ? error.message : 'The execution was not changed.',
        variant: 'destructive',
      });
    } finally {
      setExecutionControlPending(false);
    }
  }

  function handleSend() {
    if (sessionId && messagesError) return;
    const trimmedMessage = input.trim();
    if (isFallbackDiagnosticQuestion(trimmedMessage)) {
      const latestAssistant = [...localMessages].reverse().find((message) => message.role === 'assistant');
      if (
        latestAssistant
        && latestAssistant.sessionId === sessionId
        && latestAssistant.projectQueryResponseSource === 'deterministic_fallback'
        && latestAssistant.projectQueryResponseFallbackReason
        && latestAssistant.executionId
        && selectedProjectId
        && sessionId
      ) {
        setInput('');
        fallbackDiagnosticMutation.mutate({
          data: {
            projectId: selectedProjectId,
            sessionId,
            messageId: latestAssistant.id,
            executionId: latestAssistant.executionId,
          },
        });
      } else {
        toast({
          title: 'ما التشغيل الذي تريد شرحه؟',
          description: 'افتح رسالة الإجابة البديلة نفسها واختر «اشرح سبب الإجابة البديلة».',
          variant: 'default',
        });
      }
      return;
    }
    sendMessage(trimmedMessage);
  }

  function explainFallbackForMessage(message: ChatMessage) {
    if (!selectedProjectId || !sessionId || !message.executionId) return;
    fallbackDiagnosticMutation.mutate({
      data: {
        projectId: selectedProjectId,
        sessionId,
        messageId: message.id,
        executionId: message.executionId,
      },
    });
  }

  async function handleMissionHandoffComplete(
    mission: { id: string; title: string },
    projectId: string | undefined,
    linkedSessionId: string | undefined,
  ): Promise<void> {
    if (linkedSessionId) {
      const queryKey = [
        ...getListAiChatSessionMissionsQueryKey(linkedSessionId),
        user?.id ?? null,
      ];
      try {
        await refetchChatSessionMissions();
        let sessionMissions = qc.getQueryData<AiChatSessionMissionsResponse>(queryKey);
        if (
          sessionMissions?.sessionId !== linkedSessionId
          || !sessionMissions.missions.some(({ mission: linkedMission }) => (
            linkedMission.id === mission.id
          ))
          || sessionMissions.activeMissionId !== mission.id
        ) {
          await selectSessionMission(linkedSessionId, mission.id, false);
          await refetchChatSessionMissions();
          sessionMissions = qc.getQueryData<AiChatSessionMissionsResponse>(queryKey);
        }
        if (
          sessionMissions?.sessionId !== linkedSessionId
          || sessionMissions.activeMissionId !== mission.id
          || !sessionMissions.missions.some(({ mission: linkedMission }) => (
            linkedMission.id === mission.id
          ))
        ) {
          throw new Error('لم يؤكد الخادم اختيار المهمة الجديدة لهذه المحادثة بعد.');
        }
        if (projectId) {
          await qc.fetchQuery({
            queryKey: ['mission-agent-projection', projectId, mission.id],
            queryFn: () => fetchMissionProjection(mission.id),
            staleTime: 0,
          });
        }
      } catch (error) {
        toast({
          title: 'أُنشئت المهمة، لكن تعذّر عرض حالتها في المحادثة',
          description: error instanceof Error
            ? error.message
            : 'أعد تحميل المهام المرتبطة للمحاولة مجددًا.',
          variant: 'destructive',
        });
      }
      if (projectId) publishAiChatData(projectId, linkedSessionId);
    }
    toast({
      title: 'Mission started',
      description: `"${mission.title}" is now linked to this conversation. Its status will update here.`,
    });
  }

  async function handleMissionHandoff(message: ChatMessage) {
    if (!selectedProjectId || !sessionId || missionHandoffPending) return;
    const handoffProjectId = selectedProjectId;
    const handoffSessionId = sessionId;
    setMissionHandoffPending(message.id);
    try {
      const result = await createMissionFromChat({
        projectId: handoffProjectId,
        idempotencyKey: crypto.randomUUID(),
        message: message.content,
        sessionId: handoffSessionId,
        messageId: message.id,
      });
      await handleMissionHandoffComplete(result.mission, handoffProjectId, handoffSessionId);
    } catch (error) {
      toast({
        title: 'Mission handoff unavailable',
        description: error instanceof Error ? error.message : 'This request is not eligible for a Mission.',
        variant: 'destructive',
      });
    } finally {
      setMissionHandoffPending(null);
    }
  }

  async function handlePlanDecision(messageId: string, decision: PlanDecision) {
    if (planDecisionPending) return;
    setPlanDecisionPending(messageId);
    try {
      const response = await fetch(
        `/api/ai/chat/plans/${encodeURIComponent(messageId)}/decision`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ decision }),
        },
      );
      const payload = await response.json().catch(() => ({})) as {
        error?: string;
        taskResult?: AiTaskResult;
      };
      if (!response.ok || !payload.taskResult) {
        throw new Error(payload.error || `Plan decision failed (${response.status})`);
      }

      setLocalMessages((previous) =>
        previous.map((message) =>
          message.id === messageId
            ? { ...message, taskResult: payload.taskResult ?? message.taskResult }
            : message,
        ),
      );
      toast({
        title: decision === 'approve' ? 'سُجّلت الموافقة على الخطة' : 'سُجّل رفض الخطة',
        description: decision === 'approve'
          ? 'الخطة مهيأة لبدء التنفيذ. لم تتغير الملفات.'
          : 'الخطة لا تسمح بالتنفيذ. لم تتغير الملفات.',
      });
    } catch (error) {
      toast({
        title: 'تعذر حفظ قرار الخطة',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    } finally {
      setPlanDecisionPending(null);
    }
  }

  function handlePlanBuild(messageId: string) {
    if (!selectedProjectId || !sessionId || isSending || planBuildPending) return;
    const planMessage = localMessages.find((message) => message.id === messageId);
    const plan = planMessage?.taskResult;
    if (
      !plan ||
      plan.kind !== 'IMPLEMENTATION_PLAN_RESULT' ||
      plan.approvalStatus !== 'APPROVED' ||
      plan.writeAccess !== 'APPROVED_FOR_BUILD'
    ) {
      toast({
        title: 'تلزم الموافقة على الخطة',
        description: 'وافق على خطة التنفيذ قبل بدء العمل وفقها.',
        variant: 'destructive',
      });
      return;
    }

    setPlanBuildPending(messageId);
    sendMessage('Build the approved implementation plan.', { buildPlanMessageId: messageId });
  }

  /** Quick-action dispatch:
   *  - 'analyze' → POST /api/ai/projects/:id/analyze (structured result rendered in chat)
   *  - 'review'  → POST /api/ai/projects/:id/review  (structured result rendered in chat)
   *  - others    → send the prompt directly through the chat agent
   */
  function handleQuickAction(action: typeof AI_ACTIONS[number]) {
    if (projectsLoading || !selectedProjectId || (sessionId && messagesError)) return;

    if (action.id === 'analyze') {
      startStructuredTask('analyze', action.prompt);
      return;
    }

    if (action.id === 'review') {
      startStructuredTask('review', action.prompt);
      return;
    }

    // 'tasks' and 'workflow' — route through chat agent, send immediately.
    sendMessage(action.prompt);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function resetConversationView(options: { forgetCurrentExecution: boolean }) {
    streamGenerationRef.current += 1;
    cancelStream();
    setDeliveryToDiscard(null);
    if (options.forgetCurrentExecution) {
      if (executionPointerKey) localStorage.removeItem(executionPointerKey);
      clearAiChatSelection(selectedProjectId);
    }
    clearExecutionScopedState();
    setSessionId(undefined);
    setHistoricalExecutionId(null);
    setAuditPreview(null);
    setAuditPreviewError(null);
    setInput('');
    setLocalMessages([]);
    setPendingChanges([]);
    setProposalId(undefined);
    setProposalRequiresApproval(false);
    setProposalRevision(undefined);
    setVerificationResults({});
    setAgentStage(null);
    setAgentSteps([]);
    clearLiveActivityEvents();
    setAgentIter(null);
    setAgentModel(null);
    setAgentStartedAt(null);
    setAgentElapsedSeconds(0);
    setAgentModelHistory([]);
    setAgentDiagnostics([]);
    setLiveFixtureLocal(false);
    setLiveEvidenceIntegrity(null);
    setLiveVerdictScope(null);
    setScopeDraftRestored(false);
    restoredScopeDraftKey.current = '';
  }

  function newSession() {
    if (!preserveCurrentProjectComposerDraft() && input.trim()
      && !window.confirm('تعذر حفظ النص غير المرسل لهذه المحادثة. هل تريد فتح محادثة جديدة على أي حال؟')) return;
    resetConversationView({ forgetCurrentExecution: true });
    if (!window.matchMedia('(min-width: 768px)').matches) setSidebarOpen(false);
  }

  // Textarea placeholder follows the same classification.
  function getPlaceholder(): string {
    if (!isLoaded || projectsLoading) return 'جارٍ تحميل مشاريعك…';
    if (projectLoadFailure) return 'تعذر تحميل المشاريع. راجع التنبيه وحدّث البيانات…';
    if (!selectedProjectId) return 'اختر مشروعًا أو أنشئ مشروعًا أولًا…';
    if (sessionId && messagesError) return 'أعد تحميل رسائل المحادثة قبل المتابعة…';
    if (!activeProvider) return 'جارٍ التحقق من إعداد المساعد…';
    if (!activeProvider.configured || !activeProvider.provider) return 'راجع إعدادات المزود قبل الإرسال…';
    if (activeProviderSendBlocked) return 'الإرسال متوقف بسبب حالة المزود؛ راجع التنبيه…';
    return 'اكتب ما تريد فهمه أو إنجازه في هذا المشروع… (Enter للإرسال)';
  }

  // Send-button title follows the same classification.
  function getSendTitle(): string | undefined {
    if (!isLoaded || projectsLoading) return 'جارٍ تحميل مشاريعك…';
    if (projectLoadFailure) return projectLoadFailure.message;
    if (!selectedProjectId) return 'اختر مشروعًا أولًا';
    if (sessionId && messagesError) return 'أعد تحميل رسائل المحادثة قبل المتابعة';
    if (!activeProvider) return 'جارٍ التحقق من إعداد المساعد';
    if (!activeProvider.configured || !activeProvider.provider) return 'راجع إعدادات المزود قبل الإرسال';
    if (activeProviderSendBlocked) return 'الإرسال متوقف بسبب حالة المزود؛ راجع التنبيه';
    return 'إرسال الرسالة';
  }

  const messages = localMessages;
  const isEmpty = messages.length === 0;
  const isAgentBusy = isSending || isTaskSending;
  const sessionHistoryLoading = Boolean(selectedProjectId && !sessionsFetched && !sessionsError);
  const conversationLoading = Boolean(
    sessionHistoryLoading && !sessionId
    || sessionId && !messagesError && (!messagesFetched || (isEmpty && serverMessages.length > 0)),
  );
  const projectName = projects.find((project) => project.id === selectedProjectId)?.name;
  const sessionName = historicalExecutionId
    ? 'مراجعة سابقة'
    : sessionId
      ? sessions.find((session) => session.id === sessionId)?.title ?? 'محادثة'
      : sessionHistoryLoading ? 'جارٍ تحميل المحادثات' : 'محادثة جديدة';
  const routeSessionUnavailable = Boolean(
    !sessionId
    && chatRouteTarget?.projectId === selectedProjectId
    && chatRouteTarget.sessionId
    && sessionsFetched
    && !sessionsError
    && !sessions.some((session) => session.id === chatRouteTarget.sessionId),
  );
  const visibleRouteMissionRestoration = routeMissionRestoration?.key === currentRouteMissionKey
    ? routeMissionRestoration
    : null;
  const routeSourceMessageUnavailable = Boolean(
    chatRouteTarget?.messageId
    && chatRouteTarget.projectId === selectedProjectId
    && chatRouteTarget.sessionId === sessionId
    && messagesFetched
    && (!routeMissionId || currentSessionMissions?.activeMissionId === routeMissionId)
    && !localMessages.some((message) => (
      message.id === chatRouteTarget.messageId
      && (!message.sessionId || message.sessionId === sessionId)
    )),
  );
  const emptyContext = !isLoaded || projectsLoading
    ? { title: 'جارٍ تحميل مشاريعك', subtitle: 'نحمّل قائمة المشاريع المتاحة لحسابك.' }
    : projectLoadFailure
      ? { title: 'المشاريع غير متاحة الآن', subtitle: projectLoadFailure.message }
      : !selectedProjectId
        ? { title: 'اختر مشروعًا للبدء', subtitle: 'اختر مشروعًا موجودًا أو أنشئ مشروعًا قبل بدء محادثته.' }
        : conversationLoading
          ? { title: 'جارٍ تحميل المحادثة', subtitle: 'بانتظار المحادثة المحفوظة ورسائلها. لم نبدأ محادثة جديدة.' }
          : sessionId && messagesError
            ? { title: 'المحادثة غير متاحة الآن', subtitle: 'تعذر تحميل الرسائل؛ هذا لا يعني حذفها. أعد تحميلها أو اختر محادثة أخرى.' }
          : sessionsError
            ? { title: 'قائمة المحادثات غير متاحة الآن', subtitle: 'تعذر تحميل القائمة. أعد المحاولة، أو ابدأ محادثة جديدة صراحةً.' }
            : sessionId
              ? { title: 'لا توجد رسائل في هذا العرض', subtitle: 'اكتب سؤالًا للمتابعة في هذا المشروع.' }
              : { title: 'ابدأ محادثة جديدة', subtitle: 'اكتب سؤالًا عن المشروع، أو اختر نقطة بداية أدناه.' };
  const showStartingPoints = Boolean(selectedProjectId && !projectLoadFailure && !conversationLoading && !messagesError);
  const latestForensicMessage = [...messages]
    .reverse()
    .find((message) => message.role === 'assistant'
      && message.taskResult?.kind !== 'PROJECT_QUERY_INVESTIGATION_RESULT' && (
      Boolean(message.taskResult)
      || Boolean(message.forensicDiagnostic)
      || /\bANALYSIS_INCOMPLETE\b|\bFINDING PROVEN\b|\bNO FINDING\b|\bNOT PROVEN\b/i.test(message.content)
    ));
  const latestForensicTrace = latestForensicMessage
    ? parseToolTrace(latestForensicMessage.toolTrace)
    : [];
  const latestForensicStatus = [...latestForensicTrace]
    .reverse()
    .find((entry) => entry.kind === 'forensic_status')?.findingStatus;
  const latestForensicVerdict = latestForensicMessage
    ? getFinalForensicVerdict(latestForensicMessage.content, latestForensicStatus)
    : null;
  const scopedExecutionStatus = activeExecutionStatus?.id
    && activeExecutionStatus.id !== activeExecution?.id ? null : activeExecutionStatus;
  const currentProofPresentation = resolveExecutionProofPresentation(scopedExecutionStatus);
  const displayExecutionStatus = scopedExecutionStatus
    ? { ...scopedExecutionStatus, ...currentProofPresentation }
    : null;
  const recoveryView = activeExecution
    ? getExecutionRecoveryView(displayExecutionStatus, Boolean(historicalExecutionId))
    : null;
  const activeExecutionIsProofBearing = Boolean(
    activeExecution
    && (
      activeExecution.proofRequired === true
      || scopedExecutionStatus?.proofRequired === true
      || operationMode !== 'CHAT'
    )
    && activeExecution.proofRequired !== false
    && scopedExecutionStatus?.proofRequired !== false,
  );
  const showExecutionProof = Boolean(
    activeExecutionIsProofBearing ||
    pendingChanges.length > 0 ||
    commitReadyPaths.length > 0 ||
    pushReady ||
    operationMode === 'DELIVERY' ||
    agentSteps.length > 0 ||
    liveEvidenceIntegrity ||
    liveFixtureLocal,
  );
  const showExecutionProofInEmptyState = Boolean(
    showExecutionProof
    && (
      historicalExecutionId
      || activeExecution?.proofRequired === true
      || scopedExecutionStatus?.proofRequired === true
    ),
  );
  const workSummary = activeExecutionIsProofBearing && recoveryView
    ? {
        title: recoveryView.title,
        reason: recoveryView.detail,
        nextStep: recoveryView.nextStep,
      }
    : proposalUnavailable
      ? {
          title: 'Changes need more verification',
          reason: proposalUnavailable,
          nextStep: 'Review the blocked proposal below',
        }
      : pendingChanges.length > 0
        ? {
            title: 'Candidate changes need review',
            reason: 'Validation and approval requirements remain in effect. No change is approved by this summary.',
            nextStep: 'Review validation and the change proposal below',
          }
        : isAgentBusy
          ? {
              title: 'Assistant response in progress',
              reason: 'The server-owned execution and its proof will determine the outcome.',
              nextStep: 'Watch the current activity below',
            }
          : (recoverableDeliveries?.operations?.length ?? 0) > 0
            ? {
                title: 'Retained delivery work needs attention',
                reason: 'Delivery recovery is separate from resuming the AI execution. The owner policy and server gates still apply.',
                nextStep: 'Review the recoverable delivery operation below',
              }
            : null;
  const workSummaryTargetId = activeExecutionIsProofBearing && recoveryView
    ? isAgentBusy
      ? 'group-assistant-response-progress'
      : recoveryView.action
        ? 'button-recover-execution'
        : 'region-agent-execution-proof'
    : proposalUnavailable && pendingChanges.length === 0
      ? 'alert-proposal-unavailable'
      : pendingChanges.length > 0
        ? 'region-candidate-changes'
        : isAgentBusy
          ? 'group-assistant-response-progress'
          : (recoverableDeliveries?.operations?.length ?? 0) > 0
            ? 'region-recoverable-deliveries'
            : null;
  const confirmedExecutionDestinationId = activeExecutionIsProofBearing
    && selectedProjectId
    && activeExecution?.projectId === selectedProjectId
    && scopedExecutionStatus?.id === activeExecution.id
      ? activeExecution.id
      : null;

  useEffect(() => {
    if (!isAgentBusy || agentStartedAt === null) return;
    const updateElapsed = () => {
      setAgentElapsedSeconds(Math.max(0, Math.floor((Date.now() - agentStartedAt) / 1000)));
    };
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(timer);
  }, [agentStartedAt, isAgentBusy]);

  function stopActiveRequest() {
    if (!isSending) return;
    streamGenerationRef.current += 1;
    cancelStream();
    setStreamingContent('');
    setAgentStage(null);
    setAgentSteps([]);
    clearLiveActivityEvents();
    setAgentIter(null);
    setAgentModel(null);
    setAgentStartedAt(null);
    setAgentElapsedSeconds(0);
    setAgentModelHistory([]);
    setAgentDiagnostics([]);
    setLiveFixtureLocal(false);
    setLiveEvidenceIntegrity(null);
    setLiveVerdictScope(null);
    setLocalMessages((prev) => prev.filter((message) => !message.id.startsWith('opt-')));
    toast({
      title: 'Live display stopped',
      description: 'Only the local stream display stopped. The server execution remains available to resume.',
    });
  }

  const {
    sidebarOpen,
    setSidebarOpen,
    sessionsDrawerRef,
    sessionsToggleRef,
    sessionsCloseRef,
    isMobileSessionDrawer,
  } = useSessionsDrawer();

  return (
    <div className="relative flex h-full min-h-0 min-w-0 max-w-full overflow-hidden overscroll-contain">
      {/* UI-01: closeable mobile drawer backdrop */}
      {sidebarOpen && (
        <button
          type="button"
          onClick={() => setSidebarOpen(false)}
          onWheel={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onTouchMove={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          className="absolute inset-0 z-20 bg-black/55 md:hidden"
          aria-label="إغلاق قائمة المحادثات من الخلفية"
        />
      )}

      {/* Sidebar — sessions */}
      {/* UI-01: desktop sidebar is collapsible; mobile drawer overlays the chat
       * instead of shrinking it to a narrow unreadable column. */}
      <div
        ref={sessionsDrawerRef}
        id="ai-sessions-drawer"
        data-testid="sessions-drawer"
        role={sidebarOpen && isMobileSessionDrawer ? 'dialog' : undefined}
        aria-label={sidebarOpen && isMobileSessionDrawer ? 'محادثات المشروع' : undefined}
        aria-modal={sidebarOpen && isMobileSessionDrawer ? true : undefined}
        tabIndex={-1}
        className={`${sidebarOpen ? 'flex md:flex' : 'hidden md:hidden'} sessions-drawer absolute inset-y-0 left-0 z-30 h-full min-h-0 w-[min(16rem,100%)] max-w-full min-w-0 flex-col overflow-hidden overscroll-contain border-r border-border bg-background shadow-2xl transition-transform md:relative md:inset-y-auto md:z-auto md:h-auto md:w-56 md:max-w-none md:shadow-none`}
        onWheel={(event) => event.stopPropagation()}
        onTouchMove={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border p-3">
          <span lang="ar" className="text-xs text-muted-foreground">محادثات المشروع</span>
          <div className="flex items-center gap-1">
            <Button
              ref={sessionsCloseRef}
              size="sm"
              variant="ghost"
              className="h-6 w-6 p-0"
              onClick={newSession}
              aria-label="محادثة جديدة"
            >
              <Plus className="w-3.5 h-3.5" />
            </Button>
            {/* Collapse button — only shown on narrow screens */}
            <Button
              size="sm"
              variant="ghost"
              className="h-6 w-6 p-0 md:hidden"
              onClick={() => setSidebarOpen(false)}
              title="إغلاق قائمة المحادثات"
              aria-label="إغلاق قائمة المحادثات"
            >
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>

        {/* Project selector */}
        <div className="p-2 border-b border-border">
          <div className="relative">
            <select
              aria-label="مشروع المحادثة"
              dir="auto"
              data-testid="select-chat-project"
              value={selectedProjectId}
              onChange={(e) => {
                const preservedGoal = draftHandoff.activeDraft ? input : null;
                if (
                  e.target.value !== selectedProjectId
                  && preservedGoal === null
                  && input.trim()
                  && !preserveCurrentProjectComposerDraft()
                  && !window.confirm('تعذر حفظ النص غير المرسل للمشروع الحالي. هل تريد تغيير المشروع على أي حال؟')
                ) return;
                resetConversationView({ forgetCurrentExecution: false });
                if (preservedGoal !== null) setInput(preservedGoal);
                setSelectedProjectId(e.target.value);
                if (!window.matchMedia('(min-width: 768px)').matches) setSidebarOpen(false);
              }}
              className="w-full text-xs bg-secondary border border-border rounded-md px-2 py-1.5 text-foreground appearance-none pr-6"
            >
              {projects.length === 0
                ? <option value="">لا توجد مشاريع متاحة</option>
                : <option value="" disabled>اختر مشروعًا للمحادثة</option>}
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <ChevronDown className="w-3 h-3 absolute right-2 top-2 text-muted-foreground pointer-events-none" />
          </div>
        </div>

        <div className="drawer-scroll-region min-h-0 flex-1 overflow-y-auto overscroll-contain md:flex md:flex-col md:overflow-hidden">
          <div className="sessions-history relative z-10 shrink-0 md:min-h-0 md:flex-1 md:overflow-y-auto">
            <div className="p-2 flex flex-col gap-1">
            {!selectedProjectId ? (
              <p className="px-2 py-2 text-xs text-muted-foreground" data-testid="text-sessions-select-project">
                اختر مشروعًا لعرض محادثاته.
              </p>
            ) : sessionHistoryLoading ? (
              <p className="px-2 py-2 text-xs text-muted-foreground" role="status" data-testid="status-sessions-loading">
                جارٍ تحميل المحادثات…
              </p>
            ) : sessionsError ? (
              <div className="px-2 py-2 text-xs text-muted-foreground" role="alert" data-testid="alert-sessions-unavailable">
                <p dir="rtl">تعذر تحميل قائمة المحادثات. هذا لا يعني حذف المحادثات المحفوظة.</p>
                <Button type="button" size="sm" variant="outline" className="mt-2 h-7 text-xs"
                  data-testid="button-retry-sessions"
                  onClick={() => void qc.invalidateQueries({ queryKey: ['ai-sessions', selectedProjectId] })}>
                  إعادة تحميل المحادثات
                </Button>
              </div>
            ) : sessions.length === 0 ? (
              <p className="px-2 py-2 text-xs text-muted-foreground" data-testid="text-no-sessions">
                {sessionId
                  ? 'لا توجد محادثات في القائمة الحالية. قد يبقى تنفيذ محفوظ متاحًا في هذه المحادثة.'
                  : 'لا توجد محادثات في هذا العرض بعد. ابدأ محادثة من الزر أعلاه أو اكتب سؤالًا.'}
              </p>
            ) : (
            sessions.map((s) => (
              <button
                key={s.id}
                aria-label={s.title}
                aria-current={s.id === sessionId && !historicalExecutionId ? 'true' : undefined}
                data-testid={`button-chat-session-${s.id}`}
                onClick={() => {
                  if (s.id === sessionId && !historicalExecutionId) {
                    persistAiChatSelection({
                      version: 1,
                      projectId: selectedProjectId,
                      kind: 'session',
                      sessionId: s.id,
                    });
                    if (!window.matchMedia('(min-width: 768px)').matches) setSidebarOpen(false);
                    return;
                  }
                  if (!draftHandoff.activeDraft && input.trim()
                    && !preserveCurrentProjectComposerDraft()
                    && !window.confirm('تعذر حفظ النص غير المرسل للمحادثة الحالية. هل تريد فتح محادثة أخرى على أي حال؟')) {
                    return;
                  }
                  streamGenerationRef.current += 1;
                  cancelStream();
                  clearExecutionScopedState();
                  persistAiChatSelection({
                    version: 1,
                    projectId: selectedProjectId,
                    kind: 'session',
                    sessionId: s.id,
                  });
                  setHistoricalExecutionId(null);
                  setAuditPreview(null);
                  setAuditPreviewError(null);
                  setSessionId(s.id);
                  if (!draftHandoff.activeDraft) {
                    setInput('');
                    setScopeDraftRestored(false);
                    const targetContextId = getAssistantComposerContextId('project', selectedProjectId, s.id);
                    if (user?.id && targetContextId) {
                      const storedDraft = readAssistantComposerDraft(user.id, 'project', targetContextId);
                      restoredScopeDraftKey.current = `${user.id}:project:${targetContextId}`;
                      if (!storedDraft.ok) {
                        setScopeDraftStorageError('تعذر استعادة النص غير المرسل لهذه المحادثة من هذا التبويب.');
                      } else if (storedDraft.text?.trim()) {
                        setInput(storedDraft.text);
                        setScopeDraftRestored(true);
                        setScopeDraftStorageError('');
                      } else {
                        setScopeDraftStorageError('');
                      }
                    }
                  }
                  setLocalMessages([]);
                  setPendingChanges([]);
                  setProposalId(undefined);
                  setProposalRequiresApproval(false);
                  setProposalRevision(undefined);
                  setVerificationResults({});
                  if (!window.matchMedia('(min-width: 768px)').matches) setSidebarOpen(false);
                }}
                className={`text-left px-2 py-1.5 rounded text-xs truncate transition-colors ${
                  s.id === sessionId && !historicalExecutionId
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
                }`}
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="min-w-0 truncate">{s.title}</span>
                  {sessionForensicStatusLabel(s.forensicStatus) && (
                    <span
                      aria-hidden="true"
                      className={`shrink-0 rounded border px-1 py-0.5 text-xs font-medium leading-none ${
                        s.forensicStatus === 'INCOMPLETE'
                          ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                          : s.forensicStatus === 'NO_FINDING'
                            ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                            : 'border-border bg-secondary text-muted-foreground'
                      }`}
                    >
                      {sessionForensicStatusLabel(s.forensicStatus)}
                    </span>
                  )}
                </span>
              </button>
            ))
            )}
            {(selectedProjectId || historicalAudits.length > 0 || historicalAuditsLoading || historicalAuditsError) && (
              <div dir="rtl" lang="ar" className="mt-3 border-t border-border pt-3">
                <button
                  type="button"
                  aria-label="التدقيقات السابقة"
                  aria-expanded={historicalAuditsExpanded}
                  aria-controls="historical-audits-content"
                  onClick={() => setHistoricalAuditsExpanded((expanded) => !expanded)}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-start transition-colors hover:bg-secondary/70"
                >
                  <span className="min-w-0 flex-1 text-xs font-medium text-muted-foreground">
                    التدقيقات السابقة
                  </span>
                  {historicalAudits.length > 0 && (
                    <Badge variant="outline" className="h-5 px-1.5 text-xs">
                      {historicalAudits.length}
                    </Badge>
                  )}
                  {historicalAuditsLoading && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                      <Loader2 aria-hidden="true" className="h-3 w-3 animate-spin" />
                      <span role="status">جارٍ تحميل التدقيقات السابقة…</span>
                    </span>
                  )}
                  <ChevronRight className={`h-3 w-3 shrink-0 text-muted-foreground transition-transform ${historicalAuditsExpanded ? 'rotate-90' : ''}`} />
                </button>
                <div id="historical-audits-content" hidden={!historicalAuditsExpanded} className="mt-1">
              {historicalAuditsError ? (
                <div
                  dir="rtl"
                  lang="ar"
                  role="alert"
                  className="px-2 py-2 text-xs leading-5 text-muted-foreground"
                >
                  تعذّر تحميل التدقيقات السابقة. لا تزال جلساتك الحالية متاحة.
                </div>
              ) : historicalAudits.length === 0 && !historicalAuditsLoading ? (
                <div dir="rtl" lang="ar" className="px-2 py-2 text-xs leading-5 text-muted-foreground">
                  لا توجد سجلات تدقيق ملغاة أو غير مكتملة لهذا المشروع.
                </div>
              ) : (
                <div className="flex flex-col gap-1">
                  {historicalAudits.map((audit) => {
                    const selected = audit.id === historicalExecutionId;
                    const needsNewRun = audit.disposition === 'NEW_RUN_RECOMMENDED';
                    const canRetainForReview = audit.disposition === 'RETAIN_FOR_REVIEW';
                    return (
                      <button
                        key={audit.id}
                        type="button"
                        data-audit-id={audit.id}
                        aria-current={selected ? 'true' : undefined}
                        onClick={() => {
                          streamGenerationRef.current += 1;
                          cancelStream();
                          cancelTaskStream();
                          persistAiChatSelection({
                            version: 1,
                            projectId: selectedProjectId,
                            kind: 'historical-audit',
                            executionId: audit.id,
                            ...(audit.sessionId ? { sessionId: audit.sessionId } : {}),
                          });
                          setHistoricalExecutionId(audit.id);
                           const sameOpenAudit = (
                             historicalExecutionId === audit.id
                             && sessionId === audit.sessionId
                           );
                           const cachedLinkedMessages = audit.sessionId
                             ? qc.getQueryData<ChatMessage[]>(['ai-messages', audit.sessionId])
                             : undefined;
                           setLocalMessages(
                             sameOpenAudit && cachedLinkedMessages && cachedLinkedMessages.length > 0
                               ? cachedLinkedMessages
                               : [],
                           );
                          setPendingChanges([]);
                          setProposalId(undefined);
                          setProposalRequiresApproval(false);
                          setProposalRevision(undefined);
                          setVerificationResults({});
                          setAuditPreview(null);
                          setAuditPreviewError(null);
                          setActiveExecution({
                            id: audit.id,
                            projectId: audit.projectId,
                            ...(audit.sessionId ? { sessionId: audit.sessionId } : {}),
                            message: audit.objective,
                             proofRequired: audit.proofRequired,
                             ...(audit.terminalProjection ? { terminalProjection: audit.terminalProjection } : {}),
                          });
                           // Selecting an audit can target the session that is
                           // already open. Clear the transient view above, but
                           // explicitly rehydrate the linked messages so a
                           // cached query result cannot leave the proof panel
                           // without its retained conversation evidence.
                           if (audit.sessionId) {
                             void qc.invalidateQueries({
                               queryKey: ['ai-messages', audit.sessionId],
                             });
                             void qc.refetchQueries({
                               queryKey: ['ai-messages', audit.sessionId],
                               type: 'active',
                             });
                           }
                          setAgentStage('Historical audit selected — retained proof is available to review.');
                        }}
                        className={`w-full rounded px-2 py-2 text-left transition-colors ${
                          selected
                            ? 'bg-primary/10 text-primary'
                            : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                        }`}
                         aria-label={`مراجعة سجل التدقيق: ${audit.objective}`}
                      >
                        <span className="flex items-start gap-1.5">
                          <FileSearch className="mt-0.5 h-3 w-3 shrink-0" />
                          <span className="min-w-0 flex-1">
                             <span className="block truncate text-xs"><bdi dir="auto">{audit.objective}</bdi></span>
                            <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                              <span className={`rounded border px-1 py-0.5 ${
                                audit.status === 'cancelled'
                                  ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                                   : audit.status === 'failed'
                                     ? 'border-border bg-secondary text-muted-foreground'
                                     : audit.status === 'paused'
                                       ? 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300'
                                       : 'border-border bg-secondary text-muted-foreground'
                              }`}>
                                 {historicalAuditStatusLabel(audit.status)}
                              </span>
                              <span className={`rounded border px-1 py-0.5 ${
                                needsNewRun
                                  ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                                   : canRetainForReview
                                     ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                                     : 'border-border bg-secondary text-muted-foreground'
                              }`}>
                                 {historicalAuditDispositionLabel(audit.disposition)}
                              </span>
                              <time dateTime={audit.updatedAt}>
                                {new Date(audit.updatedAt).toLocaleDateString()}
                              </time>
                            </span>
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
                </div>
              </div>
            )}
            </div>
          </div>

          {/* OpenRouter is the sole enabled route; other saved keys remain deletable but inactive. */}
          <div className="provider-key-cards min-h-0 shrink-0 border-t border-border pt-2">
            <button
              type="button"
              aria-label="إعدادات المساعد والتشخيص"
              aria-expanded={providerSettingsOpen}
              aria-controls="ai-provider-settings-content"
              onClick={() => setProviderSettingsOpen((open) => !open)}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left transition-colors hover:bg-secondary/70"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-medium text-foreground">إعدادات المساعد والتشخيص</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">مسار OpenRouter المجاني والمفاتيح المحفوظة وجودة النماذج</span>
              </span>
              <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${providerSettingsOpen ? 'rotate-90' : ''}`} />
            </button>
            <div
              id="ai-provider-settings-content"
              hidden={!providerSettingsOpen}
              className="min-h-0 md:max-h-[45vh] md:overflow-y-auto"
            >
              <ModelContractQualityCard
                usage={metricsData?.usage}
                projectLabel={projects.find((project) => project.id === selectedProjectId)?.name ?? (selectedProjectId || 'جميع المشاريع')}
                provider={metricsProvider}
                days={metricsWindowDays}
                isLoading={metricsLoading}
                isFetching={metricsFetching}
                isError={metricsError}
                onProviderChange={setMetricsProvider}
                onDaysChange={setMetricsWindowDays}
                onRetry={() => void refetchMetrics()}
                onExport={() => void exportQualityReport()}
                isExporting={qualityExportPending}
              />
              <OpenRouterKeyCard runtimeMetric={metricsMap.get('openrouter')} />
              <GeminiKeyCard disabled runtimeMetric={metricsMap.get('gemini')} />
              <DeepSeekKeyCard disabled runtimeMetric={metricsMap.get('deepseek')} />
              <GroqKeyCard disabled runtimeMetric={metricsMap.get('groq')} />
            </div>
          </div>
        </div>
      </div>

      {/* Main chat area */}
      <div className="flex min-w-0 max-w-full flex-1 flex-col overflow-hidden">
        {/* Header */}
        <div className="chat-header flex h-12 min-w-0 max-w-full shrink-0 items-center gap-2 overflow-hidden border-b border-border px-3 sm:px-4">
          <Button
            ref={sessionsToggleRef}
            size="icon"
            variant="ghost"
            className={`h-8 w-8 shrink-0 ${sidebarOpen ? 'hidden md:inline-flex' : 'inline-flex'}`}
            onClick={() => setSidebarOpen((open) => !open)}
            title={sidebarOpen ? 'إغلاق المحادثات' : 'فتح المحادثات'}
            aria-label={sidebarOpen ? 'إغلاق المحادثات' : 'فتح المحادثات'}
            aria-expanded={sidebarOpen}
            aria-controls="ai-sessions-drawer"
          >
            {sidebarOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </Button>
          <Bot className="h-4 w-4 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-medium sm:text-sm">EngineeringOS AI</div>
            <div className="truncate text-[10px] text-muted-foreground sm:text-xs" aria-live="polite"
              data-testid="text-chat-current-context">
              <span data-testid="text-chat-current-project">{projectName ?? 'No project selected'}</span>
              <span aria-hidden="true"> · </span>
              <span data-testid="text-chat-current-session">{sessionName}</span>
            </div>
          </div>
          <AssistantScopeSwitch
            currentScope="project"
            generalHref={generalScopeHref}
            onSwitchToGeneral={handleSwitchToGeneral}
            compact
          />
          <Badge variant="outline" className="hidden max-w-[35%] truncate text-[10px] font-mono sm:inline-flex">
            {activeProvider?.provider === 'deepseek'
              ? 'DeepSeek V3'
              : activeProvider?.provider === 'openrouter'
                ? 'OpenRouter'
                : activeProvider?.provider === 'gemini'
                  ? 'Gemini 2.5 Flash'
                  : 'Groq'}
          </Badge>
        </div>

        {/* Messages */}
        <ScrollArea className="min-h-0 min-w-0 flex-1 px-3 py-3 sm:px-4 sm:py-4">
          {workspaceMissionId && (
            <div
              data-testid="mission-agent-action-card"
              className="mx-auto mb-4 w-full max-w-3xl rounded-lg border border-cyan-400/20 bg-cyan-950/20 p-3"
            >
              {missionAgentProjectionQuery.isLoading ? (
                <p className="text-xs text-muted-foreground" role="status">جارٍ تحميل قرار المهمة الحالي…</p>
              ) : missionAgentProjectionQuery.isError ? (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-amber-200">تعذر تحميل قرار المهمة؛ لم يُرسل أي إجراء.</p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-[11px]"
                    onClick={() => void missionAgentProjectionQuery.refetch()}
                  >
                    إعادة التحميل
                  </Button>
                </div>
              ) : routeMissionAgent ? (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-cyan-200">مساحة عمل المهمة</p>
                      <p dir="auto" className="mt-1 truncate text-xs text-slate-100">
                        {routeMissionProjection?.mission.title}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {routeMissionPhaseLabel ? (
                        <span
                          data-testid="mission-agent-state"
                          className="inline-flex h-7 items-center rounded-md border border-cyan-400/30 px-2 text-[11px] text-cyan-100"
                        >
                          {routeMissionPhaseLabel}
                        </span>
                      ) : null}
                      {routeMissionAgent.nextAction.kind !== 'NONE' ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8 border-cyan-400/30 px-2.5 text-[11px] text-cyan-100"
                          disabled={missionAgentActionPending}
                          data-testid={`button-chat-mission-action-${routeMissionAgent.nextAction.kind.toLowerCase()}`}
                          onClick={() => void performRouteMissionAction()}
                        >
                          {missionAgentActionPending
                            ? <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                            : routeMissionAgent.nextAction.kind === 'RETRY'
                              ? <RotateCcw className="mr-1 h-3 w-3" />
                              : <ArrowUpRight className="mr-1 h-3 w-3" />}
                          {routeMissionAgent.nextAction.kind === 'START'
                            ? 'بدء المهمة'
                            : routeMissionAgent.nextAction.kind === 'AUTO_CONTINUE'
                              ? 'متابعة التنفيذ'
                              : routeMissionAgent.nextAction.kind === 'RESUME'
                                ? 'استئناف التنفيذ'
                                : routeMissionAgent.nextAction.kind === 'RETRY'
                                  ? 'إعادة المحاولة'
                                  : routeMissionAgent.nextAction.kind === 'APPROVE'
                                    ? 'اعتماد القرار'
                                    : routeMissionAgent.nextAction.kind === 'REPLAN'
                                      ? 'إنشاء خطة جديدة'
                                      : routeMissionAgent.nextAction.kind === 'REVIEW'
                                        ? 'تسجيل المراجعة'
                                        : 'تنفيذ الإجراء'}
                        </Button>
                      ) : null}
                      {routeMissionAgent.availableCommands.some((item) => item.kind === 'STOP') ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8 border-rose-400/30 px-2.5 text-[11px] text-rose-100"
                          disabled={missionAgentActionPending}
                          data-testid="button-chat-mission-action-stop"
                          onClick={() => void performRouteMissionAction('STOP')}
                        >
                          <XCircle className="mr-1 h-3 w-3" />
                          إيقاف التنفيذ
                        </Button>
                      ) : null}
                      <Link
                        href={`/missions?${new URLSearchParams({
                          projectId: selectedProjectId,
                          missionId: workspaceMissionId,
                        }).toString()}`}
                        className="inline-flex h-8 items-center rounded-md border border-border px-2.5 text-[11px] text-muted-foreground hover:text-foreground"
                      >
                        فتح المهمة
                      </Link>
                    </div>
                  </div>
                  {routeMissionWorkspace ? (
                    <div className="mt-3 space-y-3 border-t border-cyan-400/10 pt-3">
                      {routeMissionWorkspace.objective.intent ? (
                        <p
                          data-testid="mission-agent-objective"
                          dir="auto"
                          className="text-xs leading-5 text-slate-200"
                        >
                          {routeMissionWorkspace.objective.intent}
                        </p>
                      ) : null}
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <div data-testid="mission-agent-progress" className="rounded-md bg-slate-950/35 p-2">
                          <p className="text-[10px] text-muted-foreground">الأهداف ذات الأدلة المقبولة</p>
                          <p className="mt-1 text-xs font-medium text-slate-100">
                            {routeMissionWorkspace.progress.verifiedGoals} من {routeMissionWorkspace.progress.totalGoals}
                          </p>
                        </div>
                        <div data-testid="mission-agent-evidence" className="rounded-md bg-slate-950/35 p-2">
                          <p className="text-[10px] text-muted-foreground">التحقق</p>
                          <p className="mt-1 text-xs font-medium text-slate-100">{routeMissionEvidenceLabel}</p>
                        </div>
                        <div data-testid="mission-agent-delivery" className="rounded-md bg-slate-950/35 p-2">
                          <p className="text-[10px] text-muted-foreground">التسليم</p>
                          <p className="mt-1 text-xs font-medium text-slate-100">{routeMissionDeliveryLabel}</p>
                        </div>
                        <div data-testid="mission-agent-intervention" className="rounded-md bg-slate-950/35 p-2">
                          <p className="text-[10px] text-muted-foreground">حالة التدخل</p>
                          <p className="mt-1 text-xs font-medium text-slate-100">{routeMissionInterventionLabel}</p>
                        </div>
                      </div>
                      {routeMissionWorkspace.currentGoal?.title ? (
                        <p data-testid="mission-agent-current-goal" dir="auto" className="text-[11px] text-slate-300">
                          الهدف الحالي: {routeMissionWorkspace.currentGoal.title}
                        </p>
                      ) : null}
                      {routeMissionLastActivity && Number.isFinite(routeMissionLastActivity.getTime()) ? (
                        <p data-testid="mission-agent-last-activity" className="text-[10px] text-muted-foreground">
                          آخر تحديث: {routeMissionLastActivity.toLocaleString('ar-EG')}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                  {missionAgentActionNotice ? (
                    <p className="mt-2 text-xs text-emerald-200" role="status">{missionAgentActionNotice}</p>
                  ) : null}
                  {missionAgentActionError ? (
                    <p className="mt-2 text-xs text-destructive" role="alert">{missionAgentActionError}</p>
                  ) : null}
                  {resumeRecoveryError ? (
                    <p className="mt-2 text-xs text-destructive" role="alert">{resumeRecoveryError}</p>
                  ) : null}
                </>
              ) : (
                <p className="text-xs text-amber-200" role="status">تعذر مطابقة قرار المهمة مع المحادثة الحالية؛ لن يُرسل إجراء.</p>
              )}
            </div>
          )}
          {routeSessionUnavailable && (
            <div
              role="status"
              data-testid="notice-chat-route-unavailable"
              className="mx-auto mb-4 flex max-w-3xl flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200"
            >
              <span>The linked AI conversation is unavailable in this project. Choose another session to continue.</span>
              {!sidebarOpen && sessions.length > 0 ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 shrink-0 px-2 text-[11px]"
                  data-testid="button-open-chat-history"
                  onClick={() => setSidebarOpen(true)}
                >
                  Choose another session
                </Button>
              ) : null}
            </div>
          )}
          {visibleRouteMissionRestoration && (
            <div
              role="alert"
              data-testid="notice-chat-route-mission-unavailable"
              className="mx-auto mb-4 flex max-w-3xl items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200"
            >
              <span>
                {visibleRouteMissionRestoration.kind === 'not-linked'
                  ? 'This Mission is not linked to the requested conversation.'
                  : visibleRouteMissionRestoration.kind === 'missions-unavailable'
                    ? 'The requested Mission could not be checked. Your saved selection was not changed.'
                    : 'Mission selection failed. Your saved selection was not changed.'}
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 shrink-0 px-2 text-[11px]"
                data-testid="button-retry-chat-route-mission"
                onClick={() => void retryRouteMissionRestoration()}
              >
                Retry restore
              </Button>
            </div>
          )}
          {routeSourceMessageUnavailable && (
            <div
              role="status"
              data-testid="notice-chat-source-message-unavailable"
              className="mx-auto mb-4 flex max-w-3xl flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200"
            >
              <span>The conversation opened, but its original message is unavailable.</span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 shrink-0 px-2 text-[11px]"
                data-testid="button-open-latest-chat"
                onClick={() => {
                  if (!sessionId) return;
                  const params = new URLSearchParams({
                    projectId: selectedProjectId,
                    sessionId,
                  });
                  if (routeMissionId) params.set('missionId', routeMissionId);
                  setLocation(`/ai?${params.toString()}`);
                }}
              >
                Open latest messages
              </Button>
            </div>
          )}
          {historicalReportError && (
            <div role="alert" className="mb-4 flex min-w-0 items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              <span className="min-w-0 flex-1">{historicalReportError}</span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 shrink-0 px-2 text-[11px]"
                onClick={() => {
                  if (sessionId) {
                    void qc.invalidateQueries({ queryKey: ['ai-messages', sessionId] });
                  }
                }}
              >
                Retry
              </Button>
            </div>
          )}
          {messagesError && sessionId && (
            <div role="alert" data-testid="alert-chat-messages-unavailable"
              className="mb-4 flex min-w-0 items-center justify-between gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              <span>Conversation messages could not be loaded. Retained execution proof, if any, remains available.</span>
              <Button type="button" size="sm" variant="outline" className="h-7 shrink-0 px-2 text-[11px]"
                data-testid="button-retry-chat-messages"
                onClick={() => void qc.invalidateQueries({ queryKey: ['ai-messages', sessionId] })}>
                Retry messages
              </Button>
            </div>
          )}
          {workSummary && (
            <section className="mx-auto mb-3 w-full max-w-3xl rounded-xl border border-primary/30 bg-primary/5 px-3 py-3"
              aria-label="Current work and next step" data-testid="current-work-summary">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-primary">Current work</div>
              <h2 className="mt-1 text-sm font-semibold text-foreground" data-testid="text-current-work-state">
                {workSummary.title}
              </h2>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{workSummary.reason}</p>
              <div className="mt-2 border-t border-border/50 pt-2 text-xs text-foreground" data-testid="text-current-work-next-step">
                <span className="font-semibold">Next step:</span> {workSummary.nextStep}
              </div>
              {workSummaryTargetId && (
                <div className="mt-2">
                  <button
                    type="button"
                    onClick={() => document.getElementById(workSummaryTargetId)?.focus()}
                    aria-label={`Go to next step: ${workSummary.nextStep}`}
                    data-testid="button-current-work-next-step"
                    className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-primary/40 bg-background/40 px-2.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Go to next step
                    <ChevronDown className="h-3 w-3" aria-hidden="true" />
                  </button>
                </div>
              )}
              {selectedProjectId && (
                <nav className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/50 pt-2"
                  aria-label="Follow-up destinations" data-testid="nav-current-work-destinations">
                  {confirmedExecutionDestinationId && (
                    <Link href={`/flight-deck?executionId=${encodeURIComponent(confirmedExecutionDestinationId)}`}
                      data-testid="link-current-work-flight-deck"
                      className="inline-flex items-center gap-1 rounded-md border border-primary/30 px-2 py-1 text-xs text-primary hover:bg-primary/10">
                      Flight Deck · execution proof <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
                    </Link>
                  )}
                  <Link
                    href={`/mission-control?projectId=${encodeURIComponent(selectedProjectId)}${confirmedExecutionDestinationId
                      ? `&executionId=${encodeURIComponent(confirmedExecutionDestinationId)}`
                      : ''}`}
                    data-testid="link-current-work-mission-control"
                    className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-secondary">
                    Mission Control · project operations <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
                  </Link>
                  <p className="basis-full text-[11px] leading-4 text-muted-foreground">
                    Flight Deck shows this execution's proof when confirmed. Mission Control shows project operations; opening it does not create a Mission.
                  </p>
                </nav>
              )}
              {pendingChanges.length > 0 && (
                <p className="mt-2 text-xs font-medium text-amber-200" data-testid="status-current-work-approval">
                  Candidate changes still require validation and any applicable approval before they can be applied.
                </p>
              )}
            </section>
          )}
          {selectedProjectId && (
            <div
              className="mb-3 rounded-lg border border-border/60 bg-card/30"
              role="region"
              aria-label="Automatic delivery promotion policy"
            >
              <button
                type="button"
                aria-expanded={deliveryPolicyExpanded}
                aria-controls="delivery-promotion-details"
                onClick={() => setDeliveryPolicyExpanded((expanded) => !expanded)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-secondary/40"
              >
                {deliveryPolicy?.automaticPromotionEnabled
                  ? <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-300" />
                  : <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-amber-300" />}
                <span className="text-xs font-medium text-foreground">Automatic delivery promotion</span>
                <Badge variant={deliveryPolicy?.automaticPromotionEnabled ? 'default' : 'outline'} className="ml-auto text-[10px]">
                  {deliveryPolicy?.automaticPromotionEnabled ? 'Enabled' : 'Manual review'}
                </Badge>
                <ChevronRight className={`h-3 w-3 shrink-0 text-muted-foreground transition-transform ${deliveryPolicyExpanded ? 'rotate-90' : ''}`} />
              </button>
              <div
                id="delivery-promotion-details"
                hidden={!deliveryPolicyExpanded}
                className="flex flex-wrap items-center justify-between gap-3 border-t border-border/50 px-3 py-2.5"
              >
                <p className="max-w-2xl text-[11px] text-muted-foreground">
                  When enabled, only small, server-validated documentation or test candidates
                  can use the existing guarded apply path automatically. Source, config,
                  credential, deployment, and failed candidates remain blocked or review-required.
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant={deliveryPolicy?.automaticPromotionEnabled ? 'outline' : 'default'}
                  className="h-8 shrink-0 px-2.5 text-[11px]"
                  disabled={updateDeliveryPolicyMutation.isPending || !deliveryPolicy}
                  onClick={() => updateDeliveryPolicyMutation.mutate({
                    data: {
                      projectId: selectedProjectId,
                      automaticPromotionEnabled: !deliveryPolicy?.automaticPromotionEnabled,
                    },
                  })}
                >
                  {updateDeliveryPolicyMutation.isPending
                    ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                    : null}
                  {deliveryPolicy?.automaticPromotionEnabled ? 'Disable' : 'Enable'}
                </Button>
              </div>
            </div>
          )}
          {(recoverableDeliveries?.operations?.length ?? 0) > 0 && (
            <div id="region-recoverable-deliveries" tabIndex={-1}
              className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3" role="region" aria-label="عمليات تسليم قابلة للاسترداد">
              <div className="flex items-center gap-2 text-xs font-semibold text-amber-100">
                <RotateCcw className="h-3.5 w-3.5" />
                مساحات تسليم محفوظة تحتاج إلى متابعة
              </div>
               <p className="mt-1 text-[11px] leading-4 text-amber-100/80">
                 هذه مساحات تغييرات محفوظة للتسليم، وليست تنفيذات ذكاء اصطناعي متوقفة. استئناف التحقق يعيد تشغيل الفحوص المسجلة؛
                 وإذا فعّل المالك سياسة التطبيق التلقائي، فقد يُطبّق بعدها مرشح منخفض المخاطر يجتاز الفحوص.
               </p>
              <div className="mt-2 space-y-2">
                  {recoverableDeliveries!.operations.map((delivery) => (
                    <div
                      key={delivery.proposalId}
                      className="rounded-md border border-amber-500/20 bg-background/30 p-2.5 text-[11px]"
                      data-operation-id={delivery.operationId}
                      data-recovery-state={delivery.recoveryState}
                    >
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <Badge variant={delivery.recoveryState === 'discarded' ? 'secondary' : delivery.recoveryState === 'missing_workspace' ? 'destructive' : 'outline'} className="text-[10px]">
                        {delivery.recoveryState === 'recoverable'
                          ? 'قابلة للاسترداد'
                          : delivery.recoveryState === 'missing_workspace'
                            ? 'المساحة غير متاحة'
                            : 'أُزيلت المساحة مسبقًا'}
                      </Badge>
                      <span className="text-muted-foreground">{delivery.changeCount} تغيير</span>
                      <span className="text-muted-foreground">{new Date(delivery.createdAt).toLocaleString()}</span>
                    </div>
                    <div dir="auto" className="mt-1 break-words text-foreground/90">{delivery.operatorExplanation}</div>
                    {delivery.conflictReason && delivery.recoveryState !== 'discarded' && (
                      <div className="mt-1 break-words text-red-200">السبب المسجل: <bdi dir="auto">{delivery.conflictReason}</bdi></div>
                    )}
                    {delivery.promotionDecision && (
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <Badge
                          variant={delivery.promotionDecision === 'AUTO_PROMOTE_ELIGIBLE'
                            ? 'default'
                            : delivery.promotionDecision === 'BLOCKED'
                              ? 'destructive'
                              : 'outline'}
                          className="text-[10px]"
                        >
                          {delivery.promotionDecision === 'AUTO_PROMOTE_ELIGIBLE'
                            ? 'مؤهل للتطبيق التلقائي بحسب السياسة'
                            : delivery.promotionDecision === 'BLOCKED'
                              ? 'التطبيق التلقائي محجوب'
                              : 'تلزم المراجعة'}
                        </Badge>
                        {delivery.promotionReasons?.length ? (
                          <span className="text-muted-foreground">
                            {delivery.promotionReasons.join(' · ')}
                          </span>
                        ) : null}
                      </div>
                    )}
                    {delivery.validationEvidence && delivery.validationEvidence.length > 0 && (
                      <CandidateValidationProof
                        evidence={delivery.validationEvidence}
                        operationId={delivery.operationId}
                        projectRevision={delivery.projectRevision}
                        changeSetHash={delivery.changeSetHash}
                        lifecycle={delivery.lifecycle}
                      />
                    )}
                    {(() => {
                      const blockedCheck = delivery.validationEvidence?.find((check) => check.reasonCode);
                      const explanation = browserValidationBlockExplanation(blockedCheck?.reasonCode);
                      return explanation ? (
                        <div className="mt-1 rounded border border-amber-500/25 bg-amber-500/10 px-2 py-1.5 text-amber-100" role="note" aria-label="Safe browser validation guidance">
                          <div className="font-medium">{explanation.title}</div>
                          <div className="mt-0.5 text-amber-100/80">{explanation.action}</div>
                        </div>
                      ) : null;
                    })()}
                    <div className="mt-1 break-words text-muted-foreground">{delivery.nextAction}</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-[11px]"
                        disabled={deliveryRecoveryPending !== null || delivery.recoveryState !== 'recoverable'}
                        onClick={() => void recoverDelivery(delivery, 'resume-validation')}
                      >
                        {deliveryRecoveryPending === delivery.proposalId ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RotateCcw className="mr-1 h-3 w-3" />}
                        استئناف فحوص التسليم
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-[11px] text-red-200 hover:text-red-100"
                        disabled={deliveryRecoveryPending !== null || delivery.recoveryState !== 'recoverable'}
                        onClick={() => setDeliveryToDiscard({ projectId: selectedProjectId, delivery })}
                      >
                        <Trash2 className="mr-1 h-3 w-3" />
                        إزالة مساحة التسليم المؤقتة
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {selectedProjectId && sessionId && (
            <div className="chat-content mx-auto min-w-0 w-full max-w-3xl">
              <ChatSessionMissionHandoffs
                key={sessionId}
                projectId={selectedProjectId}
                sessionId={sessionId}
                userId={user?.id ?? null}
                missions={currentSessionMissions?.missions ?? []}
                activeMissionId={currentSessionMissions?.activeMissionId ?? null}
                isPending={currentSessionMissionsPending}
                isError={chatSessionMissionsError}
                isSelectingMission={activeMissionSelectionMutation.isPending}
                onRetry={() => void refetchChatSessionMissions()}
                onSelectMission={(missionId) => selectSessionMission(sessionId, missionId)}
              />
            </div>
          )}
          {isEmpty && !showExecutionProofInEmptyState ? (
            <div className="flex h-full min-h-[300px] items-center justify-center px-3 py-8">
              <div className="w-full max-w-2xl space-y-6">
                <div className="flex items-start gap-4">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-primary/25 bg-primary/10 shadow-sm">
                    <Bot className="h-5 w-5 text-primary" />
                  </div>
                  <div className="min-w-0 pt-0.5">
                    <p className="font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-primary">
                      EngineeringOS · {projectName ?? 'Project assistant'}
                    </p>
                    <h2 className="mt-2 text-xl font-semibold tracking-tight sm:text-2xl" data-testid="text-chat-empty-title">
                      {emptyContext.title}
                    </h2>
                    <p className={`mt-1.5 max-w-lg text-sm leading-6 ${projectLoadFailure ? 'text-destructive' : 'text-muted-foreground'}`}>
                      {emptyContext.subtitle}
                    </p>
                  </div>
                </div>

                {projectLoadFailure && (
                  <Button type="button" variant="outline" size="sm" data-testid="button-retry-projects"
                    onClick={() => void qc.invalidateQueries({ queryKey: getListProjectsQueryKey() })}>
                    Retry loading projects
                  </Button>
                )}
                {!projectLoadFailure && !selectedProjectId && !projectsLoading && isLoaded && (
                  <Link href="/projects" data-testid="link-chat-projects"
                    className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-sm font-medium text-primary hover:bg-primary/15">
                    عرض المشاريع <ArrowUpRight className="h-4 w-4" />
                  </Link>
                )}
                {selectedProjectId && sessionsError && (
                  <Button type="button" variant="outline" size="sm" data-testid="button-retry-session-list"
                    onClick={() => void qc.invalidateQueries({ queryKey: ['ai-sessions', selectedProjectId] })}>
                    إعادة تحميل قائمة المحادثات
                  </Button>
                )}
                {showStartingPoints && (
                  <>
                <div dir="rtl" lang="ar" aria-label="نقاط بداية شائعة" className="grid gap-3 sm:grid-cols-2">
                  {COMMON_AI_ACTIONS.map((action) => (
                    <button
                      key={action.id}
                      type="button"
                      aria-label={action.label}
                      aria-describedby={`ai-chat-action-${action.id}-description`}
                      onClick={() => handleQuickAction(action)}
                      disabled={!isLoaded || projectsLoading || !selectedProjectId || (action.id === 'analyze' && isTaskSending) || (action.id === 'review' && isTaskSending)}
                      className="group relative flex min-h-28 w-full min-w-0 items-start gap-3 rounded-xl border border-border/80 bg-card/70 p-4 text-start text-xs shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/45 hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:border-border/80"
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/15 bg-primary/10 text-primary transition-colors group-hover:bg-primary/15">
                        <action.icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1 pt-0.5">
                        <span className="block text-sm font-medium text-foreground">{action.label}</span>
                        <span id={`ai-chat-action-${action.id}-description`} className="mt-1 block text-xs leading-5 text-muted-foreground">
                          {action.description}
                        </span>
                      </span>
                      <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground/60 transition-all group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-primary" />
                    </button>
                  ))}
                </div>

                {ADDITIONAL_AI_ACTIONS.length > 0 && (
                  <div dir="rtl" lang="ar" className="border-t border-border/70 pt-3">
                    <button
                      type="button"
                      aria-label="إجراءات إضافية"
                      aria-expanded={moreActionsExpanded}
                      aria-controls="ai-additional-actions"
                      onClick={() => setMoreActionsExpanded((expanded) => !expanded)}
                      className="flex w-full items-center gap-2 rounded-md px-1 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="flex-1 font-medium">إجراءات إضافية</span>
                      <span aria-hidden="true" className="rounded-full border border-border px-1.5 py-0.5 font-mono text-[10px]">
                        {ADDITIONAL_AI_ACTIONS.length}
                      </span>
                      <ChevronDown className={`h-3.5 w-3.5 transition-transform ${moreActionsExpanded ? 'rotate-180' : ''}`} />
                    </button>
                    <div id="ai-additional-actions" hidden={!moreActionsExpanded} className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {ADDITIONAL_AI_ACTIONS.map((action) => (
                        <button
                          key={action.id}
                          type="button"
                          aria-label={action.label}
                          aria-describedby={`ai-chat-action-${action.id}-description`}
                          onClick={() => handleQuickAction(action)}
                          disabled={!isLoaded || projectsLoading || !selectedProjectId}
                          className="flex min-w-0 items-start gap-2 rounded-lg border border-border/70 bg-secondary/35 px-3 py-2.5 text-start text-xs text-muted-foreground transition-colors hover:border-primary/35 hover:bg-secondary/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <action.icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                          <span className="min-w-0">
                            <span className="block font-medium text-foreground">{action.label}</span>
                            <span id={`ai-chat-action-${action.id}-description`} className="mt-0.5 block text-[10px] leading-4 text-muted-foreground">
                              {action.description}
                            </span>
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="chat-content mx-auto min-w-0 w-full max-w-3xl">
               {showExecutionProof && (
                 <AgentExecutionProofPanel
                    execution={displayExecutionStatus}
                    recoveryView={recoveryView ?? undefined}
                   terminalProjection={activeExecution?.terminalProjection}
                   executionId={activeExecution?.id}
                    executionNodes={executionNodes}
                   busy={isAgentBusy}
                   stage={agentStage}
                   elapsedSeconds={agentElapsedSeconds}
                   steps={agentSteps}
                   modelHistory={agentModelHistory}
                   pendingChanges={pendingChanges}
                   commitReadyPaths={commitReadyPaths}
                   pushReady={pushReady}
                   evidenceIntegrity={liveEvidenceIntegrity}
                     persistedEvidenceFiles={persistedCompletedReadFiles(scopedExecutionStatus)}
                   isFixtureLocal={liveFixtureLocal}
                   verdictScope={liveVerdictScope}
                   onCancel={cancelActiveExecution}
                    onProjectionAction={historicalExecutionId ? undefined : handleProjectionAction}
                   onExport={exportExecutionAudit}
                   onPreview={previewExecutionAudit}
                   onRetryPreview={previewExecutionAudit}
                   exportPending={auditExportPending}
                   previewPending={auditPreviewPending}
                   auditPreview={auditPreview}
                   auditPreviewError={auditPreviewError}
                    forensicVerdict={latestForensicVerdict}
                   onClosePreview={() => {
                     setAuditPreview(null);
                     setAuditPreviewError(null);
                   }}
                   controlPending={executionControlPending}
                 />
               )}
                {isEmpty && showExecutionProofInEmptyState && (
                  <div
                    className="mx-auto mb-4 w-full max-w-3xl rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-xs text-muted-foreground"
                    role="status"
                  >
                    {messagesError
                      ? 'Conversation messages could not be loaded. The saved execution proof remains available.'
                      : conversationLoading
                      ? 'The saved execution proof is available while conversation messages load.'
                      : historicalExecutionId
                        ? 'The historical audit has retained proof, but no conversation messages were recorded for its linked session.'
                        : 'The saved execution has retained proof, but no conversation messages were recorded for this session.'}
                  </div>
                )}
               {operationMode === 'DELIVERY' && operationId && (
                 <OperationTracePanel
                   operationId={operationId}
                   events={operationEvents}
                   isLoading={operationEventsLoading}
                 />
               )}
              {messages.map((msg) => (
                <MessageBubble
                  key={msg.id}
                  msg={msg}
                  projectId={selectedProjectId}
                   sessionId={sessionId}
                   proposalId={proposalId}
                  onPlanDecision={handlePlanDecision}
                  planDecisionPending={planDecisionPending === msg.id}
                  onPlanBuild={handlePlanBuild}
                  planBuildPending={planBuildPending === msg.id}
                  onRegenerateReport={(messageId) => regenerateReportMutation.mutate(messageId)}
                  reportRegenerationPending={regenerateReportMutation.isPending && regenerateReportMutation.variables === msg.id}
                  onRetryStructuredTask={retryStructuredTask}
                  retryPending={structuredRetryMessageId === msg.id}
                  onRetryProjectQuery={retryProjectQuery}
                  projectQueryRetryPending={projectQueryRetryMessageId === msg.id}
                   onMissionHandoff={handleMissionHandoff}
                   missionHandoffPending={missionHandoffPending === msg.id}
                    onMissionHandoffComplete={(mission) =>
                      handleMissionHandoffComplete(mission, selectedProjectId, sessionId)
                    }
                  onExplainFallback={explainFallbackForMessage}
                  fallbackDiagnostic={
                    fallbackDiagnosticMutation.data?.messageId === msg.id
                      ? fallbackDiagnosticMutation.data
                      : undefined
                  }
                  fallbackDiagnosticPending={
                    fallbackDiagnosticMutation.isPending
                    && fallbackDiagnosticMutation.variables?.data.messageId === msg.id
                  }
                  fallbackDiagnosticError={
                    fallbackDiagnosticMutation.isError
                    && fallbackDiagnosticMutation.variables?.data.messageId === msg.id
                  }
                />
              ))}
               {capabilityGap && <CapabilityGapNotice gap={capabilityGap} projectId={selectedProjectId} />}
               <RecipeProgressPanel nodes={recipeNodes} />
               {(isAgentBusy || liveBehaviorProgress) ? (
                /* Single unified live bubble — steps always visible above streaming text */
                 <div
                   id="group-assistant-response-progress"
                   tabIndex={-1}
                   role="group"
                   aria-label="Assistant response in progress"
                   className="chat-message flex min-w-0 max-w-full gap-3 mb-6"
                 >
                  <div className="w-8 h-8 rounded-full bg-secondary border border-border flex items-center justify-center shrink-0 mt-0.5">
                    <Bot className="w-4 h-4 text-primary" />
                  </div>
                  <div className="chat-message-content min-w-0 max-w-[calc(100%-2.75rem)] rounded-xl rounded-tl-sm border border-border bg-secondary px-3 py-3 flex flex-col gap-2 sm:max-w-[75%] sm:px-4">
                     <div aria-hidden="true" className="flex items-center justify-between gap-3 border-b border-border/50 pb-2">
                       <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                         EngineeringOS AI
                       </span>
                       <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-primary/25 bg-primary/5 px-2 py-1 text-[10px] font-medium text-primary">
                         <span className="relative flex h-1.5 w-1.5">
                           <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/70" />
                           <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
                         </span>
                         In progress
                       </span>
                     </div>
                      <LiveAgentActivity
                       stage={agentStage}
                       steps={agentSteps}
                       activityEvents={agentActivityEvents}
                       iter={agentIter}
                       model={agentModel}
                       streamingContent={streamingContent}
                       busy={isAgentBusy}
                       elapsedSeconds={agentElapsedSeconds}
                       onCancel={isSending ? stopActiveRequest : undefined}
                       modelHistory={agentModelHistory}
                       diagnostics={agentDiagnostics}
                       isFixtureLocal={liveFixtureLocal}
                       verdictScope={liveVerdictScope ?? undefined}
                        auditScopeDescription={liveAuditScopeDescription ?? undefined}
                     />
                      {liveBehaviorProgress && (
                        <BehaviorProgressCard progress={liveBehaviorProgress} />
                      )}
                     {/* NI-35: live EI-012 reconciliation indicator during the stream */}
                     {liveEvidenceIntegrity && (
                       <div className={`mt-1 flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] ${
                         liveEvidenceIntegrity.consistent
                           ? 'border-green-500/30 bg-green-500/5 text-green-200'
                           : 'border-red-500/30 bg-red-500/5 text-red-200'
                       }`}>
                         {liveEvidenceIntegrity.consistent
                           ? <ShieldCheck className="w-3 h-3 shrink-0 text-green-300" />
                           : <ShieldAlert className="w-3 h-3 shrink-0 text-red-300" />}
                         <span className="font-medium">
                           {liveEvidenceIntegrity.consistent ? 'Telemetry consistent' : 'Telemetry inconsistent'}
                         </span>
                         {liveEvidenceIntegrity.violations.length > 0 && (
                           <span className="truncate text-muted-foreground">· {liveEvidenceIntegrity.violations.length} violation{liveEvidenceIntegrity.violations.length === 1 ? '' : 's'}</span>
                         )}
                       </div>
                     )}
                     {/* Recent tool activity stays visible below the summary card. */}
                     {agentSteps.length > 0 && (
                        <div className="rounded-lg border border-border/60 bg-background/25 px-3 py-2">
                          <div aria-hidden="true" className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                            Recent activity
                          </div>
                          <div className="flex flex-col gap-1 text-xs font-mono">
                            {agentSteps.slice(-6).map((step, i) => (
                              <div key={`${step.tool}-${i}`} className="flex items-center gap-1.5 leading-5">
                                {step.done ? (
                                  <span className="text-green-400 shrink-0">✓</span>
                                ) : (
                                  <Loader2 className="h-3 w-3 animate-spin text-primary shrink-0" />
                                )}
                                <span className={step.done ? 'text-muted-foreground' : 'text-foreground'}>
                                  {liveToolLabel(step)}
                                </span>
                                {step.cached && <span className="text-[10px] text-muted-foreground/60">(cached)</span>}
                              </div>
                            ))}
                          </div>
                       </div>
                     )}
                     {streamingContent && <div className="border-t border-border/50 -mx-1" />}

                    {/* Live streaming text */}
                    {streamingContent && (
                      <div className="min-w-0 max-w-full overflow-hidden prose prose-sm prose-invert [overflow-wrap:anywhere]">
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
                              <ProjectQuerySourceHeading projectId={selectedProjectId ?? undefined}>
                                {children}
                              </ProjectQuerySourceHeading>
                            ),
                          }}
                        >
                          {streamingContent}
                        </ReactMarkdown>
                        <span className="inline-block w-0.5 h-3.5 bg-primary align-middle ml-0.5 animate-pulse" />
                      </div>
                    )}
                  </div>
                </div>
              ) : null}
              {pendingChanges.length > 0 && (
                <PendingChangesCard
                  changes={pendingChanges}
                  verificationResults={verificationResults}
                  validationEvidence={validationEvidence}
                  proposalId={proposalId}
                  operationId={operationId}
                  projectRevision={serverProposal?.baseRevision}
                  changeSetHash={serverProposal?.changeSetHash}
                  onApply={handleApplyChanges}
                  onCreateReviewBranch={handleCreateLocalReviewBranch}
                  onApproveMissionCandidate={handleApproveMissionCandidate}
                  onCreateApplyMission={handleCreateApplyMission}
                  onRebase={handleRebaseChanges}
                  onReject={handleRejectProposal}
                  isPending={applyMutation.isPending || reapprovalMutation.isPending}
                  isReviewBranchPending={localReviewBranchMutation.isPending}
                  reviewBranch={localReviewBranchQuery.data}
                  reviewBranchError={localReviewBranchQuery.isError
                    ? describeAiError(localReviewBranchQuery.error)
                    : null}
                  isReviewBranchLoading={localReviewBranchQuery.isFetching}
                  isApplyMissionPending={applyMissionPending}
                  isRebasePending={rebaseMutation.isPending}
                  approvalRequired={proposalRequiresApproval}
                  missionCandidate={serverProposal?.missionCandidate === true}
                  missionCandidateAccepted={serverProposal?.missionCandidateAccepted === true}
                  applyMissionReady={serverProposal?.applyMissionReady === true}
                  liveApplyPaused
                  lifecycle={deliveryLifecycle}
                />
              )}
              {pendingChanges.length === 0 && proposalUnavailable && (
                <div
                  id="alert-proposal-unavailable"
                  tabIndex={-1}
                  className="mx-auto mb-4 flex w-full max-w-3xl items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-200"
                  role="alert"
                >
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />
                  <div className="min-w-0">
                    <p className="font-medium text-amber-100">تحتاج التغييرات إلى مزيد من التحقق قبل المراجعة</p>
                    <p className="mt-1 break-words text-amber-200/80">{proposalUnavailable}</p>
                  </div>
                </div>
              )}
              {pendingChanges.length === 0 && validationEvidence.length > 0 && (
                <div className="mx-auto mb-4 w-full max-w-3xl overflow-hidden rounded-xl border border-border/60 bg-card/30">
                  <CandidateValidationProof
                    evidence={validationEvidence}
                    operationId={operationId}
                    projectRevision={serverProposal?.baseRevision}
                    changeSetHash={serverProposal?.changeSetHash}
                    lifecycle={deliveryLifecycle}
                  />
                </div>
              )}
              {commitReadyPaths.length > 0 && pendingChanges.length === 0 && (
                <VerifiedCommitCard
                  paths={commitReadyPaths}
                  message={commitMessage}
                  onMessageChange={setCommitMessage}
                  onCommit={handleCommitVerifiedChanges}
                  isPending={commitMutation.isPending}
                  liveApplyPaused
                />
              )}
              {pushReady && commitReadyPaths.length === 0 && pendingChanges.length === 0 && (
                <PushCommitCard
                  onPush={handlePushCommittedChanges}
                  isPending={pushMutation.isPending}
                />
              )}
              <div ref={bottomRef} />
            </div>
          )}
        </ScrollArea>

        {/* Input */}
         <div className="chat-input-bar min-w-0 shrink-0 border-t border-border bg-background/90 p-3 backdrop-blur sm:p-4">
           {activeExecution && recoveryView && activeExecutionIsProofBearing && !isAgentBusy && (
             <div className="mx-auto mb-3 flex w-full max-w-3xl flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs" role="status" data-testid="execution-recovery-banner">
              <div className="min-w-0">
                <div className="font-medium text-foreground">
                   {recoveryView.title}
                </div>
                 <div className="text-muted-foreground">
                   {recoveryView.detail}
                   {' · '}Execution {activeExecution.id.slice(0, 8)}…
                   {scopedExecutionStatus?.checkpointVersion != null
                     ? ` · checkpoint ${scopedExecutionStatus.checkpointVersion}`
                    : ''}
                </div>
              </div>
                {scopedExecutionStatus?.linkedTaskId ? (
                  <Link
                    href={`/tasks?taskId=${encodeURIComponent(scopedExecutionStatus.linkedTaskId)}`}
                    className="inline-flex shrink-0 items-center rounded-md border border-primary/30 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10"
                    aria-label="Open owning Task"
                  >
                    Open Task
                  </Link>
                ) : recoveryView.action && (
                <div className="flex shrink-0 items-center gap-2">
                  {resumeRecoveryError && (
                    <span className="max-w-40 text-right text-[10px] text-destructive">
                      {resumeRecoveryError}
                    </span>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                      onClick={() => void resumeActiveExecution(recoveryView.action ?? 'resume')}
                    disabled={resumeRecoveryPending}
                      id="button-recover-execution"
                      data-testid="button-recover-execution"
                      aria-label={resumeRecoveryError
                        ? recoveryView.action === 'retry' ? 'Retry checkpoint again' : 'Retry resume execution'
                        : recoveryView.actionLabel ?? undefined}
                  >
                  <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                    {resumeRecoveryPending ? 'Recovering…' : resumeRecoveryError
                      ? recoveryView.action === 'retry' ? 'Retry checkpoint again' : 'Retry resume execution'
                      : recoveryView.actionLabel}
                  </Button>
                </div>
              )}
            </div>
          )}
          <div className="mx-auto w-full min-w-0 max-w-3xl">
            <ProviderReadinessNotice
              activeProvider={activeProvider}
              metric={activeProviderMetric}
            />
            <GoalDraftNotice handoff={draftHandoff} />
            {scopeDraftRestored && <p role="status" data-testid="status-ai-scope-draft-restored" className="mb-2 text-xs text-primary">استعدنا النص غير المرسل لهذه المحادثة؛ لن يُرسل تلقائيًا.</p>}
            {scopeDraftStorageError && <p role="alert" data-testid="status-ai-scope-draft-storage-error" className="mb-2 text-xs text-amber-200">{scopeDraftStorageError}</p>}
            {homeGoalNeedsProjectConfirmation && (
              <div role="status" dir="rtl" data-testid="status-home-goal-project-confirmation" className="mb-2 rounded-lg border border-primary/25 bg-primary/5 p-3 text-sm">
                <p>{projectName ? `هل تقصد تنفيذ هذا الهدف في مشروع «${projectName}»؟` : 'اختر المشروع المقصود من قائمة المشاريع قبل إرسال هذا الهدف.'}</p>
                <p className="mt-1 text-xs text-muted-foreground">تأكيد المشروع لا يرسل المسودة ولا يمنح موافقة على التعديل.</p>
                {!projectsLoading && !projectsError && projects.length === 0 && draftHandoff.activeDraft && (
                  <Link className="mt-2 inline-block text-primary underline" href={`/projects?create=1&goalDraftId=${encodeURIComponent(draftHandoff.activeDraft.id)}`}>أنشئ مشروعًا مع الاحتفاظ بهذا الهدف</Link>
                )}
                {draftHandoff.activeDraft?.projectId && draftHandoff.activeDraft.projectId !== selectedProjectId && (
                  <p className="mt-1 text-xs text-amber-400">هذه المسودة مرتبطة بمشروع آخر؛ تأكيد الاختيار سينقل نطاقها إلى المشروع الظاهر.</p>
                )}
                <Button type="button" size="sm" className="mt-2" disabled={!selectedProjectId || !projectName || projectsLoading || Boolean(projectLoadFailure)}
                  data-testid="button-confirm-home-goal-project" onClick={draftHandoff.confirmProject}>
                  استخدم هذا المشروع
                </Button>
              </div>
            )}
            <div className="flex items-end gap-2 rounded-2xl border border-border/80 bg-card/70 p-2 shadow-sm transition-colors focus-within:border-primary/45 focus-within:ring-2 focus-within:ring-primary/15">
            <Textarea
              ref={textareaRef}
              data-testid="input-ai-chat-composer"
              value={input}
              onChange={(e) => {
                const nextInput = e.target.value;
                draftHandoff.edit(nextInput);
                setScopeDraftRestored(false);
                setScopeDraftStorageError('');
                if (!draftHandoff.activeDraft && user?.id && selectedProjectId) {
                  const contextId = getAssistantComposerContextId('project', selectedProjectId, sessionId);
                  if (contextId && !saveAssistantComposerDraft(user.id, 'project', contextId, nextInput)) {
                    setScopeDraftStorageError('تعذر حفظ النص غير المرسل لهذا التبويب؛ انسخه قبل تغيير المساحة.');
                  }
                }
              }}
              onKeyDown={handleKeyDown}
              maxLength={draftHandoff.activeDraft ? (draftHandoff.activeDraft.source === 'home' ? HOME_GOAL_MAX_LENGTH : STARTER_GOAL_MAX_LENGTH) : undefined}
              placeholder={applyMutation.isPending ? 'جارٍ تطبيق التغييرات… انتظر قليلًا' : isAgentBusy ? 'العمل جارٍ… يظهر التقدم أعلاه' : getPlaceholder()}
              aria-label="رسالتك لمساعد المشروع"
              dir="auto"
              className="min-h-[44px] min-w-0 max-h-32 flex-1 resize-none border-0 bg-transparent px-3 py-2.5 text-sm shadow-none placeholder:text-muted-foreground/70 focus-visible:ring-0 focus-visible:ring-offset-0"
              rows={1}
              disabled={!isLoaded || applyMutation.isPending || isAgentBusy || (!draftHandoff.activeDraft && (projectsLoading || !selectedProjectId || Boolean(sessionId && messagesError) || !activeProvider?.configured || activeProviderSendBlocked))}
            />
            <Button
              data-testid="button-send-ai-message"
              size="icon"
              onClick={handleSend}
               disabled={!isLoaded || projectsLoading || !input.trim() || !selectedProjectId || homeGoalNeedsProjectConfirmation || (sessionId && messagesError) || !activeProvider?.configured || activeProviderSendBlocked || isAgentBusy || applyMutation.isPending}
               className="h-11 w-11 shrink-0 rounded-xl shadow-sm"
              title={applyMutation.isPending ? 'جارٍ تطبيق التغييرات…' : isAgentBusy ? 'المساعد يعمل الآن…' : getSendTitle()}
              aria-label={applyMutation.isPending ? 'جارٍ تطبيق التغييرات' : isAgentBusy ? 'المساعد يعمل الآن' : getSendTitle()}
            >
              {isSending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </Button>
            </div>
          </div>
        </div>
      </div>
      <Dialog
        open={Boolean(deliveryToDiscard && deliveryToDiscard.projectId === selectedProjectId)}
        onOpenChange={(open) => {
          if (!open && !deliveryRecoveryPending) setDeliveryToDiscard(null);
        }}
      >
        <DialogContent dir="rtl" lang="ar">
          <DialogHeader>
            <DialogTitle>إزالة مساحة التسليم المؤقتة؟</DialogTitle>
            <DialogDescription>
              سيُزيل هذا الإجراء مساحة العمل المؤقتة وتغييراتها المقترحة غير المطبقة لهذه العملية.
              لن يحذف مشروعك. إزالة المساحة ليست إيقافًا أو استئنافًا لتنفيذ المساعد.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeliveryToDiscard(null)}
              disabled={deliveryRecoveryPending !== null} data-testid="button-cancel-delivery-discard">
              الاحتفاظ بالمساحة
            </Button>
            <Button type="button" variant="destructive" data-testid="button-confirm-delivery-discard"
              disabled={deliveryRecoveryPending !== null}
              onClick={() => {
                if (!deliveryToDiscard || deliveryToDiscard.projectId !== selectedProjectId) return;
                const delivery = deliveryToDiscard.delivery;
                setDeliveryToDiscard(null);
                void recoverDelivery(delivery, 'discard');
              }}>
              تأكيد إزالة المساحة المؤقتة
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
