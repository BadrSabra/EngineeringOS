/**
 * OpenRouter provider strategy.
 *
 * Wraps `openrouterCompleteWithFallback` and `openrouterCompleteStream` from
 * openai-compatible-client.ts behind the `ProviderStrategy` interface.
 *
 * PR-01: refreshes the dynamic model catalog before each call so stale model
 * IDs are filtered out of the fallback chain as soon as they disappear.
 *
 * PR-07: integrates the circuit breaker — checks before attempting a call,
 * records success/failure so the circuit opens after repeated failures and
 * re-enables after the cooldown.
 *
 * `supportsNativeStream: false` — OpenRouter free-tier models often
 * include the final answer in the non-streaming tool-loop response, so the
 * agent re-emits that content word-by-word instead of making a second SSE
 * call (which is slow and unreliable on free tiers).
 */
import {
  openrouterCompleteWithFallback,
  openrouterCompleteStream,
} from "../openai-compatible-client.js";
import { GroqClientError } from "../errors.js";
import { refreshDynamicCatalog } from "../openrouter/dynamic-catalog.js";
import {
  isCircuitOpen,
  recordCircuitFailure,
  recordCircuitSuccess,
} from "../openrouter/circuit-breaker.js";
import {
  isCatalogFreeModel,
  isCatalogFreeModelForCapability,
} from "../openrouter/model-resolver.js";
import type { RawMessage } from "../groq-client.js";
import type {
  ProviderStrategy,
  StrategyCallOptions,
  StrategyStreamOptions,
} from "../provider-strategy.js";

/**
 * Circuit state represents provider health, not request-local configuration.
 * A pinned model that cannot satisfy the requested capability is deterministic
 * and must not suppress otherwise healthy OpenRouter candidates for later
 * requests.
 */
export function shouldRecordCircuitFailure(error: unknown): boolean {
  if (!(error instanceof GroqClientError)) return true;
  return !(
    error.code === "INVALID_CONFIG" ||
    error.providerCode === "MODEL_CAPABILITY_MISMATCH" ||
    // These are model/contract failures. A healthy OpenRouter endpoint can
    // return either when one free-tier candidate cannot honor this request.
    error.code === "EMPTY_RESPONSE" ||
    error.code === "INVALID_TOOL_CALL"
  );
}

