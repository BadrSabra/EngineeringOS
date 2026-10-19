import { appendFileSync } from "node:fs";

if (
  process.env.NODE_ENV !== "test"
  || process.env.RUN_CONTROLLED_RELEASE_VALIDATION !== "1"
  || process.env.DASHBOARD_E2E_TEST_MODE !== "fixture"
  || process.env.TASK_ROUTE_PROVIDER_FIXTURE !== "1"
  || (
    process.env.AI_PROVIDER_EGRESS_DISABLED === "1"
    && process.env.GROQ_CATALOG_FIXTURE_MODE !== "healthy"
  )
) {
  throw new Error("The task-route provider fixture is restricted to controlled test processes.");
}

const providerHost = "openrouter.ai";
const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1"]);
const nativeFetch = globalThis.fetch.bind(globalThis);
const taskId = process.env.TASK_ROUTE_RESPONSE_TASK_ID;
if (!taskId) {
  throw new Error("The task-route provider fixture requires the target task identity.");
}
const resultText = JSON.stringify({
  summary: `Task ${taskId} is ready for the response-loss recovery check.`,
  steps: [`Read task ${taskId} from the request context and returned the deterministic fixture result.`],
  result: `The task entity ${taskId} was processed by the local OpenRouter fixture; no repository file changes are part of this test.`,
  confidence: "high",
  needsHumanReview: false,
});

function recordRequest(url, method, kind) {
  const logPath = process.env.TASK_ROUTE_PROVIDER_FIXTURE_LOG;
  if (!logPath) throw new Error("The task-route provider fixture requires a request log path.");
  appendFileSync(logPath, `${JSON.stringify({
    host: url.hostname,
    method,
    path: url.pathname,
    kind,
  })}\n`, "utf8");
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json",
      "x-task-route-provider-fixture": "1",
    },
  });
}

function completionPayload(model) {
  return {
    id: "task-route-local-fixture",
    object: "chat.completion",
    created: 0,
    model: typeof model === "string" ? model : "task-route-local-fixture",
    choices: [{
      index: 0,
      message: { role: "assistant", content: resultText },
      finish_reason: "stop",
    }],
    usage: { prompt_tokens: 8, completion_tokens: 9, total_tokens: 17 },
  };
}

function streamResponse(model) {
  const safeModel = typeof model === "string" ? model : "task-route-local-fixture";
  const encoder = new TextEncoder();
  const chunks = [
    {
      id: "task-route-local-fixture",
      object: "chat.completion.chunk",
      created: 0,
      model: safeModel,
      choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
    },
    {
      id: "task-route-local-fixture",
      object: "chat.completion.chunk",
      created: 0,
      model: safeModel,
      choices: [{ index: 0, delta: { content: resultText }, finish_reason: null }],
    },
    {
      id: "task-route-local-fixture",
      object: "chat.completion.chunk",
      created: 0,
      model: safeModel,
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    },
  ];
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
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
  });
}

globalThis.fetch = async (input, init) => {
  const requestUrl = input instanceof Request ? input.url : String(input);
  const url = new URL(requestUrl);
  if (url.hostname.toLowerCase() !== providerHost) {
    if (loopbackHosts.has(url.hostname.toLowerCase())) return nativeFetch(input, init);
    throw new Error(`Unexpected outbound HTTP request blocked by task-route fixture: ${url.hostname}`);
  }

  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  if (url.pathname.endsWith("/models")) {
    recordRequest(url, method, "model-catalog");
    return jsonResponse({
      data: [
        {
          id: "liquid/lfm-2.5-2.6b:free",
          name: "Task route response-loss fixture model",
          pricing: { prompt: "0", completion: "0" },
          supported_parameters: [
            "tools",
            "tool_choice",
            "parallel_tool_calls",
            "response_format",
            "structured_outputs",
          ],
        },
      ],
    });
  }

  if (!url.pathname.endsWith("/chat/completions")) {
    recordRequest(url, method, "unsupported-provider-endpoint");
    return jsonResponse({
      error: { message: "The local task-route fixture only supports chat completions." },
    }, 503);
  }

  let requestBody = {};
  try {
    const rawBody = init?.body
      ?? (input instanceof Request ? await input.clone().text() : undefined);
    if (typeof rawBody === "string") requestBody = JSON.parse(rawBody);
    else if (Buffer.isBuffer(rawBody)) requestBody = JSON.parse(rawBody.toString("utf8"));
  } catch {
    recordRequest(url, method, "invalid-request");
    return jsonResponse({ error: { message: "Invalid local fixture request JSON." } }, 400);
  }

  recordRequest(url, method, "chat-completion");
  return requestBody.stream === true
    ? streamResponse(requestBody.model)
    : jsonResponse(completionPayload(requestBody.model));
};
