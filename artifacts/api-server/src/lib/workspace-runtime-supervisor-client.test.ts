import { describe, expect, it } from "vitest";
import { signWorkspaceRuntimeSupervisorCommand, WorkspaceRuntimeSupervisorClient } from "./workspace-runtime-supervisor-client.js";

const testCommandSecret = "workspace-runtime-supervisor-command-test-secret";

describe("WorkspaceRuntimeSupervisorClient child attestation handoff", () => {
  it("sends the temporary marker only in the start request body", async () => {
    const requests: Array<{ url: string; body: string; authorization: string | undefined; signature: string | undefined }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const headers = init?.headers as Record<string, string> | undefined;
      requests.push({
        url: String(input),
        body: String(init?.body ?? ""),
        authorization: headers?.authorization,
        signature: headers?.["x-engineeringos-command-signature"],
      });
      return new Response(JSON.stringify({
        projectId: "project-runtime",
        sessionId: "session-runtime",
        status: "running",
        port: 3210,
        pid: 1234,
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const client = new WorkspaceRuntimeSupervisorClient(
      "http://supervisor.test",
      fetchImpl,
      "test-supervisor-token",
      testCommandSecret,
    );
    const marker = "a".repeat(64);
    const listenerBindingDigest = "b".repeat(64);

    const response = await client.start({
      projectId: "project-runtime",
      ownerProjectId: "project-runtime",
      sessionId: "session-runtime",
      projectRoot: "/tmp/project-runtime",
      attestationMarker: marker,
      listenerBindingDigest,
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("http://supervisor.test/runtime/start");
    expect(requests[0]?.authorization).toBe("Bearer test-supervisor-token");
    expect(requests[0]?.signature).toBe(signWorkspaceRuntimeSupervisorCommand(
      testCommandSecret,
      "/runtime/start",
      requests[0]!.body,
    ));
    expect(JSON.parse(requests[0]!.body)).toMatchObject({
      attestationMarker: marker,
      listenerBindingDigest,
    });
    expect(response).not.toHaveProperty("attestationMarker");
    expect(JSON.stringify(response)).not.toContain(marker);
  });

  it("sends the recovery marker and expected listener identity only to the supervisor", async () => {
    const requests: Array<{ url: string; body: string }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push({ url: String(input), body: String(init?.body ?? "") });
      return new Response(JSON.stringify({
        projectId: "project-runtime",
        sessionId: "session-runtime",
        status: "running",
        port: 3010,
        pid: 1234,
        listenerIdentityDigest: "c".repeat(64),
      }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const client = new WorkspaceRuntimeSupervisorClient(
      "http://supervisor.test",
      fetchImpl,
      "test-supervisor-token",
      testCommandSecret,
    );
    const marker = "d".repeat(64);

    const response = await client.adopt({
      projectId: "project-runtime",
      ownerProjectId: "project-runtime",
      sessionId: "session-runtime",
      projectRoot: "/tmp/project-runtime",
      pid: 1234,
      port: 3010,
      listenerBindingDigest: "e".repeat(64),
      expectedListenerIdentityDigest: "f".repeat(64),
      attestationMarker: marker,
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("http://supervisor.test/runtime/adopt");
    expect(JSON.parse(requests[0]!.body)).toMatchObject({
      listenerBindingDigest: "e".repeat(64),
      expectedListenerIdentityDigest: "f".repeat(64),
      attestationMarker: marker,
    });
    expect(response.listenerIdentityDigest).toBe("c".repeat(64));
    expect(JSON.stringify(response)).not.toContain(marker);
  });

  it("observes a strictly validated start state", async () => {
    const requests: Array<{ url: string; body: string; authorization: string | undefined; signature: string | undefined }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const headers = init?.headers as Record<string, string> | undefined;
      requests.push({
        url: String(input),
        body: String(init?.body ?? ""),
        authorization: headers?.authorization,
        signature: headers?.["x-engineeringos-command-signature"],
      });
      return new Response(JSON.stringify({
        projectId: "project-runtime",
        ownerProjectId: "project-runtime",
        status: "stopped",
        observedAt: "2025-01-01T00:00:00.000Z",
        inventoryComplete: true,
        unknownListenerPorts: [],
        detail: "No tracked runtime session is live and all managed ports are accounted for.",
      }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const client = new WorkspaceRuntimeSupervisorClient(
      "http://supervisor.test",
      fetchImpl,
      "test-supervisor-token",
      testCommandSecret,
    );

    await expect(client.observeStartState({ projectId: "project-runtime", ownerProjectId: "project-runtime" })).resolves.toMatchObject({
      projectId: "project-runtime",
      ownerProjectId: "project-runtime",
      status: "stopped",
      inventoryComplete: true,
    });
    expect(requests).toEqual([{
      url: "http://supervisor.test/runtime/observe-start",
      body: JSON.stringify({ projectId: "project-runtime", ownerProjectId: "project-runtime" }),
      authorization: "Bearer test-supervisor-token",
      signature: signWorkspaceRuntimeSupervisorCommand(
        testCommandSecret,
        "/runtime/observe-start",
        JSON.stringify({ projectId: "project-runtime", ownerProjectId: "project-runtime" }),
      ),
    }]);
  });

  it("accepts a corroborated running session alongside unrelated unowned listeners", async () => {
    const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({
      projectId: "project-runtime",
      ownerProjectId: "project-runtime",
      status: "running",
      observedAt: "2025-01-01T00:00:00.000Z",
      inventoryComplete: true,
      unknownListenerPorts: [3011],
      detail: "The target session is corroborated; another listener is unowned.",
      session: {
        projectId: "project-runtime",
        sessionId: "session-runtime",
        status: "running",
        port: 3010,
        pid: 1234,
      },
    }), { status: 200, headers: { "content-type": "application/json" } });
    const client = new WorkspaceRuntimeSupervisorClient(
      "http://supervisor.test",
      fetchImpl,
      "test-supervisor-token",
      testCommandSecret,
    );

    await expect(client.observeStartState({ projectId: "project-runtime", ownerProjectId: "project-runtime" })).resolves.toMatchObject({
      projectId: "project-runtime",
      ownerProjectId: "project-runtime",
      status: "running",
      unknownListenerPorts: [3011],
      session: {
        projectId: "project-runtime",
        sessionId: "session-runtime",
        status: "running",
        port: 3010,
        pid: 1234,
      },
    });
  });

  it("rejects an invalid observation payload", async () => {
    const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({
      projectId: "project-runtime",
      ownerProjectId: "project-runtime",
      status: "stopped",
      observedAt: "not-a-date",
      inventoryComplete: false,
      unknownListenerPorts: [],
      detail: "",
    }), { status: 200 });
    const client = new WorkspaceRuntimeSupervisorClient(
      "http://supervisor.test",
      fetchImpl,
      "test-supervisor-token",
      testCommandSecret,
    );

    await expect(client.observeStartState({ projectId: "project-runtime", ownerProjectId: "project-runtime" })).rejects.toThrow(
      "invalid observation",
    );
  });

  it("rejects a stopped result when a managed listener is unowned", async () => {
    const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({
      projectId: "project-runtime",
      ownerProjectId: "project-runtime",
      status: "stopped",
      observedAt: "2025-01-01T00:00:00.000Z",
      inventoryComplete: true,
      unknownListenerPorts: [3010],
      detail: "Unowned listener exists.",
    }), { status: 200 });
    const client = new WorkspaceRuntimeSupervisorClient(
      "http://supervisor.test",
      fetchImpl,
      "test-supervisor-token",
      testCommandSecret,
    );

    await expect(client.observeStartState({ projectId: "project-runtime", ownerProjectId: "project-runtime" })).rejects.toThrow(
      "invalid observation",
    );
  });
});