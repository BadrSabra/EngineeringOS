import { useEffect, type Dispatch, type SetStateAction } from 'react';
import type { BehavioralVerification, PendingChange } from './provider-runtime';

export function usePendingChangesPersistence({
  sessionId,
  pendingChanges,
  setPendingChanges,
  verificationResults,
  setVerificationResults,
}: {
  sessionId: string | undefined;
  pendingChanges: PendingChange[];
  setPendingChanges: Dispatch<SetStateAction<PendingChange[]>>;
  verificationResults: Record<string, BehavioralVerification>;
  setVerificationResults: Dispatch<SetStateAction<Record<string, BehavioralVerification>>>;
}) {
  // G-06 fix: pending changes are stored with a timestamp so stale entries
  // (from a crashed/closed tab after the server wrote the files but before
  // onSuccess could clear them) expire automatically after 24 hours instead
  // of becoming permanent phantom items.
  const PENDING_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
  type StoredPending = { changes: PendingChange[]; savedAt: number };
  const pendingKey = sessionId ? `eos_pending_${sessionId}` : undefined;
  const verificationKey = sessionId ? `eos_verification_${sessionId}` : undefined;

  useEffect(() => {
    if (!pendingKey || !verificationKey) return;
    if (pendingChanges.length > 0) {
      const payload: StoredPending = { changes: pendingChanges, savedAt: Date.now() };
      localStorage.setItem(pendingKey, JSON.stringify(payload));
    } else {
      localStorage.removeItem(pendingKey);
    }
    if (Object.keys(verificationResults).length > 0) {
      localStorage.setItem(verificationKey, JSON.stringify(verificationResults));
    } else {
      localStorage.removeItem(verificationKey);
    }
  }, [pendingChanges, pendingKey, verificationKey, verificationResults]);

  useEffect(() => {
    if (!sessionId) {
      setPendingChanges([]);
      setVerificationResults({});
      return;
    }
    if (!pendingKey || !verificationKey) return;
    const storedVerification = localStorage.getItem(verificationKey);
    if (storedVerification) {
      try {
        setVerificationResults(JSON.parse(storedVerification) as Record<string, BehavioralVerification>);
      } catch {
        localStorage.removeItem(verificationKey);
        setVerificationResults({});
      }
    } else {
      setVerificationResults({});
    }
    const raw = localStorage.getItem(pendingKey);
    if (!raw) { setPendingChanges([]); return; }
    try {
      const stored = JSON.parse(raw) as StoredPending | PendingChange[];
      // Handle both the old format (plain array) and the new format ({ changes, savedAt }).
      const changes = Array.isArray(stored) ? stored : stored.changes;
      const savedAt  = Array.isArray(stored) ? 0       : stored.savedAt;
      if (Date.now() - savedAt > PENDING_TTL_MS) {
        // Entry is older than 24 h — the server almost certainly already wrote
        // those files.  Remove the ghost entry rather than confusing the user.
        localStorage.removeItem(pendingKey);
        setPendingChanges([]);
        return;
      }
      if (changes.length > 0) setPendingChanges(changes);
    } catch {
      localStorage.removeItem(pendingKey);
    }
  }, [pendingKey, sessionId, verificationKey]);

  return { pendingKey, verificationKey };
}
