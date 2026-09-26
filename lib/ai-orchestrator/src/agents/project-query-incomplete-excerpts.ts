export type ProjectQueryReadExcerpt = {
  path: string;
  startLine: number;
  endLine: number;
  sourceText: string;
  matchedTerms: string[];
  structuralOnly: boolean;
};

type ScoredLine = {
  lineNumber: number;
  text: string;
  matchedTerms: string[];
  structureScore: number;
};

type ExcerptCandidate = ProjectQueryReadExcerpt & {
  score: number;
};

const MAX_QUERY_TERMS = 32;
const MAX_FILES_TO_RANK = 48;
const MAX_SCANNED_LINES = 24_000;
const MAX_EXCERPTS = 3;
const WINDOW_LINES = 5;
const MAX_LINE_CHARS = 220;
const MAX_EXCERPT_CHARS = 840;
const MAX_TOTAL_EXCERPT_CHARS = 2_100;

const STOP_WORDS = new Set([
  "a", "about", "after", "all", "an", "and", "are", "as", "at", "be",
  "by", "can", "do", "does", "explain", "find", "for", "from", "how",
  "in", "is", "it", "me", "of", "on", "or", "please", "show", "that",
  "the", "this", "to", "what", "where", "which", "with", "استخرج",
  "اشرح", "الى", "إلى", "اين", "أين", "بعد", "بنية", "عن", "في", "كيف",
  "لي", "ما", "ماذا", "من", "مع", "هل", "هو", "هي", "وال", "وما", "وضح",
  "هذا", "هذه", "على", "المشروع", "مشروع",
]);

const STRUCTURAL_MARKER =
  /\b(?:export|function|class|interface|type|enum|const|let|var|import|from|default|async|return|await|def|fn|struct|impl|package|module|router|route|handler|controller|service)\b|^\s*#{1,6}\s|^\s*["']?(?:main|module|exports|scripts|dependencies|entrypoint|start|dev)\b/i;

const CONTROL_FLOW_MARKER =
  /\b(?:if|else|switch|case|try|catch|throw|yield|return|await|invoke|call)\b/i;

function normalizeToken(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .toLocaleLowerCase();
}

function tokenize(value: string): string[] {
  const chunks = value.normalize("NFKC").match(/[\p{L}\p{N}_$]+/gu) ?? [];
  return chunks
    .flatMap((chunk) =>
      chunk
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .split(/[\s_$]+/),
    )
    .map(normalizeToken)
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token));
}

function scoreStructure(line: string): number {
  return (
    (STRUCTURAL_MARKER.test(line) ? 2 : 0) +
    (CONTROL_FLOW_MARKER.test(line) ? 1 : 0)
  );
}

function clipLineAroundTerm(
  line: string,
  matchedTerms: ReadonlySet<string>,
  maxChars: number,
): string {
  if (line.length <= maxChars) return line;
  const tokenPattern = /[\p{L}\p{N}_$]+/gu;
  let pivot = -1;
  for (const match of line.matchAll(tokenPattern)) {
    if (matchedTerms.has(normalizeToken(match[0]))) {
      pivot = match.index ?? -1;
      break;
    }
  }
  if (pivot < 0) return `${line.slice(0, Math.max(1, maxChars - 1))}…`;

  const start = Math.max(
    0,
    Math.min(pivot - Math.floor(maxChars / 2), line.length - maxChars),
  );
  const end = Math.min(line.length, start + maxChars);
  return `${start > 0 ? "…" : ""}${line.slice(start, end)}${end < line.length ? "…" : ""}`;
}

function windowStartForLine(index: number, lineCount: number): number {
  return Math.max(
    0,
    Math.min(index - Math.floor(WINDOW_LINES / 2), lineCount - WINDOW_LINES),
  );
}

function buildCandidate(
  path: string,
  lines: readonly ScoredLine[],
  startIndex: number,
  queryTerms: readonly string[],
  structuralOnly: boolean,
): ExcerptCandidate | null {
  const window = lines.slice(startIndex, startIndex + WINDOW_LINES);
  if (window.length === 0) return null;

  const matched = new Set(window.flatMap((line) => line.matchedTerms));
  const matchedTerms = queryTerms.filter((term) => matched.has(term));
  const structureScore = window.reduce(
    (total, line) => total + line.structureScore,
    0,
  );
  const occurrenceScore = window.reduce(
    (total, line) => total + line.matchedTerms.length,
    0,
  );
  const score = structuralOnly
    ? structureScore * 4
    : matchedTerms.length * 20 + occurrenceScore * 3 + structureScore;

  let sourceText = "";
  const displayedLineNumbers: number[] = [];
  for (const line of window) {
    const remaining = MAX_EXCERPT_CHARS - sourceText.length;
    if (remaining < 18) break;
    const linePrefix = `${String(line.lineNumber).padStart(5, " ")} │ `;
    const lineBudget = Math.min(MAX_LINE_CHARS, remaining - linePrefix.length - 1);
    if (lineBudget < 1) break;
    const clipped = clipLineAroundTerm(
      line.text.trimEnd(),
      new Set(line.matchedTerms),
      lineBudget,
    );
    const renderedLine = `${linePrefix}${clipped}`;
    const separator = sourceText ? "\n" : "";
    if (sourceText.length + separator.length + renderedLine.length > MAX_EXCERPT_CHARS) {
      break;
    }
    sourceText += `${separator}${renderedLine}`;
    displayedLineNumbers.push(line.lineNumber);
  }

  if (!sourceText || displayedLineNumbers.length === 0) return null;
  return {
    path,
    startLine: displayedLineNumbers[0]!,
    endLine: displayedLineNumbers.at(-1)!,
    sourceText,
    matchedTerms,
    structuralOnly,
    score,
  };
}

