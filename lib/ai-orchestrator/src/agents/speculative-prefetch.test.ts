import { promises as fs } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { prefetchFileList, prefetchForensicRoots } from "./speculative-prefetch.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map(async (root) => {
      await fs.rm(root, { recursive: true, force: true });
    }),
  );
});

describe("prefetchFileList", () => {
  it("returns only successful reads as sources and cache entries", async () => {
    const root = await fs.mkdtemp(path.join("/tmp", "engineeringos-prefetch-"));
    tempRoots.push(root);
    await fs.writeFile(
      path.join(root, "queries.ts"),
      "export function findPath() { return []; }\n",
      "utf8",
    );

    const result = await prefetchFileList({
      files: ["queries.js", "queries.ts"],
      rootPath: root,
      pendingChanges: [],
      toolCacheKeyFn: (name, args) => `${name}:${JSON.stringify(args)}`,
      complete: true,
    });

    expect(result.sources).toEqual(["queries.ts"]);
    expect(result.cacheEntries).toHaveLength(1);
    expect(result.cacheEntries[0]?.key).toContain('"path":"queries.ts"');
    expect(result.cacheEntries[0]?.content).toContain("findPath");
    expect(result.sources).not.toContain("queries.js");
    expect(result.injectedMessages).toHaveLength(2);
  });

  it("honors the shared forensic file budget and excludes already-read files", async () => {
    const root = await fs.mkdtemp(path.join("/tmp", "engineeringos-prefetch-budget-"));
    tempRoots.push(root);
    await Promise.all(
      ["one.ts", "two.ts", "three.ts"].map((file, index) =>
        fs.writeFile(
          path.join(root, file),
          `export const value${index} = ${index};\n`,
          "utf8",
        ),
      ),
    );

    const result = await prefetchFileList({
      files: ["one.ts", "two.ts", "three.ts"],
      rootPath: root,
      pendingChanges: [],
      toolCacheKeyFn: (name, args) => `${name}:${JSON.stringify(args)}`,
      complete: true,
      maxFiles: 1,
      excludeFiles: ["one.ts"],
    });

    expect(result.sources).toEqual(["two.ts"]);
    expect(result.cacheEntries).toHaveLength(1);
    expect(result.injectedMessages).toHaveLength(2);
  });

  it("deduplicates equivalent planner paths before consuming the read budget", async () => {
    const root = await fs.mkdtemp(path.join("/tmp", "engineeringos-prefetch-dedup-"));
    tempRoots.push(root);
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.writeFile(
      path.join(root, "src", "index.ts"),
      "export const deduplicated = true;\n",
      "utf8",
    );
    await fs.writeFile(
      path.join(root, "src", "queries.ts"),
      "export const queries = true;\n",
      "utf8",
    );

    const result = await prefetchFileList({
      files: [
        "src/index.ts",
        "./src/index.ts",
        "src\\index.ts",
        "src/queries.ts",
        "src/queries.ts",
      ],
      rootPath: root,
      pendingChanges: [],
      toolCacheKeyFn: (name, args) => `${name}:${JSON.stringify(args)}`,
      complete: true,
      maxFiles: 2,
    });

    expect(result.sources).toEqual(["src/index.ts", "src/queries.ts"]);
    expect(result.cacheEntries).toHaveLength(2);
    expect(result.injectedMessages).toHaveLength(3);
    expect(new Set(result.sources).size).toBe(result.sources.length);
  });
});

