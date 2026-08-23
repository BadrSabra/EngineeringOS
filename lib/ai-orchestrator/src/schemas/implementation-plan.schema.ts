import { z } from "zod";

/**
 * A planning-only contract. Plans describe intended work and validation; they
 * never authorize writes, command execution, commits, or publishing.
 */
export const ImplementationPlanStepSchema = z.object({
  id: z.string().min(1).max(40),
  title: z.string().min(1).max(180),
  description: z.string().min(1).max(1_200),
  action: z.enum(["inspect", "create", "modify", "delete", "test", "configure"]),
  files: z.array(z.string().min(1)).max(12),
  dependsOn: z.array(z.string().min(1).max(40)).max(8).default([]),
  validation: z.array(z.string().min(1).max(240)).max(6).default([]),
}).strict();

export type ImplementationPlanStep = z.infer<typeof ImplementationPlanStepSchema>;

export const ImplementationPlanSchema = z.object({
  kind: z.literal("IMPLEMENTATION_PLAN_RESULT"),
  objective: z.string().min(1).max(500),
  summary: z.string().min(1).max(1_500),
  assumptions: z.array(z.string().min(1).max(400)).max(8).default([]),
  steps: z.array(ImplementationPlanStepSchema).max(12),
  validationCommands: z.array(z.string().min(1).max(240)).max(10).default([]),
  /** Optional server-registered UI contract; the profile expands to fixed
   * steps and origin only after the plan is approved. */
  browserValidationProfile: z.string().min(1).max(80).optional(),
  risks: z.array(z.string().min(1).max(500)).max(8).default([]),
  approvalStatus: z.enum(["PENDING_APPROVAL", "APPROVED", "REJECTED"]),
  /**
   * Approval stages the plan for a later Build Mode; it does not itself write
   * files or authorize commits/publishing.
   */
  writeAccess: z.enum(["NOT_AUTHORIZED", "APPROVED_FOR_BUILD"]),
}).strict();

export type ImplementationPlan = z.infer<typeof ImplementationPlanSchema>;