import { and, eq, inArray, isNull, lt, or } from "drizzle-orm";
import {
  db,
  workspaceRuntimeTable,
  type WorkspaceRuntime,
} from "@workspace/db";

export const RUNTIME_LEASE_MS = 30_000;

export type RuntimeStorePatch = Partial<Pick<
  WorkspaceRuntime,
  | "status"
  | "sessionId"
  | "revision"
  | "port"
  | "pid"
  | "workerId"
  | "leaseUntil"
  | "lastHeartbeatAt"
  | "startedAt"
  | "stoppedAt"
  | "error"
  | "logs"
>> & { updatedAt?: Date };

export interface WorkspaceRuntimeStore {
  get(projectId: string): Promise<WorkspaceRuntime | undefined>;
  begin(input: {
    projectId: string;
    projectRoot: string;
    sessionId: string;
    revision: string;
    workerId: string;
    now: Date;
    leaseUntil: Date;
  }): Promise<WorkspaceRuntime | undefined>;
  claimRecovery(input: {
    id: string;
    workerId: string;
    now: Date;
    leaseUntil: Date;
  }): Promise<WorkspaceRuntime | undefined>;
  updateOwned(projectId: string, workerId: string, patch: RuntimeStorePatch): Promise<boolean>;
  releaseWorker(workerId: string): Promise<void>;
  listRecoverable(now: Date): Promise<WorkspaceRuntime[]>;
}

export const databaseWorkspaceRuntimeStore: WorkspaceRuntimeStore = {
  async get(projectId) {
    const [row] = await db
      .select()
      .from(workspaceRuntimeTable)
      .where(eq(workspaceRuntimeTable.projectId, projectId))
      .limit(1);
    return row;
  },

  async begin(input) {
    const activeLease = and(
      isNull(workspaceRuntimeTable.leaseUntil),
      eq(workspaceRuntimeTable.workerId, input.workerId),
    );
    const takeover = or(
      isNull(workspaceRuntimeTable.leaseUntil),
      lt(workspaceRuntimeTable.leaseUntil, input.now),
      eq(workspaceRuntimeTable.workerId, input.workerId),
      inArray(workspaceRuntimeTable.status, ["stopped", "failed"]),
    );
    const [row] = await db
      .insert(workspaceRuntimeTable)
      .values({
        id: input.projectId,
        projectId: input.projectId,
        sessionId: input.sessionId,
        status: "starting",
        profile: "dev",
        command: "pnpm run dev",
        projectRoot: input.projectRoot,
        revision: input.revision,
        port: null,
        pid: null,
        workerId: input.workerId,
        leaseUntil: input.leaseUntil,
        lastHeartbeatAt: input.now,
        startedAt: input.now,
        stoppedAt: null,
        error: null,
        logs: [],
        updatedAt: input.now,
      })
      .onConflictDoUpdate({
        target: workspaceRuntimeTable.projectId,
        set: {
          sessionId: input.sessionId,
          status: "starting",
          projectRoot: input.projectRoot,
          revision: input.revision,
          port: null,
          pid: null,
          workerId: input.workerId,
          leaseUntil: input.leaseUntil,
          lastHeartbeatAt: input.now,
          startedAt: input.now,
          stoppedAt: null,
          error: null,
          logs: [],
          updatedAt: input.now,
        },
        where: or(takeover, activeLease),
      })
      .returning();
    return row;
  },

  async claimRecovery(input) {
    const [row] = await db
      .update(workspaceRuntimeTable)
      .set({
        workerId: input.workerId,
        leaseUntil: input.leaseUntil,
        lastHeartbeatAt: input.now,
        updatedAt: input.now,
      })
      .where(and(
        eq(workspaceRuntimeTable.id, input.id),
        inArray(workspaceRuntimeTable.status, ["starting", "running"]),
        or(
          isNull(workspaceRuntimeTable.workerId),
          isNull(workspaceRuntimeTable.leaseUntil),
          lt(workspaceRuntimeTable.leaseUntil, input.now),
        ),
      ))
      .returning();
    return row;
  },

  async updateOwned(projectId, workerId, patch) {
    const [row] = await db
      .update(workspaceRuntimeTable)
      .set({ ...patch, updatedAt: patch.updatedAt ?? new Date() })
      .where(and(
        eq(workspaceRuntimeTable.projectId, projectId),
        eq(workspaceRuntimeTable.workerId, workerId),
      ))
      .returning({ id: workspaceRuntimeTable.id });
    return Boolean(row);
  },

  async releaseWorker(workerId) {
    await db
      .update(workspaceRuntimeTable)
      .set({
        workerId: null,
        leaseUntil: null,
        lastHeartbeatAt: null,
        updatedAt: new Date(),
      })
      .where(eq(workspaceRuntimeTable.workerId, workerId));
  },

  async listRecoverable(now) {
    return db
      .select()
      .from(workspaceRuntimeTable)
      .where(and(
        inArray(workspaceRuntimeTable.status, ["starting", "running"]),
        or(
          isNull(workspaceRuntimeTable.workerId),
          isNull(workspaceRuntimeTable.leaseUntil),
          lt(workspaceRuntimeTable.leaseUntil, now),
        ),
      ));
  },
};

export function createInMemoryWorkspaceRuntimeStore(): WorkspaceRuntimeStore {
  const rows = new Map<string, WorkspaceRuntime>();
  return {
    async get(projectId) {
      return rows.get(projectId);
    },
    async begin(input) {
      const existing = rows.get(input.projectId);
      const blocked = existing
        && ["starting", "running"].includes(existing.status)
        && existing.workerId !== input.workerId
        && existing.leaseUntil !== null
        && existing.leaseUntil > input.now;
      if (blocked) return undefined;
      const row: WorkspaceRuntime = {
        id: existing?.id ?? input.projectId,
        projectId: input.projectId,
        sessionId: input.sessionId,
        status: "starting",
        profile: "dev",
        command: "pnpm run dev",
        projectRoot: input.projectRoot,
        revision: input.revision,
        port: null,
        pid: null,
        workerId: input.workerId,
        leaseUntil: input.leaseUntil,
        lastHeartbeatAt: input.now,
        startedAt: input.now,
        stoppedAt: null,
        error: null,
        logs: [],
        createdAt: existing?.createdAt ?? input.now,
        updatedAt: input.now,
      };
      rows.set(input.projectId, row);
      return row;
    },
    async claimRecovery(input) {
      const row = [...rows.values()].find((candidate) => candidate.id === input.id);
      if (!row || !["starting", "running"].includes(row.status)) return undefined;
      if (row.workerId && row.workerId !== input.workerId && row.leaseUntil && row.leaseUntil > input.now) {
        return undefined;
      }
      row.workerId = input.workerId;
      row.leaseUntil = input.leaseUntil;
      row.lastHeartbeatAt = input.now;
      row.updatedAt = input.now;
      return row;
    },
    async updateOwned(projectId, workerId, patch) {
      const row = rows.get(projectId);
      if (!row || row.workerId !== workerId) return false;
      Object.assign(row, patch, { updatedAt: patch.updatedAt ?? new Date() });
      return true;
    },
    async releaseWorker(workerId) {
      for (const row of rows.values()) {
        if (row.workerId !== workerId) continue;
        row.workerId = null;
        row.leaseUntil = null;
        row.lastHeartbeatAt = null;
        row.updatedAt = new Date();
      }
    },
    async listRecoverable(now) {
      return [...rows.values()].filter((row) =>
        ["starting", "running"].includes(row.status)
        && (!row.workerId || !row.leaseUntil || row.leaseUntil <= now),
      );
    },
  };
}