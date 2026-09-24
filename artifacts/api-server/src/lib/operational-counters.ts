/**
 * PR-2: In-process operational counters for audit and rate-limiter failures.
 *
 * These counters accumulate since the last process start and are exposed via
 * GET /api/healthz so operators can detect degraded subsystems without
 * tailing logs. A non-zero value means the system fell back to a best-effort
 * or fail-open path that deserves investigation:
 *
 *   auditWriteFailures      — an audit_logs insert attempt failed.
 *   auditWritesPending      — failed audit rows waiting for an automatic retry.
 *   auditWritesRecovered    — failed audit rows subsequently written.
 *   auditPersistenceUnavailable — an audit destination and its durable outbox
 *                                 were both unavailable.
 *   mutationsWithoutAudit    — a committed mutation could not be durably
 *                               represented in the audit trail.
 *   rateLimiterFailOpenCount — DB error caused the LLM rate limiter to allow
 *                             the request without enforcing the per-project
 *                             call budget.
 *   agentEpisodeShadow       — bounded Shadow Ledger write health since startup.
 *
 * Counters reset to zero on process restart. For persistent tracking, forward
 * logs that reference these events to an external monitoring system — each
 * increment is also logged at ERROR level by the caller.
 */

let _auditWriteFailures = 0;
let _auditWritesPending = 0;
let _auditWritesRecovered = 0;
let _auditPersistenceUnavailable = 0;
let _mutationsWithoutAudit = 0;
let _rateLimiterFailOpenCount = 0;
let _agentEpisodeShadowWrites = 0;
let _agentEpisodeShadowSuccesses = 0;
let _agentEpisodeShadowFailures = 0;
let _agentEpisodeShadowStaleWorkerRejections = 0;
let _agentEpisodeShadowSequenceConflicts = 0;
let _agentEpisodeShadowIdempotencyConflicts = 0;
let _agentEpisodeShadowTerminalImmutableRejections = 0;
const _agentEpisodeShadowLatencies: number[] = [];

function boundedLatency(value: number): number {
  return Math.max(0, Math.min(Math.round(value), 60_000));
}

function shadowLatencyP95(): number | null {
  if (_agentEpisodeShadowLatencies.length === 0) return null;
  const sorted = [..._agentEpisodeShadowLatencies].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  return sorted[index] ?? null;
}

/** Increment every time an audit_logs insert fails. */
export function incrementAuditFailures(): void {
  _auditWriteFailures++;
}

export function incrementPendingAudits(): void {
  _auditWritesPending++;
}

/** Set the pending count after reloading the durable audit outbox. */
export function setPendingAudits(count: number): void {
  _auditWritesPending = Math.max(0, count);
}

export function decrementPendingAudits(): void {
  _auditWritesPending = Math.max(0, _auditWritesPending - 1);
}

export function incrementRecoveredAudits(): void {
  _auditWritesRecovered++;
}

export function incrementAuditPersistenceUnavailable(): void {
  _auditPersistenceUnavailable++;
}

export function incrementMutationsWithoutAudit(): void {
  _mutationsWithoutAudit++;
}

/** Increment every time the DB rate limiter falls back to fail-open. */
export function incrementRateLimiterFailOpen(): void {
  _rateLimiterFailOpenCount++;
}

export function recordAgentEpisodeShadowStart(): void {
  _agentEpisodeShadowWrites++;
}

export function recordAgentEpisodeShadowSuccess(latencyMs: number): void {
  _agentEpisodeShadowSuccesses++;
  _agentEpisodeShadowLatencies.push(boundedLatency(latencyMs));
  if (_agentEpisodeShadowLatencies.length > 256) {
    _agentEpisodeShadowLatencies.splice(0, _agentEpisodeShadowLatencies.length - 256);
  }
}

export function recordAgentEpisodeShadowFailure(code: string): void {
  _agentEpisodeShadowFailures++;
  if (code === "stale_worker") _agentEpisodeShadowStaleWorkerRejections++;
  if (code === "sequence_conflict") _agentEpisodeShadowSequenceConflicts++;
  if (code === "invalid_contract") _agentEpisodeShadowIdempotencyConflicts++;
  if (code === "terminal_immutable") _agentEpisodeShadowTerminalImmutableRejections++;
}

/** Current snapshot of all operational counters. */
export function getOperationalCounters(): {
  auditWriteFailures: number;
  auditWritesPending: number;
  auditWritesRecovered: number;
  auditPersistenceUnavailable: number;
  mutationsWithoutAudit: number;
  rateLimiterFailOpenCount: number;
  agentEpisodeShadow: {
    writes: number;
    successes: number;
    failures: number;
    staleWorkerRejections: number;
    sequenceConflicts: number;
    idempotencyConflicts: number;
    terminalImmutableRejections: number;
    p95LatencyMs: number | null;
  };
} {
  return {
    auditWriteFailures: _auditWriteFailures,
    auditWritesPending: _auditWritesPending,
    auditWritesRecovered: _auditWritesRecovered,
    auditPersistenceUnavailable: _auditPersistenceUnavailable,
    mutationsWithoutAudit: _mutationsWithoutAudit,
    rateLimiterFailOpenCount: _rateLimiterFailOpenCount,
    agentEpisodeShadow: {
      writes: _agentEpisodeShadowWrites,
      successes: _agentEpisodeShadowSuccesses,
      failures: _agentEpisodeShadowFailures,
      staleWorkerRejections: _agentEpisodeShadowStaleWorkerRejections,
      sequenceConflicts: _agentEpisodeShadowSequenceConflicts,
      idempotencyConflicts: _agentEpisodeShadowIdempotencyConflicts,
      terminalImmutableRejections: _agentEpisodeShadowTerminalImmutableRejections,
      p95LatencyMs: shadowLatencyP95(),
    },
  };
}

/** Test-only reset hook; production code never needs to reset process health. */
export function resetOperationalCounters(): void {
  _auditWriteFailures = 0;
  _auditWritesPending = 0;
  _auditWritesRecovered = 0;
  _auditPersistenceUnavailable = 0;
  _mutationsWithoutAudit = 0;
  _rateLimiterFailOpenCount = 0;
  _agentEpisodeShadowWrites = 0;
  _agentEpisodeShadowSuccesses = 0;
  _agentEpisodeShadowFailures = 0;
  _agentEpisodeShadowStaleWorkerRejections = 0;
  _agentEpisodeShadowSequenceConflicts = 0;
  _agentEpisodeShadowIdempotencyConflicts = 0;
  _agentEpisodeShadowTerminalImmutableRejections = 0;
  _agentEpisodeShadowLatencies.length = 0;
}
