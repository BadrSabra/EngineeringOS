import { describe, expect, it } from "vitest";
import { parseMissionProposalPaths } from "./mission-proposal-paths.js";

function change(path: string) {
  return {
    path,
    absolutePath: `/tmp/project/${path}`,
    newContent: "approved content",
    originalContent: "previous content",
    reason: "Apply the approved proposal change.",
  };
}

describe("parseMissionProposalPaths", () => {
  it("extracts only schema-valid, project-relative paths from the stored proposal", () => {
    expect(parseMissionProposalPaths(JSON.stringify([
      change("README.md"),
      change("src/app.ts"),
      change("README.md"),
    ]))).toEqual(["README.md", "src/app.ts"]);
  });

  it.each([
    ["malformed JSON", "not-json"],
    ["an empty change set", "[]"],
    ["a parent traversal path", JSON.stringify([change("../outside.txt")])],
    ["an absolute path", JSON.stringify([change("/etc/passwd")])],
    ["a Windows absolute path", JSON.stringify([change("C:\\outside.txt")])],
    ["a malformed change", JSON.stringify([{ path: "README.md" }])],
  ])("rejects %s rather than widening the observation scope", (_label, serialized) => {
    expect(parseMissionProposalPaths(serialized)).toBeUndefined();
  });

  it("rejects proposal scopes larger than the Mission tool limit", () => {
    const changes = Array.from({ length: 49 }, (_, index) => change(`src/file-${index}.ts`));
    expect(parseMissionProposalPaths(JSON.stringify(changes))).toBeUndefined();
  });
});
