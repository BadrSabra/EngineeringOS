/**
 * Credential-gated structured-review campaign.
 *
 * This is deliberately separate from the provider-free release fixtures. It
 * exercises one real provider/model against a temporary review workspace and
 * persists only the redacted campaign receipt.
 */
import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  buildCodeReviewCampaignReceipt,
  CODE_REVIEW_CAMPAIGN_SCENARIOS,
  getDynamicCatalogStatus,
  getUsableDynamicModelFormatSupport,
  getUsableDynamicModelIds,
  resolveFreeModelOverride,
  refreshDynamicCatalog,
  reviewCode,
  type CodeReviewCampaignScenario,
  type ProviderId,
} from "@workspace/ai-orchestrator";
import { createHostDisposableTempDirectory } from "./disposable-temp.js";
import {
  createLiveProviderReviewIsolatedPersistence,
  isDisposableLiveReviewDatabaseUrl,
} from "./live-provider-review-isolated-persistence.js";

const providerKeys: Record<ProviderId, string> = {
  openrouter: "OPENROUTER_API_KEY",
  gemini: "GEMINI_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  groq: "GROQ_API_KEY",
};

const scenario = process.env.LIVE_REVIEW_SCENARIO?.trim() as CodeReviewCampaignScenario | undefined;
const provider = (process.env.LIVE_REVIEW_PROVIDER?.trim() || "openrouter") as ProviderId;
const projectId = process.env.LIVE_REVIEW_PROJECT_ID?.trim();
const outputPath = process.env.LIVE_REVIEW_OUTPUT_PATH?.trim();
const selectedFile = "src/provider-review-fixture.ts";
const runState = {
  startedAt: Date.now(),
  projectRevision: "runtime-failure",
  observedModels: [] as string[],
  fallbackReason: undefined as string | undefined,
  requestedModel: undefined as string | undefined,
  modelCatalogSnapshot: undefined as {
    checkedAt: string;
    freeModelSetHash: string;
    requestedModelListed: boolean;
    requestedModelStaticEligible: boolean;
    requestedModelSupportsJsonSchema: boolean | null;
  } | undefined,
};
// The campaign must exercise accepted selected-file evidence, not merely prove
// that a model can return an empty clean-review result. Keep one obvious,
// bounded defect in the disposable fixture so a valid review has a concrete
// finding to cite.
const fixtureContents = [
  "export function buildUserLookup(name: string): string {",
  '  return "SELECT * FROM users WHERE name = \'" + name + "\'";',
  "}",
  "",
].join("\n");

function isScenario(value: string | undefined): value is CodeReviewCampaignScenario {
  return Boolean(value && (CODE_REVIEW_CAMPAIGN_SCENARIOS as readonly string[]).includes(value));
}

function isProvider(value: string): value is ProviderId {
  return Object.hasOwn(providerKeys, value);
}

function requireCampaignConfiguration(): {
  scenario: CodeReviewCampaignScenario;
  provider: ProviderId;
  projectId: string;
  outputPath: string;
} {
  if (process.env.RUN_LIVE_PROVIDER_REVIEW_CAMPAIGN !== "1") {
    throw new Error("Live provider review campaign is opt-in.");
  }
  if (process.env.LIVE_REVIEW_DISPOSABLE !== "1") {
    throw new Error("Live provider review campaign requires LIVE_REVIEW_DISPOSABLE=1.");
  }
  if (!isScenario(scenario)) {
    throw new Error(
      `LIVE_REVIEW_SCENARIO must be one of ${CODE_REVIEW_CAMPAIGN_SCENARIOS.join(", ")}.`,
    );
  }
  if (!isProvider(provider)) {
    throw new Error("LIVE_REVIEW_PROVIDER must identify a supported provider.");
  }
  if (!projectId) {
    throw new Error("LIVE_REVIEW_PROJECT_ID must identify the disposable project.");
  }
  if (
    !isDisposableLiveReviewDatabaseUrl(
      process.env.DATABASE_URL,
      process.env.LIVE_REVIEW_DATABASE_DISPOSABLE,
    )
  ) {
    throw new Error("LIVE_REVIEW_DATABASE_NOT_DISPOSABLE");
  }
  if (!outputPath) {
    throw new Error("LIVE_REVIEW_OUTPUT_PATH is required so campaign output is explicit.");
  }
  const configuredModel = process.env.LIVE_REVIEW_MODEL?.trim();
  if (
    scenario === "structured-review"
    && provider === "openrouter"
    && !configuredModel?.endsWith(":free")
  ) {
    throw new Error("Structured OpenRouter review requires one explicitly pinned :free model.");
  }
  if (
    scenario === "structured-review"
    && provider === "openrouter"
    && (
      process.env.OPENROUTER_ALLOW_PAID_FALLBACK?.trim() === "1"
      || process.env.OPENROUTER_PAID_MODEL?.trim()
      || process.env.OPENROUTER_PAID_MODEL_CAPABILITIES?.trim()
    )
  ) {
    throw new Error("Structured OpenRouter review is free-only and rejects paid fallback configuration.");
  }
  const apiKey = process.env[providerKeys[provider]]?.trim();
  if (!apiKey) {
    throw new Error(`Provider configuration is missing ${providerKeys[provider]}.`);
  }
  return {
    scenario,
    provider,
    projectId,
    outputPath,
  };
}

