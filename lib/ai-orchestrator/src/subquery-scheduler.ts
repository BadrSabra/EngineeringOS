/**
 * Server-owned scheduling for decomposed project queries.
 *
 * The query planner is intentionally allowed to return plain sub-query text.
 * This module turns that text into a bounded execution order without asking a
 * provider to decide which evidence should be read first.
 */

export type SubQueryRole =
  | "ACCEPTANCE_GATE"
  | "EVIDENCE_PRODUCER"
  | "PROVIDER_ADAPTER"
  | "TEST_COUNTEREVIDENCE"
  | "GENERAL";

export type ScheduledSubQuery = {
  originalIndex: number;
  intent: string;
  role: SubQueryRole;
  targetPaths: string[];
  dependsOn: number[];
  expectedEvidenceValue: number;
  objectiveProximity: number;
  readCost: number;
  gapLikelihood: number;
  priorityScore: number;
};

export type SubQueryScheduleInput = {
  subQueries: readonly string[];
  targetFiles: readonly string[];
  objectiveText?: string;
  requiredEvidencePaths?: readonly string[];
};

type RoleProfile = {
  role: SubQueryRole;
  phase: number;
  evidenceValue: number;
  gapLikelihood: number;
  patterns: readonly RegExp[];
  pathPatterns: readonly RegExp[];
};

const ROLE_PROFILES: readonly RoleProfile[] = [
  {
    role: "ACCEPTANCE_GATE",
    phase: 1,
    evidenceValue: 1,
    gapLikelihood: 0.78,
    patterns: [
      /\b(?:acceptance|acceptance\s+gate|gate|objective|contract|verdict|validation|prove|proof|criteria)\b/iu,
      /(?:بوابة|قبول|الموضوع|الهدف|العقد|التحقق|إثبات|معيار|حكم)/iu,
    ],
    pathPatterns: [/(?:accept|gate|contract|verif|validat|verdict|objective)/iu],
  },
  {
    role: "EVIDENCE_PRODUCER",
    phase: 0.86,
    evidenceValue: 0.94,
    gapLikelihood: 0.84,
    patterns: [
      /\b(?:evidence|producer|emit|emits|trace|source|handler|service|use\s*case|controller|flow|read)\b/iu,
      /(?:دليل|منتج|مصدر|تتبع|معالج|خدمة|تدفق|قراءة)/iu,
    ],
    pathPatterns: [/(?:evidence|trace|emit|producer|handler|service|use.?case|controller|flow)/iu],
  },
  {
    role: "PROVIDER_ADAPTER",
    phase: 0.7,
    evidenceValue: 0.82,
    gapLikelihood: 0.88,
    patterns: [
      /\b(?:provider|adapter|client|gateway|integration|connector|transport|fallback|recovery)\b/iu,
      /(?:مزود|موائم|عميل|بوابة|تكامل|موصل|نقل|بديل|استرداد)/iu,
    ],
    pathPatterns: [/(?:provider|adapter|client|gateway|integrat|connector|transport|fallback|recover)/iu],
  },
  {
    role: "TEST_COUNTEREVIDENCE",
    phase: 0.54,
    evidenceValue: 0.79,
    gapLikelihood: 0.97,
    patterns: [
      /\b(?:test|tests|spec|fixture|regression|counterevidence|coverage|assert|scenario)\b/iu,
      /(?:اختبار|اختبارات|تغطية|fixture|سيناريو|نقض|دحض)/iu,
    ],
    pathPatterns: [/(?:^|[./_-])(?:test|tests|spec|fixture)(?:[./_-]|$)/iu],
  },
];

function normalize(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}_.:/-]+/gu, " ")
    .trim();
}

function normalizePath(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/^(\.\/)+/, "");
}

function tokens(value: string): Set<string> {
  return new Set(
    normalize(value)
      .split(/[\s/:_.-]+/u)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3),
  );
}

function overlap(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / Math.max(left.size, right.size);
}

function pathMatchesRole(path: string, profile: RoleProfile): boolean {
  return profile.pathPatterns.some((pattern) => pattern.test(path));
}

