/**
 * Request-owned execution budget and telemetry.
 *
 * This is intentionally separate from the evidence RunLedger. Evidence
 * describes what was proven; this ledger controls how much work one logical
 * request may perform across all orchestration seams.
 */

export type ExecutionMode =
  | "simple_chat"
  | "tool_chat"
  | "forensic"
  | "repair_plan"
  | "hierarchical";

export type ExecutionAttemptKind =
  | "model"
  | "tool"
  | "planner"
  | "provider_change"
  | "synthesis"
  | "recovery"
  | "hierarchical_task";

export type ExecutionTerminalReason =
  | "completed"
  | "cancelled"
  | "deadline"
  | "model_budget"
  | "tool_budget"
  | "recovery_budget"
  | "provider_exhausted"
  | "failed";

export type ExecutionLedgerBudget = {
  deadlineMs: number;
  modelCalls: number;
  toolCalls: number;
  providerChanges: number;
  synthesisAttempts: number;
  recoveryAttempts: number;
  plannerCalls: number;
  hierarchicalTasks: number;
};

export type ExecutionLedgerEvent = {
  kind: ExecutionAttemptKind | "terminal";
  status: "started" | "completed" | "rejected" | "failed";
  at: number;
  durationMs?: number;
  provider?: string;
  model?: string;
  operation?: string;
  reason?: string;
};

export type ExecutionLedgerSnapshot = {
  id: string;
  mode: ExecutionMode;
  startedAt: number;
  deadlineAt: number;
  elapsedMs: number;
  remainingMs: number;
  budget: ExecutionLedgerBudget;
  counts: Record<ExecutionAttemptKind, number>;
  providers: string[];
  models: string[];
  terminalReason?: ExecutionTerminalReason;
  events: ExecutionLedgerEvent[];
};

export type ExecutionLedger = {
  readonly id: string;
  readonly mode: ExecutionMode;
  readonly signal: AbortSignal;
  readonly startedAt: number;
  readonly deadlineAt: number;
  admit(
    kind: ExecutionAttemptKind,
    details?: { provider?: string; model?: string; operation?: string },
  ): boolean;
  complete(
    kind: ExecutionAttemptKind,
    details?: {
      provider?: string;
      model?: string;
      operation?: string;
      startedAt?: number;
      status?: "completed" | "failed";
      reason?: string;
    },
  ): void;
  timeoutMs(requested?: number): number;
  isExhausted(): boolean;
  setTerminal(reason: ExecutionTerminalReason): void;
  snapshot(): ExecutionLedgerSnapshot;
};

const DEFAULT_BUDGET: ExecutionLedgerBudget = {
  deadlineMs: 120_000,
  modelCalls: 128,
  toolCalls: 360,
  providerChanges: 4,
  synthesisAttempts: 3,
  recoveryAttempts: 8,
  plannerCalls: 1,
  hierarchicalTasks: 8,
};

const KIND_TO_BUDGET: Record<ExecutionAttemptKind, keyof ExecutionLedgerBudget> = {
  model: "modelCalls",
  tool: "toolCalls",
  provider_change: "providerChanges",
  synthesis: "synthesisAttempts",
  recovery: "recoveryAttempts",
  planner: "plannerCalls",
  hierarchical_task: "hierarchicalTasks",
};

let ledgerSequence = 0;

