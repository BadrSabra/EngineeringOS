export type PromotionStatus = 'pending' | 'promoted' | 'superseded' | 'rejected';
export type RevocationStatus = 'active' | 'revoked';

export interface ShadowScore {
  contractVersion: number;
  status: string;
  promotionAllowed: boolean;
  pairId: string;
  suiteVersion: string;
  baselineWorkspaceHash: string;
  candidateWorkspaceHash: string;
  metricDeltas: Record<string, number | string | null>;
  terminalMismatchCount: number;
  caseCount: number;
  blockers: string[];
}

export interface RegistryRow {
  id: string;
  projectId: string;
  skillId: string;
  skillVersion: string;
  candidateId: string;
  proposalId: string;
  shadowReplayId: string;
  proofReceiptId: string;
  sourceRevision: string;
  candidateTreeHash: string;
  shadowScore: ShadowScore | null;
  promotionStatus: PromotionStatus;
  revocationStatus: RevocationStatus;
  approvedBy: string | null;
  approvedAt: string | null;
  revokedBy: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SkillRegistryResponse {
  registry: RegistryRow[];
}

export interface SkillRegistryMutationResponse {
  registry: RegistryRow;
}

export class SkillRegistryRequestError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'SkillRegistryRequestError';
    this.status = status;
  }
}

async function requestJson<T>(url: string, init: RequestInit = {}, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, {
    ...init,
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
    signal,
  });

  if (!response.ok) {
    let detail = '';
    try {
      const body = (await response.json()) as { message?: string; error?: string };
      detail = body.message ?? body.error ?? '';
    } catch {
      detail = '';
    }
    throw new SkillRegistryRequestError(
      response.status,
      detail || `Request failed with status ${response.status}.`,
    );
  }

  return (await response.json()) as T;
}

export function getSkillRegistryUrl(projectId: string) {
  return `/api/ai/skill-registry?${new URLSearchParams({ projectId }).toString()}`;
}

export function getApproveSkillRegistryUrl(registryId: string) {
  return `/api/ai/skill-registry/${encodeURIComponent(registryId)}/approve`;
}

export function getRevokeSkillRegistryUrl(registryId: string) {
  return `/api/ai/skill-registry/${encodeURIComponent(registryId)}/revoke`;
}

export function fetchSkillRegistry(projectId: string, signal?: AbortSignal) {
  return requestJson<SkillRegistryResponse>(getSkillRegistryUrl(projectId), {}, signal);
}

export function approveSkillRegistry(registryId: string, signal?: AbortSignal) {
  return requestJson<SkillRegistryMutationResponse>(
    getApproveSkillRegistryUrl(registryId),
    { method: 'POST', body: JSON.stringify({}) },
    signal,
  );
}

export function revokeSkillRegistry(registryId: string, signal?: AbortSignal) {
  return requestJson<SkillRegistryMutationResponse>(
    getRevokeSkillRegistryUrl(registryId),
    { method: 'POST', body: JSON.stringify({}) },
    signal,
  );
}