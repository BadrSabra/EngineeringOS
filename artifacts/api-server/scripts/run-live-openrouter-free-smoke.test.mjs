import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeSmokeOptions,
  runOpenRouterFreeSmoke,
  runOpenRouterFreeSmokeCli,
} from "./run-live-openrouter-free-smoke.mjs";

const MODELS = [
  {
    id: "fixture/fast-a:free",
    free: true,
    supportsTools: true,
    capabilities: ["tool_calling"],
  },
  {
    id: "fixture/fast-b:free",
    free: true,
    supportsTools: true,
    capabilities: ["tool_calling"],
  },
  {
    id: "fixture/fast-c:free",
    free: true,
    supportsTools: true,
    capabilities: ["tool_calling"],
  },
  {
    id: "fixture/not-tool-capable:free",
    free: true,
    supportsTools: false,
    capabilities: [],
  },
];

function dependencies({
  liveIds = MODELS.slice(0, 3).map((model) => model.id),
  chain = MODELS.slice(0, 3).map((model) => ({ id: model.id })),
  refresh = async () => {},
  status = { usable: true, lastRefreshStatus: "success" },
  probe = async () => ({ status: "usable", model: "fixture/fast-a:free" }),
} = {}) {
  return {
    FREE_MODELS: MODELS,
    refreshDynamicCatalog: refresh,
    getDynamicCatalogStatus: () => status,
    getDynamicModelIds: () => new Set(liveIds),
    resolveFallbackChain: () => chain,
    probeProviderHealth: probe,
  };
}

function captureStream() {
  const chunks = [];
  return {
    chunks,
    stream: { write: (chunk) => chunks.push(String(chunk)) },
  };
}

function outputText(capture) {
  return capture.chunks.join("");
}

test("normalizes attempt configuration to a safe bounded range", () => {
  assert.deepEqual(normalizeSmokeOptions({ maxAttempts: "-10", timeoutMs: "-5" }), {
    maxAttempts: 1,
    timeoutMs: 1,
  });
  assert.deepEqual(normalizeSmokeOptions({ maxAttempts: "99", timeoutMs: "99999" }), {
    maxAttempts: 4,
    timeoutMs: 15000,
  });
});

test("catalog refresh unavailable is safe and does not leak refresh diagnostics", async () => {
  const secret = "sk-or-fixture-secret";
  const body = "provider response body with /private/internal/path";
  const stdout = captureStream();
  const stderr = captureStream();
  const result = await runOpenRouterFreeSmokeCli({
    env: { RUN_LIVE_OPENROUTER_FREE_SMOKE: "1", OPENROUTER_API_KEY: secret },
    loadDependencies: async () => dependencies({
      refresh: async () => {
        console.warn(body, secret);
      },
      status: { usable: false, lastRefreshStatus: "failed", lastRefreshError: body },
    }),
    stdout: stdout.stream,
    stderr: stderr.stream,
  });

  assert.equal(result, 2);
  assert.deepEqual(JSON.parse(outputText(stdout)), {
    status: "unavailable",
    capability: "tool_calling",
    catalog: { usable: false, freeModelCount: 0 },
    catalogStatus: "failed",
    selectedModel: null,
    actualModel: null,
    attemptedModels: [],
    attemptCount: 0,
    maxAttempts: 3,
    freePolicy: false,
    healthStatus: "unavailable",
    failureCategory: "catalog",
    reason: "catalog_unavailable",
  });
  assert.equal(outputText(stderr), "");
  assert.doesNotMatch(outputText(stdout), /provider response|sk-or-|internal\/path/);
});

test("authoritative live catalog exhaustion is unavailable without probing", async () => {
  let probeCalls = 0;
  const result = await runOpenRouterFreeSmoke({
    apiKey: "fixture-key",
    dependencies: dependencies({
      liveIds: ["fixture/not-tool-capable:free"],
      chain: MODELS.map((model) => ({ id: model.id })),
      probe: async () => {
        probeCalls++;
        return { status: "usable", model: MODELS[0].id };
      },
    }),
  });

  assert.equal(probeCalls, 0);
  assert.equal(result.status, "unavailable");
  assert.equal(result.failureCategory, "catalog");
  assert.equal(result.reason, "catalog_exhaustion");
  assert.equal(result.attemptCount, 0);
});

test("malformed capability on one candidate falls back and reports the successful candidate", async () => {
  const calls = [];
  const result = await runOpenRouterFreeSmoke({
    apiKey: "fixture-key",
    maxAttempts: 2,
    dependencies: dependencies({
      probe: async ({ model, maxFallbackModels }) => {
        calls.push({ model, maxFallbackModels });
        if (model === MODELS[0].id) {
          return {
            status: "unavailable",
            model,
            report: { failureCategory: "capability" },
          };
        }
        return { status: "usable", model: "fixture/provider-alias:free" };
      },
    }),
  });

  assert.deepEqual(calls, [
    { model: MODELS[0].id, maxFallbackModels: 1 },
    { model: MODELS[1].id, maxFallbackModels: 1 },
  ]);
  assert.equal(result.status, "passed");
  assert.equal(result.selectedModel, MODELS[0].id);
  assert.equal(result.actualModel, MODELS[1].id);
  assert.deepEqual(result.attemptedModels, [MODELS[0].id, MODELS[1].id]);
  assert.equal(result.attemptCount, 2);
  assert.equal(result.maxAttempts, 2);
  assert.equal(result.freePolicy, true);
  assert.equal(result.failureCategory, null);
  assert.equal(result.reason, null);
});