export function createExecutionLedger(options?: {
  mode?: ExecutionMode;
  budget?: Partial<ExecutionLedgerBudget>;
  signal?: AbortSignal;
  id?: string;
}): ExecutionLedger {
  const startedAt = Date.now();
  const budget: ExecutionLedgerBudget = {
    ...DEFAULT_BUDGET,
    ...options?.budget,
    deadlineMs: Math.max(1_000, Math.floor(options?.budget?.deadlineMs ?? DEFAULT_BUDGET.deadlineMs)),
  };
  const deadlineAt = startedAt + budget.deadlineMs;
  const controller = new AbortController();
  const abortFromParent = () => controller.abort();
  if (options?.signal?.aborted) controller.abort();
  else options?.signal?.addEventListener("abort", abortFromParent, { once: true });
  const timer = setTimeout(() => controller.abort(), budget.deadlineMs);
  timer.unref?.();

  const id = options?.id ?? `execution-${startedAt}-${++ledgerSequence}`;
  const mode = options?.mode ?? "tool_chat";
  const counts = {
    model: 0,
    tool: 0,
    planner: 0,
    provider_change: 0,
    synthesis: 0,
    recovery: 0,
    hierarchical_task: 0,
  } satisfies Record<ExecutionAttemptKind, number>;
  const events: ExecutionLedgerEvent[] = [];
  const providers: string[] = [];
  const models: string[] = [];
  let terminalReason: ExecutionTerminalReason | undefined;

  const remember = (list: string[], value?: string) => {
    if (value && !list.includes(value) && list.length < 16) list.push(value);
  };
  const currentReason = (): ExecutionTerminalReason | undefined => {
    if (terminalReason) return terminalReason;
    if (controller.signal.aborted) {
      return Date.now() >= deadlineAt ? "deadline" : "cancelled";
    }
    return undefined;
  };
  const rejectReason = (kind: ExecutionAttemptKind): ExecutionTerminalReason => {
    if (controller.signal.aborted) return Date.now() >= deadlineAt ? "deadline" : "cancelled";
    if (kind === "tool") return "tool_budget";
    if (kind === "recovery" || kind === "synthesis") return "recovery_budget";
    if (kind === "provider_change") return "provider_exhausted";
    return "model_budget";
  };

  const ledger: ExecutionLedger = {
    id,
    mode,
    signal: controller.signal,
    startedAt,
    deadlineAt,
    admit(kind, details) {
      const now = Date.now();
      const budgetKey = KIND_TO_BUDGET[kind];
      const current = counts[kind];
      const limit = budget[budgetKey];
      const reason = currentReason();
      if (reason || current >= limit || now >= deadlineAt) {
        const terminal = reason ?? rejectReason(kind);
        events.push({
          kind,
          status: "rejected",
          at: now,
          ...details,
          reason: terminal,
        });
        if (!terminalReason) terminalReason = terminal;
        if (events.length > 256) events.splice(0, events.length - 256);
        return false;
      }
      counts[kind] += 1;
      remember(providers, details?.provider);
      remember(models, details?.model);
      events.push({ kind, status: "started", at: now, ...details });
      if (events.length > 256) events.splice(0, events.length - 256);
      return true;
    },
    complete(kind, details) {
      const at = Date.now();
      remember(providers, details?.provider);
      remember(models, details?.model);
      events.push({
        kind,
        status: details?.status ?? "completed",
        at,
        ...(details?.provider ? { provider: details.provider } : {}),
        ...(details?.model ? { model: details.model } : {}),
        ...(details?.operation ? { operation: details.operation } : {}),
        ...(details?.startedAt !== undefined
          ? { durationMs: Math.max(0, at - details.startedAt) }
          : {}),
        ...(details?.reason ? { reason: details.reason.slice(0, 160) } : {}),
      });
      if (events.length > 256) events.splice(0, events.length - 256);
    },
    timeoutMs(requested) {
      const remaining = Math.max(1, deadlineAt - Date.now());
      return Math.max(1, Math.min(Math.floor(requested ?? remaining), remaining));
    },
    isExhausted() {
      return Boolean(currentReason()) || Date.now() >= deadlineAt;
    },
    setTerminal(reason) {
      if (!terminalReason) terminalReason = reason;
      events.push({ kind: "terminal", status: "completed", at: Date.now(), reason });
      if (events.length > 256) events.splice(0, events.length - 256);
      clearTimeout(timer);
      options?.signal?.removeEventListener("abort", abortFromParent);
    },
    snapshot() {
      const now = Date.now();
      return {
        id,
        mode,
        startedAt,
        deadlineAt,
        elapsedMs: Math.max(0, now - startedAt),
        remainingMs: Math.max(0, deadlineAt - now),
        budget: { ...budget },
        counts: { ...counts },
        providers: [...providers],
        models: [...models],
        ...(terminalReason || currentReason()
          ? { terminalReason: terminalReason ?? currentReason() }
          : {}),
        events: events.map((event) => ({ ...event })),
      };
    },
  };
  return ledger;
}