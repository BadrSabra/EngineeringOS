

export function persistedCompletedReadFiles(execution: unknown): string[] {
  if (!execution || typeof execution !== 'object') return [];
  const checkpoint = (execution as { checkpoint?: unknown }).checkpoint;
  if (!checkpoint || typeof checkpoint !== 'object') return [];
  const record = checkpoint as Record<string, unknown>;
  const recentEvidenceSteps = Array.isArray(record.recentSteps)
    ? record.recentSteps
      .filter((step): step is Record<string, unknown> => Boolean(step) && typeof step === 'object')
      .filter((step) => step.kind === 'evidence_integrity')
    : [];
  const candidates: unknown[] = [
    record.completedReadFiles,
    record.evidenceIntegrity && typeof record.evidenceIntegrity === 'object'
      ? (record.evidenceIntegrity as Record<string, unknown>).completedReadFiles
      : undefined,
    record.evidence && typeof record.evidence === 'object'
      ? (record.evidence as Record<string, unknown>).completedReadFiles
      : undefined,
    record.sourceRetrieval && typeof record.sourceRetrieval === 'object'
      ? (record.sourceRetrieval as Record<string, unknown>).readPaths
      : undefined,
    ...recentEvidenceSteps.map((step) => step.completedReadFiles),
  ];
  return [...new Set(
    candidates
      .flatMap((candidate) => Array.isArray(candidate) ? candidate : [])
      .filter((file): file is string => typeof file === 'string' && file.trim().length > 0),
  )];
}

export type StreamOwner = {
  generation: number;
  projectId: string;
  sessionId?: string;
  executionId?: string;
};

/**
 * Local mirror of the AI-008 typed result union. The server sends the nested
 * payloads as plain objects, so accessors below cast defensively rather than
 * trusting the shape at the type level.
 */
export type AiTaskResult =
  | {
      kind: 'CODE_EXTRACTION_RESULT';
      extractedCode: string;
      source?: string;
    }
  | { kind: 'BEHAVIOR_ANSWER_RESULT'; answer: Record<string, unknown> }
  | {
      kind: 'PROJECT_QUERY_INVESTIGATION_RESULT';
      investigationId: string;
      class: 'FACT';
      status:
        | 'ANSWER_COMPLETE'
        | 'ANSWER_PARTIAL'
        | 'ANSWER_EVIDENCE_ONLY'
        | 'ANSWER_UNDETERMINED'
        | 'ANSWER_BLOCKED';
      answer: string;
      answerAssessment: 'MODEL_PROPOSED' | 'SOURCE_OBSERVED_ONLY' | 'MODEL_UNDETERMINED' | 'NONE';
      requiredCoverage: {
        obligationId: 'original-question';
        questionHash: string;
        status: 'ANSWERED' | 'PARTIAL' | 'UNANSWERED';
      };
      sources: Array<{
        observationId: string;
        path: string;
        contentSha256: string;
        byteLength: number;
        lineStart?: number;
        lineEnd?: number;
        readStatus: 'READ_COMPLETE';
        workspaceRevision: string;
        operationId: string;
        executionId: string | null;
        attempt: number | null;
      }>;
      manifestId: string | null;
      workspaceRevision: string;
      operationId: string;
      executionId: string | null;
      attempt: number | null;
      reasonCode?: string;
      assurance: 'INVESTIGATION_ONLY';
    }
  | { kind: 'FINDING_RESULT'; finding: Record<string, unknown> }
  | {
      kind: 'FORENSIC_REPORT_RESULT';
      report: string;
      evidence: Record<string, unknown>[];
    }
   | {
       kind: 'WORKSPACE_REVIEW_RESULT';
       report: string;
       evidence: Record<string, unknown>[];
     }
  | {
      kind: 'REPAIR_RESULT';
      phases: Record<string, unknown>[];
      readiness: 'READY' | 'BLOCKED' | 'NOT_PROVEN';
     }
  | {
      kind: 'IMPLEMENTATION_PLAN_RESULT';
      objective: string;
      summary: string;
      assumptions: string[];
      steps: Record<string, unknown>[];
      validationCommands: string[];
       browserValidationProfile?: string;
      risks: string[];
      approvalStatus: 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED';
      writeAccess: 'NOT_AUTHORIZED' | 'APPROVED_FOR_BUILD';
    };

export function hasSafeImplementationPlanFileScope(
  plan: Extract<AiTaskResult, { kind: 'IMPLEMENTATION_PLAN_RESULT' }>,
): boolean {
  return plan.steps.some((rawStep) => {
    if (!rawStep || typeof rawStep !== 'object' || !Array.isArray(rawStep.files)) return false;
    return rawStep.files.some((file) => {
      if (typeof file !== 'string') return false;
      const normalized = file.trim().replaceAll('\\', '/');
      return normalized.length > 0 &&
        normalized !== '.' &&
        !normalized.startsWith('/') &&
        !normalized.startsWith('../') &&
        !normalized.includes('/../');
    });
  });
}

export type Session = {
  id: string;
  title: string;
  updatedAt: string;
  forensicStatus?: 'INCOMPLETE' | 'NO_FINDING' | 'FINDING_PROVEN' | 'NOT_PROVEN';
};

