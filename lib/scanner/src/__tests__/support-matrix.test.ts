import { describe, expect, it } from "vitest";
import {
  buildProjectSupportMatrix,
  getLanguageSupportProfile,
} from "../support-matrix.js";

describe("project support matrix", () => {
  it("distinguishes detected languages from actual structural support", () => {
    const matrix = buildProjectSupportMatrix(
      ["typescript", "go", "php", "typescript"],
      "Express 5.2.1",
    );

    expect(matrix.languages.map((target) => target.id)).toEqual(["typescript", "go", "php"]);
    expect(matrix.languages.find((target) => target.id === "typescript")?.level).toBe("deep");
    expect(matrix.languages.find((target) => target.id === "go")?.level).toBe("partial");
    expect(matrix.languages.find((target) => target.id === "php")?.level).toBe("metadata-only");
    expect(matrix.frameworks[0]).toMatchObject({
      id: "Express",
      label: "Express 5.2.1",
      kind: "framework",
      level: "partial",
    });
  });

  it("fails closed for an unknown language instead of implying support", () => {
    expect(getLanguageSupportProfile("elixir")).toMatchObject({
      id: "elixir",
      level: "metadata-only",
      graph: "File-level only",
      validation: "No registered validation profile",
    });
  });
});