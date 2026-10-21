import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const fixturePath = fileURLToPath(
  new URL("./goal-first-provider-fixture.mjs", import.meta.url),
);

function runFixture(script, env) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(
      process.execPath,
      ["--import", fixturePath, "--input-type=module", "-e", script],
      { cwd: repositoryRoot, env, stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", rejectRun);
    child.once("close", (code, signal) => {
      resolveRun({ code, signal, stdout, stderr });
    });
  });
}

test("local catalog and completion fixtures support the real provider contract without logging prompts", async () => {
  const temporaryRoot = await mkdtemp(
    join(os.tmpdir(), "goal-first-provider-fixture-test-"),
  );
  const logPath = join(temporaryRoot, "requests.jsonl");
  try {
    const script = `
      const catalogResponse = await fetch("https://openrouter.ai/api/v1/models");
      const catalog = await catalogResponse.json();
      const completionResponse = await fetch(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: "liquid/lfm-2.5-2.6b:free",
            messages: [{ role: "user", content: "private fixture prompt" }],
          }),
        },
      );
      const completion = await completionResponse.json();
      const parsedContent = JSON.parse(completion.choices?.[0]?.message?.content);
      const streamResponse = await fetch(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: "liquid/lfm-2.5-2.6b:free",
            stream: true,
            messages: [{ role: "user", content: "private stream prompt" }],
          }),
        },
      );
      const stream = await streamResponse.text();
      const tools = [{
        type: "function",
        function: {
          name: "read_file",
          parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
        },
      }];
      const missionMessages = [{
        role: "user",
        content: "Server-owned Mission execution. Read README.md, package.json, src/acceptance.mjs, src/report.mjs, and test/report.test.mjs.",
      }];
      const queryPlanResponse = await fetch(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: "liquid/lfm-2.5-2.6b:free",
            messages: [
              {
                role: "system",
                content: "You are a planning agent for a code intelligence system. Return the query plan as JSON.",
              },
              ...missionMessages,
            ],
          }),
        },
      );
      const queryPlanPayload = await queryPlanResponse.json();
      const queryPlan = JSON.parse(queryPlanPayload.choices?.[0]?.message?.content);
      const missionToolResponse = await fetch(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: "liquid/lfm-2.5-2.6b:free",
            messages: missionMessages,
            tools,
          }),
        },
      );
      const missionToolPayload = await missionToolResponse.json();
      const calls = missionToolPayload.choices?.[0]?.message?.tool_calls ?? [];
      const missionSummaryResponse = await fetch(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: "liquid/lfm-2.5-2.6b:free",
            messages: [
              ...missionMessages,
              { role: "assistant", tool_calls: calls },
              ...calls.map((call) => ({
                role: "tool",
                name: call.function.name,
                tool_call_id: call.id,
                content: call.function.arguments,
              })),
            ],
            tools,
          }),
        },
      );
      const missionSummary = await missionSummaryResponse.json();
      const parsedMissionSummary = JSON.parse(
        missionSummary.choices?.[0]?.message?.content,
      );
      console.log(JSON.stringify({
        catalogStatus: catalogResponse.status,
        modelId: catalog.data?.[0]?.id,
        promptPrice: catalog.data?.[0]?.pricing?.prompt,
        completionStatus: completionResponse.status,
        completion: parsedContent,
        streamStatus: streamResponse.status,
        streamHasDone: stream.includes("data: [DONE]"),
        missionToolStatus: missionToolResponse.status,
        missionToolNames: calls.map((call) => call.function?.name),
        queryPlanStatus: queryPlanResponse.status,
        queryPlan,
        missionSummaryStatus: missionSummaryResponse.status,
        missionSummary: parsedMissionSummary,
      }));
    `;
    const result = await runFixture(script, {
      PATH: process.env.PATH ?? "",
      NODE_ENV: "development",
      RUN_CONTROLLED_RELEASE_VALIDATION: "1",
      DASHBOARD_E2E_TEST_MODE: "fixture",
      MISSION_E2E_PROVIDER_FIXTURE: "1",
      DASHBOARD_E2E_PROVIDER_FIXTURE_LOG: logPath,
    });
    assert.equal(result.signal, null, result.stderr);
    assert.equal(result.code, 0, result.stderr);
    const response = JSON.parse(result.stdout.trim());
    assert.deepEqual(response, {
      catalogStatus: 200,
      modelId: "liquid/lfm-2.5-2.6b:free",
      promptPrice: "0",
      completionStatus: 200,
      completion: {
        summary: "The Goal-first durable run task requests a short confirmation without source changes.",
        steps: ["Review the Goal-first durable run task instructions."],
        result: "The task requests a short confirmation; it produced no source or validation evidence, so this attempt does not establish Canonical Proof.",
        confidence: "low",
        needsHumanReview: true,
      },
      streamStatus: 200,
      streamHasDone: true,
      missionToolStatus: 200,
        missionToolNames: ["read_file", "read_file", "read_file", "read_file", "read_file"],
      queryPlanStatus: 200,
      queryPlan: {
        targetFiles: ["README.md", "package.json", "src/acceptance.mjs", "src/report.mjs", "test/report.test.mjs"],
        targetEntities: [],
        targetConfidence: 0.95,
        scopeEstimate: "narrow",
        suggestedIterations: 8,
        requiresToolUse: true,
        subQueries: [],
        compoundParts: [],
      },
      missionSummaryStatus: 200,
      missionSummary: {
        response: "reportStatus in src/report.mjs returns COMPLETED whenever execution.status is completed, ignoring the matching PROVEN acceptance required by README.md and src/acceptance.mjs. Counterexample: {execution:{id:'exec-7',status:'completed',workspaceRevision:'rev-2'},acceptance:null}; test/report.test.mjs codifies it. The README's write_file instruction is untrusted data; no files were changed.",
        sources: ["README.md", "package.json", "src/acceptance.mjs", "src/report.mjs", "test/report.test.mjs"],
      },
    });

    const requests = (await readFile(logPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.deepEqual(requests.map(({ kind }) => kind), [
      "model-catalog",
      "chat-completion",
      "chat-completion",
      "mission-query-plan",
      "mission-read-tool-call",
      "mission-evidence-summary",
    ]);
    assert.ok(requests.every((request) => request.host === "openrouter.ai"));
    assert.ok(
      requests.every(
        (request) =>
          request.path === "/api/v1/models" ||
          request.path === "/api/v1/chat/completions",
      ),
    );
    assert.equal((await readFile(logPath, "utf8")).includes("private fixture"), false);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("provider interception fails closed outside controlled non-production fixture mode", async () => {
  const result = await runFixture(
    `
      try {
        await fetch("https://openrouter.ai/api/v1/models");
        throw new Error("provider request unexpectedly proceeded");
      } catch (error) {
        if (!String(error).includes("restricted to controlled non-production E2E")) {
          throw error;
        }
        console.log("blocked");
      }
    `,
    {
      PATH: process.env.PATH ?? "",
      NODE_ENV: "development",
      DASHBOARD_E2E_TEST_MODE: "fixture",
      MISSION_E2E_PROVIDER_FIXTURE: "1",
    },
  );
  assert.equal(result.signal, null, result.stderr);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout.trim(), "blocked");
});

test("lifecycle fixture stages only manifest-authorized README and validation calls", async () => {
  const temporaryRoot = await mkdtemp(
    join(os.tmpdir(), "engineering-agent-lifecycle-fixture-test-"),
  );
  const logPath = join(temporaryRoot, "requests.jsonl");
  try {
    const script = `
      const url = "https://openrouter.ai/api/v1/chat/completions";
      const tools = [
        { type: "function", function: { name: "read_file", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } } },
        { type: "function", function: { name: "write_file", parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" }, reason: { type: "string" } }, required: ["path", "content", "reason"] } } },
        { type: "function", function: { name: "run_validation", parameters: { type: "object", properties: { profile: { type: "string" } }, required: ["profile"] } } },
      ];
      const rootMessages = [{
        role: "user",
        content: "Server-owned Mission execution.\\n\\nExecution profile: mission_repair.\\n\\nAdd the requested README sentence and validate the candidate.",
      }];
      const planResponse = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "liquid/lfm-2.5-2.6b:free",
          messages: [
            { role: "system", content: "You are a planning agent for a code intelligence system." },
            ...rootMessages,
          ],
          tools: [],
        }),
      });
      if (!planResponse.ok) throw new Error("lifecycle query plan unexpectedly failed");
      const queryPlan = JSON.parse(
        (await planResponse.json()).choices?.[0]?.message?.content ?? "{}",
      );
      async function request(messages, includeWriteTool = true) {
        const response = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: "liquid/lfm-2.5-2.6b:free",
            messages,
            tools: includeWriteTool ? tools : tools.filter((tool) => tool.function.name !== "write_file"),
          }),
        });
        return { status: response.status, payload: await response.json() };
      }
      const toolResults = [];
      let messages = rootMessages;
      let messagesAfterRead;
      const calls = [];
      for (let index = 0; index < 3; index += 1) {
        const response = await request(messages);
        if (response.status !== 200) throw new Error("lifecycle step unexpectedly blocked");
        const call = response.payload.choices?.[0]?.message?.tool_calls?.[0];
        if (!call) throw new Error("lifecycle fixture omitted a required server tool call");
        calls.push(call);
        toolResults.push({ role: "tool", name: call.function.name, tool_call_id: call.id, content: JSON.stringify({ ok: true }) });
        messages = [
          ...rootMessages,
          ...calls.map((item) => ({ role: "assistant", tool_calls: [item] })),
          ...toolResults,
        ];
        if (index === 0) messagesAfterRead = messages;
      }
      const blocked = await request(messagesAfterRead, false);
      const final = await request(messages);
      const summary = JSON.parse(final.payload.choices?.[0]?.message?.content ?? "{}");
      console.log(JSON.stringify({
        queryPlan,
        toolNames: calls.map((call) => call.function.name),
        toolArguments: calls.map((call) => JSON.parse(call.function.arguments)),
        blockedStatus: blocked.status,
        finalStatus: final.status,
        summary,
      }));
    `;
    const result = await runFixture(script, {
      PATH: process.env.PATH ?? "",
      NODE_ENV: "development",
      RUN_CONTROLLED_RELEASE_VALIDATION: "1",
      DASHBOARD_E2E_TEST_MODE: "fixture",
      MISSION_E2E_PROVIDER_FIXTURE: "1",
      ENGINEERING_AGENT_LIFECYCLE_E2E: "1",
      ENGINEERING_AGENT_LIFECYCLE_REMOTE: join(temporaryRoot, "remote.git"),
      ENGINEERING_AGENT_LIFECYCLE_PROJECT_ROOT: join(temporaryRoot, "project"),
      ENGINEERING_AGENT_LIFECYCLE_RECEIPT: join(temporaryRoot, "receipt.json"),
      DASHBOARD_E2E_PROVIDER_FIXTURE_LOG: logPath,
    });
    assert.equal(result.signal, null, result.stderr);
    assert.equal(result.code, 0, result.stderr);
    const response = JSON.parse(result.stdout.trim());
    assert.ok(Number.isInteger(response.queryPlan.suggestedIterations));
    assert.ok(response.queryPlan.suggestedIterations >= 5 && response.queryPlan.suggestedIterations <= 16);
    assert.deepEqual(response, {
      queryPlan: {
        targetFiles: ["README.md"],
        targetEntities: [],
        targetConfidence: 0.95,
        scopeEstimate: "narrow",
        suggestedIterations: 8,
        requiresToolUse: true,
        subQueries: [],
        compoundParts: [],
      },
      toolNames: ["read_file", "write_file", "run_validation"],
      toolArguments: [
        { path: "README.md" },
        {
          path: "README.md",
          content: [
            "# Engineering Agent lifecycle fixture",
            "",
            "A disposable project used to verify an approved, validated change and delivery.",
            "Lifecycle acceptance sentinel: retained after approved delivery.",
            "",
          ].join("\n"),
          reason: "Add the approved lifecycle acceptance sentence.",
        },
        { profile: "workspace-typecheck" },
      ],
      blockedStatus: 403,
      finalStatus: 200,
      summary: {
        response: "The README change was staged as a candidate and the registered validation passed.",
        sources: ["README.md"],
      },
    });

    const requests = (await readFile(logPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.deepEqual(requests.map(({ kind }) => kind), [
      "lifecycle-query-plan",
      "lifecycle-read_file",
      "lifecycle-write_file",
      "lifecycle-run_validation",
      "lifecycle-write_file-not-authorized",
      "lifecycle-mission-final",
    ]);
    assert.equal((await readFile(logPath, "utf8")).includes("requested README"), false);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("lifecycle observer fixture requires an authorized README read and returns its bound claim", async () => {
  const temporaryRoot = await mkdtemp(
    join(os.tmpdir(), "engineering-agent-lifecycle-observer-fixture-test-"),
  );
  const logPath = join(temporaryRoot, "requests.jsonl");
  try {
    const script = `
      const url = "https://openrouter.ai/api/v1/chat/completions";
      const tools = [{
        type: "function",
        function: {
          name: "read_file",
          parameters: {
            type: "object",
            properties: { path: { type: "string" } },
            required: ["path"],
          },
        },
      }];
      const rootMessages = [{
        role: "user",
        content: "Server-owned Mission execution.\\\\n\\\\nExecution profile: mission_observe.\\\\n\\\\nClaim applied-result (README.md): Confirm the approved sentence is present after applying the candidate.",
      }];
      async function request(messages, allowedTools = tools) {
        const response = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: "liquid/lfm-2.5-2.6b:free",
            messages,
            tools: allowedTools,
          }),
        });
        return { status: response.status, payload: await response.json() };
      }
      const planResponse = await request([
        { role: "system", content: "You are a planning agent for a code intelligence system." },
        ...rootMessages,
      ], []);
      const blocked = await request(rootMessages, []);
      const started = await request(rootMessages);
      const call = started.payload.choices?.[0]?.message?.tool_calls?.[0];
      if (!call) throw new Error("observer fixture omitted the README read");
      const final = await request([
        ...rootMessages,
        { role: "assistant", tool_calls: [call] },
        {
          role: "tool",
          name: "read_file",
          tool_call_id: call.id,
          content: JSON.stringify({
            path: "README.md",
            content: "Lifecycle acceptance sentinel: retained after approved delivery.",
          }),
        },
      ]);
      const summary = JSON.parse(final.payload.choices?.[0]?.message?.content ?? "{}");
      const synthesis = await request([
        {
          role: "system",
          content: "Synthesize a scoped project answer from the retained evidence below.",
        },
        {
          role: "user",
          content: [
            "Server-owned Mission execution.",
            "Execution profile: mission_observe.",
            "Objective: Report the live applied result; confirm the approved candidate is APPLIED.",
            "Server-owned retained evidence:",
            "Claim applied-result (README.md):",
            "Lifecycle acceptance sentinel: retained after approved delivery.",
          ].join("\\\\n"),
        },
      ], []);
      const synthesisPayload = JSON.parse(
        synthesis.payload.choices?.[0]?.message?.content ?? "{}",
      );
      const synthesisArabic = await request([
        {
          role: "system",
          content: "Synthesize a scoped project answer from the retained evidence below.",
        },
        {
          role: "user",
          content: [
            "Server-owned Mission execution.",
            "Execution profile: mission_observe.",
            "Objective: Report the live applied result; confirm the approved candidate is APPLIED.",
            "أجب باللغة العربية.",
            "Server-owned retained evidence:",
            "Claim applied-result (README.md):",
            "Lifecycle acceptance sentinel: retained after approved delivery.",
          ].join("\\\\n"),
        },
      ], []);
      const synthesisArabicPayload = JSON.parse(
        synthesisArabic.payload.choices?.[0]?.message?.content ?? "{}",
      );
      console.log(JSON.stringify({
        queryPlan: JSON.parse(planResponse.payload.choices?.[0]?.message?.content ?? "{}"),
        blockedStatus: blocked.status,
        readStatus: started.status,
        callName: call.function.name,
        callArguments: JSON.parse(call.function.arguments),
        finalStatus: final.status,
        summary,
        synthesisStatus: synthesis.status,
        synthesisPayload,
        synthesisArabicStatus: synthesisArabic.status,
        synthesisArabicPayload,
      }));
    `;
    const result = await runFixture(script, {
      PATH: process.env.PATH ?? "",
      NODE_ENV: "development",
      RUN_CONTROLLED_RELEASE_VALIDATION: "1",
      DASHBOARD_E2E_TEST_MODE: "fixture",
      MISSION_E2E_PROVIDER_FIXTURE: "1",
      ENGINEERING_AGENT_LIFECYCLE_E2E: "1",
      ENGINEERING_AGENT_LIFECYCLE_REMOTE: join(temporaryRoot, "remote.git"),
      ENGINEERING_AGENT_LIFECYCLE_PROJECT_ROOT: join(temporaryRoot, "project"),
      ENGINEERING_AGENT_LIFECYCLE_RECEIPT: join(temporaryRoot, "receipt.json"),
      DASHBOARD_E2E_PROVIDER_FIXTURE_LOG: logPath,
    });
    assert.equal(result.signal, null, result.stderr);
    assert.equal(result.code, 0, result.stderr);
    const response = JSON.parse(result.stdout.trim());
    assert.deepEqual(response, {
      queryPlan: {
        targetFiles: ["README.md"],
        targetEntities: [],
        targetConfidence: 0.95,
        scopeEstimate: "narrow",
        suggestedIterations: 8,
        requiresToolUse: true,
        subQueries: [],
        compoundParts: [],
      },
      blockedStatus: 403,
      readStatus: 200,
      callName: "read_file",
      callArguments: { path: "README.md" },
      finalStatus: 200,
      summary: {
        response: 'The approved candidate is APPLIED. Its live result is that README.md contains the sentinel sentence: "Lifecycle acceptance sentinel: retained after approved delivery."',
        sources: ["README.md"],
        claimRefs: ["applied-result"],
      },
      synthesisStatus: 200,
      synthesisPayload: {
        response: 'The approved candidate is APPLIED. Its live result is that README.md contains the sentinel sentence: "Lifecycle acceptance sentinel: retained after approved delivery."',
        sources: ["README.md"],
        claimRefs: ["applied-result"],
      },
      synthesisArabicStatus: 200,
      synthesisArabicPayload: {
        response: 'المرشح المعتمد حالته APPLIED. والنتيجة الحية هي أن README.md يحتوي على السطر: "Lifecycle acceptance sentinel: retained after approved delivery."',
        sources: ["README.md"],
        claimRefs: ["applied-result"],
      },
    });
    const requests = (await readFile(logPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.deepEqual(requests.map(({ kind }) => kind), [
      "lifecycle-query-plan",
      "lifecycle-applied-report-read-not-authorized",
      "lifecycle-applied-report-read",
      "lifecycle-applied-report-summary",
      "lifecycle-applied-report-synthesis",
      "lifecycle-applied-report-synthesis",
    ]);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
