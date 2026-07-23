import ts from "typescript";
import type { ScannedFile } from "./file-walker.js";
import { extractPythonBatch, type PythonImportInfo, type PythonFileResult } from "./python-extractor.js";

export type EntityType =
  | "file"
  | "function"
  | "class"
  | "api"
  | "task"
  | "rule"
  | "phase"
  | "module";

/**
 * Typed edge category for Knowledge Graph 2.0.
 * Every relationship emitted by the extractor is classified into one of these
 * categories so consumers can filter by type without string-matching.
 */
export type GraphEdgeType =
  | "imports"
  | "calls"
  | "extends"
  | "implements"
  | "uses"
  | "emits"
  | "observes"
  | "produces"
  | "depends_on";

/**
 * A single piece of evidence that justifies the existence of an entity or
 * relationship. Makes every graph element traceable to its source location.
 */
export type GraphEvidence = {
  file: string;
  line?: number;
  column?: number;
  snippet?: string;
  kind:
    | "import-statement"
    | "call-site"
    | "class-definition"
    | "function-definition"
    | "interface-definition"
    | "jsdoc"
    | "heuristic";
};

/**
 * The specific extractor that produced a graph element.
 * Narrows `sourceType` to a concrete mechanism so consumers can distinguish
 * "real AST" from "regex guess" without string-matching on the broader sourceType field.
 */
export type ExtractionMethod =
  | "ts-compiler-api"       // TypeScript compiler API (real AST, structural certainty)
  | "python-ast-subprocess" // Python `ast` module via batched subprocess (real AST)
  | "regex-heuristic"       // Regex line scan — approximate, may miss edge cases
  | "manual-import";        // Hand-authored seed/provenance data

/**
 * Unified provenance record for a graph entity.
 * Combines sourceType + extraction method + ≥1 evidence record in one place
 * so consumers never need to reassemble them from separate fields.
 */
export interface EntityProvenance {
  /** Extraction source category: typescript-ast | python-ast | regex-fallback | manual */
  sourceType: string;
  /** The specific extractor used — narrows sourceType to a concrete mechanism. */
  method: ExtractionMethod;
  /** ≥1 evidence records linking this entity to its source location. */
  evidence: GraphEvidence[];
}

/**
 * Unified provenance record for a graph relationship/edge.
 * Same structure as EntityProvenance — every edge must be traceable.
 */
export interface RelationshipProvenance {
  sourceType: string;
  method: ExtractionMethod;
  evidence: GraphEvidence[];
}

/**
 * A node in the knowledge graph. All fields beyond type/name/path are
 * optional so existing extractors compile without changes; the `mergeResult`
 * enrichment pass fills in defaults before the final result is returned.
 */
export interface ExtractedEntity {
  type: EntityType;
  name: string;
  /** Relative file path. */
  path: string;
  metadata?: Record<string, unknown>;
  // ── Knowledge Graph 2.0 semantic fields ────────────────────────────────
  /** Sub-kind within the entity type (e.g. "arrow-function", "class-method"). */
  kind?: string;
  /** Extraction source: typescript-ast | python-ast | regex-fallback | manual */
  sourceType?: string;
  /** True when the entity has JSDoc/docstring documentation. */
  isDocumented?: boolean;
  /** Free-form semantic tags (e.g. ["auth", "public-api", "deprecated"]). */
  semanticTags?: string[];
  /** Short description from doc comment or declaration. */
  description?: string;
  /** Confidence [0, 1] — 1.0 = AST-level certainty, 0.5 = heuristic. */
  confidence?: number;
  /** Business domain (e.g. "auth", "payments", "infra"). */
  domain?: string;
  /** Lifecycle stage: stable | experimental | deprecated | internal. */
  lifecycle?: string;
  /**
   * Unified provenance: sourceType + extraction method + evidence records.
   * Optional at push sites — mergeResult() guarantees it is present on every
   * entity in the final result. Never rely on this being absent.
   */
  provenance?: EntityProvenance;
}

/**
 * A directed edge in the knowledge graph. New KG 2.0 fields are optional so
 * all existing push sites compile; enrichment fills them in at merge time.
 */
export interface ExtractedRelationship {
  sourceName: string;
  targetName: string;
  /** Raw relation string (preserved for backward compat). */
  relation: string;
  // ── Knowledge Graph 2.0 semantic fields ────────────────────────────────
  /** Typed edge category (derived from relation if not explicitly set). */
  relationType?: GraphEdgeType;
  /** Fine-grained sub-classification (e.g. "static-import", "type-only-import"). */
  relationSubtype?: string;
  /** Confidence [0, 1] — 1.0 = AST-certainty, 0.5 = regex heuristic. */
  confidence?: number;
  /** Evidence records that justify this relationship. */
  evidence?: GraphEvidence[];
  /** True when inferred by heuristic rules rather than direct parse evidence. */
  isHeuristic?: boolean;
  /** True when observed at runtime (trace/profiling), not static analysis. */
  isRuntimeObserved?: boolean;
  /** Semantic tags. */
  semanticTags?: string[];
  /** Which extractor produced this relationship. */
  sourceType?: string;
  /**
   * Unified provenance: sourceType + extraction method + evidence records.
   * Optional at push sites — mergeResult() guarantees it is present on every
   * relationship in the final result.
   */
  provenance?: RelationshipProvenance;
}

