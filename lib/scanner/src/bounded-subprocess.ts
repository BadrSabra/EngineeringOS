import { spawn } from "node:child_process";
import type { SpawnOptions } from "node:child_process";

export type ScannerSubprocessFailureKind =
  | "input_invalid"
  | "input_limit"
  | "stdout_limit"
  | "stderr_limit"
  | "timeout"
  | "process_error"
  | "invalid_output";

export class ScannerSubprocessError extends Error {
  constructor(
    readonly kind: ScannerSubprocessFailureKind,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ScannerSubprocessError";
  }
}

export const SCANNER_SUBPROCESS_LIMITS = {
  timeoutMs: 30_000,
  maxInputBytes: 64 * 1024 * 1024,
  maxStdoutBytes: 32 * 1024 * 1024,
  maxStderrBytes: 64 * 1024,
  terminationGraceMs: 1_000,
} as const;

export function stringifyBoundedJsonArray(
  values: readonly unknown[],
  maxBytes = SCANNER_SUBPROCESS_LIMITS.maxInputBytes,
): string {
  const encoded: string[] = [];
  let totalBytes = 2;
  for (const value of values) {
    let item: string | undefined;
    try {
      item = JSON.stringify(value);
    } catch (error) {
      throw new ScannerSubprocessError(
        "input_invalid",
        "Scanner parser input could not be serialized.",
        { cause: error },
      );
    }
    if (item === undefined) {
      throw new ScannerSubprocessError(
        "input_invalid",
        "Scanner parser input contains a non-serializable value.",
      );
    }
    const itemBytes = Buffer.byteLength(item, "utf8");
    totalBytes += itemBytes + (encoded.length > 0 ? 1 : 0);
    if (totalBytes > maxBytes) {
      throw new ScannerSubprocessError(
        "input_limit",
        `Scanner parser input exceeded its ${maxBytes}-byte limit.`,
      );
    }
    encoded.push(item);
  }
  return `[${encoded.join(",")}]`;
}

export function waitForSubprocessWithAbort<T>(
  operation: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) return operation;
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(signal.reason ?? new Error("Scanner parser was cancelled."));
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
    if (signal.aborted) onAbort();
  });
}

export function parseBoundedJsonArray<T>(stdout: string, parserName: string): T[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    throw new ScannerSubprocessError(
      "invalid_output",
      `${parserName} parser returned invalid JSON.`,
      { cause: error },
    );
  }
  if (!Array.isArray(parsed)) {
    throw new ScannerSubprocessError(
      "invalid_output",
      `${parserName} parser returned a non-array result.`,
    );
  }
  return parsed as T[];
}

export async function runBoundedSubprocess(input: {
  command: string;
  args: string[];
  stdin?: string;
  env?: SpawnOptions["env"];
  signal?: AbortSignal;
  timeoutMs?: number;
  maxInputBytes?: number;
  maxStdoutBytes?: number;
  maxStderrBytes?: number;
}): Promise<{ stdout: string; stderr: string }> {
  const stdin = input.stdin ?? "";
  const stdinBytes = Buffer.byteLength(stdin, "utf8");
  const maxInputBytes = input.maxInputBytes ?? SCANNER_SUBPROCESS_LIMITS.maxInputBytes;
  if (stdinBytes > maxInputBytes) {
    throw new ScannerSubprocessError(
      "input_limit",
      `Scanner parser input exceeded its ${maxInputBytes}-byte limit.`,
    );
  }
  input.signal?.throwIfAborted();

  const timeoutMs = input.timeoutMs ?? SCANNER_SUBPROCESS_LIMITS.timeoutMs;
  const maxStdoutBytes = input.maxStdoutBytes ?? SCANNER_SUBPROCESS_LIMITS.maxStdoutBytes;
  const maxStderrBytes = input.maxStderrBytes ?? SCANNER_SUBPROCESS_LIMITS.maxStderrBytes;

  return await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(input.command, input.args, {
      env: input.env,
      shell: false,
      detached: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdoutBytes = 0;
    let stderrBytes = 0;
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stopError: Error | undefined;
    let escalation: ReturnType<typeof setTimeout> | undefined;
    let settled = false;

    const kill = (signal: NodeJS.Signals): void => {
      try {
        if (child.pid) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch {
        try {
          child.kill(signal);
        } catch {
          // The child may already have exited.
        }
      }
    };
    const requestStop = (error: Error): void => {
      stopError ??= error;
      kill("SIGTERM");
      if (!escalation) {
        escalation = setTimeout(
          () => kill("SIGKILL"),
          SCANNER_SUBPROCESS_LIMITS.terminationGraceMs,
        );
      }
    };
    const cleanup = (): void => {
      clearTimeout(deadline);
      if (escalation) clearTimeout(escalation);
      input.signal?.removeEventListener("abort", onAbort);
    };
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) {
        reject(error);
        return;
      }
      resolve({
        stdout: Buffer.concat(stdout, stdoutBytes).toString("utf8"),
        stderr: Buffer.concat(stderr, stderrBytes).toString("utf8"),
      });
    };
    const onAbort = (): void => {
      requestStop(new Error("Scanner parser was cancelled."));
    };
    const append = (
      chunks: Buffer[],
      chunk: Buffer,
      currentBytes: number,
      maxBytes: number,
      streamName: "stdout" | "stderr",
    ): number => {
      if (currentBytes + chunk.byteLength > maxBytes) {
        requestStop(new ScannerSubprocessError(
          streamName === "stdout" ? "stdout_limit" : "stderr_limit",
          `Scanner parser ${streamName} exceeded its ${maxBytes}-byte limit.`,
        ));
        return currentBytes;
      }
      chunks.push(chunk);
      return currentBytes + chunk.byteLength;
    };

    const deadline = setTimeout(
      () => requestStop(new ScannerSubprocessError(
        "timeout",
        `Scanner parser timed out after ${timeoutMs}ms.`,
      )),
      timeoutMs,
    );
    input.signal?.addEventListener("abort", onAbort, { once: true });
    if (input.signal?.aborted) onAbort();

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdoutBytes = append(
        stdout,
        Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk),
        stdoutBytes,
        maxStdoutBytes,
        "stdout",
      );
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderrBytes = append(
        stderr,
        Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk),
        stderrBytes,
        maxStderrBytes,
        "stderr",
      );
    });
    child.stdin.on("error", () => {
      // A child that exits early may close stdin before consuming the payload.
      // Its close status remains authoritative; do not create an unhandled
      // stream error or replace a cancellation/output-limit diagnosis.
    });
    child.once("error", (error) => finish(new ScannerSubprocessError(
      "process_error",
      "Scanner parser process could not be started.",
      { cause: error },
    )));
    child.once("close", (code, signal) => {
      if (stopError) {
        finish(stopError);
      } else if (code !== 0) {
        const detail = Buffer.concat(stderr, stderrBytes).toString("utf8").slice(0, 500);
        finish(new ScannerSubprocessError(
          "process_error",
          `Scanner parser exited with ${signal ? `signal ${signal}` : `code ${code}`}${detail ? `: ${detail}` : "."}`,
        ));
      } else {
        finish();
      }
    });

    try {
      child.stdin.end(stdin);
    } catch (error) {
      requestStop(error instanceof Error ? error : new Error("Scanner parser input failed."));
    }
  });
}