import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PYTHON_AST_SCRIPT } from "./python-ast-script.js";

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
const SUBPROCESS_TIMEOUT_MS = 30_000;

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
export function extractPythonBatch(files: { path: string; content: string }[]): Promise<PythonFileResult[]> {
  if (files.length === 0) return Promise.resolve([]);

  const scriptPath = getScriptPath();

  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON_BINARY, [scriptPath], { stdio: ["pipe", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new Error(`python ast extraction timed out after ${SUBPROCESS_TIMEOUT_MS}ms`));
    }, SUBPROCESS_TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk;
    });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`python ast extraction exited with code ${code}: ${stderr.slice(0, 500)}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout) as PythonFileResult[]);
      } catch (err) {
        reject(new Error(`failed to parse python ast extraction output: ${(err as Error).message}`));
      }
    });

    child.stdin.write(JSON.stringify(files.map((f) => ({ path: f.path, content: f.content }))));
    child.stdin.end();
  });
}
