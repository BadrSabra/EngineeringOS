import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getGitHubBranchState } from "./github-connector.js";

const { proxyFetch } = vi.hoisted(() => ({ proxyFetch: vi.fn() }));
vi.mock("@replit/connectors-sdk", () => ({
  ReplitConnectors: class {
    createProxyFetch() { return proxyFetch; }
  },
}));

beforeEach(() => {
  proxyFetch.mockReset();
  proxyFetch.mockImplementation((_path: string, init: RequestInit) =>
    new Promise((_resolve, reject) => {
      init.signal!.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }),
  );
});
afterEach(() => vi.useRealTimers());

describe("GitHub connector deadlines", () => {
  it("aborts a stalled connector request at its application deadline", async () => {
    vi.useFakeTimers();
    const request = getGitHubBranchState({
      remote: { owner: "fixture", repo: "repo" }, branch: "main", accessToken: "fixture-token",
    });
    const rejected = expect(request).rejects.toMatchObject({ code: "GITHUB_REQUEST_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(20_001);
    await rejected;
    expect(proxyFetch.mock.calls[0]![1].signal.aborted).toBe(true);
    expect(proxyFetch.mock.calls[0]![1].headers.Authorization).toBe("Bearer fixture-token");
    expect(proxyFetch.mock.calls[0]![1]).not.toHaveProperty("accessToken");
  });

  it("forwards caller cancellation to the actual connector fetch", async () => {
    const controller = new AbortController();
    const request = getGitHubBranchState({
      remote: { owner: "fixture", repo: "repo" }, branch: "main",
      accessToken: "fixture-token",
      signal: controller.signal,
    });
    controller.abort();
    await expect(request).rejects.toMatchObject({ code: "GITHUB_REQUEST_CANCELLED" });
    expect(proxyFetch.mock.calls[0]![1].signal.aborted).toBe(true);
  });

  it("bounds the wait even when SDK preparation does not react to cancellation", async () => {
    vi.useFakeTimers();
    proxyFetch.mockImplementationOnce(() => new Promise(() => undefined));
    const rejected = expect(getGitHubBranchState({
      remote: { owner: "fixture", repo: "repo" }, branch: "main", accessToken: "fixture-token",
    })).rejects.toMatchObject({ code: "GITHUB_REQUEST_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(20_001);
    await rejected;
  });

  it("does not start a connector request when already cancelled", async () => {
    await expect(getGitHubBranchState({
      remote: { owner: "fixture", repo: "repo" }, branch: "main",
      accessToken: "fixture-token",
      signal: AbortSignal.abort(),
    })).rejects.toMatchObject({ code: "GITHUB_REQUEST_CANCELLED" });
    expect(proxyFetch).not.toHaveBeenCalled();
  });

  it("redacts the PAT from connector error responses", async () => {
    proxyFetch.mockResolvedValueOnce({
      ok: false, status: 401,
      text: async () => JSON.stringify({ message: "invalid token fixture-token" }),
    });
    await expect(getGitHubBranchState({
      remote: { owner: "fixture", repo: "repo" }, branch: "main",
      accessToken: "fixture-token",
    })).rejects.toMatchObject({
      message: "invalid token [REDACTED]",
      code: "GITHUB_API_ERROR",
    });
  });
});
