import { HOME_GOAL_MAX_LENGTH } from './home-goal-handoff';

const HOME_GOAL_COMPOSER_KEY_PREFIX = 'engineeringos:home-goal-composer:v1:';

export type HomeGoalComposerStatus = 'saved' | 'error' | null;

export interface HomeGoalComposerRead {
  text: string;
  status: HomeGoalComposerStatus;
}

function storageKey(ownerId: string): string | null {
  if (!ownerId || ownerId.length > 200) return null;
  return `${HOME_GOAL_COMPOSER_KEY_PREFIX}${encodeURIComponent(ownerId)}`;
}

export function readHomeGoalComposer(ownerId: string | null | undefined): HomeGoalComposerRead {
  if (!ownerId) return { text: '', status: null };
  const key = storageKey(ownerId);
  if (!key) return { text: '', status: 'error' };

  try {
    const text = window.sessionStorage.getItem(key);
    if (text === null || text.length === 0) return { text: '', status: null };
    if (text.length > HOME_GOAL_MAX_LENGTH) return { text: '', status: 'error' };
    return { text, status: 'saved' };
  } catch {
    return { text: '', status: 'error' };
  }
}

export function saveHomeGoalComposer(
  ownerId: string | null | undefined,
  text: string,
): HomeGoalComposerStatus {
  if (!ownerId) return null;
  const key = storageKey(ownerId);
  if (!key || text.length > HOME_GOAL_MAX_LENGTH) return 'error';

  try {
    if (!text.trim()) {
      window.sessionStorage.removeItem(key);
      return null;
    }
    window.sessionStorage.setItem(key, text);
    return 'saved';
  } catch {
    return 'error';
  }
}

export function clearHomeGoalComposer(ownerId: string | null | undefined): boolean {
  if (!ownerId) return false;
  const key = storageKey(ownerId);
  if (!key) return false;

  try {
    window.sessionStorage.removeItem(key);
    return true;
  } catch {
    try {
      window.sessionStorage.setItem(key, '');
      return true;
    } catch {
      return false;
    }
  }
}
