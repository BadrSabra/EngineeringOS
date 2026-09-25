import type { AgentAction, EffectContract, JsonValue } from "@workspace/ai-orchestrator";

export type GateCEffectKind = "runtime" | "runtime-restart" | "runtime-stop" | "browser" | "delivery";

type RuntimeStateSnapshot = {
  status: "passed" | "failed" | "unavailable";
  projectId: string;
  sessionId: string;
  revision: string;
  pid: number;
  port: number;
  processAlive: boolean;
  portReady: boolean;
  healthStatus: number | null;
  servingRevision: string | null;
  markerMatched: boolean | null;
  listener: RuntimeListenerSnapshot;
  observedAt: string;
};

type RuntimeListenerSnapshot = {
  status: "known" | "mismatch" | "unknown";
  reasonCode: string;
  port: number | null;
  identityDigest: string | null;
  processAttestation: {
    status: "known" | "mismatch" | "unknown";
    reasonCode: string;
    bindingDigest: string | null;
    attestationDigest: string | null;
    processEnvironmentDigest: string | null;
  };
};

export type GateCServerAfterObservation = {
  effectValue: "passed" | "failed";
  observedAt: string;
  facts: Record<string, JsonValue>;
  sourceRefs: string[];
};

export type RuntimeGateCAfterObservation = GateCServerAfterObservation & {
  sessionId: string;
};

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function boundedIdentity(value: unknown, maxLength = 500): string | undefined {
  return typeof value === "string" && value.trim() && value.length <= maxLength
    ? value
    : undefined;
}

function boundedDigest(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value) ? value : undefined;
}

function parseRuntimeListener(value: unknown): RuntimeListenerSnapshot | undefined {
  const listener = record(value);
  const attestation = record(listener?.processAttestation);
  const status = listener?.status;
  const reasonCode = boundedIdentity(listener?.reasonCode, 120);
  const port = listener?.port;
  const identityDigest = boundedDigest(listener?.identityDigest);
  const attestationStatus = attestation?.status;
  const attestationReasonCode = boundedIdentity(attestation?.reasonCode, 120);
  const bindingDigest = boundedDigest(attestation?.bindingDigest);
  const attestationDigest = boundedDigest(attestation?.attestationDigest);
  const processEnvironmentDigest = boundedDigest(attestation?.processEnvironmentDigest);
  if (
    (status !== "known" && status !== "mismatch" && status !== "unknown")
    || !reasonCode
    || (port !== null && (
      !Number.isInteger(port)
      || (port as number) <= 0
      || (port as number) > 65_535
    ))
    || identityDigest === undefined
    || !attestation
    || (attestationStatus !== "known" && attestationStatus !== "mismatch" && attestationStatus !== "unknown")
    || !attestationReasonCode
    || bindingDigest === undefined
    || attestationDigest === undefined
    || processEnvironmentDigest === undefined
  ) {
    return undefined;
  }
  return {
    status,
    reasonCode,
    port: port as number | null,
    identityDigest,
    processAttestation: {
      status: attestationStatus,
      reasonCode: attestationReasonCode,
      bindingDigest,
      attestationDigest,
      processEnvironmentDigest,
    },
  };
}

function parseRuntimeState(value: unknown): RuntimeStateSnapshot | undefined {
  const state = record(value);
  if (!state) return undefined;
  const status = state.status;
  const projectId = boundedIdentity(state.projectId);
  const sessionId = boundedIdentity(state.sessionId);
  const revision = boundedIdentity(state.revision, 2_000);
  const observedAt = boundedIdentity(state.observedAt, 80);
  const healthStatus = state.healthStatus;
  const servingRevision = typeof state.servingRevision === "string"
    ? boundedIdentity(state.servingRevision, 2_000)
    : state.servingRevision === null ? null : undefined;
  const markerMatched = state.markerMatched;
  const listener = parseRuntimeListener(state.listener);
  if (
    (status !== "passed" && status !== "failed" && status !== "unavailable")
    || !projectId
    || !sessionId
    || !revision
    || !observedAt
    || !Number.isFinite(Date.parse(observedAt))
    || !Number.isInteger(state.pid)
    || (state.pid as number) <= 0
    || !Number.isInteger(state.port)
    || (state.port as number) <= 0
    || typeof state.processAlive !== "boolean"
    || typeof state.portReady !== "boolean"
    || (healthStatus !== null && (
      !Number.isInteger(healthStatus)
      || (healthStatus as number) < 100
      || (healthStatus as number) > 599
    ))
    || servingRevision === undefined
    || (markerMatched !== null && typeof markerMatched !== "boolean")
    || !listener
  ) {
    return undefined;
  }
  return {
    status,
    projectId,
    sessionId,
    revision,
    pid: state.pid as number,
    port: state.port as number,
    processAlive: state.processAlive,
    portReady: state.portReady,
    healthStatus: healthStatus as number | null,
    servingRevision,
    markerMatched: markerMatched as boolean | null,
    listener,
    observedAt: new Date(observedAt).toISOString(),
  };
}

