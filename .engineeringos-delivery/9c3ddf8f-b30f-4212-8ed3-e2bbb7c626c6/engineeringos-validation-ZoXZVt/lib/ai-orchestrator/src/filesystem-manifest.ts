import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";

const MAX_FILES = 240;
const MAX_DIRECTORIES = 120;
const MAX_DEPTH = 5;
const MAX_SOURCE_FILES = 24;
const MAX_SOURCE_FILE_CHARS = 7_000;
const MAX_SOURCE_TOTAL_CHARS = 42_000;

const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".cache",
  ".turbo",
  ".vite",
  "node_modules",
  "dist",
  "build",
  "coverage",
  "benchmark-results",
]);

export const ProjectFileManifestSchema = z.object({
  status: z.enum(["VERIFIED", "UNAVAILABLE"]),
  files: z.array(z.string().min(1)),
  directories: z.array(z.string().min(1)),
  packageManifests: z.array(z.string().min(1)),
  configFiles: z.array(z.string().min(1)),
  truncated: z.boolean(),
  reason: z.string().optional(),
}).strict();

export type ProjectFileManifest = z.infer<typeof ProjectFileManifestSchema>;

export const ProjectFileSourceSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
  truncated: z.boolean(),
}).strict();

export const ProjectFileSourcesSchema = z.object({
  status: z.enum(["VERIFIED", "UNAVAILABLE"]),
  files: z.array(ProjectFileSourceSchema).max(MAX_SOURCE_FILES),
  truncated: z.boolean(),
  reason: z.string().optional(),
}).strict();

export type ProjectFileSource = z.infer<typeof ProjectFileSourceSchema>;
export type ProjectFileSources = z.infer<typeof ProjectFileSourcesSchema>;

