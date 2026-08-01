import { PROVIDER_PRIORITY, getProviderCapabilities, type ProviderId } from "./provider-registry.js";
import { providerMatchesHints, scoreProviderCapabilities, type ProviderCapabilityHints } from "./provider-capabilities.js";

export type QualityProfile = "chat" | "tool_chat" | "analysis" | "task_execution" | "code_review" | "workflow";

export type QualityPlan = {
  profile: QualityProfile;
  strictHints: ProviderCapabilityHints;
  relaxedHints: ProviderCapabilityHints;
};

export type QualityAssessment = {
  profile: QualityProfile;
  score: number;
  threshold: number;
  decision: "accept" | "retry";
  reasons: string[];
};

export type QualitySortOptions = {
  requireTools?: boolean;
};

function clampScore(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function buildBasePlans(profile: QualityProfile): Pick<QualityPlan, "strictHints" | "relaxedHints"> {
  switch (profile) {
    case "tool_chat":
      return {
        strictHints: {
          requireStreaming: true,
          requireTools: true,
          requireJsonMode: true,
          requireReasoning: true,
          requireFunctionCalling: true,
          requireThinking: true,
        },
        relaxedHints: {
          requireStreaming: true,
          requireTools: true,
          requireJsonMode: true,
          requireReasoning: true,
        },
      };
    case "analysis":
      return {
        strictHints: {
          requireJsonMode: true,
          requireReasoning: true,
          requireThinking: true,
          minimumContext: 16_000,
        },
        relaxedHints: {
          requireJsonMode: true,
          requireReasoning: true,
          minimumContext: 8_000,
        },
      };
    case "task_execution":
      return {
        strictHints: {
          requireJsonMode: true,
          requireReasoning: true,
          requireThinking: true,
          minimumContext: 8_000,
        },
        relaxedHints: {
          requireJsonMode: true,
          requireReasoning: true,
          minimumContext: 4_000,
        },
      };
    case "code_review":
      return {
        strictHints: {
          requireJsonMode: true,
          requireReasoning: true,
          requireThinking: true,
          minimumContext: 12_000,
        },
        relaxedHints: {
          requireJsonMode: true,
          requireReasoning: true,
          minimumContext: 6_000,
        },
      };
    case "workflow":
      // GAP-C2: workflow decisions query tasks/events/graph via the agent's
      // tool loop — a provider that doesn't support function calling cannot
      // execute this profile correctly. Require tools on both strict and
      // relaxed hints so Gemini (supportsTools: false) is never selected.
      return {
        strictHints: {
          requireJsonMode: true,
          requireReasoning: true,
          requireThinking: true,
          requireTools: true,
        },
        relaxedHints: {
          requireJsonMode: true,
          requireReasoning: true,
          requireTools: true,
        },
      };
    case "chat":
    default:
      return {
        strictHints: {
          requireStreaming: true,
          requireReasoning: true,
        },
        relaxedHints: {
          requireStreaming: true,
        },
      };
  }
}

export function buildQualityPlan(profile: QualityProfile, options?: QualitySortOptions): QualityPlan {
  const base = buildBasePlans(profile);
  const strictHints = options?.requireTools
    ? { ...base.strictHints, requireTools: true }
    : base.strictHints;
  const relaxedHints = options?.requireTools
    ? { ...base.relaxedHints, requireTools: true }
    : base.relaxedHints;

  return { profile, strictHints, relaxedHints };
}

export function buildQualityHints(profile: QualityProfile, options?: QualitySortOptions): ProviderCapabilityHints {
  return buildQualityPlan(profile, options).strictHints;
}

export function sortProviderIdsByQuality(
  providerIds: ProviderId[],
  profile: QualityProfile,
  options?: QualitySortOptions,
): ProviderId[] {
  const uniqueIds = [...new Set(providerIds)].filter((id) => PROVIDER_PRIORITY.includes(id));
  if (uniqueIds.length <= 1) return uniqueIds;

  const plan = buildQualityPlan(profile, options);
  const strictMatches = uniqueIds.filter((providerId) => providerMatchesHints(getProviderCapabilities(providerId), plan.strictHints));
  const relaxedMatches = uniqueIds.filter((providerId) => providerMatchesHints(getProviderCapabilities(providerId), plan.relaxedHints));
  const pool = strictMatches.length > 0 ? strictMatches : relaxedMatches.length > 0 ? relaxedMatches : uniqueIds;
  const scoringHints = strictMatches.length > 0 ? plan.strictHints : plan.relaxedHints;

  return [...pool].sort((a, b) => {
    const scoreA = scoreProviderCapabilities(getProviderCapabilities(a), scoringHints);
    const scoreB = scoreProviderCapabilities(getProviderCapabilities(b), scoringHints);
    if (scoreA !== scoreB) return scoreB - scoreA;

    const priorityA = PROVIDER_PRIORITY.indexOf(a);
    const priorityB = PROVIDER_PRIORITY.indexOf(b);
    if (priorityA !== priorityB) return priorityA - priorityB;

    return a.localeCompare(b);
  });
}

const PLACEHOLDER_PATTERNS: RegExp[] = [
  /model did not return/i,
  /analysis completed/i,
  /task analyzed by ai agent/i,
  /code review completed/i,
  /workflow decision/i,
  /review the detailed analysis above/i,
  /review the workflow state manually/i,
  /please try again/i,
  /please review/i,
];

function isPlaceholderText(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(trimmed));
}

