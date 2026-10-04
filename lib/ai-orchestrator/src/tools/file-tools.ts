/**
 * File system tools for the chat agent.
 *
 * Activated only when `rootPath` is passed to the chat function, giving the
 * model read and write access to the actual project source files.
 *
 * Security contract:
 *   - rootPath is canonicalized, then reads/listings pin and verify an open
 *     project-root descriptor for each operation.
 *   - safePath is a scope check, not a read capability: actual file and
 *     directory access goes through verified open descriptors before bytes or
 *     entries are exposed.
 *   - Caller-supplied paths are checked lexically and with fs.realpath so
 *     stable symlinks pointing outside the root are rejected early.
 *   - Null bytes are rejected explicitly before any path operation.
 *   - read_file / list_directory / search_code execute immediately.
 *   - write_file / replace_text NEVER write to disk — they queue a PendingChange that the
 *     user must explicitly approve via the dashboard before anything changes.
 *   - search_code walks a bounded project file set, passes capped file bytes to
 *     grep over stdin, and supplies the pattern as a plain argv entry (no shell).
 */
import { constants as fsConstants, promises as fs } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { type PendingChange } from "../schemas/chat.schema.js";
import { buildPatchHunks, hashPatchBase } from "../patch-contract.js";

const MAX_READ_BYTES = 128_000; // ~128 KB per normal file read — keeps previews bounded
const MAX_FORENSIC_READ_BYTES = 512_000;
const MAX_TARGETED_READ_LINES = 4_000; // read_file_range window cap
const MAX_TARGETED_READ_BYTES = 128_000; // safety byte cap on a targeted window
const MAX_TARGETED_READ_SCAN_BYTES = 512_000; // bounds scanning before a late line range
const TARGETED_READ_CHUNK_BYTES = 16_384;
const MAX_TOOL_PATH_BYTES = 4_096;
const MAX_CHANGE_REASON_BYTES = 2_000;
const MAX_FULL_REPLACEMENT_BYTES = 128_000;
const MAX_REPLACE_TEXT_FRAGMENT_BYTES = 128_000;
const MAX_REPLACE_TEXT_SOURCE_BYTES = 2_000_000;
const MAX_SEARCH_PATTERN_BYTES = 1_024;
const MAX_SEARCH_GLOB_BYTES = 512;
const MAX_SEARCH_LINES = 50;
const MAX_SEARCH_DIRECTORY_DEPTH = 6;
const MAX_SEARCH_SCANNED_ENTRIES = 5_000;
const MAX_SEARCH_FILES = 100;
const MAX_SEARCH_FILE_BYTES = 512_000;
const MAX_SEARCH_TOTAL_BYTES = 16_000_000;
const MAX_SEARCH_OUTPUT_BYTES = 24_000;
const MAX_SEARCH_RUNTIME_MS = 10_000;
const MAX_SEARCH_PROCESS_OUTPUT_BYTES = 64_000;
const MAX_DIRECTORY_ENTRIES = 100;
const MAX_DIRECTORY_SCANNED_ENTRIES = 1_000;
const MAX_DIRECTORY_OUTPUT_BYTES = 24_000;
const MAX_PROJECT_TREE_DEPTH = 2;
const MAX_PROJECT_TREE_ENTRIES = 100;
const MAX_PROJECT_TREE_SCANNED_ENTRIES = 5_000;
const MAX_PROJECT_TREE_DIRECTORY_ENTRIES = 1_000;
const MAX_PROJECT_TREE_OUTPUT_BYTES = 24_000;
const READ_TRUNCATION_MARKER =
  "\n\n[... output truncated at 128 KB by the read tool; this is a display limit, not evidence that the file is incomplete or corrupted. Do not infer missing code from this marker. Use targeted search_code or replace_text for exact source-level evidence. ...]";
const FORENSIC_READ_TRUNCATION_MARKER =
  "\n\n[... forensic read exceeded the maximum safe evidence window; complete source evidence is unavailable for this file. ...]";
const DIRECTORY_TRUNCATION_MARKER =
  "\n[... directory listing truncated by entry, scan, or output limit ...]";
const SEARCH_TRUNCATION_MARKER =
  "\n[... search incomplete: a scan, file, byte, time, or output limit was reached ...]";
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", ".next", "__pycache__", ".venv", "build", "coverage"]);
const BLOCKED_SENSITIVE_PATH =
  /(?:^|[/\\])(?:\.env(?:\..*)?|\.npmrc|\.pypirc|\.htpasswd|credentials(?:\.[^/\\]*)?|(?:service[-_.]?account|.*(?:private|secret|token|credential)).*\.(?:json|ya?ml|toml|ini|cfg|conf)|id_(?:rsa|dsa|ecdsa)|.*\.(?:pem|key|p12|pfx|jks|kdbx|gpg|asc))$/i;
const BLOCKED_TREE_SEGMENT =
  /^(?:\.?env(?:\..*)?|secrets?|credentials?(?:\..*)?|private(?:\..*)?|.*(?:secret|token|credential).*)$/i;

export function isSensitiveProjectPath(filePath: string): boolean {
  return BLOCKED_SENSITIVE_PATH.test(filePath);
}

/**
 * Convert filesystem failures into actionable, user-safe tool output.
 *
 * Node's native error text can contain absolute project/runtime paths and is
 * therefore diagnostic-only. The model needs the operational reason, not the
 * host layout.
 */
function formatFilesystemError(
  operation: "read" | "list",
  requestedPath: string,
  error: unknown,
): string {
  const code = error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code ?? "")
    : "";
  const reason =
    code === "ENOENT"
      ? "the file or directory does not exist"
      : code === "EACCES" || code === "EPERM"
        ? "permission was denied"
        : code === "EISDIR"
          ? "the requested path is a directory"
          : code === "ENOTDIR"
            ? "a parent path is not a directory"
            : "the project filesystem rejected the request";
  const action =
    code === "ENOENT"
      ? "Check the project-relative path and retry."
      : code === "EACCES" || code === "EPERM"
        ? "Use a readable project file or directory and retry."
        : "Check the project-relative path and retry.";
  return `Error ${operation === "read" ? "reading" : "listing"} "${requestedPath}": ${reason}. ${action}`;
}

// ── Public types ─────────────────────────────────────────────────────────────

// PendingChange is the canonical type from chat.schema.ts — re-exported here
// so callers that already import from file-tools.ts do not need to change their
// import path. The single schema in chat.schema.ts is the sole source of truth.
export type { PendingChange } from "../schemas/chat.schema.js";

export type ToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

// ── Tool definitions (sent to Groq) ──────────────────────────────────────────

