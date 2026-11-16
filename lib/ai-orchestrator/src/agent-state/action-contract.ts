import { z } from "zod";
import {
  AGENT_STATE_LIMITS,
  AGENT_STATE_SCHEMA_VERSION,
  boundedContractSchema,
  boundedJsonSchema,
  boundedString,
  canonicalJsonHash,
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

const revisionDigestSchema = boundedString(64).regex(/^[a-f0-9]{64}$/u);

const sortedUniqueFactRefsSchema = z.array(boundedString(200)).max(256).superRefine((refs, ctx) => {
  if (new Set(refs).size !== refs.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "parentFactRefs must be unique" });
  }
  if (refs.some((ref, index) => index > 0 && refs[index - 1]! > ref)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "parentFactRefs must be sorted" });
  }
});

export const ApplyWorldTransitionIntentSchema = boundedContractSchema(z.object({
  schemaVersion: z.literal(1),
  projectId: boundedString(200),
  proposalId: boundedString(200),
  goalId: boundedString(200),
  planRevision: revisionDigestSchema,
  parentWorldRevision: revisionDigestSchema,
  parentFactRefs: sortedUniqueFactRefsSchema,
}).strict(), AGENT_STATE_LIMITS.episodeEventPayloadBytes);

export type ApplyWorldTransitionIntent = z.infer<typeof ApplyWorldTransitionIntentSchema>;

export const ApplyJournalEvidenceReferenceSchema = z.object({
  kind: z.literal("APPLY_JOURNAL"),
  id: boundedString(200),
  stage: z.enum([
    "APPLY_AUTHORIZATION_DECISION",
    "APPLY_APPROVED_SUBSET",
    "APPLY_VALIDATION_PASSED",
    "APPLY_CANDIDATE_STABLE",
    "APPLY_EXECUTION_LEASE",
    "APPLY_PARENT_SNAPSHOT",
  ]),
  contentHash: revisionDigestSchema,
}).strict();
export type ApplyJournalEvidenceReference = z.infer<typeof ApplyJournalEvidenceReferenceSchema>;

const applyAuthorizationDecisionBodySchema = z.object({
  schemaVersion: z.literal(1),
  decision: z.literal("ALLOW"),
  actorUserId: boundedString(200),
  projectId: boundedString(200),
  projectOwnerId: boundedString(200),
  proposalId: boundedString(200),
  proposalRevision: z.number().int().min(0),
  executionId: boundedString(200),
  attempt: z.number().int().min(0),
  capabilityId: boundedString(200),
  approvedPathsHash: revisionDigestSchema,
  proposalChangesHash: revisionDigestSchema,
  changeSetHash: revisionDigestSchema,
}).strict();

export const ApplyAuthorizationDecisionSchema = boundedContractSchema(
  applyAuthorizationDecisionBodySchema.extend({
    decisionHash: revisionDigestSchema,
  }).superRefine((decision, ctx) => {
    const { decisionHash, ...body } = decision;
    if (canonicalJsonHash(body as Parameters<typeof canonicalJsonHash>[0]) !== decisionHash) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["decisionHash"],
        message: "decisionHash must match the canonical authorization decision",
      });
    }
    if (decision.actorUserId !== decision.projectOwnerId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["actorUserId"],
        message: "Apply authorization must be bound to the owning project user",
      });
    }
  }),
  8 * 1024,
);
export type ApplyAuthorizationDecision = z.infer<typeof ApplyAuthorizationDecisionSchema>;

export function buildApplyAuthorizationDecision(
  input: z.infer<typeof applyAuthorizationDecisionBodySchema>,
): ApplyAuthorizationDecision {
  return ApplyAuthorizationDecisionSchema.parse({
    ...input,
    decisionHash: canonicalJsonHash(input as Parameters<typeof canonicalJsonHash>[0]),
  });
}

export const ApplyPreconditionCheckIdSchema = z.enum([
  "PROJECT_OWNER_MATCHED",
  "PROPOSAL_ELIGIBLE",
  "EXACT_APPROVED_SUBSET",
  "CANDIDATE_VALIDATION_PASSED",
  "CANDIDATE_STABLE",
  "LIVE_ROOT_BASE_MATCHED",
  "EXECUTION_LEASE_OWNED",
  "MISSION_PARENT_SNAPSHOT_BOUND",
]);

const applyPreconditionCheckBodySchema = z.object({
  id: ApplyPreconditionCheckIdSchema,
  outcome: z.literal("SATISFIED"),
  reference: ApplyJournalEvidenceReferenceSchema,
}).strict();

export const ApplyPreconditionCheckSchema = boundedContractSchema(
  applyPreconditionCheckBodySchema,
  2 * 1024,
);
export type ApplyPreconditionCheck = z.infer<typeof ApplyPreconditionCheckSchema>;

