/**
 * Process-local, advisory acceptance history for exact server-owned contracts.
 * It only ranks already-authorized free-model candidates; it is not proof,
 * provider-health state, or permission to retry a throttled request.
 */
export const MODEL_TASK_CONTRACTS = {
  PROJECT_QUERY_NO_TOOLS_SYNTHESIS: "project_query_no_tools_synthesis",
} as const;

export type ModelTaskContract =
  (typeof MODEL_TASK_CONTRACTS)[keyof typeof MODEL_TASK_CONTRACTS];

export const MODEL_TASK_OUTCOMES = ["accepted", "rejected", "empty"] as const;
export type ModelTaskOutcome = (typeof MODEL_TASK_OUTCOMES)[number];

export type ModelContractHydrationSample = {
  model: string | null;
  contract: string | null;
  outcome: string | null;
  occurredAt: Date | number | string;
};

export const MODEL_CONTRACT_ACCEPTANCE_CONFIG = {
  windowMs: 24 * 60 * 60 * 1_000,
  minSamples: 5,
  maxSamplesPerModelContract: 200,
} as const;

type ContractOutcome = "accepted" | "rejected";
type OutputOutcome = "content" | "empty";
type Sample = { at: number; outcome: ContractOutcome };
type OutputSample = { at: number; outcome: OutputOutcome };

const samplesByKey = new Map<string, Sample[]>();
const outputSamplesByKey = new Map<string, OutputSample[]>();

function keyFor(model: string, contract: ModelTaskContract): string {
  return JSON.stringify([contract, model.trim()]);
}

function prune(key: string, now: number): Sample[] {
  const cutoff = now - MODEL_CONTRACT_ACCEPTANCE_CONFIG.windowMs;
  const retained = (samplesByKey.get(key) ?? [])
    .filter((sample) => sample.at >= cutoff)
    .slice(-MODEL_CONTRACT_ACCEPTANCE_CONFIG.maxSamplesPerModelContract);
  if (retained.length === 0) samplesByKey.delete(key);
  else samplesByKey.set(key, retained);
  return retained;
}

function pruneOutputSamples(key: string, now: number): OutputSample[] {
  const cutoff = now - MODEL_CONTRACT_ACCEPTANCE_CONFIG.windowMs;
  const retained = (outputSamplesByKey.get(key) ?? [])
    .filter((sample) => sample.at >= cutoff)
    .slice(-MODEL_CONTRACT_ACCEPTANCE_CONFIG.maxSamplesPerModelContract);
  if (retained.length === 0) outputSamplesByKey.delete(key);
  else outputSamplesByKey.set(key, retained);
  return retained;
}

/** Record only a server-evaluated contract result, never a provider HTTP success. */
export function recordModelContractOutcome(
  model: string,
  contract: ModelTaskContract,
  outcome: ContractOutcome,
  at = Date.now(),
): void {
  const normalized = model.trim();
  if (!normalized) return;
  const key = keyFor(normalized, contract);
  const samples = prune(key, at);
  samples.push({ at, outcome });
  if (samples.length > MODEL_CONTRACT_ACCEPTANCE_CONFIG.maxSamplesPerModelContract) {
    samples.splice(0, samples.length - MODEL_CONTRACT_ACCEPTANCE_CONFIG.maxSamplesPerModelContract);
  }
  samplesByKey.set(key, samples);
}

/**
 * Record whether a contract-scoped provider attempt returned usable content.
 * This is deliberately separate from accepted/rejected task quality.
 */
export function recordModelContractOutput(
  model: string,
  contract: ModelTaskContract,
  outcome: OutputOutcome,
  at = Date.now(),
): void {
  const normalized = model.trim();
  if (!normalized) return;
  const key = keyFor(normalized, contract);
  const samples = pruneOutputSamples(key, at);
  samples.push({ at, outcome });
  if (samples.length > MODEL_CONTRACT_ACCEPTANCE_CONFIG.maxSamplesPerModelContract) {
    samples.splice(0, samples.length - MODEL_CONTRACT_ACCEPTANCE_CONFIG.maxSamplesPerModelContract);
  }
  outputSamplesByKey.set(key, samples);
}

