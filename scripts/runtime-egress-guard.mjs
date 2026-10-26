import dgram from "node:dgram";
import dns from "node:dns";
import http2 from "node:http2";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import childProcess from "node:child_process";
import { AsyncLocalStorage } from "node:async_hooks";
import { syncBuiltinESMExports } from "node:module";
import { installIsolatedChildProcessPolicy, recordIsolatedGuardEvent } from "./isolated-child-process-policy.mjs";

const GUARD_SYMBOL = Symbol.for("engineeringos.runtime-egress-guard");
const loopbackRequestContext = new AsyncLocalStorage();
const LOOPBACK_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "::ffff:127.0.0.1",
]);

function normalizedHost(host) {
  return String(host ?? "")
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/gu, "")
    .replace(/\.$/u, "");
}

export function assertRuntimeLoopbackDestination(host, transport = "network") {
  const normalized = normalizedHost(host);
  const pinnedLocalhostAlias = normalized === "localhost" && transport !== "dns";
  if (
    !LOOPBACK_HOSTS.has(normalized)
    || (normalized === "localhost" && !pinnedLocalhostAlias)
  ) {
    recordIsolatedGuardEvent({
      kind: "blocked-egress",
      transport,
      host: normalized || "unknown-host",
    });
    throw new Error(
      `Runtime egress blocked before network access: ${normalized || "unknown-host"}.`,
    );
  }
}

function pinLocalhost(host) {
  return normalizedHost(host) === "localhost" ? "127.0.0.1" : host;
}

function blockDnsQuery(host, method) {
  const normalized = normalizedHost(host);
  recordIsolatedGuardEvent({
    kind: "blocked-egress",
    transport: "dns-query",
    method,
    host: normalized || "unknown-host",
  });
  throw new Error(`Runtime egress blocked before DNS query: ${method}.`);
}

function hostFromSocketArgs(args) {
  const [first, second] = args;
  const options = Array.isArray(first) ? first[0] : first;
  if (options && typeof options === "object") {
    if (options.path) return `unix:${options.path}`;
    return options.host ?? options.hostname ?? "";
  }
  if (typeof first === "number") {
    return typeof second === "string" ? second : "";
  }
  if (typeof first === "string") return `unix:${first}`;
  return "";
}

function hostFromRequestArgs(args) {
  const [first, second] = args;
  const target = first instanceof URL
    ? first
    : typeof first === "string"
      ? new URL(first)
      : null;
  const options = target
    ? (second && typeof second === "object" ? second : {})
    : (first && typeof first === "object" ? first : {});
  return target?.hostname ?? options.hostname ?? options.host ?? "";
}

function requireLoopbackRequest(host, transport = "network") {
  assertRuntimeLoopbackDestination(host, transport);
}