function isDigest(value: string | null): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function isServingState(state: RuntimeStateSnapshot, revision: string): boolean {
  return state.status === "passed"
    && state.processAlive
    && state.portReady
    && state.healthStatus !== null
    && state.healthStatus >= 200
    && state.healthStatus < 300
    && state.servingRevision === revision
    && state.markerMatched !== false
    && state.listener.status === "known"
    && state.listener.port === state.port
    && isDigest(state.listener.identityDigest)
    && state.listener.processAttestation.status === "known"
    && state.listener.processAttestation.reasonCode === "child_process_observed"
    && isDigest(state.listener.processAttestation.bindingDigest)
    && isDigest(state.listener.processAttestation.attestationDigest)
    && isDigest(state.listener.processAttestation.processEnvironmentDigest);
}

function runtimeStateFacts(state: RuntimeStateSnapshot): Record<string, JsonValue> {
  return {
    status: state.status,
    projectId: state.projectId,
    sessionId: state.sessionId,
    revision: state.revision,
    pid: state.pid,
    port: state.port,
    processAlive: state.processAlive,
    portReady: state.portReady,
    healthStatus: state.healthStatus,
    servingRevision: state.servingRevision,
    markerMatched: state.markerMatched,
    listener: {
      status: state.listener.status,
      reasonCode: state.listener.reasonCode,
      port: state.listener.port,
      identityDigest: state.listener.identityDigest,
      processAttestation: state.listener.processAttestation,
    },
    observedAt: state.observedAt,
  };
}

/**
 * Classify only server-observed runtime after-state. Capability status and
 * receipt identity are deliberately not used as a substitute for the runtime
 * process/port/HTTP observations.
 */
export function buildRuntimeGateCAfterObservation(input: {
  recipeId: string;
  projectId: string;
  sourceRevision: string;
  evidence: unknown;
}): RuntimeGateCAfterObservation | undefined {
  if (
    input.recipeId !== "runtime.start"
    && input.recipeId !== "runtime.restart"
    && input.recipeId !== "runtime.stop"
  ) {
    return undefined;
  }
  const evidence = record(input.evidence);
  const evidenceSessionId = boundedIdentity(evidence?.sessionId);
  const after = parseRuntimeState(evidence?.afterState);
  if (
    !evidence
    || !evidenceSessionId
    || !after
    || after.projectId !== input.projectId
    || after.sessionId !== evidenceSessionId
    || after.revision !== input.sourceRevision
  ) {
    return undefined;
  }

  const isStop = input.recipeId === "runtime.stop";
  const before = isStop ? parseRuntimeState(evidence.beforeState) : undefined;
  if (
    isStop
    && (
      !before
      || before.projectId !== input.projectId
      || before.sessionId !== evidenceSessionId
      || before.revision !== input.sourceRevision
    )
  ) {
    return undefined;
  }

  const passed = isStop
    ? Boolean(
        before
        && isServingState(before, input.sourceRevision)
        && after.status === "passed"
        && !after.processAlive
        && !after.portReady
        && after.pid === before.pid
        && after.port === before.port
        && after.healthStatus === null
        && after.servingRevision === null
        && after.markerMatched === null
        && after.listener.status !== "known"
        && after.listener.port === null
      )
    : isServingState(after, input.sourceRevision);

  const facts: Record<string, JsonValue> = isStop
    ? {
        before: runtimeStateFacts(before!),
        after: runtimeStateFacts(after),
      }
    : { after: runtimeStateFacts(after) };
  const sourceRefs = ["evidenceId", "artifactRef", "resultHash"]
    .map((key) => boundedIdentity(evidence[key]))
    .filter((value): value is string => Boolean(value));
  if (after.listener.identityDigest) sourceRefs.push(after.listener.identityDigest);
  return {
    effectValue: passed ? "passed" : "failed",
    sessionId: evidenceSessionId,
    observedAt: after.observedAt,
    facts,
    sourceRefs: [...new Set(sourceRefs)],
  };
}

