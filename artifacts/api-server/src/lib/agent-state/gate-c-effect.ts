import type { AgentAction, EffectContract } from "@workspace/ai-orchestrator";

export type GateCEffectKind = "runtime" | "runtime-restart" | "runtime-stop" | "browser" | "delivery";

export function isGateCEffectRecipe(recipeId: string): boolean {
  return recipeId === "runtime.start"
    || recipeId === "runtime.restart"
    || recipeId === "runtime.stop"
    || recipeId === "browser.verify"
    || recipeId === "delivery.push.github";
}

export function gateCEffectKind(recipeId: string): GateCEffectKind | undefined {
  if (recipeId === "runtime.start") return "runtime";
  if (recipeId === "runtime.restart") return "runtime-restart";
  if (recipeId === "runtime.stop") return "runtime-stop";
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
  if (input.kind === "runtime" || input.kind === "runtime-restart" || input.kind === "runtime-stop") {
    if (input.kind === "runtime") {
      return {
        subject: `runtime:${input.operationId}`,
        predicate: "serving.status",
        effectId: "runtime.serving.observed",
      };
    }
    return {
      subject: `runtime:${input.operationId}:${input.kind}`,
      predicate: input.kind === "runtime-stop" ? "stopped.status" : "serving.status",
      effectId: input.kind === "runtime-restart"
          ? "runtime.restarted.observed"
          : "runtime.stopped.observed",
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
        : kind === "runtime-restart"
          ? "Restart the server-owned preview and verify its serving state."
          : kind === "runtime-stop"
            ? "Stop the server-owned preview and verify process and port closure."
        : "Verify the committed delivery against the remote branch state.",
    triggerConditions: [{ kind: "server_recipe", recipeId: input.recipeId }],
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
      : kind === "runtime" || kind === "runtime-restart" || kind === "runtime-stop"
        ? [
            "The runtime root and revision are server-owned.",
            kind === "runtime-stop"
              ? "The current worker lease owns the runtime session before stop."
              : "The current worker lease owns the runtime session.",
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
    risk: kind === "delivery" ? "HIGH" : kind === "runtime" ? "MEDIUM" : kind.startsWith("runtime-") ? "HIGH" : "LOW",
    idempotencyKey: `gate-c:${input.operationId}:${input.recipeId}:${input.episodeId}`,
    observationProfile: kind === "browser"
      ? "BROWSER"
      : kind === "runtime" || kind === "runtime-restart" || kind === "runtime-stop"
        ? "RUNTIME"
        : "DELIVERY",
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
      : input.kind === "runtime" || input.kind === "runtime-restart" || input.kind === "runtime-stop"
        ? "RUNTIME"
        : "DELIVERY",
    requiredEvidence: [input.beforeEvidenceRef, input.afterEvidenceRef],
    allowedResult: "OBSERVED",
  };
}