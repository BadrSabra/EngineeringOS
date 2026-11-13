const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LEGACY_KEY_PATTERN =
  /^preview-build-outputs\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/site\.tar\.gz$/i;
const GENERATION_KEY_PATTERN =
  /^preview-build-outputs\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/g([1-9][0-9]*)\/site\.tar\.gz$/i;

export function previewBuildOutputArtifactKey(
  buildId: string,
  dispatchGeneration: number,
): string {
  if (
    !UUID_PATTERN.test(buildId) ||
    !Number.isSafeInteger(dispatchGeneration) ||
    dispatchGeneration < 1
  ) {
    throw new Error("Preview build output identity is invalid.");
  }
  return `preview-build-outputs/${buildId}/g${dispatchGeneration}/site.tar.gz`;
}

export function isPreviewBuildOutputArtifactKey(
  value: unknown,
  input: {
    buildId?: string;
    dispatchGeneration?: number;
    allowLegacyGenerationOne?: boolean;
  } = {},
): value is string {
  if (typeof value !== "string" || value.length > 160) return false;
  const legacy = LEGACY_KEY_PATTERN.exec(value);
  const generated = GENERATION_KEY_PATTERN.exec(value);
  const match = generated ?? legacy;
  if (!match) return false;
  if (
    input.buildId &&
    match[1]?.toLowerCase() !== input.buildId.toLowerCase()
  ) {
    return false;
  }
  if (input.dispatchGeneration === undefined) return true;
  if (
    !Number.isSafeInteger(input.dispatchGeneration) ||
    input.dispatchGeneration < 1
  ) {
    return false;
  }
  if (generated) {
    const generation = Number(generated[2]);
    return (
      Number.isSafeInteger(generation) &&
      generation === input.dispatchGeneration
    );
  }
  return (
    input.dispatchGeneration === 1 &&
    input.allowLegacyGenerationOne !== false
  );
}
