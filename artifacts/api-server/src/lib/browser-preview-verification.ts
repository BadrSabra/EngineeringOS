import { promises as fs } from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const PREVIEW_LIMITS = {
  maxLifetimeMs: 10 * 60 * 1000,
  maxScreenshotBytes: 2_000_000,
  maxSummaryChars: 8_000,
  maxConsoleMessages: 50,
  maxSteps: 24,
  maxValidationMs: 60_000,
} as const;

export type PreviewStatus = "starting" | "running" | "stopped" | "expired" | "unavailable" | "failed";
export type BrowserVerificationStatus = "passed" | "failed" | "unavailable";

export type PreviewSession = {
  id: string;
  projectRoot: string;
  revision: string;
  port: number;
  startedAt: string;
  expiresAt: string;
  status: PreviewStatus;
  error?: string;
};

export type PreviewEvidence = {
  kind: "browser_preview";
  operationId: string;
  executionId: string;
  revision: string;
  sessionId: string;
  status: BrowserVerificationStatus;
  summary: string;
  consoleErrors: string[];
  screenshotPath?: string;
  screenshotAvailable?: boolean;
  observedAt: string;
};

/** Server-approved browser contract. The model selects a profile; it never
 * supplies the origin, selectors, or navigation steps at execution time. */
export type PreviewValidationContract = {
  revision: string;
  permittedOrigin: string;
  steps: readonly PreviewStep[];
  timeoutMs?: number;
};

export type PreviewStep =
  | { type: "navigate"; path: string }
  | { type: "assert_visible"; selector: string }
  | { type: "assert_text"; selector: string; text: string }
  | { type: "read_visible_text"; selector?: string }
  | { type: "screenshot"; name: string };

export type PreviewPage = {
  goto(url: string): Promise<void>;
  url(): string;
  locator(selector: string): {
    isVisible(): Promise<boolean>;
    innerText(): Promise<string>;
  };
  screenshot(options?: { type: "png" }): Promise<Buffer>;
  close(): Promise<void>;
  onConsole?: (listener: (message: { type(): string; text(): string }) => void) => void;
};

export type PreviewBrowser = {
  newPage(): Promise<PreviewPage>;
  close(): Promise<void>;
};

export type PreviewProcess = {
  child: ChildProcess;
  waitUntilReady: (port: number, timeoutMs: number) => Promise<void>;
};

export type PreviewProcessFactory = (
  projectRoot: string,
  port: number,
  signal: AbortSignal,
) => Promise<PreviewProcess> | PreviewProcess;

function bounded(value: string, limit: number = PREVIEW_LIMITS.maxSummaryChars): string {
  const redacted = value
    .replace(/\b(?:api[_ -]?key|token|secret|password)\s*[:=]\s*\S+/gi, "[redacted]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted email]");
  return redacted.replace(/\s+/g, " ").trim().slice(0, limit);
}

function safeName(name: string): string {
  const normalized = name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
  return normalized || "preview";
}

function validatePort(port: number): void {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Preview port must be an integer between 1 and 65535.");
  }
}

function validateLifetime(lifetimeMs: number): void {
  if (!Number.isInteger(lifetimeMs) || lifetimeMs < 1 || lifetimeMs > PREVIEW_LIMITS.maxLifetimeMs) {
    throw new Error(`Preview lifetime must be between 1 and ${PREVIEW_LIMITS.maxLifetimeMs} ms.`);
  }
}

function validateContract(contract: PreviewValidationContract, session: PreviewSession): URL {
  if (contract.revision !== session.revision) throw new Error("Preview validation contract is stale.");
  const expected = new URL(`http://127.0.0.1:${session.port}`);
  const permitted = new URL(contract.permittedOrigin);
  if (permitted.origin !== expected.origin) {
    throw new Error("Preview validation origin is not permitted for the active session.");
  }
  if (contract.steps.length === 0 || contract.steps.length > PREVIEW_LIMITS.maxSteps) {
    throw new Error(`Preview validation must contain between 1 and ${PREVIEW_LIMITS.maxSteps} steps.`);
  }
  const timeoutMs = contract.timeoutMs ?? PREVIEW_LIMITS.maxValidationMs;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > PREVIEW_LIMITS.maxValidationMs) {
    throw new Error("Preview validation timeout exceeds its resource limit.");
  }
  return permitted;
}

