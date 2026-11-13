import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyWorkspaceRuntimeSupervisorCommand } from "../../../../scripts/workspace-runtime-supervisor-protocol.mjs";
import {
  createWorkspaceRuntimeSupervisorStateVersion,
  WorkspaceRuntimeSupervisorClient,
  type WorkspaceRuntimeSupervisorRequestImpl,
} from "./workspace-runtime-supervisor-client.js";

const pair = generateKeyPairSync("ed25519");
const privateKey = pair.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
const publicKey = pair.publicKey;
const socketPath = "/tmp/eos-supervisor-test/control.sock";
const projectId = "project-runtime";
const sessionId = "session-runtime";
const stateVersion = createWorkspaceRuntimeSupervisorStateVersion({
  projectId,
  sessionId,
  revision: "revision-runtime",
  startedAt: "2026-11-13T00:00:00.000Z",
});

function successBody(path: string): string {
  if (path.endsWith("observe-start")) {
    return JSON.stringify({
      projectId,
      ownerProjectId: projectId,
      projectRoot: "/workspace/project-runtime",
      status: "stopped",
      observedAt: new Date().toISOString(),
      inventoryComplete: true,
      unknownListenerPorts: [],
      detail: "No tracked runtime session is live and all managed ports are accounted for.",
    });
  }
  return JSON.stringify({
    projectId,
    ownerProjectId: projectId,
    projectRoot: "/workspace/project-runtime",
    sessionId,
    status: "running",
    port: 3010,
    pid: 1234,
    listenerIdentityDigest: "c".repeat(64),
  });
}

function signedRequestRecorder(calls: Array<{
  path: string;
  body: string;
  action: string;
  projectId: string;
  sessionId: string | null;
  stateVersion: string;
  processIdentity: unknown;
}>): WorkspaceRuntimeSupervisorRequestImpl {
  return async (request) => {
    expect(request.socketPath).toBe(socketPath);
    const envelope = verifyWorkspaceRuntimeSupervisorCommand({
      encodedCommand: request.encodedCommand,
      signature: request.signature,
      publicKey,
      body: request.body,
    });
    calls.push({
      path: request.path,
      body: request.body,
      action: envelope.action,
      projectId: envelope.projectId,
      sessionId: envelope.sessionId,
      stateVersion: envelope.stateVersion,
      processIdentity: envelope.processIdentity,
    });
    return { status: 200, body: successBody(request.path) };
  };
}