function classifyRole(intent: string, targetFiles: readonly string[]): SubQueryRole {
  // Intent wording is stronger than the shared target-file list. Every task
  // may receive the same bounded manifest, so using paths first would classify
  // all tasks as whichever role-owned file happens to appear first.
  const normalizedIntent = normalize(intent);
  const strongRoleHint: Array<[SubQueryRole, RegExp]> = [
    ["TEST_COUNTEREVIDENCE", /\b(?:test|tests|spec|fixture|regression|counterevidence|coverage|assert|scenario)\b|(?:اختبار|اختبارات|تغطية|سيناريو|نقض|دحض)/iu],
    ["PROVIDER_ADAPTER", /\b(?:provider|adapter|client|gateway|integration|connector|transport|fallback|recovery)\b|(?:مزود|موائم|عميل|بوابة|تكامل|موصل|نقل|بديل|استرداد)/iu],
    ["ACCEPTANCE_GATE", /\b(?:acceptance|gate|objective|contract|verdict|validation|prove|proof|criteria)\b|(?:بوابة|قبول|الهدف|العقد|التحقق|إثبات|معيار|حكم)/iu],
    ["EVIDENCE_PRODUCER", /\b(?:evidence|producer|emit|emits|trace|source|handler|service|use\s*case|controller|flow)\b|(?:دليل|منتج|مصدر|تتبع|معالج|خدمة|تدفق|قراءة)/iu],
  ];
  const strongMatch = strongRoleHint.find(([, pattern]) => pattern.test(normalizedIntent));
  if (strongMatch) return strongMatch[0];
  const intentProfile = ROLE_PROFILES
    .map((candidate) => ({
      candidate,
      matchCount: candidate.patterns.filter((pattern) => pattern.test(intent)).length,
    }))
    .filter((entry) => entry.matchCount > 0)
    .sort((left, right) =>
      right.matchCount - left.matchCount
      || right.candidate.phase - left.candidate.phase,
    )[0]?.candidate;
  const pathProfiles = ROLE_PROFILES.filter((candidate) =>
    targetFiles.some((path) => pathMatchesRole(path, candidate)),
  );
  const profile = intentProfile ?? (pathProfiles.length === 1 ? pathProfiles[0] : undefined);
  return profile?.role ?? "GENERAL";
}

function profileFor(role: SubQueryRole): RoleProfile {
  return ROLE_PROFILES.find((profile) => profile.role === role) ?? {
    role: "GENERAL",
    phase: 0.38,
    evidenceValue: 0.5,
    gapLikelihood: 0.58,
    patterns: [],
    pathPatterns: [],
  };
}

function scopedPaths(
  role: SubQueryRole,
  targetFiles: readonly string[],
  requiredEvidencePaths: readonly string[],
): string[] {
  const profile = profileFor(role);
  const all = [...new Set([
    ...targetFiles.map(normalizePath),
    ...requiredEvidencePaths.map(normalizePath),
  ].filter(Boolean))];
  const matching = all.filter((path) => pathMatchesRole(path, profile));
  // Keep the server-owned objective paths available to every role when no
  // role-specific source was identified. This prevents an overconfident
  // classifier from silently removing required evidence.
  if (matching.length > 0) {
    const required = requiredEvidencePaths.map(normalizePath).filter(Boolean);
    return [...new Set([...matching, ...required])].slice(0, 12);
  }
  return all.slice(0, 12);
}

function dependencyRoles(role: SubQueryRole): SubQueryRole[] {
  switch (role) {
    case "EVIDENCE_PRODUCER":
      return ["ACCEPTANCE_GATE"];
    case "PROVIDER_ADAPTER":
      return ["ACCEPTANCE_GATE", "EVIDENCE_PRODUCER"];
    case "TEST_COUNTEREVIDENCE":
      return ["ACCEPTANCE_GATE", "EVIDENCE_PRODUCER", "PROVIDER_ADAPTER"];
    case "GENERAL":
      return ["ACCEPTANCE_GATE"];
    default:
      return [];
  }
}

/**
 * Order sub-queries by expected proof value while preserving safe phase
 * dependencies. The returned dependency IDs are original indexes, so callers
 * can reorder tasks without losing durable identity.
 */
export function scheduleSubQueries(input: SubQueryScheduleInput): ScheduledSubQuery[] {
  const objectiveTokens = tokens([
    input.objectiveText ?? "",
    ...(input.requiredEvidencePaths ?? []),
  ].join(" "));
  const raw = input.subQueries.map((intent, originalIndex) => {
    const role = classifyRole(intent, input.targetFiles);
    const profile = profileFor(role);
    const scoped = scopedPaths(role, input.targetFiles, input.requiredEvidencePaths ?? []);
    const intentTokens = tokens(intent);
    const objectiveProximity = Math.min(
      1,
      overlap(intentTokens, objectiveTokens) + (role === "ACCEPTANCE_GATE" ? 0.2 : 0),
    );
    const readCost = Math.min(1, scoped.length / 8);
    const lowCostScore = 1 - readCost;
    const priorityScore =
      (profile.evidenceValue * 0.30)
      + (objectiveProximity * 0.25)
      + (profile.gapLikelihood * 0.20)
      + (lowCostScore * 0.10)
      + (profile.phase * 0.15);
    return {
      originalIndex,
      intent,
      role,
      targetPaths: scoped,
      dependsOn: [] as number[],
      expectedEvidenceValue: profile.evidenceValue,
      objectiveProximity,
      readCost,
      gapLikelihood: profile.gapLikelihood,
      priorityScore,
    };
  });

  const ordered = [...raw].sort((left, right) =>
    right.priorityScore - left.priorityScore
    || profileFor(right.role).phase - profileFor(left.role).phase
    || left.originalIndex - right.originalIndex,
  );
  const byRole = new Map<SubQueryRole, number[]>();
  for (const item of ordered) {
    const ids = byRole.get(item.role) ?? [];
    ids.push(item.originalIndex);
    byRole.set(item.role, ids);
  }
  for (const item of ordered) {
    const dependencyIds = new Set<number>();
    for (const role of dependencyRoles(item.role)) {
      for (const id of byRole.get(role) ?? []) {
        if (id !== item.originalIndex) dependencyIds.add(id);
      }
    }
    item.dependsOn = [...dependencyIds];
  }

  return ordered;
}