async function defaultProcessFactory(projectRoot: string, port: number, signal: AbortSignal): Promise<PreviewProcess> {
  const child = spawn("pnpm", ["run", "dev"], {
    cwd: projectRoot,
    env: { ...process.env, PORT: String(port), BASE_PATH: "/" },
    detached: true,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const waitUntilReady = async (readyPort: number, timeoutMs: number): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error(`Preview process exited with code ${child.exitCode}.`);
      try {
        const response = await fetch(`http://127.0.0.1:${readyPort}/`, { signal });
        if (response.ok || response.status < 500) return;
      } catch {
        // The server is still starting.
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("Preview did not become ready before the startup deadline.");
  };
  return { child, waitUntilReady };
}

export class PreviewSessionManager {
  private process?: PreviewProcess;
  private timer?: NodeJS.Timeout;
  private startupController?: AbortController;
  private session?: PreviewSession;
  private readonly processFactory: PreviewProcessFactory;
  private readonly startupTimeoutMs: number;

  constructor(options?: {
    processFactory?: PreviewProcessFactory;
    startupTimeoutMs?: number;
  }) {
    this.processFactory = options?.processFactory ?? ((root, port, signal) => defaultProcessFactory(root, port, signal));
    this.startupTimeoutMs = options?.startupTimeoutMs ?? 30_000;
  }

  get current(): PreviewSession | undefined {
    return this.session ? { ...this.session } : undefined;
  }

  async start(input: {
    projectRoot: string;
    revision: string;
    port: number;
    lifetimeMs?: number;
  }): Promise<PreviewSession> {
    validatePort(input.port);
    const lifetimeMs = input.lifetimeMs ?? 120_000;
    validateLifetime(lifetimeMs);
    const projectRoot = await fs.realpath(input.projectRoot);
    await this.stop();
    const now = Date.now();
    const session: PreviewSession = {
      id: randomUUID(),
      projectRoot,
      revision: input.revision,
      port: input.port,
      startedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + lifetimeMs).toISOString(),
      status: "starting",
    };
    this.session = session;
    const controller = new AbortController();
    this.startupController = controller;
    try {
      this.process = await this.processFactory(projectRoot, input.port, controller.signal);
      await this.process.waitUntilReady(input.port, this.startupTimeoutMs);
      if (this.session?.id !== session.id) throw new Error("Preview session was superseded.");
      session.status = "running";
      this.timer = setTimeout(() => { void this.expire(session.id); }, lifetimeMs);
      return { ...session };
    } catch (error) {
      session.status = "unavailable";
      session.error = bounded(error instanceof Error ? error.message : String(error), 500);
      await this.stopProcess();
      return { ...session };
    }
  }

  async stop(): Promise<void> {
    if (this.session) this.session.status = "stopped";
    clearTimeout(this.timer);
    this.timer = undefined;
    await this.stopProcess();
  }

  private async expire(id: string): Promise<void> {
    if (this.session?.id !== id || this.session.status !== "running") return;
    this.session.status = "expired";
    await this.stopProcess();
  }

  private async stopProcess(): Promise<void> {
    this.startupController?.abort();
    this.startupController = undefined;
    const child = this.process?.child;
    this.process = undefined;
    if (!child || child.exitCode !== null) return;
    try {
      if (child.pid) process.kill(-child.pid, "SIGTERM");
      else child.kill("SIGTERM");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        try { if (child.pid) process.kill(-child.pid, "SIGKILL"); } catch { /* already gone */ }
        resolve();
      }, 2_000);
      child.once("exit", () => { clearTimeout(timeout); resolve(); });
    });
  }
}