export const openrouterStrategy: ProviderStrategy = {
  providerId: "openrouter",
  supportsNativeStream: false,
  ownsModelFallback: true,

  // PR-01 + PR-07: refresh catalog (fire-and-forget), check circuit, record outcome.
  async call(messages: RawMessage[], opts: StrategyCallOptions): ReturnType<ProviderStrategy["call"]> {
    if (!opts.apiKey) {
      throw new GroqClientError(
        "INVALID_CONFIG",
        "OpenRouter requires an API key — save one in the AI settings panel",
      );
    }

    // PR-07: reject immediately when circuit is open (cooldown not elapsed).
    if (isCircuitOpen("openrouter")) {
      console.warn(
        JSON.stringify({
          scope: "openrouter-strategy",
          action: "circuit_blocked",
          provider: "openrouter",
          mode: "call",
          hint: "circuit is open — skipping call",
        }),
      );
      throw new GroqClientError(
        "MODEL_NOT_FOUND",
        "OpenRouter is temporarily disabled — too many consecutive failures. It will be retried automatically after the cooldown.",
        { context: { providerCode: "CIRCUIT_OPEN" } },
      );
    }

    console.info(
      JSON.stringify({
        scope: "openrouter-strategy",
        action: "pre_call",
        provider: "openrouter",
        model: opts.model,
        hasTools: Array.isArray(opts.tools) && opts.tools.length > 0,
        toolCount: Array.isArray(opts.tools) ? opts.tools.length : 0,
      }),
    );

    // PR-01: refresh the live model catalog so stale IDs are filtered before
    // the fallback chain is built.  Fire-and-forget — the resolver uses the
    // previous snapshot if the refresh hasn't completed yet.
    await refreshDynamicCatalog(opts.apiKey);

    try {
      // Model selection can happen just before the request-scoped refresh. If
      // that refresh replaces the snapshot and removes the pinned model,
      // resolve a fresh compatible chain rather than rejecting the whole turn.
      const pinnedModelIsCurrent = opts.model
        ? (opts.capability
          ? isCatalogFreeModelForCapability(opts.model, {
              capability: opts.capability,
              requireTools: Boolean(opts.tools?.length),
            })
          : isCatalogFreeModel(opts.model))
        : true;
      const requestOpts = pinnedModelIsCurrent ? opts : { ...opts, model: undefined };
      if (!pinnedModelIsCurrent) {
        console.warn(
          JSON.stringify({
            scope: "openrouter-strategy",
            action: "re_resolve_stale_model",
            staleModel: opts.model,
            capability: opts.capability ?? "chat",
            catalog: "current_snapshot",
          }),
        );
      }
      const result = await openrouterCompleteWithFallback(messages, { ...requestOpts, apiKey: opts.apiKey });
      // PR-07: successful call closes any open circuit.
      recordCircuitSuccess("openrouter");
      console.info(
        JSON.stringify({
          scope: "openrouter-strategy",
          action: "call_success",
          provider: "openrouter",
          requestedModel: opts.model,
          actualModel: result.model,
          finishReason: result.finishReason ?? null,
        }),
      );
      return result;
    } catch (err) {
      // PR-07: record failure so the circuit opens after the threshold.
      if (shouldRecordCircuitFailure(err)) {
        recordCircuitFailure("openrouter");
      }
      const failedModel =
        err instanceof GroqClientError && err.providerModel
          ? err.providerModel
          : opts.model;
      console.warn(
        JSON.stringify({
          scope: "openrouter-strategy",
          action: "call_failure",
          provider: "openrouter",
          requestedModel: opts.model,
          failedModel,
          attemptedModels:
            err instanceof GroqClientError ? err.providerAttemptedModels ?? [failedModel] : [failedModel],
          errorCode: err instanceof GroqClientError ? err.code : "UNKNOWN",
          errorMessage: err instanceof Error ? err.message : String(err),
        }),
      );
      throw err;
    }
  },

  async *stream(messages: RawMessage[], opts: StrategyStreamOptions): AsyncGenerator<string> {
    if (!opts.apiKey) {
      throw new GroqClientError(
        "INVALID_CONFIG",
        "OpenRouter requires an API key — save one in the AI settings panel",
      );
    }

    // PR-07: same circuit check for streaming.
    if (isCircuitOpen("openrouter")) {
      console.warn(
        JSON.stringify({
          scope: "openrouter-strategy",
          action: "circuit_blocked",
          provider: "openrouter",
          mode: "stream",
          hint: "circuit is open — skipping stream",
        }),
      );
      throw new GroqClientError(
        "MODEL_NOT_FOUND",
        "OpenRouter is temporarily disabled — too many consecutive failures.",
        { context: { providerCode: "CIRCUIT_OPEN" } },
      );
    }

    console.info(
      JSON.stringify({
        scope: "openrouter-strategy",
        action: "pre_stream",
        provider: "openrouter",
        model: opts.model,
      }),
    );

    // PR-01: fire-and-forget catalog refresh.
    await refreshDynamicCatalog(opts.apiKey);

    try {
      const pinnedModelIsCurrent = opts.model
        ? (opts.capability
          ? isCatalogFreeModelForCapability(opts.model, { capability: opts.capability })
          : isCatalogFreeModel(opts.model))
        : true;
      const requestOpts = pinnedModelIsCurrent ? opts : { ...opts, model: undefined };
      if (!pinnedModelIsCurrent) {
        console.warn(
          JSON.stringify({
            scope: "openrouter-strategy",
            action: "re_resolve_stale_stream_model",
            staleModel: opts.model,
            capability: opts.capability ?? "chat",
            catalog: "current_snapshot",
          }),
        );
      }
      yield* openrouterCompleteStream(messages, { ...requestOpts, apiKey: opts.apiKey });
      recordCircuitSuccess("openrouter");
      console.info(
        JSON.stringify({
          scope: "openrouter-strategy",
          action: "stream_success",
          provider: "openrouter",
          model: opts.model,
        }),
      );
    } catch (err) {
      if (shouldRecordCircuitFailure(err)) {
        recordCircuitFailure("openrouter");
      }
      console.warn(
        JSON.stringify({
          scope: "openrouter-strategy",
          action: "stream_failure",
          provider: "openrouter",
          model: opts.model,
          errorCode: err instanceof GroqClientError ? err.code : "UNKNOWN",
          errorMessage: err instanceof Error ? err.message : String(err),
        }),
      );
      throw err;
    }
  },
};
