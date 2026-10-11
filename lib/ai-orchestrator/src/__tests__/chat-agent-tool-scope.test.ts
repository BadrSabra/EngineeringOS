import { describe, expect, it } from "vitest";
import { buildProviderTools } from "../agents/chat-agent.js";

describe("buildProviderTools repair-plan handoff", () => {
  it("retains authorized edit and validation tools after a single-file forensic read phase", () => {
    const tools = buildProviderTools(
      "openrouter",
      "/project",
      "repair_plan",
      true,
      false,
      [],
      true,
    );
    const names = tools?.map((tool) => tool.function.name) ?? [];

    expect(names).toContain("read_file");
    expect(names).toContain("replace_text");
    expect(names).toContain("write_file");
    expect(names).toContain("run_validation");
  });

  it("keeps the standalone single-file forensic phase read-only", () => {
    const tools = buildProviderTools("openrouter", "/project", undefined, true);

    expect(tools?.map((tool) => tool.function.name)).toEqual(["read_file"]);
  });
});
