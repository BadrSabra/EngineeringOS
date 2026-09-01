import { promises as fs } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  GroqClientError,
  reviewCode,
  runEmpiricalQualityCampaign,
  validateEmpiricalQualityCorpus,
  type CodeReviewResult,
  type EmpiricalCaseObservation,
  type EmpiricalCorpusCase,
  type EmpiricalQualityCorpus,
  type EmpiricalQualityScorecard,
  type ProviderId,
} from "@workspace/ai-orchestrator";
import type { ProjectContext } from "@workspace/ai-orchestrator";
import { createHostDisposableTempDirectory, HOST_DISPOSABLE_TEMP_ROOT } from "./disposable-temp.js";

const execFileAsync = promisify(execFile);
export const EMPIRICAL_QUALITY_MAX_SELECTED_FILE_BYTES = 50_000;

class IncompleteEmpiricalEvidenceError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "IncompleteEmpiricalEvidenceError";
  }
}

const PROVIDER_KEY_ENV: Record<ProviderId, string> = {
  openrouter: "OPENROUTER_API_KEY",
  gemini: "GEMINI_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  groq: "GROQ_API_KEY",
};

const PROVIDER_UNAVAILABLE_CODES = new Set([
  "AUTH_ERROR",
  "NETWORK_ERROR",
  "QUOTA",
  "RATE_LIMITED",
  "SERVER_ERROR",
  "MODEL_NOT_FOUND",
  "PLAN_RESTRICTED",
  "MODEL_UNAVAILABLE",
  "INVALID_CONFIG",
]);

const SAFE_PROVIDER: Set<string> = new Set(Object.keys(PROVIDER_KEY_ENV));

export type EmpiricalCaseWorkspace = {
  rootPath: string;
  cleanup: () => Promise<void>;
};

export type EmpiricalCaseReviewInput = {
  testCase: EmpiricalCorpusCase;
  rootPath: string;
  fileContents: Record<string, string>;
  provider: ProviderId;
  apiKey: string;
  model?: string;
  signal: AbortSignal;
};

export type EmpiricalCaseWorkspaceFactory = (
  testCase: EmpiricalCorpusCase,
  timeoutMs: number,
  signal: AbortSignal,
) => Promise<EmpiricalCaseWorkspace>;

export type EmpiricalCaseReview = (
  input: EmpiricalCaseReviewInput,
) => Promise<CodeReviewResult>;

export type ApiEmpiricalQualityCampaignOptions = {
  corpus: EmpiricalQualityCorpus;
  provider: ProviderId;
  apiKey: string;
  model?: string;
  caseTimeoutMs?: number;
  campaignTimeoutMs?: number;
  generatedAt?: string;
  workspaceFactory?: EmpiricalCaseWorkspaceFactory;
  reviewCase?: EmpiricalCaseReview;
};

function isProvider(value: string): value is ProviderId {
  return SAFE_PROVIDER.has(value);
}

function positiveInteger(value: string | undefined, fallback: number, minimum: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isInteger(parsed) || parsed < minimum) return fallback;
  return parsed;
}

function classifyProviderError(error: unknown): EmpiricalCaseObservation["errorCode"] {
  if (error instanceof IncompleteEmpiricalEvidenceError) return "INCOMPLETE_EVIDENCE";
  if (error instanceof GroqClientError) {
    if (error.code === "TIMEOUT") return "TIMEOUT";
    if (PROVIDER_UNAVAILABLE_CODES.has(error.code)) return "PROVIDER_UNAVAILABLE";
  }
  if (error instanceof Error && (error.name === "AbortError" || error.message.includes("timed out"))) {
    return "TIMEOUT";
  }
  return "EXECUTION_ERROR";
}

