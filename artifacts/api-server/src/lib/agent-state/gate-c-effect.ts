import type { AgentAction, EffectContract } from "@workspace/ai-orchestrator";

export type GateCEffectKind = "runtime" | "browser" | "delivery";

export function isGateCEffectRecipe(recipeId: string): boolean {
  return recipeId === "runtime.start"
    || recipeId === "browser.verify"
    || recipeId === "delivery.push.github";
}

export function gateCEffectKind(recipeId: string): GateCEffectKind | undefined {
  if (recipeId === "runtime.start") return "runtime";
  if (recipeId === "browser.verify") return "browser";
  if (recipeId === "delivery.push.github") return "delivery";
  return undefined;
}

export function gateCEffectIdentity(input: {
  kind: GateCEffectKind;
  operationId: string;
  profileName?: string;
}): { subject: string; predicate: string; effectId: string } {
  if (input.kind === "browser") {
    const profileName = input.profileName ?? "default";
    return {
      subject: `browser:${input.operationId}:${profileName}`,
      predicate: "verification.status",
      effectId: "browser.verification.observed",
    };
  }
  if (input.kind === "runtime") {
    return {
      subject: `runtime:${input.operationId}`,
      predicate: "serving.status",
      effectId: "runtime.serving.observed",
    };
  }
  return {
    subject: `delivery:${input.operationId}`,
    predicate: "remote.status",
    effectId: "delivery.remote.observed",
  };
}

export function buildGateCAction(input: {
  actionId: string;
  episodeId: string;
  projectId: string;
  operationId: string;
  sourceRevision: string;
  recipeId: string;
  capabilityId: string;
  approvedPaths: readonly string[];
  candidateIdentity?: string | null;
}): AgentAction {
  const kind = gateCEffectKind(input.recipeId);
  if (!kind) throw new Error("gate_c_unsupported_recipe");
  const identity = gateCEffectIdentity({ kind, operationId: input.operationId });
  return {
    schemaVersion: "1",
    actionId: input.actionId,
    episodeId: input.episodeId,
    capabilityId: input.capabilityId,
    intent: kind === "browser"
      ? "Verify the server-registered browser profile against the immutable source revision."
      : kind === "runtime"
        ? "Start the server-owned preview and verify its serving state."
        : "Verify the committed delivery against the remote branch state.",
    scope: {
      projectId: input.projectId,
      operationId: input.operationId,
      sourceRevision: input.sourceRevision,
      recipeId: input.recipeId,
      candidateIdentity: input.candidateIdentity ?? null,
      approvedPaths: [...input.approvedPaths],
    },
    preconditions: kind === "browser"
      ? [
          "The browser profile, origin, and steps are server-registered.",
          "The preview session is bound to the requested source revision.",
        ]
      : kind === "runtime"
        ? [
            "The runtime root and revision are server-owned.",
            "The current worker lease owns the runtime session.",
          ]
        : [
          "The proposal, commit, candidate tree, and operation identity are server-bound.",
          "The remote branch state is checked after delivery.",
        ],
    expectedEffects: [identity.effectId],
    authorization: {
      source: "server",
      capability: input.capabilityId,
    },
    risk: kind === "delivery" ? "HIGH" : kind === "runtime" ? "MEDIUM" : "LOW",
    idempotencyKey: `gate-c:${input.operationId}:${input.recipeId}:${input.episodeId}`,
    observationProfile: kind === "browser" ? "BROWSER" : kind === "runtime" ? "RUNTIME" : "DELIVERY",
    failureSemantics: [
      "A missing, stale, or unavailable after-state cannot produce PROVEN.",
      "A contradictory after-state requires a bounded failure or replan.",
    ],
  };
}

export function buildGateCEffectContract(input: {
  kind: GateCEffectKind;
  operationId: string;
  beforeEvidenceRef: string;
  afterEvidenceRef: string;
  profileName?: string;
}): EffectContract {
  const identity = gateCEffectIdentity(input);
  return {
    schemaVersion: "1",
    effectId: identity.effectId,
    expectedStateChanges: [{
      subject: identity.subject,
      predicate: identity.predicate,
      expectedValue: "passed",
    }],
    observationProfile: input.kind === "browser"
      ? "BROWSER"
      : input.kind === "runtime"
        ? "RUNTIME"
        : "DELIVERY",
    requiredEvidence: [input.beforeEvidenceRef, input.afterEvidenceRef],
    allowedResult: "OBSERVED",
  };
}