function observedAt(value: unknown): string | undefined {
  const raw = boundedIdentity(value, 80);
  if (!raw || !Number.isFinite(Date.parse(raw))) return undefined;
  return new Date(raw).toISOString();
}

function loopbackHttpOrigin(value: unknown): string | undefined {
  const raw = boundedIdentity(value, 500);
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (
      url.protocol !== "http:"
      || url.hostname !== "127.0.0.1"
      || !url.port
      || url.username
      || url.password
      || url.pathname !== "/"
      || url.search
      || url.hash
    ) {
      return undefined;
    }
    return url.origin;
  } catch {
    return undefined;
  }
}

function evidenceSourceRefs(value: unknown): string[] {
  const evidence = record(value);
  if (!evidence) return [];
  return [...new Set(
    ["evidenceId", "artifactRef", "resultHash"]
      .map((key) => boundedIdentity(evidence[key]))
      .filter((item): item is string => Boolean(item)),
  )];
}

export function buildBrowserGateCAfterObservation(input: {
  projectId: string;
  operationId: string;
  executionId: string;
  executionAttempt: number;
  sourceRevision: string;
  expectedProfileName: string;
  output: unknown;
}): GateCServerAfterObservation | undefined {
  const output = record(input.output);
  const evidence = record(output?.evidence);
  if (!output || !evidence) return undefined;

  const projectId = boundedIdentity(evidence.projectId);
  const operationId = boundedIdentity(evidence.operationId);
  const executionId = boundedIdentity(evidence.executionId);
  const executionAttempt = evidence.executionAttempt;
  const sourceRevision = boundedIdentity(evidence.sourceRevision, 2_000);
  const servingRevision = boundedIdentity(evidence.revision, 2_000);
  const sessionId = boundedIdentity(evidence.sessionId);
  const profileName = boundedIdentity(evidence.profileName, 80);
  const artifactRef = boundedIdentity(evidence.artifactRef, 500);
  const origin = loopbackHttpOrigin(evidence.origin);
  const permittedOrigin = loopbackHttpOrigin(evidence.permittedOrigin);
  const time = observedAt(evidence.observedAt);
  const status = evidence.status;
  const consoleErrorCount = evidence.consoleErrorCount;
  if (
    projectId !== input.projectId
    || operationId !== input.operationId
    || executionId !== input.executionId
    || !Number.isInteger(executionAttempt)
    || executionAttempt !== input.executionAttempt
    || sourceRevision !== input.sourceRevision
    || servingRevision !== input.sourceRevision
    || !sessionId
    || profileName !== input.expectedProfileName
    || output.profile !== input.expectedProfileName
    || typeof status !== "string"
    || (status !== "passed" && status !== "failed" && status !== "unavailable")
    || output.status !== status
    || !time
    || !artifactRef
    || artifactRef !== `browser-preview:${sessionId}:${input.operationId}:${input.executionId}`
    || !origin
    || !permittedOrigin
    || origin !== permittedOrigin
    || !Number.isInteger(consoleErrorCount)
    || (consoleErrorCount as number) < 0
  ) {
    return undefined;
  }

  const facts: Record<string, JsonValue> = {
    status,
    projectId,
    operationId,
    executionId,
    executionAttempt: executionAttempt as number,
    sourceRevision,
    servingRevision,
    sessionId,
    profileName,
    origin,
    permittedOrigin,
    artifactRef,
    consoleErrorCount: consoleErrorCount as number,
    observedAt: time,
  };
  return {
    effectValue: status === "passed" && consoleErrorCount === 0 ? "passed" : "failed",
    observedAt: time,
    facts,
    sourceRefs: evidenceSourceRefs(evidence),
  };
}

