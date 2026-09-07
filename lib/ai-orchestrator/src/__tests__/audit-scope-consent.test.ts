import { describe, expect, it } from "vitest";
import { chat } from "../agents/chat-agent.js";
import { classifyRequest } from "../prompts/profile-classifier.js";
import { resolveTurnIntent } from "../turn-intent.js";

const projectContext = {
  project: "scope consent test project",
  workflows: "",
  recentTasks: "",
  latestMetrics: "",
  graphSummary: "",
  recentEvents: "",
  metricsVerified: false,
};

describe("broad audit scope consent", () => {
  it.each([
    {
      message: "Audit my project for important problems.",
      expected: "Before I start a broad audit, what scope should I use?",
    },
    {
      message: "دقق مشروعي بحثًا عن مشاكل مهمة.",
      expected: "قبل أن أبدأ فحصًا واسعًا، ما النطاق الذي تريده؟",
    },
  ])("does not invoke the forensic tool loop before scope is declared: $message", async ({
    message,
    expected,
  }) => {
    const intent = resolveTurnIntent(message, {
      classification: classifyRequest(message),
    });
    const steps: string[] = [];
    const deltas: string[] = [];

    const result = await chat({
      message,
      history: [],
      projectContext,
      rootPath: process.cwd(),
      turnIntent: intent,
      onDelta: (delta) => deltas.push(delta),
      onStep: (step) => steps.push(step.kind),
    });

    expect(intent.scopeClarificationRequired).toBe(true);
    expect(result.response).toContain(expected);
    expect(result.sources).toEqual([]);
    expect(result.pendingChanges).toEqual([]);
    expect(deltas.join("")).toContain(expected);
    expect(steps).toEqual([]);
  });
});