function countMeaningfulStrings(record: Record<string, unknown>): { total: number; meaningful: number; placeholder: number } {
  let total = 0;
  let meaningful = 0;
  let placeholder = 0;
  for (const value of Object.values(record)) {
    if (typeof value !== "string") continue;
    total += 1;
    if (isPlaceholderText(value)) {
      placeholder += 1;
    } else if (value.trim().length > 0) {
      meaningful += 1;
    }
  }
  return { total, meaningful, placeholder };
}

function countMeaningfulArrays(record: Record<string, unknown>): { total: number; nonEmpty: number } {
  let total = 0;
  let nonEmpty = 0;
  for (const value of Object.values(record)) {
    if (!Array.isArray(value)) continue;
    total += 1;
    if (value.length > 0) nonEmpty += 1;
  }
  return { total, nonEmpty };
}

function profileThreshold(profile: QualityProfile): number {
  switch (profile) {
    case "analysis":
    case "code_review":
      return 0.78;
    case "task_execution":
      return 0.75;
    case "workflow":
      return 0.72;
    case "tool_chat":
      return 0.7;
    case "chat":
    default:
      return 0.68;
  }
}

export function assessStructuredOutput(profile: QualityProfile, output: unknown): QualityAssessment {
  const threshold = profileThreshold(profile);
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    return {
      profile,
      score: 0,
      threshold,
      decision: "retry",
      reasons: ["structured output was not an object"],
    };
  }

  const record = output as Record<string, unknown>;
  const strings = countMeaningfulStrings(record);
  const arrays = countMeaningfulArrays(record);
  const reasons: string[] = [];

  let score = 0.34;
  score += Math.min(0.18, strings.meaningful * 0.045);
  score -= Math.min(0.18, strings.placeholder * 0.09);
  score += Math.min(0.12, arrays.nonEmpty * 0.04);

  switch (profile) {
    case "analysis": {
      const insights = record.insights;
      if (Array.isArray(insights) && insights.length > 0) score += 0.1;
      else reasons.push("analysis insights are empty");

      const assessment = record.overallAssessment;
      if (typeof assessment === "string" && !isPlaceholderText(assessment)) score += 0.08;
      else reasons.push("overall assessment looks like placeholder text");

      const priority = record.topPriority;
      if (typeof priority === "string" && !isPlaceholderText(priority)) score += 0.05;
      else reasons.push("top priority is missing or placeholder");
      break;
    }

    case "code_review": {
      const issues = record.issues;
      const strengths = record.strengths;
      if (Array.isArray(issues) && Array.isArray(strengths)) {
        score += 0.06;
        if (issues.length > 0 || strengths.length > 0) score += 0.08;
      } else {
        reasons.push("code review arrays are missing");
      }

      const verdict = record.verdict;
      if (typeof verdict === "string" && verdict.length > 0) score += 0.06;
      else reasons.push("verdict is missing");
      break;
    }

    case "task_execution": {
      const steps = record.steps;
      if (Array.isArray(steps) && steps.length > 0) score += 0.1;
      else reasons.push("task steps are empty");

      const result = record.result;
      if (typeof result === "string" && !isPlaceholderText(result)) score += 0.08;
      else reasons.push("task result looks like fallback text");

      const summary = record.summary;
      if (typeof summary === "string" && !isPlaceholderText(summary)) score += 0.04;

      const confidence = record.confidence;
      if (typeof confidence === "string" && confidence.length > 0) score += 0.04;
      break;
    }

    case "workflow": {
      const reasoning = record.reasoning;
      if (typeof reasoning === "string" && !isPlaceholderText(reasoning)) score += 0.08;
      else reasons.push("workflow reasoning is missing or placeholder");

      const suggestions = record.suggestions;
      if (Array.isArray(suggestions) && suggestions.length > 0) score += 0.05;
      else reasons.push("workflow suggestions are empty");
      break;
    }

    case "tool_chat": {
      const response = record.response;
      if (typeof response === "string" && !isPlaceholderText(response)) score += 0.12;
      else reasons.push("chat response looks like fallback text");
      break;
    }

    case "chat":
    default: {
      const response = record.response;
      if (typeof response === "string" && !isPlaceholderText(response)) score += 0.12;
      else reasons.push("chat response looks like fallback text");
      break;
    }
  }

  const normalized = clampScore(score);
  if (normalized < threshold) {
    reasons.push(`quality score ${normalized.toFixed(2)} is below threshold ${threshold.toFixed(2)}`);
  }

  return {
    profile,
    score: normalized,
    threshold,
    decision: normalized >= threshold ? "accept" : "retry",
    reasons,
  };
}
