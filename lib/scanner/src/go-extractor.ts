import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { GO_AST_SCRIPT } from "./go-ast-script.js";

export interface GoEntityInfo {
  type: "module" | "function" | "class";
  name: string;
  line: number;
  kind?: string;
  typeKind?: string;
  package?: string;
}

export interface GoImportInfo {
  path: string;
  line: number;
  specifier: string;
}

export interface GoFileResult {
  path: string;
  entities: GoEntityInfo[];
  imports: GoImportInfo[];
  error?: string;
}

const GO_BINARY = process.env.GO_BIN || "go";
const SUBPROCESS_TIMEOUT_MS = 30_000;

let cachedScriptPath: string | null = null;
let cachedBinaryPath: string | null = null;

function getScriptPath(): string {
  if (cachedScriptPath) return cachedScriptPath;
  const dir = mkdtempSync(path.join(tmpdir(), "scanner-go-"));
  const scriptPath = path.join(dir, "ast_extractor.go");
  writeFileSync(scriptPath, GO_AST_SCRIPT, "utf8");
  cachedScriptPath = scriptPath;
  return scriptPath;
}

function getBinaryPath(): string {
  if (cachedBinaryPath) return cachedBinaryPath;
  const scriptPath = getScriptPath();
  const binaryPath = path.join(path.dirname(scriptPath), "ast_extractor");
  execFileSync(GO_BINARY, ["build", "-o", binaryPath, scriptPath], {
    env: { ...process.env, GO111MODULE: "off" },
    timeout: SUBPROCESS_TIMEOUT_MS,
    maxBuffer: 1_000_000,
  });
  cachedBinaryPath = binaryPath;
  return binaryPath;
}

/**
 * Parse a batch with Go's standard-library parser. Parser errors are returned
 * per file by the helper; process/toolchain failures reject so the caller can
 * mark the language as unavailable instead of manufacturing graph evidence.
 */
export function extractGoBatch(
  files: { path: string; content: string }[],
): Promise<GoFileResult[]> {
  if (files.length === 0) return Promise.resolve([]);
  const binaryPath = getBinaryPath();

  return new Promise((resolve, reject) => {
    const child = spawn(binaryPath, [], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, GO111MODULE: "off" },
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new Error(`go ast extraction timed out after ${SUBPROCESS_TIMEOUT_MS}ms`));
    }, SUBPROCESS_TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`go ast extraction exited with code ${code}: ${stderr.slice(0, 500)}`));
        return;
      }
      try {
        const parsed = JSON.parse(stdout) as GoFileResult[];
        if (!Array.isArray(parsed)) throw new Error("Go AST helper returned a non-array result.");
        resolve(parsed);
      } catch (error) {
        reject(new Error(`failed to parse go ast extraction output: ${(error as Error).message}`));
      }
    });

    child.stdin.write(JSON.stringify(files));
    child.stdin.end();
  });
}