const originalFetch = globalThis.fetch.bind(globalThis);
const localHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

globalThis.fetch = async (input, init) => {
  const rawUrl = input instanceof Request ? input.url : String(input);
  const hostname = new URL(rawUrl).hostname.toLowerCase();
  if (!localHosts.has(hostname)) {
    throw new Error("Blocked external fetch from API tests.");
  }
  return originalFetch(input, init);
};