export async function verifyBrowserPreview(input: {
  session: PreviewSession;
  expectedRevision?: string;
  contract?: PreviewValidationContract;
  operationId: string;
  executionId: string;
  steps: readonly PreviewStep[];
  browser: PreviewBrowser;
  screenshotDirectory?: string;
}): Promise<PreviewEvidence> {
  const observedAt = new Date().toISOString();
  const baseOrigin = `http://127.0.0.1:${input.session.port}`;
  const consoleErrors: string[] = [];
  if (input.contract) {
    try {
      validateContract(input.contract, input.session);
    } catch (error) {
      return {
        kind: "browser_preview", operationId: input.operationId, executionId: input.executionId,
        revision: input.session.revision, sessionId: input.session.id, status: "failed",
        summary: bounded(error instanceof Error ? error.message : String(error), 500),
        consoleErrors, observedAt,
      };
    }
  }
  if (input.expectedRevision !== undefined && input.expectedRevision !== input.session.revision) {
    return {
      kind: "browser_preview", operationId: input.operationId, executionId: input.executionId,
      revision: input.session.revision, sessionId: input.session.id, status: "failed",
      summary: "Preview revision is stale and cannot be used as validation evidence.",
      consoleErrors, observedAt,
    };
  }
  if (input.session.status !== "running") {
    return {
      kind: "browser_preview", operationId: input.operationId, executionId: input.executionId,
      revision: input.session.revision, sessionId: input.session.id, status: "unavailable",
      summary: `Preview is ${input.session.status}.`, consoleErrors, observedAt,
    };
  }
  let page: PreviewPage | undefined;
  try {
    page = await input.browser.newPage();
    const activePage = page;
    page.onConsole?.((message) => {
      if (message.type() === "error" && consoleErrors.length < PREVIEW_LIMITS.maxConsoleMessages) {
        consoleErrors.push(bounded(message.text(), 500));
      }
    });
    let visibleText = "";
    let screenshotPath: string | undefined;
    let screenshotAvailable = false;
    const steps = input.contract?.steps ?? input.steps;
    if (steps.length > PREVIEW_LIMITS.maxSteps) throw new Error("Preview validation exceeded its step limit.");
    const runSteps = async (): Promise<void> => {
    for (const step of steps) {
      if (step.type === "navigate") {
        const target = new URL(step.path, `${baseOrigin}/`);
        if (target.origin !== baseOrigin || target.username || target.password) {
          throw new Error("Browser navigation is restricted to the active Preview origin.");
        }
        await activePage.goto(target.toString());
        if (new URL(activePage.url()).origin !== baseOrigin) throw new Error("Preview navigated outside its origin.");
      } else if (step.type === "assert_visible" || step.type === "assert_text") {
        const locator = activePage.locator(step.selector);
        if (!(await locator.isVisible())) throw new Error(`Required element is not visible: ${step.selector}`);
        if (step.type === "assert_text" && !(await locator.innerText()).includes(step.text)) {
          throw new Error(`Required text was not found in ${step.selector}.`);
        }
      } else if (step.type === "read_visible_text") {
        visibleText = bounded(await (step.selector ? activePage.locator(step.selector).innerText() : activePage.locator("body").innerText()));
      } else {
        const bytes = await activePage.screenshot({ type: "png" });
        if (bytes.byteLength > PREVIEW_LIMITS.maxScreenshotBytes) throw new Error("Preview screenshot exceeded its resource limit.");
        screenshotAvailable = true;
        if (input.screenshotDirectory) {
          await fs.mkdir(input.screenshotDirectory, { recursive: true });
          screenshotPath = path.join(input.screenshotDirectory, `${safeName(step.name)}.png`);
          await fs.writeFile(screenshotPath, bytes);
        }
      }
    }
    };
    const timeoutMs = input.contract?.timeoutMs ?? PREVIEW_LIMITS.maxValidationMs;
    await Promise.race([
      runSteps(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Preview validation timed out.")), timeoutMs)),
    ]);
    if (consoleErrors.length > 0) {
      return {
        kind: "browser_preview", operationId: input.operationId, executionId: input.executionId,
        revision: input.session.revision, sessionId: input.session.id, status: "failed",
        summary: "Preview reported one or more Console errors.", consoleErrors, observedAt,
      };
    }
    return {
        kind: "browser_preview", operationId: input.operationId, executionId: input.executionId,
      revision: input.session.revision, sessionId: input.session.id, status: "passed",
        summary: bounded(visibleText || "Preview browser checks passed."),
        ...(screenshotAvailable ? { screenshotAvailable: true } : {}),
      consoleErrors, ...(screenshotPath ? { screenshotPath } : {}), observedAt,
    };
  } catch (error) {
    return {
      kind: "browser_preview", operationId: input.operationId, executionId: input.executionId,
      revision: input.session.revision, sessionId: input.session.id, status: "failed",
      summary: bounded(error instanceof Error ? error.message : String(error)),
      consoleErrors, observedAt,
    };
  } finally {
    await page?.close().catch(() => undefined);
    await input.browser.close().catch(() => undefined);
  }
}