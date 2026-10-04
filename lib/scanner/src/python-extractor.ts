import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PYTHON_AST_SCRIPT } from "./python-ast-script.js";
import {
  parseBoundedJsonArray,
  runBoundedSubprocess,
  SCANNER_SUBPROCESS_LIMITS,
  stringifyBoundedJsonArray,
} from "./bounded-subprocess.js";

export interface PythonImportInfo {
  module: string | null;
  level: number;
  /** Imported names, e.g. `["utils"]` for `from . import utils` — some of
   *  these may actually be submodule filenames rather than attributes. */
  names: string[];
}

export interface PythonEntityInfo {
  type: "function" | "class";
  name: string;
  className?: string;
}

export interface PythonFileResult {
  path: string;
  entities: PythonEntityInfo[];
  imports: PythonImportInfo[];
  error?: string;
}

const PYTHON_BINARY = process.env.PYTHON_BIN || "python3";

let cachedScriptPath: string | null = null;

/**
 * Materialize the embedded Python script to a temp file once per process
 * and reuse the path — spawning `python3 <file>` is far more robust across
 * platforms than trying to pipe the program itself in over `-c`/stdin
 * alongside the batch data.
 */
function getScriptPath(): string {
  if (cachedScriptPath) return cachedScriptPath;
  const dir = mkdtempSync(path.join(tmpdir(), "scanner-py-"));
  const scriptPath = path.join(dir, "ast_extractor.py");
  writeFileSync(scriptPath, PYTHON_AST_SCRIPT, "utf8");
  cachedScriptPath = scriptPath;
  return scriptPath;
}

/**
 * Run a single batched `python3` subprocess over every Python file in a
 * scan, using the interpreter's own `ast` module for real structural
 * parsing (imports, function/class defs) instead of regex heuristics.
 * Batching all files into one process (data passed via stdin as JSON)
 * keeps subprocess-spawn overhead to O(1) per scan rather than O(files).
 *
 * Rejects if the interpreter is unavailable, the subprocess fails, or its
 * output can't be parsed — callers should catch this and fall back to a
 * degraded extraction path rather than aborting the whole scan.
 */
export async function extractPythonBatch(
  files: { path: string; content: string }[],
  signal?: AbortSignal,
): Promise<PythonFileResult[]> {
  if (files.length === 0) return Promise.resolve([]);

  signal?.throwIfAborted();
  const scriptPath = getScriptPath();
  const stdin = stringifyBoundedJsonArray(
    files.map((file) => ({ path: file.path, content: file.content })),
  );
  const { stdout } = await runBoundedSubprocess({
    command: PYTHON_BINARY,
    args: [scriptPath],
    stdin,
    signal,
    timeoutMs: SCANNER_SUBPROCESS_LIMITS.timeoutMs,
    maxInputBytes: SCANNER_SUBPROCESS_LIMITS.maxInputBytes,
    maxStdoutBytes: SCANNER_SUBPROCESS_LIMITS.maxStdoutBytes,
    maxStderrBytes: SCANNER_SUBPROCESS_LIMITS.maxStderrBytes,
  });
  signal?.throwIfAborted();
  return parseBoundedJsonArray<PythonFileResult>(stdout, "Python AST");
}
