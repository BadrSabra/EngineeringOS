import { z } from "zod";
import {
  CapabilityIdSchema,
  RecipeVersionSchema,
  type RecipeVersion,
} from "./capability-contract.js";

/**
 * Recipe input is a request for business intent only. The strict schemas in
 * this file intentionally have no command, argv, cwd, environment, profile,
 * timeout, retry, or process-control fields.
 */
export const RECIPE_CONTRACT_VERSION = 1 as const;

export const RecipeIdSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, "recipe IDs must be safe identifiers");
export type RecipeId = z.infer<typeof RecipeIdSchema>;

export const RecipeNodeIdSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z][A-Za-z0-9._:-]*$/, "recipe node IDs must be safe identifiers");
export type RecipeNodeId = z.infer<typeof RecipeNodeIdSchema>;

export const RecipeOutputNameSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z][A-Za-z0-9._:-]*$/, "recipe output names must be safe identifiers");
export type RecipeOutputName = z.infer<typeof RecipeOutputNameSchema>;

const RequiredRecipeValueSchema = z.custom<unknown>(
  (value) => value !== undefined,
  "recipe values must be present",
);

const RecipeNodeStatusSchema = z.enum(["queued", "running", "passed", "failed", "blocked"]);
export type RecipeNodeStatus = z.infer<typeof RecipeNodeStatusSchema>;

export type EvidencePredicate =
  | { kind: "node_status"; nodeId: string; status: RecipeNodeStatus }
  | { kind: "output_present"; nodeId: string; output: string }
  | { kind: "output_equals"; nodeId: string; output: string; value: unknown }
  | { kind: "evidence"; nodeId: string; evidenceType: "validation_passed" | "browser_verified" | "artifact_retained" }
  | { kind: "all"; predicates: EvidencePredicate[] }
  | { kind: "any"; predicates: EvidencePredicate[] }
  | { kind: "not"; predicate: EvidencePredicate };

export const EvidencePredicateSchema = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("node_status"),
      nodeId: RecipeNodeIdSchema,
      status: RecipeNodeStatusSchema,
    }).strict(),
    z.object({
      kind: z.literal("output_present"),
      nodeId: RecipeNodeIdSchema,
      output: RecipeOutputNameSchema,
    }).strict(),
    z.object({
      kind: z.literal("output_equals"),
      nodeId: RecipeNodeIdSchema,
      output: RecipeOutputNameSchema,
      value: RequiredRecipeValueSchema,
    }).strict(),
    z.object({
      kind: z.literal("evidence"),
      nodeId: RecipeNodeIdSchema,
      evidenceType: z.enum(["validation_passed", "browser_verified", "artifact_retained"]),
    }).strict(),
    z.object({
      kind: z.literal("all"),
      predicates: z.array(z.lazy(() => EvidencePredicateSchema)).min(1).max(4),
    }).strict(),
    z.object({
      kind: z.literal("any"),
      predicates: z.array(z.lazy(() => EvidencePredicateSchema)).min(1).max(4),
    }).strict(),
    z.object({
      kind: z.literal("not"),
      predicate: z.lazy(() => EvidencePredicateSchema),
    }).strict(),
  ]),
) as unknown as z.ZodType<EvidencePredicate>;

/** Same typed predicate after source node IDs have been namespaced by the compiler. */
export const CompiledEvidencePredicateSchema = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("node_status"),
      nodeId: z.string().min(1).max(180),
      status: RecipeNodeStatusSchema,
    }).strict(),
    z.object({
      kind: z.literal("output_present"),
      nodeId: z.string().min(1).max(180),
      output: RecipeOutputNameSchema,
    }).strict(),
    z.object({
      kind: z.literal("output_equals"),
      nodeId: z.string().min(1).max(180),
      output: RecipeOutputNameSchema,
      value: RequiredRecipeValueSchema,
    }).strict(),
    z.object({
      kind: z.literal("evidence"),
      nodeId: z.string().min(1).max(180),
      evidenceType: z.enum(["validation_passed", "browser_verified", "artifact_retained"]),
    }).strict(),
    z.object({
      kind: z.literal("all"),
      predicates: z.array(z.lazy(() => CompiledEvidencePredicateSchema)).min(1).max(4),
    }).strict(),
    z.object({
      kind: z.literal("any"),
      predicates: z.array(z.lazy(() => CompiledEvidencePredicateSchema)).min(1).max(4),
    }).strict(),
    z.object({
      kind: z.literal("not"),
      predicate: z.lazy(() => CompiledEvidencePredicateSchema),
    }).strict(),
  ]),
) as unknown as z.ZodType<EvidencePredicate>;

export const RecipeTargetSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("node"),
    nodeId: RecipeNodeIdSchema,
  }).strict(),
  z.object({
    kind: z.literal("terminal"),
    status: z.enum(["success", "failure"]),
  }).strict(),
]);
export type RecipeTarget = z.infer<typeof RecipeTargetSchema>;

