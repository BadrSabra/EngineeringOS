export type GoalRoutingProject = {
  id: string;
  name: string;
};

export type GoalProjectMatch =
  | { kind: 'none' }
  | { kind: 'unique'; project: GoalRoutingProject }
  | { kind: 'ambiguous' };

function normalizeProjectPhrase(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('ar')
    .replace(/[\u0640\p{M}]/gu, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function matchGoalToProject(
  goal: string,
  projects: readonly GoalRoutingProject[],
): GoalProjectMatch {
  const normalizedGoal = normalizeProjectPhrase(goal);
  if (!normalizedGoal) return { kind: 'none' };

  const paddedGoal = ` ${normalizedGoal} `;
  const matches = projects.filter((project) => {
    const normalizedName = normalizeProjectPhrase(project.name);
    return normalizedName.length > 1 && paddedGoal.includes(` ${normalizedName} `);
  });

  if (matches.length === 1) return { kind: 'unique', project: matches[0] };
  if (matches.length > 1) return { kind: 'ambiguous' };
  return { kind: 'none' };
}
