export type ProjectSearchRecord = {
  name: string;
  description?: string | null;
  language?: string | null;
  framework?: string | null;
};

const ARABIC_DIACRITICS = /[\u064B-\u065F\u0670\u06D6-\u06ED]/g;
const ARABIC_ALIF_VARIANTS = /[أإآٱ]/g;
const NON_WORD_CHARACTERS = /[^\p{L}\p{N}]+/u;

function normalizeSearchText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(ARABIC_DIACRITICS, '')
    .replace(ARABIC_ALIF_VARIANTS, 'ا')
    .replace(/ى/g, 'ي')
    .toLocaleLowerCase('ar');
}

function normalizeSearchToken(value: string): string {
  return value.startsWith('ال') && value.length > 3 ? value.slice(2) : value;
}

function getSearchTokens(value: string): string[] {
  return normalizeSearchText(value)
    .split(NON_WORD_CHARACTERS)
    .map(normalizeSearchToken)
    .filter(Boolean);
}

export function matchesProjectSearch(project: ProjectSearchRecord, query: string): boolean {
  const terms = getSearchTokens(query);
  if (!terms.length) return true;

  const searchableTokens = [
    project.name,
    project.description,
    project.language,
    project.framework,
  ]
    .filter((value): value is string => Boolean(value))
    .flatMap(getSearchTokens);

  return terms.every((term) => searchableTokens.some((token) => token.includes(term)));
}