describe("prefetchForensicRoots", () => {
  it("discovers and reads scoped roots sequentially before returning evidence", async () => {
    const root = await fs.mkdtemp(path.join("/tmp", "engineeringos-forensic-discovery-"));
    tempRoots.push(root);
    await fs.mkdir(path.join(root, "first", "nested"), { recursive: true });
    await fs.mkdir(path.join(root, "second"), { recursive: true });
    await fs.writeFile(
      path.join(root, "first", "nested", "logic.ts"),
      "export const firstEvidence = true;\n",
      "utf8",
    );
    await fs.writeFile(
      path.join(root, "second", "runtime.ts"),
      "export function run() { return 'second'; }\n",
      "utf8",
    );
    await fs.writeFile(path.join(root, "first", "README.md"), "# evidence\n", "utf8");
    await fs.writeFile(path.join(root, "second", "ignored.bin"), "binary", "utf8");

    const result = await prefetchForensicRoots({
      roots: ["first", "second"],
      rootPath: root,
      pendingChanges: [],
      toolCacheKeyFn: (name, args) => `${name}:${JSON.stringify(args)}`,
      maxFiles: 10,
    });

    expect(result.completedRootCount).toBe(2);
    expect(result.discoveredFiles).toEqual([
      "first/nested/logic.ts",
      "first/README.md",
      "second/runtime.ts",
    ]);
    expect(result.sources).toEqual([
      "first/nested/logic.ts",
      "first/README.md",
      "second/runtime.ts",
    ]);
    expect(result.cacheEntries.map((entry) => entry.content)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("firstEvidence"),
        expect.stringContaining("return 'second'"),
      ]),
    );
  });

  it("records complete coverage for every root when the shared budget is sufficient", async () => {
    const root = await fs.mkdtemp(path.join("/tmp", "engineeringos-forensic-coverage-complete-"));
    tempRoots.push(root);
    await fs.mkdir(path.join(root, "first"), { recursive: true });
    await fs.mkdir(path.join(root, "second"), { recursive: true });
    await fs.writeFile(path.join(root, "first", "runtime.ts"), "export const first = true;\n", "utf8");
    await fs.writeFile(path.join(root, "second", "runtime.ts"), "export const second = true;\n", "utf8");

    const result = await prefetchForensicRoots({
      roots: ["first", "second"],
      rootPath: root,
      pendingChanges: [],
      toolCacheKeyFn: (name, args) => `${name}:${JSON.stringify(args)}`,
      maxFiles: 2,
    });

    expect(result.budgetExhausted).toBe(false);
    expect(result.completedRootCount).toBe(2);
    expect(result.rootCoverage).toEqual([
      {
        root: "first",
        discoveredFiles: 1,
        readFiles: 1,
        unreadFiles: 0,
        status: "COMPLETE",
        unreadPaths: [],
        truncatedPaths: [],
      },
      {
        root: "second",
        discoveredFiles: 1,
        readFiles: 1,
        unreadFiles: 0,
        status: "COMPLETE",
        unreadPaths: ["second/runtime.ts"],
        truncatedPaths: [],
      },
    ]);
  });

  it("marks the current and later roots incomplete when the shared budget ends", async () => {
    const root = await fs.mkdtemp(path.join("/tmp", "engineeringos-forensic-coverage-budget-"));
    tempRoots.push(root);
    await fs.mkdir(path.join(root, "first"), { recursive: true });
    await fs.mkdir(path.join(root, "second"), { recursive: true });
    await fs.writeFile(path.join(root, "first", "a.ts"), "export const a = true;\n", "utf8");
    await fs.writeFile(path.join(root, "first", "b.ts"), "export const b = true;\n", "utf8");
    await fs.writeFile(path.join(root, "second", "late.ts"), "export const late = true;\n", "utf8");

    const result = await prefetchForensicRoots({
      roots: ["first", "second"],
      rootPath: root,
      pendingChanges: [],
      toolCacheKeyFn: (name, args) => `${name}:${JSON.stringify(args)}`,
      maxFiles: 1,
    });

    expect(result.budgetExhausted).toBe(true);
    expect(result.completedRootCount).toBe(1);
    expect(result.rootCoverage[0]).toMatchObject({
      root: "first",
      readFiles: 1,
      status: "PARTIAL",
    });
    expect(result.rootCoverage[1]).toEqual({
      root: "second",
      discoveredFiles: 0,
      readFiles: 0,
      unreadFiles: 0,
      status: "BUDGET_EXHAUSTED",
      unreadPaths: [],
    });
    expect(result.sources).not.toContain("second/late.ts");
  });

  it("completes a multi-root scope larger than the legacy 48-file cap", async () => {
    // Two real production roots together exceed the old 48-file discovery cap.
    // Coverage completeness is a hard gate that falsifies the verdict on
    // PARTIAL/BUDGET_EXHAUSTED, so the bounded budget must clear the scope.
    const root = await fs.mkdtemp(path.join("/tmp", "engineeringos-forensic-large-scope-"));
    tempRoots.push(root);
    await fs.mkdir(path.join(root, "openapi"), { recursive: true });
    await fs.mkdir(path.join(root, "runtime", "nested"), { recursive: true });
    await fs.writeFile(path.join(root, "openapi", "registry.ts"), "export const r = true;\n", "utf8");
    for (let i = 0; i < 30; i += 1) {
      await fs.mkdir(path.join(root, "runtime", `sub${i}`), { recursive: true });
      await fs.writeFile(
        path.join(root, "runtime", `sub${i}`, `file${i}.ts`),
        `export const v${i} = ${i};\n`,
        "utf8",
      );
    }

    const result = await prefetchForensicRoots({
      roots: ["openapi", "runtime"],
      rootPath: root,
      pendingChanges: [],
      toolCacheKeyFn: (name, args) => `${name}:${JSON.stringify(args)}`,
    });

    expect(result.budgetExhausted).toBe(false);
    expect(result.completedRootCount).toBe(2);
    expect(result.rootCoverage).toMatchObject([
      { root: "openapi", status: "COMPLETE", readFiles: 1 },
      { root: "runtime", status: "COMPLETE", readFiles: 30 },
    ]);
    expect(result.sources).toHaveLength(31);
    expect(result.sources).toContain("runtime/sub29/file29.ts");
  });

  it("does not discover outside the requested roots or follow symlinks", async () => {
    const root = await fs.mkdtemp(path.join("/tmp", "engineeringos-forensic-boundary-"));
    tempRoots.push(root);
    await fs.mkdir(path.join(root, "scope"), { recursive: true });
    await fs.mkdir(path.join(root, "outside"), { recursive: true });
    await fs.writeFile(path.join(root, "scope", "safe.ts"), "export const safe = true;\n", "utf8");
    await fs.writeFile(path.join(root, "outside", "secret.ts"), "export const secret = true;\n", "utf8");
    await fs.symlink(path.join(root, "outside"), path.join(root, "scope", "linked"));

    const result = await prefetchForensicRoots({
      roots: ["scope"],
      rootPath: root,
      pendingChanges: [],
      toolCacheKeyFn: (name, args) => `${name}:${JSON.stringify(args)}`,
      maxFiles: 10,
    });

    expect(result.completedRootCount).toBe(1);
    expect(result.discoveredFiles).toEqual(["scope/safe.ts"]);
    expect(result.sources).toEqual(["scope/safe.ts"]);
    expect(result.sources).not.toContain("scope/linked/secret.ts");
  });

  it("skips tests and fixtures for production discovery but supports explicit opt-in", async () => {
    const root = await fs.mkdtemp(path.join("/tmp", "engineeringos-forensic-source-policy-"));
    tempRoots.push(root);
    await fs.mkdir(path.join(root, "src", "__tests__", "fixtures"), { recursive: true });
    await fs.writeFile(
      path.join(root, "src", "runtime.ts"),
      "export const runtime = true;\n",
      "utf8",
    );
    await fs.writeFile(
      path.join(root, "src", "__tests__", "fixtures", "known-defect.ts"),
      "return eval(expression);\n",
      "utf8",
    );

    const production = await prefetchForensicRoots({
      roots: ["src"],
      rootPath: root,
      pendingChanges: [],
      toolCacheKeyFn: (name, args) => `${name}:${JSON.stringify(args)}`,
      maxFiles: 10,
    });
    const capability = await prefetchForensicRoots({
      roots: ["src"],
      rootPath: root,
      pendingChanges: [],
      toolCacheKeyFn: (name, args) => `${name}:${JSON.stringify(args)}`,
      maxFiles: 10,
      includeTestSources: true,
    });

    expect(production.sources).toEqual(["src/runtime.ts"]);
    expect(capability.sources).toEqual([
      "src/__tests__/fixtures/known-defect.ts",
      "src/runtime.ts",
    ]);
  });

  it("skips generated benchmark output by default but allows an explicit generated root", async () => {
    const root = await fs.mkdtemp(path.join("/tmp", "engineeringos-forensic-generated-"));
    tempRoots.push(root);
    await fs.mkdir(path.join(root, "src", "benchmark-results"), { recursive: true });
    await fs.writeFile(path.join(root, "src", "runtime.ts"), "export const runtime = true;\n", "utf8");
    await fs.writeFile(
      path.join(root, "src", "benchmark-results", "score.json"),
      '{ "result": "generated" }\n',
      "utf8",
    );

    const production = await prefetchForensicRoots({
      roots: ["src"],
      rootPath: root,
      pendingChanges: [],
      toolCacheKeyFn: (name, args) => `${name}:${JSON.stringify(args)}`,
      maxFiles: 10,
    });
    const explicit = await prefetchForensicRoots({
      roots: ["src/benchmark-results"],
      rootPath: root,
      pendingChanges: [],
      toolCacheKeyFn: (name, args) => `${name}:${JSON.stringify(args)}`,
      maxFiles: 10,
    });

    expect(production.sources).toEqual(["src/runtime.ts"]);
    expect(explicit.sources).toEqual(["src/benchmark-results/score.json"]);
  });
});