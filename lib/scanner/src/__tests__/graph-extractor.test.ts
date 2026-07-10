import { describe, it, expect } from "vitest";
import { extractGraph } from "../graph-extractor.js";
import type { ScannedFile } from "../file-walker.js";

const makeFile = (path: string, content: string, language = "typescript"): ScannedFile => ({
  path,
  absPath: `/project/${path}`,
  language,
  content,
  size: content.length,
  lines: content.split("\n").length,
  oversized: false,
});

describe("extractGraph", () => {
  it("returns empty entities and relationships for an empty file list", () => {
    const result = extractGraph([]);

    expect(result.entities).toHaveLength(0);
    expect(result.relationships).toHaveLength(0);
  });

  it("creates a file entity for each TypeScript source file", () => {
    const files = [
      makeFile("src/index.ts", "export const x = 1;"),
      makeFile("src/utils.ts", "export const y = 2;"),
    ];

    const result = extractGraph(files);

    const fileEntities = result.entities.filter((e) => e.type === "file");
    expect(fileEntities.length).toBeGreaterThanOrEqual(2);
  });

  it("extracts function entities from exported functions", () => {
    const files = [
      makeFile("src/utils.ts", "export function parseUser(data: unknown) { return data; }"),
    ];

    const result = extractGraph(files);

    const fnEntities = result.entities.filter((e) => e.type === "function");
    expect(fnEntities.some((e) => e.name === "parseUser")).toBe(true);
  });

  it("extracts class entities from exported classes", () => {
    const files = [makeFile("src/service.ts", "export class UserService { }")];

    const result = extractGraph(files);

    const classEntities = result.entities.filter((e) => e.type === "class");
    expect(classEntities.some((e) => e.name === "UserService")).toBe(true);
  });

  it("records import relationships between files", () => {
    // Use bare specifier without extension — the resolver tries adding .ts/.js etc.
    const files = [
      makeFile("src/index.ts", 'import { parseUser } from "./utils";'),
      makeFile("src/utils.ts", "export function parseUser() {}"),
    ];

    const result = extractGraph(files);

    const importRels = result.relationships.filter((r) => r.relation === "imports");
    expect(importRels.length).toBeGreaterThan(0);
  });

  it("does not produce duplicate file entities for the same path", () => {
    const files = [makeFile("src/foo.ts", "export const a = 1;")];

    const result = extractGraph(files);

    const fileEntities = result.entities.filter(
      (e) => e.type === "file" && e.path === "src/foo.ts",
    );
    expect(fileEntities.length).toBe(1);
  });

  it("includes a non-empty path on every entity", () => {
    const files = [makeFile("src/utils.ts", "export function helper() {}")];

    const result = extractGraph(files);

    for (const entity of result.entities) {
      expect(typeof entity.path).toBe("string");
      expect(entity.path.length).toBeGreaterThan(0);
    }
  });

  it("handles files without content gracefully", () => {
    const files: ScannedFile[] = [
      {
        path: "src/empty.ts",
        absPath: "/project/src/empty.ts",
        language: "typescript",
        content: "",
        size: 0,
        lines: 0,
        oversized: false,
      },
    ];

    expect(() => extractGraph(files)).not.toThrow();
  });

  it("does not generate function/class entities from markdown or JSON files", () => {
    const files = [
      makeFile("README.md", "# Hello", "markdown"),
      makeFile("config.json", '{"key":"value"}', "json"),
    ];

    const result = extractGraph(files);
    const nonFileEntities = result.entities.filter((e) => e.type !== "file");

    expect(nonFileEntities).toHaveLength(0);
  });
});
