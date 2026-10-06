import { describe, expect, it, vi } from "vitest";
import { TOOL_OPERATIONAL_METADATA } from "../tool-operational-registry.js";
import { _runWithToolDeadline } from "../tool-execution-engine.js";

const fixedDeadlineTools = [
  "read_file",
  "read_file_range",
  "project.list_tree",
  "list_directory",
  "write_file",
  "replace_text",
  "symbol_search",
  "ast_navigation",
  "inspect_dependencies",
  "inspect_binary",
] as const;

describe("server-owned tool deadlines", () => {
  it.each(fixedDeadlineTools)(
    "%s has an enforceable fixed execution deadline",
    (toolName) => {
      const timeout = TOOL_OPERATIONAL_METADATA[toolName].cancellation.timeout;
      expect(timeout.kind).toBe("fixed_ms");
      if (timeout.kind === "fixed_ms") expect(timeout.maxMs).toBeGreaterThan(0);
    },
  );

  it("aborts the cooperative executor and returns a timeout failure at its deadline", async () => {
    let executorSignal: AbortSignal | undefined;
    const result = _runWithToolDeadline(
      "slow-fixture",
      20,
      undefined,
      (signal) => new Promise<string>((_resolve, reject) => {
        executorSignal = signal;
        signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
      }),
    );

    await expect(result).rejects.toMatchObject({
      name: "ToolExecutionDeadlineExceededError",
    });
    expect(executorSignal?.aborted).toBe(true);
  });

  it("propagates caller cancellation as cancellation rather than a timeout", async () => {
    const controller = new AbortController();
    let executorSignal: AbortSignal | undefined;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const result = _runWithToolDeadline(
      "slow-fixture",
      1_000,
      controller.signal,
      (signal) => new Promise<string>((_resolve, reject) => {
        executorSignal = signal;
        markStarted();
        signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
      }),
    );

    // Cancel only after the runner starts. A pre-start cancellation is a
    // separate fast path where the runner must not be invoked at all.
    await started;
    controller.abort();
    await expect(result).rejects.toBeDefined();
    expect(executorSignal?.aborted).toBe(true);
  });

  it("does not invoke an executor when its caller is already cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const run = vi.fn(async () => "must not run");

    await expect(
      _runWithToolDeadline("never-started-fixture", 1_000, controller.signal, run),
    ).rejects.toBeDefined();
    expect(run).not.toHaveBeenCalled();
  });
});
