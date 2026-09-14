/**
 * Canonical English action vocabulary shared by central turn routing and the
 * chat agent's immediate-execution handoff.
 *
 * Mutation requests remain reviewable plan requests unless they explicitly
 * continue or execute named work. Add new English wording here so both
 * boundaries continue to make the same distinction.
 */
const ENGLISH_EXPLANATION_ACTION_RE =
  /^(?:(?:please|kindly)\s+)?(?:(?:(?:can|could|would|will)\s+you|i\s+(?:need|want)\s+you\s+to|i(?:'d|\s+would)\s+like\s+you\s+to)\s+)?(?:(?:please|kindly)\s+)?(?:explain|describe|summarize|analyse|analyze|review|inspect|investigate|assess|evaluate)(?:\s|$)/i;

const ENGLISH_MUTATION_ACTION_RE =
  /^(?:(?:please|kindly)\s+)?(?:(?:(?:can|could|would|will)\s+you|i\s+(?:need|want)\s+you\s+to|i(?:'d|\s+would)\s+like\s+you\s+to)\s+)?(?:(?:please|kindly)\s+)?(?:fix|patch|implement|modify|change|write|edit|apply|execute|build|refactor|delete|remove|create|add)(?:\s|$)/i;

const ENGLISH_EXPLICIT_EXECUTION_ACTION_RE =
  /^(?:(?:please|kindly)\s+)?(?:(?:go\s+ahead(?:\s+and)?|do\s+it|start|proceed|execute)(?:\s|$)|run\s+(?:the\s+|this\s+|approved\s+)?(?:task|tests?|repair\s+plan)(?:\s|$)|(?:implement|apply)\s+(?:the\s+|this\s+|approved\s+)?(?:plan|changes|fixes)(?:\s|$))/i;

export function normalizeEnglishActionText(message: string): string {
  return message
    .normalize("NFKC")
    .replace(/[^A-Za-z0-9\s']+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isEnglishExplanationActionRequest(message: string): boolean {
  return ENGLISH_EXPLANATION_ACTION_RE.test(normalizeEnglishActionText(message));
}

export function isEnglishMutationActionRequest(message: string): boolean {
  const normalized = normalizeEnglishActionText(message);
  if (ENGLISH_EXPLANATION_ACTION_RE.test(normalized)) return false;
  return (
    ENGLISH_MUTATION_ACTION_RE.test(normalized) ||
    ENGLISH_EXPLICIT_EXECUTION_ACTION_RE.test(normalized)
  );
}

export function isEnglishExplicitExecutionActionRequest(message: string): boolean {
  return ENGLISH_EXPLICIT_EXECUTION_ACTION_RE.test(normalizeEnglishActionText(message));
}