export type ProviderEgressEnvironment = Partial<
  Pick<
    NodeJS.ProcessEnv,
    | "AI_PROVIDER_EGRESS_DISABLED"
    | "RUN_CONTROLLED_RELEASE_VALIDATION"
    | "DASHBOARD_E2E_TEST_MODE"
    | "NODE_ENV"
  >
>;

function getProcessProviderEgressEnvironment(): ProviderEgressEnvironment {
  return {
    AI_PROVIDER_EGRESS_DISABLED: process.env.AI_PROVIDER_EGRESS_DISABLED,
    RUN_CONTROLLED_RELEASE_VALIDATION: process.env.RUN_CONTROLLED_RELEASE_VALIDATION,
    DASHBOARD_E2E_TEST_MODE: process.env.DASHBOARD_E2E_TEST_MODE,
    NODE_ENV: process.env.NODE_ENV,
  };
}

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
  env: ProviderEgressEnvironment = getProcessProviderEgressEnvironment(),
): boolean {
  return (
    env.AI_PROVIDER_EGRESS_DISABLED === "1" &&
    env.RUN_CONTROLLED_RELEASE_VALIDATION === "1" &&
    env.DASHBOARD_E2E_TEST_MODE === "fixture" &&
    env.NODE_ENV !== "production"
  );
}

export function assertProviderEgressEnabled(
  env: ProviderEgressEnvironment = getProcessProviderEgressEnvironment(),
): void {
  if (isProviderEgressDisabled(env)) {
    throw new ProviderEgressDisabledError();
  }
}