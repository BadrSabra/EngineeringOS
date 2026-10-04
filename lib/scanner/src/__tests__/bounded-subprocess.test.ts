import { describe, expect, it } from "vitest";
import {
  runBoundedSubprocess,
  stringifyBoundedJsonArray,
} from "../bounded-subprocess.js";

describe("bounded scanner subprocesses", () => {
  it("rejects oversized serialized parser input before starting a process", () => {
    let error: unknown;
    try {
      stringifyBoundedJsonArray([{ content: "x".repeat(100) }], 32);
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({
      kind: "input_limit",
      message: "Scanner parser input exceeded its 32-byte limit.",
    });
  });

  it("terminates a parser process that exceeds its stdout limit", async () => {
    await expect(runBoundedSubprocess({
      command: process.execPath,
      args: ["-e", "process.stdout.write('x'.repeat(4096))"],
      timeoutMs: 2_000,
      maxStdoutBytes: 128,
      maxStderrBytes: 128,
    })).rejects.toMatchObject({ kind: "stdout_limit" });
  });

  it("stops waiting and terminates the parser process on cancellation", async () => {
    const controller = new AbortController();
    const pending = runBoundedSubprocess({
      command: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000)"],
      signal: controller.signal,
      timeoutMs: 5_000,
      maxStdoutBytes: 128,
      maxStderrBytes: 128,
    });
    const timer = setTimeout(() => controller.abort(), 50);

    try {
      await expect(pending).rejects.toThrow("cancelled");
    } finally {
      clearTimeout(timer);
    }
  });
});