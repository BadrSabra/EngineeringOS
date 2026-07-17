import { describe, it, expect } from "vitest";
import { extractGraph } from "../graph-extractor.js";
import type { ScannedFile } from "../file-walker.js";
import type { ExtractionMethod } from "../graph-extractor.js";

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
  it("returns empty entities and relationships for an empty file list", async () => {
    const result = await extractGraph([]);

    expect(result.entities).toHaveLength(0);
    expect(result.relationships).toHaveLength(0);
  });

  it("creates a file entity for each TypeScript source file", async () => {
    const files = [
      makeFile("src/index.ts", "export const x = 1;"),
      makeFile("src/utils.ts", "export const y = 2;"),
    ];

    const result = await extractGraph(files);

    const fileEntities = result.entities.filter((e) => e.type === "file");
    expect(fileEntities.length).toBeGreaterThanOrEqual(2);
  });

  it("extracts function entities from exported functions", async () => {
    const files = [
      makeFile("src/utils.ts", "export function parseUser(data: unknown) { return data; }"),
    ];

    const result = await extractGraph(files);

    const fnEntities = result.entities.filter((e) => e.type === "function");
    expect(fnEntities.some((e) => e.name === "parseUser")).toBe(true);
  });

  it("extracts class entities from exported classes", async () => {
    const files = [makeFile("src/service.ts", "export class UserService { }")];

    const result = await extractGraph(files);

    const classEntities = result.entities.filter((e) => e.type === "class");
    expect(classEntities.some((e) => e.name === "UserService")).toBe(true);
  });

  it("records import relationships between files", async () => {
    // Use bare specifier without extension — the resolver tries adding .ts/.js etc.
    const files = [
      makeFile("src/index.ts", 'import { parseUser } from "./utils";'),
      makeFile("src/utils.ts", "export function parseUser() {}"),
    ];

    const result = await extractGraph(files);

    const importRels = result.relationships.filter((r) => r.relation === "imports");
    expect(importRels.length).toBeGreaterThan(0);
  });

  it("does not produce duplicate file entities for the same path", async () => {
    const files = [makeFile("src/foo.ts", "export const a = 1;")];

    const result = await extractGraph(files);

    const fileEntities = result.entities.filter(
      (e) => e.type === "file" && e.path === "src/foo.ts",
    );
    expect(fileEntities.length).toBe(1);
  });

  it("includes a non-empty path on every entity", async () => {
    const files = [makeFile("src/utils.ts", "export function helper() {}")];

    const result = await extractGraph(files);

    for (const entity of result.entities) {
      expect(typeof entity.path).toBe("string");
      expect(entity.path.length).toBeGreaterThan(0);
    }
  });

  it("handles files without content gracefully", async () => {
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

    await extractGraph(files);
  });

  it("extracts a default-exported class (regex-based extractor could not see this)", async () => {
    const files = [makeFile("src/service.ts", "export default class UserService { }")];

    const result = await extractGraph(files);

    const classEntities = result.entities.filter((e) => e.type === "class");
    expect(classEntities.some((e) => e.name === "UserService")).toBe(true);
  });

  it("extracts a multi-line exported arrow function", async () => {
    const files = [
      makeFile(
        "src/utils.ts",
        "export const parseUser = (\n  data: unknown\n) => {\n  return data;\n};",
      ),
    ];

    const result = await extractGraph(files);

    const fnEntities = result.entities.filter((e) => e.type === "function");
    expect(fnEntities.some((e) => e.name === "parseUser")).toBe(true);
  });

  it("extracts every declarator from a multi-declarator exported const statement", async () => {
    const files = [
      makeFile("src/handlers.ts", "export const foo = () => {}, bar = () => {};"),
    ];

    const result = await extractGraph(files);

    const fnEntities = result.entities.filter((e) => e.type === "function");
    expect(fnEntities.some((e) => e.name === "foo")).toBe(true);
    expect(fnEntities.some((e) => e.name === "bar")).toBe(true);
  });

  it("extracts an Express route registered via router.get", async () => {
    const files = [
      makeFile("src/routes/users.ts", 'router.get("/users/:id", async (req, res) => {});'),
    ];

    const result = await extractGraph(files);

    const apiEntities = result.entities.filter((e) => e.type === "api");
    expect(apiEntities.some((e) => e.name === "GET /users/:id")).toBe(true);
  });

  it("does not throw on syntactically invalid TypeScript content", async () => {
    const files = [makeFile("src/broken.ts", "export const x = {{{ this is not valid ts !!")];

    await extractGraph(files);
  });

  it("extracts class methods as qualified function entities, skipping private members", async () => {
    const files = [
      makeFile(
        "src/service.ts",
        "export class UserService { getUser() {} #internal() {} private helper() {} }",
      ),
    ];

    const result = await extractGraph(files);

    const fnEntities = result.entities.filter((e) => e.type === "function");
    expect(fnEntities.some((e) => e.name === "UserService.getUser")).toBe(true);
    expect(fnEntities.some((e) => e.name === "UserService.helper")).toBe(false);
  });

  it("records import relationships from CommonJS require()", async () => {
    const files = [
      makeFile("src/index.js", 'const { parseUser } = require("./utils");', "javascript"),
      makeFile("src/utils.js", "module.exports.parseUser = function () {};", "javascript"),
    ];

    const result = await extractGraph(files);

    const importRels = result.relationships.filter((r) => r.relation === "imports");
    expect(importRels.length).toBeGreaterThan(0);
  });

  it("extracts a function entity from a bare exports.foo assignment", async () => {
    const files = [
      makeFile("src/utils.js", "exports.parseUser = function () { return 1; };", "javascript"),
    ];

    const result = await extractGraph(files);

    const fnEntities = result.entities.filter((e) => e.type === "function");
    expect(fnEntities.some((e) => e.name === "parseUser")).toBe(true);
  });

  it("treats a class named in `export = Foo` as exported even without its own export keyword", async () => {
    const files = [makeFile("src/legacy.ts", "class Foo { bar() {} }\nexport = Foo;")];

    const result = await extractGraph(files);

    const classEntities = result.entities.filter((e) => e.type === "class");
    expect(classEntities.some((e) => e.name === "Foo")).toBe(true);
  });

  it("does not generate function/class entities from markdown or JSON files", async () => {
    const files = [
      makeFile("README.md", "# Hello", "markdown"),
      makeFile("config.json", '{"key":"value"}', "json"),
    ];

    const result = await extractGraph(files);
    const nonFileEntities = result.entities.filter((e) => e.type !== "file");

    expect(nonFileEntities).toHaveLength(0);
  });

  it("extracts function entities from Object.assign(module.exports, {...}) batch exports", async () => {
    const files = [
      makeFile(
        "src/utils.js",
        "Object.assign(module.exports, { foo() { return 1; }, bar: () => 2, baz: function () { return 3; } });",
        "javascript",
      ),
    ];

    const result = await extractGraph(files);

    const fnEntities = result.entities.filter((e) => e.type === "function");
    expect(fnEntities.some((e) => e.name === "foo")).toBe(true);
    expect(fnEntities.some((e) => e.name === "bar")).toBe(true);
    expect(fnEntities.some((e) => e.name === "baz")).toBe(true);
  });

  it("records an import relationship for module.exports = require(...) re-exports", async () => {
    const files = [
      makeFile("src/index.js", 'module.exports = require("./impl");', "javascript"),
      makeFile("src/impl.js", "module.exports.run = function () {};", "javascript"),
    ];

    const result = await extractGraph(files);

    const importRels = result.relationships.filter((r) => r.relation === "imports");
    expect(importRels.some((r) => r.sourceName === "src/index.js" && r.targetName === "src/impl.js")).toBe(true);
  });

  it("extracts a function entity from module.exports bracket-notation assignment", async () => {
    const files = [
      makeFile("src/utils.js", 'module.exports["parseUser"] = function (data) { return data; };', "javascript"),
    ];

    const result = await extractGraph(files);

    const fnEntities = result.entities.filter((e) => e.type === "function");
    expect(fnEntities.some((e) => e.name === "parseUser")).toBe(true);
  });

  it("extracts a function entity from exports bracket-notation assignment with arrow function", async () => {
    const files = [
      makeFile("src/utils.js", 'exports["serialize"] = (x) => JSON.stringify(x);', "javascript"),
    ];

    const result = await extractGraph(files);

    const fnEntities = result.entities.filter((e) => e.type === "function");
    expect(fnEntities.some((e) => e.name === "serialize")).toBe(true);
  });

  it("records an import relationship for exports.foo = require(...) named re-export", async () => {
    const files = [
      makeFile("src/index.js", 'exports.utils = require("./utils");', "javascript"),
      makeFile("src/utils.js", "exports.run = function () {};", "javascript"),
    ];

    const result = await extractGraph(files);

    const importRels = result.relationships.filter((r) => r.relation === "imports");
    expect(importRels.some((r) => r.sourceName === "src/index.js" && r.targetName === "src/utils.js")).toBe(true);
  });

  it("extracts function entities from Object.assign(exports, {...}) with bare exports target", async () => {
    const files = [
      makeFile(
        "src/utils.js",
        "Object.assign(exports, { greet() { return 'hi'; }, farewell: () => 'bye' });",
        "javascript",
      ),
    ];

    const result = await extractGraph(files);

    const fnEntities = result.entities.filter((e) => e.type === "function");
    expect(fnEntities.some((e) => e.name === "greet")).toBe(true);
    expect(fnEntities.some((e) => e.name === "farewell")).toBe(true);
  });

  it("records an import relationship for Object.assign(module.exports, require(...)) merge re-export", async () => {
    const files = [
      makeFile("src/index.js", 'Object.assign(module.exports, require("./lib"));', "javascript"),
      makeFile("src/lib.js", "exports.helper = function () {};", "javascript"),
    ];

    const result = await extractGraph(files);

    const importRels = result.relationships.filter((r) => r.relation === "imports");
    expect(importRels.some((r) => r.sourceName === "src/index.js" && r.targetName === "src/lib.js")).toBe(true);
  });

  // ─── Provenance — extraction method ────────────────────────────────────────
  // These three tests verify that every entity and relationship carries a
  // well-formed `provenance` record with the correct sourceType, method,
  // and ≥1 evidence record — regardless of which extractor produced it.

  describe("provenance — typescript-ast (TS compiler API)", () => {
    it("every entity from a TS file has provenance with sourceType=typescript-ast and method=ts-compiler-api", async () => {
      const files = [
        makeFile("src/service.ts", "export class UserService {}\nexport function getUser() {}"),
      ];

      const result = await extractGraph(files);

      const tsEntities = result.entities.filter(
        (e) => e.sourceType === "typescript-ast" || e.provenance?.sourceType === "typescript-ast",
      );
      expect(tsEntities.length).toBeGreaterThan(0);

      for (const entity of tsEntities) {
        expect(entity.provenance).toBeDefined();
        expect(entity.provenance!.sourceType).toBe("typescript-ast");
        expect(entity.provenance!.method).toBe("ts-compiler-api" satisfies ExtractionMethod);
        expect(entity.provenance!.evidence.length).toBeGreaterThanOrEqual(1);
        expect(entity.provenance!.evidence[0].file).toBe(entity.path);
      }
    });

    it("every import relationship from TS has provenance with sourceType=typescript-ast and an import-statement evidence", async () => {
      const files = [
        makeFile("src/index.ts", 'import { getUser } from "./service";'),
        makeFile("src/service.ts", "export function getUser() {}"),
      ];

      const result = await extractGraph(files);

      const importRels = result.relationships.filter((r) => r.relation === "imports");
      expect(importRels.length).toBeGreaterThan(0);

      for (const rel of importRels) {
        expect(rel.provenance).toBeDefined();
        expect(rel.provenance!.sourceType).toBe("typescript-ast");
        expect(rel.provenance!.method).toBe("ts-compiler-api" satisfies ExtractionMethod);
        expect(rel.provenance!.evidence.length).toBeGreaterThanOrEqual(1);
        expect(rel.provenance!.evidence[0].file).toBe(rel.sourceName);
        expect(rel.provenance!.evidence[0].kind).toBe("import-statement");
      }
    });
  });

  describe("provenance — python-ast (subprocess)", () => {
    const makePyFile = (p: string, content: string): ScannedFile => ({
      path: p,
      absPath: `/project/${p}`,
      language: "python",
      content,
      size: content.length,
      lines: content.split("\n").length,
      oversized: false,
    });

    it("every entity from a valid Python file has provenance with sourceType=python-ast and method=python-ast-subprocess", async () => {
      const files = [
        makePyFile("src/models.py", "def parse_user(data):\n    return data\n\nclass UserService:\n    pass\n"),
      ];

      const result = await extractGraph(files);

      const pyEntities = result.entities.filter(
        (e) => e.provenance?.sourceType === "python-ast",
      );
      expect(pyEntities.length).toBeGreaterThan(0);

      for (const entity of pyEntities) {
        expect(entity.provenance!.method).toBe("python-ast-subprocess" satisfies ExtractionMethod);
        expect(entity.provenance!.evidence.length).toBeGreaterThanOrEqual(1);
        expect(entity.provenance!.evidence[0].file).toBe(entity.path);
      }
    });

    it("import relationships from Python AST have sourceType=python-ast and import-statement evidence", async () => {
      const files = [
        makePyFile("src/app.py", "from . import utils\n"),
        makePyFile("src/utils.py", "def helper():\n    pass\n"),
      ];

      const result = await extractGraph(files);

      const importRels = result.relationships.filter(
        (r) => r.relation === "imports" && r.sourceName === "src/app.py",
      );
      expect(importRels.length).toBeGreaterThan(0);

      for (const rel of importRels) {
        expect(rel.provenance).toBeDefined();
        expect(rel.provenance!.sourceType).toBe("python-ast");
        expect(rel.provenance!.method).toBe("python-ast-subprocess" satisfies ExtractionMethod);
        expect(rel.provenance!.evidence[0].kind).toBe("import-statement");
      }
    });
  });

  describe("provenance — regex-fallback (Python syntax error triggers per-file fallback)", () => {
    const makePyFile = (p: string, content: string): ScannedFile => ({
      path: p,
      absPath: `/project/${p}`,
      language: "python",
      content,
      size: content.length,
      lines: content.split("\n").length,
      oversized: false,
    });

    it("entities extracted via regex fallback have sourceType=regex-fallback and method=regex-heuristic", async () => {
      // Python syntax error → subprocess returns parsed.error → per-file regex fallback
      // The regex catches "def foo" from "def foo(:" even though it's invalid Python
      const files = [makePyFile("src/broken.py", "def foo(:\n    pass\n")];

      const result = await extractGraph(files);

      // At minimum the file entity and possibly a function entity are produced via regex
      const regexEntities = result.entities.filter(
        (e) => e.provenance?.sourceType === "regex-fallback",
      );
      expect(regexEntities.length).toBeGreaterThan(0);

      for (const entity of regexEntities) {
        expect(entity.provenance!.method).toBe("regex-heuristic" satisfies ExtractionMethod);
        expect(entity.provenance!.evidence.length).toBeGreaterThanOrEqual(1);
        expect(entity.provenance!.evidence[0].kind).toBe("heuristic");
      }
    });

    it("provenance.evidence on a regex-fallback entity points to the correct file path", async () => {
      const files = [makePyFile("src/broken.py", "def foo(:\n    pass\n")];

      const result = await extractGraph(files);

      const regexEntities = result.entities.filter(
        (e) => e.provenance?.sourceType === "regex-fallback",
      );
      for (const entity of regexEntities) {
        expect(entity.provenance!.evidence[0].file).toBe(entity.path);
      }
    });
  });

  describe("Python extraction (real ast module via subprocess)", () => {
    const makePyFile = (path: string, content: string): ScannedFile => ({
      path,
      absPath: `/project/${path}`,
      language: "python",
      content,
      size: content.length,
      lines: content.split("\n").length,
      oversized: false,
    });

    it("extracts module-level function and class entities", async () => {
      const files = [
        makePyFile(
          "src/models.py",
          "def parse_user(data):\n    return data\n\n\nclass UserService:\n    def get_user(self):\n        pass\n\n    def _internal(self):\n        pass\n",
        ),
      ];

      const result = await extractGraph(files);

      const fnEntities = result.entities.filter((e) => e.type === "function");
      const classEntities = result.entities.filter((e) => e.type === "class");
      expect(fnEntities.some((e) => e.name === "parse_user")).toBe(true);
      expect(classEntities.some((e) => e.name === "UserService")).toBe(true);
      expect(fnEntities.some((e) => e.name === "UserService.get_user")).toBe(true);
      // Private-by-convention methods are skipped, mirroring the TS extractor.
      expect(fnEntities.some((e) => e.name === "UserService._internal")).toBe(false);
    });

    it("resolves relative imports (from . import / from .. import) to known files", async () => {
      const files = [
        makePyFile("src/pkg/handler.py", "from . import utils\nfrom ..shared import helper\n"),
        makePyFile("src/pkg/utils.py", "def run():\n    pass\n"),
        makePyFile("src/shared.py", "def helper():\n    pass\n"),
      ];

      const result = await extractGraph(files);

      const importRels = result.relationships.filter((r) => r.relation === "imports" && r.sourceName === "src/pkg/handler.py");
      expect(importRels.some((r) => r.targetName === "src/pkg/utils.py")).toBe(true);
      expect(importRels.some((r) => r.targetName === "src/shared.py")).toBe(true);
    });

    it("resolves absolute project-internal imports (from pkg.module import x)", async () => {
      const files = [
        makePyFile("src/app.py", "from pkg.utils import helper\n"),
        makePyFile("pkg/utils.py", "def helper():\n    pass\n"),
      ];

      const result = await extractGraph(files);

      const importRels = result.relationships.filter((r) => r.relation === "imports");
      expect(importRels.some((r) => r.sourceName === "src/app.py" && r.targetName === "pkg/utils.py")).toBe(true);
    });

    it("does not throw and falls back gracefully on a Python syntax error", async () => {
      const files = [makePyFile("src/broken.py", "def foo(:\n    pass\n")];

      const result = await extractGraph(files);

      const fileEntities = result.entities.filter((e) => e.type === "file" && e.path === "src/broken.py");
      expect(fileEntities.length).toBe(1);
    });

    it("excludes function-local classes/functions but keeps class-nested inner classes", async () => {
      const files = [
        makePyFile(
          "src/models.py",
          [
            "class TopLevel:",
            "    def method(self):",
            "        pass",
            "",
            "    class Meta:",
            "        def helper(self):",
            "            pass",
            "",
            "def outer():",
            "    class LocalHelper:",
            "        def do_thing(self):",
            "            pass",
            "    return LocalHelper",
            "",
            "class _Private:",
            "    def method(self):",
            "        pass",
            "",
          ].join("\n"),
        ),
      ];

      const result = await extractGraph(files);
      const names = result.entities.map((e) => e.name);

      // Module-level class + its methods, and a class-nested inner class + its methods, are real entities.
      expect(names).toContain("TopLevel");
      expect(names).toContain("TopLevel.method");
      expect(names).toContain("Meta");
      expect(names).toContain("Meta.helper");

      // A class defined inside a function body is local implementation detail, not a module-surface entity.
      expect(names).not.toContain("LocalHelper");
      expect(names).not.toContain("LocalHelper.do_thing");

      // Private-by-convention classes are excluded, and so are their methods (no orphaned entries).
      expect(names).not.toContain("_Private");
      expect(names).not.toContain("_Private.method");
    });
  });
});
