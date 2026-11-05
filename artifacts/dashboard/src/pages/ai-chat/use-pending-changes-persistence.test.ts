import { act, renderHook, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BehavioralVerification, PendingChange } from './provider-runtime';
import { usePendingChangesPersistence } from './use-pending-changes-persistence';

const sessionId = 'session-1';
const projectId = 'project-1';
const pendingKey = `eos_pending_${sessionId}`;
const verificationKey = `eos_verification_${sessionId}`;

const change: PendingChange = {
  path: 'src/example.ts',
  absolutePath: '/project/src/example.ts',
  newContent: 'export const value = 1;',
  originalContent: null,
  reason: 'Add a value',
};

function usePersistenceHarness(
  initialChanges: PendingChange[] = [],
  liveProposalId?: string,
) {
  const [pendingChanges, setPendingChanges] = useState(initialChanges);
  const [verificationResults, setVerificationResults] = useState<
    Record<string, BehavioralVerification>
  >({});
  const persistence = usePendingChangesPersistence({
    sessionId,
    projectId,
    pendingChanges,
    setPendingChanges,
    verificationResults,
    setVerificationResults,
    liveProposalId,
  });
  return {
    ...persistence,
    pendingChanges,
    setPendingChanges,
    verificationResults,
  };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('usePendingChangesPersistence', () => {
  it('restores a valid session-scoped proposal before writing the initial empty state', async () => {
    localStorage.setItem(pendingKey, JSON.stringify({
      version: 1,
      sessionId,
      projectId,
      savedAt: Date.now(),
      changes: [change],
    }));

    const { result } = renderHook(() => usePersistenceHarness());

    await waitFor(() => expect(result.current.pendingChanges).toEqual([change]));
    expect(localStorage.getItem(pendingKey)).not.toBeNull();
  });

  it('preserves a server-delivered live proposal while its new session hydrates', async () => {
    const { result } = renderHook(() => usePersistenceHarness([change], 'proposal-live'));

    await waitFor(() => expect(result.current.pendingChanges).toEqual([change]));
    expect(JSON.parse(localStorage.getItem(pendingKey) ?? '{}')).toMatchObject({
      sessionId,
      projectId,
      changes: [change],
    });
  });

  it('rejects malformed changes and removes their local cache', async () => {
    localStorage.setItem(pendingKey, JSON.stringify({
      version: 1,
      sessionId,
      projectId,
      savedAt: Date.now(),
      changes: [{ path: 'src/example.ts', newContent: 4 }],
    }));

    const { result } = renderHook(() => usePersistenceHarness());

    await waitFor(() => expect(result.current.pendingChanges).toEqual([]));
    expect(localStorage.getItem(pendingKey)).toBeNull();
  });

  it('rejects cached data from another project and verification for unrelated paths', async () => {
    localStorage.setItem(pendingKey, JSON.stringify({
      version: 1,
      sessionId,
      projectId: 'project-2',
      savedAt: Date.now(),
      changes: [change],
    }));
    localStorage.setItem(verificationKey, JSON.stringify({
      version: 1,
      sessionId,
      projectId,
      savedAt: Date.now(),
      results: { 'src/unrelated.ts': { status: 'passed' } },
    }));

    const { result } = renderHook(() => usePersistenceHarness());

    await waitFor(() => expect(result.current.pendingChanges).toEqual([]));
    expect(result.current.verificationResults).toEqual({});
    expect(localStorage.getItem(pendingKey)).toBeNull();
    expect(localStorage.getItem(verificationKey)).toBeNull();
  });

  it('does not throw when browser storage rejects a read', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Storage is blocked', 'SecurityError');
    });

    let hook: ReturnType<typeof renderHook<ReturnType<typeof usePersistenceHarness>>> | undefined;
    expect(() => {
      hook = renderHook(() => usePersistenceHarness());
    }).not.toThrow();
    expect(hook?.result.current.storageUnavailable).toBe(true);
    expect(hook?.result.current.pendingChanges).toEqual([]);
  });

  it('keeps pending state in memory and reports a quota error on write', async () => {
    const { result } = renderHook(() => usePersistenceHarness());
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage is full', 'QuotaExceededError');
    });

    act(() => result.current.setPendingChanges([change]));

    await waitFor(() => expect(result.current.storageUnavailable).toBe(true));
    expect(result.current.pendingChanges).toEqual([change]);
  });

  it('reports a failure to clear persisted state without interrupting the caller', () => {
    const { result } = renderHook(() => usePersistenceHarness());
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('Storage is blocked', 'SecurityError');
    });

    let cleared = true;
    act(() => {
      cleared = result.current.clearPersistedState();
    });
    expect(cleared).toBe(false);
    expect(result.current.storageUnavailable).toBe(true);
  });
});
