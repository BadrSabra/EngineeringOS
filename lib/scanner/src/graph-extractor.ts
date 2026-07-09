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

// ─── Regex patterns ───────────────────────────────────────────────────────────

const EXPORT_FUNCTION_RE = /^export\s+(?:async\s+)?function\s+(\w+)/;
const EXPORT_ARROW_RE = /^export\s+const\s+(\w+)\s*=\s*(?:async\s+)?\(/;
const EXPORT_CLASS_RE = /^export\s+(?:default\s+)?class\s+(\w+)/;
const EXPRESS_ROUTE_RE = /(?:router|app)\.(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]/g;
const IMPORT_FROM_RE = /^import\s+(?:.*?\s+from\s+)?['"`]([^'"`]+)['"`]/gm;

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

function matchImportToEntity(
  resolvedBase: string,
  knownPaths: Set<string>,
): string | null {
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

// ─── Per-language extractors ─────────────────────────────────────────────────

function extractFromTsJs(
  file: ScannedFile,
  knownPaths: Set<string>,
): { entities: ExtractedEntity[]; relationships: ExtractedRelationship[] } {
  const entities: ExtractedEntity[] = [];
  const relationships: ExtractedRelationship[] = [];
  const { content, path } = file;

  if (!content) return { entities, relationships };

  entities.push({ type: "file", name: path, path, metadata: { language: file.language } });

  for (const line of content.split("\n")) {
    const fnMatch = line.match(EXPORT_FUNCTION_RE);
    if (fnMatch) entities.push({ type: "function", name: fnMatch[1], path });

    const arrowMatch = line.match(EXPORT_ARROW_RE);
    if (arrowMatch) entities.push({ type: "function", name: arrowMatch[1], path });

    const classMatch = line.match(EXPORT_CLASS_RE);
    if (classMatch) entities.push({ type: "class", name: classMatch[1], path });
  }

  const routeRe = new RegExp(EXPRESS_ROUTE_RE.source, EXPRESS_ROUTE_RE.flags);
  let routeMatch: RegExpExecArray | null;
  while ((routeMatch = routeRe.exec(content)) !== null) {
    const method = routeMatch[1].toUpperCase();
    const routePath = routeMatch[2];
    entities.push({
      type: "api",
      name: `${method} ${routePath}`,
      path,
      metadata: { method, route: routePath, definedIn: path },
    });
  }

  const importRe = new RegExp(IMPORT_FROM_RE.source, IMPORT_FROM_RE.flags);
  let importMatch: RegExpExecArray | null;
  while ((importMatch = importRe.exec(content)) !== null) {
    const specifier = importMatch[1];
    if (!specifier.startsWith(".")) continue;

    const resolved = resolveRelativeImport(specifier, path);
    if (!resolved) continue;

    const targetName = matchImportToEntity(resolved, knownPaths);
    if (targetName) {
      relationships.push({ sourceName: path, targetName, relation: "imports" });
    }
  }

  return { entities, relationships };
}

function extractFromPython(
  file: ScannedFile,
  _knownPaths: Set<string>,
): { entities: ExtractedEntity[]; relationships: ExtractedRelationship[] } {
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

    let result: { entities: ExtractedEntity[]; relationships: ExtractedRelationship[] };

    if (file.language === "typescript" || file.language === "javascript") {
      result = extractFromTsJs(file, knownPaths);
    } else if (file.language === "python") {
      result = extractFromPython(file, knownPaths);
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
