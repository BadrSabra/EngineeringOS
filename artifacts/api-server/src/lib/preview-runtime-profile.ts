const IMAGE_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/i;
const ECR_REPOSITORY_PATTERN =
  /^(\d{12})\.dkr\.ecr\.([a-z0-9-]+)\.amazonaws\.com(?:\.cn)?\/[a-z0-9][a-z0-9/_-]*$/i;
const TASK_DEFINITION_PATTERN =
  /^arn:(aws|aws-us-gov|aws-cn):ecs:([a-z0-9-]+):(\d{12}):task-definition\/([A-Za-z0-9_-]+):(\d+)$/i;
const verifiedProfiles = new WeakSet<object>();

declare const verifiedRuntimeProfileBrand: unique symbol;

export type VerifiedPreviewRuntimeProfile = {
  readonly imageDigest: string;
  readonly taskDefinitionArn: string;
  readonly [verifiedRuntimeProfileBrand]: true;
};

export class PreviewRuntimeProfileError extends Error {
  constructor() {
    super(
      "Preview runtime is not configured with a pinned server-owned image.",
    );
    this.name = "PreviewRuntimeProfileError";
  }
}

export function loadPreviewRuntimeProfile(
  env: NodeJS.ProcessEnv = process.env,
): VerifiedPreviewRuntimeProfile {
  const repository = env.PREVIEW_ECR_REPOSITORY_URI;
  const imageDigest = env.PREVIEW_RUNTIME_IMAGE_DIGEST;
  const taskDefinitionArn = env.PREVIEW_TASK_DEFINITION_ARN;
  const repositoryMatch = repository?.match(ECR_REPOSITORY_PATTERN);
  const taskDefinitionMatch = taskDefinitionArn?.match(TASK_DEFINITION_PATTERN);

  if (
    !repositoryMatch ||
    !imageDigest ||
    !IMAGE_DIGEST_PATTERN.test(imageDigest) ||
    !taskDefinitionMatch ||
    repositoryMatch[1] !== taskDefinitionMatch[3] ||
    repositoryMatch[2] !== taskDefinitionMatch[2] ||
    (taskDefinitionMatch[1] === "aws-cn") !==
      repositoryMatch[0].includes(".amazonaws.com.cn/")
  ) {
    throw new PreviewRuntimeProfileError();
  }

  const profile = Object.freeze({
    imageDigest,
    taskDefinitionArn,
  }) as VerifiedPreviewRuntimeProfile;
  verifiedProfiles.add(profile);
  return profile;
}

export function isVerifiedPreviewRuntimeProfile(
  value: unknown,
): value is VerifiedPreviewRuntimeProfile {
  return (
    value !== null && typeof value === "object" && verifiedProfiles.has(value)
  );
}
