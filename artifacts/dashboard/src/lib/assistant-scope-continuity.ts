export type AssistantScope = 'general' | 'project';

export type AssistantScopeContext =
  | { scope: 'general'; sessionId?: string; draftId?: string }
  | { scope: 'project'; projectId: string; sessionId?: string; draftId?: string };

type ComposerDraftRead = { ok: true; text: string | null } | { ok: false };

const STORAGE_VERSION = 'v1';
const MAX_ID_LENGTH = 512;
const MAX_DRAFT_LENGTH = 32_000;

function isOpaqueId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_ID_LENGTH;
}

function ownerPart(ownerId: string): string {
  return encodeURIComponent(ownerId);
}

function composerDraftKey(ownerId: string, scope: AssistantScope, contextId: string): string {
  return `engineeringos:assistant-composer:${STORAGE_VERSION}:${ownerPart(ownerId)}:${scope}:${encodeURIComponent(contextId)}`;
}

function scopeContextKey(ownerId: string, scope: AssistantScope, projectId?: string): string {
  const scopeIdentity = scope === 'project' ? `project:${encodeURIComponent(projectId ?? '')}` : 'general';
  return `engineeringos:assistant-return:${STORAGE_VERSION}:${ownerPart(ownerId)}:${scopeIdentity}`;
}

export function readAssistantComposerDraft(
  ownerId: string | null | undefined,
  scope: AssistantScope,
  contextId: string | null | undefined,
): ComposerDraftRead {
  if (!ownerId || !contextId) return { ok: true, text: null };
  try {
    return { ok: true, text: sessionStorage.getItem(composerDraftKey(ownerId, scope, contextId)) };
  } catch {
    return { ok: false };
  }
}

export function saveAssistantComposerDraft(
  ownerId: string | null | undefined,
  scope: AssistantScope,
  contextId: string | null | undefined,
  text: string,
): boolean {
  if (!ownerId || !contextId || text.length > MAX_DRAFT_LENGTH) return false;
  try {
    const key = composerDraftKey(ownerId, scope, contextId);
    if (!text.trim()) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, text);
    return true;
  } catch {
    return false;
  }
}

export function rememberAssistantScopeContext(
  ownerId: string | null | undefined,
  context: AssistantScopeContext,
): boolean {
  if (!ownerId) return false;
  if (context.scope === 'project' && !isOpaqueId(context.projectId)) return false;
  if (context.sessionId !== undefined && !isOpaqueId(context.sessionId)) return false;
  if (context.draftId !== undefined && !isOpaqueId(context.draftId)) return false;
  try {
    sessionStorage.setItem(
      scopeContextKey(ownerId, context.scope, context.scope === 'project' ? context.projectId : undefined),
      JSON.stringify(context),
    );
    return true;
  } catch {
    return false;
  }
}

export function readAssistantScopeContext(
  ownerId: string | null | undefined,
  scope: AssistantScope,
  projectId?: string,
): AssistantScopeContext | null {
  if (!ownerId || (scope === 'project' && !isOpaqueId(projectId))) return null;
  try {
    const raw = sessionStorage.getItem(scopeContextKey(ownerId, scope, projectId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed.scope !== scope) return null;
    const sessionId = parsed.sessionId === undefined
      ? undefined
      : isOpaqueId(parsed.sessionId) ? parsed.sessionId : null;
    const draftId = parsed.draftId === undefined
      ? undefined
      : isOpaqueId(parsed.draftId) ? parsed.draftId : null;
    if (sessionId === null || draftId === null) return null;
    if (scope === 'general') {
      return {
        scope,
        ...(sessionId ? { sessionId } : {}),
        ...(draftId ? { draftId } : {}),
      };
    }
    if (!isOpaqueId(parsed.projectId)) return null;
    return {
      scope,
      projectId: parsed.projectId,
      ...(sessionId ? { sessionId } : {}),
      ...(draftId ? { draftId } : {}),
    };
  } catch {
    return null;
  }
}

export function buildAssistantScopeHref(context: AssistantScopeContext): string {
  const params = new URLSearchParams();
  if (context.scope === 'general') {
    if (context.sessionId) params.set('sessionId', context.sessionId);
    if (context.draftId) params.set('goalDraftId', context.draftId);
    const query = params.toString();
    return `/general-chat${query ? `?${query}` : ''}`;
  }
  params.set('projectId', context.projectId);
  if (context.sessionId) params.set('sessionId', context.sessionId);
  if (context.draftId) params.set('goalDraftId', context.draftId);
  return `/ai?${params.toString()}`;
}

export function getAssistantComposerContextId(
  scope: AssistantScope,
  projectId?: string | null,
  sessionId?: string | null,
): string | null {
  if (scope === 'general') return sessionId || null;
  if (!projectId) return null;
  return `${projectId}:${sessionId || 'new'}`;
}
