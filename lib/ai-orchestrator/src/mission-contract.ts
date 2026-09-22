import { z } from "zod";
import {
  RecipeApprovedPathSchema,
  RecipeIdSchema,
} from "./recipe-contract.js";
import { RecipeVersionSchema } from "./capability-contract.js";

/**
 * Server-validated contract for the next durable action of an AI Goal.
 *
 * The contract describes business intent only. Runtime identities, leases,
 * roots, revisions, command profiles, and credentials are supplied by the
 * server when the action is dispatched.
 */
export const MISSION_CONTRACT_VERSION = 1 as const;

const GoalTaskActionSchema = z.object({
  kind: z.literal("task"),
  taskId: z.string().min(1).max(200),
  purpose: z.enum(["activation", "execution"]).optional(),
}).strict();

const GoalRecipeActionSchema = z.object({
  kind: z.literal("recipe"),
  recipeId: RecipeIdSchema,
  recipeVersion: RecipeVersionSchema,
  approvedPaths: z.array(RecipeApprovedPathSchema).max(48).default([]),
  candidateIdentity: z.string().min(1).max(160).nullable().optional(),
}).strict();

const GoalWaitActionSchema = z.object({
  kind: z.literal("wait"),
  reason: z.enum(["approval", "event", "schedule"]),
  wakeAt: z.string().datetime().nullable(),
}).strict();

const GoalReplanActionSchema = z.object({
  kind: z.literal("replan"),
  reason: z.string().trim().min(1).max(5_000),
}).strict();

export const GoalNextActionSchema = z.discriminatedUnion("kind", [
  GoalTaskActionSchema,
  GoalRecipeActionSchema,
  GoalWaitActionSchema,
  GoalReplanActionSchema,
]);

export type GoalNextAction = z.infer<typeof GoalNextActionSchema>;

export function parseGoalNextAction(value: unknown): GoalNextAction | undefined {
  const parsed = GoalNextActionSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}