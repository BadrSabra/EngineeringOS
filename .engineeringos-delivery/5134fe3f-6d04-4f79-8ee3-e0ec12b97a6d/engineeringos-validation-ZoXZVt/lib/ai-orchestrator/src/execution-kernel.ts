import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

export const EXECUTION_LIMITS = {
  maxTimeoutMs: 10 * 60 * 1000,
  maxOutputBytes: 8 * 1024 * 1024,
} as const;

export type BoundedCommandSpec = {
  command: string;
  args: string[];
  rootPath: string;
  cwd?: string;
  timeoutMs: number;
  maxOutputBytes: number;
  allowedCommands?: ReadonlySet<string>;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
};

export type BoundedCommandStatus = "passed" | "failed" | "timed_out" | "cancelled" | "spawn_error";

export type BoundedCommandResult = {
  status: BoundedCommandStatus;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  combinedOutput: string;
  truncated: boolean;
  durationMs: number;
};

function sanitizeOutput(value: string, rootPath: string): string {
  return value
    .replaceAll(rootPath, "[project path]")
    .replace(/(?:\/home\/[^ \n\t"'`]+|\/tmp\/[^ \n\t"'`]+|\/workspace\/[^ \n\t"'`]+)/g, "[runtime path]")
    .replace(/((?:api[_-]?key|token|secret|password))\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]");
}

function commandName(command: string): string {
  return path.basename(command).toLowerCase();
}

function validateLimits(spec: BoundedCommandSpec): void {
  if (!spec.command || spec.command.includes("\0")) {
    throw new Error("Execution command is required and must not contain null bytes.");
  }
  if (!Number.isInteger(spec.timeoutMs) || spec.timeoutMs < 1 || spec.timeoutMs > EXECUTION_LIMITS.maxTimeoutMs) {
    throw new Error(`Execution timeout must be an integer between 1 and ${EXECUTION_LIMITS.maxTimeoutMs} ms.`);
  }
  if (!Number.isInteger(spec.maxOutputBytes) || spec.maxOutputBytes < 1 || spec.maxOutputBytes > EXECUTION_LIMITS.maxOutputBytes) {
    throw new Error(`Execution output limit must be an integer between 1 and ${EXECUTION_LIMITS.maxOutputBytes} bytes.`);
  }
  if (spec.args.some((arg) => arg.includes("\0"))) {
    throw new Error("Execution arguments must not contain null bytes.");
  }
  if (spec.allowedCommands && !spec.allowedCommands.has(commandName(spec.command))) {
    throw new Error(`Command "${commandName(spec.command)}" is not allowed by this execution policy.`);
  }
}

type ExecutionBoundary = {
  realRoot: string;
  realCwd: string;
  rootIdentity: { dev: number; ino: number };
  cwdIdentity: { dev: number; ino: number };
};

async function resolveContainedCwd(rootPath: string, cwd: string): Promise<ExecutionBoundary> {
  const [realRoot, realCwd, rootStats, cwdStats] = await Promise.all([
    fs.realpath(rootPath),
    fs.realpath(cwd),
    fs.stat(rootPath),
    fs.stat(cwd),
  ]);
  if (!rootStats.isDirectory() || !cwdStats.isDirectory()) {
    throw new Error("Execution root and working directory must be directories.");
  }
  const relative = path.relative(realRoot, realCwd);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Execution working directory must remain inside the project root.");
  }
  return {
    realRoot,
    realCwd,
    rootIdentity: { dev: rootStats.dev, ino: rootStats.ino },
    cwdIdentity: { dev: cwdStats.dev, ino: cwdStats.ino },
  };
}

/**
 * Re-resolve the boundary after all asynchronous setup and immediately before
 * spawn. A previously checked cwd is not trusted: replacing either the root
 * or a cwd symlink during setup must fail closed rather than execute in the
 * replacement workspace.
 */
async function revalidateExecutionBoundary(
  rootPath: string,
  cwdPath: string,
  expected: ExecutionBoundary,
): Promise<string> {
  const current = await resolveContainedCwd(rootPath, cwdPath);
  if (
    current.realRoot !== expected.realRoot ||
    current.realCwd !== expected.realCwd ||
    current.rootIdentity.dev !== expected.rootIdentity.dev ||
    current.rootIdentity.ino !== expected.rootIdentity.ino ||
    current.cwdIdentity.dev !== expected.cwdIdentity.dev ||
    current.cwdIdentity.ino !== expected.cwdIdentity.ino
  ) {
    throw new Error("Execution root or working directory changed before command start.");
  }
  return current.realCwd;
}

function appendBounded(
  current: string,
  chunk: string,
  remaining: { value: number },
): { value: string; truncated: boolean } {
  if (remaining.value <= 0) return { value: current, truncated: chunk.length > 0 };
  if (Buffer.byteLength(chunk, "utf8") <= remaining.value) {
    remaining.value -= Buffer.byteLength(chunk, "utf8");
    return { value: current + chunk, truncated: false };
  }
  const buffer = Buffer.from(chunk, "utf8");
  const bounded = buffer.subarray(0, remaining.value).toString("utf8");
  remaining.value = 0;
  return { value: current + bounded, truncated: true };
}

/**
 * Run one non-shell command inside a project boundary.
 *
 * This is intentionally a small kernel, not an agent policy. Callers must
 * provide an allowlist and a registered command profile before exposing it to
 * an agent. It never interpolates args into a shell command.
 */
export async function runBoundedCommand(spec: BoundedCommandSpec): Promise<BoundedCommandResult> {
  validateLimits(spec);
  const requestedCwd = spec.cwd ?? spec.rootPath;
  const boundary = await resolveContainedCwd(spec.rootPath, requestedCwd);
  const startedAt = Date.now();
  const remaining = { value: spec.maxOutputBytes };
  let stdout = "";
  let stderr = "";
  let truncated = false;
  let timedOut = false;
  let cancelled = false;

  const cwd = await revalidateExecutionBoundary(spec.rootPath, requestedCwd, boundary);

  return new Promise<BoundedCommandResult>((resolve) => {
    let settled = false;
    const finish = (result: BoundedCommandResult) => {
      if (settled) return;
      settled = true;
      resolve({
        ...result,
        combinedOutput: sanitizeOutput(`${stdout}${stderr ? `\n${stderr}` : ""}`, spec.rootPath),
        stdout: sanitizeOutput(stdout, spec.rootPath),
        stderr: sanitizeOutput(stderr, spec.rootPath),
        truncated,
        durationMs: Date.now() - startedAt,
      });
    };

    const child = spawn(spec.command, spec.args, {
      cwd,
      env: spec.env ?? process.env,
      shell: false,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const killChild = (signal: NodeJS.Signals): void => {
      try {
        if (child.pid) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch {
        child.kill(signal);
      }
    };
    const onAbort = (): void => {
      cancelled = true;
      killChild("SIGTERM");
    };
    if (spec.signal?.aborted) {
      onAbort();
    } else {
      spec.signal?.addEventListener("abort", onAbort, { once: true });
    }

    const timeout = setTimeout(() => {
      timedOut = true;
      killChild("SIGTERM");
    }, spec.timeoutMs);
    const cleanup = (): void => {
      clearTimeout(timeout);
      spec.signal?.removeEventListener("abort", onAbort);
    };

    child.stdout.on("data", (chunk: Buffer | string) => {
      const result = appendBounded(stdout, chunk.toString(), remaining);
      stdout = result.value;
      truncated ||= result.truncated;
      if (result.truncated) killChild("SIGTERM");
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      const result = appendBounded(stderr, chunk.toString(), remaining);
      stderr = result.value;
      truncated ||= result.truncated;
      if (result.truncated) killChild("SIGTERM");
    });
    child.once("error", (error) => {
      cleanup();
      finish({
        status: cancelled ? "cancelled" : "spawn_error",
        exitCode: null,
        signal: null,
        stdout,
        stderr: `${stderr}${stderr ? "\n" : ""}${error.message}`,
        combinedOutput: "",
        truncated,
        durationMs: 0,
      });
    });
    child.once("close", (exitCode, signal) => {
      cleanup();
      finish({
        status: cancelled ? "cancelled" : timedOut ? "timed_out" : exitCode === 0 ? "passed" : "failed",
        exitCode,
        signal,
        stdout,
        stderr,
        combinedOutput: "",
        truncated,
        durationMs: 0,
      });
    });
  });
}