export interface GraphExtractionResult {
  entities: ExtractedEntity[];
  relationships: ExtractedRelationship[];
}

type PartialResult = { entities: ExtractedEntity[]; relationships: ExtractedRelationship[] };

// ─── Path utilities ───────────────────────────────────────────────────────────

/**
 * Build a map of workspace package names → their directory paths from the
 * package.json files present in the scanned file list.
 *
 * Example output:
 *   "@workspace/db"               → "lib/db"
 *   "@workspace/ai-orchestrator"  → "lib/ai-orchestrator"
 *   "@workspace/api-server"       → "artifacts/api-server"
 *
 * The map is used by resolvePackageImport() to turn bare package-name import
 * specifiers into file-system paths that matchImportToEntity() can look up.
 */
function buildWorkspaceAliasMap(files: ScannedFile[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const file of files) {
    if (
      (file.path === "package.json" || file.path.endsWith("/package.json")) &&
      !file.path.includes("node_modules") &&
      file.content
    ) {
      try {
        const pkg = JSON.parse(file.content) as { name?: string };
        if (pkg.name && typeof pkg.name === "string") {
          const dir =
            file.path === "package.json"
              ? ""
              : file.path.slice(0, file.path.lastIndexOf("/"));
          map.set(pkg.name, dir);
        }
      } catch {
        // malformed package.json — skip
      }
    }
  }
  return map;
}

/**
 * Resolve a bare package-name import specifier to a file path using the
 * workspace alias map.
 *
 * Handles two forms:
 *  1. Exact name:   `@workspace/db`            → resolves the package root entry point
 *  2. Subpath:      `@workspace/db/src/schema` → resolves pkgDir + "/src/schema"
 *
 * Returns null when the specifier does not match any known workspace package.
 */
function resolvePackageImport(
  specifier: string,
  aliasMap: Map<string, string>,
  knownPaths: Set<string>,
): string | null {
  // 1. Exact package name  e.g. `@workspace/db`
  if (aliasMap.has(specifier)) {
    const pkgDir = aliasMap.get(specifier)!;
    // Try src/index, then bare index, to match the common monorepo layout.
    const candidates = pkgDir
      ? [`${pkgDir}/src/index`, `${pkgDir}/index`]
      : ["src/index", "index"];
    for (const base of candidates) {
      const hit = matchImportToEntity(base, knownPaths);
      if (hit) return hit;
    }
    return null;
  }

  // 2. Subpath import  e.g. `@workspace/db/src/schema`
  for (const [pkgName, pkgDir] of aliasMap) {
    if (specifier.startsWith(pkgName + "/")) {
      const subpath = specifier.slice(pkgName.length + 1); // "src/schema"
      const base = pkgDir ? `${pkgDir}/${subpath}` : subpath;
      return matchImportToEntity(base, knownPaths);
    }
  }

  return null;
}

function resolveRelativeImport(importSpecifier: string, fromFilePath: string): string | null {
  if (!importSpecifier.startsWith(".")) return null;

  // Strip ESM-in-TS ".js" / ".jsx" / ".mjs" / ".cjs" / ".mts" suffixes that
  // TypeScript source uses in import specifiers but the actual file is .ts/.tsx.
  // e.g.  "./routes/index.js"  →  "./routes/index"
  //       "./lib/logger.js"    →  "./lib/logger"
  const strippedSpecifier = importSpecifier.replace(/\.(js|jsx|mjs|cjs|mts)$/, "");

  const lastSlash = fromFilePath.lastIndexOf("/");
  const fromDir = lastSlash >= 0 ? fromFilePath.slice(0, lastSlash) : "";

  const raw = (fromDir ? fromDir + "/" : "") + strippedSpecifier;
  const parts = raw.split("/");
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === "..") {
      resolved.pop();
    } else if (part !== ".") {
      resolved.push(part);
    }
  }
  return resolved.join("/");
}

function matchImportToEntity(resolvedBase: string, knownPaths: Set<string>): string | null {
  const extensions = [".ts", ".tsx", ".js", ".jsx", ".mts", ".mjs"];
  for (const ext of extensions) {
    const candidate = resolvedBase + ext;
    if (knownPaths.has(candidate)) return candidate;
  }
  for (const ext of extensions) {
    const candidate = resolvedBase + "/index" + ext;
    if (knownPaths.has(candidate)) return candidate;
  }
  if (knownPaths.has(resolvedBase)) return resolvedBase;
  return null;
}

function dirname(filePath: string): string {
  const lastSlash = filePath.lastIndexOf("/");
  return lastSlash >= 0 ? filePath.slice(0, lastSlash) : "";
}

/**
 * Resolve a Python `import`/`from ... import` statement to a project-root
 * relative path stub (before extension matching), given the file it was
 * found in.
 *
 * - `level === 0` (absolute import, e.g. `import pkg.mod` or
 *   `from pkg.mod import x`): treated as possibly project-internal by
 *   trying the dotted module path from the project root. This resolves
 *   common "from myapp.utils import helper" style internal imports that a
 *   leading-dot-only heuristic would miss; imports of genuinely external
 *   packages simply won't match any known path and are silently dropped,
 *   same as unresolved TS bare-specifier imports.
 * - `level >= 1` (relative import, e.g. `from . import x` / `from ..pkg
 *   import y`): resolved relative to the *package* (directory) containing
 *   the current file, per Python's relative-import semantics — level 1
 *   means "this package" (no directory change), level 2 means "parent
 *   package", etc.
 */
