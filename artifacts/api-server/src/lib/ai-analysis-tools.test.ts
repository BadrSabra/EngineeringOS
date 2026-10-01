import { describe, expect, it, vi } from "vitest";
import { createProjectAnalysisToolRunner, classifyAnalysisFailure } from "./ai-analysis-tools.js";
import { ScanRootUnavailableError } from "./scan-runner.js";

const mockPerformScan = vi.hoisted(() => vi.fn());

vi.mock("./scan-runner.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./scan-runner.js")>();
  return { ...actual, performScan: mockPerformScan };
});

describe("project analysis root failure classification", () => {
  it("reports an initially unavailable root before any tool work", async () => {
    const runner = createProjectAnalysisToolRunner("project-a", "/tmp/missing-root");
    const result = await runner(
      "query_knowledge_graph",
      { operation: "search" },
      undefined,
      {
        operationId: "operation-a",
        projectId: "project-a",
        projectRevision: "revision-a",
        rootAvailable: false,
        evidenceProvenance: "project-analysis",
      },
    );
    expect(result).toMatchObject({
      status: "unavailable",
      failureCategory: "root_unavailable",
    });
  });

  it("reports a root that disappears during a refresh", () => {
    const error = new ScanRootUnavailableError("/tmp/missing-root", "root_not_found", "root disappeared");
    expect(classifyAnalysisFailure(error)).toBe("root_unavailable");
    expect(classifyAnalysisFailure({ outcome: "root_unavailable" })).toBe("root_unavailable");
  });

  it("classifies oversized producer output as incomplete instead of truncating it", () => {
    expect(classifyAnalysisFailure({
      code: "TOOL_OUTPUT_LIMIT",
      outputBytes: 25,
      maxBytes: 24,
    })).toBe("output_limit");
  });

  it("returns an expired analysis deadline as an incomplete timeout", async () => {
    const runner = createProjectAnalysisToolRunner("project-a", "/tmp/missing-root");
    const result = await runner(
      "query_knowledge_graph",
      { operation: "search" },
      undefined,
      {
        operationId: "operation-a",
        projectId: "project-a",
        projectRevision: "revision-a",
        rootAvailable: true,
        evidenceProvenance: "project-analysis",
      },
      Date.now() - 1,
    );

    expect(result).toMatchObject({
      status: "unavailable",
      failureCategory: "timeout",
    });
    expect(result.output).not.toContain("revision-a");
  });

  it("returns an in-flight scan timeout before the scan settles", async () => {
    let scanStarted!: () => void;
    let scanAborted!: () => void;
    let releaseScan!: () => void;
    const scanStartedPromise = new Promise<void>((resolve) => {
      scanStarted = resolve;
    });
    const scanAbortedPromise = new Promise<void>((resolve) => {
      scanAborted = resolve;
    });
    const scanGate = new Promise<void>((resolve) => {
      releaseScan = resolve;
    });
    mockPerformScan.mockImplementation(async (_projectId: string, signal: AbortSignal) => {
      scanStarted();
      if (signal.aborted) scanAborted();
      else signal.addEventListener("abort", scanAborted, { once: true });
      await scanGate;
      return undefined as never;
    });

    const runner = createProjectAnalysisToolRunner("project-a", process.cwd());
    const pending = runner(
      "refresh_project_scan",
      {},
      undefined,
      {
        operationId: "operation-a",
        projectId: "project-a",
        projectRevision: "revision-a",
        rootAvailable: true,
        evidenceProvenance: "project-analysis",
      },
      Date.now() + 250,
    );

    try {
      await scanStartedPromise;
      await scanAbortedPromise;
      const result = await pending;

      expect(result).toMatchObject({
        status: "unavailable",
        failureCategory: "timeout",
      });
      expect(mockPerformScan).toHaveBeenCalledOnce();
    } finally {
      releaseScan();
      mockPerformScan.mockReset();
    }
  });
});