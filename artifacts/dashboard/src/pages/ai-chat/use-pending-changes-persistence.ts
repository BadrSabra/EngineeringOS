import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { BehavioralVerification, PendingChange } from './provider-runtime';

const PENDING_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const RISK_LEVELS = new Set(['low', 'medium', 'high']);
const VALIDATION_PROFILES = new Set([
  'ai-orchestrator-tests',
  'knowledge-engine-tests',
  'api-ai-tests',
  'api-repair-validation-tests',
  'workspace-typecheck',
]);
const VERIFICATION_STATUSES = new Set(['passed', 'failed', 'skipped', 'unavailable', 'blocked']);

type StoredPending = {
  version: 1;
  projectId: string;
  sessionId: string;
  savedAt: number;
  changes: PendingChange[];
};

type StoredVerification = {
  version: 1;
  projectId: string;
  sessionId: string;
  savedAt: number;
  results: Record<string, BehavioralVerification>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOptionalString(record: Record<string, unknown>, key: string): boolean {
  return record[key] === undefined || typeof record[key] === 'string';
}

function isEvidenceLink(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    (value.kind === 'finding' || value.kind === 'source' || value.kind === 'validation')
    && typeof value.id === 'string'
    && typeof value.label === 'string'
    && isOptionalString(value, 'file')
    && (value.line === undefined || (Number.isInteger(value.line) && (value.line as number) > 0))
  );
}

function isPendingChange(value: unknown): value is PendingChange {
  if (!isRecord(value)) return false;
  if (
    typeof value.path !== 'string'
    || !value.path.trim()
    || typeof value.absolutePath !== 'string'
    || !value.absolutePath.trim()
    || typeof value.newContent !== 'string'
    || !(value.originalContent === null || typeof value.originalContent === 'string')
    || typeof value.reason !== 'string'
    || !isOptionalString(value, 'baseHash')
    || !isOptionalString(value, 'validationProfile')
    || (value.validationProfile !== undefined
      && (typeof value.validationProfile !== 'string'
        || !VALIDATION_PROFILES.has(value.validationProfile)))
    || (value.risk !== undefined && !RISK_LEVELS.has(String(value.risk)))
    || (value.evidence !== undefined
      && (!Array.isArray(value.evidence) || !value.evidence.every(isEvidenceLink)))
  ) {
    return false;
  }

  if (value.hunks === undefined) return true;
  return Array.isArray(value.hunks) && value.hunks.every((hunk) => {
    if (!isRecord(hunk)) return false;
    return (
      Number.isInteger(hunk.startLine)
      && (hunk.startLine as number) > 0
      && Number.isInteger(hunk.endLine)
      && (hunk.endLine as number) >= (hunk.startLine as number)
      && typeof hunk.expectedText === 'string'
      && typeof hunk.replacementText === 'string'
      && typeof hunk.reason === 'string'
      && (hunk.risk === undefined || RISK_LEVELS.has(String(hunk.risk)))
      && (hunk.evidence === undefined
        || (Array.isArray(hunk.evidence) && hunk.evidence.every(isEvidenceLink)))
    );
  });
}

function isBehavioralVerification(value: unknown): value is BehavioralVerification {
  if (!isRecord(value) || !VERIFICATION_STATUSES.has(String(value.status))) return false;
  if (!isOptionalString(value, 'profile') || !isOptionalString(value, 'scenario') || !isOptionalString(value, 'detail')) {
    return false;
  }
  if (value.conflict === undefined) return true;
  if (!isRecord(value.conflict)) return false;
  const conflict = value.conflict;
  return (
    (conflict.kind === undefined
      || conflict.kind === 'base_hash_mismatch'
      || conflict.kind === 'hunk_mismatch')
    && isOptionalString(conflict, 'expectedHash')
    && isOptionalString(conflict, 'actualHash')
    && (conflict.hunkIndex === undefined
      || (Number.isInteger(conflict.hunkIndex) && (conflict.hunkIndex as number) >= 0))
  );
}

function isFreshEnvelope(
  value: Record<string, unknown>,
  projectId: string,
  sessionId: string,
  now: number,
): boolean {
  return (
    value.version === 1
    && value.projectId === projectId
    && value.sessionId === sessionId
    && typeof value.savedAt === 'number'
    && Number.isFinite(value.savedAt)
    && value.savedAt > 0
    && value.savedAt <= now + MAX_FUTURE_SKEW_MS
    && now - value.savedAt <= PENDING_TTL_MS
  );
}

function parseStoredPending(
  raw: string,
  projectId: string,
  sessionId: string,
  now: number,
): PendingChange[] | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      !isRecord(parsed)
      || !isFreshEnvelope(parsed, projectId, sessionId, now)
      || !Array.isArray(parsed.changes)
      || parsed.changes.length === 0
      || !parsed.changes.every(isPendingChange)
    ) {
      return null;
    }
    return parsed.changes;
  } catch {
    return null;
  }
}

function parseStoredVerification(
  raw: string,
  projectId: string,
  sessionId: string,
  allowedPaths: Set<string>,
  now: number,
): Record<string, BehavioralVerification> | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      !isRecord(parsed)
      || !isFreshEnvelope(parsed, projectId, sessionId, now)
      || !isRecord(parsed.results)
      || !Object.entries(parsed.results).every(([path, value]) =>
        allowedPaths.has(path) && isBehavioralVerification(value))
    ) {
      return null;
    }
    return parsed.results as Record<string, BehavioralVerification>;
  } catch {
    return null;
  }
}

