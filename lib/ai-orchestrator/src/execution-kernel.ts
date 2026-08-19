import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

export const EXECUTION_LIMITS = {
  maxTimeoutMs: 30 * 60 * 1000,
  maxOutputBytes: 64 * 1024 * 1024,
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

async function resolveContainedCwd(rootPath: string, cwd: string): Promise<string> {
  const [realRoot, realCwd] = await Promise.all([fs.realpath(rootPath), fs.realpath(cwd)]);
  const relative = path.relative(realRoot, realCwd);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Execution working directory must remain inside the project root.");
  }
  return realCwd;
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
  const cwd = await resolveContainedCwd(spec.rootPath, spec.cwd ?? spec.rootPath);
  const startedAt = Date.now();
  const remaining = { value: spec.maxOutputBytes };
  let stdout = "";
  let stderr = "";
  let truncated = false;
  let timedOut = false;
  let cancelled = false;

  return new Promise<BoundedCommandResult>((resolve) => {
    let settled = false;
    const finish = (result: BoundedCommandResult) => {
      if (settled) return;
      settled = true;
      resolve({
        ...result,
        combinedOutput: `${stdout}${stderr ? `\n${stderr}` : ""}`,
        stdout,
        stderr,
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