export const FILE_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "read_file",
      description:
        "Read the first 128 KB of a source file. A normal-read truncation marker is a display limit, not proof that the file is incomplete; complete=true reads up to 512 KB, and exceeding that forensic cap means the source evidence is incomplete. Use search_code for targeted evidence and replace_text for focused edits.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            maxLength: MAX_TOOL_PATH_BYTES,
            description:
              "File path relative to the project root (maximum 4 KB).",
          },
            complete: {
              type: "boolean",
              description:
                "For forensic audits only: request a complete read instead of the normal bounded preview. If the file exceeds the safe evidence window, it remains NOT PROVEN.",
            },
            from_file: {
              type: "string",
              description:
                "Dependency-First traversal (after the first source read): the already-read source file that references the symbol you now need to read.",
            },
            from_symbol: {
              type: "string",
              description:
                "The caller / imported symbol / explicit function reference / return consumer IN from_file that requires this dependency read.",
            },
            reference: {
              type: "string",
              description:
                "The exact reference (import statement, call site, or return consumer) in from_file that proves this dependency read is required.",
            },
            why_required: {
              type: "string",
              description:
                "One-sentence justification of why this dependency file must be read now (e.g. to verify how the symbol from from_file is defined/consumed).",
            },
        },
        required: ["path"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file_range",
      description:
        "Read a specific line range of a source file (1-based, inclusive). The requested range is capped at 4,000 lines, the returned window at 128 KB, and scanning at 512 KB. Use this for a targeted window instead of re-reading the whole file.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            maxLength: MAX_TOOL_PATH_BYTES,
            description: "File path relative to the project root (e.g. 'src/index.ts').",
          },
          startLine: {
            type: "integer",
            description: "First line to read (1-based, inclusive).",
          },
          endLine: {
            type: "integer",
            description: "Last line to read (1-based, inclusive).",
          },
          from_file: {
            type: "string",
            description:
              "Dependency-First traversal (after the first source read): the already-read source file that references the symbol whose window you now need.",
          },
          from_symbol: {
            type: "string",
            description:
              "The caller / imported symbol / explicit function reference / return consumer IN from_file that requires this dependency read.",
          },
          reference: {
            type: "string",
            description:
              "The exact reference (import statement, call site, or return consumer) in from_file that proves this dependency read is required.",
          },
          why_required: {
            type: "string",
            description:
              "One-sentence justification of why this dependency file window must be read now.",
          },
        },
        required: ["path", "startLine", "endLine"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "project.list_tree",
      description:
        "List a bounded, metadata-only tree of the server-managed project root. The root is fixed by the server; no path or file-content reads are accepted.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_directory",
      description:
        "List up to 100 entries from a directory. Scanning stops after 1,000 entries and the response is capped at 24 KB; a truncation marker indicates a listing limit.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            maxLength: MAX_TOOL_PATH_BYTES,
            description:
              "Directory path relative to the project root (maximum 4 KB). Use '.' to list the root itself.",
          },
        },
        required: ["path"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_code",
      description:
        "Search with a grep-compatible regular expression through a bounded project file set. Scans at most 5,000 directory entries and 100 files, reads up to 512 KB per file and 16 MB total, and returns at most 50 lines / 24 KB. If any limit is reached, the result is marked incomplete.",
      parameters: {
        type: "object",
        properties: {
          pattern: {
            type: "string",
            maxLength: MAX_SEARCH_PATTERN_BYTES,
            description: "Plain text or basic regex pattern to search for (maximum 1 KB).",
          },
          file_glob: {
            type: "string",
            maxLength: MAX_SEARCH_GLOB_BYTES,
            description:
              "Optional glob to restrict the search to specific file types (maximum 512 bytes).",
          },
          path: {
            type: "string",
            maxLength: MAX_TOOL_PATH_BYTES,
            description:
              "Optional project-relative file or directory to search (maximum 4 KB). Required for evidence-scoped analysis; omit only for ordinary project chat.",
          },
        },
        required: ["pattern"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "replace_text",
      description:
        "Propose a focused text replacement inside an existing text file up to 2 MB. Each old_text and new_text value is limited to 128 KB. The server requires one exact match and queues the complete change for approval.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            maxLength: MAX_TOOL_PATH_BYTES,
            description: "File path relative to the project root (maximum 4 KB).",
          },
          old_text: {
            type: "string",
            maxLength: MAX_REPLACE_TEXT_FRAGMENT_BYTES,
            description: "The exact existing text to replace, including whitespace and line breaks (maximum 128 KB).",
          },
          new_text: {
            type: "string",
            maxLength: MAX_REPLACE_TEXT_FRAGMENT_BYTES,
            description: "The replacement text (maximum 128 KB).",
          },
          reason: {
            type: "string",
            maxLength: MAX_CHANGE_REASON_BYTES,
            description: "One-sentence explanation of why this focused change is needed (maximum 2 KB).",
          },
          validation_profile: {
            type: "string",
            enum: [
              "ai-orchestrator-tests",
              "knowledge-engine-tests",
              "api-ai-tests",
              "api-repair-validation-tests",
            ],
            description:
              "Optional registered behavioral validation profile. Provide a profile only when the Repair Plan names a concrete matching test scenario. Never provide a shell command.",
          },
        },
        required: ["path", "old_text", "new_text", "reason"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description:
        "Propose a complete file write of at most 128 KB. Existing files over 128 KB cannot be replaced this way; use replace_text for text files up to 2 MB. The change is queued for user approval and is not written to disk until approved.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            maxLength: MAX_TOOL_PATH_BYTES,
            description: "File path relative to the project root (maximum 4 KB).",
          },
          content: {
            type: "string",
            maxLength: MAX_FULL_REPLACEMENT_BYTES,
            description: "The complete new file content (not a diff — the full replacement; maximum 128 KB).",
          },
          reason: {
            type: "string",
            maxLength: MAX_CHANGE_REASON_BYTES,
            description: "One-sentence explanation of why this change is needed (maximum 2 KB).",
          },
          validation_profile: {
            type: "string",
            enum: [
              "ai-orchestrator-tests",
              "knowledge-engine-tests",
              "api-ai-tests",
              "api-repair-validation-tests",
            ],
            description:
              "Optional registered behavioral validation profile. Provide a profile only when the Repair Plan names a concrete matching test scenario. Never provide a shell command.",
          },
        },
        required: ["path", "content", "reason"],
        additionalProperties: false,
      },
    },
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Resolve a caller-supplied path and verify it stays inside `resolvedRoot`.
 *
 * Two-phase check:
 *   1. Lexical: path.resolve removes `..` segments — fast rejection of
 *      pure-string traversal attempts.
 *   2. Realpath: fs.realpath follows symlinks on disk — catches symlinks
 *      inside the root that point to paths outside it.
 *
 * For paths that do not yet exist (new files queued by write_file), realpath
 * is applied to the nearest existing ancestor instead.
 *
 * Returns the canonical absolute path on success, null on any violation.
 */
export async function safePath(resolvedRoot: string, filePath: string): Promise<string | null> {
  // Null bytes are passed to OS path APIs as-is, where libc treats them as
  // string terminators. Node's fs layer rejects them, but the error message
  // is confusing. Catch them here with a clear early return.
  if (filePath.includes("\0")) return null;

  // Phase 1 — lexical. Catches all `..`-based traversal without I/O.
  const lexical = path.resolve(resolvedRoot, filePath);
  if (lexical !== resolvedRoot && !lexical.startsWith(resolvedRoot + path.sep)) {
    return null;
  }

  // Phase 2 — realpath. Resolves symlinks so a link inside the root that
  // points outside it does not slip through the lexical check.
  let real: string;
  try {
    real = await fs.realpath(lexical);
  } catch {
    // The path doesn't exist yet (e.g. a new file). Resolve the nearest
    // existing ancestor and re-attach the remaining segments.
    let ancestor = lexical;
    let tail = "";
    for (;;) {
      const parent = path.dirname(ancestor);
      if (parent === ancestor) {
        // Reached the filesystem root without finding an existing ancestor.
        // Fall back to the lexically-verified path — the lexical check above
        // already confirmed it is inside the root.
        real = lexical;
        break;
      }
      tail = tail ? path.join(path.basename(ancestor), tail) : path.basename(ancestor);
      ancestor = parent;
      try {
        const realAncestor = await fs.realpath(ancestor);
        real = path.join(realAncestor, tail);
        break;
      } catch {
        // This ancestor also doesn't exist — go up one more level.
        continue;
      }
    }
  }

  // Phase 2 prefix check on the resolved (real) path.
  if (real !== resolvedRoot && !real.startsWith(resolvedRoot + path.sep)) {
    return null;
  }

  return real;
}

type OpenFileHandle = Awaited<ReturnType<typeof fs.open>>;

function isPathWithinRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === ""
    || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

function procFileDescriptorPath(handle: OpenFileHandle): string {
  return `/proc/${process.pid}/fd/${handle.fd}`;
}

export function projectDirectoryDescriptorPath(handle: OpenFileHandle): string {
  return procFileDescriptorPath(handle);
}

async function openPinnedProjectRoot(rootPath: string): Promise<{
  canonicalPath: string;
  handle: OpenFileHandle;
}> {
  const canonicalPath = await fs.realpath(path.resolve(rootPath));
  const before = await fs.lstat(canonicalPath);
  if (!before.isDirectory() || before.isSymbolicLink()) {
    throw new Error("project_root_not_directory");
  }
  const handle = await fs.open(
    canonicalPath,
    fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW,
  );
  try {
    const opened = await handle.stat();
    const openedPath = await fs.realpath(procFileDescriptorPath(handle));
    if (
      !opened.isDirectory()
      || opened.dev !== before.dev
      || opened.ino !== before.ino
      || openedPath !== canonicalPath
    ) {
      throw new Error("project_root_identity_changed");
    }
    return { canonicalPath, handle };
  } catch (error) {
    await handle.close().catch(() => undefined);
    throw error;
  }
}

/**
 * Open a previously validated project file through a pinned root descriptor,
 * then verify the opened inode's real path before any content is read. This
 * closes the safePath check-then-open window for symlink and parent swaps.
 */
