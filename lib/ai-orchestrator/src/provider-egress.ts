export type ProviderEgressEnvironment = Partial<
  Pick<
    NodeJS.ProcessEnv,
    | "AI_PROVIDER_EGRESS_DISABLED"
    | "RUN_CONTROLLED_RELEASE_VALIDATION"
    | "DASHBOARD_E2E_TEST_MODE"
    | "NODE_ENV"
  >
>;

export class ProviderEgressDisabledError extends Error {
  readonly code = "AI_PROVIDER_EGRESS_DISABLED" as const;

  constructor() {
    super(
      "AI provider network egress is disabled for deterministic dashboard fixture validation.",
    );
    this.name = "ProviderEgressDisabledError";
  }
}

export function isProviderEgressDisabled(
  env: ProviderEgressEnvironment = process.env,
): boolean {
  return (
    env.AI_PROVIDER_EGRESS_DISABLED === "1" &&
    env.RUN_CONTROLLED_RELEASE_VALIDATION === "1" &&
    env.DASHBOARD_E2E_TEST_MODE === "fixture" &&
    env.NODE_ENV !== "production"
  );
}

export function assertProviderEgressEnabled(
  env: ProviderEgressEnvironment = process.env,
): void {
  if (isProviderEgressDisabled(env)) {
    throw new ProviderEgressDisabledError();
  }
}