if (!globalThis[GUARD_SYMBOL]) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = function runtimeGuardedFetch(input, init) {
    const rawUrl = input instanceof Request ? input.url : String(input);
    const url = new URL(rawUrl);
    if (["http:", "https:", "ws:", "wss:"].includes(url.protocol)) {
      requireLoopbackRequest(url.hostname, "fetch");
      return loopbackRequestContext.run(
        pinLocalhost(url.hostname),
        () => originalFetch.call(this, input, init),
      );
    }
    return originalFetch.call(this, input, init);
  };

  const originalSocketConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function runtimeGuardedConnect(...args) {
    const originalHost = hostFromSocketArgs(args);
    const host = pinLocalhost(
      originalHost || loopbackRequestContext.getStore() || "",
    );
    if (host !== originalHost) {
      if (Array.isArray(args[0]) && args[0][0] && typeof args[0][0] === "object") {
        args[0] = [{ ...args[0][0], host }, ...args[0].slice(1)];
        delete args[0][0].hostname;
      } else if (args[0] && typeof args[0] === "object") {
        args[0] = { ...args[0], host };
        delete args[0].hostname;
      } else if (typeof args[0] === "number" && typeof args[1] === "string") {
        args[1] = host;
      }
    }
    requireLoopbackRequest(host, "socket");
    return originalSocketConnect.apply(this, args);
  };

  const originalDnsLookup = dns.lookup;
  dns.lookup = function runtimeGuardedLookup(host, ...args) {
    const pinnedHost = pinLocalhost(host);
    requireLoopbackRequest(pinnedHost, "dns");
    return originalDnsLookup.call(this, pinnedHost, ...args);
  };
  dns.lookupService = function runtimeGuardedLookupService(_port, host) {
    return blockDnsQuery(host, "lookupService");
  };
  for (const name of [
    "resolve",
    "resolve4",
    "resolve6",
    "resolveCname",
    "resolveMx",
    "resolveNaptr",
    "resolveNs",
    "resolvePtr",
    "resolveSoa",
    "resolveSrv",
    "resolveTxt",
    "reverse",
  ]) {
    const original = dns[name];
    if (!original) continue;
    dns[name] = function runtimeGuardedDnsResolve(host) {
      return blockDnsQuery(host, name);
    };
  }
  const resolverMethods = [
    "resolve",
    "resolve4",
    "resolve6",
    "resolveCname",
    "resolveMx",
    "resolveNaptr",
    "resolveNs",
    "resolvePtr",
    "resolveSoa",
    "resolveSrv",
    "resolveTxt",
    "reverse",
  ];
  for (const Resolver of [dns.Resolver]) {
    for (const name of resolverMethods) {
      const original = Resolver.prototype[name];
      if (!original) continue;
      Resolver.prototype[name] = function runtimeGuardedResolverMethod(host) {
        return blockDnsQuery(host, name);
      };
    }
    Resolver.prototype.setServers = function runtimeGuardedResolverSetServers(servers) {
      blockDnsQuery(Array.isArray(servers) ? servers.join(",") : "", "setServers");
      throw new Error("Runtime egress blocked before changing DNS resolver servers.");
    };
  }
  dns.setServers = function runtimeGuardedSetDnsServers(servers) {
    blockDnsQuery(Array.isArray(servers) ? servers.join(",") : "", "setServers");
    throw new Error("Runtime egress blocked before changing DNS servers.");
  };
  const dnsPromises = dns.promises;
  if (dnsPromises) {
    for (const name of [
      "lookup",
      "lookupService",
      "resolve",
      "resolve4",
      "resolve6",
      "resolveCname",
      "resolveMx",
      "resolveNaptr",
      "resolveNs",
      "resolvePtr",
      "resolveSoa",
      "resolveSrv",
      "resolveTxt",
      "reverse",
    ]) {
      const original = dnsPromises[name]?.bind(dnsPromises);
      if (!original) continue;
      dnsPromises[name] = function runtimeGuardedDnsPromise(host, ...args) {
        if (name !== "lookup") return blockDnsQuery(host, name);
        const pinnedHost = pinLocalhost(host);
        requireLoopbackRequest(pinnedHost, "dns");
        return original(pinnedHost, ...args);
      };
    }
    dnsPromises.setServers = function runtimeGuardedSetDnsServers() {
      throw new Error("Runtime egress blocked before changing DNS servers.");
    };
  }

  for (const client of [http, https]) {
    const originalRequest = client.request;
    client.request = function runtimeGuardedRequest(...args) {
      const host = hostFromRequestArgs(args);
      requireLoopbackRequest(host, "http");
      return loopbackRequestContext.run(
        pinLocalhost(host),
        () => originalRequest.apply(this, args),
      );
    };
    const originalGet = client.get;
    client.get = function runtimeGuardedGet(...args) {
      const host = hostFromRequestArgs(args);
      requireLoopbackRequest(host, "http");
      return loopbackRequestContext.run(
        pinLocalhost(host),
        () => originalGet.apply(this, args),
      );
    };
  }

  const originalTlsConnect = tls.connect;
  tls.connect = function runtimeGuardedTlsConnect(...args) {
    const options = args[0] && typeof args[0] === "object" ? args[0] : {};
    const host = options.host ?? options.servername ?? "";
    requireLoopbackRequest(host, "tls");
    return loopbackRequestContext.run(
      pinLocalhost(host),
      () => originalTlsConnect.apply(this, args),
    );
  };

  const originalUdpSend = dgram.Socket.prototype.send;
  dgram.Socket.prototype.send = function runtimeGuardedUdpSend(...args) {
    const hostIndex = typeof args[2] === "string"
      ? 2
      : typeof args[4] === "string"
        ? 4
        : -1;
    const host = hostIndex >= 0 ? args[hostIndex] : "";
    const pinnedHost = pinLocalhost(host);
    if (hostIndex >= 0) args[hostIndex] = pinnedHost;
    requireLoopbackRequest(pinnedHost, "udp");
    return originalUdpSend.apply(this, args);
  };
  const originalUdpConnect = dgram.Socket.prototype.connect;
  dgram.Socket.prototype.connect = function runtimeGuardedUdpConnect(port, host, ...args) {
    const pinnedHost = pinLocalhost(host ?? "");
    requireLoopbackRequest(pinnedHost, "udp");
    return originalUdpConnect.call(this, port, pinnedHost, ...args);
  };
  const originalUdpBind = dgram.Socket.prototype.bind;
  dgram.Socket.prototype.bind = function runtimeGuardedUdpBind(...args) {
    const first = args[0];
    const host = first && typeof first === "object"
      ? first.address ?? first.host ?? ""
      : typeof args[1] === "string"
        ? args[1]
        : "";
    const pinnedHost = pinLocalhost(host);
    requireLoopbackRequest(pinnedHost, "udp-listen");
    if (pinnedHost !== host) {
      if (first && typeof first === "object") {
        args[0] = { ...first, address: pinnedHost };
        delete args[0].host;
      } else if (typeof args[1] === "string") {
        args[1] = pinnedHost;
      }
    }
    return originalUdpBind.apply(this, args);
  };

  const originalHttp2Connect = http2.connect;
  http2.connect = function runtimeGuardedHttp2Connect(authority, ...args) {
    const host = new URL(String(authority)).hostname;
    requireLoopbackRequest(host, "http2");
    return loopbackRequestContext.run(
      pinLocalhost(host),
      () => originalHttp2Connect.call(this, authority, ...args),
    );
  };

  installIsolatedChildProcessPolicy(childProcess);
  syncBuiltinESMExports();
  recordIsolatedGuardEvent({
    kind: "guard-installed",
    nodeNetworkGuard: true,
    childProcessPolicy: true,
  });

  const originalListen = net.Server.prototype.listen;
  net.Server.prototype.listen = function runtimeGuardedListen(...args) {
    const first = args[0];
    const host = first && typeof first === "object"
      ? first.path ? `unix:${first.path}` : first.host ?? first.hostname
      : typeof args[1] === "string"
        ? args[1]
        : typeof first === "string"
          ? `unix:${first}`
          : undefined;
    const pinnedHost = pinLocalhost(host ?? "");
    requireLoopbackRequest(pinnedHost, "listen");
    if (pinnedHost !== host) {
      if (first && typeof first === "object") {
        args[0] = { ...first, host: pinnedHost };
        delete args[0].hostname;
      } else if (typeof args[1] === "string") {
        args[1] = pinnedHost;
      }
    }
    return originalListen.apply(this, args);
  };

  Object.defineProperty(globalThis, GUARD_SYMBOL, {
    value: Object.freeze({ installed: true }),
    configurable: false,
    enumerable: false,
    writable: false,
  });

  if (typeof globalThis.WebSocket === "function") {
    const OriginalWebSocket = globalThis.WebSocket;
    globalThis.WebSocket = class RuntimeGuardedWebSocket extends OriginalWebSocket {
      constructor(url, protocols) {
        requireLoopbackRequest(new URL(String(url)).hostname);
        super(url, protocols);
      }
    };
  }
}
