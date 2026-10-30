import { isAllowedApiTestEgress } from "./network-egress-policy.js";

const originalFetch = globalThis.fetch.bind(globalThis);

globalThis.fetch = async (input, init) => {
  const rawUrl = input instanceof Request ? input.url : String(input);
  if (!isAllowedApiTestEgress(rawUrl)) {
    throw new Error("Blocked external fetch from API tests.");
  }
  const hostname = new URL(rawUrl).hostname.toLowerCase();
  if (hostname === "openrouter.ai") {
    return originalFetch(input, { ...init, redirect: "manual" });
  }
  return originalFetch(input, init);
};
