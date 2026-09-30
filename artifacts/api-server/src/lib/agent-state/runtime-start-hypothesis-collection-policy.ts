/**
 * P7.5 v1 has no approved independent sampling frame or collection authority.
 * Keep this server-owned gate closed; do not derive authorization from request
 * input, environment variables, or readiness-report fields.
 *
 * Reopening collection requires a separately versioned protocol and explicit
 * owner/reviewer approval, followed by a deliberate code change here.
 */
export const RUNTIME_START_HYPOTHESIS_COLLECTION_AUTHORIZED = false as const;