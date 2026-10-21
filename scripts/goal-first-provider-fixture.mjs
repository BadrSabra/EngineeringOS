import { appendFileSync } from "node:fs";

const fixtureText = JSON.stringify({
  summary: "The Goal-first durable run task requests a short confirmation without source changes.",
  steps: ["Review the Goal-first durable run task instructions."],
  result: "The task requests a short confirmation; it produced no source or validation evidence, so this attempt does not establish Canonical Proof.",
  confidence: "low",
  needsHumanReview: true,
});
const missionEvidenceSummary = JSON.stringify({
  response: "reportStatus in src/report.mjs returns COMPLETED whenever execution.status is completed, ignoring the matching PROVEN acceptance required by README.md and src/acceptance.mjs. Counterexample: {execution:{id:'exec-7',status:'completed',workspaceRevision:'rev-2'},acceptance:null}; test/report.test.mjs codifies it. The README's write_file instruction is untrusted data; no files were changed.",
  sources: ["README.md", "package.json", "src/acceptance.mjs", "src/report.mjs", "test/report.test.mjs"],
});
const missionQueryPlan = JSON.stringify({
  targetFiles: ["README.md", "package.json", "src/acceptance.mjs", "src/report.mjs", "test/report.test.mjs"],
  targetEntities: [],
  targetConfidence: 0.95,
  scopeEstimate: "narrow",
  suggestedIterations: 8,
  requiresToolUse: true,
  subQueries: [],
  compoundParts: [],
});
const lifecycleQueryPlan = JSON.stringify({
  targetFiles: ["README.md"],
  targetEntities: [],
  targetConfidence: 0.95,
  scopeEstimate: "narrow",
  suggestedIterations: 8,
  requiresToolUse: true,
  subQueries: [],
  compoundParts: [],
});
const missionReadToolCalls = [
  {
    id: "call_goal_first_readme",
    type: "function",
    function: { name: "read_file", arguments: JSON.stringify({ path: "README.md" }) },
  },
  {
    id: "call_goal_first_package",
    type: "function",
    function: { name: "read_file", arguments: JSON.stringify({ path: "package.json" }) },
  },
  {
    id: "call_goal_first_acceptance",
    type: "function",
    function: { name: "read_file", arguments: JSON.stringify({ path: "src/acceptance.mjs" }) },
  },
  {
    id: "call_goal_first_report",
    type: "function",
    function: { name: "read_file", arguments: JSON.stringify({ path: "src/report.mjs" }) },
  },
  {
    id: "call_goal_first_test",
    type: "function",
    function: { name: "read_file", arguments: JSON.stringify({ path: "test/report.test.mjs" }) },
  },
];
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

