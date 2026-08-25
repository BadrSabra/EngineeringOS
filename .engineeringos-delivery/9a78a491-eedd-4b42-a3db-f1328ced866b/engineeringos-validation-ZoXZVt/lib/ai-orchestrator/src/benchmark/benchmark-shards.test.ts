import { describe, expect, it } from "vitest";
import { getCodeAgentBenchmarkCases } from "./code-agent-benchmark.js";
import {
  benchmarkShardLabel,
  parseBenchmarkShardConfig,
  selectBenchmarkShard,
} from "./benchmark-shards.js";

describe("benchmark shard planner", () => {
  it("splits the manifest deterministically by ordinal", () => {
    const cases = getCodeAgentBenchmarkCases();
    const shard = parseBenchmarkShardConfig("1", "6")!;
    const selected = selectBenchmarkShard(cases, shard);

    expect(benchmarkShardLabel(shard)).toBe("shard-2-of-6");
    expect(selected.map((testCase) => testCase.id)).toEqual([
      cases[1]!.id,
      cases[7]!.id,
      cases[13]!.id,
      cases[19]!.id,
      cases[25]!.id,
      cases[31]!.id,
    ]);
  });

  it("rejects incomplete or out-of-range shard configuration", () => {
    expect(() => parseBenchmarkShardConfig("0", undefined)).toThrow(
      "requires both BENCHMARK_SHARD_INDEX and BENCHMARK_SHARD_COUNT",
    );
    expect(() => parseBenchmarkShardConfig("6", "6")).toThrow("Expected 0 <= index < count");
    expect(() => parseBenchmarkShardConfig("0", "1")).toThrow("count >= 2");
  });
});