/**
 * Hydrate advisory model-ranking samples from content-free durable telemetry.
 * Only known contracts, exact outcomes, and recent timestamps are accepted.
 */
export function hydrateModelContractSamples(
  samples: readonly ModelContractHydrationSample[],
  now = Date.now(),
): void {
  const allowedContracts = new Set<string>(Object.values(MODEL_TASK_CONTRACTS));
  const cutoff = now - MODEL_CONTRACT_ACCEPTANCE_CONFIG.windowMs;
  const normalized = samples
    .map((sample) => ({
      ...sample,
      model: sample.model?.trim() ?? "",
      at: sample.occurredAt instanceof Date
        ? sample.occurredAt.getTime()
        : typeof sample.occurredAt === "number"
          ? sample.occurredAt
          : Date.parse(sample.occurredAt),
    }))
    .filter((sample) =>
      sample.model.length > 0
      && sample.contract !== null
      && allowedContracts.has(sample.contract)
      && Number.isFinite(sample.at)
      && sample.at >= cutoff
      && sample.at <= now
      && (sample.outcome === "accepted"
        || sample.outcome === "rejected"
        || sample.outcome === "empty"),
    )
    .sort((left, right) => left.at - right.at);

  for (const sample of normalized) {
    const contract = sample.contract as ModelTaskContract;
    const outcome = sample.outcome as ModelTaskOutcome;
    if (outcome === "empty") {
      recordModelContractOutput(sample.model, contract, "empty", sample.at);
      continue;
    }
    recordModelContractOutput(sample.model, contract, "content", sample.at);
    recordModelContractOutcome(
      sample.model,
      contract,
      outcome,
      sample.at,
    );
  }
}

/**
 * Return a smoothed acceptance rate only after enough independently evaluated
 * outputs exist. Unknown/low-volume models remain neutral in the scheduler.
 */
export function getModelContractAcceptanceRate(
  model: string,
  contract: ModelTaskContract,
  now = Date.now(),
): number | null {
  const samples = prune(keyFor(model, contract), now);
  if (samples.length < MODEL_CONTRACT_ACCEPTANCE_CONFIG.minSamples) return null;
  const accepted = samples.filter((sample) => sample.outcome === "accepted").length;
  return (accepted + 1) / (samples.length + 2);
}

export function getModelContractAcceptanceWeight(
  model: string,
  contract: ModelTaskContract,
  now = Date.now(),
): number | null {
  const rate = getModelContractAcceptanceRate(model, contract, now);
  return rate === null ? null : Math.max(1, Math.min(5, Math.round(rate * 5)));
}

export function getModelContractAvailabilityWeight(
  model: string,
  contract: ModelTaskContract,
  now = Date.now(),
): number | null {
  const samples = pruneOutputSamples(keyFor(model, contract), now);
  if (samples.length < MODEL_CONTRACT_ACCEPTANCE_CONFIG.minSamples) return null;
  const content = samples.filter((sample) => sample.outcome === "content").length;
  const rate = (content + 1) / (samples.length + 2);
  return Math.max(1, Math.min(5, Math.round(rate * 5)));
}

/** Select one weighted slot; callers keep the remaining models as fallbacks. */
export function selectWeightedModelIndex(weights: readonly number[], cursor: number): number {
  const total = weights.reduce((sum, weight) => sum + Math.max(0, Math.floor(weight)), 0);
  if (total <= 0) return 0;
  let slot = ((Math.floor(cursor) % total) + total) % total;
  for (let index = 0; index < weights.length; index += 1) {
    const weight = Math.max(0, Math.floor(weights[index]!));
    if (slot < weight) return index;
    slot -= weight;
  }
  return 0;
}

export function _resetModelContractAcceptanceForTest(): void {
  samplesByKey.clear();
  outputSamplesByKey.clear();
}
