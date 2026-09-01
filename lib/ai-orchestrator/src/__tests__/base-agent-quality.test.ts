import { describe, expect, it } from "vitest";
import { z } from "zod";
import { BaseAgent } from "../agents/base-agent.js";
import type { AgentCompleteOpts } from "../agent-complete.js";

const OutputSchema = z.object({
  summary: z.string(),
  result: z.string(),
  confidence: z.enum(["low", "medium", "high"]),
  steps: z.array(z.string()),
  needsHumanReview: z.boolean(),
});
type Output = z.infer<typeof OutputSchema>;

class TestTaskAgent extends BaseAgent<undefined, Output> {
  protected readonly scope = "task-agent";
  protected readonly schema = OutputSchema;
  private readonly responses: string[];

  constructor(responses: Output[]) {
    super();
    this.responses = responses.map((response) => JSON.stringify(response));
  }

  protected buildMessages() {
    return [{ role: "user" as const, content: "Complete the task." }];
  }

  protected fallbackOutput() {
    return {
      summary: "",
      result: "",
      confidence: "low" as const,
      steps: [],
      needsHumanReview: true,
    };
  }

  protected async complete(_messages: Array<{ role: "user" | "assistant" | "system"; content: string }>, _opts: AgentCompleteOpts) {
    const content = this.responses.shift();
    if (!content) throw new Error("test response queue exhausted");
    return { content };
  }
}

const lowQuality: Output = {
  summary: "Task analyzed by AI agent",
  result: "The model did not return a structured result.",
  confidence: "medium",
  steps: [],
  needsHumanReview: true,
};

const accepted: Output = {
  summary: "Inspected the task and applied the requested fix.",
  result: "The requested fix was completed successfully.",
  confidence: "high",
  steps: ["Inspect the affected code", "Apply and verify the fix"],
  needsHumanReview: false,
};

describe("BaseAgent quality boundary", () => {
  it("retries with corrective feedback and accepts the final valid assessment", async () => {
    const agent = new TestTaskAgent([lowQuality, accepted]);
    const progress: string[] = [];
    const result = await agent.run(undefined, {
      qualityProfile: "task_execution",
      onProgress: (message) => {
        progress.push(message);
      },
    });

    expect(result._qualityError).toBeUndefined();
    expect(result.result).toBe(accepted.result);
    expect(progress).toContain("Retrying — improving output quality…");
  });

  it("returns only a bounded quality marker after the final low-quality attempt", async () => {
    const agent = new TestTaskAgent([lowQuality, lowQuality, lowQuality]);
    const result = await agent.run(undefined, { qualityProfile: "task_execution" });

    expect(result._qualityError).toMatchObject({
      code: "QUALITY_REVIEW_LOW",
    });
    expect(result._qualityError?.score).toBeGreaterThanOrEqual(0);
    expect(result._qualityError?.score).toBeLessThanOrEqual(1);
    expect(result._qualityError?.threshold).toBeGreaterThanOrEqual(0);
    expect(result._qualityError?.threshold).toBeLessThanOrEqual(1);
    expect(result._qualityError?.reasons.length).toBeLessThanOrEqual(8);
    expect(JSON.stringify(result._qualityError)).not.toContain("structured result");
  });
});