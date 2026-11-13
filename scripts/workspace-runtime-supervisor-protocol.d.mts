import type { KeyObject } from "node:crypto";

export type WorkspaceRuntimeSupervisorAction = "start" | "adopt" | "stop" | "observe-start";
export type WorkspaceRuntimeSupervisorProcessIdentity =
  | null
  | { pid: number | null; port?: number | null; listenerIdentityDigest?: string | null };

export type WorkspaceRuntimeSupervisorCommandEnvelope = {
  version: 1;
  commandId: string;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
  action: WorkspaceRuntimeSupervisorAction;
  projectId: string;
  sessionId: string | null;
  stateVersion: string;
  processIdentity: WorkspaceRuntimeSupervisorProcessIdentity;
  bodySha256: string;
};

export declare const WORKSPACE_RUNTIME_SUPERVISOR_COMMAND_VERSION: 1;
export declare const WORKSPACE_RUNTIME_SUPERVISOR_COMMAND_TTL_MS: 15000;
export declare const WORKSPACE_RUNTIME_SUPERVISOR_COMMAND_MAX_TTL_MS: 30000;
export declare const WORKSPACE_RUNTIME_SUPERVISOR_COMMAND_CLOCK_SKEW_MS: 5000;

export declare function createWorkspaceRuntimeSupervisorCommand(input: {
  privateKey: KeyObject;
  action: WorkspaceRuntimeSupervisorAction;
  projectId: string;
  sessionId?: string | null;
  stateVersion: string;
  processIdentity?: WorkspaceRuntimeSupervisorProcessIdentity;
  body: string | Record<string, unknown>;
  now?: number;
}): {
  body: string;
  encodedCommand: string;
  signature: string;
  envelope: WorkspaceRuntimeSupervisorCommandEnvelope;
};

export declare function verifyWorkspaceRuntimeSupervisorCommand(input: {
  encodedCommand: string;
  signature: string;
  publicKey: KeyObject;
  body: string;
  now?: number;
}): WorkspaceRuntimeSupervisorCommandEnvelope;
