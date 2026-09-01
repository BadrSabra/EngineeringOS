import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  buildEmpiricalQualityScorecard,
  scoreEmpiricalQualityCase,
  validateEmpiricalQualityCorpus,
  type EmpiricalCaseObservation,
} from "./empirical-quality.js";

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(path.resolve(filePath), "utf8")) as unknown;
}

function isObservation(value: unknown): value is EmpiricalCaseObservation {
  if (!value || typeof value !== "object") return false;
  const observation = value as Partial<EmpiricalCaseObservation>;
  return typeof observation.caseId === "string"
    && ["COMPLETE", "PROVIDER_UNAVAILABLE", "TIMEOUT", "ERROR"].includes(String(observation.outcome))
    && typeof observation.contractPassed === "boolean"
    && typeof observation.qualityGateAccepted === "boolean"
    && ["findings", "clean", "blocked", "unknown"].includes(String(observation.semanticVerdict))
    && Array.isArray(observation.observedFindings);
}

async function main(): Promise<void> {
  if (process.env.RUN_EMPIRICAL_QUALITY_CAMPAIGN !== "1") {
    throw new Error("Empirical quality scoring is opt-in. Set RUN_EMPIRICAL_QUALITY_CAMPAIGN=1.");
  }
  const corpus = validateEmpiricalQualityCorpus(await readJson(requiredEnv("EMPIRICAL_QUALITY_CORPUS_PATH")));
  const observationsValue = await readJson(requiredEnv("EMPIRICAL_QUALITY_OBSERVATIONS_PATH"));
  if (!Array.isArray(observationsValue) || !observationsValue.every(isObservation)) {
    throw new Error("EMPIRICAL_QUALITY_OBSERVATIONS_PATH must contain bounded case observations.");
  }
  const observations = new Map(observationsValue.map((observation) => [observation.caseId, observation]));
  const results = corpus.cases.map((testCase) => {
    const observation = observations.get(testCase.id);
    return scoreEmpiricalQualityCase(testCase, observation ?? {
      caseId: testCase.id,
      outcome: "ERROR",
      contractPassed: false,
      qualityGateAccepted: false,
      semanticVerdict: "unknown",
      observedFindings: [],
      errorCode: "EXECUTION_ERROR",
    });
  });
  const scorecard = buildEmpiricalQualityScorecard({
    corpus,
    results,
    provider: process.env.EMPIRICAL_QUALITY_PROVIDER ?? "unknown",
    model: process.env.EMPIRICAL_QUALITY_MODEL ?? null,
  });
  const outputPath = path.resolve(process.env.EMPIRICAL_QUALITY_SCORECARD_PATH ??
    path.join(process.cwd(), "benchmark-results/empirical-quality-scorecard.json"));
  const temporaryPath = `${outputPath}.tmp-${process.pid}`;
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(temporaryPath, `${JSON.stringify(scorecard, null, 2)}\n`, "utf8");
  await fs.rename(temporaryPath, outputPath);
  console.log(JSON.stringify({
    kind: scorecard.kind,
    status: scorecard.status,
    empiricalQualityStatus: scorecard.empiricalQualityStatus,
    corpusRevision: scorecard.corpusRevision,
    provider: scorecard.provider,
    completedCases: scorecard.metrics.completedCases,
    incompleteCases: scorecard.metrics.incompleteCases,
    outputPath,
  }));
  if (scorecard.status !== "COMPLETE") process.exitCode = 2;
}

await main();