export async function openVerifiedProjectFile(
  rootPath: string,
  absolutePath: string,
  signal?: AbortSignal,
): Promise<OpenFileHandle> {
  assertFileOperationActive(signal);
  const root = await openPinnedProjectRoot(rootPath);
  let fileHandle: OpenFileHandle | undefined;
  try {
    const candidate = path.resolve(absolutePath);
    if (!isPathWithinRoot(root.canonicalPath, candidate)) {
      throw new Error("project_file_path_outside_root");
    }
    const relative = path.relative(root.canonicalPath, candidate);
    const rootDescriptorPath = procFileDescriptorPath(root.handle);
    const anchoredPath = relative ? path.join(rootDescriptorPath, relative) : `${rootDescriptorPath}/.`;
    fileHandle = await fs.open(
      anchoredPath,
      fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
    );
    assertFileOperationActive(signal);
    const openedRootPath = await fs.realpath(procFileDescriptorPath(root.handle));
    const openedFilePath = await fs.realpath(procFileDescriptorPath(fileHandle));
    const stat = await fileHandle.stat();
    if (
      openedRootPath !== root.canonicalPath
      || !isPathWithinRoot(openedRootPath, openedFilePath)
      || !stat.isFile()
    ) {
      throw new Error("project_file_identity_changed");
    }
    return fileHandle;
  } catch (error) {
    await fileHandle?.close().catch(() => undefined);
    throw error;
  } finally {
    await root.handle.close().catch(() => undefined);
  }
}

/** Open and pin a project directory before enumerating any of its entries. */
export async function openVerifiedProjectDirectory(
  rootPath: string,
  absolutePath: string,
  signal?: AbortSignal,
): Promise<OpenFileHandle> {
  assertFileOperationActive(signal);
  const root = await openPinnedProjectRoot(rootPath);
  let directoryHandle: OpenFileHandle | undefined;
  try {
    const candidate = path.resolve(absolutePath);
    if (!isPathWithinRoot(root.canonicalPath, candidate)) {
      throw new Error("project_directory_path_outside_root");
    }
    const relative = path.relative(root.canonicalPath, candidate);
    const rootDescriptorPath = procFileDescriptorPath(root.handle);
    const anchoredPath = relative ? path.join(rootDescriptorPath, relative) : `${rootDescriptorPath}/.`;
    directoryHandle = await fs.open(
      anchoredPath,
      fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW,
    );
    assertFileOperationActive(signal);
    const openedRootPath = await fs.realpath(procFileDescriptorPath(root.handle));
    const openedDirectoryPath = await fs.realpath(procFileDescriptorPath(directoryHandle));
    const stat = await directoryHandle.stat();
    if (
      openedRootPath !== root.canonicalPath
      || !isPathWithinRoot(openedRootPath, openedDirectoryPath)
      || !stat.isDirectory()
    ) {
      throw new Error("project_directory_identity_changed");
    }
    return directoryHandle;
  } catch (error) {
    await directoryHandle?.close().catch(() => undefined);
    throw error;
  } finally {
    await root.handle.close().catch(() => undefined);
  }
}

/**
 * Strip the `File: <path>\n```\n<content>\n```\n` wrapper that executeFileTool
 * prepends to a read_file result, leaving only the raw file body.
 *
 * The forensic evidence map stores RAW bodies so that `computeSourceSpan` line
 * numbers match the actual source file the analyst sees, in every read path.
 * Recognition requires the FULL wrapper shape: an opening `File: <path>` line,
 * an opening ``` fence, and a terminal closing ``` fence. A body missing the
 * closing fence is NOT the read_file wrapper and is returned byte-for-byte
 * unchanged, so raw-only paths (single-file pre-read) and genuine source that
 * merely starts with a "File:" token are never mangled.
 */
type ProjectTreeEntry = {
  path: string;
  kind: "directory" | "file";
  sizeBytes?: number;
};

function isSensitiveTreePath(relativePath: string): boolean {
  return isSensitiveProjectPath(relativePath)
    || relativePath.split("/").some((segment) => BLOCKED_TREE_SEGMENT.test(segment));
}

async function listManagedProjectTree(rootPath: string, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  const absoluteRoot = path.resolve(rootPath);
  const rootStat = await fs.lstat(absoluteRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error("project_tree_root_not_directory");
  }
  const canonicalRoot = await fs.realpath(absoluteRoot);
  if (canonicalRoot !== absoluteRoot) {
    throw new Error("project_tree_root_not_canonical");
  }

  const entries: ProjectTreeEntry[] = [];
  let scannedEntries = 0;
  let truncated = false;

  const walk = async (relativeDirectory: string, depth: number): Promise<void> => {
    signal?.throwIfAborted();
    const absoluteDirectory = relativeDirectory
      ? path.join(canonicalRoot, ...relativeDirectory.split("/"))
      : canonicalRoot;
    const directoryHandle = await openVerifiedProjectDirectory(
      canonicalRoot,
      absoluteDirectory,
      signal,
    );
    const children: Array<{ name: string; kind: "directory" | "file" }> = [];
    try {
      const directory = await fs.opendir(procFileDescriptorPath(directoryHandle));
      try {
        for await (const item of directory) {
          signal?.throwIfAborted();
          scannedEntries += 1;
          if (
            scannedEntries > MAX_PROJECT_TREE_SCANNED_ENTRIES
            || children.length >= MAX_PROJECT_TREE_DIRECTORY_ENTRIES
          ) {
            throw new Error("project_tree_scan_limit_exceeded");
          }
          if (item.isSymbolicLink() || (!item.isDirectory() && !item.isFile())) continue;
          if (item.isDirectory() && SKIP_DIRS.has(item.name)) continue;
          const childPath = relativeDirectory ? `${relativeDirectory}/${item.name}` : item.name;
          if (isSensitiveTreePath(childPath)) continue;
          children.push({ name: item.name, kind: item.isDirectory() ? "directory" : "file" });
        }
      } finally {
        await directory.close().catch(() => undefined);
      }
    } finally {
      await directoryHandle.close().catch(() => undefined);
    }

    children.sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1
        : left.kind === right.kind ? 0 : left.kind === "directory" ? -1 : 1,
    );

    for (const child of children) {
      signal?.throwIfAborted();
      if (entries.length >= MAX_PROJECT_TREE_ENTRIES) {
        truncated = true;
        return;
      }
      const childRelativePath = relativeDirectory
        ? `${relativeDirectory}/${child.name}`
        : child.name;
      const childAbsolutePath = path.join(canonicalRoot, ...childRelativePath.split("/"));
      if (child.kind === "directory") {
        let childDirectory: OpenFileHandle;
        try {
          childDirectory = await openVerifiedProjectDirectory(
            canonicalRoot,
            childAbsolutePath,
            signal,
          );
        } catch {
          continue;
        }
        const childStat = await childDirectory.stat();
        await childDirectory.close().catch(() => undefined);
        if (!childStat.isDirectory()) continue;
        entries.push({ path: childRelativePath, kind: "directory" });
        if (depth + 1 < MAX_PROJECT_TREE_DEPTH) {
          await walk(childRelativePath, depth + 1);
          if (entries.length >= MAX_PROJECT_TREE_ENTRIES) {
            truncated ||= children.at(-1) !== child;
            return;
          }
        }
      } else {
        let childFile: OpenFileHandle;
        try {
          childFile = await openVerifiedProjectFile(
            canonicalRoot,
            childAbsolutePath,
            signal,
          );
        } catch {
          continue;
        }
        const childStat = await childFile.stat();
        await childFile.close().catch(() => undefined);
        if (!childStat.isFile()) continue;
        entries.push({
          path: childRelativePath,
          kind: "file",
          sizeBytes: childStat.size,
        });
      }
    }
  };

  await walk("", 0);
  signal?.throwIfAborted();
  const result = {
    kind: "project_tree",
    root: ".",
    maxDepth: MAX_PROJECT_TREE_DEPTH,
    maxEntries: MAX_PROJECT_TREE_ENTRIES,
    truncated,
    entries,
  };
  let output = JSON.stringify(result);
  while (
    Buffer.byteLength(output, "utf8") > MAX_PROJECT_TREE_OUTPUT_BYTES
    && result.entries.length > 0
  ) {
    result.entries.pop();
    result.truncated = true;
    output = JSON.stringify(result);
  }
  if (Buffer.byteLength(output, "utf8") > MAX_PROJECT_TREE_OUTPUT_BYTES) {
    throw new Error("project_tree_output_limit_exceeded");
  }
  return output;
}

