import { appendFileSync } from "node:fs";

const fixtureText = JSON.stringify({
  summary: "The Goal-first durable run task requests a short confirmation without source changes.",
  steps: ["Review the Goal-first durable run task instructions."],
  result: "The task requests a short confirmation; it produced no source or validation evidence, so this attempt does not establish Canonical Proof.",
  confidence: "low",
  needsHumanReview: true,
});
const fixtureModelId = "liquid/lfm-2.5-2.6b:free";
const providerHosts = new Set([
  "api.anthropic.com",
  "api.deepseek.com",
  "api.fireworks.ai",
  "api.groq.com",
  "api.mistral.ai",
  "api.openai.com",
  "api.perplexity.ai",
  "api.together.xyz",
  "generativelanguage.googleapis.com",
  "openrouter.ai",
]);

function assertFixtureMode() {
  if (
    process.env.RUN_CONTROLLED_RELEASE_VALIDATION !== "1"
    || process.env.DASHBOARD_E2E_TEST_MODE !== "fixture"
    || process.env.MISSION_E2E_PROVIDER_FIXTURE !== "1"
    || process.env.NODE_ENV === "production"
  ) {
    throw new Error("The goal-first provider fixture is restricted to controlled non-production E2E.");
  }
}

function fixtureJsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json",
      "x-goal-first-provider-fixture": "1",
    },
  });
}

function completionPayload(model) {
  return {
    id: "goal-first-local-fixture",
    object: "chat.completion",
    created: 0,
    model: typeof model === "string" ? model : "goal-first-local-fixture",
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: fixtureText,
      },
      finish_reason: "stop",
    }],
    usage: {
      prompt_tokens: 8,
      completion_tokens: 9,
      total_tokens: 17,
    },
  };
}

function streamResponse(model) {
  const safeModel = typeof model === "string" ? model : "goal-first-local-fixture";
  const chunks = [
    {
      id: "goal-first-local-fixture",
      object: "chat.completion.chunk",
      created: 0,
      model: safeModel,
      choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
    },
    {
      id: "goal-first-local-fixture",
      object: "chat.completion.chunk",
      created: 0,
      model: safeModel,
      choices: [{ index: 0, delta: { content: fixtureText }, finish_reason: null }],
    },
    {
      id: "goal-first-local-fixture",
      object: "chat.completion.chunk",
      created: 0,
      model: safeModel,
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    },
  ];
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(body, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      "x-goal-first-provider-fixture": "1",
    },
  });
}

function recordRequest(url, method, kind) {
  const path = url.pathname;
  const logPath = process.env.DASHBOARD_E2E_PROVIDER_FIXTURE_LOG;
  if (!logPath) return;
  appendFileSync(logPath, `${JSON.stringify({
    host: url.hostname,
    method,
    path,
    kind,
  })}\n`, "utf8");
}

const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input, init) => {
  const requestUrl = input instanceof Request ? input.url : String(input);
  const url = new URL(requestUrl);
  if (!providerHosts.has(url.hostname.toLowerCase())) {
    return realFetch(input, init);
  }

  assertFixtureMode();
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  if (url.pathname.endsWith("/models")) {
    recordRequest(url, method, "model-catalog");
    return fixtureJsonResponse({
      data: [{
        id: fixtureModelId,
        name: "LFM 2.5 2.6B",
        context_length: 65_536,
        pricing: { prompt: "0", completion: "0" },
        supported_parameters: ["tools", "tool_choice", "response_format"],
      }],
    });
  }
  if (!url.pathname.endsWith("/chat/completions")) {
    recordRequest(url, method, "unsupported-provider-endpoint");
    return fixtureJsonResponse({
      error: { message: "The local E2E provider fixture only supports chat completions." },
    }, 503);
  }

  recordRequest(url, method, "chat-completion");
  let requestBody = {};
  try {
    const rawBody = init?.body ?? (input instanceof Request ? await input.clone().text() : undefined);
    if (typeof rawBody === "string") requestBody = JSON.parse(rawBody);
  } catch {
    return fixtureJsonResponse({
      error: { message: "The local E2E provider fixture received invalid JSON." },
    }, 400);
  }

  return requestBody.stream === true
    ? streamResponse(requestBody.model)
    : fixtureJsonResponse(completionPayload(requestBody.model));
};