/**
 * Select a few source windows using exact query-token overlap, with source
 * structure as a clearly labeled fallback when no query term appears in reads.
 * This ranks presentation only; it does not interpret code or produce proof.
 */
export function rankProjectQueryReadExcerpts(
  message: string,
  retainedReads: readonly (readonly [string, string])[],
): ProjectQueryReadExcerpt[] {
  const queryTerms = [...new Set(tokenize(message))].slice(0, MAX_QUERY_TERMS);
  const queryTermSet = new Set(queryTerms);
  const rankedFiles = retainedReads
    .map(([path, content]) => ({
      path,
      content,
      pathMatchCount: tokenize(path).filter((term) => queryTermSet.has(term)).length,
    }))
    .sort(
      (left, right) =>
        right.pathMatchCount - left.pathMatchCount ||
        left.path.localeCompare(right.path),
    )
    .slice(0, MAX_FILES_TO_RANK);

  const candidates: ExcerptCandidate[] = [];
  let remainingScanLines = MAX_SCANNED_LINES;
  let hasAnyDirectMatch = false;

  for (const { path, content } of rankedFiles) {
    if (remainingScanLines <= 0) break;
    const rawLines = content.split("\n");
    while (rawLines.length > 0 && rawLines.at(-1)?.trim() === "") rawLines.pop();
    const linesToScan = Math.min(rawLines.length, remainingScanLines);
    remainingScanLines -= linesToScan;
    const scoredLines: ScoredLine[] = rawLines
      .slice(0, linesToScan)
      .map((text, index) => {
        const matchedTerms = [...new Set(
          tokenize(text).filter((term) => queryTermSet.has(term)),
        )];
        return {
          lineNumber: index + 1,
          text,
          matchedTerms,
          structureScore: scoreStructure(text),
        };
      });
    const hasDirectMatch = scoredLines.some((line) => line.matchedTerms.length > 0);
    hasAnyDirectMatch ||= hasDirectMatch;
    const focusIndices = scoredLines
      .map((line, index) => ({ line, index }))
      .filter(({ line }) =>
        hasDirectMatch
          ? line.matchedTerms.length > 0
          : line.structureScore > 0,
      )
      .sort((left, right) => {
        const leftScore =
          left.line.matchedTerms.length * 20 + left.line.structureScore * 3;
        const rightScore =
          right.line.matchedTerms.length * 20 + right.line.structureScore * 3;
        return rightScore - leftScore || left.index - right.index;
      });

    const starts: number[] = [];
    for (const { index } of focusIndices) {
      const startIndex = windowStartForLine(index, scoredLines.length);
      if (starts.some((existing) => Math.abs(existing - startIndex) < WINDOW_LINES)) {
        continue;
      }
      starts.push(startIndex);
      if (starts.length >= 4) break;
    }

    for (const startIndex of starts) {
      const candidate = buildCandidate(
        path,
        scoredLines,
        startIndex,
        queryTerms,
        !hasDirectMatch,
      );
      if (candidate) candidates.push(candidate);
    }
  }

  const sortedCandidates = candidates.sort(
    (left, right) =>
      right.score - left.score ||
      left.path.localeCompare(right.path) ||
      left.startLine - right.startLine,
  );
  const relevantCandidates = hasAnyDirectMatch
    ? sortedCandidates.filter((candidate) => !candidate.structuralOnly)
    : sortedCandidates;
  const selected: ExcerptCandidate[] = [];
  const selectedPaths = new Set<string>();
  let remainingChars = MAX_TOTAL_EXCERPT_CHARS;
  for (const candidate of relevantCandidates) {
    if (selected.length >= MAX_EXCERPTS || selectedPaths.has(candidate.path)) continue;
    if (candidate.sourceText.length > remainingChars) continue;
    selected.push(candidate);
    selectedPaths.add(candidate.path);
    remainingChars -= candidate.sourceText.length;
  }

  return selected.map(({ score: _score, ...excerpt }) => excerpt);
}