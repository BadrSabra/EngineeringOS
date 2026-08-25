import { describe, expect, it } from "vitest";
import { getAllowedToolDefinitions, resolveToolPolicy } from "../tool-policy.js";

describe("tool policy", () => {
  it("disables tools when the project root is missing", () => {
    const policy = resolveToolPolicy({ provider: "groq" });

    expect(policy.enabled).toBe(false);
    expect(policy.reason).toContain("project root path");
    expect(getAllowedToolDefinitions(policy)).toEqual([]);
  });

  it("disables tools for providers marked as text-only", () => {
    const policy = resolveToolPolicy({ provider: "gemini", rootPath: "/tmp/project" });

    expect(policy.enabled).toBe(false);
    expect(policy.reason).toContain("text-only");
    expect(getAllowedToolDefinitions(policy)).toEqual([]);
  });

  it("exposes the full tool suite in workspace mode", () => {
    const policy = resolveToolPolicy({ provider: "groq", rootPath: "/tmp/project", mode: "workspace" });
    const toolNames = getAllowedToolDefinitions(policy).map((tool) => tool.function.name);

    expect(policy.enabled).toBe(true);
    expect(toolNames).toEqual([
      "read_file",
      "read_file_range",
      "list_directory",
      "search_code",
      "replace_text",
      "write_file",
      "git_status",
      "git_diff",
      "git_log",
    ]);
    expect(toolNames).not.toContain("git_commit");
    expect(toolNames).not.toContain("run_validation");
  });

  it("exposes validation only when the caller opts into execution", () => {
    const policy = resolveToolPolicy({
      provider: "groq",
      rootPath: "/tmp/project",
      mode: "workspace",
      allowExecution: true,
    });
    const toolNames = getAllowedToolDefinitions(policy).map((tool) => tool.function.name);

    expect(policy.allowExecution).toBe(true);
    expect(toolNames).toContain("run_validation");
  });

  it("removes write_file in read-only mode while keeping read tools", () => {
    const policy = resolveToolPolicy({ provider: "groq", rootPath: "/tmp/project", mode: "read-only" });
    const toolNames = getAllowedToolDefinitions(policy).map((tool) => tool.function.name);

    expect(policy.enabled).toBe(true);
    expect(policy.allowFileWrite).toBe(false);
    expect(toolNames).toEqual([
      "read_file",
      "read_file_range",
      "list_directory",
      "search_code",
      "git_status",
      "git_diff",
      "git_log",
    ]);
    expect(toolNames).not.toContain("write_file");
    expect(toolNames).not.toContain("run_validation");
  });
});