test("all capability failures are distinct from provider failures and stay bounded", async () => {
  const calls = [];
  const result = await runOpenRouterFreeSmoke({
    apiKey: "fixture-key",
    maxAttempts: 2,
    dependencies: dependencies({
      probe: async ({ model }) => {
        calls.push(model);
        return {
          status: "unavailable",
          model,
          report: {
            failureCategory: "capability",
            providerBody: "must not be emitted",
          },
        };
      },
    }),
  });

  assert.deepEqual(calls, [MODELS[0].id, MODELS[1].id]);
  assert.equal(result.status, "unavailable");
  assert.equal(result.failureCategory, "capability");
  assert.equal(result.reason, "malformed_capability_output");
  assert.equal(result.attemptCount, 2);
  assert.equal(result.attemptedModels.length, 2);
});

for (const [name, category, reason] of [
  ["authentication", "authentication", "provider_authentication_failure"],
  ["transport", "network", "provider_transport_failure"],
]) {
  test(`${name} failure uses the allowlisted operator result`, async () => {
    const result = await runOpenRouterFreeSmoke({
      apiKey: "fixture-key",
      dependencies: dependencies({
        probe: async ({ model }) => ({
          status: "unavailable",
          model,
          report: {
            failureCategory: category,
            providerResponse: "raw provider body",
            exception: "Error: /private/project/path",
          },
        }),
      }),
    });

    assert.equal(result.status, "unavailable");
    assert.equal(result.failureCategory, category);
    assert.equal(result.reason, reason);
    assert.equal(result.attemptCount, 3);
    assert.equal(JSON.stringify(result).includes("raw provider body"), false);
    assert.equal(JSON.stringify(result).includes("/private/project/path"), false);
  });
}

test("immediate first-candidate success is bounded and accepts only eligible actual models", async () => {
  let probeCalls = 0;
  const result = await runOpenRouterFreeSmoke({
    apiKey: "fixture-key",
    maxAttempts: 99,
    dependencies: dependencies({
      probe: async () => {
        probeCalls++;
        console.error(
          "raw provider response body /private/provider/path with credential sk-or-fixture-secret",
        );
        return {
          status: "usable",
          model: "paid/provider-model",
          report: { providerBody: "do not echo" },
        };
      },
    }),
  });

  assert.equal(probeCalls, 1);
  assert.equal(result.status, "passed");
  assert.equal(result.selectedModel, MODELS[0].id);
  assert.equal(result.actualModel, MODELS[0].id);
  assert.deepEqual(result.attemptedModels, [MODELS[0].id]);
  assert.equal(result.attemptCount, 1);
  assert.equal(result.maxAttempts, 4);
  assert.equal(result.freePolicy, true);
});

test("skip and missing-key CLI branches do not load dependencies or make network requests", async () => {
  let loaded = 0;
  let networkRequests = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    networkRequests++;
    throw new Error("network is forbidden in deterministic smoke tests");
  };
  try {
    const skippedOut = captureStream();
    const skippedErr = captureStream();
    assert.equal(await runOpenRouterFreeSmokeCli({
      env: {},
      loadDependencies: async () => {
        loaded++;
        return dependencies();
      },
      stdout: skippedOut.stream,
      stderr: skippedErr.stream,
    }), 0);
    assert.match(outputText(skippedErr), /^SKIP:/);

    const blockedOut = captureStream();
    const blockedErr = captureStream();
    assert.equal(await runOpenRouterFreeSmokeCli({
      env: { RUN_LIVE_OPENROUTER_FREE_SMOKE: "1" },
      loadDependencies: async () => {
        loaded++;
        return dependencies();
      },
      stdout: blockedOut.stream,
      stderr: blockedErr.stream,
    }), 2);
    assert.match(outputText(blockedErr), /^BLOCKED:/);
    assert.equal(outputText(blockedOut), "");
    assert.equal(loaded, 0);
    assert.equal(networkRequests, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("importing the script has no CLI side effect and injected CLI output is safe", async () => {
  const stdout = captureStream();
  const stderr = captureStream();
  const result = await runOpenRouterFreeSmokeCli({
    env: { RUN_LIVE_OPENROUTER_FREE_SMOKE: "1", OPENROUTER_API_KEY: "fixture-key" },
    loadDependencies: async () => dependencies(),
    stdout: stdout.stream,
    stderr: stderr.stream,
  });

  assert.equal(result, 0);
  const output = JSON.parse(outputText(stdout));
  assert.equal(output.status, "passed");
  assert.equal(output.capability, "tool_calling");
  assert.equal(output.healthStatus, "usable");
  assert.equal(output.attemptCount, 1);
  assert.equal(outputText(stderr), "");
});