describe("WorkspaceRuntimeSupervisorClient protected control channel", () => {
  it("uses a Unix socket and an Ed25519 command scoped to start/session/state", async () => {
    const calls: Array<{
      path: string; body: string; action: string; projectId: string;
      sessionId: string | null; stateVersion: string; processIdentity: unknown;
    }> = [];
    const client = new WorkspaceRuntimeSupervisorClient(
      socketPath,
      privateKey,
      signedRequestRecorder(calls),
    );

    const marker = "a".repeat(64);
    const listenerBindingDigest = "b".repeat(64);
    const response = await client.start({
      projectId,
      ownerProjectId: projectId,
      sessionId,
      stateVersion,
      projectRoot: "/workspace/project-runtime",
      attestationMarker: marker,
      listenerBindingDigest,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      path: "/runtime/start",
      action: "start",
      projectId,
      sessionId,
      stateVersion,
      processIdentity: null,
    });
    expect(JSON.parse(calls[0]!.body)).toMatchObject({
      projectId, ownerProjectId: projectId, sessionId, projectRoot: "/workspace/project-runtime",
      profile: "dev", attestationMarker: marker, listenerBindingDigest,
    });
    expect(response).not.toHaveProperty("attestationMarker");
    expect(JSON.stringify(response)).not.toContain(marker);
  });

  it("binds adoption to the exact pid, port, listener digest and session state", async () => {
    const calls: Array<{
      path: string; body: string; action: string; projectId: string;
      sessionId: string | null; stateVersion: string; processIdentity: unknown;
    }> = [];
    const client = new WorkspaceRuntimeSupervisorClient(socketPath, privateKey, signedRequestRecorder(calls));

    const response = await client.adopt({
      projectId,
      sessionId,
      stateVersion,
      projectRoot: "/workspace/project-runtime",
      pid: 1234,
      port: 3010,
      listenerBindingDigest: "d".repeat(64),
      expectedListenerIdentityDigest: "e".repeat(64),
    });

    expect(calls[0]).toMatchObject({
      path: "/runtime/adopt",
      action: "adopt",
      projectId,
      sessionId,
      stateVersion,
      processIdentity: {
        pid: 1234,
        port: 3010,
        listenerIdentityDigest: "e".repeat(64),
      },
    });
    expect(response.listenerIdentityDigest).toBe("c".repeat(64));
  });

  it("binds stop to the tracked process identity", async () => {
    const calls: Array<{
      path: string; body: string; action: string; projectId: string;
      sessionId: string | null; stateVersion: string; processIdentity: unknown;
    }> = [];
    const client = new WorkspaceRuntimeSupervisorClient(socketPath, privateKey, signedRequestRecorder(calls));

    await client.stop({
      projectId,
      ownerProjectId: projectId,
      sessionId,
      stateVersion,
      projectRoot: "/workspace/project-runtime",
      pid: 1234,
    });
    expect(calls[0]).toMatchObject({
      path: "/runtime/stop",
      action: "stop",
      projectId,
      sessionId,
      stateVersion,
      processIdentity: { pid: 1234 },
    });
  });

  it("issues a short-lived project-scoped inventory command without a session", async () => {
    const calls: Array<{
      path: string; body: string; action: string; projectId: string;
      sessionId: string | null; stateVersion: string; processIdentity: unknown;
    }> = [];
    const client = new WorkspaceRuntimeSupervisorClient(socketPath, privateKey, signedRequestRecorder(calls));

    await expect(client.observeStartState({
      projectId,
      ownerProjectId: projectId,
      projectRoot: "/workspace/project-runtime",
    })).resolves.toMatchObject({
      projectId,
      status: "stopped",
      inventoryComplete: true,
    });
    expect(calls[0]).toMatchObject({
      path: "/runtime/observe-start",
      action: "observe-start",
      projectId,
      ownerProjectId: projectId,
      sessionId: null,
      processIdentity: null,
    });
    expect(calls[0]!.stateVersion).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.parse(calls[0]!.body)).toEqual({
      projectId,
      ownerProjectId: projectId,
      projectRoot: "/workspace/project-runtime",
      sessionId: null,
    });
  });

  it("rejects when the signing key or socket configuration is missing", async () => {
    const missingSocket = new WorkspaceRuntimeSupervisorClient("", privateKey, async () => ({
      status: 200, body: "{}",
    }));
    await expect(missingSocket.observeStartState({
      projectId, ownerProjectId: projectId, projectRoot: "/workspace/project-runtime",
    })).rejects.toMatchObject({ status: 503 });

    const missingKey = new WorkspaceRuntimeSupervisorClient(socketPath, "", async () => ({
      status: 200, body: "{}",
    }));
    await expect(missingKey.observeStartState({
      projectId, ownerProjectId: projectId, projectRoot: "/workspace/project-runtime",
    })).rejects.toMatchObject({ status: 503 });
  });

  it("rejects an observation for a different project root", async () => {
    const client = new WorkspaceRuntimeSupervisorClient(
      socketPath,
      privateKey,
      async () => ({
        status: 200,
        body: JSON.stringify({
          projectId,
          ownerProjectId: projectId,
          projectRoot: "/workspace/another-project",
          status: "stopped",
          observedAt: new Date().toISOString(),
          inventoryComplete: true,
          unknownListenerPorts: [],
          detail: "No tracked runtime session is live.",
        }),
      }),
    );
    await expect(client.observeStartState({
      projectId,
      ownerProjectId: projectId,
      projectRoot: "/workspace/project-runtime",
    })).rejects.toMatchObject({ status: 409 });
  });

  it("rejects malformed supervisor JSON instead of treating it as a valid response", async () => {
    const client = new WorkspaceRuntimeSupervisorClient(socketPath, privateKey, async () => ({
      status: 200, body: "{invalid",
    }));
    await expect(client.observeStartState({
      projectId, ownerProjectId: projectId, projectRoot: "/workspace/project-runtime",
    })).rejects.toThrow("invalid JSON");
  });
});
