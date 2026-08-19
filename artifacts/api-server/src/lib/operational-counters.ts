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
 *   rateLimiterFailOpenCount — DB error caused the LLM rate limiter to allow
 *                             the request without enforcing the per-project
 *                             call budget.
 *
 * Counters reset to zero on process restart. For persistent tracking, forward
 * logs that reference these events to an external monitoring system — each
 * increment is also logged at ERROR level by the caller.
 */

let _auditWriteFailures = 0;
let _auditWritesPending = 0;
let _auditWritesRecovered = 0;
let _rateLimiterFailOpenCount = 0;

/** Increment every time an audit_logs insert fails. */
export function incrementAuditFailures(): void {
  _auditWriteFailures++;
}

export function incrementPendingAudits(): void {
  _auditWritesPending++;
}

export function decrementPendingAudits(): void {
  _auditWritesPending = Math.max(0, _auditWritesPending - 1);
}

export function incrementRecoveredAudits(): void {
  _auditWritesRecovered++;
}

/** Increment every time the DB rate limiter falls back to fail-open. */
export function incrementRateLimiterFailOpen(): void {
  _rateLimiterFailOpenCount++;
}

/** Current snapshot of all operational counters. */
export function getOperationalCounters(): {
  auditWriteFailures: number;
  auditWritesPending: number;
  auditWritesRecovered: number;
  rateLimiterFailOpenCount: number;
} {
  return {
    auditWriteFailures: _auditWriteFailures,
    auditWritesPending: _auditWritesPending,
    auditWritesRecovered: _auditWritesRecovered,
    rateLimiterFailOpenCount: _rateLimiterFailOpenCount,
  };
}

/** Test-only reset hook; production code never needs to reset process health. */
export function resetOperationalCounters(): void {
  _auditWriteFailures = 0;
  _auditWritesPending = 0;
  _auditWritesRecovered = 0;
  _rateLimiterFailOpenCount = 0;
}
