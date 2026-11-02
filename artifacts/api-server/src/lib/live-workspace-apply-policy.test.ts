import { describe, expect, it } from "vitest";
import { isLiveWorkspaceWriteUncoordinated } from "./live-workspace-apply-policy.js";

describe("live workspace Apply policy", () => {
  it("fails closed in development, production, and an unspecified runtime", () => {
    expect(isLiveWorkspaceWriteUncoordinated("development")).toBe(true);
    expect(isLiveWorkspaceWriteUncoordinated("production")).toBe(true);
    expect(isLiveWorkspaceWriteUncoordinated("")).toBe(true);
  });

  it("allows only isolated test-mode fixtures to exercise filesystem promotion", () => {
    expect(isLiveWorkspaceWriteUncoordinated("test")).toBe(false);
  });
});