export const CapabilityRecipeNodeSchema = z.object({
  id: RecipeNodeIdSchema,
  title: z.string().min(1).max(240),
  capabilityId: CapabilityIdSchema,
  recipeVersion: RecipeVersionSchema,
  input: RequiredRecipeValueSchema,
  dependsOn: z.array(RecipeNodeIdSchema).max(12).default([]),
  declaredOutputs: z.array(RecipeOutputNameSchema).max(16).default([]),
}).strict().superRefine((node, ctx) => {
  if (new Set(node.dependsOn).size !== node.dependsOn.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["dependsOn"],
      message: "node dependencies must be unique",
    });
  }
  if (new Set(node.declaredOutputs).size !== node.declaredOutputs.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["declaredOutputs"],
      message: "declared outputs must be unique",
    });
  }
});
export type CapabilityRecipeNode = z.infer<typeof CapabilityRecipeNodeSchema>;

export const RecipeTransitionSchema = z.object({
  id: RecipeNodeIdSchema,
  fromNodeId: RecipeNodeIdSchema,
  predicate: EvidencePredicateSchema,
  then: RecipeTargetSchema,
  otherwise: RecipeTargetSchema,
}).strict();
export type RecipeTransition = z.infer<typeof RecipeTransitionSchema>;

export const RecipeOutcomeOutputSchema = z.object({
  name: RecipeOutputNameSchema,
  nodeId: RecipeNodeIdSchema,
  output: RecipeOutputNameSchema,
}).strict();
export type RecipeOutcomeOutput = z.infer<typeof RecipeOutcomeOutputSchema>;

export const RecipeOutcomeContractSchema = z.object({
  success: EvidencePredicateSchema,
  outputs: z.array(RecipeOutcomeOutputSchema).max(24).default([]),
}).strict();
export type RecipeOutcomeContract = z.infer<typeof RecipeOutcomeContractSchema>;

export const CapabilityRecipeSchema = z.object({
  contractVersion: z.literal(RECIPE_CONTRACT_VERSION),
  recipeId: RecipeIdSchema,
  recipeVersion: RecipeVersionSchema,
  nodes: z.array(CapabilityRecipeNodeSchema).min(1).max(24),
  transitions: z.array(RecipeTransitionSchema).max(48).default([]),
  outcome: RecipeOutcomeContractSchema,
}).strict();
export type CapabilityRecipe = z.infer<typeof CapabilityRecipeSchema>;

/**
 * These values are written by the compiler, never accepted from a recipe.
 * They are kept in a schema so persisted plans can be checked on recovery.
 */
export const RecipeExecutionPolicySchema = z.object({
  maxNodes: z.number().int().min(1).max(24),
  maxTransitions: z.number().int().min(1).max(48),
  maxBranchesPerNode: z.number().int().min(1).max(8),
  maxPredicateDepth: z.number().int().min(1).max(12),
  maxAttempts: z.number().int().min(1).max(3),
  nodeTimeoutMs: z.number().int().min(1).max(120_000),
  maxTotalTimeoutMs: z.number().int().min(1).max(900_000),
}).strict();
export type RecipeExecutionPolicy = z.infer<typeof RecipeExecutionPolicySchema>;

export const RecipeContextSchema = z.object({
  projectId: z.string().min(1).max(160),
  rootPath: z.string().min(1).nullable().default(null),
  revision: z.string().min(1).max(240),
  operation: z.string().min(1).max(80).default("recipe"),
  scope: z.object({
    kind: z.enum(["none", "project", "paths", "file", "workspace"]),
    paths: z.array(z.string().min(1).max(500)).max(48),
  }).strict().default({ kind: "project", paths: [] }),
}).strict();
export type RecipeContext = z.infer<typeof RecipeContextSchema>;

export const CompiledRecipeTransitionSchema = z.object({
  id: z.string().min(1).max(180),
  fromNodeId: z.string().min(1).max(180),
  predicate: CompiledEvidencePredicateSchema,
  then: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("node"), nodeId: z.string().min(1).max(180) }).strict(),
    z.object({ kind: z.literal("terminal"), status: z.enum(["success", "failure"]) }).strict(),
  ]),
  otherwise: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("node"), nodeId: z.string().min(1).max(180) }).strict(),
    z.object({ kind: z.literal("terminal"), status: z.enum(["success", "failure"]) }).strict(),
  ]),
}).strict();
export type CompiledRecipeTransition = z.infer<typeof CompiledRecipeTransitionSchema>;

export const RecipeStateSchema = z.object({
  status: z.enum(["pending", "running", "succeeded", "failed", "cancelled"]),
  currentNodeId: z.string().min(1).max(180).nullable(),
  completedNodeIds: z.array(z.string().min(1).max(180)).max(24),
  outputs: z.record(z.string().min(1).max(80), z.unknown()),
}).strict();
export type RecipeState = z.infer<typeof RecipeStateSchema>;

export type RecipeEvidenceNode = {
  status: RecipeNodeStatus;
  outputs?: Readonly<Record<string, unknown>>;
  evidence?: readonly {
    type: "validation_passed" | "browser_verified" | "artifact_retained";
  }[];
};

export type RecipeEvidence = Readonly<Record<string, RecipeEvidenceNode>>;

export function recipeVersionIsSupported(version: number): version is RecipeVersion {
  return version === 1;
}