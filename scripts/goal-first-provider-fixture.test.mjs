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
        content: "Server-owned Mission execution. Read README.md and package.json.",
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
      missionToolNames: ["read_file", "read_file"],
      queryPlanStatus: 200,
      queryPlan: {
        targetFiles: ["README.md", "package.json"],
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
        response: "README.md describes the project as a disposable evidence fixture, and package.json names it goal-first-evidence-fixture.",
        sources: ["README.md", "package.json"],
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
