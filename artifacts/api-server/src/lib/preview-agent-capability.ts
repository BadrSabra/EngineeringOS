import { and, eq } from "drizzle-orm";
import {
  db,
  previewAgentNodesTable,
  type PreviewAgentNode,
} from "@workspace/db";
import {
  PreviewRunnerCapabilityError,
  verifyPreviewRunnerCapabilityV1,
  type VerifiedPreviewRunnerCapabilityV1,
} from "@workspace/preview-runner-contract";
import {
  previewAgentPublicKeyFingerprint,
} from "./preview-agent-pairing-crypto.js";
import {
  previewRunnerQualificationRegistry,
  type PreviewRunnerQualificationRecordV1,
} from "./preview-runner-qualification.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_CAPABILITY_TOKEN_LENGTH = 8_192;

export class PreviewAgentCapabilityError extends Error {
  constructor(
    readonly code:
      | "PREVIEW_AGENT_CAPABILITY_INVALID"
      | "PREVIEW_AGENT_CAPABILITY_UNQUALIFIED"
      | "PREVIEW_AGENT_CAPABILITY_UNAVAILABLE",
  ) {
    super("Preview Agent capability report is invalid or unavailable.");
    this.name = "PreviewAgentCapabilityError";
  }
}

type RegisteredNodeBinding = Pick<
  PreviewAgentNode,
  | "nodeId"
  | "status"
  | "publicKeyPem"
  | "publicKeyFingerprint"
  | "agentVersion"
>;

export function verifyPreviewAgentCapabilityReport(input: {
  node: RegisteredNodeBinding;
  qualification: PreviewRunnerQualificationRecordV1;
  token: string;
  now: Date;
}): VerifiedPreviewRunnerCapabilityV1 {
  const { node, qualification, token, now } = input;
  if (
    node.status !== "active" ||
    !node.publicKeyPem ||
    !node.publicKeyFingerprint ||
    !node.agentVersion ||
    node.agentVersion !== qualification.agentVersion ||
    !/^[a-f0-9]{64}$/i.test(node.publicKeyFingerprint) ||
    !Number.isFinite(now.getTime()) ||
    token.length === 0 ||
    token.length > MAX_CAPABILITY_TOKEN_LENGTH
  ) {
    throw new PreviewAgentCapabilityError("PREVIEW_AGENT_CAPABILITY_INVALID");
  }

  let actualFingerprint: string;
  try {
    actualFingerprint = previewAgentPublicKeyFingerprint(node.publicKeyPem);
  } catch {
    throw new PreviewAgentCapabilityError(
      "PREVIEW_AGENT_CAPABILITY_INVALID",
    );
  }
  if (actualFingerprint !== node.publicKeyFingerprint) {
    throw new PreviewAgentCapabilityError("PREVIEW_AGENT_CAPABILITY_INVALID");
  }

  try {
    return verifyPreviewRunnerCapabilityV1({
      token,
      publicKeyPem: node.publicKeyPem,
      expected: {
        nodeId: node.nodeId,
        agentVersion: qualification.agentVersion,
        sandboxProviderId: qualification.sandboxProviderId,
        sandboxRuntimeVersion: qualification.sandboxRuntimeVersion,
        isolationClass: qualification.isolationClass,
        runtimeProfileDigest: qualification.runtimeProfileDigest,
        sandboxPolicyDigest: qualification.sandboxPolicyDigest,
        qualificationRecordId: qualification.qualificationRecordId,
        evidenceMode: qualification.evidenceMode,
        evidenceKeyId: node.publicKeyFingerprint,
      },
      now,
    });
  } catch (error) {
    if (error instanceof PreviewRunnerCapabilityError) {
      throw new PreviewAgentCapabilityError(
        "PREVIEW_AGENT_CAPABILITY_INVALID",
      );
    }
    throw error;
  }
}

export async function acceptPreviewAgentCapabilityReport(input: {
  nodeId: string;
  qualificationRecordId: string;
  token: string;
  now?: Date;
}): Promise<{ nodeId: string; expiresAt: Date }> {
  const now = input.now ?? new Date();
  if (
    !UUID_PATTERN.test(input.nodeId) ||
    !UUID_PATTERN.test(input.qualificationRecordId) ||
    typeof input.token !== "string" ||
    input.token.length === 0 ||
    input.token.length > MAX_CAPABILITY_TOKEN_LENGTH ||
    !Number.isFinite(now.getTime())
  ) {
    throw new PreviewAgentCapabilityError(
      "PREVIEW_AGENT_CAPABILITY_INVALID",
    );
  }

  const qualification = previewRunnerQualificationRegistry.get(
    input.qualificationRecordId,
  );
  if (!qualification) {
    throw new PreviewAgentCapabilityError(
      "PREVIEW_AGENT_CAPABILITY_UNQUALIFIED",
    );
  }

  try {
    return await db.transaction(async (tx) => {
      const [node] = await tx
        .select()
        .from(previewAgentNodesTable)
        .where(eq(previewAgentNodesTable.nodeId, input.nodeId))
        .for("update")
        .limit(1);
      if (!node || node.status !== "active") {
        throw new PreviewAgentCapabilityError(
          "PREVIEW_AGENT_CAPABILITY_INVALID",
        );
      }
      const registeredFingerprint = node.publicKeyFingerprint;
      if (!registeredFingerprint) {
        throw new PreviewAgentCapabilityError(
          "PREVIEW_AGENT_CAPABILITY_INVALID",
        );
      }

      const verified = verifyPreviewAgentCapabilityReport({
        node,
        qualification,
        token: input.token,
        now,
      });
      const expiresAt = new Date(verified.expiresAt);
      const [updated] = await tx
        .update(previewAgentNodesTable)
        .set({
          capabilityReportToken: input.token,
          capabilityExpiresAt: expiresAt,
          lastSeenAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(previewAgentNodesTable.nodeId, node.nodeId),
            eq(previewAgentNodesTable.status, "active"),
            eq(previewAgentNodesTable.keyVersion, node.keyVersion),
            eq(
              previewAgentNodesTable.publicKeyFingerprint,
              registeredFingerprint,
            ),
          ),
        )
        .returning({ nodeId: previewAgentNodesTable.nodeId });
      if (!updated) {
        throw new PreviewAgentCapabilityError(
          "PREVIEW_AGENT_CAPABILITY_INVALID",
        );
      }
      return { nodeId: updated.nodeId, expiresAt };
    });
  } catch (error) {
    if (error instanceof PreviewAgentCapabilityError) throw error;
    throw new PreviewAgentCapabilityError(
      "PREVIEW_AGENT_CAPABILITY_UNAVAILABLE",
    );
  }
}
