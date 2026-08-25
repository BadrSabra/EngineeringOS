import {
  getCodeAgentBenchmarkCases,
  validateCodeAgentBenchmarkManifest,
  type CodeAgentBenchmarkCase,
} from "./code-agent-benchmark.js";
import { getCodeAgentBenchmarkFixture, validateCodeAgentBenchmarkFixtureContracts } from "./code-agent-benchmark-fixtures.js";

export type CodeAgentBenchmarkScenarioCoverage = {
  manifestScenarioIds: readonly string[];
  coveredScenarioIds: readonly string[];
  missingScenarioIds: readonly string[];
  unrecognizedScenarioIds: readonly string[];
  errors: readonly string[];
};

/**
 * Check the complete manifest against the focused, executable fixture
 * contracts. This is intentionally provider-free so release validation can
 * fail before any provider-backed benchmark work starts.
 */
export function validateCodeAgentBenchmarkScenarioCoverage(
  cases: readonly CodeAgentBenchmarkCase[] = getCodeAgentBenchmarkCases(),
): CodeAgentBenchmarkScenarioCoverage {
  const manifestScenarioIds = cases.map((testCase) => testCase.id);
  const manifestIds = new Set(manifestScenarioIds);
  const errors = [
    ...validateCodeAgentBenchmarkManifest(cases, {
      requireComplete: cases.length === getCodeAgentBenchmarkCases().length,
    }),
    ...validateCodeAgentBenchmarkFixtureContracts(cases),
  ];

  const coveredScenarioIds = cases.flatMap((testCase) => {
    try {
      const fixture = getCodeAgentBenchmarkFixture(testCase);
      return fixture.targetPaths.length > 0 && Boolean(fixture.setup?.trim()) &&
        Boolean(fixture.postcondition?.trim()) &&
        Boolean(fixture.behavioralOracle || fixture.runtimeOracle)
        ? [testCase.id]
        : [];
    } catch {
      return [];
    }
  });
  const coveredIds = new Set(coveredScenarioIds);
  const missingScenarioIds = manifestScenarioIds.filter((id) => !coveredIds.has(id));

  // Keep this explicit even though the current fixture contract is manifest
  // driven: it makes a future independently registered fixture unable to
  // silently become a release scenario.
  const unrecognizedScenarioIds = coveredScenarioIds.filter((id) => !manifestIds.has(id));
  if (missingScenarioIds.length > 0) {
    errors.push(`missing focused fixture checks: ${missingScenarioIds.join(", ")}`);
  }
  if (unrecognizedScenarioIds.length > 0) {
    errors.push(`unrecognized focused fixture scenarios: ${unrecognizedScenarioIds.join(", ")}`);
  }

  return {
    manifestScenarioIds,
    coveredScenarioIds,
    missingScenarioIds,
    unrecognizedScenarioIds,
    errors,
  };
}

const coverage = validateCodeAgentBenchmarkScenarioCoverage();
console.log(
  `Focused benchmark fixture checks cover ${coverage.coveredScenarioIds.length}/${coverage.manifestScenarioIds.length} manifest scenarios: ${coverage.coveredScenarioIds.join(", ")}`,
);
if (coverage.errors.length > 0) {
  throw new Error(`Invalid Code Agent benchmark scenario coverage: ${coverage.errors.join("; ")}`);
}