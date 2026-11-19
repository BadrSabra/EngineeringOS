import { inArray } from "drizzle-orm";
import { db, tasksTable } from "@workspace/db";

export type TaskDependencyTransaction =
  Parameters<Parameters<typeof db.transaction>[0]>[0];

export type TaskDependencyBlocker = {
  taskId: string;
  reason: "dependency_unavailable" | "dependency_not_completed";
  status?: string;
};

export class TaskDependencyBlockedError extends Error {
  constructor(readonly blockers: TaskDependencyBlocker[]) {
    super("Task dependencies must be completed before execution can start.");
    this.name = "TaskDependencyBlockedError";
  }
}

export function duplicateTaskDependencyIds(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  return [...duplicates];
}

/**
 * Return dependency IDs that are missing or belong to another project.
 * Lock the referenced rows so a concurrent delete cannot invalidate a
 * dependency between validation and the dependent task's commit.
 */
export async function invalidTaskDependencyReferences(
  tx: TaskDependencyTransaction,
  projectId: string,
  dependencyIds: readonly string[],
): Promise<string[]> {
  const ids = [...new Set(dependencyIds)];
  if (ids.length === 0) return [];

  const rows = await tx
    .select({
      id: tasksTable.id,
      projectId: tasksTable.projectId,
    })
    .from(tasksTable)
    .where(inArray(tasksTable.id, ids))
    .for("update");

  const validIds = new Set(
    rows.filter((row) => row.projectId === projectId).map((row) => row.id),
  );
  return ids.filter((id) => !validIds.has(id));
}

/**
 * A task is runnable only after every dependency exists in the same project
 * and has reached the terminal "completed" state. Missing/foreign references
 * fail closed as unavailable rather than leaking another project's task.
 */
export async function getTaskDependencyBlockers(
  tx: TaskDependencyTransaction,
  task: {
    projectId: string;
    dependsOn: string[] | null;
  },
): Promise<TaskDependencyBlocker[]> {
  const dependencyIds = [...new Set(task.dependsOn ?? [])];
  if (dependencyIds.length === 0) return [];

  const rows = await tx
    .select({
      id: tasksTable.id,
      projectId: tasksTable.projectId,
      status: tasksTable.status,
    })
    .from(tasksTable)
    .where(inArray(tasksTable.id, dependencyIds))
    .for("update");
  const byId = new Map(rows.map((row) => [row.id, row]));

  return dependencyIds.flatMap((taskId) => {
    const dependency = byId.get(taskId);
    if (!dependency || dependency.projectId !== task.projectId) {
      return [{ taskId, reason: "dependency_unavailable" as const }];
    }
    if (dependency.status !== "completed") {
      return [{
        taskId,
        reason: "dependency_not_completed" as const,
        status: dependency.status,
      }];
    }
    return [];
  });
}
