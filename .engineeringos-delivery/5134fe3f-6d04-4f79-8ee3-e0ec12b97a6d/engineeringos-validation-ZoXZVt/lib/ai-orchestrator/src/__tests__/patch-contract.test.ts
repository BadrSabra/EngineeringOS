import { describe, expect, it } from "vitest";
import { rebasePatchHunks, type FilePatchHunk } from "../patch-contract.js";

describe("rebasePatchHunks", () => {
  it("rebases a focused replacement when unrelated lines were added around it", () => {
    const hunks: FilePatchHunk[] = [{
      startLine: 1,
      endLine: 1,
      expectedText: "export const value = 1;",
      replacementText: "export const value = 2;",
      reason: "Update the value",
    }];

    expect(rebasePatchHunks(
      "// user header\nexport const value = 1;\n// user footer\n",
      hunks,
    )).toEqual({
      ok: true,
      content: "// user header\nexport const value = 2;\n// user footer\n",
    });
  });

  it("fails closed when the expected hunk is missing", () => {
    const result = rebasePatchHunks(
      "export const value = 9;\n",
      [{
        startLine: 1,
        endLine: 1,
        expectedText: "export const value = 1;",
        replacementText: "export const value = 2;",
        reason: "Update the value",
      }],
    );

    expect(result).toMatchObject({
      ok: false,
      kind: "hunk_mismatch",
      hunkIndex: 0,
    });
  });

  it("fails closed when the expected hunk is no longer unique", () => {
    const result = rebasePatchHunks(
      "export const value = 1;\nexport const value = 1;\n",
      [{
        startLine: 1,
        endLine: 1,
        expectedText: "export const value = 1;",
        replacementText: "export const value = 2;",
        reason: "Update the value",
      }],
    );

    expect(result).toMatchObject({
      ok: false,
      kind: "hunk_mismatch",
      hunkIndex: 0,
    });
  });

  it("supports rebasing a still-absent new file", () => {
    expect(rebasePatchHunks(null, [{
      startLine: 1,
      endLine: 1,
      expectedText: "",
      replacementText: "export const created = true;\n",
      reason: "Create the module",
    }])).toEqual({
      ok: true,
      content: "export const created = true;\n",
    });
  });
});