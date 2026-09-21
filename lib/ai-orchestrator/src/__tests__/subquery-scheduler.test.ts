import { describe, expect, it } from "vitest";
import { scheduleSubQueries } from "../subquery-scheduler.js";

describe("server-owned sub-query scheduler", () => {
  const targetFiles = [
    "src/acceptance-gate.ts",
    "src/evidence-producer.ts",
    "src/provider-adapter.ts",
    "src/handler.test.ts",
  ];

  it("orders acceptance, producer, adapter, and tests with dependencies", () => {
    const schedule = scheduleSubQueries({
      subQueries: [
        "Which tests cover the behavior?",
        "How does the provider adapter handle the request?",
        "What evidence producer emits the accepted claim?",
        "What is the acceptance gate and objective closure rule?",
      ],
      targetFiles,
      objectiveText: "Prove the request reaches the provider and is accepted by the objective gate.",
      requiredEvidencePaths: ["src/acceptance-gate.ts", "src/evidence-producer.ts"],
    });

    expect(schedule.map((item) => item.role)).toEqual([
      "ACCEPTANCE_GATE",
      "EVIDENCE_PRODUCER",
      "PROVIDER_ADAPTER",
      "TEST_COUNTEREVIDENCE",
    ]);
    expect(schedule[0]?.dependsOn).toEqual([]);
    expect(schedule[1]?.dependsOn).toContain(schedule[0]?.originalIndex);
    expect(schedule[2]?.dependsOn).toEqual(
      expect.arrayContaining([schedule[0]!.originalIndex, schedule[1]!.originalIndex]),
    );
    expect(schedule[3]?.dependsOn).toEqual(
      expect.arrayContaining([
        schedule[0]!.originalIndex,
        schedule[1]!.originalIndex,
        schedule[2]!.originalIndex,
      ]),
    );
  });

  it("narrows role-specific reads without dropping required objective paths", () => {
    const schedule = scheduleSubQueries({
      subQueries: [
        "Inspect the provider adapter and fallback client.",
        "Read the test counterevidence.",
      ],
      targetFiles,
      requiredEvidencePaths: ["src/acceptance-gate.ts"],
    });

    const adapter = schedule.find((item) => item.role === "PROVIDER_ADAPTER");
    const tests = schedule.find((item) => item.role === "TEST_COUNTEREVIDENCE");
    expect(adapter?.targetPaths).toContain("src/acceptance-gate.ts");
    expect(adapter?.targetPaths).toContain("src/provider-adapter.ts");
    expect(tests?.targetPaths).toContain("src/acceptance-gate.ts");
    expect(tests?.targetPaths).toContain("src/handler.test.ts");
  });

  it("keeps unrelated sub-queries independent so they can share a wave", () => {
    const schedule = scheduleSubQueries({
      subQueries: [
        "Summarize the deployment configuration.",
        "List the database schema entities.",
      ],
      targetFiles: ["deploy.yaml", "src/db/schema.ts"],
      objectiveText: "Explain the project structure.",
    });

    expect(schedule).toHaveLength(2);
    expect(schedule.every((item) => item.role === "GENERAL")).toBe(true);
    expect(schedule.every((item) => item.dependsOn.length === 0)).toBe(true);
  });
});