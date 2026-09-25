import { describe, expect, it } from "vitest";
import { WorkspaceRuntimeSupervisorClient } from "./workspace-runtime-supervisor-client.js";

describe("WorkspaceRuntimeSupervisorClient child attestation handoff", () => {
  it("sends the temporary marker only in the start request body", async () => {
    const requests: Array<{ url: string; body: string }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push({
        url: String(input),
        body: String(init?.body ?? ""),
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
    const client = new WorkspaceRuntimeSupervisorClient("http://supervisor.test", fetchImpl);
    const marker = "ea195580-47e7-435b-9c64-8a3ee5ce7240";

    const response = await client.start({
      projectId: "project-runtime",
      sessionId: "session-runtime",
      projectRoot: "/tmp/project-runtime",
      attestationMarker: marker,
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("http://supervisor.test/runtime/start");
    expect(JSON.parse(requests[0]!.body)).toMatchObject({ attestationMarker: marker });
    expect(response).not.toHaveProperty("attestationMarker");
    expect(JSON.stringify(response)).not.toContain(marker);
  });
});