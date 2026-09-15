import { promises as fs } from "node:fs";
import path from "node:path";
import { isSensitiveProjectPath, type ToolDefinition } from "./file-tools.js";

const MAX_MANIFEST_BYTES = 512_000;
const ALLOWED_MANIFESTS = new Set(["package.json", "pnpm-workspace.yaml", "pnpm-lock.yaml", "yarn.lock", "package-lock.json"]);

export const PACKAGE_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "inspect_dependencies",
      description:
        "Inspect project dependency manifests and lockfiles without installing, updating, or modifying packages. " +
        "Results are bounded and tied to the current operation revision.",
      parameters: {
        type: "object",
        properties: {
          manifest: {
            type: "string",
            description: "Optional manifest name: package.json, pnpm-lock.yaml, yarn.lock, or package-lock.json.",
          },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
];

export const PACKAGE_TOOL_NAMES = new Set(PACKAGE_TOOL_DEFINITIONS.map((tool) => tool.function.name));

type PackageToolContext = {
  operationId?: string;
  revision?: string;
};

async function readProjectFile(root: string, relativePath: string): Promise<string | undefined> {
  if (!ALLOWED_MANIFESTS.has(relativePath) || isSensitiveProjectPath(relativePath)) return undefined;
  const absolutePath = path.resolve(root, relativePath);
  if (absolutePath !== root && !absolutePath.startsWith(`${root}${path.sep}`)) return undefined;
  try {
    const realPath = await fs.realpath(absolutePath);
    if (realPath !== root && !realPath.startsWith(`${root}${path.sep}`)) return undefined;
    const stat = await fs.stat(realPath);
    if (!stat.isFile() || stat.size > MAX_MANIFEST_BYTES) return undefined;
    return await fs.readFile(realPath, "utf8");
  } catch {
    return undefined;
  }
}

function summarizePackageJson(text: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const mapKeys = (value: unknown): string[] =>
      value && typeof value === "object" && !Array.isArray(value)
        ? Object.keys(value as Record<string, unknown>).sort()
        : [];
    return {
      name: typeof parsed.name === "string" ? parsed.name : undefined,
      version: typeof parsed.version === "string" ? parsed.version : undefined,
      packageManager: typeof parsed.packageManager === "string" ? parsed.packageManager : undefined,
      workspaces: Array.isArray(parsed.workspaces) ? parsed.workspaces.slice(0, 100) : undefined,
      scripts: mapKeys(parsed.scripts),
      dependencies: mapKeys(parsed.dependencies),
      devDependencies: mapKeys(parsed.devDependencies),
      peerDependencies: mapKeys(parsed.peerDependencies),
      optionalDependencies: mapKeys(parsed.optionalDependencies),
    };
  } catch {
    return { parseError: "package.json is not valid JSON." };
  }
}

export async function executePackageTool(
  name: string,
  args: Record<string, string>,
  rootPath: string,
  context?: PackageToolContext,
): Promise<string> {
  if (!PACKAGE_TOOL_NAMES.has(name)) {
    return JSON.stringify({ tool: name, status: "failed", code: "UNKNOWN_PACKAGE_TOOL" });
  }
  if (!context?.operationId || !context.revision) {
    return JSON.stringify({
      tool: name,
      status: "unavailable",
      code: "PACKAGE_REVISION_CONTEXT_REQUIRED",
      detail: "Dependency inspection requires a server-owned operation and workspace revision.",
    });
  }
  const manifest = args.manifest?.trim() || "package.json";
  if (!ALLOWED_MANIFESTS.has(manifest)) {
    return JSON.stringify({
      tool: name,
      status: "unavailable",
      code: "PACKAGE_MANIFEST_NOT_ALLOWED",
      detail: "Only known dependency manifests and lockfiles may be inspected.",
      operationId: context.operationId,
      workspaceRevision: context.revision,
    });
  }
  try {
    const root = await fs.realpath(path.resolve(rootPath));
    const text = await readProjectFile(root, manifest);
    if (text === undefined) {
      return JSON.stringify({
        tool: name,
        status: "unavailable",
        code: "PACKAGE_MANIFEST_UNAVAILABLE",
        detail: "The requested dependency manifest is unavailable or exceeds the safe size limit.",
        manifest,
        operationId: context.operationId,
        workspaceRevision: context.revision,
      });
    }
    const output: Record<string, unknown> = {
      tool: name,
      status: "complete",
      manifest,
      operationId: context.operationId,
      workspaceRevision: context.revision,
      sizeBytes: Buffer.byteLength(text, "utf8"),
    };
    if (manifest === "package.json") {
      output.summary = summarizePackageJson(text);
    } else {
      output.preview = text.slice(0, 32_000);
      output.truncated = text.length > 32_000;
    }
    return JSON.stringify(output);
  } catch {
    return JSON.stringify({
      tool: name,
      status: "unavailable",
      code: "PACKAGE_ROOT_UNAVAILABLE",
      detail: "The approved project root was unavailable for dependency inspection.",
      operationId: context.operationId,
      workspaceRevision: context.revision,
    });
  }
}