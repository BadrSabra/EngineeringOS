import { z } from "zod";

export const WorkflowPhaseSchema = z.object({
  name: z.string(),
  steps: z.array(z.string()),
  condition: z.string().optional(),
});

export const WorkflowActionSchema = z.enum(["advance", "wait", "fail", "complete"]);

export const WorkflowDecisionSchema = z.object({
  action: WorkflowActionSchema,
  reasoning: z.string().min(1),
  nextPhase: z.string().optional(),
  blockers: z.array(z.string()).optional(),
  suggestions: z.array(z.string()).optional(),
});

export type WorkflowPhase = z.infer<typeof WorkflowPhaseSchema>;
export type WorkflowAction = z.infer<typeof WorkflowActionSchema>;
export type WorkflowDecision = z.infer<typeof WorkflowDecisionSchema>;
