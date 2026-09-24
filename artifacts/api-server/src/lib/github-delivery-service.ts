import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { and, desc, eq } from "drizzle-orm";
import {
  aiChangeProposalsTable,
  db,
  eventsTable,
} from "@workspace/db";
import {
  getGitHubBranchState,
  GitHubConnectorError,
  parseGitHubRemote,
  pushLocalCommitToGitHub,
} from "./github-connector.js";
import { DELIVERY_TREE_DIGEST_VERSION, hashDeliveryTree } from "./delivery-workspace.js";

const execFileAsync = promisify(execFile);
const GIT_MAX_BUFFER = 2 * 1024 * 1024;

import type { GitHubRequest } from "./github-connector.js";

export type VerifiedGitHubDeliveryParams = {
  projectId: string;
  proposalId: string;
  operationId: string;
  rootPath: string;
  remoteUrl: string;
  branch: string;
  message: string;
  signal?: AbortSignal;
  request?: GitHubRequest;
};

export type VerifiedGitHubDeliveryResult = {
  status: "passed" | "blocked" | "unavailable";
  evidence?: {
    evidenceId: string;
    resultHash: string;
    artifactRef: string;
  };
  detail?: string;
  remoteCommitHash?: string;
  remoteParentHash?: string;
  remoteTreeHash?: string;
  operationMarker?: string;
  candidateTreeHash?: string;
  treeHash?: string;
  changedPaths?: string[];
  idempotent?: boolean;
};

type DeliveryProof = {
  baseTreeHash: string | null;
  candidateTreeHash: string | null;
  promotedTreeHash: string | null;
  treeDigestVersion: string | null;
  committedTreeHash: string | null;
};

async function gitText(rootPath: string, args: string[]): Promise<string> {
  const result = await execFileAsync("git", ["-C", rootPath, ...args], {
    maxBuffer: GIT_MAX_BUFFER,
    encoding: "utf8",
  });
  return String(result.stdout).trim();
}

async function findOperationEvent(
  projectId: string,
  type: string,
  correlationId: string,
): Promise<Record<string, unknown> | undefined> {
  const [event] = await db
    .select({ payload: eventsTable.payload })
    .from(eventsTable)
    .where(and(
      eq(eventsTable.projectId, projectId),
      eq(eventsTable.type, type),
      eq(eventsTable.correlationId, correlationId),
    ))
    .orderBy(desc(eventsTable.timestamp))
    .limit(1);
  return event?.payload && typeof event.payload === "object"
    ? event.payload as Record<string, unknown>
    : undefined;
}