const applyPreconditionReceiptBodySchema = z.object({
  schemaVersion: z.literal(1),
  actionId: boundedString(200),
  executionId: boundedString(200),
  attempt: z.number().int().min(0),
  planRevision: revisionDigestSchema.optional(),
  parentWorldRevision: revisionDigestSchema.optional(),
  checks: z.array(ApplyPreconditionCheckSchema).min(7).max(8),
}).strict();

export const ApplyPreconditionReceiptSchema = boundedContractSchema(
  applyPreconditionReceiptBodySchema.extend({
    receiptHash: revisionDigestSchema,
  }).superRefine((receipt, ctx) => {
    const { receiptHash, ...body } = receipt;
    if (canonicalJsonHash(body as Parameters<typeof canonicalJsonHash>[0]) !== receiptHash) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["receiptHash"],
        message: "receiptHash must match the canonical precondition receipt",
      });
    }
    const ids = receipt.checks.map((check) => check.id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["checks"],
        message: "precondition check IDs must be unique",
      });
    }
    const required = [
      "PROJECT_OWNER_MATCHED",
      "PROPOSAL_ELIGIBLE",
      "EXACT_APPROVED_SUBSET",
      "CANDIDATE_VALIDATION_PASSED",
      "CANDIDATE_STABLE",
      "LIVE_ROOT_BASE_MATCHED",
      "EXECUTION_LEASE_OWNED",
    ] as const;
    for (const id of required) {
      if (!ids.includes(id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["checks"],
          message: `missing required precondition check: ${id}`,
        });
      }
    }
    const hasMissionBinding = receipt.planRevision !== undefined
      || receipt.parentWorldRevision !== undefined;
    if (hasMissionBinding) {
      if (!receipt.planRevision || !receipt.parentWorldRevision
        || !ids.includes("MISSION_PARENT_SNAPSHOT_BOUND")) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["checks"],
          message: "Mission Apply requires a bound parent snapshot precondition",
        });
      }
    } else if (ids.includes("MISSION_PARENT_SNAPSHOT_BOUND")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["checks"],
        message: "Mission parent precondition requires plan and parent World revisions",
      });
    }
  }),
  16 * 1024,
);
export type ApplyPreconditionReceipt = z.infer<typeof ApplyPreconditionReceiptSchema>;

export function buildApplyPreconditionReceipt(
  input: z.infer<typeof applyPreconditionReceiptBodySchema>,
): ApplyPreconditionReceipt {
  return ApplyPreconditionReceiptSchema.parse({
    ...input,
    receiptHash: canonicalJsonHash(input as Parameters<typeof canonicalJsonHash>[0]),
  });
}

export const AgentActionRequestedPayloadSchema = boundedContractSchema(
  z.object({
    action: AgentActionSchema,
    actionId: boundedString(200).optional(),
    capabilityId: boundedString(200).optional(),
    expectedEffects: z.array(boundedString(256)).max(64).optional(),
    worldTransitionIntent: ApplyWorldTransitionIntentSchema.optional(),
    authorizationDecision: ApplyAuthorizationDecisionSchema.optional(),
    preconditionReceipt: ApplyPreconditionReceiptSchema.optional(),
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
    if ((payload.authorizationDecision === undefined) !== (payload.preconditionReceipt === undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["authorizationDecision"],
        message: "Apply authorization and precondition receipts must be supplied together",
      });
    }
    if (payload.authorizationDecision && payload.preconditionReceipt) {
      const decision = payload.authorizationDecision;
      const receipt = payload.preconditionReceipt;
      if (
        decision.projectId !== payload.worldTransitionIntent?.projectId
        && payload.worldTransitionIntent !== undefined
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["authorizationDecision", "projectId"],
          message: "authorization decision project must match the World Transition intent",
        });
      }
      if (
        decision.proposalId !== payload.worldTransitionIntent?.proposalId
        && payload.worldTransitionIntent !== undefined
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["authorizationDecision", "proposalId"],
          message: "authorization decision proposal must match the World Transition intent",
        });
      }
      if (
        decision.executionId !== receipt.executionId
        || decision.attempt !== receipt.attempt
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["preconditionReceipt"],
          message: "authorization and precondition receipts must share execution attempt identity",
        });
      }
      if (decision.capabilityId !== payload.action.capabilityId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["authorizationDecision", "capabilityId"],
          message: "authorization capability must match the canonical action",
        });
      }
      if (receipt.actionId !== payload.action.actionId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["preconditionReceipt", "actionId"],
          message: "precondition receipt must match the canonical action",
        });
      }
      if (payload.worldTransitionIntent && (
        receipt.planRevision !== payload.worldTransitionIntent.planRevision
        || receipt.parentWorldRevision !== payload.worldTransitionIntent.parentWorldRevision
        || !receipt.checks.some((check) => check.id === "MISSION_PARENT_SNAPSHOT_BOUND")
      )) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["preconditionReceipt"],
          message: "precondition receipt must match the immutable Mission parent snapshot",
        });
      }
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
