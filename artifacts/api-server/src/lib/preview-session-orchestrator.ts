import { createHash } from "node:crypto";
import type { PreviewSession } from "@workspace/db";
import { dispatchPreviewControlCommand } from "./preview-gateway-control-client.js";
import type { PreviewEcsCommandResult } from "./preview-ecs-runner.js";
import { attachPreviewSessionTask } from "./preview-session-store.js";
import { isPreviewBuildOutputArtifactKey } from "./preview-build-output-key.js";

const COMMAND_TTL_MS = 20_000;
const OUTPUT_ARTIFACT_DIGEST_PATTERN = /^[a-f0-9]{64}$/i;
const SESSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Reissues of one Session transition need the same identity; the fence still
// compares the full semantic command fingerprint before accepting a retry.
function previewCommandId(input: {
  sessionId: string;
  action: "start" | "stop";
  stateVersion: number;
}): string {
  const namespaceBytes = Buffer.from(
    input.sessionId.replaceAll("-", ""),
    "hex",
  );
  const digest = createHash("sha1")
    .update(namespaceBytes)
    .update(
      `EngineeringOS Preview Control Command v1\n${input.action}\n${input.stateVersion}`,
    )
    .digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export class PreviewSessionOrchestratorError extends Error {
  constructor(
    readonly code:
      | "PREVIEW_SESSION_START_UNCONFIRMED"
      | "PREVIEW_SESSION_TASK_CLEANUP_UNCONFIRMED",
  ) {
    super("Preview session startup could not be confirmed.");
    this.name = "PreviewSessionOrchestratorError";
  }
}

type PreviewCommandDispatcher = (input: {
  command: Parameters<typeof dispatchPreviewControlCommand>[0]["command"];
  privateKeyPem: string | undefined;
  gatewayUrl: string | undefined;
  now?: Date;
}) => Promise<PreviewEcsCommandResult>;

type PreviewTaskAttacher = (input: {
  sessionId: string;
  expectedVersion: number;
  runnerTaskArn: string;
  now: Date;
}) => Promise<PreviewSession | null>;

export function createPreviewSessionOrchestrator(dependencies?: {
  dispatch?: PreviewCommandDispatcher;
  attachTask?: PreviewTaskAttacher;
  privateKeyPem?: string;
  gatewayUrl?: string;
  now?: () => Date;
}) {
  const dispatch = dependencies?.dispatch ?? dispatchPreviewControlCommand;
  const attachTask = dependencies?.attachTask ?? attachPreviewSessionTask;
  const now = dependencies?.now ?? (() => new Date());

  return {
    async start(session: PreviewSession): Promise<PreviewSession | null> {
      const issuedAt = now();
      if (
        session.status !== "starting" ||
        session.stateVersion !== 0 ||
        !SESSION_ID_PATTERN.test(session.id) ||
        session.runnerTaskArn !== null ||
        !session.buildOutputArtifactKey ||
        !isPreviewBuildOutputArtifactKey(session.buildOutputArtifactKey) ||
        !session.buildOutputDigest ||
        !OUTPUT_ARTIFACT_DIGEST_PATTERN.test(session.buildOutputDigest) ||
        session.expiresAt.getTime() <= issuedAt.getTime()
      ) {
        return null;
      }

      const expiresAt = new Date(
        Math.min(
          issuedAt.getTime() + COMMAND_TTL_MS,
          session.expiresAt.getTime(),
        ),
      );
      const startCommand = {
        version: 1 as const,
        action: "start" as const,
        commandId: previewCommandId({
          sessionId: session.id,
          action: "start",
          stateVersion: session.stateVersion,
        }),
        sessionId: session.id,
        stateVersion: 0,
        issuedAt: issuedAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
        proposalId: session.proposalId,
        proposalRevision: session.proposalRevision,
        candidateRevision: session.candidateRevision,
        changeSetHash: session.changeSetHash,
        outputArtifactKey: session.buildOutputArtifactKey,
        outputArtifactDigest: session.buildOutputDigest,
        imageDigest: session.imageDigest,
        taskDefinitionArn: session.taskDefinitionArn,
        sessionExpiresAt: session.expiresAt.toISOString(),
      };

      const launched = await dispatch({
        command: startCommand,
        privateKeyPem: dependencies?.privateKeyPem,
        gatewayUrl: dependencies?.gatewayUrl,
        now: issuedAt,
      });
      if (launched.action !== "start") {
        throw new PreviewSessionOrchestratorError(
          "PREVIEW_SESSION_START_UNCONFIRMED",
        );
      }

      let attached: PreviewSession | null = null;
      try {
        attached = await attachTask({
          sessionId: session.id,
          expectedVersion: session.stateVersion,
          runnerTaskArn: launched.taskArn,
          now: now(),
        });
      } catch {
        attached = null;
      }
      if (attached) return attached;

      const stopIssuedAt = now();
      const stopStateVersion = Math.max(1, session.stateVersion + 1);
      const stopCommand = {
        version: 1 as const,
        action: "stop" as const,
        commandId: previewCommandId({
          sessionId: session.id,
          action: "stop",
          stateVersion: stopStateVersion,
        }),
        sessionId: session.id,
        stateVersion: stopStateVersion,
        issuedAt: stopIssuedAt.toISOString(),
        expiresAt: new Date(
          stopIssuedAt.getTime() + COMMAND_TTL_MS,
        ).toISOString(),
        sessionExpiresAt: session.expiresAt.toISOString(),
        taskArn: launched.taskArn,
        taskDefinitionArn: session.taskDefinitionArn,
      };
      try {
        const stopped = await dispatch({
          command: stopCommand,
          privateKeyPem: dependencies?.privateKeyPem,
          gatewayUrl: dependencies?.gatewayUrl,
          now: stopIssuedAt,
        });
        if (stopped.action !== "stop") {
          throw new PreviewSessionOrchestratorError(
            "PREVIEW_SESSION_TASK_CLEANUP_UNCONFIRMED",
          );
        }
      } catch {
        throw new PreviewSessionOrchestratorError(
          "PREVIEW_SESSION_TASK_CLEANUP_UNCONFIRMED",
        );
      }

      throw new PreviewSessionOrchestratorError(
        "PREVIEW_SESSION_START_UNCONFIRMED",
      );
    },
  };
}