function pythonImportCandidates(imp: PythonImportInfo, fromFilePath: string): string[] {
  let baseDir: string;
  if (imp.level === 0) {
    baseDir = "";
  } else {
    baseDir = dirname(fromFilePath);
    for (let i = 1; i < imp.level; i++) {
      baseDir = dirname(baseDir);
    }
  }

  const modulePath = imp.module
    ? baseDir
      ? `${baseDir}/${imp.module.replace(/\./g, "/")}`
      : imp.module.replace(/\./g, "/")
    : baseDir || null;

  const candidates: string[] = [];
  if (modulePath) candidates.push(modulePath);

  // `from . import utils` / `from pkg import utils` — `utils` is commonly a
  // *submodule* (a sibling file), not an attribute pulled out of the parent
  // module's namespace. Try each imported name appended to the module path
  // (or bare package dir, for `from . import x`) as its own candidate file.
  for (const name of imp.names) {
    const base = modulePath ?? baseDir;
    candidates.push(base ? `${base}/${name}` : name);
  }

  return candidates;
}

function matchPythonImportToEntity(resolvedBase: string, knownPaths: Set<string>): string | null {
  if (knownPaths.has(`${resolvedBase}.py`)) return `${resolvedBase}.py`;
  if (knownPaths.has(`${resolvedBase}/__init__.py`)) return `${resolvedBase}/__init__.py`;
  if (knownPaths.has(resolvedBase)) return resolvedBase;
  return null;
}

// ─── AST-based TS/JS extractor ────────────────────────────────────────────────

// ─── Knowledge Graph 2.0 helpers ─────────────────────────────────────────────

/**
 * Classify a raw relation string into a typed `GraphEdgeType` + optional
 * subtype. Unknown strings fall back to `"uses"` with `isHeuristic: true` so
 * the caller can distinguish typed from unclassified edges.
 */
function classifyRelationType(relation: string): {
  relationType: GraphEdgeType;
  relationSubtype?: string;
  isHeuristic?: boolean;
} {
  switch (relation) {
    case "imports":
      return { relationType: "imports", relationSubtype: "static-import" };
    case "dynamic-imports":
      return { relationType: "imports", relationSubtype: "dynamic-import" };
    case "type-imports":
      return { relationType: "imports", relationSubtype: "type-only-import" };
    case "extends":
      return { relationType: "extends", relationSubtype: "class-inheritance" };
    case "implements":
      return { relationType: "implements", relationSubtype: "interface-implementation" };
    case "calls":
      return { relationType: "calls" };
    case "uses":
      return { relationType: "uses" };
    case "emits":
      return { relationType: "emits" };
    case "observes":
      return { relationType: "observes" };
    case "produces":
      return { relationType: "produces" };
    case "depends_on":
      return { relationType: "depends_on" };
    default:
      // Unknown relation types are marked heuristic so consumers can filter
      // them out when they need high-confidence structural edges only.
      return { relationType: "uses", isHeuristic: true };
  }
}

/**
 * Assign a baseline confidence score based on how the entity or relationship
 * was extracted. AST-level extraction (TypeScript compiler, Python `ast`
 * module) gets near-perfect confidence; regex heuristics get 0.5.
 */
function scoreExtractionConfidence(sourceType: string | undefined): number {
  switch (sourceType) {
    case "typescript-ast": return 1.0;
    case "python-ast":     return 0.95;
    case "regex-fallback": return 0.5;
    case "manual":         return 1.0;
    default:               return 0.7;
  }
}

/**
 * Map a sourceType category string to its concrete ExtractionMethod.
 * This is the bridge between the broad category (what) and the mechanism (how).
 */
function methodForSourceType(sourceType: string): ExtractionMethod {
  switch (sourceType) {
    case "typescript-ast": return "ts-compiler-api";
    case "python-ast":     return "python-ast-subprocess";
    case "regex-fallback": return "regex-heuristic";
    case "manual":         return "manual-import";
    default:               return "ts-compiler-api";
  }
}

/**
 * Choose the best-fit GraphEvidence kind for an entity, given its type and
 * how it was extracted. Heuristic extractions always use "heuristic" so
 * consumers can filter low-confidence evidence in one step.
 */
function entityEvidenceKind(entityType: EntityType, sourceType: string): GraphEvidence["kind"] {
  if (sourceType === "regex-fallback") return "heuristic";
  switch (entityType) {
    case "class":    return "class-definition";
    case "function": return "function-definition";
    case "api":      return "call-site";
    default:         return "heuristic";
  }
}

/**
 * Build the unified EntityProvenance for a single entity.
 * Called by mergeResult() — the single enrichment point — so every entity
 * in the final result carries the same provenance shape regardless of extractor.
 */
function buildEntityProvenance(entity: ExtractedEntity, sourceType: string): EntityProvenance {
  return {
    sourceType,
    method: methodForSourceType(sourceType),
    evidence: [{
      file: entity.path,
      kind: entityEvidenceKind(entity.type, sourceType),
      snippet: entity.name,
    }],
  };
}

/**
 * Build the unified RelationshipProvenance for a single edge.
 * Prefers any evidence already attached at the push site; builds a minimal
 * fallback from the known source file and edge classification if none.
 */