function safeGetItem(key: string): { ok: true; value: string | null } | { ok: false } {
  try {
    return { ok: true, value: window.localStorage.getItem(key) };
  } catch {
    return { ok: false };
  }
}

function safeSetItem(key: string, value: string): boolean {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function safeRemoveItem(key: string): boolean {
  try {
    window.localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export function usePendingChangesPersistence({
  projectId,
  sessionId,
  liveProposalId,
  pendingChanges,
  setPendingChanges,
  verificationResults,
  setVerificationResults,
}: {
  projectId: string | undefined;
  sessionId: string | undefined;
  liveProposalId: string | undefined;
  pendingChanges: PendingChange[];
  setPendingChanges: Dispatch<SetStateAction<PendingChange[]>>;
  verificationResults: Record<string, BehavioralVerification>;
  setVerificationResults: Dispatch<SetStateAction<Record<string, BehavioralVerification>>>;
}) {
  const [hydratedSessionId, setHydratedSessionId] = useState<string | undefined>();
  const [storageUnavailable, setStorageUnavailable] = useState(false);
  const pendingChangesRef = useRef(pendingChanges);
  pendingChangesRef.current = pendingChanges;
  const pendingKey = sessionId ? `eos_pending_${sessionId}` : undefined;
  const verificationKey = sessionId ? `eos_verification_${sessionId}` : undefined;

  useEffect(() => {
    if (!sessionId || !projectId || !pendingKey || !verificationKey) {
      setPendingChanges([]);
      setVerificationResults({});
      setHydratedSessionId(undefined);
      setStorageUnavailable(false);
      return;
    }

    setHydratedSessionId(undefined);
    setStorageUnavailable(false);
    const now = Date.now();
    let failed = false;
    const storedPending = safeGetItem(pendingKey);
    let changes: PendingChange[] = [];
    if (!storedPending.ok) {
      failed = true;
    } else if (storedPending.value) {
      const parsedChanges = parseStoredPending(storedPending.value, projectId, sessionId, now);
      if (parsedChanges) {
        changes = parsedChanges;
      } else {
        if (!safeRemoveItem(pendingKey)) failed = true;
        if (liveProposalId && pendingChangesRef.current.length > 0) {
          changes = pendingChangesRef.current;
        }
      }
    } else if (liveProposalId && pendingChangesRef.current.length > 0) {
      // A just-completed stream may assign its new session and proposal in the
      // same render. Preserve that server-delivered in-memory proposal instead
      // of replacing it with an empty cache during hydration.
      changes = pendingChangesRef.current;
    }
    setPendingChanges(changes);

    const storedVerification = safeGetItem(verificationKey);
    let results: Record<string, BehavioralVerification> = {};
    if (!storedVerification.ok) {
      failed = true;
    } else if (storedVerification.value) {
      const allowedPaths = new Set(changes.map((change) => change.path));
      const parsedResults = parseStoredVerification(
        storedVerification.value,
        projectId,
        sessionId,
        allowedPaths,
        now,
      );
      if (parsedResults) {
        results = parsedResults;
      } else if (!safeRemoveItem(verificationKey)) {
        failed = true;
      }
    }
    setVerificationResults(results);
    setStorageUnavailable(failed);
    setHydratedSessionId(sessionId);
  }, [
    liveProposalId,
    pendingKey,
    projectId,
    sessionId,
    setPendingChanges,
    setVerificationResults,
    verificationKey,
  ]);

  useEffect(() => {
    if (
      !sessionId
      || !projectId
      || !pendingKey
      || !verificationKey
      || hydratedSessionId !== sessionId
    ) return;

    let failed = false;
    if (pendingChanges.length > 0) {
      const payload: StoredPending = {
        version: 1,
        projectId,
        sessionId,
        savedAt: Date.now(),
        changes: pendingChanges,
      };
      if (!safeSetItem(pendingKey, JSON.stringify(payload))) failed = true;
    } else if (!safeRemoveItem(pendingKey)) {
      failed = true;
    }

    const allowedPaths = new Set(pendingChanges.map((change) => change.path));
    const safeResults = Object.fromEntries(
      Object.entries(verificationResults).filter(([path, value]) =>
        allowedPaths.has(path) && isBehavioralVerification(value)),
    );
    if (Object.keys(safeResults).length > 0) {
      const payload: StoredVerification = {
        version: 1,
        projectId,
        sessionId,
        savedAt: Date.now(),
        results: safeResults,
      };
      if (!safeSetItem(verificationKey, JSON.stringify(payload))) failed = true;
    } else if (!safeRemoveItem(verificationKey)) {
      failed = true;
    }

    if (failed) setStorageUnavailable(true);
  }, [
    hydratedSessionId,
    pendingChanges,
    pendingKey,
    projectId,
    sessionId,
    verificationKey,
    verificationResults,
  ]);

  const clearPersistedState = useCallback((): boolean => {
    const pendingRemoved = !pendingKey || safeRemoveItem(pendingKey);
    const verificationRemoved = !verificationKey || safeRemoveItem(verificationKey);
    if (!pendingRemoved || !verificationRemoved) setStorageUnavailable(true);
    return pendingRemoved && verificationRemoved;
  }, [pendingKey, verificationKey]);

  return { pendingKey, verificationKey, storageUnavailable, clearPersistedState };
}