function attemptedModelsFrom(error: unknown): string[] {
  if (!error || typeof error !== "object") return [];
  const models = (error as { providerAttemptedModels?: unknown }).providerAttemptedModels;
  return Array.isArray(models) ? models.filter((model): model is string => typeof model === "string") : [];
}

async function main(): Promise<void> {
  const configuration = requireCampaignConfiguration();
  const {
    scenario: campaignScenario,
    provider: campaignProvider,
    projectId: campaignProjectId,
    outputPath: campaignOutputPath,
  } = configuration;
  const configuredModel = process.env.LIVE_REVIEW_MODEL?.trim();
  const requestedModel = campaignProvider === "openrouter" ? configuredModel : undefined;
  runState.requestedModel = requestedModel;
  if (requestedModel) {
    const apiKey = process.env[providerKeys[campaignProvider]]?.trim();
    if (!apiKey) throw new Error("provider_key_missing");
    await refreshDynamicCatalog(apiKey);
    const catalogStatus = getDynamicCatalogStatus();
    const currentFreeIds = getUsableDynamicModelIds();
    if (!catalogStatus.usable || !currentFreeIds) {
      throw new Error("current_free_catalog_unavailable");
    }
    const formatSupport = getUsableDynamicModelFormatSupport(requestedModel);
    let requestedModelStaticEligible = false;
    try {
      resolveFreeModelOverride(requestedModel, {
        capability: "json",
        requireJson: true,
        requireJsonSchema: true,
      });
      requestedModelStaticEligible = true;
    } catch {
      // A dynamic catalog entry is not enough: execution must also accept the
      // exact ID through the current server-owned free-model allowlist.
    }
    const modelCatalogSnapshot = {
      checkedAt: new Date().toISOString(),
      freeModelSetHash: createHash("sha256")
        .update([...currentFreeIds].sort().join("\n"))
        .digest("hex")
        .slice(0, 16),
      requestedModelListed: currentFreeIds.has(requestedModel),
      requestedModelStaticEligible,
      requestedModelSupportsJsonSchema: formatSupport?.supportsJsonSchema ?? null,
    };
    runState.modelCatalogSnapshot = modelCatalogSnapshot;
    if (!modelCatalogSnapshot.requestedModelListed) {
      throw new Error("requested_model_not_in_current_free_catalog");
    }
    if (!modelCatalogSnapshot.requestedModelStaticEligible) {
      throw new Error("requested_model_not_in_static_free_allowlist");
    }
    if (modelCatalogSnapshot.requestedModelSupportsJsonSchema !== true) {
      throw new Error("requested_model_json_schema_capability_not_verified");
    }
  }
  const rootPath = await createHostDisposableTempDirectory("engineeringos-live-review-");
  try {
    await fs.mkdir(path.dirname(path.join(rootPath, selectedFile)), { recursive: true });
    await fs.writeFile(path.join(rootPath, selectedFile), fixtureContents, "utf8");

    // The revision is a digest of the disposable fixture, not a path or source
    // body. It lets an audit distinguish runs without retaining source text.
    const projectRevision = createHash("sha256").update(fixtureContents).digest("hex").slice(0, 16);
    runState.projectRevision = projectRevision;
    if (requestedModel) {
      // OpenRouter's existing resolver validates this override against the
      // current free catalog before making a request.
      process.env.OPENROUTER_MODEL = requestedModel;
    }

    let result: Awaited<ReturnType<typeof reviewCode>> | undefined;
    let error: unknown;
    try {
      const isolatedPersistence = createLiveProviderReviewIsolatedPersistence();
      result = await reviewCode(
        {
          project: "Disposable structured-review provider campaign",
          recentTasks: "No task history is injected.",
          latestMetrics: "No metrics are injected.",
          graphSummary: "No graph entities are injected.",
          recentEvents: "No events are injected.",
          workflows: "The campaign is isolated and read-only.",
          metricsVerified: false,
        },
        { [selectedFile]: fixtureContents },
        {
          provider: campaignProvider,
          apiKey: process.env[providerKeys[campaignProvider]],
          maxFallbackModels: campaignProvider === "openrouter" && configuredModel ? 1 : 3,
          retryTransient: false,
          qualityProfile: "code_review",
          stopAfterFirstModelAttempt: campaignScenario === "structured-review",
          modelCooldownPersistence: isolatedPersistence.modelCooldownPersistence,
          credentialCooldownPersistence: isolatedPersistence.credentialCooldownPersistence,
          modelLaneCursorPersistence: isolatedPersistence.modelLaneCursorPersistence,
          onModelAttempt: (attempt) => {
            if (attempt.model) runState.observedModels.push(attempt.model);
          },
          onProviderFallback: (event) => {
            runState.fallbackReason = event.reason;
            // Record both sides of the transition before the next request is
            // made. A terminal paid-provider error may not reach onModelAttempt,
            // but the receipt must still show that the paid lane was actually
            // attempted.
            runState.observedModels.push(event.fromModel, event.toModel);
          },
        },
      );
    } catch (caught) {
      error = caught;
    }

    const receipt = buildCodeReviewCampaignReceipt({
      scenario: campaignScenario,
      provider: campaignProvider,
      operationId: randomUUID(),
      projectId: campaignProjectId,
      projectRevision,
      selectedFile,
      requestedModel,
      modelCatalogSnapshot: runState.modelCatalogSnapshot,
      result,
      error,
      attemptedModels: [
        ...runState.observedModels,
        ...attemptedModelsFrom(error),
      ],
      modelAttempts: [...new Set([
        ...runState.observedModels,
        ...attemptedModelsFrom(error),
      ])].map((model) => ({
        model,
        tier: model === process.env.OPENROUTER_PAID_MODEL?.trim()
          ? "paid" as const
          : model.endsWith(":free")
            ? "free" as const
            : "unknown" as const,
      })),
      fallbackReason: runState.fallbackReason,
      latencyMs: Date.now() - runState.startedAt,
    });

    await fs.mkdir(path.dirname(path.resolve(campaignOutputPath)), { recursive: true });
    await fs.writeFile(path.resolve(campaignOutputPath), `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
    // Only the bounded receipt summary is allowed on stdout. The wrapper also
    // discards child diagnostics so provider bodies cannot become artifacts.
    console.log(JSON.stringify({
      kind: receipt.kind,
      scenario: receipt.scenario,
      outcomeClass: receipt.outcomeClass,
      terminalStatus: receipt.terminalStatus,
      failureCode: receipt.failureCode ?? null,
      requestedModel: receipt.requestedModel ?? null,
      modelIdentityMatched: receipt.modelIdentityMatched ?? null,
      attemptedModels: receipt.attemptedModels,
      modelCatalogSnapshot: receipt.modelCatalogSnapshot ?? null,
      evidenceCount: receipt.evidence.length,
    }));
  } finally {
    await fs.rm(rootPath, { recursive: true, force: true });
  }
}

try {
  await main();
} catch (error) {
  try {
    const failureScenario = isScenario(scenario) ? scenario : "reasoning-only";
    const failureProvider = isProvider(provider) ? provider : "openrouter";
    const models = [
      ...runState.observedModels,
      ...attemptedModelsFrom(error),
    ];
    const receipt = buildCodeReviewCampaignReceipt({
      scenario: failureScenario,
      provider: failureProvider,
      operationId: randomUUID(),
      projectId: projectId ?? "campaign-runtime-failure",
      projectRevision: runState.projectRevision,
      selectedFile,
      requestedModel: runState.requestedModel,
      modelCatalogSnapshot: runState.modelCatalogSnapshot,
      error,
      attemptedModels: models,
      modelAttempts: [...new Set(models)].map((model) => ({
        model,
        tier: model.endsWith(":free") ? "free" as const : "unknown" as const,
      })),
      fallbackReason: runState.fallbackReason,
      latencyMs: Date.now() - runState.startedAt,
    });
    const output = {
      ...receipt,
      failureCode: receipt.failureCode ?? "CAMPAIGN_RUNTIME_FAILURE",
      recoveryAction: receipt.failureCode ? receipt.recoveryAction : "stop-safely",
    };
    const failureOutputPath = process.env.LIVE_REVIEW_OUTPUT_PATH?.trim();
    if (!failureOutputPath) throw new Error("output_missing");
    await fs.mkdir(path.dirname(path.resolve(failureOutputPath)), { recursive: true });
    await fs.writeFile(path.resolve(failureOutputPath), `${JSON.stringify(output, null, 2)}\n`, "utf8");
    console.error(JSON.stringify({
      kind: receipt.kind,
      status: "runtime_failure_receipt_written",
      failureCode: output.failureCode,
    }));
  } catch {
    console.error(JSON.stringify({
      kind: "code-review-provider-campaign-receipt",
      status: "runtime_failure_receipt_unavailable",
    }));
  }
  process.exitCode = 1;
}