function buildRelationshipProvenance(
  rel: ExtractedRelationship,
  sourceType: string,
  isHeuristic: boolean,
  relationType: GraphEdgeType,
): RelationshipProvenance {
  const existingEvidence = rel.evidence?.length ? rel.evidence : undefined;
  const evidenceKind: GraphEvidence["kind"] =
    isHeuristic ? "heuristic" :
    relationType === "imports" ? "import-statement" :
    "call-site";
  return {
    sourceType,
    method: methodForSourceType(sourceType),
    evidence: existingEvidence ?? [{ file: rel.sourceName, kind: evidenceKind }],
  };
}

const EXPRESS_METHODS = new Set(["get", "post", "put", "patch", "delete", "all"]);

/**
 * Returns true when `node` has a leading JSDoc block comment (`/** ... *\/`).
 * Uses the TypeScript compiler's own comment-range API so it correctly handles
 * whitespace, shebangs, and other trivia that might precede the node.
 *
 * Item 6 — adds `isDocumented` semantic metadata to extracted TS/JS entities
 * so the knowledge graph can distinguish documented from undocumented surfaces.
 */
function hasJsDoc(node: ts.Node, content: string): boolean {
  const ranges = ts.getLeadingCommentRanges(content, node.pos);
  if (!ranges || ranges.length === 0) return false;
  return ranges.some(
    (r) => r.kind === ts.SyntaxKind.MultiLineCommentTrivia && content.slice(r.pos, r.pos + 3) === "/**",
  );
}