export const AI_CHAT_SELECTION_STORAGE_PREFIX = 'eos_ai_selection_';

export const AI_CHAT_SYNC_STORAGE_KEY = 'eos_ai_sync_event';

export type AiChatSyncEvent = {
  version: 1;
  sequence: number;
  projectId: string;
  kind: 'selection' | 'data';
  sessionId?: string;
};

let aiChatSyncSequence = 0;

type AiChatSelection =
  | {
      version: 1;
      projectId: string;
      kind: 'session';
      sessionId: string;
    }
  | {
      version: 1;
      projectId: string;
      kind: 'historical-audit';
      executionId: string;
      sessionId?: string;
    };

export function aiChatSelectionStorageKey(projectId: string): string {
  return `${AI_CHAT_SELECTION_STORAGE_PREFIX}${projectId}`;
}

export function getStoredAiChatSessionId(projectId: string): string | undefined {
  try {
    const selection = parseAiChatSelection(
      localStorage.getItem(aiChatSelectionStorageKey(projectId)),
      projectId,
    );
    return selection?.sessionId;
  } catch {
    return undefined;
  }
}

export function isOpaqueSelectionId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 512;
}

type AiChatRouteTarget = {
  projectId: string;
  sessionId?: string;
  messageId?: string;
  missionId?: string;
};

export type RouteMissionRestoration = {
  key: string;
  kind: 'not-linked' | 'selection-failed' | 'missions-unavailable';
};

export function parseAiChatRouteTarget(search: string): AiChatRouteTarget | null {
  const params = new URLSearchParams(search);
  const projectId = params.get('projectId');
  if (!isOpaqueSelectionId(projectId)) return null;
  const sessionId = params.get('sessionId');
  const messageId = params.get('messageId');
  const missionId = params.get('missionId');
  const hasExplicitSessionId = isOpaqueSelectionId(sessionId);
  return {
    projectId,
    ...(hasExplicitSessionId ? { sessionId } : {}),
    ...(isOpaqueSelectionId(messageId) ? { messageId } : {}),
    ...(hasExplicitSessionId && isOpaqueSelectionId(missionId) ? { missionId } : {}),
  };
}

export function parseAiChatSelection(raw: string | null, projectId: string): AiChatSelection | null {
  if (!raw || !isOpaqueSelectionId(projectId)) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (
      parsed.version !== 1
      || parsed.projectId !== projectId
      || (parsed.kind !== 'session' && parsed.kind !== 'historical-audit')
    ) {
      return null;
    }
    if (parsed.kind === 'session' && isOpaqueSelectionId(parsed.sessionId)) {
      return {
        version: 1,
        projectId,
        kind: 'session',
        sessionId: parsed.sessionId,
      };
    }
    if (
      parsed.kind === 'historical-audit'
      && isOpaqueSelectionId(parsed.executionId)
      && (parsed.sessionId === undefined || isOpaqueSelectionId(parsed.sessionId))
    ) {
      return {
        version: 1,
        projectId,
        kind: 'historical-audit',
        executionId: parsed.executionId,
        ...(parsed.sessionId !== undefined ? { sessionId: parsed.sessionId } : {}),
      };
    }
  } catch {
    // Malformed browser state is treated as an unavailable selection.
  }
  return null;
}

export function persistAiChatSelection(selection: AiChatSelection): void {
  try {
    localStorage.setItem(
      aiChatSelectionStorageKey(selection.projectId),
      JSON.stringify(selection),
    );
    publishAiChatSyncEvent({
      projectId: selection.projectId,
      kind: 'selection',
      ...(selection.kind === 'session' ? { sessionId: selection.sessionId } : {}),
    });
  } catch {
    // Browser storage can be unavailable in privacy-restricted contexts.
  }
}

function publishAiChatSyncEvent(
  event: Omit<AiChatSyncEvent, 'version' | 'sequence'>,
): void {
  try {
    localStorage.setItem(
      AI_CHAT_SYNC_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        sequence: ++aiChatSyncSequence,
        ...event,
      } satisfies AiChatSyncEvent),
    );
  } catch {
    // Browser storage can be unavailable in privacy-restricted contexts.
  }
}

export function clearAiChatSelection(projectId: string | undefined): void {
  if (!projectId) return;
  try {
    localStorage.removeItem(aiChatSelectionStorageKey(projectId));
    publishAiChatSyncEvent({ projectId, kind: 'selection' });
  } catch {
    // Browser storage can be unavailable in privacy-restricted contexts.
  }
}

export function publishAiChatData(projectId: string | undefined, sessionId?: string): void {
  if (!projectId) return;
  publishAiChatSyncEvent({
    projectId,
    kind: 'data',
    ...(sessionId && isOpaqueSelectionId(sessionId) ? { sessionId } : {}),
  });
}

export function sessionForensicStatusLabel(status: Session['forensicStatus']): string | null {
  switch (status) {
    case 'INCOMPLETE': return 'Incomplete';
    case 'NO_FINDING': return 'No finding';
    case 'FINDING_PROVEN': return 'Finding proven';
    case 'NOT_PROVEN': return 'Not proven';
    default: return null;
  }
}
