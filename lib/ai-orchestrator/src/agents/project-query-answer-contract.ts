export type ProjectQueryAnswerObjective = {
  objectiveType: string;
  goal?: string;
  requiredClaims: readonly {
    claimId: string;
    text: string;
  }[];
};

export type ProjectQueryAnswerCandidate = {
  text: string;
  claimRefs?: readonly string[];
  flowRefs?: readonly string[];
};

function normalizedText(value: string): string {
  return value.replace(/\s+/gu, " ").trim().toLocaleLowerCase();
}

function missionObservationGoalAnchors(goal: string): string[] {
  const fileTokens = new Set<string>();
  const sourceFiles =
    goal.match(/\b(?:[\w.-]+\/)*[\w.-]+\.(?:md|json|mjs|cjs|ts|tsx|js|jsx|yaml|yml|toml)\b/giu) ?? [];
  for (const sourceFile of sourceFiles) {
    const basename = sourceFile.split("/").at(-1) ?? sourceFile;
    fileTokens.add(sourceFile.toLocaleLowerCase());
    fileTokens.add(basename.toLocaleLowerCase());
    fileTokens.add(basename.replace(/\.[^.]+$/u, "").toLocaleLowerCase());
  }

  const candidates = [
    ...(goal.match(/\b[A-Z][A-Z0-9_]{2,}\b/gu) ?? []),
    ...(goal.match(/\b[A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*\b/gu) ?? []),
    ...(goal.match(/\b(?:null|undefined|true|false)\b/giu) ?? []),
  ];
  return [...new Set(candidates.map((anchor) => anchor.toLocaleLowerCase()))]
    .filter((anchor) => !fileTokens.has(anchor));
}

function missionObservationGoalAnchorsArePresent(
  objective: ProjectQueryAnswerObjective,
  response: string,
): boolean {
  const anchors = objective.goal
    ? missionObservationGoalAnchors(objective.goal)
    : [];
  // This is a bounded lexical relevance check, not entailment. If the mission
  // goal has no stable technical/value anchors, read obligations alone cannot
  // establish a PROVEN answer.
  if (anchors.length === 0) return false;

  // Mission observation claims are read obligations, not statements of fact.
  // Remove their copied wording before checking relevance: the deterministic
  // fallback embeds the full goal in those obligations, which must not count as
  // an answer to that goal.
  let answerBody = normalizedText(response);
  for (const claim of objective.requiredClaims) {
    const claimText = normalizedText(claim.text);
    if (claimText) answerBody = answerBody.split(claimText).join(" ");
  }
  return anchors.every((anchor) => answerBody.includes(anchor));
}

function missionObservationWithoutRelationIsAffirmed(
  objective: ProjectQueryAnswerObjective,
  response: string,
): boolean {
  const goal = objective.goal ?? "";
  const asksWhetherWithout = /\b(?:can|could|may)\b[^?.!]{0,220}\bwithout\b/iu.test(goal)
    || /(?:هل|أيمكن|يمكن)[^؟?.!]{0,220}(?:بدون|دون)/u.test(goal);
  if (!asksWhetherWithout) return true;

  const answer = normalizedText(response);
  const explicitlyRequiresPrerequisite =
    /\bcompleted\b[^.!?؟;\n]{0,120}\b(?:only\s+if|only\s+when|unless|until|requires?|depends\s+on|must\s+(?:have|match|satisfy))\b[^.!?؟;\n]{0,120}\b(?:proven|proof|acceptance)\b/iu.test(answer)
    || /\b(?:only\s+if|only\s+when|unless|until|requires?|depends\s+on|must\s+(?:have|match|satisfy))\b[^.!?؟;\n]{0,120}\b(?:proven|proof|acceptance)\b[^.!?؟;\n]{0,120}\bcompleted\b/iu.test(answer)
    || /\b(?:cannot|can't|doesn't|does\s+not|never|is\s+unable\s+to|isn't\s+able\s+to|is\s+not\s+able\s+to)\s+(?:return|say|report|output|emit|produce|set|mark|show|display)\b[^.!?؟;\n]{0,100}\bcompleted\b/iu.test(answer)
    || /(?:لا\s+يمكن|لا\s+يستطيع|لا\s+يعيد|لا\s+يقول|لا\s+يعرض|لا\s+ينتج|لا\s+يصدر)[^.!?؟;\n]{0,100}(?:completed|مكتمل)/u.test(answer);
  if (explicitlyRequiresPrerequisite) return false;

  // A binary "without" question is only accepted when the answer explicitly
  // states that the outcome is independent of the named prerequisite. This is
  // deliberately conservative: unsupported phrasing stays incomplete rather
  // than letting goal keywords alone close a Mission.
  return /\b(?:without|regardless\s+of|independent\s+of|ignoring|doesn't\s+(?:check|require|consult|enforce)|does\s+not\s+(?:check|require|consult|enforce)|not\s+(?:required|needed|enforced)|no\s+(?:proof|acceptance)\s+(?:is\s+)?(?:required|needed))\b/iu.test(answer)
    || /(?:بدون|دون|بغض\s+النظر\s+عن|لا\s+يتحقق\s+من|لا\s+يتطلب|غير\s+مطلوب)/u.test(answer);
}

function claimTextIsAffirmed(response: string, claimText: string): boolean {
  const normalizedResponse = normalizedText(response);
  const normalizedClaim = normalizedText(claimText);
  if (!normalizedClaim) return false;

  const claimIndex = normalizedResponse.indexOf(normalizedClaim);
  if (claimIndex < 0) return false;

  // This catches direct negations surrounding a canonical claim. It is
  // intentionally a conservative lexical guard, not a general entailment
  // engine; answer proof is only minted after the complete server-owned
  // objective and evidence gates also pass.
  const before = normalizedResponse.slice(Math.max(0, claimIndex - 100), claimIndex);
  const sameSentenceBefore = before.split(/[.!?؟;\n]/u).at(-1) ?? before;
  const negationBefore = sameSentenceBefore.replace(/\bnot\s+only\b/giu, "");
  if (
    /(?:\b(?:not|never|false|incorrect|unsupported|unproven|no)\b|\b(?:doesn't|don't|didn't|isn't|aren't|wasn't|weren't|cannot|can't)\b)/iu.test(negationBefore)
    || /(?:^|\s)(?:لا|ليس|ليست|لم|لن|غير|منفي)(?:\s|$)/u.test(negationBefore)
  ) {
    return false;
  }

  const after = normalizedResponse.slice(claimIndex + normalizedClaim.length);
  const sameSentenceAfter = after.split(/[.!?؟;\n]/u)[0] ?? after;
  return !/(?:^\s*(?:is|are|was|were)?\s*(?:false|incorrect|unsupported|not\s+true)\b|^\s*(?:خاطئ|غير\s+صحيح|منفي)\b)/iu.test(
    sameSentenceAfter,
  );
}

export function projectQueryClaimRefsAreComplete(
  objective: ProjectQueryAnswerObjective | undefined,
  claimRefs: readonly string[] | undefined,
): boolean {
  if (!objective || claimRefs === undefined) return false;
  const required = objective.requiredClaims.map((claim) => claim.claimId);
  return (
    claimRefs.length === required.length
    && new Set(claimRefs).size === claimRefs.length
    && claimRefs.every((claimId) => required.includes(claimId))
  );
}

export function projectQueryFlowRefsAreValid(
  objective: ProjectQueryAnswerObjective | undefined,
  flowRefs: readonly string[] | undefined,
): boolean {
  if (!objective || flowRefs === undefined || flowRefs.length < 2) return false;
  const required = new Set(objective.requiredClaims.map((claim) => claim.claimId));
  return (
    new Set(flowRefs).size >= 2
    && flowRefs.every((claimId) => required.has(claimId))
  );
}

export function projectQueryCandidateClaimsAreAsserted(
  objective: ProjectQueryAnswerObjective | undefined,
  candidate: ProjectQueryAnswerCandidate,
): boolean {
  if (objective?.objectiveType === "PROJECT_QUERY_MISSION_OBSERVE") {
    return objective.requiredClaims.length > 0
      && projectQueryClaimRefsAreComplete(objective, candidate.claimRefs)
      && missionObservationGoalAnchorsArePresent(objective, candidate.text)
      && missionObservationWithoutRelationIsAffirmed(objective, candidate.text);
  }

  if (
    !objective
    || !objective.requiredClaims.every((claim) =>
      claimTextIsAffirmed(candidate.text, claim.text),
    )
  ) {
    return false;
  }
  return candidate.claimRefs === undefined
    || projectQueryClaimRefsAreComplete(objective, candidate.claimRefs);
}

export function projectQueryAnswerHasBehavioralFlow(
  objective: ProjectQueryAnswerObjective | undefined,
  response: string,
  flowRefs?: readonly string[],
  requiresGapSignal = false,
): boolean {
  if (!objective) return false;
  if (
    objective.objectiveType !== "PROJECT_QUERY_EMBEDDED-AI"
    && objective.objectiveType !== "PROJECT_QUERY_GAP-ANALYSIS"
  ) {
    return true;
  }

  const normalized = response.trim();
  if (
    normalized.length < 240
    || !objective.requiredClaims.every((claim) =>
      claimTextIsAffirmed(normalized, claim.text),
    )
    || (flowRefs !== undefined && !projectQueryFlowRefsAreValid(objective, flowRefs))
  ) {
    return false;
  }

  const flowSignals = [
    /\b(?:first|then|after|before|finally|through|because)\b/giu,
    /(?:أولًا|أولا|ثم|بعد ذلك|أخيرًا|أخيرا|عبر|لأن)/gu,
  ];
  const flowSignalCount = flowSignals.reduce((count, pattern) => {
    const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
    return count + (normalized.match(new RegExp(pattern.source, flags))?.length ?? 0);
  }, 0);
  const isGapObjective = requiresGapSignal
    || objective.objectiveType === "PROJECT_QUERY_GAP-ANALYSIS";
  if (isGapObjective) {
    const gapSignal =
      /(?:فجوات?|نقاط\s+ضعف|ضعف|خلل|لا\s+يثبت|gap|weakness|defect)/iu.test(normalized);
    return gapSignal && flowSignalCount >= 2;
  }
  return flowSignalCount >= 2;
}
