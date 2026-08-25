export type TaskStatus =
  | "pending"
  | "queued"
  | "running"
  | "verifying"
  | "completed"
  | "failed"
  | "cancelled";

export type TaskTransitionActor =
  | "manual"
  | "execution"
  | "verification"
  | "retry"
  | "reconciliation"
  | "cancellation";

const transitions: Record<TaskTransitionActor, ReadonlySet<string>> = {
  manual: new Set(["pending->queued", "pending->verifying", "queued->verifying"]),
  execution: new Set(["pending->running", "queued->running", "verifying->running", "running->completed", "running->failed", "running->verifying"]),
  verification: new Set(["running->completed", "running->failed", "running->verifying"]),
  retry: new Set(["failed->queued", "cancelled->queued"]),
  reconciliation: new Set(["running->verifying", "running->failed"]),
  cancellation: new Set(["pending->cancelled", "queued->cancelled", "verifying->cancelled", "failed->cancelled"]),
};

export function canTransitionTaskStatus(
  from: TaskStatus,
  to: TaskStatus,
  actor: TaskTransitionActor,
): boolean {
  return from === to || transitions[actor].has(`${from}->${to}`);
}

export function taskTransitionConflict(
  from: TaskStatus,
  to: TaskStatus,
  actor: TaskTransitionActor,
): string | undefined {
  if (canTransitionTaskStatus(from, to, actor)) return undefined;
  return `Illegal task status transition "${from}" → "${to}"`;
}