function scriptKindFor(path: string): ts.ScriptKind {
  if (path.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (path.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (path.endsWith(".ts") || path.endsWith(".mts") || path.endsWith(".cts")) return ts.ScriptKind.TS;
  return ts.ScriptKind.JS;
}

function isExported(node: ts.Node): boolean {
  const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  return !!modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

/**
 * `Object.assign(module.exports, { foo() {}, bar: () => {}, baz: function () {} })`
 * — record a function entity for each function-valued property on the
 * object-literal argument. Non-call-expression or non-`Object.assign`
 * expressions, and calls whose second argument isn't an object literal,
 * are silently ignored (not every `Object.assign(...)` call is an export).
 */
function collectObjectAssignExports(call: ts.CallExpression, path: string, entities: ExtractedEntity[]): void {
  if (
    !ts.isPropertyAccessExpression(call.expression) ||
    !ts.isIdentifier(call.expression.expression) ||
    call.expression.expression.text !== "Object" ||
    call.expression.name.text !== "assign"
  ) {
    return;
  }
  if (call.arguments.length < 2) return;

  const target = call.arguments[0];
  const isModuleExportsTarget =
    ts.isPropertyAccessExpression(target) &&
    ts.isIdentifier(target.expression) &&
    target.expression.text === "module" &&
    target.name.text === "exports";
  // Also handle bare `exports` as the first argument:
  // Object.assign(exports, { foo() {} }) is equivalent to
  // Object.assign(module.exports, { foo() {} }) in CommonJS modules.
  const isExportsTarget = ts.isIdentifier(target) && target.text === "exports";
  if (!isModuleExportsTarget && !isExportsTarget) return;

  for (const arg of call.arguments.slice(1)) {
    if (!ts.isObjectLiteralExpression(arg)) continue;
    for (const prop of arg.properties) {
      if (ts.isMethodDeclaration(prop) && ts.isIdentifier(prop.name)) {
        entities.push({ type: "function", name: prop.name.text, path, metadata: { kind: "commonjs-export" } });
      } else if (
        ts.isPropertyAssignment(prop) &&
        ts.isIdentifier(prop.name) &&
        (ts.isArrowFunction(prop.initializer) || ts.isFunctionExpression(prop.initializer))
      ) {
        entities.push({ type: "function", name: prop.name.text, path, metadata: { kind: "commonjs-export" } });
      }
    }
  }
}

/**
 * Parse a TS/JS file into a real AST via the TypeScript compiler API and walk
 * it to find exported functions/classes, Express-style route registrations,
 * and import specifiers. This replaces the previous line-by-line regex
 * approach, so it correctly handles multi-line declarations, default exports,
 * `export default class Foo`, and arrow functions assigned via destructuring
 * or multi-declarator `const` statements — none of which the regex version
 * could see.
 */
function extractFromTsJs(
  file: ScannedFile,
  knownPaths: Set<string>,
  aliasMap: Map<string, string>,
): PartialResult {
  const entities: ExtractedEntity[] = [];
  const relationships: ExtractedRelationship[] = [];
  const { content, path } = file;

  if (!content) return { entities, relationships };

  entities.push({ type: "file", name: path, path, metadata: { language: file.language } });

  let sourceFile: ts.SourceFile;
  try {
    // setParentNodes=false: the walk below never calls node.parent, so we
    // skip the extra bookkeeping the parser would otherwise do per node.
    sourceFile = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, false, scriptKindFor(path));
  } catch {
    // Unparseable content (e.g. binary mistakenly tagged as source) — fall
    // back to just the file entity rather than throwing.
    return { entities, relationships };
  }

  // `export = Foo;` (TS's CommonJS-interop export form) makes `Foo` visible
  // without needing its own `export` keyword. Collect exported identifier
  // names up front so the declaration visitor below can treat them as
  // exported even when `isExported()` alone would miss them.
  const exportEqualsNames = new Set<string>();
  ts.forEachChild(sourceFile, function collectExportEquals(node) {
    if (ts.isExportAssignment(node) && node.isExportEquals && ts.isIdentifier(node.expression)) {
      exportEqualsNames.add(node.expression.text);
    }
    ts.forEachChild(node, collectExportEquals);
  });

  const visit = (node: ts.Node): void => {
    // export function foo() {}  /  export default function foo() {}  /
    // function foo() {} ... export = foo;
    // Non-exported top-level async/named functions are also captured at lower
    // confidence (0.5) — they represent significant implementation units (route
    // handlers, middleware, workers) that the AI needs to reason about even
    // though they are module-internal. Confidence distinguishes them from
    // exported public-API functions (which get the default 0.95 via mergeResult).
    if (
      ts.isFunctionDeclaration(node) &&
      node.name
    ) {
      const exported = isExported(node) || exportEqualsNames.has(node.name.text);
      entities.push({
        type: "function",
        name: node.name.text,
        path,
        metadata: { isDocumented: hasJsDoc(node, content), exported },
        // Non-exported functions get lower confidence so the context builder
        // surfaces exported ones first when space is constrained.
        confidence: exported ? undefined : 0.5,
      });
    }

    // export class Foo {}  /  export default class Foo {}  /
    // class Foo {} ... export = Foo;
    // Non-exported classes captured at confidence 0.5 for the same reason.
    if (
      ts.isClassDeclaration(node) &&
      node.name
    ) {
      const exported = isExported(node) || exportEqualsNames.has(node.name.text);
      entities.push({
        type: "class",
        name: node.name.text,
        path,
        metadata: { isDocumented: hasJsDoc(node, content), exported },
        confidence: exported ? undefined : 0.5,
      });
      // Public instance/static methods on the class, recorded as function
      // entities qualified by their owning class so `Foo.bar` and `Baz.bar`
      // don't collide. Constructors and private (#-named) members are
      // skipped — they're implementation detail, not part of the class's
      // callable surface that other files would reference.
      for (const member of node.members) {
        if (
          ts.isMethodDeclaration(member) &&
          member.name &&
          ts.isIdentifier(member.name) &&
          !ts.getModifiers(member)?.some((m) => m.kind === ts.SyntaxKind.PrivateKeyword)
        ) {
          entities.push({
            type: "function",
            name: `${node.name.text}.${member.name.text}`,
            path,
            metadata: { className: node.name.text, kind: "method" },
          });
        }
      }
    }

    // export const foo = (...) => {} / export const foo = function () {}
    // Handles multiple declarators in one statement and any initializer kind
    // that is callable, unlike the old regex which required `= (` on the
    // same line as `export const`.
    if (ts.isVariableStatement(node) && isExported(node)) {
      for (const decl of node.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
        if (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer)) {
          entities.push({ type: "function", name: decl.name.text, path });
        }
      }
    }

    // Express-style route registration: router.get("/path", ...) / app.post(...)
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      EXPRESS_METHODS.has(node.expression.name.text) &&
      node.arguments.length > 0 &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      const receiver = node.expression.expression;
      const receiverName = ts.isIdentifier(receiver) ? receiver.text : undefined;
      if (receiverName === "router" || receiverName === "app") {
        const method = node.expression.name.text.toUpperCase();
        const routePath = node.arguments[0].text;
        entities.push({
          type: "api",
          name: `${method} ${routePath}`,
          path,
          metadata: { method, route: routePath, definedIn: path },
        });
      }
    }

    // import ... from "specifier"; and export ... from "specifier";
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      const specifier = node.moduleSpecifier.text;
      if (specifier.startsWith(".")) {
        const resolved = resolveRelativeImport(specifier, path);
        if (resolved) {
          const targetName = matchImportToEntity(resolved, knownPaths);
          if (targetName) {
            relationships.push({ sourceName: path, targetName, relation: "imports" });
          }
        }
      } else {
        // Non-relative (package-name) import — resolve via workspace alias map.
        // e.g. `import { db } from "@workspace/db"` → lib/db/src/index.ts
        const targetName = resolvePackageImport(specifier, aliasMap, knownPaths);
        if (targetName) {
          relationships.push({ sourceName: path, targetName, relation: "imports" });
        }
      }
    }

    // CommonJS: const foo = require("./bar"); / require("./bar") as a bare
    // statement. Handles both destructured (`const { a, b } = require(...)`)
    // and plain (`const foo = require(...)`) forms — the relationship only
    // cares about the module link, not which names were pulled out of it.
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "require" &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      const specifier = (node.arguments[0] as ts.StringLiteralLike).text;
      if (specifier.startsWith(".")) {
        const resolved = resolveRelativeImport(specifier, path);
        if (resolved) {
          const targetName = matchImportToEntity(resolved, knownPaths);
          if (targetName) {
            relationships.push({ sourceName: path, targetName, relation: "imports" });
          }
        }
      } else {
        // Non-relative require — resolve via workspace alias map.
        const targetName = resolvePackageImport(specifier, aliasMap, knownPaths);
        if (targetName) {
          relationships.push({ sourceName: path, targetName, relation: "imports" });
        }
      }
    }

    // CommonJS exports: module.exports = Foo; module.exports.foo = ...;
    // exports.foo = function () {}; export = Foo; (TS's `export =` form).
    // These don't introduce a *new* named entity on their own — the
    // underlying function/class declaration (if any) is already captured
    // above — but a bare `module.exports = function () {}` or
    // `exports.foo = () => {}` assigns an otherwise-unexported function
    // surface, so record those as function entities too.
    if (ts.isExpressionStatement(node) && ts.isBinaryExpression(node.expression)) {
      const bin = node.expression;
      if (bin.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        const isModuleExports =
          ts.isPropertyAccessExpression(bin.left) &&
          ts.isIdentifier(bin.left.expression) &&
          bin.left.expression.text === "module" &&
          bin.left.name.text === "exports";
        const exportsPropAssignment =
          ts.isPropertyAccessExpression(bin.left) &&
          ts.isIdentifier(bin.left.expression) &&
          bin.left.expression.text === "exports";

        if (
          (isModuleExports || exportsPropAssignment) &&
          (ts.isArrowFunction(bin.right) || ts.isFunctionExpression(bin.right))
        ) {
          const name = exportsPropAssignment && ts.isPropertyAccessExpression(bin.left)
            ? bin.left.name.text
            : "default";
          entities.push({ type: "function", name, path, metadata: { kind: "commonjs-export" } });
        }

        // module.exports["key"] = fn  /  exports["key"] = fn
        // Bracket-notation export using a string literal key — semantically
        // identical to the dot-notation `exports.key = fn` form above, just
        // with a computed (but statically-known) key.
        const isModuleExportsBracket =
          ts.isElementAccessExpression(bin.left) &&
          ts.isPropertyAccessExpression(bin.left.expression) &&
          ts.isIdentifier((bin.left.expression as ts.PropertyAccessExpression).expression) &&
          ((bin.left.expression as ts.PropertyAccessExpression).expression as ts.Identifier).text === "module" &&
          (bin.left.expression as ts.PropertyAccessExpression).name.text === "exports" &&
          ts.isStringLiteralLike(bin.left.argumentExpression);
        const isExportsBracket =
          ts.isElementAccessExpression(bin.left) &&
          ts.isIdentifier(bin.left.expression) &&
          (bin.left.expression as ts.Identifier).text === "exports" &&
          ts.isStringLiteralLike(bin.left.argumentExpression);
        if (
          (isModuleExportsBracket || isExportsBracket) &&
          (ts.isArrowFunction(bin.right) || ts.isFunctionExpression(bin.right))
        ) {
          const keyNode = (bin.left as ts.ElementAccessExpression).argumentExpression;
          entities.push({
            type: "function",
            name: (keyNode as ts.StringLiteralLike).text,
            path,
            metadata: { kind: "commonjs-export" },
          });
        }

        // exports.foo = require("./other") — an indirect re-export (a named
        // slot on `exports` that points to another module's surface). Not a
        // new entity but a real dependency link, parallel to the already-
        // handled `module.exports = require(...)` case below.
        if (
          exportsPropAssignment &&
          ts.isCallExpression(bin.right) &&
          ts.isIdentifier(bin.right.expression) &&
          bin.right.expression.text === "require" &&
          bin.right.arguments.length === 1 &&
          ts.isStringLiteralLike(bin.right.arguments[0])
        ) {
          const specifier = (bin.right.arguments[0] as ts.StringLiteralLike).text;
          if (specifier.startsWith(".")) {
            const resolved = resolveRelativeImport(specifier, path);
            if (resolved) {
              const targetName = matchImportToEntity(resolved, knownPaths);
              if (targetName) {
                relationships.push({ sourceName: path, targetName, relation: "imports" });
              }
            }
          }
        }

        // module.exports = Object.assign(module.exports, { foo() {}, bar: () => {} })
        // and the more common bare `Object.assign(module.exports, {...})` used
        // as a statement on its own (no outer assignment). Either way, each
        // function-valued property on the object literal becomes a function
        // entity — this is the batch-export idiom some CommonJS modules use
        // instead of individual `exports.foo = ...` lines.
        if (isModuleExports && ts.isCallExpression(bin.right)) {
          collectObjectAssignExports(bin.right, path, entities);
        }
      }
    }

    // Bare `Object.assign(module.exports, {...})` statement (no assignment).
    if (
      ts.isExpressionStatement(node) &&
      ts.isCallExpression(node.expression)
    ) {
      collectObjectAssignExports(node.expression, path, entities);

      // Object.assign(module.exports, require("./other")) — when the second
      // argument is a require() call rather than an object literal, the whole
      // module surface of `./other` is merged in. Treat it as an import link.
      const call = node.expression;
      if (
        ts.isPropertyAccessExpression(call.expression) &&
        ts.isIdentifier(call.expression.expression) &&
        call.expression.expression.text === "Object" &&
        call.expression.name.text === "assign" &&
        call.arguments.length >= 2
      ) {
        for (const arg of call.arguments.slice(1)) {
          if (
            ts.isCallExpression(arg) &&
            ts.isIdentifier(arg.expression) &&
            arg.expression.text === "require" &&
            arg.arguments.length === 1 &&
            ts.isStringLiteralLike(arg.arguments[0])
          ) {
            const specifier = (arg.arguments[0] as ts.StringLiteralLike).text;
            if (specifier.startsWith(".")) {
              const resolved = resolveRelativeImport(specifier, path);
              if (resolved) {
                const targetName = matchImportToEntity(resolved, knownPaths);
                if (targetName) {
                  relationships.push({ sourceName: path, targetName, relation: "imports" });
                }
              }
            }
          }
        }
      }
    }

    // module.exports = require("./other"); — a re-export of another
    // module's whole surface, not a new entity, but a real dependency link.
    if (
      ts.isExpressionStatement(node) &&
      ts.isBinaryExpression(node.expression) &&
      node.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.expression.left) &&
      ts.isIdentifier(node.expression.left.expression) &&
      node.expression.left.expression.text === "module" &&
      node.expression.left.name.text === "exports" &&
      ts.isCallExpression(node.expression.right) &&
      ts.isIdentifier(node.expression.right.expression) &&
      node.expression.right.expression.text === "require" &&
      node.expression.right.arguments.length === 1 &&
      ts.isStringLiteralLike(node.expression.right.arguments[0])
    ) {
      const specifier = (node.expression.right.arguments[0] as ts.StringLiteralLike).text;
      if (specifier.startsWith(".")) {
        const resolved = resolveRelativeImport(specifier, path);
        if (resolved) {
          const targetName = matchImportToEntity(resolved, knownPaths);
          if (targetName) {
            relationships.push({ sourceName: path, targetName, relation: "imports" });
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return { entities, relationships };
}

// ─── Python extractor ──────────────────────────────────────────────────────
//
// Real structural parsing via a batched `python3` subprocess running the
// interpreter's own `ast` module (see python-extractor.ts) — this is the
// primary path. The regex-based `extractFromPythonRegex` below is kept only
// as a degraded fallback for when the interpreter is unavailable, the
// subprocess fails, or a specific file has a syntax error the batch call
// couldn't otherwise recover from.

/**
 * Returns true when the line at `startIdx` (or within the next 2 non-empty
 * lines) opens a Python docstring. Used to tag regex-fallback entities with
 * `isDocumented` so the knowledge graph can distinguish documented surfaces.
 */
function isPythonDocstringNext(lines: string[], startIdx: number): boolean {
  for (let i = startIdx; i < Math.min(startIdx + 3, lines.length); i++) {
    const trimmed = lines[i].trim();
    if (trimmed === "") continue;
    return trimmed.startsWith('"""') || trimmed.startsWith("'''");
  }
  return false;
}

function extractFromPythonRegex(file: ScannedFile): PartialResult {
  const entities: ExtractedEntity[] = [];
  const relationships: ExtractedRelationship[] = [];
  const { content, path } = file;

  if (!content) return { entities, relationships };

  // Tag the file entity so consumers know this result came from the regex
  // fallback (AST subprocess was unavailable or this file had a syntax error).
  // Item 7: explicit extraction-method labelling prevents mixing degraded
  // results with full AST results without a way to tell them apart.
  entities.push({ type: "file", name: path, path, metadata: { language: "python", extractionMethod: "regex-fallback" } });

  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const defMatch = line.match(/^def\s+(\w+)\s*\(/);
    if (defMatch) {
      const isDocumented = isPythonDocstringNext(lines, i + 1);
      entities.push({ type: "function", name: defMatch[1], path, metadata: { extractionMethod: "regex-fallback", isDocumented } });
      continue;
    }
    const classMatch = line.match(/^class\s+(\w+)[\s(:]/);
    if (classMatch) {
      const isDocumented = isPythonDocstringNext(lines, i + 1);
      entities.push({ type: "class", name: classMatch[1], path, metadata: { extractionMethod: "regex-fallback", isDocumented } });
      continue;
    }
    const relImportMatch = line.match(/^from\s+(\.+\S*)\s+import/);
    if (relImportMatch) {
      relationships.push({
        sourceName: path,
        targetName: relImportMatch[1],
        relation: "imports",
        sourceType: "regex-fallback",
        evidence: [{ file: path, kind: "heuristic", snippet: line.trim() }],
      });
    }
  }

  return { entities, relationships };
}

/**
 * Convert one file's raw batch-subprocess result into the common
 * entity/relationship shape, resolving its imports against `knownPaths`.
 */
function toPartialResult(file: ScannedFile, parsed: PythonFileResult, knownPaths: Set<string>): PartialResult {
  // Item 7: tag AST-derived entities so consumers can distinguish them from
  // regex-fallback entities. `extractionMethod: "ast"` means the Python
  // interpreter's own `ast` module parsed this file — the result is structural
  // truth, not a regex approximation.
  const entities: ExtractedEntity[] = [
    { type: "file", name: file.path, path: file.path, metadata: { language: "python", extractionMethod: "ast" } },
  ];
  const relationships: ExtractedRelationship[] = [];

  for (const e of parsed.entities) {
    entities.push({
      type: e.type,
      name: e.name,
      path: file.path,
      metadata: {
        extractionMethod: "ast",
        ...(e.className ? { className: e.className, kind: "method" } : {}),
      },
    });
  }

  for (const imp of parsed.imports) {
    for (const candidate of pythonImportCandidates(imp, file.path)) {
      const targetName = matchPythonImportToEntity(candidate, knownPaths);
      if (targetName) {
        relationships.push({
          sourceName: file.path,
          targetName,
          relation: "imports",
          sourceType: "python-ast",
          evidence: [{ file: file.path, kind: "import-statement" }],
        });
      }
    }
  }

  return { entities, relationships };
}

/**
 * Extract Python entities/relationships for a batch of files via the real
 * AST subprocess, falling back to the regex heuristic (per-file, since a
 * batch failure shouldn't be all-or-nothing when it's really just one
 * unparseable file) whenever the subprocess is unavailable or errors out.
 */
async function extractPythonEntities(pythonFiles: ScannedFile[], knownPaths: Set<string>): Promise<PartialResult[]> {
  let batch: PythonFileResult[];
  try {
    batch = await extractPythonBatch(pythonFiles.map((f) => ({ path: f.path, content: f.content ?? "" })));
  } catch {
    // Interpreter unavailable, subprocess crashed, or output was
    // unparseable — degrade to the regex heuristic for every file rather
    // than losing Python coverage for the whole scan.
    return pythonFiles.map((f) => extractFromPythonRegex(f));
  }

  const byPath = new Map(batch.map((r) => [r.path, r]));
  return pythonFiles.map((file) => {
    const parsed = byPath.get(file.path);
    if (!parsed || parsed.error) {
      // Subprocess ran fine overall, but this specific file had a syntax
      // error (or was missing from its output) — same fallback, just
      // scoped to the one file instead of the whole batch.
      return extractFromPythonRegex(file);
    }
    return toPartialResult(file, parsed, knownPaths);
  });
}

// ─── Main export ─────────────────────────────────────────────────────────────

/**
 * Extract knowledge-graph entities and relationships from a list of scanned files.
 *
 * Python files are parsed via a single batched subprocess (see
 * python-extractor.ts) rather than per-file, so this is async — every
 * caller must `await` it.
 */
export async function extractGraph(files: ScannedFile[]): Promise<GraphExtractionResult> {
  const knownPaths = new Set(files.map((f) => f.path));
  const aliasMap = buildWorkspaceAliasMap(files);

  const allEntities: ExtractedEntity[] = [];
  const allRelationships: ExtractedRelationship[] = [];

  const seenEntities = new Set<string>();
  const seenRelationships = new Set<string>();

  /**
   * Merge a partial extraction result into the global entity/relationship sets,
   * deduplicating by key. This is the SINGLE enrichment point for every graph
   * element — no extractor needs to know about provenance or KG 2.0 fields.
   *
   * Enrichment pass (in order):
   * 1. Deduplicate by key: entity.type::entity.name::entity.path  /  source→target::relation
   * 2. Derive `sourceType` from metadata.extractionMethod when not explicit
   * 3. Score `confidence` from `sourceType`
   * 4. Promote `metadata.isDocumented` to top-level field
   * 5. Classify relationships into typed `relationType` + optional `relationSubtype`
   * 6. Build unified `provenance` (sourceType + method + evidence) for every element
   *    — prefers any provenance already attached at the push site; builds a
   *    minimal but correct fallback when absent.
   */
  function mergeResult(result: PartialResult): void {
    for (const entity of result.entities) {
      const key = `${entity.type}::${entity.name}::${entity.path}`;
      if (!seenEntities.has(key)) {
        seenEntities.add(key);
        const metaMethod = entity.metadata?.extractionMethod as string | undefined;
        const sourceType: string = entity.sourceType ?? (
          metaMethod === "ast" ? "python-ast" :
          metaMethod === "regex-fallback" ? "regex-fallback" :
          "typescript-ast"
        );
        allEntities.push({
          ...entity,
          sourceType,
          confidence: entity.confidence ?? scoreExtractionConfidence(sourceType),
          isDocumented: entity.isDocumented ?? (entity.metadata?.isDocumented as boolean | undefined),
          provenance: entity.provenance ?? buildEntityProvenance(entity, sourceType),
        });
      }
    }
    for (const rel of result.relationships) {
      const key = `${rel.sourceName}→${rel.targetName}::${rel.relation}`;
      if (!seenRelationships.has(key)) {
        seenRelationships.add(key);
        const classified = classifyRelationType(rel.relation);
        const sourceType: string = rel.sourceType ?? "typescript-ast";
        const isHeuristic = rel.isHeuristic ?? (classified.isHeuristic ?? false);
        const relationType = rel.relationType ?? classified.relationType;
        allRelationships.push({
          ...rel,
          relationType,
          relationSubtype: rel.relationSubtype ?? classified.relationSubtype,
          confidence: rel.confidence ?? scoreExtractionConfidence(sourceType),
          isHeuristic,
          isRuntimeObserved: rel.isRuntimeObserved ?? false,
          sourceType,
          provenance: rel.provenance ?? buildRelationshipProvenance(rel, sourceType, isHeuristic, relationType),
        });
      }
    }
  }

  const pythonFiles: ScannedFile[] = [];

  for (const file of files) {
    if (file.oversized || !file.content) {
      mergeResult({
        entities: [
          { type: "file", name: file.path, path: file.path, metadata: { oversized: true, language: file.language } },
        ],
        relationships: [],
      });
      continue;
    }

    if (file.language === "typescript" || file.language === "javascript") {
      mergeResult(extractFromTsJs(file, knownPaths, aliasMap));
    } else if (file.language === "python") {
      // Batched below, once, after this loop finishes collecting them.
      pythonFiles.push(file);
    } else {
      mergeResult({
        entities: [{ type: "file", name: file.path, path: file.path, metadata: { language: file.language } }],
        relationships: [],
      });
    }
  }

  if (pythonFiles.length > 0) {
    const pythonResults = await extractPythonEntities(pythonFiles, knownPaths);
    for (const result of pythonResults) mergeResult(result);
  }

  return { entities: allEntities, relationships: allRelationships };
}
