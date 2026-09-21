import { z } from "zod";
import type { ObjectiveContract } from "./schemas/chat.schema.js";

/**
 * A gap candidate is not accepted merely because a provider described it.
 * These are the server-owned terminal classifications after bounded
 * counter-evidence checks have run.
 */
export const GapFalsificationClassificationSchema = z.enum([
  "CONFIRMED_GAP",
  "PARTIALLY_COVERED",
  "CONTRADICTED",
  "UNPROVEN",
]);
export type GapFalsificationClassification = z.infer<
  typeof GapFalsificationClassificationSchema
>;

export const GapFalsificationProbeKindSchema = z.enum([
  "ALTERNATIVE_ADAPTER_OR_RECOVERY",
  "TEST_COUNTEREVIDENCE",
  "INTERFACE_IMPLEMENTATION",
]);
export type GapFalsificationProbeKind = z.infer<
  typeof GapFalsificationProbeKindSchema
>;

export type GapFalsificationProbe = {
  probeId: string;
  claimId: string;
  kind: GapFalsificationProbeKind;
  question: string;
  searchTerms: string[];
  allowedRoots: string[];
};

export type GapFalsificationProbeObservation = {
  probeId: string;
  /**
   * COMPLETE means the server observed the bounded search/read operation.
   * A matching search result without a direct source read is not evidence.
   */
  coverage: "COMPLETE" | "PARTIAL" | "MISSING";
  evidencePaths: string[];
  /** A source body was read and contains an implementation/counterexample. */
  counterEvidence: boolean;
};

export type GapFalsificationResult = {
  claimId: string;
  classification: GapFalsificationClassification;
  probeIds: string[];
  counterEvidencePaths: string[];
  missingProbeIds: string[];
  reason: string;
};

export type GapFalsificationReport = {
  version: "gap-falsification-v1";
  results: GapFalsificationResult[];
};

const PROBE_DEFINITIONS: readonly {
  kind: GapFalsificationProbeKind;
  question: string;
  searchTerms: string[];
}[] = [
  {
    kind: "ALTERNATIVE_ADAPTER_OR_RECOVERY",
    question:
      "Is there an alternative adapter, fallback, retry, recovery, or error path that covers the alleged gap?",
    searchTerms: [
      "fallback",
      "recovery",
      "recover",
      "adapter",
      "retry",
      "alternate",
      "catch",
    ],
  },
  {
    kind: "TEST_COUNTEREVIDENCE",
    question:
      "Do tests or fixtures exercise the allegedly missing behavior or assert the opposite outcome?",
    searchTerms: ["describe(", "it(", "test(", "expect(", "regression", "fallback", "recovery"],
  },
  {
    kind: "INTERFACE_IMPLEMENTATION",
    question:
      "Is the behavior implemented behind another interface, strategy, provider, or implementation boundary?",
    searchTerms: ["interface", "implements", "extends", "strategy", "provider", "adapter"],
  },
];

function isGapObjective(objective: ObjectiveContract): boolean {
  return objective.objectiveType === "PROJECT_QUERY_GAP-ANALYSIS"
    || (
      objective.objectiveType === "PROJECT_QUERY_EMBEDDED-AI"
      && /(?:gap|weakness|فجوات?|نقاط\s+ضعف|خلل)/iu.test(objective.goal ?? "")
    );
}

function normalizePath(value: string): string {
  return value
    .replace(/\\/g, "/")
    .replace(/^(\.\/)+/, "")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .trim();
}

function isWithinRoot(path: string, root: string): boolean {
  const normalizedPath = normalizePath(path);
  const normalizedRoot = normalizePath(root);
  return normalizedPath === normalizedRoot
    || normalizedPath.startsWith(`${normalizedRoot}/`);
}

/**
 * Derive the bounded falsification work from the existing objective. This is
 * a projection, not a second acceptance contract, and never uses provider
 * prose or provider-selected paths.
 */
