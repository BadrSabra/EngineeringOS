import { describe, expect, it, vi } from "vitest";
import { executeValidationTool } from "../tools/execution-tools.js";
import { executeSingleTool } from "../tool-execution-engine.js";

describe("execution tools", () => {
  it("passes only the server-owned target paths to the validation runner", async () => {
    const runner = vi.fn().mockResolvedValue({
      status: "passed",
      profile: "workspace-typecheck",
      detail: "ok",
    });

    const output = await executeValidationTool(
      "run_validation",
      { profile: "workspace-typecheck" },
      ["artifacts/dashboard/src/pages/AiChat.tsx"],
      runner,
    );

    expect(runner).toHaveBeenCalledWith(
      "workspace-typecheck",
      ["artifacts/dashboard/src/pages/AiChat.tsx"],
    );
    expect(JSON.parse(output)).toMatchObject({
      tool: "run_validation",
      status: "passed",
      profile: "workspace-typecheck",
    });
  });

  it("fails closed when no server runner is configured", async () => {
    const output = await executeValidationTool(
      "run_validation",
      { profile: "workspace-typecheck" },
      [],
      undefined,
    );

    expect(JSON.parse(output)).toMatchObject({
      status: "unavailable",
      code: "VALIDATION_RUNNER_UNAVAILABLE",
    });
  });

  it("does not accept an empty profile", async () => {
    const output = await executeValidationTool("run_validation", { profile: " " }, [], vi.fn());

    expect(JSON.parse(output)).toMatchObject({
      status: "unavailable",
      code: "VALIDATION_PROFILE_REQUIRED",
    });
  });

  it("blocks dispatcher execution outside Build mode", async () => {
    const runner = vi.fn().mockResolvedValue({ status: "passed", profile: "workspace-typecheck" });
    const result = await executeSingleTool({
      name: "run_validation",
      args: { profile: "workspace-typecheck" },
      rootPath: process.cwd(),
      pendingChanges: [],
      validationRunner: runner,
      validationTargetPaths: ["src/example.ts"],
      allowExecutionTools: false,
    });

    expect(result.kind).toBe("failed");
    expect(result.kind === "failed" && result.diagnosticCode).toBe("TOOL_UNAVAILABLE");
    expect(result.kind === "failed" && result.safeMessage).toMatch(/did not complete/i);
    expect(runner).not.toHaveBeenCalled();
  });

  it("uses the server runner and server-owned paths inside Build mode", async () => {
    const runner = vi.fn().mockResolvedValue({
      status: "passed",
      profile: "workspace-typecheck",
      detail: "ok",
    });
    const result = await executeSingleTool({
      name: "run_validation",
      args: { profile: "workspace-typecheck" },
      rootPath: process.cwd(),
      pendingChanges: [],
      validationRunner: runner,
      validationTargetPaths: ["src/approved.ts"],
      allowExecutionTools: true,
    });

    expect(result.kind).toBe("ok");
    expect(runner).toHaveBeenCalledWith("workspace-typecheck", ["src/approved.ts"]);
    expect(result.kind === "ok" && JSON.parse(result.output)).toMatchObject({
      tool: "run_validation",
      status: "passed",
    });
  });
});