export function stripReadFileWrapper(body: string): string {
  const lines = body.split("\n");
  if (
    lines.length < 4 ||
    !/^File: [^\n]*$/.test(lines[0] ?? "") ||
    lines[1]?.trim() !== "```" ||
    // The content must terminate with a closing fence on its own line.
    !/^```[ \t]*$/.test(lines[lines.length - 1] ?? "")
  ) {
    return body;
  }
  // Drop the opening header (File: line + ``` fence) and the closing fence line,
  // re-joining the raw file body verbatim (including any internal newlines).
  return lines.slice(2, -1).join("\n");
}

// ── Tool handler ──────────────────────────────────────────────────────────────

function assertFileOperationActive(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error("File operation cancelled.");
  }
}

function inputByteLimitError(field: string, value: string, maxBytes: number): string | null {
  return Buffer.byteLength(value, "utf-8") > maxBytes
    ? `Error: "${field}" exceeds the ${maxBytes}-byte tool input limit.`
    : null;
}

const ALLOWED_VALIDATION_PROFILES = new Set([
  "ai-orchestrator-tests",
  "knowledge-engine-tests",
  "api-ai-tests",
  "api-repair-validation-tests",
]);

function validateChangeMetadata(args: Record<string, string>): string | null {
  const pathError = inputByteLimitError("path", args.path ?? "", MAX_TOOL_PATH_BYTES);
  if (pathError) return pathError;
  const reasonError = inputByteLimitError("reason", args.reason ?? "", MAX_CHANGE_REASON_BYTES);
  if (reasonError) return reasonError;
  if (
    args.validation_profile
    && !ALLOWED_VALIDATION_PROFILES.has(args.validation_profile)
  ) {
    return 'Error: "validation_profile" must be one of the registered validation profiles.';
  }
  return null;
}

async function readBoundedFilePrefix(
  filePath: string,
  maxBytes: number,
  signal?: AbortSignal,
  rootPath?: string,
): Promise<{ bytes: Buffer; truncated: boolean; bytesRead: number }> {
  const handle = rootPath
    ? await openVerifiedProjectFile(rootPath, filePath, signal)
    : await fs.open(filePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    assertFileOperationActive(signal);
    const buffer = Buffer.allocUnsafe(maxBytes + 1);
    let totalBytesRead = 0;
    while (totalBytesRead < buffer.length) {
      assertFileOperationActive(signal);
      const { bytesRead } = await handle.read(
        buffer,
        totalBytesRead,
        buffer.length - totalBytesRead,
        totalBytesRead,
      );
      assertFileOperationActive(signal);
      if (bytesRead === 0) break;
      totalBytesRead += bytesRead;
    }
    return {
      bytes: buffer.subarray(0, Math.min(totalBytesRead, maxBytes)),
      truncated: totalBytesRead > maxBytes,
      bytesRead: totalBytesRead,
    };
  } finally {
    await handle.close().catch(() => undefined);
  }
}

type SearchCandidate = {
  absolutePath: string;
  relativePath: string;
};

function projectRelativePath(rootPath: string, absolutePath: string): string | null {
  const relativePath = path.relative(rootPath, absolutePath);
  if (
    path.isAbsolute(relativePath)
    || relativePath === ".."
    || relativePath.startsWith(`..${path.sep}`)
  ) {
    return null;
  }
  return relativePath.split(path.sep).join("/");
}

function matchesSearchGlob(relativePath: string, fileGlob?: string): boolean {
  if (!fileGlob) return true;
  const normalizedGlob = fileGlob.replace(/\\/g, "/");
  const candidate = normalizedGlob.includes("/")
    ? relativePath
    : path.posix.basename(relativePath);
  let source = "^";

  for (let index = 0; index < normalizedGlob.length; index += 1) {
    const character = normalizedGlob[index]!;
    if (character === "*") {
      source += ".*";
    } else if (character === "?") {
      source += ".";
    } else if (character === "[") {
      const closingIndex = normalizedGlob.indexOf("]", index + 1);
      if (closingIndex <= index + 1) {
        source += "\\[";
        continue;
      }
      let characterClass = normalizedGlob.slice(index + 1, closingIndex);
      const negated = characterClass.startsWith("!");
      if (negated) characterClass = characterClass.slice(1);
      characterClass = characterClass
        .replace(/\\/g, "\\\\")
        .replace(/\]/g, "\\]")
        .replace(/\^/g, "\\^");
      source += `[${negated ? "^" : ""}${characterClass}]`;
      index = closingIndex;
    } else {
      source += /[\\^$+?.()|{}]/.test(character) ? `\\${character}` : character;
    }
  }
  source += "$";
  return new RegExp(source).test(candidate);
}

async function collectBoundedSearchFiles(
  rootPath: string,
  searchPath: string,
  fileGlob: string | undefined,
  deadline: number,
  signal?: AbortSignal,
): Promise<{ files: SearchCandidate[]; truncated: boolean }> {
  const files: SearchCandidate[] = [];
  let scannedEntries = 0;
  let truncated = false;

  const addFile = async (absolutePath: string, relativePath: string): Promise<void> => {
    if (files.length >= MAX_SEARCH_FILES) {
      truncated = true;
      return;
    }
    if (isSensitiveTreePath(relativePath) || !matchesSearchGlob(relativePath, fileGlob)) {
      return;
    }
    try {
      const lexicalStat = await fs.lstat(absolutePath);
      if (lexicalStat.isSymbolicLink() || !lexicalStat.isFile()) return;
      const resolvedPath = await safePath(rootPath, relativePath);
      if (!resolvedPath) {
        truncated = true;
        return;
      }
      const resolvedRelativePath = projectRelativePath(rootPath, resolvedPath);
      if (
        resolvedRelativePath === null
        || isSensitiveTreePath(resolvedRelativePath)
        || !matchesSearchGlob(resolvedRelativePath, fileGlob)
      ) {
        return;
      }
      const resolvedStat = await fs.lstat(resolvedPath);
      if (resolvedStat.isSymbolicLink() || !resolvedStat.isFile()) {
        truncated = true;
        return;
      }
      files.push({ absolutePath: resolvedPath, relativePath: resolvedRelativePath });
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code ?? "")
        : "";
      if (code === "ENOENT" || code === "ESTALE") {
        truncated = true;
        return;
      }
      throw error;
    }
  };

  const initialStat = await fs.lstat(searchPath);
  const initialRelativePath = projectRelativePath(rootPath, searchPath);
  if (initialRelativePath === null) {
    return { files, truncated: true };
  }
  if (initialStat.isSymbolicLink()) {
    return { files, truncated: true };
  }
  if (initialStat.isFile()) {
    await addFile(searchPath, initialRelativePath);
    return { files, truncated };
  }
  if (!initialStat.isDirectory()) return { files, truncated };

  const pendingDirectories: Array<{
    absolutePath: string;
    relativePath: string;
    depth: number;
  }> = [{
    absolutePath: searchPath,
    relativePath: initialRelativePath,
    depth: 0,
  }];

  while (pendingDirectories.length > 0) {
    assertFileOperationActive(signal);
    if (Date.now() >= deadline) {
      truncated = true;
      break;
    }
    if (files.length >= MAX_SEARCH_FILES) {
      truncated = true;
      break;
    }
    const current = pendingDirectories.pop()!;
    const directoryStat = await fs.lstat(current.absolutePath);
    if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
      truncated = true;
      continue;
    }
    const realDirectoryPath = await fs.realpath(current.absolutePath);
    if (
      realDirectoryPath !== current.absolutePath
      || projectRelativePath(rootPath, realDirectoryPath) === null
    ) {
      truncated = true;
      continue;
    }

    const directoryHandle = await openVerifiedProjectDirectory(
      rootPath,
      realDirectoryPath,
      signal,
    );
    const children: Array<{
      absolutePath: string;
      relativePath: string;
      name: string;
      kind: "directory" | "file";
    }> = [];
    try {
      const directory = await fs.opendir(procFileDescriptorPath(directoryHandle));
      try {
        for await (const entry of directory) {
          assertFileOperationActive(signal);
          scannedEntries += 1;
          if (scannedEntries > MAX_SEARCH_SCANNED_ENTRIES) {
            truncated = true;
            break;
          }
          if (entry.isSymbolicLink()) continue;
          if (!entry.isDirectory() && !entry.isFile()) continue;

          const relativePath = current.relativePath
            ? `${current.relativePath}/${entry.name}`
            : entry.name;
          if (isSensitiveTreePath(relativePath)) continue;
          if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
          if (entry.isDirectory() && current.depth >= MAX_SEARCH_DIRECTORY_DEPTH) {
            truncated = true;
            continue;
          }
          if (entry.isFile() && !matchesSearchGlob(relativePath, fileGlob)) continue;
          children.push({
            absolutePath: path.join(realDirectoryPath, entry.name),
            relativePath,
            name: entry.name,
            kind: entry.isDirectory() ? "directory" : "file",
          });
        }
      } finally {
        await directory.close().catch(() => undefined);
      }
    } finally {
      await directoryHandle.close().catch(() => undefined);
    }

    children.sort((left, right) =>
      left.name.localeCompare(right.name)
        || (left.kind === right.kind ? 0 : left.kind === "directory" ? -1 : 1),
    );
    const discoveredDirectories: typeof pendingDirectories = [];
    for (const child of children) {
      assertFileOperationActive(signal);
      if (Date.now() >= deadline) {
        truncated = true;
        break;
      }
      if (child.kind === "directory") {
        discoveredDirectories.push({
          absolutePath: child.absolutePath,
          relativePath: child.relativePath,
          depth: current.depth + 1,
        });
        continue;
      }
      await addFile(child.absolutePath, child.relativePath);
      if (files.length >= MAX_SEARCH_FILES) {
        if (
          children.at(-1) !== child
          || discoveredDirectories.length > 0
          || pendingDirectories.length > 0
        ) {
          truncated = true;
        }
        break;
      }
    }
    pendingDirectories.push(...discoveredDirectories.reverse());
  }

  return { files, truncated };
}

