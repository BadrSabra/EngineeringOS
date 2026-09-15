import { promises as fs } from "node:fs";
import path from "node:path";
import * as ts from "typescript";
import { isSensitiveProjectPath, type ToolDefinition } from "./file-tools.js";

const MAX_FILES = 200;
const MAX_RESULTS = 80;
const MAX_FILE_BYTES = 512_000;
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"]);
const SKIP_DIRECTORIES = new Set(["node_modules", ".git", "dist", "build", "coverage", ".next"]);

export const CODE_NAVIGATION_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "symbol_search",
      description:
        "Find bounded TypeScript/JavaScript symbol declarations in the server-approved project scope. " +
        "Use this before AST navigation when you need a definition location.",
      parameters: {
        type: "object",
        properties: {
          symbol: { type: "string", description: "Exact symbol name to find." },
          path: { type: "string", description: "Optional project-relative file or directory scope." },
        },
        required: ["symbol"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "ast_navigation",
      description:
        "Navigate the server-parsed TypeScript/JavaScript AST. Supports definitions, references, imports, and callers. " +
        "Results are bounded and tied to the current operation revision.",
      parameters: {
        type: "object",
        properties: {
          operation: { type: "string", enum: ["definition", "references", "imports", "callers"] },
          symbol: { type: "string", description: "Exact identifier or imported module name." },
          path: { type: "string", description: "Optional project-relative file or directory scope." },
        },
        required: ["operation", "symbol"],
        additionalProperties: false,
      },
    },
  },
];

export const CODE_NAVIGATION_TOOL_NAMES = new Set(
  CODE_NAVIGATION_TOOL_DEFINITIONS.map((tool) => tool.function.name),
);

type NavigationContext = {
  operationId?: string;
  revision?: string;
};

type SourceUnit = {
  relativePath: string;
  sourceFile: ts.SourceFile;
};

type NavigationResult = {
  file: string;
  line: number;
  column: number;
  kind: string;
  text: string;
};

async function resolveScope(rootPath: string, requestedPath?: string): Promise<string | undefined> {
  const root = await fs.realpath(path.resolve(rootPath));
  const relative = (requestedPath ?? ".").replaceAll("\\", "/").replace(/^(\.\/)+/, "");
  if (isSensitiveProjectPath(relative)) return undefined;
  const candidate = path.resolve(root, relative || ".");
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) return undefined;
  let realCandidate: string;
  try {
    realCandidate = await fs.realpath(candidate);
  } catch {
    return undefined;
  }
  if (realCandidate !== root && !realCandidate.startsWith(`${root}${path.sep}`)) return undefined;
  return realCandidate;
}

async function collectSourceFiles(root: string, scope: string): Promise<string[]> {
  const stat = await fs.stat(scope);
  if (stat.isFile()) {
    return SOURCE_EXTENSIONS.has(path.extname(scope).toLowerCase()) ? [scope] : [];
  }
  const files: string[] = [];
  const walk = async (directory: string): Promise<void> => {
    if (files.length >= MAX_FILES) return;
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (files.length >= MAX_FILES) return;
      if (entry.isDirectory() && !SKIP_DIRECTORIES.has(entry.name)) {
        await walk(path.join(directory, entry.name));
      } else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        files.push(path.join(directory, entry.name));
      }
    }
  };
  await walk(scope);
  return files.map((file) => path.relative(root, file).replaceAll(path.sep, "/"));
}

async function parseSources(root: string, requestedPath?: string): Promise<SourceUnit[]> {
  const scope = await resolveScope(root, requestedPath);
  if (!scope) return [];
  const relativeFiles = await collectSourceFiles(root, scope);
  const units: SourceUnit[] = [];
  for (const relativePath of relativeFiles) {
    try {
      const absolutePath = path.join(root, relativePath);
      const stat = await fs.stat(absolutePath);
      if (stat.size > MAX_FILE_BYTES) continue;
      const text = await fs.readFile(absolutePath, "utf8");
      const extension = path.extname(relativePath).toLowerCase();
      const scriptKind = extension === ".tsx"
        ? ts.ScriptKind.TSX
        : extension === ".jsx"
          ? ts.ScriptKind.JSX
          : extension === ".js" || extension === ".mjs" || extension === ".cjs"
            ? ts.ScriptKind.JS
            : ts.ScriptKind.TS;
      units.push({
        relativePath,
        sourceFile: ts.createSourceFile(relativePath, text, ts.ScriptTarget.Latest, true, scriptKind),
      });
    } catch {
      // A disappearing or unreadable file is not accepted as navigation evidence.
    }
  }
  return units;
}

