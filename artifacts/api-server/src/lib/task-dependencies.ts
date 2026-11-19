import { asc, inArray } from "drizzle-orm";
import { db, tasksTable } from "@workspace/db";

export type TaskDependencyTransaction =
  Parameters<Parameters<typeof db.transaction>[0]>[0];

export type TaskDependencyBlocker = {
  taskId: string;
  reason:
    | "dependency_unavailable"
    | "dependency_not_completed"
    | "dependency_cycle"
    | "dependency_graph_too_large";
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
    .orderBy(asc(tasksTable.id))
    .for("update");

  const validIds = new Set(
    rows.filter((row) => row.projectId === projectId).map((row) => row.id),
  );
  return ids.filter((id) => !validIds.has(id));
}

const MAX_TASK_DEPENDENCY_NODES = 256;

/**
 * A Task is runnable only when its complete prerequisite chain is valid and
 * completed. Walk the transitive graph because legacy Tasks may have been
 * marked completed before dependency admission was enforced.
 *
 * Every batch is locked in stable ID order. Missing/foreign references,
 * cycles, and oversized graphs fail closed instead of silently truncating.
 */
export async function getTaskDependencyBlockers(
  tx: TaskDependencyTransaction,
  task: {
    id: string;
    projectId: string;
    dependsOn: string[] | null;
  },
): Promise<TaskDependencyBlocker[]> {
  const root: {
    id: string;
    projectId: string;
    status: string;
    dependsOn: string[] | null;
  } = {
    id: task.id,
    projectId: task.projectId,
    status: "running",
    dependsOn: task.dependsOn,
  };
  const nodes = new Map<string, typeof root>([[root.id, root]]);
  const requested = new Set<string>([root.id]);
  let frontier = [...new Set(task.dependsOn ?? [])];
  const blockers: TaskDependencyBlocker[] = [];

  while (frontier.length > 0) {
    const batch = [...new Set(frontier)].filter((id) => !requested.has(id)).sort();
    frontier = [];
    if (batch.length === 0) break;

    if (nodes.size + batch.length > MAX_TASK_DEPENDENCY_NODES + 1) {
      blockers.push({
        taskId: root.id,
        reason: "dependency_graph_too_large",
      });
      break;
    }

    for (const id of batch) requested.add(id);

    const rows = await tx
      .select({
        id: tasksTable.id,
        projectId: tasksTable.projectId,
        status: tasksTable.status,
        dependsOn: tasksTable.dependsOn,
      })
      .from(tasksTable)
      .where(inArray(tasksTable.id, batch))
      .orderBy(asc(tasksTable.id))
      .for("update");

    const rowsById = new Map(rows.map((row) => [row.id, row]));
    for (const id of batch) {
      const dependency = rowsById.get(id);
      if (!dependency || dependency.projectId !== task.projectId) {
        blockers.push({ taskId: id, reason: "dependency_unavailable" });
        continue;
      }
      nodes.set(id, dependency);
      for (const parentId of dependency.dependsOn ?? []) {
        if (!requested.has(parentId)) frontier.push(parentId);
      }
    }
  }

  for (const dependency of nodes.values()) {
    if (dependency.id === root.id) continue;
    if (dependency.status !== "completed") {
      blockers.push({
        taskId: dependency.id,
        reason: "dependency_not_completed",
        status: dependency.status,
      });
    }
  }

  // A cycle is invalid even when every row has a legacy "completed" status.
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const findCycle = (id: string, path: string[]): string[] | null => {
    if (visiting.has(id)) {
      const start = path.indexOf(id);
      return start >= 0 ? [...path.slice(start), id] : [id, id];
    }
    if (visited.has(id)) return null;

    visiting.add(id);
    const node = nodes.get(id);
    for (const parentId of node?.dependsOn ?? []) {
      if (!nodes.has(parentId)) continue;
      const cycle = findCycle(parentId, [...path, id]);
      if (cycle) return cycle;
    }
    visiting.delete(id);
    visited.add(id);
    return null;
  };

  for (const id of nodes.keys()) {
    const cycle = findCycle(id, []);
    if (cycle) {
      blockers.push({ taskId: cycle[0] ?? root.id, reason: "dependency_cycle" });
      break;
    }
  }

  const unique = new Map<string, TaskDependencyBlocker>();
  for (const blocker of blockers) {
    unique.set(`${blocker.reason}:${blocker.taskId}`, blocker);
  }
  return [...unique.values()].sort(
    (left, right) => left.taskId.localeCompare(right.taskId)
      || left.reason.localeCompare(right.reason),
  );
}
