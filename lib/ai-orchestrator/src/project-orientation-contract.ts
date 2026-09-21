export const PROJECT_ORIENTATION_ROLES = [
  "purpose",
  "components",
  "primaryFlow",
  "uncertainty",
] as const;

/**
 * These limits are part of the durable orientation contract. Keep planner,
 * persistence, parser, and deterministic recovery aligned so a manifest
 * cannot be written successfully and rejected on resume.
 */
export const MAX_PROJECT_ORIENTATION_ROLE_FILES = 3;
export const MAX_PROJECT_ORIENTATION_SOURCE_FILES = 8;