function projectReviewObservation(
  testCase: EmpiricalCorpusCase,
  result: CodeReviewResult,
  latencyMs: number,
): Omit<EmpiricalCaseObservation, "caseId"> {
  const incomplete = Boolean(result._parseError || result._qualityError);
  const observedFindings = incomplete
    ? []
    : result.issues.map((issue) => {
        const file = typeof issue.file === "string" ? issue.file.trim() : "";
        const citationValid = testCase.selectedFiles.includes(file);
        return {
          file,
          type: issue.type,
          severity: issue.severity,
          citationValid,
          citationSupported: citationValid,
        };
      });
  const droppedCitation = incomplete
    ? 0
    : result.issues.filter((issue) => !testCase.selectedFiles.includes((issue.file ?? "").trim())).length;

  return {
    outcome: incomplete ? "ERROR" : "COMPLETE",
    contractPassed: !incomplete,
    qualityGateAccepted: !incomplete && result.verdict === "approved",
    semanticVerdict: incomplete ? "unknown" : result.issues.length > 0 ? "findings" : "clean",
    observedFindings,
    normalization: { droppedCitation },
    latencyMs,
    ...(incomplete ? { errorCode: "EXECUTION_ERROR" } : {}),
  };
}

async function readSelectedFiles(
  testCase: EmpiricalCorpusCase,
  rootPath: string,
): Promise<Record<string, string>> {
  const resolvedRoot = await fs.realpath(rootPath);
  const contents: Record<string, string> = {};
  for (const relativeFile of testCase.selectedFiles) {
    try {
      const candidate = path.resolve(resolvedRoot, relativeFile);
      const relativeCandidate = path.relative(resolvedRoot, candidate);
      if (!relativeCandidate || relativeCandidate.startsWith("..") || path.isAbsolute(relativeCandidate)) {
        throw new Error("Selected corpus file escaped its disposable repository root.");
      }
      const realCandidate = await fs.realpath(candidate);
      const realRelative = path.relative(resolvedRoot, realCandidate);
      if (!realRelative || realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
        throw new Error("Selected corpus file symlink escaped its disposable repository root.");
      }
      const initialStat = await fs.stat(realCandidate);
      if (!initialStat.isFile() || initialStat.size > EMPIRICAL_QUALITY_MAX_SELECTED_FILE_BYTES) {
        throw new Error(`Selected file exceeds the ${EMPIRICAL_QUALITY_MAX_SELECTED_FILE_BYTES}-byte evidence limit.`);
      }
      const handle = await fs.open(realCandidate, "r");
      try {
        const buffer = Buffer.alloc(initialStat.size);
        let offset = 0;
        while (offset < buffer.length) {
          const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
          if (bytesRead === 0) throw new Error("Selected file could not be read completely.");
          offset += bytesRead;
        }
        const finalStat = await fs.stat(realCandidate);
        if (offset !== initialStat.size || finalStat.size !== initialStat.size) {
          throw new Error("Selected file changed while evidence was being read.");
        }
        contents[relativeFile] = buffer.toString("utf8");
      } finally {
        await handle.close();
      }
    } catch (error) {
      if (error instanceof IncompleteEmpiricalEvidenceError) throw error;
      throw new IncompleteEmpiricalEvidenceError(
        `Selected corpus evidence is incomplete for ${relativeFile}.`,
        { cause: error },
      );
    }
  }
  return contents;
}

