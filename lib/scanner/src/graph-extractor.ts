import ts from "typescript";
import type { ScannedFile } from "./file-walker.js";

export type EntityType =
  | "file"
  | "function"
  | "class"
  | "api"
  | "task"
  | "rule"
  | "phase"
  | "module";

export interface ExtractedEntity {
  type: EntityType;
  name: string;
  /** Relative file path. */
  path: string;
  metadata?: Record<string, unknown>;
}

export interface ExtractedRelationship {
  sourceName: string;
  targetName: string;
  /** e.g. "imports", "extends", "implements", "calls" */
  relation: string;
}

export interface GraphExtractionResult {
  entities: ExtractedEntity[];
  relationships: ExtractedRelationship[];
}

type PartialResult = { entities: ExtractedEntity[]; relationships: ExtractedRelationship[] };

// ─── Path utilities ───────────────────────────────────────────────────────────

function resolveRelativeImport(importSpecifier: string, fromFilePath: string): string | null {
  if (!importSpecifier.startsWith(".")) return null;

  const lastSlash = fromFilePath.lastIndexOf("/");
  const fromDir = lastSlash >= 0 ? fromFilePath.slice(0, lastSlash) : "";

  const raw = (fromDir ? fromDir + "/" : "") + importSpecifier;
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

// ─── AST-based TS/JS extractor ────────────────────────────────────────────────

const EXPRESS_METHODS = new Set(["get", "post", "put", "patch", "delete", "all"]);

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
 * Parse a TS/JS file into a real AST via the TypeScript compiler API and walk
 * it to find exported functions/classes, Express-style route registrations,
 * and import specifiers. This replaces the previous line-by-line regex
 * approach, so it correctly handles multi-line declarations, default exports,
 * `export default class Foo`, and arrow functions assigned via destructuring
 * or multi-declarator `const` statements — none of which the regex version
 * could see.
 */
function extractFromTsJs(file: ScannedFile, knownPaths: Set<string>): PartialResult {
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

  const visit = (node: ts.Node): void => {
    // export function foo() {}  /  export default function foo() {}
    if (ts.isFunctionDeclaration(node) && node.name && isExported(node)) {
      entities.push({ type: "function", name: node.name.text, path });
    }

    // export class Foo {}  /  export default class Foo {}
    if (ts.isClassDeclaration(node) && node.name && isExported(node)) {
      entities.push({ type: "class", name: node.name.text, path });
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
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return { entities, relationships };
}

// ─── Python extractor (regex-based; no AST parser available without a new
// heavy dependency, so this heuristic path is intentionally kept) ───────────

function extractFromPython(file: ScannedFile): PartialResult {
  const entities: ExtractedEntity[] = [];
  const relationships: ExtractedRelationship[] = [];
  const { content, path } = file;

  if (!content) return { entities, relationships };

  entities.push({ type: "file", name: path, path, metadata: { language: "python" } });

  for (const line of content.split("\n")) {
    const defMatch = line.match(/^def\s+(\w+)\s*\(/);
    if (defMatch) {
      entities.push({ type: "function", name: defMatch[1], path });
      continue;
    }
    const classMatch = line.match(/^class\s+(\w+)[\s(:]/);
    if (classMatch) {
      entities.push({ type: "class", name: classMatch[1], path });
      continue;
    }
    const relImportMatch = line.match(/^from\s+(\.+\S*)\s+import/);
    if (relImportMatch) {
      relationships.push({
        sourceName: path,
        targetName: relImportMatch[1],
        relation: "imports",
      });
    }
  }

  return { entities, relationships };
}

// ─── Main export ─────────────────────────────────────────────────────────────

/**
 * Extract knowledge-graph entities and relationships from a list of scanned files.
 */
export function extractGraph(files: ScannedFile[]): GraphExtractionResult {
  const knownPaths = new Set(files.map((f) => f.path));

  const allEntities: ExtractedEntity[] = [];
  const allRelationships: ExtractedRelationship[] = [];

  const seenEntities = new Set<string>();
  const seenRelationships = new Set<string>();

  for (const file of files) {
    if (file.oversized || !file.content) {
      const key = `file::${file.path}::${file.path}`;
      if (!seenEntities.has(key)) {
        seenEntities.add(key);
        allEntities.push({
          type: "file",
          name: file.path,
          path: file.path,
          metadata: { oversized: true, language: file.language },
        });
      }
      continue;
    }

    let result: PartialResult;

    if (file.language === "typescript" || file.language === "javascript") {
      result = extractFromTsJs(file, knownPaths);
    } else if (file.language === "python") {
      result = extractFromPython(file);
    } else {
      result = {
        entities: [{ type: "file", name: file.path, path: file.path, metadata: { language: file.language } }],
        relationships: [],
      };
    }

    for (const entity of result.entities) {
      const key = `${entity.type}::${entity.name}::${entity.path}`;
      if (!seenEntities.has(key)) {
        seenEntities.add(key);
        allEntities.push(entity);
      }
    }

    for (const rel of result.relationships) {
      const key = `${rel.sourceName}→${rel.targetName}::${rel.relation}`;
      if (!seenRelationships.has(key)) {
        seenRelationships.add(key);
        allRelationships.push(rel);
      }
    }
  }

  return { entities: allEntities, relationships: allRelationships };
}
