import type { CodeAgentBenchmarkCase } from "./code-agent-benchmark.js";

export type BenchmarkShardConfig = {
  index: number;
  count: number;
};

export function parseBenchmarkShardConfig(
  indexRaw?: string,
  countRaw?: string,
): BenchmarkShardConfig | undefined {
  const hasIndex = Boolean(indexRaw?.trim());
  const hasCount = Boolean(countRaw?.trim());
  if (!hasIndex && !hasCount) return undefined;
  if (!hasIndex || !hasCount) {
    throw new Error("Benchmark sharding requires both BENCHMARK_SHARD_INDEX and BENCHMARK_SHARD_COUNT.");
  }

  const index = Number.parseInt(indexRaw!, 10);
  const count = Number.parseInt(countRaw!, 10);
  if (!Number.isInteger(index) || !Number.isInteger(count) || count < 2 || index < 0 || index >= count) {
    throw new Error(`Invalid benchmark shard: index=${indexRaw}, count=${countRaw}. Expected 0 <= index < count and count >= 2.`);
  }
  return { index, count };
}

export function selectBenchmarkShard(
  cases: readonly CodeAgentBenchmarkCase[],
  shard: BenchmarkShardConfig,
): readonly CodeAgentBenchmarkCase[] {
  return cases.filter((_testCase, ordinal) => ordinal % shard.count === shard.index);
}

export function benchmarkShardLabel(shard: BenchmarkShardConfig): string {
  return `shard-${shard.index + 1}-of-${shard.count}`;
}