type GrepBufferResult = {
  exitCode: number | null;
  stdout: Buffer;
  timedOut: boolean;
  outputLimitReached: boolean;
};

async function grepBoundedBuffer(
  pattern: string,
  input: Buffer,
  timeoutMs: number,
  outputLimitBytes: number,
  signal?: AbortSignal,
): Promise<GrepBufferResult> {
  assertFileOperationActive(signal);
  return new Promise((resolve, reject) => {
    const child = spawn("grep", ["-n", "-m", "6", "--", pattern], {
      stdio: ["pipe", "pipe", "ignore"],
    });
    const output: Buffer[] = [];
    let outputBytes = 0;
    let timedOut = false;
    let outputLimitReached = false;
    let aborted = false;
    let spawnError: Error | undefined;
    let killTimer: NodeJS.Timeout | undefined;
    const timeout = setTimeout(() => {
      timedOut = true;
      terminate();
    }, Math.max(1, timeoutMs));

    const terminate = (): void => {
      if (!child.killed) child.kill("SIGTERM");
      if (!killTimer) {
        killTimer = setTimeout(() => child.kill("SIGKILL"), 100);
        killTimer.unref();
      }
    };
    const onAbort = (): void => {
      aborted = true;
      terminate();
    };
    const cleanup = (): void => {
      clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
      signal?.removeEventListener("abort", onAbort);
    };

    signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout.on("data", (chunk: Buffer | string) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const remaining = Math.max(0, outputLimitBytes - outputBytes);
      const captured = bytes.subarray(0, remaining);
      if (captured.length > 0) {
        output.push(captured);
        outputBytes += captured.length;
      }
      if (captured.length < bytes.length) {
        outputLimitReached = true;
        terminate();
      }
    });
    child.on("error", (error) => {
      spawnError = Object.assign(error, { searchSpawnError: true });
    });
    child.stdin.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code !== "EPIPE") spawnError = error;
    });
    child.on("close", (code) => {
      cleanup();
      if (aborted) {
        reject(new Error("File operation cancelled."));
      } else if (spawnError) {
        reject(spawnError);
      } else {
        resolve({
          exitCode: code,
          stdout: Buffer.concat(output, outputBytes),
          timedOut,
          outputLimitReached,
        });
      }
    });

    child.stdin.end(input);
    if (signal?.aborted) onAbort();
  });
}

type BoundedLineRangeResult =
  | { kind: "window"; lines: string[] }
  | { kind: "no_content"; totalLines: number }
  | { kind: "scan_limit" }
  | { kind: "window_limit" };

async function readBoundedLineRange(
  filePath: string,
  startLine: number,
  endLine: number,
  signal?: AbortSignal,
  rootPath?: string,
): Promise<BoundedLineRangeResult> {
  const handle = rootPath
    ? await openVerifiedProjectFile(rootPath, filePath, signal)
    : await fs.open(filePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const selectedLines: string[] = [];
    let selectedBytes = 0;
    let currentLineParts: Buffer[] = [];
    let currentLineBytes = 0;
    let currentLine = 1;
    let totalBytesRead = 0;

    const appendToCurrentLine = (segment: Buffer): boolean => {
      if (currentLine < startLine || currentLine > endLine || segment.length === 0) {
        return true;
      }
      const separatorBytes = selectedLines.length > 0 ? 1 : 0;
      if (
        selectedBytes + separatorBytes + currentLineBytes + segment.length
        > MAX_TARGETED_READ_BYTES
      ) {
        return false;
      }
      currentLineParts.push(Buffer.from(segment));
      currentLineBytes += segment.length;
      return true;
    };

    const finishCurrentLine = (): "continue" | "window_limit" => {
      if (currentLine >= startLine && currentLine <= endLine) {
        const separatorBytes = selectedLines.length > 0 ? 1 : 0;
        const line = Buffer.concat(currentLineParts, currentLineBytes).toString("utf-8");
        const outputLineBytes = Buffer.byteLength(line, "utf-8");
        if (selectedBytes + separatorBytes + outputLineBytes > MAX_TARGETED_READ_BYTES) {
          return "window_limit";
        }
        selectedLines.push(line);
        selectedBytes += separatorBytes + outputLineBytes;
      }
      currentLineParts = [];
      currentLineBytes = 0;
      currentLine += 1;
      return "continue";
    };

    while (true) {
      assertFileOperationActive(signal);
      const remainingScanBytes = MAX_TARGETED_READ_SCAN_BYTES - totalBytesRead;
      const readLength = Math.min(
        TARGETED_READ_CHUNK_BYTES,
        Math.max(1, remainingScanBytes + 1),
      );
      const chunk = Buffer.allocUnsafe(readLength);
      const { bytesRead } = await handle.read(chunk, 0, readLength, totalBytesRead);
      assertFileOperationActive(signal);
      if (bytesRead === 0) {
        const finished = finishCurrentLine();
        if (finished === "window_limit") return { kind: "window_limit" };
        const totalLines = currentLine - 1;
        return startLine > totalLines
          ? { kind: "no_content", totalLines }
          : { kind: "window", lines: selectedLines };
      }

      const bytesWithinBudget = Math.min(bytesRead, Math.max(0, remainingScanBytes));
      let segmentStart = 0;
      for (let index = 0; index < bytesWithinBudget; index += 1) {
        if (chunk[index] !== 0x0a) continue;
        if (!appendToCurrentLine(chunk.subarray(segmentStart, index))) {
          return { kind: "window_limit" };
        }
        const finished = finishCurrentLine();
        if (finished === "window_limit") return { kind: "window_limit" };
        segmentStart = index + 1;
        if (currentLine > endLine) {
          return { kind: "window", lines: selectedLines };
        }
      }

      if (!appendToCurrentLine(chunk.subarray(segmentStart, bytesWithinBudget))) {
        return { kind: "window_limit" };
      }

      totalBytesRead += bytesRead;
      if (bytesRead > bytesWithinBudget) return { kind: "scan_limit" };
    }
  } finally {
    await handle.close().catch(() => undefined);
  }
}

/**
 * Execute one tool call from the model. Returns a string that gets added as
 * the tool-result message. For write_file and replace_text the actual write is deferred —
 * the change is pushed to `pendingChanges` instead.
 */