async function cloneReviewedRepository(
  testCase: EmpiricalCorpusCase,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<EmpiricalCaseWorkspace> {
  const rootPath = await createHostDisposableTempDirectory("engineeringos-empirical-");
  const cleanup = async () => fs.rm(rootPath, { recursive: true, force: true });
  try {
    if (signal.aborted) throw new Error("Campaign was cancelled before repository checkout.");
    const commandOptions = { timeout: timeoutMs, maxBuffer: 256 * 1024, signal };
    await execFileAsync(
      "git",
      ["clone", "--depth", "1", "--no-checkout", testCase.repositoryUrl, rootPath],
      commandOptions,
    );
    await execFileAsync("git", ["-C", rootPath, "fetch", "--depth", "1", "origin", testCase.sourceRevision], commandOptions);
    await execFileAsync("git", ["-C", rootPath, "checkout", "--detach", testCase.sourceRevision], commandOptions);
    return { rootPath, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

const defaultReviewCase: EmpiricalCaseReview = async (input) => {
  if (input.provider === "openrouter" && input.model) {
    process.env.OPENROUTER_MODEL = input.model;
  }
  const context: ProjectContext = {
    project: `Reviewed public repository ${input.testCase.repositoryId}`,
    recentTasks: "No task history is injected.",
    latestMetrics: "No metrics are injected.",
    graphSummary: `${input.testCase.selectedFiles.length} entities total: ${input.testCase.selectedFiles.join(", ")}\nRelationships (0 shown)`,
    recentEvents: "No events are injected.",
    workflows: "The campaign is isolated and read-only.",
    metricsVerified: true,
  };
  return reviewCode(
    context,
    input.fileContents,
    {
      provider: input.provider,
      apiKey: input.apiKey,
      signal: input.signal,
      maxFallbackModels: 3,
      retryTransient: false,
      qualityProfile: "code_review",
    },
    { requireSelectedFileFinding: input.testCase.outcome === "defect" },
  );
};

const defaultWorkspaceFactory: EmpiricalCaseWorkspaceFactory = cloneReviewedRepository;

export async function runApiEmpiricalQualityCampaign(
  options: ApiEmpiricalQualityCampaignOptions,
): Promise<EmpiricalQualityScorecard> {
  const corpus = validateEmpiricalQualityCorpus(options.corpus);
  const caseTimeoutMs = options.caseTimeoutMs ?? 90_000;
  const workspaceFactory = options.workspaceFactory ?? defaultWorkspaceFactory;
  const review = options.reviewCase ?? defaultReviewCase;

  if (!isProvider(options.provider)) throw new Error("Unsupported empirical quality provider.");
  if (!options.apiKey.trim()) throw new Error("An API key is required for the empirical quality campaign.");
  if (!Number.isInteger(caseTimeoutMs) || caseTimeoutMs < 1_000) {
    throw new Error("Empirical quality case timeout must be at least 1000ms.");
  }
  if (options.campaignTimeoutMs !== undefined &&
      (!Number.isInteger(options.campaignTimeoutMs) || options.campaignTimeoutMs < caseTimeoutMs)) {
    throw new Error("Empirical quality campaign timeout must cover at least one case timeout.");
  }

  const scorecard = await runEmpiricalQualityCampaign({
    corpus,
    provider: options.provider,
    model: options.model ?? null,
    caseTimeoutMs,
    campaignTimeoutMs: options.campaignTimeoutMs,
    generatedAt: options.generatedAt,
    executeCase: async (testCase, signal) => {
      const startedAt = Date.now();
      let workspace: EmpiricalCaseWorkspace | undefined;
      try {
        workspace = await workspaceFactory(testCase, caseTimeoutMs, signal);
        const fileContents = await readSelectedFiles(testCase, workspace.rootPath);
        const result = await review({
          testCase,
          rootPath: workspace.rootPath,
          fileContents,
          provider: options.provider,
          apiKey: options.apiKey,
          model: options.model,
          signal,
        });
        return projectReviewObservation(testCase, result, Date.now() - startedAt);
      } catch (error) {
        const errorCode = classifyProviderError(error);
        return {
          outcome: errorCode === "TIMEOUT" ? "TIMEOUT" : errorCode === "PROVIDER_UNAVAILABLE" ? "PROVIDER_UNAVAILABLE" : "ERROR",
          contractPassed: false,
          qualityGateAccepted: false,
          semanticVerdict: "unknown",
          observedFindings: [],
          errorCode,
          latencyMs: Date.now() - startedAt,
        };
      } finally {
        if (workspace) await workspace.cleanup();
      }
    },
  });
  return scorecard;
}

export async function loadEmpiricalQualityCorpus(filePath: string): Promise<EmpiricalQualityCorpus> {
  const parsed: unknown = JSON.parse(await fs.readFile(path.resolve(filePath), "utf8"));
  return validateEmpiricalQualityCorpus(parsed);
}

export async function writeEmpiricalQualityScorecard(filePath: string, scorecard: EmpiricalQualityScorecard): Promise<void> {
  const outputPath = path.resolve(filePath);
  const disposableRoot = path.resolve(HOST_DISPOSABLE_TEMP_ROOT);
  const relative = path.relative(disposableRoot, outputPath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Empirical quality output must be inside the host disposable temp root.");
  }
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.tmp-${process.pid}`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(scorecard, null, 2)}\n`, "utf8");
  await fs.rename(temporaryPath, outputPath);
}

export function empiricalQualityProviderKey(provider: string): string {
  if (!isProvider(provider)) throw new Error("Unsupported empirical quality provider.");
  return PROVIDER_KEY_ENV[provider];
}

export const empiricalQualityCampaignDefaults = {
  caseTimeoutMs: 90_000,
  campaignTimeoutMs: 900_000,
};

export function parseEmpiricalQualityTimeouts(): {
  caseTimeoutMs: number;
  campaignTimeoutMs: number;
} {
  const caseTimeoutMs = positiveInteger(
    process.env.EMPIRICAL_QUALITY_CASE_TIMEOUT_MS,
    empiricalQualityCampaignDefaults.caseTimeoutMs,
    1_000,
  );
  return {
    caseTimeoutMs,
    campaignTimeoutMs: positiveInteger(
      process.env.EMPIRICAL_QUALITY_CAMPAIGN_TIMEOUT_MS,
      empiricalQualityCampaignDefaults.campaignTimeoutMs,
      caseTimeoutMs,
    ),
  };
}

async function main(): Promise<void> {
  if (process.env.RUN_EMPIRICAL_QUALITY_CAMPAIGN !== "1") {
    throw new Error("Empirical quality campaign is opt-in. Set RUN_EMPIRICAL_QUALITY_CAMPAIGN=1.");
  }
  if (process.env.EMPIRICAL_QUALITY_DISPOSABLE !== "1") {
    throw new Error("Empirical quality campaign requires EMPIRICAL_QUALITY_DISPOSABLE=1.");
  }

  const providerValue = process.env.EMPIRICAL_QUALITY_PROVIDER?.trim() || "openrouter";
  const provider = providerValue as ProviderId;
  const apiKey = process.env[empiricalQualityProviderKey(provider)];
  if (!apiKey?.trim()) {
    throw new Error(`Missing ${empiricalQualityProviderKey(provider)} for empirical quality execution.`);
  }
  const corpusPath = process.env.EMPIRICAL_QUALITY_CORPUS_PATH?.trim() ||
    path.resolve(process.cwd(), "../../lib/ai-orchestrator/src/benchmark-fixtures/reviewed-empirical-quality-corpus-v2.json");
  const outputPath = process.env.EMPIRICAL_QUALITY_SCORECARD_PATH?.trim();
  if (!outputPath) throw new Error("EMPIRICAL_QUALITY_SCORECARD_PATH is required for live campaign output.");

  const timeouts = parseEmpiricalQualityTimeouts();
  const scorecard = await runApiEmpiricalQualityCampaign({
    corpus: await loadEmpiricalQualityCorpus(corpusPath),
    provider,
    apiKey,
    model: process.env.EMPIRICAL_QUALITY_MODEL?.trim() || undefined,
    ...timeouts,
  });
  await writeEmpiricalQualityScorecard(outputPath, scorecard);
  console.log(JSON.stringify({
    kind: scorecard.kind,
    status: scorecard.status,
    empiricalQualityStatus: scorecard.empiricalQualityStatus,
    corpusRevision: scorecard.corpusRevision,
    provider: scorecard.provider,
    model: scorecard.model,
    completedCases: scorecard.metrics.completedCases,
    incompleteCases: scorecard.metrics.incompleteCases,
    outputPath: path.resolve(outputPath),
  }));
  if (scorecard.status !== "COMPLETE") process.exitCode = 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  await main();
}