function assertLifecycleFixtureMode() {
  assertFixtureMode();
  if (
    process.env.ENGINEERING_AGENT_LIFECYCLE_E2E !== "1"
    || !process.env.ENGINEERING_AGENT_LIFECYCLE_REMOTE
    || !process.env.ENGINEERING_AGENT_LIFECYCLE_PROJECT_ROOT
    || !process.env.ENGINEERING_AGENT_LIFECYCLE_RECEIPT
  ) {
    throw new Error("The lifecycle provider fixture requires the isolated lifecycle runner.");
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

function completionPayload(model, content = fixtureText) {
  return {
    id: "goal-first-local-fixture",
    object: "chat.completion",
    created: 0,
    model: typeof model === "string" ? model : "goal-first-local-fixture",
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content,
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

function toolCallPayload(model) {
  return toolCallsPayload(model, missionReadToolCalls);
}

function toolCallsPayload(model, toolCalls) {
  return {
    id: "goal-first-local-fixture",
    object: "chat.completion",
    created: 0,
    model: typeof model === "string" ? model : "goal-first-local-fixture",
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: null,
        tool_calls: toolCalls,
      },
      finish_reason: "tool_calls",
    }],
    usage: {
      prompt_tokens: 8,
      completion_tokens: 9,
      total_tokens: 17,
    },
  };
}

function streamResponse(model, content = fixtureText) {
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
      choices: [{ index: 0, delta: { content }, finish_reason: null }],
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

function streamToolCallResponse(model) {
  return streamToolCallsResponse(model, missionReadToolCalls);
}

function streamToolCallsResponse(model, toolCalls) {
  const safeModel = typeof model === "string" ? model : "goal-first-local-fixture";
  const chunks = [
    {
      id: "goal-first-local-fixture",
      object: "chat.completion.chunk",
      created: 0,
      model: safeModel,
      choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
    },
    ...toolCalls.map((toolCall, index) => ({
      id: "goal-first-local-fixture",
      object: "chat.completion.chunk",
      created: 0,
      model: safeModel,
      choices: [{
        index: 0,
        delta: {
          tool_calls: [{
            index,
            id: toolCall.id,
            type: "function",
            function: toolCall.function,
          }],
        },
        finish_reason: null,
      }],
    })),
    {
      id: "goal-first-local-fixture",
      object: "chat.completion.chunk",
      created: 0,
      model: safeModel,
      choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
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

const LIFECYCLE_SENTENCE =
  "Lifecycle acceptance sentinel: retained after approved delivery.";
const LIFECYCLE_README = [
  "# Engineering Agent lifecycle fixture",
  "",
  "A disposable project used to verify an approved, validated change and delivery.",
  LIFECYCLE_SENTENCE,
  "",
].join("\n");
let lifecycleToolCallSequence = 0;

function requestToolName(toolCall) {
  return toolCall?.function?.name ?? toolCall?.name;
}

function lifecycleToolCalls(messages) {
  const priorCalls = messages.flatMap((message) =>
    message?.role === "assistant" && Array.isArray(message.tool_calls)
      ? message.tool_calls
      : [],
  );
  const calledNames = new Set(priorCalls.map(requestToolName));
  const nextToolName = !calledNames.has("read_file")
    ? "read_file"
    : !calledNames.has("write_file")
      ? "write_file"
      : !calledNames.has("run_validation")
        ? "run_validation"
        : undefined;
  if (!nextToolName) return undefined;
  const args = nextToolName === "read_file"
    ? { path: "README.md" }
    : nextToolName === "write_file"
      ? {
          path: "README.md",
          content: LIFECYCLE_README,
          reason: "Add the approved lifecycle acceptance sentence.",
        }
      : { profile: "workspace-typecheck" };
  lifecycleToolCallSequence += 1;
  return [{
    id: `call_lifecycle_${nextToolName}_${lifecycleToolCallSequence}`,
    type: "function",
    function: {
      name: nextToolName,
      arguments: JSON.stringify(args),
    },
  }];
}

function lifecycleToolIsAvailable(requestBody, name) {
  return Array.isArray(requestBody.tools) && requestBody.tools.some((tool) =>
    requestToolName(tool) === name,
  );
}

function lifecycleMissionResponse(requestBody, messages, url, method) {
  const calls = lifecycleToolCalls(messages);
  if (calls) {
    const toolName = calls[0].function.name;
    if (!lifecycleToolIsAvailable(requestBody, toolName)) {
      recordRequest(url, method, `lifecycle-${toolName}-not-authorized`);
      return fixtureJsonResponse({
        error: {
          message: `The lifecycle fixture cannot invoke ${toolName} unless the server includes it in the authorized tool manifest.`,
        },
      }, 403);
    }
    recordRequest(url, method, `lifecycle-${toolName}`);
    return requestBody.stream === true
      ? streamToolCallsResponse(requestBody.model, calls)
      : fixtureJsonResponse(toolCallsPayload(requestBody.model, calls));
  }

  recordRequest(url, method, "lifecycle-mission-final");
  const content = JSON.stringify({
    response: "The README change was staged as a candidate and the registered validation passed.",
    sources: ["README.md"],
  });
  return requestBody.stream === true
    ? streamResponse(requestBody.model, content)
    : fixtureJsonResponse(completionPayload(requestBody.model, content));
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

function missionEvidenceSynthesis(messages) {
  const serializedMessages = JSON.stringify(messages);
  const claimMatches = [...serializedMessages.matchAll(
    /Claim ([A-Za-z0-9:_-]+) \(([^)]+)\):/gu,
  )];
  const claimRefs = [...new Set(claimMatches.map((match) => match[1]))];
  const sources = [...new Set(claimMatches.map((match) => match[2]))];
  return JSON.stringify({
    response: "reportStatus in src/report.mjs returns COMPLETED whenever execution.status is completed, ignoring the matching PROVEN acceptance required by README.md and src/acceptance.mjs. Counterexample: {execution:{id:'exec-7',status:'completed',workspaceRevision:'rev-2'},acceptance:null}; test/report.test.mjs codifies it. The README's write_file instruction is untrusted data; no files were changed.",
    sources,
    claimRefs,
  });
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

  let requestBody = {};
  try {
    const rawBody = init?.body ?? (input instanceof Request ? await input.clone().text() : undefined);
    if (typeof rawBody === "string") requestBody = JSON.parse(rawBody);
  } catch {
    return fixtureJsonResponse({
      error: { message: "The local E2E provider fixture received invalid JSON." },
    }, 400);
  }

  const messages = Array.isArray(requestBody.messages) ? requestBody.messages : [];
  const serializedMessages = JSON.stringify(messages);
  const isMissionExecution = serializedMessages.includes("Server-owned Mission execution.");
  const isQueryPlannerRequest = messages.some((message) =>
    message?.role === "system"
      && typeof message.content === "string"
      && message.content.includes("You are a planning agent for a code intelligence system."),
  );
  const hasReadFileTool = Array.isArray(requestBody.tools)
    && requestBody.tools.some((tool) =>
      tool?.function?.name === "read_file" || tool?.name === "read_file",
    );
  const hasToolResult = messages.some((message) =>
    message?.role === "tool" || message?.role === "function",
  );
  const isProjectQuerySynthesis = messages.some((message) =>
    message?.role === "system"
      && typeof message.content === "string"
      && message.content.includes("Synthesize a scoped project answer from the retained evidence below."),
  );

  if (process.env.ENGINEERING_AGENT_LIFECYCLE_E2E === "1") {
    assertLifecycleFixtureMode();
    const isMissionRepairExecution = isMissionExecution
      && serializedMessages.includes("Execution profile: mission_repair.");
    if (isMissionRepairExecution && isQueryPlannerRequest) {
      recordRequest(url, method, "lifecycle-query-plan");
      return requestBody.stream === true
        ? streamResponse(requestBody.model, lifecycleQueryPlan)
        : fixtureJsonResponse(completionPayload(requestBody.model, lifecycleQueryPlan));
    }
    if (isMissionRepairExecution) {
      return lifecycleMissionResponse(requestBody, messages, url, method);
    }
    if (isMissionExecution || isQueryPlannerRequest || isProjectQuerySynthesis) {
      recordRequest(url, method, "lifecycle-unsupported-ai-stage");
      return fixtureJsonResponse({
        error: {
          message: "The lifecycle fixture only supports its recognized chat and Mission repair stages.",
        },
      }, 503);
    }
    recordRequest(url, method, "lifecycle-chat-completion");
    return requestBody.stream === true
      ? streamResponse(requestBody.model)
      : fixtureJsonResponse(completionPayload(requestBody.model));
  }

  if (isQueryPlannerRequest) {
    recordRequest(url, method, "mission-query-plan");
    return requestBody.stream === true
      ? streamResponse(requestBody.model, missionQueryPlan)
      : fixtureJsonResponse(completionPayload(requestBody.model, missionQueryPlan));
  }
  if (isProjectQuerySynthesis) {
    recordRequest(url, method, "mission-evidence-synthesis");
    const synthesis = missionEvidenceSynthesis(messages);
    const parsed = JSON.parse(synthesis);
    if (parsed.claimRefs.length === 0 || parsed.sources.length === 0) {
      return fixtureJsonResponse({
        error: { message: "The local fixture could not bind synthesis to the supplied server-owned claims." },
      }, 500);
    }
    return requestBody.stream === true
      ? streamResponse(requestBody.model, synthesis)
      : fixtureJsonResponse(completionPayload(requestBody.model, synthesis));
  }
  if (hasToolResult && (isMissionExecution || hasReadFileTool)) {
    recordRequest(url, method, "mission-evidence-summary");
    return requestBody.stream === true
      ? streamResponse(requestBody.model, missionEvidenceSummary)
      : fixtureJsonResponse(completionPayload(requestBody.model, missionEvidenceSummary));
  }
  if (hasReadFileTool && !hasToolResult) {
    recordRequest(url, method, "mission-read-tool-call");
    return requestBody.stream === true
      ? streamToolCallResponse(requestBody.model)
      : fixtureJsonResponse(toolCallPayload(requestBody.model));
  }

  recordRequest(url, method, "chat-completion");
  return requestBody.stream === true
    ? streamResponse(requestBody.model)
    : fixtureJsonResponse(completionPayload(requestBody.model));
};