export function buildGapFalsificationPlan(input: {
  objective: ObjectiveContract;
  maxClaims?: number;
}): GapFalsificationProbe[] {
  if (!isGapObjective(input.objective)) return [];
  const allowedRoots = [
    ...(input.objective.scopePolicy?.primaryPaths ?? []),
    ...(input.objective.scopePolicy?.allowedExpansionPaths ?? []),
  ]
    .map(normalizePath)
    .filter(Boolean)
    .filter((path, index, all) => all.indexOf(path) === index);
  const maxClaims = Math.max(0, Math.min(12, Math.floor(input.maxClaims ?? 12)));
  return input.objective.requiredClaims
    .filter((claim) => !claim.claimId.startsWith("edge:"))
    .slice(0, maxClaims)
    .flatMap((claim) =>
      PROBE_DEFINITIONS.map((definition) => ({
        probeId: `${claim.claimId}:${definition.kind.toLowerCase()}`,
        claimId: claim.claimId,
        kind: definition.kind,
        question: definition.question,
        searchTerms: [...definition.searchTerms],
        allowedRoots: [...allowedRoots],
      })),
    );
}

/**
 * Classify one gap only after its primary source assertion and every bounded
 * falsification probe have been evaluated. Absence of a counterexample is not
 * enough for CONFIRMED_GAP unless the source contains an explicit negative
 * signal for the alleged behavior.
 */
export function classifyGapFalsification(input: {
  claimId: string;
  primaryEvidenceComplete: boolean;
  explicitNegativeEvidence: boolean;
  probes: readonly GapFalsificationProbeObservation[];
}): GapFalsificationResult {
  const missingProbeIds = input.probes
    .filter((probe) => probe.coverage !== "COMPLETE")
    .map((probe) => probe.probeId);
  const counterEvidencePaths = input.probes
    .filter((probe) => probe.counterEvidence)
    .flatMap((probe) => probe.evidencePaths)
    .map(normalizePath)
    .filter(Boolean)
    .filter((path, index, all) => all.indexOf(path) === index);
  const complete = input.primaryEvidenceComplete && missingProbeIds.length === 0;
  const implementationCounterEvidence = input.probes.some(
    (probe) =>
      probe.counterEvidence
      && (
        probe.probeId.endsWith(":alternative_adapter_or_recovery")
        || probe.probeId.endsWith(":interface_implementation")
      ),
  );
  const testCounterEvidence = input.probes.some(
    (probe) =>
      probe.counterEvidence && probe.probeId.endsWith(":test_counterevidence"),
  );

  let classification: GapFalsificationClassification;
  let reason: string;
  if (!complete) {
    classification = "UNPROVEN";
    reason = "primary evidence or one or more bounded falsification probes is incomplete";
  } else if (implementationCounterEvidence) {
    classification = "CONTRADICTED";
    reason = "a directly read alternative implementation or recovery boundary contradicts the gap";
  } else if (testCounterEvidence) {
    classification = "PARTIALLY_COVERED";
    reason = "tests provide counterevidence, but tests alone do not prove production coverage";
  } else if (input.explicitNegativeEvidence) {
    classification = "CONFIRMED_GAP";
    reason = "complete primary evidence shows an explicit missing or failing behavior and no counterevidence was found";
  } else {
    classification = "UNPROVEN";
    reason = "complete reads do not contain a server-owned explicit negative signal for the alleged gap";
  }

  return {
    claimId: input.claimId,
    classification,
    probeIds: input.probes.map((probe) => probe.probeId),
    counterEvidencePaths,
    missingProbeIds,
    reason,
  };
}

function bodyHasExplicitNegativeSignal(body: string): boolean {
  return /(?:no|without|missing|not\s+implemented|unsupported|unhandled|does\s+not\s+handle|لا\s+(?:يوجد|يدعم|يعالج)|غير\s+مدعوم|غير\s+معالج|يفتقد)/iu.test(
    body,
  );
}

