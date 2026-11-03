import { GroqClientError } from "../errors.js";
import { FREE_MODELS } from "./model-catalog.js";

/**
 * First product boundary: only server-catalogued free OpenRouter models may
 * reach the inference transport. This static allowlist is not current-price
 * evidence; the send path separately requires a fresh live zero-price entry.
 * Environment variables and caller options cannot authorize a paid or unknown
 * model.
 */
export function assertOpenRouterFreeModel(model: string | undefined): asserts model is string {
  if (model && FREE_MODELS.some((candidate) => candidate.id === model)) return;
  throw new GroqClientError(
    "INVALID_CONFIG",
    "OpenRouter inference requires a server-catalogued free model.",
    {
      context: {
        providerName: "OpenRouter",
        providerModel: model,
        providerCode: "FREE_MODEL_REQUIRED",
      },
    },
  );
}
