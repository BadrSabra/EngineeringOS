import { acceptPreviewBuildReceipt } from "./preview-build-attestor.js";
import type { PreviewReceiptVerifier } from "./preview-build-provider-contracts.js";

export function createApiPreviewReceiptVerifier(): PreviewReceiptVerifier {
  return {
    verifyAndAccept: (input) =>
      acceptPreviewBuildReceipt({
        jobId: input.jobId,
        token: input.token,
        publicKeyPem: input.publicKeyPem,
        expectedLeaseOwner: input.expectedLeaseOwner,
        dependencies: { now: input.now },
      }),
  };
}