function credentialFreeGitHubRemote(value: unknown): string | undefined {
  const raw = boundedIdentity(value, 500);
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    const parts = url.pathname.split("/").filter(Boolean);
    if (
      url.protocol !== "https:"
      || url.hostname !== "github.com"
      || url.port
      || url.username
      || url.password
      || url.search
      || url.hash
      || parts.length !== 2
    ) {
      return undefined;
    }
    return raw;
  } catch {
    return undefined;
  }
}

export function buildDeliveryGateCAfterObservation(input: {
  projectId: string;
  operationId: string;
  executionId: string;
  executionAttempt: number;
  sourceRevision: string;
  output: unknown;
}): GateCServerAfterObservation | undefined {
  const output = record(input.output);
  const state = record(output?.afterState);
  if (!output || !state) return undefined;

  const projectId = boundedIdentity(state.projectId);
  const operationId = boundedIdentity(state.operationId);
  const executionId = boundedIdentity(state.executionId);
  const executionAttempt = state.executionAttempt;
  const sourceRevision = boundedIdentity(state.sourceRevision, 2_000);
  const proposalId = boundedIdentity(state.proposalId);
  const remoteUrl = credentialFreeGitHubRemote(state.remoteUrl);
  const branch = boundedIdentity(state.branch, 240);
  const expectedCommitHash = boundedIdentity(state.expectedCommitHash, 160);
  const remoteCommitHash = boundedIdentity(state.remoteCommitHash, 160);
  const expectedParentHash = boundedIdentity(state.expectedParentHash, 160);
  const remoteParentHash = boundedIdentity(state.remoteParentHash, 160);
  const expectedTreeHash = boundedIdentity(state.expectedTreeHash, 160);
  const remoteTreeHash = boundedIdentity(state.remoteTreeHash, 160);
  const candidateTreeHash = boundedIdentity(state.candidateTreeHash, 160);
  const committedTreeHash = boundedIdentity(state.committedTreeHash, 160);
  const operationMarker = boundedIdentity(state.operationMarker, 300);
  const parentCount = state.remoteParentCount;
  const markerMatched = state.markerMatched;
  const time = observedAt(state.observedAt);
  const status = state.status;
  const outerStatus = output.status;
  if (
    projectId !== input.projectId
    || operationId !== input.operationId
    || executionId !== input.executionId
    || !Number.isInteger(executionAttempt)
    || executionAttempt !== input.executionAttempt
    || sourceRevision !== input.sourceRevision
    || !proposalId
    || !remoteUrl
    || !branch
    || !expectedCommitHash
    || !remoteCommitHash
    || !expectedParentHash
    || !remoteParentHash
    || !expectedTreeHash
    || !remoteTreeHash
    || !candidateTreeHash
    || !committedTreeHash
    || !operationMarker
    || !Number.isInteger(parentCount)
    || !time
    || typeof markerMatched !== "boolean"
    || status !== "passed"
    || (outerStatus !== "passed" && outerStatus !== "blocked" && outerStatus !== "unavailable")
  ) {
    return undefined;
  }

  const facts: Record<string, JsonValue> = {
    status,
    projectId,
    operationId,
    executionId,
    executionAttempt: executionAttempt as number,
    sourceRevision,
    proposalId,
    remoteUrl,
    branch,
    expectedCommitHash,
    remoteCommitHash,
    expectedParentHash,
    remoteParentHash,
    expectedTreeHash,
    remoteTreeHash,
    remoteParentCount: parentCount as number,
    candidateTreeHash,
    committedTreeHash,
    operationMarker,
    markerMatched,
    observedAt: time,
  };
  const passed = outerStatus === "passed"
    && expectedCommitHash === remoteCommitHash
    && expectedParentHash === remoteParentHash
    && expectedTreeHash === remoteTreeHash
    && parentCount === 1
    && candidateTreeHash === committedTreeHash
    && markerMatched
    && operationMarker === `EngineeringOS-Operation: ${input.operationId}`;
  return {
    effectValue: passed ? "passed" : "failed",
    observedAt: time,
    facts,
    sourceRefs: evidenceSourceRefs(output.evidence),
  };
}

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