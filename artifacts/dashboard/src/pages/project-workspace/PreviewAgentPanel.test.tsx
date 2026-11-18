import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PreviewAgentPanel from "./PreviewAgentPanel";

const nodeId = "6c4e0ec3-7a2b-4dd2-8a70-b2748d07b20e";
const storeId = "806e43e7-7f22-4fd8-8eb2-c87de6d7ce77";
const pairingCode = "one-time-code-that-must-not-enter-the-command";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function renderPanel(projectId = "project-1") {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <PreviewAgentPanel projectId={projectId} />
    </QueryClientProvider>,
  );
  return {
    queryClient,
    rerenderProject(nextProjectId: string) {
      view.rerender(
        <QueryClientProvider client={queryClient}>
          <PreviewAgentPanel projectId={nextProjectId} />
        </QueryClientProvider>,
      );
    },
  };
}

beforeEach(() => {
  vi.stubGlobal(
    "crypto",
    { randomUUID: vi.fn(() => storeId) } as unknown as Crypto,
  );
  vi.stubGlobal("confirm", vi.fn(() => true));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PreviewAgentPanel", () => {
  it("shows persisted pairing and heartbeat facts without claiming the agent is online", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse([
        {
          nodeId,
          projectId: "project-1",
          storeId,
          status: "active",
          publicKeyFingerprint: "SHA256:public-only-fingerprint",
          agentVersion: "1.0.0",
          platform: "linux",
          keyVersion: 1,
          pairingExpiresAt: null,
          pairedAt: "2026-11-13T10:00:00.000Z",
          lastSeenAt: "2026-11-13T10:01:00.000Z",
          revokedAt: null,
          createdAt: "2026-11-13T09:55:00.000Z",
        },
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderPanel();

    expect(await screen.findByText("مقترن")).toBeInTheDocument();
    expect(screen.getByText(/آخر نبضة مسجلة:/)).toBeInTheDocument();
    expect(screen.queryByText(/متصل الآن/)).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/project-1/preview-agents",
      { credentials: "include", cache: "no-store" },
    );
  });

  it("keeps the one-time code in volatile UI state and never puts it in the CLI command", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(
        jsonResponse({
          nodeId,
          storeId,
          pairingCode,
          expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
        }, 201),
      )
      .mockResolvedValueOnce(jsonResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "ربط جهاز Linux" }));

    expect(await screen.findByText(pairingCode)).toBeInTheDocument();
    const command = screen.getByText(/preview-agent-client\/dist\/cli\.js pair/);
    expect(command.textContent).toContain(`--node ${nodeId}`);
    expect(command.textContent).toContain(`--store ${storeId}`);
    expect(command.textContent).not.toContain(pairingCode);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/projects/project-1/preview-agents/pairings",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        cache: "no-store",
        body: JSON.stringify({ storeId }),
      }),
    );
    expect(screen.getByText(/لا يشغّل Candidate/)).toBeInTheDocument();
  });

  it("reuses the same store identity when the pairing response is lost", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([]))
      .mockRejectedValueOnce(new TypeError("network unavailable"))
      .mockResolvedValueOnce(
        jsonResponse({
          nodeId,
          storeId,
          pairingCode,
          expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
        }, 201),
      )
      .mockResolvedValueOnce(jsonResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "ربط جهاز Linux" }));
    expect(await screen.findByText(/سيستخدم الطلب الهوية نفسها/)).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "إعادة محاولة الاقتران" }),
    );
    expect(await screen.findByText(pairingCode)).toBeInTheDocument();
    const postCalls = fetchMock.mock.calls.filter(
      ([url]) => url === "/api/projects/project-1/preview-agents/pairings",
    );
    expect(postCalls).toHaveLength(2);
    expect(JSON.parse(String(postCalls[0][1]?.body))).toEqual({ storeId });
    expect(JSON.parse(String(postCalls[1][1]?.body))).toEqual({ storeId });
  });

  it("clears one-time pairing material when the Workspace changes projects", async () => {
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/preview-agents/pairings")) {
        return Promise.resolve(jsonResponse({
          nodeId,
          storeId,
          pairingCode,
          expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
        }, 201));
      }
      return Promise.resolve(jsonResponse([]));
    });
    vi.stubGlobal("fetch", fetchMock);

    const view = renderPanel("project-1");
    fireEvent.click(await screen.findByRole("button", { name: "ربط جهاز Linux" }));
    expect(await screen.findByText(pairingCode)).toBeInTheDocument();

    view.rerenderProject("project-2");

    expect(screen.queryByText(pairingCode)).not.toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "ربط جهاز Linux" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/project-1/preview-agents/pairings",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/project-2/preview-agents",
      expect.anything(),
    );
  });

  it("ignores a pairing response that arrives after the user switches projects", async () => {
    let resolvePairing: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/projects/project-1/preview-agents/pairings") {
        return new Promise<Response>((resolve) => {
          resolvePairing = resolve;
        });
      }
      return Promise.resolve(jsonResponse([]));
    });
    vi.stubGlobal("fetch", fetchMock);

    const view = renderPanel("project-1");
    fireEvent.click(await screen.findByRole("button", { name: "ربط جهاز Linux" }));
    await waitFor(() => expect(resolvePairing).toBeTypeOf("function"));

    view.rerenderProject("project-2");

    await act(async () => {
      resolvePairing?.(jsonResponse({
        nodeId,
        storeId,
        pairingCode,
        expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      }, 201));
    });

    expect(screen.queryByText(pairingCode)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ربط جهاز Linux" })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/projects/project-2/preview-agents/pairings",
      expect.anything(),
    );
  });

  it("does not carry an uncertain retry store identity into another project", async () => {
    const firstStoreId = "first-project-store";
    const secondStoreId = "second-project-store";
    const randomUUID = vi.fn()
      .mockReturnValueOnce(firstStoreId)
      .mockReturnValueOnce(secondStoreId);
    vi.stubGlobal("crypto", { randomUUID } as unknown as Crypto);

    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/projects/project-1/preview-agents/pairings") {
        return Promise.reject(new TypeError("network unavailable"));
      }
      if (url === "/api/projects/project-2/preview-agents/pairings") {
        return Promise.resolve(jsonResponse({
          nodeId,
          storeId: secondStoreId,
          pairingCode,
          expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
        }, 201));
      }
      return Promise.resolve(jsonResponse([]));
    });
    vi.stubGlobal("fetch", fetchMock);

    const view = renderPanel("project-1");
    fireEvent.click(await screen.findByRole("button", { name: "ربط جهاز Linux" }));
    expect(await screen.findByText(/سيستخدم الطلب الهوية نفسها/)).toBeInTheDocument();

    view.rerenderProject("project-2");
    fireEvent.click(await screen.findByRole("button", { name: "ربط جهاز Linux" }));
    expect(await screen.findByText(pairingCode)).toBeInTheDocument();

    const postCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).endsWith("/preview-agents/pairings"),
    );
    expect(postCalls).toHaveLength(2);
    expect(JSON.parse(String(postCalls[0]?.[1]?.body))).toEqual({ storeId: firstStoreId });
    expect(JSON.parse(String(postCalls[1]?.[1]?.body))).toEqual({ storeId: secondStoreId });
    expect(randomUUID).toHaveBeenCalledTimes(2);
  });

  it("revokes only the selected node after explicit confirmation", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse([
          {
            nodeId,
            projectId: "project-1",
            storeId,
            status: "active",
            publicKeyFingerprint: null,
            agentVersion: null,
            platform: "linux",
            keyVersion: 1,
            pairingExpiresAt: null,
            pairedAt: null,
            lastSeenAt: null,
            revokedAt: null,
            createdAt: "2026-11-13T09:55:00.000Z",
          },
        ]),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          nodeId,
          storeId,
          status: "revoked",
          keyVersion: 1,
          revokedAt: "2026-11-13T10:02:00.000Z",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse([
          {
            nodeId,
            projectId: "project-1",
            storeId,
            status: "revoked",
            publicKeyFingerprint: null,
            agentVersion: null,
            platform: "linux",
            keyVersion: 1,
            pairingExpiresAt: null,
            pairedAt: null,
            lastSeenAt: null,
            revokedAt: "2026-11-13T10:02:00.000Z",
            createdAt: "2026-11-13T09:55:00.000Z",
          },
        ]),
      );
    vi.stubGlobal("fetch", fetchMock);

    renderPanel();
    fireEvent.click(
      await screen.findByRole("button", {
        name: `إلغاء اقتران الجهاز ${nodeId.slice(0, 8)}`,
      }),
    );

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/projects/project-1/preview-agents/${nodeId}/revoke`,
        expect.objectContaining({
          method: "POST",
          credentials: "include",
          cache: "no-store",
        }),
      ),
    );
    expect(globalThis.confirm).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("ملغى")).toBeInTheDocument();
  });
});
