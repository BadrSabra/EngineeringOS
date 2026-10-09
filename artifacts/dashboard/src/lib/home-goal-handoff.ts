export const HOME_GOAL_DRAFT_HANDOFF_KEY = 'engineeringos:home-goal-draft:v1';
export const HOME_GOAL_MAX_LENGTH = 2_000;

export function storeHomeGoalDraft(draft: string): boolean {
  const normalized = draft.trim();
  if (!normalized || normalized.length > HOME_GOAL_MAX_LENGTH) return false;

  try {
    window.sessionStorage.setItem(HOME_GOAL_DRAFT_HANDOFF_KEY, normalized);
    return true;
  } catch {
    return false;
  }
}

export function consumeHomeGoalDraft(): string | null {
  try {
    const draft = window.sessionStorage.getItem(HOME_GOAL_DRAFT_HANDOFF_KEY);
    if (draft !== null) window.sessionStorage.removeItem(HOME_GOAL_DRAFT_HANDOFF_KEY);

    const normalized = draft?.trim();
    if (!normalized || normalized.length > HOME_GOAL_MAX_LENGTH) return null;
    return normalized;
  } catch {
    return null;
  }
}