function location(sourceFile: ts.SourceFile, node: ts.Node, kind: string): NavigationResult {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return {
    file: sourceFile.fileName,
    line: position.line + 1,
    column: position.character + 1,
    kind,
    text: node.getText(sourceFile).slice(0, 240),
  };
}

function isDeclarationName(node: ts.Node): boolean {
  const parent = node.parent;
  return (
    (ts.isFunctionDeclaration(parent) && parent.name === node)
    || (ts.isClassDeclaration(parent) && parent.name === node)
    || (ts.isInterfaceDeclaration(parent) && parent.name === node)
    || (ts.isTypeAliasDeclaration(parent) && parent.name === node)
    || (ts.isEnumDeclaration(parent) && parent.name === node)
    || (ts.isVariableDeclaration(parent) && parent.name === node)
    || (ts.isMethodDeclaration(parent) && parent.name === node)
    || (ts.isPropertyDeclaration(parent) && parent.name === node)
    || (ts.isParameter(parent) && parent.name === node)
    || (ts.isImportClause(parent) && parent.name === node)
    || (ts.isImportSpecifier(parent) && (parent.name === node || parent.propertyName === node))
  );
}

function collectResults(
  unit: SourceUnit,
  operation: "definition" | "references" | "imports" | "callers",
  symbol: string,
): NavigationResult[] {
  const results: NavigationResult[] = [];
  const visit = (node: ts.Node): void => {
    if (results.length >= MAX_RESULTS) return;
    if (operation === "imports" && ts.isImportDeclaration(node)) {
      const moduleName = node.moduleSpecifier.getText(unit.sourceFile).replace(/^['"]|['"]$/g, "");
      if (moduleName === symbol || moduleName.endsWith(`/${symbol}`)) {
        results.push(location(unit.sourceFile, node, "import"));
      }
    } else if (ts.isIdentifier(node) && node.text === symbol) {
      if (operation === "definition" && isDeclarationName(node)) {
        results.push(location(unit.sourceFile, node, "definition"));
      } else if (operation === "references" && !isDeclarationName(node)) {
        results.push(location(unit.sourceFile, node, "reference"));
      } else if (
        operation === "callers"
        && node.parent
        && ts.isCallExpression(node.parent)
        && node.parent.expression === node
      ) {
        results.push(location(unit.sourceFile, node.parent, "caller"));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(unit.sourceFile);
  return results;
}

export async function executeCodeNavigationTool(
  name: string,
  args: Record<string, string>,
  rootPath: string,
  context?: NavigationContext,
): Promise<string> {
  if (!CODE_NAVIGATION_TOOL_NAMES.has(name)) {
    return JSON.stringify({ tool: name, status: "failed", code: "UNKNOWN_CODE_NAVIGATION_TOOL" });
  }
  if (!context?.operationId || !context.revision) {
    return JSON.stringify({
      tool: name,
      status: "unavailable",
      code: "NAVIGATION_REVISION_CONTEXT_REQUIRED",
      detail: "Code navigation requires a server-owned operation and workspace revision.",
    });
  }
  const symbol = args.symbol?.trim();
  if (!symbol || !/^[\w$.-]+$/.test(symbol)) {
    return JSON.stringify({
      tool: name,
      status: "unavailable",
      code: "NAVIGATION_SYMBOL_INVALID",
      detail: "Code navigation requires one exact identifier or module name.",
    });
  }
  const operation = name === "symbol_search" ? "definition" : args.operation;
  if (!["definition", "references", "imports", "callers"].includes(operation)) {
    return JSON.stringify({
      tool: name,
      status: "unavailable",
      code: "NAVIGATION_OPERATION_INVALID",
      detail: "Unsupported AST navigation operation.",
    });
  }
  try {
    const root = await fs.realpath(path.resolve(rootPath));
    const units = await parseSources(root, args.path);
    const results = units.flatMap((unit) => collectResults(
      unit,
      operation as "definition" | "references" | "imports" | "callers",
      symbol,
    )).slice(0, MAX_RESULTS);
    return JSON.stringify({
      tool: name,
      status: "complete",
      operation,
      symbol,
      operationId: context.operationId,
      workspaceRevision: context.revision,
      filesScanned: units.length,
      results,
    });
  } catch {
    return JSON.stringify({
      tool: name,
      status: "unavailable",
      code: "NAVIGATION_SCOPE_UNAVAILABLE",
      detail: "The approved source scope was unavailable for AST navigation.",
      operationId: context.operationId,
      workspaceRevision: context.revision,
    });
  }
}