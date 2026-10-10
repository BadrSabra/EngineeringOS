import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  FREE_MODELS,
  getUsableDynamicModelFormatSupport,
  getUsableDynamicModelIds,
  GroqClientError,
  refreshDynamicCatalog,
  reviewCode,
  runEmpiricalQualityCampaign,
  validateEmpiricalQualityCorpus,
  type CodeReviewResult,
  type EmpiricalCaseObservation,
  type EmpiricalCorpusCase,
  type EmpiricalQualityCorpus,
  type EmpiricalQualityScorecard,
  type EmpiricalQualityResumeBinding,
  type DynamicModelFormatSupport,
  type OpenRouterFreeModel,
  type ProviderId,
} from "@workspace/ai-orchestrator";
import type { ProjectContext } from "@workspace/ai-orchestrator";
import { createHostDisposableTempDirectory, HOST_DISPOSABLE_TEMP_ROOT } from "./disposable-temp.js";

const execFileAsync = promisify(execFile);
export const EMPIRICAL_QUALITY_MAX_SELECTED_FILE_BYTES = 70_000;
const EMPIRICAL_QUALITY_EVALUATOR_REVISION = "code-review-json-contract-v6";

export async function reviewWithOneSameModelJsonRepair<T extends { _parseError?: unknown }>(
  review: (repairAttempt: boolean, priorParseError?: unknown) => Promise<T>,
): Promise<T> {
  const initial = await review(false);
  if (!initial._parseError) return initial;
  console.info(JSON.stringify({
    scope: "empirical-quality",
    action: "same_model_json_repair",
    attempt: 2,
    reason: "initial_contract_failure",
  }));
  return review(true, initial._parseError);
}

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
  "EMPTY_RESPONSE",
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
  maxTokens?: number;
  timeoutMs: number;
  signal: AbortSignal;
  onProviderModel?: (model: string | null | undefined) => void;
};

export type EmpiricalCaseWorkspaceFactory = (
  testCase: EmpiricalCorpusCase,
  timeoutMs: number,
  signal: AbortSignal,
) => Promise<EmpiricalCaseWorkspace>;

export type EmpiricalCaseReview = (
  input: EmpiricalCaseReviewInput,
) => Promise<CodeReviewResult>;

export function selectEmpiricalJsonMode(
  model: OpenRouterFreeModel | undefined,
  formatSupport: DynamicModelFormatSupport | null,
): {
  mode: "native_json_schema" | "native_json_object" | "prompt_only_json";
  promptOnlyJson: boolean;
  jsonObjectOnly: boolean;
} {
  if (!model?.capabilities.includes("coding")) {
    throw new Error("Exact empirical OpenRouter model is not registered for code review.");
  }
  // OpenRouter's `structured_outputs` flag may still route to a provider that
  // implements only JSON-object mode. Prefer its explicit response_format
  // capability; use schema mode only when object mode is not advertised.
  if (formatSupport?.supportsJsonObject === true) {
    return { mode: "native_json_object", promptOnlyJson: false, jsonObjectOnly: true };
  }
  if (formatSupport?.supportsJsonSchema === true) {
    return { mode: "native_json_schema", promptOnlyJson: false, jsonObjectOnly: false };
  }
  if (model.supportsPromptOnlyJson) {
    return { mode: "prompt_only_json", promptOnlyJson: true, jsonObjectOnly: false };
  }
  throw new Error("Exact empirical OpenRouter model has no verified JSON output mode.");
}

export type ApiEmpiricalQualityCampaignOptions = {
  corpus: EmpiricalQualityCorpus;
  provider: ProviderId;
  apiKey: string;
  model?: string;
  resumeFrom?: EmpiricalQualityScorecard;
  /** Required to resume campaigns using a custom injected reviewer. */
  reviewContractRevision?: string;
  caseTimeoutMs?: number;
  campaignTimeoutMs?: number;
  generatedAt?: string;
  onProgress?: (scorecard: EmpiricalQualityScorecard) => void | Promise<void>;
  workspaceFactory?: EmpiricalCaseWorkspaceFactory;
  reviewCase?: EmpiricalCaseReview;
};

