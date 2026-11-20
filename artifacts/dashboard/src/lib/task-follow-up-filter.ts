const FOLLOW_UP_STATUSES = new Set(['pending', 'queued', 'failed', 'verifying']);

export function isTaskFollowUpCandidate(
  status: string,
  acceptanceState?: string | null,
): boolean {
  if (FOLLOW_UP_STATUSES.has(status)) return true;
  if (status === 'running') return false;
  return Boolean(acceptanceState && acceptanceState !== 'accepted');
}
