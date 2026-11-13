import { attestPreviewBuildJob } from "./preview-build-attestor-client.js";
import type { PreviewAttestationService } from "./preview-build-provider-contracts.js";

export function createPreviewBuildGatewayAttestationService(input: {
  gatewayUrl: string;
  privateKeyPem: string;
}): PreviewAttestationService {
  return {
    attest: ({ job, executionRef, now }) =>
      attestPreviewBuildJob({
        gatewayUrl: input.gatewayUrl,
        privateKeyPem: input.privateKeyPem,
        job,
        executionRef,
        now,
      }),
  };
}