function createResumeBinding(args: {
  corpus: EmpiricalQualityCorpus;
  provider: ProviderId;
  model: string | null;
  structuredOutputMode: EmpiricalQualityScorecard["structuredOutputMode"];
  caseTimeoutMs: number;
  reviewerRevision: string;
}): EmpiricalQualityResumeBinding {
  const corpusSha256 = createHash("sha256").update(JSON.stringify(args.corpus)).digest("hex");
  const evaluatorRevision =
    `${EMPIRICAL_QUALITY_EVALUATOR_REVISION}:timeout-${args.caseTimeoutMs}:review-${args.reviewerRevision}`;
  const fingerprint = createHash("sha256").update(JSON.stringify({
    corpusSha256,
    evaluatorRevision,
    provider: args.provider,
    model: args.model,
    structuredOutputMode: args.structuredOutputMode,
  })).digest("hex");
  return { corpusSha256, evaluatorRevision, fingerprint };
}

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
  providerModel?: string,
): Omit<EmpiricalCaseObservation, "caseId"> {
  const incomplete = Boolean(result._parseError || result._qualityError);
  const contractFailureCode = result._parseError?.code ?? result._qualityError?.code;
  const observedFindings = incomplete
    ? []
    : result.issues.map((issue) => {
        const file = typeof issue.file === "string" ? issue.file.trim() : "";
        const citationValid = testCase.selectedFiles.includes(file);
        return {
          file,
          ...(typeof issue.lineStart === "number" ? { lineStart: issue.lineStart } : {}),
          ...(typeof issue.lineEnd === "number" ? { lineEnd: issue.lineEnd } : {}),
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
    ...(providerModel ? { providerModel } : {}),
    normalization: { droppedCitation },
    latencyMs,
    ...(incomplete ? { errorCode: contractFailureCode ?? "EXECUTION_ERROR" } : {}),
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
  let promptOnlyJson = false;
  let jsonObjectOnly = false;
  if (input.provider === "openrouter" && input.model) {
    const model = FREE_MODELS.find((candidate) => candidate.id === input.model);
    const liveModelIds = getUsableDynamicModelIds();
    const formatSupport = getUsableDynamicModelFormatSupport(input.model);
    if (!liveModelIds?.has(input.model)) {
      throw new Error("Exact empirical OpenRouter model is not a currently free, registered code-review model.");
    }
    const selectedMode = selectEmpiricalJsonMode(model, formatSupport);
    promptOnlyJson = selectedMode.promptOnlyJson;
    jsonObjectOnly = selectedMode.jsonObjectOnly;
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
  const runReview = (repairAttempt: boolean, priorParseError?: unknown) => {
    const priorModelOutput =
      typeof priorParseError === "object" &&
      priorParseError !== null &&
      "raw" in priorParseError &&
      typeof priorParseError.raw === "string"
        ? priorParseError.raw.slice(0, 16_000)
        : undefined;
    const priorParseErrorMessage =
      typeof priorParseError === "object" &&
      priorParseError !== null &&
      "message" in priorParseError &&
      typeof priorParseError.message === "string"
        ? priorParseError.message.replace(/\s+/g, " ").trim().slice(0, 240)
        : undefined;
    return reviewCode(
      context,
      input.fileContents,
      {
      provider: input.provider,
      apiKey: input.apiKey,
      signal: input.signal,
      timeoutMs: input.timeoutMs,
      maxFallbackModels: 1,
      stopAfterFirstModelAttempt: true,
      retryTransient: false,
      qualityProfile: "code_review",
       maxTokens: input.maxTokens,
       onModelAttempt: ({ model }) => input.onProviderModel?.(model),
      },
      {
        requireSelectedFileFinding: input.testCase.outcome === "defect",
        repairAttempt,
        promptOnlyJson,
        jsonObjectOnly,
        empiricalStrictEvidence: true,
        priorModelOutput,
        priorParseErrorMessage,
      },
    );
  };
  if (input.provider === "openrouter" && input.model) {
    return reviewWithOneSameModelJsonRepair(runReview);
  }
  return runReview(false);
};

const defaultWorkspaceFactory: EmpiricalCaseWorkspaceFactory = cloneReviewedRepository;

export async function runApiEmpiricalQualityCampaign(
  options: ApiEmpiricalQualityCampaignOptions,
): Promise<EmpiricalQualityScorecard> {
  const corpus = validateEmpiricalQualityCorpus(options.corpus);
  const registeredModel = options.provider === "openrouter" && options.model
    ? FREE_MODELS.find((candidate) => candidate.id === options.model)
    : undefined;
  const caseTimeoutMs = options.caseTimeoutMs ?? 90_000;
  const workspaceFactory = options.workspaceFactory ?? defaultWorkspaceFactory;
  const review = options.reviewCase ?? defaultReviewCase;

  if (!isProvider(options.provider)) throw new Error("Unsupported empirical quality provider.");
  if (!options.apiKey.trim()) throw new Error("An API key is required for the empirical quality campaign.");
  if (options.resumeFrom && review !== defaultReviewCase && !options.reviewContractRevision?.trim()) {
    throw new Error("Resuming a custom reviewer requires an explicit review contract revision.");
  }
  if (!Number.isInteger(caseTimeoutMs) || caseTimeoutMs < 1_000) {
    throw new Error("Empirical quality case timeout must be at least 1000ms.");
  }
  if (options.campaignTimeoutMs !== undefined &&
      (!Number.isInteger(options.campaignTimeoutMs) || options.campaignTimeoutMs < caseTimeoutMs)) {
    throw new Error("Empirical quality campaign timeout must cover at least one case timeout.");
  }

  let structuredOutputMode: EmpiricalQualityScorecard["structuredOutputMode"] = "provider_default";
  if (options.provider === "openrouter" && options.model && review === defaultReviewCase) {
    await refreshDynamicCatalog(options.apiKey);
    const liveModelIds = getUsableDynamicModelIds();
    const formatSupport = getUsableDynamicModelFormatSupport(options.model);
    if (!liveModelIds?.has(options.model)) {
      throw new Error("Exact empirical OpenRouter model is not a currently free, registered code-review model.");
    }
    structuredOutputMode = selectEmpiricalJsonMode(registeredModel, formatSupport).mode;
  } else if (registeredModel?.supportsPromptOnlyJson && !registeredModel.supportsJson) {
    structuredOutputMode = "prompt_only_json";
  } else if (registeredModel?.supportsJson) {
    structuredOutputMode = "native_json_object";
  }

  const resumeBinding = createResumeBinding({
    corpus,
    provider: options.provider,
    model: options.model ?? null,
    structuredOutputMode,
    caseTimeoutMs,
    reviewerRevision: review === defaultReviewCase
      ? "default-reviewer"
      : options.reviewContractRevision?.trim() ?? "unversioned-injected-reviewer",
  });
  const scorecard = await runEmpiricalQualityCampaign({
    corpus,
    provider: options.provider,
    model: options.model ?? null,
    structuredOutputMode,
    resumeBinding,
    resumeFrom: options.resumeFrom,
    caseTimeoutMs,
    campaignTimeoutMs: options.campaignTimeoutMs,
    generatedAt: options.generatedAt,
    onProgress: options.onProgress,
    executeCase: async (testCase, signal) => {
      const startedAt = Date.now();
      let workspace: EmpiricalCaseWorkspace | undefined;
      let providerModel: string | undefined;
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
          maxTokens: registeredModel?.capabilities.includes("reasoning") ? 8_192 : undefined,
          timeoutMs: Math.max(1, caseTimeoutMs - (Date.now() - startedAt) - 1_000),
          signal,
          onProviderModel: (model) => {
            if (model) providerModel = model;
          },
        });
        console.info(JSON.stringify({
          scope: "empirical-quality",
          action: "safe_finding_diagnostics",
          caseId: testCase.id,
          verdict: result.verdict,
          findings: result.issues.map((issue) => {
            const file = typeof issue.file === "string" && testCase.selectedFiles.includes(issue.file.trim())
              ? issue.file.trim()
              : null;
            return {
              file,
              lineStart: Number.isInteger(issue.lineStart) ? issue.lineStart : null,
              lineEnd: Number.isInteger(issue.lineEnd) ? issue.lineEnd : null,
              type: issue.type,
              severity: issue.severity,
            };
          }),
        }));
        return projectReviewObservation(testCase, result, Date.now() - startedAt, providerModel);
      } catch (error) {
        const errorCode = classifyProviderError(error);
        console.warn(JSON.stringify({
          scope: "empirical-quality",
          action: "case_execution_failed",
          caseId: testCase.id,
          errorCode,
          errorKind: error instanceof Error ? error.name : typeof error,
          ...(error instanceof GroqClientError ? { providerErrorCode: error.code } : {}),
        }));
        const providerRateLimitScope =
          error instanceof GroqClientError &&
          (error.rateLimitScope === "upstream_shared_pool" ||
            error.rateLimitScope === "provider_credential")
            ? error.rateLimitScope
            : undefined;
        return {
          outcome: errorCode === "TIMEOUT" ? "TIMEOUT" : errorCode === "PROVIDER_UNAVAILABLE" ? "PROVIDER_UNAVAILABLE" : "ERROR",
          contractPassed: false,
          qualityGateAccepted: false,
          semanticVerdict: "unknown",
          observedFindings: [],
          errorCode,
          ...(providerRateLimitScope ? { providerRateLimitScope } : {}),
          ...(error instanceof GroqClientError && error.providerModel
            ? { providerModel: error.providerModel }
            : {}),
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

export async function loadEmpiricalQualityResumeScorecard(filePath: string): Promise<EmpiricalQualityScorecard> {
  const inputPath = path.resolve(filePath);
  const disposableRoot = path.resolve(HOST_DISPOSABLE_TEMP_ROOT);
  const relative = path.relative(disposableRoot, inputPath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Resume scorecard must be inside the host disposable temp root.");
  }
  const parsed: unknown = JSON.parse(await fs.readFile(inputPath, "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Resume scorecard is malformed.");
  }
  return parsed as EmpiricalQualityScorecard;
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
  const persistCheckpoint = async (scorecard: EmpiricalQualityScorecard): Promise<void> => {
    await writeEmpiricalQualityScorecard(outputPath, scorecard);
  };
  const scorecard = await runApiEmpiricalQualityCampaign({
    corpus: await loadEmpiricalQualityCorpus(corpusPath),
    provider,
    apiKey,
    model: process.env.EMPIRICAL_QUALITY_MODEL?.trim() || undefined,
    ...(process.env.EMPIRICAL_QUALITY_RESUME_SCORECARD_PATH?.trim()
      ? { resumeFrom: await loadEmpiricalQualityResumeScorecard(process.env.EMPIRICAL_QUALITY_RESUME_SCORECARD_PATH.trim()) }
      : {}),
    ...timeouts,
    onProgress: persistCheckpoint,
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