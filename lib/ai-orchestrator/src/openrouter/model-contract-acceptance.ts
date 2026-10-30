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

export const MODEL_CONTRACT_ACCEPTANCE_CONFIG = {
  windowMs: 24 * 60 * 60 * 1_000,
  minSamples: 5,
  maxSamplesPerModelContract: 200,
} as const;

type ContractOutcome = "accepted" | "rejected";
type Sample = { at: number; outcome: ContractOutcome };

const samplesByKey = new Map<string, Sample[]>();

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
}