function normalizeRelativePath(value: string): string {
  const normalized = value.split(path.sep).join("/");
  return normalized.replace(/^\.\//, "").replace(/\/+$/, "");
}

function isConfigFile(relativePath: string): boolean {
  const name = path.posix.basename(relativePath);
  return (
    name === "pnpm-workspace.yaml" ||
    name === "package.json" ||
    name === "tsconfig.json" ||
    name.startsWith("tsconfig.") ||
    name.startsWith("vite.config.") ||
    name.startsWith("drizzle.config.") ||
    name === "artifact.toml" ||
    name === ".replit"
  );
}

function unavailableManifest(reason: string): ProjectFileManifest {
  return {
    status: "UNAVAILABLE",
    files: [],
    directories: [],
    packageManifests: [],
    configFiles: [],
    truncated: false,
    reason,
  };
}

/**
 * Builds a bounded, read-only inventory of a validated project root.
 *
 * This intentionally returns paths only; it does not read source contents or
 * execute project commands. Symlinks are skipped so the inventory cannot
 * silently include paths outside the resolved project root.
 */
export async function buildProjectFileManifest(rootPath?: string): Promise<ProjectFileManifest> {
  if (!rootPath) return unavailableManifest("project filesystem root is unavailable");

  try {
    const root = await fs.realpath(rootPath);
    const rootStat = await fs.stat(root);
    if (!rootStat.isDirectory()) return unavailableManifest("project filesystem root is not a directory");

    const files: string[] = [];
    const directories: string[] = [];
    let truncated = false;

    async function walk(absoluteDirectory: string, relativeDirectory: string, depth: number): Promise<void> {
      if (depth > MAX_DEPTH || truncated) return;

      const entries = await fs.readdir(absoluteDirectory, { withFileTypes: true });
      entries.sort((a, b) => a.name.localeCompare(b.name));

      for (const entry of entries) {
        if (truncated) return;
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;

        const relativePath = normalizeRelativePath(
          relativeDirectory ? path.posix.join(relativeDirectory, entry.name) : entry.name,
        );

        if (entry.isDirectory()) {
          if (directories.length >= MAX_DIRECTORIES) {
            truncated = true;
            return;
          }
          directories.push(relativePath);
          await walk(path.join(absoluteDirectory, entry.name), relativePath, depth + 1);
          continue;
        }

        if (!entry.isFile()) continue;
        if (files.length >= MAX_FILES) {
          truncated = true;
          return;
        }
        files.push(relativePath);
      }
    }

    await walk(root, "", 0);

    const packageManifests = files.filter((file) => path.posix.basename(file) === "package.json");
    const configFiles = files.filter(isConfigFile);
    return ProjectFileManifestSchema.parse({
      status: "VERIFIED",
      files,
      directories,
      packageManifests,
      configFiles,
      truncated,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 240) : "filesystem manifest read failed";
    return unavailableManifest(reason);
  }
}

const SOURCE_EXTENSIONS = new Set([
  ".css",
  ".html",
  ".jsx",
  ".js",
  ".scss",
  ".svelte",
  ".tsx",
  ".ts",
  ".vue",
]);

function sourceCandidateScore(file: string, focus: string): number {
  const normalized = file.toLowerCase();
  const basename = path.posix.basename(normalized);
  let score = 0;

  if (normalized.includes("dashboard") || normalized.includes("frontend") || normalized.includes("web")) score += 8;
  if (normalized.includes("/src/") || normalized.startsWith("src/")) score += 6;
  if (/(component|page|layout|view|hook|route|style|css)/.test(normalized)) score += 4;
  if (basename.includes("app") || basename.includes("index")) score += 2;
  if (/(test|spec|fixture|generated|mock)/.test(normalized)) score -= 5;

  const focusTokens = focus
    .toLowerCase()
    .split(/[^\p{L}\p{N}_-]+/u)
    .filter((token) => token.length >= 3)
    .slice(0, 24);
  for (const token of focusTokens) {
    if (normalized.includes(token)) score += 10;
  }

  return score;
}

/**
 * Reads a bounded, ranked set of source excerpts for implementation planning.
 * Unlike the manifest, this is actual source evidence and is never persisted
 * as chat output or used to authorize writes.
 */
export async function buildProjectFileSources(
  rootPath: string | undefined,
  manifest: ProjectFileManifest | undefined,
  focus = "",
): Promise<ProjectFileSources> {
  if (!rootPath || !manifest || manifest.status !== "VERIFIED") {
    return {
      status: "UNAVAILABLE",
      files: [],
      truncated: false,
      reason: manifest?.reason ?? "no verified filesystem manifest was supplied",
    };
  }

  try {
    const root = await fs.realpath(rootPath);
    const candidates = manifest.files
      .filter((file) => SOURCE_EXTENSIONS.has(path.posix.extname(file).toLowerCase()))
      .sort((a, b) => sourceCandidateScore(b, focus) - sourceCandidateScore(a, focus) || a.localeCompare(b))
      .slice(0, MAX_SOURCE_FILES);

    const files: ProjectFileSource[] = [];
    let totalChars = 0;
    let truncated = manifest.truncated;

    for (const relativePath of candidates) {
      if (totalChars >= MAX_SOURCE_TOTAL_CHARS) {
        truncated = true;
        break;
      }

      const absolutePath = path.resolve(root, relativePath);
      if (!absolutePath.startsWith(`${root}${path.sep}`)) continue;

      const content = await fs.readFile(absolutePath, "utf8");
      const remaining = MAX_SOURCE_TOTAL_CHARS - totalChars;
      const limit = Math.min(MAX_SOURCE_FILE_CHARS, remaining);
      const excerpt = content.slice(0, limit);
      const fileTruncated = excerpt.length < content.length;
      files.push({ path: relativePath, content: excerpt, truncated: fileTruncated });
      totalChars += excerpt.length;
      if (fileTruncated) truncated = true;
    }

    return ProjectFileSourcesSchema.parse({ status: "VERIFIED", files, truncated });
  } catch (error) {
    return {
      status: "UNAVAILABLE",
      files: [],
      truncated: false,
      reason: error instanceof Error ? error.message.slice(0, 240) : "source read failed",
    };
  }
}

export function formatProjectFileManifest(manifest?: ProjectFileManifest): string {
  if (!manifest || manifest.status !== "VERIFIED") {
    return [
      "STATUS: UNAVAILABLE",
      `REASON: ${manifest?.reason ?? "no verified filesystem manifest was supplied"}`,
      "RULE: Do not name existing project files. Use an inspect step with files: [] and state that file discovery is required.",
    ].join("\n");
  }

  const lines = [
    "STATUS: VERIFIED",
    "RULE: Every inspect/modify/delete/test/configure path must match an entry below exactly.",
    "RULE: A create path is allowed only when its parent directory is listed below.",
    `TRUNCATED: ${manifest.truncated ? "yes — this is a partial inventory" : "no"}`,
    "",
    "DIRECTORIES:",
    ...(manifest.directories.length > 0 ? manifest.directories.map((directory) => `- ${directory}/`) : ["- (none)"]),
    "",
    "FILES:",
    ...(manifest.files.length > 0 ? manifest.files.map((file) => `- ${file}`) : ["- (none)"]),
    "",
    "PACKAGE / CONFIG FILES:",
    ...(manifest.configFiles.length > 0 ? manifest.configFiles.map((file) => `- ${file}`) : ["- (none)"]),
  ];
  return lines.join("\n");
}

export function formatProjectFileSources(sources?: ProjectFileSources): string {
  if (!sources || sources.status !== "VERIFIED" || sources.files.length === 0) {
    return [
      "STATUS: UNAVAILABLE",
      `REASON: ${sources?.reason ?? "no verified source excerpts were supplied"}`,
      "RULE: Do not claim file-level behavior. Discovery is required before approving a plan.",
    ].join("\n");
  }

  return [
    "STATUS: VERIFIED",
    `TRUNCATED: ${sources.truncated ? "yes — excerpts are bounded" : "no"}`,
    "",
    ...sources.files.flatMap((file) => [
      `FILE: ${file.path}${file.truncated ? " [excerpt truncated]" : ""}`,
      "```source",
      file.content,
      "```",
      "",
    ]),
  ].join("\n");
}