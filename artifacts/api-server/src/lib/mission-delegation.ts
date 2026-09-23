import { z } from "zod";

export const MISSION_DELEGATION_CONTRACT_VERSION = 1 as const;

export const MissionDelegationTriggerSchema = z.enum([
  "activation",
  "wake",
  "resume",
  "replan",
]);

export const MissionDelegationBindingSchema = z.object({
  contractVersion: z.literal(MISSION_DELEGATION_CONTRACT_VERSION),
  missionId: z.string().min(1).max(160),
  goalId: z.string().min(1).max(160),
  taskId: z.string().min(1).max(160).nullable(),
  parentExecutionId: z.string().min(1).max(160).nullable(),
  planRevision: z.string().min(1).max(240).nullable(),
  userId: z.string().min(1).max(240),
  trigger: MissionDelegationTriggerSchema,
}).strict();

export type MissionDelegationBinding = z.infer<typeof MissionDelegationBindingSchema>;

export type MissionDelegationValidation = {
  allowed: boolean;
  reason:
    | "allowed"
    | "invalid_binding"
    | "mission_mismatch"
    | "goal_mismatch"
    | "task_mismatch"
    | "parent_execution_mismatch"
    | "user_mismatch"
    | "plan_revision_mismatch";
  detail: string;
};

export function buildMissionDelegationBinding(params: {
  missionId: string;
  goalId: string;
  taskId?: string | null;
  parentExecutionId?: string | null;
  planRevision?: string | null;
  userId: string;
  trigger: MissionDelegationBinding["trigger"];
}): MissionDelegationBinding {
  return MissionDelegationBindingSchema.parse({
    contractVersion: MISSION_DELEGATION_CONTRACT_VERSION,
    missionId: params.missionId,
    goalId: params.goalId,
    taskId: params.taskId ?? null,
    parentExecutionId: params.parentExecutionId ?? null,
    planRevision: params.planRevision ?? null,
    userId: params.userId,
    trigger: params.trigger,
  });
}

export function validateMissionDelegationBinding(
  value: unknown,
  expected: {
    missionId: string;
    goalId: string;
    taskId?: string | null;
    parentExecutionId?: string | null;
    userId: string;
    planRevision?: string | null;
  },
): MissionDelegationValidation {
  const parsed = MissionDelegationBindingSchema.safeParse(value);
  if (!parsed.success) {
    return {
      allowed: false,
      reason: "invalid_binding",
      detail: "Mission delegation binding is invalid.",
    };
  }
  if (parsed.data.missionId !== expected.missionId) {
    return {
      allowed: false,
      reason: "mission_mismatch",
      detail: "Mission delegation belongs to a different Mission.",
    };
  }
  if (parsed.data.goalId !== expected.goalId) {
    return {
      allowed: false,
      reason: "goal_mismatch",
      detail: "Mission delegation belongs to a different Goal.",
    };
  }
  if (expected.taskId !== undefined && parsed.data.taskId !== expected.taskId) {
    return {
      allowed: false,
      reason: "task_mismatch",
      detail: "Mission delegation belongs to a different Task.",
    };
  }
  if (
    expected.parentExecutionId !== undefined
    && parsed.data.parentExecutionId !== expected.parentExecutionId
  ) {
    return {
      allowed: false,
      reason: "parent_execution_mismatch",
      detail: "Mission delegation belongs to a different parent execution.",
    };
  }
  if (parsed.data.userId !== expected.userId) {
    return {
      allowed: false,
      reason: "user_mismatch",
      detail: "Mission delegation belongs to a different owner.",
    };
  }
  if (expected.planRevision !== undefined && parsed.data.planRevision !== expected.planRevision) {
    return {
      allowed: false,
      reason: "plan_revision_mismatch",
      detail: "Mission delegation belongs to a stale plan revision.",
    };
  }
  return {
    allowed: true,
    reason: "allowed",
    detail: "Mission delegation binding is server-owned and valid.",
  };
}