function resultHash(value: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function passedResult(params: {
  operationId: string;
  commitHash: string;
  remoteCommitHash: string;
  remoteParentHash?: string;
  remoteTreeHash?: string;
  candidateTreeHash?: string;
  treeHash?: string;
  changedPaths: string[];
  idempotent?: boolean;
}): VerifiedGitHubDeliveryResult {
  const hash = resultHash({
    operationId: params.operationId,
    commitHash: params.commitHash,
    remoteCommitHash: params.remoteCommitHash,
    ...(params.remoteParentHash ? { remoteParentHash: params.remoteParentHash } : {}),
    ...(params.remoteTreeHash ? { remoteTreeHash: params.remoteTreeHash } : {}),
    ...(params.candidateTreeHash ? { candidateTreeHash: params.candidateTreeHash } : {}),
    ...(params.treeHash ? { treeHash: params.treeHash } : {}),
    changedPaths: params.changedPaths,
  });
  return {
    status: "passed",
    evidence: {
      evidenceId: `integration:${params.operationId}:${hash}`,
      resultHash: hash,
      artifactRef: `github-delivery:${params.operationId}:${hash}`,
    },
    remoteCommitHash: params.remoteCommitHash,
    ...(params.remoteParentHash ? { remoteParentHash: params.remoteParentHash } : {}),
    ...(params.remoteTreeHash ? { remoteTreeHash: params.remoteTreeHash } : {}),
    operationMarker: operationMarker(params.operationId),
    ...(params.candidateTreeHash ? { candidateTreeHash: params.candidateTreeHash } : {}),
    ...(params.treeHash ? { treeHash: params.treeHash } : {}),
    changedPaths: params.changedPaths,
    ...(params.idempotent ? { idempotent: true } : {}),
  };
}

function blocked(detail: string): VerifiedGitHubDeliveryResult {
  return { status: "blocked", detail };
}

function operationMarker(operationId: string): string {
  return `EngineeringOS-Operation: ${operationId}`;
}

function deliveryCommitMessage(message: string, operationId: string): string {
  return `${message.trim()}\n\n${operationMarker(operationId)}`;
}

async function localCommitIdentity(rootPath: string, commitHash: string): Promise<{
  parentHash: string;
  treeHash: string;
}> {
  const [parentHash, treeHash] = await Promise.all([
    gitText(rootPath, ["rev-parse", `${commitHash}^`]),
    gitText(rootPath, ["rev-parse", `${commitHash}^{tree}`]),
  ]);
  return { parentHash, treeHash };
}

async function recordGitHubPush(params: {
  projectId: string;
  proposalId: string;
  operationId: string;
  branch: string;
  remoteUrl: string;
  commitHash: string;
  remoteCommitHash: string;
  remoteParentHash?: string;
  remoteTreeHash?: string;
  changedPaths: string[];
  deliveryProof?: DeliveryProof;
}): Promise<void> {
  await db.insert(eventsTable).values({
    id: crypto.randomUUID(),
    type: "GitPushed",
    projectId: params.projectId,
    severity: "info",
    message: `Pushed branch "${params.branch}" through the verified GitHub delivery`,
    correlationId: params.operationId,
    payload: {
      proposalId: params.proposalId,
      operationId: params.operationId,
      commitHash: params.commitHash,
      remoteCommitHash: params.remoteCommitHash,
      ...(params.remoteParentHash ? { remoteParentHash: params.remoteParentHash } : {}),
      ...(params.remoteTreeHash ? { remoteTreeHash: params.remoteTreeHash } : {}),
      operationMarker: operationMarker(params.operationId),
      changedPaths: params.changedPaths,
      ...(params.deliveryProof ? params.deliveryProof : {}),
      branch: params.branch,
      remoteUrl: params.remoteUrl,
      treeDigestVersion: DELIVERY_TREE_DIGEST_VERSION,
    },
  });
}

function assertRemoteAfterState(
  state: Awaited<ReturnType<typeof getGitHubBranchState>>,
  localIdentity: { parentHash: string; treeHash: string },
  operationId: string,
  expectedCommitHash: string,
): void {
  if (
    state.commitHash !== expectedCommitHash
    || state.treeHash !== localIdentity.treeHash
    || state.parentHashes.length !== 1
    || state.parentHashes[0] !== localIdentity.parentHash
    || !state.message.includes(operationMarker(operationId))
  ) {
    throw new GitHubConnectorError(
      "GitHub delivery remote after-state did not match the server-owned commit.",
      "GITHUB_DELIVERY_AFTER_STATE_MISMATCH",
      409,
    );
  }
}

export async function executeVerifiedGitHubDelivery(
  params: VerifiedGitHubDeliveryParams,
): Promise<VerifiedGitHubDeliveryResult> {
  if (params.signal?.aborted) return blocked("GitHub delivery was cancelled before execution.");
  const remote = parseGitHubRemote(params.remoteUrl);
  if (!remote) return blocked("GitHub delivery requires a credential-free HTTPS GitHub remote.");

  const [proposal] = await db
    .select({
      lifecycle: aiChangeProposalsTable.lifecycle,
      operationId: aiChangeProposalsTable.operationId,
      baseTreeHash: aiChangeProposalsTable.baseTreeHash,
      candidateTreeHash: aiChangeProposalsTable.candidateTreeHash,
      promotedTreeHash: aiChangeProposalsTable.promotedTreeHash,
      treeDigestVersion: aiChangeProposalsTable.treeDigestVersion,
      committedTreeHash: aiChangeProposalsTable.committedTreeHash,
      commitHash: aiChangeProposalsTable.commitHash,
    })
    .from(aiChangeProposalsTable)
    .where(and(
      eq(aiChangeProposalsTable.id, params.proposalId),
      eq(aiChangeProposalsTable.projectId, params.projectId),
    ))
    .limit(1);

  if (!proposal || proposal.lifecycle !== "committed" || proposal.operationId !== params.operationId) {
    return blocked("GitHub delivery requires the same committed proposal operation.");
  }
  const deliveryProof: DeliveryProof = {
    baseTreeHash: proposal.baseTreeHash,
    candidateTreeHash: proposal.candidateTreeHash,
    promotedTreeHash: proposal.promotedTreeHash,
    treeDigestVersion: proposal.treeDigestVersion,
    committedTreeHash: proposal.committedTreeHash,
  };

  const existingPush = await findOperationEvent(params.projectId, "GitPushed", params.operationId);
  if (
    existingPush?.proposalId === params.proposalId
    && existingPush.operationId === params.operationId
    && typeof existingPush.commitHash === "string"
    && existingPush.commitHash === proposal.commitHash
    && typeof existingPush.remoteCommitHash === "string"
  ) {
    try {
      const localIdentity = await localCommitIdentity(params.rootPath, existingPush.commitHash);
      const remoteAfterState = await getGitHubBranchState({
        remote,
        branch: params.branch,
        ...(params.request ? { request: params.request } : {}),
      });
      assertRemoteAfterState(
        remoteAfterState,
        localIdentity,
        params.operationId,
        existingPush.commitHash,
      );
      return passedResult({
        operationId: params.operationId,
        commitHash: existingPush.commitHash,
        remoteCommitHash: remoteAfterState.commitHash,
        remoteParentHash: remoteAfterState.parentHashes[0],
        remoteTreeHash: remoteAfterState.treeHash,
        candidateTreeHash: proposal.candidateTreeHash ?? undefined,
        treeHash: proposal.committedTreeHash ?? undefined,
        changedPaths: Array.isArray(existingPush.changedPaths)
          ? existingPush.changedPaths.filter((value): value is string => typeof value === "string")
          : [],
        idempotent: true,
      });
    } catch {
      return {
        status: "unavailable",
        detail: "GitHub delivery could not independently verify the recorded remote after-state.",
      };
    }
  }

  const commitEvidence = await findOperationEvent(params.projectId, "GitCommitCreated", params.operationId);
  const commitHash = typeof commitEvidence?.commitHash === "string"
    ? commitEvidence.commitHash
    : undefined;
  const committedTreeHash = typeof commitEvidence?.committedTreeHash === "string"
    ? commitEvidence.committedTreeHash
    : undefined;
  if (
    !commitEvidence
    || commitEvidence.proposalId !== params.proposalId
    || commitEvidence.operationId !== params.operationId
    || !commitHash
    || !committedTreeHash
    || commitHash !== proposal.commitHash
    || committedTreeHash !== proposal.committedTreeHash
    || committedTreeHash !== proposal.promotedTreeHash
    || proposal.treeDigestVersion !== DELIVERY_TREE_DIGEST_VERSION
    || !proposal.baseTreeHash
    || !proposal.candidateTreeHash
    || proposal.candidateTreeHash !== proposal.promotedTreeHash
  ) {
    return blocked("GitHub delivery requires recorded commit evidence for this proposal.");
  }

  try {
    if (params.signal?.aborted) return blocked("GitHub delivery was cancelled before the remote mutation.");
    const liveTree = await hashDeliveryTree(params.rootPath);
    if (liveTree !== committedTreeHash) {
      return blocked("The repository changed after the recorded AI commit.");
    }
    const currentHead = await gitText(params.rootPath, ["rev-parse", "HEAD"]);
    if (currentHead !== commitHash) {
      return blocked("The repository HEAD changed after the recorded AI commit.");
    }

    const expectedMessage = deliveryCommitMessage(params.message, params.operationId);
    const pushed = await pushLocalCommitToGitHub({
      rootPath: params.rootPath,
      remote,
      branch: params.branch,
      commitHash,
      message: expectedMessage,
      ...(params.request ? { request: params.request } : {}),
    });
      const localIdentity = await localCommitIdentity(params.rootPath, commitHash);
      const remoteAfterState = await getGitHubBranchState({
        remote,
        branch: params.branch,
        ...(params.request ? { request: params.request } : {}),
      });
      assertRemoteAfterState(remoteAfterState, localIdentity, params.operationId, commitHash);
    const result = passedResult({
      operationId: params.operationId,
      commitHash,
      remoteCommitHash: pushed.remoteCommitHash,
        remoteParentHash: remoteAfterState.parentHashes[0],
        remoteTreeHash: remoteAfterState.treeHash,
      candidateTreeHash: proposal.candidateTreeHash,
      treeHash: committedTreeHash,
      changedPaths: pushed.changedPaths,
    });

    await recordGitHubPush({
      projectId: params.projectId,
      proposalId: params.proposalId,
      operationId: params.operationId,
      branch: params.branch,
      remoteUrl: params.remoteUrl,
      commitHash,
      remoteCommitHash: pushed.remoteCommitHash,
       remoteParentHash: remoteAfterState.parentHashes[0],
       remoteTreeHash: remoteAfterState.treeHash,
      changedPaths: pushed.changedPaths,
      deliveryProof,
    });
    return result;
  } catch (error) {
    if (error instanceof GitHubConnectorError && error.code === "GITHUB_PUSH_REMOTE_DRIFT") {
      try {
        const localIdentity = await localCommitIdentity(params.rootPath, commitHash);
        const branchState = await getGitHubBranchState({
          remote,
          branch: params.branch,
          ...(params.request ? { request: params.request } : {}),
        });
        const alreadyApplied = branchState.treeHash === localIdentity.treeHash
          && branchState.parentHashes.length === 1
          && branchState.parentHashes[0] === localIdentity.parentHash
          && branchState.message.includes(operationMarker(params.operationId));
        if (alreadyApplied) {
          const changedPaths = Array.isArray(commitEvidence.committedPaths)
            ? commitEvidence.committedPaths.filter((value): value is string => typeof value === "string")
            : [];
          const result = passedResult({
            operationId: params.operationId,
            commitHash,
            remoteCommitHash: branchState.commitHash,
            remoteParentHash: branchState.parentHashes[0],
            remoteTreeHash: branchState.treeHash,
            candidateTreeHash: proposal.candidateTreeHash ?? undefined,
            treeHash: proposal.committedTreeHash ?? undefined,
            changedPaths,
            idempotent: true,
          });
          await recordGitHubPush({
            projectId: params.projectId,
            proposalId: params.proposalId,
            operationId: params.operationId,
            branch: params.branch,
            remoteUrl: params.remoteUrl,
            commitHash,
            remoteCommitHash: branchState.commitHash,
            remoteParentHash: branchState.parentHashes[0],
            remoteTreeHash: branchState.treeHash,
            changedPaths,
            deliveryProof,
          });
          return result;
        }
      } catch {
        // Preserve the original drift classification when reconciliation is unavailable.
      }
      return blocked(error.message);
    }
    if (error instanceof GitHubConnectorError) {
      return {
        status: "unavailable",
        detail: error.code === "GITHUB_CONNECTOR_UNAVAILABLE"
          ? "GitHub integration is unavailable."
          : "GitHub delivery could not be verified.",
      };
    }
    return { status: "unavailable", detail: "GitHub delivery could not be completed." };
  }
}