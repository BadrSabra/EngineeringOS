export type GoalRoutingProject = {
  id: string;
  name: string;
  description?: string | null;
  language?: string | null;
  framework?: string | null;
};

export type GoalProjectMatch =
  | { kind: 'none' }
  | { kind: 'unique'; project: GoalRoutingProject }
  | { kind: 'ambiguous' };

export type GoalProjectSuggestion = {
  project: GoalRoutingProject;
  kind: 'exact' | 'partial' | 'context';
  matchedTerms: string[];
};

const NON_SPECIFIC_WORDS = new Set([
  'مشروع',
  'المشروع',
  'مشروعي',
  'مشاريع',
  'project',
  'projects',
  'مع',
  'من',
  'في',
  'على',
  'الى',
  'عن',
  'هذا',
  'هذه',
  'ذلك',
  'تلك',
  'او',
]);

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

function specificWords(value: string): string[] {
  return normalizeProjectPhrase(value)
    .split(' ')
    .map((word) => word.startsWith('ال') ? word.slice(2) : word)
    .filter((word) => word.length > 1 && !NON_SPECIFIC_WORDS.has(word));
}

function partialProjectSuggestions(
  goal: string,
  projects: readonly GoalRoutingProject[],
  excludedProjectIds: ReadonlySet<string> = new Set(),
): GoalProjectSuggestion[] {
  const goalWords = new Set(specificWords(goal));
  if (goalWords.size === 0) return [];

  return projects
    .map((project, index) => {
      if (excludedProjectIds.has(project.id)) return null;
      const projectWords = [...new Set(specificWords(project.name))];
      if (projectWords.length === 0) return null;

      const matchedTerms = projectWords.filter((word) => goalWords.has(word));
      const coverage = matchedTerms.length / projectWords.length;
      if (matchedTerms.length === 0 || coverage < 0.5) return null;

      return {
        project,
        kind: 'partial' as const,
        matchedTerms,
        coverage,
        index,
      };
    })
    .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null)
    .sort((left, right) => right.coverage - left.coverage || left.index - right.index)
    .slice(0, 3)
    .map(({ project, kind, matchedTerms }) => ({ project, kind, matchedTerms }));
}

function contextProjectSuggestions(
  goal: string,
  projects: readonly GoalRoutingProject[],
): GoalProjectSuggestion[] {
  const goalWords = new Set(specificWords(goal));
  if (goalWords.size === 0) return [];

  return projects
    .map((project, index) => {
      const descriptionWords = [...new Set(specificWords(project.description ?? ''))];
      const technologyWords = [...new Set([
        ...specificWords(project.language ?? ''),
        ...specificWords(project.framework ?? ''),
      ])];
      const matchedDescription = descriptionWords.filter((word) => goalWords.has(word));
      const matchedTechnology = technologyWords.filter((word) => goalWords.has(word));

      // A single word from a long description is too weak; an exact framework
      // or language mention can still be useful as a reviewable suggestion.
      if (matchedTechnology.length === 0 && matchedDescription.length < 2) return null;

      const matchedTerms = [...new Set([...matchedTechnology, ...matchedDescription])].slice(0, 4);
      return {
        project,
        kind: 'context' as const,
        matchedTerms,
        score: matchedTechnology.length * 3 + matchedDescription.length,
        index,
      };
    })
    .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, 3)
    .map(({ project, kind, matchedTerms }) => ({ project, kind, matchedTerms }));
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

  if (matches.length === 1) {
    const partialMatches = partialProjectSuggestions(
      goal,
      projects,
      new Set([matches[0].id]),
    );
    if (partialMatches.length > 0) return { kind: 'ambiguous' };
    return { kind: 'unique', project: matches[0] };
  }
  if (matches.length > 1) return { kind: 'ambiguous' };
  return { kind: 'none' };
}

/**
 * Return explanatory choices without selecting or routing to any project.
 * Exact mentions are useful when the goal mentions several projects. Partial
 * word overlap and project metadata matches are advisory and never authorize a
 * route on their own.
 */
export function suggestGoalProjects(
  goal: string,
  projects: readonly GoalRoutingProject[],
): GoalProjectSuggestion[] {
  const normalizedGoal = normalizeProjectPhrase(goal);
  if (!normalizedGoal) return [];

  const paddedGoal = ` ${normalizedGoal} `;
  const exactMatches = projects.filter((project) => {
    const normalizedName = normalizeProjectPhrase(project.name);
    return normalizedName.length > 1 && paddedGoal.includes(` ${normalizedName} `);
  });
  const exactSuggestions = exactMatches.map((project) => ({
    project,
    kind: 'exact' as const,
    matchedTerms: [],
  }));
  const partialSuggestions = partialProjectSuggestions(
    goal,
    projects,
    new Set(exactMatches.map((project) => project.id)),
  );
  const contextSuggestions = exactSuggestions.length === 0 && partialSuggestions.length === 0
    ? contextProjectSuggestions(goal, projects)
    : [];
  return [...exactSuggestions, ...partialSuggestions, ...contextSuggestions];
}
