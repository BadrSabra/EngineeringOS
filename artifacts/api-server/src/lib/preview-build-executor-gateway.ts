import {
  observePreviewBuildJob,
} from "./preview-build-observation-client.js";
import {
  dispatchPreviewBuilderJob,
} from "./preview-builder-gateway-client.js";
import { uploadPreviewBuildInput } from "./preview-build-input-client.js";
import type {
  PreviewBuildExecutor,
  PreviewBuildInputArtifactStore,
} from "./preview-build-provider-contracts.js";

export type PreviewBuildGatewayExecutorConfig = {
  gatewayUrl: string | undefined;
  privateKeyPem: string | undefined;
};

/**
 * Existing Gateway/ECS transport adapter. AWS-specific endpoint and signing
 * configuration stays here rather than in build lifecycle orchestration.
 */
export function createPreviewBuildGatewayExecutor(
  config: PreviewBuildGatewayExecutorConfig,
): PreviewBuildExecutor {
  return {
    launch: ({ claims, now }) =>
      dispatchPreviewBuilderJob({
        gatewayUrl: config.gatewayUrl,
        privateKeyPem: config.privateKeyPem,
        claims,
        now,
      }),
    observe: ({ job, now }) =>
      observePreviewBuildJob({
        gatewayUrl: config.gatewayUrl,
        privateKeyPem: config.privateKeyPem,
        job,
        now,
      }),
  };
}

export function createPreviewBuildGatewayInputArtifactStore(
  config: PreviewBuildGatewayExecutorConfig,
): PreviewBuildInputArtifactStore {
  return {
    storeInput: ({ jobId, identity, buildInput, now }) =>
      uploadPreviewBuildInput({
        gatewayUrl: config.gatewayUrl,
        privateKeyPem: config.privateKeyPem,
        jobId,
        identity,
        buildInput,
        now,
      }),
  };
}
