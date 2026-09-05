/**
 * PR-07 — Circuit Breaker for AI Providers
 *
 * After CIRCUIT_OPEN_THRESHOLD consecutive failures the circuit opens and
 * the provider is skipped for COOLDOWN_MS (2 minutes).  After the cooldown
 * the circuit enters the half-open state: one request is allowed through to
 * probe health.  A successful probe closes the circuit; another failure
 * restarts the cooldown.
 *
 * Design:
 *   • Module-level singleton — one circuit per provider per process.
 *   • Zero I/O — all state is in-memory; resets on process restart.
 *   • Safe for concurrent callers — JS event-loop is single-threaded.
 *   • Logs every open/close transition as a structured JSON line.
 */

const CIRCUIT_OPEN_THRESHOLD = 5; // consecutive failures before opening
const COOLDOWN_MS = 2 * 60 * 1_000; // 2 minutes

type CircuitState = {
  consecutiveFailures: number;
  /** epoch ms when the circuit was opened; null = closed */
  openedAt: number | null;
  /** true while we are probing after a cooldown */
  halfOpen: boolean;
  /** true after the half-open probe has been reserved until it settles */
  halfOpenProbeInFlight: boolean;
};

const _circuits = new Map<string, CircuitState>();

function getOrCreate(provider: string): CircuitState {
  let s = _circuits.get(provider);
  if (!s) {
    s = {
      consecutiveFailures: 0,
      openedAt: null,
      halfOpen: false,
      halfOpenProbeInFlight: false,
    };
    _circuits.set(provider, s);
  }
  return s;
}

/**
 * Returns true when the provider's circuit is open and requests should be
 * skipped.  Automatically transitions to half-open after the cooldown.
 */
export function isCircuitOpen(provider: string): boolean {
  const s = _circuits.get(provider);
  if (!s || s.openedAt === null) return false;

  const elapsed = Date.now() - s.openedAt;
  if (elapsed >= COOLDOWN_MS) {
    if (!s.halfOpenProbeInFlight) {
      // Reserve the single half-open probe before returning. JavaScript's
      // synchronous state transition makes concurrent callers observe the
      // reservation rather than all entering the provider at once.
      s.halfOpen = true;
      s.halfOpenProbeInFlight = true;
      console.info(
        JSON.stringify({
          scope: "circuit-breaker",
          code: "CIRCUIT_HALF_OPEN",
          provider,
          consecutiveFailures: s.consecutiveFailures,
          openedAt: s.openedAt,
          halfOpen: true,
          cooldownRemainingMs: 0,
          hint: `${provider} cooldown elapsed — probing with one reserved request`,
        }),
      );
      return false;
    }

    console.warn(
      JSON.stringify({
        scope: "circuit-breaker",
        code: "CIRCUIT_HALF_OPEN_PROBE_IN_FLIGHT",
        provider,
        consecutiveFailures: s.consecutiveFailures,
        openedAt: s.openedAt,
        halfOpen: true,
        cooldownRemainingMs: 0,
        hint: `${provider} half-open probe already in flight — skipping concurrent request`,
      }),
    );
    return true;
  }

  const cooldownRemainingMs = COOLDOWN_MS - elapsed;
  console.warn(
    JSON.stringify({
      scope: "circuit-breaker",
      code: "CIRCUIT_STILL_OPEN",
      provider,
      consecutiveFailures: s.consecutiveFailures,
      openedAt: s.openedAt,
      halfOpen: s.halfOpen,
      cooldownRemainingMs,
      hint: `${provider} circuit still open — ${Math.ceil(cooldownRemainingMs / 1000)}s remaining before probe`,
    }),
  );
  return true;
}

/**
 * Record a provider call failure.  Opens the circuit when the threshold is
 * exceeded; logs the transition.
 */
export function recordCircuitFailure(provider: string): void {
  const s = getOrCreate(provider);
  s.consecutiveFailures += 1;
  s.halfOpen = false;
  s.halfOpenProbeInFlight = false;

  if (s.consecutiveFailures >= CIRCUIT_OPEN_THRESHOLD && s.openedAt === null) {
    s.openedAt = Date.now();
    console.warn(
      JSON.stringify({
        scope:              "circuit-breaker",
        code:               "CIRCUIT_OPENED",
        provider,
        consecutiveFailures: s.consecutiveFailures,
        cooldownMs:          COOLDOWN_MS,
        hint:               `${provider} disabled for ${COOLDOWN_MS / 1_000}s — too many consecutive failures`,
      }),
    );
  } else if (s.openedAt !== null) {
    // Already open — reset cooldown timer on each new failure so the circuit
    // stays open until the provider actually recovers.
    s.openedAt = Date.now();
  }
}

/**
 * Record a provider call success.  Closes the circuit and resets the failure
 * counter; logs the transition if the circuit was open.
 */
export function recordCircuitSuccess(provider: string): void {
  const s = _circuits.get(provider);
  if (!s) return;

  const wasOpen = s.openedAt !== null;
  s.consecutiveFailures = 0;
  s.openedAt = null;
  s.halfOpen = false;
  s.halfOpenProbeInFlight = false;

  if (wasOpen) {
    console.info(
      JSON.stringify({
        scope:   "circuit-breaker",
        code:    "CIRCUIT_CLOSED",
        provider,
        hint:    `${provider} re-enabled after successful probe`,
      }),
    );
  }
}

/**
 * Return the current circuit state for a provider.
 * Used by /api/ai/metrics to expose runtime health.
 */
export function getCircuitState(provider: string): {
  open: boolean;
  halfOpen: boolean;
  consecutiveFailures: number;
  cooldownRemainingMs: number | null;
} {
  const s = _circuits.get(provider);
  if (!s) {
    return { open: false, halfOpen: false, consecutiveFailures: 0, cooldownRemainingMs: null };
  }

  const open =
    s.openedAt !== null && Date.now() - s.openedAt < COOLDOWN_MS;
  const cooldownRemainingMs =
    open && s.openedAt !== null
      ? Math.max(0, COOLDOWN_MS - (Date.now() - s.openedAt))
      : null;

  return {
    open,
    halfOpen:           s.halfOpen,
    consecutiveFailures: s.consecutiveFailures,
    cooldownRemainingMs,
  };
}

/** Force-reset all circuit state (test helper only). */
export function _resetCircuitsForTest(): void {
  _circuits.clear();
}
