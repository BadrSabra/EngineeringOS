const TASK_DISPATCH_IN_FLIGHT_STATUSES = new Set(['queued', 'running', 'verifying']);

/**
 * Keep collapsed Task cards current while a Task is already in the execution
 * lifecycle. Plain pending Tasks may be intentionally idle, so they must not
 * keep the project list polling.
 */
export function shouldPollTaskDispatchList(tasks: unknown): boolean {
  if (!Array.isArray(tasks)) return false;

  return tasks.some((task: unknown) => {
    if (!task || typeof task !== 'object' || Array.isArray(task)) return false;
    const status = (task as { status?: unknown }).status;
    return typeof status === 'string' && TASK_DISPATCH_IN_FLIGHT_STATUSES.has(status);
  });
}
