export const HOME_GOAL_DRAFT_HANDOFF_KEY = 'engineeringos:goal-drafts:v2';
export const HOME_GOAL_MAX_LENGTH = 2_000;
export const STARTER_GOAL_MAX_LENGTH = 3_000;
export const GOAL_DRAFT_TTL_MS = 24 * 60 * 60 * 1_000;
const MAX_DRAFTS_PER_ACCOUNT = 8;

export interface GoalDraft {
  version: 2;
  id: string;
  ownerId: string;
  source: 'home' | 'starter';
  text: string;
  projectId: string | null;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  sendAttemptedAt: number | null;
  bootstrap: {
    idempotencyKey: string;
    projectName: string;
    operationId: string | null;
  } | null;
}

const validId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 200;
const validTime = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

function isGoalDraft(value: unknown): value is GoalDraft {
  if (!value || typeof value !== 'object') return false;
  const draft = value as Partial<GoalDraft>;
  return draft.version === 2 && validId(draft.id) && validId(draft.ownerId)
    && (draft.source === 'home' || draft.source === 'starter')
    && typeof draft.text === 'string' && draft.text.length <= (draft.source === 'home' ? HOME_GOAL_MAX_LENGTH : STARTER_GOAL_MAX_LENGTH)
    && (draft.projectId === null || validId(draft.projectId))
    && validTime(draft.createdAt) && validTime(draft.updatedAt) && validTime(draft.expiresAt)
    && draft.updatedAt >= draft.createdAt && draft.updatedAt <= draft.expiresAt
    && draft.expiresAt === draft.createdAt + GOAL_DRAFT_TTL_MS
    && (draft.sendAttemptedAt === null || validTime(draft.sendAttemptedAt))
    && (draft.bootstrap === null || (
      validId(draft.bootstrap?.idempotencyKey)
      && typeof draft.bootstrap.projectName === 'string'
      && draft.bootstrap.projectName.trim().length > 0 && draft.bootstrap.projectName.length <= 200
      && (draft.bootstrap.operationId === null || validId(draft.bootstrap.operationId))
    ));
}

function readAll(): GoalDraft[] {
  const raw = window.sessionStorage.getItem(HOME_GOAL_DRAFT_HANDOFF_KEY);
  if (raw === null) return [];
  if (raw.length > 100_000) throw new Error('Invalid draft storage');
  const data: unknown = JSON.parse(raw);
  if (!Array.isArray(data) || data.length > 32 || !data.every(isGoalDraft)) {
    throw new Error('Invalid draft storage');
  }
  return data;
}

export function readGoalDrafts(ownerId: string | null | undefined): {
  drafts: GoalDraft[];
  error: string | null;
} {
  if (!ownerId) return { drafts: [], error: null };
  try {
    const now = Date.now();
    return {
      drafts: readAll().filter((draft) =>
        draft.ownerId === ownerId && draft.createdAt <= now && draft.expiresAt > now),
      error: null,
    };
  } catch {
    return { drafts: [], error: 'تعذر قراءة المسودات المحفوظة في هذا التبويب. لن نستبدلها أو نرسلها تلقائيًا.' };
  }
}

function writeAll(drafts: GoalDraft[]): void {
  if (drafts.length > 32 || !drafts.every(isGoalDraft)) throw new Error('Invalid draft storage');
  window.sessionStorage.setItem(HOME_GOAL_DRAFT_HANDOFF_KEY, JSON.stringify(drafts));
}

export function storeGoalDraft(
  ownerId: string,
  text: string,
  source: GoalDraft['source'] = 'home',
  projectId: string | null = null,
): GoalDraft | null {
  const normalized = text.trim();
  if (!validId(ownerId) || normalized.length > (source === 'home' ? HOME_GOAL_MAX_LENGTH : STARTER_GOAL_MAX_LENGTH) || (!normalized && source === 'home')) return null;
  try {
    const now = Date.now();
    const drafts = readAll().filter((draft) => draft.expiresAt > now);
    if (drafts.filter((draft) => draft.ownerId === ownerId).length >= MAX_DRAFTS_PER_ACCOUNT) return null;
    const draft: GoalDraft = {
      version: 2, id: crypto.randomUUID(), ownerId, source, text: normalized, projectId,
      createdAt: now, updatedAt: now, expiresAt: now + GOAL_DRAFT_TTL_MS,
      sendAttemptedAt: null, bootstrap: null,
    };
    writeAll([...drafts, draft]);
    return draft;
  } catch {
    return null;
  }
}

export function updateGoalDraft(
  ownerId: string,
  id: string,
  patch: Partial<Pick<GoalDraft, 'text' | 'projectId' | 'bootstrap' | 'sendAttemptedAt'>>,
): GoalDraft | null {
  try {
    const drafts = readAll();
    const index = drafts.findIndex((draft) =>
      draft.id === id && draft.ownerId === ownerId && draft.expiresAt > Date.now());
    if (index < 0) return null;
    const updated = { ...drafts[index], ...patch, updatedAt: Date.now() };
    if (!isGoalDraft(updated)) return null;
    drafts[index] = updated;
    writeAll(drafts);
    return updated;
  } catch {
    return null;
  }
}

export function removeGoalDraft(ownerId: string, id: string): boolean {
  try {
    const drafts = readAll();
    if (!drafts.some((draft) => draft.ownerId === ownerId && draft.id === id)) return false;
    writeAll(drafts.filter((draft) => !(draft.ownerId === ownerId && draft.id === id)));
    return true;
  } catch {
    return false;
  }
}

export function storeHomeGoalDraft(text: string, ownerId: string): GoalDraft | null {
  return storeGoalDraft(ownerId, text);
}
