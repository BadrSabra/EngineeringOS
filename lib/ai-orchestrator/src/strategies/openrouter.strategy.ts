/**
 * OpenRouter provider strategy.
 *
 * Wraps `openrouterCompleteWithFallback` and `openrouterCompleteStream` from
 * openai-compatible-client.ts behind the `ProviderStrategy` interface.
 *
 * PR-01: refreshes the dynamic model catalog before each call so stale model
 * IDs are filtered out of the fallback chain as soon as they disappear.
 *
 * Provider-wide circuit breaking is intentionally disabled. Rate limits and
 * temporary failures remain scoped to the model or credential at the client
 * boundary; the compatibility circuit exports do not block requests.
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
import { assertOpenRouterFreeModel } from "../openrouter/free-model-policy.js";
import { GroqClientError, safeErrorTag } from "../errors.js";
import { refreshDynamicCatalog } from "../openrouter/dynamic-catalog.js";
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

export const openrouterStrategy: ProviderStrategy = {
  providerId: "openrouter",
  supportsNativeStream: false,
  ownsModelFallback: true,

  // Refresh the catalog before resolving a free model for this request.
  async call(messages: RawMessage[], opts: StrategyCallOptions): ReturnType<ProviderStrategy["call"]> {
    if (!opts.apiKey) {
      throw new GroqClientError(
        "INVALID_CONFIG",
        "OpenRouter requires an API key — save one in the AI settings panel",
      );
    }
    const configuredModel = process.env.OPENROUTER_MODEL?.trim();
    if (configuredModel) assertOpenRouterFreeModel(configuredModel);

    console.info(
      JSON.stringify({
        scope: "openrouter-strategy",
        action: "pre_call",
        provider: "openrouter",
        model: opts.model,
        maxFallbackModels: opts.maxFallbackModels ?? null,
        hasTools: Array.isArray(opts.tools) && opts.tools.length > 0,
        toolCount: Array.isArray(opts.tools) ? opts.tools.length : 0,
      }),
    );

    try {
      // Bound catalog I/O before model resolution. A caller may stop waiting
      // without cancelling the shared refresh used by other requests.
      await refreshDynamicCatalog(opts.apiKey, opts.signal);
      // Model selection can happen just before the request-scoped refresh. If
      // that refresh replaces the snapshot and removes the pinned model,
      // resolve a fresh compatible chain rather than rejecting the whole turn.
      const pinnedModelIsCurrent = opts.model
        ? (opts.capability
          ? isCatalogFreeModelForCapability(opts.model, {
              capability: opts.capability,
              requireTools: Boolean(opts.tools?.length),
              requireLiveCatalog: true,
            })
          : isCatalogFreeModel(opts.model, { requireLiveCatalog: true }))
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
      const result = await openrouterCompleteWithFallback(messages, {
        ...requestOpts,
        apiKey: opts.apiKey,
      });
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
      const failedModel =
        err instanceof GroqClientError && err.providerModel
          ? err.providerModel
          : opts.model;
      console.warn(
        JSON.stringify({
          scope: "openrouter-strategy",
          action: opts.signal?.aborted ? "call_cancelled" : "call_failure",
          provider: "openrouter",
          requestedModel: opts.model,
          failedModel,
          attemptedModels:
            err instanceof GroqClientError ? err.providerAttemptedModels ?? [failedModel] : [failedModel],
          errorCode: err instanceof GroqClientError ? err.code : "UNKNOWN",
          errorType: safeErrorTag(err),
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
    const configuredModel = process.env.OPENROUTER_MODEL?.trim();
    if (configuredModel) assertOpenRouterFreeModel(configuredModel);

    console.info(
      JSON.stringify({
        scope: "openrouter-strategy",
        action: "pre_stream",
        provider: "openrouter",
        model: opts.model,
      }),
    );

    try {
      await refreshDynamicCatalog(opts.apiKey, opts.signal);
      const pinnedModelIsCurrent = opts.model
        ? (opts.capability
          ? isCatalogFreeModelForCapability(opts.model, {
              capability: opts.capability,
              requireLiveCatalog: true,
            })
          : isCatalogFreeModel(opts.model, { requireLiveCatalog: true }))
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
      console.info(
        JSON.stringify({
          scope: "openrouter-strategy",
          action: "stream_success",
          provider: "openrouter",
          model: opts.model,
        }),
      );
    } catch (err) {
      console.warn(
        JSON.stringify({
          scope: "openrouter-strategy",
          action: opts.signal?.aborted ? "stream_cancelled" : "stream_failure",
          provider: "openrouter",
          model: opts.model,
          errorCode: err instanceof GroqClientError ? err.code : "UNKNOWN",
          errorType: safeErrorTag(err),
        }),
      );
      throw err;
    }
  },
};
