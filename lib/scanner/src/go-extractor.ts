import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { GO_AST_SCRIPT } from "./go-ast-script.js";
import {
  parseBoundedJsonArray,
  runBoundedSubprocess,
  SCANNER_SUBPROCESS_LIMITS,
  stringifyBoundedJsonArray,
  waitForSubprocessWithAbort,
} from "./bounded-subprocess.js";

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

let cachedScriptPath: string | null = null;
let cachedBinaryPath: string | null = null;
let binaryBuild: Promise<string> | undefined;

function getScriptPath(): string {
  if (cachedScriptPath) return cachedScriptPath;
  const dir = mkdtempSync(path.join(tmpdir(), "scanner-go-"));
  const scriptPath = path.join(dir, "ast_extractor.go");
  writeFileSync(scriptPath, GO_AST_SCRIPT, "utf8");
  cachedScriptPath = scriptPath;
  return scriptPath;
}

async function getBinaryPath(signal?: AbortSignal): Promise<string> {
  if (cachedBinaryPath) return cachedBinaryPath;
  signal?.throwIfAborted();
  const scriptPath = getScriptPath();
  const binaryPath = path.join(path.dirname(scriptPath), "ast_extractor");
  if (!binaryBuild) {
    const build = runBoundedSubprocess({
      command: GO_BINARY,
      args: ["build", "-o", binaryPath, scriptPath],
      env: { ...process.env, GO111MODULE: "off" },
      signal,
      timeoutMs: SCANNER_SUBPROCESS_LIMITS.timeoutMs,
      maxInputBytes: 1,
      maxStdoutBytes: 1_000_000,
      maxStderrBytes: 64 * 1024,
    }).then(() => binaryPath);
    binaryBuild = build;
    void build.then(
      (builtPath) => {
        cachedBinaryPath = builtPath;
        if (binaryBuild === build) binaryBuild = undefined;
      },
      () => {
        if (binaryBuild === build) binaryBuild = undefined;
      },
    );
  }
  return waitForSubprocessWithAbort(binaryBuild, signal);
}

/**
 * Parse a batch with Go's standard-library parser. Parser errors are returned
 * per file by the helper; process/toolchain failures reject so the caller can
 * mark the language as unavailable instead of manufacturing graph evidence.
 */
export async function extractGoBatch(
  files: { path: string; content: string }[],
  signal?: AbortSignal,
): Promise<GoFileResult[]> {
  if (files.length === 0) return Promise.resolve([]);
  signal?.throwIfAborted();
  const binaryPath = await getBinaryPath(signal);
  const stdin = stringifyBoundedJsonArray(files);
  const { stdout } = await runBoundedSubprocess({
    command: binaryPath,
    args: [],
    stdin,
    env: { ...process.env, GO111MODULE: "off" },
    signal,
    timeoutMs: SCANNER_SUBPROCESS_LIMITS.timeoutMs,
    maxInputBytes: SCANNER_SUBPROCESS_LIMITS.maxInputBytes,
    maxStdoutBytes: SCANNER_SUBPROCESS_LIMITS.maxStdoutBytes,
    maxStderrBytes: SCANNER_SUBPROCESS_LIMITS.maxStderrBytes,
  });
  signal?.throwIfAborted();
  return parseBoundedJsonArray<GoFileResult>(stdout, "Go AST");
}