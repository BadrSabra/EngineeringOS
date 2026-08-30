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
  reviewCode,
  type CodeReviewCampaignScenario,
  type ProviderId,
} from "@workspace/ai-orchestrator";
import { createHostDisposableTempDirectory } from "./disposable-temp.js";

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
const fixtureContents = "export function normalize(input: string) { return input.trim(); }\n";

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
  if (!outputPath) {
    throw new Error("LIVE_REVIEW_OUTPUT_PATH is required so campaign output is explicit.");
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
  const rootPath = await createHostDisposableTempDirectory("engineeringos-live-review-");
  try {
    await fs.mkdir(path.dirname(path.join(rootPath, selectedFile)), { recursive: true });
    await fs.writeFile(path.join(rootPath, selectedFile), fixtureContents, "utf8");

    // The revision is a digest of the disposable fixture, not a path or source
    // body. It lets an audit distinguish runs without retaining source text.
    const projectRevision = createHash("sha256").update(fixtureContents).digest("hex").slice(0, 16);
    const configuredModel = process.env.LIVE_REVIEW_MODEL?.trim();
    if (campaignProvider === "openrouter" && configuredModel) {
      // OpenRouter's existing resolver validates this override against the
      // current free catalog before making a request.
      process.env.OPENROUTER_MODEL = configuredModel;
    }

    let result: Awaited<ReturnType<typeof reviewCode>> | undefined;
    let error: unknown;
    try {
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
          apiKey: process.env[providerKeys[provider]],
          maxFallbackModels: 3,
          retryTransient: false,
          qualityProfile: "code_review",
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
      result,
      error,
      attemptedModels: [
        ...(configuredModel ? [configuredModel] : []),
        ...attemptedModelsFrom(error),
      ],
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
      evidenceCount: receipt.evidence.length,
    }));
  } finally {
    await fs.rm(rootPath, { recursive: true, force: true });
  }
}

await main();