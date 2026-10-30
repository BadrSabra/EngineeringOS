type EgressEnvironment = Record<string, string | undefined>;

const localHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function isAllowedApiTestEgress(
  rawUrl: string,
  env: EgressEnvironment = process.env,
): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }

  if (localHosts.has(url.hostname.toLowerCase())) return true;

  const noPaidConfiguration =
    !env.OPENROUTER_ALLOW_PAID_FALLBACK?.trim()
    && !env.OPENROUTER_PAID_MODEL?.trim()
    && !env.OPENROUTER_PAID_MODEL_CAPABILITIES?.trim()
    && (!env.OPENROUTER_MODEL?.trim() || env.OPENROUTER_MODEL.trim().endsWith(":free"));

  return url.protocol === "https:"
    && url.hostname.toLowerCase() === "openrouter.ai"
    && env.RUN_LIVE_EMPTY_MODEL_RESPONSE === "1"
    && env.API_TEST_OPENROUTER_EGRESS === "1"
    && env.EMPTY_MODEL_RESPONSE_TEST_PROVIDER === "openrouter"
    && Boolean(env.EMPTY_MODEL_RESPONSE_TEST_MODEL?.trim().endsWith(":free"))
    && noPaidConfiguration;
}
