/**
 * File system tools for the chat agent.
 *
 * Activated only when `rootPath` is passed to the chat function, giving the
 * model read and write access to the actual project source files.
 *
 * Security contract:
 *   - rootPath is resolved with fs.realpath once per executeFileTool call.
 *   - All caller-supplied paths are checked lexically first, then with
 *     fs.realpath so that symlinks pointing outside the root are caught.
 *   - Null bytes are rejected explicitly before any path operation.
 *   - read_file / list_directory / search_code execute immediately.
 *   - write_file / replace_text NEVER write to disk — they queue a PendingChange that the
 *     user must explicitly approve via the dashboard before anything changes.
 *   - search_code uses execFile (no shell) so the pattern and root path are
 *     passed as plain argv entries, never interpolated into a shell string.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { type PendingChange } from "../schemas/chat.schema.js";
import { buildPatchHunks, hashPatchBase } from "../patch-contract.js";

const execFileAsync = promisify(execFile);

const MAX_READ_BYTES = 128_000; // ~128 KB per normal file read — keeps previews bounded
const MAX_FORENSIC_READ_BYTES = 512_000;
const MAX_TARGETED_READ_LINES = 4_000; // read_file_range window cap
const MAX_TARGETED_READ_BYTES = 128_000; // safety byte cap on a targeted window
const MAX_FULL_REPLACEMENT_BYTES = 128_000; // full-file write safety cap remains independent from read previews
const MAX_SEARCH_LINES = 50;
const READ_TRUNCATION_MARKER =
  "\n\n[... output truncated at 128 KB by the read tool; this is a display limit, not evidence that the file is incomplete or corrupted. Do not infer missing code from this marker. Use targeted search_code or replace_text for exact source-level evidence. ...]";
const FORENSIC_READ_TRUNCATION_MARKER =
  "\n\n[... forensic read exceeded the maximum safe evidence window; complete source evidence is unavailable for this file. ...]";
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", ".next", "__pycache__", ".venv", "build", "coverage"]);

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
        "Read the first 128 KB of a source file. The result may be a bounded preview; a truncation marker is a tool display limit, not proof that the file is incomplete. Use search_code for targeted evidence and replace_text for focused edits.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description:
              "File path relative to the project root (e.g. 'src/index.ts', 'lib/auth.py').",
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
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file_range",
      description:
        "Read a specific line range of a source file (1-based, inclusive). Use this to retrieve a targeted source window (e.g. around a symbol found via search_code) instead of re-reading the whole file. The result is a bounded window; when the file is larger than a full read, this is the preferred way to obtain exact code for a claim.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
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
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_directory",
      description: "List the files and sub-directories in a directory of the project.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description:
              "Directory path relative to the project root. Use '.' to list the root itself.",
          },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_code",
      description:
        "Search for a text or regex pattern across all source files. Returns matching lines with file path and line number.",
      parameters: {
        type: "object",
        properties: {
          pattern: {
            type: "string",
            description: "Plain text or basic regex pattern to search for.",
          },
          file_glob: {
            type: "string",
            description:
              "Optional glob to restrict the search to specific file types (e.g. '*.ts', '*.py'). Omit to search all files.",
          },
        },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "replace_text",
      description:
        "Propose a focused text replacement inside an existing file. The server reads the complete current file, requires the old text to match exactly once, and constructs the full pending change. Prefer this over write_file for existing source files, especially large files.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "File path relative to the project root.",
          },
          old_text: {
            type: "string",
            description: "The exact existing text to replace, including whitespace and line breaks.",
          },
          new_text: {
            type: "string",
            description: "The replacement text.",
          },
          reason: {
            type: "string",
            description: "One-sentence explanation of why this focused change is needed.",
          },
          validation_profile: {
            type: "string",
            enum: ["ai-orchestrator-tests", "knowledge-engine-tests", "api-ai-tests"],
            description:
              "Optional registered behavioral validation profile. Provide a profile only when the Repair Plan names a concrete matching test scenario. Never provide a shell command.",
          },
        },
        required: ["path", "old_text", "new_text", "reason"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description:
        "Propose a file write or modification. The change is QUEUED for user approval and is NOT written to disk until the user explicitly approves it. Always read the file first before proposing a modification so you write the complete corrected content.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "File path relative to the project root.",
          },
          content: {
            type: "string",
            description: "The complete new file content (not a diff — the full replacement).",
          },
          reason: {
            type: "string",
            description: "One-sentence explanation of why this change is needed.",
          },
          validation_profile: {
            type: "string",
            enum: ["ai-orchestrator-tests", "knowledge-engine-tests", "api-ai-tests"],
            description:
              "Optional registered behavioral validation profile. Provide a profile only when the Repair Plan names a concrete matching test scenario. Never provide a shell command.",
          },
        },
        required: ["path", "content", "reason"],
      },
    },
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Escape a string for use as a literal inside a RegExp constructor.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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
async function safePath(resolvedRoot: string, filePath: string): Promise<string | null> {
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
): Promise<string> {
  // Resolve the root once with realpath so every safePath call in this
  // invocation uses the same canonical base. This also catches a rootPath
  // that is itself a symlink pointing somewhere unexpected, and provides a
  // single early failure point if the root has been removed.
  let resolvedRoot: string;
  try {
    resolvedRoot = await fs.realpath(path.resolve(rootPath));
  } catch {
    return "Error: project root path does not exist or is not accessible.";
  }

  switch (toolName) {
    // ── read_file ─────────────────────────────────────────────────────────────
    case "read_file": {
      const abs = await safePath(resolvedRoot, args.path ?? "");
      if (!abs) return `Error: "${args.path}" resolves outside the project root.`;
      try {
        const buf = await fs.readFile(abs);
        const complete =
          args.complete === "true" ||
          (args.complete as unknown) === true;
        if (complete) {
          const truncated = buf.length > MAX_FORENSIC_READ_BYTES;
          const sliced = truncated ? buf.subarray(0, MAX_FORENSIC_READ_BYTES) : buf;
          const text = sliced.toString("utf-8");
          const content = truncated ? text + FORENSIC_READ_TRUNCATION_MARKER : text;
          return `File: ${args.path}\n\`\`\`\n${content}\n\`\`\``;
        }
        // Slice the buffer BEFORE decoding to UTF-8: without this, a file
        // close to the limit with multi-byte characters could expand beyond
        // MAX_READ_BYTES in the string representation.
        const truncated = buf.length > MAX_READ_BYTES;
        const sliced = truncated ? buf.subarray(0, MAX_READ_BYTES) : buf;
        const text = sliced.toString("utf-8");
        const content = truncated ? text + READ_TRUNCATION_MARKER : text;
        return `File: ${args.path}\n\`\`\`\n${content}\n\`\`\``;
      } catch (e) {
        return `Error reading "${args.path}": ${e instanceof Error ? e.message : String(e)}`;
      }
    }

    // ── read_file_range ──────────────────────────────────────────────────────
    case "read_file_range": {
      const abs = await safePath(resolvedRoot, args.path ?? "");
      if (!abs) return `Error: "${args.path}" resolves outside the project root.`;
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
        const buf = await fs.readFile(abs);
        const text = buf.toString("utf-8");
        const lines = text.split("\n");
        const from = startLine - 1;
        const to = Math.min(endLine, lines.length);
        if (from >= lines.length || lines.length === 0) {
          return `No content in lines ${startLine}–${endLine} of "${args.path}" (file has ${lines.length} lines).`;
        }
        const window = lines.slice(from, to).join("\n");
        // Measure only the returned window, not the full file. A large source
        // file (up to 512 KB forensic limit) can still yield a small targeted
        // window that is entirely within the safe evidence byte budget.
        const windowBytes = Buffer.byteLength(window, "utf-8");
        if (windowBytes > MAX_TARGETED_READ_BYTES) {
          // A pathologically long single line (or very wide window) would still
          // exceed the cap. Report so the caller knows the window is invalid.
          return 'Error: the targeted window exceeds the safe evidence byte limit. Narrow the range.';
        }
        return `File: ${args.path}\n\`\`\`\n${window}\n\`\`\``;
      } catch (e) {
        return `Error reading "${args.path}": ${e instanceof Error ? e.message : String(e)}`;
      }
    }

    // ── list_directory ────────────────────────────────────────────────────────
    case "list_directory": {
      const target = args.path ?? ".";
      const abs = await safePath(resolvedRoot, target);
      if (!abs) return `Error: "${target}" resolves outside the project root.`;
      try {
        const stat = await fs.stat(abs);
        // إصلاح #3: إعادة توجيه تلقائية عندما يُرسل النموذج list_directory على ملف.
        // النموذج يخلط أحياناً بين read_file وlist_directory — نُصحّح بشفافية
        // بدل إرجاع خطأ ENOTDIR الذي يُربك النموذج ويدفعه لتكرار المحاولة.
        if (stat.isFile()) {
          const buf = await fs.readFile(abs);
          const truncated = buf.length > MAX_READ_BYTES;
          const text = (truncated ? buf.subarray(0, MAX_READ_BYTES) : buf).toString("utf-8");
          const content = truncated ? text + READ_TRUNCATION_MARKER : text;
          return `[note: "${target}" is a file, not a directory — returning its contents via read_file]\nFile: ${target}\n\`\`\`\n${content}\n\`\`\``;
        }
        const entries = await fs.readdir(abs, { withFileTypes: true });
        const lines = entries
          .filter((e) => !SKIP_DIRS.has(e.name))
          .sort((a, b) => {
            // Directories first, then files, alphabetically.
            if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
            return a.name.localeCompare(b.name);
          })
          .map((e) => `${e.isDirectory() ? "[dir]  " : "[file] "}${e.name}`)
          .join("\n");
        return `Contents of "${target}":\n${lines || "(empty)"}`;
      } catch (e) {
        return `Error listing "${target}": ${e instanceof Error ? e.message : String(e)}`;
      }
    }

    // ── search_code ───────────────────────────────────────────────────────────
    case "search_code": {
      if (!args.pattern) return 'Error: "pattern" argument is required.';
      if (args.pattern.includes("\0")) return 'Error: "pattern" must not contain null bytes.';

      // Build the argv array directly — no shell is involved so no quoting or
      // escaping is needed. The pattern and root path are passed as opaque
      // strings to execFile, which hands them to the OS via execve.
      const grepArgs: string[] = [
        "-r",   // recursive
        "-n",   // line numbers
        "-m", "5", // at most 5 matches per file (limits per-file output)
      ];

      if (args.file_glob) {
        if (args.file_glob.includes("\0")) return 'Error: "file_glob" must not contain null bytes.';
        grepArgs.push("--include", args.file_glob);
      }

      // "--" ends option parsing: prevents a pattern starting with "-" from
      // being treated as a grep flag even though there is no shell involved.
      grepArgs.push("--", args.pattern, resolvedRoot);

      try {
        const { stdout } = await execFileAsync("grep", grepArgs, {
          timeout: 10_000,
          maxBuffer: 1_000_000, // 1 MB cap on raw output before line-slicing
        });
        // Strip the absolute root prefix from every output line so the model
        // sees project-relative paths. Escape the root for literal RegExp use.
        const relative = stdout.replace(
          new RegExp(`^${escapeRegex(resolvedRoot)}/`, "gm"),
          "",
        );
        const lines = relative.trim().split("\n").slice(0, MAX_SEARCH_LINES).join("\n");
        return lines || "No matches found.";
      } catch (err) {
        const e = err as { code?: unknown; killed?: boolean; message?: string };
        // grep exits 1 when no lines match — not an error.
        if (e.code === 1) return "No matches found.";
        // Timeout: execFile sets killed=true when the timeout fires.
        if (e.killed) return "Error: search timed out. Try a more specific pattern or a narrower root path.";
        // grep binary missing on this system.
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return "Error: grep is not available in this environment.";
        // Catch-all for anything else (ENOMEM, permission denied, etc.)
        return `Error: search failed (${(e as Error).message ?? "unknown reason"}).`;
      }
    }

    // ── write_file ────────────────────────────────────────────────────────────
    case "write_file": {
      if (!args.path || args.content === undefined) {
        return 'Error: "path" and "content" are required.';
      }

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

      // Read the current file content so the UI can show a proper diff.
      let originalContent: string | null = null;
      try {
        originalContent = await fs.readFile(abs, "utf-8");
      } catch {
        // File doesn't exist yet — that's fine for new files.
      }

      if (
        originalContent !== null &&
        Buffer.byteLength(originalContent, "utf8") > MAX_FULL_REPLACEMENT_BYTES &&
        /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|rb|php|vue|svelte)$/i.test(relativePath)
      ) {
        return (
          `Error: "${relativePath}" is an existing source file larger than ${MAX_FULL_REPLACEMENT_BYTES} bytes. ` +
          `Full-file replacement is blocked to prevent truncation. Use replace_text with the exact old_text and new_text instead.`
        );
      }

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

      const BLOCKED_WRITE_EXTENSIONS =
        /(?:^|[/\\])\.env(?:\.|$)|\.(sh|bash|zsh|fish|ps1|bat|cmd|pem|key|pfx|p12|crt|cer|der|pub|rsa|dsa|htpasswd)$/i;
      if (BLOCKED_WRITE_EXTENSIONS.test(args.path)) {
        return (
          `Error: writing to "${args.path}" is not allowed — the file type is ` +
          `classified as sensitive (secrets, credentials, or executable scripts).`
        );
      }

      const abs = await safePath(resolvedRoot, args.path);
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
        originalContent = await fs.readFile(abs, "utf-8");
      } catch (e) {
        return `Error reading "${args.path}": ${e instanceof Error ? e.message : String(e)}`;
      }
      if (!args.old_text) return 'Error: "old_text" must not be empty.';

      const firstIndex = originalContent.indexOf(args.old_text);
      if (firstIndex < 0) {
        return `Error: old_text was not found exactly in "${relForCheck}". Read the current file and copy the exact text, including whitespace.`;
      }
      const secondIndex = originalContent.indexOf(args.old_text, firstIndex + args.old_text.length);
      if (secondIndex >= 0) {
        return `Error: old_text occurs more than once in "${relForCheck}". Include more surrounding context so the replacement is unique.`;
      }

      const newContent =
        originalContent.slice(0, firstIndex) +
        args.new_text +
        originalContent.slice(firstIndex + args.old_text.length);
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