function bodyMatchesProbe(body: string, kind: GapFalsificationProbeKind): boolean {
  const patterns: Record<GapFalsificationProbeKind, RegExp> = {
    ALTERNATIVE_ADAPTER_OR_RECOVERY:
      /(?:fallback|recovery|recover|adapter|retry|alternate|catch|finally)/iu,
    TEST_COUNTEREVIDENCE:
      /(?:describe\s*\(|it\s*\(|test\s*\(|expect\s*\(|regression|fixture)/iu,
    INTERFACE_IMPLEMENTATION:
      /(?:interface\s+\w+|implements\s+\w+|extends\s+\w+|strategy|provider|adapter)/iu,
  };
  return patterns[kind].test(body);
}

function sourceSupportsClaimContext(
  body: string,
  claim: ObjectiveContract["requiredClaims"][number] | undefined,
): boolean {
  if (!claim) return false;
  const explicitNeedles = claim.evidenceNeedles
    ?? Object.values(claim.evidenceNeedlesByPath ?? {}).flat();
  const needles = explicitNeedles.length > 0
    ? explicitNeedles
    : claim.text
        .split(/[^a-zA-Z0-9_\u0600-\u06FF]+/u)
        .filter((token) => token.length >= 6);
  const normalizedBody = body.toLocaleLowerCase();
  return needles.some((needle) =>
    normalizedBody.includes(needle.toLocaleLowerCase()),
  );
}

/**
 * Build the report from source bodies and server-recorded search labels.
 * Search results only establish probe coverage; a counterexample still needs
 * a directly read body in the declared scope.
 */
export function buildGapFalsificationReport(input: {
  objective: ObjectiveContract;
  fileContents: ReadonlyMap<string, string>;
  toolSources?: readonly string[];
}): GapFalsificationReport {
  const plan = buildGapFalsificationPlan({ objective: input.objective });
  const searchLabels = (input.toolSources ?? [])
    .filter((source) => source.startsWith("search:"))
    .map((source) => source.slice("search:".length).toLowerCase());
  const byClaim = new Map<string, GapFalsificationProbe[]>();
  for (const probe of plan) {
    const list = byClaim.get(probe.claimId) ?? [];
    list.push(probe);
    byClaim.set(probe.claimId, list);
  }
  const results = [...byClaim.entries()].map(([claimId, probes]) => {
    const claim = input.objective.requiredClaims.find((item) => item.claimId === claimId);
    const primaryPaths = (claim?.requiredEvidencePaths ?? []).map(normalizePath);
    const primaryBodies = primaryPaths
      .map((path) => input.fileContents.get(path))
      .filter((body): body is string => typeof body === "string");
    const observations = probes.map((probe): GapFalsificationProbeObservation => {
      const searchCovered = searchLabels.some((label) =>
        probe.searchTerms.some((term) => label.includes(term.toLowerCase())),
      );
      const evidencePaths = [...input.fileContents.entries()]
        .filter(([path, body]) =>
          probe.allowedRoots.length === 0
            || probe.allowedRoots.some((root) => isWithinRoot(path, root)),
        )
        .filter(([, body]) =>
          bodyMatchesProbe(body, probe.kind)
          && sourceSupportsClaimContext(body, claim),
        )
        .map(([path]) => normalizePath(path))
        .filter(Boolean);
      return {
        probeId: probe.probeId,
        coverage: searchCovered ? "COMPLETE" : "MISSING",
        evidencePaths,
        counterEvidence: evidencePaths.length > 0,
      };
    });
    return classifyGapFalsification({
      claimId,
      primaryEvidenceComplete: primaryBodies.length === primaryPaths.length
        && primaryBodies.length > 0,
      explicitNegativeEvidence: primaryBodies.some(bodyHasExplicitNegativeSignal),
      probes: observations,
    });
  });
  return { version: "gap-falsification-v1", results };
}
