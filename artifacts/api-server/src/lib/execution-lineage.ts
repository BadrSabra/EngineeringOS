import { z } from "zod";

export const EXECUTION_LINEAGE_CONTRACT_VERSION = 1 as const;

export const ExecutionDelegationBudgetSchema = z.object({
  maxChildren: z.number().int().min(1).max(32),
  maxDepth: z.number().int().min(0).max(8),
  maxToolCalls: z.number().int().min(0).max(10_000).optional(),
  maxProviderTokens: z.number().int().min(0).max(2_000_000).optional(),
}).strict();

export const ExecutionLineageSchema = z.object({
  contractVersion: z.literal(EXECUTION_LINEAGE_CONTRACT_VERSION),
  delegationId: z.string().min(1).max(160),
  rootExecutionId: z.string().min(1).max(160),
  parentExecutionId: z.string().min(1).max(160).nullable(),
  depth: z.number().int().min(0).max(8),
  budget: ExecutionDelegationBudgetSchema,
}).strict();

export type ExecutionDelegationBudget = z.infer<typeof ExecutionDelegationBudgetSchema>;
export type ExecutionLineage = z.infer<typeof ExecutionLineageSchema>;

export function buildExecutionLineage(params: {
  executionId: string;
  parent?: {
    executionId: string;
    rootExecutionId?: string | null;
    delegationId?: string | null;
    depth?: number | null;
    budget?: unknown;
  } | null;
  budget?: Partial<ExecutionDelegationBudget>;
}): ExecutionLineage {
  const parent = params.parent ?? null;
  const depth = (parent?.depth ?? -1) + 1;
  const parentBudget = parent?.budget && typeof parent.budget === "object"
    && !Array.isArray(parent.budget)
    ? parent.budget as { maxChildren?: unknown; maxDepth?: unknown }
    : undefined;
  const budget = ExecutionDelegationBudgetSchema.parse({
    maxChildren: params.budget?.maxChildren
      ?? (typeof parentBudget?.maxChildren === "number" ? parentBudget.maxChildren : 8),
    maxDepth: params.budget?.maxDepth
      ?? (typeof parentBudget?.maxDepth === "number" ? parentBudget.maxDepth : 4),
    ...(params.budget?.maxToolCalls !== undefined
      ? { maxToolCalls: params.budget.maxToolCalls }
      : {}),
    ...(params.budget?.maxProviderTokens !== undefined
      ? { maxProviderTokens: params.budget.maxProviderTokens }
      : {}),
  });
  if (depth > budget.maxDepth) {
    throw new Error("Delegation depth exceeds the server-owned budget.");
  }
  return ExecutionLineageSchema.parse({
    contractVersion: EXECUTION_LINEAGE_CONTRACT_VERSION,
    delegationId: parent?.delegationId ?? `delegation:${params.executionId}`,
    rootExecutionId: parent?.rootExecutionId ?? params.executionId,
    parentExecutionId: parent?.executionId ?? null,
    depth,
    budget,
  });
}

export type DelegatedExecutionSummary = {
  total: number;
  completed: number;
  failed: number;
  incomplete: number;
  running: number;
  totalToolCalls: number;
  totalProviderTokens: number;
  verdict: "PROVEN" | "INCOMPLETE" | "UNAVAILABLE";
};

export function aggregateDelegatedExecutionSummary(
  children: ReadonlyArray<{
    status: string;
    checkpoint?: string | null;
    acceptance?: { outcome?: string | null; disposition?: unknown } | null;
  }>,
): DelegatedExecutionSummary {
  let totalToolCalls = 0;
  let totalProviderTokens = 0;
  for (const child of children) {
    try {
      const checkpoint = child.checkpoint ? JSON.parse(child.checkpoint) as Record<string, unknown> : {};
      const telemetry = checkpoint.telemetry;
      if (telemetry && typeof telemetry === "object" && !Array.isArray(telemetry)) {
        const record = telemetry as Record<string, unknown>;
        if (typeof record.toolCalls === "number") totalToolCalls += Math.max(0, Math.trunc(record.toolCalls));
        if (typeof record.providerTokens === "number") totalProviderTokens += Math.max(0, Math.trunc(record.providerTokens));
      }
    } catch {
      // A malformed checkpoint contributes no usage but never grants proof.
    }
  }
  const completed = children.filter((child) => child.status === "completed").length;
  const failed = children.filter((child) => child.status === "failed" || child.status === "cancelled").length;
  const running = children.filter((child) => ["queued", "running", "paused", "cancelling"].includes(child.status)).length;
  const incomplete = children.length - completed - failed - running;
  const proven = children.length > 0
    && completed === children.length
    && children.every((child) => child.acceptance?.outcome === "SUCCEEDED");
  return {
    total: children.length,
    completed,
    failed,
    incomplete: Math.max(0, incomplete),
    running,
    totalToolCalls,
    totalProviderTokens,
    verdict: proven ? "PROVEN" : children.length === 0 || failed > 0 ? "UNAVAILABLE" : "INCOMPLETE",
  };
}