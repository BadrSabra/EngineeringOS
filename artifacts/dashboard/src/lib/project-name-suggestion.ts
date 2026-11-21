const PROJECT_NAME_MAX_LENGTH = 80;

const REQUEST_PREFIX =
  /^(?:(?:أريد|اريد)\s+(?:(?:أن|ان)\s+)?|(?:أحتاج إلى|احتاج الى|أحتاج|احتاج|أرغب في|ارغب في|ساعدني على|ساعدني في)\s+|(?:i want to|i need to|help me(?: to)?)\s+)/iu;
const REQUEST_ONLY =
  /^(?:أريد|اريد|أحتاج|احتاج|أرغب|ارغب|ساعدني|i want to|i need to|help me(?: to)?)$/iu;

/** Derive a short, editable project name from the first sentence of a goal. */
export function suggestProjectNameFromGoal(goal: string): string {
  const firstSentence = goal.trim().split(/[\r\n.!?؟]+/u, 1)[0] ?? '';
  const suggestion = firstSentence
    .replace(/\s+/gu, ' ')
    .replace(REQUEST_PREFIX, '')
    .replace(/^[\s"'“«]+|[\s"'”»]+$/gu, '')
    .replace(/[،,:;]+$/u, '')
    .trim();

  if (REQUEST_ONLY.test(suggestion)) return '';
  if (suggestion.length <= PROJECT_NAME_MAX_LENGTH) return suggestion;

  const truncated = suggestion.slice(0, PROJECT_NAME_MAX_LENGTH);
  const lastSpace = truncated.lastIndexOf(' ');
  return (lastSpace > 0 ? truncated.slice(0, lastSpace) : truncated)
    .replace(/[،,:;]+$/u, '')
    .trim();
}
