import { z } from "zod";
import {
  AGENT_STATE_LIMITS,
  AGENT_STATE_SCHEMA_VERSION,
  boundedContractSchema,
  boundedJsonSchema,
  boundedString,
} from "./contract-utils.js";

export const AgentActionRiskSchema = z.enum(["LOW", "MEDIUM", "HIGH"]);
export type AgentActionRisk = z.infer<typeof AgentActionRiskSchema>;

export const AgentActionSchema = boundedContractSchema(z.object({
  schemaVersion: z.literal(AGENT_STATE_SCHEMA_VERSION),
  actionId: boundedString(200),
  episodeId: boundedString(200),
  capabilityId: boundedString(200),
  intent: boundedString(512),
  triggerConditions: z.array(boundedJsonSchema(8 * 1024)).max(32).optional(),
  scope: boundedJsonSchema(16 * 1024),
  preconditions: z.array(boundedString(512)).max(64),
  expectedEffects: z.array(boundedString(256)).max(64),
  authorization: boundedJsonSchema(8 * 1024),
  risk: AgentActionRiskSchema,
  idempotencyKey: boundedString(256),
  observationProfile: boundedString(120),
  failureSemantics: z.array(boundedString(512)).max(32),
}).strict(), AGENT_STATE_LIMITS.effectPayloadBytes);
export type AgentAction = z.infer<typeof AgentActionSchema>;

export const AgentActionRequestedPayloadSchema = boundedContractSchema(
  z.object({
    action: AgentActionSchema,
    actionId: boundedString(200).optional(),
    capabilityId: boundedString(200).optional(),
    expectedEffects: z.array(boundedString(256)).max(64).optional(),
  }).passthrough().superRefine((payload, ctx) => {
    if (payload.actionId !== undefined && payload.actionId !== payload.action.actionId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["actionId"],
        message: "actionId must match the canonical action",
      });
    }
    if (payload.capabilityId !== undefined && payload.capabilityId !== payload.action.capabilityId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["capabilityId"],
        message: "capabilityId must match the canonical action",
      });
    }
    if (
      payload.expectedEffects !== undefined
      && (
        payload.expectedEffects.length !== payload.action.expectedEffects.length
        || payload.expectedEffects.some((effect, index) => effect !== payload.action.expectedEffects[index])
      )
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expectedEffects"],
        message: "expectedEffects must match the canonical action",
      });
    }
  }),
  AGENT_STATE_LIMITS.episodeEventPayloadBytes,
);
export type AgentActionRequestedPayload = z.infer<typeof AgentActionRequestedPayloadSchema>;

export function parseAgentAction(value: unknown): AgentAction {
  return AgentActionSchema.parse(value);
}

export function parseAgentActionRequestedPayload(value: unknown): AgentActionRequestedPayload {
  return AgentActionRequestedPayloadSchema.parse(value);
}
