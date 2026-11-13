type PreviewBuildAttestorClaimsBase = {
  action: "preview-build";
  buildId: string;
  builderProfile: "vite-react-static-v1";
  builderImageDigest: string;
  projectId: string;
  proposalId: string;
  operationId: string;
  proposalRevision: number;
  candidateRevision: string;
  changeSetHash: string;
  sourceDigest: string;
  archiveDigest: string;
  outputArtifactKey: string;
};

export type PreviewBuildAttestorClaims =
  | (PreviewBuildAttestorClaimsBase & {
      version: 1;
      jobId: string;
    })
  | (PreviewBuildAttestorClaimsBase & {
      version: 2;
      jobId: string;
      attemptId: string;
      idempotencyKey: string;
      dispatchGeneration: number;
    });

export function canonicalPreviewBuildReceiptPayload(
  receipt: Record<string, unknown>,
): string;

export function signPreviewBuildReceipt(input: {
  claims: PreviewBuildAttestorClaims;
  buildOutputDigest: string;
  privateKeyPem: string;
  now?: Date;
}): { receipt: Record<string, unknown>; token: string };
