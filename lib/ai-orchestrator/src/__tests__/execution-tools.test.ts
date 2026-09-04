import { describe, expect, it, vi } from "vitest";
import { executeBrowserValidationTool, executeCommandTool, executeValidationTool, type CommandProfile } from "../tools/execution-tools.js";
import { executeSingleTool } from "../tool-execution-engine.js";

describe("execution tools", () => {
  it("runs only a server-owned browser profile and returns structured evidence", async () => {
    const output = await executeBrowserValidationTool(
      "run_browser_validation",
      { profile: "dashboard-preview" },
      "/project",
      async ({ profile, rootPath }) => ({
        profile,
        status: "passed",
        scenario: "Preview checks",
        command: "browser-preview",
        exitCode: 0,
        stdout: "",
        stderr: "",
        failedTests: [],
        changedFiles: [],
        evidence: {
          evidenceId: "browser-evidence",
          observedAt: new Date().toISOString(),
          artifactRef: "browser-preview:session:operation",
          revision: "rev-a",
          screenshotAvailable: true,
          consoleErrorCount: 0,
        },
        detail: rootPath,
      }),
    );
    const parsed = JSON.parse(output);
    expect(parsed.status).toBe("passed");
    expect(parsed.evidence.screenshotAvailable).toBe(true);
    expect(parsed.detail).toBe("/project");
  });

  it("fails closed when browser validation is not enabled", async () => {
    const output = await executeBrowserValidationTool(
      "run_browser_validation",
      { profile: "dashboard-preview" },
      "/project",
      undefined,
    );
    expect(JSON.parse(output)).toMatchObject({
      status: "unavailable",
      code: "BROWSER_VALIDATION_UNAVAILABLE",
    });
  });
  it("runs only a server-registered fixed command profile", async () => {
    const runner = vi.fn().mockResolvedValue({
      status: "passed",
      exitCode: 0,
      signal: null,
      stdout: "ok",
      stderr: "",
      combinedOutput: "ok",
      truncated: false,
      durationMs: 4,
    });
    const profile: CommandProfile = {
      name: "safe-check",
      command: "node",
      args: ["-e", "process.stdout.write('ok')"],
      timeoutMs: 2_000,
      maxOutputBytes: 1_000,
    };

    const output = await executeCommandTool(
      "run_command",
      { profile: "safe-check", command: "sh -c 'rm -rf /'" },
      "/project",
      [profile],
      runner,
    );

    expect(runner).toHaveBeenCalledWith(expect.objectContaining({ profile, rootPath: "/project" }));
    expect(JSON.parse(output)).toMatchObject({
      tool: "run_command",
      status: "passed",
      code: "COMMAND_PASSED",
    });
  });

  it("fails closed when a command profile is absent or exceeds limits", async () => {
    const runner = vi.fn();
    const missing = await executeCommandTool("run_command", { profile: "unknown" }, "/project", [], runner);
    expect(JSON.parse(missing)).toMatchObject({ status: "unavailable", code: "COMMAND_PROFILE_NOT_REGISTERED" });

    const invalid = await executeCommandTool(
      "run_command",
      { profile: "oversized" },
      "/project",
      [{ name: "oversized", command: "node", args: [], timeoutMs: 0, maxOutputBytes: 100 }],
      runner,
    );
    expect(JSON.parse(invalid)).toMatchObject({ status: "unavailable", code: "COMMAND_PROFILE_INVALID" });
    expect(runner).not.toHaveBeenCalled();
  });

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
      approvalState: "APPROVED",
      approvedValidationProfiles: ["workspace-typecheck"],
    });

    expect(result.kind).toBe("ok");
    expect(runner).toHaveBeenCalledWith("workspace-typecheck", ["src/approved.ts"]);
    expect(result.kind === "ok" && JSON.parse(result.output)).toMatchObject({
      tool: "run_validation",
      status: "passed",
    });
  });
});