export async function executeFileTool(
  toolName: string,
  args: Record<string, string>,
  rootPath: string,
  pendingChanges: PendingChange[],
  signal?: AbortSignal,
): Promise<string> {
  assertFileOperationActive(signal);
  // Resolve the root once with realpath so every safePath call in this
  // invocation uses the same canonical base. This also catches a rootPath
  // that is itself a symlink pointing somewhere unexpected, and provides a
  // single early failure point if the root has been removed.
  let resolvedRoot: string;
  try {
    resolvedRoot = await fs.realpath(path.resolve(rootPath));
  } catch (error) {
    if (signal?.aborted) throw error;
    return "Error: project root path does not exist or is not accessible.";
  }
  assertFileOperationActive(signal);

  switch (toolName) {
    case "project.list_tree": {
      if (Object.keys(args).length > 0) {
        throw new Error("project_tree_arguments_not_allowed");
      }
      return listManagedProjectTree(rootPath, signal);
    }

    // ── read_file ─────────────────────────────────────────────────────────────
    case "read_file": {
      const requestedPath = args.path ?? "";
      const pathError = inputByteLimitError("path", requestedPath, MAX_TOOL_PATH_BYTES);
      if (pathError) return pathError;
      if (isSensitiveProjectPath(requestedPath)) {
        return `Error: reading "${requestedPath}" is not allowed because the path is classified as sensitive.`;
      }
      const abs = await safePath(resolvedRoot, requestedPath);
      if (!abs) return `Error: "${requestedPath}" resolves outside the project root.`;
      try {
        const complete =
          args.complete === "true" ||
          (args.complete as unknown) === true;
        const limit = complete ? MAX_FORENSIC_READ_BYTES : MAX_READ_BYTES;
        const { bytes, truncated } = await readBoundedFilePrefix(abs, limit, signal, resolvedRoot);
        if (complete) {
          const text = bytes.toString("utf-8");
          const content = truncated ? text + FORENSIC_READ_TRUNCATION_MARKER : text;
          return `File: ${requestedPath}\n\`\`\`\n${content}\n\`\`\``;
        }
        const text = bytes.toString("utf-8");
        const content = truncated ? text + READ_TRUNCATION_MARKER : text;
        return `File: ${requestedPath}\n\`\`\`\n${content}\n\`\`\``;
      } catch (e) {
        if (signal?.aborted) throw e;
        return formatFilesystemError("read", requestedPath, e);
      }
    }

    // ── read_file_range ──────────────────────────────────────────────────────
    case "read_file_range": {
      const requestedPath = args.path ?? "";
      const pathError = inputByteLimitError("path", requestedPath, MAX_TOOL_PATH_BYTES);
      if (pathError) return pathError;
      if (isSensitiveProjectPath(requestedPath)) {
        return `Error: reading "${requestedPath}" is not allowed because the path is classified as sensitive.`;
      }
      const abs = await safePath(resolvedRoot, requestedPath);
      if (!abs) return `Error: "${requestedPath}" resolves outside the project root.`;
      const startLine = Number(args.startLine);
      const endLine = Number(args.endLine);
      if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 1 || endLine < startLine) {
        return 'Error: "startLine" and "endLine" must be positive integers with startLine <= endLine.';
      }
      // Bounded window cap: a targeted read must stay within the safe evidence
      // window so it can never bloat context the way an unbounded request could.
      if (endLine - startLine + 1 > MAX_TARGETED_READ_LINES) {
        return `Error: requested range exceeds the ${MAX_TARGETED_READ_LINES}-line targeted read window. Narrow the range around the symbol you need.`;
      }
      try {
        const result = await readBoundedLineRange(
          abs,
          startLine,
          endLine,
          signal,
          resolvedRoot,
        );
        if (result.kind === "scan_limit") {
          return `Error: finding the requested range exceeded the ${MAX_TARGETED_READ_SCAN_BYTES}-byte scan budget. Narrow the range or search for a closer anchor.`;
        }
        if (result.kind === "window_limit") {
          return 'Error: the targeted window exceeds the safe evidence byte limit. Narrow the range.';
        }
        if (result.kind === "no_content") {
          return `No content in lines ${startLine}–${endLine} of "${requestedPath}" (file has ${result.totalLines} lines).`;
        }
        return `File: ${requestedPath}\n\`\`\`\n${result.lines.join("\n")}\n\`\`\``;
      } catch (e) {
        if (signal?.aborted) throw e;
        return formatFilesystemError("read", requestedPath, e);
      }
    }

    // ── list_directory ────────────────────────────────────────────────────────
    case "list_directory": {
      const target = args.path ?? ".";
      const pathError = inputByteLimitError("path", target, MAX_TOOL_PATH_BYTES);
      if (pathError) return pathError;
      if (isSensitiveProjectPath(target)) {
        return `Error: listing "${target}" is not allowed because the path is classified as sensitive.`;
      }
      const abs = await safePath(resolvedRoot, target);
      if (!abs) return `Error: "${target}" resolves outside the project root.`;
      try {
        const stat = await fs.stat(abs);
        assertFileOperationActive(signal);
        // إصلاح #3: إعادة توجيه تلقائية عندما يُرسل النموذج list_directory على ملف.
        // النموذج يخلط أحياناً بين read_file وlist_directory — نُصحّح بشفافية
        // بدل إرجاع خطأ ENOTDIR الذي يُربك النموذج ويدفعه لتكرار المحاولة.
        if (stat.isFile()) {
          // A capability/forensic probe may use list_directory as a mistaken
          // read_file call. Preserve its explicit complete contract here; the
          // old branch silently downgraded it to the 128 KB display limit and
          // made a valid probe look like incomplete source evidence.
          const complete =
            args.complete === "true" ||
            (args.complete as unknown) === true;
          const limit = complete ? MAX_FORENSIC_READ_BYTES : MAX_READ_BYTES;
          const { bytes, truncated } = await readBoundedFilePrefix(
            abs,
            limit,
            signal,
            resolvedRoot,
          );
          assertFileOperationActive(signal);
          const text = bytes.toString("utf-8");
          const content = truncated
            ? text + (complete ? FORENSIC_READ_TRUNCATION_MARKER : READ_TRUNCATION_MARKER)
            : text;
          return `[note: "${target}" is a file, not a directory — returning its contents via read_file]\nFile: ${target}\n\`\`\`\n${content}\n\`\`\``;
        }
        const entries: Array<{ name: string; isDirectory: boolean }> = [];
        let scannedEntries = 0;
        let truncated = false;
        const directoryHandle = await openVerifiedProjectDirectory(
          resolvedRoot,
          abs,
          signal,
        );
        let directory: Awaited<ReturnType<typeof fs.opendir>> | undefined;
        try {
          directory = await fs.opendir(procFileDescriptorPath(directoryHandle));
          for await (const entry of directory) {
            assertFileOperationActive(signal);
            scannedEntries += 1;
            if (scannedEntries > MAX_DIRECTORY_SCANNED_ENTRIES) {
              truncated = true;
              break;
            }
            if (SKIP_DIRS.has(entry.name) || isSensitiveProjectPath(entry.name)) continue;
            entries.push({ name: entry.name, isDirectory: entry.isDirectory() });
          }
        } finally {
          await directory?.close().catch(() => undefined);
          await directoryHandle.close().catch(() => undefined);
        }
        assertFileOperationActive(signal);
        entries.sort((left, right) => {
          // Directories first, then files, alphabetically.
          if (left.isDirectory !== right.isDirectory) return left.isDirectory ? -1 : 1;
          return left.name.localeCompare(right.name);
        });

        const header = `Contents of "${target}":\n`;
        const markerBytes = Buffer.byteLength(DIRECTORY_TRUNCATION_MARKER, "utf-8");
        const headerBytes = Buffer.byteLength(header, "utf-8");
        if (
          headerBytes + markerBytes + Buffer.byteLength("(empty)", "utf-8")
          > MAX_DIRECTORY_OUTPUT_BYTES
        ) {
          return "Error: the requested path is too long for a bounded directory listing.";
        }
        const maxContentBytes = MAX_DIRECTORY_OUTPUT_BYTES - headerBytes - markerBytes;
        const lines: string[] = [];
        let contentBytes = 0;
        for (const entry of entries) {
          if (lines.length >= MAX_DIRECTORY_ENTRIES) {
            truncated = true;
            break;
          }
          const line = `${entry.isDirectory ? "[dir]  " : "[file] "}${entry.name}`;
          const separatorBytes = lines.length > 0 ? 1 : 0;
          const lineBytes = Buffer.byteLength(line, "utf-8");
          if (contentBytes + separatorBytes + lineBytes > maxContentBytes) {
            truncated = true;
            break;
          }
          lines.push(line);
          contentBytes += separatorBytes + lineBytes;
        }
        if (entries.length > lines.length) truncated = true;
        const content = lines.join("\n") || "(empty)";
        return `${header}${content}${truncated ? DIRECTORY_TRUNCATION_MARKER : ""}`;
      } catch (e) {
        if (signal?.aborted) throw e;
        return formatFilesystemError("list", target, e);
      }
    }

    // ── search_code ───────────────────────────────────────────────────────────
    case "search_code": {
      if (!args.pattern) return 'Error: "pattern" argument is required.';
      const patternError = inputByteLimitError(
        "pattern",
        args.pattern,
        MAX_SEARCH_PATTERN_BYTES,
      );
      if (patternError) return patternError;
      if (args.pattern.includes("\0")) return 'Error: "pattern" must not contain null bytes.';
      if (args.file_glob?.includes("\0")) return 'Error: "file_glob" must not contain null bytes.';
      const globError = inputByteLimitError(
        "file_glob",
        args.file_glob ?? "",
        MAX_SEARCH_GLOB_BYTES,
      );
      if (globError) return globError;
      const rawSearchTarget = args.path ?? ".";
      const pathError = inputByteLimitError("path", rawSearchTarget, MAX_TOOL_PATH_BYTES);
      if (pathError) return pathError;
      if (rawSearchTarget.includes("\0")) return 'Error: "path" must not contain null bytes.';
      const searchTarget = rawSearchTarget.trim() || ".";
      if (isSensitiveProjectPath(searchTarget)) {
        return `Error: searching "${searchTarget}" is not allowed because the path is classified as sensitive.`;
      }
      const searchAbs = await safePath(resolvedRoot, searchTarget);
      if (!searchAbs) return `Error: "${searchTarget}" resolves outside the project root.`;
      try {
        const relativeSearchPath = projectRelativePath(resolvedRoot, searchAbs);
        if (relativeSearchPath === null || isSensitiveTreePath(relativeSearchPath)) {
          return `Error: searching "${searchTarget}" is not allowed because its resolved path is outside the allowed project source scope.`;
        }
        const deadline = Date.now() + MAX_SEARCH_RUNTIME_MS;
        const searchPlan = await collectBoundedSearchFiles(
          resolvedRoot,
          searchAbs,
          args.file_glob,
          deadline,
          signal,
        );
        let truncated = searchPlan.truncated;
        let bytesRead = 0;
        let outputBytes = 0;
        const outputLines: string[] = [];
        const outputBodyLimit = MAX_SEARCH_OUTPUT_BYTES
          - Buffer.byteLength(SEARCH_TRUNCATION_MARKER, "utf-8");

        for (let candidateIndex = 0; candidateIndex < searchPlan.files.length; candidateIndex += 1) {
          assertFileOperationActive(signal);
          if (Date.now() >= deadline) {
            truncated = true;
            break;
          }
          const remainingReadBudget = MAX_SEARCH_TOTAL_BYTES - bytesRead;
          if (remainingReadBudget <= 1) {
            truncated = true;
            break;
          }
          const maxFileBytes = Math.min(
            MAX_SEARCH_FILE_BYTES,
            remainingReadBudget - 1,
          );
          const safeFilePath = await safePath(resolvedRoot, searchPlan.files[candidateIndex]!.relativePath);
          if (!safeFilePath) {
            truncated = true;
            continue;
          }
          const read = await readBoundedFilePrefix(
            safeFilePath,
            maxFileBytes,
            signal,
            resolvedRoot,
          );
          bytesRead += read.bytesRead;
          if (read.truncated) truncated = true;
          if (read.bytes.includes(0)) {
            truncated = true;
            continue;
          }

          const availableOutputBytes = outputBodyLimit - outputBytes;
          const filePrefixBytes = Buffer.byteLength(
            `${searchPlan.files[candidateIndex]!.relativePath}:`,
            "utf-8",
          );
          const grepOutputLimit = Math.min(
            MAX_SEARCH_PROCESS_OUTPUT_BYTES,
            availableOutputBytes - filePrefixBytes,
          );
          if (grepOutputLimit <= 0) {
            truncated = true;
            break;
          }
          const remainingTime = deadline - Date.now();
          if (remainingTime <= 0) {
            truncated = true;
            break;
          }
          const grepResult = await grepBoundedBuffer(
            args.pattern,
            read.bytes,
            remainingTime,
            grepOutputLimit,
            signal,
          );
          if (grepResult.timedOut) {
            truncated = true;
            break;
          }
          if (
            !grepResult.outputLimitReached
            && grepResult.exitCode !== 0
            && grepResult.exitCode !== 1
          ) {
            return "Error: search failed (invalid regular expression or grep error).";
          }
          if (grepResult.outputLimitReached) truncated = true;

          let grepOutput = grepResult.stdout.toString("utf-8");
          if (grepResult.outputLimitReached) {
            const finalNewline = grepOutput.lastIndexOf("\n");
            grepOutput = finalNewline >= 0 ? grepOutput.slice(0, finalNewline) : "";
          } else {
            grepOutput = grepOutput.replace(/\n$/, "");
          }
          const matchedLines = grepOutput ? grepOutput.split("\n") : [];
          if (matchedLines.length > 5) {
            matchedLines.length = 5;
            truncated = true;
          }
          for (const matchedLine of matchedLines) {
            if (outputLines.length >= MAX_SEARCH_LINES) {
              truncated = true;
              break;
            }
            const outputLine = `${searchPlan.files[candidateIndex]!.relativePath}:${matchedLine}`;
            const separatorBytes = outputLines.length > 0 ? 1 : 0;
            const lineBytes = Buffer.byteLength(outputLine, "utf-8");
            if (outputBytes + separatorBytes + lineBytes > outputBodyLimit) {
              truncated = true;
              break;
            }
            outputLines.push(outputLine);
            outputBytes += separatorBytes + lineBytes;
          }
          if (
            truncated
            && (grepResult.outputLimitReached || outputLines.length >= MAX_SEARCH_LINES)
          ) {
            break;
          }
        }

        const output = outputLines.length > 0
          ? outputLines.join("\n")
          : truncated
            ? "No matches found within the bounded search window."
            : "No matches found.";
        return `${output}${truncated ? SEARCH_TRUNCATION_MARKER : ""}`;
      } catch (err) {
        if (signal?.aborted) throw err;
        const error = err as NodeJS.ErrnoException & { searchSpawnError?: boolean };
        if (error.searchSpawnError && error.code === "ENOENT") {
          return "Error: grep is not available in this environment.";
        }
        if (error.code === "EACCES" || error.code === "EPERM") {
          return formatFilesystemError("list", searchTarget, error);
        }
        return `Error: search failed (${error.code === "ENOENT" ? "the target changed during the scan" : "the project filesystem rejected the request"}).`;
      }
    }

    // ── write_file ────────────────────────────────────────────────────────────
    case "write_file": {
      if (!args.path || args.content === undefined) {
        return 'Error: "path" and "content" are required.';
      }
      const metadataError = validateChangeMetadata(args);
      if (metadataError) return metadataError;
      const contentError = inputByteLimitError(
        "content",
        args.content,
        MAX_FULL_REPLACEMENT_BYTES,
      );
      if (contentError) return contentError;

      // ── Sensitive-extension guard ──────────────────────────────────────────
      // Prevent the AI from proposing writes to secret material or executable
      // scripts.  Defence-in-depth on top of the path-traversal guard: even
      // if safePath passes, queuing a change to `.env.production` or
      // `deploy.sh` is almost certainly unintentional — or an injection
      // attempt.  The pattern covers:
      //   • .env* files (any variant: .env, .env.local, .env.production …)
      //   • Shell/PowerShell scripts (.sh, .bash, .zsh, .fish, .ps1, .bat, .cmd)
      //   • TLS/crypto material (.pem, .key, .pfx, .p12, .crt, .cer, .der,
      //     .pub, .rsa, .dsa)
      //   • .htpasswd (Apache credential store)
      const BLOCKED_WRITE_EXTENSIONS =
        /(?:^|[/\\])\.env(?:\.|$)|\.(sh|bash|zsh|fish|ps1|bat|cmd|pem|key|pfx|p12|crt|cer|der|pub|rsa|dsa|htpasswd)$/i;
      if (BLOCKED_WRITE_EXTENSIONS.test(args.path)) {
        return (
          `Error: writing to "${args.path}" is not allowed — the file type is ` +
          `classified as sensitive (secrets, credentials, or executable scripts). ` +
          `If this change is intentional, apply it manually via the terminal.`
        );
      }

      const abs = await safePath(resolvedRoot, args.path);
      assertFileOperationActive(signal);
      if (!abs) return `Error: "${args.path}" resolves outside the project root.`;

      // Reject a write targeting the project root directory itself.
      // safePath returns resolvedRoot when filePath resolves to exactly the
      // root (e.g. args.path is "" or "."), which would queue a change for a
      // directory rather than a file.
      if (abs === resolvedRoot) {
        return 'Error: "path" must be a file path, not the project root directory.';
      }

      // G-15: reject writes to auto-generated files.  Changes to generated
      // files are silently overwritten on the next codegen run, so the right
      // fix is always to edit the source/schema/template that produces them.
      const relForCheck = path.relative(resolvedRoot, abs);
      const GENERATED_PATTERNS = [
        /(?:^|\/)generated\//,          // any /generated/ directory
        /(?:^|\/)__generated__\//,      // GraphQL __generated__
        /(?:^|\/)\.generated\//,        // hidden .generated directories
        /\.gen\.(ts|tsx|js|jsx|py)$/,   // *.gen.ts etc.
        /\.generated\.(ts|tsx|js|jsx|py)$/, // *.generated.ts etc.
      ];
      if (GENERATED_PATTERNS.some((p) => p.test(relForCheck))) {
        return (
          `Error: "${args.path}" is an auto-generated file — editing it directly will be overwritten on ` +
          `the next codegen run. Edit the source schema, template, or configuration that generates it instead.`
        );
      }

      // Normalize the stored relative path so the UI always shows a canonical
      // form (e.g. "src/foo.ts" rather than "./src/foo.ts" or "src/../src/foo.ts").
      const relativePath = path.relative(resolvedRoot, abs);

      let originalContent: string | null = null;
      try {
        const stat = await fs.stat(abs);
        assertFileOperationActive(signal);
        if (!stat.isFile()) {
          return `Error: "${relativePath}" is not a regular file and cannot be replaced.`;
        }
        if (stat.size > MAX_FULL_REPLACEMENT_BYTES) {
          return (
            `Error: "${relativePath}" is larger than ${MAX_FULL_REPLACEMENT_BYTES} bytes. ` +
            `Full-file replacement is blocked to keep the staged diff bounded. Use replace_text ` +
            `for text files up to ${MAX_REPLACE_TEXT_SOURCE_BYTES} bytes.`
          );
        }
        const current = await readBoundedFilePrefix(
          abs,
          MAX_FULL_REPLACEMENT_BYTES,
          signal,
          resolvedRoot,
        );
        if (current.truncated) {
          return (
            `Error: "${relativePath}" exceeded the ${MAX_FULL_REPLACEMENT_BYTES}-byte ` +
            "full-file replacement limit while being read. Use replace_text for a focused change."
          );
        }
        originalContent = current.bytes.toString("utf-8");
      } catch (e) {
        if (signal?.aborted) throw e;
        const code = e && typeof e === "object" && "code" in e
          ? String((e as { code?: unknown }).code ?? "")
          : "";
        if (code !== "ENOENT") {
          return formatFilesystemError("read", relativePath, e);
        }
      }
      assertFileOperationActive(signal);

      pendingChanges.push({
        path: relativePath,
        absolutePath: abs,
        newContent: args.content,
        originalContent,
        baseHash: hashPatchBase(originalContent),
        hunks: buildPatchHunks(originalContent, args.content, args.reason ?? "No reason provided"),
        reason: args.reason ?? "No reason provided",
        validationProfile: args.validation_profile as PendingChange["validationProfile"],
      });

      return `Change queued for "${relativePath}" — reason: ${args.reason ?? "(none)"}. The change has NOT been written to disk. The user will see a diff and must approve it before anything changes.`;
    }

    // ── replace_text ──────────────────────────────────────────────────────────
    case "replace_text": {
      if (!args.path || args.old_text === undefined || args.new_text === undefined) {
        return 'Error: "path", "old_text", and "new_text" are required.';
      }
      const metadataError = validateChangeMetadata(args);
      if (metadataError) return metadataError;
      const oldTextError = inputByteLimitError(
        "old_text",
        args.old_text,
        MAX_REPLACE_TEXT_FRAGMENT_BYTES,
      );
      if (oldTextError) return oldTextError;
      const newTextError = inputByteLimitError(
        "new_text",
        args.new_text,
        MAX_REPLACE_TEXT_FRAGMENT_BYTES,
      );
      if (newTextError) return newTextError;
      if (!args.old_text) return 'Error: "old_text" must not be empty.';

      const BLOCKED_WRITE_EXTENSIONS =
        /(?:^|[/\\])\.env(?:\.|$)|\.(sh|bash|zsh|fish|ps1|bat|cmd|pem|key|pfx|p12|crt|cer|der|pub|rsa|dsa|htpasswd)$/i;
      if (BLOCKED_WRITE_EXTENSIONS.test(args.path)) {
        return (
          `Error: writing to "${args.path}" is not allowed — the file type is ` +
          `classified as sensitive (secrets, credentials, or executable scripts).`
        );
      }

      const abs = await safePath(resolvedRoot, args.path);
      assertFileOperationActive(signal);
      if (!abs) return `Error: "${args.path}" resolves outside the project root.`;
      if (abs === resolvedRoot) return 'Error: "path" must be a file path, not the project root directory.';

      const relForCheck = path.relative(resolvedRoot, abs);
      const GENERATED_PATTERNS = [
        /(?:^|\/)generated\//,
        /(?:^|\/)__generated__\//,
        /(?:^|\/)\.generated\//,
        /\.gen\.(ts|tsx|js|jsx|py)$/,
        /\.generated\.(ts|tsx|js|jsx|py)$/,
      ];
      if (GENERATED_PATTERNS.some((p) => p.test(relForCheck))) {
        return `Error: "${args.path}" is an auto-generated file — edit its source instead.`;
      }

      let originalContent: string;
      try {
        const current = await readBoundedFilePrefix(
          abs,
          MAX_REPLACE_TEXT_SOURCE_BYTES,
          signal,
          resolvedRoot,
        );
        if (current.truncated) {
          return (
            `Error: "${args.path}" is larger than the ${MAX_REPLACE_TEXT_SOURCE_BYTES}-byte ` +
            "replace_text source limit. No change was queued."
          );
        }
        originalContent = current.bytes.toString("utf-8");
      } catch (e) {
        if (signal?.aborted) throw e;
        return formatFilesystemError("read", args.path, e);
      }
      assertFileOperationActive(signal);

      const firstIndex = originalContent.indexOf(args.old_text);
      if (firstIndex < 0) {
        return `Error: old_text was not found exactly in "${relForCheck}". Read the current file and copy the exact text, including whitespace.`;
      }
      const secondIndex = originalContent.indexOf(args.old_text, firstIndex + args.old_text.length);
      if (secondIndex >= 0) {
        return `Error: old_text occurs more than once in "${relForCheck}". Include more surrounding context so the replacement is unique.`;
      }

      const prefix = originalContent.slice(0, firstIndex);
      const suffix = originalContent.slice(firstIndex + args.old_text.length);
      const newContentBytes =
        Buffer.byteLength(prefix, "utf-8")
        + Buffer.byteLength(args.new_text, "utf-8")
        + Buffer.byteLength(suffix, "utf-8");
      if (newContentBytes > MAX_REPLACE_TEXT_SOURCE_BYTES) {
        return (
          `Error: the replacement would make "${relForCheck}" exceed the ` +
          `${MAX_REPLACE_TEXT_SOURCE_BYTES}-byte replace_text result limit. No change was queued.`
        );
      }
      const newContent = prefix + args.new_text + suffix;
      const relativePath = path.relative(resolvedRoot, abs);
      pendingChanges.push({
        path: relativePath,
        absolutePath: abs,
        newContent,
        originalContent,
        baseHash: hashPatchBase(originalContent),
        hunks: buildPatchHunks(originalContent, newContent, args.reason ?? "Focused text replacement"),
        reason: args.reason ?? "Focused text replacement",
        validationProfile: args.validation_profile as PendingChange["validationProfile"],
      });

      return (
        `Focused change queued for "${relativePath}" — replaced one exact text occurrence. ` +
        "The complete file was reconstructed by the server and has NOT been written to disk."
      );
    }

    default:
      return `Unknown tool: "${toolName}".`;
  }
}
