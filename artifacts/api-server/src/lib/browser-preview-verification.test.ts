import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import {
  PreviewSessionManager,
  PREVIEW_LIMITS,
  verifyBrowserPreview,
  type PreviewBrowser,
  type PreviewPage,
  type PreviewProcess,
} from "./browser-preview-verification.js";

function fakeChild(): ChildProcess {
  const child = new EventEmitter() as ChildProcess;
  Object.assign(child, { pid: undefined, exitCode: null, kill: vi.fn() });
  return child;
}

function processFactory(options?: { fail?: boolean; child?: ChildProcess }) {
  return vi.fn(async (): Promise<PreviewProcess> => ({
    child: options?.child ?? fakeChild(),
    waitUntilReady: async () => {
      if (options?.fail) throw new Error("preview failed to bind");
    },
  }));
}

function browserFactory(options?: { consoleError?: boolean; externalUrl?: boolean }): PreviewBrowser {
  const page: PreviewPage = {
    goto: async () => undefined,
    url: () => options?.externalUrl ? "https://attacker.example/" : "http://127.0.0.1:4312/",
    locator: () => ({
      isVisible: async () => true,
      innerText: async () => "Dashboard ready",
    }),
    screenshot: async () => Buffer.from("png"),
    close: vi.fn(async () => undefined),
    onConsole: (listener) => {
      if (options?.consoleError) listener({ type: () => "error", text: () => "secret=do-not-persist" });
    },
  };
  return { newPage: async () => page, close: vi.fn(async () => undefined) };
}

describe("browser preview verification", () => {
  it("starts and stops an isolated project preview", async () => {
    const child = fakeChild();
    const factory = processFactory({ child });
    const manager = new PreviewSessionManager({ processFactory: factory });
    const session = await manager.start({
      projectRoot: process.cwd(),
      revision: "rev-a",
      port: 4312,
      lifetimeMs: 5_000,
    });

    expect(session.status).toBe("running");
    expect(session.projectRoot).toBe(process.cwd());
    expect(factory).toHaveBeenCalledWith(process.cwd(), 4312, expect.any(AbortSignal));
    await manager.stop();
    expect(manager.current?.status).toBe("stopped");
    expect((child.kill as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith("SIGTERM");
  });

  it("marks startup failure unavailable and never claims success", async () => {
    const manager = new PreviewSessionManager({ processFactory: processFactory({ fail: true }) });
    const session = await manager.start({
      projectRoot: process.cwd(), revision: "rev-a", port: 4313, lifetimeMs: 5_000,
    });
    expect(session.status).toBe("unavailable");
    const evidence = await verifyBrowserPreview({
      session, operationId: "op", executionId: "exec", steps: [], browser: browserFactory(),
    });
    expect(evidence.status).toBe("unavailable");
  });

  it("rejects stale revisions and external navigation", async () => {
    const session = {
      id: "session-a", projectRoot: process.cwd(), revision: "rev-a", port: 4312,
      startedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 1000).toISOString(),
      status: "running" as const,
    };
    const stale = await verifyBrowserPreview({
      session, expectedRevision: "rev-b", operationId: "op", executionId: "exec",
      steps: [], browser: browserFactory(),
    });
    expect(stale.status).toBe("failed");
    expect(stale.summary).toContain("stale");
    const external = await verifyBrowserPreview({
      session, operationId: "op", executionId: "exec",
      steps: [{ type: "navigate", path: "https://attacker.example/" }],
      browser: browserFactory(),
    });
    expect(external.status).toBe("failed");
    expect(external.summary).toContain("restricted");
  });

  it("returns bounded visible evidence and fails on Console errors", async () => {
    const session = {
      id: "session-b", projectRoot: process.cwd(), revision: "rev-a", port: 4312,
      startedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 1000).toISOString(),
      status: "running" as const,
    };
    const success = await verifyBrowserPreview({
      session, operationId: "op", executionId: "exec",
      steps: [
        { type: "navigate", path: "/" },
        { type: "assert_visible", selector: "[data-testid=ready]" },
        { type: "read_visible_text" },
        { type: "screenshot", name: "dashboard" },
      ],
      browser: browserFactory(),
    });
    expect(success.status).toBe("passed");
    expect(success.summary).toBe("Dashboard ready");
    expect(success.screenshotPath).toBeUndefined();
    expect(success.summary.length).toBeLessThanOrEqual(PREVIEW_LIMITS.maxSummaryChars);

    const consoleFailure = await verifyBrowserPreview({
      session, operationId: "op", executionId: "exec", steps: [], browser: browserFactory({ consoleError: true }),
    });
    expect(consoleFailure.status).toBe("failed");
    expect(consoleFailure.consoleErrors.join(" ")).not.toContain("secret=do-not-persist");
  });

  it("rejects a contract whose revision or origin is not server-approved", async () => {
    const session = {
      id: "session-contract", projectRoot: process.cwd(), revision: "rev-a", port: 4312,
      startedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 1000).toISOString(),
      status: "running" as const,
    };
    const stale = await verifyBrowserPreview({
      session, operationId: "op", executionId: "exec", steps: [],
      contract: {
        revision: "rev-b",
        permittedOrigin: "http://127.0.0.1:4312",
        steps: [{ type: "assert_visible", selector: "body" }],
      },
      browser: browserFactory(),
    });
    expect(stale.status).toBe("failed");
    expect(stale.summary).toContain("stale");

    const hostile = await verifyBrowserPreview({
      session, operationId: "op", executionId: "exec", steps: [],
      contract: {
        revision: "rev-a",
        permittedOrigin: "https://attacker.example",
        steps: [{ type: "assert_visible", selector: "body" }],
      },
      browser: browserFactory(),
    });
    expect(hostile.status).toBe("failed");
    expect(hostile.summary).toContain("origin");
  });

  it("fails closed when a contract exceeds the step bound", async () => {
    const session = {
      id: "session-bounds", projectRoot: process.cwd(), revision: "rev-a", port: 4312,
      startedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 1000).toISOString(),
      status: "running" as const,
    };
    const result = await verifyBrowserPreview({
      session, operationId: "op", executionId: "exec", steps: [],
      contract: {
        revision: "rev-a",
        permittedOrigin: "http://127.0.0.1:4312",
        steps: Array.from({ length: PREVIEW_LIMITS.maxSteps + 1 }, () => ({ type: "assert_visible", selector: "body" })),
      },
      browser: browserFactory(),
    });
    expect(result.status).toBe("failed");
    expect(result.summary).toContain("between 1");
  });

  it("expires within the configured lifetime and keeps sessions isolated", async () => {
    const firstChild = fakeChild();
    const secondChild = fakeChild();
    const factory = vi.fn()
      .mockResolvedValueOnce({ child: firstChild, waitUntilReady: async () => undefined })
      .mockResolvedValueOnce({ child: secondChild, waitUntilReady: async () => undefined });
    const manager = new PreviewSessionManager({ processFactory: factory, startupTimeoutMs: 100 });
    const first = await manager.start({ projectRoot: process.cwd(), revision: "one", port: 4314, lifetimeMs: 20 });
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(manager.current?.status).toBe("expired");
    const second = await manager.start({ projectRoot: process.cwd(), revision: "two", port: 4315, lifetimeMs: 5_000 });
    expect(second.id).not.toBe(first.id);
    expect(second.revision).toBe("two");
    await manager.stop();
    expect((firstChild.kill as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
    expect(PREVIEW_LIMITS.maxLifetimeMs).toBeGreaterThan(20);
  });
});